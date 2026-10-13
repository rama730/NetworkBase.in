"use client";

import { CONNECTION_COPY } from "@/lib/connections/copy";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Ban, Check, ChevronDown, MapPin, MessageSquare, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SkillIcon } from "@/components/skills";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { PERSON_CARD_TAGS, PersonCardGrid, PersonCardLayout } from "@/components/network/PersonCard";
import { PersonCardSkeleton } from "@/components/network/PersonCardSkeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConnectionMutations, useConnections, type NetworkConnectionItem } from "@/hooks/useConnections";
import { profileHref } from "@/lib/routing/identifiers";
import { resolveClientSkill, useSkillCatalog } from "@/lib/skills/client";
import { PersonPresenceDot } from "@/components/network/PersonPresenceDot";
import { formatDistanceToNow } from "@/lib/utils/date";
import { messageUserInWindow } from "@/components/messages/message-user";
import { cn } from "@/lib/utils";

export default function ConnectionsClient({ searchQuery }: { searchQuery: string }) {
    const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useConnections(50, searchQuery || undefined, sortBy);
    const { disconnect, blockProfile } = useConnectionMutations();
    const [pendingDisconnect, setPendingDisconnect] = useState<{ id: string; name: string } | null>(null);
    const [pendingBlock, setPendingBlock] = useState<{ userId: string; name: string } | null>(null);
    const connections = useMemo(
        () => (data?.pages.flatMap((page) => page.items) ?? []).filter((item) => Boolean(item.otherUser)),
        [data],
    );

    const handleDisconnect = useCallback(async () => {
        if (!pendingDisconnect) return;
        try {
            await toast.promise(disconnect.mutateAsync(pendingDisconnect.id), {
                loading: "Disconnecting...",
                success: "Connection removed",
                error: (error) => error instanceof Error ? error.message : "Failed to remove connection",
            }).unwrap();
        } catch {
            // Handled
        } finally {
            setPendingDisconnect(null);
        }
    }, [disconnect, pendingDisconnect]);

    const handleBlock = useCallback(async () => {
        if (!pendingBlock) return;
        try {
            await toast.promise(blockProfile.mutateAsync(pendingBlock.userId), {
                loading: CONNECTION_COPY.blocking,
                success: `Blocked ${pendingBlock.name}`,
                error: (error) => error instanceof Error ? error.message : CONNECTION_COPY.blockFailed,
            }).unwrap();
        } catch {
            // Handled
        } finally {
            setPendingBlock(null);
        }
    }, [blockProfile, pendingBlock]);

    if (isLoading && !data) {
        return (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2" aria-label="Loading connections">
                <span className="sr-only" role="status">Loading connections…</span>
                {[1, 2, 3, 4].map((item) => <PersonCardSkeleton key={item} />)}
            </div>
        );
    }

    if (connections.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title={searchQuery ? "No connections match your search." : "Your connections live here"}
                description={searchQuery ? "Try a different name, skill, or location." : "People you connect with will appear here."}
                action={!searchQuery ? <Link href="/network?tab=suggested" className="text-sm max-md:text-[13px] font-medium text-primary hover:underline">Find people to connect with</Link> : undefined}
            />
        );
    }

    return (
        <>
            <div className="mb-3 flex items-center justify-between">
                <span className="nb-micro text-muted-foreground">{connections.length} connections</span>
                <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">Sort:</span>
                    <button
                        type="button"
                        onClick={() => setSortBy("recent")}
                        className={cn(
                            "rounded px-2 py-1 transition-colors",
                            sortBy === "recent" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        Recent
                    </button>
                    <button
                        type="button"
                        onClick={() => setSortBy("name")}
                        className={cn(
                            "rounded px-2 py-1 transition-colors",
                            sortBy === "name" ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        Name
                    </button>
                </div>
            </div>
            <PersonCardGrid
                items={connections}
                getKey={(connection) => connection.id}
                hasNextPage={Boolean(hasNextPage)}
                isFetchingNextPage={isFetchingNextPage}
                fetchNextPage={fetchNextPage}
                loadingLabel="Loading more connections"
                renderItem={(connection) => (
                    <ConnectionCard
                        connection={connection}
                        onDisconnect={(id, name) => setPendingDisconnect({ id, name })}
                        onBlock={(userId, name) => setPendingBlock({ userId, name })}
                    />
                )}
            />

            <ConfirmDialog
                open={Boolean(pendingDisconnect)}
                onOpenChange={(open) => !open && setPendingDisconnect(null)}
                title={pendingDisconnect ? `Remove connection with ${pendingDisconnect.name}?` : "Remove connection?"}
                description="They will not be notified, but you will no longer see each other's connection updates."
                confirmLabel="Disconnect"
                variant="destructive"
                loading={disconnect.isPending}
                onConfirm={() => void handleDisconnect()}
            />

            <ConfirmDialog
                open={Boolean(pendingBlock)}
                onOpenChange={(open) => !open && setPendingBlock(null)}
                title={pendingBlock ? `Block ${pendingBlock.name}?` : "Block profile?"}
                description="They will not be able to view your profile, send you messages, or invite you to projects."
                confirmLabel="Block"
                variant="destructive"
                loading={blockProfile.isPending}
                onConfirm={() => void handleBlock()}
            />
        </>
    );
}

function ConnectionCard({
    connection,
    onDisconnect,
    onBlock,
}: {
    connection: NetworkConnectionItem;
    onDisconnect: (id: string, name: string) => void;
    onBlock: (userId: string, name: string) => void;
}) {
    useSkillCatalog();
    const user = connection.otherUser;
    if (!user) return null;
    const displayName = user.fullName || user.username || "NetworkBase member";
    const skills = (user.skills ?? []).slice(0, 2);
    const headline = user.headline?.trim();

    return (
        <PersonCardLayout
            avatar={
                <Link href={profileHref(user)} tabIndex={-1} aria-hidden="true" className="relative shrink-0 rounded-md focus-visible:outline-none">
                    <UserAvatar identity={user} size={48} fallbackClassName="text-base font-semibold" />
                    <PersonPresenceDot userId={user.id} lastActiveAt={user.lastActiveAt} />
                </Link>
            }
            head={
                <Link href={profileHref(user)} className="block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <h3 className="nb-person-name truncate text-foreground" title={displayName}>{displayName}</h3>
                </Link>
            }
            location={user.location ? <p className="nb-meta mt-1 flex min-w-0 items-center gap-1" title={user.location}><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{user.location}</span></p> : null}
            meta={[
                <p key="connected" className="nb-meta mt-1 truncate">Connected {formatDistanceToNow(new Date(connection.updatedAt), { addSuffix: true })}</p>,
            ]}
            headline={headline ? <p className="nb-compact truncate text-muted-foreground" title={headline}>{headline}</p> : null}
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
                                    <Link href={`/messages?userId=${user.id}`} onClick={(event) => messageUserInWindow(user.id, event)}><MessageSquare className="size-4" />Message</Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        ) : null}
                        <DropdownMenuItem onClick={() => onDisconnect(connection.id, displayName)} variant="destructive"><UserMinus className="size-4" />Disconnect</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onBlock(user.id, displayName)} variant="destructive"><Ban className="size-4" />Block profile</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
        />
    );
}
