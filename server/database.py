"""Database boundary for existing business SQL; SQLite remains the rollback backend.

Psycopg owns pooling, transactions and cancellation. The compatibility cases below
are deliberately limited to the SQL forms already used by this application.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
from contextlib import contextmanager

_pools = {}
_pool_lock = threading.Lock()
_metrics_lock = threading.Lock()
_metrics = {'queries': 0, 'query_seconds': 0., 'writes': 0, 'write_seconds': 0., 'pool_wait_seconds': 0.}


def database_url():
    """测试进程优先走隔离库/隔离 schema，避免回归测试污染开发数据。"""
    url = os.getenv('PRESALES_TEST_DATABASE_URL') or os.getenv('PRESALES_DATABASE_URL')
    schema = os.getenv('PRESALES_TEST_SCHEMA')
    if url and schema:
        from psycopg.conninfo import make_conninfo
        return make_conninfo(url, options='-c search_path=' + schema + ',public')
    return url


def postgres_enabled():
    return bool(database_url())


def pool():
    from psycopg_pool import ConnectionPool
    url = database_url()
    key = (os.getpid(), url)
    with _pool_lock:
        if key not in _pools:
            from psycopg.conninfo import conninfo_to_dict
            options=conninfo_to_dict(url).get('options','')+' -c statement_timeout=30000 -c lock_timeout=10000'
            _pools[key] = ConnectionPool(url, min_size=1,
                max_size=int(os.getenv('PRESALES_DB_POOL_SIZE', '20')),
                open=True, timeout=10, check=ConnectionPool.check_connection, kwargs={'options': options})
        return _pools[key]


def metrics():
    with _metrics_lock:
        result = dict(_metrics)
    if postgres_enabled():
        result['pool'] = pool().get_stats()
        with pool().connection() as connection:
            result['waits'] = [dict(zip(('wait_type','wait_event','connections'),r)) for r in connection.execute(
                "SELECT wait_event_type,wait_event,count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY wait_event_type,wait_event").fetchall()]
            result['blocked_locks'] = connection.execute('SELECT count(*) FROM pg_locks WHERE NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())').fetchone()[0]
    return result


class Row(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)

    def __iter__(self):
        return iter(self.values())


class Result:
    def __init__(self, rows=(), rowcount=0):
        self.rows = iter(rows)
        self.rowcount = rowcount

    def fetchone(self):
        return next(self.rows, None)

    def fetchall(self):
        return list(self.rows)

    def __iter__(self):
        return self.rows


def parameters(sql):
    """Translate parameter tokens, never '?' or '%' embedded in SQL literals."""
    # Both backends use standard single-quoted literals: a backslash does not
    # consume the closing quote in LIKE ... ESCAPE '\\'.
    tokens = re.findall(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|\?|[A-Za-z_][\w]*|.",sql,re.S)
    return ''.join('%s' if t=='?' else 'ctid' if t.lower()=='rowid' else t.replace('%','%%') for t in tokens)


class PostgresConnection:
    dialect = 'postgresql'

    def __init__(self, raw):
        self.raw = raw
        self._columns = {}

    def interrupt(self):
        self.raw.cancel()

    def columns(self, table):
        if table not in self._columns:
            rows = self.raw.execute('''SELECT a.attnum-1 AS cid,a.attname AS name,
                format_type(a.atttypid,a.atttypmod) AS type,
                a.attnotnull::int AS "notnull",pg_get_expr(d.adbin,d.adrelid) AS dflt_value,
                COALESCE(array_position(i.indkey::smallint[],a.attnum),0)::int AS pk
                FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
                LEFT JOIN pg_index i ON i.indrelid=a.attrelid AND i.indisprimary
                WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum''', (table,)).fetchall()
            # array_position on pg_index's zero-based array needs explicit ordinal handling.
            keys = self.raw.execute('''SELECT a.attname FROM pg_index i
                CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,pos)
                JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
                WHERE i.indrelid=to_regclass(%s) AND i.indisprimary ORDER BY k.pos''',(table,)).fetchall()
            pk = {r[0]: n for n, r in enumerate(keys, 1)}
            self._columns[table] = [Row(zip(('cid','name','type','notnull','dflt_value','pk'), (*r[:5],pk.get(r[1],0)))) for r in rows]
        return self._columns[table]

    def execute(self, sql, args=()):
        original = sql.strip().rstrip(';')
        upper = original.upper()
        if upper.startswith('PRAGMA TABLE_INFO'):
            table = re.fullmatch(r'PRAGMA\s+table_info\([\"\']?(\w+)[\"\']?\)', original, re.I)
            if not table:
                raise ValueError('Unsupported schema inspection')
            return Result(self.columns(table[1]))
        if upper == 'PRAGMA DEFER_FOREIGN_KEYS=ON':
            return self.execute('SET CONSTRAINTS ALL DEFERRED')
        if upper in {'PRAGMA FOREIGN_KEYS=ON', 'PRAGMA JOURNAL_MODE=WAL'}:
            return Result()
        if upper == 'BEGIN IMMEDIATE':
            # Preserve the existing short critical sections across API processes.
            return self.execute('SELECT pg_advisory_xact_lock(735271041)')
        if upper == 'BEGIN':
            return Result()
        if re.match(r'CREATE VIRTUAL TABLE (?:IF NOT EXISTS )?MATERIAL_CHUNKS\b', upper):
            original = '''CREATE TABLE IF NOT EXISTS material_chunks
                (document_id TEXT,version TEXT,page INTEGER,paragraph INTEGER,text TEXT)'''
        original = re.sub(r'\bsqlite_master\b', "(SELECT tablename AS name,'table' AS type FROM pg_tables WHERE schemaname=current_schema()) AS catalog", original, flags=re.I)
        if upper.startswith('CREATE TABLE'):
            original = re.sub(r'\bREAL\b','DOUBLE PRECISION',original,flags=re.I)
            original = re.sub(r'REFERENCES\s+(\w+)\s*\(([^)]+)\)(\s+ON DELETE CASCADE)?',r'REFERENCES \1(\2)\3 DEFERRABLE INITIALLY IMMEDIATE',original,flags=re.I)
        ignore = re.match(r'INSERT OR IGNORE\s+INTO\b', original, re.I)
        replace = re.match(r'INSERT OR REPLACE\s+INTO\s+(\w+)', original, re.I)
        if ignore:
            original = re.sub(r'INSERT OR IGNORE','INSERT',original,count=1,flags=re.I)+' ON CONFLICT DO NOTHING'
        if replace:
            table = replace[1]
            cols = self.columns(table)
            keys = [r['name'] for r in cols if r['pk']]
            if not keys:
                raise ValueError('Upsert requires a primary key: '+table)
            values = [r['name'] for r in cols if not r['pk']]
            original = re.sub(r'INSERT OR REPLACE','INSERT',original,count=1,flags=re.I)
            original += ' ON CONFLICT ('+','.join('"'+k+'"' for k in keys)+') DO '+(
                'UPDATE SET '+','.join('"'+k+'"=excluded."'+k+'"' for k in values) if values else 'NOTHING')
        started = time.monotonic()
        cursor = self.raw.execute(parameters(original), args)
        rows = []
        if cursor.description:
            names = [d.name for d in cursor.description]
            rows = [Row(zip(names, row)) for row in cursor.fetchall()]
        elapsed = time.monotonic()-started
        write = upper.startswith(('INSERT','UPDATE','DELETE'))
        with _metrics_lock:
            _metrics['queries'] += 1
            _metrics['query_seconds'] += elapsed
            if write:
                _metrics['writes'] += 1
                _metrics['write_seconds'] += elapsed
        if upper.startswith(('CREATE','ALTER','DROP')):
            self._columns.clear()
        return Result(rows, cursor.rowcount)

    def executemany(self, sql, rows):
        count = 0
        for args in rows:
            count += max(0,self.execute(sql,args).rowcount)
        return Result(rowcount=count)

    def executescript(self, sql):
        import sqlparse
        for statement in sqlparse.split(sql):
            if statement.strip():
                self.execute(statement)


@contextmanager
def connect(path):
    from execution_control import current
    from contextlib import nullcontext
    task = current()
    if postgres_enabled():
        started = time.monotonic()
        with pool().connection() as raw:
            with _metrics_lock:
                _metrics['pool_wait_seconds'] += time.monotonic()-started
            connection = PostgresConnection(raw)
            with task.on_cancel(connection.interrupt) if task else nullcontext():
                yield connection
    else:
        raw = sqlite3.connect(path, timeout=10)
        raw.row_factory = sqlite3.Row
        raw.execute('PRAGMA foreign_keys=ON')
        try:
            with task.on_cancel(raw.interrupt) if task else nullcontext():
                yield raw
            raw.commit()
        except BaseException:
            raw.rollback()
            raise
        finally:
            raw.close()
