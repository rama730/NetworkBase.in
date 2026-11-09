"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { SecurityActivityEntry } from "@/types/settingsTypes";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { formatDateTime } from "@/lib/ui/date-formatting";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast, feedbackError } from "@/lib/feedback";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";

type SecurityActivitySectionProps = {
  activity: SecurityActivityEntry[] | undefined;
  /** More entries exist older than the ones in `activity`. */
  hasMore?: boolean;
  /** What the person can verify with: clearing the whole log asks for it first. */
  availableStepUpMethods?: Array<"totp" | "recovery_code" | "password">;
  primaryTotpFactorId?: string;
};

const DEFAULT_VISIBLE_ITEMS = 6;

const EVENT_LABELS: Record<SecurityActivityEntry["eventType"], string> = {
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
  account_deletion_scheduled: "Account deletion scheduled",
  account_deletion_cancelled: "Account deletion canceled",
  project_ownership_transferred_out: "Workspace ownership handed over",
  project_ownership_transferred_in: "Workspace ownership received",
};

function getEventSummary(entry: SecurityActivityEntry): string | null {
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

export default function SecurityActivitySection({ activity, hasMore = false, availableStepUpMethods = [], primaryTotpFactorId }: SecurityActivitySectionProps) {
  const [items, setItems] = useState<SecurityActivityEntry[]>(activity ?? []);
  const [more, setMore] = useState(hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (Array.isArray(activity)) {
      setItems(activity);
      setMore(hasMore);
    }
  }, [activity, hasMore]);

  const loadOlder = async () => {
    const last = items[items.length - 1];
    if (!last || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/v1/security?activityBefore=${encodeURIComponent(last.createdAt)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) throw new Error(json?.message || "Couldn’t load older activity");
      const page = json.data as { securityActivity: SecurityActivityEntry[]; securityActivityHasMore: boolean };
      setItems((prev) => [...prev, ...page.securityActivity.filter((next) => !prev.some((known) => known.id === next.id))]);
      setMore(page.securityActivityHasMore);
      setShowAll(true);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t load older activity", "Couldn’t load older activity"));
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    setBusy(true);
    const previous = items;
    setItems((prev) => prev.filter((item) => item.id !== id));

    try {
      const res = await fetch(`/api/v1/security?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Couldn’t delete activity log");
      }
      toast.success("Security activity record removed");
    } catch (error) {
      setItems(previous);
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t delete record", "Couldn’t delete record"));
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/security?scope=all", {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.status === 403 && data?.errorCode === "STEP_UP_REQUIRED" && availableStepUpMethods.length > 0) {
        // Wiping the whole log needs a fresh check first; the dialog runs this again once it passes.
        setConfirmClearOpen(false);
        setStepUpOpen(true);
        return;
      }
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Couldn’t clear activity logs");
      }
      // Cleared only once the server says so; the list then shows the note it left behind.
      setItems([]);
      toast.success("Security activity logs cleared");
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t clear activity", "Couldn’t clear activity"));
    } finally {
      setBusy(false);
      setConfirmClearOpen(false);
    }
  };

  if (items.length === 0) {
    return (
      <p className="nb-compact text-muted-foreground">
        No security changes have been recorded yet.
      </p>
    );
  }

  const visibleItems = showAll ? items : items.slice(0, DEFAULT_VISIBLE_ITEMS);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmClearOpen(true)}
        >
          Clear all activity
        </Button>
      </div>

      <div className="space-y-2">
        {visibleItems.map((entry) => {
          const summary = getEventSummary(entry);

          return (
            <SecurityListRow
              key={entry.id}
              title={EVENT_LABELS[entry.eventType] || entry.eventType.replace(/_/g, " ")}
              meta={formatDateTime(entry.createdAt)}
              details={
                <>
                  {entry.networkFingerprint ? <span title="A short code for the network it came from, not an IP address">Network {entry.networkFingerprint}</span> : null}
                  {entry.deviceFingerprint ? (
                    <>
                      {entry.networkFingerprint ? <span>•</span> : null}
                      <span title="A short code for the device, not its name">Device {entry.deviceFingerprint}</span>
                    </>
                  ) : null}
                </>
              }
              summary={summary}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${EVENT_LABELS[entry.eventType] || "activity"} from ${formatDateTime(entry.createdAt)}`}
                  disabled={busy}
                  title="Remove this entry"
                  onClick={() => handleDeleteEntry(entry.id)}
                >
                  <X className="h-4 w-4 text-muted-foreground hover:text-destructive" strokeWidth={1.75} aria-hidden="true" />
                </Button>
              }
            />
          );
        })}
      </div>

      <div className="rounded-md border border-border bg-muted/50 px-3 py-2 nb-meta text-muted-foreground">
        Security activity stores pseudonymous network and device fingerprints instead of raw IP addresses or full user-agent strings. These records are removed when you delete your account.
      </div>

      <div className="flex flex-wrap gap-2">
        {items.length > DEFAULT_VISIBLE_ITEMS ? (
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-11"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "Show fewer security events" : `Show all ${items.length} security events`}
          </Button>
        ) : null}
        {more && (showAll || items.length <= DEFAULT_VISIBLE_ITEMS) ? (
          <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? "Loading…" : "Load older events"}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear security activity?"
        description="This will clear your recent security activity records. This action cannot be undone."
        confirmLabel="Clear all activity"
        pendingLabel="Clearing…"
        variant="destructive"
        loading={busy}
        onConfirm={handleClearAll}
      />

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Clearing your security activity needs one more check."
        availableMethods={availableStepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={handleClearAll}
      />
    </div>
  );
}
