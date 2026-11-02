'use client'

import { typeProfile } from '@/lib/organizations/type-profile'
import { ActivityItem } from '@/components/ui/activity-item'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { readOrgAboutAction } from '@/app/actions/org-dashboard'
import JourneyTimeline from '@/components/workspaces/dashboard/JourneyTimeline'
import ProjectOverviewCard from '@/components/workspaces/dashboard/WorkspaceOverviewCard'
import { RailSection } from '@/components/ui/rail-section'
import { messageUserInWindow } from '@/components/messages/message-user'
import { toast } from '@/lib/feedback'
import { formatDistanceToNow } from '@/lib/utils/date'
import type { Workspace } from '@/types/discover'

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })
// The project columns, read as an organization's (report §34.11).
const ORG_LABELS = { description: 'About', problem: "Who it’s for", solution: 'What happens here' }

/**
 * The org's About tab (report §22): the project Dashboard layout for an organization. Main: welcome note,
 * the overview card and up to 3 projects. Rail: the Journey built from sprints, public-safe activity, the
 * per-person card (Invite / You're a member / Join), Leaders and Details.
 */
export function OrgAboutTab({ project, isCreator, onEdit, memberRole = null, visitorActions }: { project: Workspace; isCreator: boolean; onEdit: () => void; memberRole?: 'owner' | 'admin' | 'member' | 'viewer' | null; visitorActions?: ReactNode }) {
    const org = project.organization
    const about = useQuery({ queryKey: ['org-about', project.id], queryFn: () => readOrgAboutAction(project.id), staleTime: 30_000 })
    const data = about.data?.success ? about.data : null
    const base = `/org/${encodeURIComponent(project.slug || project.id)}`
    // A member's card already says their role; owners and admins see theirs here.
    const yourRole = data?.card.kind === 'invite' && memberRole ? org?.roleNames?.[memberRole] ?? null : null
    const details = [
        project.slug ? ['Handle', `@${project.slug}`] : null,
        yourRole ? ['Your role', yourRole] : null,
        org?.timeZone ? ['Time zone', org.timeZone] : null,
        project.createdAt ? ['Since', MONTH.format(new Date(project.createdAt))] : null,
    ].filter((row): row is string[] => row !== null)
    // The overview card reads these off the full project payload; the shared Project type doesn't list them.
    const statements = project as Workspace & { problemStatement?: string | null; solutionStatement?: string | null }
    const roleName = (role: 'owner' | 'admin') => org?.roleNames?.[role] ?? (role === 'owner' ? 'Owner' : 'Admin')
    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-4 lg:col-span-8">
                {org?.welcomeNote ? (
                    <section aria-label="Welcome note" className="rounded-lg border border-border bg-card p-4">
                        <p className="nb-body whitespace-pre-line text-foreground">{org.welcomeNote}</p>
                    </section>
                ) : null}
                <ProjectOverviewCard project={project} isCreator={isCreator} onEdit={onEdit} labels={ORG_LABELS} />
                {/* Empty-state prompts for admins (report §22.3). */}
                {isCreator && (!statements.problemStatement || !statements.solutionStatement) ? (
                    <p className="flex flex-wrap gap-3 text-sm">
                        {!statements.problemStatement ? <button type="button" onClick={onEdit} className="underline underline-offset-4">Add who {project.title} is for</button> : null}
                        {!statements.solutionStatement ? <button type="button" onClick={onEdit} className="underline underline-offset-4">Add what members do here</button> : null}
                    </p>
                ) : null}
                {data?.projects.length ? (
                    <RailSection title="Workspaces" action={data.card.kind !== 'visitor' ? <Link href={`${base}?tab=projects`} className="text-[12px] underline underline-offset-4">See all</Link> : undefined}>
                        <p className="text-sm">
                            {data.projects.map((p, i) => <span key={p.id}>{i ? ' · ' : ''}<Link href={`/workspaces/${encodeURIComponent(p.slug ?? p.id)}`} className="hover:underline">{p.title}</Link></span>)}
                        </p>
                    </RailSection>
                ) : null}
            </div>
            <aside aria-label="Organization details" className="min-w-0 space-y-6 lg:col-span-4">
                {data?.journey ? (
                    <JourneyTimeline stages={data.journey.stages} currentStageIndex={data.journey.currentIndex} isCreator={false} stageCompletionDates={data.journey.completionDates} layout="rail" />
                ) : data?.card.kind === 'invite' ? (
                    <RailSection title="Stages"><Link href={`${base}?tab=sprints`} className="text-sm underline underline-offset-4">{typeProfile(org?.type).planLabel}</Link></RailSection>
                ) : null}
                {data?.activity.length ? (
                    <RailSection title="Recent activity">
                        <ol className="space-y-3 text-sm">
                            {data.activity.map((a) => <ActivityItem key={a.id} kind={a.kind} text={a.text} href={a.href} at={a.at} />)}
                        </ol>
                    </RailSection>
                ) : null}
                {data ? (
                    data.card.kind === 'invite' ? (
                        <RailSection title="Invite">
                            {data.card.joinCode ? (
                                <p className="text-sm">Code <span className="font-mono font-semibold">{data.card.joinCode}</span>{' · '}
                                    <button type="button" className="underline underline-offset-4" onClick={() => void navigator.clipboard.writeText((data.card as { joinCode: string }).joinCode).then(() => toast.success('Code copied'))}>Copy</button>
                                </p>
                            ) : <p className="text-sm text-muted-foreground">Joining by code is turned off.</p>}
                            <Link href={`${base}?tab=members`} className="text-sm underline underline-offset-4">Invite by email</Link>
                        </RailSection>
                    ) : data.card.kind === 'member' || data.card.kind === 'guest' ? (
                        <RailSection title={project.title}>
                            <p className="text-sm text-muted-foreground">
                                {data.card.kind === 'guest' ? 'Viewer · read only' : `You’re a ${org?.roleNames?.member ?? 'Member'}`}
                                {data.card.joinedAt ? ` · joined ${new Date(data.card.joinedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                            </p>
                        </RailSection>
                    ) : visitorActions && project.status !== 'archived' ? (
                        <RailSection title={`Join ${project.title}`}>{visitorActions}</RailSection>
                    ) : null
                ) : null}
                {data?.leaders.length ? (
                    <RailSection title="Owner and admins">
                        <ul className="space-y-1 text-sm">
                            {data.leaders.map((l) => (
                                <li key={l.id}>
                                    {l.username ? <Link href={`/u/${l.username}`} className="font-medium hover:underline">{l.name}</Link> : <span className="font-medium">{l.name}</span>}
                                    <span className="text-muted-foreground"> · {l.title || roleName(l.role)}</span>
                                    {data.card.kind !== 'visitor' ? <> · <Link href={`/messages?userId=${l.id}`} onClick={(e) => messageUserInWindow(l.id, e)} className="text-[12px] underline underline-offset-4">Message</Link></> : null}
                                </li>
                            ))}
                        </ul>
                    </RailSection>
                ) : null}
                {details.length ? (
                    <RailSection title="Details">
                        <dl className="space-y-1 text-sm" data-testid="org-about-details">
                            {details.map(([term, value]) => (
                                <div key={term} className="flex justify-between gap-3">
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
