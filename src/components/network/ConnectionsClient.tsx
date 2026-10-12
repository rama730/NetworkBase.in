"use client";

import { CONNECTION_COPY } from "@/lib/connections/copy";
import { useCallback, useMemo } from "react";
import Link from "next/link";
import { Ban, Check, ChevronDown, MapPin, MessageSquare, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import { EmptyState } from "@/components/ui/EmptyState";
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

export default function ConnectionsClient({ searchQuery }: { searchQuery: string }) {
    const [debouncedSearch] = useDebounce(searchQuery, 300);
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
        }).unwrap().catch(() => undefined);
    }, [disconnect]);

    const handleBlock = useCallback(async (userId: string) => {
        await toast.promise(blockProfile.mutateAsync(userId), {
            loading: CONNECTION_COPY.blocking,
            success: "Blocked",
            error: (error) => error instanceof Error ? error.message : CONNECTION_COPY.blockFailed,
        }).unwrap().catch(() => undefined);
    }, [blockProfile]);

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
                title={debouncedSearch ? "No connections match your search." : "Your connections live here"}
                description={debouncedSearch ? "Try a different name, skill, or location." : "People you connect with will appear here."}
                action={!debouncedSearch ? <Link href="/network?tab=suggested" className="text-sm max-md:text-[13px] font-medium text-primary hover:underline">Find people to connect with</Link> : undefined}
            />
        );
    }

    return (
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
                    onDisconnect={handleDisconnect}
                    onBlock={handleBlock}
                />
            )}
        />
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
    const headline = user.headline?.trim();

    return (
        <PersonCardLayout
            avatar={
                <Link href={profileHref(user)} className="relative shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
            headline={headline ? <p className="nb-body truncate text-muted-foreground" title={headline}>{headline}</p> : null}
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
                        <DropdownMenuItem onClick={() => void onDisconnect(connection.id)} variant="destructive"><UserMinus className="size-4" />Disconnect</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => void onBlock(user.id)} variant="destructive"><Ban className="size-4" />Block profile</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
        />
    );
}
