"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Clock, FileUp, Star, Timer } from "lucide-react";

import { readMyWeekAction, setDayPinAction } from "@/app/actions/my-week";
import { useUIStore } from "@/stores/ui-store";
import { toast } from "@/lib/feedback";
import { examStrip, groupWeek, type WeekItem } from "@/lib/organizations/my-week";

// Report 30.4 W3 (plan B1.7a): the Week view in My work — Pinned for today, Today, Tomorrow, the rest of the week
// (folded), then Missing. Only the viewer's own rows; nothing is typed twice.
export const MY_WEEK_KEY = ["my-week"] as const;
const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
export const useMyWeek = (enabled = true) => useQuery({ queryKey: MY_WEEK_KEY, queryFn: () => readMyWeekAction(viewerZone()), staleTime: 60_000, enabled });

const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const ICON = { session: Clock, office: Clock, prep: BookOpen, copy: FileUp, task: FileUp, teaching: Clock, review: FileUp } as const;

function Row({ item, pinned, onPin, close }: { item: WeekItem; pinned: boolean; onPin: (item: WeekItem, on: boolean) => void; close: () => void }) {
  const Icon = ICON[item.kind];
  const timed = item.kind !== "copy" && item.kind !== "task";
  return (
    <li className="flex items-center gap-1">
      <Link href={item.href ?? "#"} onClick={close} className="nb-mw-item min-w-0 flex-1">
        <span className="nb-mw-icon"><Icon className="size-[15px]" aria-hidden="true" /></span>
        <span className="min-w-0"><b className={item.status === "Cancelled" ? "line-through" : undefined}>{item.title}</b>
          <span className="nb-mw-sub">{[item.context, item.status].filter(Boolean).join(" · ")}</span></span>
        {item.kind === "review" ? <span /> : <span className="nb-mw-when"><time dateTime={item.at}>{timed ? TIME.format(new Date(item.at)) : `due ${TIME.format(new Date(item.at))}`}</time></span>}
      </Link>
      {item.taskId ? (
        <button type="button" className="nb-mw-ib shrink-0" aria-pressed={pinned} aria-label={`${pinned ? "Unpin" : "Pin for today"}: ${item.title}`} title={pinned ? "Unpin" : "Pin for today"} onClick={() => onPin(item, !pinned)}>
          <Star className="size-[14px]" aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
        </button>
      ) : null}
    </li>
  );
}

export function MyWorkWeek({ keepOpen }: { keepOpen: boolean }) {
  const client = useQueryClient();
  const q = useMyWeek();
  const setMyWorkOpen = useUIStore((s) => s.setMyWorkOpen);
  const [rest, setRest] = useState(false);
  const data = q.data?.success ? q.data : null;
  const days = useMemo(() => (data ? groupWeek(data.items, data.timeZone) : []), [data]);
  if (q.isPending) return <div role="status" aria-label="Loading your week" className="space-y-2 p-3">{[0, 1, 2].map((i) => <div key={i} className="nb-skeleton h-10 rounded-md" aria-hidden="true" />)}</div>;
  if (!data) return <p className="p-3 text-[13px] text-muted-foreground">Couldn’t load your week. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => void q.refetch()}>Try again</button></p>;
  const close = () => { if (!keepOpen) setMyWorkOpen(false); };
  const pinned = new Set(data.pins);
  const onPin = async (item: WeekItem, on: boolean) => {
    const r = await setDayPinAction(item.taskId!, on, data.timeZone);
    if (!r.success) return void toast.error(r.error);
    await client.invalidateQueries({ queryKey: MY_WEEK_KEY });
  };
  const all = [...data.items, ...data.missing];
  const pins = data.pins.map((id) => all.find((i) => i.taskId === id)).filter((i): i is WeekItem => Boolean(i));
  const exam = examStrip(data.exams, data.timeZone);
  const day = (d: (typeof days)[number], index: number) => (
    <section key={d.day} className="nb-mw-sec" style={{ ["--n" as string]: index + 4 }} aria-label={`${d.label}, ${d.items.length + d.more} ${d.items.length + d.more === 1 ? "item" : "items"}`}>
      <div className="nb-mw-sec-h">{d.label}{d.items.length ? <> · <b>{d.items.length + d.more}</b></> : null}</div>
      {d.items.length ? (
        <ul className="nb-mw-list">{d.items.map((i) => <Row key={i.id} item={i} pinned={Boolean(i.taskId && pinned.has(i.taskId))} onPin={onPin} close={close} />)}</ul>
      ) : <p className="px-3 py-1.5 text-[13px] text-muted-foreground">Nothing scheduled.</p>}
      {d.more ? <p className="px-3 text-[12px] text-muted-foreground">+{d.more} more</p> : null}
    </section>
  );
  return (
    <div data-testid="my-week">
      {exam ? (
        <Link href={exam.href} onClick={close} className="nb-mw-item" data-testid="exam-strip" style={{ ["--n" as string]: 3 }}>
          <span className="nb-mw-icon"><Timer className="size-[15px]" aria-hidden="true" /></span>
          <span className="min-w-0"><b>{exam.title}</b><span className="nb-mw-sub">{exam.context}</span></span>
          <span className="nb-mw-when">{exam.when}</span>
        </Link>
      ) : null}
      {pins.length ? (
        <section className="nb-mw-sec" aria-label="Pinned for today">
          <div className="nb-mw-sec-h">Pinned for today · <b>{pins.length}</b></div>
          <ul className="nb-mw-list">{pins.map((i) => <Row key={`pin-${i.id}`} item={i} pinned onPin={onPin} close={close} />)}</ul>
        </section>
      ) : null}
      {days.slice(0, 2).map(day)}
      {rest ? days.slice(2).map((d, i) => day(d, i + 2)) : (
        <button type="button" className="nb-mw-sec-h w-full text-left" onClick={() => setRest(true)} aria-expanded={false}>
          {days.slice(2).map((d) => d.label.split(" ")[0]).join(" · ")} · <b>{days.slice(2).reduce((n, d) => n + d.items.length + d.more, 0)} more</b>
        </button>
      )}
      {data.missing.length ? (
        <section className="nb-mw-sec" aria-label={`Missing, ${data.missing.length}`}>
          <div className="nb-mw-sec-h" data-tone="late">Missing · <b>{data.missing.length}</b></div>
          <ul className="nb-mw-list">{data.missing.map((i) => <Row key={i.id} item={i} pinned={Boolean(i.taskId && pinned.has(i.taskId))} onPin={onPin} close={close} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}
