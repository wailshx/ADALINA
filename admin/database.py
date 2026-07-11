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

def _find_variant(cur, product_id, color_name):
    """Find the variant ID for a product+color. Returns (variant_id, error)."""
    cur.execute("SELECT id FROM product_variants WHERE product_id=? AND color_name=? LIMIT 1", (product_id, color_name))
    row = cur.fetchone()
    if row:
        return (row['id'], None)
    # Try fallback: any variant for this product, then match legacy path
    cur.execute("SELECT id FROM product_variants WHERE product_id=? LIMIT 1", (product_id,))
    row = cur.fetchone()
    if row:
        return (row['id'], None)
    return (None, None)

def get_variant_stock(cur, product_id, color_name, size_name):
    """Check available stock. Returns (stock, error_message)."""
    vid, _ = _find_variant(cur, product_id, color_name)
    if vid:
        cur.execute("SELECT stock FROM variant_sizes WHERE variant_id=? AND size_name=?", (vid, size_name))
        srow = cur.fetchone()
        if srow:
            return (srow['stock'], None)
        return (0, "Taille introuvable pour cette variante")
    cur.execute("SELECT stock FROM product_sizes WHERE product_id=? AND size=?", (product_id, size_name))
    srow = cur.fetchone()
    if srow:
        return (srow['stock'], None)
    return (0, "Taille introuvable pour ce produit")

def deduct_order_stock(cur, product_id, color_name, size_name, quantity):
    """Atomically deduct stock for an order item. Returns (success, message)."""
    vid, _ = _find_variant(cur, product_id, color_name)
    if vid:
        before = 0
        cur.execute("SELECT stock FROM variant_sizes WHERE variant_id=? AND size_name=?", (vid, size_name))
        srow = cur.fetchone()
        if not srow:
            return (False, "Taille introuvable pour cette variante")
        before = srow['stock']
        if before < quantity:
            return (False, f"Stock insuffisant pour cette taille ({before} restant(s))")
        cur.execute("UPDATE variant_sizes SET stock = stock - ? WHERE variant_id=? AND size_name=? AND stock >= ?",
                    (quantity, vid, size_name, quantity))
        cur.execute("UPDATE product_variants SET stock = (SELECT COALESCE(SUM(stock),0) FROM variant_sizes WHERE variant_id=?) WHERE id=?",
                    (vid, vid))
        log_stock_change(cur, product_id, -quantity, before, f"Order deduction (variant {vid}, {color_name}/{size_name})")
        return (True, None)
    cur.execute("SELECT stock FROM product_sizes WHERE product_id=? AND size=?", (product_id, size_name))
    srow = cur.fetchone()
    if not srow:
        return (False, "Taille introuvable pour ce produit")
    before = srow['stock']
    if before < quantity:
        return (False, f"Stock insuffisant pour cette taille ({before} restant(s))")
    cur.execute("UPDATE product_sizes SET stock = stock - ? WHERE product_id=? AND size=? AND stock >= ?",
                (quantity, product_id, size_name, quantity))
    log_stock_change(cur, product_id, -quantity, before, f"Order deduction (legacy, {size_name})")
    return (True, None)

def restore_order_stock(cur, product_id, color_name, size_name, quantity):
    """Restore stock on cancellation. Returns (success, message)."""
    vid, _ = _find_variant(cur, product_id, color_name)
    if vid:
        cur.execute("SELECT stock FROM variant_sizes WHERE variant_id=? AND size_name=?", (vid, size_name))
        srow = cur.fetchone()
        if not srow:
            return (False, "Taille introuvable pour cette variante")
        before = srow['stock']
        cur.execute("UPDATE variant_sizes SET stock = stock + ? WHERE variant_id=? AND size_name=?", (quantity, vid, size_name))
        cur.execute("UPDATE product_variants SET stock = (SELECT COALESCE(SUM(stock),0) FROM variant_sizes WHERE variant_id=?) WHERE id=?",
                    (vid, vid))
        log_stock_change(cur, product_id, quantity, before, f"Restock (cancel order, variant {vid}, {color_name}/{size_name})")
        return (True, None)
    cur.execute("SELECT stock FROM product_sizes WHERE product_id=? AND size=?", (product_id, size_name))
    srow = cur.fetchone()
    if not srow:
        return (False, "Taille introuvable pour ce produit")
    before = srow['stock']
    cur.execute("UPDATE product_sizes SET stock = stock + ? WHERE product_id=? AND size=?", (quantity, product_id, size_name))
    log_stock_change(cur, product_id, quantity, before, f"Restock (cancel order, legacy, {size_name})")
    return (True, None)

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
        ('product_variants', 'sku', "TEXT DEFAULT ''"),
        ('product_variants', 'color_hex', "TEXT DEFAULT ''"),
        ('product_variants', 'sort_order', "INTEGER DEFAULT 0"),
        ('orders', 'customer_name', "TEXT DEFAULT ''"),
        ('orders', 'customer_phone', "TEXT DEFAULT ''"),
        ('orders', 'wilaya', "TEXT DEFAULT ''"),
        ('orders', 'commune', "TEXT DEFAULT ''"),
        ('orders', 'is_read', "INTEGER DEFAULT 0"),
        ('orders', 'delivery_fee', "REAL DEFAULT 0"),
    ]:
        try:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        except Exception:
            pass  # column already exists

    cur.execute("""CREATE TABLE IF NOT EXISTS variant_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS variant_sizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_id INTEGER NOT NULL,
        size_name TEXT NOT NULL,
        stock INTEGER DEFAULT 0,
        sku TEXT DEFAULT '',
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )""")

    # Migration: add sku column to variant_sizes if missing
    try:
        cur.execute("SELECT sku FROM variant_sizes LIMIT 1")
    except Exception:
        cur.execute("ALTER TABLE variant_sizes ADD COLUMN sku TEXT DEFAULT ''")

    cur.execute("""CREATE TABLE IF NOT EXISTS delivery_prices (
        wilaya_id INTEGER PRIMARY KEY,
        price REAL NOT NULL DEFAULT 0
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL DEFAULT '',
        setting_type TEXT NOT NULL DEFAULT 'text',
        category TEXT DEFAULT '',
        description TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    # Seed delivery_prices for all 58 wilayas if not present
    for wid in range(1, 59):
        cur.execute("SELECT 1 FROM delivery_prices WHERE wilaya_id=?", (wid,))
        if cur.fetchone() is None:
            cur.execute("INSERT INTO delivery_prices (wilaya_id, price) VALUES (?, 0)", (wid,))

    conn.commit()
    conn.close()

def seed_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS cnt FROM users WHERE role='admin'")
    row = cur.fetchone()
    if row['cnt'] == 0:
        import hashlib
        cur.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
                    ('admin', hashlib.sha256(b'admin123').hexdigest(), 'admin'))

    # Seed settings defaults (idempotent)
    settings_defaults = [
        ('store_name', 'ADALINA', 'text', 'store'),
        ('store_tagline', 'BOUTIQUE EN LIGNE', 'text', 'store'),
        ('store_description', 'Vêtements prêt-à-porter pour femmes — Découvrez une collection pensée pour sublimer chaque femme avec élégance.', 'text', 'store'),
        ('atelier_address', '𝐀𝐓𝐄𝐋𝐈𝐄𝐑 𝐀𝐃𝐀𝐋𝐈𝐍𝐀 • 𝐂𝐇𝐋𝐄𝐅', 'text', 'store'),
        ('opening_hours', '𝐃𝐢𝐬𝐩𝐨𝐧𝐢𝐛𝐥𝐞 𝟐𝟒𝐡/𝟐𝟒 𝐞𝐭 𝟕𝐣/𝟕', 'text', 'store'),
        ('currency', 'DZD', 'text', 'store'),
        ('timezone', 'Africa/Algiers', 'text', 'store'),
        ('primary_color', '#c9a96e', 'text', 'appearance'),
        ('primary_dark', '#b8944f', 'text', 'appearance'),
        ('secondary_color', '#1a1a2e', 'text', 'appearance'),
        ('background_color', '#f5f6fa', 'text', 'appearance'),
        ('cream_color', '#faf6f0', 'text', 'appearance'),
        ('text_color', '#2d3748', 'text', 'appearance'),
        ('text_light_color', '#718096', 'text', 'appearance'),
        ('border_color', '#e2e8f0', 'text', 'appearance'),
        ('heading_font', 'Cormorant Garamond', 'text', 'appearance'),
        ('body_font', 'Manrope', 'text', 'appearance'),
        ('button_font', 'Manrope', 'text', 'appearance'),
        ('nav_font', 'Manrope', 'text', 'appearance'),
        ('instagram_url', 'https://www.instagram.com/adalina.boutique', 'text', 'social'),
        ('hero_slogan', 'Élégance et Raffinement', 'text', 'homepage'),
        ('hero_button_text', 'Explorer la Collection', 'text', 'homepage'),
        ('hero_button_link', 'shop.html', 'text', 'homepage'),
        ('announcement_text', 'Livraison dans les 58 wilayas | Paiement à la livraison', 'text', 'homepage'),
        ('announcement_speed', '5000', 'number', 'homepage'),
        ('collection_title', 'Nos Collections', 'text', 'homepage'),
        ('site_title', 'ADALINA — Élégance et Raffinement', 'text', 'seo'),
        ('meta_description', 'Mode féminine de luxe et parfums pour la femme moderne.', 'text', 'seo'),
        ('meta_keywords', 'mode, femme, luxe, parfums, algérie, boutique', 'text', 'seo'),
        ('delivery_info', 'Livraison dans les 58 wilayas', 'text', 'seo'),
        ('free_shipping_threshold', '0', 'number', 'seo'),
        ('delivery_fee', '0', 'number', 'seo'),
        ('maintenance_mode', '0', 'boolean', 'seo'),
        ('registration_enabled', '1', 'boolean', 'seo'),
        ('guest_checkout', '1', 'boolean', 'seo'),
        ('order_notifications', '1', 'boolean', 'seo'),
        ('default_language', 'fr', 'text', 'seo'),
    ]
    for key, val, typ, cat in settings_defaults:
        cur.execute("SELECT id FROM settings WHERE setting_key=?", (key,))
        if cur.fetchone() is None:
            cur.execute(
                "INSERT INTO settings (setting_key, setting_value, setting_type, category) VALUES (?, ?, ?, ?)",
                (key, val, typ, cat)
            )

    conn.commit()
    conn.close()
