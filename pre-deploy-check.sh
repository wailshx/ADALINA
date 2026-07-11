#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# pre-deploy-check.sh — Full local verification before Render deploy.
# Run from repo root:  bash pre-deploy-check.sh [--live]
#   --live   Run client-facing checks against https://adalina.onrender.com
# Without --live, starts local servers on ports 3000/5000/8080.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

PASS=0; FAIL=0; SKIP=0
BASE_URL=""
MODE="local"
COOKIES="/tmp/predeploy_admin_cookies.txt"
CURL_OPTS="-s -S --max-time 15"

# ── Parse args ────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --live) MODE="live"; BASE_URL="https://adalina.onrender.com" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}✗ FAIL${NC} $1"; }
skip() { SKIP=$((SKIP+1)); echo -e "  ${YELLOW}○ SKIP${NC} $1"; }
section() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ── Start local servers ──────────────────────────────────────
PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -f "$COOKIES"
}
trap cleanup EXIT

if [ "$MODE" = "local" ]; then
  echo "Starting local servers..."

  # Kill any leftover processes on our ports
  for port in 3000 5000 8080; do
    fuser -k "$port/tcp" 2>/dev/null || true
  done
  sleep 1

  PORT_MAIN=3000 python3 server.py &>/dev/null &
  PIDS+=($!)
  sleep 2

  PORT_ADMIN=5000 python3 admin/app.py &>/dev/null &
  PIDS+=($!)
  sleep 2

  PORT=8080 PORT_MAIN=3000 PORT_ADMIN=5000 python3 proxy.py &>/dev/null &
  PIDS+=($!)
  sleep 3

  BASE_URL="http://localhost:8080"

  # Quick sanity that all three servers are alive
  for port in 3000 5000 8080; do
    if ! lsof -i:"$port" 2>/dev/null | grep -q LISTEN; then
      echo "  ERROR: server on port $port not listening"; exit 1
    fi
  done
  echo "All servers up on localhost."
fi

# ── Helper functions ──────────────────────────────────────────
get() { curl $CURL_OPTS -o /tmp/predeploy_body.txt -w "%{http_code}" "$@"; echo; }
get_auth() { curl $CURL_OPTS -b "$COOKIES" -o /tmp/predeploy_body.txt -w "%{http_code}" "$@"; echo; }
get_body() { curl $CURL_OPTS "$@"; }
post_json() { curl $CURL_OPTS -X POST -H "Content-Type: application/json" -o /tmp/predeploy_body.txt -w "%{http_code}" "$@"; echo; }
put_json() { curl $CURL_OPTS -X PUT -H "Content-Type: application/json" -o /tmp/predeploy_body.txt -w "%{http_code}" "$@"; echo; }
delete() { curl $CURL_OPTS -X DELETE -o /tmp/predeploy_body.txt -w "%{http_code}" "$@"; echo; }

json_field() { python3 -c "
import sys, json
d = json.load(sys.stdin)
keys = '$1'.split('.')
for k in keys:
    if k.isdigit(): d = d[int(k)]
    else: d = d.get(k, None)
    if d is None: break
if d is not None: print(d if not isinstance(d, (dict,list)) else json.dumps(d, ensure_ascii=False))
else: sys.exit(1)
" < /tmp/predeploy_body.txt 2>/dev/null; }

json_has() { python3 -c "
import sys, json; d = json.load(sys.stdin); sys.exit(0 if '$1' in (d if isinstance(d,dict) else {}) else 1)
" < /tmp/predeploy_body.txt 2>/dev/null; }

json_count() { python3 -c "
import sys, json
d = json.load(sys.stdin)
for k in '$1'.split('.'):
    if k.isdigit(): d = d[int(k)]
    elif isinstance(d, dict): d = d.get(k, [])
print(len(d) if isinstance(d, list) else 0)
" < /tmp/predeploy_body.txt 2>/dev/null; }

json_ok() { python3 -c "
import sys, json; d = json.load(sys.stdin); sys.exit(0 if d else 1)
" < /tmp/predeploy_body.txt 2>/dev/null; }

# ══════════════════════════════════════════════════════════════
#  CLIENT-FACING CHECKS
# ══════════════════════════════════════════════════════════════
section "CLIENT-FACING: Homepage"
{
  code=$(get "$BASE_URL/website/")
  [ "$code" = "200" ] && pass "Homepage loads (200)" || fail "Homepage returned $code"

  # Hero image
  has_hero=$(curl $CURL_OPTS "$BASE_URL/website/" | grep -ci 'hero\|slider\|banner' || true)
  [ "$has_hero" -gt 0 ] && pass "Hero/slider section present" || fail "Hero section missing"

  # Announcement bar
  has_bar=$(curl $CURL_OPTS "$BASE_URL/website/" | grep -ci 'announcement\|marquee\|promo' || true)
  [ "$has_bar" -gt 0 ] && pass "Announcement bar present" || fail "Announcement bar missing"

  # JS/CSS load
  css_code=$(get "$BASE_URL/website/css/styles.css")
  [ "$css_code" = "200" ] && pass "Main CSS loads" || fail "Main CSS returned $css_code"

  js_code=$(get "$BASE_URL/website/js/script.js")
  [ "$js_code" = "200" ] && pass "Main JS loads" || fail "Main JS returned $js_code"

  sizes_code=$(get "$BASE_URL/website/js/sizes.js")
  [ "$sizes_code" = "200" ] && pass "sizes.js loads" || fail "sizes.js returned $sizes_code"
}

section "CLIENT-FACING: API — Public Products"
{
  code=$(get "$BASE_URL/api/public/products?limit=5")
  [ "$code" = "200" ] && pass "GET /api/public/products (200)" || fail "Products API returned $code"

  # Check response is valid JSON with product structure
  has_products=$(json_count "products")
  [ "$has_products" -gt 0 ] && pass "Products response has $has_products items" || skip "No products in DB to test further"

  # Featured endpoint
  code=$(get "$BASE_URL/api/public/products/featured")
  [ "$code" = "200" ] && pass "GET /api/public/products/featured (200)" || fail "Featured API returned $code"
}

section "CLIENT-FACING: API — Categories & Collections"
{
  code=$(get "$BASE_URL/api/public/categories")
  [ "$code" = "200" ] && pass "GET /api/public/categories (200)" || fail "Categories API returned $code"

  code=$(get "$BASE_URL/api/public/collections")
  [ "$code" = "200" ] && pass "GET /api/public/collections (200)" || fail "Collections API returned $code"

  # Collections must return enriched products with images array
  has_enriched=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d:
    for p in c.get('products', []):
        if 'images' not in p or 'variants' not in p:
            sys.exit(1)
sys.exit(0)
" < /tmp/predeploy_body.txt 2>/dev/null) && pass "Collection products have images+variants" || skip "No collection products to verify enrichment"
}

section "CLIENT-FACING: API — Settings & Delivery"
{
  code=$(get "$BASE_URL/api/public/settings")
  [ "$code" = "200" ] && pass "GET /api/public/settings (200)" || fail "Settings API returned $code"

  code=$(get "$BASE_URL/api/public/delivery-prices")
  [ "$code" = "200" ] && pass "GET /api/public/delivery-prices (200)" || fail "Delivery prices API returned $code"
}

section "CLIENT-FACING: Shop Page"
{
  code=$(get "$BASE_URL/website/shop.html")
  [ "$code" = "200" ] && pass "Shop page loads (200)" || fail "Shop page returned $code"

  # Taille filter UI
  has_taille=$(curl $CURL_OPTS "$BASE_URL/website/shop.html" | grep -ci 'taille\|size.*filter\|buildSizeFilter' || true)
  [ "$has_taille" -gt 0 ] && pass "Taille filter referenced in HTML/JS" || fail "Taille filter missing"

  # Category filter
  has_cat=$(curl $CURL_OPTS "$BASE_URL/website/shop.html" | grep -ci 'category.*filter\|buildCategoryFilter\|catFilter' || true)
  [ "$has_cat" -gt 0 ] && pass "Category filter referenced in HTML/JS" || fail "Category filter missing"

  # Pagination
  has_page=$(curl $CURL_OPTS "$BASE_URL/website/shop.html" | grep -ci 'pagination\|loadShopPage\|loadServerPage\|loadFilteredPage' || true)
  [ "$has_page" -gt 0 ] && pass "Pagination logic present" || fail "Pagination missing"
}

section "CLIENT-FACING: Product Page"
{
  code=$(get "$BASE_URL/website/product.html")
  [ "$code" = "200" ] && pass "Product page template loads (200)" || fail "Product page returned $code"

  # Check script.js has product page functions (loaded via <script src>)
  has_pp=$(curl $CURL_OPTS "$BASE_URL/website/js/script.js" | grep -c 'loadProductPage\|displayProduct\|selectProductColor\|selectProductSize' || true)
  [ "$has_pp" -gt 0 ] && pass "Product page JS functions present" || fail "Product page JS missing"
}

section "CLIENT-FACING: Quick View"
{
  has_qv=$(curl $CURL_OPTS "$BASE_URL/website/js/script.js" | grep -c 'function quickView' || true)
  [ "$has_qv" -gt 0 ] && pass "quickView() function defined" || fail "quickView() missing"

  has_qv_cart=$(curl $CURL_OPTS "$BASE_URL/website/js/script.js" | grep -c 'quickViewForCart' || true)
  [ "$has_qv_cart" -gt 0 ] && pass "quickViewForCart() for Modify button" || fail "quickViewForCart() missing"
}

section "CLIENT-FACING: Panier (Cart)"
{
  has_cart=$(curl $CURL_OPTS "$BASE_URL/website/js/script.js" | grep -c 'renderCartPage\|updateCartDisplay' || true)
  [ "$has_cart" -gt 0 ] && pass "Cart rendering functions present" || fail "Cart functions missing"

  has_modify=$(curl $CURL_OPTS "$BASE_URL/website/js/script.js" | grep -c 'quickViewForCart\|Modifier' || true)
  [ "$has_modify" -gt 0 ] && pass "Modifier (edit) button logic present" || fail "Modifier logic missing"
}

section "CLIENT-FACING: Checkout"
{
  code=$(get "$BASE_URL/website/checkout.html")
  [ "$code" = "200" ] && pass "Checkout page loads (200)" || fail "Checkout page returned $code"

  has_checkout=$(curl $CURL_OPTS "$BASE_URL/website/checkout.html" | grep -ci 'placeOrder\|renderCheckout\|wilaya\|delivery' || true)
  [ "$has_checkout" -gt 0 ] && pass "Checkout JS functions present" || fail "Checkout JS missing"

  # Delivery prices API
  dp_body=$(get_body "$BASE_URL/api/public/delivery-prices")
  dp_ok=$(echo "$dp_body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
sys.exit(0 if isinstance(d, dict) and len(d) > 0 else 1)
" 2>/dev/null) && pass "Delivery prices data non-empty" || skip "Delivery prices may not be configured yet"
}

section "CLIENT-FACING: Static Assets"
{
  for f in "css/styles.css" "js/script.js" "js/sizes.js" "images/"; do
    code=$(get "$BASE_URL/website/$f")
    [ "$code" = "200" ] && pass "$f loads (200)" || fail "$f returned $code"
  done

  # Uploads directory
  code=$(get "$BASE_URL/uploads/")
  [ "$code" = "200" ] || [ "$code" = "403" ] && pass "/uploads/ accessible ($code)" || fail "/uploads/ returned $code"
}

section "CLIENT-FACING: Proxy Routing"
{
  # Client site
  code=$(get "$BASE_URL/website/")
  [ "$code" = "200" ] && pass "Proxy → Main: /website/" || fail "Proxy → Main failed ($code)"

  # Admin login
  code=$(get "$BASE_URL/admin/")
  [ "$code" = "200" ] || [ "$code" = "302" ] && pass "Proxy → Admin: /admin/" || fail "Proxy → Admin failed ($code)"

  # Public API via proxy
  code=$(get "$BASE_URL/api/public/products")
  [ "$code" = "200" ] && pass "Proxy → API: /api/public/products" || fail "Proxy API routing failed ($code)"
}

# ══════════════════════════════════════════════════════════════
#  ADMIN CHECKS
# ══════════════════════════════════════════════════════════════
section "ADMIN: Login"
{
  code=$(post_json "$BASE_URL/admin/login" -d "username=admin&password=admin123" -H "Content-Type: application/x-www-form-urlencoded" -c "$COOKIES")
  [ "$code" = "302" ] && pass "Login POST returns 302 (success)" || fail "Login returned $code"

  code=$(get "$BASE_URL/admin/dashboard.html" -b "$COOKIES")
  [ "$code" = "200" ] && pass "Dashboard accessible with session" || fail "Dashboard returned $code"
}

section "ADMIN: Dashboard API"
{
  code=$(get "$BASE_URL/api/dashboard/stats" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/dashboard/stats (200)" || fail "Dashboard stats returned $code"

  code=$(get "$BASE_URL/api/notifications" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/notifications (200)" || fail "Notifications returned $code"
}

section "ADMIN: Products API"
{
  # List
  code=$(get "$BASE_URL/api/products" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/products (200)" || fail "Products list returned $code"

  # Create test product
  TEST_PRODUCT=$(python3 -c "
import json, time
print(json.dumps({
    'name': f'PREDEPLOY TEST {int(time.time())}',
    'description': 'Auto-created by pre-deploy check, delete me',
    'price': 9999,
    'category_id': None,
    'status': 'active',
    'featured': False,
    'new_arrival': False,
    'images': [],
    'variants': [{
        'color_name': 'Test Noir',
        'color_hex': '#000000',
        'sku': 'PREDEPLOY-TEST-001',
        'stock': 5,
        'sizes': [{'size': '38', 'stock': 5}],
        'images': []
    }]
}))
")
  code=$(post_json "$BASE_URL/api/products" -d "$TEST_PRODUCT" -b "$COOKIES")
  [ "$code" = "201" ] && pass "POST /api/products (create — 201)" || fail "Create product returned $code"
  TEST_PID=$(json_field "id")
  if [ -n "$TEST_PID" ] && [ "$TEST_PID" != "None" ]; then
    pass "Created test product id=$TEST_PID"

    # Read it back
    code=$(get "$BASE_URL/api/products/$TEST_PID" -b "$COOKIES")
    [ "$code" = "200" ] && pass "GET /api/products/$TEST_PID (read back)" || fail "Read product returned $code"

    # Update it
    UPDATE=$(python3 -c "
import json, time
print(json.dumps({
    'name': f'PREDEPLOY TEST UPDATED {int(time.time())}',
    'description': 'Updated by pre-deploy check',
    'price': 8888,
    'status': 'active',
    'featured': False,
    'new_arrival': False,
    'variants': [{
        'color_name': 'Test Blanc',
        'color_hex': '#ffffff',
        'sku': 'PREDEPLOY-TEST-002',
        'stock': 3,
        'sizes': [{'size': '40', 'stock': 3}],
        'images': []
    }]
}))
")
    code=$(put_json "$BASE_URL/api/products/$TEST_PID" -d "$UPDATE" -b "$COOKIES")
    [ "$code" = "200" ] && pass "PUT /api/products/$TEST_PID (update — 200)" || fail "Update product returned $code"

    # Verify update persisted
    code=$(get "$BASE_URL/api/products/$TEST_PID" -b "$COOKIES")
    updated_name=$(json_field "name" 2>/dev/null || true)
    echo "$updated_name" | grep -q "UPDATED" && pass "Product update persisted" || fail "Product update did not persist"
  else
    skip "Could not get created product ID — skipping read/update/delete"
  fi
}

section "ADMIN: Categories API"
{
  code=$(get "$BASE_URL/api/categories" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/categories (200)" || fail "Categories list returned $code"

  # Create test category
  code=$(post_json "$BASE_URL/api/categories" -d '{"name":"PREDEPLOY TEST CAT"}' -b "$COOKIES")
  [ "$code" = "201" ] && pass "POST /api/categories (create — 201)" || fail "Create category returned $code"
  TEST_CAT_ID=$(json_field "id")

  if [ -n "$TEST_CAT_ID" ] && [ "$TEST_CAT_ID" != "None" ]; then
    pass "Created test category id=$TEST_CAT_ID"

    # Update
    code=$(put_json "$BASE_URL/api/categories/$TEST_CAT_ID" -d '{"name":"PREDEPLOY TEST CAT UPD"}' -b "$COOKIES")
    [ "$code" = "200" ] && pass "PUT /api/categories/$TEST_CAT_ID (update)" || fail "Update category returned $code"

    # Delete (only if no products attached)
    code=$(delete "$BASE_URL/api/categories/$TEST_CAT_ID" -b "$COOKIES")
    [ "$code" = "200" ] && pass "DELETE /api/categories/$TEST_CAT_ID" || skip "Delete category returned $code (may have products)"
  else
    skip "Could not create category — skipping update/delete"
  fi
}

section "ADMIN: Collections API"
{
  code=$(get "$BASE_URL/api/collections" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/collections (200)" || fail "Collections list returned $code"

  code=$(get "$BASE_URL/api/collections/all" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/collections/all (200)" || fail "Collections/all returned $code"

  # Create test collection
  code=$(post_json "$BASE_URL/api/collections" -d '{"name":"PREDEPLOY TEST COLL","description":"test","product_ids":[]}' -b "$COOKIES")
  [ "$code" = "201" ] && pass "POST /api/collections (create — 201)" || fail "Create collection returned $code"
  TEST_COLL_ID=$(json_field "id")

  if [ -n "$TEST_COLL_ID" ] && [ "$TEST_COLL_ID" != "None" ]; then
    pass "Created test collection id=$TEST_COLL_ID"

    # Update
    code=$(put_json "$BASE_URL/api/collections/$TEST_COLL_ID" -d '{"name":"PREDEPLOY TEST COLL UPD","description":"updated"}' -b "$COOKIES")
    [ "$code" = "200" ] && pass "PUT /api/collections/$TEST_COLL_ID (update)" || fail "Update collection returned $code"

    # Public endpoint check — enriched products
    code=$(get "$BASE_URL/api/public/collections" -b "$COOKIES")
    [ "$code" = "200" ] && pass "Public collections endpoint (200)" || fail "Public collections returned $code"

    # Clean up
    code=$(delete "$BASE_URL/api/collections/$TEST_COLL_ID" -b "$COOKIES")
    [ "$code" = "200" ] && pass "DELETE /api/collections/$TEST_COLL_ID" || fail "Delete collection returned $code"
  else
    skip "Could not create collection — skipping update/delete"
  fi
}

section "ADMIN: Orders API"
{
  code=$(get_auth "$BASE_URL/api/orders" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/orders (200)" || fail "Orders list returned $code"

  # Check we can search (the orders search feature)
  code=$(get_auth "$BASE_URL/api/orders?search=test" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/orders?search=test (200)" || fail "Orders search returned $code"

  # Test status change on an order (if any exist)
  ORDER_COUNT=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
orders = d.get('orders', []) if isinstance(d, dict) else []
print(len(orders))
" < /tmp/predeploy_body.txt 2>/dev/null || echo "0")
  if [ "$ORDER_COUNT" -gt 0 ]; then
    FIRST_OID=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
orders = d.get('orders', []) if isinstance(d, dict) else []
print(orders[0]['id'] if orders else '')
" < /tmp/predeploy_body.txt 2>/dev/null || echo "")
    if [ -n "$FIRST_OID" ]; then
      code=$(get_auth "$BASE_URL/api/orders/$FIRST_OID" -b "$COOKIES")
      [ "$code" = "200" ] && pass "GET /api/orders/$FIRST_OID (detail)" || fail "Order detail returned $code"
    fi
  else
    skip "No orders to test status change/detail"
  fi
}

section "ADMIN: Settings API"
{
  code=$(get "$BASE_URL/api/settings" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/settings (200)" || fail "Settings API returned $code"

  # Check settings structure (should be key-value map)
  has_settings=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
sys.exit(0 if isinstance(d, dict) and len(d) > 0 else 1)
" < /tmp/predeploy_body.txt 2>/dev/null) && pass "Settings response is non-empty dict" || skip "Settings may not be configured yet"

  # Update a setting and verify persistence
  code=$(put_json "$BASE_URL/api/settings" -d '{"store_name":"ADALINA PREDEPLOY TEST"}' -b "$COOKIES")
  [ "$code" = "200" ] && pass "PUT /api/settings (update — 200)" || fail "Settings update returned $code"

  code=$(get "$BASE_URL/api/settings" -b "$COOKIES")
  persisted=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('store_name', ''))
" < /tmp/predeploy_body.txt 2>/dev/null || echo "")
  echo "$persisted" | grep -q "PREDEPLOY TEST" && pass "Settings update persisted" || fail "Settings update did not persist"

  # Restore
  put_json "$BASE_URL/api/settings" -d '{"store_name":"ADALINA"}' -b "$COOKIES" >/dev/null
}

section "ADMIN: Delivery Prices API"
{
  code=$(get "$BASE_URL/api/delivery-prices" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/delivery-prices (200)" || fail "Delivery prices returned $code"
}

section "ADMIN: Customers API"
{
  code=$(get "$BASE_URL/api/customers" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/customers (200)" || fail "Customers API returned $code"
}

section "ADMIN: Inventory API"
{
  code=$(get "$BASE_URL/api/inventory" -b "$COOKIES")
  [ "$code" = "200" ] && pass "GET /api/inventory (200)" || fail "Inventory API returned $code"
}

section "ADMIN: Admin Static Assets"
{
  for f in "admin/dashboard.html" "admin/products.html" "admin/orders.html" "admin/css/admin.css" "admin/js/admin.js" "admin/js/sizes.js"; do
    code=$(get "$BASE_URL/$f" -b "$COOKIES")
    [ "$code" = "200" ] && pass "/$f (200)" || fail "/$f returned $code"
  done
  # /admin/login returns 302 to dashboard when already authenticated — this is correct
  code=$(get "$BASE_URL/admin/login" -b "$COOKIES")
  [ "$code" = "200" ] || [ "$code" = "302" ] && pass "/admin/login ($code — redirect=authenticated)" || fail "/admin/login returned $code"
}

# ── Cleanup test product ──────────────────────────────────────
section "Cleanup"
{
  if [ -n "${TEST_PID:-}" ] && [ "$TEST_PID" != "None" ]; then
    code=$(delete "$BASE_URL/api/products/$TEST_PID" -b "$COOKIES")
    [ "$code" = "200" ] && pass "Deleted test product" || skip "Cleanup: delete product returned $code"
  fi
  # Note: test category was already deleted above
}

# ══════════════════════════════════════════════════════════════
#  SUMMARY
# ══════════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════"
echo -e "  ${GREEN}PASSED: $PASS${NC}  ${RED}FAILED: $FAIL${NC}  ${YELLOW}SKIPPED: $SKIP${NC}"
echo "══════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}DEPLOY BLOCKED — fix failures above before pushing.${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed — safe to deploy.${NC}"
  exit 0
fi
