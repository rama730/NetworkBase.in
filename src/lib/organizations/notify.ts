import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, workspaceMembers, workspaces, workspaceUpdates } from "@/lib/db/schema";
import { emailEnabled, type OrgEmailKind } from "@/lib/email/contracts";
import { queueEmail, queueEmails, wakeEmailWorker } from "@/lib/email/outbox";
import type { OrgEmailData, OrgEmailPerson } from "@/lib/email/org-templates";
import { logger } from "@/lib/logger";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";
import type { OrgNotificationEventKey } from "@/lib/notifications/workspace-policy";
import type { NotificationEntityRefs } from "@/lib/notifications/types";
import { audienceAllows, type UpdateAudience } from "@/lib/organizations/update-rules";
import { ACCESS_LEVEL_LABELS } from "@/lib/copy/terms";
import { ORG_LIMITS, orgRoleNames, orgTypeLabel } from "@/lib/organizations/config";
import { normalizeNotificationPreferences } from "@/lib/notifications/preferences";

// One door for organization notifications (report §26): the tray goes through the project event pipeline
// (org rules, member overrides, bursts, push for Important), email through the outbox. Best effort: the
// action that triggered it has already committed and never fails because a notice couldn't go out.

export type OrgNotice = {
  orgId: string;
  eventKey: OrgNotificationEventKey;
  actorId?: string | null;
  /** The people it is about; admin events also reach the owner and admins through the rule's recipients. */
  to?: string[];
  title: string;
  body?: string | null;
  href: string;
  /** Stable per event: replays create nothing new (tray dedupe and the email event key). */
  sourceEventId: string;
  refs?: NotificationEntityRefs;
  email?: { kind: OrgEmailKind; data?: Partial<OrgEmailData> | ((userId: string) => Partial<OrgEmailData> | null); to?: string[] } | null;
};

export async function orgEmailBase(orgId: string, actorId?: string | null): Promise<Pick<OrgEmailData, "org" | "actor" | "orgTimeZone"> | null> {
  const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, type: workspaces.orgType, settings: workspaces.orgSettings, logoUrl: workspaces.coverImage, tagline: workspaces.shortDescription, timeZone: workspaces.timeZone })
    .from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  if (!org) return null;
  const [actor] = actorId ? await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl, headline: profiles.headline })
    .from(profiles).where(eq(profiles.id, actorId)).limit(1) : [];
  return {
    org: { id: org.id, title: org.title || "Organization", slug: org.slug, type: orgTypeLabel(org.type, org.settings), logoUrl: org.logoUrl, tagline: org.tagline },
    actor: actor ? { id: actor.id, name: actor.name || actor.username || "Someone", username: actor.username, avatarUrl: actor.avatarUrl, headline: actor.headline } satisfies OrgEmailPerson : null,
    orgTimeZone: org.timeZone,
  };
}

export async function notifyOrg(notice: OrgNotice) {
  try {
    await enqueueWorkspaceNotificationEvent({
      projectId: notice.orgId,
      eventKey: notice.eventKey,
      actorUserId: notice.actorId ?? null,
      directRecipientIds: notice.to ?? [],
      title: notice.title,
      body: notice.body ?? null,
      href: notice.href,
      entityRefs: { ...notice.refs, orgId: notice.orgId },
      sourceEventId: notice.sourceEventId,
    });
  } catch (error) {
    logger.warn("org_notifications.tray_failed", { module: "notifications", eventKey: notice.eventKey, error: error instanceof Error ? error.message : String(error) });
  }
  if (notice.email) await queueOrgEmails(notice.orgId, notice.actorId ?? null, notice.sourceEventId, notice.email, notice.email.to ?? notice.to ?? []);
}

/** Queue one org email per recipient (the actor never mails themselves). Preferences are read at send time. */
export async function queueOrgEmails(orgId: string, actorId: string | null, eventId: string, email: NonNullable<OrgNotice["email"]>, recipients: string[]) {
  if (!emailEnabled() || recipients.length === 0) return;
  try {
    const base = await orgEmailBase(orgId, actorId);
    if (!base) return;
    await queueEmails(db, [...new Set(recipients)].flatMap((userId) => {
      const extra = userId === actorId ? null : typeof email.data === "function" ? email.data(userId) : email.data ?? {};
      return extra === null ? [] : [{ kind: email.kind, eventId, userId, actorId: actorId ?? undefined, projectId: orgId, data: { ...base, ...extra } }];
    }));
    await wakeEmailWorker();
  } catch (error) {
    logger.warn("org_notifications.email_failed", { module: "email", kind: email.kind, error: error instanceof Error ? error.message : String(error) });
  }
}

/** E3: invitations to addresses without an account. */
export async function queueOrgInviteSignupEmails(orgId: string, actorId: string, invites: Array<{ id: string; email: string; data: Partial<OrgEmailData> }>) {
  if (!emailEnabled() || invites.length === 0) return;
  try {
    const base = await orgEmailBase(orgId, actorId);
    if (!base) return;
    for (const invite of invites) {
      await queueEmail(db, { kind: "org_invite_signup", eventId: invite.id, toEmail: invite.email, actorId, projectId: orgId, data: { ...base, ...invite.data } });
    }
    await wakeEmailWorker();
  } catch (error) {
    logger.warn("org_notifications.email_failed", { module: "email", kind: "org_invite_signup", error: error instanceof Error ? error.message : String(error) });
  }
}

/** People grouped by their own zone (their notification setting), else the organization's (report §32.5). */
export async function peopleByZone(userIds: string[], orgZone: string | null) {
  const rows = userIds.length ? await db.select({ id: profiles.id, preferences: profiles.notificationPreferences }).from(profiles).where(inArray(profiles.id, userIds)) : [];
  const own = new Map(rows.map((r) => [r.id, normalizeNotificationPreferences(r.preferences).quietHours.timeZone]));
  const byZone = new Map<string, string[]>();
  for (const id of new Set(userIds)) {
    const zone = own.get(id) ?? orgZone ?? "UTC";
    byZone.set(zone, [...(byZone.get(zone) ?? []), id]);
  }
  return byZone;
}

/**
 * Who already got this reminder in the last 12 hours, counted from their last one (report §28.8). `subject` is the
 * first part of the reminder's event id ("remind" for a copy); the result holds the second part (the copy id).
 */
export async function remindedRecently(orgId: string, subject: string, userIds: string[], eventKey: OrgNotificationEventKey = "assignments.reminded") {
  if (userIds.length === 0) return new Set<string>();
  const rows = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT split_part(dedupe_key, ':', 5) AS id FROM user_notifications
    WHERE user_id IN ${[...new Set(userIds)]} AND dedupe_key LIKE ${`project:${orgId}:${eventKey}:${subject}:%`}
      AND created_at > now() - make_interval(hours => ${ORG_LIMITS.remindSamePersonHours})`);
  return new Set(rows.map((r) => r.id));
}

/** Display names for tray titles ("Ravi asked to join CSE-3A"). */
export async function namesOf(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username }).from(profiles).where(inArray(profiles.id, userIds));
  return new Map(rows.map((r) => [r.id, r.name || r.username || "Someone"]));
}

export const orgHref = (org: { slug: string | null; id: string }, query = "") => `/org/${encodeURIComponent(org.slug ?? org.id)}${query}`;

/** Title, handle and welcome note for tray titles and links. */
export async function orgLabel(orgId: string) {
  const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, welcomeNote: workspaces.welcomeNote, orgType: workspaces.orgType, orgSettings: workspaces.orgSettings, timeZone: workspaces.timeZone })
    .from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  return org ? { id: org.id, title: org.title || "Organization", slug: org.slug, welcomeNote: org.welcomeNote, roleNames: orgRoleNames(org.orgType, org.orgSettings), timeZone: org.timeZone } : null;
}

export const ROLE_LABEL: Record<string, string> = ACCESS_LEVEL_LABELS;

/** Someone joined (code, invite, approval elsewhere): a combined "N people joined" for admins, E4 to them (report §26.3 A). */
/** Joined: admins see "N people joined" and the person gets E4. Requested: admins see "N people asked to join". */
export async function notifyJoinOutcome(orgId: string, outcome: string, userId: string) {
  const eventId = `join:${userId}:${Date.now()}`;
  if (outcome === "joined") return notifyJoined(orgId, userId, eventId);
  if (outcome !== "requested") return;
  const org = await orgLabel(orgId);
  const name = (await namesOf([userId])).get(userId) ?? "Someone";
  if (org) await notifyOrg({ orgId, eventKey: "org.join_requested", actorId: userId, title: `${name} asked to join ${org.title}`, href: orgHref(org, "?tab=members"), sourceEventId: eventId });
}

export async function notifyJoined(orgId: string, userId: string, eventId: string) {
  const org = await orgLabel(orgId);
  if (!org) return;
  const name = (await namesOf([userId])).get(userId) ?? "Someone";
  // Group assignments don't make copies for late joiners: admins hear where to place them (report §25.7, decision 47).
  const [group] = await db.execute<{ title: string; n: number }>(sql`
    SELECT min(m.title) AS title, count(*)::int AS n FROM tasks m
    WHERE m.workspace_id = ${orgId} AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL
      AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL AND m.assignment_settings->'target'->>'mode' = 'teams'
      AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND (c.assignee_id = ${userId}
        OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId})))
    HAVING count(*) > 0`);
  const title = group ? `${name} joined and isn’t in a group for ${group.n === 1 ? group.title : `${group.n} group assignments`}` : `${name} joined ${org.title}`;
  await notifyOrg({ orgId, eventKey: "org.member_joined", actorId: userId, title, href: orgHref(org, group ? "?tab=tasks" : "?tab=members"), sourceEventId: eventId });
  await queueOrgEmails(orgId, null, `${eventId}:welcome`, { kind: "org_welcome", data: { note: org.welcomeNote } }, [userId]);
}

/** At most 5 emailed announcements per org per day (report §26.5); more posts still reach the tray. */
export const ANNOUNCEMENT_EMAILS_PER_DAY = 5;

/** Emailed announcements since midnight in the organization's time zone, deleted posts left out (report §28.3, §30.5). */
export async function orgEmailsSentToday(orgId: string) {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM workspace_updates u JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.workspace_id = ${orgId} AND u.notify_level = 'email' AND u.deleted_at IS NULL
      AND u.created_at >= date_trunc('day', now() AT TIME ZONE coalesce(w.time_zone, 'UTC')) AT TIME ZONE coalesce(w.time_zone, 'UTC')`);
  return row?.n ?? 0;
}

/** Everyone an announcement's audience reaches in this organization (report §26.10 #5), author included. */
export async function announcementPeople(orgId: string, audience: UpdateAudience | null, actorId: string) {
  const [owner] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  const members = await db.select({ userId: workspaceMembers.userId, role: workspaceMembers.role }).from(workspaceMembers).where(eq(workspaceMembers.projectId, orgId));
  const childIds = audience?.projectIds ?? [];
  const inChild = new Set(childIds.length ? (await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
    .where(and(inArray(workspaceMembers.projectId, childIds), eq(workspaces.parentId, orgId)))).map((r) => r.userId) : []);
  return [{ userId: owner?.ownerId ?? "", role: "owner" }, ...members].filter((m) => m.userId && audienceAllows(audience, {
    isAdmin: m.role === "owner" || m.role === "admin", isAuthor: m.userId === actorId,
    role: m.role as "owner" | "admin" | "member" | "viewer", childProjectIds: inChild.has(m.userId) ? childIds : [],
  })).map((m) => m.userId);
}

/** A wider audience (report §37.3): the people it adds hear about the post once, in the tray; no email. */
export async function notifyAudienceWidened(input: { orgId: string; updateId: string; actorId: string; authorId: string | null; content: string; before: UpdateAudience | null; after: UpdateAudience | null }) {
  const org = await orgLabel(input.orgId);
  if (!org) return;
  const had = new Set(await announcementPeople(input.orgId, input.before, input.authorId ?? input.actorId));
  const added = (await announcementPeople(input.orgId, input.after, input.authorId ?? input.actorId)).filter((id) => !had.has(id) && id !== input.actorId);
  if (added.length === 0) return;
  const author = (await namesOf([input.authorId ?? input.actorId])).get(input.authorId ?? input.actorId) ?? "Someone";
  await notifyOrg({
    orgId: input.orgId, eventKey: "announcements.posted", actorId: input.actorId, to: added, title: `${author}: ${input.content.replace(/\s+/g, " ").slice(0, 120)}`,
    href: orgHref(org, `?tab=updates&updateId=${encodeURIComponent(input.updateId)}`), sourceEventId: `announcement:${input.updateId}:widened:${Date.now()}`, refs: { updateId: input.updateId },
  });
}

/** Announcements reach their audience only (report §26.10 #5); `again` is "Edited with Notify again" (in-app, §17.9). */
export async function notifyAnnouncement(input: { orgId: string; updateId: string; actorId: string; content: string; audience: UpdateAudience | null; email: boolean; again?: boolean }) {
  const org = await orgLabel(input.orgId);
  if (!org) return;
  const people = await announcementPeople(input.orgId, input.audience, input.actorId);
  let email = input.email && !input.again;
  // Smaller bug 21: counted by the organization's calendar day; this post is already in the count.
  if (email && await orgEmailsSentToday(input.orgId) > ANNOUNCEMENT_EMAILS_PER_DAY) {
    email = false;
    // Decision 67: a stopped email isn't counted as sent, and the author is told (createWorkspaceUpdateAction).
    await db.update(workspaceUpdates).set({ notifyLevel: "in_app" }).where(eq(workspaceUpdates.id, input.updateId));
  }
  const author = (await namesOf([input.actorId])).get(input.actorId) ?? "Someone";
  await notifyOrg({
    orgId: input.orgId, eventKey: "announcements.posted", actorId: input.actorId, to: people, title: `${input.again ? "Updated: " : `${author}: `}${input.content.replace(/\s+/g, " ").slice(0, 120)}`,
    href: orgHref(org, `?tab=updates&updateId=${encodeURIComponent(input.updateId)}`), sourceEventId: input.again ? `announcement:${input.updateId}:again:${Date.now()}` : `announcement:${input.updateId}`, refs: { updateId: input.updateId },
    email: email ? { kind: "org_announcement", data: { post: { id: input.updateId, content: input.content.slice(0, 5000) } } } : null,
  });
  return { emailed: email };
}

/** "Mute emails from <org>" (one-click link): email only, for that org; the tray and push keep their settings. */
export async function muteOrgEmails(userId: string, orgId: string) {
  const current = sql`coalesce(${profiles.notificationPreferences}, '{}'::jsonb)`;
  const rows = await db.update(profiles).set({
    notificationPreferences: sql`jsonb_set(${current}, '{organizations}', coalesce(${current}->'organizations', '{}'::jsonb) || jsonb_build_object(${orgId}::text,
      jsonb_build_object('level', 'all', 'includeChildren', true) || coalesce(${current}->'organizations'->${orgId}::text, '{}'::jsonb) || '{"email": false}'::jsonb))`,
  }).where(eq(profiles.id, userId)).returning({ id: profiles.id });
  return rows.length > 0;
}

/** "Frontend has no team lead" (report §30.4) to the workspace's lead, after a team's lead left it or moved team. */
export async function notifyTeamsWithoutLead(projectId: string, actorId: string, teams: string[]) {
  if (teams.length === 0) return;
  const [project] = await db.select({ ownerId: workspaces.ownerId, parentId: workspaces.parentId, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  if (!project?.parentId || project.ownerId === actorId) return;
  for (const team of teams) {
    await notifyOrg({ orgId: project.parentId, eventKey: "org.team_changed", actorId, to: [project.ownerId], title: `${team} has no team lead`,
      href: `/workspaces/${encodeURIComponent(project.slug ?? projectId)}?tab=settings`, sourceEventId: `no-lead:${projectId}:${team}:${Date.now()}`, refs: { projectId } });
  }
}

/**
 * A new report routed to an organization (report §30.4, §30.6): each admin hears how many reports wait for them, combined
 * in the tray, counted by their own Moderation list, so urgent cases and cases about them never count.
 */
export async function notifyOrgReport(caseNumber: number) {
  const [row] = await db.execute<{ org_id: string | null; routed_to: string | null; severity: string | null }>(sql`
    SELECT org_id, routed_to, severity FROM moderation_cases WHERE number = ${caseNumber}`);
  if (!row?.org_id || row.routed_to !== "org" || row.severity === "urgent") return;
  const org = await orgLabel(row.org_id);
  if (!org) return;
  const { readOrgCases } = await import("@/lib/trust/console");
  const [owner] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, row.org_id)).limit(1);
  const admins = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, row.org_id), eq(workspaceMembers.role, "admin")));
  for (const adminId of new Set([owner?.ownerId, ...admins.map((a) => a.userId)].filter((id): id is string => Boolean(id)))) {
    const waiting = (await readOrgCases(row.org_id, adminId)).length;
    if (waiting === 0) continue;
    await notifyOrg({ orgId: row.org_id, eventKey: "org.reports", to: [adminId], title: `${waiting} ${waiting === 1 ? "report" : "reports"} to review`,
      href: orgHref(org, "?tab=settings&section=org-moderation"), sourceEventId: `report:${caseNumber}:${adminId}` });
  }
}
