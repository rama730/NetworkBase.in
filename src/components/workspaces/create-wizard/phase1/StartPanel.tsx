import type { ReactNode } from 'react';

export type StartSummary = {
    sourceLabel: string;
    source: string;
    sourceLine: string;
    status: { tone: 'ok' | 'warn' | ''; label: string };
    second: { label: string; value: string; line?: string };
    next: string[];
};

// Create wizard v6, Start: every way in opens the same panel — eyebrow, heading, one line and its own body on the left;
// on the right the same summary every time (source + status, where it lives, the steps after this one).
export function StartPanel({ panelKey, eyebrow, title, line, summary, children }: { panelKey: string; eyebrow: string; title: string; line: string; summary: StartSummary; children: ReactNode }) {
    return (
        <div className="nb-start-panel nb-enter-settle" key={panelKey} id="create-start-panel" role="tabpanel" aria-labelledby={`create-start-tab-${panelKey}`}>
            <div className="nb-start-main">
                <p className="nb-phase-eyebrow"><b>{eyebrow}</b></p>
                <h3 className="nb-start-title">{title}</h3>
                <p className="nb-phase-line">{line}</p>
                <div className="nb-start-body">{children}</div>
            </div>
            <aside className="nb-start-summary" aria-label="What happens next" data-start-summary>
                <div>
                    <p className="nb-start-k">{summary.sourceLabel}</p>
                    <b>{summary.source}</b>
                    <span>{summary.sourceLine}</span>
                    <span className={`nbs-tag nb-start-status ${summary.status.tone}`}>{summary.status.label}</span>
                </div>
                <div>
                    <p className="nb-start-k">{summary.second.label}</p>
                    <b>{summary.second.value}</b>
                    {summary.second.line ? <span>{summary.second.line}</span> : null}
                </div>
                <div>
                    <p className="nb-start-k">Next</p>
                    <ol className="nb-start-next">{summary.next.map((step) => <li key={step}><i aria-hidden="true" />{step}</li>)}</ol>
                </div>
            </aside>
        </div>
    );
}
