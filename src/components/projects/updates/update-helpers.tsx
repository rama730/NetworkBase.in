'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
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
    if (delta < unitMs) continue;
    // 11.6 months rounds to 12: that is a year, not "12 mo".
    if (unit === "month" && Math.round(delta / unitMs) >= 12) continue;
    return UPDATE_RELATIVE_TIME_FORMATTERS[style].format(Math.round(elapsed / unitMs), unit);
  }
  // Under a minute is handled above, so this is only reached by a unit gap that cannot occur.
  return "";
}

/** Same on the server and the first client render (fixed locale and zone); the relative text follows after mount. */
function updateAbsoluteDate(date: string) {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) return "";
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * A `<time>` element. Server-rendered cards must not read the clock or the browser locale while rendering
 * (they would differ from the client's first render), so the absolute date is printed first and the relative
 * text replaces it once mounted. The full date and time stay in the tooltip.
 */
export function UpdateTime({ date, className, style = "narrow" }: { date: string; className?: string; style?: keyof typeof UPDATE_RELATIVE_TIME_FORMATTERS }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const full = new Date(date);
  return (
    <time
      dateTime={date}
      title={Number.isFinite(full.getTime()) ? full.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : undefined}
      className={className}
      suppressHydrationWarning
    >
      {mounted ? updateRelativeTime(date, style) : updateAbsoluteDate(date)}
    </time>
  );
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
  // A cache that isn't a set of pages (empty, or another shape) has nothing to patch.
  if (!existing || !Array.isArray(existing.pages)) return existing!;
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
    // Other caches share the key prefix (comment pages, context options): only pages of updates are patched.
    pages: existing.pages.map((page) => (Array.isArray(page.updates) ? { ...page, updates: page.updates.map(transform) } : page)),
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
