"""Preserve OAuth code login for a workbench callback sharing Casdoor origin."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
old = 'e.type!=="device"&&_t(n==null?void 0:n.redirectUri)&&(e.type="login")'
new = 'e.type!=="device"&&_t(n==null?void 0:n.redirectUri)&&!(e.type==="code"&&new URL(n.redirectUri).pathname==="/api/auth/casdoor/callback")&&(e.type="login")'
files = list(root.glob("assets/LoginPage-*.js"))
if len(files) != 1:
    raise SystemExit("Expected exactly one Casdoor LoginPage asset")
p = files[0]
source = p.read_text()
if new in source:
    print("Casdoor workbench callback patch already applied")
elif source.count(old) == 1:
    p.write_text(source.replace(old, new))
    print("Patched Casdoor workbench OAuth callback")
else:
    raise SystemExit("Unsupported Casdoor build; no changes made")

# Change the asset URL so existing browsers do not reuse the broken cached bundle.
import hashlib
name = "LoginPage-workbench-" + hashlib.sha256(p.read_bytes()).hexdigest()[:12] + ".js"
if p.name != name:
    previous = p.name
    for ref in root.rglob("*"):
        if ref.is_file() and ref.suffix in {".js", ".html", ".json"}:
            content = ref.read_text()
            if previous in content:
                ref.write_text(content.replace(previous, name))
    p.rename(p.with_name(name))
    print("Updated LoginPage asset references")
