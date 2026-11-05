"""Source-reading regressions; real-project/model acceptance is recorded separately."""
import os,sqlite3,tempfile,unittest
from contextlib import contextmanager
from pathlib import Path
from openpyxl import Workbook,load_workbook
from langchain_core.tools import ToolException
from solution_materials import ProjectMaterials,render_normalization,render_configuration,result_state

class ProjectSourceTests(unittest.TestCase):
 def setUp(self):
  self.root=tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP'))
  folder=Path(self.root.name);self.path=folder/'source.xlsx';self.database=folder/'sources.sqlite'
  book=Workbook();s=book.active;s.title='Room IO'
  s.append(['No.','Floor','Room Name','DI','DO','AI','AO','串口','网口总数','DI'])
  s.append([1,'BF','Pump 1',10,0,0,0,5,4,999]);s.append([2,None,'Pump 2',20,0,0,0,6,10,888]);s.append([None,None,'汇总',30,0,0,0])
  s=book.create_sheet('Later matrix');s.append(['设备厂家','供货界面']);s.append(['A','BMS接口'])
  s=book.create_sheet('BOM');s.append(['序号','设备名称','规格型号','数量','单位','品牌']);s.append([1,'PLC','CPU with 14DI/10DO',2,'台','vendor'])
  book.save(self.path);book.close()
  with self.db() as c:
   c.executescript('CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,version TEXT,filename TEXT,path TEXT,sha256 TEXT,created_at TEXT);CREATE TABLE document_pages(document_id TEXT,page INTEGER,text TEXT);CREATE TABLE document_registry(document_id TEXT,category TEXT);CREATE TABLE workspace_material_tags(document_id TEXT,stage_id TEXT,category TEXT);')
   for identifier,project in [('input','P'),('other','Q')]:
    c.execute('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)',(identifier,project,'Original','V1','source.xlsx',str(self.path),'frozen','2026'))
    for number,name in enumerate(['Room IO','Later matrix','BOM'],1):c.execute('INSERT INTO document_pages VALUES (?,?,?)',(identifier,number,'工作表：'+name+'\nIndexed text'))
  self.reader=ProjectMaterials(self.db,'P','F3')
 @contextmanager
 def db(self):
  c=sqlite3.connect(self.database);c.row_factory=sqlite3.Row
  try:yield c;c.commit()
  finally:c.close()
 def tearDown(self):self.root.cleanup()
 def test_complete_catalog_has_later_matrix_and_no_other_project(self):
  result=self.reader.catalog('matrix');self.assertEqual(result['matches'],1);self.assertEqual(result['documents'][0]['pages'][1]['page'],2)
  with self.assertRaises(ToolException):self.reader.read('other',1)
 def test_failed_method_is_not_repeated_and_raw_fallback_runs_once(self):
  from unittest.mock import patch
  with patch.object(self.reader,'_normalize',wraps=self.reader._normalize) as structured,patch.object(self.reader,'read',wraps=self.reader.read) as raw:
   first=self.reader.normalize('input',2)
   from concurrent.futures import ThreadPoolExecutor
   with ThreadPoolExecutor(max_workers=5) as pool:duplicates=list(pool.map(lambda _:self.reader.normalize('input',2),range(5)))
   second=duplicates[-1]
   self.assertEqual(structured.call_count,1);self.assertEqual(raw.call_count,1)
   self.assertEqual(first['status'],'needs_input');self.assertTrue(second['duplicate_prevented'])
   self.assertIn('第2页',first['required_input']);self.assertEqual(first['failure_signature'][:3],['input','V1',2])
   self.reader.read('input',1);self.reader.read('input',3)
   self.assertEqual(raw.call_count,3)
 def test_two_methods_fail_then_request_specific_source_and_columns(self):
  from unittest.mock import patch
  with patch.object(self.reader,'read',side_effect=ToolException('原页无法读取')) as raw:
   result=self.reader.normalize('input',2);self.reader.normalize('input',2)
   self.assertEqual(raw.call_count,1);self.assertEqual(result['status'],'needs_input');self.assertIn('V1',result['required_input']);self.assertIn('DI',result['required_input']);self.assertIn('fallback_error',result)
 def test_raw_reader_failure_is_cached_but_parameter_correction_is_allowed(self):
  from unittest.mock import patch
  with self.assertRaises(ToolException):self.reader.read('input',1,row_count=100)
  self.assertEqual(self.reader.read('input',1,row_count=1)['rows'][0]['row'],1)
  with patch.object(self.reader,'_read',side_effect=ToolException('原页损坏')) as raw:
   for _ in range(3):
    with self.assertRaises(ToolException):self.reader.read('input',2)
   self.assertEqual(raw.call_count,1)
 def test_reads_cells_and_continuation_without_cutting_rows(self):
  value=self.reader.read('input',1,start_row=2,row_count=1)
  self.assertEqual(value['rows'][0]['cells']['D'],10);self.assertEqual(value['rows'][0]['cells']['J'],999);self.assertEqual(value['next_row'],3)
  self.assertEqual(self.reader.read('input',1,query='Pump 2')['rows'][0]['row'],3)
 def test_point_values_come_from_correct_columns_not_second_di_or_ports(self):
  value=self.reader.normalize('input',1)
  self.assertEqual(value['totals']['known_lli_channels'],dict(di=30,do=0,ai=0,ao=0));self.assertIsNone(value['hli_device_count']);self.assertIsNone(value['totals']['known_hli_devices'])
  self.assertEqual(value['source_cells'][1]['floor'],'BF');self.assertEqual(value['source_cells'][0]['cells']['di'],'D2');self.assertTrue(value['control_totals'][0]['matches'])
  self.assertIn('| BF | Pump 2 | 20 | 0 | 0 | 0 | 3 |',render_normalization(value))
 def test_missing_io_stays_unknown_and_control_mismatch_blocks_adoption(self):
  book=load_workbook(self.path);book['Room IO']['D2']=None;book.save(self.path);book.close();value=self.reader.normalize('input',1)
  self.assertIsNone(value['source_cells'][0]['io']['di']);self.assertGreater(value['totals']['pending_rows'],0);self.assertFalse(result_state('F3','normalize',[{'normalization':value}])['review'])
 def test_template_and_changed_version_cannot_be_point_inputs(self):
  with self.db() as c:c.execute("INSERT INTO workspace_material_tags VALUES ('input','F3','template')")
  with self.assertRaises(ToolException):ProjectMaterials(self.db,'P','F3').normalize('input',1)
  with self.db() as c:c.execute("UPDATE documents SET sha256='new' WHERE id='input'")
  with self.assertRaises(ToolException):self.reader.read('input',1)
 def test_bom_quantity_is_original_cell_not_a_new_selection(self):
  value=self.reader.configuration('input',3);self.assertEqual(value['rows'][0]['quantity'],2);self.assertEqual(value['rows'][0]['cells']['quantity'],'D2');self.assertIn('CPU with 14DI/10DO',render_configuration(value))
 def test_ambiguous_quantity_columns_are_not_silently_merged(self):
  book=load_workbook(self.path);book['BOM']['G1']='数量';book['BOM']['G2']=5;book.save(self.path);book.close()
  result=self.reader.configuration('input',3);self.assertEqual(result['status'],'needs_input');self.assertIn('数量',result['required_input']);self.assertTrue(self.reader.configuration('input',3)['duplicate_prevented'])
 def test_hli_device_quantity_uses_merged_group_anchor_not_serial_count(self):
  book=Workbook();s=book.active;s.title='Room IO'
  s.append(['No.','Floor','Room Name','TH',None,'DI','DO','AI','AO']);s.merge_cells('D1:E1')
  s.append([None,None,'Interface Type',12,'PS RS485'])
  s.append([1,'BF','Pump 1',24,2,10,0,0,0]);s.append([None,None,'汇总',24,2,10,0,0,0]);book.save(self.path);book.close()
  result=self.reader.normalize('input',1);self.assertEqual(result['hli_device_count'],24)
  group=result['hli']['groups'][0];self.assertEqual(group['quantity_column'],'D');self.assertEqual(group['interface_column'],'E')
  self.assertEqual(group['rows'][0]['cell'],'D3');self.assertTrue(group['control_totals'][0]['matches'])

 def test_preflight_extracts_evidence_without_relying_on_model_tool_choice(self):
  normalized=self.reader.prepare('normalize',[{'id':'input','purpose':'input'}])
  self.assertEqual(normalized[0]['normalization']['totals']['known_lli_channels']['di'],30)
  other=ProjectMaterials(self.db,'P','F4');prepared=other.prepare('qa',[{'id':'input','purpose':'input'}])
  self.assertEqual({x['tool'] for x in prepared},{'read_project_configuration','normalize_project_points'})
  self.assertTrue(result_state('F4','qa',prepared)['review'])

 def test_confirmed_capacity_uses_original_rows_without_model_retyping(self):
  from unittest.mock import patch
  from agent_engine import prepare_lli_capacity
  from test_bms_solution import policy
  sources=[{'id':'input','text':'Room IO original','purpose':'input'}]
  params={'bms_capacity_policy':policy().model_dump(),'bms_capacity_scope':'lli_only',
          'bms_allocation_zones':{'BF/Pump 1':'BF-A','BF/Pump 2':'BF-A'}}
  trace=self.reader.prepare('capacity',sources)
  with patch('access_control.check_project'):
   prepare_lli_capacity('pm','P','F3',sources,params,trace,self.reader)
  calculation=next(t['calculation'] for t in trace if t.get('calculation'))
  self.assertEqual(calculation['status'],'calculated')
  self.assertEqual(calculation['zones'][0]['modules']['di'],3)
  self.assertIsNone(calculation['zones'][0]['gateway_count'])
  self.assertTrue(result_state('F3','capacity',trace)['review'])
  self.assertFalse(result_state('F3','deliverable',trace)['review'])
  params['bms_allocation_zones']={};trace=self.reader.prepare('capacity',sources)
  with patch('access_control.check_project'):
   prepare_lli_capacity('pm','P','F3',sources,params,trace,self.reader)
  self.assertFalse(any(t.get('calculation') for t in trace))
  self.assertTrue(any(t.get('error') for t in trace))

 def test_capacity_and_queries_never_adopt_without_verified_result(self):
  self.assertFalse(result_state('F3','capacity',[])['review']);self.assertFalse(result_state('F4','deliverable',[{'configuration':{}}])['review']);self.assertFalse(result_state('F4','materials-survey',[])['review'])

if __name__=='__main__':unittest.main()
