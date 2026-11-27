import "server-only";
import type { MembershipEnding } from "@/lib/profile/collaboration";

import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orgEmailInvites, orgJoinBlocks, profiles, workspaceMembers, workspaces } from "@/lib/db/schema";
import { createCopiesAfterJoin, releaseCopiesOnLeave } from "@/lib/organizations/assignments";
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
  // Audit 2.1: people blocked from this organization aren't invited (the join would be refused anyway).
  const blocked = new Set((await db.select({ email: profiles.email }).from(orgJoinBlocks).innerJoin(profiles, eq(profiles.id, orgJoinBlocks.userId))
    .where(and(eq(orgJoinBlocks.orgId, orgId), inArray(profiles.email, valid)))).map((r) => r.email.toLowerCase()));
  const toInvite = valid.filter((e) => !already.has(e) && !blocked.has(e));
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const invites: Array<{ id: string; email: string }> = [];
  // ponytail: one upsert per address (500 at most per paste); batch it if pastes ever grow past that.
  for (const email of toInvite) {
    const [row] = await db.insert(orgEmailInvites).values({ orgId, email, role: input.role, title: input.title, childProjectId: input.childProjectId, unitId: input.unitId, invitedBy: actorId, expiresAt, message: input.message ?? null })
      .onConflictDoUpdate({ target: [orgEmailInvites.orgId, orgEmailInvites.email], targetWhere: sql`${orgEmailInvites.acceptedAt} IS NULL`, set: { role: input.role, title: input.title, childProjectId: input.childProjectId, unitId: input.unitId, invitedBy: actorId, expiresAt, message: input.message ?? null, createdAt: new Date() } })
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
export async function acceptOrgInvite(userId: string, inviteId: string): Promise<{ orgId: string; teamFull?: TeamFull } | { full: true } | { adminsFull: true } | { blocked: true } | null> {
  let teamFull: TeamFull | undefined;
  const orgId = await db.transaction(async (tx) => {
    // Max members holds for invites too (report §20.5): a full org keeps the invite open until there's room.
    // Audit N6: an archived, suspended, restricted or closing organization takes nobody new, by invite either.
    const [target] = await tx.select({ orgId: orgEmailInvites.orgId, role: orgEmailInvites.role, max: workspaces.maxCollaborators }).from(orgEmailInvites)
      .innerJoin(workspaces, eq(workspaces.id, orgEmailInvites.orgId)).where(and(eq(orgEmailInvites.id, inviteId), orgTakesPeople())).for("update", { of: workspaces }).limit(1);
    if (!target) return null;
    // Audit 2.1: someone blocked from this organization can't come back through an old invite.
    const [blockedHere] = await tx.select({ userId: orgJoinBlocks.userId }).from(orgJoinBlocks).where(and(eq(orgJoinBlocks.orgId, target.orgId), eq(orgJoinBlocks.userId, userId))).limit(1);
    if (blockedHere) return "blocked" as const;
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(eq(workspaceMembers.projectId, target.orgId));
    if (n >= orgMemberCap(target.max)) return "full" as const;
    // The 20-admin cap holds when an admin invite is accepted too (audit 2.3); the invite stays open.
    if (target.role === "admin" && (await adminCount(tx, target.orgId)) >= ORG_LIMITS.adminsPerOrg) return "admins_full" as const;
    const [invite] = await tx.update(orgEmailInvites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(orgEmailInvites.id, inviteId), isNull(orgEmailInvites.acceptedAt), gt(orgEmailInvites.expiresAt, sql`now()`)))
      .returning();
    if (!invite) return null;
    const limit = await accountOrgLimit(tx, userId, "join");
    if (limit) throw new AccountOrgLimitError(limit);
    await addWorkspaceMemberInternal(tx, { projectId: invite.orgId, userId, role: invite.role, actorId: userId, source: "email_invite" });
    if (invite.title) {
      await tx.update(workspaceMembers).set({ title: invite.title })
        .where(and(eq(workspaceMembers.projectId, invite.orgId), eq(workspaceMembers.userId, userId)));
    }
    // Only members are placed in a workspace: viewers can't be on one (audit 3.5).
    if (invite.childProjectId && invite.role === "member") {
      const [child] = await tx.select({ id: workspaces.id }).from(workspaces)
        .where(and(eq(workspaces.id, invite.childProjectId), eq(workspaces.parentId, invite.orgId), isNull(workspaces.deletedAt))).limit(1);
      if (child) {
        // Audit 2.4: a full team never undoes the organization join; they join the workspace without the team and
        // its lead hears it (after the commit).
        const added = await tx.transaction((sp) => addWorkspaceMemberInternal(sp, { projectId: child.id, userId, role: "member", actorId: invite.invitedBy ?? userId, source: "email_invite", roleId: invite.unitId }))
          .then(() => true, () => false);
        if (!added && invite.unitId) {
          await addWorkspaceMemberInternal(tx, { projectId: child.id, userId, role: "member", actorId: invite.invitedBy ?? userId, source: "email_invite" });
          teamFull = { projectId: child.id, unitId: invite.unitId };
        }
      }
    }
    return invite.orgId;
  });
  if (orgId === "full") return { full: true };
  if (orgId === "admins_full") return { adminsFull: true };
  if (orgId === "blocked") return { blocked: true };
  // Copies after the commit (audit N67); only members hold copies.
  if (orgId && (await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, userId))).limit(1))[0]?.role === "member") {
    await createCopiesAfterJoin(orgId, [userId]);
  }
  if (orgId) await notifyNewCopies(orgId, { userId });
  if (orgId && teamFull) await notifyTeamFull(orgId, userId, teamFull);
  return orgId ? { orgId, ...(teamFull ? { teamFull } : {}) } : null;
}

/** An organization that takes new people: not deleted, archived, suspended, restricted or closing (audit N6). */
export function orgTakesPeople() {
  return and(isNull(workspaces.deletedAt), sql`${workspaces.status} <> 'archived'`, isNull(workspaces.suspendedAt), isNull(workspaces.restrictedAt), isNull(workspaces.deletionScheduledAt));
}

/** The address's open invite is used up when they join some other way (audit N13). */
export async function closeOpenInvite(executor: Executor, orgId: string, userId: string) {
  await executor.execute(sql`DELETE FROM org_email_invites WHERE org_id = ${orgId}::uuid AND accepted_at IS NULL
    AND email = (SELECT lower(email) FROM profiles WHERE id = ${userId}::uuid)`);
}

type TeamFull = { projectId: string; unitId: string };
/** "Priya joined without a team: Frontend is full" to the workspace's lead (audit 2.4). */
async function notifyTeamFull(orgId: string, userId: string, full: TeamFull) {
  const [row] = await db.select({ leadId: workspaces.ownerId, slug: workspaces.slug, team: sql<string | null>`(SELECT coalesce(r.title, r.role) FROM workspace_open_roles r WHERE r.id = ${full.unitId}::uuid)` })
    .from(workspaces).where(eq(workspaces.id, full.projectId)).limit(1);
  const name = (await namesOf([userId])).get(userId) ?? "Someone";
  if (row) await notifyOrg({ orgId, eventKey: "org.child_notice", to: [row.leadId], title: `${name} joined without a team: ${row.team ?? "the team"} is full`,
    href: `/workspaces/${encodeURIComponent(row.slug ?? full.projectId)}?tab=settings`, sourceEventId: `team-full:${full.projectId}:${userId}`, refs: { projectId: full.projectId } }).catch(() => undefined);
}

/** Admins in the org, plus open admin invites when asked (an invite holds a seat until it's accepted or expires). */
export async function adminCount(executor: Executor, orgId: string, opts: { openInvitesExcept?: string[] } = {}) {
  const [{ n } = { n: 0 }] = await executor.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "admin")));
  if (!opts.openInvitesExcept) return n;
  const except = opts.openInvitesExcept;
  const [{ open } = { open: 0 }] = await executor.select({ open: sql<number>`count(*)::int` }).from(orgEmailInvites)
    .where(and(eq(orgEmailInvites.orgId, orgId), eq(orgEmailInvites.role, "admin"), isNull(orgEmailInvites.acceptedAt), gt(orgEmailInvites.expiresAt, sql`now()`),
      except.length ? notInArray(orgEmailInvites.email, except) : undefined));
  return n + open;
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
      orgTakesPeople(),
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
export async function removeFromOrg(executor: Executor, orgId: string, userId: string, actorId: string, removal?: { by: string; note?: string | null; reason?: "finished" | "term_ended" }): Promise<ReopenedSeat[]> {
  const childMemberships = await executor.select({ projectId: workspaceMembers.projectId, leadId: workspaces.ownerId, slug: workspaces.slug, unit: sql<string | null>`(SELECT coalesce(r.title, r.role) FROM workspace_open_roles r WHERE r.id = ${workspaceMembers.unitId})` }).from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
    .where(and(eq(workspaces.parentId, orgId), eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));
  const self = actorId === userId;
  // Report §10.1: leaving or removal, who did it and the reason written, on every entry it ends (nested ones too).
  const [org] = await executor.select({ title: workspaces.title }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  // B6.1c: a lab membership can end as Finished (keeps verification, like leaving).
  // B7.1b: a club's End memberships not renewed records Season ended (term_ended), keeping verification like leaving.
  const ending: MembershipEnding = removal?.reason === "finished" || removal?.reason === "term_ended" ? { reason: removal.reason, by: removal.by } : self ? { reason: "left", by: userId } : { reason: "removed", by: removal?.by ?? actorId, note: removal?.note ?? null, orgTitle: org?.title ?? null };
  await releaseCopiesOnLeave(executor, orgId, userId);
  for (const { projectId, leadId } of childMemberships) {
    // Org admins act with the lead's powers in child projects (report §29.4), so the lead is the actor there.
    await removeWorkspaceMemberInternal(executor, { projectId, actorId: self ? userId : leadId, realActorId: removal?.by ?? actorId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self, ending });
  }
  await removeWorkspaceMemberInternal(executor, { projectId: orgId, actorId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self, ending });
  await clearTakeoverRequestBy(executor, orgId, userId);
  // B6.1c review: someone Removed is never offered the alumni list.
  if (ending.reason === "removed") await executor.execute(sql`DELETE FROM lab_alumni WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
  return childMemberships.flatMap((m) => (m.unit ? [{ projectId: m.projectId, slug: m.slug, leadId: m.leadId, unit: m.unit }] : []));
}

/** A takeover request ends when its asker leaves, is removed or stops being an admin (audit 3.7, N38). */
export async function clearTakeoverRequestBy(executor: Executor, orgId: string, userId: string) {
  await executor.update(workspaces).set({ takeoverRequestedBy: null, takeoverRequestedAt: null })
    .where(and(eq(workspaces.id, orgId), eq(workspaces.takeoverRequestedBy, userId)));
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
    WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid
      -- Audit 10.5: at most once a minute, not on every page render.
      AND (last_opened_at IS NULL OR last_opened_at < now() - interval '1 minute')`);
}

/** A per-account limit refused the join: its message is safe to show; any other error stays redacted. */
export class AccountOrgLimitError extends Error {}

/**
 * Per-account limits (report §21.4, §26.11, §27.1 #3–4): own up to 5 organizations, belong to up to 50. Null when
 * there's room; otherwise the sentence to show. Checked when creating (from the wizard's first step), duplicating,
 * transferring, joining, accepting an invite and approving a request.
 */
export async function accountOrgLimit(executor: Pick<typeof db, "execute">, userId: string, kind: "own" | "join"): Promise<string | null> {
  // Audit 2.10: one person's joins (and creations) count one at a time, so two at once can't both pass at 49.
  // Inside a transaction the lock holds until commit; outside one it's taken and let go at once.
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`org-limit:${userId}`}))`);
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
