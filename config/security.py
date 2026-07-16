import time
import html
import secrets
import hashlib
import http.cookies


class RateLimiter:
    def __init__(self):
        self._store = {}

    def is_allowed(self, key, max_requests=10, window=60):
        now = time.time()
        entries = self._store.get(key, [])
        entries = [t for t in entries if now - t < window]
        if len(entries) >= max_requests:
            self._store[key] = entries
            return False
        entries.append(now)
        self._store[key] = entries
        return True

    def retry_after(self, key, window=60):
        entries = self._store.get(key, [])
        if not entries:
            return 0
        oldest = min(entries)
        elapsed = time.time() - oldest
        return max(0, int(window - elapsed) + 1)

    def cleanup(self):
        now = time.time()
        empty = []
        for key, entries in self._store.items():
            self._store[key] = [t for t in entries if now - t < 300]
            if not self._store[key]:
                empty.append(key)
        for key in empty:
            del self._store[key]


SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

PUBLIC_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
])

ADMIN_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
])


def add_security_headers(handler, admin=False):
    for k, v in SECURITY_HEADERS.items():
        handler.send_header(k, v)
    handler.send_header('Content-Security-Policy', ADMIN_CSP if admin else PUBLIC_CSP)


def get_client_ip(handler):
    real_ip = handler.headers.get('X-Real-For', '')
    if real_ip:
        return real_ip.split(',')[0].strip()
    forwarded = handler.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return handler.client_address[0]


def escape_html(text):
    if not isinstance(text, str):
        return text
    return html.escape(text)


def sanitize_dict(d):
    if not isinstance(d, dict):
        return d
    return {k: escape_html(v) if isinstance(v, str) else v for k, v in d.items()}


def sanitize_list(items):
    if not isinstance(items, list):
        return items
    return [sanitize_dict(item) if isinstance(item, dict) else escape_html(item) if isinstance(item, str) else item for item in items]


CSRF_COOKIE = 'csrf_token'
CSRF_HEADER = 'X-CSRF-Token'


def generate_csrf_token():
    return secrets.token_hex(32)


def validate_csrf(handler):
    cookie_header = handler.headers.get('Cookie', '')
    if not cookie_header:
        return False
    cookies = http.cookies.SimpleCookie(cookie_header)
    session_cookie = cookies.get('admin_session')
    csrf_cookie = cookies.get(CSRF_COOKIE)
    if not session_cookie or not csrf_cookie:
        return False
    header_token = handler.headers.get(CSRF_HEADER, '')
    return header_token and secrets.compare_digest(header_token, csrf_cookie.value)


class AuditLog:
    def log(self, action, user='admin', details='', ip=''):
        print(f'[AUDIT] {action} by {user} from {ip} — {details}')
        try:
            from config.database import get_db
            db = get_db()
            try:
                cur = db.cursor()
                cur.execute(
                    "INSERT INTO audit_logs (admin_user, action, ip, details) VALUES (%s, %s, %s, %s)",
                    (user, action, ip, details[:500] if details else '')
                )
                db.commit()
            finally:
                db.close()
        except Exception:
            pass


audit_log = AuditLog()
