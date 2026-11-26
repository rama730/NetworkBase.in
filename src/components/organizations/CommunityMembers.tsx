"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readCommunityDirectoryAction, readCommunityLogAction, readCommunityPeopleAction, saveCommunityMembersSettingsAction, saveMyCommunityCardAction, setCommunityLabelAction, type CommunityCard, type CommunityPerson } from "@/app/actions/community-members";
import { moderateCommunityReportAction, readCommunityModerationAction } from "@/app/actions/community-moderation";
import { StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import type { CommunityLabel } from "@/lib/organizations/community";

// Report 34.3 (plan B5.2, M2): Members in a community — the Directory for every member; Moderation for moderators
// and organisers; People, Roles and the Activity log for organisers; the roster for admins. Settings → Members.
const dirKey = (orgId: string) => ["community-directory", orgId] as const;
const peopleKey = (orgId: string) => ["community-people", orgId] as const;
type View = "directory" | "moderation" | "people" | "roles" | "log" | "roster";
const STATUS_WORD = { new: "New", active: "Active", quiet: "Quiet" } as const;
const labelWord = (l: CommunityLabel, helperWord: string) => (l === "helper" ? helperWord : l === "host" ? "Host" : "Moderator");
const joinedLabel = (iso: string | null) => (iso ? `Joined ${new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(iso))}` : null);
const fullDate = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(new Date(iso));

export function CommunityMembers({ orgId, roster }: { orgId: string; roster: ReactNode | null }) {
  const [view, setView] = useState<View>("directory");
  const q = useQuery({ queryKey: dirKey(orgId), queryFn: () => readCommunityDirectoryAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the directory…</p>;
  if (!q.data?.success) return roster ?? <ErrorNotice what="Directory" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const tabs = [
    { key: "directory" as const, label: "Directory", count: d.people.length + (d.me && !d.me.hidden ? 1 : 0) },
    ...(d.moderator || d.organiser ? [{ key: "moderation" as const, label: "Moderation" }] : []),
    ...(d.organiser ? [{ key: "people" as const, label: "People" }, { key: "roles" as const, label: "Roles" }, { key: "log" as const, label: "Activity log" }] : []),
    ...(roster ? [{ key: "roster" as const, label: "Roster" }] : []),
  ];
  return (
    <section aria-label="Members" className="space-y-4" data-testid="community-members">
      <UnderlineTabs tabs={tabs} value={view} onChange={setView} label="Members views" idPrefix="community-members" />
      <div id={`community-members-panel-${view}`} role="tabpanel">
        {view === "roster" && roster ? roster
          : view === "moderation" ? <Moderation orgId={orgId} />
          : view === "people" && d.organiser ? <People orgId={orgId} helperWord={d.helperWord} />
          : view === "roles" && d.organiser ? <Roles orgId={orgId} helperWord={d.helperWord} />
          : view === "log" && d.organiser ? <ActivityLog orgId={orgId} />
          : <Directory orgId={orgId} me={d.me} people={d.people} helperWord={d.helperWord} />}
      </div>
    </section>
  );
}

function Badges({ p, helperWord }: { p: CommunityCard; helperWord: string }) {
  const words = [...(p.organiser ? ["Organiser"] : []), ...p.labels.map((l) => labelWord(l, helperWord))];
  if (!words.length && !p.isNew) return null;
  return <span className="flex flex-wrap gap-1">{words.map((w) => <StatusBadge key={w} state="neutral">{w}</StatusBadge>)}{p.isNew ? <StatusBadge state="active">New</StatusBadge> : null}</span>;
}

function Card({ p, me, helperWord }: { p: CommunityCard; me: boolean; helperWord: string }) {
  return (
    <li className="space-y-1 rounded-md border border-border p-3" data-testid="community-card">
      <span className="flex items-center gap-2">
        {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="size-8 rounded-sm object-cover" /> : <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-sm bg-muted font-mono">{p.name.slice(0, 1)}</span>}
        <span className="min-w-0"><h3 className="truncate text-[13px] font-medium">{p.name}{me ? " (you)" : ""}</h3>
          {p.place || p.joined ? <span className="block truncate text-muted-foreground">{[p.place, joinedLabel(p.joined)].filter(Boolean).join(" · ")}</span> : null}</span>
      </span>
      <Badges p={p} helperWord={helperWord} />
      {p.interests.length ? <p><span className="text-muted-foreground">Interests:</span> {p.interests.join(", ")}</p> : null}
      {p.askMeAbout.length ? <p><span className="text-muted-foreground">Ask me about:</span> {p.askMeAbout.join(", ")}</p> : null}
      {p.hereFor ? <p><span className="text-muted-foreground">Here for:</span> “{p.hereFor}”</p> : null}
      {p.posts !== null ? <p className="font-mono text-muted-foreground">{p.posts} {p.posts === 1 ? "post" : "posts"}</p> : null}
      {!me ? <Link href={`/messages?userId=${encodeURIComponent(p.id)}`} className={FORM_SECONDARY_CLASS}>Message<span className="sr-only"> {p.name}</span></Link> : null}
    </li>
  );
}

function Directory({ orgId, me, people, helperWord }: { orgId: string; me: (CommunityCard & { hidden: boolean; hideCounts: boolean }) | null; people: CommunityCard[]; helperWord: string }) {
  const [search, setSearch] = useState("");
  const [interest, setInterest] = useState("");
  const [place, setPlace] = useState("");
  const [role, setRole] = useState("");
  const interests = useMemo(() => [...new Set(people.flatMap((p) => p.interests))].sort(), [people]);
  const places = useMemo(() => [...new Set(people.map((p) => p.place).filter((x): x is string => Boolean(x)))].sort(), [people]);
  const s = search.trim().toLowerCase();
  const shown = people.filter((p) => (!interest || p.interests.includes(interest)) && (!place || p.place === place)
    && (!role || (role === "organiser" ? p.organiser : p.labels.includes(role as CommunityLabel)))
    && (!s || p.name.toLowerCase().includes(s) || [...p.interests, ...p.askMeAbout].some((a) => a.toLowerCase().includes(s))));
  return (
    <div className="space-y-3 text-[13px]" data-testid="community-directory">
      {me ? <MyCard orgId={orgId} me={me} /> : null}
      <span className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people or interests…" aria-label="Search people or interests" className="w-[260px]" />
        {interests.length ? <select className="nb-select" data-size="sm" aria-label="Interest" value={interest} onChange={(e) => setInterest(e.target.value)}><option value="">All interests</option>{interests.map((t) => <option key={t}>{t}</option>)}</select> : null}
        {places.length ? <select className="nb-select" data-size="sm" aria-label="Place" value={place} onChange={(e) => setPlace(e.target.value)}><option value="">All places</option>{places.map((t) => <option key={t}>{t}</option>)}</select> : null}
        <select className="nb-select" data-size="sm" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Everyone</option><option value="organiser">Organisers</option><option value="moderator">Moderators</option><option value="host">Hosts</option><option value="helper">{helperWord}s</option>
        </select>
      </span>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="People">
        {me && !me.hidden ? <Card p={me} me helperWord={helperWord} /> : null}
        {shown.map((p) => <Card key={p.id} p={p} me={false} helperWord={helperWord} />)}
      </ul>
      {!shown.length ? <p className="text-muted-foreground">{people.length ? "Nobody matches." : "Nobody else shows here yet."}</p> : null}
    </div>
  );
}

/** Show me in the directory, Show my counts (calls 2–3), and "Add your interests" (member's first look). */
function MyCard({ orgId, me }: { orgId: string; me: CommunityCard & { hidden: boolean; hideCounts: boolean } }) {
  const client = useQueryClient();
  const [f, setF] = useState({ shown: !me.hidden, counts: !me.hideCounts });
  const save = async (next: typeof f) => {
    setF(next);
    const r = await saveMyCommunityCardAction(orgId, { hidden: !next.shown, hideCounts: !next.counts });
    if (!r.success) { setF(f); return void toast.error(r.error); }
    void client.invalidateQueries({ queryKey: dirKey(orgId) });
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border p-3" data-testid="my-community-card">
      <legend className="px-1 font-medium">Your card</legend>
      <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.shown} onChange={(e) => void save({ ...f, shown: e.target.checked })} />Show me in the directory</label>
      <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.counts} onChange={(e) => void save({ ...f, counts: e.target.checked })} />Show my post count</label>
      {!me.interests.length ? <Link href="/profile/edit" className="nb-link">Add your interests</Link> : null}
    </fieldset>
  );
}

function usePeople(orgId: string) {
  return useQuery({ queryKey: peopleKey(orgId), queryFn: () => readCommunityPeopleAction(orgId), staleTime: 30_000 });
}

/** People (organisers): status as words, roles, joined, join answers; Give someone a role. */
function People({ orgId, helperWord }: { orgId: string; helperWord: string }) {
  const q = usePeople(orgId);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading people…</p>;
  if (!q.data?.success) return <ErrorNotice what="People" onRetry={() => void q.refetch()} />;
  const { people, counts } = q.data;
  return (
    <div className="space-y-3 text-[13px]" data-testid="community-people">
      <p className="font-mono text-muted-foreground">New {counts.new} · Active {counts.active} · Quiet {counts.quiet}</p>
      <ul className="divide-y divide-border rounded-md border border-border" aria-label="Everyone">
        {people.map((p) => <PersonRow key={p.id} orgId={orgId} p={p} helperWord={helperWord} />)}
      </ul>
    </div>
  );
}

function PersonRow({ orgId, p, helperWord }: { orgId: string; p: CommunityPerson; helperWord: string }) {
  const client = useQueryClient();
  const [labels, setLabels] = useState<CommunityLabel[]>(p.labels);
  const toggle = async (l: CommunityLabel, on: boolean) => {
    const before = labels;
    setLabels(on ? [...labels, l] : labels.filter((x) => x !== l));
    const r = await setCommunityLabelAction(orgId, p.id, l, on);
    if (!r.success) { setLabels(before); return void toast.error(r.error); }
    toast.success(on ? `${p.name} is now a ${labelWord(l, helperWord)}` : `${labelWord(l, helperWord)} removed`);
    void client.invalidateQueries({ queryKey: peopleKey(orgId) });
    void client.invalidateQueries({ queryKey: dirKey(orgId) });
  };
  const answers = Object.values(p.answers).filter((a) => a.trim());
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2" data-testid="community-person">
      <span className="min-w-[160px] flex-1"><span className="block font-medium">{p.name}</span>
        <span className="block text-muted-foreground">{[joinedLabel(p.joined), p.hidden ? "Hidden from the directory" : null].filter(Boolean).join(" · ")}</span>
        {answers.length ? <span className="block text-muted-foreground">Join answer: “{answers.join(" · ")}”</span> : null}</span>
      <StatusBadge state={p.status === "quiet" ? "at_risk" : p.status === "new" ? "active" : "neutral"}>{STATUS_WORD[p.status]}</StatusBadge>
      {p.organiser ? <span className="text-muted-foreground">Organiser</span> : (
        <span className="flex flex-wrap gap-3" role="group" aria-label={`Roles for ${p.name}`}>
          {(["moderator", "host", "helper"] as const).map((l) => (
            <label key={l} className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={labels.includes(l)} onChange={(e) => void toggle(l, e.target.checked)} />{labelWord(l, helperWord)}</label>
          ))}
        </span>
      )}
    </li>
  );
}

/** Roles (organisers): who holds each role and label. */
function Roles({ orgId, helperWord }: { orgId: string; helperWord: string }) {
  const q = usePeople(orgId);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading roles…</p>;
  if (!q.data?.success) return <ErrorNotice what="Roles" onRetry={() => void q.refetch()} />;
  const people = q.data.people;
  const groups: Array<[string, CommunityPerson[]]> = [
    ["Organisers", people.filter((p) => p.organiser)],
    ...(["moderator", "host", "helper"] as const).map((l) => [`${labelWord(l, helperWord)}s`, people.filter((p) => p.labels.includes(l))] as [string, CommunityPerson[]]),
  ];
  return (
    <dl className="grid gap-3 text-[13px] sm:grid-cols-2" data-testid="community-roles">
      {groups.map(([name, list]) => (
        <div key={name} className="rounded-md border border-border p-3"><dt className="font-medium">{name} <span className="font-mono text-muted-foreground">{list.length}</span></dt>
          <dd className="mt-1 text-muted-foreground">{list.length ? list.map((p) => p.name).join(", ") : "No one yet. Give a role from People."}</dd></div>
      ))}
    </dl>
  );
}

/** Activity log (organisers): every role change and moderator action, with its rule and who did it. */
function ActivityLog({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["community-log", orgId], queryFn: () => readCommunityLogAction(orgId), staleTime: 15_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the log…</p>;
  if (!q.data?.success) return <ErrorNotice what="Activity log" onRetry={() => void q.refetch()} />;
  const { entries, helperWord } = q.data;
  if (!entries.length) return <p className="py-4 text-[13px] text-muted-foreground">Nothing yet. Role changes and moderator actions show here.</p>;
  const line = (e: (typeof entries)[number]) => {
    const who = e.personName ?? "someone";
    const rule = e.rule ? ` under rule ${e.rule}` : "";
    switch (e.action) {
      case "role_given": return `${e.byName} made ${who} a ${labelWord(e.label!, helperWord)}`;
      case "role_removed": return `${e.byName} removed ${who} as ${labelWord(e.label!, helperWord)}`;
      case "hidden": return `${e.byName} hid a post by ${who}${rule} (report ${e.caseLabel})`;
      case "paused": return `${e.byName} paused ${who}’s posting${rule} until ${fullDate(e.until!)} (report ${e.caseLabel})`;
      case "passed": return `${e.byName} passed report ${e.caseLabel} to organisers${rule}`;
    }
  };
  return (
    <ol className="space-y-1.5 text-[13px]" data-testid="community-log">
      {entries.map((e, i) => <li key={`${e.at}-${i}`}><span className="font-mono text-muted-foreground">{fullDate(e.at)}</span> · {line(e)}</li>)}
    </ol>
  );
}

/** Moderation (moderators and organisers): one report at a time — Hide, Pause posting or Pass to organisers, with a rule. */
function Moderation({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["community-moderation", orgId], queryFn: () => readCommunityModerationAction(orgId), staleTime: 15_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading reports…</p>;
  if (!q.data?.success) return <ErrorNotice what="Reports" onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-3 text-[13px]" data-testid="community-moderation">
      {d.organiser ? <p className="text-muted-foreground">Removing and blocking are in Settings, under Moderation.</p> : null}
      {!d.rules.length ? <p className="text-muted-foreground">Publish a Code of conduct with numbered rules to moderate with a rule.</p> : null}
      {d.cases.length ? <ul className="space-y-3" aria-label="Reports">{d.cases.map((c) => <ReportRow key={c.id} orgId={orgId} c={c} rules={d.rules} pauseHours={d.pauseHours} onDone={() => void q.refetch()} />)}</ul>
        : <p className="py-4 text-muted-foreground">No open reports.</p>}
    </div>
  );
}

type Case = { id: string; number: number; label: string | null; href: string | null; reports: number; content: string | null; details: string | null };
function ReportRow({ orgId, c, rules, pauseHours, onDone }: { orgId: string; c: Case; rules: Array<{ n: number; text: string }>; pauseHours: number[]; onDone: () => void }) {
  const [rule, setRule] = useState(rules[0]?.n ?? 0);
  const [hours, setHours] = useState(pauseHours[0] ?? 24);
  const [busy, setBusy] = useState(false);
  const act = async (choice: "hide" | "pause" | "pass") => {
    setBusy(true);
    const r = await moderateCommunityReportAction(orgId, c.id, choice === "pause" ? { choice, rule, hours } : { choice, rule });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(choice === "hide" ? "Hidden" : choice === "pause" ? "Posting paused" : "Passed to organisers");
    onDone();
  };
  return (
    <li className="space-y-2 rounded-md border border-border p-3" data-testid="community-report">
      <p><span className="font-mono">#{c.number}</span> · {c.label ?? "Reported content"} · <span className="font-mono">{c.reports}</span> {c.reports === 1 ? "report" : "reports"}</p>
      {c.content ? <p className="rounded-sm bg-muted px-2 py-1.5">{c.content}</p> : null}
      {c.details ? <p className="text-muted-foreground">Reporters said: {c.details}</p> : null}
      <span className="flex flex-wrap items-center gap-2">
        <select className="nb-select" data-size="sm" aria-label="Rule broken" value={rule} onChange={(e) => setRule(Number(e.target.value))} disabled={!rules.length}>
          {rules.map((r) => <option key={r.n} value={r.n}>{r.n}. {r.text.slice(0, 60)}</option>)}
        </select>
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy || !rules.length} onClick={() => void act("hide")}>Hide</button>
        <select className="nb-select" data-size="sm" aria-label="Pause length" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {pauseHours.map((h) => <option key={h} value={h}>{h === 24 ? "24 hours" : "7 days"}</option>)}
        </select>
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy || !rules.length} onClick={() => void act("pause")}>Pause posting</button>
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy || !rules.length} onClick={() => void act("pass")}>Pass to organisers</button>
      </span>
    </li>
  );
}

/** Settings → Members (organisers): Quiet after, the Helper label's wording, how long Pause posting can last. */
export function CommunityMembersSettings({ orgId }: { orgId: string }) {
  const q = usePeople(orgId);
  if (q.isPending || !q.data?.success) return null;
  return <MembersSettingsForm orgId={orgId} initial={q.data.settings} />;
}

function MembersSettingsForm({ orgId, initial }: { orgId: string; initial: { quietDays: number; helperWord: string; pauseHours: number[] } }) {
  const client = useQueryClient();
  const [f, setF] = useState(initial);
  const save = async () => {
    const r = await saveCommunityMembersSettingsAction(orgId, f);
    if (!r.success) return void toast.error(r.error);
    toast.success("Members settings saved");
    void client.invalidateQueries({ queryKey: peopleKey(orgId) });
    void client.invalidateQueries({ queryKey: dirKey(orgId) });
  };
  const pause = (h: number, on: boolean) => setF({ ...f, pauseHours: on ? [...new Set([...f.pauseHours, h])].sort((a, b) => a - b) : f.pauseHours.filter((x) => x !== h) });
  return (
    <SettingsCard title="Members" headingLevel={2} description="The Directory, Quiet members and moderators’ pauses. Status is for organisers only.">
      <div className="space-y-3 text-[13px]" data-testid="community-members-settings">
        <label className="flex flex-wrap items-center gap-2">Quiet after
          <Input type="number" min={14} max={365} value={f.quietDays} onChange={(e) => setF({ ...f, quietDays: Number(e.target.value) })} className="w-[90px] font-mono" aria-label="Quiet after (days)" />
          days without posting or commenting. Quiet members are never removed.</label>
        <label className="flex flex-wrap items-center gap-2">The Helper label reads
          <Input value={f.helperWord} maxLength={30} onChange={(e) => setF({ ...f, helperWord: e.target.value })} className="w-[200px]" aria-label="Helper label" /></label>
        <fieldset className="flex flex-wrap items-center gap-3"><legend className="mb-1">Moderators can pause posting for</legend>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={f.pauseHours.includes(24)} onChange={(e) => pause(24, e.target.checked)} />24 hours</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={f.pauseHours.includes(168)} onChange={(e) => pause(168, e.target.checked)} />7 days</label>
        </fieldset>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save members settings</button>
      </div>
    </SettingsCard>
  );
}
