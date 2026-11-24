'use client';

import { Button } from '@/components/ui/button';
import { PixelTick } from '@/components/ui/PixelTick';
import { useRoll } from '@/hooks/useRoll';
import type { CreateProgress } from './useCreateWorkspaceWizard';

const pad = (n: number) => String(n).padStart(2, '0');

function Count({ count, total }: { count: number; total: number }) {
    const shown = useRoll(count);
    return (
        <span className="nb-creating-count">
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{shown} of {total} files</span>
            <span className="nb-creating-bar" aria-hidden="true"><span style={{ transform: `scaleX(${total ? Math.min(1, count / total) : 0})` }} /></span>
        </span>
    );
}

/** Create, as a screen of its own (v6.4): one row per real step, real counts, and what you can do while it runs. */
export function CreatingView({ progress, sourceType, onRetry, onOpenNow, onOpenAnyway }: {
    progress: CreateProgress;
    sourceType: 'scratch' | 'github' | 'upload';
    onRetry: (index: number) => void;
    onOpenNow: () => void;
    onOpenAnyway: () => void;
}) {
    const { steps, index, failedAt, title } = progress;
    const failed = failedAt !== undefined;
    const last = steps.length - 1;
    const onlyImportLeft = !failed && index === last && Boolean(steps[last]?.background) && Boolean(progress.projectId);
    const done = failed ? failedAt : index;
    const initials = (title.match(/\b[\p{L}\p{N}]/gu) ?? ['N']).slice(0, 2).join('').toUpperCase();
    const lead = failed ? 'What’s already made stays made.'
        : sourceType === 'github' ? 'You can leave this page. The import keeps going, and Files shows how far it got.'
        : sourceType === 'upload' ? 'Keep this tab open until the upload finishes.'
        : 'This takes a few seconds.';

    return (
        <section data-creating aria-labelledby="creating-title" className="nb-creating">
            <div className="nb-creating-mark" aria-hidden="true" style={{ ['--fill' as string]: `${Math.round((done / steps.length) * 100)}%` }}>
                <span>{initials}</span>
            </div>
            <p className="nbs-eyebrow" aria-live="polite">{failed ? 'Stopped' : 'Creating'} · <b>{Math.min(steps.length, done + 1)} of {steps.length}</b></p>
            <h2 id="creating-title" className="nb-creating-title">{failed ? `${title} is made. One step didn’t finish.` : `Making ${title}…`}</h2>
            <p className="nb-creating-lead">{lead}</p>

            <ol className="nb-creating-steps nbs-frame">
                {steps.map((step, i) => {
                    const state = failed && i === failedAt ? 'failed' : i < done ? 'done' : i === done && !failed ? 'current' : 'pending';
                    const showCount = i === index && progress.total !== undefined && (state === 'current' || state === 'failed');
                    return (
                        <li key={step.key} data-step={step.key} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                            <span className="nb-creating-box" aria-hidden="true">
                                {state === 'done' ? <PixelTick draw /> : state === 'failed' ? '!' : null}
                            </span>
                            <span className="min-w-0">
                                <span className="block">{step.label}</span>
                                {showCount ? <Count count={progress.count ?? 0} total={progress.total ?? 0} /> : null}
                                {state === 'failed' && progress.error ? <span className="mt-1 block text-[12.5px] text-[var(--status-danger)]">{progress.error}</span> : null}
                            </span>
                            {state === 'failed' ? <span className="nbs-tag bad">Stopped</span>
                                : step.background ? <span className="nbs-tag">keeps going if you leave</span>
                                : step.keepTabOpen ? <span className="nbs-tag warn">keep this tab open</span>
                                : <span className="sr-only">{state === 'done' ? 'Done' : state === 'current' ? 'Working' : 'Waiting'}</span>}
                        </li>
                    );
                })}
            </ol>

            {onlyImportLeft ? (
                <div className="nb-creating-actions nb-enter-settle">
                    <Button type="button" onClick={onOpenNow}>Open {title} now</Button>
                    <p className="text-[13px] text-muted-foreground">Everything else is done. The import keeps going, and Files shows how far it got.</p>
                </div>
            ) : null}
            {failed ? (
                <div className="nb-creating-actions nb-enter-settle">
                    {steps[failedAt]?.key !== 'import' ? <Button type="button" onClick={() => onRetry(failedAt)}>Try again</Button> : null}
                    <Button type="button" variant="outline" onClick={onOpenAnyway}>Open {title} anyway</Button>
                    <p className="basis-full text-[13px] text-muted-foreground">
                        {steps[failedAt]?.key === 'import' ? 'Files shows the import as paused, with what came in so far.' : `It becomes the first thing on ${title}’s Get started list, so you can finish it later.`}
                    </p>
                </div>
            ) : null}
            <span className="sr-only" aria-live="polite">{failed ? `${steps[failedAt]?.label} stopped.` : `${pad(done)} of ${pad(steps.length)} done.`}</span>
        </section>
    );
}
