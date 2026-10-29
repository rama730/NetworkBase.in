import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, projectMembers, projects, projectUpdates } from "@/lib/db/schema";
import { emailEnabled, type OrgEmailKind } from "@/lib/email/contracts";
import { queueEmail, queueEmails, wakeEmailWorker } from "@/lib/email/outbox";
import type { OrgEmailData, OrgEmailPerson } from "@/lib/email/org-templates";
import { logger } from "@/lib/logger";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";
import type { OrgNotificationEventKey } from "@/lib/notifications/workspace-policy";
import type { NotificationEntityRefs } from "@/lib/notifications/types";
import { audienceAllows, type UpdateAudience } from "@/lib/organizations/update-rules";
import { ACCESS_LEVEL_LABELS } from "@/lib/copy/terms";
import { orgRoleNames, orgTypeLabel } from "@/lib/organizations/config";

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
  const [org] = await db.select({ id: projects.id, title: projects.title, slug: projects.slug, type: projects.orgType, settings: projects.orgSettings, logoUrl: projects.coverImage, tagline: projects.shortDescription, timeZone: projects.timeZone })
    .from(projects).where(eq(projects.id, orgId)).limit(1);
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

/** Display names for tray titles ("Ravi asked to join CSE-3A"). */
export async function namesOf(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();
  const rows = await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username }).from(profiles).where(inArray(profiles.id, userIds));
  return new Map(rows.map((r) => [r.id, r.name || r.username || "Someone"]));
}

export const orgHref = (org: { slug: string | null; id: string }, query = "") => `/org/${encodeURIComponent(org.slug ?? org.id)}${query}`;

/** Title, handle and welcome note for tray titles and links. */
export async function orgLabel(orgId: string) {
  const [org] = await db.select({ id: projects.id, title: projects.title, slug: projects.slug, welcomeNote: projects.welcomeNote, orgType: projects.orgType, orgSettings: projects.orgSettings })
    .from(projects).where(eq(projects.id, orgId)).limit(1);
  return org ? { id: org.id, title: org.title || "Organization", slug: org.slug, welcomeNote: org.welcomeNote, roleNames: orgRoleNames(org.orgType, org.orgSettings) } : null;
}

export const ROLE_LABEL: Record<string, string> = ACCESS_LEVEL_LABELS;

/** Someone joined (code, invite, approval elsewhere): a combined "N people joined" for admins, E4 to them (report §26.3 A). */
export async function notifyJoined(orgId: string, userId: string, eventId: string) {
  const org = await orgLabel(orgId);
  if (!org) return;
  const name = (await namesOf([userId])).get(userId) ?? "Someone";
  await notifyOrg({ orgId, eventKey: "org.member_joined", actorId: userId, title: `${name} joined ${org.title}`, href: orgHref(org, "?tab=members"), sourceEventId: eventId });
  await queueOrgEmails(orgId, null, `${eventId}:welcome`, { kind: "org_welcome", data: { note: org.welcomeNote } }, [userId]);
}

/** At most 5 emailed announcements per org per day (report §26.5); more posts still reach the tray. */
export const ANNOUNCEMENT_EMAILS_PER_DAY = 5;

/** Announcements reach their audience only (report §26.10 #5); `again` is "Edited with Notify again" (in-app, §17.9). */
export async function notifyAnnouncement(input: { orgId: string; updateId: string; actorId: string; content: string; audience: UpdateAudience | null; email: boolean; again?: boolean }) {
  const org = await orgLabel(input.orgId);
  if (!org) return;
  const [owner] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, input.orgId)).limit(1);
  const members = await db.select({ userId: projectMembers.userId, role: projectMembers.role }).from(projectMembers).where(eq(projectMembers.projectId, input.orgId));
  const childIds = input.audience?.projectIds ?? [];
  const inChild = new Set(childIds.length ? (await db.select({ userId: projectMembers.userId }).from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(inArray(projectMembers.projectId, childIds), eq(projects.parentId, input.orgId)))).map((r) => r.userId) : []);
  const people = [{ userId: owner?.ownerId ?? "", role: "owner" }, ...members].filter((m) => m.userId && audienceAllows(input.audience, {
    isAdmin: m.role === "owner" || m.role === "admin", isAuthor: m.userId === input.actorId,
    role: m.role as "owner" | "admin" | "member" | "viewer", childProjectIds: inChild.has(m.userId) ? childIds : [],
  })).map((m) => m.userId);
  let email = input.email && !input.again;
  if (email) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(projectUpdates)
      .where(and(eq(projectUpdates.projectId, input.orgId), eq(projectUpdates.notifyLevel, "email"), sql`${projectUpdates.createdAt} > now() - interval '1 day'`));
    // ponytail: a rolling 24 hours, not the org's calendar day. Upgrade: count from midnight in projects.time_zone.
    email = n <= ANNOUNCEMENT_EMAILS_PER_DAY;
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
