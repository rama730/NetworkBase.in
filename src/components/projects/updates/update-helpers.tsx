'use client';

import Link from "next/link";
import { type InfiniteData } from "@tanstack/react-query";
import { type ProjectUpdateCommentView, type ProjectUpdateMovementSummary, type ProjectUpdateView } from "@/app/actions/project/updates";

export type UpdatesPage = {
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

export function updateRelativeTime(date: string, style: keyof typeof UPDATE_RELATIVE_TIME_FORMATTERS = "narrow") {
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

export function updateAuthorName(update: ProjectUpdateView) {
  return update.author?.fullName || update.author?.username || "Former member";
}

export function updateAuthorRoleLabel(update: ProjectUpdateView) {
  return (
    update.author?.roleLabel ??
    update.author?.roleTitle ??
    update.author?.membershipRoleLabel ??
    null
  );
}

type ProjectUpdateContextItem = NonNullable<ProjectUpdateView["context"]["references"]>[number];

export function updateContextItems(update: ProjectUpdateView): ProjectUpdateContextItem[] {
  const orderedReferences = update.context.references ?? [];
  if (orderedReferences.length > 0) return orderedReferences;
  return [
    update.context.task ?? null,
    update.context.sprint ?? null,
    update.context.file ?? null,
  ].filter((item): item is ProjectUpdateContextItem => Boolean(item));
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

export function isUpdateCardControl(target: EventTarget | null, card: HTMLElement) {
  if (!(target instanceof Element)) return false;
  const control = target.closest(UPDATE_CARD_CONTROL_SELECTOR);
  return Boolean(control && control !== card);
}

export function realtimeStringField(record: unknown, key: string) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function prependUpdate(
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

export function replaceUpdate(
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

export function removeUpdate(
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

export function updatePages(
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




export function getDescendants(
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

export function renderCommentContent(content: string) {
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
