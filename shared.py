import sys
import os
import json
import time
import logging
import subprocess
from pathlib import Path

from config.database import get_public_db

logger = logging.getLogger('adalina')

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
        try:
            h = (h * 31 + int(os.path.getmtime(BASE_DIR / f))) & 0xFFFFFFFF
        except Exception:
            pass
    return format(h, 'x')[-8:]


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


def _signal_cache_invalidate():
    try:
        signal_path = BASE_DIR / '.cache_invalidate'
        signal_path.write_text(str(time.time()))
    except Exception:
        pass
    _cache.invalidate()


def rows_to_list(rows):
    return [dict(r) for r in rows]


def row_to_dict(row):
    return dict(row) if row else None


def _ensure_columns():
    from config.database import get_db as _get_admin_db
    db = None
    try:
        db = _get_admin_db()
        cur = db.cursor()
        cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_mode TEXT DEFAULT ''")
        cur.execute("ALTER TABLE delivery_prices ADD COLUMN IF NOT EXISTS wilaya TEXT DEFAULT ''")
        cur.execute("ALTER TABLE delivery_prices ADD COLUMN IF NOT EXISTS min_days INTEGER DEFAULT 2")
        cur.execute("ALTER TABLE delivery_prices ADD COLUMN IF NOT EXISTS max_days INTEGER DEFAULT 5")
        db.commit()
        logger.info('[startup] column migration verified')
    except Exception as e:
        logger.warning(f'[startup] Column migration check failed (non-fatal): {e}')
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


def _process_order_background(order_number, items, customer_name, customer_phone, wilaya, data):
    from admin.database import deduct_order_stock
    db = None
    try:
        logger.info(f'[{order_number}] Background thread started, connecting to DB...')
        db = get_public_db()
        cur = db.cursor()
        logger.info(f'[{order_number}] DB connected, checking columns...')
        try:
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name='delivery_mode'")
            has_dm = cur.fetchone()
            logger.info(f'[{order_number}] delivery_mode column exists: {bool(has_dm)}')
        except Exception as col_err:
            logger.warning(f'[{order_number}] Column check failed: {col_err}')

        commune = (data.get('commune') or '').strip()
        shipping = data.get('shipping', '')
        shipping_address = f"Name: {customer_name}, Phone: {customer_phone}, Address: {shipping}"
        payment = data.get('payment_method', 'Cash on Delivery')

        server_total = 0
        product_ids = [item.get('product_id') for item in items]
        price_map = {}
        if product_ids:
            placeholders = ','.join(['%s'] * len(product_ids))
            cur.execute(f"SELECT id, price, sale_price FROM products WHERE id IN ({placeholders})", product_ids)
            price_map = {r['id']: r for r in cur.fetchall()}
            logger.info(f'[{order_number}] Found {len(price_map)}/{len(product_ids)} products')
        stock_warnings = []
        for item in items:
            pid = item.get('product_id')
            qty = item.get('quantity') or 1
            color = item.get('color') or item.get('selectedColor') or ''
            size = item.get('size') or item.get('selectedSize') or ''

            prod = price_map.get(pid)
            if not prod:
                logger.warning(f'[{order_number}] product {pid} not found, skipping')
                continue
            unit_price = prod['sale_price'] if prod['sale_price'] else prod['price']
            server_total += (unit_price or 0) * qty

            try:
                ok, err = deduct_order_stock(cur, pid, color, size, qty)
                if not ok:
                    stock_warnings.append(f'{pid}: {err}')
                    logger.warning(f'[{order_number}] stock deduction skipped for {pid}: {err}')
            except Exception as stock_err:
                stock_warnings.append(f'{pid}: {stock_err}')
                logger.warning(f'[{order_number}] stock deduction error for {pid}: {stock_err}')

        delivery_fee = 0
        wid = data.get('wilaya_id')
        delivery_mode = (data.get('delivery_mode') or '').strip()
        if wid is not None:
            try:
                wid = int(wid)
                cur.execute("SELECT price FROM delivery_prices WHERE wilaya_id=%s", (wid,))
                dp = cur.fetchone()
                if dp:
                    delivery_fee = dp['price']
            except (ValueError, TypeError):
                pass

        logger.info(f'[{order_number}] Inserting order: total={server_total}, delivery_fee={delivery_fee}, delivery_mode={delivery_mode}, wilaya={wilaya}')
        cur.execute("""
            INSERT INTO orders (order_number, customer_id, customer_name, customer_phone, wilaya, commune, status, total, items, shipping_address, payment_method, delivery_fee, delivery_mode)
            VALUES (%s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (order_number, customer_name, customer_phone, wilaya, commune, 'new', server_total, json.dumps(items), shipping_address, payment, delivery_fee, delivery_mode))

        oid = cur.fetchone()['id']
        logger.info(f'[{order_number}] Order inserted with id={oid}, inserting status history...')
        cur.execute("INSERT INTO status_history (order_id, status, note) VALUES (%s, %s, %s)",
                    (oid, 'new', 'Commande créée'))
        logger.info(f'[{order_number}] Committing...')
        db.commit()
        logger.info(f'[{order_number}] Committed! Order created successfully (id={oid})')
        _cache.invalidate('products')
        _cache.invalidate('featured')
    except Exception as e:
        logger.exception(f'[{order_number}] Background order FAILED')
        if db:
            try:
                db.rollback()
                logger.info(f'[{order_number}] Rolled back after error')
            except Exception:
                pass
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass
