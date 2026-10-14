'use client';

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
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { deleteProjectUpdateAction, editProjectUpdateAction, toggleProjectUpdateLikeAction, toggleProjectUpdatePinAction, type ProjectUpdateView } from "@/app/actions/project/updates";
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
  projectId,
  projectSlug,
  update,
  updatesQueryKey,
  onHide,
  onOpenDetail,
  currentUserId,
  highlighted,
}: {
  projectId: string;
  projectSlug?: string | null;
  update: ProjectUpdateView;
  updatesQueryKey: readonly unknown[];
  onHide: (updateId: string) => void;
  onOpenDetail: (updateId: string) => void;
  currentUserId: string | null;
  highlighted: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(update.content);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const href = `/projects/${encodeURIComponent(projectSlug || projectId)}?tab=updates&updateId=${encodeURIComponent(update.id)}`;
  const isDeleted = Boolean(update.deletedAt);
  // An optimistic post the server has not confirmed yet: it reads as pending and cannot be acted on.
  const isPending = update.id.startsWith("temp-");
  const canSaveEdit = Boolean(
    draft.trim() || updateContextItems(update).length > 0 || update.media.length > 0,
  );

  const likeMutation = useMutation({
    mutationFn: async () => {
      const result = await toggleProjectUpdateLikeAction(projectId, update.id);
      if (!result.success)
        throw new Error(result.error || "Failed to update like");
      return result;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: updatesQueryKey });
      const previous =
        queryClient.getQueryData<InfiniteData<UpdatesPage>>(updatesQueryKey);
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? {
                  ...item,
                  likedByViewer: !item.likedByViewer,
                  likeCount: item.likedByViewer
                    ? Math.max(0, item.likeCount - 1)
                    : item.likeCount + 1,
                }
              : item,
          ),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(updatesQueryKey, context.previous);
      toast.error(
        error instanceof Error ? error.message : "Failed to update like",
      );
    },
    onSuccess: (result) => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? {
                  ...item,
                  likedByViewer: result.liked,
                  likeCount: result.likeCount,
                }
              : item,
          ),
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const result = await editProjectUpdateAction(projectId, update.id, {
        content: draft,
        entityRefs: update.entityRefs,
        media: update.media,
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
        error instanceof Error ? error.message : "Failed to edit update",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const result = await deleteProjectUpdateAction(projectId, update.id);
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
        error instanceof Error ? error.message : "Failed to delete update",
      ),
  });

  const pinMutation = useMutation({
    mutationFn: async () => {
      const result = await toggleProjectUpdatePinAction(
        projectId,
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
        error instanceof Error ? error.message : "Failed to update pin",
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
              <div className="mt-2 flex justify-end gap-2">
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
                    ? likeMutation.mutate()
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
