import "server-only";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orgEmailInvites, profiles, projectMembers, projects } from "@/lib/db/schema";
import { createCopiesForNewMember, releaseCopiesOnLeave } from "@/lib/organizations/assignments";
import { notifyNewCopies } from "@/lib/organizations/assignment-notify";
import { namesOf, notifyOrg, orgLabel, queueOrgInviteSignupEmails, ROLE_LABEL } from "@/lib/organizations/notify";
import { addProjectMemberInternal, removeProjectMemberInternal } from "@/lib/projects/collaborator-lifecycle";
import { orgMemberCap } from "@/lib/organizations/join-rules";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const INVITE_DAYS = 14;

/**
 * Org invites by email (report §20.5, §34.4): one open invite per address, skipping people already in the org.
 * Shared by Members → Invite and by creation (co-admins and a pasted roster). The caller checks who may invite.
 */
export async function createOrgEmailInvites(orgId: string, actorId: string, input: {
  emails: string[]; role: "member" | "admin" | "viewer"; title: string | null; childProjectId: string | null; unitId: string | null;
}) {
  const valid = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (valid.length === 0) return { invited: 0, existing: 0 };
  const already = new Set((await db.select({ email: profiles.email }).from(projectMembers).innerJoin(profiles, eq(profiles.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, orgId), inArray(profiles.email, valid)))).map((r) => r.email.toLowerCase()));
  const toInvite = valid.filter((e) => !already.has(e));
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const invites: Array<{ id: string; email: string }> = [];
  // ponytail: one upsert per address (500 at most per paste); batch it if pastes ever grow past that.
  for (const email of toInvite) {
    const [row] = await db.insert(orgEmailInvites).values({ orgId, email, role: input.role, title: input.title, childProjectId: input.childProjectId, unitId: input.unitId, invitedBy: actorId, expiresAt })
      .onConflictDoUpdate({ target: [orgEmailInvites.orgId, orgEmailInvites.email], targetWhere: sql`${orgEmailInvites.acceptedAt} IS NULL`, set: { role: input.role, title: input.title, childProjectId: input.childProjectId, unitId: input.unitId, invitedBy: actorId, expiresAt } })
      .returning({ id: orgEmailInvites.id });
    if (row) invites.push({ id: row.id, email });
  }
  const accounts = toInvite.length === 0 ? [] : await db.select({ id: profiles.id, email: profiles.email }).from(profiles).where(inArray(profiles.email, toInvite));
  await notifyInvites(orgId, actorId, invites, accounts, { role: input.role, title: input.title, expiresAt });
  return { invited: toInvite.length, existing: accounts.length };
}

/** E2 for people with an account (plus the tray), E3 for addresses without one (report §26.3 A). */
export async function notifyInvites(orgId: string, actorId: string, invites: Array<{ id: string; email: string }>, accounts: Array<{ id: string; email: string }>,
  details: { role: string; title: string | null; expiresAt: Date }, eventSuffix = "") {
  const org = await orgLabel(orgId);
  if (!org || invites.length === 0) return;
  const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a.id]));
  const inviter = (await namesOf([actorId])).get(actorId) ?? "Someone";
  const data = { role: org.roleNames[details.role as keyof typeof org.roleNames] ?? ROLE_LABEL[details.role] ?? details.role, memberTitle: details.title, expiresAt: details.expiresAt.toISOString() };
  for (const invite of invites) {
    const userId = byEmail.get(invite.email.toLowerCase());
    if (!userId) continue;
    await notifyOrg({
      orgId, eventKey: "org.invited", actorId, to: [userId], title: `${inviter} invited you to ${org.title} as ${data.role}`,
      href: "/network?tab=invitations", sourceEventId: `${invite.id}${eventSuffix}`, refs: { invitationId: invite.id }, email: { kind: "org_invite", data },
    });
  }
  await queueOrgInviteSignupEmails(orgId, actorId, invites.filter((i) => !byEmail.has(i.email.toLowerCase())).map((i) => ({ id: `${i.id}${eventSuffix}`, email: i.email, data })));
}

/**
 * Accepts one open org invite for this person (report §20.5): the invited role and title apply, and the
 * invite's child project and unit place them there too. Returns the org id, or null when the invite is gone.
 */
export async function acceptOrgInvite(userId: string, inviteId: string): Promise<{ orgId: string } | { full: true } | null> {
  const orgId = await db.transaction(async (tx) => {
    // Max members holds for invites too (report §20.5): a full org keeps the invite open until there's room.
    const [target] = await tx.select({ orgId: orgEmailInvites.orgId, max: projects.maxCollaborators }).from(orgEmailInvites)
      .innerJoin(projects, eq(projects.id, orgEmailInvites.orgId)).where(eq(orgEmailInvites.id, inviteId)).for("update", { of: projects }).limit(1);
    if (!target) return null;
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(projectMembers).where(eq(projectMembers.projectId, target.orgId));
    if (n >= orgMemberCap(target.max)) return "full" as const;
    const [invite] = await tx.update(orgEmailInvites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(orgEmailInvites.id, inviteId), isNull(orgEmailInvites.acceptedAt), gt(orgEmailInvites.expiresAt, sql`now()`)))
      .returning();
    if (!invite) return null;
    await addProjectMemberInternal(tx, { projectId: invite.orgId, userId, role: invite.role, actorId: userId, source: "email_invite" });
    if (invite.role === "member") await createCopiesForNewMember(tx, invite.orgId, userId);
    if (invite.title) {
      await tx.update(projectMembers).set({ title: invite.title })
        .where(and(eq(projectMembers.projectId, invite.orgId), eq(projectMembers.userId, userId)));
    }
    if (invite.childProjectId) {
      const [child] = await tx.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, invite.childProjectId), eq(projects.parentId, invite.orgId), isNull(projects.deletedAt))).limit(1);
      if (child) await addProjectMemberInternal(tx, { projectId: child.id, userId, role: "member", actorId: invite.invitedBy ?? userId, source: "email_invite", roleId: invite.unitId });
    }
    return invite.orgId;
  });
  if (orgId === "full") return { full: true };
  if (orgId) await notifyNewCopies(orgId, { userId });
  return orgId ? { orgId } : null;
}

/** Open invites sent to this person's address (exact match, report §20.11), optionally for one org. */
export async function openInvitesFor(userId: string, orgId?: string) {
  const [profile] = await db.select({ email: profiles.email }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!profile?.email) return [];
  return db.select({ id: orgEmailInvites.id, orgId: orgEmailInvites.orgId, role: orgEmailInvites.role, title: orgEmailInvites.title, orgTitle: projects.title, orgSlug: projects.slug })
    .from(orgEmailInvites).innerJoin(projects, eq(projects.id, orgEmailInvites.orgId))
    .where(and(
      eq(orgEmailInvites.email, profile.email.trim().toLowerCase()),
      isNull(orgEmailInvites.acceptedAt),
      gt(orgEmailInvites.expiresAt, sql`now()`),
      isNull(projects.deletedAt),
      orgId ? eq(orgEmailInvites.orgId, orgId) : undefined,
    ));
}

/** Child projects of the org this person leads; they transfer or detach those before leaving (report §20.7). */
export async function ledChildProjects(executor: Executor, orgId: string, userId: string) {
  return executor.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.parentId, orgId), eq(projects.ownerId, userId), isNull(projects.deletedAt)));
}

/**
 * Leaving or being removed (report §20.7): out of every child project (seats reopen), unfinished copies go,
 * handed-in work stays for the admins, then out of the org.
 */
export type ReopenedSeat = { projectId: string; slug: string | null; leadId: string; unit: string };

/** Returns the unit seats it opened, for the leads' "1 seat open in Frontend developers" after the commit. */
export async function removeFromOrg(executor: Executor, orgId: string, userId: string, actorId: string): Promise<ReopenedSeat[]> {
  const childMemberships = await executor.select({ projectId: projectMembers.projectId, leadId: projects.ownerId, slug: projects.slug, unit: sql<string | null>`(SELECT coalesce(r.title, r.role) FROM project_open_roles r WHERE r.id = ${projectMembers.unitId})` }).from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projects.parentId, orgId), eq(projectMembers.userId, userId), isNull(projects.deletedAt)));
  const self = actorId === userId;
  await releaseCopiesOnLeave(executor, orgId, userId);
  for (const { projectId, leadId } of childMemberships) {
    // Org admins act with the lead's powers in child projects (report §29.4), so the lead is the actor there.
    await removeProjectMemberInternal(executor, { projectId, actorId: self ? userId : leadId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self });
  }
  await removeProjectMemberInternal(executor, { projectId: orgId, actorId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self });
  return childMemberships.flatMap((m) => (m.unit ? [{ projectId: m.projectId, slug: m.slug, leadId: m.leadId, unit: m.unit }] : []));
}

/** Seat reopened (report §26 B): the child project's lead hears it. */
export async function notifySeatsReopened(orgId: string, seats: ReopenedSeat[]) {
  const stamp = Date.now();
  for (const seat of seats) {
    await notifyOrg({ orgId, eventKey: "org.child_notice", to: [seat.leadId], title: `1 seat open in ${seat.unit}`,
      href: `/projects/${encodeURIComponent(seat.slug ?? seat.projectId)}?tab=settings`, sourceEventId: `seat:${seat.projectId}:${seat.unit}:${stamp}`, refs: { projectId: seat.projectId } });
  }
}
