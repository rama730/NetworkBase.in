import "server-only";

import { runningSprint, sprintPath } from "@/lib/workspaces/sprint-plan";
import { and, eq, inArray, isNull, ne, notInArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceDocuments, workspaceNodes, workspaceSprintEvents, workspaceSprints, workspaces, sprintMaterials, sprintSharedWorkspaces } from "@/lib/db/schema";
import { fitsInside, insideError, overlaps } from "@/lib/organizations/sprint-rules";
import { readOrgWork } from "@/lib/organizations/settings";
import type { WorkspaceAccess } from "@/lib/data/workspace-access";
import { orgFileAccessSql } from "@/lib/files/internal-helpers";

// Org sprints (report §15): checks, matching child sprints, links and materials, kept beside the project
// sprint actions that call them.

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
const LIVE = ["planning", "active", "completed"] as const;

async function readPlacement(executor: Executor, projectId: string) {
  const [project] = await executor.select({ kind: workspaces.kind, parentId: workspaces.parentId, orgSettings: workspaces.orgSettings, orgType: workspaces.orgType, termEnd: workspaces.termEnd }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
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
    // Board/review report §6: two levels — main sprints (a CO) and sprints inside one. Main sprints don't overlap each
    // other; a sprint fits inside its main sprint and doesn't overlap the other sprints in it; nothing goes deeper.
    const sameLevel = (parentId: string | null) => executor
      .select({ name: workspaceSprints.name, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
      .from(workspaceSprints)
      .where(and(
        eq(workspaceSprints.projectId, input.projectId),
        inArray(workspaceSprints.status, [...LIVE]),
        parentId ? eq(workspaceSprints.parentSprintId, parentId) : isNull(workspaceSprints.parentSprintId),
        ...(input.excludeSprintId ? [ne(workspaceSprints.id, input.excludeSprintId)] : []),
      ));
    if (input.parentSprintId) {
      const [parent] = await executor
        .select({ name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate, parentSprintId: workspaceSprints.parentSprintId })
        .from(workspaceSprints)
        .where(and(eq(workspaceSprints.id, input.parentSprintId), eq(workspaceSprints.projectId, input.projectId)))
        .limit(1);
      if (!parent) throw new Error("Pick one of this organization’s main sprints.");
      if (parent.parentSprintId) throw new Error(`${parent.name} is already inside another sprint; pick its main sprint instead.`);
      if (input.excludeSprintId) {
        const [inside] = await executor.select({ id: workspaceSprints.id }).from(workspaceSprints)
          .where(and(eq(workspaceSprints.parentSprintId, input.excludeSprintId), inArray(workspaceSprints.status, [...LIVE]))).limit(1);
        if (inside) throw new Error("This sprint holds other sprints, so it stays a main sprint.");
      }
      if (parent.status !== "planning" && parent.status !== "active") throw new Error(`${parent.name} has closed; pick an upcoming or running one.`);
      const outside = insideError(range, parent);
      if (outside) throw new Error(outside);
      const clash = (await sameLevel(input.parentSprintId)).find((other) => overlaps(range, other));
      if (clash) throw new Error(`Sprints inside ${parent.name} can’t overlap: this overlaps ${clash.name}.`);
      return input.parentSprintId;
    }
    const clash = (await sameLevel(null)).find((other) => overlaps(range, other));
    if (clash) throw new Error(`Organization sprints can’t overlap: this overlaps ${clash.name}.`);
    // An edited main sprint keeps the sprints inside it (callers move them first when asked to).
    if (input.excludeSprintId) {
      const inside = await executor.select({ name: workspaceSprints.name, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate }).from(workspaceSprints)
        .where(and(eq(workspaceSprints.parentSprintId, input.excludeSprintId), eq(workspaceSprints.projectId, input.projectId), inArray(workspaceSprints.status, [...LIVE])));
      const out = inside.find((child) => !fitsInside(child, range));
      if (out) throw new Error(`${out.name} would sit outside these dates. Tick “Move the sprints inside too”, or change ${out.name} first.`);
    }
    return null;
  }

  if (!input.parentSprintId) {
    if (!project.parentId || (project.orgSettings as { followOrgSprints?: unknown } | null)?.followOrgSprints !== true) return null;
    const live = await executor
      .select({ id: workspaceSprints.id, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
      .from(workspaceSprints)
      .where(and(eq(workspaceSprints.projectId, project.parentId), inArray(workspaceSprints.status, ["planning", "active"]), sprintSharedWithSql(workspaceSprints.id, input.projectId)));
    const holder = live.find((sprint) => fitsInside(range, sprint));
    if (!holder) throw new Error("This workspace follows its organization’s sprints: pick dates inside one of them.");
    return holder.id;
  }
  if (!project.parentId) throw new Error("Only workspaces inside an organization link to an org sprint.");
  const [parent] = await executor
    .select({ name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
    .from(workspaceSprints)
    // Live-fix 34: only a sprint shared with this workspace can hold its sprint.
    .where(and(eq(workspaceSprints.id, input.parentSprintId), eq(workspaceSprints.projectId, project.parentId), sprintSharedWithSql(workspaceSprints.id, input.projectId)))
    .limit(1);
  if (!parent || (parent.status !== "planning" && parent.status !== "active")) throw new Error("Pick a planned or active sprint of your organization.");
  const outside = insideError(range, parent);
  if (outside) throw new Error(outside);
  return input.parentSprintId;
}

/** "Create a matching sprint in every child project": a planned, linked sprint per live child (report §15.5). */
export type SprintSharing = "all" | "selected" | "none";

/** Whether an org sprint reaches a workspace: shared, and either with all of them or with this one (live-fix 34). */
export function sprintSharedWithSql(sprintId: SQL | AnyColumn, workspaceId: string | SQL) {
  return sql`(${workspaceSprints.showInChildren} AND (NOT EXISTS (SELECT 1 FROM sprint_shared_workspaces ss WHERE ss.sprint_id = ${sprintId})
    OR EXISTS (SELECT 1 FROM sprint_shared_workspaces ss WHERE ss.sprint_id = ${sprintId} AND ss.workspace_id = ${workspaceId}::uuid)))`;
}

/** Saves the choice: All and None keep no rows; Selected keeps the chosen workspaces of this organization. */
export async function saveSprintSharing(executor: Executor, input: { orgId: string; sprintId: string; sharedWith: SprintSharing; workspaceIds: string[] }) {
  await executor.delete(sprintSharedWorkspaces).where(eq(sprintSharedWorkspaces.sprintId, input.sprintId));
  if (input.sharedWith !== "selected") return;
  const valid = input.workspaceIds.length ? await executor.select({ id: workspaces.id }).from(workspaces)
    .where(and(eq(workspaces.parentId, input.orgId), inArray(workspaces.id, input.workspaceIds), isNull(workspaces.deletedAt))) : [];
  if (valid.length === 0) throw new Error("Pick at least one workspace to share with.");
  await executor.insert(sprintSharedWorkspaces).values(valid.map((w) => ({ sprintId: input.sprintId, workspaceId: w.id })));
}

export async function createMatchingChildSprints(executor: Executor, input: {
  orgId: string;
  orgSprint: { id: string; name: string; goal: string | null; startDate: Date; endDate: Date };
  actorId: string;
  /** Selected sharing: only these workspaces get their own sprint inside it. */
  onlyWorkspaceIds?: string[];
}) {
  const children = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.parentId, input.orgId), isNull(workspaces.deletedAt), ne(workspaces.status, "archived"),
      input.onlyWorkspaceIds?.length ? inArray(workspaces.id, input.onlyWorkspaceIds) : undefined));
  if (children.length === 0) return 0;
  // Audit N83: one statement for every workspace instead of a lock, an insert and an event each. The unique
  // (workspace_id, sprint_number) index still refuses a number taken by a sprint created at the same moment.
  const ids = children.map((c) => c.id);
  const inserted = Array.from(await executor.execute<{ id: string; workspace_id: string }>(sql`
    INSERT INTO ${workspaceSprints} (workspace_id, creator_id, sprint_number, name, goal, description, start_date, end_date, status, parent_sprint_id)
    SELECT w.id, ${input.actorId}::uuid,
           (SELECT COALESCE(MAX(s.sprint_number), 0) + 1 FROM ${workspaceSprints} s WHERE s.workspace_id = w.id),
           ${input.orgSprint.name}, ${input.orgSprint.goal}, ${`Created from ${input.orgSprint.name}`},
           ${input.orgSprint.startDate.toISOString()}::timestamptz, ${input.orgSprint.endDate.toISOString()}::timestamptz, 'planning', ${input.orgSprint.id}::uuid
    FROM ${workspaces} w WHERE w.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    RETURNING id, workspace_id`));
  if (inserted.length) {
    await executor.insert(workspaceSprintEvents).values(inserted.map((row) => ({
      projectId: row.workspace_id,
      sprintId: row.id,
      actorId: input.actorId,
      eventType: "created",
      payload: { name: input.orgSprint.name, status: "planning", source: "org_matching_sprint", orgSprintId: input.orgSprint.id },
    })));
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
  parentSprint: { id: string; name: string; endDate: string; fits: boolean; endedFirst: string | null } | null;
  /** Child projects: an org sprint is running and this project has no active sprint (the empty state). */
  runningOrgSprint: { id: string; name: string; endDate: string } | null;
  /** Orgs: child sprints linked to the selected org sprint, and how many child projects have none. */
  linkedProjects: Array<{ projectId: string; title: string; slug: string | null; sprintId: string; sprintName: string; status: string; done?: number; total?: number }>;
  notLinkedCount: number;
  /** Orgs: the workspaces with no sprint inside the selected one, for Remind (report §37.2). */
  notLinked: Array<{ projectId: string; title: string; slug: string | null }>;
  /** Child projects: group copies in the backlog, offered to a new linked sprint (decision 131). */
  groupBacklog: number;
  /** Child projects: every sprint must sit inside an organization sprint (report §14.3 Phase 4). */
  followsOrgSprints: boolean;
  /** Orgs: the Repeat preview warns past it (report §28.2). */
  termEnd: string | null;
  /** Per sprint of this project: its link and whether it starts automatically. */
  sprintFlags: Record<string, { parentSprintId: string | null; autoStart: boolean; showInChildren: boolean; notifyOnStart: boolean; sharedWith: SprintSharing; sharedWorkspaceIds: string[] }>;
  /** Orgs: the workspaces a sprint can be shared with (live-fix 34). */
  children?: Array<{ id: string; title: string }>;
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
  const shares = flags.length ? await db.select().from(sprintSharedWorkspaces).where(inArray(sprintSharedWorkspaces.sprintId, flags.map((f) => f.id))) : [];
  const sharedIds = (id: string) => shares.filter((r) => r.sprintId === id).map((r) => r.workspaceId);
  const sprintFlags = Object.fromEntries(flags.map((f) => [f.id, { parentSprintId: f.parentSprintId, autoStart: f.autoStart, showInChildren: f.showInChildren, notifyOnStart: f.notifyOnStart,
    sharedWith: !f.showInChildren ? 'none' as const : sharedIds(f.id).length ? 'selected' as const : 'all' as const, sharedWorkspaceIds: sharedIds(f.id) }]));
  const empty: SprintOrgContext = { kind: project.kind === "organization" ? "org" : "child", orgSprints: [], orgTitle: null, orgSlug: null, parentSprint: null, runningOrgSprint: null, linkedProjects: [], notLinkedCount: 0, notLinked: [], groupBacklog: 0, sprintFlags,
    followsOrgSprints: (project.orgSettings as { followOrgSprints?: unknown } | null)?.followOrgSprints === true,
    termEnd: project.termEnd ? String(project.termEnd).slice(0, 10) : null };

  if (project.kind === "organization") {
    const work = readOrgWork(project.orgSettings, project.orgType);
    empty.orgType = project.orgType;
    empty.defaults = { autoStart: work.sprintAutoStart, showInChildren: work.sprintShowInChildren, createMatching: work.sprintCreateMatching, notifyOnStart: work.sprintNotifyOnStart };
    empty.children = await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).where(and(eq(workspaces.parentId, projectId), isNull(workspaces.deletedAt), ne(workspaces.status, "archived"))).orderBy(workspaces.title);
    if (!selectedSprintId) return empty;
    const [linked, children] = await Promise.all([
      // Per-team progress (step 12 gap): the team sprint's tasks, done of all, excused work left out.
      db.select({ projectId: workspaces.id, title: workspaces.title, slug: workspaces.slug, sprintId: workspaceSprints.id, sprintName: workspaceSprints.name, status: workspaceSprints.status,
        done: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.sprint_id = ${workspaceSprints.id} AND t.deleted_at IS NULL AND t.excused_at IS NULL AND t.status = 'done')`,
        total: sql<number>`(SELECT count(*)::int FROM tasks t WHERE t.sprint_id = ${workspaceSprints.id} AND t.deleted_at IS NULL AND t.excused_at IS NULL)` })
        .from(workspaceSprints).innerJoin(workspaces, eq(workspaces.id, workspaceSprints.projectId))
        // Board/review report §6, D3: on a CO's page a team's sprint counts whether it sits in the CO or in one of its sprints.
        .where(and(or(eq(workspaceSprints.parentSprintId, selectedSprintId), sql`${workspaceSprints.parentSprintId} IN (SELECT i.id FROM workspace_sprints i WHERE i.parent_sprint_id = ${selectedSprintId} AND i.workspace_id = ${projectId})`),
          isNull(workspaces.deletedAt), notInArray(workspaceSprints.status, ["cancelled"]))),
      db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(and(eq(workspaces.parentId, projectId), isNull(workspaces.deletedAt), ne(workspaces.status, "archived"))),
    ]);
    const linkedIds = new Set(linked.map((row) => row.projectId));
    // Only workspaces the sprint is shared with count as "not linked yet" (live-fix 34).
    const chosen = sharedIds(selectedSprintId);
    const sharedWithAll = flags.find((f) => f.id === selectedSprintId)?.showInChildren !== false;
    const notLinked = children.filter((c) => sharedWithAll && (chosen.length === 0 || chosen.includes(c.id)) && !linkedIds.has(c.id)).map((c) => ({ projectId: c.id, title: c.title, slug: c.slug }));
    return { ...empty, linkedProjects: linked, notLinkedCount: notLinked.length, notLinked };
  }

  const [org] = await db.select({ title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, project.parentId!)).limit(1);
  const orgSprints = await db
    .select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate, parentSprintId: workspaceSprints.parentSprintId })
    .from(workspaceSprints)
    .where(and(eq(workspaceSprints.projectId, project.parentId!), inArray(workspaceSprints.status, ["planning", "active"]), sprintSharedWithSql(workspaceSprints.id, projectId)))
    .orderBy(workspaceSprints.startDate);
  const selected = flags.find((f) => f.id === selectedSprintId);
  const [own] = selected?.parentSprintId
    ? await db.select({ name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate }).from(workspaceSprints).where(eq(workspaceSprints.id, selected.id)).limit(1)
    : [];
  const [parent] = selected?.parentSprintId
    ? await db.select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate }).from(workspaceSprints).where(eq(workspaceSprints.id, selected.parentSprintId)).limit(1)
    : [];
  // The team's prompt names the class's running main sprint; the picker lists its sprints too, as "CO1 · Week 1".
  // Board/review report §6: named in full ("CO1 · Week 3–4"); a team's sprint may sit in either (D3).
  const running = runningSprint(orgSprints);
  const [backlog] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${projectId} AND assignment_id IS NOT NULL AND sprint_id IS NULL AND deleted_at IS NULL AND status <> 'done'`);
  return {
    ...empty,
    groupBacklog: backlog?.n ?? 0,
    orgTitle: org?.title ?? null,
    orgSlug: org?.slug ?? null,
    orgSprints: orgSprints.map((s) => ({ id: s.id, name: sprintPath(s, orgSprints), status: s.status, startDate: s.startDate.toISOString(), endDate: s.endDate.toISOString() })),
    // "Outside CO1 dates" is worked out on read: dates are never changed automatically (report §15.3).
    // Report §18.2: "CO1 ended. Complete Parser week?" while this one still runs; it never closes by itself.
    parentSprint: parent && own ? { id: parent.id, name: parent.name, endDate: parent.endDate.toISOString(), fits: fitsInside(own, parent), endedFirst: parent.status === "completed" && own.status === "active" ? own.name : null } : null,
    runningOrgSprint: running && !flags.some((f) => f.status === "active") ? { id: running.id, name: sprintPath(running, orgSprints), endDate: running.endDate.toISOString() } : null,
  };
}

export type SprintMaterial = { id: string; kind: "file" | "doc"; title: string; nodeId: string | null; docSlug: string | null; /** Board/review report §6: set when it comes from the CO this sprint sits in. */ fromMain?: string };

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
