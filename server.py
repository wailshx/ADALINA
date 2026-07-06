from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

import sys
sys.path.insert(0, str(BASE_DIR))
from config.database import get_db

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

def send_json(handler, data, status=200):
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.end_headers()
    handler.wfile.write(json.dumps(data, default=str, ensure_ascii=False).encode('utf-8'))

def format_product(row, cur=None):
    p = dict(row)
    if isinstance(p.get('images'), str):
        p['images'] = json.loads(p['images'])
    if cur:
        cur.execute("SELECT color_name, color_hex, stock FROM product_colors WHERE product_id=? ORDER BY id", (p['id'],))
        color_rows = cur.fetchall()
        p['colors'] = [{'name': r['color_name'], 'hex': r['color_hex'], 'stock': r['stock']} for r in color_rows]
        cur.execute("SELECT size, stock FROM product_sizes WHERE product_id=? ORDER BY id", (p['id'],))
        size_rows = cur.fetchall()
        p['sizes'] = [{'size': r['size'], 'stock': r['stock']} for r in size_rows]
        cur.execute("SELECT color_name, size_name, stock FROM product_variants WHERE product_id=? ORDER BY id", (p['id'],))
        p['variants'] = [{'color_name': r['color_name'], 'size_name': r['size_name'], 'stock': r['stock']} for r in cur.fetchall()]
    p['featured'] = bool(p.get('featured', 0))
    p['new_arrival'] = bool(p.get('new_arrival', 0))
    p['category'] = p.get('category_name') or ''
    return p

class LunaBelleServer(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # GET /api/public/products — list all products
        if path == '/api/public/products':
            try:
                db = get_db()
                cur = db.cursor()
                search = query.get('search', [''])[0].strip().lower()
                category = query.get('category', [''])[0].strip().lower()
                featured_only = query.get('featured', [''])[0].strip().lower() == 'true'
                cur.execute("""
                    SELECT p.*, c.name AS category_name
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.status='active'
                    ORDER BY p.id
                """)
                rows = cur.fetchall()
                result = [format_product(r, cur) for r in rows]
                if featured_only:
                    result = [p for p in result if p.get('featured')]
                if search:
                    result = [p for p in result if search in p['name'].lower() or search in (p.get('description') or '').lower()]
                if category:
                    result = [p for p in result if (p.get('category_name') or '').lower() == category]
                send_json(self, result)
                db.close()
            except Exception as e:
                send_json(self, {'error': str(e)}, 500)
            return

        # GET /api/public/products/featured — featured products
        if path == '/api/public/products/featured':
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT p.*, c.name AS category_name
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.status='active' AND p.featured=1
                    ORDER BY p.id
                """)
                rows = cur.fetchall()
                result = [format_product(r, cur) for r in rows]
                send_json(self, result)
                db.close()
            except Exception as e:
                send_json(self, {'error': str(e)}, 500)
            return

        # GET /api/public/products/{id} — single product
        if path.startswith('/api/public/products/') and path != '/api/public/products' and path != '/api/public/products/featured':
            pid = path.split('/')[-1]
            try:
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
                    db.close()
                    return
                send_json(self, format_product(row, cur))
                db.close()
            except Exception as e:
                send_json(self, {'error': str(e)}, 500)
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
                send_json(self, {'error': str(e)}, 500)
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
                send_json(self, {'error': str(e)}, 500)
            return

        # Products.json endpoint — served from DB
        if path == '/website/products.json':
            try:
                db = get_db()
                cur = db.cursor()
                cur.execute("""
                    SELECT p.*, c.name AS category_name
                    FROM products p LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.status='active'
                    ORDER BY p.id
                """)
                rows = cur.fetchall()
                products = [format_product(r, cur) for r in rows]
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(products, default=str, ensure_ascii=False).encode('utf-8'))
                db.close()
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f'Error: {str(e)}'.encode('utf-8'))
            return

        elif path == '/website/' or path == '/website':
            self.path = '/index.html'
            return super().do_GET()

        elif path.startswith('/website/'):
            clean_path = path[9:]
            if not clean_path:
                clean_path = 'index.html'
            if clean_path.startswith('.') or '..' in clean_path:
                self.send_error(403, 'Forbidden')
                return
            self.path = '/' + clean_path
            return super().do_GET()

        elif path.startswith('/uploads/'):
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
                body = self.rfile.read(length).decode('utf-8')
                data = json.loads(body) if body else {}
                db = get_db()
                cur = db.cursor()

                order_number = 'MEMO-' + __import__('datetime').datetime.now().strftime('%Y%m%d-') + str(__import__('random').randint(1000, 9999))
                items = data.get('items', [])
                shipping = data.get('shipping', '')
                customer_name = data.get('customer_name', '')
                customer_phone = data.get('customer_phone', '')
                wilaya = data.get('wilaya', '')
                commune = data.get('commune', '')
                shipping_address = f"Name: {customer_name}, Phone: {customer_phone}, Address: {shipping}"
                payment = data.get('payment_method', 'Cash on Delivery')

                cur.execute("""
                    INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, wilaya, commune, status, total, items, shipping_address, payment_method)
                    VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (order_number, customer_name, customer_phone, wilaya, commune, 'new', data.get('total', 0), json.dumps(items), shipping_address, payment))

                oid = cur.lastrowid
                db.commit()
                send_json(self, {'id': oid, 'order_number': order_number, 'message': 'Order created'}, 201)
                db.close()
            except Exception as e:
                send_json(self, {'error': str(e)}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        print(f'[Server] {format % args}')

def main():
    PORT = 3000

    init_database()

    try:
        db = get_db()
        db.close()
    except Exception as e:
        print(f'ERROR: Cannot connect to database.')
        print(f'Error: {e}')
        return

    print(f'\n{"="*50}')
    print(f'LUNA BELLE WEBSITE SERVER')
    print(f'Port: {PORT}')
    print(f'{"="*50}')
    print(f'✓ Access website: http://localhost:{PORT}/website/')
    print(f'✓ Database: SQLite')
    print(f'{"="*50}')
    print(f'Press Ctrl+C to stop the server.')

    server = HTTPServer(("", PORT), LunaBelleServer)
    try:
        print(f'✓ Server started and running on port {PORT}')
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n✓ Server stopped by user")

if __name__ == '__main__':
    main()
