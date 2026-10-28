'use client';

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import Link from "next/link";
import {
    useInfiniteQuery,
    useMutation,
    useQueryClient,
    type InfiniteData,
} from "@tanstack/react-query";
import {
    ArrowLeft,
    CornerDownRight,
    Flag,
    Loader2,
    Send,
    Trash2,
    X,
} from "lucide-react";
import { ReportButton } from "@/components/reports/ReportDialog";
import { toast, feedbackError } from "@/lib/feedback";
import { createProjectUpdateCommentAction, deleteProjectUpdateCommentAction, readProjectUpdateCommentsAction, type ProjectUpdateCommentView, type ProjectUpdateView } from "@/app/actions/project/updates";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ThreadAvatarRail, ThreadRailBridge } from "@/components/ui/ThreadRail";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { getDescendants, renderCommentContent, updatePages, updateRelativeTime, type UpdatesPage } from '@/components/projects/updates/update-helpers';

function CommentRow({
  comment,
  allComments,
  highlightedCommentId,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  onReply,
  onDelete,
  onFocusComment,
}: {
  comment: ProjectUpdateCommentView;
  allComments: ProjectUpdateCommentView[];
  highlightedCommentId?: string | null;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  onReply: (parentId: string, content: string) => void;
  onDelete: (commentId: string) => void;
  onFocusComment?: (commentId: string) => void;
}) {
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [showAllReplies, setShowAllReplies] = useState(false);

  const descendants = useMemo(
    () => getDescendants(comment.id, allComments),
    [comment.id, allComments],
  );

  const handleReplySubmit = (parentId: string) => {
    const val = replyDraft.trim();
    if (!val) return;
    onReply(parentId, val);
    setReplyDraft("");
    setReplyingToId(null);
  };

  const needsCollapse = descendants.length > 2 && !showAllReplies;

  const allRowItems = useMemo(() => {
    if (needsCollapse) {
      const rootItem = { comment, isReply: false, replyingTo: null, isSpacer: false, hiddenCount: 0 };
      const spacerItem = {
        comment: null as any,
        isReply: true,
        replyingTo: null,
        isSpacer: true,
        hiddenCount: descendants.length - 1,
      };
      const lastDescendant = descendants[descendants.length - 1]!;
      const lastItem = {
        comment: lastDescendant.comment,
        isReply: true,
        replyingTo: lastDescendant.replyingTo,
        isSpacer: false,
        hiddenCount: 0,
      };
      return [rootItem, spacerItem, lastItem];
    }

    return [
      { comment, isReply: false, replyingTo: null, isSpacer: false, hiddenCount: 0 },
      ...descendants.map((d) => ({
        comment: d.comment,
        isReply: true,
        replyingTo: d.replyingTo,
        isSpacer: false,
        hiddenCount: 0,
      })),
    ];
  }, [comment, descendants, needsCollapse]);

  return (
    <div className="flex flex-col">
      {allRowItems.map((item, idx) => {
        if (item.isSpacer) {
          return (
            <div key={`spacer-${comment.id}`} className="relative flex gap-2.5 px-1 py-0.5">
              <ThreadRailBridge />
              <div className="flex flex-1 items-center py-0.5">
                <button
                  type="button"
                  onClick={() => setShowAllReplies(true)}
                  className="inline-flex items-center gap-1.5 rounded-[3px] border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground text-left"
                >
                  + {item.hiddenCount} {item.hiddenCount === 1 ? "reply" : "replies"}
                </button>
              </div>
            </div>
          );
        }

        const c = item.comment;
        const replyingTo = item.replyingTo;
        const isFirst = idx === 0;
        const isLast = idx === allRowItems.length - 1;

        return (
          <div
            key={c.id}
            id={`project-update-comment-${c.id}`}
            className={cn(
              "relative flex gap-2.5 rounded-[5px] px-1 py-1.5 transition-colors duration-[260ms]",
              highlightedCommentId === c.id && "border border-primary/30 bg-primary/5",
            )}
          >
            <ThreadAvatarRail incoming={!isFirst} outgoing={!isLast}>
              {c.author?.username ? (
                <Link
                  href={`/u/${c.author.username}`}
                 
                  className="nb-touch-target flex size-8 shrink-0 items-center justify-center transition-opacity hover:opacity-80"
                >
                  <UserAvatar
                    identity={{
                      fullName: c.author.fullName ?? c.author.username ?? "Member",
                      username: c.author.username,
                      avatarUrl: c.author.avatarUrl ?? null,
                    }}
                    size={item.isReply ? 28 : 32}
                  />
                </Link>
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center">
                  <UserAvatar
                    identity={{
                      fullName: c.author?.fullName ?? c.author?.username ?? "Member",
                      username: c.author?.username ?? null,
                      avatarUrl: c.author?.avatarUrl ?? null,
                    }}
                    size={item.isReply ? 28 : 32}
                  />
                </div>
              )}
            </ThreadAvatarRail>

            {/* Comment Content Column */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="rounded-md px-0 py-0">
                {c.deletedAt ? (
                  <p className="text-xs italic text-muted-foreground">This comment was removed.</p>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {/* Name & Role in Same Line */}
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] leading-4">
                          <span className="font-semibold text-foreground">
                            {c.author?.username ? (
                              <Link
                                href={`/u/${c.author.username}`}
                               
                                className="hover:underline"
                              >
                                {c.author.fullName || c.author.username}
                              </Link>
                            ) : (
                              c.author?.fullName || c.author?.username || "Former member"
                            )}
                          </span>
                          {c.author?.roleLabel && (
                            <span className="truncate max-w-[130px] font-mono text-[11px] text-muted-foreground" title={c.author.roleLabel}>
                              {c.author.roleLabel}
                            </span>
                          )}
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            · {updateRelativeTime(c.createdAt)}
                          </span>
                        </div>

                        {/* Replying to username underneath */}
                        {replyingTo && (
                          <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] leading-4 text-muted-foreground">
                            <CornerDownRight className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                            <span>
                              Replying to{" "}
                              <button
                                type="button"
                                onClick={() => onFocusComment?.(c.parentId!)}
                                className="font-medium text-primary hover:underline text-left"
                              >
                                @{replyingTo}
                              </button>
                            </span>
                          </div>
                        )}
                      </div>
                      {c.canDelete ? (
                        <button
                          type="button"
                          onClick={() => onDelete(c.id)}
                          className="nb-touch-target ml-2 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete comment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : currentUserId ? (
                        <ReportButton kind="update_comment" targetId={c.id} noun="comment" className="nb-touch-target ml-2 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Flag className="h-3.5 w-3.5" aria-label="Report comment" /></ReportButton>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-foreground/90">
                      {renderCommentContent(c.content)}
                    </p>
                  </>
                )}
              </div>

              {/* Reply Trigger Button */}
              {!c.deletedAt && currentUserId && (
                <div className="mt-2 flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (replyingToId === c.id) {
                        setReplyingToId(null);
                      } else {
                        setReplyingToId(c.id);
                        setReplyDraft("");
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-[4px] border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                  >
                    <CornerDownRight className="h-3 w-3" />
                    <span>Reply</span>
                  </button>
                </div>
              )}

              {/* Reply Input Editor */}
              {replyingToId === c.id && (
                <div className="mt-2.5 rounded-[6px] border border-border bg-card p-2 shadow-2xs">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <CornerDownRight className="h-3 w-3 text-muted-foreground/70" />
                      Replying to <span className="font-semibold text-foreground">@{c.author?.username || c.author?.fullName || "member"}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyingToId(null)}
                      className="flex h-5 w-5 items-center justify-center rounded-[3px] hover:bg-muted hover:text-foreground transition-colors"
                      aria-label="Cancel reply"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <UserAvatar
                      identity={{
                        fullName: currentUserName ?? "You",
                        avatarUrl: currentUserAvatarUrl ?? null,
                      }}
                      size={24}
                      className="shrink-0 rounded-[4px]"
                    />
                    <input
                      autoFocus
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value.slice(0, 1000))}
                      placeholder={`Write a reply...`}
                      className="nb-touch-target h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground text-foreground"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleReplySubmit(c.id);
                        } else if (e.key === "Escape") {
                          setReplyingToId(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={!replyDraft.trim()}
                      onClick={() => handleReplySubmit(c.id)}
                      className="flex h-6 items-center gap-1 rounded-[3px] bg-primary px-2 font-mono text-[11px] font-medium uppercase tracking-wider text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
                    >
                      <Send className="h-3 w-3" />
                      <span>Reply</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UpdateComments({
  projectId,
  update,
  updatesQueryKey,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  highlightedCommentId,
}: {
  projectId: string;
  update: ProjectUpdateView;
  updatesQueryKey: readonly unknown[];
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  highlightedCommentId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [showAllAncestors, setShowAllAncestors] = useState(false);
  const [focusedReplyDraft, setFocusedReplyDraft] = useState("");
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(Boolean(highlightedCommentId));
  const commentsKey = useMemo(
    () => queryKeys.project.detail.updateComments(projectId, update.id),
    [projectId, update.id],
  );
  const comments = useInfiniteQuery({
    queryKey: commentsKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await readProjectUpdateCommentsAction(
        projectId,
        update.id,
        pageParam,
      );
      if (!result.success)
        throw new Error(result.error || "Failed to load comments");
      return result.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isNearViewport && (update.commentCount > 0 || Boolean(highlightedCommentId)),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isNearViewport || highlightedCommentId) {
      setIsNearViewport(true);
      return;
    }
    const element = sectionRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setIsNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [highlightedCommentId, isNearViewport]);

  const commentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string | null }) => {
      const result = await createProjectUpdateCommentAction(
        projectId,
        update.id,
        content,
        parentId,
      );
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to post comment");
      return result.data;
    },
    onMutate: async ({ content, parentId }) => {
      const tempId = `temp-comment-${Date.now()}`;
      const previousComments =
        queryClient.getQueryData<
          InfiniteData<{
            comments: ProjectUpdateCommentView[];
            nextCursor: string | null;
            hasMore: boolean;
          }>
        >(commentsKey);

      let targetUserId: string | null = null;
      let targetUsername: string | null = null;

      if (parentId && previousComments) {
        const parentComment = previousComments.pages
          .flatMap((page) => page.comments)
          .find((c) => c.id === parentId);
        if (parentComment) {
          targetUserId = parentComment.userId;
          targetUsername = parentComment.author?.username ?? null;
        }
      }

      const optimistic: ProjectUpdateCommentView = {
        id: tempId,
        updateId: update.id,
        projectId,
        parentId: parentId || null,
        userId: currentUserId,
        author: {
          id: currentUserId,
          fullName: currentUserName ?? null,
          username: null,
          avatarUrl: currentUserAvatarUrl ?? null,
          roleLabel: null,
          roleTitle: null,
          membershipRoleLabel: null,
          roleSource: null,
        },
        content,
        canDelete: true,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        targetUserId,
        targetUsername,
      };
      await queryClient.cancelQueries({ queryKey: commentsKey });
      await queryClient.cancelQueries({ queryKey: updatesQueryKey });
      const previousUpdates =
        queryClient.getQueryData<InfiniteData<UpdatesPage>>(updatesQueryKey);
      queryClient.setQueryData(
        commentsKey,
        (
          existing:
            | InfiniteData<{
                comments: ProjectUpdateCommentView[];
                nextCursor: string | null;
                hasMore: boolean;
              }>
            | undefined,
        ) => {
          if (!existing)
            return {
              pages: [
                { comments: [optimistic], nextCursor: null, hasMore: false },
              ],
              pageParams: [null],
            };
          const [first, ...rest] = existing.pages;
          return first
            ? {
                ...existing,
                pages: [
                  { ...first, comments: [...first.comments, optimistic] },
                  ...rest,
                ],
              }
            : existing;
        },
      );
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? { ...item, commentCount: item.commentCount + 1 }
              : item,
          ),
      );
      return { tempId, previousComments, previousUpdates };
    },
    onError: (error, _content, context) => {
      if (context?.previousComments)
        queryClient.setQueryData(commentsKey, context.previousComments);
      if (context?.previousUpdates)
        queryClient.setQueryData(updatesQueryKey, context.previousUpdates);
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Failed to post comment", "Failed to post comment"),
      );
    },
    onSuccess: (comment, _content, context) => {
      queryClient.setQueryData(
        commentsKey,
        (
          existing:
            | InfiniteData<{
                comments: ProjectUpdateCommentView[];
                nextCursor: string | null;
                hasMore: boolean;
              }>
            | undefined,
        ) => {
          if (!existing) return existing;
          return {
            ...existing,
            pages: existing.pages.map((page) => ({
              ...page,
              comments: page.comments.map((item) =>
                item.id === context?.tempId ? comment : item,
              ),
            })),
          };
        },
      );
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const result = await deleteProjectUpdateCommentAction(
        projectId,
        commentId,
      );
      if (!result.success)
        throw new Error(result.error || "Failed to delete comment");
      return commentId;
    },
    onSuccess: (commentId) => {
      queryClient.setQueryData(
        commentsKey,
        (
          existing:
            | InfiniteData<{
                comments: ProjectUpdateCommentView[];
                nextCursor: string | null;
                hasMore: boolean;
              }>
            | undefined,
        ) => {
          if (!existing) return existing;
          return {
            ...existing,
            pages: existing.pages.map((page) => ({
              ...page,
              comments: page.comments.map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      content: "",
                      deletedAt: new Date().toISOString(),
                      canDelete: false,
                    }
                  : comment,
              ),
            })),
          };
        },
      );
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === update.id
              ? { ...item, commentCount: Math.max(0, item.commentCount - 1) }
              : item,
          ),
      );
    },
    onError: (error) =>
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Failed to delete comment", "Failed to delete comment"),
      ),
  });

  const allComments =
    comments.data?.pages.flatMap((page) => page.comments) ?? [];

  const topLevelComments = useMemo(() => allComments.filter((c) => !c.parentId), [allComments]);

  const focusedComment = useMemo(() => {
    if (!focusedCommentId) return null;
    const found = allComments.find((c) => c.id === focusedCommentId);
    return found || null;
  }, [focusedCommentId, allComments]);

  const ancestors = useMemo(() => {
    if (!focusedCommentId || !allComments.length) return [];
    const list: ProjectUpdateCommentView[] = [];
    let current = allComments.find((c) => c.id === focusedCommentId);
    while (current) {
      const pid = current.parentId;
      if (!pid) break;
      const parent = allComments.find((p) => p.id === pid);
      if (parent) {
        list.unshift(parent);
        current = parent;
      } else {
        break;
      }
    }
    return list;
  }, [focusedCommentId, allComments]);

  const childReplies = useMemo(() => {
    if (!focusedCommentId) return [];
    return allComments.filter((c) => c.parentId === focusedCommentId);
  }, [focusedCommentId, allComments]);

  const allThreadItems = useMemo(() => {
    if (!focusedComment) return [];

    const items: {
      comment: ProjectUpdateCommentView;
      isFirst: boolean;
      isLast: boolean;
      replyingTo: string | null;
      isFocused: boolean;
    }[] = [];

    const displayedAncestors = [...ancestors];
    const needsCollapse = displayedAncestors.length > 2 && !showAllAncestors;
    const root = displayedAncestors[0];
    const immediateParent = displayedAncestors[displayedAncestors.length - 1];

    if (needsCollapse && root && immediateParent) {
      items.push({
        comment: root,
        isFirst: true,
        isLast: false,
        replyingTo: null,
        isFocused: false,
      });
      const parent = allComments.find((p) => p.id === immediateParent.parentId);
      const replyingToParent = parent ? (parent.author?.username || parent.author?.fullName || "Member") : null;
      items.push({
        comment: immediateParent,
        isFirst: false,
        isLast: false,
        replyingTo: replyingToParent,
        isFocused: false,
      });
    } else {
      displayedAncestors.forEach((anc, index) => {
        const parent = allComments.find((p) => p.id === anc.parentId);
        const replyingTo = parent ? (parent.author?.username || parent.author?.fullName || "Member") : null;
        items.push({
          comment: anc,
          isFirst: index === 0,
          isLast: false,
          replyingTo,
          isFocused: false,
        });
      });
    }

    const focusedIndex = items.length;
    const parent = allComments.find((p) => p.id === focusedComment.parentId);
    const replyingToFocused = parent ? (parent.author?.username || parent.author?.fullName || "Member") : null;
    items.push({
      comment: focusedComment,
      isFirst: focusedIndex === 0,
      isLast: childReplies.length === 0,
      replyingTo: replyingToFocused,
      isFocused: true,
    });

    childReplies.forEach((reply, index) => {
      items.push({
        comment: reply,
        isFirst: false,
        isLast: index === childReplies.length - 1,
        replyingTo: focusedComment.author?.username || focusedComment.author?.fullName || "Member",
        isFocused: false,
      });
    });

    return items;
  }, [focusedComment, ancestors, showAllAncestors, childReplies, allComments]);

  const needsCollapse = ancestors.length > 2 && !showAllAncestors;

  const renderThreadComment = (
    c: ProjectUpdateCommentView,
    isFirst: boolean,
    isLast: boolean,
    replyingTo: string | null,
    isFocused: boolean = false,
  ) => {
    return (
      <div
        key={c.id}
        id={`project-update-comment-${c.id}`}
        className={cn(
          "relative flex gap-2.5 rounded-[5px] px-1 py-1 transition-colors duration-[260ms]",
          highlightedCommentId === c.id && "bg-muted/40",
        )}
      >
        <ThreadAvatarRail incoming={!isFirst} outgoing={!isLast}>
          {c.author?.username ? (
            <Link
              href={`/u/${c.author.username}`}
             
              className="nb-touch-target flex items-center justify-center shrink-0 transition-opacity hover:opacity-80 z-10 w-8 h-8"
            >
              <UserAvatar
                identity={{
                  fullName: c.author.fullName ?? c.author.username ?? "Member",
                  username: c.author.username,
                  avatarUrl: c.author.avatarUrl ?? null,
                }}
                size={32}
              />
            </Link>
          ) : (
            <div className="flex items-center justify-center shrink-0 w-8 h-8 z-10">
              <UserAvatar
                identity={{
                  fullName: c.author?.fullName ?? c.author?.username ?? "Member",
                  username: c.author?.username ?? null,
                  avatarUrl: c.author?.avatarUrl ?? null,
                }}
                size={32}
              />
            </div>
          )}
        </ThreadAvatarRail>

        {/* Comment Content Column */}
        <div className="min-w-0 flex-1 pt-0.5">
          <div
            className={cn(
              "rounded-[5px] transition-colors duration-[180ms]",
              isFocused
                ? "bg-muted/30 px-2 py-1"
                : "px-0 py-0"
            )}
          >
            {c.deletedAt ? (
              <p className="text-sm italic text-muted-foreground">This comment was removed.</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {/* Name & Role in Same Line */}
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] leading-4">
                      <span className="font-semibold text-foreground">
                        {c.author?.username ? (
                          <Link
                            href={`/u/${c.author.username}`}
                           
                            className="hover:underline"
                          >
                            {c.author.fullName || c.author.username}
                          </Link>
                        ) : (
                          c.author?.fullName || c.author?.username || "Former member"
                        )}
                      </span>
                      {c.author?.roleLabel && (
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {c.author.roleLabel}
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-muted-foreground">
                        · {updateRelativeTime(c.createdAt)}
                      </span>
                    </div>

                    {/* Replying to username underneath */}
                    {replyingTo && (
                      <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] leading-4 text-muted-foreground">
                        <CornerDownRight className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                        <span>
                          Replying to{" "}
                          <button
                            type="button"
                            onClick={() => setFocusedCommentId(c.parentId!)}
                            className="font-mono font-medium text-foreground hover:underline text-left"
                          >
                            @{replyingTo}
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                  {c.canDelete ? (
                    <button
                      type="button"
                      onClick={() => deleteCommentMutation.mutate(c.id)}
                      className="nb-touch-target ml-2 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete comment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : currentUserId ? (
                    <ReportButton kind="update_comment" targetId={c.id} noun="comment" className="nb-touch-target ml-2 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Flag className="h-3.5 w-3.5" aria-label="Report comment" /></ReportButton>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-foreground/90">
                  {renderCommentContent(c.content)}
                </p>
              </>
            )}
          </div>

          {/* Action trigger button */}
          {!c.deletedAt && !isFocused && (
            <div className="mt-2 flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setFocusedCommentId(c.id)}
                className="inline-flex items-center gap-1 rounded-[4px] border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
              >
                <span>View conversation</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!highlightedCommentId) return;
    if (!allComments.some((comment) => comment.id === highlightedCommentId))
      return;
    requestAnimationFrame(() => {
      document
        .getElementById(`project-update-comment-${highlightedCommentId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [allComments, highlightedCommentId]);

  return (
    <div ref={sectionRef} className="mt-2 flex min-h-0 flex-col border-t border-border/70 pt-2.5">
      {focusedComment ? (
        <div className="flex flex-col min-h-0">
          <button
            type="button"
            onClick={() => {
              setFocusedCommentId(null);
              setShowAllAncestors(false);
            }}
            className="mb-2 flex w-fit items-center gap-1.5 self-start font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to all comments
          </button>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
            {allThreadItems.map((item, idx) => {
              const c = item.comment;

              if (needsCollapse && idx === 1) {
                return (
                  <Fragment key={`thread-group-${c.id}`}>
                    {/* Collapse Card */}
                    <div key="collapse-spacer" className="relative flex gap-2.5 px-1 py-0.5">
                      <ThreadRailBridge />
                      <div className="flex flex-1 items-center py-0.5">
                        <button
                          type="button"
                          onClick={() => setShowAllAncestors(true)}
                          className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:underline transition-colors text-left"
                        >
                          Show {ancestors.length - 2} replies
                        </button>
                      </div>
                    </div>

                    {/* Immediate Parent Comment */}
                    {renderThreadComment(
                      c,
                      item.isFirst,
                      item.isLast,
                      item.replyingTo,
                      item.isFocused,
                    )}
                  </Fragment>
                );
              }

              return (
                <Fragment key={c.id}>
                  {renderThreadComment(
                    c,
                    item.isFirst,
                    item.isLast,
                    item.replyingTo,
                    item.isFocused,
                  )}
                  {item.isFocused && currentUserId && update.canComment && (
                    <div className="mb-1.5 mt-1.5 flex shrink-0 gap-2 pl-10">
                      <UserAvatar
                        identity={{
                          fullName: currentUserName ?? "You",
                          avatarUrl: currentUserAvatarUrl ?? null,
                        }}
                        size={24}
                        className="mt-0.5 shrink-0 rounded-[5px]"
                      />
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-border bg-card px-2.5 py-0.5 shadow-2xs">
                        <input
                          autoFocus
                          value={focusedReplyDraft}
                          onChange={(e) => setFocusedReplyDraft(e.target.value.slice(0, 1000))}
                          placeholder={`Reply to ${
                            c.author?.fullName || c.author?.username || "comment"
                          }...`}
                          className="nb-touch-target h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              const val = focusedReplyDraft.trim();
                              if (!val) return;
                              commentMutation.mutate({ content: val, parentId: focusedCommentId });
                              setFocusedReplyDraft("");
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={!focusedReplyDraft.trim()}
                          onClick={() => {
                            const val = focusedReplyDraft.trim();
                            if (!val) return;
                            commentMutation.mutate({ content: val, parentId: focusedCommentId });
                            setFocusedReplyDraft("");
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-[3px] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          <Send className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {currentUserId && update.canComment ? (
            <div className="mb-2 flex shrink-0 gap-2">
              <UserAvatar
                identity={{
                  fullName: currentUserName ?? "You",
                  avatarUrl: currentUserAvatarUrl ?? null,
                }}
                size={28}
                className="mt-0.5 shrink-0 rounded-[5px]"
              />
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-border bg-card px-2.5 shadow-2xs">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 1_000))}
                  placeholder="Write a comment..."
                  className="nb-touch-target h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const value = draft.trim();
                      if (!value) return;
                      setDraft("");
                      commentMutation.mutate({ content: value, parentId: null });
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!draft.trim() || commentMutation.isPending}
                  onClick={() => {
                    const value = draft.trim();
                    if (!value) return;
                    setDraft("");
                    commentMutation.mutate({ content: value, parentId: null });
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-[3px] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                  aria-label="Post comment"
                >
                  {commentMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {comments.isLoading ? (
            <div aria-hidden="true" className="nb-skeleton h-8 shrink-0 rounded-[5px]" />
          ) : topLevelComments.length > 0 ? (
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {topLevelComments.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  allComments={allComments}
                  highlightedCommentId={highlightedCommentId}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  currentUserAvatarUrl={currentUserAvatarUrl}
                  onReply={(parentId, content) => commentMutation.mutate({ content, parentId })}
                  onDelete={(commentId) => deleteCommentMutation.mutate(commentId)}
                  onFocusComment={setFocusedCommentId}
                />
              ))}
              {comments.hasNextPage ? (
                <div className="pb-4 pt-1">
                  <button
                    type="button"
                    onClick={() => comments.fetchNextPage()}
                    className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Load more comments
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="py-2 text-center text-xs text-muted-foreground">No comments yet.</p>
          )}
        </>
      )}
    </div>
  );
}
