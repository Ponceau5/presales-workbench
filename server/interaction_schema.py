"""Validated UI workflow vocabulary; no model-generated code or expressions."""
from typing import Literal
from pydantic import BaseModel,Field,model_validator,ConfigDict
class InteractionNode(BaseModel):
 model_config=ConfigDict(extra="forbid")
 id:str=Field(pattern=r"^[a-z][a-z0-9_-]{0,39}$")
 kind:Literal["inspect","procurement","upload","parameters","calculate","review","export"]
 title:str=Field(min_length=1,max_length=80)
 presentation:Literal["chat","panel"]="chat"
 when:Literal["always","missing_purchase"]="always"
 instruction:str=Field(default="",max_length=2000)
class InteractionFlow(BaseModel):
 model_config=ConfigDict(extra="forbid")
 navigation:Literal["free","guided"]="free"
 nodes:list[InteractionNode]=Field(min_length=5,max_length=10)
 @model_validator(mode="after")
 def valid(self):
  kinds=[n.kind for n in self.nodes]
  if len({n.id for n in self.nodes})!=len(self.nodes) or len(set(kinds))!=len(kinds):raise ValueError("步骤编号和能力不能重复")
  for kind in ("inspect","parameters","calculate","review","export"):
   if kinds.count(kind)!=1:raise ValueError("必须包含资料核对、参数确认、计算、审核和导出")
  calc=kinds.index("calculate")
  if kinds.index("inspect")>calc or kinds.index("parameters")>calc or not calc<kinds.index("review")<kinds.index("export"):raise ValueError("输入确认必须在计算之前，计算后审核再导出")
  if ("procurement" in kinds)!=("upload" in kinds):raise ValueError("询价和回价上传步骤必须成对出现")
  if "upload" in kinds and not kinds.index("inspect")<kinds.index("procurement")<kinds.index("upload")<calc:raise ValueError("先核对资料，再询价、上传回价，最后计算")
  for n in self.nodes:
   if n.kind in {"procurement","upload"}:
    if n.when!="missing_purchase":raise ValueError("询价与回价上传仅在缺有效回价时执行")
   elif n.when!="always":raise ValueError("必要确认与审核不能设置为跳过")
   if n.presentation=="panel" and n.kind!="parameters":raise ValueError("当前仅参数确认支持侧栏表单")
  return self
def default_flow():
 return InteractionFlow(nodes=[
  InteractionNode(id="sources",kind="inspect",title="核对配置清单与供货范围"),
  InteractionNode(id="enquiry",kind="procurement",title="准备采购询价清单",when="missing_purchase"),
  InteractionNode(id="return",kind="upload",title="上传并核对采购回价",when="missing_purchase"),
  InteractionNode(id="params",kind="parameters",title="确认成本参数",presentation="panel"),
  InteractionNode(id="cost",kind="calculate",title="生成成本草稿"),
  InteractionNode(id="check",kind="review",title="人工审核与采纳"),
  InteractionNode(id="file",kind="export",title="下载成本表")]).model_dump()

def render_skill_flow(markdown,flow):
 """Replace only UI-owned sections; preserve business rules and parameter defaults."""
 import re
 for title in ("启动与确认","操作流程（试运行步骤）","系统交互流程"):
  markdown=re.sub(r"(?m)^## "+re.escape(title)+r"\s*\n[\s\S]*?(?=^## |\Z)","",markdown)
 lines=["## 系统交互流程","可自由切换步骤，资料与参数可暂缺，缺失金额保持待补；生成草稿后由人审核采纳。" if flow.get("navigation","free")=="free" else "按步骤完成输入确认后生成，计算后人工审核采纳。"]
 for i,node in enumerate(flow["nodes"],1):
  presentation="（聊天确认卡片）" if node["kind"]=="parameters" and node["presentation"]=="chat" else "（参数侧栏表单）" if node["kind"]=="parameters" else ""
  condition="仅在缺少有效采购回价时执行；已有有效回价时跳过。" if node["when"]=="missing_purchase" else ""
  lines.append(str(i)+". **"+node["title"]+"**"+presentation+"："+condition+node.get("instruction",""))
 return markdown.strip()+"\n\n"+"\n\n".join(lines)
