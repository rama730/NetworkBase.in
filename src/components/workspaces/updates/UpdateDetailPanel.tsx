'use client';

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    MessageCircle,
    X,
} from "lucide-react";
import { LikeHeart } from "@/components/ui/LikeHeart";
import { type WorkspaceUpdateView } from "@/app/actions/workspace/updates";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import { UpdateTime, updateAuthorName } from '@/components/workspaces/updates/update-helpers';
import { WorkspaceUpdateContent, UpdateContextAndMedia } from '@/components/workspaces/updates/UpdateContent';
import { UpdateComments } from '@/components/workspaces/updates/UpdateComments';
import { useToggleUpdateLike } from '@/hooks/useToggleUpdateLike';
import { markUpdateNotificationsReadAction } from '@/app/actions/workspace/updates';
import { WorkspaceUpdateLikersModal } from '@/components/workspaces/updates/WorkspaceUpdateLikersModal';
import { toast } from '@/lib/feedback';

export function UpdateDetailPanel({
  projectId,
  projectSlug,
  update,
  updatesQueryKey,
  onClose,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  highlightedCommentId,
  className,
  autoFocus = false,
}: {
  projectId: string;
  projectSlug?: string | null;
  update: WorkspaceUpdateView | null;
  updatesQueryKey: readonly unknown[];
  onClose: () => void;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  highlightedCommentId?: string | null;
  className?: string;
  /** Move focus to the panel when it opens (the Discover thread does; the project tab keeps its own focus). */
  autoFocus?: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const [isLikersOpen, setIsLikersOpen] = useState(false);
  const like = useToggleUpdateLike(projectId, update?.id ?? "");
  const hasUpdate = Boolean(update);
  // You're looking at this post: its notifications are read, now and as they arrive (RT8).
  const openUpdateId = update?.id ?? null;
  const likeCount = update?.likeCount;
  const commentCount = update?.commentCount;
  useEffect(() => {
    if (!openUpdateId || !currentUserId) return;
    const timer = setTimeout(() => void markUpdateNotificationsReadAction(openUpdateId).catch(() => undefined), 1_000);
    return () => clearTimeout(timer);
  }, [commentCount, currentUserId, likeCount, openUpdateId]);

  useEffect(() => {
    if (autoFocus && hasUpdate) headingRef.current?.focus({ preventScroll: true });
  }, [autoFocus, hasUpdate, update?.id]);

  // Escape closes the thread only when focus is inside it: not from the search box, the filters drawer or the
  // media viewer, and not out from under a half-written comment.
  const closeOnEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target as Element;
    const dialog = target.closest('[role="dialog"]');
    if (dialog && sectionRef.current && !dialog.contains(sectionRef.current)) return;
    if ((target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) && target.value.trim()) return;
    onClose();
  };

  if (!update) return null;
  const isDeleted = Boolean(update.deletedAt);

  return (
    <section ref={sectionRef} onKeyDown={closeOnEscape} aria-label="Update thread" className={cn("w-full min-w-0 bg-transparent", className)}>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 pb-3 backdrop-blur-sm">
        <div>
          <p ref={headingRef} tabIndex={-1} className="nb-ui-label text-foreground outline-none">
            Threads
          </p>
          <UpdateTime date={update.createdAt} className="font-mono text-[11px] text-muted-foreground" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close thread"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="py-4 pr-1">
        <article className="border-b border-border pb-4">
          <div className="flex gap-3">
            {update.author?.username ? (
              <Link href={`/u/${update.author.username}`} className="shrink-0 transition-opacity hover:opacity-80">
                <UserAvatar
                  identity={{
                    fullName: updateAuthorName(update),
                    username: update.author?.username ?? null,
                    avatarUrl: update.author?.avatarUrl ?? null,
                  }}
                  size={34}
                  className="mt-0.5 rounded-[5px]"
                />
              </Link>
            ) : (
              <UserAvatar
                identity={{
                  fullName: updateAuthorName(update),
                  username: update.author?.username ?? null,
                  avatarUrl: update.author?.avatarUrl ?? null,
                }}
                size={34}
                className="mt-0.5 rounded-[5px]"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm leading-5">
                {update.author?.username ? (
                  <Link href={`/u/${update.author.username}`} className="truncate font-semibold text-foreground hover:underline">
                    {updateAuthorName(update)}
                  </Link>
                ) : (
                  <span className="truncate font-semibold text-foreground">
                    {updateAuthorName(update)}
                  </span>
                )}
                {update.author?.roleLabel ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {update.author.roleLabel}
                  </span>
                ) : null}
              </div>

              {update.content.trim() ? (
                <WorkspaceUpdateContent
                  content={update.content}
                  projectId={projectId}
                  projectSlug={projectSlug}
                  className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/90"
                />
              ) : null}

              {!isDeleted ? (
                <UpdateContextAndMedia update={update} compact />
              ) : null}

              {!isDeleted ? (
                <div className="mt-2.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <div className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors hover:bg-muted hover:text-foreground",
                    update.likedByViewer && "text-[var(--like)]",
                  )}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!currentUserId) {
                          toast.error("Sign in to like updates");
                          return;
                        }
                        like.toggle();
                      }}
                      aria-pressed={update.likedByViewer}
                      aria-label="Like update"
                      className={cn(
                        "inline-flex items-center justify-center transition-transform active:translate-y-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
                        update.likedByViewer && "text-[var(--like)]",
                      )}
                    >
                      <LikeHeart liked={update.likedByViewer} className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      // The count opens "Liked by"; at 0 there's no one to show, and liking stays on the heart.
                      disabled={update.likeCount === 0}
                      onClick={(e) => {
                          e.stopPropagation();
                          setIsLikersOpen(true);
                      }}
                      aria-label={`View ${update.likeCount} ${update.likeCount === 1 ? "like" : "likes"}`}
                      className={cn(
                        "inline-flex items-center tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
                        update.likeCount > 0 ? "cursor-pointer hover:underline" : "cursor-default disabled:opacity-100",
                        update.likedByViewer && "text-[var(--like)] font-medium",
                      )}
                    >
                      <span aria-hidden="true">{update.likeCount}</span>
                    </button>
                  </div>

                  <span className="inline-flex min-h-11 items-center gap-1.5 px-2.5">
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="tabular-nums">{update.commentCount}</span>
                    <span className="sr-only">comments</span>
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </article>

        {!isDeleted ? (
          <UpdateComments
            projectId={projectId}
            update={update}
            updatesQueryKey={updatesQueryKey}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserAvatarUrl={currentUserAvatarUrl}
            highlightedCommentId={highlightedCommentId}
          />
        ) : null}
      </div>

      <WorkspaceUpdateLikersModal
        open={isLikersOpen}
        onOpenChange={setIsLikersOpen}
        projectId={projectId}
        updateId={update.id}
        likeCount={update.likeCount}
      />
    </section>
  );
}
