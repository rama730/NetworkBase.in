"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, MessageSquare } from "lucide-react";

import { readLabHomeAction, readLabPeopleAction, readLabSettingsAction, saveLabSettingsAction, setLabPositionAction, setLabSupervisorAction, type LabPerson } from "@/app/actions/lab";
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

export function LabPeople({ orgId, roster }: { orgId: string; roster: ReactNode | null }) {
  const [view, setView] = useState<"people" | "new" | "roster">("people");
  const q = useQuery({ queryKey: peopleKey(orgId), queryFn: () => readLabPeopleAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading people…</p>;
  // A refusal (a Viewer) shows the roster or nothing; only a failed load offers Retry (review).
  if (q.isError) return roster ?? <ErrorNotice what="People" onRetry={() => void q.refetch()} />;
  if (!q.data?.success) return roster;
  const d = q.data;
  const tabs = [{ key: "people" as const, label: "People", count: d.people.length }, ...(d.admin ? [{ key: "new" as const, label: "New people" }] : []), ...(roster ? [{ key: "roster" as const, label: "Roster" }] : [])];
  return (
    <section aria-label="People" className="space-y-4" data-testid="lab-people">
      <UnderlineTabs tabs={tabs} value={view} onChange={setView} label="People views" idPrefix="lab-people" />
      <div id={`lab-people-panel-${view}`} role="tabpanel">
        {view === "roster" && roster ? roster : view === "new" && d.admin ? <OnboardingBoard orgId={orgId} /> : <ByPosition orgId={orgId} me={d.me} admin={d.admin} positions={d.positions} people={d.people} />}
      </div>
    </section>
  );
}

function ByPosition({ orgId, me, admin, positions, people }: { orgId: string; me: string; admin: boolean; positions: Position[]; people: LabPerson[] }) {
  const groups = groupByPosition(people, positions);
  const leads = people.filter((p) => p.role !== "member");
  return (
    <div className="space-y-5 text-[13px]" data-testid="lab-by-position">
      {groups.map((g) => (
        <section key={g.id || "members"} aria-labelledby={`lab-pos-${g.id || "members"}`} className="space-y-2">
          <h3 id={`lab-pos-${g.id || "members"}`} className="nb-card-title">{g.label} <span className="font-mono text-muted-foreground">{g.people.length}</span></h3>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {g.people.map((p) => <PersonRow key={p.id} orgId={orgId} p={p} me={p.id === me} admin={admin} positions={positions} leads={leads} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PersonRow({ orgId, p, me, admin, positions, leads }: { orgId: string; p: LabPerson; me: boolean; admin: boolean; positions: Position[]; leads: LabPerson[] }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ position: p.position ?? "", startYear: p.startYear ? String(p.startYear) : "", supervisor: p.supervisor ?? "" });
  const label = positions.find((x) => x.id === p.position)?.label ?? null;
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
        <span className="block text-muted-foreground">{[label, p.startYear ? `since ${p.startYear}` : null, ROLE_WORDS[p.role]].filter(Boolean).join(" · ") || "No position yet"}</span>
        {p.supervisor ? <span className="block text-muted-foreground">Supervisor: {leads.find((l) => l.id === p.supervisor)?.name ?? "someone who left"}</span> : null}
        {p.interests.length ? <span className="block text-muted-foreground">Interests: {p.interests.join(", ")}</span> : null}
      </span>
      {p.workspaces.length ? <span className="flex flex-wrap gap-1">{p.workspaces.map((w) => <Link key={w.id} href={`/workspaces/${encodeURIComponent(w.slug ?? w.id)}`} className="nb-tag">{w.title}</Link>)}</span> : null}
      {!me ? <Link href={`/messages?userId=${encodeURIComponent(p.id)}`} className={FORM_SECONDARY_CLASS}>Message<span className="sr-only"> {p.name}</span></Link> : null}
      {admin && !editing ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing(true)}>Set position<span className="sr-only"> for {p.name}</span></button> : null}
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
  if (!q.data?.success) return null;
  const d = q.data;
  return (
    <OrgCard title="Lab home" testId="lab-home">
      <div className="space-y-2 text-[13px]">
        {d.welcome ? <p>{d.welcome}</p> : d.admin ? <p className="text-muted-foreground">Add a welcome in About: what the lab studies and how to reach you.</p> : null}
        {d.contact ? (
          <p className="flex flex-wrap items-center gap-2" data-testid="reach-the-pi">
            <span className="font-medium">Reach the PI:</span>
            <Link href={`/messages?userId=${encodeURIComponent(d.contact.id)}`} className={FORM_SECONDARY_CLASS}><MessageSquare className="size-3.5" aria-hidden="true" />Message {d.contact.name}</Link>
            {d.officeHours ? <span className="text-muted-foreground">Office hours: {d.officeHours}</span> : null}
          </p>
        ) : null}
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
  return <LabSettingsForm orgId={orgId} initial={q.data.settings} owner={q.data.owner} leads={q.data.leads} onSaved={() => void q.refetch()} />;
}

function LabSettingsForm({ orgId, initial, owner, leads, onSaved }: { orgId: string; initial: LabSettings; owner: string; leads: Array<{ id: string; name: string }>; onSaved: () => void }) {
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
