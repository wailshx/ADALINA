import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.database import get_db

def log_stock_change(cur, product_id, stock_change, quantity_before, reason=''):
    quantity_after = quantity_before + stock_change
    cur.execute("""INSERT INTO stock_history (product_id, stock_change, quantity_before, quantity_after, reason)
                   VALUES (?, ?, ?, ?, ?)""",
                (product_id, stock_change, quantity_before, quantity_after, reason))

def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        image TEXT DEFAULT '',
        status TEXT DEFAULT 'active'
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        sale_price REAL DEFAULT NULL,
        category_id INTEGER DEFAULT NULL,
        image TEXT DEFAULT '',
        images TEXT,
        badge TEXT DEFAULT NULL,
        sizes TEXT,
        colors TEXT,
        stock INTEGER DEFAULT 0,
        brand TEXT DEFAULT '',
        rating INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        featured INTEGER DEFAULT 0,
        new_arrival INTEGER DEFAULT 0,
        FOREIGN KEY (category_id) REFERENCES categories(id)
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS product_sizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        size TEXT NOT NULL,
        stock INTEGER DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS product_colors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        color_name TEXT NOT NULL,
        color_hex TEXT DEFAULT '',
        stock INTEGER DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        color_name TEXT DEFAULT '',
        size_name TEXT DEFAULT '',
        stock INTEGER DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        image TEXT DEFAULT '',
        status TEXT DEFAULT 'active'
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS collection_products (
        collection_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        PRIMARY KEY (collection_id, product_id),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT DEFAULT '',
        address TEXT,
        avatar TEXT DEFAULT '',
        orders_count INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER DEFAULT NULL,
        customer_name TEXT DEFAULT '',
        customer_phone TEXT DEFAULT '',
        wilaya TEXT DEFAULT '',
        commune TEXT DEFAULT '',
        status TEXT DEFAULT 'new',
        total REAL DEFAULT 0,
        items TEXT,
        shipping_address TEXT,
        payment_method TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER UNIQUE NOT NULL,
        quantity INTEGER DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 5,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS stock_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        stock_change INTEGER NOT NULL,
        quantity_before INTEGER NOT NULL,
        quantity_after INTEGER NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    # Migrate existing tables — add missing columns
    for table, col, typ in [
        ('product_colors', 'stock', 'INTEGER DEFAULT 0'),
        ('product_sizes', 'stock', 'INTEGER DEFAULT 0'),
        ('orders', 'customer_name', 'TEXT DEFAULT \'\''),
        ('orders', 'customer_phone', 'TEXT DEFAULT \'\''),
        ('orders', 'wilaya', 'TEXT DEFAULT \'\''),
        ('orders', 'commune', 'TEXT DEFAULT \'\''),
    ]:
        try:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        except Exception:
            pass  # column already exists

    conn.commit()
    conn.close()

def seed_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS cnt FROM users WHERE role='admin'")
    row = cur.fetchone()
    if row['cnt'] > 0:
        conn.close()
        return

    import hashlib
    cur.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
                ('admin', hashlib.sha256(b'admin123').hexdigest(), 'admin'))

    conn.commit()
    conn.close()
