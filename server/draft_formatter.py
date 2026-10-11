"""将模型建议限定为结构化角色；存储数值只来自计算工具。"""
import math
from typing import Literal
from pydantic import BaseModel,Field,model_validator

class RoleSuggestion(BaseModel):
    role:Literal["全合一","采集","库与应用"]
    cpu_cores:int=Field(ge=16,le=32)
    memory_gb:Literal[64,128,256]

class Option(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    roles:list[RoleSuggestion]=Field(min_length=1,max_length=2)
    reason:str=Field(min_length=1,max_length=500)
    @model_validator(mode="after")
    def allowed_layout(self):
        names=[r.role for r in self.roles]
        if names!=["全合一"] and set(names)!={"采集","库与应用"}:
            raise ValueError("本次演示只允许全合一或采集分离候选架构")
        if len(names)!=len(set(names)):raise ValueError("角色重复")
        return self

class Draft(BaseModel):
    summary:str=Field(min_length=1,max_length=800)
    options:list[Option]=Field(min_length=2,max_length=3)
    recommended_index:int=Field(ge=0,le=2)
    clarifications:list[str]=Field(min_length=1,max_length=12)
    @model_validator(mode="after")
    def valid_index(self):
        if self.recommended_index>=len(self.options):raise ValueError("主推索引无效")
        if len({tuple(r.role for r in o.roles) for o in self.options})!=len(self.options):
            raise ValueError("候选架构必须不同")
        return self

def hardware_spec(role:RoleSuggestion,calculation:dict)->dict:
    high=calculation["high"];inputs=calculation["inputs"]
    required=(high["raw_data_gb"]*inputs["raid_usable_ratio"] if role.role=="全合一" else
              (high["cache_gb"] if role.role=="采集" else high["time_series_gb"]+high["pg_gb"]+high["backup_gb"])*(1+inputs["headroom"]))
    disks=max(3,math.ceil(required/1920)+1)
    cpu=(f"{role.cpu_cores//16} × Intel Xeon Silver 4314，16核/颗，2.4GHz；合计{role.cpu_cores}核"
         if role.cpu_cores in (16,32) else f"总计{role.cpu_cores}物理核；具体CPU型号待选型")
    return {"model":"Dell PowerEdge R750xs（参考选型）", "cpu":cpu,
            "memory":f"{role.memory_gb}GB ECC DDR4 RDIMM（{role.memory_gb//32}×32GB，通道布局待确认）",
            "system":"2×960GB 企业级 SATA SSD，RAID1",
            "data":f"{disks}×1.92TB 企业级 SATA SSD，RAID5；可用约{(disks-1)*1.92:.2f}TB",
            "network":"双口10GbE＋独立带外管理口",
            "power":"双冗余热插拔电源，功率随配置核定",
            "required":required,"usable":(disks-1)*1920}

def format_draft(draft:Draft, calculation:dict)->str:
    high=calculation["high"];inputs=calculation["inputs"]
    lines=["## 服务器规格方案", "", f"**推荐：{draft.options[draft.recommended_index].name}**", "",draft.summary, ""]
    order=[draft.recommended_index]+[i for i in range(len(draft.options)) if i!=draft.recommended_index]
    for index in order:
        option=draft.options[index]
        lines += ["### "+option.name+(" · 推荐" if index==draft.recommended_index else " · 备选"),"",
                  f"**共 {len(option.roles)*2} 台服务器；每种角色 1 主＋1 备，主备同规格。**", "",option.reason,"",
                  "| 服务器角色 | 台数 / 部署 | 参考机型 | CPU（每台） | 内存（每台） | 系统盘（每台） | 数据盘（每台） |",
                  "| --- | --- | --- | --- | --- | --- | --- |"]
        for role in option.roles:
            hw=hardware_spec(role,calculation)
            lines.append(f"| **{role.role}** | **2台 · 主备** | **{hw['model']}** | {hw['cpu']} | **{hw['memory']}** | {hw['system']} | **{hw['data']}** |")
        lines += ["", "**配套配置（每台）**：支持 RAID1/5 的硬件 RAID 控制器，带缓存及掉电保护；双口 **10GbE**，独立带外管理口；**双冗余热插拔电源**、滑轨及匹配电源线。光模块、控制器型号及电源功率按最终机型配置确认。", "",
                  "**软件与维保**：操作系统、数据库版本与授权，以及维保年限/响应等级待确认；备份介质与热备盘独立配置。", ""]
        for role in option.roles:
            hw=hardware_spec(role,calculation)
            lines.append(f"- **{role.role}容量校核**：含余量需求 {hw['required']:,.3f}GB；所选 RAID5 组合可用 {hw['usable']:,.0f}GB，未扣格式化损耗。")
        lines += [""]
    lines += ["### 估算依据", "",
              "| 参数 / 结果 | 数值 |", "| --- | --- |",
              f"| 测点范围 | **{calculation['points']['low']:,}–{calculation['points']['high']:,} 点** |",
              f"| 采样 / 历史保留 | **{inputs['sampling_seconds']:g} 秒 / {inputs['retention_years']:g} 年** |",
              f"| 时序库 / 业务库 | {high['time_series_gb']:,.3f} / {high['pg_gb']:,.3f} GB |",
              f"| 缓存 / 备份 | {high['cache_gb']:,.3f} / {high['backup_gb']:,.3f} GB |", "",
              "### 选型依据与待确认", "",
              "- 参考知识库《样本库》《SOP-04 成本报价单与服务器规格》及 DCOM 通用价格表的完整配置字段；案例价格和历史配置不作为本项目结论。",
              "- R750xs / Xeon Silver 4314 是参考组合；采购前确认供货、实际盘位、单/双路内存布局及 SSD/RAID 控制器兼容性。",
              "- CPU核数与内存来自模型建议，SSD及网口为选型建议。容量覆盖不等于性能已验证；需回验 IOPS、写入延迟、SSD耐写等级与 RAID5 恢复时间。",
              "- 主备不替代备份；系统盘独立，热备盘、镜像及额外日志空间需确认。",
              *["- "+q for q in draft.clarifications],
              "- Skill 与规格模型的全合一推荐口径存在冲突，需软件产品裁定；软件功能满足性独立核对。"]
    return "\n".join(lines)
