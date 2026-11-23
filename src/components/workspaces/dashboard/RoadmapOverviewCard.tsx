"use client";

import Link from "next/link";

import { RailSection } from "@/components/ui/rail-section";
import { useRoadmap } from "@/components/workspaces/v2/tasks/RoadmapParts";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { countdown } from "@/lib/workflows/launches";
import { localDayKey } from "@/lib/workflows/planner";
import { nextLaunch, roadmapSummary } from "@/lib/workflows/roadmap";

/**
 * Report 38.9 S7 (plan A2.10): the Overview's Roadmap card when Roadmap is added: "Now: 4 · 1 in testing" (the next
 * launch joins it with launches, A3.1), linking to the roadmap. Members and viewers only (the read refuses others).
 */
export function RoadmapOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("roadmap");
  return added ? <Card projectId={projectId} slug={slug} /> : null;
}

function Card({ projectId, slug }: { projectId: string; slug: string }) {
  const { data } = useRoadmap(projectId);
  if (!data?.items.length) return null;
  const s = roadmapSummary(data.items);
  const launch = nextLaunch(data.launches, localDayKey());
  return (
    <RailSection title="Roadmap" headingId="workspace-roadmap-title"
      action={<Link href={`/workspaces/${slug}?tab=roadmap`} className="text-xs font-medium text-primary hover:underline">Roadmap</Link>}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="roadmap-summary">Now: {s.now} · Next: {s.next} · {s.testing} in testing{launch ? ` · next launch ${launch.name} ${countdown(launch.date!, localDayKey())}` : ""}</p>
    </RailSection>
  );
}
