export type RiskLevel = 'high' | 'mid' | 'low'
export type StepStatus = 'done' | 'current' | 'todo' | 'blocked'
export interface PipelineStep {
  id: string
  label: string
  owner: string
  status: StepStatus
  hint?: string
}
export const pipelineSteps: PipelineStep[] = [
  ['F1', '项目建立与资料归集', '销售 / 商务', 'done'],
  ['F2', '需求应答与澄清', '各专业岗位', 'done'],
  ['F3', '点表处理与技术配置', '解决方案', 'todo'],
  ['F4', '硬件选型与组合配置', '硬件产品', 'todo'],
  ['F5', '软件技术支持 · F3S', '软件产品 / 研发', 'current'],
  ['F6', '出口可行性前置检查', '关务 / 认证', 'todo'],
  ['F7', '成本汇总与供应链询价', '销售 / 供应链', 'todo'],
  ['F8', '客户 BOQ 映射与报价', '销售 / 解决方案', 'todo'],
  ['F9', '商务报价录入与评审', '商务支持', 'todo'],
  ['F10', '标书编制与投标提交', '销售 / 商务 / 各专业', 'todo'],
  ['F11', '客户反馈、谈判与合同衔接', '商务 / 销售', 'todo'],
  ['F12', '合同风险与版本评估', '财务 / 风控 / 法务', 'todo'],
  ['F13', '现金流与税费测算', '财务 / 项目经理', 'todo'],
  ['F14', '项目变更影响与版本控制', 'PM / 各岗位', 'blocked'],
].map(([id, label, owner, status]) => ({
  id,
  label,
  owner,
  status: status as StepStatus,
}))
export function riskLabel(risk: RiskLevel) {
  return { high: '高风险', mid: '需确认', low: '低风险' }[risk]
}
export function statusTone(status: string) {
  return status === '已完成' ? 'default' : 'secondary'
}
export type Artifact = 'customer' | 'clarification' | 'dev' | 'server'
export const artifactMeta: Record<
  Artifact,
  { label: string; audience: string; owner: string }
> = {
  customer: {
    label: '客户版应答表',
    audience: '客户侧 · 须逐条人审',
    owner: '软件产品',
  },
  clarification: {
    label: '澄清表',
    audience: '客户侧 · 问题与答复独立留痕',
    owner: '软件产品',
  },
  dev: {
    label: '研发最低成本路径',
    audience: '内部 · 不构成客户承诺',
    owner: '研发',
  },
  server: {
    label: '服务器规格清单',
    audience: '内部 · 演示规则，待正式模型验证',
    owner: '解决方案',
  },
}
export interface Requirement {
  id: string
  title: string
  category: string
  clause: string
  section: string
  risk: RiskLevel
  sourceText: string
  capability: string
}
export const requirements: Requirement[] = [
  {
    id: 'REQ-01',
    title: '连续运行与容灾',
    category: '原则类',
    clause: '支持 7×24 连续运行，具备容灾能力。',
    section: '§3.1 · p.08',
    risk: 'mid',
    sourceText: '系统应支持 7×24 小时连续运行，并具备容灾能力。',
    capability:
      '演示能力基线 V1 · HA-01：主备部署可作为候选；切换指标待项目确认。',
  },
  {
    id: 'REQ-02',
    title: '账户与传输加密',
    category: '原则类',
    clause: '账户密码和网络传输应加密。',
    section: '§3.4 · p.09',
    risk: 'low',
    sourceText: '账户密码应安全存储，网络传输应加密。',
    capability: '演示能力基线 V1 · SEC-02：密码加盐存储、TLS 传输。',
  },
  {
    id: 'REQ-03',
    title: '多协议设备接入',
    category: '平台接入类',
    clause: '接入 BACnet / Modbus / SNMP 设备。',
    section: '§5.2 · p.16',
    risk: 'mid',
    sourceText: '平台应接入 BACnet、Modbus 和 SNMP 设备，设备明细另附。',
    capability:
      '演示能力基线 V1 · INT-03：现有协议插件；具体型号与点表未提供。',
  },
  {
    id: 'REQ-04',
    title: '告警回溯视频',
    category: '功能类',
    clause: '告警触发时应可回溯视频画面。',
    section: '§6.7 · p.24',
    risk: 'high',
    sourceText: '告警触发时应可回溯视频画面。',
    capability: '暂无充分依据：抓拍、片段索引、全量历史存储是不同范围。',
  },
  {
    id: 'REQ-05',
    title: '自定义报表与导出',
    category: '功能类',
    clause: '支持自定义周期、指标和导出格式。',
    section: '§6.11 · p.27',
    risk: 'mid',
    sourceText: '报表工具应支持自定义周期、指标和导出格式。',
    capability:
      '演示能力基线 V1 · RPT-05：标准周期、指标可配置；特殊格式需确认。',
  },
  {
    id: 'REQ-06',
    title: '北向 API / Kafka',
    category: '平台接入类',
    clause: '提供北向 API 与 Kafka 推送能力。',
    section: '§5.8 · p.19',
    risk: 'mid',
    sourceText: '需提供北向 API 与 Kafka 推送能力，吞吐、保留周期待补充。',
    capability: '演示能力基线 V1 · API-06：接口能力示意；部署约束未确定。',
  },
]
export interface Row {
  id: string
  req: string
  artifact: Artifact
  title: string
  text: string
  evidence: string
  risk: RiskLevel
  owner: string
  blocker?: 'video' | 'kafka' | 'model'
}
export const initialRows: Row[] = [
  ...requirements.map((r) => ({
    id: `A-${r.id.slice(-2)}`,
    req: r.id,
    artifact: 'customer' as const,
    title: r.title,
    text: (
      {
        'REQ-01':
          '候选应答：采用一主一备部署。切换时间、容灾范围与验收条件需逐项确认。',
        'REQ-02':
          '候选应答：账户密码加盐存储，传输链路使用 TLS；适用版本由软件产品复核。',
        'REQ-03':
          '候选应答：可采用协议插件接入；型号兼容性需依据设备清单确认，不承诺全部设备可接入。',
        'REQ-04':
          '待澄清。请明确抓拍、片段调取或全量历史存储；范围明确前暂不承诺满足。',
        'REQ-05':
          '偏离候选：标准周期与指标可配置；特殊导出格式及替代方式需客户确认。',
        'REQ-06':
          '待确认：API / Kafka 为候选方式；峰值消息量、保留周期与网络边界需补充。',
      } as Record<string, string>
    )[r.id],
    evidence: `技术规格书 ${r.section} ↔ ${r.capability}`,
    risk: r.risk,
    owner: '软件产品',
    blocker:
      r.id === 'REQ-04'
        ? ('video' as const)
        : r.id === 'REQ-06'
          ? ('kafka' as const)
          : undefined,
  })),
  {
    id: 'Q-01',
    req: 'REQ-04',
    artifact: 'clarification',
    title: '视频范围需要客户明确',
    text: '请明确：告警抓拍、事后片段调取或全量历史存储？录像由客户现有平台存储还是由本系统存储？协议和保留周期是什么？',
    evidence: '技术规格书 §6.7 · p.24；范围影响服务器、研发路径与成本。',
    risk: 'high',
    owner: '软件产品',
    blocker: 'video',
  },
  {
    id: 'Q-02',
    req: 'REQ-06',
    artifact: 'clarification',
    title: '补齐消息量与部署边界',
    text: '请提供峰值消息量、消息保留周期及网络访问边界，供研发和解决方案确认部署约束。',
    evidence: '技术规格书 §5.8 · p.19；吞吐与保留字段缺失。',
    risk: 'mid',
    owner: '软件产品',
    blocker: 'kafka',
  },
  {
    id: 'R-01',
    req: 'REQ-04',
    artifact: 'dev',
    title: '视频集成候选路径',
    text: '优先评估复用客户录像平台、按告警事件索引片段。全量历史存储单独评估；最低成本、是否零开发均未确认。',
    evidence: 'REQ-04 + Q-01；需客户接口资料、研发评估。',
    risk: 'high',
    owner: '研发',
    blocker: 'video',
  },
  {
    id: 'R-02',
    req: 'REQ-05',
    artifact: 'dev',
    title: '报表实现候选路径',
    text: '先验证现有报表设计器；特殊格式独立实施或开发。无成本数据，不能判定为零成本。',
    evidence: '演示能力基线 V1 · RPT-05；研发评估待补。',
    risk: 'mid',
    owner: '研发',
  },
  {
    id: 'R-03',
    req: 'REQ-01',
    artifact: 'dev',
    title: '容灾实现候选路径',
    text: '复用主备部署模板，验证切换与故障场景；不得由“容灾”一词推断完整灾备承诺。',
    evidence: '演示模板 HA-01 V1；待研发确认适用条件。',
    risk: 'mid',
    owner: '研发',
  },
  {
    id: 'S-01',
    req: 'REQ-04',
    artifact: 'server',
    title: '历史数据容量候选',
    text: '演示输入：10,000 点 × 8 字节 × (86,400 ÷ 5 秒) × 30 天 × 1.3 预留 = 53.91 GB。仅为原始点值容量；索引、复制、操作系统、CPU/内存和视频容量均未计入，待正式模型验证。',
    evidence: '合成部署输入 V1 + 演示公式 DEMO-CAP-01 V1；不是正式服务器模型。',
    risk: 'high',
    owner: '解决方案',
    blocker: 'model',
  },
]
export interface Change {
  id: string
  reqs: string[]
  title: string
  before: string
  after: string
  section: string
  artifacts: Artifact[]
  owner: string
  action: string
}
export const changes: Change[] = [
  {
    id: 'D-01',
    reqs: ['REQ-04'],
    title: '视频需求范围扩大且存在歧义',
    before: '告警触发时应可回溯视频画面。',
    after: '告警触发时应可回溯过去 30 天的视频画面；存储平台待明确。',
    section: '技术规格书 §6.7 · p.24',
    artifacts: ['customer', 'clarification', 'dev', 'server'],
    owner: '软件产品',
    action: '澄清存储边界，重新评审视频应答与研发路径。',
  },
  {
    id: 'D-02',
    reqs: ['REQ-06'],
    title: '新增 Kafka 消息保留约束',
    before: '提供北向 API 与 Kafka 推送能力。',
    after: '提供北向 API 与 Kafka 推送能力；消息保留 7 天，峰值消息量待补。',
    section: '技术规格书 §5.8 · p.19',
    artifacts: ['customer', 'clarification'],
    owner: '研发',
    action: '确认峰值消息量和网络边界，复核应答与部署输入。',
  },
]
export type ProviderId = 'openai' | 'deepseek' | 'compatible'
export interface LLMSettings {
  mode: 'mock' | 'live'
  provider: ProviderId
  model: string
  baseUrl: string
  apiKey: string
  allowBrowserKey: boolean
}
export const PROVIDERS: Record<
  ProviderId,
  { label: string; baseUrl: string; model: string }
> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: '',
  },
  compatible: {
    label: 'OpenAI 兼容接口',
    baseUrl: 'http://localhost:4000/v1',
    model: '',
  },
}
export const defaultSettings: LLMSettings = {
  mode: 'mock',
  provider: 'compatible',
  baseUrl: 'http://localhost:4000/v1',
  model: '',
  apiKey: '',
  allowBrowserKey: false,
}
const SETTINGS_KEY = 'presales-connection-v2'
export function loadSettings(): LLMSettings {
  try {
    localStorage.removeItem('presales-workbench-settings-v1')
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw
      ? {
          ...defaultSettings,
          ...JSON.parse(raw),
          apiKey: '',
          allowBrowserKey: false,
        }
      : defaultSettings
  } catch {
    return { ...defaultSettings }
  }
}
export function saveSettings(settings: LLMSettings) {
  const { mode, provider, baseUrl, model } = settings
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ mode, provider, baseUrl, model }),
    )
  } catch {
    /* Connection remains usable in memory. */
  }
}
export async function testLiveConnection(s: LLMSettings): Promise<string> {
  if (s.mode !== 'live' || !s.allowBrowserKey)
    throw new Error('请启用 live 和浏览器直连许可。')
  if (!s.apiKey.trim() || !s.model.trim())
    throw new Error('请填写 API Key 和模型名称。')
  const url = new URL(s.baseUrl)
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Base URL 不能包含认证信息、查询参数或片段。')
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new Error('非本机接口必须使用 HTTPS。')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(
      `${s.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        signal: controller.signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${s.apiKey}`,
        },
        body: JSON.stringify({
          model: s.model,
          messages: [{ role: 'user', content: 'Reply with ok.' }],
          max_tokens: 8,
          stream: false,
        }),
      },
    )
    if (!res.ok)
      throw new Error(`HTTP ${res.status}：请核对模型、Key 和接口权限。`)
    const data = await res.json()
    if (typeof data?.choices?.[0]?.message?.content !== 'string')
      throw new Error('接口返回格式不兼容 chat/completions。')
    return '连接成功，模型已返回有效应答。测试仅发送 ping，不发送项目资料。'
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      throw new Error('连接超时（20 秒）。')
    if (e instanceof TypeError)
      throw new Error('网络请求失败：检查接口地址、网络与 CORS 设置。')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}
