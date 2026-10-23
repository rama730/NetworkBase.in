"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resumeNotifications } from "@/app/actions/presence";
import { useMyPresenceSettings } from "@/components/presence/useMyPresence";
import { queryKeys } from "@/lib/query-keys";
import { Loader2 } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useSettingsQueries";
import type { NotificationPreferences } from "@/types/settingsTypes";
import type { NotificationPreferenceCategory } from "@/lib/notifications/types";
import { formatMinuteOfDay, isNotificationPauseActive, NOTIFICATION_PREFERENCE_CATEGORIES, parseTimeInput } from "@/lib/notifications/preferences";
import { getBrowserNotificationSupport, requestBrowserNotificationPermission, type BrowserNotificationPermissionState } from "@/lib/notifications/browser-push";
import { getCurrentPushStatus, isWebPushSupported, subscribeWebPush, unsubscribeWebPush, type WebPushClientStatus } from "@/lib/notifications/web-push-client";

function NotificationsSkeleton() {
  return <SettingsSectionsSkeleton count={3} />;
}

function PreferenceSwitch({ id, title, description, checked, disabled, onToggle }: { id: string; title: string; description: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return <SettingsRow title={title} description={description} right={<div className="flex items-center gap-3"><span className="nb-meta text-muted-foreground select-none w-6 text-right">{checked ? "On" : "Off"}</span><SettingsSwitch id={id} aria-label={title} checked={checked} onCheckedChange={onToggle} disabled={disabled} /></div>} />;
}

export default function NotificationsPage({ embedded = false }: { embedded?: boolean }) {
  const { data: preferences, isLoading, isError } = useNotificationPreferences();
  const updateMutation = useUpdateNotificationPreferences();
  const [permissionState, setPermissionState] = useState<BrowserNotificationPermissionState>("default");
  const [pushStatus, setPushStatus] = useState<WebPushClientStatus>("idle");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setPermissionState(getBrowserNotificationSupport());
    void getCurrentPushStatus().then((status) => { if (active) setPushStatus(status); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const queryClient = useQueryClient();
  const presence = useMyPresenceSettings();
  // Quiet hours keep the zone they were set in, so the server applies them on your clock.
  const save = (next: NotificationPreferences) => updateMutation.mutate(
    { ...next, quietHours: { ...next.quietHours, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
    { onError: () => toast.error("Failed to save preferences") },
  );
  const toggleCategory = (key: NotificationPreferenceCategory) => { if (preferences) save({ ...preferences, [key]: !preferences[key] }); };
  const setAllCategories = (enabled: boolean) => {
    if (!preferences) return;
    const next = { ...preferences };
    for (const { key } of NOTIFICATION_PREFERENCE_CATEGORIES) next[key] = enabled;
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
    if (preferences) {
      queryClient.setQueryData(queryKeys.settings.notifications(), {
        ...preferences,
        pausedUntil: null,
      });
    }
    const result = await resumeNotifications();
    if (!result.success) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.notifications() });
      return void toast.error("Couldn't resume notifications.");
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.notifications() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.presence.mine() });
  };
  const setQuietTime = (field: "startMinute" | "endMinute", value: string) => {
    if (!preferences) return;
    const minute = parseTimeInput(value);
    if (minute !== null) save({ ...preferences, quietHours: { ...preferences.quietHours, [field]: minute } });
  };

  const toggleBrowser = async () => {
    if (!preferences) return;
    const currentlyOn = preferences.delivery.browser;
    if (!currentlyOn) {
      const permission = await requestBrowserNotificationPermission();
      setPermissionState(permission);
      if (permission !== "granted") {
        toast.error(feedbackError(permission === "denied" ? "Browser notifications are blocked in browser settings." : "Browser notifications are unavailable here.", "Browser notifications are unavailable here."));
        return;
      }
    }
    save({ ...preferences, delivery: { ...preferences.delivery, browser: !currentlyOn } });
  };

  const togglePush = async () => {
    if (!preferences || !isWebPushSupported()) { toast.error("This browser doesn't support web push."); return; }
    setPushBusy(true);
    try {
      const currentlyOn = preferences.delivery.push && pushStatus === "subscribed";
      if (currentlyOn) {
        const result = await unsubscribeWebPush();
        if (!result.ok) throw new Error(result.reason);
        setPushStatus("idle");
        save({ ...preferences, delivery: { ...preferences.delivery, push: false } });
        if (result.serverCleanupFailed) toast.warning("Push was disabled here, but server cleanup did not finish.");
        return;
      }
      const result = await subscribeWebPush();
      if (!result.ok) {
        const messages: Record<string, string> = { permission_denied: "Push permission was denied in your browser.", missing_vapid_key: "Push is not configured yet. Contact support." };
        toast.error(feedbackError(messages[result.reason] || "Couldn't enable push notifications.", "Couldn't enable push notifications."));
        setPushStatus(await getCurrentPushStatus());
        return;
      }
      setPushStatus("subscribed");
      save({ ...preferences, delivery: { ...preferences.delivery, push: true } });
    } catch { toast.error("Couldn't change push notifications."); } finally { setPushBusy(false); }
  };

  if (isLoading) return <NotificationsSkeleton />;
  if (isError || !preferences) return <div className="rounded-lg border border-border bg-card p-6 text-center nb-compact text-destructive">Failed to load notification preferences.</div>;

  const isSaving = updateMutation.isPending;
  const pauseActive = isNotificationPauseActive(preferences);
  const pausedByStatus = pauseActive && Boolean(presence.data?.status?.pausesNotifications);
  // A copy cached before this setting existed has no chat part yet: the defaults.
  const chat = preferences.chat ?? { threadReplies: true, showPreview: true };
  const enabledCategoryCount = NOTIFICATION_PREFERENCE_CATEGORIES.filter(({ key }) => preferences[key]).length;
  const allCategoriesEnabled = enabledCategoryCount === NOTIFICATION_PREFERENCE_CATEGORIES.length;
  const deliveryDescriptions = {
    browser: permissionState === "unsupported" ? "This browser doesn't support notifications." : permissionState === "denied" ? "Blocked in browser settings." : "Show a system notification for tray updates while this tab is in the background. Chat messages use push notifications.",
    push: pushStatus === "unsupported" ? "This browser doesn't support web push." : pushStatus === "denied" ? "Push permission is blocked in browser settings." : "Deliver important updates and chat messages even when this tab is closed.",
  };

  return <div className={embedded ? "space-y-8" : "space-y-6"}>
    {!embedded ? <SettingsPageHeader title="Notifications" description="Choose which updates appear and how they reach you." /> : null}
    {isSaving ? <p aria-live="polite" className="flex items-center gap-2 nb-compact text-muted-foreground"><Loader2 className="size-4 animate-spin" />Saving changes…</p> : null}

    <SettingsSectionCard title="Notification preferences" description="Choose what appears in the notification tray and when delivery pauses.">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="nb-compact text-muted-foreground"><span className="font-medium text-foreground">{enabledCategoryCount} of {NOTIFICATION_PREFERENCE_CATEGORIES.length}</span> notification types are on.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setAllCategories(!allCategoriesEnabled)} disabled={isSaving}>{allCategoriesEnabled ? "Turn all off" : "Turn all on"}</Button>
      </div>
      {/* What these switches don't cover, said once. */}
      <p className="pt-3 nb-compact text-muted-foreground">Direct messages, group chats and threads you follow still notify you. Mute a conversation, or change what notifies you there, from its bell menu in Messages.</p>
      <div className="divide-y divide-border">
        {NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => <PreferenceSwitch key={category.key} id={category.key} title={category.title} description={category.description} checked={preferences[category.key]} disabled={isSaving} onToggle={() => toggleCategory(category.key)} />)}
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <h4 className="nb-ui-label text-foreground">Quiet controls</h4>
        <div className="mt-2 divide-y divide-border">
          {/* Only an active pause says when it ends (an old one would read "resumes" in the past). */}
          <SettingsRow
            title={pauseActive ? (pausedByStatus ? "Paused by your status" : "Notifications paused") : "Pause notifications"}
            description={pauseActive && preferences.pausedUntil ? `Delivery resumes ${new Date(preferences.pausedUntil).toLocaleString()}.` : "Updates remain available in the tray while delivery is paused."}
            right={<div className="flex flex-wrap gap-2">{([["1h", "1 hour"], ["8h", "8 hours"], ["tomorrow", "Until tomorrow 9 AM"]] as const).map(([choice, label]) => <Button key={choice} type="button" variant="outline" size="sm" onClick={() => pause(choice)} disabled={isSaving}>{label}</Button>)}{pauseActive ? <Button type="button" variant="ghost" size="sm" onClick={() => void resume()} disabled={isSaving}>Resume</Button> : null}</div>}
          />
          <SettingsRow title="Quiet hours" description={preferences.quietHours.enabled ? `From ${formatMinuteOfDay(preferences.quietHours.startMinute)} to ${formatMinuteOfDay(preferences.quietHours.endMinute)} each day, updates wait in the tray until it ends and chat messages don't push (they stay unread in Messages).` : "Set a recurring daily period without delivery interruptions."} right={<div className="flex items-center gap-3"><span className="nb-meta text-muted-foreground select-none w-6 text-right">{preferences.quietHours.enabled ? "On" : "Off"}</span><SettingsSwitch aria-label="Enable quiet hours" checked={preferences.quietHours.enabled} onCheckedChange={() => save({ ...preferences, quietHours: { ...preferences.quietHours, enabled: !preferences.quietHours.enabled } })} disabled={isSaving} /></div>} />
          {preferences.quietHours.enabled ? <div className="grid gap-3 py-4 sm:grid-cols-2">
            {(["startMinute", "endMinute"] as const).map((field) => <label key={field} className="nb-compact text-muted-foreground"><span className="mb-2 block nb-meta text-foreground">{field === "startMinute" ? "From" : "Until"}</span><input type="time" aria-label={field === "startMinute" ? "Quiet hours start" : "Quiet hours end"} value={formatMinuteOfDay(preferences.quietHours[field])} onChange={(event) => setQuietTime(field, event.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 nb-compact text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" /></label>)}
          </div> : null}
        </div>
        <div className="border-t border-border pt-4">
          <h5 className="nb-ui-label text-foreground">Muted scopes</h5>
          {preferences.mutedScopes.length ? <div className="mt-3 divide-y divide-border">{preferences.mutedScopes.map((scope) => <SettingsRow key={`${scope.kind}:${scope.value}`} title={scope.label || scope.value} description={`${scope.kind === "notification_type" ? "Notification type" : scope.kind} mute`} right={<Button type="button" variant="ghost" size="sm" onClick={() => save({ ...preferences, mutedScopes: preferences.mutedScopes.filter((item) => item !== scope) })} disabled={isSaving}>Remove</Button>} />)}</div> : <p className="mt-2 nb-compact text-muted-foreground">Nothing muted.</p>}
        </div>
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard title="Delivery" description="Choose where important updates can reach you.">
      <div className="divide-y divide-border">
        <PreferenceSwitch id="delivery-email" title="Email task assignments" description="Email me when someone assigns me a task. Task preferences, mutes, pauses and quiet hours also apply." checked={preferences.delivery.email ?? true} disabled={isSaving} onToggle={() => save({ ...preferences, delivery: { ...preferences.delivery, email: !(preferences.delivery.email ?? true) } })} />
        <PreferenceSwitch id="delivery-browser" title="Desktop notifications" description={deliveryDescriptions.browser} checked={preferences.delivery.browser && permissionState === "granted"} disabled={isSaving || permissionState === "unsupported" || permissionState === "denied"} onToggle={() => void toggleBrowser()} />
        <PreferenceSwitch id="delivery-push" title="Push notifications" description={deliveryDescriptions.push} checked={preferences.delivery.push && pushStatus === "subscribed"} disabled={isSaving || pushBusy || pushStatus === "unsupported" || pushStatus === "denied"} onToggle={() => void togglePush()} />
      </div>
    </SettingsSectionCard>

    <SettingsSectionCard title="Messages" description="How chat messages reach you as push notifications.">
      <div className="divide-y divide-border">
        <PreferenceSwitch id="chat-thread-replies" title="Replies in threads you follow" description="Push a notification for each new reply. Off: replies still show in your Inbox; @mentions always notify." checked={chat.threadReplies} disabled={isSaving} onToggle={() => save({ ...preferences, chat: { ...chat, threadReplies: !chat.threadReplies } })} />
        <PreferenceSwitch id="chat-show-preview" title="Show message text in notifications" description="Off: notifications say who and where, but only “New message”, so the text never shows on a locked screen." checked={chat.showPreview} disabled={isSaving} onToggle={() => save({ ...preferences, chat: { ...chat, showPreview: !chat.showPreview } })} />
      </div>
    </SettingsSectionCard>
  </div>;
}
