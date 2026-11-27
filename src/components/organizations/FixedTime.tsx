"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";

import { archiveOrgAction } from "@/app/actions/org-lifecycle";
import { addBookingAction, addTeamToProfileAction, applyStarterAction, runItAgainAction, saveFixedDebriefAction, saveWrapAction, moveKeyDateAction, previewMoveAction, raiseIssueAction, readFixedTimeAction, saveWorkstreamsAction, setFixedTimeAction, solveIssueAction, updateBookingAction } from "@/app/actions/fixed-time";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { BOOKING_STATES, BOOKING_WORDS, WRAP_ITEMS, type BookingState } from "@/lib/organizations/fixed-time";

const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const full = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const STATE = { planning: "Planning", this_week: "This week", today: "Today", wrap_up: "Wrap-up", ended: "Ended" } as const;

/**
 * Dates (B8.2a, report 37.4): the countdown line with the key date in full, the plan starter, this week's tasks worked
 * back from the key date (offsets as words), and Move the key date with a preview of what moves and what stays.
 */
export function FixedTimeCard({ orgId, other }: { orgId: string; other: boolean }) {
  const q = useQuery({ queryKey: ["fixed-time", orgId], queryFn: () => readFixedTimeAction(orgId), staleTime: 60_000 });
  const [setting, setSetting] = useState<{ keyDate: string; endDate: string } | null>(null);
  const [streams, setStreams] = useState<Array<{ id: string; name: string; owner: string | null }> | null>(null);
  const [booking, setBooking] = useState<{ title: string; supplier: string; workstream: string } | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [issue, setIssue] = useState("");
  const [deb, setDeb] = useState<{ summary: string; well: string; wrong: string; next: string } | null>(null);
  const [again, setAgain] = useState<{ title: string; handle: string; keyDate: string } | null>(null);
  const [move, setMove] = useState<{ to: string; reason: string; preview: { passed: boolean; moves: Array<{ id: string; title: string; from: string | null; to: string }>; stays: Array<{ id: string; title: string; due: string | null }> } | null } | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.fixed && !(d.organiser && other))) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); return true; };
  const f = d.fixed;
  if (!f) return (
    <OrgCard title="Dates" testId="fixed-time">
      {setting ? <fieldset className="flex flex-wrap items-end gap-2 text-[13px]"><legend className="sr-only">Key date and end date</legend>
        <label className="flex flex-col">Key date (the day, launch or deadline)<Input type="date" value={setting.keyDate} onChange={(e) => setSetting({ ...setting, keyDate: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
        <label className="flex flex-col">End date (30 days after if empty)<Input type="date" value={setting.endDate} onChange={(e) => setSetting({ ...setting, endDate: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
        <button type="button" className={FORM_PRIMARY_CLASS} disabled={!setting.keyDate} onClick={() => void run(setFixedTimeAction(orgId, { keyDate: setting.keyDate, endDate: setting.endDate || null }), "Dates set").then(() => setSetting(null))}>Save</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setSetting(null)}>Cancel</button></fieldset>
        : <span className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-muted-foreground">A team for a fixed time plans backwards from its key date.</span>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setSetting({ keyDate: "", endDate: "" })}>Set the key date</button></span>}
    </OrgCard>
  );
  return (
    <OrgCard title="Dates" testId="fixed-time" action={<StatusBadge state={f.state === "ended" ? "done" : f.state === "planning" ? "draft" : "active"}>{STATE[f.state]}</StatusBadge>}>
      <div className="space-y-3 text-[13px]">
        <p className="flex flex-wrap items-center gap-2" data-testid="fixed-time-countdown"><Hourglass aria-hidden="true" className="size-4 text-muted-foreground" />
          <span><span className="font-medium">{f.line}</span> <span className="text-muted-foreground">· {full(f.keyDate)} · ends {full(f.endDate)}</span></span>
          {d.organiser && !move ? <button type="button" className="nb-link" onClick={() => setMove({ to: f.keyDate, reason: "", preview: null })}>Move the key date</button> : null}</p>
        {move ? <div className="space-y-2 rounded-md border border-border p-3" data-testid="fixed-time-move">
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col">New key date<Input type="date" value={move.to} onChange={(e) => setMove({ ...move, to: e.target.value, preview: null })} className="mt-0.5 w-auto font-mono" /></label>
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={!move.to || move.to === f.keyDate} onClick={() => void safe(previewMoveAction(orgId, move.to)).then((r) => (r.success && "moves" in r ? setMove({ ...move, preview: r }) : toast.error("Couldn’t work it out.")))}>Preview</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMove(null)}>Cancel</button></span>
          {move.preview ? <>
            <p>{move.preview.moves.length} {move.preview.moves.length === 1 ? "date moves" : "dates move"}; {move.preview.stays.length} set by hand {move.preview.stays.length === 1 ? "stays" : "stay"}.</p>
            <ul className="max-h-40 space-y-0.5 overflow-auto">{move.preview.moves.map((m) => <li key={m.id}>{m.title}: {m.from ? full(m.from) : "no date"} to {full(m.to)}</li>)}
              {move.preview.stays.map((m) => <li key={m.id} className="text-muted-foreground">{m.title}: stays {m.due ? full(m.due) : ""} (set by hand)</li>)}</ul>
            {move.preview.passed ? <label className="flex flex-col">Why it’s moving (the key date has passed; kept for the debrief)<Input value={move.reason} maxLength={300} onChange={(e) => setMove({ ...move, reason: e.target.value })} className="mt-0.5" /></label> : null}
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={move.preview.passed && !move.reason.trim()} onClick={() => void run(moveKeyDateAction(orgId, move.to, move.reason || null), "Key date moved; the team is told").then((ok) => ok && setMove(null))}>Move it</button></> : null}
        </div> : null}
        {!f.starter && d.organiser ? <span className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">Pick a plan, laid out backwards from the key date:</span>
          {d.starters.map((s) => <button key={s.id} type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(applyStarterAction(orgId, s.id), `${s.name} plan added`)}>{s.name} ({s.tasks} tasks)</button>)}</span> : null}
        {"workstreams" in d ? <p className="flex flex-wrap items-center gap-2" data-testid="fixed-time-workstreams"><span className="font-medium">Workstreams</span>
          <span className="text-muted-foreground">{d.workstreams.length ? d.workstreams.map((w) => `${w.name}${w.ownerName ? ` (${w.ownerName})` : ""}`).join(" · ") : "none yet"}</span>
          {d.organiser && !streams ? <button type="button" className="nb-link" onClick={() => setStreams(d.workstreams.map(({ id, name, owner }) => ({ id, name, owner })))}>Edit</button> : null}</p> : null}
        {streams && "people" in d ? <fieldset className="space-y-1.5 rounded-md border border-border p-3"><legend className="sr-only">Workstreams</legend>
          {streams.map((w, i) => <span key={i} className="flex flex-wrap items-center gap-2">
            <Input value={w.name} maxLength={40} aria-label={`Workstream ${i + 1}`} onChange={(e) => setStreams(streams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="w-[180px]" />
            <select className="nb-select" aria-label={`Owner of workstream ${i + 1}`} value={w.owner ?? ""} onChange={(e) => setStreams(streams.map((x, j) => (j === i ? { ...x, owner: e.target.value || null } : x)))}>
              <option value="">No owner</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></span>)}
          <span className="flex gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setStreams([...streams, { id: "", name: "", owner: null }])}>Add a workstream</button>
            <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(saveWorkstreamsAction(orgId, streams.filter((w) => w.name.trim()).map((w, i) => ({ ...w, id: w.id || `ws-${i}-${w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}` }))), "Workstreams saved").then((ok) => ok && setStreams(null))}>Save</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setStreams(null)}>Cancel</button></span></fieldset> : null}
        {"issues" in d && f.state === "today" ? <section aria-label="Day of" className="space-y-1.5 rounded-md border border-border p-3" data-testid="fixed-time-day-of">
          <h4 className="font-medium">Day of · Issues today</h4>
          {d.issues.length ? <ul className="space-y-0.5">{d.issues.map((i) => <li key={i.id}><label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={i.done}
            onChange={(e) => void run(solveIssueAction(orgId, i.id, e.target.checked), e.target.checked ? "Solved" : "Open again")} />{i.title}{i.by ? <span className="text-muted-foreground"> · {i.by}</span> : null}</label></li>)}</ul>
            : <p className="text-muted-foreground">No issues yet.</p>}
          {d.member ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (issue.trim()) void run(raiseIssueAction(orgId, issue), "Issue added").then((ok) => ok && setIssue("")); }}>
            <Input value={issue} maxLength={200} placeholder="What needs sorting" aria-label="Add an issue" onChange={(e) => setIssue(e.target.value)} className="w-[280px]" />
            <button type="submit" className={FORM_SECONDARY_CLASS} disabled={!issue.trim()}>Add</button></form> : null}</section> : null}
        {"bookings" in d && (d.bookings.length || d.organiser) ? <section aria-label="Bookings" data-testid="fixed-time-bookings"><h4 className="font-medium">Bookings</h4>
          <ul className="mt-1 space-y-1">{d.bookings.map((b) => <li key={b.id} className="flex flex-wrap items-center gap-2" data-testid="fixed-time-booking">
            <span className="min-w-[140px] font-medium">{b.title}</span>{b.supplier ? <span className="text-muted-foreground">{b.supplier}</span> : null}
            <select className="nb-select" aria-label={`State of ${b.title}`} value={b.state} onChange={(e) => void run(updateBookingAction(orgId, b.id, { supplier: b.supplier, ref: refs[b.id] ?? b.ref, state: e.target.value as BookingState, workstream: b.workstream }), "Saved")}>
              {BOOKING_STATES.map((k) => <option key={k} value={k}>{BOOKING_WORDS[k]}</option>)}</select>
            <Input value={refs[b.id] ?? b.ref} maxLength={60} placeholder="Reference" aria-label={`Reference for ${b.title}`} onChange={(e) => setRefs({ ...refs, [b.id]: e.target.value })} className="w-[140px] font-mono" />
            {(refs[b.id] ?? b.ref) !== b.ref ? <button type="button" className="nb-link" onClick={() => void run(updateBookingAction(orgId, b.id, { supplier: b.supplier, ref: refs[b.id]!, state: b.state, workstream: b.workstream }), "Reference saved")}>Save<span className="sr-only"> the reference for {b.title}</span></button> : null}
            {b.due ? <span className="text-muted-foreground">by {full(b.due)}</span> : null}</li>)}</ul>
          {booking ? <span className="mt-1 flex flex-wrap items-end gap-2">
            <label className="flex flex-col">What<Input value={booking.title} maxLength={120} placeholder="Venue, sound, permit" onChange={(e) => setBooking({ ...booking, title: e.target.value })} className="mt-0.5 w-[180px]" /></label>
            <label className="flex flex-col">Supplier<Input value={booking.supplier} maxLength={120} onChange={(e) => setBooking({ ...booking, supplier: e.target.value })} className="mt-0.5 w-[180px]" /></label>
            {d.workstreams.length ? <label className="flex flex-col">Workstream<select className="nb-select mt-0.5" value={booking.workstream} onChange={(e) => setBooking({ ...booking, workstream: e.target.value })}>
              <option value="">None</option>{d.workstreams.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label> : null}
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!booking.title.trim()} onClick={() => void run(addBookingAction(orgId, { title: booking.title, supplier: booking.supplier, workstream: booking.workstream || null }), "Booking added").then((ok) => ok && setBooking(null))}>Add</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setBooking(null)}>Cancel</button></span>
            : d.organiser || d.workstreams.some((w) => w.owner) ? <button type="button" className="nb-link mt-1" onClick={() => setBooking({ title: "", supplier: "", workstream: "" })}>Add a booking</button> : null}</section> : null}
        {f.pinned ? <details className="rounded-md border border-border p-3" data-testid="fixed-time-pinned"><summary className="cursor-pointer font-medium">Last run’s debrief · {f.pinned.from}</summary>
          <p className="mt-1">{f.pinned.summary}</p>{f.pinned.well ? <p><span className="font-medium">What went well: </span>{f.pinned.well}</p> : null}
          {f.pinned.wrong ? <p className="whitespace-pre-wrap"><span className="font-medium">What went wrong: </span>{f.pinned.wrong}</p> : null}{f.pinned.next ? <p className="whitespace-pre-wrap"><span className="font-medium">Next time: </span>{f.pinned.next}</p> : null}</details> : null}
        {"wrap" in f && (f.state === "wrap_up" || f.state === "ended") ? <section aria-label="Wrap-up" className="space-y-2 rounded-md border border-border p-3" data-testid="fixed-time-wrap">
          <h4 className="font-medium">Wrap-up{f.closed ? " · Closed" : ""}</h4>
          <ul className="space-y-1">{WRAP_ITEMS.map((i) => <li key={i.id}><label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={f.wrap[i.id]} disabled={!d.organiser || i.id === "debrief" || f.closed}
            onChange={(e) => void run(saveWrapAction(orgId, i.id as "thank" | "photos" | "report", e.target.checked), "Saved")} />{i.label}</label></li>)}</ul>
          {d.organiser && !f.closed && !deb ? <button type="button" className="nb-link" onClick={() => setDeb(f.debrief ?? { summary: "", well: "", wrong: "", next: "" })}>{f.debrief ? "Edit the debrief" : "Write the debrief"}</button> : null}
          {deb ? <span className="flex flex-col gap-1.5">{(["summary", "well", "wrong", "next"] as const).map((k) => <label key={k} className="flex flex-col">{{ summary: "Summary", well: "What went well", wrong: "What went wrong", next: "Next time (one per line; they become tasks next run)" }[k]}
            <textarea className="nb-textarea mt-0.5 text-[13px]" rows={2} maxLength={2000} value={deb[k]} onChange={(e) => setDeb({ ...deb, [k]: e.target.value })} /></label>)}
            <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!deb.summary.trim()} onClick={() => void run(saveFixedDebriefAction(orgId, deb), "Debrief saved").then((ok) => ok && setDeb(null))}>Save</button>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDeb(null)}>Cancel</button></span></span> : null}
          <span className="flex flex-wrap gap-2">
            {d.owner && !f.closed ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(archiveOrgAction(orgId), "Closed: read-only, nothing deleted")}>Close the team{WRAP_ITEMS.some((i) => !f.wrap[i.id] && i.id !== "report") ? " (wrap-up not finished)" : ""}</button> : null}
            {d.owner && !again ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAgain({ title: d.title, handle: "", keyDate: "" })}>Run it again</button> : null}
            {d.member ? <button type="button" className="nb-link" onClick={() => void run(addTeamToProfileAction(orgId), "Added to your profile")}>Add to my profile</button> : null}</span>
          {again ? <fieldset className="flex flex-wrap items-end gap-2"><legend className="sr-only">Run it again</legend>
            <label className="flex flex-col">Name<Input value={again.title} maxLength={100} onChange={(e) => setAgain({ ...again, title: e.target.value })} className="mt-0.5 w-[200px]" /></label>
            <label className="flex flex-col">Web address<Input value={again.handle} maxLength={40} placeholder="book-fest-2028" onChange={(e) => setAgain({ ...again, handle: e.target.value })} className="mt-0.5 w-[180px] font-mono" /></label>
            <label className="flex flex-col">New key date<Input type="date" value={again.keyDate} onChange={(e) => setAgain({ ...again, keyDate: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!again.title.trim() || !again.handle.trim() || !again.keyDate} onClick={() => void run(runItAgainAction(orgId, again), "Being made; you’re told when it’s ready (no people or work are copied)").then((ok) => ok && setAgain(null))}>Run it again</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAgain(null)}>Cancel</button></fieldset> : null}
        </section> : null}
        {"week" in d && d.week.length ? <section aria-label="This week"><h4 className="font-medium">This week, worked back from {full(f.keyDate)}</h4>
          <ul className="mt-1 space-y-0.5">{d.week.map((t) => <li key={t.id} data-testid="fixed-time-task">{t.title} <span className="text-muted-foreground">· {full(t.due)} · {t.handSet ? "set by hand" : t.offset}{t.overdue ? " · not done yet" : ""}</span></li>)}</ul></section> : null}
      </div>
    </OrgCard>
  );
}
