"use client";

import { ChevronLeft, ChevronRight, Loader2, Save } from "lucide-react";
import { formatDistanceToNow } from "@/lib/utils/date";
import { Button } from "@/components/ui/button";

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
}

export default function WizardFooter({ phase, totalPhases, onNext, onBack, onSaveDraft, isSubmitting, isSavingDraft, nextLabel, nextDisabled, nextDisabledReason, isPhaseTransitioning = false, isReviewReady = false, saveStatus, lastSaved }: WizardFooterProps) {
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
    <footer className="nb-wizard-footer grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-border bg-card px-4 py-4 sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(8rem,1fr)] sm:px-6">
      <div className="min-w-0 sm:justify-self-start">
        {phase > 1 ? (
          <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting || isPhaseTransitioning}>
            <ChevronLeft aria-hidden="true" /> Back
          </Button>
        ) : null}
      </div>

      <p id="create-project-next-help" role="status" aria-live="polite" className="nb-meta col-span-2 row-start-2 text-center text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-self-center">
        <span>{phaseMessage}</span>
        {saveMessage ? <span className={saveStatus === "error" ? "text-[var(--status-danger)]" : undefined}> · {saveMessage}</span> : null}
      </p>

      <div className="col-start-2 row-start-1 flex items-center gap-2 sm:col-start-3 sm:justify-self-end">
        <Button type="button" variant="ghost" onClick={onSaveDraft} disabled={isSavingDraft || isSubmitting || isPhaseTransitioning} aria-busy={isSavingDraft}>
          {isSavingDraft ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          <span className="hidden sm:inline">Save draft</span>
        </Button>

        {isLastPhase ? (
          <Button type="submit" form="create-project-form" disabled={isSubmitting || isPhaseTransitioning || !isReviewReady} aria-busy={isSubmitting || isPhaseTransitioning}>
            {isSubmitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? "Creating…" : isReviewReady ? "Create project" : "Preparing review…"}
          </Button>
        ) : (
          <Button type="button" onClick={onNext} disabled={Boolean(nextDisabled) || isPhaseTransitioning || isSubmitting} aria-describedby={nextDisabledReason ? "create-project-next-help" : undefined}>
            {nextLabel || "Continue"} <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </footer>
  );
}
