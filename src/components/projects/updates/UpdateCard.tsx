'use client';

import { ReportDialog } from "@/components/reports/ReportDialog";
import { memo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    useMutation,
    useQueryClient,
    type InfiniteData,
} from "@tanstack/react-query";
import {
    FileText,
    Heart,
    Loader2,
    MessageCircle,
    MoreHorizontal,
    PanelRightOpen,
    Pin,
    Flag,
    Trash2,
} from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { useToggleUpdateLike } from "@/hooks/useToggleUpdateLike";
import { deleteProjectUpdateAction, editProjectUpdateAction, toggleProjectUpdatePinAction, type ProjectUpdateView } from "@/app/actions/project/updates";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { isUpdateCardControl, removeUpdate, updateAuthorName, updateContextItems, updatePages, updateRelativeTime, type UpdatesPage } from '@/components/projects/updates/update-helpers';
import { ProjectUpdateContent, UpdateContextAndMedia } from '@/components/projects/updates/UpdateContent';

function UpdateCard({
  projectId: feedProjectId,
  projectSlug: feedProjectSlug,
  update,
  updatesQueryKey,
  onHide,
  onOpenDetail,
  currentUserId,
  highlighted,
  isNew = false,
}: {
  projectId: string;
  projectSlug?: string | null;
  update: ProjectUpdateView;
  updatesQueryKey: readonly unknown[];
  onHide: (updateId: string) => void;
  onOpenDetail: (updateId: string) => void;
  currentUserId: string | null;
  highlighted: boolean;
  /** Org feed: posted since the viewer last opened it. */
  isNew?: boolean;
}) {
  // A post shared up from a child project acts in that project (likes, comments, edits).
  const projectId = update.fromProject ? update.projectId : feedProjectId;
  const projectSlug = update.fromProject ? update.fromProject.slug : feedProjectSlug;
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(update.content);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const href = `/projects/${encodeURIComponent(projectSlug || projectId)}?tab=updates&updateId=${encodeURIComponent(update.id)}`;
  const isDeleted = Boolean(update.deletedAt);
  // An optimistic post the server has not confirmed yet: it reads as pending and cannot be acted on.
  const isPending = update.id.startsWith("temp-");
  const canSaveEdit = Boolean(
    draft.trim() || updateContextItems(update).length > 0 || update.media.length > 0,
  );

  const like = useToggleUpdateLike(projectId, update.id);
  // "Edited" with Notify again (report §17.4): off unless ticked.
  const [notifyAgain, setNotifyAgain] = useState(false);

  const editMutation = useMutation({
    mutationFn: async () => {
      const result = await editProjectUpdateAction(projectId, update.id, {
        content: draft,
        entityRefs: update.entityRefs,
        media: update.media,
        notifyAgain,
      });
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to edit update");
      return result.data;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id ? next : item,
          ),
      );
      setIsEditing(false);
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
      toast.success("Update edited");
    },
    onError: (error) =>
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Failed to edit update", "Failed to edit update"),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      let result = await deleteProjectUpdateAction(projectId, update.id);
      // Removing someone else's post in an org needs a reason the author will see (report §17.4).
      if (!result.success && result.error?.startsWith("Say why")) {
        const reason = window.prompt(result.error);
        if (!reason?.trim()) throw new Error("Not removed: a reason is needed.");
        result = await deleteProjectUpdateAction(projectId, update.id, reason);
      }
      if (!result.success)
        throw new Error(result.error || "Failed to delete update");
      return result.data ?? null;
    },
    onSuccess: () => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          removeUpdate(existing, update.id),
      );
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
      toast.success("Update removed");
    },
    onError: (error) =>
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Failed to delete update", "Failed to delete update"),
      ),
  });

  const pinMutation = useMutation({
    mutationFn: async () => {
      // A shared post is pinned in the feed it is shown in (the org's), never in its own project (report §17.6).
      const result = await toggleProjectUpdatePinAction(
        update.fromProject ? feedProjectId : projectId,
        update.id,
        !update.isPinned,
      );
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to update pin");
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
    },
    onError: (error) =>
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Failed to update pin", "Failed to update pin"),
      ),
  });

  return (
    <article
      id={`project-update-${update.id}`}
      role="button"
      tabIndex={isEditing ? -1 : 0}
      aria-label={`Open update by ${updateAuthorName(update)}`}
      onClick={(event) => {
        if (isEditing || event.defaultPrevented || isUpdateCardControl(event.target, event.currentTarget)) return;
        onOpenDetail(update.id);
      }}
      onMouseEnter={() => router.prefetch(href)}
      onKeyDown={(event) => {
        if (isEditing || event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail(update.id);
        }
      }}
      className={cn(
        "group border-b border-border/80 px-1 py-3 transition-colors animate-in fade-in slide-in-from-bottom-2",
        !isEditing && "cursor-pointer hover:bg-muted/30 focus-visible:outline-none",
        highlighted && "bg-muted/40",
      )}
    >
      {update.isPinned ? (
        <div className="mb-2 ml-11 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          <Pin className="h-3 w-3" />
          Pinned update
          {update.pinnedUntil ? ` · until ${new Date(update.pinnedUntil).toLocaleDateString()}` : null}
        </div>
      ) : null}
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
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
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
                {update.updateType === "announcement" || update.updateType === "discussion" ? (
                  <span className="rounded-[3px] border border-border px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {update.updateType === "announcement" ? "Announcement" : "Discussion"}
                  </span>
                ) : null}
                {update.fromProject ? (
                  <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">From {update.fromProject.title}</span>
                ) : null}
                {update.sharedToOrgTitle ? (
                  <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">Shared to {update.sharedToOrgTitle}</span>
                ) : null}
                {(update.audience.roles?.length || update.audience.projectIds?.length) ? (
                  <span className="text-[11px] text-muted-foreground">· Limited audience</span>
                ) : null}
                {isNew ? (
                  <span className="rounded-[3px] bg-foreground px-1 font-mono text-[10px] uppercase tracking-wider text-background">New</span>
                ) : null}
                <span className="font-mono text-[11px] text-muted-foreground">
                  · {isPending ? "Posting…" : updateRelativeTime(update.createdAt)}
                </span>
                {!isDeleted && update.editedAt ? (
                  <span className="font-mono text-[10px] max-md:text-[11px] uppercase tracking-wider text-muted-foreground">Edited</span>
                ) : null}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="nb-touch-target -mt-1 flex h-7 w-7 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label="Update options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onOpenDetail(update.id)}>
                  <PanelRightOpen className="h-4 w-4" />
                  Open detail
                </DropdownMenuItem>
                {!isDeleted ? (
                  <DropdownMenuItem onClick={() => onHide(update.id)}>
                    <Trash2 className="h-4 w-4" />
                    Hide update
                  </DropdownMenuItem>
                ) : null}
                {update.canPin ? (
                  <DropdownMenuItem onClick={() => pinMutation.mutate()}>
                    <Pin className="h-4 w-4" />
                    {update.isPinned ? "Unpin update" : "Pin update"}
                  </DropdownMenuItem>
                ) : null}
                {update.canEdit ? (
                  <DropdownMenuItem onClick={() => setIsEditing(true)}>
                    <FileText className="h-4 w-4" />
                    Edit update
                  </DropdownMenuItem>
                ) : null}
                {/* Report a post or announcement (report §30.3); authors and managers act on their own posts. */}
                {!update.canEdit && !update.canDelete && !isDeleted ? (
                  <DropdownMenuItem onClick={() => setIsReporting(true)}>
                    <Flag className="h-4 w-4" />
                    Report {update.updateType === "announcement" ? "announcement" : "post"}
                  </DropdownMenuItem>
                ) : null}
                {update.canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setIsDeleteConfirmOpen(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete update
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {isReporting ? <ReportDialog kind="update" targetId={update.id} noun={update.updateType === "announcement" ? "announcement" : "post"} open={isReporting} onOpenChange={setIsReporting} /> : null}
          </div>

          {isEditing ? (
            <div className="mt-3">
              <textarea
                value={draft}
                onChange={(event) =>
                  setDraft(event.target.value.slice(0, 2_000))
                }
                className="flex min-h-28 w-full resize-none rounded-[5px] border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              />
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                {update.updateType === "announcement" && update.canPin ? (
                  <label className="mr-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <input type="checkbox" checked={notifyAgain} onChange={(event) => setNotifyAgain(event.target.checked)} />
                    Notify again
                  </label>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-[5px]"
                  onClick={() => {
                    setDraft(update.content);
                    setIsEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-[5px]"
                  disabled={!canSaveEdit || editMutation.isPending}
                  onClick={() => editMutation.mutate()}
                >
                  {editMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          ) : update.content.trim() ? (
            <ProjectUpdateContent
              content={update.content}
              projectId={projectId}
              projectSlug={projectSlug}
              className="mt-1 block w-full whitespace-pre-wrap break-words text-left text-[15px] leading-relaxed text-foreground/90 transition group-hover:text-foreground"
            />
          ) : null}

          {!isDeleted ? (
            <UpdateContextAndMedia update={update} />
          ) : null}

          {!isDeleted && !isPending ? (
            <div className="mt-2.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() =>
                  currentUserId
                    ? like.toggle()
                    : toast.error("Please log in to like updates")
                }
                className={cn(
                  "nb-touch-target inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-rose-500",
                  update.likedByViewer && "text-rose-500 font-medium",
                )}
              >
                <Heart
                  className={cn(
                    "h-3.5 w-3.5",
                    update.likedByViewer && "fill-current",
                  )}
                />
                <span>{update.likeCount}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!currentUserId) {
                    toast.error("Please log in to comment");
                    return;
                  }
                  onOpenDetail(update.id);
                }}
                className="nb-touch-target inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>{update.commentCount}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
        title="Delete update"
        description="Are you sure you want to delete this update? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </article>
  );
}

export const MemoizedUpdateCard = memo(UpdateCard);
MemoizedUpdateCard.displayName = "MemoizedProjectUpdateCard";
