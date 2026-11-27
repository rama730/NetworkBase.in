"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";

import { applyStarterAction, moveKeyDateAction, previewMoveAction, readFixedTimeAction, setFixedTimeAction } from "@/app/actions/fixed-time";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const full = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const STATE = { planning: "Planning", this_week: "This week", today: "Today", wrap_up: "Wrap-up", ended: "Ended" } as const;

/**
 * Dates (B8.2a, report 37.4): the countdown line with the key date in full, the plan starter, this week's tasks worked
 * back from the key date (offsets as words), and Move the key date with a preview of what moves and what stays.
 */
export function FixedTimeCard({ orgId, other }: { orgId: string; other: boolean }) {
  const q = useQuery({ queryKey: ["fixed-time", orgId], queryFn: () => readFixedTimeAction(orgId), staleTime: 60_000 });
  const [setting, setSetting] = useState<{ keyDate: string; endDate: string } | null>(null);
  const [move, setMove] = useState<{ to: string; reason: string; preview: { passed: boolean; moves: Array<{ id: string; title: string; from: string | null; to: string }>; stays: Array<{ id: string; title: string; due: string | null }> } | null } | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.fixed && !(d.organiser && other))) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); refresh(); return true; };
  const f = d.fixed;
  if (!f) return (
    <OrgCard title="Dates" testId="fixed-time">
      {setting ? <fieldset className="flex flex-wrap items-end gap-2 text-[13px]"><legend className="sr-only">Key date and end date</legend>
        <label className="flex flex-col">Key date (the day, launch or deadline)<Input type="date" value={setting.keyDate} onChange={(e) => setSetting({ ...setting, keyDate: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
        <label className="flex flex-col">End date (30 days after if empty)<Input type="date" value={setting.endDate} onChange={(e) => setSetting({ ...setting, endDate: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
        <button type="button" className={FORM_PRIMARY_CLASS} disabled={!setting.keyDate} onClick={() => void run(setFixedTimeAction(orgId, { keyDate: setting.keyDate, endDate: setting.endDate || null }), "Dates set").then(() => setSetting(null))}>Save</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setSetting(null)}>Cancel</button></fieldset>
        : <span className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-muted-foreground">A team for a fixed time plans backwards from its key date.</span>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setSetting({ keyDate: "", endDate: "" })}>Set the key date</button></span>}
    </OrgCard>
  );
  return (
    <OrgCard title="Dates" testId="fixed-time" action={<StatusBadge state={f.state === "ended" ? "done" : f.state === "planning" ? "draft" : "active"}>{STATE[f.state]}</StatusBadge>}>
      <div className="space-y-3 text-[13px]">
        <p className="flex flex-wrap items-center gap-2" data-testid="fixed-time-countdown"><Hourglass aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="font-medium">{f.line}</span><span className="text-muted-foreground">· {full(f.keyDate)} · ends {full(f.endDate)}</span>
          {d.organiser && !move ? <button type="button" className="nb-link" onClick={() => setMove({ to: f.keyDate, reason: "", preview: null })}>Move the key date</button> : null}</p>
        {move ? <div className="space-y-2 rounded-md border border-border p-3" data-testid="fixed-time-move">
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col">New key date<Input type="date" value={move.to} onChange={(e) => setMove({ ...move, to: e.target.value, preview: null })} className="mt-0.5 w-auto font-mono" /></label>
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={!move.to || move.to === f.keyDate} onClick={() => void safe(previewMoveAction(orgId, move.to)).then((r) => (r.success && "moves" in r ? setMove({ ...move, preview: r }) : toast.error("Couldn’t work it out.")))}>Preview</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMove(null)}>Cancel</button></span>
          {move.preview ? <>
            <p>{move.preview.moves.length} {move.preview.moves.length === 1 ? "date moves" : "dates move"}; {move.preview.stays.length} set by hand {move.preview.stays.length === 1 ? "stays" : "stay"}.</p>
            <ul className="max-h-40 space-y-0.5 overflow-auto">{move.preview.moves.map((m) => <li key={m.id}>{m.title}: {m.from ? full(m.from) : "no date"} to {full(m.to)}</li>)}
              {move.preview.stays.map((m) => <li key={m.id} className="text-muted-foreground">{m.title}: stays {m.due ? full(m.due) : ""} (set by hand)</li>)}</ul>
            {move.preview.passed ? <label className="flex flex-col">Why it’s moving (the key date has passed; kept for the debrief)<Input value={move.reason} maxLength={300} onChange={(e) => setMove({ ...move, reason: e.target.value })} className="mt-0.5" /></label> : null}
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={move.preview.passed && !move.reason.trim()} onClick={() => void run(moveKeyDateAction(orgId, move.to, move.reason || null), "Key date moved; the team is told").then((ok) => ok && setMove(null))}>Move it</button></> : null}
        </div> : null}
        {!f.starter && d.organiser ? <span className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">Pick a plan, laid out backwards from the key date:</span>
          {d.starters.map((s) => <button key={s.id} type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(applyStarterAction(orgId, s.id), `${s.name} plan added`)}>{s.name} ({s.tasks} tasks)</button>)}</span> : null}
        {"week" in d && d.week.length ? <section aria-label="This week"><h4 className="font-medium">This week, worked back from {full(f.keyDate)}</h4>
          <ul className="mt-1 space-y-0.5">{d.week.map((t) => <li key={t.id} data-testid="fixed-time-task">{t.title} <span className="text-muted-foreground">· {full(t.due)} · {t.handSet ? "set by hand" : t.offset}{t.overdue ? " · not done yet" : ""}</span></li>)}</ul></section> : null}
      </div>
    </OrgCard>
  );
}
