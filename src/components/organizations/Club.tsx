"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Printer } from "lucide-react";

import { answerRenewalAction, endNotRenewedAction, readDriveCountsAction, readRecruitingAction, readRenewalAction, saveRecruitingAction, saveRenewalAction } from "@/app/actions/club";
import { moveWorkAction, readHandoverAction, saveHandoverAction, tickHandoverAction } from "@/app/actions/club-handover";
import { answerNominationAction, closeVotingAction, nominateAction, openVotingAction, readElectionAction, startElectionAction, voteAction } from "@/app/actions/club-elections";
import { answerAppointmentAction, appointAction, endTermAction, readCommitteeAction, savePositionsAction } from "@/app/actions/club-positions";
import { readCommunityEventsAction } from "@/app/actions/community-events";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { DEFAULT_ASK, HANDOVER_ITEMS, RENEWAL_WORDS, type ClubPosition, type RenewalState } from "@/lib/organizations/club";

// Report 36.2 (plan B7.1a, L1): Recruiting now on a club's About, the officers' Recruiting card (dates, line, first event,
// the drive's counts) and the printable join poster (the short link and the code; no QR code).
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const key = (orgId: string) => ["club-recruiting", orgId] as const;
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** About (everyone): the Recruiting now banner while the period lasts. */
export function RecruitingBanner({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readRecruitingAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d?.recruiting) return null;
  return (
    <section aria-label="Recruiting now" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="club-recruiting-banner">
      <Megaphone className="size-4" aria-hidden="true" /><span className="font-medium">Recruiting now</span>
      <span className="text-muted-foreground">until {day(d.to!)}</span>
      {d.line ? <span>{d.line}</span> : null}
      {d.firstEvent ? <span className="text-muted-foreground">First event: {d.firstEvent.title}</span> : null}
    </section>
  );
}

/** Officers (Overview): set the recruiting period, print the poster, see the drive's counts. */
export function RecruitingCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readRecruitingAction(orgId), staleTime: 60_000 });
  const counts = useQuery({ queryKey: ["club-drive", orgId], queryFn: () => readDriveCountsAction(orgId), staleTime: 60_000 });
  const events = useQuery({ queryKey: ["club-events", orgId], queryFn: () => readCommunityEventsAction(orgId, "upcoming"), staleTime: 60_000 });
  const [f, setF] = useState<{ from: string; to: string; line: string; firstEventId: string | null } | null>(null);
  const [printing, setPrinting] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d?.poster) return null;
  const form = f ?? { from: d.settings?.from ?? "", to: d.settings?.to ?? "", line: d.settings?.line ?? "", firstEventId: d.settings?.firstEventId ?? null };
  const c = counts.data?.success ? counts.data.counts : null;
  const save = async (value: typeof form | null) => {
    const r = await safe(saveRecruitingAction(orgId, value));
    if (!r.success) return void toast.error(r.error);
    toast.success(value ? "Recruiting saved" : "Recruiting cleared");
    setF(null); void q.refetch(); void counts.refetch();
  };
  const print = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 50); };
  const upcoming = events.data?.success ? events.data.events.filter((e) => e.state !== "cancelled" && e.state !== "ended") : [];
  return (
    <OrgCard title="Recruiting" testId="club-recruiting" action={<button type="button" className={`${FORM_SECONDARY_CLASS} inline-flex items-center gap-1.5`} onClick={print}><Printer className="size-3.5" aria-hidden="true" />Print the join poster</button>}>
      <div className="space-y-2 text-[13px]">
        <p>{d.recruiting ? <><span className="font-medium">Recruiting now</span> until {day(d.to!)}.</> : d.settings ? "Not recruiting right now." : "Set the dates of your recruiting drive. It turns itself off after the end date."}</p>
        <span className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col">From<Input type="date" value={form.from} onChange={(e) => setF({ ...form, from: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">To<Input type="date" value={form.to} onChange={(e) => setF({ ...form, to: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex min-w-[220px] flex-1 flex-col">Banner line<Input value={form.line} maxLength={160} onChange={(e) => setF({ ...form, line: e.target.value })} placeholder="Taster night Thursday: no experience needed" className="mt-0.5" /></label>
          <label className="flex flex-col">First event<select className="nb-select mt-0.5" value={form.firstEventId ?? ""} onChange={(e) => setF({ ...form, firstEventId: e.target.value || null })}>
            <option value="">None</option>{upcoming.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
        </span>
        <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!form.from || !form.to} onClick={() => void save(form)}>Save</button>
          {d.settings ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save(null)}>Clear</button> : null}</span>
        {c ? <p data-testid="club-drive-counts">During the drive ({day(c.from)} to {day(c.to)}): {c.joined} joined, {c.came} of them came to an event.</p> : null}
      </div>
      {printing && typeof document !== "undefined" ? createPortal(<JoinPoster title={d.poster.title} line={d.settings?.line ?? ""} slug={d.poster.slug} code={d.poster.code} />, document.body) : null}
    </OrgCard>
  );
}

/** Call 4: a printable page — the club's name, one line, the short join link and the code, large and high-contrast. */
function JoinPoster({ title, line, slug, code }: { title: string; line: string; slug: string; code: string | null }) {
  const link = `networkbase.in/org/${slug}`;
  return (
    <div id="nb-join-poster" data-testid="club-join-poster">
      <style>{`#nb-join-poster{display:none}@media print{body>*:not(#nb-join-poster){display:none!important}#nb-join-poster{display:flex!important;flex-direction:column;justify-content:center;gap:28pt;min-height:100vh;padding:48pt;background:white;color:black;font-family:inherit}}`}</style>
      <p style={{ fontSize: "44pt", fontWeight: 700, lineHeight: 1.1 }}>{title}</p>
      {line ? <p style={{ fontSize: "22pt" }}>{line}</p> : null}
      <p style={{ fontSize: "20pt" }}>Join at <strong>{link}</strong></p>
      {code ? <p style={{ fontSize: "20pt" }}>or with the join code <strong style={{ fontFamily: "monospace", letterSpacing: "2pt" }}>{code}</strong></p> : null}
    </div>
  );
}

/**
 * Season renewal (call 6, B7.1b): a member's one card (Staying · Leaving); officers start it, see the answers (only they
 * do) and, once the window has closed, end the memberships not renewed — never an officer, recorded as Season ended.
 */
export function RenewalCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["club-renewal", orgId], queryFn: () => readRenewalAction(orgId), staleTime: 60_000 });
  const [setup, setSetup] = useState<{ season: string; ask: string; days: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  if (!d.on) return d.officer ? (
    <OrgCard title="Season renewal" testId="club-renewal">
      {setup ? <RenewalSetup value={setup} onChange={setSetup} onSave={() => void run(saveRenewalAction(orgId, { on: true, ...setup }), "Members are asked once").then(() => setSetup(null))} onCancel={() => setSetup(null)} />
        : <><p className="text-[13px] text-muted-foreground">At a new Season, ask members once whether they’re staying. Nobody is removed on their own.</p>
          <button type="button" className={`${FORM_SECONDARY_CLASS} mt-2`} onClick={() => setSetup({ season: new Date().toISOString().slice(0, 10), ask: DEFAULT_ASK, days: 30 })}>Start Season renewal</button></>}
    </OrgCard>) : null;
  const counts = (s: RenewalState) => d.people.filter((p) => p.state === s).length;
  const toEnd = d.people.filter((p) => !p.officer && (p.state === "leaving" || p.state === "not_answered"));
  return (
    <OrgCard title="Season renewal" testId="club-renewal" action={d.officer ? <button type="button" className="nb-link text-[13px]" onClick={() => void run(saveRenewalAction(orgId, { on: false, season: d.season, ask: d.ask, days: d.days }), "Season renewal stopped")}>Stop</button> : null}>
      <div className="space-y-2 text-[13px]">
        {d.mine === "not_answered" || d.mine === "staying" || d.mine === "leaving" ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="club-renewal-ask"><span className="font-medium">{d.ask}</span>
            {(["staying", "leaving"] as const).map((a) => <button key={a} type="button" aria-pressed={d.mine === a} className="nb-tag h-8 px-3" onClick={() => void run(answerRenewalAction(orgId, a), a === "staying" ? "Thanks, you’re staying" : "Noted. Nothing changes until you leave or officers end it.")}>{RENEWAL_WORDS[a]}</button>)}
          </div>) : null}
        {d.officer ? <>
          <p data-testid="club-renewal-counts">Season from {day(d.season)}: {counts("staying")} Staying, {counts("not_answered")} Not answered, {counts("leaving")} Leaving{counts("not_asked") ? `, ${counts("not_asked")} joined this Season` : ""}.</p>
          <details><summary className="cursor-pointer text-muted-foreground">Answers (only officers see them)</summary>
            <ul className="mt-1 space-y-0.5">{d.people.map((p) => <li key={p.id}>{p.name}: {RENEWAL_WORDS[p.state]}{p.officer ? " (officer)" : ""}</li>)}</ul></details>
          {d.closed ? (toEnd.length ? (confirm
            ? <span className="flex flex-wrap items-center gap-2"><span>End {toEnd.length} {toEnd.length === 1 ? "membership" : "memberships"} as Season ended? Officers are never included.</span>
              <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(endNotRenewedAction(orgId), "Memberships ended: Season ended").then(() => setConfirm(false))}>End {toEnd.length}</button>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setConfirm(false)}>Cancel</button></span>
            : <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setConfirm(true)}>End memberships not renewed</button>) : <p className="text-muted-foreground">Everyone asked is staying.</p>)
            : <p className="text-muted-foreground">Answers close {d.days} days after the Season’s start; then you can end the memberships not renewed.</p>}
        </> : null}
      </div>
    </OrgCard>
  );
}

function RenewalSetup({ value, onChange, onSave, onCancel }: { value: { season: string; ask: string; days: number }; onChange: (v: { season: string; ask: string; days: number }) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <fieldset className="flex flex-wrap items-end gap-2 text-[13px]" data-testid="club-renewal-setup">
      <label className="flex flex-col">Season starts<Input type="date" value={value.season} onChange={(e) => onChange({ ...value, season: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
      <label className="flex min-w-[200px] flex-1 flex-col">The ask<Input value={value.ask} maxLength={120} onChange={(e) => onChange({ ...value, ask: e.target.value })} className="mt-0.5" /></label>
      <label className="flex flex-col">Days to answer<Input type="number" min={7} max={90} value={value.days} onChange={(e) => onChange({ ...value, days: Number(e.target.value) })} className="mt-0.5 w-[90px] font-mono" /></label>
      <button type="button" className={FORM_PRIMARY_CLASS} disabled={!value.season || !value.ask.trim()} onClick={onSave}>Ask members</button>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={onCancel}>Cancel</button>
    </fieldset>
  );
}

const GIVES_WORDS = { president: "President (owner)", coordinator: "Coordinator", none: "No role" } as const;

/**
 * This Season's committee (B7.2a, 36.3): positions with their holders — on About for everyone, on Overview with the
 * President's appoint, the holder's accept, role pages and past Seasons. Positions are labels; the role comes with holding.
 */
export function CommitteeCard({ orgId, about = false }: { orgId: string; about?: boolean }) {
  const q = useQuery({ queryKey: ["club-committee", orgId], queryFn: () => readCommitteeAction(orgId), staleTime: 60_000 });
  const [editing, setEditing] = useState(false);
  const [appoint, setAppoint] = useState<Record<string, string>>({});
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  const held = d.positions.filter((p) => p.holder?.state === "holding");
  if (about) return held.length ? (
    <section aria-label="This Season's committee" className="space-y-2 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="club-committee-strip">
      <h3 className="font-medium">This Season’s committee <span className="font-normal text-muted-foreground">{d.season}</span></h3>
      <ul className="flex flex-wrap gap-3">{held.map((p) => (
        <li key={p.id} className="flex items-center gap-2"><UserAvatar identity={{ fullName: p.holder!.name, avatarUrl: p.holder!.avatar }} size={24} roundedClassName="rounded-md" />
          <span><span className="block font-medium">{p.holder!.name}</span><span className="text-muted-foreground">{p.label}</span></span></li>))}</ul>
    </section>) : null;
  if (editing) return <OrgCard title="Positions" testId="club-positions"><PositionsEditor season={d.season} positions={d.positions} docs={d.docs}
    onSave={(v) => void run(savePositionsAction(orgId, v), "Positions saved").then(() => setEditing(false))} onCancel={() => setEditing(false)} /></OrgCard>;
  return (
    <OrgCard title={`This Season’s committee · ${d.season}`} testId="club-committee" action={d.president ? <button type="button" className="nb-link text-[13px]" onClick={() => setEditing(true)}>Positions</button> : null}>
      <div className="space-y-2 text-[13px]">
        <ul className="divide-y divide-border rounded-md border border-border">{d.positions.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="club-position">
            <span className="min-w-[140px] font-medium">{p.label}</span>
            {p.holder ? <span className="flex items-center gap-1.5"><UserAvatar identity={{ fullName: p.holder.name, avatarUrl: p.holder.avatar }} size={20} roundedClassName="rounded-md" />{p.holder.name}</span>
              : <span className="text-muted-foreground">Not filled</span>}
            {p.holder?.state === "offered" ? <StatusBadge state="draft">Asked</StatusBadge> : null}
            <span className="text-muted-foreground">{p.filled === "election" ? "Elected" : "Appointed"}</span>
            {p.docSlug ? <a className="nb-link" href={`?tab=docs&doc=${encodeURIComponent(p.docSlug)}`}>Role page<span className="sr-only"> for {p.label}</span></a> : null}
            {p.holder?.state === "offered" && p.holder.userId === d.me ? <>
              <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(answerAppointmentAction(orgId, p.holder!.termId, true), `You're ${p.label} this Season`)}>Accept</button>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(answerAppointmentAction(orgId, p.holder!.termId, false), "Declined")}>Decline</button></> : null}
            {p.holder && (d.president || p.holder.userId === d.me) && p.holder.state === "holding" ? <button type="button" className="nb-link" onClick={() => void run(endTermAction(orgId, p.holder!.termId), "Term ended")}>{p.holder.userId === d.me ? "Step down" : "End term"}<span className="sr-only"> {p.label}</span></button> : null}
            {!p.holder && d.president && p.gives !== "president" ? <span className="flex items-center gap-1.5">
              <select className="nb-select" aria-label={`Appoint ${p.label}`} value={appoint[p.id] ?? ""} onChange={(e) => setAppoint({ ...appoint, [p.id]: e.target.value })}>
                <option value="">Appoint…</option>{d.people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={!appoint[p.id]} onClick={() => void run(appointAction(orgId, p.id, appoint[p.id]!), "Asked; they accept to take it")}>Ask</button></span> : null}
            {!p.holder && d.president && p.gives === "president" ? <span className="text-muted-foreground">Moves through Transfer ownership</span> : null}
          </li>))}</ul>
        {d.history.length ? <details><summary className="cursor-pointer text-muted-foreground">Past Seasons</summary>
          <ul className="mt-1 space-y-0.5">{d.history.map((h, i) => <li key={i}><span className="font-mono">{h.season}</span> · {h.position}: {h.name}</li>)}</ul></details> : null}
      </div>
    </OrgCard>
  );
}

function PositionsEditor({ season, positions, docs, onSave, onCancel }: { season: string; positions: ClubPosition[]; docs: Array<{ id: string; name: string }>;
  onSave: (v: { season: string; positions: ClubPosition[] }) => void; onCancel: () => void }) {
  const [s, setS] = useState(season);
  const [list, setList] = useState<ClubPosition[]>(positions.map(({ id, label, filled, gives, docId }) => ({ id, label, filled, gives, docId })));
  const set = (i: number, patch: Partial<ClubPosition>) => setList(list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <fieldset className="space-y-2 text-[13px]" data-testid="club-positions-editor">
      <label className="flex flex-col">Season<Input value={s} maxLength={20} onChange={(e) => setS(e.target.value)} className="mt-0.5 w-[140px] font-mono" /></label>
      {list.map((p, i) => (
        <span key={p.id} className="flex flex-wrap items-center gap-2">
          <Input value={p.label} maxLength={60} onChange={(e) => set(i, { label: e.target.value })} aria-label={`Position ${i + 1}`} className="w-[180px]" />
          <select className="nb-select" aria-label={`How ${p.label} is filled`} value={p.filled} onChange={(e) => set(i, { filled: e.target.value as ClubPosition["filled"] })}>
            <option value="election">Election</option><option value="appointment">Appointment</option></select>
          <select className="nb-select" aria-label={`Role ${p.label} gives`} value={p.gives} disabled={p.gives === "president"} onChange={(e) => set(i, { gives: e.target.value as ClubPosition["gives"] })}>
            {(p.gives === "president" ? (["president"] as const) : (["coordinator", "none"] as const)).map((g) => <option key={g} value={g}>{GIVES_WORDS[g]}</option>)}</select>
          <select className="nb-select" aria-label={`Role page for ${p.label}`} value={p.docId ?? ""} onChange={(e) => set(i, { docId: e.target.value || null })}>
            <option value="">No role page</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          {p.gives !== "president" ? <button type="button" className="nb-link" onClick={() => setList(list.filter((_, j) => j !== i))}>Remove<span className="sr-only"> {p.label}</span></button> : null}
        </span>))}
      {list.length < 15 ? <button type="button" className="nb-link" onClick={() => setList([...list, { id: `pos-${Date.now().toString(36).slice(-6)}`, label: "", filled: "appointment", gives: "coordinator", docId: null }])}>Add a position</button> : null}
      <p className="text-muted-foreground">Positions are labels with a Season term; holding one gives its role. Role pages list accounts by name only, never passwords.</p>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!s.trim() || list.some((p) => !p.label.trim())} onClick={() => onSave({ season: s, positions: list })}>Save</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onCancel}>Cancel</button></span>
    </fieldset>
  );
}

const PHASE_WORDS = { nominations: "Nominations", voting: "Voting", results: "Results" } as const;

/**
 * Elections (B7.2b, 36.3 calls 4–7): nominations (the nominee accepts with a statement), a secret ballot per position
 * (Abstain allowed; "You voted", never the choice), turnout as a count, the returning officer's Open and Close, run-offs,
 * results (winner; counts only if the club chose to show them).
 */
export function ElectionCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["club-election", orgId], queryFn: () => readElectionAction(orgId), staleTime: 30_000 });
  const [start, setStart] = useState<{ season: string; returningOfficerId: string; showCounts: boolean } | null>(null);
  const [nominate, setNominate] = useState<Record<string, string>>({});
  const [statement, setStatement] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  const e = d.election;
  if (!e || (e.phase === "results" && start)) {
    if (!d.president) return null;
    return (
      <OrgCard title="Elections" testId="club-election">
        {start ? <fieldset className="flex flex-wrap items-end gap-2 text-[13px]" data-testid="club-election-start">
          <label className="flex flex-col">For the Season<Input value={start.season} maxLength={20} onChange={(x) => setStart({ ...start, season: x.target.value })} className="mt-0.5 w-[120px] font-mono" /></label>
          <label className="flex flex-col">Returning officer<select className="nb-select mt-0.5" value={start.returningOfficerId} onChange={(x) => setStart({ ...start, returningOfficerId: x.target.value })}>
            <option value="">Pick someone not standing</option>{(("people" in d && d.people) || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" className="nb-check" checked={start.showCounts} onChange={(x) => setStart({ ...start, showCounts: x.target.checked })} />Show vote counts with the results</label>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!start.season.trim() || !start.returningOfficerId} onClick={() => void run(startElectionAction(orgId, start), "Nominations are open").then(() => setStart(null))}>Open nominations</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setStart(null)}>Cancel</button>
        </fieldset> : <span className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-muted-foreground">Elected positions are filled by a secret ballot run by a returning officer.</span>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setStart({ season: "", returningOfficerId: "", showCounts: false })}>Start an election</button></span>}
      </OrgCard>
    );
  }
  const people = "people" in d ? d.people : [];
  return (
    <OrgCard title={`Election · ${e.season}`} testId="club-election" action={<StatusBadge state={e.phase === "results" ? "done" : "active"}>{PHASE_WORDS[e.phase]}</StatusBadge>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted-foreground">Returning officer: {e.ro?.name ?? "none"}. Ballots are secret: nobody, the returning officer included, can see who voted for whom.</p>
        {e.isRo && e.phase === "nominations" ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(openVotingAction(orgId), "Voting is open")}>Open voting</button> : null}
        {e.isRo && e.phase === "voting" ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(closeVotingAction(orgId), "Counted")}>Close voting and count</button> : null}
        {e.phase === "results" && d.president ? <button type="button" className="nb-link" onClick={() => setStart({ season: "", returningOfficerId: "", showCounts: false })}>Start another election</button> : null}
        <ul className="space-y-2">{("positions" in d ? d.positions : []).map((p) => (
          <li key={p.id} className="space-y-1.5 rounded-md border border-border p-3" data-testid="club-election-position">
            <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.label}</span>{p.runoff ? <StatusBadge state="at_risk">Run-off, round {p.round}</StatusBadge> : null}
              {e.phase !== "nominations" ? <span className="text-muted-foreground">{p.turnout} of {"eligible" in d ? d.eligible : 0} voted</span> : null}</p>
            {p.candidates.length ? <ul className="space-y-1">{p.candidates.map((c) => <li key={c.id}><span className="font-medium">{c.name}</span>{c.statement ? <span className="block whitespace-pre-wrap text-muted-foreground">{c.statement}</span> : null}</li>)}</ul>
              : <p className="text-muted-foreground">No candidates yet.</p>}
            {p.pending.length ? <p className="text-muted-foreground">Waiting to accept: {p.pending.map((x) => x.name).join(", ")}</p> : null}
            {e.phase === "nominations" && (p.mine === "nominated" || p.mine === "standing") ? <span className="flex flex-col gap-1.5" data-testid="club-nomination-answer">
              <textarea className="nb-textarea text-[13px]" rows={2} maxLength={2000} aria-label={`Your statement for ${p.label}`} placeholder="Your statement" value={statement[p.id] ?? p.candidates.find((c) => c.id === ("me" in d ? d.me : ""))?.statement ?? ""} onChange={(x) => setStatement({ ...statement, [p.id]: x.target.value })} />
              <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(answerNominationAction(orgId, p.id, { stand: true, statement: statement[p.id] ?? "" }), "You're standing")}>{p.mine === "standing" ? "Update statement" : "Accept and stand"}</button>
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(answerNominationAction(orgId, p.id, { stand: false, statement: "" }), p.mine === "standing" ? "Withdrawn" : "Declined")}>{p.mine === "standing" ? "Withdraw" : "Decline"}</button></span></span> : null}
            {e.phase === "nominations" ? <span className="flex flex-wrap items-center gap-2">
              <select className="nb-select" aria-label={`Nominate for ${p.label}`} value={nominate[p.id] ?? ""} onChange={(x) => setNominate({ ...nominate, [p.id]: x.target.value })}>
                <option value="">Nominate…</option>{people.filter((m) => m.id !== e.ro?.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={!nominate[p.id]} onClick={() => void run(nominateAction(orgId, p.id, nominate[p.id]!), "Nominated; they accept to stand")}>Nominate</button></span> : null}
            {e.phase === "voting" && !p.result && p.candidates.length ? (p.voted ? <p className="font-medium" data-testid="club-voted">You voted</p> : (
              <fieldset className="space-y-1" data-testid="club-ballot"><legend className="sr-only">Ballot for {p.label}</legend>
                {p.candidates.map((c) => <label key={c.id} className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name={`ballot-${p.id}`} checked={pick[p.id] === c.id} onChange={() => setPick({ ...pick, [p.id]: c.id })} />{c.name}</label>)}
                <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name={`ballot-${p.id}`} checked={pick[p.id] === "abstain"} onChange={() => setPick({ ...pick, [p.id]: "abstain" })} />Abstain</label>
                <button type="button" className={FORM_PRIMARY_CLASS} disabled={!pick[p.id]} onClick={() => void run(voteAction(orgId, p.id, pick[p.id] === "abstain" ? null : pick[p.id]!), "You voted")}>Submit</button>
              </fieldset>)) : null}
            {p.result ? <p data-testid="club-result">{p.result.winner ? <><span className="font-medium">{p.result.winner.name}</span> elected</> : "No one elected"}
              {p.result.counts ? <span className="block text-muted-foreground">{p.result.counts.map((c) => `${c.name} ${c.n}`).join(" · ")}</span> : null}</p> : null}
          </li>))}</ul>
      </div>
    </OrgCard>
  );
}

/**
 * The handover (B7.2c, 36.3 call 10): the President sets the incoming Season and the date; each outgoing officer ticks
 * five items, moves their open work to the incoming officer, and on the date roles switch. Seen by the people in it.
 */
export function HandoverCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["club-handover", orgId], queryFn: () => readHandoverAction(orgId), staleTime: 60_000 });
  const [form, setForm] = useState<{ season: string; date: string } | null>(null);
  const [appoint, setAppoint] = useState<Record<string, string>>({});
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.handover && !d.president)) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  const h = d.handover;
  const setup = form ? <fieldset className="flex flex-wrap items-end gap-2 text-[13px]" data-testid="club-handover-setup">
    <label className="flex flex-col">Incoming Season<Input value={form.season} maxLength={20} onChange={(x) => setForm({ ...form, season: x.target.value })} className="mt-0.5 w-[120px] font-mono" /></label>
    <label className="flex flex-col">Handover date<Input type="date" value={form.date} onChange={(x) => setForm({ ...form, date: x.target.value })} className="mt-0.5 w-auto font-mono" /></label>
    <button type="button" className={FORM_PRIMARY_CLASS} disabled={!form.season.trim() || !form.date} onClick={() => void run(saveHandoverAction(orgId, form), "Handover set").then(() => setForm(null))}>Save</button>
    <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setForm(null)}>Cancel</button>
  </fieldset> : null;
  if (!h || !("rows" in d)) return (
    <OrgCard title="Handover" testId="club-handover">
      {setup ?? <span className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-muted-foreground">{d.last ? `Roles switched to ${d.last}. ` : ""}Set the incoming Season and the date its officers take over.</span>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setForm({ season: "", date: "" })}>Set the handover</button></span>}
    </OrgCard>
  );
  const rows = d.rows.filter((r) => r.outgoing || r.incoming);
  const withOut = rows.filter((r) => r.outgoing);
  const status = withOut.length && withOut.every((r) => r.done === HANDOVER_ITEMS.length) ? "Done" : withOut.some((r) => r.done > 0) ? "In progress" : "Not started";
  return (
    <OrgCard title={`Handover · ${h.season}`} testId="club-handover" action={<StatusBadge state={status === "Done" ? "done" : status === "In progress" ? "active" : "draft"}>{status}</StatusBadge>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted-foreground">Roles switch on {day(h.date)}. {h.open ? "Outgoing officers stay members." : "The checklist opens three weeks before."}
          {d.president && !form ? <> <button type="button" className="nb-link" onClick={() => setForm({ season: h.season, date: h.date })}>Change</button></> : null}</p>
        {setup}
        <ul className="space-y-2">{d.rows.map((r) => (
          <li key={r.id} className="space-y-1.5 rounded-md border border-border p-3" data-testid="club-handover-position">
            <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.label}</span>
              <span className="text-muted-foreground">Outgoing: {r.outgoing?.name ?? "none"} · Incoming: {r.incoming ? `${r.incoming.name}${r.incoming.state === "offered" ? " (asked)" : ""}` : "none"}</span>
              {r.outgoing ? <span className="text-muted-foreground">{r.done} of {HANDOVER_ITEMS.length}</span> : null}</p>
            {r.president && r.incoming && r.incoming.userId !== r.outgoing?.userId ? <p className="text-muted-foreground">The presidency moves when you transfer ownership in Settings to {r.incoming.name}.</p> : null}
            {!r.incoming && d.president && !r.president ? <span className="flex flex-wrap items-center gap-1.5">
              <select className="nb-select" aria-label={`Appoint ${r.label} for ${h.season}`} value={appoint[r.id] ?? ""} onChange={(e) => setAppoint({ ...appoint, [r.id]: e.target.value })}>
                <option value="">Appoint…</option>{d.people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={!appoint[r.id]} onClick={() => void run(appointAction(orgId, r.id, appoint[r.id]!, h.season), "Asked; they accept to take it")}>Ask</button></span> : null}
            {r.outgoing && h.open ? <ul className="space-y-1" aria-label={`${r.label} handover checklist`}>{HANDOVER_ITEMS.map((i) => {
              const ticked = Boolean(r.ticks[i.id]);
              const moving = i.id === "tasks" || i.id === "docs";
              return <li key={i.id} className="flex flex-wrap items-center gap-1.5">
                <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={ticked} disabled={!r.canTick || moving}
                  onChange={(e) => void run(tickHandoverAction(orgId, r.outgoing!.termId, i.id, e.target.checked), "Saved")} />{i.label}</label>
                {i.id === "meeting" && !ticked ? <span className="text-muted-foreground">Add a Handover meeting in Documents</span> : null}
                {i.id === "accounts" && !ticked ? <span className="text-muted-foreground">On the role page, by name; never passwords</span> : null}
              </li>;
            })}</ul> : null}
            {r.outgoing && h.open && r.canTick && !(r.ticks.tasks && r.ticks.docs) && r.incoming?.state === "holding" && r.incoming.userId !== r.outgoing.userId ?
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(moveWorkAction(orgId, r.outgoing!.termId), `Moved to ${r.incoming!.name}`)}>
                Move {count(r.work.tasks, "open task")} and {count(r.work.docs, "document")} to {r.incoming.name}</button> : null}
          </li>))}</ul>
      </div>
    </OrgCard>
  );
}

