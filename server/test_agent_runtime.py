"""LangGraph restart recovery, deduplication, approval and project isolation."""
import os,tempfile,json,unittest
from uuid import uuid4
from fastapi import HTTPException
root=tempfile.TemporaryDirectory(dir=os.environ.get('PRESALES_TEST_TMP'));os.environ['PRESALES_DATA_DIR']=root.name
from app import db,now
from agent_runtime import Runtime
class RuntimeTests(unittest.TestCase):
 def setUp(self):self.runtime=Runtime(db,root.name);self.turn=uuid4().hex;self.calls=0
 def generate(self):
  self.calls+=1
  yield self.runtime.event('delta',text='核对结果')
  with db() as c:c.execute('INSERT INTO workspace_replies VALUES (?,?,?,?,?,?,?,?,?)',(self.turn,'GSA02','F7','pm','核对结果','[]',now(),None,'cost'))
  yield self.runtime.event('done')
 def execute(self,recipe=None,phase='confirm_parameters',generator=None):return list(self.runtime.execute('GSA02','F7','pm',self.turn,recipe or {'request':'cost'},generator or self.generate,phase))
 def identifier(self):
  with db() as c:return c.execute('SELECT id FROM runtime_runs WHERE turn_id=?',(self.turn,)).fetchone()[0]
 def test_restart_replays_and_confirms_without_regenerating(self):
  events=self.execute();self.assertIn('"done"',''.join(events));identifier=self.identifier()
  self.assertEqual(self.runtime.row(identifier,'GSA02','F7','pm')['status'],'waiting')
  self.runtime=Runtime(db,root.name);self.execute();self.assertEqual(self.calls,1)
  self.runtime.confirm(identifier,'GSA02','F7','pm','confirm_parameters')
  self.assertEqual(self.runtime.row(identifier,'GSA02','F7','pm')['status'],'completed')
 def test_checkpoint_recovers_after_status_write_was_interrupted(self):
  self.execute();identifier=self.identifier();self.runtime.update(identifier,'interrupted')
  events=self.execute();self.assertEqual(self.calls,1);self.assertIn('核对结果',''.join(events))
  self.assertEqual(self.runtime.row(identifier,'GSA02','F7','pm')['status'],'waiting')
 def test_failure_resumes_last_checkpoint(self):
  def broken():
   yield self.runtime.event('delta',text='未完成')
   raise RuntimeError('temporary provider error')
  self.execute(generator=broken,phase='complete');identifier=self.identifier()
  self.assertEqual(self.runtime.row(identifier,'GSA02','F7','pm')['status'],'failed')
  self.runtime=Runtime(db,root.name);self.execute(phase='complete');self.assertEqual(self.calls,1)
  self.assertEqual(self.runtime.row(identifier,'GSA02','F7','pm')['status'],'completed')
 def test_inputs_cannot_change_under_same_execution(self):
  self.execute()
  with self.assertRaises(HTTPException) as error:self.execute({'request':'changed'})
  self.assertEqual(error.exception.status_code,409);self.assertEqual(self.calls,1)
 def test_other_user_or_project_cannot_read_or_resume(self):
  self.execute();identifier=self.identifier()
  for project,user in [('RCJM1','pm'),('GSA02','sales')]:
   with self.assertRaises(HTTPException) as error:self.runtime.confirm(identifier,project,'F7',user,'confirm_parameters')
   self.assertEqual(error.exception.status_code,404)
 def test_review_requires_adopted_output(self):
  self.execute(phase='review');identifier=self.identifier()
  with self.assertRaises(HTTPException):self.runtime.confirm(identifier,'GSA02','F7','pm','review')
  with db() as c:c.execute('INSERT INTO workspace_artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?)',(uuid4().hex,'GSA02','F7',self.turn,'成本表','核对结果',1,'pm','conversation','[]',now()))
  self.runtime.finish_review('GSA02','F7','pm',self.turn)
  self.assertEqual(self.runtime.row(identifier,'GSA02','F7','pm')['status'],'completed')
if __name__=='__main__':unittest.main()
