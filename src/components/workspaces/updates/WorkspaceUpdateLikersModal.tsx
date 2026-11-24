'use client';
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useMemo } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Heart} from 'lucide-react';
import { LikeHeart } from '@/components/ui/LikeHeart';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query-keys';
import { readProjectUpdateLikersAction, type ProjectUpdateLikerView } from '@/app/actions/workspace/updates';
import { cn } from '@/lib/utils';

export interface WorkspaceUpdateLikersModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    updateId: string;
    likeCount?: number;
    /** A comment's likes rather than the post's. */
    commentId?: string | null;
}

export function WorkspaceUpdateLikersModal({
    open,
    onOpenChange,
    projectId,
    updateId,
    likeCount,
    commentId = null,
}: WorkspaceUpdateLikersModalProps) {
    // Stable across redraws, so the live-update channel below isn't torn down and rejoined each time.
    const queryKey = useMemo(() => commentId
        ? [...queryKeys.project.detail.updateLikes(projectId, updateId), commentId]
        : queryKeys.project.detail.updateLikes(projectId, updateId), [commentId, projectId, updateId]);

    const {
        data,
        isLoading,
        isError,
        hasNextPage,
        isFetchingNextPage,
        fetchNextPage,
        refetch,
    } = useInfiniteQuery({
        queryKey,
        queryFn: async ({ pageParam }) => {
            const res = await readProjectUpdateLikersAction(projectId, updateId, {
                cursor: pageParam,
                limit: 20,
                commentId,
            });
            if (!res.success) throw new Error(res.error || 'Failed to load likers');
            return res;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        enabled: open && Boolean(updateId && projectId),
        staleTime: 30_000,
    });

    const likers: ProjectUpdateLikerView[] = useMemo(() => {
        const seen = new Set<string>();
        const list: ProjectUpdateLikerView[] = [];
        for (const page of data?.pages ?? []) {
            for (const item of page.likers) {
                if (!seen.has(item.key)) {
                    seen.add(item.key);
                    list.push(item);
                }
            }
        }
        return list;
    }, [data]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent size="confirm" className="gap-0 p-0 overflow-hidden sm:rounded-[12px]">
                <DialogHeader className="border-b border-border px-5 py-4 text-left">
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                        <LikeHeart liked size={16} className="h-4 w-4 text-[var(--like)]" />
                        <span>Liked by</span>
                        {typeof likeCount === 'number' && likeCount > 0 ? (
                            <span className="font-mono text-xs text-muted-foreground font-normal">
                                ({likeCount})
                            </span>
                        ) : null}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        People who liked this
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[380px] min-h-[160px] overflow-y-auto px-5 py-2 divide-y divide-border/40">
                    {isLoading ? (
                        <div className="space-y-3 py-3" aria-busy="true" aria-label="Loading likers">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <div className="size-[38px] rounded-[6px] nb-skeleton shrink-0" />
                                    <div className="flex-1 space-y-1.5">
                                        <div className="h-3.5 w-24 rounded nb-skeleton" />
                                        <div className="h-2.5 w-36 rounded nb-skeleton" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : isError ? (
                        <div className="flex h-36 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                            <p className="text-xs">Couldn&apos;t load likers.</p>
                            <Button variant="outline" size="sm" onClick={() => void refetch()} className="h-8 text-xs">
                                Try again
                            </Button>
                        </div>
                    ) : likers.length === 0 ? (
                        <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
                            No likes yet. Like this update to be the first.
                        </div>
                    ) : (
                        likers.map((liker) => {
                            const name = liker.fullName || liker.username || 'Member';
                            const profileHref = liker.username ? `/u/${liker.username}` : null;

                            return (
                                <div key={liker.key} className="flex items-center justify-between py-3 gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        {profileHref ? (
                                            <Link
                                                href={profileHref}
                                                onClick={() => onOpenChange(false)}
                                                className="shrink-0 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[6px]"
                                            >
                                                <UserAvatar
                                                    identity={{
                                                        fullName: name,
                                                        username: liker.username,
                                                        avatarUrl: liker.avatarUrl,
                                                    }}
                                                    size={38}
                                                    className="rounded-[6px]"
                                                />
                                            </Link>
                                        ) : (
                                            <UserAvatar
                                                identity={{
                                                    fullName: name,
                                                    username: null,
                                                    avatarUrl: liker.avatarUrl,
                                                }}
                                                size={38}
                                                className="shrink-0 rounded-[6px]"
                                            />
                                        )}

                                        <div className="min-w-0 flex-1 text-left">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {profileHref ? (
                                                    <Link
                                                        href={profileHref}
                                                        onClick={() => onOpenChange(false)}
                                                        className="truncate text-sm font-medium text-foreground hover:underline focus-visible:underline"
                                                    >
                                                        {name}
                                                    </Link>
                                                ) : (
                                                    <span className="truncate text-sm font-medium text-foreground">
                                                        {name}
                                                    </span>
                                                )}
                                                {liker.isViewer ? (
                                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                                                        You
                                                    </span>
                                                ) : null}
                                            </div>

                                            {liker.headline ? (
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {liker.headline}
                                                </p>
                                            ) : liker.username ? (
                                                <p className="truncate text-xs font-mono text-muted-foreground">
                                                    @{liker.username}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>

                                    {profileHref ? (
                                        <Link
                                            href={profileHref}
                                            onClick={() => onOpenChange(false)}
                                            className="shrink-0 rounded-[5px] border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                        >
                                            View
                                        </Link>
                                    ) : null}
                                </div>
                            );
                        })
                    )}

                    {hasNextPage ? (
                        <div className="py-2 text-center">
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={isFetchingNextPage}
                                onClick={() => void fetchNextPage()}
                                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                            >
                                {isFetchingNextPage ? (
                                    <>
                                        <PixelBeat className="mr-1.5" />
                                        Loading more…
                                    </>
                                ) : (
                                    'Load more'
                                )}
                            </Button>
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
