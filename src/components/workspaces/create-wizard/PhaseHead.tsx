import type { ReactNode } from 'react';

// Every step's head (create wizard v6): a square-marked eyebrow, a 30px serif title, and one optional plain line.
// The step strip already says where you are, so the head stays small.
export function PhaseHead({ noun, step, title, line, children }: { noun: 'workspace' | 'organization'; step: string; title: string; line?: ReactNode; children?: ReactNode }) {
    return (
        <header className="nb-phase-head">
            <p className="nb-phase-eyebrow">Create {noun} · <b>{step}</b></p>
            <h2 data-phase-heading className="nb-phase-title">{title}</h2>
            {line ? <p className="nb-phase-line">{line}</p> : null}
            {children}
        </header>
    );
}
