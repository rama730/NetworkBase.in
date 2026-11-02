import "server-only";

import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceDocuments, workspaceNodes, workspaceSprintEvents, workspaceSprints, workspaces, sprintMaterials } from "@/lib/db/schema";
import { fitsInside, overlaps } from "@/lib/organizations/sprint-rules";
import { readOrgWork } from "@/lib/organizations/settings";
import type { WorkspaceAccess } from "@/lib/data/workspace-access";
import { orgFileAccessSql } from "@/lib/files/internal-helpers";

// Org sprints (report §15): checks, matching child sprints, links and materials, kept beside the project
// sprint actions that call them.

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const LIVE = ["planning", "active", "completed"] as const;

async function readPlacement(executor: Executor, projectId: string) {
  const [project] = await executor.select({ kind: workspaces.kind, parentId: workspaces.parentId, orgSettings: workspaces.orgSettings, orgType: workspaces.orgType }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  return project ?? null;
}

/**
 * Throws with a plain message when a sprint breaks the org rules (report §15.1): org sprints never overlap;
 * a linked child sprint belongs to its own org's planned or active sprint and fits inside its dates.
 * A child that follows org sprints (report §14.3 Phase 4) links a new sprint to the org sprint holding its dates.
 * Returns the parent sprint to store. Callers lock the project row first.
 */
export async function assertOrgSprintRules(executor: Executor, input: {
  projectId: string;
  startDate: Date;
  endDate: Date;
  parentSprintId?: string | null;
  excludeSprintId?: string | null;
}): Promise<string | null> {
  const project = await readPlacement(executor, input.projectId);
  if (!project) throw new Error("Workspace not found");
  const range = { startDate: input.startDate, endDate: input.endDate };

  if (project.kind === "organization") {
    if (input.parentSprintId) throw new Error("An organization’s sprints are not inside another sprint.");
    const others = await executor
      .select({ name: workspaceSprints.name, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
      .from(workspaceSprints)
      .where(and(
        eq(workspaceSprints.projectId, input.projectId),
        inArray(workspaceSprints.status, [...LIVE]),
        ...(input.excludeSprintId ? [ne(workspaceSprints.id, input.excludeSprintId)] : []),
      ));
    const clash = others.find((other) => overlaps(range, other));
    if (clash) throw new Error(`Organization sprints can’t overlap: this overlaps ${clash.name}.`);
    return null;
  }

  if (!input.parentSprintId) {
    if (!project.parentId || (project.orgSettings as { followOrgSprints?: unknown } | null)?.followOrgSprints !== true) return null;
    const live = await executor
      .select({ id: workspaceSprints.id, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
      .from(workspaceSprints)
      .where(and(eq(workspaceSprints.projectId, project.parentId), inArray(workspaceSprints.status, ["planning", "active"])));
    const holder = live.find((sprint) => fitsInside(range, sprint));
    if (!holder) throw new Error("This workspace follows its organization’s sprints: pick dates inside one of them.");
    return holder.id;
  }
  if (!project.parentId) throw new Error("Only workspaces inside an organization link to an org sprint.");
  const [parent] = await executor
    .select({ name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
    .from(workspaceSprints)
    .where(and(eq(workspaceSprints.id, input.parentSprintId), eq(workspaceSprints.projectId, project.parentId)))
    .limit(1);
  if (!parent || (parent.status !== "planning" && parent.status !== "active")) throw new Error("Pick a planned or active sprint of your organization.");
  if (!fitsInside(range, parent)) throw new Error(`The sprint must stay inside ${parent.name}'s dates.`);
  return input.parentSprintId;
}

/** "Create a matching sprint in every child project": a planned, linked sprint per live child (report §15.5). */
export async function createMatchingChildSprints(executor: Executor, input: {
  orgId: string;
  orgSprint: { id: string; name: string; goal: string | null; startDate: Date; endDate: Date };
  actorId: string;
}) {
  const children = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.parentId, input.orgId), isNull(workspaces.deletedAt), ne(workspaces.status, "archived")));
  for (const child of children) {
    await executor.execute(sql`SELECT id FROM ${workspaces} WHERE id = ${child.id} FOR UPDATE`);
    const [inserted] = await executor
      .insert(workspaceSprints)
      .values({
        projectId: child.id,
        creatorId: input.actorId,
        sprintNumber: sql<number>`(SELECT COALESCE(MAX(sprint_number), 0) + 1 FROM ${workspaceSprints} WHERE workspace_id = ${child.id})`,
        name: input.orgSprint.name,
        goal: input.orgSprint.goal,
        description: `Created from ${input.orgSprint.name}`,
        startDate: input.orgSprint.startDate,
        endDate: input.orgSprint.endDate,
        status: "planning",
        parentSprintId: input.orgSprint.id,
      })
      .returning({ id: workspaceSprints.id });
    if (inserted) {
      await executor.insert(workspaceSprintEvents).values({
        projectId: child.id,
        sprintId: inserted.id,
        actorId: input.actorId,
        eventType: "created",
        payload: { name: input.orgSprint.name, status: "planning", source: "org_matching_sprint", orgSprintId: input.orgSprint.id },
      });
    }
  }
  return children.length;
}

/** Cancelling an org sprint, or detaching a project, turns linked child sprints into ordinary ones. */
export async function unlinkSprints(executor: Executor, where: { orgSprintId?: string; childProjectId?: string }) {
  if (where.orgSprintId) {
    await executor.update(workspaceSprints).set({ parentSprintId: null, updatedAt: new Date() }).where(eq(workspaceSprints.parentSprintId, where.orgSprintId));
  }
  if (where.childProjectId) {
    await executor.update(workspaceSprints).set({ parentSprintId: null, updatedAt: new Date() })
      .where(and(eq(workspaceSprints.projectId, where.childProjectId), sql`${workspaceSprints.parentSprintId} IS NOT NULL`));
  }
}

export type SprintOrgContext = {
  kind: "org" | "child";
  /** Child projects: the org sprints to link to (planned and active, shown in child projects). */
  orgSprints: Array<{ id: string; name: string; status: string; startDate: string; endDate: string }>;
  orgTitle: string | null;
  orgSlug: string | null;
  /** Child projects: the selected sprint's org sprint, and whether it still fits its dates. */
  parentSprint: { id: string; name: string; endDate: string; fits: boolean } | null;
  /** Child projects: an org sprint is running and this project has no active sprint (the empty state). */
  runningOrgSprint: { id: string; name: string; endDate: string } | null;
  /** Orgs: child sprints linked to the selected org sprint, and how many child projects have none. */
  linkedProjects: Array<{ projectId: string; title: string; slug: string | null; sprintId: string; sprintName: string; status: string }>;
  notLinkedCount: number;
  /** Per sprint of this project: its link and whether it starts automatically. */
  sprintFlags: Record<string, { parentSprintId: string | null; autoStart: boolean; showInChildren: boolean; notifyOnStart: boolean }>;
  /** Orgs: the org type (name suggestions) and the Work defaults for a new sprint (report §15.2, §21). */
  orgType?: string | null;
  defaults?: { autoStart: boolean; showInChildren: boolean; createMatching: boolean; notifyOnStart: boolean };
};

export async function readSprintOrgContext(projectId: string, selectedSprintId: string | null): Promise<SprintOrgContext | null> {
  const project = await readPlacement(db, projectId);
  if (!project || (project.kind !== "organization" && !project.parentId)) return null;
  const flags = await db
    .select({ id: workspaceSprints.id, parentSprintId: workspaceSprints.parentSprintId, autoStart: workspaceSprints.autoStart, showInChildren: workspaceSprints.showInChildren, notifyOnStart: workspaceSprints.notifyOnStart, status: workspaceSprints.status })
    .from(workspaceSprints)
    .where(eq(workspaceSprints.projectId, projectId));
  const sprintFlags = Object.fromEntries(flags.map((f) => [f.id, { parentSprintId: f.parentSprintId, autoStart: f.autoStart, showInChildren: f.showInChildren, notifyOnStart: f.notifyOnStart }]));
  const empty: SprintOrgContext = { kind: project.kind === "organization" ? "org" : "child", orgSprints: [], orgTitle: null, orgSlug: null, parentSprint: null, runningOrgSprint: null, linkedProjects: [], notLinkedCount: 0, sprintFlags };

  if (project.kind === "organization") {
    const work = readOrgWork(project.orgSettings, project.orgType);
    empty.orgType = project.orgType;
    empty.defaults = { autoStart: work.sprintAutoStart, showInChildren: work.sprintShowInChildren, createMatching: work.sprintCreateMatching, notifyOnStart: work.sprintNotifyOnStart };
    if (!selectedSprintId) return empty;
    const [linked, children] = await Promise.all([
      db.select({ projectId: workspaces.id, title: workspaces.title, slug: workspaces.slug, sprintId: workspaceSprints.id, sprintName: workspaceSprints.name, status: workspaceSprints.status })
        .from(workspaceSprints).innerJoin(workspaces, eq(workspaces.id, workspaceSprints.projectId))
        .where(and(eq(workspaceSprints.parentSprintId, selectedSprintId), isNull(workspaces.deletedAt), notInArray(workspaceSprints.status, ["cancelled"]))),
      db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.parentId, projectId), isNull(workspaces.deletedAt))),
    ]);
    const linkedIds = new Set(linked.map((row) => row.projectId));
    return { ...empty, linkedProjects: linked, notLinkedCount: children.filter((c) => !linkedIds.has(c.id)).length };
  }

  const [org] = await db.select({ title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, project.parentId!)).limit(1);
  const orgSprints = await db
    .select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
    .from(workspaceSprints)
    .where(and(eq(workspaceSprints.projectId, project.parentId!), inArray(workspaceSprints.status, ["planning", "active"]), eq(workspaceSprints.showInChildren, true)))
    .orderBy(workspaceSprints.startDate);
  const selected = flags.find((f) => f.id === selectedSprintId);
  const [own] = selected?.parentSprintId
    ? await db.select({ startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate }).from(workspaceSprints).where(eq(workspaceSprints.id, selected.id)).limit(1)
    : [];
  const [parent] = selected?.parentSprintId
    ? await db.select({ id: workspaceSprints.id, name: workspaceSprints.name, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate }).from(workspaceSprints).where(eq(workspaceSprints.id, selected.parentSprintId)).limit(1)
    : [];
  const running = orgSprints.find((s) => s.status === "active");
  return {
    ...empty,
    orgTitle: org?.title ?? null,
    orgSlug: org?.slug ?? null,
    orgSprints: orgSprints.map((s) => ({ id: s.id, name: s.name, status: s.status, startDate: s.startDate.toISOString(), endDate: s.endDate.toISOString() })),
    // "Outside CO1 dates" is worked out on read: dates are never changed automatically (report §15.3).
    parentSprint: parent && own ? { id: parent.id, name: parent.name, endDate: parent.endDate.toISOString(), fits: fitsInside(own, parent) } : null,
    runningOrgSprint: running && !flags.some((f) => f.status === "active") ? { id: running.id, name: running.name, endDate: running.endDate.toISOString() } : null,
  };
}

export type SprintMaterial = { id: string; kind: "file" | "doc"; title: string; nodeId: string | null; docSlug: string | null };

/** A viewer's `access` hides files they can't open, names included (report §42.10 problem 16); without it, all. */
export async function readSprintMaterials(sprintId: string, access?: WorkspaceAccess): Promise<SprintMaterial[]> {
  const rows = await db
    .select({ id: sprintMaterials.id, nodeId: sprintMaterials.nodeId, nodeName: workspaceNodes.name, docSlug: workspaceDocuments.slug, docFilename: workspaceDocuments.filename })
    .from(sprintMaterials)
    .leftJoin(workspaceNodes, and(eq(workspaceNodes.id, sprintMaterials.nodeId), isNull(workspaceNodes.deletedAt), access ? orgFileAccessSql(access) : undefined))
    .leftJoin(workspaceDocuments, eq(workspaceDocuments.id, sprintMaterials.docId))
    .where(eq(sprintMaterials.sprintId, sprintId))
    .orderBy(sprintMaterials.createdAt);
  return rows.flatMap((row): SprintMaterial[] => row.nodeName
    ? [{ id: row.id, kind: "file" as const, title: row.nodeName, nodeId: row.nodeId, docSlug: null }]
    : row.docSlug
      ? [{ id: row.id, kind: "doc" as const, title: row.docFilename ?? row.docSlug, nodeId: null, docSlug: row.docSlug }]
      : []);
}
