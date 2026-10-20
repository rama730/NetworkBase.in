"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface StepFooterProps {
  /** Why the main button cannot be used right now. Undefined means it can. */
  blockedReason?: string
  busy: boolean
  nextLabel: string
  /** Under the buttons: "Saved" and similar. */
  status?: string
  showBack: boolean
  onBack: () => void
  /** A second way forward that asks for nothing more (Step 2). */
  skipLabel?: string
  onSkip?: () => void
  /** The main button was pressed while blocked: the page reveals what is missing. */
  onBlocked: () => void
}

/**
 * Buttons for a step. Lives inside the step's <form>, so Enter in a field presses the main button. The main
 * button is aria-disabled, not disabled: it stays focusable and its reason is read out.
 */
export function StepFooter({ blockedReason, busy, nextLabel, status, showBack, onBack, skipLabel, onSkip, onBlocked }: StepFooterProps) {
  const blocked = Boolean(blockedReason)
  const statusText = blockedReason ?? status

  return (
    <div className="onb-footer">
      <div className="flex flex-wrap items-center justify-between gap-3 max-[359px]:flex-col-reverse max-[359px]:items-stretch">
        {showBack ? (
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy} className="min-h-11 text-muted-foreground">
            Back
          </Button>
        ) : (
          <span />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 max-[359px]:flex-col-reverse max-[359px]:items-stretch">
          {onSkip && skipLabel ? (
            <Button type="button" variant="outline" onClick={onSkip} disabled={busy} className="min-h-11">
              {skipLabel}
            </Button>
          ) : null}
          <Button
            type="submit"
            aria-disabled={blocked || busy}
            aria-describedby={statusText ? 'onboarding-footer-status' : undefined}
            onClick={(event) => {
              if (blocked || busy) {
                event.preventDefault()
                if (blocked) onBlocked()
              }
            }}
            className={blocked || busy ? 'min-h-11 min-w-[120px] opacity-60' : 'min-h-11 min-w-[120px]'}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Saving…' : nextLabel}
          </Button>
        </div>
      </div>
      {/* Always mounted so assistive tech announces changes to it. */}
      <p id="onboarding-footer-status" className="onb-footer-status mt-2 text-right max-sm:text-left" role="status" aria-live="polite">
        {statusText ?? ''}
      </p>
    </div>
  )
}
