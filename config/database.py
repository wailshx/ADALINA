import os
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')

class _ConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn

    def cursor(self):
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def close(self):
        self._conn.close()

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def __getattr__(self, name):
        return getattr(self._conn, name)

def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return _ConnectionWrapper(conn)
