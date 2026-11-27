"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HandHeart } from "lucide-react";

import { agreeVolunteerAction, cancelShiftAction, checkInShiftAction, readShiftPeopleAction, readVolunteersAction, readVolunteerWithUsAction, saveShiftAction, saveVolunteerSettingsAction, shiftSignUpAction, signOffTrainingAction } from "@/app/actions/volunteers";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import type { VolunteerRole } from "@/lib/organizations/volunteers";

const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (start: string, end: string) => {
  const d = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: tz() });
  const t = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz() });
  return `${d.format(new Date(start))}–${t.format(new Date(end))} (${tz()})`;
};
const STATE_WORDS = { going: "Going", waitlisted: "Waitlisted", cant_go: "Can’t go" } as const;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "role";

/**
 * Volunteers (B8.1a, report 37.3): My shifts with Check in inside the window, open shifts for my roles, my hours; for
 * coordinators the shifts with places filled, Coverage (short in the next 14 days), people with trainings and counts,
 * + Shift and Settings. Places and Short as words; never a score.
 */
export function VolunteersCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["volunteers", orgId], queryFn: () => readVolunteersAction(orgId), staleTime: 30_000 });
  const [settings, setSettings] = useState<{ on: boolean; roles: VolunteerRole[]; agreement: string } | null>(null);
  const [shift, setShift] = useState<{ roleId: string; place: string; day: string; from: string; to: string; places: number; note: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.on && !d.coordinator)) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  const full = "roles" in d;
  if (!full) return null;
  if (settings) return (
    <OrgCard title="Settings · Volunteers" testId="volunteer-settings">
      <div className="space-y-2 text-[13px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={settings.on} onChange={(e) => setSettings({ ...settings, on: e.target.checked })} />Volunteers is on</label>
        <ul className="space-y-1.5">{settings.roles.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Input value={r.name} maxLength={60} aria-label={`Role ${i + 1} name`} onChange={(e) => setSettings({ ...settings, roles: settings.roles.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="w-[180px]" />
            <Input value={r.line} maxLength={200} aria-label={`What ${r.name || "the role"} involves`} placeholder="What it involves" onChange={(e) => setSettings({ ...settings, roles: settings.roles.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)) })} className="w-[260px]" />
            <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={r.training} onChange={(e) => setSettings({ ...settings, roles: settings.roles.map((x, j) => (j === i ? { ...x, training: e.target.checked } : x)) })} />Needs training</label>
          </li>))}</ul>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setSettings({ ...settings, roles: [...settings.roles, { id: "", name: "", line: "", training: false }] })}>Add a role</button>
        <label className="flex flex-col">Volunteer agreement (a change asks everyone to agree again)<textarea className="nb-textarea mt-0.5 min-h-[80px] text-[13px]" maxLength={5000} value={settings.agreement} onChange={(e) => setSettings({ ...settings, agreement: e.target.value })} /></label>
        <span className="flex gap-2">
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(saveVolunteerSettingsAction(orgId, { on: settings.on, agreement: { text: settings.agreement, version: d.agreement.version },
            roles: settings.roles.filter((r) => r.name.trim()).map((r, i, all) => ({ ...r, id: r.id || `${slugify(r.name)}${all.slice(0, i).some((x) => slugify(x.name) === slugify(r.name)) ? `-${i}` : ""}` })) }), "Settings saved").then(() => setSettings(null))}>Save</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setSettings(null)}>Cancel</button></span>
      </div>
    </OrgCard>
  );
  const mine = d.shifts.filter((s) => s.mine === "going" || s.mine === "waitlisted");
  const openShifts = d.shifts.filter((s) => !s.started && s.mine !== "going" && s.mine !== "waitlisted");
  return (
    <OrgCard title="Volunteers" testId="volunteers" action={d.coordinator ? <span className="flex gap-3 text-[13px]">
      <button type="button" className="nb-link" onClick={() => setShift({ roleId: d.roles[0]?.id ?? "", place: "", day: "", from: "09:00", to: "12:00", places: 6, note: "" })}>Add a shift</button>
      <button type="button" className="nb-link" onClick={() => setSettings({ on: d.on, roles: d.roles, agreement: d.agreement.text })}>Settings</button></span> : null}>
      <div className="space-y-3 text-[13px]">
        {!d.on ? <p className="text-muted-foreground">Volunteers is off. Turn it on in Settings, add roles, then shifts.</p> : null}
        {shift ? <fieldset className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3" data-testid="volunteer-shift-form"><legend className="sr-only">New shift</legend>
          <label className="flex flex-col">Role<select className="nb-select mt-0.5" value={shift.roleId} onChange={(e) => setShift({ ...shift, roleId: e.target.value })}>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="flex flex-col">Day<Input type="date" value={shift.day} onChange={(e) => setShift({ ...shift, day: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">From<Input type="time" value={shift.from} onChange={(e) => setShift({ ...shift, from: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">To<Input type="time" value={shift.to} onChange={(e) => setShift({ ...shift, to: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">Places<Input type="number" min={1} max={500} value={shift.places} onChange={(e) => setShift({ ...shift, places: Number(e.target.value) })} className="mt-0.5 w-[80px] font-mono" /></label>
          <label className="flex flex-col">Place<Input value={shift.place} maxLength={120} onChange={(e) => setShift({ ...shift, place: e.target.value })} className="mt-0.5 w-[200px]" /></label>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!shift.roleId || !shift.day} onClick={() => void run(saveShiftAction(orgId, { roleId: shift.roleId, place: shift.place, note: shift.note, places: shift.places,
            start: new Date(`${shift.day}T${shift.from}`).toISOString(), end: new Date(`${shift.day}T${shift.to}`).toISOString() }), "Shift added").then(() => setShift(null))}>Save</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setShift(null)}>Cancel</button></fieldset> : null}
        {d.on && !d.agreed && d.agreement.text ? <div className="space-y-1.5 rounded-md border border-border p-3" data-testid="volunteer-agreement">
          <p className="font-medium">Volunteer agreement</p><p className="whitespace-pre-wrap text-muted-foreground">{d.agreement.text}</p>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(agreeVolunteerAction(orgId, d.agreement.version), "Thank you; you can sign up for shifts")}>I agree</button></div> : null}
        {mine.length ? <section aria-label="My shifts"><h4 className="font-medium">My shifts</h4>
          <ul className="mt-1 space-y-1">{mine.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2" data-testid="volunteer-my-shift">
            <span>{when(s.start, s.end)} · {s.role}{s.place ? ` · ${s.place}` : ""}</span><StatusBadge state={s.mine === "going" ? "active" : "draft"}>{STATE_WORDS[s.mine!]}</StatusBadge>
            {s.checkedIn ? <span className="font-medium">Checked in</span> : null}
            {s.canCheckIn ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(checkInShiftAction(orgId, s.id, null), "Checked in")}>Check in</button> : null}
            {!s.started ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(shiftSignUpAction(orgId, s.id, "cant_go"), "Your place is freed")}>Can’t go</button> : null}</li>)}</ul></section> : null}
        <p className="text-muted-foreground" data-testid="volunteer-hours">My hours this year: {d.hours.year} ({d.hours.shifts} {d.hours.shifts === 1 ? "shift" : "shifts"})</p>
        {openShifts.length ? <section aria-label="Open shifts"><h4 className="font-medium">Open shifts</h4>
          <ul className="mt-1 divide-y divide-border rounded-md border border-border">{openShifts.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="volunteer-shift">
              <HandHeart aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">{when(s.start, s.end)} · <span className="font-medium">{s.role}</span>{s.place ? ` · ${s.place}` : ""}</span>
              <span className="text-muted-foreground">{s.going} of {s.places}{s.waitlisted ? ` · waitlist ${s.waitlisted}` : ""}</span>
              {s.going >= s.places ? <StatusBadge state="draft">Full</StatusBadge> : s.short && d.coordinator ? <StatusBadge state="at_risk">Short</StatusBadge> : null}
              {s.needsTraining ? <span className="text-muted-foreground">Needs training</span>
                : d.agreed || !d.agreement.text ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(shiftSignUpAction(orgId, s.id, "going"), s.going >= s.places ? "You’re on the waitlist" : "You’re signed up")}>{s.going >= s.places ? "Join the waitlist" : "Sign up"}<span className="sr-only"> for {s.role}</span></button> : null}
              {d.coordinator ? <><button type="button" className="nb-link" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>People<span className="sr-only"> on {s.role}</span></button>
                <button type="button" className="nb-link" onClick={() => void run(cancelShiftAction(orgId, s.id), "Shift cancelled; everyone is told")}>Cancel<span className="sr-only"> {s.role} shift</span></button></> : null}
              {open === s.id ? <ShiftPeople orgId={orgId} shiftId={s.id} /> : null}
            </li>))}</ul></section> : d.on ? <p className="text-muted-foreground">No open shifts in the next 30 days.</p> : null}
        {d.coordinator && d.coverage.length ? <section aria-label="Coverage"><h4 className="font-medium">Coverage · short in the next 14 days</h4>
          <ul className="mt-1 space-y-0.5">{d.coverage.map((s) => <li key={s.id} data-testid="volunteer-coverage">{when(s.start, s.end)} · {s.role} · short {s.places - s.going}</li>)}</ul></section> : null}
        {d.coordinator && d.people.length && d.roles.some((r) => r.training) ? <details><summary className="cursor-pointer text-muted-foreground">People and trainings</summary>
          <ul className="mt-1 space-y-1">{d.people.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2" data-testid="volunteer-person">
            <span className="min-w-[140px] font-medium">{p.name}</span><span className="text-muted-foreground">{p.attended} attended · {p.missed} missed</span>
            {d.roles.filter((r) => r.training).map((r) => <label key={r.id} className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={p.trained.includes(r.id)}
              onChange={(e) => void run(signOffTrainingAction(orgId, p.id, r.id, e.target.checked), e.target.checked ? "Training signed off" : "Sign-off taken back")} />{r.name}</label>)}</li>)}</ul></details> : null}
      </div>
    </OrgCard>
  );
}

function ShiftPeople({ orgId, shiftId }: { orgId: string; shiftId: string }) {
  const q = useQuery({ queryKey: ["volunteer-shift", shiftId], queryFn: () => readShiftPeopleAction(orgId, shiftId), staleTime: 15_000 });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  return (
    <ul className="w-full space-y-0.5 pl-6" aria-label="Going and waiting">{d.people.map((p) => <li key={p.id} className="flex items-center gap-2">
      {p.state === "going" ? <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={p.checked}
        onChange={(e) => void safe(checkInShiftAction(orgId, shiftId, p.id, e.target.checked)).then((r) => { if (!r.success) toast.error(r.error ?? "Couldn’t save that."); void q.refetch(); })} />{p.name}</label>
        : <span className="text-muted-foreground">{p.name} · waitlisted</span>}</li>)}</ul>
  );
}

/** About → Volunteer with us (B8.1a): upcoming shifts with places left and training; Join for visitors. */
export function VolunteerWithUs({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["volunteer-with-us", orgId], queryFn: () => readVolunteerWithUsAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d || !d.shifts.length) return null;
  return (
    <section aria-label="Volunteer with us" className="space-y-2 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="volunteer-with-us">
      <h3 className="font-medium">Volunteer with us</h3>
      <ul className="space-y-1">{d.shifts.map((s) => <li key={s.id}>{when(s.start, s.end)} · <span className="font-medium">{s.role}</span>{s.place ? ` · ${s.place}` : ""}
        <span className="text-muted-foreground"> · {s.left} of {s.places} places left · Training: {s.training ? "needed" : "none"}</span></li>)}</ul>
      {!d.member ? <p className="text-muted-foreground">Join with the button at the top to volunteer.</p> : null}
    </section>
  );
}
