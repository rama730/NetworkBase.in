import "server-only";

import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { getWorkspaceAccessById, type WorkspaceAccess } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { profiles, tasks, workspaces, workspaceWorkflows } from "@/lib/db/schema";
import { broadcast } from "@/lib/realtime/server-broadcast";
import { catalogEntry } from "@/lib/workflows/catalog";
import { canChangeWorkflows, effectiveWorkflows, removalSummary, type WorkspaceWorkflows } from "@/lib/workflows/rules";

/** Undo after adding lasts this long, and only while no item of the workflow exists (F1 call 7). */
export const UNDO_SECONDS = 10;


const OFF: WorkspaceWorkflows = { enabled: false, canManage: false, added: [] };

/** Members, viewers and admins see workflow tabs; the public never does (B11). */
const insider = (access: WorkspaceAccess) => access.isOwner || access.isMember || access.isInheritedAdmin;

/** The workflows a viewer sees in a workspace: off unless the workspace's switch is on (call 10). */
export async function readWorkspaceWorkflows(workspaceId: string, viewerId: string | null): Promise<WorkspaceWorkflows> {
  const [ws] = await db.select({ on: workspaces.workflowsEnabled, kind: workspaces.kind, parentId: workspaces.parentId })
    .from(workspaces).where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt))).limit(1);
  if (!ws?.on || ws.kind !== "workspace" || !viewerId) return OFF;
  const access = await getWorkspaceAccessById(workspaceId, viewerId);
  if (!access.canRead || !insider(access)) return OFF;
  const ids = ws.parentId ? [workspaceId, ws.parentId] : [workspaceId];
  const rows = await db.select({
    workspaceId: workspaceWorkflows.workspaceId, workflow: workspaceWorkflows.workflow, pushToChildren: workspaceWorkflows.pushToChildren,
    hiddenAt: workspaceWorkflows.hiddenAt, addedAt: workspaceWorkflows.addedAt, addedBy: profiles.fullName,
  }).from(workspaceWorkflows).leftJoin(profiles, eq(profiles.id, workspaceWorkflows.addedBy)).where(inArray(workspaceWorkflows.workspaceId, ids));
  const own = rows.filter((r) => r.workspaceId === workspaceId);
  const parentRows = rows.filter((r) => r.workspaceId !== workspaceId);
  const [parent] = ws.parentId ? await db.select({ title: workspaces.title }).from(workspaces).where(eq(workspaces.id, ws.parentId)).limit(1) : [];
  const added = effectiveWorkflows(own, parentRows, parent?.title ?? null).map((w) => {
    const row = (w.locked ? parentRows : own).find((r) => r.workflow === w.workflow);
    return { ...w, addedAt: row?.addedAt.toISOString() ?? null, addedBy: w.locked ? null : row?.addedBy ?? null };
  });
  return { enabled: true, canManage: canChangeWorkflows(access), added };
}

async function managerAccess(workspaceId: string, userId: string) {
  const [ws] = await db.select({ on: workspaces.workflowsEnabled, kind: workspaces.kind })
    .from(workspaces).where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt))).limit(1);
  if (!ws) throw new Error("Workspace not found");
  if (!ws.on || ws.kind !== "workspace") throw new Error("Workflows aren’t on in this workspace.");
  const access = await getWorkspaceAccessById(workspaceId, userId);
  if (!canChangeWorkflows(access)) throw new Error("Only owners and admins can add or remove workflows.");
}

function addable(workflow: string) {
  const entry = catalogEntry(workflow);
  if (!entry) throw new Error("Unknown workflow");
  if (!entry.built) throw new Error(`${entry.name} is coming later.`);
  return entry;
}

const announce = (workspaceId: string) => void broadcast([{ topic: `live:workspace:${workspaceId}`, event: "workflows.changed", payload: {} }]);

/** Adds a workflow, or brings a hidden one back with everything it held (S2, W7 step 5). Adding twice is a no-op. */
export async function addWorkflow(workspaceId: string, userId: string, workflow: string) {
  const entry = addable(workflow);
  await managerAccess(workspaceId, userId);
  const [row] = await db.insert(workspaceWorkflows).values({ workspaceId, workflow, addedBy: userId })
    .onConflictDoUpdate({
      target: [workspaceWorkflows.workspaceId, workspaceWorkflows.workflow],
      set: { hiddenAt: null, hiddenBy: null, addedBy: userId, addedAt: sql`now()` },
      setWhere: sql`${workspaceWorkflows.hiddenAt} IS NOT NULL`,
    }).returning({ id: workspaceWorkflows.id });
  if (row) announce(workspaceId);
  return { name: entry.name, alreadyAdded: !row, undoSeconds: UNDO_SECONDS };
}

/** Undo right after adding (W2): only the person who added it, within 10 seconds, while no item of it exists. */
export async function undoAddWorkflow(workspaceId: string, userId: string, workflow: string) {
  const entry = addable(workflow);
  await managerAccess(workspaceId, userId);
  const since = new Date(Date.now() - UNDO_SECONDS * 1000);
  const [row] = await db.select({ id: workspaceWorkflows.id, addedAt: workspaceWorkflows.addedAt }).from(workspaceWorkflows)
    .where(and(eq(workspaceWorkflows.workspaceId, workspaceId), eq(workspaceWorkflows.workflow, workflow), eq(workspaceWorkflows.addedBy, userId),
      isNull(workspaceWorkflows.hiddenAt), gte(workspaceWorkflows.addedAt, since))).limit(1);
  if (!row) throw new Error(`Can’t undo now. Remove ${entry.name} from Settings → Workflows.`);
  if (entry.types.length) {
    const [made] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks)
      .where(and(eq(tasks.projectId, workspaceId), inArray(tasks.itemType, entry.types), gte(tasks.createdAt, row.addedAt), isNull(tasks.deletedAt)));
    if (made && made.n > 0) throw new Error(`Can’t undo: ${made.n} ${made.n === 1 ? "item was" : "items were"} added. Remove ${entry.name} from Settings → Workflows.`);
  }
  await db.delete(workspaceWorkflows).where(eq(workspaceWorkflows.id, row.id));
  announce(workspaceId);
  return { name: entry.name };
}

/** What a workflow holds, for the Remove dialog (S3). */
export async function workflowRemovalCounts(workspaceId: string, userId: string, workflow: string) {
  const entry = catalogEntry(workflow);
  if (!entry) throw new Error("Unknown workflow");
  await managerAccess(workspaceId, userId);
  if (!entry.types.length) return removalSummary([]);
  const items = await db.select({ status: tasks.status, onBoard: tasks.onBoard }).from(tasks)
    .where(and(eq(tasks.projectId, workspaceId), inArray(tasks.itemType, entry.types), isNull(tasks.deletedAt)));
  return removalSummary(items);
}

/** Remove = hide (call 4): the row stays, so adding it again brings everything back. A pushed one can't be removed here. */
export async function hideWorkflow(workspaceId: string, userId: string, workflow: string) {
  const entry = catalogEntry(workflow);
  if (!entry) throw new Error("Unknown workflow");
  await managerAccess(workspaceId, userId);
  const view = await readWorkspaceWorkflows(workspaceId, userId);
  const shown = view.added.find((w) => w.workflow === workflow);
  if (!shown) throw new Error(`${entry.name} isn’t added here.`);
  if (shown.locked) throw new Error(`Only ${shown.by ?? "the organization"} can remove ${entry.name}.`);
  const counts = await workflowRemovalCounts(workspaceId, userId, workflow);
  await db.update(workspaceWorkflows).set({ hiddenAt: sql`now()`, hiddenBy: userId })
    .where(and(eq(workspaceWorkflows.workspaceId, workspaceId), eq(workspaceWorkflows.workflow, workflow), isNull(workspaceWorkflows.hiddenAt)));
  announce(workspaceId);
  return { name: entry.name, ...counts };
}
