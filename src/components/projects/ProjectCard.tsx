"use client";

import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { Users, UserPlus, UserCheck, BarChart2, ExternalLink, Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/types/discover";
import type { ProjectCardViewModel } from "@/lib/view-models/project-card";
import { useToggleProjectFollow } from "@/hooks/mutations/useProjectMutations";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SkillIcon } from "@/components/skills/SkillIcon";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { SocialPresenceIcon } from "@/components/profile/SocialPresenceIcon";
import { resolveProjectSocialLinks } from "@/lib/projects/social-links";
import ProjectAvatar, { getProjectAvatarUrl } from "@/components/projects/ProjectAvatar";

const MAX_PROJECT_CARD_SKILL_ICONS = 6;

interface ProjectCardProps {
    project: Project;
    viewModel: ProjectCardViewModel;
    fromTab?: string;
    viewMode?: string;
    previewMode?: boolean;
    isFollowing?: boolean;
    followersCount?: number;
    onOpenProject?: (projectId: string) => void;
}

export default memo(function ProjectCard({ project, viewModel, fromTab = "projects", viewMode = "grid", previewMode = false, isFollowing = false, followersCount: initialFollowers = 0, onOpenProject }: ProjectCardProps) {
    useSkillCatalog();
    const { mutateAsync } = useToggleProjectFollow();
    const [following, setFollowing] = useState(isFollowing);
    const [followers, setFollowers] = useState(initialFollowers);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const followLock = useRef(false);
    useEffect(() => { setFollowing(isFollowing); }, [isFollowing]);
    useEffect(() => { setFollowers(initialFollowers); }, [initialFollowers]);
    const { techStack, collaborators, totalOpenRoles } = viewModel;
    const hiddenTechStackCount = Math.max(0, techStack.length - MAX_PROJECT_CARD_SKILL_ICONS);
    const links = resolveProjectSocialLinks(project.externalLinks, project.githubRepoUrl);
    const primaryProjectLink = links.find(link => !link.managed) ?? links[0] ?? null;
    const visibleLinks = primaryProjectLink ? [primaryProjectLink, ...links.filter(link => link !== primaryProjectLink)].slice(0, 4) : [];
    const href = `/projects/${project.slug || project.id}?fromTab=${encodeURIComponent(fromTab)}`;
    const compact = viewMode === "list";

    async function toggleFollow() {
        if (followLock.current || previewMode) return;
        followLock.current = true;
        setBusy(true);
        setError(null);
        const previous = following;
        const previousCount = followers;
        try {
            const { data: { user } } = await createClient().auth.getUser();
            if (!user) { setError("Sign in to follow this project."); return; }
            setFollowing(!previous);
            setFollowers(Math.max(0, previousCount + (previous ? -1 : 1)));
            const result = await mutateAsync({ projectId: project.id, currentStatus: previous, userId: user.id });
            if (result?.followersCount !== undefined) setFollowers(result.followersCount);
        } catch {
            setFollowing(previous);
            setFollowers(previousCount);
            setError("Could not update follow status. Try again.");
        } finally {
            followLock.current = false;
            setBusy(false);
        }
    }

    const avatarUrl = getProjectAvatarUrl(project);

    return <article className="nb-project-card group h-full" data-project-id={project.id} data-testid={`project-card-${project.id}`} data-view={viewMode}>
        {avatarUrl ? (
            <div className="flex items-center gap-3">
                <ProjectAvatar project={project} size="card" />
                <div className="min-w-0 flex-1">
                    <h3 className="nb-project-card-title min-w-0">
                        {previewMode ? project.title : <Link href={href} onClick={() => onOpenProject?.(project.id)} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none">{project.title}</Link>}
                    </h3>
                    {(project.shortDescription || project.description) && (
                        <p className={`mt-0.5 text-sm leading-normal text-muted-foreground ${compact ? "line-clamp-1" : "line-clamp-2"}`}>
                            {project.shortDescription || project.description}
                        </p>
                    )}
                </div>
            </div>
        ) : (
            <>
                <div className="flex flex-wrap items-start gap-2">
                    <h3 className="nb-project-card-title min-w-0">
                        {previewMode ? project.title : <Link href={href} onClick={() => onOpenProject?.(project.id)} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none">{project.title}</Link>}
                    </h3>
                </div>
                <p className={`text-sm leading-normal text-muted-foreground ${compact ? "line-clamp-1" : "line-clamp-2"}`}>
                    {project.shortDescription || project.description || "No description provided."}
                </p>
            </>
        )}
        {!compact && project.shortDescription && project.description && project.description !== project.shortDescription && <p className="text-sm leading-normal text-muted-foreground line-clamp-2">{project.description}</p>}
        {(project.rankingReasons?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1.5">{project.rankingReasons?.map(reason => <span className="nb-tag" key={reason}>{reason}</span>)}</div>}
        {!compact && techStack.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Project skills">
            {techStack.slice(0, MAX_PROJECT_CARD_SKILL_ICONS).map(name => { const skill = resolveClientSkill(name); return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>; })}
            {hiddenTechStackCount > 0 && <span className="nb-tag" title={techStack.slice(MAX_PROJECT_CARD_SKILL_ICONS).join(", ")}>+{hiddenTechStackCount}</span>}
        </div>}
        {totalOpenRoles > 0 && <span className="text-sm text-primary">{totalOpenRoles} open {totalOpenRoles === 1 ? "role" : "roles"}</span>}
        <div className="nb-project-card-footer">
            <div className="flex items-center gap-2">
                <div className="flex -space-x-1.5" aria-label={`${collaborators.length} collaborators`}>
                    {collaborators.slice(0, 4).map((person, index) => <UserAvatar key={person.username || index} identity={person} size={26} className="border-2 border-card" fallbackClassName="text-[11px]" />)}
                    {collaborators.length > 4 && <span className="flex size-[26px] items-center justify-center rounded-md border-2 border-card bg-secondary font-mono text-[11px]">+{collaborators.length - 4}</span>}
                    {collaborators.length === 0 && <Users size={16} className="text-muted-foreground" aria-hidden="true" />}
                </div>
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-1">
                {!previewMode && visibleLinks.map(link => <a key={link.id || link.canonicalKey} href={`/go/project/${encodeURIComponent(project.id)}/${encodeURIComponent(link.id || link.canonicalKey)}`} target="_blank" rel="noopener noreferrer" className="nb-icon-button" aria-label={`Open ${link.customLabel || link.platformLabel}: ${link.accountLabel}`}>
                    {link.iconKey ? <SocialPresenceIcon iconKey={link.iconKey} className="size-3.5" /> : link.platform === "website" ? <Globe size={14} /> : <ExternalLink size={14} />}
                </a>)}
                <span className="nb-meta flex items-center gap-1 px-1" title="Views" data-testid={`project-card-views-${project.id}`}><BarChart2 size={14} aria-hidden="true" />{project.viewCount || 0}<span className="sr-only"> views</span></span>
                <button type="button" disabled={busy || previewMode} aria-busy={busy} aria-pressed={following} aria-label={`${following ? "Unfollow" : "Follow"} ${project.title}, ${followers} followers`} className="nb-icon-button gap-1 px-1 font-mono text-xs disabled:opacity-45" onClick={toggleFollow} data-testid={`project-card-follow-${project.id}`}>
                    {following ? <UserCheck size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}{followers}
                </button>
            </div>
        </div>
        {error && <p role="alert" className="relative z-10 text-sm text-destructive">{error}</p>}
    </article>;
});
