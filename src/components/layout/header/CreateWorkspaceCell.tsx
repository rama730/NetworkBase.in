'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PixelTick } from '@/components/ui/PixelTick';
import { requestCreateStepFocus, useCreateSignal } from '@/lib/workspaces/create-progress-signal';

/**
 * The top bar's New workspace (create wizard v6.8). Elsewhere it's the clay call to action (outlined on a workspace
 * or organization page, which has its own main action). On /workspaces/new it stays pressed: a warm fill, a clay line
 * that grows with the steps, five squares (2/5), a pulse while Create runs, a tick when done. Pressing it again brings
 * the current step back into view and says so; it never starts another workspace or clears the form.
 */
export function CreateWorkspaceCell({ active = false, quiet = false }: { active?: boolean; quiet?: boolean }) {
    const signal = useCreateSignal();
    const [note, setNote] = useState(0);
    useEffect(() => {
        if (!note) return;
        const timer = setTimeout(() => setNote(0), 1800);
        return () => clearTimeout(timer);
    }, [note]);

    if (!active) {
        return (
            <Link href="/workspaces/new" data-quiet={quiet || undefined} className="nb-cell nb-cell-cta nb-ui-label hidden md:flex">
                <Plus className="size-4" aria-hidden="true" />
                New workspace
            </Link>
        );
    }

    const step = signal?.step ?? 1;
    const state = signal?.state ?? 'editing';
    const filled = state === 'editing' ? step : 5;
    const meter = state === 'creating' ? 'making…' : state === 'done' ? 'open' : `${step}/5`;
    const label = state === 'creating' ? 'New workspace, being made' : state === 'done' ? 'New workspace, made' : `New workspace, step ${step} of 5${signal?.label ? `, ${signal.label}` : ''}`;
    const said = state === 'creating' ? 'It’s being made. This page shows how far it got.' : state === 'done' ? 'It’s open. Open it, or create another.' : `You’re making one. Back to ${signal?.label ?? 'it'}.`;
    return (
        // Its own layer above the page: the top bar cells animate in, which would otherwise keep the note under the step strip.
        <span className="relative z-[60] hidden md:flex">
            <Link
                href="/workspaces/new"
                aria-current="page"
                aria-label={label}
                data-pressed="true"
                data-state={state}
                className="nb-cell nb-cell-cta nb-ui-label nb-cell-pressed"
                onClick={(event) => { event.preventDefault(); requestCreateStepFocus(); setNote((n) => n + 1); }}
            >
                {state === 'done' ? <PixelTick className="text-[var(--status-success)]" draw /> : (
                    <span className="nb-create-meter" aria-hidden="true">
                        {[0, 1, 2, 3, 4].map((i) => <i key={i} data-on={i < filled || undefined} style={{ ['--i' as string]: i }} />)}
                    </span>
                )}
                New workspace
                <span className="nb-create-meter-n">{meter}</span>
                <span className="nb-create-bar" aria-hidden="true" style={{ transform: `scaleX(${filled / 5})` }} />
            </Link>
            {note ? <span key={note} role="status" className="nb-create-note">{said}</span> : null}
        </span>
    );
}
