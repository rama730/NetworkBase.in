"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { ImageOff, MoreHorizontal, Heart, MessageCircle, Pin } from "lucide-react";
import { toast } from "@/lib/feedback";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectUpdateContent } from "@/components/projects/updates/UpdateContent";
import { ProjectUpdateMediaViewer } from "@/components/projects/updates/ProjectUpdateMediaFrame";
import { UpdateTime, isUpdateCardControl } from "@/components/projects/updates/update-helpers";
import { useToggleUpdateLike } from "@/hooks/useToggleUpdateLike";
import { cn } from "@/lib/utils";
import type { DiscoverUpdateMedia, DiscoverUpdateView } from "@/types/discover";

export interface DiscoverUpdateCardProps {
    update: DiscoverUpdateView;
    viewerId: string | null;
    onOpen: (updateId: string, opener: HTMLElement) => void;
    onHide: (updateId: string) => void;
    /** The project's card was visited from here, so "Hide opened" can hide it. */
    onVisitProject: (projectId: string) => void;
}

/** Long enough that five lines will not show all of it. */
const CLAMP_AT = 280;
const SHOW_MORE_LINES = 6;

const typeLabel = (type: DiscoverUpdateView["updateType"]) => (type ? type.replace(/_/g, " ") : null);

/** An author-written description, or a plain one: the stored default is the file name, which says nothing. */
function mediaAlt(item: DiscoverUpdateMedia, author: string) {
    const alt = item.altText?.trim();
    const fileLike = !alt || alt === item.label?.trim() || /\.(png|jpe?g|gif|webp|avif)$/i.test(alt);
    return fileLike ? `Image attached to ${author}'s update` : alt;
}

function MediaTile({ item, alt, single, onOpen }: { item: DiscoverUpdateMedia; alt: string; single: boolean; onOpen: () => void }) {
    const [failed, setFailed] = useState(false);
    const ratio = single && item.width && item.height ? `${item.width} / ${item.height}` : single ? "16 / 9" : "4 / 3";
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label={`Open image: ${alt}`}
            className={cn(
                "block min-h-11 w-full overflow-hidden rounded-[8px] border border-border bg-muted/30 text-left transition hover:border-foreground/25 focus-visible:border-foreground",
                single && "max-h-[360px]",
            )}
            style={{ aspectRatio: ratio }}
        >
            {failed ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImageOff className="h-5 w-5" aria-hidden="true" />
                    <span className="text-xs">Image unavailable</span>
                </span>
            ) : (
                <img src={item.url ?? ""} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
            )}
        </button>
    );
}

function UpdateMedia({ media, author }: { media: DiscoverUpdateMedia[]; author: string }) {
    const [viewed, setViewed] = useState<DiscoverUpdateMedia | null>(null);
    const images = media.filter((item) => item.type === "image" && item.url);
    const others = media.filter((item) => !(item.type === "image" && item.url) && (item.url || item.label));
    if (images.length === 0 && others.length === 0) return null;
    return (
        <div className="mt-3 space-y-2">
            {images.length > 0 ? (
                <div className={cn("grid gap-2", images.length > 1 && "grid-cols-2")}>
                    {images.map((item, index) => (
                        <MediaTile key={`${item.url}-${index}`} item={item} alt={mediaAlt(item, author)} single={images.length === 1} onOpen={() => setViewed(item)} />
                    ))}
                </div>
            ) : null}
            {others.map((item, index) => (
                <a
                    key={`${item.url ?? item.label}-${index}`}
                    href={item.url ?? undefined}
                    target={item.url ? "_blank" : undefined}
                    rel={item.url ? "noreferrer noopener" : undefined}
                    className="inline-flex min-h-11 min-w-0 items-center font-mono text-xs text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                    <span className="truncate">{item.label || item.url || "Linked item"}</span>
                </a>
            ))}
            {/* The viewer is a portal: its clicks must not reach anything behind it. */}
            <div onClick={(event) => event.stopPropagation()}>
                <ProjectUpdateMediaViewer item={viewed} onOpenChange={(open) => { if (!open) setViewed(null); }} />
            </div>
        </div>
    );
}

function ProjectChip({ update, onVisit }: { update: DiscoverUpdateView; onVisit: () => void }) {
    const [coverFailed, setCoverFailed] = useState(false);
    const href = `/projects/${encodeURIComponent(update.projectSlug || update.projectId)}`;
    return (
        <Link
            href={href}
            onClick={onVisit}
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-[5px] pr-1 text-xs text-muted-foreground hover:text-foreground focus-visible:underline"
        >
            <span aria-hidden="true">in</span>
            {update.projectCoverImage && !coverFailed ? (
                 
                <img src={update.projectCoverImage} alt="" width={20} height={20} loading="lazy" onError={() => setCoverFailed(true)} className="size-5 shrink-0 rounded-[4px] object-cover" />
            ) : (
                <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-muted font-mono text-[10px] font-semibold text-foreground">
                    {update.projectName.slice(0, 1).toUpperCase()}
                </span>
            )}
            <span className="min-w-0 truncate font-medium text-foreground">{update.projectName}</span>
        </Link>
    );
}

export default memo(function DiscoverUpdateCard({ update, viewerId, onOpen, onHide, onVisitProject }: DiscoverUpdateCardProps) {
    const like = useToggleUpdateLike(update.projectId, update.id);
    const [expanded, setExpanded] = useState(false);
    const author = update.author;
    const masked = !author || author.masked;
    const authorName = masked ? "Private member" : author.fullName || author.username || "Member";
    const canExpand = update.content.length > CLAMP_AT || update.content.split("\n").length > SHOW_MORE_LINES;
    const type = typeLabel(update.updateType);
    const projectHref = `/projects/${encodeURIComponent(update.projectSlug || update.projectId)}`;
    const directHref = `${projectHref}?tab=updates&updateId=${encodeURIComponent(update.id)}`;
    const titleId = `discover-update-${update.id}-title`;
    const signInHref = `/login?redirect=${encodeURIComponent(`/discover?updateId=${update.id}`)}`;

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(new URL(`/discover?updateId=${update.id}`, window.location.origin).href);
            toast.success("Link copied");
        } catch {
            toast.error("Couldn't copy the link");
        }
    };

    return (
        <article
            aria-labelledby={titleId}
            data-testid={`discover-update-${update.id}`}
            className="nb-project-card group relative cursor-pointer border-l-2 border-l-primary"
            onClick={(event) => {
                // Links and buttons do their own thing; selecting text to copy it is not a request to open the thread.
                if (isUpdateCardControl(event.target, event.currentTarget)) return;
                if (window.getSelection()?.toString()) return;
                onOpen(update.id, event.currentTarget);
            }}
        >
            <div className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[.09em] text-muted-foreground">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="font-semibold text-primary">Update</span>
                    {type ? <span className="truncate">· {type}</span> : null}
                    {update.isPinned ? <span className="inline-flex items-center gap-1"><Pin className="h-3 w-3" aria-hidden="true" />Pinned</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 normal-case tracking-normal">
                    {update.editedAt ? <span>Edited</span> : null}
                    <UpdateTime date={update.createdAt} />
                </span>
            </div>

            <div className="mt-3 flex items-center gap-3">
                {!masked && author.username ? (
                    <Link href={`/u/${author.username}`} className="shrink-0 rounded-[6px] focus-visible:opacity-80" aria-label={`${authorName}'s profile`}>
                        <UserAvatar identity={{ fullName: authorName, username: author.username, avatarUrl: author.avatarUrl }} size={40} className="rounded-[6px]" />
                    </Link>
                ) : (
                    <UserAvatar identity={{ fullName: authorName, username: null, avatarUrl: null }} size={40} className="shrink-0 rounded-[6px]" />
                )}
                <div className="min-w-0 flex-1">
                    <h3 id={titleId} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[15px] font-semibold leading-tight text-foreground">
                        {!masked && author.username ? (
                            <Link href={`/u/${author.username}`} className="truncate hover:underline focus-visible:underline">{authorName}</Link>
                        ) : (
                            <span className="truncate">{authorName}</span>
                        )}
                        {!masked && author.roleLabel ? <span className="font-mono text-[11px] font-normal text-muted-foreground">{author.roleLabel}</span> : null}
                    </h3>
                    <ProjectChip update={update} onVisit={() => onVisitProject(update.projectId)} />
                </div>
            </div>

            {update.content.trim() ? (
                <div className="mt-1">
                    <ProjectUpdateContent
                        content={update.content}
                        projectId={update.projectId}
                        projectSlug={update.projectSlug}
                        className={cn("block w-full whitespace-pre-wrap break-words text-left text-[14px] leading-relaxed text-foreground/90", !expanded && "line-clamp-5")}
                    />
                    {canExpand ? (
                        <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => setExpanded((open) => !open)}
                            className="inline-flex min-h-11 items-center text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:underline"
                        >
                            {expanded ? "Show less" : "Show more"}
                        </button>
                    ) : null}
                </div>
            ) : null}

            <UpdateMedia media={update.media} author={authorName} />

            <div className="nb-project-card-footer">
                <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    {viewerId ? (
                        <button
                            type="button"
                            onClick={like.toggle}
                            aria-pressed={update.likedByViewer}
                            aria-label={`${update.likedByViewer ? "Unlike" : "Like"} this update, ${update.likeCount} ${update.likeCount === 1 ? "like" : "likes"}`}
                            className={cn(
                                "inline-flex min-h-11 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors hover:bg-muted focus-visible:bg-muted",
                                update.likedByViewer ? "font-medium text-[var(--status-danger)]" : "hover:text-foreground",
                            )}
                        >
                            <Heart className={cn("h-3.5 w-3.5", update.likedByViewer && "fill-current")} aria-hidden="true" />
                            <span aria-hidden="true">{update.likeCount}</span>
                        </button>
                    ) : (
                        <Link
                            href={signInHref}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-[5px] px-2.5 text-xs hover:bg-muted hover:text-foreground focus-visible:underline"
                            aria-label={`Sign in to like this update, ${update.likeCount} ${update.likeCount === 1 ? "like" : "likes"}`}
                        >
                            <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                            <span aria-hidden="true">{update.likeCount}</span>
                        </Link>
                    )}

                    <button
                        type="button"
                        onClick={(event) => onOpen(update.id, event.currentTarget)}
                        aria-label={`Open thread, ${update.commentCount} ${update.commentCount === 1 ? "comment" : "comments"}`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted"
                    >
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span aria-hidden="true">{update.commentCount}</span>
                    </button>
                    {/* The count is announced when it changes, without moving focus. */}
                    <span className="sr-only" role="status" aria-live="polite">{update.likedByViewer ? "Liked" : ""}</span>
                </div>

                <div className="flex items-center gap-1">
                    <Link
                        href={directHref}
                        onClick={() => onVisitProject(update.projectId)}
                        className="inline-flex min-h-11 items-center rounded-[5px] px-2.5 font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:underline"
                    >
                        View in project
                    </Link>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="More actions for this update"
                                className="inline-flex size-11 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted"
                            >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => void copyLink()}>Copy link</DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href={projectHref} onClick={() => onVisitProject(update.projectId)}>Open project</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onHide(update.id)}>Hide update</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </article>
    );
});
