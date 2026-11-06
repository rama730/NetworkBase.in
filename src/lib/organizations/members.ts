import "server-only";
import type { MembershipEnding } from "@/lib/profile/collaboration";

import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orgEmailInvites, profiles, workspaceMembers, workspaces } from "@/lib/db/schema";
import { createCopiesForNewMember, releaseCopiesOnLeave } from "@/lib/organizations/assignments";
import { notifyNewCopies } from "@/lib/organizations/assignment-notify";
import { namesOf, notifyOrg, orgLabel, queueOrgInviteSignupEmails, ROLE_LABEL } from "@/lib/organizations/notify";
import { addWorkspaceMemberInternal, removeWorkspaceMemberInternal } from "@/lib/workspaces/collaborator-lifecycle";
import { orgMemberCap } from "@/lib/organizations/join-rules";
import { ORG_LIMITS, orgRoleNames } from "@/lib/organizations/config";
import { LAST_ACTIVE_HERE_MIGRATION, LAST_ACTIVE_HERE_SINCE } from "@/lib/organizations/member-rules";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const INVITE_DAYS = 14;

/**
 * Org invites by email (report §20.5, §34.4): one open invite per address, skipping people already in the org.
 * Shared by Members → Invite and by creation (co-admins and a pasted roster). The caller checks who may invite.
 */
export async function createOrgEmailInvites(orgId: string, actorId: string, input: {
  emails: string[]; role: "member" | "admin" | "viewer"; title: string | null; childProjectId: string | null; unitId: string | null; message?: string | null;
}) {
  const valid = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (valid.length === 0) return { invited: 0, existing: 0 };
  const already = new Set((await db.select({ email: profiles.email }).from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.projectId, orgId), inArray(profiles.email, valid)))).map((r) => r.email.toLowerCase()));
  const toInvite = valid.filter((e) => !already.has(e));
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const invites: Array<{ id: string; email: string }> = [];
  // ponytail: one upsert per address (500 at most per paste); batch it if pastes ever grow past that.
  for (const email of toInvite) {
    const [row] = await db.insert(orgEmailInvites).values({ orgId, email, role: input.role, title: input.title, childProjectId: input.childProjectId, unitId: input.unitId, invitedBy: actorId, expiresAt, message: input.message ?? null })
      .onConflictDoUpdate({ target: [orgEmailInvites.orgId, orgEmailInvites.email], targetWhere: sql`${orgEmailInvites.acceptedAt} IS NULL`, set: { role: input.role, title: input.title, childProjectId: input.childProjectId, unitId: input.unitId, invitedBy: actorId, expiresAt, message: input.message ?? null } })
      .returning({ id: orgEmailInvites.id });
    if (row) invites.push({ id: row.id, email });
  }
  const accounts = toInvite.length === 0 ? [] : await db.select({ id: profiles.id, email: profiles.email }).from(profiles).where(inArray(profiles.email, toInvite));
  await notifyInvites(orgId, actorId, invites, accounts, { role: input.role, title: input.title, expiresAt, message: input.message ?? null });
  return { invited: toInvite.length, existing: accounts.length };
}

/** E2 for people with an account (plus the tray), E3 for addresses without one (report §26.3 A). */
export async function notifyInvites(orgId: string, actorId: string, invites: Array<{ id: string; email: string }>, accounts: Array<{ id: string; email: string }>,
  details: { role: string; title: string | null; expiresAt: Date; message?: string | null }, eventSuffix = "") {
  const org = await orgLabel(orgId);
  if (!org || invites.length === 0) return;
  const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a.id]));
  const inviter = (await namesOf([actorId])).get(actorId) ?? "Someone";
  // The sender's message shows as the email's quote (report §7.11).
  const data = { role: org.roleNames[details.role as keyof typeof org.roleNames] ?? ROLE_LABEL[details.role] ?? details.role, memberTitle: details.title, expiresAt: details.expiresAt.toISOString(), note: details.message || null };
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
    const [target] = await tx.select({ orgId: orgEmailInvites.orgId, max: workspaces.maxCollaborators }).from(orgEmailInvites)
      .innerJoin(workspaces, eq(workspaces.id, orgEmailInvites.orgId)).where(eq(orgEmailInvites.id, inviteId)).for("update", { of: workspaces }).limit(1);
    if (!target) return null;
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(eq(workspaceMembers.projectId, target.orgId));
    if (n >= orgMemberCap(target.max)) return "full" as const;
    const [invite] = await tx.update(orgEmailInvites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(orgEmailInvites.id, inviteId), isNull(orgEmailInvites.acceptedAt), gt(orgEmailInvites.expiresAt, sql`now()`)))
      .returning();
    if (!invite) return null;
    const limit = await accountOrgLimit(tx, userId, "join");
    if (limit) throw new AccountOrgLimitError(limit);
    await addWorkspaceMemberInternal(tx, { projectId: invite.orgId, userId, role: invite.role, actorId: userId, source: "email_invite" });
    if (invite.role === "member") await createCopiesForNewMember(tx, invite.orgId, userId);
    if (invite.title) {
      await tx.update(workspaceMembers).set({ title: invite.title })
        .where(and(eq(workspaceMembers.projectId, invite.orgId), eq(workspaceMembers.userId, userId)));
    }
    if (invite.childProjectId) {
      const [child] = await tx.select({ id: workspaces.id }).from(workspaces)
        .where(and(eq(workspaces.id, invite.childProjectId), eq(workspaces.parentId, invite.orgId), isNull(workspaces.deletedAt))).limit(1);
      if (child) await addWorkspaceMemberInternal(tx, { projectId: child.id, userId, role: "member", actorId: invite.invitedBy ?? userId, source: "email_invite", roleId: invite.unitId });
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
  const rows = await db.select({ id: orgEmailInvites.id, orgId: orgEmailInvites.orgId, role: orgEmailInvites.role, title: orgEmailInvites.title, orgTitle: workspaces.title, orgSlug: workspaces.slug, orgType: workspaces.orgType, orgSettings: workspaces.orgSettings })
    .from(orgEmailInvites).innerJoin(workspaces, eq(workspaces.id, orgEmailInvites.orgId))
    .where(and(
      eq(orgEmailInvites.email, profile.email.trim().toLowerCase()),
      isNull(orgEmailInvites.acceptedAt),
      gt(orgEmailInvites.expiresAt, sql`now()`),
      isNull(workspaces.deletedAt),
      orgId ? eq(orgEmailInvites.orgId, orgId) : undefined,
    ));
  // The organization's own word for the role (org spec §2 rule 5): "Student", not "member".
  return rows.map(({ orgType, orgSettings, ...invite }) => ({ ...invite, roleLabel: orgRoleNames(orgType, orgSettings)[invite.role as "admin" | "member" | "viewer"] ?? "Member" }));
}

/** Child projects of the org this person leads; they transfer or detach those before leaving (report §20.7). */
export async function ledChildWorkspaces(executor: Executor, orgId: string, userId: string) {
  return executor.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces)
    .where(and(eq(workspaces.parentId, orgId), eq(workspaces.ownerId, userId), isNull(workspaces.deletedAt)));
}

/**
 * Leaving or being removed (report §20.7): out of every child project (seats reopen), unfinished copies go,
 * handed-in work stays for the admins, then out of the org.
 */
export type ReopenedSeat = { projectId: string; slug: string | null; leadId: string; unit: string };

/** Returns the unit seats it opened, for the leads' "1 seat open in Frontend developers" after the commit. */
export async function removeFromOrg(executor: Executor, orgId: string, userId: string, actorId: string, removal?: { by: string; note?: string | null }): Promise<ReopenedSeat[]> {
  const childMemberships = await executor.select({ projectId: workspaceMembers.projectId, leadId: workspaces.ownerId, slug: workspaces.slug, unit: sql<string | null>`(SELECT coalesce(r.title, r.role) FROM workspace_open_roles r WHERE r.id = ${workspaceMembers.unitId})` }).from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
    .where(and(eq(workspaces.parentId, orgId), eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));
  const self = actorId === userId;
  // Report §10.1: leaving or removal, who did it and the reason written, on every entry it ends (nested ones too).
  const [org] = await executor.select({ title: workspaces.title }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  const ending: MembershipEnding = self ? { reason: "left", by: userId } : { reason: "removed", by: removal?.by ?? actorId, note: removal?.note ?? null, orgTitle: org?.title ?? null };
  await releaseCopiesOnLeave(executor, orgId, userId);
  for (const { projectId, leadId } of childMemberships) {
    // Org admins act with the lead's powers in child projects (report §29.4), so the lead is the actor there.
    await removeWorkspaceMemberInternal(executor, { projectId, actorId: self ? userId : leadId, realActorId: removal?.by ?? actorId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self, ending });
  }
  await removeWorkspaceMemberInternal(executor, { projectId: orgId, actorId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self, ending });
  return childMemberships.flatMap((m) => (m.unit ? [{ projectId: m.projectId, slug: m.slug, leadId: m.leadId, unit: m.unit }] : []));
}

/** Seat reopened (report §26 B): the child project's lead hears it. */
export async function notifySeatsReopened(orgId: string, seats: ReopenedSeat[]) {
  const stamp = Date.now();
  for (const seat of seats) {
    await notifyOrg({ orgId, eventKey: "org.child_notice", to: [seat.leadId], title: `1 seat open in ${seat.unit}`,
      href: `/workspaces/${encodeURIComponent(seat.slug ?? seat.projectId)}?tab=settings`, sourceEventId: `seat:${seat.projectId}:${seat.unit}:${stamp}`, refs: { projectId: seat.projectId } });
  }
}

/**
 * Last active here (report §29.4, decision 62): opening an organization or one of its workspaces stamps that
 * person's organization membership, at most hourly. A workspace outside any organization changes nothing.
 */
export async function stampLastActiveHere(workspaceId: string, userId: string) {
  await db.execute(sql`
    UPDATE workspace_members m SET last_active_here_at = now()
    FROM workspaces w
    WHERE w.id = ${workspaceId}::uuid AND w.deleted_at IS NULL
      AND m.workspace_id = CASE WHEN w.kind = 'organization' THEN w.id ELSE w.parent_id END
      AND m.user_id = ${userId}::uuid
      AND (m.last_active_here_at IS NULL OR m.last_active_here_at < now() - interval '1 hour')`);
}

/**
 * Sidebar report G4 and the new-updates dot: when you last opened this workspace. Every open counts (opening it is
 * seeing it, so the dot goes); nothing for people who aren't members.
 */
export async function stampOpened(workspaceId: string, userId: string) {
  await db.execute(sql`
    UPDATE workspace_members SET last_opened_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid`);
}

/** A per-account limit refused the join: its message is safe to show; any other error stays redacted. */
export class AccountOrgLimitError extends Error {}

/**
 * Per-account limits (report §21.4, §26.11, §27.1 #3–4): own up to 5 organizations, belong to up to 50. Null when
 * there's room; otherwise the sentence to show. Checked when creating (from the wizard's first step), duplicating,
 * transferring, joining, accepting an invite and approving a request.
 */
export async function accountOrgLimit(executor: Pick<typeof db, "execute">, userId: string, kind: "own" | "join"): Promise<string | null> {
  const [row] = Array.from(await executor.execute<{ n: number }>(kind === "own"
    ? sql`SELECT count(*)::int AS n FROM workspaces WHERE owner_id = ${userId}::uuid AND kind = 'organization' AND deleted_at IS NULL`
    : sql`SELECT count(*)::int AS n FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.user_id = ${userId}::uuid AND w.kind = 'organization' AND w.deleted_at IS NULL`));
  const n = row?.n ?? 0;
  if (kind === "own" && n >= ORG_LIMITS.orgsOwnedPerUser) return `You can own up to ${ORG_LIMITS.orgsOwnedPerUser} organizations. Contact support to raise this.`;
  if (kind === "join" && n >= ORG_LIMITS.orgsJoinedPerUser) return `You can be in up to ${ORG_LIMITS.orgsJoinedPerUser} organizations. Leave one to join another.`;
  return null;
}

let activeHereSince: Promise<Date> | null = null;
/**
 * When Last active here started counting (report §41.4): the moment migration 0043 ran in this database, read once
 * per process. Until then (or if the journal can't be read) the constant in member-rules stands in.
 */
export function lastActiveHereSince(): Promise<Date> {
  activeHereSince ??= db.execute<{ at: string | null }>(sql`SELECT min(applied_at)::text AS at FROM app_migration_journal WHERE tag = ${LAST_ACTIVE_HERE_MIGRATION}`)
    // Not applied yet: use the fallback now and look again next time, so a later migration is picked up.
    .then(([row]) => { if (row?.at) return new Date(row.at); activeHereSince = null; return LAST_ACTIVE_HERE_SINCE; })
    .catch(() => { activeHereSince = null; return LAST_ACTIVE_HERE_SINCE; });
  return activeHereSince;
}
