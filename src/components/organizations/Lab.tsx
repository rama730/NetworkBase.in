"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, GraduationCap, MessageSquare } from "lucide-react";

import { readMyTrainingsAction } from "@/app/actions/lab-protocols";
import { cancelFinishAction, readLabAboutAction, readLabAlumniAction, readLabHomeAction, readLabPeopleAction, readLabSettingsAction, readMyAlumniAction, saveLabSettingsAction, saveMyAlumniAction, setLabPositionAction, setLabSupervisorAction, startFinishAction, type LabPerson } from "@/app/actions/lab";
import { OnboardingBoard } from "@/components/organizations/CompanyOnboarding";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { groupByPosition, type LabSettings, type Position } from "@/lib/organizations/lab";

// Report 35.2 (plan B6.1a, R1): a lab's Members is People grouped by position; the Overview has the lab home card;
// Settings → Lab holds positions, office hours, who Reach the PI messages, the plans and the public page's sections.
const peopleKey = (orgId: string) => ["lab-people", orgId] as const;
const ROLE_WORDS = { pi: "PI", researcher: "Researcher", member: null } as const;
const fullDay = (d: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export function LabPeople({ orgId, roster }: { orgId: string; roster: ReactNode | null }) {
  const [view, setView] = useState<"people" | "alumni" | "new" | "roster">("people");
  const q = useQuery({ queryKey: peopleKey(orgId), queryFn: () => readLabPeopleAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading people…</p>;
  // A refusal (a Viewer) shows the roster or nothing; only a failed load offers Retry (review).
  if (q.isError) return roster ?? <ErrorNotice what="People" onRetry={() => void q.refetch()} />;
  if (!q.data?.success) return roster;
  const d = q.data;
  const tabs = [{ key: "people" as const, label: "People", count: d.people.length }, { key: "alumni" as const, label: "Alumni" }, ...(d.admin ? [{ key: "new" as const, label: "New people" }] : []), ...(roster ? [{ key: "roster" as const, label: "Roster" }] : [])];
  return (
    <section aria-label="People" className="space-y-4" data-testid="lab-people">
      <UnderlineTabs tabs={tabs} value={view} onChange={setView} label="People views" idPrefix="lab-people" />
      <div id={`lab-people-panel-${view}`} role="tabpanel">
        {view === "roster" && roster ? roster : view === "new" && d.admin ? <OnboardingBoard orgId={orgId} /> : view === "alumni" ? <Alumni orgId={orgId} /> : <ByPosition orgId={orgId} me={d.me} admin={d.admin} pi={d.pi} positions={d.positions} people={d.people} />}
      </div>
    </section>
  );
}

function ByPosition({ orgId, me, admin, pi, positions, people }: { orgId: string; me: string; admin: boolean; pi: boolean; positions: Position[]; people: LabPerson[] }) {
  const groups = groupByPosition(people, positions);
  const leads = people.filter((p) => p.role !== "member");
  return (
    <div className="space-y-5 text-[13px]" data-testid="lab-by-position">
      {groups.map((g) => (
        <section key={g.id || "members"} aria-labelledby={`lab-pos-${g.id || "members"}`} className="space-y-2">
          <h3 id={`lab-pos-${g.id || "members"}`} className="nb-card-title">{g.label} <span className="font-mono text-muted-foreground">{g.people.length}</span></h3>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {g.people.map((p) => <PersonRow key={p.id} orgId={orgId} p={p} me={p.id === me} admin={admin} pi={pi} positions={positions} leads={leads} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PersonRow({ orgId, p, me, admin, pi, positions, leads }: { orgId: string; p: LabPerson; me: boolean; admin: boolean; pi: boolean; positions: Position[]; leads: LabPerson[] }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [f, setF] = useState({ position: p.position ?? "", startYear: p.startYear ? String(p.startYear) : "", supervisor: p.supervisor ?? "" });
  const label = positions.find((x) => x.id === p.position)?.label ?? null;
  const cancel = async () => {
    const r = await cancelFinishAction(orgId, p.id);
    if (!r.success) return void toast.error(r.error);
    toast.success("Leaving plan cancelled");
    void client.invalidateQueries({ queryKey: peopleKey(orgId) });
  };
  const save = async () => {
    const r = await setLabPositionAction(orgId, p.id, { position: f.position || null, startYear: f.startYear ? Number(f.startYear) : null });
    if (!r.success) return void toast.error(r.error);
    if ((f.supervisor || null) !== p.supervisor) {
      const s = await setLabSupervisorAction(orgId, p.id, f.supervisor || null);
      if (!s.success) return void toast.error(s.error);
    }
    toast.success("Position saved");
    setEditing(false);
    void client.invalidateQueries({ queryKey: peopleKey(orgId) });
  };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2" data-testid="lab-person">
      {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="size-8 rounded-sm object-cover" /> : <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-sm bg-muted font-mono">{p.name.slice(0, 1)}</span>}
      <span className="min-w-[180px] flex-1">
        <span className="font-medium">{p.name}{me ? " (you)" : ""}</span>
        <span className="block text-muted-foreground">{[label, p.startYear ? `since ${p.startYear}` : null, ROLE_WORDS[p.role] !== label ? ROLE_WORDS[p.role] : null].filter(Boolean).join(" · ") || "No position yet"}</span>
        {p.supervisor ? <span className="block text-muted-foreground">Supervisor: {leads.find((l) => l.id === p.supervisor)?.name ?? "someone who left"}</span> : null}
        {p.interests.length ? <span className="block text-muted-foreground">Interests: {p.interests.join(", ")}</span> : null}
      </span>
      {p.workspaces.length ? <span className="flex flex-wrap gap-1">{p.workspaces.map((w) => <Link key={w.id} href={`/workspaces/${encodeURIComponent(w.slug ?? w.id)}`} className="nb-tag">{w.title}</Link>)}</span> : null}
      {!me ? <Link href={`/messages?userId=${encodeURIComponent(p.id)}`} className={`${FORM_SECONDARY_CLASS} inline-flex items-center`}>Message<span className="sr-only"> {p.name}</span></Link> : null}
      {admin && !editing ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing(true)}>Set position<span className="sr-only"> for {p.name}</span></button> : null}
      {p.leavingOn ? <span className="flex items-center gap-2"><StatusBadge state="at_risk">Leaving {fullDay(p.leavingOn)}</StatusBadge>
        <button type="button" className="nb-link" onClick={() => void cancel()}>Cancel Leaving plan<span className="sr-only"> for {p.name}</span></button></span>
        : (admin || me) && p.role !== "pi" && !finishing ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setFinishing(true)}>Finish in the lab<span className="sr-only">{me ? "" : ` for ${p.name}`}</span></button> : null}
      {finishing ? <FinishForm orgId={orgId} p={p} canKeep={pi && !me} onDone={() => { setFinishing(false); void client.invalidateQueries({ queryKey: peopleKey(orgId) }); }} /> : null}
      {editing ? (
        <span className="flex w-full flex-wrap items-center gap-2" data-testid="lab-position-form">
          <select className="nb-select" data-size="sm" aria-label={`Position for ${p.name}`} value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}>
            <option value="">No position</option>{positions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <select className="nb-select" data-size="sm" aria-label={`Supervisor for ${p.name}`} value={f.supervisor} onChange={(e) => setF({ ...f, supervisor: e.target.value })}>
            <option value="">No supervisor</option>{leads.filter((l) => l.id !== p.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <Input type="number" min={1950} max={2100} value={f.startYear} onChange={(e) => setF({ ...f, startYear: e.target.value })} aria-label={`Start year for ${p.name}`} placeholder="Start year" className="w-[110px] font-mono" />
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing(false)}>Cancel</button>
        </span>
      ) : null}
    </li>
  );
}

/** The lab home (Overview, call 1): welcome, Reach the PI with office hours, People · Projects. */
export function LabHomeCard({ orgId, slug }: { orgId: string; slug: string }) {
  const q = useQuery({ queryKey: ["lab-home", orgId], queryFn: () => readLabHomeAction(orgId), staleTime: 60_000 });
  const t = useQuery({ queryKey: ["lab-my-trainings", orgId], queryFn: () => readMyTrainingsAction(orgId), staleTime: 60_000 });
  const needed = t.data?.success ? t.data.trainings.filter((x) => !x.trained) : [];
  if (!q.data?.success) return null;
  const d = q.data;
  return (
    <OrgCard title="Lab home" testId="lab-home">
      <div className="space-y-2 text-[13px]">
        {d.welcome ? <p>{d.welcome}</p> : d.admin ? <p className="text-muted-foreground">Add a welcome in About: what the lab studies and how to reach you.</p> : null}
        {d.contact ? (
          <p className="flex flex-wrap items-center gap-2" data-testid="reach-the-pi">
            <span className="font-medium">Reach the PI:</span>
            <Link href={`/messages?userId=${encodeURIComponent(d.contact.id)}`} className={`${FORM_SECONDARY_CLASS} inline-flex items-center gap-1.5`}><MessageSquare className="size-3.5" aria-hidden="true" />Message {d.contact.name}</Link>
            {d.officeHours ? <span className="text-muted-foreground">Office hours: {d.officeHours}</span> : null}
          </p>
        ) : null}
        {needed.length ? <p data-testid="lab-trainings-needed"><span className="font-medium">Trainings you still need:</span> {needed.map((x) => x.title).join(", ")}. A trainer signs you off.</p> : null}
        <p className="flex flex-wrap gap-4">
          <Link href={`/org/${encodeURIComponent(slug)}?tab=members`} className="nb-link"><span className="font-mono">{d.people}</span> {d.people === 1 ? "person" : "people"}</Link>
          <Link href={`/org/${encodeURIComponent(slug)}?tab=projects`} className="nb-link"><span className="font-mono">{d.projects}</span> {d.projects === 1 ? "project" : "projects"}</Link>
        </p>
      </div>
    </OrgCard>
  );
}

/** Settings → Lab (PI and Researchers). */
export function LabSettingsCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-settings", orgId], queryFn: () => readLabSettingsAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting text-[13px] text-muted-foreground"><PixelBeat />Loading lab settings…</p>;
  if (!q.data?.success) return null;
  return <LabSettingsForm orgId={orgId} initial={q.data.settings} owner={q.data.owner} pi={q.data.pi} leads={q.data.leads} onSaved={() => void q.refetch()} />;
}

function LabSettingsForm({ orgId, initial, owner, pi, leads, onSaved }: { orgId: string; initial: LabSettings; owner: string; pi: boolean; leads: Array<{ id: string; name: string }>; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [areas, setAreas] = useState(initial.researchAreas.join(", "));
  const save = async () => {
    const r = await saveLabSettingsAction(orgId, { ...f, researchAreas: areas.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8) });
    if (!r.success) return void toast.error(r.error);
    toast.success("Lab settings saved");
    onSaved();
  };
  const setPos = (i: number, label: string) => setF({ ...f, positions: f.positions.map((p, j) => (j === i ? { ...p, label } : p)) });
  const addPos = () => setF({ ...f, positions: [...f.positions, { id: `pos-${Date.now().toString(36).slice(-6)}`, label: "" }] });
  const dropPos = (i: number) => setF({ ...f, positions: f.positions.filter((_, j) => j !== i) });
  const SECTION_WORDS = { areas: "Research areas", people: "People", alumni: "Alumni", publications: "Selected publications", joinUs: "Join us" } as const;
  return (
    <SettingsCard title="Lab" headingLevel={2} description="Positions are labels, never permissions: PI and Researcher stay the roles. Contact is Message and an office-hours line; no email or phone.">
      <div className="space-y-4 text-[13px]" data-testid="lab-settings">
        <fieldset className="space-y-1.5">
          <legend className="font-medium"><FlaskConical className="mr-1 inline size-3.5" aria-hidden="true" />Positions</legend>
          {f.positions.map((p, i) => (
            <span key={p.id} className="flex items-center gap-2">
              <Input value={p.label} maxLength={40} onChange={(e) => setPos(i, e.target.value)} aria-label={`Position ${i + 1}`} className="w-[220px]" />
              {f.positions.length > 1 ? <button type="button" className="nb-link" onClick={() => dropPos(i)}>Remove<span className="sr-only"> {p.label}</span></button> : null}
            </span>
          ))}
          {f.positions.length < 12 ? <button type="button" className="nb-link" onClick={addPos}>Add a position</button> : null}
        </fieldset>
        <label className="block">Reach the PI messages
          <select className="nb-select mt-1 block" value={f.contactId ?? owner} onChange={(e) => setF({ ...f, contactId: e.target.value === owner ? null : e.target.value })}>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.id === owner ? " (PI)" : ""}</option>)}
          </select></label>
        {pi ? <label className="block">Who approves protocols
          <select className="nb-select mt-1 block" value={f.protocolApprovers} onChange={(e) => setF({ ...f, protocolApprovers: e.target.value as LabSettings["protocolApprovers"] })}>
            <option value="pi">The PI</option><option value="researchers">The PI and Researchers</option>
          </select></label> : <p>Protocols are approved by {f.protocolApprovers === "pi" ? "the PI" : "the PI and Researchers"} (the PI decides).</p>}
        <fieldset className="space-y-1.5">
          <legend className="font-medium">Equipment booking</legend>
          <span className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">From<Input type="time" value={f.booking.from} onChange={(e) => setF({ ...f, booking: { ...f.booking, from: e.target.value } })} className="w-auto font-mono" /></label>
            <label className="flex items-center gap-1.5">to<Input type="time" value={f.booking.to} onChange={(e) => setF({ ...f, booking: { ...f.booking, to: e.target.value } })} className="w-auto font-mono" /></label>
            <label className="flex items-center gap-1.5">Slots of<select className="nb-select" value={f.booking.slotMinutes} onChange={(e) => setF({ ...f, booking: { ...f.booking, slotMinutes: Number(e.target.value) as LabSettings["booking"]["slotMinutes"] } })}>
              {[30, 60, 120, 240].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} ${m === 60 ? "hour" : "hours"}` : `${m} minutes`}</option>)}</select></label>
            <label className="flex items-center gap-1.5">Up to<Input type="number" min={1} max={80} value={f.booking.weeklyCapHours} onChange={(e) => setF({ ...f, booking: { ...f.booking, weeklyCapHours: Number(e.target.value) } })} className="w-[80px] font-mono" />hours a week each</label>
          </span>
        </fieldset>
        <label className="block">Office hours (optional)<Input value={f.officeHours} maxLength={120} onChange={(e) => setF({ ...f, officeHours: e.target.value })} placeholder="Thursdays 15:00 to 16:00, room 204" className="mt-1" /></label>
        <fieldset className="space-y-1">
          <legend className="font-medium">Plans</legend>
          <p className="text-muted-foreground">The New people plan (Start here) is on by default; edit its steps under Onboarding plan.</p>
          <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.plans.leaving} onChange={(e) => setF({ ...f, plans: { ...f.plans, leaving: e.target.checked } })} />Leaving plan (Finish in the lab)</label>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="font-medium">Public About</legend>
          {(Object.keys(SECTION_WORDS) as Array<keyof typeof SECTION_WORDS>).map((k) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.about[k]} onChange={(e) => setF({ ...f, about: { ...f.about, [k]: e.target.checked } })} />{SECTION_WORDS[k]}</label>
          ))}
          <p className="text-muted-foreground">People appear only if their own profile is public; alumni only with their yes.</p>
        </fieldset>
        <label className="block">Research areas (comma-separated, up to 8)<Input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="3D scenes, Video understanding" className="mt-1" /></label>
        <label className="block">Join us<textarea className="nb-textarea mt-1 w-full" rows={2} maxLength={400} value={f.joinUs} onChange={(e) => setF({ ...f, joinUs: e.target.value })} placeholder="We take 1 to 2 PhD students a year. Message the PI." /></label>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save lab settings</button>
        {f.positions.some((p) => !p.label.trim()) ? <StatusBadge state="at_risk">Name every position</StatusBadge> : null}
      </div>
    </SettingsCard>
  );
}

/** Finish in the lab (B6.1c): an end date; the PI or a Researcher can keep the person as a Viewer. */
function FinishForm({ orgId, p, canKeep, onDone }: { orgId: string; p: LabPerson; canKeep: boolean; onDone: () => void }) {
  const [end, setEnd] = useState(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const [keep, setKeep] = useState(false);
  const save = async () => {
    const r = await startFinishAction(orgId, p.id, { end, keepAsViewer: canKeep && keep });
    if (!r.success) return void toast.error(r.error);
    toast.success("Leaving plan started");
    onDone();
  };
  return (
    <span className="flex w-full flex-wrap items-center gap-2" data-testid="finish-form">
      <label className="flex items-center gap-2">Last day<Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-auto font-mono" /></label>
      {canKeep ? <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep as Viewer afterwards (papers still in review)</label> : null}
      <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Start the Leaving plan</button>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button>
      <span className="w-full text-muted-foreground">On the last day their workspaces go to their supervisor and private lab work closes{canKeep && keep ? ", except as a Viewer" : ""}. They’re asked whether to be listed as alumni.</span>
    </span>
  );
}

/** Members → Alumni: listed alumni only, Now at in their words. */
function Alumni({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-alumni", orgId], queryFn: () => readLabAlumniAction(orgId), staleTime: 60_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading alumni…</p>;
  if (!q.data?.success) return <ErrorNotice what="Alumni" onRetry={() => void q.refetch()} />;
  const list = q.data.alumni;
  return list.length ? <AlumniList alumni={list} /> : <p className="py-4 text-[13px] text-muted-foreground">No alumni listed yet. People who finish here are asked whether to be listed.</p>;
}

type AlumniRow = { id: string; name: string; position: string | null; startYear: number | null; endYear: number; nowAt: string | null };
function AlumniList({ alumni }: { alumni: AlumniRow[] }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card text-[13px]" data-testid="lab-alumni">
      {alumni.map((a) => (
        <li key={a.id} className="px-3 py-2"><span className="font-medium">{a.name}</span>
          <span className="text-muted-foreground"> · {[a.position, a.startYear ? `${a.startYear} to ${a.endYear}` : String(a.endYear)].filter(Boolean).join(", ")}</span>
          {a.nowAt ? <span className="block">Now at {a.nowAt}</span> : null}</li>
      ))}
    </ul>
  );
}

/** Your alumni entry (only someone who finished here): List me as alumni, and Now at. Shows on About and the private header. */
export function MyAlumniCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["my-alumni", orgId], queryFn: () => readMyAlumniAction(orgId), staleTime: 60_000 });
  const e = q.data?.success ? q.data.entry : null;
  const [f, setF] = useState<{ listed: boolean; nowAt: string } | null>(null);
  if (!e) return null;
  const v = f ?? { listed: e.listed, nowAt: e.nowAt };
  const save = async () => {
    const r = await saveMyAlumniAction(orgId, v);
    if (!r.success) return void toast.error(r.error);
    toast.success(v.listed ? "You’re listed as alumni" : "You’re not listed");
    void q.refetch();
  };
  return (
    <section aria-label="Your alumni entry" className="w-full space-y-2 rounded-md border border-border bg-card p-3 text-left text-[13px]" data-testid="my-alumni">
      <p className="font-medium">You finished here{e.position ? ` as ${e.position}` : ""} in {e.endYear}.</p>
      <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={v.listed} onChange={(x) => setF({ ...v, listed: x.target.checked })} />List me as alumni</label>
      <label className="block">Now at (your words)<Input value={v.nowAt} maxLength={120} onChange={(x) => setF({ ...v, nowAt: x.target.value })} placeholder="PhD at another lab, a robotics startup…" className="mt-1" /></label>
      <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save</button>
    </section>
  );
}

/** The lab's public page (About): research areas, people by position, alumni, Join us — only what the PI turned on. */
export function LabAboutSections({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-about", orgId], queryFn: () => readLabAboutAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const groups = groupByPosition(d.people, d.positions);
  return (
    <div className="space-y-6" data-testid="lab-about">
      {d.areas.length ? <section aria-labelledby="lab-areas"><h2 id="lab-areas" className="nb-card-title mb-2">Research areas</h2><p className="text-[13px]">{d.areas.join(" · ")}</p></section> : null}
      {d.showPeople && groups.length ? (
        <section aria-labelledby="lab-people-public" className="space-y-2"><h2 id="lab-people-public" className="nb-card-title"><GraduationCap className="mr-1 inline size-4" aria-hidden="true" />People</h2>
          {groups.map((g) => <p key={g.id || "members"} className="text-[13px]"><span className="font-medium">{g.label}:</span> {g.people.map((p) => p.name).join(", ")}</p>)}</section>
      ) : null}
      {d.showAlumni && d.alumni.length ? <section aria-labelledby="lab-alumni-public" className="space-y-2"><h2 id="lab-alumni-public" className="nb-card-title">Alumni</h2><AlumniList alumni={d.alumni} /></section> : null}
      {d.joinUs ? (
        <section aria-labelledby="lab-join" className="space-y-2"><h2 id="lab-join" className="nb-card-title">Join us</h2><p className="whitespace-pre-wrap text-[13px]">{d.joinUs}</p>
          {d.signedIn && !d.isContact ? <Link href={`/messages?userId=${encodeURIComponent(d.contactId)}`} className={`${FORM_SECONDARY_CLASS} inline-flex items-center gap-1.5`}><MessageSquare className="size-3.5" aria-hidden="true" />Message the PI</Link> : null}</section>
      ) : null}
      <MyAlumniCard orgId={orgId} />
    </div>
  );
}
