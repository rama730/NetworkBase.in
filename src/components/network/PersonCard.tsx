"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Check, ChevronDown, Clock, Loader2, Lock, MapPin, MessageSquare } from "lucide-react";

import type { SuggestedProfile } from "@/app/actions/connections";
import { SkillIcon } from "@/components/skills";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { PersonPresenceDot, PersonPresenceText } from "@/components/network/PersonPresenceDot";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { profileHref } from "@/lib/routing/identifiers";
import { canonicalSkillKey, matchingSkillLabels } from "@/lib/skills/matching";
import { useConnectionMutations } from "@/hooks/useConnections";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { boundPersonCardItems } from "@/lib/network/person-card-bounds";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { messageUserInWindow } from "@/components/messages/message-user";
import { CONNECTION_COPY } from "@/lib/connections/copy";

/**
 * Shared Network person-card anatomy (profile-header style): avatar top-left, name and primary action beside it.
 * Placement rule: the one line under the name is the location, else the real headline; the headline drops
 * full width below the avatar only when a location took that line. Cards size to their content.
 */
export function PersonCardLayout({
    avatar,
    head,
    location,
    meta = [],
    headline,
    aside,
    body,
    className,
}: {
    avatar: ReactNode;
    head: ReactNode;
    /** Mono location line; when present it owns the slot under the name. */
    location?: ReactNode;
    /** Keyed mono lines after the slot ("shared connections", "Connected …", "Role · …"); falsy entries are skipped. */
    meta?: ReactNode[];
    /** Real headline only; never filler text. */
    headline?: ReactNode;
    /** Primary action beside the name; keeps the card compact. */
    aside?: ReactNode;
    body?: ReactNode;
    className?: string;
}) {
    const headlineBelow = location ? headline : null;
    return (
        <article className={cn("flex h-full min-w-0 flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-input", className)}>
            <div className="flex min-w-0 items-start gap-[14px]">
                {avatar}
                <div className="min-w-0 flex-1 pt-0.5">
                    {head}
                    {location ?? (headline ? <div className="mt-1 min-w-0">{headline}</div> : null)}
                    {meta.filter(Boolean)}
                </div>
                {aside ? <div className="flex shrink-0 items-center">{aside}</div> : null}
            </div>
            {headlineBelow || body ? (
                <div className="mt-3 min-w-0 space-y-2">
                    {headlineBelow}
                    {body}
                </div>
            ) : null}
        </article>
    );
}

export function PersonCardGrid<T>({
    items,
    getKey,
    renderItem,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    loadingLabel,
}: {
    items: T[];
    getKey: (item: T) => string;
    renderItem: (item: T, index: number) => ReactNode;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
    loadingLabel: string;
}) {
    const sentinelRef = useRef<HTMLDivElement>(null);
    const boundedItems = boundPersonCardItems(items);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasNextPage || isFetchingNextPage) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) void fetchNextPage();
        }, { rootMargin: "600px" });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    return (
        <div className="pb-8">
            {/* Rows stretch to their tallest card, so a sparse card beside a rich one stays aligned. */}
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                {boundedItems.map((item, index) => (
                    <div key={getKey(item)} className="[contain-intrinsic-size:auto_150px] [content-visibility:auto]">
                        {renderItem(item, index)}
                    </div>
                ))}
            </div>
            <div ref={sentinelRef} aria-hidden="true" />
            {isFetchingNextPage ? (
                <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={loadingLabel} /></div>
            ) : null}
        </div>
    );
}

/** One-row tag strip: tags that would wrap to a second row are hidden, keeping card heights even. */
export const PERSON_CARD_TAGS = "flex h-6 min-w-0 flex-wrap gap-1.5 overflow-hidden";

export interface PersonCardProps {
    profile: SuggestedProfile;
    onConnect: (userId: string) => Promise<void>;
    priority?: boolean;
    viewerSkills?: string[];
}

function PersonCard({
    profile,
    onConnect,
    priority = false,
    viewerSkills,
}: PersonCardProps) {
    useSkillCatalog();
    const { cancelRequest, blockProfile } = useConnectionMutations();
    const [localStatus, setLocalStatus] = useState<"none" | "pending_sent" | null>(null);
    const [connecting, setConnecting] = useState(false);
    const actionSlot = useRef<HTMLDivElement>(null);
    const [cancelling, setCancelling] = useState(false);
    const [blocking, setBlocking] = useState(false);
    const status = localStatus ?? profile.connectionStatus;
    const isLocked = Boolean(profile.isLockedProfile);
    const displayName = profile.fullName || profile.username || CONNECTION_COPY.nameFallback;
    const headline = profile.headline?.trim();
    const matchingSkills = matchingSkillLabels(profile.skills ?? [], viewerSkills ?? []);
    const matchingSkillKeys = new Set(matchingSkills.map(canonicalSkillKey));
    const skills = [...(profile.skills ?? [])]
        .sort((left, right) => Number(matchingSkillKeys.has(canonicalSkillKey(right))) - Number(matchingSkillKeys.has(canonicalSkillKey(left))))
        .slice(0, 2);

    useEffect(() => {
        setLocalStatus(null);
    }, [profile.connectionStatus]);

    // The action slot's control changes (Connect → Requested): keep keyboard focus in the slot.
    const keepFocusInSlot = () => requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        actionSlot.current?.querySelector<HTMLElement>("button, a")?.focus();
    });

    async function connect() {
        if (connecting || status !== "none" || profile.canConnect === false) return;
        setConnecting(true);
        setLocalStatus("pending_sent");
        keepFocusInSlot();
        try {
            await onConnect(profile.id);
        } catch {
            setLocalStatus(null);
            keepFocusInSlot();
        } finally {
            setConnecting(false);
        }
    }

    async function handleCancel() {
        if (cancelling) return;
        setCancelling(true);
        setLocalStatus("none");
        try {
            const idToCancel = profile.connectionId || profile.id;
            await toast.promise(cancelRequest.mutateAsync(idToCancel), {
                loading: "Cancelling request...",
                success: "Connection request cancelled",
                error: (err) => err instanceof Error ? err.message : "Failed to cancel request",
            }).unwrap();
        } catch {
            setLocalStatus("pending_sent");
        } finally {
            setCancelling(false);
        }
    }

    async function handleBlock() {
        if (blocking) return;
        setBlocking(true);
        try {
            await toast.promise(blockProfile.mutateAsync(profile.id), {
                loading: CONNECTION_COPY.blocking,
                success: CONNECTION_COPY.blocked_toast(displayName),
                error: (err) => err instanceof Error ? err.message : CONNECTION_COPY.blockFailed,
            }).unwrap();
        } catch {
            // The toast already says what went wrong.
        } finally {
            setBlocking(false);
        }
    }

    const action = status === "none" ? (
        profile.canConnect === false ? (
            <span className="nb-meta">{CONNECTION_COPY.notAccepting}</span>
        ) : (
            <button
                type="button"
                onClick={() => void connect()}
                aria-disabled={connecting || undefined}
                className="nb-person-connect"
                aria-label={`${CONNECTION_COPY.connect} with ${displayName}`}
            >
                {CONNECTION_COPY.connect}
            </button>
        )
    ) : status === "pending_sent" ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={cancelling}
                    className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-45 transition-colors"
                    aria-label={`${CONNECTION_COPY.requested}: options for ${displayName}`}
                >
                    {cancelling ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : (
                        <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="max-sm:sr-only">{CONNECTION_COPY.requested}</span>
                    <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                {profile.canSendMessage !== false ? (
                    <DropdownMenuItem asChild>
                        <Link
                            href={`/messages?userId=${profile.id}`}
                            onClick={(event) => messageUserInWindow(profile.id, event)}
                            className="flex items-center gap-2 cursor-pointer w-full"
                        >
                            <MessageSquare className="size-4" />
                            Message
                        </Link>
                    </DropdownMenuItem>
                ) : null}
                {profile.canSendMessage !== false ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                    onClick={() => void handleCancel()}
                    disabled={cancelling}
                    className="flex items-center gap-2 cursor-pointer"
                >
                    <Clock className="size-4" />
                    Cancel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => void handleBlock()}
                    disabled={blocking}
                    variant="destructive"
                    className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                >
                    <Ban className="size-4" />
                    Block
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : status === "pending_received" ? (
        <Link href="/network?tab=invitations" className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-primary hover:bg-muted">
            <Clock className="size-4" aria-hidden="true" /> {CONNECTION_COPY.review}
        </Link>
    ) : status === "connected" ? (
        <span className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-2 px-2 text-sm font-medium text-[var(--status-success)]">
            <Check className="size-4" aria-hidden="true" /> <span className="max-sm:sr-only">{CONNECTION_COPY.connected}</span>
        </span>
    ) : status === "blocked" ? (
        <span className="nb-meta">{CONNECTION_COPY.blocked}</span>
    ) : null;

    return (
        <PersonCardLayout
            avatar={
                // The name is the link people tab to; the avatar is the same link for the mouse.
                <Link href={profileHref(profile)} tabIndex={-1} aria-hidden="true" className="relative inline-flex shrink-0 rounded-md">
                    <UserAvatar identity={profile} size={48} priority={priority} fallbackClassName="text-base font-semibold" />
                    <PersonPresenceDot userId={profile.id} lastActiveAt={profile.lastActiveAt} />
                </Link>
            }
            head={
                <Link href={profileHref(profile)} className="block min-w-0 rounded-sm">
                    <h3 className="nb-person-name min-w-0 truncate text-foreground" title={displayName}>{displayName}<PersonPresenceText userId={profile.id} lastActiveAt={profile.lastActiveAt} /></h3>
                </Link>
            }
            location={!isLocked && profile.location ? (
                <p className="nb-meta mt-1 flex min-w-0 items-center gap-1" title={profile.location}>
                    <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{profile.location}</span>
                </p>
            ) : null}
            meta={isLocked ? [] : [
                (profile.mutualConnections ?? 0) > 0 ? (
                    <p key="shared" className="nb-meta mt-1 truncate">{CONNECTION_COPY.shared(profile.mutualConnections ?? 0)}</p>
                ) : null,
            ]}
            headline={isLocked ? (
                <p className="nb-compact flex items-center gap-1 text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />Private profile</p>
            ) : headline ? (
                <p className="nb-compact line-clamp-2 text-muted-foreground" title={headline}>{headline}</p>
            ) : null}
            aside={<div ref={actionSlot} className="contents">{action}</div>}
            body={!isLocked && skills.length ? (
                <div className={PERSON_CARD_TAGS} role="group" aria-label="Skills">
                    {skills.map((skillName) => {
                        const skill = resolveClientSkill(skillName);
                        return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>;
                    })}
                </div>
            ) : null}
        />
    );
}

export default memo(PersonCard);
