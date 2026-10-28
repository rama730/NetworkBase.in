import "server-only";

import { and, count, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  applicationEvents,
  orgEmailInvites,
  orgHandleHolds,
  orgJoinBlocks,
  projectMembers,
  projects,
  reservedUsernames,
  roleApplications,
} from "@/lib/db/schema";
import { decideOrgJoin, type OrgJoinMode, type OrgJoinOutcome } from "@/lib/organizations/join-rules";
import { addProjectMemberInternal } from "@/lib/projects/collaborator-lifecycle";
import { createCopiesForNewMember } from "@/lib/organizations/assignments";
import { notifyNewCopies } from "@/lib/organizations/assignment-notify";
import { acceptOrgInvite } from "@/lib/organizations/members";

export type OrgSummary = { id: string; title: string; slug: string | null };

function readJoinMode(settings: unknown): OrgJoinMode {
  return (settings as { joinMode?: unknown } | null)?.joinMode === "approval" ? "approval" : "instant";
}

function parseMaxMembers(value: string | null) {
  const n = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The org behind an enabled join code, or null. Never says why a code doesn't match. */
export async function findOrgByJoinCode(code: string) {
  const [org] = await db
    .select({
      id: projects.id,
      title: projects.title,
      slug: projects.slug,
      ownerId: projects.ownerId,
      orgType: projects.orgType,
      coverImage: projects.coverImage,
      visibility: projects.visibility,
      orgSettings: projects.orgSettings,
    })
    .from(projects)
    .where(and(
      eq(projects.joinCode, code),
      eq(projects.joinCodeEnabled, true),
      eq(projects.kind, "organization"),
      isNull(projects.deletedAt),
    ))
    .limit(1);
  return org ?? null;
}

export async function countOrgMembers(orgId: string) {
  const [row] = await db.select({ n: count() }).from(projectMembers).where(eq(projectMembers.projectId, orgId));
  return row?.n ?? 0;
}

/** Where the viewer already stands with an org, for the join page. */
export async function viewerOrgStatus(orgId: string, ownerId: string, userId: string): Promise<"member" | "pending" | null> {
  if (ownerId === userId) return "member";
  const [[member], [pending]] = await Promise.all([
    db.select({ id: projectMembers.id }).from(projectMembers)
      .where(and(eq(projectMembers.projectId, orgId), eq(projectMembers.userId, userId))).limit(1),
    db.select({ id: roleApplications.id }).from(roleApplications)
      .where(and(eq(roleApplications.projectId, orgId), eq(roleApplications.applicantId, userId), eq(roleApplications.status, "pending"))).limit(1),
  ]);
  return member ? "member" : pending ? "pending" : null;
}

/**
 * Joins or asks to join an org (report §6.1, §29.1). The org row is locked first, so the
 * member count, Max members and block list are read and acted on together. Requests reuse role_applications
 * with no role. Callers check the code exists and rate-limit; this is shared with onboarding completion.
 */
export function joinOrgByCode(userId: string, code: string, note?: string | null) {
  return joinOrg(userId, and(eq(projects.joinCode, code), eq(projects.joinCodeEnabled, true))!, note);
}

/** Public orgs can also be joined from their page without the code (report §6.1). */
export function joinPublicOrg(userId: string, orgId: string, note?: string | null) {
  return joinOrg(userId, and(eq(projects.id, orgId), inArray(projects.visibility, ["public", "unlisted"]))!, note);
}

async function joinOrg(
  userId: string,
  where: SQL,
  note?: string | null,
): Promise<{ outcome: OrgJoinOutcome; org: OrgSummary } | null> {
  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .select({
        id: projects.id,
        title: projects.title,
        slug: projects.slug,
        ownerId: projects.ownerId,
        status: projects.status,
        suspendedAt: projects.suspendedAt,
        deletionScheduledAt: projects.deletionScheduledAt,
        orgSettings: projects.orgSettings,
        maxCollaborators: projects.maxCollaborators,
      })
      .from(projects)
      .where(and(where, eq(projects.kind, "organization"), isNull(projects.deletedAt)))
      .for("update")
      .limit(1);
    if (!org) return null;

    const [[membership], [block], [request], [members]] = await Promise.all([
      tx.select({ id: projectMembers.id }).from(projectMembers)
        .where(and(eq(projectMembers.projectId, org.id), eq(projectMembers.userId, userId))).limit(1),
      tx.select({ userId: orgJoinBlocks.userId }).from(orgJoinBlocks)
        .where(and(eq(orgJoinBlocks.orgId, org.id), eq(orgJoinBlocks.userId, userId))).limit(1),
      tx.select({ id: roleApplications.id, status: roleApplications.status, updatedAt: roleApplications.updatedAt, decisionBy: roleApplications.decisionBy })
        .from(roleApplications)
        .where(and(eq(roleApplications.projectId, org.id), eq(roleApplications.applicantId, userId))).limit(1),
      tx.select({ n: count() }).from(projectMembers).where(eq(projectMembers.projectId, org.id)),
    ]);

    const outcome = decideOrgJoin({
      available: org.status !== "archived" && !org.suspendedAt && !org.deletionScheduledAt,
      isMember: Boolean(membership) || org.ownerId === userId,
      isBlocked: Boolean(block),
      joinMode: readJoinMode(org.orgSettings),
      memberCount: members?.n ?? 0,
      maxMembers: parseMaxMembers(org.maxCollaborators),
      request: request ? { status: request.status, updatedAt: request.updatedAt, decidedBySelf: request.decisionBy === userId } : null,
    });
    const summary = { id: org.id, title: org.title, slug: org.slug };

    if (outcome === "joined") {
      // Joining by code is always Member (decision 58); a pending request is closed by the join.
      await addProjectMemberInternal(tx, { projectId: org.id, userId, role: "member", actorId: userId, source: "join_code" });
      // Late joiners get copies of open assignments (report §16.9).
      await createCopiesForNewMember(tx, org.id, userId);
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
  // After the commit: the copies they received are announced (E5, report §26 D).
  if (result?.outcome === "joined") await notifyNewCopies(result.org.id, { userId });
  return result;
}

/** Accepts every open, unexpired org invite sent to this email at sign-up (decision 134). Returns how many. */
export async function acceptOrgEmailInvites(userId: string, email: string): Promise<number> {
  const invites = await db.select({ id: orgEmailInvites.id }).from(orgEmailInvites)
    .where(and(eq(orgEmailInvites.email, email.trim().toLowerCase()), isNull(orgEmailInvites.acceptedAt), gt(orgEmailInvites.expiresAt, sql`now()`)));
  let accepted = 0;
  for (const invite of invites) if (await acceptOrgInvite(userId, invite.id)) accepted += 1;
  return accepted;
}

/** Free when no project address, held old handle or reserved name has it (report §30.2). Format is checked first by validateOrgHandle. */
export async function isOrgHandleAvailable(handle: string): Promise<boolean> {
  const [[project], [hold], [reserved]] = await Promise.all([
    db.select({ id: projects.id }).from(projects).where(eq(projects.slug, handle)).limit(1),
    db.select({ handle: orgHandleHolds.handle }).from(orgHandleHolds)
      .where(and(eq(orgHandleHolds.handle, handle), gt(orgHandleHolds.heldUntil, sql`now()`))).limit(1),
    db.select({ username: reservedUsernames.username }).from(reservedUsernames).where(eq(reservedUsernames.username, handle)).limit(1),
  ]);
  return !project && !hold && !reserved;
}
