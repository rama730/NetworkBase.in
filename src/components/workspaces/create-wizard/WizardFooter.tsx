"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { ChevronLeft, ChevronRight} from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils/date";
import { Button } from "@/components/ui/button";

/** The content column shared by the wizard body, draft strip and footer (spec §18: 1000px). */
export const WIZARD_COLUMN = "mx-auto w-full max-w-[1000px]";

interface WizardFooterProps {
  phase: number;
  totalPhases: number;
  onNext: () => void;
  onBack: () => void;
  onSaveDraft: () => void;
  isSubmitting: boolean;
  isSavingDraft: boolean;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextDisabledReason?: string;
  isPhaseTransitioning?: boolean;
  isReviewReady?: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSaved: Date | null;
  /** "Create organization" when the starting point is Organization (report §34.7). */
  createLabel?: string;
}

export default function WizardFooter({ phase, totalPhases, onNext, onBack, onSaveDraft, isSubmitting, isSavingDraft, nextLabel, nextDisabled, nextDisabledReason, isPhaseTransitioning = false, isReviewReady = false, saveStatus, lastSaved, createLabel = "Create workspace" }: WizardFooterProps) {
  const isLastPhase = phase === totalPhases;
  const phaseMessage = nextDisabledReason ?? (isLastPhase && !isReviewReady ? "Preparing review…" : `Phase ${phase} of ${totalPhases}`);
  const saveMessage = saveStatus === "saving"
    ? "Saving draft…"
    : saveStatus === "error"
      ? "Couldn’t save draft"
      : lastSaved
        ? `Saved ${formatDistanceToNow(lastSaved)} ago`
        : null;

  return (
    // Full-width band; the row inside aligns with the 1000px content column. Safe-area padding comes from .nb-wizard-footer.
    <footer className="nb-wizard-footer shrink-0 border-t border-border bg-card">
      <div className={`${WIZARD_COLUMN} flex flex-col gap-2 px-4 pt-3 sm:grid sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(8rem,1fr)] sm:items-center sm:gap-x-3 sm:gap-y-2 sm:px-6 sm:pt-4`}>
        {/* Back button: left on desktop, bottom on mobile */}
        <div className="order-3 min-w-0 sm:order-1 sm:justify-self-start">
          {phase > 1 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={isSubmitting || isPhaseTransitioning}
              className="w-full sm:w-auto"
            >
              <ChevronLeft aria-hidden="true" /> Back
            </Button>
          ) : null}
        </div>

        {/* Drafts autosave status: center on desktop, top on mobile */}
        <div className="nb-meta order-1 flex min-w-0 flex-wrap items-center justify-center gap-x-1 text-center text-muted-foreground sm:order-2 sm:col-start-2 sm:row-start-1 sm:justify-self-center [@media(max-height:500px)]:sr-only">
          <p id="create-project-next-help" role="status" aria-live="polite">
            <span>{phaseMessage}</span>
            {saveMessage ? <span className={saveStatus === "error" ? "text-[var(--status-danger)]" : undefined}> · {saveMessage}</span> : null}
          </p>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={isSavingDraft || isSubmitting || isPhaseTransitioning}
            aria-busy={isSavingDraft}
            // Invisible hit padding keeps a 44px tap target without making the status line taller (spec §05).
            className="relative inline-flex items-center gap-1 rounded-sm font-medium after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {isSavingDraft ? <PixelBeat /> : null}
            Save now
          </button>
        </div>

        {/* Continue / Submit button: full-width on mobile, right on desktop */}
        <div className="order-2 flex items-center justify-end sm:order-3 sm:justify-self-end">
          {isLastPhase ? (
            <Button pending={isSubmitting}
              type="submit"
              form="create-project-form"
              disabled={isSubmitting || isPhaseTransitioning || !isReviewReady}
              aria-busy={isSubmitting || isPhaseTransitioning}
              className="w-full min-w-[140px] sm:w-auto"
            >
              {isSubmitting ? "Creating…" : isReviewReady ? createLabel : "Preparing review…"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={nextDisabled || isPhaseTransitioning || isSubmitting ? (e) => { e.preventDefault(); } : onNext}
              aria-disabled={Boolean(nextDisabled) || isPhaseTransitioning || isSubmitting}
              aria-describedby={nextDisabledReason ? "create-project-next-help" : undefined}
              className={`w-full min-w-[140px] sm:w-auto ${nextDisabled || isPhaseTransitioning || isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {nextLabel || "Continue"} <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
