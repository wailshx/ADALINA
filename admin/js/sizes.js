/* ── Taille Groupings — SINGLE SOURCE OF TRUTH ── */
/* Taille 1: 36, 38, 40 */
/* Taille 2: 42, 44, 46 */
/* Taille 3: 48, 50, 52 */
window.SIZE_GROUPS = [
    { label: 'Taille 1', sizes: [36, 38, 40] },
    { label: 'Taille 2', sizes: [42, 44, 46] },
    { label: 'Taille 3', sizes: [48, 50, 52] }
];

window.STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

window.getSizeGroup = function(sizeName) {
    var num = parseInt(sizeName, 10);
    if (isNaN(num)) return null;
    for (var i = 0; i < window.SIZE_GROUPS.length; i++) {
        if (window.SIZE_GROUPS[i].sizes.indexOf(num) !== -1) return window.SIZE_GROUPS[i];
    }
    return null;
};
