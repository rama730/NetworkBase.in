"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils/date";
import { Button } from "@/components/ui/button";
import { PixelTick } from "@/components/ui/PixelTick";

/** The draft banner's column (the body follows the v6 left-edge layout in CreateWorkspaceWizard). */
export const WIZARD_COLUMN = "w-full max-w-[940px]";

interface WizardFooterProps {
  phase: number;
  totalPhases: number;
  onNext: () => void;
  onBack: () => void;
  isSubmitting: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextDisabledReason?: string;
  isPhaseTransitioning?: boolean;
  isReviewReady?: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSaved: Date | null;
  /** "Create organization" when the starting point is Organization (report §34.7). */
  createLabel?: string;
  /** Left Review to change something: the primary action goes straight back to it. */
  fromReview?: boolean;
  onReturnToReview?: () => void;
}

// Create wizard v6 footer: Back · "Saved on this device · 4s ago" with the keys · Continue / Back to Review / Create.
// Drafts save themselves, so there is no save button. Full width with the page's 24px gutters, on every step.
export default function WizardFooter({ phase, totalPhases, onNext, onBack, isSubmitting, nextLabel, nextDisabled, nextDisabledReason, isPhaseTransitioning = false, isReviewReady = false, saveStatus, lastSaved, createLabel = "Create workspace", fromReview = false, onReturnToReview }: WizardFooterProps) {
  const isLastPhase = phase === totalPhases;
  const [mac, setMac] = useState(true);
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)); }, []);
  const busy = isSubmitting || isPhaseTransitioning;
  const primaryWord = isLastPhase ? "Create" : fromReview ? "Review" : "Continue";
  const saved = saveStatus === "saving"
    ? "Saving…"
    : saveStatus === "error"
      ? "Couldn’t save the draft"
      : lastSaved
        ? <>Saved<span className="max-sm:hidden"> on this device</span> · {formatDistanceToNow(lastSaved)} ago</>
        : <>Saves<span className="max-sm:hidden"> on this device</span> as you go</>;

  return (
    <footer className="nb-wizard-footer shrink-0 border-t border-border bg-card">
      <div className="flex flex-col gap-2 px-4 pt-3 sm:grid sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(8rem,1fr)] sm:items-center sm:gap-x-3 sm:px-6 sm:pt-4">
        <div className="order-3 min-w-0 sm:order-1 sm:justify-self-start">
          {phase > 1 ? (
            <Button type="button" variant="ghost" onClick={onBack} disabled={busy} className="w-full sm:w-auto">
              <ChevronLeft aria-hidden="true" /> Back
            </Button>
          ) : null}
        </div>

        <div className="nb-meta order-1 flex min-w-0 flex-wrap items-center justify-center gap-x-2 text-center text-muted-foreground sm:order-2 sm:justify-self-center [@media(max-height:500px)]:sr-only">
          <p id="create-project-next-help" role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
            {nextDisabledReason
              ? <span className="text-[var(--status-danger)]">{nextDisabledReason}</span>
              : <>{saveStatus !== "error" && lastSaved ? <PixelTick className="text-[var(--status-success)]" /> : null}<span className={saveStatus === "error" ? "text-[var(--status-danger)]" : undefined}>{saved}</span></>}
          </p>
          <span className="nb-wizard-keys max-md:hidden" aria-hidden="true">
            <kbd>{mac ? "⌘↵" : "Ctrl ↵"}</kbd> {primaryWord} · <kbd>Esc</kbd> Cancel
          </span>
        </div>

        <div className="order-2 flex items-center justify-end sm:order-3 sm:justify-self-end">
          {isLastPhase ? (
            <Button pending={isSubmitting} type="submit" form="create-project-form" disabled={busy || !isReviewReady} aria-busy={busy} className="w-full min-w-[140px] sm:w-auto">
              {isSubmitting ? "Creating…" : isReviewReady ? createLabel : "Preparing review…"}
            </Button>
          ) : fromReview && onReturnToReview ? (
            <Button type="button" onClick={busy ? undefined : onReturnToReview} aria-disabled={busy} className="w-full min-w-[140px] sm:w-auto">
              Back to Review <ChevronRight aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={nextDisabled || busy ? (e) => { e.preventDefault(); } : onNext}
              aria-disabled={Boolean(nextDisabled) || busy}
              aria-describedby={nextDisabledReason ? "create-project-next-help" : undefined}
              className={`w-full min-w-[140px] sm:w-auto ${nextDisabled || busy ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {nextLabel || "Continue"} <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
