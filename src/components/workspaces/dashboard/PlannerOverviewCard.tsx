"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { readProjectsAction } from "@/app/actions/task";
import { RailSection } from "@/components/ui/rail-section";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { queryKeys } from "@/lib/query-keys";
import { localDayKey, projectsSummary } from "@/lib/workflows/planner";
import { formatTaskDueDate } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.5 part 8 (plan A1.5): the Overview's Projects card when the Project planner is added: "3 in progress · 1
 * ends this week · 1 overdue", the next project to end with its completion, and a link to Projects. Members only (the
 * read refuses others), so visitors never see it.
 */
export function PlannerOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("project_planner");
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "projects"], queryFn: () => readProjectsAction(projectId), enabled: added, staleTime: 30_000 });
  const data = query.data?.success ? query.data : null;
  if (!added || !data || !data.projects.length) return null;
  const s = projectsSummary(data.projects, localDayKey());
  return (
    <RailSection title="Projects" headingId="workspace-projects-title"
      action={<Link href={`/workspaces/${slug}?tab=tasks&view=projects`} className="text-xs font-medium text-primary hover:underline">Open</Link>}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="projects-summary">{s.line}</p>
      {s.next ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[13px]"><span className="text-muted-foreground">Next to end:</span> <span className="font-medium text-foreground">{s.next.title}</span> <span className="font-mono text-[11px] text-muted-foreground">{s.next.dueDate ? formatTaskDueDate(s.next.dueDate) : ""}</span></p>
          <div className="flex items-center gap-2" aria-label={`Completion ${s.next.completion.percent}%`}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-muted"><div className="h-full bg-primary" style={{ width: `${s.next.completion.percent}%` }} /></div>
            <span className="font-mono text-[11px] text-muted-foreground">{s.next.completion.percent}%</span>
          </div>
        </div>
      ) : null}
    </RailSection>
  );
}
