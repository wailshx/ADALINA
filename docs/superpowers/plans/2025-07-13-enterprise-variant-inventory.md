# Enterprise Variant Inventory Implementation Plan

## Overview
Upgrade the existing product-level inventory system to a full Color × Size variant inventory with dashboard alerts, stock history, and admin management.

## Current State
- DB tables exist: `product_variants`, `variant_sizes`, `inventory`, `stock_history`
- Backend deduction works: `deduct_order_stock()`, `restore_order_stock()` handle Color×Size
- Admin inventory page is basic product-level only
- `stock_history` table lacks variant tracking

## Implementation Phases

---

### Phase 1: Database Schema Enhancement
**Goal**: Add variant-level tracking to stock_history

**Changes**:
1. Add columns to `stock_history` table:
   - `variant_id INTEGER` (nullable, references product_variants)
   - `color_name TEXT`
   - `size_name TEXT`

2. Create migration function in `admin/database.py`:
   ```python
   def migrate_stock_history_variants():
       # Add columns if they don't exist
       # ALTER TABLE stock_history ADD COLUMN IF NOT EXISTS variant_id INTEGER
       # ALTER TABLE stock_history ADD COLUMN IF NOT EXISTS color_name TEXT
       # ALTER TABLE stock_history ADD COLUMN IF NOT EXISTS size_name TEXT
   ```

3. Update `log_stock_change()` to accept optional variant params:
   ```python
   def log_stock_change(cur, product_id, stock_change, quantity_before, 
                        reason='', variant_id=None, color_name=None, size_name=None):
   ```

**Files**: `admin/database.py`

---

### Phase 2: Stock History Enhancement
**Goal**: Log variant-level changes with product context

**Changes**:
1. Update `deduct_order_stock()` — pass variant_id/color/size to log_stock_change
2. Update `restore_order_stock()` — same
3. Update all admin adjust endpoints — accept optional variant params

**Files**: `admin/database.py`, `routers/admin_api.py`

---

### Phase 3: Inventory API Enhancement
**Goal**: Support variant-level queries and adjustments

**New Endpoints**:
1. `GET /api/inventory/variants/{pid}` — Get all variants with sizes for a product
2. `PUT /api/inventory/variants/{vid}/sizes/{size}` — Update specific variant size stock
3. `GET /api/inventory/alerts` — Get low/out-of-stock items (variant-level)

**Enhanced Endpoints**:
1. `GET /api/inventory` — Add variant-level status (not just product-level)
2. `POST /api/inventory/{pid}/adjust` — Accept variant_id and size_name params
3. `GET /api/inventory/{pid}/history` — Include variant columns in response

**Files**: `routers/admin_api.py`, `admin/app.py`

---

### Phase 4: Admin Inventory Page Redesign
**Goal**: Full variant inventory management UI

**New Features**:
1. **Dashboard Stats** (top of page):
   - Total SKUs (product × color × size combinations)
   - In Stock (variant-level)
   - Low Stock (≤5 units)
   - Out of Stock (0 units)
   - Total Inventory Value (sum of all stock × price)

2. **Filters**:
   - Category dropdown
   - Status tabs: All | In Stock | Low Stock | Out of Stock
   - Search by product name or SKU

3. **Inventory Table**:
   - Expandable rows: click product → shows Color × Size matrix
   - Each row: Product Name | Color | Size | SKU | Stock | Status | Actions
   - Inline edit for stock quantity
   - Status badges: ✅ In Stock (>5) | ⚠️ Low (1-5) | ❌ Out (0)

4. **Bulk Actions**:
   - Export to CSV (all variants)
   - Bulk stock adjustment (selected items)

5. **Stock History Modal**:
   - Filter by product, date range
   - Shows: Date | Change | Before | After | Color | Size | Reason

6. **Quick Adjust Modal** (per variant size):
   - Current stock display
   - +/− buttons or set absolute
   - Reason dropdown (Manual, Shipment, Return, Damaged, etc.)

**Files**: `admin/inventory.html`, `admin/css/admin.css`

---

### Phase 5: Dashboard Integration
**Goal**: Add inventory alerts widget to main dashboard

**Changes**:
1. Add "Low Stock Alerts" card to dashboard.html
   - Show top 10 low/out-of-stock variants
   - Link to inventory page

2. Enhance `/api/dashboard/stats`:
   - Add variant-level stock counts
   - Add total SKU count

**Files**: `admin/dashboard.html`, `routers/admin_api.py`, `admin/app.py`

---

### Phase 6: Frontend Verification & Polish
**Goal**: Ensure frontend properly displays variant stock

**Changes**:
1. Verify product page shows stock per selected color/size
2. Verify Quick View modal shows variant stock
3. Verify out-of-stock messaging works per variant
4. Test checkout flow deducts from correct variant

**Files**: `js/script.js`, `index.html`, `shop.html`

---

## Implementation Order

| Step | Phase | Priority | Risk |
|------|-------|----------|------|
| 1 | DB Schema | High | Low |
| 2 | Stock History | High | Low |
| 3 | API Enhancement | High | Medium |
| 4 | Inventory Page | High | Medium |
| 5 | Dashboard | Medium | Low |
| 6 | Frontend Verify | Medium | Low |

## Testing Checklist

- [ ] Can view all variants with stock levels
- [ ] Can adjust stock for specific Color × Size
- [ ] Stock history shows variant details
- [ ] Checkout deducts from correct variant
- [ ] Low stock alerts appear on dashboard
- [ ] Out-of-stock variants show correctly on frontend
- [ ] Export CSV works with all variant data
- [ ] No regressions in existing functionality

## Risk Mitigation

1. **Backup before any changes** — git commit current state
2. **Test on staging** — verify checkout flow before production
3. **Rollback plan** — keep legacy product-level inventory as fallback
4. **Migration safety** — use ALTER TABLE ADD COLUMN IF NOT EXISTS
5. **Stock sync** — ensure `inventory.quantity` stays in sync with variant sums
