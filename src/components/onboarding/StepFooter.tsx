"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface StepFooterProps {
  step: number
  totalSteps: number
  canProceed: boolean
  isLoading: boolean
  loadingLabel?: string
  nextLabel?: string
  disabledReason?: string
  saveStatus?: string
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
}

export function StepFooter({
  step,
  totalSteps,
  canProceed,
  isLoading,
  loadingLabel = "Saving...",
  nextLabel = "Continue",
  disabledReason,
  saveStatus,
  onBack,
  onNext,
  onSubmit,
}: StepFooterProps) {
  const isFinalStep = step === totalSteps
  const isFirstStep = step === 1

  return (
    <div
      className={cn(
        "mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border pt-6 pb-[max(0px,env(safe-area-inset-bottom))]",
        // Below 360px: stack buttons vertically at full width
        "max-[359px]:flex-col max-[359px]:gap-3"
      )}
    >
      {/* Back button — hidden on first step but keeps space for layout */}
      {isFirstStep ? (
        <div className="max-[359px]:hidden" />
      ) : (
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isLoading}
          className={cn(
            "text-muted-foreground min-h-[44px]",
            "  ",
            "max-[359px]:w-full max-[359px]:order-2"
          )}
          type="button"
        >
          Back
        </Button>
      )}

      <div className="ml-auto flex min-w-0 flex-col items-end gap-1 max-[359px]:order-1 max-[359px]:w-full max-[359px]:items-stretch">
        <button
          type="button"
          disabled={!canProceed || isLoading}
          aria-describedby={disabledReason || saveStatus ? 'onboarding-footer-status' : undefined}
          onClick={isFinalStep ? onSubmit : onNext}
          className={cn(
            "inline-flex items-center justify-center",
            "h-[var(--ui-control-height)] min-h-[44px] min-w-[120px] px-5",
            "onb-action-primary text-[13px] font-medium",
            "outline-none",
            (!canProceed || isLoading) && "opacity-50 pointer-events-none",
            "max-[359px]:w-full"
          )}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {loadingLabel}
            </>
          ) : isFinalStep ? (
            "Finish profile"
          ) : (
            nextLabel
          )}
        </button>
        {(disabledReason || saveStatus) ? (
          <p id="onboarding-footer-status" className="onb-footer-status" role="status" aria-live="polite">
            {isLoading ? loadingLabel : disabledReason || saveStatus}
          </p>
        ) : null}
      </div>
    </div>
  )
}
