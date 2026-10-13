#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${PRESALES_SSH_TARGET:-root@8.130.81.157}"
KEY="${PRESALES_SSH_KEY:-/Users/a48750/Desktop/AA工作台/售前Agent/服务器/密钥/_salesworkbench.pem}"
BUILD="${PRESALES_BUILD_DIR:-/Users/a48750/Desktop/AI专用/Codex/云部署/web}"
cd "$ROOT"
NODE="${PRESALES_NODE:-node}"
"$NODE" node_modules/typescript/bin/tsc -b
"$NODE" node_modules/vite/bin/vite.js build --outDir "$BUILD" --emptyOutDir
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -i "$KEY" "$TARGET")
"${SSH[@]}" 'systemctl start salesworkbench-backup.service'
COPYFILE_DISABLE=1 tar --exclude=__pycache__ --exclude=.local -czf - server public/overseas-cost-template.xlsx src/lib/f7CostTemplateSchema.json | "${SSH[@]}" 'tar -xzf - -C /opt/salesworkbench'
COPYFILE_DISABLE=1 tar --exclude=project-data --exclude=shared -czf - -C "$BUILD" . | "${SSH[@]}" 'tar -xzf - -C /opt/salesworkbench/web'
"${SSH[@]}" '/opt/salesworkbench/venv/bin/pip install --quiet -r /opt/salesworkbench/server/requirements.txt; systemctl restart salesworkbench'
"${SSH[@]}" 'systemctl is-active salesworkbench nginx'
printf '%s\n' 'Update complete. Open the workspace and refresh to verify.'
