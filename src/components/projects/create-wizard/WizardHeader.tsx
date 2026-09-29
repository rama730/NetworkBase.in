"use client";

import { Check, X } from "lucide-react";
import { WIZARD_PHASES } from "@/constants/project-wizard";
import { Button } from "@/components/ui/button";
import { MobileProgressBar } from "@/components/onboarding/MobileProgressBar";

type WizardHeaderProps = {
  currentPhase: number;
  onClose: () => void;
};

export default function WizardHeader({ currentPhase, onClose }: WizardHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-5 py-3 sm:px-6 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:px-4 max-md:py-2 md:grid-cols-[minmax(9rem,1fr)_auto_minmax(9rem,1fr)]">
        <h1 className="nb-section-title whitespace-nowrap text-foreground">Create project</h1>
        <nav aria-label="Project creation progress" className="app-scroll app-scroll-x min-w-0 justify-self-center overflow-x-auto max-md:hidden">
          <ol className="flex min-w-max items-center">
            {WIZARD_PHASES.map((wizardPhase, index) => {
              const completed = currentPhase > wizardPhase.id;
              const current = currentPhase === wizardPhase.id;
              return (
                <li key={wizardPhase.id} className="flex items-center" aria-current={current ? "step" : undefined}>
                  {index > 0 ? <span className="mx-3 h-px w-8 bg-border sm:w-12" aria-hidden="true" /> : null}
                  <span className={`flex items-center gap-2 text-sm ${current ? "font-semibold text-primary" : completed ? "text-foreground" : "text-muted-foreground"}`}>
                    <span className={`flex size-6 items-center justify-center rounded-sm border font-mono text-[11px] ${current ? "border-primary bg-primary text-primary-foreground" : completed ? "border-[var(--status-success)] text-[var(--status-success)]" : "border-border"}`}>
                      {completed ? <Check className="size-3.5" aria-label="Completed" /> : String(wizardPhase.id).padStart(2, "0")}
                    </span>
                    {wizardPhase.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="justify-self-end">
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close create project" className="nb-touch-target">
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
      {/* Phones: compact labeled progress instead of the 5-step stepper (spec §18, R18). */}
      <MobileProgressBar
        currentStep={currentPhase}
        totalSteps={WIZARD_PHASES.length}
        stepLabels={WIZARD_PHASES.map((wizardPhase) => wizardPhase.label)}
        completedThrough={currentPhase - 1}
        label={`${String(currentPhase).padStart(2, "0")}`}
        ariaLabel="Project creation progress"
        className="static z-auto h-12 border-b-0 border-t md:hidden"
      />
    </header>
  );
}
