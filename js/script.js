let products = [];
let productsLoaded = false;
let currentPage = 1;
let totalPages = 1;
let totalProducts = 0;
const PER_PAGE = 16;
let currentCategory = '';

async function loadProducts() {
    try {
        const res = await fetch('/api/public/products');
        if (!res.ok) throw new Error('Failed to load products');
        products = await res.json();
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
    sortBy: 'newest'
};
let currentSizeGroups = [];
let _cachedAllProducts = [];
let _cachedAllCategory = '';
let _categoriesCache = [];

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
    if (sizeSystem === 'grouped_taille' && availSizes && availSizes.length > 0) {
        var firstSize = typeof availSizes[0] === 'object' ? availSizes[0].size : availSizes[0];
        /* If sizes are already group names, render elegant Taille boxes */
        if (firstSize && firstSize.indexOf('Taille') === 0) {
            var html = '<div class="sz-group-taille-boxes" style="display:flex;flex-direction:column;gap:10px;">';
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
                    ' style="border:1.5px solid ' + (selected ? 'var(--primary)' : 'var(--border)') + ';border-radius:10px;padding:12px 16px;cursor:pointer;transition:all 0.2s ease;' +
                    'background:' + (selected ? 'var(--cream, #faf9f6)' : 'var(--bg, #fff)') + ';' +
                    (!available ? 'opacity:0.45;cursor:not-allowed;' : 'hover:border-color:var(--primary);hover:box-shadow:0 2px 8px rgba(212,175,55,0.12);') + '"' +
                    (!available ? '' : ' onclick="' + clickHandlerAttr.replace('{val}', grp.label.replace(/'/g, "\\'")) + '"') + '>' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                        '<span style="font-weight:600;font-size:0.95rem;">' + grp.label + '</span>' +
                        (!available ? '<span style="font-size:0.7rem;color:var(--text-light);">Épuisé</span>' :
                         (selected ? '<span style="font-size:0.7rem;color:var(--primary);font-weight:500;">Sélectionné</span>' : '')) +
                    '</div>' +
                    '<div style="font-size:0.75rem;color:var(--text-light);margin-top:4px;">' + infoText + '</div>' +
                '</div>';
            });
            html += '</div>';
            if (!html || html === '<div class="sz-group-taille-boxes" style="display:flex;flex-direction:column;gap:10px;"></div>') {
                html = '<p style="color:var(--text-light);font-size:0.85rem;">Aucune taille disponible</p>';
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
    if (!html) html = '<p style="color:var(--text-light);font-size:0.85rem;">Aucune taille disponible</p>';
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
    var imgs = product.images && product.images.length > 0 ? product.images : (product.image ? [product.image] : ['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="533" fill="%23f0f0f0"><rect width="400" height="533"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23ccc" font-size="16">No Image</text></svg>']);
    var second = imgs.length > 1 ? imgs[1] : null;
    var ribbon = productRibbonHtml(product);
    var sizesHtml = '';
    if (product.sizes && product.sizes.length > 0) {
        var available = product.sizes.filter(function(s) { return s.stock > 0; });
        if (available.length > 0) {
            var sizeLabels = available.map(function(s) { return esc(s.size); }).join(' \u2022 ');
            sizesHtml = '<div class="product-sizes">Disponible : ' + sizeLabels + '</div>';
        }
    }
    var priceHtml = product.sale_price
        ? '<span class="original-price">' + formatPriceDA(product.price) + '</span><span class="sale-price">' + formatPriceDA(product.sale_price) + '</span>'
        : '<span class="current-price">' + formatPriceDA(product.price) + '</span>';
    return '<div class="product-card">' +
        '<div class="product-image">' +
            '<img src="' + imgs[0] + '" alt="' + esc(product.name) + '" class="img-primary" loading="lazy">' +
            (second ? '<img src="' + second + '" alt="' + esc(product.name) + '" class="img-secondary" loading="lazy">' : '') +
            ribbon +
            '<button class="product-wishlist' + (inW ? ' active' : '') + '" onclick="toggleWishlistItem(this,' + pid + ')" aria-label="Wishlist">' +
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
                '</svg>' +
            '</button>' +
            '<div class="product-overlay">' +
                '<button class="btn-overlay" onclick="quickView(' + pid + ')">Aperçu rapide</button>' +
                '<button class="btn-overlay btn-overlay-primary" onclick="addToCartOrQuickView(' + pid + ')">Ajouter au panier</button>' +
            '</div>' +
        '</div>' +
        '<div class="product-info">' +
            '<h3 class="product-title"><a href="product.html?id=' + pid + '">' + esc(product.name) + '</a></h3>' +
            sizesHtml +
            '<div class="product-price">' + priceHtml + '</div>' +
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
        container.innerHTML = '<p class="no-results" style="display:block;">Aucun produit trouvé</p>';
        return;
    }
    container.innerHTML = results.slice(0, 8).map(p => `
        <div class="search-suggestion" onclick="closeSearchModal(); window.location.href='product.html?id=${p.id}'">
            <img src="${p.image}" alt="${p.name}" class="search-suggestion-img" loading="lazy">
            <div class="search-suggestion-info">
                <div class="search-suggestion-name">${p.name}</div>
                <div class="search-suggestion-meta">${p.category}${p.brand ? ' &middot; ' + p.brand : ''} &middot; ${formatPriceDA(p.price)}</div>
            </div>
        </div>
    `).join('');
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
    if (cart) cart.classList.remove('active');
    if (wishlist) wishlist.classList.remove('active');
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
        container.innerHTML = '<div class="empty-wishlist"><p>Votre liste de souhaits est vide</p></div>';
        return;
    }
    container.innerHTML = '';
    wishlist.forEach(id => {
        const p = products.find(pr => pr.id === id);
        if (p) {
            container.innerHTML += `
                <div class="wishlist-item">
                    <a href="product.html?id=${p.id}">
                        <img src="${p.image}" alt="${p.name}" class="cart-item-image">
                    </a>
                    <div class="cart-item-details">
                        <a href="product.html?id=${p.id}" style="text-decoration:none;color:inherit">
                            <h3 class="cart-item-title">${p.name}</h3>
                        </a>
                        <p class="cart-item-price">${formatPriceDA(p.price)}</p>
                        <button class="btn btn-outline" onclick="addToCartFromWishlist(${p.id})" style="font-size:0.75rem;padding:4px 8px;margin-bottom:4px;">Ajouter au panier</button>
                        <button class="remove-item" onclick="removeFromWishlist(${p.id})">Supprimer</button>
                    </div>
                </div>
            `;
        }
    });
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
        if (p) html += renderProductCard(p);
    });
    container.innerHTML = html;
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
    var sidebar = document.getElementById('cart-sidebar');
    if (sidebar && !sidebar.classList.contains('active')) {
        toggleCart();
    }
}

function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    if (sidebar) {
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
    return item.images && item.images.length > 0 ? item.images[0] : item.image;
}

function updateCartDisplay() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total-price');
    const header = document.querySelector('.sidebar-header h3');
    if (!container) return;
    const emptyMsg = container.querySelector('.empty-cart');
    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-cart"><p>Votre panier est vide</p></div>';
        if (totalEl) totalEl.textContent = '0,00 €';
        if (header) header.textContent = 'Mon Panier';
        const emptyBtn = document.querySelector('.empty-cart-btn');
        if (emptyBtn) emptyBtn.style.display = 'none';
        return;
    }
    container.innerHTML = '';
    let total = 0;
    let itemCount = 0;
    cart.forEach(item => {
        const subtotal = (Number(item.price) || 0) * (item.quantity || 1);
        total += subtotal;
        itemCount += item.quantity;
        var variantInfo = '';
        if (item.selectedSize || item.selectedColor) {
            variantInfo = '<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;">';
            if (item.selectedSize) variantInfo += 'Taille : ' + item.selectedSize;
            if (item.selectedSize && item.selectedColor) variantInfo += ' | ';
            if (item.selectedColor) variantInfo += 'Couleur : ' + item.selectedColor;
            variantInfo += '</div>';
        }
        var cartKey = item.id + '-' + (item.selectedSize || '') + '-' + (item.selectedColor || '');
        container.innerHTML += `
            <div class="cart-item">
                <img src="${getCartItemImage(item)}" alt="${item.name}" class="cart-item-image" loading="lazy">
                <div class="cart-item-details">
                    <h3 class="cart-item-title">${item.name}</h3>
                    ${variantInfo}
                    <p class="cart-item-price">${formatPriceDA(item.price)}</p>
                    <div class="cart-item-subtotal">Sous-total : ${formatPriceDA(subtotal)}</div>
                    <div class="cart-item-quantity">
                        <button class="quantity-btn" onclick="changeQtyByKey('${cartKey}', -1)">−</button>
                        <input type="text" class="quantity-input" id="qty-${cartKey}" value="${item.quantity}" onchange="setQtyByKey('${cartKey}')">
                        <button class="quantity-btn" onclick="changeQtyByKey('${cartKey}', 1)">+</button>
                        <button class="quantity-btn" onclick="quickViewForCart('${cartKey}')" style="font-size:0.7rem;padding:0 6px;min-width:auto" title="Modifier">✎</button>
                        <button class="remove-item" onclick="removeFromCartByKey('${cartKey}')">✕</button>
                    </div>
                </div>
            </div>
        `;
    });
    if (header) header.textContent = `Mon Panier (${itemCount} article${itemCount !== 1 ? 's' : ''})`;
    if (totalEl) totalEl.textContent = formatPriceDA(total);
    let emptyBtn = document.querySelector('.empty-cart-btn');
    if (!emptyBtn) {
        const footer = document.querySelector('.sidebar-footer');
        if (footer) {
            emptyBtn = document.createElement('button');
            emptyBtn.className = 'btn btn-outline empty-cart-btn';
            emptyBtn.textContent = 'Vider le panier';
            emptyBtn.style.width = '100%';
            emptyBtn.style.marginBottom = '0.5rem';
            emptyBtn.onclick = emptyCart;
            footer.insertBefore(emptyBtn, footer.firstChild);
        }
    }
    if (emptyBtn) emptyBtn.style.display = 'block';
    updateCartCounter();
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
        container.innerHTML = '<div class="cart-empty"><p>Votre panier est vide.</p><a href="shop.html" class="btn btn-primary" style="display:inline-block;text-decoration:none;margin-top:1rem">Découvrir nos produits</a></div>';
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
            if (item.selectedSize) variantInfo += 'Taille: ' + item.selectedSize;
            if (item.selectedSize && item.selectedColor) variantInfo += ' | ';
            if (item.selectedColor) variantInfo += item.selectedColor;
            variantInfo += '</div>';
        }
        return '<div class="cart-item">' +
            '<div class="cart-item-image"><img src="' + getCartItemImage(item) + '" alt="' + esc(item.name) + '" loading="lazy"></div>' +
            '<div class="cart-item-details">' +
                '<h3 class="cart-item-title">' + esc(item.name) + '</h3>' +
                variantInfo +
                '<p class="cart-item-price">' + formatPriceDA(item.price) + '</p>' +
                '<div class="cart-item-quantity">' +
                    '<button class="quantity-btn" onclick="changeQtyByKey(\'' + cartKey + '\', -1)">−</button>' +
                    '<input type="text" class="quantity-input" id="qty-' + cartKey + '" value="' + item.quantity + '" onchange="setQtyByKey(\'' + cartKey + '\')">' +
                    '<button class="quantity-btn" onclick="changeQtyByKey(\'' + cartKey + '\', 1)">+</button>' +
                    '<button class="btn btn-sm btn-outline modifier-btn" onclick="quickViewForCart(\'' + cartKey + '\')">Modifier</button>' +
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
                <h2>Rechercher</h2>
                <div class="search-container">
                    <input type="text" id="search-input" placeholder="Rechercher un produit..." onkeyup="handleSearchInput(event)">
                    <button onclick="searchProducts(document.getElementById('search-input').value)">Rechercher</button>
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
    if (mainImg) mainImg.src = images[0];
    var thumbs = document.getElementById('quick-view-thumbs');
    if (thumbs) {
        thumbs.innerHTML = images.map(function(img, i) {
            return '<div class="qv-thumb' + (i === 0 ? ' active' : '') + '" onclick="qvGoToImage(' + i + ')"><img src="' + img + '" alt=""></div>';
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

    var modal = document.getElementById('quick-view-modal');
    if (modal) modal.classList.add('active');

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
    if (mainImg) mainImg.src = images[0];

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
            return '<div class="qv-thumb' + (i === 0 ? ' active' : '') + '" onclick="qvGoToImage(' + i + ')"><img src="' + img + '" alt=""></div>';
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
        wishlistText.textContent = inWish ? 'Retirer des favoris' : 'Ajouter aux favoris';
    }

    _qv.currentIndex = 0;
}

function closeQuickView() {
    _qv.modifyCartKey = null;
    var qv = document.getElementById('quick-view-modal');
    if (!qv) return;
    qv.classList.remove('active');
    qv.classList.add('closing');
    setTimeout(function() { qv.classList.remove('closing'); }, 420);
}

function qvGoToImage(index) {
    _qv.currentIndex = index;
    var images = getQVariantImages();
    var mainImg = document.getElementById('quick-view-main-image');
    if (mainImg) mainImg.src = images[index] || images[0];
    var thumbs = document.querySelectorAll('#quick-view-thumbs .qv-thumb');
    thumbs.forEach(function (el, i) { el.classList.toggle('active', i === index); });
}

function qvPrevImage() {
    var images = getQVariantImages();
    var idx = (_qv.currentIndex - 1 + images.length) % images.length;
    qvGoToImage(idx);
}

function qvNextImage() {
    var images = getQVariantImages();
    var idx = (_qv.currentIndex + 1) % images.length;
    qvGoToImage(idx);
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
    return product.images && product.images.length > 0 ? product.images : [product.image];
}

function updateQVGallery(images) {
    if (!images || images.length === 0) return;
    var mainImg = document.getElementById('quick-view-main-image');
    if (mainImg) mainImg.src = images[0];
    _qv.currentIndex = 0;

    var thumbs = document.getElementById('quick-view-thumbs');
    if (thumbs) {
        if (images.length > 1) {
            thumbs.innerHTML = images.map(function(img, i) {
                return '<div class="qv-thumb' + (i === 0 ? ' active' : '') + '" onclick="qvGoToImage(' + i + ')"><img src="' + img + '" alt=""></div>';
            }).join('');
            thumbs.style.display = '';
        } else {
            thumbs.innerHTML = '';
        }
    }
    var qvNavs = document.querySelectorAll('.qv-nav');
    qvNavs.forEach(function(nav) { nav.style.display = images.length > 1 ? '' : 'none'; });
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
    if (addBtn) addBtn.textContent = disabled ? 'Rupture de stock' : 'Ajouter au panier';
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
        el.innerHTML = stockLabel(vstock) + ' <span class="stock-qty">' + vstock + ' disponible(s)</span>';
        qvDisableButtons(vstock === 0);
    } else if (hasVariants && (!curColor || !curSize)) {
        el.innerHTML = '<span class="stock-badge in-stock">Sélectionnez taille et couleur</span>';
        qvDisableButtons(false);
    } else if (product.stock > 0) {
        el.innerHTML = '<span class="stock-badge in-stock">En stock</span>';
        qvDisableButtons(false);
    } else {
        el.innerHTML = '<span class="stock-badge out-of-stock">Rupture de stock</span>';
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
        alert('Veuillez sélectionner une taille');
        return false;
    }
    if (hasVariants && p.colors && p.colors.length > 0 && !_qv.selectedColor) {
        alert('Veuillez sélectionner une couleur');
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
    toggleCart();
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
        wishlistText.textContent = idx === -1 ? 'Retirer des favoris' : 'Ajouter aux favoris';
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
    if (nav) nav.classList.toggle('active');
    if (hamburger) hamburger.classList.toggle('active');
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
        el.textContent = count + ' produit' + (count !== 1 ? 's' : '');
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
        wilayaSel.innerHTML = '<option value="">Sélectionnez une wilaya</option>' +
            algerianWilayas.map(function (w) {
                return '<option value="' + w.id + '">' + w.name + '</option>';
            }).join('');
        wilayaSel.onchange = function () {
            updateMunicipalities(parseInt(this.value));
            updateCheckoutSummary();
            updateSelectFloat(this);
        };
        /* init floating label state on page load */
        updateSelectFloat(wilayaSel);
    }

    var muniSel = document.getElementById('co-municipality');
    if (muniSel) updateSelectFloat(muniSel);

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
    if (!inp) return;
    var err = document.getElementById('co-phone-error');
    var val = inp.value.trim();
    if (!val) {
        if (err) err.textContent = 'Le numéro de téléphone est requis.';
        inp.classList.add('error');
        return false;
    }
    var cleaned = val.replace(/[\s\-\.]/g, '');
    if (!/^(05|06|07|03)[0-9]{8}$/.test(cleaned)) {
        if (err) err.textContent = 'Format invalide. Ex: 0555 12 34 56';
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
        muniSel.innerHTML = '<option value="">Sélectionnez une commune</option>' +
            communes.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
        muniSel.disabled = false;
        updateSelectFloat(muniSel);
    } else {
        muniSel.innerHTML = '<option value="">Aucune commune disponible</option>';
        muniSel.disabled = true;
        updateSelectFloat(muniSel);
    }
}

function updateCheckoutSummary() {
    var subtotalEl = document.getElementById('co-subtotal');
    var deliveryEl = document.getElementById('co-delivery');
    var totalEl = document.getElementById('co-total');
    var itemsEl = document.getElementById('checkout-items');
    if (!subtotalEl || !deliveryEl || !totalEl || !itemsEl) return;

    if (!cart || cart.length === 0) {
        itemsEl.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:1rem 0">Votre panier est vide</p>';
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
        if (item.selectedSize) meta.push('Taille: ' + item.selectedSize);
        if (item.selectedColor) meta.push(item.selectedColor);
        var cartKey = item.id + '-' + (item.selectedSize || '') + '-' + (item.selectedColor || '');
        return '<div class="checkout-item-row">' +
            '<div class="checkout-item-info">' +
                '<div class="checkout-item-name">' + esc(item.name) + '</div>' +
                (meta.length > 0 ? '<div class="checkout-item-meta">' + meta.join(' | ') + '</div>' : '') +
                '<div class="checkout-item-qty">Qté: ' + item.quantity + ' × ' + formatPriceDA(item.price) + '</div>' +
            '</div>' +
            '<div class="checkout-item-actions">' +
                '<button class="modifier-btn" onclick="quickViewForCart(\'' + cartKey + '\')">Modifier</button>' +
                '<button class="remove-btn" onclick="removeFromCartByKey(\'' + cartKey + '\'); updateCheckoutSummary(); renderCartPage();">Retirer</button>' +
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
    var deliveryLabel = wilayaName ? 'Livraison — ' + wilayaName : 'Livraison';
    var deliveryLine = deliveryEl.parentNode;
    var labelSpan = deliveryLine.querySelector('span:first-child');
    if (labelSpan) labelSpan.textContent = deliveryLabel;

    subtotalEl.textContent = formatPriceDA(subtotal);
    deliveryEl.textContent = delivery > 0 ? formatPriceDA(delivery) : 'Gratuite';
    totalEl.textContent = formatPriceDA(total);
}

function placeOrder() {
    var name = document.getElementById('co-full-name').value.trim();
    var phone = document.getElementById('co-phone').value.trim();
    var wilayaSel = document.getElementById('co-wilaya');
    var wilaya = wilayaSel.options[wilayaSel.selectedIndex] ? wilayaSel.options[wilayaSel.selectedIndex].text : '';
    var muniSel = document.getElementById('co-municipality');
    var municipality = muniSel.options[muniSel.selectedIndex] ? muniSel.options[muniSel.selectedIndex].text : '';

    if (!name || !phone || !wilayaSel.value || !muniSel.value) {
        alert('Veuillez remplir tous les champs obligatoires.');
        return;
    }

    var phoneInput = document.getElementById('co-phone');
    if (!validatePhone(phoneInput)) {
        phoneInput.focus();
        return;
    }

    if (cart.length === 0) {
        alert('Votre panier est vide.');
        return;
    }

    /* build order */
    var orderItems = cart.map(function (item) {
        return { product_id: item.id, name: item.name, price: item.price, quantity: item.quantity, size: item.selectedSize || '', color: item.selectedColor || '' };
    });
    var wilayaId = parseInt(wilayaSel.value);
    var deliveryFee = getDeliveryPrice(wilayaId);
    var subtotal = cart.reduce(function (sum, item) { return sum + item.price * item.quantity; }, 0);
    var total = subtotal + deliveryFee;
    var shippingAddr = municipality + ', ' + wilaya;

    var orderNumber = 'CMD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    var payload = {
        items: orderItems,
        order_number: orderNumber,
        customer_name: name,
        customer_phone: phone,
        wilaya: wilaya,
        commune: municipality,
        shipping: shippingAddr,
        payment_method: 'Cash on Delivery',
        total: total,
        delivery_fee: deliveryFee
    };

    fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(function (res) {
        if (!res.ok) return res.json().then(function (errData) { throw new Error(errData.error || 'Erreur serveur'); });
        return res.json();
    }).then(function (data) {
        // Show confirmation modal (use server-generated number or client fallback)
        var refNumber = data.order_number || orderNumber;
        document.getElementById('confirmation-order-number').textContent = '#' + refNumber;
        document.getElementById('conf-pb-subtotal').textContent = formatPriceDA(subtotal);
        document.getElementById('conf-pb-delivery-label').textContent = 'Livraison' + (wilaya ? ' — ' + wilaya : '');
        document.getElementById('conf-pb-delivery').textContent = deliveryFee > 0 ? formatPriceDA(deliveryFee) : 'Gratuite';
        document.getElementById('conf-pb-total').textContent = formatPriceDA(total);
        document.getElementById('confirmation-details').textContent = 'Un conseiller vous contactera au ' + phone + ' pour confirmer la livraison à ' + shippingAddr + '.';
        document.getElementById('order-confirmation-modal').classList.add('active');
        // Clear cart
        cart = [];
        localStorage.setItem('adalinaCart', JSON.stringify(cart));
        updateCartDisplay();
        updateCartCounter();
        updateCheckoutSummary();
    }).catch(function (err) {
        console.error('Order error:', err);
        alert(err.message || 'Erreur lors de la commande. Veuillez réessayer.');
    });
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
        container.innerHTML = '<div class="breadcrumb"><a href="index.html">Accueil</a><span>/</span><a href="shop.html">Boutique</a></div><div style="text-align:center;padding:4rem 0"><h2>Produit non trouvé</h2><p style="color:var(--text-light);margin:1rem 0">Le produit que vous recherchez n\'existe pas ou a été supprimé.</p><a href="shop.html" class="btn btn-primary" style="display:inline-block;text-decoration:none">Retour à la boutique</a></div>';
        return;
    }

    const product = products.find(p => p.id === productId);
    if (!product) {
        container.innerHTML = '<div class="breadcrumb"><a href="index.html">Accueil</a><span>/</span><a href="shop.html">Boutique</a></div><div style="text-align:center;padding:4rem 0"><h2>Produit non trouvé</h2><p style="color:var(--text-light);margin:1rem 0">Le produit que vous recherchez n\'existe pas ou a été supprimé.</p><a href="shop.html" class="btn btn-primary" style="display:inline-block;text-decoration:none">Retour à la boutique</a></div>';
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
    if (stock > 5) return '<span class="stock-badge in-stock">En stock</span>';
    if (stock > 0) return '<span class="stock-badge low-stock">Stock faible</span>';
    return '<span class="stock-badge out-of-stock">Rupture de stock</span>';
}

function displayProduct(product) {
    var container = document.getElementById('product-container');
    if (!container) return;

    var isInWishlist = wishlist.indexOf(product.id) !== -1;
    var images = product.images && product.images.length > 0 ? product.images : [product.image];
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
                <h1 class="pp-name">${product.name}</h1>

                <div class="pp-price">
                    ${product.sale_price
                        ? '<span class="original-price">' + formatPriceDA(product.price) + '</span> <span class="sale-price">' + formatPriceDA(product.sale_price) + '</span>'
                        : formatPriceDA(product.price)}
                </div>

                <p class="pp-desc">${product.description || ''}</p>

                ${availColors.length > 0 ? '<div class="pp-section"><label>Couleur</label><div class="pp-colors">' + availColors.map(function (c) {
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

                ${availSizes.length > 0 ? '<div class="pp-section"><label>Taille</label><div class="pp-sizes">' + buildGroupedSizesHtml(
                    availSizes, product, curColor, curSize, hasVariants,
                    'pp-size-btn', 'pp-size-wrap',
                    'onclick="selectProductSize(\'{val}\', this)"',
                    product.category_size_system
                ) + '</div></div>' : ''}

                <div class="pp-section pp-stock-info" id="pp-stock-info">
                    ${curColor && curSize && hasVariants ? stockLabel(curStock) + ' <span class="stock-qty">' + curStock + ' disponible(s)</span>' : (product.stock > 0 ? '<span class="stock-badge in-stock">En stock</span>' : '<span class="stock-badge out-of-stock">Rupture de stock</span>')}
                </div>

                <div class="pp-section">
                    <label>Quantité</label>
                    <div class="pp-qty">
                        <button class="pp-qty-btn" onclick="changeProductQty(-1)">−</button>
                        <input type="text" id="product-qty-input" value="1" readonly>
                        <button class="pp-qty-btn" onclick="changeProductQty(1)">+</button>
                    </div>
                </div>

                <button class="pp-btn pp-btn-primary" onclick="addCurrentToCart()" id="pp-add-to-cart-btn">Ajouter au panier</button>
                <button class="pp-btn pp-btn-dark" onclick="ppBuyNow()">Acheter maintenant</button>

                <button class="pp-btn pp-btn-outline" onclick="addCurrentToWishlist()"><svg width="18" height="18" viewBox="0 0 24 24" fill="' + (isInWishlist ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><span id="pp-wishlist-text">' + (isInWishlist ? 'Dans mes favoris' : 'Ajouter aux favoris') + '</span></button>

                <a href="shop.html" class="pp-continue">Continuer les achats</a>
            </div>

            <div class="pp-gallery">
                <div class="pp-main-wrap">
                    ${productRibbonHtml(product)}
                    <img id="main-product-image" src="${images[0]}" alt="${product.name}">
                    ${images.length > 1 ? '<button class="pp-nav pp-nav-prev" onclick="ppPrevImage()">&#10094;</button><button class="pp-nav pp-nav-next" onclick="ppNextImage()">&#10095;</button>' : ''}
                </div>
                ${images.length > 1 ? '<div class="pp-thumbs" id="pp-thumbs">' + images.map(function (img, i) {
                    return '<div class="pp-thumb' + (i === 0 ? ' active' : '') + '" onclick="switchProductImage(\'' + img + '\', this)"><img src="' + img + '" alt=""></div>';
                }).join('') + '</div>' : ''}
            </div>
        </div>

        <div class="related-products" id="related-products">
            <h2 class="related-title">Vous aimerez aussi</h2>
            <div class="products-grid" id="related-products-grid"></div>
        </div>
    `;

    document.title = product.name + ' - ADALINA';
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', product.name + ' - ADALINA. ' + (product.description || '').substring(0, 100));

    renderRelatedProducts(product);
}

function switchProductImage(src, el) {
    var mainImg = document.getElementById('main-product-image');
    if (mainImg) mainImg.src = src;
    document.querySelectorAll('.product-thumbnail, .pp-thumb').forEach(function (t) { t.classList.remove('active'); });
    if (el) el.classList.add('active');
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
    return product.images && product.images.length > 0 ? product.images : [product.image];
}

function updateProductGallery(images) {
    if (!images || images.length === 0) return;
    var mainImg = document.getElementById('main-product-image');
    if (mainImg) mainImg.src = images[0];

    var thumbs = document.getElementById('pp-thumbs');
    if (thumbs) {
        if (images.length > 1) {
            thumbs.innerHTML = images.map(function(img, i) {
                return '<div class="pp-thumb' + (i === 0 ? ' active' : '') + '" onclick="switchProductImage(\'' + img.replace(/'/g, "\\'") + '\', this)"><img src="' + img + '" alt=""></div>';
            }).join('');
            thumbs.style.display = '';
        } else {
            thumbs.innerHTML = '';
        }
    }

    var ppNavs = document.querySelectorAll('.pp-nav');
    ppNavs.forEach(function(nav) { nav.style.display = images.length > 1 ? '' : 'none'; });
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
        alert('Veuillez sélectionner une taille');
        return;
    }

    if (product.colors && product.colors.length > 0 && !productPageState.selectedColor) {
        alert('Veuillez sélectionner une couleur');
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
}



function ppPrevImage() {
    var img = document.getElementById('main-product-image');
    if (!img) return;
    var thumbs = document.querySelectorAll('#pp-thumbs .pp-thumb');
    var activeIdx = -1;
    thumbs.forEach(function (el, i) { if (el.classList.contains('active')) activeIdx = i; });
    var idx = activeIdx <= 0 ? thumbs.length - 1 : activeIdx - 1;
    thumbs.forEach(function (el, i) { el.classList.toggle('active', i === idx); });
    var imgs = thumbs[idx].querySelector('img');
    if (imgs) img.src = imgs.src;
}

function ppNextImage() {
    var img = document.getElementById('main-product-image');
    if (!img) return;
    var thumbs = document.querySelectorAll('#pp-thumbs .pp-thumb');
    var activeIdx = -1;
    thumbs.forEach(function (el, i) { if (el.classList.contains('active')) activeIdx = i; });
    var idx = activeIdx === thumbs.length - 1 ? 0 : activeIdx + 1;
    thumbs.forEach(function (el, i) { el.classList.toggle('active', i === idx); });
    var imgs = thumbs[idx].querySelector('img');
    if (imgs) img.src = imgs.src;
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
    if (currentSizeGroups.length > 0) {
        await loadFilteredPage(page);
    } else {
        await loadServerPage(page);
    }
}

async function loadServerPage(page) {
    let url = '/api/public/products?page=' + page + '&limit=' + PER_PAGE;
    if (currentCategory) {
        url += '&category=' + encodeURIComponent(currentCategory);
    }
    if (filterState.sortBy) {
        url += '&sort=' + filterState.sortBy;
    }
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load page');
        const data = await res.json();
        totalPages = data.total_pages;
        totalProducts = data.total;
        renderProducts(data.products, document.getElementById('products-grid'));
        updateResultsCount(data.total);
        renderPagination();
        const grid = document.getElementById('products-grid');
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        _refreshReveals();
    } catch (e) {
        console.error('Error loading shop page:', e);
    }
}

async function loadFilteredPage(page) {
    let url = '/api/public/products?limit=0';
    if (currentCategory) {
        url += '&category=' + encodeURIComponent(currentCategory);
    }
    if (filterState.sortBy) {
        url += '&sort=' + filterState.sortBy;
    }
    try {
        if (_cachedAllProducts.length === 0 || _cachedAllCategory !== currentCategory) {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to load products');
            const data = await res.json();
            _cachedAllProducts = Array.isArray(data) ? data : (data.products || []);
            _cachedAllCategory = currentCategory;
        }
        var filtered = _cachedAllProducts.filter(function(p) {
            return productHasSizeInGroups(p, currentSizeGroups);
        });
        totalProducts = filtered.length;
        totalPages = Math.max(1, Math.ceil(totalProducts / PER_PAGE));
        var start = (page - 1) * PER_PAGE;
        var pageProducts = filtered.slice(start, start + PER_PAGE);
        renderProducts(pageProducts, document.getElementById('products-grid'));
        updateResultsCount(filtered.length);
        renderPagination();
        var grid = document.getElementById('products-grid');
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        _refreshReveals();
    } catch (e) {
        console.error('Error loading filtered page:', e);
    }
}

function productHasSizeInGroups(product, groups) {
    if (!product.variants || product.variants.length === 0) return false;
    for (var i = 0; i < product.variants.length; i++) {
        var v = product.variants[i];
        var sizesArr = v.sizes;
        if (!sizesArr || !Array.isArray(sizesArr)) continue;
        for (var j = 0; j < sizesArr.length; j++) {
            if (sizesArr[j].stock <= 0) continue;
            var szName = sizesArr[j].size;
            // Check by numeric range
            var grp = window.getSizeGroup(szName);
            if (grp && groups.indexOf(grp.label) !== -1) return true;
            // Legacy: match by text prefix (e.g. "TAILLE 1", "taille 2")
            var lower = szName.toLowerCase();
            for (var k = 0; k < window.SIZE_GROUPS.length; k++) {
                var prefix = window.SIZE_GROUPS[k].label.toLowerCase();
                if (groups.indexOf(window.SIZE_GROUPS[k].label) !== -1 && lower.indexOf(prefix) !== -1) {
                    return true;
                }
            }
        }
    }
    return false;
}

function buildSizeFilterUI() {
    var container = document.getElementById('size-filter-row');
    if (!container) return;
    if (currentCategorySizeSystem() !== 'grouped_taille') {
        container.innerHTML = '';
        return;
    }
    var html = '<span class="filter-label">Taille</span>';
    var allActive = currentSizeGroups.length === 0;
    html += '<button class="filter-chip' + (allActive ? ' active' : '') + '" data-filter="size-group" data-value="">Tout</button>';
    window.SIZE_GROUPS.forEach(function(g) {
        var active = currentSizeGroups.indexOf(g.label) !== -1;
        html += '<button class="filter-chip' + (active ? ' active' : '') + '" data-filter="size-group" data-value="' + esc(g.label) + '">' + esc(g.label) + '</button>';
    });
    container.innerHTML = html;
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
        if (filterType === 'size-group') {
            if (!value) {
                currentSizeGroups = [];
            } else {
                currentSizeGroups = [value];
            }
            buildSizeFilterUI();
            loadShopPage(1);
        } else if (filterType === 'category') {
            if (currentCategory === value) {
                currentCategory = '';
            } else {
                currentCategory = value;
            }
            currentSizeGroups = [];
            _cachedAllProducts = [];
            _categoriesCache = [];
            await buildCategoryFilterUI();
            buildSizeFilterUI();
            loadShopPage(1);
        }
    });
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
    var targets = document.querySelectorAll('.product-card, .category-card, .value-card, .collection-card, .home-section, section:not(.hero-split)');
    if (!targets.length) return;
    var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08 });
    targets.forEach(function(el) { el.classList.add('reveal'); observer.observe(el); });
}

/* Re-run observer after dynamic content loads (shop page, homepage collections) */
function _refreshReveals() {
    document.querySelectorAll('.reveal:not(.revealed)').forEach(function(el) {
        el.classList.remove('reveal');
    });
    setTimeout(initScrollReveal, 60);
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

    await loadProducts();

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
        const urlParams = new URLSearchParams(window.location.search);
        const categoryStr = urlParams.get('category');
        if (categoryStr) {
            currentCategory = categoryStr;
        }
        initFilterDelegates();
        await _ensureCategoriesCache();
        buildSizeFilterUI();
        await buildCategoryFilterUI();
        await loadShopPage(1);
    }

    const hamburger = document.getElementById('hamburger-btn');
    if (hamburger) {
        hamburger.addEventListener('click', toggleNav);
    }

    if (document.querySelector('.hero-slider, .slides, .slider-dot')) {
        setInterval(() => changeSlide(1), 5000);
    }

    if (document.querySelector('.header')) {
        window.addEventListener('scroll', function() {
            const header = document.querySelector('.header');
            if (header) {
                header.classList.toggle('scrolled', window.scrollY > 50);
            }
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
window.qvPrevImage = qvPrevImage;
window.qvNextImage = qvNextImage;
window.qvGoToImage = qvGoToImage;
window.qvSelectSize = qvSelectSize;
window.qvSelectColor = qvSelectColor;
window.qvChangeQty = qvChangeQty;
window.qvAddToCart = qvAddToCart;
window.qvBuyNow = qvBuyNow;
window.qvToggleWishlist = qvToggleWishlist;
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

