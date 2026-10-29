"use client";

import { useMemo } from "react";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import ProjectCard from "@/components/workspaces/WorkspaceCard";
import WorkspaceCardSkeleton from "@/components/workspaces/WorkspaceCardSkeleton";
import { toWorkspaceCardViewModel } from "@/lib/view-models/workspace-card";
import { useUserFollowedWorkspaces } from "@/hooks/workspaces/useUserInteractions";
import { useMyApplicationStates } from "@/hooks/workspaces/useMyApplicationStates";
import { useAuth } from "@/hooks/useAuth";
import type { ProfileCollaborationWorkspace } from "@/lib/profile/collaboration";
import type { Workspace } from "@/types/discover";

interface ProjectsGridCardProps {
    projects: ProfileCollaborationWorkspace[];
    title?: string;
    description?: string;
    isOwner?: boolean;
    isLoading?: boolean;
    onProjectIntent?: (href: string) => void;
}

function toDiscoveryProject(project: ProfileCollaborationWorkspace): Workspace {
    const status: Workspace["status"] = project.status === "draft"
        || project.status === "completed"
        || project.status === "archived"
        ? project.status
        : "active";

    return {
        kind: project.kind,
        cardOrg: project.cardOrg ?? null,
        id: project.id,
        ownerId: project.ownerId,
        title: project.title,
        description: project.description,
        shortDescription: project.shortDescription,
        slug: project.slug ?? undefined,
        status,
        category: project.category,
        coverImage: project.coverImage,
        tags: project.tags,
        skills: project.skills,
        visibility: project.visibility ?? undefined,
        viewCount: project.viewCount ?? 0,
        followersCount: project.followersCount ?? 0,
        createdAt: project.createdAt ?? undefined,
        updatedAt: project.updatedAt,
        githubRepoUrl: project.githubRepoUrl ?? (project as any).github_repo_url ?? null,
        externalLinks: project.externalLinks ?? (project as any).external_links ?? null,
        openRolesCount: project.openRolesCount ?? (project as any).open_roles_count ?? 0,
        collaborators: project.members.map(member => ({
            userId: member.id,
            membershipRole: "member",
            user: {
                id: member.id,
                username: member.username,
                fullName: member.displayName,
                avatarUrl: member.avatarUrl,
            },
        })),
        openRoles: [],
    } as any;
}

export function WorkspacesGridCard({ projects, title = "Workspaces", description, isOwner = false, isLoading = false, onProjectIntent }: ProjectsGridCardProps) {
    const { user } = useAuth();
    // The bell shows whether you follow each project (one lookup for the whole grid).
    const pageIds = useMemo(() => [projects.map((project) => project.id)], [projects]);
    const followed = useUserFollowedWorkspaces(user?.id, pageIds);
    const myApplications = useMyApplicationStates(user?.id, pageIds);
    return <section className="space-y-4">
        <div><h2 className="nb-section-title">{title}</h2>{description && <p className="nb-compact text-muted-foreground">{description}</p>}</div>
        {isLoading ? (
            <div
                className="nb-portfolio-grid flex flex-col gap-4 w-full"
                aria-busy="true"
                role="status"
            >
                <span className="sr-only">Loading workspaces…</span>
                {[1,2,3,4].map(key => <WorkspaceCardSkeleton key={key} />)}
            </div>
        ) : projects.length ? (
            // Organizations first, then projects (report §24.4).
            [projects.filter((p) => p.kind === "organization"), projects.filter((p) => p.kind !== "organization")].filter((group) => group.length).map((group, groupIndex, groups) => (
            <div key={groupIndex} className="space-y-2">
            {groups.length > 1 ? <h3 className="nb-ui-label text-muted-foreground">{group[0]?.kind === "organization" ? "Organizations" : "Workspaces"}</h3> : null}
            <div className="nb-portfolio-grid flex flex-col gap-4 w-full">
                {group.map(project => {
                    const cardProject = toDiscoveryProject(project);
                    const href = project.href || project.url;
                    return (
                        <div
                            key={project.id}
                            className="w-full min-w-0"
                            onMouseEnter={() => onProjectIntent?.(href)}
                            onFocusCapture={() => onProjectIntent?.(href)}
                        >
                            <ProjectCard
                                project={cardProject}
                                viewModel={toWorkspaceCardViewModel(cardProject)}
                                isFollowing={followed.has(cardProject.id)}
                                followersCount={cardProject.followersCount ?? 0}
                                applicationChip={myApplications.get(cardProject.id)}
                                onOpenProject={() => onProjectIntent?.(href)}
                            />
                        </div>
                    );
                })}
            </div>
            </div>
            ))
        ) : (
            <EmptyState
                icon={FolderKanban}
                title="No workspaces yet"
                description={isOwner ? "Workspaces you create or contribute to will appear here." : "No public workspaces have been published yet."}
            />
        )}
    </section>;
}
