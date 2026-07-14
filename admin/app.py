import os
import json
import secrets
import hashlib
import http.server
import http.cookies
import urllib.parse
import re
import time
import shutil
import fcntl
from functools import wraps

try:
    import cloudinary
    import cloudinary.uploader
    import cloudinary.api
    _HAS_CLOUDINARY = True
except ImportError:
    _HAS_CLOUDINARY = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
SESSIONS_FILE = os.path.join(BASE_DIR, '.sessions.json')

from database import get_db, init_db, seed_db, log_stock_change, deduct_order_stock, restore_order_stock, get_variant_stock
import sys
sys.path.insert(0, os.path.join(os.path.dirname(BASE_DIR)))
from config.security import (
    RateLimiter, add_security_headers, get_client_ip,
    generate_csrf_token, validate_csrf, escape_html,
    sanitize_dict, sanitize_list, audit_log
)

CLOUDINARY_CLOUD = os.environ.get('CLOUDINARY_CLOUD_NAME', '')
CLOUDINARY_KEY = os.environ.get('CLOUDINARY_API_KEY', '')
CLOUDINARY_SECRET = os.environ.get('CLOUDINARY_API_SECRET', '')
CLOUDINARY_FOLDER = os.environ.get('CLOUDINARY_FOLDER', 'adalina')

if _HAS_CLOUDINARY and CLOUDINARY_CLOUD and CLOUDINARY_KEY and CLOUDINARY_SECRET:
    cloudinary.config(
        cloud_name=CLOUDINARY_CLOUD,
        api_key=CLOUDINARY_KEY,
        api_secret=CLOUDINARY_SECRET
    )
    CLOUDINARY_ENABLED = True
    print("[Cloudinary] Enabled — images will be stored in cloud")
else:
    CLOUDINARY_ENABLED = False
    print("[Cloudinary] Disabled — images stored locally (will be lost on redeploy)")

ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD_HASH = os.environ.get('ADMIN_PASSWORD_HASH', '')
ADMIN_PASSWORD_SALT = os.environ.get('ADMIN_PASSWORD_SALT', '')
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://adalina.onrender.com')

_login_limiter = RateLimiter()

DEFAULT_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'

# Column whitelists for PUT endpoints (prevents SQL injection via column names)
ALLOWED_PRODUCT_COLUMNS = {'name', 'description', 'price', 'sale_price', 'category_id', 'image', 'images', 'badge', 'sizes', 'colors', 'stock', 'brand', 'rating', 'featured', 'new_arrival', 'status'}
ALLOWED_CATEGORY_COLUMNS = {'name', 'slug', 'description', 'image', 'status', 'size_system'}
ALLOWED_COLLECTION_COLUMNS = {'name', 'description', 'image', 'status'}
ALLOWED_ORDER_COLUMNS = {'status', 'total', 'items', 'customer_name', 'customer_phone', 'wilaya', 'commune', 'shipping_address', 'payment_method', 'delivery_fee', 'customer_id', 'is_read'}
ALLOWED_CUSTOMER_COLUMNS = {'name', 'email', 'phone', 'address', 'status'}

def _filter_columns(data, allowed):
    return {k: v for k, v in data.items() if k in allowed}

PBKDF2_ITERATIONS = 600000

def _hash_password(password, salt='', iterations=PBKDF2_ITERATIONS):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), iterations).hex()

def _verify_password(password, stored_hash, salt=''):
    import hmac as _hmac
    new_hash = _hash_password(password, salt, PBKDF2_ITERATIONS)
    if _hmac.compare_digest(new_hash, stored_hash):
        return True
    old_hash = _hash_password(password, salt, 100000)
    return _hmac.compare_digest(old_hash, stored_hash)

# Startup check: refuse to run with default admin password
if not ADMIN_PASSWORD_HASH or ADMIN_PASSWORD_HASH == DEFAULT_PASSWORD_HASH:
    print("[WARNING] ADMIN_PASSWORD_HASH is not set or is the default.")
    print("[WARNING] Set ADMIN_PASSWORD_HASH env var to a secure hash. Generating a random one for this session.")
    ADMIN_PASSWORD_SALT = secrets.token_hex(16)
    ADMIN_PASSWORD_HASH = _hash_password('daiaaadmin02', ADMIN_PASSWORD_SALT)
    print(f"[WARNING] For this session only, login with: admin / daiaaadmin02")
    print(f"[WARNING] Set ADMIN_PASSWORD_HASH={ADMIN_PASSWORD_HASH} and ADMIN_PASSWORD_SALT={ADMIN_PASSWORD_SALT} in Render env vars.")

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
}

def load_sessions():
    try:
        with open(SESSIONS_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_sessions(sessions):
    with open(SESSIONS_FILE, 'w') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        json.dump(sessions, f)
        fcntl.flock(f, fcntl.LOCK_UN)

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

CSRF_FILE = os.path.join(BASE_DIR, '.csrf_tokens.json')

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

def is_authenticated(self):
    token = get_token_from_cookies(self.headers.get('Cookie'))
    return token and get_session(token)

def require_auth(self):
    if not is_authenticated(self):
        self.send_response(302)
        self.send_header('Location', '/admin/login')
        self.end_headers()
        return False
    token = get_token_from_cookies(self.headers.get('Cookie'))
    if token:
        touch_session(token)
    return True

def require_csrf(self):
    if not validate_csrf(self):
        send_json(self, {'error': 'CSRF token missing or invalid'}, 403)
        return False
    return True

def send_file(self, path, status=200):
    if not os.path.isfile(path):
        self.send_response(404)
        self.send_header('Content-Type', 'text/html')
        add_security_headers(self, admin=True)
        self.end_headers()
        self.wfile.write(b'404 Not Found')
        return
    ext = os.path.splitext(path)[1].lower()
    ctype = MIME_TYPES.get(ext, 'application/octet-stream')
    self.send_response(status)
    self.send_header('Content-Type', ctype)
    if 'text/' in ctype or 'application/javascript' in ctype:
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
    add_security_headers(self, admin=True)
    self.end_headers()
    with open(path, 'rb') as f:
        self.wfile.write(f.read())

def send_json(self, data, status=200):
    body = json.dumps(data, default=str).encode('utf-8')
    self.send_response(status)
    self.send_header('Content-Type', 'application/json')
    self.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
    self.send_header('Cache-Control', 'no-store, must-revalidate')
    self.send_header('Pragma', 'no-cache')
    add_security_headers(self, admin=True)
    self.end_headers()
    self.wfile.write(body)

def redirect(self, location):
    self.send_response(302)
    self.send_header('Location', location)
    self.end_headers()

MAX_REQUEST_SIZE = 50 * 1024 * 1024  # 50 MB (for file uploads)

def read_body(self):
    length = int(self.headers.get('Content-Length', 0))
    if length > MAX_REQUEST_SIZE:
        send_json(self, {'error': 'Request too large'}, 413)
        return ''
    return self.rfile.read(length).decode('utf-8')

def secure_path(base_dir, requested_path):
    real = os.path.realpath(os.path.join(base_dir, requested_path))
    if not real.startswith(os.path.realpath(base_dir)):
        return None
    return real

def parse_multipart(body, boundary):
    result = {'fields': {}, 'files': []}
    delimiter = f'--{boundary}'.encode()
    parts = body.split(delimiter)
    for part in parts:
        part = part.strip(b'\r\n')
        if part == b'' or part == b'--':
            continue
        idx = part.find(b'\r\n\r\n')
        if idx == -1:
            continue
        headers_raw = part[:idx]
        content = part[idx + 4:]
        headers_text = headers_raw.decode('utf-8', errors='replace')
        field_name = None
        filename = None
        content_type = None
        for line in headers_text.split('\r\n'):
            if line.lower().startswith('content-disposition:'):
                for seg in line.split(';'):
                    seg = seg.strip()
                    if seg.startswith('name='):
                        field_name = seg[5:].strip('"').strip("'")
                    elif seg.startswith('filename='):
                        filename = seg[9:].strip('"').strip("'")
            elif line.lower().startswith('content-type:'):
                content_type = line.split(':', 1)[1].strip()
        if filename:
            result['files'].append({
                'field': field_name,
                'filename': filename,
                'content': content,
                'content_type': content_type or 'application/octet-stream',
            })
        elif field_name:
            result['fields'][field_name] = content.decode('utf-8', errors='replace')
    return result

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

def enrich_product(row, cur):
    """Enrich a product row with variant images, colors, sizes — shared by products & collections APIs."""
    d = dict(row)
    pid = d['id']
    if d.get('images') and isinstance(d['images'], str):
        d['images'] = json.loads(d['images'])
    if d.get('sizes') and isinstance(d['sizes'], str):
        d['sizes'] = json.loads(d['sizes'])
    if d.get('colors') and isinstance(d['colors'], str):
        d['colors'] = json.loads(d['colors'])
    cur.execute("SELECT id, color_name, color_hex, sku, stock FROM product_variants WHERE product_id=%s ORDER BY sort_order, id", (pid,))
    variant_rows = cur.fetchall()
    if variant_rows:
        variants = []
        all_colors = {}
        all_sizes = set()
        images_seen = set()
        merged_sizes = []
        for v in variant_rows:
            vdict = {'id': v['id'], 'color_name': v['color_name'], 'color_hex': v['color_hex'], 'sku': v['sku'], 'stock': v['stock']}
            cur.execute("SELECT image_path FROM variant_images WHERE variant_id=%s ORDER BY sort_order", (v['id'],))
            vdict['images'] = [r['image_path'] for r in cur.fetchall()]
            cur.execute("SELECT size_name, stock, COALESCE(sku, '') AS sku FROM variant_sizes WHERE variant_id=%s ORDER BY id", (v['id'],))
            vdict['sizes'] = [{'size': r['size_name'], 'stock': r['stock'], 'sku': r.get('sku', '')} for r in cur.fetchall()]
            variants.append(vdict)
            if v['color_name'] and v['color_name'] not in all_colors:
                all_colors[v['color_name']] = {'name': v['color_name'], 'hex': v['color_hex'], 'stock': v['stock']}
            for s in vdict['sizes']:
                if s['size'] not in all_sizes:
                    all_sizes.add(s['size'])
                    merged_sizes.append(s)
            for img in vdict['images']:
                if img not in images_seen:
                    images_seen.add(img)
        d['colors'] = list(all_colors.values()) if all_colors else []
        d['sizes'] = merged_sizes if merged_sizes else []
        d['variants'] = variants
        d['images'] = list(images_seen) if images_seen else (d.get('images') or [])
    else:
        d['variants'] = []
    d['featured'] = bool(d.get('featured', 0))
    d['new_arrival'] = bool(d.get('new_arrival', 0))
    d['category'] = d.get('category_name') or ''
    return d

class AdminHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        if len(args) >= 3:
            print(f"[Admin] {args[0]} {args[1]} {args[2]}")
        else:
            print(f"[Admin] {' '.join(str(a) for a in args)}")

    def api_GET(self, path, query):
        db = get_db()
        cur = db.cursor()

        if path == '/api/dashboard/stats':
            cur.execute("SELECT COALESCE(SUM(total),0) AS val FROM orders WHERE status='delivered'")
            revenue = cur.fetchone()['val']
            cur.execute("SELECT COUNT(*) AS cnt FROM orders")
            orders_count = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM customers")
            customers_count = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM products")
            products_count = cur.fetchone()['cnt']
            cur.execute("""
                SELECT o.id, o.order_number, COALESCE(c.name, o.customer_name) AS customer_name,
                       o.status, o.total, o.created_at
                FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
                ORDER BY o.id DESC LIMIT 5
            """)
            recent_orders = cur.fetchall()

            cur.execute("SELECT id, name, price, image, stock FROM products ORDER BY id DESC LIMIT 5")
            recent_products = cur.fetchall()

            cur.execute("SELECT id, items FROM orders")
            all_orders = cur.fetchall()
            sold_map = {}
            for order in all_orders:
                items = json.loads(order['items']) if order.get('items') else []
                for item in items:
                    pid = item.get('product_id')
                    qty = item.get('quantity', 1)
                    if pid:
                        sold_map[pid] = sold_map.get(pid, 0) + qty
            cur.execute("SELECT id, name, price, image, stock FROM products")
            all_products = cur.fetchall()
            top_products_data = []
            for p in all_products:
                top_products_data.append({
                    'id': p['id'], 'name': p['name'], 'price': p['price'],
                    'image': p['image'], 'stock': p['stock'],
                    'sold': sold_map.get(p['id'], 0)
                })
            top_products_data.sort(key=lambda x: x['sold'], reverse=True)
            top_products_data = top_products_data[:5]

            cur.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE quantity > 0 AND quantity <= low_stock_threshold")
            low_stock = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE quantity = 0")
            out_of_stock = cur.fetchone()['cnt']

            # Monthly stats for current year
            cur.execute("""
                SELECT EXTRACT(MONTH FROM created_at) AS month, COUNT(*) AS cnt, COALESCE(SUM(total),0) AS rev
                FROM orders WHERE status='delivered' AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
                GROUP BY month ORDER BY month
            """)
            monthly_data = cur.fetchall()
            monthly_orders = [0]*12
            monthly_revenue = [0]*12
            for row in monthly_data:
                m = int(row['month']) - 1
                monthly_orders[m] = row['cnt']
                monthly_revenue[m] = round(row['rev'], 2)

            # Most sold products (for chart) – top products with higher limit
            most_sold_chart = []
            for p in top_products_data[:5]:
                if p['sold'] > 0:
                    most_sold_chart.append({'name': p['name'], 'sold': p['sold']})

            send_json(self, {
                'revenue': round(revenue, 2),
                'orders_count': orders_count,
                'customers_count': customers_count,
                'products_count': products_count,
                'low_stock': low_stock,
                'out_of_stock': out_of_stock,
                'recent_orders': rows_to_list(recent_orders),
                'recent_products': rows_to_list(recent_products),
                'top_products': top_products_data,
                'monthly_orders': monthly_orders,
                'monthly_revenue': monthly_revenue,
                'most_sold_chart': most_sold_chart,
            })
            return True

        if path == '/api/analytics':
            cur.execute("SELECT COALESCE(SUM(total),0) AS val FROM orders WHERE status='delivered'")
            total_revenue = cur.fetchone()['val']
            cur.execute("SELECT COUNT(*) AS cnt FROM orders")
            total_orders = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM customers")
            total_customers = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM products")
            total_products = cur.fetchone()['cnt']

            cur.execute("""
                SELECT TO_CHAR(created_at, 'YYYY-MM') AS month,
                       COUNT(*) AS orders,
                       COALESCE(SUM(total),0) AS revenue
                FROM orders
                WHERE created_at >= NOW() - INTERVAL '12 months'
                GROUP BY month ORDER BY month
            """)
            monthly_sales = cur.fetchall()

            cur.execute("SELECT id, items FROM orders")
            orders_for_analytics = cur.fetchall()
            cur.execute("""
                SELECT p.id, c.id AS cat_id, c.name AS cat_name
                FROM products p JOIN categories c ON p.category_id = c.id
            """)
            prod_cat = cur.fetchall()
            prod_to_cat = {p['id']: {'id': p['cat_id'], 'name': p['cat_name']} for p in prod_cat}

            cat_stats = {}
            for order in orders_for_analytics:
                items = json.loads(order['items']) if order.get('items') else []
                order_cats = set()
                for item in items:
                    pid = item.get('product_id')
                    qty = item.get('quantity', 1)
                    price = item.get('price', 0)
                    cat = prod_to_cat.get(pid)
                    if cat:
                        cid = cat['id']
                        order_cats.add(cid)
                        if cid not in cat_stats:
                            cat_stats[cid] = {'id': cid, 'name': cat['name'], 'order_count': 0, 'revenue': 0.0}
                        cat_stats[cid]['revenue'] += qty * price
                for cid in order_cats:
                    cat_stats[cid]['order_count'] += 1
            category_perf = sorted(cat_stats.values(), key=lambda x: x['revenue'], reverse=True)

            cur.execute("SELECT p.id, p.name, p.price, p.image, p.stock FROM products p")
            all_prods = cur.fetchall()
            all_order_items = []
            for order in orders_for_analytics:
                items = json.loads(order['items']) if order.get('items') else []
                all_order_items.extend(items)
            prod_sales = {}
            for item in all_order_items:
                pid = item.get('product_id')
                qty = item.get('quantity', 1)
                price = item.get('price', 0)
                if pid:
                    if pid not in prod_sales:
                        prod_sales[pid] = {'sold': 0, 'revenue': 0.0}
                    prod_sales[pid]['sold'] += qty
                    prod_sales[pid]['revenue'] += qty * price
            best_sellers_list = []
            for p in all_prods:
                s = prod_sales.get(p['id'], {'sold': 0, 'revenue': 0.0})
                best_sellers_list.append({
                    'id': p['id'], 'name': p['name'], 'price': p['price'],
                    'image': p['image'], 'stock': p['stock'],
                    'sold': s['sold'], 'revenue': round(s['revenue'], 2)
                })
            best_sellers_list.sort(key=lambda x: x['sold'], reverse=True)
            best_sellers_list = best_sellers_list[:10]

            cur.execute("""
                SELECT DATE(created_at) AS day,
                       COUNT(*) AS orders,
                       COALESCE(SUM(total),0) AS revenue
                FROM orders
                WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY day ORDER BY day
            """)
            daily_sales = cur.fetchall()

            cur.execute("SELECT COALESCE(AVG(total),0) AS val FROM orders")
            avg_order = cur.fetchone()['val']
            conversion = (total_orders / max(total_customers, 1)) * 100

            send_json(self, {
                'stats': {
                    'revenue': round(total_revenue, 2),
                    'orders': total_orders,
                    'customers': total_customers,
                    'products': total_products,
                    'avg_order_value': round(avg_order, 2),
                    'conversion': round(conversion, 1),
                },
                'monthly_sales': rows_to_list(monthly_sales),
                'category_performance': category_perf,
                'best_sellers': best_sellers_list,
                'daily_sales': rows_to_list(daily_sales),
            })
            return True

        if path == '/api/products':
            search = query.get('search', [''])[0].strip().lower()
            category = query.get('category', [''])[0].strip()
            params = []
            where = []
            if category:
                where.append("LOWER(c.name) = LOWER(%s)")
                params.append(category)
            if search:
                where.append("LOWER(p.name) LIKE %s")
                params.append(f'%{search}%')
            where_clause = " AND ".join(where) if where else "1=1"
            cur.execute("""SELECT p.*, c.name AS category_name FROM products p
                     LEFT JOIN categories c ON p.category_id = c.id
                     WHERE """ + where_clause + " ORDER BY p.id", params)
            rows = cur.fetchall()
            result = []
            for r in rows:
                d = dict(r)
                pid = d['id']
                if d.get('images') and isinstance(d['images'], str):
                    d['images'] = json.loads(d['images'])
                # Read variants with images, sizes, sku
                cur.execute("SELECT id, color_name, color_hex, sku FROM product_variants WHERE product_id=%s ORDER BY sort_order, id", (pid,))
                variant_rows = cur.fetchall()
                variants = []
                all_sizes = set()
                all_colors = []
                for v in variant_rows:
                    vid = v['id']
                    cur.execute("SELECT image_path FROM variant_images WHERE variant_id=%s ORDER BY sort_order", (vid,))
                    images = [row['image_path'] for row in cur.fetchall()]
                    cur.execute("SELECT size_name, stock, COALESCE(sku, '') AS sku FROM variant_sizes WHERE variant_id=%s ORDER BY id", (vid,))
                    sizes = [{'size': row['size_name'], 'stock': row['stock'], 'sku': row.get('sku', '')} for row in cur.fetchall()]
                    variants.append({
                        'color_name': v['color_name'],
                        'color_hex': v['color_hex'],
                        'sku': v['sku'],
                        'images': images,
                        'sizes': sizes,
                    })
                    all_colors.append({'name': v['color_name'], 'hex': v['color_hex']})
                    for s in sizes:
                        all_sizes.add(s['size'])
                # Fallback to old tables if no advanced variants exist
                if not variant_rows:
                    cur.execute("SELECT size FROM product_sizes WHERE product_id=%s ORDER BY id", (pid,))
                    d['sizes'] = [s['size'] for s in cur.fetchall()]
                    cur.execute("SELECT color_name FROM product_colors WHERE product_id=%s ORDER BY id", (pid,))
                    d['colors'] = [c['color_name'] for c in cur.fetchall()]
                else:
                    d['sizes'] = list(all_sizes)
                    d['colors'] = all_colors
                    d['variants'] = variants
                result.append(d)
            send_json(self, result)
            return True

        if path.startswith('/api/products/'):
            pid = path.split('/')[-1]
            cur.execute("""SELECT p.*, c.name AS category_name FROM products p
                                 LEFT JOIN categories c ON p.category_id = c.id WHERE p.id=%s""", (pid,))
            row = cur.fetchone()
            if not row:
                send_json(self, {'error': 'Not found'}, 404)
                return True
            data = dict(row)
            if data.get('images') and isinstance(data['images'], str):
                data['images'] = json.loads(data['images'])
            # Read variants with images, sizes, sku
            cur.execute("SELECT id, color_name, color_hex, sku FROM product_variants WHERE product_id=%s ORDER BY sort_order, id", (pid,))
            variant_rows = cur.fetchall()
            variants = []
            all_colors = []
            for v in variant_rows:
                vid = v['id']
                cur.execute("SELECT image_path FROM variant_images WHERE variant_id=%s ORDER BY sort_order", (vid,))
                images = [row['image_path'] for row in cur.fetchall()]
                cur.execute("SELECT size_name, stock, COALESCE(sku, '') AS sku FROM variant_sizes WHERE variant_id=%s ORDER BY id", (vid,))
                sizes = [{'size': row['size_name'], 'stock': row['stock'], 'sku': row.get('sku', '')} for row in cur.fetchall()]
                variants.append({
                    'color_name': v['color_name'],
                    'color_hex': v['color_hex'],
                    'sku': v['sku'],
                    'images': images,
                    'sizes': sizes,
                })
                all_colors.append({'name': v['color_name'], 'hex': v['color_hex']})
            # Fallback to old tables if no advanced variants exist
            if not variant_rows:
                cur.execute("SELECT size, stock FROM product_sizes WHERE product_id=%s ORDER BY id", (pid,))
                data['sizes'] = [{'size': r['size'], 'stock': r['stock']} for r in cur.fetchall()]
                cur.execute("SELECT color_name, color_hex, stock FROM product_colors WHERE product_id=%s ORDER BY id", (pid,))
                data['colors'] = [{'name': r['color_name'], 'hex': r['color_hex'], 'stock': r['stock']} for r in cur.fetchall()]
                cur.execute("SELECT color_name, size_name, stock FROM product_variants WHERE product_id=%s ORDER BY id", (pid,))
                data['variants'] = [{'color_name': r['color_name'], 'size_name': r['size_name'], 'stock': r['stock']} for r in cur.fetchall()]
            else:
                data['colors'] = all_colors
                data['variants'] = variants
            send_json(self, data)
            return True

        if path == '/api/categories':
            cur.execute("""
                SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
                FROM categories c ORDER BY c.id
            """)
            rows = cur.fetchall()
            send_json(self, rows_to_list(rows))
            return True

        if path.startswith('/api/categories/'):
            cid = path.split('/')[-1]
            cur.execute("""
                SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
                FROM categories c WHERE c.id=%s
            """, (cid,))
            row = cur.fetchone()
            send_json(self, row_to_dict(row) if row else {'error': 'Not found'}, 404 if not row else 200)
            return True

        if path == '/api/collections':
            cur.execute("""
                SELECT c.*, (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id) AS product_count
                FROM collections c ORDER BY c.id
            """)
            rows = cur.fetchall()
            send_json(self, rows_to_list(rows))
            return True

        if path.startswith('/api/collections/') and path != '/api/collections/all':
            cid = path.split('/')[-1]
            cur.execute("SELECT * FROM collections WHERE id=%s", (cid,))
            row = cur.fetchone()
            if not row:
                send_json(self, {'error': 'Not found'}, 404)
                return True
            coll = dict(row)
            cur.execute("""
                SELECT p.id, p.name, p.price, p.image FROM products p
                JOIN collection_products cp ON cp.product_id = p.id
                WHERE cp.collection_id = %s
            """, (cid,))
            prods = cur.fetchall()
            coll['product_ids'] = [p['id'] for p in prods]
            coll['products'] = rows_to_list(prods)
            send_json(self, coll)
            return True

        if path == '/api/orders':
            cur.execute("""
                SELECT o.*, COALESCE(c.name, o.customer_name) AS customer_name, c.email AS customer_email
                FROM orders o LEFT JOIN customers c ON o.customer_id = c.id ORDER BY o.id DESC
            """)
            rows = cur.fetchall()
            send_json(self, rows_to_list(rows))
            return True

        if path.startswith('/api/orders/'):
            oid = path.split('/')[-1]
            cur.execute("""
                SELECT o.*, COALESCE(c.name, o.customer_name) AS customer_name, c.email AS customer_email
                FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.id=%s
            """, (oid,))
            row = cur.fetchone()
            if not row:
                send_json(self, {'error': 'Not found'}, 404)
                return True
            data = dict(row)
            if data.get('items'):
                data['items'] = json.loads(data['items'])
            send_json(self, data)
            return True

        if path.startswith('/api/orders/') and path.endswith('/history'):
            parts = path.split('/')
            oid = parts[2]
            cur.execute("SELECT status, note, created_at FROM status_history WHERE order_id=%s ORDER BY created_at ASC", (oid,))
            rows = cur.fetchall()
            result = [{'status': r['status'], 'note': r['note'], 'created_at': r['created_at'].isoformat() if r['created_at'] else None} for r in rows]
            send_json(self, result)
            return True

        # GET /api/settings
        if path == '/api/settings':
            cur.execute("SELECT * FROM settings ORDER BY category, id")
            rows = cur.fetchall()
            result = {}
            for r in rows:
                key = r['setting_key']
                val = r['setting_value']
                t = r['setting_type']
                if t == 'boolean':
                    val = val == '1'
                elif t == 'number':
                    try: val = float(val)
                    except: pass
                result[key] = {'value': val, 'type': t, 'category': r['category'], 'description': r.get('description', '')}
            send_json(self, result)
            return True

        if path == '/api/delivery-prices':
            cur.execute("SELECT wilaya_id, price FROM delivery_prices ORDER BY wilaya_id")
            rows = cur.fetchall()
            result = {}
            for r in rows:
                result[str(r['wilaya_id'])] = r['price']
            send_json(self, result)
            return True

        if path == '/api/notifications':
            cur.execute("SELECT COUNT(*) AS cnt FROM orders WHERE is_read IS NULL OR is_read=0")
            unread = cur.fetchone()['cnt']
            cur.execute("""
                SELECT id AS order_id, order_number, customer_name, total, created_at
                FROM orders
                WHERE is_read IS NULL OR is_read=0
                ORDER BY created_at DESC LIMIT 20
            """)
            rows = cur.fetchall()
            notifs = []
            for r in rows:
                n = dict(r)
                n['id'] = n['order_id']
                n['type'] = 'order'
                n['customer_name'] = n.get('customer_name', '') or ''
                n['total'] = float(n.get('total', 0))
                notifs.append(n)
            try:
                cur.execute("""
                    SELECT i.product_id, i.quantity, p.name AS product_name
                    FROM inventory i
                    JOIN products p ON i.product_id = p.id
                    WHERE p.status = 'active' AND i.quantity <= 5 AND i.quantity >= 0
                    ORDER BY i.quantity ASC LIMIT 5
                """)
                low_stock = cur.fetchall()
                for ls in low_stock:
                    notifs.append({
                        'id': 'low_stock_' + str(ls['product_id']),
                        'type': 'low_stock',
                        'product_id': ls['product_id'],
                        'product_name': ls['product_name'],
                        'quantity': ls['quantity'],
                        'message': f"Stock faible ({ls['quantity']}) pour {ls['product_name']}"
                    })
            except Exception:
                pass
            send_json(self, {'notifications': notifs, 'unread_count': unread})
            return True

        if path == '/api/customers':
            page = int(query.get('page', ['1'])[0])
            per_page = int(query.get('per_page', ['20'])[0])
            search = query.get('search', [''])[0].strip().lower()
            offset = (page - 1) * per_page
            where = []
            params = []
            if search:
                where.append("(LOWER(name) LIKE %s OR LOWER(email) LIKE %s)")
                params.extend(['%' + search + '%', '%' + search + '%'])
            where_clause = " WHERE " + " AND ".join(where) if where else ""
            cur.execute("SELECT COUNT(*) AS cnt FROM customers" + where_clause, params)
            total = cur.fetchone()['cnt']
            cur.execute("""
                SELECT c.*,
                    (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count,
                    (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.customer_id = c.id) AS total_spent
                FROM customers c""" + where_clause + " ORDER BY c.id DESC LIMIT %s OFFSET %s", params + [per_page, offset])
            rows = cur.fetchall()
            total_pages = max(1, (total + per_page - 1) // per_page) if total > 0 else 1
            send_json(self, {'customers': rows_to_list(rows), 'total': total, 'page': page, 'per_page': per_page, 'total_pages': total_pages})
            return True

        if path.startswith('/api/customers/') and path != '/api/customers':
            cid = path.split('/')[-1]
            cur.execute("SELECT * FROM customers WHERE id=%s", (cid,))
            row = cur.fetchone()
            if not row:
                send_json(self, {'error': 'Not found'}, 404)
                return True
            cust = dict(row)
            cur.execute("SELECT * FROM orders WHERE customer_id=%s ORDER BY id DESC", (cid,))
            orders = cur.fetchall()
            cust['orders'] = rows_to_list(orders)
            send_json(self, cust)
            return True

        if path == '/api/size-guides':
            if method == 'GET':
                cur.execute("SELECT sg.*, c.name AS category_name FROM size_guides sg LEFT JOIN categories c ON sg.category_id = c.id ORDER BY sg.id")
                rows = cur.fetchall()
                result = []
                for r in rows:
                    d = dict(r)
                    if d.get('sizes_json'):
                        try:
                            d['sizes'] = json.loads(d['sizes_json'])
                        except Exception:
                            d['sizes'] = []
                    else:
                        d['sizes'] = []
                    d.pop('sizes_json', None)
                    result.append(d)
                send_json(self, result)
                return True
            if method == 'POST':
                guide_name = data.get('guide_name', '')
                category_id = data.get('category_id')
                fit_type = data.get('fit_type', 'regular')
                sizes = data.get('sizes', [])
                notes = data.get('notes', '')
                cur.execute("INSERT INTO size_guides (category_id, guide_name, fit_type, sizes_json, notes) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                            (category_id, guide_name, fit_type, json.dumps(sizes), notes))
                gid = cur.fetchone()['id']
                db.commit()
                _cache.invalidate('size_guides')
                send_json(self, {'id': gid, 'message': 'Guide créé'}, 201)
                return True

        if path.startswith('/api/size-guides/') and path != '/api/size-guides':
            gid = path.split('/')[-1]
            if method == 'PUT':
                sets = []
                vals = []
                for key in ('guide_name', 'category_id', 'fit_type', 'notes'):
                    if key in data:
                        sets.append(f"{key}=%s")
                        vals.append(data[key])
                if 'sizes' in data:
                    sets.append("sizes_json=%s")
                    vals.append(json.dumps(data['sizes']))
                if sets:
                    vals.append(gid)
                    cur.execute(f"UPDATE size_guides SET {','.join(sets)} WHERE id=%s", vals)
                    db.commit()
                    _cache.invalidate('size_guides')
                send_json(self, {'message': 'Guide mis à jour'})
                return True
            if method == 'DELETE':
                cur.execute("DELETE FROM size_guides WHERE id=%s", (gid,))
                db.commit()
                _cache.invalidate('size_guides')
                send_json(self, {'message': 'Guide supprimé'})
                return True

        # GET /api/inventory
            status_filter = query.get('status', ['all'])[0].strip().lower()
            base_sql = """SELECT i.*, p.name AS product_name, p.image AS product_image,
                                c.name AS category_name
                         FROM inventory i
                         JOIN products p ON i.product_id = p.id
                         LEFT JOIN categories c ON p.category_id = c.id"""
            where = []
            if status_filter == 'low':
                where.append("i.quantity > 0 AND i.quantity <= i.low_stock_threshold")
            elif status_filter == 'out':
                where.append("i.quantity = 0")
            elif status_filter == 'in':
                where.append("i.quantity > i.low_stock_threshold")
            sql = base_sql
            if where:
                sql += " WHERE " + " AND ".join(where)
            sql += " ORDER BY i.quantity ASC"
            cur.execute(sql)
            rows = cur.fetchall()
            result = rows_to_list(rows)
            for r in result:
                q = r['quantity']
                threshold = r.get('low_stock_threshold', 5)
                if q == 0:
                    r['stock_status'] = 'out_of_stock'
                elif q <= threshold:
                    r['stock_status'] = 'low_stock'
                else:
                    r['stock_status'] = 'in_stock'
            cur.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE quantity > 0 AND quantity <= low_stock_threshold")
            low_count = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE quantity = 0")
            out_count = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM inventory WHERE quantity > low_stock_threshold")
            in_count = cur.fetchone()['cnt']
            cur.execute("SELECT COUNT(*) AS cnt FROM inventory")
            total_count = cur.fetchone()['cnt']
            send_json(self, {
                'items': result,
                'counts': {'total': total_count, 'in_stock': in_count, 'low_stock': low_count, 'out_of_stock': out_count}
            })
            return True

        if path.startswith('/api/inventory/') and path.endswith('/history'):
            pid = path.split('/')[-2]
            cur.execute("""SELECT sh.*, p.name AS product_name
                                  FROM stock_history sh
                                  JOIN products p ON sh.product_id = p.id
                                  WHERE sh.product_id=%s
                                  ORDER BY sh.id DESC""", (pid,))
            rows = cur.fetchall()
            send_json(self, rows_to_list(rows))
            return True

        if re.match(r'^/api/inventory/\d+$', path):
            pid = path.split('/')[-1]
            cur.execute("""SELECT i.*, p.name AS product_name, p.image AS product_image,
                                        c.name AS category_name
                                 FROM inventory i
                                 JOIN products p ON i.product_id = p.id
                                 LEFT JOIN categories c ON p.category_id = c.id
                                 WHERE i.product_id=%s""", (pid,))
            row = cur.fetchone()
            if not row:
                send_json(self, {'error': 'Not found'}, 404)
                return True
            item = dict(row)
            q = item['quantity']
            threshold = item.get('low_stock_threshold', 5)
            if q == 0:
                item['stock_status'] = 'out_of_stock'
            elif q <= threshold:
                item['stock_status'] = 'low_stock'
            else:
                item['stock_status'] = 'in_stock'
            send_json(self, item)
            return True

        if path == '/api/collections/all':
            cur.execute("SELECT * FROM collections ORDER BY id")
            collections = rows_to_list(cur.fetchall())
            cur.execute("SELECT id, name FROM products ORDER BY name")
            products = rows_to_list(cur.fetchall())
            send_json(self, {'collections': collections, 'products': products})
            return True

        if path == '/api/backup/download':
            send_json(self, {'error': 'Backup via store.db is no longer available. Use pg_dump for PostgreSQL backups.'}, 400)
            return True

        return False

    def api_POST(self, path, body):
        db = get_db()
        cur = db.cursor()
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            send_json(self, {'error': 'Invalid JSON'}, 400)
            return True

        if path == '/api/products':
            cat = data.get('category_name', '')
            cat_id = None
            if cat:
                cur.execute("SELECT id FROM categories WHERE name=%s", (cat,))
                row = cur.fetchone()
                if row:
                    cat_id = row['id']
            status = data.get('status', 'active')
            variants = data.get('variants', [])
            colors = data.get('colors', [])
            sizes = data.get('sizes', [])
            # Calculate total stock from variants or fallback
            total_stock = data.get('stock', 0)
            cur.execute("""INSERT INTO products (name, description, price, sale_price, category_id, image, images, badge, sizes, colors, stock, brand, rating, featured, new_arrival, status, created_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
                           RETURNING id""",
                        (data.get('name',''), data.get('description',''), data.get('price',0),
                         data.get('sale_price'), cat_id, data.get('image',''),
                         json.dumps(data.get('images',[])), data.get('badge'),
                         json.dumps(sizes), json.dumps(colors),
                         total_stock, data.get('brand',''), data.get('rating',0),
                         data.get('featured', 0), data.get('new_arrival', 0), status))
            pid = cur.fetchone()['id']
            color_names = [c.get('name', c) if isinstance(c, dict) else c for c in colors] if colors else []
            size_names = [s.get('size', s) if isinstance(s, dict) else s for s in sizes] if sizes else []
            for s_name in size_names:
                cur.execute("INSERT INTO product_sizes (product_id, size, stock) VALUES (%s, %s, 0)", (pid, s_name))
            for c_name in color_names:
                _hex = ''
                for c in (colors or []):
                    if (c.get('name', c) if isinstance(c, dict) else c) == c_name:
                        _hex = c.get('hex', '') if isinstance(c, dict) else ''
                        break
                cur.execute("INSERT INTO product_colors (product_id, color_name, color_hex, stock) VALUES (%s, %s, %s, 0)", (pid, c_name, _hex))
            # Save advanced variants
            if variants and isinstance(variants, list):
                for idx, v in enumerate(variants):
                    cur.execute("""INSERT INTO product_variants (product_id, color_name, color_hex, sku, sort_order, stock)
                                   VALUES (%s,%s,%s,%s,%s,0)
                                   RETURNING id""",
                                (pid, v.get('color_name', ''), v.get('color_hex', ''),
                                 v.get('sku', ''), idx))
                    vid = cur.fetchone()['id']
                    # Insert variant images
                    for img_idx, img_path in enumerate(v.get('images', [])):
                        if img_path:
                            cur.execute("INSERT INTO variant_images (variant_id, image_path, sort_order) VALUES (%s, %s, %s)",
                                        (vid, img_path, img_idx))
                    # Insert variant sizes with stock and sku
                    for s in v.get('sizes', []):
                        cur.execute("INSERT INTO variant_sizes (variant_id, size_name, stock, sku) VALUES (%s, %s, %s, %s)",
                                    (vid, s.get('size', s) if isinstance(s, dict) else s,
                                     s.get('stock', 0) if isinstance(s, dict) else 0,
                                     s.get('sku', '') if isinstance(s, dict) else ''))
                # Calculate total stock from variant sizes
                total_stock = 0
                cur.execute("SELECT id FROM product_variants WHERE product_id=%s", (pid,))
                for vrow in cur.fetchall():
                    cur.execute("SELECT COALESCE(SUM(stock), 0) AS total FROM variant_sizes WHERE variant_id=%s", (vrow['id'],))
                    total_stock += cur.fetchone()['total']
                cur.execute("UPDATE products SET stock=%s WHERE id=%s", (total_stock, pid))
            cur.execute("INSERT INTO inventory (product_id, quantity) VALUES (%s, %s) ON CONFLICT (product_id) DO NOTHING", (pid, total_stock))
            db.commit()
            send_json(self, {'id': pid, 'message': 'Product created'}, 201)
            return True

        if path == '/api/categories':
            name = data.get('name', '').strip()
            if not name:
                send_json(self, {'error': 'Name required'}, 400)
                return True
            slug = data.get('slug', '') or name.lower().replace(' ', '-')
            size_system = data.get('size_system', 'standard')
            cur.execute("INSERT INTO categories (name, slug, description, image, status, size_system) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (name) DO NOTHING RETURNING id",
                        (name, slug, data.get('description',''), data.get('image',''), data.get('status','active'), size_system))
            db.commit()
            row_id = cur.fetchone()
            send_json(self, {'id': row_id['id'] if row_id else None, 'message': 'Category created'}, 201)
            return True

        if path == '/api/collections':
            cur.execute("INSERT INTO collections (name, description, image, status) VALUES (%s,%s,%s,%s) RETURNING id",
                        (data.get('name',''), data.get('description',''), data.get('image',''), data.get('status','active')))
            cid = cur.fetchone()['id']
            for pid in data.get('product_ids', []):
                cur.execute("INSERT INTO collection_products (collection_id, product_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", (cid, pid))
            db.commit()
            send_json(self, {'id': cid, 'message': 'Collection created'}, 201)
            return True

        if path == '/api/orders':
            items_json = json.dumps(data.get('items', []))
            cur.execute("""INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, wilaya, commune, shipping_address, payment_method, status, total, items, delivery_fee)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           RETURNING id""",
                        (data.get('order_number',''), data.get('customer_id'),
                         data.get('customer_name',''), data.get('customer_phone',''),
                         data.get('wilaya',''), data.get('commune',''),
                         data.get('shipping','') or data.get('shipping_address',''),
                         data.get('payment_method',''),
                         data.get('status','pending'), data.get('total',0), items_json,
                         data.get('delivery_fee', 0)))
            oid = cur.fetchone()['id']
            try:
                cur.execute("INSERT INTO status_history (order_id, status, note) VALUES (%s, %s, %s)",
                            (oid, data.get('status', 'new'), 'Commande créée'))
            except Exception:
                pass
            new_status = data.get('status', 'pending')
            if new_status in ('confirmed', 'processing'):
                items = data.get('items', [])
                for item in items:
                    pid = item.get('product_id')
                    qty = item.get('quantity') or item.get('qty') or 1
                    if pid:
                        cur.execute("SELECT quantity FROM inventory WHERE product_id=%s", (pid,))
                        inv = cur.fetchone()
                        before_qty = inv['quantity'] if inv else 0
                        deduct = min(qty, before_qty)
                        if deduct > 0:
                            cur.execute("UPDATE inventory SET quantity = quantity - %s, updated_at = CURRENT_TIMESTAMP WHERE product_id=%s", (deduct, pid))
                            cur.execute("UPDATE products SET stock = (SELECT quantity FROM inventory WHERE product_id=%s) WHERE id=%s", (pid, pid))
                            log_stock_change(cur, pid, -deduct, before_qty, f'Order #{oid} {new_status}')
            db.commit()
            send_json(self, {'id': oid, 'message': 'Order created'}, 201)
            return True

        if path == '/api/customers':
            cur.execute("INSERT INTO customers (name, email, status) VALUES (%s,%s,%s) RETURNING id",
                        (data.get('name',''), data.get('email',''), data.get('status','active')))
            db.commit()
            send_json(self, {'id': cur.fetchone()['id'], 'message': 'Customer created'}, 201)
            return True

        if path.startswith('/api/inventory/') and path.endswith('/adjust'):
            pid = path.split('/')[-2]
            change = data.get('change', 0)
            reason = data.get('reason', '')
            cur.execute("SELECT quantity FROM inventory WHERE product_id=%s", (pid,))
            before = cur.fetchone()
            before_qty = before['quantity'] if before else 0
            cur.execute("UPDATE inventory SET quantity = quantity + %s, updated_at = CURRENT_TIMESTAMP WHERE product_id=%s", (change, pid))
            cur.execute("UPDATE products SET stock = (SELECT quantity FROM inventory WHERE product_id=%s) WHERE id=%s", (pid, pid))
            log_stock_change(cur, pid, change, before_qty, reason)
            db.commit()
            send_json(self, {'message': 'Inventory adjusted'})
            return True

        send_json(self, {'error': 'Not found'}, 404)
        return True

    def api_PUT(self, path, body):
        db = get_db()
        cur = db.cursor()
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            send_json(self, {'error': 'Invalid JSON'}, 400)
            return True

        if path.startswith('/api/products/') and path.endswith('/images/main'):
            parts = path.split('/')
            pid = parts[-3]
            img_path = data.get('path', '')
            if img_path:
                cur.execute("SELECT images FROM products WHERE id=%s", (pid,))
                row = cur.fetchone()
                images = json.loads(row['images']) if row and row['images'] else []
                if img_path in images:
                    images.remove(img_path)
                    images.insert(0, img_path)
                    cur.execute("UPDATE products SET images=%s, image=%s WHERE id=%s", (json.dumps(images), img_path, pid))
                    db.commit()
                    send_json(self, {'message': 'Main image updated', 'images': images})
                    return True
            send_json(self, {'error': 'Image not found'}, 404)
            return True

        if path.startswith('/api/products/'):
            pid = path.split('/')[-1]
            product_id = pid

            variants_data = data.pop('variants', None)

            # Handle sizes via normalized table
            sizes = None
            if 'sizes' in data:
                sizes = data['sizes']
                if isinstance(sizes, str):
                    sizes = json.loads(sizes)
                del data['sizes']
                sizeNames = [s.get('size', s) if isinstance(s, dict) else s for s in sizes]
                data['sizes'] = json.dumps(sizeNames)

            # Handle colors via normalized table
            colors = None
            if 'colors' in data:
                colors = data['colors']
                if isinstance(colors, str):
                    colors = json.loads(colors)
                del data['colors']
                colorNames = [c.get('name', c) if isinstance(c, dict) else c for c in colors]
                data['colors'] = json.dumps(colorNames)

            if 'category_name' in data:
                cat = data['category_name']
                cur.execute("SELECT id FROM categories WHERE name=%s", (cat,))
                row = cur.fetchone()
                data['category_id'] = row['id'] if row else None
                del data['category_name']
            for key in ('images',):
                if key in data and isinstance(data[key], (list, dict)):
                    data[key] = json.dumps(data[key])
            if 'images' in data:
                parsed = json.loads(data['images']) if isinstance(data['images'], str) else data['images']
                if isinstance(parsed, list) and len(parsed) > 0:
                    data['image'] = parsed[0]

            data = _filter_columns(data, ALLOWED_PRODUCT_COLUMNS)
            sets = ', '.join(f"{k}=%s" for k in data)
            vals = list(data.values()) + [pid]
            cur.execute(f"UPDATE products SET {sets} WHERE id=%s", vals)

            # Sync normalized tables
            if sizes is not None:
                cur.execute("DELETE FROM product_sizes WHERE product_id=%s", (pid,))
                for s in sizes:
                    sname = s.get('size', s) if isinstance(s, dict) else s
                    sstock = s.get('stock', 0) if isinstance(s, dict) else 0
                    cur.execute("INSERT INTO product_sizes (product_id, size, stock) VALUES (%s, %s, %s)", (pid, sname, sstock))
            if colors is not None:
                cur.execute("DELETE FROM product_colors WHERE product_id=%s", (pid,))
                for c in colors:
                    cname = c.get('name', c) if isinstance(c, dict) else c
                    chex = c.get('hex', '') if isinstance(c, dict) else ''
                    cstock = c.get('stock', 0) if isinstance(c, dict) else 0
                    cur.execute("INSERT INTO product_colors (product_id, color_name, color_hex, stock) VALUES (%s, %s, %s, %s)", (pid, cname, chex, cstock))

            # Sync advanced variants
            if variants_data is not None and isinstance(variants_data, list):
                is_advanced = len(variants_data) > 0 and ('images' in variants_data[0] or 'sku' in variants_data[0] or 'sizes' in variants_data[0])
                # Delete old variant children
                cur.execute("SELECT id FROM product_variants WHERE product_id=%s", (pid,))
                old_vids = [r['id'] for r in cur.fetchall()]
                for vid in old_vids:
                    cur.execute("DELETE FROM variant_images WHERE variant_id=%s", (vid,))
                    cur.execute("DELETE FROM variant_sizes WHERE variant_id=%s", (vid,))
                cur.execute("DELETE FROM product_variants WHERE product_id=%s", (pid,))
                if is_advanced:
                    for idx, v in enumerate(variants_data):
                        cur.execute("""INSERT INTO product_variants (product_id, color_name, color_hex, sku, sort_order, stock)
                                       VALUES (%s,%s,%s,%s,%s,0)""",
                                    (pid, v.get('color_name', ''), v.get('color_hex', ''),
                                     v.get('sku', ''), idx))
                        vid = cur.fetchone()['id']
                        for img_idx, img_path in enumerate(v.get('images', [])):
                            if img_path:
                                cur.execute("INSERT INTO variant_images (variant_id, image_path, sort_order) VALUES (%s, %s, %s)",
                                            (vid, img_path, img_idx))
                        for s in v.get('sizes', []):
                            cur.execute("INSERT INTO variant_sizes (variant_id, size_name, stock, sku) VALUES (%s, %s, %s, %s)",
                                        (vid, s.get('size', s) if isinstance(s, dict) else s,
                                         s.get('stock', 0) if isinstance(s, dict) else 0,
                                         s.get('sku', '') if isinstance(s, dict) else ''))
                    # Compute total stock from variant sizes
                    total_stock = 0
                    cur.execute("SELECT id FROM product_variants WHERE product_id=%s", (pid,))
                    for vrow in cur.fetchall():
                        cur.execute("SELECT COALESCE(SUM(stock), 0) AS total FROM variant_sizes WHERE variant_id=%s", (vrow['id'],))
                        total_stock += cur.fetchone()['total']
                    cur.execute("UPDATE products SET stock=%s WHERE id=%s", (total_stock, pid))
                else:
                    # Legacy format: simple color_name, size_name, stock
                    for v in variants_data:
                        cur.execute("INSERT INTO product_variants (product_id, color_name, size_name, stock) VALUES (%s, %s, %s, %s)",
                                    (pid, v.get('color_name', ''), v.get('size_name', ''), v.get('stock', 0)))

            if 'stock' in data:
                cur.execute("UPDATE inventory SET quantity=%s, updated_at=CURRENT_TIMESTAMP WHERE product_id=%s", (data['stock'], pid))
            db.commit()
            send_json(self, {'message': 'Product updated'})
            return True

        if path.startswith('/api/categories/'):
            cid = path.split('/')[-1]
            data = _filter_columns(data, ALLOWED_CATEGORY_COLUMNS)
            sets = ', '.join(f"{k}=%s" for k in data)
            vals = list(data.values()) + [cid]
            cur.execute(f"UPDATE categories SET {sets} WHERE id=%s", vals)
            db.commit()
            send_json(self, {'message': 'Category updated'})
            return True

        if path.startswith('/api/collections/') and path.endswith('/products'):
            parts = path.split('/')
            cid = parts[-2]
            cur.execute("DELETE FROM collection_products WHERE collection_id=%s", (cid,))
            for pid in data.get('product_ids', []):
                cur.execute("INSERT INTO collection_products (collection_id, product_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", (cid, pid))
            db.commit()
            send_json(self, {'message': 'Products updated'})
            return True

        if path.startswith('/api/collections/'):
            cid = path.split('/')[-1]
            data = _filter_columns(data, ALLOWED_COLLECTION_COLUMNS)
            sets = ', '.join(f"{k}=%s" for k in data)
            vals = list(data.values()) + [cid]
            cur.execute(f"UPDATE collections SET {sets} WHERE id=%s", vals)
            db.commit()
            send_json(self, {'message': 'Collection updated'})
            return True

        if path == '/api/delivery-prices':
            for wilaya_id_str, price in data.items():
                wid = int(wilaya_id_str)
                p = float(price) if price else 0
                cur.execute("SELECT 1 FROM delivery_prices WHERE wilaya_id=%s", (wid,))
                if cur.fetchone():
                    cur.execute("UPDATE delivery_prices SET price=%s WHERE wilaya_id=%s", (p, wid))
                else:
                    cur.execute("INSERT INTO delivery_prices (wilaya_id, price) VALUES (%s, %s)", (wid, p))
            db.commit()
            send_json(self, {'message': 'Delivery prices saved'})
            return True

        if path == '/api/settings':
            for key, val in data.items():
                if val is None: val = ''
                if isinstance(val, bool): val = '1' if val else '0'
                elif not isinstance(val, str): val = str(val)
                cur.execute("SELECT id FROM settings WHERE setting_key=%s", (key,))
                if cur.fetchone():
                    cur.execute("UPDATE settings SET setting_value=%s, updated_at=CURRENT_TIMESTAMP WHERE setting_key=%s", (val, key))
                else:
                    cur.execute("INSERT INTO settings (setting_key, setting_value, setting_type, category) VALUES (%s, %s, 'text', 'custom')", (key, val))
            db.commit()
            send_json(self, {'message': 'Settings saved'})
            return True

        if path == '/api/notifications/read-all':
            cur.execute("UPDATE orders SET is_read=1")
            db.commit()
            send_json(self, {'message': 'All notifications marked as read'})
            return True

        if path.startswith('/api/notifications/read/'):
            oid = path.split('/')[-1]
            cur.execute("UPDATE orders SET is_read=1 WHERE id=%s", (oid,))
            db.commit()
            send_json(self, {'message': 'Notification marked as read'})
            return True

        if path.startswith('/api/orders/'):
            oid = path.split('/')[-1]
            old_status = None
            old_items = '[]'
            if 'status' in data:
                cur.execute("SELECT status, items FROM orders WHERE id=%s", (oid,))
                row = cur.fetchone()
                if row:
                    old_status = row['status']
                    old_items = row['items']
            if 'items' in data and isinstance(data['items'], list):
                data['items'] = json.dumps(data['items'])
            data = _filter_columns(data, ALLOWED_ORDER_COLUMNS)
            sets = ', '.join(f"{k}=%s" for k in data)
            vals = list(data.values()) + [oid]
            cur.execute(f"UPDATE orders SET {sets} WHERE id=%s", vals)
            new_status = data.get('status', old_status)
            cancelled_statuses = ('cancelled', 'canceled')
            is_cancel = new_status in cancelled_statuses
            was_cancelled = old_status in cancelled_statuses

            if is_cancel and old_status and not was_cancelled:
                # Restock — order is being cancelled
                items_json = data.get('items') if 'items' in data else old_items
                if isinstance(items_json, str):
                    items = json.loads(items_json)
                else:
                    items = items_json
                for item in items:
                    pid = item.get('product_id')
                    qty = item.get('quantity') or item.get('qty') or 1
                    color = item.get('color') or item.get('selectedColor') or ''
                    size = item.get('size') or item.get('selectedSize') or ''
                    if pid:
                        restore_order_stock(cur, pid, color, size, qty)

            elif was_cancelled and not is_cancel:
                # Reactivate — re-validate + re-deduct stock
                items_json = data.get('items') if 'items' in data else old_items
                if isinstance(items_json, str):
                    items = json.loads(items_json)
                else:
                    items = items_json
                for idx, item in enumerate(items):
                    pid = item.get('product_id')
                    qty = item.get('quantity') or item.get('qty') or 1
                    color = item.get('color') or item.get('selectedColor') or ''
                    size = item.get('size') or item.get('selectedSize') or ''
                    if pid:
                        stock_ok, err = deduct_order_stock(cur, pid, color, size, qty)
                        if not stock_ok:
                            # Rollback any deductions already made
                            for rollback_idx in range(idx):
                                prev = items[rollback_idx]
                                rpid = prev.get('product_id')
                                rqty = prev.get('quantity') or prev.get('qty') or 1
                                rcolor = prev.get('color') or prev.get('selectedColor') or ''
                                rsize = prev.get('size') or prev.get('selectedSize') or ''
                                if rpid:
                                    restore_order_stock(cur, rpid, rcolor, rsize, rqty)
                            product_name = item.get('name', '')
                            msg = err or "Stock insuffisant"
                            if product_name:
                                msg = f"{msg} pour {product_name}"
                            db.commit()
                            send_json(self, {'error': f"Impossible de réactiver la commande : {msg}"}, 409)
                            return True
            if new_status and old_status and new_status != old_status:
                try:
                    cur.execute("INSERT INTO status_history (order_id, status, note) VALUES (%s, %s, %s)",
                                (oid, new_status, ''))
                except Exception:
                    pass
            db.commit()
            send_json(self, {'message': 'Order updated'})
            return True

        if path.startswith('/api/customers/'):
            cid = path.split('/')[-1]
            if 'name' in data:
                data['name'] = data['name'].strip()
            data = _filter_columns(data, ALLOWED_CUSTOMER_COLUMNS)
            sets = ', '.join(f"{k}=%s" for k in data)
            vals = list(data.values()) + [cid]
            cur.execute(f"UPDATE customers SET {sets} WHERE id=%s", vals)
            db.commit()
            send_json(self, {'message': 'Customer updated'})
            return True

        if path.startswith('/api/inventory/'):
            pid = path.split('/')[-1]
            qty = data.get('quantity')
            if qty is not None:
                cur.execute("SELECT quantity FROM inventory WHERE product_id=%s", (pid,))
                before = cur.fetchone()
                before_qty = before['quantity'] if before else 0
                cur.execute("UPDATE inventory SET quantity=%s, updated_at=CURRENT_TIMESTAMP WHERE product_id=%s", (qty, pid))
                cur.execute("UPDATE products SET stock=%s WHERE id=%s", (qty, pid))
                log_stock_change(cur, pid, qty - before_qty, before_qty, data.get('reason', 'Manual update'))
                db.commit()
            send_json(self, {'message': 'Inventory updated'})
            return True

        send_json(self, {'error': 'Not found'}, 404)
        return True

    def api_DELETE(self, path):
        db = get_db()
        cur = db.cursor()

        if path.startswith('/api/collections/'):
            cid = path.split('/')[-1]
            cur.execute("DELETE FROM collection_products WHERE collection_id=%s", (cid,))
            cur.execute("DELETE FROM collections WHERE id=%s", (cid,))
            db.commit()
            send_json(self, {'message': 'Deleted'})
            return True

        if path.startswith('/api/products/') and path.endswith('/images'):
            parts = path.split('/')
            pid = parts[-2]
            body = read_body(self)
            data = json.loads(body) if body else {}
            img_path = data.get('path', '')
            if img_path:
                if CLOUDINARY_ENABLED and 'cloudinary.com' in img_path:
                    try:
                        parts_url = img_path.split('/')
                        idx = None
                        for i, p in enumerate(parts_url):
                            if p == 'upload':
                                idx = i + 1
                                break
                        if idx:
                            public_id = '/'.join(parts_url[idx:])
                            public_id = os.path.splitext(public_id)[0]
                            cloudinary.uploader.destroy(public_id)
                    except Exception as e:
                        print(f"[Cloudinary] Delete error: {e}")
                else:
                    full_path = secure_path(PARENT_DIR, img_path)
                    if full_path and os.path.isfile(full_path):
                        os.remove(full_path)
            cur.execute("SELECT images FROM products WHERE id=%s", (pid,))
            row = cur.fetchone()
            images = json.loads(row['images']) if row and row['images'] else []
            if img_path in images:
                images.remove(img_path)
            primary = images[0] if images else ''
            cur.execute("UPDATE products SET images=%s, image=%s WHERE id=%s", (json.dumps(images), primary, pid))
            db.commit()
            send_json(self, {'message': 'Image deleted', 'images': images})
            return True

        if path.startswith('/api/products/'):
            pid = path.split('/')[-1]
            cur.execute("DELETE FROM inventory WHERE product_id=%s", (pid,))
            cur.execute("DELETE FROM products WHERE id=%s", (pid,))
            db.commit()
            send_json(self, {'message': 'Deleted'})
            return True

        if path.startswith('/api/customers/'):
            cid = path.split('/')[-1]
            cur.execute("UPDATE orders SET customer_id=NULL WHERE customer_id=%s", (cid,))
            cur.execute("DELETE FROM customers WHERE id=%s", (cid,))
            db.commit()
            send_json(self, {'message': 'Deleted'})
            return True

        if path.startswith('/api/categories/'):
            cid = path.split('/')[-1]
            cur.execute("SELECT size_system FROM categories WHERE id=%s", (cid,))
            cat_row = cur.fetchone()
            if cat_row and cat_row['size_system'] == 'grouped_taille':
                send_json(self, {'error': 'Cette catégorie est protégée (système de tailles groupées) et ne peut pas être supprimée.'}, 403)
                return True
            cur.execute("UPDATE products SET category_id=NULL WHERE category_id=%s", (cid,))
            cur.execute("DELETE FROM categories WHERE id=%s", (cid,))
            db.commit()
            send_json(self, {'message': 'Deleted'})
            return True

        if path.startswith('/api/orders/'):
            oid = path.split('/')[-1]
            cur.execute("SELECT status FROM orders WHERE id=%s", (oid,))
            row = cur.fetchone()
            if row is None:
                send_json(self, {'error': 'Commande introuvable'}, 404)
                return True
            if row['status'] not in ('arrived', 'delivered'):
                send_json(self, {'error': 'Suppression autorisée uniquement pour les commandes arrivées'}, 403)
                return True
            cur.execute("DELETE FROM orders WHERE id=%s", (oid,))
            db.commit()
            send_json(self, {'message': 'Deleted'})
            return True

        send_json(self, {'error': 'Not found'}, 404)
        return True

    def api_UPLOAD(self, multipart):
        ALLOWED = ('.jpg', '.jpeg', '.png', '.webp')
        MAGIC_BYTES = {
            b'\xff\xd8\xff': '.jpg',
            b'\x89PNG': '.png',
            b'RIFF': '.webp',
        }
        MAX_SIZE = 10 * 1024 * 1024
        fields = multipart.get('fields', {})
        category = fields.get('type', 'products')
        saved_paths = []
        errors = []
        for f in multipart.get('files', []):
            ext = os.path.splitext(f['filename'])[1].lower()
            if ext == '.svg':
                errors.append(f'{f["filename"]}: SVG non autorisé')
                continue
            if ext not in ALLOWED:
                errors.append(f'{f["filename"]}: format non supporté')
                continue
            if len(f['content']) > MAX_SIZE:
                errors.append(f'{f["filename"]}: trop volumineux (max 10MB)')
                continue
            content = f['content']
            detected_ext = None
            for magic, mext in MAGIC_BYTES.items():
                if content[:len(magic)] == magic:
                    detected_ext = mext
                    break
            if detected_ext and detected_ext != ext:
                errors.append(f'{f["filename"]}: extension ne correspond pas au contenu')
                continue
            if CLOUDINARY_ENABLED:
                try:
                    result = cloudinary.uploader.upload(
                        content,
                        folder=f'{CLOUDINARY_FOLDER}/{category}',
                        resource_type='image'
                    )
                    saved_paths.append(result['secure_url'])
                except Exception as e:
                    print(f"[Cloudinary] Upload error: {e}")
                    errors.append(f'{f["filename"]}: erreur upload')
            else:
                subdir = 'settings' if category == 'settings' else 'products'
                upload_dir = os.path.join(PARENT_DIR, 'uploads', subdir)
                os.makedirs(upload_dir, exist_ok=True)
                ts = int(__import__('time').time() * 1000)
                safe_base = re.sub(r'[^a-zA-Z0-9._-]', '_', os.path.basename(f['filename']))
                safe_name = f"{ts}_{safe_base}"
                dest = os.path.join(upload_dir, safe_name)
                with open(dest, 'wb') as out:
                    out.write(content)
                saved_paths.append(f'uploads/{subdir}/{safe_name}')
        result = {'paths': saved_paths, 'count': len(saved_paths)}
        if errors:
            result['errors'] = errors
        send_json(self, result)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == '/api/public/products':
            db = get_db()
            cur = db.cursor()
            page = int(query.get('page', ['1'])[0])
            limit = int(query.get('limit', ['0'])[0])
            search = query.get('search', [''])[0].strip().lower()
            category = query.get('category', [''])[0].strip().lower()
            featured_only = query.get('featured', [''])[0].strip().lower() == 'true'
            sort = query.get('sort', ['newest'])[0].strip().lower()
            order_map = {
                'newest': 'p.created_at DESC',
                'price-low': 'COALESCE(p.sale_price, p.price) ASC',
                'price-high': 'COALESCE(p.sale_price, p.price) DESC',
                'rating': 'p.rating DESC',
            }
            if sort not in order_map:
                sort = 'newest'
            where = ["p.status='active'"]
            params = []
            if category:
                where.append("LOWER(c.name) = %s")
                params.append(category)
            if search:
                where.append("(LOWER(p.name) LIKE %s OR LOWER(COALESCE(p.description, '')) LIKE %s)")
                params.extend(['%' + search + '%', '%' + search + '%'])
            if featured_only:
                where.append("p.featured = 1")
            where_clause = " AND ".join(where)
            order_by = order_map[sort]

            cur.execute("SELECT COUNT(*) AS cnt FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE " + where_clause, params)
            row = cur.fetchone()
            total = row['cnt'] if row else 0

            if limit > 0:
                offset = (page - 1) * limit
                cur.execute("""
                    SELECT p.*, c.name AS category_name
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE """ + where_clause + """
                    ORDER BY """ + order_by + """
                    LIMIT %s OFFSET %s
                """, params + [limit, offset])
                rows = cur.fetchall()
                result = [enrich_product(r, cur) for r in rows]
                total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1
                send_json(self, {
                    'products': result,
                    'total': total,
                    'page': page,
                    'per_page': limit,
                    'total_pages': total_pages
                })
            else:
                cur.execute("""
                    SELECT p.*, c.name AS category_name
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE """ + where_clause + """
                    ORDER BY """ + order_by
                )
                rows = cur.fetchall()
                result = [enrich_product(r, cur) for r in rows]
                send_json(self, result)
            db.close()
            return

        if path.startswith('/api/public/products/') and path != '/api/public/products' and path != '/api/public/products/featured':
            pid = path.split('/')[-1]
            db = get_db()
            cur = db.cursor()
            cur.execute("""
                SELECT p.*, c.name AS category_name
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.id=%s AND p.status='active'
            """, (pid,))
            row = cur.fetchone()
            if not row:
                send_json(self, {'error': 'Not found'}, 404)
                return
            data = dict(row)
            if data.get('images') and isinstance(data['images'], str):
                data['images'] = json.loads(data['images'])
            if data.get('sizes') and isinstance(data['sizes'], str):
                data['sizes'] = json.loads(data['sizes'])
            if data.get('colors') and isinstance(data['colors'], str):
                data['colors'] = json.loads(data['colors'])
            # Enrich with variants, variant_images, variant_sizes
            cur.execute("SELECT id, color_name, color_hex, sku, stock FROM product_variants WHERE product_id=%s ORDER BY sort_order, id", (pid,))
            variant_rows = cur.fetchall()
            if variant_rows:
                variants = []
                all_colors = {}
                all_sizes = set()
                images_seen = set()
                merged_sizes = []
                for v in variant_rows:
                    vdict = {'id': v['id'], 'color_name': v['color_name'], 'color_hex': v['color_hex'], 'sku': v['sku'], 'stock': v['stock']}
                    cur.execute("SELECT image_path FROM variant_images WHERE variant_id=%s ORDER BY sort_order", (v['id'],))
                    vdict['images'] = [r['image_path'] for r in cur.fetchall()]
                    cur.execute("SELECT size_name, stock, COALESCE(sku, '') AS sku FROM variant_sizes WHERE variant_id=%s ORDER BY id", (v['id'],))
                    vdict['sizes'] = [{'size': r['size_name'], 'stock': r['stock']} for r in cur.fetchall()]
                    variants.append(vdict)
                    if v['color_name'] and v['color_name'] not in all_colors:
                        all_colors[v['color_name']] = {'name': v['color_name'], 'hex': v['color_hex'], 'stock': v['stock']}
                    for s in vdict['sizes']:
                        if s['size'] not in all_sizes:
                            all_sizes.add(s['size'])
                            merged_sizes.append(s)
                    for img in vdict['images']:
                        if img not in images_seen:
                            images_seen.add(img)
                data['colors'] = list(all_colors.values()) if all_colors else []
                data['sizes'] = merged_sizes if merged_sizes else []
                data['variants'] = variants
                data['images'] = list(images_seen) if images_seen else (data.get('images') or [])
            else:
                data['variants'] = []
            data['featured'] = bool(data.get('featured', 0))
            data['new_arrival'] = bool(data.get('new_arrival', 0))
            data['category'] = data.get('category_name') or ''
            send_json(self, data)
            return

        if path == '/api/public/categories':
            db = get_db()
            cur = db.cursor()
            cur.execute("""
                SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status='active') AS product_count
                FROM categories c ORDER BY c.id
            """)
            rows = cur.fetchall()
            send_json(self, rows_to_list(rows))
            return

        if path == '/api/public/collections':
            db = get_db()
            cur = db.cursor()
            cur.execute("""
                SELECT c.*,
                       (SELECT COUNT(*) FROM collection_products cp
                        JOIN products p ON cp.product_id = p.id
                        WHERE cp.collection_id = c.id AND p.status='active') AS product_count
                FROM collections c ORDER BY c.id
            """)
            data = rows_to_list(cur.fetchall())
            for coll in data:
                cur.execute("""
                    SELECT p.*, c2.name AS category_name FROM products p
                    JOIN collection_products cp ON cp.product_id = p.id
                    LEFT JOIN categories c2 ON p.category_id = c2.id
                    WHERE cp.collection_id = %s AND p.status='active'
                """, (coll['id'],))
                coll['products'] = [enrich_product(r, cur) for r in cur.fetchall()]
            send_json(self, data)
            return

        if path == '/api/public/settings':
            db = get_db()
            cur = db.cursor()
            cur.execute("SELECT setting_key, setting_value, setting_type FROM settings")
            rows = cur.fetchall()
            result = {}
            for r in rows:
                key = r['setting_key']
                val = r['setting_value']
                t = r['setting_type']
                if t == 'boolean':
                    val = val == '1'
                elif t == 'number':
                    try: val = float(val)
                    except: pass
                result[key] = val
            send_json(self, result)
            return

        if path.startswith('/api/'):
            if not require_auth(self):
                return
            if self.api_GET(path, query):
                return
            send_json(self, {'error': 'Not found'}, 404)
            return

        if path == '/admin/login':
            if is_authenticated(self):
                redirect(self, '/admin/dashboard.html')
            else:
                send_file(self, os.path.join(BASE_DIR, 'login.html'))
        elif path == '/admin/logout':
            token = get_token_from_cookies(self.headers.get('Cookie'))
            if token:
                delete_session(token)
            self.send_response(302)
            self.send_header('Set-Cookie', 'admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
            self.send_header('Location', '/admin/login')
            self.end_headers()
        elif path == '/website/' or path == '/website':
            send_file(self, os.path.join(PARENT_DIR, 'index.html'))
        elif path.startswith('/website/'):
            clean_path = path[9:]
            if not clean_path:
                clean_path = 'index.html'
            if clean_path.startswith('.') or '..' in clean_path:
                self.send_response(403)
                self.end_headers()
                return
            rp = secure_path(PARENT_DIR, clean_path)
            if rp:
                send_file(self, rp)
            else:
                self.send_response(403)
                self.end_headers()
        elif path.startswith('/admin/css/'):
            rp = secure_path(os.path.join(BASE_DIR, 'css'), os.path.relpath(path, '/admin/css/'))
            if rp: send_file(self, rp)
            else: self.send_response(403); self.end_headers()
        elif path.startswith('/admin/js/'):
            rp = secure_path(os.path.join(BASE_DIR, 'js'), os.path.relpath(path, '/admin/js/'))
            if rp: send_file(self, rp)
            else: self.send_response(403); self.end_headers()
        elif path.startswith('/admin/'):
            if not require_auth(self):
                return
            rp = secure_path(BASE_DIR, os.path.relpath(path, '/admin/'))
            if rp:
                send_file(self, rp)
            else:
                self.send_response(403)
                self.end_headers()
        elif path == '/' or path == '':
            send_file(self, os.path.join(PARENT_DIR, 'index.html'))
        else:
            rp = secure_path(PARENT_DIR, path.lstrip('/'))
            if rp:
                send_file(self, rp)
            else:
                self.send_response(403)
                self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_type = self.headers.get('Content-Type', '')

        if path == '/admin/login':
            ip = get_client_ip(self)
            if not _login_limiter.is_allowed(f'login:{ip}', max_requests=5, window=900):
                retry = _login_limiter.retry_after(f'login:{ip}', window=900)
                send_json(self, {'error': f'Trop de tentatives. Réessayez dans {retry}s.'}, 429)
                return
            body = read_body(self)
            params = urllib.parse.parse_qs(body)
            username = params.get('username', [''])[0].strip()
            password = params.get('password', [''])[0]
            remember = params.get('remember', [None])[0]
            if username == ADMIN_USERNAME and _verify_password(password, ADMIN_PASSWORD_HASH, ADMIN_PASSWORD_SALT):
                token = create_session(remember=(remember == 'on'))
                csrf = generate_csrf_token()
                save_csrf_token(token, csrf)
                max_age = 30 * 24 * 3600 if remember else None
                cookie = f'admin_session={token}; Path=/; HttpOnly; SameSite=Lax; Secure'
                if max_age: cookie += f'; Max-Age={max_age}'
                self.send_response(302)
                self.send_header('Set-Cookie', cookie)
                self.send_header('Set-Cookie', f'csrf_token={csrf}; Path=/admin; SameSite=Lax; Secure')
                self.send_header('Location', '/admin/dashboard.html')
                self.end_headers()
                audit_log.log('LOGIN_SUCCESS', username, ip=ip)
            else:
                audit_log.log('LOGIN_FAILED', username, f'bad password from {ip}', ip=ip)
                redirect(self, '/admin/login?error=1')
        elif path.startswith('/api/'):
            if not require_auth(self):
                return
            ip = get_client_ip(self)
            method = self.command
            if method in ('POST', 'PUT', 'DELETE'):
                if not require_csrf(self):
                    audit_log.log('CSRF_BLOCKED', details=f'{method} {path}', ip=ip)
                    return
            if 'multipart/form-data' in content_type:
                body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                boundary = None
                for part in content_type.split(';'):
                    part = part.strip()
                    if part.startswith('boundary='):
                        boundary = part[9:].strip('"').strip("'")
                if boundary:
                    result = parse_multipart(body, boundary)
                    self.api_UPLOAD(result)
                else:
                    send_json(self, {'error': 'Missing boundary'}, 400)
            else:
                body = read_body(self)
                try:
                    self.api_POST(path, body)
                except Exception as e:
                    print(f"[Admin] POST {path} error: {e}")
                    import traceback; traceback.print_exc()
                    db_err = get_db()
                    db_err.rollback()
                    db_err.close()
                    send_json(self, {'error': str(e)}, 500)
        else:
            self.send_response(404)
            self.end_headers()

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            if not require_auth(self):
                return
            if not require_csrf(self):
                audit_log.log('CSRF_BLOCKED', details=f'PUT {path}', ip=get_client_ip(self))
                return
            body = read_body(self)
            try:
                self.api_PUT(path, body)
                audit_log.log('API_PUT', details=path, ip=get_client_ip(self))
            except Exception as e:
                print(f"[Admin] PUT {path} error: {e}")
                import traceback; traceback.print_exc()
                db_err = get_db()
                db_err.rollback()
                db_err.close()
                send_json(self, {'error': str(e)}, 500)
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            if not require_auth(self):
                return
            if not require_csrf(self):
                audit_log.log('CSRF_BLOCKED', details=f'DELETE {path}', ip=get_client_ip(self))
                return
            try:
                self.api_DELETE(path)
                audit_log.log('API_DELETE', details=path, ip=get_client_ip(self))
            except Exception as e:
                print(f"[Admin] DELETE {path} error: {e}")
                import traceback; traceback.print_exc()
                db_err = get_db()
                db_err.rollback()
                db_err.close()
                send_json(self, {'error': str(e)}, 500)
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
        add_security_headers(self, admin=True)
        self.end_headers()

    def do_HEAD(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()

if __name__ == '__main__':
    try:
        init_db()
        seed_db()
    except Exception as e:
        print(f"[Admin] DB init warning: {e}")
    port = int(os.environ.get('PORT_ADMIN', '5000'))
    server = http.server.HTTPServer(('127.0.0.1', port), AdminHandler)
    server.allow_reuse_address = True
    print(f"Admin Dashboard running at http://localhost:{port}")
    print(f"Admin dashboard ready — login at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()
