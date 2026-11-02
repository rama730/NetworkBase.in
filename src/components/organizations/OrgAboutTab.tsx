'use client'

import { typeProfile } from '@/lib/organizations/type-profile'
import { ActivityItem } from '@/components/ui/activity-item'
import { OrgInvitePanel } from '@/components/organizations/OrgInvitePanel'
import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { aboutStages } from '@/lib/organizations/dashboard-rules'
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
    const [noteTucked, setNoteTucked] = useState(false)
    const viewer = data?.card.kind === 'invite' ? 'admin' as const : data?.card.kind === 'visitor' ? 'visitor' as const : 'member' as const
    const stages = data ? aboutStages(data.stageCount, viewer) : null
    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-4 lg:col-span-8">
                {/* Report §26.9: a former member of a public organization sees their own line, nothing more. */}
                {data?.formerLine ? <p role="status" className="rounded-[5px] border border-border bg-muted/40 px-3 py-2 text-sm">{data.formerLine}</p> : null}
                {/* Report §7.3: the welcome note is for people inside; members can tuck it away, admins add one. */}
                {org?.welcomeNote && viewer !== 'visitor' && !noteTucked ? (
                    <section aria-label="Welcome note" className="flex items-start gap-2 rounded-lg border border-border bg-card p-4">
                        <p className="nb-body min-w-0 flex-1 whitespace-pre-line text-foreground">{org.welcomeNote}</p>
                        {viewer === 'member' ? <button type="button" aria-label="Hide welcome note" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setNoteTucked(true)}><X className="size-4" /></button> : null}
                    </section>
                ) : !org?.welcomeNote && viewer === 'admin' ? (
                    <Link href={`${base}?tab=settings`} className="inline-block text-sm underline underline-offset-4">Add a welcome note</Link>
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
                        <ul className="divide-y divide-border">
                            {data.projects.map((p) => <li key={p.id}><Link href={`/workspaces/${encodeURIComponent(p.slug ?? p.id)}`} className="flex min-h-10 items-center justify-between gap-2 text-sm hover:text-primary"><span className="truncate">{p.title}</span><span aria-hidden="true">→</span></Link></li>)}
                        </ul>
                    </RailSection>
                ) : null}
            </div>
            <aside aria-label="Organization details" className="min-w-0 space-y-6 lg:col-span-4">
                {/* Report §7.3, decision 79: stages come from sprints and teach when empty; one sprint is a plain stop. */}
                {stages === 'timeline' && data?.journey ? (
                    <JourneyTimeline stages={data.journey.stages} currentStageIndex={data.journey.currentIndex} isCreator={false} stageCompletionDates={data.journey.completionDates} layout="rail" />
                ) : stages === 'single' && data?.journey ? (
                    <RailSection title="Stages">
                        <p className="text-sm">{data.journey.stages[0]}{data.journey.currentIndex > 0 ? ' · Completed' : ''}</p>
                        {viewer === 'admin' ? <Link href={`${base}?tab=sprints`} className="text-[13px] text-primary hover:underline">Add the next sprint</Link> : null}
                    </RailSection>
                ) : stages === 'ghost' ? (
                    <RailSection title="Stages">
                        <div aria-hidden="true" className="mb-2 flex items-center gap-2 opacity-40">{[0, 1, 2].map((i) => <span key={i} className="flex flex-1 items-center gap-2"><span className="size-2.5 rounded-full border border-border" /><span className="h-px flex-1 bg-border" /></span>)}</div>
                        <p className="text-sm text-muted-foreground">Your sprints become stages here.</p>
                        <Link href={`${base}?tab=sprints`} className="text-[13px] text-primary hover:underline">Plan your first sprint</Link>
                    </RailSection>
                ) : stages === 'hint' ? (
                    <RailSection title="Stages"><p className="text-sm text-muted-foreground">Stages appear once sprints are planned.</p></RailSection>
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
                        // Report §7.11: the same invite panel as the header and Members.
                        <OrgInvitePanel orgId={project.id} orgHandle={project.slug ?? null} />
                    ) : data.card.kind === 'member' || data.card.kind === 'guest' ? (
                        <RailSection title={project.title}>
                            {/* Report §39.5: the role word without "a" or "an"; links to My membership (§7.3). */}
                            <p className="text-sm text-muted-foreground">
                                {data.card.kind === 'guest' ? 'Viewer · read only' : org?.roleNames?.member ?? 'Member'}
                                {data.card.joinedAt ? ` · Joined ${new Date(data.card.joinedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                            </p>
                            <Link href={`${base}?tab=settings`} className="text-[13px] text-primary hover:underline">My membership</Link>
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
                                    <dd className="min-w-0 break-words text-right">
                                        {value}
                                        {/* Gap 21: the handle gets a Copy button. */}
                                        {term === 'Handle' ? <button type="button" className="ml-2 text-[12px] underline underline-offset-4" onClick={() => void navigator.clipboard.writeText(value ?? '').then(() => toast.success('Handle copied'))}>Copy</button> : null}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </RailSection>
                ) : null}
            </aside>
        </div>
    )
}
