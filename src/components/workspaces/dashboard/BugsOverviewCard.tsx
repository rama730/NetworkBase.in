"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { readBugsAction } from "@/app/actions/bugs";
import { RailSection } from "@/components/ui/rail-section";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { queryKeys } from "@/lib/query-keys";
import { openSeverityCounts } from "@/lib/workflows/bugs";

/**
 * Report 38.6 S8 (plan A2.1): the Overview's Bugs card when Bugs is added: "2 urgent · 5 to triage · 3 fixed this
 * week", linking to Bugs. Members and viewers only (the read refuses others).
 */
export function BugsOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("bugs");
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "bugs"], queryFn: () => readBugsAction(projectId), enabled: added, staleTime: 30_000 });
  const data = query.data?.success ? query.data : null;
  if (!added || !data || !data.bugs.length) return null;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const fixed = data.bugs.filter((b) => (b.stage === "fixed" || b.stage === "verified") && Date.parse(b.updatedAt) >= weekAgo).length;
  const triage = data.bugs.filter((b) => b.stage === "new").length;
  return (
    <RailSection title="Bugs" headingId="workspace-bugs-title"
      action={<Link href={`/workspaces/${slug}?tab=bugs`} className="text-xs font-medium text-primary hover:underline">Triage</Link>}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="bugs-summary">{openSeverityCounts(data.bugs).urgent} urgent · {triage} to triage · {fixed} fixed this week</p>
    </RailSection>
  );
}
