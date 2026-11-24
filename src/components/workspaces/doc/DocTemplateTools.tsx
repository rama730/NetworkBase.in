"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { makeDocTasksAction, readGoalsNumbersAction, readTemplateToolsAction } from "@/app/actions/workspace/doc";
import { RecordDecisionDialog } from "@/components/workspaces/doc/DocDecisions";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { assumptionRows, bmcBoxes, prdParts, testPlanSummary } from "@/lib/workflows/template-extras";

const toolsKey = (projectId: string, docSlug: string) => [...queryKeys.project.detail.tasksRoot(projectId), "template-tools", docSlug];
type Kind = "tests" | "stories" | "roadmap" | "bugs" | "review";
type Item = { title: string; steps?: string; expected?: string; assigneeId?: string };
const btn = cn(FORM_SECONDARY_CLASS, "h-7 px-2 text-[12px]");

/** Report 38.15 call 7 (A6.36): the tools under a document made from Test plan, Assumptions check, Tech spec or PRD. */
export function DocTemplateTools({ projectId, docSlug, template, content }: { projectId: string; docSlug: string; template: string; content: string }) {
  const queryClient = useQueryClient();
  const added = useAddedWorkflows();
  const query = useQuery({ queryKey: toolsKey(projectId, docSlug), queryFn: () => readTemplateToolsAction(projectId, docSlug), staleTime: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [reviewers, setReviewers] = useState<string[]>([]);
  if (!query.data?.success) return null;
  const { canEdit, made, people, review } = query.data;
  const madeIn = (kind: Kind, title: string) => made.find((t) => t.block === `tpl_${kind}` && t.title.toLowerCase() === title.toLowerCase());
  async function make(kind: Kind, items: Item[], done: string, key = kind as string) {
    setBusy(key);
    try {
      const r = await makeDocTasksAction(projectId, { docSlug, kind, items });
      if (!r.success) throw new Error(r.error);
      await queryClient.invalidateQueries({ queryKey: toolsKey(projectId, docSlug) });
      toast(r.made ? done : "Already made");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t make it");
    } finally {
      setBusy(null);
    }
  }
  const ref = (kind: Kind, title: string) => { const t = madeIn(kind, title); return t ? <span className="font-mono text-[11px] text-muted-foreground">NB-{t.number}{t.done ? " · done" : ""}</span> : null; };

  const reviewBar = (template === "tech-spec" || template === "prd") ? (
    <div className="flex flex-wrap items-center gap-2" data-testid="doc-review">
      <span className="text-[12px] font-medium">Review</span>
      <span className="text-[12px] text-muted-foreground" data-testid="doc-review-state">{review.state === "draft" ? "Not requested" : review.state === "approved" ? `Approved · ${review.total} of ${review.total} reviewed` : `In review · ${review.done} of ${review.total} reviewed`}</span>
      {canEdit ? <button type="button" className={btn} onClick={() => setPicking((v) => !v)} aria-expanded={picking}>Request review</button> : null}
      {picking ? (
        <fieldset className="flex w-full flex-wrap items-center gap-3 pt-1">
          <legend className="sr-only">Reviewers</legend>
          {people.map((p) => <label key={p.id} className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={reviewers.includes(p.id)} onChange={(e) => setReviewers(e.target.checked ? [...reviewers, p.id] : reviewers.filter((x) => x !== p.id))} />{p.name}</label>)}
          <button type="button" className={btn} disabled={!reviewers.length || busy === "review"} onClick={() => void make("review", reviewers.map((id) => ({ title: `Review: ${docTitleOf(content)}`, assigneeId: id })), "Review tasks sent").then(() => { setPicking(false); setReviewers([]); })}>Send</button>
        </fieldset>
      ) : null}
    </div>
  ) : null;

  let body: React.ReactNode = null;
  if (template === "test-plan") {
    const s = testPlanSummary(content);
    body = (
      <div className="space-y-1.5" data-testid="test-plan-summary">
        <p className="text-[12px]"><span className="font-mono">Pass {s.pass} · Fail {s.fail} · Blocked {s.blocked} · Not run {s.notRun}</span>{s.rate != null ? <span className="ml-2 font-mono font-semibold">{s.rate}%</span> : <span className="ml-2 text-muted-foreground">No results yet</span>}</p>
        {s.failing.map((f) => (
          <div key={f.case} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate">Fail · {f.case || "A case"}</span>{ref("bugs", f.case)}
            {canEdit && added.includes("bugs") && !madeIn("bugs", f.case) ? <button type="button" className={btn} disabled={busy === `bug:${f.case}`} onClick={() => void make("bugs", [{ title: f.case, steps: f.steps, expected: f.expected }], "Bug reported", `bug:${f.case}`)}>Report a bug</button> : null}
          </div>
        ))}
      </div>
    );
  } else if (template === "assumptions-check") {
    const rows = assumptionRows(content);
    body = rows.length ? (
      <ul className="space-y-1" data-testid="assumption-rows">
        {rows.map((r) => (
          <li key={r.assumption} className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate">{r.assumption}</span>
            {r.loadBearing ? <span className="rounded-[3px] border border-border px-1 text-[11px] font-medium">Load-bearing</span> : null}
            <span className="text-muted-foreground">{r.status}</span>{ref("tests", `Test: ${r.test || r.assumption}`)}
            {canEdit && !madeIn("tests", `Test: ${r.test || r.assumption}`) ? <button type="button" className={btn} disabled={busy === `test:${r.assumption}`} onClick={() => void make("tests", [{ title: `Test: ${r.test || r.assumption}` }], "Task made", `test:${r.assumption}`)}>Make a task</button> : null}
            {canEdit && r.broken ? <button type="button" className={btn} onClick={() => setDeciding(r.assumption)}>Record a decision</button> : null}
          </li>
        ))}
      </ul>
    ) : <p className="text-[12px] text-muted-foreground">Fill the table; each assumption gets Make a task here.</p>;
  } else if (template === "prd") {
    const { must, stories } = prdParts(content);
    const newMust = must.filter((m) => !madeIn("roadmap", m)), newStories = stories.filter((st) => !madeIn("stories", st));
    body = (
      <div className="flex flex-wrap items-center gap-2 text-[12px]" data-testid="prd-tools">
        <span className="text-muted-foreground">{must.length} Must requirement{must.length === 1 ? "" : "s"} · {stories.length} user stor{stories.length === 1 ? "y" : "ies"}</span>
        {canEdit && added.includes("roadmap") && newMust.length ? <button type="button" className={btn} disabled={busy === "roadmap"} onClick={() => void make("roadmap", newMust.map((title) => ({ title })), `${newMust.length} roadmap item${newMust.length === 1 ? "" : "s"} made`)}>Create roadmap items ({newMust.length})</button> : null}
        {canEdit && newStories.length ? <button type="button" className={btn} disabled={busy === "stories"} onClick={() => void make("stories", newStories.map((title) => ({ title })), `${newStories.length} task${newStories.length === 1 ? "" : "s"} made`)}>Make tasks ({newStories.length})</button> : null}
      </div>
    );
  }
  if (!body && !reviewBar) return null;
  return (
    <section aria-label="Template tools" className="mb-4 space-y-2 rounded-[8px] border border-border px-3 py-2.5" data-testid="doc-template-tools">
      {reviewBar}{body}
      {deciding ? <RecordDecisionDialog projectId={projectId} fromDocSlug={docSlug} initialContext={`Assumption broken: ${deciding}`} open onOpenChange={(o) => { if (!o) setDeciding(null); }} /> : null}
    </section>
  );
}
const docTitleOf = (content: string) => /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? "this document";

/** Call 3: the Business model canvas as a 3 × 3 grid of its nine headings. */
export function BmcCanvas({ content }: { content: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="bmc-canvas">
      {bmcBoxes(content).map((box) => (
        <section key={box.title} aria-label={box.title} className="min-h-[120px] rounded-[8px] border border-border p-3">
          <h3 className="text-[13px] font-semibold">{box.title}</h3>
          <div className="mt-1 space-y-0.5 text-[12px]">
            {box.body.split("\n").filter((l) => l.trim()).map((line, i) => {
              const hint = /^_(.*)_$/.exec(line.trim());
              return <p key={i} className={hint ? "text-muted-foreground" : ""}>{(hint ? hint[1]! : line.replace(/^[-*]\s+/, "• ")).replace(/[*_`]/g, "")}</p>;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** A goals block outside a goals document (Investor update, Grant proposal, Impact report, PRD): this period's key results. */
export function GoalsNumbers({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "goals-numbers"], queryFn: () => readGoalsNumbersAction(projectId), staleTime: 60_000 });
  if (!query.data) return <div aria-hidden="true" className="nb-skeleton my-4 h-16 rounded-[8px]" />;
  const { label, rows } = query.data;
  return (
    <div className="my-4 rounded-[8px] border border-border" data-testid="goals-numbers">
      <p className="border-b border-border px-3 py-1.5 text-[12px] font-medium">Key results{label ? ` · ${label}` : ""}</p>
      {rows.length ? (
        <table className="w-full text-[12px]"><tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="px-3 py-1.5">{r.title}<span className="block text-[11px] text-muted-foreground">{r.objective}</span></td>
              <td className="px-3 py-1.5 text-right font-mono">{r.current ?? "—"}{r.target != null ? ` / ${r.target}` : ""}{r.unit ? ` ${r.unit}` : ""}</td>
            </tr>
          ))}
        </tbody></table>
      ) : <p className="px-3 py-2 text-[12px] text-muted-foreground">No goals for this period yet. Add them in a Goals document.</p>}
    </div>
  );
}
