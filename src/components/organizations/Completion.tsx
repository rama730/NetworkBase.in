"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";

import { readCompletionAction, readCompletionLineAction, recordCompletionAction } from "@/app/actions/cohort-completion";
import { moveToLaterCohortAction, readLaterCohortsAction } from "@/app/actions/cohort-move";
import { StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 31.2 C1 calls 5–7 (plan B2.1b, B2.1c): Members → Completion. Staff record it from the end date and move a
// learner to a later cohort; a learner sees theirs.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const key = (orgId: string) => ["cohort-completion", orgId] as const;
const useCompletion = (orgId: string) => useQuery({ queryKey: key(orgId), queryFn: () => readCompletionAction(orgId), staleTime: 30_000 });

type Choice = { completed: boolean; reason: string };

export function CompletionView({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useCompletion(orgId);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading completion…</p>;
  const data = q.data;
  if (!data?.success) return <ErrorNotice what="Completion" onRetry={() => void q.refetch()} />;
  const ends = data.termEnd ? DAY.format(new Date(`${data.termEnd}T00:00:00Z`)) : null;

  if (!data.staff) {
    const me = data.learners[0];
    if (!me) return null;
    return (
      <div className="space-y-2 rounded-md border border-border p-4 text-[13px]" data-testid="my-completion">
        <p className="flex items-center gap-2 font-medium">
          {me.record ? <StatusBadge state={me.record.completed ? "done" : "archived"}>{me.record.completed ? "Completed" : "Not completed"}</StatusBadge> : <span>Not recorded yet</span>}
        </p>
        {me.record?.completed ? <p className="flex items-center gap-1.5 text-muted-foreground"><BadgeCheck className="size-4" aria-hidden="true" />It’s on your profile as a verified entry.</p> : null}
        {!me.record ? <p className="text-muted-foreground">{me.required ? `${me.approved} of ${me.required} assignments approved` : "No assignments yet"}{me.minimum != null ? ` · attendance ${me.attendance ?? 0}% (needs ${me.minimum}%)` : ""}{ends ? ` · recorded after ${ends}` : ""}</p> : null}
      </div>
    );
  }

  const choice = (id: string, meets: boolean, record: { completed: boolean; reason: string | null } | null): Choice =>
    choices[id] ?? { completed: record ? record.completed : meets, reason: record?.reason ?? "" };
  const save = async () => {
    setBusy(true);
    const r = await recordCompletionAction(orgId, data.learners.map((l) => { const c = choice(l.id, l.meets, l.record); return { userId: l.id, completed: c.completed, reason: c.reason || null }; }));
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(`Recorded: ${r.completed} completed, ${r.notCompleted} not completed`);
    setChoices({});
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <section aria-label="Completion" className="space-y-3" data-testid="completion">
      <p className="text-[13px] text-muted-foreground">
        {data.line ?? "Completed means every assignment approved, and attendance at or above the minimum when it’s on."}
        {!data.open && ends ? ` Recording opens on ${ends}.` : ""}
      </p>
      {data.learners.length === 0 ? <p className="text-[13px] text-muted-foreground">No learners yet.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-[13px]">
          {data.learners.map((l) => {
            const c = choice(l.id, l.meets, l.record);
            const override = c.completed !== l.meets;
            return (
              <li key={l.id} className="space-y-1.5 px-4 py-2.5" data-testid="completion-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium">{l.name}</span>
                    <span className="nb-meta ml-2 font-mono">{l.approved}/{l.required} approved{l.minimum != null ? ` · ${l.attendance ?? 0}%` : ""}</span>
                    {l.meets ? null : <span className="ml-2 text-muted-foreground">{l.reasons.join(" · ")}</span>}
                  </span>
                  {data.canRecord && data.open ? (
                    <select className="nb-select" data-size="sm" aria-label={`Completion for ${l.name}`} value={c.completed ? "yes" : "no"}
                      onChange={(e) => setChoices({ ...choices, [l.id]: { ...c, completed: e.target.value === "yes" } })}>
                      <option value="yes">Completed</option><option value="no">Not completed</option>
                    </select>
                  ) : l.record ? <StatusBadge state={l.record.completed ? "done" : "archived"}>{l.record.completed ? "Completed" : "Not completed"}</StatusBadge> : null}
                </div>
                {data.canRecord ? <MoveLater orgId={orgId} learner={l} /> : null}
                {data.canRecord && data.open && override ? (
                  <Input value={c.reason} maxLength={500} aria-label={`Why, for ${l.name}`} placeholder={c.completed ? "Why they completed without meeting the rule" : "Why they didn’t complete"}
                    onChange={(e) => setChoices({ ...choices, [l.id]: { ...c, reason: e.target.value } })} />
                ) : l.record && !l.record.byRule && l.record.reason ? <p className="text-[12px] text-muted-foreground">Override: {l.record.reason}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      {data.canRecord && data.open && data.learners.length ? <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void save()}>Record completion</button> : null}
    </section>
  );
}

/** Move to a later cohort (call 7): open work here is Excused, finished work stays, they join the later cohort. */
function MoveLater({ orgId, learner }: { orgId: string; learner: { id: string; name: string } }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const later = useQuery({ queryKey: ["later-cohorts", orgId], queryFn: () => readLaterCohortsAction(orgId), enabled: open, staleTime: 60_000 });
  if (!open) return <button type="button" className={LINK} onClick={() => setOpen(true)}>Move to a later cohort<span className="sr-only"> for {learner.name}</span></button>;
  const list = later.data?.success ? later.data.cohorts : [];
  const move = async () => {
    setBusy(true);
    const r = await moveToLaterCohortAction(orgId, learner.id, to);
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(`${learner.name} moved${r.excused ? `; ${r.excused} open ${r.excused === 1 ? "assignment" : "assignments"} here excused` : ""}`);
    setOpen(false);
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="move-later">
      {later.isPending ? <span className="text-muted-foreground">Loading cohorts…</span> : list.length === 0 ? <span className="text-muted-foreground">No later cohort of this program that you teach.</span> : (
        <select className="nb-select" data-size="sm" aria-label={`Later cohort for ${learner.name}`} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Pick a cohort</option>
          {list.map((c) => <option key={c.id} value={c.id} disabled={c.seatsLeft <= 0}>{c.title}{c.start ? ` · starts ${DAY.format(new Date(`${c.start}T00:00:00Z`))}` : ""}{c.seatsLeft <= 0 ? " · full" : ""}</option>)}
        </select>
      )}
      <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !to} onClick={() => void move()}>Move</button>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setOpen(false)}>Cancel</button>
      <p className="w-full text-[12px] text-muted-foreground">Finished work stays here; open assignments here are excused; they can still read this cohort.</p>
    </div>
  );
}

/** Overview, after the cohort ends: "Completion 24 of 28" for staff. */
export function CompletionLine({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: [...key(orgId), "line"], queryFn: () => readCompletionLineAction(orgId), staleTime: 60_000 });
  const line = q.data;
  return line ? <p className="flex items-center gap-2 text-[13px]" data-testid="completion-line"><BadgeCheck className="size-4 text-muted-foreground" aria-hidden="true" />{line}</p> : null;
}
