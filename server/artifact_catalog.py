"""One catalog for adopted workspace outputs and the legacy F5 outputs."""
def all_artifacts(c,project):
 rows=[dict(r) for r in c.execute('SELECT * FROM workspace_artifacts WHERE project_id=? ORDER BY revision DESC,created_at DESC',(project,))]
 if project=='GSA02':
  if c.execute("SELECT 1 FROM sqlite_master WHERE name='software_artifacts'").fetchone():
   rows += [{**dict(r),'stage_id':'F5','specialized':True} for r in c.execute('SELECT id,title,revision,content,created_at FROM software_artifacts ORDER BY revision DESC,created_at DESC')]
  if c.execute("SELECT 1 FROM sqlite_master WHERE name='sizing_runs'").fetchone():
   rows += [{**dict(r),'title':'服务器规格方案','stage_id':'F5','content':r['narrative'] or '', 'sizing':True} for r in c.execute("SELECT id,revision,narrative,created_at FROM sizing_runs WHERE status='approved' ORDER BY revision DESC")]
 lifecycle={r['artifact_id']:dict(r) for r in c.execute('SELECT * FROM artifact_lifecycle')}
 for row in rows:
  state=lifecycle.get(row['id'],{})
  row.update(disabled=bool(state.get('disabled')),replacement_id=state.get('replacement_id'))
 return rows
