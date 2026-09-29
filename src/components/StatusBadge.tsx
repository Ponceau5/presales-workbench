import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { statusTone } from '@/lib/presales'

const toneClass: Record<string, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = statusTone(status as never)
  return (
    <Badge variant="outline" className={cn('font-normal', toneClass[tone], className)}>
      {status}
    </Badge>
  )
}
