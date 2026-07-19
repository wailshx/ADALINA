import sys
import os
import json
import time
import logging
import hashlib
import hmac as _hmac
import secrets
import http.cookies
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, APIRouter, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse, HTMLResponse, FileResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from config.database import get_db, get_public_db
from config.security import (
    RateLimiter, SECURITY_HEADERS, PUBLIC_CSP, ADMIN_CSP,
    generate_csrf_token, validate_csrf, escape_html, audit_log
)
from config import storage

from admin.database import (
    init_db, seed_db, deduct_order_stock, restore_order_stock,
    log_stock_change, migrate_taille_stock
)

from shared import (
    _cache, _signal_cache_invalidate, get_build_version, _ensure_columns,
    format_product, batch_format_products, _process_order_background,
    rows_to_list, row_to_dict
)

logger = logging.getLogger('adalina')

class _SafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        import datetime as _dt
        def _default(o):
            if isinstance(o, (_dt.datetime, _dt.date, _dt.time)):
                return o.isoformat()
            raise TypeError(f'Object of type {type(o).__name__} is not JSON serializable')
        return json.dumps(content, default=_default, ensure_ascii=False, allow_nan=False, indent=None, separators=(',', ':')).encode('utf-8')


CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://adalina-v2.onrender.com')
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD_HASH = os.environ.get('ADMIN_PASSWORD_HASH', '')
ADMIN_PASSWORD_SALT = os.environ.get('ADMIN_PASSWORD_SALT', '')
MAX_REQUEST_SIZE = 1 * 1024 * 1024
ADMIN_MAX_REQUEST_SIZE = 50 * 1024 * 1024

PORT = int(os.environ.get('PORT', '8080'))

BUILD_VERSION = get_build_version()



# ---------------------------------------------------------------------------
# Admin product enrichment (used by admin API)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Background order processing (defined in shared.py)
# ---------------------------------------------------------------------------

_order_limiter = RateLimiter()
_cleanup_counter = 0

# ---------------------------------------------------------------------------
# Admin auth helpers
# ---------------------------------------------------------------------------

SESSIONS_FILE = str(BASE_DIR / 'admin' / '.sessions.json')
CSRF_FILE = str(BASE_DIR / 'admin' / '.csrf_tokens.json')
DEFAULT_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'
PBKDF2_ITERATIONS = 600000

def _hash_password(password, salt='', iterations=PBKDF2_ITERATIONS):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), iterations).hex()

if not ADMIN_PASSWORD_HASH or ADMIN_PASSWORD_HASH == DEFAULT_PASSWORD_HASH:
    print("[WARNING] ADMIN_PASSWORD_HASH is not set or is the default.")
    print("[WARNING] Set ADMIN_PASSWORD_HASH env var to a secure hash. Generating a random one for this session.")
    ADMIN_PASSWORD_SALT = secrets.token_hex(16)
    ADMIN_PASSWORD_HASH = _hash_password('daiaaadmin02', ADMIN_PASSWORD_SALT)
    print(f"[WARNING] For this session only, login with: admin / daiaaadmin02")
    print(f"[WARNING] Set ADMIN_PASSWORD_HASH={ADMIN_PASSWORD_HASH} and ADMIN_PASSWORD_SALT={ADMIN_PASSWORD_SALT} in Render env vars.")

def _verify_password(password, stored_hash, salt=''):
    new_hash = _hash_password(password, salt, PBKDF2_ITERATIONS)
    if _hmac.compare_digest(new_hash, stored_hash):
        return True
    old_hash = _hash_password(password, salt, 100000)
    return _hmac.compare_digest(old_hash, stored_hash)

def load_sessions():
    try:
        with open(SESSIONS_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_sessions(sessions):
    with open(SESSIONS_FILE, 'w') as f:
        json.dump(sessions, f)

def get_session(token):
    sessions = load_sessions()
    data = sessions.get(token)
    if data and data.get('admin_logged_in'):
        created = data.get('created_at', 0)
        is_remember = data.get('remember', False)
        max_age = 30 * 24 * 3600 if is_remember else 24 * 3600
        if time.time() - created > max_age:
            sessions.pop(token, None)
            save_sessions(sessions)
            return None
        return data
    return None

def create_session(remember=False):
    token = secrets.token_hex(32)
    sessions = load_sessions()
    sessions[token] = {
        'admin_logged_in': True,
        'admin_username': ADMIN_USERNAME,
        'created_at': time.time(),
        'last_active': time.time(),
        'remember': remember
    }
    save_sessions(sessions)
    return token

def delete_session(token):
    sessions = load_sessions()
    sessions.pop(token, None)
    save_sessions(sessions)

def save_csrf_token(session_token, csrf_token):
    try:
        with open(CSRF_FILE, 'r') as f:
            tokens = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        tokens = {}
    tokens[session_token] = csrf_token
    with open(CSRF_FILE, 'w') as f:
        json.dump(tokens, f)

def get_csrf_token_for_session(session_token):
    try:
        with open(CSRF_FILE, 'r') as f:
            tokens = json.load(f)
        return tokens.get(session_token)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def touch_session(token):
    sessions = load_sessions()
    if token in sessions:
        sessions[token]['last_active'] = time.time()
        save_sessions(sessions)

def get_token_from_cookies(cookie_header):
    if not cookie_header:
        return None
    cookies = http.cookies.SimpleCookie(cookie_header)
    tc = cookies.get('admin_session')
    return tc.value if tc else None

def is_admin_authenticated(request: Request):
    token = get_token_from_cookies(request.headers.get('cookie'))
    return token and get_session(token)

def require_admin_auth(request: Request):
    if not is_admin_authenticated(request):
        raise HTTPException(status_code=307, headers={'Location': '/admin/login'})
    token = get_token_from_cookies(request.headers.get('cookie'))
    if token:
        touch_session(token)
    return True

def get_client_ip(request: Request):
    real_ip = request.headers.get('x-real-for', '')
    if real_ip:
        return real_ip.split(',')[0].strip()
    forwarded = request.headers.get('x-forwarded-for', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.client.host if request.client else '0.0.0.0'

def secure_path(base_dir, requested_path):
    real = os.path.realpath(os.path.join(base_dir, requested_path))
    if not real.startswith(os.path.realpath(base_dir)):
        return None
    return real

# ---------------------------------------------------------------------------
# Column whitelists for admin PUT endpoints
# ---------------------------------------------------------------------------

ALLOWED_PRODUCT_COLUMNS = {'name', 'description', 'price', 'sale_price', 'category_id', 'image', 'images', 'badge', 'sizes', 'colors', 'stock', 'brand', 'rating', 'featured', 'new_arrival', 'status'}
ALLOWED_CATEGORY_COLUMNS = {'name', 'slug', 'description', 'image', 'status', 'size_system'}
ALLOWED_COLLECTION_COLUMNS = {'name', 'description', 'image', 'status'}
ALLOWED_ORDER_COLUMNS = {'status', 'total', 'items', 'customer_name', 'customer_phone', 'wilaya', 'commune', 'shipping_address', 'payment_method', 'delivery_fee', 'customer_id', 'is_read'}
ALLOWED_CUSTOMER_COLUMNS = {'name', 'email', 'phone', 'address', 'status'}

def _filter_columns(data, allowed):
    return {k: v for k, v in data.items() if k in allowed}

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
        seed_db()
        print('✓ Database initialized and seeded')
    except Exception as e:
        print(f'! Database init warning: {e}')
    _ensure_columns()

    try:
        db = get_public_db()
        db.close()
        db_ok = True
    except Exception as e:
        print(f'WARNING: Cannot connect to database: {e}')
        db_ok = False

    print(f'\n{"="*50}')
    print(f'ADALINA UNIFIED SERVER')
    print(f'Port: {PORT}')
    print(f'DB: {"OK" if db_ok else "UNREACHABLE"}')
    print(f'Build: {BUILD_VERSION}')
    print(f'{"="*50}')

    yield

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title='Adalina', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[CORS_ORIGIN],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers[k] = v
        path = request.url.path
        if path.startswith('/admin/'):
            response.headers['Content-Security-Policy'] = ADMIN_CSP
        else:
            response.headers['Content-Security-Policy'] = PUBLIC_CSP
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ---------------------------------------------------------------------------
# Static mounts
# ---------------------------------------------------------------------------

css_dir = BASE_DIR / 'css'
js_dir = BASE_DIR / 'js'
images_dir = BASE_DIR / 'images'
uploads_dir = BASE_DIR / 'uploads'
admin_css_dir = BASE_DIR / 'admin' / 'css'
admin_js_dir = BASE_DIR / 'admin' / 'js'

for d in [css_dir, js_dir, images_dir, uploads_dir, admin_css_dir, admin_js_dir]:
    d.mkdir(parents=True, exist_ok=True)

app.mount('/css', StaticFiles(directory=str(css_dir)), name='css')
app.mount('/js', StaticFiles(directory=str(js_dir)), name='js')
app.mount('/images', StaticFiles(directory=str(images_dir)), name='images')
app.mount('/uploads', StaticFiles(directory=str(uploads_dir)), name='uploads')
app.mount('/admin/css', StaticFiles(directory=str(admin_css_dir)), name='admin_css')
app.mount('/admin/js', StaticFiles(directory=str(admin_js_dir)), name='admin_js')

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

from routers import storefront as _storefront_module
from routers import admin_api as _admin_api_module
from routers import admin_pages as _admin_pages_module

app.include_router(_storefront_module.router)
app.include_router(_admin_api_module.router)
app.include_router(_admin_pages_module.router)

# ---------------------------------------------------------------------------
# Root + website routes
# ---------------------------------------------------------------------------

@app.get('/')
async def root_redirect():
    return RedirectResponse(url='/website/', status_code=302)

@app.get('/website/')
async def serve_website_index():
    file_path = BASE_DIR / 'index.html'
    if not file_path.exists():
        return HTMLResponse(content='Not found', status_code=404)
    content = file_path.read_bytes()
    content = content.replace(b'?v=__BUILD__', ('?v=' + BUILD_VERSION).encode())
    return HTMLResponse(content=content, media_type='text/html')

@app.get('/website/{path:path}')
async def serve_website_file(path: str):
    if not path:
        return RedirectResponse(url='/website/', status_code=302)

    if path == 'products.json':
        return await serve_products_json()

    file_path = BASE_DIR / path
    real = os.path.realpath(file_path)
    if not real.startswith(str(BASE_DIR)):
        return HTMLResponse(content='Forbidden', status_code=403)

    if not os.path.isfile(real):
        return HTMLResponse(content='Not found', status_code=404)

    if path.endswith('.html') or path.endswith('.htm'):
        content = open(real, 'rb').read()
        content = content.replace(b'?v=__BUILD__', ('?v=' + BUILD_VERSION).encode())
        return HTMLResponse(content=content, media_type='text/html')

    return FileResponse(path=real)

# ---------------------------------------------------------------------------
# Products.json endpoint (served from DB)
# ---------------------------------------------------------------------------

@app.get('/website/products.json')
async def serve_products_json():
    cached = _cache.get('products_json', ttl=300)
    if cached is not None:
        return _SafeJSONResponse(content=cached)
    db = None
    try:
        db = get_public_db()
        cur = db.cursor()
        cur.execute("""
            SELECT p.id, p.name, p.description, p.price, p.sale_price, p.category_id,
                   p.image, p.images, p.badge, p.sizes, p.colors, p.stock, p.brand,
                   p.rating, p.status, p.featured, p.new_arrival, p.created_at,
                   c.name AS category_name, c.size_system AS category_size_system
            FROM products p LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status='active'
            ORDER BY p.created_at DESC
        """)
        rows = cur.fetchall()
        products = batch_format_products(rows, cur)
        _cache.set('products_json', products)
        return _SafeJSONResponse(content=products)
    except Exception as e:
        logger.exception('Error loading products.json')
        return _SafeJSONResponse(content={'error': 'Erreur serveur'}, status_code=500)
    finally:
        if db:
            try: db.close()
            except Exception: pass

# ---------------------------------------------------------------------------
# Wishlist HTML pages
# ---------------------------------------------------------------------------

@app.get('/wishlist/{wl_hash}')
async def serve_wishlist_page(wl_hash: str):
    if wl_hash.strip():
        file_path = BASE_DIR / 'wishlist-public.html'
    else:
        file_path = BASE_DIR / 'wishlist.html'
    if not file_path.exists():
        return HTMLResponse(content='Not found', status_code=404)
    content = file_path.read_bytes()
    content = content.replace(b'?v=__BUILD__', ('?v=' + BUILD_VERSION).encode())
    return HTMLResponse(content=content, media_type='text/html')

@app.get('/wishlist/')
async def serve_wishlist_empty():
    file_path = BASE_DIR / 'wishlist.html'
    if not file_path.exists():
        return HTMLResponse(content='Not found', status_code=404)
    content = file_path.read_bytes()
    content = content.replace(b'?v=__BUILD__', ('?v=' + BUILD_VERSION).encode())
    return HTMLResponse(content=content, media_type='text/html')

# ---------------------------------------------------------------------------
# Tracking redirect
# ---------------------------------------------------------------------------

@app.get('/track/{order_number}')
async def track_redirect(order_number: str):
    from starlette.responses import RedirectResponse
    return RedirectResponse(url=f'/website/track.html?order={order_number}', status_code=302)

@app.get('/track/')
async def track_empty():
    return RedirectResponse(url='/website/track.html', status_code=302)

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get('/api/health')
async def health_check():
    db = None
    try:
        db = get_public_db()
        cur = db.cursor()
        cur.execute('SELECT 1')
        cur.fetchone()
        cur.execute("SELECT COUNT(*) AS cnt FROM orders")
        order_count = cur.fetchone()['cnt']
        try:
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='delivery_mode'")
            has_dm = bool(cur.fetchone())
        except Exception:
            has_dm = 'unknown'
        return {'status': 'ok', 'database': 'connected', 'order_count': order_count, 'delivery_mode_column': has_dm}
    except Exception as e:
        logger.error(f'Health check DB error: {e}')
        return _SafeJSONResponse({'status': 'error', 'database': str(e)}, status_code=503)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, workers=1)
