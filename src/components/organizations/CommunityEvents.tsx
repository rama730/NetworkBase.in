"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Users, Video } from "lucide-react";

import { cancelCommunityEventAction, checkInCommunityAction, decideTalkAction, proposeTalkAction, readEventTalksAction, saveEventLinksAction, readCommunityCalendarAction, readCommunityEventAction, readCommunityEventsAction, rsvpCommunityEventAction, saveCommunityEventAction } from "@/app/actions/community-events";
import { StatusBadge } from "@/components/organizations/org-ui";
import { CommunityRituals } from "@/components/organizations/CommunityRituals";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { calendarCells, shiftMonth } from "@/lib/workflows/planner";
import { EVENT_FORMATS, mapsHref, type EventFormat, type EventState } from "@/lib/organizations/community-events";

// Report 34.4 (plan B5.3a, M3): Sprints → Events in a community — Upcoming and Past, the event page with Going and
// Can't go (and the waitlist), and + Event for organisers and Hosts.
const listKey = (orgId: string, when: string) => ["community-events", orgId, when] as const;
const STATE_WORD: Record<EventState, string> = { published: "Open", full: "Full · waitlist open", happening: "Happening now", ended: "Ended", cancelled: "Cancelled" };
const when = (start: string, end: string) => {
  const d = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const t = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  return `${d.format(new Date(start))} to ${t.format(new Date(end))}`;
};

/** A community's Sprints: Events first, the sprints themselves a click away. */
export function CommunitySprints({ orgId, me, children }: { orgId: string; me?: string | null; children: ReactNode }) {
  const [view, setView] = useState<"events" | "rituals" | "sprints">(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "rituals" ? "rituals" : "events"));
  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-[13px]" role="group" aria-label="Sprints views">
        {(["events", "rituals", "sprints"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>{v === "events" ? "Events" : v === "rituals" ? "Rituals" : "Sprints"}</button>
        ))}
      </div>
      {view === "events" ? <CommunityEvents orgId={orgId} /> : view === "rituals" ? <CommunityRituals orgId={orgId} me={me ?? null} /> : children}
    </div>
  );
}

export function CommunityEvents({ orgId }: { orgId: string }) {
  const [tab, setTab] = useState<"upcoming" | "past" | "calendar">("upcoming");
  const [open, setOpen] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("event")));
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const q = useQuery({ queryKey: listKey(orgId, tab === "past" ? "past" : "upcoming"), queryFn: () => readCommunityEventsAction(orgId, tab === "past" ? "past" : "upcoming"), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading events…</p>;
  if (!q.data?.success) return <ErrorNotice what="Events" onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <section aria-label="Events" className="space-y-3 text-[13px]" data-testid="community-events">
      {d.canCreate ? <div className="flex justify-end"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setEditing("new")}>+ Event</button></div> : null}
      <div>
        <UnderlineTabs tabs={[{ key: "upcoming" as const, label: "Upcoming" }, { key: "calendar" as const, label: "Calendar" }, { key: "past" as const, label: "Past" }]} value={tab} onChange={setTab} label="Events" idPrefix="community-events" />
      </div>
      {tab === "calendar" ? <EventCalendar orgId={orgId} onOpen={setOpen} /> : d.events.length ? (
        <ul className="space-y-2" aria-label={tab === "upcoming" ? "Upcoming events" : "Past events"}>
          {d.events.map((e) => (
            <li key={e.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border p-3 text-left hover:bg-muted" onClick={() => setOpen(e.id)} data-testid="event-row">
                <span className="font-mono text-muted-foreground"><CalendarDays className="mr-1 inline size-3.5" aria-hidden="true" />{when(e.start, e.end)}</span>
                <span className="min-w-[140px] flex-1 font-medium">{e.title}</span>
                <span className="text-muted-foreground">{EVENT_FORMATS[e.format as EventFormat]}{e.place ? ` · ${e.place}` : ""}</span>
                <span className="font-mono">{e.going} going{e.placesLeft !== null ? ` · ${e.placesLeft} ${e.placesLeft === 1 ? "place" : "places"} left` : ""}</span>
                {e.state !== "published" ? <StatusBadge state={e.state === "cancelled" ? "at_risk" : "neutral"}>{STATE_WORD[e.state]}</StatusBadge> : null}
                {e.mine === "going" ? <StatusBadge state="active">Going</StatusBadge> : e.mine === "waitlisted" ? <StatusBadge state="neutral">Waitlist</StatusBadge> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="py-4 text-muted-foreground">{tab === "upcoming" ? (d.canCreate ? "No events yet. Add the first with + Event." : "No events coming up.") : "No past events yet."}</p>}
      {open ? <EventPage orgId={orgId} eventId={open} onClose={() => setOpen(null)} onEdit={(id) => { setOpen(null); setEditing(id); }} /> : null}
      {editing ? <EventForm orgId={orgId} eventId={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function EventPage({ orgId, eventId, onClose, onEdit }: { orgId: string; eventId: string; onClose: () => void; onEdit: (id: string) => void }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["community-event", orgId, eventId], queryFn: () => readCommunityEventAction(orgId, eventId) });
  const [priv, setPriv] = useState(false);
  const refresh = () => { void q.refetch(); void client.invalidateQueries({ queryKey: ["community-events", orgId] }); };
  const rsvp = async (choice: "going" | "cant_go") => {
    const r = await rsvpCommunityEventAction(orgId, eventId, { choice, private: priv });
    if (!r.success) return void toast.error(r.error);
    toast.success(r.state === "going" ? "You’re going" : r.state === "waitlisted" ? "You’re on the waitlist" : "Marked as can’t go");
    refresh();
  };
  const checkIn = async (person: string, on: boolean) => {
    const r = await checkInCommunityAction(orgId, eventId, person, on);
    if (!r.success) toast.error(r.error);
  };
  const cancel = async () => {
    const r = await cancelCommunityEventAction(orgId, eventId);
    if (!r.success) return void toast.error(r.error);
    toast.success("Event cancelled. Everyone going has been told.");
    refresh();
  };
  const e = q.data?.success ? q.data.event : null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="wide">
        <DialogHeader><DialogTitle>{e?.title ?? "Event"}</DialogTitle></DialogHeader>
        {q.isPending ? <p role="status" className="nb-waiting text-[13px] text-muted-foreground"><PixelBeat />Loading the event…</p>
          : !q.data?.success || !e ? <ErrorNotice what="The event" onRetry={() => void q.refetch()} />
          : (
            <div className="grid gap-4 text-[13px] sm:grid-cols-[1fr_220px]" data-testid="event-page">
              <div className="space-y-3">
                {e.description ? <p className="whitespace-pre-wrap">{e.description}</p> : null}
                {e.state !== "cancelled" ? <Talks orgId={orgId} eventId={e.id} open={e.state === "published" || e.state === "full"} onAccepted={refresh} /> : null}
                {e.after.length ? <div><h3 className="font-medium">Slides and recordings</h3><ul className="mt-1 space-y-0.5">{e.after.map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer" className="nb-link">{l.label}</a></li>)}</ul></div> : null}
                {e.canEdit && e.state === "ended" ? <AfterLinks orgId={orgId} eventId={e.id} links={e.after} onSaved={refresh} /> : null}
                {e.runOfShow.length ? <div><h3 className="font-medium">Run of show</h3><ol className="mt-1 space-y-0.5">{e.runOfShow.map((s, i) => <li key={i}><span className="font-mono">{s.time}</span> {s.title}</li>)}</ol></div> : null}
                {q.data.people.length ? <div><h3 className="font-medium"><Users className="mr-1 inline size-3.5" aria-hidden="true" />Going</h3>
                  {q.data.hostView && (e.state === "happening" || Date.parse(e.start) - Date.now() < 3_600_000) && e.state !== "cancelled"
                    ? <ul className="mt-1 space-y-1" aria-label="Check in">{q.data.people.map((p) => (
                        <li key={p.id}><label className="flex items-center gap-2"><input type="checkbox" className="nb-check" defaultChecked={p.checkedIn} onChange={(x) => void checkIn(p.id, x.target.checked)} />{p.name}{p.private ? <span className="text-muted-foreground"> (private)</span> : null}</label></li>))}</ul>
                    : <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{q.data.people.map((p) => <li key={p.id}>{p.name}{p.private ? <span className="text-muted-foreground"> (private)</span> : null}</li>)}</ul>}</div> : null}
                {q.data.hostView && q.data.waitlist.length ? <div><h3 className="font-medium">Waitlist</h3><ol className="mt-1 list-decimal pl-5">{q.data.waitlist.map((p) => <li key={p.id}>{p.name}</li>)}</ol></div> : null}
              </div>
              <aside className="space-y-3 rounded-md border border-border p-3" aria-label="When and where">
                <p><span className="block text-muted-foreground">When</span>{when(e.start, e.end)}</p>
                <p><span className="block text-muted-foreground">Where</span>
                  {e.format !== "online" && e.place ? <>{e.place} · <a href={mapsHref(e.place)} target="_blank" rel="noopener noreferrer" className="nb-link"><MapPin className="mr-0.5 inline size-3.5" aria-hidden="true" />Open in maps</a></> : null}
                  {e.format !== "in_person" ? <span className="block">{e.link ? <a href={e.link} target="_blank" rel="noopener noreferrer" className="nb-link"><Video className="mr-0.5 inline size-3.5" aria-hidden="true" />Join online</a> : e.hasLink ? <span className="text-muted-foreground">The online link shows when you’re going.</span> : <span className="text-muted-foreground">Online</span>}</span> : null}
                </p>
                <p className="font-mono">{e.going} going{e.placesLeft !== null ? ` · ${e.placesLeft} ${e.placesLeft === 1 ? "place" : "places"} left` : ""}{e.waitlisted ? ` · ${e.waitlisted} waiting` : ""}</p>
                {e.state === "cancelled" || e.state === "ended" ? <StatusBadge state={e.state === "cancelled" ? "at_risk" : "neutral"}>{STATE_WORD[e.state]}</StatusBadge> : (
                  <div className="space-y-2">
                    <p aria-live="polite">{e.mine === "going" ? "You’re going." : e.mine === "waitlisted" ? `You’re number ${e.position} on the waitlist.` : e.mine === "cant_go" ? "You can’t go." : null}</p>
                    <div className="flex gap-2" role="group" aria-label="RSVP">
                      <button type="button" aria-pressed={e.mine === "going" || e.mine === "waitlisted"} className={e.mine === "cant_go" ? FORM_SECONDARY_CLASS : FORM_PRIMARY_CLASS} onClick={() => void rsvp("going")}>{e.state === "full" && e.mine !== "going" ? "Join the waitlist" : "Going"}</button>
                      <button type="button" aria-pressed={e.mine === "cant_go"} className={e.mine === "cant_go" ? FORM_PRIMARY_CLASS : FORM_SECONDARY_CLASS} onClick={() => void rsvp("cant_go")}>Can’t go</button>
                    </div>
                    <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={priv} onChange={(x) => setPriv(x.target.checked)} />RSVP privately (counted, not named)</label>
                  </div>
                )}
                {e.canEdit && e.state !== "cancelled" ? <div className="flex gap-2 border-t border-border pt-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => onEdit(e.id)}>Edit</button><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void cancel()}>Cancel event</button></div> : null}
              </aside>
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** + Event and Edit: title, when, format, place or link, who can come, place limit, run of show. */
function EventForm({ orgId, eventId, onClose }: { orgId: string; eventId: string | null; onClose: () => void }) {
  const client = useQueryClient();
  const existing = useQuery({ queryKey: ["community-event", orgId, eventId], queryFn: () => readCommunityEventAction(orgId, eventId!), enabled: Boolean(eventId) });
  const e = existing.data?.success ? existing.data.event : null;
  if (eventId && !e) return null;
  const start = e ? localInput(e.start) : localInput(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 11) + "18:00:00");
  return <EventFormBody orgId={orgId} eventId={eventId} onClose={onClose} client={client} initial={{
    title: e?.title ?? "", description: e?.description ?? "", start, end: e ? localInput(e.end) : start.slice(0, 11) + "20:00",
    format: (e?.format ?? "in_person") as EventFormat, place: e?.place ?? "", link: e?.link ?? "", who: (e?.who ?? "members") as "members" | "public",
    limit: e?.placeLimit ? String(e.placeLimit) : "", hosts: e?.hosts ?? [], runOfShow: e?.runOfShow.map((s) => `${s.time} ${s.title}`).join("\n") ?? "",
  }} />;
}

type FormState = { title: string; description: string; start: string; end: string; format: EventFormat; place: string; link: string; who: "members" | "public"; limit: string; hosts: string[]; runOfShow: string };
function EventFormBody({ orgId, eventId, onClose, client, initial }: { orgId: string; eventId: string | null; onClose: () => void; client: ReturnType<typeof useQueryClient>; initial: FormState }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const runOfShow = f.runOfShow.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ time: l.slice(0, 5), title: l.slice(5).trim() }));
    if (runOfShow.some((s) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) || !s.title)) return void toast.error("Write each run of show line as 19:00 Hello.");
    setBusy(true);
    const r = await saveCommunityEventAction(orgId, eventId, {
      title: f.title, description: f.description.trim() || null, link: f.link.trim() || null, placeLimit: f.limit ? Number(f.limit) : null,
      fields: { kind: "community", start: new Date(f.start).toISOString(), end: new Date(f.end).toISOString(), format: f.format, place: f.place.trim() || null, who: f.who, hosts: f.hosts, runOfShow },
    });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(eventId ? "Event saved" : "Event added");
    void client.invalidateQueries({ queryKey: ["community-events", orgId] });
    void client.invalidateQueries({ queryKey: ["community-event", orgId] });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="form">
        <DialogHeader><DialogTitle>{eventId ? "Edit event" : "New event"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]" data-testid="event-form">
          <label className="block">Title<Input value={f.title} maxLength={200} onChange={(x) => setF({ ...f, title: x.target.value })} /></label>
          <label className="block">Description<textarea className="nb-textarea mt-1 w-full" rows={3} maxLength={5000} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></label>
          <span className="flex flex-wrap gap-3">
            <label>Starts<Input type="datetime-local" value={f.start} onChange={(x) => setF({ ...f, start: x.target.value })} className="font-mono" /></label>
            <label>Ends<Input type="datetime-local" value={f.end} onChange={(x) => setF({ ...f, end: x.target.value })} className="font-mono" /></label>
          </span>
          <fieldset className="flex flex-wrap gap-4"><legend className="mb-1">Format</legend>
            {(Object.keys(EVENT_FORMATS) as EventFormat[]).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="format" checked={f.format === k} onChange={() => setF({ ...f, format: k })} />{EVENT_FORMATS[k]}</label>)}
          </fieldset>
          {f.format !== "online" ? <label className="block">Where (an address people can find)<Input value={f.place} maxLength={200} onChange={(x) => setF({ ...f, place: x.target.value })} /></label> : null}
          {f.format !== "in_person" ? <label className="block">Online link (shown only to people going)<Input value={f.link} maxLength={500} placeholder="https://" onChange={(x) => setF({ ...f, link: x.target.value })} /></label> : null}
          <fieldset className="flex flex-wrap gap-4"><legend className="mb-1">Who can come</legend>
            <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="who" checked={f.who === "members"} onChange={() => setF({ ...f, who: "members" })} />Members</label>
            <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="who" checked={f.who === "public"} onChange={() => setF({ ...f, who: "public" })} />Members and the public page</label>
          </fieldset>
          <label className="block">Place limit (optional; a waitlist opens when it’s full)<Input type="number" min={1} value={f.limit} onChange={(x) => setF({ ...f, limit: x.target.value })} className="w-[120px] font-mono" /></label>
          <label className="block">Run of show (one per line, like 19:00 Hello)<textarea className="nb-textarea mt-1 w-full font-mono" rows={3} value={f.runOfShow} onChange={(x) => setF({ ...f, runOfShow: x.target.value })} /></label>
          <div className="flex justify-end gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={onClose}>Cancel</button><button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !f.title.trim()} onClick={() => void save()}>{eventId ? "Save" : "Add event"}</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The next event on About and the Overview (34.4 layer 1): when, title, where and the going count. */
export function NextEventCard({ orgId, base }: { orgId: string; base: string }) {
  const q = useQuery({ queryKey: listKey(orgId, "upcoming"), queryFn: () => readCommunityEventsAction(orgId, "upcoming"), staleTime: 60_000 });
  const next = q.data?.success ? q.data.events.find((e) => e.state !== "cancelled" && e.state !== "ended") : null;
  if (!next) return null;
  return (
    <section aria-label="Next event" className="space-y-1 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="next-event">
      <h3 className="font-medium">Next event</h3>
      <p><a href={`${base}?tab=sprints&event=${next.id}`} className="nb-link font-medium">{next.title}</a></p>
      <p className="font-mono text-muted-foreground">{when(next.start, next.end)}</p>
      <p className="text-muted-foreground">{EVENT_FORMATS[next.format as EventFormat]}{next.place ? ` · ${next.place}` : ""} · <span className="font-mono">{next.going} going</span>{next.mine === "going" ? " · You’re going" : ""}</p>
    </section>
  );
}

/** Calendar (34.4 layer 4): the month grid with every event, upcoming and past; a click opens the event. */
function EventCalendar({ orgId, onOpen }: { orgId: string; onOpen: (id: string) => void }) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const today = localDay(new Date().toISOString());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [only, setOnly] = useState("all");
  const q = useQuery({ queryKey: ["community-events", orgId, "calendar", month], queryFn: () => readCommunityCalendarAction(orgId, month), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the calendar…</p>;
  const d = q.data?.success ? q.data : { chapters: [], events: [] };
  const shown = d.events.filter((e) => only === "all" || (only === "here" ? !e.chapter : e.chapter?.id === only));
  const chapterOf = new Map(shown.filter((e) => e.chapter).map((e) => [e.id, e.chapter!]));
  const items = shown.map((e) => ({ id: e.id, dueDate: `${localDay(e.start)}T00:00:00.000Z`, label: e.chapter ? `${e.title} · ${e.chapter.title}` : e.title, time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(e.start)), cancelled: e.state === "cancelled" }));
  // A chapter's event opens on the chapter's own page (its RSVP and details live there).
  const open = (id: string) => { const c = chapterOf.get(id); if (c) window.location.assign(`/org/${encodeURIComponent(c.slug ?? c.id)}?tab=sprints`); else onOpen(id); };
  const weeks = calendarCells(month, items, today, 3);
  const title = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  return (
    <div className="space-y-3" data-testid="event-calendar">
      <div className="flex items-center gap-3">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMonth(shiftMonth(month, -1))}>Previous month</button>
        <h3 className="nb-card-title" aria-live="polite">{title}</h3>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMonth(shiftMonth(month, 1))}>Next month</button>
        {d.chapters.length ? <select aria-label="Show events from" value={only} onChange={(x) => setOnly(x.target.value)} className="nb-select ml-auto h-8 text-[12px]">
          <option value="all">All chapters</option><option value="here">This community</option>
          {d.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select> : null}
      </div>
      <table className="w-full table-fixed border-collapse text-[12px]">
        <caption className="sr-only">{title}: events by day</caption>
        <thead><tr>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => <th key={x} scope="col" className="py-1 text-left font-medium text-muted-foreground">{x}</th>)}</tr></thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.key}>
              {week.map((d) => (
                <td key={d.key} className={cn("h-20 border border-border p-1 align-top", !d.inMonth && "bg-muted text-muted-foreground")}>
                  <span className={cn("font-mono", d.isToday && "font-semibold text-primary")}>{d.day}</span>
                  <ul className="mt-1 space-y-0.5">
                    {d.items.map((it) => (
                      <li key={it.id}><button type="button" className={cn("w-full truncate text-left hover:underline", it.cancelled && "line-through text-muted-foreground")} onClick={() => open(it.id)}>
                        <span className="font-mono text-muted-foreground">{it.time}</span> {it.label}{it.cancelled ? <span className="sr-only"> (cancelled)</span> : null}</button></li>
                    ))}
                    {d.more ? <li className="text-muted-foreground">{d.more} more</li> : null}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** After the event (hosts, organisers): add a link to the slides or the recording. */
function AfterLinks({ orgId, eventId, links, onSaved }: { orgId: string; eventId: string; links: Array<{ label: string; url: string }>; onSaved: () => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const add = async () => {
    const r = await saveEventLinksAction(orgId, eventId, [...links, { label: label.trim(), url: url.trim() }]);
    if (!r.success) return void toast.error(r.error);
    setLabel(""); setUrl("");
    toast.success("Link added");
    onSaved();
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2" data-testid="event-after">
      <legend className="px-1">Add slides or a recording</legend>
      <Input value={label} maxLength={80} placeholder="Slides" aria-label="Link name" onChange={(x) => setLabel(x.target.value)} className="w-[140px]" />
      <Input value={url} maxLength={500} placeholder="https://" aria-label="Link" onChange={(x) => setUrl(x.target.value)} className="w-[240px]" />
      <button type="button" className={FORM_SECONDARY_CLASS} disabled={!label.trim() || !url.trim()} onClick={() => void add()}>Add link</button>
    </fieldset>
  );
}

/** Call for talks (B5.3d): accepted talks for everyone; Propose a talk before the event; hosts Accept into a slot or say Not this time. */
function Talks({ orgId, eventId, open, onAccepted }: { orgId: string; eventId: string; open: boolean; onAccepted: () => void }) {
  const q = useQuery({ queryKey: ["community-talks", orgId, eventId], queryFn: () => readEventTalksAction(orgId, eventId) });
  const [f, setF] = useState({ title: "", line: "", minutes: "5" });
  const [proposing, setProposing] = useState(false);
  const [slots, setSlots] = useState<Record<string, string>>({});
  if (!q.data?.success) return null;
  const { talks, host } = q.data;
  const accepted = talks.filter((t) => t.state === "accepted");
  const waiting = talks.filter((t) => t.state === "proposed");
  const mine = talks.filter((t) => t.mine && t.state !== "accepted");
  const propose = async () => {
    const r = await proposeTalkAction(orgId, eventId, { title: f.title, line: f.line.trim() || null, minutes: Number(f.minutes) });
    if (!r.success) return void toast.error(r.error);
    toast.success("Talk proposed. The hosts will let you know.");
    setF({ title: "", line: "", minutes: "5" }); setProposing(false);
    void q.refetch();
  };
  const decide = async (id: string, accept: boolean) => {
    const r = await decideTalkAction(orgId, id, { accept, slot: accept ? slots[id] ?? "" : null });
    if (!r.success) return void toast.error(accept && !slots[id] ? "Pick a time for the talk." : r.error);
    toast.success(accept ? "Talk accepted and added to the run of show" : "Not this time. They’ve been told kindly.");
    void q.refetch(); if (accept) onAccepted();
  };
  return (
    <div className="space-y-2" data-testid="event-talks">
      {accepted.length ? <div><h3 className="font-medium">Talks</h3><ul className="mt-1 space-y-0.5">{accepted.map((t) => <li key={t.id}><span className="font-mono">{t.slot}</span> “{t.title}” · {t.speaker} <span className="font-mono text-muted-foreground">{t.minutes} min</span></li>)}</ul></div> : null}
      {mine.length ? <p className="text-muted-foreground">Your proposals: {mine.map((t) => `“${t.title}” (${t.state === "declined" ? "not this time" : "waiting"})`).join(", ")}</p> : null}
      {host && waiting.length ? (
        <div><h3 className="font-medium">Proposed talks</h3>
          <ul className="mt-1 space-y-2">{waiting.map((t) => (
            <li key={t.id} className="space-y-1 rounded-md border border-border p-2" data-testid="talk-proposal">
              <p>“{t.title}” · {t.speaker} <span className="font-mono text-muted-foreground">{t.minutes} min</span></p>
              {t.line ? <p className="text-muted-foreground">{t.line}</p> : null}
              <span className="flex flex-wrap items-center gap-2">
                <Input type="time" aria-label={`Time for ${t.title}`} value={slots[t.id] ?? ""} onChange={(x) => setSlots({ ...slots, [t.id]: x.target.value })} className="w-[120px] font-mono" />
                <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void decide(t.id, true)}>Accept</button>
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void decide(t.id, false)}>Not this time</button>
              </span>
            </li>))}</ul></div>
      ) : null}
      {open ? (proposing ? (
        <fieldset className="space-y-2 rounded-md border border-border p-2" data-testid="propose-talk">
          <legend className="px-1">Propose a talk</legend>
          <Input value={f.title} maxLength={120} placeholder="Title" aria-label="Talk title" onChange={(x) => setF({ ...f, title: x.target.value })} />
          <Input value={f.line} maxLength={300} placeholder="One line about it (optional)" aria-label="About the talk" onChange={(x) => setF({ ...f, line: x.target.value })} />
          <label className="flex items-center gap-2">Length<Input type="number" min={1} max={120} value={f.minutes} onChange={(x) => setF({ ...f, minutes: x.target.value })} className="w-[80px] font-mono" />minutes</label>
          <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.title.trim()} onClick={() => void propose()}>Send proposal</button><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setProposing(false)}>Cancel</button></span>
        </fieldset>
      ) : <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setProposing(true)}>Propose a talk</button>) : null}
    </div>
  );
}
