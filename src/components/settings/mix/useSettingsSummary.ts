"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useAccountDeletionStatus, useNotificationPreferences, usePrivacySettings, useSecurityData } from "@/hooks/useSettingsQueries";
import { NOTIFICATION_PREFERENCE_CATEGORIES } from "@/lib/notifications/preferences";
import { checkupItems, navStates, type CheckupState } from "@/lib/settings/checkup";
import { queryKeys } from "@/lib/query-keys";

export type LegalAcceptance = {
  current: boolean;
  versions?: { termsVersion: string; eulaVersion: string; privacyNoticeVersion: string };
  history?: Array<{ acceptedAt: string; termsVersion: string; eulaVersion: string; privacyNoticeVersion: string; context: string }>;
  latest: { acceptedAt: string; termsVersion: string; eulaVersion: string; privacyNoticeVersion: string } | null;
};

export const legalAcceptanceKey = () => [...queryKeys.settings.root(), "legal-acceptance"] as const;

/** Terms acceptance, shared by Legal and data and the check-up. */
export function useLegalAcceptance() {
  return useQuery({
    queryKey: legalAcceptanceKey(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch("/api/v1/legal/acceptance", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false || !payload?.data) throw new Error("Acceptance status unavailable");
      return payload.data as LegalAcceptance;
    },
  });
}

/** This browser's notification permission; changes when the person comes back from the site settings. */
export function useBrowserPermission(): CheckupState["browserPermission"] {
  const [permission, setPermission] = useState<CheckupState["browserPermission"]>("default");
  useEffect(() => {
    const read = () => setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  return permission;
}

/** What the band, the check-up and the nav say about the account, from the same queries the sections use. */
export function useSettingsSummary() {
  const { user, profile } = useAuth();
  const security = useSecurityData();
  const privacy = usePrivacySettings();
  const notifications = useNotificationPreferences();
  const deletion = useAccountDeletionStatus();
  const legal = useLegalAcceptance();
  const browserPermission = useBrowserPermission();

  const factors = security.data?.mfaFactors ?? [];
  const twoStepOn = factors.some((factor) => factor.type === "totp" && factor.status === "verified");
  const recoveryCodesLeft = security.data?.recoveryCodes?.remainingCount ?? 0;
  const emailVerified = Boolean(user?.email_confirmed_at);
  const prefs = notifications.data;
  const pausedUntil = prefs?.pausedUntil && new Date(prefs.pausedUntil).getTime() > Date.now() ? prefs.pausedUntil : null;
  const typesOn = prefs ? NOTIFICATION_PREFERENCE_CATEGORIES.filter((category) => prefs[category.key]).length : null;
  const hardDeleteAt = deletion.data?.pending ? deletion.data.hardDeleteAt ?? null : null;
  const deleteOn = hardDeleteAt ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(hardDeleteAt)) : null;
  // Until security has loaded, two-step and codes are unknown: no nav state or check-up item claims them yet.
  const securityKnown = Boolean(security.data);

  const checkup = securityKnown
    ? checkupItems({ emailVerified, twoStepOn, recoveryCodesLeft, browserPermission, termsAccepted: legal.data ? legal.data.current : null })
    : [];
  const states = navStates({ emailVerified: emailVerified || !user, twoStepOn: twoStepOn || !securityKnown, recoveryCodesLeft: securityKnown ? recoveryCodesLeft : 99, paused: Boolean(pausedUntil), deleteOn });

  return {
    user, profile, emailVerified, twoStepOn, recoveryCodesLeft, securityKnown,
    sessions: security.data?.sessions ?? null,
    privacy: privacy.data?.settings ?? null,
    pausedUntil, typesOn, typesTotal: NOTIFICATION_PREFERENCE_CATEGORIES.length,
    hardDeleteAt, checkup, states, browserPermission,
    legal: legal.data ?? null,
  };
}
