'use client'
import { TabMarker } from "@/components/ui/TabMarker";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, MoreHorizontal, Plus, Search, FolderKanban, SearchX } from 'lucide-react'

import { readMyMovableWorkspacesAction, readOrgWorkspacesAction, remindLeadsAction, type OrgWorkspaceRow } from '@/app/actions/org-dashboard'
import { approveMoveInAction, archiveChildAction, assignChildLeadAction, cancelDetachRequestAction, cancelMoveInAction, detachChildAction, moveWorkspaceToOrgAction, readLeadCandidatesAction, unarchiveChildAction } from '@/app/actions/organizations'
import type { OrgWorkspaceRequest } from '@/lib/organizations/needs-you'
import { attentionItems, reasonCounts, workspacesSummary, type AttentionItem, type AttentionKind } from '@/lib/organizations/workspace-attention'
import { messageUserInWindow } from '@/components/messages/message-user'
import WorkspaceCard from '@/components/workspaces/WorkspaceCard'
import WorkspaceCardSkeleton from '@/components/workspaces/WorkspaceCardSkeleton'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { WorkspaceLastUpdate } from '@/components/workspaces/WorkspaceLastUpdate'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useUserFollowedWorkspaces } from '@/hooks/workspaces/useUserInteractions'
import { useMyApplicationStates } from '@/hooks/workspaces/useMyApplicationStates'
import { toast } from '@/lib/feedback'
import { remindSummary } from '@/lib/organizations/member-rules'
import { serverFirst } from '@/lib/server-first'
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast'
import { liveTopics } from '@/lib/realtime/subscriptions'
import { queryKeys } from '@/lib/query-keys'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { formatDistanceToNow } from '@/lib/utils/date'
import type { Workspace } from '@/types/discover'
import { cn } from '@/lib/utils'
import { DialogFooter } from '@/components/ui/dialog'
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { EmptyState as SharedEmpty } from '@/components/ui/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { Notice } from '@/components/ui/notice'
import { UnderlineTabs } from '@/components/ui/UnderlineTabs'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { StatusBadge } from '@/components/organizations/org-ui'
import { fieldLabel, formatOrgDate, visibilityLabel, withCount } from '@/lib/organizations/display'

// Workspaces report (docs/superpowers/plans/2026-11-04-org-workspaces-tab-findings.md): requests as one line, a status
// bar with counts, one 30px toolbar ending in New workspace, Discover's own card full width with the organization's
// part inside it, a List for bulk work, every state, and the place kept in the link.

type Data = Extract<Awaited<ReturnType<typeof readOrgWorkspacesAction>>, { success: true }>
type Row = OrgWorkspaceRow
type Tab = 'all' | 'attention' | 'archived' | 'mine'
type Sort = 'attention' | 'active' | 'name' | 'overdue' | 'newest'

/** The tab's place in the link (G3), prefixed so the board's and Members' own keys never collide. */
const KEYS = ['wq', 'ws', 'wr', 'wsort', 'wview', 'wvis', 'wstage', 'wlead', 'wsprint', 'wseats', 'wmine', 'wnew'] as const
type Place = Record<(typeof KEYS)[number], string | null>
const PAGE = 20
const SORTS: ReadonlyArray<[Sort, string]> = [['attention', 'Needs attention first'], ['active', 'Recently active'], ['name', 'Name'], ['overdue', 'Most overdue'], ['newest', 'Newest']]
const REASONS: ReadonlyArray<[AttentionKind, string]> = [['overdue', 'Overdue'], ['quiet', 'Quiet 7 days'], ['lead', 'Needs a workspace lead'], ['group', 'Group work']]
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
const visWord = (v: string | null) => visibilityLabel(v)
const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })
const shortDay = (iso: string) => formatOrgDate(iso, { month: 'short', day: 'numeric' })

function usePlace() {
    const read = (): Place => {
        const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
        return Object.fromEntries(KEYS.map((k) => [k, params.get(k)])) as Place
    }
    const [place, setPlace] = useState<Place>(read)
    const go = useCallback((next: Partial<Place>) => setPlace((cur) => {
        const merged = { ...cur, ...next }
        const url = new URL(window.location.href)
        for (const k of KEYS) { if (merged[k]) url.searchParams.set(k, merged[k]!); else url.searchParams.delete(k) }
        window.history.replaceState(window.history.state, '', url)
        return merged
    }), [])
    return { place, go }
}

/** Discover's card reads a `Workspace`; this is the organization's row in that shape (G1). */
function toCard(r: Row): Workspace {
    return {
        id: r.id, title: r.title, slug: r.slug ?? undefined, status: r.status === 'archived' ? 'archived' : 'active',
        shortDescription: r.status === 'archived' && r.archivedBy ? `Archived by ${r.archivedBy.name}${r.archivedBy.at ? ` · ${shortDay(r.archivedBy.at)}` : ''}` : r.description,
        description: null, coverImage: r.coverImage, skills: r.skills, visibility: r.visibility ?? undefined,
        viewCount: r.views, followersCount: r.followers, ownerId: r.lead?.id, githubRepoUrl: r.githubRepoUrl, externalLinks: r.externalLinks,
        collaborators: r.people.map((p) => ({ userId: p.id, membershipRole: 'member', user: { id: p.id, username: p.username, fullName: p.name, avatarUrl: p.avatarUrl } })),
        collaboratorsCount: r.members, openRoles: [], openRolesCount: 0,
    } as unknown as Workspace
}

export function OrgWorkspacesTab({ orgId, orgSlug, started = null }: { orgId: string; orgSlug?: string | null; started?: ReturnType<typeof readOrgWorkspacesAction> | null }) {
    const client = useQueryClient()
    const queryKey = useMemo(() => ['org-workspaces', orgId], [orgId])
    const [read] = useState(() => serverFirst(started, () => readOrgWorkspacesAction(orgId)))
    const query = useQuery({ queryKey, queryFn: read, refetchOnWindowFocus: true, refetchInterval: 120_000 })
    const data = query.data?.success ? query.data : null
    const reload = useCallback(() => {
        void client.invalidateQueries({ queryKey })
        // Accept, archive, detach: the left navigation's Workspaces change too (sidebar report G1).
        void client.invalidateQueries({ queryKey: queryKeys.profile.sidebarWorkspacesRoot() })
        // F3: the Overview's request count and workspace rows move at the same time.
        void client.invalidateQueries({ queryKey: ['org-dashboard', queryKey[1]] })
        // "Updated by" moves with the rows (G15).
        for (const r of (client.getQueryData<Awaited<ReturnType<typeof readOrgWorkspacesAction>>>(queryKey) as Data | undefined)?.rows ?? []) {
            void client.invalidateQueries({ queryKey: queryKeys.project.detail.lastUpdate(r.id) })
        }
    }, [client, queryKey])
    // G15: other people's changes show by themselves; bursts combine over 2 seconds (as the Overview does).
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null
        // Audit 5.2, N42: jittered, and not on the org's view or follower counts.
        const later = () => { if (!timer) timer = setTimeout(() => { timer = null; reload() }, 2_000 + Math.random() * 3_000) }
        const subs = [subscribeBroadcast(liveTopics.tasks(orgId), later)]
        return () => { subs.forEach((s) => s.unsubscribe()); if (timer) clearTimeout(timer) }
    }, [orgId, reload])

    if (query.isPending) return <TabLoading />
    if (!data) {
        return <div className="mx-auto w-full max-w-[1200px]"><ErrorNotice what="Workspaces" onRetry={() => void query.refetch()} /></div>
    }
    return <WorkspacesView orgId={orgId} orgSlug={orgSlug ?? null} data={data} reload={reload} />
}

/** §5 Loading: the header at once with dashes, three skeletons at the card's height. */
function TabLoading() {
    return (
        <div className="mx-auto w-full max-w-[1200px] space-y-3" aria-busy="true">
            <div className="flex min-h-11 items-end gap-5 border-b border-border text-[13px] text-muted-foreground" aria-hidden="true"><span className="pb-3">All</span><span className="pb-3">Needs attention</span></div>
            <div className="nb-skeleton h-7 rounded-md" aria-hidden="true" />
            <div role="status" className="flex flex-col gap-3"><span className="sr-only">Loading workspaces</span>{[0, 1, 2].map((i) => <WorkspaceCardSkeleton key={i} />)}</div>
        </div>
    )
}

function WorkspacesView({ orgId, orgSlug, data, reload }: { orgId: string; orgSlug: string | null; data: Data; reload: () => void }) {
    const { user } = useAuth()
    const { place, go } = usePlace()
    const phone = useMediaQuery('(max-width: 767px)')
    const isAdmin = data.isAdmin
    const canAct = isAdmin && !data.orgArchived
    const base = `/org/${encodeURIComponent(orgSlug ?? orgId)}`
    const href = (r: Row) => `/workspaces/${encodeURIComponent(r.slug ?? r.id)}`
    const summary = useMemo(() => workspacesSummary(data.rows, isAdmin), [data.rows, isAdmin])

    // What the link asks for, checked against what this viewer may see.
    const tabs: Tab[] = isAdmin ? ['all', 'attention', 'archived'] : ['mine', 'all']
    const tab: Tab = tabs.includes(place.ws as Tab) ? (place.ws as Tab) : isAdmin ? 'all' : summary.mine ? 'mine' : 'all'
    const reason = tab === 'attention' && REASONS.some(([k]) => k === place.wr) ? (place.wr as AttentionKind) : null
    const sort: Sort = SORTS.some(([k]) => k === place.wsort) && (isAdmin || place.wsort !== 'attention') ? (place.wsort as Sort) : isAdmin ? 'attention' : 'active'
    const layout = phone ? 'cards' : place.wview === 'list' ? 'list' : 'cards'
    const q = place.wq ?? ''
    const vis = place.wvis ?? 'all', stage = place.wstage ?? 'all', lead = place.wlead ?? 'all', sprint = place.wsprint ?? 'all'
    const seats = place.wseats === '1', mine = isAdmin && place.wmine === '1'

    const [shown, setShown] = useState(PAGE)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const lastPicked = useRef<string | null>(null)
    const [ask, setAsk] = useState<{ kind: 'archive' | 'detach'; rows: Row[] } | null>(null)
    const [reminding, setReminding] = useState<Row[] | null>(null)
    const [assigning, setAssigning] = useState<Row | null>(null)
    const [requestsOpen, setRequestsOpen] = useState(false)
    const [asking, setAsking] = useState(false)
    const [reminded, setReminded] = useState<Record<string, string>>({})
    const [highlight, setHighlight] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const searchRef = useRef<HTMLInputElement>(null)

    const items = useMemo(() => new Map(data.rows.map((r) => [r.id, isAdmin ? attentionItems(r) : []])), [data.rows, isAdmin])
    const inTab = useMemo(() => data.rows.filter((r) => (tab === 'archived' ? r.status === 'archived' : r.status !== 'archived')
        && (tab !== 'attention' || (items.get(r.id)?.length ?? 0) > 0) && (tab !== 'mine' || r.mine)), [data.rows, items, tab])
    const reasons = useMemo(() => reasonCounts(inTab), [inTab])
    const rows = useMemo(() => {
        const needle = q.trim().toLowerCase()
        const out = inTab.filter((r) =>
            (!needle || r.title.toLowerCase().includes(needle) || r.lead?.name.toLowerCase().includes(needle) || r.description?.toLowerCase().includes(needle))
            && (!reason || items.get(r.id)!.some((i) => i.kind === reason))
            && (vis === 'all' || r.visibility === vis) && (stage === 'all' || r.stage === stage) && (lead === 'all' || r.lead?.id === lead)
            && (sprint === 'all' || (sprint === 'linked' ? Boolean(r.sprint?.inOrgSprint) : !r.sprint?.inOrgSprint))
            && (!seats || r.openSeats > 0) && (!mine || r.mine))
        const by = (a: Row, b: Row) => sort === 'name' ? a.title.localeCompare(b.title)
            : sort === 'overdue' ? b.overdue - a.overdue || b.lastActivityAt.localeCompare(a.lastActivityAt)
                : sort === 'newest' ? b.addedAt.localeCompare(a.addedAt)
                    : sort === 'attention' ? (items.get(b.id)!.length - items.get(a.id)!.length) || b.lastActivityAt.localeCompare(a.lastActivityAt)
                        : b.lastActivityAt.localeCompare(a.lastActivityAt)
        // Members see their own first (report §35.5); the workspace just made sits on top while it's highlighted (F2).
        return out.sort((a, b) => Number(b.id === highlight) - Number(a.id === highlight) || (isAdmin ? 0 : Number(b.mine) - Number(a.mine)) || by(a, b))
    }, [highlight, inTab, isAdmin, items, lead, mine, q, reason, seats, sort, sprint, stage, vis])
    const page = rows.slice(0, shown)
    const narrowed = Boolean(q.trim() || reason || vis !== 'all' || stage !== 'all' || lead !== 'all' || sprint !== 'all' || seats || mine)
    const filtersOn = [vis, stage, lead, sprint].filter((v) => v !== 'all').length + (seats ? 1 : 0)
    const stages = useMemo(() => [...new Set(data.rows.map((r) => r.stage).filter((s): s is string => Boolean(s)))].sort(), [data.rows])
    const leads = useMemo(() => [...new Map(data.rows.flatMap((r) => (r.lead ? [[r.lead.id, r.lead.name] as const] : []))).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data.rows])
    const clear = () => go({ wq: null, wr: null, wvis: null, wstage: null, wlead: null, wsprint: null, wseats: null, wmine: null })
    useEffect(() => { setShown(PAGE) }, [tab, q, reason, vis, stage, lead, sprint, seats, mine, sort])

    // Discover's follow bells and the viewer's own applications, one lookup for the page.
    const pageIds = useMemo(() => [page.map((r) => r.id)], [page])
    const followed = useUserFollowedWorkspaces(user?.id, pageIds)
    const applications = useMyApplicationStates(user?.id, pageIds)
    const cards = useMemo(() => new Map(data.rows.map((r) => [r.id, toCard(r)])), [data.rows])

    // F2: back from the wizard, the new card is on top with a 2-second highlight.
    useEffect(() => {
        const id = place.wnew
        if (!id || !data.rows.some((r) => r.id === id)) return
        setHighlight(id)
        go({ wnew: null })
        requestAnimationFrame(() => document.querySelector(`[data-workspace-row="${id}"]`)?.scrollIntoView({ block: 'nearest' }))
        const t = setTimeout(() => setHighlight(null), 2_000)
        return () => clearTimeout(t)
    }, [data.rows, go, place.wnew])

    // G6: "/" goes to Search; Esc clears the selection (Search clears itself).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
            if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) { event.preventDefault(); searchRef.current?.focus() }
            if (event.key === 'Escape' && !typing && !target?.closest?.('[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"]')) setSelected(new Set())
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const remindedAt = (r: Row) => reminded[r.id] ?? r.remindedAt
    const remind = (ids: string[], note: string) => startTransition(async () => {
        const res = await remindLeadsAction(orgId, ids, note)
        if (!res.success) return void toast.error(res.error)
        toast.success(remindSummary(res))
        const now = new Date().toISOString()
        setReminded((cur) => ({ ...cur, ...Object.fromEntries(res.ids.map((id) => [id, now])) }))
        setSelected(new Set())
        setReminding(null)
    })
    const unarchive = (r: Row) => startTransition(async () => {
        const res = await unarchiveChildAction(r.id)
        if (!res.success) return void toast.error(res.error)
        toast.success(`${r.title} is open again`)
        reload()
    })
    const pick = (r: Row, on: boolean, range: boolean) => setSelected((cur) => {
        const next = new Set(cur)
        const ids = page.map((p) => p.id)
        const from = lastPicked.current ? ids.indexOf(lastPicked.current) : -1
        const to = ids.indexOf(r.id)
        for (const id of range && from >= 0 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [r.id]) { if (on) next.add(id); else next.delete(id) }
        lastPicked.current = r.id
        return next
    })
    const picked = data.rows.filter((r) => selected.has(r.id))

    const fix = (r: Row, i: AttentionItem) => {
        const link = 'nb-link relative z-10'
        if (i.action === 'board') return <Link href={`${href(r)}?tab=tasks`} className={link}>{i.actionLabel}</Link>
        if (i.action === 'assignment' && r.groupCopyIds?.masterId) return <Link href={`${base}?tab=tasks&drawerType=task&drawerId=${r.groupCopyIds.masterId}`} className={link}>{i.actionLabel}</Link>
        if (i.action === 'review' && r.groupCopyIds) return <Link href={`${base}?tab=tasks&taskScope=review&review=${r.groupCopyIds.copyId}`} className={link}>{i.actionLabel}</Link>
        if (!canAct) return null
        if (i.action === 'assign') return <button type="button" className={link} onClick={() => setAssigning(r)}>{i.actionLabel}</button>
        if (i.action === 'remind') {
            const at = remindedAt(r)
            return at ? <span className="relative z-10 text-muted-foreground">Reminded {ago(at)}</span> : <button type="button" className={link} disabled={pending} onClick={() => setReminding([r])}>{i.actionLabel}</button>
        }
        return null
    }
    const health = (r: Row) => (
        <span className="flex shrink-0 flex-wrap items-center gap-1" role="group" aria-label={`Health: ${r.open} open, ${r.overdue} overdue, ${r.inReview} in review`}>
            {/* Counts are metadata, not tags (spec §10). */}
            <span className="nb-meta tabular-nums">{r.open} open · <span className={r.overdue > 0 ? 'text-destructive' : undefined}>{r.overdue} overdue</span> · {r.inReview} in review</span>
        </span>
    )
    const orgLine = (r: Row) => [r.lead ? `Lead ${r.lead.name}` : null, r.stage, r.sprint?.name].filter(Boolean).join(' · ')
    const attentionLine = (r: Row) => {
        const list = items.get(r.id) ?? []
        return list.length ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-[var(--status-warning)]" data-testid="attention-line">
                <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                {list.map((i, n) => <span key={`${i.kind}-${n}`} className="inline-flex items-center gap-1">{i.label} · {fix(r, i)}</span>)}
            </p>
        ) : null
    }
    const seatsLink = (r: Row) => {
        if (r.openSeats <= 0 || r.status === 'archived') return null
        const applied = applications.get(r.id)
        return (
            <Link href={`${href(r)}?tab=dashboard#teams`} className="nb-link relative z-10 text-[12px]">
                {r.openSeats} open {r.openSeats === 1 ? 'seat' : 'seats'}{isAdmin || r.mine || applied ? '' : ' · Apply'}
            </Link>
        )
    }
    const messageLead = (r: Row) => !isAdmin && r.lead && r.lead.id !== user?.id
        ? <Link href={`/messages?userId=${r.lead.id}`} onClick={(e) => messageUserInWindow(r.lead!.id, e)} className="nb-link relative z-10 px-1 text-[12px]">Message workspace lead</Link> : null
    const menu = (r: Row) => !canAct ? null : r.status === 'archived' ? <>
        <DropdownMenuItem onSelect={() => unarchive(r)}>Unarchive</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAsk({ kind: 'detach', rows: [r] })} className="text-destructive">Detach</DropdownMenuItem>
    </> : <>
        <DropdownMenuItem disabled={Boolean(remindedAt(r))} onSelect={() => setReminding([r])}>{remindedAt(r) ? `Reminded ${ago(remindedAt(r)!)}` : 'Remind workspace lead'}</DropdownMenuItem>
        {r.needsLead ? <DropdownMenuItem onSelect={() => setAssigning(r)}>Assign workspace lead</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => setAsk({ kind: 'archive', rows: [r] })}>Archive</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAsk({ kind: 'detach', rows: [r] })} className="text-destructive">Detach</DropdownMenuItem>
    </>
    const titleChip = (r: Row) => <>
        {r.newInOrg ? <StatusBadge state="new">New</StatusBadge> : null}
        {r.status === 'archived' ? <StatusBadge state="archived">Archived</StatusBadge> : <span className="nb-meta shrink-0">{visWord(r.visibility)}</span>}
    </>

    const statusTabs = tabs.map((t) => ({
        key: t,
        label: t === 'all' ? 'All' : t === 'mine' ? 'Mine' : t === 'attention' ? 'Needs attention' : 'Archived',
        count: t === 'all' ? summary.total : t === 'mine' ? summary.mine : t === 'attention' ? summary.attention : summary.archived,
        warn: t === 'attention',
    }))

    const newButton = (label: string, className?: string) => data.canCreate
        ? <Button asChild size="sm" variant="outline" className={cn('gap-1', className)}><Link href={`/workspaces/new?org=${encodeURIComponent(orgSlug ?? orgId)}`}><Plus className="size-3.5" aria-hidden="true" />{label}</Link></Button>
        : data.canAsk ? <Button type="button" size="sm" variant="outline" className={className} onClick={() => setAsking(true)}>Ask to add a workspace</Button> : null

    return (
        <div className="mx-auto w-full max-w-[1200px] space-y-3" data-testid="org-workspaces">
            {data.orgArchived ? <Notice>This organization is archived. Workspaces are read-only.</Notice> : null}

            {/* §1.1 Requests: one quiet line; Review opens the side panel. */}
            {canAct && data.requests.length ? (
                <div data-testid="requests-line"><Notice tone="info" action={<Button type="button" size="sm" variant="outline" onClick={() => setRequestsOpen(true)}>Review</Button>}>
                    {data.requests.length} {data.requests.length === 1 ? 'workspace asked' : 'workspaces asked'} to join or leave.
                </Notice></div>
            ) : null}

            {/* §1.2 Status bar. */}
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-border">
                <UnderlineTabs label="Workspaces by status" idPrefix="ws" controls={false} className="w-auto min-w-0 max-w-full overflow-x-auto border-b-0" value={tab}
                    onChange={(next) => go({ ws: next, wr: null })} tabs={statusTabs.map((t) => ({ key: t.key, label: t.label, count: t.count, warn: t.warn }))} />
                {isAdmin && data.summary.notInProject > 0 ? (
                    <p className="pb-3 text-[12px] text-muted-foreground">
                        {data.summary.notInProject === 1 ? '1 person isn’t' : `${data.summary.notInProject} people aren’t`} in a workspace · <Link href={`${base}?tab=members&mproject=none`} className="nb-link">Place them</Link>
                    </p>
                ) : null}
            </div>
            {tab === 'attention' ? (
                <div role="group" aria-label="Reasons" className="flex flex-wrap gap-1.5">
                    {REASONS.map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={reason === k} onClick={() => go({ wr: reason === k ? null : k })} className="nb-tag">
                            {label}<span className="tabular-nums">{reasons[k]}</span>
                        </button>
                    ))}
                </div>
            ) : null}

            {/* §1.3 Toolbar, or the selection bar in its place (List). */}
            {layout === 'list' && canAct && picked.length ? (
                <div role="toolbar" aria-label="Selected workspaces" className="flex min-h-[var(--ui-control-height-sm)] flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-medium">{picked.length} selected</span>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setReminding(picked.filter((r) => r.status !== 'archived'))}>Remind workspace {picked.length === 1 ? 'lead' : 'leads'}</Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending || !picked.some((r) => r.status !== 'archived')} onClick={() => setAsk({ kind: 'archive', rows: picked.filter((r) => r.status !== 'archived') })}>Archive</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
            ) : (
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                    <div className="flex items-center gap-2 lg:contents">
                        <div className="relative flex min-w-0 flex-1 items-center lg:order-1 lg:w-[180px] lg:flex-none xl:w-[220px]">
                            <Search aria-hidden="true" className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
                            <input ref={searchRef} type="search" value={q} onChange={(e) => go({ wq: e.target.value || null })}
                                onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); go({ wq: null }) } }}
                                placeholder="Search workspaces" aria-label="Search workspaces" aria-keyshortcuts="/"
                                className="h-[var(--ui-control-height-sm)] w-full rounded-md border border-input bg-card pl-7 pr-2 text-[13px] outline-none placeholder:text-muted-foreground" />
                        </div>
                        {newButton('New workspace', 'hidden shrink-0 md:inline-flex lg:order-3 lg:ml-auto')}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:order-2">
                        <select aria-label="Sort" className="nb-select" data-size="sm" value={sort} onChange={(e) => go({ wsort: e.target.value })}>
                            {SORTS.filter(([k]) => isAdmin || k !== 'attention').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                        {isAdmin ? <Button type="button" size="sm" variant="outline" aria-pressed={mine} onClick={() => go({ wmine: mine ? null : '1' })} className="aria-pressed:bg-muted aria-pressed:text-foreground">Mine</Button> : null}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="outline" className={filtersOn ? 'bg-muted text-foreground' : undefined}>Filters{filtersOn ? ` · ${filtersOn}` : ''}</Button></DropdownMenuTrigger>
                            {/* Menus, not native selects inside a menu (spec §10). */}
                            <DropdownMenuContent align="start" className="max-h-[70dvh] w-64 overflow-y-auto">
                                <DropdownMenuLabel>Visibility</DropdownMenuLabel>
                                <DropdownMenuRadioGroup value={vis} onValueChange={(v) => go({ wvis: v === 'all' ? null : v })}>
                                    <DropdownMenuRadioItem value="all">Any visibility</DropdownMenuRadioItem>
                                    {(['org', 'private', 'public'] as const).map((v) => <DropdownMenuRadioItem key={v} value={v}>{visibilityLabel(v)}</DropdownMenuRadioItem>)}
                                </DropdownMenuRadioGroup>
                                {stages.length ? <>
                                    <DropdownMenuSeparator /><DropdownMenuLabel>Stage</DropdownMenuLabel>
                                    <DropdownMenuRadioGroup value={stage} onValueChange={(v) => go({ wstage: v === 'all' ? null : v })}>
                                        <DropdownMenuRadioItem value="all">Any stage</DropdownMenuRadioItem>
                                        {stages.map((st) => <DropdownMenuRadioItem key={st} value={st}>{st}</DropdownMenuRadioItem>)}
                                    </DropdownMenuRadioGroup>
                                </> : null}
                                <DropdownMenuSeparator /><DropdownMenuLabel>Workspace lead</DropdownMenuLabel>
                                <DropdownMenuRadioGroup value={lead} onValueChange={(v) => go({ wlead: v === 'all' ? null : v })}>
                                    <DropdownMenuRadioItem value="all">Any workspace lead</DropdownMenuRadioItem>
                                    {leads.map(([id, name]) => <DropdownMenuRadioItem key={id} value={id}>{name}</DropdownMenuRadioItem>)}
                                </DropdownMenuRadioGroup>
                                <DropdownMenuSeparator /><DropdownMenuLabel>Sprint</DropdownMenuLabel>
                                <DropdownMenuRadioGroup value={sprint} onValueChange={(v) => go({ wsprint: v === 'all' ? null : v })}>
                                    <DropdownMenuRadioItem value="all">Any sprint</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="linked">Inside the organization sprint</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="not_linked">Not inside one</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuCheckboxItem checked={seats} onCheckedChange={(on) => go({ wseats: on ? '1' : null })}>Has open seats</DropdownMenuCheckboxItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {filtersOn ? <Button type="button" size="sm" variant="ghost" onClick={() => go({ wvis: null, wstage: null, wlead: null, wsprint: null, wseats: null })}>Clear</Button> : null}
                        {phone ? null : (
                            <span role="group" aria-label="View" className="nb-seg" data-size="sm">
                                {(['list', 'cards'] as const).map((v) => <button key={v} type="button" aria-pressed={layout === v} onClick={() => go({ wview: v === 'cards' ? null : v })}>{v === 'list' ? 'List' : 'Cards'}</button>)}
                                <TabMarker />
                            </span>
                        )}
                        {newButton('New', 'ml-auto md:hidden')}
                    </div>
                </div>
            )}
            {narrowed && rows.length ? <p className="text-[12px] text-muted-foreground" role="status">Showing {rows.length} of {inTab.length} · <button type="button" className="nb-link" onClick={clear}>Clear filters</button></p> : null}

            {/* §5 States, then the cards or the list. */}
            {rows.length === 0 ? <EmptyState data={data} tab={tab} narrowed={narrowed} onClear={clear} onAll={() => go({ ws: 'all' })} newButton={newButton('New workspace')} summaryMineZeroSeats={data.rows.reduce((n, r) => n + (r.mine ? 0 : r.openSeats), 0)} />
                : layout === 'cards' ? (
                    <ul aria-label="Workspaces" className="flex flex-col gap-3">
                        {page.map((r) => (
                            <li key={r.id} data-workspace-row={r.id} className={cn('min-w-0 rounded-lg max-md:[&_[aria-label^=More]]:min-h-11 max-md:[&_[aria-label^=More]]:min-w-11', highlight === r.id && 'ring-2 ring-primary')}>
                                <WorkspaceCard project={cards.get(r.id)!} isFollowing={followed.has(r.id)} followersCount={r.followers} applicationChip={applications.get(r.id)}
                                    titleChip={titleChip(r)}
                                    orgDetails={
                                        <div className="space-y-1.5" data-testid="org-details">
                                            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                                                <span className="min-w-0 truncate text-muted-foreground">{orgLine(r)}</span>
                                                {health(r)}
                                            </div>
                                            {r.groupCopy ? <p className="text-[13px] text-muted-foreground">{r.groupCopy.title} · {ASSIGNMENT_STATE_LABELS[r.groupCopy.state] ?? r.groupCopy.state}</p> : null}
                                            {attentionLine(r)}
                                        </div>
                                    }
                                    footerExtra={<><span className="nb-meta">{people(r.members)}</span>{seatsLink(r)}</>}
                                    footerEnd={messageLead(r)}
                                    menuItems={menu(r)} />
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div role="table" aria-label="Workspaces" className="overflow-hidden rounded-lg border border-border">
                        <div role="row" className="nb-micro sticky top-0 z-10 grid min-h-10 items-center gap-3 border-b border-border bg-card px-3 py-2" style={{ gridTemplateColumns: LIST_GRID }}>
                            <span role="columnheader" className="sr-only">Select</span>
                            {([['name', 'Name'], [null, 'Workspace lead'], [null, 'Stage'], ['overdue', 'Health'], ['active', 'Updated']] as const).map(([key, label]) => (
                                <span key={label} role="columnheader" aria-sort={key && sort === key ? (key === 'name' ? 'ascending' : 'descending') : undefined} className={cn(label === 'Workspace lead' || label === 'Stage' ? 'hidden lg:block' : '', label === 'Updated' && 'hidden xl:block')}>
                                    {key ? <button type="button" className={cn('uppercase hover:text-foreground', sort === key && 'text-foreground')} onClick={() => go({ wsort: key })}>{label}</button> : label}
                                </span>
                            ))}
                            <span role="columnheader" className="sr-only">Actions</span>
                        </div>
                        {page.map((r) => (
                            <div key={r.id} role="row" data-workspace-row={r.id} className={cn('grid min-h-14 items-center gap-3 border-b border-border px-3 py-1.5 text-[13px] last:border-b-0', highlight === r.id && 'bg-muted')} style={{ gridTemplateColumns: LIST_GRID }}>
                                <span role="cell">{canAct ? <input type="checkbox" className="nb-check" aria-label={`Select ${r.title}`} checked={selected.has(r.id)} onClick={(e) => pick(r, (e.target as HTMLInputElement).checked, e.shiftKey)} onChange={() => undefined} /> : null}</span>
                                <span role="cell" className="flex min-w-0 items-center gap-2.5">
                                    <WorkspaceAvatar project={{ id: r.id, title: r.title, coverImage: r.coverImage }} size="row" parentId={orgId} />
                                    <span className="min-w-0">
                                        <span className="flex min-w-0 items-center gap-1.5"><Link href={href(r)} className="truncate font-medium hover:underline">{r.title}</Link>{titleChip(r)}</span>
                                        <span className="block truncate text-[12px] text-muted-foreground">{r.status === 'archived' && r.archivedBy ? toCard(r).shortDescription : r.description ?? '—'}<span className="lg:hidden">{orgLine(r) ? ` · ${orgLine(r)}` : ''}</span><span className="xl:hidden"> · <WorkspaceLastUpdate projectId={r.id} timeOnly /></span></span>
                                        {attentionLine(r)}
                                    </span>
                                </span>
                                <span role="cell" className="hidden truncate text-[13px] text-muted-foreground lg:block">{r.lead?.name ?? '—'}</span>
                                <span role="cell" className="hidden truncate text-[13px] text-muted-foreground lg:block">{[r.stage, r.sprint?.name].filter(Boolean).join(' · ') || '—'}</span>
                                <span role="cell">{health(r)}</span>
                                <span role="cell" className="hidden xl:block"><WorkspaceLastUpdate projectId={r.id} timeOnly className="nb-meta" /></span>
                                <span role="cell" className="flex justify-end">
                                    {canAct ? (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${r.title}`} className="nb-touch-target"><MoreHorizontal className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-52">{menu(r)}</DropdownMenuContent>
                                        </DropdownMenu>
                                    ) : messageLead(r)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            {rows.length > shown ? (
                <div className="flex items-center gap-3">
                    <Button type="button" size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE)}>Show more</Button>
                    <span className="nb-meta">{shown} of {rows.length}</span>
                </div>
            ) : null}

            {reminding ? <RemindDialog rows={reminding} remindedAt={remindedAt} pending={pending} onClose={() => setReminding(null)} onSend={(ids, note) => remind(ids, note)} /> : null}
            <ArchiveOrDetach ask={ask} onClose={() => setAsk(null)} onDone={() => { setSelected(new Set()); reload() }} />
            {assigning ? <AssignLeadDialog row={assigning} onClose={() => setAssigning(null)} onDone={reload} /> : null}
            {requestsOpen ? <RequestsPanel requests={data.requests} onClose={() => setRequestsOpen(false)} onDone={reload} /> : null}
            {asking ? <AskToAddDialog orgId={orgId} onClose={() => setAsking(false)} /> : null}
        </div>
    )
}

const LIST_GRID = '20px minmax(0,1fr) auto auto auto auto 32px'

function EmptyState({ data, tab, narrowed, onClear, onAll, newButton, summaryMineZeroSeats }: { data: Data; tab: Tab; narrowed: boolean; onClear: () => void; onAll: () => void; newButton: ReactNode; summaryMineZeroSeats: number }) {
    // The shared empty state (spec §33): titles without periods, one sentence, one action.
    const box = (title: string, body?: string | null, action?: ReactNode, icon = FolderKanban) => (
        <SharedEmpty icon={icon} title={title} description={body ?? undefined} action={action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : undefined} />
    )
    if (narrowed) return box('No workspaces match these filters', 'Try another filter, or clear them.', <Button type="button" variant="outline" size="sm" onClick={onClear}>Clear filters</Button>, SearchX)
    if (data.rows.length === 0) {
        return data.isAdmin
            ? box('No workspaces yet', 'Teams work inside workspaces.', <>{newButton}<Link href="/help/running-a-class" className="nb-link self-center text-[13px]">How workspaces work</Link></>)
            : box('No workspaces yet', data.canAsk ? 'Your organizer adds them, or you can ask to add one of yours.' : 'Your organizer will add them.', data.canAsk ? newButton : null)
    }
    if (tab === 'mine') return box('You’re not in a workspace yet', summaryMineZeroSeats ? `${summaryMineZeroSeats} open ${summaryMineZeroSeats === 1 ? 'seat' : 'seats'} across the organization.` : null, <Button type="button" variant="outline" size="sm" onClick={onAll}>Browse all</Button>)
    if (tab === 'attention') return box('Nothing needs you', 'Every workspace is active.', null, Check)
    if (tab === 'archived') return box('Nothing archived', 'Archived workspaces stay readable here.')
    return box('No workspaces yet', null, newButton)
}

/** F1: Remind lead with a prefilled note the admin can change; one confirm for several. */
function RemindDialog({ rows, remindedAt, pending, onClose, onSend }: { rows: Row[]; remindedAt: (r: Row) => string | null; pending: boolean; onClose: () => void; onSend: (ids: string[], note: string) => void }) {
    const fresh = rows.filter((r) => !remindedAt(r))
    const skipped = rows.length - fresh.length
    const one = rows.length === 1 ? rows[0]! : null
    const [note, setNote] = useState(one ? `Can you check on ${one.title}? ${attentionItems(one).map((i) => i.label).join(', ') || 'It could use an update.'}` : 'Can you check on your workspace and post an update?')
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{one ? `Remind ${one.lead?.name ?? 'the workspace lead'}` : `Remind ${fresh.length} workspace ${fresh.length === 1 ? 'lead' : 'leads'}`}</DialogTitle>
                    <DialogDescription>
                        {skipped ? `${skipped} ${skipped === 1 ? 'was' : 'were'} reminded in the last 12 hours and will be skipped. ` : ''}They get a notification with what’s open and your note.
                    </DialogDescription>
                </DialogHeader>
                <label className="block"><span className={fieldLabel}>Note</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} className="nb-textarea mt-1.5" />
                </label>
                <DialogFooter paper>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button disabled={pending || fresh.length === 0} onClick={() => onSend(fresh.map((r) => r.id), note)}>Send reminder</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** F4: Archive (with Undo) and Detach (says what stays and what goes). */
function ArchiveOrDetach({ ask, onClose, onDone }: { ask: { kind: 'archive' | 'detach'; rows: Row[] } | null; onClose: () => void; onDone: () => void }) {
    const first = ask?.rows[0]
    return (
        <ConfirmDialog open={Boolean(ask)} onOpenChange={(open) => { if (!open) onClose() }}
            title={ask?.kind === 'detach' ? `Detach ${first?.title}?` : `Archive ${ask?.rows.length === 1 ? first!.title : `${ask?.rows.length ?? 0} workspaces`}?`}
            description={ask?.kind === 'detach'
                ? 'It leaves the organization’s boards, sprints and reviews and becomes a private personal workspace for its workspace lead. Its people and files stay with it; work already handed in stays here. Unsubmitted group work goes. The workspace lead is told. This can’t be undone here.'
                : `It stays readable for its ${people(ask?.rows.reduce((n, r) => n + r.members, 0) ?? 0)}; nobody can add work. They’re told. You can unarchive it.`}
            confirmLabel={ask?.kind === 'detach' ? 'Detach' : 'Archive'} variant={ask?.kind === 'detach' ? 'destructive' : 'default'}
            onConfirm={async () => {
                if (!ask) return
                const done: Row[] = []
                for (const r of ask.rows) {
                    const res = ask.kind === 'detach' ? await detachChildAction(r.id) : await archiveChildAction(r.id)
                    if (res.success) done.push(r)
                }
                onDone()
                if (ask.kind === 'detach') return void toast.success(done.length ? `${done[0]!.title} left the organization` : 'Couldn’t detach it', { description: done.length ? 'Its workspace lead can ask to join again from its settings.' : undefined })
                const skipped = ask.rows.length - done.length
                toast.success(`Archived ${done.length === 1 ? done[0]!.title : done.length}${skipped ? `, skipped ${skipped}` : ''}`, {
                    duration: 6_000,
                    action: done.length ? { label: 'Undo', onClick: () => void Promise.all(done.map((r) => unarchiveChildAction(r.id))).then(() => { toast.success('Archive undone'); onDone() }) } : undefined,
                })
            }} />
    )
}

/** F3: workspaces asking to join or leave, in a side panel; Decline takes an optional reason. */
function RequestsPanel({ requests, onClose, onDone }: { requests: OrgWorkspaceRequest[]; onClose: () => void; onDone: () => void }) {
    const [declining, setDeclining] = useState<string | null>(null)
    const [reason, setReason] = useState('')
    const [answered, setAnswered] = useState<Set<string>>(new Set())
    const [pending, startTransition] = useTransition()
    const open = requests.filter((r) => !answered.has(r.id))
    useEffect(() => { if (open.length === 0) onClose() }, [onClose, open.length])
    const act = (r: OrgWorkspaceRequest, work: () => Promise<{ success: boolean; error?: string }>, done: string) => startTransition(async () => {
        const result = await work()
        if (!result.success) return void toast.error(result.error ?? 'Something went wrong.')
        toast.success(done)
        setDeclining(null)
        setReason('')
        setAnswered((cur) => new Set(cur).add(r.id))
        onDone()
    })
    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent presentation="right-drawer" size="side">
                <DialogHeader>
                    <DialogTitle>{withCount('Requests', open.length)}</DialogTitle>
                    <DialogDescription>Workspaces asking to join or leave the organization.</DialogDescription>
                </DialogHeader>
                <ul className="-mx-6 divide-y divide-border overflow-y-auto border-y border-border">
                    {open.map((r) => (
                        <li key={r.id} className="space-y-2 px-6 py-3 text-sm">
                            <p className="flex items-center gap-2.5">
                                <WorkspaceAvatar project={{ title: r.title, coverImage: null }} size="row" kind="child" />
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">{r.title}</span>
                                    <span className="block text-[12px] text-muted-foreground">{r.kind === 'move_in' ? 'Asks to join' : 'Asks to leave'} · {r.lead}, workspace lead · {people(r.members)}</span>
                                </span>
                            </p>
                            {declining === r.id ? (
                                <div className="flex flex-wrap gap-2">
                                    <label className="w-full"><span className={fieldLabel}>Reason (optional)</span><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1.5 w-full" /></label>
                                    <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => act(r, () => (r.kind === 'move_in' ? cancelMoveInAction(r.id, reason) : cancelDetachRequestAction(r.id, reason)), 'Request declined')}>Decline</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(null)}>Cancel</Button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <Button type="button" size="sm" disabled={pending} onClick={() => act(r, () => (r.kind === 'move_in' ? approveMoveInAction(r.id) : detachChildAction(r.id)), r.kind === 'move_in' ? `${r.title} is now part of the organization` : `${r.title} left the organization`)}>Accept</Button>
                                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setDeclining(r.id); setReason('') }}>Decline</Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </DialogContent>
        </Dialog>
    )
}

/** D6: a member brings one of their own workspaces in; admins get the request on this tab. */
function AskToAddDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
    const mine = useQuery({ queryKey: ['movable-workspaces', orgId], queryFn: () => readMyMovableWorkspacesAction(orgId) })
    const [asked, setAsked] = useState<Set<string>>(new Set())
    const [pending, startTransition] = useTransition()
    const rows = mine.data?.success ? mine.data.rows : []
    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Ask to add a workspace</DialogTitle>
                    <DialogDescription>Choose one of your own workspaces. An admin accepts it into the organization.</DialogDescription>
                </DialogHeader>
                {mine.isPending ? <div className="nb-skeleton h-20 rounded-md" role="status" aria-label="Loading your workspaces" /> : rows.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">You don’t lead a workspace outside an organization yet. Create one from your workspaces, then ask here.</p>
                ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto">
                        {rows.map((r) => {
                            const done = r.asked || asked.has(r.id)
                            return (
                                <li key={r.id} className="flex min-h-11 items-center justify-between gap-2 text-[13px]">
                                    <span className="min-w-0 truncate">{r.title}</span>
                                    {done ? <StatusBadge state="requested">Asked</StatusBadge> : (
                                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
                                            const res = await moveWorkspaceToOrgAction(r.id, orgId)
                                            if (!res.success) return void toast.error(res.error)
                                            setAsked((cur) => new Set(cur).add(r.id))
                                            toast.success(res.outcome === 'moved' ? `${r.title} is now part of the organization` : 'Request sent')
                                        })}>Ask to join</Button>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
                <DialogFooter paper><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** Assign a lead (report §35.4): team members first, then anyone in the organization; Archive when nobody fits. */
function AssignLeadDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
    const candidates = useQuery({ queryKey: ['lead-candidates', row.id], queryFn: () => readLeadCandidatesAction(row.id) })
    const [q, setQ] = useState('')
    const [pick, setPick] = useState<{ id: string; name: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const list = (candidates.data?.success ? candidates.data.people : []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Assign a workspace lead for {row.title}</DialogTitle>
                    <DialogDescription>{row.lead?.name ?? 'Someone'} holds it until then. Viewers and outside people can’t lead it.</DialogDescription>
                </DialogHeader>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the organization" aria-label="Search people" />
                {candidates.isPending ? <div className="nb-skeleton h-24 rounded-md" role="status" aria-label="Loading people" /> : list.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">Nobody here can lead it. You can archive it instead.</p>
                ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto">
                        {list.map((p) => (
                            <li key={p.id}><button type="button" onClick={() => setPick(p)} aria-pressed={pick?.id === p.id}
                                className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-muted', pick?.id === p.id && 'bg-muted font-medium')}>
                                <UserAvatar identity={{ id: p.id, fullName: p.name, avatarUrl: p.avatarUrl }} size={26} />
                                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                <span className="text-[12px] font-normal text-muted-foreground">{p.onTeam ? 'On the team' : 'In the organization'}</span>
                                {pick?.id === p.id ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                            </button></li>
                        ))}
                    </ul>
                )}
                {pick ? <p className="text-[13px]">{pick.name} will lead {row.title}. {row.lead?.name ?? 'The holder'} steps back to admin access.</p> : null}
                <DialogFooter paper>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button disabled={!pick || busy} onClick={async () => {
                        setBusy(true)
                        const r = await assignChildLeadAction(row.id, pick!.id).finally(() => setBusy(false))
                        if (!r.success) return void toast.error(r.error)
                        toast.success(`${pick!.name} leads ${row.title} now`)
                        onDone()
                        onClose()
                    }}>Assign workspace lead</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
