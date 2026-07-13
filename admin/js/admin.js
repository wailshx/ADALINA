/* ── API Client ── */
const API = '/api';
async function api(method, url, data) {
    const opts = { method, headers: {} };
    if (data) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
    }
    try {
        const res = await fetch(API + url, opts);
        if (res.url.includes('/admin/login') || (res.headers.get('content-type') || '').includes('text/html')) {
            window.location.href = '/admin/login';
            return null;
        }
        return res.json();
    } catch (err) {
        console.error('[api]', method, url, err);
        if (typeof showAdminError === 'function') {
            showAdminError('Erreur réseau: ' + method + ' ' + url + ' — ' + (err.message || err));
        }
        return null;
    }
}

function formatPriceDA(price) {
    if (price == null || isNaN(price)) return '0 DA';
    var num = Math.round(Number(price));
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' DA';
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function colorVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function hexToRgba(hex, alpha) {
    if (!hex || hex.length < 7) return fallbackRgba(alpha);
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return fallbackRgba(alpha);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    function fallbackRgba(a) { return 'rgba(201,169,110,' + a + ')'; }
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.split(' ')[0] || '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function avatarUrl(name, bg = 'c9a96e') {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=fff&size=32`;
}

var statusLabels = {
    'new': 'En attente',
    'confirmed': 'Confirmée',
    'in_delivery': 'En cours de livraison',
    'arrived': 'Arrivé',
    'preparing': 'En préparation',
    'shipped': 'Expédiée',
    'delivered': 'Livrée',
    'cancelled': 'Annulée',
};

function badge(status) {
    const m = {
        arrived: 'badge-success', delivered: 'badge-success', active: 'badge-success', 'in stock': 'badge-success', published: 'badge-success',
        processing: 'badge-warning', pending: 'badge-warning', draft: 'badge-warning', low: 'badge-warning',
        in_delivery: 'badge-info', shipped: 'badge-info',
        new: 'badge-info', confirmed: 'badge-info', preparing: 'badge-warning',
        cancelled: 'badge-danger', banned: 'badge-danger', 'out of stock': 'badge-danger', hidden: 'badge-danger',
    };
    const s = (status || '').toLowerCase();
    var label = statusLabels[s] || status;
    return `<span class="badge ${m[s] || 'badge-gray'}">${esc(label)}</span>`;
}

/* ── Dashboard ── */
async function initDashboard() {
    const d = await api('GET', '/dashboard/stats');
    if (!d) return;
    document.getElementById('stat-revenue').textContent = '$' + Number(d.revenue).toLocaleString();
    document.getElementById('stat-orders').textContent = d.orders_count;
    document.getElementById('stat-customers').textContent = d.customers_count;
    document.getElementById('stat-products').textContent = d.products_count;
    var lowStockEl = document.getElementById('stat-low-stock');
    if (lowStockEl) lowStockEl.textContent = d.low_stock;
    var outStockEl = document.getElementById('stat-out-of-stock');
    if (outStockEl) outStockEl.textContent = d.out_of_stock + ' out of stock';

    /* Recent Orders */
    var tbody = document.querySelector('#recent-orders-table tbody');
    if (tbody && d.recent_orders) {
        tbody.innerHTML = d.recent_orders.map(function(o) { return `
            <tr>
                <td>${esc(o.order_number)}</td>
                <td><div class="customer-cell"><img src="${avatarUrl(o.customer_name||'?')}" alt="">${esc(o.customer_name||'—')}</div></td>
                <td>${badge(o.status)}</td>
                <td>${formatPriceDA(o.total)}</td>
                <td>${o.created_at ? timeAgo(o.created_at) : '—'}</td>
            </tr>`;
        }).join('');
    }

    /* Top Products */
    var topTbody = document.querySelector('#top-products-table tbody');
    if (topTbody && d.top_products) {
        topTbody.innerHTML = d.top_products.map(function(p) { return `
            <tr>
                <td><div class="product-cell"><img src="/${esc(p.image)}" alt="" onerror="this.src='https://placehold.co/40x40/e2e8f0/718096?text=P'"><div class="info"><div class="name">${esc(p.name)}</div><div class="sku">SKU-${p.id}</div></div></div></td>
                <td>${formatPriceDA(p.price)}</td>
                <td>${p.sold||0}</td>
                <td>${formatPriceDA((p.sold||0) * Number(p.price))}</td>
            </tr>`;
        }).join('');
    }

    /* Recent Products */
    var rpTbody = document.querySelector('#recent-products-table tbody');
    if (rpTbody && d.recent_products) {
        rpTbody.innerHTML = d.recent_products.map(function(p) { return `
            <tr>
                <td><div class="product-cell"><img src="/${esc(p.image)}" alt="" onerror="this.src='https://placehold.co/40x40/e2e8f0/718096?text=P'"><div class="info"><div class="name">${esc(p.name)}</div></div></div></td>
                <td>${formatPriceDA(p.price)}</td>
                <td>${p.stock||0}</td>
                <td>${badge(p.stock > 0 ? (p.stock <= 5 ? 'low' : 'active') : 'hidden')}</td>
            </tr>`;
        }).join('');
    }

    /* Charts */
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var chartOpts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
    };

    if (typeof Chart !== 'undefined') {
        /* Monthly Orders (bar) */
        var moCtx = document.getElementById('monthly-orders-chart');
        if (moCtx && d.monthly_orders) {
            new Chart(moCtx, {
                type: 'bar',
                data: {
                    labels: months,
                    datasets: [{ label: 'Orders', data: d.monthly_orders, backgroundColor: hexToRgba(colorVar('--primary', '#c9a96e'), 0.6), borderColor: colorVar('--primary', '#c9a96e'), borderWidth: 1 }]
                },
                options: chartOpts
            });
        }

        /* Monthly Revenue (line) */
        var mrCtx = document.getElementById('monthly-revenue-chart');
        if (mrCtx && d.monthly_revenue) {
            new Chart(mrCtx, {
                type: 'line',
                data: {
                    labels: months,
                    datasets: [{ label: 'Revenue ($)', data: d.monthly_revenue, borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, tension: 0.3 }]
                },
                options: chartOpts
            });
        }

        /* Top Selling (horizontal bar) */
        var tpCtx = document.getElementById('top-products-chart');
        if (tpCtx && d.most_sold_chart && d.most_sold_chart.length > 0) {
            var labels = d.most_sold_chart.map(function(p) { return p.name; });
            var data = d.most_sold_chart.map(function(p) { return p.sold; });
            new Chart(tpCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{ label: 'Units Sold', data: data, backgroundColor: 'rgba(99, 102, 241, 0.6)', borderColor: '#6366f1', borderWidth: 1 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, y: { grid: { display: false } } }
                }
            });
        }
    }
}

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
}

/* ── Notifications ── */
let notifInterval = null;

function initNotifications() {
    const bellBtn = document.querySelector('.topbar-btn .fa-bell');
    if (!bellBtn) return;
    const btn = bellBtn.closest('.topbar-btn');
    if (!btn || btn.querySelector('.notif-wrapper')) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'notif-wrapper';
    btn.parentNode.insertBefore(wrapper, btn);
    wrapper.appendChild(btn);

    const dropdown = document.createElement('div');
    dropdown.className = 'notif-dropdown';
    dropdown.id = 'notifDropdown';
    dropdown.innerHTML =
        '<div class="notif-header">' +
            '<span>Notifications</span>' +
            '<button id="markAllNotifRead">Tout marquer comme lu</button>' +
        '</div>' +
        '<div class="notif-list" id="notifList"><div class="notif-empty">Chargement...</div></div>';
    wrapper.appendChild(dropdown);

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        dropdown.classList.toggle('active');
        if (dropdown.classList.contains('active')) fetchNotifications();
    });

    document.addEventListener('click', function (e) {
        if (!wrapper.contains(e.target)) dropdown.classList.remove('active');
    });

    document.getElementById('markAllNotifRead').addEventListener('click', function (e) {
        e.stopPropagation();
        api('PUT', '/notifications/read-all').then(function () {
            fetchNotifications();
        });
    });

    var badge = btn.querySelector('.badge');
    if (badge) badge.style.display = 'none';

    if (notifInterval) clearInterval(notifInterval);
    notifInterval = setInterval(fetchNotifications, 30000);
    setTimeout(fetchNotifications, 1000);
}

async function fetchNotifications() {
    var res = await api('GET', '/notifications');
    if (!res) return;
    var list = document.getElementById('notifList');
    var badge = document.querySelector('.topbar-btn .fa-bell').closest('.topbar-btn').querySelector('.badge');
    if (!list) return;

    if (badge) {
        badge.textContent = res.unread_count > 99 ? '99+' : res.unread_count;
        badge.style.display = res.unread_count > 0 ? 'flex' : 'none';
    }

    if (!res.notifications || res.notifications.length === 0) {
        list.innerHTML = '<div class="notif-empty">Aucune nouvelle notification</div>';
        return;
    }

    list.innerHTML = res.notifications.map(function (n) {
        return '<div class="notif-item" data-id="' + n.id + '" data-order-id="' + (n.order_id || n.id) + '">' +
            '<div class="notif-icon"><i class="fas fa-shopping-bag"></i></div>' +
            '<div class="notif-content">' +
                '<div class="notif-title">Nouvelle commande ' + esc(n.order_number || '#' + n.id) + '</div>' +
                '<div class="notif-desc">' + esc(n.customer_name || 'Client inconnu') + ' &middot; ' + Number(n.total || 0).toFixed(2) + ' DA</div>' +
            '</div>' +
            '<div class="notif-time">' + timeAgo(n.created_at) + '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('.notif-item').forEach(function (item) {
        item.addEventListener('click', function () {
            var id = this.dataset.id;
            var orderId = this.dataset.orderId || id;
            api('PUT', '/notifications/read/' + orderId);
            this.remove();
            var remaining = list.querySelectorAll('.notif-item').length;
            if (remaining === 0) {
                list.innerHTML = '<div class="notif-empty">Aucune nouvelle notification</div>';
                if (badge) badge.style.display = 'none';
            }
            var currPage = window.location.pathname.split('/').pop();
            if (currPage === 'orders.html') {
                viewOrder(parseInt(orderId));
            } else {
                sessionStorage.setItem('openOrderId', orderId);
                window.location.href = 'orders.html';
            }
        });
    });
}

/* ── Taille group lookup ── */
function tailleGroupForSize(size) {
    var num = parseInt(size);
    if (isNaN(num)) return '';
    if (num >= 32 && num <= 38) return 'T1';
    if (num >= 40 && num <= 46) return 'T2';
    if (num >= 48 && num <= 52) return 'T3';
    return '';
}

/* ── Print Invoice ── */
function buildInvoiceHTML(order) {
    var s = window.__adminSettings || {};
    var storeName = s.store_name || 'ADALINA';
    var logo = s.logo_header || '../images/logo.svg';
    var items = [];
    try { items = order.items || JSON.parse(order.items || '[]'); } catch (e) { items = []; }

    var itemsHTML = items.map(function (item) {
        var name = item.name || item.product_name || 'Produit #' + (item.product_id || '');
        var color = item.color || item.selectedColor || '—';
        var size = item.size || item.selectedSize || '—';
        var tg = tailleGroupForSize(size);
        var sizeDisplay = size + (tg ? ' (' + tg + ')' : '');
        var qty = item.quantity || item.qty || 1;
        var price = Number(item.price || 0);
        var sub = price * qty;
        return '<tr>' +
            '<td>' + esc(name) + '</td>' +
            '<td>' + esc(color) + '</td>' +
            '<td>' + esc(sizeDisplay) + '</td>' +
            '<td style="text-align:center;">' + qty + '</td>' +
            '<td style="text-align:right;">' + formatPriceDA(price) + '</td>' +
            '<td style="text-align:right;">' + formatPriceDA(sub) + '</td>' +
            '</tr>';
    }).join('');

    var dateStr = order.created_at ? new Date(order.created_at).toLocaleDateString('fr-DZ', {
        day: 'numeric', month: 'long', year: 'numeric'
    }) : '—';

    return '<div class="invoice">' +
        '<div class="invoice-header">' +
            '<img src="' + esc(logo) + '" alt="Logo" class="invoice-logo" onerror="this.style.display=\'none\'">' +
            '<div>' +
                '<h1>' + esc(storeName) + '</h1>' +
                '<p class="invoice-title">FACTURE</p>' +
            '</div>' +
        '</div>' +
        '<div class="invoice-meta">' +
            '<div>' +
                '<strong>Commande :</strong> ' + esc(order.order_number || '#' + order.id) + '<br>' +
                '<strong>Date :</strong> ' + dateStr + '<br>' +
                '<strong>Statut :</strong> ' + esc(order.status || '') + '<br>' +
                '<strong>Paiement :</strong> ' + esc(order.payment_method || '—') +
            '</div>' +
            '<div>' +
                '<strong>Client :</strong> ' + esc(order.customer_name || '—') + '<br>' +
                '<strong>Téléphone :</strong> ' + esc(order.customer_phone || '—') + '<br>' +
                '<strong>Wilaya :</strong> ' + esc(order.wilaya || '—') + '<br>' +
                '<strong>Commune :</strong> ' + esc(order.commune || '—') +
            '</div>' +
        '</div>' +
        '<table class="invoice-items">' +
            '<thead><tr>' +
                '<th>Produit</th>' +
                '<th>Couleur</th>' +
                '<th>Taille</th>' +
                '<th style="text-align:center;">Qté</th>' +
                '<th style="text-align:right;">Prix unit.</th>' +
                '<th style="text-align:right;">Total</th>' +
            '</tr></thead>' +
            '<tbody>' + itemsHTML + '</tbody>' +
        '</table>' +
        '<div class="invoice-total">' +
            '<strong>Total :</strong> ' + formatPriceDA(order.total) +
        '</div>' +
        '<div class="invoice-footer">' +
            '<p>Merci de votre confiance !</p>' +
        '</div>' +
    '</div>';
}

window.printOrder = function (order) {
    var invoiceHTML = buildInvoiceHTML(order);
    var printContainer = document.getElementById('print-invoice');
    if (!printContainer) return;
    printContainer.innerHTML = invoiceHTML;
    window.print();
    printContainer.innerHTML = '';
};

/* ── Products ── */
var productFilterState = { search: '', category: '' };

async function initProducts() {
    var url = '/products';
    var params = [];
    if (productFilterState.search) params.push('search=' + encodeURIComponent(productFilterState.search));
    if (productFilterState.category) params.push('category=' + encodeURIComponent(productFilterState.category));
    if (params.length) url += '?' + params.join('&');
    const products = await api('GET', url);
    if (!products) return;
    const tbody = document.querySelector('#products-table tbody');
    if (!tbody) return;
    tbody.innerHTML = products.map(p => `
        <tr>
            <td><div class="product-cell"><img src="/${esc(p.image)}" alt="" onerror="this.src='https://placehold.co/40x40/e2e8f0/718096?text=P'"><div class="info"><div class="name">${esc(p.name)}</div></div></div></td>
            <td>SKU-${p.id}</td>
            <td>${esc(p.category_name||'')}</td>
            <td>${formatPriceDA(p.price)}</td>
            <td>${badge(p.status||'active')}</td>
            <td style="text-align:right;">
                <button class="btn btn-outline btn-sm" onclick="openImageManager(${p.id})" title="Manage Images"><i class="fas fa-images"></i></button>
                <button class="btn btn-outline btn-sm" onclick="editProduct(${p.id})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-outline btn-sm" onclick="archiveProduct(${p.id})" title="Archive"><i class="fas fa-archive"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
    document.querySelector('.page-header p').textContent = `Manage your product catalog (${products.length} products)`;
}

function openAddProduct() {
    // Reset form
    document.getElementById('product-form').reset();
    document.getElementById('pm-id').value = '';
    productVariants = [];
    _lastCategorySizeSystem = 'standard';
    renderVariants();
    goToStep(1);
    document.getElementById('pm-modal-title').textContent = 'Nouveau Produit';
    // Reset ribbon
    var noneRibbon = document.querySelector('input[name="pm_ribbon"][value=""]');
    if (noneRibbon) noneRibbon.checked = true;
    document.getElementById('product-modal').classList.add('active');
}

window.editProduct = async function(id) {
    const p = await api('GET', `/products/${id}`);
    if (!p) return;
    const modal = document.getElementById('product-modal');
    document.getElementById('pm-modal-title').textContent = 'Modifier le produit';
    document.getElementById('pm-id').value = p.id;
    document.getElementById('pm-name').value = p.name || '';
    document.getElementById('pm-price').value = p.price || 0;
    document.getElementById('pm-sale-price').value = p.sale_price || '';
    document.getElementById('pm-brand').value = p.brand || '';
    document.getElementById('pm-desc').value = p.description || '';
    document.getElementById('pm-status').value = p.status || 'active';
    const feat = document.getElementById('pm-featured');
    if (feat) feat.checked = !!p.featured;
    const newArr = document.getElementById('pm-new-arrival');
    if (newArr) newArr.checked = !!p.new_arrival;
    const catSelect = document.getElementById('pm-category');
    if (catSelect) { catSelect.value = p.category_name || ''; }
    _lastCategorySizeSystem = getCurrentCategorySizeSystem();

    // Set ribbon based on badge column, fall back to new_arrival flag
    var ribbonVal = p.badge || (p.new_arrival ? 'Nouveau' : '');
    var ribbonRadio = document.querySelector('input[name="pm_ribbon"][value="' + ribbonVal.replace(/"/g, '\\"') + '"]');
    if (ribbonRadio) ribbonRadio.checked = true;
    else {
        var noneRadio = document.querySelector('input[name="pm_ribbon"][value=""]');
        if (noneRadio) noneRadio.checked = true;
    }

    // Load variants (try advanced format first)
    if (p.variants && p.variants.length > 0 && ('images' in p.variants[0] || 'sizes' in p.variants[0] || 'sku' in p.variants[0])) {
        productVariants = p.variants.map(function(v) {
            return {
                color_name: v.color_name || '',
                color_hex: v.color_hex || '',
                sku: v.sku || '',
                images: v.images || [],
                sizes: (v.sizes || []).map(function(s) {
                    return { size: s.size || s, stock: s.stock || 0, sku: s.sku || '' };
                })
            };
        });
    } else if (p.colors && p.colors.length > 0) {
        // Legacy: convert colors + sizes + variants to new format
        var allSizes = p.sizes || [];
        productVariants = (p.colors || []).map(function(c, ci) {
            var cname = c.name || c;
            var chex = c.hex || '';
            var sizes = allSizes.map(function(s) {
                var sname = s.size || s;
                var stock = 0;
                if (p.variants) {
                    for (var vi = 0; vi < p.variants.length; vi++) {
                        if (p.variants[vi].color_name === cname && p.variants[vi].size_name === sname) {
                            stock = p.variants[vi].stock;
                            break;
                        }
                    }
                }
                return { size: sname, stock: stock, sku: '' };
            });
            return { color_name: cname, color_hex: chex, sku: '', images: [], sizes: sizes };
        });
    } else {
        productVariants = [];
    }

    renderVariants();
    goToStep(1);
    modal.classList.add('active');
};

window.archiveProduct = async function(id) {
    if (!confirm('Archive this product? It will be hidden from the store.')) return;
    await api('PUT', `/products/${id}`, { status: 'hidden' });
    initProducts();
};

window.deleteProduct = async function(id) {
    if (!confirm('Delete this product permanently?')) return;
    await api('DELETE', `/products/${id}`);
    initProducts();
};

/* ── Step Navigation ── */
window.pmNextStep = function(current) {
    var next = current + 1;
    if (current === 1) {
        // Validate step 1
        var name = document.getElementById('pm-name').value.trim();
        var cat = document.getElementById('pm-category').value;
        if (!name) { alert('Veuillez saisir le nom du produit.'); document.getElementById('pm-name').focus(); return; }
        if (!cat) { alert('Veuillez sélectionner une catégorie.'); document.getElementById('pm-category').focus(); return; }
    }
    if (current === 2) {
        var price = parseFloat(document.getElementById('pm-price').value);
        if (!price || price <= 0) { alert('Veuillez saisir un prix valide.'); document.getElementById('pm-price').focus(); return; }
    }
    goToStep(next);
};

window.pmPrevStep = function(current) {
    goToStep(current - 1);
};

function goToStep(step) {
    document.querySelectorAll('.pm-step').forEach(function(el) {
        var s = parseInt(el.getAttribute('data-step'));
        el.classList.toggle('active', s === step);
        el.classList.toggle('done', s < step);
    });
    document.querySelectorAll('.pm-step-content').forEach(function(el) {
        el.classList.toggle('active', parseInt(el.getAttribute('data-step')) === step);
    });
}

/* ── Variants State ── */
var productVariants = [];  // [{color_name, color_hex, sku, images: [], sizes: [{size, stock}]}]

/* ── renderVariants: uses data-* attributes, no inline handlers ── */
function renderVariants() {
    var container = document.getElementById('variants-container');
    if (!container) return;

    try {
        if (!window.SIZE_GROUPS) {
            container.innerHTML = '<div class="pm-card-section" style="background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;padding:14px 18px;color:#e53e3e;font-size:0.85rem;">' +
                '<strong>Erreur :</strong> Le fichier sizes.js n\'a pas pu être chargé. Vérifiez la connexion réseau.</div>';
            return;
        }

        var sizeSystem = getCurrentCategorySizeSystem();

        if (productVariants.length === 0) {
            container.innerHTML = '<div class="pm-empty-variants"><i class="fas fa-palette"></i><p>Aucune couleur ajoutée.</p></div>';
            _appendAddColorForm(container, sizeSystem);
            return;
        }

        var html = productVariants.map(function(v, i) {
            /* ── Images section ── */
            var imagesHtml = (v.images || []).map(function(img, j) {
                var leftBtn = j > 0 ? '<button type="button" class="pm-card-img-reorder pm-card-img-reorder-left" data-action="move-image" data-variant="' + i + '" data-image="' + j + '" data-dir="-1" title="Gauche">&lsaquo;</button>' : '';
                var rightBtn = j < v.images.length - 1 ? '<button type="button" class="pm-card-img-reorder pm-card-img-reorder-right" data-action="move-image" data-variant="' + i + '" data-image="' + j + '" data-dir="1" title="Droite">&rsaquo;</button>' : '';
                return '<div class="pm-card-img-thumb">' +
                    '<img src="/' + esc(img) + '" loading="lazy" onerror="this.src=\'https://placehold.co/72x72/e2e8f0/718096?text=?\';this.style.border=\'2px solid #f56565\'">' +
                    leftBtn + rightBtn +
                    '<button type="button" class="pm-card-img-del" data-action="remove-image" data-variant="' + i + '" data-image="' + j + '">&times;</button></div>';
            }).join('');
            imagesHtml += '<label class="pm-card-img-add" title="Ajouter des images"><input type="file" accept="image/jpeg,image/png,image/webp" multiple style="display:none" data-action="upload-images" data-variant="' + i + '"><i class="fas fa-plus"></i></label>';

            /* ── Size section (grouped_taille vs standard) ── */
            var sizeHtml = '';
            if (sizeSystem === 'grouped_taille') {
                sizeHtml = '<div class="pm-taille-group-cards">';
                (window.SIZE_GROUPS || []).forEach(function(g) {
                    var hasGroup = v.sizes.some(function(s) { return s.size === g.label; });
                    var groupSize = v.sizes.find(function(s) { return s.size === g.label; });
                    var infoText = g.sizes.join(' \u00b7 ');
                    var stockVal = groupSize ? (groupSize.stock || 0) : 0;
                    var skuVal = groupSize ? (groupSize.sku || '') : '';
                    var cardClass = 'pm-taille-group-card' + (hasGroup ? ' active' : '');
                    sizeHtml += '<div class="' + cardClass + '">' +
                        '<label class="pm-taille-group-check">' +
                            '<input type="checkbox" data-action="taille-group" data-variant="' + i + '" data-group="' + g.label + '"' + (hasGroup ? ' checked' : '') + '>' +
                            '<span class="pm-taille-group-name">' + g.label + '</span>' +
                            '<span class="pm-taille-group-info">' + infoText + '</span>' +
                        '</label>' +
                        (hasGroup ? '<div class="pm-taille-group-body">' +
                            '<label>Stock</label>' +
                            '<input type="number" min="0" value="' + stockVal + '" data-action="group-stock" data-variant="' + i + '" data-group="' + g.label + '">' +
                            '<label>SKU</label>' +
                            '<input type="text" value="' + esc(skuVal) + '" data-action="group-sku" data-variant="' + i + '" data-group="' + g.label + '" placeholder="SKU">' +
                        '</div>' : '') +
                    '</div>';
                });
                sizeHtml += '</div>';
            } else {
                /* Standard sizes: chips + stock table */
                var sizeRows = (v.sizes || []).map(function(s, j) {
                    return '<tr>' +
                        '<td>' + esc(s.size) + '</td>' +
                        '<td><input type="number" min="0" value="' + (s.stock || 0) + '" data-action="size-stock" data-variant="' + i + '" data-size="' + j + '"></td>' +
                        '<td><input type="text" value="' + esc(s.sku || '') + '" placeholder="SKU" data-action="size-sku" data-variant="' + i + '" data-size="' + j + '"></td>' +
                        '<td><button type="button" class="pm-size-remove" data-action="remove-size" data-variant="' + i + '" data-size="' + j + '">&times;</button></td>' +
                    '</tr>';
                }).join('');
                sizeHtml = '<div class="pm-taille-sizes" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">' +
                    (window.STANDARD_SIZES || []).map(function(sizeName) {
                        var active = variantHasSize(i, sizeName);
                        return '<label class="pm-taille-size-chip' + (active ? ' active' : '') + '">' +
                            '<input type="checkbox" data-action="standard-size" data-variant="' + i + '" data-size-name="' + sizeName + '"' + (active ? ' checked' : '') + '>' +
                            '<span>' + sizeName + '</span>' +
                        '</label>';
                    }).join('') +
                '</div>' +
                '<div style="overflow-x:auto;">' +
                    '<table class="pm-size-table">' +
                        '<thead><tr><th>Taille</th><th>Stock</th><th>SKU</th><th style="width:30px;"></th></tr></thead>' +
                        '<tbody>' + (sizeRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:12px;font-size:0.8rem;">Aucune taille sélectionnée</td></tr>') + '</tbody>' +
                    '</table>' +
                '</div>' +
                '<div class="pm-add-size-row">' +
                    '<input type="text" placeholder="Taille" data-action="new-size-name" data-variant="' + i + '">' +
                    '<input type="number" min="0" value="0" placeholder="Stock" data-action="new-size-stock" data-variant="' + i + '">' +
                    '<input type="text" placeholder="SKU" data-action="new-size-sku" data-variant="' + i + '">' +
                    '<button type="button" class="btn btn-outline btn-sm" data-action="add-size" data-variant="' + i + '">+ Ajouter</button>' +
                '</div>';
            }

            /* ── Assemble full card ── */
            return '<div class="pm-variant-card">' +
                /* Header: color dot + name + SKU + remove */
                '<div class="pm-card-header">' +
                    '<div class="pm-card-color-swatch" style="background:' + (v.color_hex || '#ccc') + ';">' +
                        '<input type="color" value="' + (v.color_hex || '#000000') + '" data-action="variant-hex" data-variant="' + i + '">' +
                    '</div>' +
                    '<input type="text" class="pm-card-name-input" value="' + esc(v.color_name) + '" data-action="variant-name" data-variant="' + i + '" placeholder="Nom de la couleur">' +
                    '<span class="pm-card-sku-label">SKU</span>' +
                    '<input type="text" class="pm-card-sku-input" value="' + esc(v.sku || '') + '" data-action="variant-sku" data-variant="' + i + '" placeholder="SKU couleur">' +
                    '<button type="button" class="pm-card-remove-btn" data-action="remove-variant" data-variant="' + i + '"><i class="fas fa-trash-alt"></i> Supprimer</button>' +
                '</div>' +
                /* Section: Images */
                '<div class="pm-card-section">' +
                    '<div class="pm-card-section-title"><i class="fas fa-image"></i> Images</div>' +
                    '<div class="pm-card-images">' + imagesHtml + '</div>' +
                '</div>' +
                /* Section: Sizes */
                '<div class="pm-card-section">' +
                    '<div class="pm-card-section-title"><i class="fas fa-ruler-vertical"></i> ' + (sizeSystem === 'grouped_taille' ? 'Groupes de tailles' : 'Tailles') + '</div>' +
                    sizeHtml +
                '</div>' +
            '</div>';
        }).join('');

        container.innerHTML = html;
        _appendAddColorForm(container, sizeSystem);
    } catch (err) {
        container.innerHTML = '<div class="pm-card-section" style="background:#fff5f5;border:1px solid #e53e3e;border-radius:6px;padding:14px 18px;color:#e53e3e;font-size:0.85rem;">' +
            '<strong>Erreur lors du rendu :</strong> ' + esc(String(err.message || err)) +
            '<br><small>Rechargez la page ou contactez le développeur.</small></div>';
        console.error('[variants] renderVariants failed:', err);
    }
}

/* ── Append the inline "add color" form after all variant cards ── */
function _appendAddColorForm(container, sizeSystem) {
    var form = document.createElement('div');
    form.className = 'pm-add-color-form';
    form.innerHTML = '<i class="fas fa-palette" style="color:var(--text-muted);font-size:1.1rem;"></i>' +
        '<input type="text" class="pm-add-color-name" placeholder="Nom de la couleur (ex. Noir, Blanc, Rose)">' +
        '<input type="color" class="pm-add-color-hex" value="#cccccc">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="add-color-submit"><i class="fas fa-plus"></i> Ajouter</button>';
    container.appendChild(form);
}

/* ── Event Delegation: single listener on #variants-container ── */
function _handleVariantAction(action, el) {
    var vi = parseInt(el.getAttribute('data-variant'));
    var v = productVariants[vi];

    switch (action) {
        case 'remove-variant':
            productVariants.splice(vi, 1);
            renderVariants();
            break;

        case 'variant-name':
            if (v) {
                v.color_name = el.value;
            }
            break;

        case 'variant-hex':
            if (v) {
                v.color_hex = el.value;
                /* Update the color swatch preview without full re-render */
                var card = el.closest('.pm-variant-card');
                if (card) {
                    var swatch = card.querySelector('.pm-card-color-swatch');
                    if (swatch) swatch.style.background = el.value;
                }
            }
            break;

        case 'variant-sku':
            if (v) v.sku = el.value;
            break;

        case 'remove-image':
            if (v) { v.images.splice(parseInt(el.getAttribute('data-image')), 1); renderVariants(); }
            break;

        case 'move-image':
            if (v) {
                var ii = parseInt(el.getAttribute('data-image'));
                var dir = parseInt(el.getAttribute('data-dir'));
                var ni = ii + dir;
                if (ni >= 0 && ni < v.images.length) {
                    var tmp = v.images[ii]; v.images[ii] = v.images[ni]; v.images[ni] = tmp;
                    renderVariants();
                }
            }
            break;

        case 'remove-size':
            if (v) { v.sizes.splice(parseInt(el.getAttribute('data-size')), 1); renderVariants(); }
            break;

        case 'size-stock':
            if (v && v.sizes[parseInt(el.getAttribute('data-size'))])
                v.sizes[parseInt(el.getAttribute('data-size'))].stock = parseInt(el.value) || 0;
            break;

        case 'size-sku':
            if (v && v.sizes[parseInt(el.getAttribute('data-size'))])
                v.sizes[parseInt(el.getAttribute('data-size'))].sku = el.value || '';
            break;

        case 'taille-group':
            _handleTailleGroup(vi, el.getAttribute('data-group'), el.checked);
            break;

        case 'taille-size':
            _handleTailleSize(vi, el.getAttribute('data-size-num'), el.checked);
            break;

        case 'standard-size':
            _handleStandardSize(vi, el.getAttribute('data-size-name'), el.checked);
            break;

        case 'group-stock':
            if (v) {
                var gLabel = el.getAttribute('data-group');
                for (var gi = 0; gi < v.sizes.length; gi++) {
                    if (v.sizes[gi].size === gLabel) { v.sizes[gi].stock = parseInt(el.value) || 0; break; }
                }
            }
            break;

        case 'group-sku':
            if (v) {
                var gLabel = el.getAttribute('data-group');
                for (var gi = 0; gi < v.sizes.length; gi++) {
                    if (v.sizes[gi].size === gLabel) { v.sizes[gi].sku = el.value || ''; break; }
                }
            }
            break;

        case 'add-size':
            _handleAddSize(vi);
            break;
    }
}

function _handleVariantChange(action, el) {
    if (action === 'upload-images') {
        var vi = parseInt(el.getAttribute('data-variant'));
        var files = el.files;
        if (!files || !files.length) return;
        var v = productVariants[vi];
        if (!v) return;
        (async function() {
            for (var fi = 0; fi < files.length; fi++) {
                var f = files[fi];
                var ext = '.' + f.name.split('.').pop().toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.webp'].indexOf(ext) === -1) { alert(f.name + ': unsupported format'); continue; }
                if (f.size > 10 * 1024 * 1024) { alert(f.name + ': too large (max 10MB)'); continue; }
                var fd = new FormData();
                fd.append('images', f);
                try {
                    var res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
                    var data = await res.json();
                    if (data.paths && data.paths[0]) {
                        v.images.push(data.paths[0]);
                    } else {
                        alert(f.name + ': upload failed (no path returned)');
                    }
                } catch (err) {
                    alert(f.name + ': upload error — ' + (err.message || err));
                    console.error('[variant-upload]', err);
                }
            }
            el.value = '';
            /* Only re-render if files were actually added */
            if (v.images.length > 0) renderVariants();
        })();
        return;
    }
    /* For input changes, use same action router */
    _handleVariantAction(action, el);
}

function _setupVariantDelegation() {
    var container = document.getElementById('variants-container');
    if (!container || container._delegated) return;
    container._delegated = true;

    container.addEventListener('click', function(e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        var action = el.getAttribute('data-action');

        if (action === 'add-color-submit') {
            e.preventDefault();
            _handleInlineAddColor(container);
            return;
        }

        var clickActions = ['add-size', 'remove-variant', 'remove-image', 'move-image', 'remove-size'];
        if (clickActions.indexOf(action) !== -1) {
            e.preventDefault();
            _handleVariantAction(action, el);
        }
    });

    container.addEventListener('change', function(e) {
        var el = e.target.closest('[data-action]');
        if (!el) return;
        var action = el.getAttribute('data-action');
        _handleVariantChange(action, el);
    });

    container.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            var el = e.target.closest('.pm-add-color-form');
            if (el) {
                e.preventDefault();
                _handleInlineAddColor(container);
            }
        }
    });
}

/* ── Inline add-color form handler ── */
function _handleInlineAddColor(container) {
    var form = container.querySelector('.pm-add-color-form');
    if (!form) return;
    var nameInput = form.querySelector('.pm-add-color-name');
    var hexInput = form.querySelector('.pm-add-color-hex');
    var name = (nameInput ? nameInput.value : '').trim();
    if (!name) { if (nameInput) nameInput.focus(); return; }
    var hex = hexInput ? hexInput.value : '#cccccc';
    productVariants.push({ color_name: name, color_hex: hex, sku: '', images: [], sizes: [] });
    renderVariants();
    /* Focus the new card's name input */
    var newCards = container.querySelectorAll('.pm-variant-card');
    var lastCard = newCards[newCards.length - 1];
    if (lastCard) {
        var nameField = lastCard.querySelector('.pm-card-name-input');
        if (nameField) nameField.focus();
        lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    _showPmToast('Couleur "' + name + '" ajout\u00e9e', 'success');
}

/* ── Legacy addVariant (kept for backward compat, but now unused) ── */
function addVariant() {
    /* The inline form in renderVariants() handles this now */
    var container = document.getElementById('variants-container');
    if (container) {
        var form = container.querySelector('.pm-add-color-name');
        if (form) form.focus();
    }
}

/* ── PM Toast notification ── */
function _showPmToast(msg, type) {
    var existing = document.querySelector('.pm-toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.className = 'pm-toast ' + (type || '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function() { t.classList.add('show'); });
    setTimeout(function() {
        t.classList.remove('show');
        setTimeout(function() { t.remove(); }, 400);
    }, 2500);
}

function _handleAddSize(varIdx) {
    var v = productVariants[varIdx];
    if (!v) return;
    /* Scope to THIS variant's card, not the first one in the DOM */
    var container = document.getElementById('variants-container');
    var cards = container ? container.querySelectorAll('.pm-variant-card') : [];
    var card = cards[varIdx] || null;
    if (!card) return;
    var row = card.querySelector('.pm-add-size-row');
    if (!row) return;
    var inputs = row.querySelectorAll('input[data-variant="' + varIdx + '"]');
    var nameInput, stockInput, skuInput;
    inputs.forEach(function(inp) {
        var act = inp.getAttribute('data-action');
        if (act === 'new-size-name') nameInput = inp;
        if (act === 'new-size-stock') stockInput = inp;
        if (act === 'new-size-sku') skuInput = inp;
    });
    var name = (nameInput ? nameInput.value : '').trim();
    if (!name) { alert('Veuillez saisir un nom de taille.'); return; }
    var stock = parseInt(stockInput ? stockInput.value : 0) || 0;
    var sku = (skuInput ? skuInput.value : '').trim();
    v.sizes.push({ size: name, stock: stock, sku: sku });
    renderVariants();
}

function _handleTailleGroup(varIdx, groupLabel, checked) {
    var v = productVariants[varIdx];
    if (!v) return;
    v._groupState = v._groupState || {};
    v._groupState[groupLabel] = checked;
    if (checked) {
        var found = false;
        for (var j = 0; j < v.sizes.length; j++) {
            if (v.sizes[j].size === groupLabel) { found = true; break; }
        }
        if (!found) v.sizes.push({ size: groupLabel, stock: 0, sku: '' });
    } else {
        for (var j = v.sizes.length - 1; j >= 0; j--) {
            if (v.sizes[j].size === groupLabel) v.sizes.splice(j, 1);
        }
    }
    renderVariants();
}

function _handleTailleSize(varIdx, sizeName, checked) {
    // No-op: individual sizes are not tracked for grouped_taille products
}

function _handleStandardSize(varIdx, sizeName, checked) {
    var v = productVariants[varIdx];
    if (!v) return;
    var sn = String(sizeName);
    if (checked) {
        var found = false;
        for (var i = 0; i < v.sizes.length; i++) {
            if (String(v.sizes[i].size) === sn) { found = true; break; }
        }
        if (!found) v.sizes.push({ size: sn, stock: 0, sku: '' });
    } else {
        for (var i = v.sizes.length - 1; i >= 0; i--) {
            if (String(v.sizes[i].size) === sn) v.sizes.splice(i, 1);
        }
    }
    renderVariants();
}

/* Backward compat: keep window.* references for any code that still calls them directly */
window.removeVariant = function(index) { productVariants.splice(index, 1); renderVariants(); };
window.updateVariantName = function(index, val) { if (productVariants[index]) productVariants[index].color_name = val; };
window.updateVariantHex = function(index, val) { if (productVariants[index]) { productVariants[index].color_hex = val; renderVariants(); } };
window.updateVariantSku = function(index, val) { if (productVariants[index]) productVariants[index].sku = val; };
window.addVariantSize = function(varIdx) { _handleAddSize(varIdx); };
window.removeVariantSize = function(varIdx, sizeIdx) { var v = productVariants[varIdx]; if (v) { v.sizes.splice(sizeIdx, 1); renderVariants(); } };
window.updateVariantSizeStock = function(varIdx, sizeIdx, val) { var v = productVariants[varIdx]; if (v && v.sizes[sizeIdx]) v.sizes[sizeIdx].stock = parseInt(val) || 0; };
window.updateVariantSizeSku = function(varIdx, sizeIdx, val) { var v = productVariants[varIdx]; if (v && v.sizes[sizeIdx]) v.sizes[sizeIdx].sku = val || ''; };
window.removeVariantImage = function(varIdx, imgIdx) { var v = productVariants[varIdx]; if (v) { v.images.splice(imgIdx, 1); renderVariants(); } };
window.moveVariantImage = function(varIdx, imgIdx, dir) { var v = productVariants[varIdx]; if (!v) return; var ni = imgIdx + dir; if (ni >= 0 && ni < v.images.length) { var t = v.images[imgIdx]; v.images[imgIdx] = v.images[ni]; v.images[ni] = t; renderVariants(); } };

/* ── Taille Group Helpers ── */

function variantHasSize(varIdx, sizeName) {
    var v = productVariants[varIdx];
    if (!v) return false;
    var sn = String(sizeName);
    for (var i = 0; i < v.sizes.length; i++) {
        if (String(v.sizes[i].size) === sn) return true;
    }
    return false;
}

function collectVariantsForSubmit() {
    return productVariants.map(function(v) {
        return {
            color_name: v.color_name,
            color_hex: v.color_hex,
            sku: v.sku || '',
            images: v.images || [],
            sizes: (v.sizes || []).map(function(s) { return { size: s.size, stock: s.stock, sku: s.sku || '' }; })
        };
    });
}

/* ── Categories cache with size_system info ── */
var _categoriesCache = [];

function getCurrentCategorySizeSystem() {
    var sel = document.getElementById('pm-category');
    if (!sel) return 'standard';
    var catName = sel.value;
    for (var i = 0; i < _categoriesCache.length; i++) {
        if (_categoriesCache[i].name === catName) return _categoriesCache[i].size_system || 'standard';
    }
    return 'standard';
}

async function loadCategories() {
    var cats = await api('GET', '/categories');
    if (!cats) return;
    _categoriesCache = cats;
    var sel = document.getElementById('pm-category');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select category</option>';
    cats.forEach(function(c) {
        var opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        sel.appendChild(opt);
    });
}

function _onCategoryChange() {
    var newSystem = getCurrentCategorySizeSystem();
    var oldSystem = _lastCategorySizeSystem;
    if (newSystem === oldSystem) return;
    _lastCategorySizeSystem = newSystem;
    var hasGroupedSizes = false;
    var hasStandardSizes = false;
    for (var i = 0; i < productVariants.length; i++) {
        var v = productVariants[i];
        for (var j = 0; j < (v.sizes || []).length; j++) {
            var sn = v.sizes[j].size;
            if (window.getSizeGroup(sn)) hasGroupedSizes = true;
            if ((window.STANDARD_SIZES || []).indexOf(sn) !== -1) hasStandardSizes = true;
        }
    }
    var willDiscard = (newSystem === 'standard' && hasGroupedSizes) || (newSystem === 'grouped_taille' && hasStandardSizes);
    if (willDiscard) {
        if (!confirm('Le changement de catégorie entraînera un système de tailles différent.\nLes tailles existantes qui ne correspondent pas au nouveau système seront conservées mais ne seront plus visibles dans les raccourcis.\n\nVoulez-vous continuer ?')) {
            var sel = document.getElementById('pm-category');
            if (sel) {
                for (var k = 0; k < _categoriesCache.length; k++) {
                    if (_categoriesCache[k].size_system === oldSystem) { sel.value = _categoriesCache[k].name; break; }
                }
            }
            _lastCategorySizeSystem = oldSystem;
            return;
        }
    }
    renderVariants();
}
var _lastCategorySizeSystem = 'standard';

document.addEventListener('DOMContentLoaded', function () {
    loadCategories();

    var catSelect = document.getElementById('pm-category');
    if (catSelect) {
        catSelect.addEventListener('change', _onCategoryChange);
    }

    const form = document.getElementById('product-form');
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            // Validate variants
            var variants = collectVariantsForSubmit();
            if (variants.length === 0) {
                if (!confirm('Aucune couleur ajoutée. Voulez-vous vraiment enregistrer sans variantes ?')) return;
            }

            var id = document.getElementById('pm-id').value;

            // Collect ribbon value
            var ribbonEl = document.querySelector('input[name="pm_ribbon"]:checked');
            var ribbon = ribbonEl ? ribbonEl.value : '';

            const data = {
                name: document.getElementById('pm-name').value,
                price: parseFloat(document.getElementById('pm-price').value) || 0,
                sale_price: parseFloat(document.getElementById('pm-sale-price').value) || null,
                stock: 0,
                brand: document.getElementById('pm-brand').value,
                description: document.getElementById('pm-desc').value,
                category_name: document.getElementById('pm-category').value,
                status: document.getElementById('pm-status').value,
                featured: document.getElementById('pm-featured')?.checked ? 1 : 0,
                new_arrival: document.getElementById('pm-new-arrival')?.checked ? 1 : 0,
                variants: variants,
            };

            // Add ribbon to flags
            if (ribbon === 'Nouveau') data.new_arrival = 1;
            if (ribbon === 'Promotion' && !data.sale_price) {
                alert('Veuillez définir un prix promotionnel pour le badge "Promotion".');
                return;
            }
            data.badge = ribbon || null;

            // Compute aggregate sizes and colors for backward compat
            var allSizes = [];
            var allColors = [];
            variants.forEach(function(v) {
                allColors.push({ name: v.color_name, hex: v.color_hex });
                (v.sizes || []).forEach(function(s) {
                    if (allSizes.indexOf(s.size) === -1) allSizes.push(s.size);
                });
            });
            data.sizes = allSizes;
            data.colors = allColors;

            // Disable button to prevent double-submit
            var saveBtn = document.getElementById('pm-save-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Enregistrement...'; }

            try {
                if (id) {
                    await api('PUT', `/products/${id}`, data);
                } else {
                    await api('POST', '/products', data);
                }
                document.getElementById('product-modal').classList.remove('active');
                initProducts();
                // Reset form
                form.reset();
                productVariants = [];
                goToStep(1);
                document.getElementById('pm-id').value = '';
                document.getElementById('pm-modal-title').textContent = 'Nouveau Produit';
                showToast('✓ Produit enregistré avec succès !');
            } catch (e) {
                alert('Erreur lors de l\'enregistrement du produit.');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Enregistrer le produit'; }
            }
        });
    }

    // Setup event delegation for variant actions
    _setupVariantDelegation();

    // Reset form on modal close
    var productModal = document.getElementById('product-modal');
    if (productModal) {
        productModal.querySelectorAll('.modal-close').forEach(function(btn) {
            btn.addEventListener('click', function() {
                productModal.classList.remove('active');
                productVariants = [];
                renderVariants();
                document.getElementById('product-form').reset();
                goToStep(1);
                document.getElementById('pm-id').value = '';
                document.getElementById('pm-modal-title').textContent = 'Nouveau Produit';
                var sb = document.getElementById('pm-save-btn');
                if (sb) { sb.disabled = false; sb.innerHTML = '<i class="fas fa-save"></i> Enregistrer le produit'; }
            });
        });
        productModal.addEventListener('click', function(e) {
            if (e.target === productModal) {
                productModal.classList.remove('active');
                productVariants = [];
                renderVariants();
                document.getElementById('product-form').reset();
                goToStep(1);
                document.getElementById('pm-id').value = '';
                document.getElementById('pm-modal-title').textContent = 'Nouveau Produit';
                var sb = document.getElementById('pm-save-btn');
                if (sb) { sb.disabled = false; sb.innerHTML = '<i class="fas fa-save"></i> Enregistrer le produit'; }
            }
        });
    }

});

/* ── Categories ── */
async function initCategories() {
    const cats = await api('GET', '/categories');
    if (!cats) return;
    const tbody = document.querySelector('#categories-table tbody');
    if (!tbody) return;
    const countEl = document.getElementById('cat-count');
    if (countEl) countEl.textContent = cats.length + ' catégorie' + (cats.length > 1 ? 's' : '');
    tbody.innerHTML = cats.map(c => {
        var isProtected = c.size_system === 'grouped_taille';
        var deleteBtn = isProtected
            ? '<button class="btn btn-outline btn-sm" disabled title="Catégorie protégée — ne peut pas être supprimée" style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-trash"></i></button>'
            : '<button class="btn btn-danger btn-sm" onclick="deleteCategory(' + c.id + ')"><i class="fas fa-trash"></i></button>';
        var sizeSystemBadge = isProtected ? ' <span class="badge" style="background:var(--primary);color:#fff;font-size:0.65rem;vertical-align:middle;">Taille groupée</span>' : '';
        return '<tr>' +
            '<td><strong>' + esc(c.name) + '</strong>' + sizeSystemBadge + '</td>' +
            '<td>' + esc(c.slug) + '</td>' +
            '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(c.description || '') + '</td>' +
            '<td>' + (c.product_count || 0) + '</td>' +
            '<td>' + badge(c.status) + '</td>' +
            '<td style="text-align:right;">' +
            '<button class="btn btn-outline btn-sm" onclick="editCategory(' + c.id + ')"><i class="fas fa-edit"></i></button> ' +
            deleteBtn +
            '</td></tr>';
    }).join('');
}

window.editCategory = async function (id) {
    const c = await api('GET', '/categories/' + id);
    if (!c) return;
    document.getElementById('cat-id').value = c.id;
    document.getElementById('cat-modal-title').textContent = 'Edit Category';
    document.getElementById('cat-name').value = c.name || '';
    document.getElementById('cat-slug').value = c.slug || '';
    document.getElementById('cat-desc').value = c.description || '';
    document.getElementById('cat-status').value = c.status || 'active';
    document.getElementById('cat-size-system').value = c.size_system || 'standard';
    document.getElementById('category-modal').classList.add('active');
};

window.deleteCategory = async function (id) {
    if (!confirm('Delete this category? Products in this category will be uncategorized.')) return;
    await api('DELETE', '/categories/' + id);
    initCategories();
};

/* Category form */
document.addEventListener('DOMContentLoaded', function () {
    var catForm = document.getElementById('category-form');
    if (!catForm) return;

    /* Add button opens blank form */
    var addBtn = document.getElementById('add-category-btn');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            document.getElementById('cat-id').value = '';
            document.getElementById('cat-modal-title').textContent = 'Add Category';
            catForm.reset();
            document.getElementById('category-modal').classList.add('active');
        });
    }

    /* Auto-slug from name */
    var catNameInput = document.getElementById('cat-name');
    var catSlugInput = document.getElementById('cat-slug');
    if (catNameInput && catSlugInput) {
        catNameInput.addEventListener('input', function () {
            if (!catSlugInput.dataset.edited) {
                catSlugInput.value = this.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '';
            }
        });
        catSlugInput.addEventListener('input', function () {
            catSlugInput.dataset.edited = this.value ? '1' : '';
        });
    }

    /* Submit */
    catForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var id = document.getElementById('cat-id').value;
        var data = {
            name: document.getElementById('cat-name').value,
            slug: document.getElementById('cat-slug').value,
            description: document.getElementById('cat-desc').value,
            status: document.getElementById('cat-status').value,
            size_system: document.getElementById('cat-size-system').value,
        };
        if (id) {
            await api('PUT', '/categories/' + id, data);
        } else {
            await api('POST', '/categories', data);
        }
        document.getElementById('category-modal').classList.remove('active');
        catForm.reset();
        initCategories();
        showToast('✓ Catégorie enregistrée avec succès !');
    });
});

/* ── Collections ── */
async function initCollections() {
    const cols = await api('GET', '/collections');
    if (!cols) return;
    const grid = document.querySelector('#collections-grid');
    if (!grid) return;

    document.getElementById('stat-coll-count').textContent = cols.length;
    var totalProds = cols.reduce(function (s, c) { return s + (c.product_count || 0); }, 0);
    document.getElementById('stat-coll-products').textContent = totalProds;
    document.getElementById('stat-coll-active').textContent = cols.filter(function (c) { return c.status === 'active'; }).length;
    document.getElementById('stat-coll-hidden').textContent = cols.filter(function (c) { return c.status === 'hidden'; }).length;
    var countEl = document.getElementById('coll-count');
    if (countEl) countEl.textContent = cols.length + ' collections';

    grid.innerHTML = cols.map(function (c) {
        var banner = c.image
            ? '<img src="/' + esc(c.image) + '" style="width:100%;height:140px;object-fit:cover;border-radius:8px 8px 0 0;" onerror="this.style.display=\'none\'">'
            : '<div style="height:140px;background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;color:#c9a96e;font-size:2rem;"><i class="fas fa-layer-group"></i></div>';
        return '<div class="card">' +
            banner +
            '<div class="card-body">' +
            '<h3 style="font-size:1rem;margin-bottom:4px;">' + esc(c.name) + '</h3>' +
            '<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + esc(c.description || '') + '</p>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
            badge(c.status) +
            '<small style="color:var(--text-muted);">' + (c.product_count || 0) + ' products</small>' +
            '</div>' +
            '<div style="display:flex;gap:6px;">' +
            '<button class="btn btn-outline btn-sm" style="flex:1;" onclick="editCollection(' + c.id + ')"><i class="fas fa-edit"></i> Edit</button>' +
            '<button class="btn btn-danger btn-sm" style="flex:1;" onclick="deleteCollection(' + c.id + ')"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div></div>';
    }).join('');
}

window.editCollection = async function (id) {
    var allData = await api('GET', '/collections/all');
    var coll = await api('GET', '/collections/' + id);
    if (!coll || !allData) return;

    document.getElementById('coll-id').value = coll.id;
    document.getElementById('coll-modal-title').textContent = 'Edit Collection';
    document.getElementById('coll-name').value = coll.name || '';
    document.getElementById('coll-desc').value = coll.description || '';
    document.getElementById('coll-status').value = coll.status || 'active';
    document.getElementById('coll-image').value = coll.image || '';
    var preview = document.getElementById('coll-image-preview');
    var removeBtn = document.getElementById('coll-remove-image');
    if (coll.image) {
        preview.src = '/' + coll.image;
        preview.style.display = 'block';
        removeBtn.style.display = 'inline-flex';
    } else {
        preview.style.display = 'none';
        removeBtn.style.display = 'none';
    }

    var assignedIds = coll.product_ids || [];
    renderProductPicker(allData.products, assignedIds);
    document.getElementById('collection-modal').classList.add('active');
};

window.deleteCollection = async function (id) {
    if (!confirm('Delete this collection? Products will not be affected.')) return;
    await api('DELETE', '/collections/' + id);
    initCollections();
};

/* Collection form */
document.addEventListener('DOMContentLoaded', function () {
    var collForm = document.getElementById('collection-form');
    if (!collForm) return;

    /* Add button opens blank form */
    var addBtn = document.getElementById('add-collection-btn');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            document.getElementById('coll-id').value = '';
            document.getElementById('coll-modal-title').textContent = 'Add Collection';
            collForm.reset();
            document.getElementById('coll-image-preview').style.display = 'none';
            document.getElementById('coll-remove-image').style.display = 'none';
            document.getElementById('coll-image').value = '';
            /* Load all products for the picker */
            loadProductPicker([]);
            document.getElementById('collection-modal').classList.add('active');
        });
    }

    async function loadProductPicker(selectedIds) {
        var data = await api('GET', '/collections/all');
        if (data) renderProductPicker(data.products, selectedIds);
    }

    function renderProductPicker(products, selectedIds) {
        var container = document.getElementById('coll-product-picker');
        if (!container) return;
        if (!products || products.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:8px;">No products available.</p>';
            return;
        }
        var selected = selectedIds || [];
        container.innerHTML = products.map(function (p) {
            var checked = selected.indexOf(p.id) !== -1 ? 'checked' : '';
            return '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85rem;cursor:pointer;">' +
                '<input type="checkbox" value="' + p.id + '" ' + checked + ' style="cursor:pointer;"> ' +
                esc(p.name) +
                '</label>';
        }).join('');
    }

    /* Make renderProductPicker globally accessible for editCollection */
    window.renderProductPicker = renderProductPicker;

    /* Banner image upload */
    var uploadZone = document.getElementById('coll-upload-zone');
    var fileInput = document.getElementById('coll-file-input');
    var imageInput = document.getElementById('coll-image');
    var preview = document.getElementById('coll-image-preview');
    var removeBtn = document.getElementById('coll-remove-image');

    if (uploadZone && fileInput) {
        uploadZone.addEventListener('dragover', function (e) { e.preventDefault(); this.classList.add('dragover'); });
        uploadZone.addEventListener('dragleave', function () { this.classList.remove('dragover'); });
        uploadZone.addEventListener('drop', function (e) {
            e.preventDefault();
            this.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) uploadImage(e.dataTransfer.files[0]);
        });
        uploadZone.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', function () {
            if (this.files.length > 0) uploadImage(this.files[0]);
            this.value = '';
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', function () {
            imageInput.value = '';
            preview.style.display = 'none';
            preview.src = '';
            this.style.display = 'none';
        });
    }

    async function uploadImage(file) {
        var ext = '.' + file.name.split('.').pop().toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp'].indexOf(ext) === -1) {
            alert('Unsupported format. Use JPG, PNG, or WEBP.');
            return;
        }
        try {
            var fd = new FormData();
            fd.append('images', file);
            var res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
            var data = await res.json();
            if (data.paths && data.paths[0]) {
                imageInput.value = data.paths[0];
                preview.src = '/' + data.paths[0];
                preview.style.display = 'block';
                removeBtn.style.display = 'inline-flex';
            } else {
                alert('Upload failed — no path returned.');
            }
        } catch (err) {
            console.error('[collection-upload]', err);
            alert('Upload error: ' + (err.message || err));
        }
    }

    /* Submit */
    collForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var id = document.getElementById('coll-id').value;
        var data = {
            name: document.getElementById('coll-name').value,
            description: document.getElementById('coll-desc').value,
            status: document.getElementById('coll-status').value,
            image: document.getElementById('coll-image').value,
        };
        if (id) {
            await api('PUT', '/collections/' + id, data);
            /* Update product assignments */
            var checked = [];
            document.querySelectorAll('#coll-product-picker input[type="checkbox"]:checked').forEach(function (cb) {
                checked.push(parseInt(cb.value));
            });
            await api('PUT', '/collections/' + id + '/products', { product_ids: checked });
        } else {
            var checked = [];
            document.querySelectorAll('#coll-product-picker input[type="checkbox"]:checked').forEach(function (cb) {
                checked.push(parseInt(cb.value));
            });
            data.product_ids = checked;
            await api('POST', '/collections', data);
        }
        document.getElementById('collection-modal').classList.remove('active');
        collForm.reset();
        document.getElementById('coll-image-preview').style.display = 'none';
        document.getElementById('coll-remove-image').style.display = 'none';
        initCollections();
        showToast('✓ Collection enregistrée avec succès !');
    });
});

/* ── Orders ── */
var ordersData = [];
var ordersFilterStatus = '';

async function initOrders() {
    ordersData = await api('GET', '/orders');
    if (!ordersData) { ordersData = []; }
    renderOrdersTable();
    document.getElementById('order-total-count').textContent = ordersData.length;
}

function renderOrdersTable() {
    var tbody = document.getElementById('orders-tbody');
    var emptyEl = document.getElementById('orders-empty');
    if (!tbody) return;

    var filtered = ordersData;
    if (ordersFilterStatus) {
        filtered = filtered.filter(function (o) {
            return (o.status || '').toLowerCase() === ordersFilterStatus.toLowerCase();
        });
    }

    var searchVal = (document.getElementById('orders-search-input')?.value || '').toLowerCase().trim();
    if (searchVal) {
        filtered = filtered.filter(function (o) {
            return (o.customer_name || '').toLowerCase().indexOf(searchVal) !== -1 ||
                   (o.customer_phone || '').indexOf(searchVal) !== -1 ||
                   (o.order_number || '').toLowerCase().indexOf(searchVal) !== -1 ||
                   (o.wilaya || '').toLowerCase().indexOf(searchVal) !== -1 ||
                   (o.commune || '').toLowerCase().indexOf(searchVal) !== -1;
        });
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        document.getElementById('order-total-count').textContent = ordersData.length;
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    document.getElementById('order-total-count').textContent = ordersData.length;

    tbody.innerHTML = filtered.map(function (o) {
        var items = [];
        try { items = o.items || JSON.parse(o.items || '[]'); } catch (e) {}
        var isUnread = o.is_read === 0 || o.is_read === null;
        var rowClass = isUnread ? ' class="order-row-unread"' : '';
        return '<tr' + rowClass + '>' +
            '<td class="td-order-num"><span class="order-num">' + esc(o.order_number || '#' + o.id) + '</span></td>' +
            '<td><div class="customer-cell"><img src="' + avatarUrl(o.customer_name || '?') + '" alt=""><div class="name">' + esc(o.customer_name || '—') + '</div></div></td>' +
            '<td class="td-phone">' + esc(o.customer_phone || '—') + '</td>' +
            '<td class="td-wilaya">' + esc(o.wilaya || '—') + '</td>' +
            '<td class="td-total">' + formatPriceDA(o.total) + '</td>' +
            '<td class="td-status">' + badge(o.status) + '</td>' +
            '<td class="td-date" data-sort-val="' + (o.created_at || '') + '">' + timeAgo(o.created_at) + '</td>' +
            '<td class="td-actions"><button class="btn btn-outline btn-sm" onclick="viewOrder(' + o.id + ')" title="Voir la commande"><i class="fas fa-eye"></i> Voir</button></td>' +
            '</tr>';
    }).join('');
}

/* ── Order Detail View ── */
var currentOrder = null;

window.viewOrder = async function (id) {
    var o = await api('GET', '/orders/' + id);
    if (!o) return;

    currentOrder = o;

    /* Mark as read */
    api('PUT', '/notifications/read/' + id);

    /* Show detail view, hide list */
    document.getElementById('orders-list-view').style.display = 'none';
    document.getElementById('order-detail-view').style.display = 'block';

    /* Header */
    document.getElementById('od-order-number').textContent = o.order_number || ('#' + o.id);
    document.getElementById('od-order-title').textContent = 'Commande ' + (o.order_number || ('#' + o.id));
    document.getElementById('od-status-badge').innerHTML = badge(o.status);

    /* Build detail content */
    var items = [];
    try { items = o.items || JSON.parse(o.items || '[]'); } catch (e) { items = []; }

    var itemsHTML = '';
    if (items.length === 0) {
        itemsHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Aucun article dans cette commande.</td></tr>';
    } else {
        itemsHTML = items.map(function (item) {
            var name = item.name || item.product_name || 'Produit #' + (item.product_id || item.id || '?');
            var color = item.color || item.selectedColor || '';
            var colorHex = item.color_hex || '';
            var size = item.size || item.selectedSize || '';
            var tg = tailleGroupForSize(size);
            var sizeDisplay = esc(size) + (tg ? ' <span class="size-tag">' + tg + '</span>' : '');
            var qty = item.quantity || item.qty || 1;
            var price = Number(item.price || 0);
            var sub = price * qty;
            var colorSwatch = colorHex ? '<span class="color-swatch" style="background:' + esc(colorHex) + '"></span> ' : '';
            return '<tr>' +
                '<td class="td-product">' + esc(name) + '</td>' +
                '<td class="td-color">' + colorSwatch + esc(color) + '</td>' +
                '<td class="td-size">' + sizeDisplay + '</td>' +
                '<td class="td-qty">' + qty + '</td>' +
                '<td class="td-price">' + formatPriceDA(price) + '</td>' +
                '<td class="td-subtotal">' + formatPriceDA(sub) + '</td>' +
                '</tr>';
        }).join('');
    }

    var dateStr = o.created_at ? new Date(o.created_at).toLocaleString('fr-DZ', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '—';

    var totalItems = items.reduce(function (sum, it) { return sum + (it.quantity || it.qty || 1); }, 0);

    var content = '<div class="order-detail-grid">' +
        /* Customer card */
        '<div class="detail-card">' +
            '<div class="detail-card-header"><i class="fas fa-user"></i> Client</div>' +
            '<div class="detail-card-body">' +
                '<div class="detail-row"><span class="detail-label">Nom</span><span class="detail-value">' + esc(o.customer_name || '—') + '</span></div>' +
                '<div class="detail-row"><span class="detail-label">Téléphone</span><span class="detail-value"><a href="tel:' + esc(o.customer_phone) + '">' + esc(o.customer_phone || '—') + '</a></span></div>' +
                '<div class="detail-row"><span class="detail-label">Wilaya</span><span class="detail-value">' + esc(o.wilaya || '—') + '</span></div>' +
                '<div class="detail-row"><span class="detail-label">Commune</span><span class="detail-value">' + esc(o.commune || '—') + '</span></div>' +
                '<div class="detail-row"><span class="detail-label">Adresse</span><span class="detail-value">' + esc(o.shipping_address || 'Non spécifiée') + '</span></div>' +
            '</div>' +
        '</div>' +

        /* Order info card */
        '<div class="detail-card">' +
            '<div class="detail-card-header"><i class="fas fa-receipt"></i> Commande</div>' +
            '<div class="detail-card-body">' +
                '<div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">' + dateStr + '</span></div>' +
                '<div class="detail-row"><span class="detail-label">Paiement</span><span class="detail-value">' + esc(o.payment_method || '—') + '</span></div>' +
                '<div class="detail-row"><span class="detail-label">Articles</span><span class="detail-value">' + totalItems + '</span></div>' +
                '<div class="detail-row"><span class="detail-label">Livraison</span><span class="detail-value">' + (o.delivery_fee > 0 ? formatPriceDA(o.delivery_fee) : 'Gratuite') + '</span></div>' +
                '<div class="detail-row total-row"><span class="detail-label">Total</span><span class="detail-value total-amount">' + formatPriceDA(o.total) + '</span></div>' +
            '</div>' +
        '</div>' +
    '</div>' +

    /* Items table */
    '<div class="detail-card" style="grid-column:1/-1;">' +
        '<div class="detail-card-header"><i class="fas fa-box"></i> Produits commandés (' + items.length + ')</div>' +
        '<div class="detail-card-body" style="padding:0;">' +
            '<div class="table-container">' +
                '<table class="od-items-table">' +
                    '<thead><tr>' +
                        '<th>Produit</th>' +
                        '<th>Couleur</th>' +
                        '<th>Taille</th>' +
                        '<th style="text-align:center;">Qté</th>' +
                        '<th style="text-align:right;">Prix unit.</th>' +
                        '<th style="text-align:right;">Sous-total</th>' +
                    '</tr></thead>' +
                    '<tbody>' + itemsHTML + '</tbody>' +
                '</table>' +
            '</div>' +
        '</div>' +
        '<div class="od-total-bar">' +
            '<span style="font-weight:400;">Sous-total produits</span>' +
            '<span>' + formatPriceDA(o.total - (o.delivery_fee || 0)) + '</span>' +
        '</div>' +
        '<div class="od-total-bar" style="border-top:none;padding:4px 16px;">' +
            '<span style="font-weight:400;">Livraison</span>' +
            '<span>' + (o.delivery_fee > 0 ? formatPriceDA(o.delivery_fee) : 'Gratuite') + '</span>' +
        '</div>' +
        '<div class="od-total-bar">' +
            '<span>Total de la commande</span>' +
            '<span class="od-total-amount">' + formatPriceDA(o.total) + '</span>' +
        '</div>' +
    '</div>' +

    /* Status update */
    '<div class="detail-card od-status-card" style="grid-column:1/-1;">' +
        '<div class="detail-card-header"><i class="fas fa-tag"></i> Statut de la commande</div>' +
        '<div class="detail-card-body">' +
            '<div class="od-status-update">' +
                '<select id="od-status-select" class="form-control">' +
                    '<option value="new"' + (o.status === 'new' ? ' selected' : '') + '>En attente</option>' +
                    '<option value="confirmed"' + (o.status === 'confirmed' ? ' selected' : '') + '>Confirmée</option>' +
                    '<option value="in_delivery"' + (o.status === 'in_delivery' ? ' selected' : '') + '>En cours de livraison</option>' +
                    '<option value="arrived"' + (o.status === 'arrived' ? ' selected' : '') + '>Arrivé</option>' +
                    '<option value="preparing"' + (o.status === 'preparing' ? ' selected' : '') + '>En préparation</option>' +
                    '<option value="shipped"' + (o.status === 'shipped' ? ' selected' : '') + '>Expédiée</option>' +
                    '<option value="delivered"' + (o.status === 'delivered' ? ' selected' : '') + '>Livrée</option>' +
                    '<option value="cancelled"' + (o.status === 'cancelled' ? ' selected' : '') + '>Annulée</option>' +
                '</select>' +
                '<button class="btn btn-primary" id="od-save-status"><i class="fas fa-save"></i> Sauvegarder</button>' +
            '</div>' +
            '<p id="od-status-msg" class="od-status-msg" style="display:none;"></p>' +
        '</div>' +
    '</div>' +
    /* Delete button */
    '<div class="detail-card od-delete-card" style="grid-column:1/-1;' + (o.status === 'arrived' || o.status === 'delivered' ? '' : 'display:none;') + '">' +
        '<div class="detail-card-header"><i class="fas fa-trash-alt"></i> Supprimer la commande</div>' +
        '<div class="detail-card-body">' +
            '<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">' +
                'Une fois la commande arrivée, vous pouvez la supprimer définitivement. Cette action est irréversible.' +
            '</p>' +
            '<button class="btn btn-danger" id="od-delete-btn"><i class="fas fa-trash-alt"></i> Supprimer définitivement</button>' +
        '</div>' +
    '</div>';

    document.getElementById('order-detail-content').innerHTML = content;

    /* Wire up status save */
    document.getElementById('od-save-status').addEventListener('click', function () {
        var status = document.getElementById('od-status-select').value;
        api('PUT', '/orders/' + o.id, { status: status }).then(function (res) {
            if (res) {
                document.getElementById('od-status-badge').innerHTML = badge(status);
                o.status = status;
                var msgEl = document.getElementById('od-status-msg');
                msgEl.textContent = 'Statut mis à jour : ' + (statusLabels[status] || status);
                msgEl.style.display = 'block';
                setTimeout(function () { msgEl.style.display = 'none'; }, 3000);
                /* Toggle delete card visibility */
                var deleteCard = document.querySelector('.od-delete-card');
                if (deleteCard) {
                    deleteCard.style.display = (status === 'arrived' || status === 'delivered') ? '' : 'none';
                }
                initOrders();
            }
        });
    });

    /* Wire up delete button */
    document.getElementById('od-delete-btn').addEventListener('click', function () {
        if (!confirm('Êtes-vous sûr de vouloir supprimer cette commande ? Cette action est irréversible.')) return;
        api('DELETE', '/orders/' + o.id).then(function (res) {
            if (res) {
                showToast('✓ Commande supprimée définitivement.');
                closeOrderDetail();
                initOrders();
            }
        });
    });

    /* Re-bind print button */
    document.getElementById('od-print-btn').onclick = function () { printOrder(o); };
};

function closeOrderDetail() {
    document.getElementById('orders-list-view').style.display = 'block';
    document.getElementById('order-detail-view').style.display = 'none';
    currentOrder = null;
}

/* ── Customers ── */
/* ── Customer State ── */
let customerState = { page: 1, sort: 'id', order: 'asc', search: '' };

async function loadCustomers() {
    const s = customerState;
    const q = `?page=${s.page}&sort=${s.sort}&order=${s.order}&search=${encodeURIComponent(s.search)}&per_page=10`;
    const res = await api('GET', '/customers' + q);
    if (!res) return;
    const { customers, total, page, pages } = res;
    const tbody = document.querySelector('#customers-table tbody');
    if (!tbody) return;
    if (customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);">No customers found.</td></tr>';
        document.querySelector('#customer-pagination').innerHTML = '';
        return;
    }
    tbody.innerHTML = customers.map(c => `
        <tr>
            <td><div class="customer-cell"><img src="${avatarUrl(c.name)}" alt=""><div class="name">${esc(c.name)}</div></div></td>
            <td>${esc(c.email)}</td>
            <td>${esc(c.phone || '—')}</td>
            <td>${c.orders_count}</td>
            <td>${formatPriceDA(c.total_spent)}</td>
            <td>${c.joined_at ? formatDate(c.joined_at) : '—'}</td>
            <td>${badge(c.status)}</td>
            <td style="text-align:right;">
                <button class="btn btn-outline btn-sm" onclick="viewCustomer(${c.id})"><i class="fas fa-eye"></i></button>
                <button class="btn btn-outline btn-sm" onclick="editCustomer(${c.id})"><i class="fas fa-edit"></i></button>
            </td>
        </tr>
    `).join('');

    /* pagination */
    const pag = document.getElementById('customer-pagination');
    pag.innerHTML = '';
    if (pages <= 1) return;
    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-outline btn-sm' + (page <= 1 ? ' disabled' : '');
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    if (page > 1) { prevBtn.onclick = function () { s.page = page - 1; loadCustomers(); }; }
    pag.appendChild(prevBtn);
    const span = document.createElement('span');
    span.style.cssText = 'margin:0 12px;font-size:0.85rem;';
    span.textContent = 'Page ' + page + ' of ' + pages;
    pag.appendChild(span);
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-outline btn-sm' + (page >= pages ? ' disabled' : '');
    nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    if (page < pages) { nextBtn.onclick = function () { s.page = page + 1; loadCustomers(); }; }
    pag.appendChild(nextBtn);

    /* stats */
    updateCustomerStats();
}

async function updateCustomerStats() {
    const all = await api('GET', '/customers?per_page=1000');
    if (!all) return;
    const list = all.customers || [];
    const total = list.length;
    document.getElementById('stat-total').textContent = total;
    /* new this month */
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const newMonth = list.filter(function (c) {
        if (!c.joined_at) return false;
        const d = new Date(c.joined_at);
        return d >= monthStart;
    }).length;
    document.getElementById('stat-new').textContent = newMonth;
    /* total orders */
    const totalOrders = list.reduce(function (sum, c) { return sum + (c.orders_count || 0); }, 0);
    document.getElementById('stat-orders').textContent = totalOrders;
    /* avg order value */
    const avg = totalOrders > 0 ? list.reduce(function (sum, c) { return sum + (c.total_spent || 0); }, 0) / totalOrders : 0;
    document.getElementById('stat-avg').textContent = formatPriceDA(avg);
    document.getElementById('customer-subtitle').textContent = 'View and manage your customer base (' + total + ' total)';
}

function initCustomers() {
    customerState = { page: 1, sort: 'id', order: 'asc', search: '' };
    loadCustomers();

    /* sortable headers */
    document.querySelectorAll('#customers-table th.sortable').forEach(function (th) {
        th.addEventListener('click', function () {
            const sort = this.dataset.sort;
            if (customerState.sort === sort) {
                customerState.order = customerState.order === 'asc' ? 'desc' : 'asc';
            } else {
                customerState.sort = sort;
                customerState.order = 'asc';
            }
            customerState.page = 1;
            /* update sort icons */
            document.querySelectorAll('#customers-table th.sortable i').forEach(function (i) { i.className = 'fas fa-sort'; });
            const icon = this.querySelector('i');
            icon.className = 'fas fa-sort-' + (customerState.order === 'asc' ? 'up' : 'down');
            loadCustomers();
        });
    });

    /* search */
    const searchInput = document.getElementById('customer-search-input');
    if (searchInput) {
        let searchTimer;
        searchInput.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                customerState.search = searchInput.value.trim();
                customerState.page = 1;
                loadCustomers();
            }, 300);
        });
    }
}

async function viewCustomer(id) {
    const c = await api('GET', '/customers/' + id);
    if (!c) return;
    document.getElementById('detail-name').textContent = c.name || '—';
    document.getElementById('detail-email').textContent = c.email || '';
    document.getElementById('detail-email2').textContent = c.email || '—';
    document.getElementById('detail-phone').textContent = c.phone || '—';
    document.getElementById('detail-address').textContent = c.address || 'No address on file';
    document.getElementById('detail-status').textContent = c.status || 'active';
    document.getElementById('detail-status').className = 'badge ' + (badge(c.status).match(/badge-\w+/)?.[0] || 'badge-gray');
    document.getElementById('detail-orders-count').textContent = c.orders_count || 0;
    document.getElementById('detail-spent').textContent = formatPriceDA(c.total_spent);
    document.getElementById('detail-joined').textContent = c.joined_at ? formatDate(c.joined_at) : '—';
    document.getElementById('detail-avatar').src = avatarUrl(c.name, 'c9a96e');

    /* order history */
    const otbody = document.querySelector('#detail-orders-table tbody');
    if (!otbody) return;
    const orders = c.orders || [];
    if (orders.length === 0) {
        otbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No orders yet.</td></tr>';
    } else {
        otbody.innerHTML = orders.map(function (o) {
            const items = Array.isArray(o.items) ? o.items.length : 0;
            return '<tr>' +
                '<td>#' + o.id + '</td>' +
                '<td>' + (o.created_at ? formatDate(o.created_at) : '—') + '</td>' +
                '<td>' + items + ' items</td>' +
                '<td>' + formatPriceDA(o.total) + '</td>' +
                '<td>' + badge(o.status) + '</td>' +
                '</tr>';
        }).join('');
    }

    document.getElementById('customer-detail-modal').classList.add('active');
}

function editCustomer(id) {
    /* prompt-based inline edit for simplicity */
    const row = document.querySelector('#customers-table tbody tr:nth-child(' + customerState.page + ')');
    /* simpler: just ask for name/email/phone */
    const name = prompt('Customer name:');
    if (name === null) return;
    const email = prompt('Email:');
    if (email === null) return;
    const phone = prompt('Phone:');
    if (phone === null) return;
    const address = prompt('Address:');
    if (address === null) return;
    api('PUT', '/customers/' + id, { name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim() }).then(function (res) {
        if (res) loadCustomers();
    });
}

function exportCustomers() {
    api('GET', '/customers?per_page=10000').then(function (res) {
        if (!res) return;
        const list = res.customers || [];
        let csv = 'Name,Email,Phone,Address,Orders,Total Spent,Status,Joined\n';
        list.forEach(function (c) {
            csv += '"' + (c.name || '') + '","' + (c.email || '') + '","' + (c.phone || '') + '","' + (c.address || '') + '",' +
                (c.orders_count || 0) + ',' + formatPriceDA(c.total_spent) + ',"' + (c.status || '') + '","' + (c.joined_at || '') + '"\n';
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'customers.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    });
}

/* ── Inventory ── */
let invStatusFilter = 'all';

function stockBar(qty, threshold) {
    const pct = Math.min(100, (qty / Math.max(threshold * 3, 1)) * 100);
    const color = qty === 0 ? '#f56565' : qty <= threshold ? '#ecc94b' : '#48bb78';
    return '<div class="stock-bar"><div class="stock-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>';
}

async function initInventory() {
    const res = await api('GET', '/inventory?status=' + invStatusFilter);
    if (!res) return;
    const inv = res.items || [];
    const counts = res.counts || { total: 0, in_stock: 0, low_stock: 0, out_of_stock: 0 };
    document.getElementById('inv-total').textContent = counts.total;
    document.getElementById('inv-in').textContent = counts.in_stock;
    document.getElementById('inv-low').textContent = counts.low_stock;
    document.getElementById('inv-out').textContent = counts.out_of_stock;

    const tbody = document.querySelector('#inventory-table tbody');
    if (!tbody) return;
    if (inv.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">No inventory items found.</td></tr>';
        return;
    }
    tbody.innerHTML = inv.map(function (i) {
        const st = i.quantity === 0 ? 'Out of Stock' : i.quantity <= i.low_stock_threshold ? 'Low Stock' : 'In Stock';
        return '<tr>' +
            '<td><div class="product-cell"><img src="/' + esc(i.product_image) + '" alt="" onerror="this.src=\'https://placehold.co/40x40/e2e8f0/718096?text=P\'"><div class="info"><div class="name">' + esc(i.product_name) + '</div></div></div></td>' +
            '<td>SKU-' + i.product_id + '</td>' +
            '<td>' + esc(i.category_name || '') + '</td>' +
            '<td><div style="display:flex;align-items:center;gap:8px;"><span style="font-weight:600;min-width:28px;">' + i.quantity + '</span>' + stockBar(i.quantity, i.low_stock_threshold || 5) + '</div></td>' +
            '<td>' + badge(st) + '</td>' +
            '<td style="text-align:right;">' +
                '<button class="btn btn-outline btn-sm" onclick="openStockModal(' + i.product_id + ')" title="Update Stock"><i class="fas fa-edit"></i></button> ' +
                '<button class="btn btn-outline btn-sm" onclick="viewStockHistory(' + i.product_id + ')" title="History"><i class="fas fa-history"></i></button>' +
            '</td>' +
            '</tr>';
    }).join('');

    /* populate category filter */
    const catFilter = document.getElementById('inv-category-filter');
    if (catFilter && catFilter.options.length <= 1) {
        var cats = {};
        inv.forEach(function (i) { if (i.category_name) cats[i.category_name.toLowerCase()] = i.category_name; });
        Object.keys(cats).forEach(function (slug) {
            var opt = document.createElement('option');
            opt.value = slug;
            opt.textContent = cats[slug];
            catFilter.appendChild(opt);
        });
    }
}

function openStockModal(productId) {
    api('GET', '/inventory?status=all').then(function (res) {
        if (!res) return;
        var item = (res.items || []).find(function (i) { return i.product_id === productId; });
        if (!item) return;
        document.getElementById('sum-product-id').value = productId;
        document.getElementById('sum-product-name').textContent = item.product_name || 'Product #' + productId;
        document.getElementById('sum-current-qty').textContent = item.quantity;
        document.getElementById('sum-qty').value = 1;
        document.getElementById('sum-absolute').value = '';
        document.getElementById('sum-reason').value = 'Manual adjustment';
        document.getElementById('stock-update-modal').classList.add('active');
    });
}

function closeStockModal() {
    document.getElementById('stock-update-modal').classList.remove('active');
}

function viewStockHistory(productId) {
    api('GET', '/inventory/' + productId + '/history').then(function (history) {
        if (!history) return;
        document.getElementById('shm-product-name').textContent = (history[0] && history[0].product_name) || 'Product #' + productId;
        var tbody = document.querySelector('#history-table tbody');
        if (!tbody) return;
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No history recorded yet.</td></tr>';
        } else {
            tbody.innerHTML = history.map(function (h) {
                var arrow = h.change > 0 ? '<span style="color:#48bb78;">+' + h.change + '</span>' : '<span style="color:#f56565;">' + h.change + '</span>';
                return '<tr>' +
                    '<td>' + formatDate(h.created_at) + '</td>' +
                    '<td>' + arrow + '</td>' +
                    '<td>' + h.quantity_before + '</td>' +
                    '<td>' + h.quantity_after + '</td>' +
                    '<td>' + esc(h.reason || '—') + '</td>' +
                    '</tr>';
            }).join('');
        }
        document.getElementById('stock-history-modal').classList.add('active');
    });
}

/* Wire up stock modal buttons in DOMContentLoaded below */

function exportInventory() {
    api('GET', '/inventory?status=all').then(function (res) {
        if (!res) return;
        var list = res.items || [];
        var csv = 'Product,SKU,Category,Stock,Threshold,Status\n';
        list.forEach(function (i) {
            var st = i.quantity === 0 ? 'Out of Stock' : i.quantity <= i.low_stock_threshold ? 'Low Stock' : 'In Stock';
            csv += '"' + (i.product_name || '') + '",SKU-' + i.product_id + ',"' + (i.category_name || '') + '",' + i.quantity + ',' + (i.low_stock_threshold || 5) + ',"' + st + '"\n';
        });
        var blob = new Blob([csv], { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'inventory.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    });
}

/* ── Analytics ── */
async function initAnalytics() {
    const d = await api('GET', '/analytics');
    if (!d) return;
    const s = d.stats || {};

    /* Stats */
    document.getElementById('ana-revenue').textContent = formatPriceDA(s.revenue);
    document.getElementById('ana-orders').textContent = s.orders || 0;
    document.getElementById('ana-customers').textContent = s.customers || 0;
    document.getElementById('ana-avg-order').textContent = formatPriceDA(s.avg_order_value);
    document.getElementById('ana-subtitle').textContent = 'Track your store\'s performance — ' + (s.products || 0) + ' products, ' + s.orders + ' orders';

    /* Monthly Sales Chart */
    renderMonthlyChart(d.monthly_sales || []);

    /* Category Performance */
    renderCategoryChart(d.category_performance || []);

    /* Best Sellers Table */
    renderBestSellers(d.best_sellers || []);

    /* Daily Sales */
    renderDailyChart(d.daily_sales || []);
}

function renderMonthlyChart(months) {
    const container = document.getElementById('ana-monthly-chart');
    const labels = document.getElementById('ana-monthly-labels');
    const range = document.getElementById('ana-monthly-range');
    if (!container) return;

    if (months.length === 0) {
        container.innerHTML = '<div style="width:100%;text-align:center;padding:40px;color:var(--text-muted);">No monthly data yet.</div>';
        if (labels) labels.innerHTML = '';
        return;
    }

    const maxRev = Math.max.apply(null, months.map(function (m) { return m.revenue; })) || 1;
    const colors = [colorVar('--primary', '#c9a96e'), '#48bb78', '#4299e1', '#9f7aea', '#ed8936', '#f56565', '#38b2ac', '#667eea', '#f6ad55', '#68d391', '#fc8181', '#a0aec0'];

    container.innerHTML = months.map(function (m, i) {
        var pct = (m.revenue / maxRev) * 100;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">' +
            '<div style="width:100%;background:' + colors[i % colors.length] + ';border-radius:4px 4px 0 0;height:' + pct + '%;min-height:4px;position:relative;" title="' + formatPriceDA(m.revenue) + '">' +
                '<span style="position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:0.6rem;font-weight:600;color:var(--text-muted);white-space:nowrap;">' + abbreviate(m.revenue) + ' DA</span>' +
            '</div></div>';
    }).join('');

    labels.innerHTML = months.map(function (m) {
        var parts = m.month.split('-');
        var label = months.length > 6 ? parts[1] + '/' + parts[0].slice(2) : parts[0] + '-' + parts[1];
        return '<span style="flex:1;text-align:center;font-size:0.65rem;color:var(--text-muted);">' + label + '</span>';
    }).join('');

    if (range && months.length >= 2) {
        range.textContent = ' (' + months[0].month + ' — ' + months[months.length - 1].month + ')';
    }
}

function renderCategoryChart(categories) {
    const container = document.getElementById('ana-category-chart');
    if (!container) return;

    if (categories.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">No category data yet.</div>';
        return;
    }

    const totalRevenue = categories.reduce(function (sum, c) { return sum + c.revenue; }, 0) || 1;
    const catColors = [colorVar('--primary', '#c9a96e'), '#4299e1', '#48bb78', '#ed8936', '#9f7aea', '#f56565', '#38b2ac', '#667eea'];

    container.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;">' +
        categories.map(function (c, i) {
            var pct = (c.revenue / totalRevenue) * 100;
            return '<div>' +
                '<div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px;">' +
                    '<span>' + esc(c.name) + '</span>' +
                    '<span style="font-weight:600;">' + formatPriceDA(c.revenue) + ' (' + pct.toFixed(1) + '%)</span>' +
                '</div>' +
                '<div style="height:8px;background:var(--content-bg);border-radius:4px;overflow:hidden;">' +
                    '<div style="height:100%;width:' + pct + '%;background:' + catColors[i % catColors.length] + ';border-radius:4px;transition:width 0.5s;"></div>' +
                '</div>' +
            '</div>';
        }).join('') +
        '</div>';
}

function renderBestSellers(products) {
    const tbody = document.querySelector('#ana-best-sellers tbody');
    if (!tbody) return;
    if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">No sales data yet.</td></tr>';
        return;
    }
    tbody.innerHTML = products.map(function (p) {
        return '<tr>' +
            '<td><div class="product-cell"><img src="/' + esc(p.image) + '" alt="" onerror="this.src=\'https://placehold.co/40x40/e2e8f0/718096?text=P\'"><div class="info"><div class="name">' + esc(p.name) + '</div><div class="sku">SKU-' + p.id + '</div></div></div></td>' +
            '<td>' + formatPriceDA(p.price) + '</td>' +
            '<td>' + (p.sold || 0) + '</td>' +
            '<td>' + formatPriceDA(p.revenue) + '</td>' +
            '</tr>';
    }).join('');
}

function renderDailyChart(days) {
    const container = document.getElementById('ana-daily-chart');
    const labels = document.getElementById('ana-daily-labels');
    const range = document.getElementById('ana-daily-range');
    if (!container) return;

    if (days.length === 0) {
        container.innerHTML = '<div style="width:100%;text-align:center;padding:30px;color:var(--text-muted);">No daily data yet.</div>';
        if (labels) labels.innerHTML = '';
        return;
    }

    const maxRev = Math.max.apply(null, days.map(function (d) { return d.revenue; })) || 1;

    container.innerHTML = days.map(function (d) {
        var pct = (d.revenue / maxRev) * 100;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">' +
            '<div style="width:100%;background:var(--primary);border-radius:2px 2px 0 0;height:' + pct + '%;min-height:3px;" title="' + formatPriceDA(d.revenue) + ' (' + d.orders + ' orders)"></div>' +
            '</div>';
    }).join('');

    labels.innerHTML = days.map(function (d) {
        return '<span style="flex:1;text-align:center;font-size:0.55rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;">' + d.day.slice(5) + '</span>';
    }).join('');
}

function abbreviate(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num;
}

function exportAnalytics() {
    api('GET', '/analytics').then(function (d) {
        if (!d) return;
        var rows = [['Metric', 'Value']];
        var s = d.stats || {};
        rows.push(['Revenue', formatPriceDA(s.revenue)]);
        rows.push(['Orders', s.orders]);
        rows.push(['Customers', s.customers]);
        rows.push(['Avg Order Value', '$' + s.avg_order_value]);
        rows.push(['Products', s.products]);
        rows.push(['Conversion Rate', s.conversion + '%']);
        (d.monthly_sales || []).forEach(function (m) {
            rows.push(['Sales ' + m.month, '$' + m.revenue + ' (' + m.orders + ' orders)']);
        });
        var csv = rows.map(function (r) { return r.join(','); }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'analytics.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    });
}

/* ── Settings ── */
var APPROVED_FONTS = ['Cormorant Garamond', 'Playfair Display', 'DM Serif Display', 'Cinzel', 'Poppins', 'Inter'];

function initSettings() {
    var form = document.getElementById('settings-form');
    if (!form) return;

    /* Populate font dropdowns */
    document.querySelectorAll('select[name$="_font"]').forEach(function(sel) {
        APPROVED_FONTS.forEach(function(f) {
            var opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            sel.appendChild(opt);
        });
    });

    /* Load current settings (cache-bust via timestamp) */
    api('GET', '/settings?_t=' + Date.now()).then(function(data) {
        if (!data) return;
        for (var key in data) {
            var s = data[key];
            populateField(key, s.value, s.type);
        }
    });

    /* Save handler */
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        var saveBtn = document.getElementById('saveBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

        var payload = {};
        form.querySelectorAll('[data-setting]').forEach(function(el) {
            var key = el.getAttribute('data-setting');
            if (el.type === 'checkbox') {
                payload[key] = el.checked ? '1' : '0';
            } else {
                payload[key] = el.value;
            }
        });

        api('PUT', '/settings', payload).then(function(res) {
            if (res) {
                showSaveMsg('Settings saved successfully. The public site will reflect changes immediately.', 'success');
                /* Update live preview elements */
                var storeName = payload.store_name || '';
                if (storeName) {
                    var brandEl = document.querySelector('.sidebar-brand h2');
                    if (brandEl) {
                        var parts = storeName.trim().split(/\s+/);
                        if (parts.length > 1) {
                            brandEl.innerHTML = parts.slice(0, -1).join(' ') + ' <span>' + parts[parts.length - 1] + '</span>';
                        } else {
                            brandEl.textContent = storeName;
                        }
                    }
                }
                if (payload.site_title) {
                    var titleEl = document.querySelector('title');
                    if (titleEl) {
                        var base = titleEl.textContent.split(' - ').slice(1).join(' - ') || 'ADALINA Admin';
                        titleEl.textContent = payload.site_title + ' - ' + base;
                    }
                }
                if (payload.primary_color) {
                    document.documentElement.style.setProperty('--primary', payload.primary_color);
                }
                if (payload.secondary_color) {
                    document.documentElement.style.setProperty('--secondary', payload.secondary_color);
                    document.documentElement.style.setProperty('--sidebar-bg', payload.secondary_color);
                    document.documentElement.style.setProperty('--sidebar-hover', payload.secondary_color);
                }
                if (payload.background_color) {
                    document.documentElement.style.setProperty('--content-bg', payload.background_color);
                }
                if (payload.text_color) {
                    document.documentElement.style.setProperty('--text-dark', payload.text_color);
                }
                if (payload.logo_header) {
                    document.querySelectorAll('.sidebar-brand img').forEach(function(img) {
                        img.src = '/' + payload.logo_header;
                    });
                }
            } else {
                showSaveMsg('Failed to save settings. Check server logs.', 'error');
            }
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
        }).catch(function() {
            showSaveMsg('Network error. Please try again.', 'error');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
        });
    });
}

function populateField(key, val, type) {
    /* Find elements by data-setting attribute */
    var els = document.querySelectorAll('[data-setting="' + key + '"]');
    els.forEach(function(el) {
        if (el.type === 'checkbox') {
            el.checked = val === true || val === '1';
            /* Update toggle slider visual */
            var slider = el.nextElementSibling;
            if (slider && slider.classList.contains('toggle-slider')) {
                slider.style.background = el.checked ? 'var(--primary)' : '#ccc';
            }
        } else if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
            el.value = val || '';
        } else if (el.type === 'color' || el.type === 'text') {
            el.value = val || '';
        } else {
            el.value = val || '';
        }
    });

    /* Update image previews */
    var preview = document.getElementById(key + '_preview');
    var nameEl = document.getElementById(key + '_name');
    var clearBtn = document.getElementById(key + '_clear');
    if (preview && val) {
        preview.src = '/' + val;
        preview.style.display = 'block';
        if (nameEl) nameEl.textContent = val.split('/').pop();
        if (clearBtn) clearBtn.style.display = 'inline-block';
    } else if (preview) {
        preview.src = '';
        preview.style.display = 'none';
        if (nameEl) nameEl.textContent = 'No file selected';
        if (clearBtn) clearBtn.style.display = 'none';
    }

    /* Update color picker when text field changes */
    var textInput = document.querySelector('[data-setting="' + key + '"][type="text"]');
    var colorPicker = document.querySelector('[data-setting="' + key + '"][type="color"]');
    if (textInput && colorPicker && /^#[0-9a-f]{6}$/i.test(val)) {
        colorPicker.value = val;
    }
}

function showSaveMsg(text, type) {
    var el = document.getElementById('saveMsg');
    if (!el) return;
    el.textContent = text;
    el.className = 'save-msg' + (type === 'error' ? ' error' : '');
    el.classList.remove('hidden');
    if (type !== 'error') setTimeout(function() { el.classList.add('hidden'); }, 5000);
}

/* Sync toggle slider with checkbox */
document.addEventListener('change', function(e) {
    if (e.target.type === 'checkbox' && e.target.hasAttribute('data-setting')) {
        var slider = e.target.nextElementSibling;
        if (slider && slider.classList.contains('toggle-slider')) {
            slider.style.background = e.target.checked ? 'var(--primary)' : '#ccc';
        }
    }
});

/* ── Nav Tabs ── */
function openTab(name) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tab = document.getElementById(name);
    if (tab) tab.classList.add('active');
    const btn = document.querySelector(`.tab-btn[onclick*="${name}"]`);
    if (btn) btn.classList.add('active');
}

/* ── Toast + Error helper ── */
function showToast(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--success);color:#fff;padding:12px 20px;border-radius:8px;font-size:0.9rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 3000);
}

function showAdminError(msg) {
    /* Persistent error banner at top of page */
    var existing = document.getElementById('admin-error-banner');
    if (existing) {
        existing.querySelector('.admin-error-text').textContent = msg;
        existing.style.display = 'flex';
        return;
    }
    var banner = document.createElement('div');
    banner.id = 'admin-error-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#e53e3e;color:#fff;padding:10px 20px;display:flex;align-items:center;gap:12px;font-size:0.85rem;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    banner.innerHTML = '<span style="flex:1;" class="admin-error-text">' + esc(msg) + '</span>' +
        '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:1.2rem;padding:0 4px;">&times;</button>';
    document.body.appendChild(banner);
    /* Auto-dismiss after 10s */
    setTimeout(function() { if (banner.parentElement) banner.remove(); }, 10000);
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', function () {
    const page = window.location.pathname.split('/').pop() || 'dashboard.html';

    /* sidebar toggle and active */
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger-btn');

    function toggleSidebar() { sidebar.classList.toggle('open'); if (overlay) overlay.classList.toggle('active'); }
    function closeSidebar() { sidebar.classList.remove('open'); if (overlay) overlay.classList.remove('active'); }

    if (hamburger) hamburger.addEventListener('click', toggleSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);

    document.querySelectorAll('.sidebar-nav a').forEach(function (link) {
        if (link.getAttribute('href') === page) link.classList.add('active');
        link.addEventListener('click', function () { if (window.innerWidth <= 768) closeSidebar(); });
    });

    /* modals */
    document.querySelectorAll('.modal-overlay').forEach(function (el) {
        el.addEventListener('click', function (e) { if (e.target === el) el.classList.remove('active'); });
    });
    document.querySelectorAll('[data-toggle="modal"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const target = document.getElementById(this.getAttribute('data-target'));
            if (target) target.classList.add('active');
        });
    });
    document.querySelectorAll('.modal-close').forEach(function (btn) {
        btn.addEventListener('click', function () { this.closest('.modal-overlay').classList.remove('active'); });
    });

    /* table sort */
    document.querySelectorAll('.table-sort').forEach(function (th) {
        th.addEventListener('click', function () {
            const table = this.closest('table');
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const index = this.cellIndex;
            const asc = this.classList.toggle('asc');
            rows.sort(function (a, b) {
                const aV = a.cells[index].textContent.trim(), bV = b.cells[index].textContent.trim();
                const aN = parseFloat(aV), bN = parseFloat(bV);
                if (!isNaN(aN) && !isNaN(bN)) return asc ? aN - bN : bN - aN;
                return asc ? aV.localeCompare(bV) : bV.localeCompare(aV);
            });
            rows.forEach(function (row) { tbody.appendChild(row); });
        });
    });

    /* page init */
    switch (page) {
        case 'dashboard.html': initDashboard(); break;
        case 'products.html':
            initProducts();
            /* Product search (debounced) */
            var prodSearchInput = document.getElementById('products-search-input');
            if (prodSearchInput) {
                var prodSearchTimer;
                prodSearchInput.addEventListener('input', function () {
                    clearTimeout(prodSearchTimer);
                    prodSearchTimer = setTimeout(function () {
                        productFilterState.search = prodSearchInput.value.trim();
                        initProducts();
                    }, 300);
                });
            }
            /* Product category filter button + dropdown */
            var prodFilterBtn = document.querySelector('.page-header .btn-outline.btn-sm');
            if (prodFilterBtn) {
                prodFilterBtn.addEventListener('click', function () {
                    var existing = document.getElementById('products-category-dropdown');
                    if (existing) { existing.remove(); return; }
                    api('GET', '/categories').then(function (cats) {
                        if (!cats || !cats.length) return;
                        var dd = document.createElement('div');
                        dd.id = 'products-category-dropdown';
                        dd.style.cssText = 'position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:6px 0;z-index:100;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,.12);';
                        dd.innerHTML = '<div data-cat="" style="padding:6px 14px;cursor:pointer;font-size:0.85rem;'+(!productFilterState.category?'font-weight:600;color:var(--primary,#c9a96e);':'')+'">Toutes les catégories</div>' +
                            cats.map(function (c) { return '<div data-cat="'+esc(c.name)+'" style="padding:6px 14px;cursor:pointer;font-size:0.85rem;'+(productFilterState.category===c.name?'font-weight:600;color:var(--primary,#c9a96e);':'')+'">'+esc(c.name)+'</div>'; }).join('');
                        dd.querySelectorAll('div[data-cat]').forEach(function (el) {
                            el.addEventListener('mouseenter', function () { this.style.background = 'var(--bg-secondary,#f7f5f0)'; });
                            el.addEventListener('mouseleave', function () { this.style.background = ''; });
                            el.addEventListener('click', function () {
                                productFilterState.category = this.dataset.cat;
                                dd.remove();
                                initProducts();
                            });
                        });
                        prodFilterBtn.style.position = 'relative';
                        prodFilterBtn.appendChild(dd);
                        document.addEventListener('click', function handler(e) {
                            if (!dd.contains(e.target) && e.target !== prodFilterBtn && !prodFilterBtn.contains(e.target)) {
                                dd.remove();
                                document.removeEventListener('click', handler);
                            }
                        });
                    });
                });
            }
            break;
        case 'categories.html': initCategories(); break;
        case 'collections.html': initCollections(); break;
        case 'orders.html':
            initOrders();
            var openId = sessionStorage.getItem('openOrderId');
            if (openId) {
                sessionStorage.removeItem('openOrderId');
                setTimeout(function () { viewOrder(parseInt(openId)); }, 100);
            }
            /* Back button */
            var backBtn = document.getElementById('order-detail-back');
            if (backBtn) backBtn.addEventListener('click', closeOrderDetail);
            /* Status filter */
            var orderFilter = document.getElementById('order-status-filter');
            if (orderFilter) {
                orderFilter.addEventListener('change', function () {
                    ordersFilterStatus = this.value;
                    renderOrdersTable();
                });
            }
            /* Search (debounced) */
            var searchInput = document.getElementById('orders-search-input');
            if (searchInput) {
                var orderSearchTimer;
                var searchWrapper = searchInput.closest('.orders-search');
                function updateSearchClear() {
                    if (searchWrapper) {
                        searchWrapper.classList.toggle('has-value', searchInput.value.length > 0);
                    }
                }
                searchInput.addEventListener('input', function () {
                    updateSearchClear();
                    clearTimeout(orderSearchTimer);
                    orderSearchTimer = setTimeout(function () {
                        renderOrdersTable();
                    }, 300);
                });
                var clearBtn = searchWrapper ? searchWrapper.querySelector('.orders-search-clear') : null;
                if (clearBtn) {
                    clearBtn.addEventListener('click', function () {
                        searchInput.value = '';
                        updateSearchClear();
                        clearTimeout(orderSearchTimer);
                        renderOrdersTable();
                        searchInput.focus();
                    });
                }
                updateSearchClear();
            }
            break;
        case 'customers.html': initCustomers(); break;
        case 'inventory.html': initInventory(); break;
        case 'analytics.html': initAnalytics(); break;
        case 'settings.html': initSettings(); break;
    }

    initNotifications();

    /* customer detail modal close */
    const detailModal = document.getElementById('customer-detail-modal');
    if (detailModal) {
        detailModal.addEventListener('click', function (e) {
            if (e.target === this) this.classList.remove('active');
        });
    }

    /* inventory status tabs */
    document.querySelectorAll('.inv-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.inv-tab').forEach(function (t) { t.classList.remove('active'); });
            this.classList.add('active');
            invStatusFilter = this.dataset.status;
            /* also clear category filter */
            var catF = document.getElementById('inv-category-filter');
            if (catF) catF.value = '';
            initInventory();
        });
    });

    /* inventory category filter */
    const invFilter = document.getElementById('inv-category-filter');
    if (invFilter) {
        invFilter.addEventListener('change', function () {
            const val = this.value.toLowerCase();
            document.querySelectorAll('#inventory-table tbody tr').forEach(function (row) {
                var cat = (row.cells[2]?.textContent || '').toLowerCase();
                row.style.display = !val || cat === val ? '' : 'none';
            });
        });
    }

    /* inventory search */
    const invSearch = document.getElementById('inv-search-input');
    if (invSearch) {
        invSearch.addEventListener('input', function () {
            var val = this.value.toLowerCase().trim();
            document.querySelectorAll('#inventory-table tbody tr').forEach(function (row) {
                var text = (row.cells[0]?.textContent || '').toLowerCase();
                row.style.display = text.indexOf(val) !== -1 ? '' : 'none';
            });
        });
    }

    /* stock modal controls */
    const stockModal = document.getElementById('stock-update-modal');
    if (stockModal) {
        document.getElementById('sum-inc-btn')?.addEventListener('click', function () {
            var inp = document.getElementById('sum-qty');
            inp.value = parseInt(inp.value) + 1;
        });
        document.getElementById('sum-dec-btn')?.addEventListener('click', function () {
            var inp = document.getElementById('sum-qty');
            var v = parseInt(inp.value);
            if (v > 1) inp.value = v - 1;
        });
        document.getElementById('sum-save-btn')?.addEventListener('click', function () {
            var pid = document.getElementById('sum-product-id').value;
            if (!pid) return;
            var absolute = document.getElementById('sum-absolute').value;
            var reason = document.getElementById('sum-reason').value;
            if (absolute !== '') {
                api('PUT', '/inventory/' + pid, { quantity: parseInt(absolute), reason: reason }).then(function (r) {
                    if (r) { closeStockModal(); initInventory(); }
                });
            } else {
                var qty = parseInt(document.getElementById('sum-qty').value) || 1;
                api('POST', '/inventory/' + pid + '/adjust', { change: qty, reason: reason }).then(function (r) {
                    if (r) { closeStockModal(); initInventory(); }
                });
            }
        });
    }

});

/* product form setup — also handles the add button opening blank form */
document.addEventListener('DOMContentLoaded', function () {
    const addBtn = document.querySelector('[data-target="product-modal"]');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            document.getElementById('pm-id').value = '';
            document.getElementById('product-form').reset();
            productVariants = [];
            renderVariants();
        });
    }
    const addCatBtn = document.querySelector('[data-target="category-modal"]');
    if (addCatBtn) {
        addCatBtn.addEventListener('click', function () {
            document.getElementById('category-form').reset();
        });
    }
    const addCollBtn = document.querySelector('[data-target="collection-modal"]');
    if (addCollBtn) {
        addCollBtn.addEventListener('click', function () {
            document.getElementById('collection-form').reset();
        });
    }

    /* ── Image Manager ── */
    let currentImages = [];
    let imProductId = null;
    let dragSrcIndex = null;

    window.openImageManager = async function (productId) {
        imProductId = productId;
        const p = await api('GET', '/products/' + productId);
        if (!p) return;
        document.getElementById('im-product-id').value = productId;
        document.getElementById('im-product-name').textContent = p.name || 'Product #' + productId;
        currentImages = Array.isArray(p.images) ? p.images : [];
        renderImageGrid();
        document.getElementById('image-manager-modal').classList.add('active');
    };

    function renderImageGrid() {
        const grid = document.getElementById('image-grid');
        const empty = document.getElementById('image-grid-empty');
        if (!grid) return;
        if (currentImages.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';
        grid.innerHTML = currentImages.map(function (imgPath, i) {
            return '<div class="image-item' + (i === 0 ? ' primary' : '') + '" draggable="true" data-index="' + i + '" data-path="' + esc(imgPath) + '">' +
                '<img src="/' + esc(imgPath) + '" alt="" onerror="this.src=\'https://placehold.co/200x200/e2e8f0/718096?text=?\'' +
                'this.style.border=\'2px solid #f56565\'">' +
                (i === 0 ? '<span class="primary-badge">Primary</span>' : '') +
                '<div class="image-actions">' +
                (i !== 0 ? '<button class="main-btn" onclick="setMainImage(' + i + ')" title="Set as Main Image"><i class="fas fa-star"></i></button>' : '') +
                '<button class="del-btn" onclick="deleteImage(event,' + i + ')" title="Delete"><i class="fas fa-times"></i></button>' +
                '</div>' +
                '</div>';
        }).join('');
        grid.querySelectorAll('.image-item').forEach(function (item) {
            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragenter', handleDragEnter);
            item.addEventListener('dragover', handleDragOver);
            item.addEventListener('dragleave', handleDragLeave);
            item.addEventListener('drop', handleDrop);
            item.addEventListener('dragend', handleDragEnd);
        });
    }

    function handleDragStart(e) {
        dragSrcIndex = parseInt(this.dataset.index);
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.index);
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDragEnter(e) {
        e.preventDefault();
        this.classList.add('drag-over');
    }

    function handleDragLeave() {
        this.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        var targetIndex = parseInt(this.dataset.index);
        if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
            var moved = currentImages.splice(dragSrcIndex, 1)[0];
            currentImages.splice(targetIndex, 0, moved);
            saveImageOrder();
        }
        this.classList.remove('drag-over');
        dragSrcIndex = null;
    }

    function handleDragEnd() {
        this.classList.remove('dragging');
        document.querySelectorAll('.image-item').forEach(function (el) {
            el.classList.remove('drag-over');
        });
    }

    async function saveImageOrder() {
        await api('PUT', '/products/' + imProductId, { images: currentImages });
        renderImageGrid();
    }

    window.deleteImage = async function (e, index) {
        e.stopPropagation();
        if (!confirm('Delete this image?')) return;
        var path = currentImages[index];
        var res = await api('DELETE', '/products/' + imProductId + '/images', { path: path });
        if (res && res.images) {
            currentImages = res.images;
        } else {
            currentImages.splice(index, 1);
        }
        renderImageGrid();
    };

    window.setMainImage = async function (index) {
        var path = currentImages[index];
        var res = await api('PUT', '/products/' + imProductId + '/images/main', { path: path });
        if (res && res.images) {
            currentImages = res.images;
            renderImageGrid();
        }
    };

    /* Upload zone */
    var uploadZone = document.getElementById('upload-zone');
    var fileInput = document.getElementById('file-input');
    if (uploadZone && fileInput) {
        uploadZone.addEventListener('dragover', function (e) {
            e.preventDefault();
            this.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', function () {
            this.classList.remove('dragover');
        });
        uploadZone.addEventListener('drop', function (e) {
            e.preventDefault();
            this.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });
        uploadZone.addEventListener('click', function () {
            fileInput.click();
        });
        fileInput.addEventListener('change', function () {
            handleFiles(this.files);
            this.value = '';
        });
    }

    function handleFiles(files) {
        var validExts = ['.jpg', '.jpeg', '.png', '.webp'];
        var maxSize = 10 * 1024 * 1024;
        var toUpload = [];
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var name = f.name || '';
            var ext = '.' + name.split('.').pop().toLowerCase();
            if (validExts.indexOf(ext) === -1) {
                var guess = name || 'file #' + (i + 1);
                if (confirm(guess + ': unsupported format. Use JPG, PNG, or WEBP. Skip it?')) continue;
                else return;
            }
            if (f.size > maxSize) {
                if (confirm((name || 'file') + ': too large (max 10MB). Skip it?')) continue;
                else return;
            }
            toUpload.push(f);
        }
        if (toUpload.length === 0) return;
        uploadFiles(toUpload);
    }

    async function uploadFiles(files) {
        var prog = document.getElementById('upload-progress');
        var fill = document.getElementById('progress-fill');
        var text = document.getElementById('progress-text');
        if (prog) prog.style.display = 'block';
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (text) text.textContent = 'Uploading ' + (file.name || 'image') + ' (' + (i + 1) + '/' + files.length + ')...';
            var fd = new FormData();
            fd.append('images', file);
            var res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
            var data = await res.json();
            if (data.paths && data.paths.length > 0) {
                for (var j = 0; j < data.paths.length; j++) {
                    currentImages.push(data.paths[j]);
                }
            }
            if (fill) fill.style.width = ((i + 1) / files.length * 100) + '%';
        }
        if (prog) prog.style.display = 'none';
        await saveImageOrder();
    }

});
