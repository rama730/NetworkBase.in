import { cn } from '@/lib/utils'

interface StepHeaderProps {
  title: string
  subtitle: string
  step?: number
  totalSteps?: number
}

export function StepHeader({ title, subtitle, step, totalSteps }: StepHeaderProps) {
  return (
    <div
      className={cn('mb-8 text-left outline-none')}
      data-step-header
      tabIndex={-1}
    >
      {step && totalSteps ? <p className="onb-step-kicker">Step {step} of {totalSteps}</p> : null}
      <h1 className={cn('text-[30px] font-semibold tracking-[-0.015em] leading-[1.28] text-foreground')}>
        {title}
      </h1>
      <p className={cn('mt-1 text-[13px] font-normal leading-[1.5] text-muted-foreground')}>
        {subtitle}
      </p>
    </div>
  )
}
