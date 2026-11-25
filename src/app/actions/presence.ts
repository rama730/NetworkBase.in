"use server";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import { logger } from "@/lib/logger";
import { uuidArray } from "@/lib/messaging/server";
import {
  NOW_FALLBACK_MS,
  STATUS_TEXT_MAX,
  activeStatus,
  isStatusEmoji,
  presencePrivacy,
  validStatusExpiry,
  type PersonPresence,
  type PersonStatus,
  type StatusVisibility,
} from "@/lib/presence/model";
import { getRedisClient } from "@/lib/redis";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { isUuid } from "@/lib/validations/uuid";

type Failure = { success: false; error: string };
const unauthorized: Failure = { success: false, error: "unauthorized" };
const invalid: Failure = { success: false, error: "invalid_input" };
const MAX_BATCH = 100;

async function rows<T>(query: ReturnType<typeof sql>, action = "presence.read") {
  return (await withDbRetry(action, () => db.execute(query), { module: "presence" })) as unknown as T[];
}

async function exec(query: ReturnType<typeof sql>, action = "presence.write") {
  return await withDbRetry(action, () => db.execute(query), { module: "presence" });
}

async function liveSet(userIds: string[]) {
  const redis = getRedisClient();
  if (!redis || userIds.length === 0) return null;
  try {
    const values = await redis.mget<(string | null)[]>(...userIds.map((id) => `presence:live:${id}`));
    return new Set(userIds.filter((_, index) => values[index] != null));
  } catch (error) {
    logger.warn("presence.live_read_failed", { module: "presence", error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Whose `presence:user:<id>` room the viewer may join: app_private.nb_can_observe_user_presence, the function
 * the Realtime read policy calls, evaluated as the viewer (transaction-local JWT claims). One rule, so a badge
 * never asks for a room Realtime will refuse.
 */
async function observableSet(viewerId: string, userIds: string[]) {
  if (userIds.length === 0) return new Set<string>();
  const found = await withDbRetry("presence.observable", () => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: viewerId, role: "authenticated" })}, true)`);
    return tx.execute(sql`SELECT t.id FROM unnest(${uuidArray(userIds)}) AS t(id) WHERE app_private.nb_can_observe_user_presence(t.id)`);
  }), { module: "presence" }) as unknown as Array<{ id: string }>;
  return new Set(found.map((row) => row.id));
}

type PresenceRow = {
  id: string;
  last_active_at: string | null;
  show_activity: boolean;
  read_receipts?: boolean;
  status_emoji: string | null;
  status_text: string | null;
  status_expires_at: string | null;
  status_set_at: string | null;
  status_pauses_notifications: boolean;
  status_visibility: StatusVisibility;
  connected: boolean;
  teammate: boolean;
  blocked: boolean;
};

/**
 * Presence for up to 100 people, privacy applied on the server:
 * a hidden person reads as Offline; someone who hides their own activity sees
 * everyone as Offline (mutual); a status shows only to its chosen audience;
 * blocked pairs see nothing.
 */
export async function getPresence(input: { userIds: string[] }) {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  const ids = Array.from(new Set((Array.isArray(input?.userIds) ? input.userIds : []).filter(isUuid))).slice(0, MAX_BATCH);
  if (ids.length === 0) return { success: true as const, presence: [] as PersonPresence[] };
  try {
    const [viewer] = await rows<{ show_activity: boolean }>(sql`SELECT show_activity FROM profiles WHERE id = ${user.id}::uuid`);
    const viewerShows = viewer?.show_activity ?? true;
    const found = await rows<PresenceRow>(sql`
      SELECT p.id, p.last_active_at, p.show_activity,
             p.status_emoji, p.status_text, p.status_expires_at, p.status_set_at, p.status_pauses_notifications, p.status_visibility,
             EXISTS (
               SELECT 1 FROM connections c
               WHERE c.status = 'accepted'
                 AND ((c.requester_id = ${user.id}::uuid AND c.addressee_id = p.id) OR (c.addressee_id = ${user.id}::uuid AND c.requester_id = p.id))
             ) AS connected,
             EXISTS (
               SELECT 1 FROM workspace_members mine JOIN workspace_members theirs ON theirs.workspace_id = mine.workspace_id
               WHERE mine.user_id = ${user.id}::uuid AND theirs.user_id = p.id
             ) AS teammate,
             app_private.blocked_between(${user.id}::uuid, p.id) AS blocked
      FROM profiles p
      WHERE p.id = ANY(${uuidArray(ids)})
    `);
    const [live, observable] = await Promise.all([
      liveSet(found.filter((row) => row.show_activity && !row.blocked).map((row) => row.id)),
      observableSet(user.id, found.filter((row) => row.id !== user.id).map((row) => row.id)),
    ]);
    const now = Date.now();
    const presence = found.map((row): PersonPresence => {
      const can = presencePrivacy({
        self: row.id === user.id,
        blocked: row.blocked,
        viewerShowsActivity: viewerShows,
        targetShowsActivity: row.show_activity,
        connected: row.connected,
        teammate: row.teammate,
        visibility: row.status_visibility,
      });
      const activityVisible = can.activity;
      const lastActiveAt = activityVisible && row.last_active_at ? new Date(row.last_active_at).toISOString() : null;
      const isLive = activityVisible && (live ? live.has(row.id) : Boolean(lastActiveAt && now - new Date(lastActiveAt).getTime() < NOW_FALLBACK_MS));
      const status: PersonStatus | null = (row.status_emoji || row.status_text) && can.status
        ? activeStatus({
          emoji: row.status_emoji,
          text: row.status_text,
          expiresAt: row.status_expires_at ? new Date(row.status_expires_at).toISOString() : null,
          setAt: row.status_set_at ? new Date(row.status_set_at).toISOString() : null,
          pausesNotifications: row.status_pauses_notifications,
        })
        : null;
      return { userId: row.id, live: isLive, lastActiveAt, status, realtime: observable.has(row.id) };
    });
    return { success: true as const, presence };
  } catch (error) {
    logger.error("presence.read_failed", { module: "presence", error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "unavailable" };
  }
}

export type MyPresenceSettings = {
  showActivity: boolean;
  /** "Send read receipts" (0150). */
  readReceipts: boolean;
  visibility: StatusVisibility;
  status: PersonStatus | null;
};

/** The signed-in person's own status and privacy settings, for the picker. */
export async function getMyPresenceSettings() {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  const [row] = await rows<PresenceRow>(sql`
    SELECT id, show_activity, read_receipts, status_emoji, status_text, status_expires_at, status_set_at, status_pauses_notifications, status_visibility
    FROM profiles WHERE id = ${user.id}::uuid
  `);
  if (!row) return unauthorized;
  const status = row.status_emoji || row.status_text
    ? activeStatus({
      emoji: row.status_emoji,
      text: row.status_text,
      expiresAt: row.status_expires_at ? new Date(row.status_expires_at).toISOString() : null,
      setAt: row.status_set_at ? new Date(row.status_set_at).toISOString() : null,
      pausesNotifications: row.status_pauses_notifications,
    })
    : null;
  return { success: true as const, settings: { showActivity: row.show_activity, readReceipts: row.read_receipts !== false, visibility: row.status_visibility, status } satisfies MyPresenceSettings };
}

const VISIBILITIES: StatusVisibility[] = ["everyone", "network", "team"];

/**
 * Set (or replace) your status. Pausing notifications reuses the existing
 * notification pause (preferences.pausedUntil), which both push paths honour.
 */
export async function setMyStatus(input: {
  emoji?: string | null;
  text?: string | null;
  expiresAt: string | null;
  pauseNotifications: boolean;
  visibility: StatusVisibility;
}) {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  if (!VISIBILITIES.includes(input?.visibility)) return invalid;
  if (input.emoji != null && !isStatusEmoji(input.emoji)) return invalid;
  const emoji = input.emoji ?? null;
  const text = typeof input.text === "string" ? input.text.trim().slice(0, STATUS_TEXT_MAX) || null : null;
  if (!emoji && !text) return invalid;
  const expires = validStatusExpiry(input.expiresAt ?? null);
  if (expires === "invalid") return invalid;
  const pause = Boolean(input.pauseNotifications);
  // Pausing with no end still needs one; it lifts when the status is cleared.
  const pauseUntil = pause ? (expires ?? new Date(Date.now() + 90 * 24 * 60 * 60_000)).toISOString() : null;
  await exec(sql`
    UPDATE profiles SET
      status_emoji = ${emoji},
      status_text = ${text},
      status_expires_at = ${expires ? expires.toISOString() : null}::timestamptz,
      status_set_at = now(),
      status_visibility = ${input.visibility},
      notification_preferences = CASE
        WHEN ${pause}::boolean THEN jsonb_set(coalesce(notification_preferences, '{}'::jsonb), '{pausedUntil}', to_jsonb(${pauseUntil}::text))
        WHEN status_pauses_notifications THEN jsonb_set(coalesce(notification_preferences, '{}'::jsonb), '{pausedUntil}', 'null'::jsonb)
        ELSE notification_preferences
      END,
      status_pauses_notifications = ${pause}::boolean
    WHERE id = ${user.id}::uuid
  `);
  return { success: true as const };
}

export async function clearMyStatus() {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  await exec(sql`
    UPDATE profiles SET
      notification_preferences = CASE
        WHEN status_pauses_notifications THEN jsonb_set(coalesce(notification_preferences, '{}'::jsonb), '{pausedUntil}', 'null'::jsonb)
        ELSE notification_preferences
      END,
      status_emoji = NULL, status_text = NULL, status_expires_at = NULL,
      status_set_at = NULL, status_pauses_notifications = false
    WHERE id = ${user.id}::uuid
  `);
  return { success: true as const };
}

/**
 * Resume notifications now (Settings): lifts the pause, and a pause your status set too, so
 * your card stops saying "Notifications paused" while you're back.
 */
export async function resumeNotifications() {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  await exec(sql`
    UPDATE profiles SET
      notification_preferences = jsonb_set(coalesce(notification_preferences, '{}'::jsonb), '{pausedUntil}', 'null'::jsonb),
      status_pauses_notifications = false
    WHERE id = ${user.id}::uuid
  `);
  return { success: true as const };
}

/** Who may see your status. */
export async function setStatusVisibility(input: { visibility: StatusVisibility }) {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  if (!VISIBILITIES.includes(input?.visibility)) return invalid;
  await exec(sql`UPDATE profiles SET status_visibility = ${input.visibility} WHERE id = ${user.id}::uuid`, "presence.set_visibility");
  return { success: true as const };
}

/**
 * Show or hide when you're active. Hiding wipes last-active and the live key,
 * so no existing profile, card or search payload can reveal it; it is mutual
 * (getPresence shows a hidden viewer everyone as Offline).
 */
/** "Send read receipts" (Settings › Privacy): off, people don't see when you've read theirs, and you don't see theirs. */
export async function setReadReceipts(input: { on: boolean }) {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  await exec(sql`UPDATE profiles SET read_receipts = ${Boolean(input?.on)}::boolean WHERE id = ${user.id}::uuid`, "presence.set_read_receipts");
  return { success: true as const };
}

export async function setShowActivity(input: { show: boolean }) {
  const user = await getAuthUser();
  if (!user) return unauthorized;
  const show = Boolean(input?.show);
  await exec(sql`
    UPDATE profiles SET show_activity = ${show}::boolean, last_active_at = CASE WHEN ${show}::boolean THEN last_active_at ELSE NULL END
    WHERE id = ${user.id}::uuid
  `, "presence.set_activity_visibility");
  if (!show) await getRedisClient()?.del(`presence:live:${user.id}`).catch(() => undefined);
  return { success: true as const };
}
