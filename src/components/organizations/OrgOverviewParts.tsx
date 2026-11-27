'use client'

import { NextEventCard } from '@/components/organizations/CommunityEvents'
import { CurrentChallengeCard } from '@/components/organizations/CommunityChallenges'
import { NeedsReviewCard, WhatsNewCard } from '@/components/organizations/CompanyParts'
import { CompanyGoalsCard } from '@/components/organizations/CompanyGoals'
import { StartHere } from '@/components/organizations/CompanyOnboarding'
import { AskTeamCard } from '@/components/organizations/CompanyRequests'
import { CommunityFrontDoor } from '@/components/organizations/CommunityFrontDoor'
import { ClubMeetingCard, CommitteeCard, ElectionCard, HandoverCard, RecruitingCard, RenewalCard } from '@/components/organizations/Club'
import { LabHomeCard } from '@/components/organizations/Lab'
import { LabProtocolsCard } from '@/components/organizations/LabProtocols'
import { LabEquipmentCard } from '@/components/organizations/LabEquipment'
import { LabPapersCard } from '@/components/organizations/LabPapers'
import { LabLibraryCard } from '@/components/organizations/LabLibrary'
import { LabMeetingCard } from '@/components/organizations/LabMeeting'
import { LabProgressCard, MyProgressCard } from '@/components/organizations/LabProgress'
import { ConcernsCard, LabCountsCard } from '@/components/organizations/LabReviews'
import { SchoolAttentionCard } from '@/components/organizations/SchoolParts'
import { ClassNextLine } from '@/components/organizations/ClassHomeParts'
import { YourSectionCard } from '@/components/organizations/Sections'
import { CompletionLine } from '@/components/organizations/Completion'
import { MentoringCard } from '@/components/organizations/Mentoring'
import { MyPrepCard } from '@/components/organizations/MockScores'
import { DemoDayCard } from '@/components/organizations/DemoDay'
import { ThisWeekAtSchool } from '@/components/organizations/SchoolYear'
import { YourAttendanceLine } from '@/components/organizations/Attendance'
import { useEffect, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BadgeCheck, BookOpenText, CalendarClock, Check, ChevronRight, ClipboardCheck, Clock, CornerDownLeft, Flag, FolderKanban, IterationCcw, ListTodo, Megaphone, MoreHorizontal, Plus, ShieldAlert, Star, UserPlus, Users, UserX, X, type LucideIcon } from 'lucide-react'

import { dismissWelcomeAction, hidePinnedForMeAction, readChildOrgLineAction, readOrgDashboardAction, readOrgPeopleAction } from '@/app/actions/org-dashboard'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { readWorkspaceUnitsAction } from '@/app/actions/child-units'
import { Button } from '@/components/ui/button'
import { RailSection } from '@/components/ui/rail-section'
import { ActivityItem } from '@/components/ui/activity-item'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { approveJoinRequestsAction } from '@/app/actions/org-members'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Input } from '@/components/ui/input'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { Notice } from '@/components/ui/notice'
import { useBottomStickyRail } from '@/hooks/useBottomStickyRail'
import { AvatarStack, OrgCard, PinnedLine, StatusBadge, WelcomeNote, WorkspaceRow } from '@/components/organizations/org-ui'
import { sprintStatusLabel } from '@/lib/organizations/display'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { useReloadOnNotice } from '@/hooks/useReloadOnNotice'

// Org Dashboard (report §27), Projects tab (§28) and the child project's org line (§22.5, §27.5).

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })
/** A short day in the organization's zone; without one, the reader's own (report §7.2). */
const dayIn = (iso: string, timeZone: string | null | undefined) => timeZone
    ? formatInZone(iso, { weekday: 'short', month: 'short', day: 'numeric' }, timeZone)
    : new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
const row = 'flex min-h-9 min-w-0 items-center justify-between gap-3 py-1.5 text-[13px]'
const FILTERS = [['all', 'All'], ['assignments', 'Assignments'], ['people', 'People'], ['files', 'Files and documents'], ['projects', 'Workspaces']] as const

const DAY = 86_400_000
// Today rows (report §7.2): an icon by type and the word for what you'd do.
const TODAY_ICON: Record<string, LucideIcon> = { review: ClipboardCheck, requests: UserPlus, reports: Flag, sprint: IterationCcw, complete_sprint: IterationCcw, plan_sprint: IterationCcw, sprint_ending: IterationCcw, sprint_dates: CalendarClock, autostart: AlertTriangle, lead: UserX, full: AlertTriangle, join_spike: ShieldAlert, verify: BadgeCheck, verify_child: BadgeCheck, term_end: BadgeCheck, overdue: Clock, due: Clock, due_today: Clock, returned: CornerDownLeft, doc: BookOpenText, announcement: Megaphone, team: Users, unplaced: Users, needs_projects: FolderKanban, group: FolderKanban, stuck: AlertTriangle }
const TODAY_ACTION: Record<string, string> = { review: 'Review', requests: 'Review', reports: 'Review', sprint: 'Complete', complete_sprint: 'Complete', plan_sprint: 'Plan', sprint_ending: 'Open', sprint_dates: 'Fix', autostart: 'Fix', lead: 'Assign', full: 'Manage', join_spike: 'Review', verify: 'Verify', term_end: 'Review', overdue: 'Open', due: 'Open', due_today: 'Open', returned: 'Fix', doc: 'Read', announcement: 'Read', team: 'Place', unplaced: 'Place', needs_projects: 'Create', group: 'Open', stuck: 'Help' }
const TASK_STATUS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done', blocked: 'Blocked' }

function PinnedRow({ orgId, base, pinned, onChanged }: { orgId: string; base: string; pinned: NonNullable<OrgDashboardData['pinned']>; onChanged: () => void }) {
    const [gone, setGone] = useState(false)
    const [pending, start] = useTransition()
    if (gone) return null
    return (
        <PinnedLine href={`${base}?tab=updates&updateId=${pinned.id}`} author={{ name: pinned.authorName, avatarUrl: pinned.authorAvatarUrl }} content={pinned.content} at={pinned.at} unread={pinned.unread} testId="org-pinned" end={<>
            {pinned.canUnpin ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="nb-touch-target text-muted-foreground" aria-label="Pinned announcement options"><MoreHorizontal className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
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
            <Button type="button" variant="ghost" size="icon-sm" className="nb-touch-target text-muted-foreground" aria-label="Hide for me" onClick={() => { setGone(true); void hidePinnedForMeAction(orgId, pinned.id) }}><X className="size-4" aria-hidden="true" /></Button>
        </>} />
    )
}

function TodayItem({ orgId, n, onChanged }: { orgId: string; n: TodayRow; onChanged: () => void }) {
    const [pending, start] = useTransition()
    const Icon = TODAY_ICON[n.kind] ?? ListTodo
    return (
        <li className="flex min-h-11 min-w-0 items-center gap-2.5 py-1.5">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Link href={n.href} className="min-w-0 flex-1 hover:underline">
                <span className={cn('block truncate text-[13px] font-medium', n.tone === 'amber' ? 'text-[var(--status-warning)]' : 'text-foreground')}>{n.title ?? n.label}</span>
                {n.detail ? <span className="block truncate text-[12px] text-muted-foreground">{n.detail}</span> : null}
            </Link>
            {/* One action style for the list (spec §10): a small outline button. */}
            {n.confirmChildId ? <ConfirmChild parentId={orgId} childId={n.confirmChildId} onChanged={onChanged} /> : n.approveId ? (
                // One request: approve it right here (report §7.2).
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
                    const r = await approveJoinRequestsAction(orgId, [n.approveId!])
                    if (!r.success) return void toast.error(r.error ?? 'Couldn’t approve.')
                    toast.success(r.approved ? 'Approved' : 'They stay waiting: they’re in 50 organizations')
                    onChanged()
                })}>Approve</Button>
            ) : <Button asChild size="sm" variant="outline" className="shrink-0"><Link href={n.href}>{TODAY_ACTION[n.kind] ?? 'Open'}</Link></Button>}
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
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            <label className="sr-only" htmlFor={`decline-${childId}`}>Reason for declining</label>
            <Input id={`decline-${childId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (optional)" className="h-7 w-40 text-[13px]" />
            <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => decide(false)}>Decline</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(false)}>Cancel</Button>
        </span>
    ) : (
        <span className="flex shrink-0 items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide(true)}>Confirm</Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(true)}>Decline</Button>
        </span>
    )
}

/** This week's date tile (report §7.2): SUN / 8, in the organization's zone. */
function DateTile({ iso, timeZone }: { iso: string; timeZone: string | null }) {
    const d = new Date(iso)
    return (
        <span className="flex w-10 shrink-0 flex-col items-center gap-0.5 rounded-sm border border-border py-1 leading-none">
            <span className="nb-micro">{formatInZone(d, { weekday: 'short' }, timeZone)}</span>
            <span className="text-[13px] font-semibold tabular-nums">{formatInZone(d, { day: 'numeric' }, timeZone)}</span>
        </span>
    )
}

function SprintCard({ orgId, base, s, isAdmin, planLabel, timeZone, onChanged }: { orgId: string; base: string; s: OrgDashboardData['thisSprint']; isAdmin: boolean; planLabel: string; timeZone: string | null; onChanged: () => void }) {
    const sprint = s.sprint
    const daysLeft = sprint ? Math.max(0, Math.ceil((new Date(sprint.endDate).getTime() - Date.now()) / DAY)) : 0
    const percent = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0
    return (
        <OrgCard title="This sprint" testId="org-sprint-card" action={<Link href={`${base}?tab=sprints`} className="nb-link text-[13px]">All sprints</Link>}>
            {sprint ? (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Link href={`${base}?tab=sprints&sprintId=${sprint.id}`} className="min-w-0 truncate text-[15px] font-semibold hover:underline">{sprint.name}</Link>
                        <StatusBadge state={sprint.status === 'ended' ? 'completed' : 'active'}>{sprintStatusLabel(sprint.status === 'ended' ? 'ended' : 'active')}</StatusBadge>
                        <span className="nb-meta ml-auto">
                            {sprint.status === 'ended' ? (isAdmin ? <Link href={`${base}?tab=sprints&sprintId=${sprint.id}`} className="nb-link font-sans text-[13px]">Complete</Link> : `${sprint.name} ended`) : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
                        </span>
                    </div>
                    {sprint.goal ? <p className="line-clamp-2 text-[13px] text-muted-foreground">{sprint.goal}</p> : null}
                    {s.progress.total ? (
                        <div className="space-y-1">
                            <div role="progressbar" aria-label="Sprint progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>
                            <p className="nb-meta">{percent}% · {s.progress.done} of {s.progress.total} tasks done</p>
                        </div>
                    ) : null}
                    {s.items.length || s.tasks.length ? (
                        <ul className="divide-y divide-border">
                            {s.items.map((i) => (
                                <li key={i.masterId} className={cn(row, 'flex-wrap gap-y-0.5')}>
                                    <span className="flex min-w-0 items-center gap-2"><ClipboardCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Link href={`${base}?tab=tasks&drawerType=task&drawerId=${i.masterId}`} className="truncate hover:underline">{i.title}</Link></span>
                                    <span className="nb-meta shrink-0 max-sm:basis-full max-sm:pl-6">
                                        {i.dueDate ? `Due ${dayIn(i.dueDate, timeZone)}${i.own?.extended ? ' · Extended' : ''} · ` : ''}
                                        {/* Admins: the count opens the assignment, where its Roster is (report §7.2). */}
                                        {i.counts ? (i.counts.total === 0 ? <Link href={`${base}?tab=members`} className="nb-link font-sans">Nobody has joined yet</Link>
                                            : <Link href={`${base}?tab=tasks&drawerType=task&drawerId=${i.masterId}`} aria-label={`Roster for ${i.title}`} className="hover:text-foreground hover:underline">{i.counts.done} of {i.counts.total} done{i.counts.missing ? ` · ${i.counts.missing} missing` : ''}</Link>)
                                            : i.own ? `${ASSIGNMENT_STATE_LABELS[i.own.state] ?? i.own.state}${i.own.late ? ' · Late' : ''}` : ''}
                                    </span>
                                </li>
                            ))}
                            {s.tasks.map((t) => (
                                <li key={t.id} className={cn(row, 'flex-wrap gap-y-0.5')}>
                                    <span className="flex min-w-0 items-center gap-2"><ListTodo className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Link href={`${base}?tab=tasks&drawerType=task&drawerId=${t.id}`} className="truncate hover:underline">{t.title}</Link></span>
                                    <span className="shrink-0 text-[12px] text-muted-foreground max-sm:basis-full max-sm:pl-6">{[t.assignee, TASK_STATUS[t.status] ?? t.status].filter(Boolean).join(' · ')}</span>
                                </li>
                            ))}
                        </ul>
                    ) : isAdmin ? (
                        <p className="text-[13px] text-muted-foreground">Nothing in this sprint yet. <Link href={`${base}?tab=tasks&new=1`} className="nb-link">Add task</Link></p>
                    ) : <p className="text-[13px] text-muted-foreground">Nothing assigned yet.</p>}
                </div>
            ) : s.next ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                    <span>{s.next.status === 'planning' ? `${s.next.name} starts ${dayIn(s.next.startDate, timeZone)}.` : `Next: ${s.next.name} starts ${dayIn(s.next.startDate, timeZone)}.`}</span>
                    {/* Planned, not started (report §7.2): admins can start it now. */}
                    {isAdmin && s.next.status === 'planning' ? <StartNowButton projectId={orgId} sprintId={s.next.id} onStarted={onChanged} announceAs={s.next.name} /> : null}
                </div>
            ) : isAdmin ? <p className="text-[13px] text-muted-foreground">Sprints split the term into stages. <Link href={`${base}?tab=sprints`} className="nb-link">{planLabel}</Link></p>
                : <p className="text-[13px] text-muted-foreground">No sprint is running right now.</p>}
        </OrgCard>
    )
}

/** The page's shape while it loads (spec §33): greeting, three cards, the rail. */
function DashboardSkeleton() {
    return (
        <div role="status" aria-label="Loading overview" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-8" aria-hidden="true">
                <div className="nb-skeleton h-7 w-64 rounded-md" />
                {[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-36 rounded-lg" />)}
            </div>
            <div className="space-y-6 lg:col-span-4" aria-hidden="true">
                {[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-28 rounded-lg" />)}
            </div>
        </div>
    )
}

/** The org Dashboard for people in the org (report §27). */
export function OrgDashboard({ orgId, orgSlug, orgType = null, isSchool = false, isClass = false, started = null }: { orgId: string; orgSlug: string | null; orgType?: string | null; isSchool?: boolean; isClass?: boolean; started?: ReturnType<typeof readOrgDashboardAction> | null }) {
    const [filter, setFilter] = useState('all')
    const [moreToday, setMoreToday] = useState(false)
    const [moreActivity, setMoreActivity] = useState(false)
    const [welcomeClosed, setWelcomeClosed] = useState(false)
    const client = useQueryClient()
    const stickyRail = useBottomStickyRail({ topInset: 'calc(var(--workspace-tabs-height, 0px) + 24px)' })
    // Refetch on focus and every 2 minutes while visible.
    // The page started this read on the server (a browser runs actions one at a time); the filter applies here.
    const [read] = useState(() => serverFirst(started, () => readOrgDashboardAction(orgId)))
    const query = useQuery({ queryKey: ['org-dashboard', orgId], queryFn: read, refetchInterval: 120_000, refetchOnWindowFocus: true })
    const base = `/org/${encodeURIComponent(orgSlug ?? orgId)}`
    const newWorkspace = `/workspaces/new?org=${encodeURIComponent(orgSlug ?? orgId)}`
    const activity = query.data?.success ? query.data.activity.filter((a) => activityMatches(filter, a.kind)) : []
    // Report §32.4, decision 76: other people's changes show by themselves; bursts are combined over 2 seconds.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null
        // Audit 5.2: 2–5 s with jitter, so a burst doesn't make every open Overview refetch at the same moment. Audit N42:
        // the workspace topic carries view and follower counts the Overview never shows, so it isn't a reason to reload.
        const reload = () => { if (!timer) timer = setTimeout(() => { timer = null; void client.invalidateQueries({ queryKey: ['org-dashboard', orgId] }) }, 2_000 + Math.random() * 3_000) }
        const subscriptions = [subscribeBroadcast(liveTopics.tasks(orgId), reload)]
        return () => { subscriptions.forEach((s) => s.unsubscribe()); if (timer) clearTimeout(timer) }
    }, [client, orgId])
    // Audit 5.1: join requests and hand-ins reach admins on their own topic, so the Overview listens there too.
    useReloadOnNotice(() => void client.invalidateQueries({ queryKey: ['org-dashboard', orgId] }))
    if (query.isPending) return <DashboardSkeleton />
    const data = query.data
    if (!data || !data.success) return <ErrorNotice what="Overview" onRetry={() => void query.refetch()} />
    const s = data.thisSprint
    const record = [data.archivedSummary ? `${data.archivedSummary}${data.termSummary?.completedPercent != null ? ` · ${data.termSummary.completedPercent}% of work completed` : ''}` : null, data.termSummary?.mine ? `Your record: ${data.termSummary.mine.done} of ${data.termSummary.mine.total} done` : null].filter(Boolean)
    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-6 lg:col-span-8">
                {/* Mockup task 5: a greeting with the week of the term. */}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="nb-section-title text-foreground">{data.greeting}</h2>
                    {data.weekLine ? <p className="nb-meta" data-testid="org-week-line">{data.weekLine}</p> : null}
                </div>
                {/* Report §29.2: everyone inside sees it; the owner's reason and Appeal live in Settings → Moderation. */}
                {data.restricted ? <Notice tone="warning">This organization is restricted for now.</Notice> : null}
                {/* Report 33.5 (B4.4): a new person's Start here comes before anything else. */}
                {orgType === 'company' || orgType === 'research' ? <StartHere orgId={orgId} /> : null}
                {/* Report 34.2 (B5.1): a community's I agree and Getting started come first for members. */}
                {/* Report 35.2 (B6.1a): a lab's Overview is the lab home. */}
                {orgType === 'research' ? <LabHomeCard orgId={orgId} slug={orgSlug ?? orgId} /> : null}
                {orgType === 'research' ? <LabProtocolsCard orgId={orgId} /> : null}
                {orgType === 'research' ? <LabPapersCard orgId={orgId} slug={orgSlug ?? orgId} /> : null}
                {orgType === 'research' ? <MyProgressCard orgId={orgId} /> : null}
                {orgType === 'research' ? <LabCountsCard orgId={orgId} /> : null}
                {orgType === 'research' ? <LabProgressCard orgId={orgId} /> : null}
                {orgType === 'research' ? <ConcernsCard orgId={orgId} /> : null}
                {orgType === 'research' ? <LabMeetingCard orgId={orgId} /> : null}
                {orgType === 'research' ? <LabLibraryCard orgId={orgId} slug={orgSlug ?? orgId} /> : null}
                {orgType === 'research' ? <LabEquipmentCard orgId={orgId} /> : null}
                {orgType === 'community' || orgType === 'club' ? <CommunityFrontDoor orgId={orgId} base={base} /> : null}
                {orgType === 'club' ? <RecruitingCard orgId={orgId} /> : null}
                {orgType === 'club' ? <ClubMeetingCard orgId={orgId} /> : null}
                {orgType === 'club' ? <CommitteeCard orgId={orgId} /> : null}
                {orgType === 'club' ? <ElectionCard orgId={orgId} /> : null}
                {orgType === 'club' ? <HandoverCard orgId={orgId} /> : null}
                {orgType === 'club' ? <RenewalCard orgId={orgId} /> : null}
                {orgType === 'community' || orgType === 'club' ? <NextEventCard orgId={orgId} base={base} /> : null}
                {orgType === 'community' ? <CurrentChallengeCard orgId={orgId} base={base} /> : null}
                {isSchool ? <SchoolAttentionCard orgId={orgId} /> : null}
                {isClass ? <ClassNextLine orgId={orgId} /> : null}
                {isClass ? <ThisWeekAtSchool orgId={orgId} /> : null}
                {isClass ? <YourSectionCard orgId={orgId} /> : null}
                {isClass ? <YourAttendanceLine orgId={orgId} /> : null}
                {isClass ? <CompletionLine orgId={orgId} /> : null}
                {isClass ? <MentoringCard orgId={orgId} /> : null}
                {isClass ? <MyPrepCard orgId={orgId} /> : null}
                {isClass ? <DemoDayCard classId={orgId} /> : null}
                {record.length ? <Notice><span data-testid={data.archivedSummary ? 'org-archived-summary' : 'org-term-mine'}>{record.join(' · ')}</span></Notice> : null}
                {data.welcome && !welcomeClosed ? (
                    // Report §26.7, decision 49: once after joining; × hides it for good.
                    <WelcomeNote note={data.welcome.note} testId="org-welcome" onClose={() => {
                        setWelcomeClosed(true)
                        // Audit 1.4: the cached Overview forgets it too, so it doesn't flash back on the next visit.
                        client.setQueryData(['org-dashboard', orgId], (old: typeof data | undefined) => (old?.success ? { ...old, welcome: null } : old))
                        void dismissWelcomeAction(orgId)
                    }}>
                        {data.welcome.start.length ? <ul className="mt-3 divide-y divide-border">{data.welcome.start.map((r) => <li key={r.href}><Link href={r.href} className={cn(row, 'hover:underline')}><span className="truncate">{r.label}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link></li>)}</ul> : null}
                        {data.welcome.addToProfile ? <Link href="/profile/edit?section=experience" className="nb-link mt-3 inline-block text-[13px]">Add to your profile</Link> : null}
                    </WelcomeNote>
                ) : null}
                {data.catchUp ? (
                    // Report §33.5: Catch up for a late joiner, earlier sprints and their materials, with nothing to hand in.
                    <OrgCard title="Catch up" testId="org-catch-up">
                        <p className="text-[13px] text-muted-foreground">{data.catchUp.line}</p>
                        <ul className="mt-3 space-y-2 text-[13px]">
                            {data.catchUp.sprints.map((sp) => (
                                <li key={sp.id}>
                                    <Link href={`${base}?tab=sprints&sprintId=${sp.id}`} className="font-medium hover:underline">{sp.name}</Link>
                                    {sp.materials.length ? <ul className="ml-3 mt-0.5 space-y-0.5">{sp.materials.map((m) => <li key={m.href}><Link href={m.href} className="text-muted-foreground hover:text-foreground hover:underline">{m.name}</Link></li>)}</ul> : null}
                                </li>
                            ))}
                        </ul>
                    </OrgCard>
                ) : null}
                {data.pinned ? <PinnedRow orgId={orgId} base={base} pinned={data.pinned} onChanged={() => void query.refetch()} /> : null}
                {/* Report 33.2 (B4.1d): a company's home — What's new under the pinned post; Needs review for admins. */}
                {orgType === 'company' ? <WhatsNewCard orgId={orgId} base={base} /> : null}
                {orgType === 'company' ? <NeedsReviewCard orgId={orgId} base={base} /> : null}
                {orgType === 'company' ? <CompanyGoalsCard orgId={orgId} base={base} /> : null}
                {orgType === 'company' ? <AskTeamCard orgId={orgId} base={base} /> : null}
                {data.getStarted.length ? (
                    // Report §7.2, decision 7: three cards while the organization is empty, each opening the real form.
                    <OrgCard title="Get started" action={typeProfile(orgType).schools ? <Link href="/help/running-a-class" className="nb-link text-[13px]">Running a class on NetworkBase</Link> : undefined}>
                        <ul className="grid gap-2 sm:grid-cols-3">
                            {data.getStarted.map((card) => {
                                const [label, href, Icon] = card === 'invite' ? ['Invite people', `${base}?tab=members`, UserPlus] as const
                                    : card === 'sprint' ? ['Plan your first sprint', `${base}?tab=sprints`, IterationCcw] as const
                                    : ['Create the first workspace', newWorkspace, FolderKanban] as const
                                // Nested content is a sunken well, not another card (spec §02).
                                return <li key={card}><Link href={href} className="flex h-full min-h-11 items-center gap-2 rounded-md bg-muted px-3 py-2.5 text-[13px] font-medium text-foreground hover:bg-accent"><Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{label}</Link></li>
                            })}
                        </ul>
                    </OrgCard>
                ) : null}
                {data.role !== 'guest' ? (
                    // Report §33.5, decision 80: Today takes over Needs your attention; 5 rows, then the rest on request.
                    <OrgCard title="Today" bodyClassName="px-5 py-2">
                        {data.today.length ? (
                            <>
                                <ul className="divide-y divide-border">{(moreToday ? data.today : data.today.slice(0, 5)).map((n) => <TodayItem key={`${n.kind}:${n.label}`} orgId={orgId} n={n} onChanged={() => void query.refetch()} />)}</ul>
                                {!moreToday && data.today.length > 5 ? <button type="button" className="nb-link my-2 text-[13px]" onClick={() => setMoreToday(true)}>Show {data.today.length - 5} more</button> : null}
                            </>
                        ) : <p className="flex items-center gap-1.5 py-3 text-[13px] text-muted-foreground"><Check className="size-4" aria-hidden="true" />{data.role === 'admin' ? 'Nothing needs you today.' : 'Nothing due in the next 2 days.'}</p>}
                    </OrgCard>
                ) : null}
                {data.standing ? (
                    // Decision 81: admins only; each count opens Members filtered.
                    <OrgCard title={`How the ${data.standingWord} is doing`}>
                        {/* Mockup task 5: one bar in three parts (the spec's 6px track), then each number, each opening Members filtered. */}
                        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${data.standing.onTrack} on track, ${data.standing.behind} behind, ${data.standing.inactive} inactive`}>
                            {data.standing.onTrack ? <div className="bg-[var(--status-success)]" style={{ flex: data.standing.onTrack }} /> : null}
                            {data.standing.behind ? <div className="bg-[var(--status-warning)]" style={{ flex: data.standing.behind }} /> : null}
                            {data.standing.inactive ? <div className="bg-muted-foreground" style={{ flex: data.standing.inactive }} /> : null}
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                            <Link href={`${base}?tab=members`} className="group"><span className="block text-xl font-semibold tabular-nums">{data.standing.onTrack}</span><span className="text-[13px] text-muted-foreground group-hover:underline">On track</span></Link>
                            <Link href={`${base}?tab=members&status=behind`} className="group"><span className="block text-xl font-semibold tabular-nums text-[var(--status-warning)]">{data.standing.behind}</span><span className="text-[13px] text-muted-foreground group-hover:underline">Behind</span></Link>
                            <Link href={`${base}?tab=members&status=inactive`} className="group"><span className="block text-xl font-semibold tabular-nums">{data.standing.inactive}</span><span className="text-[13px] text-muted-foreground group-hover:underline">Inactive</span></Link>
                        </div>
                    </OrgCard>
                ) : null}
                <SprintCard orgId={orgId} base={base} s={s} isAdmin={data.role === 'admin'} planLabel={typeProfile(orgType).planLabel} timeZone={data.timeZone} onChanged={() => void query.refetch()} />
            </div>
            <aside {...stickyRail} aria-label="Organization details" className="min-w-0 space-y-6 lg:col-span-4 lg:sticky lg:self-start">
                {/* Mockup task 5: This week heads the right column and Activity closes it, as drawn. */}
                <RailSection title="This week">
                    {/* Decision 80: calendar days in the organization's zone, grouped Today, Tomorrow, This week. */}
                    {data.thisWeek.length ? (['Today', 'Tomorrow', 'This week'] as const).map((group) => {
                        const rows = data.thisWeek.filter((c) => c.group === group)
                        // The section is already called This week, so its own group needs no second label (problem 15).
                        return rows.length ? <div key={group}>{group !== 'This week' ? <p className="nb-micro mt-2 first:mt-0">{group}</p> : null}<ul className="space-y-2 pt-1.5">{rows.slice(0, 5).map((c) => (
                            <li key={`${c.date}:${c.label}`} className="flex min-w-0 items-center gap-3 text-[13px]">
                                <DateTile iso={c.date} timeZone={data.timeZone} />
                                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                {c.kind === 'sprint' ? <IterationCcw className="size-4 shrink-0 text-muted-foreground" aria-label="Sprint" /> : <ListTodo className="size-4 shrink-0 text-muted-foreground" aria-label="Due" />}
                            </li>
                        ))}</ul></div> : null
                    }) : <p className="text-[13px] text-muted-foreground">Nothing due in the next 7 days.</p>}
                    {data.thisWeek.length ? <Link href={`${base}?tab=tasks`} className="nb-link mt-3 inline-block text-[13px]">See all</Link> : null}
                </RailSection>
                <RailSection title="Workspaces" action={
                    <span className="flex items-center gap-1">
                        {data.role === 'admin' ? <Button asChild variant="ghost" size="icon-sm" className="nb-touch-target text-muted-foreground"><Link href={newWorkspace} aria-label="New workspace"><Plus className="size-4" aria-hidden="true" /></Link></Button> : null}
                        <Link href={`${base}?tab=projects`} className="nb-link text-[13px]">See all</Link>
                    </span>
                }>
                    {data.projects.length ? <ul className="space-y-0.5">{data.projects.map((p) => (
                        <li key={p.id}>
                            <WorkspaceRow href={`/workspaces/${encodeURIComponent(p.slug ?? p.id)}`} title={p.title} coverImage={p.coverImage}
                                meta={[p.lead, `${p.members} ${p.members === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}
                                end={p.overdue ? <StatusBadge state="late">{p.overdue} overdue</StatusBadge> : <WorkspaceLastUpdate projectId={p.id} timeOnly className="nb-meta shrink-0" />} />
                        </li>
                    ))}</ul> : data.role === 'admin'
                        ? <p className="text-[13px] text-muted-foreground">Teams work inside workspaces. <Link href={newWorkspace} className="nb-link">Create the first workspace</Link></p>
                        : <p className="text-[13px] text-muted-foreground">You’re not in a workspace yet.</p>}
                </RailSection>
                <RailSection title="People">
                    {data.role === 'admin' && data.people.total <= 1 && !data.people.requests ? (
                        // Only you (report §7.2): a short invite panel instead of a list of one.
                        <OrgInvitePanel orgId={orgId} orgHandle={orgSlug} bare />
                    ) : data.role === 'admin' ? (
                        <Link href={`${base}?tab=members`} className="group block space-y-2">
                            <AvatarStack people={data.people.avatars} total={data.people.total} />
                            <span className="block text-[13px] group-hover:underline">{data.people.total} {data.people.total === 1 ? 'member' : 'members'}{data.people.joinedThisWeek ? ` · ${data.people.joinedThisWeek} joined this week` : ''}</span>
                        </Link>
                    ) : (
                        // Decision D-A, audit N52: members open a read-only list here (Members is the admins' tab); viewers see the faces only.
                        <OrgPeople orgId={orgId} canOpen={data.role === 'member'} summary={<>
                            <AvatarStack people={data.people.avatars} total={data.people.total} />
                            <span className="block text-[13px] group-hover:underline">{data.people.total} {data.people.total === 1 ? 'member' : 'members'}</span>
                        </>} />
                    )}
                    {data.people.requests && data.role === 'admin' ? <Link href={`${base}?tab=members`} className="nb-link mt-2 inline-block text-[13px]">{data.people.requests} {data.people.requests === 1 ? 'request' : 'requests'} waiting</Link> : null}
                </RailSection>
                <RailSection title="Activity" action={
                    // One small menu (problem 16), not a row of buttons.
                    <select aria-label="Filter activity" value={filter} onChange={(e) => { setFilter(e.target.value); setMoreActivity(false) }} className="nb-select" data-size="sm">
                        {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                }>
                    {activity.length ? (
                        <>
                            <ol className="space-y-3 text-[13px]">{(moreActivity ? activity : activity.slice(0, 5)).map((a) => <ActivityItem key={a.id} kind={a.kind} text={a.text} subject={a.subject} href={a.href} at={a.at} />)}</ol>
                            {!moreActivity && activity.length > 5 ? <button type="button" className="nb-link mt-3 text-[13px]" onClick={() => setMoreActivity(true)}>Show {activity.length - 5} more</button> : null}
                        </>
                    ) : <p className="text-[13px] text-muted-foreground">{filter === 'all' ? 'Activity shows here once people start working.' : 'Nothing of this kind yet.'}</p>}
                </RailSection>
            </aside>
        </div>
    )
}

const useChildOrgLine = (projectId: string) => useQuery({ queryKey: ['child-org-line', projectId], queryFn: () => readChildOrgLineAction(projectId), staleTime: 60_000 })

/** `Inside CO2 · ends Fri · 1 assignment due`, under a child workspace's header buttons. */
export function ChildOrgHeaderDetails({ projectId }: { projectId: string }) {
    const { data: line } = useChildOrgLine(projectId)
    // Report §17.1: the breadcrumb already names the organization, so this line says only what's running.
    const parts = [line?.sprint ? `Inside ${line.sprint.name} · ends ${dayIn(line.sprint.endDate, null)}` : null, line?.dueCount ? `${line.dueCount} ${line.dueCount === 1 ? 'assignment' : 'assignments'} due` : null].filter(Boolean)
    if (!line || parts.length === 0) return null
    return (
        <p className="max-w-[280px] text-right text-[13px] leading-5 text-muted-foreground xl:max-w-[420px] max-md:max-w-none max-md:text-left" data-testid="child-org-header-details">
            {parts.join(' · ')}
        </p>
    )
}

/** What's happening at the top of a child workspace's Overview: a card with its own header (spec §19). */
export function ChildOrgLine({ projectId }: { projectId: string }) {
    const { data: line } = useChildOrgLine(projectId)
    if (!line) return null
    return (
        <div className="mb-6 space-y-4">
            {line.github ? <p className="nb-meta" data-testid="child-github-line">Synced to {line.github.repo}{line.github.syncedAt ? ` · ${ago(line.github.syncedAt)}` : ''}</p> : null}
            {/* What's happening = Needs you + This sprint (report §27.5); Activity stays in the rail. */}
            {line.needsYou.length || line.ownSprint ? (
                <OrgCard title="What’s happening" bodyClassName="px-5 py-2">
                    <ul className="divide-y divide-border">
                        {line.ownSprint ? (
                            <li className={row} data-testid="child-this-sprint">
                                <span className="truncate">This sprint · {line.ownSprint.name}</span>
                                <span className="nb-meta shrink-0">{line.ownSprint.parent ? `Inside ${line.ownSprint.parent} (${line.orgTitle}) · ` : ''}ends {dayIn(line.ownSprint.endDate, null)}</span>
                            </li>
                        ) : null}
                        {line.needsYou.map((n) => <li key={`${n.kind}:${n.label}`}><Link href={n.href} className={cn(row, 'hover:underline')}><span className={cn('truncate', n.tone === 'amber' && 'text-[var(--status-warning)]')}>{n.label}</span><ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link></li>)}
                    </ul>
                </OrgCard>
            ) : null}
        </div>
    )
}

/**
 * The child Dashboard's Team by unit (report §14.4): `Frontend developers · 3 · 1 open seat`; opening a unit lists
 * the names with its team lead. Names come from the dashboard's own (privacy-filtered) member list.
 */
export function ChildUnitsLine({ projectId, members }: { projectId: string; members: Array<{ id: string; fullName?: string | null; username?: string | null; avatarUrl?: string | null }> }) {
    const { data: units } = useQuery({ queryKey: ['child-units', projectId], queryFn: () => readWorkspaceUnitsAction(projectId), staleTime: 60_000 })
    if (!units?.length) return null
    const personOf = (id: string) => { const m = members.find((x) => x.id === id); return m ? { id, name: m.fullName || m.username || 'Member', avatarUrl: m.avatarUrl ?? null } : null }
    return (
        <OrgCard title="Teams" className="mb-6" bodyClassName="px-5 py-2">
            <ul className="divide-y divide-border">
                {units.map((unit) => {
                    const people = unit.memberIds.map(personOf).filter((p): p is { id: string; name: string; avatarUrl: string | null } => Boolean(p))
                    const open = Math.max(0, unit.count - unit.filled)
                    return (
                        <li key={unit.id}>
                            <details className="group py-1">
                                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 text-[13px] [&::-webkit-details-marker]:hidden">
                                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate"><span className="font-medium text-foreground">{unit.title}</span><span className="text-muted-foreground"> · {unit.memberIds.length}{open ? ` · ${open} open ${open === 1 ? 'seat' : 'seats'}` : ''}</span></span>
                                    <AvatarStack people={people} size={20} />
                                </summary>
                                <ul className="mb-2 ml-7 space-y-1.5 text-[13px]">
                                    {people.map((p) => (
                                        <li key={p.id} className="flex items-center gap-2">
                                            {p.name}
                                            {p.id === unit.leadUserId ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Star className="size-3.5 fill-current text-primary" aria-hidden="true" />Team lead</span> : null}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        </li>
                    )
                })}
            </ul>
        </OrgCard>
    )
}

/** Decision D-A: the organization's people for its members, read-only (name, photo, role, title). */
function OrgPeople({ orgId, canOpen, summary }: { orgId: string; canOpen: boolean; summary: ReactNode }) {
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')
    const people = useQuery({ queryKey: ['org-people', orgId], queryFn: () => readOrgPeopleAction(orgId), enabled: open, staleTime: 60_000 })
    if (!canOpen) return <div className="space-y-2">{summary}</div>
    const rows = people.data?.success ? people.data.people.filter((p) => !q.trim() || `${p.name} ${p.title ?? ''} ${p.role}`.toLowerCase().includes(q.trim().toLowerCase())) : []
    return (
        <>
            <button type="button" className="group block w-full space-y-2 text-left" onClick={() => setOpen(true)}>{summary}</button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent size="confirm">
                    <DialogHeader>
                        <DialogTitle>People</DialogTitle>
                        <DialogDescription>Everyone in this organization.</DialogDescription>
                    </DialogHeader>
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" />
                    {people.isPending ? <div className="nb-skeleton h-40 rounded-md" role="status" aria-label="Loading people" />
                        : !people.data?.success ? <ErrorNotice what="People" onRetry={() => void people.refetch()} />
                            : rows.length === 0 ? <p className="text-[13px] text-muted-foreground">No one matches.</p> : (
                                <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto" aria-label="People">
                                    {rows.map((p) => (
                                        <li key={p.id} className="flex min-h-12 items-center gap-3 py-2">
                                            <UserAvatar identity={{ id: p.id, fullName: p.name, avatarUrl: p.avatarUrl }} size={28} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px] font-medium text-foreground">{p.name}</span>
                                                {p.title ? <span className="nb-meta block truncate">{p.title}</span> : null}
                                            </span>
                                            <span className="nb-status" data-tone="neutral">{p.role}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                </DialogContent>
            </Dialog>
        </>
    )
}
