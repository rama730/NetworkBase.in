"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import {
  ArrowLeft,
  CornerDownRight,
  FileText,
  Heart,
  History,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PanelRightOpen,
  Pin,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { createProjectUpdateAction, createProjectUpdateCommentAction, deleteProjectUpdateAction, deleteProjectUpdateCommentAction, editProjectUpdateAction, readProjectUpdateAction, readProjectUpdateCommentsAction, readProjectUpdatesAction, resolveProjectUpdateMentionTargetAction, toggleProjectUpdateLikeAction, toggleProjectUpdatePinAction, type ProjectUpdateCommentView, type ProjectUpdateMovementSummary, type ProjectUpdateView } from "@/app/actions/project/updates";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ThreadAvatarRail, ThreadRailBridge } from "@/components/ui/ThreadRail";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  ProjectUpdateMediaFrame,
  ProjectUpdateMediaViewer,
  isProjectUpdateVideoMedia,
} from "@/components/projects/updates/ProjectUpdateMediaFrame";
import { createClient } from "@/lib/supabase/client";
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";
import { queryKeys } from "@/lib/query-keys";
import {
  PROJECT_UPDATE_VIRTUALIZE_THRESHOLD,
  type ProjectUpdateMediaItem,
} from "@/lib/projects/updates";
import { cn } from "@/lib/utils";
import { splitMarkdownByInlineReferences } from "@/lib/projects/doc-blocks";

type UpdateReferenceLinkKind = "task" | "sprint" | "file";

function normalizeUpdateReferenceLinkKind(kind: string): UpdateReferenceLinkKind | null {
  if (kind === "task" || kind === "tasks") return "task";
  if (kind === "sprint" || kind === "sprints") return "sprint";
  if (kind === "file" || kind === "files") return "file";
  return null;
}

function referenceFallbackHref(reference: { kind: string; id: string }, projectId: string, projectSlug?: string | null) {
  const slug = encodeURIComponent(projectSlug || projectId);
  const id = encodeURIComponent(reference.id);
  const kind = normalizeUpdateReferenceLinkKind(reference.kind);
  if (kind === "task") return `/projects/${slug}?tab=tasks&drawerType=task&drawerId=${id}`;
  if (kind === "sprint") return `/projects/${slug}?tab=sprints&sprintId=${id}`;
  if (kind === "file") return `/projects/${slug}?tab=files&fileId=${id}`;
  return `/projects/${slug}?tab=updates`;
}

function ReferenceLink({
  reference,
  projectId,
  projectSlug,
}: {
  reference: { kind: string; id: string; label: string };
  projectId: string;
  projectSlug?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const normalizedKind = normalizeUpdateReferenceLinkKind(reference.kind);
  const isClickable = Boolean(normalizedKind);
  const fallbackHref = referenceFallbackHref(reference, projectId, projectSlug);

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isClickable || loading) return;
    setLoading(true);
    try {
      const result = await resolveProjectUpdateMentionTargetAction(projectId, {
        kind: normalizedKind,
        id: reference.id,
      });
      if (!result.success) {
        toast.error(result.error || "This item is not available or you do not have access.");
        return;
      }
      router.push(result.href);
    } catch (err) {
      console.error("Failed to navigate to project update mention:", err);
      toast.error("This item is not available or you do not have access.");
    } finally {
      setLoading(false);
    }
  };

  if (!isClickable) {
    if (reference.kind === "contributors") {
      const initial = reference.label.trim().charAt(0).toUpperCase() || "U";
      return (
        <span className="inline-flex items-center gap-1 mx-1 rounded-[3px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] bg-primary/10 text-[10px] font-semibold text-primary">
            {initial}
          </span>
          {reference.label}
        </span>
      );
    }
    return (
      <span className="mx-0.5 inline font-medium text-primary">
        {reference.label}
      </span>
    );
  }

  return (
    <a
      href={fallbackHref}
      onClick={handleClick}
      aria-disabled={loading}
      className={cn(
        "mx-0.5 inline cursor-pointer p-0 align-baseline text-sm font-medium text-primary underline-offset-2 transition hover:underline aria-disabled:cursor-not-allowed aria-disabled:opacity-75",
        loading && "nb-skeleton"
      )}
    >
      {reference.label}
    </a>
  );
}

type UpdatesPage = {
  updates: ProjectUpdateView[];
  nextCursor: string | null;
  hasMore: boolean;
  movementSummary?: ProjectUpdateMovementSummary | null;
  capabilities?: {
    canCreate: boolean;
    canManage: boolean;
    canInteract: boolean;
  };
};

type UpdatesTabProps = {
  projectId: string;
  projectSlug?: string | null;
  projectName: string;
  currentUserId: string | null;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  canCreateUpdates: boolean;
  canManageUpdates: boolean;
  initialUpdateId?: string | null;
  initialCommentId?: string | null;
};

const ProjectUpdateComposer = dynamic(
  () =>
    import("../updates/ProjectUpdateComposer").then(
      (mod) => mod.ProjectUpdateComposer,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-24 rounded-[8px] border border-border bg-muted/30" />
    ),
  },
);

const UPDATE_RELATIVE_TIME_UNITS = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
] as const;

const UPDATE_RELATIVE_TIME_FORMATTERS = {
  narrow: new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" }),
  long: new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "long" }),
};

function updateRelativeTime(date: string, style: keyof typeof UPDATE_RELATIVE_TIME_FORMATTERS = "narrow") {
  const value = new Date(date);
  const time = value.getTime();
  if (!Number.isFinite(time)) return "";

  const now = Date.now();
  const elapsed = time - now;
  const delta = Math.abs(elapsed);
  if (delta < 60 * 1000) return "Just now";

  for (const [unit, unitMs] of UPDATE_RELATIVE_TIME_UNITS) {
    if (delta >= unitMs) {
      return UPDATE_RELATIVE_TIME_FORMATTERS[style].format(
        Math.round(elapsed / unitMs),
        unit,
      );
    }
  }

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(value.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

function updateAuthorName(update: ProjectUpdateView) {
  return update.author?.fullName || update.author?.username || "Former member";
}

function updateAuthorRoleLabel(update: ProjectUpdateView) {
  return (
    update.author?.roleLabel ??
    update.author?.roleTitle ??
    update.author?.membershipRoleLabel ??
    null
  );
}

type ProjectUpdateContextItem = NonNullable<ProjectUpdateView["context"]["references"]>[number];

function updateContextItems(update: ProjectUpdateView): ProjectUpdateContextItem[] {
  const orderedReferences = update.context.references ?? [];
  if (orderedReferences.length > 0) return orderedReferences;
  return [
    update.context.task ?? null,
    update.context.sprint ?? null,
    update.context.file ?? null,
  ].filter((item): item is ProjectUpdateContextItem => Boolean(item));
}

function ProjectUpdateContent({
  content,
  projectId,
  projectSlug,
  className,
}: {
  content: string;
  projectId: string;
  projectSlug?: string | null;
  className?: string;
}) {
  if (!content.trim()) return null;
  return (
    <div className={className}>
      {splitMarkdownByInlineReferences(content).map((segment, i) => {
        if (segment.kind === "markdown") return <span key={i}>{segment.content}</span>;
        return (
          <ReferenceLink
            key={i}
            reference={segment.reference}
            projectId={projectId}
            projectSlug={projectSlug}
          />
        );
      })}
    </div>
  );
}

function UpdateContextAndMedia({
  update,
  compact = false,
}: {
  update: ProjectUpdateView;
  compact?: boolean;
}) {
  const [viewerMedia, setViewerMedia] = useState<ProjectUpdateMediaItem | null>(null);
  const mediaItems = update.media.filter((item) => item.url || item.label);

  if (mediaItems.length === 0) return null;

  return (
    <div className={cn("mt-2 space-y-2", compact && "max-w-full")}>

      {mediaItems.map((item, index) =>
        item.url && (item.type === "image" || isProjectUpdateVideoMedia(item)) ? (
          <ProjectUpdateMediaFrame
            key={`${item.url}-${index}`}
            item={item}
            src={item.url}
            alt={item.altText || item.label || "Project update image"}
            className={compact ? "max-h-[220px] w-full object-cover" : undefined}
            onOpen={item.type === "image" ? () => setViewerMedia(item) : undefined}
            openLabel={`Open ${item.label || item.altText || "project update media"}`}
          />
        ) : (
          <a
            key={`${item.url ?? item.label}-${index}`}
            href={item.url ?? "#"}
            target={item.url ? "_blank" : undefined}
            rel={item.url ? "noreferrer" : undefined}
            className="inline-flex min-w-0 items-center font-mono text-xs text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground transition-colors"
          >
            <span className="truncate">{item.label || item.url || "Linked item"}</span>
          </a>
        ),
      )}
      <ProjectUpdateMediaViewer
        item={viewerMedia}
        onOpenChange={(open) => {
          if (!open) setViewerMedia(null);
        }}
      />
    </div>
  );
}

const UPDATE_CARD_CONTROL_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "video",
  "audio",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
].join(",");

function isUpdateCardControl(target: EventTarget | null, card: HTMLElement) {
  if (!(target instanceof Element)) return false;
  const control = target.closest(UPDATE_CARD_CONTROL_SELECTOR);
  return Boolean(control && control !== card);
}

function realtimeStringField(record: unknown, key: string) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function useDesktopUpdatesRail() {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return matches;
}

function prependUpdate(
  existing: InfiniteData<UpdatesPage> | undefined,
  update: ProjectUpdateView,
): InfiniteData<UpdatesPage> {
  if (!existing)
    return {
      pages: [{ updates: [update], nextCursor: null, hasMore: false }],
      pageParams: [null],
    };
  const [first, ...rest] = existing.pages;
  if (!first) {
    return {
      ...existing,
      pages: [{ updates: [update], nextCursor: null, hasMore: false }],
    };
  }
  return {
    ...existing,
    pages: [{ ...first, nextCursor: first.nextCursor ?? null, hasMore: first.hasMore ?? false, updates: [update, ...first.updates] }, ...rest],
  };
}

function replaceUpdate(
  existing: InfiniteData<UpdatesPage> | undefined,
  oldId: string,
  next: ProjectUpdateView,
): InfiniteData<UpdatesPage> {
  if (!existing) return existing!;
  return {
    ...existing,
    pages: existing.pages.map((page) => ({
      ...page,
      updates: page.updates.map((u) => (u.id === oldId ? next : u)),
    })),
  };
}

function removeUpdate(
  existing: InfiniteData<UpdatesPage> | undefined,
  updateId: string,
): InfiniteData<UpdatesPage> {
  if (!existing) return existing!;
  return {
    ...existing,
    pages: existing.pages.map((page) => ({
      ...page,
      updates: page.updates.filter((u) => u.id !== updateId),
    })),
  };
}

function updatePages(
  existing: InfiniteData<UpdatesPage> | undefined,
  transform: (item: ProjectUpdateView) => ProjectUpdateView,
): InfiniteData<UpdatesPage> {
  if (!existing) return existing!;
  return {
    ...existing,
    pages: existing.pages.map((page) => ({
      ...page,
      updates: page.updates.map(transform),
    })),
  };
}




function getDescendants(
  rootId: string,
  allComments: ProjectUpdateCommentView[],
): { comment: ProjectUpdateCommentView; replyingTo: string | null }[] {
  const repliesByParentId = new Map<string, ProjectUpdateCommentView[]>();
  const commentMap = new Map<string, ProjectUpdateCommentView>();

  for (const c of allComments) {
    commentMap.set(c.id, c);
    if (c.parentId) {
      const list = repliesByParentId.get(c.parentId) || [];
      list.push(c);
      repliesByParentId.set(c.parentId, list);
    }
  }

  for (const list of repliesByParentId.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const result: { comment: ProjectUpdateCommentView; replyingTo: string | null }[] = [];

  function traverse(commentId: string) {
    const children = repliesByParentId.get(commentId) || [];
    for (const child of children) {
      const parent = commentMap.get(child.parentId!);
      const replyingTo =
        child.targetUsername || (parent ? (parent.author?.username || parent.author?.fullName || "Member") : null);
      result.push({ comment: child, replyingTo });
      traverse(child.id);
    }
  }

  traverse(rootId);
  return result;
}

function renderCommentContent(content: string) {
  if (!content) return null;
  const parts = content.split(/(@[a-zA-Z0-9_]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@") && part.length > 1) {
      const username = part.slice(1);
      return (
        <Link
          key={i}
          href={`/u/${username}`}
         
          className="font-mono font-medium text-foreground hover:underline"
        >
          {part}
        </Link>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

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
                 
                  className="flex size-8 shrink-0 items-center justify-center transition-opacity hover:opacity-80"
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
                          className="ml-2 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Delete comment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
                      className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground text-foreground"
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

function UpdateComments({
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
        error instanceof Error ? error.message : "Failed to post comment",
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
        error instanceof Error ? error.message : "Failed to delete comment",
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
             
              className="flex items-center justify-center shrink-0 transition-opacity hover:opacity-80 z-10 w-8 h-8"
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
                      className="ml-2 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete comment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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
                          className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
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
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
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
                  · {updateRelativeTime(update.createdAt)}
                </span>
                {!isDeleted && update.editedAt ? (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Edited</span>
                ) : null}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="-mt-1 flex h-7 w-7 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
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

          {!isDeleted ? (
            <div className="mt-2.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() =>
                  currentUserId
                    ? likeMutation.mutate()
                    : toast.error("Please log in to like updates")
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-rose-500",
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
                className="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground"
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

const MemoizedUpdateCard = memo(UpdateCard);
MemoizedUpdateCard.displayName = "MemoizedProjectUpdateCard";

function UpdatesRightRail({
  updates,
  onOpenDetail,
}: {
  updates: ProjectUpdateView[];
  onOpenDetail: (updateId: string) => void;
}) {
  const postingMembers = useMemo(
    () => {
      const latestByAuthor = new Map<string, ProjectUpdateView>();
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
          Recent Activity
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
            Project members will appear here after their first post.
          </p>
        </div>
      )}
    </section>
  );
}

function UpdateDetailPanel({
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

export default function UpdatesTab({
  projectId,
  projectSlug,
  projectName,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  canCreateUpdates,
  canManageUpdates,
  initialUpdateId,
  initialCommentId,
}: UpdatesTabProps) {
  const queryClient = useQueryClient();
  const updatesQueryKey = queryKeys.project.detail.updates(projectId);
  const [hiddenUpdateIds, setHiddenUpdateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailUpdateId, setDetailUpdateId] = useState<string | null>(
    initialUpdateId ?? null,
  );
  const isDesktopUpdatesRail = useDesktopUpdatesRail();
  const mobileDetailRef = useRef<HTMLDivElement | null>(null);
  const [feedScrollParent, setFeedScrollParent] = useState<HTMLElement | null>(null);

  const updatesQuery = useInfiniteQuery({
    queryKey: updatesQueryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await readProjectUpdatesAction(projectId, {
        cursor: pageParam,
      });
      if (!result.success)
        throw new Error(result.error || "Failed to load project updates");
      return result.data as UpdatesPage;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const updates = useMemo(
    () => updatesQuery.data?.pages.flatMap((page) => page.updates) ?? [],
    [updatesQuery.data],
  );
  const visibleUpdates = useMemo(
    () => updates.filter((update) => !update.deletedAt && !hiddenUpdateIds.has(update.id)),
    [hiddenUpdateIds, updates],
  );
  const shouldVirtualizeFeed =
    visibleUpdates.length > PROJECT_UPDATE_VIRTUALIZE_THRESHOLD;
  const detailUpdate = useMemo(
    () =>
      detailUpdateId
        ? (updates.find((update) => update.id === detailUpdateId && !update.deletedAt) ?? null)
        : null,
    [detailUpdateId, updates],
  );
  const hideUpdate = useCallback((updateId: string) => {
    setHiddenUpdateIds((current) => new Set(current).add(updateId));
    toast.success("Update hidden");
  }, []);
  const openDetail = useCallback((updateId: string) => {
    setDetailUpdateId(updateId);
    requestAnimationFrame(() => {
      mobileDetailRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }, []);
  const capabilities = updatesQuery.data?.pages[0]?.capabilities;
  const canCreate = Boolean(capabilities?.canCreate ?? canCreateUpdates);
  const canManage = Boolean(capabilities?.canManage ?? canManageUpdates);

  useEffect(() => {
    const routeScrollRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
    setFeedScrollParent(routeScrollRoot ?? null);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const handleProjectUpdateChange = async (payload: any) => {
      const authorId =
        realtimeStringField(payload.new, "author_id") ??
        realtimeStringField(payload.old, "author_id");
      if (authorId && authorId === currentUserId) return;

      const newId = realtimeStringField(payload.new, "id");
      const oldId = realtimeStringField(payload.old, "id") ?? realtimeStringField(payload.new, "id");

      if (payload.eventType === "DELETE" && oldId) {
        queryClient.setQueryData(
          updatesQueryKey,
          (existing: InfiniteData<UpdatesPage> | undefined) =>
            removeUpdate(existing, oldId)
        );
        return;
      }

      if (newId) {
        const result = await readProjectUpdateAction(projectId, newId);
        if (result.success && result.data) {
          queryClient.setQueryData(
            updatesQueryKey,
            (existing: InfiniteData<UpdatesPage> | undefined) => {
              if (payload.eventType === "INSERT") {
                const hasIt = existing?.pages.some((page) => page.updates.some((u) => u.id === newId));
                if (hasIt) return existing!;
                return prependUpdate(existing, result.data!);
              } else {
                return replaceUpdate(existing, newId, result.data!);
              }
            }
          );
        }
      }
    };
    const handleProjectCommentChange = (payload: any) => {
      const authorId =
        realtimeStringField(payload.new, "user_id") ??
        realtimeStringField(payload.old, "user_id");
      if (authorId && authorId === currentUserId) return;
      const updateId =
        realtimeStringField(payload.new, "update_id") ??
        realtimeStringField(payload.old, "update_id");
      if (!updateId) return;

      void queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.updateComments(projectId, updateId),
      });
      if (payload.eventType !== "INSERT" && payload.eventType !== "DELETE") return;
      const delta = payload.eventType === "INSERT" ? 1 : -1;
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          updatePages(existing, (item) =>
            item.id === updateId
              ? { ...item, commentCount: Math.max(0, item.commentCount + delta) }
              : item,
          ),
      );
    };
    const channel = subscribeActiveResource({
      supabase,
      resourceType: "project_hydration",
      resourceId: `updates:${projectId}`,
      bindings: [
        {
          event: "*",
          table: "project_updates",
          filter: `project_id=eq.${projectId}`,
          handler: handleProjectUpdateChange,
        },
        {
          event: "*",
          table: "project_update_comments",
          filter: `project_id=eq.${projectId}`,
          handler: handleProjectCommentChange,
        },
      ],
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, projectId, queryClient, updatesQueryKey]);

  useEffect(() => {
    if (!initialUpdateId) return;
    setDetailUpdateId(initialUpdateId);
    const hasUpdate = updates.some((update) => update.id === initialUpdateId);
    if (hasUpdate) {
      requestAnimationFrame(() => {
        document
          .getElementById(`project-update-${initialUpdateId}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    let cancelled = false;
    readProjectUpdateAction(projectId, initialUpdateId).then((result) => {
      if (cancelled || !result.success || !result.data) return;
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          prependUpdate(existing, result.data!),
      );
      requestAnimationFrame(() => {
        document
          .getElementById(`project-update-${initialUpdateId}`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [initialUpdateId, projectId, queryClient, updates, updatesQueryKey]);

  const createMutation = useMutation({
    mutationFn: async (
      input: Parameters<typeof createProjectUpdateAction>[1],
    ) => {
      const result = await createProjectUpdateAction(projectId, input);
      if (!result.success || !result.data)
        throw new Error(result.error || "Failed to post update");
      return result.data;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: updatesQueryKey });
      const previous =
        queryClient.getQueryData<InfiniteData<UpdatesPage>>(updatesQueryKey);
      const tempId = `temp-update-${Date.now()}`;
      const optimistic: ProjectUpdateView = {
        id: tempId,
        projectId,
        authorId: currentUserId,
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
        content: input.content,
        updateType: null,
        visibility: input.visibility === "members" ? "members" : "public",
        replyPolicy: "logged_in",
        entityRefs: input.entityRefs ?? {},
        context: {},
        media: input.media ?? [],
        metadata: {},
        isPinned: false,
        likeCount: 0,
        commentCount: 0,
        likedByViewer: false,
        canEdit: true,
        canDelete: true,
        canPin: canManage,
        canComment: Boolean(currentUserId),
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          prependUpdate(existing, optimistic),
      );
      return { previous, tempId };
    },
    onError: (error, _input, context) => {
      if (context?.previous)
        queryClient.setQueryData(updatesQueryKey, context.previous);
      toast.error(
        error instanceof Error ? error.message : "Failed to post update",
      );
    },
    onSuccess: (update, _input, context) => {
      queryClient.setQueryData(
        updatesQueryKey,
        (existing: InfiniteData<UpdatesPage> | undefined) =>
          context?.tempId
            ? replaceUpdate(existing, context.tempId, update)
            : prependUpdate(existing, update),
      );
      void queryClient.invalidateQueries({ queryKey: updatesQueryKey });
      toast.success("Project update posted");
    },
  });

  const feed = updatesQuery.isLoading ? (
    <div className="divide-y divide-border/80">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-1 py-3">
          <div aria-hidden="true" className="nb-skeleton h-9 w-9 shrink-0 rounded-[5px]" />
          <div className="flex-1 space-y-2">
            <div aria-hidden="true" className="nb-skeleton h-3.5 w-1/3 rounded-[3px]" />
            <div aria-hidden="true" className="nb-skeleton h-10 rounded-[5px]" />
          </div>
        </div>
      ))}
    </div>
  ) : visibleUpdates.length === 0 ? (
    <div className="nb-empty-state nb-grid-ground py-16" role="status">
      <MessageCircle className="nb-empty-state-icon mb-3" />
      <h3 className="nb-empty-state-title">
        No updates yet
      </h3>
      <p className="nb-empty-state-desc">
        {canCreate
          ? "Share the first progress post so followers can see what is moving."
          : "Follow this project to get notified when the team shares progress."}
      </p>
    </div>
  ) : shouldVirtualizeFeed ? (
    <Virtuoso
      {...(feedScrollParent ? { customScrollParent: feedScrollParent } : { useWindowScroll: true })}
      data={visibleUpdates}
      itemContent={(_, update) => (
        <MemoizedUpdateCard
          projectId={projectId}
          projectSlug={projectSlug}
          update={update}
          updatesQueryKey={updatesQueryKey}
          onHide={hideUpdate}
          onOpenDetail={openDetail}
          currentUserId={currentUserId}
          highlighted={initialUpdateId === update.id}
        />
      )}
    />
  ) : (
    <div>
      <>
        {visibleUpdates.map((update) => (
          <MemoizedUpdateCard
            key={update.id}
            projectId={projectId}
            projectSlug={projectSlug}
            update={update}
            updatesQueryKey={updatesQueryKey}
            onHide={hideUpdate}
            onOpenDetail={openDetail}
            currentUserId={currentUserId}
            highlighted={initialUpdateId === update.id}
          />
        ))}
      </>
    </div>
  );

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[1240px] gap-8 xl:grid-cols-[minmax(0,1fr)_440px]"
      )}
    >
      <main className="min-w-0">
        <div className="px-1 pb-3 pt-2">
          <div>
            <h2 className="nb-section-title text-foreground">
              Project feed
            </h2>
            <p className="nb-compact text-muted-foreground">
              Progress posts for followers and project visitors.
            </p>
          </div>
        </div>

        {isDesktopUpdatesRail === false ? (
          <ProjectUpdateComposer
            projectId={projectId}
            projectName={projectName}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            currentUserAvatarUrl={currentUserAvatarUrl}
            canCreate={canCreate}
            canManage={canManage}
            isPosting={createMutation.isPending}
            onPost={(input) => createMutation.mutate(input)}
          />
        ) : null}

        {detailUpdate ? (
          <div ref={mobileDetailRef} className="xl:hidden">
            <UpdateDetailPanel
              projectId={projectId}
              projectSlug={projectSlug}
              update={detailUpdate}
              updatesQueryKey={updatesQueryKey}
              onClose={() => setDetailUpdateId(null)}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              highlightedCommentId={
                detailUpdate.id === initialUpdateId ? initialCommentId : null
              }
              className="mb-4 animate-in fade-in slide-in-from-bottom-2 border-y border-border py-4 duration-[180ms]"
            />
          </div>
        ) : null}

        {feed}

        {updatesQuery.hasNextPage ? (
          <div className="px-1 py-4">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-[5px] font-mono text-xs uppercase tracking-wider"
              onClick={() => updatesQuery.fetchNextPage()}
              disabled={updatesQuery.isFetchingNextPage}
            >
              {updatesQuery.isFetchingNextPage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Load more updates
            </Button>
          </div>
        ) : null}
      </main>

      <aside className="hidden w-full min-w-0 xl:block xl:w-[440px] shrink-0 border-l border-border pl-6">
        <div
          className="sticky top-[calc(var(--project-tabs-height,42px)+1rem)] max-h-[calc(100dvh-var(--project-tabs-height,42px)-2rem)] overflow-y-auto pr-2 space-y-6"
        >
          {detailUpdate ? (
            <UpdateDetailPanel
              projectId={projectId}
              projectSlug={projectSlug}
              update={detailUpdate}
              updatesQueryKey={updatesQueryKey}
              onClose={() => setDetailUpdateId(null)}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              highlightedCommentId={
                detailUpdate.id === initialUpdateId ? initialCommentId : null
              }
              className="animate-in fade-in slide-in-from-right-2 duration-[180ms]"
            />
          ) : (
            <div className="space-y-6">
              {isDesktopUpdatesRail === true ? (
                <ProjectUpdateComposer
                  projectId={projectId}
                  projectName={projectName}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  currentUserAvatarUrl={currentUserAvatarUrl}
                  canCreate={canCreate}
                  canManage={canManage}
                  isPosting={createMutation.isPending}
                  onPost={(input) => createMutation.mutate(input)}
                />
              ) : null}
              <UpdatesRightRail
                updates={visibleUpdates}
                onOpenDetail={openDetail}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
