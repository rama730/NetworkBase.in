"use client";

import type { RefObject } from "react";
import { Check, X } from "lucide-react";
import { ORG_PHASE_LABELS, WIZARD_PHASES, type WizardPhaseId } from "@/constants/project-wizard";
import { Button } from "@/components/ui/button";

type WizardHeaderProps = {
  currentPhase: number;
  onClose: () => void;
  /** Jump back to a finished step; omitted or blocked while a step change or submit is running. */
  onStepSelect?: (phase: WizardPhaseId) => void;
  stepsDisabled?: boolean;
  /** Creating an organization: its title and step words (report §34.1). */
  isOrganization?: boolean;
  /** Focus target on mount: the page heading. */
  headingRef?: RefObject<HTMLHeadingElement | null>;
};

const STEP_BADGE = "flex size-6 items-center justify-center rounded-sm border font-mono text-[11px]";

// Header band: 64px on desktop with the numbered stepper; one 56px row on phones with the step
// under the title and a thin progress line, so the form keeps the height (spec §18).
export default function WizardHeader({ currentPhase, onClose, onStepSelect, stepsDisabled = false, headingRef, isOrganization = false }: WizardHeaderProps) {
  const phases = WIZARD_PHASES.map((p) => ({ id: p.id, label: isOrganization ? ORG_PHASE_LABELS[p.id] : p.label }));
  const currentLabel = phases[currentPhase - 1]?.label ?? "";

  return (
    <header className="shrink-0 border-b border-border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-5 sm:px-6 max-md:h-14 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:px-4 md:h-16 md:grid-cols-[minmax(9rem,1fr)_auto_minmax(9rem,1fr)]">
        <div className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} className="nb-section-title whitespace-nowrap text-foreground outline-none max-md:text-[16px] max-md:leading-tight">{isOrganization ? "Create organization" : "Create workspace"}</h1>
          <p className="nb-meta mt-0.5 truncate text-muted-foreground md:hidden">
            Step {currentPhase} of {WIZARD_PHASES.length} · <span className="text-foreground">{currentLabel}</span>
          </p>
        </div>
        <nav aria-label="Workspace creation progress" className="app-scroll app-scroll-x min-w-0 justify-self-center overflow-x-auto max-md:hidden">
          <ol className="flex min-w-max items-center">
            {phases.map((wizardPhase, index) => {
              const completed = currentPhase > wizardPhase.id;
              const current = currentPhase === wizardPhase.id;
              // 768–1023px: numbers only, label on the current step, so the stepper never scrolls.
              const label = <span className={current ? undefined : "max-lg:sr-only"}>{wizardPhase.label}</span>;
              return (
                <li key={wizardPhase.id} className="flex items-center" aria-current={current ? "step" : undefined}>
                  {index > 0 ? <span className="mx-2 h-px w-6 bg-border lg:mx-3 lg:w-12" aria-hidden="true" /> : null}
                  {completed && onStepSelect ? (
                    // Finished steps are links back; later steps stay locked until Continue validates them.
                    <button
                      type="button"
                      onClick={() => onStepSelect(wizardPhase.id)}
                      disabled={stepsDisabled}
                      aria-label={`Step ${wizardPhase.id}: ${wizardPhase.label} (completed). Return to step.`}
                      title={`Step ${wizardPhase.id}: ${wizardPhase.label} (completed)`}
                      className="group flex items-center gap-2 rounded-sm text-sm text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
                    >
                      <span className={`${STEP_BADGE} border-[var(--status-success)] text-[var(--status-success)] group-hover:border-primary group-hover:text-primary`}>
                        <Check className="size-3.5" aria-hidden="true" />
                      </span>
                      {label}
                    </button>
                  ) : (
                    <span className={`flex items-center gap-2 text-sm ${current ? "font-semibold text-primary" : completed ? "text-foreground" : "text-muted-foreground"}`}>
                      <span className={`${STEP_BADGE} ${current ? "border-primary bg-primary text-primary-foreground" : completed ? "border-[var(--status-success)] text-[var(--status-success)]" : "border-border"}`}>
                        {completed ? <Check className="size-3.5" aria-label="Completed" /> : String(wizardPhase.id).padStart(2, "0")}
                      </span>
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="justify-self-end">
          {/* A page, not a dialog: an explicit Cancel instead of Esc-to-close. */}
          <Button type="button" variant="ghost" onClick={onClose} aria-label="Cancel workspace setup" className="nb-touch-target max-md:size-[var(--ui-control-height)] max-md:px-0">
            <X aria-hidden="true" />
            <span className="max-md:hidden">Cancel</span>
          </Button>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Workspace creation progress"
        aria-valuemin={1}
        aria-valuemax={WIZARD_PHASES.length}
        aria-valuenow={currentPhase}
        aria-valuetext={`Step ${currentPhase} of ${WIZARD_PHASES.length}: ${currentLabel}`}
        className="h-0.5 bg-muted md:hidden"
      >
        <div className="h-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${(currentPhase / WIZARD_PHASES.length) * 100}%` }} />
      </div>
    </header>
  );
}
