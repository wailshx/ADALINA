import os
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')

if not DATABASE_URL:
    print("[FATAL] DATABASE_URL environment variable is not set!")
    print("[FATAL] Set DATABASE_URL in your hosting platform's environment variables.")

DATABASE_PUBLIC_URL = os.environ.get('DATABASE_PUBLIC_URL', DATABASE_URL)


def _connect(url):
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    conn = psycopg2.connect(url, connect_timeout=10)
    conn.autocommit = False
    return conn


class _ConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def close(self):
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


def get_db():
    return _ConnectionWrapper(_connect(DATABASE_URL))


def get_public_db():
    return _ConnectionWrapper(_connect(DATABASE_PUBLIC_URL))
