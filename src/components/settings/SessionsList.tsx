"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast, feedbackError } from "@/lib/feedback";
import { parseUserAgent } from "@/lib/utils/device";
import { activeAgo, logDate, shortIp } from "@/lib/settings/format";
import { padCount } from "@/lib/ui/tab-marker";
import { Tag } from "@/components/settings/mix/parts";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import type { Session } from "@/types/settingsTypes";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";

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
      if (!res.ok || json?.success === false) throw new Error(json?.message || "Couldn’t load more devices");
      const page = json.data as { sessions: Session[]; pagination: { hasMore: boolean; nextOffset: number | null } };
      // A device signed in meanwhile can shift the pages: never show one twice.
      setSessions((prev) => [...prev, ...page.sessions.filter((next) => !prev.some((known) => known.id === next.id))]);
      setNextOffset(page.pagination.hasMore ? page.pagination.nextOffset : null);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t load more devices", "Couldn’t load more devices"));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLogOutCurrent = async (id: string) => {
    setBusy(true);
    try {
      await send(`/api/v1/sessions?id=${encodeURIComponent(id)}`, "Couldn’t sign out this device");
      window.location.replace("/login");
    } catch (error) {
      throw error instanceof Error ? error : new Error("Couldn’t sign out this device");
    } finally {
      setBusy(false);
    }
  };

  const handleLogOutRemote = async (id: string) => {
    setBusy(true);
    try {
      await send(`/api/v1/sessions?id=${encodeURIComponent(id)}`, "Couldn’t sign out device");
      setSessions((prev) => prev.filter((session) => session.id !== id));
      toast.success("Device signed out");
      refreshSecurity();
    } catch (error) {
      // Already gone (404): the list was stale, so drop it rather than leave a device that can't be signed out.
      if ((error as { status?: number }).status === 404) {
        setSessions((prev) => prev.filter((session) => session.id !== id));
        refreshSecurity();
      }
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t sign out device", "Couldn’t sign out device"));
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

  // "Not you?" in the log starts the same sign-out of the other devices.
  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent).detail !== "signout-others") return;
      if (availableStepUpMethods.length > 0) setStepUpOpen(true);
      else setPendingAction({ type: "others" });
    };
    window.addEventListener("nbs:open", open);
    return () => window.removeEventListener("nbs:open", open);
  }, [availableStepUpMethods.length]);

  const signOutOthers = hasOtherSessions ? (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      pending={busy && (pendingAction?.type === "others" || stepUpOpen)}
      onClick={() => {
        // With something to verify with, the verification dialog is the confirmation; otherwise ask once.
        if (availableStepUpMethods.length > 0) setStepUpOpen(true);
        else setPendingAction({ type: "others" });
      }}
    >
      Sign out other devices
    </Button>
  ) : null;

  return (
    <SettingsSectionCard id="settings-security-sessions" testId="security-active-sessions-section" title="Signed-in devices" state={padCount(sessions.length) + (nextOffset !== null ? "+" : "")} stateOk right={signOutOthers} flush findKeys="devices sessions">
      {sessions.length === 0 ? (
        <p className="nbs-ghelp">No devices are signed in.</p>
      ) : (
        <div className="nbs-list">
          {sessions.map((session) => {
            const rawUa = session.device_info?.userAgent;
            const { browser, os, icon: Icon } = parseUserAgent(
              session.is_current && (!rawUa || rawUa === "Unknown device")
                ? undefined
                : rawUa
            );
            const deviceTitle = `${browser} on ${os}`;
            const ip = shortIp(session.ip_address);
            const detail = [
              session.created_at ? `Signed in ${logDate(session.created_at)}` : null,
              session.is_current ? "active now" : activeAgo(session.last_active) || null,
              ip || null,
            ].filter(Boolean).join(" · ");

            return (
              <SecurityListRow
                key={session.id}
                icon={Icon}
                title={deviceTitle}
                badges={<>
                  {session.is_current ? <Tag tone="hot">This device</Tag> : null}
                  {session.aal === "aal2" ? <Tag>Two-step</Tag> : null}
                </>}
                details={detail}
                action={
                  <button
                    type="button"
                    className="nbs-ib danger"
                    aria-label={session.is_current ? `Sign out this device (${deviceTitle})` : `Sign out ${deviceTitle}`}
                    disabled={busy}
                    onClick={() => setPendingAction(session.is_current ? { type: "current", id: session.id } : { type: "remote", id: session.id, name: deviceTitle })}
                  >
                    <LogOut strokeWidth={1.75} aria-hidden="true" />
                  </button>
                }
              />
            );
          })}
        </div>
      )}

      {nextOffset !== null ? (
        <div className="nbs-more">
          <Button pending={loadingMore} pendingLabel="Loading" variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>Show more devices</Button>
        </div>
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
    </SettingsSectionCard>
  );
}
