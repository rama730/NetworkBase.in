"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";

/**
 * Sidebar report G1: the left navigation's Workspaces after something that changes it — create, join, leave,
 * rename, archive, restore, delete, detach, accept.
 */
export function useRefreshSidebar() {
    const client = useQueryClient();
    return useCallback(() => void client.invalidateQueries({ queryKey: queryKeys.profile.sidebarWorkspacesRoot() }), [client]);
}
