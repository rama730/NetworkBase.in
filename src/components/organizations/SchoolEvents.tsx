"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Repeat } from "lucide-react";

import { createEventAction, readEventsAction, readPublicEventsAction, setEventStatusAction } from "@/app/actions/school-events";
import { ImportCalendar } from "@/components/organizations/SchoolCalendarTools";
import { FeedLink } from "@/components/workspaces/doc/FeedLink";
import { StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { EVENT_STATUS, EVENT_TYPES, type EventType } from "@/lib/organizations/school-events";
import { cn } from "@/lib/utils";

// Report 32.2 S1 (plan B3.1b): school and class events — Upcoming with Mine and For me, + Event, status; public events.
const DAYF = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (d: string) => DAYF.format(new Date(`${d}T00:00:00Z`));
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
type Status = keyof typeof EVENT_STATUS;

export function EventsView({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const from = today(), to = addDays(from, 120);
  const q = useQuery({ queryKey: ["school-events", orgId, from], queryFn: () => readEventsAction(orgId, from, to), staleTime: 30_000 });
  const [filter, setFilter] = useState<"all" | "forMe">("all");
  const [open, setOpen] = useState<"add" | "import" | "subscribe" | null>(null);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading events…</p>;
  if (!q.data?.success) return <ErrorNotice what="Events" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const items = d.items.filter((e) => filter === "all" || e.forMe);
  const refresh = () => client.invalidateQueries({ queryKey: ["school-events", orgId] });
  return (
    <section aria-label="Events" className="space-y-3 text-[13px]" data-testid="events-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Events filter" className="inline-flex rounded-md border border-border p-0.5 text-[12px]">
          {(["all", "forMe"] as const).map((v) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={cn("rounded-sm px-2.5 py-1", filter === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>{v === "all" ? "All" : "For me"}</button>)}
        </div>
        <span className="flex flex-wrap gap-2">
          <button type="button" className={FORM_SECONDARY_CLASS} aria-pressed={open === "subscribe"} onClick={() => setOpen(open === "subscribe" ? null : "subscribe")}>Subscribe</button>
          {d.canAdd && d.isSchool ? <button type="button" className={FORM_SECONDARY_CLASS} aria-pressed={open === "import"} onClick={() => setOpen(open === "import" ? null : "import")}>Import…</button> : null}
          {d.canAdd ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setOpen(open === "add" ? null : "add")}>+ Event</button> : null}
        </span>
      </div>
      {open === "add" ? <NewEvent orgId={orgId} onDone={() => { setOpen(null); void refresh(); }} /> : null}
      {open === "import" ? <ImportCalendar schoolId={orgId} onDone={() => { setOpen(null); void refresh(); void client.invalidateQueries({ queryKey: ["school-year", orgId] }); }} /> : null}
      {open === "subscribe" ? <FeedLink /> : null}
      {items.length === 0 ? <p className="text-muted-foreground">No events in the next four months.</p> : (
        <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Upcoming events" tabIndex={0}>
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Event</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Place</th><th className="px-3 py-2 font-medium">Status</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={`${e.id}-${e.day}`} className={cn("border-b border-border last:border-0", e.stage === "cancelled" && "text-muted-foreground line-through")} data-testid="event-row">
                  <td className="px-3 py-2 font-mono">{fmt(e.day)}{e.time ? ` ${e.time}` : ""}</td>
                  <td className="px-3 py-2"><span className="inline-flex flex-wrap items-center gap-1.5">{e.title}
                    {e.repeats ? <Repeat className="size-3 text-muted-foreground" aria-label="Repeats" /> : null}
                    {e.public ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Globe className="size-3" aria-hidden="true" />Public</span> : null}
                    {e.fromSchool ? <span className="text-muted-foreground">· Set by {d.schoolTitle ?? "the school"}</span> : null}
                    {e.forMe ? <StatusBadge state="new">For me</StatusBadge> : null}</span></td>
                  <td className="px-3 py-2">{EVENT_TYPES[e.type as EventType]}</td>
                  <td className="px-3 py-2">{e.place || "—"}</td>
                  <td className="px-3 py-2">{d.canAdd && !e.fromSchool ? (
                    <select className="nb-select" data-size="sm" aria-label={`Status of ${e.title} on ${fmt(e.day)}`} value={e.stage}
                      onChange={(ev) => void setEventStatusAction(orgId, e.id, ev.target.value as Status).then((r) => { if (!r.success) return void toast.error(r.error); void refresh(); })}>
                      {(Object.keys(EVENT_STATUS) as Status[]).map((s) => <option key={s} value={s}>{EVENT_STATUS[s]}</option>)}
                    </select>
                  ) : EVENT_STATUS[e.stage as Status] ?? e.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NewEvent({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [f, setF] = useState({ title: "", type: "event" as EventType, date: "", time: "", place: "", repeat: false, every: "1", until: "", public: false, audience: "everyone" as "everyone" | "admins" });
  const save = async () => {
    const fields = { type: f.type, date: f.date, time: f.time || null, place: f.place, public: f.public,
      audience: f.audience === "everyone" ? { mode: "everyone", classIds: [], roles: [] } : { mode: "roles", classIds: [], roles: ["admin"] },
      repeat: f.repeat ? { every: Number(f.every) || 1, until: f.until } : null };
    const r = await createEventAction(orgId, f.title, fields);
    if (!r.success) return void toast.error(r.error);
    toast.success("Event added");
    onDone();
  };
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="new-event">
      <span className="flex flex-wrap gap-2">
        <Input value={f.title} maxLength={200} placeholder="Event" aria-label="Event name" onChange={(e) => setF({ ...f, title: e.target.value })} className="w-[220px]" />
        <select className="nb-select" data-size="sm" aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as EventType })}>{(Object.keys(EVENT_TYPES) as EventType[]).map((t) => <option key={t} value={t}>{EVENT_TYPES[t]}</option>)}</select>
        <Input type="date" value={f.date} aria-label="Date" onChange={(e) => setF({ ...f, date: e.target.value })} className="w-[160px] font-mono" />
        <Input type="time" value={f.time} aria-label="Time" onChange={(e) => setF({ ...f, time: e.target.value })} className="w-[120px] font-mono" />
        <Input value={f.place} maxLength={120} placeholder="Place" aria-label="Place" onChange={(e) => setF({ ...f, place: e.target.value })} className="w-[160px]" />
      </span>
      <span className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">Audience
          <select className="nb-select" data-size="sm" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as "everyone" | "admins" })}><option value="everyone">Everyone</option><option value="admins">Admins only</option></select></label>
        <label className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.checked })} />Repeats weekly (skips holidays)</label>
        {f.repeat ? <>every <Input type="number" min={1} max={8} value={f.every} aria-label="Every how many weeks" onChange={(e) => setF({ ...f, every: e.target.value })} className="w-[60px] font-mono" /> weeks until
          <Input type="date" value={f.until} aria-label="Repeats until" onChange={(e) => setF({ ...f, until: e.target.value })} className="w-[160px] font-mono" /></> : null}
        <label className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={f.public} onChange={(e) => setF({ ...f, public: e.target.checked })} />Show publicly</label>
      </span>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.title.trim() || !f.date} onClick={() => void save()}>Add event</button><button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
    </div>
  );
}

/** School About: public events and holidays only (call 8). */
export function PublicCalendar({ schoolId }: { schoolId: string }) {
  const q = useQuery({ queryKey: ["public-events", schoolId], queryFn: () => readPublicEventsAction(schoolId), staleTime: 300_000 });
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.items.length && !d.holidays.length)) return null;
  return (
    <section aria-label="School calendar" className="space-y-2" data-testid="public-calendar">
      <h2 className="nb-section-title">Calendar</h2>
      <p className="text-[12px] text-muted-foreground">Public events and holidays. <a className="text-primary hover:underline" href={`/api/feeds/school/${schoolId}.ics`}>Subscribe to this calendar</a></p>
      <ul className="space-y-1 text-[13px]">
        {d.items.map((e, i) => <li key={i}><span className="font-mono">{fmt(e.day)}{e.time ? ` ${e.time}` : ""}</span> · {e.title}{e.place ? ` · ${e.place}` : ""}</li>)}
        {d.holidays.map((h) => <li key={h.start} className="text-muted-foreground"><span className="font-mono">{fmt(h.start)} – {fmt(h.end)}</span> · {h.name}</li>)}
      </ul>
    </section>
  );
}
