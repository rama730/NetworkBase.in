import type { ReactNode } from 'react';

/** What's picked, in one line under the heading (v6.8: it replaced the summary column). */
export type StartStatus = { text: string; tone: 'ok' | 'warn' | ''; label: string };

// Create wizard v6, Start: every way in opens the same panel — eyebrow, heading, one line, what's picked, its own body.
export function StartPanel({ panelKey, eyebrow, title, line, status, children }: { panelKey: string; eyebrow: string; title: string; line: string; status?: StartStatus | null; children: ReactNode }) {
    return (
        <div className="nb-start-panel nb-enter-settle" key={panelKey} id="create-start-panel" role="tabpanel" aria-labelledby={`create-start-tab-${panelKey}`}>
            <div className="nb-start-main">
                <p className="nb-phase-eyebrow"><b>{eyebrow}</b></p>
                <h3 className="nb-start-title">{title}</h3>
                <p className="nb-phase-line">{line}</p>
                {status ? (
                    <p className="nb-start-status-line" data-start-status>
                        <span className="min-w-0 truncate">{status.text}</span>
                        <span className={`nbs-tag nb-start-status ${status.tone}`}>{status.label}</span>
                    </p>
                ) : null}
                <div className="nb-start-body">{children}</div>
            </div>
        </div>
    );
}
