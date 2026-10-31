"use client";

import { SharedOrgChip } from "@/components/organizations/SharedOrgChip";
import { formatCount } from "@/lib/format-count";
import { format, formatDistanceToNow } from "@/lib/utils/date";
import {
    ArrowRight,
    Bell,
    CalendarDays,
    Eye,
    Loader2,
    Link2,
    Lock,
    MapPin,
    Palette,
    Plug,
    Settings,
    Shield,
    User,
    UserPlus,
    Users,
    UsersRound,
    X,
} from "lucide-react";
import type { ReactNode } from "react";

import { SkillIcon } from "@/components/skills";
import { hasSkillIcon } from "@/lib/skills/icon-policy";
import { SocialPresenceIcon } from "@/components/profile/SocialPresenceIcon";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { PersonPresenceDot } from "@/components/network/PersonPresenceDot";
import WorkspaceAvatar from "@/components/workspaces/WorkspaceAvatar";
import type {
    GlobalSearchPreview,
    GlobalSearchProfilePreview,
    GlobalSearchWorkspacePreview,
    GlobalSearchLinkPreview,
    GlobalSearchTaskPreview,
    GlobalSearchOrgPreview,
} from "@/hooks/useGlobalSearchPreviews";
import { getTaskPriorityPresentation, getTaskStatusPresentation } from "@/lib/workspaces/task-workflow";
import { getTaskTitlePresentation } from "@/lib/workspaces/task-presentation";
import { projectStageLabel } from "@/lib/workspaces/status-presentation";
import type { SocialPresenceIconKey } from "@/lib/profile/normalization";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { cn } from "@/lib/utils";
import type { SettingsSearchItem } from "./global-search";

type ResultInteractionProps = {
    index: number;
    activeIndex: number;
    onActivate: (index: number) => void;
};

function ResultShell({
    id,
    index,
    activeIndex,
    onActivate,
    onOpen,
    leading,
    children,
    trailing,
    action,
    onRemove,
    removeLabel,
    ariaLabel,
}: ResultInteractionProps & {
    id: string;
    onOpen: () => void;
    leading?: ReactNode;
    children: ReactNode;
    trailing?: ReactNode;
    action?: ReactNode;
    onRemove?: () => void;
    removeLabel?: string;
    ariaLabel?: string;
}) {
    const selected = index === activeIndex;
    return (
        <div
            id={`global-search-preview-${id}`}
            role="option"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-selected={selected}
            onMouseEnter={() => onActivate(index)}
            onFocus={() => onActivate(index)}
            onClick={onOpen}
            style={{ contentVisibility: "auto", containIntrinsicSize: "72px" } as React.CSSProperties}
            className={cn(
                "group relative flex w-full items-start gap-3 overflow-hidden rounded-[8px] border p-3 text-left outline-none transition-[background-color,border-color] duration-[130ms]",
                selected
                    ? "border-zinc-300 bg-zinc-50 shadow-none border-border bg-muted/65 ring-1 ring-ring/15"
                    : "border-transparent hover:border-border/60 hover:bg-muted/35",
            )}
        >
            {leading ?? null}
            <span className="min-w-0 flex-1">{children}</span>
            {trailing}
            {action}
            {onRemove ? (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove();
                    }}
                    className="nb-touch-target mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground opacity-100 transition-[color,background-color,opacity] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                    aria-label={removeLabel}
                >
                    <X className="size-3.5" aria-hidden />
                </button>
            ) : (
                <ArrowRight
                    className={cn(
                        "mt-1.5 size-4 shrink-0 transition-[color,transform] duration-[130ms]",
                        selected
                            ? "translate-x-0.5 text-foreground"
                            : "text-muted-foreground/60 group-hover:translate-x-0.5 group-hover:text-foreground",
                    )}
                    aria-hidden
                />
            )}
        </div>
    );
}

function SkillIconRail({ skills, max = 5 }: { skills: string[]; max?: number }) {
    useSkillCatalog();
    if (!skills.length) return null;
    const visible = skills.slice(0, max);
    const hidden = Math.max(0, skills.length - visible.length);
    return (
        <span className="flex shrink-0 items-center gap-1.5" aria-label={`Skills: ${skills.join(", ")}`}>
            {visible.map((name) => {
                const skill = resolveClientSkill(name);
                return <span key={name} title={name} className={hasSkillIcon(skill)
                    ? "inline-flex size-6 items-center justify-center rounded-[3px] text-muted-foreground"
                    : "max-w-20 truncate text-[11px] text-muted-foreground"}>
                    {hasSkillIcon(skill) ? <SkillIcon skill={skill} size={15} /> : name}
                </span>;
            })}
            {hidden ? <span className="font-mono text-[11px] font-medium text-muted-foreground/80">+{hidden}</span> : null}
        </span>
    );
}

function relativeDate(value: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: true });
}

export function WorkspaceSearchResultCard({ result, onOpen, onRemove, ...interaction }: ResultInteractionProps & { result: GlobalSearchWorkspacePreview; onOpen: (result: GlobalSearchPreview) => void; onRemove?: () => void }) {
    const connectedFriendLabels = result.connectedFriends.map((friend) => `${friend.name} · ${friend.role}`);
    const hasAvatar = Boolean(result.coverImage && result.coverImage.trim().length > 0);
    const leading = hasAvatar ? (
        <WorkspaceAvatar
            project={{
                coverImage: result.coverImage,
                title: result.title,
                updatedAt: result.updatedAt,
            }}
            size="card"
            className="size-10 rounded-[6px]"
        />
    ) : undefined;

    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            leading={leading}
            trailing={<span className="hidden self-center sm:block"><SkillIconRail skills={result.skills} /></span>}
            ariaLabel={`Open workspace ${result.title}`}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">{result.title}</span>
                {result.username ? <span className="truncate font-mono text-xs text-muted-foreground">@{result.username}</span> : null}
                {result.status ? (
                    <span className="nb-status shrink-0" data-status={result.status}>
                        {projectStageLabel(result.status)}
                    </span>
                ) : null}
            </div>

            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{result.subtitle}</p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                {connectedFriendLabels.length ? (
                    <span className="truncate font-medium text-foreground">
                        {connectedFriendLabels.slice(0, 2).join(" · ")}
                        {result.additionalConnectedFriendsCount > 0 ? ` (+${result.additionalConnectedFriendsCount} more connection${result.additionalConnectedFriendsCount === 1 ? "" : "s"})` : null}
                    </span>
                ) : null}

                {result.followersCount > 0 ? (
                    <span className="nb-meta inline-flex items-center gap-1">
                        <UsersRound className="size-3 text-muted-foreground/70" aria-hidden />
                        {result.followersCount.toLocaleString()} following
                    </span>
                ) : null}

                {result.viewCount > 0 ? (
                    <span className="nb-meta inline-flex items-center gap-1">
                        <Eye className="size-3 text-muted-foreground/70" aria-hidden />
                        {formatCount(result.viewCount)} {result.viewCount === 1 ? "view" : "views"}
                    </span>
                ) : null}

                {result.openRolesCount > 0 ? (
                    <span className="font-mono text-[11px] font-medium text-primary">
                        {result.openRolesCount} open {result.openRolesCount === 1 ? "role" : "roles"}
                    </span>
                ) : null}
            </div>

            <span className="mt-2 block sm:hidden"><SkillIconRail skills={result.skills} max={4} /></span>
        </ResultShell>
    );
}

export function ProfileSearchResultCard({ result, onOpen, onConnect, isConnecting, onRemove, ...interaction }: ResultInteractionProps & {
    result: GlobalSearchProfilePreview;
    onOpen: (result: GlobalSearchPreview) => void;
    onConnect: (result: GlobalSearchProfilePreview) => Promise<void>;
    isConnecting: boolean;
    onRemove?: () => void;
}) {
    const lastActive = relativeDate(result.lastActiveAt);
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            leading={result.isLockedProfile
                ? <span className="flex size-10 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted text-muted-foreground"><Lock className="size-4" aria-hidden /></span>
                : (
                    <div className="relative shrink-0">
                        <UserAvatar identity={{ username: result.username, fullName: result.title, avatarUrl: result.avatarUrl }} size={40} className="rounded-[5px]" roundedClassName="rounded-[5px]" />
                        <PersonPresenceDot userId={result.userId} lastActiveAt={result.lastActiveAt} compact />
                    </div>
                )}
            trailing={<span className="hidden self-center sm:block"><SkillIconRail skills={result.skills} /></span>}
            action={result.connectionStatus === "none" && result.canConnect ? (
                <button
                    type="button"
                    disabled={isConnecting}
                    onClick={(event) => {
                        event.stopPropagation();
                        void onConnect(result);
                    }}
                    className="nb-touch-target inline-flex h-[28px] shrink-0 items-center gap-1.5 self-center rounded-[5px] bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
                    aria-label={`Connect with ${result.title}`}
                >
                    {isConnecting ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : <UserPlus className="size-3" aria-hidden />}
                    Connect
                </button>
            ) : null}
            ariaLabel={`Open profile ${result.title}`}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">{result.title}</span>
                {result.username ? <span className="truncate font-mono text-xs text-muted-foreground">@{result.username}</span> : null}
                {result.connectionStatus === "connected" ? (
                    <span className="rounded-[3px] border border-border bg-secondary/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">Connected</span>
                ) : result.connectionStatus === "pending_sent" ? (
                    <span className="rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-400">Request sent</span>
                ) : result.connectionStatus === "pending_received" ? (
                    <span className="rounded-[3px] border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] text-blue-600 dark:text-blue-400">Received</span>
                ) : null}
            </div>

            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">
                {result.isLockedProfile ? "Limited profile information" : result.subtitle}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 nb-meta text-[11px]">
                {result.location ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <MapPin className="size-3 text-muted-foreground/70" aria-hidden />
                        {result.location}
                    </span>
                ) : null}
                {result.mutualConnections > 0 ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Users className="size-3 text-muted-foreground/70" aria-hidden />
                        {result.mutualConnections} mutual
                    </span>
                ) : null}
                {lastActive ? <span className="text-muted-foreground/80">Active {lastActive}</span> : null}
                {result.isLockedProfile ? null : <SharedOrgChip userId={result.userId} />}
            </div>

            <span className="mt-2 block sm:hidden"><SkillIconRail skills={result.skills} max={4} /></span>
        </ResultShell>
    );
}

export function TaskSearchResultCard({ result, onOpen, onRemove, ...interaction }: ResultInteractionProps & { result: GlobalSearchTaskPreview; onOpen: (result: GlobalSearchPreview) => void; onRemove?: () => void }) {
    const status = { ...getTaskStatusPresentation(result.status), ...(result.reviewStatus === "pending" ? { label: "In review" } : {}) };
    const titlePresentation = getTaskTitlePresentation(result);
    const priority = getTaskPriorityPresentation(result.priority);
    const dueDate = result.dueDate ? new Date(result.dueDate) : null;
    const validDueDate = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            ariaLabel={`Open task ${result.taskCode}: ${result.title}`}
        >
            <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground">{result.taskCode}</span>
                <span className={cn("truncate text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary", titlePresentation.className)} aria-label={titlePresentation.ariaLabel}>{result.title}</span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{result.subtitle}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                <span className={cn("rounded-[3px] border px-1.5 py-0.5 font-medium", status.badgeClassName)}>{status.label}</span>
                <span className={cn("rounded-[3px] border px-1.5 py-0.5 font-medium", priority.badgeClassName)}>{priority.label}</span>
                {result.sprintName ? <span className="rounded-[3px] border border-border bg-muted/60 px-1.5 py-0.5 text-muted-foreground">{result.sprintName}</span> : null}
                {result.storyPoints != null ? <span className="rounded-[3px] border border-border px-1.5 py-0.5 text-muted-foreground">{result.storyPoints} pts</span> : null}
                {validDueDate ? <span className="inline-flex items-center gap-1 text-muted-foreground"><CalendarDays className="size-3" aria-hidden />{format(validDueDate, "MMM d")}</span> : null}
            </div>
        </ResultShell>
    );
}

export function LinkSearchResultCard({ result, onOpen, onRemove, ...interaction }: ResultInteractionProps & { result: GlobalSearchLinkPreview; onOpen: (result: GlobalSearchPreview) => void; onRemove?: () => void }) {
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            leading={<span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/40 text-muted-foreground">{result.iconKey ? <SocialPresenceIcon iconKey={result.iconKey as SocialPresenceIconKey} className="size-4" /> : <Link2 className="size-4" aria-hidden />}</span>}
            ariaLabel={`Open workspace link ${result.title}: ${result.subtitle}`}
        >
            <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">{result.title}</span>
                {result.audience === "members" ? <span className="rounded-[3px] border border-border bg-secondary/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">Members</span> : null}
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{result.subtitle}</p>
            <span className="mt-1.5 block nb-meta text-[11px] capitalize text-muted-foreground/80">{result.purpose.replaceAll("-", " ")} · {result.platform}</span>
        </ResultShell>
    );
}

const SETTINGS_ICONS = {
    Account: User,
    Security: Shield,
    Privacy: Lock,
    Notifications: Bell,
    Appearance: Palette,
    Integrations: Plug,
} as const;

export function SettingsSearchResultCard({ result, onOpen, ...interaction }: ResultInteractionProps & { result: SettingsSearchItem; onOpen: (result: SettingsSearchItem) => void }) {
    const Icon = SETTINGS_ICONS[result.section as keyof typeof SETTINGS_ICONS] ?? Settings;
    return (
        <ResultShell
            {...interaction}
            id={`settings-${result.id}`}
            onOpen={() => onOpen(result)}
            leading={<span className="flex size-10 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/40 text-muted-foreground"><Icon className="size-4" aria-hidden /></span>}
            ariaLabel={`Open ${result.title} in ${result.section} settings`}
        >
            <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">{result.title}</span>
                <span className="truncate nb-meta text-[11px] text-muted-foreground">Settings / {result.section}</span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{result.description}</p>
        </ResultShell>
    );
}

const ORG_KIND_LABEL: Record<GlobalSearchOrgPreview["orgKind"], string> = { org: "Organization", assignment: "Assignment", doc: "Doc", child: "Workspace", sprint: "Sprint", member: "Member", file: "File", action: "Action" };

/** Organizations, assignments, docs and "Search <org>" results (report §30.1). */
export function OrgSearchResultCard({ result, onOpen, onRemove, ...interaction }: ResultInteractionProps & { result: GlobalSearchOrgPreview; onOpen: (result: GlobalSearchPreview) => void; onRemove?: () => void }) {
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            ariaLabel={`Open ${ORG_KIND_LABEL[result.orgKind].toLowerCase()} ${result.title}`}
        >
            <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground">{ORG_KIND_LABEL[result.orgKind]}</span>
                <span className="truncate text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">{result.title}</span>
                {result.chip ? <span className="shrink-0 rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{result.chip}</span> : null}
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{result.subtitle}</p>
        </ResultShell>
    );
}
