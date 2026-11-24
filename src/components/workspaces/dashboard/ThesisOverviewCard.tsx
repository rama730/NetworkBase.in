"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fileChapterAction, readThesisAction, saveThesisAction } from "@/app/actions/workspace/doc";
import { RailSection } from "@/components/ui/rail-section";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { CHAPTER_STATUS_WORDS, chapterMarkdown, DEFAULT_CHAPTERS, DEFAULT_CHAPTER_TARGET, overTarget } from "@/lib/workflows/thesis";
import { cn } from "@/lib/utils";

// Report 30.6 W5 (plan B1.8a): the thesis on Overview — research questions, Writing progress (counted from the chapter
// documents), the next milestone and the supervisor.
const NUM = new Intl.NumberFormat("en");
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

export function ThesisOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("thesis");
  return added ? <Card projectId={projectId} slug={slug} /> : null;
}

function Card({ projectId, slug }: { projectId: string; slug: string }) {
  const client = useQueryClient();
  const key = ["thesis", projectId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => readThesisAction(projectId), staleTime: 30_000 });
  const [questions, setQuestions] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const t = q.data?.success ? q.data.thesis : null;
  if (!t) return null;
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const docHref = (docSlug: string) => `/workspaces/${slug}?tab=docs&doc=${encodeURIComponent(docSlug)}`;
  const saveQuestions = async () => {
    const r = await saveThesisAction(projectId, { questions: (questions ?? "").split("\n") });
    if (!r.success) return void toast.error(r.error);
    setQuestions(null);
    await refresh();
  };
  // The usual six chapters (layer 2), each its own document filed under Chapters; the student renames or removes them.
  const addChapters = async () => {
    setAdding(true);
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      for (const [i, title] of DEFAULT_CHAPTERS.entries()) {
        const made = await createDocFile(projectId, `${String(i + 1).padStart(2, "0")}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`, chapterMarkdown(i + 1, title));
        const r = await fileChapterAction(projectId, made.slug, { number: i + 1, target: DEFAULT_CHAPTER_TARGET });
        if (!r.success) throw new Error(r.error);
      }
      toast.success("Added your chapters");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t add the chapters.");
    } finally {
      setAdding(false);
      await refresh();
    }
  };
  return (
    <RailSection title="Thesis" headingId="workspace-thesis-title">
      <div className="space-y-3 text-[13px]" data-testid="thesis-card">
        <div>
          <p className="font-medium">Research questions</p>
          {questions !== null ? (
            <div className="space-y-1.5">
              <textarea className="nb-textarea" rows={3} aria-label="Research questions, one a line" value={questions} onChange={(e) => setQuestions(e.target.value)} />
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void saveQuestions()}>Save questions</button>
            </div>
          ) : t.questions.length ? (
            <ol className="list-decimal space-y-0.5 pl-5">{t.questions.map((x, i) => <li key={i}>{x}</li>)}</ol>
          ) : <p className="text-muted-foreground">No research questions yet.</p>}
          {questions === null && t.canEdit ? <button type="button" className="text-[12px] font-medium text-primary hover:underline" onClick={() => setQuestions(t.questions.join("\n"))}>{t.questions.length ? "Edit questions" : "Add your research questions"}</button> : null}
        </div>
        <div>
          <p className="flex justify-between font-medium"><span>Writing progress</span><span className="font-mono text-[12px]">{NUM.format(t.words)} / {NUM.format(t.target)}</span></p>
          {t.chapters.length ? (
            <ul className="mt-1 space-y-1.5" aria-label="Chapters">
              {t.chapters.map((c) => {
                const pct = c.target ? Math.min(100, Math.round((c.words / c.target) * 100)) : 0;
                const over = overTarget(c.words, c.target);
                return (
                  <li key={c.slug}>
                    <Link href={docHref(c.slug)} className="flex justify-between gap-2 hover:underline">
                      <span className="truncate font-serif">{c.number} {c.title}</span>
                      <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{CHAPTER_STATUS_WORDS[c.status]} · {NUM.format(c.words)} of {NUM.format(c.target)} words</span>
                    </Link>
                    <span className="mt-0.5 block h-1.5 rounded-sm bg-muted" aria-hidden="true"><span className={cn("block h-1.5 rounded-sm", over ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} /></span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-1 space-y-1.5">
              <p className="text-muted-foreground">No chapters yet.</p>
              {t.canEdit ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={adding} onClick={() => void addChapters()}>Add your chapters</button> : null}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Next milestone</dt>
          <dd>{t.nextMilestone ? <Link href={t.nextMilestone.href} className="hover:underline">{t.nextMilestone.title}{t.nextMilestone.due ? ` · due ${DAY.format(new Date(t.nextMilestone.due))}` : ""}</Link> : "None yet"}</dd>
          <dt className="text-muted-foreground">Supervisor</dt>
          <dd>{t.canEdit && t.staff.length ? (
            <span className="flex flex-col gap-1">
              {(["supervisorId", "coSupervisorId"] as const).map((key) => (
                <select key={key} className="nb-select" data-size="sm" aria-label={key === "supervisorId" ? "Supervisor" : "Co-supervisor"} value={t[key] ?? ""}
                  onChange={(e) => void saveThesisAction(projectId, { [key]: e.target.value || null }).then((r) => { if (!r.success) return void toast.error(r.error); void refresh(); })}>
                  <option value="">{key === "supervisorId" ? "No supervisor" : "No co-supervisor"}</option>
                  {t.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ))}
            </span>
          ) : <>{t.supervisor ?? "Not set"}{t.coSupervisor ? ` · co-supervisor ${t.coSupervisor}` : ""}</>}</dd>
          <dt className="text-muted-foreground">Last supervision</dt>
          <dd>{t.lastSupervision ? <Link href={docHref(t.lastSupervision.slug)} className="hover:underline">{DAY.format(new Date(`${t.lastSupervision.date}T12:00:00Z`))}{t.lastSupervision.openItems ? ` · ${t.lastSupervision.openItems} action ${t.lastSupervision.openItems === 1 ? "item" : "items"}` : ""}</Link> : "None yet"}</dd>
          {t.outputs.length ? <><dt className="text-muted-foreground">Outputs</dt><dd>{t.outputs.map((o) => `${o.title} · ${o.state}`).join("; ")}</dd></> : null}
        </dl>
      </div>
    </RailSection>
  );
}
