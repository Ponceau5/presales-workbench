"""Run the unchanged regression modules against separate disposable PG databases.

Some standalone unit modules construct SQLite explicitly; their output remains a
unit result, not proof of PG integration. App-level modules use PG through env.
"""
import json,os,subprocess,sys,time
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
root=Path(__file__).resolve().parents[1]
admin=os.environ['PRESALES_PG_TEST_ADMIN']
output=Path(sys.argv[1]);results=[]
for module in sorted((root/'server').glob('test_*.py')):
 name=os.getenv('PRESALES_PG_TEST_PREFIX','regression')+'_'+module.stem.removeprefix('test_')
 with psycopg.connect(admin,autocommit=True) as c:
  if c.execute('SELECT 1 FROM pg_database WHERE datname=%s',(name,)).fetchone():
   raise RuntimeError('Refusing to overwrite test database: '+name)
  c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
 started=time.monotonic()
 env={**os.environ,'PRESALES_DATABASE_URL':make_conninfo(admin,dbname=name),'PYTHONDONTWRITEBYTECODE':'1','PRESALES_MODEL_PROVIDER':'auto',**{k+'_API_KEY':'' for k in ('DEEPSEEK','MOONSHOT','ZHIPU','SILICONFLOW')}}
 result=subprocess.run([sys.executable,'-m','unittest',module.stem,'-v'],cwd=root/'server',capture_output=True,text=True,env=env)
 record={'module':module.stem,'passed':result.returncode==0,'seconds':round(time.monotonic()-started,2),'output':result.stdout+result.stderr}
 results.append(record);output.write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print(module.stem,'PASS' if record['passed'] else 'FAIL',flush=True)
 if result.returncode:print(record['output'],flush=True)
sys.exit(any(not r['passed'] for r in results))
