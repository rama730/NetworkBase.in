"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, ChevronDown, Clock, Loader2, Lock, MapPin, MessageSquare } from "lucide-react";

import type { SuggestedProfile } from "@/app/actions/connections";
import { SkillIcon } from "@/components/skills";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { PersonPresenceDot } from "@/components/network/PersonPresenceDot";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { profileHref } from "@/lib/routing/identifiers";
import { canonicalSkillKey, matchingSkillLabels } from "@/lib/skills/matching";
import { useConnectionMutations } from "@/hooks/useConnections";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    const [cancelling, setCancelling] = useState(false);
    const [blocking, setBlocking] = useState(false);
    const status = localStatus ?? profile.connectionStatus;
    const isLocked = Boolean(profile.isLockedProfile);
    const displayName = profile.fullName || profile.username || "User";
    const matchingSkills = matchingSkillLabels(profile.skills ?? [], viewerSkills ?? []);
    const matchingSkillKeys = new Set(matchingSkills.map(canonicalSkillKey));
    const skills = [...(profile.skills ?? [])]
        .sort((left, right) => Number(matchingSkillKeys.has(canonicalSkillKey(right))) - Number(matchingSkillKeys.has(canonicalSkillKey(left))))
        .slice(0, 2);

    useEffect(() => {
        setLocalStatus(null);
    }, [profile.connectionStatus]);

    async function connect() {
        if (connecting || status !== "none" || profile.canConnect === false) return;
        setConnecting(true);
        setLocalStatus("pending_sent");
        try {
            await onConnect(profile.id);
        } catch {
            setLocalStatus(null);
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
            });
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
                loading: "Blocking account...",
                success: `Blocked ${displayName}`,
                error: (err) => err instanceof Error ? err.message : "Failed to block account",
            });
        } finally {
            setBlocking(false);
        }
    }

    const action = status === "none" ? (
        <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting || profile.canConnect === false}
            className="nb-person-connect"
            aria-label={`Connect with ${displayName}`}
        >
            {connecting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Connect
        </button>
    ) : status === "pending_sent" ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={cancelling}
                    className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm max-md:text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 transition-colors"
                    aria-label={`Options for connection request to ${displayName}`}
                >
                    {cancelling ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : (
                        <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span>Requested</span>
                    <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                {profile.canSendMessage !== false ? (
                    <DropdownMenuItem asChild>
                        <Link
                            href={`/messages?userId=${profile.id}`}
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
        <Link href="/network?tab=invitations" className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm max-md:text-[13px] font-medium text-primary hover:bg-muted">
            <Clock className="size-4" aria-hidden="true" /> Review
        </Link>
    ) : status === "connected" ? (
        <span className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-2 px-2 text-sm max-md:text-[13px] font-medium text-[var(--status-success)]">
            <Check className="size-4" aria-hidden="true" /> Connected
        </span>
    ) : null;

    return (
        <article className="flex h-full min-w-0 min-h-[158px] items-center gap-3.5 rounded-lg border border-border bg-card p-4 transition-colors hover:border-input">
            <Link href={profileHref(profile)} className="relative inline-flex shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <UserAvatar identity={profile} size={54} priority={priority} fallbackClassName="text-lg font-semibold" />
                <PersonPresenceDot lastActiveAt={profile.lastActiveAt} />
            </Link>

            <Link href={profileHref(profile)} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <h3 className="nb-card-title block min-w-0 truncate text-foreground" title={displayName}>{displayName}</h3>

                {isLocked ? (
                    <p className="nb-compact mt-1 flex items-center gap-1 text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />Private profile</p>
                ) : profile.headline ? (
                    <p className="nb-compact mt-1 truncate text-muted-foreground">{profile.headline}</p>
                ) : (
                    <p className="nb-compact mt-1 text-muted-foreground">NetworkBase member</p>
                )}

                {!isLocked && profile.location ? (
                    <p className="nb-meta mt-1 flex min-w-0 items-center gap-1" title={profile.location}>
                        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate">{profile.location}</span>
                    </p>
                ) : null}

                {!isLocked && skills.length ? (
                    <div className="mt-2 flex min-w-0 flex-wrap gap-1.5" aria-label="Skills">
                        {skills.map((skillName) => {
                            const skill = resolveClientSkill(skillName);
                            return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>;
                        })}
                    </div>
                ) : null}

                {!isLocked && (profile.mutualConnections ?? 0) > 0 ? (
                    <p className="nb-meta mt-2">{profile.mutualConnections} shared connections</p>
                ) : null}
            </Link>

            {action}
        </article>
    );
}

export default memo(PersonCard);
