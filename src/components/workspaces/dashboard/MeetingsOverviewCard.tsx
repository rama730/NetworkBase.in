"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { readMeetingsAction } from "@/app/actions/workspace/doc";
import { RailSection } from "@/components/ui/rail-section";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { queryKeys } from "@/lib/query-keys";
import { zonedParts } from "@/lib/workflows/request-clock";

/** Report 38.11 part 8 (plan A4.1b): "Next: Weekly · Thu 10:00 · 4 open action items", linking to the meeting. */
export function MeetingsOverviewCard({ projectId, slug }: { projectId: string; slug: string }) {
  const added = useAddedWorkflows().includes("meetings");
  return added ? <Card projectId={projectId} slug={slug} /> : null;
}

function Card({ projectId, slug }: { projectId: string; slug: string }) {
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "meetings"], queryFn: () => readMeetingsAction(projectId), staleTime: 30_000 });
  const data = query.data?.success ? query.data : null;
  if (!data?.meetings.length) return null;
  const now = Date.now();
  const next = data.meetings.filter((m) => m.startsAt && !m.finished && Date.parse(m.startsAt) + m.lengthMinutes * 60_000 > now).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!))[0];
  const when = next ? `${new Date(next.startsAt!).toLocaleDateString("en-GB", { timeZone: data.timeZone, weekday: "short" })} ${zonedParts(new Date(next.startsAt!), data.timeZone).time}` : null;
  const open = data.openActionItems.length;
  return (
    <RailSection title="Meetings" headingId="workspace-meetings-title"
      action={next ? <Link href={`/workspaces/${slug}?tab=docs&doc=${encodeURIComponent(next.slug)}`} className="text-xs font-medium text-primary hover:underline">Open</Link> : undefined}>
      <p className="font-mono text-[12px] text-muted-foreground" data-testid="meetings-summary">{next ? `Next: ${next.title} · ${when}` : "No meeting coming up"} · {open} open action {open === 1 ? "item" : "items"}</p>
    </RailSection>
  );
}
