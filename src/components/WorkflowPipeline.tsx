import { ArrowRight, CheckCircle2, Circle, CircleAlert, LoaderCircle } from 'lucide-react'
import { pipelineSteps, type PipelineStep } from '@/lib/presales'
import { cn } from '@/lib/utils'

function StepIcon({ step }: { step: PipelineStep }) {
  if (step.status === 'done') return <CheckCircle2 className="size-5 text-emerald-600" />
  if (step.status === 'current') return <LoaderCircle className="size-5 animate-spin text-blue-600" />
  if (step.status === 'blocked') return <CircleAlert className="size-5 text-red-600" />
  return <Circle className="size-5 text-slate-300" />
}

export function WorkflowPipeline() {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {pipelineSteps.map((step, index) => (
        <div key={step.id} className="flex min-w-[150px] items-center gap-2">
          <div
            className={cn(
              'flex flex-1 items-center gap-2 rounded-lg border px-3 py-2',
              step.status === 'current' && 'border-blue-300 bg-blue-50',
              step.status === 'blocked' && 'border-red-200 bg-red-50',
            )}
          >
            <StepIcon step={step} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span>{step.id}</span>
                {step.hint ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{step.hint}</span> : null}
              </div>
              <div className="truncate text-sm">{step.label}</div>
              <div className="truncate text-xs text-muted-foreground">{step.owner}</div>
            </div>
          </div>
          {index < pipelineSteps.length - 1 ? <ArrowRight className="size-4 shrink-0 text-slate-300" /> : null}
        </div>
      ))}
    </div>
  )
}
