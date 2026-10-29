'use client';

import { useMemo } from "react";
import { History } from "lucide-react";
import { type WorkspaceUpdateView } from "@/app/actions/workspace/updates";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { updateAuthorName, updateAuthorRoleLabel, updateRelativeTime } from '@/components/workspaces/updates/update-helpers';

export function UpdatesRightRail({
  updates,
  onOpenDetail,
}: {
  updates: WorkspaceUpdateView[];
  onOpenDetail: (updateId: string) => void;
}) {
  const postingMembers = useMemo(
    () => {
      const latestByAuthor = new Map<string, WorkspaceUpdateView>();
      updates
        .filter((update) => !update.deletedAt)
        .forEach((update) => {
          const key =
            update.author?.id ??
            update.author?.username ??
            update.authorId ??
            update.id;
          const current = latestByAuthor.get(key);
          if (
            !current ||
            new Date(update.createdAt).getTime() > new Date(current.createdAt).getTime()
          ) {
            latestByAuthor.set(key, update);
          }
        });

      return Array.from(latestByAuthor.values()).sort((a, b) => {
        const createdDelta =
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return createdDelta || b.id.localeCompare(a.id);
      });
    },
    [updates],
  );

  return (
    <section aria-label="Update shortcuts" className="space-y-5">
      <div className="border-b border-border pb-3">
        <h3 className="nb-ui-label text-foreground">
          Recent activity
        </h3>
      </div>

      {postingMembers.length ? (
        <div className="divide-y divide-border/60 border-b border-border/80">
          {postingMembers.map((update) => {
            const roleLabel = updateAuthorRoleLabel(update);
            const authorName = updateAuthorName(update);
            return (
              <button
                key={update.id}
                type="button"
                onClick={() => onOpenDetail(update.id)}
                className="group flex w-full min-w-0 items-center gap-3 rounded-[5px] px-1 py-2.5 text-left transition-colors hover:bg-muted/40"
              >
                <UserAvatar
                  identity={{
                    fullName: authorName,
                    username: update.author?.username ?? null,
                    avatarUrl: update.author?.avatarUrl ?? null,
                  }}
                  size={32}
                  className="shrink-0 rounded-[5px]"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                  <span className="font-semibold text-foreground">
                    {authorName}
                  </span>
                  {roleLabel ? <span className="font-mono text-[11px]"> · {roleLabel}</span> : null}
                  <span className="font-mono text-[11px]"> · {updateRelativeTime(update.createdAt, "long")}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="nb-empty-state nb-grid-ground my-4 py-8 text-center" role="status">
          <History className="nb-empty-state-icon mb-2" />
          <p className="nb-empty-state-title">
            No updates yet
          </p>
          <p className="nb-empty-state-desc">
            Workspace members will appear here after their first post.
          </p>
        </div>
      )}
    </section>
  );
}
