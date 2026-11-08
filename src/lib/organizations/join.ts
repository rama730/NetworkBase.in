import "server-only";

import { and, count, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  applicationEvents,
  orgEmailInvites,
  orgHandleHolds,
  orgJoinBlocks,
  workspaceMembers,
  workspaces,
  reservedUsernames,
  roleApplications,
} from "@/lib/db/schema";
import { decideOrgJoin, orgMemberCap, type OrgJoinMode, type OrgJoinOutcome, type PrivateOrgState } from "@/lib/organizations/join-rules";
import { orgRoleNames } from "@/lib/organizations/config";
import { addWorkspaceMemberInternal } from "@/lib/workspaces/collaborator-lifecycle";
import { createCopiesAfterJoin } from "@/lib/organizations/assignments";
import { notifyNewCopies } from "@/lib/organizations/assignment-notify";
import { acceptOrgInvite, AccountOrgLimitError, accountOrgLimit, openInvitesFor } from "@/lib/organizations/members";

export type OrgSummary = { id: string; title: string; slug: string | null };

function readJoinMode(settings: unknown): OrgJoinMode {
  return (settings as { joinMode?: unknown } | null)?.joinMode === "approval" ? "approval" : "instant";
}

/** The org behind an enabled join code, or null. Never says why a code doesn't match. */
export async function findOrgByJoinCode(code: string) {
  const [org] = await db
    .select({
      id: workspaces.id,
      title: workspaces.title,
      slug: workspaces.slug,
      ownerId: workspaces.ownerId,
      orgType: workspaces.orgType,
      coverImage: workspaces.coverImage,
      visibility: workspaces.visibility,
      orgSettings: workspaces.orgSettings,
      status: workspaces.status,
      suspendedAt: workspaces.suspendedAt,
      deletionScheduledAt: workspaces.deletionScheduledAt,
      maxCollaborators: workspaces.maxCollaborators,
    })
    .from(workspaces)
    .where(and(
      eq(workspaces.joinCode, code),
      eq(workspaces.joinCodeEnabled, true),
      eq(workspaces.kind, "organization"),
      isNull(workspaces.deletedAt),
      isNull(workspaces.restrictedAt),
    ))
    .limit(1);
  return org ?? null;
}

export async function countOrgMembers(orgId: string) {
  const [row] = await db.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.projectId, orgId));
  return row?.n ?? 0;
}

/** Where the viewer already stands with an org, for the join page. */
export async function viewerOrgStatus(orgId: string, ownerId: string, userId: string): Promise<"member" | "pending" | null> {
  if (ownerId === userId) return "member";
  const [[member], [pending]] = await Promise.all([
    db.select({ id: workspaceMembers.id }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, userId))).limit(1),
    db.select({ id: roleApplications.id }).from(roleApplications)
      .where(and(eq(roleApplications.projectId, orgId), eq(roleApplications.applicantId, userId), eq(roleApplications.status, "pending"))).limit(1),
  ]);
  return member ? "member" : pending ? "pending" : null;
}

/**
 * What a private organization's page says to this person (report §26.9, decision 48). Ended first, then a block,
 * an open invite, a pending or declined request, and finally how their last membership ended.
 */
export async function readPrivateOrgState(orgId: string, userId: string | null): Promise<PrivateOrgState> {
  if (!userId) return { kind: "none" };
  const [row] = await db.execute<{ ended: boolean; blocked: boolean; request: string | null; end_reason: string | null; ended_at: string | null; org_type: string | null; org_settings: unknown }>(sql`
    SELECT (w.status = 'archived' OR w.deletion_scheduled_at IS NOT NULL) AS ended, w.org_type, w.org_settings,
      EXISTS (SELECT 1 FROM org_join_blocks b WHERE b.org_id = w.id AND b.user_id = ${userId}) AS blocked,
      (SELECT a.status FROM role_applications a WHERE a.workspace_id = w.id AND a.applicant_id = ${userId} AND a.role_id IS NULL
         AND (a.status = 'pending' OR a.updated_at > now() - interval '1 day') ORDER BY a.updated_at DESC LIMIT 1) AS request,
      c.end_reason, c.ended_at::text
    FROM workspaces w
    LEFT JOIN profile_contributions c ON c.workspace_id = w.id AND c.profile_id = ${userId} AND c.deleted_at IS NULL AND c.ended_at IS NOT NULL
    WHERE w.id = ${orgId}`);
  if (!row) return { kind: "none" };
  if (row.ended) return { kind: "ended" };
  if (row.blocked) return { kind: "blocked" };
  const [invite] = await openInvitesFor(userId, orgId);
  if (invite) return { kind: "invited", inviteId: invite.id, role: orgRoleNames(row.org_type, row.org_settings)[invite.role as "admin" | "member" | "viewer"] ?? "Member" };
  if (row.request === "pending") return { kind: "waiting" };
  if (row.request === "rejected") return { kind: "declined" };
  if (row.end_reason === "removed") return { kind: "removed" };
  if (row.ended_at) return { kind: "left", date: new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(row.ended_at)) };
  return { kind: "none" };
}

/**
 * Joins or asks to join an org (report §6.1, §29.1). The org row is locked first, so the
 * member count, Max members and block list are read and acted on together. Requests reuse role_applications
 * with no role. Callers check the code exists and rate-limit; this is shared with onboarding completion.
 */
export function joinOrgByCode(userId: string, code: string, note?: string | null) {
  return joinOrg(userId, and(eq(workspaces.joinCode, code), eq(workspaces.joinCodeEnabled, true))!, note);
}

/** Public orgs can also be joined from their page without the code (report §6.1). */
export function joinPublicOrg(userId: string, orgId: string, note?: string | null) {
  return joinOrg(userId, and(eq(workspaces.id, orgId), inArray(workspaces.visibility, ["public", "unlisted"]))!, note);
}

async function joinOrg(
  userId: string,
  where: SQL,
  note?: string | null,
): Promise<{ outcome: OrgJoinOutcome; org: OrgSummary } | null> {
  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .select({
        id: workspaces.id,
        title: workspaces.title,
        slug: workspaces.slug,
        ownerId: workspaces.ownerId,
        status: workspaces.status,
        suspendedAt: workspaces.suspendedAt,
        deletionScheduledAt: workspaces.deletionScheduledAt,
        orgSettings: workspaces.orgSettings,
        maxCollaborators: workspaces.maxCollaborators,
      })
      .from(workspaces)
      // A restricted org (trust and safety §7.2) takes no one new, by code, link or page.
      .where(and(where, eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt), isNull(workspaces.restrictedAt)))
      .for("update")
      .limit(1);
    if (!org) return null;

    const [[membership], [block], [request], [members]] = await Promise.all([
      tx.select({ id: workspaceMembers.id }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, org.id), eq(workspaceMembers.userId, userId))).limit(1),
      tx.select({ userId: orgJoinBlocks.userId }).from(orgJoinBlocks)
        .where(and(eq(orgJoinBlocks.orgId, org.id), eq(orgJoinBlocks.userId, userId))).limit(1),
      tx.select({ id: roleApplications.id, status: roleApplications.status, updatedAt: roleApplications.updatedAt, decisionBy: roleApplications.decisionBy })
        .from(roleApplications)
        .where(and(eq(roleApplications.projectId, org.id), eq(roleApplications.applicantId, userId))).limit(1),
      tx.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.projectId, org.id)),
    ]);

    const outcome = decideOrgJoin({
      available: org.status !== "archived" && !org.suspendedAt && !org.deletionScheduledAt,
      isMember: Boolean(membership) || org.ownerId === userId,
      isBlocked: Boolean(block),
      joinMode: readJoinMode(org.orgSettings),
      memberCount: members?.n ?? 0,
      maxMembers: orgMemberCap(org.maxCollaborators),
      request: request ? { status: request.status, updatedAt: request.updatedAt, decidedBySelf: request.decisionBy === userId } : null,
    });
    const summary = { id: org.id, title: org.title, slug: org.slug };
    // Belong to up to 50 organizations (report §26.11): checked before joining or asking to.
    if (outcome === "joined" || outcome === "requested") {
      const limit = await accountOrgLimit(tx, userId, "join");
      if (limit) throw new AccountOrgLimitError(limit);
    }

    if (outcome === "joined") {
      // Joining by code is always Member (decision 58); a pending request is closed by the join.
      await addWorkspaceMemberInternal(tx, { projectId: org.id, userId, role: "member", actorId: userId, source: "join_code" });
      // Late joiners get copies of open assignments (report §16.9), after the commit (audit N67).
    } else if (outcome === "requested") {
      const message = note?.trim().slice(0, 500) || null;
      const now = new Date();
      if (request) {
        await tx.update(roleApplications)
          .set({ status: "pending", roleId: null, message, creatorId: org.ownerId, decisionAt: null, decisionBy: null, decisionReasonCode: null, decisionReasonText: null, updatedAt: now })
          .where(eq(roleApplications.id, request.id));
        await tx.insert(applicationEvents).values({ applicationId: request.id, actorId: userId, kind: "reopened", fromStatus: request.status, toStatus: "pending", metadata: { source: "org_join_code" } });
      } else {
        const [created] = await tx.insert(roleApplications)
          .values({ projectId: org.id, roleId: null, applicantId: userId, creatorId: org.ownerId, message, status: "pending" })
          .returning({ id: roleApplications.id });
        await tx.insert(applicationEvents).values({ applicationId: created!.id, actorId: userId, kind: "created", fromStatus: null, toStatus: "pending", metadata: { source: "org_join_code" } });
      }
    }
    return { outcome, org: summary };
  });
  // After the commit: their copies are made, then announced (E5, report §26 D).
  if (result?.outcome === "joined") {
    await createCopiesAfterJoin(result.org.id, [userId]);
    await notifyNewCopies(result.org.id, { userId });
  }
  return result;
}

/** Accepts every open, unexpired org invite sent to this email at sign-up (decision 134). Returns how many. */
export async function acceptOrgEmailInvites(userId: string, email: string): Promise<number> {
  const invites = await db.select({ id: orgEmailInvites.id }).from(orgEmailInvites)
    .where(and(eq(orgEmailInvites.email, email.trim().toLowerCase()), isNull(orgEmailInvites.acceptedAt), gt(orgEmailInvites.expiresAt, sql`now()`)));
  let accepted = 0;
  for (const invite of invites) {
    // Audit N2: one invite that can't be accepted (full team, blocked, 50 organizations) doesn't stop the others.
    const result = await acceptOrgInvite(userId, invite.id).catch((error: unknown) => { console.error("Accepting an org invite at sign-up failed:", error); return null; });
    if (result && "orgId" in result) accepted += 1;
  }
  return accepted;
}

/** Free when no project address, held old handle or reserved name has it (report §30.2). Format is checked first by validateOrgHandle. */
export async function isOrgHandleAvailable(handle: string): Promise<boolean> {
  const [[project], [hold], [reserved]] = await Promise.all([
    db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, handle)).limit(1),
    db.select({ handle: orgHandleHolds.handle }).from(orgHandleHolds)
      .where(and(eq(orgHandleHolds.handle, handle), gt(orgHandleHolds.heldUntil, sql`now()`))).limit(1),
    db.select({ username: reservedUsernames.username }).from(reservedUsernames).where(eq(reservedUsernames.username, handle)).limit(1),
  ]);
  return !project && !hold && !reserved;
}
