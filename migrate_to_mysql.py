#!/usr/bin/env python3
"""
Migrate data from SQLite (store.db) to MySQL.
Run this once after setting up MySQL and creating the lunabelle_store database.

Usage:
    export MYSQL_SOCKET=/tmp/mysql.sock   (or set MYSQL_HOST/PORT/USER/PASSWORD)
    python3 migrate_to_mysql.py
"""
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config.database import get_db

SQLITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'store.db')

def get_sqlite():
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def table_exists_sqlite(cur, name):
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cur.fetchone() is not None

def migrate():
    if not os.path.exists(SQLITE_PATH):
        print(f"SQLite database not found at {SQLITE_PATH}")
        print("Nothing to migrate. Run init_db() to create fresh MySQL tables.")
        return

    sq = get_sqlite()
    sq_cur = sq.cursor()

    my = get_db()
    my_cur = my.cursor()

    tables = [
        'users', 'categories', 'products', 'collections',
        'collection_products', 'customers', 'orders', 'inventory', 'stock_history'
    ]

    for table in tables:
        if not table_exists_sqlite(sq_cur, table):
            print(f"Skipping {table} (not found in SQLite)")
            continue

        sq_cur.execute(f"SELECT * FROM {table}")
        rows = sq_cur.fetchall()
        if not rows:
            print(f"  {table}: 0 rows (empty)")
            continue

        # Build INSERT statement
        columns = list(rows[0].keys())

        # Handle renamed column
        if 'change' in columns and table == 'stock_history':
            columns[columns.index('change')] = 'stock_change'

        placeholders = ', '.join(['%s'] * len(columns))
        col_names = ', '.join(columns)
        sql = f"INSERT IGNORE INTO {table} ({col_names}) VALUES ({placeholders})"

        count = 0
        for row in rows:
            values = [row[k] if k != 'change' else row['change'] for k in columns]
            values = [v if v is not None else None for v in values]
            try:
                my_cur.execute(sql, values)
                count += 1
            except Exception as e:
                print(f"  Error inserting into {table}: {e}")

        my.commit()
        print(f"  {table}: {count} rows migrated")

    sq.close()
    my.close()
    print("\nMigration complete!")

if __name__ == '__main__':
    migrate()
