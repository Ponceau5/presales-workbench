"""Daily consistent SQLite snapshot, seven rotating private OSS backups."""
import os,sqlite3,tempfile
from pathlib import Path
from datetime import datetime,timezone
import object_storage
root=Path(os.environ['PRESALES_DATA_DIR'])
with tempfile.TemporaryDirectory(prefix='state-backup-',dir=root) as directory:
 path=Path(directory)/'workbench.sqlite3'
 with sqlite3.connect(root/'workbench.sqlite3') as source,sqlite3.connect(path) as target:source.backup(target)
 key='backups/workbench-weekday-'+str(datetime.now(timezone.utc).weekday())+'.sqlite3'
 object_storage.save(path,key)
print('Database snapshot backed up')
