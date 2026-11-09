'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'


import { readReviewQueueAction, reviewAssignmentCopyAction, type ReviewQueueRow } from '@/app/actions/assignments'
import { createTaskCommentAction } from '@/app/actions/task-comment'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { FileViewer } from '@/components/organizations/FileViewer'
import CommentsTab from '@/components/workspaces/v2/tasks/TaskDetailTabs/CommentsTab'
import { useAuth } from '@/hooks/use-auth'
import { useTaskDiscussionResource } from '@/hooks/useTaskDiscussionResource'
import { reviewFixBy, webLink } from '@/lib/organizations/assignment-rules'
import { isoToZonedInput } from '@/lib/organizations/zoned-time'
import { deferredFeedback, toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'

export { useReloadOnNotice } from '@/hooks/useReloadOnNotice'


// Mockup task 2 (Review artboard) and review UX phase 4: the work in the middle — every file, every version, Compare —
// and on the right the note, the steps, the conversation, then the decision.

const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
// Textareas use .nb-textarea (spec §10); this only adds layout.
const area = 'w-full'
export const reviewLabel = 'font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground'

/** Review UX 3.11: a handed-in link as a card — the site, then the address. */
export function LinkCard({ link }: { link: string }) {
    const url = webLink(link)
    if (!url) return <span className="break-all">{link}</span>
    const { hostname, pathname } = new URL(url)
    return (
        <a href={url} target="_blank" rel="noreferrer noopener" className="block rounded-md border border-border px-3 py-2 hover:bg-muted">
            <span className="block text-[13px] font-medium">{hostname.replace(/^www\./, '')}</span>
            <span className="block truncate text-[12px] text-primary">{pathname === '/' ? url : `${hostname}${pathname}`}</span>
        </a>
    )
}

/** Every file of the version being looked at, a switcher between them, the earlier versions and Compare (3.2, 3.3, 4.3, 4.4). */
export function ReviewWork({ row }: { row: ReviewQueueRow }) {
    const versions = row.versions ?? []
    const now = row.version ?? (versions[0] ? versions[0].version + 1 : 1)
    const [version, setVersion] = useState(now)
    const [fileIndex, setFileIndex] = useState(0)
    // Review queue §4b.4: a resubmission opens with Compare on, the same file beside the last version.
    const [compare, setCompare] = useState(() => (row.version ?? 1) > 1 && versions.length > 0)
    const filesOf = (v: number) => (v === now ? row.files : versions.find((x) => x.version === v)?.files ?? [])
    const files = filesOf(version)
    const file = files[Math.min(fileIndex, files.length - 1)] ?? null
    // Compare: the same file by name in the version before, or that version's first file.
    const before = versions.find((v) => v.version < version)
    const beforeFile = before ? before.files.find((f) => f.name === file?.name) ?? before.files[0] ?? null : null
    if (!row.files.length && !versions.some((v) => v.files.length)) return null
    const unavailable = <>The preview isn’t available here. <a href={row.href} className="text-primary underline-offset-4 hover:underline">Open the hand-in</a></>
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                {files.length > 1 ? (
                    <div role="tablist" aria-label="Files" className="flex min-w-0 flex-1 flex-wrap gap-1">
                        {files.map((f, i) => (
                            <button key={f.nodeId} type="button" role="tab" aria-selected={f.nodeId === file?.nodeId} onClick={() => setFileIndex(i)}
                                title={f.name} className={cn('max-w-[18rem] truncate rounded-md border px-2 py-0.5 text-[12px]', f.nodeId === file?.nodeId ? 'border-foreground font-medium' : 'border-border hover:bg-muted')}>{f.name}</button>
                        ))}
                    </div>
                ) : <span className="flex-1" />}
                {versions.length ? (
                    <select aria-label="Versions" className="nb-select" data-size="sm" value={version} onChange={(e) => { setVersion(Number(e.target.value)); setFileIndex(0) }}>
                        <option value={now}>Version {now} · now</option>
                        {versions.map((v) => <option key={v.version} value={v.version}>Version {v.version} · {v.files.map((f) => f.name).join(', ') || 'nothing attached'} · {DAY.format(new Date(v.at))}</option>)}
                    </select>
                ) : null}
                {beforeFile ? <Button type="button" size="sm" variant={compare ? 'default' : 'outline'} aria-pressed={compare} onClick={() => setCompare(!compare)}>Compare</Button> : null}
            </div>
            {file ? (
                <div className={cn('grid min-h-0 flex-1 gap-2 md:grid-rows-1', compare && beforeFile && 'md:grid-cols-2')}>
                    {compare && beforeFile && before ? <FileViewer key={`b-${beforeFile.nodeId}`} projectId={row.projectId} file={beforeFile} meta={`Version ${before.version}`} unavailable={unavailable} className="h-full min-h-[50vh] md:min-h-0" /> : null}
                    <FileViewer key={file.nodeId} projectId={row.projectId} file={file} meta={`Version ${version}${version === now ? ` · handed in ${DAY.format(new Date(row.submittedAt))}` : ''}`}
                        unavailable={unavailable} className="h-full min-h-[50vh] md:min-h-0" />
                </div>
            ) : <p className="text-[13px] text-muted-foreground">Version {version} had nothing attached.</p>}
        </div>
    )
}

/** Review UX 3.5: the steps by name, ticked or not; nothing when there are none. */
export function ReviewSteps({ row }: { row: ReviewQueueRow }) {
    if (!row.steps.length) return null
    return (
        <div>
            <h3 className={reviewLabel}>Steps · {row.steps.filter((s) => s.done).length} of {row.steps.length} ticked</h3>
            <ul className="mt-1 space-y-0.5 text-[13px]" aria-label="Steps">
                {row.steps.map((s, i) => <li key={`${i}-${s.title}`} className={cn(!s.done && 'text-muted-foreground')}><span aria-hidden="true">{s.done ? '☑' : '☐'}</span> {s.title}<span className="sr-only">{s.done ? ', ticked' : ', not ticked'}</span></li>)}
            </ul>
        </div>
    )
}

/**
 * Board/review report §3: the copy's private conversation in place — the task panel's own comments (the whole thread,
 * replies, likes, typing, live updates), scrolling inside the column. Keyed by the copy, so Next switches threads.
 */
export function ReviewDiscussion({ row, restoreDraft = null }: { row: ReviewQueueRow; restoreDraft?: { text: string; key: number } | null }) {
    const { user, profile } = useAuth()
    const d = useTaskDiscussionResource({ taskId: row.copyId, projectId: row.projectId, canEdit: true, currentUserId: user?.id, enabled: true })
    // Review queue §3: the whole column is the discussion — one heading, the thread, the box at the bottom.
    return (
        <section aria-label="Discussion" className="flex h-full min-h-[320px] flex-col">
            <div className="min-h-0 flex-1">
                <CommentsTab projectId={row.projectId} taskId={row.copyId} comments={d.comments as never} totalCount={d.totalCount} hasMore={Boolean(d.nextCursor)}
                    isLoading={d.isLoading} isLoadingMore={d.isLoadingMore} error={d.error} canEdit currentUserId={user?.id}
                    currentUser={profile ? { fullName: profile.fullName, avatarUrl: profile.avatarUrl, username: profile.username } : null}
                    presenceStatus={d.presenceStatus} topLevelTypingUsers={d.topLevelTypingUsers} replyTypingUsersByParentId={d.replyTypingUsersByParentId}
                    onAddComment={d.addComment} onToggleLike={d.toggleLike} onDeleteComment={d.deleteComment} onLoadOlderComments={d.loadOlderComments} onSendTyping={d.sendTyping}
                chat placeholder={`Write to ${row.who}…`} events={row.events ?? []} restoreDraft={restoreDraft} />
            </div>
        </section>
    )
}

/**
 * Approve, or Return with a reason and Fix by (review UX 3.7, 3.12): the queue and an opened copy use this one box.
 * `keys` adds A and R. Recent reasons are one click; Fix by starts at the later of the due date and three days on.
 */
export function ReviewDecision({ who, kind = 'copy', dueDate, recentReasons = [], pending, keys, onApprove, onReturn, extra, layout = 'box' }: {
    who: string; kind?: 'copy' | 'task'; dueDate: string | null; recentReasons?: string[]; pending: boolean; keys?: boolean
    onApprove: (note: string) => void; onReturn: (reason: string, fixByIso: string | null) => void; extra?: React.ReactNode
    /** Review queue §2: 'bar' puts Return · Approve ▾ · ⋯ on the work's header; their boxes open right under the buttons. */
    layout?: 'box' | 'bar'
}) {
    const [noting, setNoting] = useState(false)
    const [returning, setReturning] = useState(false)
    const [reason, setReason] = useState('')
    const [fixBy, setFixBy] = useState('')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const openReturn = () => { setReturning(true); setReason(''); setError(null); setFixBy(isoToZonedInput(reviewFixBy(dueDate).toISOString(), null)) }
    const sendReturn = () => {
        if (!reason.trim()) return setError('Say what to change.')
        setReturning(false)
        onReturn(reason.trim(), kind === 'copy' && fixBy ? new Date(fixBy).toISOString() : null)
    }
    const approve = () => { onApprove(note.trim()); setNote(''); setNoting(false) }
    const latest = useRef({ approve, openReturn, returning })
    latest.current = { approve, openReturn, returning }
    useEffect(() => {
        if (!keys) return
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (event.metaKey || event.ctrlKey || event.altKey || (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))) return
            const k = event.key.toLowerCase()
            if (k === 'a' && !latest.current.returning) latest.current.approve()
            else if (k === 'r') { event.preventDefault(); latest.current.openReturn() }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [keys])
    const returnBox = (
        <div className="space-y-2">
            <label className="block space-y-1"><span className="font-medium">What should {who} change?</span>
                <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="nb-textarea" aria-label={`What should ${who} change?`} /></label>
            {recentReasons.length ? (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Recent reasons">
                    {recentReasons.map((r) => <button key={r} type="button" className="max-w-full truncate rounded-md border border-border px-2 py-0.5 text-[12px] hover:bg-muted" onClick={() => setReason(r)}>{r}</button>)}
                </div>
            ) : null}
            {kind === 'copy' ? <label className="flex flex-wrap items-center gap-2">Fix by <Input type="datetime-local" value={fixBy} onChange={(e) => setFixBy(e.target.value)} className="h-7 w-auto" aria-label="Fix by" /></label> : null}
            {error ? <p role="alert" className="text-destructive">{error}</p> : null}
            <div className="flex gap-2">
                <Button type="button" size="sm" className="h-7" disabled={pending} onClick={sendReturn}>Return</Button>
                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setReturning(false)}>Cancel</Button>
            </div>
        </div>
    )
    if (layout === 'bar') {
        const panel = 'absolute right-0 top-full z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-sm shadow-md'
        return (
            <div className="relative flex shrink-0 items-center gap-2" role="group" aria-label="Decision">
                <Button type="button" size="sm" variant="outline" className="h-7" disabled={pending} onClick={openReturn} aria-expanded={returning}>Return</Button>
                <span className="inline-flex">
                    <Button type="button" size="sm" className="h-7 rounded-r-none" disabled={pending} onClick={approve}>Approve</Button>
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button type="button" size="sm" className="h-7 rounded-l-none border-l border-primary-foreground/30 px-1.5" disabled={pending} aria-label="More ways to approve"><ChevronDown className="size-3.5" aria-hidden="true" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setReturning(false); setNoting(true) }}>Approve with a note…</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </span>
                {extra}
                {returning ? <div className={panel} role="dialog" aria-label={`Return to ${who}`}>{returnBox}</div> : null}
                {noting ? (
                    <div className={panel} role="dialog" aria-label="Approve with a note">
                        <div className="space-y-2">
                            <label className="block space-y-1"><span className="font-medium">A note for {who}</span>
                                <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="nb-textarea" aria-label={`A note for ${who}`} /></label>
                            <p className="text-[12px] text-muted-foreground">It goes into the discussion.</p>
                            <div className="flex gap-2">
                                <Button type="button" size="sm" className="h-7" disabled={pending || !note.trim()} onClick={approve}>Approve</Button>
                                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => { setNoting(false); setNote('') }}>Cancel</Button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        )
    }
    return (
        <div className="space-y-2 border-t border-border pt-3" role="group" aria-label="Decision">
            {returning ? returnBox : (
                // Report §32.7: on phones Approve and Return stay at the bottom; no swipe, so nothing decides by accident.
                <div className="space-y-2 max-md:sticky max-md:bottom-0 max-md:bg-card max-md:py-2">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add note (optional)" aria-label="Add note" maxLength={2000} className="h-8 w-full" />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" disabled={pending} onClick={approve}>Approve</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={openReturn}>Return</Button>
                        {extra}
                    </div>
                    {keys ? <p className="text-[11px] text-muted-foreground">A approve · R return · J next · K previous · Esc close</p> : null}
                </div>
            )}
        </div>
    )
}

/** Approve or Return waits 10 seconds with Undo before it's sent (review UX 3.9). */
export function deferDecision(message: string, send: () => Promise<{ success: boolean; error?: string }>, onUndo: () => void, onSent: (ok: boolean, error?: string) => void) {
    // Closing the tab inside the 10 seconds would drop the decision, so the browser asks first.
    const stay = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', stay)
    const done = () => window.removeEventListener('beforeunload', stay)
    deferredFeedback(message, () => { done(); onUndo() }, () => { done(); void send().then((r) => onSent(r.success, r.error)).catch(() => onSent(false)) }, 'Decision taken back')
}

/** Review UX 3.12, 3.13: an opened copy that's waiting gets the queue's own decision, Next waiting and Back to queue. */
export function CopyReview({ copyId, orgId, masterId, onReviewed }: { copyId: string; orgId: string; masterId: string; onReviewed: (decision: 'approve' | 'return') => void }) {
    const [data, setData] = useState<{ row: ReviewQueueRow | null; next: ReviewQueueRow | null; reasons: string[] } | null>(null)
    const [held, setHeld] = useState(false)
    useEffect(() => {
        let live = true
        void readReviewQueueAction(orgId).then((r) => {
            if (!live || !r.success) return
            const rows = r.rows.filter((x) => x.kind === 'copy')
            const at = rows.findIndex((x) => x.copyId === copyId)
            const same = rows.filter((x) => x.masterId === masterId && x.copyId !== copyId)
            setData({ row: rows[at] ?? null, next: same.find((x) => rows.indexOf(x) > at) ?? same[0] ?? null, reasons: r.recentReasons })
        }).catch(() => undefined)
        return () => { live = false }
    }, [copyId, masterId, orgId])
    if (!data?.row) return null
    const { row } = data
    const queueHref = `?tab=tasks&taskScope=review&assignment=${encodeURIComponent(masterId)}`
    const decide = (decision: 'approve' | 'return', reason?: string, fixBy?: string | null, note?: string) => {
        setHeld(true)
        deferDecision(decision === 'approve' ? `Approved ${row.who}’s ${row.title}.` : `Returned ${row.title} to ${row.who}.`,
            () => reviewAssignmentCopyAction(copyId, decision, reason, { projectId: row.projectId, updatedAt: row.updatedAt }, fixBy ? { fixBy } : {})
                .then(async (r) => { if (r.success && note) await createTaskCommentAction(copyId, row.projectId, note).catch(() => undefined); return r }),
            () => setHeld(false),
            (ok, error) => { if (ok) onReviewed(decision); else { setHeld(false); toast.warning(error ?? 'Couldn’t save that. Try again.') } })
    }
    return (
        <section aria-label="Review this hand-in" className="space-y-2 rounded-md border border-border p-3">
            <h3 className={reviewLabel}>Review</h3>
            {held ? <p role="status" className="text-[13px] text-muted-foreground">Sending in a few seconds. Undo is in the notice.</p> : (
                <ReviewDecision who={row.who} dueDate={row.dueDate} recentReasons={data.reasons} pending={held}
                    onApprove={(note) => decide('approve', undefined, null, note)} onReturn={(reason, fixBy) => decide('return', reason, fixBy)} />
            )}
            <div className="flex flex-wrap gap-3 text-[13px]">
                {/* In-app links: no browser reload (unified back §8). */}
                {data.next ? <Link href={data.next.href} scroll={false} className="text-primary underline-offset-4 hover:underline">Next waiting: {data.next.who}</Link> : null}
                <Link href={queueHref} scroll={false} className="text-primary underline-offset-4 hover:underline">Review queue</Link>
            </div>
        </section>
    )
}
