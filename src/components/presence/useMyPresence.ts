"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { actions } from "@/components/presence/usePresence";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/query-keys";

/** Your own status and privacy settings (the picker). */
export function useMyPresenceSettings(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.presence.mine(),
    enabled: enabled && Boolean(user),
    queryFn: async () => {
      const result = await (await actions()).getMyPresenceSettings();
      if (!result.success) throw new Error(result.error);
      return result.settings;
    },
    staleTime: 60_000,
  });
}

/** After a change: your settings and every badge refetch. */
export function useRefreshPresence() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: queryKeys.presence.root() }), [queryClient]);
}
