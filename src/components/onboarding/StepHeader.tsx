import { Eyebrow } from '@/components/auth/AuthShell'

interface StepHeaderProps {
  title: string
  subtitle: string
  step: number
  totalSteps: number
  /** The step's short name, scrambled once into the mono label ("IDENTITY · 01 / 04"). */
  label: string
}

/** Every step's heading. Focus lands here when the step changes, so a keyboard or screen-reader user starts at the top. */
export function StepHeader({ title, subtitle, step, totalSteps, label }: StepHeaderProps) {
  return (
    <div className="nb-onb-head mb-8 text-left outline-none" data-step-header tabIndex={-1}>
      <Eyebrow text={label} step={[step, totalSteps]} />
      <h1 className="text-[30px] font-semibold leading-[1.25] tracking-[-0.015em] text-foreground">{title}</h1>
      <p className="mt-1 text-[14px] font-normal leading-[1.5] text-muted-foreground">{subtitle}</p>
    </div>
  )
}
