'use client'

import { PublicCalendar } from '@/components/organizations/SchoolEvents'
import { CurriculumOverview } from '@/components/organizations/Curriculum'
import { ShowcaseSection } from '@/components/organizations/Capstone'
import { typeProfile } from '@/lib/organizations/type-profile'
import { ActivityItem } from '@/components/ui/activity-item'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { useState, type ReactNode } from 'react'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { aboutStages } from '@/lib/organizations/dashboard-rules'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { readOrgAboutAction } from '@/app/actions/org-dashboard'
import JourneyTimeline from '@/components/workspaces/dashboard/JourneyTimeline'
import ProjectOverviewCard from '@/components/workspaces/dashboard/WorkspaceOverviewCard'
import { RailSection } from '@/components/ui/rail-section'
import { SchoolAboutSections } from '@/components/organizations/SchoolParts'
import { CompanyAboutSections } from '@/components/organizations/CompanyParts'
import { RulesSummary } from '@/components/organizations/CommunityFrontDoor'
import { ClassDetailsRail, SyllabusAndTerm } from '@/components/organizations/ClassHomeParts'
import { YourSectionCard } from '@/components/organizations/Sections'
import { MessageUserLink } from "@/components/messages/MessageUserLink";
import type { Workspace } from '@/types/discover'
import { formatInZone } from '@/lib/organizations/zoned-time'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { Notice } from '@/components/ui/notice'
import { CopyButton } from '@/components/ui/copy-button'
import { useBottomStickyRail } from '@/hooks/useBottomStickyRail'
import { WelcomeNote, WorkspaceRow } from '@/components/organizations/org-ui'

// The project columns, read as an organization's (report §34.11).
const ORG_LABELS = { description: 'About', problem: "Who it’s for", solution: 'What happens here' }

/**
 * The org's About tab (report §22): the project Dashboard layout for an organization. Main: welcome note,
 * the overview card and up to 3 projects. Rail: the Journey built from sprints, public-safe activity, the
 * per-person card (Invite / You're a member / Join), Leaders and Details.
 */
/** A readable time zone: "Asia/Kolkata" → "Kolkata (GMT+5:30)". */
function zoneName(zone: string) {
    try {
        const offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value
        return `${zone.split('/').pop()?.replace(/_/g, ' ') ?? zone}${offset ? ` (${offset})` : ''}`
    } catch { return zone }
}

export function OrgAboutTab({ project, isCreator, onEdit, memberRole = null, visitorActions }: { project: Workspace; isCreator: boolean; onEdit: () => void; memberRole?: 'owner' | 'admin' | 'member' | 'viewer' | null; visitorActions?: ReactNode }) {
    const org = project.organization
    // Report 33.2 call 5: a company's About reads About · Mission · How we work.
    const typeAbout = typeProfile(org?.type).about
    const aboutLabels = typeAbout ? { ...ORG_LABELS, problem: typeAbout.problem, solution: typeAbout.solution } : ORG_LABELS
    const about = useQuery({ queryKey: ['org-about', project.id], queryFn: () => readOrgAboutAction(project.id), staleTime: 30_000 })
    const data = about.data?.success ? about.data : null
    const stickyRail = useBottomStickyRail({ topInset: 'calc(var(--workspace-tabs-height, 0px) + 24px)' })
    const base = `/org/${encodeURIComponent(project.slug || project.id)}`
    // Report 30.2 W1: an Education class (not a school) has a Class home.
    const isClass = Boolean(org && !org.isSchool && typeProfile(org.type).schools)
    // A member's card already says their role; owners and admins see theirs here.
    const yourRole = data?.card.kind === 'invite' && memberRole ? org?.roleNames?.[memberRole] ?? null : null
    const details: Array<[string, ReactNode]> = []
    // 2026-11-05 findings §2 (G1): the web address, not an "@"; D2: what the ✓ was checked against.
    if (project.slug) details.push(['Web address', <span key="w" className="flex items-center justify-end gap-2"><span className="nb-meta break-all text-foreground">networkbase.in/org/{project.slug}</span><CopyButton text={`https://networkbase.in/org/${project.slug}`} label="Copy" variant="ghost" /></span>])
    if (org?.verifiedLabel) details.push(['Verified', org.verifiedLabel.replace(/^Verified · /, '').replace(/^Verified by /, 'By ')])
    if (yourRole) details.push(['Your role', yourRole])
    if (org?.timeZone) details.push(['Time zone', zoneName(org.timeZone)])
    if (project.createdAt) details.push(['Since', formatInZone(project.createdAt, { month: 'short', year: 'numeric' }, org?.timeZone)])
    // The overview card reads these off the full project payload; the shared Project type doesn't list them.
    const statements = project as Workspace & { problemStatement?: string | null; solutionStatement?: string | null }
    const roleName = (role: 'owner' | 'admin') => org?.roleNames?.[role] ?? (role === 'owner' ? 'Owner' : 'Admin')
    const [noteTucked, setNoteTucked] = useState(false)
    const viewer = data?.card.kind === 'invite' ? 'admin' as const : data?.card.kind === 'visitor' ? 'visitor' as const : 'member' as const
    const stages = data ? aboutStages(data.stageCount, viewer) : null
    const railLoading = about.isPending
    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-6 lg:col-span-8">
                {about.data && !about.data.success ? <ErrorNotice what="About" onRetry={() => void about.refetch()} /> : null}
                {/* Report §26.9: a former member of a public organization sees their own line, nothing more. */}
                {data?.formerLine ? <Notice>{data.formerLine}</Notice> : null}
                {/* Report §7.3: the welcome note is for people inside; members can tuck it away, admins edit it in Settings. */}
                {org?.welcomeNote && viewer !== 'visitor' && !noteTucked ? (
                    <WelcomeNote note={org.welcomeNote} onClose={viewer === 'member' ? () => setNoteTucked(true) : undefined} editHref={viewer === 'admin' ? `${base}?tab=settings` : undefined} />
                ) : !org?.welcomeNote && viewer === 'admin' ? (
                    <Link href={`${base}?tab=settings`} className="nb-link inline-block text-[13px]">Add a welcome note</Link>
                ) : null}
                <ProjectOverviewCard project={project} isCreator={isCreator} onEdit={onEdit} labels={aboutLabels} editLabel="Edit details" />
                {isClass ? <YourSectionCard orgId={project.id} /> : null}
                {isClass ? <SyllabusAndTerm orgId={project.id} base={base} /> : null}
                {isClass ? <ShowcaseSection classId={project.id} /> : null}
                {org?.isSchool ? <PublicCalendar schoolId={project.id} /> : null}
                {org?.isSchool ? <CurriculumOverview schoolId={project.id} /> : null}
                {/* Empty-state prompts for admins (report §22.3). */}
                {isCreator && (!statements.problemStatement || !statements.solutionStatement) ? (
                    <p className="flex flex-wrap gap-4 text-[13px]">
                        {!statements.problemStatement ? <button type="button" onClick={onEdit} className="nb-link">{typeAbout ? `Add your ${typeAbout.problem.toLowerCase()}` : `Add who ${project.title} is for`}</button> : null}
                        {!statements.solutionStatement ? <button type="button" onClick={onEdit} className="nb-link">{typeAbout ? `Add ${typeAbout.solution.toLowerCase()}` : 'Add what members do here'}</button> : null}
                    </p>
                ) : null}
                {data?.projects.length ? (
                    <RailSection title="Workspaces" action={data.card.kind !== 'visitor' ? <Link href={`${base}?tab=projects`} className="nb-link text-[13px]">See all</Link> : undefined}>
                        <ul className="space-y-0.5">
                            {data.projects.map((p) => <li key={p.id}><WorkspaceRow href={`/workspaces/${encodeURIComponent(p.slug ?? p.id)}`} title={p.title} coverImage={p.coverImage} /></li>)}
                        </ul>
                    </RailSection>
                ) : null}
                {org?.isSchool ? <SchoolAboutSections orgId={project.id} /> : null}
                {org?.type === 'company' ? <CompanyAboutSections orgId={project.id} /> : null}
                {org?.type === 'community' ? <RulesSummary orgId={project.id} base={base} /> : null}
            </div>
            <aside {...stickyRail} aria-label="Organization details" className="min-w-0 space-y-6 lg:col-span-4 lg:sticky lg:self-start">
                {isClass ? <ClassDetailsRail orgId={project.id} settingsHref={`${base}?tab=settings&section=org-profile`} /> : null}
                {railLoading ? <div role="status" aria-label="Loading details" className="space-y-6">{[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-28 rounded-lg" aria-hidden="true" />)}</div> : null}
                {/* Report §7.3, decision 79: stages come from sprints; one sprint is the first stop; none teaches. */}
                {(stages === 'timeline' || stages === 'single') && data?.journey ? (
                    <JourneyTimeline stages={data.journey.stages} currentStageIndex={data.journey.currentIndex} isCreator={false} stageCompletionDates={data.journey.completionDates} layout="rail" />
                ) : null}
                {stages === 'single' && viewer === 'admin' ? <Link href={`${base}?tab=sprints`} className="nb-link -mt-4 inline-block text-[13px]">Add the next sprint</Link> : null}
                {stages === 'ghost' ? (
                    <RailSection title="Stages">
                        <p className="text-[13px] text-muted-foreground">Your sprints become stages here.</p>
                        <Link href={`${base}?tab=sprints`} className="nb-link mt-2 inline-block text-[13px]">Plan your first sprint</Link>
                    </RailSection>
                ) : stages === 'hint' ? (
                    <RailSection title="Stages"><p className="text-[13px] text-muted-foreground">Stages appear once sprints are planned.</p></RailSection>
                ) : null}
                {data?.activity.length ? (
                    <RailSection title="Recent activity">
                        <ol className="space-y-3 text-[13px]">
                            {data.activity.map((a) => <ActivityItem key={a.id} kind={a.kind} text={a.text} href={a.href} at={a.at} />)}
                        </ol>
                    </RailSection>
                ) : null}
                {data ? (
                    data.card.kind === 'invite' ? (
                        // Report §7.11: the same invite panel as the header and Members.
                        <RailSection title="Invite people"><OrgInvitePanel orgId={project.id} orgHandle={project.slug ?? null} /></RailSection>
                    ) : data.card.kind === 'member' || data.card.kind === 'guest' ? (
                        <RailSection title="Your membership">
                            {/* Report §39.5: the role word without "a" or "an"; links to My membership (§7.3). */}
                            <p className="text-[13px] text-foreground">
                                {data.card.kind === 'guest' ? `${org?.roleNames?.viewer ?? 'Viewer'} · read-only` : org?.roleNames?.member ?? 'Member'}
                                {data.card.joinedAt ? <span className="text-muted-foreground"> · Joined {formatInZone(data.card.joinedAt, { month: 'short', day: 'numeric', year: 'numeric' }, org?.timeZone)}</span> : null}
                            </p>
                            <Link href={`${base}?tab=settings`} className="nb-link mt-2 inline-block text-[13px]">My membership</Link>
                        </RailSection>
                    ) : visitorActions && project.status !== 'archived' ? (
                        // The header holds the one Join button (spec §10); the rail says what joining means.
                        <RailSection title={`Join ${project.title}`}>
                            <p className="text-[13px] text-muted-foreground">{org?.joinMode === 'approval' ? 'Ask to join with the button at the top. An admin approves requests.' : 'Join with the button at the top, or with a code from an admin.'}</p>
                        </RailSection>
                    ) : null
                ) : null}
                {data?.leaders.length ? (
                    <RailSection title="Owner and admins">
                        <ul className="space-y-3 text-[13px]">
                            {data.leaders.map((l) => (
                                <li key={l.id} className="flex min-w-0 items-center gap-2.5">
                                    <UserAvatar identity={{ id: l.id, fullName: l.name, username: l.username, avatarUrl: l.avatarUrl }} size={26} />
                                    <span className="min-w-0 flex-1">
                                        {l.username ? <Link href={`/u/${l.username}`} className="block truncate font-medium hover:underline">{l.name}</Link> : <span className="block truncate font-medium">{l.name}</span>}
                                        {/* Live-fix 21: the role word, then their title ("Teacher · Course Instructor"). */}
                                        <span className="block truncate text-[12px] text-muted-foreground">{[roleName(l.role), l.title].filter(Boolean).join(' · ')}</span>
                                    </span>
                                    {data.card.kind !== 'visitor' ? <MessageUserLink userId={l.id} className="nb-link shrink-0" /> : null}
                                </li>
                            ))}
                        </ul>
                    </RailSection>
                ) : null}
                {details.length ? (
                    <RailSection title="Details">
                        <dl className="space-y-2 text-[13px]" data-testid="org-about-details">
                            {details.map(([term, value]) => (
                                <div key={term} className="flex items-center justify-between gap-3">
                                    <dt className="shrink-0 text-muted-foreground">{term}</dt>
                                    <dd className="min-w-0 break-words text-right">{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </RailSection>
                ) : null}
            </aside>
        </div>
    )
}
