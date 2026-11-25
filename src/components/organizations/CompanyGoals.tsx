"use client";

import Link from "next/link";
import { FolderKanban, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { postProjectStatusAction, readCompanyGoalsAction, readProjectGoalLineAction, setProjectDatesAction, setProjectSupportsAction, type GoalRow, type ProjectRow, type ProjectStatus } from "@/app/actions/company-goals";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { NewGoalsDialog } from "@/components/workspaces/doc/DocGoals";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 33.4 (plan B4.3, K3): a company's Workspaces gain Goals (company goals, team goals that contribute, the
// projects that support them) and Timeline; the Overview gets a Company goals card; each project gets a header line.
const key = (orgId: string) => ["company-goals", orgId] as const;
const WORD: Record<string, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track" };
const ORDER: Record<string, number> = { off_track: 0, at_risk: 1, on_track: 2 };

type View = "list" | "goals" | "timeline";
export function CompanyProjects({ orgId, base, list }: { orgId: string; base: string; list: ReactNode }) {
  const [view, setView] = useState<View>("list");
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4">
      <UnderlineTabs tabs={[{ key: "list", label: "List" }, { key: "goals", label: "Goals" }, { key: "timeline", label: "Timeline" }]} value={view} onChange={setView} label="Workspace views" idPrefix="company-projects" />
      <div id={`company-projects-panel-${view}`} role="tabpanel">{view === "list" ? list : view === "goals" ? <GoalsView orgId={orgId} base={base} /> : <TimelineView orgId={orgId} />}</div>
    </div>
  );
}

function useCompanyGoals(orgId: string) {
  return useQuery({ queryKey: key(orgId), queryFn: () => readCompanyGoalsAction(orgId), staleTime: 30_000 });
}

function ProjectLine({ p }: { p: ProjectRow }) {
  return (
    <li role="treeitem" aria-selected={false} aria-label={`${p.title}${p.status ? `, ${WORD[p.status.status]}` : ""}`} className="flex flex-wrap items-center gap-2 py-0.5">
      <FolderKanban aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {p.slug ? <Link href={`/workspaces/${encodeURIComponent(p.slug)}`} className="hover:underline">{p.title}</Link> : <span className="text-muted-foreground">{p.title}</span>}
      {p.status ? <><StatusBadge state={p.status.status}>{WORD[p.status.status]}</StatusBadge><span className="text-muted-foreground">“{p.status.line}” <span className="font-mono">({p.status.at.slice(5, 10)})</span></span></> : <span className="text-muted-foreground">No status yet</span>}
    </li>
  );
}

function GoalLine({ g }: { g: GoalRow }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Target aria-hidden="true" className="size-3.5 text-muted-foreground" /><span className="font-medium">{g.title}</span>
      {g.team ? <span className="text-muted-foreground">{g.team}</span> : null}
      <StatusBadge state={g.status}>{WORD[g.status]}</StatusBadge>
      <span className="font-mono" aria-label={`${g.progress}% done`}>{g.progress}%</span>
      <span aria-hidden="true" className="h-1.5 w-24 overflow-hidden rounded-sm bg-muted"><span className="block h-full bg-primary" style={{ width: `${Math.min(100, g.progress)}%` }} /></span>
    </span>
  );
}

/** Goals (views): company goals, sorted Off track first, with the team goals that contribute and the projects that support each. */
function GoalsView({ orgId, base }: { orgId: string; base: string }) {
  const q = useCompanyGoals(orgId);
  const [setting, setSetting] = useState(false);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading goals…</p>;
  if (!q.data?.success) return <ErrorNotice what="Goals" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const sort = (a: GoalRow, b: GoalRow) => ORDER[a.status]! - ORDER[b.status]!;
  const company = d.goals.filter((g) => !g.team).sort(sort);
  const teamOnly = d.goals.filter((g) => g.team && !company.some((c) => c.id === g.contributesTo)).sort(sort);
  const under = (goalId: string) => d.projects.filter((p) => p.supports === goalId).sort((a, b) => (ORDER[a.status?.status ?? "on_track"] ?? 2) - (ORDER[b.status?.status ?? "on_track"] ?? 2));
  const node = (g: GoalRow, children: GoalRow[]) => (
    <li key={g.id} role="treeitem" aria-selected={false} aria-label={`${g.title}, ${WORD[g.status]}, ${g.progress}%`} className="space-y-1 py-1">
      <GoalLine g={g} />
      {children.length || under(g.id).length ? (
        <ul role="group" className="ml-5 border-l border-border pl-3">
          {children.map((c) => node(c, []))}
          {under(g.id).map((p) => <ProjectLine key={p.id} p={p} />)}
        </ul>
      ) : null}
    </li>
  );
  return (
    <section aria-label="Goals" className="space-y-3 text-[13px]" data-testid="company-goals">
      <p className="flex flex-wrap items-center gap-3"><span className="font-medium">{d.label}</span>
        {d.goalsDoc ? <Link href={`${base}?tab=docs&doc=${encodeURIComponent(d.goalsDoc)}`} className="nb-link">Open the goals document</Link>
          : d.admin ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setSetting(true)}>Set this quarter’s company goals</button> : null}</p>
      {d.admin && !d.goalsDoc ? <NewGoalsDialog projectId={orgId} open={setting} onOpenChange={setSetting} /> : null}
      {company.length || teamOnly.length ? (
        <ul role="tree" aria-label="Company goals">
          {company.map((c) => node(c, d.goals.filter((g) => g.contributesTo === c.id).sort(sort)))}
          {teamOnly.map((g) => node(g, []))}
        </ul>
      ) : <p className="text-muted-foreground">No goals for {d.label} yet.</p>}
      {d.notLinked.length ? <p className="text-muted-foreground" data-testid="not-linked">Not linked to a goal: {d.notLinked.join(", ")}</p> : null}
    </section>
  );
}

/** Timeline (the S14 Portfolio): one bar per project — dates, completion and what it supports; no dates sit at the bottom. */
function TimelineView({ orgId }: { orgId: string }) {
  const q = useCompanyGoals(orgId);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the timeline…</p>;
  if (!q.data?.success) return <ErrorNotice what="Timeline" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const names = new Map(d.goals.map((g) => [g.id, g.title]));
  const dated = d.projects.filter((p) => p.start && p.end).sort((a, b) => a.end!.localeCompare(b.end!));
  const undated = d.projects.filter((p) => !p.start || !p.end);
  const min = dated.length ? Math.min(...dated.map((p) => Date.parse(p.start!))) : 0, max = dated.length ? Math.max(...dated.map((p) => Date.parse(p.end!))) : 1;
  const span = Math.max(1, max - min);
  return (
    <table className="w-full text-[13px]" data-testid="company-timeline">
      <caption className="sr-only">Projects by date</caption>
      <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-normal">Project</th><th className="font-normal">Dates</th><th className="w-[40%] font-normal"><span className="sr-only">Bar</span></th><th className="font-normal">Done</th><th className="font-normal">Supports</th></tr></thead>
      <tbody>
        {[...dated, ...undated].map((p) => {
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          return (
            <tr key={p.id} className="border-t border-border">
              <td className="py-1.5">{p.title}</td>
              <td className="font-mono">{p.start && p.end ? `${p.start.slice(5)} – ${p.end.slice(5)}` : "No dates"}</td>
              <td>{p.start && p.end ? <span aria-hidden="true" className="relative block h-2 rounded-sm bg-muted"><span className="absolute top-0 h-2 rounded-sm bg-primary" style={{ left: `${((Date.parse(p.start) - min) / span) * 100}%`, width: `${Math.max(2, ((Date.parse(p.end) - Date.parse(p.start)) / span) * 100)}%` }} /></span> : null}</td>
              <td className="font-mono">{p.masked ? "—" : `${pct}%`}</td>
              <td className="text-muted-foreground">{p.supports ? names.get(p.supports) ?? "A removed goal" : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Company goals card (Overview, K1): up to 5 company goals with status. */
export function CompanyGoalsCard({ orgId, base }: { orgId: string; base: string }) {
  const q = useCompanyGoals(orgId);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const company = d.goals.filter((g) => !g.team).sort((a, b) => ORDER[a.status]! - ORDER[b.status]!).slice(0, 5);
  if (!company.length && !d.admin) return null;
  return (
    <OrgCard title={`Company goals · ${d.label}`} testId="company-goals-card" action={<Link href={`${base}?tab=projects`} className="nb-link text-[13px]">Goals</Link>}>
      {company.length ? <ul className="space-y-1 text-[13px]">{company.map((g) => <li key={g.id}><GoalLine g={g} /></li>)}</ul>
        : <p className="text-[13px] text-muted-foreground">Set this quarter’s company goals in Workspaces, under Goals.</p>}
    </OrgCard>
  );
}

/** Project header line (a workspace in a company): Supports, dates, the latest status and Post status. */
export function ProjectGoalLine({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["project-goal-line", projectId], queryFn: () => readProjectGoalLineAction(projectId), staleTime: 30_000 });
  const [posting, setPosting] = useState<{ status: ProjectStatus; line: string } | null>(null);
  const p = q.data?.success ? q.data.project : null;
  if (!p) return null;
  const refresh = () => void client.invalidateQueries({ queryKey: ["project-goal-line", projectId] });
  const run = async (r: Promise<{ success: boolean; error?: string }>, ok: string) => { const x = await r; if (!x.success) return void toast.error(x.error ?? "Couldn’t save."); toast.success(ok); refresh(); };
  return (
    <section aria-label="Goal and status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2 text-[13px]" data-testid="project-goal-line">
      {p.lead ? (
        <label className="flex items-center gap-1.5">Supports
          <select className="nb-select" data-size="sm" value={p.supports ?? ""} onChange={(e) => void run(setProjectSupportsAction(projectId, e.target.value || null), "Saved")} aria-label="Which goal this project supports">
            <option value="">Which goal does this project support?</option>{p.goals.map((g) => <option key={g.id} value={g.id}>{g.team ? `${g.team}: ` : ""}{g.title}</option>)}</select></label>
      ) : p.supports ? <span className="flex items-center gap-1">Supports <Target aria-hidden="true" className="size-3.5" /> {p.goals.find((g) => g.id === p.supports)?.title ?? "a removed goal"}</span> : null}
      {p.lead ? (
        <span className="flex items-center gap-1.5">
          <Input type="date" defaultValue={p.start ?? ""} aria-label="Project start" className="w-[150px] font-mono" onBlur={(e) => { if ((e.target.value || null) !== p.start) void run(setProjectDatesAction(projectId, { start: e.target.value || null, end: p.end }), "Dates saved"); }} />
          <span>–</span>
          <Input type="date" defaultValue={p.end ?? ""} aria-label="Project end" className="w-[150px] font-mono" onBlur={(e) => { if ((e.target.value || null) !== p.end) void run(setProjectDatesAction(projectId, { start: p.start, end: e.target.value || null }), "Dates saved"); }} />
        </span>
      ) : null}
      {p.status ? <span className="flex items-center gap-1.5">Status: <StatusBadge state={p.status.status}>{WORD[p.status.status]}</StatusBadge><span className="text-muted-foreground">{p.status.at.slice(0, 10)}</span></span> : null}
      {p.lead && !posting ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPosting({ status: p.status?.status ?? "on_track", line: "" })}>Post status</button> : null}
      {posting ? (
        <fieldset className="flex w-full flex-wrap items-center gap-2" data-testid="post-status">
          <legend className="sr-only">Post status</legend>
          {(["on_track", "at_risk", "off_track"] as const).map((s) => <label key={s} className="flex items-center gap-1"><input type="radio" className="nb-radio" name="project-status" checked={posting.status === s} onChange={() => setPosting({ ...posting, status: s })} />{WORD[s]}</label>)}
          <Input value={posting.line} maxLength={200} placeholder={p.status?.line ? `Last week: ${p.status.line}` : "One line: what changed"} aria-label="Status line" onChange={(e) => setPosting({ ...posting, line: e.target.value })} className="min-w-[240px] flex-1" />
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!posting.line.trim()} onClick={() => void run(postProjectStatusAction(projectId, posting), "Status posted").then(() => setPosting(null))}>Post</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPosting(null)}>Cancel</button>
        </fieldset>
      ) : null}
    </section>
  );
}
