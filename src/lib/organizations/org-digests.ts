import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, projectMembers, projects, roleApplications } from "@/lib/db/schema";
import { normalizeNotificationPreferences } from "@/lib/notifications/preferences";
import { notifyOrg, orgHref, queueOrgEmails } from "@/lib/organizations/notify";
import { DIGEST_HOUR, digestIsEmpty, DUE_SOON_HOUR, localClock, nextDate } from "@/lib/organizations/notify-rules";

// The two scheduled org jobs (report §26.5). Both run hourly and act only where it is the right local hour;
// the outbox event key (per person, per org, per local day) makes a second run in the same hour a no-op.

const notHandedIn = sql`NOT (c.review_status = 'pending' OR c.status = 'done' OR c.submission IS NOT NULL)`;
const openMaster = sql`m.deleted_at IS NULL AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL`;

type DueRow = { copy_id: string; title: string; due_date: string; status: string; org_id: string; people: string[]; late_rule: string | null; late_until: string | null };

/**
 * E6 (one combined "due tomorrow" per person per org per day, at 9:00 their time) and E7 (once per copy when
 * it goes overdue and late work is still accepted), each with its tray notice.
 */
export async function runOrgDueSoon(now = new Date()) {
  // ponytail: one scan of copies due in the next two days or overdue in the last one. Ceiling: fine to tens of
  // thousands of open copies; upgrade to a per-zone queue if the hourly scan grows slow.
  const rows = await db.execute<DueRow>(sql`
    SELECT c.id AS copy_id, c.title, c.due_date, c.status, m.project_id AS org_id,
      m.assignment_settings->>'lateRule' AS late_rule, m.assignment_settings->>'lateUntil' AS late_until,
      to_jsonb(array_remove(array_append(coalesce((SELECT array_agg(tm.user_id) FROM task_team_members tm WHERE tm.task_id = c.id), '{}'), c.assignee_id), NULL)) AS people
    FROM tasks c JOIN tasks m ON m.id = c.assignment_id
    WHERE c.deleted_at IS NULL AND c.excused_at IS NULL AND c.due_date IS NOT NULL AND ${notHandedIn} AND ${openMaster}
      AND c.due_date > ${now.toISOString()}::timestamptz - interval '1 day' AND c.due_date < ${now.toISOString()}::timestamptz + interval '2 days'`);
  if (rows.length === 0) return { dueSoon: 0, overdue: 0 };

  const people = [...new Set(rows.flatMap((r) => r.people))];
  const orgIds = [...new Set(rows.map((r) => r.org_id))];
  const [prefs, orgs] = await Promise.all([
    db.select({ id: profiles.id, preferences: profiles.notificationPreferences }).from(profiles).where(inArray(profiles.id, people)),
    db.select({ id: projects.id, title: projects.title, slug: projects.slug, timeZone: projects.timeZone }).from(projects).where(inArray(projects.id, orgIds)),
  ]);
  const zoneOf = new Map(prefs.map((p) => [p.id, normalizeNotificationPreferences(p.preferences).quietHours.timeZone ?? null]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const dueSoon = new Map<string, { orgId: string; userId: string; date: string; items: Array<{ title: string; dueAt: string; status: string }> }>();
  let overdue = 0;
  for (const row of rows) {
    const org = orgById.get(row.org_id);
    if (!org) continue;
    const due = new Date(row.due_date);
    for (const userId of new Set(row.people)) {
      const zone = zoneOf.get(userId) ?? org.timeZone;
      const clock = localClock(now, zone);
      if (clock.hour !== DUE_SOON_HOUR) continue;
      if (due.getTime() < now.getTime()) {
        const lateOpen = row.late_rule === "always" || (row.late_rule === "until" && row.late_until && new Date(row.late_until).getTime() > now.getTime());
        if (!lateOpen) continue;
        overdue++;
        await notifyOrg({
          orgId: org.id, eventKey: "assignments.due_soon", to: [userId], title: `${row.title} is overdue${row.late_rule === "until" && row.late_until ? " · late work still accepted" : ""}`,
          href: orgHref(org, `?tab=assignments&copy=${encodeURIComponent(row.copy_id)}`), sourceEventId: `overdue:${row.copy_id}`, refs: { taskId: row.copy_id },
          email: { kind: "org_overdue", data: { assignment: { title: row.title, copyId: row.copy_id, dueAt: due.toISOString(), lateUntil: row.late_rule === "until" ? row.late_until : null }, timeZone: zone ?? null } },
        });
      } else if (localClock(due, zone).date === nextDate(clock.date)) {
        const key = `${org.id}:${userId}`;
        const entry = dueSoon.get(key) ?? { orgId: org.id, userId, date: clock.date, items: [] };
        entry.items.push({ title: row.title, dueAt: due.toISOString(), status: row.status === "in_progress" ? "In progress" : "Not started" });
        dueSoon.set(key, entry);
      }
    }
  }
  // ponytail: one tray call per person and org (each reads the org's rules). Ceiling: a few thousand people at
  // 9:00 in one zone; upgrade to one batched fan-out per org when that hour gets slow.
  for (const entry of dueSoon.values()) {
    const org = orgById.get(entry.orgId)!;
    const one = entry.items.length === 1;
    await notifyOrg({
      orgId: org.id, eventKey: "assignments.due_soon", to: [entry.userId],
      title: one ? `${entry.items[0]!.title} is due tomorrow` : `${entry.items.length} assignments due tomorrow in ${org.title}`,
      href: orgHref(org, "?tab=assignments"), sourceEventId: `due:${org.id}:${entry.date}`,
      email: { kind: "org_due_soon", data: { items: entry.items, timeZone: zoneOf.get(entry.userId) ?? null } },
    });
  }
  return { dueSoon: dueSoon.size, overdue };
}

/** E11 at 8:00 org time to the owner and admins: to review, join requests, behind. Empty → not sent; "instant" orgs skip it. */
export async function runOrgAdminDigest(now = new Date()) {
  const orgs = await db.select({ id: projects.id, ownerId: projects.ownerId, timeZone: projects.timeZone, settings: projects.orgSettings })
    .from(projects).where(and(eq(projects.kind, "organization"), isNull(projects.deletedAt)));
  let sent = 0;
  for (const org of orgs) {
    const clock = localClock(now, org.timeZone);
    if (clock.hour !== DIGEST_HOUR || (org.settings as { adminDigest?: string } | null)?.adminDigest === "instant") continue;
    const [toReview, [requests], [behind]] = await Promise.all([
      db.execute<{ title: string; count: number }>(sql`
        SELECT m.title, count(*)::int AS count FROM tasks c JOIN tasks m ON m.id = c.assignment_id
        WHERE m.project_id = ${org.id} AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND c.review_status = 'pending'
        GROUP BY m.id, m.title ORDER BY count DESC LIMIT 20`),
      db.select({ n: sql<number>`count(*)::int` }).from(roleApplications)
        .where(and(eq(roleApplications.projectId, org.id), isNull(roleApplications.roleId), eq(roleApplications.status, "pending"))),
      db.execute<{ n: number }>(sql`
        SELECT count(DISTINCT c.assignee_id)::int AS n FROM tasks c JOIN tasks m ON m.id = c.assignment_id
        WHERE m.project_id = ${org.id} AND ${openMaster} AND c.deleted_at IS NULL AND c.excused_at IS NULL
          AND c.due_date < ${now.toISOString()}::timestamptz AND ${notHandedIn}`),
    ]);
    const digest = { toReview: [...toReview], joinRequests: requests?.n ?? 0, needsYou: [] as string[], behind: behind?.n ?? 0 };
    if (digestIsEmpty(digest)) continue;
    const admins = await db.select({ userId: projectMembers.userId }).from(projectMembers)
      .where(and(eq(projectMembers.projectId, org.id), eq(projectMembers.role, "admin")));
    await queueOrgEmails(org.id, null, `digest:${org.id}:${clock.date}`, { kind: "org_digest", data: { digest } }, [org.ownerId, ...admins.map((a) => a.userId)]);
    sent++;
  }
  return { sent };
}
