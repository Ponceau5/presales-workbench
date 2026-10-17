import os,unittest,tempfile,json
from pathlib import Path
from unittest.mock import patch
import object_storage
class LocalSigningTests(unittest.TestCase):
 def test_cached_source_can_be_read_without_cloud_download(self):
  with tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP')) as root,patch.dict(os.environ,{'PRESALES_DATA_DIR':root,'PRESALES_STORAGE':'local'}):
   path=Path(root);(path/'oss-signing.json').write_text('{"host":"root@example"}');(path/'files').mkdir();(path/'files/a.xlsx').write_bytes(b'source')
   with object_storage.materialize('oss://projects/RCJM1/originals/a.xlsx') as source:self.assertEqual(source.read_bytes(),b'source')
 def test_signing_arguments_are_quoted_and_redirect_is_private_oss(self):
  config={'host':'root@example','key_file':'/key','remote_root':'/opt/workbench'}
  result=type('Result',(),{'stdout':'https://salesworkbench.oss-cn-wulanchabu.aliyuncs.com/key?signed=1\n'})()
  with patch.object(object_storage,'enabled',return_value=False),patch.object(object_storage,'local_signing_config',return_value=config),patch('subprocess.run',return_value=result) as run:
   response=object_storage.download('oss://projects/RCJM1/a.xlsx','cost $(whoami).xlsx')
   self.assertEqual(response.status_code,307);self.assertTrue(response.headers['location'].startswith('https://salesworkbench.'))
   self.assertIsInstance(run.call_args.args[0],list);self.assertNotIn('shell',run.call_args.kwargs)
   result.stdout='https://untrusted.example/file'
   with self.assertRaises(ValueError):object_storage.download('oss://projects/RCJM1/a.xlsx','cost.xlsx')
