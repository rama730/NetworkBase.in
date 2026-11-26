"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Microscope } from "lucide-react";

import { bookEquipmentAction, cancelBookingAction, readEquipmentAction, reportEquipmentProblemAction, saveEquipmentAction, setEquipmentStatusAction } from "@/app/actions/lab-equipment";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { saveBlob } from "@/lib/download";
import { toast } from "@/lib/feedback";
import { bookingIcs, daySlots, EQUIPMENT_STATUS, type EquipmentStatus } from "@/lib/organizations/lab-equipment";
import { addDaysToDay, formatInZone, todayInZone, zoneName } from "@/lib/organizations/zoned-time";

// Report 35.5 (plan B6.2c, R4): the lab's Equipment on its Overview — status, caretaker, training, Book a slot (a day
// strip and the lab's slots), my bookings with .ics, Report a problem, and the caretaker's status buttons.
const key = (orgId: string) => ["lab-equipment", orgId] as const;
type Data = Extract<Awaited<ReturnType<typeof readEquipmentAction>>, { success: true }>;
type Item = Data["equipment"][number];
const STATE_BADGE: Record<EquipmentStatus, string> = { available: "active", out_of_order: "at_risk", maintenance: "draft" };
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));

export function LabEquipmentCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readEquipmentAction(orgId), staleTime: 30_000 });
  const [adding, setAdding] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  return (
    <OrgCard title="Equipment" testId="lab-equipment" action={d.admin && !adding ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAdding(true)}>+ Equipment</button> : null}>
      <div className="space-y-3 text-[13px]">
        {adding ? <EquipmentForm orgId={orgId} d={d} onDone={() => setAdding(false)} /> : null}
        {d.equipment.length ? <ul className="divide-y divide-border">{d.equipment.map((e) => <EquipmentRow key={e.id} orgId={orgId} e={e} d={d} />)}</ul>
          : <p className="text-muted-foreground">No equipment listed yet.{d.admin ? " Add what people book, with its caretaker and any training it needs." : ""}</p>}
        <p className="text-muted-foreground">Times are in {zoneName(d.tz)}. Slots of {d.rules.slotMinutes} minutes, {d.rules.from} to {d.rules.to}; up to {d.rules.weeklyCapHours} hours a week each.</p>
      </div>
    </OrgCard>
  );
}

function EquipmentRow({ orgId, e, d }: { orgId: string; e: Item; d: Data }) {
  const client = useQueryClient();
  const [booking, setBooking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState("");
  const refresh = () => void client.invalidateQueries({ queryKey: key(orgId) });
  const report = async () => {
    const r = await safe(reportEquipmentProblemAction(orgId, e.id, problem));
    if (!r.success) return void toast.error(r.error);
    toast.success(`${e.name} is Out of order. ${"to" in r && r.to === "pi" ? "The PI has" : "Its caretaker has"} a task.`);
    setReporting(false); setProblem(""); refresh();
  };
  const status = async (s: EquipmentStatus) => {
    const r = await safe(setEquipmentStatusAction(orgId, e.id, s));
    if (!r.success) return void toast.error(r.error);
    toast.success(`${e.name}: ${EQUIPMENT_STATUS[s]}`); refresh();
  };
  const cancel = async (id: string) => {
    const r = await safe(cancelBookingAction(orgId, id));
    if (!r.success) return void toast.error(r.error);
    toast.success("Booking cancelled"); refresh();
  };
  if (editing) return <li className="py-2"><EquipmentForm orgId={orgId} d={d} e={e} onDone={() => setEditing(false)} /></li>;
  const mine = e.bookings.filter((b) => b.mine);
  const when = (iso: string) => formatInZone(iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }, d.tz);
  return (
    <li className="space-y-1.5 py-2" data-testid="lab-equipment-row">
      <p className="flex flex-wrap items-center gap-2">
        <Microscope className="size-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium">{e.name}</span>
        {e.place ? <span className="text-muted-foreground">{e.place}</span> : null}
        <StatusBadge state={STATE_BADGE[e.status]}>{EQUIPMENT_STATUS[e.status]}{e.status !== "available" ? ` since ${formatInZone(e.since, { day: "numeric", month: "short" }, d.tz)}` : ""}</StatusBadge>
        {e.caretaker ? <span className="text-muted-foreground">Caretaker: {e.caretaker}</span> : null}
        {e.training ? <span className={e.trained ? "" : "text-muted-foreground"}>Needs training ({e.training}): {e.trained ? "you’re Trained" : "not yet"}</span> : null}
      </p>
      {e.status !== "available" && e.bookable ? <p className="text-muted-foreground">Booking is paused until it’s Available again.</p> : null}
      {mine.length ? <ul className="space-y-0.5" aria-label={`Your bookings of ${e.name}`}>{mine.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center gap-2">Your booking: {when(b.start)} to {formatInZone(b.end, { hour: "numeric", minute: "2-digit" }, d.tz)}
          <button type="button" className="nb-link" onClick={() => saveBlob(new Blob([bookingIcs({ id: b.id, start: b.start, end: b.end, equipment: e.name, place: e.place || null, lab: d.lab })], { type: "text/calendar" }), `${e.name}.ics`)}>Add to calendar (.ics)</button>
          <button type="button" className="nb-link" onClick={() => void cancel(b.id)}>Cancel<span className="sr-only"> booking of {e.name}</span></button></li>))}</ul> : null}
      <span className="flex flex-wrap gap-2">
        {e.bookable && e.status === "available" && e.trained && !booking ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setBooking(true)}>Book<span className="sr-only"> {e.name}</span></button> : null}
        {!reporting ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setReporting(true)}>Report a problem<span className="sr-only"> with {e.name}</span></button> : null}
        {e.canSetStatus && e.status !== "available" ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void status("available")}>Fixed: make Available</button> : null}
        {e.canSetStatus && e.status === "available" ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void status("maintenance")}>Start maintenance</button> : null}
        {d.admin ? <button type="button" className="nb-link" onClick={() => setEditing(true)}>Edit<span className="sr-only"> {e.name}</span></button> : null}
      </span>
      {booking ? <BookStrip orgId={orgId} e={e} d={d} onDone={() => { setBooking(false); refresh(); }} /> : null}
      {reporting ? (
        <span className="flex flex-wrap items-center gap-2">
          <Input value={problem} maxLength={1000} onChange={(x) => setProblem(x.target.value)} aria-label={`What’s wrong with ${e.name}`} placeholder="What’s wrong" className="min-w-[240px] flex-1" />
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!problem.trim()} onClick={() => void report()}>Report</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setReporting(false)}>Cancel</button>
        </span>
      ) : null}
    </li>
  );
}

/** Book: a day strip (the next 7 days) and that day's free slots. */
function BookStrip({ orgId, e, d, onDone }: { orgId: string; e: Item; d: Data; onDone: () => void }) {
  const today = todayInZone(d.tz);
  const [day, setDay] = useState(today);
  const taken = (start: string, end: string) => e.bookings.some((b) => Date.parse(b.start) < Date.parse(end) && Date.parse(b.end) > Date.parse(start));
  const slots = daySlots(day, d.rules, d.tz).filter((s) => Date.parse(s.end) > Date.now());
  const book = async (start: string) => {
    const r = await safe(bookEquipmentAction(orgId, e.id, start));
    if (!r.success) return void toast.error(r.error);
    toast.success(`Booked ${e.name}`); onDone();
  };
  return (
    <div className="space-y-2 rounded-md border border-border p-2" data-testid="lab-book-strip">
      <div role="group" aria-label="Day" className="flex flex-wrap gap-1">
        {Array.from({ length: 7 }, (_, i) => addDaysToDay(today, i)).map((x) => (
          <button key={x} type="button" aria-pressed={x === day} onClick={() => setDay(x)} className={x === day ? FORM_PRIMARY_CLASS : FORM_SECONDARY_CLASS}>
            {formatInZone(`${x}T12:00:00Z`, { weekday: "short", day: "numeric" }, "UTC")}</button>))}
      </div>
      {slots.length ? <ul className="flex flex-wrap gap-1.5" aria-label="Slots">{slots.map((s) => (
        <li key={s.start}><button type="button" className={FORM_SECONDARY_CLASS} disabled={taken(s.start, s.end)} onClick={() => void book(s.start)}>{s.label}{taken(s.start, s.end) ? " (booked)" : ""}</button></li>))}</ul>
        : <p className="text-muted-foreground">No slots left that day.</p>}
      <button type="button" className="nb-link" onClick={onDone}>Close</button>
    </div>
  );
}

function EquipmentForm({ orgId, d, e, onDone }: { orgId: string; d: Data; e?: Item; onDone: () => void }) {
  const client = useQueryClient();
  const [f, setF] = useState({ name: e?.name ?? "", place: e?.place ?? "", caretakerId: e?.caretakerId ?? "", trainingDocId: e?.trainingDocId ?? "", bookable: e?.bookable ?? true, notes: e?.notes ?? "" });
  const save = async () => {
    const r = await safe(saveEquipmentAction(orgId, e?.id ?? null, { ...f, caretakerId: f.caretakerId || null, trainingDocId: f.trainingDocId || null }));
    if (!r.success) return void toast.error(r.error);
    toast.success("Equipment saved");
    void client.invalidateQueries({ queryKey: key(orgId) });
    onDone();
  };
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3" data-testid="lab-equipment-form">
      <legend className="px-1 font-medium">{e ? `Edit ${e.name}` : "New equipment"}</legend>
      <span className="flex flex-wrap gap-2">
        <label className="min-w-[200px] flex-1">Name<Input value={f.name} maxLength={80} onChange={(x) => setF({ ...f, name: x.target.value })} className="mt-1" /></label>
        <label className="min-w-[160px]">Place<Input value={f.place} maxLength={80} onChange={(x) => setF({ ...f, place: x.target.value })} placeholder="Lab 2" className="mt-1" /></label>
      </span>
      <span className="flex flex-wrap gap-2">
        <label>Caretaker<select className="nb-select mt-1 block" value={f.caretakerId} onChange={(x) => setF({ ...f, caretakerId: x.target.value })}>
          <option value="">None (the PI hears problems)</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Needs training on<select className="nb-select mt-1 block" value={f.trainingDocId} onChange={(x) => setF({ ...f, trainingDocId: x.target.value })}>
          <option value="">No training needed</option>{d.protocols.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      </span>
      <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.bookable} onChange={(x) => setF({ ...f, bookable: x.target.checked })} />Booked in slots</label>
      <label className="block">Notes<textarea className="nb-textarea mt-1 w-full" rows={2} maxLength={1000} value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} /></label>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.name.trim()} onClick={() => void save()}>Save equipment</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
    </fieldset>
  );
}
