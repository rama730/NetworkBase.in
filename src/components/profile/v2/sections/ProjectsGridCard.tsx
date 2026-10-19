"use client";

import { useMemo } from "react";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import ProjectCard from "@/components/projects/ProjectCard";
import ProjectCardSkeleton from "@/components/projects/ProjectCardSkeleton";
import { toProjectCardViewModel } from "@/lib/view-models/project-card";
import { useUserFollowedProjects } from "@/hooks/projects/useUserInteractions";
import { useAuth } from "@/hooks/useAuth";
import type { ProfileCollaborationProject } from "@/lib/profile/collaboration";
import type { Project } from "@/types/discover";

interface ProjectsGridCardProps {
    projects: ProfileCollaborationProject[];
    title?: string;
    description?: string;
    isLoading?: boolean;
    onProjectIntent?: (href: string) => void;
}

function toDiscoveryProject(project: ProfileCollaborationProject): Project {
    const status: Project["status"] = project.status === "draft"
        || project.status === "completed"
        || project.status === "archived"
        ? project.status
        : "active";

    return {
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

export function ProjectsGridCard({ projects, title = "Projects", description, isLoading = false, onProjectIntent }: ProjectsGridCardProps) {
    const { user } = useAuth();
    // The bell shows whether you follow each project (one lookup for the whole grid).
    const followed = useUserFollowedProjects(user?.id, useMemo(() => [projects.map((project) => project.id)], [projects]));
    return <section className="space-y-4">
        <div><h2 className="nb-section-title">{title}</h2>{description && <p className="nb-compact text-muted-foreground">{description}</p>}</div>
        {isLoading ? (
            <div
                className="nb-portfolio-grid flex flex-col gap-4 w-full"
                style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}
                aria-busy="true"
                role="status"
            >
                <span className="sr-only">Loading projects…</span>
                {[1,2,3,4].map(key => <ProjectCardSkeleton key={key} />)}
            </div>
        ) : projects.length ? (
            <div
                className="nb-portfolio-grid flex flex-col gap-4 w-full"
                style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}
            >
                {projects.map(project => {
                    const cardProject = toDiscoveryProject(project);
                    const href = project.href || project.url;
                    return (
                        <div
                            key={project.id}
                            className="w-full min-w-0"
                            style={{ width: "100%", minWidth: 0 }}
                            onMouseEnter={() => onProjectIntent?.(href)}
                            onFocusCapture={() => onProjectIntent?.(href)}
                        >
                            <ProjectCard
                                project={cardProject}
                                viewModel={toProjectCardViewModel(cardProject)}
                                isFollowing={followed.has(cardProject.id)}
                                followersCount={cardProject.followersCount ?? 0}
                                onOpenProject={() => onProjectIntent?.(href)}
                            />
                        </div>
                    );
                })}
            </div>
        ) : (
            <EmptyState icon={FolderKanban} title="No projects yet" description="Projects you create or contribute to will appear here." />
        )}
    </section>;
}
