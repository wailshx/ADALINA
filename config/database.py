import os
import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

DATABASE_URL = os.environ.get('DATABASE_URL', '')

if not DATABASE_URL:
    print("[FATAL] DATABASE_URL environment variable is not set!")
    print("[FATAL] Set DATABASE_URL in your hosting platform's environment variables.")

DATABASE_PUBLIC_URL = os.environ.get('DATABASE_PUBLIC_URL', DATABASE_URL)


def _normalize_url(url):
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url


_pool = None
_public_pool = None

try:
    _pool = ThreadedConnectionPool(2, 10, _normalize_url(DATABASE_URL), connect_timeout=10)
    print("[DB] Connection pool initialized (min=2, max=10)")
except Exception as e:
    print(f"[DB] WARNING: Could not create connection pool: {e}")
    print("[DB] Falling back to per-request connections.")

if DATABASE_PUBLIC_URL and DATABASE_PUBLIC_URL != DATABASE_URL:
    try:
        _public_pool = ThreadedConnectionPool(2, 10, _normalize_url(DATABASE_PUBLIC_URL), connect_timeout=10)
        print("[DB] Public connection pool initialized (min=2, max=10)")
    except Exception as e:
        print(f"[DB] WARNING: Could not create public connection pool: {e}")


def _connect(url):
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    conn = psycopg2.connect(url, connect_timeout=10)
    conn.autocommit = False
    return conn


class _ConnectionWrapper:
    def __init__(self, conn, pool=None):
        self._conn = conn
        self._pool = pool

    def cursor(self):
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def close(self):
        if self._pool:
            try:
                self._pool.putconn(self._conn)
            except Exception:
                try:
                    self._conn.close()
                except Exception:
                    pass
        else:
            try:
                self._conn.close()
            except Exception:
                pass

    def commit(self):
        self._conn.commit()

    def rollback(self):
        try:
            self._conn.rollback()
        except Exception:
            pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _borrow(pool, url):
    if pool:
        for attempt in range(3):
            try:
                conn = pool.getconn()
                try:
                    conn.autocommit = False
                    cur = conn.cursor()
                    cur.execute("SELECT 1")
                    cur.close()
                except Exception:
                    try:
                        pool.putconn(conn, close=True)
                    except Exception:
                        try:
                            conn.close()
                        except Exception:
                            pass
                    continue
                return _ConnectionWrapper(conn, pool)
            except Exception:
                continue
    return _ConnectionWrapper(_connect(url))


def get_db():
    return _borrow(_pool, DATABASE_URL)


def get_public_db():
    return _borrow(_public_pool or _pool, DATABASE_PUBLIC_URL)
