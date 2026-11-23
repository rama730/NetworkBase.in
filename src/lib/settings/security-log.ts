// Security › Changes and sign-ins (settings mix): the security changes and the recent sign-ins as one log, newest
// first, with the entries that could mean someone else flagged.
import type { LoginHistoryEntry, SecurityActivityEntry, Session } from "@/types/settingsTypes";
import { parseUserAgent } from "@/lib/utils/device";
import { shortIp } from "@/lib/settings/format";

export const EVENT_LABELS: Record<SecurityActivityEntry["eventType"], string> = {
  authenticator_app_enabled: "Authenticator enabled",
  authenticator_app_removed: "Authenticator removed",
  recovery_codes_generated: "Recovery codes generated",
  recovery_codes_regenerated: "Recovery codes regenerated",
  recovery_code_used: "Recovery code used",
  recovery_code_redemption_failed: "Recovery code redemption attempted",
  password_set: "Password added",
  password_changed: "Password changed",
  other_sessions_revoked: "Other devices logged out",
  github_account_replacement_started: "GitHub account replacement started",
  github_account_replaced: "GitHub account replaced",
  security_activity_cleared: "Security activity cleared",
  account_data_exported: "Account data exported",
  sign_in_method_linked: "Sign-in method connected",
  sign_in_method_unlinked: "Sign-in method disconnected",
  editor_token_created: "Editor token created",
  editor_token_revoked: "Token revoked from the CLI",
  agent_access_changed: "AI agent access changed",
  account_deletion_scheduled: "Account deletion scheduled",
  account_deletion_cancelled: "Account deletion canceled",
  project_ownership_transferred_out: "Workspace ownership handed over",
  project_ownership_transferred_in: "Workspace ownership received",
  branch_protection_changed: "Main's protection changed",
  merge_without_approval: "Merged into main without approval",
  branch_deleted: "Branch deleted",
  branch_restored: "Branch restored",
  cli_verified: "Terminal verified for risky actions",
  token_new_country: "Sign-in used from a new country",
};

export function getEventSummary(entry: SecurityActivityEntry): string | null {
  if (entry.eventType === "other_sessions_revoked") {
    if (typeof entry.metadata?.revokedCount === "number") {
      return `${entry.metadata.revokedCount} session${entry.metadata.revokedCount === 1 ? "" : "s"} revoked`;
    }
    return "Remote session revoked";
  }

  if (
    (entry.eventType === "recovery_codes_generated" || entry.eventType === "recovery_codes_regenerated")
    && typeof entry.metadata?.remainingCount === "number"
  ) {
    return `${entry.metadata.remainingCount} recovery codes available`;
  }

  if (entry.eventType === "authenticator_app_removed" && entry.metadata?.clearedRecoveryCodes === true) {
    return "Recovery codes were cleared because no authenticator app remains";
  }

  if (entry.eventType === "recovery_code_redemption_failed") {
    const reason = typeof entry.metadata?.failureReason === "string"
      ? entry.metadata.failureReason
      : null;
    if (reason === "factor_invalidated") {
      return "Attempt rejected — authenticator app has been replaced";
    }
    if (reason === "code_mismatch") {
      return "Submitted code did not match any active recovery code";
    }
    return "An attempt to redeem a recovery code was rejected";
  }

  return null;
}

export type SecurityLogEntry = {
  key: string;
  source: "activity" | "signin";
  id: string;
  at: string;
  label: string;
  detail: string;
  /** Why it may not have been you ("New browser"), or null. */
  risky: string | null;
};

const RISKY_EVENTS: Partial<Record<SecurityActivityEntry["eventType"], string>> = {
  token_new_country: "New country",
  recovery_code_redemption_failed: "Failed code",
};

const device = (userAgent: string | null | undefined) => {
  const { browser, os } = parseUserAgent(userAgent);
  return `${browser} on ${os}`;
};

export function buildSecurityLog(activity: SecurityActivityEntry[], history: LoginHistoryEntry[], sessions: Session[]): SecurityLogEntry[] {
  const current = new Set(sessions.map((session) => device(session.device_info?.userAgent)));
  const seen = new Map<string, number>();
  for (const entry of history) seen.set(device(entry.user_agent), (seen.get(device(entry.user_agent)) ?? 0) + 1);
  const oldest = [...history].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.id;

  const signIns = history.map((entry): SecurityLogEntry => {
    const name = device(entry.user_agent);
    const fresh = history.length > 1 && entry.id !== oldest && !current.has(name) && seen.get(name) === 1;
    return {
      key: `signin:${entry.id}`, source: "signin", id: entry.id, at: entry.created_at, label: "Signed in",
      detail: [name, shortIp(entry.ip_address) || null, entry.location || null, entry.aal === "aal2" ? "with two-step" : null].filter(Boolean).join(" · "),
      risky: fresh ? "New browser" : null,
    };
  });
  const changes = activity.map((entry): SecurityLogEntry => ({
    key: `activity:${entry.id}`, source: "activity", id: entry.id, at: entry.createdAt,
    label: EVENT_LABELS[entry.eventType] || entry.eventType.replace(/_/g, " "),
    detail: getEventSummary(entry) ?? [entry.networkFingerprint ? `network ${entry.networkFingerprint}` : null, entry.deviceFingerprint ? `device ${entry.deviceFingerprint}` : null].filter(Boolean).join(" · "),
    risky: RISKY_EVENTS[entry.eventType] ?? null,
  }));
  return [...signIns, ...changes].sort((a, b) => b.at.localeCompare(a.at));
}
