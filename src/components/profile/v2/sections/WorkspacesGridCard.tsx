"use client";

import { useMemo, useState } from "react";
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
    /** Whose portfolio: "I own" means they own the workspace. */
    profileId?: string;
}

type Show = "all" | "own" | "member";
const ago = (iso: string | null) => {
    if (!iso) return null;
    const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
    return days === 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString("en", { month: "short", year: "numeric" });
};

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

export function WorkspacesGridCard({ projects: allProjects, title = "Workspaces", description, isOwner = false, isLoading = false, onProjectIntent, profileId }: ProjectsGridCardProps) {
    const { user } = useAuth();
    const [show, setShow] = useState<Show>("all");
    const [sort, setSort] = useState<"recent" | "name">("recent");
    // Report §31.3, decision 71: workspaces only; organizations live in their own section (§4.5).
    const workspaces = useMemo(() => allProjects.filter((p) => p.kind !== "organization"), [allProjects]);
    const owns = (p: ProfileCollaborationWorkspace) => Boolean(profileId && p.ownerId === profileId);
    const counts = { all: workspaces.length, own: workspaces.filter(owns).length, member: workspaces.filter((p) => !owns(p)).length };
    const projects = useMemo(() => workspaces
        .filter((p) => show === "all" || (show === "own") === owns(p))
        .sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [workspaces, show, sort, profileId]);
    // The bell shows whether you follow each project (one lookup for the whole grid).
    const pageIds = useMemo(() => [projects.map((project) => project.id)], [projects]);
    const followed = useUserFollowedWorkspaces(user?.id, pageIds);
    const myApplications = useMyApplicationStates(user?.id, pageIds);
    return <section className="space-y-4">
        <div><h2 className="nb-pf-label has-rule">{title} · <b>{counts.all}</b></h2>{description && <p className="nb-compact mt-1 text-muted-foreground">{description}</p>}</div>
        {workspaces.length ? (
            <div className="nb-pf-ptools">
                <div className="nb-pf-filters" role="group" aria-label="Show workspaces">
                    {([["all", "All", counts.all], ["own", isOwner ? "I own" : "Owns", counts.own], ["member", "Member", counts.member]] as const).map(([key, label, n]) => (
                        <button key={key} type="button" className="nb-pf-fchip" aria-pressed={show === key} onClick={() => setShow(key)}>{label}<span className="n">{n}</span></button>
                    ))}
                </div>
                <div className="nb-pf-seg" role="group" aria-label="Sort">
                    <button type="button" aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>Recent</button>
                    <button type="button" aria-pressed={sort === "name"} onClick={() => setSort("name")}>Name</button>
                </div>
            </div>
        ) : null}
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
            [projects].map((group, groupIndex) => (
            <div key={groupIndex} className="space-y-2">
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
                            <p className="nb-pf-wrole" data-pf-wrole>
                                <span className="sr-only">{project.title}: </span>
                                <span className="tag">{project.userRole}</span>
                                {owns(project) && project.userRole !== "Owner" ? <span className="tag">Owner</span> : null}
                                {ago(project.updatedAt) ? <span>Updated {ago(project.updatedAt)}</span> : null}
                            </p>
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
