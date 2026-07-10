/* ── Taille Groupings — SINGLE SOURCE OF TRUTH ── */
/* Taille 1: 32, 34, 36, 38 */
/* Taille 2: 40, 42, 44, 46 */
/* Taille 3: 48, 50, 52 */
window.SIZE_GROUPS = [
    { label: 'Taille 1', sizes: [32, 34, 36, 38] },
    { label: 'Taille 2', sizes: [40, 42, 44, 46] },
    { label: 'Taille 3', sizes: [48, 50, 52] }
];

window.getSizeGroup = function(sizeName) {
    var num = parseInt(sizeName, 10);
    if (isNaN(num)) return null;
    for (var i = 0; i < window.SIZE_GROUPS.length; i++) {
        if (window.SIZE_GROUPS[i].sizes.indexOf(num) !== -1) return window.SIZE_GROUPS[i];
    }
    return null;
};
