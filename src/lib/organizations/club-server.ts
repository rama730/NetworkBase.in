import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { readRenewal, windowClosed } from "@/lib/organizations/club";

// Report 36.2 (plan B7.1b): Season renewal notices. Server only.

/** One notice to each member who should answer (Normal); `key` keeps it once per Season (ask, and the day-25 reminder). */
export async function askMembers(orgId: string, slug: string, season: string, ask: string, actor: string | null, key: "ask" | "remind") {
  const members = Array.from(await db.execute<{ id: string }>(sql`
    SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND completed_at IS NULL AND role <> 'viewer'
      AND joined_at < ${season}::date - 30 ${key === "remind" ? sql`AND coalesce(view_prefs->'club'->'renewal'->>'season', '') <> ${season}` : sql``} LIMIT 2000`));
  for (const m of members) {
    if (m.id === actor) continue;
    await createNotification({ recipientUserId: m.id, actorUserId: actor, kind: "project_task_activity", category: "tasks", importance: "more",
      title: key === "ask" ? ask : `${ask} Answer by the end of the window.`, href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug },
      dedupeKey: `club-renewal:${key}:${orgId}:${season}:${m.id}` }).catch(() => undefined);
  }
}


const DAY = 86_400_000;
/** Hourly (layer 15): once more at day 25 of the window, to members who haven't answered. */
export async function renewalReminders(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const clubs = Array.from(await db.execute<{ id: string; slug: string | null; settings: unknown }>(sql`
    SELECT id, slug, org_settings AS settings FROM workspaces WHERE kind = 'organization' AND org_type = 'club' AND deleted_at IS NULL AND suspended_at IS NULL AND status <> 'archived'
      AND coalesce((org_settings->'club'->'renewal'->>'on')::boolean, false) LIMIT 500`));
  let sent = 0;
  for (const c of clubs) {
    const r = readRenewal(c.settings);
    if (!r?.on || windowClosed(r, today)) continue;
    if (Date.parse(`${today}T00:00:00Z`) < Date.parse(`${r.season}T00:00:00Z`) + 25 * DAY) continue;
    await askMembers(c.id, c.slug ?? c.id, r.season, r.ask, null, "remind");
    sent++;
  }
  return { sent };
}
