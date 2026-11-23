"use server";

import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { meetingFeedTokens } from "@/lib/db/schema";

/**
 * Report 38.11 W10 and call 7 (plan A4.1b): a personal, read-only .ics link of the meetings you attend. Only the
 * token's SHA-256 is kept, so the link is shown when it's made; making a new one stops the old one.
 */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function readMeetingFeedAction() {
  const { user } = await requireAuthenticatedUser();
  if (!user) return { success: false as const, error: "Sign in to continue" };
  const [row] = await db.select({ createdAt: meetingFeedTokens.createdAt }).from(meetingFeedTokens).where(eq(meetingFeedTokens.userId, user.id)).limit(1);
  return { success: true as const, hasLink: Boolean(row), since: row ? row.createdAt.toISOString() : null };
}

/** A new link (any earlier one stops working). Returned once; the path is relative to the site. */
export async function newMeetingFeedAction() {
  const { user } = await requireAuthenticatedUser();
  if (!user) return { success: false as const, error: "Sign in to continue" };
  const token = randomBytes(24).toString("base64url");
  await db.insert(meetingFeedTokens).values({ userId: user.id, tokenHash: hash(token) })
    .onConflictDoUpdate({ target: meetingFeedTokens.userId, set: { tokenHash: hash(token), createdAt: new Date() } });
  return { success: true as const, path: `/api/feeds/meetings/${token}` };
}

export async function stopMeetingFeedAction() {
  const { user } = await requireAuthenticatedUser();
  if (!user) return { success: false as const, error: "Sign in to continue" };
  await db.delete(meetingFeedTokens).where(eq(meetingFeedTokens.userId, user.id));
  return { success: true as const };
}

/**
 * Report 38.11 part 8 (A4.1b): My work's meetings today: the ones you attend, in workspaces you belong to, between
 * the start and end of your own day (the browser says when that is). Leaders-only meetings only for owners and admins.
 */
export async function readMyMeetingsTodayAction(input: { from: string; to: string }) {
  const { user } = await requireAuthenticatedUser();
  if (!user) return { success: false as const, error: "Sign in to continue" };
  const from = Date.parse(input?.from), to = Date.parse(input?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 2 * 86_400_000) return { success: false as const, error: "Pick a day" };
  const { sql } = await import("drizzle-orm");
  const rows = Array.from(await db.execute<{ slug: string; title: string; starts_at: string; length: number | null; ws_slug: string | null; workspace_id: string; ws_title: string; finished: boolean }>(sql`
    SELECT d.slug, coalesce(d.settings->>'meetingTitle', d.filename) AS title, d.settings->>'startsAt' AS starts_at, (d.settings->>'lengthMinutes')::int AS length,
      w.slug AS ws_slug, w.id AS workspace_id, w.title AS ws_title, (d.settings ? 'finishedAt') AS finished
    FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
    LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${user.id}::uuid
    WHERE d.settings->>'section' = 'meetings' AND d.settings->'attendeeIds' ? ${user.id}
      AND (w.owner_id = ${user.id}::uuid OR m.user_id IS NOT NULL)
      AND (coalesce(d.settings->>'visibilityOverride', 'inherit_workspace') <> 'leaders_only' OR w.owner_id = ${user.id}::uuid OR m.role = 'admin')
      AND (d.settings->>'startsAt')::timestamptz >= ${new Date(from).toISOString()}::timestamptz AND (d.settings->>'startsAt')::timestamptz < ${new Date(to).toISOString()}::timestamptz
    ORDER BY d.settings->>'startsAt' LIMIT 50`));
  return { success: true as const, meetings: rows.map((r) => ({ title: r.title.replace(/\.md$/i, ""), startsAt: r.starts_at, lengthMinutes: r.length ?? 30, workspace: r.ws_title, finished: r.finished,
    href: `/workspaces/${encodeURIComponent(r.ws_slug || r.workspace_id)}?tab=docs&doc=${encodeURIComponent(r.slug)}` })) };
}
