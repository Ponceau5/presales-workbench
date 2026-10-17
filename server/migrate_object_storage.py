"""One-time migration: upload registered sources, then atomically update pointers.
Run on the workstation with PRESALES_DATA_DIR and restricted OSS credentials set.
Original workstation files are retained; this script never deletes user originals.
"""
import hashlib
import os
import sqlite3
from pathlib import Path
import object_storage

def migrate():
    if not object_storage.enabled(): raise RuntimeError("Set PRESALES_STORAGE=oss")
    database=Path(os.environ["PRESALES_DATA_DIR"])/"workbench.sqlite3"
    # Older GSA sizing parsers use a small compatibility cache. Keep JSON metadata
    # on ECS; originals can be omitted from deployment after this upload succeeds.
    directory=database.parent/"files/GSA02"
    if directory.exists():
        for original in directory.iterdir():
            if original.is_file() and original.suffix.lower() not in {".json"}:
                object_storage.save(original,object_storage.legacy_key(original))
    with sqlite3.connect(database) as c:
        c.row_factory=sqlite3.Row
        for table in ("documents","role_file_samples","flow_samples"):
            if not c.execute("SELECT 1 FROM sqlite_master WHERE name=?",(table,)).fetchone(): continue
            for row in c.execute("SELECT * FROM "+table).fetchall():
                if row["path"].startswith("oss://"): continue
                original=Path(row["path"])
                if not original.is_file(): raise FileNotFoundError(original)
                digest=hashlib.sha256(original.read_bytes()).hexdigest()
                if "sha256" in row.keys() and digest!=row["sha256"]: raise ValueError("Source changed: "+str(original))
                key=object_storage.key_for(row["project_id"],row["id"],original.suffix)
                location=object_storage.save(original,key)
                c.execute("UPDATE "+table+" SET path=? WHERE id=?",(location,row["id"]))
                c.commit()
                print(table,row["id"],"migrated")

if __name__=="__main__": migrate()
