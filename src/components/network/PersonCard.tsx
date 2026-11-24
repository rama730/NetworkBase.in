"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Check, ChevronDown, Clock, MessageSquare } from "@/components/ui/icons";

import type { SuggestedProfile } from "@/app/actions/connections";
import { PersonCardContent } from "./PersonCardContent";
import { profileHref } from "@/lib/routing/identifiers";
import { useConnectionMutations } from "@/hooks/useConnections";
import { toast } from "@/lib/feedback";
import { boundPersonCardItems } from "@/lib/network/person-card-bounds";
import { personCardName } from "@/lib/network/person-card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BlockPersonDialog } from "@/components/privacy/BlockDialog";
import { ReportMenuItem, useReportDialog } from "@/components/reports/ReportDialog";
import { messageUserInWindow } from "@/components/messages/message-user";
import { CONNECTION_COPY } from "@/lib/connections/copy";
import { suggestionReason } from "@/lib/network/mix";

export { PersonCardLayout } from './PersonCardContent';

export function PersonCardGrid<T>({
    items,
    getKey,
    renderItem,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError = false,
    fetchNextPage,
    loadingLabel,
}: {
    items: T[];
    getKey: (item: T) => string;
    renderItem: (item: T, index: number) => ReactNode;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isFetchNextPageError?: boolean;
    fetchNextPage: () => unknown;
    loadingLabel: string;
}) {
    const sentinelRef = useRef<HTMLDivElement>(null);
    const boundedItems = boundPersonCardItems(items);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) void fetchNextPage();
        }, { rootMargin: "600px" });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

    return (
        <div className="pb-8">
            {/* The approved 176px cards disclose long details without growing the grid. */}
            <div className="nb-person-card-grid grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                {boundedItems.map((item, index) => (
                    <div key={getKey(item)} className="[contain-intrinsic-size:auto_var(--network-person-card-min-height,176px)] [content-visibility:auto]">
                        {renderItem(item, index)}
                    </div>
                ))}
            </div>
            <div ref={sentinelRef} aria-hidden="true" />
            {isFetchNextPageError ? <div className="nb-compact mt-4" role="alert">
                More people could not be loaded. <button className="text-primary hover:underline" onClick={() => void fetchNextPage()}>Retry loading more</button>
            </div> : null}
            {isFetchingNextPage ? (
                <div className="flex justify-center py-6"><PixelBeat className="text-muted-foreground" label={loadingLabel} /></div>
            ) : null}
        </div>
    );
}

/** One-row tag strip: tags that would wrap to a second row are hidden, keeping card heights even. */
export const PERSON_CARD_TAGS = "flex h-6 min-w-0 flex-wrap gap-1.5 overflow-hidden";

export interface PersonCardProps {
    profile: SuggestedProfile;
    onConnect: (userId: string) => Promise<unknown>;
    priority?: boolean;
    viewerSkills?: string[];
    className?: string;
    variant?: "network" | "rail";
}

function PersonCard({
    profile,
    onConnect,
    priority = false,
    viewerSkills,
    className,
    variant,
}: PersonCardProps) {
    const { cancelRequest } = useConnectionMutations();
    const [localStatus, setLocalStatus] = useState<SuggestedProfile['connectionStatus'] | null>(null);
    const [connecting, setConnecting] = useState(false);
    const actionSlot = useRef<HTMLDivElement>(null);
    const [cancelling, setCancelling] = useState(false);
    // Block from the card (Blocking B5): the shared confirmation, mounted only once asked.
    const [blockAsk, setBlockAsk] = useState(0);
    // Network mix: after Connect the footer says "Request sent · Undo" for six seconds.
    const [justSent, setJustSent] = useState(false);
    useEffect(() => {
        if (!justSent) return;
        const timer = setTimeout(() => setJustSent(false), 6000);
        return () => clearTimeout(timer);
    }, [justSent]);
    const status = localStatus ?? profile.connectionStatus;
    const displayName = personCardName(profile);
    // Report a person from their card (C15): the last item of the card's menu.
    const reporting = useReportDialog({ kind: "person", targetId: profile.id, noun: "person", personName: displayName });
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
        keepFocusInSlot();
        try {
            const result = await onConnect(profile.id);
            const confirmed = result && typeof result === 'object' && 'status' in result ? result.status : null;
            const next = confirmed === 'connected' || confirmed === 'pending_received' || confirmed === 'pending_sent' ? confirmed : 'pending_sent';
            setLocalStatus(next);
            if (next === 'pending_sent' && variant !== 'rail') setJustSent(true);
        } catch {
            setLocalStatus(null);
            keepFocusInSlot();
        } finally {
            setConnecting(false);
        }
    }

    async function handleCancel() {
        if (connecting || cancelling) return;
        setJustSent(false);
        setCancelling(true);
        setLocalStatus("none");
        try {
            const idToCancel = profile.connectionId || profile.id;
            await toast.promise(cancelRequest.mutateAsync(idToCancel), {
                loading: "Canceling request…",
                success: "Request canceled",
                error: (err) => err instanceof Error ? err.message : "Couldn’t cancel request",
            }).unwrap();
        } catch {
            setLocalStatus("pending_sent");
        } finally {
            setCancelling(false);
        }
    }

    const action = status === "none" ? (
        profile.canConnect === false ? (
            <Link href={profileHref(profile)} className="nb-person-control" title={CONNECTION_COPY.notAccepting}>View profile</Link>
        ) : (
            <button
                type="button"
                onClick={() => void connect()}
                disabled={connecting} aria-busy={connecting || undefined}
                className="nb-person-connect"
                aria-label={`${CONNECTION_COPY.connect} with ${displayName}`}
            >
                {connecting ? <PixelBeat /> : null}{connecting ? "Sending" : CONNECTION_COPY.connect}
            </button>
        )
    ) : status === "pending_sent" ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={connecting || cancelling}
                    className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-45 transition-colors"
                    aria-label={`${CONNECTION_COPY.requested}: options for ${displayName}`}
                >
                    {cancelling ? (
                        <PixelBeat className="text-muted-foreground" />
                    ) : (
                        <Clock className="size-3 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="max-sm:sr-only">{CONNECTION_COPY.requested}</span>
                    <ChevronDown className="size-3 opacity-70" aria-hidden="true" />
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
                            <MessageSquare className="size-3" />
                            Message
                        </Link>
                    </DropdownMenuItem>
                ) : null}
                {profile.canSendMessage !== false ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                    onClick={() => void handleCancel()}
                    disabled={connecting || cancelling}
                    className="flex items-center gap-2 cursor-pointer"
                >
                    <Clock className="size-3" />
                    Cancel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => setBlockAsk((n) => n + 1)}
                    variant="destructive"
                    className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                >
                    <Ban className="size-4" />
                    Block
                </DropdownMenuItem>
                <ReportMenuItem noun="person" target={reporting.target} onReport={reporting.open} />
            </DropdownMenuContent>
        </DropdownMenu>
    ) : status === "pending_received" ? (
        <Link href="/network?tab=invitations" className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-primary hover:bg-muted">
            <Clock className="size-3" aria-hidden="true" /> {CONNECTION_COPY.review}
        </Link>
    ) : status === "connected" ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                    aria-label={`Connected: options for ${displayName}`}
                >
                    <Check className="size-3 text-[var(--status-success)]" aria-hidden="true" />
                    <span className="max-sm:sr-only">{CONNECTION_COPY.connected}</span>
                    <ChevronDown className="size-3 opacity-70" aria-hidden="true" />
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
                <DropdownMenuItem asChild>
                    <Link href={profileHref(profile)} className="flex items-center gap-2 cursor-pointer w-full">
                        View profile
                    </Link>
                </DropdownMenuItem>
                <ReportMenuItem noun="person" target={reporting.target} onReport={reporting.open} />
            </DropdownMenuContent>
        </DropdownMenu>
    ) : status === "blocked" ? (
        <span className="nb-meta">{CONNECTION_COPY.blocked}</span>
    ) : null;

    return <>{reporting.dialog}{blockAsk ? <BlockPersonDialog key={blockAsk} person={{ id: profile.id, name: displayName }} source="person_card" /> : null}<PersonCardContent person={profile} variant={variant} action={<div ref={actionSlot} className="contents">{action}</div>} viewerSkills={viewerSkills} priority={priority} className={className} connected={status === "connected"}
        reason={variant !== "rail" && !justSent ? suggestionReason(profile.recommendationReason) : null}
        footer={justSent && status === "pending_sent" ? <span className="nb-person-answer" role="status"><span className="nb-state-tag">Request sent</span><button type="button" onClick={() => void handleCancel()} aria-label={`Undo request to ${displayName}`}>Undo</button></span> : undefined} /></>;
}

export default memo(PersonCard);
