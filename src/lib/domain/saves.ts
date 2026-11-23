import "server-only";
/**
 * Saves and history on main (report Part H, phase H-1). The database records every save (0096); this module reads
 * history, a save's files and diffs, turns the setting on and off, and reverts a save through a Part G change set.
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { branchProtection, branches, changeSets, fileVersions, profiles, saveChanges, saves, storageAssets, tasks, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { labelScope } from "@/lib/agents/via-scope";
import { visibleVia } from "@/lib/agents/via-visibility";
import { changeSetStepUp } from "@/lib/security/change-set-step-up";
import { ChangeSetError, applyChangeSet, diffAssets, finishChangeSet, startChangeSet, upsertItems, type Actor, type ItemDiff, type ItemInput } from "@/lib/domain/change-sets";

const fail = (message: string, status: number, code: string, details?: Record<string, unknown>): never => {
  throw new ChangeSetError(message, status, code, details);
};
const userOf = (actor: Actor) => actor.user?.id ?? fail("Sign in to continue", 401, "UNAUTHORIZED");

export const SAVE_LIMITS = { page: 50, files: 5_000, changes: 2_000, zipFiles: 20_000 };

/** History is for the workspace's people (H26): members, owners and the organization's admins, never public readers. */
export async function memberAccess(actor: Actor, workspaceId: string) {
  const access = await getWorkspaceAccessById(workspaceId, userOf(actor));
  if (!access.project || !access.canRead || !(access.isOwner || access.isMember || access.isInheritedAdmin)) fail("Workspace not found", 404, "NOT_FOUND");
  // An archived workspace keeps its branches and merge requests read-only (H24).
  return { access, canWrite: access.canWrite && access.project?.status !== "archived", isAdmin: access.isOwner || access.memberRole === "admin" || access.isInheritedAdmin };
}

/** People among `ids` who aren't the workspace's owner or members any more (H24: shown as "former member"). */
export async function formerMembers(workspaceId: string, ids: Array<string | null | undefined>) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Set<string>();
  const rows = Array.from(await db.execute<{ id: string }>(sql`
    SELECT u.id FROM unnest(ARRAY[${sql.join(list.map((id) => sql`${id}::uuid`), sql`, `)}]) AS u(id)
    WHERE u.id <> (SELECT owner_id FROM workspaces WHERE id = ${workspaceId})
      AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${workspaceId} AND m.user_id = u.id)`));
  return new Set(rows.map((r) => r.id));
}

/** Why someone can't change branches here, in the person's words. */
export const readOnlyWhy = (who: { access: { project: { status?: string | null } | null; writeBlocked?: string | null } }) =>
  who.access.writeBlocked === "completed" ? "Your part here is completed. Reopen your part to make changes (nb workspace reopen)"
  : who.access.project?.status === "archived" ? "This workspace is archived, so its branches and merge requests are read-only" : "You can read this workspace but not change it";

export async function mainBranch(workspaceId: string) {
  const [row] = await db.select({ id: branches.id, headSaveId: branches.headSaveId, on: workspaces.branchesEnabled })
    .from(workspaces).leftJoin(branches, and(eq(branches.workspaceId, workspaces.id), eq(branches.isDefault, true)))
    .where(eq(workspaces.id, workspaceId)).limit(1);
  if (!row?.on || !row.id) fail("History isn't turned on for this workspace; an owner can turn on Branches in Settings", 403, "BRANCHES_OFF");
  return { id: row!.id!, headSaveId: row!.headSaveId };
}

async function findSave(actor: Actor, saveId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(saveId)) fail("Save not found", 404, "NOT_FOUND");
  const [save] = await db.select().from(saves).where(eq(saves.id, saveId)).limit(1);
  if (!save || save.seq == null) fail("Save not found", 404, "NOT_FOUND");
  const who = await memberAccess(actor, save!.workspaceId);
  return { save: save!, ...who };
}

// ── The setting (H16) ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Turning Branches on makes main's row, a "Start of history" save and a full checkpoint, and turns change sets on
 * (Part H builds on them). Off keeps the history; it's refused while other branches are active (none until H-2).
 */
export async function setBranchesEnabled(actor: Actor, workspaceId: string, on: boolean) {
  const userId = userOf(actor);
  if (actor.tokenKind === "agent") fail("Only a person can change this setting", 403, "FORBIDDEN");
  const { access, isAdmin } = await memberAccess(actor, workspaceId);
  if (!isAdmin) fail("Only the workspace's owners and admins can change this", 403, "FORBIDDEN");
  // ponytail: organizations' folder rules (Admins only, Public) aren't applied to history yet; they come with H-4.
  if (access.project!.kind === "organization" || access.project!.parentId) fail("Branches aren't available in organizations yet", 403, "BRANCHES_OFF");
  if (!on) {
    const [other] = await db.select({ id: branches.id }).from(branches)
      .where(and(eq(branches.workspaceId, workspaceId), eq(branches.isDefault, false), eq(branches.status, "active"))).limit(1);
    if (other) fail("Merge or delete the other branches first", 409, "BRANCHES_ACTIVE");
    await db.update(workspaces).set({ branchesEnabled: false, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
    return { enabled: false };
  }
  return db.transaction(async (tx) => {
    const [ws] = await tx.select({ on: workspaces.branchesEnabled }).from(workspaces).where(eq(workspaces.id, workspaceId)).for("update");
    if (ws?.on) return { enabled: true };
    // Waits for writers already changing these files, so the checkpoint below has their work.
    // ponytail: a file added at this very moment can miss the start of history; its next change records it.
    await tx.execute(sql`SELECT 1 FROM workspace_nodes WHERE workspace_id = ${workspaceId} AND type = 'file' AND deleted_at IS NULL FOR SHARE`);
    await tx.update(workspaces).set({ branchesEnabled: true, changeSetsEnabled: true, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
    let [main] = await tx.select().from(branches).where(and(eq(branches.workspaceId, workspaceId), eq(branches.isDefault, true))).for("update");
    if (!main) [main] = await tx.insert(branches).values({ workspaceId, name: "main", isDefault: true, createdBy: userId }).returning();
    // Main's protection starts at the H5 defaults (a team's main takes merge requests only); kept when turned back on.
    const { defaultProtection } = await import("@/lib/domain/branch-protection");
    const { updatedAt: _at, ...defaults } = await defaultProtection(workspaceId);
    await tx.insert(branchProtection).values({ ...defaults, branchId: main!.id, updatedBy: userId }).onConflictDoNothing();
    const head = main!.headSaveId ? (await tx.select({ seq: saves.seq }).from(saves).where(eq(saves.id, main!.headSaveId)))[0] : undefined;
    const [start] = await tx.insert(saves).values({
      workspaceId, branchId: main!.id, seq: (head?.seq ?? 0) + 1, parentSaveId: main!.headSaveId, kind: "start",
      message: head ? "History turned back on" : "Start of history", authorId: userId,
    }).returning();
    await tx.execute(sql`SELECT app_private.save_checkpoint(${start!.id}::uuid, ${workspaceId}::uuid)`);
    await tx.update(branches).set({ headSaveId: start!.id, updatedAt: new Date() }).where(eq(branches.id, main!.id));
    return { enabled: true };
  });
}

// ── Reading history (H3) ──────────────────────────────────────────────────────────────────────────────────────────

export type SaveView = {
  id: string;
  number: number;
  kind: string;
  message: string;
  author: { id: string; name: string | null; username: string | null; avatarUrl?: string | null } | null;
  via: "agent" | "cli" | null;
  agentName: string | null;
  /** "with Claude Code", "from the terminal", or null: what this viewer may see (Part B). */
  madeWith: string | null;
  task: { id: string; number: number | null; title?: string | null } | null;
  /** Lines added and removed (H-2b); null when not worked out (over 200 files). */
  lines: { added: number; removed: number } | null;
  changeSetId: string | null;
  revertsSaveId: string | null;
  files: { added: number; changed: number; deleted: number; renamed: number };
  /** The branch it's on; null is main (H-2). */
  branch: { id: string; name: string } | null;
  createdAt: string;
};

async function viewOf(viewerId: string, workspaceId: string, rows: Array<typeof saves.$inferSelect>): Promise<SaveView[]> {
  if (!rows.length) return [];
  const authorIds = [...new Set(rows.flatMap((r) => (r.authorId ? [r.authorId] : [])))];
  const taskIds = [...new Set(rows.flatMap((r) => (r.taskId ? [r.taskId] : [])))];
  const branchIds = [...new Set(rows.map((r) => r.branchId))];
  const [people, taskRows, scope, branchRows] = await Promise.all([
    authorIds.length ? db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl }).from(profiles).where(inArray(profiles.id, authorIds)) : [],
    taskIds.length ? db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds)) : [],
    labelScope(viewerId, workspaceId),
    db.select({ id: branches.id, name: branches.name, isDefault: branches.isDefault }).from(branches).where(inArray(branches.id, branchIds)),
  ]);
  return rows.map((r) => {
    const shown = visibleVia(scope, { via: r.via, agentName: r.agentName, authorId: r.authorId });
    const task = taskRows.find((t) => t.id === r.taskId);
    return {
      id: r.id, number: r.seq ?? 0, kind: r.kind, message: r.message ?? "",
      author: people.find((p) => p.id === r.authorId) ?? null,
      via: shown.via, agentName: shown.agentName,
      madeWith: shown.via === "agent" ? `with ${shown.agentName ?? "an agent"}` : shown.via === "cli" ? "from the terminal" : null,
      task: task ? { id: task.id, number: task.number ?? null, title: task.title } : null,
      lines: r.linesAdded == null || r.linesAdded < 0 ? null : { added: r.linesAdded, removed: r.linesRemoved ?? 0 },
      changeSetId: r.changeSetId, revertsSaveId: r.revertsSaveId,
      files: { added: r.filesAdded, changed: r.filesChanged, deleted: r.filesDeleted, renamed: r.filesRenamed },
      branch: ((b) => (b && !b.isDefault ? { id: b.id, name: b.name } : null))(branchRows.find((b) => b.id === r.branchId)),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** Main's history, newest first, 50 a page. `path` matches a file or a folder; `author` a person's id or username. */
export async function listSaves(actor: Actor, workspaceId: string, opts: { branch?: string | null; path?: string | null; author?: string | null; agent?: string | null; number?: number | null; cursor?: string | null; limit?: number } = {}) {
  await memberAccess(actor, workspaceId);
  const main = await mainBranch(workspaceId);
  // A branch's own saves (H-2): by its id or name; main by default.
  const onBranch = opts.branch ? await (await import("@/lib/domain/branches")).findBranch(actor, workspaceId, opts.branch) : null;
  const branchId = onBranch?.id ?? main.id;
  const limit = Math.min(Math.max(Number(opts.limit) || SAVE_LIMITS.page, 1), SAVE_LIMITS.page);
  const where = [eq(saves.branchId, branchId), sql`${saves.seq} IS NOT NULL`];
  const before = opts.cursor ? Number(opts.cursor) : null;
  if (before != null && Number.isFinite(before)) where.push(lt(saves.seq, before));
  // One save by its number, the way people say it ("save 12"; nb show 12).
  if (opts.number != null && Number.isInteger(Number(opts.number))) where.push(eq(saves.seq, Number(opts.number)));
  const path = opts.path ? `/${String(opts.path).split("/").filter(Boolean).join("/")}` : null;
  if (path) where.push(sql`EXISTS (SELECT 1 FROM save_changes c WHERE c.save_id = ${saves.id}
    AND (c.path = ${path} OR starts_with(c.path, ${path} || '/') OR c.before_path = ${path} OR starts_with(c.before_path, ${path} || '/')))`);
  if (opts.author) {
    const author = String(opts.author).replace(/^@/, "");
    where.push(/^[0-9a-f-]{36}$/i.test(author) ? eq(saves.authorId, author) : sql`${saves.authorId} = (SELECT id FROM profiles WHERE lower(username) = lower(${author}) LIMIT 1)`);
  }
  // Filtering by agent only finds what this viewer may see labelled (Part B).
  const scope = opts.agent ? await labelScope(userOf(actor), workspaceId) : null;
  if (opts.agent) where.push(eq(saves.via, "agent"), sql`lower(${saves.agentName}) = lower(${String(opts.agent)})`);
  let rows = await db.select().from(saves).where(and(...where)).orderBy(desc(saves.seq)).limit(limit + 1);
  if (scope) rows = rows.filter((r) => visibleVia(scope, { via: r.via, agentName: r.agentName, authorId: r.authorId }).via === "agent");
  let page = rows.slice(0, limit);
  // Line counts the first time a save is listed (kept after that).
  const missing = page.filter((r) => r.linesAdded == null).map((r) => r.id);
  if (missing.length) {
    await fillLineStats(missing, { budget: 150 });
    const filled = new Map((await db.select({ id: saves.id, a: saves.linesAdded, r: saves.linesRemoved }).from(saves).where(inArray(saves.id, missing))).map((x) => [x.id, x]));
    page = page.map((r) => (filled.has(r.id) ? { ...r, linesAdded: filled.get(r.id)!.a, linesRemoved: filled.get(r.id)!.r } : r));
  }
  // On a branch (H8): main's saves up to where the branch stands on main are its history too; this is the cursor
  // that lists them (main's saves numbered below it).
  const baseSeq = onBranch && !onBranch.isDefault && onBranch.baseSaveId ? (await db.select({ seq: saves.seq }).from(saves).where(eq(saves.id, onBranch.baseSaveId)).limit(1))[0]?.seq ?? null : null;
  return { saves: await viewOf(userOf(actor), workspaceId, page), nextCursor: rows.length > limit ? String(page.at(-1)!.seq) : null, mainBefore: baseSeq != null ? String(baseSeq + 1) : null };
}

export type SaveFile = { path: string; fromPath: string | null; op: "add" | "change" | "delete" | "rename"; size: number | null; mimeType: string | null; version: number | null; previousVersion: number | null; lines: { added: number; removed: number } | null };

/** One save (H3): what it says, and its files. */
export async function getSave(actor: Actor, saveId: string) {
  const { save: found } = await findSave(actor, saveId);
  await fillLineStats([found.id]);
  const save = (await db.select().from(saves).where(eq(saves.id, found.id)).limit(1))[0]!;
  const rows = await db.select({
    path: saveChanges.path, before: saveChanges.beforePath, op: saveChanges.op, version: saveChanges.version, previousVersion: saveChanges.previousVersion,
    linesAdded: saveChanges.linesAdded, linesRemoved: saveChanges.linesRemoved,
    size: sql<number | null>`coalesce(${fileVersions.size}, ${saveChanges.size})`, mimeType: sql<string | null>`coalesce(${fileVersions.mimeType}, ${saveChanges.mimeType})`,
  })
    .from(saveChanges)
    .leftJoin(fileVersions, and(eq(fileVersions.nodeId, saveChanges.nodeId), eq(fileVersions.version, sql`coalesce(${saveChanges.version}, ${saveChanges.previousVersion})`)))
    .where(and(eq(saveChanges.saveId, save.id), sql`${saveChanges.op} <> 'none'`))
    .orderBy(sql`${saveChanges.path} COLLATE "C"`)
    .limit(SAVE_LIMITS.changes + 1);
  const files: SaveFile[] = rows.slice(0, SAVE_LIMITS.changes).map((r) => ({
    path: r.path!, fromPath: r.op === "rename" ? r.before : null, op: r.op as SaveFile["op"],
    size: r.size == null ? null : Number(r.size), mimeType: r.mimeType, version: r.version, previousVersion: r.previousVersion,
    lines: r.linesAdded == null ? null : { added: r.linesAdded, removed: r.linesRemoved ?? 0 },
  }));
  const [view] = await viewOf(userOf(actor), save.workspaceId, [save]);
  return { save: view!, workspaceId: save.workspaceId, files, truncated: rows.length > SAVE_LIMITS.changes };
}

/** One file's diff in a save: its version before and after. */
export async function saveDiff(actor: Actor, saveId: string, rawPath: string): Promise<ItemDiff> {
  const { save } = await findSave(actor, saveId);
  const path = `/${String(rawPath ?? "").split("/").filter(Boolean).join("/")}`;
  const [change] = await db.select().from(saveChanges).where(and(eq(saveChanges.saveId, save.id), eq(saveChanges.path, path))).limit(1);
  if (!change || change.op === "none") fail("That file isn't in this save", 404, "NOT_FOUND");
  const { before, after } = await assetsOf(change!, save.workspaceId);
  return diffAssets(before.assetId, after.assetId, after.mime ?? before.mime);
}

/** A change's content before and after: main's by version, a branch's by content hash (H-2). */
async function assetsOf(change: typeof saveChanges.$inferSelect, workspaceId: string) {
  const versionOf = async (version: number | null) => {
    if (!change.nodeId || version == null) return { assetId: null as string | null, mime: null as string | null };
    const [v] = await db.select({ assetId: fileVersions.assetId, mime: fileVersions.mimeType }).from(fileVersions)
      .where(and(eq(fileVersions.nodeId, change.nodeId), eq(fileVersions.version, version))).limit(1);
    return { assetId: v?.assetId ?? null, mime: v?.mime ?? null };
  };
  const byHash = async (hash: string | null) => {
    if (!hash) return { assetId: null as string | null, mime: change.mimeType };
    const [a] = await db.select({ id: storageAssets.id }).from(storageAssets).where(and(eq(storageAssets.projectId, workspaceId), eq(storageAssets.contentHash, hash), eq(storageAssets.state, "verified"))).limit(1);
    return { assetId: a?.id ?? null, mime: change.mimeType };
  };
  const before = change.op === "add" ? { assetId: null, mime: null } : change.nodeId ? await versionOf(change.previousVersion) : await byHash(change.previousContentHash);
  const after = change.op === "delete" ? { assetId: null, mime: null } : change.nodeId ? await versionOf(change.version) : await byHash(change.contentHash);
  return { before, after };
}

/** Saves over this many files show no line counts: working them out would read too much. */
export const LINE_STATS_MAX_FILES = 200;

/**
 * Lines added and removed (H-2b, History like GitHub's): worked out once per change from its text before and after,
 * then kept on save_changes and summed on the save. Binary, image and large files count as no lines; a save over
 * 200 files is marked -1 (not shown). Bounded: four saves at a time.
 */
export async function fillLineStats(saveIds: string[], opts: { budget?: number } = {}) {
  if (!saveIds.length) return;
  const all = await db.select({ id: saves.id, workspaceId: saves.workspaceId, files: sql<number>`(${saves.filesAdded} + ${saves.filesChanged} + ${saves.filesDeleted} + ${saves.filesRenamed})::int` })
    .from(saves).where(and(inArray(saves.id, saveIds), isNull(saves.linesAdded)));
  // ponytail: a fixed budget of files read per call (newest saves first); the rest fill in on later loads. Upgrade:
  // count lines when a save is recorded, in a background job.
  let budget = opts.budget ?? Number.POSITIVE_INFINITY;
  const order = new Map(saveIds.map((id, i) => [id, i]));
  const todo = all.sort((a, b) => order.get(a.id)! - order.get(b.id)!).filter((s) => {
    if (s.files > LINE_STATS_MAX_FILES) return true; // marked without reading
    if (budget <= 0) return false;
    budget -= s.files;
    return true;
  });
  const one = async (save: { id: string; workspaceId: string }) => {
    const changes = await db.select().from(saveChanges).where(and(eq(saveChanges.saveId, save.id), sql`${saveChanges.op} <> 'none'`)).limit(LINE_STATS_MAX_FILES + 1);
    if (changes.length > LINE_STATS_MAX_FILES) {
      await db.update(saves).set({ linesAdded: -1, linesRemoved: -1 }).where(eq(saves.id, save.id));
      return;
    }
    let added = 0;
    let removed = 0;
    for (const change of changes) {
      if (change.linesAdded != null) { added += change.linesAdded; removed += change.linesRemoved ?? 0; continue; }
      let a = 0;
      let r = 0;
      const { before, after } = await assetsOf(change, save.workspaceId);
      const mime = after.mime ?? before.mime ?? "";
      const skip = mime.startsWith("image/") || (change.op === "rename" && before.assetId === after.assetId);
      if (!skip) {
        const diff = await diffAssets(before.assetId, after.assetId, mime).catch(() => null);
        if (diff?.kind === "text") { a = diff.added; r = diff.removed; }
      }
      await db.update(saveChanges).set({ linesAdded: a, linesRemoved: r }).where(eq(saveChanges.id, change.id));
      added += a;
      removed += r;
    }
    await db.update(saves).set({ linesAdded: added, linesRemoved: removed }).where(eq(saves.id, save.id));
  };
  for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map((s) => one(s).catch(() => undefined)));
}

export type TreeFile = { path: string; nodeId: string; version: number; contentHash: string | null; assetId: string | null; storageKey: string | null; size: number | null; mimeType: string | null };

/**
 * The resolver for main (H11): main's files as they were at save S. The nearest checkpoint at or before S, then for
 * each file its latest change after that checkpoint, up to S. 5,000 a page by path.
 */
export async function filesAtSave(actor: Actor, saveId: string, opts: { cursor?: string | null; path?: string | null } = {}) {
  const { save } = await findSave(actor, saveId);
  const main = await mainBranch(save.workspaceId);
  if (save.branchId !== main.id) fail("Browsing a branch's files at one of its saves comes later; the branch shows its files now", 409, "NOT_AVAILABLE");
  const page = await treeAt(save.branchId, save.seq!, opts);
  // Storage keys and asset ids stay on the server.
  return { files: { files: page.files.map(({ storageKey: _key, assetId: _asset, ...f }) => f), nextCursor: page.nextCursor }, saveId: save.id };
}

/**
 * Main's files at save number `seq`, as a SQL `WITH` list ending in `tree(path, node_id, version)`: the nearest
 * checkpoint at or before it, then each file's latest change after that checkpoint, up to it. Branches build on it.
 */
export function mainTreeCte(mainBranchId: string, seq: number) {
  return sql`
    cp AS (
      SELECT c.id, s.seq FROM tree_checkpoints c JOIN saves s ON s.id = c.save_id
      WHERE s.branch_id = ${mainBranchId} AND s.seq <= ${seq} ORDER BY s.seq DESC LIMIT 1
    ), latest AS (
      SELECT DISTINCT ON (sc.node_id) sc.node_id, sc.after_path, sc.version
      FROM save_changes sc JOIN saves s ON s.id = sc.save_id, cp
      WHERE s.branch_id = ${mainBranchId} AND s.seq > cp.seq AND s.seq <= ${seq} AND sc.node_id IS NOT NULL AND sc.op <> 'none'
      ORDER BY sc.node_id, s.seq DESC
    ), tree AS (
      SELECT f.path, f.node_id, f.version FROM checkpoint_files f, cp WHERE f.checkpoint_id = cp.id AND f.node_id NOT IN (SELECT node_id FROM latest)
      UNION ALL
      SELECT after_path, node_id, version FROM latest WHERE after_path IS NOT NULL
    )`;
}

export async function treeAt(branchId: string, seq: number, opts: { cursor?: string | null; path?: string | null; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? SAVE_LIMITS.files, SAVE_LIMITS.files);
  const rows = Array.from(await db.execute<{ path: string; node_id: string; version: number; content_hash: string | null; asset_id: string | null; s3_key: string | null; size: string | null; mime_type: string | null }>(sql`
    WITH ${mainTreeCte(branchId, seq)}
    SELECT t.path, t.node_id, t.version, v.content_hash, v.asset_id, v.s3_key, v.size::text, v.mime_type
    FROM tree t LEFT JOIN file_versions v ON v.node_id = t.node_id AND v.version = t.version
    WHERE (${opts.cursor ?? null}::text IS NULL OR t.path COLLATE "C" > ${opts.cursor ?? null}::text COLLATE "C")
      AND (${opts.path ?? null}::text IS NULL OR t.path = ${opts.path ?? null}::text OR starts_with(t.path, ${opts.path ?? null}::text || '/'))
    ORDER BY t.path COLLATE "C" LIMIT ${limit + 1}`));
  const page = rows.slice(0, limit).map((r): TreeFile => ({ path: r.path, nodeId: r.node_id, version: r.version, contentHash: r.content_hash, assetId: r.asset_id, storageKey: r.s3_key, size: r.size == null ? null : Number(r.size), mimeType: r.mime_type }));
  return { files: page, nextCursor: rows.length > limit ? page.at(-1)!.path : null };
}

/** A file version's save (the version panel's "Save" link, H3). */
export async function saveOfVersion(actor: Actor, nodeId: string, version: number) {
  const [row] = await db.select({ id: saves.id, workspaceId: saves.workspaceId }).from(saveChanges).innerJoin(saves, eq(saves.id, saveChanges.saveId))
    .where(and(eq(saveChanges.nodeId, nodeId), eq(saveChanges.version, version), sql`${saves.seq} IS NOT NULL`)).orderBy(asc(saves.seq)).limit(1);
  if (!row) return null;
  await memberAccess(actor, row.workspaceId);
  return row.id;
}

// ── Revert (H3) ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A new save that undoes this one: a Part G change set with each file back as it was before the save, finished and
 * applied at once. Files changed since merge (G9); a conflict leaves the change set open to resolve in Changes.
 */
export async function revertSave(actor: Actor, request: Request, saveId: string, opts: { checkScope?: (scope: "file:final" | "doc:write") => Promise<Response | null> } = {}) {
  const { save, canWrite } = await findSave(actor, saveId);
  if (!canWrite) fail("You can read this workspace but not change it", 403, "FORBIDDEN");
  if (save.kind === "start") fail("The start of history can't be reverted", 409, "NOT_REVERTIBLE");
  const main = await mainBranch(save.workspaceId);
  const onBranch = save.branchId !== main.id;
  const changes = await db.select().from(saveChanges).where(and(eq(saveChanges.saveId, save.id), sql`${saveChanges.op} <> 'none'`)).limit(SAVE_LIMITS.changes + 1);
  if (changes.length > SAVE_LIMITS.changes) fail(`A save over ${SAVE_LIMITS.changes} files can't be reverted in one step`, 413, "CHANGE_SET_TOO_LARGE");
  const versions = new Map<string, { hash: string | null; size: number | null; mime: string | null }>();
  const keys = changes.flatMap((c) => (c.nodeId ? [c.version, c.previousVersion].filter((v): v is number => v != null).map((v) => ({ nodeId: c.nodeId!, v })) : []));
  if (keys.length) {
    const rows = await db.select({ nodeId: fileVersions.nodeId, version: fileVersions.version, hash: fileVersions.contentHash, size: fileVersions.size, mime: fileVersions.mimeType })
      .from(fileVersions).where(sql`(${fileVersions.nodeId}, ${fileVersions.version}) IN (${sql.join(keys.map((k) => sql`(${k.nodeId}::uuid, ${k.v}::int)`), sql`, `)})`);
    for (const r of rows) versions.set(`${r.nodeId}:${r.version}`, { hash: r.hash?.toLowerCase() ?? null, size: r.size == null ? null : Number(r.size), mime: r.mime });
  }
  type Side = { hash: string | null; size: number | null; mime: string | null } | null;
  // Main's changes name versions; a branch's carry their content hashes (H-2).
  const side = (c: typeof changes[number], which: "before" | "after"): Side => {
    if (c.nodeId) { const v = which === "before" ? c.previousVersion : c.version; return v == null ? null : versions.get(`${c.nodeId}:${v}`) ?? null; }
    const hash = which === "before" ? c.previousContentHash : c.contentHash;
    return hash ? { hash, size: which === "after" ? c.size ?? null : null, mime: c.mimeType } : null;
  };
  const needHash = (c: typeof changes[number]) => side(c, "before")?.hash ?? fail(`${c.path} has no stored content for that version, so it can't be reverted`, 409, "NOT_REVERTIBLE");
  const items: ItemInput[] = changes.map((c) => {
    const before = side(c, "before");
    const now = side(c, "after");
    if (c.op === "add") return { op: "delete", path: c.afterPath! };
    if (c.op === "delete") return { op: "add", path: c.beforePath!, contentHash: needHash(c), size: before?.size, mimeType: before?.mime };
    if (c.op === "change") return { op: "change", path: c.afterPath!, contentHash: needHash(c), baseVersion: c.version, baseHash: now?.hash, size: before?.size, mimeType: before?.mime };
    const contentBack = before?.hash !== now?.hash;
    return { op: "rename", fromPath: c.afterPath!, path: c.beforePath!, baseVersion: c.version, baseHash: now?.hash,
      contentHash: contentBack ? needHash(c) : now?.hash, size: (contentBack ? before : now)?.size, mimeType: (contentBack ? before : now)?.mime };
  });
  // On a protected main a revert is a change like any other (H3, H5): it goes on revert/save-<n> with a merge request.
  const { protectionOf } = await import("@/lib/domain/branch-protection");
  const rules = await protectionOf(main.id);
  const viaBranch = !onBranch && (rules.requireMergeRequest || (actor.tokenKind === "agent" && rules.agentsOnBranches))
    ? await (await import("@/lib/domain/branches")).createUniqueBranch(actor, save.workspaceId, `revert/save-${save.seq}`, save.taskId)
    : null;
  const set = await startChangeSet(actor, { workspaceId: save.workspaceId, title: `Revert "${(save.message ?? "save").slice(0, 100)}"`, taskId: save.taskId, branchId: viaBranch?.id ?? (onBranch ? save.branchId : null) });
  await db.update(changeSets).set({ revertsSaveId: save.id }).where(eq(changeSets.id, set.id));
  for (let i = 0; i < items.length; i += 200) await upsertItems(actor, set.id, items.slice(i, i + 200));
  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`(files_added + files_changed + files_deleted + files_renamed)::int` }).from(changeSets).where(eq(changeSets.id, set.id));
  if (!count) {
    await db.update(changeSets).set({ status: "discarded", discardedAt: new Date() }).where(eq(changeSets.id, set.id));
    return { outcome: "nothing" as const, changeSetId: null, saveId: null };
  }
  // Putting back content the workspace already held: a person's revert confirms a key-like file was there before;
  // an agent's can't (finishChangeSet refuses agents' confirmations), so the set stays open for the person.
  const finished = await finishChangeSet(actor, set.id, { confirmSecrets: actor.tokenKind !== "agent" });
  // The same checks as Apply: a doc or final file in the browser verifies it's you first; tokens need their scopes.
  const stepUp = await changeSetStepUp(actor, set.id);
  if (stepUp) fail("This revert touches a doc: verify it’s you, then apply it in Changes", 403, "STEP_UP_REQUIRED", { stepUp, changeSetId: set.id });
  try {
    await applyChangeSet(actor, request, set.id, { checkScope: opts.checkScope });
  } catch (error) {
    if (error instanceof ChangeSetError && error.code === "CHANGE_SET_CONFLICT") return { outcome: "conflicts" as const, changeSetId: set.id, saveId: null, conflicts: error.details?.conflicts ?? [] };
    throw error;
  }
  const [made] = await db.select({ id: saves.id }).from(saves).where(eq(saves.changeSetId, set.id)).orderBy(desc(saves.seq)).limit(1);
  if (viaBranch) {
    // An agent's apply on a branch already opened it (H7); otherwise it's opened here.
    const { createMergeRequest, openMergeRequestsOf } = await import("@/lib/domain/merge-requests");
    const open = (await openMergeRequestsOf([viaBranch.id])).get(viaBranch.id);
    const number = open?.number ?? (await createMergeRequest(actor, save.workspaceId, { source: viaBranch.name, title: set.title, taskId: save.taskId })).mergeRequest.number;
    return { outcome: "merge_request" as const, changeSetId: finished.changeSet.id, saveId: made?.id ?? null, branch: viaBranch.name, mergeRequest: number };
  }
  return { outcome: "reverted" as const, changeSetId: finished.changeSet.id, saveId: made?.id ?? null };
}

/** Still allowed to read this save (a long zip re-checks while it streams). */
export async function assertCanReadSave(actor: Actor, saveId: string) {
  await findSave(actor, saveId);
}

/** Files of a save's tree for a zip: path and storage key (H3 "Download as zip"). */
export async function zipEntriesAtSave(actor: Actor, saveId: string) {
  const { save } = await findSave(actor, saveId);
  if (save.branchId !== (await mainBranch(save.workspaceId)).id) fail("Download the branch itself as a zip", 409, "NOT_AVAILABLE");
  const entries: Array<{ path: string; storageKey: string; size: number }> = [];
  let cursor: string | null = null;
  do {
    const page = await treeAt(save.branchId, save.seq!, { cursor });
    for (const f of page.files) if (f.storageKey) entries.push({ path: f.path, storageKey: f.storageKey, size: f.size ?? 0 });
    if (entries.length > SAVE_LIMITS.zipFiles) fail("A zip holds at most 20,000 files; download a folder instead", 413, "TOO_LARGE");
    cursor = page.nextCursor;
  } while (cursor);
  return { save, entries };
}
