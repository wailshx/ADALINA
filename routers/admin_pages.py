import os
import secrets
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Depends, Form
from starlette.responses import RedirectResponse, HTMLResponse

from routers.admin_api import (
    require_admin_auth, get_session, create_session, delete_session,
    save_csrf_token, get_csrf_token_for_session, get_token_from_cookies,
    touch_session, _hash_password, _verify_password,
    ADMIN_USERNAME, ADMIN_PASSWORD_HASH, ADMIN_PASSWORD_SALT,
    _login_limiter, _get_build_version, secure_path,
    generate_csrf_token, audit_log, _get_client_ip,
    PROJECT_ROOT, ADMIN_DIR,
)

router = APIRouter(prefix='/admin', tags=['admin-pages'])


def _is_authenticated(request: Request) -> bool:
    token = request.cookies.get('admin_session')
    return bool(token and get_session(token))


def _serve_admin_html(file_path: str, request: Request) -> HTMLResponse:
    if not os.path.isfile(file_path):
        return HTMLResponse(content='404 Not Found', status_code=404)
    token = request.cookies.get('admin_session')
    csrf_val = get_csrf_token_for_session(token) if token else ''
    if not csrf_val:
        return HTMLResponse(content='403 Forbidden', status_code=403)
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    csrf_script = f'<script>window.__csrf="{csrf_val}"</script>'
    content = content.replace('<head>', '<head>' + csrf_script, 1)
    content = content.replace('?v=__BUILD__', '?v=' + _get_build_version())
    return HTMLResponse(content=content, headers={
        'Cache-Control': 'no-cache, must-revalidate',
        'Pragma': 'no-cache',
    })


@router.get('/login')
def login_page(request: Request):
    if _is_authenticated(request):
        return RedirectResponse(url='/admin/dashboard.html', status_code=302)
    login_path = os.path.join(ADMIN_DIR, 'login.html')
    if not os.path.isfile(login_path):
        return HTMLResponse(content='Login page not found', status_code=404)
    with open(login_path, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace('?v=__BUILD__', '?v=' + _get_build_version())
    return HTMLResponse(content=content, headers={
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
    })


@router.post('/login')
async def login_submit(
    request: Request,
    username: str = Form(''),
    password: str = Form(''),
    remember: Optional[str] = Form(None),
):
    ip = _get_client_ip(request)
    if not _login_limiter.is_allowed(f'login:{ip}', max_requests=5, window=900):
        retry = _login_limiter.retry_after(f'login:{ip}', window=900)
        return HTMLResponse(content=f'Trop de tentatives. Réessayez dans {retry}s.', status_code=429)
    username = username.strip()
    if username == ADMIN_USERNAME and _verify_password(password, ADMIN_PASSWORD_HASH, ADMIN_PASSWORD_SALT):
        token = create_session(remember=(remember == 'on'))
        csrf = generate_csrf_token()
        save_csrf_token(token, csrf)
        max_age = 30 * 24 * 3600 if remember == 'on' else None
        secure = 'Secure' if os.environ.get('HTTPS', '') else ''
        response = RedirectResponse(url='/admin/dashboard.html', status_code=302)
        cookie_val = f'admin_session={token}; Path=/; HttpOnly; SameSite=Lax; {secure}'.strip()
        if max_age:
            cookie_val += f'; Max-Age={max_age}'
        response.set_cookie(
            'admin_session', token,
            max_age=max_age,
            httponly=True,
            samesite='lax',
            secure=bool(os.environ.get('HTTPS', '')),
        )
        response.set_cookie(
            'csrf_token', csrf,
            httponly=False,
            samesite='lax',
            secure=bool(os.environ.get('HTTPS', '')),
        )
        audit_log.log('LOGIN_SUCCESS', username, ip=ip)
        return response
    else:
        audit_log.log('LOGIN_FAILED', username, f'bad password from {ip}', ip=ip)
        return RedirectResponse(url='/admin/login?error=1', status_code=302)


@router.get('/logout')
def logout(request: Request):
    token = request.cookies.get('admin_session')
    if token:
        delete_session(token)
    response = RedirectResponse(url='/admin/login', status_code=302)
    response.delete_cookie('admin_session', path='/', httponly=True)
    response.delete_cookie('csrf_token', path='/')
    return response


@router.get('/{path:path}')
def serve_admin_page(path: str, request: Request, session_token: str = Depends(require_admin_auth)):
    if not path:
        path = 'dashboard.html'
    real = os.path.realpath(os.path.join(ADMIN_DIR, path))
    if not real.startswith(os.path.realpath(ADMIN_DIR)):
        raise HTTPException(status_code=403)
    if not os.path.isfile(real):
        return HTMLResponse(content='404 Not Found', status_code=404)
    if real.endswith('.html'):
        return _serve_admin_html(real, request)
    ext = os.path.splitext(real)[1].lower()
    mime_map = {
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.txt': 'text/plain; charset=utf-8',
    }
    import mimetypes
    mime = mime_map.get(ext) or mimetypes.guess_type(real)[0] or 'application/octet-stream'
    try:
        with open(real, 'rb') as f:
            content = f.read()
    except Exception:
        return HTMLResponse(content='Error reading file', status_code=500)
    headers = {}
    if 'text/' in mime or 'application/javascript' in mime:
        headers['Cache-Control'] = 'no-store, must-revalidate'
        headers['Pragma'] = 'no-cache'
    return HTMLResponse(content=content, media_type=mime, headers=headers)
