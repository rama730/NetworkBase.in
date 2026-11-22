"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { readBugAction, seeTooAction, setBugFieldsAction, similarBugsAction } from "@/app/actions/bugs";
import { Field, inputClassName, SectionDivider, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { SEVERITIES, whereLabel, type Where } from "@/lib/workflows/bugs";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";

/** Report 38.6 S6 and W2–W3 (plan A2.1): the report form's Similar open bugs and Bug details. */
export const BROWSERS = ["Chrome", "Safari", "Firefox", "Edge", "Other"];
export const PLATFORMS = ["iOS", "Android", "macOS", "Windows", "Linux"];
const stageLabel = (s: string) => WORKFLOW_TYPES.bug!.stages.find((x) => x.key === s)?.label ?? s;

/** Shown after 4 typed characters, 300 ms after typing stops; "That's my bug" adds you to it and closes the form. */
export function BugSimilar({ projectId, title, projectKey, onMine }: { projectId: string; title: string; projectKey?: string | null; onMine: () => void }) {
  const [query, setQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setQuery(title.trim()), 300); return () => clearTimeout(t); }, [title]);
  const similar = useQuery({ queryKey: ["similar-bugs", projectId, query], queryFn: () => similarBugsAction({ projectId, title: query }), enabled: query.length >= 4, staleTime: 30_000 });
  const bugs = similar.data?.success ? similar.data.bugs : [];
  if (query.length < 4 || !bugs.length) return null;
  const name = (n: number | null) => (n && projectKey ? `${projectKey}-${n}` : n ? `#${n}` : "it");
  async function mine(bug: (typeof bugs)[number]) {
    const r = await seeTooAction({ projectId, taskId: bug.id, on: true });
    if (!r.success) return void toast.error(r.error);
    toast(`Added you to ${name(bug.taskNumber)}`, { duration: 10_000, action: { label: "Undo", onClick: () => void seeTooAction({ projectId, taskId: bug.id, on: false }) } });
    onMine();
  }
  return (
    <section aria-label="Similar open bugs" className="rounded-[6px] border border-border bg-muted/30 p-2" data-testid="similar-bugs">
      <h3 className="px-1 pb-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Similar open bugs</h3>
      <ul className="space-y-1">
        {bugs.map((b) => (
          <li key={b.id} className="flex min-h-9 items-center gap-2 rounded-[4px] bg-card px-2 text-[13px]">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{name(b.taskNumber)}</span>
            <span className="min-w-0 flex-1 truncate">{b.title}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{stageLabel(b.stage)}{b.seen ? ` · ${b.seen} see it` : ""}</span>
            {b.mine ? <span className="shrink-0 text-[11px] text-muted-foreground">Yours</span>
              : <button type="button" onClick={() => void mine(b)} className="h-7 shrink-0 rounded-[5px] border border-border px-2 text-xs font-medium hover:bg-muted">That’s my bug</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** W2.3: What happened? · What did you expect? · Where · Found in · Severity (Not sure by default). Uncontrolled inputs. */
export function BugDetailsFields() {
  const [kind, setKind] = useState<Where["kind"]>("web");
  const [severity, setSeverity] = useState<string>("");
  return (
    <div className="space-y-3.5" data-testid="bug-details">
      <SectionDivider title="Bug details" />
      <Field label="What happened?" htmlFor="bug-steps">
        <textarea id="bug-steps" name="bugSteps" rows={3} maxLength={5000} placeholder={"Steps, one per line\n1. Open the payment page\n2. Click Pay"} className={cn(inputClassName(false), "min-h-[72px] resize-none py-2")} />
      </Field>
      <Field label="What did you expect?" htmlFor="bug-expected">
        <textarea id="bug-expected" name="bugExpected" rows={2} maxLength={2000} className={cn(inputClassName(false), "min-h-[52px] resize-none py-2")} />
      </Field>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Where" htmlFor="bug-where-kind">
          <SelectWrap>
            <select id="bug-where-kind" name="bugWhereKind" value={kind} onChange={(e) => setKind(e.target.value as Where["kind"])} className={selectClassName()}>
              <option value="web">Web</option><option value="app">App</option><option value="other">Other</option>
            </select>
          </SelectWrap>
        </Field>
        {kind === "other" ? (
          <Field label="Where exactly" htmlFor="bug-where-text"><input id="bug-where-text" name="bugWhereText" maxLength={200} className={inputClassName(false)} /></Field>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label={kind === "web" ? "Browser" : "Platform"} htmlFor="bug-where-name">
              <SelectWrap>
                <select id="bug-where-name" name="bugWhereName" defaultValue="" className={selectClassName()}>
                  <option value="">—</option>
                  {(kind === "web" ? BROWSERS : PLATFORMS).map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </SelectWrap>
            </Field>
            <Field label="Version" htmlFor="bug-where-version"><input id="bug-where-version" name="bugWhereVersion" maxLength={40} placeholder="131" className={inputClassName(false)} /></Field>
          </div>
        )}
        <Field label="Found in" htmlFor="bug-found-in"><input id="bug-found-in" name="bugFoundIn" maxLength={40} placeholder="e.g., v2.3" className={inputClassName(false)} /></Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-foreground">Severity</legend>
        <input type="hidden" name="bugSeverity" value={severity} />
        <div role="radiogroup" aria-label="Severity" className="inline-flex flex-wrap gap-1.5">
          {[{ key: "", label: "Not sure" }, ...[...SEVERITIES].reverse()].map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={severity === s.key} onClick={() => setSeverity(s.key)}
              className={cn("h-8 rounded-[5px] border px-3 text-xs font-medium", severity === s.key ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted")}>{s.label}</button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** The bug's fields from the form (empty ones left out). */
export function readBugFields(form: FormData) {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const kind = text("bugWhereKind") as Where["kind"];
  const where: Where | null = kind === "other" ? (text("bugWhereText") ? { kind, text: text("bugWhereText") } : null)
    : (kind === "web" || kind === "app") && (text("bugWhereName") || text("bugWhereVersion"))
      ? kind === "web" ? { kind, browser: text("bugWhereName"), version: text("bugWhereVersion") } : { kind, platform: text("bugWhereName"), version: text("bugWhereVersion") }
      : null;
  return {
    ...(text("bugSeverity") ? { severity: text("bugSeverity") } : {}),
    ...(text("bugSteps") ? { steps: text("bugSteps") } : {}),
    ...(text("bugExpected") ? { expected: text("bugExpected") } : {}),
    ...(where ? { where } : {}),
    ...(text("bugFoundIn") ? { foundIn: text("bugFoundIn") } : {}),
  };
}

/**
 * Report 38.6 S5 (plan A2.1): the panel's Bug details: What happened?, What did you expect?, Severity (sets priority),
 * Where, Found in, Fixed in, and I see this too. Each field saves when it changes or loses focus.
 */
export function BugPanelSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const key = [...queryKeys.project.detail.tasksRoot(projectId), "bug", taskId];
  const query = useQuery({ queryKey: key, queryFn: () => readBugAction(projectId, taskId) });
  const data = query.data?.success ? query.data : null;
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-24 rounded-[6px]" /> : null;
  const f = data.fields as Record<string, unknown>;
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  async function save(fields: Record<string, unknown>) {
    const r = await setBugFieldsAction({ projectId, taskId, fields: fields as never });
    if (!r.success) toast.error(r.error);
    await refresh();
  }
  async function seeToo(on: boolean) {
    const r = await seeTooAction({ projectId, taskId, on });
    if (!r.success) return void toast.error(r.error);
    await refresh();
  }
  const text = (name: "steps" | "expected" | "foundIn" | "fixedIn", label: string, rows = 0, max = 40) => (
    <Field label={label} htmlFor={`bug-${name}-${taskId}`}>
      {rows ? (
        <textarea id={`bug-${name}-${taskId}`} key={String(f[name] ?? "")} defaultValue={String(f[name] ?? "")} rows={rows} maxLength={max} disabled={!data.canEdit}
          onBlur={(e) => { if (e.target.value !== String(f[name] ?? "")) void save({ [name]: e.target.value }); }} className={cn(inputClassName(false), "resize-none py-2")} />
      ) : (
        <input id={`bug-${name}-${taskId}`} key={String(f[name] ?? "")} defaultValue={String(f[name] ?? "")} maxLength={max} disabled={!data.canEdit}
          onBlur={(e) => { if (e.target.value.trim() !== String(f[name] ?? "")) void save({ [name]: e.target.value.trim() }); }} className={inputClassName(false)} />
      )}
    </Field>
  );
  return (
    <div className="space-y-3 pt-1" data-testid="bug-panel">
      <div className="border-b border-border/60 pb-2"><h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Bug details</h3></div>
      {text("steps", "What happened?", 3, 5000)}
      {text("expected", "What did you expect?", 2, 2000)}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Severity" htmlFor={`bug-severity-${taskId}`}>
          <SelectWrap>
            <select id={`bug-severity-${taskId}`} value={String(f.severity ?? "")} disabled={!data.canEdit} className={selectClassName()}
              onChange={(e) => void save({ severity: e.target.value || null })}>
              <option value="">Not sure</option>
              {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </SelectWrap>
        </Field>
        <div className="space-y-1.5">
          <span className="text-[13px] font-medium text-foreground">Where</span>
          <p className="flex h-[34px] items-center text-[13px] text-muted-foreground">{whereLabel(f.where as Where | null) ?? "—"}</p>
        </div>
        {text("foundIn", "Found in")}
        {text("fixedIn", "Fixed in")}
      </div>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">{data.seenCount ? `${data.seenCount} ${data.seenCount === 1 ? "person sees" : "people see"} this too` : "Nobody else has said they see this"}</span>
        {data.reporter ? null : (
          <button type="button" onClick={() => void seeToo(!data.seeing)} className="ml-auto h-7 rounded-[5px] border border-border px-2 text-xs font-medium hover:bg-muted">{data.seeing ? "I don’t see it" : "I see this too"}</button>
        )}
      </div>
    </div>
  );
}
