"""Private object storage; local mode remains available for development."""
import os
from pathlib import Path
from contextlib import contextmanager
from tempfile import TemporaryDirectory
from urllib.parse import quote
from urllib.request import urlopen
from functools import lru_cache

def enabled():
    return os.getenv("PRESALES_STORAGE", "local") == "oss"

@lru_cache(maxsize=2)
def bucket(public=False):
    import oss2
    from oss2.credentials import EnvironmentVariableCredentialsProvider, EcsRamRoleCredentialsProvider
    region = os.environ["OSS_REGION"]
    if os.getenv("OSS_ACCESS_KEY_ID"):
        provider = EnvironmentVariableCredentialsProvider()
    else:
        base="http://100.100.100.200/latest/meta-data/ram/security-credentials/"
        role=os.getenv("OSS_ECS_ROLE")
        if not role:
            with urlopen(base, timeout=3) as response: role=response.read().decode().strip()
        provider=EcsRamRoleCredentialsProvider(base+quote(role,safe=""))
    auth = oss2.ProviderAuthV4(provider)
    endpoint = os.environ["OSS_PUBLIC_ENDPOINT" if public else "OSS_ENDPOINT"]
    return oss2.Bucket(auth, endpoint, os.environ["OSS_BUCKET"], region=region, connect_timeout=30)

def key_for(project, identifier, suffix):
    return "projects/" + quote(project, safe="") + "/originals/" + identifier + suffix

def save(path, key):
    if not enabled(): return str(path)
    bucket().put_object_from_file(key, str(path))
    return "oss://" + key

@contextmanager
def materialize(location):
    if not location.startswith("oss://"):
        yield Path(location)
        return
    with TemporaryDirectory(prefix="presales-", dir=os.getenv("PRESALES_TEMP_DIR")) as directory:
        path = Path(directory) / Path(location).name
        bucket().get_object_to_file(location[6:], str(path))
        yield path

def download(location, filename):
    from fastapi.responses import FileResponse, RedirectResponse
    if location.startswith("oss://"):
        disposition = "attachment; filename*=UTF-8''" + quote(filename)
        url = bucket(True).sign_url("GET", location[6:], 300, params={"response-content-disposition": disposition}, slash_safe=True)
        return RedirectResponse(url, status_code=307, headers={"Cache-Control":"no-store"})
    return FileResponse(location, filename=filename)

def generated(content, mime, key, filename):
    from fastapi.responses import Response
    if not enabled(): return Response(content, media_type=mime)
    client = bucket()
    if not client.object_exists(key):
        client.put_object(key, content, headers={"Content-Type":mime})
    return download("oss://" + key, filename)


def legacy_key(path):
    root=Path(os.environ.get("PRESALES_DATA_DIR",Path(__file__).parent/".local"))/"files"
    return "legacy/" + path.resolve().relative_to(root.resolve()).as_posix()

def resolve_file(path):
    """Compatibility for existing sizing/BOM parsers; only fetch on explicit use."""
    if not path.exists() and enabled():
        key=legacy_key(path)
        if bucket().object_exists(key):
            path.parent.mkdir(parents=True,exist_ok=True)
            bucket().get_object_to_file(key,str(path))
    return path

def legacy_download(path, filename):
    if enabled():
        key=legacy_key(path)
        if not bucket().object_exists(key):
            bucket().put_object_from_file(key,str(path))
        return download("oss://"+key,filename)
    return download(str(path),filename)
