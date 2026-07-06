/* ── API Client ── */
const API = '/api';
async function api(method, url, data) {
    const opts = { method, headers: {} };
    if (data) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
    }
    const res = await fetch(API + url, opts);
    if (!res.ok && res.status === 302) { window.location.href = '/admin/login'; return null; }
    return res.json();
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
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

function badge(status) {
    const m = {
        delivered: 'badge-success', active: 'badge-success', 'in stock': 'badge-success', published: 'badge-success',
        processing: 'badge-warning', pending: 'badge-warning', draft: 'badge-warning', low: 'badge-warning',
        shipped: 'badge-info',
        new: 'badge-info', confirmed: 'badge-info', preparing: 'badge-warning',
        cancelled: 'badge-danger', banned: 'badge-danger', 'out of stock': 'badge-danger', hidden: 'badge-danger',
    };
    const s = (status || '').toLowerCase();
    return `<span class="badge ${m[s] || 'badge-gray'}">${esc(status)}</span>`;
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
                <td>$${Number(o.total).toFixed(2)}</td>
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
                <td>$${Number(p.price).toFixed(2)}</td>
                <td>${p.sold||0}</td>
                <td>$${((p.sold||0) * Number(p.price)).toFixed(0)}</td>
            </tr>`;
        }).join('');
    }

    /* Recent Products */
    var rpTbody = document.querySelector('#recent-products-table tbody');
    if (rpTbody && d.recent_products) {
        rpTbody.innerHTML = d.recent_products.map(function(p) { return `
            <tr>
                <td><div class="product-cell"><img src="/${esc(p.image)}" alt="" onerror="this.src='https://placehold.co/40x40/e2e8f0/718096?text=P'"><div class="info"><div class="name">${esc(p.name)}</div></div></div></td>
                <td>$${Number(p.price).toFixed(2)}</td>
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
                    datasets: [{ label: 'Orders', data: d.monthly_orders, backgroundColor: 'rgba(201, 169, 110, 0.6)', borderColor: '#c9a96e', borderWidth: 1 }]
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

/* ── Products ── */
async function initProducts() {
    const products = await api('GET', '/products');
    if (!products) return;
    const tbody = document.querySelector('#products-table tbody');
    if (!tbody) return;
    tbody.innerHTML = products.map(p => `
        <tr>
            <td><div class="product-cell"><img src="/${esc(p.image)}" alt="" onerror="this.src='https://placehold.co/40x40/e2e8f0/718096?text=P'"><div class="info"><div class="name">${esc(p.name)}</div></div></div></td>
            <td>SKU-${p.id}</td>
            <td>${esc(p.category_name||'')}</td>
            <td>$${Number(p.price).toFixed(2)}</td>
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

window.editProduct = async function(id) {
    const p = await api('GET', `/products/${id}`);
    if (!p) return;
    const modal = document.getElementById('product-modal');
    document.getElementById('pm-id').value = p.id;
    document.getElementById('pm-name').value = p.name || '';
    document.getElementById('pm-price').value = p.price || 0;
    document.getElementById('pm-sale-price').value = p.sale_price || '';
    document.getElementById('pm-stock').value = p.stock || 0;
    document.getElementById('pm-brand').value = p.brand || '';
    document.getElementById('pm-desc').value = p.description || '';
    document.getElementById('pm-status').value = p.status || 'active';
    const feat = document.getElementById('pm-featured');
    if (feat) feat.checked = !!p.featured;
    const newArr = document.getElementById('pm-new-arrival');
    if (newArr) newArr.checked = !!p.new_arrival;
    const catSelect = document.getElementById('pm-category');
    if (catSelect) { catSelect.value = p.category_name || ''; }

    // Set sizes
    selectedSizes = p.sizes ? p.sizes.map(function(s) {
        if (typeof s === 'string') return { size: s };
        return { size: s.size || s };
    }) : [];

    // Set colors
    selectedColors = p.colors ? p.colors.map(function(c) {
        if (typeof c === 'string') return { name: c, hex: '' };
        return { name: c.name || c, hex: c.hex || '' };
    }) : [];

    // Set variants
    variantData = p.variants || [];

    renderSelectedSizes();
    renderSelectedColors();

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

/* ── Variants State ── */
var selectedColors = [];
var selectedSizes = [];
var PREDEFINED_COLORS = [
    { name: 'Black', hex: '#000000' },
    { name: 'White', hex: '#FFFFFF' },
    { name: 'Beige', hex: '#E8D7C3' },
    { name: 'Navy', hex: '#000080' },
    { name: 'Gray', hex: '#808080' },
    { name: 'Silver', hex: '#C0C0C0' },
    { name: 'Gold', hex: '#D4AF37' },
    { name: 'Red', hex: '#FF0000' },
    { name: 'Burgundy', hex: '#800020' },
    { name: 'Pink', hex: '#FF69B4' },
    { name: 'Rose Gold', hex: '#B76E79' },
    { name: 'Coral', hex: '#FF7F50' },
    { name: 'Orange', hex: '#FFA500' },
    { name: 'Yellow', hex: '#FFD700' },
    { name: 'Green', hex: '#008000' },
    { name: 'Forest Green', hex: '#228B22' },
    { name: 'Teal', hex: '#008080' },
    { name: 'Blue', hex: '#0000FF' },
    { name: 'Sky Blue', hex: '#87CEEB' },
    { name: 'Purple', hex: '#800080' },
    { name: 'Lavender', hex: '#E6E6FA' },
    { name: 'Brown', hex: '#A52A2A' },
    { name: 'Nude', hex: '#E8CBC0' },
    { name: 'Cream', hex: '#FFFDD0' },
    { name: 'Charcoal', hex: '#36454F' },
    { name: 'Crystal Clear', hex: '#E0F7FA' },
    { name: 'Aqua', hex: '#00FFFF' },
];

function initColorPicker() {
    var container = document.getElementById('predefined-colors');
    if (!container) return;
    container.innerHTML = '';
    PREDEFINED_COLORS.forEach(function(c) {
        var swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.cssText = 'width:32px;height:32px;border-radius:50%;background:' + c.hex + ';border:2px solid #ddd;cursor:pointer;position:relative;display:inline-flex;align-items:center;justify-content:center;';
        swatch.title = c.name;
        var inner = document.createElement('span');
        inner.style.cssText = 'font-size:0.55rem;font-weight:700;color:' + (isLight(c.hex) ? '#333' : '#fff') + ';text-shadow:0 0 2px rgba(0,0,0,0.3);';
        inner.textContent = c.name;
        swatch.appendChild(inner);
        swatch.addEventListener('click', function() {
            var idx = selectedColors.findIndex(function(s) { return s.name === c.name; });
            if (idx !== -1) {
                selectedColors.splice(idx, 1);
                swatch.style.borderColor = '#ddd';
                swatch.style.opacity = '0.5';
            } else {
                selectedColors.push({ name: c.name, hex: c.hex, stock: 0 });
                swatch.style.borderColor = '#333';
                swatch.style.opacity = '1';
            }
            renderSelectedColors();
        });
        container.appendChild(swatch);
    });
}

function renderSelectedSizes() {
    var container = document.getElementById('selected-sizes');
    if (!container) return;
    container.innerHTML = '';
    selectedSizes.forEach(function(s, i) {
        var chip = document.createElement('div');
        chip.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #ddd;border-radius:4px;font-size:0.8rem;background:#f5f5f5;';
        var nameSpan = document.createElement('span');
        nameSpan.textContent = s.size;
        nameSpan.style.cssText = 'color:#333;';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:1rem;line-height:1;color:#333;padding:0 2px;';
        removeBtn.addEventListener('click', function() {
            selectedSizes.splice(i, 1);
            renderSelectedSizes();
        });
        chip.appendChild(nameSpan);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
    renderVariantMatrix();
}

function renderVariantMatrix() {
    var container = document.getElementById('variant-matrix');
    if (!container) return;
    if (selectedColors.length === 0 || selectedSizes.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:12px;">Add at least one color and one size to manage variant stock.</p>';
        return;
    }
    var html = '<table class="variant-matrix-table"><thead><tr><th></th>';
    selectedSizes.forEach(function(s) {
        html += '<th>' + esc(s.size) + '</th>';
    });
    html += '</tr></thead><tbody>';
    selectedColors.forEach(function(c, ci) {
        html += '<tr><td class="matrix-color-cell"><span class="matrix-color-dot" style="background:' + (c.hex || '#ccc') + '"></span>' + esc(c.name) + '</td>';
        selectedSizes.forEach(function(s, si) {
            var val = getVariantStock(c.name, s.size);
            html += '<td><input type="number" min="0" class="matrix-stock-input" data-color="' + esc(c.name) + '" data-size="' + esc(s.size) + '" value="' + val + '" placeholder="0"></td>';
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

function getVariantStock(colorName, sizeName) {
    if (typeof variantData === 'undefined' || !variantData) return 0;
    for (var i = 0; i < variantData.length; i++) {
        if (variantData[i].color_name === colorName && variantData[i].size_name === sizeName) {
            return variantData[i].stock;
        }
    }
    return 0;
}

var variantData = [];

function collectVariants() {
    var result = [];
    document.querySelectorAll('#variant-matrix .matrix-stock-input').forEach(function(input) {
        var stock = parseInt(input.value) || 0;
        if (stock > 0) {
            result.push({
                color_name: input.getAttribute('data-color'),
                size_name: input.getAttribute('data-size'),
                stock: stock
            });
        }
    });
    return result;
}

function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function isLight(hex) {
    var c = hex.replace('#', '');
    var r = parseInt(c.substring(0,2), 16), g = parseInt(c.substring(2,4), 16), b = parseInt(c.substring(4,6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

function renderSelectedColors() {
    var container = document.getElementById('selected-colors');
    if (!container) return;
    container.innerHTML = '';
    selectedColors.forEach(function(c, i) {
        var chip = document.createElement('div');
        chip.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 8px;border:1px solid #ddd;border-radius:4px;font-size:0.8rem;background:' + (c.hex || '#f5f5f5') + ';';
        var nameSpan = document.createElement('span');
        nameSpan.textContent = c.name;
        nameSpan.style.cssText = 'color:' + (c.hex && !isLight(c.hex) ? '#fff' : '#333') + ';';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:1rem;line-height:1;color:' + (c.hex && !isLight(c.hex) ? '#fff' : '#333') + ';padding:0 2px;';
        removeBtn.addEventListener('click', function() {
            selectedColors.splice(i, 1);
            document.querySelectorAll('#predefined-colors .color-swatch').forEach(function(sw) {
                if (sw.title === c.name) {
                    sw.style.borderColor = '#ddd';
                    sw.style.opacity = '0.5';
                }
            });
            renderSelectedColors();
            renderVariantMatrix();
        });
        chip.appendChild(nameSpan);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
    renderVariantMatrix();
}

async function loadCategories() {
    var cats = await api('GET', '/categories');
    if (!cats) return;
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

document.addEventListener('DOMContentLoaded', function () {
    initColorPicker();
    loadCategories();

    const form = document.getElementById('product-form');
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            const id = document.getElementById('pm-id').value;

            // Collect sizes
            var sizes = selectedSizes.map(function(s) { return s.size; });

            // Collect colors
            var colors = selectedColors.map(function(c) {
                return { name: c.name, hex: c.hex || '' };
            });

            // Collect variants from matrix
            var variants = collectVariants();

            const data = {
                name: document.getElementById('pm-name').value,
                price: parseFloat(document.getElementById('pm-price').value) || 0,
                sale_price: parseFloat(document.getElementById('pm-sale-price').value) || null,
                stock: parseInt(document.getElementById('pm-stock').value) || 0,
                brand: document.getElementById('pm-brand').value,
                description: document.getElementById('pm-desc').value,
                category_name: document.getElementById('pm-category').value,
                status: document.getElementById('pm-status').value,
                featured: document.getElementById('pm-featured')?.checked ? 1 : 0,
                new_arrival: document.getElementById('pm-new-arrival')?.checked ? 1 : 0,
                sizes: sizes,
                colors: colors,
                variants: variants,
            };
            if (id) {
                await api('PUT', `/products/${id}`, data);
            } else {
                await api('POST', '/products', data);
            }
            document.getElementById('product-modal').classList.remove('active');
            initProducts();
        });
    }

    // Add custom color
    var addBtn = document.getElementById('add-custom-color-btn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            var name = document.getElementById('custom-color-name').value.trim();
            var hex = document.getElementById('custom-color-picker').value;
            if (!name) { alert('Enter a color name'); return; }
            if (selectedColors.some(function(c) { return c.name.toLowerCase() === name.toLowerCase(); })) {
                alert('Color "' + name + '" already added');
                return;
            }
            selectedColors.push({ name: name, hex: hex });
            document.getElementById('custom-color-name').value = '';
            renderSelectedColors();
        });
        document.getElementById('custom-color-name').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
        });
    }

    // Add custom size
    var addSizeBtn = document.getElementById('add-custom-size-btn');
    if (addSizeBtn) {
        addSizeBtn.addEventListener('click', function() {
            var name = document.getElementById('custom-size-input').value.trim();
            if (!name) { alert('Enter a size name'); return; }
            if (selectedSizes.some(function(s) { return s.size.toLowerCase() === name.toLowerCase(); })) {
                alert('Size "' + name + '" already added');
                return;
            }
            selectedSizes.push({ size: name, stock: 0 });
            document.getElementById('custom-size-input').value = '';
            renderSelectedSizes();
        });
        document.getElementById('custom-size-input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); addSizeBtn.click(); }
        });
    }

    const collForm = document.getElementById('collection-form');
    if (collForm) {
        collForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const data = {
                name: document.getElementById('coll-name').value,
                description: document.getElementById('coll-desc').value,
                status: document.getElementById('coll-status').value,
            };
            await api('POST', '/collections', data);
            document.getElementById('collection-modal').classList.remove('active');
            collForm.reset();
            initCollections();
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
    if (countEl) countEl.textContent = cats.length + ' categories';
    tbody.innerHTML = cats.map(c => {
        var imgHtml = c.image
            ? '<img src="/' + esc(c.image) + '" style="width:40px;height:40px;border-radius:6px;object-fit:cover;" onerror="this.style.display=\'none\'">'
            : '<div style="width:40px;height:40px;border-radius:6px;background:#ebf4ff;display:flex;align-items:center;justify-content:center;color:#4299e1;font-weight:700;font-size:1rem;">' + esc(c.name.charAt(0)) + '</div>';
        return '<tr>' +
            '<td>' + imgHtml + '</td>' +
            '<td><strong>' + esc(c.name) + '</strong></td>' +
            '<td>' + esc(c.slug) + '</td>' +
            '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(c.description || '') + '</td>' +
            '<td>' + (c.product_count || 0) + '</td>' +
            '<td>' + badge(c.status) + '</td>' +
            '<td style="text-align:right;">' +
            '<button class="btn btn-outline btn-sm" onclick="editCategory(' + c.id + ')"><i class="fas fa-edit"></i></button> ' +
            '<button class="btn btn-danger btn-sm" onclick="deleteCategory(' + c.id + ')"><i class="fas fa-trash"></i></button>' +
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
    document.getElementById('cat-image').value = c.image || '';
    var preview = document.getElementById('cat-image-preview');
    var removeBtn = document.getElementById('cat-remove-image');
    if (c.image) {
        preview.src = '/' + c.image;
        preview.style.display = 'block';
        removeBtn.style.display = 'inline-flex';
    } else {
        preview.style.display = 'none';
        removeBtn.style.display = 'none';
    }
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
            document.getElementById('cat-image-preview').style.display = 'none';
            document.getElementById('cat-remove-image').style.display = 'none';
            document.getElementById('cat-image').value = '';
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

    /* Category image upload */
    var catUploadZone = document.getElementById('cat-upload-zone');
    var catFileInput = document.getElementById('cat-file-input');
    var catImageInput = document.getElementById('cat-image');
    var catPreview = document.getElementById('cat-image-preview');
    var catRemoveBtn = document.getElementById('cat-remove-image');

    if (catUploadZone && catFileInput) {
        catUploadZone.addEventListener('dragover', function (e) { e.preventDefault(); this.classList.add('dragover'); });
        catUploadZone.addEventListener('dragleave', function () { this.classList.remove('dragover'); });
        catUploadZone.addEventListener('drop', function (e) {
            e.preventDefault();
            this.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) uploadCatImage(e.dataTransfer.files[0]);
        });
        catUploadZone.addEventListener('click', function () { catFileInput.click(); });
        catFileInput.addEventListener('change', function () {
            if (this.files.length > 0) uploadCatImage(this.files[0]);
            this.value = '';
        });
    }

    if (catRemoveBtn) {
        catRemoveBtn.addEventListener('click', function () {
            catImageInput.value = '';
            catPreview.style.display = 'none';
            catPreview.src = '';
            this.style.display = 'none';
        });
    }

    async function uploadCatImage(file) {
        var ext = '.' + file.name.split('.').pop().toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp'].indexOf(ext) === -1) {
            alert('Unsupported format. Use JPG, PNG, or WEBP.');
            return;
        }
        var fd = new FormData();
        fd.append('images', file);
        var res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
        var data = await res.json();
        if (data.paths && data.paths[0]) {
            catImageInput.value = data.paths[0];
            catPreview.src = '/' + data.paths[0];
            catPreview.style.display = 'block';
            catRemoveBtn.style.display = 'inline-flex';
        }
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
            image: document.getElementById('cat-image').value,
        };
        if (id) {
            await api('PUT', '/categories/' + id, data);
        } else {
            await api('POST', '/categories', data);
        }
        document.getElementById('category-modal').classList.remove('active');
        catForm.reset();
        document.getElementById('cat-image-preview').style.display = 'none';
        document.getElementById('cat-remove-image').style.display = 'none';
        initCategories();
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
        var fd = new FormData();
        fd.append('images', file);
        var res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
        var data = await res.json();
        if (data.paths && data.paths[0]) {
            imageInput.value = data.paths[0];
            preview.src = '/' + data.paths[0];
            preview.style.display = 'block';
            removeBtn.style.display = 'inline-flex';
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
    });
});

/* ── Orders ── */
async function initOrders() {
    const orders = await api('GET', '/orders');
    if (!orders) return;
    const tbody = document.querySelector('#orders-table tbody');
    if (!tbody) return;
    document.getElementById('order-count').textContent = orders.length + ' orders';
    tbody.innerHTML = orders.map(function (o) {
        var items = [];
        try { items = JSON.parse(o.items || '[]'); } catch (e) {}
        return '<tr>' +
            '<td>' + esc(o.order_number) + '</td>' +
            '<td><div class="customer-cell"><img src="' + avatarUrl(o.customer_name || '?') + '" alt=""><div class="name">' + esc(o.customer_name || '—') + '</div></div></td>' +
            '<td>' + (o.created_at ? timeAgo(o.created_at) : '—') + '</td>' +
            '<td>' + items.length + '</td>' +
            '<td>$' + Number(o.total).toFixed(2) + '</td>' +
            '<td>' + badge(o.status) + '</td>' +
            '<td style="text-align:right;"><button class="btn btn-outline btn-sm" onclick="viewOrder(' + o.id + ')"><i class="fas fa-eye"></i></button></td>' +
            '</tr>';
    }).join('');
}

window.viewOrder = async function (id) {
    var o = await api('GET', '/orders/' + id);
    if (!o) return;

    document.getElementById('om-order-id').value = o.id;
    document.getElementById('om-order-number').textContent = o.order_number || ('#' + o.id);
    document.getElementById('om-customer-name').textContent = o.customer_name || '—';
    document.getElementById('om-customer-phone').textContent = o.customer_phone || '';
    document.getElementById('om-date').textContent = o.created_at ? new Date(o.created_at).toLocaleString() : '—';
    document.getElementById('om-payment').textContent = o.payment_method || '—';
    document.getElementById('om-status').innerHTML = badge(o.status);
    document.getElementById('om-wilaya').textContent = o.wilaya || '—';
    document.getElementById('om-commune').textContent = o.commune || '—';
    document.getElementById('om-shipping').textContent = o.shipping_address || 'No shipping address provided.';

    /* Items */
    var items = [];
    try { items = o.items || JSON.parse(o.items || '[]'); } catch (e) { items = []; }
    document.getElementById('om-item-count').textContent = items.length;
    var itemsBody = document.getElementById('om-items-body');
    if (items.length === 0) {
        itemsBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No items in this order.</td></tr>';
    } else {
        itemsBody.innerHTML = items.map(function (item) {
            var name = item.name || item.product_name || 'Product #' + (item.product_id || item.id || '?');
            var color = item.color || item.selectedColor || '';
            var size = item.size || item.selectedSize || '';
            var price = Number(item.price || 0).toFixed(2);
            var qty = item.quantity || item.qty || 1;
            var sub = (Number(item.price || 0) * qty).toFixed(2);
            return '<tr><td>' + esc(name) + '</td><td>' + esc(color) + '</td><td>' + esc(size) + '</td><td>$' + price + '</td><td>' + qty + '</td><td>$' + sub + '</td></tr>';
        }).join('');
    }

    document.getElementById('om-total').textContent = '$' + Number(o.total || 0).toFixed(2);

    /* Set current status in dropdown */
    var statusSelect = document.getElementById('om-status-select');
    var currentStatus = (o.status || 'new').toLowerCase();
    if (statusSelect.querySelector('option[value="' + currentStatus + '"]')) {
        statusSelect.value = currentStatus;
    }
    document.getElementById('om-status-msg').style.display = 'none';

    document.getElementById('order-modal').classList.add('active');
};

/* Status save handler */
document.addEventListener('DOMContentLoaded', function () {
    var saveBtn = document.getElementById('om-save-status');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', async function () {
        var id = document.getElementById('om-order-id').value;
        var status = document.getElementById('om-status-select').value;
        if (!id) return;
        var res = await api('PUT', '/orders/' + id, { status: status });
        if (res) {
            document.getElementById('om-status').innerHTML = badge(status);
            var msg = document.getElementById('om-status-msg');
            msg.textContent = 'Status updated to ' + status.charAt(0).toUpperCase() + status.slice(1);
            msg.style.display = 'block';
            setTimeout(function () { msg.style.display = 'none'; }, 3000);
            initOrders();
        }
    });
});

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
            <td>$${Number(c.total_spent).toFixed(2)}</td>
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
    document.getElementById('stat-avg').textContent = '$' + avg.toFixed(2);
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
    document.getElementById('detail-spent').textContent = '$' + Number(c.total_spent || 0).toFixed(2);
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
                '<td>$' + Number(o.total || 0).toFixed(2) + '</td>' +
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
                (c.orders_count || 0) + ',$' + Number(c.total_spent || 0).toFixed(2) + ',"' + (c.status || '') + '","' + (c.joined_at || '') + '"\n';
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
    document.getElementById('ana-revenue').textContent = '$' + Number(s.revenue || 0).toLocaleString();
    document.getElementById('ana-orders').textContent = s.orders || 0;
    document.getElementById('ana-customers').textContent = s.customers || 0;
    document.getElementById('ana-avg-order').textContent = '$' + Number(s.avg_order_value || 0).toFixed(2);
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
    const colors = ['#c9a96e', '#48bb78', '#4299e1', '#9f7aea', '#ed8936', '#f56565', '#38b2ac', '#667eea', '#f6ad55', '#68d391', '#fc8181', '#a0aec0'];

    container.innerHTML = months.map(function (m, i) {
        var pct = (m.revenue / maxRev) * 100;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">' +
            '<div style="width:100%;background:' + colors[i % colors.length] + ';border-radius:4px 4px 0 0;height:' + pct + '%;min-height:4px;position:relative;" title="$' + Number(m.revenue).toLocaleString() + '">' +
                '<span style="position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:0.6rem;font-weight:600;color:var(--text-muted);white-space:nowrap;">$' + abbreviate(m.revenue) + '</span>' +
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
    const catColors = ['#c9a96e', '#4299e1', '#48bb78', '#ed8936', '#9f7aea', '#f56565', '#38b2ac', '#667eea'];

    container.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;">' +
        categories.map(function (c, i) {
            var pct = (c.revenue / totalRevenue) * 100;
            return '<div>' +
                '<div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px;">' +
                    '<span>' + esc(c.name) + '</span>' +
                    '<span style="font-weight:600;">$' + Number(c.revenue).toLocaleString() + ' (' + pct.toFixed(1) + '%)</span>' +
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
            '<td>$' + Number(p.price).toFixed(2) + '</td>' +
            '<td>' + (p.sold || 0) + '</td>' +
            '<td>$' + Number(p.revenue || 0).toFixed(2) + '</td>' +
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
            '<div style="width:100%;background:var(--primary);border-radius:2px 2px 0 0;height:' + pct + '%;min-height:3px;" title="$' + Number(d.revenue).toLocaleString() + ' (' + d.orders + ' orders)"></div>' +
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
        rows.push(['Revenue', '$' + s.revenue]);
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
function initSettings() {
    const form = document.getElementById('settings-form');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            alert('Settings saved (UI only — backend pending).');
        });
    }
}

/* ── Nav Tabs ── */
function openTab(name) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tab = document.getElementById(name);
    if (tab) tab.classList.add('active');
    const btn = document.querySelector(`.tab-btn[onclick*="${name}"]`);
    if (btn) btn.classList.add('active');
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
        case 'products.html': initProducts(); break;
        case 'categories.html': initCategories(); break;
        case 'collections.html': initCollections(); break;
        case 'orders.html': initOrders(); break;
        case 'customers.html': initCustomers(); break;
        case 'inventory.html': initInventory(); break;
        case 'analytics.html': initAnalytics(); break;
        case 'settings.html': initSettings(); break;
    }

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

    /* order status filter */
    const orderFilter = document.getElementById('order-status-filter');
    if (orderFilter) {
        orderFilter.addEventListener('change', function () {
            const val = this.value.toLowerCase();
            document.querySelectorAll('#orders-table tbody tr').forEach(row => {
                const status = (row.cells[5]?.textContent || '').toLowerCase();
                row.style.display = !val || status === val ? '' : 'none';
            });
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
            selectedColors = [];
            selectedSizes = [];
            variantData = [];
            renderSelectedColors();
            renderSelectedSizes();
            document.querySelectorAll('#predefined-colors .color-swatch').forEach(function(sw) {
                sw.style.borderColor = '#ddd';
                sw.style.opacity = '0.5';
            });
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
