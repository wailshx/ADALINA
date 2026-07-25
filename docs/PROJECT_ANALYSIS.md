# ADALINA — Project Analysis & Architecture Reference

> **Purpose**: Single source of truth for the codebase. Read this file before asking for any modification.
> **Last updated**: 2026-07-25

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Name** | ADALINA |
| **Domain** | Luxury women's fashion e-commerce (Algeria) |
| **Live URL** | `https://adalina-v2.onrender.com` |
| **Repo root** | `/home/shx/Documents/website` |
| **Default admin** | `admin` / password from `ADMIN_PASSWORD_HASH` env (see `.env`) |
| **CORS origin** | `https://adalina-v2.onrender.com` (locked) |
| **Hosting** | Render.com free tier (no persistent disk) |

---

## 2. Architecture

### 2.1 Process model
**Single FastAPI process** (port 8080) launched by `start.sh`:
```
bash start.sh  →  uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1
```

> ⚠️ Legacy files `server.py`, `proxy.py`, `admin/app.py` are **dead code** but still in the tree. The 3-process architecture described in old `AGENTS.md` is obsolete.

### 2.2 Tech stack
| Layer | Tech |
|---|---|
| Backend | Python 3.14 stdlib + `fastapi`, `uvicorn`, `psycopg2-binary`, `openpyxl`, `python-multipart` |
| Database | **PostgreSQL on Supabase** (NOT SQLite) |
| Cache | In-process dict + file-based signal (`.cache_invalidate`) |
| Object storage | Cloudinary (`poshuiuu` cloud) |
| Frontend | Vanilla HTML/CSS/JS, no build step, ES5+ compatible |
| Fonts | Cormorant Garamond + Manrope (Google Fonts) |
| Icons | Font Awesome 6.5 |

### 2.3 File tree (logical)
```
main.py                     # FastAPI entry — mounts routes, serves /collection/* HTML
shared.py                   # _cache, format_product (variant enrich), _process_order_background
config/
  database.py               # psycopg2 ThreadedConnectionPool (DATABASE_URL, DATABASE_PUBLIC_URL)
  security.py               # RateLimiter, CSP, CSRF helpers, audit_log
  storage.py                # Cloudinary upload/delete/url
admin/
  database.py               # init_db (schema), seed_db, deduct_order_stock, restore_order_stock,
                            # log_stock_change, get_variant_stock, _sync_product_total_stock,
                            # migrate_taille_stock, _seed_delivery_times
  inventory.html            # Variant inventory matrix UI (full enterprise)
  dashboard.html            # Has "Low Stock Alerts" widget
  products.html / categories.html / collections.html / orders.html / customers.html
  analytics.html / settings.html / login.html
  css/admin.css (77KB)
  js/admin.js (161KB)
routers/
  storefront.py             # /api/public/* + /api/orders (background) + /api/wishlist/*
  admin_api.py              # /api/* (admin): products, orders, customers, inventory,
                            # delivery-prices, variants, alerts, upload, settings, etc.
  admin_pages.py            # /gestion/* — login, logout, CSRF-gated HTML
js/
  script.js (139KB)         # Storefront logic, cart, checkout, placeOrder
  i18n.js (33KB)            # FR + AR translations
  sizes.js (667B)           # Size helpers
css/styles.css (106KB)      # All public styles
uploads/                    # Local fallback (Cloudinary primary)
images/                     # Static images
.env                        # Local secrets (gitignored)
render.yaml                 # Render deploy config
start.sh                    # Entry point
```

---

## 3. URL routing

| URL | Source | Notes |
|---|---|---|
| `/` | `main.py:313` | 302 → `/collection/` |
| `/collection/` | `main.py:317` | `index.html` (French homepage) |
| `/collection/{path}` | `main.py:326` | Serves any static HTML/asset under BASE_DIR |
| `/collection/products.json` | `main.py:353` | Live products JSON from DB (5min cache) |
| `/api/health` | `main.py:425` | DB ping + order count |
| `/api/public/*` | `routers/storefront.py` | Public storefront: products, categories, collections, settings, delivery, wishlist, log-event |
| `/api/orders` | `routers/storefront.py:597` | POST: create order (background task) |
| `/api/wishlist/{hash}` | storefront | Public shared wishlist |
| `/api/*` (admin) | `routers/admin_api.py` | Admin API, requires `admin_session` cookie + CSRF for writes |
| `/gestion/login` | `routers/admin_pages.py` | Admin login page |
| `/gestion/login` (POST) | admin_pages | Form login → sets `admin_session` + `csrf_token` cookies |
| `/gestion/{path}` | admin_pages | Admin HTML, requires session |
| `/gestion/logout` | admin_pages | Clears session |
| `/css/*`, `/js/*`, `/images/*`, `/uploads/*` | main.py mounts | Static files |
| `/gestion/css/*`, `/gestion/js/*` | main.py mounts | Admin static files |
| `/track/{order_number}` | main.py:412 | 302 → `/collection/track.html?order=…` |
| `/wishlist/{hash}` | main.py:387 | Public wishlist HTML |

---

## 4. Database schema (PostgreSQL)

### 4.1 Tables
| Table | Purpose | Key columns |
|---|---|---|
| `users` | Admin users (legacy) | `username, password, role` |
| `categories` | Product categories | `name, slug, size_system` (`'standard'` or `'grouped_taille'`) |
| `products` | Products | `name, price, sale_price, category_id, images (jsonb), sizes (jsonb), colors (jsonb), stock, featured, new_arrival` |
| `product_sizes` | Legacy per-size stock (fallback) | `product_id, size, stock` |
| `product_colors` | Legacy per-color stock (fallback) | `product_id, color_name, color_hex, stock` |
| `product_variants` | Color-level variants | `product_id, color_name, color_hex, sku, sort_order, stock` |
| `variant_images` | Images per color | `variant_id, image_path, sort_order` |
| `variant_sizes` | Color×Size stock (current model) | `variant_id, size_name, stock, sku` |
| `collections` | Curated collections | `name, image, status` |
| `collection_products` | Many-to-many | `(collection_id, product_id)` |
| `customers` | Customer accounts (optional) | `name, email, phone, total_spent, status` |
| `orders` | Orders | `order_number, customer_*, wilaya, commune, status, total, items (jsonb), delivery_fee, delivery_mode, is_read` |
| `inventory` | Per-product stock mirror | `product_id (unique), quantity, low_stock_threshold` |
| `stock_history` | Stock change audit | `product_id, stock_change, qty_before/after, reason, variant_id, color_name, size_name` |
| `delivery_prices` | Per-wilaya delivery | `wilaya_id (pk), wilaya, price, min_days, max_days` |
| `settings` | Key-value store | `setting_key, setting_value, setting_type, category` |
| `audit_logs` | Admin actions | `event_type, username, ip, details, created_at` |
| `status_history` | Order status log | `order_id, status, note, created_at` |
| `search_events` | Analytics | `event_type, payload (jsonb)` |
| `wishlists` | Shared wishlists | `hash (unique), product_ids (jsonb), expires_at` |

### 4.2 RLS
All tables have **Row-Level Security enabled** + policies for `service_role` and `PUBLIC`. Service-role key is used by the backend. RLS effectively no-op for the app since all queries go through the service-role connection.

### 4.3 Migrations
- Auto-run on every startup via `_run_migrations()` in `admin/database.py` (idempotent, `ADD COLUMN IF NOT EXISTS`).
- `_ensure_columns()` in `shared.py` adds late-arriving columns (e.g. `delivery_mode`, `variant_id/color_name/size_name` on `stock_history`).
- `migrate_taille_stock()` collapses numeric sizes (36–52) into grouped "Taille 1/2/3" for `grouped_taille` categories.

### 4.4 Connection pool
`ThreadedConnectionPool(2, 20)` in `config/database.py`. Public pool (read-only via PostgREST) is separate. Per-request borrowing with 3-attempt retry.

---

## 5. Domain concepts

### 5.1 Category size system
- `standard` — sizes like S/M/L/XL
- `grouped_taille` — numeric (36–52) collapsed into "Taille 1" (36/38/40), "Taille 2" (42/44/46), "Taille 3" (48/50/52). Migration in `migrate_taille_stock()`.

### 5.2 Variant inventory
Color-level → `product_variants` (id, color, hex, sku, stock = sum of sizes)
Size-per-color → `variant_sizes` (variant_id, size_name, stock, sku)
Images-per-color → `variant_images` (variant_id, image_path)

**Stock flow** on order: `variant_sizes.stock -= qty` → `product_variants.stock = SUM(sizes)` → `products.stock = SUM(all_variants)` → `inventory.quantity` (mirror).

### 5.3 Order lifecycle
1. Client `POST /api/orders` (rate-limited 5/5min per IP).
2. Pre-check variant stock (sync).
3. Enqueue background task `_process_order_background`.
4. Background: re-fetch prices, `deduct_order_stock` (atomic check + update), insert `orders` + `status_history` (status='new'), commit, invalidate cache.
5. Returns `{order_number}` immediately to client.

### 5.4 Delivery pricing
- `delivery_prices.price` is the **bureau (office) delivery** price per wilaya.
- `delivery_prices.min_days / max_days` is the delivery time estimate.
- `delivery_mode` on order is either `domicile` or `bureau`.
- **Current behavior**: only the wilaya price is used regardless of mode. The "domicile surcharge per commune" feature is planned but not implemented (see §11).

### 5.5 Authentication
- PBKDF2-SHA256, 600k iterations (with 100k fallback for old hashes).
- Session = file `admin/.sessions.json` (NOT Render-disk-safe on free tier but in use).
- Cookie `admin_session` (24h or 30d remember), `csrf_token` cookie.
- CSRF required for all `POST/PUT/DELETE/PATCH` admin endpoints.
- Default password `daiaaadmin02` is generated on startup if `ADMIN_PASSWORD_HASH` env is unset/default.

### 5.6 Security headers (response middleware)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **CSP differs** for public vs `/gestion/*` (admin allows `cdn.jsdelivr.net` and `cdnjs.cloudflare.com` for FA/analytics).

---

## 6. i18n

- 2 languages: **French (default)** + **Arabic (RTL)**.
- `js/i18n.js` has `FR` and `AR` dicts. `getLang()` always returns `'fr'` currently (Arabic only used on `checkout.html` which has `lang="ar" dir="rtl"` hardcoded).
- Frontend uses hardcoded Arabic strings in `checkout.html` rather than `i18n.t()` (intentional, since checkout is Arabic-only).
- Translation function: `i18n.t(key)` with FR fallback.
- `data-i18n`, `data-i18n-text`, `data-i18n-placeholder`, `data-i18n-html` attributes are auto-applied.

---

## 7. Frontend pages

| File | Purpose | Lang |
|---|---|---|
| `index.html` | Homepage (hero, collections, featured, footer) | FR (with AR via i18n if user toggles) |
| `shop.html` | Catalog with filters, search, sort | FR |
| `product.html` | Product detail with variant picker | FR |
| `checkout.html` | **Arabic-only** order form | AR (RTL) |
| `track.html` | Order tracking by order# + last-4 phone | FR |
| `wishlist.html` | User wishlist (private) | FR |
| `wishlist-public.html` | Shared wishlist via hash | FR |
| `login.html` | Account login | FR |
| `register.html` | Account register | FR |
| `categories.html` | Static (rarely used) | FR |
| `privacy.html`, `terms.html` | Legal | FR |

---

## 8. Admin pages (`/gestion/*`)

| File | Purpose |
|---|---|
| `login.html` | Login form |
| `dashboard.html` | Stats: revenue, orders, customers, top products, low-stock alerts |
| `products.html` | Product CRUD with color×size variant editor |
| `categories.html` | Category CRUD |
| `collections.html` | Collection CRUD + product assignment |
| `orders.html` | Order list, status update, Excel export, print labels |
| `customers.html` | Customer list |
| `inventory.html` | **Variant matrix**, stock adjust, history modal, CSV export |
| `analytics.html` | Charts: monthly sales, category perf, best sellers, daily sales |
| `settings.html` | Site settings + per-wilaya delivery prices |

CSRF token is injected via `window.__csrf` on every served admin page (replaced in `<head>` by `admin_pages.py:_serve_admin_html`).

---

## 9. Inventory system (variant-level) — current state

All 6 phases of `docs/superpowers/plans/2025-07-13-enterprise-variant-inventory.md` are **implemented**:

| Phase | Status | Where |
|---|---|---|
| 1 — DB schema (`variant_id`, `color_name`, `size_name` on `stock_history`) | ✅ | `admin/database.py:8-18, 193-203`, `shared.py:100-102` |
| 2 — Variant-aware stock history logging | ✅ | `admin/database.py:20-29`, `deduct_order_stock`/`restore_order_stock` |
| 3 — Inventory API (`/inventory/variants/{pid}`, `/inventory/variants/{vid}/sizes/{size}`, `/inventory/alerts`, `/inventory/{pid}/adjust`) | ✅ | `routers/admin_api.py:1277-1716` |
| 4 — Admin inventory page (stats, filters, expandable matrix, quick adjust, history modal, export) | ✅ | `admin/inventory.html` (564 lines) |
| 5 — Dashboard low-stock widget | ✅ | `admin/dashboard.html:207-228` |
| 6 — Frontend out-of-stock UX | ✅ | Last 4 commits: "Indisponible" button, hide "Acheter", block out-of-stock orders |

---

## 10. Settings (DB-driven, `settings` table)

Loaded via `/api/public/settings` (300s cache) on every page. Keys used:

| Key | Type | Default | Used by |
|---|---|---|---|
| `store_name` | text | `ADALINA` | logo |
| `store_tagline` | text | `BOUTIQUE EN LIGNE` | logo sub |
| `store_description` | text | — | footer |
| `atelier_address` | text | `𝐀𝐓𝐄𝐋𝐈𝐄𝐑 𝐀𝐃𝐀𝐋𝐈𝐍𝐀 • 𝐂𝐇𝐋𝐄𝐅` | (no longer displayed — kept in DB for future use) |
| `opening_hours` | text | `Disponible 24h/24…` | header |
| `currency` | text | `DZD` | — |
| `primary_color` / `primary_dark` / `secondary_color` / `background_color` | text | gold/cream | theme CSS vars |
| `heading_font` / `body_font` / `button_font` / `nav_font` | text | Cormorant Garamond / Manrope | theme |
| `instagram_url` / `whatsapp_url` / `tiktok_url` | text | — | social links |
| `hero_slogan` / `hero_button_text` / `hero_button_link` | text | — | homepage hero |
| `announcement_text` | text | `Livraison \| …` (pipe-separated) | scrolling announcement bar |
| `announcement_speed` | number | `5000` | scroll duration |
| `site_title` / `meta_title` / `meta_description` / `meta_keywords` | text | — | SEO |
| `og_title` / `og_description` / `og_image` / `og_url` | text | — | Open Graph |
| `robots_meta` | text | `index,follow` | robots |
| `ga_id` | text | — | Google Analytics |
| `favicon_url` | text | — | favicon |
| `delivery_info` / `free_shipping_threshold` / `delivery_fee` | text/number | — | delivery section |
| `maintenance_mode` / `registration_enabled` / `guest_checkout` / `order_notifications` | boolean | — | feature flags |
| `default_language` | text | `fr` | i18n |

Delivery **prices per wilaya** are in the dedicated `delivery_prices` table, NOT in settings (admin UI in `settings.html`).

---

## 11. Known gaps / planned features

| Feature | Status | Notes |
|---|---|---|
| Commune-level delivery surcharge for `domicile` mode | ✅ DONE | `commune_delivery_prices` table + admin UI in `settings.html` + checkout logic. Wilaya price + commune surcharge = total when mode=`domicile`. |
| Complete commune list for all 58 wilayas (~1541) | ✅ DONE | `js/algeria-communes.js` ships 1378 communes covering all 58 wilayas. Admin can extend via DB. |
| Floating-label bug on checkout (RTL Arabic) | ✅ FIXED | Replaced placeholder-trick with `has-value` class on inputs/selects. CSS uses `inset-inline-start` for RTL-aware positioning. |
| `AGENTS.md` documents obsolete 3-process arch | **DOC** | References `server.py`/`admin/app.py`/`proxy.py` which are dead code. |
| `server.py`, `proxy.py`, `admin/app.py`, `store.db.backup` | **DEAD CODE** | Should be removed for clarity. |
| `i18n.getLang()` always returns `'fr'` | **DESIGN** | Arabic is forced on `checkout.html`; no UI toggle. |
| Persistent disk on free tier | **LIMIT** | Sessions/CSRF cache and uploaded files are lost on redeploy. Production workaround: rely on Supabase for everything. |

---

## 12. Deployment workflow (per `AGENTS.md`)

1. **Syntax check** — `py_compile` for Python, `node --check` for JS, brace balance for CSS/HTML.
2. **Local test** — `bash start.sh`, verify HTTP status (main 302, admin 200, health 200).
3. **Commit** — Stage only intended files.
4. **Push** — `git push origin main`.
5. **Verify live** — Wait ~15s for Render, check site loads + CSS/JS serve.

---

## 13. Environment variables

| Var | Required | Default |
|---|---|---|
| `DATABASE_URL` | ✅ | (none — fatal) |
| `DATABASE_PUBLIC_URL` | optional | falls back to `DATABASE_URL` |
| `SUPABASE_URL` | optional | — |
| `SUPABASE_ANON_KEY` | optional | — |
| `SUPABASE_SERVICE_KEY` | optional | — |
| `SUPABASE_BUCKET` | optional | `ADALINA` |
| `CORS_ORIGIN` | optional | `https://adalina-v2.onrender.com` |
| `ADMIN_USERNAME` | optional | `admin` |
| `ADMIN_PASSWORD_HASH` | ⚠️ | (default insecure, auto-generates session pwd) |
| `ADMIN_PASSWORD_SALT` | ⚠️ | (auto-gen) |
| `CLOUDINARY_CLOUD_NAME` | optional | — |
| `CLOUDINARY_API_KEY` | optional | — |
| `CLOUDINARY_API_SECRET` | optional | — |
| `HTTPS` | optional | unset |
| `PORT` | Render sets | `8080` |

---

## 14. Common gotchas

1. **`UPDATE orders … SET … WHERE order_id = %s`** — placeholder style: project uses **PostgreSQL `%s`** (NOT SQLite `?`). The `AGENTS.md` note about `%s → ?` is **wrong / outdated** for current code.
2. **Cache invalidation** — when admin changes data, must call `_signal_cache_invalidate()` (touch `.cache_invalidate` file). Forgetting this causes stale product data on the storefront.
3. **Background order task** runs in same process via `BackgroundTasks` — if uvicorn worker crashes mid-write, the order is lost. Free tier has no queue.
4. **CSRF** — admin forms must include `X-CSRF-Token` header equal to the `csrf_token` cookie value. `js/admin.js`'s `api()` wrapper handles this.
5. **Variant stock on `deduct_order_stock`** — only updates one specific `variant_sizes` row by `(variant_id, size_name)`. If a product has no variants, falls back to `product_sizes` then bare `products.stock`.
6. **`migrate_taille_stock()` is destructive** — it deletes existing `variant_sizes` rows for `grouped_taille` categories and rebuilds them as 3 grouped sizes. Backup first if running on live data.
7. **Delivery price = bureau price** — there is no distinction in the current code between `bureau` and `domicile` delivery cost. Both use the same `delivery_prices.price` value.
8. **Supabase pooler** — `DATABASE_URL` uses Supavisor pooler port 6543. Direct port 5432 also works but may exhaust connections faster.

---

## 15. Modification checklist (use before committing)

- [ ] Read this file
- [ ] Read relevant source files
- [ ] If changing DB schema: add migration in `admin/database.py:_run_migrations` + `shared.py:_ensure_columns` (idempotent, `IF NOT EXISTS`)
- [ ] If adding an admin endpoint: require session, require CSRF for writes
- [ ] If changing storefront API: respect 5min cache, call `_signal_cache_invalidate()` on writes
- [ ] If changing UI: respect i18n, test both LTR and RTL where applicable
- [ ] If changing checkout: test both `domicile` and `bureau` delivery modes
- [ ] If changing stock logic: test `variant_sizes`, `product_variants`, `products.stock`, `inventory.quantity` sync
- [ ] Run deployment workflow (§12)

---

*This file is the canonical project reference. Update it whenever the architecture, schema, or major patterns change.*
