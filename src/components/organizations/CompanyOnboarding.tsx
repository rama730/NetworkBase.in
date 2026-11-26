"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { answerHowsItGoingAction, readOnboardingBoardAction, readOnboardingPlanAction, readStartHereAction, saveOnboardingPlanAction, setBuddyAction, setOnboardingStartAction } from "@/app/actions/company-onboarding";
import { updateTaskStatusAction } from "@/app/actions/task";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { KIND_WORD, PHASES, whoWords, type PlanStep, type StepKind, type StepWho } from "@/lib/organizations/onboarding-plan";

// Report 33.5 (plan B4.4, K4): Start here for new people, Members → Onboarding, and Settings → Onboarding plan.

/** Start here (company Overview, the new person): Day N, % done, welcome note, buddy, phases with their steps. */
export function StartHere({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["start-here", orgId], queryFn: () => readStartHereAction(orgId), staleTime: 30_000 });
  const [answer, setAnswer] = useState("");
  const o = q.data?.success ? q.data.onboarding : null;
  const lab = q.data?.success ? q.data.lab : false;
  const WHO_WORD = whoWords(lab ? "research" : null);
  if (!o || o.complete) return null;
  const refresh = () => void client.invalidateQueries({ queryKey: ["start-here", orgId] });
  const tick = async (taskId: string) => { const r = await updateTaskStatusAction(taskId, "done", orgId); if (!r.success) return void toast.error("Couldn’t tick it."); refresh(); };
  const send = async () => { const r = await answerHowsItGoingAction(orgId, answer); if (!r.success) return void toast.error(r.error); toast.success(lab ? "Thanks — your supervisor will read it" : "Thanks — your line manager will read it"); refresh(); };
  return (
    <OrgCard title={`Start here · ${o.day}`} testId="start-here" action={<span className="font-mono text-[13px]">{o.done} of {o.total} steps · {o.total ? Math.round((o.done / o.total) * 100) : 0}%</span>}>
      <div className="space-y-3 text-[13px]">
        {o.note ? <p className="whitespace-pre-wrap">{o.note}</p> : null}
        <p className="text-muted-foreground">{o.manager ? (lab ? `Supervisor: ${o.manager}` : `Reports to ${o.manager}`) : null}{o.manager && o.buddy ? " · " : null}
          {o.buddy ? <>Your buddy: {o.buddy.name} <Link href={`/messages?userId=${encodeURIComponent(o.buddy.id)}`} className="nb-link">Message</Link></> : null}</p>
        {PHASES.map((phase) => {
          const steps = o.steps.filter((s) => s.phase === phase && (s.mine || s.who !== "person"));
          if (!steps.length) return null;
          return (
            <div key={phase}>
              <p className="font-medium">{phase} <span className="font-normal text-muted-foreground">· {steps.filter((s) => s.done).length} of {steps.length}</span></p>
              <ul className="mt-1 space-y-1">
                {steps.map((s) => (
                  <li key={s.stepId} className="flex flex-wrap items-center gap-2">
                    {s.mine && !s.done && s.taskId && s.kind !== "answer" ? <input type="checkbox" className="nb-check" aria-label={`Done: ${s.title}`} onChange={() => void tick(s.taskId!)} />
                      : <StatusBadge state={s.done ? "done" : "draft"}>{s.done ? "Done" : "To do"}</StatusBadge>}
                    <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.title}</span>
                    {!s.mine ? <span className="text-muted-foreground">· {WHO_WORD[s.who as StepWho]}</span> : null}
                    <span className="font-mono text-muted-foreground">{s.due}</span>
                  </li>
                ))}
              </ul>
              {steps.some((s) => s.mine && s.kind === "answer" && !s.done) && !o.answered ? (
                <span className="mt-2 flex flex-wrap gap-2">
                  <textarea className="nb-textarea min-w-[260px] flex-1" rows={2} maxLength={2000} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="How’s it going?" placeholder={`How’s it going? A few words for your ${lab ? "supervisor" : "line manager"}.`} />
                  <button type="button" className={FORM_PRIMARY_CLASS} disabled={!answer.trim()} onClick={() => void send()}>Send</button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </OrgCard>
  );
}

/** Members → Onboarding (admins, line managers, buddies): % done, overdue, buddy and start date; How's it going? for some. */
export function OnboardingBoard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["onboarding-board", orgId], queryFn: () => readOnboardingBoardAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading onboarding…</p>;
  if (!q.data?.success) return <ErrorNotice what="Onboarding" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const WHO_WORD = whoWords(d.lab ? "research" : null);
  const refresh = () => void client.invalidateQueries({ queryKey: ["onboarding-board", orgId] });
  const run = async (r: Promise<{ success: boolean; error?: string }>, ok: string) => { const x = await r; if (!x.success) return void toast.error(x.error ?? "Couldn’t save."); toast.success(ok); refresh(); };
  const names = new Map(d.staff.map((s) => [s.id, s.name]));
  if (!d.people.length) return <p className="py-6 text-[13px] text-muted-foreground">Nobody is onboarding. People who join after the onboarding plan is switched on in Settings show here.</p>;
  return (
    <ul className="grid gap-3 text-[13px] sm:grid-cols-2" data-testid="onboarding-board">
      {d.people.map((p) => (
        <li key={p.userId} className="space-y-2 rounded-md border border-border p-3">
          <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.name}</span>
            {p.complete ? <StatusBadge state="done">Onboarding complete</StatusBadge> : <span className="font-mono">{p.pct}%</span>}
            {p.overdue ? <StatusBadge state="at_risk">{p.overdue} overdue</StatusBadge> : null}</span>
          <span className="flex flex-wrap items-center gap-2">
            {d.admin ? <label className="flex items-center gap-1.5">Starts<Input type="date" defaultValue={p.start} aria-label={`${p.name} start date`} className="w-[150px] font-mono"
              onBlur={(e) => { if (e.target.value && e.target.value !== p.start) void run(setOnboardingStartAction(orgId, p.userId, e.target.value), "Start date moved; open steps moved with it"); }} /></label> : <span>Starts <span className="font-mono">{p.start}</span></span>}
            <label className="flex items-center gap-1.5">Buddy
              <select className="nb-select" data-size="sm" value={p.buddy ?? ""} aria-label={`${p.name}’s buddy`} onChange={(e) => e.target.value && void run(setBuddyAction(orgId, p.userId, e.target.value), "Buddy picked")}>
                <option value="">{p.buddy ? names.get(p.buddy) ?? "Buddy" : "Pick a buddy"}</option>{d.staff.filter((s) => s.id !== p.userId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          </span>
          <details><summary className="cursor-pointer text-muted-foreground">{p.steps.filter((s) => s.done).length} of {p.steps.length} steps</summary>
            <ul className="mt-1 space-y-0.5">{p.steps.map((s) => <li key={s.stepId} className="flex flex-wrap items-center gap-1.5"><StatusBadge state={s.done ? "done" : "draft"}>{s.done ? "Done" : "To do"}</StatusBadge> {s.title} <span className="text-muted-foreground">· {WHO_WORD[s.who as StepWho]} · <span className="font-mono">{s.due}</span></span></li>)}</ul></details>
          {p.answer ? <p><span className="font-medium">How’s it going?</span> {p.answer}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Settings → Onboarding plan (admins): steps by day with who, kind and Required; switch it on for people who join from now. */
export function OnboardingPlanSettings({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["onboarding-plan", orgId], queryFn: () => readOnboardingPlanAction(orgId), staleTime: 60_000 });
  const [plan, setPlan] = useState<PlanStep[] | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const WHO_WORD = whoWords(d.lab ? "research" : null);
  const rows = [...(plan ?? d.plan)].sort((a, b) => a.day - b.day);
  const isOn = on ?? d.on;
  const set = (id: string, patch: Partial<PlanStep>) => setPlan(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const save = async () => {
    const r = await saveOnboardingPlanAction(orgId, { plan: rows, on: isOn });
    if (!r.success) return void toast.error(r.error);
    toast.success(isOn ? "Onboarding plan saved — it starts for people who join from now" : "Onboarding plan saved");
    setPlan(null); setOn(null);
    void client.invalidateQueries({ queryKey: ["onboarding-plan", orgId] });
  };
  return (
    <SettingsCard title="Onboarding plan" headingLevel={2} description="Steps for each new person, counted from their start date. People already here never get them.">
      <div className="space-y-2 text-[13px]" data-testid="onboarding-plan">
        <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={isOn} onChange={(e) => setOn(e.target.checked)} />Onboard people who join from now on</label>
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <Input type="number" min={-14} max={90} value={r.day} aria-label={`Day for ${r.title}`} onChange={(e) => set(r.id, { day: Math.max(-14, Math.min(90, Number(e.target.value) || 0)) })} className="w-[80px] font-mono" />
              <select className="nb-select" data-size="sm" value={r.who} aria-label={`Who ${r.title} is for`} onChange={(e) => set(r.id, { who: e.target.value as StepWho })}>{(Object.keys(WHO_WORD) as StepWho[]).map((w) => <option key={w} value={w}>{WHO_WORD[w]}</option>)}</select>
              <select className="nb-select" data-size="sm" value={r.kind} aria-label={`Kind of ${r.title}`} onChange={(e) => set(r.id, { kind: e.target.value as StepKind })}>{(Object.keys(KIND_WORD) as StepKind[]).map((k) => <option key={k} value={k}>{KIND_WORD[k]}</option>)}</select>
              <Input value={r.title} maxLength={200} aria-label="Step title" onChange={(e) => set(r.id, { title: e.target.value })} className="min-w-[220px] flex-1" />
              <label className="flex items-center gap-1"><input type="checkbox" className="nb-check" checked={r.required} onChange={(e) => set(r.id, { required: e.target.checked })} />Required</label>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPlan(rows.filter((x) => x.id !== r.id))}>Remove<span className="sr-only"> {r.title}</span></button>
            </li>
          ))}
        </ul>
        <span className="flex gap-2">
          {rows.length < 60 ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPlan([...rows, { id: `s-${Math.random().toString(36).slice(2, 10)}`, day: 7, who: "person", kind: "do", title: "New step", required: false }])}>Add a step</button> : null}
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save the plan</button>
        </span>
        <p className="text-muted-foreground">Write {"{name}"} for the new person’s name. Day 0 is their start date.</p>
      </div>
    </SettingsCard>
  );
}
