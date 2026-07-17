import os
import http.client
import json
import ssl
import base64
import urllib.parse
import time


def _get_config():
    cloud = os.environ.get('CLOUDINARY_CLOUD_NAME', '')
    key = os.environ.get('CLOUDINARY_API_KEY', '')
    secret = os.environ.get('CLOUDINARY_API_SECRET', '')
    return cloud, key, secret


def _auth_header():
    _, key, secret = _get_config()
    if key and secret:
        return base64.b64encode(f'{key}:{secret}'.encode()).decode()
    return ''


def is_enabled():
    cloud, key, secret = _get_config()
    return bool(cloud and key and secret)


def _get_conn():
    return http.client.HTTPSConnection('api.cloudinary.com', timeout=30, context=ssl.create_default_context())


def upload_file(file_bytes, storage_path, content_type='image/jpeg'):
    if not is_enabled():
        return None
    cloud, _, _ = _get_config()
    auth = _auth_header()
    b64_data = base64.b64encode(file_bytes).decode()
    data_url = f'data:{content_type};base64,{b64_data}'
    boundary = f'boundary{int(time.time() * 1000)}'
    parts = []
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\n{data_url}')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="public_id"\r\n\r\n{storage_path}')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="resource_type"\r\n\r\nimage')
    body = '\r\n'.join(parts) + f'\r\n--{boundary}--\r\n'
    headers = {
        'Authorization': f'Basic {auth}',
        'Content-Type': f'multipart/form-data; boundary={boundary}',
    }
    conn = _get_conn()
    try:
        conn.request('POST', f'/v1_1/{cloud}/image/upload', body=body.encode(), headers=headers)
        resp = conn.getresponse()
        resp_body = resp.read()
        if resp.status in (200, 201):
            data = json.loads(resp_body)
            return data.get('secure_url') or data.get('url')
        else:
            print(f'[Storage] Cloudinary upload failed: {resp.status} {resp_body.decode("utf-8", errors="replace")}')
            return None
    except Exception as e:
        print(f'[Storage] Cloudinary upload exception: {e}')
        return None
    finally:
        conn.close()


def delete_file(storage_path):
    if not is_enabled():
        return False
    cloud, _, _ = _get_config()
    auth = _auth_header()
    public_id = storage_path
    for ext in ('.jpeg', '.jpg', '.png', '.webp'):
        if public_id.endswith(ext):
            public_id = public_id.rsplit('.', 1)[0]
            break
    headers = {
        'Authorization': f'Basic {auth}',
    }
    conn = _get_conn()
    try:
        encoded_id = urllib.parse.quote(public_id, safe='')
        conn.request('DELETE', f'/v1_1/{cloud}/resources/image/upload/{encoded_id}', headers=headers)
        resp = conn.getresponse()
        resp.read()
        return resp.status in (200, 204, 404)
    except Exception as e:
        print(f'[Storage] Cloudinary delete exception: {e}')
        return False
    finally:
        conn.close()


def get_public_url(storage_path):
    cloud, _, _ = _get_config()
    return f'https://res.cloudinary.com/{cloud}/image/upload/{storage_path}'


def path_from_url(url):
    if not url:
        return ''
    cloud, _, _ = _get_config()
    prefix = f'https://res.cloudinary.com/{cloud}/image/upload/'
    if url.startswith(prefix):
        return url[len(prefix):]
    if '/image/upload/' in url:
        idx = url.find('/image/upload/')
        return url[idx + len('/image/upload/'):]
    return url


def is_cloudinary_url(url):
    if not url:
        return False
    return 'cloudinary.com' in url


def is_supabase_url(url):
    if not url:
        return False
    return 'supabase.co/storage/' in url
