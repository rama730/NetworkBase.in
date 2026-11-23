"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { readRoadmapAction, setRoadmapFieldsAction, wontDoAction } from "@/app/actions/roadmap";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, SectionDivider, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { COLUMN_LABEL, COLUMNS, ITEM_TYPE_LABEL, ITEM_TYPES, MILESTONES } from "@/lib/workflows/roadmap";

/** Report 38.9 W2, S6 (plan A2.10): the New module's Roadmap details, the item panel section, Won't do. */
export const roadmapKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "roadmap"];
export const useRoadmap = (projectId: string) => {
  const q = useQuery({ queryKey: roadmapKey(projectId), queryFn: () => readRoadmapAction(projectId), refetchInterval: 30_000 });
  return { query: q, data: q.data?.success ? q.data : null };
};

/** W2: outcome, column, type (and a Milestone's name). Priority and the target date are the module's own fields. */
export function RoadmapDetailsFields({ initialColumn = "next" }: { initialColumn?: string }) {
  const [type, setType] = useState("feature");
  return (
    <div className="space-y-3.5" data-testid="roadmap-details">
      <SectionDivider title="Roadmap details" />
      <Field label="Outcome (optional)" htmlFor="roadmap-outcome">
        <input id="roadmap-outcome" name="roadmapOutcome" maxLength={200} placeholder="What changes for people" className={inputClassName(false)} />
      </Field>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Field label="Column" htmlFor="roadmap-column"><SelectWrap><select id="roadmap-column" name="roadmapColumn" defaultValue={initialColumn} className={selectClassName()}>
          {COLUMNS.map((c) => <option key={c} value={c}>{COLUMN_LABEL[c]}</option>)}
        </select></SelectWrap></Field>
        <Field label="Type" htmlFor="roadmap-type"><SelectWrap><select id="roadmap-type" name="roadmapType" value={type} onChange={(e) => setType(e.target.value)} className={selectClassName()}>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>)}
        </select></SelectWrap></Field>
        {type === "milestone" ? (
          <Field label="Milestone" htmlFor="roadmap-milestone"><SelectWrap><select id="roadmap-milestone" name="roadmapMilestone" className={selectClassName()}>
            {MILESTONES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></SelectWrap></Field>
        ) : null}
      </div>
    </div>
  );
}

export function readRoadmapFields(form: FormData) {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  return {
    ...(text("roadmapOutcome") ? { outcome: text("roadmapOutcome") } : {}),
    ...(text("roadmapColumn") ? { column: text("roadmapColumn") } : {}),
    ...(text("roadmapType") ? { itemType: text("roadmapType") } : {}),
    ...(text("roadmapType") === "milestone" && text("roadmapMilestone") ? { milestone: text("roadmapMilestone") } : {}),
  };
}

/** S6: Roadmap details in the panel: outcome, column, type, Built by, progress; Won't do with a reason. */
export function RoadmapPanelSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const { data, query } = useRoadmap(projectId);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-20 rounded-[6px]" /> : null;
  const item = data.items.find((i) => i.id === taskId);
  if (!item) return null;
  const f = item.typeFields;
  const builtBy = Array.isArray(f.builtBy) ? (f.builtBy as string[]) : [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  async function save(fields: Record<string, unknown>, done: string) {
    setBusy(true);
    const r = await setRoadmapFieldsAction({ projectId, taskId, fields: fields as never });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast(done);
    await refresh();
  }
  const closed = item.stage === "launched" || item.stage === "wont_do";
  return (
    <div className="space-y-2 pt-1" data-testid="roadmap-panel">
      <div className="border-b border-border/60 pb-2"><h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Roadmap details</h3></div>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Outcome</dt>
        <dd>{data.canEdit ? <input aria-label="Outcome" defaultValue={String(f.outcome ?? "")} maxLength={200} placeholder="What changes for people" disabled={busy}
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(f.outcome ?? "")) void save({ outcome: v }, "Outcome saved"); }} className={cn(inputClassName(false), "h-8 text-[13px]")} /> : String(f.outcome ?? "—")}</dd>
        <dt className="text-muted-foreground">Column</dt>
        <dd>{closed ? "Off the roadmap board" : COLUMN_LABEL[f.column as keyof typeof COLUMN_LABEL] ?? "None yet"}</dd>
        <dt className="text-muted-foreground">Type</dt>
        <dd>{data.canEdit ? <SelectWrap><select aria-label="Type" value={String(f.itemType ?? "feature")} disabled={busy} className={cn(selectClassName(), "h-8 text-[13px]")}
          onChange={(e) => void save(e.target.value === "milestone" ? { itemType: e.target.value, milestone: MILESTONES[0] } : { itemType: e.target.value, milestone: null }, "Type changed")}>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>)}
        </select></SelectWrap> : ITEM_TYPE_LABEL[f.itemType as keyof typeof ITEM_TYPE_LABEL] ?? "Feature"}</dd>
        {f.itemType === "milestone" ? <><dt className="text-muted-foreground">Milestone</dt>
          <dd>{data.canEdit ? <SelectWrap><select aria-label="Milestone" value={String(f.milestone ?? MILESTONES[0])} disabled={busy} className={cn(selectClassName(), "h-8 text-[13px]")} onChange={(e) => void save({ milestone: e.target.value }, "Milestone changed")}>
            {MILESTONES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></SelectWrap> : String(f.milestone ?? "—")}</dd></> : null}
        <dt className="text-muted-foreground">Built by</dt>
        <dd className="space-y-1" data-testid="roadmap-built-by">
          {builtBy.map((pid) => { const p = data.projects.find((x) => x.id === pid); return (
            <p key={pid} className="flex items-center gap-2">{p?.title ?? "A removed project"}
              {data.canEdit ? <button type="button" className="text-[12px] text-muted-foreground hover:underline" disabled={busy} onClick={() => void save({ builtBy: builtBy.filter((x) => x !== pid) }, "Project unlinked")}>Remove</button> : null}</p>
          ); })}
          {data.canEdit && data.projects.some((p) => !builtBy.includes(p.id)) ? (
            <SelectWrap><select aria-label="Link a project" value="" disabled={busy} className={cn(selectClassName(), "h-8 text-[13px]")} onChange={(e) => { if (e.target.value) void save({ builtBy: [...builtBy, e.target.value] }, "Project linked"); }}>
              <option value="">Link a project…</option>
              {data.projects.filter((p) => !builtBy.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select></SelectWrap>
          ) : !builtBy.length ? "—" : null}
        </dd>
        <dt className="text-muted-foreground">Progress</dt>
        <dd className="font-mono text-[12px]" data-testid="roadmap-progress">{item.progress === null ? "No work yet" : `${item.progress}% · ${item.workCount - item.openWork} of ${item.workCount} work tasks done`}</dd>
        {item.stage === "wont_do" && f.wontDoReason ? <><dt className="text-muted-foreground">Won’t do</dt><dd className="whitespace-pre-wrap">{String(f.wontDoReason)}</dd></> : null}
      </dl>
      {data.canEdit && !closed ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setClosing(true)}>Won’t do…</button> : null}
      {closing ? <WontDoDialog openWork={item.openWork} busy={busy} onClose={() => setClosing(false)} onSave={async (reason) => {
        setBusy(true);
        const r = await wontDoAction({ projectId, taskId, reason });
        setBusy(false);
        if (!r.success) return void toast.error(r.error);
        setClosing(false);
        toast(r.openWork ? `Won’t do · ${r.openWork} open work ${r.openWork === 1 ? "task stays" : "tasks stay"} as ${r.openWork === 1 ? "it is" : "they are"}` : "Won’t do");
        await refresh();
      }} /> : null}
    </div>
  );
}

function WontDoDialog({ openWork, busy, onClose, onSave }: { openWork: number; busy: boolean; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="wont-do-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Won’t do</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{openWork ? `Its ${openWork} open work ${openWork === 1 ? "task stays" : "tasks stay"} on the board; move ${openWork === 1 ? "it" : "them"} yourself if needed.` : "It leaves the roadmap board and keeps its history."}</DialogDescription></div>
        <div className="px-6 py-4"><Field label="Why not?" htmlFor="wont-do-reason"><textarea id="wont-do-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className={cn(inputClassName(false), "resize-none py-2")} /></Field></div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !reason.trim()} onClick={() => onSave(reason.trim())}>Won’t do</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
