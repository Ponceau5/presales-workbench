export const roles = [
  '销售',
  '解决方案',
  '硬件产品',
  '软件产品',
  '商务支持',
  '财务 / 风控',
  '货运关务',
  '研发',
  '认证 / 法务',
  'PM / PO',
] as const
export type Role = (typeof roles)[number]
export const roleWork: Record<
  Role,
  { title: string; description: string; stages: string[]; tasks: string[] }
> = {
  销售: {
    title: '客户与项目跟进',
    description: '客户条件、询价进展和报价准备',
    stages: ['F1', 'F7', 'F8', 'F10', 'F11'],
    tasks: [
      '补齐客户主体与项目地区',
      '确认 BOQ 映射与拆分规则',
      '核对询价反馈与商务条件',
    ],
  },
  解决方案: {
    title: '配置与方案',
    description: '点表演算、逐区配置与规格复核',
    stages: ['F3', 'F4', 'F5'],
    tasks: [
      '复核点表统计与模块容量',
      '确认服务器规格输入',
      '同步配置变化到成本清单',
    ],
  },
  硬件产品: {
    title: '选型与匹配',
    description: '技术条件、候选产品与组合配件',
    stages: ['F4', 'F6'],
    tasks: [
      '比较候选型号的技术条件',
      '补充附件与认证依据',
      '确认型号变化的配置影响',
    ],
  },
  软件产品: {
    title: '软件应答与评审',
    description: '客户口径、澄清和专业复核',
    stages: ['F5', 'F2'],
    tasks: ['澄清告警视频的范围', '逐条复核客户版应答', '与研发确认实现路径'],
  },
  商务支持: {
    title: '商务准备与审批',
    description: '报价明细、评审材料与合同衔接',
    stages: ['F9', 'F10', 'F11', 'F1'],
    tasks: ['核对物料号与批准报价版本', '整理商务评审材料', '同步合同准备缺项'],
  },
  '财务 / 风控': {
    title: '风险与测算',
    description: '合同条款、风险处置与现金流输入',
    stages: ['F12', 'F13'],
    tasks: [
      '复核新增延误责任条款',
      '确认付款节点与支出计划',
      '维护税率和风险基线来源',
    ],
  },
  货运关务: {
    title: '出口资料与询价',
    description: '清关主体、申报要素与物流成本输入',
    stages: ['F6', 'F7'],
    tasks: [
      '检查清关主体与税号证明',
      '核对产品申报与授权缺项',
      '准备物流询价材料',
    ],
  },
  研发: {
    title: '实现路径与约束',
    description: '能力边界、替代路径与部署条件',
    stages: ['F5', 'F4'],
    tasks: [
      '评估视频索引与存储路径',
      '确认特殊报表实现方式',
      '补齐 Kafka 部署边界',
    ],
  },
  '认证 / 法务': {
    title: '专业风险复核',
    description: '认证适用性与合同责任边界',
    stages: ['F6', 'F12'],
    tasks: ['核对认证适用资料', '确认合同责任上限', '记录专业复核依据'],
  },
  'PM / PO': {
    title: '协同与变更',
    description: '资料完整性、待确认项和跨岗位行动',
    stages: ['F1', 'F2', 'F14'],
    tasks: [
      '分配尚未归属的确认事项',
      '跟进受影响工件的复核',
      '审核共享知识的复用边界',
    ],
  },
}
export interface Knowledge {
  id: string
  title: string
  summary: string
  category: '方法与规则' | '能力资料' | '模板' | '项目经验'
  owner: string
  version: string
  updated: string
  status: 'approved' | 'pending'
  scope: '内部共享'
  content: string
  related: string[]
  approvedBy?: string
  approvedAt?: string
  reviewNote?: string
  featured?: boolean
}
export const knowledge: Knowledge[] = [
  {
    id: 'K-01',
    title: '软件应答与澄清手册',
    summary: '从要求拆解到客户口径，统一应答和澄清的边界。',
    category: '方法与规则',
    owner: '软件产品',
    version: 'V1',
    updated: '09.28',
    status: 'approved',
    scope: '内部共享',
    related: ['F5', 'F2'],
    featured: true,
    content:
      '要求按原则、平台接入、功能三类拆解。\n\n客户版应答与研发最低成本路径分别维护。客户侧口径须由软件产品复核；内部实现方式由研发评估。\n\n视频回溯需明确：抓拍、片段调取或全量存储，以及录像平台、协议、保留周期。缺失条件进入澄清表，不能推断为已满足。\n\n每条结果保留要求编号、原文位置、资料版本、责任岗位和评审意见。',
  },
  {
    id: 'K-02',
    title: '项目资料与版本规范',
    summary: '让不同岗位复用同一份有效资料。',
    category: '方法与规则',
    owner: 'PM / PO',
    version: 'V1',
    updated: '09.28',
    status: 'approved',
    scope: '内部共享',
    related: ['F1', 'F14'],
    content:
      '项目资料登记文件名、提供人、版本、接收时间和适用范围。\n\n新版本保留旧版来源。差异关联受影响工件，撤销相应批准，未变化的内容保留。\n\n项目原始资料在项目范围内共享；公共知识需明确复用权限与维护责任。',
  },
  {
    id: 'K-03',
    title: '点表配置演算',
    summary: '分区统计与向上取整的计算示例。',
    category: '能力资料',
    owner: '解决方案',
    version: 'V1',
    updated: '09.27',
    status: 'approved',
    scope: '内部共享',
    related: ['F3'],
    content:
      '演示规则：每个模块支持 16 AI 或 16 DI。各区域分别向上取整，再汇总模块数，不能先合并区域再统一取整。\n\n正式配置需确认备用率、柜型、供电、兼容性与维护人。此规则只用于原型演算。',
  },
  {
    id: 'K-04',
    title: '客户 BOQ 映射表',
    summary: '对应关系、拆分规则、数量与金额校验字段。',
    category: '模板',
    owner: '销售',
    version: 'V1',
    updated: '09.26',
    status: 'approved',
    scope: '内部共享',
    related: ['F8', 'F9'],
    content:
      '建议字段：客户行号、客户名称、内部物料、数量、映射依据、拆分规则、差异状态、确认人、版本。\n\n名称相近只能作为候选匹配。金额缺失时标记待补，不以零值代替。',
  },
  {
    id: 'K-05',
    title: '出口资料检查表',
    summary: '主体证明、申报要素、认证与授权资料。',
    category: '模板',
    owner: '货运关务',
    version: 'V1',
    updated: '09.25',
    status: 'approved',
    scope: '内部共享',
    related: ['F6'],
    content:
      '准备目的国、客户清关主体、税号和资质证明、产品用途、申报要素及第三方品牌授权。\n\n认证适用性、HS 归类与出口限制交专业岗位确认。此表是资料完整性模板，不包含法规判断。',
  },
  {
    id: 'K-06',
    title: '合同风险复核记录',
    summary: '将原文、基线、专业判断与处置分开留痕。',
    category: '模板',
    owner: '财务 / 风控',
    version: 'V1',
    updated: '09.24',
    status: 'approved',
    scope: '内部共享',
    related: ['F12'],
    content:
      '记录条款原文、页码、合同版本、风险基线版本、专业判断人、处置建议、批准状态及后续动作。\n\n风险识别与风险接受是两件事；资料缺失时生成待确认项。',
  },
  {
    id: 'K-07',
    title: '视频范围澄清案例',
    summary: '同一句“回溯视频”，可能对应不同的存储责任。',
    category: '项目经验',
    owner: '软件产品',
    version: 'V1',
    updated: '09.23',
    status: 'approved',
    scope: '内部共享',
    related: ['F5'],
    content:
      '案例仅用于演示。要求“告警可回溯视频”并未说明存储责任。应分别确认现有录像平台、索引方式、接口协议、保留期和验收条件。\n\n成本差异需专业评估，不能从候选路径推断零开发或最低成本。',
  },
  {
    id: 'K-08',
    title: '服务器模型接入清单',
    summary: '输入字段、适用条件和验证记录的准备清单。',
    category: '能力资料',
    owner: '解决方案',
    version: 'V1',
    updated: '09.22',
    status: 'pending',
    scope: '内部共享',
    related: ['F5'],
    content:
      '正式模型尚未提供。接入前需确认模型文件、版本、输入字段、性能假设、维护人、验证样本和适用范围。\n\n原型只展示容量演算，不能形成有效服务器规格。',
  },
]
export const taskLinks: Record<Role, string[]> = {
  销售: ['/stages/F1', '/stages/F8', '/stages/F7'],
  解决方案: ['/stages/F3', '/software?artifact=server', '/changes'],
  硬件产品: ['/stages/F4', '/stages/F6', '/changes'],
  软件产品: [
    '/software?artifact=clarification',
    '/software?artifact=customer',
    '/software?artifact=dev',
  ],
  商务支持: ['/stages/F9', '/stages/F9', '/stages/F11'],
  '财务 / 风控': ['/stages/F12', '/stages/F13', '/stages/F13'],
  货运关务: ['/stages/F6', '/stages/F6', '/stages/F7'],
  研发: [
    '/software?artifact=dev',
    '/software?artifact=dev',
    '/software?artifact=clarification',
  ],
  '认证 / 法务': ['/stages/F6', '/stages/F12', '/stages/F12'],
  'PM / PO': ['/stages/F2', '/changes', '/methods?knowledge=pending'],
}
