import type { ReactNode } from 'react'
import { ArrowUpRight, Check, FileText } from 'lucide-react'
import { Link } from 'react-router'
import { riskLabel, type RiskLevel } from '@/lib/presales'
export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'teal'
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}
export function Risk({ risk }: { risk: RiskLevel }) {
  return (
    <Tag tone={risk === 'high' ? 'red' : risk === 'mid' ? 'amber' : 'green'}>
      {riskLabel(risk)}
    </Tag>
  )
}
export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        {/^F\d+/.test(eyebrow) && (
          <span className="heading-stage-id">{eyebrow.split(' / ')[0]}</span>
        )}
        <h1>{title}</h1>
        {description &&
          !['售前项目', '版本差异与受影响事项'].includes(description) && (
            <p>{description}</p>
          )}
      </div>
      {action}
    </div>
  )
}
export function Section({
  title,
  extra,
  children,
  className = '',
}: {
  title: string
  extra?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  )
}
export function Jump({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowUpRight size={14} />
    </Link>
  )
}
export function Source({ children }: { children: ReactNode }) {
  return (
    <span className="source">
      <FileText size={13} />
      {children}
    </span>
  )
}
export function Status({ value }: { value: string }) {
  const approved = value === 'approved' || value === 'done'
  return (
    <Tag tone={approved ? 'green' : value === 'rejected' ? 'red' : 'amber'}>
      {approved ? <Check size={11} /> : null}
      {{
        waiting: '待人审',
        approved: '已批准',
        rejected: '已驳回',
        pending: '待派发',
        assigned: '已派发',
        reviewing: '处理中',
        done: '已写回',
      }[value] || value}
    </Tag>
  )
}
