"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resumeNotifications } from "@/app/actions/presence";
import { sendTestNotificationAction } from "@/app/actions/notification-test";
import { useMyPresenceSettings } from "@/components/presence/useMyPresence";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { SavedTick } from "@/components/ui/SavedTick";
import { isLooseUuid } from "@/lib/validations/uuid";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { SegChoice, Tag } from "@/components/settings/mix/parts";
import { OrgNotificationChoices } from "@/components/settings/OrgNotificationChoices";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useSettingsQueries";
import type { NotificationPreferences } from "@/types/settingsTypes";
import type { NotificationPreferenceCategory } from "@/lib/notifications/types";
import { formatMinuteOfDay, isNotificationPauseActive, NOTIFICATION_PREFERENCE_CATEGORIES, parseTimeInput } from "@/lib/notifications/preferences";
import { getBrowserNotificationSupport, requestBrowserNotificationPermission, type BrowserNotificationPermissionState } from "@/lib/notifications/browser-push";
import { getCurrentPushStatus, isWebPushSupported, subscribeWebPush, unsubscribeWebPush, type WebPushClientStatus } from "@/lib/notifications/web-push-client";
import { clockTime } from "@/lib/settings/format";
import { dayCells } from "@/lib/settings/day";
import { padCount } from "@/lib/ui/tab-marker";

/** Per type (UP8): each is a type-wide mute, the same one a notification's own "⋯" sets. */
const UPDATE_ACTIVITY_TYPES = [
  { kind: "project_update_like", title: "Likes on your updates and comments", description: "One grouped row per post, in your tray." },
  { kind: "project_update_comment", title: "Comments on your updates", description: "In your tray and as a push." },
  { kind: "project_update_reply", title: "Replies to your comments", description: "In your tray and as a push." },
  { kind: "project_update_mention", title: "Mentions in comments", description: "When a comment on an update mentions you. In your tray and as a push." },
  { kind: "project_update_team", title: "Activity on your team’s updates", description: "One quiet row per post, with counts of likes and comments." },
] as const;

const MUTE_KIND_LABELS: Record<string, string> = {
  notification_type: "Notification type",
  project: "Workspace",
  task: "Task",
  update: "Post",
  person: "Person",
  organization: "Organization",
};

const PAUSE_CHOICES = [{ value: "1h", label: "1 hour" }, { value: "8h", label: "8 hours" }, { value: "tomorrow", label: "Until tomorrow 9 AM" }] as const;
type PauseChoice = (typeof PAUSE_CHOICES)[number]["value"];

/** A quiet-hours time: edited freely, saved when the field is left (not on every keystroke). */
function QuietTimeField({ id, label, minute, onCommit }: { id: string; label: string; minute: number; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(formatMinuteOfDay(minute));
  useEffect(() => setDraft(formatMinuteOfDay(minute)), [minute]);
  return <div className="grid gap-1.5">
    <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
    <input id={id} type="time" className="h-[var(--ui-control-height)] rounded-[5px] border border-border bg-card px-2.5 font-mono text-[13px] text-foreground focus:border-foreground focus:outline-none" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft && draft !== formatMinuteOfDay(minute)) onCommit(draft); }} />
  </div>;
}

/** Send a test: email and push through the server, browser right here. Says how it went beside the button. */
function SendTest({ channel, disabled, title }: { channel: "email" | "push" | "browser"; disabled?: boolean; title?: string }) {
  const [state, setState] = useState<{ pending: boolean; done: number; note: string | null }>({ pending: false, done: 0, note: null });
  const send = async () => {
    setState((current) => ({ ...current, pending: true, note: null }));
    if (channel === "browser") {
      try {
        new Notification("Test from NetworkBase", { body: "Browser notifications reach you here.", tag: "settings-test" });
        setState((current) => ({ pending: false, done: current.done + 1, note: null }));
      } catch {
        setState((current) => ({ ...current, pending: false, note: "This browser didn’t show it" }));
      }
      return;
    }
    const result = await sendTestNotificationAction(channel).catch(() => ({ success: false as const, error: "Couldn’t send the test" }));
    setState((current) => result.success ? { pending: false, done: current.done + 1, note: null } : { ...current, pending: false, note: result.error });
  };
  return <>
    {state.note ? <span role="alert" className="nb-retry"><b>Not sent</b><span>{state.note}</span></span> : state.done ? <SavedTick key={state.done} label="Sent" /> : null}
    <Button type="button" variant="ghost" size="sm" pending={state.pending} disabled={disabled} title={title} onClick={() => void send()}>Send a test</Button>
  </>;
}

/** Notifications (settings mix v2): what you hear about, your day (pause, quiet hours), where it arrives. */
export default function NotificationsPage() {
  const { data: preferences, isLoading, isError, refetch } = useNotificationPreferences();
  const updateMutation = useUpdateNotificationPreferences();
  const [permissionState, setPermissionState] = useState<BrowserNotificationPermissionState>("default");
  const [pushStatus, setPushStatus] = useState<WebPushClientStatus>("idle");
  const [pushBusy, setPushBusy] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [quietSaved, setQuietSaved] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setPermissionState(getBrowserNotificationSupport());
      setNow(new Date());
      void getCurrentPushStatus().then((status) => { if (active) setPushStatus(status); }).catch(() => undefined);
    };
    refresh();
    // Permission changed in the browser's own settings: read it again when the person comes back to this tab.
    document.addEventListener("visibilitychange", refresh);
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => { active = false; document.removeEventListener("visibilitychange", refresh); window.clearInterval(tick); };
  }, []);

  const queryClient = useQueryClient();
  const presence = useMyPresenceSettings();
  // Quiet hours keep the zone they were set in, so the server applies them on your clock. The zone is taken from
  // this browser only when the quiet-hours settings themselves change (or none was ever saved): flipping an
  // unrelated switch while travelling must not move the window.
  const withZone = (next: NotificationPreferences, quiet: boolean) => ({ ...next, quietHours: { ...next.quietHours, timeZone: quiet || !next.quietHours.timeZone ? Intl.DateTimeFormat().resolvedOptions().timeZone : next.quietHours.timeZone } });
  /** For switches: returns the save, so the switch flips at once and rolls back with "Not saved" if it fails. */
  const saveAsync = (next: NotificationPreferences, { quiet = false }: { quiet?: boolean } = {}) => updateMutation.mutateAsync(withZone(next, quiet));
  const save = (next: NotificationPreferences, { quiet = false, onSaved }: { quiet?: boolean; onSaved?: () => void } = {}) => updateMutation.mutate(withZone(next, quiet), {
    onSuccess: onSaved,
    onError: () => toast.error("Couldn’t save notification settings"),
  });
  const setCategory = (keys: readonly NotificationPreferenceCategory[], on: boolean) => preferences ? saveAsync({ ...preferences, ...Object.fromEntries(keys.map((key) => [key, on])) }) : undefined;
  const setAllCategories = (enabled: boolean) => {
    if (!preferences) return;
    const next = { ...preferences };
    for (const { keys } of NOTIFICATION_PREFERENCE_CATEGORIES) for (const key of keys) next[key] = enabled;
    save(next);
  };
  // "Tomorrow" means 9 AM tomorrow (not 24 hours from now).
  const pauseUntil = (choice: PauseChoice) => {
    if (choice !== "tomorrow") return new Date(Date.now() + (choice === "1h" ? 1 : 8) * 3_600_000);
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    return at;
  };
  const pause = (choice: PauseChoice) => { if (preferences) save({ ...preferences, pausedUntil: pauseUntil(choice).toISOString() }); };
  // Resume also lifts a pause your status set (so your card stops saying "Notifications paused").
  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      const result = await resumeNotifications();
      if (!result.success) { toast.error("Couldn’t resume notifications"); return; }
      void queryClient.invalidateQueries({ queryKey: queryKeys.presence.mine() });
    } catch {
      toast.error("Couldn’t resume notifications");
    } finally {
      setResuming(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.notifications() });
    }
  };
  const setQuietTime = (field: "startMinute" | "endMinute", value: string) => {
    if (!preferences) return;
    const minute = parseTimeInput(value);
    if (minute !== null) save({ ...preferences, quietHours: { ...preferences.quietHours, [field]: minute } }, { quiet: true, onSaved: () => setQuietSaved((n) => n + 1) });
  };

  const setBrowser = async (on: boolean) => {
    if (!preferences) return;
    if (on) {
      const permission = await requestBrowserNotificationPermission();
      setPermissionState(permission);
      if (permission !== "granted") throw new Error(permission === "denied" ? "Blocked in this browser’s site settings" : "Not available in this browser");
    }
    await saveAsync({ ...preferences, delivery: { ...preferences.delivery, browser: on } });
  };

  const setPush = async (on: boolean) => {
    if (!preferences || !isWebPushSupported()) throw new Error("This browser doesn’t support web push");
    setPushBusy(true);
    try {
      if (!on) {
        const result = await unsubscribeWebPush();
        if (!result.ok) throw new Error(result.reason);
        setPushStatus("idle");
        await saveAsync({ ...preferences, delivery: { ...preferences.delivery, push: false } });
        return;
      }
      const result = await subscribeWebPush();
      if (!result.ok) {
        setPushStatus(await getCurrentPushStatus());
        throw new Error(result.reason === "permission_denied" ? "Push permission was denied in this browser" : "Push isn’t available right now");
      }
      setPushStatus("subscribed");
      try {
        await saveAsync({ ...preferences, delivery: { ...preferences.delivery, push: true } });
      } catch (error) {
        // If saving fails the device would stay subscribed with the setting off: undo the subscription.
        void unsubscribeWebPush().then(() => setPushStatus("idle")).catch(() => undefined);
        throw error;
      }
    } finally {
      setPushBusy(false);
    }
  };

  if (isLoading) return <SettingsSectionsSkeleton count={4} />;
  if (isError || !preferences) return <div className="nbs-body pt-4"><ErrorNotice what="Notification preferences" onRetry={() => void refetch()} /></div>;

  const isSaving = updateMutation.isPending;
  const pauseActive = isNotificationPauseActive(preferences);
  const pausedByStatus = pauseActive && Boolean(presence.data?.status?.pausesNotifications);
  // A copy cached before this setting existed has no chat part yet: the defaults.
  const chat = preferences.chat ?? { threadReplies: true, showPreview: true };
  const enabledCategoryCount = NOTIFICATION_PREFERENCE_CATEGORIES.filter(({ keys }) => keys.every((key) => preferences[key])).length;
  const allCategoriesEnabled = enabledCategoryCount === NOTIFICATION_PREFERENCE_CATEGORIES.length;
  const quiet = preferences.quietHours;
  const zone = quiet.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pausedUntil = pauseActive && preferences.pausedUntil ? new Date(preferences.pausedUntil) : null;
  const pauseEndHour = pausedUntil ? (pausedUntil.toDateString() === now.toDateString() ? pausedUntil.getHours() + (pausedUntil.getMinutes() ? 1 : 0) : 24) : null;
  const cells = dayCells({ quiet, nowHour: now.getHours(), pauseEndHour });
  const dayLabel = `Today: ${quiet.enabled ? `quiet from ${formatMinuteOfDay(quiet.startMinute)} to ${formatMinuteOfDay(quiet.endMinute)}` : "no quiet hours"}${pausedUntil ? `, paused until ${clockTime(preferences.pausedUntil)}` : ""}`;
  const browserBlocked = permissionState === "denied";
  const browserOn = preferences.delivery.browser && permissionState === "granted";
  const pushOn = preferences.delivery.push && pushStatus === "subscribed";
  const switchRow = (id: string, title: string, description: string, checked: boolean, onChange: (on: boolean) => Promise<unknown> | undefined, extra?: React.ReactNode, disabled = false) => (
    <SettingsRow key={id} id={`settings-notifications-${id}`} title={title} description={description} descriptionId={`${id}-description`}
      right={<>{extra}<SettingsSwitch id={id} aria-label={title} aria-describedby={`${id}-description`} checked={checked} disabled={disabled} onCheckedChange={(on: boolean) => onChange(on)} /></>} />
  );

  return <>
    <SettingsSectionCard id="settings-notifications-types" title="What you hear about" state={`${padCount(enabledCategoryCount)} / ${padCount(NOTIFICATION_PREFERENCE_CATEGORIES.length)}`} stateOk={enabledCategoryCount > 0} flush
      right={<Button type="button" variant="ghost" size="sm" onClick={() => setAllCategories(!allCategoriesEnabled)} disabled={isSaving}>{allCategoriesEnabled ? "Turn all off" : "Turn all on"}</Button>}>
      <SettingsRows>
        {NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => switchRow(category.key, category.title, category.description, category.keys.every((key) => preferences[key]), (on) => setCategory(category.keys, on)))}
      </SettingsRows>
      <p className="nbs-foot">Direct messages, group messages and threads you follow always notify. Change a conversation from its bell menu in Messages.</p>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-notifications-pause" title="Your day" state={pauseActive ? "paused" : quiet.enabled ? "quiet hours on" : undefined} flush findKeys="pause snooze quiet hours">
      <div className="nbs-pad">
        <div className="nbs-day24" role="img" aria-label={dayLabel}>
          <div className="nbs-hours">{cells.map((cell, hour) => <i key={hour} className={[cell.quiet && "quiet", cell.pause && "pause", cell.now && "now"].filter(Boolean).join(" ") || undefined} title={`${String(hour).padStart(2, "0")}:00`} />)}</div>
          <div className="nbs-hlbl" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
          <div className="nbs-legend" aria-hidden="true">
            <span><i style={{ background: "color-mix(in srgb, var(--foreground) 55%, var(--secondary))" }} />Quiet hours</span>
            <span><i style={{ background: "var(--nbs-brand)" }} />Paused</span>
            <span><i style={{ background: "var(--nbs-brand)", width: 2 }} />Now, {clockTime(now.toISOString())}</span>
          </div>
        </div>
      </div>
      <SettingsRows>
        {pauseActive ? (
          <SettingsRow id="settings-notifications-paused" title={pausedByStatus ? "Paused by your status" : `Paused until ${clockTime(preferences.pausedUntil)}`}
            description="Updates still collect in Notifications; nothing is sent until then."
            right={<Button type="button" size="sm" pending={resuming} disabled={isSaving || resuming} onClick={() => void resume()}>Resume now</Button>} />
        ) : (
          <SettingsRow id="settings-notifications-pausenow" title="Pause notifications" description="Updates still collect in Notifications while delivery is paused."
            right={<SegChoice<PauseChoice> label="Pause for" value={null} options={PAUSE_CHOICES} onChange={pause} busy={isSaving} />} />
        )}
        <SettingsRow id="settings-notifications-quiet-hours" title="Quiet hours" description="A daily time when nothing is sent. Notifications wait in your tray."
          right={<SettingsSwitch aria-label="Quiet hours" checked={quiet.enabled} onCheckedChange={(on: boolean) => saveAsync({ ...preferences, quietHours: { ...quiet, enabled: on } }, { quiet: true })} />}>
          {quiet.enabled ? <div className="nbs-inline-form max-w-none">
            <div className="grid max-w-[360px] grid-cols-2 gap-3">
              <QuietTimeField id="quiet-from" label="From" minute={quiet.startMinute} onCommit={(value) => setQuietTime("startMinute", value)} />
              <QuietTimeField id="quiet-until" label="Until" minute={quiet.endMinute} onCommit={(value) => setQuietTime("endMinute", value)} />
            </div>
            <span className="nbs-meta inline-flex flex-wrap items-center gap-2">Times are in {zone}{quiet.startMinute === quiet.endMinute ? ". Start and end are the same, so quiet hours are not active." : ""}{quietSaved ? <SavedTick key={quietSaved} /> : null}</span>
          </div> : null}
        </SettingsRow>
      </SettingsRows>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-notifications-muted" title="Muted" state={preferences.mutedScopes.length ? padCount(preferences.mutedScopes.length) : undefined} stateOk flush findKeys="mute unmute">
      {preferences.mutedScopes.length ? <SettingsRows>{preferences.mutedScopes.map((scope) => {
        const name = scope.label || (isLooseUuid(scope.value) ? "Unnamed item" : scope.value);
        return <SettingsRow key={`${scope.kind}:${scope.value}`} title={name} description={`${MUTE_KIND_LABELS[scope.kind] ?? "Item"} muted`} right={<Button type="button" variant="ghost" size="sm" aria-label={`Unmute ${name}`} onClick={() => save({ ...preferences, mutedScopes: preferences.mutedScopes.filter((item) => item !== scope) })} disabled={isSaving}>Unmute</Button>} />;
      })}</SettingsRows> : <EmptyState compact className="nbs-empty" title="Nothing muted" description={<>Mute a workspace, task or person from the ⋯ menu on a notification, or a conversation from its bell menu in <Link href="/messages" className="text-foreground underline underline-offset-2">Messages</Link>.</>} />}
    </SettingsSectionCard>

    <OrgNotificationChoices preferences={preferences} disabled={isSaving} onSave={save} />

    <SettingsSectionCard id="settings-notifications-delivery" title="Where it arrives" flush findKeys="email push browser test">
      <SettingsRows>
        <SettingsRow id="settings-notifications-inapp" title="In app" description="The bell and your tray. Always on." right={<Tag tone="ok" tick>On</Tag>} />
        {switchRow("email", "Email", "Assignments and organization emails. Mutes and organization choices apply.", preferences.delivery.email ?? true, (on) => saveAsync({ ...preferences, delivery: { ...preferences.delivery, email: on } }), <SendTest channel="email" disabled={!(preferences.delivery.email ?? true)} title={preferences.delivery.email ?? true ? undefined : "Turn email on first"} />)}
        {browserBlocked ? (
          <SettingsRow id="settings-notifications-browser" title="Browser" description="Blocked in this browser’s site settings. Allow notifications for NetworkBase, then come back."
            right={<><Tag tone="warn">Blocked</Tag><Button type="button" variant="outline" size="sm" onClick={() => setPermissionState(getBrowserNotificationSupport())}>I’ve allowed it</Button></>} />
        ) : switchRow("browser", "Browser", permissionState === "unsupported" ? "This browser doesn’t support notifications." : "While NetworkBase is open in this browser.", browserOn, (on) => setBrowser(on), browserOn ? <SendTest channel="browser" /> : null, permissionState === "unsupported")}
        {switchRow("push", "Push", pushStatus === "unsupported" ? "This browser doesn’t support web push." : pushStatus === "denied" ? "Push permission is blocked in this browser’s settings." : "On this device, even when NetworkBase is closed.", pushOn, (on) => setPush(on), <SendTest channel="push" disabled={!pushOn} title={pushOn ? undefined : "Turn push on first"} />, pushBusy || pushStatus === "unsupported" || pushStatus === "denied")}
      </SettingsRows>
      <p className="nbs-foot">Security emails (a changed password, a new token, an authenticator change, account deletion) are always sent.</p>
    </SettingsSectionCard>

    <SettingsSectionCard id="settings-notifications-detail" title="Updates and messages" flush findKeys="likes comments replies threads preview">
      <SettingsRows>
        {UPDATE_ACTIVITY_TYPES.map((type) => {
          const scope = preferences.mutedScopes.find((item) => item.kind === "notification_type" && item.value === type.kind);
          return switchRow(type.kind, type.title, type.description, !scope, (on) => saveAsync({ ...preferences, mutedScopes: on ? preferences.mutedScopes.filter((item) => item !== scope) : [{ kind: "notification_type", value: type.kind, label: type.title, mutedAt: new Date().toISOString() }, ...preferences.mutedScopes] }));
        })}
        {switchRow("chat-thread-replies", "Replies in threads you follow", "A push for each reply. Off: they wait in your Inbox; @mentions always notify.", chat.threadReplies, (on) => saveAsync({ ...preferences, chat: { ...chat, threadReplies: on } }))}
        {switchRow("chat-show-preview", "Show message text in notifications", "Off: notifications say who and where, never the text, on a locked screen.", chat.showPreview, (on) => saveAsync({ ...preferences, chat: { ...chat, showPreview: on } }))}
      </SettingsRows>
    </SettingsSectionCard>
  </>;
}
