let products = [];
let productsLoaded = false;
let currentPage = 1;
let totalPages = 1;
let totalProducts = 0;
const PER_PAGE = 16;
let currentCategory = '';

window.addEventListener('error', function(e) {
    console.error('[ADALINA] Uncaught error:', e.message, e.filename, e.lineno);
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('[ADALINA] Unhandled promise rejection:', e.reason);
});

const PLACEHOLDER_IMG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="533" fill="%23f0f0f0"><rect width="400" height="533"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23ccc" font-size="16">No Image</text></svg>';

function onImgError(el) { if (el && el.src !== PLACEHOLDER_IMG) el.src = PLACEHOLDER_IMG; }

function cloudinaryThumb(url, w) {
    if (!url) return '';
    if (url.indexOf('cloudinary.com') !== -1 && w) {
        var parts = url.split('/upload/');
        if (parts.length === 2) return parts[0] + '/upload/w_' + w + ',f_auto,q_auto/' + parts[1];
    }
    return url;
}

async function loadProducts() {
    try {
        const res = await fetch('/api/public/products');
        if (!res.ok) throw new Error('Failed to load products');
        const data = await res.json();
        products = data.products || data;
        productsLoaded = true;
        console.log('Loaded ' + products.length + ' products from database');
    } catch (e) {
        console.error('Error loading products:', e);
        productsLoaded = false;
    }
}

const colorToHex = {
    'Black': '#000000', 'Navy': '#000000', 'Charcoal': '#000000',
    'Gray': '#333333', 'Silver': '#333333',
    'White': '#ffffff', 'Cream': '#ffffff', 'Beige': '#ffffff', 'Nude': '#ffffff', 'Elegant White': '#ffffff', 'Crystal Clear': '#ffffff', 'Ivory': '#ffffff',
    'Gold': '#d4af37',
    'Rose Gold': '#b76e79', 'Burgundy': '#b76e79', 'Coral': '#b76e79', 'Brown': '#b76e79', 'Forest Green': '#b76e79',
    'Red': '#ff69b4', 'Pink': '#ff69b4', 'Aqua': '#ff69b4', 'Green': '#ff69b4'
};

const filterState = {
    sortBy: 'newest',
    search: '',
    collection: '',
    color: '',
    size: '',
    inStock: false
};
let currentSizeGroups = [];
let _cachedAllProducts = [];
let _cachedAllCategory = '';
let _categoriesCache = [];
let _filterOptionsCache = null;
let _shopSearchDebounce = null;

function currentCategorySizeSystem() {
    if (!_categoriesCache.length) return 'standard';
    for (var i = 0; i < _categoriesCache.length; i++) {
        if (_categoriesCache[i].name === currentCategory) return _categoriesCache[i].size_system || 'standard';
    }
    return 'standard';
}

async function _ensureCategoriesCache() {
    if (_categoriesCache.length) return;
    try {
        var res = await fetch('/api/public/categories');
        if (res.ok) _categoriesCache = await res.json();
    } catch(e) {}
}

let wishlist = (function(){ try { return JSON.parse(localStorage.getItem('adalinaWishlist')) || []; } catch(e) { return []; } })();
let cart = (function(){ try { return JSON.parse(localStorage.getItem('adalinaCart')) || []; } catch(e) { return []; } })();
let slideIndex = 0;
let _initialized = false;

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function formatPriceDA(price) {
    if (price == null || isNaN(price)) return '0 DA';
    var num = Math.round(Number(price));
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' DA';
}

function buildGroupedSizesHtml(availSizes, product, curColor, curSize, hasVariants, btnClass, wrapClass, clickHandlerAttr, sizeSystem) {
    var noStockInfo = (!curColor || !hasVariants);

    /* ── grouped_taille: sizes are already "Taille 1", "Taille 2", "Taille 3" ── */
    var isGroupedTaille = sizeSystem === 'grouped_taille';
    if (!isGroupedTaille && availSizes && availSizes.length > 0) {
        var probe = typeof availSizes[0] === 'object' ? availSizes[0].size : availSizes[0];
        if (probe && probe.indexOf('Taille') === 0) isGroupedTaille = true;
    }
    if (isGroupedTaille && availSizes && availSizes.length > 0) {
        var firstSize = typeof availSizes[0] === 'object' ? availSizes[0].size : availSizes[0];
        /* If sizes are already group names, render elegant Taille boxes */
        if (firstSize && firstSize.indexOf('Taille') === 0) {
            var html = '<div class="sz-group-taille-boxes">';
            window.SIZE_GROUPS.forEach(function(grp) {
                var sizeEntry = null;
                for (var i = 0; i < availSizes.length; i++) {
                    var sn = typeof availSizes[i] === 'object' ? availSizes[i].size : availSizes[i];
                    if (sn === grp.label) { sizeEntry = availSizes[i]; break; }
                }
                if (!sizeEntry) return;
                var stock = noStockInfo ? 1 : (typeof sizeEntry === 'object' ? (sizeEntry.stock || 0) : 0);
                var available = noStockInfo || stock > 0;
                var selected = (typeof sizeEntry === 'object' ? sizeEntry.size : sizeEntry) === curSize;
                var infoText = grp.sizes.join(' \u00b7 ');
                html += '<div class="sz-taille-box' + (selected ? ' selected' : '') + (!available ? ' out-of-stock' : '') + '"' +
                    (!available ? '' : ' ' + clickHandlerAttr.replace('{val}', grp.label.replace(/'/g, "\\'"))) + '>' +
                    '<div class="sz-taille-header">' +
                        '<span class="sz-taille-label">' + grp.label + '</span>' +
                        (!available ? '<span class="sz-taille-oos-text">' + i18n.t('qv.soldOut') + '</span>' :
                         (selected ? '<span class="sz-taille-status">' + i18n.t('qv.selected') + '</span>' : '')) +
                    '</div>' +
                    '<div class="sz-taille-info">' + infoText + '</div>' +
                '</div>';
            });
            html += '</div>';
            if (!html || html === '<div class="sz-group-taille-boxes"></div>') {
                html = '<p style="color:var(--text-light);font-size:0.85rem;">' + i18n.t('qv.noSizeAvailable') + '</p>';
            }
            return html;
        }
        /* Fall through to grouping logic if sizes are still individual numbers */
    }

    /* ── Build per-size stock data ── */
    var sizeData = (availSizes || []).map(function(s) {
        var sname = typeof s === 'object' ? s.size : s;
        var stock = noStockInfo ? 1 : getVariantStock(product, curColor, sname);
        return { name: sname, stock: stock, available: noStockInfo || stock > 0, selected: sname === curSize };
    });

    var html = '';
    var groupKeys, ungrouped;

    if (sizeSystem === 'standard') {
        ungrouped = sizeData;
    } else {
        var groups = {};
        ungrouped = [];
        sizeData.forEach(function(sz) {
            var grp = window.getSizeGroup(sz.name);
            if (grp) {
                if (!groups[grp.label]) groups[grp.label] = { label: grp.label, sizes: [] };
                groups[grp.label].sizes.push(sz);
            } else {
                ungrouped.push(sz);
            }
        });
        groupKeys = Object.keys(groups);
        groupKeys.sort();
        groupKeys.forEach(function(key) {
            var g = groups[key];
            html += '<div class="sz-group">' +
                '<div class="sz-group-label">' + g.label + '</div>' +
                '<div class="sz-group-sizes">';
            g.sizes.forEach(function(sz) {
                var sel = sz.selected ? ' selected' : '';
                var oos = sz.available ? '' : ' out-of-stock';
                html += '<div class="' + wrapClass + oos + '">' +
                    '<button class="' + btnClass + sel + '" ' + clickHandlerAttr.replace('{val}', sz.name.replace(/'/g, "\\'")) + '>' + sz.name + '</button>' +
                    (noStockInfo ? '' : stockLabel(sz.stock)) +
                    '</div>';
            });
            html += '</div></div>';
        });
    }

    if (ungrouped.length > 0) {
        html += '<div class="sz-group-sizes">';
        ungrouped.forEach(function(sz) {
            var sel = sz.selected ? ' selected' : '';
            var oos = sz.available ? '' : ' out-of-stock';
            html += '<div class="' + wrapClass + oos + '">' +
                '<button class="' + btnClass + sel + '" ' + clickHandlerAttr.replace('{val}', sz.name.replace(/'/g, "\\'")) + '>' + sz.name + '</button>' +
                (noStockInfo ? '' : stockLabel(sz.stock)) +
                '</div>';
        });
        html += '</div>';
    }

    // If nothing to render
    if (!html) html = '<p style="color:var(--text-light);font-size:0.85rem;">' + i18n.t('qv.noSizeAvailable') + '</p>';
    return html;
}

function productRibbonHtml(product) {
    var allowed = ['Nouveau', 'Promotion', 'Pas Disponible', 'Édition Limitée', 'Best Seller'];
    var ribbonClasses = { 'Nouveau': 'ribbon-nouveau', 'Promotion': 'ribbon-promotion', 'Best Seller': 'ribbon-best', 'Édition Limitée': 'ribbon-limited', 'Pas Disponible': 'ribbon-unavailable' };
    if (product.badge && allowed.indexOf(product.badge) !== -1) {
        return '<div class="product-ribbons"><span class="product-ribbon ' + (ribbonClasses[product.badge] || '') + '">' + esc(product.badge) + '</span></div>';
    }
    return '';
}

function renderProductCard(product) {
    if (!product) return '';
    var pid = product.id || 0;
    var inW = pid && wishlist.indexOf(pid) !== -1;
    var imgs = product.images && product.images.length > 0 ? product.images : (product.image ? [product.image] : [PLACEHOLDER_IMG]);
    var second = imgs.length > 1 ? imgs[1] : null;
    var ribbon = productRibbonHtml(product);
    var sizesHtml = '';
    if (product.sizes && product.sizes.length > 0) {
        var available = product.sizes.filter(function(s) { return typeof s === 'object' ? s.stock > 0 : true; });
        if (available.length > 0) {
            var isGroupedTaille = product.category_size_system === 'grouped_taille';
            if (!isGroupedTaille && available.length > 0) {
                var firstName = typeof available[0] === 'object' ? available[0].size : available[0];
                if (firstName && firstName.indexOf('Taille') === 0) isGroupedTaille = true;
            }
            if (isGroupedTaille) {
                /* Show Taille group boxes on product card — compact single-line layout */
                var tailleHtml = '<div class="product-sizes-grouped">' +
                    '<span class="product-sizes-label">Disponible</span>' +
                    '<div class="sz-group-taille-boxes">';
                window.SIZE_GROUPS.forEach(function(grp) {
                    var sizeEntry = null;
                    for (var i = 0; i < available.length; i++) {
                        var sn = typeof available[i] === 'object' ? available[i].size : available[i];
                        if (sn === grp.label) { sizeEntry = available[i]; break; }
                    }
                    if (!sizeEntry) return;
                    var infoText = grp.sizes.join(' \u00b7 ');
                    tailleHtml += '<div class="sz-taille-box" onclick="quickView(' + pid + ')">' +
                        '<span class="sz-taille-label">' + grp.label + '</span>' +
                        '<span class="sz-taille-info">(' + infoText + ')</span>' +
                    '</div>';
                });
                tailleHtml += '</div></div>';
                sizesHtml = tailleHtml;
            } else {
                var sizeLabels = available.map(function(s) { return esc(typeof s === 'object' ? s.size : s); }).join(' \u2022 ');
                sizesHtml = '<div class="product-sizes">Disponible : ' + sizeLabels + '</div>';
            }
        }
    }
    var priceHtml = product.sale_price
        ? '<span class="original-price">' + formatPriceDA(product.price) + '</span><span class="sale-price">' + formatPriceDA(product.sale_price) + '</span>'
        : '<span class="current-price">' + formatPriceDA(product.price) + '</span>';
    var stockLabelHtml = '';
    var totalStock = 0;
    if (product.variants && product.variants.length > 0) {
        product.variants.forEach(function(v) {
            if (v.sizes && Array.isArray(v.sizes)) {
                v.sizes.forEach(function(s) { totalStock += (s.stock || 0); });
            } else {
                totalStock += (v.stock || 0);
            }
        });
    } else if (product.stock) {
        totalStock = product.stock;
    }
    if (totalStock > 0 && totalStock <= 5) {
        stockLabelHtml = '<div class="stock-indicator low">' + i18n.t('stock.low').replace('{n}', totalStock) + '</div>';
    } else if (totalStock === 0) {
        stockLabelHtml = '<div class="stock-indicator out">' + i18n.t('stock.out') + '</div>';
    }
    var inCart = pid && cart.some(function(item) { return item.id === pid; });
    return '<div class="product-card' + (inCart ? ' in-cart' : '') + '" data-product-id="' + pid + '">' +
        '<div class="product-image">' +
            '<img src="' + cloudinaryThumb(imgs[0], 400) + '" alt="' + esc(product.name) + '" class="img-primary" loading="lazy" decoding="async" width="400" height="533" onerror="onImgError(this)">' +
            (second ? '<img src="' + cloudinaryThumb(second, 400) + '" alt="' + esc(product.name) + '" class="img-secondary" loading="lazy" decoding="async" width="400" height="533" onerror="onImgError(this)">' : '') +
            ribbon +
            '<button class="product-wishlist' + (inW ? ' active' : '') + '" onclick="toggleWishlistItem(this,' + pid + ')" aria-label="Wishlist">' +
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
                '</svg>' +
            '</button>' +
            '<div class="product-overlay">' +
                '<button class="btn-overlay" onclick="quickView(' + pid + ')">Aperçu rapide</button>' +
                '<button class="btn-overlay btn-overlay-primary" onclick="addToCartOrQuickView(' + pid + ')">' + i18n.t('product.addCart') + '</button>' +
            '</div>' +
        '</div>' +
        '<div class="product-info">' +
            '<h3 class="product-title"><a href="product.html?id=' + pid + '">' + esc(product.name) + '</a></h3>' +
            sizesHtml +
            stockLabelHtml + '<div class="product-price">' + priceHtml + '</div>' +
        '</div>' +
    '</div>';
}

function renderProducts(productsToRender, container) {
    if (!container) return;
    if (!productsToRender) productsToRender = [];
    container.innerHTML = productsToRender.map(renderProductCard).join('');
}

function searchProducts(query) {
    const container = document.getElementById('search-results');
    if (!container) return;
    if (!query.trim()) {
        container.innerHTML = '';
        return;
    }
    const q = query.toLowerCase().trim();
    const results = products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q))
    );
    if (results.length === 0) {
        container.innerHTML = '<p class="no-results" style="display:block;">' + i18n.t('search.noResults') + '</p>';
        return;
    }
    container.innerHTML = results.slice(0, 8).map(p => {
        var thumb = (p.images && p.images.length > 0) ? p.images[0] : PLACEHOLDER_IMG;
        return `<div class="search-suggestion" onclick="closeSearchModal(); window.location.href='product.html?id=${p.id}'">
            <img src="${thumb}" alt="${esc(p.name)}" class="search-suggestion-img" loading="lazy" onerror="onImgError(this)">
            <div class="search-suggestion-info">
                <div class="search-suggestion-name">${esc(p.name)}</div>
                <div class="search-suggestion-meta">${esc(p.category)}${p.brand ? ' &middot; ' + esc(p.brand) : ''} &middot; ${formatPriceDA(p.price)}</div>
            </div>
        </div>`;
    }).join('');
}

function handleSearchInput(event) {
    const input = event.target;
    searchProducts(input.value);
}



function toggleWishlistItem(button, productId) {
    const idx = wishlist.indexOf(productId);
    if (idx > -1) {
        wishlist.splice(idx, 1);
        button.classList.remove('active');
    } else {
        wishlist.push(productId);
        button.classList.add('active');
    }
    localStorage.setItem('adalinaWishlist', JSON.stringify(wishlist));
    updateWishlistCounter();
}

function updateOverlay() {
    const overlay = document.getElementById('overlay');
    if (!overlay) return;
    const anyActive = document.querySelector('#cart-sidebar.active, #wishlist.active');
    overlay.classList.toggle('active', !!anyActive);
}

function closeAllDrawers() {
    const cart = document.getElementById('cart-sidebar');
    const wishlist = document.getElementById('wishlist');
    const qv = document.getElementById('quick-view-modal');
    if (cart) cart.classList.remove('active');
    if (wishlist) wishlist.classList.remove('active');
    if (qv) qv.classList.remove('active');
    updateOverlay();
}

function toggleWishlist() {
    const sidebar = document.getElementById('wishlist');
    if (sidebar) {
        sidebar.classList.toggle('active');
        updateOverlay();
        updateWishlistDisplay();
    }
}

function updateWishlistDisplay() {
    if (document.querySelector('.wishlist-page')) return;
    const container = document.getElementById('wishlist-items');
    if (!container) return;
    if (wishlist.length === 0) {
        container.innerHTML = '<div class="empty-wishlist"><p>' + i18n.t('wishlist.empty') + '</p></div>';
        return;
    }
    container.innerHTML = '';
    var fragments = [];
    wishlist.forEach(id => {
        const p = products.find(pr => pr.id === id);
        if (p) {
            var wImg = (p.images && p.images.length > 0) ? p.images[0] : PLACEHOLDER_IMG;
            fragments.push(`
                <div class="wishlist-item">
                    <a href="product.html?id=${p.id}">
                        <img src="${wImg}" alt="${esc(p.name)}" class="cart-item-image" onerror="onImgError(this)">
                    </a>
                    <div class="cart-item-details">
                        <a href="product.html?id=${p.id}" style="text-decoration:none;color:inherit">
                            <h3 class="cart-item-title">${esc(p.name)}</h3>
                        </a>
                        <p class="cart-item-price">${formatPriceDA(p.price)}</p>
                        <button class="btn btn-outline" onclick="addToCartFromWishlist(${p.id})" style="font-size:0.75rem;padding:4px 8px;margin-bottom:4px;">' + i18n.t('qv.addToCart') + '</button>
                        <button class="remove-item" onclick="removeFromWishlist(${p.id})">Supprimer</button>
                    </div>
                </div>
            `);
        }
    });
    var shareBtns = '<div class="wishlist-share" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border-light);display:flex;gap:8px;">' +
        '<button class="btn-share-wl" style="flex:1;padding:0.7rem;border:none;border-radius:var(--radius-sm);background:#25D366;color:#fff;cursor:pointer;font-size:0.82rem;font-family:var(--font-body);font-weight:500;" onclick="shareWishlistWhatsApp()">💬 ' + i18n.t('wishlistPage.shareWA') + '</button>' +
        '</div>';
    fragments.push(shareBtns);
    container.innerHTML = fragments.join('');
}

function removeFromWishlist(productId) {
    const idx = wishlist.indexOf(productId);
    if (idx > -1) {
        wishlist.splice(idx, 1);
        localStorage.setItem('adalinaWishlist', JSON.stringify(wishlist));
        updateWishlistDisplay();
        updateWishlistCounter();
    }
}

function renderWishlistPage() {
    const container = document.getElementById('wishlist-items');
    if (!container) return;
    const emptyEl = document.querySelector('.wishlist-page .empty-wishlist');
    if (wishlist.length === 0) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    var html = '';
    wishlist.forEach(function(id) {
        var p = products.find(function(pr) { return pr.id === id; });
        if (!p) return;
        var wImg = (p.images && p.images.length > 0) ? p.images[0] : PLACEHOLDER_IMG;
        var priceHtml = p.sale_price
            ? '<span class="original-price">' + formatPriceDA(p.price) + '</span> <span class="sale-price">' + formatPriceDA(p.sale_price) + '</span>'
            : '<span class="current-price">' + formatPriceDA(p.price) + '</span>';
        html += '<div class="wishlist-page-item">' +
            '<a href="product.html?id=' + p.id + '" class="wpi-img-wrap">' +
                '<img src="' + cloudinaryThumb(wImg, 200) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="onImgError(this)">' +
            '</a>' +
            '<div class="wpi-info">' +
                '<a href="product.html?id=' + p.id + '" class="wpi-name">' + esc(p.name) + '</a>' +
                '<div class="wpi-price">' + priceHtml + '</div>' +
                '<div class="wpi-actions">' +
                    '<button class="btn btn-primary btn-sm" onclick="addToCartFromWishlist(' + p.id + ')">' + i18n.t('qv.addToCart') + '</button>' +
                    '<button class="btn btn-outline btn-sm" onclick="removeFromWishlist(' + p.id + ')">Supprimer</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    });
    var shareBtns = '<div class="wishlist-page-share">' +
        '<button class="btn btn-share-wa" onclick="shareWishlistWhatsApp()"><i class="fab fa-whatsapp"></i> ' + i18n.t('wishlistPage.shareWA') + '</button>' +
    '</div>';
    container.innerHTML = html + shareBtns;
}

function addToCartFromWishlist(productId) {
    addToCart(productId);
    removeFromWishlist(productId);
    if (document.querySelector('.wishlist-page')) {
        renderWishlistPage();
    }
}

function updateWishlistCounter() {
    const wishlistBtn = document.querySelector('.header-icon-btn[onclick*="toggleWishlist"]');
    if (!wishlistBtn) return;
    if (window.getComputedStyle(wishlistBtn).position === 'static') {
        wishlistBtn.style.position = 'relative';
    }
    let badge = wishlistBtn.querySelector('.wishlist-counter');
    const count = wishlist.length;
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'wishlist-counter';
            wishlistBtn.appendChild(badge);
        }
        badge.textContent = count;
    } else {
        if (badge) badge.remove();
    }
    pulseIcon(wishlistBtn);
}

function addToCartOrQuickView(productId) {
    var product = products.find(function (p) { return p.id === productId; });
    if (product && ((product.variants && product.variants.length > 0) || (product.colors && product.colors.length > 0) || (product.sizes && product.sizes.length > 0))) {
        quickView(productId);
        return;
    }
    addToCart(productId);
}

function addToCart(productId, qty, size, color) {
    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;
    qty = qty || 1;
    size = size || '';
    color = color || '';
    var existing = cart.find(function (item) { return item.id === product.id && (item.selectedSize || '') === size && (item.selectedColor || '') === color; });
    if (existing) {
        existing.quantity += qty;
    } else {
        var item = Object.assign({}, product, { quantity: qty, selectedSize: size, selectedColor: color });
        cart.push(item);
    }
    localStorage.setItem('adalinaCart', JSON.stringify(cart));
    updateCartDisplay();
    updateCartCounter();
    glowProductCard(product.id);
    var sidebar = document.getElementById('cart-sidebar');
    if (sidebar && !sidebar.classList.contains('active')) {
        toggleCart();
    }
}

function glowProductCard(productId) {
    var cards = document.querySelectorAll('.product-card[data-product-id="' + productId + '"]');
    cards.forEach(function(card) {
        if (cart.some(function(item) { return item.id === productId; })) {
            card.classList.add('in-cart');
        } else {
            card.classList.remove('in-cart');
        }
    });
}

function refreshInCartGlow() {
    var cards = document.querySelectorAll('.product-card[data-product-id]');
    cards.forEach(function(card) {
        var pid = parseInt(card.getAttribute('data-product-id'), 10);
        if (cart.some(function(item) { return item.id === pid; })) {
            card.classList.add('in-cart');
        } else {
            card.classList.remove('in-cart');
        }
    });
}

function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    if (sidebar) {
        var opening = !sidebar.classList.contains('active');
        if (opening) {
            var qv = document.getElementById('quick-view-modal');
            if (qv && qv.classList.contains('active')) qv.classList.remove('active');
        }
        sidebar.classList.toggle('active');
        updateOverlay();
        updateCartDisplay();
    }
}

function getCartItemImage(item) {
    var color = item.selectedColor;
    if (color) {
        var variants = item.variants || [];
        var variant = variants.find(function(v) { return v.color_name === color; });
        if (variant && variant.images && variant.images.length > 0) {
            return variant.images[0];
        }
    }
    return item.images && item.images.length > 0 ? item.images[0] : PLACEHOLDER_IMG;
}

function updateCartDisplay() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total-price');
    const header = document.querySelector('.sidebar-header h3');
    if (!container) return;
    const emptyMsg = container.querySelector('.empty-cart');
    if (cart.length === 0) {
        var recHtml = '';
        if (products && products.length > 0) {
            var shuffled = products.slice().sort(function() { return 0.5 - Math.random(); });
            var recs = shuffled.slice(0, 4);
            recHtml = '<div class="empty-cart-recs"><p style="font-size:0.82rem;color:var(--text-light);margin-bottom:12px;text-align:center;">' + i18n.t('cart.recommendations') + '</p><div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;">';
            recs.forEach(function(p) {
                var img = (p.images && p.images[0]) || (p.image || '');
                var price = formatPriceDA(p.sale_price || p.price);
                recHtml += '<div style="flex:0 0 120px;text-align:center;cursor:pointer;" onclick="quickView(' + p.id + ')"><img src="' + cloudinaryThumb(img, 200) + '" style="width:120px;height:160px;object-fit:cover;border-radius:6px;" onerror="onImgError(this)"><p style="font-size:0.72rem;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.name) + '</p><p style="font-size:0.72rem;color:var(--primary);font-weight:600;">' + price + '</p></div>';
            });
            recHtml += '</div></div>';
        }
        container.innerHTML = '<div class="empty-cart"><p>' + i18n.t('cart.empty') + '</p>' + recHtml + '</div>';
        if (totalEl) totalEl.textContent = '0,00 €';
        if (header) header.textContent = i18n.t('cart.title');
        const emptyBtn = document.querySelector('.empty-cart-btn');
        if (emptyBtn) emptyBtn.style.display = 'none';
        return;
    }
    container.innerHTML = '';
    let total = 0;
    let itemCount = 0;
    var cartFragments = [];
    cart.forEach(item => {
        const subtotal = (Number(item.price) || 0) * (item.quantity || 1);
        total += subtotal;
        itemCount += item.quantity;
        var variantInfo = '';
        if (item.selectedSize || item.selectedColor) {
            variantInfo = '<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;">';
            if (item.selectedSize) variantInfo += i18n.t('qv.size') + ' : ' + item.selectedSize;
            if (item.selectedSize && item.selectedColor) variantInfo += ' | ';
            if (item.selectedColor) variantInfo += i18n.t('qv.color') + ' : ' + item.selectedColor;
            variantInfo += '</div>';
        }
        var cartKey = item.id + '-' + (item.selectedSize || '') + '-' + (item.selectedColor || '');
        cartFragments.push(`
            <div class="cart-item">
                <img src="${getCartItemImage(item)}" alt="${esc(item.name)}" class="cart-item-image" loading="lazy" onerror="onImgError(this)">
                <div class="cart-item-details">
                    <h3 class="cart-item-title">${esc(item.name)}</h3>
                    ${variantInfo}
                    <p class="cart-item-price">${formatPriceDA(item.price)}</p>
                    <div class="cart-item-subtotal">${i18n.t('cart.subtotal')} : ${formatPriceDA(subtotal)}</div>
                    <div class="cart-item-quantity">
                        <button class="quantity-btn" onclick="changeQtyByKey('${cartKey}', -1)">−</button>
                        <input type="text" class="quantity-input" id="qty-${cartKey}" value="${item.quantity}" onchange="setQtyByKey('${cartKey}')">
                        <button class="quantity-btn" onclick="changeQtyByKey('${cartKey}', 1)">+</button>
                        <button class="quantity-btn" onclick="quickViewForCart('${cartKey}')" style="font-size:0.7rem;padding:0 6px;min-width:auto" title="Modifier">✎</button>
                        <button class="remove-item" onclick="removeFromCartByKey('${cartKey}')">✕</button>
                    </div>
                </div>
            </div>
        `);
    });
    container.innerHTML = cartFragments.join('');
    if (header) header.textContent = i18n.t('cart.title') + ' (' + itemCount + ')' ;
    if (totalEl) totalEl.textContent = formatPriceDA(total);
    let emptyBtn = document.querySelector('.empty-cart-btn');
    if (!emptyBtn) {
        const footer = document.querySelector('.sidebar-footer');
        if (footer) {
            emptyBtn = document.createElement('button');
            emptyBtn.className = 'btn btn-outline empty-cart-btn';
            emptyBtn.textContent = i18n.t('cart.emptyCart');
            emptyBtn.style.width = '100%';
            emptyBtn.style.marginBottom = '0.5rem';
            emptyBtn.onclick = emptyCart;
            footer.insertBefore(emptyBtn, footer.firstChild);
        }
    }
    if (emptyBtn) emptyBtn.style.display = 'block';
    updateCartCounter();
    refreshInCartGlow();
}

function findCartItemByKey(key) {
    return cart.findIndex(function(item) {
        return (item.id + '-' + (item.selectedSize || '') + '-' + (item.selectedColor || '')) === key;
    });
}

function changeQtyByKey(key, delta) {
    var idx = findCartItemByKey(key);
    if (idx === -1) return;
    var item = cart[idx];
    var newQty = item.quantity + delta;
    if (newQty <= 0) {
        cart.splice(idx, 1);
    } else {
        item.quantity = newQty;
    }
    localStorage.setItem('adalinaCart', JSON.stringify(cart));
    updateCartDisplay();
    updateCartCounter();
    if (document.getElementById('cart-page-items')) renderCartPage();
    if (document.getElementById('checkout-items')) updateCheckoutSummary();
}

function setQtyByKey(key) {
    var idx = findCartItemByKey(key);
    if (idx === -1) return;
    var input = document.getElementById('qty-' + key);
    if (!input) return;
    var val = parseInt(input.value);
    if (!isNaN(val) && val > 0) {
        cart[idx].quantity = val;
        localStorage.setItem('adalinaCart', JSON.stringify(cart));
        updateCartDisplay();
        updateCartCounter();
        if (document.getElementById('cart-page-items')) renderCartPage();
        if (document.getElementById('checkout-items')) updateCheckoutSummary();
    } else {
        input.value = cart[idx].quantity;
    }
}

function removeFromCartByKey(key) {
    var idx = findCartItemByKey(key);
    if (idx === -1) return;
    cart.splice(idx, 1);
    localStorage.setItem('adalinaCart', JSON.stringify(cart));
    updateCartDisplay();
    updateCartCounter();
    if (document.getElementById('cart-page-items')) renderCartPage();
    if (document.getElementById('checkout-items')) updateCheckoutSummary();
}

function changeQty(productId, delta) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
        removeFromCart(productId);
        return;
    }
    item.quantity = newQty;
    const input = document.getElementById(`qty-${productId}`);
    if (input) input.value = newQty;
    localStorage.setItem('adalinaCart', JSON.stringify(cart));
    updateCartDisplay();
    updateCartCounter();
}

function setQty(productId) {
    const item = cart.find(i => i.id === productId);
    const input = document.getElementById(`qty-${productId}`);
    if (!item || !input) return;
    const val = parseInt(input.value);
    if (!isNaN(val) && val > 0) {
        item.quantity = val;
        localStorage.setItem('adalinaCart', JSON.stringify(cart));
        updateCartDisplay();
        updateCartCounter();
    } else {
        input.value = item.quantity;
    }
}

function removeFromCart(productId) {
    const idx = cart.findIndex(i => i.id === productId);
    if (idx > -1) {
        cart.splice(idx, 1);
        localStorage.setItem('adalinaCart', JSON.stringify(cart));
        updateCartDisplay();
        updateCartCounter();
    }
}

function emptyCart() {
    cart = [];
    localStorage.setItem('adalinaCart', JSON.stringify(cart));
    updateCartDisplay();
    updateCartCounter();
    if (document.getElementById('cart-page-items')) renderCartPage();
    if (document.getElementById('checkout-items')) updateCheckoutSummary();
}

function updateCartCounter() {
    const cartBtn = document.querySelector('.header-icon-btn[onclick*="toggleCart"]');
    if (!cartBtn) return;
    if (window.getComputedStyle(cartBtn).position === 'static') {
        cartBtn.style.position = 'relative';
    }
    let badge = cartBtn.querySelector('.cart-counter');
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'cart-counter';
            cartBtn.appendChild(badge);
        }
        badge.textContent = count;
    } else {
        if (badge) badge.remove();
    }
    pulseIcon(cartBtn);
}

function renderCartPage() {
    var container = document.getElementById('cart-page-items');
    if (!container) return;
    if (cart.length === 0) {
        container.innerHTML = '<div class="cart-empty"><p>' + i18n.t('cartPage.empty') + '.</p><a href="shop.html" class="btn btn-primary" style="display:inline-block;text-decoration:none;margin-top:1rem">' + i18n.t('wishlistPage.shop') + '</a></div>';
        return;
    }
    var subtotal = 0;
    container.innerHTML = cart.map(function(item) {
        var itemTotal = (Number(item.price) || 0) * (item.quantity || 1);
        subtotal += itemTotal;
        var cartKey = item.id + '-' + (item.selectedSize || '') + '-' + (item.selectedColor || '');
        var variantInfo = '';
        if (item.selectedSize || item.selectedColor) {
            variantInfo = '<div class="cart-item-variant">';
            if (item.selectedSize) variantInfo += i18n.t('qv.size') + ': ' + item.selectedSize;
            if (item.selectedSize && item.selectedColor) variantInfo += ' | ';
            if (item.selectedColor) variantInfo += item.selectedColor;
            variantInfo += '</div>';
        }
        return '<div class="cart-item">' +
            '<div class="cart-item-image"><img src="' + getCartItemImage(item) + '" alt="' + esc(item.name) + '" loading="lazy" onerror="onImgError(this)"></div>' +
            '<div class="cart-item-details">' +
                '<h3 class="cart-item-title">' + esc(item.name) + '</h3>' +
                variantInfo +
                '<p class="cart-item-price">' + formatPriceDA(item.price) + '</p>' +
                '<div class="cart-item-quantity">' +
                    '<button class="quantity-btn" onclick="changeQtyByKey(\'' + cartKey + '\', -1)">−</button>' +
                    '<input type="text" class="quantity-input" id="qty-' + cartKey + '" value="' + item.quantity + '" onchange="setQtyByKey(\'' + cartKey + '\')">' +
                    '<button class="quantity-btn" onclick="changeQtyByKey(\'' + cartKey + '\', 1)">+</button>' +
                    '<button class="btn btn-sm btn-outline modifier-btn" onclick="quickViewForCart(\'' + cartKey + '\')">' + i18n.t('cart.modifier') + '</button>' +
                    '<button class="remove-item" onclick="removeFromCartByKey(\'' + cartKey + '\')">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="cart-item-total">' + formatPriceDA(itemTotal) + '</div>' +
        '</div>';
    }).join('');
    var delivery = getDeliveryPrice();
    var total = subtotal + delivery;
    var subtotalEl = document.getElementById('cart-subtotal');
    var totalEl = document.getElementById('cart-total');
    var taxEl = document.getElementById('cart-tax');
    if (subtotalEl) subtotalEl.textContent = formatPriceDA(subtotal);
    if (taxEl) taxEl.textContent = formatPriceDA(Math.round(subtotal * 0.08));
    if (totalEl) totalEl.textContent = formatPriceDA(total);
}

function openSearchModal() {
    let modal = document.getElementById('search-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'search-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close-modal" onclick="closeSearchModal()">&times;</span>
                <h2>' + i18n.t('search.title') + '</h2>
                <div class="search-container">
                    <input type="text" id="search-input" placeholder="' + i18n.t('search.placeholder') + '" onkeyup="handleSearchInput(event)">
                    <button onclick="searchProducts(document.getElementById(\'search-input\').value)">' + i18n.t('search.button') + '</button>
                </div>
                <div class="search-results" id="search-results"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
    const input = document.getElementById('search-input');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 100);
    }
    const results = document.getElementById('search-results');
    if (results) results.innerHTML = '';
}

function closeSearchModal() {
    const modal = document.getElementById('search-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.add('closing');
        setTimeout(function() { modal.classList.remove('closing'); }, 420);
    }
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    const results = document.getElementById('search-results');
    if (results) results.innerHTML = '';
}

function doSearch() {
    const query = document.getElementById('search-input');
    if (query) searchProducts(query.value);
}

/* Quick View state */
var _qv = { product: null, currentIndex: 0, selectedSize: '', selectedColor: '', quantity: 1, modifyCartKey: null };

function quickViewForCart(cartKey) {
    var idx = findCartItemByKey(cartKey);
    if (idx === -1) return;
    var item = cart[idx];
    quickView(item.id);
    _qv.selectedColor = item.selectedColor || '';
    _qv.selectedSize = item.selectedSize || '';
    _qv.quantity = item.quantity || 1;
    _qv.modifyCartKey = cartKey;
    var qtyInput = document.getElementById('qv-qty-input');
    if (qtyInput) qtyInput.value = _qv.quantity;
    document.querySelectorAll('.qv-color-btn').forEach(function(btn) {
        btn.classList.toggle('selected', btn.getAttribute('data-value') === _qv.selectedColor);
    });
    qvUpdateSizes();
    document.querySelectorAll('.qv-size-btn').forEach(function(btn) {
        btn.classList.toggle('selected', btn.textContent.trim() === _qv.selectedSize);
    });
    var images = getQVariantImages();
    var mainImg = document.getElementById('quick-view-main-image');
    if (mainImg) mainImg.src = cloudinaryThumb(images[0], 600);
    var thumbs = document.getElementById('quick-view-thumbs');
    if (thumbs) {
        thumbs.innerHTML = images.map(function(img, i) {
            return '<div class="qv-thumb' + (i === 0 ? ' active' : '') + '" onclick="qvGoToImage(' + i + ')"><img src="' + cloudinaryThumb(img, 120) + '" alt="" onerror="onImgError(this)"></div>';
        }).join('');
    }
    qvUpdateStockDisplay();
}

function quickView(productId) {
    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;
    _qv.product = product;
    _qv.currentIndex = 0;
    _qv.selectedSize = '';
    _qv.selectedColor = '';
    _qv.quantity = 1;

    var cartSidebar = document.getElementById('cart-sidebar');
    if (cartSidebar && cartSidebar.classList.contains('active')) {
        cartSidebar.classList.remove('active');
    }

    var modal = document.getElementById('quick-view-modal');
    if (modal) modal.classList.add('active');
    var qvCheck = document.getElementById('qv-toggle');
    if (qvCheck) qvCheck.checked = false;

    /* Colors */
    var qvVariants = product.variants || [];
    var qvHasVariants = qvVariants.length > 0;
    var colorsContainer = document.getElementById('qv-colors');
    if (colorsContainer) {
        var qvAvailColors = qvHasVariants ? (product.colors || []).filter(function (c) {
            var cname = typeof c === 'object' ? c.name : c;
            return qvVariants.some(function(v) {
                if (v.color_name !== cname) return false;
                if (v.sizes && Array.isArray(v.sizes)) return v.sizes.some(function(sz) { return sz.stock > 0; });
                return v.stock > 0;
            });
        }) : (product.colors || []);
        if (qvAvailColors && qvAvailColors.length > 0) {
            colorsContainer.innerHTML = qvAvailColors.map(function (c) {
                var cname = typeof c === 'object' ? c.name : c;
                var hex = typeof c === 'object' ? (c.hex || colorToHex[cname] || '#ccc') : (colorToHex[c] || '#ccc');
                return '<button class="qv-color-btn" data-value="' + cname.replace(/'/g, "\\'") + '" onclick="qvSelectColor(this, \'' + cname.replace(/'/g, "\\'") + '\')" style="background:' + hex + '" title="' + cname + '"></button>';
            }).join('');
            _qv.selectedColor = typeof qvAvailColors[0] === 'object' ? qvAvailColors[0].name : qvAvailColors[0];
            var firstColor = colorsContainer.querySelector('.qv-color-btn');
            if (firstColor) firstColor.classList.add('selected');
        } else {
            colorsContainer.innerHTML = '';
        }
    }

    /* Images — use variant images if a color is selected */
    var images = getQVariantImages();
    var mainImg = document.getElementById('quick-view-main-image');
    if (mainImg) { mainImg.src = cloudinaryThumb(images[0], 600); mainImg.onerror = function() { onImgError(this); }; }

    /* Ribbon */
    var qvWrap = mainImg ? mainImg.parentElement : null;
    if (qvWrap) {
        var existingRibbon = qvWrap.querySelector('.product-ribbons');
        if (existingRibbon) existingRibbon.remove();
        var ribbonHtml = productRibbonHtml(product);
        if (ribbonHtml) qvWrap.insertAdjacentHTML('afterbegin', ribbonHtml);
    }

    var thumbs = document.getElementById('quick-view-thumbs');
    if (thumbs) {
        thumbs.innerHTML = images.map(function (img, i) {
            return '<div class="qv-thumb' + (i === 0 ? ' active' : '') + '" onclick="qvGoToImage(' + i + ')"><img src="' + img + '" alt="" onerror="onImgError(this)"></div>';
        }).join('');
    }

    /* Info */
    var titleEl = document.getElementById('quick-view-title');
    if (titleEl) titleEl.textContent = product.name;

    var priceEl = document.getElementById('quick-view-price');
    if (priceEl) {
        if (product.sale_price) {
            priceEl.innerHTML = '<span class="original-price">' + formatPriceDA(product.price) + '</span> <span class="sale-price">' + formatPriceDA(product.sale_price) + '</span>';
        } else {
            priceEl.textContent = formatPriceDA(product.price);
        }
    }

    /* Sizes — filtered by selected color */
    qvUpdateSizes();

    /* Stock info */
    qvUpdateStockDisplay();

    /* Quantity */
    var qtyInput = document.getElementById('qv-qty-input');
    if (qtyInput) qtyInput.value = '1';

    /* Wishlist text */
    var wishlistText = document.getElementById('qv-wishlist-text');
    if (wishlistText) {
        var inWish = wishlist.indexOf(product.id) !== -1;
        wishlistText.textContent = inWish ? i18n.t('qv.wishlistRemove') : i18n.t('qv.wishlist');
    }

    /* Description */
    var descEl = document.getElementById('qv-desc');
    if (descEl) {
        var desc = product.description || '';
        if (desc.trim()) {
            descEl.innerHTML = '<div class="qv-desc-box"><h4>' + i18n.t('qv.description') + '</h4><p>' + esc(desc) + '</p></div>';
            descEl.style.display = '';
        } else {
            descEl.innerHTML = '';
            descEl.style.display = 'none';
        }
    }

    _qv.currentIndex = 0;
    var images = getQVariantImages();
    var prevBtn = document.querySelector('#quick-view-modal .qv-prev');
    var nextBtn = document.querySelector('#quick-view-modal .qv-next');
    if (prevBtn) prevBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.toggle('hidden', images.length <= 1);
}

function closeQuickView() {
    _qv.modifyCartKey = null;
    var qv = document.getElementById('quick-view-modal');
    if (!qv) return;
    qv.classList.remove('active');
    qv.classList.add('closing');
    setTimeout(function() { qv.classList.remove('closing'); }, 420);
}

function openQvZoom() {
    var mainImg = document.getElementById('quick-view-main-image');
    var zoomImg = document.getElementById('qv-zoom-image');
    var overlay = document.getElementById('qv-zoom-overlay');
    if (!mainImg || !mainImg.src || !zoomImg || !overlay) return;
    var bigSrc = mainImg.src.replace(/\/w_\d+,/, '/w_1200,').replace(/\/h_\d+,/, '/h_1200,');
    if (bigSrc === mainImg.src) bigSrc = mainImg.src;
    zoomImg.src = bigSrc;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeQvZoom() {
    var overlay = document.getElementById('qv-zoom-overlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.style.overflow = '';
}

(function() {
    document.addEventListener('click', function(e) {
        var overlay = document.getElementById('qv-zoom-overlay');
        if (overlay && overlay.classList.contains('active') && (e.target === overlay || e.target.classList.contains('qv-zoom-close'))) {
            closeQvZoom();
        }
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            var overlay = document.getElementById('qv-zoom-overlay');
            if (overlay && overlay.classList.contains('active')) {
                closeQvZoom();
                e.stopPropagation();
            }
        }
    });
})();

function qvGoToImage(index) {
    _qv.currentIndex = index;
    var images = getQVariantImages();
    var mainImg = document.getElementById('quick-view-main-image');
    if (mainImg) { mainImg.src = cloudinaryThumb(images[index] || images[0], 600); mainImg.onerror = function() { onImgError(this); }; }
    var thumbs = document.querySelectorAll('#quick-view-thumbs .qv-thumb');
    thumbs.forEach(function (el, i) { el.classList.toggle('active', i === index); });
    var prevBtn = document.querySelector('#quick-view-modal .qv-prev');
    var nextBtn = document.querySelector('#quick-view-modal .qv-next');
    if (prevBtn) prevBtn.classList.toggle('hidden', index <= 0);
    if (nextBtn) nextBtn.classList.toggle('hidden', index >= images.length - 1);
}

function qvPrevImage() {
    if (_qv.currentIndex <= 0) return;
    qvGoToImage(_qv.currentIndex - 1);
}

function qvNextImage() {
    var images = getQVariantImages();
    if (_qv.currentIndex >= images.length - 1) return;
    qvGoToImage(_qv.currentIndex + 1);
}

function getQVariantImages() {
    var product = _qv.product;
    if (!product) return [];
    var color = _qv.selectedColor;
    if (color) {
        var variants = product.variants || [];
        var variant = variants.find(function(v) { return v.color_name === color; });
        if (variant && variant.images && variant.images.length > 0) {
            return variant.images;
        }
    }
    return product.images && product.images.length > 0 ? product.images : [PLACEHOLDER_IMG];
}

function updateQVGallery(images) {
    if (!images || images.length === 0) return;
    var mainImg = document.getElementById('quick-view-main-image');
    if (mainImg) mainImg.src = cloudinaryThumb(images[0], 600);
    _qv.currentIndex = 0;

    var thumbs = document.getElementById('quick-view-thumbs');
    if (thumbs) {
        if (images.length > 1) {
            thumbs.innerHTML = images.map(function(img, i) {
                return '<div class="qv-thumb' + (i === 0 ? ' active' : '') + '" onclick="qvGoToImage(' + i + ')"><img src="' + img + '" alt="" onerror="onImgError(this)"></div>';
            }).join('');
            thumbs.style.display = '';
        } else {
            thumbs.innerHTML = '';
        }
    }
    var qvNavs = document.querySelectorAll('#quick-view-modal .qv-nav');
    qvNavs.forEach(function(nav) { nav.style.display = images.length > 1 ? '' : 'none'; });
    var prevBtn = document.querySelector('#quick-view-modal .qv-prev');
    var nextBtn = document.querySelector('#quick-view-modal .qv-next');
    if (prevBtn) prevBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.toggle('hidden', images.length <= 1);
}

function qvUpdateSizes() {
    var product = _qv.product;
    if (!product) return;
    var color = _qv.selectedColor;
    var variants = product.variants || [];
    var container = document.getElementById('qv-sizes');
    if (!container) return;
    var hasVariants = variants.length > 0;
    var availSizes = hasVariants ? (product.sizes || []).filter(function (s) {
        var sname = typeof s === 'object' ? s.size : s;
        if (!color) {
            return variants.some(function(v) {
                if (v.sizes && Array.isArray(v.sizes)) return v.sizes.some(function(sz) { return sz.size === sname && sz.stock > 0; });
                return v.size_name === sname && v.stock > 0;
            });
        }
        return variants.some(function(v) {
            if (v.color_name !== color) return false;
            if (v.sizes && Array.isArray(v.sizes)) return v.sizes.some(function(sz) { return sz.size === sname && sz.stock > 0; });
            return v.size_name === sname && v.stock > 0;
        });
    }) : (product.sizes || []);
    if (availSizes && availSizes.length > 0) {
        var cur = _qv.selectedSize;
        var matched = availSizes.some(function(s) { var sn = typeof s === 'object' ? s.size : s; return sn === cur; });
        if (!matched) cur = typeof availSizes[0] === 'object' ? availSizes[0].size : availSizes[0];
        _qv.selectedSize = cur;
        container.innerHTML = buildGroupedSizesHtml(
            availSizes, product, color, cur, hasVariants,
            'qv-size-btn', 'qv-size-wrap',
            'onclick="qvSelectSize(this, \'{val}\')"',
            product.category_size_system
        );
    } else {
        container.innerHTML = '';
        _qv.selectedSize = '';
    }
}

function qvUpdateColors() {
    var product = _qv.product;
    if (!product) return;
    var size = _qv.selectedSize;
    var variants = product.variants || [];
    var container = document.getElementById('qv-colors');
    if (!container) return;
    var hasVariants = variants.length > 0;
    var availColors = hasVariants ? (product.colors || []).filter(function (c) {
        var cname = typeof c === 'object' ? c.name : c;
        if (!size) {
            return variants.some(function(v) {
                if (v.color_name !== cname) return false;
                if (v.sizes && Array.isArray(v.sizes)) return v.sizes.some(function(sz) { return sz.stock > 0; });
                return v.stock > 0;
            });
        }
        return variants.some(function(v) {
            if (v.color_name !== cname) return false;
            if (v.sizes && Array.isArray(v.sizes)) return v.sizes.some(function(sz) { return sz.size === size && sz.stock > 0; });
            return v.size_name === size && v.stock > 0;
        });
    }) : (product.colors || []);
    if (availColors && availColors.length > 0) {
        var cur = _qv.selectedColor;
        var matched = availColors.some(function(c) { var cn = typeof c === 'object' ? c.name : c; return cn === cur; });
        if (!matched) cur = typeof availColors[0] === 'object' ? availColors[0].name : availColors[0];
        _qv.selectedColor = cur;
        container.innerHTML = availColors.map(function (c) {
            var cname = typeof c === 'object' ? c.name : c;
            var hex = typeof c === 'object' ? (c.hex || colorToHex[cname] || '#ccc') : (colorToHex[c] || '#ccc');
            var sel = cname === cur ? ' selected' : '';
            return '<button class="qv-color-btn' + sel + '" data-value="' + cname.replace(/'/g, "\\'") + '" onclick="qvSelectColor(this, \'' + cname.replace(/'/g, "\\'") + '\')" style="background:' + hex + '" title="' + cname + '"></button>';
        }).join('');
    } else {
        container.innerHTML = '';
        _qv.selectedColor = '';
    }
}

function qvSelectColor(btn, color) {
    _qv.selectedColor = color;
    var siblings = btn.parentElement.querySelectorAll('.qv-color-btn');
    siblings.forEach(function (el) { el.classList.remove('selected'); });
    btn.classList.add('selected');
    qvUpdateSizes();
    var images = getQVariantImages();
    updateQVGallery(images);
    qvUpdateStockDisplay();
}

function qvSelectSize(btn, size) {
    _qv.selectedSize = size;
    document.querySelectorAll('.qv-size-btn').forEach(function (el) { el.classList.remove('selected'); });
    btn.classList.add('selected');
    qvUpdateColors();
    qvUpdateSizes();
    var images = getQVariantImages();
    updateQVGallery(images);
    qvUpdateStockDisplay();
}

function qvDisableButtons(disabled) {
    var modal = document.getElementById('quick-view-modal');
    if (!modal) return;
    var btns = modal.querySelectorAll('.qv-btn-primary, .qv-btn-dark');
    btns.forEach(function(btn) {
        btn.disabled = disabled;
    });
    var addBtn = modal.querySelector('.qv-btn-primary');
    if (addBtn) addBtn.textContent = disabled ? i18n.t('stock.out') : i18n.t('qv.addToCart');
}

function qvUpdateStockDisplay() {
    var product = _qv.product;
    if (!product) return;
    var variants = product.variants || [];
    var hasVariants = variants.length > 0;
    var curColor = _qv.selectedColor;
    var curSize = _qv.selectedSize;
    var el = document.getElementById('qv-stock-info');
    if (!el) return;
    if (curColor && curSize && hasVariants) {
        var vstock = getVariantStock(product, curColor, curSize);
        el.innerHTML = stockLabel(vstock) + ' <span class="stock-qty">' + i18n.t('qv.disponible').replace('{n}', vstock) + '</span>';
        qvDisableButtons(vstock === 0);
    } else if (hasVariants && (!curColor || !curSize)) {
        el.innerHTML = '<span class="stock-badge in-stock">' + i18n.t('qv.selectSizeAndColor') + '</span>';
        qvDisableButtons(false);
    } else if (product.stock > 0) {
        el.innerHTML = '<span class="stock-badge in-stock">' + i18n.t('qv.inStock') + '</span>';
        qvDisableButtons(false);
    } else {
        el.innerHTML = '<span class="stock-badge out-of-stock">' + i18n.t('stock.out') + '</span>';
        qvDisableButtons(true);
    }
}

function qvChangeQty(delta) {
    var input = document.getElementById('qv-qty-input');
    if (!input) return;
    var val = parseInt(input.value) + delta;
    if (val < 1) val = 1;
    input.value = val;
    _qv.quantity = val;
}

function qvValidateSelection() {
    var p = _qv.product;
    if (!p) return false;
    var hasVariants = (p.variants || []).length > 0;
    if (hasVariants && p.sizes && p.sizes.length > 0 && !_qv.selectedSize) {
        alert(i18n.t('product.validateSize'));
        return false;
    }
    if (hasVariants && p.colors && p.colors.length > 0 && !_qv.selectedColor) {
        alert(i18n.t('product.validateColor'));
        return false;
    }
    return true;
}

function qvAddToCart() {
    if (!_qv.product) return;
    if (!qvValidateSelection()) return;
    if (_qv.modifyCartKey) {
        var idx = findCartItemByKey(_qv.modifyCartKey);
        if (idx !== -1) cart.splice(idx, 1);
        _qv.modifyCartKey = null;
    }
    addToCart(_qv.product.id, _qv.quantity, _qv.selectedSize, _qv.selectedColor);
    closeQuickView();
    if (document.getElementById('cart-page-items')) renderCartPage();
    if (document.getElementById('checkout-items')) updateCheckoutSummary();
}

function qvBuyNow() {
    if (!_qv.product) return;
    if (!qvValidateSelection()) return;
    if (_qv.modifyCartKey) {
        var idx = findCartItemByKey(_qv.modifyCartKey);
        if (idx !== -1) cart.splice(idx, 1);
        _qv.modifyCartKey = null;
    }
    addToCart(_qv.product.id, _qv.quantity, _qv.selectedSize, _qv.selectedColor);
    closeQuickView();
    window.location.href = 'checkout.html';
}

function qvToggleWishlist() {
    if (!_qv.product) return;
    var id = _qv.product.id;
    var idx = wishlist.indexOf(id);
    if (idx === -1) {
        wishlist.push(id);
    } else {
        wishlist.splice(idx, 1);
    }
    localStorage.setItem('adalinaWishlist', JSON.stringify(wishlist));
    updateWishlistDisplay();
    updateWishlistCounter();
    var wishlistText = document.getElementById('qv-wishlist-text');
    if (wishlistText) {
        wishlistText.textContent = idx === -1 ? i18n.t('qv.wishlistRemove') : i18n.t('qv.wishlist');
    }
}

function scrollTrack(btn, dir) {
    var wrapper = btn.parentElement;
    var track = wrapper.querySelector('.scroll-track');
    if (!track) return;
    var card = track.querySelector('.product-card');
    var scrollAmount = card ? card.offsetWidth + 24 : 300;
    track.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
    setTimeout(function () { updateScrollArrows(wrapper); }, 350);
}

function updateScrollArrows(wrapper) {
    var track = wrapper.querySelector('.scroll-track');
    var leftBtn = wrapper.querySelector('.scroll-left');
    var rightBtn = wrapper.querySelector('.scroll-right');
    if (!track || !leftBtn || !rightBtn) return;
    var overflow = track.scrollWidth > track.clientWidth;
    leftBtn.classList.toggle('visible', overflow && track.scrollLeft > 5);
    rightBtn.classList.toggle('visible', overflow && track.scrollLeft < track.scrollWidth - track.clientWidth - 5);
}

function initScrollTracks() {
    document.querySelectorAll('.scroll-wrapper').forEach(function (w) {
        var track = w.querySelector('.scroll-track');
        if (!track) return;
        track.addEventListener('scroll', function () { updateScrollArrows(w); });
        /* observe for dynamic content changes */
        var obs = new MutationObserver(function () { updateScrollArrows(w); });
        obs.observe(track, { childList: true, subtree: true });
        setTimeout(function () { updateScrollArrows(w); }, 200);
    });
}

function changeSlide(delta) {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.slider-dot');
    if (!slides.length) return;
    const total = slides.length;
    slideIndex = (slideIndex + delta + total) % total;
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    slides[slideIndex].classList.add('active');
    dots[slideIndex].classList.add('active');
}

function goToSlide(n) {
    const slides = document.querySelectorAll('.slide');
    const dots = document.querySelectorAll('.slider-dot');
    if (!slides.length) return;
    slideIndex = n;
    slides.forEach(s => s.classList.remove('active'));
    dots.forEach(d => d.classList.remove('active'));
    slides[slideIndex].classList.add('active');
    dots[slideIndex].classList.add('active');
}

function toggleNav() {
    const nav = document.getElementById('nav-menu');
    const hamburger = document.getElementById('hamburger-btn');
    const navRow = document.querySelector('.header-nav-row');
    const isOpen = navRow && navRow.classList.contains('nav-open');

    if (nav) nav.classList.toggle('active');
    if (hamburger) hamburger.classList.toggle('active');
    if (navRow) navRow.classList.toggle('nav-open');

    let overlay = document.getElementById('mobile-nav-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'mobile-nav-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:999;opacity:0;transition:opacity 0.3s ease;pointer-events:none;';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', toggleNav);
    }

    if (!isOpen) {
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
        document.body.style.overflow = 'hidden';
    } else {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        document.body.style.overflow = '';
    }
}

function openTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tab = document.getElementById(tabName);
    if (tab) tab.classList.add('active');
    const btn = document.querySelector(`.tab-btn[onclick*="${tabName}"]`);
    if (btn) btn.classList.add('active');
}

function updateResultsCount(count) {
    const el = document.getElementById('results-count');
    if (el) {
        el.textContent = count + ' ' + (count !== 1 ? i18n.t('collection.produitsPlural') : i18n.t('collection.produits'));
    }
}

function proceedToCheckout() {
    toggleCart();
    window.location.href = 'checkout.html';
}

/* ── Checkout ── */

var algerianWilayas = [
    { id: 1, name: 'Adrar' }, { id: 2, name: 'Chlef' }, { id: 3, name: 'Laghouat' },
    { id: 4, name: 'Oum El Bouaghi' }, { id: 5, name: 'Batna' }, { id: 6, name: 'Béjaïa' },
    { id: 7, name: 'Biskra' }, { id: 8, name: 'Béchar' }, { id: 9, name: 'Blida' },
    { id: 10, name: 'Bouira' }, { id: 11, name: 'Tamanrasset' }, { id: 12, name: 'Tébessa' },
    { id: 13, name: 'Tlemcen' }, { id: 14, name: 'Tiaret' }, { id: 15, name: 'Tizi Ouzou' },
    { id: 16, name: 'Alger' }, { id: 17, name: 'Djelfa' }, { id: 18, name: 'Jijel' },
    { id: 19, name: 'Sétif' }, { id: 20, name: 'Saïda' }, { id: 21, name: 'Skikda' },
    { id: 22, name: 'Sidi Bel Abbès' }, { id: 23, name: 'Annaba' }, { id: 24, name: 'Guelma' },
    { id: 25, name: 'Constantine' }, { id: 26, name: 'Médéa' }, { id: 27, name: 'Mostaganem' },
    { id: 28, name: "M'Sila" }, { id: 29, name: 'Mascara' }, { id: 30, name: 'Ouargla' },
    { id: 31, name: 'Oran' }, { id: 32, name: 'El Bayadh' }, { id: 33, name: 'Illizi' },
    { id: 34, name: 'Bordj Bou Arreridj' }, { id: 35, name: 'Boumerdès' }, { id: 36, name: 'El Tarf' },
    { id: 37, name: 'Tindouf' }, { id: 38, name: 'Tissemsilt' }, { id: 39, name: 'El Oued' },
    { id: 40, name: 'Khenchela' }, { id: 41, name: 'Souk Ahras' }, { id: 42, name: 'Tipaza' },
    { id: 43, name: 'Mila' }, { id: 44, name: 'Aïn Defla' }, { id: 45, name: 'Naâma' },
    { id: 46, name: 'Aïn Témouchent' }, { id: 47, name: 'Ghardaïa' }, { id: 48, name: 'Relizane' },
    { id: 49, name: 'Timimoun' }, { id: 50, name: 'Bordj Badji Mokhtar' },
    { id: 51, name: 'Ouled Djellal' }, { id: 52, name: 'Béni Abbès' },
    { id: 53, name: 'In Salah' }, { id: 54, name: 'In Guezzam' },
    { id: 55, name: 'Touggourt' }, { id: 56, name: 'Djanet' },
    { id: 57, name: "El M'Ghair" }, { id: 58, name: 'El Meniaa' }
];

/* Sample municipalities per wilaya — extended for production */
var algerianMunicipalities = {
    1:  ['Adrar', 'Reggane', 'Timoktene', 'Tsabit', 'Zaouiet Kounta', 'Fenoughil'],
    2:  ['Chlef', 'Tenes', 'Ain Merane', 'Ouled Fares', 'Boukadir', 'Chettia', 'Sobha', 'Beni Rached'],
    3:  ['Laghouat', 'Aflou', 'Ksar El Boukhari', 'Brida', 'Sidi Makhlouf'],
    4:  ['Oum El Bouaghi', 'Ain Beida', 'Ain M\'lila', 'Ksar Sbahi', 'Fkirina'],
    5:  ['Batna', 'N\'Gaous', 'Merouana', 'Barika', 'Arris', 'Tazoult', 'Ain Touta', 'Bouzina'],
    6:  ['Béjaïa', 'Akbou', 'Amizour', 'Kherrata', 'Sidi Aich', 'Adekar', 'Tichy', 'Oued Ghir'],
    7:  ['Biskra', 'El Kantara', 'Tolga', 'Ourlal', 'Sidi Okba', 'Foughala'],
    8:  ['Béchar', 'Kenadsa', 'Taghit', 'Beni Ounif', 'Abadla'],
    9:  ['Blida', 'Boufarik', 'El Affroun', 'Mouzaia', 'Meftah', 'Oued Alleug', 'Chebli', 'Bouinan'],
    10: ['Bouira', 'Lakhdaria', 'M\'Chedallah', 'Sour El Ghozlane', 'Kadiria', 'Bechloul'],
    11: ['Tamanrasset', 'Abalessa', 'In Amguel', 'Tazrouk'],
    12: ['Tébessa', 'Cheria', 'El Aouinet', 'El Haria', 'Ouenza', 'Bir Mokkadem'],
    13: ['Tlemcen', 'Maghnia', 'Ghazaouet', 'Remchi', 'Sebdou', 'Mansourah', 'Chetouane'],
    14: ['Tiaret', 'Sougueur', 'Frenda', 'Mahdia', 'Dahmouni', 'Oued Lili'],
    15: ['Tizi Ouzou', 'Azazga', 'Boghni', 'Larbaa Nath Irathen', 'Draa El Mizan', 'Beni Yenni', "M'kira"],
    16: ['Alger Centre', 'Bab El Oued', 'Kouba', 'El Harrach', 'Birkhadem', 'Dar El Beida',
        'Cheraga', 'Hussein Dey', 'Hydra', 'Ben Aknoun', 'Bologhine', 'Oued Koriche',
        'Staoueli', 'Zeralda', 'Rouiba', 'Reghaia', 'Baraki', 'Sidi M\'Hamed'],
    17: ['Djelfa', 'Ain Oussera', 'Messaad', 'El Idrissia', 'Hassi Bahbah', 'Ain El Ibel'],
    18: ['Jijel', 'El Milia', 'Taher', 'Chekfa', 'Sidi Abdelaziz', 'Emir Abdelkader'],
    19: ['Sétif', 'El Eulma', 'Ain Oulmene', 'Bougaa', 'Salah Bey', 'Ain Azel', 'Guidjel'],
    20: ['Saïda', 'Ouled Brahim', 'Youb', 'Ain El Hadjar', 'Sidi Boubekeur'],
    21: ['Skikda', 'El Harrouch', 'Azzaba', 'Tamalous', 'Collo', 'Beni Zid'],
    22: ['Sidi Bel Abbès', 'Sidi Lahcene', 'Telagh', 'Tenira', 'Merine', 'Oued Sefioun'],
    23: ['Annaba', 'El Bouni', 'El Hadjar', 'Seraidi', 'Berrahal', 'Chetaibi'],
    24: ['Guelma', 'Oued Zenati', 'Bouchegouf', 'Hammam Debagh', 'Guelaat Bou Sbaa'],
    25: ['Constantine', 'El Khroub', 'Ain Abid', 'Hamma Bouziane', 'Zighoud Youcef', 'Didouche Mourad'],
    26: ['Médéa', 'Berrouaghia', 'Ksar El Boukhari', 'Tablat', 'Souaghi', 'Ouzera', 'Beni Slimane'],
    27: ['Mostaganem', 'Ain Tedles', 'Sidi Ali', 'Hassi Mameche', 'Nekmaria', 'Ouled Malah'],
    28: ['Bordj Bou Arreridj', 'Ras El Oued', 'Bordj Ghedir', 'Ain Taghrout', 'El Achir', 'El Main'],
    29: ['Mascara', 'Sig', 'Mohammedia', 'Oued El Abtal', 'Ghriss', 'Bou Hanifia'],
    30: ['Ouargla', 'Hassi Messaoud', 'Rouissat', 'El Borma', 'N\'Goussa'],
    31: ['Oran', 'Es Senia', 'Bir El Djir', 'Arzew', 'Boutlelis', 'Oued Tlélat', 'Gdyel', 'Misserghin'],
    32: ['El Bayadh', 'Brezina', 'Bougtob', 'Chellala', 'El Abiodh Sidi Cheikh'],
    33: ['Illizi', 'Djanet (Illizi)', 'Debdeb', 'Bordj Omar Driss'],
    34: ['Bordj Bou Arreridj', 'Ras El Oued', 'Bordj Zemoura', 'El Ach', 'Djaafra'],
    35: ['Boumerdès', 'Boudouaou', 'Dellys', 'Thenia', 'Bordj Menaiel', 'Khemis El Khechna', 'Ouled Moussa', 'Corso'],
    36: ['El Tarf', 'Besbes', 'Drean', 'Ben Mehidi', 'El Kala', 'Bouteldja'],
    37: ['Tindouf', 'Oum El Assel'],
    38: ['Tissemsilt', 'Bordj Emir Khaled', 'Lardjem', 'Theniet El Had', 'Sidi Slimane'],
    39: ['El Oued', 'Guemar', 'Debila', 'Robbah', 'Bayadha', 'Douar El Ma', 'El Mghair'],
    40: ['Khenchela', 'Kaïs', 'Ain Touila', 'El Hamma', 'Chechar', 'Ouled Rechache'],
    41: ['Souk Ahras', 'Sedrata', 'Mechroha', 'Limouna', 'Ouled Driss', 'Tiffech'],
    42: ['Tipaza', 'Cherchell', 'Hadera', 'Bou Ismail', 'Sidi Amar', 'Gouraya', 'Nador', 'Fouka', 'Kolea'],
    43: ['Mila', 'Ferdjioua', 'Chelghoum Laid', 'Tadjenanet', 'Grarem Gouga', 'Telerghma'],
    44: ['Aïn Defla', 'Khemis Miliana', 'El Abadia', 'Rouina', 'Miliana', 'Boumedfaa'],
    45: ['Naâma', 'Mecheria', 'Ain Sefra', 'Moghrar', 'Asla', 'Djeniene Bou Rezg'],
    46: ['Aïn Témouchent', 'Beni Saf', 'El Amria', 'Hammam Bou Hadjar', 'Oulhaça El Gheraba'],
    47: ['Ghardaïa', 'Ghardaïa', 'El Meniaa', 'Dhayet Ben Dhahoua', 'Mansoura', 'Béni Isguen'],
    48: ['Relizane', 'Oued Rhiou', 'Mazouna', 'Sidi M\'Hamed Benaouda', 'Jdiouia', 'Mendes', 'Zemmoura'],
    49: ['Timimoun', 'Timimoun', 'Ouled Said', 'Charouine'],
    50: ['Bordj Badji Mokhtar', 'Bordj Badji Mokhtar', 'Timiaouine'],
    51: ['Ouled Djellal', 'Ouled Djellal', 'Sidi Khaled', 'Besbes', 'Doucen', 'Lichana'],
    52: ['Béni Abbès', 'Béni Abbès', 'Tamtert', 'Kerzaz', 'El Ouata'],
    53: ['In Salah', 'In Salah', 'Foggaret Ezzoua', 'Ain Salah'],
    54: ['In Guezzam', 'In Guezzam', 'Tin Zouatine'],
    55: ['Touggourt', 'Touggourt', 'Témacine', 'El Alia', 'Sidi Slimane', 'MNaguer', 'Tamacine', 'Benaceur'],
    56: ['Djanet', 'Djanet', 'Bordj El Haouas'],
    57: ['El M\'Ghair', 'El M\'Ghair', 'Djamaa', 'Sidi Amrane', 'M\'Rara', 'Tendla'],
    58: ['El Meniaa', 'El Meniaa', 'Hassi Fehal', 'Bel Bahri', 'Hassi Gara']
};

/* Delivery prices — cached from API */
var _deliveryPrices = {};

function loadDeliveryPrices() {
    fetch('/api/public/delivery-prices').then(function(r) { return r.json(); }).then(function(data) {
        if (data) _deliveryPrices = data;
    }).catch(function() { _deliveryPrices = {}; });
}

function getDeliveryPrice(wilayaId) {
    if (!wilayaId) return 0;
    var price = _deliveryPrices[String(wilayaId)];
    return price !== undefined ? Number(price) : 0;
}

function renderCheckout() {
    var wilayaSel = document.getElementById('co-wilaya');
    if (wilayaSel) {
        var selectWilaya = (i18n.getLang() === 'ar') ? 'اختر ولاية' : i18n.t('checkout.selectWilaya');
        wilayaSel.innerHTML = '<option value="">' + selectWilaya + '</option>' +
            algerianWilayas.map(function (w) {
                return '<option value="' + w.id + '">' + w.name + '</option>';
            }).join('');
        wilayaSel.onchange = function () {
            updateMunicipalities(parseInt(this.value));
            updateCheckoutSummary();
            updateSelectFloat(this);
            if (window.__deliveryTimes) {
                var selText = this.options[this.selectedIndex].text;
                var selVal = this.value;
                var dt = window.__deliveryTimes[selText] || null;
                if (!dt) {
                    var dtKeys = Object.keys(window.__deliveryTimes);
                    for (var di = 0; di < dtKeys.length; di++) {
                        var dk = window.__deliveryTimes[dtKeys[di]];
                        if (dk && String(dk.wilaya_id) === String(selVal)) { dt = dk; break; }
                    }
                }
                var el = document.getElementById('delivery-estimate');
                var txt = document.getElementById('delivery-estimate-text');
                if (dt && el && txt) {
                    el.style.display = 'block';
                    var estLabel = (i18n.getLang() === 'ar') ? 'التسليم المتوقع' : i18n.t('checkout.estimatedDelivery');
                    var daysLabel = (i18n.getLang() === 'ar') ? 'أيام' : i18n.t('checkout.days');
                    txt.textContent = estLabel + ': ' + dt.min_days + '-' + dt.max_days + ' ' + daysLabel;
                } else if (el) {
                    el.style.display = 'none';
                }
            }
        };
        /* init floating label state on page load */
        updateSelectFloat(wilayaSel);
    }

    var muniSel = document.getElementById('co-municipality');
    if (muniSel) updateSelectFloat(muniSel);

    var deliveryModeSel = document.getElementById('co-delivery-mode');
    if (deliveryModeSel) {
        updateSelectFloat(deliveryModeSel);
        deliveryModeSel.onchange = function() { updateSelectFloat(this); };
    }

    /* floating label toggle for all text inputs */
    document.querySelectorAll('.floating-input:not(select)').forEach(function(inp) {
        inp.addEventListener('blur', function() { updateTextFloat(this); });
        inp.addEventListener('input', function() { updateTextFloat(this); });
        updateTextFloat(inp);
    });

    /* phone validation */
    var phoneInput = document.getElementById('co-phone');
    if (phoneInput) {
        phoneInput.addEventListener('blur', function() {
            validatePhone(this);
        });
        phoneInput.addEventListener('input', function() {
            var err = document.getElementById('co-phone-error');
            if (err) err.textContent = '';
            this.classList.remove('error');
        });
    }

    /* load delivery prices */
    loadDeliveryPrices();

    fetch('/api/public/delivery-times').then(function(r){return r.json()}).then(function(times){
        window.__deliveryTimes = times;
    });

    /* populate order summary */
    updateCheckoutSummary();
}

function updateTextFloat(inp) {
    if (!inp) return;
    if (inp.value.trim()) {
        inp.setAttribute('placeholder', ' ');
    } else {
        inp.removeAttribute('placeholder');
    }
}

function updateSelectFloat(sel) {
    if (!sel) return;
    if (sel.value) {
        sel.setAttribute('placeholder', ' ');
    } else {
        sel.removeAttribute('placeholder');
    }
}

function validatePhone(inp) {
    if (!inp) return false;
    var err = document.getElementById('co-phone-error');
    var val = inp.value.trim();
    if (!val) {
        if (err) err.textContent = i18n.t('checkout.phoneRequired');
        inp.classList.add('error');
        return false;
    }
    var cleaned = val.replace(/[\s\-\.\/]/g, '');
    if (cleaned.startsWith('+213')) cleaned = cleaned.substring(4);
    else if (cleaned.startsWith('213')) cleaned = cleaned.substring(3);
    if (!/^[0-9]{9,10}$/.test(cleaned)) {
        if (err) err.textContent = i18n.t('checkout.phoneInvalid');
        inp.classList.add('error');
        return false;
    }
    inp.classList.remove('error');
    if (err) err.textContent = '';
    return true;
}

function updateMunicipalities(wilayaId) {
    var muniSel = document.getElementById('co-municipality');
    if (!muniSel) return;
    var communes = algerianMunicipalities[wilayaId];
    if (communes && communes.length > 0) {
        var selectCommune = (i18n.getLang() === 'ar') ? 'اختر ولاية أولاً' : i18n.t('checkout.selectCommune');
        muniSel.innerHTML = '<option value="">' + selectCommune + '</option>' +
            communes.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
        muniSel.disabled = false;
        updateSelectFloat(muniSel);
    } else {
        var noCommune = (i18n.getLang() === 'ar') ? 'لا توجد بلدية' : i18n.t('checkout.noCommune');
        muniSel.innerHTML = '<option value="">' + noCommune + '</option>';
        muniSel.disabled = true;
        updateSelectFloat(muniSel);
    }
}

function formatPhoneInput(input) {
    var val = input.value.replace(/\D/g, '');
    if (val.length > 10) val = val.substring(0, 10);
    var formatted = val;
    if (val.length > 2) formatted = val.substring(0, 2) + ' ' + val.substring(2);
    if (val.length > 5) formatted = val.substring(0, 2) + ' ' + val.substring(2, 5) + ' ' + val.substring(5);
    input.value = formatted;
}

function updateCheckoutSummary() {
    var subtotalEl = document.getElementById('co-subtotal');
    var deliveryEl = document.getElementById('co-delivery');
    var totalEl = document.getElementById('co-total');
    var itemsEl = document.getElementById('checkout-items');
    if (!subtotalEl || !deliveryEl || !totalEl || !itemsEl) return;

    if (!cart || cart.length === 0) {
        var emptyCartMsg = (i18n.getLang() === 'ar') ? 'سلتك فارغة' : i18n.t('checkout.emptyCart');
        itemsEl.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:1rem 0">' + emptyCartMsg + '</p>';
        subtotalEl.textContent = '0 DA';
        deliveryEl.textContent = '0 DA';
        totalEl.textContent = '0 DA';
        return;
    }

    var subtotal = 0;
    itemsEl.innerHTML = cart.map(function (item, idx) {
        var itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        var meta = [];
        var sizeLabel = (i18n.getLang() === 'ar') ? 'الحجم' : i18n.t('qv.size');
        var qtyLabel = (i18n.getLang() === 'ar') ? 'الكمية: ' : i18n.t('checkout.qty');
        var editLabel = (i18n.getLang() === 'ar') ? 'تعديل' : i18n.t('cart.modifier');
        var removeLabel = (i18n.getLang() === 'ar') ? 'إزالة' : i18n.t('checkout.remove');
        if (item.selectedSize) meta.push(sizeLabel + ': ' + item.selectedSize);
        if (item.selectedColor) meta.push(item.selectedColor);
        var cartKey = item.id + '-' + (item.selectedSize || '') + '-' + (item.selectedColor || '');
        return '<div class="checkout-item-row">' +
            '<div class="checkout-item-info">' +
                '<div class="checkout-item-name">' + esc(item.name) + '</div>' +
                (meta.length > 0 ? '<div class="checkout-item-meta">' + meta.join(' | ') + '</div>' : '') +
                '<div class="checkout-item-qty">' + qtyLabel + item.quantity + ' \u00d7 ' + formatPriceDA(item.price) + '</div>' +
            '</div>' +
            '<div class="checkout-item-actions">' +
                '<button class="modifier-btn" onclick="quickViewForCart(\'' + cartKey + '\')">' + editLabel + '</button>' +
                '<button class="remove-btn" onclick="removeFromCartByKey(\'' + cartKey + '\'); updateCheckoutSummary(); renderCartPage();">' + removeLabel + '</button>' +
            '</div>' +
            '<div class="checkout-item-total">' + formatPriceDA(itemTotal) + '</div>' +
        '</div>';
    }).join('');

    /* Look up delivery price for selected wilaya */
    var wilayaSel = document.getElementById('co-wilaya');
    var wilayaId = wilayaSel ? parseInt(wilayaSel.value) : 0;
    var delivery = getDeliveryPrice(wilayaId);
    var total = subtotal + delivery;

    /* Show delivery line with wilaya name */
    var wilayaName = '';
    if (wilayaId && algerianWilayas) {
        var found = algerianWilayas.find(function(w) { return w.id === wilayaId; });
        if (found) wilayaName = found.name;
    }
    var dlText = (i18n.getLang() === 'ar') ? 'التوصيل' : i18n.t('checkout.deliveryLabel');
    var freeText = (i18n.getLang() === 'ar') ? 'مجاني' : i18n.t('checkout.free');
    var deliveryLabel = wilayaName ? dlText + ' \u2014 ' + wilayaName : dlText;
    var deliveryLine = deliveryEl.parentNode;
    var labelSpan = deliveryLine.querySelector('span:first-child');
    if (labelSpan) labelSpan.textContent = deliveryLabel;

    subtotalEl.textContent = formatPriceDA(subtotal);
    deliveryEl.textContent = delivery > 0 ? formatPriceDA(delivery) : freeText;
    totalEl.textContent = formatPriceDA(total);
}

function placeOrder(e) {
    if (e) e.preventDefault();
    try {
    var name = document.getElementById('co-full-name').value.trim();
    var phone = document.getElementById('co-phone').value.trim();
    var wilayaSel = document.getElementById('co-wilaya');
    var wilaya = wilayaSel.options[wilayaSel.selectedIndex] ? wilayaSel.options[wilayaSel.selectedIndex].text : '';
    var muniSel = document.getElementById('co-municipality');
    var municipality = muniSel.options[muniSel.selectedIndex] ? muniSel.options[muniSel.selectedIndex].text : '';
    var deliveryModeSel = document.getElementById('co-delivery-mode');
    var deliveryMode = deliveryModeSel ? deliveryModeSel.value : '';

    if (!name || !phone || !wilayaSel.value || !muniSel.value) {
        var fillReqMsg = (i18n.getLang() === 'ar') ? 'يرجى ملء جميع الحقول المطلوبة' : i18n.t('checkout.fillRequired');
        alert(fillReqMsg);
        return;
    }

    if (!deliveryMode) {
        var deliveryModeMsg = (i18n.getLang() === 'ar') ? 'يرجى اختيار طريقة التوصيل' : i18n.t('checkout.deliveryModeRequired');
        alert(deliveryModeMsg);
        return;
    }

    var phoneInput = document.getElementById('co-phone');
    if (!validatePhone(phoneInput)) {
        return;
    }

    if (cart.length === 0) {
        var emptyMsg = (i18n.getLang() === 'ar') ? 'سلتك فارغة' : i18n.t('checkout.emptyCart');
        alert(emptyMsg);
        return;
    }

    var orderItems = cart.map(function (item) {
        return { product_id: item.id, name: item.name, price: item.price, quantity: item.quantity, size: item.selectedSize || '', color: item.selectedColor || '' };
    });
    var wilayaId = parseInt(wilayaSel.value) || 0;
    var deliveryFee = getDeliveryPrice(wilayaId);
    var subtotal = cart.reduce(function (sum, item) { return sum + item.price * item.quantity; }, 0);
    var total = subtotal + deliveryFee;
    var shippingAddr = municipality + ', ' + wilaya;

    var orderNumber = 'CMD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    var deliveryModeLabel = deliveryMode === 'bureau' ? 'LIVRAISON AU BUREAU' : 'A DOMICILE';
    var payload = {
        items: orderItems,
        order_number: orderNumber,
        customer_name: name,
        customer_phone: phone,
        wilaya: wilaya,
        wilaya_id: wilayaId,
        commune: municipality,
        shipping: shippingAddr,
        delivery_mode: deliveryMode,
        payment_method: 'Cash on Delivery',
        total: total,
        delivery_fee: deliveryFee
    };

    fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(function (res) {
        if (!res.ok) return res.json().then(function (errData) { throw new Error(errData.error || i18n.t('checkout.serverError')); });
        return res.json();
    }).then(function (data) {
        var refNumber = data.order_number || orderNumber;
        document.getElementById('confirmation-order-number').textContent = '#' + refNumber;
        document.getElementById('conf-pb-subtotal').textContent = formatPriceDA(subtotal);
        document.getElementById('conf-pb-delivery-label').textContent = i18n.t('checkout.deliveryLabel') + (wilaya ? ' \u2014 ' + wilaya : '');
        document.getElementById('conf-pb-delivery').textContent = deliveryFee > 0 ? formatPriceDA(deliveryFee) : i18n.t('checkout.free');
        var deliveryModeText = deliveryMode === 'bureau' ? 'التوصيل للمكتب 📦' : 'التوصيل للمنزل 🏠';
        document.getElementById('conf-pb-delivery-mode').textContent = deliveryModeText;
        document.getElementById('conf-pb-total').textContent = formatPriceDA(total);
        document.getElementById('confirmation-details').textContent = i18n.t('checkout.advisorWillCall') + phone + '.';
        document.getElementById('order-confirmation-modal').classList.add('active');
        cart = [];
        localStorage.setItem('adalinaCart', JSON.stringify(cart));
        updateCartDisplay();
        updateCartCounter();
        updateCheckoutSummary();
    }).catch(function (err) {
        console.error('Order error:', err);
        alert(err.message || i18n.t('checkout.orderError'));
    });
    } catch (domErr) {
        console.error('Order error:', domErr);
        alert(i18n.t('checkout.generalError'));
    }
}

/* ── Product Page ── */

let productPageState = {
    productId: null,
    selectedColor: null,
    selectedSize: null,
    quantity: 1
};

function loadProductPage() {
    const container = document.getElementById('product-container');
    if (!container) return;

    const urlParams = new URLSearchParams(window.location.search);
    const productId = parseInt(urlParams.get('id'));
    if (!productId) {
        container.innerHTML = '<div class="breadcrumb"><a href="index.html">' + i18n.t('breadcrumb.home') + '</a><span>/</span><a href="shop.html">' + i18n.t('breadcrumb.shop') + '</a></div><div style="text-align:center;padding:4rem 0"><h2>' + i18n.t('product.notFound') + '</h2><p style="color:var(--text-light);margin:1rem 0">' + i18n.t('product.notFoundDesc') + '</p><a href="shop.html" class="btn btn-primary" style="display:inline-block;text-decoration:none">' + i18n.t('product.backToShop') + '</a></div>';
        return;
    }

    const product = products.find(p => p.id === productId);
    if (!product) {
        container.innerHTML = '<div class="breadcrumb"><a href="index.html">' + i18n.t('breadcrumb.home') + '</a><span>/</span><a href="shop.html">' + i18n.t('breadcrumb.shop') + '</a></div><div style="text-align:center;padding:4rem 0"><h2>' + i18n.t('product.notFound') + '</h2><p style="color:var(--text-light);margin:1rem 0">' + i18n.t('product.notFoundDesc') + '</p><a href="shop.html" class="btn btn-primary" style="display:inline-block;text-decoration:none">' + i18n.t('product.backToShop') + '</a></div>';
        return;
    }

    var variants = product.variants || [];
    var firstAvailColor = null;
    var firstAvailSize = null;
    if (variants.length > 0) {
        var availColors = product.colors.filter(function(c) {
            var cname = typeof c === 'object' ? c.name : c;
            return variants.some(function(v) {
                if (v.sizes && Array.isArray(v.sizes)) return v.color_name === cname && v.sizes.some(function(sz) { return sz.stock > 0; });
                return v.color_name === cname && v.stock > 0;
            });
        });
        var availSizes = product.sizes.filter(function(s) {
            var sname = typeof s === 'object' ? s.size : s;
            return variants.some(function(v) {
                if (v.sizes && Array.isArray(v.sizes)) return v.sizes.some(function(sz) { return sz.size === sname && sz.stock > 0; });
                return v.size_name === sname && v.stock > 0;
            });
        });
        firstAvailColor = availColors.length > 0 ? (typeof availColors[0] === 'object' ? availColors[0].name : availColors[0]) : null;
        firstAvailSize = availSizes.length > 0 ? (typeof availSizes[0] === 'object' ? availSizes[0].size : availSizes[0]) : null;
    }

    var preselectedColor = urlParams.get('color') || null;
    var preselectedSize = urlParams.get('size') || null;

    productPageState = {
        productId: product.id,
        selectedColor: preselectedColor || firstAvailColor || (product.colors && product.colors.length > 0 ? (typeof product.colors[0] === 'object' ? product.colors[0].name : product.colors[0]) : null),
        selectedSize: preselectedSize || firstAvailSize || (product.sizes && product.sizes.length > 0 ? (typeof product.sizes[0] === 'object' ? product.sizes[0].size : product.sizes[0]) : null),
        quantity: 1
    };

    displayProduct(product);
}

function getVariantStock(product, color, size) {
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) {
        var v = variants[i];
        if (v.color_name !== color) continue;
        if (v.sizes && Array.isArray(v.sizes)) {
            for (var j = 0; j < v.sizes.length; j++) {
                if (v.sizes[j].size === size) return v.sizes[j].stock;
            }
        }
        if (v.size_name === size) return v.stock;
    }
    return product.stock || 0;
}

function stockLabel(stock) {
    if (stock > 5) return '<span class="stock-badge in-stock">' + i18n.t('qv.inStock') + '</span>';
    if (stock > 0) return '<span class="stock-badge low-stock">' + i18n.t('stock.low').replace('{n}', stock) + '</span>';
    return '<span class="stock-badge out-of-stock">' + i18n.t('stock.out') + '</span>';
}

function displayProduct(product) {
    var container = document.getElementById('product-container');
    if (!container) return;

    var isInWishlist = wishlist.indexOf(product.id) !== -1;
    var images = product.images && product.images.length > 0 ? product.images : [PLACEHOLDER_IMG];
    var variants = product.variants || [];
    var hasVariants = variants.length > 0;
    // Determine available colors and sizes based on variant stock
    var availColors = hasVariants ? product.colors.filter(function(c) {
        var cname = typeof c === 'object' ? c.name : c;
        return variants.some(function(v) {
            if (v.sizes && Array.isArray(v.sizes)) return v.color_name === cname && v.sizes.some(function(sz) { return sz.stock > 0; });
            return v.color_name === cname && v.stock > 0;
        });
    }) : (product.colors || []);

    var availSizes = hasVariants ? product.sizes.filter(function(s) {
        var sname = typeof s === 'object' ? s.size : s;
        return variants.some(function(v) {
            if (v.sizes && Array.isArray(v.sizes)) return v.sizes.some(function(sz) { return sz.size === sname && sz.stock > 0; });
            return v.size_name === sname && v.stock > 0;
        });
    }) : (product.sizes || []);

    // Calculate stock for selected combination
    var curColor = productPageState.selectedColor;
    var curSize = productPageState.selectedSize;
    var curStock = (curColor && curSize && hasVariants) ? getVariantStock(product, curColor, curSize) : product.stock;

    container.innerHTML = `
        <div class="pp-layout">
            <div class="pp-info">
                <h1 class="pp-name">${esc(product.name)}</h1>

                <div class="pp-price">
                    ${product.sale_price
                        ? '<span class="original-price">' + formatPriceDA(product.price) + '</span> <span class="sale-price">' + formatPriceDA(product.sale_price) + '</span>'
                        : formatPriceDA(product.price)}
                </div>

                <p class="pp-desc">${esc(product.description || '')}</p>

                ${availColors.length > 0 ? '<div class="pp-section"><label>' + i18n.t('qv.color') + '</label><div class="pp-colors">' + availColors.map(function (c) {
                    var cname = typeof c === 'object' ? c.name : c;
                    var hex = typeof c === 'object' ? (c.hex || colorToHex[cname] || '#ccc') : (colorToHex[c] || '#ccc');
                    var sel = cname === curColor ? ' selected' : '';
                    var out = '';
                    if (hasVariants && curSize) {
                        var vstock = getVariantStock(product, cname, curSize);
                        if (vstock === 0) out = ' out-of-stock';
                    }
                    return '<button class="pp-color-swatch' + sel + out + '" style="background:' + hex + '" onclick="selectProductColor(\'' + cname.replace(/'/g, "\\'") + '\', this)" title="' + cname + '"></button>';
                }).join('') + '</div></div>' : ''}

                ${availSizes.length > 0 ? '<div class="pp-section"><label>' + i18n.t('qv.size') + '</label><div class="pp-sizes">' + buildGroupedSizesHtml(
                    availSizes, product, curColor, curSize, hasVariants,
                    'pp-size-btn', 'pp-size-wrap',
                    'onclick="selectProductSize(\'{val}\', this)"',
                    product.category_size_system
                ) + '</div></div>' : ''}

                <div class="pp-section pp-stock-info" id="pp-stock-info">
                    ${curColor && curSize && hasVariants ? stockLabel(curStock) + ' <span class="stock-qty">' + i18n.t('qv.disponible').replace('{n}', curStock) + '</span>' : (product.stock > 0 ? '<span class="stock-badge in-stock">' + i18n.t('qv.inStock') + '</span>' : '<span class="stock-badge out-of-stock">' + i18n.t('stock.out') + '</span>')}
                </div>

                <div class="pp-section">
                    <label>${i18n.t('qv.quantity')}</label>
                    <div class="pp-qty">
                        <button class="pp-qty-btn" onclick="changeProductQty(-1)">−</button>
                        <input type="text" id="product-qty-input" value="1" readonly>
                        <button class="pp-qty-btn" onclick="changeProductQty(1)">+</button>
                    </div>
                </div>

                <button class="pp-btn pp-btn-primary" onclick="addCurrentToCart()" id="pp-add-to-cart-btn">${i18n.t('qv.addToCart')}</button>
                <button class="pp-btn pp-btn-dark" onclick="ppBuyNow()">${i18n.t('product.buyNow')}</button>

                <button class="pp-btn pp-btn-outline" onclick="addCurrentToWishlist()"><svg width="18" height="18" viewBox="0 0 24 24" fill="${isInWishlist ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><span id="pp-wishlist-text">${isInWishlist ? i18n.t('product.wishlistIn') : i18n.t('qv.wishlist')}</span></button>

                <a href="shop.html" class="pp-continue">${i18n.t('qv.continueShopping')}</a>
            </div>

            <div class="pp-gallery">
                <div class="pp-main-wrap">
                    ${productRibbonHtml(product)}
                    <img id="main-product-image" src="${cloudinaryThumb(images[0], 800)}" alt="${esc(product.name)}" decoding="async" width="800" height="1066" onerror="onImgError(this)">
                    ${images.length > 1 ? '<button class="pp-nav pp-nav-prev" onclick="ppPrevImage()">&#10094;</button><button class="pp-nav pp-nav-next" onclick="ppNextImage()">&#10095;</button>' : ''}
                </div>
                ${images.length > 1 ? '<div class="pp-thumbs" id="pp-thumbs">' + images.map(function (img, i) {
                    return '<div class="pp-thumb' + (i === 0 ? ' active' : '') + '" onclick="switchProductImage(\'' + img + '\', this)"><img src="' + cloudinaryThumb(img, 120) + '" data-raw="' + img + '" alt="" loading="lazy" decoding="async" width="120" height="160" onerror="onImgError(this)"></div>';
                }).join('') + '</div>' : ''}
            </div>
        </div>

        <div class="related-products" id="related-products">
            <h2 class="related-title">${i18n.t('product.relatedTitle')}</h2>
            <div class="products-grid" id="related-products-grid"></div>
        </div>
    `;

    document.title = product.name + ' - ADALINA';
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', product.name + ' - ADALINA. ' + (product.description || '').substring(0, 100));

    renderRelatedProducts(product);

    var ppPrev = document.querySelector('.pp-nav-prev');
    var ppNext = document.querySelector('.pp-nav-next');
    if (ppPrev) ppPrev.classList.add('hidden');
    if (ppNext) {
        var total = document.querySelectorAll('#pp-thumbs .pp-thumb').length;
        ppNext.classList.toggle('hidden', total <= 1);
    }
    startPPSlideshow();

    var gallery = document.querySelector('.pp-main-wrap');
    if (gallery && 'ontouchstart' in window) {
        var touchStartX = 0;
        gallery.addEventListener('touchstart', function(e) { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
        gallery.addEventListener('touchend', function(e) {
            var diff = touchStartX - e.changedTouches[0].screenX;
            if (Math.abs(diff) > 40) {
                if (diff > 0) ppNextImage();
                else ppPrevImage();
            }
        }, {passive: true});
    }
}

function switchProductImage(src, el) {
    stopPPSlideshow();
    var mainImg = document.getElementById('main-product-image');
    if (mainImg) { mainImg.src = cloudinaryThumb(src, 800); mainImg.onerror = function() { onImgError(this); }; }
    document.querySelectorAll('.product-thumbnail, .pp-thumb').forEach(function (t) { t.classList.remove('active'); });
    if (el) el.classList.add('active');
    var thumbs = document.querySelectorAll('#pp-thumbs .pp-thumb');
    var activeIdx = -1;
    thumbs.forEach(function (t, i) { if (t.classList.contains('active')) activeIdx = i; });
    if (activeIdx >= 0) updatePPNavArrows(activeIdx, thumbs.length);
}

function getCurrentProductImages() {
    var product = products.find(function(p) { return p.id === productPageState.productId; });
    if (!product) return [];
    var color = productPageState.selectedColor;
    if (color) {
        var variants = product.variants || [];
        var variant = variants.find(function(v) { return v.color_name === color; });
        if (variant && variant.images && variant.images.length > 0) {
            return variant.images;
        }
    }
    return product.images && product.images.length > 0 ? product.images : [PLACEHOLDER_IMG];
}

function updateProductGallery(images) {
    stopPPSlideshow();
    if (!images || images.length === 0) return;
    var mainImg = document.getElementById('main-product-image');
    if (mainImg) mainImg.src = cloudinaryThumb(images[0], 800);

    var thumbs = document.getElementById('pp-thumbs');
    if (thumbs) {
        if (images.length > 1) {
            thumbs.innerHTML = images.map(function(img, i) {
                return '<div class="pp-thumb' + (i === 0 ? ' active' : '') + '" onclick="switchProductImage(\'' + img.replace(/'/g, "\\'") + '\', this)"><img src="' + img + '" alt="" onerror="onImgError(this)"></div>';
            }).join('');
            thumbs.style.display = '';
        } else {
            thumbs.innerHTML = '';
        }
    }

    var ppNavs = document.querySelectorAll('.pp-nav');
    ppNavs.forEach(function(nav) { nav.style.display = images.length > 1 ? '' : 'none'; });
    var ppPrev = document.querySelector('.pp-nav-prev');
    var ppNext = document.querySelector('.pp-nav-next');
    if (ppPrev) ppPrev.classList.add('hidden');
    if (ppNext) ppNext.classList.remove('hidden');
}

function selectProductColor(color, el) {
    productPageState.selectedColor = color;
    document.querySelectorAll('.color-swatch, .pp-color-swatch').forEach(function (s) { s.classList.remove('selected'); });
    if (el) el.classList.add('selected');
    var images = getCurrentProductImages();
    updateProductGallery(images);
    updateProductStockDisplay();
}

function selectProductSize(size, el) {
    productPageState.selectedSize = size;
    document.querySelectorAll('.size-btn, .pp-size-btn').forEach(function (b) { b.classList.remove('selected'); });
    if (el) el.classList.add('selected');
    var images = getCurrentProductImages();
    updateProductGallery(images);
    updateProductStockDisplay();
}

function updateProductStockDisplay() {
    var product = products.find(function(p) { return p.id === productPageState.productId; });
    if (!product) return;
    var variants = product.variants || [];
    var hasVariants = variants.length > 0;
    var curColor = productPageState.selectedColor;
    var curSize = productPageState.selectedSize;
    var curStock = (curColor && curSize && hasVariants) ? getVariantStock(product, curColor, curSize) : product.stock;

    // Update stock info text
    var info = document.getElementById('pp-stock-info');
    if (info) {
        info.innerHTML = curColor && curSize && hasVariants ? stockLabel(curStock) + ' <span class="stock-qty">' + curStock + ' disponible(s)</span>' : (product.stock > 0 ? '<span class="stock-badge in-stock">En stock</span>' : '<span class="stock-badge out-of-stock">Rupture de stock</span>');
    }

    // Update size labels based on selected color
    if (hasVariants && curColor) {
        document.querySelectorAll('.pp-sizes .pp-size-wrap').forEach(function(wrap) {
            var btn = wrap.querySelector('.pp-size-btn');
            if (!btn) return;
            var sname = btn.textContent.trim();
            var vstock = getVariantStock(product, curColor, sname);
            var labelEl = wrap.querySelector('.stock-badge');
            if (labelEl) labelEl.outerHTML = stockLabel(vstock);
            else wrap.insertAdjacentHTML('beforeend', stockLabel(vstock));
            wrap.classList.toggle('out-of-stock', vstock === 0);
            if (vstock === 0 && sname === curSize) {
                btn.classList.remove('selected');
                productPageState.selectedSize = null;
            }
        });
    }

    // Update color swatches based on selected size
    if (hasVariants && curSize) {
        document.querySelectorAll('.pp-colors .pp-color-swatch').forEach(function(sw) {
            var cname = sw.getAttribute('title');
            var vstock = getVariantStock(product, cname, curSize);
            sw.classList.toggle('out-of-stock', vstock === 0);
            if (vstock === 0 && cname === curColor) {
                sw.classList.remove('selected');
                productPageState.selectedColor = null;
            }
        });
    }

    // Disable add-to-cart if out of stock
    var addBtn = document.getElementById('pp-add-to-cart-btn');
    if (addBtn) {
        if (hasVariants && curColor && curSize && curStock === 0) {
            addBtn.disabled = true;
            addBtn.textContent = 'Rupture de stock';
        } else if (!hasVariants && product.stock === 0) {
            addBtn.disabled = true;
            addBtn.textContent = 'Rupture de stock';
        } else {
            addBtn.disabled = false;
            addBtn.textContent = 'Ajouter au panier';
        }
    }
}

function changeProductQty(delta) {
    const input = document.getElementById('product-qty-input');
    if (!input) return;
    let qty = parseInt(input.value) || 1;
    qty = Math.max(1, qty + delta);
    input.value = qty;
    productPageState.quantity = qty;
}

function setProductQty(value) {
    const input = document.getElementById('product-qty-input');
    if (!input) return;
    let qty = parseInt(value);
    if (isNaN(qty) || qty < 1) { qty = 1; input.value = 1; }
    productPageState.quantity = qty;
}

function addCurrentToCart() {
    const product = products.find(p => p.id === productPageState.productId);
    if (!product) return;

    if (product.sizes && product.sizes.length > 0 && !productPageState.selectedSize) {
        alert(i18n.t('product.validateSize'));
        return;
    }

    if (product.colors && product.colors.length > 0 && !productPageState.selectedColor) {
        alert(i18n.t('product.validateColor'));
        return;
    }

    // Check variant stock
    var variants = product.variants || [];
    if (variants.length > 0 && productPageState.selectedColor && productPageState.selectedSize) {
        var vstock = getVariantStock(product, productPageState.selectedColor, productPageState.selectedSize);
        if (vstock === 0) {
            alert('Ce produit est en rupture de stock pour la combinaison sélectionnée.');
            return;
        }
    } else if (product.stock === 0) {
        alert('Ce produit est en rupture de stock.');
        return;
    }

    var cartItem = {
        ...product,
        quantity: productPageState.quantity,
        selectedSize: productPageState.selectedSize || null,
        selectedColor: productPageState.selectedColor || null
    };

    // Check if same product with same size/color exists
    var existing = cart.find(function(item) {
        return item.id === product.id &&
               item.selectedSize === cartItem.selectedSize &&
               item.selectedColor === cartItem.selectedColor;
    });
    if (existing) {
        existing.quantity += productPageState.quantity;
    } else {
        cart.push(cartItem);
    }
    localStorage.setItem('adalinaCart', JSON.stringify(cart));
    updateCartDisplay();
    updateCartCounter();

    const sidebar = document.getElementById('cart-sidebar');
    if (sidebar && !sidebar.classList.contains('active')) {
        toggleCart();
    }

    productPageState.quantity = 1;
    const qtyInput = document.getElementById('product-qty-input');
    if (qtyInput) qtyInput.value = 1;
}

function addCurrentToWishlist() {
    const id = productPageState.productId;
    if (!id) return;

    const idx = wishlist.indexOf(id);
    if (idx === -1) {
        wishlist.push(id);
    } else {
        wishlist.splice(idx, 1);
    }
    localStorage.setItem('adalinaWishlist', JSON.stringify(wishlist));
    updateWishlistDisplay();
    updateWishlistCounter();

    var btn = document.querySelector('.pp-btn-outline');
    if (btn) {
        var inList = wishlist.indexOf(id) !== -1;
        var text = btn.querySelector('#pp-wishlist-text');
        if (text) text.textContent = inList ? 'Dans mes favoris' : 'Ajouter aux favoris';
        btn.querySelector('svg').setAttribute('fill', inList ? 'currentColor' : 'none');
    }
}

function ppBuyNow() {
    addCurrentToCart();
    window.location.href = 'checkout.html';
}



var ppSlideshowTimer = null;

function startPPSlideshow() {
    stopPPSlideshow();
    var thumbs = document.querySelectorAll('#pp-thumbs .pp-thumb');
    if (thumbs.length <= 1) return;
    ppSlideshowTimer = setInterval(function() {
        var img = document.getElementById('main-product-image');
        if (!img) return;
        var activeIdx = -1;
        thumbs.forEach(function (el, i) { if (el.classList.contains('active')) activeIdx = i; });
        var nextIdx = (activeIdx + 1) % thumbs.length;
        thumbs.forEach(function (el, i) { el.classList.toggle('active', i === nextIdx); });
        var thumbImg = thumbs[nextIdx].querySelector('img');
        if (thumbImg) img.src = cloudinaryThumb(thumbImg.getAttribute('data-raw') || thumbImg.src, 800);
        updatePPNavArrows(nextIdx, thumbs.length);
    }, 3000);
}

function stopPPSlideshow() {
    if (ppSlideshowTimer) { clearInterval(ppSlideshowTimer); ppSlideshowTimer = null; }
}

function ppPrevImage() { stopPPSlideshow();
    var img = document.getElementById('main-product-image');
    if (!img) return;
    var thumbs = document.querySelectorAll('#pp-thumbs .pp-thumb');
    var activeIdx = -1;
    thumbs.forEach(function (el, i) { if (el.classList.contains('active')) activeIdx = i; });
    if (activeIdx <= 0) return;
    var idx = activeIdx - 1;
    thumbs.forEach(function (el, i) { el.classList.toggle('active', i === idx); });
    var imgs = thumbs[idx].querySelector('img');
    if (imgs) img.src = cloudinaryThumb(imgs.getAttribute('data-raw') || imgs.src, 800);
    updatePPNavArrows(activeIdx - 1, thumbs.length);
}

function ppNextImage() { stopPPSlideshow();
    var img = document.getElementById('main-product-image');
    if (!img) return;
    var thumbs = document.querySelectorAll('#pp-thumbs .pp-thumb');
    var activeIdx = -1;
    thumbs.forEach(function (el, i) { if (el.classList.contains('active')) activeIdx = i; });
    if (activeIdx >= thumbs.length - 1) return;
    var idx = activeIdx + 1;
    thumbs.forEach(function (el, i) { el.classList.toggle('active', i === idx); });
    var imgs = thumbs[idx].querySelector('img');
    if (imgs) img.src = cloudinaryThumb(imgs.getAttribute('data-raw') || imgs.src, 800);
    updatePPNavArrows(activeIdx + 1, thumbs.length);
}

function updatePPNavArrows(idx, total) {
    var prevBtn = document.querySelector('.pp-nav-prev');
    var nextBtn = document.querySelector('.pp-nav-next');
    if (prevBtn) prevBtn.classList.toggle('hidden', idx <= 0);
    if (nextBtn) nextBtn.classList.toggle('hidden', idx >= total - 1);
}

function renderRelatedProducts(currentProduct) {
    const grid = document.getElementById('related-products-grid');
    if (!grid) return;
    const related = products
        .filter(p => p.category === currentProduct.category && p.id !== currentProduct.id)
        .slice(0, 4);
    if (related.length === 0) {
        const section = document.getElementById('related-products');
        if (section) section.style.display = 'none';
        return;
    }
    grid.innerHTML = related.map(renderProductCard).join('');
    _refreshReveals();
}

async function loadShopPage(page) {
    currentPage = page;
    await loadServerPage(page);
}

function buildFilterUrl(basePage) {
    let url = '/api/public/products?page=' + basePage + '&limit=' + PER_PAGE;
    if (currentCategory) url += '&category=' + encodeURIComponent(currentCategory);
    if (filterState.sortBy) url += '&sort=' + filterState.sortBy;
    if (filterState.search) url += '&search=' + encodeURIComponent(filterState.search);
    if (filterState.collection) url += '&collection=' + encodeURIComponent(filterState.collection);
    if (filterState.size) url += '&size=' + encodeURIComponent(filterState.size);
    if (filterState.inStock) url += '&in_stock=true';
    return url;
}

async function loadServerPage(page) {
    var grid = document.getElementById('products-grid');
    var loading = document.getElementById('shop-loading');
    var empty = document.getElementById('shop-empty');
    var paginationEl = document.getElementById('pagination');

    if (loading) loading.style.display = 'flex';
    if (grid) grid.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (paginationEl) paginationEl.style.display = 'none';

    try {
        const res = await fetch(buildFilterUrl(page));
        if (!res.ok) throw new Error('Failed to load page');
        const data = await res.json();
        totalPages = data.total_pages;
        totalProducts = data.total;

        if (loading) loading.style.display = 'none';

        if (data.products.length === 0) {
            if (grid) grid.style.display = 'none';
            if (empty) empty.style.display = 'flex';
            if (paginationEl) paginationEl.style.display = 'none';
        } else {
            if (grid) grid.style.display = '';
            if (empty) empty.style.display = 'none';
            if (paginationEl) paginationEl.style.display = '';
            renderProducts(data.products, grid);
            renderPagination();
            refreshInCartGlow();
            data.products.forEach(function(p) {
                if (!products.find(function(ep) { return ep.id === p.id; })) {
                    products.push(p);
                }
            });
        }

        updateResultsCount(data.total);
        renderActiveFilters();
        syncFilterUrlState();
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        _refreshReveals();
    } catch (e) {
        console.error('Error loading shop page:', e);
        if (loading) loading.style.display = 'none';
        if (grid) grid.style.display = '';
    }
}

async function buildCategoryFilterUI() {
    var container = document.getElementById('category-filter-row');
    if (!container) return;
    try {
        var res = await fetch('/api/public/categories');
        var cats = await res.json();
        _categoriesCache = cats;
        var html = '<span class="filter-label">Catégorie</span>';
        var allActive = !currentCategory;
        html += '<button class="filter-chip' + (allActive ? ' active' : '') + '" data-filter="category" data-value="">Tout</button>';
        (cats.filter(function(c) { return c.status === 'active'; }) || []).forEach(function(c) {
            var active = currentCategory === c.name;
            html += '<button class="filter-chip' + (active ? ' active' : '') + '" data-filter="category" data-value="' + esc(c.name) + '">' + esc(c.name) + '</button>';
        });
        container.innerHTML = html;
    } catch (e) {
        console.error('Failed to load categories:', e);
    }
}

var filterDelegatesInitialized = false;
function initFilterDelegates() {
    if (filterDelegatesInitialized) return;
    filterDelegatesInitialized = true;
    document.addEventListener('click', async function(e) {
        var chip = e.target.closest('.filter-chip');
        if (!chip) return;
        var filterType = chip.dataset.filter;
        var value = chip.dataset.value;
        if (filterType === 'category') {
            if (currentCategory === value) {
                currentCategory = '';
            } else {
                currentCategory = value;
            }
            currentSizeGroups = [];
            _cachedAllProducts = [];
            buildCategoryFilterUI();
            buildSizeFilterChipsUI();
            loadShopPage(1);
        } else if (filterType === 'collection') {
            if (filterState.collection === value) {
                filterState.collection = '';
            } else {
                filterState.collection = value;
            }
            buildCollectionFilterUI();
            loadShopPage(1);
        } else if (filterType === 'size') {
            if (filterState.size === value) {
                filterState.size = '';
            } else {
                filterState.size = value;
            }
            buildSizeFilterChipsUI();
            loadShopPage(1);
        }
    });
}

function logSearchEvent(type, payload) {
    try {
        fetch('/api/public/log-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type, payload: payload })
        });
    } catch (e) {}
}

function initShopSearch() {
    var input = document.getElementById('shop-search-input');
    var clearBtn = document.getElementById('shop-search-clear');
    if (!input) return;
    input.addEventListener('input', function() {
        var val = input.value.trim();
        if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
        clearTimeout(_shopSearchDebounce);
        _shopSearchDebounce = setTimeout(function() {
            filterState.search = val;
            if (val) logSearchEvent('search', { query: val });
            loadShopPage(1);
        }, 350);
    });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            clearTimeout(_shopSearchDebounce);
            filterState.search = input.value.trim();
            loadShopPage(1);
        }
    });
}

function clearShopSearch() {
    var input = document.getElementById('shop-search-input');
    var clearBtn = document.getElementById('shop-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    filterState.search = '';
    loadShopPage(1);
}


async function buildCollectionFilterUI() {
    var container = document.getElementById('collection-filter-row');
    if (!container) return;
    try {
        var res = await fetch('/api/public/collections');
        var cols = await res.json();
        var active = (cols || []).filter(function(c) { return c.status === 'active'; });
        if (active.length === 0) { container.innerHTML = ''; return; }
        var html = '<span class="filter-label">Collection</span>';
        html += '<button class="filter-chip' + (!filterState.collection ? ' active' : '') + '" data-filter="collection" data-value="">Tout</button>';
        active.forEach(function(c) {
            var sel = filterState.collection === c.name;
            html += '<button class="filter-chip' + (sel ? ' active' : '') + '" data-filter="collection" data-value="' + esc(c.name) + '">' + esc(c.name) + '</button>';
        });
        container.innerHTML = html;
    } catch (e) {
        console.error('Failed to load collections:', e);
    }
}

async function buildSizeFilterChipsUI() {
    var container = document.getElementById('size-filter-row');
    if (!container) return;
    try {
        if (!_filterOptionsCache) {
            var res = await fetch('/api/public/products/filters');
            _filterOptionsCache = await res.json();
        }
        var sizes = _filterOptionsCache.sizes || [];
        if (sizes.length === 0) { container.innerHTML = ''; return; }
        var html = '<button class="filter-chip' + (!filterState.size ? ' active' : '') + '" data-filter="size" data-value="">Toutes</button>';
        sizes.forEach(function(s) {
            var sel = filterState.size === s;
            html += '<button class="filter-chip' + (sel ? ' active' : '') + '" data-filter="size" data-value="' + esc(s) + '">' + esc(s) + '</button>';
        });
        container.innerHTML = html;
    } catch (e) {
        console.error('Failed to load sizes:', e);
    }
}

function renderActiveFilters() {
    var container = document.getElementById('shop-active-filters');
    var list = document.getElementById('active-filters-list');
    if (!container || !list) return;
    var chips = [];
    if (filterState.search) {
        chips.push({ label: '"' + filterState.search + '"', type: 'search' });
    }
    if (currentCategory) {
        chips.push({ label: currentCategory, type: 'category' });
    }
    if (filterState.collection) {
        chips.push({ label: filterState.collection, type: 'collection' });
    }
    if (filterState.size) {
        chips.push({ label: filterState.size, type: 'size' });
    }
    if (chips.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';
    list.innerHTML = chips.map(function(c) {
        return '<span class="active-filter-chip">' + esc(c.label) + ' <button onclick="removeFilter(\'' + c.type + '\')">&times;</button></span>';
    }).join('');
}

function removeFilter(type) {
    if (type === 'search') {
        filterState.search = '';
        var input = document.getElementById('shop-search-input');
        var clearBtn = document.getElementById('shop-search-clear');
        if (input) input.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
    } else if (type === 'category') {
        currentCategory = '';
        _categoriesCache = [];
        buildCategoryFilterUI();
        buildSizeFilterChipsUI();
    } else if (type === 'collection') {
        filterState.collection = '';
        buildCollectionFilterUI();
    } else if (type === 'size') {
        filterState.size = '';
        buildSizeFilterChipsUI();
    }
    loadShopPage(1);
}

function clearAllFilters() {
    filterState.search = '';
    filterState.collection = '';
    filterState.size = '';
    currentCategory = '';
    currentSizeGroups = [];
    _categoriesCache = [];
    var input = document.getElementById('shop-search-input');
    var clearBtn = document.getElementById('shop-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    filterState.sortBy = 'newest';
    buildCategoryFilterUI();
    buildSizeFilterChipsUI();
    buildCollectionFilterUI();
    loadShopPage(1);
}

function syncFilterUrlState() {
    var params = new URLSearchParams();
    if (currentCategory) params.set('category', currentCategory);
    if (filterState.search) params.set('search', filterState.search);
    if (filterState.collection) params.set('collection', filterState.collection);
    if (filterState.size) params.set('size', filterState.size);
    if (filterState.sortBy && filterState.sortBy !== 'newest') params.set('sort', filterState.sortBy);
    if (filterState.inStock) params.set('in_stock', '1');
    var qs = params.toString();
    var newUrl = window.location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', newUrl);
}

function readFilterUrlState() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('category')) currentCategory = params.get('category');
    if (params.get('search')) {
        filterState.search = params.get('search');
        var input = document.getElementById('shop-search-input');
        var clearBtn = document.getElementById('shop-search-clear');
        if (input) input.value = filterState.search;
        if (clearBtn) clearBtn.style.display = filterState.search ? 'flex' : 'none';
    }
    if (params.get('collection')) filterState.collection = params.get('collection');
    if (params.get('size')) filterState.size = params.get('size');
}

function getPaginationRange(current, total) {
    if (total <= 7) return Array.from({length: total}, function(_, i) { return i + 1; });
    var pages = [1];
    var start = Math.max(2, current - 1);
    var end = Math.min(total - 1, current + 1);
    if (current <= 3) { start = 2; end = Math.min(5, total - 1); }
    if (current >= total - 2) { start = Math.max(total - 4, 2); end = total - 1; }
    if (start > 2) pages.push('...');
    for (var i = start; i <= end; i++) pages.push(i);
    if (end < total - 1) pages.push('...');
    pages.push(total);
    return pages;
}

function renderPagination() {
    var container = document.getElementById('pagination');
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    var html = '';
    html += '<button class="pagination-btn" onclick="goToPage(' + (currentPage - 1) + ')"' + (currentPage === 1 ? ' disabled' : '') + '>«</button>';
    var range = getPaginationRange(currentPage, totalPages);
    for (var i = 0; i < range.length; i++) {
        var p = range[i];
        if (p === '...') {
            html += '<span class="pagination-ellipsis">…</span>';
        } else {
            html += '<button class="pagination-btn' + (p === currentPage ? ' active' : '') + '" onclick="goToPage(' + p + ')">' + p + '</button>';
        }
    }
    html += '<button class="pagination-btn" onclick="goToPage(' + (currentPage + 1) + ')"' + (currentPage === totalPages ? ' disabled' : '') + '>»</button>';
    container.innerHTML = html;
}

function goToPage(page) {
    if (page < 1 || page > totalPages) return;
    loadShopPage(page);
}

/* ── Scroll-reveal (IntersectionObserver) ── */
function initScrollReveal() {
    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.reveal-up, .reveal-fade, .reveal-scale').forEach(function(el) { el.classList.add('revealed'); });
        return;
    }
    var revealObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal-up, .reveal-fade, .reveal-scale').forEach(function(el) {
        revealObserver.observe(el);
    });
}

/* Re-run observer after dynamic content loads (shop page, homepage collections) */
function _refreshReveals() {
    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.reveal-up:not(.revealed), .reveal-fade:not(.revealed), .reveal-scale:not(.revealed)').forEach(function(el) { el.classList.add('revealed'); });
        return;
    }
    var revealObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal-up:not(.revealed), .reveal-fade:not(.revealed), .reveal-scale:not(.revealed)').forEach(function(el) {
        revealObserver.observe(el);
    });
}

/* ── Icon pulse when item added to cart / wishlist ── */
function pulseIcon(btn) {
    if (!btn) return;
    btn.classList.remove('icon-pulse');
    void btn.offsetWidth;          /* reflow to restart animation */
    btn.classList.add('icon-pulse');
    btn.addEventListener('animationend', function handler() {
        btn.classList.remove('icon-pulse');
        btn.removeEventListener('animationend', handler);
    });
}

async function init() {
    if (_initialized) return;
    _initialized = true;

    var needsProducts = document.getElementById('product-container') ||
                        document.querySelector('.wishlist-page') ||
                        document.getElementById('cart-page-items') ||
                        document.querySelector('.checkout-form') ||
                        document.getElementById('collection-tabs') ||
                        document.getElementById('collection-products') ||
                        document.getElementById('products-grid');
    if (needsProducts) {
        await loadProducts();
    }

    updateCartDisplay();
    setTimeout(initScrollTracks, 100);
    updateCartCounter();
    updateWishlistDisplay();
    updateWishlistCounter();

    if (document.getElementById('product-container')) {
        loadProductPage();
    }

    if (document.querySelector('.wishlist-page')) {
        renderWishlistPage();
    }

    if (document.getElementById('cart-page-items')) {
        renderCartPage();
    }

    if (document.querySelector('.checkout-form')) {
        renderCheckout();
    }

    const grid = document.getElementById('products-grid');
    if (grid) {
        readFilterUrlState();
        initFilterDelegates();
        initShopSearch();
        await Promise.all([
            _ensureCategoriesCache().then(function() {
                return Promise.all([
                    buildCategoryFilterUI(),
                    buildCollectionFilterUI(),
                    buildSizeFilterChipsUI()
                ]);
            }),
            loadShopPage(1)
        ]);
        var savedScroll = sessionStorage.getItem('shopScrollPos');
        if (savedScroll) {
            sessionStorage.removeItem('shopScrollPos');
            setTimeout(function() { window.scrollTo(0, parseInt(savedScroll, 10)); }, 100);
        }
        grid.addEventListener('click', function(e) {
            var link = e.target.closest('a[href*="product.html"]');
            if (link) {
                sessionStorage.setItem('shopScrollPos', window.scrollY);
            }
        });
    }

    const hamburger = document.getElementById('hamburger-btn');
    if (hamburger) {
        hamburger.addEventListener('click', toggleNav);
    }

    if (document.querySelector('.hero-slider, .slides, .slider-dot')) {
        var _sliderInterval = setInterval(() => changeSlide(1), 5000);
        window.addEventListener('beforeunload', () => clearInterval(_sliderInterval));
    }

    if (document.querySelector('.header')) {
        var _scrollRaf = null;
        window.addEventListener('scroll', function() {
            if (_scrollRaf) return;
            _scrollRaf = requestAnimationFrame(function() {
                _scrollRaf = null;
                const header = document.querySelector('.header');
                if (header) {
                    header.classList.toggle('scrolled', window.scrollY > 50);
                }
            });
        });
    }

    document.querySelectorAll('.faq-question').forEach(q => {
        q.addEventListener('click', function() {
            this.parentElement.classList.toggle('active');
        });
    });

    initScrollReveal();
}

/* ====== Orders / Mes Commandes ====== */


document.addEventListener('DOMContentLoaded', function () { init().catch(function (e) { console.error('Init error:', e); }); });

window.toggleWishlistItem = toggleWishlistItem;
window.toggleWishlist = toggleWishlist;
window.closeAllDrawers = closeAllDrawers;
window.addToCart = addToCart;
window.addToCartOrQuickView = addToCartOrQuickView;
window.toggleCart = toggleCart;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.searchProducts = searchProducts;
window.handleSearchInput = handleSearchInput;
window.quickView = quickView;
window.quickViewForCart = quickViewForCart;
window.closeQuickView = closeQuickView;
window.openQvZoom = openQvZoom;
window.closeQvZoom = closeQvZoom;
window.qvPrevImage = qvPrevImage;
window.qvNextImage = qvNextImage;
window.qvGoToImage = qvGoToImage;
window.qvSelectSize = qvSelectSize;
window.qvSelectColor = qvSelectColor;
window.qvChangeQty = qvChangeQty;
window.qvAddToCart = qvAddToCart;
window.qvBuyNow = qvBuyNow;
window.qvToggleWishlist = qvToggleWishlist;
window.clearShopSearch = clearShopSearch;
window.removeFilter = removeFilter;
window.clearAllFilters = clearAllFilters;
window.scrollTrack = scrollTrack;
window.ppBuyNow = ppBuyNow;

window.ppPrevImage = ppPrevImage;
window.ppNextImage = ppNextImage;
window.changeSlide = changeSlide;
window.goToSlide = goToSlide;
window.toggleNav = toggleNav;
window.openTab = openTab;
window.updateResultsCount = updateResultsCount;
window.goToPage = goToPage;
window.proceedToCheckout = proceedToCheckout;
window.renderCheckout = renderCheckout;
window.placeOrder = placeOrder;
window.changeQty = changeQty;
window.setQty = setQty;
window.removeFromCart = removeFromCart;
window.doSearch = doSearch;
window.removeFromWishlist = removeFromWishlist;
window.addToCartFromWishlist = addToCartFromWishlist;
window.renderWishlistPage = renderWishlistPage;
window.updateWishlistCounter = updateWishlistCounter;
window.emptyCart = emptyCart;
window.esc = window.esc || function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
function decreaseQty(productId) { changeQty(productId, -1); }
function increaseQty(productId) { changeQty(productId, 1); }
function updateCartItem(productId) { setQty(productId); }
window.updateCartCounter = updateCartCounter;
window.changeQtyByKey = changeQtyByKey;
window.setQtyByKey = setQtyByKey;
window.removeFromCartByKey = removeFromCartByKey;
window.updateCheckoutSummary = updateCheckoutSummary;
window.renderCartPage = renderCartPage;
window.switchProductImage = switchProductImage;
window.selectProductColor = selectProductColor;
window.selectProductSize = selectProductSize;
window.changeProductQty = changeProductQty;
window.setProductQty = setProductQty;
window.addCurrentToCart = addCurrentToCart;
window.addCurrentToWishlist = addCurrentToWishlist;
window.decreaseQty = decreaseQty;
window.increaseQty = increaseQty;
window.updateCartItem = updateCartItem;
window.formatPhoneInput = formatPhoneInput;

function showToast(msg) {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1A1A1A;color:#fff;padding:10px 20px;border-radius:6px;font-size:0.82rem;z-index:9999;animation:fadeInUp 0.3s ease;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 2500);
}

function shareWishlistWhatsApp() {
    if (!wishlist || wishlist.length === 0) return;
    var baseUrl = location.origin + '/website/products.json';
    fetch(baseUrl)
    .then(function(r) { return r.json(); })
    .then(function(products) {
        var names = [];
        var links = [];
        wishlist.forEach(function(id) {
            var p = products.find(function(pr) { return pr.id == id || pr.id === id; });
            if (p) {
                names.push(p.name);
                links.push(location.origin + '/website/product.html?id=' + p.id);
            }
        });
        var text = i18n.t('wishlist.shareDiscover');
        if (links.length <= 3) {
            text += names.join(', ') + '\n\n' + links.join('\n');
        } else {
            text += names.slice(0, 3).join(', ') + ' +' + (names.length - 3) + '\n\n' + links.join('\n');
        }
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    })
    .catch(function() {
        var text = i18n.t('wishlist.shareDiscover') + '\n' + location.origin + '/wishlist/';
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    });
}

document.addEventListener('DOMContentLoaded', function() {
    fetch('/api/public/log-event', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'page_view', payload: {page: location.pathname}}) }).catch(function(){});
    var waFloat = document.getElementById('whatsapp-float');
    var waTooltip = document.getElementById('whatsapp-tooltip');
    if (waFloat && waTooltip) {
        setTimeout(function() { waTooltip.classList.add('hidden'); }, 6000);
        waFloat.addEventListener('click', function() {
            fetch('/api/public/log-event', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'whatsapp_click', payload: {page: location.pathname}}) });
        });
        document.querySelectorAll('input, textarea, select').forEach(function(el) {
            el.addEventListener('focus', function() { waFloat.style.display = 'none'; });
            el.addEventListener('blur', function() { waFloat.style.display = 'flex'; });
        });
    }

    if ('ontouchstart' in window) {
        document.addEventListener('click', function(e) {
            var card = e.target.closest('.product-card .product-image');
            if (!card) return;
            var primary = card.querySelector('.img-primary');
            var secondary = card.querySelector('.img-secondary');
            if (!primary || !secondary) return;
            var showing = secondary.style.opacity === '1';
            secondary.style.opacity = showing ? '0' : '1';
            primary.style.opacity = showing ? '1' : '0';
        });
    }
});

