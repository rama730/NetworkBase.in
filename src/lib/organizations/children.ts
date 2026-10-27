import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectMembers, projects } from "@/lib/db/schema";
import { capChildVisibility, isAboveCap, type ChildVisibility } from "@/lib/organizations/child-rules";
import { readOrgRules } from "@/lib/organizations/settings";
import { unlinkSprints } from "@/lib/organizations/sprints";
import { releaseGroupCopies } from "@/lib/organizations/assignments";
import { isProjectPubliclyReadableVisibility } from "@/lib/projects/project-visibility";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readOrgCap(executor: Executor, orgId: string) {
  const [org] = await executor
    .select({ visibility: projects.visibility, orgSettings: projects.orgSettings })
    .from(projects)
    .where(and(eq(projects.id, orgId), eq(projects.kind, "organization"), isNull(projects.deletedAt)))
    .limit(1);
  if (!org) return null;
  return { cap: readOrgRules(org.orgSettings).visibilityCap, orgPublic: isProjectPubliclyReadableVisibility(org.visibility), outsidePeople: readOrgRules(org.orgSettings).outsidePeople };
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
    .select({ id: projects.id, visibility: projects.visibility })
    .from(projects)
    .where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt)));
  let changed = 0;
  for (const child of children) {
    if (!isAboveCap(child.visibility, org.cap, org.orgPublic)) continue;
    const next = capChildVisibility("public", org.cap, org.orgPublic);
    await executor.update(projects).set({ visibility: next, updatedAt: new Date() }).where(eq(projects.id, child.id));
    changed += 1;
  }
  return changed;
}

/** How many children a cap would lower, for the impact preview (report §21.1 principle 4). */
export async function countChildrenAboveCap(orgId: string, cap: "public" | "org" | "private"): Promise<number> {
  const org = await readOrgCap(db, orgId);
  if (!org) return 0;
  const children = await db.select({ visibility: projects.visibility }).from(projects).where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt)));
  return children.filter((child) => isAboveCap(child.visibility, cap, org.orgPublic)).length;
}

/** Members of the project who are not in the org (any role), when the org keeps outside people out. */
export async function countOutsidePeople(projectId: string, orgId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM ${projectMembers} pm
    WHERE pm.project_id = ${projectId}
      AND NOT EXISTS (SELECT 1 FROM ${projectMembers} om WHERE om.project_id = ${orgId} AND om.user_id = pm.user_id)
      AND pm.user_id <> (SELECT owner_id FROM ${projects} WHERE id = ${orgId})
  `);
  return row?.n ?? 0;
}

/** Puts a personal project inside an org: visibility capped, request cleared (report §14.7). */
export async function moveIntoOrg(projectId: string, orgId: string, currentVisibility: string | null) {
  const org = await readOrgCap(db, orgId);
  if (!org) throw new Error("Organization not found.");
  const requested: ChildVisibility = isProjectPubliclyReadableVisibility(currentVisibility) ? "public" : currentVisibility === "org" ? "org" : "private";
  await db.update(projects).set({
    parentId: orgId,
    visibility: capChildVisibility(requested, org.cap, org.orgPublic),
    orgSettings: sql`${projects.orgSettings} - 'moveInRequest'`,
    updatedAt: new Date(),
  }).where(eq(projects.id, projectId));  // Its channels move under the org: #general becomes #<handle> (report §25.2).
  await db.execute(sql`SELECT app_private.chat_reparent_project(${projectId}::uuid)`);
}

/** Takes a child out of its org: it becomes a Private personal project and its sprints unlink (report §14.7, §15.8). */
export async function detachFromOrg(projectId: string) {
  await unlinkSprints(db, { childProjectId: projectId });
  await releaseGroupCopies(db, projectId);
  await db.update(projects).set({
    parentId: null,
    visibility: "private",
    orgSettings: sql`${projects.orgSettings} - 'detachRequest'`,
    updatedAt: new Date(),
  }).where(eq(projects.id, projectId));  // Its channels become its own workspace again; org admins who opened them leave (report §25.2).
  await db.execute(sql`SELECT app_private.chat_reparent_project(${projectId}::uuid)`);
}

export { readOrgCap };
