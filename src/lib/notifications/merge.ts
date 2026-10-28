import { normalizeNotificationPreferences } from "@/lib/notifications/preferences";
import type { NotificationPreferences } from "@/lib/notifications/types";

/** A pause can be long, never unbounded. */
export const MAX_NOTIFICATION_PAUSE_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * The preferences to store when someone changes some settings: what is stored now, with only the changed
 * top-level settings taken from what they sent. A mute added from the tray or a pause set from a status in the
 * meantime survives an unrelated toggle. With no `changedKeys` the whole object replaces the stored one.
 */
export function mergeNotificationPreferences(
  stored: unknown,
  incoming: NotificationPreferences,
  changedKeys: Array<keyof NotificationPreferences> | undefined,
  now = Date.now(),
): NotificationPreferences {
  const sent = normalizeNotificationPreferences(incoming);
  const base: Record<string, unknown> = changedKeys?.length
    ? { ...normalizeNotificationPreferences(stored) }
    : { ...sent };
  for (const key of changedKeys ?? []) base[key] = sent[key];
  const next = normalizeNotificationPreferences(base);
  if (next.pausedUntil && new Date(next.pausedUntil).getTime() > now + MAX_NOTIFICATION_PAUSE_MS) {
    next.pausedUntil = new Date(now + MAX_NOTIFICATION_PAUSE_MS).toISOString();
  }
  return next;
}
