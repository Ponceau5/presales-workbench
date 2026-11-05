"""Export a consistent PG business snapshot back to a NEW SQLite rollback file.

Use only during a write freeze before switching the application. The schema
snapshot supplies the original SQLite schema; no existing output is overwritten.
Derived vector indexes remain PG-only and must be rebuilt after a later switch.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import psycopg
from psycopg import sql
sys.path.insert(0,str(Path(__file__).resolve().parent))
from migrate_postgres import table_schemas,fingerprint


def export(snapshot,target):
    if Path(target).exists():raise ValueError('Rollback output already exists; overwrite refused')
    with sqlite3.connect(Path(snapshot).resolve().as_uri()+'?mode=ro',uri=True) as source,sqlite3.connect(target) as dest:
        source.backup(dest)
        tables=table_schemas(source)
        with psycopg.connect(os.environ['PRESALES_DATABASE_URL']) as pg:
            pg.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            dest.execute('PRAGMA foreign_keys=ON');dest.execute('PRAGMA defer_foreign_keys=ON')
            dest.execute('BEGIN')
            for name,_ in reversed(tables):dest.execute('DELETE FROM "'+name+'"')
            report=[]
            for name,_ in tables:
                cols=[r[1] for r in source.execute('PRAGMA table_info("'+name+'")')]
                query=sql.SQL('SELECT {} FROM {} ORDER BY ctid').format(sql.SQL(',').join(map(sql.Identifier,cols)),sql.Identifier(name))
                rows=pg.execute(query).fetchall()
                names=','.join('"'+n+'"' for n in cols)
                dest.executemany('INSERT INTO "'+name+'" ('+names+') VALUES ('+','.join('?' for _ in cols)+')',rows)
                exported=dest.execute('SELECT '+names+' FROM "'+name+'"').fetchall()
                valid=fingerprint(rows)==fingerprint(exported)
                report.append({'table':name,'pg_count':len(rows),'sqlite_count':len(exported),'all_fields_match':valid})
                if not valid:raise ValueError('Rollback comparison failed: '+name)
            if dest.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Rollback foreign key check failed')
            dest.commit()
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--schema-snapshot',required=True);parser.add_argument('--target',required=True);parser.add_argument('--report',required=True)
    args=parser.parse_args();report=export(args.schema_snapshot,args.target)
    Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print({'tables':len(report),'all_fields_match':all(r['all_fields_match'] for r in report)})
