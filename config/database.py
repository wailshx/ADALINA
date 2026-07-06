import sqlite3
import os
import re

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'store.db')

def _adapt_sql(sql):
    return re.sub(r'%s', r'?', sql)

class _CursorWrapper:
    def __init__(self, cursor):
        self._cur = cursor

    def execute(self, sql, params=None):
        if params is None:
            self._cur.execute(_adapt_sql(sql))
        else:
            if not isinstance(params, (list, tuple)):
                params = [params]
            self._cur.execute(_adapt_sql(sql), params)
        return self

    def fetchone(self):
        row = self._cur.fetchone()
        return dict(row) if row else None

    def fetchall(self):
        return [dict(r) for r in self._cur.fetchall()]

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    def __getattr__(self, name):
        return getattr(self._cur, name)

class _ConnectionWrapper:
    def __init__(self, conn):
        self._conn = conn
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")

    def cursor(self, **kwargs):
        return _CursorWrapper(self._conn.cursor())

    def close(self):
        self._conn.close()

    def commit(self):
        self._conn.commit()

    def __getattr__(self, name):
        return getattr(self._conn, name)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    return _ConnectionWrapper(conn)
