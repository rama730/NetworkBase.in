'use client';

import { useEffect } from "react";
import Link from "next/link";
import {
    Heart,
    MessageCircle,
    X,
} from "lucide-react";
import { type ProjectUpdateView } from "@/app/actions/project/updates";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import { updateAuthorName, updateRelativeTime } from '@/components/projects/updates/update-helpers';
import { ProjectUpdateContent, UpdateContextAndMedia } from '@/components/projects/updates/UpdateContent';
import { UpdateComments } from '@/components/projects/updates/UpdateComments';

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
}: {
  projectId: string;
  projectSlug?: string | null;
  update: ProjectUpdateView | null;
  updatesQueryKey: readonly unknown[];
  onClose: () => void;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  highlightedCommentId?: string | null;
  className?: string;
}) {
  useEffect(() => {
    if (!update) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, update]);

  if (!update) return null;
  const isDeleted = Boolean(update.deletedAt);

  return (
    <section className={cn("w-full min-w-0 bg-transparent", className)}>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/95 pb-3 backdrop-blur-sm">
        <div>
          <p className="nb-ui-label text-foreground">
            Threads
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {updateRelativeTime(update.createdAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close detail"
        >
          <X className="h-4 w-4" />
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
                <ProjectUpdateContent
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
                <div className="mt-2.5 flex items-center gap-4 font-mono text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Heart className="h-3.5 w-3.5" />
                    {update.likeCount}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5" />
                    {update.commentCount}
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
