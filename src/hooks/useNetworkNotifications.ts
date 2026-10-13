import { useNetworkNotificationsContext } from "@/components/providers/NetworkNotificationsProvider";

interface UseNetworkNotificationsReturn {
  totalPending: number;
  pendingConnections: number;
  pendingInvites: number;
  totalConnections: number;
  refresh: () => Promise<void>;
}

export function useNetworkNotifications(): UseNetworkNotificationsReturn {
  return useNetworkNotificationsContext();
}
