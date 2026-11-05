"""Consistent database snapshot using the selected database's native backup tool."""
import os
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timezone
import object_storage


def backup():
    root=Path(os.environ['PRESALES_DATA_DIR'])
    postgres=os.getenv('PRESALES_DATABASE_URL')
    with tempfile.TemporaryDirectory(prefix='state-backup-',dir=root) as directory:
        path=Path(directory)/('workbench.pgdump' if postgres else 'workbench.sqlite3')
        if postgres:
            from psycopg.conninfo import conninfo_to_dict
            parameters=conninfo_to_dict(postgres)
            names={'dbname':'PGDATABASE','user':'PGUSER','password':'PGPASSWORD','host':'PGHOST','port':'PGPORT','sslmode':'PGSSLMODE','options':'PGOPTIONS','connect_timeout':'PGCONNECT_TIMEOUT','sslrootcert':'PGSSLROOTCERT','sslcert':'PGSSLCERT','sslkey':'PGSSLKEY','service':'PGSERVICE'}
            environment={**os.environ,**{names[key]:value for key,value in parameters.items() if key in names}}
            subprocess.run([os.getenv('PRESALES_PG_DUMP','pg_dump'),'--format=custom','--file',str(path)],
                env=environment,check=True,capture_output=True)
        else:
            with sqlite3.connect(root/'workbench.sqlite3') as source,sqlite3.connect(path) as target:
                source.backup(target)
        key='backups/workbench-weekday-'+str(datetime.now(timezone.utc).weekday())+path.suffix
        object_storage.save(path,key)
    print('Database snapshot backed up')


if __name__=='__main__':
    backup()
