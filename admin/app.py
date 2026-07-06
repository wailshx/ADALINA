import os
import json
import secrets
import hashlib
import http.server
import http.cookies
import urllib.parse
import re
from functools import wraps

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
SESSIONS_FILE = os.path.join(BASE_DIR, '.sessions.json')

from database import get_db, init_db, seed_db, log_stock_change

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"

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
        json.dump(sessions, f)

def get_session(token):
    sessions = load_sessions()
    data = sessions.get(token)
    if data and data.get('admin_logged_in'):
        return data
    return None

def create_session(remember=False):
    token = secrets.token_hex(32)
    sessions = load_sessions()
    sessions[token] = {'admin_logged_in': True, 'admin_username': ADMIN_USERNAME}
    save_sessions(sessions)
    return token

def delete_session(token):
    sessions = load_sessions()
    sessions.pop(token, None)
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
    return True

def send_file(self, path, status=200):
    if not os.path.isfile(path):
        self.send_response(404)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'404 Not Found')
        return
    ext = os.path.splitext(path)[1].lower()
    self.send_response(status)
    self.send_header('Content-Type', MIME_TYPES.get(ext, 'application/octet-stream'))
    self.end_headers()
    with open(path, 'rb') as f:
        self.wfile.write(f.read())

def send_json(self, data, status=200):
    body = json.dumps(data, default=str).encode('utf-8')
    self.send_response(status)
    self.send_header('Content-Type', 'application/json')
    self.send_header('Access-Control-Allow-Origin', '*')
    self.end_headers()
    self.wfile.write(body)

def redirect(self, location):
    self.send_response(302)
    self.send_header('Location', location)
    self.end_headers()

def read_body(self):
    length = int(self.headers.get('Content-Length', 0))
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

class AdminHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"[Admin] {args[0]} {args[1]} {args[2]}")

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
                SELECT strftime('%m', created_at) AS month, COUNT(*) AS cnt, COALESCE(SUM(total),0) AS rev
                FROM orders WHERE status='delivered' AND strftime('%Y', created_at) = strftime('%Y', 'now')
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
                SELECT strftime('%Y-%m', created_at) AS month,
                       COUNT(*) AS orders,
                       COALESCE(SUM(total),0) AS revenue
                FROM orders
                WHERE created_at >= datetime('now', '-12 months')
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
                SELECT date(created_at) AS day,
                       COUNT(*) AS orders,
                       COALESCE(SUM(total),0) AS revenue
                FROM orders
                WHERE created_at >= date('now', '-30 days')
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
            if category:
                cur.execute("""SELECT p.*, c.name AS category_name FROM products p
                         LEFT JOIN categories c ON p.category_id = c.id
                         WHERE c.slug = %s ORDER BY p.id""", (category,))
                rows = cur.fetchall()
            elif search:
                cur.execute("""SELECT p.*, c.name AS category_name FROM products p
                         LEFT JOIN categories c ON p.category_id = c.id
                         WHERE LOWER(p.name) LIKE %s ORDER BY p.id""", (f'%{search}%',))
                rows = cur.fetchall()
            else:
                cur.execute("""SELECT p.*, c.name AS category_name FROM products p
                         LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.id""")
                rows = cur.fetchall()
            result = []
            for r in rows:
                d = dict(r)
                pid = d['id']
                if d.get('images') and isinstance(d['images'], str):
                    d['images'] = json.loads(d['images'])
                cur.execute("SELECT size FROM product_sizes WHERE product_id=%s ORDER BY id", (pid,))
                d['sizes'] = [s['size'] for s in cur.fetchall()]
                cur.execute("SELECT color_name FROM product_colors WHERE product_id=%s ORDER BY id", (pid,))
                d['colors'] = [c['color_name'] for c in cur.fetchall()]
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
            # Read sizes and colors from normalized tables
            cur.execute("SELECT size, stock FROM product_sizes WHERE product_id=%s ORDER BY id", (pid,))
            data['sizes'] = [{'size': r['size'], 'stock': r['stock']} for r in cur.fetchall()]
            cur.execute("SELECT color_name, color_hex, stock FROM product_colors WHERE product_id=%s ORDER BY id", (pid,))
            data['colors'] = [{'name': r['color_name'], 'hex': r['color_hex'], 'stock': r['stock']} for r in cur.fetchall()]
            cur.execute("SELECT color_name, size_name, stock FROM product_variants WHERE product_id=%s ORDER BY id", (pid,))
            data['variants'] = [{'color_name': r['color_name'], 'size_name': r['size_name'], 'stock': r['stock']} for r in cur.fetchall()]
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

        if path == '/api/customers':
            search = query.get('search', [''])[0].strip().lower()
            sort = query.get('sort', ['id'])[0]
            order = query.get('order', ['asc'])[0]
            page = int(query.get('page', ['1'])[0])
            per_page = int(query.get('per_page', ['10'])[0])
            allowed_sort = {'id', 'name', 'email', 'orders_count', 'total_spent', 'joined_at', 'status'}
            if sort not in allowed_sort:
                sort = 'id'
            if order not in ('asc', 'desc'):
                order = 'asc'
            where = ''
            params = []
            if search:
                where = "WHERE (LOWER(name) LIKE %s OR LOWER(email) LIKE %s)"
                params = [f'%{search}%', f'%{search}%']
            cur.execute(f"SELECT COUNT(*) AS cnt FROM customers {where}", params)
            total = cur.fetchone()['cnt']
            offset = (page - 1) * per_page
            cur.execute(f"SELECT * FROM customers {where} ORDER BY {sort} {order} LIMIT %s OFFSET %s",
                              params + [per_page, offset])
            rows = cur.fetchall()
            pages = max(1, (total + per_page - 1) // per_page)
            send_json(self, {'customers': rows_to_list(rows), 'total': total, 'page': page, 'per_page': per_page, 'pages': pages})
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

        if path == '/api/inventory':
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
            sizes = data.get('sizes', [])
            colors = data.get('colors', [])
            status = data.get('status', 'active')
            colorNames = [c.get('name', c) if isinstance(c, dict) else c for c in colors]
            sizeNames = [s.get('size', s) if isinstance(s, dict) else s for s in sizes]
            cur.execute("""INSERT INTO products (name, description, price, sale_price, category_id, image, images, badge, sizes, colors, stock, brand, rating, featured, new_arrival, status)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (data.get('name',''), data.get('description',''), data.get('price',0),
                         data.get('sale_price'), cat_id, data.get('image',''),
                         json.dumps(data.get('images',[])), data.get('badge'),
                         json.dumps(sizeNames), json.dumps(colorNames),
                         data.get('stock',0), data.get('brand',''), data.get('rating',0),
                         data.get('featured', 0), data.get('new_arrival', 0), status))
            pid = cur.lastrowid
            for s in sizes:
                sname = s.get('size', s) if isinstance(s, dict) else s
                sstock = s.get('stock', 0) if isinstance(s, dict) else 0
                cur.execute("INSERT INTO product_sizes (product_id, size, stock) VALUES (%s, %s, %s)", (pid, sname, sstock))
            for c in colors:
                cname = c.get('name', c) if isinstance(c, dict) else c
                chex = c.get('hex', '') if isinstance(c, dict) else ''
                cstock = c.get('stock', 0) if isinstance(c, dict) else 0
                cur.execute("INSERT INTO product_colors (product_id, color_name, color_hex, stock) VALUES (%s, %s, %s, %s)", (pid, cname, chex, cstock))
            variants = data.get('variants', [])
            for v in variants:
                cur.execute("INSERT INTO product_variants (product_id, color_name, size_name, stock) VALUES (%s, %s, %s, %s)",
                            (pid, v.get('color_name', ''), v.get('size_name', ''), v.get('stock', 0)))
            cur.execute("INSERT OR IGNORE INTO inventory (product_id, quantity) VALUES (%s, %s)", (pid, data.get('stock', 0)))
            db.commit()
            send_json(self, {'id': pid, 'message': 'Product created'}, 201)
            return True

        if path == '/api/categories':
            name = data.get('name', '').strip()
            if not name:
                send_json(self, {'error': 'Name required'}, 400)
                return True
            slug = data.get('slug', '') or name.lower().replace(' ', '-')
            cur.execute("INSERT OR IGNORE INTO categories (name, slug, description, image, status) VALUES (%s,%s,%s,%s,%s)",
                        (name, slug, data.get('description',''), data.get('image',''), data.get('status','active')))
            db.commit()
            send_json(self, {'id': cur.lastrowid, 'message': 'Category created'}, 201)
            return True

        if path == '/api/collections':
            cur.execute("INSERT INTO collections (name, description, image, status) VALUES (%s,%s,%s,%s)",
                        (data.get('name',''), data.get('description',''), data.get('image',''), data.get('status','active')))
            cid = cur.lastrowid
            for pid in data.get('product_ids', []):
                cur.execute("INSERT OR IGNORE INTO collection_products (collection_id, product_id) VALUES (%s,%s)", (cid, pid))
            db.commit()
            send_json(self, {'id': cid, 'message': 'Collection created'}, 201)
            return True

        if path == '/api/orders':
            items_json = json.dumps(data.get('items', []))
            cur.execute("""INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, wilaya, commune, status, total, items)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (data.get('order_number',''), data.get('customer_id'),
                         data.get('customer_name',''), data.get('customer_phone',''),
                         data.get('wilaya',''), data.get('commune',''),
                         data.get('status','pending'), data.get('total',0), items_json))
            oid = cur.lastrowid
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
            cur.execute("INSERT INTO customers (name, email, status) VALUES (%s,%s,%s)",
                        (data.get('name',''), data.get('email',''), data.get('status','active')))
            db.commit()
            send_json(self, {'id': cur.lastrowid, 'message': 'Customer created'}, 201)
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

            # Remove non-column keys before building UPDATE
            variants_data = data.pop('variants', None)

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

            if variants_data is not None:
                cur.execute("DELETE FROM product_variants WHERE product_id=%s", (pid,))
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
                cur.execute("INSERT OR IGNORE INTO collection_products (collection_id, product_id) VALUES (%s,%s)", (cid, pid))
            db.commit()
            send_json(self, {'message': 'Products updated'})
            return True

        if path.startswith('/api/collections/'):
            cid = path.split('/')[-1]
            sets = ', '.join(f"{k}=%s" for k in data)
            vals = list(data.values()) + [cid]
            cur.execute(f"UPDATE collections SET {sets} WHERE id=%s", vals)
            db.commit()
            send_json(self, {'message': 'Collection updated'})
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
            sets = ', '.join(f"{k}=%s" for k in data)
            vals = list(data.values()) + [oid]
            cur.execute(f"UPDATE orders SET {sets} WHERE id=%s", vals)
            new_status = data.get('status', old_status)
            deduct_statuses = ('confirmed', 'processing')
            if new_status in deduct_statuses and old_status not in deduct_statuses:
                items_json = data.get('items') if 'items' in data else old_items
                if isinstance(items_json, str):
                    items = json.loads(items_json)
                else:
                    items = items_json
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
            send_json(self, {'message': 'Order updated'})
            return True

        if path.startswith('/api/customers/'):
            cid = path.split('/')[-1]
            if 'name' in data:
                data['name'] = data['name'].strip()
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
            cur.execute("UPDATE products SET category_id=NULL WHERE category_id=%s", (cid,))
            cur.execute("DELETE FROM categories WHERE id=%s", (cid,))
            db.commit()
            send_json(self, {'message': 'Deleted'})
            return True

        if path.startswith('/api/orders/'):
            oid = path.split('/')[-1]
            cur.execute("DELETE FROM orders WHERE id=%s", (oid,))
            db.commit()
            send_json(self, {'message': 'Deleted'})
            return True

        send_json(self, {'error': 'Not found'}, 404)
        return True

    def api_UPLOAD(self, multipart):
        ALLOWED = ('.jpg', '.jpeg', '.png', '.webp')
        MAX_SIZE = 10 * 1024 * 1024
        upload_dir = os.path.join(PARENT_DIR, 'uploads', 'products')
        os.makedirs(upload_dir, exist_ok=True)
        saved_paths = []
        for f in multipart.get('files', []):
            ext = os.path.splitext(f['filename'])[1].lower()
            if ext not in ALLOWED:
                continue
            if len(f['content']) > MAX_SIZE:
                continue
            ts = int(__import__('time').time() * 1000)
            safe_name = f"{ts}_{f['filename']}"
            dest = os.path.join(upload_dir, safe_name)
            if os.path.isfile(dest):
                continue
            with open(dest, 'wb') as out:
                out.write(f['content'])
            saved_paths.append(f'uploads/products/{safe_name}')
        send_json(self, {'paths': saved_paths, 'count': len(saved_paths)})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == '/api/public/products':
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
            result = []
            for r in rows:
                d = dict(r)
                if d.get('images') and isinstance(d['images'], str):
                    d['images'] = json.loads(d['images'])
                if d.get('sizes') and isinstance(d['sizes'], str):
                    d['sizes'] = json.loads(d['sizes'])
                if d.get('colors') and isinstance(d['colors'], str):
                    d['colors'] = json.loads(d['colors'])
                if isinstance(d.get('colors'), list):
                    d['colors'] = [c.get('name', c) if isinstance(c, dict) else c for c in d['colors']]
                d['featured'] = bool(d.get('featured', 0))
                d['new_arrival'] = bool(d.get('new_arrival', 0))
                d['category'] = d.get('category_name') or ''
                result.append(d)
            if featured_only:
                result = [p for p in result if p.get('featured')]
            if search:
                result = [p for p in result if search in p['name'].lower() or search in (p.get('description') or '').lower()]
            if category:
                result = [p for p in result if (p.get('category_name') or '').lower() == category]
            send_json(self, result)
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
            if isinstance(data.get('colors'), list):
                data['colors'] = [c.get('name', c) if isinstance(c, dict) else c for c in data['colors']]
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
                    SELECT p.id, p.name, p.price, p.image FROM products p
                    JOIN collection_products cp ON cp.product_id = p.id
                    WHERE cp.collection_id = %s AND p.status='active'
                """, (coll['id'],))
                coll['products'] = rows_to_list(cur.fetchall())
            send_json(self, data)
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
            body = read_body(self)
            params = urllib.parse.parse_qs(body)
            username = params.get('username', [''])[0].strip()
            password = params.get('password', [''])[0]
            remember = params.get('remember', [None])[0]
            if username == ADMIN_USERNAME and hashlib.sha256(password.encode()).hexdigest() == ADMIN_PASSWORD_HASH:
                token = create_session(remember=(remember == 'on'))
                max_age = 30 * 24 * 3600 if remember else None
                cookie = f'admin_session={token}; Path=/; HttpOnly; SameSite=Lax'
                if max_age: cookie += f'; Max-Age={max_age}'
                self.send_response(302)
                self.send_header('Set-Cookie', cookie)
                self.send_header('Location', '/admin/dashboard.html')
                self.end_headers()
            else:
                redirect(self, '/admin/login?error=1')
        elif path.startswith('/api/'):
            if not require_auth(self):
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
                self.api_POST(path, body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            if not require_auth(self):
                return
            body = read_body(self)
            self.api_PUT(path, body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/'):
            if not require_auth(self):
                return
            self.api_DELETE(path)
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    init_db()
    seed_db()
    port = 5000
    server = http.server.HTTPServer(('0.0.0.0', port), AdminHandler)
    print(f"Admin Dashboard running at http://localhost:{port}")
    print(f"Admin dashboard ready — login at http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()
