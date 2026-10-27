'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Pin } from 'lucide-react'

import { readChildOrgLineAction, readOrgDashboardAction, readOrgProjectsAction, type OrgProjectRow } from '@/app/actions/org-dashboard'
import { archiveChildAction } from '@/app/actions/organizations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RailSection } from '@/components/ui/rail-section'
import { toast } from '@/lib/feedback'
import { formatDistanceToNow } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

// Org Dashboard (report §27), Projects tab (§28) and the child project's org line (§22.5, §27.5).

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const row = 'flex min-w-0 items-center justify-between gap-3 py-1.5 text-sm'
const STATE: Record<string, string> = { not_started: 'not started', in_progress: 'in progress', submitted: 'Submitted', returned: 'Returned', done: 'Done', missing: 'Missing', excused: 'Excused' }
const FILTERS = [['all', 'All'], ['assignments', 'Assignments'], ['people', 'People'], ['files', 'Files & docs'], ['projects', 'Projects']] as const

/** The org Dashboard for people in the org (report §27). */
export function OrgDashboard({ orgId, orgSlug }: { orgId: string; orgSlug: string | null }) {
    const [filter, setFilter] = useState('all')
    // Refetch on focus and every 30 s while visible (report §27.4).
    const query = useQuery({ queryKey: ['org-dashboard', orgId, filter], queryFn: () => readOrgDashboardAction(orgId, filter), refetchInterval: 30_000, refetchOnWindowFocus: true })
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
                    <RailSection title="Needs you">
                        <ul>{data.needsYou.slice(0, 5).map((n) => <li key={`${n.kind}:${n.label}`}><Link href={n.href} className={cn(row, 'hover:text-primary')}><span className="truncate">{n.label}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
                        {data.needsYou.length > 5 ? <p className="text-[12px] text-muted-foreground">and {data.needsYou.length - 5} more</p> : null}
                    </RailSection>
                ) : null}
                <RailSection title={s.sprint ? `This sprint · ${s.sprint.name} · ends ${day(s.sprint.endDate)}` : 'This sprint'}>
                    {s.sprint ? (
                        s.items.length ? <ul>{s.items.map((i) => (
                            <li key={i.masterId} className={row}>
                                <span className="truncate">{i.title}{i.dueDate ? ` · due ${day(i.dueDate)}` : ''}</span>
                                <span className="shrink-0 text-[12px] text-muted-foreground">
                                    {i.counts ? `${i.counts.done} of ${i.counts.total} done${i.counts.missing ? ` · ${i.counts.missing} missing` : ''}` : i.own ? `${STATE[i.own.state] ?? i.own.state}${i.own.late ? ' · late' : ''}` : ''}
                                </span>
                            </li>
                        ))}</ul> : <p className="text-sm text-muted-foreground">No assignments in this sprint.</p>
                    ) : s.next ? <p className="text-sm text-muted-foreground">{s.next.name} starts {day(s.next.startDate)}.</p>
                        : data.role === 'admin' ? <Link href={`${base}?tab=sprints`} className="text-sm underline underline-offset-4">Plan your term</Link>
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
                <RailSection title="Projects" action={<Link href={`${base}?tab=projects`} className="text-[12px] underline underline-offset-4">See all →</Link>}>
                    {data.projects.length ? <ul>{data.projects.map((p) => <li key={p.id} className={row}><Link href={`/projects/${encodeURIComponent(p.slug ?? p.id)}`} className="truncate hover:underline">{p.title}</Link><span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ago(p.lastActivityAt)}</span></li>)}</ul>
                        : <p className="text-sm text-muted-foreground">{data.role === 'admin' ? 'No projects yet.' : "You're not in a project yet."}</p>}
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

/** Projects tab (report §28): a list with filters for everyone in the org; Needs attention and bulk Archive for admins. */
export function OrgProjectsTab({ orgId }: { orgId: string }) {
    const [data, setData] = useState<{ isAdmin: boolean; rows: OrgProjectRow[]; summary: { total: number; attention: number; quiet: number; notInProject: number } } | null>(null)
    const [q, setQ] = useState('')
    const [status, setStatus] = useState<'all' | 'attention' | 'quiet' | 'archived'>('all')
    const [visibility, setVisibility] = useState('all')
    const [mine, setMine] = useState(false)
    const [sort, setSort] = useState<'active' | 'name' | 'overdue'>('active')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readOrgProjectsAction(orgId).then((r) => setData(r.success ? r : null)), [orgId])
    useEffect(() => { load() }, [load])
    const rows = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return (data?.rows ?? []).filter((r) =>
            (!needle || r.title.toLowerCase().includes(needle) || r.lead?.name.toLowerCase().includes(needle))
            && (status === 'all' ? r.status !== 'archived' : status === 'archived' ? r.status === 'archived' : status === 'attention' ? r.reasons.length > 0 : r.reasons.includes('quiet 7 days'))
            && (visibility === 'all' || r.visibility === visibility)
            && (!mine || r.mine),
        ).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'overdue' ? b.overdue - a.overdue : b.lastActivityAt.localeCompare(a.lastActivityAt))
    }, [data, mine, q, sort, status, visibility])
    if (!data) return <p className="py-10 text-center text-sm text-muted-foreground">Loading projects…</p>
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
            <p className="text-sm">
                <button type="button" className="hover:underline" onClick={() => setStatus('all')}>{data.summary.total} projects</button>
                {data.isAdmin ? <>
                    {' · '}<button type="button" className="hover:underline" onClick={() => setStatus('attention')}>{data.summary.attention} need attention</button>
                    {' · '}<button type="button" className="hover:underline" onClick={() => setStatus('quiet')}>{data.summary.quiet} quiet</button>
                    {' · '}{data.summary.notInProject} members not in a project
                </> : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search projects" className="h-9 w-52" />
                <select aria-label="Status" className={sel} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                    <option value="all">Active</option>{data.isAdmin ? <option value="attention">Needs attention</option> : null}<option value="quiet">Quiet 7 days</option><option value="archived">Archived</option>
                </select>
                <select aria-label="Visibility" className={sel} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                    <option value="all">Any visibility</option><option value="org">Org only</option><option value="private">Private</option><option value="public">Public</option>
                </select>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine</label>
                <select aria-label="Sort" className={sel} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                    <option value="active">Recently active</option><option value="name">Name</option><option value="overdue">Most overdue</option>
                </select>
                {data.isAdmin && selected.size ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm(`Archive ${selected.size} ${selected.size === 1 ? 'project' : 'projects'}?`)) archive() }}>Archive {selected.size}</Button> : null}
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.length === 0 ? <li className="p-4 text-sm text-muted-foreground">{data.rows.length === 0 ? (data.isAdmin ? 'Create projects for your groups.' : 'No projects yet.') : 'No projects match.'}</li> : null}
                {rows.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                        {data.isAdmin ? <input type="checkbox" className="mt-1" aria-label={`Select ${r.title}`} checked={selected.has(r.id)} onChange={(e) => setSelected((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next })} /> : null}
                        <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-1.5">
                                <Link href={`/projects/${encodeURIComponent(r.slug ?? r.id)}`} className="font-medium hover:underline">{r.title}</Link>
                                <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">{r.visibility === 'org' ? 'Org only' : r.visibility === 'private' ? 'Private' : 'Public'}</span>
                                <span className="text-muted-foreground">{r.lead?.name} (lead) · {r.members} {r.members === 1 ? 'member' : 'members'}{r.units ? ` · ${r.units} units` : ''}</span>
                            </p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {r.open} open · {r.overdue} overdue · {r.inReview} in review
                                {r.groupCopy ? ` · ${r.groupCopy.title}: ${STATE[r.groupCopy.state] ?? r.groupCopy.state}` : ''}
                            </p>
                            {r.reasons.length ? <p className="mt-0.5 text-[12px] text-destructive">⚠ Needs attention: {r.reasons.join(' · ')}</p> : null}
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">active {ago(r.lastActivityAt)}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}

/** `Part of CSE-3A · CO2 ends Fri · 1 assignment due` at the top of a child project's Dashboard. */
export function ChildOrgLine({ projectId }: { projectId: string }) {
    const { data: line } = useQuery({ queryKey: ['child-org-line', projectId], queryFn: () => readChildOrgLineAction(projectId), staleTime: 60_000 })
    if (!line) return null
    return (
        <p className="mb-4 text-sm text-muted-foreground">
            Part of <Link href={`/org/${encodeURIComponent(line.orgSlug ?? '')}`} className="font-medium text-foreground hover:underline">{line.orgTitle}</Link>
            {line.sprint ? ` · ${line.sprint.name} ends ${day(line.sprint.endDate)}` : ''}
            {line.dueCount ? ` · ${line.dueCount} ${line.dueCount === 1 ? 'assignment' : 'assignments'} due` : ''}
        </p>
    )
}
