"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { X } from "lucide-react";
import { toast } from "@/lib/feedback";

import { MessageRow } from "@/components/messages/MessageRow";
import { Button } from "@/components/ui/button";
import { LatestBar } from "@/components/messages/parts/LatestBar";
import { formatChatTime } from "@/lib/messaging/channel-view";
import { applicationLineKind } from "@/lib/messaging/application-status";
import { buildTimeline, newFromOthers, type TimelineItem } from "@/lib/messaging/timeline";
import type { ChatMessageView } from "@/lib/messaging/types";

const START_INDEX = 1_000_000;

/** "Show in conversation" from a thread on a phone: scroll the timeline to that message and flash it. */
export const REVEAL_EVENT = "chat-reveal";
export type RevealEvent = { channelId: string; seq: number };
const HIGHLIGHT_MS = 2_500;
// Jump to a date loads older pages until it's reached, at most this many.
const MAX_JUMP_PAGES = 12;

type Props = {
  messages: ChatMessageView[];
  lastReadSeq: number;
  meId: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  intro: React.ReactNode;
  highlightSeq?: number | null;
  onSeen: (seq: number) => void;
  /** Mark the whole conversation read now (the unread bar, Jump to latest). */
  onMarkRead?: () => void;
  /** Someone is typing: the footer opens to make room for the floating indicator. */
  typing?: boolean;
  /** A message to bring into view (↑ to edit your last message). */
  revealSeq?: number | null;
  /** Loading an earlier page failed: the top says so, with Retry. */
  olderError?: boolean;
  /** The loaded window ends before the conversation does (after a jump): Latest reloads the newest page. */
  behindLatest?: boolean;
  onReloadLatest?: () => void;
  /** Changes when you send: scroll down to your message even if you were reading older ones. */
  sentTick?: number;
};

function startOfDay(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
}

/** Today as yyyy-mm-dd in the reader's zone (a UTC date is tomorrow or yesterday near midnight). */
function todayLocal() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type TimelineContext = { hasOlder: boolean; loadingOlder: boolean; olderError: boolean; loadOlder: () => void; intro: React.ReactNode; typing: boolean };

// Stable component identities (VIRT-01): inline ones would remount on every render.
function TimelineHeader({ context }: { context?: TimelineContext }) {
  if (!context) return null;
  if (!context.hasOlder) return <>{context.intro}</>;
  if (context.olderError && !context.loadingOlder) {
    return (
      <div role="alert" className="py-3 text-center text-[12px] text-muted-foreground">
        Earlier messages couldn&apos;t load. <Button type="button" variant="outline" size="sm" onClick={context.loadOlder} className="ml-2">Retry</Button>
      </div>
    );
  }
  return <div className="py-3 text-center text-[12px] text-muted-foreground">{context.loadingOlder ? "Loading earlier messages…" : ""}</div>;
}
// Room for the floating typing indicator only while someone types; otherwise the gap closes.
// Growing is instant (a smooth scroll follows); shrinking glides, so nothing jumps.
function TimelineFooter({ context }: { context?: TimelineContext }) {
  return <div className={context?.typing ? "h-6" : "h-2 transition-[height] duration-[180ms] ease-out motion-reduce:transition-none"} />;
}
const COMPONENTS = { Header: TimelineHeader, Footer: TimelineFooter };

/**
 * A day separator; its button opens the date picker to jump to another day (keyboard too).
 * Without showPicker (older browsers), the date field itself shows up to type into.
 */
function DayLabel({ label, onPick }: { label: string; onPick: (date: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [typing, setTyping] = useState(false);
  const open = () => {
    const field = input.current;
    if (!field) return;
    try {
      if (typeof field.showPicker === "function") return void field.showPicker();
    } catch {
      // Not allowed here (e.g. inside a cross-origin frame): type the date instead.
    }
    setTyping(true);
    requestAnimationFrame(() => input.current?.focus());
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="relative">
        <button
          type="button"
          onClick={open}
          aria-label={`${label}. Jump to a date`}
          className="nb-touch-target pointer-coarse:min-h-[44px] pointer-coarse:px-3 inline-flex items-center justify-center rounded-[4px] border border-border bg-card px-2.5 py-0.5 font-mono text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Jump to a date"
        >
          {label}
        </button>
        <input
          ref={input}
          type="date"
          tabIndex={typing ? 0 : -1}
          aria-label="Jump to date"
          max={todayLocal()}
          onChange={(e) => {
            if (!e.target.value) return;
            setTyping(false);
            onPick(e.target.value);
          }}
          onBlur={() => setTyping(false)}
          className={typing
            ? "absolute left-1/2 top-full z-20 mt-1 h-9 -translate-x-1/2 rounded-[4px] border border-input bg-card px-2 text-base sm:text-[13px] shadow-md"
            : "pointer-events-none absolute inset-0 opacity-0"}
        />
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Virtualized timeline (Virtuoso prepend pattern): older pages prepend without
 * moving the reader, new messages follow only when already at the bottom.
 */
export function Timeline({ messages, lastReadSeq, meId, hasOlder, loadingOlder, loadOlder, intro, highlightSeq, onSeen, onMarkRead, typing = false, revealSeq = null, olderError = false, behindLatest = false, onReloadLatest, sentTick = 0 }: Props) {
  const virtuoso = useRef<VirtuosoHandle>(null);
  // The divider stays where it was when the channel opened, not where the cursor moves to.
  const [dividerSeq] = useState(lastReadSeq);
  const items = useMemo(() => buildTimeline(messages, { lastReadSeq: dividerSeq, meId }), [dividerSeq, meId, messages]);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  // The only thing read aloud as messages arrive: "2 new messages" (the list itself stays quiet).
  const [announcement, setAnnouncement] = useState("");
  const [topDay, setTopDay] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(highlightSeq ?? null);
  const [jump, setJump] = useState<{ at: number; pages: number } | null>(null);
  // Roving tabindex: Tab lands on one row (the newest until you move), ↑/↓ walk the rows.
  const [focusSeq, setFocusSeq] = useState<number | null>(null);

  // "12 new messages since Today 3:42 PM": what was unread when the conversation opened. When the
  // first loaded message is already unread and older pages exist, there are more than we can count: "50+".
  const [unreadAtOpen] = useState(() => {
    const unread = messages.filter((m) => m.seq > lastReadSeq && m.seq > 0 && m.author_id !== meId && (m.kind === "user" || (m.kind === "system" && applicationLineKind(m.body) !== null)));
    const firstLoaded = messages.find((m) => m.seq > 0);
    const more = hasOlder && Boolean(firstLoaded && firstLoaded.seq > lastReadSeq);
    return unread.length ? { count: unread.length, more, since: unread[0]!.created_at } : null;
  });
  const [bannerOpen, setBannerOpen] = useState(Boolean(unreadAtOpen));

  // Prepend bookkeeping: shift firstItemIndex by how many items appeared above the old first item.
  const head = items[0]?.key ?? null;
  const [prepend, setPrepend] = useState({ head, first: START_INDEX });
  let firstItemIndex = prepend.first;
  if (head && prepend.head && head !== prepend.head) {
    const previous = items.findIndex((item) => item.key === prepend.head);
    if (previous > 0) {
      firstItemIndex = prepend.first - previous;
      setPrepend({ head, first: firstItemIndex });
    } else if (previous === -1) {
      // Replaced entirely (e.g. reload or fresh timeline)
      setPrepend({ head, first: START_INDEX });
    }
  } else if (head && !prepend.head) {
    setPrepend({ head, first: START_INDEX });
  }

  const newestSeq = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]!.seq > 0) return messages[i]!.seq;
    return 0;
  }, [messages]);
  // "N new" counts only messages newer than what was there (older pages load at the top) and not your own.
  const lastNewest = useRef(newestSeq);
  useEffect(() => {
    const before = lastNewest.current;
    lastNewest.current = newestSeq;
    if (newestSeq <= before) return;
    const added = newFromOthers(messages, before, meId);
    if (!added) return;
    const text = `${added} new message${added === 1 ? "" : "s"}`;
    // Same words twice in a row: vary them invisibly so the screen reader speaks again.
    setAnnouncement((previous) => (previous === text ? `${text}\u00a0` : text));
    if (!atBottom) setUnseen((n) => n + added);
  }, [atBottom, meId, messages, newestSeq]);
  useEffect(() => {
    if (atBottom && newestSeq > 0) onSeen(newestSeq);
  }, [atBottom, newestSeq, onSeen]);
  // The typing gap opened: at the bottom, keep the last message fully in view. Next frame,
  // once the taller footer is in the DOM; scrolling past the end stops at the real bottom.
  useEffect(() => {
    if (!typing || !atBottom) return;
    const frame = requestAnimationFrame(() => virtuoso.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [atBottom, typing]);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);
  // A later jump to a message that's already loaded: scroll there in place (the first one positions the list).
  const lastJump = useRef(highlightSeq ?? null);
  useEffect(() => {
    if (!highlightSeq || highlightSeq === lastJump.current) return;
    lastJump.current = highlightSeq;
    const index = items.findIndex((item) => item.type === "message" && item.message.seq === highlightSeq);
    if (index < 0) return;
    virtuoso.current?.scrollToIndex({ index: firstItemIndex + index, align: "center", behavior: "smooth" });
    setHighlight(highlightSeq);
  }, [firstItemIndex, highlightSeq, items]);

  // A thread closed with "Show in conversation" asks for its root.
  useEffect(() => {
    const onReveal = (event: Event) => {
      const { channelId, seq } = (event as CustomEvent<RevealEvent>).detail ?? {};
      const index = items.findIndex((item) => item.type === "message" && item.message.seq === seq && item.message.channel_id === channelId);
      if (index < 0) return;
      // Next frame: the drawer that covered the timeline is gone by then.
      requestAnimationFrame(() => virtuoso.current?.scrollToIndex({ index: firstItemIndex + index, align: "center" }));
      setHighlight(seq);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [firstItemIndex, items]);

  // Editing an older message (↑ in the composer) scrolls it into view, once per edit.
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    if (!revealSeq) {
      revealed.current = null;
      return;
    }
    if (revealed.current === revealSeq) return;
    const index = items.findIndex((item) => item.type === "message" && item.message.seq === revealSeq);
    if (index < 0) return;
    revealed.current = revealSeq;
    virtuoso.current?.scrollIntoView({ index: firstItemIndex + index });
  }, [firstItemIndex, items, revealSeq]);

  // Jump to a date: the first message on or after it, loading older pages as needed.
  useEffect(() => {
    if (!jump) return;
    const index = items.findIndex((item) => item.type === "message" && Date.parse(item.message.created_at) >= jump.at);
    const first = items.find((item) => item.type === "message");
    const reached = first?.type === "message" && Date.parse(first.message.created_at) <= jump.at;
    const limit = hasOlder && jump.pages >= MAX_JUMP_PAGES && !reached;
    if (index >= 0 && (reached || !hasOlder || jump.pages >= MAX_JUMP_PAGES)) {
      virtuoso.current?.scrollToIndex({ index: firstItemIndex + index, align: "start" });
      const item = items[index];
      if (item?.type === "message") setHighlight(item.message.seq);
      setJump(null);
    } else if (hasOlder && jump.pages < MAX_JUMP_PAGES) {
      if (!loadingOlder) {
        setJump({ ...jump, pages: jump.pages + 1 });
        loadOlder();
      }
    } else {
      virtuoso.current?.scrollToIndex({ index: firstItemIndex + (index >= 0 ? index : 0), align: "start" });
      setJump(null);
    }
    // It stopped short: say so instead of landing somewhere unexplained.
    if (limit) toast("That day is further back. Showing the earliest messages loaded so far.");
  }, [firstItemIndex, hasOlder, items, jump, loadOlder, loadingOlder]);
  const pickDate = useCallback((date: string) => setJump({ at: startOfDay(date), pages: 0 }), []);

  // Initial position: points into the virtuoso firstItemIndex coordinate space.
  const initialIndex = useMemo(() => {
    if (!items.length) return undefined;
    if (highlightSeq) {
      const index = items.findIndex((item) => item.type === "message" && item.message.seq === highlightSeq);
      if (index >= 0) return { index: firstItemIndex + index, align: "center" as const };
    }
    const divider = items.findIndex((item) => item.type === "new");
    const target = divider >= 0 ? divider : Math.max(0, items.length - 1);
    return { index: firstItemIndex + target, align: (divider >= 0 ? "start" : "end") as "start" | "end" };
  }, [firstItemIndex, highlightSeq, items]);

  const markRead = useCallback(() => {
    setBannerOpen(false);
    onMarkRead?.();
  }, [onMarkRead]);
  const toLatest = useCallback(() => {
    setUnseen(0);
    markRead();
    // After a jump the newest messages aren't loaded: the end of this window isn't the latest.
    if (behindLatest && onReloadLatest) return onReloadLatest();
    virtuoso.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
  }, [behindLatest, markRead, onReloadLatest]);
  // You sent something while reading older messages: follow it down (like Slack).
  const lastSentTick = useRef(sentTick);
  useEffect(() => {
    if (sentTick === lastSentTick.current) return;
    lastSentTick.current = sentTick;
    const frame = requestAnimationFrame(() => virtuoso.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [sentTick]);
  const toFirstUnread = useCallback(() => {
    const index = items.findIndex((item) => item.type === "new");
    if (index >= 0) virtuoso.current?.scrollToIndex({ index: firstItemIndex + index, align: "start", behavior: "smooth" });
  }, [firstItemIndex, items]);

  // Tab lands on the row you last focused while it's still loaded, else the newest real message
  // (never a system line, which isn't a row you can act on).
  const tabSeq = useMemo(() => {
    const rows = items.filter((item): item is Extract<TimelineItem, { type: "message" }> => item.type === "message" && item.message.kind !== "system");
    if (focusSeq !== null && rows.some((item) => item.message.seq === focusSeq)) return focusSeq;
    return rows.at(-1)?.message.seq ?? null;
  }, [focusSeq, items]);
  const onListKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const row = e.target as HTMLElement;
    if (!row.hasAttribute("data-message-row")) return;
    const at = items.findIndex((item) => item.type === "message" && item.message.seq === Number(row.dataset.seq));
    if (at < 0) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    let next = at + step;
    while (next >= 0 && next < items.length) {
      const item = items[next]!;
      if (item.type === "message" && item.message.kind !== "system") break;
      next += step;
    }
    const target = items[next];
    if (target?.type !== "message") return;
    e.preventDefault();
    setFocusSeq(target.message.seq);
    virtuoso.current?.scrollIntoView({ index: firstItemIndex + next });
    // Next frame the row is rendered; focus it without another scroll.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.closest("[role=log]")?.querySelector<HTMLElement>(`[data-message-row][data-seq="${target.message.seq}"]`)?.focus({ preventScroll: true });
    }));
  }, [items, firstItemIndex]);

  const renderItem = useCallback((_index: number, item: TimelineItem) => {
    if (item.type === "day") return <DayLabel label={item.label} onPick={pickDate} />;
    if (item.type === "new") {
      return (
        <div className="flex items-center gap-3 px-4 py-1" role="separator" aria-label="New messages">
          <span className="h-px flex-1 bg-primary" />
          <span className="nb-micro text-primary">New messages</span>
        </div>
      );
    }
    return <MessageRow message={item.message} grouped={item.grouped} others={item.others} highlighted={highlight === item.message.seq} tabStop={tabSeq === item.message.seq} />;
  }, [highlight, pickDate, tabSeq]);

  return (
    <>
    <div
      className="relative min-h-0 flex-1"
      role="log"
      aria-live="off"
      aria-label="Messages"
      onKeyDown={onListKeyDown}
      onFocus={(e) => {
        const seq = Number((e.target as HTMLElement).dataset?.seq);
        if ((e.target as HTMLElement).hasAttribute?.("data-message-row") && seq) setFocusSeq(seq);
      }}
    >
      {jump ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center">
          <span role="status" className="nb-tag shadow-sm">Finding {new Date(jump.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}…</span>
        </div>
      ) : bannerOpen && unreadAtOpen && onMarkRead ? (
        <div className="absolute inset-x-3 top-2 z-20 flex items-center gap-1 rounded-md border border-[var(--status-info)]/30 bg-[var(--status-info-soft)] py-1 pl-3 pr-1 text-[13px] text-foreground shadow-sm">
          <button type="button" onClick={toFirstUnread} className="min-w-0 flex-1 truncate text-left font-medium hover:underline">
            {unreadAtOpen.count}{unreadAtOpen.more ? "+" : ""} new message{unreadAtOpen.count === 1 && !unreadAtOpen.more ? "" : "s"} since {formatChatTime(unreadAtOpen.since, "at")}
          </button>
          <Button type="button" variant="ghost" size="sm" onClick={markRead} className="flex-none pointer-coarse:h-11">Mark as read</Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setBannerOpen(false)} className="flex-none pointer-coarse:size-11" aria-label="Dismiss"><X size={16} /></Button>
        </div>
      ) : topDay ? (
        <div className="pointer-events-none absolute inset-x-0 top-1 z-10 flex justify-center">
          <span className="pointer-events-auto"><DayLabel label={topDay} onPick={pickDate} /></span>
        </div>
      ) : null}
      <Virtuoso<TimelineItem, TimelineContext>
        ref={virtuoso}
        context={{ hasOlder, loadingOlder, olderError, loadOlder, intro, typing }}
        className="app-scroll app-scroll-y h-full"
        data={items}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={initialIndex}
        computeItemKey={(_index, item) => item.key}
        itemContent={renderItem}
        followOutput={(bottom) => (bottom ? "smooth" : false)}
        atBottomStateChange={(bottom) => {
          setAtBottom(bottom);
          if (bottom) setUnseen(0);
        }}
        atBottomThreshold={80}
        startReached={() => {
          if (hasOlder && !loadingOlder) loadOlder();
        }}
        rangeChanged={({ startIndex }) => {
          const local = startIndex - firstItemIndex;
          for (let i = Math.min(local, items.length - 1); i >= 0; i -= 1) {
            const item = items[i];
            if (item?.type === "day") {
              setTopDay(i === local ? null : item.label);
              return;
            }
          }
          setTopDay(null);
        }}
        components={COMPONENTS}
      />
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
    {!atBottom || behindLatest ? <LatestBar onClick={toLatest} unseen={unseen} label="Jump to latest" /> : null}
    </>
  );
}
