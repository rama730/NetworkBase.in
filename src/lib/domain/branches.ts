import "server-only";
/**
 * Branches (report Part H, phase H-2). Main stays materialised in workspace_nodes; a branch is main as it was at its
 * base save plus its own files (branch_files: only paths that differ). Saves on a branch go through one writer that
 * locks the branch row; update from main merges three ways and moves the base.
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueNotificationFanout } from "@/lib/notifications/fanout";
import { broadcast } from "@/lib/realtime/server-broadcast";
import { branchFiles, branches, changeSetItems, changeSets, profiles, saves, tasks } from "@/lib/db/schema";
import { branchNameProblem } from "@/lib/branches/names";
import { labelScope } from "@/lib/agents/via-scope";
import { visibleVia } from "@/lib/agents/via-visibility";
import { ChangeSetError, diffAssets, isTextual, normalizeChangePath, readAsset, storeWorkspaceBytes, type Actor, type ChangeSet, type ItemDiff } from "@/lib/domain/change-sets";
import { scanForSecrets } from "@/lib/security/secret-scan";
import { formerMembers, mainBranch, mainTreeCte, memberAccess, readOnlyWhy, SAVE_LIMITS } from "@/lib/domain/saves";
import { isMergeableText, merge3 } from "../../../packages/nb-cli/lib/sync/merge3.mjs";

const fail = (message: string, status: number, code: string, details?: Record<string, unknown>): never => {
  throw new ChangeSetError(message, status, code, details);
};
const userOf = (actor: Actor) => actor.user?.id ?? fail("Sign in to continue", 401, "UNAUTHORIZED");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BRANCH_LIMITS = { active: 500, perAgent: 10, restoreDays: 30, staleDays: 30, mergedDays: 7, staleNoteDays: 90, branchRevision: 1_000_000 };

export type Branch = typeof branches.$inferSelect;
/** One file as a branch (or main) has it. `own`: the branch's own, not main's. `revision`: what the CLI compares. */
export type TreeEntry = {
  path: string; own: boolean; nodeId: string | null; version: number | null; contentHash: string | null; assetId: string | null;
  storageKey: string | null; size: number | null; mimeType: string | null; executable: boolean | null; revision: number;
};
type State = { hash: string | null; assetId: string | null; size: number | null; mimeType: string | null; executable: boolean | null } | null;

// ── Finding and access ────────────────────────────────────────────────────────────────────────────────────────────

export const seqOf = async (saveId: string | null) => (saveId ? (await db.select({ seq: saves.seq }).from(saves).where(eq(saves.id, saveId)).limit(1))[0]?.seq ?? 0 : 0);

/**
 * A branch by id or by name (any letter case) in a workspace; "main" is main. The workspace's people only: anyone else
 * gets the same "not found" whatever exists (no probing names or states).
 */
export async function findBranch(actor: Actor, workspaceId: string, ref: string) {
  await memberAccess(actor, workspaceId);
  const main = await mainBranch(workspaceId);
  const value = String(ref ?? "").trim();
  if (!value || value.toLowerCase() === "main") return (await db.select().from(branches).where(eq(branches.id, main.id)))[0]!;
  const [row] = await db.select().from(branches).where(and(eq(branches.workspaceId, workspaceId), UUID.test(value) ? eq(branches.id, value) : sql`lower(${branches.name}) = lower(${value})`))
    .orderBy(sql`${branches.status} = 'deleted'`, desc(branches.updatedAt)).limit(1);
  if (row) return row;
  // A renamed branch's old name still finds it for 30 days (H26): old links and folders keep working.
  const [renamed] = UUID.test(value) ? [] : await db.select().from(branches).where(and(eq(branches.workspaceId, workspaceId), sql`lower(${branches.previousName}) = lower(${value})`,
    sql`${branches.renamedAt} > now() - make_interval(days => ${BRANCH_LIMITS.restoreDays})`)).orderBy(desc(branches.renamedAt)).limit(1);
  if (!renamed) fail(`No branch ${value} here`, 404, "BRANCH_NOT_FOUND");
  return renamed!;
}

/** The branch, checked: the workspace's people only (H26), writers for changes. */
export async function loadBranch(actor: Actor, branchId: string, opts: { write?: boolean } = {}) {
  if (!UUID.test(branchId)) fail("Branch not found", 404, "BRANCH_NOT_FOUND");
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!branch) fail("Branch not found", 404, "BRANCH_NOT_FOUND");
  const who = await memberAccess(actor, branch!.workspaceId);
  const main = await mainBranch(branch!.workspaceId);
  if (opts.write && !who.canWrite) fail(readOnlyWhy(who), 403, "FORBIDDEN");
  return { branch: branch!, main, ...who };
}

function mayManage(actor: Actor, branch: Branch, isAdmin: boolean) {
  if (branch.isDefault) fail("Main can't be renamed or deleted", 409, "MAIN_BRANCH");
  // Agents rename and delete only branches their person made; never someone else's (H15).
  if (branch.createdBy !== userOf(actor) && (!isAdmin || actor.tokenKind === "agent")) fail("Only its creator, or a workspace owner or admin, can do that", 403, "FORBIDDEN");
}

// ── Reading (H2, H11) ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The files of a branch now (H11): main at the branch's base save, with the branch's own files over it, paths marked
 * deleted hidden. Main itself reads main at its head. Paged by path (5,000), or just `paths`.
 */
export async function branchTree(branch: Branch, mainId: string, opts: { cursor?: string | null; path?: string | null; paths?: string[]; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? SAVE_LIMITS.files, SAVE_LIMITS.files);
  const baseSeq = await seqOf(branch.isDefault ? branch.headSaveId : branch.baseSaveId);
  const ownId = branch.isDefault ? null : branch.id;
  const only = opts.paths?.length ? sql`AND coalesce(bf.path, t.path) IN (${sql.join(opts.paths.map((p) => sql`${p}`), sql`, `)})` : sql``;
  const rows = Array.from(await db.execute<{ path: string; own: boolean; node_id: string | null; version: number | null; content_hash: string | null; asset_id: string | null; storage_key: string | null; size: string | null; mime_type: string | null; executable: boolean | null; updated_seq: string | null }>(sql`
    WITH ${mainTreeCte(mainId, baseSeq)}, bf AS (SELECT * FROM branch_files WHERE branch_id = ${ownId})
    SELECT coalesce(bf.path, t.path) AS path, bf.path IS NOT NULL AS own, CASE WHEN bf.path IS NULL THEN t.node_id END AS node_id,
      CASE WHEN bf.path IS NULL THEN t.version END AS version,
      CASE WHEN bf.path IS NULL THEN v.content_hash ELSE bf.content_hash END AS content_hash,
      CASE WHEN bf.path IS NULL THEN v.asset_id ELSE bf.asset_id END AS asset_id,
      CASE WHEN bf.path IS NULL THEN v.s3_key ELSE a.storage_key END AS storage_key,
      (CASE WHEN bf.path IS NULL THEN v.size ELSE bf.size END)::text AS size,
      CASE WHEN bf.path IS NULL THEN v.mime_type ELSE bf.mime_type END AS mime_type,
      bf.executable, us.seq::text AS updated_seq
    FROM tree t FULL JOIN bf ON bf.path = t.path
    LEFT JOIN file_versions v ON bf.path IS NULL AND v.node_id = t.node_id AND v.version = t.version
    LEFT JOIN storage_assets a ON a.id = bf.asset_id
    LEFT JOIN saves us ON us.id = bf.updated_save_id
    WHERE coalesce(bf.state, 'present') = 'present'
      AND (${opts.cursor ?? null}::text IS NULL OR coalesce(bf.path, t.path) COLLATE "C" > ${opts.cursor ?? null}::text COLLATE "C")
      AND (${opts.path ?? null}::text IS NULL OR coalesce(bf.path, t.path) = ${opts.path ?? null}::text OR starts_with(coalesce(bf.path, t.path), ${opts.path ?? null}::text || '/'))
      ${only}
    ORDER BY coalesce(bf.path, t.path) COLLATE "C" LIMIT ${limit + 1}`));
  const files = rows.slice(0, limit).map((r): TreeEntry => ({
    path: r.path, own: r.own, nodeId: r.node_id, version: r.version, contentHash: r.content_hash?.toLowerCase() ?? null, assetId: r.asset_id, storageKey: r.storage_key,
    size: r.size == null ? null : Number(r.size), mimeType: r.mime_type, executable: r.executable,
    revision: r.own ? BRANCH_LIMITS.branchRevision + Number(r.updated_seq ?? 0) : r.version ?? 0,
  }));
  return { files, nextCursor: rows.length > limit ? files.at(-1)!.path : null };
}

/** Main's files at a save number, for some paths: a branch's base, or main before and after an update. */
export async function mainAt(mainId: string, seq: number, paths: string[]) {
  const out = new Map<string, TreeEntry>();
  for (let i = 0; i < paths.length; i += 500) {
    const rows = Array.from(await db.execute<{ path: string; node_id: string; version: number; content_hash: string | null; asset_id: string | null; s3_key: string | null; size: string | null; mime_type: string | null }>(sql`
      WITH ${mainTreeCte(mainId, seq)}
      SELECT t.path, t.node_id, t.version, v.content_hash, v.asset_id, v.s3_key, v.size::text, v.mime_type
      FROM tree t LEFT JOIN file_versions v ON v.node_id = t.node_id AND v.version = t.version
      WHERE t.path IN (${sql.join(paths.slice(i, i + 500).map((p) => sql`${p}`), sql`, `)})`));
    for (const r of rows) out.set(r.path, { path: r.path, own: false, nodeId: r.node_id, version: r.version, contentHash: r.content_hash?.toLowerCase() ?? null, assetId: r.asset_id, storageKey: r.s3_key, size: r.size == null ? null : Number(r.size), mimeType: r.mime_type, executable: null, revision: r.version });
  }
  return out;
}

const stateOf = (f: TreeEntry | undefined): State => (f ? { hash: f.contentHash, assetId: f.assetId, size: f.size, mimeType: f.mimeType, executable: f.executable } : null);
const same = (a: State, b: State) => (a == null || b == null ? a === b : a.hash != null && a.hash === b.hash && Boolean(a.executable) === Boolean(b.executable));

export type BranchView = {
  id: string; name: string; isDefault: boolean; status: string;
  createdBy: { id: string; name: string | null; username: string | null; avatarUrl?: string | null; former?: boolean } | null;
  task: { id: string; number: number | null } | null;
  ahead: number; behind: number; changedFiles: number; stale: boolean;
  lastSave: { id: string; number: number; message: string; createdAt: string; madeWith: string | null } | null;
  /** Its open merge request into main (H-3), shown as "MR !3". */
  mergeRequest: { number: number; state: string } | null;
  createdAt: string; updatedAt: string; deletedAt: string | null;
};

/** Branches with ahead, behind and their last save (H2): main first, then the most recently worked on. */
export async function listBranches(actor: Actor, workspaceId: string, opts: { status?: string | null; mine?: boolean } = {}) {
  await memberAccess(actor, workspaceId);
  const main = await mainBranch(workspaceId);
  const viewer = userOf(actor);
  const status = opts.status ?? "active";
  const where = [eq(branches.workspaceId, workspaceId)];
  if (status === "active" || status === "stale") where.push(eq(branches.status, "active"));
  else if (status === "merged" || status === "deleted") where.push(eq(branches.status, status));
  if (status === "deleted") where.push(sql`${branches.deletedAt} > now() - make_interval(days => ${BRANCH_LIMITS.restoreDays})`);
  if (opts.mine) where.push(eq(branches.createdBy, viewer));
  const rows = await db.select().from(branches).where(and(...where)).orderBy(desc(branches.isDefault), desc(branches.updatedAt)).limit(BRANCH_LIMITS.active + 1);
  const views = await viewsOf(viewer, workspaceId, main.headSaveId, rows);
  return { branches: status === "stale" ? views.filter((b) => b.stale) : views };
}

async function viewsOf(viewerId: string, workspaceId: string, mainHead: string | null, rows: Branch[]): Promise<BranchView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const mainSeq = await seqOf(mainHead);
  const stats = Array.from(await db.execute<{ id: string; ahead: number; changed: number; merged_seq: string | null }>(sql`
    SELECT b.id,
      (SELECT count(*) FROM saves s WHERE s.branch_id = b.id AND s.kind NOT IN ('start', 'merge'))::int AS ahead,
      (SELECT count(*) FROM branch_files f WHERE f.branch_id = b.id)::int AS changed,
      (SELECT seq FROM saves WHERE id = b.merged_from_target_save_id)::text AS merged_seq
    FROM branches b WHERE b.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`));
  const heads = rows.flatMap((r) => (r.headSaveId ? [r.headSaveId] : []));
  const last = heads.length ? await db.select().from(saves).where(inArray(saves.id, heads)) : [];
  const people = [...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))];
  const former = await formerMembers(workspaceId, people);
  const who = (people.length ? await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl }).from(profiles).where(inArray(profiles.id, people)) : [])
    .map((p) => (former.has(p.id) ? { ...p, former: true } : p));
  const taskIds = [...new Set(rows.flatMap((r) => (r.taskId ? [r.taskId] : [])))];
  const taskRows = taskIds.length ? await db.select({ id: tasks.id, number: tasks.taskNumber }).from(tasks).where(inArray(tasks.id, taskIds)) : [];
  const scope = await labelScope(viewerId, workspaceId);
  const open = await (await import("@/lib/domain/merge-requests")).openMergeRequestsOf(ids);
  const staleBefore = Date.now() - BRANCH_LIMITS.staleDays * 86_400_000;
  return rows.map((r) => {
    const s = stats.find((x) => x.id === r.id);
    const head = last.find((x) => x.id === r.headSaveId);
    const shown = head ? visibleVia(scope, { via: head.via, agentName: head.agentName, authorId: head.authorId }) : null;
    const task = taskRows.find((t) => t.id === r.taskId);
    const activity = (head?.createdAt ?? r.createdAt).getTime();
    return {
      id: r.id, name: r.name, isDefault: r.isDefault, status: r.status,
      createdBy: who.find((p) => p.id === r.createdBy) ?? null,
      task: task ? { id: task.id, number: task.number ?? null } : null,
      ahead: r.isDefault ? 0 : s?.ahead ?? 0,
      behind: r.isDefault ? 0 : Math.max(0, mainSeq - Number(s?.merged_seq ?? 0)),
      changedFiles: r.isDefault ? 0 : s?.changed ?? 0,
      stale: !r.isDefault && r.status === "active" && activity < staleBefore,
      mergeRequest: open.get(r.id) ?? null,
      lastSave: head ? { id: head.id, number: head.seq ?? 0, message: head.message ?? "", createdAt: head.createdAt.toISOString(), madeWith: shown?.via === "agent" ? `with ${shown.agentName ?? "an agent"}` : shown?.via === "cli" ? "from the terminal" : null } : null,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), deletedAt: r.deletedAt?.toISOString() ?? null,
    };
  });
}

export async function getBranch(actor: Actor, branchId: string) {
  const { branch, main } = await loadBranch(actor, branchId);
  const [view] = await viewsOf(userOf(actor), branch.workspaceId, main.headSaveId, [branch]);
  return { branch: view!, workspaceId: branch.workspaceId };
}

// ── Creating, renaming, deleting (H2) ─────────────────────────────────────────────────────────────────────────────

/** A new branch from main (as it is now) or from another branch (with its files), optionally for a task. */
export async function createBranch(actor: Actor, workspaceId: string, input: { name: string; from?: string | null; taskId?: string | null }) {
  const userId = userOf(actor);
  const who = await memberAccess(actor, workspaceId);
  if (!who.canWrite) fail(readOnlyWhy(who), 403, "FORBIDDEN");
  const main = await mainBranch(workspaceId);
  const name = String(input.name ?? "").trim();
  const problem = branchNameProblem(name);
  if (problem) fail(problem, 400, "BAD_BRANCH_NAME");
  const source = input.from && input.from.toLowerCase() !== "main" ? await findBranch(actor, workspaceId, input.from) : null;
  if (source && source.status !== "active") fail(`${source.name} was ${source.status}; restore it first`, 409, "BRANCH_DELETED");
  if (input.taskId) {
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, workspaceId))).limit(1);
    if (!task) fail("That task isn't in this workspace", 404, "NOT_FOUND");
  }
  try {
    return await db.transaction(async (tx) => {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(branches).where(and(eq(branches.workspaceId, workspaceId), eq(branches.status, "active"), eq(branches.isDefault, false)));
      if (n >= BRANCH_LIMITS.active) fail(`A workspace has at most ${BRANCH_LIMITS.active} active branches; delete merged or stale ones first`, 409, "BRANCH_LIMIT");
      // One agent sign-in works on at most 10 active branches here (H15): the ones its change sets went to.
      if (actor.tokenKind === "agent" && actor.extensionSessionId) {
        const [{ mine } = { mine: 0 }] = Array.from(await tx.execute<{ mine: number }>(sql`
          SELECT count(DISTINCT cs.branch_id)::int AS mine FROM change_sets cs JOIN branches b ON b.id = cs.branch_id
          WHERE cs.agent_session_id = ${actor.extensionSessionId} AND cs.workspace_id = ${workspaceId} AND b.status = 'active'`));
        if (mine >= BRANCH_LIMITS.perAgent) fail(`An agent sign-in works on at most ${BRANCH_LIMITS.perAgent} branches here; merge or delete some first`, 409, "BRANCH_LIMIT");
      }
      const base = source ? source.baseSaveId : main.headSaveId;
      const [made] = await tx.insert(branches).values({
        workspaceId, name, isDefault: false, baseSaveId: base, mergedFromTargetSaveId: source ? source.mergedFromTargetSaveId : base,
        sourceBranchId: source?.id ?? null, taskId: input.taskId ?? source?.taskId ?? null, createdBy: userId,
      }).returning();
      if (source) {
        await tx.execute(sql`INSERT INTO branch_files (branch_id, path, state, content_hash, asset_id, size, mime_type, executable)
          SELECT ${made!.id}, path, state, content_hash, asset_id, size, mime_type, executable FROM branch_files WHERE branch_id = ${source.id}`);
      }
      return made!;
    }).then(async (made) => ({ branch: (await viewsOf(userId, workspaceId, main.headSaveId, [made]))[0]! }));
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505") fail(`A branch named ${name} already exists`, 409, "BRANCH_EXISTS");
    throw error;
  }
}

export async function renameBranch(actor: Actor, branchId: string, rawName: string) {
  const { branch, isAdmin } = await loadBranch(actor, branchId, { write: true });
  mayManage(actor, branch, isAdmin);
  const name = String(rawName ?? "").trim();
  const problem = branchNameProblem(name);
  if (problem) fail(problem, 400, "BAD_BRANCH_NAME");
  try {
    // The old name keeps working for 30 days (H26); the GitHub link is by github_branch, so it stays (H24).
    if (name !== branch.name) await db.update(branches).set({ name, previousName: branch.name, renamedAt: new Date(), updatedAt: new Date() }).where(eq(branches.id, branch.id));
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505") fail(`A branch named ${name} already exists`, 409, "BRANCH_EXISTS");
    throw error;
  }
  return getBranch(actor, branch.id);
}

/** Deleted branches can be restored for 30 days (H2); open change sets on it are discarded. */
export async function deleteBranch(actor: Actor, branchId: string) {
  const { branch, isAdmin } = await loadBranch(actor, branchId, { write: true });
  mayManage(actor, branch, isAdmin);
  if (branch.status === "deleted") return { deleted: true };
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(branches).set({ status: "deleted", deletedAt: now, updatedAt: now }).where(eq(branches.id, branch.id));
    await tx.update(changeSets).set({ status: "discarded", discardedAt: now, updatedAt: now }).where(and(eq(changeSets.branchId, branch.id), inArray(changeSets.status, ["open", "ready"])));
  });
  // Its open merge requests close ("Branch deleted"); restoring it reopens them (H24).
  await (await import("@/lib/domain/merge-requests")).closeForDeletedBranch(branch.id, userOf(actor), now);
  const [{ ahead } = { ahead: 0 }] = await db.select({ ahead: sql<number>`count(*)::int` }).from(saves).where(and(eq(saves.branchId, branch.id), sql`${saves.kind} NOT IN ('start', 'merge')`));
  return { deleted: true, savesNotInMain: branch.status === "merged" ? 0 : ahead, restoreUntil: new Date(now.getTime() + BRANCH_LIMITS.restoreDays * 86_400_000).toISOString() };
}

export async function restoreBranch(actor: Actor, branchId: string) {
  const { branch, isAdmin } = await loadBranch(actor, branchId, { write: true });
  mayManage(actor, branch, isAdmin);
  if (branch.status !== "deleted") return getBranch(actor, branch.id);
  if (!branch.deletedAt || branch.deletedAt.getTime() < Date.now() - BRANCH_LIMITS.restoreDays * 86_400_000) fail("Deleted branches can be restored for 30 days", 410, "BRANCH_GONE");
  try {
    // A branch that was merged before it was deleted comes back merged, not open for more saves (design audit F3).
    const [merged] = await db.execute<{ one: number }>(sql`SELECT 1 AS one FROM merge_requests WHERE source_branch_id = ${branch.id} AND state = 'merged' LIMIT 1`).then((r) => Array.from(r));
    await db.update(branches).set({ status: merged ? "merged" : "active", deletedAt: null, updatedAt: new Date() }).where(eq(branches.id, branch.id));
  } catch (error) {
    if ((error as { code?: string })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505") fail(`Another branch is called ${branch.name} now; rename that one first`, 409, "BRANCH_EXISTS");
    throw error;
  }
  await (await import("@/lib/domain/merge-requests")).reopenForRestoredBranch(branch.id, userOf(actor), branch.deletedAt).catch(() => 0);
  return getBranch(actor, branch.id);
}

// ── The branch writer (H12, H26) ──────────────────────────────────────────────────────────────────────────────────

export type BranchChange = { op: "add" | "change" | "delete" | "rename"; path: string; fromPath?: string | null; contentHash?: string | null; assetId?: string | null; size?: number | null; mimeType?: string | null; executable?: boolean | null };
type WriteInput = {
  changes: BranchChange[]; expectedHead?: string | null; kind?: "save" | "merge" | "revert" | "sync"; message: string; authorId: string;
  via?: string | null; agentName?: string | null; taskId?: string | null; changeSetId?: string | null; revertsSaveId?: string | null;
  /** Update from main: the branch moves onto this main save (its new base and merge base). */
  rebase?: { saveId: string; seq: number } | null;
};

/**
 * One save on a branch, all or nothing. Locks the branch row and refuses a head that moved (BRANCH_MOVED, H26); keeps
 * only paths that differ from the base in branch_files; records the save and its changes.
 */
export async function writeBranch(branchId: string, input: WriteInput) {
  const done = await writeBranchTx(branchId, input);
  if (done.save) {
    if ((input.kind ?? "save") !== "merge") void notifyBranchWatchers(done.branch, done.save, input.authorId);
    // Open tabs on this branch refresh (H8, H26 events: ids only, clients refetch what they may see).
    void broadcast([{ topic: `live:files:${done.branch.workspaceId}`, event: "branch.updated", payload: { branchId: done.branch.id } }]);
  }
  return done;
}

/**
 * Saves on a branch tell its watchers (H8, H24): whoever made it and whoever saved on it, never the saver. An agent
 * saving every few seconds makes one notification per watcher per 15 minutes, counted up (aggregate per window).
 */
async function notifyBranchWatchers(branch: Branch, save: typeof saves.$inferSelect, authorId: string) {
  try {
    const rows = Array.from(await db.execute<{ id: string }>(sql`
      SELECT DISTINCT u.id FROM (SELECT ${branch.createdBy}::uuid AS id UNION SELECT author_id FROM saves WHERE branch_id = ${branch.id} AND author_id IS NOT NULL) u
      WHERE u.id IS NOT NULL AND u.id <> ${authorId}::uuid
        -- Only people still in the workspace hear about its branches.
        AND (u.id = (SELECT owner_id FROM workspaces WHERE id = ${branch.workspaceId})
          OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${branch.workspaceId} AND m.user_id = u.id))
      LIMIT 50`));
    if (!rows.length) return;
    const [who] = await db.select({ name: profiles.fullName, username: profiles.username }).from(profiles).where(eq(profiles.id, authorId)).limit(1);
    const person = who?.name ?? (who?.username ? `@${who.username}` : "Someone");
    const name = save.via === "agent" ? `${person}'s ${save.agentName ?? "agent"}` : person;
    const window = Math.floor(Date.now() / (15 * 60_000));
    await enqueueNotificationFanout({
      source: "branch-saves",
      writes: rows.map((r) => ({
        operation: "aggregate" as const,
        input: {
          recipientUserId: r.id, actorUserId: authorId, kind: "branch_saves" as const, category: "workflows" as const, importance: "more" as const,
          title: `${name} saved on ${branch.name}`.slice(0, 200), body: (save.message ?? "").slice(0, 200),
          href: `/workspaces/${branch.workspaceId}?tab=files&filesView=history&branch=${encodeURIComponent(branch.name)}`,
          entityRefs: { projectId: branch.workspaceId },
          dedupeKey: `branch-saves:${branch.id}:${window}`,
          sourceEventId: save.id,
        },
      })),
    });
  } catch (error) {
    // A notification never undoes a save.
    logger.warn("branches.notify_failed", { module: "branches", error: error instanceof Error ? error.message : String(error) });
  }
}

async function writeBranchTx(branchId: string, input: WriteInput) {
  return db.transaction(async (tx) => {
    const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId)).for("update");
    if (!branch || branch.isDefault) fail("Branch not found", 404, "BRANCH_NOT_FOUND");
    if (branch!.status !== "active") fail(branch!.status === "merged" ? "This branch was merged into main; start a new branch for more work" : "This branch was deleted; restore it first", 409, "BRANCH_DELETED");
    if (input.expectedHead !== undefined && (input.expectedHead ?? null) !== (branch!.headSaveId ?? null)) {
      fail("The branch moved since this change started; update and try again", 409, "BRANCH_MOVED", { head: branch!.headSaveId });
    }
    const main = await mainBranch(branch!.workspaceId);
    const touched = [...new Set(input.changes.flatMap((c) => [c.path, ...(c.fromPath ? [c.fromPath] : [])]))];
    const current = new Map((await branchTree(branch!, main.id, { paths: touched })).files.map((f) => [f.path, stateOf(f)]));
    const baseSeq = input.rebase ? input.rebase.seq : await seqOf(branch!.baseSaveId);
    const base = new Map([...(await mainAt(main.id, baseSeq, touched))].map(([p, f]) => [p, stateOf(f)]));
    const after = new Map<string, State>(touched.map((p) => [p, current.get(p) ?? null]));
    const renames = new Map<string, string>();
    for (const c of input.changes) {
      const content: State = c.contentHash ? { hash: c.contentHash.toLowerCase(), assetId: c.assetId ?? null, size: c.size ?? null, mimeType: c.mimeType ?? null, executable: c.executable ?? null } : null;
      if (c.op === "delete") after.set(c.path, null);
      else if (c.op === "rename") {
        const moved = after.get(c.fromPath!) ?? fail(`${c.fromPath} isn't on this branch`, 404, "NOT_FOUND");
        after.set(c.fromPath!, null);
        after.set(c.path, content ?? moved);
        renames.set(c.path, c.fromPath!);
      } else after.set(c.path, content ?? fail(`${c.path} needs its content`, 400, "BAD_REQUEST"));
    }
    // What changed, path by path (a rename is one row).
    const rows: Array<{ before: string | null; afterPath: string | null; was: State; now: State }> = [];
    const done = new Set<string>();
    for (const [to, from] of renames) {
      done.add(to); done.add(from);
      rows.push({ before: from, afterPath: to, was: current.get(from) ?? null, now: after.get(to) ?? null });
    }
    for (const p of touched) {
      if (done.has(p)) continue;
      const was = current.get(p) ?? null;
      const now = after.get(p) ?? null;
      if (same(was, now)) continue;
      rows.push({ before: was ? p : null, afterPath: now ? p : null, was, now });
    }
    if (!rows.length && !input.rebase) return { save: null, branch: branch! };
    const head = await seqOf(branch!.headSaveId);
    const count = (op: string) => rows.filter((r) => (op === "add" ? !r.before : op === "delete" ? !r.afterPath : op === "rename" ? r.before && r.afterPath && r.before !== r.afterPath : r.before && r.afterPath && r.before === r.afterPath)).length;
    const [save] = await tx.insert(saves).values({
      workspaceId: branch!.workspaceId, branchId: branch!.id, seq: head + 1, parentSaveId: branch!.headSaveId,
      secondParentSaveId: input.rebase?.saveId ?? null, kind: input.kind ?? "save", message: input.message.slice(0, 2000), authorId: input.authorId,
      via: (input.via as "cli" | "agent" | null) ?? null, agentName: input.agentName ?? null, taskId: input.taskId ?? null, changeSetId: input.changeSetId ?? null,
      revertsSaveId: input.revertsSaveId ?? null, filesAdded: count("add"), filesChanged: count("change"), filesDeleted: count("delete"), filesRenamed: count("rename"),
    }).returning();
    for (let i = 0; i < rows.length; i += 500) {
      await tx.execute(sql`INSERT INTO save_changes (save_id, workspace_id, before_path, after_path, previous_content_hash, content_hash, asset_id, size, mime_type) VALUES ${sql.join(rows.slice(i, i + 500).map((r) =>
        sql`(${save!.id}, ${branch!.workspaceId}, ${r.before}, ${r.afterPath}, ${r.was?.hash ?? null}, ${r.now?.hash ?? null}, ${r.now?.assetId ?? r.was?.assetId ?? null}, ${r.now?.size ?? null}, ${r.now?.mimeType ?? r.was?.mimeType ?? null})`), sql`, `)}`);
    }
    // branch_files: only what differs from the base.
    for (const p of touched) {
      const now = after.get(p) ?? null;
      const was = base.get(p) ?? null;
      if (same(now, was)) {
        await tx.delete(branchFiles).where(and(eq(branchFiles.branchId, branch!.id), eq(branchFiles.path, p)));
        continue;
      }
      const values = now
        ? { state: "present" as const, contentHash: now.hash, assetId: now.assetId, size: now.size, mimeType: now.mimeType, executable: now.executable, updatedSaveId: save!.id }
        : { state: "deleted" as const, contentHash: null, assetId: null, size: null, mimeType: null, executable: null, updatedSaveId: save!.id };
      await tx.insert(branchFiles).values({ branchId: branch!.id, path: p, ...values }).onConflictDoUpdate({ target: [branchFiles.branchId, branchFiles.path], set: values });
    }
    await tx.update(branches).set({
      headSaveId: save!.id, updatedAt: new Date(),
      ...(input.rebase ? { baseSaveId: input.rebase.saveId, mergedFromTargetSaveId: input.rebase.saveId } : {}),
    }).where(eq(branches.id, branch!.id));
    return { save: save!, branch: branch! };
  });
}

// ── Update from main (H2, H13) ────────────────────────────────────────────────────────────────────────────────────

export type UpdateConflict = { path: string; kind: "edit" | "deleted_on_branch" | "deleted_on_main" | "binary" };

/**
 * Brings main's newer work into a branch: paths only main changed come with the moved base; paths both changed merge
 * text three ways; the rest are conflicts, settled with `resolutions` ("branch" keeps the branch's, "main" takes main's).
 */
export async function updateFromMain(actor: Actor, branchId: string, opts: { resolutions?: Record<string, "branch" | "main"> } = {}) {
  const userId = userOf(actor);
  const { branch, main } = await loadBranch(actor, branchId, { write: true });
  if (branch.isDefault) fail("Main is main; update a branch from it", 409, "MAIN_BRANCH");
  if (branch.status !== "active") fail(branch.status === "merged" ? "This branch was merged into main; start a new branch for more work" : "This branch was deleted; restore it first", 409, "BRANCH_DELETED");
  const from = await seqOf(branch.mergedFromTargetSaveId);
  const headId = main.headSaveId!;
  const to = await seqOf(headId);
  if (to <= from) return { upToDate: true, save: null, conflicts: [] as UpdateConflict[] };
  const changed = Array.from(await db.execute<{ path: string }>(sql`
    SELECT DISTINCT p AS path FROM saves s JOIN save_changes c ON c.save_id = s.id, LATERAL (VALUES (c.before_path), (c.after_path)) v(p)
    WHERE s.branch_id = ${main.id} AND s.seq > ${from} AND s.seq <= ${to} AND c.op <> 'none' AND p IS NOT NULL`)).map((r) => r.path);
  const before = await mainAt(main.id, from, changed);
  const now = await mainAt(main.id, to, changed);
  const own = new Map((changed.length ? await db.select().from(branchFiles).where(and(eq(branchFiles.branchId, branch.id), inArray(branchFiles.path, changed))) : []).map((f) => [f.path, f]));
  const changes: BranchChange[] = [];
  const conflicts: UpdateConflict[] = [];
  const take = (p: string) => {
    const theirs = now.get(p);
    changes.push(theirs ? { op: "change", path: p, contentHash: theirs.contentHash, assetId: theirs.assetId, size: theirs.size, mimeType: theirs.mimeType } : { op: "delete", path: p });
  };
  for (const p of changed) {
    const was = stateOf(before.get(p));
    const theirs = stateOf(now.get(p));
    if (same(was, theirs)) continue;
    const mine = own.get(p);
    if (!mine) { take(p); continue; }
    const ours: State = mine.state === "deleted" ? null : { hash: mine.contentHash, assetId: mine.assetId, size: mine.size, mimeType: mine.mimeType, executable: mine.executable };
    const choice = opts.resolutions?.[p];
    if (same(ours, theirs) || choice === "main") { take(p); continue; }
    if (choice === "branch") continue;
    if (!ours || !theirs || !was) { conflicts.push({ path: p, kind: !ours ? "deleted_on_branch" : !theirs ? "deleted_on_main" : "edit" }); continue; }
    const [b, o, t] = await Promise.all([readAsset(was.assetId), readAsset(ours.assetId), readAsset(theirs.assetId)]);
    if (!b || !o || !t || ![b, o, t].every((x) => isMergeableText(x))) { conflicts.push({ path: p, kind: "binary" }); continue; }
    const merged = merge3(b.toString("utf8"), t.toString("utf8"), o.toString("utf8"));
    if (!merged.ok) { conflicts.push({ path: p, kind: "edit" }); continue; }
    const bytes = Buffer.from(merged.text, "utf8");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const assetId = await storeWorkspaceBytes(branch.workspaceId, userId, hash, bytes, ours.mimeType, { branchId: branch.id, source: "branch_update" });
    changes.push({ op: "change", path: p, contentHash: hash, assetId, size: bytes.byteLength, mimeType: ours.mimeType, executable: ours.executable });
  }
  if (conflicts.length) return { upToDate: false, save: null, conflicts };
  const { save } = await writeBranch(branch.id, {
    changes, expectedHead: branch.headSaveId, kind: "merge", message: "Updated from main", authorId: userId, rebase: { saveId: headId, seq: to },
    via: actor.tokenKind === "agent" ? "agent" : null,
  });
  return { upToDate: false, save: save ? { id: save.id, number: save.seq } : null, conflicts };
}

// ── Changes against main (H2) ─────────────────────────────────────────────────────────────────────────────────────

/** The branch's own files against its base on main: what it adds, changes and deletes. */
export async function branchChanges(actor: Actor, branchId: string) {
  const { branch, main } = await loadBranch(actor, branchId);
  const own = await db.select().from(branchFiles).where(eq(branchFiles.branchId, branch.id)).orderBy(asc(sql`${branchFiles.path} COLLATE "C"`)).limit(SAVE_LIMITS.changes + 1);
  const base = await mainAt(main.id, await seqOf(branch.baseSaveId), own.map((f) => f.path));
  return {
    files: own.slice(0, SAVE_LIMITS.changes).map((f) => ({ path: f.path, op: f.state === "deleted" ? "delete" : base.has(f.path) ? "change" : "add", size: f.size == null ? null : Number(f.size) })),
    truncated: own.length > SAVE_LIMITS.changes,
  };
}

export async function branchFileDiff(actor: Actor, branchId: string, rawPath: string): Promise<ItemDiff> {
  const { branch, main } = await loadBranch(actor, branchId);
  const path = `/${String(rawPath ?? "").split("/").filter(Boolean).join("/")}`;
  const [mine] = await db.select().from(branchFiles).where(and(eq(branchFiles.branchId, branch.id), eq(branchFiles.path, path))).limit(1);
  if (!mine) fail("That file is the same as on main", 404, "NOT_FOUND");
  const base = (await mainAt(main.id, await seqOf(branch.baseSaveId), [path])).get(path);
  return diffAssets(base?.assetId ?? null, mine!.state === "present" ? mine!.assetId : null, mine!.mimeType ?? base?.mimeType ?? null);
}

/** The branch's files (the resolver route, H14): storage keys and asset ids stay on the server. */
export async function listBranchFiles(actor: Actor, branchId: string, opts: { cursor?: string | null; path?: string | null } = {}) {
  const { branch, main } = await loadBranch(actor, branchId);
  const page = await branchTree(branch, main.id, opts);
  return { files: page.files.map(({ storageKey: _k, assetId: _a, ...f }) => f), nextCursor: page.nextCursor };
}

/** One file of a branch, for downloads (the CLI's pull, the app's open). */
export async function branchFile(actor: Actor, branchId: string, rawPath: string) {
  const { branch, main } = await loadBranch(actor, branchId);
  const path = `/${String(rawPath ?? "").split("/").filter(Boolean).join("/")}`;
  const [file] = (await branchTree(branch, main.id, { paths: [path] })).files;
  if (!file) fail(`${path} isn't on this branch`, 404, "NOT_FOUND");
  return { branch, file: file! };
}

// ── Change sets on a branch (H14: a change set targets a branch) ─────────────────────────────────────────────────

/** Live files for a change set on a branch, shaped like main's (no node, the branch revision as the version). */
export async function branchLiveFiles(branchId: string, paths: string[]) {
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!branch || !paths.length) return new Map<string, { id: string | null; version: number; hash: string | null; deletedAt: Date | null }>();
  const main = await mainBranch(branch.workspaceId);
  const { files } = await branchTree(branch, main.id, { paths });
  return new Map(files.map((f) => [f.path, { id: null as string | null, version: f.revision, hash: f.contentHash, deletedAt: null }]));
}

/**
 * Apply a finished change set to its branch. A file changed on the branch since the set started is a conflict.
 * ponytail: no automatic merge on a branch yet (main has G9's); add it with merge requests.
 */
export async function applyOnBranch(set: ChangeSet, userId: string) {
  const items = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id));
  const paths = [...new Set(items.flatMap((i) => [i.path, ...(i.fromPath ? [i.fromPath] : [])]))];
  const live = await branchLiveFiles(set.branchId!, paths);
  const conflicts = items.flatMap((i) => {
    const at = live.get(i.fromPath ?? i.path);
    const now = at?.hash ?? null;
    if (now === (i.contentHash ?? null) && i.op !== "rename") return [];
    if (i.op === "add") return at ? [{ path: i.path, kind: "exists" }] : [];
    return now === (i.baseHash ?? null) ? [] : [{ path: i.path, kind: at ? "edit" : "deleted" }];
  });
  if (conflicts.length) fail(`${conflicts.length} file${conflicts.length === 1 ? "" : "s"} changed on the branch since this change set started`, 409, "CHANGE_SET_CONFLICT", { conflicts });
  const { save } = await writeBranch(set.branchId!, {
    changes: items.map((i) => ({ op: i.op, path: i.path, fromPath: i.fromPath, contentHash: i.contentHash, assetId: i.mergedAssetId ?? i.assetId, size: i.size, mimeType: i.mimeType, executable: i.executable })),
    message: set.title, kind: set.revertsSaveId ? "revert" : "save", authorId: set.authorId, via: set.via, agentName: set.agentName, taskId: set.taskId,
    changeSetId: set.id, revertsSaveId: set.revertsSaveId,
  });
  const now = new Date();
  const result = { applied: items.map((i) => ({ path: i.path, nodeId: null, version: null, op: i.op })), undo: [], undoToken: null, saveId: save?.id ?? null };
  await db.transaction(async (tx) => {
    await tx.update(changeSetItems).set({ state: "applied", updatedAt: now }).where(eq(changeSetItems.changeSetId, set.id));
    await tx.update(changeSets).set({ status: "applied", appliedAt: now, appliedBy: userId, applyResult: result as unknown as Record<string, unknown>, updatedAt: now }).where(eq(changeSets.id, set.id));
  });
  return result;
}

// ── The app's edits on a branch (decision 1: the branch page) ─────────────────────────────────────────────────────

/** A text file's content on a branch (up to 1 MB), for the branch page's viewer and editor. */
export async function branchFileText(actor: Actor, branchId: string, rawPath: string) {
  const { file } = await branchFile(actor, branchId, rawPath);
  const bytes = await readAsset(file.assetId);
  const base = { path: file.path, size: file.size, own: file.own, contentHash: file.contentHash, mimeType: file.mimeType };
  if (!bytes || !isTextual(bytes)) return { ...base, text: null as string | null };
  return { ...base, text: bytes.toString("utf8") };
}

/**
 * Saves a text file on a branch from the app: new content, or a new file. `expectedHash` is what the person saw, so a
 * save in between is caught (CHANGE_SET_CONFLICT) instead of overwritten.
 */
export async function saveTextOnBranch(actor: Actor, branchId: string, input: { path: string; text: string; expectedHash?: string | null; message?: string | null }) {
  const userId = userOf(actor);
  const { branch, main } = await loadBranch(actor, branchId, { write: true });
  if (branch.isDefault) fail("Edit main in the Files tab", 409, "MAIN_BRANCH");
  const path = normalizeChangePath(input.path);
  const bytes = Buffer.from(String(input.text ?? ""), "utf8");
  if (bytes.byteLength > 1024 * 1024) fail("The editor saves files up to 1 MB; push bigger ones with nb", 413, "FILE_TOO_LARGE");
  const findings = scanForSecrets(path, bytes);
  if (findings.length) fail("This file looks like it contains a password or key, so it wasn't saved", 422, "SECRET_DETECTED", { findings });
  const [now] = (await branchTree(branch, main.id, { paths: [path] })).files;
  if ((input.expectedHash ?? null) !== (now?.contentHash ?? null)) fail(`${path} changed on the branch since you opened it`, 409, "CHANGE_SET_CONFLICT", { conflicts: [{ path, kind: "edit" }] });
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash === now?.contentHash) return { save: null };
  const assetId = await storeWorkspaceBytes(branch.workspaceId, userId, hash, bytes, now?.mimeType ?? "text/plain", { branchId: branch.id, source: "branch_edit" });
  const name = path.split("/").pop();
  const { save } = await writeBranch(branch.id, {
    changes: [{ op: now ? "change" : "add", path, contentHash: hash, assetId, size: bytes.byteLength, mimeType: now?.mimeType ?? "text/plain" }],
    expectedHead: branch.headSaveId, message: input.message?.trim() || `${now ? "Changed" : "Added"} ${name}`, authorId: userId,
  });
  return { save: save ? { id: save.id, number: save.seq } : null };
}

/** A file as save `n` of a branch left it (C14b): that save's change to the path. */
async function fileAtBranchSave(branch: Branch, path: string, n: number) {
  if (!Number.isInteger(n) || n < 1) fail("Name the save by its number, like 3", 400, "BAD_REQUEST");
  const [row] = Array.from(await db.execute<{ after_path: string | null; content_hash: string | null; asset_id: string | null; storage_key: string | null; size: string | null; mime_type: string | null }>(sql`
    SELECT sc.after_path, sc.content_hash, sc.asset_id, a.storage_key, sc.size::text, sc.mime_type
    FROM saves s JOIN save_changes sc ON sc.save_id = s.id LEFT JOIN storage_assets a ON a.id = sc.asset_id
    WHERE s.branch_id = ${branch.id} AND s.seq = ${n} AND (sc.after_path = ${path} OR sc.before_path = ${path})
    ORDER BY (sc.after_path = ${path}) DESC LIMIT 1`));
  if (!row) fail(`Save ${n} on ${branch.name} didn't change ${path}`, 404, "NOT_FOUND", { hint: `nb file history ${path.slice(1)}` });
  if (row!.after_path !== path || !row!.content_hash) fail(`Save ${n} removed ${path}; there's no file there to use`, 409, "NOT_AVAILABLE");
  return { path, contentHash: row!.content_hash!.toLowerCase(), assetId: row!.asset_id, storageKey: row!.storage_key, size: row!.size == null ? null : Number(row!.size), mimeType: row!.mime_type };
}

/** One file of a branch as save `n` left it, for `nb diff --from` on a branch (C14b). */
export async function branchFileAtSave(actor: Actor, branchId: string, rawPath: string, n: number) {
  const { branch } = await loadBranch(actor, branchId);
  return { branch, file: await fileAtBranchSave(branch, normalizeChangePath(rawPath), n) };
}

/**
 * `nb file use <path> <n>` on a branch (C14b): the file as save n of this branch left it becomes a new save on the
 * branch. Only saves that changed the file count, the ones `nb file history` lists there.
 */
export async function useSaveOnBranch(actor: Actor, branchId: string, input: { path: string; save: number }) {
  const userId = userOf(actor);
  const { branch, main } = await loadBranch(actor, branchId, { write: true });
  if (branch.isDefault) fail("On main, nb file use takes a version: nb file history shows them", 409, "MAIN_BRANCH");
  const path = normalizeChangePath(input.path);
  const n = Number(input.save);
  const row = await fileAtBranchSave(branch, path, n);
  const [now] = (await branchTree(branch, main.id, { paths: [path] })).files;
  if (now?.contentHash === row.contentHash) return { save: null, path, from: n };
  const { save } = await writeBranch(branch.id, {
    changes: [{ op: now ? "change" : "add", path, contentHash: row.contentHash, assetId: row.assetId, size: row.size, mimeType: row.mimeType }],
    expectedHead: branch.headSaveId, message: `Used ${path.split("/").pop()} from save ${n}`, authorId: userId,
    via: actor.tokenKind === "agent" ? "agent" : actor.tokenKind ? "cli" : null,
  });
  return { save: save ? { id: save.id, number: save.seq } : null, path, from: n };
}

/** Every file of a branch at or under `folder` (all pages; a branch holds at most 20,000 files here). */
export async function filesUnder(branch: Branch, mainId: string, folder: string | null) {
  const out: TreeEntry[] = [];
  let cursor: string | null = null;
  do {
    const page = await branchTree(branch, mainId, { cursor, path: folder && folder !== "/" ? folder : null });
    out.push(...page.files);
    if (out.length > SAVE_LIMITS.zipFiles) fail("A branch shows at most 20,000 files here; use a folder on it", 413, "TOO_LARGE");
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export type BranchFolderEntry = { name: string; path: string; files: number };
export type BranchFileEntry = { name: string; path: string; own: boolean; size: number | null; mimeType: string | null; contentHash: string | null; save: number | null };

/**
 * One folder of a branch, like the explorer's (H2: the picker switches All files): its subfolders (with how many
 * files each holds) and its files. Folders exist on a branch while they hold a file.
 */
export async function branchFolder(actor: Actor, branchId: string, rawFolder: string | null) {
  const { branch, main } = await loadBranch(actor, branchId);
  const folder = rawFolder ? `/${String(rawFolder).split("/").filter(Boolean).join("/")}` : "/";
  const all = await filesUnder(branch, main.id, folder);
  if (folder !== "/" && !all.length) fail(`${folder} isn't on this branch`, 404, "NOT_FOUND");
  const prefix = folder === "/" ? "/" : `${folder}/`;
  const folders = new Map<string, number>();
  const files: BranchFileEntry[] = [];
  for (const f of all) {
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) {
      const name = rest.slice(0, slash);
      folders.set(name, (folders.get(name) ?? 0) + 1);
    } else files.push({ name: rest, path: f.path, own: f.own, size: f.size, mimeType: f.mimeType, contentHash: f.contentHash, save: f.own ? f.revision - BRANCH_LIMITS.branchRevision : null });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return {
    folder,
    folders: [...folders].map(([name, count]): BranchFolderEntry => ({ name, path: `${prefix}${name}`, files: count })).sort(byName),
    files: files.sort(byName),
  };
}

/** Every path on a branch, for searching names and the sidebar tree. */
export async function branchPaths(actor: Actor, branchId: string) {
  const { branch, main } = await loadBranch(actor, branchId);
  return { paths: (await filesUnder(branch, main.id, null)).map((f) => f.path) };
}

/** Moves or renames a file, or a folder with everything in it, on a branch: one save. */
export async function moveOnBranch(actor: Actor, branchId: string, rawFrom: string, rawTo: string) {
  const userId = userOf(actor);
  const { branch, main } = await loadBranch(actor, branchId, { write: true });
  if (branch.isDefault) fail("Move main's files in the Files tab", 409, "MAIN_BRANCH");
  const from = normalizeChangePath(rawFrom);
  const to = normalizeChangePath(rawTo);
  if (from === to) return { save: null };
  if (to.startsWith(`${from}/`)) fail("A folder can't move into itself", 400, "BAD_PATH");
  const [file] = (await branchTree(branch, main.id, { paths: [from] })).files;
  const moving = file ? [file] : await filesUnder(branch, main.id, from);
  if (!moving.length) fail(`${from} isn't on this branch`, 404, "NOT_FOUND");
  if (moving.length > SAVE_LIMITS.changes) fail(`A move over ${SAVE_LIMITS.changes} files can't go in one step`, 413, "CHANGE_SET_TOO_LARGE");
  const targets = moving.map((f) => (file ? to : `${to}${f.path.slice(from.length)}`));
  const taken = (await branchTree(branch, main.id, { paths: targets })).files;
  if (taken.length) fail(`${taken[0]!.path} already exists on this branch`, 409, "CONFLICT", { conflicts: taken.map((t) => ({ path: t.path, kind: "exists" })) });
  const name = (p: string) => p.split("/").pop();
  const sameFolder = from.slice(0, from.lastIndexOf("/")) === to.slice(0, to.lastIndexOf("/"));
  const { save } = await writeBranch(branch.id, {
    changes: moving.map((f, i) => ({ op: "rename" as const, fromPath: f.path, path: targets[i]! })),
    expectedHead: branch.headSaveId, authorId: userId,
    message: sameFolder ? `Renamed ${name(from)} to ${name(to)}` : `Moved ${name(from)} to ${to.slice(0, to.lastIndexOf("/")) || "/"}`,
  });
  return { save: save ? { id: save.id, number: save.seq } : null };
}

/** Deletes a file, or a folder with everything in it, on a branch (a save; undo by reverting it, H8). */
export async function deleteOnBranch(actor: Actor, branchId: string, rawPath: string) {
  const userId = userOf(actor);
  const { branch, main } = await loadBranch(actor, branchId, { write: true });
  if (branch.isDefault) fail("Delete main's files in the Files tab", 409, "MAIN_BRANCH");
  const path = normalizeChangePath(rawPath);
  const [file] = (await branchTree(branch, main.id, { paths: [path] })).files;
  const gone = file ? [file] : await filesUnder(branch, main.id, path);
  if (!gone.length) fail(`${path} isn't on this branch`, 404, "NOT_FOUND");
  if (gone.length > SAVE_LIMITS.changes) fail(`A delete over ${SAVE_LIMITS.changes} files can't go in one step`, 413, "CHANGE_SET_TOO_LARGE");
  const { save } = await writeBranch(branch.id, {
    changes: gone.map((f) => ({ op: "delete" as const, path: f.path })), expectedHead: branch.headSaveId,
    message: `Deleted ${path.split("/").pop()}${file ? "" : ` (${gone.length} file${gone.length === 1 ? "" : "s"})`}`, authorId: userId,
  });
  return { save: save ? { id: save.id, number: save.seq } : null };
}

// ── Uploads on a branch (H-2b): a change set on the branch, as the CLI sends files ──────────────────────────────────

/** Starts an upload: one change set on the branch with an item per file (added, or changed where the path exists). */
export async function beginUploadOnBranch(actor: Actor, branchId: string, files: Array<{ path: string; hash: string; size: number; mimeType: string | null }>) {
  const { branch } = await loadBranch(actor, branchId, { write: true });
  if (branch.isDefault) fail("Upload to main in the Files tab", 409, "MAIN_BRANCH");
  if (!files.length) fail("Choose files to upload", 400, "BAD_REQUEST");
  if (files.length > SAVE_LIMITS.changes) fail(`An upload holds at most ${SAVE_LIMITS.changes} files`, 413, "CHANGE_SET_TOO_LARGE");
  const paths = files.map((f) => normalizeChangePath(f.path));
  const live = await branchLiveFiles(branch.id, paths);
  const { startChangeSet, upsertItems } = await import("@/lib/domain/change-sets");
  const set = await startChangeSet(actor, { workspaceId: branch.workspaceId, title: files.length === 1 ? `Uploaded ${paths[0]!.split("/").pop()}` : `Uploaded ${files.length} files`, branchId: branch.id });
  const items = files.map((f, i) => ({ op: (live.has(paths[i]!) ? "change" : "add") as "change" | "add", path: paths[i]!, contentHash: String(f.hash).toLowerCase(), size: f.size, mimeType: f.mimeType || "application/octet-stream" }));
  for (let i = 0; i < items.length; i += 200) await upsertItems(actor, set.id, items.slice(i, i + 200));
  return { changeSetId: set.id };
}

/** Finishes an upload: checks it (keys need the person's yes) and saves it on the branch. */
export async function finishUploadOnBranch(actor: Actor, request: Request, changeSetId: string, opts: { confirmSecrets?: boolean } = {}) {
  const { finishChangeSet, applyChangeSet, discardChangeSet } = await import("@/lib/domain/change-sets");
  // Only an upload on a branch finishes here: main's change sets go through Apply, with its checks.
  if (!UUID.test(changeSetId)) fail("Change set not found", 404, "NOT_FOUND");
  const [set] = await db.select({ branchId: changeSets.branchId, authorId: changeSets.authorId }).from(changeSets).where(eq(changeSets.id, changeSetId)).limit(1);
  if (!set || set.authorId !== userOf(actor)) fail("Change set not found", 404, "NOT_FOUND");
  if (!set!.branchId) fail("Apply main's change sets in Changes", 409, "NOT_AVAILABLE");
  const { branch } = await loadBranch(actor, set!.branchId!, { write: true });
  if (branch.isDefault) fail("Apply main's change sets in Changes", 409, "NOT_AVAILABLE");
  // The same check as Apply: docs and final files ask "Verify it's you" first in the browser.
  const { changeSetStepUp } = await import("@/lib/security/change-set-step-up");
  const stepUp = await changeSetStepUp(actor, changeSetId);
  if (stepUp) fail("This upload touches a doc or final files: verify it's you first", 403, "STEP_UP_REQUIRED", { stepUp });
  try {
    await finishChangeSet(actor, changeSetId, { confirmSecrets: Boolean(opts.confirmSecrets) && actor.tokenKind !== "agent" });
    await applyChangeSet(actor, request, changeSetId);
  } catch (error) {
    // A refused upload leaves nothing half-done behind, except when it waits for a yes about keys.
    if (!(error instanceof ChangeSetError && error.code === "SECRET_DETECTED")) await discardChangeSet(actor, changeSetId).catch(() => undefined);
    throw error;
  }
  const [made] = await db.select({ id: saves.id, seq: saves.seq }).from(saves).where(eq(saves.changeSetId, changeSetId)).orderBy(desc(saves.seq)).limit(1);
  return { save: made ? { id: made.id, number: made.seq } : null };
}

// ── Protected main: the same change on a new branch, with a merge request (report H5, H24) ───────────────────────────

/** A new branch named `base`, or `base-2`, `base-3`… when that name is taken. */
export async function createUniqueBranch(actor: Actor, workspaceId: string, base: string, taskId: string | null = null) {
  for (let i = 1; i <= 20; i += 1) {
    const name = i === 1 ? base : `${base.slice(0, 95)}-${i}`;
    try {
      return (await createBranch(actor, workspaceId, { name, taskId })).branch;
    } catch (error) {
      if (!(error instanceof ChangeSetError && error.code === "BRANCH_EXISTS")) throw error;
    }
  }
  return fail("Couldn't find a free branch name; pick one", 409, "BRANCH_EXISTS");
}

export type ProtectedChange =
  | { kind: "text"; path: string; text: string; baseHash?: string | null }
  | { kind: "version"; nodeId: string; version: number }
  | { kind: "restore"; nodeIds: string[] };

/**
 * When main takes only merge requests, the app's edit, "Use this version" and Restore from Trash go to a new branch
 * instead, with a merge request opened for review: one click, nothing lost. The branch starts from main now.
 */
export async function saveToNewBranch(actor: Actor, workspaceId: string, input: { name: string; title: string; change: ProtectedChange }) {
  const userId = userOf(actor);
  const who = await memberAccess(actor, workspaceId);
  if (!who.canWrite) fail(readOnlyWhy(who), 403, "FORBIDDEN");
  const c = input.change;
  // What goes on the branch, read from main before the branch exists (so a bad request makes no branch).
  let changes: BranchChange[] = [];
  if (c.kind === "version" || c.kind === "restore") {
    const ids = c.kind === "version" ? [c.nodeId] : c.nodeIds.slice(0, 200);
    const rows = Array.from(await db.execute<{ id: string; path: string; deleted: boolean; type: string; task: string | null; hash: string | null; asset: string | null; size: string | null; mime: string | null }>(sql`
      SELECT n.id, n.path, n.deleted_at IS NOT NULL AS deleted, n.type, n.task_id AS task, v.content_hash AS hash, v.asset_id AS asset, v.size::text AS size, v.mime_type AS mime
      FROM workspace_nodes n
      JOIN LATERAL (SELECT * FROM file_versions fv WHERE fv.node_id = n.id AND fv.version = ${c.kind === "version" ? c.version : sql`n.current_version`} LIMIT 1) v ON true
      WHERE n.workspace_id = ${workspaceId} AND n.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`));
    if (rows.length !== ids.length || rows.some((r) => r.type !== "file" || r.task)) fail("Only project files go to a branch this way", 404, "NOT_FOUND");
    changes = rows.map((r) => ({ op: c.kind === "restore" ? "add" : "change", path: r.path, contentHash: r.hash, assetId: r.asset, size: r.size == null ? null : Number(r.size), mimeType: r.mime }));
    if (changes.some((x) => !x.contentHash || !x.assetId)) fail("That version has no stored content to put on a branch", 409, "NOT_REVERTIBLE");
  }
  const branch = await createUniqueBranch(actor, workspaceId, input.name);
  let saved: unknown = null;
  try {
    saved = c.kind === "text"
      ? (await saveTextOnBranch(actor, branch.id, { path: c.path, text: c.text, expectedHash: c.baseHash ?? null, message: input.title })).save
      : (await writeBranch(branch.id, { changes, message: input.title, authorId: userId })).save;
  } finally {
    // Nothing differed from main, or the write failed: the new branch was never used, so it goes.
    if (!saved) await db.delete(branches).where(eq(branches.id, branch.id));
  }
  if (!saved) fail("main already has this, so there's nothing to put on a branch", 409, "MERGE_REQUEST_EMPTY");
  const { createMergeRequest } = await import("@/lib/domain/merge-requests");
  const made = await createMergeRequest(actor, workspaceId, { source: branch.name, title: input.title });
  return { branch: { id: branch.id, name: branch.name }, mergeRequest: made.mergeRequest.number };
}

/**
 * The daily branch tidy-up (report H2, H23, H26 cleanup jobs), a step of the daily retention function:
 * - merged branches are deleted 7 days after merging (their saves stay in History; restorable for 30 days);
 * - deleted branches' own files go after the 30 days a restore allows (content still used by a save stays);
 * - a branch with no saves for 90 days tells its maker once: "Archive or keep?". Nothing else is deleted for age.
 */
export async function sweepBranches(now = new Date()) {
  const day = 86_400_000;
  const merged = await db.update(branches).set({ status: "deleted", deletedAt: now, updatedAt: now })
    .where(and(eq(branches.status, "merged"), sql`${branches.updatedAt} < ${new Date(now.getTime() - BRANCH_LIMITS.mergedDays * day).toISOString()}::timestamptz`))
    .returning({ id: branches.id });
  const gone = Array.from(await db.execute<{ asset_id: string | null }>(sql`
    DELETE FROM branch_files f USING branches b
    WHERE f.branch_id = b.id AND b.status = 'deleted' AND b.deleted_at < ${new Date(now.getTime() - BRANCH_LIMITS.restoreDays * day).toISOString()}::timestamptz
    RETURNING f.asset_id`));
  if (gone.length) {
    const { scheduleAssetDeletionIfUnreferenced } = await import("@/lib/storage/asset-deletion");
    await scheduleAssetDeletionIfUnreferenced(db, gone.map((g) => g.asset_id));
  }
  const old = Array.from(await db.execute<{ id: string; workspace_id: string; name: string; created_by: string }>(sql`
    SELECT b.id, b.workspace_id, b.name, b.created_by FROM branches b LEFT JOIN saves h ON h.id = b.head_save_id
    WHERE b.status = 'active' AND NOT b.is_default AND b.created_by IS NOT NULL
      AND coalesce(h.created_at, b.created_at) < ${new Date(now.getTime() - BRANCH_LIMITS.staleNoteDays * day).toISOString()}::timestamptz
    LIMIT 500`));
  if (old.length) {
    await enqueueNotificationFanout({
      source: "branch-stale",
      writes: old.map((b) => ({
        operation: "create" as const,
        input: {
          recipientUserId: b.created_by, actorUserId: null, kind: "branch_saves" as const, category: "workflows" as const, importance: "more" as const,
          title: `Archive or keep ${b.name}? It has had no saves for 90 days`.slice(0, 200),
          href: `/workspaces/${b.workspace_id}?tab=files&filesView=branches`,
          entityRefs: { projectId: b.workspace_id },
          // Once per branch, ever.
          dedupeKey: `branch-stale:${b.id}`,
        },
      })),
    });
  }
  return { mergedDeleted: merged.length, filesPurged: gone.length, staleNotes: old.length };
}
