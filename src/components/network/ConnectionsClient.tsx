"use client";

import { forwardRef, useCallback, useEffect, useMemo, useState, type HTMLAttributes } from "react";
import Link from "next/link";
import { Ban, Check, ChevronDown, Loader2, MapPin, MessageSquare, UserMinus, Users } from "lucide-react";
import { VirtuosoGrid } from "react-virtuoso";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { SkillIcon } from "@/components/skills";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { PERSON_CARD_ITEM_HEIGHT, PERSON_CARD_TAGS, PersonCardLayout } from "@/components/network/PersonCard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConnectionMutations, useConnections, type NetworkConnectionItem } from "@/hooks/useConnections";
import { profileHref } from "@/lib/routing/identifiers";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { formatLastActive } from "@/lib/ui/date-formatting";
import { formatDistanceToNow } from "@/lib/utils/date";

const GridList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className="grid grid-cols-1 gap-[14px] pb-8 sm:grid-cols-2" />
));
GridList.displayName = "ConnectionsGrid";

const GridItem = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
    <div {...props} ref={ref} className={PERSON_CARD_ITEM_HEIGHT} />
));
GridItem.displayName = "ConnectionItem";

function PresenceDot({ lastActiveAt }: { lastActiveAt?: string | null }) {
    const activeLabel = formatLastActive(lastActiveAt);
    const tone = activeLabel === "Active today"
        ? "bg-[var(--status-success)]"
        : activeLabel === "Active this week"
            ? "bg-amber-500"
            : "bg-zinc-300 dark:bg-zinc-600";
    return <span className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card ${tone}`} title={activeLabel ?? "Offline"} />;
}

export default function ConnectionsClient({ searchQuery }: { searchQuery: string }) {
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [routeScrollParent, setRouteScrollParent] = useState<HTMLElement | null>(() =>
        typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"),
    );

    useEffect(() => {
        setRouteScrollParent(document.querySelector<HTMLElement>("[data-scroll-root=\"route\"]"));
    }, []);

    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useConnections(50, debouncedSearch || undefined, "recent");
    const { disconnect, blockProfile } = useConnectionMutations();
    const connections = useMemo(
        () => (data?.pages.flatMap((page) => page.items) ?? []).filter((item) => Boolean(item.otherUser)),
        [data],
    );

    const handleDisconnect = useCallback(async (connectionId: string) => {
        await toast.promise(disconnect.mutateAsync(connectionId), {
            loading: "Disconnecting...",
            success: "Connection removed",
            error: (error) => error instanceof Error ? error.message : "Failed to remove connection",
        });
    }, [disconnect]);

    const handleBlock = useCallback(async (userId: string) => {
        await toast.promise(blockProfile.mutateAsync(userId), {
            loading: "Blocking profile...",
            success: "Profile blocked",
            error: (error) => error instanceof Error ? error.message : "Failed to block profile",
        });
    }, [blockProfile]);

    if (isLoading && !data) {
        return (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2" aria-label="Loading connections">
                <span className="sr-only" role="status">Loading connections…</span>
                {[1, 2, 3, 4].map((item) => <Skeleton key={item} className={`${PERSON_CARD_ITEM_HEIGHT} rounded-lg border border-border`} />)}
            </div>
        );
    }

    if (connections.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title={debouncedSearch ? "No connections match your search." : "Your connections live here"}
                description={debouncedSearch ? "Try a different name, skill, or location." : "People you connect with will appear here."}
                action={!debouncedSearch ? <Link href="/network?tab=suggested" className="text-sm max-md:text-[13px] font-medium text-primary hover:underline">Find people to connect with</Link> : undefined}
            />
        );
    }

    return (
        <div style={{ minHeight: 400 }}>
            <VirtuosoGrid
                customScrollParent={routeScrollParent ?? undefined}
                increaseViewportBy={600}
                data={connections}
                computeItemKey={(_, connection) => connection.id}
                endReached={() => {
                    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
                }}
                components={{
                    List: GridList,
                    Item: GridItem,
                    Footer: () => isFetchingNextPage ? (
                        <div className="col-span-full flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading more connections" /></div>
                    ) : null,
                }}
                itemContent={(_, connection) => (
                    <ConnectionCard
                        connection={connection}
                        onDisconnect={handleDisconnect}
                        onBlock={handleBlock}
                    />
                )}
            />
        </div>
    );
}

function ConnectionCard({
    connection,
    onDisconnect,
    onBlock,
}: {
    connection: NetworkConnectionItem;
    onDisconnect: (id: string) => Promise<void>;
    onBlock: (id: string) => Promise<void>;
}) {
    useSkillCatalog();
    const user = connection.otherUser;
    if (!user) return null;
    const displayName = user.fullName || user.username || "NetworkBase member";
    const skills = (user.skills ?? []).slice(0, 2);

    return (
        <PersonCardLayout
            className="min-h-[158px]"
            avatar={
                <Link href={profileHref(user)} className="relative shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <UserAvatar identity={user} size={48} fallbackClassName="text-base font-semibold" />
                    <PresenceDot lastActiveAt={user.lastActiveAt} />
                </Link>
            }
            head={
                <Link href={profileHref(user)} className="block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <h3 className="nb-card-title truncate text-foreground" title={displayName}>{displayName}</h3>
                </Link>
            }
            meta={[
                user.location ? <p key="location" className="nb-meta mt-1 flex min-w-0 items-center gap-1" title={user.location}><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{user.location}</span></p> : null,
                <p key="connected" className="nb-meta mt-1 truncate">Connected {formatDistanceToNow(new Date(connection.updatedAt), { addSuffix: true })}</p>,
            ]}
            headline={<p className="nb-body truncate text-muted-foreground" title={user.headline || undefined}>{user.headline || "NetworkBase member"}</p>}
            body={skills.length ? <div className={PERSON_CARD_TAGS}>{skills.map((skillName) => {
                const skill = resolveClientSkill(skillName);
                return <span key={skill.canonicalKey} className="nb-tag"><SkillIcon skill={skill} size={14} />{skill.name}</span>;
            })}</div> : null}
            aside={
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" className="nb-touch-target inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm max-md:text-[13px] font-medium text-foreground hover:bg-muted" aria-label={`Connection actions for ${displayName}`}>
                            <Check className="size-4 text-[var(--status-success)]" aria-hidden="true" />
                            <span className="max-sm:sr-only">Connected</span>
                            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {user.canSendMessage ? (
                            <>
                                <DropdownMenuItem asChild>
                                    <Link href={`/messages?userId=${user.id}`}><MessageSquare className="size-4" />Message</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}
                        <DropdownMenuItem onClick={() => void onDisconnect(connection.id)} variant="destructive"><UserMinus className="size-4" />Disconnect</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => void onBlock(user.id)} variant="destructive"><Ban className="size-4" />Block profile</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
        />
    );
}
