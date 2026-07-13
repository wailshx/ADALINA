from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
import subprocess
import urllib.parse
import time
import logging
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
from config.database import get_db
try:
    from admin.database import deduct_order_stock
except ImportError:
    def deduct_order_stock(cur, pid, color, size, qty): return (False, "Stock system unavailable")

logger = logging.getLogger('adalina')


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

CORS_ORIGIN = os.environ.get('CORS_ORIGIN', 'https://adalina.onrender.com')

def send_json(handler, data, status=200):
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
    handler.send_header('Cache-Control', 'no-store, must-revalidate')
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
            for v in variant_rows:
                vdict = {'id': v['id'], 'color_name': v['color_name'], 'color_hex': v['color_hex'], 'sku': v['sku'], 'stock': v['stock']}
                cur.execute("SELECT image_path FROM variant_images WHERE variant_id=%s ORDER BY sort_order", (v['id'],))
                vdict['images'] = [r['image_path'] for r in cur.fetchall()]
                cur.execute("SELECT size_name, stock, COALESCE(sku, '') AS sku FROM variant_sizes WHERE variant_id=%s ORDER BY id", (v['id'],))
                vdict['sizes'] = [{'size': r['size_name'], 'stock': r['stock'], 'sku': r['sku']} for r in cur.fetchall()]
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

MAX_REQUEST_SIZE = 1 * 1024 * 1024  # 1 MB for JSON requests

class AdalinaServer(SimpleHTTPRequestHandler):
    STATIC_EXTS = ('.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf')
    HTML_EXTS = ('.html',)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def send_response(self, code, message=None):
        super().send_response(code, message)
        path = getattr(self, 'path', '').lower()
        if any(path.endswith(ext) for ext in self.STATIC_EXTS):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
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
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # GET /api/public/products — list all products (with optional pagination + sort)
        if path == '/api/public/products':
            try:
                db = get_db()
                cur = db.cursor()
                page = int(query.get('page', ['1'])[0])
                limit = int(query.get('limit', ['0'])[0])
                search = query.get('search', [''])[0].strip().lower()
                category = query.get('category', [''])[0].strip().lower()
                featured_only = query.get('featured', [''])[0].strip().lower() == 'true'
                sort = query.get('sort', ['newest'])[0].strip().lower()

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

                cur.execute("SELECT COUNT(*) AS cnt FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE " + where_clause, params)
                row = cur.fetchone()
                total = row['cnt'] if row else 0

                if limit > 0:
                    offset = (page - 1) * limit
                    cur.execute("""
                        SELECT p.*, c.name AS category_name, c.size_system AS category_size_system
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE """ + where_clause + """
                        ORDER BY """ + order_by + """
                        LIMIT %s OFFSET %s
                    """, params + [limit, offset])
                    rows = cur.fetchall()
                    result = [format_product(r, cur) for r in rows]
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
                        SELECT p.*, c.name AS category_name, c.size_system AS category_size_system
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE """ + where_clause + """
                        ORDER BY """ + order_by, params
                    )
                    rows = cur.fetchall()
                    result = [format_product(r, cur) for r in rows]
                    send_json(self, result)

                db.close()
            except Exception as e:
                logger.exception("Error loading products")
                send_json(self, {'error': 'Erreur lors du chargement des produits'}, 500)
            return

        # GET /api/public/products/featured — featured products
        if path == '/api/public/products/featured':
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT p.*, c.name AS category_name, c.size_system AS category_size_system
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.status='active' AND p.featured=1
                    ORDER BY p.created_at DESC
                """)
                rows = cur.fetchall()
                result = [format_product(r, cur) for r in rows]
                send_json(self, result)
                db.close()
            except Exception as e:
                logger.exception("Error loading featured products")
                send_json(self, {'error': 'Erreur serveur'}, 500)
            return

        # GET /api/public/products/{id} — single product
        if path.startswith('/api/public/products/') and path != '/api/public/products' and path != '/api/public/products/featured':
            pid = path.split('/')[-1]
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT p.*, c.name AS category_name, c.size_system AS category_size_system
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.id=%s AND p.status='active'
                """, (pid,))
                row = cur.fetchone()
                if not row:
                    send_json(self, {'error': 'Not found'}, 404)
                    db.close()
                    return
                send_json(self, format_product(row, cur))
                db.close()
            except Exception as e:
                logger.exception("Error loading product %s", pid)
                send_json(self, {'error': 'Erreur serveur'}, 500)
            return

        # GET /api/public/categories
        if path == '/api/public/categories':
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status='active') AS product_count
                    FROM categories c ORDER BY c.id
                """)
                rows = cur.fetchall()
                send_json(self, rows_to_list(rows))
                db.close()
            except Exception as e:
                logger.exception("Error loading categories")
                send_json(self, {'error': 'Erreur serveur'}, 500)
            return

        # GET /api/public/settings — public settings
        if path == '/api/public/settings':
            try:
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
                db.close()
            except Exception as e:
                logger.exception("Error loading settings")
                send_json(self, {'error': 'Erreur serveur'}, 500)
            return

        # GET /api/public/delivery-prices
        if path == '/api/public/delivery-prices':
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("SELECT wilaya_id, price FROM delivery_prices ORDER BY wilaya_id")
                rows = cur.fetchall()
                result = {}
                for r in rows:
                    result[str(r['wilaya_id'])] = r['price']
                send_json(self, result)
                db.close()
            except Exception as e:
                logger.exception("Error loading delivery prices")
                send_json(self, {'error': 'Erreur serveur'}, 500)
            return

        # GET /api/public/collections
        if path == '/api/public/collections':
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("SELECT * FROM collections WHERE status='active' ORDER BY id")
                collections = cur.fetchall()
                result = []
                for coll in collections:
                    c = dict(coll)
                    cur.execute("""
                        SELECT p.*, c2.name AS category_name
                        FROM collection_products cp
                        JOIN products p ON cp.product_id = p.id
                        LEFT JOIN categories c2 ON p.category_id = c2.id
                        WHERE cp.collection_id=%s AND p.status='active'
                    """, (c['id'],))
                    prods = cur.fetchall()
                    c['products'] = [format_product(r, cur) for r in prods]
                    c['product_count'] = len(prods)
                    result.append(c)
                send_json(self, result)
                db.close()
            except Exception as e:
                logger.exception("Error loading collections")
                send_json(self, {'error': 'Erreur serveur'}, 500)
            return

        # Products.json endpoint — served from DB
        if path == '/website/products.json':
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT p.*, c.name AS category_name, c.size_system AS category_size_system
                    FROM products p LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.status='active'
                    ORDER BY p.created_at DESC
                """)
                rows = cur.fetchall()
                products = [format_product(r, cur) for r in rows]
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
                self.end_headers()
                self.wfile.write(json.dumps(products, default=str, ensure_ascii=False).encode('utf-8'))
                db.close()
            except Exception as e:
                logger.exception("Error loading products.json")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b'Erreur serveur')
            return

        elif path == '/website/' or path == '/website':
            self.path = '/index.html'
            return self._serve_html('/index.html')

        elif path.startswith('/website/'):
            clean_path = path[9:]
            if not clean_path:
                clean_path = 'index.html'
            if clean_path.startswith('.') or '..' in clean_path:
                self.send_error(403, 'Forbidden')
                return
            if any(clean_path.endswith(ext) for ext in self.HTML_EXTS):
                return self._serve_html('/' + clean_path)
            self.path = '/' + clean_path
            return super().do_GET()

        elif path.startswith('/uploads/'):
            clean_path = path.lstrip('/')
            if '..' in clean_path or clean_path.startswith('.'):
                self.send_error(403, 'Forbidden')
                return
            self.path = '/' + clean_path
            return super().do_GET()

        elif path.startswith('/images/'):
            clean_path = path.lstrip('/')
            if '..' in clean_path or clean_path.startswith('.'):
                self.send_error(403, 'Forbidden')
                return
            self.path = '/' + clean_path
            return super().do_GET()

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
            try:
                length = int(self.headers.get('Content-Length', 0))
                if length > MAX_REQUEST_SIZE:
                    send_json(self, {'error': 'Requête trop volumineuse'}, 413)
                    return
                body = self.rfile.read(length).decode('utf-8')
                data = json.loads(body) if body else {}

                # Input validation
                items = data.get('items', [])
                if not items or not isinstance(items, list):
                    send_json(self, {'error': 'Panier vide'}, 400)
                    return
                customer_name = (data.get('customer_name') or '').strip()
                customer_phone = (data.get('customer_phone') or '').strip()
                wilaya = (data.get('wilaya') or '').strip()
                if not customer_name or not customer_phone or not wilaya:
                    send_json(self, {'error': 'Informations client requises (nom, téléphone, wilaya)'}, 400)
                    return

                db = get_db()
                cur = db.cursor()
                cur.execute("BEGIN")

                order_number = 'MEMO-' + __import__('datetime').datetime.now().strftime('%Y%m%d-') + str(__import__('random').randint(1000, 9999))
                commune = (data.get('commune') or '').strip()
                shipping = data.get('shipping', '')
                shipping_address = f"Name: {customer_name}, Phone: {customer_phone}, Address: {shipping}"
                payment = data.get('payment_method', 'Cash on Delivery')

                # Calculate order total server-side from product prices (prevents price manipulation)
                server_total = 0
                for item in items:
                    pid = item.get('product_id')
                    qty = item.get('quantity') or 1
                    color = item.get('color') or item.get('selectedColor') or ''
                    size = item.get('size') or item.get('selectedSize') or ''

                    # Look up actual price from database
                    cur.execute("SELECT price, sale_price FROM products WHERE id=%s", (pid,))
                    prod = cur.fetchone()
                    if not prod:
                        cur.execute("ROLLBACK")
                        db.commit()
                        send_json(self, {'error': f'Produit {pid} introuvable'}, 400)
                        db.close()
                        return
                    unit_price = prod['sale_price'] if prod['sale_price'] else prod['price']
                    server_total += (unit_price or 0) * qty

                    ok, err = deduct_order_stock(cur, pid, color, size, qty)
                    if not ok:
                        product_name = item.get('name', '')
                        msg = err or "Stock insuffisant"
                        if product_name:
                            msg = f"{msg} pour {product_name}"
                        cur.execute("ROLLBACK")
                        db.commit()
                        send_json(self, {'error': msg}, 409)
                        db.close()
                        return

                # Look up delivery price from database
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
                cur.execute("COMMIT")
                db.commit()
                send_json(self, {'id': oid, 'order_number': order_number, 'message': 'Order created'}, 201)
                db.close()
            except Exception as e:
                logger.exception("Error creating order")
                try:
                    cur.execute("ROLLBACK")
                except Exception:
                    pass
                send_json(self, {'error': 'Erreur lors de la création de la commande'}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def do_PUT(self):
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        print(f'[Server] {format % args}')

def main():
    PORT = int(os.environ.get('PORT_MAIN', '3000'))

    init_database()

    try:
        db = get_db()
        db.close()
    except Exception as e:
        print(f'ERROR: Cannot connect to database.')
        print(f'Error: {e}')
        return

    print(f'\n{"="*50}')
    print(f'ADALINA WEBSITE SERVER')
    print(f'Port: {PORT}')
    print(f'{"="*50}')
    print(f'✓ Access website: http://localhost:{PORT}/website/')
    print(f'✓ Database: PostgreSQL (Supabase)')
    print(f'{"="*50}')
    print(f'Press Ctrl+C to stop the server.')

    server = HTTPServer(("", PORT), AdalinaServer)
    try:
        print(f'✓ Server started and running on port {PORT}')
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n✓ Server stopped by user")

if __name__ == '__main__':
    main()
