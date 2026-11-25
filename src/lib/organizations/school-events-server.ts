import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { eventFieldsSchema, forMe, occurrences, type EventFields } from "@/lib/organizations/school-events";
import { DAY_WORDS, dayKind, readSchoolYear } from "@/lib/organizations/school-year";
import { todayInZone } from "@/lib/organizations/zoned-time";

/**
 * Report 32.2 S1 (plan B3.1b–c): the server side of school events — one read rule for the Events view, the personal
 * .ics feed and the Friday Summary, so a person never sees a school event that isn't meant for them anywhere.
 */
type Org = { id: string; slug: string | null; title: string; level: string | null; institution_id: string | null; settings: unknown; kind: string; zone: string | null };
export async function schoolOrg(orgId: string) {
  const [w] = Array.from(await db.execute<Org>(sql`
    SELECT id, slug, title, org_level AS level, institution_id, org_settings AS settings, kind, time_zone AS zone FROM workspaces WHERE id = ${orgId}::uuid AND deleted_at IS NULL`));
  return w?.kind === "organization" ? w : null;
}

type EventRow = { id: string; title: string; stage: string; fields: EventFields; owner: string | null; workspace_id: string };
export async function eventsOf(orgIds: string[]) {
  if (!orgIds.length) return [] as EventRow[];
  const rows = Array.from(await db.execute<{ id: string; title: string; stage: string | null; fields: unknown; owner: string | null; workspace_id: string }>(sql`
    SELECT t.id, t.title, t.stage, t.type_fields AS fields, coalesce(p.full_name, p.username) AS owner, t.workspace_id FROM tasks t LEFT JOIN profiles p ON p.id = t.assignee_id
    WHERE t.workspace_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(orgIds)}::jsonb)::uuid) AND t.item_type = 'event' AND t.deleted_at IS NULL`));
  return rows.flatMap((r) => { const f = eventFieldsSchema.safeParse(r.fields); return f.success ? [{ ...r, stage: r.stage ?? "planned", fields: f.data }] : []; });
}

/** Events between two days that `userId` may see in `orgId` (its own and, for a class, its school's). Null when they can't read it. */
export async function eventsFor(orgId: string, userId: string, from: string, to: string) {
  const a = await getWorkspaceAccessById(orgId, userId);
  const o = await schoolOrg(orgId);
  if (!o || !a.canRead || !(a.isOwner || a.isMember)) return null;
  const schoolId = o.level === "institution" ? o.id : o.institution_id;
  const school = schoolId && schoolId !== o.id ? await schoolOrg(schoolId) : o.level === "institution" ? o : null;
  const year = readSchoolYear(school?.settings ?? o.settings);
  // For me: the classes of the school I'm in, and my role in the school.
  const myClasses = schoolId ? Array.from(await db.execute<{ id: string }>(sql`
    SELECT w.id FROM workspaces w WHERE w.institution_id = ${schoolId}::uuid AND w.deleted_at IS NULL
      AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid))`)).map((r) => r.id) : [];
  const schoolAccess = schoolId ? await getWorkspaceAccessById(schoolId, userId) : null;
  const role = schoolAccess?.isOwner ? "owner" as const : (schoolAccess?.memberRole as "admin" | "member" | "viewer" | null) ?? null;
  const rows = await eventsOf([...new Set([o.id, ...(schoolId ? [schoolId] : [])])]);
  // Review: a school event shows to the people in its audience and to the school's admins; a class's own to its members.
  const runsSchool = role === "owner" || role === "admin";
  const visible = rows.filter((e) => e.workspace_id === o.id && o.level !== "institution" ? true : runsSchool || forMe(e.fields.audience, { classIds: myClasses, role }));
  const items = visible.flatMap((e) => occurrences(e.fields, from, to, year).map((day) => ({ id: e.id, day, title: e.title, stage: e.stage, type: e.fields.type, time: e.fields.time, place: e.fields.place,
    owner: e.owner, public: e.fields.public, fromSchool: e.workspace_id !== o.id, forMe: forMe(e.fields.audience, { classIds: myClasses, role }), repeats: Boolean(e.fields.repeat), orgSlug: e.workspace_id === o.id ? o.slug : school?.slug ?? null })))
    .sort((x, y) => `${x.day}${x.time ?? ""}`.localeCompare(`${y.day}${y.time ?? ""}`));
  return { items, canAdd: a.canWrite && (a.isOwner || a.memberRole === "admin"), schoolTitle: school && school.id !== o.id ? school.title : null, year, zone: school?.zone ?? o.zone };
}

/** Every school and school class this person belongs to (owner or member). */
async function mySchoolOrgs(userId: string) {
  return Array.from(await db.execute<{ id: string }>(sql`
    SELECT w.id FROM workspaces w WHERE w.kind = 'organization' AND w.deleted_at IS NULL AND (w.org_level = 'institution' OR w.institution_id IS NOT NULL)
      AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid))
    LIMIT 50`)).map((r) => r.id);
}

/** Call 7 (subscribe): the person's own school events for their .ics link — For me only, never cancelled, each occurrence once. */
export async function personalSchoolEvents(userId: string, from: string, to: string) {
  const seen = new Set<string>();
  const out: Array<{ id: string; day: string; title: string; time: string | null; orgSlug: string | null; zone: string | null }> = [];
  for (const orgId of await mySchoolOrgs(userId)) {
    const r = await eventsFor(orgId, userId, from, to);
    for (const e of r?.items ?? []) {
      const key = `${e.id}:${e.day}`;
      if (!e.forMe || e.stage === "cancelled" || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: e.id, day: e.day, title: e.title, time: e.time, orgSlug: e.orgSlug, zone: r!.zone });
    }
  }
  return out;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Call 10 (layer 15): "Next week at school" as a Summary on the week's last school day after 3 PM — your events and day types. */
export async function notifySchoolWeek(now = new Date()) {
  const schools = Array.from(await db.execute<{ id: string; slug: string | null; zone: string | null; settings: unknown }>(sql`
    SELECT id, slug, time_zone AS zone, org_settings AS settings FROM workspaces
    WHERE kind = 'organization' AND org_level = 'institution' AND deleted_at IS NULL AND status <> 'archived' AND org_settings ? 'schoolYear' LIMIT 500`));
  let sent = 0;
  for (const s of schools) {
    const year = readSchoolYear(s.settings);
    if (!year) continue;
    const today = todayInZone(s.zone, now);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: s.zone || "UTC", hour: "2-digit", hourCycle: "h23" }).format(now));
    const monday = addDays(today, -((weekday(today) + 6) % 7));
    const schoolDays = [0, 1, 2, 3, 4].map((i) => addDays(monday, i)).filter((d) => ["school", "half", "exam"].includes(dayKind(d, year)));
    // ponytail: 3–5 PM window (three hourly runs, dedupe keys hold) so a busy Friday is walked at most 3 times; mark sent schools if it grows.
    if (hour < 15 || hour > 17 || schoolDays[schoolDays.length - 1] !== today) continue;
    const next = addDays(monday, 7), nextEnd = addDays(next, 6);
    const days = [0, 1, 2, 3, 4].map((i) => addDays(next, i)).map((d) => dayKind(d, year)).filter((k) => k === "holiday" || k === "staff" || k === "half" || k === "exam");
    const people = Array.from(await db.execute<{ user_id: string }>(sql`
      SELECT owner_id AS user_id FROM workspaces WHERE (id = ${s.id}::uuid OR institution_id = ${s.id}::uuid) AND deleted_at IS NULL
      UNION SELECT m.user_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      WHERE (w.id = ${s.id}::uuid OR w.institution_id = ${s.id}::uuid) AND m.role <> 'viewer' LIMIT 2000`));
    // B3.2d (report 32.3 layer 15): classes 3 or more lessons Behind the map, for leaders (all) and heads (their department).
    const { behindBy, schoolCourses } = await import("@/lib/organizations/curriculum-server");
    const behindNow = behindBy(await schoolCourses(s.id), today);
    const leaders = new Set(Array.from(await db.execute<{ user_id: string }>(sql`
      SELECT owner_id AS user_id FROM workspaces WHERE id = ${s.id}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${s.id}::uuid AND role = 'admin'`)).map((r) => r.user_id));
    const depts = ((s.settings as { departments?: unknown } | null)?.departments ?? []) as Array<{ id?: string; heads?: unknown }>;
    const headOf = (u: string) => new Set((Array.isArray(depts) ? depts : []).filter((d) => Array.isArray(d.heads) && d.heads.includes(u)).map((d) => d.id));
    for (const p of people) {
      const mine = (await personalSchoolEvents(p.user_id, next, nextEnd)).length;
      const heads = headOf(p.user_id);
      const late = behindNow.filter((c) => leaders.has(p.user_id) || (c.department && heads.has(c.department))).length;
      if (!mine && !days.length && !late) continue;
      const kinds = [...new Set(days)].map((k) => DAY_WORDS[k]).join(", ");
      const title = `Next week at school: ${mine} ${mine === 1 ? "event" : "events"}${kinds ? ` · ${kinds}` : ""}${late ? ` · ${late} ${late === 1 ? "class" : "classes"} Behind the map` : ""}`;
      await createNotification({ recipientUserId: p.user_id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more", title,
        href: `/org/${encodeURIComponent(s.slug || s.id)}?tab=sprints`, entityRefs: { projectId: s.id, projectSlug: s.slug }, dedupeKey: `school-week:${s.id}:${p.user_id}:${next}` })
        .then(() => { sent += 1; }).catch((error) => logger.error("school_events.week_summary_failed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { sent };
}

/** Layer 15: an event for you cancelled within 48 hours is Important — to the people it was for, not the one who cancelled it. */
export async function notifyEventCancelled(orgId: string, eventId: string, actorId: string, now = new Date()) {
  const o = await schoolOrg(orgId);
  if (!o) return;
  const today = todayInZone(o.zone, now), soon = addDays(today, 2);
  const people = Array.from(await db.execute<{ user_id: string }>(sql`
    SELECT owner_id AS user_id FROM workspaces WHERE (id = ${orgId}::uuid OR institution_id = ${orgId}::uuid) AND deleted_at IS NULL
    UNION SELECT m.user_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
    WHERE (w.id = ${orgId}::uuid OR w.institution_id = ${orgId}::uuid) AND m.role <> 'viewer' LIMIT 2000`));
  for (const p of people) {
    if (p.user_id === actorId) continue;
    const r = await eventsFor(orgId, p.user_id, today, soon);
    const hit = r?.items.find((e) => e.id === eventId && e.forMe);
    if (!hit) continue;
    await createNotification({ recipientUserId: p.user_id, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `Cancelled: ${hit.title} (${hit.day}${hit.time ? ` ${hit.time}` : ""})`, href: `/org/${encodeURIComponent(o.slug || o.id)}?tab=sprints`,
      entityRefs: { projectId: o.id, projectSlug: o.slug }, dedupeKey: `event-cancelled:${eventId}:${p.user_id}:${hit.day}` })
      .catch((error) => logger.error("school_events.cancel_notice_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
}
