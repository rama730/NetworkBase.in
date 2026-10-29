'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, Users } from 'lucide-react';
import { getAcceptedConnections } from '@/app/actions/connections';
import Image from 'next/image';
import Link from 'next/link';
import { profileHref } from '@/lib/routing/identifiers';
import { logger } from '@/lib/logger';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

interface UserConnectionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    userName: string;
}

interface ConnectionUser {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
}

interface ConnectionRow {
    id: string;
    otherUser: ConnectionUser | null;
}

export function UserConnectionsModal({ isOpen, onClose, userId, userName }: UserConnectionsModalProps) {
    const [connections, setConnections] = useState<ConnectionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalConnections, setTotalConnections] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const requestTokenRef = useRef(0);
    const cursorRef = useRef<string | null>(null);
    const ownerDisplayName = userName.trim() ? userName : 'User';

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDebouncedSearch(searchQuery.trim());
        }, 250);
        return () => clearTimeout(timeout);
    }, [searchQuery]);

    const loadConnections = useCallback(async (opts?: { append?: boolean; search?: string }) => {
        const append = Boolean(opts?.append);
        const search = (opts?.search ?? debouncedSearch).trim();
        const requestToken = ++requestTokenRef.current;
        setLoadError(null);

        if (append) setLoadingMore(true);
        else setLoading(true);

        try {
            const response = await getAcceptedConnections({
                limit: 30,
                cursor: append ? cursorRef.current || undefined : undefined,
                search: search || undefined,
                targetUserId: userId,
            });

            if (requestToken !== requestTokenRef.current) return;

            if (!response.success) throw new Error(response.error || 'Could not load connections');
            setTotalConnections(response.totalConnections);
            const nextRows = (response.connections || []) as ConnectionRow[];
            setHasMore(Boolean(response.hasMore));
            cursorRef.current = response.nextCursor || null;

            if (append) {
                setConnections((prev) => {
                    const seen = new Set(prev.map((row) => row.id));
                    const merged = [...prev];
                    for (const row of nextRows) {
                        if (seen.has(row.id)) continue;
                        seen.add(row.id);
                        merged.push(row);
                    }
                    return merged;
                });
                return;
            }

            setConnections(nextRows);
        } catch (error) {
            if (requestToken !== requestTokenRef.current) return;
            setLoadError(error instanceof Error ? error.message : 'Could not load connections');
            logger.error('[profile.connections-modal] failed to load connections', {
                module: 'profile',
                userId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            if (!append) {
                setConnections([]);
                setHasMore(false);
                cursorRef.current = null;
            }
        } finally {
            if (requestToken === requestTokenRef.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [debouncedSearch, userId]);

    useEffect(() => {
        if (!isOpen || !userId) return;
        void loadConnections({ append: false, search: debouncedSearch });
    }, [debouncedSearch, isOpen, loadConnections, userId]);

    useEffect(() => {
        if (!isOpen) {
            requestTokenRef.current += 1;
            setSearchQuery('');
            setDebouncedSearch('');
            setConnections([]);
            cursorRef.current = null;
            setHasMore(false);
            setLoading(true);
            setLoadingMore(false);
            setTotalConnections(null);
            setLoadError(null);
        }
    }, [isOpen]);

    const loadMore = useCallback(async () => {
        if (!hasMore || loadingMore || loading) return;
        await loadConnections({ append: true, search: debouncedSearch });
    }, [debouncedSearch, hasMore, loadConnections, loading, loadingMore]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-md p-0 overflow-hidden gap-0 border border-border bg-card">
                <DialogHeader className="border-b border-border px-4 py-4">
                    <DialogTitle>{`${ownerDisplayName}'s Connections${totalConnections === null ? '' : ` (${totalConnections})`}`}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Browse accepted connections and open a public profile for each person.
                    </DialogDescription>
                </DialogHeader>

                <div className="p-4 border-b border-border">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            aria-label="Search connections"
                            placeholder="Search connections…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="nb-body w-full rounded-[3px] border border-border bg-background py-2 pl-9 pr-4 text-foreground outline-none focus:border-primary/50"
                        />
                    </div>
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2">
                    {loading ? (
                        <div className="space-y-2 p-2">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-center gap-3 p-2">
                                    <Skeleton className="size-[34px] rounded-[3px] shrink-0" />
                                    <div className="flex-1 space-y-1.5 min-w-0">
                                        <Skeleton className="h-4 w-32 rounded-[3px]" />
                                        <Skeleton className="h-3 w-48 rounded-[3px]" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : loadError ? (
                        <div className="p-4 space-y-3">
                            <p role="alert" className="nb-body text-destructive">{loadError}</p>
                            <button type="button" onClick={() => void loadConnections({ search: debouncedSearch })}
                                className="nb-ui-label text-primary hover:underline">Try again</button>
                        </div>
                    ) : connections.length === 0 ? (
                        <div className="p-2">
                            <div className="nb-empty-state nb-grid-ground py-8 text-center" role="status">
                                <div className="nb-empty-state-icon-box">
                                    <Users className="nb-empty-state-icon" />
                                </div>
                                <h4 className="nb-empty-state-title">
                                    {searchQuery ? 'No matching connections' : 'No connections yet'}
                                </h4>
                                <p className="nb-empty-state-desc">
                                    {searchQuery ? 'Try searching for a different name or username.' : 'Connected people will appear here.'}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <p role="status" className="nb-compact px-2 pb-2 text-muted-foreground">
                                {debouncedSearch ? `${connections.length} matching connections shown` : `${connections.length} of ${totalConnections} connections shown`}
                            </p>
                            {connections.map((conn) => {
                                const user = conn.otherUser;
                                if (!user) return null;
                                const displayName = user.fullName || user.username || 'User';

                                return (
                                    <div
                                        key={conn.id}
                                        className="flex items-center justify-between gap-3 p-2 hover:bg-muted rounded-[3px] transition-colors group"
                                    >
                                        <Link
                                            href={profileHref(user)}
                                            onClick={onClose}
                                            className="flex items-center gap-3 min-w-0 flex-1"
                                        >
                                            {user.avatarUrl ? (
                                                <Image
                                                    src={user.avatarUrl}
                                                    alt={displayName}
                                                    width={34}
                                                    height={34}
                                                    className="rounded-[3px] object-cover w-[34px] h-[34px] border border-border shrink-0"
                                                />
                                            ) : (
                                                <div className="w-[34px] h-[34px] rounded-[3px] bg-secondary border border-border flex items-center justify-center text-foreground text-xs font-semibold shrink-0">
                                                    {displayName[0]?.toUpperCase()}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-foreground truncate">
                                                    {displayName}
                                                </div>
                                                {user.headline && (
                                                    <div className="nb-compact truncate text-muted-foreground">{user.headline}</div>
                                                )}
                                            </div>
                                        </Link>
                                        <Link
                                            href={profileHref(user)}
                                            onClick={onClose}
                                            className="nb-ui-label shrink-0 rounded-[3px] border border-border bg-card px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                        >
                                            View
                                        </Link>
                                    </div>
                                );
                            })}
                            {hasMore && (
                                <div className="p-2">
                                    <button
                                        type="button"
                                        onClick={loadMore}
                                        disabled={loadingMore}
                                        className="nb-ui-label w-full rounded-[3px] border border-border bg-card px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                                    >
                                        {loadingMore ? 'Loading...' : 'Load more'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
