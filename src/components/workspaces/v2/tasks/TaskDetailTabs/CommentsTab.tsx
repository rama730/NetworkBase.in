"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/utils/date";
import {
  ArrowLeft,
  ArrowUpDown,
  Check,
  Copy,
  CornerDownRight,
  Link as LinkIcon,
  MessageSquare,
  MoreHorizontal,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { LikeHeart } from "@/components/ui/LikeHeart";
import { ReportDialog, ReportMenuItem } from "@/components/reports/ReportDialog";
import { ModeratedPlaceholder, useModeratedItems } from "@/components/reports/ModeratedPlaceholder";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ThreadAvatarRail, ThreadRailBridge } from "@/components/ui/ThreadRail";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  TaskDiscussionComment,
  TaskDiscussionReply,
  TaskDiscussionTypingUser,
} from "@/lib/workspaces/task-discussion";
import { cn } from "@/lib/utils";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

import MentionComposer, { type MentionComposerHandle } from "../components/MentionComposer";
import CommentBody from "../components/CommentBody";
import { ViaLabel } from "@/components/ui/via-label";
import { readSessionDraft, sessionDraftStore, useSessionDraft } from "@/hooks/useSessionDraft";
import { copyOrSay } from "@/lib/clipboard";

type CommentMutationResult = { success: boolean; error?: string };
type PresenceStatus = "connecting" | "connected" | "disconnected" | "error";

interface CommentsTabProps {
  projectId: string;
  /** For hidden or removed comments shown in place (trust and safety §7.1). */
  taskId?: string;
  comments: TaskDiscussionComment[];
  totalCount: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  canEdit: boolean;
  currentUserId?: string;
  currentUser?: {
    fullName?: string | null;
    avatarUrl?: string | null;
    username?: string | null;
  } | null;
  members?: any[];
  presenceStatus: PresenceStatus;
  topLevelTypingUsers: TaskDiscussionTypingUser[];
  replyTypingUsersByParentId: Record<string, TaskDiscussionTypingUser[]>;
  onAddComment: (content: string, parentCommentId?: string | null) => Promise<CommentMutationResult>;
  onToggleLike: (commentId: string) => Promise<CommentMutationResult>;
  onDeleteComment: (commentId: string) => Promise<CommentMutationResult>;
  onLoadOlderComments: () => Promise<void>;
  onSendTyping: (params: { isTyping: boolean; parentCommentId?: string | null }) => Promise<void>;
  initialCommentId?: string | null;
  /** Review queue §3: the review column's chat layout — heading first, the thread scrolling, the box at the bottom. */
  chat?: boolean;
  placeholder?: string;
  /** Review queue §4b.4: quiet lines in the thread (handed in, returned, approved), placed by time. */
  events?: Array<{ id: string; at: string; text: string }>;
  /** A message to put back in the box (a note that didn't send); `key` changes each time. */
  restoreDraft?: { text: string; key: number } | null;
}

function displayName(comment: Pick<TaskDiscussionComment, "author">) {
  return comment.author?.fullName || comment.author?.username || "Unknown";
}

function timeAgo(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function typingLabel(users: TaskDiscussionTypingUser[], reply = false) {
  if (users.length === 0) return null;
  const names = users.map((user) => user.fullName || user.username || "Someone");
  const subject = names.length > 2
    ? `${names[0]} and ${names.length - 1} others`
    : new Intl.ListFormat("en").format(names);
  return `${subject} ${names.length === 1 ? "is" : "are"} typing${reply ? " a reply" : ""}…`;
}

function DiscussionEntry({
  entry,
  replyTo,
  roleLabel,
  memberNames,
  currentUserId,
  canEdit,
  pendingDelete,
  pendingLike,
  highlighted,
  incoming,
  outgoing,
  showReply,
  showThread,
  children,
  onDelete,
  onToggleLike,
  onReply,
  onShowThread,
}: {
  entry: TaskDiscussionComment | TaskDiscussionComment["replies"][number];
  replyTo?: string | null;
  roleLabel?: string | null;
  memberNames?: ReadonlyMap<string, string>;
  currentUserId?: string;
  canEdit: boolean;
  pendingDelete: boolean;
  pendingLike: boolean;
  highlighted: boolean;
  incoming: boolean;
  outgoing: boolean;
  showReply: boolean;
  showThread: boolean;
  children?: React.ReactNode;
  onDelete: () => void;
  onToggleLike: () => void;
  onReply: () => void;
  onShowThread: () => void;
}) {
  const deleted = Boolean(entry.deletedAt);
  const name = displayName(entry);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reporting, setReporting] = useState(false);

  const handleCopyLink = () => {
    if (typeof window === "undefined") return;
    // The open drawer already carries drawerType/drawerId in the URL; point it at this comment.
    const url = new URL(window.location.href);
    url.searchParams.set("panelTab", "comments");
    url.searchParams.set("commentId", entry.id);
    copyOrSay(url.toString(), () => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleCopyText = () => {
    if (typeof window === "undefined") return;
    copyOrSay(entry.content, () => {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    });
  };

  return (
    <div
      id={`task-comment-${entry.id}`}
      className={cn(
        "group relative flex gap-2.5 rounded-[5px] px-2 py-1.5 transition-colors duration-[180ms] hover:bg-muted/25",
        highlighted && "border border-primary/30 bg-primary/5",
      )}
    >
      <ThreadAvatarRail incoming={incoming} outgoing={outgoing}>
        {entry.author?.username ? (
          <Link
            href={`/u/${entry.author.username}`}
           
            className="flex items-center justify-center shrink-0 transition-opacity hover:opacity-80"
          >
            <UserAvatar
              identity={{
                fullName: name,
                username: entry.author.username,
                avatarUrl: entry.author?.avatarUrl ?? null,
              }}
              size={replyTo ? 28 : 32}
            />
          </Link>
        ) : (
          <div className="flex items-center justify-center shrink-0">
            <UserAvatar
              identity={{
                fullName: name,
                username: entry.author?.username,
                avatarUrl: entry.author?.avatarUrl ?? null,
              }}
              size={replyTo ? 28 : 32}
            />
          </div>
        )}
      </ThreadAvatarRail>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] leading-4">
              <span className="font-semibold text-foreground">
                {entry.author?.username ? (
                  <Link
                    href={`/u/${entry.author.username}`}
                   
                    className="hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </span>
              {roleLabel && (
                <span
                  className="truncate max-w-[140px] font-mono text-[11px] text-muted-foreground"
                  title={roleLabel}
                >
                  {roleLabel}
                </span>
              )}
              <ViaLabel via={entry.via} agentName={entry.agentName} />
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                · {timeAgo(entry.createdAt)}
              </span>
              {entry.pending ? (
                <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sending…
                </span>
              ) : null}
            </div>
            {replyTo ? (
              <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] leading-4 text-muted-foreground">
                <CornerDownRight className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                <span>
                  Replying to <span className="font-medium text-primary">@{replyTo}</span>
                </span>
              </div>
            ) : null}
          </div>
          {!deleted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="nb-touch-target flex size-7 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Comment options"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-[5px] p-1 font-mono text-xs">
                <DropdownMenuItem
                  onClick={handleCopyLink}
                  className="flex cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1 text-xs"
                >
                  {copiedLink ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <LinkIcon className="size-3.5" />
                  )}
                  <span>{copiedLink ? "Link copied" : "Copy link"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleCopyText}
                  className="flex cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1 text-xs"
                >
                  {copiedText ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  <span>{copiedText ? "Text copied" : "Copy text"}</span>
                </DropdownMenuItem>
                {/* Only the author can delete (the server enforces the same), after a confirm. */}
                {currentUserId === entry.userId ? (
                  <DropdownMenuItem
                    onClick={() => setConfirmingDelete(true)}
                    disabled={pendingDelete}
                    className="flex cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1 text-xs text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive"
                  >
                    {pendingDelete ? (
                      <PixelBeat />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    <span>Delete</span>
                  </DropdownMenuItem>
                ) : currentUserId ? (
                  <ReportMenuItem first noun="comment" target={{ kind: "task_comment", targetId: entry.id }} onReport={() => setReporting(true)} />
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {reporting ? <ReportDialog kind="task_comment" targetId={entry.id} noun="comment" open={reporting} onOpenChange={setReporting} /> : null}
        <ConfirmDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title="Delete this comment?"
          description="It is replaced with “This comment was removed.” for everyone."
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
          }}
        />

        {deleted ? (
          <p className="mt-1 text-sm italic text-muted-foreground">
            This comment was removed.
          </p>
        ) : (
          <CommentBody
            content={entry.content}
            viewerUserId={currentUserId}
            memberNames={memberNames}
            className="mt-1 text-[13px] leading-5 text-foreground/90"
          />
        )}

        {!deleted ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium leading-4 pt-0.5">
            <button
              type="button"
              onClick={onToggleLike}
              disabled={!canEdit || pendingLike}
              className={cn(
                "inline-flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                entry.likedByViewer
                  ? "text-[var(--like)]"
                  : "text-muted-foreground hover:text-[var(--like)]",
              )}
              aria-label={entry.likedByViewer ? "Remove like" : "Like comment"}
            >
              {pendingLike ? (
                <PixelBeat />
              ) : (
                <LikeHeart liked={entry.likedByViewer} className="h-3.5 w-3.5" />
              )}
              {entry.likeCount > 0 ? (
                <span className="font-mono">{entry.likeCount}</span>
              ) : (
                "Like"
              )}
            </button>
            {showReply && canEdit ? (
              <button
                type="button"
                onClick={onReply}
                className="inline-flex items-center gap-1 rounded-[4px] border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
              >
                <CornerDownRight className="h-3 w-3" />
                <span>Reply</span>
              </button>
            ) : null}
            {showThread ? (
              <button
                type="button"
                onClick={onShowThread}
                className="inline-flex items-center gap-1 rounded-[4px] border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
              >
                <span>View conversation</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {children}
      </div>
    </div>
  );
}

export default function CommentsTab({
  projectId,
  taskId,
  comments,
  totalCount,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  canEdit,
  currentUserId,
  currentUser = null,
  members = [],
  presenceStatus,
  topLevelTypingUsers,
  replyTypingUsersByParentId,
  onAddComment,
  onToggleLike,
  onDeleteComment,
  onLoadOlderComments,
  onSendTyping,
  initialCommentId = null,
  chat = false,
  placeholder,
  events = [],
  restoreDraft = null,
}: CommentsTabProps) {
  // Comments hidden or removed by moderation, above the discussion (trust and safety §7.1).
  const moderated = useModeratedItems(currentUserId && taskId ? { workspaceId: projectId } : null);
  const moderatedComments = moderated.filter((m) => m.kind === "task_comment" && m.parentId === taskId);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [activeReplyTarget, setActiveReplyTarget] = useState<{
    parentCommentId: string;
    targetCommentId: string;
    replyToName: string;
  } | null>(null);
  // Half-typed text survives leaving the page (unified back B12); cleared on send or cancel.
  const rootDraftKey = taskId ? `draft:task-comment:${taskId}` : null;
  const replyDraftKey = taskId && activeReplyTarget
    ? `draft:task-comment:${taskId}:reply:${activeReplyTarget.targetCommentId}`
    : null;
  const [draft, setDraft] = useSessionDraft(rootDraftKey);
  const [replyDraft, setReplyDraft] = useSessionDraft(replyDraftKey);
  const [expandedCommentIds, setExpandedCommentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Record<string, boolean>>({});
  const [pendingLikeIds, setPendingLikeIds] = useState<Record<string, boolean>>({});
  const [submittingRoot, setSubmittingRoot] = useState(false);
  const [submittingReplyParentId, setSubmittingReplyParentId] = useState<string | null>(null);
  const [rootResetKey, setRootResetKey] = useState(0);
  const [replyResetKey, setReplyResetKey] = useState(0);
  const [showPresenceIssue, setShowPresenceIssue] = useState(false);
  const [, setRelativeTimeTick] = useState(0);
  const rootTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootComposerRef = useRef<MentionComposerHandle | null>(null);
  const replyComposerRef = useRef<MentionComposerHandle | null>(null);
  const typingStateRef = useRef(new Map<string, boolean>());
  const initialCommentLoadAttemptsRef = useRef(0);

  const toggleExpanded = useCallback((commentId: string) => {
    setExpandedCommentIds((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  }, []);

  useEffect(() => () => {
    if (rootTypingTimerRef.current) clearTimeout(rootTypingTimerRef.current);
    if (replyTypingTimerRef.current) clearTimeout(replyTypingTimerRef.current);
  }, []);

  useEffect(() => {
    const cleanup = createVisibilityAwareInterval(() => {
      setRelativeTimeTick((tick) => tick + 1);
    }, 60_000);
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (presenceStatus === "connected" || presenceStatus === "connecting") {
      setShowPresenceIssue(false);
      return;
    }
    const timer = window.setTimeout(() => setShowPresenceIssue(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [presenceStatus]);

  useEffect(() => {
    if (!initialCommentId || isLoading) return;
    document.getElementById(`task-comment-${initialCommentId}`)?.scrollIntoView({ block: "center" });
  }, [comments, initialCommentId, isLoading]);

  const initialCommentFound = useMemo(
    () =>
      !initialCommentId ||
      comments.some(
        (comment) =>
          comment.id === initialCommentId ||
          comment.replies.some((reply) => reply.id === initialCommentId),
      ),
    [comments, initialCommentId],
  );

  useEffect(() => {
    initialCommentLoadAttemptsRef.current = 0;
  }, [initialCommentId]);

  useEffect(() => {
    if (
      initialCommentFound ||
      !initialCommentId ||
      !hasMore ||
      isLoading ||
      isLoadingMore ||
      initialCommentLoadAttemptsRef.current >= 20
    ) {
      return;
    }
    initialCommentLoadAttemptsRef.current += 1;
    void onLoadOlderComments();
  }, [
    hasMore,
    initialCommentFound,
    initialCommentId,
    isLoading,
    isLoadingMore,
    onLoadOlderComments,
  ]);

  const memberRoleMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!Array.isArray(members)) return map;
    for (const m of members) {
      const role =
        m?.roleTitle ||
        m?.roleLabel ||
        m?.membershipRole ||
        m?.role ||
        m?.user?.roleTitle ||
        m?.user?.roleLabel;
      if (role && typeof role === "string") {
        const id = m?.userId || m?.user_id || m?.id || m?.user?.id;
        if (id) map.set(id, role);
        if (m?.username) map.set(m.username, role);
        if (m?.user?.username) map.set(m.user.username, role);
      }
    }
    return map;
  }, [members]);

  // Mention chips show the member's current name, never the name stored in the token.
  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of Array.isArray(members) ? members : []) {
      const id = m?.userId || m?.user_id || m?.user?.id || m?.id;
      const name = m?.fullName || m?.user?.fullName || m?.username || m?.user?.username;
      if (typeof id === "string" && typeof name === "string" && name) map.set(id, name);
    }
    return map;
  }, [members]);

  const currentUserRole = useMemo(() => {
    if (!currentUserId && !currentUser?.username) return null;
    return (
      (currentUserId ? memberRoleMap.get(currentUserId) : null) ||
      (currentUser?.username ? memberRoleMap.get(currentUser.username) : null) ||
      null
    );
  }, [currentUserId, currentUser, memberRoleMap]);

  const focusedThread = useMemo(() => {
    if (!focusedCommentId) return null;
    const root = comments.find((comment) => comment.id === focusedCommentId)
      ?? comments.find((comment) => comment.replies.some((reply) => reply.id === focusedCommentId));
    return root ?? null;
  }, [comments, focusedCommentId]);

  const visibleComments = focusedThread ? [focusedThread] : comments;

  const sortedVisibleComments = useMemo(() => {
    return [...visibleComments].sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return sortOrder === "asc" ? timeA - timeB : timeB - timeA;
    });
  }, [visibleComments, sortOrder]);
  // Comments and the quiet decision lines, in one order.
  const timelineItems = useMemo(() => {
    const items: Array<{ kind: "comment"; at: number; comment: TaskDiscussionComment } | { kind: "event"; at: number; event: { id: string; at: string; text: string } }> = [
      ...sortedVisibleComments.map((comment) => ({ kind: "comment" as const, at: new Date(comment.createdAt).getTime(), comment })),
      ...events.map((event) => ({ kind: "event" as const, at: new Date(event.at).getTime(), event })),
    ];
    return items.sort((a, b) => (sortOrder === "asc" ? a.at - b.at : b.at - a.at));
  }, [events, sortedVisibleComments, sortOrder]);
  useEffect(() => {
    if (restoreDraft?.text) rootComposerRef.current?.setText(restoreDraft.text);
  }, [restoreDraft?.key, restoreDraft?.text]);
  // The composers hold their own text, so a saved draft is pushed into them once per key.
  useEffect(() => {
    const saved = rootDraftKey && readSessionDraft(sessionDraftStore, rootDraftKey);
    if (saved) rootComposerRef.current?.setText(saved);
  }, [rootDraftKey]);
  useEffect(() => {
    const saved = replyDraftKey && readSessionDraft(sessionDraftStore, replyDraftKey);
    if (saved) replyComposerRef.current?.setText(saved);
  }, [replyDraftKey]);

  const topLevelTyping = useMemo(() => typingLabel(topLevelTypingUsers), [topLevelTypingUsers]);

  useEffect(() => {
    if (initialCommentId || focusedCommentId) {
      const targetId = focusedCommentId || initialCommentId;
      const parent = comments.find((c) =>
        c.replies?.some((r) => r.id === targetId),
      );
      if (parent) {
        setExpandedCommentIds((prev) => new Set(prev).add(parent.id));
      }
    }
  }, [initialCommentId, focusedCommentId, comments]);

  const scheduleTypingStop = useCallback((parentCommentId?: string | null) => {
    const timerRef = parentCommentId ? replyTypingTimerRef : rootTypingTimerRef;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      typingStateRef.current.set(parentCommentId ?? "root", false);
      void onSendTyping({ isTyping: false, parentCommentId: parentCommentId ?? null });
    }, 1_800);
  }, [onSendTyping]);

  const handleDraftChange = (value: string, parentCommentId?: string | null) => {
    if (parentCommentId) setReplyDraft(value); else setDraft(value);
    setComposerError(null);
    const isTyping = value.trim().length > 0;
    const typingKey = parentCommentId ?? "root";
    if (typingStateRef.current.get(typingKey) !== isTyping) {
      typingStateRef.current.set(typingKey, isTyping);
      void onSendTyping({ isTyping, parentCommentId: parentCommentId ?? null });
    }
    if (!isTyping) {
      const timerRef = parentCommentId ? replyTypingTimerRef : rootTypingTimerRef;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    scheduleTypingStop(parentCommentId);
  };

  const submit = async (parentCommentId?: string | null) => {
    const value = (parentCommentId ? replyDraft : draft).trim();
    if (!value || !canEdit || submittingRoot || submittingReplyParentId) return;
    if (parentCommentId) setSubmittingReplyParentId(parentCommentId); else setSubmittingRoot(true);
    setComposerError(null);
    try {
      const result = await onAddComment(value, parentCommentId ?? null);
      if (result.success) {
        const timerRef = parentCommentId ? replyTypingTimerRef : rootTypingTimerRef;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        typingStateRef.current.set(parentCommentId ?? "root", false);
        if (parentCommentId) {
          setReplyDraft("");
          setReplyResetKey((key) => key + 1);
          setActiveReplyTarget(null);
          setExpandedCommentIds((prev) => new Set(prev).add(parentCommentId));
        } else {
          setDraft("");
          setRootResetKey((key) => key + 1);
        }
        void onSendTyping({ isTyping: false, parentCommentId: parentCommentId ?? null });
      } else {
        setComposerError(result.error || "Couldn’t post comment. Retry.");
      }
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "Couldn’t post comment. Retry.",
      );
    } finally {
      if (parentCommentId) setSubmittingReplyParentId(null); else setSubmittingRoot(false);
    }
  };

  const runPending = useCallback(async (
    type: "delete" | "like",
    id: string,
    action: () => Promise<CommentMutationResult>,
    fallback: string,
  ) => {
    const setPending = type === "delete" ? setPendingDeleteIds : setPendingLikeIds;
    setPending((current) => ({ ...current, [id]: true }));
    try {
      const result = await action();
      if (!result.success) setComposerError(result.error || fallback);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : fallback);
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }, []);

  const handleClearRootDraft = () => {
    setDraft("");
    setRootResetKey((k) => k + 1);
    if (rootTypingTimerRef.current) {
      clearTimeout(rootTypingTimerRef.current);
      rootTypingTimerRef.current = null;
    }
    typingStateRef.current.set("root", false);
    void onSendTyping({ isTyping: false });
  };

  const closeReply = () => {
    if (activeReplyTarget) {
      typingStateRef.current.set(activeReplyTarget.parentCommentId, false);
      void onSendTyping({
        isTyping: false,
        parentCommentId: activeReplyTarget.parentCommentId,
      });
    }
    if (replyTypingTimerRef.current) {
      clearTimeout(replyTypingTimerRef.current);
      replyTypingTimerRef.current = null;
    }
    setReplyDraft("");
    setReplyResetKey((key) => key + 1);
    setActiveReplyTarget(null);
  };

  const openReply = (
    parentCommentId: string,
    targetCommentId: string,
    replyToName: string,
  ) => {
    if (activeReplyTarget?.targetCommentId === targetCommentId) {
      closeReply();
      return;
    }
    closeReply();
    setComposerError(null);
    setActiveReplyTarget({ parentCommentId, targetCommentId, replyToName });
  };

  return (
    <div className={chat ? "flex h-full min-h-0 flex-col gap-3" : "space-y-4 p-6 max-md:p-4"}>
      {focusedThread ? (
        <button
          type="button"
          onClick={() => setFocusedCommentId(null)}
          className="flex w-fit items-center gap-1.5 self-start font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to all comments</span>
        </button>
      ) : null}

      {error || composerError ? (
        <div
          role="alert"
          className="rounded-[5px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {composerError || error}
        </div>
      ) : null}

      {showPresenceIssue ? (
        <p className="text-xs text-amber-600 dark:text-amber-400 font-mono">
          Reconnecting… You can still post comments.
        </p>
      ) : null}

      {!focusedThread && canEdit ? (
        <div className={cn("space-y-2 pb-1", chat && "order-last shrink-0 pb-0")}>
          {topLevelTyping ? (
            <p className="text-xs text-muted-foreground font-mono">
              {topLevelTyping}
            </p>
          ) : null}
          <div className="group rounded-[6px] border border-border bg-card/70 shadow-2xs transition-all duration-200 focus-within:border-foreground/40 focus-within:bg-card focus-within:shadow-xs">
            {/* Identity & Format Header */}
            <div className={cn("flex items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-2 rounded-t-[5px]", chat && "hidden")}>
              <div className="flex items-center gap-2">
                <UserAvatar
                  identity={{
                    fullName: currentUser?.fullName ?? "You",
                    avatarUrl: currentUser?.avatarUrl ?? null,
                    username: currentUser?.username ?? null,
                  }}
                  size={20}
                  className="rounded-[4px] shrink-0"
                />
                <span className="text-[12px] font-medium text-foreground">
                  {currentUser?.fullName ?? "You"}
                </span>
                {currentUserRole ? (
                  <span className="font-mono text-[10px] max-md:text-[11px] text-muted-foreground uppercase tracking-wider">
                    · {currentUserRole}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Multiline MentionComposer */}
            <div className="p-1">
              <MentionComposer
                ref={rootComposerRef}
                projectId={projectId}
                placeholder={placeholder ?? "Write a comment, use @ to mention teammates…"}
                disabled={submittingRoot}
                resetKey={rootResetKey}
                editorClassName="min-h-[76px] border-0 bg-transparent px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none shadow-none focus:border-0 focus:ring-0 placeholder:text-muted-foreground/70"
                onDraftChange={(value) => handleDraftChange(value)}
                onSubmit={() => void submit()}
                aria-label="Add a comment"
              />
            </div>

            {/* Utility & Action Footer */}
            <div className="flex items-center justify-between border-t border-border/40 bg-muted/10 px-3 py-2 rounded-b-[5px]">
              <div className="flex items-center gap-2 text-muted-foreground">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => rootComposerRef.current?.triggerMention()}
                  className="inline-flex items-center gap-1 rounded-[3px] border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground transition hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                  title="Mention teammates"
                >
                  <span className="font-semibold text-primary">@</span>
                  <span>Mention</span>
                </button>
                <span className={cn("hidden items-center gap-1 font-mono text-[11px] text-muted-foreground", !chat && "sm:inline-flex")}>
                  <span>Press</span>
                  <kbd className="rounded-[3px] border border-border bg-background px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-medium text-foreground">
                    ⌘↵
                  </kbd>
                  <span>to post</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {draft.trim() ? (
                  <button
                    type="button"
                    onClick={handleClearRootDraft}
                    disabled={submittingRoot}
                    className="nb-touch-target h-[28px] rounded-[5px] px-2.5 font-mono text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    Clear
                  </button>
                ) : null}
                <Button pending={submittingRoot}
                  type="button"
                  size="sm"
                  onClick={() => void submit()}
                  disabled={!draft.trim() || submittingRoot}
                  className="nb-touch-target h-[28px] gap-1.5 rounded-[5px] px-3.5 text-[12px] font-medium shadow-xs disabled:opacity-40"
                  aria-label="Post comment"
                  title="⌘↵"
                >
                  <Send className="size-3.5" />
                  <span>{chat ? "Send" : "Comment"}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!focusedThread ? (
        <div className={cn("flex items-center justify-between border-b border-border/60 pb-3", chat && "order-first h-6 shrink-0 border-0 pb-0")}>
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Discussion
            </h3>
            <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground">
              {totalCount}
            </span>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            {hasMore ? (
              <button
                type="button"
                onClick={() => void onLoadOlderComments()}
                disabled={isLoadingMore}
                className="font-medium text-primary hover:underline disabled:opacity-60"
              >
                {isLoadingMore ? <><PixelBeat />Loading…</> : "Load older"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
              }
              className="inline-flex items-center gap-1 rounded-[3px] border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground"
              title="Toggle comment order"
            >
              <ArrowUpDown className="size-3" />
              <span>{sortOrder === "asc" ? "Oldest" : "Newest"}</span>
            </button>
          </div>
        </div>
      ) : null}

      {moderatedComments.length ? (
        <div className="mb-3 space-y-1.5">
          {moderatedComments.map((item) => <ModeratedPlaceholder key={item.targetId} item={item} noun="comment" />)}
        </div>
      ) : null}

      <div className={chat ? "min-h-0 flex-1 overflow-y-auto pr-1" : "contents"}>
      {isLoading ? (
        <div className="space-y-3 py-2">
          <div aria-hidden="true" className="nb-skeleton h-12 rounded-md" />
          <div aria-hidden="true" className="nb-skeleton h-12 rounded-md" />
        </div>
      ) : timelineItems.length === 0 && !moderatedComments.length ? (
        <div className="nb-empty-state nb-grid-ground my-4 py-12 text-center" role="status">
          <div className="nb-empty-state-icon-box">
            <MessageSquare className="nb-empty-state-icon" />
          </div>
          <h4 className="nb-empty-state-title">No comments yet</h4>
          <p className="nb-empty-state-desc">
            {canEdit
              ? "Start the conversation for this task."
              : "No comments have been posted yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {timelineItems.map((item) => {
            if (item.kind === "event") {
              return (
                <p key={item.event.id} role="note" className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <span aria-hidden="true" className="h-px w-3 shrink-0 bg-border" />
                  <span className="min-w-0">{item.event.text} · {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(item.event.at))}</span>
                </p>
              );
            }
            const comment = item.comment;
            const replies = comment.replies || [];
            const isExpanded = expandedCommentIds.has(comment.id);
            const needsCollapse = replies.length > 2 && !isExpanded;

            type ThreadRow =
              | { type: "root"; entry: TaskDiscussionComment }
              | { type: "spacer"; hiddenCount: number }
              | { type: "reply"; entry: TaskDiscussionReply };

            const threadRows: ThreadRow[] = [{ type: "root", entry: comment }];

            if (replies.length > 0) {
              if (needsCollapse) {
                threadRows.push({
                  type: "spacer",
                  hiddenCount: replies.length - 1,
                });
                threadRows.push({
                  type: "reply",
                  entry: replies[replies.length - 1]!,
                });
              } else {
                for (const reply of replies) {
                  threadRows.push({ type: "reply", entry: reply });
                }
              }
            }

            const replyTyping = typingLabel(
              replyTypingUsersByParentId[comment.id] ?? [],
              true,
            );

            return (
              <div key={comment.id} className="space-y-0.5">
                {threadRows.map((row, rowIdx) => {
                  if (row.type === "spacer") {
                    return (
                      <div
                        key={`spacer-${comment.id}`}
                        className="relative flex gap-2.5 px-1 py-0.5"
                      >
                        <ThreadRailBridge />
                        <div className="flex flex-1 items-center py-0.5">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(comment.id)}
                            className="inline-flex items-center gap-1.5 rounded-[3px] border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted hover:text-foreground text-left"
                          >
                            + {row.hiddenCount}{" "}
                            {row.hiddenCount === 1 ? "reply" : "replies"}
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const isFirst = rowIdx === 0;
                  const isLast = rowIdx === threadRows.length - 1;
                  const entry = row.entry;
                  const isReply = row.type === "reply";
                  const isReplyingHere =
                    activeReplyTarget?.targetCommentId === entry.id;
                  const roleLabel =
                    memberRoleMap.get(entry.userId ?? "") ||
                    memberRoleMap.get(entry.author?.id ?? "") ||
                    (entry.author?.username
                      ? memberRoleMap.get(entry.author.username)
                      : null);

                  return (
                    <DiscussionEntry
                      key={entry.id}
                      entry={entry}
                      replyTo={isReply ? displayName(comment) : null}
                      roleLabel={roleLabel}
                      memberNames={memberNames}
                      currentUserId={currentUserId}
                      canEdit={canEdit}
                      pendingDelete={pendingDeleteIds[entry.id] === true}
                      pendingLike={pendingLikeIds[entry.id] === true}
                      highlighted={
                        focusedCommentId === entry.id ||
                        initialCommentId === entry.id
                      }
                      incoming={!isFirst}
                      outgoing={!isLast}
                      showReply={canEdit}
                      showThread={!isReply && !focusedThread && replies.length > 0}
                      onDelete={() =>
                        void runPending(
                          "delete",
                          entry.id,
                          () => onDeleteComment(entry.id),
                          "Couldn’t delete comment.",
                        )
                      }
                      onToggleLike={() =>
                        void runPending(
                          "like",
                          entry.id,
                          () => onToggleLike(entry.id),
                          "Couldn’t update the like.",
                        )
                      }
                      onReply={() =>
                        openReply(
                          comment.id,
                          entry.id,
                          entry.author?.fullName ||
                            entry.author?.username ||
                            displayName(entry),
                        )
                      }
                      onShowThread={() => setFocusedCommentId(comment.id)}
                    >
                      {isReplyingHere && activeReplyTarget ? (
                        <div className="relative z-30 mt-2.5 overflow-visible rounded-[6px] border border-border/80 bg-card shadow-2xs transition-all focus-within:border-foreground/40">
                          {/* Reply Header */}
                          <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground font-mono">
                            <div className="flex items-center gap-1.5">
                              <CornerDownRight className="size-3 text-primary shrink-0" />
                              <span>
                                Replying to{" "}
                                <strong className="font-semibold text-foreground">
                                  @{activeReplyTarget.replyToName}
                                </strong>
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={closeReply}
                              className="flex size-5 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              aria-label="Cancel reply"
                            >
                              <X className="size-3" />
                            </button>
                          </div>

                          {/* Multiline MentionComposer */}
                          <div className="p-1">
                            <MentionComposer
                              ref={replyComposerRef}
                              projectId={projectId}
                              placeholder={`Reply to @${activeReplyTarget.replyToName}…`}
                              disabled={
                                submittingReplyParentId ===
                                activeReplyTarget.parentCommentId
                              }
                              autoFocus
                              resetKey={replyResetKey}
                              editorClassName="min-h-[56px] border-0 bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-none shadow-none focus:border-0 focus:ring-0 placeholder:text-muted-foreground/70"
                              onDraftChange={(value) =>
                                handleDraftChange(
                                  value,
                                  activeReplyTarget.parentCommentId,
                                )
                              }
                              onSubmit={() =>
                                void submit(
                                  activeReplyTarget.parentCommentId,
                                )
                              }
                              aria-label={`Reply to ${activeReplyTarget.replyToName}`}
                            />
                          </div>

                          {/* Reply Footer */}
                          <div className="flex items-center justify-between border-t border-border/40 bg-muted/10 px-3 py-1.5 rounded-b-[5px]">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => replyComposerRef.current?.triggerMention()}
                                className="inline-flex items-center gap-1 rounded-[3px] border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] max-md:text-[11px] font-medium text-muted-foreground transition hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                                title="Mention teammates"
                              >
                                <span className="font-semibold text-primary">@</span>
                                <span>Mention</span>
                              </button>
                              <span className="font-mono text-[10px] max-md:text-[11px] text-muted-foreground">
                                ⌘↵ to reply
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={closeReply}
                                className="h-[26px] rounded-[5px] px-2 font-mono text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              >
                                Cancel
                              </button>
                              <Button pending={submittingReplyParentId ===
                                activeReplyTarget.parentCommentId}
                                type="button"
                                size="sm"
                                onClick={() =>
                                  void submit(activeReplyTarget.parentCommentId)
                                }
                                disabled={
                                  !replyDraft.trim() ||
                                  submittingReplyParentId ===
                                    activeReplyTarget.parentCommentId
                                }
                                className="h-[26px] gap-1.5 rounded-[5px] px-2.5 text-[11px] font-medium shadow-xs disabled:opacity-40"
                                aria-label="Post reply"
                              >
                                <Send className="size-3" />
                                <span>Reply</span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </DiscussionEntry>
                  );
                })}

                {comment.repliesHaveMore && isExpanded ? (
                  <div className="relative flex items-center gap-2.5 px-1 py-1">
                    <ThreadRailBridge />
                    <p className="text-xs text-muted-foreground font-mono">
                      Showing latest {replies.length} of{" "}
                      {comment.replyCount ?? replies.length} replies
                    </p>
                  </div>
                ) : null}

                {replyTyping ? (
                  <p className="pl-11 text-xs text-muted-foreground font-mono">
                    {replyTyping}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
