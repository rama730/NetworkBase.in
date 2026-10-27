import "server-only";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { orgEmailInvites, profiles, projectMembers, projects } from "@/lib/db/schema";
import { createCopiesForNewMember, releaseCopiesOnLeave } from "@/lib/organizations/assignments";
import { addProjectMemberInternal, removeProjectMemberInternal } from "@/lib/projects/collaborator-lifecycle";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Accepts one open org invite for this person (report §20.5): the invited role and title apply, and the
 * invite's child project and unit place them there too. Returns the org id, or null when the invite is gone.
 */
export async function acceptOrgInvite(userId: string, inviteId: string): Promise<string | null> {
  return db.transaction(async (tx) => {
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
export async function removeFromOrg(executor: Executor, orgId: string, userId: string, actorId: string) {
  const childMemberships = await executor.select({ projectId: projectMembers.projectId, leadId: projects.ownerId }).from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projects.parentId, orgId), eq(projectMembers.userId, userId), isNull(projects.deletedAt)));
  const self = actorId === userId;
  await releaseCopiesOnLeave(executor, orgId, userId);
  for (const { projectId, leadId } of childMemberships) {
    // Org admins act with the lead's powers in child projects (report §29.4), so the lead is the actor there.
    await removeProjectMemberInternal(executor, { projectId, actorId: self ? userId : leadId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self });
  }
  await removeProjectMemberInternal(executor, { projectId: orgId, actorId, targetUserId: userId, mode: "unassign_active_tasks", allowSelf: self });
}
