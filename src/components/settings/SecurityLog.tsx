"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "@/components/ui/icons";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LogList, Tag } from "@/components/settings/mix/parts";
import { openSetting } from "@/components/settings/mix/jump";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { feedbackError, toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { logDate } from "@/lib/settings/format";
import { buildSecurityLog, type SecurityLogEntry } from "@/lib/settings/security-log";
import type { LoginHistoryEntry, SecurityActivityEntry, Session } from "@/types/settingsTypes";

type Props = {
  activity: SecurityActivityEntry[] | undefined;
  hasMore?: boolean;
  history: LoginHistoryEntry[] | undefined;
  sessions: Session[] | undefined;
  /** What the person can verify with: clearing the log asks for it first. */
  availableStepUpMethods?: Array<"totp" | "recovery_code" | "password">;
  primaryTotpFactorId?: string;
};

const ENDPOINT = {
  one: (entry: SecurityLogEntry) => (entry.source === "activity" ? `/api/v1/security?id=${encodeURIComponent(entry.id)}` : `/api/v1/sessions?scope=history&id=${encodeURIComponent(entry.id)}`),
  all: ["/api/v1/security?scope=all", "/api/v1/sessions?scope=history_all"],
};

/**
 * Security › Changes and sign-ins (settings mix v2): one log of security changes and sign-ins, risky ones in clay
 * with "Not you?" (signs out the other devices, then opens Change password). Each entry can be removed; Clear all
 * empties both after a fresh check.
 */
export function SecurityLog({ activity, hasMore = false, history, sessions, availableStepUpMethods = [], primaryTotpFactorId }: Props) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<SecurityActivityEntry[]>(activity ?? []);
  const [signIns, setSignIns] = useState<LoginHistoryEntry[]>(history ?? []);
  const [more, setMore] = useState(hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [notMe, setNotMe] = useState<SecurityLogEntry | null>(null);

  useEffect(() => { if (Array.isArray(activity)) { setItems(activity); setMore(hasMore); } }, [activity, hasMore]);
  useEffect(() => { if (Array.isArray(history)) setSignIns(history); }, [history]);
  const log = useMemo(() => buildSecurityLog(items, signIns, sessions ?? []), [items, signIns, sessions]);

  const remove = async (entry: SecurityLogEntry) => {
    const before = { items, signIns };
    if (entry.source === "activity") setItems((list) => list.filter((item) => item.id !== entry.id));
    else setSignIns((list) => list.filter((item) => item.id !== entry.id));
    try {
      const response = await fetch(ENDPOINT.one(entry), { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) throw new Error(payload?.message || "Couldn’t remove that entry");
    } catch (error) {
      setItems(before.items);
      setSignIns(before.signIns);
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t remove that entry"));
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      for (const url of ENDPOINT.all) {
        const response = await fetch(url, { method: "DELETE" });
        const payload = await response.json().catch(() => null);
        if (response.status === 403 && payload?.errorCode === "STEP_UP_REQUIRED" && availableStepUpMethods.length > 0) {
          // Emptying the log needs a fresh check first; the dialog runs this again once it passes.
          setConfirmClear(false);
          setStepUpOpen(true);
          return;
        }
        if (!response.ok || payload?.success === false) throw new Error(payload?.message || "Couldn’t clear the log");
      }
      setItems([]);
      setSignIns([]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t clear the log"));
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  };

  const loadOlder = async () => {
    const last = items[items.length - 1];
    if (!last || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const response = await fetch(`/api/v1/security?activityBefore=${encodeURIComponent(last.createdAt)}`, { cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.success === false) throw new Error(json?.message || "Couldn’t load older entries");
      const page = json.data as { securityActivity: SecurityActivityEntry[]; securityActivityHasMore: boolean };
      setItems((list) => [...list, ...page.securityActivity.filter((next) => !list.some((known) => known.id === next.id))]);
      setMore(page.securityActivityHasMore);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t load older entries"));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <SettingsSectionCard id="settings-security-activity" testId="security-activity-section" title="Changes and sign-ins" flush findKeys="log history activity sign-ins"
      right={log.length ? <Button type="button" variant="ghost" size="sm" className="text-[var(--status-danger)] hover:text-[var(--status-danger)]" disabled={busy} onClick={() => setConfirmClear(true)}>Clear all</Button> : undefined}>
      <LogList
        label="Changes and sign-ins"
        empty={<p className="nbs-ghelp">Nothing recorded yet. Sign-ins and security changes show up here.</p>}
        entries={log.map((entry) => ({
          key: entry.key,
          date: logDate(entry.at),
          dateTime: entry.at,
          risky: Boolean(entry.risky),
          event: <>{entry.label}{entry.risky ? <> <Tag tone="hot">{entry.risky}</Tag></> : null}</>,
          detail: entry.detail,
          actions: <>
            {entry.risky ? <Button type="button" variant="outline" size="sm" onClick={() => setNotMe(entry)}>Not you?</Button> : null}
            <button type="button" className="nbs-ib" aria-label={`Remove “${entry.label}” from ${logDate(entry.at)}`} onClick={() => void remove(entry)}><X strokeWidth={1.75} aria-hidden="true" /></button>
          </>,
        }))}
        older={more ? <Button type="button" variant="ghost" size="sm" pending={loadingOlder} onClick={() => void loadOlder()}>Load older</Button> : undefined}
      />
      <p className="nbs-foot">Network and device are short codes, not your IP address or device name. Sign-ins show the start of the address. All of it is removed when the account is deleted.</p>

      <ConfirmDialog
        open={notMe !== null}
        onOpenChange={(open) => { if (!open) setNotMe(null); }}
        title="Wasn’t you?"
        description="Sign out every other device now, then change your password so whoever it was can’t sign in again."
        confirmLabel="Sign out other devices"
        variant="destructive"
        onConfirm={() => {
          setNotMe(null);
          openSetting("settings-security-sessions", "signout-others");
          window.setTimeout(() => openSetting("settings-security-password", "password"), 600);
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear the log?"
        description="Every change and sign-in in this list is removed. Signed-in devices stay signed in. This can’t be undone."
        confirmLabel="Clear all"
        pendingLabel="Clearing…"
        variant="destructive"
        loading={busy}
        onConfirm={clearAll}
      />
      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Clearing the log needs one more check."
        availableMethods={availableStepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={clearAll}
      />
    </SettingsSectionCard>
  );
}
