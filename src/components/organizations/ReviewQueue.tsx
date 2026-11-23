'use client'
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { approveAllSubmittedAction, readReviewLanesAction, readReviewQueueAction, reviewAssignmentCopyAction, type ReviewLaneRow, type ReviewQueueRow } from '@/app/actions/assignments'
import { ReviewLanes } from '@/components/organizations/ReviewLanes'
import { approveTaskReviewAction, requestTaskChangesAction } from '@/app/actions/task'
import { createTaskCommentAction } from '@/app/actions/task-comment'
import { markTaskAsReadAction } from '@/app/actions/workspace'
import { deferDecision, LinkCard, ReviewDecision, ReviewDiscussion, ReviewWork, useReloadOnNotice } from '@/components/organizations/ReviewQueueParts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useRoomViewers } from '@/hooks/useRoomViewers'
import { queueOrder } from '@/lib/organizations/assignment-rules'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from '@/lib/utils/date'
import { readUrlParam, useUrlMirror } from '@/lib/navigation/url-state'
import { copyOrSay } from '@/lib/clipboard';

// Review queue report (2026-11-04-review-queue-layout-findings.md): who's waiting on the left, the work in the middle
// with the decision on its own header, and only the discussion on the right — on one 8px grid, the three tops level.

// Filter toggles are tags: the chosen one takes the ink fill (spec §05).
const label = 'font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground'
const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })
const short = (iso: string) => ago(iso).replace(/^about /, '').replace(/ hours?/, 'h').replace(/ minutes?/, 'm').replace(/ days?/, 'd').replace(' ago', '')

/** "2 hours late" from the due date and when it was handed in. */
function lateBy(row: ReviewQueueRow) {
    if (!row.late || !row.dueDate) return null
    const ms = new Date(row.submittedAt).getTime() - new Date(row.dueDate).getTime()
    const h = Math.round(ms / 3_600_000)
    return h >= 48 ? `${Math.round(h / 24)} days late` : h >= 1 ? `${h} ${h === 1 ? 'hour' : 'hours'} late` : `${Math.max(1, Math.round(ms / 60_000))} minutes late`
}

function Avatar({ name, url, size = 24 }: { name: string; url?: string | null; size?: number }) {
    return <UserAvatar identity={{ fullName: name, avatarUrl: url ?? null }} size={size} className="shrink-0" roundedClassName="rounded-md" fallbackClassName="text-[11px]" />
}

export function ReviewQueue({ orgId, onChanged, onClose, tabs }: { orgId: string; onChanged: () => void; onClose?: () => void
    /** Board/review report §2: the board's View button, drawn at the end of the queue's own line. */
    tabs?: (waiting: number) => React.ReactNode }) {
    const [rows, setRows] = useState<ReviewQueueRow[] | null>(null)
    const [incoming, setIncoming] = useState<ReviewQueueRow[]>([])
    const [total, setTotal] = useState(0)
    const [cursor, setCursor] = useState<string | null>(null)
    const [loadingMore, setLoadingMore] = useState(false)
    const [reasons, setReasons] = useState<string[]>([])
    // §4b.1, §4b.3: the place is the hand-in itself (and the link), never a position that shifts when the list changes.
    const [currentId, setCurrentId] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('review')))
    const [assignment, setAssignment] = useState(() => (typeof window === 'undefined' ? 'all' : new URLSearchParams(window.location.search).get('assignment') ?? 'all'))
    const [lateOnly, setLateOnly] = useState(() => readUrlParam('rqlate') === '1')
    // Reviewers (report §33.5): Mine is the work you review, plus anything nobody was picked for.
    const [mineOnly, setMineOnly] = useState(() => readUrlParam('rqmine') === '1')
    const [query, setQuery] = useState(() => readUrlParam('rqq') ?? '')
    const [sort, setSort] = useState<'oldest' | 'newest' | 'late'>(() => { const s = readUrlParam('rqsort'); return s === 'newest' || s === 'late' ? s : 'oldest' })
    // Assignment flow decision 5: the lanes by default; One at a time is the full review of each hand-in.
    const [view, setView] = useState<'lanes' | 'one'>(() => (readUrlParam('rqview') === 'one' || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('review')) ? 'one' : 'lanes'))
    const [lanes, setLanes] = useState<{ returned: ReviewLaneRow[]; approved: ReviewLaneRow[] }>({ returned: [], approved: [] })
    // The queue's filters live in the address (unified back R3).
    useUrlMirror({ rqview: view === 'one' ? 'one' : null, assignment: assignment !== 'all' ? assignment : null, rqlate: lateOnly ? '1' : null, rqmine: mineOnly ? '1' : null, rqq: query || null, rqsort: sort !== 'oldest' ? sort : null })
    // Review UX 3.9: decisions waiting out their 10 seconds, hidden from the list until sent or taken back.
    const [held, setHeld] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const [restore, setRestore] = useState<{ copyId: string; text: string; key: number } | null>(null)
    const [keysOpen, setKeysOpen] = useState(false)
    const [spoken, setSpoken] = useState('')
    const headerRef = useRef<HTMLHeadingElement>(null)

    const load = useCallback(() => void readReviewQueueAction(orgId).then((r) => {
        if (!r.success) { setError(r.error); setRows((cur) => cur ?? []); return }
        setTotal(r.total)
        setReasons(r.recentReasons)
        setRows((cur) => {
            if (!cur) { setCursor(r.nextCursor); return r.rows }
            // §4b.1: a reload never reshuffles: rows still waiting are refreshed in place, ones decided elsewhere leave,
            // and new hand-ins wait behind "N new · Show".
            const fresh = new Map(r.rows.map((x) => [x.copyId, x]))
            const lastFresh = r.rows.at(-1)?.submittedAt
            const kept = cur.filter((x) => fresh.has(x.copyId) || (r.nextCursor && lastFresh && x.submittedAt > lastFresh)).map((x) => fresh.get(x.copyId) ?? x)
            const known = new Set(cur.map((x) => x.copyId))
            const added = r.rows.filter((x) => !known.has(x.copyId))
            if (kept.length === 0) return added
            setIncoming((prev) => [...prev.filter((x) => !fresh.has(x.copyId) || !known.has(x.copyId)), ...added].filter((x, i, all) => all.findIndex((y) => y.copyId === x.copyId) === i))
            return kept
        })
    }), [orgId])
    const loadLanes = useCallback(() => void readReviewLanesAction(orgId).then((r) => { if (r.success) setLanes({ returned: r.returned, approved: r.approved }) }).catch(() => undefined), [orgId])
    useEffect(() => { load(); loadLanes() }, [load, loadLanes])
    useReloadOnNotice(useCallback(() => { load(); loadLanes() }, [load, loadLanes]))
    const showIncoming = () => { setRows((cur) => [...(cur ?? []), ...incoming]); setIncoming([]) }
    // §4b.2: the next 200 when you're near the end, and a Load more row for keyboards and screen readers.
    const loadMore = useCallback(() => {
        if (!cursor || loadingMore) return
        setLoadingMore(true)
        void readReviewQueueAction(orgId, cursor).then((r) => {
            if (r.success) { setRows((cur) => { const seen = new Set((cur ?? []).map((x) => x.copyId)); return [...(cur ?? []), ...r.rows.filter((x) => !seen.has(x.copyId))] }); setCursor(r.nextCursor) }
        }).finally(() => setLoadingMore(false))
    }, [cursor, loadingMore, orgId])

    useEffect(() => { if (rows && assignment !== 'all' && !rows.some((r) => r.masterId === assignment)) setAssignment('all') }, [rows, assignment])
    const shown = useMemo(() => queueOrder((rows ?? []).filter((r) => !held.has(r.copyId) && (assignment === 'all' || r.masterId === assignment) && (!lateOnly || r.late) && (!mineOnly || r.mine)), sort, query),
        [rows, held, assignment, lateOnly, mineOnly, sort, query])
    const index = Math.max(0, shown.findIndex((r) => r.copyId === currentId))
    const current = shown[index] ?? null
    // Keep the place on a real row (the first, when the one you were on is gone).
    useEffect(() => { if (current && current.copyId !== currentId) setCurrentId(current.copyId) }, [current, currentId])
    useEffect(() => { if (cursor && shown.length && index >= shown.length - 10) loadMore() }, [cursor, index, loadMore, shown.length])
    const step = (by: number) => { if (shown.length) setCurrentId(shown[(index + by + shown.length) % shown.length]!.copyId) }

    // §4b.3, §4b.5: the link follows the hand-in, the tab says whose it is, and opening it marks its messages read.
    useEffect(() => {
        if (!current) return
        const url = new URL(window.location.href)
        url.searchParams.set('review', current.copyId)
        window.history.replaceState(window.history.state, '', url)
        const before = document.title
        document.title = `Review · ${current.who} · ${current.title}`
        if (current.newMessages) {
            void markTaskAsReadAction(current.copyId).catch(() => undefined)
            setRows((cur) => (cur ?? []).map((x) => (x.copyId === current.copyId ? { ...x, newMessages: 0 } : x)))
        }
        return () => { document.title = before }
    }, [current?.copyId])
    useEffect(() => () => {
        const url = new URL(window.location.href)
        url.searchParams.delete('review')
        window.history.replaceState(window.history.state, '', url)
    }, [])
    // After a decision or a step, focus the next person's header and say who it is.
    const announce = useRef(false)
    useEffect(() => {
        if (!current || !announce.current) return
        announce.current = false
        headerRef.current?.focus()
        setSpoken(`Now reviewing ${current.who}, ${index + 1} of ${shown.length}`)
    }, [current, index, shown.length])

    const hold = (id: string, on: boolean) => setHeld((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next })
    const decide = (row: ReviewQueueRow, decision: 'approve' | 'return', reason?: string, fixBy?: string | null, note?: string) => {
        announce.current = true
        hold(row.copyId, true)
        setError(null)
        // An ordinary board task uses the task's own review (problem 33); a copy uses the assignment's.
        const send = async (): Promise<{ success: boolean; error?: string }> => {
            // §4b.9: the note goes first; if it can't be sent, nothing is approved and it comes back to the box.
            if (decision === 'approve' && note) {
                const posted = await createTaskCommentAction(row.copyId, row.projectId, note).catch(() => ({ success: false }))
                if (!posted || !('success' in posted) || !posted.success) return { success: false, error: 'NOTE_FAILED' }
            }
            return row.kind === 'task'
                ? await (decision === 'approve' ? approveTaskReviewAction(row.copyId, row.projectId, row.updatedAt) : requestTaskChangesAction(row.copyId, row.projectId, reason ?? '', row.updatedAt))
                    .then((x) => (x.success ? { success: true } : { success: false, error: ('error' in x && x.error) || 'Couldn’t save that. Try again.' }))
                : await reviewAssignmentCopyAction(row.copyId, decision, reason, { projectId: row.projectId, updatedAt: row.updatedAt }, fixBy ? { fixBy } : {})
        }
        deferDecision(decision === 'approve' ? `Approved ${row.who}’s ${row.title}.` : `Returned ${row.title} to ${row.who}.`, send, () => hold(row.copyId, false), (ok, message = 'Couldn’t save that. Try again.') => {
            if (ok) {
                // Live loop 31: the count follows the queue.
                setRows((cur) => (cur ?? []).filter((x) => x.copyId !== row.copyId))
                setTotal((t) => Math.max(0, t - 1))
                hold(row.copyId, false)
                onChanged()
                loadLanes()
                return
            }
            if (message === 'NOTE_FAILED') {
                hold(row.copyId, false)
                setCurrentId(row.copyId)
                setRestore({ copyId: row.copyId, text: note ?? '', key: Date.now() })
                setError('Your note didn’t send, so it isn’t approved yet. The note is back in the discussion box.')
                return
            }
            // "Already reviewed by Priya" leaves; a new version reloads to show it (23.2 awkward cases).
            setError(message.startsWith('This changed') ? `${row.who} sent a new version. Showing it now.` : message)
            if (message.startsWith('Already reviewed')) { setRows((cur) => (cur ?? []).filter((x) => x.copyId !== row.copyId)); setTotal((t) => Math.max(0, t - 1)) }
            else load()
            hold(row.copyId, false)
        })
    }
    // Decision 5: an approved copy dragged (or sent) to Returned, while the assignment is open (decision 40).
    const returnApproved = (row: ReviewLaneRow, reason: string, fixBy: string | null) => {
        setLanes((l) => ({ ...l, approved: l.approved.filter((x) => x.copyId !== row.copyId) }))
        deferDecision(`Returned ${row.title} to ${row.who}.`,
            () => reviewAssignmentCopyAction(row.copyId, 'return', reason, { projectId: row.projectId, updatedAt: row.updatedAt }, { ...(fixBy ? { fixBy } : {}), change: true }),
            () => loadLanes(),
            (ok, message = 'Couldn’t save that. Try again.') => { if (!ok) setError(message); loadLanes(); onChanged() })
    }
    // Approve all in To review: one call per assignment, with the same 10 seconds to take it back.
    const approveAll = (list: ReviewQueueRow[]) => {
        const byMaster = new Map<string, string[]>()
        for (const r of list) byMaster.set(r.masterId, [...(byMaster.get(r.masterId) ?? []), r.copyId])
        list.forEach((r) => hold(r.copyId, true))
        deferDecision(`Approved ${list.length}.`, async () => {
            const failed: string[] = []
            for (const [masterId, ids] of byMaster) {
                const r = await approveAllSubmittedAction(masterId, ids)
                if (!r.success) failed.push(r.error)
                else if (r.failed.length) failed.push(`${r.failed.length} couldn’t be approved: ${r.failed[0]!.reason}`)
            }
            return failed.length ? { success: false, error: failed.join(' ') } : { success: true }
        }, () => list.forEach((r) => hold(r.copyId, false)), (ok, message) => {
            list.forEach((r) => hold(r.copyId, false))
            if (!ok && message) setError(message)
            load(); loadLanes(); onChanged()
        })
    }
    const keys = useRef({ step, onClose })
    keys.current = { step: (by: number) => { announce.current = true; step(by) }, onClose }
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (event.metaKey || event.ctrlKey || event.altKey || (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))) return
            const k = event.key.toLowerCase()
            if (k === 'j') keys.current.step(1)
            else if (k === 'k') keys.current.step(-1)
            else if (event.key === '?') setKeysOpen(true)
            // Board/review report §2: Esc is the way back to the board — unless it closed a menu or dialog first.
            else if (k === 'escape' && !target?.closest?.('[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"]')) keys.current.onClose?.()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])
    const viewers = useRoomViewers(current?.copyId ?? null, (current?.people ?? []).map((p) => p.id))

    const waitingCount = (rows?.length ?? 0) - held.size
    const filtered = Boolean(query || lateOnly || mineOnly || assignment !== 'all')
    const clearFilters = () => { setQuery(''); setLateOnly(false); setMineOnly(false); setAssignment('all') }
    const titles = [...new Map((rows ?? []).map((r) => [r.masterId, r.kind === 'task' ? 'Other tasks' : r.title])).entries()]
    const toggle = (_on: boolean) => 'nb-tag h-7'

    const filters = (
        // Like Settings (review full-page): the filter line runs the tab's full width with one rule under it.
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names" aria-label="Search names" className="h-7 w-44 text-[13px] max-md:w-full" />
            <select aria-label="Assignment" value={assignment} onChange={(e) => setAssignment(e.target.value)} className="nb-select" data-size="sm">
                <option value="all">All assignments</option>
                {titles.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
            <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="nb-select" data-size="sm">
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
                <option value="late">Late first</option>
            </select>
            {/* Every filter control is 28px (spec §05). */}
            <button type="button" aria-pressed={lateOnly} onClick={() => setLateOnly(!lateOnly)} className={toggle(lateOnly)}>Late only</button>
            {(rows ?? []).some((r) => !r.mine) ? (
                <span className="inline-flex gap-1" role="group" aria-label="Whose reviews">
                    <button type="button" aria-pressed={mineOnly} className={toggle(mineOnly)} onClick={() => setMineOnly(true)}>Mine</button>
                    <button type="button" aria-pressed={!mineOnly} className={toggle(!mineOnly)} onClick={() => setMineOnly(false)}>All</button>
                </span>
            ) : null}
            <span className="inline-flex gap-1" role="group" aria-label="Layout">
                <button type="button" aria-pressed={view === 'lanes'} className={toggle(view === 'lanes')} onClick={() => setView('lanes')}>Lanes</button>
                <button type="button" aria-pressed={view === 'one'} className={toggle(view === 'one')} onClick={() => setView('one')}>One at a time</button>
            </span>
            <span className="ml-auto max-md:basis-full" />
            {tabs ? <span className="max-md:order-first max-md:w-full">{tabs(waitingCount)}</span> : (
                <span className="text-xs text-muted-foreground">{waitingCount}{total > (rows?.length ?? 0) ? ` of ${total}` : ''} waiting</span>
            )}
        </div>
    )
    if (!rows) return <div data-review-full>{filters}<p role="status" className="nb-waiting p-5 text-sm text-muted-foreground"><PixelBeat />Loading submissions…</p></div>

    const empty = (
        <div className="nb-empty-state nb-grid-ground m-4 rounded-lg py-16 sm:m-5" role="status">
            <h3 className="nb-empty-state-title">{filtered ? 'Nobody matches these filters' : 'All caught up'}</h3>
            <p className="nb-empty-state-desc">{filtered ? 'Try fewer filters.' : 'Nothing is waiting for review.'}</p>
            {filtered
                ? <Button type="button" size="sm" variant="outline" className="mt-3 h-7" onClick={clearFilters}>Clear filters</Button>
                : onClose ? <Button type="button" size="sm" variant="outline" className="mt-3 h-7" onClick={onClose}>Back to the board</Button> : null}
        </div>
    )

    if (view === 'lanes') return (
        <section aria-labelledby="review-queue-heading" data-review-full className="flex flex-col text-sm">
            <h2 id="review-queue-heading" className="sr-only">To review</h2>
            {filters}
            {error ? <p role="alert" className="mx-4 mt-3 shrink-0 rounded-md border border-border bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-destructive sm:mx-5">{error}</p> : null}
            {incoming.length ? <button type="button" onClick={showIncoming} className="mx-4 mt-3 h-7 self-start rounded-md border border-border bg-[var(--status-info-soft)] px-3 text-xs font-medium text-primary sm:mx-5">{incoming.length} new · Show</button> : null}
            <ReviewLanes waiting={shown}
                returned={lanes.returned.filter((r) => assignment === 'all' || r.masterId === assignment)}
                approved={lanes.approved.filter((r) => assignment === 'all' || r.masterId === assignment)}
                recentReasons={reasons} onDecide={(row, decision, reason, fixBy) => decide(row, decision, reason, fixBy)}
                onReturnApproved={returnApproved} onApproveAll={approveAll}
                onOpen={(row) => { setCurrentId(row.copyId); setView('one') }} />
            {cursor ? <button type="button" onClick={loadMore} disabled={loadingMore} className="mx-4 mb-4 h-7 self-start rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-muted sm:mx-5"><span className="nb-waiting justify-center">{loadingMore ? <PixelBeat /> : null}Load more</span></button> : null}
        </section>
    )

    const meta = (r: ReviewQueueRow) => [r.kind === 'task' ? 'Task' : r.title, short(r.submittedAt), r.version ? `v${r.version}` : null].filter(Boolean).join(' · ')
    const late = current ? lateBy(current) : null

    return (
        // Review full-page: no card — the queue fills the tab under the tab bar, as Settings does; the tab area drops its
        // padding while this is showing (WorkspaceLayout, has-[[data-review-full]]).
        <section aria-labelledby="review-queue-heading" data-review-full className="flex flex-col text-sm lg:h-[calc(100dvh-var(--ui-topnav-height,0px)-var(--workspace-tabs-height,0px))] lg:min-h-[560px]">
            <h2 id="review-queue-heading" className="sr-only">To review</h2>
            <p className="sr-only" aria-live="polite">{spoken}</p>
            {filters}
            {error ? <p role="alert" className="mx-4 mt-3 shrink-0 rounded-md border border-border bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-destructive sm:mx-5">{error}</p> : null}
            {!current ? empty : (
                // §4: 240 · flexible · 340 (300 below 1280); below 1024 the list becomes a picker over the work; phones stack.
                // Submissions/review-card report §3: one card, the three parts split by hairlines — no gaps, no inner cards.
                <div data-testid="review-card" className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] xl:grid-cols-[240px_minmax(0,1fr)_340px] max-lg:md:grid-cols-[minmax(0,1fr)_300px]">
                    <section aria-label="Waiting" className="flex min-h-0 min-w-0 flex-col gap-3 border-r border-border px-3 py-4 max-lg:hidden">
                        <div className="flex h-6 items-center justify-between">
                            <h3 className={label}>Waiting · {total}</h3>
                            <span className="flex items-center gap-1">
                                <button type="button" aria-label="Previous" disabled={shown.length < 2} onClick={() => keys.current.step(-1)} className="inline-flex size-6 items-center justify-center rounded-md border border-border text-xs hover:bg-muted disabled:opacity-40">‹</button>
                                <span className="px-1 font-mono text-[11px] text-muted-foreground">{index + 1} of {shown.length}</span>
                                <button type="button" aria-label="Next" disabled={shown.length < 2} onClick={() => keys.current.step(1)} className="inline-flex size-6 items-center justify-center rounded-md border border-border text-xs hover:bg-muted disabled:opacity-40">›</button>
                            </span>
                        </div>
                        {incoming.length ? <button type="button" onClick={showIncoming} className="h-7 rounded-md border border-border bg-[var(--status-info-soft)] text-xs font-medium text-primary">{incoming.length} new · Show</button> : null}
                        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                            {shown.map((r) => (
                                <li key={r.copyId}>
                                    <button type="button" aria-current={r.copyId === current.copyId ? 'true' : undefined} onClick={() => { announce.current = true; setCurrentId(r.copyId) }}
                                        // The main navigation's selected item: the same background, corner and text — no bar.
                                        className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors', r.copyId === current.copyId ? 'bg-[var(--sidebar-accent)] text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                                        <Avatar name={r.who} url={r.people?.length === 1 ? r.people[0]!.avatarUrl : null} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[13px] font-medium" title={r.who}>{r.who}</span>
                                            <span className="block truncate font-mono text-[11px] text-muted-foreground">{meta(r)}</span>
                                            {/* Late and Resubmitted on their own line, so the name never gets cut for them. */}
                                            {r.late || (r.version ?? 1) > 1 || r.aiFiles ? (
                                                <span className="mt-1 flex flex-wrap gap-1">
                                                    {r.late ? <span className="rounded-sm border border-border px-1.5 font-mono text-[11px] text-destructive">Late</span> : null}
                                                    {/* CLI report A8.3: how much of this hand-in an AI agent made. */}
                                                    {r.aiFiles ? <span className="rounded-sm border border-border px-1.5 font-mono text-[11px] text-muted-foreground" title="Made by an AI agent connected to NetworkBase">{r.aiFiles} of {r.files.length} via {r.agentName ?? 'an agent'}</span> : null}
                                                    {(r.version ?? 1) > 1 ? <span className="rounded-sm border border-border px-1.5 font-mono text-[11px] text-muted-foreground">Resubmitted</span> : null}
                                                </span>
                                            ) : null}
                                            {r.newMessages ? <span className="flex items-center gap-1 text-[11px] font-medium text-primary"><span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />New message</span> : null}
                                            {/* §4b.10: someone else has the open one in front of them (only the open row's room is watched). */}
                                            {r.copyId === current.copyId && viewers.length ? <span className="flex items-center gap-1 text-[11px] text-[var(--status-warning)]"><span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--status-warning)]" />{viewers[0]} is here</span> : null}
                                        </span>
                                    </button>
                                </li>
                            ))}
                            {cursor ? <li><button type="button" onClick={loadMore} disabled={loadingMore} className="h-7 w-full rounded-md border border-border text-xs text-muted-foreground hover:bg-muted"><span className="nb-waiting justify-center">{loadingMore ? <PixelBeat /> : null}Load more</span></button></li> : null}
                        </ul>
                        <p className="border-t border-border pt-2.5 font-mono text-[11px] text-muted-foreground">J / K to move · A approve · R return · <button type="button" className="underline-offset-2 hover:underline" onClick={() => setKeysOpen(true)}>? keys</button></p>
                    </section>

                    <section aria-label="Submission" className="flex min-h-0 min-w-0 flex-col gap-3.5 px-4 py-4 md:border-r md:border-border max-md:border-b max-md:border-border">
                        {/* Below 1024px the waiting list is a picker over the work. */}
                        <select aria-label="Waiting" value={current.copyId} onChange={(e) => { announce.current = true; setCurrentId(e.target.value) }} className="nb-select w-full lg:hidden" data-size="sm">
                            {shown.map((r, i) => <option key={r.copyId} value={r.copyId}>{r.who} · {i + 1} of {shown.length}{r.late ? ' · Late' : ''}</option>)}
                        </select>
                        <div className="flex items-center gap-3 max-md:sticky max-md:top-0 max-md:z-10 max-md:flex-wrap max-md:bg-card max-md:py-2">
                            {(current.people ?? []).length > 1 ? (
                                <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                                    {current.people!.slice(0, 4).map((p) => <Avatar key={p.id} name={p.name} url={p.avatarUrl} size={28} />)}
                                    {current.people!.length > 4 ? <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted font-mono text-[11px]">+{current.people!.length - 4}</span> : null}
                                </span>
                            ) : <Avatar name={current.who} url={current.people?.[0]?.avatarUrl} size={32} />}
                            <div className="min-w-0 flex-1">
                                <h3 ref={headerRef} tabIndex={-1} className="truncate text-[15px] font-medium outline-none">{current.who}</h3>
                                <p className="truncate font-mono text-[11px] text-muted-foreground" title={current.title}>
                                    {[current.kind === 'task' ? current.title : current.title, `handed in ${ago(current.submittedAt)}`, current.version ? `Version ${current.version}` : null,
                                        current.submittedBy ? `by ${current.submittedBy}` : null, current.dueDate ? `due ${DAY.format(new Date(current.dueDate))}` : null].filter(Boolean).join(' · ')}
                                    {late ? <span className="text-destructive"> · {late}</span> : null}
                                    {current.left ? ' · Left the organization' : ''}
                                </p>
                                {viewers.length ? <p className="text-[11px] font-medium text-[var(--status-warning)]">{viewers[0]}{viewers.length > 1 ? ` and ${viewers.length - 1} more` : ''} {viewers.length > 1 ? 'are' : 'is'} looking at this</p> : null}
                            </div>
                            <ReviewDecision key={current.copyId} layout="bar" keys who={current.who} kind={current.kind} dueDate={current.dueDate} recentReasons={reasons} pending={false}
                                onApprove={(note) => decide(current, 'approve', undefined, null, note)} onReturn={(reason, fixBy) => decide(current, 'return', reason, fixBy)}
                                extra={(
                                    <DropdownMenu modal={false}>
                                        <DropdownMenuTrigger asChild>
                                            <Button type="button" size="sm" variant="outline" className="h-7 w-[30px] p-0" aria-label="More for this hand-in"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem asChild><a href={current.href}>Open the hand-in</a></DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => { copyOrSay(window.location.href, () => toast.success('Link copied.')) }}>Copy link</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )} />
                        </div>
                        {/* Their note, what was asked last time, and the steps: one quiet strip under the header. */}
                        <NoteStrip row={current} />
                        {current.link ? <LinkCard link={current.link} /> : null}
                        {/* Review UX 3.11: text keeps its line breaks and spacing. */}
                        {current.text ? <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2">{current.text}</p> : null}
                        {current.kind === 'task' && current.description ? <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-[13px]">{current.description}</p> : null}
                        <ReviewWork key={current.copyId} row={current} />
                        {!current.link && !current.text && !current.files.length && !current.versions.length && !(current.kind === 'task' && current.description) ? (
                            <div className="nb-empty-state flex-1 rounded-lg border border-dashed border-border py-12" role="status">
                                <h4 className="nb-empty-state-title">Nothing attached</h4>
                                <p className="nb-empty-state-desc">{current.kind === 'task' ? 'Marked as done.' : `${current.who} marked it done without a file, link or text.`}</p>
                            </div>
                        ) : null}
                    </section>

                    <div className="flex min-h-0 min-w-0 flex-col px-4 py-4">
                        <ReviewDiscussion key={current.copyId} row={current} restoreDraft={restore?.copyId === current.copyId ? restore : null} />
                    </div>
                </div>
            )}
            <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Not while you’re typing.</DialogDescription></DialogHeader>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                        {[['J', 'Next'], ['K', 'Previous'], ['A', 'Approve'], ['R', 'Return'], ['Esc', 'Back to the board'], ['?', 'These shortcuts']].map(([k, v]) => (
                            <div key={k} className="contents"><dt><kbd className="rounded-sm border border-border px-1.5 font-mono text-xs">{k}</kbd></dt><dd>{v}</dd></div>
                        ))}
                    </dl>
                </DialogContent>
            </Dialog>
        </section>
    )
}

/** §2, §4b.4: their note, "Asked last time", and Steps that open in place — one tinted strip. */
function NoteStrip({ row }: { row: ReviewQueueRow }) {
    const [open, setOpen] = useState(false)
    const done = row.steps.filter((s) => s.done).length
    if (!row.note && !row.lastAsk && !row.steps.length) return null
    return (
        <div className="space-y-2 rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {row.note ? <span className="min-w-0 flex-1 truncate" title={row.note}>Their note: “{row.note}”</span> : null}
                {row.lastAsk ? <span className="min-w-0 flex-1 truncate" title={row.lastAsk}>Asked last time: {row.lastAsk}</span> : null}
                {!row.note && !row.lastAsk ? <span className="flex-1" /> : null}
                {row.steps.length ? (
                    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="whitespace-nowrap font-medium text-foreground hover:underline">
                        Steps {done} of {row.steps.length} {open ? '▴' : '▾'}
                    </button>
                ) : null}
            </div>
            {open ? (
                <ul aria-label="Steps" className="space-y-0.5 text-[13px] text-foreground">
                    {row.steps.map((s, i) => <li key={`${i}-${s.title}`} className={cn(!s.done && 'text-muted-foreground')}><span aria-hidden="true">{s.done ? '☑' : '☐'}</span> {s.title}<span className="sr-only">{s.done ? ', ticked' : ', not ticked'}</span></li>)}
                </ul>
            ) : null}
        </div>
    )
}
