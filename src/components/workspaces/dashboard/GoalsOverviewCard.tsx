"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { readGoalsSummaryAction } from "@/app/actions/workspace/doc";
import { RailSection } from "@/components/ui/rail-section";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { queryKeys } from "@/lib/query-keys";

/** Report 38.12 S4 (plan A5.1b): "Q1: 3 objectives · 2 on track · 1 at risk · 4 check-ins due", linking to the document. */
export function GoalsOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("goals");
  return added ? <Card projectId={projectId} slug={slug} /> : null;
}

function Card({ projectId, slug }: { projectId: string; slug: string }) {
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "goals-summary"], queryFn: () => readGoalsSummaryAction(projectId), staleTime: 60_000 });
  const s = query.data?.success ? query.data.summary : null;
  if (!s) return null;
  const parts = [`${s.label}: ${s.objectives} ${s.objectives === 1 ? "objective" : "objectives"}`, `${s.onTrack} on track`, `${s.atRisk} at risk`, ...(s.offTrack ? [`${s.offTrack} off track`] : []), `${s.due} check-ins due`];
  return (
    <RailSection title="Goals" headingId="workspace-goals-title"
      action={<Link href={`/workspaces/${slug}?tab=docs&doc=${encodeURIComponent(s.slug)}`} className="text-xs font-medium text-primary hover:underline">Open</Link>}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="goals-summary">{parts.join(" · ")}</p>
    </RailSection>
  );
}
