import os
import time
import psycopg2
import psycopg2.extras
import atexit

DATABASE_URL = os.environ.get('DATABASE_URL', '')

if not DATABASE_URL:
    print("[FATAL] DATABASE_URL environment variable is not set!")
    print("[FATAL] Set DATABASE_URL in your hosting platform's environment variables.")

DATABASE_PUBLIC_URL = os.environ.get('DATABASE_PUBLIC_URL', DATABASE_URL)

_admin_conn = None
_public_conn = None

def _connect(url, retries=3):
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    last_err = None
    for attempt in range(retries):
        try:
            conn = psycopg2.connect(url, connect_timeout=10)
            conn.autocommit = False
            return conn
        except psycopg2.OperationalError as e:
            last_err = e
            msg = str(e)
            if 'ECIRCUITBREAKER' in msg or 'too many' in msg:
                wait = 2 ** attempt * 5
                print(f"[DB] Circuit breaker active, waiting {wait}s (attempt {attempt+1}/{retries})")
                time.sleep(wait)
            else:
                raise
    raise last_err

def _is_alive(conn):
    try:
        conn.set_isolation_level(conn.isolation_level)
        return True
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        return False

class _ConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def close(self):
        pass

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def __getattr__(self, name):
        return getattr(self._conn, name)

def _get_persistent(ref, url):
    global _admin_conn, _public_conn
    if ref == 'admin':
        conn = _admin_conn
    else:
        conn = _public_conn
    if conn is not None and _is_alive(conn):
        return _ConnectionWrapper(conn)
    try:
        conn = _connect(url)
    except Exception as e:
        print(f"[DB] Failed to connect ({ref}): {e}")
        raise
    if ref == 'admin':
        _admin_conn = conn
    else:
        _public_conn = conn
    print(f"[DB] New persistent connection ({ref})")
    return _ConnectionWrapper(conn)

def get_db():
    return _get_persistent('admin', DATABASE_URL)

def get_public_db():
    return _get_persistent('public', DATABASE_PUBLIC_URL)

def _close_all():
    global _admin_conn, _public_conn
    for conn in (_admin_conn, _public_conn):
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    _admin_conn = None
    _public_conn = None

atexit.register(_close_all)
