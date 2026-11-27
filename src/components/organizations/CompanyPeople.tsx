"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { bookTimeOffAction, cancelTimeOffAction, readDirectoryAction, readPeopleCountsAction, readWhosOutAction, saveDirectorySettingsAction, saveMyDirectoryAction, setReportsToAction, type DirectoryPerson } from "@/app/actions/company-people";
import { StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { OnboardingBoard } from "@/components/organizations/CompanyOnboarding";
import { importGroups, localTime, nextDays, orgChart, outSpan, TIME_OFF_TYPES, type ChartNode, type TimeOffType } from "@/lib/organizations/directory";

// Report 33.3 (plan B4.2a–b, K2): Members in a company — the Directory for every member, the org chart, and the
// roster (admins) — plus Settings → Directory.
const key = (orgId: string) => ["company-directory", orgId] as const;
type View = "directory" | "chart" | "out" | "onboarding" | "counts" | "roster";

export function CompanyPeople({ orgId, roster }: { orgId: string; roster: ReactNode | null }) {
  const [view, setView] = useState<View>("directory");
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readDirectoryAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the directory…</p>;
  if (!q.data?.success) return roster ?? <ErrorNotice what="Directory" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const tabs = [{ key: "directory" as const, label: "Directory", count: d.people.length }, ...(d.limited ? [] : [{ key: "chart" as const, label: "Org chart" }, { key: "out" as const, label: "Who’s out" }]), ...(d.admin || (!d.limited && (d.people as DirectoryPerson[]).some((p) => p.reportsTo === d.me)) ? [{ key: "onboarding" as const, label: "Onboarding" }] : []), ...(d.admin ? [{ key: "counts" as const, label: "Counts" }] : []), ...(roster ? [{ key: "roster" as const, label: "Roster" }] : [])];
  return (
    <section aria-label="People" className="space-y-4" data-testid="company-people">
      <UnderlineTabs tabs={tabs} value={view} onChange={setView} label="People views" idPrefix="company-people" />
      <div id={`company-people-panel-${view}`} role="tabpanel">
        {view === "roster" && roster ? roster : view === "counts" && d.admin ? <Counts orgId={orgId} /> : view === "out" && !d.limited ? <WhosOut orgId={orgId} /> : view === "onboarding" ? <OnboardingBoard orgId={orgId} /> : view === "chart" && !d.limited ? <OrgChart orgId={orgId} people={d.people as DirectoryPerson[]} admin={d.admin} managerLeft={"managerLeft" in d ? d.managerLeft ?? [] : []} />
          : d.limited ? <ul className="space-y-1 text-[13px]" data-testid="directory-limited">{d.people.map((p) => <li key={p.id}><span className="font-medium">{p.name}</span>{p.title ? <span className="text-muted-foreground"> · {p.title}</span> : null}</li>)}</ul>
          : <>{d.admin ? <ImportPeople orgId={orgId} /> : null}<Directory orgId={orgId} me={d.me} people={d.people as DirectoryPerson[]} offices={d.offices} /></>}
      </div>
    </section>
  );
}

function Directory({ orgId, me, people, offices }: { orgId: string; me: string; people: DirectoryPerson[]; offices: string[] }) {
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [office, setOffice] = useState("");
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const teams = useMemo(() => [...new Set(people.flatMap((p) => p.teams))].sort(), [people]);
  const s = search.trim().toLowerCase();
  const shown = people.filter((p) => (!team || p.teams.includes(team)) && (!office || p.office === office)
    && (!s || p.name.toLowerCase().includes(s) || p.askMeAbout.some((a) => a.toLowerCase().includes(s)) || (p.title ?? "").toLowerCase().includes(s)))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me));
  const mine = people.find((p) => p.id === me);
  const now = new Date();
  return (
    <div className="space-y-3 text-[13px]" data-testid="directory">
      {mine && !mine.zone ? <MyFields orgId={orgId} me={mine} offices={offices} /> : null}
      <span className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people or Ask me about…" aria-label="Search people" className="w-[260px]" />
        {teams.length ? <select className="nb-select" data-size="sm" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option>{teams.map((t) => <option key={t}>{t}</option>)}</select> : null}
        {offices.length ? <select className="nb-select" data-size="sm" aria-label="Office" value={office} onChange={(e) => setOffice(e.target.value)}><option value="">All offices</option>{offices.map((o) => <option key={o}>{o}</option>)}</select> : null}
      </span>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="People">
        {shown.map((p) => {
          const t = localTime(now, p.zone, p.hours);
          return (
            <li key={p.id} className="space-y-1 rounded-md border border-border p-3" data-testid="person-card">
              <span className="flex items-center gap-2">
                {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="size-8 rounded-sm object-cover" /> : <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-sm bg-muted font-mono">{p.name.slice(0, 1)}</span>}
                <span className="min-w-0"><span className="block truncate font-medium">{p.name}{p.id === me ? " (you)" : ""}</span>{p.title ? <span className="block truncate text-muted-foreground">{p.title}</span> : null}</span>
              </span>
              {p.teams.length || p.office ? <p className="text-muted-foreground">{[p.teams.join(", "), p.office].filter(Boolean).join(" · ")}</p> : null}
              {t || p.awayUntil ? <p aria-label={t ? `${t.label} for ${p.name}` : undefined}>{t ? <span className="font-mono">{t.label}</span> : null}{t && p.hours ? <span className="text-muted-foreground"> · {p.hours.from}–{p.hours.to}</span> : null}
                {t?.offHours ? <span className="text-muted-foreground"> · off hours</span> : null}
                {p.awayUntil ? <> {" "}<StatusBadge state="at_risk">{p.awayNow ? `Away until ${p.awayUntil}` : `Away from ${p.awayFrom}`}</StatusBadge></> : null}</p> : null}
              {p.reportsTo ? <p className="text-muted-foreground">Reports to: {names.get(p.reportsTo)}</p> : null}
              {p.askMeAbout.length ? <p><span className="text-muted-foreground">Ask me about:</span> {p.askMeAbout.join(", ")}</p> : null}
              {p.id !== me ? <Link href={`/messages?userId=${encodeURIComponent(p.id)}`} className={FORM_SECONDARY_CLASS}>Message<span className="sr-only"> {p.name}</span></Link> : null}
            </li>
          );
        })}
      </ul>
      {!shown.length ? <p className="text-muted-foreground">Nobody matches.</p> : null}
    </div>
  );
}

/** "Add your time zone and working hours" (layer 1, member's first look). */
function MyFields({ orgId, me, offices }: { orgId: string; me: DirectoryPerson; offices: string[] }) {
  const client = useQueryClient();
  const guess = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const [f, setF] = useState({ zone: me.zone ?? guess, from: me.hours?.from ?? "09:00", to: me.hours?.to ?? "17:30", office: me.office ?? "" });
  const save = async () => {
    const r = await saveMyDirectoryAction(orgId, { zone: f.zone || null, hours: f.from && f.to ? { from: f.from, to: f.to } : null, office: f.office || null });
    if (!r.success) return void toast.error(r.error);
    toast.success("Your card is updated");
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3" data-testid="my-directory-fields">
      <legend className="px-1 font-medium">Add your time zone and working hours</legend>
      <Input value={f.zone} maxLength={60} aria-label="Your time zone" placeholder="Europe/London" onChange={(e) => setF({ ...f, zone: e.target.value })} className="w-[200px] font-mono" />
      <Input type="time" value={f.from} aria-label="Working hours from" onChange={(e) => setF({ ...f, from: e.target.value })} className="w-[120px] font-mono" />
      <Input type="time" value={f.to} aria-label="Working hours to" onChange={(e) => setF({ ...f, to: e.target.value })} className="w-[120px] font-mono" />
      {offices.length ? <select className="nb-select" data-size="sm" aria-label="Your office" value={f.office} onChange={(e) => setF({ ...f, office: e.target.value })}><option value="">No office</option>{offices.map((o) => <option key={o}>{o}</option>)}</select> : null}
      <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save</button>
    </fieldset>
  );
}

/** The org chart (call 4): a nested list from Reports to; admins change who someone reports to here. */
function OrgChart({ orgId, people, admin, managerLeft }: { orgId: string; people: DirectoryPerson[]; admin: boolean; managerLeft: string[] }) {
  const client = useQueryClient();
  const byId = new Map(people.map((p) => [p.id, p]));
  const reportsTo = Object.fromEntries(people.filter((p) => p.reportsTo).map((p) => [p.id, p.reportsTo!]));
  const roots = orgChart(people.map((p) => p.id), reportsTo);
  const change = async (person: string, manager: string) => {
    const r = await setReportsToAction(orgId, person, manager || null);
    if (!r.success) return void toast.error(r.error);
    toast.success("Reports to changed");
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  const node = (n: ChartNode): ReactNode => {
    const p = byId.get(n.id)!;
    return (
      <li key={n.id} role="treeitem" aria-selected={false} aria-expanded={n.reports.length ? true : undefined} aria-label={`${p.name}${p.title ? `, ${p.title}` : ""}${n.count ? `, ${n.count} ${n.count === 1 ? "report" : "reports"}` : ""}`}>
        <span className="flex flex-wrap items-center gap-2 py-0.5">
          <span className="font-medium">{p.name}</span>{p.title ? <span className="text-muted-foreground">· {p.title}</span> : null}
          {n.count ? <span className="font-mono text-muted-foreground">({n.count})</span> : null}
          {admin && managerLeft.includes(n.id) ? <StatusBadge state="at_risk">Reports to: no one</StatusBadge> : null}
          {admin ? <select className="nb-select" data-size="sm" aria-label={`${p.name} reports to`} value={p.reportsTo ?? ""} onChange={(e) => void change(n.id, e.target.value)}>
            <option value="">No one</option>{people.filter((o) => o.id !== n.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : null}
        </span>
        {n.reports.length ? <ul role="group" className="ml-4 border-l border-border pl-3">{n.reports.map(node)}</ul> : null}
      </li>
    );
  };
  return <ul role="tree" aria-label="Org chart" className="text-[13px]" data-testid="org-chart">{roots.map(node)}</ul>;
}

/** Settings → Directory (admins): whether Viewers see names and titles. Email and phone never show. */
export function DirectorySettingsCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readDirectoryAction(orgId), staleTime: 30_000 });
  const [picked, setPicked] = useState<boolean | null>(null);
  const d = q.data?.success && "viewersAllowed" in q.data ? q.data : null;
  if (!d?.admin) return null;
  const on = picked ?? d.viewersAllowed;
  const save = async (next: boolean) => {
    setPicked(next);
    const r = await saveDirectorySettingsAction(orgId, { viewers: next });
    if (!r.success) { setPicked(null); return void toast.error(r.error); }
    toast.success("Directory saved");
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <SettingsCard title="Directory" headingLevel={2} description="Every member sees the company directory. Email and phone never show; people use Message.">
      <label className="flex items-center gap-2 text-[13px]" data-testid="directory-settings"><input className="nb-check" type="checkbox" checked={on} onChange={(e) => void save(e.target.checked)} />Viewers see the directory (names and titles only)</label>
      {d.typeNames ? <TypeNames orgId={orgId} saved={d.typeNames} /> : null}
    </SettingsCard>
  );
}

/** Counts (call 8, admins): numbers only — by team, by office, joins per month. */
function Counts({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["company-counts", orgId], queryFn: () => readPeopleCountsAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d) return q.isPending ? <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Counting…</p> : <ErrorNotice what="Counts" onRetry={() => void q.refetch()} />;
  const table = (title: string, rows: Array<{ name: string; n: number }>) => (
    <div className="space-y-1"><p className="font-medium">{title}</p>
      {rows.length ? <ul className="space-y-0.5">{rows.map((r) => <li key={r.name} className="flex justify-between gap-4"><span>{r.name}</span><span className="font-mono">{r.n}</span></li>)}</ul> : <p className="text-muted-foreground">None yet.</p>}
    </div>
  );
  return (
    <div className="grid gap-6 text-[13px] sm:grid-cols-3" data-testid="people-counts">
      <p className="sm:col-span-3 text-muted-foreground"><span className="font-mono text-foreground">{d.total}</span> {d.total === 1 ? "person" : "people"} · counts never name anyone</p>
      {table("By team", d.teams)}
      {table("By office", d.offices)}
      {table("Joined per month", d.joined.map((j) => ({ name: j.month, n: j.n })))}
    </div>
  );
}

/** Import people (layer 1, admins): a CSV of email, title and team, sent through the existing email invites. */
function ImportPeople({ orgId }: { orgId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const teams = useQuery({ queryKey: ["company-about", orgId], queryFn: async () => (await import("@/app/actions/company")).readCompanyAboutAction(orgId), staleTime: 60_000 });
  const plan = importGroups(text);
  const count = plan.groups.reduce((n, g) => n + g.emails.length, 0);
  const send = async () => {
    setBusy(true);
    const { inviteByEmailAction } = await import("@/app/actions/org-members");
    const known = teams.data?.success ? teams.data.teams : [];
    let invited = 0;
    const unknownTeams = new Set<string>();
    for (const g of plan.groups) {
      const team = g.team ? known.find((t) => t.title.toLowerCase() === g.team.toLowerCase()) : null;
      if (g.team && !team) unknownTeams.add(g.team);
      const r = await inviteByEmailAction(orgId, { emails: g.emails.join("\n"), role: "member", title: g.title || null, childProjectId: team?.id ?? null });
      if (!r.success) { setBusy(false); return void toast.error(r.error); }
      invited += r.invited + r.existing;
    }
    setBusy(false);
    setText("");
    toast.success(`${invited} invited${unknownTeams.size ? ` · no team called ${[...unknownTeams].join(", ")}, so they join the company only` : ""}`);
  };
  return (
    <details className="mb-3 rounded-md border border-border text-[13px]" data-testid="import-people">
      <summary className="cursor-pointer px-3 py-2 font-medium">Import people</summary>
      <div className="space-y-2 px-3 pb-3">
        <p className="text-muted-foreground">One person per line: email, title, team. They get the company’s email invite; set Reports to once they join.</p>
        <textarea className="nb-textarea font-mono" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="People to import" placeholder={"priya@acme.com, Head of People, People"} />
        <span className="flex items-center gap-3">
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!count || busy} onClick={() => void send()}>Send {count || ""} {count === 1 ? "invite" : "invites"}</button>
          {plan.skipped ? <span className="text-muted-foreground">{plan.skipped} {plan.skipped === 1 ? "line isn’t" : "lines aren’t"} an email; skipped</span> : null}
        </span>
      </div>
    </details>
  );
}

/** Settings → Directory (B4.2c): rename the four time-off types; a blank keeps the default name. */
function TypeNames({ orgId, saved }: { orgId: string; saved: Record<TimeOffType, string> }) {
  const client = useQueryClient();
  const [names, setNames] = useState<Record<TimeOffType, string>>(saved);
  const save = async () => {
    const r = await saveDirectorySettingsAction(orgId, { typeNames: names });
    if (!r.success) return void toast.error(r.error);
    toast.success("Time-off types saved");
    void client.invalidateQueries({ queryKey: key(orgId) });
    void client.invalidateQueries({ queryKey: ["whos-out", orgId] });
  };
  return (
    <fieldset className="mt-4 space-y-2 text-[13px]" data-testid="time-off-types">
      <legend className="font-medium">Time-off types</legend>
      <p className="text-muted-foreground">People pick one when they book time off. Others see only “Away”; the type reaches the person, their line manager and admins.</p>
      <div className="flex flex-wrap gap-2">{TIME_OFF_TYPES.map((t) => (
        <Input key={t.id} value={names[t.id]} maxLength={30} aria-label={`Name for ${t.name}`} placeholder={t.name} onChange={(e) => setNames({ ...names, [t.id]: e.target.value })} className="w-[160px]" />))}</div>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save()}>Save types</button>
    </fieldset>
  );
}

const shortDay = (iso: string, zone: string | null) => new Date(iso).toLocaleDateString("en-GB", { timeZone: zone ?? undefined, day: "numeric", month: "short" });

/**
 * Who's out (B4.2c, layer 4): the next two weeks by team, a bar per person labelled Away (or the type for those
 * allowed); on a phone it reads as a list. Book time off is here: dates and a type; my own can be cancelled.
 */
function WhosOut({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["whos-out", orgId], queryFn: () => readWhosOutAction(orgId), staleTime: 30_000 });
  const [form, setForm] = useState<{ from: string; to: string; type: TimeOffType } | null>(null);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading who’s out…</p>;
  if (!q.data?.success) return <ErrorNotice what="Who’s out" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const days = nextDays(new Date(), d.zone);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["whos-out", orgId] }); void client.invalidateQueries({ queryKey: key(orgId) }); };
  const book = async () => {
    if (!form) return;
    const r = await bookTimeOffAction(orgId, form);
    if (!r.success) return void toast.error(r.error);
    toast.success(r.excused ? `Time off booked; ${r.excused} ${r.excused === 1 ? "piece of work is" : "pieces of work are"} excused` : "Time off booked");
    setForm(null);
    refresh();
  };
  const cancel = async (id: string) => {
    const r = await cancelTimeOffAction(orgId, id);
    if (!r.success) return void toast.error(r.error);
    toast.success("Time off cancelled");
    refresh();
  };
  // By team (layer 4); someone in several teams shows under each; no team → "No team".
  const groups = new Map<string, typeof d.out>();
  for (const o of d.out) for (const t of o.teams.length ? o.teams : ["No team"]) groups.set(t, [...(groups.get(t) ?? []), o]);
  return (
    <section aria-label="Who’s out" className="space-y-3 text-[13px]" data-testid="whos-out">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">The next two weeks{d.zone ? ` · times in ${d.zone.replace(/_/g, " ")}` : ""}.</p>
        {!form ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setForm({ from: days[0]!, to: days[0]!, type: "vacation" })}>Book time off</button> : null}
      </div>
      {form ? (
        <fieldset className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3" data-testid="book-time-off"><legend className="sr-only">Book time off</legend>
          <label className="flex flex-col">First day<Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">Last day<Input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">Type<select className="nb-select mt-0.5" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TimeOffType })}>
            {d.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!form.from || !form.to} onClick={() => void book()}>Book</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setForm(null)}>Cancel</button>
          <p className="basis-full text-muted-foreground">Others see “Away until …”. Your work due on those days is excused.</p>
        </fieldset>
      ) : null}
      {!d.out.length ? <p className="text-muted-foreground">Nobody is away in the next two weeks.</p> : (
        <div className="space-y-3">{[...groups.entries()].sort(([a], [b]) => (a === "No team" ? 1 : b === "No team" ? -1 : a.localeCompare(b))).map(([team, list]) => (
          <div key={team}><h4 className="font-medium">{team}</h4>
            <ul className="mt-1 space-y-1.5">{list.map((o) => {
              const span = outSpan(o.from, o.until, days, d.zone);
              return (
                <li key={`${team}:${o.id}`} className="grid items-center gap-2 sm:grid-cols-[180px_1fr_auto]" data-testid="whos-out-row">
                  <span><span className="font-medium">{o.name}</span> · {o.label} · {shortDay(o.from, d.zone)}–{shortDay(o.until, d.zone)}</span>
                  <span aria-hidden="true" className="hidden grid-cols-[repeat(14,minmax(0,1fr))] gap-px sm:grid">{days.map((k, i) => (
                    <span key={k} className={span && i >= span.start && i <= span.end ? "h-2.5 rounded-[2px] bg-[var(--status-info)]" : "h-2.5 rounded-[2px] bg-muted"} />))}</span>
                  {o.mine ? <button type="button" className="nb-link justify-self-start" onClick={() => void cancel(o.id)}>Cancel<span className="sr-only"> my time off</span></button> : <span />}
                </li>
              );
            })}</ul>
          </div>
        ))}</div>
      )}
    </section>
  );
}

