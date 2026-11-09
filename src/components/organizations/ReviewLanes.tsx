'use client'

// Assignment flow decision 5 (2026-11-10): To review as three lanes. Dragging a copy is the decision: To review →
// Approved approves (10 seconds to Undo, from deferDecision); → Returned asks what to change and Fix by. Every card has
// the same buttons for keyboards and phones. A copy nobody has handed in never shows here.

import { useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'

import type { ReviewLaneRow, ReviewQueueRow } from '@/app/actions/assignments'
import { DateTimeField, afterPresets } from '@/components/organizations/DateTimeField'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { reviewFixBy } from '@/lib/organizations/assignment-rules'
import { isoToZonedInput, todayInZone } from '@/lib/organizations/zoned-time'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'

type Lane = 'review' | 'returned' | 'approved'
const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const WHEN = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const label = 'font-mono text-[11px] font-medium uppercase tracking-[0.09em]'

/** What a lane-to-lane drop means; only a waiting or approved copy can be decided by dragging. */
export function laneDrop(from: Lane, to: Lane): 'approve' | 'return' | 'reopen_return' | { refuse: string } | null {
    if (from === to) return null
    if (from === 'review') return to === 'approved' ? 'approve' : 'return'
    if (from === 'approved') return to === 'returned' ? 'reopen_return' : { refuse: 'Approved work goes back only through Return.' }
    return { refuse: 'Returned work comes back here when they hand it in again.' }
}

type Pending = { row: ReviewQueueRow; from: 'review' } | { row: ReviewLaneRow; from: 'approved' }

export function ReviewLanes({ waiting, returned, approved, recentReasons, onDecide, onReturnApproved, onApproveAll, onOpen }: {
    waiting: ReviewQueueRow[]; returned: ReviewLaneRow[]; approved: ReviewLaneRow[]; recentReasons: string[]
    onDecide: (row: ReviewQueueRow, decision: 'approve' | 'return', reason?: string, fixBy?: string | null) => void
    /** Return an approved copy (decision 40, while the assignment is open). */
    onReturnApproved: (row: ReviewLaneRow, reason: string, fixBy: string | null) => void
    onApproveAll: (rows: ReviewQueueRow[]) => void
    /** Open one hand-in in the one-at-a-time view. */
    onOpen: (row: ReviewQueueRow) => void
}) {
    const [returning, setReturning] = useState<Pending | null>(null)
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }), useSensor(KeyboardSensor))
    const byId = new Map<string, { lane: Lane; row: ReviewQueueRow | ReviewLaneRow }>([
        ...waiting.map((r) => [r.copyId, { lane: 'review' as const, row: r }] as const),
        ...approved.map((r) => [r.copyId, { lane: 'approved' as const, row: r }] as const),
        ...returned.map((r) => [r.copyId, { lane: 'returned' as const, row: r }] as const),
    ])
    const onDragEnd = ({ active, over }: DragEndEvent) => {
        const found = byId.get(String(active.id))
        const to = over?.id as Lane | undefined
        if (!found || !to) return
        const what = laneDrop(found.lane, to)
        if (!what) return
        if (typeof what === 'object') return void toast.error(what.refuse)
        if (what === 'approve') return onDecide(found.row as ReviewQueueRow, 'approve')
        setReturning(what === 'return' ? { row: found.row as ReviewQueueRow, from: 'review' } : { row: found.row as ReviewLaneRow, from: 'approved' })
    }
    const copies = waiting.filter((r) => r.kind === 'copy')
    return (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto px-4 py-4 sm:px-5" data-testid="review-lanes">
                <LaneColumn id="review" title="To review" tone="text-[var(--status-info)]" count={waiting.length}
                    action={copies.length > 1 ? <button type="button" className="text-[12px] font-medium text-primary hover:underline" onClick={() => onApproveAll(copies)}>Approve all {copies.length}</button> : null}
                    empty="Nothing waiting. Hand-ins show here as they come in.">
                    {waiting.map((r) => (
                        <LaneCard key={r.copyId} id={r.copyId} title={r.kind === 'task' ? r.title : r.title} who={r.who} people={r.people ?? []} onOpen={() => onOpen(r)}
                            line={[`Handed in ${WHEN.format(new Date(r.submittedAt))}`, r.version ? `version ${r.version}` : null].filter(Boolean).join(' · ')} late={r.late}
                            files={r.files.map((f) => f.name)}
                            actions={<>
                                <Button type="button" size="sm" variant="outline" className="h-7 text-destructive" onClick={() => setReturning({ row: r, from: 'review' })}>Return</Button>
                                <Button type="button" size="sm" className="h-7" onClick={() => onDecide(r, 'approve')}>Approve</Button>
                            </>} />
                    ))}
                </LaneColumn>
                <LaneColumn id="returned" title="Returned" tone="text-[var(--status-warning)]" count={returned.length} hint="Drop here to return" empty="Nothing returned and waiting.">
                    {returned.map((r) => (
                        <LaneCard key={r.copyId} id={r.copyId} title={r.title} who={r.who} people={r.people} draggable={false}
                            line={[`Returned ${DAY.format(new Date(r.at))}`, r.fixBy ? `fix by ${DAY.format(new Date(r.fixBy))}` : null, 'not handed in again yet'].filter(Boolean).join(' · ')}
                            reason={r.reason} />
                    ))}
                </LaneColumn>
                <LaneColumn id="approved" title="Approved" tone="text-[var(--status-success)]" count={approved.length} hint="Drop here to approve" empty="Approvals from the last 14 days show here.">
                    {approved.map((r) => (
                        <LaneCard key={r.copyId} id={r.copyId} title={r.title} who={r.who} people={r.people} done
                            line={`Approved ${DAY.format(new Date(r.at))}${r.by ? ` by ${r.by}` : ''}`}
                            actions={<Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setReturning({ row: r, from: 'approved' })}>Return</Button>} />
                    ))}
                </LaneColumn>
            </div>
            <ReturnDialog pending={returning} recentReasons={recentReasons} onCancel={() => setReturning(null)}
                onReturn={(reason, fixBy) => {
                    const p = returning
                    setReturning(null)
                    if (!p) return
                    if (p.from === 'review') onDecide(p.row, 'return', reason, fixBy)
                    else onReturnApproved(p.row, reason, fixBy)
                }} />
        </DndContext>
    )
}

function LaneColumn({ id, title, tone, count, hint, action, empty, children }: { id: Lane; title: string; tone: string; count: number; hint?: string; action?: React.ReactNode; empty: string; children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({ id })
    return (
        <section ref={setNodeRef} aria-label={`${title}, ${count}`} className={cn('flex w-[300px] shrink-0 flex-col gap-3 rounded-lg border bg-muted p-3 transition-colors', isOver ? 'border-primary bg-[var(--status-info-soft)]' : 'border-border')}>
            <header className="flex items-center gap-2">
                <h3 className={cn('text-[13px] font-semibold', tone)}>{title}</h3>
                <span className="rounded-sm border border-border bg-card px-1.5 font-mono text-[11px] text-muted-foreground">{count}</span>
                <span className="ml-auto">{action}</span>
            </header>
            {hint && isOver ? <p className={cn(label, 'text-primary')}>{hint}</p> : null}
            {count ? children : <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted-foreground">{empty}</p>}
        </section>
    )
}

function LaneCard({ id, title, who, people, line, late, files = [], reason, done, actions, onOpen, draggable = true }: {
    id: string; title: string; who: string; people: Array<{ id: string; name: string; avatarUrl: string | null }>; line: string; late?: boolean; files?: string[]
    reason?: string | null; done?: boolean; actions?: React.ReactNode; onOpen?: () => void; draggable?: boolean
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled: !draggable })
    return (
        <article ref={setNodeRef} {...(draggable ? attributes : {})} {...(draggable ? listeners : {})}
            style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
            className={cn('grid gap-2 rounded-lg border border-border bg-card p-3 text-left', draggable && 'cursor-grab touch-manipulation', isDragging && 'relative z-10 shadow-lg')}>
            {onOpen ? <button type="button" onClick={onOpen} className={cn('text-left text-[13px] font-medium leading-[18px] hover:underline', done && 'text-muted-foreground')}>{title}</button>
                : <p className={cn('text-[13px] font-medium leading-[18px]', done && 'text-muted-foreground')}>{title}</p>}
            <p className="font-mono text-[11px] text-muted-foreground">{line}{late ? <span className="text-destructive"> · Late</span> : null}</p>
            {reason ? <p className="line-clamp-2 text-[12px] text-muted-foreground">“{reason}”</p> : null}
            {files.length ? (
                <div className="flex flex-wrap gap-1">
                    {files.slice(0, 2).map((f) => <span key={f} className="max-w-[150px] truncate rounded-sm border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground" title={f}>{f}</span>)}
                    {files.length > 2 ? <span className="font-mono text-[11px] text-muted-foreground">+{files.length - 2}</span> : null}
                </div>
            ) : null}
            <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="flex shrink-0">
                        {(people.length ? people.slice(0, 3) : [{ id: who, name: who, avatarUrl: null }]).map((p, i) => (
                            <UserAvatar key={p.id} identity={{ fullName: p.name, avatarUrl: p.avatarUrl }} size={20} className={cn('size-5 ring-1 ring-card', i && '-ml-1.5')} roundedClassName="rounded-sm" fallbackClassName="text-[11px]" />
                        ))}
                    </span>
                    <span className="truncate text-[12px] text-muted-foreground" title={who}>{who}</span>
                </span>
                {actions ? <span className="flex shrink-0 gap-1.5" onPointerDown={(e) => e.stopPropagation()}>{actions}</span> : null}
            </div>
        </article>
    )
}

/** Return sheet: what to change (required) and Fix by, the same as the one-at-a-time view's Return. */
function ReturnDialog({ pending, recentReasons, onCancel, onReturn }: { pending: Pending | null; recentReasons: string[]; onCancel: () => void; onReturn: (reason: string, fixBy: string | null) => void }) {
    const [reason, setReason] = useState('')
    const [fixBy, setFixBy] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [forId, setForId] = useState<string | null>(null)
    if (pending && pending.row.copyId !== forId) {
        setForId(pending.row.copyId); setReason(''); setError(null)
        setFixBy(isoToZonedInput(reviewFixBy(pending.row.dueDate).toISOString(), null))
    }
    const who = pending?.row.who ?? ''
    return (
        <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) { setForId(null); onCancel() } }}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>Return {who}’s work?</DialogTitle>
                    <DialogDescription>They get a notification. Their card moves back to In progress, marked Returned.</DialogDescription>
                </DialogHeader>
                <label className="block space-y-1 text-sm"><span className="font-medium">What should {who} change?</span>
                    <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="nb-textarea" /></label>
                {recentReasons.length ? (
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Recent reasons">
                        {recentReasons.map((r) => <button key={r} type="button" className="max-w-full truncate rounded-md border border-border px-2 py-0.5 text-[12px] hover:bg-muted" onClick={() => setReason(r)}>{r}</button>)}
                    </div>
                ) : null}
                <div className="space-y-1 text-sm"><span className="block font-medium">Fix by</span>
                    <DateTimeField value={fixBy} onChange={setFixBy} timeZone={null} summary="Fix by" aria-label="Fix by" presets={afterPresets(todayInZone(null))} presetsLabel="From today" />
                </div>
                {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => { setForId(null); onCancel() }}>Cancel</Button>
                    <Button type="button" onClick={() => {
                        if (!reason.trim()) return setError('Say what to change.')
                        setForId(null)
                        onReturn(reason.trim(), fixBy ? new Date(fixBy).toISOString() : null)
                    }}>Return</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
