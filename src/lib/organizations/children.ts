import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { capChildVisibility, isAboveCap, type ChildVisibility } from "@/lib/organizations/child-rules";
import { readOrgRules } from "@/lib/organizations/settings";
import { readViewerOrgRole } from "@/lib/organizations/detail";
import { unlinkSprints } from "@/lib/organizations/sprints";
import { createCopiesForNewChild, releaseGroupCopies } from "@/lib/organizations/assignments";
import { notifyOrg } from "@/lib/organizations/notify";
import { isWorkspacePubliclyReadableVisibility } from "@/lib/workspaces/workspace-visibility";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readOrgCap(executor: Executor, orgId: string) {
  const [org] = await executor
    .select({ visibility: workspaces.visibility, orgSettings: workspaces.orgSettings })
    .from(workspaces)
    .where(and(eq(workspaces.id, orgId), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!org) return null;
  return { cap: readOrgRules(org.orgSettings).visibilityCap, orgPublic: isWorkspacePubliclyReadableVisibility(org.visibility), outsidePeople: readOrgRules(org.orgSettings).outsidePeople };
}

/**
 * Lowers every child project above the org's cap (report §21.7: cap tightened, or the org went private).
 * Returns how many changed. ponytail: a lowered project's legacy public cover URL is not moved to managed
 * storage here; the explicit Private change in project Settings still does that.
 */
export async function applyChildVisibilityCap(orgId: string, executor: Executor = db): Promise<number> {
  const org = await readOrgCap(executor, orgId);
  if (!org) return 0;
  const children = await executor
    .select({ id: workspaces.id, visibility: workspaces.visibility, title: workspaces.title, slug: workspaces.slug, ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
  const lowered: Array<(typeof children)[number] & { next: string }> = [];
  for (const child of children) {
    if (!isAboveCap(child.visibility, org.cap, org.orgPublic)) continue;
    const next = capChildVisibility("public", org.cap, org.orgPublic);
    await executor.update(workspaces).set({ visibility: next, updatedAt: new Date() }).where(eq(workspaces.id, child.id));
    lowered.push({ ...child, next });
  }
  // Report §26 B: the lead and the org's admins hear why ("North region is now Org only because Acme Sales changed its rules").
  if (lowered.length) {
    const [orgRow] = await executor.select({ title: workspaces.title }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    const admins = await executor.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.projectId, orgId), sql`${workspaceMembers.role} IN ('owner', 'admin')`));
    const stamp = Date.now();
    for (const child of lowered) {
      await notifyOrg({ orgId, eventKey: "org.child_notice", to: [child.ownerId, ...admins.map((a) => a.userId)],
        title: `${child.title} is now ${child.next === "private" ? "Private" : "Organization"} because ${orgRow?.title ?? "the organization"} changed its rules`,
        href: `/workspaces/${encodeURIComponent(child.slug ?? child.id)}`, sourceEventId: `capped:${child.id}:${stamp}`, refs: { projectId: child.id } });
    }
  }
  return lowered.length;
}

/** How many children a cap would lower, for the impact preview (report §21.1 principle 4). */
export async function countChildrenAboveCap(orgId: string, cap: "public" | "org" | "private"): Promise<number> {
  const org = await readOrgCap(db, orgId);
  if (!org) return 0;
  const children = await db.select({ visibility: workspaces.visibility }).from(workspaces).where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
  return children.filter((child) => isAboveCap(child.visibility, cap, org.orgPublic)).length;
}

/** Members of the project who are not in the org (any role), when the org keeps outside people out. */
export async function countOutsidePeople(projectId: string, orgId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM ${workspaceMembers} pm
    WHERE pm.workspace_id = ${projectId}
      AND NOT EXISTS (SELECT 1 FROM ${workspaceMembers} om WHERE om.workspace_id = ${orgId} AND om.user_id = pm.user_id)
      AND pm.user_id <> (SELECT owner_id FROM ${workspaces} WHERE id = ${orgId})
  `);
  return row?.n ?? 0;
}

/** Puts a personal project inside an org: visibility capped, request cleared (report §14.7). */
export async function moveIntoOrg(projectId: string, orgId: string, currentVisibility: string | null) {
  const org = await readOrgCap(db, orgId);
  if (!org) throw new Error("Organization not found.");
  const requested: ChildVisibility = isWorkspacePubliclyReadableVisibility(currentVisibility) ? "public" : currentVisibility === "org" ? "org" : "private";
  await db.update(workspaces).set({
    parentId: orgId,
    visibility: capChildVisibility(requested, org.cap, org.orgPublic),
    // "New in <org>" for 7 days on the Projects tab (report §28.6); a former org's label no longer applies.
    orgSettings: sql`(coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'moveInRequest' - 'formerOrg') || jsonb_build_object('movedInAt', now())`,
    updatedAt: new Date(),
  }).where(eq(workspaces.id, projectId));  // Its channels move under the org: #general becomes #<handle> (report §25.2).
  await db.execute(sql`SELECT app_private.chat_reparent_workspace(${projectId}::uuid)`);
  // Open group work reaches it, as it reaches a new workspace (report §42.2 problem 7).
  const [lead] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  if (lead) await createCopiesForNewChild(db, orgId, projectId, lead.ownerId);
}

/** Takes a child out of its org: it becomes a Private personal project and its sprints unlink (report §14.7, §15.8). */
export async function detachFromOrg(projectId: string) {
  await unlinkSprints(db, { childProjectId: projectId });
  await releaseGroupCopies(db, projectId);
  // Profile entries keep the history: "with CSE-3A (until Nov 2026)" (report §24.5).
  const until = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date());
  await db.update(workspaces).set({
    parentId: null,
    visibility: "private",
    orgSettings: sql`(coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'detachRequest')
      || jsonb_build_object('formerOrg', jsonb_build_object('title', (SELECT o.title FROM workspaces o WHERE o.id = ${workspaces.parentId}), 'until', ${until}::text))`,
    updatedAt: new Date(),
  }).where(eq(workspaces.id, projectId));  // Its channels become its own workspace again; org admins who opened them leave (report §25.2).
  await db.execute(sql`SELECT app_private.chat_reparent_workspace(${projectId}::uuid)`);
}

export { readOrgCap };

/**
 * Who may apply for a seat in an organization's workspace (report §25.4, §36.3): its members and admins; outside
 * people only to a Public workspace while the organization allows them; Viewers never. Checked on apply and on
 * accept, so a setting turned off in between still counts. Null means allowed, or no organization.
 */
export async function orgSeatApplyBlock(parentId: string | null, visibility: string | null, userId: string): Promise<string | null> {
  if (!parentId) return null;
  const role = await readViewerOrgRole(parentId, userId);
  if (role === "viewer") return "Viewers can't apply for seats.";
  if (role) return null;
  const [org] = await db.select({ settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, parentId)).limit(1);
  if (visibility === "public" && readOrgRules(org?.settings).outsidePeople) return null;
  return "Only people in this organization can apply here.";
}

/**
 * Decision 41 (report §24.3): inside an organization, a workspace that isn't Public uses only private repositories.
 * Checked when connecting or creating one, and again on every push, since a repository can turn public on GitHub.
 */
export async function orgRepositoryBlock(projectId: string, repoIsPrivate: boolean, moment: "connect" | "push"): Promise<string | null> {
  if (repoIsPrivate) return null;
  // Spelled out: Drizzle writes a bare "parent_id" in one-table queries, which inside the subquery would mean o's.
  const [row] = await db.select({
    visibility: workspaces.visibility,
    orgTitle: sql<string | null>`(SELECT o.title FROM workspaces o WHERE o.id = workspaces.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL)`,
  }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  if (!row?.orgTitle || row.visibility === "public") return null;
  return moment === "push"
    ? "This repository is now public. Make it private or disconnect it."
    : `This workspace is only visible inside ${row.orgTitle}, so its repository must be private.`;
}
