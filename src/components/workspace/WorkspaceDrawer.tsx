"use client";

import React from "react";
import { Inbox, ListChecks, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getWorkspaceSummaryAction } from "@/app/actions/workspace";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";

import WorkspaceTasksTab from "./WorkspaceTasksTab";
import WorkspaceRequestsTab from "./WorkspaceRequestsTab";
import { OpenInIdeButton } from "@/components/projects/v2/files-tab/OpenInIdeButton";

export default function WorkspaceDrawer() {
  const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
  const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
  const activeTab = useUIStore((s) => s.workspaceTab);
  const setActiveTab = useUIStore((s) => s.setWorkspaceTab);
  const { pendingConnections } = useNetworkNotifications();

  const { data: summary } = useQuery({
    queryKey: queryKeys.workspace.summary(),
    queryFn: getWorkspaceSummaryAction,
    enabled: isWorkspaceOpen,
    staleTime: 30_000,
  });
  const taskCount = summary?.success ? summary.taskCount : 0;
  // Project invitations are already included in the workspace summary; only
  // add connection requests from the shared Connections attention source.
  const requestCount = (summary?.success ? summary.requestCount : 0) + pendingConnections;
  const tabs = [
    { id: "tasks" as const, label: "Tasks", icon: ListChecks, count: taskCount },
    { id: "requests" as const, label: "Invitations", icon: Inbox, count: requestCount },
  ];

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex]!;
    setActiveTab(next.id);
    document.getElementById(`workspace-${next.id}-tab`)?.focus();
  };

  return (
    <Dialog open={isWorkspaceOpen} onOpenChange={setWorkspaceOpen}>
      <DialogContent
        data-testid="workspace-drawer"
        id="workspace-drawer"
        presentation="right-drawer"
        showCloseButton={false}
        overlayClassName="z-[200] bg-black/60 backdrop-blur-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const launcher = document.getElementById("workspace-launcher");
          if (!launcher) return;
          event.preventDefault();
          launcher.focus();
        }}
        className="z-[201] h-full w-full max-w-full gap-0 border-border bg-card p-0 text-card-foreground shadow-lg sm:w-[520px] sm:max-w-[520px]"
      >
        <div className="flex-shrink-0 border-b border-border">
          <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
            <div className="flex shrink-0 items-center gap-2">
              <DialogTitle className="nb-card-title text-[17px] font-semibold text-foreground">
                My work
              </DialogTitle>
              <DialogDescription className="sr-only">
                Review open work and pending invitations.
              </DialogDescription>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <OpenInIdeButton className="min-w-0 shrink" />
              <DialogClose
                aria-label="Close workspace"
                className="nb-icon-button min-h-8 min-w-8 shrink-0 rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogClose>
            </div>
          </div>

          <div
            role="tablist"
            className="flex w-full items-center gap-4 px-4 pb-0 md:px-6"
          >
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return <button
                key={tab.id}
                id={`workspace-${tab.id}-tab`}
                data-testid={`workspace-tab-${tab.id}`}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-controls={`workspace-${tab.id}-panel`}
                className={cn(
                  "flex min-h-11 items-center gap-2 border-b-2 px-1 pb-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{tab.label}</span>
                {tab.count > 0 && <span aria-label={tab.id === "tasks" ? `${tab.count} tasks assigned to you` : `${tab.count} pending invitations`} className="nb-tab-count">{tab.count > 99 ? "99+" : tab.count}</span>}
              </button>;
            })}
          </div>
        </div>

        <div className={cn(
          "relative flex-1 overflow-y-auto bg-card px-4 pb-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6",
        )}>
          {activeTab === "tasks" ? (
            <WorkspaceTasksTab isActive={activeTab === "tasks"} />
          ) : (
            <WorkspaceRequestsTab isActive={activeTab === "requests"} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
