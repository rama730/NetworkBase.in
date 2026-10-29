"use client";

import { RailSection } from "@/components/ui/rail-section";
import Link from "next/link";
import { formatDistanceToNow } from "@/lib/utils/date";
import { CheckCircle2, FilePlus2, GitBranch, UserRoundPlus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { readWorkspaceRecentActivityAction } from "@/app/actions/workspace/recent-activity";
import { queryKeys } from "@/lib/query-keys";
import type { WorkspaceRecentActivityType } from "@/lib/workspaces/recent-activity";

const icons: Record<WorkspaceRecentActivityType, typeof GitBranch> = {
  member: UserRoundPlus,
  task: CheckCircle2,
  file: FilePlus2,
  github: GitBranch,
};

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
        {activity.data.map((item) => {
          const Icon = icons[item.type];
          return <li key={item.id} className="flex min-w-0 items-start gap-2.5">
            <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <Link href={item.href} className="block break-words leading-5 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{item.text}</Link>
              <time dateTime={item.occurredAt} className="mt-0.5 block font-mono text-xs text-muted-foreground">{formatDistanceToNow(new Date(item.occurredAt), { addSuffix: true })}</time>
            </div>
          </li>;
        })}
      </ol>}
  </RailSection>;
}
