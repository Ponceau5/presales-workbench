"""Read registered project sources with sheet/cell provenance; never infer engineering policy."""
from execution_control import checkpoint,ExecutionCancelled
import json
import math
import re
import threading
from pathlib import Path
from langchain_core.tools import ToolException
from bms_solution import PointRow, normalize_points


def column_name(index):
    result = ''
    while index >= 0:
        index, remainder = divmod(index, 26)
        result = chr(65 + remainder) + result
        index -= 1
    return result


class ProjectMaterials:
    def __init__(self, db, project, stage):
        self.db, self.project, self.stage = db, project, stage
        self.books, self.point_rows, self.reads = {}, {}, []
        self.extraction_failures, self.extraction_results = {}, {}
        self.extraction_lock=threading.RLock()
        with db() as c:
            self.documents = {r['id']: dict(r) for r in c.execute(
                "SELECT d.*,COALESCE(r.category,'input') category FROM documents d LEFT JOIN document_registry r ON r.document_id=d.id WHERE d.project_id=? AND COALESCE(r.category,'input') NOT IN ('temporary','disabled') ORDER BY d.created_at DESC", (project,))}
            template_ids=set()
            if c.execute("SELECT 1 FROM sqlite_master WHERE name='workspace_material_tags'").fetchone():
                template_ids={r[0] for r in c.execute("SELECT document_id FROM workspace_material_tags WHERE stage_id IN (?, '*') AND category='template'",(stage,))}
            for doc in self.documents.values():
                checkpoint()
                if doc['id'] in template_ids:doc['category']='template'
                doc['pages'] = [dict(r) for r in c.execute('SELECT page,substr(text,1,180) heading,length(text) characters FROM document_pages WHERE document_id=? ORDER BY page', (doc['id'],))]
                for page in doc['pages']:
                    page['heading'] = page['heading'].splitlines()[0] if page['heading'] else ''

    def search(self, query):
        import project_retrieval
        return project_retrieval.search(self.db,self.project,query,set(self.documents),self.stage)

    def catalog(self, query=''):
        terms = [s.casefold() for s in query.split() if s]
        docs = [d for d in self.documents.values() if not terms or any(t in (d['title']+' '+d['filename']+' '+ ' '.join(p['heading'] for p in d['pages'])).casefold() for t in terms)]
        return {'total_documents': len(self.documents), 'matches': len(docs), 'documents': [
            {k:d[k] for k in ('id','title','version','category','pages')} for d in docs[:30]],
            'has_more': len(docs)>30, 'meaning':'目录只说明已登记；需读取正文后判断内容，不把未读到当成缺失'}

    def survey(self):
        """Prepare registered inventory once, without a model choosing each file."""
        documents=[];remaining=12000
        for doc in self.documents.values():
            checkpoint()
            entry={k:doc[k] for k in ('id','title','version','category')}
            entry['page_count']=len(doc['pages'])
            entry['read_status']='已解析' if any(p['characters'] for p in doc['pages']) else '暂无可读取正文'
            entry['excerpts']=[]
            if remaining>0:
                with self.db() as c:
                    rows=c.execute('SELECT page,substr(text,1,600) text FROM document_pages WHERE document_id=? ORDER BY page LIMIT 2',(doc['id'],)).fetchall()
                for row in rows:
                    text=row['text'][:remaining];remaining-=len(text)
                    if text:entry['excerpts'].append({'page':row['page'],'text':text})
            documents.append(entry)
        return {'total_documents':len(documents),'documents':documents,'scope':'已核对全部登记目录和解析状态；正文为节选，具体需求和版本冲突待原件核对'}

    def document(self, identifier):
        checkpoint()
        doc = self.documents.get(identifier)
        if not doc:
            with self.db() as c:
                existing=c.execute('SELECT project_id FROM documents WHERE id=?',(identifier,)).fetchone()
                registry=c.execute('SELECT category FROM document_registry WHERE document_id=?',(identifier,)).fetchone()
            if not existing: raise ToolException('资料不存在，请核对文件标识')
            if existing['project_id'] != self.project: raise ToolException('无权读取其他项目资料')
            if registry and registry['category']=='disabled': raise ToolException('资料已停用，新任务不可读取，请选择当前版本')
            raise ToolException('资料未包含在本次执行的版本快照中')
        with self.db() as c:
            current = c.execute('SELECT sha256 FROM documents WHERE id=? AND project_id=?', (identifier,self.project)).fetchone()
        if not current or current['sha256'] != doc['sha256']:
            raise ToolException('资料版本已变化，请重新开始本次任务')
        return doc

    def workbook(self, identifier):
        if identifier in self.books:
            return self.books[identifier]
        doc = self.document(identifier)
        if Path(doc['filename']).suffix.lower() not in {'.xls','.xlsx','.xlsm'}:
            return None
        from object_storage import materialize
        try:
            with materialize(doc['path']) as path:
                if path.suffix.lower()=='.xls':
                    import xlrd
                    book=xlrd.open_workbook(path,formatting_info=True)
                    sheets=[]
                    try:
                        for sheet in book.sheets():
                            rows=[]
                            for i in range(sheet.nrows):
                                checkpoint();rows.append(sheet.row_values(i))
                            sheets.append({'name':sheet.name,'rows':rows,'merged':sheet.merged_cells})
                    finally:book.release_resources()
                else:
                    from openpyxl import load_workbook
                    book=load_workbook(path,data_only=True)
                    sheets=[]
                    try:
                        for sheet in book:
                            rows=[]
                            for row in sheet.iter_rows(values_only=True):
                                checkpoint();rows.append(list(row))
                            sheets.append({'name':sheet.title,'rows':rows,'merged':[(r.min_row-1,r.max_row,r.min_col-1,r.max_col) for r in sheet.merged_cells.ranges]})
                    finally:book.close()
        except ExecutionCancelled:
            raise
        except Exception as error:
            raise ToolException('原始表格暂时无法读取；不能用文本节选代替完整表格核对') from error
        self.books[identifier]=sheets
        return sheets

    def sheet(self, identifier, page):
        doc=self.document(identifier)
        sheets=self.workbook(identifier)
        if not sheets:
            return None
        meta=next((p for p in doc['pages'] if p['page']==page),None)
        if not meta:
            raise ToolException('资料页不存在')
        name=re.sub(r'^工作表[：:]\s*','',meta['heading'])
        found=next((s for s in sheets if s['name']==name),None)
        if found is None:
            raise ToolException('无法将资料页对应到原始工作表，请查看工作表目录')
        return found

    @staticmethod
    def value(sheet, row, col):
        origin=None
        for r0,r1,c0,c1 in sheet['merged']:
            if r0<=row<r1 and c0<=col<c1:
                origin=column_name(c0)+str(r0+1);row,col=r0,c0;break
        values=sheet['rows']
        value=values[row][col] if row<len(values) and col<len(values[row]) else None
        if isinstance(value,float) and not math.isfinite(value):value=None
        return value,origin

    def read(self, identifier, page, start_row=1, row_count=30, query=''):
        if start_row<1 or not 1<=row_count<=80:raise ToolException('请指定有效起始行，每次读取1至80行')
        doc=self.document(identifier);key=(identifier,doc['version'],page,'read_project_material')
        with self.extraction_lock:
            if key in self.extraction_failures:raise ToolException(self.extraction_failures[key]['error']+'；相同原页读取已失败，请补充可读取的该页或确认文件版本。')
            try:return self._read(identifier,page,start_row,row_count,query)
            except ToolException as error:
                self.extraction_failures[key]={'document_id':identifier,'version':doc['version'],'page':page,'method':'read_project_material','error_type':type(error).__name__,'failure_signature':[*key,type(error).__name__],'error':str(error)}
                raise

    def _read(self, identifier, page, start_row=1, row_count=30, query=''):
        doc=self.document(identifier)
        if not doc['pages']: raise ToolException('原件已保存，但正文未解析；不得声称已读，可重试解析或提供可读取的文件')
        if start_row<1 or not 1<=row_count<=80:
            raise ToolException('请指定有效起始行，每次读取1至80行')
        sheet=self.sheet(identifier,page)
        if sheet:
            rows=sheet['rows'];indices=list(range(start_row-1,min(len(rows),start_row-1+row_count)))
            if query:
                indices=[i for i,row in enumerate(rows) if query.casefold() in ' '.join(map(str,row)).casefold()][:row_count]
            cells=[]
            for i in indices:
                values={column_name(j):v for j in range(len(rows[i])) if (v:=self.value(sheet,i,j)[0]) not in {None,''}}
                cells.append({'row':i+1,'cells':values})
            result={'document_id':identifier,'title':doc['title'],'version':doc['version'],'category':doc['category'],'page':page,'sheet':sheet['name'],'total_rows':len(rows),'rows':cells,
                    'range_complete':not query and start_row==1 and len(indices)==len(rows),'next_row':indices[-1]+2 if indices and indices[-1]+1<len(rows) else None,
                    'cell_convention':'列字母+行号为原Excel位置；合并单元格从左上角展开；空白和0不同；只读原件缓存值，未重算公式'}
        else:
            with self.db() as c:
                row=c.execute('SELECT text FROM document_pages WHERE document_id=? AND page=?',(identifier,page)).fetchone()
            if not row:raise ToolException('资料页不存在')
            lines=row['text'].splitlines()
            indices=[i for i,line in enumerate(lines) if query.casefold() in line.casefold()][:row_count] if query else list(range(start_row-1,min(len(lines),start_row-1+row_count)))
            result={'document_id':identifier,'title':doc['title'],'version':doc['version'],'category':doc['category'],'page':page,'total_rows':len(lines),'lines':[{'line':i+1,'text':lines[i]} for i in indices], 'next_row':indices[-1]+2 if indices and indices[-1]+1<len(lines) else None}
        if query and not indices: result.update(retrieval_status='no_match', message='本页正文没有匹配内容，不代表其他资料不存在')
        self.reads.append({'document_id':identifier,'page':page,'start_row':start_row,'row_count':row_count,'query':query})
        return result

    def reading_plan(self):
        return {'documents':[{'id':d['id'],'title':d['title'],'version':d['version'],'pages':d['pages'],'status':'ready' if any(p['characters'] for p in d['pages']) else 'unparsed','method':'原表单元格' if Path(d['filename']).suffix.lower() in {'.xls','.xlsx'} else '按页正文','on_structured_failure':'只降级读取原表一次；仍缺字段则询问用户'} for d in self.documents.values()], 'rule':'不同工作表分别核对；同一版本同一页失败的方法不重复执行'}

    def normalize(self, identifier, page):
        with self.extraction_lock:return self._normalize_once(identifier,page)

    def _normalize_once(self, identifier, page):
        doc=self.document(identifier)
        if doc['category']!='input':raise ToolException('输出模板不能作为点表事实')
        key=(identifier,doc['version'],page,'normalize_project_points')
        if key in self.extraction_results:
            return {**self.extraction_results[key],'duplicate_prevented':True}
        try:
            result=self._normalize(identifier,page)
        except ToolException as error:
            signature=(*key,type(error).__name__)
            failure={'document_id':identifier,'title':doc['title'],'version':doc['version'],'page':page,'method':'normalize_project_points','error_type':type(error).__name__,'failure_signature':list(signature),'error':str(error)}
            self.extraction_failures[key]=failure
            try:
                raw=self.read(identifier,page,1,30)
                result={**failure,'status':'needs_input','fallback_method':'read_project_material','fallback':raw,'required_input':f"请确认《{doc['title']}》{doc['version']} 第{page}页/工作表中楼层、房间、DI、DO、AI、AO分别对应哪列；未确认前不生成确认数量。"}
            except ToolException as fallback_error:
                result={**failure,'status':'needs_input','fallback_method':'read_project_material','fallback_error':str(fallback_error),'required_input':f"请补充《{doc['title']}》{doc['version']} 第{page}页的可读取原表和DI、DO、AI、AO列映射。"}
            self.extraction_results[key]=result
        return result

    def _normalize(self, identifier, page):
        doc=self.document(identifier)
        if doc['category']!='input':raise ToolException('输出模板不能作为点表事实')
        sheet=self.sheet(identifier,page)
        if not sheet:raise ToolException('点表归一化需要已登记的原始Excel')
        values=sheet['rows'];header=None;cols={}
        # Detect a room-level IO schedule by its actual labels, never by project/file name.
        for i,row in enumerate(values[:12]):
            labels=[re.sub(r'\s+','',str(self.value(sheet,i,j)[0] or '')).casefold() for j in range(len(row))]
            found={key:next((j for j,label in enumerate(labels) if label in names),None) for key,names in {
                'floor':{'floor','楼层'},'room':{'roomname','room','房间','房间名称'},'di':{'di'},'do':{'do'},'ai':{'ai'},'ao':{'ao'}}.items()}
            if all(v is not None for v in found.values()) and [found[k] for k in ('do','ai','ao')]==[found['di']+n for n in (1,2,3)]:header=i;cols=found;break
        if header is None:raise ToolException('该表尚不能可靠自动识别四类IO列；请先读取原表单元格，澄清表头映射，不得猜测或把串口数当设备台数')
        rows=[];evidence=[];ports=[];last_floor=None;floor_cell=None
        for i in range(header+1,len(values)):
            raw=values[i]
            if not raw or not isinstance(raw[0],(int,float)) or not self.value(sheet,i,cols['room'])[0]:continue
            room=str(self.value(sheet,i,cols['room'])[0]).strip()
            explicit_floor=self.value(sheet,i,cols['floor'])[0]
            if explicit_floor not in {None,''}:last_floor=str(explicit_floor).strip();floor_cell=column_name(cols['floor'])+str(i+1)
            floor=last_floor or '未标注'
            signals={k:self.value(sheet,i,cols[k])[0] for k in ('di','do','ai','ao')}
            if any(v not in {None,''} and (not isinstance(v,(int,float)) or v<0 or int(v)!=v) for v in signals.values()):continue
            channels={k:int(v) if isinstance(v,(int,float)) else None for k,v in signals.items()}
            location=sheet['name']+'!'+column_name(cols['di'])+str(i+1)+':'+column_name(cols['ao'])+str(i+1)
            rows.append(PointRow(floor=floor,room=room,allocation_zone=floor+'/'+room,device_type='房间硬接线通道汇总',quantity=1,interface='LLI',transport='hardwired',io_basis='row_total',source_index=0,source_locator=location,**channels))
            evidence.append({'row':i+1,'floor':floor,'floor_source':floor_cell,'room':room,'io':channels,'cells':{k:column_name(cols[k])+str(i+1) for k in channels}})
            serial={}
            for j,label in enumerate(values[header]):
                if re.sub(r'\s+','',str(label)) in {'串口','串口总数','网口总数','串口汇总'}:
                    serial[column_name(j)]=self.value(sheet,i,j)[0]
            if serial:ports.append({'row':i+1,'room':room,'existing_design_ports':serial})
        if not rows:raise ToolException('未识别到带原行来源的房间点表记录')
        self.point_rows[(identifier,page)]=rows
        locations={}
        for item in evidence:locations.setdefault((item['floor'],item['room']),[]).append(item['row'])
        duplicates=[{'floor':key[0],'room':key[1],'rows':items} for key,items in locations.items() if len(items)>1]
        result=normalize_points(rows)
        hli=self.hli_counts(sheet,header,cols['di'],evidence)
        result['totals']['known_hli_devices']=sum(g['known_quantity'] for g in hli['groups']) if hli['groups'] else None
        controls=[]
        for i,raw in enumerate(values):
            if any(str(v).strip().casefold() in {'汇总','合计','total','totals'} for v in raw[:cols['room']+1]):
                totals={k:self.value(sheet,i,cols[k])[0] for k in ('di','do','ai','ao')}
                if all(isinstance(v,(int,float)) for v in totals.values()):
                    controls.append({'row':i+1,'values':totals,'matches':all(totals[k]==result['totals']['known_lli_channels'][k] for k in totals)})
        if any(not item['matches'] for item in controls):result['issues'].append({'reason':'明细合计与原表汇总行不一致，请核对有效数据范围','controls':controls})
        if any(not c['matches'] for g in hli['groups'] for c in g['control_totals']):result['issues'].append({'reason':'HLI设备数量与原表合计不一致，待核对'})
        result.update(control_totals=controls,location_duplicates=duplicates,hli=hli,
                     document_id=identifier,title=doc['title'],version=doc['version'],page=page,sheet=sheet['name'],total_excel_rows=len(values),room_rows=len(rows),source_cells=evidence,
                      existing_port_columns=ports,scope='完整读取本工作表中可识别的房间硬接线汇总行；不是逐设备点表，不包含其他工作表；房间不是已确认共享分配区域',
                      hli_device_count=result['totals']['known_hli_devices'],notice='HLI按接口表头对应的设备数量列统计，串口/网口列是原设计端口数量，不重复计作台数；原空白未作为新增数量；未调用容量计算，未选择PLC型号')
        return result

    def hli_counts(self, sheet, header, before_column, evidence):
        groups=[];used=set()
        for col in range(before_column):
            interface=str(self.value(sheet,header+1,col)[0] or '')
            if not re.search(r'RS.?485|Ethernet',interface,re.I):continue
            quantity_col=col
            for r0,r1,c0,c1 in sheet['merged']:
                if r0<=header<r1 and c0<=col<c1:quantity_col=c0;break
            if quantity_col in used:continue
            name=str(self.value(sheet,header,quantity_col)[0] or '').strip()
            if not name:continue
            used.add(quantity_col);items=[];unknown=[]
            for location in evidence:
                value=self.value(sheet,location['row']-1,quantity_col)[0]
                if value in {None,''}:unknown.append(location['row']);continue
                if not isinstance(value,(int,float)) or value<0 or int(value)!=value:
                    unknown.append(location['row']);continue
                items.append({'floor':location['floor'],'room':location['room'],'quantity':int(value),'cell':column_name(quantity_col)+str(location['row'])})
            control=[]
            for i,row in enumerate(sheet['rows']):
                if any(str(v).strip().casefold() in {'汇总','合计','total','totals'} for v in row[:3]):
                    value=self.value(sheet,i,quantity_col)[0]
                    if isinstance(value,(int,float)):control.append({'cell':column_name(quantity_col)+str(i+1),'quantity':value,'matches':value==sum(v['quantity'] for v in items)})
            groups.append({'device':name,'transport':'rs485' if '485' in interface else 'ethernet','quantity_column':column_name(quantity_col),'interface_column':column_name(col),'known_quantity':sum(v['quantity'] for v in items),'rows':items,'blank_or_unknown_rows':unknown,'control_totals':control})
        return {'groups':groups,'scope':'本工作表设备数量列已填原值小计；单元格空白不新增数量，不用串口链数替代设备台数，其他点表版本未合并'}

    def configuration(self, identifier, page):
        doc=self.document(identifier)
        if doc['category']!='input':raise ToolException('模板示例不能作为现有配置数量')
        key=(identifier,doc['version'],page,'read_project_configuration')
        with self.extraction_lock:
            if key in self.extraction_results:return {**self.extraction_results[key],'duplicate_prevented':True}
            try:return self._configuration(identifier,page)
            except ToolException as error:
                failure={'document_id':identifier,'title':doc['title'],'version':doc['version'],'page':page,'method':'read_project_configuration','error_type':type(error).__name__,'failure_signature':[*key,type(error).__name__],'error':str(error)}
                self.extraction_failures[key]=failure
                result={**failure,'status':'needs_input','fallback_method':'read_project_material','required_input':f"请确认《{doc['title']}》{doc['version']} 第{page}页设备名、型号、数量分别对应哪列，以及数量采用哪列。"}
                try:result['fallback']=self.read(identifier,page,1,30)
                except ToolException as fallback_error:result['fallback_error']=str(fallback_error)
                self.extraction_results[key]=result
                return result

    def _configuration(self, identifier, page):
        doc=self.document(identifier)
        if doc['category']!='input':raise ToolException('模板示例不能作为现有配置数量')
        sheet=self.sheet(identifier,page)
        if not sheet:raise ToolException('请提供原始Excel配置清单')
        columns=None;header=None
        for i,row in enumerate(sheet['rows'][:12]):
            labels=[re.sub(r'\s+','',str(self.value(sheet,i,j)[0] or '')).casefold() for j in range(len(row))]
            patterns={'name':r'设备名|equipmentname','model':r'规格型号|specification|^spec$','quantity':r'数量|quantity|qty','brand':r'品牌|brand','unit':r'单位|^unit$'}
            found={k:[j for j,label in enumerate(labels) if re.search(pattern,label)] for k,pattern in patterns.items()}
            if all(len(found[k])==1 for k in ('name','model','quantity')):
                columns={k:v[0] for k,v in found.items() if len(v)==1};header=i;break
        if columns is None:raise ToolException('该表有多组数量列或表头无法唯一识别，请读取原始单元格逐组核对；不能自动合并数量')
        rows=[]
        for i in range(header+1,len(sheet['rows'])):
            values={k:self.value(sheet,i,col)[0] for k,col in columns.items()}
            if not values['name'] or not values['model']:continue
            quantity=values['quantity']
            if quantity not in {None,''} and not isinstance(quantity,(int,float)):continue
            values['quantity']=quantity if isinstance(quantity,(int,float)) else None
            rows.append({'row':i+1,**values,'cells':{k:column_name(col)+str(i+1) for k,col in columns.items()}})
        if not rows:raise ToolException('未识别到有型号和原行来源的配置记录')
        return {'document_id':identifier,'title':doc['title'],'version':doc['version'],'page':page,'sheet':sheet['name'],'rows':rows,'row_count':len(rows),
                'scope':'完整读取当前工作表中设备名/型号/数量可识别的原有清单行；不合并其他表、不计价格、不证明选型或容量通过'}

    def prepare(self, task, sources):
        """Mandatory source parsing is an input step, not a model's optional arithmetic."""
        operation='normalize' if self.stage=='F3' and task in {'normalize','capacity','deliverable'} else 'configuration' if self.stage=='F4' and task in {'deliverable','qa'} else None
        if not operation:return []
        identifiers=list(dict.fromkeys(s.get('id') for s in sources if s.get('id') in self.documents and s.get('purpose','input')=='input'))
        for identifier in identifiers:
            doc=self.document(identifier)
            if doc['category']!='input' or Path(doc['filename']).suffix.lower() not in {'.xls','.xlsx','.xlsm'}:continue
            pages=doc['pages']
            if operation=='normalize':pages=sorted(pages,key=lambda p:('点表' not in p['heading'],p['page']))
            for page in pages:
                try:
                    value=getattr(self,operation)(identifier,page['page'])
                    if value.get('status')=='needs_input':continue
                    if operation=='configuration' and not any(re.search(r'PLC|网关|采集器|控制器|模块|交换机',str(r['name']),re.I) for r in value['rows']):continue
                    result=[{'tool':'normalize_project_points' if operation=='normalize' else 'read_project_configuration','call':0,'invoked_by':'input_preflight', 'normalization' if operation=='normalize' else 'configuration':value}]
                    if self.stage=='F4' and task=='qa':
                        for other_page in doc['pages']:
                            try:
                                points=self.normalize(identifier,other_page['page'])
                                if points.get('status')=='needs_input':continue
                                result.append({'tool':'normalize_project_points','call':0,'invoked_by':'input_preflight','normalization':points});break
                            except ToolException:continue
                    return result
                except ToolException:continue
        return []

    def validate_rows(self, rows, snapshots, allocation_zones=None):
        for row in rows:
            if row.source_index>=len(snapshots):raise ToolException('点表来源不在本次引用范围内')
            identifier=snapshots[row.source_index].get('id')
            candidates=[r for (doc,_),items in self.point_rows.items() if doc==identifier for r in items]
            zone_key=row.floor+'/'+row.room
            if not allocation_zones or allocation_zones.get(zone_key)!=row.allocation_zone:
                raise ToolException('请由用户确认每个位置的分配区域，不能默认把房间当成共享控制器区域')
            if not any(row.model_dump(exclude={'source_index','allocation_zone'})==r.model_dump(exclude={'source_index','allocation_zone'}) for r in candidates):
                raise ToolException('计算行须来自本次原表归一化结果，不能自行改写数量、来源或分配区域')


def result_state(stage, task, trace):
    if stage not in {'F3','F4'}:return None
    if task in {'materials-survey','survey'}:return {'status':'query','review':False,'reason':''}
    verified=next((t.get('normalization') for t in reversed(trace) if t.get('normalization')),None)
    calculated=next((t.get('calculation') for t in reversed(trace) if t.get('calculation')),None)
    configuration=next((t.get('configuration') for t in reversed(trace) if t.get('configuration')),None)
    if task=='qa' and configuration and verified:
        return {'status':'draft','review':True,'reason':'原件核对台账；不代表容量或新选型通过'}
    if task=='normalize' and verified and not verified['issues']:
        return {'status':'draft','review':True,'reason':'原表硬接线汇总已归一化；仍需人工核对范围'}
    if task=='deliverable' and calculated and calculated.get('scope','').startswith('仅'):
        return {'status':'blocked','review':False,'reason':'已完成局部容量计算；完整技术配置或硬件选型仍需工程依据。'}
    if task in {'capacity','deliverable'} and calculated and calculated.get('status')=='calculated':
        return {'status':'draft','review':True,'reason':''}
    return {'status':'blocked','review':False,'reason':'尚未形成可采纳工件：请补齐当前流程所需依据，完成原件核对与必要的计算。'}


def render_normalization(value):
    totals=value['totals']['known_lli_channels']
    hli=value.get('hli',{}).get('groups',[])
    lines=['## 点表归一化（待人工核对）',f"来源：{value['title']} · {value['version']} · 工作表「{value['sheet']}」",value['scope'],
           f"识别位置行：{value['room_rows']}。硬接线合计：DI {totals['di']}、DO {totals['do']}、AI {totals['ai']}、AO {totals['ao']}。",
           ('HLI 原表已列设备数量小计：'+str(value['hli_device_count'])+'。按设备数量列统计，串口/网口数量不重复计入。') if hli else 'HLI 设备台数：尚未按设备明细统计。串口/网口数量不作为设备台数。',
           '| 楼层 | 房间/位置 | DI | DO | AI | AO | 原表行 |', '| --- | --- | ---: | ---: | ---: | ---: | --- |']
    for row in value['source_cells']:
        io=row['io'];cells=[row['floor'],row['room'],*[str(io[k]) if io[k] is not None else '待确认' for k in ('di','do','ai','ao')],str(row['row'])]
        lines.append('| '+' | '.join(str(c).replace('|','\\|') for c in cells)+' |')
    if hli:
        lines += ['### HLI设备类别数量（原表已填值小计）','| 设备类别 | 接口 | 已列数量 | 数量来源列 | 原表合计核对 |','| --- | --- | ---: | --- | --- |']
        for group in hli:
            checks=group['control_totals'];status='一致' if checks and all(c['matches'] for c in checks) else '待核对'
            lines.append('| '+' | '.join([group['device'].replace('\n',' '),group['transport'],str(group['known_quantity']),value['sheet']+'!'+group['quantity_column'],status])+' |')
        lines.append(value['hli']['scope'])
    if value.get('control_totals'):
        lines += ['### 原表汇总核对',*['第 '+str(c['row'])+' 行：'+('明细合计一致' if c['matches'] else '明细合计不一致，待确认') for c in value['control_totals']]]
    lines += ['### 范围与待确认','同表楼层空白按该表上一处楼层标题继承，原位置和行号保留；空白IO保持待确认，不补零。',value['notice'],
              '本结果仅对应上述原表版本。其他点表版本分别核对，不将同一设备跨表重复累计。共享控制器区域、串接上限、有效通道及预留尚需确认，未形成容量计算书或最终供货BOM。']
    if value.get('location_duplicates'):
        lines += ['### 原位置重复待核对','同一楼层/位置在原表重复出现，保留全部原行，未擅自合并或删除：',*[' / '.join([v['floor'],v['room']])+'：第'+ '、'.join(map(str,v['rows']))+'行' for v in value['location_duplicates']]]
    if value['issues']:lines.append('待处理：'+json.dumps(value['issues'],ensure_ascii=False))
    return '\n\n'.join(lines[:5])+'\n\n'+'\n'.join(lines[5:])


def render_capacity_status(calculation):
    if not calculation:
        return ("## 容量校核待确认\n\n当前尚未形成容量计算书，不判断现有PLC或模块是否足够，也不生成新BOM。\n\n"
                "已登记的点表和配置文件可继续读取，不需要重复上传。请确认：\n\n"
                "1. 房间与共享控制器/机柜的分配关系。\n"
                "2. 每串RS485设备上限、网关有效端口和上行占口。\n"
                "3. CPU自带IO、扩展模块有效通道及兼容/扩展限制，附实际型号依据。\n"
                "4. 交换机预留、额外网络设备占口，以及20%预留是否已经包含。\n\n"
                "原件中已有的端口或设备数量仅是原设计记录，不能替代上述适用性确认。")
    show=lambda v:'未校核' if v is None else v
    lines=['## 分区域容量计算（待人工核对）', '| 区域 | 串口链 | 网关 | IO模块 | PLC槽位下限 | 交换机端口下限 | 状态 |', '| --- | ---: | ---: | --- | ---: | ---: | --- |']
    for zone in calculation['zones']:
        if zone['status']=='blocked':lines.append('| '+zone['zone']+' | — | — | — | — | — | '+ '；'.join(zone['missing'])+' |')
        else:lines.append('| '+ ' | '.join(map(str,map(show,[zone['zone'],zone['serial_chains'],zone['gateway_count'],zone['modules'],zone['plc_count_lower_bound'],zone['switch_count_lower_bound'],'待硬件兼容性复核'])))+' |')
    lines += ['### 依据与公式',json.dumps(calculation['rule_basis'],ensure_ascii=False),*['区域 '+z['zone']+'：'+json.dumps(z.get('formulas',{}),ensure_ascii=False) for z in calculation['zones']],*calculation['review_required']]
    return '\n'.join(lines)


def render_configuration(value):
    lines=['## 原件配置清单（待核对）',f"来源：{value['title']} · {value['version']} · 工作表「{value['sheet']}」",value['scope'],
           '| 设备 | 原型号 | 品牌 | 原数量 | 单位 | 原表行 |','| --- | --- | --- | ---: | --- | --- |']
    for row in value['rows']:
        fields=[row.get(k) if row.get(k) is not None else '待确认' for k in ('name','model','brand','quantity','unit')]+[row['row']]
        lines.append('| '+' | '.join(str(v).replace('\n',' ').replace('|','\\|') for v in fields)+' |')
    return '\n\n'.join(lines[:3])+'\n\n'+'\n'.join(lines[3:])


def render_review(configuration, points, catalog):
    lines=['## 配置清单与点表核对台账（待人工核对）',
           f"配置来源：{configuration['title']} · {configuration['version']} · {configuration['sheet']}。完整提取 {configuration['row_count']} 条具有设备名、型号和数量列的原件记录。",
           f"点表来源：{points['sheet']}，{points['room_rows']} 条原位置记录。以下只报告原件事实与待确认项，不判断新选型或容量通过。",
           '### 原清单中的控制与采集设备','| 设备 | 型号 | 原数量 | 原表位置 |','| --- | --- | ---: | --- |']
    for row in configuration['rows']:
        if re.search(r'PLC|网关|采集器|控制器|模块|交换机',str(row['name']),re.I):
            values=[row['name'],row['model'],row['quantity'] if row['quantity'] is not None else '待确认',configuration['sheet']+'!'+row['cells']['quantity']]
            lines.append('| '+' | '.join(str(v).replace('\n',' ').replace('|','\\|') for v in values)+' |')
    aliases=json.loads((Path(__file__).parent/'skills/bms-rules.json').read_text()).get('candidate_device_aliases',{})
    comparisons=[]
    for group in points.get('hli',{}).get('groups',[]):
        labels=aliases.get(group['device'],[])
        matches=[r for r in configuration['rows'] if any(label in str(r['name']) for label in labels) and isinstance(r['quantity'],(int,float))]
        if len(matches)==1:
            row=matches[0]
            comparisons.append('| '+' | '.join([group['device'],str(group['known_quantity']),str(row['quantity']),str(row['quantity']-group['known_quantity']),points['sheet']+'!'+group['quantity_column']+' / '+configuration['sheet']+'!'+row['cells']['quantity']])+' |')
    if comparisons:
        lines += ['### 候选设备数量对照（名称映射待确认）','按设备类别名称做候选对照，数量差异可能来自范围、备件或版本变化，不直接判断漏供或应增补。','| 类别 | 点表已列数量 | 原配置数量 | 数量差异 | 原件位置 |','| --- | ---: | ---: | ---: | --- |',*comparisons]
    lines += ['### 点表明细与原表汇总']
    for control in points['control_totals']:
        lines.append('第'+str(control['row'])+'行汇总：'+ '、'.join(k.upper()+' '+str(v) for k,v in control['values'].items())+'；'+('与已提取明细一致' if control['matches'] else '与明细不一致，待确认'))
    duplicates=points.get('location_duplicates',[])
    lines += ['### 原位置重复待核对']
    if duplicates:
        lines += ['同一楼层和位置名称重复出现，保留全部原行，不能直接判为重复供货或擅自去重。',*[' / '.join([v['floor'],v['room']])+'：原表第'+ '、'.join(map(str,v['rows']))+'行' for v in duplicates]]
    else:lines.append('本工作表未发现同楼层同位置名称重复。')
    missing=[row for row in configuration['rows'] if row['quantity'] is None]
    lines += ['### 清单数量字段']
    if missing:lines += [row['name']+'：'+configuration['sheet']+'!'+row['cells']['quantity']+'为空，保持待确认。' for row in missing]
    else:lines.append('已提取清单行的数量列均有原值；这不证明型号兼容或容量足够。')
    lines += ['### 已登记资料与版本边界']
    for doc in catalog['documents']:
        if re.search(r'点表|配置|设备清单',doc['title']):
            lines.append(doc['title']+' · '+doc['version']+'。不同版本先确认适用范围，不直接合并或判为漏供。')
        for page in doc['pages']:
            if re.search(r'界面|白名单',page['heading']):lines.append(doc['title']+'：第'+str(page['page'])+'页「'+page['heading']+'」已经登记；内容有效性及供货边界仍需核对。')
    lines += ['### 尚需工程确认','本次未执行容量/兼容性校核。新数量或增补模块需要实际型号手册、CPU自带IO、有效通道与预留口径、区域共享和网络拓扑的确认。原清单中存在某型号，不代表该型号已通过新选型。']
    return '\n\n'.join(lines[:3])+'\n\n'+'\n'.join(lines[3:])
