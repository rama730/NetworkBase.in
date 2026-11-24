"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { archiveRubricAction, readMarkingAction, readMarkingSettingsAction, readMyMarkAction, saveCommentBankAction, saveMarkAction, saveRubricAction } from "@/app/actions/marks";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { DEFAULT_LEVELS, markText, rubricOutOf, type Rubric } from "@/lib/organizations/marks";
import { cn } from "@/lib/utils";

// Report 30.8 W7 (plan B1.5a): the Marking panel, the student's result, Settings → Marking and the composer's field.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";

/** The review queue's Marking panel: levels per criterion (keys 1–4 on the focused row) or a number; saved as you go. */
export function MarkingPanel({ copyId }: { copyId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["marking", copyId], queryFn: () => readMarkingAction(copyId), staleTime: 10_000 });
  const data = q.data?.success ? q.data : null;
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [total, setTotal] = useState("");
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.mark) return;
    setLevels(data.mark.levels ?? {});
    setTotal(String(data.mark.total));
    setComment(data.mark.comment ?? "");
  }, [data?.mark]);
  if (!data || data.marking.mode === "none") return null;
  if (data.excused) return <p className="text-[13px] text-muted-foreground">Excused · no mark.</p>;
  const m = data.marking;
  const save = async (next: { levels?: Record<string, number>; total?: number; comment?: string }) => {
    const r = await saveMarkAction(copyId, { levels: next.levels ?? levels, ...(m.mode === "outof" ? { total: next.total ?? Number(total) } : {}), comment: next.comment ?? comment });
    if (!r.success) { setSaved(null); if (!r.error.startsWith("Pick a level")) toast.error(r.error); return; }
    setSaved(markText(r.total, r.outOf));
    void client.invalidateQueries({ queryKey: ["my-mark", copyId] });
  };
  const live = m.mode === "rubric" ? m.rubric.criteria.reduce((n, c) => n + (levels[c.id] != null ? c.levels[levels[c.id]!]!.points : 0), 0) : Number(total) || 0;
  const outOf = m.mode === "rubric" ? rubricOutOf(m.rubric) : m.outOf;
  return (
    <section aria-label="Marking" className="space-y-2 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="marking-panel">
      {m.mode === "rubric" ? m.rubric.criteria.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{c.name}</span>
          <span role="radiogroup" aria-label={c.name} className="flex gap-1"
            onKeyDown={(e) => { const i = Number(e.key) - 1; if (i >= 0 && i < c.levels.length) { const next = { ...levels, [c.id]: i }; setLevels(next); void save({ levels: next }); } }}>
            {c.levels.map((l, i) => (
              <button key={l.label} type="button" role="radio" aria-checked={levels[c.id] === i} title={l.text || undefined}
                onClick={() => { const next = { ...levels, [c.id]: i }; setLevels(next); void save({ levels: next }); }}
                className={cn("nb-touch-target rounded-sm border border-border px-2 py-1 text-[12px]", levels[c.id] === i ? "bg-foreground font-semibold text-background" : "bg-card hover:bg-muted")}>
                {l.label} <span className="font-mono">{l.points}</span>
              </button>
            ))}
          </span>
        </div>
      )) : (
        <label className="flex items-center gap-2">Mark <Input type="number" min={0} max={m.outOf} aria-label={`Mark out of ${m.outOf}`} value={total} onChange={(e) => setTotal(e.target.value)}
          onBlur={() => { if (total !== "") void save({ total: Number(total) }); }} className="w-[90px]" /> / {m.outOf}</label>
      )}
      <textarea className="nb-textarea" rows={2} aria-label="Comment for the student" placeholder="Comment for the student" value={comment} onChange={(e) => setComment(e.target.value)} onBlur={() => void save({ comment })} />
      {data.commentBank.length ? (
        <p className="flex flex-wrap gap-1.5" aria-label="Comment bank">{data.commentBank.map((line) => (
          <button key={line} type="button" className="rounded-sm border border-border px-2 py-0.5 text-[12px] hover:bg-muted" onClick={() => { const next = comment ? `${comment} ${line}` : line; setComment(next); void save({ comment: next }); }}>{line}</button>
        ))}</p>
      ) : null}
      <p className="font-mono text-[12px]" aria-live="polite" data-testid="marking-total">Total {live} / {outOf} · {outOf ? Math.round((live / outOf) * 100) : 0}%{saved ? " · saved" : ""}
        <span className="ml-2 font-sans text-muted-foreground">{data.mark?.visible ? "Visible to the student" : "Hidden until you approve"} · Marked {data.progress.marked} of {data.progress.total}</span></p>
    </section>
  );
}

/** The student's result in their hand-in: "21 / 30 · 70%", the levels and the comment, once approved. */
export function MyMarkCard({ copyId }: { copyId: string }) {
  const q = useQuery({ queryKey: ["my-mark", copyId], queryFn: () => readMyMarkAction(copyId), staleTime: 30_000 });
  const data = q.data?.success ? q.data : null;
  if (!data?.mark || !data.marking) return null;
  const mk = data.mark;
  const rubric = data.marking.mode === "rubric" ? data.marking.rubric : null;
  return (
    <div className="space-y-1 rounded-md bg-muted px-3 py-2.5" data-testid="my-mark" aria-label="Mark">
      <p className="text-[13px]"><span className="font-semibold">Mark </span><span className="font-mono text-[15px] font-semibold">{markText(mk.total, mk.outOf)}</span>{mk.marker ? <span className="text-muted-foreground"> · marked by {mk.marker}</span> : null}</p>
      {rubric ? <p className="text-[13px] text-muted-foreground">{rubric.criteria.map((c) => `${c.name} ${mk.levels[c.id] != null ? c.levels[mk.levels[c.id]!]!.label : "—"}`).join(" · ")}</p> : null}
      {mk.comment ? <p className="whitespace-pre-wrap text-[13px]">“{mk.comment}”</p> : null}
    </div>
  );
}

/** Settings → Marking (staff; the Teacher edits): rubric library and comment bank. */
export function MarkingSettingsCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["marking-settings", orgId], queryFn: () => readMarkingSettingsAction(orgId), staleTime: 30_000 });
  const data = q.data?.success ? q.data : null;
  const [editing, setEditing] = useState<{ id?: string; name: string; criteria: Array<{ id?: string; name: string }> } | null>(null);
  const [bank, setBank] = useState<string | null>(null);
  if (!data) return null;
  const refresh = () => client.invalidateQueries({ queryKey: ["marking-settings", orgId] });
  const saveRubric = async () => {
    const r = await saveRubricAction(orgId, { id: editing!.id, name: editing!.name, criteria: editing!.criteria.map((c) => ({ id: c.id, name: c.name, levels: (data.rubrics.find((x) => x.id === editing!.id)?.criteria.find((x) => x.id === c.id)?.levels) ?? DEFAULT_LEVELS })) });
    if (!r.success) return void toast.error(r.error);
    toast.success("Rubric saved");
    setEditing(null);
    await refresh();
  };
  return (
    <section id="project-settings-marking" data-project-settings-section className="space-y-6">
      <SettingsCard title="Marking" headingLevel={2} description="Rubrics for assignments and a comment bank. A rubric is copied onto an assignment when it's saved, so later edits never change old marks.">
        <div className="space-y-4 text-[13px]" data-testid="marking-settings">
          <ul className="space-y-1">
            {data.rubrics.map((r: Rubric) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className={cn(r.archived && "text-muted-foreground")}>{r.name} <span className="nb-meta font-mono">{r.criteria.length} criteria · out of {rubricOutOf(r)}</span>{r.archived ? " · archived" : ""}</span>
                {data.teacher ? <span className="flex gap-3">
                  <button type="button" className={LINK} onClick={() => setEditing({ id: r.id, name: r.name, criteria: r.criteria.map((c) => ({ id: c.id, name: c.name })) })}>Edit<span className="sr-only"> {r.name}</span></button>
                  <button type="button" className={LINK} onClick={() => void archiveRubricAction(orgId, r.id, !r.archived).then(() => refresh())}>{r.archived ? "Restore" : "Archive"}<span className="sr-only"> {r.name}</span></button>
                </span> : null}
              </li>
            ))}
            {data.rubrics.length === 0 ? <li className="text-muted-foreground">No rubrics yet.</li> : null}
          </ul>
          {data.teacher && !editing ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing({ name: "", criteria: [{ name: "" }] })}>New rubric</button> : null}
          {editing ? (
            <div className="space-y-2 rounded-md border border-border p-3" data-testid="rubric-editor">
              <Input aria-label="Rubric name" value={editing.name} maxLength={80} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Lab rubric" />
              {editing.criteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input aria-label={`Criterion ${i + 1}`} value={c.name} maxLength={80} onChange={(e) => setEditing({ ...editing, criteria: editing.criteria.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Correctness" />
                  <button type="button" className={LINK} onClick={() => setEditing({ ...editing, criteria: editing.criteria.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> criterion {i + 1}</span></button>
                </div>
              ))}
              <p className="text-[12px] text-muted-foreground">Each criterion has Excellent 10 · Good 7 · Fair 4 · Missing 0.</p>
              <span className="flex gap-2">
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing({ ...editing, criteria: [...editing.criteria, { name: "" }] })}>Add a criterion</button>
                <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void saveRubric()}>Save rubric</button>
                <button type="button" className={LINK} onClick={() => setEditing(null)}>Cancel</button>
              </span>
            </div>
          ) : null}
          <label className="flex flex-col gap-1.5"><span className="font-medium">Comment bank</span><span className="text-[12px] text-muted-foreground">One line each; they show as chips while marking.</span>
            <textarea className="nb-textarea" rows={3} aria-label="Comment bank" value={bank ?? data.commentBank.join("\n")} onChange={(e) => setBank(e.target.value)} />
          </label>
          {bank !== null ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void saveCommentBankAction(orgId, bank.split("\n")).then((r) => { if (!r.success) return void toast.error(r.error); toast.success("Comment bank saved"); setBank(null); void refresh(); })}>Save comment bank</button> : null}
        </div>
      </SettingsCard>
    </section>
  );
}
