"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resumeNotifications } from "@/app/actions/presence";
import { useMyPresenceSettings } from "@/components/presence/useMyPresence";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { formatDateTime } from "@/lib/ui/date-formatting";
import { isLooseUuid } from "@/lib/validations/uuid";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { OrgNotificationChoices } from "@/components/settings/OrgNotificationChoices";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useSettingsQueries";
import type { NotificationPreferences } from "@/types/settingsTypes";
import type { NotificationPreferenceCategory } from "@/lib/notifications/types";
import { formatMinuteOfDay, isNotificationPauseActive, NOTIFICATION_PREFERENCE_CATEGORIES, parseTimeInput } from "@/lib/notifications/preferences";
import { getBrowserNotificationSupport, requestBrowserNotificationPermission, type BrowserNotificationPermissionState } from "@/lib/notifications/browser-push";
import { getCurrentPushStatus, isWebPushSupported, subscribeWebPush, unsubscribeWebPush, type WebPushClientStatus } from "@/lib/notifications/web-push-client";

/** Per type (UP8): each is a type-wide mute, the same one a notification's own "⋯" sets. */
const UPDATE_ACTIVITY_TYPES = [
  { kind: "project_update_like", title: "Likes on your updates and comments", description: "One grouped row per post, in your tray." },
  { kind: "project_update_comment", title: "Comments on your updates", description: "In your tray and as a push." },
  { kind: "project_update_reply", title: "Replies to your comments", description: "In your tray and as a push." },
  { kind: "project_update_mention", title: "Mentions in comments", description: "When a comment on an update mentions you. In your tray and as a push." },
  { kind: "project_update_team", title: "Activity on your team’s updates", description: "One quiet row per post, with counts of likes and comments." },
] as const;

function NotificationsSkeleton() {
  return <SettingsSectionsSkeleton count={3} />;
}

function PreferenceSwitch({ id, title, description, checked, disabled, onToggle }: { id: string; title: string; description: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return <SettingsRow title={title} description={description} right={<SettingsSwitch showLabel id={id} aria-label={title} aria-describedby={`${id}-description`} checked={checked} onCheckedChange={onToggle} disabled={disabled} />} descriptionId={`${id}-description`} />;
}

const MUTE_KIND_LABELS: Record<string, string> = {
  notification_type: "Notification type",
  project: "Workspace",
  task: "Task",
  update: "Post",
  person: "Person",
  organization: "Organization",
};

/** A quiet-hours time: edited freely, saved when the field is left (not on every keystroke). */
function QuietTimeField({ label, minute, onCommit }: { label: string; minute: number; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(formatMinuteOfDay(minute));
  useEffect(() => setDraft(formatMinuteOfDay(minute)), [minute]);
  return <label className="nb-compact text-muted-foreground">
    <span className="mb-2 block nb-meta text-foreground">{label}</span>
    <Input type="time" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft && draft !== formatMinuteOfDay(minute)) onCommit(draft); }} />
  </label>;
}

export default function NotificationsPage() {
  const { data: preferences, isLoading, isError, refetch } = useNotificationPreferences();
  const updateMutation = useUpdateNotificationPreferences();
  const [permissionState, setPermissionState] = useState<BrowserNotificationPermissionState>("default");
  const [pushStatus, setPushStatus] = useState<WebPushClientStatus>("idle");
  const [pushBusy, setPushBusy] = useState(false);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setPermissionState(getBrowserNotificationSupport());
      void getCurrentPushStatus().then((status) => { if (active) setPushStatus(status); }).catch(() => undefined);
    };
    refresh();
    // Permission changed in the browser's own settings: read it again when the person comes back to this tab.
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; document.removeEventListener("visibilitychange", refresh); };
  }, []);

  const queryClient = useQueryClient();
  const presence = useMyPresenceSettings();
  // Quiet hours keep the zone they were set in, so the server applies them on your clock. The zone is taken from
  // this browser only when the quiet-hours settings themselves change (or none was ever saved): flipping an
  // unrelated switch while travelling must not move the window.
  const save = (next: NotificationPreferences, { quiet = false }: { quiet?: boolean } = {}) => updateMutation.mutate(
    { ...next, quietHours: { ...next.quietHours, timeZone: quiet || !next.quietHours.timeZone ? Intl.DateTimeFormat().resolvedOptions().timeZone : next.quietHours.timeZone } },
    { onError: () => toast.error("Couldn’t save preferences") },
  );
  const toggleCategory = (keys: readonly NotificationPreferenceCategory[]) => {
    if (!preferences) return;
    const on = !keys.every((key) => preferences[key]);
    save({ ...preferences, ...Object.fromEntries(keys.map((key) => [key, on])) });
  };
  const setAllCategories = (enabled: boolean) => {
    if (!preferences) return;
    const next = { ...preferences };
    for (const { keys } of NOTIFICATION_PREFERENCE_CATEGORIES) for (const key of keys) next[key] = enabled;
    save(next);
  };
  // "Tomorrow" means 9 AM tomorrow (not 24 hours from now).
  const pauseUntil = (choice: "1h" | "8h" | "tomorrow") => {
    if (choice !== "tomorrow") return new Date(Date.now() + (choice === "1h" ? 1 : 8) * 3_600_000);
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    return at;
  };
  const pause = (choice: "1h" | "8h" | "tomorrow") => { if (preferences) save({ ...preferences, pausedUntil: pauseUntil(choice).toISOString() }); };
  // Resume also lifts a pause your status set (so your card stops saying "Notifications paused").
  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      const result = await resumeNotifications();
      if (!result.success) {
        toast.error("Couldn’t resume notifications");
        return;
      }
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
    if (minute !== null) save({ ...preferences, quietHours: { ...preferences.quietHours, [field]: minute } }, { quiet: true });
  };

  const toggleBrowser = async () => {
    if (!preferences) return;
    const currentlyOn = preferences.delivery.browser;
    if (!currentlyOn) {
      const permission = await requestBrowserNotificationPermission();
      setPermissionState(permission);
      if (permission !== "granted") {
        toast.warning(permission === "denied" ? "Browser notifications are blocked in your browser settings" : "Browser notifications are unavailable here");
        return;
      }
    }
    save({ ...preferences, delivery: { ...preferences.delivery, browser: !currentlyOn } });
  };

  const togglePush = async () => {
    if (!preferences || !isWebPushSupported()) { toast.error("This browser doesn’t support web push"); return; }
    setPushBusy(true);
    try {
      const currentlyOn = preferences.delivery.push && pushStatus === "subscribed";
      if (currentlyOn) {
        const result = await unsubscribeWebPush();
        if (!result.ok) throw new Error(result.reason);
        setPushStatus("idle");
        save({ ...preferences, delivery: { ...preferences.delivery, push: false } });
        return;
      }
      const result = await subscribeWebPush();
      if (!result.ok) {
        const messages: Record<string, string> = { permission_denied: "Push permission was denied in your browser.", missing_vapid_key: "Push notifications aren’t available right now." };
        toast.warning(messages[result.reason] || "Couldn’t enable push notifications.");
        setPushStatus(await getCurrentPushStatus());
        return;
      }
      setPushStatus("subscribed");
      // If saving fails the device would stay subscribed with the setting off: undo the subscription.
      updateMutation.mutate(
        { ...preferences, delivery: { ...preferences.delivery, push: true } },
        { onError: () => { void unsubscribeWebPush().then(() => setPushStatus("idle")).catch(() => undefined); toast.error("Couldn’t save preferences"); } },
      );
    } catch { toast.error("Couldn’t change push notifications"); } finally { setPushBusy(false); }
  };

  if (isLoading) return <NotificationsSkeleton />;
  if (isError || !preferences) return <ErrorNotice what="Notification preferences" onRetry={() => void refetch()} />;

  const isSaving = updateMutation.isPending;
  const pauseActive = isNotificationPauseActive(preferences);
  const pausedByStatus = pauseActive && Boolean(presence.data?.status?.pausesNotifications);
  // A copy cached before this setting existed has no chat part yet: the defaults.
  const chat = preferences.chat ?? { threadReplies: true, showPreview: true };
  const enabledCategoryCount = NOTIFICATION_PREFERENCE_CATEGORIES.filter(({ keys }) => keys.every((key) => preferences[key])).length;
  const allCategoriesEnabled = enabledCategoryCount === NOTIFICATION_PREFERENCE_CATEGORIES.length;
  const deliveryDescriptions = {
    browser: permissionState === "unsupported" ? "This browser doesn’t support notifications." : permissionState === "denied" ? "Blocked in browser settings." : "While NetworkBase is open in this browser.",
    push: pushStatus === "unsupported" ? "This browser doesn’t support web push." : pushStatus === "denied" ? "Push permission is blocked in browser settings." : "Even when NetworkBase is closed.",
  };

  return <div className="space-y-8">
    {/* Always in the layout, so saving never moves what is below it. */}
    <p role="status" className="flex h-5 items-center gap-2 nb-compact text-muted-foreground">{isSaving ? <><PixelBeat />Saving changes…</> : null}</p>

    <SettingsSectionCard title="Notification preferences" description="Choose what you’re notified about and when. People you block can’t reach you here.">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="nb-compact text-muted-foreground"><span className="font-medium text-foreground">{enabledCategoryCount} of {NOTIFICATION_PREFERENCE_CATEGORIES.length}</span> notification types are on.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setAllCategories(!allCategoriesEnabled)} disabled={isSaving}>{allCategoriesEnabled ? "Turn all off" : "Turn all on"}</Button>
      </div>
      {/* What these switches don't cover, said once. */}
      <p className="pt-3 nb-compact text-muted-foreground">Direct messages, group messages and threads you follow still notify you. Mute a conversation, or change what notifies you there, from its bell menu in Messages.</p>
      <div className="divide-y divide-border">
        {NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => <PreferenceSwitch key={category.key} id={category.key} title={category.title} description={category.description} checked={category.keys.every((key) => preferences[key])} disabled={isSaving} onToggle={() => toggleCategory(category.keys)} />)}
      </div>
      <div id="settings-notifications-quiet-hours" className="mt-4 scroll-mt-6 border-t border-border pt-4">
        <h4 className="nb-ui-label text-foreground">Pause and quiet hours</h4>
        <div className="mt-2 divide-y divide-border">
          {/* Only an active pause says when it ends (an old one would read "resumes" in the past). */}
          <SettingsRow
            title={pauseActive ? (pausedByStatus ? "Paused by your status" : "Notifications paused") : "Pause notifications"}
            description={pauseActive && preferences.pausedUntil ? `Delivery resumes ${formatDateTime(preferences.pausedUntil)}.` : "Updates remain available in Notifications while delivery is paused."}
            right={<div className="flex flex-wrap gap-2">{pauseActive ? <Button type="button" size="sm" className="pointer-coarse:h-11" onClick={() => void resume()} disabled={isSaving || resuming}>{resuming ? "Resuming…" : "Resume now"}</Button> : null}{([["1h", "1 hour"], ["8h", "8 hours"], ["tomorrow", "Until tomorrow 9 AM"]] as const).map(([choice, label]) => <Button key={choice} type="button" variant="outline" size="sm" className="pointer-coarse:h-11" onClick={() => pause(choice)} disabled={isSaving} aria-label={pauseActive ? `Pause for ${label} instead` : undefined}>{label}</Button>)}</div>}
          />
          <SettingsRow title="Quiet hours" description={preferences.quietHours.enabled ? `Each day from ${formatMinuteOfDay(preferences.quietHours.startMinute)} to ${formatMinuteOfDay(preferences.quietHours.endMinute)}, notifications wait and messages don’t send push alerts.` : "Set a daily time when you won’t be interrupted."} right={<SettingsSwitch showLabel aria-label="Enable quiet hours" checked={preferences.quietHours.enabled} onCheckedChange={() => save({ ...preferences, quietHours: { ...preferences.quietHours, enabled: !preferences.quietHours.enabled } }, { quiet: true })} disabled={isSaving} />} />
          {preferences.quietHours.enabled ? <div className="space-y-2 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <QuietTimeField label="From" minute={preferences.quietHours.startMinute} onCommit={(value) => setQuietTime("startMinute", value)} />
              <QuietTimeField label="Until" minute={preferences.quietHours.endMinute} onCommit={(value) => setQuietTime("endMinute", value)} />
            </div>
            <p className="nb-meta text-muted-foreground">
              Times are in {preferences.quietHours.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}.
              {preferences.quietHours.startMinute === preferences.quietHours.endMinute ? " Start and end are the same, so quiet hours are not active." : ""}
            </p>
          </div> : null}
        </div>
        <div className="border-t border-border pt-4">
          <h4 className="nb-ui-label text-foreground">Muted items</h4>
          {preferences.mutedScopes.length ? <div className="mt-3 divide-y divide-border">{preferences.mutedScopes.map((scope) => {
            const name = scope.label || (isLooseUuid(scope.value) ? "Unnamed item" : scope.value);
            return <SettingsRow key={`${scope.kind}:${scope.value}`} title={name} description={`${MUTE_KIND_LABELS[scope.kind] ?? "Item"} muted`} right={<Button type="button" variant="ghost" size="sm" aria-label={`Unmute ${name}`} onClick={() => save({ ...preferences, mutedScopes: preferences.mutedScopes.filter((item) => item !== scope) })} disabled={isSaving} className="pointer-coarse:h-11">Unmute</Button>} />;
          })}</div> : <p className="mt-2 nb-compact text-muted-foreground">Nothing muted. Mute a workspace, task or person from the ⋯ menu on a notification in Notifications, or a conversation from its bell menu in <Link href="/messages" className="text-foreground underline underline-offset-2">Messages</Link>.</p>}
        </div>
      </div>
    </SettingsSectionCard>

    <OrgNotificationChoices preferences={preferences} disabled={isSaving} onSave={save} />

    <SettingsSectionCard id="settings-notifications-delivery" title="Delivery" description="Choose where important updates can reach you.">
      <div className="divide-y divide-border">
        <PreferenceSwitch id="delivery-email" title="Email" description="Email me when someone assigns me a task, and organization emails such as assignments and announcements. Mutes and the Organizations choices above also apply." checked={preferences.delivery.email ?? true} disabled={isSaving} onToggle={() => save({ ...preferences, delivery: { ...preferences.delivery, email: !(preferences.delivery.email ?? true) } })} />
        <PreferenceSwitch id="delivery-browser" title="Browser notifications" description={deliveryDescriptions.browser} checked={preferences.delivery.browser && permissionState === "granted"} disabled={isSaving || permissionState === "unsupported" || permissionState === "denied"} onToggle={() => void toggleBrowser()} />
        <PreferenceSwitch id="delivery-push" title="Push notifications" description={deliveryDescriptions.push} checked={preferences.delivery.push && pushStatus === "subscribed"} disabled={isSaving || pushBusy || pushStatus === "unsupported" || pushStatus === "denied"} onToggle={() => void togglePush()} />
      </div>
      <p className="mt-3 nb-meta text-muted-foreground">Emails about the security of your account (a changed password, a new editor token, an authenticator change, account deletion) are always sent. They can’t be turned off here.</p>
    </SettingsSectionCard>

    <SettingsSectionCard title="Update activity" description="What you hear when people react to updates. To quieten one workspace, use “⋯” on any of its notifications.">
      <div className="divide-y divide-border">
        {UPDATE_ACTIVITY_TYPES.map((type) => {
          const scope = preferences.mutedScopes.find((item) => item.kind === "notification_type" && item.value === type.kind);
          return <PreferenceSwitch key={type.kind} id={type.kind} title={type.title} description={type.description} checked={!scope} disabled={isSaving} onToggle={() => save({ ...preferences, mutedScopes: scope ? preferences.mutedScopes.filter((item) => item !== scope) : [{ kind: "notification_type", value: type.kind, label: type.title, mutedAt: new Date().toISOString() }, ...preferences.mutedScopes] })} />;
        })}
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard title="Messages" description="How messages reach you as push notifications.">
      <div className="divide-y divide-border">
        <PreferenceSwitch id="chat-thread-replies" title="Replies in threads you follow" description="Push a notification for each new reply. Off: replies still show in your Inbox; @mentions always notify." checked={chat.threadReplies} disabled={isSaving} onToggle={() => save({ ...preferences, chat: { ...chat, threadReplies: !chat.threadReplies } })} />
        <PreferenceSwitch id="chat-show-preview" title="Show message text in notifications" description="Off: notifications say who and where, but only “New message”, so the text never shows on a locked screen." checked={chat.showPreview} disabled={isSaving} onToggle={() => save({ ...preferences, chat: { ...chat, showPreview: !chat.showPreview } })} />
      </div>
    </SettingsSectionCard>
  </div>;
}
