"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartHandshake } from "lucide-react";

import { answerUsefulAction, matchMentorsAction, readCheckinsAction, readMentoringAction, saveCheckinAction, saveMentoringSettingsAction, shareCheckinAction } from "@/app/actions/mentoring";
import { approveMentorNoteAction, bookCheckinAction, raiseConcernAction, readBookingAction, readConcernsAction, readMentorNoteAction, readMySlotsAction, readObjectivesAction, saveMentorNoteAction, saveMySlotsAction, saveObjectiveAction } from "@/app/actions/mentoring-plan";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { OBJECTIVE_WORDS, USEFUL_WORDS, type Mentoring, type ObjectiveStatus, type UsefulAnswer } from "@/lib/organizations/mentoring";

// Report 31.5 C5 (plan B2.3a): Members → Mentors, the My mentor / My mentees card, a pair's check-ins, Settings → Mentoring.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (d: string | null) => (d ? DAY.format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : "None yet");
const key = (orgId: string) => ["mentoring", orgId] as const;
const useMentoring = (orgId: string) => useQuery({ queryKey: key(orgId), queryFn: () => readMentoringAction(orgId), staleTime: 30_000 });
const rhythmWord = (r: { on: boolean; days: number | null } | null) => (!r ? null : r.on ? <StatusBadge state="done">On rhythm</StatusBadge> : <StatusBadge state="at_risk">{r.days != null ? `No check-in in ${r.days} days` : "Off rhythm"}</StatusBadge>);

/** Members → Mentors (staff): mentor cards, pairs off rhythm, and Match mentors for anyone not matched. */
export function MentorsView({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useMentoring(orgId);
  const [busy, setBusy] = useState(false);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading mentors…</p>;
  if (!q.data?.success) return <ErrorNotice what="Mentors" onRetry={() => void q.refetch()} />;
  if (!q.data.on) return <p className="text-[13px] text-muted-foreground">Mentoring is off. {q.data.canSet ? "Turn it on in Settings under Mentoring, then add Mentor groups in Sections." : ""}</p>;
  const staff = q.data.staff;
  if (!staff) return null;
  const match = async (pairs: Array<{ userId: string; groupId: string }>) => {
    setBusy(true);
    const r = await matchMentorsAction(orgId, pairs);
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(`${r.matched} matched. They’re told who their mentor is.`);
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <section aria-label="Mentors" className="space-y-3" data-testid="mentors-view">
      {staff.cards.length === 0 ? <p className="text-[13px] text-muted-foreground">No mentor groups yet. Add one in Sections with the kind Mentor group, and its TAs are its mentors.</p> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {staff.cards.map((c) => (
            <li key={c.id} className="space-y-1.5 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="mentor-card">
              <p className="font-medium">{c.mentors.map((m) => m.name).join(", ") || "No mentor"} <span className="nb-meta font-mono">· {c.learners} {c.learners === 1 ? "learner" : "learners"}</span></p>
              <p className="text-muted-foreground">{c.name} · on rhythm {c.onRhythm}{c.off.length ? ` · ${c.off.length} off rhythm` : ""}</p>
              {c.off.map((o) => <p key={o.name} className="flex items-center gap-2"><span>{o.name}</span><StatusBadge state="at_risk">{o.days != null ? `No check-in in ${o.days} days` : "Off rhythm"}</StatusBadge></p>)}
              <p className="text-muted-foreground">Objectives: on track {c.objectives.onTrack} · at risk {c.objectives.atRisk}</p>
              <p className="text-muted-foreground">{c.useful.shown ? c.useful.line : `Useful shows after 5 answers (${c.useful.answers} so far)`}</p>
            </li>
          ))}
        </ul>
      )}
      {q.data.canSet ? <ConcernsList orgId={orgId} /> : null}
      {staff.unmatched.length ? (
        <div className="space-y-2 rounded-md border border-border p-3 text-[13px]" data-testid="unmatched">
          <p className="font-medium">Not matched yet <span className="nb-meta font-mono">{staff.unmatched.length}</span></p>
          <ul className="space-y-1">
            {staff.unmatched.map((u) => {
              const s = staff.suggestions.find((x) => x.userId === u.id);
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[140px]">{u.name}</span>
                  <select className="nb-select" data-size="sm" aria-label={`Mentor group for ${u.name}`} defaultValue="" disabled={busy}
                    onChange={(e) => { if (e.target.value) void match([{ userId: u.id, groupId: e.target.value }]); }}>
                    <option value="">Match to…</option>
                    {staff.cards.map((c) => <option key={c.id} value={c.id}>{c.mentors.map((m) => m.name).join(", ") || c.name}{s?.groupId === c.id ? " (suggested)" : ""}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
          {staff.suggestions.length ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void match(staff.suggestions)}>Match as suggested</button> : null}
        </div>
      ) : null}
    </section>
  );
}

/** Overview: My mentor (learners) or My mentees (mentors), each opening the pair's check-ins. */
export function MentoringCard({ orgId }: { orgId: string }) {
  const q = useMentoring(orgId);
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  const data = q.data?.success && q.data.on ? q.data : null;
  if (!data || (!data.myMentor && !data.mentees.length)) return null;
  return (
    <>
      {data.myMentor ? (
        <OrgCard title="My mentor" testId="my-mentor">
          {data.myMentor.mentors.length ? (
            <div className="space-y-1 text-[13px]">
              <p className="flex flex-wrap items-center gap-2"><HeartHandshake className="size-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium">{data.myMentor.mentors.map((m) => m.name).join(", ")}</span>{rhythmWord(data.myMentor.rhythm)}</p>
              <p className="nb-meta font-mono">{data.myMentor.plan}</p>
              <p className="text-muted-foreground">Last check-in: {day(data.myMentor.last)}</p>
              <button type="button" className={LINK} onClick={() => setOpen({ id: "me", name: "you" })}>Check-ins, Prep and objectives</button>
              <BookTime orgId={orgId} />
            </div>
          ) : <p className="text-[13px] text-muted-foreground">Your mentor will be shared soon.</p>}
        </OrgCard>
      ) : null}
      {data.mentees.length ? (
        <OrgCard title="My mentees" testId="my-mentees">
          <ul className="divide-y divide-border text-[13px]">
            {data.mentees.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="flex items-center gap-2"><span className="font-medium">{m.name}</span>{rhythmWord(m.rhythm)}</span>
                <span className="flex items-center gap-3"><span className="nb-meta font-mono">last {day(m.last)} · {m.held} held</span>
                  <button type="button" className={LINK} onClick={() => setOpen(m)}>Check-ins<span className="sr-only"> with {m.name}</span></button></span>
              </li>
            ))}
          </ul>
          <MySlots orgId={orgId} />
        </OrgCard>
      ) : null}
      <Dialog open={open != null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent size="wide">
          <DialogHeader>
            <DialogTitle>Check-ins{open && open.id !== "me" ? ` with ${open.name}` : ""}</DialogTitle>
            <DialogDescription>Private to the two of you. Share an entry to show it to the instructor.</DialogDescription>
          </DialogHeader>
          {open ? <><PairExtras orgId={orgId} learnerId={open.id === "me" ? null : open.id} /><CheckinsPanel orgId={orgId} learnerId={open.id === "me" ? null : open.id} /></> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A pair's running page, newest date first: Prep (the learner), notes (both), Share, Was this useful?. */
export function CheckinsPanel({ orgId, learnerId }: { orgId: string; learnerId: string | null }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["checkins", orgId, learnerId ?? "me"], queryFn: () => readCheckinsAction(orgId, learnerId), staleTime: 10_000 });
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.isPending) return <p role="status" className="nb-waiting py-4 text-[13px] text-muted-foreground"><PixelBeat />Loading check-ins…</p>;
  if (!q.data?.success) return <ErrorNotice what="Check-ins" onRetry={() => void q.refetch()} />;
  const data = q.data;
  const target = data.learnerId;
  const refresh = () => client.invalidateQueries({ queryKey: ["checkins", orgId, learnerId ?? "me"] });
  const save = async (input: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await saveCheckinAction(orgId, target, input);
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(ok);
    void refresh();
  };
  return (
    <div className="space-y-3 text-[13px]" data-testid="checkins">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">Date <Input type="date" value={date || data.today} onChange={(e) => setDate(e.target.value)} className="w-[160px] font-mono" /></label>
        <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void save({ date: date || data.today, notes: "" }, "Check-in added")}>Add a check-in</button>
      </div>
      {data.entries.length === 0 ? <p className="text-muted-foreground">No check-ins yet.</p> : null}
      <ol className="space-y-3">
        {data.entries.map((e) => <CheckinEntry key={e.id} entry={e} data={data} busy={busy} onSave={save} orgId={orgId} onChanged={refresh} />)}
      </ol>
    </div>
  );
}

type Entry = { id: string; date: string; prep: { since?: string; stuck?: string; asks?: string } | null; prepDone: boolean; notes: string | null; shared: boolean; answered?: boolean };
function CheckinEntry({ entry, data, busy, onSave, orgId, onChanged }: { entry: Entry; data: { isLearner: boolean; usefulOn: boolean; today: string }; busy: boolean; orgId: string;
  onSave: (input: Record<string, unknown>, ok: string) => Promise<void>; onChanged: () => void }) {
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [prep, setPrep] = useState({ since: entry.prep?.since ?? "", stuck: entry.prep?.stuck ?? "", asks: entry.prep?.asks ?? "" });
  const past = entry.date <= data.today;
  return (
    <li className="space-y-2 rounded-md border border-border p-3" data-testid="checkin-entry">
      <p className="flex flex-wrap items-center gap-2 font-medium">{day(entry.date)}
        {entry.prepDone ? <StatusBadge state="done">Prep done</StatusBadge> : <StatusBadge state="new">Prep not done</StatusBadge>}
        {entry.shared ? <StatusBadge state="active">Shared with the instructor</StatusBadge> : null}</p>
      <fieldset className="space-y-1.5" disabled={!data.isLearner || busy}>
        <legend className="text-[12px] font-medium text-muted-foreground">Prep {data.isLearner ? "(you, before)" : "(the learner)"}</legend>
        {(["since", "stuck", "asks"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1"><span className="text-[12px]">{k === "since" ? "Since last time" : k === "stuck" ? "Stuck on" : "Asks"}</span>
            <Input value={prep[k]} maxLength={2000} onChange={(e) => setPrep({ ...prep, [k]: e.target.value })} /></label>
        ))}
        {data.isLearner ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void onSave({ date: entry.date, prep }, "Prep saved")}>Save prep</button> : null}
      </fieldset>
      <label className="flex flex-col gap-1"><span className="text-[12px] font-medium text-muted-foreground">Notes (both)</span>
        <textarea className="nb-textarea" rows={3} maxLength={20000} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label={`Notes for ${day(entry.date)}`} /></label>
      <span className="flex flex-wrap items-center gap-3">
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void onSave({ date: entry.date, notes }, "Notes saved")}>Save notes</button>
        {data.isLearner ? <button type="button" className={LINK} onClick={() => void shareCheckinAction(orgId, entry.id, !entry.shared).then((r) => { if (!r.success) return void toast.error(r.error); onChanged(); })}>
          {entry.shared ? "Stop sharing" : "Share with the instructor"}</button> : null}
      </span>
      {data.isLearner && data.usefulOn && past && !entry.answered ? (
        <p className="flex flex-wrap items-center gap-2" data-testid="useful">Was this useful?
          {(Object.keys(USEFUL_WORDS) as UsefulAnswer[]).map((a) => (
            <button key={a} type="button" className={FORM_SECONDARY_CLASS} onClick={() => void answerUsefulAction(orgId, entry.id, a).then((r) => { if (!r.success) return void toast.error(r.error); toast.success("Thanks"); onChanged(); })}>{USEFUL_WORDS[a]}</button>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/** Settings → Mentoring (the Teacher): on, the plan, the rhythm warning and Was this useful?. */
export function MentoringSettingsCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useMentoring(orgId);
  const [draft, setDraft] = useState<Mentoring | null>(null);
  if (!q.data?.success || !q.data.canSet) return null;
  const s: Mentoring = draft ?? (q.data.on ? q.data.settings : { on: false, everyWeeks: 2, minutes: 30, checkins: 6, rhythmDays: 21, useful: true });
  const num = (k: "everyWeeks" | "minutes" | "checkins" | "rhythmDays", label: string, min: number, max: number) => (
    <label className="flex items-center gap-2">{label}<Input type="number" min={min} max={max} value={s[k]} aria-label={label} onChange={(e) => setDraft({ ...s, [k]: Number(e.target.value) || min })} className="w-[80px] font-mono" /></label>
  );
  const save = async () => {
    const r = await saveMentoringSettingsAction(orgId, s);
    if (!r.success) return void toast.error(r.error);
    toast.success(s.on ? "Mentoring saved" : "Mentoring is off");
    setDraft(null);
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <SettingsCard title="Mentoring" headingLevel={2} description="Mentor groups are Sections of the kind Mentor group; their TAs are the mentors. Check-ins stay between the pair.">
      <div className="space-y-2 text-[13px]" data-testid="mentoring-settings">
        <label className="flex items-center gap-2"><input className="nb-check" type="checkbox" checked={s.on} onChange={(e) => setDraft({ ...s, on: e.target.checked })} />Mentoring on</label>
        <div className="flex flex-wrap items-center gap-4">{num("everyWeeks", "Every (weeks)", 1, 8)}{num("minutes", "Minutes", 10, 120)}{num("checkins", "Check-ins", 1, 52)}{num("rhythmDays", "Warn after (days)", 7, 60)}</div>
        <label className="flex items-center gap-2"><input className="nb-check" type="checkbox" checked={s.useful} onChange={(e) => setDraft({ ...s, useful: e.target.checked })} />Ask “Was this useful?” (shown after 5 answers)</label>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save mentoring</button>
      </div>
    </SettingsCard>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WHEN = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** B2.3b: objectives (up to 3 open), the mentor's note, and Raise a concern — inside the pair's dialog. */
function PairExtras({ orgId, learnerId }: { orgId: string; learnerId: string | null }) {
  const client = useQueryClient();
  const k = ["mentor-pair", orgId, learnerId ?? "me"] as const;
  const objectives = useQuery({ queryKey: [...k, "objectives"], queryFn: () => readObjectivesAction(orgId, learnerId), staleTime: 15_000 });
  const note = useQuery({ queryKey: [...k, "note"], queryFn: () => readMentorNoteAction(orgId, learnerId), staleTime: 15_000 });
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [concern, setConcern] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: k });
  const run = (p: Promise<{ success: true } | { success: false; error: string }>, ok: string, after?: () => void) => void p.then((r) => { if (!r.success) return void toast.error(r.error); toast.success(ok); after?.(); void refresh(); });
  const o = objectives.data?.success ? objectives.data : null;
  const n = note.data?.success ? note.data : null;
  return (
    <div className="space-y-3 border-b border-border pb-3 text-[13px]" data-testid="pair-extras">
      {o ? (
        <section aria-label="Objectives" className="space-y-1.5">
          <p className="font-medium">Objectives</p>
          <ul className="space-y-1">
            {o.objectives.map((ob) => (
              <li key={ob.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{ob.title}</span>
                <select className="nb-select" data-size="sm" aria-label={`Status of ${ob.title}`} value={ob.status} onChange={(e) => run(saveObjectiveAction(orgId, learnerId, { id: ob.id, status: e.target.value }), "Objective updated")}>
                  {(Object.keys(OBJECTIVE_WORDS) as ObjectiveStatus[]).map((st) => <option key={st} value={st}>{OBJECTIVE_WORDS[st]}</option>)}
                </select>
              </li>
            ))}
          </ul>
          {o.canAdd ? (
            <span className="flex gap-2"><Input value={title} maxLength={200} placeholder="Add an objective" aria-label="New objective" onChange={(e) => setTitle(e.target.value)} />
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={!title.trim()} onClick={() => run(saveObjectiveAction(orgId, learnerId, { title }), "Objective added", () => setTitle(""))}>Add</button></span>
          ) : <p className="text-[12px] text-muted-foreground">Three open at a time. Mark one Done to add another.</p>}
        </section>
      ) : null}
      {n ? (
        <section aria-label="Mentor’s note" className="space-y-1.5">
          <p className="font-medium">Mentor’s note on the completion entry</p>
          {n.isLearner ? (n.note ? (
            <p className="flex flex-wrap items-center gap-2"><span>“{n.note.body}” · {n.note.by}</span>
              {n.note.approved ? <StatusBadge state="done">Approved</StatusBadge> : null}
              <button type="button" className={LINK} onClick={() => run(approveMentorNoteAction(orgId, !n.note!.approved), n.note!.approved ? "Note hidden" : "Note approved")}>{n.note.approved ? "Hide it" : "Approve it"}</button></p>
          ) : <p className="text-muted-foreground">Your mentor can write one; it shows only once you approve it.</p>) : (
            <span className="flex gap-2"><Input value={draft ?? n.note?.body ?? ""} maxLength={500} aria-label="Mentor’s note" onChange={(e) => setDraft(e.target.value)} />
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => learnerId && run(saveMentorNoteAction(orgId, learnerId, draft ?? n.note?.body ?? ""), "Note saved. It shows once they approve it.", () => setDraft(null))}>Save note</button></span>
          )}
        </section>
      ) : null}
      <section aria-label="Raise a concern" className="flex gap-2">
        <Input value={concern} maxLength={2000} placeholder="Raise a concern with the instructor (private)" aria-label="Concern" onChange={(e) => setConcern(e.target.value)} />
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={!concern.trim()} onClick={() => run(raiseConcernAction(orgId, { aboutId: learnerId, body: concern }), "Sent privately to the instructor", () => setConcern(""))}>Send</button>
      </section>
    </div>
  );
}

/** B2.3b: Book a time — the mentor's free times for the next 2 weeks as buttons; a .ics after booking. */
function BookTime({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["mentor-booking", orgId], queryFn: () => readBookingAction(orgId), staleTime: 30_000 });
  const [ics, setIcs] = useState<string | null>(null);
  const data = q.data?.success ? q.data : null;
  if (!data) return null;
  const book = (mentorId: string, at: string) => void bookCheckinAction(orgId, mentorId, at).then((r) => {
    if (!r.success) return void toast.error(r.error);
    toast.success(`Booked with ${r.mentor}`);
    setIcs(`data:text/calendar;charset=utf-8,${encodeURIComponent(r.ics)}`);
    void client.invalidateQueries({ queryKey: ["mentor-booking", orgId] });
  });
  const free = data.mentors.flatMap((m) => m.free.map((at) => ({ m, at }))).slice(0, 8);
  return (
    <div className="space-y-1.5" data-testid="book-time">
      {data.next ? <p>Next: <span className="font-mono">{WHEN.format(new Date(data.next))}</span></p> : null}
      {ics ? <a className={LINK} href={ics} download="check-in.ics">Add to calendar (.ics)</a> : null}
      {free.length ? (
        <><p className="text-[12px] text-muted-foreground">Book a time ({data.minutes} min)</p>
          <ul className="flex flex-wrap gap-2">{free.map(({ m, at }) => <li key={`${m.id}-${at}`}><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => book(m.id, at)}>{WHEN.format(new Date(at))}<span className="sr-only"> with {m.name}</span></button></li>)}</ul></>
      ) : data.mentors.length ? <p className="text-[12px] text-muted-foreground">No times to book. Message {data.mentors[0]!.name} to arrange one.</p> : null}
    </div>
  );
}

/** B2.3b: a mentor's weekly times (day and HH:MM), saved together. */
function MySlots({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["mentor-slots", orgId], queryFn: () => readMySlotsAction(orgId), staleTime: 60_000 });
  const [rows, setRows] = useState<Array<{ weekday: number; start: string }> | null>(null);
  if (!q.data?.success) return null;
  const list = rows ?? q.data.slots;
  return (
    <details className="mt-2 text-[13px]" data-testid="my-slots">
      <summary className="cursor-pointer font-medium">Your times for booking ({list.length})</summary>
      <ul className="mt-2 space-y-1">
        {list.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <select className="nb-select" data-size="sm" aria-label={`Day of time ${i + 1}`} value={r.weekday} onChange={(e) => setRows(list.map((x, j) => (j === i ? { ...x, weekday: Number(e.target.value) } : x)))}>
              {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
            </select>
            <Input type="time" aria-label={`Start of time ${i + 1}`} value={r.start} onChange={(e) => setRows(list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="w-[120px] font-mono" />
            <button type="button" className={LINK} onClick={() => setRows(list.filter((_, j) => j !== i))}>Remove<span className="sr-only"> time {i + 1}</span></button>
          </li>
        ))}
      </ul>
      <span className="mt-2 flex gap-2">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setRows([...list, { weekday: 3, start: "18:00" }])}>Add a time</button>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void saveMySlotsAction(orgId, list).then((r) => { if (!r.success) return void toast.error(r.error); toast.success("Times saved"); setRows(null); void q.refetch(); })}>Save times</button>
      </span>
    </details>
  );
}

/** B2.3b: concerns for the Teacher, newest first; they stay on record. */
function ConcernsList({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["mentor-concerns", orgId], queryFn: () => readConcernsAction(orgId), staleTime: 30_000 });
  const list = q.data?.success ? q.data.concerns : [];
  if (!list.length) return null;
  return (
    <section aria-label="Concerns" className="space-y-1.5 rounded-md border border-border p-3 text-[13px]" data-testid="mentor-concerns">
      <p className="font-medium">Concerns <span className="nb-meta font-mono">{list.length}</span></p>
      <ul className="space-y-1">{list.map((c) => <li key={c.id}><span className="nb-meta font-mono">{c.at.slice(0, 10)}</span> {c.from ?? "Someone"}{c.about ? ` about ${c.about}` : ""}: {c.body}</li>)}</ul>
    </section>
  );
}
