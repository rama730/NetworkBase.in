"use client";

import { ChevronRight, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { readShellPart } from "@/lib/shell-batch";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";

export default function WorkspaceIndicator() {
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const openWorkspace = useUIStore((s) => s.openWorkspace);
    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const { pendingConnections } = useNetworkNotifications();
    const { data: summary } = useQuery({
        queryKey: queryKeys.workspace.summary(),
        queryFn: () => readShellPart("workspaceSummary"),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
    const actionCount = summary?.success
        ? summary.taskCount + summary.requestCount + pendingConnections
        : pendingConnections;
    const hasAction = actionCount > 0;

    return (
        <button
            id="workspace-launcher"
            type="button"
            onClick={() => isWorkspaceOpen ? setWorkspaceOpen(false) : openWorkspace("tasks")}
            aria-controls="workspace-drawer"
            aria-expanded={isWorkspaceOpen}
            aria-haspopup="dialog"
            title="My work"
            aria-label={`${isWorkspaceOpen ? "Close" : "Open"} Workspace${hasAction ? `, ${actionCount} item${actionCount === 1 ? "" : "s"} need attention` : ""}`}
            className={cn(
                "nb-nav-link w-full",
                isWorkspaceOpen
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            )}
        >
            <ListChecks size={16} aria-hidden="true" />
            <span className="nb-sidebar-label">My work</span>
            <ChevronRight
                className={cn(
                    "nb-sidebar-label h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                    isWorkspaceOpen && "rotate-90",
                )}
                style={{ transform: isWorkspaceOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                aria-hidden="true"
            />
            {hasAction ? (
                <span
                    aria-label={`${actionCount} workspace items need attention`}
                    className="nb-nav-count"
                >
                    {actionCount > 99 ? "99+" : actionCount}
                </span>
            ) : null}
        </button>
    );
}
