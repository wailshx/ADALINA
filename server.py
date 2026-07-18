from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
import json
import os
import subprocess
import urllib.parse
import time
import logging
import threading
import datetime
import random
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

def get_build_version():
    try:
        r = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'],
                           capture_output=True, text=True, cwd=str(BASE_DIR), timeout=3)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    h = 0
    for f in ('css/styles.css', 'js/script.js'):
        try: h = (h * 31 + int(os.path.getmtime(BASE_DIR / f))) & 0xFFFFFFFF
        except Exception: pass
    return format(h, 'x')[-8:]

BUILD_VERSION = get_build_version()

import sys
sys.path.insert(0, str(BASE_DIR))
from config.database import get_db, get_public_db
from config.security import RateLimiter, add_security_headers, get_client_ip, escape_html
try:
    from admin.database import deduct_order_stock
except ImportError:
    def deduct_order_stock(cur, pid, color, size, qty): return (False, "Stock system unavailable")

logger = logging.getLogger('adalina')

_order_limiter = RateLimiter()
_cleanup_counter = 0

class _Cache:
    def __init__(self):
        self._store = {}
        self._signal_file = BASE_DIR / '.cache_invalidate'
        self._last_signal_check = 0
    def get(self, key, ttl=60):
        self._check_signal()
        entry = self._store.get(key)
        if entry and time.time() - entry[1] < ttl:
            return entry[0]
        return None
    def set(self, key, value):
        self._store[key] = (value, time.time())
    def invalidate(self, prefix=''):
        if not prefix:
            self._store.clear()
        else:
            self._store = {k: v for k, v in self._store.items() if not k.startswith(prefix)}
    def _check_signal(self):
        now = time.time()
        if now - self._last_signal_check < 5:
            return
        self._last_signal_check = now
        try:
            if self._signal_file.exists():
                mtime = self._signal_file.stat().st_mtime
                if mtime > self._store.get('__signal_time', (0, 0))[1]:
                    self._store.clear()
                    self._store['__signal_time'] = (True, mtime)
        except Exception:
            pass

_cache = _Cache()


def init_database():
    try:
        from admin.database import init_db, seed_db
        init_db()
        seed_db()
        print('✓ Database initialized and seeded')
    except Exception as e:
        print(f'! Database init warning: {e}')

def rows_to_list(rows):
    return [dict(r) for r in rows]

def row_to_dict(row):
    return dict(row) if row else None

CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://adalina-v2.onrender.com')

def send_json(handler, data, status=200):
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
    handler.send_header('Cache-Control', 'no-store, must-revalidate')
    add_security_headers(handler)
    handler.end_headers()
    handler.wfile.write(json.dumps(data, default=str, ensure_ascii=False).encode('utf-8'))

def send_json_cached(handler, data, max_age=60, status=200):
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
    handler.send_header('Cache-Control', f'public, max-age={max_age}')
    add_security_headers(handler)
    handler.end_headers()
    handler.wfile.write(json.dumps(data, default=str, ensure_ascii=False).encode('utf-8'))

def format_product(row, cur=None):
    p = dict(row)
    if p.get('images') is None:
        p['images'] = []
    elif isinstance(p['images'], str):
        p['images'] = json.loads(p['images'])
    if cur:
        cur.execute("""
            SELECT id, color_name, color_hex, sku, stock FROM product_variants
            WHERE product_id=%s ORDER BY sort_order, id
        """, (p['id'],))
        variant_rows = cur.fetchall()
        if variant_rows:
            variants = []
            all_colors = {}
            all_sizes = set()
            images_seen = set()
            merged_sizes = []
            v_ids = [v['id'] for v in variant_rows]
            cur.execute("SELECT variant_id, image_path FROM variant_images WHERE variant_id=ANY(%s) ORDER BY sort_order", (v_ids,))
            vi_rows = cur.fetchall()
            vi_map = {}
            for vi in vi_rows:
                vi_map.setdefault(vi['variant_id'], []).append(vi['image_path'])
            cur.execute("SELECT variant_id, size_name, stock, COALESCE(sku, '') AS sku FROM variant_sizes WHERE variant_id=ANY(%s) ORDER BY id", (v_ids,))
            vs_rows = cur.fetchall()
            vs_map = {}
            for vs in vs_rows:
                vs_map.setdefault(vs['variant_id'], []).append(vs)
            for v in variant_rows:
                v_images = vi_map.get(v['id'], [])
                v_sizes = [{'size': s['size_name'], 'stock': s['stock'], 'sku': s['sku']} for s in vs_map.get(v['id'], [])]
                vdict = {'id': v['id'], 'color_name': v['color_name'], 'color_hex': v['color_hex'], 'sku': v['sku'], 'stock': v['stock'], 'images': v_images, 'sizes': v_sizes}
                variants.append(vdict)
                if v['color_name'] and v['color_name'] not in all_colors:
                    all_colors[v['color_name']] = {'name': v['color_name'], 'hex': v['color_hex'], 'stock': v['stock']}
                for s in v_sizes:
                    if s['size'] not in all_sizes:
                        all_sizes.add(s['size'])
                        merged_sizes.append(s)
                for img in v_images:
                    if img not in images_seen:
                        images_seen.add(img)
            p['colors'] = list(all_colors.values()) if all_colors else []
            p['sizes'] = merged_sizes if merged_sizes else []
            p['variants'] = variants
            p['images'] = list(images_seen) if images_seen else (p.get('images') or [])
        else:
            cur.execute("SELECT color_name, color_hex, stock FROM product_colors WHERE product_id=%s ORDER BY id", (p['id'],))
            p['colors'] = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT size, stock FROM product_sizes WHERE product_id=%s ORDER BY id", (p['id'],))
            p['sizes'] = [{'size': r['size'], 'stock': r['stock']} for r in cur.fetchall()]
            cur.execute("SELECT color_name, size_name, stock FROM product_variants WHERE product_id=%s ORDER BY id", (p['id'],))
            p['variants'] = [dict(r) for r in cur.fetchall()]
    p['featured'] = bool(p.get('featured', 0))
    p['new_arrival'] = bool(p.get('new_arrival', 0))
    p['category'] = p.get('category_name') or ''
    p['category_size_system'] = p.get('category_size_system') or 'standard'
    return p

def batch_format_products(rows, cur):
    if not rows:
        return []
    product_ids = [dict(r)['id'] for r in rows]
    cur.execute("""
        SELECT pv.id, pv.product_id, pv.color_name, pv.color_hex, pv.sku, pv.stock,
               vi.image_path, vs.size_name, vs.stock AS vs_stock, COALESCE(vs.sku, '') AS vs_sku
        FROM product_variants pv
        LEFT JOIN variant_images vi ON pv.id = vi.variant_id
        LEFT JOIN variant_sizes vs ON pv.id = vs.variant_id
        WHERE pv.product_id = ANY(%s)
        ORDER BY pv.sort_order, pv.id, vi.sort_order, vs.id
    """, (product_ids,))
    all_rows = cur.fetchall()

    pv_data = {}
    vi_set = {}
    vs_map = {}
    for r in all_rows:
        d = dict(r)
        vid = d['id']
        if vid not in pv_data:
            pv_data[vid] = d
        if d['image_path']:
            vi_set.setdefault(vid, set()).add(d['image_path'])
        if d['size_name']:
            vs_map.setdefault(vid, {})[d['size_name']] = {'size_name': d['size_name'], 'stock': d['vs_stock'], 'sku': d['vs_sku']}

    product_variants = {}
    for vid, d in pv_data.items():
        product_variants.setdefault(d['product_id'], []).append((vid, d))

    result = []
    for r in rows:
        p = dict(r)
        if p.get('images') is None:
            p['images'] = []
        elif isinstance(p['images'], str):
            p['images'] = json.loads(p['images'])
        pid = p['id']
        variant_entries = product_variants.get(pid, [])
        if variant_entries:
            variants = []
            all_colors = {}
            all_sizes = set()
            images_seen = set()
            merged_sizes = []
            for vid, v in variant_entries:
                v_images = list(vi_set.get(vid, []))
                v_sizes = [{'size': s['size_name'], 'stock': s['stock'], 'sku': s['sku']} for s in vs_map.get(vid, {}).values()]
                vdict = {'id': vid, 'color_name': v['color_name'], 'color_hex': v['color_hex'], 'sku': v['sku'], 'stock': v['stock'], 'images': v_images, 'sizes': v_sizes}
                variants.append(vdict)
                if v['color_name'] and v['color_name'] not in all_colors:
                    all_colors[v['color_name']] = {'name': v['color_name'], 'hex': v['color_hex'], 'stock': v['stock']}
                for s in v_sizes:
                    if s['size'] not in all_sizes:
                        all_sizes.add(s['size'])
                        merged_sizes.append({'size': s['size'], 'stock': s['stock'], 'sku': s['sku']})
                for img in v_images:
                    if img not in images_seen:
                        images_seen.add(img)
            p['colors'] = list(all_colors.values()) if all_colors else []
            p['sizes'] = merged_sizes if merged_sizes else []
            p['variants'] = variants
            p['images'] = list(images_seen) if images_seen else (p.get('images') or [])
        else:
            p['colors'] = []
            p['sizes'] = []
            p['variants'] = []
        p['featured'] = bool(p.get('featured', 0))
        p['new_arrival'] = bool(p.get('new_arrival', 0))
        p['category'] = p.get('category_name') or ''
        p['category_size_system'] = p.get('category_size_system') or 'standard'
        result.append(p)
    return result

MAX_REQUEST_SIZE = 1 * 1024 * 1024  # 1 MB for JSON requests

def _process_order_background(order_number, items, customer_name, customer_phone, wilaya, data):
    db = None
    try:
        db = get_public_db()
        cur = db.cursor()

        commune = (data.get('commune') or '').strip()
        shipping = data.get('shipping', '')
        shipping_address = f"Name: {customer_name}, Phone: {customer_phone}, Address: {shipping}"
        payment = data.get('payment_method', 'Cash on Delivery')

        server_total = 0
        product_ids = [item.get('product_id') for item in items]
        if product_ids:
            placeholders = ','.join(['%s'] * len(product_ids))
            cur.execute(f"SELECT id, price, sale_price FROM products WHERE id IN ({placeholders})", product_ids)
            price_map = {r['id']: r for r in cur.fetchall()}
        for item in items:
            pid = item.get('product_id')
            qty = item.get('quantity') or 1
            color = item.get('color') or item.get('selectedColor') or ''
            size = item.get('size') or item.get('selectedSize') or ''

            prod = price_map.get(pid)
            if not prod:
                db.rollback()
                logger.error(f'Order {order_number}: product {pid} not found')
                return
            unit_price = prod['sale_price'] if prod['sale_price'] else prod['price']
            server_total += (unit_price or 0) * qty

            ok, err = deduct_order_stock(cur, pid, color, size, qty)
            if not ok:
                db.rollback()
                logger.error(f'Order {order_number}: stock deduction failed for {pid}: {err}')
                return

        delivery_fee = 0
        wid = data.get('wilaya_id')
        if wid is not None:
            try:
                wid = int(wid)
                cur.execute("SELECT price FROM delivery_prices WHERE wilaya_id=%s", (wid,))
                dp = cur.fetchone()
                if dp:
                    delivery_fee = dp['price']
            except (ValueError, TypeError):
                pass

        cur.execute("""
            INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, wilaya, commune, status, total, items, shipping_address, payment_method, delivery_fee)
            VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (order_number, customer_name, customer_phone, wilaya, commune, 'new', server_total, json.dumps(items), shipping_address, payment, delivery_fee))

        oid = cur.fetchone()['id']
        cur.execute("INSERT INTO status_history (order_id, status, note) VALUES (%s, %s, %s)",
                    (oid, 'new', 'Commande créée'))
        db.commit()
        _cache.invalidate('products')
        _cache.invalidate('featured')
        logger.info(f'Order {order_number} created (id={oid})')
    except Exception as e:
        logger.exception(f'Background order {order_number} failed')
        if db:
            try:
                db.rollback()
            except Exception:
                pass
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass

class AdalinaServer(SimpleHTTPRequestHandler):
    STATIC_EXTS = ('.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf')
    HTML_EXTS = ('.html',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except Exception as err:
            print("!!! SERVER REQUEST CRASH !!!")
            import traceback; traceback.print_exc()
            try:
                send_json(self, {'success': False, 'error': f'Server Error: {str(err)}'}, 500)
            except Exception:
                pass

    def send_response(self, code, message=None):
        super().send_response(code, message)
        path = getattr(self, 'path', '').split('?')[0].lower()
        if any(path.endswith(ext) for ext in self.STATIC_EXTS):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        elif any(path.endswith(ext) for ext in self.HTML_EXTS) or path in ('/', ''):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')

    def _serve_html(self, rel_path):
        file_path = BASE_DIR / rel_path.lstrip('/')
        if not file_path.exists():
            self.send_error(404, 'Not found')
            return
        content = file_path.read_bytes()
        content = content.replace(b'?v=__BUILD__', ('?v=' + BUILD_VERSION).encode())
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        add_security_headers(self)
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        global _cleanup_counter
        _cleanup_counter += 1
        if _cleanup_counter % 100 == 0:
            _order_limiter.cleanup()
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == '/api/health':
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute('SELECT 1')
                cur.fetchone()
                send_json(self, {'status': 'ok', 'database': 'connected'})
            except Exception as e:
                logger.error(f'Health check DB error: {e}')
                send_json(self, {'status': 'error', 'database': str(e)}, 503)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/products — list all products (with optional pagination + sort)
        if path == '/api/public/products':
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                page = int(query.get('page', ['1'])[0])
                limit = int(query.get('limit', ['0'])[0])
                search = query.get('search', [''])[0].strip().lower()
                category = query.get('category', [''])[0].strip().lower()
                featured_only = query.get('featured', [''])[0].strip().lower() == 'true'
                sort = query.get('sort', ['newest'])[0].strip().lower()
                collection = query.get('collection', [''])[0].strip()
                color = query.get('color', [''])[0].strip().lower()
                size = query.get('size', [''])[0].strip()
                price_min = query.get('price_min', [''])[0].strip()
                price_max = query.get('price_max', [''])[0].strip()
                new_arrival = query.get('new_arrival', [''])[0].strip().lower() == 'true'
                in_stock = query.get('in_stock', [''])[0].strip().lower() == 'true'

                joins = ["LEFT JOIN categories c ON p.category_id = c.id"]
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
                if collection:
                    joins.append("JOIN collection_products cp ON p.id = cp.product_id")
                    joins.append("JOIN collections co ON cp.collection_id = co.id")
                    where.append("LOWER(co.name) = %s")
                    params.append(collection.lower())
                if color:
                    where.append("EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND LOWER(pv.color_name) = %s)")
                    params.append(color)
                if size:
                    where.append("EXISTS (SELECT 1 FROM product_variants pv2 JOIN variant_sizes vs ON pv2.id = vs.variant_id WHERE pv2.product_id = p.id AND vs.size_name = %s)")
                    params.append(size)
                if price_min:
                    try:
                        where.append("COALESCE(p.sale_price, p.price) >= %s")
                        params.append(float(price_min))
                    except ValueError:
                        pass
                if price_max:
                    try:
                        where.append("COALESCE(p.sale_price, p.price) <= %s")
                        params.append(float(price_max))
                    except ValueError:
                        pass
                if new_arrival:
                    where.append("p.new_arrival = 1")
                if in_stock:
                    where.append("EXISTS (SELECT 1 FROM product_variants pv3 JOIN variant_sizes vs3 ON pv3.id = vs3.variant_id WHERE pv3.product_id = p.id AND vs3.stock > 0)")
                where_clause = " AND ".join(where)
                join_clause = " ".join(joins)

                order_map = {
                    'newest': 'p.created_at DESC',
                    'price-low': 'COALESCE(p.sale_price, p.price) ASC',
                    'price-high': 'COALESCE(p.sale_price, p.price) DESC',
                    'rating': 'p.rating DESC',
                    'featured': 'p.rating DESC',
                }
                if sort not in order_map:
                    sort = 'newest'
                order_by = order_map[sort]

                cur.execute("SELECT COUNT(DISTINCT p.id) AS cnt FROM products p " + join_clause + " WHERE " + where_clause, params)
                row = cur.fetchone()
                total = row['cnt'] if row else 0

                if limit > 0:
                    offset = (page - 1) * limit
                    cur.execute("""
                        SELECT DISTINCT p.id, p.name, p.description, p.price, p.sale_price,
                               p.category_id, p.image, p.images, p.badge, p.sizes, p.colors,
                               p.stock, p.brand, p.rating, p.status, p.featured, p.new_arrival,
                               p.created_at,
                               c.name AS category_name, c.size_system AS category_size_system
                        FROM products p
                        """ + join_clause + """
                        WHERE """ + where_clause + """
                        ORDER BY """ + order_by + """
                        LIMIT %s OFFSET %s
                    """, params + [limit, offset])
                    rows = cur.fetchall()
                    result = batch_format_products(rows, cur)
                    total_pages = max(1, (total + limit - 1) // limit) if total > 0 else 1
                    response = {
                        'products': result,
                        'total': total,
                        'page': page,
                        'per_page': limit,
                        'total_pages': total_pages
                    }
                    use_cache = not (search or color or size or price_min or price_max or new_arrival or in_stock)
                    if use_cache:
                        send_json_cached(self, response, max_age=30)
                    else:
                        send_json(self, response)
                else:
                    use_cache = not (search or category or collection or color or size or price_min or price_max or new_arrival or in_stock or featured_only)
                    cache_key = 'all_products'
                    if use_cache:
                        cached = _cache.get(cache_key, ttl=60)
                        if cached is not None:
                            send_json_cached(self, cached, max_age=60)
                            return
                    cur.execute("""
                        SELECT DISTINCT p.id, p.name, p.description, p.price, p.sale_price,
                               p.category_id, p.image, p.images, p.badge, p.sizes, p.colors,
                               p.stock, p.brand, p.rating, p.status, p.featured, p.new_arrival,
                               p.created_at,
                               c.name AS category_name, c.size_system AS category_size_system
                        FROM products p
                        """ + join_clause + """
                        WHERE """ + where_clause + """
                        ORDER BY """ + order_by, params
                    )
                    rows = cur.fetchall()
                    result = batch_format_products(rows, cur)
                    if use_cache:
                        _cache.set(cache_key, result)
                    send_json_cached(self, result, max_age=60)
            except Exception as e:
                logger.exception(f'[Server] Error loading products')
                send_json(self, {'error': 'Erreur lors du chargement des produits'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/products/featured — featured products
        if path == '/api/public/products/featured':
            cached = _cache.get('featured', ttl=300)
            if cached is not None:
                send_json_cached(self, cached, max_age=300)
                return
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT p.id, p.name, p.description, p.price, p.sale_price, p.category_id,
                           p.image, p.images, p.badge, p.sizes, p.colors, p.stock, p.brand,
                           p.rating, p.status, p.featured, p.new_arrival, p.created_at,
                           c.name AS category_name, c.size_system AS category_size_system
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.status='active' AND p.featured=1
                    ORDER BY p.created_at DESC
                """)
                rows = cur.fetchall()
                result = batch_format_products(rows, cur)
                _cache.set('featured', result)
                send_json_cached(self, result, max_age=300)
            except Exception as e:
                logger.exception('[Server] Error loading featured')
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/products/filters — available filter options
        if path == '/api/public/products/filters':
            cached = _cache.get('product_filters', ttl=300)
            if cached is not None:
                send_json_cached(self, cached, max_age=300)
                return
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT DISTINCT pv.color_name, pv.color_hex
                    FROM product_variants pv
                    JOIN products p ON pv.product_id = p.id
                    WHERE p.status='active' AND pv.color_name IS NOT NULL AND pv.color_name != ''
                    ORDER BY pv.color_name
                """)
                colors = [{'name': r['color_name'], 'hex': r['color_hex']} for r in cur.fetchall()]

                cur.execute("""
                    SELECT DISTINCT vs.size_name
                    FROM variant_sizes vs
                    JOIN product_variants pv ON vs.variant_id = pv.id
                    JOIN products p ON pv.product_id = p.id
                    WHERE p.status='active' AND vs.stock > 0 AND vs.size_name IS NOT NULL AND vs.size_name != ''
                    ORDER BY vs.size_name
                """)
                sizes = [r['size_name'] for r in cur.fetchall()]

                cur.execute("""
                    SELECT MIN(COALESCE(p.sale_price, p.price)) AS min_price,
                           MAX(COALESCE(p.sale_price, p.price)) AS max_price
                    FROM products p WHERE p.status='active'
                """)
                price_row = cur.fetchone()
                price_min = float(price_row['min_price']) if price_row and price_row['min_price'] else 0
                price_max = float(price_row['max_price']) if price_row and price_row['max_price'] else 100000

                result = {'colors': colors, 'sizes': sizes, 'price_min': price_min, 'price_max': price_max}
                _cache.set('product_filters', result)
                send_json_cached(self, result, max_age=300)
            except Exception as e:
                print(f'[Server] Error loading filters: {e}', flush=True)
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/products/{id}/recommendations — related products
        if '/recommendations' in path and path.startswith('/api/public/products/'):
            pid = path.split('/')[4]
            try:
                cache_key = f'recommendations:{pid}'
                cached = _cache.get(cache_key, ttl=120)
                if cached is not None:
                    send_json_cached(self, cached, max_age=300)
                    return
            except Exception:
                pass
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("SELECT category_id FROM products WHERE id=%s AND status='active'", (pid,))
                prow = cur.fetchone()
                result = []
                if prow and prow['category_id']:
                    cur.execute("""
                        SELECT p.id, p.name, p.description, p.price, p.sale_price, p.category_id,
                               p.image, p.images, p.badge, p.sizes, p.colors, p.stock, p.brand,
                               p.rating, p.status, p.featured, p.new_arrival, p.created_at,
                               c.name AS category_name, c.size_system AS category_size_system
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE p.id != %s AND p.status='active' AND p.category_id = %s
                        ORDER BY RANDOM() LIMIT 6
                    """, (pid, prow['category_id']))
                    result = batch_format_products(cur.fetchall(), cur)
                if len(result) < 6:
                    cur.execute("""
                        SELECT p.id, p.name, p.description, p.price, p.sale_price, p.category_id,
                               p.image, p.images, p.badge, p.sizes, p.colors, p.stock, p.brand,
                               p.rating, p.status, p.featured, p.new_arrival, p.created_at,
                               c.name AS category_name, c.size_system AS category_size_system
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE p.id != %s AND p.status='active'
                        ORDER BY RANDOM() LIMIT %s
                    """, (pid, 6 - len(result)))
                    extra_ids = {r['id'] for r in result}
                    extra_rows = [r for r in cur.fetchall() if r['id'] not in extra_ids]
                    if extra_rows:
                        result.extend(batch_format_products(extra_rows, cur))
                _cache.set(cache_key, result)
                send_json(self, result)
            except Exception as e:
                logger.exception(f'[Server] Error loading recommendations for {pid}')
                send_json(self, [], 200)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/products/{id} — single product
        if path.startswith('/api/public/products/') and path != '/api/public/products' and path != '/api/public/products/featured':
            pid = path.split('/')[-1]
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT p.id, p.name, p.description, p.price, p.sale_price, p.category_id,
                           p.image, p.images, p.badge, p.sizes, p.colors, p.stock, p.brand,
                           p.rating, p.status, p.featured, p.new_arrival, p.created_at,
                           c.name AS category_name, c.size_system AS category_size_system
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.id=%s AND p.status='active'
                """, (pid,))
                row = cur.fetchone()
                if not row:
                    send_json(self, {'error': 'Not found'}, 404)
                    return
                send_json_cached(self, format_product(row, cur), max_age=60)
            except Exception as e:
                logger.exception("Error loading product %s", pid)
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/categories
        if path == '/api/public/categories':
            cached = _cache.get('categories', ttl=300)
            if cached is not None:
                send_json_cached(self, cached, max_age=300)
                return
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT c.*, COUNT(p.id) FILTER (WHERE p.status='active') AS product_count
                    FROM categories c
                    LEFT JOIN products p ON p.category_id = c.id
                    GROUP BY c.id
                    ORDER BY c.id
                """)
                rows = cur.fetchall()
                result = rows_to_list(rows)
                _cache.set('categories', result)
                send_json_cached(self, result, max_age=300)
            except Exception as e:
                logger.exception('[Server] Error loading categories')
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/settings — public settings
        if path == '/api/public/settings':
            cached = _cache.get('settings', ttl=300)
            if cached is not None:
                send_json_cached(self, cached, max_age=300)
                return
            db = None
            try:
                db = get_public_db()
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
                _cache.set('settings', result)
                send_json_cached(self, result, max_age=300)
            except Exception as e:
                logger.exception('[Server] Error loading settings')
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/delivery-prices
        if path == '/api/public/delivery-prices':
            cached = _cache.get('delivery', ttl=600)
            if cached is not None:
                send_json_cached(self, cached, max_age=300)
                return
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("SELECT wilaya_id, price FROM delivery_prices ORDER BY wilaya_id")
                rows = cur.fetchall()
                result = {}
                for r in rows:
                    result[str(r['wilaya_id'])] = r['price']
                _cache.set('delivery', result)
                send_json_cached(self, result, max_age=300)
            except Exception as e:
                logger.exception('[Server] Error loading delivery')
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # GET /api/public/collections
        if path == '/api/public/collections':
            cached = _cache.get('collections', ttl=300)
            if cached is not None:
                send_json_cached(self, cached, max_age=300)
                return
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("SELECT * FROM collections WHERE status='active' ORDER BY id")
                collections = cur.fetchall()
                if not collections:
                    _cache.set('collections', [])
                    send_json_cached(self, [], max_age=300)
                    return
                coll_ids = [dict(c)['id'] for c in collections]
                placeholders = ','.join(['%s'] * len(coll_ids))
                cur.execute(f"""
                    SELECT cp.collection_id, p.*, c2.name AS category_name, c2.size_system AS category_size_system
                    FROM collection_products cp
                    JOIN products p ON cp.product_id = p.id
                    LEFT JOIN categories c2 ON p.category_id = c2.id
                    WHERE cp.collection_id IN ({placeholders}) AND p.status='active'
                    ORDER BY cp.collection_id, p.created_at DESC
                """, coll_ids)
                all_prods = cur.fetchall()
                prods_by_coll = {}
                for pr in all_prods:
                    pr_dict = dict(pr)
                    cid = pr_dict['collection_id']
                    prods_by_coll.setdefault(cid, []).append(pr_dict)
                result = []
                for coll in collections:
                    c = dict(coll)
                    c_prods = prods_by_coll.get(c['id'], [])
                    c['products'] = batch_format_products(c_prods, cur)
                    c['product_count'] = len(c_prods)
                    result.append(c)
                _cache.set('collections', result)
                send_json_cached(self, result, max_age=300)
            except Exception as e:
                logger.exception('[Server] Error loading collections')
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        # Products.json endpoint — served from DB
        if path == '/website/products.json':
            cached = _cache.get('products_json', ttl=300)
            if cached is not None:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
                self.end_headers()
                self.wfile.write(json.dumps(cached, default=str, ensure_ascii=False).encode('utf-8'))
                return
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
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
                self.end_headers()
                self.wfile.write(json.dumps(products, default=str, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                logger.exception('[Server] Error loading products.json')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"error":"Erreur serveur"}')
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        elif path == '/website/' or path == '/website':
            self.path = '/index.html'
            return self._serve_html('/index.html')

        elif path.startswith('/website/'):
            clean_path = path[9:]
            if not clean_path:
                clean_path = 'index.html'
            real = os.path.realpath(BASE_DIR / clean_path)
            if not real.startswith(str(BASE_DIR)):
                self.send_error(403, 'Forbidden')
                return
            if any(clean_path.endswith(ext) for ext in self.HTML_EXTS):
                return self._serve_html('/' + clean_path)
            self.path = '/' + clean_path
            return super().do_GET()

        elif path.startswith('/images/'):
            clean_path = path.lstrip('/')
            real = os.path.realpath(BASE_DIR / clean_path)
            if not real.startswith(str(BASE_DIR)):
                self.send_error(403, 'Forbidden')
                return
            self.path = '/' + clean_path
            return super().do_GET()

        elif path.startswith('/track/'):
            order_number = path[7:].strip()
            if not order_number:
                self.send_response(302)
                self.send_header('Location', '/website/track.html')
                self.end_headers()
                return
            parsed_qs = urllib.parse.parse_qs(parsed.query)
            phone_last4 = (parsed_qs.get('phone', [''])[0])[-4:]
            if not phone_last4 or len(phone_last4) != 4:
                self.send_response(302)
                self.send_header('Location', '/website/track.html?order=' + urllib.parse.quote(order_number))
                self.end_headers()
                return
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT o.id, o.order_number, o.customer_name, o.customer_phone, o.wilaya,
                           o.total AS total_amount, o.status AS order_status, o.created_at,
                           sh.status, sh.note, sh.created_at AS status_date
                    FROM orders o
                    LEFT JOIN status_history sh ON o.id = sh.order_id
                    WHERE o.order_number = %s AND o.customer_phone LIKE %s
                    ORDER BY sh.created_at DESC
                """, (order_number, '%' + phone_last4))
                rows = cur.fetchall()
                if not rows:
                    send_json(self, {'error': 'Commande non trouvée'}, 404)
                    return
                order = dict(rows[0])
                history = []
                for r in rows:
                    if r['status']:
                        history.append({'status': r['status'], 'note': r['note'], 'date': str(r['status_date'])})
                order['history'] = history
                for k in list(order.keys()):
                    if k in ('note', 'status_date'):
                        del order[k]
                send_json(self, order)
            except Exception as e:
                logger.exception('[Server] Error tracking order')
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        elif path == '/api/public/delivery-times':
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("SELECT wilaya, min_days, max_days FROM delivery_prices ORDER BY wilaya")
                rows = cur.fetchall()
                result = {r['wilaya']: {'min_days': r['min_days'], 'max_days': r['max_days']} for r in rows}
                send_json_cached(self, result, max_age=3600)
            except Exception as e:
                logger.exception('[Server] Error loading delivery times')
                send_json(self, {}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        elif path.startswith('/api/wishlist/'):
            wl_hash = path[15:].strip()
            db = None
            try:
                db = get_public_db()
                cur = db.cursor()
                cur.execute("SELECT product_ids FROM wishlists WHERE hash = %s AND expires_at > NOW()", (wl_hash,))
                row = cur.fetchone()
                if not row:
                    send_json(self, {'error': 'Wishlist not found or expired'}, 404)
                    return
                product_ids = json.loads(row['product_ids'])
                if not product_ids:
                    send_json(self, {'products': []})
                    return
                placeholders = ','.join(['%s'] * len(product_ids))
                cur.execute(f"""
                    SELECT p.id, p.name, p.price, p.sale_price, p.image, p.images,
                           p.stock, p.status, p.category_id,
                           c.name AS category_name, c.size_system AS category_size_system
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.id IN ({placeholders}) AND p.status='active'
                """, product_ids)
                rows = cur.fetchall()
                products = batch_format_products(rows, cur) if rows else []
                send_json_cached(self, {'products': products, 'hash': wl_hash}, max_age=60)
            except Exception as e:
                logger.exception('[Server] Error loading wishlist')
                send_json(self, {'error': 'Erreur serveur'}, 500)
            finally:
                if db:
                    try: db.close()
                    except Exception: pass
            return

        elif path.startswith('/wishlist/') and not path.startswith('/api/'):
            wl_hash = path[10:].strip()
            if wl_hash:
                return self._serve_html('/wishlist-public.html')
            return self._serve_html('/wishlist.html')

        elif path == '/' or path == '':
            self.send_response(302)
            self.send_header('Location', '/website/')
            self.end_headers()

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_type = self.headers.get('Content-Type', '')

        if path == '/api/orders':
            ip = get_client_ip(self)
            if not _order_limiter.is_allowed(f'order:{ip}', max_requests=5, window=300):
                retry = _order_limiter.retry_after(f'order:{ip}', window=300)
                send_json(self, {'error': f'Trop de requêtes. Réessayez dans {retry}s.'}, 429)
                self.send_header('Retry-After', str(retry))
                return
            try:
                length = int(self.headers.get('Content-Length', 0))
                if length > MAX_REQUEST_SIZE:
                    send_json(self, {'error': 'Requête trop volumineuse'}, 413)
                    return
                body = self.rfile.read(length).decode('utf-8')
                data = json.loads(body) if body else {}

                items = data.get('items', [])
                if not items or not isinstance(items, list):
                    send_json(self, {'error': 'Panier vide'}, 400)
                    return
                customer_name = escape_html((data.get('customer_name') or '').strip()[:100])
                customer_phone = (data.get('customer_phone') or '').strip()[:20].replace('+', '').replace('-', '').replace(' ', '')
                wilaya = escape_html((data.get('wilaya') or '').strip()[:50])
                if not customer_name or not customer_phone or not wilaya:
                    send_json(self, {'error': 'Informations client requises (nom, téléphone, wilaya)'}, 400)
                    return
                if not customer_phone.isdigit() or len(customer_phone) < 9:
                    send_json(self, {'error': 'Numéro de téléphone invalide'}, 400)
                    return

                order_number = 'ADL-' + datetime.datetime.now().strftime('%Y%m%d-') + str(random.randint(1000, 9999))

                t = threading.Thread(
                    target=_process_order_background,
                    args=(order_number, items, customer_name, customer_phone, wilaya, data),
                    daemon=True
                )
                t.start()

                send_json(self, {'order_number': order_number, 'message': 'Commande en cours de traitement'}, 201)
            except Exception as e:
                logger.exception("Error processing order request")
                send_json(self, {'error': 'Failed to process order'}, 500)
            return

        if path == '/api/public/log-event':
            try:
                length = int(self.headers.get('Content-Length', 0))
                if length > MAX_REQUEST_SIZE:
                    return
                body = self.rfile.read(length).decode('utf-8')
                data = json.loads(body) if body else {}
                event_type = str(data.get('type', ''))[:50]
                payload = data.get('payload', {})
                if event_type and payload:
                    db = None
                    try:
                        db = get_public_db()
                        cur = db.cursor()
                        cur.execute("INSERT INTO search_events (event_type, payload) VALUES (%s, %s)",
                                    (event_type, json.dumps(payload)))
                        db.commit()
                    except Exception:
                        pass
                    finally:
                        if db:
                            try: db.close()
                            except Exception: pass
                send_json(self, {'ok': True})
            except Exception:
                send_json(self, {'ok': True})
            return

        if path == '/api/wishlist/share':
            try:
                length = int(self.headers.get('Content-Length', 0))
                if length > MAX_REQUEST_SIZE:
                    return
                body = self.rfile.read(length).decode('utf-8')
                data = json.loads(body) if body else {}
                product_ids = data.get('product_ids', [])
                if not product_ids or not isinstance(product_ids, list):
                    send_json(self, {'error': 'No products'}, 400)
                    return
                import hashlib
                wl_hash = hashlib.md5(json.dumps(sorted(product_ids)).encode()).hexdigest()[:12]
                db = None
                try:
                    db = get_public_db()
                    cur = db.cursor()
                    cur.execute("INSERT INTO wishlists (hash, product_ids) VALUES (%s, %s) ON CONFLICT (hash) DO UPDATE SET created_at = NOW(), expires_at = NOW() + INTERVAL '30 days'",
                                (wl_hash, json.dumps(product_ids)))
                    db.commit()
                    send_json(self, {'hash': wl_hash, 'url': '/wishlist/' + wl_hash}, 201)
                except Exception as e:
                    logger.exception('[Server] Error sharing wishlist')
                    send_json(self, {'error': 'Erreur serveur'}, 500)
                finally:
                    if db:
                        try: db.close()
                        except Exception: pass
                return
            except Exception as e:
                send_json(self, {'error': 'Failed'}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def do_PUT(self):
        self.send_response(404)
        self.end_headers()

    def do_HEAD(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()

    def log_message(self, format, *args):
        print(f'[Server] {format % args}')

class AdalinaHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    PORT = int(os.environ.get('PORT_MAIN', '3000'))

    init_database()

    try:
        db = get_public_db()
        db.close()
        db_ok = True
    except Exception as e:
        print(f'WARNING: Cannot connect to database: {e}')
        print('Server will start anyway — requests may fail until DB is reachable.')
        db_ok = False

    print(f'\n{"="*50}')
    print(f'ADALINA WEBSITE SERVER')
    print(f'Port: {PORT}')
    print(f'DB: {"OK" if db_ok else "UNREACHABLE"}')
    print(f'{"="*50}')
    print(f'✓ Access website: http://localhost:{PORT}/website/')
    print(f'✓ Database: PostgreSQL (Supabase)')
    print(f'{"="*50}')
    print(f'Press Ctrl+C to stop the server.')

    server = AdalinaHTTPServer(("", PORT), AdalinaServer)
    try:
        print(f'✓ Server started and running on port {PORT}')
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n✓ Server stopped by user")

if __name__ == '__main__':
    main()
