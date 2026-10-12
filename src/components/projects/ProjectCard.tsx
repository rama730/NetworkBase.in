"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Users, Bell, BellRing, BarChart2, ExternalLink, Globe } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";
import type { Project } from "@/types/discover";
import { toProjectCardViewModel, type ProjectCardViewModel } from "@/lib/view-models/project-card";
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
    /** Built from `project` when not given, so the card memoizes on the project itself. */
    viewModel?: ProjectCardViewModel;
    fromTab?: string;
    isFollowing?: boolean;
    followersCount?: number;
    onOpenProject?: (projectId: string) => void;
}

export default memo(function ProjectCard({ project, viewModel, fromTab = "projects", isFollowing = false, followersCount: initialFollowers = 0, onOpenProject }: ProjectCardProps) {
    useSkillCatalog();
    const { user } = useAuth();
    const { mutateAsync } = useToggleProjectFollow();
    const [following, setFollowing] = useState(isFollowing);
    const [followers, setFollowers] = useState(initialFollowers);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<"signed-out" | "failed" | null>(null);
    const followLock = useRef(false);
    useEffect(() => { setFollowing(isFollowing); }, [isFollowing]);
    useEffect(() => { setFollowers(initialFollowers); }, [initialFollowers]);
    const { techStack, collaborators, totalOpenRoles } = useMemo(() => viewModel ?? toProjectCardViewModel(project), [viewModel, project]);
    const hiddenTechStackCount = Math.max(0, techStack.length - MAX_PROJECT_CARD_SKILL_ICONS);
    const links = resolveProjectSocialLinks(project.externalLinks, project.githubRepoUrl);
    const primaryProjectLink = links.find(link => !link.managed) ?? links[0] ?? null;
    const visibleLinks = primaryProjectLink ? [primaryProjectLink, ...links.filter(link => link !== primaryProjectLink)].slice(0, 4) : [];
    const href = `/projects/${project.slug || project.id}?fromTab=${encodeURIComponent(fromTab)}`;

    async function toggleFollow() {
        if (followLock.current) return;
        followLock.current = true;
        setBusy(true);
        setError(null);
        const previous = following;
        const previousCount = followers;
        try {
            // The signed-in user is already known: no round trip before the button responds.
            if (!user) { setError("signed-out"); return; }
            setFollowing(!previous);
            setFollowers(Math.max(0, previousCount + (previous ? -1 : 1)));
            const result = await mutateAsync({ projectId: project.id, currentStatus: previous, userId: user.id });
            if (result?.followersCount !== undefined) setFollowers(result.followersCount);
        } catch {
            setFollowing(previous);
            setFollowers(previousCount);
            setError("failed");
        } finally {
            followLock.current = false;
            setBusy(false);
        }
    }

    const coverUrl = getProjectAvatarUrl(project);

    return <article className="nb-project-card group h-full" data-project-id={project.id} data-testid={`project-card-${project.id}`}>
        {coverUrl ? (
            <div className="flex items-center gap-3">
                <ProjectAvatar project={project} size="card" />
                <div className="min-w-0 flex-1">
                    <h3 className="nb-project-card-title min-w-0">
                        <Link href={href} onClick={() => onOpenProject?.(project.id)} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none">{project.title}</Link>
                    </h3>
                    {(project.shortDescription || project.description) && (
                        <p className={`mt-0.5 text-sm leading-normal text-muted-foreground line-clamp-2`}>
                            {project.shortDescription || project.description}
                        </p>
                    )}
                </div>
            </div>
        ) : (
            <>
                <div className="flex flex-wrap items-start gap-2">
                    <h3 className="nb-project-card-title min-w-0">
                        <Link href={href} onClick={() => onOpenProject?.(project.id)} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none">{project.title}</Link>
                    </h3>
                </div>
                {project.shortDescription || project.description ? (
                    <p className={`text-sm leading-normal text-muted-foreground line-clamp-2`}>
                        {project.shortDescription || project.description}
                    </p>
                ) : null}
            </>
        )}
        {(project.rankingReasons?.length ?? 0) > 0 && <p className="nb-meta">{project.rankingReasons!.join(" · ")}</p>}
        {techStack.length > 0 && <div className="flex flex-wrap gap-1.5" role="group" aria-label="Project skills">
            {techStack.slice(0, MAX_PROJECT_CARD_SKILL_ICONS).map(name => { const skill = resolveClientSkill(name); return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>; })}
            {/* Above the card's stretched link, so its tooltip shows; the names are read out too. */}
            {hiddenTechStackCount > 0 && <span className="nb-tag relative z-10" title={techStack.slice(MAX_PROJECT_CARD_SKILL_ICONS).join(", ")}>+{hiddenTechStackCount}<span className="sr-only">: {techStack.slice(MAX_PROJECT_CARD_SKILL_ICONS).join(", ")}</span></span>}
        </div>}
        <div className="nb-project-card-footer">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex -space-x-1.5" role="group" aria-label={`${collaborators.length} ${collaborators.length === 1 ? "collaborator" : "collaborators"}`}>
                    {collaborators.slice(0, 4).map((person, index) => <UserAvatar key={person.username || index} identity={person} size={26} className="border-2 border-card" fallbackClassName="text-[11px]" />)}
                    {collaborators.length > 4 && <span className="flex size-[26px] items-center justify-center rounded-md border-2 border-card bg-secondary font-mono text-[11px]">+{collaborators.length - 4}</span>}
                    {collaborators.length === 0 && <Users size={16} className="text-muted-foreground" aria-hidden="true" />}
                </div>
                {totalOpenRoles > 0 && <span className="nb-meta text-primary">{totalOpenRoles} open {totalOpenRoles === 1 ? "role" : "roles"}</span>}
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-1">
                {visibleLinks.map(link => <a key={link.id || link.canonicalKey} href={`/go/project/${encodeURIComponent(project.id)}/${encodeURIComponent(link.id || link.canonicalKey)}`} target="_blank" rel="noopener noreferrer" className="nb-icon-button" aria-label={`Open ${link.customLabel || link.platformLabel}: ${link.accountLabel} (opens in new tab)`}>
                    {link.iconKey ? <SocialPresenceIcon iconKey={link.iconKey} className="size-4" /> : link.platform === "website" ? <Globe size={16} /> : <ExternalLink size={16} />}
                </a>)}
                <span className="nb-meta flex items-center gap-1 px-1" title="Views" data-testid={`project-card-views-${project.id}`}><BarChart2 size={14} aria-hidden="true" />{project.viewCount || 0}<span className="sr-only"> views</span></span>
                {/* A project follow is a bell (its updates), not a person icon; pressed reads in clay, not only by icon. */}
                <button type="button" disabled={busy} aria-busy={busy} aria-pressed={following} aria-label={`Follow ${project.title}, ${followers} ${followers === 1 ? "follower" : "followers"}`} title={following ? "Following" : "Follow"} className="nb-icon-button gap-1 px-1.5 font-mono text-xs disabled:opacity-45" onClick={toggleFollow} data-testid={`project-card-follow-${project.id}`}>
                    {following ? <BellRing size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}{followers}
                </button>
            </div>
        </div>
        {error === "signed-out" ? (
            <p role="alert" className="relative z-10 nb-compact text-muted-foreground">
                <Link href={`${ROUTES.LOGIN}?redirect=${encodeURIComponent(href)}`} className="font-medium text-primary hover:underline">Sign in</Link> to follow this project.
            </p>
        ) : error === "failed" ? (
            <p role="alert" className="relative z-10 nb-compact text-[var(--status-danger)]">Couldn&apos;t update. Try again.</p>
        ) : null}
    </article>;
});
