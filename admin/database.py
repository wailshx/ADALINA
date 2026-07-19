import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.database import get_db

def log_stock_change(cur, product_id, stock_change, quantity_before, reason=''):
    quantity_after = quantity_before + stock_change
    cur.execute("""INSERT INTO stock_history (product_id, stock_change, quantity_before, quantity_after, reason)
                   VALUES (%s, %s, %s, %s, %s)""",
                (product_id, stock_change, quantity_before, quantity_after, reason))

def _find_variant(cur, product_id, color_name):
    cur.execute("SELECT id FROM product_variants WHERE product_id=%s AND color_name=%s LIMIT 1", (product_id, color_name))
    row = cur.fetchone()
    if row:
        return (row['id'], None)
    if color_name:
        return (None, None)
    cur.execute("SELECT id FROM product_variants WHERE product_id=%s LIMIT 1", (product_id,))
    row = cur.fetchone()
    if row:
        return (row['id'], None)
    return (None, None)

def get_variant_stock(cur, product_id, color_name, size_name):
    vid, _ = _find_variant(cur, product_id, color_name)
    if vid:
        cur.execute("SELECT stock FROM variant_sizes WHERE variant_id=%s AND size_name=%s", (vid, size_name))
        srow = cur.fetchone()
        if srow:
            return (srow['stock'], None)
        return (0, "Taille introuvable pour cette variante")
    cur.execute("SELECT stock FROM product_sizes WHERE product_id=%s AND size=%s", (product_id, size_name))
    srow = cur.fetchone()
    if srow:
        return (srow['stock'], None)
    return (0, "Taille introuvable pour ce produit")

def deduct_order_stock(cur, product_id, color_name, size_name, quantity):
    vid, _ = _find_variant(cur, product_id, color_name)
    if vid:
        cur.execute("SELECT stock FROM variant_sizes WHERE variant_id=%s AND size_name=%s", (vid, size_name))
        srow = cur.fetchone()
        if not srow:
            return (False, "Taille introuvable pour cette variante")
        before = srow['stock']
        if before < quantity:
            return (False, f"Stock insuffisant pour cette taille ({before} restant(s))")
        cur.execute("UPDATE variant_sizes SET stock = stock - %s WHERE variant_id=%s AND size_name=%s AND stock >= %s",
                    (quantity, vid, size_name, quantity))
        cur.execute("UPDATE product_variants SET stock = (SELECT COALESCE(SUM(stock),0) FROM variant_sizes WHERE variant_id=%s) WHERE id=%s",
                    (vid, vid))
        log_stock_change(cur, product_id, -quantity, before, f"Order deduction (variant {vid}, {color_name}/{size_name})")
        return (True, None)
    cur.execute("SELECT stock FROM product_sizes WHERE product_id=%s AND size=%s", (product_id, size_name))
    srow = cur.fetchone()
    if not srow:
        return (False, "Taille introuvable pour ce produit")
    before = srow['stock']
    if before < quantity:
        return (False, f"Stock insuffisant pour cette taille ({before} restant(s))")
    cur.execute("UPDATE product_sizes SET stock = stock - %s WHERE product_id=%s AND size=%s AND stock >= %s",
                (quantity, product_id, size_name, quantity))
    log_stock_change(cur, product_id, -quantity, before, f"Order deduction (legacy, {size_name})")
    return (True, None)

def restore_order_stock(cur, product_id, color_name, size_name, quantity):
    vid, _ = _find_variant(cur, product_id, color_name)
    if vid:
        cur.execute("SELECT stock FROM variant_sizes WHERE variant_id=%s AND size_name=%s", (vid, size_name))
        srow = cur.fetchone()
        if not srow:
            return (False, "Taille introuvable pour cette variante")
        before = srow['stock']
        cur.execute("UPDATE variant_sizes SET stock = stock + %s WHERE variant_id=%s AND size_name=%s", (quantity, vid, size_name))
        cur.execute("UPDATE product_variants SET stock = (SELECT COALESCE(SUM(stock),0) FROM variant_sizes WHERE variant_id=%s) WHERE id=%s",
                    (vid, vid))
        log_stock_change(cur, product_id, quantity, before, f"Restock (cancel order, variant {vid}, {color_name}/{size_name})")
        return (True, None)
    cur.execute("SELECT stock FROM product_sizes WHERE product_id=%s AND size=%s", (product_id, size_name))
    srow = cur.fetchone()
    if not srow:
        return (False, "Taille introuvable pour ce produit")
    before = srow['stock']
    cur.execute("UPDATE product_sizes SET stock = stock + %s WHERE product_id=%s AND size=%s", (quantity, product_id, size_name))
    log_stock_change(cur, product_id, quantity, before, f"Restock (cancel order, legacy, {size_name})")
    return (True, None)

def _tables_exist(conn):
    cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_name='products'")
        row = cur.fetchone()
        return (row['cnt'] if row else 0) > 0
    finally:
        cur.close()

def _run_migrations(conn):
    cur = conn.cursor()
    try:
        migrations = [
            """CREATE TABLE IF NOT EXISTS status_history (
                id SERIAL PRIMARY KEY,
                order_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
            )""",
            """CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                event_type TEXT NOT NULL,
                details TEXT DEFAULT '',
                ip TEXT DEFAULT '',
                username TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS search_events (
                id SERIAL PRIMARY KEY,
                event_type VARCHAR(50),
                payload JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS wishlists (
                id SERIAL PRIMARY KEY,
                hash TEXT UNIQUE NOT NULL,
                product_ids TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
            )""",
        ]
        for sql in migrations:
            try:
                cur.execute(sql)
            except Exception:
                pass
        idx_migrations = [
            "CREATE INDEX IF NOT EXISTS idx_products_category_status ON products(category_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = 1",
            "CREATE INDEX IF NOT EXISTS idx_products_status_featured ON products(status, featured, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_products_name_search ON products USING gin(name gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS idx_variant_sizes_variant_stock ON variant_sizes(variant_id, size_name, stock)",
            "CREATE INDEX IF NOT EXISTS idx_variant_sizes_variant_name ON variant_sizes(variant_id, size_name)",
            "CREATE INDEX IF NOT EXISTS idx_orders_is_read ON orders(is_read)",
            "CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_product_variants_product_color ON product_variants(product_id, color_name)",
            "CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON variant_images(variant_id)",
            "CREATE INDEX IF NOT EXISTS idx_variant_sizes_variant ON variant_sizes(variant_id)",
            "CREATE INDEX IF NOT EXISTS idx_product_sizes_product ON product_sizes(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_product_colors_product ON product_colors(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_stock_history_product ON stock_history(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(setting_key)",
            "CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name)",
            "CREATE INDEX IF NOT EXISTS idx_status_history_order ON status_history(order_id)",
            "CREATE INDEX IF NOT EXISTS idx_collection_products_product ON collection_products(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_collection_products_collection ON collection_products(collection_id)",
            "CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name)",
            "CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)",
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)",
        ]
        for idx_sql in idx_migrations:
            try:
                cur.execute(idx_sql)
            except Exception:
                pass
        rls_tables = [
            'users', 'categories', 'products', 'product_sizes', 'product_colors',
            'product_variants', 'collections', 'collection_products', 'customers',
            'orders', 'inventory', 'stock_history', 'variant_images', 'variant_sizes',
            'delivery_prices', 'settings', 'audit_logs', 'status_history', 'search_events',
        ]
        for tbl in rls_tables:
            try:
                cur.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
            except Exception:
                pass
        for tbl in rls_tables:
            try:
                cur.execute(f"GRANT ALL ON TABLE {tbl} TO service_role")
            except Exception:
                pass
        for tbl in rls_tables:
            try:
                cur.execute(f"""CREATE POLICY IF NOT EXISTS "allow_all_{tbl}" ON {tbl}
                    FOR ALL USING (true) WITH CHECK (true)""")
            except Exception:
                pass
        try:
            cur.execute("ALTER TABLE delivery_prices ADD COLUMN IF NOT EXISTS wilaya TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            cur.execute("ALTER TABLE delivery_prices ADD COLUMN IF NOT EXISTS min_days INTEGER DEFAULT 2")
        except Exception:
            pass
        try:
            cur.execute("ALTER TABLE delivery_prices ADD COLUMN IF NOT EXISTS max_days INTEGER DEFAULT 5")
        except Exception:
            pass
        try:
            cur.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role")
        except Exception:
            pass
        try:
            cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT DEFAULT ''")
        except Exception:
            pass
        _seed_delivery_times(cur)
        conn.commit()
    finally:
        cur.close()

def _seed_delivery_times(cur):
    wilaya_times = {
        'Alger': (1, 2), 'Oran': (1, 2), 'Constantine': (1, 2), 'Annaba': (1, 2),
        'Blida': (2, 3), 'Sétif': (2, 3), 'Tlemcen': (2, 3), 'Béjaïa': (2, 3),
        'Batna': (2, 3), 'Tizi Ouzou': (2, 3), 'Biskra': (3, 5), 'Bouira': (3, 5),
        'Médéa': (3, 5), 'Mostaganem': (3, 5), "M'sila": (3, 5), 'Mascara': (3, 5),
        'Chlef': (3, 5), 'Tébessa': (3, 5), 'Tiaret': (3, 5), 'Saïda': (3, 5),
        'Skikda': (3, 5), 'Jijel': (3, 5), 'Sidi Bel Abbès': (3, 5), 'Guelma': (3, 5),
        'Mila': (3, 5), 'Boumerdès': (3, 5), 'El Tarf': (3, 5), 'Tissemsilt': (3, 5),
        'El Oued': (3, 5), 'Khenchela': (3, 5), 'Souk Ahras': (3, 5), 'Tipaza': (3, 5),
        'Aïn Defla': (3, 5), 'Naâma': (3, 5), 'Aïn Témouchent': (3, 5), 'Relizane': (3, 5),
        'Ouargla': (3, 5), 'Ghardaïa': (3, 5), 'El Bayadh': (3, 5),
        'Bordj Bou Arreridj': (3, 5), 'Oum El Bouaghi': (3, 5), 'Laghouat': (4, 7),
        'Djelfa': (4, 7), 'Tamanrasset': (5, 10), 'Adrar': (5, 10), 'Illizi': (5, 10),
        'Béchar': (5, 10), 'Tindouf': (5, 10), 'Bordj Badji Mokhtar': (5, 10),
        'Timimoun': (5, 10), "El M'Ghair": (5, 10), 'El Meniaa': (5, 10),
        'Béni Abbès': (5, 10), 'In Salah': (5, 10), 'In Guezzam': (5, 10),
        'Touggourt': (5, 10), 'Djanet': (5, 10), 'Ouled Djellal': (5, 10),
    }
    wilaya_names = {
        1: 'Adrar', 2: 'Chlef', 3: 'Laghouat', 4: 'Oum El Bouaghi', 5: 'Batna',
        6: 'Béjaïa', 7: 'Biskra', 8: 'Béchar', 9: 'Blida', 10: 'Bouira',
        11: 'Tamanrasset', 12: 'Tébessa', 13: 'Tlemcen', 14: 'Tiaret', 15: 'Tizi Ouzou',
        16: 'Alger', 17: 'Djelfa', 18: 'Jijel', 19: 'Sétif', 20: 'Saïda',
        21: 'Skikda', 22: 'Sidi Bel Abbès', 23: 'Annaba', 24: 'Guelma', 25: 'Constantine',
        26: 'Médéa', 27: 'Mostaganem', 28: "M'sila", 29: 'Mascara', 30: 'Ouargla',
        31: 'Oran', 32: 'El Bayadh', 33: 'Illizi', 34: 'Bordj Bou Arreridj',
        35: 'Boumerdès', 36: 'El Tarf', 37: 'Tindouf', 38: 'Tissemsilt', 39: 'El Oued',
        40: 'Khenchela', 41: 'Souk Ahras', 42: 'Tipaza', 43: 'Mila', 44: 'Aïn Defla',
        45: 'Naâma', 46: 'Aïn Témouchent', 47: 'Ghardaïa', 48: 'Relizane', 49: 'Timimoun',
        50: 'Bordj Badji Mokhtar', 51: 'Ouled Djellal', 52: 'Béni Abbès',
        53: 'In Salah', 54: 'In Guezzam', 55: 'Touggourt', 56: 'Djanet',
        57: "El M'Ghair", 58: 'El Meniaa',
    }
    for wid in range(1, 59):
        name = wilaya_names.get(wid, '')
        mn, mx = wilaya_times.get(name, (3, 5))
        try:
            cur.execute("UPDATE delivery_prices SET wilaya=%s, min_days=%s, max_days=%s WHERE wilaya_id=%s AND (min_days IS NULL OR min_days = 2 AND max_days = 5)", (name, mn, mx, wid))
        except Exception:
            pass
        try:
            cur.execute("INSERT INTO delivery_prices (wilaya_id, wilaya, price, min_days, max_days) VALUES (%s, %s, 0, %s, %s) ON CONFLICT (wilaya_id) DO NOTHING", (wid, name, mn, mx))
        except Exception:
            pass


def init_db():
    conn = get_db()
    if _tables_exist(conn):
        _run_migrations(conn)
        conn.close()
        return
    cur = conn.cursor()

    cur.execute("""CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT NOW()
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        image TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        size_system TEXT DEFAULT 'standard'
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price DOUBLE PRECISION NOT NULL,
        sale_price DOUBLE PRECISION DEFAULT NULL,
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
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (category_id) REFERENCES categories(id)
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS product_sizes (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        size TEXT NOT NULL,
        stock INTEGER DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS product_colors (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        color_name TEXT NOT NULL,
        color_hex TEXT DEFAULT '',
        stock INTEGER DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS product_variants (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        color_name TEXT DEFAULT '',
        size_name TEXT DEFAULT '',
        sku TEXT DEFAULT '',
        color_hex TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        stock INTEGER DEFAULT 0,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS collections (
        id SERIAL PRIMARY KEY,
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
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT DEFAULT '',
        address TEXT,
        avatar TEXT DEFAULT '',
        orders_count INTEGER DEFAULT 0,
        total_spent DOUBLE PRECISION DEFAULT 0,
        status TEXT DEFAULT 'active',
        joined_at TIMESTAMP DEFAULT NOW()
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER DEFAULT NULL,
        customer_name TEXT DEFAULT '',
        customer_phone TEXT DEFAULT '',
        wilaya TEXT DEFAULT '',
        commune TEXT DEFAULT '',
        status TEXT DEFAULT 'new',
        total DOUBLE PRECISION DEFAULT 0,
        items TEXT,
        shipping_address TEXT,
        payment_method TEXT DEFAULT '',
        is_read INTEGER DEFAULT 0,
        delivery_fee DOUBLE PRECISION DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
    )""")

    cur.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='delivery_mode') THEN ALTER TABLE orders ADD COLUMN delivery_mode TEXT DEFAULT ''; END IF; END $$")

    cur.execute("""CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        product_id INTEGER UNIQUE NOT NULL,
        quantity INTEGER DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 5,
        updated_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS stock_history (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        stock_change INTEGER NOT NULL,
        quantity_before INTEGER NOT NULL,
        quantity_after INTEGER NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS variant_images (
        id SERIAL PRIMARY KEY,
        variant_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS variant_sizes (
        id SERIAL PRIMARY KEY,
        variant_id INTEGER NOT NULL,
        size_name TEXT NOT NULL,
        stock INTEGER DEFAULT 0,
        sku TEXT DEFAULT '',
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS delivery_prices (
        wilaya_id INTEGER PRIMARY KEY,
        wilaya TEXT DEFAULT '',
        price DOUBLE PRECISION NOT NULL DEFAULT 0,
        min_days INTEGER DEFAULT 2,
        max_days INTEGER DEFAULT 5
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL DEFAULT '',
        setting_type TEXT NOT NULL DEFAULT 'text',
        category TEXT DEFAULT '',
        description TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT NOW()
    )""")

    cur.execute("""CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT NOW(),
        admin_user TEXT NOT NULL DEFAULT 'admin',
        action TEXT NOT NULL,
        ip TEXT DEFAULT '',
        resource TEXT DEFAULT '',
        details TEXT DEFAULT ''
    )""")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS status_history (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW(),
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
    """)

    cur.execute("""CREATE TABLE IF NOT EXISTS search_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50),
        payload JSONB,
        created_at TIMESTAMP DEFAULT NOW()
    )""")

    cur.execute('''CREATE TABLE IF NOT EXISTS wishlists (
        id SERIAL PRIMARY KEY,
        hash TEXT UNIQUE NOT NULL,
        product_ids TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
    )''')

    for wid in range(1, 59):
        cur.execute("INSERT INTO delivery_prices (wilaya_id, price) VALUES (%s, 0) ON CONFLICT (wilaya_id) DO NOTHING", (wid,))

    _seed_delivery_times(cur)

    # Performance indexes
    for idx_sql in [
        'CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)',
        'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)',
        'CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured) WHERE featured = 1',
        'CREATE INDEX IF NOT EXISTS idx_products_status_featured ON products(status, featured, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id)',
        'CREATE INDEX IF NOT EXISTS idx_product_variants_product_color ON product_variants(product_id, color_name)',
        'CREATE INDEX IF NOT EXISTS idx_variant_images_variant ON variant_images(variant_id)',
        'CREATE INDEX IF NOT EXISTS idx_variant_sizes_variant ON variant_sizes(variant_id)',
        'CREATE INDEX IF NOT EXISTS idx_variant_sizes_variant_name ON variant_sizes(variant_id, size_name)',
        'CREATE INDEX IF NOT EXISTS idx_product_sizes_product ON product_sizes(product_id)',
        'CREATE INDEX IF NOT EXISTS idx_product_colors_product ON product_colors(product_id)',
        'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
        'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)',
        'CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_stock_history_product ON stock_history(product_id)',
        'CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id)',
        'CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(setting_key)',
        'CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name)',
        "CREATE INDEX IF NOT EXISTS idx_status_history_order ON status_history(order_id)",
        "CREATE INDEX IF NOT EXISTS idx_products_category_status ON products(category_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_variant_sizes_variant_stock ON variant_sizes(variant_id, size_name, stock)",
        "CREATE INDEX IF NOT EXISTS idx_orders_is_read ON orders(is_read)",
        "CREATE INDEX IF NOT EXISTS idx_collection_products_product ON collection_products(product_id)",
        "CREATE INDEX IF NOT EXISTS idx_collection_products_collection ON collection_products(collection_id)",
        "CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name)",
        "CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)",
    ]:
        cur.execute(idx_sql)

    rls_tables = [
        'users', 'categories', 'products', 'product_sizes', 'product_colors',
        'product_variants', 'collections', 'collection_products', 'customers',
        'orders', 'inventory', 'stock_history', 'variant_images', 'variant_sizes',
        'delivery_prices', 'settings', 'audit_logs', 'status_history', 'search_events',
    ]
    for tbl in rls_tables:
        try:
            cur.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
        except Exception:
            pass
    for tbl in rls_tables:
        try:
            cur.execute(f"GRANT ALL ON TABLE {tbl} TO service_role")
        except Exception:
            pass
    for tbl in rls_tables:
        try:
            cur.execute(f"""CREATE POLICY IF NOT EXISTS "service_role_all_{tbl}" ON {tbl}
                FOR ALL TO service_role USING (true) WITH CHECK (true)""")
        except Exception:
            pass
    for tbl in rls_tables:
        try:
            cur.execute(f"""CREATE POLICY IF NOT EXISTS "public_all_{tbl}" ON {tbl}
                FOR ALL TO PUBLIC USING (true) WITH CHECK (true)""")
        except Exception:
            pass
    try:
        cur.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role")
    except Exception:
        pass
    try:
        cur.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO PUBLIC")
    except Exception:
        pass

    conn.commit()
    conn.close()

def seed_db():
    conn = get_db()
    if _tables_exist(conn):
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS cnt FROM settings")
        row = cur.fetchone()
        if row['cnt'] > 0:
            conn.close()
            migrate_taille_stock()
            return
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) AS cnt FROM users WHERE role='admin'")
    row = cur.fetchone()
    if row['cnt'] == 0:
        import hashlib
        cur.execute("INSERT INTO users (username, password, role) VALUES (%s, %s, %s)",
                    ('admin', hashlib.sha256(b'admin123').hexdigest(), 'admin'))

    cur.execute("SELECT id FROM categories WHERE name ILIKE '%abay%'")
    row = cur.fetchone()
    if row is None:
        cur.execute("INSERT INTO categories (name, slug, description, image, status, size_system) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (name) DO NOTHING",
                    ('Abaya', 'abaya', '', '', 'active', 'grouped_taille'))
    else:
        cur.execute("UPDATE categories SET size_system='grouped_taille' WHERE id=%s", (row['id'],))

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
        cur.execute(
            "INSERT INTO settings (setting_key, setting_value, setting_type, category) VALUES (%s, %s, %s, %s) ON CONFLICT (setting_key) DO NOTHING",
            (key, val, typ, cat)
        )

    conn.commit()
    conn.close()

    migrate_taille_stock()

    conn2 = get_db()
    cur2 = conn2.cursor()
    _seed_delivery_times(cur2)
    conn2.commit()
    conn2.close()


TAILLE_GROUP_MAP = {32: 'Taille 1', 34: 'Taille 1', 36: 'Taille 1', 38: 'Taille 1',
                    40: 'Taille 2', 42: 'Taille 2', 44: 'Taille 2', 46: 'Taille 2',
                    48: 'Taille 3', 50: 'Taille 3', 52: 'Taille 3'}
GROUP_SIZES_INFO = {'Taille 1': [32, 34, 36, 38],
                    'Taille 2': [40, 42, 44, 46],
                    'Taille 3': [48, 50, 52]}


def migrate_taille_stock():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT p.id AS pid, p.name AS pname, pv.id AS vid, pv.color_name,
               vs.id AS vsid, vs.size_name, vs.stock, vs.sku
        FROM products p
        JOIN categories c ON p.category_id = c.id
        JOIN product_variants pv ON pv.product_id = p.id
        JOIN variant_sizes vs ON vs.variant_id = pv.id
        WHERE c.size_system = 'grouped_taille'
        ORDER BY p.id, pv.id, vs.id
    """)
    rows = cur.fetchall()
    if not rows:
        conn.close()
        return []

    variant_sizes = {}
    for r in rows:
        key = (r['pid'], r['vid'], r['pname'], r['color_name'])
        if key not in variant_sizes:
            variant_sizes[key] = []
        variant_sizes[key].append({'vsid': r['vsid'], 'size': r['size_name'],
                                    'stock': r['stock'] or 0, 'sku': r['sku'] or ''})

    report = []
    for (pid, vid, pname, color), sizes in variant_sizes.items():
        numeric = [s for s in sizes if s['size'].isdigit()]
        if not numeric:
            continue

        groups = {}
        sku_pick = {}
        for s in sizes:
            num = int(s['size'])
            grp = TAILLE_GROUP_MAP.get(num)
            if grp is None:
                continue
            if grp not in groups:
                groups[grp] = 0
                sku_pick[grp] = s['sku']
            groups[grp] += s['stock']
            if not sku_pick[grp] and s['sku']:
                sku_pick[grp] = s['sku']

        vsids = [s['vsid'] for s in sizes]
        placeholders = ','.join(['%s'] * len(vsids))
        cur.execute(f"DELETE FROM variant_sizes WHERE id IN ({placeholders})", vsids)

        for grp in ['Taille 1', 'Taille 2', 'Taille 3']:
            if grp in groups:
                cur.execute(
                    "INSERT INTO variant_sizes (variant_id, size_name, stock, sku) VALUES (%s, %s, %s, %s)",
                    (vid, grp, groups[grp], sku_pick.get(grp, ''))
                )

        group_names = sorted(groups.keys())
        cur.execute("UPDATE products SET sizes=%s WHERE id=%s", (json.dumps(group_names), pid))

        report.append({
            'product': pname, 'color': color, 'variant_id': vid,
            'before': {s['size']: {'stock': s['stock'], 'sku': s['sku']} for s in sizes},
            'after': {grp: {'stock': groups.get(grp, 0), 'sku': sku_pick.get(grp, '')} for grp in ['Taille 1', 'Taille 2', 'Taille 3'] if grp in groups}
        })

    conn.commit()
    conn.close()
    return report
