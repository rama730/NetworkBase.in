'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { BadgeCheck, Inbox, Lock, Scale, SlidersHorizontal, Users } from 'lucide-react'

import { inboxOrgsAction } from '@/app/actions/moderation-staff'
import { caseState, Deadline } from '@/components/trust/format'
import { useLive } from '@/components/trust/live'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { InboxCounts, InboxFilters, InboxItem, InboxView } from '@/lib/trust/inbox'
import { caseLabel, KIND_NOUN, REPORT_REASON_LABEL, type ReportTargetKind } from '@/lib/trust/rules'

// The Inbox list (R2, R9): one search, one Filter, quick views, grouped by time pressure, 72px rows.

export const itemKey = (i: Pick<InboxItem, 'type' | 'id' | 'number'>) => (i.type === 'verification' ? `org:${i.id}` : `${i.type}:${caseLabel(i.number ?? 0)}`)
const VIEWS: Array<{ id: InboxView; label: string; count?: (c: InboxCounts) => number }> = [
    { id: 'needs_me', label: 'Needs me' }, { id: 'unclaimed', label: 'Unclaimed', count: (c) => c.unclaimed }, { id: 'urgent', label: 'Urgent', count: (c) => c.urgent },
    { id: 'appeals', label: 'Appeals', count: (c) => c.appeals }, { id: 'org', label: 'Organization cases' }, { id: 'escalated', label: 'Needs an admin', count: (c) => c.escalated },
    { id: 'mine', label: 'Mine' }, { id: 'done', label: 'Done' },
]
const KINDS: ReportTargetKind[] = ['person', 'update', 'update_comment', 'chat_message', 'file', 'project', 'doc', 'task', 'task_comment', 'chat_channel', 'role', 'application', 'invitation', 'connection_request', 'contribution']
const TYPE_LABEL = (i: InboxItem) => (i.type === 'appeal' ? 'Appeal' : i.type === 'verification' ? 'Verification' : i.kind ? KIND_NOUN[i.kind].replace(/^./, (x) => x.toUpperCase()) : 'Case')

/** Overdue → Due within 1 hour → Today → Later (R2), from the server's clock. */
export function groupOf(i: InboxItem, now: number) {
    if (!i.due_at) return 'Later'
    const due = new Date(i.due_at).getTime()
    if (due < now) return 'Overdue'
    if (due < now + 3_600_000) return 'Due within 1 hour'
    const day = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t)
    return day(due) === day(now) ? 'Today' : 'Later'
}

type Props = {
    items: InboxItem[]; filters: InboxFilters; counts: InboxCounts | undefined; now: number; selected: string | null; checked: string[]; highlight: Set<string>
    loading: boolean; error: boolean; hasNext: boolean; loadingNext: boolean
    setFilters: (changes: Partial<InboxFilters>, replace?: boolean) => void; onSelect: (item: InboxItem) => void; onPrefetch: (item: InboxItem) => void
    onCheck: (item: InboxItem, range: boolean) => void; onClearChecked: () => void; onQuickDismiss: (item: InboxItem) => void; onBulk: (kind: 'dismiss' | 'hide') => void
    onRetry: () => void; onNext: () => void
}

export function InboxList(p: Props) {
    const { viewers, me } = useLive()
    const [q, setQ] = useState(p.filters.q ?? '')
    const view = p.filters.view ?? 'needs_me'
    const filtered = Boolean(p.filters.q || p.filters.severity || p.filters.kind || p.filters.source || p.filters.due || p.filters.org)
    const grouped = view !== 'done' && (p.filters.sort ?? 'due') === 'due'
    const sentinel = useRef<HTMLLIElement | null>(null)

    useEffect(() => {
        const t = window.setTimeout(() => { if ((p.filters.q ?? '') !== q) p.setFilters({ q: q || undefined }, true) }, 250)
        return () => window.clearTimeout(t)
    })
    // ponytail: a plain list with load-on-scroll; 72px rows stay smooth into the hundreds. Virtualize if waves pass ~2,000.
    useEffect(() => {
        const el = sentinel.current
        if (!el || !p.hasNext) return
        const io = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting && !p.loadingNext) p.onNext() }, { rootMargin: '400px' })
        io.observe(el)
        return () => io.disconnect()
    }, [p.hasNext, p.loadingNext, p])

    const today = [
        { label: 'Open', value: p.counts?.open, active: view === 'needs_me' && !filtered, go: () => p.setFilters({ view: 'needs_me', due: undefined, severity: undefined, kind: undefined, source: undefined, q: undefined }) },
        { label: 'Due within 1 hour', value: p.counts?.due_hour, active: p.filters.due === 'hour', go: () => p.setFilters({ view: 'needs_me', due: 'hour' }) },
        { label: 'Overdue', value: p.counts?.overdue, active: p.filters.due === 'overdue', tone: (p.counts?.overdue ?? 0) > 0 ? 'text-[var(--status-danger)]' : '', go: () => p.setFilters({ view: 'needs_me', due: 'overdue' }) },
        { label: 'Appeals', value: p.counts?.appeals, active: view === 'appeals', go: () => p.setFilters({ view: 'appeals', due: undefined }) },
    ]

    let lastGroup = ''
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="grid grid-cols-4 border-b border-border" role="group" aria-label="Today">
                {today.map((t) => (
                    <button key={t.label} type="button" onClick={t.go} aria-pressed={t.active} className={`px-2 py-2 text-left hover:bg-muted/50 ${t.active ? 'bg-secondary' : ''}`}>
                        <span className={`block font-mono text-[18px] font-semibold tabular-nums ${t.tone ?? ''}`}>{t.value ?? '–'}</span>
                        <span className="block text-[11px] leading-tight text-muted-foreground">{t.label}</span>
                    </button>
                ))}
            </div>
            <div className="space-y-2 border-b border-border px-2 py-2">
                <div className="flex gap-2">
                    <input id="inbox-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search NB-number, name or @handle" aria-label="Search the inbox"
                        className="h-8 min-w-0 flex-1 rounded-[5px] border border-input bg-card px-2.5 text-[13px]" />
                    <FilterMenu filters={p.filters} setFilters={p.setFilters} />
                </div>
                <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
                    {VIEWS.map((v) => {
                        const n = v.count && p.counts ? v.count(p.counts) : 0
                        return (
                            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => p.setFilters({ view: v.id, due: undefined })}
                                className={`rounded-[5px] px-2 py-1 text-[12px] font-medium ${view === v.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                                {v.label}{n ? <span className="ml-1 font-mono tabular-nums">{n}</span> : null}
                            </button>
                        )
                    })}
                </div>
            </div>
            {p.checked.length ? (
                <div role="toolbar" aria-label="Selected cases" className="flex items-center gap-2 border-b border-border bg-secondary px-2 py-1.5 text-[13px]">
                    <span className="font-medium">{p.checked.length} selected</span>
                    <Button size="sm" variant="outline" onClick={() => p.onBulk('dismiss')}>No rule broken</Button>
                    <Button size="sm" variant="outline" onClick={() => p.onBulk('hide')}>Hide</Button>
                    <button type="button" className="ml-auto text-[12px] underline underline-offset-4" onClick={p.onClearChecked}>Clear</button>
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto" data-scroll-root="inbox-list" data-scroll-memory="inbox-list">
                {p.error ? (
                    <p className="p-4 text-[13px]">Couldn’t load · <button type="button" className="underline underline-offset-4" onClick={p.onRetry}>Retry</button></p>
                ) : p.loading ? (
                    <ul aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <li key={i} className="flex h-[72px] items-center gap-3 border-b border-border px-3"><Skeleton kind="tile" className="size-9 rounded-[6px]" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></li>)}</ul>
                ) : !p.items.length ? (
                    filtered
                        ? <EmptyState icon={Inbox} className="mt-8" title="Nothing matches" description={<button type="button" className="underline underline-offset-4" onClick={() => { setQ(''); p.setFilters({ q: undefined, severity: undefined, kind: undefined, source: undefined, due: undefined, org: undefined }) }}>Clear filters</button>} />
                        : <EmptyState icon={Inbox} className="mt-8" title={view === 'done' ? 'Nothing decided yet' : 'Inbox zero'} description={view === 'done' ? undefined : 'New reports land here; urgent ones also email and push you.'} />
                ) : (
                    <ul aria-label="Cases">
                        {p.items.map((i) => {
                            const key = itemKey(i)
                            const group = grouped ? groupOf(i, p.now) : ''
                            const header = group !== lastGroup ? group : null
                            lastGroup = group
                            const watchers = viewers.filter((v) => v.caseId === i.id && v.staffId !== me)
                            const reviewer = i.claimer_name ?? watchers.find((w) => w.mode === 'deciding')?.name ?? null
                            return [
                                header ? <li key={`g:${header}`} className={`sticky top-0 z-[1] bg-background px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide ${header === 'Overdue' ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>{header}</li> : null,
                                <Row key={key} item={i} selected={p.selected === key} checked={p.checked.includes(i.id)} anyChecked={p.checked.length > 0} highlight={p.highlight.has(i.id)} now={p.now}
                                    reviewer={i.claimer_id === me ? 'You' : reviewer} reviewerId={i.claimer_id} watching={watchers.length}
                                    onSelect={(e) => (e.shiftKey && i.type === 'case' ? p.onCheck(i, true) : e.metaKey || e.ctrlKey ? p.onCheck(i, false) : p.onSelect(i))}
                                    onCheck={() => p.onCheck(i, false)} onPrefetch={() => p.onPrefetch(i)} onDismiss={() => p.onQuickDismiss(i)} />,
                            ]
                        })}
                        {p.hasNext ? <li ref={sentinel} className="p-3 text-center"><Button pending={p.loadingNext} pendingLabel="Loading" size="sm" variant="ghost" disabled={p.loadingNext} onClick={p.onNext}>{'Load more'}</Button></li> : null}
                    </ul>
                )}
            </div>
        </div>
    )
}

function Row({ item: i, selected, checked, anyChecked, highlight, now, reviewer, reviewerId, watching, onSelect, onCheck, onPrefetch, onDismiss }: {
    item: InboxItem; selected: boolean; checked: boolean; anyChecked: boolean; highlight: boolean; now: number; reviewer: string | null; reviewerId: string | null; watching: number
    onSelect: (e: MouseEvent) => void; onCheck: () => void; onPrefetch: () => void; onDismiss: () => void
}) {
    const open = i.state === 'open' || i.state === 'in_review' || i.state === 'pending'
    const quick = i.type === 'case' && open && (!reviewer || reviewer === 'You')
    const name = i.subject_name ?? (i.subject_username ? `@${i.subject_username}` : i.type === 'verification' ? i.label ?? 'Organization' : 'No account')
    return (
        <li className={`group relative flex h-[72px] items-center gap-3 border-b border-border px-3 transition-colors ${selected ? 'bg-secondary' : 'hover:bg-muted/50'} ${highlight ? 'animate-pulse bg-[var(--status-info-soft)]' : ''}`}
            data-key={itemKey(i)} onMouseEnter={onPrefetch}>
            {i.type === 'case' && (anyChecked || checked) ? <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${caseLabel(i.number ?? 0)}`} className="relative z-[1]" /> : null}
            <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined} className="absolute inset-0" aria-label={`${TYPE_LABEL(i)} ${i.number ? caseLabel(i.number) : ''} · ${name}`} />
            {i.type === 'verification' ? <BadgeCheck className="size-9 shrink-0 text-muted-foreground" aria-hidden="true" />
                : <UserAvatar identity={{ id: i.subject_id ?? i.id, fullName: i.subject_name, username: i.subject_username, avatarUrl: i.subject_avatar }} size={36} roundedClassName="rounded-[6px]" />}
            <div className="pointer-events-none min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13px]">
                    {i.severity === 'urgent' ? <span className="size-2 shrink-0 rounded-full bg-[var(--status-danger)]" aria-label="Urgent" /> : i.severity === 'high' ? <span className="size-2 shrink-0 rounded-full bg-[var(--status-warning)]" aria-label="High" /> : null}
                    <span className="truncate font-medium">{name}</span>
                    {i.pile_on ? <Users className="size-3.5 shrink-0 text-[var(--status-warning)]" aria-label="Possible pile-on" /> : null}
                    {i.blocked_rise ? <span className="shrink-0 text-[11px] text-[var(--status-warning)]" title="Blocked by many people recently">Blocked by many recently</span> : null}
                    {i.legal_hold ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Legal hold" /> : null}
                    {i.type === 'appeal' ? <Scale className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">{TYPE_LABEL(i)}{i.reason && i.type === 'case' ? ` · ${REPORT_REASON_LABEL[i.reason]}` : ''}{i.reports > 1 ? ` · ${i.reports} reports` : ''}{i.escalated ? ' · needs an admin' : ''}{i.assigned_name ? ` · for ${i.assigned_name}` : ''}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {i.number ? <span className="font-mono tabular-nums">{caseLabel(i.number)}</span> : null}
                    {reviewer ? <span className="flex items-center gap-1 text-foreground">{reviewerId ? <UserAvatar identity={{ id: reviewerId, fullName: reviewer }} size={14} roundedClassName="rounded-full" /> : null}{reviewer} reviewing</span>
                        : watching ? <span>{watching} viewing</span> : null}
                </div>
            </div>
            <div className="pointer-events-none flex shrink-0 flex-col items-end gap-1">
                {open ? <Deadline at={i.due_at} openedAt={i.created_at} now={now} /> : null}
                <span className="text-[11px] text-muted-foreground">{i.type === 'verification' ? 'Waiting' : i.type === 'appeal'
                    ? (open ? (i.claimer_id ? 'In review' : 'Appealed') : caseState({ state: 'decided', appeal_state: i.state, decided_at: i.decided_at }, now))
                    : caseState({ state: i.state, outcome: i.outcome, decided_at: i.decided_at, leased: Boolean(i.claimer_id) }, now)}</span>
                {quick ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onDismiss() }}
                        className="pointer-events-auto relative z-[1] hidden rounded-[4px] border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium group-hover:block group-focus-within:block">
                        No rule broken
                    </button>
                ) : null}
            </div>
        </li>
    )
}

function FilterMenu({ filters, setFilters }: { filters: InboxFilters; setFilters: Props['setFilters'] }) {
    const [open, setOpen] = useState(false)
    const orgs = useQuery({ queryKey: ['trust', 'orgs'], queryFn: inboxOrgsAction, enabled: open, staleTime: 60_000 })
    const n = [filters.severity, filters.kind, filters.source, filters.org, filters.sort && filters.sort !== 'due' ? filters.sort : undefined].filter(Boolean).length
    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="Filter"><SlidersHorizontal aria-hidden="true" />{n ? <span className="font-mono tabular-nums">{n}</span> : 'Filter'}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[70vh] w-56 overflow-y-auto">
                <DropdownMenuLabel>Severity</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filters.severity ?? ''} onValueChange={(v) => setFilters({ severity: (v || undefined) as InboxFilters['severity'] })}>
                    {[['', 'Any'], ['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal']].map(([v, l]) => <DropdownMenuRadioItem key={v} value={v!}>{l}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Source</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filters.source ?? ''} onValueChange={(v) => setFilters({ source: v || undefined })}>
                    {[['', 'Any'], ['report', 'User reports'], ['email', 'Email'], ['legal', 'Legal'], ['staff', 'Staff']].map(([v, l]) => <DropdownMenuRadioItem key={v} value={v!}>{l}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Sort</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filters.sort ?? 'due'} onValueChange={(v) => setFilters({ sort: v === 'due' ? undefined : (v as InboxFilters['sort']) })}>
                    {[['due', 'Due first'], ['newest', 'Newest'], ['reports', 'Most reports']].map(([v, l]) => <DropdownMenuRadioItem key={v} value={v!}>{l}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
                {orgs.data?.length ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Organization</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={filters.org ?? ''} onValueChange={(v) => setFilters({ org: v || undefined })}>
                            <DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem>
                            {orgs.data.map((o) => <DropdownMenuRadioItem key={o.id} value={o.id}>{o.title}</DropdownMenuRadioItem>)}
                        </DropdownMenuRadioGroup>
                    </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Type</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filters.kind ?? ''} onValueChange={(v) => setFilters({ kind: (v || undefined) as ReportTargetKind | undefined })}>
                    <DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem>
                    {KINDS.map((k) => <DropdownMenuRadioItem key={k} value={k}>{KIND_NOUN[k].replace(/^./, (x) => x.toUpperCase())}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

