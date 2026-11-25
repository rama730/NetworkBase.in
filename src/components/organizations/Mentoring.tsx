"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartHandshake } from "lucide-react";

import { answerUsefulAction, matchMentorsAction, readCheckinsAction, readMentoringAction, saveCheckinAction, saveMentoringSettingsAction, shareCheckinAction } from "@/app/actions/mentoring";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { USEFUL_WORDS, type Mentoring, type UsefulAnswer } from "@/lib/organizations/mentoring";

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
              <p className="text-muted-foreground">{c.useful.shown ? c.useful.line : `Useful shows after 5 answers (${c.useful.answers} so far)`}</p>
            </li>
          ))}
        </ul>
      )}
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
              <button type="button" className={LINK} onClick={() => setOpen({ id: "me", name: "you" })}>Check-ins and Prep</button>
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
        </OrgCard>
      ) : null}
      <Dialog open={open != null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent size="wide">
          <DialogHeader>
            <DialogTitle>Check-ins{open && open.id !== "me" ? ` with ${open.name}` : ""}</DialogTitle>
            <DialogDescription>Private to the two of you. Share an entry to show it to the instructor.</DialogDescription>
          </DialogHeader>
          {open ? <CheckinsPanel orgId={orgId} learnerId={open.id === "me" ? null : open.id} /> : null}
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
