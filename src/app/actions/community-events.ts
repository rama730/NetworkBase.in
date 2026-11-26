"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { canRsvp, communityEventSchema, eventProblem, eventState, placeFor, placesLeft, type CommunityEventFields } from "@/lib/organizations/community-events";
import { pauseActive } from "@/lib/organizations/community";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 34.4 (plan B5.3a, M3): community events with the RSVP slice — Going · Can't go, a place limit and a first-come
 * waitlist that moves up on its own (calls 1, 3). RSVPs need membership (call 2). The online link reaches only people
 * Going, the event's hosts and organisers (call 4). Private RSVPs are counted and never named to members; hosts see
 * them to check people in. Organisers and Hosts (M2 label) create events; a host edits the events they host. Never a
 * token: agents never RSVP for anyone.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function community(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; title: string; labels: unknown; pause: { until: string } | null }>(sql`
    SELECT w.org_type AS type, w.slug, w.title,
      (SELECT m.view_prefs->'community'->'labels' FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.role IN ('member', 'admin', 'owner')) AS labels,
      w.org_settings->'community'->'pauses'->${userId ?? ""}::text AS pause
    FROM workspaces w WHERE w.id = ${orgId}::uuid AND w.kind = 'organization' AND w.deleted_at IS NULL`));
  if (w?.type !== "community" || !a.canRead) return null;
  const member = Boolean(userId) && (a.isOwner || (a.isMember && a.memberRole !== "viewer"));
  const organiser = a.isOwner || a.memberRole === "admin";
  return { userId, slug: w.slug ?? orgId, title: w.title, member, organiser,
    host: member && Array.isArray(w.labels) && (w.labels as unknown[]).includes("host"), paused: pauseActive(w.pause, new Date()) };
}

type EventRow = { id: string; title: string; description: string | null; stage: string; fields: CommunityEventFields; place_limit: number | null; link: string | null;
  going: number; waitlisted: number; mine: string | null; mine_private: boolean | null; position: number | null };

async function events(orgId: string, userId: string | null, where: ReturnType<typeof sql>) {
  return Array.from(await db.execute<EventRow>(sql`
    SELECT t.id, t.title, t.description, t.stage, t.type_fields AS fields, e.place_limit, e.online_link AS link,
      (SELECT count(*)::int FROM community_rsvps r WHERE r.task_id = t.id AND r.state = 'going') AS going,
      (SELECT count(*)::int FROM community_rsvps r WHERE r.task_id = t.id AND r.state = 'waitlisted') AS waitlisted,
      (SELECT r.state FROM community_rsvps r WHERE r.task_id = t.id AND r.user_id = ${userId}::uuid) AS mine,
      (SELECT r.private FROM community_rsvps r WHERE r.task_id = t.id AND r.user_id = ${userId}::uuid) AS mine_private,
      (SELECT count(*)::int + 1 FROM community_rsvps r, community_rsvps me WHERE me.task_id = t.id AND me.user_id = ${userId}::uuid AND me.state = 'waitlisted'
        AND r.task_id = t.id AND r.state = 'waitlisted' AND r.responded_at < me.responded_at) AS position
    FROM tasks t LEFT JOIN community_events e ON e.task_id = t.id
    WHERE t.workspace_id = ${orgId}::uuid AND t.item_type = 'event' AND t.deleted_at IS NULL AND t.type_fields->>'kind' = 'community' AND ${where}
    ORDER BY t.type_fields->>'start' LIMIT 200`));
}

function shape(r: EventRow, ctx: { userId: string | null; organiser: boolean; member: boolean }, now: Date) {
  const isHost = Boolean(ctx.userId && r.fields.hosts.includes(ctx.userId));
  const state = eventState(r.fields, r.stage === "cancelled", r.place_limit, r.going, now);
  // Call 4: the online link only for people Going, the event's hosts and organisers.
  const seesLink = ctx.member && (r.mine === "going" || isHost || ctx.organiser);
  return { id: r.id, title: r.title, description: r.description, state, start: r.fields.start, end: r.fields.end, format: r.fields.format,
    place: r.fields.place, who: r.fields.who, hosts: r.fields.hosts, runOfShow: r.fields.runOfShow,
    going: r.going, waitlisted: r.waitlisted, placesLeft: placesLeft(r.place_limit, r.going), placeLimit: ctx.organiser || isHost ? r.place_limit : undefined,
    link: seesLink ? r.link : null, hasLink: Boolean(r.link), mine: r.mine as "going" | "waitlisted" | "cant_go" | null, minePrivate: r.mine_private === true,
    position: r.mine === "waitlisted" ? r.position : null, canEdit: ctx.organiser || isHost };
}

/** Sprints → Events (Upcoming or Past). Members see every event; visitors only public ones, without the link or names. */
export async function readCommunityEventsAction(orgId: string, when: "upcoming" | "past") {
  const ctx = await community(orgId);
  if (!ctx || (when !== "upcoming" && when !== "past")) return DENIED;
  const now = new Date();
  const timing = when === "upcoming" ? sql`(t.type_fields->>'end')::timestamptz > now()` : sql`(t.type_fields->>'end')::timestamptz <= now()`;
  const rows = await events(orgId, ctx.userId, ctx.member ? timing : sql`${timing} AND t.type_fields->>'who' = 'public' AND t.stage <> 'cancelled'`);
  const list = (when === "past" ? rows.reverse() : rows).map((r) => shape(r, ctx, now));
  return { success: true as const, member: ctx.member, canCreate: ctx.member && (ctx.organiser || ctx.host), events: list };
}

/** The event page: details, RSVP, run of show and who's going (members only; private RSVPs counted, named only to hosts). */
export async function readCommunityEventAction(orgId: string, eventId: string) {
  const ctx = await community(orgId);
  if (!ctx || !isLooseUuid(eventId)) return DENIED;
  const [r] = await events(orgId, ctx.userId, sql`t.id = ${eventId}::uuid`);
  if (!r || (!ctx.member && (r.fields.who !== "public" || r.stage === "cancelled"))) return DENIED;
  const e = shape(r, ctx, new Date());
  if (!ctx.member) return { success: true as const, event: e, people: [], waitlist: [], hostView: false };
  const hostView = e.canEdit;
  const people = Array.from(await db.execute<{ id: string; name: string | null; username: string | null; avatar_url: string | null; state: string; private: boolean; checked_in: boolean }>(sql`
    SELECT p.id, p.full_name AS name, p.username, p.avatar_url, r.state, r.private, r.checked_in_at IS NOT NULL AS checked_in
    FROM community_rsvps r JOIN profiles p ON p.id = r.user_id
    WHERE r.task_id = ${eventId}::uuid AND r.state IN ('going', 'waitlisted') AND (${hostView} OR (r.state = 'going' AND NOT r.private))
      AND NOT app_private.blocked_between(${ctx.userId}::uuid, r.user_id)
    ORDER BY r.responded_at`));
  const named = (x: (typeof people)[number]) => ({ id: x.id, name: x.name ?? x.username ?? "Someone", avatarUrl: x.avatar_url, private: x.private, checkedIn: x.checked_in });
  return { success: true as const, event: e, hostView,
    people: people.filter((x) => x.state === "going").map(named), waitlist: hostView ? people.filter((x) => x.state === "waitlisted").map(named) : [] };
}

const saveSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(5000).nullable(),
  fields: communityEventSchema, link: z.string().trim().max(500).regex(/^https:\/\//).nullable(), placeLimit: z.number().int().min(1).max(100000).nullable(),
}).strict();

/** + Event and Edit (organisers and Hosts; a host edits only events they host). A moved event tells everyone Going (Important). */
export async function saveCommunityEventAction(orgId: string, eventId: string | null, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.member || !ctx.userId || !(ctx.organiser || ctx.host)) return DENIED;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the event’s title, times and link (https only)." };
  const d = parsed.data;
  const problem = eventProblem(d.fields);
  if (problem) return { success: false, error: problem };
  // Hosts are members of this community; the creator hosts by default.
  const valid = d.fields.hosts.length ? new Set(Array.from(await db.execute<{ id: string }>(sql`
    SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role IN ('member', 'admin', 'owner') AND user_id = ANY(${`{${d.fields.hosts.join(",")}}`}::uuid[])`)).map((x) => x.id)) : new Set<string>();
  const fields: CommunityEventFields = { ...d.fields, place: d.fields.place?.trim() || null, hosts: d.fields.hosts.filter((h) => valid.has(h)) };
  if (!fields.hosts.length) fields.hosts = [ctx.userId];
  const link = d.fields.format === "in_person" ? null : d.link;

  if (!eventId) {
    if (Date.parse(fields.end) <= Date.now()) return { success: false, error: "Pick a time that hasn’t passed." };
    const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
    const r = await createTaskAction({ projectId: orgId, title: d.title, description: d.description ?? undefined, status: "todo", priority: "medium", itemType: "event", stage: "planned", typeFields: fields } as Parameters<typeof createTaskAction>[0]);
    if (!r.success || !("task" in r) || !r.task) return { success: false, error: (r.success ? null : r.error) ?? "Couldn’t add the event." };
    await db.execute(sql`INSERT INTO community_events (task_id, workspace_id, online_link, place_limit) VALUES (${r.task.id}::uuid, ${orgId}::uuid, ${link}, ${d.placeLimit})`);
    return { success: true, id: r.task.id };
  }
  if (!isLooseUuid(eventId)) return DENIED;
  const [old] = Array.from(await db.execute<{ fields: CommunityEventFields; stage: string }>(sql`
    SELECT type_fields AS fields, stage FROM tasks WHERE id = ${eventId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'event' AND type_fields->>'kind' = 'community' AND deleted_at IS NULL`));
  if (!old || old.stage === "cancelled" || !(ctx.organiser || old.fields.hosts.includes(ctx.userId))) return DENIED;
  // A host can't hand the event to people who aren't hosting it; organisers pick the hosts.
  if (!ctx.organiser) fields.hosts = old.fields.hosts;
  await db.execute(sql`UPDATE tasks SET title = ${d.title}, description = ${d.description}, type_fields = ${JSON.stringify(fields)}::jsonb, updated_at = now() WHERE id = ${eventId}::uuid`);
  await db.execute(sql`INSERT INTO community_events (task_id, workspace_id, online_link, place_limit) VALUES (${eventId}::uuid, ${orgId}::uuid, ${link}, ${d.placeLimit})
    ON CONFLICT (task_id) DO UPDATE SET online_link = excluded.online_link, place_limit = excluded.place_limit`);
  // A raised limit lets the waitlist move up; a lowered one keeps everyone already Going.
  await promote(orgId, eventId, ctx);
  if (old.fields.start !== fields.start || old.fields.end !== fields.end) await tellGoing(orgId, eventId, ctx, `${d.title} moved to ${new Date(fields.start).toUTCString().replace(" GMT", " UTC")}`, "moved");
  return { success: true, id: eventId };
}

async function tellGoing(orgId: string, eventId: string, ctx: { userId: string | null; slug: string }, title: string, why: string) {
  const going = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM community_rsvps WHERE task_id = ${eventId}::uuid AND state IN ('going', 'waitlisted')`));
  for (const g of going) {
    if (g.id === ctx.userId) continue;
    await createNotification({ recipientUserId: g.id, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "important", title,
      href: `/org/${encodeURIComponent(ctx.slug)}?tab=sprints&event=${eventId}`, entityRefs: { projectId: orgId, projectSlug: ctx.slug },
      dedupeKey: `community-event:${why}:${eventId}:${g.id}:${Date.now()}` }).catch(() => undefined);
  }
}

/** Call 3: while places are free, the longest-waiting people move to Going and are told (Important). */
async function promote(orgId: string, eventId: string, ctx: { userId: string | null; slug: string; title?: string }) {
  const moved = Array.from(await db.execute<{ id: string; title: string }>(sql`
    WITH ev AS (SELECT e.place_limit FROM community_events e WHERE e.task_id = ${eventId}::uuid FOR UPDATE),
    free AS (SELECT CASE WHEN (SELECT place_limit FROM ev) IS NULL THEN 100000
      ELSE greatest(0, (SELECT place_limit FROM ev) - (SELECT count(*) FROM community_rsvps WHERE task_id = ${eventId}::uuid AND state = 'going')) END AS n),
    next AS (SELECT user_id FROM community_rsvps WHERE task_id = ${eventId}::uuid AND state = 'waitlisted' ORDER BY responded_at LIMIT (SELECT n FROM free))
    UPDATE community_rsvps r SET state = 'going' FROM next WHERE r.task_id = ${eventId}::uuid AND r.user_id = next.user_id
    RETURNING r.user_id AS id, (SELECT title FROM tasks WHERE id = ${eventId}::uuid) AS title`));
  for (const m of moved) {
    await createNotification({ recipientUserId: m.id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `A place opened: you’re going to ${m.title}`, href: `/org/${encodeURIComponent(ctx.slug)}?tab=sprints&event=${eventId}`,
      entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `community-event:moved-up:${eventId}:${m.id}` }).catch(() => undefined);
  }
}

const rsvpSchema = z.object({ choice: z.enum(["going", "cant_go"]), private: z.boolean() }).strict();

/** Going or Can't go (calls 2–3): members only, not while paused, not after the event. A full event puts you on the waitlist. */
export async function rsvpCommunityEventAction(orgId: string, eventId: string, input: unknown): Promise<{ success: true; state: "going" | "waitlisted" | "cant_go" } | Failure> {
  const ctx = await community(orgId);
  const parsed = rsvpSchema.safeParse(input);
  if (!ctx || !isLooseUuid(eventId) || !parsed.success) return DENIED;
  if (!ctx.member || !ctx.userId) return { success: false, error: "Join the community to RSVP." };
  if (ctx.paused) return { success: false, error: "You can RSVP again when your pause ends." };
  const { choice } = parsed.data;
  const result = await db.transaction(async (tx) => {
    // One RSVP at a time per event, so two people can't take the last place together.
    const [ev] = Array.from(await tx.execute<{ fields: CommunityEventFields; stage: string; place_limit: number | null }>(sql`
      SELECT t.type_fields AS fields, t.stage, e.place_limit FROM tasks t JOIN community_events e ON e.task_id = t.id
      WHERE t.id = ${eventId}::uuid AND t.workspace_id = ${orgId}::uuid AND t.item_type = 'event' AND t.deleted_at IS NULL FOR UPDATE OF e`));
    if (!ev) return null;
    const [{ going } = { going: 0 }] = Array.from(await tx.execute<{ going: number }>(sql`SELECT count(*)::int AS going FROM community_rsvps WHERE task_id = ${eventId}::uuid AND state = 'going' AND user_id <> ${ctx.userId}::uuid`));
    if (!canRsvp(eventState(ev.fields, ev.stage === "cancelled", ev.place_limit, going, new Date()))) return "closed" as const;
    const [prev] = Array.from(await tx.execute<{ state: string }>(sql`SELECT state FROM community_rsvps WHERE task_id = ${eventId}::uuid AND user_id = ${ctx.userId}::uuid`));
    // Already Going keeps the place; otherwise Going is a place if one's free, else the end of the waitlist.
    const state: "going" | "waitlisted" | "cant_go" = choice === "cant_go" ? "cant_go" : prev?.state === "going" ? "going" : prev?.state === "waitlisted" ? "waitlisted" : placeFor(ev.place_limit, going);
    await tx.execute(sql`INSERT INTO community_rsvps (task_id, user_id, workspace_id, state, private) VALUES (${eventId}::uuid, ${ctx.userId}::uuid, ${orgId}::uuid, ${state}, ${parsed.data.private})
      ON CONFLICT (task_id, user_id) DO UPDATE SET state = excluded.state, private = excluded.private,
        responded_at = CASE WHEN community_rsvps.state = excluded.state THEN community_rsvps.responded_at ELSE now() END,
        checked_in_at = CASE WHEN excluded.state = 'going' THEN community_rsvps.checked_in_at ELSE NULL END`);
    return { state, freed: prev?.state === "going" && state === "cant_go" };
  });
  if (!result) return DENIED;
  if (result === "closed") return { success: false, error: "This event isn’t taking RSVPs." };
  // Can't go after Going frees the place: the waitlist moves up.
  if (result.freed) await promote(orgId, eventId, ctx);
  return { success: true, state: result.state };
}

/** Cancel (organisers and the event's hosts): everyone Going or waiting is told at once (Important). */
export async function cancelCommunityEventAction(orgId: string, eventId: string): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.member || !ctx.userId || !isLooseUuid(eventId)) return DENIED;
  const [ev] = Array.from(await db.execute<{ title: string; fields: CommunityEventFields }>(sql`
    UPDATE tasks SET stage = 'cancelled', status = 'done', updated_at = now()
    WHERE id = ${eventId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'event' AND type_fields->>'kind' = 'community' AND deleted_at IS NULL AND stage <> 'cancelled'
      AND (${ctx.organiser} OR type_fields->'hosts' ? ${ctx.userId}::text)
    RETURNING title, type_fields AS fields`));
  if (!ev) return DENIED;
  await tellGoing(orgId, eventId, ctx, `${ev.title} is cancelled`, "cancelled");
  return { success: true };
}
