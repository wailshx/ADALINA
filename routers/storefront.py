import json
import datetime
import random
import logging
import hashlib
import time

from fastapi import APIRouter, Request, Query, BackgroundTasks
from starlette.responses import JSONResponse as _StarletteJSONResponse
from config.database import get_public_db
from config.security import RateLimiter, get_client_ip, escape_html

from shared import _cache, format_product, batch_format_products, _process_order_background

logger = logging.getLogger('adalina')

router = APIRouter()
_order_limiter = RateLimiter()
_cleanup_counter = 0


def _rows_to_list(rows):
    return [dict(r) for r in rows]


def _get_client_ip(request: Request) -> str:
    real_ip = request.headers.get('X-Real-For', '')
    if real_ip:
        return real_ip.split(',')[0].strip()
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    if request.client:
        return request.client.host
    return 'unknown'


class _SafeJSONResponse(_StarletteJSONResponse):
    def render(self, content) -> bytes:
        import datetime as _dt
        def _default(o):
            if isinstance(o, (_dt.datetime, _dt.date, _dt.time)):
                return o.isoformat()
            raise TypeError(f'Object of type {type(o).__name__} is not JSON serializable')
        return json.dumps(content, default=_default, ensure_ascii=False, allow_nan=False, indent=None, separators=(',', ':')).encode('utf-8')


def _json_response(data, status=200, max_age=None):
    headers = {}
    if max_age is not None:
        headers['Cache-Control'] = f'public, max-age={max_age}'
    else:
        headers['Cache-Control'] = 'no-store, must-revalidate'
    return _SafeJSONResponse(content=data, status_code=status, headers=headers)


# ─── GET Routes ──────────────────────────────────────────────────────────────


@router.get('/api/public/products')
def list_products(
    request: Request,
    page: int = Query(1),
    limit: int = Query(0),
    search: str = Query(''),
    category: str = Query(''),
    featured: str = Query(''),
    sort: str = Query('newest'),
    collection: str = Query(''),
    color: str = Query(''),
    size: str = Query(''),
    price_min: str = Query(''),
    price_max: str = Query(''),
    new_arrival: str = Query(''),
    in_stock: str = Query(''),
):
    global _cleanup_counter
    _cleanup_counter += 1
    if _cleanup_counter % 100 == 0:
        _order_limiter.cleanup()

    db = None
    try:
        db = get_public_db()
        cur = db.cursor()

        search = search.strip().lower()
        category = category.strip().lower()
        featured_only = featured.strip().lower() == 'true'
        sort = sort.strip().lower()
        collection = collection.strip()
        color = color.strip().lower()
        size = size.strip()
        price_min = price_min.strip()
        price_max = price_max.strip()
        new_arrival = new_arrival.strip().lower() == 'true'
        in_stock = in_stock.strip().lower() == 'true'

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
                return _json_response(response, max_age=30)
            else:
                return _json_response(response)
        else:
            use_cache = not (search or category or collection or color or size or price_min or price_max or new_arrival or in_stock or featured_only)
            cache_key = 'all_products'
            if use_cache:
                cached = _cache.get(cache_key, ttl=60)
                if cached is not None:
                    return _json_response(cached, max_age=60)
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
            return _json_response(result, max_age=60)
    except Exception as e:
        logger.exception('[Storefront] Error loading products')
        return _json_response({'error': 'Erreur lors du chargement des produits'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/products/featured')
def get_featured_products():
    cached = _cache.get('featured', ttl=300)
    if cached is not None:
        return _json_response(cached, max_age=300)
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
        return _json_response(result, max_age=300)
    except Exception as e:
        logger.exception('[Storefront] Error loading featured')
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/products/filters')
def get_product_filters():
    cached = _cache.get('product_filters', ttl=300)
    if cached is not None:
        return _json_response(cached, max_age=300)
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
        return _json_response(result, max_age=300)
    except Exception as e:
        logger.exception('[Storefront] Error loading filters')
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/products/{pid}/recommendations')
def get_recommendations(pid: str):
    cache_key = f'recommendations:{pid}'
    cached = _cache.get(cache_key, ttl=120)
    if cached is not None:
        return _json_response(cached, max_age=300)
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
        return _json_response(result)
    except Exception as e:
        logger.exception(f'[Storefront] Error loading recommendations for {pid}')
        return _json_response([], status=200)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/products/{pid}')
def get_product(pid: str):
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
            return _json_response({'error': 'Not found'}, status=404)
        return _json_response(format_product(row, cur), max_age=60)
    except Exception as e:
        logger.exception("Error loading product %s", pid)
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/categories')
def list_categories():
    cached = _cache.get('categories', ttl=300)
    if cached is not None:
        return _json_response(cached, max_age=300)
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
        result = _rows_to_list(rows)
        _cache.set('categories', result)
        return _json_response(result, max_age=300)
    except Exception as e:
        logger.exception('[Storefront] Error loading categories')
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/settings')
def get_settings():
    cached = _cache.get('settings', ttl=300)
    if cached is not None:
        return _json_response(cached, max_age=300)
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
                try:
                    val = float(val)
                except (ValueError, TypeError):
                    pass
            result[key] = val
        _cache.set('settings', result)
        return _json_response(result, max_age=300)
    except Exception as e:
        logger.exception('[Storefront] Error loading settings')
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/delivery-prices')
def get_delivery_prices():
    cached = _cache.get('delivery', ttl=600)
    if cached is not None:
        return _json_response(cached, max_age=300)
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
        return _json_response(result, max_age=300)
    except Exception as e:
        logger.exception('[Storefront] Error loading delivery')
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/collections')
def list_collections():
    cached = _cache.get('collections', ttl=300)
    if cached is not None:
        return _json_response(cached, max_age=300)
    db = None
    try:
        db = get_public_db()
        cur = db.cursor()
        cur.execute("SELECT * FROM collections WHERE status='active' ORDER BY id")
        collections = cur.fetchall()
        if not collections:
            _cache.set('collections', [])
            return _json_response([], max_age=300)
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
        return _json_response(result, max_age=300)
    except Exception as e:
        logger.exception('[Storefront] Error loading collections')
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/public/delivery-times')
def get_delivery_times():
    db = None
    try:
        db = get_public_db()
        cur = db.cursor()
        cur.execute("SELECT wilaya_id, COALESCE(NULLIF(wilaya,''), wilaya_id::text) AS wilaya, min_days, max_days FROM delivery_prices ORDER BY wilaya_id")
        rows = cur.fetchall()
        result = {r['wilaya']: {'min_days': r['min_days'], 'max_days': r['max_days'], 'wilaya_id': r['wilaya_id']} for r in rows}
        return _json_response(result, max_age=3600)
    except Exception as e:
        logger.exception('[Storefront] Error loading delivery times')
        return _json_response({}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


@router.get('/api/wishlist/{wl_hash}')
def get_shared_wishlist(wl_hash: str):
    db = None
    try:
        db = get_public_db()
        cur = db.cursor()
        cur.execute("SELECT product_ids FROM wishlists WHERE hash = %s AND expires_at > NOW()", (wl_hash,))
        row = cur.fetchone()
        if not row:
            return _json_response({'error': 'Wishlist not found or expired'}, status=404)
        product_ids = json.loads(row['product_ids'])
        if not product_ids:
            return _json_response({'products': []})
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
        return _json_response({'products': products, 'hash': wl_hash}, max_age=60)
    except Exception as e:
        logger.exception('[Storefront] Error loading wishlist')
        return _json_response({'error': 'Erreur serveur'}, status=500)
    finally:
        if db:
            try:
                db.close()
            except Exception:
                pass


# ─── POST Routes ─────────────────────────────────────────────────────────────


@router.post('/api/orders')
async def create_order(request: Request, background_tasks: BackgroundTasks):
    global _cleanup_counter
    _cleanup_counter += 1
    if _cleanup_counter % 100 == 0:
        _order_limiter.cleanup()

    ip = _get_client_ip(request)
    logger.info(f'POST /api/orders received from {ip}')
    if not _order_limiter.is_allowed(f'order:{ip}', max_requests=5, window=300):
        retry = _order_limiter.retry_after(f'order:{ip}', window=300)
        return JSONResponse(
            {'error': f'Trop de requêtes. Réessayez dans {retry}s.'},
            status_code=429,
            headers={'Retry-After': str(retry)}
        )
    try:
        content_length = int(request.headers.get('content-length', 0))
        if content_length > 1 * 1024 * 1024:
            return _json_response({'error': 'Requête trop volumineuse'}, status=413)
        data = await request.json()

        items = data.get('items', [])
        if not items or not isinstance(items, list):
            return _json_response({'error': 'Panier vide'}, status=400)
        customer_name = escape_html((data.get('customer_name') or '').strip()[:100])
        customer_phone = (data.get('customer_phone') or '').strip()[:20].replace('+', '').replace('-', '').replace(' ', '')
        wilaya = escape_html((data.get('wilaya') or '').strip()[:50])
        if not customer_name or not customer_phone or not wilaya:
            return _json_response({'error': 'Informations client requises (nom, téléphone, wilaya)'}, status=400)
        if not customer_phone.isdigit() or len(customer_phone) < 9:
            return _json_response({'error': 'Numéro de téléphone invalide'}, status=400)

        order_number = 'ADL-' + datetime.datetime.now().strftime('%Y%m%d-') + str(random.randint(1000, 9999))
        background_tasks.add_task(_process_order_background, order_number, items, customer_name, customer_phone, wilaya, data)
        logger.info(f'POST /api/orders: queued background task for {order_number}')

        return JSONResponse(
            {'order_number': order_number, 'message': 'Commande en cours de traitement'},
            status_code=201
        )
    except Exception as e:
        logger.exception("Error processing order request")
        return _json_response({'error': 'Failed to process order'}, status=500)


@router.post('/api/public/log-event')
async def log_event(request: Request):
    try:
        content_length = int(request.headers.get('content-length', 0))
        if content_length > 1 * 1024 * 1024:
            return {'ok': True}
        data = await request.json()
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
                    try:
                        db.close()
                    except Exception:
                        pass
        return {'ok': True}
    except Exception:
        return {'ok': True}


@router.post('/api/wishlist/share')
async def share_wishlist(request: Request):
    try:
        content_length = int(request.headers.get('content-length', 0))
        if content_length > 1 * 1024 * 1024:
            return _json_response({'error': 'Payload too large'}, status=413)
        data = await request.json()
        product_ids = data.get('product_ids', [])
        if not product_ids or not isinstance(product_ids, list):
            return _json_response({'error': 'No products'}, status=400)
        wl_hash = hashlib.md5(json.dumps(sorted(product_ids)).encode()).hexdigest()[:12]
        db = None
        try:
            db = get_public_db()
            cur = db.cursor()
            cur.execute(
                "INSERT INTO wishlists (hash, product_ids) VALUES (%s, %s) "
                "ON CONFLICT (hash) DO UPDATE SET created_at = NOW(), expires_at = NOW() + INTERVAL '30 days'",
                (wl_hash, json.dumps(product_ids))
            )
            db.commit()
            return JSONResponse({'hash': wl_hash, 'url': '/wishlist/' + wl_hash}, status_code=201)
        except Exception as e:
            logger.exception('[Storefront] Error sharing wishlist')
            return _json_response({'error': 'Erreur serveur'}, status=500)
        finally:
            if db:
                try:
                    db.close()
                except Exception:
                    pass
    except Exception as e:
        return _json_response({'error': 'Failed'}, status=500)
