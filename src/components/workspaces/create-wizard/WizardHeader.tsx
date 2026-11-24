"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { ORG_PHASE_LABELS, WIZARD_PHASES, type WizardPhaseId } from "@/constants/workspace-wizard";
import { PixelTick } from "@/components/ui/PixelTick";
import type { PhaseProblems } from "./phase-problems";

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
  /** What each step still needs; shown on steps you have left, or tried to leave (v6 "Info · 3"). */
  problems?: PhaseProblems;
  attempted?: Partial<Record<WizardPhaseId, boolean>>;
};

// Create wizard v6: the step strip. One cell per step across the page, one clay marker that slides to the current step,
// a pixel tick on finished steps and a count on steps that still need something. Phones: "Info · 2 of 5" and five squares.
export default function WizardHeader({ currentPhase, onClose, onStepSelect, stepsDisabled = false, headingRef, isOrganization = false, problems, attempted }: WizardHeaderProps) {
  const phases = WIZARD_PHASES.map((p) => ({ id: p.id, label: isOrganization ? ORG_PHASE_LABELS[p.id] : p.label }));
  const currentLabel = phases[currentPhase - 1]?.label ?? "";
  const listRef = useRef<HTMLOListElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const place = () => {
      const cell = listRef.current?.querySelector<HTMLElement>(`[data-step="${currentPhase}"]`);
      const marker = markerRef.current;
      if (!cell || !marker) return;
      marker.style.transition = placed.current ? "" : "none";
      marker.style.width = `${cell.offsetWidth}px`;
      marker.style.transform = `translateX(${cell.offsetLeft}px)`;
      placed.current = true;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [currentPhase, isOrganization]);

  return (
    <header className="nb-step-strip shrink-0">
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">{isOrganization ? "Create organization" : "Create workspace"}</h1>
      <nav aria-label={isOrganization ? "Create organization steps" : "Create workspace steps"} className="nb-step-strip-nav">
        <ol ref={listRef} className="nb-step-cells">
          {phases.map((step) => {
            const current = currentPhase === step.id;
            const left = currentPhase > step.id;
            const fix = !current && (left || attempted?.[step.id]) ? problems?.[step.id] ?? 0 : 0;
            const done = left && !fix;
            const count = fix ? <span data-fix-count className="nb-step-count">{fix}<span className="sr-only"> to fix</span></span> : null;
            const box = <span className="nb-step-box" data-state={done ? "done" : current ? "current" : fix ? "fix" : "next"} aria-hidden="true">{done ? <PixelTick draw /> : null}</span>;
            return (
              <li key={step.id} data-step={step.id}>
                {left && onStepSelect ? (
                  <button type="button" className="nb-step-cell" data-done={done || undefined} onClick={() => onStepSelect(step.id)} disabled={stepsDisabled}
                    aria-label={`${step.label}, ${fix ? `${fix} to fix` : "done"}. Go back to it.`}>
                    {box}{step.label}{count}
                  </button>
                ) : (
                  <span className="nb-step-cell" aria-current={current ? "step" : undefined}>{box}{step.label}{count}</span>
                )}
              </li>
            );
          })}
        </ol>
        <span ref={markerRef} data-step-marker className="nb-step-marker" aria-hidden="true" />
      </nav>
      <div className="nb-step-phone" aria-hidden="true">
        <b>{currentLabel} · {currentPhase} of {WIZARD_PHASES.length}</b>
        <span className="nb-step-squares">{phases.map((p) => <i key={p.id} data-on={p.id <= currentPhase || undefined} />)}</span>
      </div>
      {/* A page, not a dialog: Cancel is explicit; Esc asks the same thing (Leave) when the page has focus. */}
      <button type="button" onClick={onClose} aria-label={isOrganization ? "Cancel organization setup" : "Cancel workspace setup"} className="nb-step-cancel">
        <X aria-hidden="true" /><span>Cancel</span>
      </button>
    </header>
  );
}
