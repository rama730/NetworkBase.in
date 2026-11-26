import "server-only";

import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, workspaceMembers, workspaces } from "@/lib/db/schema";
import { syncWorkspaceChat } from "@/lib/messaging/integrations";
import { notifyOrg } from "@/lib/organizations/notify";
import { moveGroupWorkToLead } from "@/lib/organizations/assignments";
import { pauseActive } from "@/lib/organizations/community";
import { accountOrgLimit } from "@/lib/organizations/members";

// Account deletion and organizations (report §30.7): owners of an org can't delete their account; child projects
// a person leads never go with the account. They pass to a project admin → unit lead → the org owner.

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function orgsOwnedBy(userId: string, executor: Executor = db) {
  return executor.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces)
    .where(and(eq(workspaces.ownerId, userId), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)));
}

/** Longest-serving, still-active member of a project with `role` (or placed in a unit when `inUnit`). */
async function longestServing(executor: Executor, projectId: string, leaving: string, filter: { role?: "admin"; inUnit?: boolean }) {
  const [row] = await executor.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
    .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
    .where(and(
      eq(workspaceMembers.projectId, projectId), ne(workspaceMembers.userId, leaving), isNull(profiles.deletedAt),
      filter.role ? eq(workspaceMembers.role, filter.role) : undefined,
      filter.inUnit ? isNotNull(workspaceMembers.unitId) : undefined,
    ))
    .orderBy(asc(workspaceMembers.joinedAt)).limit(1);
  return row?.userId ?? null;
}

async function makeOwner(executor: Executor, projectId: string, from: string, to: string, extraSettings: Record<string, unknown> = {}) {
  await executor.update(workspaces).set({
    ownerId: to,
    orgSettings: sql`${workspaces.orgSettings} || ${JSON.stringify(extraSettings)}::jsonb`,
    updatedAt: new Date(),
  }).where(eq(workspaces.id, projectId));
  // One owner row per workspace (0264): demote first, then promote.
  await executor.update(workspaceMembers).set({ role: "member" }).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, from)));
  await executor.insert(workspaceMembers).values({ projectId, userId: to, role: "owner" })
    .onConflictDoUpdate({ target: [workspaceMembers.projectId, workspaceMembers.userId], set: { role: "owner" } });
  await syncWorkspaceChat(executor, projectId, to, "role");
  await moveGroupWorkToLead(executor, projectId, to);
}

/**
 * Child projects the person leads pass on before their account is soft-deleted: a project admin, else the unit
 * lead, else the org owner, flagged "needs a new lead" for the org's admins until ownership changes again.
 * ponytail: "unit lead" is the longest-serving member placed in a unit (units have no lead column yet).
 */
export async function handOverLedChildWorkspaces(executor: Executor, userId: string) {
  // Spelled out: Drizzle writes a bare "parent_id" in one-table queries, which inside the subquery would mean o's.
  const led = await executor.select({ id: workspaces.id, orgOwnerId: sql<string>`(SELECT o.owner_id FROM workspaces o WHERE o.id = workspaces.parent_id)` })
    .from(workspaces).where(and(eq(workspaces.ownerId, userId), isNotNull(workspaces.parentId), isNull(workspaces.deletedAt)));
  for (const child of led) {
    const next = await longestServing(executor, child.id, userId, { role: "admin" })
      ?? await longestServing(executor, child.id, userId, { inUnit: true })
      ?? child.orgOwnerId;
    if (!next || next === userId) continue;
    await makeOwner(executor, child.id, userId, next, { leadHandover: { from: userId, at: new Date().toISOString() } });
  }
  return led.length;
}

/** After the handover commits: each new lead hears "You're the lead of Compiler Lab" (report §26 B), once per handover. */
export async function notifyLeadHandovers(fromUserId: string) {
  const handed = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, parentId: workspaces.parentId, ownerId: workspaces.ownerId, at: sql<string | null>`${workspaces.orgSettings}->'leadHandover'->>'at'` })
    .from(workspaces).where(and(isNotNull(workspaces.parentId), isNull(workspaces.deletedAt), sql`${workspaces.orgSettings}->'leadHandover'->>'from' = ${fromUserId}`));
  for (const child of handed) {
    await notifyOrg({ orgId: child.parentId!, eventKey: "org.role_changed", to: [child.ownerId], title: `You’re the owner of ${child.title}`,
      href: `/workspaces/${encodeURIComponent(child.slug ?? child.id)}`, sourceEventId: `lead:${child.id}:${child.at ?? ""}`, refs: { projectId: child.id } });
  }
}

/** Involuntary removal only (an account removed at hard delete): the org passes to its longest-serving admin. */
export async function handOverOwnedOrgs(executor: Executor, userId: string) {
  const owned = await orgsOwnedBy(userId, executor);
  let unresolved = 0;
  for (const org of owned) {
    const next = await longestServing(executor, org.id, userId, { role: "admin" });
    if (next) await makeOwner(executor, org.id, userId, next);
    else unresolved++;
  }
  return unresolved;
}

/**
 * B5.5d (report 34.6 call 6): when a chapter's owner leaves, its longest-serving co-organiser takes over; with none,
 * the community's owner, else its longest-serving admin. Each must still be in the community, not paused there and
 * under the ownership limit (review); otherwise the next one is tried. Returns the new owner, or null.
 */
export async function chapterTakeover(executor: Executor, chapterId: string, leaving: string) {
  const [c] = await executor.execute<{ parent: string | null; pauses: Record<string, { until: string }> | null }>(sql`
    SELECT p.id::text AS parent, p.org_settings->'community'->'pauses' AS pauses
    FROM workspaces w JOIN workspaces p ON p.id::text = w.org_settings->>'chapterOf' AND p.deleted_at IS NULL
    WHERE w.id = ${chapterId}::uuid AND w.owner_id = ${leaving}::uuid AND w.deleted_at IS NULL`);
  if (!c?.parent) return null;
  const candidates = await executor.execute<{ id: string }>(sql`
    SELECT id FROM (
      SELECT m.user_id AS id, 1 AS tier, m.joined_at FROM workspace_members m WHERE m.workspace_id = ${chapterId}::uuid AND m.role = 'admin'
      UNION ALL SELECT owner_id, 2, NULL FROM workspaces WHERE id = ${c.parent}::uuid
      UNION ALL SELECT m.user_id, 3, m.joined_at FROM workspace_members m WHERE m.workspace_id = ${c.parent}::uuid AND m.role = 'admin') x
    WHERE id <> ${leaving}::uuid
      AND EXISTS (SELECT 1 FROM workspace_members pm WHERE pm.workspace_id = ${c.parent}::uuid AND pm.user_id = x.id AND pm.role IN ('member', 'admin', 'owner'))
      AND EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = x.id AND pr.deleted_at IS NULL)
    ORDER BY tier, joined_at NULLS FIRST LIMIT 20`);
  for (const { id } of candidates) {
    if (pauseActive(c.pauses?.[id] ?? null, new Date())) continue;
    if (await accountOrgLimit(executor, id, "own")) continue;
    await makeOwner(executor, chapterId, leaving, id, { leadHandover: { from: leaving, at: new Date().toISOString() } });
    return id;
  }
  return null;
}
