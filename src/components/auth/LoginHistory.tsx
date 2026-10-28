"use client";

import { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import { parseUserAgent, cleanIpAddress } from "@/lib/utils/device";
import type { LoginHistoryEntry } from "@/types/settingsTypes";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { formatDateTime } from "@/lib/ui/date-formatting";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast, feedbackError } from "@/lib/feedback";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";

interface LoginHistoryProps {
  initialHistory?: LoginHistoryEntry[];
  /** What the person can verify with: clearing the whole list asks for it first. */
  availableStepUpMethods?: Array<"totp" | "recovery_code" | "password">;
  primaryTotpFactorId?: string;
}

export default function LoginHistory({ initialHistory = [], availableStepUpMethods = [], primaryTotpFactorId }: LoginHistoryProps) {
  const [history, setHistory] = useState<LoginHistoryEntry[]>(initialHistory);
  const [busy, setBusy] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  useEffect(() => {
    if (Array.isArray(initialHistory)) {
      setHistory(initialHistory);
    }
  }, [initialHistory]);

  const handleDismissEntry = async (id: string) => {
    setBusy(true);
    const previous = history;
    setHistory((prev) => prev.filter((item) => item.id !== id));

    try {
      const res = await fetch(`/api/v1/sessions?scope=history&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Failed to remove entry");
      }
      toast.success("Sign-in entry removed");
    } catch (error) {
      setHistory(previous);
      toast.error(feedbackError(error instanceof Error ? error.message : "Failed to remove entry", "Failed to remove entry"));
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/sessions?scope=history_all", {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.status === 403 && data?.errorCode === "STEP_UP_REQUIRED" && availableStepUpMethods.length > 0) {
        // Wiping the whole list needs a fresh check first; the dialog runs this again once it passes.
        setConfirmClearOpen(false);
        setStepUpOpen(true);
        return;
      }
      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Failed to clear history");
      }
      setHistory([]);
      toast.success("Recent sign-in history cleared");
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Failed to clear history", "Failed to clear history"));
    } finally {
      setBusy(false);
      setConfirmClearOpen(false);
    }
  };

  if (history.length === 0) {
    return (
      <p className="nb-compact text-muted-foreground">No recent sign-in activity is available yet.</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmClearOpen(true)}
        >
          Clear sign-in history
        </Button>
      </div>

      <div className="space-y-2">
        {history.map((entry) => {
          const { browser, os, icon: Icon } = parseUserAgent(entry.user_agent);
          const cleanIp = cleanIpAddress(entry.ip_address);
          const title = `${browser} on ${os}`;

          return (
            <SecurityListRow
              key={entry.id}
              icon={Icon}
              title={title}
              badges={
                entry.aal === "aal2" ? (
                  <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 nb-meta font-medium text-foreground">
                    Protected by authenticator app
                  </span>
                ) : null
              }
              details={
                <>
                  <span>{cleanIp}</span>
                  {entry.location ? (
                    <>
                      <span>•</span>
                      <MapPin className="h-3 w-3" />
                      <span>{entry.location}</span>
                    </>
                  ) : null}
                  <span>•</span>
                  <span>{formatDateTime(entry.created_at)}</span>
                </>
              }
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove sign-in entry"
                  disabled={busy}
                  title="Remove from history"
                  onClick={() => handleDismissEntry(entry.id)}
                >
                  <X className="h-4 w-4 text-muted-foreground hover:text-destructive" strokeWidth={1.75} />
                </Button>
              }
            />
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear sign-in history?"
        description="This will clear your recent sign-in history list. Active sessions will not be affected."
        confirmLabel="Clear history"
        pendingLabel="Clearing…"
        variant="destructive"
        loading={busy}
        onConfirm={handleClearAll}
      />

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Clearing your sign-in history needs one more check."
        availableMethods={availableStepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={handleClearAll}
      />
    </div>
  );
}
