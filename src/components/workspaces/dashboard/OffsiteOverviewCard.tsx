"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { readUpcomingOffsitesAction } from "@/app/actions/workspace/doc";
import { RailSection } from "@/components/ui/rail-section";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { queryKeys } from "@/lib/query-keys";
import { offsiteLine } from "@/lib/workflows/offsite";

/** Report 38.14 part 8 (plan A5.4): an off-site within 30 days shows "Off-site in 12 days · 2 not answered". */
export function OffsiteOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("offsite");
  return added ? <Card projectId={projectId} slug={slug} /> : null;
}

function Card({ projectId, slug }: { projectId: string; slug: string }) {
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "offsites"], queryFn: () => readUpcomingOffsitesAction(projectId), staleTime: 60_000 });
  const next = query.data?.success ? query.data.offsites[0] : null;
  if (!next) return null;
  return (
    <RailSection title="Off-site" headingId="workspace-offsite-title"
      action={<Link href={`/workspaces/${slug}?tab=docs&doc=${encodeURIComponent(next.slug)}`} className="text-xs font-medium text-primary hover:underline">Open</Link>}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="offsite-summary">{next.name} · {offsiteLine(next.name, next.days, next.counts.unanswered)}</p>
    </RailSection>
  );
}
