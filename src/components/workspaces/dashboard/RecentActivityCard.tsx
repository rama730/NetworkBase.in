"use client";

import { RailSection } from "@/components/ui/rail-section";
import { ActivityItem } from "@/components/ui/activity-item";
import { useQuery } from "@tanstack/react-query";
import { readWorkspaceRecentActivityAction } from "@/app/actions/workspace/recent-activity";
import { queryKeys } from "@/lib/query-keys";

export function RecentActivityCard({ projectId }: { projectId: string }) {
  const activity = useQuery({
    queryKey: queryKeys.project.detail.recentActivity(projectId),
    queryFn: () => readWorkspaceRecentActivityAction(projectId),
    staleTime: 30_000,
  });

  if (!activity.isPending && !activity.isError && activity.data?.length === 0) return null;

  return <RailSection title="Recent activity" headingId="project-recent-activity-title" contentClassName="text-sm max-md:text-[13px]">
      {activity.isPending ? <div role="status" aria-label="Loading recent activity" className="space-y-4">
        {[0, 1, 2].map((index) => <div key={index} aria-hidden="true" className="flex gap-3">
          <div className="nb-skeleton h-4 w-4 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-2"><div className="nb-skeleton h-4 w-full rounded" /><div className="nb-skeleton h-3 w-16 rounded" /></div>
        </div>)}
      </div> : activity.isError ? <div role="alert" className="space-y-2">
        <p className="text-muted-foreground">Recent activity could not be loaded.</p>
        <button type="button" onClick={() => void activity.refetch()} className="font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Try again</button>
      </div> : <ol className="space-y-3">
        {/* Report §5.3: the same activity item as the organization's About and Overview. */}
        {activity.data.map((item) => <ActivityItem key={item.id} kind={item.type} text={item.text} href={item.href} at={item.occurredAt} />)}
      </ol>}
  </RailSection>;
}
