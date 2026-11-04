'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeCheck, BookOpenText, CalendarClock, Check, ClipboardCheck, Clock, CornerDownLeft, Flag, FolderKanban, IterationCcw, ListTodo, Megaphone, MoreHorizontal, Plus, ShieldAlert, UserPlus, Users, UserX, X, type LucideIcon } from 'lucide-react'

import { dismissWelcomeAction, hidePinnedForMeAction, readChildOrgLineAction, readOrgDashboardAction } from '@/app/actions/org-dashboard'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { readWorkspaceUnitsAction } from '@/app/actions/child-units'
import { Button } from '@/components/ui/button'
import { RailSection } from '@/components/ui/rail-section'
import { ActivityItem } from '@/components/ui/activity-item'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { approveJoinRequestsAction } from '@/app/actions/org-members'
import { decideParentVerificationAction } from '@/app/actions/trust'
import { StartNowButton } from '@/components/organizations/OrgSprintParts'
import { toggleWorkspaceUpdatePinAction } from '@/app/actions/workspace/updates'
import { formatInZone } from '@/lib/organizations/zoned-time'
import type { OrgDashboardData } from '@/app/actions/org-dashboard'
import type { TodayRow } from '@/lib/organizations/dashboard-rules'
import { WorkspaceLastUpdate } from '@/components/workspaces/WorkspaceLastUpdate'
import { toast } from '@/lib/feedback'
import { activityMatches } from '@/lib/organizations/activity-rules'
import { serverFirst } from '@/lib/server-first'
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast'
import { liveTopics } from '@/lib/realtime/subscriptions'
import { typeProfile } from '@/lib/organizations/type-profile'
import { formatDistanceToNow } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'

// Org Dashboard (report §27), Projects tab (§28) and the child project's org line (§22.5, §27.5).

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const row = 'flex min-w-0 items-center justify-between gap-3 py-1.5 text-sm'
const FILTERS = [['all', 'All'], ['assignments', 'Assignments'], ['people', 'People'], ['files', 'Files and docs'], ['projects', 'Workspaces']] as const

const DAY = 86_400_000
// Today rows (report §7.2): an icon by type and the word for what you'd do.
const TODAY_ICON: Record<string, LucideIcon> = { review: ClipboardCheck, requests: UserPlus, reports: Flag, sprint: IterationCcw, complete_sprint: IterationCcw, plan_sprint: IterationCcw, sprint_ending: IterationCcw, sprint_dates: CalendarClock, autostart: AlertTriangle, lead: UserX, full: AlertTriangle, join_spike: ShieldAlert, verify: BadgeCheck, verify_child: BadgeCheck, term_end: BadgeCheck, overdue: Clock, due: Clock, due_today: Clock, returned: CornerDownLeft, doc: BookOpenText, announcement: Megaphone, team: Users, unplaced: Users, needs_projects: FolderKanban, group: FolderKanban }
const TODAY_ACTION: Record<string, string> = { review: 'Review', requests: 'Review', reports: 'Review', sprint: 'Complete', complete_sprint: 'Complete', plan_sprint: 'Plan', sprint_ending: 'Open', sprint_dates: 'Fix', autostart: 'Fix', lead: 'Assign', full: 'Manage', join_spike: 'Review', verify: 'Verify', term_end: 'Review', overdue: 'Open', due: 'Open', due_today: 'Open', returned: 'Fix', doc: 'Read', announcement: 'Read', team: 'Place', unplaced: 'Place', needs_projects: 'Create', group: 'Open' }
const TASK_STATUS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done', blocked: 'Blocked' }

function PinnedRow({ orgId, base, pinned, onChanged }: { orgId: string; base: string; pinned: NonNullable<OrgDashboardData['pinned']>; onChanged: () => void }) {
    const [gone, setGone] = useState(false)
    const [pending, start] = useTransition()
    if (gone) return null
    return (
        <div className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-[5px] border border-border bg-muted/30 px-3" data-testid="org-pinned">
            <Megaphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <UserAvatar identity={{ fullName: pinned.authorName, avatarUrl: pinned.authorAvatarUrl }} size={20} roundedClassName="rounded-full" title={pinned.authorName} />
            <Link href={`${base}?tab=updates&updateId=${pinned.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">{pinned.content}</Link>
            {pinned.unread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" role="img" aria-label="Unread" /> : null}
            <time dateTime={pinned.at} className="shrink-0 font-mono text-[11px] text-muted-foreground">{ago(pinned.at)}</time>
            {pinned.canUnpin ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" aria-label="Pinned announcement options" className="rounded p-1 text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={pending} onSelect={() => start(async () => {
                            const r = await toggleWorkspaceUpdatePinAction(orgId, pinned.id, false)
                            if (!r.success) return void toast.error(r.error ?? 'Couldn’t unpin it.')
                            setGone(true)
                            onChanged()
                        })}>Unpin</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
            {/* × hides it for you only, remembered on your account (owner decision, 3 Nov 2026). */}
            <button type="button" aria-label="Hide for me" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => { setGone(true); void hidePinnedForMeAction(orgId, pinned.id) }}><X className="size-3.5" /></button>
        </div>
    )
}

function TodayItem({ orgId, n, onChanged }: { orgId: string; n: TodayRow; onChanged: () => void }) {
    const [pending, start] = useTransition()
    const Icon = TODAY_ICON[n.kind] ?? ListTodo
    return (
        <li className="flex min-w-0 items-center gap-2.5 py-1">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Link href={n.href} className="min-w-0 flex-1 hover:text-primary">
                <span className={cn('block truncate text-sm font-medium', n.tone === 'amber' && 'text-amber-700 dark:text-amber-400')}>{n.title ?? n.label}</span>
                {n.detail ? <span className="block truncate text-[12px] text-muted-foreground">{n.detail}</span> : null}
            </Link>
            {n.confirmChildId ? <ConfirmChild parentId={orgId} childId={n.confirmChildId} onChanged={onChanged} /> : n.approveId ? (
                // One request: approve it right here (report §7.2).
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
                    const r = await approveJoinRequestsAction(orgId, [n.approveId!])
                    if (!r.success) return void toast.error(r.error ?? 'Couldn’t approve.')
                    toast.success('Approved')
                    onChanged()
                })}>Approve</Button>
            ) : <Link href={n.href} className="shrink-0 text-[12px] text-primary hover:underline">{TODAY_ACTION[n.kind] ? `${TODAY_ACTION[n.kind]} →` : <span aria-hidden="true">→</span>}</Link>}
        </li>
    )
}

/**
 * Verified badge way 2 (2026-11-05 findings §5): an organization naming this one as "Part of" asks it to confirm
 * it. Confirm gives it a ✓ "Part of <this organization>"; Decline asks for an optional reason it will read.
 */
function ConfirmChild({ parentId, childId, onChanged }: { parentId: string; childId: string; onChanged: () => void }) {
    const [pending, start] = useTransition()
    const [declining, setDeclining] = useState(false)
    const [reason, setReason] = useState('')
    const decide = (approve: boolean) => start(async () => {
        const r = await decideParentVerificationAction(parentId, childId, approve, reason)
        if (!r.success) return void toast.error(r.error)
        toast.success(approve ? 'Confirmed. It’s verified.' : 'Declined')
        onChanged()
    })
    return declining ? (
        <span className="flex shrink-0 items-center gap-1.5">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (optional)" aria-label="Reason for declining"
                className="h-8 w-36 rounded-md border border-border bg-background px-2 text-[12px]" />
            <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => decide(false)}>Decline</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(false)}>Cancel</Button>
        </span>
    ) : (
        <span className="flex shrink-0 items-center gap-1.5">
            <Button type="button" size="sm" disabled={pending} onClick={() => decide(true)}>Confirm</Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(true)}>Decline</Button>
        </span>
    )
}

/** This week's date tile (report §7.2): SUN / 8, in the organization's zone. */
function DateTile({ iso, timeZone }: { iso: string; timeZone: string | null }) {
    const d = new Date(iso)
    return (
        <span className="flex w-9 shrink-0 flex-col items-center rounded-[4px] border border-border py-0.5 leading-none">
            <span className="font-mono text-[9px] uppercase text-muted-foreground">{formatInZone(d, { weekday: 'short' }, timeZone)}</span>
            <span className="text-[13px] font-semibold">{formatInZone(d, { day: 'numeric' }, timeZone)}</span>
        </span>
    )
}

function SprintCard({ orgId, base, s, isAdmin, planLabel, onChanged }: { orgId: string; base: string; s: OrgDashboardData['thisSprint']; isAdmin: boolean; planLabel: string; onChanged: () => void }) {
    const sprint = s.sprint
    const daysLeft = sprint ? Math.max(0, Math.ceil((new Date(sprint.endDate).getTime() - Date.now()) / DAY)) : 0
    const percent = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0
    return (
        <RailSection title="This sprint" action={<Link href={`${base}?tab=sprints`} className="text-[12px] underline underline-offset-4">All sprints →</Link>}>
            {sprint ? (
                <div className="space-y-2.5 rounded-lg border border-border bg-card p-3.5" data-testid="org-sprint-card">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link href={`${base}?tab=sprints&sprintId=${sprint.id}`} className="min-w-0 truncate font-semibold hover:underline">{sprint.name}</Link>
                        <span className="nb-tag">{sprint.status === 'ended' ? 'Ended' : 'Running'}</span>
                        <span className="ml-auto font-mono text-[12px] text-muted-foreground">
                            {sprint.status === 'ended' ? (isAdmin ? <Link href={`${base}?tab=sprints&sprintId=${sprint.id}`} className="text-primary underline underline-offset-4">Complete</Link> : `${sprint.name} ended`) : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
                        </span>
                    </div>
                    {sprint.goal ? <p className="line-clamp-2 text-sm text-muted-foreground">{sprint.goal}</p> : null}
                    {s.progress.total ? (
                        <div className="space-y-1">
                            <div role="progressbar" aria-label="Sprint progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div>
                            <p className="font-mono text-[11px] text-muted-foreground">{s.progress.done} of {s.progress.total} tasks done</p>
                        </div>
                    ) : null}
                    {s.items.length || s.tasks.length ? (
                        <ul className="divide-y divide-border">
                            {s.items.map((i) => (
                                <li key={i.masterId} className={row}>
                                    <span className="flex min-w-0 items-center gap-2"><ClipboardCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><Link href={`${base}?tab=tasks&drawerType=task&drawerId=${i.masterId}`} className="truncate hover:underline">{i.title}</Link></span>
                                    <span className="shrink-0 text-[12px] text-muted-foreground">
                                        {i.dueDate ? `Due ${day(i.dueDate)}${i.own?.extended ? ' · Extended' : ''} · ` : ''}
                                        {/* Admins: the 12/40 badge opens the assignment, where its Roster is (report §7.2). */}
                                        {i.counts ? (i.counts.total === 0 ? <Link href={`${base}?tab=members`} className="text-primary underline underline-offset-4">Nobody has joined yet</Link>
                                            : <Link href={`${base}?tab=tasks&drawerType=task&drawerId=${i.masterId}`} aria-label={`Roster for ${i.title}`} className="nb-tag hover:underline">{i.counts.done}/{i.counts.total}{i.counts.missing ? ` · ${i.counts.missing} missing` : ''}</Link>)
                                            : i.own ? `${ASSIGNMENT_STATE_LABELS[i.own.state] ?? i.own.state}${i.own.late ? ' · late' : ''}` : ''}
                                    </span>
                                </li>
                            ))}
                            {s.tasks.map((t) => (
                                <li key={t.id} className={row}>
                                    <span className="flex min-w-0 items-center gap-2"><ListTodo className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><Link href={`${base}?tab=tasks&drawerType=task&drawerId=${t.id}`} className="truncate hover:underline">{t.title}</Link></span>
                                    <span className="shrink-0 text-[12px] text-muted-foreground">{[t.assignee, TASK_STATUS[t.status] ?? t.status].filter(Boolean).join(' · ')}</span>
                                </li>
                            ))}
                        </ul>
                    ) : isAdmin ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">Nothing in this sprint yet. <Link href={`${base}?tab=tasks&new=1`} className="text-primary underline underline-offset-4">Add task</Link></p>
                    ) : <p className="text-sm text-muted-foreground">Nothing assigned yet.</p>}
                </div>
            ) : s.next ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{s.next.status === 'planning' ? `${s.next.name} starts ${day(s.next.startDate)}.` : `Next: ${s.next.name} starts ${day(s.next.startDate)}.`}</span>
                    {/* Planned, not started (report §7.2): admins can start it now. */}
                    {isAdmin && s.next.status === 'planning' ? <StartNowButton projectId={orgId} sprintId={s.next.id} onStarted={onChanged} announceAs={s.next.name} /> : null}
                </div>
            )
                : isAdmin ? <Link href={`${base}?tab=sprints`} className="text-sm underline underline-offset-4">{planLabel}</Link>
                    : <p className="text-sm text-muted-foreground">No sprint right now.</p>}
        </RailSection>
    )
}

/** The org Dashboard for people in the org (report §27). */
export function OrgDashboard({ orgId, orgSlug, orgType = null, started = null }: { orgId: string; orgSlug: string | null; orgType?: string | null; started?: ReturnType<typeof readOrgDashboardAction> | null }) {
    const [filter, setFilter] = useState('all')
    const [moreToday, setMoreToday] = useState(false)
    const [moreActivity, setMoreActivity] = useState(false)
    const [welcomeClosed, setWelcomeClosed] = useState(false)
    const client = useQueryClient()
    // Refetch on focus and every 2 minutes while visible.
    // The page started this read on the server (a browser runs actions one at a time); the filter applies here.
    const [read] = useState(() => serverFirst(started, () => readOrgDashboardAction(orgId)))
    const query = useQuery({ queryKey: ['org-dashboard', orgId], queryFn: read, refetchInterval: 120_000, refetchOnWindowFocus: true })
    const base = `/org/${encodeURIComponent(orgSlug ?? orgId)}`
    const activity = query.data?.success ? query.data.activity.filter((a) => activityMatches(filter, a.kind)) : []
    // Report §32.4, decision 76: other people's changes show by themselves; bursts are combined over 2 seconds.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null
        const reload = () => { if (!timer) timer = setTimeout(() => { timer = null; void client.invalidateQueries({ queryKey: ['org-dashboard', orgId] }) }, 2_000) }
        const subscriptions = [subscribeBroadcast(liveTopics.tasks(orgId), reload), subscribeBroadcast(liveTopics.workspace(orgId), reload)]
        return () => { subscriptions.forEach((s) => s.unsubscribe()); if (timer) clearTimeout(timer) }
    }, [client, orgId])
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
                {/* Mockup task 5: a greeting with the week of the term. */}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{data.greeting}</h2>
                    {data.weekLine ? <p className="font-mono text-[12px] text-muted-foreground" data-testid="org-week-line">{data.weekLine}</p> : null}
                </div>
                {/* Report §29.2: everyone inside sees it; the owner's reason and Appeal live in Settings → Moderation. */}
                {data.restricted ? <p role="status" className="rounded-[5px] border border-border bg-muted/40 px-3 py-2 text-sm">This organization is restricted for now.</p> : null}
                {data.archivedSummary ? <p className="text-sm text-muted-foreground" data-testid="org-archived-summary">{data.archivedSummary}{data.termSummary?.completedPercent != null ? ` · ${data.termSummary.completedPercent}% of work completed` : ''}</p> : null}
                {data.termSummary?.mine ? <p className="text-sm" data-testid="org-term-mine">Your record: {data.termSummary.mine.done} of {data.termSummary.mine.total} done</p> : null}
                {data.welcome && !welcomeClosed ? (
                    // Report §26.7, decision 49: once after joining; × hides it for good.
                    <section aria-label="Welcome" className="rounded-lg border border-border bg-card p-4" data-testid="org-welcome">
                        <div className="flex items-start justify-between gap-3">
                            <h2 className="nb-card-title">Welcome</h2>
                            <button type="button" aria-label="Close welcome" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => { setWelcomeClosed(true); void dismissWelcomeAction(orgId) }}><X className="size-4" /></button>
                        </div>
                        {data.welcome.note ? <p className="mt-1 whitespace-pre-line text-sm">{data.welcome.note}</p> : null}
                        {data.welcome.start.length ? <ul className="mt-3">{data.welcome.start.map((r) => <li key={r.href}><Link href={r.href} className={cn(row, 'hover:text-primary')}><span className="truncate">{r.label}</span><span aria-hidden="true">→</span></Link></li>)}</ul> : null}
                        {data.welcome.addToProfile ? <Link href="/profile/edit?section=experience" className="mt-3 inline-block text-[13px] font-medium text-primary hover:underline">Add to your profile</Link> : null}
                    </section>
                ) : null}
                {data.catchUp ? (
                    // Report §33.5: Catch up for a late joiner, earlier sprints and their materials, with nothing to hand in.
                    <section aria-label="Catch up" className="rounded-lg border border-border bg-card p-4" data-testid="org-catch-up">
                        <h2 className="nb-card-title">Catch up</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{data.catchUp.line}</p>
                        <ul className="mt-2 space-y-2 text-sm">
                            {data.catchUp.sprints.map((s) => (
                                <li key={s.id}>
                                    <Link href={`${base}?tab=sprints&sprintId=${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                                    {s.materials.length ? <ul className="ml-3 mt-0.5 space-y-0.5">{s.materials.map((m) => <li key={m.href}><Link href={m.href} className="text-muted-foreground hover:text-foreground hover:underline">{m.name}</Link></li>)}</ul> : null}
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}
                {data.pinned ? <PinnedRow orgId={orgId} base={base} pinned={data.pinned} onChanged={() => void query.refetch()} /> : null}
                {data.getStarted.length ? (
                    // Report §7.2, decision 7: three cards while the organization is empty, each opening the real form.
                    <RailSection title="Get started">
                        <ul className="grid gap-2 sm:grid-cols-3">
                            {data.getStarted.map((card) => {
                                const [label, href, Icon] = card === 'invite' ? ['Invite people', `${base}?tab=members`, UserPlus] as const
                                    : card === 'sprint' ? ['Plan your first sprint', `${base}?tab=sprints`, IterationCcw] as const
                                    : ['Create the first workspace', `/workspaces/new?org=${encodeURIComponent(orgSlug ?? orgId)}`, FolderKanban] as const
                                return <li key={card}><Link href={href} className="flex h-full items-center gap-2 rounded-lg border border-border p-3 text-sm hover:bg-muted"><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{label}</Link></li>
                            })}
                        </ul>
                        {/* Report §45.8: the teacher guide, from the empty Overview. */}
                        <p className="mt-2 text-[13px] text-muted-foreground"><Link href="/help/running-a-class" className="underline underline-offset-4 hover:text-foreground">Running a class on NetworkBase</Link></p>
                    </RailSection>
                ) : null}
                {data.role !== 'guest' ? (
                    // Report §33.5, decision 80: Today takes over Needs your attention; 5 rows, then the rest on request.
                    <RailSection title="Today">
                        {data.today.length ? (
                            <>
                                <ul className="space-y-1">{(moreToday ? data.today : data.today.slice(0, 5)).map((n) => <TodayItem key={`${n.kind}:${n.label}`} orgId={orgId} n={n} onChanged={() => void query.refetch()} />)}</ul>
                                {!moreToday && data.today.length > 5 ? <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => setMoreToday(true)}>Show {data.today.length - 5} more</button> : null}
                            </>
                        ) : <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Check className="size-3.5" aria-hidden="true" />{data.role === 'admin' ? 'Nothing needs you today' : 'Nothing due in the next 2 days'}</p>}
                    </RailSection>
                ) : null}
                {data.standing ? (
                    // Decision 81: admins only; each count opens Members filtered.
                    <RailSection title={`How the ${data.standingWord} is doing`}>
                        {/* Mockup task 5: one bar in three parts, then each number large, each opening Members filtered. */}
                        <div className="flex h-2 gap-0.5 overflow-hidden rounded-[3px] bg-muted" role="img" aria-label={`${data.standing.onTrack} on track, ${data.standing.behind} behind, ${data.standing.inactive} inactive`}>
                            {data.standing.onTrack ? <div className="bg-[var(--status-success)]" style={{ flex: data.standing.onTrack }} /> : null}
                            {data.standing.behind ? <div className="bg-[var(--status-warning)]" style={{ flex: data.standing.behind }} /> : null}
                            {data.standing.inactive ? <div className="bg-muted-foreground" style={{ flex: data.standing.inactive }} /> : null}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3">
                            <Link href={`${base}?tab=members`} className="hover:underline"><span className="block text-[20px] font-semibold">{data.standing.onTrack}</span><span className="text-[13px] text-muted-foreground">On track</span></Link>
                            <Link href={`${base}?tab=members&status=behind`} className="hover:underline"><span className="block text-[20px] font-semibold text-[var(--status-warning)]">{data.standing.behind}</span><span className="text-[13px] text-muted-foreground">Behind</span></Link>
                            <Link href={`${base}?tab=members&status=inactive`} className="hover:underline"><span className="block text-[20px] font-semibold">{data.standing.inactive}</span><span className="text-[13px] text-muted-foreground">Inactive</span></Link>
                        </div>
                    </RailSection>
                ) : null}
                <SprintCard orgId={orgId} base={base} s={s} isAdmin={data.role === 'admin'} planLabel={typeProfile(orgType).planLabel} onChanged={() => void query.refetch()} />
            </div>
            <aside aria-label="Organization details" className="min-w-0 space-y-6 lg:col-span-4">
                {/* Mockup task 5: This week heads the right column and Activity closes it, as drawn. */}
                <RailSection title="This week">
                    {/* Decision 80: calendar days in the organization's zone, grouped Today, Tomorrow, This week. */}
                    {data.thisWeek.length ? (['Today', 'Tomorrow', 'This week'] as const).map((group) => {
                        const rows = data.thisWeek.filter((c) => c.group === group)
                        // The section is already called This week, so its own group needs no second label (problem 15).
                        return rows.length ? <div key={group}>{group !== 'This week' ? <p className="nb-micro mt-2 text-muted-foreground">{group}</p> : null}<ul className="space-y-1.5 pt-1">{rows.slice(0, 5).map((c) => (
                            <li key={`${c.date}:${c.label}`} className="flex min-w-0 items-center gap-3 text-sm">
                                <DateTile iso={c.date} timeZone={data.timeZone} />
                                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                {c.kind === 'sprint' ? <IterationCcw className="size-3.5 shrink-0 text-muted-foreground" aria-label="Sprint" /> : <ListTodo className="size-3.5 shrink-0 text-muted-foreground" aria-label="Due" />}
                            </li>
                        ))}</ul></div> : null
                    }) : <p className="text-sm text-muted-foreground">Nothing due in the next 7 days.</p>}
                    {data.thisWeek.length ? <Link href={`${base}?tab=tasks`} className="mt-2 inline-block text-[12px] underline underline-offset-4">See all →</Link> : null}
                </RailSection>
                <RailSection title="Workspaces" action={
                    <span className="flex items-center gap-2">
                        {data.role === 'admin' ? <Link href={`/workspaces/new?org=${encodeURIComponent(orgSlug ?? orgId)}`} aria-label="New workspace" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-3.5" aria-hidden="true" /></Link> : null}
                        <Link href={`${base}?tab=projects`} className="text-[12px] underline underline-offset-4">See all</Link>
                    </span>
                }>
                    {data.projects.length ? <ul className="space-y-1">{data.projects.map((p) => (
                        <li key={p.id}>
                            <Link href={`/workspaces/${encodeURIComponent(p.slug ?? p.id)}`} className="flex min-w-0 items-center gap-2.5 rounded-[5px] py-1.5 hover:bg-muted/50">
                                <WorkspaceAvatar project={{ title: p.title, coverImage: p.coverImage }} size="row" placeholder />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{p.title}</span>
                                    <span className="block truncate text-[12px] text-muted-foreground">{[p.lead, `${p.members} ${p.members === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}</span>
                                </span>
                                {p.overdue ? <span className="nb-tag shrink-0 text-amber-700 dark:text-amber-400">{p.overdue} overdue</span> : <WorkspaceLastUpdate projectId={p.id} timeOnly className="shrink-0 font-mono text-[11px] text-muted-foreground" />}
                            </Link>
                        </li>
                    ))}</ul> : data.role === 'admin'
                        ? <p className="text-sm text-muted-foreground">Teams work inside workspaces. <Link href={`/workspaces/new?org=${encodeURIComponent(orgSlug ?? orgId)}`} className="text-primary underline underline-offset-4">Create the first workspace</Link></p>
                        : <p className="text-sm text-muted-foreground">You’re not in a workspace yet.</p>}
                </RailSection>
                <RailSection title="People">
                    {data.role === 'admin' && data.people.total <= 1 && !data.people.requests ? (
                        // Only you (report §7.2): a short invite panel instead of a list of one.
                        <OrgInvitePanel orgId={orgId} orgHandle={orgSlug} />
                    ) : (
                        <Link href={`${base}?tab=members`} className="block space-y-1.5 hover:opacity-90">
                            <span className="flex -space-x-1.5">{data.people.avatars.slice(0, 6).map((p) => <UserAvatar key={p.id} identity={{ id: p.id, fullName: p.name, avatarUrl: p.avatarUrl }} size={24} roundedClassName="rounded-full" className="ring-2 ring-card" title={p.name} />)}</span>
                            <span className="block text-sm">{data.people.total} {data.people.total === 1 ? 'member' : 'members'}{data.people.joinedThisWeek ? ` · ${data.people.joinedThisWeek} joined this week` : ''}</span>
                        </Link>
                    )}
                    {data.people.requests && data.role === 'admin' ? <Link href={`${base}?tab=members`} className="nb-tag mt-2 inline-flex">{data.people.requests} {data.people.requests === 1 ? 'request' : 'requests'}</Link> : null}
                </RailSection>
                <RailSection title="Activity" action={
                    // One small menu (problem 16), not a row of buttons.
                    <select aria-label="Filter activity" value={filter} onChange={(e) => { setFilter(e.target.value); setMoreActivity(false) }} className="h-7 rounded-[4px] border border-border bg-background px-1.5 text-[12px] text-muted-foreground">
                        {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                }>
                    {activity.length ? (
                        <>
                            <ol className="space-y-3">{(moreActivity ? activity : activity.slice(0, 5)).map((a) => <ActivityItem key={a.id} kind={a.kind} text={a.text} subject={a.subject} href={a.href} at={a.at} />)}</ol>
                            {!moreActivity && activity.length > 5 ? <button type="button" className="mt-2 text-[12px] text-primary hover:underline" onClick={() => setMoreActivity(true)}>Show more</button> : null}
                        </>
                    ) : <p className="text-sm text-muted-foreground">Activity shows here once people start working.</p>}
                </RailSection>
            </aside>
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
            {line.github ? <p className="text-[12px] text-muted-foreground" data-testid="child-github-line">Synced to <span className="font-mono">{line.github.repo}</span>{line.github.syncedAt ? ` · ${ago(line.github.syncedAt)}` : ''}</p> : null}
            {/* What's happening = Needs you + This sprint (report §27.5); Activity stays in the rail. */}
            {line.needsYou.length || line.ownSprint ? (
                <RailSection title="What’s happening">
                    {line.ownSprint ? (
                        <p className={row} data-testid="child-this-sprint">
                            <span className="truncate">This sprint · {line.ownSprint.name}</span>
                            <span className="shrink-0 text-[12px] text-muted-foreground">{line.ownSprint.parent ? `Inside ${line.ownSprint.parent} (${line.orgTitle}) · ` : ''}ends {day(line.ownSprint.endDate)}</span>
                        </p>
                    ) : null}
                    <ul>{line.needsYou.map((n) => <li key={`${n.kind}:${n.label}`}><Link href={n.href} className={cn(row, 'hover:text-primary')}><span className={cn('truncate', n.tone === 'amber' && 'text-amber-700 dark:text-amber-400')}>{n.label}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
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
