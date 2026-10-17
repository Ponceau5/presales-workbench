#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT/server/.local/casdoor"
# Use the workbench icon before application branding has loaded.
python3 - <<'PYTHON'
from pathlib import Path
import re
import json
import sqlite3
# Keep the identity session longer than the workbench's 8-hour session.
# Show the account continuation card instead of automatically approving login.
if Path("casdoor.db").exists():
    with sqlite3.connect("casdoor.db", timeout=10) as connection:
        connection.execute("UPDATE application SET expire_in_hours=720,cookie_expire_in_hours=720,enable_auto_signin=0 WHERE owner='admin' AND name IN ('app-built-in','presales-workbench')")
config = Path("../casdoor-connection.json")
base = json.loads(config.read_text()).get("frontend_url", "http://127.0.0.1:7101") if config.exists() else "http://127.0.0.1:7101"
icon = base.rstrip("/") + "/workbench-icon.svg"
for name in ("workbench-icon.svg", "workbench-logo.svg", "workbench-logo-dark.svg"):
    source = Path("../../../public") / name
    if source.exists():
        (Path("web/build") / name).write_bytes(source.read_bytes())
page = Path("web/build/index.html")
if page.exists():
    html = page.read_text()
    html = re.sub(r'(<link rel="(?:icon|apple-touch-icon)" href=")[^"]+("\s*/>)',
                  lambda match: match.group(1) + icon + match.group(2), html)
    page.write_text(html)
PYTHON
exec ./casdoor
