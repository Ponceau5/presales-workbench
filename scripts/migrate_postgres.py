"""Offline SQLite -> PostgreSQL copy with a consistent backup and full row comparison.

The target must be empty. Never overwrite an existing application database.
Files stay in file storage; only their existing references are copied.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from database import connect


def table_schemas(source):
    tables = source.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    tables = {n:s for n,s in tables if not n.startswith('material_chunks_')}
    ordered = []
    while tables:
        ready = [n for n,s in tables.items() if not (set(re.findall(r'REFERENCES\s+[\"\']?(\w+)',s,re.I))-{n}) & tables.keys()]
        if not ready:
            raise ValueError('Foreign key cycle requires an explicit migration')
        for name in ready:
            ordered.append((name,tables.pop(name)))
    return ordered


def fingerprint(rows):
    encoded = sorted(json.dumps(list(r),ensure_ascii=False,separators=(',',':'),default=lambda v:{'bytes':bytes(v).hex()}) for r in rows)
    return hashlib.sha256('\n'.join(encoded).encode()).hexdigest()


def migrate(source_path, backup_path):
    if not os.getenv('PRESALES_DATABASE_URL'):
        raise ValueError('PRESALES_DATABASE_URL is required')
    if Path(backup_path).exists():
        raise ValueError('Backup already exists; choose a new explicit destination')
    with sqlite3.connect(Path(source_path).resolve().as_uri()+'?mode=ro',uri=True) as original:
        with sqlite3.connect(backup_path) as backup:
            original.backup(backup)
    with sqlite3.connect(backup_path) as source, connect(source_path) as target:
        if target.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
            raise ValueError('Target is not empty; migration refused')
        schema = table_schemas(source)
        for name,ddl in schema:
            target.execute(ddl)
        for name,ddl in schema:
            for _,index_sql in source.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",(name,)):
                target.execute(index_sql)
        target.execute('SET CONSTRAINTS ALL DEFERRED')
        report = []
        for name,ddl in schema:
            cols = [r[1] for r in source.execute('PRAGMA table_info("'+name+'")')]
            names = ','.join('"'+n+'"' for n in cols)
            rows = source.execute('SELECT '+names+' FROM "'+name+'" ORDER BY rowid').fetchall()
            target.executemany('INSERT INTO "'+name+'" ('+names+') VALUES ('+','.join('?' for _ in cols)+')',rows)
            copied = target.execute('SELECT '+names+' FROM "'+name+'"').fetchall()
            digest = fingerprint(rows)
            valid = len(rows)==len(copied) and digest==fingerprint([tuple(r.values()) for r in copied])
            report.append({'table':name,'source_count':len(rows),'target_count':len(copied),'all_fields_match':valid,'digest':digest})
            if not valid:
                raise ValueError('Row comparison failed: '+name)
        target.execute('SET CONSTRAINTS ALL IMMEDIATE')
    return {'backup':str(backup_path),'tables':report,'passed':all(r['all_fields_match'] for r in report)}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True)
    parser.add_argument('--backup',required=True)
    parser.add_argument('--report',required=True)
    args=parser.parse_args()
    result=migrate(args.source,args.backup)
    Path(args.report).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':result['passed'],'tables':len(result['tables'])}))
