"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast, feedbackError } from "@/lib/feedback";
import { parseUserAgent, cleanIpAddress } from "@/lib/utils/device";
import type { Session } from "@/types/settingsTypes";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { formatDateTime } from "@/lib/ui/date-formatting";

interface SessionsListProps {
  initialSessions?: Session[];
  /** Where the next page of devices starts; null or missing when every device is already loaded. */
  initialNextOffset?: number | null;
  availableStepUpMethods: Array<"totp" | "recovery_code" | "password">;
  primaryTotpFactorId?: string;
}

type PendingAction =
  | { type: "current"; id: string }
  | { type: "remote"; id: string; name: string }
  | { type: "others" }
  | null;

export function SessionsList({
  initialSessions,
  initialNextOffset = null,
  availableStepUpMethods,
  primaryTotpFactorId,
}: SessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions ?? []);
  const [nextOffset, setNextOffset] = useState<number | null>(initialNextOffset);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  // Signing a device out adds a line to the activity list below: refresh it too.
  const refreshSecurity = () => void queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });

  /** One request for all three sign-outs: throws the server's own message when it refuses. */
  const send = async (url: string, fallback: string) => {
    const res = await fetch(url, { method: "DELETE" });
    const contentType = res.headers.get("content-type") || "";
    const json = contentType.includes("application/json") ? await res.json() : null;
    if (!res.ok || json?.success === false) {
      throw Object.assign(new Error(json?.message || `${fallback} (${res.status})`), { status: res.status });
    }
  };

  useEffect(() => {
    if (Array.isArray(initialSessions)) {
      setSessions(initialSessions);
      setNextOffset(initialNextOffset);
    }
  }, [initialSessions, initialNextOffset]);

  const loadMore = async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/v1/sessions?limit=12&offset=${nextOffset}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) throw new Error(json?.message || "Failed to load more devices");
      const page = json.data as { sessions: Session[]; pagination: { hasMore: boolean; nextOffset: number | null } };
      // A device signed in meanwhile can shift the pages: never show one twice.
      setSessions((prev) => [...prev, ...page.sessions.filter((next) => !prev.some((known) => known.id === next.id))]);
      setNextOffset(page.pagination.hasMore ? page.pagination.nextOffset : null);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Failed to load more devices", "Failed to load more devices"));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLogOutCurrent = async (id: string) => {
    setBusy(true);
    try {
      await send(`/api/v1/sessions?id=${encodeURIComponent(id)}`, "Failed to sign out this device");
      window.location.assign("/login");
    } catch (error) {
      throw error instanceof Error ? error : new Error("Failed to sign out this device");
    } finally {
      setBusy(false);
    }
  };

  const handleLogOutRemote = async (id: string) => {
    setBusy(true);
    try {
      await send(`/api/v1/sessions?id=${encodeURIComponent(id)}`, "Failed to sign out device");
      setSessions((prev) => prev.filter((session) => session.id !== id));
      toast.success("Device signed out");
      refreshSecurity();
    } catch (error) {
      // Already gone (404): the list was stale, so drop it rather than leave a device that can't be signed out.
      if ((error as { status?: number }).status === 404) {
        setSessions((prev) => prev.filter((session) => session.id !== id));
        refreshSecurity();
      }
      toast.error(feedbackError(error instanceof Error ? error.message : "Failed to sign out device", "Failed to sign out device"));
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const handleLogOutOthers = async () => {
    setBusy(true);
    try {
      await send("/api/v1/sessions?scope=others", "Couldn’t sign out other devices");
      setSessions((prev) => prev.filter((session) => session.is_current));
      toast.success("Other devices were signed out");
      refreshSecurity();
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t sign out other devices", "Couldn’t sign out other devices"));
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const hasOtherSessions = sessions.some((session) => !session.is_current);

  return (
    <div className="space-y-4">
      {hasOtherSessions ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              // With something to verify with, the verification dialog is the confirmation; otherwise ask once.
              if (availableStepUpMethods.length > 0) setStepUpOpen(true);
              else setPendingAction({ type: "others" });
            }}
          >
            {busy && (pendingAction?.type === "others" || stepUpOpen) ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Signing out…
              </>
            ) : (
              "Sign out other devices"
            )}
          </Button>
        </div>
      ) : null}

      {sessions.length === 0 ? (
        <p className="nb-compact text-muted-foreground">No active sessions found.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => {
            const rawUa = session.device_info?.userAgent;
            const { browser, os, icon: Icon } = parseUserAgent(
              session.is_current && (!rawUa || rawUa === "Unknown device")
                ? undefined
                : rawUa
            );
            const cleanIp = cleanIpAddress(session.ip_address);
            const deviceTitle = `${browser} on ${os}`;

            return (
              <SecurityListRow
                key={session.id}
                icon={Icon}
                title={deviceTitle}
                badges={
                  <>
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
                  </>
                }
                details={
                  <>
                    <span>{cleanIp}</span>
                    {session.created_at ? (
                      <>
                        <span>•</span>
                        <span>Signed in {formatDateTime(session.created_at)}</span>
                      </>
                    ) : null}
                    <span>•</span>
                    <span>Last active {session.last_active ? formatDateTime(session.last_active) : "unknown"}</span>
                  </>
                }
                action={
                  session.is_current ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Sign out this device (${deviceTitle})`}
                      disabled={busy}
                      title="Sign out this device"
                      onClick={() => setPendingAction({ type: "current", id: session.id })}
                    >
                      <LogOut className="h-4 w-4 text-destructive" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Sign out ${deviceTitle}`}
                      disabled={busy}
                      title={`Sign out ${deviceTitle}`}
                      onClick={() => setPendingAction({ type: "remote", id: session.id, name: deviceTitle })}
                    >
                      <LogOut className="h-4 w-4 text-muted-foreground hover:text-destructive" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  )
                }
              />
            );
          })}
        </div>
      )}

      {nextOffset !== null ? (
        <Button variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading…</> : "Show more devices"}
        </Button>
      ) : null}

      {/* Confirm Sign Out on Current Device */}
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

      {/* Confirm Sign Out on Single Remote Device */}
      <ConfirmDialog
        open={pendingAction?.type === "remote"}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title="Sign out device?"
        description="This will immediately revoke access from this device."
        confirmLabel="Sign out"
        pendingLabel="Signing out…"
        variant="destructive"
        loading={busy}
        onConfirm={() => {
          if (pendingAction?.type === "remote") {
            return handleLogOutRemote(pendingAction.id);
          }
          return Promise.resolve();
        }}
      />

      {/* Confirm Sign Out Other Devices */}
      <ConfirmDialog
        open={pendingAction?.type === "others"}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title="Sign out other devices?"
        description="All other active sessions will be signed out."
        confirmLabel="Sign out other devices"
        pendingLabel="Signing out…"
        variant="destructive"
        loading={busy}
        onConfirm={() => handleLogOutOthers()}
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
