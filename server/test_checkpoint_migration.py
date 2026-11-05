import importlib.util,os,sqlite3,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from psycopg.conninfo import make_conninfo
import psycopg
from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.checkpoint.postgres import PostgresSaver

@unittest.skipUnless(os.getenv('GLOBAL_BUSINESS_TEST_PG'),'requires isolated PostgreSQL')
class CheckpointMigrationTests(unittest.TestCase):
 def test_reused_version_preserves_each_snapshot_parent_and_pending_writes(self):
  url=os.environ['GLOBAL_BUSINESS_TEST_PG'];schema='checkpoint_test_'+uuid.uuid4().hex
  with psycopg.connect(url) as c:c.execute('CREATE SCHEMA '+schema)
  targeturl=make_conninfo(url,options='-c search_path='+schema)
  try:
   with tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP')) as directory:
    path=Path(directory)/'source.sqlite3';saved=[];config={'configurable':{'thread_id':'migration-case','checkpoint_ns':''}}
    with sqlite3.connect(path) as connection:
     source=SqliteSaver(connection)
     for index in range(2):
      ck=empty_checkpoint();ck['channel_values']={'recipe':{'sources':[index]}};ck['channel_versions']={'recipe':1};ck['versions_seen']={'approval':{'recipe':1}}
      config=source.put(config,ck,{'step':index},{'recipe':1});source.put_writes(config,[('approval',{'accepted':False})],'review-task');saved.append((config,ck))
    spec=importlib.util.spec_from_file_location('checkpoint_migration',Path(__file__).parents[1]/'scripts/migrate_checkpoints_postgres.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    with patch.dict(os.environ,{'PRESALES_DATABASE_URL':targeturl}):self.assertEqual(module.migrate(str(path)),2)
    with PostgresSaver.from_conn_string(targeturl) as target:
     for index,(cfg,old) in enumerate(saved):
      copied=target.get_tuple(cfg);self.assertEqual(copied.checkpoint['channel_values'],old['channel_values']);self.assertEqual(copied.metadata['step'],index);self.assertEqual(copied.pending_writes,[('review-task','approval',{'accepted':False})]);self.assertEqual(copied.checkpoint['versions_seen']['approval']['recipe'],copied.checkpoint['channel_versions']['recipe'])
     self.assertEqual(target.get_tuple(saved[1][0]).parent_config,saved[0][0])
  finally:
   with psycopg.connect(url) as c:c.execute('DROP SCHEMA '+schema+' CASCADE')
