"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ChevronDown } from "lucide-react";

import { MessageRow } from "@/components/messages/MessageRow";
import { buildTimeline, type TimelineItem } from "@/lib/messaging/timeline";
import type { ChatMessageView } from "@/lib/messaging/types";

const START_INDEX = 1_000_000;
const HIGHLIGHT_MS = 2_500;

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
};

function DayLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border" />
      <span className="font-mono text-[12px] text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Virtualized timeline (Virtuoso prepend pattern): older pages prepend without
 * moving the reader, new messages follow only when already at the bottom.
 */
export function Timeline({ messages, lastReadSeq, meId, hasOlder, loadingOlder, loadOlder, intro, highlightSeq, onSeen }: Props) {
  const virtuoso = useRef<VirtuosoHandle>(null);
  // The divider stays where it was when the channel opened, not where the cursor moves to.
  const [dividerSeq] = useState(lastReadSeq);
  const items = useMemo(() => buildTimeline(messages, { lastReadSeq: dividerSeq, meId }), [dividerSeq, meId, messages]);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  // ponytail: a floating day label, no jump-to-date (L-29). upgrade: seq-by-date lookup per channel.
  const [topDay, setTopDay] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(highlightSeq ?? null);

  // Prepend bookkeeping: shift firstItemIndex by how many items appeared above the old first item.
  const head = items[0]?.key ?? null;
  const [prepend, setPrepend] = useState({ head, first: START_INDEX });
  let firstItemIndex = prepend.first;
  if (head !== prepend.head) {
    const previous = prepend.head ? items.findIndex((item) => item.key === prepend.head) : -1;
    firstItemIndex = previous > 0 ? prepend.first - previous : prepend.first;
    setPrepend({ head, first: firstItemIndex });
  }

  const newestSeq = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]!.seq > 0) return messages[i]!.seq;
    return 0;
  }, [messages]);
  const lastCount = useRef(messages.length);
  useEffect(() => {
    const added = messages.length - lastCount.current;
    lastCount.current = messages.length;
    if (added > 0 && !atBottom) setUnseen((n) => n + added);
  }, [atBottom, messages.length]);
  useEffect(() => {
    if (atBottom && newestSeq > 0) onSeen(newestSeq);
  }, [atBottom, newestSeq, onSeen]);
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  // Only the first render positions the list.
  const [initialIndex] = useState(() => {
    if (highlightSeq) {
      const index = items.findIndex((item) => item.type === "message" && item.message.seq === highlightSeq);
      if (index >= 0) return { index, align: "center" as const };
    }
    const divider = items.findIndex((item) => item.type === "new");
    return divider >= 0 ? { index: divider, align: "start" as const } : { index: Math.max(0, items.length - 1), align: "end" as const };
  });

  const toLatest = useCallback(() => {
    virtuoso.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
    setUnseen(0);
  }, []);

  const renderItem = useCallback((_index: number, item: TimelineItem) => {
    if (item.type === "day") return <DayLabel label={item.label} />;
    if (item.type === "new") {
      return (
        <div className="flex items-center gap-3 px-4 py-1" role="separator" aria-label="New messages">
          <span className="h-px flex-1 bg-[var(--chat-accent)]" />
          <span className="font-mono text-[11px] uppercase text-[var(--chat-accent)]">New</span>
        </div>
      );
    }
    return <MessageRow message={item.message} grouped={item.grouped} highlighted={highlight === item.message.seq} />;
  }, [highlight]);

  return (
    <div className="relative min-h-0 flex-1" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
      {topDay ? (
        <div className="pointer-events-none absolute inset-x-0 top-1 z-10 flex justify-center">
          <span className="rounded-[3px] border border-border bg-card px-2 py-0.5 font-mono text-[12px] text-muted-foreground">{topDay}</span>
        </div>
      ) : null}
      <Virtuoso
        ref={virtuoso}
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
        components={{
          Header: () => (hasOlder ? <div className="py-3 text-center text-[12px] text-muted-foreground">{loadingOlder ? "Loading earlier messages…" : ""}</div> : <>{intro}</>),
          Footer: () => <div className="h-3" />,
        }}
      />
      {!atBottom ? (
        <button type="button" onClick={toLatest} aria-label={unseen ? `Jump to latest, ${unseen} new` : "Jump to latest"} className="absolute bottom-3 right-4 z-10 inline-flex h-10 items-center gap-1 rounded-full border border-border bg-card px-3 text-[13px] shadow-md">
          <ChevronDown size={16} />
          {unseen ? <span className="nb-chat-count">{unseen > 99 ? "99+" : unseen}</span> : null}
        </button>
      ) : null}
    </div>
  );
}
