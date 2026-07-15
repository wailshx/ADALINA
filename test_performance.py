#!/usr/bin/env python3
"""
test_performance.py — Validates performance optimizations against the live site.
Tests: gzip compression, cache headers, TTL cache speed.
Run: python3 test_performance.py [--base-url URL]
"""
import sys
import time
import gzip
import urllib.request
import urllib.error

BASE_URL = 'https://adalina.onrender.com'

if '--base-url' in sys.argv:
    idx = sys.argv.index('--base-url')
    BASE_URL = sys.argv[idx + 1]

passed = 0
failed = 0


def test(name, condition, detail=''):
    global passed, failed
    if condition:
        print(f'  PASS  {name}')
        passed += 1
    else:
        print(f'  FAIL  {name} — {detail}')
        failed += 1


def req(path, headers=None):
    url = BASE_URL + path
    r = urllib.request.Request(url, headers=headers or {})
    try:
        return urllib.request.urlopen(r, timeout=15)
    except urllib.error.HTTPError as e:
        return e


print(f'\n=== Performance Validation ({BASE_URL}) ===\n')

# --- Test 1: Gzip Compression ---
print('[1] Gzip Compression')

# API endpoint with gzip
resp = req('/api/public/settings', {'Accept-Encoding': 'gzip'})
ct = resp.headers.get('Content-Encoding', '')
test('API response has gzip Content-Encoding', 'gzip' in ct, f'got: {ct}')

# Read and verify it's actually gzip
body_gzip = resp.read()
test('Gzip response is valid gzip data', body_gzip[:2] == b'\x1f\x8b', f'header: {body_gzip[:2]}')

# HTML page with gzip
resp_html = req('/', {'Accept-Encoding': 'gzip'})
ct_html = resp_html.headers.get('Content-Encoding', '')
test('HTML response has gzip Content-Encoding', 'gzip' in ct_html, f'got: {ct_html}')

# Without gzip header — should not be gzipped
resp_no = req('/api/public/settings')
ct_no = resp_no.headers.get('Content-Encoding', '')
test('Response without Accept-Encoding is not gzipped', ct_no == '', f'got: {ct_no}')

# Verify gzip actually saves bytes
resp_with = req('/api/public/settings', {'Accept-Encoding': 'gzip'})
resp_without = req('/api/public/settings')
size_with_gz = len(resp_with.read())
size_without_gz = len(resp_without.read())
if size_without_gz > 0:
    savings = (1 - size_with_gz / size_without_gz) * 100
    test(f'Gzip saves bytes ({size_with_gz} vs {size_without_gz}, {savings:.0f}% reduction)',
         size_with_gz < size_without_gz, f'with: {size_with_gz}, without: {size_without_gz}')
else:
    test('Gzip saves bytes', False, 'empty response')

# --- Test 2: Static Asset Cache Headers ---
print('\n[2] Static Asset Caching')

resp_css = req('/website/css/styles.css?v=abc123test')
cc_css = resp_css.headers.get('Cache-Control', '')
test('CSS has immutable Cache-Control', 'immutable' in cc_css, f'got: {cc_css}')
test('CSS max-age >= 31536000', 'max-age=31536000' in cc_css, f'got: {cc_css}')

resp_js = req('/website/js/script.js?v=abc123test')
cc_js = resp_js.headers.get('Cache-Control', '')
test('JS has immutable Cache-Control', 'immutable' in cc_js, f'got: {cc_js}')

resp_svg = req('/images/favicon.svg?v=abc123test')
cc_svg = resp_svg.headers.get('Cache-Control', '')
test('SVG has immutable Cache-Control', 'immutable' in cc_svg, f'got: {cc_svg}')

# --- Test 3: HTML Cache Headers ---
print('\n[3] HTML Cache Headers')

resp_index = req('/')
cc_index = resp_index.headers.get('Cache-Control', '')
test('HTML has no-cache', 'no-cache' in cc_index, f'got: {cc_index}')

# --- Test 4: API Cache Headers ---
print('\n[4] API Response Caching')

resp_settings = req('/api/public/settings')
cc_settings = resp_settings.headers.get('Cache-Control', '')
test('Settings API has public cache', 'public' in cc_settings and 'max-age' in cc_settings, f'got: {cc_settings}')

resp_cats = req('/api/public/categories')
cc_cats = resp_cats.headers.get('Cache-Control', '')
test('Categories API has public cache', 'public' in cc_cats and 'max-age' in cc_cats, f'got: {cc_cats}')

resp_featured = req('/api/public/products/featured')
cc_feat = resp_featured.headers.get('Cache-Control', '')
test('Featured API has public cache', 'public' in cc_feat and 'max-age' in cc_feat, f'got: {cc_feat}')

# --- Test 5: TTL Cache Speed ---
print('\n[5] TTL Cache Speed (repeated requests)')

# Warm up
req('/api/public/settings')

times = []
for _ in range(5):
    t0 = time.perf_counter()
    req('/api/public/settings')
    t1 = time.perf_counter()
    times.append(t1 - t0)

avg_cached = sum(times) / len(times)
print(f'  Cached avg: {avg_cached*1000:.0f}ms (5 requests)')
test('Cached requests complete', avg_cached < 5.0, f'avg: {avg_cached:.2f}s')

# --- Test 6: Threaded Server ---
print('\n[6] Concurrent Request Handling')

import concurrent.futures

def fetch_one(_):
    t0 = time.perf_counter()
    req('/api/public/settings')
    return time.perf_counter() - t0

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    t0 = time.perf_counter()
    results = list(pool.map(fetch_one, range(10)))
    total = time.perf_counter() - t0

test('10 concurrent requests complete', total < 10.0, f'total: {total:.2f}s')
avg_concurrent = sum(results) / len(results)
test('Concurrent avg < 3s per request', avg_concurrent < 3.0, f'avg: {avg_concurrent:.2f}s')

# --- Summary ---
print(f'\n=== Results: {passed} passed, {failed} failed ===\n')
sys.exit(1 if failed else 0)
