'use client'

import { BrandMark } from '@/components/brand/BrandMark'
import { PixelIcon } from '@/components/auth/pixel'
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'
import { cn } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The steps as marketing-nav cells beside the logo, pinned to the top. The current step has the orange underline; a finished
 * one shows a pixel tick and goes back to it. Phones get "02 / 04 · About you", four squares and a Preview button.
 * `currentStep={0}` is the finish: every step done, nothing to go back to.
 */
export function OnboardingSteps({
    currentStep,
    completedThrough,
    onSelectStep,
    onPreview,
}: {
    currentStep: number
    completedThrough: number
    onSelectStep?: (step: number) => void
    onPreview?: () => void
}) {
    const total = STEP_UI_CONFIG.length
    const finished = currentStep === 0
    return (
        <nav className="nb-onb-steps" aria-label={finished ? 'Setup, all four steps done' : 'Setup steps'}>
            {/* Not a link out: leaving mid-setup just bounces back here. Phones show the dot alone. */}
            <div className="nb-auth-logo">
                <BrandMark size={17} className="nb-onb-logo-full" />
                <BrandMark variant="dot" size={12} className="nb-onb-logo-dot" label="NetworkBase" />
            </div>
            <ol className="nb-onb-step-list">
                {STEP_UI_CONFIG.map((config) => {
                    const isNow = config.id === currentStep
                    const isDone = config.id <= completedThrough && !isNow
                    const body = (
                        <>
                            {isDone ? <PixelIcon name="check" /> : <span className="nb-onb-step-box" aria-hidden="true" />}
                            <span className="nb-onb-step-n">{pad(config.id)}</span>
                            <span className="nb-onb-step-t">{config.stepLabel}</span>
                            {config.id === 2 ? <span className="sr-only"> (optional)</span> : null}
                            {isDone ? <span className="sr-only">{onSelectStep && !finished ? ' (done, go back to it)' : ' (done)'}</span> : null}
                        </>
                    )
                    return (
                        <li key={config.id}>
                            {isDone && onSelectStep && !finished ? (
                                <button type="button" className="nb-onb-step" data-done="true" onClick={() => onSelectStep(config.id)}>{body}</button>
                            ) : (
                                <span className={cn('nb-onb-step')} data-done={isDone ? 'true' : undefined} aria-current={isNow ? 'step' : undefined}>{body}</span>
                            )}
                        </li>
                    )
                })}
            </ol>
            <div className="nb-onb-phone-steps">
                {finished ? (
                    <><span className="nb-onb-step-n">Done</span><span className="nb-onb-step-t">Profile set up</span></>
                ) : (
                    <><span className="nb-onb-step-n">{pad(currentStep)} / {pad(total)}</span><span className="nb-onb-step-t">{STEP_UI_CONFIG[currentStep - 1]?.stepLabel}</span></>
                )}
                <span className="nb-onb-cells" aria-hidden="true">
                    {STEP_UI_CONFIG.map((config) => (
                        <i key={config.id} data-state={finished || (config.id <= completedThrough && config.id !== currentStep) ? 'done' : config.id === currentStep ? 'now' : undefined} />
                    ))}
                </span>
            </div>
            {onPreview ? <button type="button" className="nb-onb-preview" aria-haspopup="dialog" onClick={onPreview}>Preview</button> : null}
        </nav>
    )
}
