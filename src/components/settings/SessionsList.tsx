"use client";

import { useEffect, useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast, feedbackError } from "@/lib/feedback";
import { parseUserAgent } from "@/lib/utils/device";
import type { Session } from "@/types/settingsTypes";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { formatDateTime } from "@/lib/ui/date-formatting";

interface SessionsListProps {
  initialSessions?: Session[];
  availableStepUpMethods: Array<"totp" | "recovery_code" | "password">;
  primaryTotpFactorId?: string;
}

type PendingAction =
  | { type: "current"; id: string }
  | { type: "others" }
  | null;

export function SessionsList({
  initialSessions,
  availableStepUpMethods,
  primaryTotpFactorId,
}: SessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions ?? []);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Array.isArray(initialSessions)) {
      setSessions(initialSessions);
    }
  }, [initialSessions]);

  const handleLogOutCurrent = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const contentType = res.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await res.json() : null;
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || `Failed to sign out this device (${res.status})`);
      }

      window.location.assign("/login");
    } catch (error) {
      throw error instanceof Error ? error : new Error("Failed to sign out this device");
    } finally {
      setBusy(false);
    }
  };

  const handleLogOutOthers = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/sessions?scope=others", { method: "DELETE" });
      const contentType = res.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await res.json() : null;
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || `Failed to sign out other devices (${res.status})`);
      }

      setSessions((prev) => prev.filter((session) => session.is_current));
      toast.success("Other devices were signed out");
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Failed to sign out other devices", "Failed to sign out other devices"));
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const hasOtherSessions = sessions.some((session) => !session.is_current);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {hasOtherSessions ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (availableStepUpMethods.length > 0) {
                setPendingAction({ type: "others" });
                setStepUpOpen(true);
                return;
              }
              setPendingAction({ type: "others" });
              void handleLogOutOthers();
            }}
          >
            {busy && pendingAction?.type === "others" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing out…
              </>
            ) : (
              "Sign out other devices"
            )}
          </Button>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <p className="nb-compact text-muted-foreground">No active sessions found.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => {
            const { browser, os, icon: Icon } = parseUserAgent(session.device_info.userAgent);

            return <SecurityListRow
              key={session.id}
              icon={Icon}
              title={`${browser} on ${os}`}
              badges={<>
                {session.is_current ? (
                        <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 nb-meta font-medium text-foreground">
                          This device
                        </span>
                      ) : null}
                      {session.aal === "aal2" ? (
                        <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 nb-meta font-medium text-foreground">
                          MFA verified
                        </span>
                      ) : null}
              </>}
              details={<>
                <span>{session.ip_address || "IP unavailable"}</span>
                      {session.created_at ? (
                        <>
                          <span>•</span>
                          <span>Signed in {formatDateTime(session.created_at)}</span>
                        </>
                      ) : null}
                      <span>•</span>
                <span>Last active {session.last_active ? formatDateTime(session.last_active) : "unknown"}</span>
              </>}
              action={session.is_current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Sign out this device"
                    disabled={busy}
                    onClick={() => setPendingAction({ type: "current", id: session.id })}
                  >
                    <LogOut className="h-4 w-4 text-destructive" strokeWidth={1.75} />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Sign out remote device"
                    disabled={busy}
                    onClick={() => {
                      if (availableStepUpMethods.length > 0) {
                        setPendingAction({ type: "others" });
                        setStepUpOpen(true);
                        return;
                      }
                      setPendingAction({ type: "others" });
                      void handleLogOutOthers();
                    }}
                  >
                    <LogOut className="h-4 w-4 text-muted-foreground hover:text-destructive" strokeWidth={1.75} />
                  </Button>
                )}
            />;
          })}

        </div>
      )}

      <ConfirmDialog
        open={pendingAction?.type === "current"}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title="Sign out on this device?"
        description="You will need to sign in again on this device."
        confirmLabel="Sign out"
        pendingLabel="Signing out…"
        variant="destructive"
        loading={busy}
        onConfirm={() => {
          if (pendingAction?.type === "current") {
            return handleLogOutCurrent(pendingAction.id);
          }
          return Promise.resolve();
        }}
      />

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Complete one more check before logging out other devices."
        availableMethods={availableStepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={async () => {
          await handleLogOutOthers();
        }}
      />
    </div>
  );
}
