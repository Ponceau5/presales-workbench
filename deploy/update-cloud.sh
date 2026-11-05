#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${PRESALES_SSH_TARGET:-root@8.130.81.157}"
KEY="${PRESALES_SSH_KEY:-/Users/a48750/Desktop/AA工作台/售前Agent/服务器/密钥/_salesworkbench.pem}"
BUILD="${PRESALES_BUILD_DIR:-/Users/a48750/Desktop/AI专用/Codex/云部署/web}"
NODE="${PRESALES_NODE:-node}"
cd "$ROOT"
SHA="$(git rev-parse HEAD)"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]]
if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '%s\n' 'Commit the source changes before deploying.' >&2
  exit 1
fi
"$NODE" node_modules/typescript/bin/tsc -b
"$NODE" node_modules/vite/bin/vite.js build --outDir "$BUILD" --emptyOutDir
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -i "$KEY" "$TARGET")
"${SSH[@]}" bash -s -- "$SHA" <<'REMOTE'
set -euo pipefail
SHA="$1"
BASE=/opt/salesworkbench
RELEASE="$BASE/releases/$SHA"
if [[ ! -d "$BASE/source/.git" ]]; then
  git clone --no-checkout https://github.com/Ponceau5/presales-workbench.git "$BASE/source"
fi
git -C "$BASE/source" fetch origin "$SHA"
git -C "$BASE/source" checkout --detach "$SHA"
[[ "$(git -C "$BASE/source" rev-parse HEAD)" == "$SHA" ]]
mkdir -p "$RELEASE/web"
git -C "$BASE/source" archive "$SHA" | tar -x -C "$RELEASE"
if [[ ! -x "$RELEASE/venv/bin/python" ]]; then
  "$BASE/venv/bin/python" -m venv "$RELEASE/venv"
fi
"$RELEASE/venv/bin/pip" install --quiet -r "$RELEASE/server/requirements.txt"
for name in project-data shared; do
  if [[ -d "$BASE/public/$name" && ! -e "$RELEASE/public/$name" ]]; then
    ln -s "$BASE/public/$name" "$RELEASE/public/$name"
  fi
done
REMOTE
COPYFILE_DISABLE=1 tar --no-xattrs --exclude=project-data --exclude=shared -czf - -C "$BUILD" . | "${SSH[@]}" "tar -xzf - -C /opt/salesworkbench/releases/$SHA/web"
"${SSH[@]}" bash -s -- "$SHA" <<'REMOTE'
set -euo pipefail
SHA="$1"
BASE=/opt/salesworkbench
RELEASE="$BASE/releases/$SHA"
BACKUP="$BASE/backups/deploy-$(date +%Y%m%d-%H%M%S)-${SHA:0:8}"
mkdir -m 700 -p "$BACKUP"
cp /etc/systemd/system/salesworkbench.service "$BACKUP/salesworkbench.service"
cp /etc/systemd/system/salesworkbench-backup.service "$BACKUP/backup.service"
cp "$BASE/web/index.html" "$BACKUP/index.html"
[[ ! -e "$BASE/web/version.json" ]] || cp "$BASE/web/version.json" "$BACKUP/version.json"
systemctl start salesworkbench-backup.service
rollback() {
  cp "$BACKUP/salesworkbench.service" /etc/systemd/system/salesworkbench.service
  cp "$BACKUP/backup.service" /etc/systemd/system/salesworkbench-backup.service
  cp "$BACKUP/index.html" "$BASE/web/index.html"
  [[ ! -e "$BACKUP/version.json" ]] || cp "$BACKUP/version.json" "$BASE/web/version.json"
  systemctl daemon-reload
  systemctl restart salesworkbench
}
trap rollback ERR
python3 - "$RELEASE" <<'PY'
from pathlib import Path
import sys
release=Path(sys.argv[1])
p=Path('/etc/systemd/system/salesworkbench.service')
lines=p.read_text().splitlines();lines=[('ExecStart='+str(release/'venv/bin/uvicorn')+' app:app --app-dir '+str(release/'server')+' --host 127.0.0.1 --port 8000 --no-access-log') if line.startswith('ExecStart=') else line for line in lines];p.write_text('\n'.join(lines)+'\n')
p=Path('/etc/systemd/system/salesworkbench-backup.service');lines=p.read_text().splitlines();lines=[('ExecStart='+str(release/'venv/bin/python')+' '+str(release/'server/backup_state.py')) if line.startswith('ExecStart=') else line for line in lines];p.write_text('\n'.join(lines)+'\n')
PY
cp -a "$RELEASE/web/." "$BASE/web/"
python3 - "$BASE/web/version.json" "$SHA" <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import sys,json
p=Path(sys.argv[1]);value=json.loads(p.read_text());value.update(commit=sys.argv[2],deployedAt=datetime.now(timezone.utc).isoformat());p.write_text(json.dumps(value,ensure_ascii=False))
PY
systemctl daemon-reload
systemctl restart salesworkbench
curl --fail --silent --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:8000/openapi.json > /dev/null
systemctl is-active salesworkbench nginx postgresql
ln -sfn "$RELEASE" "$BASE/current"
trap - ERR
printf 'Git release deployed: %s\n' "$SHA"
REMOTE
