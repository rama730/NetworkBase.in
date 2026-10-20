interface StepHeaderProps {
  title: string
  subtitle: string
  step: number
  totalSteps: number
}

/** Every step's heading. Focus lands here when the step changes, so a keyboard or screen-reader user starts at the top. */
export function StepHeader({ title, subtitle, step, totalSteps }: StepHeaderProps) {
  return (
    <div className="mb-8 text-left outline-none" data-step-header tabIndex={-1}>
      <p className="onb-step-kicker">Step {step} of {totalSteps}</p>
      <h1 className="text-[30px] font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">{title}</h1>
      <p className="mt-1 text-[13px] font-normal leading-[1.5] text-muted-foreground">{subtitle}</p>
    </div>
  )
}
