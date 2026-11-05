"""Run each test module in its own process; module globals cannot share databases."""
import json,os,subprocess,sys,time
from pathlib import Path
root=Path(__file__).resolve().parents[1]
results=[]
for module in sorted((root/'server').glob('test_*.py')):
 started=time.monotonic()
 result=subprocess.run([sys.executable,'-m','unittest',module.stem,'-v'],cwd=root/'server',capture_output=True,text=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PRESALES_MODEL_PROVIDER':'auto',**{prefix+'_API_KEY':'' for prefix in ('DEEPSEEK','MOONSHOT','ZHIPU','SILICONFLOW')}})
 print(module.stem, 'PASS' if result.returncode==0 else 'FAIL',round(time.monotonic()-started,2),flush=True)
 if result.returncode:print(result.stdout+result.stderr,flush=True)
 results.append({'module':module.stem,'passed':result.returncode==0,'seconds':round(time.monotonic()-started,2),'output':result.stdout+result.stderr})
if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(results,ensure_ascii=False,indent=2))
sys.exit(any(not row['passed'] for row in results))
