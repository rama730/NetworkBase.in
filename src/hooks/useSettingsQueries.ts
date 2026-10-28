"use client";

import { useRef } from "react";
import { readShellPart } from "@/lib/shell-batch";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AccountDeletionStatusData,
  ExtensionSessionData,
  ExtensionSessionsData,
  IntegrationsData,
  NotificationPreferences,
  PrivacyData,
  SecurityData,
} from "@/types/settingsTypes";
import { queryKeys } from "@/lib/query-keys";
import { normalizeNotificationPreferences } from "@/lib/notifications/preferences";
import {
  updateNotificationPreferencesAction,
} from "@/app/actions/notifications";
import { getAccountDeletionStatus } from "@/app/actions/account";
import { readActiveExtensionSessions } from "@/lib/files-tab-batch";

export const SETTINGS_STALE_MS = 2 * 60_000;
export const SETTINGS_SECURITY_STALE_MS = 60_000;
export const SETTINGS_SECONDARY_STALE_MS = 60_000;
export const SETTINGS_GC_MS = 10 * 60_000;

export const DEFAULT_PRIVACY_SETTINGS: PrivacyData = {
  settings: {
    profileVisibility: "public",
    messagePrivacy: "connections",
    connectionPrivacy: "everyone",
    blockedCount: 0,
  },
  blockedAccounts: [],
  blockedAccountsNextCursor: null,
  privacyActivity: [],
};

const DEFAULT_SECURITY_DATA: SecurityData = {
  mfaFactors: [],
  sessions: [],
  loginHistory: [],
  password: {
    hasPassword: false,
  },
  recoveryCodes: {
    configured: false,
    remainingCount: 0,
  },
  securityActivity: [],
  assurance: {
    currentLevel: null,
    nextLevel: null,
  },
};

const DEFAULT_INTEGRATIONS_DATA: IntegrationsData = {
  summary: "We could not determine how this account was created yet.",
  authConnections: [
    {
      provider: "google",
      label: "Google",
      state: "not_linked",
      detail: "Not linked to this account.",
    },
    {
      provider: "github",
      label: "GitHub",
      state: "not_linked",
      detail: "Not linked to this account.",
    },
    {
      provider: "email",
      label: "Email",
      state: "not_linked",
      detail: "Not linked to this account.",
    },
  ],
  githubService: {
    status: "not_connected",
    summary: "No GitHub repository access is currently in use.",
    detail: "Connect GitHub from a project when repository access is needed.",
    usageCount: 0,
    recoveryAction: null,
  },
};

export const DEFAULT_ACCOUNT_DELETION_STATUS: AccountDeletionStatusData = {
  pending: false,
};

export const DEFAULT_EXTENSION_SESSIONS_DATA: ExtensionSessionsData = {
  sessions: [],
  hasMore: false,
  nextCursor: null,
};

async function parseJsonResponse<T>(
  res: Response,
  fallbackMessage: string,
): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `${fallbackMessage} returned non-JSON response (${res.status})`,
    );
  }

  const json = await res.json();
  const message =
    (typeof json?.error === "string" && json.error) ||
    (typeof json?.message === "string" && json.message) ||
    `${fallbackMessage} (${res.status})`;
  if (!res.ok || json?.success === false) {
    const error = new Error(message) as Error & { errorCode?: string };
    if (typeof json?.errorCode === "string") error.errorCode = json.errorCode;
    throw error;
  }

  return json?.data as T;
}

async function fetchSecurityData(): Promise<SecurityData> {
  const res = await fetch("/api/v1/security");
  return (
    (await parseJsonResponse<SecurityData>(
      res,
      "Failed to load security data",
    )) || DEFAULT_SECURITY_DATA
  );
}

async function fetchIntegrationsData(): Promise<IntegrationsData> {
  const res = await fetch("/api/v1/integrations");
  return (
    (await parseJsonResponse<IntegrationsData>(
      res,
      "Failed to load integrations data",
    )) || DEFAULT_INTEGRATIONS_DATA
  );
}

async function fetchPrivacyData(): Promise<PrivacyData> {
  // no-store: after an unblock the next read must see it, not a 15-second-old copy from the browser cache.
  const res = await fetch("/api/v1/privacy", { cache: "no-store" });
  return (
    (await parseJsonResponse<PrivacyData>(
      res,
      "Failed to load privacy settings",
    )) || DEFAULT_PRIVACY_SETTINGS
  );
}

async function fetchAccountDeletionStatus(): Promise<AccountDeletionStatusData> {
  // No "not pending" fallback: a failed lookup must not look like an account that is safe to delete.
  return await getAccountDeletionStatus();
}

async function fetchExtensionSessionsData(): Promise<ExtensionSessionsData> {
  const result = await readActiveExtensionSessions();
  if (!result.success || !result.sessions) {
    return DEFAULT_EXTENSION_SESSIONS_DATA;
  }
  return {
    sessions: result.sessions.map(
      (session): ExtensionSessionData => ({
        ...session,
        expiresAt: new Date(session.expiresAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        createdAt: new Date(session.createdAt).toISOString(),
      }),
    ),
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
  };
}

export function useAccountDeletionStatus() {
  return useQuery({
    queryKey: queryKeys.settings.accountDeletion(),
    queryFn: fetchAccountDeletionStatus,
    staleTime: SETTINGS_SECONDARY_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    refetchOnWindowFocus: false,
  });
}

// Notification preferences
export function useNotificationPreferences({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.settings.notifications(),
    enabled,
    queryFn: async (): Promise<NotificationPreferences> => {
      const result = await readShellPart("notificationPreferences");
      // Defaults are not an answer here: shown as if real, the next toggle would save them over the person's own
      // mutes, quiet hours and organizations. Fail, and let the section show an error with Retry.
      if (!result.success || ("degraded" in result && result.degraded)) {
        throw new Error("Notification preferences could not be loaded");
      }

      return normalizeNotificationPreferences(result.preferences);
    },
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  // What the cache held before this change: the keys that differ are the ones the server should write.
  const baseRef = useRef<NotificationPreferences | null>(null);

  return useMutation({
    mutationFn: async (preferences: NotificationPreferences) => {
      const next = normalizeNotificationPreferences(preferences);
      const base = baseRef.current;
      const changedKeys = base
        ? (Object.keys(next) as Array<keyof NotificationPreferences>).filter(
            (key) => JSON.stringify(next[key]) !== JSON.stringify(base[key]),
          )
        : undefined;
      const result = await updateNotificationPreferencesAction(next, changedKeys);
      if (!result.success || !result.preferences) {
        throw new Error(
          result.error || "Failed to update notification preferences",
        );
      }
      return normalizeNotificationPreferences(result.preferences);
    },
    onMutate: async (newPrefs) => {
      // Optimistic update
      await queryClient.cancelQueries({
        queryKey: queryKeys.settings.notifications(),
      });
      const previous = queryClient.getQueryData<NotificationPreferences>(
        queryKeys.settings.notifications(),
      );
      baseRef.current = previous ?? null;
      queryClient.setQueryData(
        queryKeys.settings.notifications(),
        normalizeNotificationPreferences(newPrefs),
      );
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.settings.notifications(),
          context.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings.notifications(),
      });
    },
  });
}

// Security data
export function useSecurityData() {
  return useQuery({
    queryKey: queryKeys.settings.security(),
    queryFn: fetchSecurityData,
    retry: 1,
    staleTime: SETTINGS_SECURITY_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    refetchOnWindowFocus: false,
  });
}

export function useIntegrationsData() {
  return useQuery({
    queryKey: queryKeys.settings.integrations(),
    queryFn: fetchIntegrationsData,
    retry: 1,
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    refetchOnWindowFocus: false,
  });
}

export function useExtensionSessionsData() {
  return useQuery({
    queryKey: queryKeys.settings.extensionSessions(),
    queryFn: fetchExtensionSessionsData,
    staleTime: SETTINGS_SECONDARY_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    // Mutations invalidate this key. Focus reconciliation also catches IDE-side
    // logout without generating an idle request every three seconds.
    refetchOnWindowFocus: true,
  });
}

async function submitPasswordChangeRequest({
  currentPassword,
  newPassword,
  signOutOtherDevices,
}: {
  currentPassword: string;
  newPassword: string;
  signOutOtherDevices?: boolean;
}) {
  try {
    const res = await fetch("/api/v1/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword, signOutOtherDevices }),
    });

    await parseJsonResponse<unknown>(res, "Password change failed");
    return { success: true as const };
  } catch (error) {
    return {
      success: false as const,
      message: error instanceof Error ? error.message : "Unable to change password. Please try again.",
      errorCode: error instanceof Error && "errorCode" in error ? String(error.errorCode) : undefined,
    };
  }
}

export function useChangePassword() {
  return useMutation({
    mutationFn: submitPasswordChangeRequest,
  });
}

// Privacy settings
export function usePrivacySettings() {
  return useQuery({
    queryKey: queryKeys.settings.privacy(),
    queryFn: fetchPrivacyData,
    staleTime: SETTINGS_STALE_MS,
    gcTime: SETTINGS_GC_MS,
    refetchOnWindowFocus: false,
  });
}
