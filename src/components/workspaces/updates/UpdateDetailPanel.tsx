'use client';

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
    Heart,
    MessageCircle,
    X,
} from "lucide-react";
import { type WorkspaceUpdateView } from "@/app/actions/workspace/updates";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import { UpdateTime, updateAuthorName } from '@/components/workspaces/updates/update-helpers';
import { WorkspaceUpdateContent, UpdateContextAndMedia } from '@/components/workspaces/updates/UpdateContent';
import { UpdateComments } from '@/components/workspaces/updates/UpdateComments';
import { useToggleUpdateLike } from '@/hooks/useToggleUpdateLike';

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
  const like = useToggleUpdateLike(projectId, update?.id ?? "");
  const hasUpdate = Boolean(update);

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
                  {currentUserId ? (
                    <button
                      type="button"
                      onClick={like.toggle}
                      aria-pressed={update.likedByViewer}
                      aria-label={`${update.likedByViewer ? "Unlike" : "Like"} this update, ${update.likeCount} ${update.likeCount === 1 ? "like" : "likes"}`}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-1.5 rounded-[5px] px-2.5 transition-colors hover:bg-muted",
                        update.likedByViewer && "font-medium text-[var(--status-danger)]",
                      )}
                    >
                      <Heart className={cn("h-3.5 w-3.5", update.likedByViewer && "fill-current")} aria-hidden="true" />
                      <span aria-hidden="true">{update.likeCount}</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5">
                      <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                      {update.likeCount}
                      <span className="sr-only">likes</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 px-2.5">
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {update.commentCount}
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
    </section>
  );
}
