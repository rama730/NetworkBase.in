"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Users, Bell, BellRing, BarChart2, ExternalLink, Globe, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Workspace } from "@/types/discover";
import type { ApplicationCardChip } from "@/app/actions/applications";
import { toWorkspaceCardViewModel, type WorkspaceCardViewModel } from "@/lib/view-models/workspace-card";
import { useToggleWorkspaceFollow } from "@/hooks/mutations/useWorkspaceMutations";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SkillIcon } from "@/components/skills/SkillIcon";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { SocialPresenceIcon } from "@/components/profile/SocialPresenceIcon";
import { resolveWorkspaceSocialLinks } from "@/lib/workspaces/social-links";
import WorkspaceAvatar, { getWorkspaceAvatarUrl } from "@/components/workspaces/WorkspaceAvatar";
import { WorkspaceLastUpdate } from "@/components/workspaces/WorkspaceLastUpdate";
import { ReportDialog, ReportMenuItem } from "@/components/reports/ReportDialog";
import { useWorkspaceCardLive } from "@/hooks/useWorkspaceLiveCounts";
import { formatCount, viewCountDisplay } from "@/lib/format-count";

const MAX_PROJECT_CARD_SKILL_ICONS = 6;
const APPLICATION_CHIP_LABEL = { applied: "Applied", declined: "Declined", invited: "Invited" } as const;
const APPLICATION_CHIP_TONE = { applied: "draft", declined: "blocked", invited: "active" } as const;

interface ProjectCardProps {
    project: Workspace;
    /** Built from `project` when not given, so the card memoizes on the project itself. */
    viewModel?: WorkspaceCardViewModel;
    isFollowing?: boolean;
    followersCount?: number;
    /** The viewer's own application or invitation on this project (read per viewer, since the feed is public and cached). */
    applicationChip?: ApplicationCardChip;
    onOpenProject?: (projectId: string) => void;
    /** Keep the counts live while on screen. Only where they read from the Discover cache. */
    live?: boolean;
    /**
     * Inside an organization (workspaces report §2): its chip on the title line, its lines under "Updated by", more in
     * the footer after the people, an action before the ⋯, and the admins' items in the card's own ⋯.
     */
    titleChip?: ReactNode;
    orgDetails?: ReactNode;
    footerExtra?: ReactNode;
    footerEnd?: ReactNode;
    menuItems?: ReactNode;
}

export default memo(function ProjectCard({ project, viewModel, isFollowing = false, followersCount: initialFollowers, applicationChip, onOpenProject, live = false, titleChip, orgDetails, footerExtra, footerEnd, menuItems }: ProjectCardProps) {
    useSkillCatalog();
    const { user } = useAuth();
    const [reporting, setReporting] = useState(false);
    const { mutateAsync } = useToggleWorkspaceFollow();
    const [following, setFollowing] = useState(isFollowing);
    // An unknown count reads as a dash, never as a confident zero (state matrix).
    const [followers, setFollowers] = useState<number | undefined>(initialFollowers);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<"signed-out" | "failed" | null>(null);
    const followLock = useRef(false);
    const cardRef = useRef<HTMLElement>(null);
    useWorkspaceCardLive(cardRef, project.id, live && Boolean(user));
    useEffect(() => { setFollowing(isFollowing); }, [isFollowing]);
    useEffect(() => { setFollowers(initialFollowers); }, [initialFollowers]);
    const { techStack, collaborators, totalOpenRoles, teamSize } = useMemo(() => viewModel ?? toWorkspaceCardViewModel(project), [viewModel, project]);
    const hiddenTechStackCount = Math.max(0, techStack.length - MAX_PROJECT_CARD_SKILL_ICONS);
    const links = resolveWorkspaceSocialLinks(project.externalLinks, project.githubRepoUrl);
    const primaryProjectLink = links.find(link => !link.managed) ?? links[0] ?? null;
    const orderedLinks = primaryProjectLink ? [primaryProjectLink, ...links.filter(link => link !== primaryProjectLink)] : [];
    const visibleLinks = orderedLinks.slice(0, 4);
    // More than 4 links go in a "+N" menu (spec), never silently dropped.
    const moreLinks = orderedLinks.slice(4);
    // Org cards open the org's About tab at /org/<handle> (report §24.1, §24.7).
    const isOrg = project.kind === "organization";
    const href = isOrg ? `/org/${project.slug || project.id}` : `/workspaces/${project.slug || project.id}`;
    const orgTypeLabel = project.orgTypeLabel ?? (project.orgType ? project.orgType.charAt(0).toUpperCase() + project.orgType.slice(1) : "Organization");
    // A child project's org line, its own link above the card link (report §24.2).
    const orgLine = project.cardOrg ? (
        <Link prefetch={false} href={`/org/${encodeURIComponent(project.cardOrg.slug ?? "")}`} className="relative z-10 -mb-1 inline-flex w-fit items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground hover:underline">
            <span aria-hidden="true" className="inline-block size-2 rounded-[2px] bg-foreground/60" />{project.cardOrg.title} /
        </Link>
    ) : null;
    // "Part of RV College of Engineering" under an org's name (report §34.11).
    const partOfLine = isOrg && project.orgPartOf ? <p className="nb-compact mt-0.5 truncate text-muted-foreground" data-testid="org-card-part-of">{project.orgPartOf}</p> : null;
    const typeChip = isOrg ? <span className="nb-status relative z-10 ml-auto shrink-0" data-status="active">{orgTypeLabel}</span>
        : titleChip ? <span className="relative z-10 ml-auto flex shrink-0 items-center gap-1">{titleChip}</span> : null;
    // Decision 70: a verified organization's ✓ beside its name.
    // D2 (2026-11-05 findings): the tooltip says what the ✓ was checked against.
    const verifiedMark = isOrg && project.orgVerified ? <span className="ml-1 text-primary" title={project.orgVerifiedLabel ?? `${project.title} is verified`}><span aria-hidden="true">✓</span><span className="sr-only"> {project.orgVerifiedLabel ?? 'Verified'}</span></span> : null;
    const linkHref = (link: (typeof links)[number]) => `/go/project/${encodeURIComponent(project.id)}/${encodeURIComponent(link.id || link.canonicalKey)}`;

    async function toggleFollow() {
        if (followLock.current) return;
        followLock.current = true;
        setBusy(true);
        setError(null);
        const previous = following;
        const previousCount = followers ?? 0;
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

    const coverUrl = getWorkspaceAvatarUrl(project);
    const views = viewCountDisplay(project.viewCount, user?.id === project.ownerId);

    return <article ref={cardRef} className="nb-project-card group h-full" data-project-id={project.id} data-testid={`project-card-${project.id}`} data-kind={project.kind ?? "project"}>
        {orgLine}
        {coverUrl ? (
            <div className="flex items-center gap-3">
                <WorkspaceAvatar project={project} size="card" />
                <div className="min-w-0 flex-1">
                    {typeChip ? <div className="float-right">{typeChip}</div> : null}
                    <h3 className="nb-project-card-title min-w-0">
                        <Link prefetch={false} href={href} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey) onOpenProject?.(project.id); }} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none">{project.title}</Link>{verifiedMark}
                    </h3>
                    {partOfLine}
                    {(project.shortDescription || project.description) && (
                        // 5px under the title (spec), in both header layouts.
                        <p className={`mt-[5px] text-sm leading-normal text-muted-foreground line-clamp-2`}>
                            {project.shortDescription || project.description}
                        </p>
                    )}
                </div>
            </div>
        ) : (
            <>
                <div className="flex flex-wrap items-start gap-2">
                    <h3 className="nb-project-card-title min-w-0">
                        <Link prefetch={false} href={href} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey) onOpenProject?.(project.id); }} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none">{project.title}</Link>{verifiedMark}
                    </h3>
                    {partOfLine}
                    {typeChip}
                </div>
                {project.shortDescription || project.description ? (
                    <p className={`-mt-[7px] text-sm leading-normal text-muted-foreground line-clamp-2`}>
                        {project.shortDescription || project.description}
                    </p>
                ) : null}
            </>
        )}
        {(project.rankingReasons?.length ?? 0) > 0 && <p className="nb-meta">{project.rankingReasons!.join(" · ")}</p>}
        {techStack.length > 0 && <div className="flex flex-wrap gap-1.5" role="group" aria-label="Workspace skills">
            {techStack.slice(0, MAX_PROJECT_CARD_SKILL_ICONS).map(name => { const skill = resolveClientSkill(name); return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>; })}
            {/* Above the card's stretched link, so its tooltip shows; the names are read out too. */}
            {hiddenTechStackCount > 0 && <span className="nb-tag relative z-10" title={techStack.slice(MAX_PROJECT_CARD_SKILL_ICONS).join(", ")}>+{hiddenTechStackCount}<span className="sr-only">: {techStack.slice(MAX_PROJECT_CARD_SKILL_ICONS).join(", ")}</span></span>}
        </div>}
        <WorkspaceLastUpdate projectId={project.id} className="nb-meta block truncate" />
        {orgDetails}
        <div className="nb-project-card-footer">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex -space-x-1.5" role="group" aria-label={`${teamSize} ${teamSize === 1 ? "member" : "members"}`}>
                    {collaborators.slice(0, 4).map((person, index) => <UserAvatar key={person.username || index} identity={person} size={26} className="border-2 border-card" fallbackClassName="text-[11px]" />)}
                    {teamSize > 4 && <span className="flex size-[26px] items-center justify-center rounded-md border-2 border-card bg-secondary font-mono text-[11px]">+{teamSize - 4}</span>}
                </div>
                {collaborators.length === 0 && <span className="nb-meta inline-flex items-center gap-1"><Users size={14} aria-hidden="true" />No team yet</span>}
                {isOrg ? <>
                    {/* Report §31.6: member count, or "You're a member"; workspace count. Join is on the page (decision 73). */}
                    <span className="nb-meta">{project.viewerIsMember ? "You’re a member" : `${teamSize} ${teamSize === 1 ? "member" : "members"}`}</span>
                    {typeof project.childProjectCount === "number" ? <span className="nb-meta">{project.childProjectCount} {project.childProjectCount === 1 ? "workspace" : "workspaces"}</span> : null}
                    {project.slug ? <Link prefetch={false} href={`/discover?org=${encodeURIComponent(project.slug)}`} className="nb-meta relative z-10 hover:text-foreground hover:underline" title={`Show everything from ${project.title}`}>Show everything</Link> : null}
                </> : applicationChip ? <span className="nb-status relative z-10" data-status={APPLICATION_CHIP_TONE[applicationChip]} title="Your application in this workspace">{APPLICATION_CHIP_LABEL[applicationChip]}</span>
                    : totalOpenRoles > 0 && <span className="nb-meta text-primary">{totalOpenRoles} open {totalOpenRoles === 1 ? "role" : "roles"}</span>}
                {footerExtra}
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-1">
                {visibleLinks.map(link => <a key={link.id || link.canonicalKey} href={linkHref(link)} target="_blank" rel="noopener noreferrer" className="nb-icon-button" aria-label={`Open ${link.customLabel || link.platformLabel}: ${link.accountLabel} (opens in new tab)`}>
                    {link.iconKey ? <SocialPresenceIcon iconKey={link.iconKey} className="size-4" /> : link.platform === "website" ? <Globe size={16} /> : <ExternalLink size={16} />}
                </a>)}
                {moreLinks.length ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger className="nb-icon-button px-1.5 font-mono text-xs" aria-label={`${moreLinks.length} more links`}>+{moreLinks.length}</DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            {moreLinks.map(link => (
                                <DropdownMenuItem key={link.id || link.canonicalKey} asChild>
                                    <a href={linkHref(link)} target="_blank" rel="noopener noreferrer">
                                        {link.iconKey ? <SocialPresenceIcon iconKey={link.iconKey} className="size-4" /> : <ExternalLink />}
                                        <span className="truncate">{link.customLabel || link.platformLabel}: {link.accountLabel}</span>
                                    </a>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
                {views.visible ? <span className="nb-meta flex items-center gap-1 px-1" title={views.exact} aria-label={views.exact} data-testid={`project-card-views-${project.id}`}><BarChart2 size={14} aria-hidden="true" /><span key={views.text} className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">{views.text}</span></span> : null}
                {/* A project follow is a bell (its updates), not a person icon; pressed reads in clay, not only by icon. */}
                <button type="button" aria-disabled={busy || undefined} aria-busy={busy} aria-pressed={following} aria-label={`Follow ${project.title}, ${followers ?? "unknown"} ${followers === 1 ? "follower" : "followers"}`} title={following ? "Following" : "Follow"} className="nb-icon-button gap-1 px-1.5 font-mono text-xs" onClick={toggleFollow} data-testid={`project-card-follow-${project.id}`}>
                    {following ? <BellRing size={16} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}{followers === undefined ? "—" : formatCount(followers)}
                </button>
                {footerEnd}
                {/* Report (report §30.3): signed-in people other than the owner. An organization's admins add their items. */}
                {menuItems || (user && user.id !== project.ownerId) ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger className="nb-icon-button px-1" aria-label={`More actions for ${project.title}`}><MoreHorizontal size={16} aria-hidden="true" /></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            {menuItems}
                            {user && user.id !== project.ownerId ? <ReportMenuItem first={!menuItems} noun={isOrg ? "organization" : "workspace"} target={{ kind: "project", targetId: project.id }} onReport={() => setReporting(true)} /> : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
                {reporting ? <ReportDialog kind="project" targetId={project.id} noun={isOrg ? "organization" : "workspace"} open={reporting} onOpenChange={setReporting} /> : null}
            </div>
        </div>
        {error === "signed-out" ? (
            <p role="alert" className="relative z-10 nb-compact text-muted-foreground">
                <Link prefetch={false} href={`${ROUTES.LOGIN}?redirect=${encodeURIComponent(href)}`} className="font-medium text-primary hover:underline">Sign in</Link> to follow workspaces.
            </p>
        ) : error === "failed" ? (
            <ErrorNotice message="Couldn’t update your follow." onRetry={() => void toggleFollow()} className="relative z-10" />
        ) : null}
    </article>;
});
