"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { commentReviewAction, decideReviewAction, markConcernReadAction, raiseConcernAction, readConcernsAction, readLabCountsAction, readPlanAction, readReviewAction,
  saveProgressReportAction, savePlanAction } from "@/app/actions/lab-reviews";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 35.6 (plan B6.5c, R5 calls 5–9): the annual review, the development plan, Raise a concern, and the PI's counts.
// No ratings, scores or rankings anywhere; review states as words.
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const STATE_WORDS = { writing: "Writing", with_supervisor: "With supervisor", with_committee: "With committee", agreed: "Agreed" } as const;
const REPORT = [["did", "What I did"], ["outputs", "Outputs"], ["trainings", "Trainings"], ["plan", "Plan for next year"], ["worries", "Anything worrying me"]] as const;
type ReportKey = (typeof REPORT)[number][0];

/** An annual review: the person writes the Progress report; the supervisor gives feedback, a committee comments, next steps are agreed. */
export function AnnualReview({ orgId, userId, milestoneKey }: { orgId: string; userId: string; milestoneKey: string }) {
  const q = useQuery({ queryKey: ["lab-review", orgId, userId, milestoneKey], queryFn: () => readReviewAction(orgId, userId, milestoneKey) });
  const d = q.data?.success ? q.data : null;
  const [report, setReport] = useState<Record<ReportKey, string> | null>(null);
  const [decide, setDecide] = useState({ feedback: "", committeeIds: [] as string[], nextSteps: "" });
  const [comment, setComment] = useState("");
  if (!d) return null;
  const r = d.review;
  const state = r?.state ?? "writing";
  const refresh = () => void q.refetch();
  const filled: Record<ReportKey, string> = report ?? {
    did: r?.report.did ?? "", outputs: r?.report.outputs ?? d.pulled.outputs.join("\n"), trainings: r?.report.trainings ?? d.pulled.trainings.join("\n"), plan: r?.report.plan ?? "", worries: r?.report.worries ?? "" };
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const res = await safe(x); if (!res.success) return void toast.error(res.error ?? "Couldn’t save that."); toast.success(ok); refresh(); };
  const writing = d.self && state === "writing";
  return (
    <section aria-label={`${d.milestone.name} for ${d.person.name}`} className="space-y-2 rounded-md border border-border p-3 text-[13px]" data-testid="lab-annual-review">
      <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{d.milestone.name}</span><StatusBadge state={state === "agreed" ? "done" : state === "writing" ? "draft" : "active"}>{STATE_WORDS[state]}</StatusBadge></p>
      <h4 className="nb-micro">Progress report</h4>
      {REPORT.map(([k, label]) => (
        writing ? <label key={k} className="flex flex-col">{label}<textarea className="nb-textarea mt-0.5 text-[13px]" rows={k === "did" ? 3 : 2} maxLength={6000} value={filled[k]} onChange={(e) => setReport({ ...filled, [k]: e.target.value })} /></label>
          : filled[k] ? <p key={k}><span className="text-muted-foreground">{label} </span><span className="whitespace-pre-wrap">{filled[k]}</span></p> : null))}
      {writing ? <span className="flex gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(saveProgressReportAction(orgId, d.milestone.key, filled, false), "Saved")}>Save</button>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(saveProgressReportAction(orgId, d.milestone.key, filled, true), "Handed in; your supervisor is told")}>Hand in</button></span> : null}
      {r?.feedback ? <p><span className="text-muted-foreground">Supervisor’s feedback </span><span className="whitespace-pre-wrap">{r.feedback}</span></p> : null}
      {r?.comments.length ? <ul className="space-y-0.5">{r.comments.map((c, i) => <li key={i}><span className="text-muted-foreground">{c.by}: </span>{c.text}</li>)}</ul> : null}
      {r?.nextSteps ? <p><span className="font-medium">Agreed next steps </span><span className="whitespace-pre-wrap">{r.nextSteps}</span></p> : null}
      {d.sup && (state === "with_supervisor" || state === "with_committee") ? (
        <fieldset className="space-y-1.5 border-t border-border pt-2" data-testid="lab-review-decide">
          <label className="flex flex-col">Feedback<textarea className="nb-textarea mt-0.5 text-[13px]" rows={3} maxLength={10000} value={decide.feedback || r?.feedback || ""} onChange={(e) => setDecide({ ...decide, feedback: e.target.value })} /></label>
          {state === "with_supervisor" ? <label className="flex flex-col">Committee (optional, up to 5)<select multiple className="nb-select mt-0.5 h-24" value={decide.committeeIds}
            onChange={(e) => setDecide({ ...decide, committeeIds: [...e.target.selectedOptions].map((o) => o.value).slice(0, 5) })}>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : null}
          <label className="flex flex-col">Agreed next steps<textarea className="nb-textarea mt-0.5 text-[13px]" rows={2} maxLength={4000} value={decide.nextSteps} onChange={(e) => setDecide({ ...decide, nextSteps: e.target.value })} /></label>
          <span className="flex gap-2">
            {state === "with_supervisor" && decide.committeeIds.length ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(decideReviewAction(orgId, userId, d.milestone.key, { ...decide, feedback: decide.feedback || r?.feedback || "", nextSteps: "" }), "Sent to the committee")}>Send to the committee</button> : null}
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!decide.nextSteps.trim()} onClick={() => void run(decideReviewAction(orgId, userId, d.milestone.key, { feedback: decide.feedback || r?.feedback || "", committeeIds: [], nextSteps: decide.nextSteps }), "Review agreed")}>Agree next steps</button>
          </span>
        </fieldset>) : null}
      {d.committee ? <span className="flex flex-wrap items-center gap-2"><Input value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} aria-label="Your comment" placeholder="Your comment" className="min-w-[240px] flex-1" />
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={!comment.trim()} onClick={() => void run(commentReviewAction(orgId, userId, d.milestone.key, comment), "Comment added").then(() => setComment(""))}>Comment</button></span> : null}
      <p className="text-muted-foreground">No ratings or scores: feedback in words and agreed next steps.</p>
    </section>
  );
}

/** The development plan (call 7): up to 3 goals a year, career aims, About me; the person writes it, their supervisors read it. */
export function DevelopmentPlan({ orgId, userId, self }: { orgId: string; userId: string; self: boolean }) {
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: ["lab-plan", orgId, userId, year], queryFn: () => readPlanAction(orgId, self ? null : userId, year) });
  const [f, setF] = useState<{ goals: string[]; careerAims: string; aboutMe: string } | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const plan = f ?? { goals: d.plan?.goals ?? [], careerAims: d.plan?.careerAims ?? "", aboutMe: d.plan?.aboutMe ?? "" };
  if (!self) return (
    <section aria-label="Development plan" className="space-y-1"><h3 className="nb-micro">Development plan {year}</h3>
      {d.plan ? <>{d.plan.goals.length ? <ol className="list-decimal pl-5">{d.plan.goals.map((g) => <li key={g}>{g}</li>)}</ol> : null}
        {d.plan.careerAims ? <p><span className="text-muted-foreground">Career aims </span>{d.plan.careerAims}</p> : null}</> : <p className="text-muted-foreground">No plan for {year} yet.</p>}</section>);
  const goals = [...plan.goals, "", "", ""].slice(0, 3);
  const save = async () => { const r = await safe(savePlanAction(orgId, { year, goals: goals.map((g) => g.trim()).filter(Boolean), careerAims: plan.careerAims, aboutMe: plan.aboutMe }));
    if (!r.success) return void toast.error(r.error); toast.success("Plan saved"); setF(null); void q.refetch(); };
  return (
    <fieldset className="space-y-1.5" data-testid="lab-plan"><legend className="nb-micro">Development plan {year} <span className="normal-case">(you and your supervisors)</span></legend>
      {goals.map((g, i) => <Input key={i} value={g} maxLength={300} onChange={(e) => setF({ ...plan, goals: goals.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Goal ${i + 1}`} placeholder={`Goal ${i + 1}`} />)}
      <label className="flex flex-col">Career aims<Input value={plan.careerAims} maxLength={2000} onChange={(e) => setF({ ...plan, careerAims: e.target.value })} className="mt-0.5" /></label>
      <label className="flex flex-col">About me (optional)<textarea className="nb-textarea mt-0.5 text-[13px]" rows={2} maxLength={4000} value={plan.aboutMe} onChange={(e) => setF({ ...plan, aboutMe: e.target.value })} /></label>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save()}>Save plan</button>
    </fieldset>
  );
}

/** Raise a concern (call 8): private to whoever receives it; never to the person it's about. Received concerns, for the receiver only. */
export function ConcernsCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-concerns", orgId], queryFn: () => readConcernsAction(orgId), staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ to: "", about: "", body: "" });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const send = async () => {
    const r = await safe(raiseConcernAction(orgId, { to: f.to, about: f.about || null, body: f.body }));
    if (!r.success) return void toast.error(r.error);
    toast.success("Sent. Only they can read it.");
    setOpen(false); setF({ to: "", about: "", body: "" }); void q.refetch();
  };
  return (
    <OrgCard title="Raise a concern" testId="lab-concerns" action={!open && d.receivers.length ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setOpen(true)}>Raise a concern</button> : null}>
      <div className="space-y-2 text-[13px]">
        <p className="text-muted-foreground">Private to the person you send it to. It never goes to the person it’s about.</p>
        {open ? <fieldset className="space-y-1.5" data-testid="lab-concern-form">
          <label className="flex flex-col">It’s about (optional)<select className="nb-select mt-0.5" value={f.about} onChange={(e) => setF({ ...f, about: e.target.value, to: f.to === e.target.value ? "" : f.to })}>
            <option value="">Not about a person</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="flex flex-col">Send it to<select className="nb-select mt-0.5" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
            <option value="">Pick someone</option>{d.receivers.filter((r) => r.id !== f.about).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}</select></label>
          <label className="flex flex-col">What’s worrying you<textarea className="nb-textarea mt-0.5 text-[13px]" rows={3} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
          <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.to || !f.body.trim()} onClick={() => void send()}>Send</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setOpen(false)}>Cancel</button></span>
        </fieldset> : null}
        {d.received.length ? <section aria-label="Concerns sent to you"><h3 className="nb-micro">Sent to you</h3>
          <ul className="mt-1 space-y-1.5">{d.received.map((c) => <li key={c.id} className="rounded-md border border-border px-3 py-2">
            <p className="text-muted-foreground">{c.from ?? "A former member"}{c.about ? ` · about ${c.about}` : ""}{c.read ? "" : " · New"}</p><p className="whitespace-pre-wrap">{c.body}</p>
            {!c.read ? <button type="button" className="nb-link" onClick={() => void safe(markConcernReadAction(orgId, c.id)).then(() => q.refetch())}>Mark read</button> : null}</li>)}</ul></section> : null}
        {d.sent.length ? <p className="text-muted-foreground">You sent {d.sent.length === 1 ? "one concern" : `${d.sent.length} concerns`}; {d.sent.filter((s) => s.read).length} read.</p> : null}
      </div>
    </OrgCard>
  );
}

/** The PI's counts (call 9): three numbers; each opens its list. Never a ranking. */
export function LabCountsCard({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState<"gaps" | "milestones" | "reviews" | null>(null);
  const q = useQuery({ queryKey: ["lab-counts", orgId, open], queryFn: () => readLabCountsAction(orgId, open ?? undefined), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const items = [["gaps", d.counts.gaps, "supervision gaps over 4 weeks"], ["milestones", d.counts.milestones, "milestones in the next 60 days"], ["reviews", d.counts.reviews, "overdue annual reviews"]] as const;
  return (
    <OrgCard title="Supervision at a glance" testId="lab-counts">
      <div className="space-y-2 text-[13px]">
        <span className="flex flex-wrap gap-2">{items.map(([k, n, label]) => (
          <button key={k} type="button" aria-pressed={open === k} className="nb-tag h-auto px-2.5 py-1.5" onClick={() => setOpen(open === k ? null : k)}><span className="font-mono font-medium">{n}</span>&nbsp;{label}</button>))}</span>
        {open && d.list ? (d.list.length ? <ul className="divide-y divide-border rounded-md border border-border">{d.list.map((x, i) => <li key={i} className="px-3 py-1.5"><span className="font-medium">{x.name}</span> · {x.line}</li>)}</ul>
          : <p className="text-muted-foreground">None.</p>) : null}
      </div>
    </OrgCard>
  );
}
