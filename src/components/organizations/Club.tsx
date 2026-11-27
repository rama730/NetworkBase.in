"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Printer, Trophy } from "lucide-react";

import { answerRenewalAction, endNotRenewedAction, readDriveCountsAction, readRecruitingAction, readRenewalAction, saveRecruitingAction, saveRenewalAction } from "@/app/actions/club";
import { moveWorkAction, readHandoverAction, saveHandoverAction, tickHandoverAction } from "@/app/actions/club-handover";
import { answerPlaceAction, decidePlaceAction, makeTeamAction, offerPlaceAction, readCompetitionsAction, readPickingAction, saveCompetitionAction, setCompetitionStageAction, signUpAction } from "@/app/actions/club-competitions";
import { readConstitutionAction, readDecisionsAction, setConstitutionPublicAction, writeConstitutionAction } from "@/app/actions/club-constitution";
import { castMotionVoteAction, readMotionVotesAction } from "@/app/actions/club-motion-votes";
import { decideAgendaItemAction, proposeAgendaItemAction, readClubMeetingAction, saveClubMeetingsAction } from "@/app/actions/club-meetings";
import { answerNominationAction, closeVotingAction, nominateAction, openVotingAction, readElectionAction, startElectionAction, voteAction } from "@/app/actions/club-elections";
import { answerAppointmentAction, appointAction, endTermAction, readCommitteeAction, savePositionsAction } from "@/app/actions/club-positions";
import { readCommunityEventsAction } from "@/app/actions/community-events";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { daysLeft, DEFAULT_ASK, HANDOVER_ITEMS, PICKING, PICKING_WORDS, RENEWAL_WORDS, STARTER_ARTICLES, type Competition, type Article, type ClubMeetings, type ClubPosition, type RenewalState } from "@/lib/organizations/club";

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

const AGENDA_WORDS = { proposed: "Proposed", accepted: "Accepted", held: "Held" } as const;
const NewMeetingDialog = dynamic(() => import("@/components/workspaces/doc/DocMeeting").then((m) => m.NewMeetingDialog), { ssr: false });
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * The next general meeting (B7.3a, 36.4 calls 1–2, 5): when it is, the quorum it needs, and Add to the agenda until the
 * deadline; officers accept or hold each item. The meeting's document stays with officers until its minutes are approved.
 */
export function ClubMeetingCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["club-meeting", orgId], queryFn: () => readClubMeetingAction(orgId), staleTime: 60_000 });
  const [item, setItem] = useState("");
  const [setup, setSetup] = useState<ClubMeetings | null>(null);
  const [planning, setPlanning] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  const m = d.meeting;
  if (!m && !d.officer) return null;
  return (
    <OrgCard title={m ? (m.kind === "agm" ? "Next annual general meeting" : "Next general meeting") : "General meetings"} testId="club-meeting"
      action={d.president && !setup ? <button type="button" className="nb-link text-[13px]" onClick={() => setSetup(d.settings)}>Meeting settings</button> : null}>
      <div className="space-y-2 text-[13px]">
        {setup ? <fieldset className="flex flex-wrap items-end gap-2" data-testid="club-meeting-settings">
          <label className="flex flex-col">Agenda closes (days before)<Input type="number" min={0} max={14} value={setup.agendaDays} onChange={(e) => setSetup({ ...setup, agendaDays: Number(e.target.value) })} className="mt-0.5 w-[90px] font-mono" /></label>
          <label className="flex flex-col">Quorum (% of members staying)<Input type="number" min={5} max={100} value={Math.round(setup.quorumShare * 100)} onChange={(e) => setSetup({ ...setup, quorumShare: Number(e.target.value) / 100 })} className="mt-0.5 w-[90px] font-mono" /></label>
          <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" className="nb-check" checked={setup.propose} onChange={(e) => setSetup({ ...setup, propose: e.target.checked })} />Members can add to the agenda</label>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(saveClubMeetingsAction(orgId, setup), "Meeting settings saved").then(() => setSetup(null))}>Save</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setSetup(null)}>Cancel</button>
        </fieldset> : null}
        {m ? <p><span className="font-medium">{m.title}</span> · {when(m.startsAt)}</p>
          : <p className="text-muted-foreground">No general meeting is planned.</p>}
        {d.officer ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPlanning(true)}>Plan a meeting</button> : null}
        {planning ? <NewMeetingDialog projectId={orgId} open={planning} onOpenChange={(o) => { setPlanning(o); if (!o) refresh(); }} /> : null}
        <p className="text-muted-foreground" data-testid="club-meeting-quorum">Quorum: {d.quorum.needed} needed, of {d.quorum.staying} members staying this Season.</p>
        {m?.canPropose ? <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (item.trim()) void run(proposeAgendaItemAction(orgId, m.id, item), "Added; an officer accepts or holds it").then(() => setItem("")); }}>
          <Input value={item} maxLength={200} onChange={(e) => setItem(e.target.value)} placeholder="An item for the agenda" aria-label="Add to the agenda" className="w-[280px]" />
          <button type="submit" className={FORM_SECONDARY_CLASS} disabled={!item.trim()}>Add to the agenda</button></form>
          : m && d.settings.propose ? <p className="text-muted-foreground">The agenda has closed.</p> : null}
        {d.requests.length ? <ul className="divide-y divide-border rounded-md border border-border" aria-label="Agenda requests">{d.requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="club-agenda-request">
            <span className="min-w-0 flex-1">{r.title}{d.officer ? <span className="text-muted-foreground"> · {r.name}</span> : null}</span>
            <StatusBadge state={r.state === "accepted" ? "done" : r.state === "held" ? "at_risk" : "draft"}>{AGENDA_WORDS[r.state]}</StatusBadge>
            {d.officer && r.state === "proposed" ? <>
              <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(decideAgendaItemAction(orgId, r.id, true), "Accepted")}>Accept<span className="sr-only"> {r.title}</span></button>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(decideAgendaItemAction(orgId, r.id, false), "Held for later")}>Hold<span className="sr-only"> {r.title}</span></button></> : null}
          </li>))}</ul> : null}
      </div>
    </OrgCard>
  );
}

/**
 * The constitution (B7.3b, 36.4 call 7): numbered articles, the version, and what changed with the meeting that changed
 * it. The President writes the first version from starter articles; after that only a passed amendment motion changes it.
 * On About for visitors when the club makes it public.
 */
export function ConstitutionCard({ orgId, about = false }: { orgId: string; about?: boolean }) {
  const q = useQuery({ queryKey: ["club-constitution", orgId], queryFn: () => readConstitutionAction(orgId), staleTime: 60_000 });
  const [draft, setDraft] = useState<Article[] | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d || (about && !d.version)) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  if (!d.version && !d.president) return null;
  if (draft) return (
    <OrgCard title="Write the constitution" testId="club-constitution">
      <div className="space-y-2 text-[13px]">
        <p className="text-muted-foreground">After this first version, the constitution changes only by a motion at a general meeting or the AGM.</p>
        <ol className="space-y-2">{draft.map((a, i) => (
          <li key={i} className="space-y-1 rounded-md border border-border p-2">
            <span className="flex gap-2"><Input value={a.n} maxLength={5} aria-label={`Article ${i + 1} number`} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))} className="w-[64px] font-mono" />
              <Input value={a.title} maxLength={80} aria-label={`Article ${i + 1} title`} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></span>
            <textarea className="nb-textarea min-h-[60px] w-full" value={a.text} maxLength={2000} aria-label={`Article ${i + 1} text`} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          </li>))}</ol>
        <span className="flex flex-wrap gap-2">
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft([...draft, { n: String(draft.length + 1), title: "", text: "" }])}>Add an article</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(writeConstitutionAction(orgId, draft), "Constitution published").then(() => setDraft(null))}>Publish version 1</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft(null)}>Cancel</button></span>
      </div>
    </OrgCard>
  );
  if (!d.version) return (
    <OrgCard title="Constitution" testId="club-constitution">
      <span className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-muted-foreground">Write the club’s rules as numbered articles; members vote on every change after that.</span>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft(STARTER_ARTICLES.map((a) => ({ ...a, text: a.text.replace("{club}", d.title) })))}>Write the constitution</button></span>
    </OrgCard>
  );
  return (
    <OrgCard title={`Constitution · version ${d.version}`} testId="club-constitution"
      action={d.president && !about ? <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" className="nb-check" checked={d.public}
        onChange={(e) => void run(setConstitutionPublicAction(orgId, e.target.checked), e.target.checked ? "Visitors can read it" : "Members only")} />Public</label> : null}>
      <div className="space-y-3 text-[13px]">
        <ol className="space-y-2">{d.articles.map((a) => (
          <li key={a.n}><h4 className="font-medium">Article {a.n} · {a.title}</h4><p className="whitespace-pre-wrap text-muted-foreground">{a.text}</p></li>))}</ol>
        {!about && d.history.length > 1 ? <details><summary className="cursor-pointer text-muted-foreground">Versions</summary>
          <ul className="mt-1 space-y-0.5">{d.history.map((h) => <li key={h.version}>Version {h.version} · {h.changed} · {day(h.at.slice(0, 10))}{h.meeting ? ` · ${h.meeting}` : ""}</li>)}</ul></details> : null}
      </div>
    </OrgCard>
  );
}

const DECISION_KIND = { decision: "Decision", constitution: "Constitution", attempt: "Not passed" } as const;
/** Decisions by Season (B7.3b, 36.4 call 8): the club's decisions, constitution versions and failed amendments. */
export function DecisionsCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["club-decisions", orgId], queryFn: () => readDecisionsAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d || !d.seasons.length) return null;
  return (
    <OrgCard title="Decisions" testId="club-decisions">
      <div className="space-y-3 text-[13px]">{d.seasons.map((s) => (
        <section key={s.season} aria-label={`Season ${s.season}`}>
          <h4 className="font-medium">{s.season === "Earlier" ? "Earlier" : `Season ${s.season}`}</h4>
          <ul className="mt-1 space-y-1">{s.entries.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2" data-testid="club-decision">
              <StatusBadge state={e.kind === "attempt" ? "at_risk" : e.kind === "constitution" ? "active" : "done"}>{DECISION_KIND[e.kind]}</StatusBadge>
              {e.docSlug ? <a className="nb-link" href={`?tab=docs&doc=${encodeURIComponent(e.docSlug)}`}>{e.title}</a> : <span>{e.title}</span>}
              {e.date ? <span className="text-muted-foreground">{day(e.date)}</span> : null}
            </li>))}</ul>
        </section>))}</div>
    </OrgCard>
  );
}

const VOTE_RESULT = { passed: "Passed", failed: "Failed", not_quorate: "Not quorate" } as const;
/**
 * Online motion votes (B7.3c, 36.4 call 4): a secret ballot For, Against or Abstain; "You voted" afterwards, never the
 * choice; turnout as a count; the result once it closes.
 */
export function MotionVotesCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["club-motion-votes", orgId], queryFn: () => readMotionVotesAction(orgId), staleTime: 30_000 });
  const [pick, setPick] = useState<Record<string, string>>({});
  const d = q.data?.success ? q.data : null;
  if (!d || !d.votes.length) return null;
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); void q.refetch(); };
  return (
    <OrgCard title="Online votes" testId="club-motion-votes">
      <ul className="space-y-2 text-[13px]">{d.votes.map((v) => (
        <li key={v.id} className="space-y-1.5 rounded-md border border-border p-3" data-testid="club-motion-vote">
          <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{v.text}</span>
            {v.result ? <StatusBadge state={v.result.result === "passed" ? "done" : "at_risk"}>{VOTE_RESULT[v.result.result as keyof typeof VOTE_RESULT] ?? "Closed"}</StatusBadge> : null}</p>
          {v.amendment ? <p className="text-muted-foreground">{v.amendment.text === null ? "Removes" : "Changes"} Article {v.amendment.article} of the constitution</p> : null}
          <p className="text-muted-foreground">{v.turnout} of {v.eligible} voted · {v.needed} needed{v.open ? ` · closes ${when(v.closesAt)}` : ""}</p>
          {v.result ? <p className="font-mono text-[12px]">For {v.result.for} · Against {v.result.against} · Abstain {v.result.abstain}</p> : null}
          {v.open && v.voted ? <p className="font-medium" data-testid="club-motion-voted">You voted</p> : null}
          {v.open && !v.voted && v.canVote ? <fieldset className="flex flex-wrap items-center gap-3" data-testid="club-motion-ballot"><legend className="sr-only">Your vote on {v.text}</legend>
            {(["for", "against", "abstain"] as const).map((c) => <label key={c} className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name={`motion-${v.id}`} checked={pick[v.id] === c} onChange={() => setPick({ ...pick, [v.id]: c })} />{c === "for" ? "For" : c === "against" ? "Against" : "Abstain"}</label>)}
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!pick[v.id]} onClick={() => void run(castMotionVoteAction(orgId, v.id, pick[v.id]!), "You voted")}>Submit</button></fieldset> : null}
        </li>))}</ul>
    </OrgCard>
  );
}

const STAGE_WORDS: Record<string, string> = { planned: "Planned", picking: "Picking teams", preparing: "Preparing", registered: "Registered", competing: "Competing", results: "Results", withdrawn: "Withdrawn" };
const PLACE_WORDS: Record<string, string> = { interested: "You’re interested", trying: "You’re trying out", selected: "You’re selected", not_this_time: "Not this time", accepted: "Your place is accepted", declined: "You declined" };
const PICK_WORDS: Record<string, string> = { interested: "Interested", trying: "Trying out", selected: "Selected", not_this_time: "Not this time", accepted: "Accepted place", declined: "Declined" };
const today = () => new Date().toISOString().slice(0, 10);
const span = (a: string, b: string) => (a === b ? day(a) : `${day(a)} to ${day(b)}`);
const EMPTY_COMPETITION: Competition = { title: "", organiser: "", category: "", starts: "", ends: "", registerBy: null, place: "", link: "", teamSize: 4, subs: 1, picking: "open" };

/**
 * Competitions (B7.4a, 36.5 calls 1–3): Upcoming and Past entries. Members sign up (Open sign-up) or try out (Tryouts,
 * with a hand-in only officers read) and see only their own outcome; officers add competitions, pick people and make each
 * team a private workspace with a captain, roles and substitutes. No leaderboards.
 */
export function CompetitionsCard({ orgId }: { orgId: string }) {
  const [view, setView] = useState<"upcoming" | "past">("upcoming");
  const q = useQuery({ queryKey: ["club-competitions", orgId, view], queryFn: () => readCompetitionsAction(orgId, view), staleTime: 60_000 });
  const [form, setForm] = useState<{ id: string | null; c: Competition } | null>(null);
  const [wish, setWish] = useState<Record<string, string>>({});
  const [handIn, setHandIn] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.competitions.length && !d.officer && view === "upcoming")) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  const set = (k: keyof Competition, v: string | number | null) => form && setForm({ ...form, c: { ...form.c, [k]: v } });
  return (
    <OrgCard title="Competitions" testId="club-competitions" action={<span className="flex items-center gap-3 text-[13px]">
      {(["upcoming", "past"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} className={view === v ? "font-medium text-foreground" : "nb-link"} onClick={() => setView(v)}>{v === "upcoming" ? "Upcoming" : "Past entries"}</button>)}
      {d.officer && !form ? <button type="button" className="nb-link" onClick={() => setForm({ id: null, c: EMPTY_COMPETITION })}>Add a competition</button> : null}</span>}>
      <div className="space-y-3 text-[13px]">
        {form ? <fieldset className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2" data-testid="club-competition-form">
          <legend className="sr-only">Competition details</legend>
          <label className="flex flex-col sm:col-span-2">Name<Input value={form.c.title} maxLength={120} onChange={(e) => set("title", e.target.value)} className="mt-0.5" /></label>
          <label className="flex flex-col">Organiser<Input value={form.c.organiser} maxLength={120} onChange={(e) => set("organiser", e.target.value)} className="mt-0.5" /></label>
          <label className="flex flex-col">Category<Input value={form.c.category} maxLength={40} placeholder="Robotics, Debate, Software" onChange={(e) => set("category", e.target.value)} className="mt-0.5" /></label>
          <label className="flex flex-col">Starts<Input type="date" value={form.c.starts} onChange={(e) => set("starts", e.target.value)} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">Ends<Input type="date" value={form.c.ends} onChange={(e) => set("ends", e.target.value)} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">Register by<Input type="date" value={form.c.registerBy ?? ""} onChange={(e) => set("registerBy", e.target.value || null)} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">Place or online<Input value={form.c.place} maxLength={120} onChange={(e) => set("place", e.target.value)} className="mt-0.5" /></label>
          <label className="flex flex-col sm:col-span-2">Link (typed; never opened by NetworkBase)<Input value={form.c.link} maxLength={500} placeholder="https://" onChange={(e) => set("link", e.target.value)} className="mt-0.5" /></label>
          <label className="flex flex-col">Team size<Input type="number" min={1} max={30} value={form.c.teamSize} onChange={(e) => set("teamSize", Number(e.target.value))} className="mt-0.5 w-[90px] font-mono" /></label>
          <label className="flex flex-col">Substitutes<Input type="number" min={0} max={10} value={form.c.subs} onChange={(e) => set("subs", Number(e.target.value))} className="mt-0.5 w-[90px] font-mono" /></label>
          <label className="flex flex-col sm:col-span-2">How teams are picked<select className="nb-select mt-0.5" value={form.c.picking} onChange={(e) => set("picking", e.target.value)}>
            {PICKING.map((p) => <option key={p} value={p}>{PICKING_WORDS[p]}</option>)}</select></label>
          <span className="flex gap-2 sm:col-span-2">
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!form.c.title.trim() || !form.c.starts || !form.c.ends} onClick={() => void run(saveCompetitionAction(orgId, form.id, form.c), "Competition saved").then(() => setForm(null))}>Save</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setForm(null)}>Cancel</button></span>
        </fieldset> : null}
        {!d.competitions.length ? <p className="text-muted-foreground">{view === "past" ? "No past entries yet." : "No competitions planned."}</p> : null}
        <ul className="space-y-2">{d.competitions.map((c) => (
          <li key={c.id} className="space-y-1.5 rounded-md border border-border p-3" data-testid="club-competition">
            <p className="flex flex-wrap items-center gap-2"><Trophy aria-hidden="true" className="size-4 text-muted-foreground" /><span className="font-medium">{c.title}</span>
              {c.category ? <span className="nb-tag">{c.category}</span> : null}<StatusBadge state={c.stage === "results" ? "done" : c.stage === "withdrawn" ? "at_risk" : "active"}>{STAGE_WORDS[c.stage] ?? c.stage}</StatusBadge></p>
            <p className="text-muted-foreground">{span(c.starts, c.ends)}{c.place ? ` · ${c.place}` : ""}{c.organiser ? ` · ${c.organiser}` : ""}</p>
            {c.registerBy && view === "upcoming" ? <p className="text-muted-foreground">Register by {day(c.registerBy)} · {daysLeft(c.registerBy, today())}</p> : null}
            <p className="text-muted-foreground">{PICKING_WORDS[c.picking]} · teams of {c.teamSize}{c.subs ? ` + ${c.subs} ${c.subs === 1 ? "substitute" : "substitutes"}` : ""}{c.counts ? ` · ${c.counts.interested} waiting, ${c.counts.accepted} accepted` : ""}</p>
            {c.teams.length ? <ul className="flex flex-wrap gap-3" aria-label={`Teams for ${c.title}`}>{c.teams.map((t) => <li key={t.workspaceId}>
              {t.slug ? <a className="nb-link" href={`/workspaces/${encodeURIComponent(t.slug)}`}>{t.name}</a> : <span className="font-medium">{t.name}</span>}
              <span className="text-muted-foreground"> · {t.size}{t.subs ? ` + ${t.subs} sub` : ""}{t.captain ? ` · captain ${t.captain}` : ""}</span></li>)}</ul> : null}
            {c.mine ? <p className="font-medium" data-testid="club-competition-mine">{PLACE_WORDS[c.mine.state] ?? c.mine.state}{c.mine.role ? ` · ${c.mine.role}` : ""}</p> : null}
            {c.mine?.state === "selected" ? <span className="flex gap-2">
              <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(answerPlaceAction(orgId, c.id, true), "Place accepted")}>Accept my place</button>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(answerPlaceAction(orgId, c.id, false), "Declined")}>Decline</button></span> : null}
            {d.member && c.stage === "picking" && c.picking !== "officers" && (!c.mine || c.mine.state === "interested" || c.mine.state === "trying") ? <form className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => { e.preventDefault(); void run(signUpAction(orgId, c.id, { wish: wish[c.id] ?? "", handIn: handIn[c.id] ?? "" }), c.picking === "tryouts" ? "Your tryout is in" : "You’re on the Interested list"); }}>
              <label className="flex flex-col">The role you’d like<Input value={wish[c.id] ?? ""} maxLength={60} onChange={(e) => setWish({ ...wish, [c.id]: e.target.value })} className="mt-0.5 w-[180px]" /></label>
              {c.picking === "tryouts" ? <label className="flex flex-col">Your tryout (a link or a few lines)<textarea className="nb-textarea mt-0.5 w-[280px] text-[13px]" rows={2} maxLength={2000} value={handIn[c.id] ?? ""} onChange={(e) => setHandIn({ ...handIn, [c.id]: e.target.value })} /></label> : null}
              <button type="submit" className={FORM_SECONDARY_CLASS}>{c.picking === "tryouts" ? (c.mine ? "Update my tryout" : "Try out") : (c.mine ? "Update" : "Sign up")}</button></form> : null}
            {d.officer ? <span className="flex flex-wrap items-center gap-2">
              <select className="nb-select" aria-label={`Status of ${c.title}`} value={c.stage} onChange={(e) => void run(setCompetitionStageAction(orgId, c.id, e.target.value), "Status changed")}>
                {Object.entries(STAGE_WORDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button type="button" className="nb-link" onClick={() => setForm({ id: c.id, c: { title: c.title, organiser: c.organiser, category: c.category, starts: c.starts, ends: c.ends, registerBy: c.registerBy, place: c.place, link: c.link, teamSize: c.teamSize, subs: c.subs, picking: c.picking } })}>Edit<span className="sr-only"> {c.title}</span></button>
              <button type="button" className="nb-link" aria-expanded={picking === c.id} onClick={() => setPicking(picking === c.id ? null : c.id)}>Picking and teams<span className="sr-only"> for {c.title}</span></button></span> : null}
            {picking === c.id ? <PickingPanel orgId={orgId} competitionId={c.id} onChanged={refresh} /> : null}
          </li>))}</ul>
      </div>
    </OrgCard>
  );
}

/** Officers: the Interested list or tryouts (Selected · Not this time, told only to the person), offers, and Make a team. */
function PickingPanel({ orgId, competitionId, onChanged }: { orgId: string; competitionId: string; onChanged: () => void }) {
  const q = useQuery({ queryKey: ["club-picking", competitionId], queryFn: () => readPickingAction(orgId, competitionId), staleTime: 30_000 });
  const [offer, setOffer] = useState("");
  const [team, setTeam] = useState<{ name: string; captainId: string; people: Record<string, { on: boolean; role: string; substitute: boolean }> }>({ name: "", captainId: "", people: {} });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); void q.refetch(); onChanged(); };
  const free = d.people.filter((p) => p.state === "accepted" && !p.team && p.userId);
  const chosen = free.filter((p) => team.people[p.userId!]?.on);
  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3" data-testid="club-picking">
      <ul className="divide-y divide-border">{d.people.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
          <span className="min-w-[120px] font-medium">{p.name}</span>{p.wish ? <span className="text-muted-foreground">{p.wish}</span> : null}
          <span className="text-muted-foreground">{PICK_WORDS[p.state] ?? p.state}</span>
          {p.handIn ? <span className="block w-full whitespace-pre-wrap text-muted-foreground">{p.handIn}</span> : null}
          {p.state === "interested" || p.state === "trying" ? <>
            <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(decidePlaceAction(orgId, p.id, true), "Selected; they’re told")}>Selected<span className="sr-only"> {p.name}</span></button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(decidePlaceAction(orgId, p.id, false), "Not this time; only they’re told")}>Not this time<span className="sr-only"> {p.name}</span></button></> : null}
        </li>))}</ul>
      <span className="flex flex-wrap items-center gap-2">
        <select className="nb-select" aria-label="Offer a place" value={offer} onChange={(e) => setOffer(e.target.value)}>
          <option value="">Offer a place to…</option>{d.members.filter((m) => !d.people.some((p) => p.userId === m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={!offer} onClick={() => void run(offerPlaceAction(orgId, competitionId, offer), "Offered; they accept it").then(() => setOffer(""))}>Offer</button></span>
      {free.length ? <fieldset className="space-y-1.5" data-testid="club-make-team"><legend className="font-medium">Make a team from accepted places</legend>
        <label className="flex flex-col">Team name<Input value={team.name} maxLength={40} placeholder="Team A" onChange={(e) => setTeam({ ...team, name: e.target.value })} className="mt-0.5 w-[200px]" /></label>
        <ul className="space-y-1">{free.map((p) => { const t = team.people[p.userId!] ?? { on: false, role: "", substitute: false }; const put = (v: Partial<typeof t>) => setTeam({ ...team, people: { ...team.people, [p.userId!]: { ...t, ...v } } }); return (
          <li key={p.id} className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-[140px] items-center gap-1.5"><input type="checkbox" className="nb-check" checked={t.on} onChange={(e) => put({ on: e.target.checked })} />{p.name}</label>
            {t.on ? <><Input value={t.role} maxLength={60} placeholder={p.wish ?? "Role"} aria-label={`Role for ${p.name}`} onChange={(e) => put({ role: e.target.value })} className="w-[160px]" />
              <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={t.substitute} onChange={(e) => put({ substitute: e.target.checked })} />Substitute</label>
              <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name={`captain-${competitionId}`} checked={team.captainId === p.userId} onChange={() => setTeam({ ...team, captainId: p.userId! })} />Captain</label></> : null}
          </li>); })}</ul>
        <button type="button" className={FORM_PRIMARY_CLASS} disabled={!team.name.trim() || !team.captainId || !chosen.length}
          onClick={() => void run(makeTeamAction(orgId, competitionId, { name: team.name, captainId: team.captainId, people: chosen.map((p) => ({ userId: p.userId!, role: team.people[p.userId!]!.role.trim(), substitute: team.people[p.userId!]!.substitute })) }), "Team workspace made").then(() => setTeam({ name: "", captainId: "", people: {} }))}>Make the team</button>
      </fieldset> : null}
    </div>
  );
}

