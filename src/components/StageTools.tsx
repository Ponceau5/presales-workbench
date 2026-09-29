import { useState } from 'react'
import {
  ArrowRight,
  Check,
  Minus,
  Plus,
  FileText,
  CircleAlert,
} from 'lucide-react'
import { Tag } from '@/components/WorkbenchUI'
import { useWorkbench } from '@/state/workbench'
export function StageTools({ id }: { id: string }) {
  const { state, dispatch } = useWorkbench()
  const [points, setPoints] = useState(120)
  const [capacity, setCapacity] = useState(16)
  const [vendor, setVendor] = useState('DEMO-A')
  const [checks, setChecks] = useState<string[]>([])
  const [mapping, setMapping] = useState('设备 A')
  const [tab, setTab] = useState('付款')
  const [plan, setPlan] = useState(30)
  const [saved, setSaved] = useState(false)
  const data = state.stageStates[id]
  function save(text: string) {
    dispatch({
      type: 'stage',
      id,
      kind: 'edit',
      index: 0,
      text,
      actor: state.role + '评审人',
      note: '按演示输入调整，正式规则与适用条件待复核',
    })
    setSaved(true)
  }
  if (id === 'F3')
    return (
      <section className="special-tool calculation-tool">
        <div>
          <span className="eyebrow">点表演算</span>
          <h2>区域模块配置</h2>
          <p>按区域分别向上取整</p>
          <div className="calculator-inputs">
            <label>
              A 区 AI
              <input
                type="number"
                min={0}
                max={1000000}
                value={points}
                onChange={(e) => {
                  setPoints(Math.max(0, Number(e.target.value)))
                  setSaved(false)
                }}
              />
            </label>
            <span>÷</span>
            <label>
              每模块点数
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => {
                  setCapacity(Math.max(1, Number(e.target.value)))
                  setSaved(false)
                }}
              />
            </label>
          </div>
        </div>
        <div className="calculation-result">
          <span>候选模块数</span>
          <strong>{Math.ceil(points / capacity)}</strong>
          <small>向上取整 · 未计备用率</small>
          <button
            className="btn secondary"
            disabled={!data.generated}
            onClick={() =>
              save(
                `A 区 ${points} AI，演示模块容量 ${capacity}，ceil(${points}/${capacity}) = ${Math.ceil(points / capacity)} 个候选模块；备用率与柜内限制待确认。`,
              )
            }
          >
            {saved ? '已更新待审初稿' : '更新配置初稿'}
          </button>
        </div>
      </section>
    )
  if (id === 'F4')
    return (
      <section className="special-tool comparison-tool">
        <div className="tool-head">
          <h2>候选设备比较</h2>
          <Tag>硬件产品</Tag>
        </div>
        <div className="comparison-table">
          <div>
            <span>技术条件</span>
            <button
              className={vendor === 'DEMO-A' ? 'chosen' : ''}
              onClick={() => setVendor('DEMO-A')}
            >
              DEMO-A {vendor === 'DEMO-A' ? <Check size={14} /> : null}
            </button>
            <button
              className={vendor === 'DEMO-B' ? 'chosen' : ''}
              onClick={() => setVendor('DEMO-B')}
            >
              DEMO-B {vendor === 'DEMO-B' ? <Check size={14} /> : null}
            </button>
          </div>
          {[
            ['输入点数', '16 AI', '16 AI'],
            ['供电', '24VDC', '24VDC'],
            ['环境 / 精度', '待核对', '待核对'],
            ['必配附件', '待补资料', '待补资料'],
            ['成本依据', '未提供', '未提供'],
          ].map((row) => (
            <div key={row[0]}>
              {row.map((cell, i) => (
                <span key={i}>{cell}</span>
              ))}
            </div>
          ))}
        </div>
        <button
          className="btn secondary"
          disabled={!data.generated}
          onClick={() =>
            save(
              `已选择 ${vendor} 作为候选；演示条件 16 AI / 24VDC；环境、精度、附件与成本仍需专业确认。`,
            )
          }
        >
          {saved ? '已进入评审' : '加入选型评审'}
        </button>
      </section>
    )
  if (id === 'F6')
    return (
      <section className="special-tool checklist-tool">
        <div className="tool-head">
          <h2>出口资料检查</h2>
          <Tag tone="amber">{checks.length}/5 已核对</Tag>
        </div>
        {[
          '目的国与进口主体',
          '税号及清关资质证明',
          '产品申报要素',
          '认证适用资料',
          '第三方品牌授权',
        ].map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              checked={checks.includes(item)}
              onChange={() =>
                setChecks((prev) =>
                  prev.includes(item)
                    ? prev.filter((i) => i !== item)
                    : [...prev, item],
                )
              }
            />
            <span>{item}</span>
            <Tag tone={checks.includes(item) ? 'green' : 'amber'}>
              {checks.includes(item) ? '已核对资料' : '待补'}
            </Tag>
          </label>
        ))}
        <div className="tool-footnote">
          <CircleAlert size={14} />
          资料核对不代表已批准出口。
        </div>
      </section>
    )
  if (id === 'F7')
    return (
      <section className="special-tool inquiry-board">
        <div className="tool-head">
          <h2>询价跟进</h2>
          <Tag>销售 · 供应链</Tag>
        </div>
        <div className="inquiry-columns">
          {[
            ['材料准备', '设备 A ×10', '设备 B ×5'],
            ['等待反馈', '软件服务范围', '物流询价输入'],
            ['待成本复核', '币种与有效期', '关税依据'],
          ].map((column) => (
            <div key={column[0]}>
              <h3>{column[0]}</h3>
              {column.slice(1).map((t) => (
                <button
                  key={t}
                  className={checks.includes(t) ? 'checked' : ''}
                  onClick={() =>
                    setChecks((prev) =>
                      prev.includes(t)
                        ? prev.filter((i) => i !== t)
                        : [...prev, t],
                    )
                  }
                >
                  <FileText size={15} />
                  {t}
                  <span>{checks.includes(t) ? '已跟进' : '跟进'}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>
    )
  if (id === 'F8')
    return (
      <section className="special-tool mapping-tool">
        <div className="tool-head">
          <h2>BOQ 对应关系</h2>
          <Tag>销售 / 解决方案</Tag>
        </div>
        <div className="mapping-pair">
          <div>
            <small>客户 BOQ</small>
            <strong>C-01 · 设备项</strong>
            <span>数量 10</span>
          </div>
          <ArrowRight size={22} />
          <div>
            <small>内部清单</small>
            <select
              aria-label="选择内部映射项"
              value={mapping}
              onChange={(e) => {
                setMapping(e.target.value)
                setSaved(false)
              }}
            >
              <option>设备 A</option>
              <option>设备 B</option>
              <option>暂不匹配</option>
            </select>
            <span>
              {mapping === '设备 A'
                ? '数量 10 · 一致'
                : mapping === '设备 B'
                  ? '数量 5 · 数量差异'
                  : '待确认'}
            </span>
          </div>
        </div>
        <button
          className="btn secondary"
          disabled={!data.generated || mapping === '暂不匹配'}
          onClick={() =>
            save(
              `C-01 候选映射至 ${mapping}；数量${mapping === '设备 A' ? '一致' : '存在差异'}，拆分规则及价格待确认。`,
            )
          }
        >
          {saved ? '已进入评审' : '确认候选映射'}
        </button>
      </section>
    )
  if (id === 'F9')
    return (
      <section className="special-tool approval-tool">
        <div className="tool-head">
          <h2>商务评审路径</h2>
          <Tag>商务支持</Tag>
        </div>
        <div className="approval-path">
          {['资料准备', '技术复核', '商务评审', '批准记录'].map((s, i) => (
            <button
              key={s}
              className={checks.includes(s) ? 'checked' : ''}
              onClick={() =>
                setChecks((p) =>
                  p.includes(s) ? p.filter((v) => v !== s) : [...p, s],
                )
              }
            >
              <span>{checks.includes(s) ? <Check size={15} /> : i + 1}</span>
              <strong>{s}</strong>
              <small>{checks.includes(s) ? '材料已核对' : '待核对材料'}</small>
            </button>
          ))}
        </div>
        <div className="tool-footnote">正式批准仍通过业务审批流程完成。</div>
      </section>
    )
  if (id === 'F11' || id === 'F12')
    return (
      <section className="special-tool contract-tool">
        <div className="contract-sections">
          {['付款', '交付', '责任', '验收'].map((t) => (
            <button
              key={t}
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="contract-paper">
          <div className="paper-label">
            {id === 'F12' ? '条款审阅' : '合同准备'}
          </div>
          <h2>{tab}条件</h2>
          <p>
            {tab === '付款'
              ? '付款触发条件、账期与回款证明待确认。'
              : tab === '交付'
                ? '交付地点、时间与贸易条件待确认。'
                : tab === '责任'
                  ? '责任上限、延误罚款及例外条款待专业评估。'
                  : '验收标准、责任人及现场验证方式待确认。'}
          </p>
          <div className="paper-margin-note">
            <CircleAlert size={14} />
            基线与正式条款未提供
          </div>
          <small>
            合同框架 · §{['付款', '交付', '责任', '验收'].indexOf(tab) + 1}
          </small>
        </div>
      </section>
    )
  if (id === 'F13')
    return (
      <section className="special-tool cashflow-tool">
        <div className="tool-head">
          <h2>付款节点与计划</h2>
          <Tag>财务 / 项目经理</Tag>
        </div>
        <div className="cashflow-axis">
          {[0, 1, 2, 3, 4, 5].map((m) => (
            <div key={m}>
              <span>M{m + 1}</span>
              <i className={m === Math.floor(plan / 30) ? 'active' : ''} />
              <small>
                {m === Math.floor(plan / 30) ? '预计回款' : '待补金额'}
              </small>
            </div>
          ))}
        </div>
        <div className="plan-adjust">
          <span>首笔付款计划：{plan} 天</span>
          <button
            aria-label="付款提前 30 天"
            onClick={() => setPlan(Math.max(0, plan - 30))}
          >
            <Minus size={15} />
          </button>
          <button
            aria-label="付款推迟 30 天"
            onClick={() => setPlan(Math.min(150, plan + 30))}
          >
            <Plus size={15} />
          </button>
          <button
            className="btn secondary"
            disabled={!data.generated}
            onClick={() =>
              save(
                `首笔付款计划调整为 ${plan} 天；金额、支出与税率未提供，峰值垫资与累计现金流保持待测算。`,
              )
            }
          >
            更新计划初稿
          </button>
        </div>
      </section>
    )
  if (id === 'F10')
    return (
      <section className="special-tool document-inbox">
        <div className="tool-head">
          <h2>投标文件包</h2>
          <Tag>{checks.length}/4 已核对</Tag>
        </div>
        {[
          '技术应答与附件',
          '已批准报价文件',
          '资质与签章材料',
          '提交渠道与截止时间',
        ].map((item) => (
          <div key={item}>
            <FileText size={20} />
            <span>
              <strong>{item}</strong>
              <small>
                {checks.includes(item)
                  ? '已核对，保留待审记录'
                  : '待补充有效版本与责任人'}
              </small>
            </span>
            <button
              className="btn mini"
              onClick={() =>
                setChecks((prev) =>
                  prev.includes(item)
                    ? prev.filter((v) => v !== item)
                    : [...prev, item],
                )
              }
            >
              {checks.includes(item) ? '取消核对' : '核对'}
            </button>
          </div>
        ))}
        <div className="tool-footer">
          <span>提交须由授权人完成。</span>
          <button
            className="btn secondary"
            disabled={!data.generated || !checks.length}
            onClick={() =>
              save(
                '投标文件包已核对：' +
                  checks.join('、') +
                  '。有效版本、签章与提交授权仍需责任人复核；尚未对外提交。',
              )
            }
          >
            更新文件目录初稿
          </button>
        </div>
      </section>
    )
  if (id === 'F1' || id === 'F2')
    return (
      <section className="special-tool document-inbox">
        <div className="tool-head">
          <h2>{id === 'F1' ? '项目资料收件箱' : '需求分流'}</h2>
          <Tag>{id === 'F1' ? '销售 / 商务' : '解决方案 / 产品'}</Tag>
        </div>
        {['技术规格书', '点表与设备明细', '客户 BOQ'].map((d, i) => (
          <div key={d}>
            <FileText size={20} />
            <span>
              <strong>{d}</strong>
              <small>
                {id === 'F1'
                  ? '待登记提供人与有效版本'
                  : i === 0
                    ? '软件产品 / 硬件产品'
                    : i === 1
                      ? '解决方案'
                      : '销售'}
              </small>
            </span>
            <button
              className="btn mini"
              onClick={() =>
                setChecks((prev) =>
                  prev.includes(d) ? prev.filter((s) => s !== d) : [...prev, d],
                )
              }
            >
              {checks.includes(d) ? '已核对' : '核对资料'}
            </button>
          </div>
        ))}
      </section>
    )
  return null
}
