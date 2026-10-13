'use client'

import { useMemo, useState } from 'react'
import { Briefcase, EyeOff, FolderGit2, Github, Globe, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { Card } from './Card'
import type { ProfileCollaborationContribution, ProfileCollaborationRoleStage } from '@/lib/profile/collaboration'
import { SkillList } from '@/components/skills/SkillList'

interface ProjectContributionsCardProps {
    contributions: ProfileCollaborationContribution[]
    isOwner: boolean
    onAdd?: () => void
    projects?: Array<{ id?: string; title?: string; url?: string }>
    onProjectIntent?: (href: string) => void
}

function formatJoinedDate(value: string | null | undefined) {
    if (!value) return null
    const month = /^(\d{4})-(\d{2})/.exec(value)
    const date = month
        ? new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1))
        : new Date(value)
    if (!Number.isFinite(date.getTime())) return value
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function asTags(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean)
    if (typeof value === 'string') return value.split(',').map((tag) => tag.trim()).filter(Boolean)
    return []
}

function fallbackStage(contribution: ProfileCollaborationContribution): ProfileCollaborationRoleStage {
    return {
        id: `${contribution.id}:stage`,
        contributionId: contribution.id,
        roleKind: contribution.roleKind || 'contributor',
        roleTitle: contribution.title || 'Contributor',
        summary: contribution.description,
        skills: contribution.skills || [],
        startDate: contribution.startDate,
        endDate: contribution.endDate,
        startedAt: contribution.startDate,
        endedAt: contribution.endDate,
        currentlyActive: Boolean(contribution.currentlyActive),
        source: contribution.source || 'manual',
        verified: Boolean(contribution.verified),
        verifiedAt: null,
    }
}

export function ProjectContributionsCard({
    contributions,
    isOwner,
    onAdd,
    projects = [],
    onProjectIntent,
}: ProjectContributionsCardProps) {
    // Phones show the first two contributions until "Show all" (spec §17, no 750px card).
    const [showAllMobile, setShowAllMobile] = useState(false)
    const visibleContributions = useMemo(
        () => (contributions || []).filter((contribution) => contribution && (isOwner || contribution.visibility === 'public')),
        [contributions, isOwner],
    )

    if (!isOwner && visibleContributions.length === 0) {
        return null
    }

    return (
        <Card
            title="Project Contributions"
            mobileTitle="Project contributions"
            icon={<Briefcase className="h-5 w-5" />}
            onAdd={onAdd}
            addLabel="Add project contribution"
            action={isOwner && onAdd ? (
                <button
                    type="button"
                    onClick={onAdd}
                    aria-label="Edit project contributions"
                    className="nb-touch-target inline-flex items-center justify-center rounded-[3px] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:rounded-[5px]"
                >
                    <Pencil className="h-4 w-4" />
                </button>
            ) : null}
        >
            <div className="px-5 py-2 max-md:px-4">
                {visibleContributions.length > 0 ? (
                    <div className="divide-y divide-border">
                        {visibleContributions.map((contribution, contributionIndex) => {
                            const linkedProject = contribution.projectId
                                ? projects.find((project) => project.id === contribution.projectId)
                                : null
                            const projectTitle = linkedProject?.title || contribution.projectTitle || 'Unnamed project'
                            const projectUrl = linkedProject?.url || contribution.projectHref || contribution.projectUrl || null
                            // The parent row is the only visibility authority. Stages never override it.
                            const stages = contribution.roleStages?.length
                                ? contribution.roleStages
                                : [fallbackStage(contribution)]
                            const hasProgression = stages.length > 1
                            const joinedDate = formatJoinedDate(contribution.startDate)
                            const tags = asTags(contribution.skills)
                            const isPrivate = contribution.visibility === 'private'

                            return (
                                <article key={contribution.id} className={`py-5 ${!showAllMobile && contributionIndex >= 2 ? 'max-md:hidden' : ''}`}>
                                    {!!contribution.fileContributionCount && <p className="nb-meta mb-2">Contributed to {contribution.fileContributionCount} project files</p>}
                                    <div className="min-w-0">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h4 className="nb-body truncate font-semibold text-foreground">
                                                        {projectUrl ? (
                                                            <Link
                                                                href={projectUrl}
                                                                target={projectUrl.startsWith('/') ? '_self' : '_blank'}
                                                                rel="noreferrer"
                                                                onMouseEnter={() => onProjectIntent?.(projectUrl)}
                                                                onFocus={() => onProjectIntent?.(projectUrl)}
                                                                className="hover:text-primary hover:underline max-md:py-3"
                                                            >
                                                                {projectTitle}
                                                            </Link>
                                                        ) : projectTitle}
                                                        {contribution.title ? ` | ${contribution.title}` : ''}
                                                    </h4>
                                                    {isOwner && isPrivate ? (
                                                        <span className="nb-micro inline-flex items-center gap-1" title="Only you can see this contribution">
                                                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Private
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            {joinedDate ? (
                                                <span className="nb-meta shrink-0">{joinedDate}</span>
                                            ) : null}
                                        </div>

                                        {contribution.description && !hasProgression ? (
                                            <p className="nb-compact mt-2 max-w-3xl text-muted-foreground">
                                                {contribution.description}
                                            </p>
                                        ) : null}

                                        {hasProgression ? (
                                            <div className="mt-4">
                                                {stages.map((stage, stageIndex) => {
                                                    const isLast = stageIndex === stages.length - 1
                                                    const stageDate = formatJoinedDate(stage.startDate)
                                                    return (
                                                        <div key={stage.id} className="relative pb-5 pl-7 last:pb-0">
                                                            {!isLast ? <div className="absolute bottom-[-4px] left-[5px] top-4 w-px bg-border" /> : null}
                                                            <div className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-card" />
                                                            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                                                <div className="min-w-0">
                                                                    <p className="nb-compact font-semibold text-foreground">{stage.roleTitle}</p>
                                                                    {stage.summary ? <p className="nb-compact mt-1 max-w-3xl text-muted-foreground">{stage.summary}</p> : null}
                                                                    {stage.skills.length > 0 ? <SkillList skills={stage.skills} maxVisible={6} size="sm" className="mt-2" /> : null}
                                                                </div>
                                                                {stageDate ? <span className="nb-meta shrink-0">{stageDate}</span> : null}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        ) : null}

                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                            {tags.length > 0 ? <SkillList skills={tags} maxVisible={8} size="sm" /> : <span />}
                                            {contribution.repoUrl ? (
                                                <a href={contribution.repoUrl} target="_blank" rel="noreferrer" className="nb-touch-target inline-flex items-center justify-center p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label="View repository">
                                                    {contribution.repoUrl.includes('github.com') ? <Github className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                                                </a>
                                            ) : null}
                                        </div>
                                    </div>
                                </article>
                            )
                        })}
                        {!showAllMobile && visibleContributions.length > 2 ? (
                            <button
                                type="button"
                                onClick={() => setShowAllMobile(true)}
                                className="nb-ui-label flex min-h-11 w-full items-center justify-center text-primary md:hidden"
                            >
                                Show all {visibleContributions.length}
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <div className="nb-empty-state nb-grid-ground my-1 py-8 text-center">
                        <FolderGit2 className="nb-empty-state-icon mb-2" />
                        <p className="nb-card-title text-foreground">No project contributions</p>
                        <p className="nb-compact mt-1 text-muted-foreground">
                            {isOwner
                                ? "Add your external projects or contribute to projects on NetworkBase."
                                : "No public project contributions yet."}
                        </p>
                        {isOwner && onAdd ? (
                            <button
                                type="button"
                                onClick={onAdd}
                                className="nb-touch-target mt-3.5 inline-flex items-center gap-1.5 rounded-[5px] border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                            >
                                <Plus className="size-3.5" />
                                Add contribution
                            </button>
                        ) : null}
                    </div>
                )}
            </div>
        </Card>
    )
}
