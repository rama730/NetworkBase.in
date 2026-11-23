"use client";

import Link from "next/link";

import { RailSection } from "@/components/ui/rail-section";
import { useContent } from "@/components/workspaces/v2/tasks/ContentParts";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { contentSummary } from "@/lib/workflows/content";
import { localDayKey, mondayOf } from "@/lib/workflows/planner";

/**
 * Report 38.8 S11 (plan A2.9): the Overview's Content card when Content is added: "3 publishing this week · 2 waiting
 * for edit · next: Pricing guide, Thu", linking to the Calendar. Members and viewers only (the read refuses others).
 */
export function ContentOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("content");
  return added ? <Card projectId={projectId} slug={slug} /> : null;
}

function Card({ projectId, slug }: { projectId: string; slug: string }) {
  const { data } = useContent(projectId);
  if (!data?.settings || !data.items.length) return null;
  const s = contentSummary(data.items, new Date(), data.timeZone, mondayOf(localDayKey()));
  const next = s.next ? `${s.next.title}, ${new Date(s.next.at).toLocaleDateString(undefined, { timeZone: data.timeZone, weekday: "short" })}` : null;
  return (
    <RailSection title="Content" headingId="workspace-content-title"
      action={<Link href={`/workspaces/${slug}?tab=content`} className="text-xs font-medium text-primary hover:underline">Calendar</Link>}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="content-summary">{s.thisWeek} publishing this week · {s.editing} waiting for edit{next ? ` · next: ${next}` : ""}</p>
    </RailSection>
  );
}
