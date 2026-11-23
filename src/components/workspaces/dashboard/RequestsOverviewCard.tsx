"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { readRequestsAction } from "@/app/actions/requests";
import { RailSection } from "@/components/ui/rail-section";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { queryKeys } from "@/lib/query-keys";
import { requestsSummary } from "@/lib/workflows/requests";

/**
 * Report 38.7 S9 (plan A2.6): the Overview's Requests card when Requests is added: "5 new · 2 breaching soon ·
 * 8 delivered this week", linking to the Inbox. Members and viewers only (the read refuses others).
 */
export function RequestsOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("requests");
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "requests"], queryFn: () => readRequestsAction(projectId), enabled: added, staleTime: 30_000 });
  const data = query.data?.success ? query.data : null;
  if (!added || !data || !data.requests.length) return null;
  const s = requestsSummary(data.requests);
  return (
    <RailSection title="Requests" headingId="workspace-requests-title"
      action={<Link href={`/workspaces/${slug}?tab=requests`} className="text-xs font-medium text-primary hover:underline">Inbox</Link>}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="requests-summary">{s.fresh} new · {s.breaching} breaching soon · {s.delivered} delivered this week</p>
    </RailSection>
  );
}
