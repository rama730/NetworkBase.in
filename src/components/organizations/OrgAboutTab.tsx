'use client'

import ProjectOverviewCard from '@/components/projects/dashboard/ProjectOverviewCard'
import type { Project } from '@/types/discover'

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })
const month = (iso: string | null) => (iso ? MONTH.format(new Date(`${iso}T00:00:00`)) : null)

/**
 * The org's About tab (report §7.2): the overview card that projects show on their Dashboard, under one line
 * of facts. ponytail: P11 adds Leaders, top projects, the Journey and the Join card.
 */
export function OrgAboutTab({ project, isCreator, onEdit }: { project: Project; isCreator: boolean; onEdit: () => void }) {
    const org = project.organization
    const memberCount = org?.memberCount ?? 0
    const term = org && (org.termStart || org.termEnd) ? `Term ${month(org.termStart) ?? '…'} – ${month(org.termEnd) ?? '…'}` : null
    const facts = [
        `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`,
        org?.childProjectCount ? `${org.childProjectCount} ${org.childProjectCount === 1 ? 'project' : 'projects'}` : null,
        project.createdAt ? `since ${MONTH.format(new Date(project.createdAt))}` : null,
        term,
    ].filter(Boolean)
    return (
        <div className="mx-auto w-full max-w-4xl space-y-4">
            <p className="nb-compact text-muted-foreground" data-testid="org-about-facts">{facts.join(' · ')}</p>
            {org?.welcomeNote ? (
                <section aria-label="Welcome note" className="rounded-lg border border-border bg-card p-4">
                    <p className="nb-body whitespace-pre-line text-foreground">{org.welcomeNote}</p>
                </section>
            ) : null}
            <ProjectOverviewCard project={project} isCreator={isCreator} onEdit={onEdit} />
        </div>
    )
}
