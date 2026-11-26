"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Users, Video } from "lucide-react";

import { cancelCommunityEventAction, readCommunityEventAction, readCommunityEventsAction, rsvpCommunityEventAction, saveCommunityEventAction } from "@/app/actions/community-events";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
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
export function CommunitySprints({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [view, setView] = useState<"events" | "sprints">("events");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-[13px]" role="group" aria-label="Sprints views">
        {(["events", "sprints"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>{v === "events" ? "Events" : "Sprints"}</button>
        ))}
      </div>
      {view === "events" ? <CommunityEvents orgId={orgId} /> : children}
    </div>
  );
}

export function CommunityEvents({ orgId }: { orgId: string }) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [open, setOpen] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("event")));
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const q = useQuery({ queryKey: listKey(orgId, tab), queryFn: () => readCommunityEventsAction(orgId, tab), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading events…</p>;
  if (!q.data?.success) return <ErrorNotice what="Events" onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <section aria-label="Events" className="space-y-3 text-[13px]" data-testid="community-events">
      <div className="flex flex-wrap items-center gap-3">
        <UnderlineTabs tabs={[{ key: "upcoming" as const, label: "Upcoming" }, { key: "past" as const, label: "Past" }]} value={tab} onChange={setTab} label="Events" idPrefix="community-events" />
        {d.canCreate ? <button type="button" className={cn(FORM_PRIMARY_CLASS, "ml-auto")} onClick={() => setEditing("new")}>+ Event</button> : null}
      </div>
      {d.events.length ? (
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
                {e.runOfShow.length ? <div><h3 className="font-medium">Run of show</h3><ol className="mt-1 space-y-0.5">{e.runOfShow.map((s, i) => <li key={i}><span className="font-mono">{s.time}</span> {s.title}</li>)}</ol></div> : null}
                {q.data.people.length ? <div><h3 className="font-medium"><Users className="mr-1 inline size-3.5" aria-hidden="true" />Going</h3>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{q.data.people.map((p) => <li key={p.id}>{p.name}{p.private ? <span className="text-muted-foreground"> (private)</span> : null}</li>)}</ul></div> : null}
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
                      <button type="button" aria-pressed={e.mine === "going" || e.mine === "waitlisted"} className={FORM_PRIMARY_CLASS} onClick={() => void rsvp("going")}>{e.state === "full" && e.mine !== "going" ? "Join the waitlist" : "Going"}</button>
                      <button type="button" aria-pressed={e.mine === "cant_go"} className={FORM_SECONDARY_CLASS} onClick={() => void rsvp("cant_go")}>Can’t go</button>
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
