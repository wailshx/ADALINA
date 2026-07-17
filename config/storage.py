import os
import http.client
import json
import ssl
import urllib.parse

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')
SUPABASE_BUCKET = os.environ.get('SUPABASE_BUCKET', 'ADALINA')

_write_key = SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY
_enabled = bool(SUPABASE_URL and _write_key)


def is_enabled():
    return _enabled


def _get_host():
    return urllib.parse.urlparse(SUPABASE_URL).hostname


def _get_base_path():
    return urllib.parse.urlparse(SUPABASE_URL).path.rstrip('/')


def upload_file(file_bytes, storage_path, content_type='image/jpeg'):
    if not _enabled:
        return None
    host = _get_host()
    base = _get_base_path()
    full_path = f'{base}/storage/v1/object/{SUPABASE_BUCKET}/{storage_path}'
    conn = http.client.HTTPSConnection(host, timeout=30, context=ssl.create_default_context())
    headers = {
        'apikey': _write_key,
        'Authorization': f'Bearer {_write_key}',
        'Content-Type': content_type,
        'x-upsert': 'true',
    }
    conn.request('POST', full_path, body=file_bytes, headers=headers)
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    if resp.status in (200, 201):
        return f'{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{storage_path}'
    else:
        print(f'[Storage] Upload failed: {resp.status} {body.decode("utf-8", errors="replace")}')
        return None


def delete_file(storage_path):
    if not _enabled:
        return False
    host = _get_host()
    base = _get_base_path()
    full_path = f'{base}/storage/v1/object/{SUPABASE_BUCKET}/{storage_path}'
    conn = http.client.HTTPSConnection(host, timeout=15, context=ssl.create_default_context())
    headers = {
        'apikey': _write_key,
        'Authorization': f'Bearer {_write_key}',
    }
    conn.request('DELETE', full_path, headers=headers)
    resp = conn.getresponse()
    resp.read()
    conn.close()
    return resp.status in (200, 204)


def get_public_url(storage_path):
    if not _enabled:
        return ''
    return f'{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{storage_path}'


def path_from_url(url):
    if not url:
        return ''
    prefix = f'{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/'
    if url.startswith(prefix):
        return url[len(prefix):]
    if 'supabase.co/storage/' in url:
        idx = url.find(f'/{SUPABASE_BUCKET}/')
        if idx >= 0:
            return url[idx + len(SUPABASE_BUCKET) + 2:]
    return url


def is_supabase_url(url):
    if not url:
        return False
    return 'supabase.co/storage/' in url or (SUPABASE_URL and url.startswith(SUPABASE_URL))
