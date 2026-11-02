'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Pin } from 'lucide-react'

import { readChildOrgLineAction, readOrgDashboardAction, readOrgWorkspacesAction, remindLeadsAction, type OrgWorkspaceRow } from '@/app/actions/org-dashboard'
import type { OrgWorkspaceRequest } from '@/lib/organizations/needs-you'
import { messageUserInWindow } from '@/components/messages/message-user'
import { approveMoveInAction, archiveChildAction, cancelDetachRequestAction, cancelMoveInAction, detachChildAction } from '@/app/actions/organizations'
import { readWorkspaceUnitsAction } from '@/app/actions/child-units'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RailSection } from '@/components/ui/rail-section'
import { WorkspaceLastUpdate } from '@/components/workspaces/WorkspaceLastUpdate'
import { toast } from '@/lib/feedback'
import { remindSummary } from '@/lib/organizations/member-rules'
import { typeProfile } from '@/lib/organizations/type-profile'
import { formatDistanceToNow } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'

// Org Dashboard (report §27), Projects tab (§28) and the child project's org line (§22.5, §27.5).

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const row = 'flex min-w-0 items-center justify-between gap-3 py-1.5 text-sm'
const STATE: Record<string, string> = ASSIGNMENT_STATE_LABELS
const FILTERS = [['all', 'All'], ['assignments', 'Assignments'], ['people', 'People'], ['files', 'Files and docs'], ['projects', 'Workspaces']] as const

/** The org Dashboard for people in the org (report §27). */
export function OrgDashboard({ orgId, orgSlug, orgType = null }: { orgId: string; orgSlug: string | null; orgType?: string | null }) {
    const [filter, setFilter] = useState('all')
    // Refetch on focus and every 2 minutes while visible.
    const query = useQuery({ queryKey: ['org-dashboard', orgId, filter], queryFn: () => readOrgDashboardAction(orgId, filter), refetchInterval: 120_000, refetchOnWindowFocus: true })
    const base = `/org/${encodeURIComponent(orgSlug ?? orgId)}`
    if (query.isPending) return <div role="status" aria-label="Loading dashboard" className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-10 rounded-[5px]" />)}</div>
    const data = query.data
    if (!data || !data.success) return (
        <div role="alert" className="py-10 text-center text-sm text-muted-foreground">
            Dashboard could not be loaded. <button type="button" className="underline" onClick={() => void query.refetch()}>Try again</button>
        </div>
    )
    const s = data.thisSprint
    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-6 lg:col-span-8">
                {data.archivedSummary ? <p className="text-sm text-muted-foreground" data-testid="org-archived-summary">{data.archivedSummary}</p> : null}
                {data.pinned ? (
                    <Link href={`${base}?tab=updates&updateId=${data.pinned.id}`} className="flex min-h-10 items-center gap-2 rounded-[5px] border border-border bg-muted/30 px-3 text-sm hover:bg-muted">
                        <Pin className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{data.pinned.content}</span>
                    </Link>
                ) : null}
                {data.getStarted.length ? (
                    <RailSection title="Get started">
                        <ul className="space-y-1 text-sm">{data.getStarted.map((step) => <li key={step}>○ {step}</li>)}</ul>
                    </RailSection>
                ) : null}
                {data.needsYou.length ? (
                    <RailSection title="Needs your attention">
                        <ul>{data.needsYou.slice(0, 5).map((n) => <li key={`${n.kind}:${n.label}`}><Link href={n.href} className={cn(row, 'hover:text-primary')}><span className="truncate">{n.label}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
                        {data.needsYou.length > 5 ? <p className="text-[12px] text-muted-foreground">and {data.needsYou.length - 5} more</p> : null}
                    </RailSection>
                ) : null}
                <RailSection title={s.sprint ? `This sprint · ${s.sprint.name} · ends ${day(s.sprint.endDate)}${ownLine(s.items)}` : 'This sprint'}>
                    {s.sprint ? (
                        s.items.length ? <ul>{s.items.map((i) => (
                            <li key={i.masterId} className={row}>
                                <span className="truncate">{i.title}{i.dueDate ? ` · due ${day(i.dueDate)}` : ''}{i.own?.extended ? ' · Extended' : ''}</span>
                                <span className="shrink-0 text-[12px] text-muted-foreground">
                                    {i.counts ? `${i.counts.done} of ${i.counts.total} done${i.counts.missing ? ` · ${i.counts.missing} missing` : ''}` : i.own ? `${STATE[i.own.state] ?? i.own.state}${i.own.late ? ' · late' : ''}` : ''}
                                </span>
                            </li>
                        ))}</ul> : <p className="text-sm text-muted-foreground">No assignments in this sprint.</p>
                    ) : s.next ? <p className="text-sm text-muted-foreground">{s.next.name} starts {day(s.next.startDate)}.</p>
                        : data.role === 'admin' ? <Link href={`${base}?tab=sprints`} className="text-sm underline underline-offset-4">{typeProfile(orgType).planLabel}</Link>
                            : <p className="text-sm text-muted-foreground">No sprint right now.</p>}
                </RailSection>
                <RailSection title="Coming up · next 7 days">
                    {data.comingUp.length ? <ul>{data.comingUp.map((c) => <li key={`${c.date}:${c.label}`} className={row}><span className="w-28 shrink-0 font-mono text-[12px] text-muted-foreground">{day(c.date)}</span><span className="min-w-0 flex-1 truncate">{c.label}</span></li>)}</ul>
                        : <p className="text-sm text-muted-foreground">Nothing due.</p>}
                </RailSection>
                <RailSection title="Activity" action={
                    <span className="flex flex-wrap gap-1" role="tablist" aria-label="Filter activity">
                        {FILTERS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn('rounded-[4px] px-1.5 text-[11px]', filter === value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground')}>{label}</button>)}
                    </span>
                }>
                    {data.activity.length ? <ol>{data.activity.map((a) => <li key={a.id} className={row}><Link href={a.href} className="min-w-0 truncate hover:underline">{a.text}</Link><time dateTime={a.at} className="shrink-0 font-mono text-[11px] text-muted-foreground">{ago(a.at)}</time></li>)}</ol>
                        : <p className="text-sm text-muted-foreground">Nothing yet.</p>}
                </RailSection>
            </div>
            <aside aria-label="Organization details" className="min-w-0 space-y-6 lg:col-span-4">
                <RailSection title="Workspaces" action={<Link href={`${base}?tab=projects`} className="text-[12px] underline underline-offset-4">See all</Link>}>
                    {data.projects.length ? <ul>{data.projects.map((p) => <li key={p.id} className={row}><Link href={`/workspaces/${encodeURIComponent(p.slug ?? p.id)}`} className="truncate hover:underline">{p.title}</Link><WorkspaceLastUpdate projectId={p.id} timeOnly className="shrink-0 font-mono text-[11px] text-muted-foreground" /></li>)}</ul>
                        : <p className="text-sm text-muted-foreground">{data.role === 'admin' ? 'No workspaces yet.' : "You’re not in a workspace yet."}</p>}
                </RailSection>
                <RailSection title="People">
                    <p className="text-sm">{data.people.avatars.map((p) => p.name.split(' ')[0]).join(', ')}{data.people.total > data.people.avatars.length ? ` +${data.people.total - data.people.avatars.length}` : ''}</p>
                    <p className="text-[12px] text-muted-foreground">{data.people.joinedThisWeek} joined this week</p>
                    {data.people.requests ? <Link href={`${base}?tab=members`} className="text-[12px] underline underline-offset-4">{data.people.requests} {data.people.requests === 1 ? 'request' : 'requests'} →</Link> : null}
                </RailSection>
            </aside>
        </div>
    )
}

/** A member's line (report §15.4): "you have 2 of 3 done" across their own copies in the sprint. */
function ownLine(items: Array<{ own?: { state: string } | null }>) {
    const own = items.filter((i) => i.own)
    return own.length ? ` · you have ${own.filter((i) => i.own!.state === 'done').length} of ${own.length} done` : ''
}

/** Workspaces → Requests (report §28.6, decision 57): move in and leave, each with Approve and Decline. */
function WorkspaceRequests({ requests, onDone }: { requests: OrgWorkspaceRequest[]; onDone: () => void }) {
    const [declining, setDeclining] = useState<string | null>(null)
    const [reason, setReason] = useState('')
    const [pending, startTransition] = useTransition()
    if (requests.length === 0) return null
    const act = (work: () => Promise<{ success: boolean; error?: string }>, done: string) => startTransition(async () => {
        const result = await work()
        if (!result.success) return void toast.error(result.error ?? 'Something went wrong.')
        toast.success(done)
        setDeclining(null)
        setReason('')
        onDone()
    })
    return (
        <section aria-labelledby="workspace-requests-heading" className="rounded-lg border border-border">
            <h3 id="workspace-requests-heading" className="nb-micro border-b border-border px-3 py-2">Requests ({requests.length})</h3>
            <ul className="divide-y divide-border">
                {requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                        <span className="min-w-0 flex-1">
                            <span className="font-medium">{r.title}</span>
                            <span className="text-muted-foreground"> · {r.kind === 'move_in' ? 'asks to join' : 'asks to leave'} · {r.lead} (lead) · {r.members} {r.members === 1 ? 'member' : 'members'}</span>
                        </span>
                        {declining === r.id ? (
                            <>
                                <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (optional)" aria-label={`Reason for declining ${r.title}`} className="h-8 w-full sm:w-56" />
                                <Button type="button" size="sm" variant="destructive" disabled={pending}
                                    onClick={() => act(() => (r.kind === 'move_in' ? cancelMoveInAction(r.id, reason) : cancelDetachRequestAction(r.id, reason)), 'Request declined')}>Decline</Button>
                                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(null)}>Cancel</Button>
                            </>
                        ) : (
                            <>
                                <Button type="button" size="sm" disabled={pending}
                                    onClick={() => act(() => (r.kind === 'move_in' ? approveMoveInAction(r.id) : detachChildAction(r.id)), r.kind === 'move_in' ? `${r.title} is now part of the organization` : `${r.title} left the organization`)}>Approve</Button>
                                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setDeclining(r.id); setReason('') }}>Decline</Button>
                            </>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    )
}

/** Projects tab (report §28): a list with filters for everyone in the org; Needs attention and bulk Archive for admins. */
export function OrgWorkspacesTab({ orgId, orgSlug }: { orgId: string; orgSlug?: string | null }) {
    const [data, setData] = useState<{ isAdmin: boolean; canCreate?: boolean; rows: OrgWorkspaceRow[]; requests: OrgWorkspaceRequest[]; summary: { total: number; attention: number; quiet: number; notInProject: number } } | null>(null)
    const [q, setQ] = useState('')
    const [status, setStatus] = useState<'all' | 'attention' | 'quiet' | 'archived'>('all')
    const [visibility, setVisibility] = useState('all')
    const [mine, setMine] = useState(false)
    const [sort, setSort] = useState<'active' | 'name' | 'overdue'>('active')
    const [stage, setStage] = useState('all')
    const [lead, setLead] = useState('all')
    const [sprint, setSprint] = useState<'all' | 'linked' | 'not_linked'>('all')
    // List for admins, Cards for members (report §28.1); 50 rows a page (§28.6).
    const [view, setView] = useState<'list' | 'cards' | null>(null)
    const [shown, setShown] = useState(50)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readOrgWorkspacesAction(orgId).then((r) => setData(r.success ? r : null)), [orgId])
    useEffect(() => { load() }, [load])
    const rows = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return (data?.rows ?? []).filter((r) =>
            (!needle || r.title.toLowerCase().includes(needle) || r.lead?.name.toLowerCase().includes(needle))
            && (status === 'all' ? r.status !== 'archived' : status === 'archived' ? r.status === 'archived' : status === 'attention' ? r.reasons.length > 0 : r.reasons.includes('quiet 7 days'))
            && (visibility === 'all' || r.visibility === visibility)
            && (stage === 'all' || r.stage === stage)
            && (lead === 'all' || r.lead?.id === lead)
            && (sprint === 'all' || (sprint === 'linked' ? Boolean(r.sprint?.inOrgSprint) : !r.sprint?.inOrgSprint))
            && (!mine || r.mine),
        ).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'overdue' ? b.overdue - a.overdue : b.lastActivityAt.localeCompare(a.lastActivityAt))
    }, [data, lead, mine, q, sort, sprint, stage, status, visibility])
    if (!data) return <p className="py-10 text-center text-sm text-muted-foreground">Loading workspaces…</p>
    const layout = view ?? (data.isAdmin ? 'list' : 'cards')
    const stages = [...new Set(data.rows.map((r) => r.stage).filter((s): s is string => Boolean(s)))].sort()
    const leads = [...new Map(data.rows.flatMap((r) => (r.lead ? [[r.lead.id, r.lead.name] as const] : []))).entries()].sort((a, b) => a[1].localeCompare(b[1]))
    const page = rows.slice(0, shown)
    const remind = () => startTransition(async () => {
        const r = await remindLeadsAction(orgId, [...selected])
        if (!r.success) return void toast.error(r.error)
        toast.success(remindSummary(r))
        setSelected(new Set())
    })
    const projectHref = (r: OrgWorkspaceRow) => `/workspaces/${encodeURIComponent(r.slug ?? r.id)}`
    const messageLead = (r: OrgWorkspaceRow) => r.lead && !r.mine ? <Link href={`/messages?userId=${r.lead.id}`} onClick={(e) => messageUserInWindow(r.lead!.id, e)} className="text-[12px] underline underline-offset-4">Message owner</Link> : null
    const sel = 'h-9 rounded-md border border-border bg-background px-2 text-sm'
    const archive = () => startTransition(async () => {
        for (const id of selected) {
            const r = await archiveChildAction(id)
            if (!r.success) return void toast.error(r.error)
        }
        toast.success('Archived')
        setSelected(new Set())
        load()
    })
    return (
        <div className="mx-auto w-full max-w-[1240px] space-y-3">
            {data.isAdmin ? <WorkspaceRequests requests={data.requests} onDone={load} /> : null}
            <p className="text-sm">
                <button type="button" className="hover:underline" onClick={() => setStatus('all')}>{data.summary.total} {data.summary.total === 1 ? 'workspace' : 'workspaces'}</button>
                {data.isAdmin ? <>
                    {' · '}<button type="button" className="hover:underline" onClick={() => setStatus('attention')}>{data.summary.attention} need attention</button>
                    {' · '}<button type="button" className="hover:underline" onClick={() => setStatus('quiet')}>{data.summary.quiet} quiet</button>
                    {' · '}{data.summary.notInProject} members not in a workspace
                </> : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search workspaces" className="h-9 w-full sm:w-52" />
                <select aria-label="Status" className={sel} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                    <option value="all">Active</option>{data.isAdmin ? <option value="attention">Needs attention</option> : null}<option value="quiet">Quiet 7 days</option><option value="archived">Archived</option>
                </select>
                <select aria-label="Visibility" className={sel} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                    <option value="all">Any visibility</option><option value="org">Organization</option><option value="private">Private</option><option value="public">Public</option>
                </select>
                {stages.length ? (
                    <select aria-label="Stage" className={sel} value={stage} onChange={(e) => setStage(e.target.value)}>
                        <option value="all">Any stage</option>{stages.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                ) : null}
                <select aria-label="Owner" className={sel} value={lead} onChange={(e) => setLead(e.target.value)}>
                    <option value="all">Any owner</option>{leads.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <select aria-label="Sprint" className={sel} value={sprint} onChange={(e) => setSprint(e.target.value as typeof sprint)}>
                    <option value="all">Any sprint</option><option value="linked">Part of the organization sprint</option><option value="not_linked">Not part of an organization sprint</option>
                </select>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine</label>
                <select aria-label="Sort" className={sel} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                    <option value="active">Recently active</option><option value="name">Name</option><option value="overdue">Most overdue</option>
                </select>
                {data.canCreate ? <Button asChild size="sm" className="ml-auto"><Link href={`/workspaces/new?org=${encodeURIComponent(orgSlug ?? orgId)}`}>+ New workspace</Link></Button> : null}
                {data.isAdmin && selected.size ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={remind}>Remind owners</Button> : null}
                {data.isAdmin && selected.size ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm(`Archive ${selected.size} ${selected.size === 1 ? 'workspace' : 'workspaces'}?`)) archive() }}>Archive {selected.size}</Button> : null}
                <span className="flex rounded-md border border-border text-[12px]" role="group" aria-label="View">
                    {(['list', 'cards'] as const).map((v) => <button key={v} type="button" aria-pressed={layout === v} onClick={() => setView(v)} className={cn('px-2 py-1 capitalize', layout === v ? 'bg-muted font-medium' : 'text-muted-foreground')}>{v}</button>)}
                </span>
            </div>
            {layout === 'cards' ? (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Workspaces">
                    {rows.length === 0 ? <li className="text-sm text-muted-foreground">{data.rows.length === 0 ? 'No workspaces yet.' : 'No workspaces match.'}</li> : null}
                    {page.map((r) => (
                        <li key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                            <p className="flex items-center gap-1.5">
                                <Link href={projectHref(r)} className="min-w-0 truncate font-medium hover:underline">{r.title}</Link>
                                {r.newInOrg ? <span className="nb-status shrink-0" data-status="active">New</span> : null}
                            </p>
                            <p className="mt-1 text-[12px] text-muted-foreground">{r.lead?.name} (lead) · {r.members} {r.members === 1 ? 'member' : 'members'}{r.sprint ? ` · ${r.sprint.name}` : ''}</p>
                            <p className="mt-1 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                                <span>{r.visibility === 'org' ? 'Organization' : r.visibility === 'private' ? 'Private' : 'Public'} · active {ago(r.lastActivityAt)}</span>
                                {messageLead(r)}
                            </p>
                        </li>
                    ))}
                </ul>
            ) : null}
            {layout === 'list' ? <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.length === 0 ? <li className="p-4 text-sm text-muted-foreground">{data.rows.length === 0 ? (data.isAdmin ? 'Create workspaces for your groups.' : 'No workspaces yet.') : 'No workspaces match.'}</li> : null}
                {page.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                        {data.isAdmin ? <input type="checkbox" className="mt-1" aria-label={`Select ${r.title}`} checked={selected.has(r.id)} onChange={(e) => setSelected((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next })} /> : null}
                        <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-1.5">
                                <Link href={`/workspaces/${encodeURIComponent(r.slug ?? r.id)}`} className="font-medium hover:underline">{r.title}</Link>
                                <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">{r.visibility === 'org' ? 'Organization' : r.visibility === 'private' ? 'Private' : 'Public'}</span>
                                {r.newInOrg ? <span className="nb-status" data-status="active">New in this org</span> : null}
                                <span className="text-muted-foreground">{r.lead?.name} (lead) · {r.members} {r.members === 1 ? 'member' : 'members'}{r.units ? ` · ${r.units} teams` : ''}</span>
                                {r.sprint ? <span className="text-muted-foreground">· {r.sprint.name}{r.sprint.inOrgSprint ? ' · in the org sprint' : ''}</span> : null}
                                {r.stage ? <span className="text-muted-foreground">· {r.stage}</span> : null}
                                {messageLead(r)}
                            </p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {r.open} open · {r.overdue} overdue · {r.inReview} in review
                                {r.groupCopy ? ` · ${r.groupCopy.title}: ${STATE[r.groupCopy.state] ?? r.groupCopy.state}` : ''}
                                <WorkspaceLastUpdate projectId={r.id} className="block sm:hidden" />
                            </p>
                            {r.reasons.length ? <p className="mt-0.5 text-[12px] text-destructive">⚠ Needs attention: {r.reasons.join(' · ')}</p> : null}
                        </div>
                        <WorkspaceLastUpdate projectId={r.id} className="hidden max-w-48 shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:inline" />
                    </li>
                ))}
            </ul> : null}
            {rows.length > shown ? <Button type="button" size="sm" variant="outline" onClick={() => setShown((n) => n + 50)}>Show 50 more ({rows.length - shown} left)</Button> : null}
        </div>
    )
}

const useChildOrgLine = (projectId: string) => useQuery({ queryKey: ['child-org-line', projectId], queryFn: () => readChildOrgLineAction(projectId), staleTime: 60_000 })

/** `Part of CSE-3A · CO2 ends Fri · 1 assignment due`, under a child workspace's header buttons. */
export function ChildOrgHeaderDetails({ projectId }: { projectId: string }) {
    const { data: line } = useChildOrgLine(projectId)
    // Report §17.1: the breadcrumb already names the organization, so this line says only what's running.
    const parts = [line?.sprint ? `Inside ${line.sprint.name} · ends ${day(line.sprint.endDate)}` : null, line?.dueCount ? `${line.dueCount} ${line.dueCount === 1 ? 'assignment' : 'assignments'} due` : null].filter(Boolean)
    if (!line || parts.length === 0) return null
    return (
        <p className="max-w-[280px] text-right text-[13px] leading-5 text-muted-foreground xl:max-w-[420px] max-md:max-w-none max-md:text-left" data-testid="child-org-header-details">
            {parts.join(' · ')}
        </p>
    )
}

/** What's happening at the top of a child workspace's Overview. */
export function ChildOrgLine({ projectId }: { projectId: string }) {
    const { data: line } = useChildOrgLine(projectId)
    if (!line) return null
    return (
        <div className="mb-4 space-y-4">
            {/* What's happening = Needs you + This sprint (report §27.5); Activity stays in the rail. */}
            {line.needsYou.length || line.ownSprint ? (
                <RailSection title="What’s happening">
                    {line.ownSprint ? (
                        <p className={row} data-testid="child-this-sprint">
                            <span className="truncate">This sprint · {line.ownSprint.name}</span>
                            <span className="shrink-0 text-[12px] text-muted-foreground">{line.ownSprint.parent ? `Inside ${line.ownSprint.parent} (${line.orgTitle}) · ` : ''}ends {day(line.ownSprint.endDate)}</span>
                        </p>
                    ) : null}
                    <ul>{line.needsYou.map((n) => <li key={`${n.kind}:${n.label}`}><Link href={n.href} className={cn(row, 'hover:text-primary')}><span className="truncate">{n.label}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
                </RailSection>
            ) : null}
        </div>
    )
}

/**
 * The child Dashboard's Team by unit (report §14.4): `Frontend developers · 3 (R)(A)(K) · 1 open seat`; opening a
 * unit lists the names with its lead ★. Names come from the dashboard's own (privacy-filtered) member list.
 */
export function ChildUnitsLine({ projectId, members }: { projectId: string; members: Array<{ id: string; fullName?: string | null; username?: string | null }> }) {
    const { data: units } = useQuery({ queryKey: ['child-units', projectId], queryFn: () => readWorkspaceUnitsAction(projectId), staleTime: 60_000 })
    if (!units?.length) return null
    const nameOf = (id: string) => { const m = members.find((x) => x.id === id); return m ? m.fullName || m.username || 'Member' : null }
    return (
        <section aria-label="Members by team" className="mb-4 space-y-1 text-sm">
            {units.map((unit) => {
                const names = unit.memberIds.map((id) => ({ id, name: nameOf(id) })).filter((p): p is { id: string; name: string } => Boolean(p.name))
                const open = Math.max(0, unit.count - unit.filled)
                return (
                    <details key={unit.id}>
                        <summary className="cursor-pointer text-muted-foreground">
                            <span className="font-medium text-foreground">{unit.title}</span> · {unit.memberIds.length}{' '}
                            {names.slice(0, 4).map((p) => <span key={p.id} aria-hidden="true" className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{p.name.slice(0, 1).toUpperCase()}</span>)}
                            {open ? ` · ${open} open ${open === 1 ? 'seat' : 'seats'}` : ''}
                        </summary>
                        <ul className="ml-4 mt-1 space-y-0.5">
                            {names.map((p) => <li key={p.id}>{p.name}{p.id === unit.leadUserId ? ' ★ team lead' : ''}</li>)}
                        </ul>
                    </details>
                )
            })}
        </section>
    )
}
