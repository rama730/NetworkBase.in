import "server-only";
/**
 * Change sets (report Part G): one named piece of multi-file work. Items wait here, apply in one transaction and undo
 * in one step. Every route, server action and MCP tool calls these functions, never the tables (G3).
 */
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, max, ne, or, sql } from "drizzle-orm";

import { CONFIRM_HEADER, agentAssignmentBlock, agentGate, issueConfirmToken, needsYes, recordUndo, spendConfirmToken, workspaceAgentPolicy, type ChangeKind } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { changeSetItems, changeSets, fileVersions, storageAssets, taskNodeLinks, undoOperations, workspaceDocuments, workspaceNodes, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { ensureParentFoldersTx } from "@/lib/files/ensure-folders";
import { assertWorkspaceWriteAccessTx, recordNodeEventsBatch } from "@/lib/files/internal-helpers";
import { nextFileRevisionNumber } from "@/lib/files/revision-policy";
import { scanForSecrets, type SecretFinding } from "@/lib/security/secret-scan";
import { viaColumns } from "@/lib/server/request-via";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeAndValidateMimeType } from "@/lib/upload/security";
import { unifiedDiff } from "../../../packages/nb-cli/lib/sync/diff.mjs";
import { isMergeableText, merge3 } from "../../../packages/nb-cli/lib/sync/merge3.mjs";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ChangeSet = typeof changeSets.$inferSelect;
export type ChangeSetItem = typeof changeSetItems.$inferSelect;

/** Who is asking: the shape requireAuthenticatedUser gives the routes. */
export type Actor = {
  user: { id: string } | null;
  tokenKind?: "device" | "agent" | "pat" | null;
  extensionSessionId?: string | null;
  tokenScopes?: Set<string> | null;
  tokenPersonAgreed?: boolean;
};

/** Limits (G13). */
export const LIMITS = {
  items: 2_000,
  bytes: 500 * 1024 * 1024,
  fileBytes: 25 * 1024 * 1024,
  openPerAgentSession: 3,
  openPerPerson: 10,
  draftBytesPerPerson: 1024 * 1024 * 1024,
  appliedPerAgentDay: 50,
  itemsPerCall: 200,
  inlineBytes: 4 * 1024 * 1024,
  smallFiles: 20,
  diffBytes: 1024 * 1024,
};

export class ChangeSetError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}
const fail = (message: string, status: number, code: string, details?: Record<string, unknown>): never => {
  throw new ChangeSetError(message, status, code, details);
};

// ── Paths ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** "/src/app.ts": NFC, forward slashes, one leading slash; refuses "..", Windows-reserved names and our own folders (G21). */
export function normalizeChangePath(raw: string): string {
  const parts = String(raw ?? "").normalize("NFC").replace(/\\/g, "/").split("/").filter(Boolean);
  const path = `/${parts.join("/")}`;
  if (!parts.length || path.length > 1024 || parts.length > 32) fail(`Not a usable path: ${raw}`, 400, "BAD_PATH");
  for (const part of parts) {
    if (part === "." || part === ".." || RESERVED.test(part) || /[\u0000-\u001f<>:"|?*]/.test(part) || /[. ]$/.test(part)) fail(`Not a usable path: ${raw}`, 400, "BAD_PATH");
  }
  if (parts[0] === ".networkbase" || parts[0] === ".system" || parts[0] === ".git") fail(`${path} is never synced`, 400, "BAD_PATH");
  return path;
}

const contentKey = (workspaceId: string, hash: string) => `${workspaceId}/.changes/${hash}`;
const isAgent = (actor: Actor) => actor.tokenKind === "agent";
const userOf = (actor: Actor) => actor.user?.id ?? fail("Sign in to continue", 401, "UNAUTHORIZED");

// ── Access ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function workspaceAccess(actor: Actor, workspaceId: string) {
  const access = await getWorkspaceAccessById(workspaceId, userOf(actor));
  if (!access.project || !access.canRead) fail("Workspace not found", 404, "NOT_FOUND");
  const isAdmin = access.isOwner || access.memberRole === "admin" || access.isInheritedAdmin;
  return { access, canWrite: access.canWrite, isAdmin };
}

async function requireEnabled(workspaceId: string) {
  const [row] = await db.select({ on: workspaces.changeSetsEnabled }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!row?.on) fail("Change sets aren't turned on for this workspace yet", 403, "CHANGE_SETS_OFF");
}

async function requireAgentAllowed(actor: Actor, workspaceId: string, taskId?: string | null) {
  if (!isAgent(actor)) return;
  if ((await workspaceAgentPolicy(workspaceId)).paused) fail("Agents are paused in this workspace", 403, "AGENTS_PAUSED");
  const blocked = await agentAssignmentBlock(taskId);
  if (blocked) fail(blocked, 403, "AGENT_NOT_ALLOWED");
}

/** The set, checked for what the actor wants to do with it (G13). */
async function loadForWrite(actor: Actor, changeSetId: string, mode: "author" | "author-or-admin") {
  const set = await findChangeSet(changeSetId);
  const { canWrite, isAdmin } = await workspaceAccess(actor, set.workspaceId);
  if (!canWrite) fail("You can read this workspace but not change it", 403, "FORBIDDEN");
  const own = set.authorId === userOf(actor);
  // Agents only ever act on their person's own sets; owners and admins may apply, discard or undo anyone's.
  if (!own && (mode === "author" || isAgent(actor) || !isAdmin)) fail("Only its author, or a workspace owner or admin, can do that", 403, "FORBIDDEN");
  await requireAgentAllowed(actor, set.workspaceId, set.taskId);
  return set;
}

async function findChangeSet(changeSetId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(changeSetId)) fail("Change set not found", 404, "NOT_FOUND");
  const [set] = await db.select().from(changeSets).where(eq(changeSets.id, changeSetId)).limit(1);
  return set ?? fail("Change set not found", 404, "NOT_FOUND");
}

// ── Start, list, read ─────────────────────────────────────────────────────────────────────────────────────────────

export async function startChangeSet(actor: Actor, input: { workspaceId: string; title: string; taskId?: string | null; message?: string | null }) {
  const userId = userOf(actor);
  const { canWrite } = await workspaceAccess(actor, input.workspaceId);
  if (!canWrite) fail("You can read this workspace but not change it", 403, "FORBIDDEN");
  await requireEnabled(input.workspaceId);
  await requireAgentAllowed(actor, input.workspaceId, input.taskId);
  const title = String(input.title ?? "").trim().slice(0, 120);
  if (!title) fail("A change set needs a title", 400, "BAD_REQUEST");
  const message = input.message?.trim().slice(0, 2000) || null;
  const sessionId = isAgent(actor) && actor.extensionSessionId && /^[0-9a-f-]{36}$/i.test(actor.extensionSessionId) ? actor.extensionSessionId : null;
  const open = and(eq(changeSets.workspaceId, input.workspaceId), inArray(changeSets.status, ["open", "ready"]));
  const [{ mine, session } = { mine: 0, session: 0 }] = await db
    .select({
      mine: sql<number>`count(*) filter (where ${changeSets.authorId} = ${userId})::int`,
      session: sessionId ? sql<number>`count(*) filter (where ${changeSets.agentSessionId} = ${sessionId})::int` : sql<number>`0`,
    })
    .from(changeSets)
    .where(open);
  if (sessionId && session >= LIMITS.openPerAgentSession) fail(`This agent sign-in has ${session} open change sets here; finish or discard one first`, 409, "CHANGE_SET_LIMIT");
  if (mine >= LIMITS.openPerPerson) fail(`You have ${mine} open change sets here; finish or discard one first`, 409, "CHANGE_SET_LIMIT");
  const [set] = await db.insert(changeSets).values({
    ...(await viaColumns()),
    workspaceId: input.workspaceId,
    taskId: input.taskId ?? null,
    authorId: userId,
    agentSessionId: sessionId,
    title,
    message,
  }).returning();
  return set!;
}

export async function listChangeSets(actor: Actor, workspaceId: string, opts: { status?: string | null; mine?: boolean; cursor?: string | null; limit?: number } = {}) {
  const userId = userOf(actor);
  const { canWrite } = await workspaceAccess(actor, workspaceId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const statuses = opts.status ? opts.status.split(",").filter((s) => ["open", "ready", "applying", "applied", "discarded", "undone"].includes(s)) : null;
  // Drafts are for people who can change the files; applied history is for everyone who can read them (G12).
  const visible = canWrite ? undefined : inArray(changeSets.status, ["applied", "undone"]);
  const rows = await db.select().from(changeSets)
    .where(and(
      eq(changeSets.workspaceId, workspaceId),
      visible,
      statuses?.length ? inArray(changeSets.status, statuses as ChangeSet["status"][]) : undefined,
      opts.mine ? eq(changeSets.authorId, userId) : undefined,
      opts.cursor ? lt(changeSets.updatedAt, new Date(opts.cursor)) : undefined,
    ))
    .orderBy(desc(changeSets.updatedAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return { changeSets: page, nextCursor: rows.length > limit ? page.at(-1)!.updatedAt.toISOString() : null };
}

export async function getChangeSet(actor: Actor, changeSetId: string, opts: { cursor?: string | null } = {}) {
  const set = await findChangeSet(changeSetId);
  const { canWrite } = await workspaceAccess(actor, set.workspaceId);
  if (!canWrite && !["applied", "undone"].includes(set.status)) fail("Change set not found", 404, "NOT_FOUND");
  const items = await db.select().from(changeSetItems)
    .where(and(eq(changeSetItems.changeSetId, set.id), opts.cursor ? sql`${changeSetItems.path} > ${opts.cursor}` : undefined))
    .orderBy(asc(changeSetItems.path))
    .limit(501);
  const page = items.slice(0, 500);
  return { changeSet: set, items: page, nextCursor: items.length > 500 ? page.at(-1)!.path : null };
}

// ── Items and content ─────────────────────────────────────────────────────────────────────────────────────────────

export type ItemInput = { op: "add" | "change" | "delete" | "rename"; path: string; fromPath?: string | null; baseVersion?: number | null; baseHash?: string | null; contentHash?: string | null; size?: number | null; mimeType?: string | null };

/** A new item makes a ready set open again (G5): the agent kept working. */
async function reopenIfReady(tx: DbTransaction, set: ChangeSet) {
  if (set.status === "ready") await tx.update(changeSets).set({ status: "open", readyAt: null }).where(eq(changeSets.id, set.id));
}

async function lockOpenSet(tx: DbTransaction, changeSetId: string) {
  const [set] = await tx.select().from(changeSets).where(eq(changeSets.id, changeSetId)).for("update");
  if (!set || !["open", "ready"].includes(set.status)) fail(`This change set is ${set?.status ?? "gone"}; start a new one`, 409, "CHANGE_SET_CLOSED");
  return set!;
}

/** Keeps the set's counts in step with its items (G4). */
async function recount(tx: DbTransaction, changeSetId: string) {
  await tx.execute(sql`
    UPDATE change_sets s SET
      files_added = c.added, files_changed = c.changed, files_deleted = c.deleted, files_renamed = c.renamed,
      lines_added = c.la, lines_removed = c.lr, bytes = c.bytes, updated_at = now()
    FROM (
      SELECT count(*) FILTER (WHERE op = 'add')::int AS added, count(*) FILTER (WHERE op = 'change')::int AS changed,
             count(*) FILTER (WHERE op = 'delete')::int AS deleted, count(*) FILTER (WHERE op = 'rename')::int AS renamed,
             coalesce(sum(lines_added), 0)::int AS la, coalesce(sum(lines_removed), 0)::int AS lr, coalesce(sum(size), 0)::bigint AS bytes
      FROM change_set_items WHERE change_set_id = ${changeSetId}
    ) c
    WHERE s.id = ${changeSetId}`);
}

/** The live file at a path, with its current content hash. */
async function liveFiles(workspaceId: string, paths: string[]) {
  if (!paths.length) return new Map<string, { id: string; version: number; hash: string | null; deletedAt: Date | null }>();
  const rows = await db.select({ id: workspaceNodes.id, path: workspaceNodes.path, version: workspaceNodes.currentVersion, hash: fileVersions.contentHash })
    .from(workspaceNodes)
    .leftJoin(fileVersions, and(eq(fileVersions.nodeId, workspaceNodes.id), eq(fileVersions.version, workspaceNodes.currentVersion)))
    .where(and(eq(workspaceNodes.projectId, workspaceId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), inArray(workspaceNodes.path, paths)));
  return new Map(rows.map((r) => [r.path, { id: r.id, version: r.version ?? 1, hash: r.hash?.toLowerCase() ?? null, deletedAt: null }]));
}

/** Verified content this workspace already has, by hash (G6: never uploaded twice). */
async function knownContent(workspaceId: string, hashes: string[]) {
  if (!hashes.length) return new Map<string, { id: string; size: number | null }>();
  const rows = await db.selectDistinctOn([storageAssets.contentHash], { hash: storageAssets.contentHash, id: storageAssets.id, size: storageAssets.verifiedSize })
    .from(storageAssets)
    .where(and(eq(storageAssets.projectId, workspaceId), eq(storageAssets.state, "verified"), inArray(storageAssets.contentHash, hashes)))
    .orderBy(storageAssets.contentHash, desc(storageAssets.createdAt));
  return new Map(rows.map((r) => [r.hash!, { id: r.id, size: r.size == null ? null : Number(r.size) }]));
}

/** PUT items (route 4): up to 200 at a time; answers with the content hashes still missing on the server. */
export async function upsertItems(actor: Actor, changeSetId: string, raw: ItemInput[]) {
  const userId = userOf(actor);
  if (!Array.isArray(raw) || !raw.length) fail("No items", 400, "BAD_REQUEST");
  if (raw.length > LIMITS.itemsPerCall) fail(`At most ${LIMITS.itemsPerCall} items per call`, 400, "BAD_REQUEST");
  const set = await loadForWrite(actor, changeSetId, "author");
  const items = raw.map((i) => {
    if (!["add", "change", "delete", "rename"].includes(i.op)) fail(`Unknown op ${i.op}`, 400, "BAD_REQUEST");
    const path = normalizeChangePath(i.path);
    const fromPath = i.op === "rename" ? normalizeChangePath(i.fromPath ?? fail("A rename needs fromPath", 400, "BAD_REQUEST")) : null;
    const contentHash = i.contentHash ? String(i.contentHash).toLowerCase() : null;
    if (contentHash && !/^[0-9a-f]{64}$/.test(contentHash)) fail(`Bad content hash for ${path}`, 400, "BAD_REQUEST");
    if ((i.op === "add" || i.op === "change") && !contentHash) fail(`${path} needs its content hash`, 400, "BAD_REQUEST");
    const size = i.op === "delete" ? null : Number(i.size ?? 0);
    if (size != null && (!Number.isFinite(size) || size < 0)) fail(`Bad size for ${path}`, 400, "BAD_REQUEST");
    if (size != null && size > LIMITS.fileBytes) fail(`${path} is over the 25 MB per-file limit`, 413, "FILE_TOO_LARGE");
    const mimeType = contentHash ? normalizeAndValidateMimeType(i.mimeType || "application/octet-stream") : null;
    return { op: i.op, path, fromPath, contentHash, size, mimeType, baseVersion: i.baseVersion ?? null, baseHash: i.baseHash ? String(i.baseHash).toLowerCase() : null };
  });
  const live = await liveFiles(set.workspaceId, [...new Set(items.flatMap((i) => [i.path, ...(i.fromPath ? [i.fromPath] : [])]))]);
  const known = await knownContent(set.workspaceId, [...new Set(items.flatMap((i) => (i.contentHash ? [i.contentHash] : [])))]);

  const missing = new Set<string>();
  await db.transaction(async (tx) => {
    const locked = await lockOpenSet(tx, set.id);
    for (const item of items) {
      const target = live.get(item.fromPath ?? item.path);
      let op = item.op;
      // An add over a file that exists is a change of it; a change or delete of a file that doesn't is refused.
      if (op === "add" && target) op = "change";
      if ((op === "change" || op === "delete" || op === "rename") && !target) {
        if (op === "change") op = "add";
        else fail(`${item.fromPath ?? item.path} isn't in the workspace`, 404, "NOT_FOUND");
      }
      const base = op === "add" ? null : { nodeId: target!.id, version: item.baseVersion ?? target!.version, hash: item.baseHash ?? target!.hash };
      // Back to the base content: nothing to apply, so the item goes (G8 step 5).
      if (op === "change" && base?.hash && item.contentHash === base.hash) {
        await tx.delete(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.path, item.path)));
        continue;
      }
      // A rename replaces any earlier item at its old path, keeping that item's base.
      if (item.fromPath) await tx.delete(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.path, item.fromPath)));
      const knownAsset = item.contentHash ? known.get(item.contentHash) ?? null : null;
      const assetId = knownAsset?.id ?? null;
      if (item.contentHash && !assetId) missing.add(item.contentHash);
      const values = {
        op, path: item.path, fromPath: op === "rename" ? item.fromPath : null,
        baseNodeId: base?.nodeId ?? null, baseVersion: base?.version ?? null, baseHash: base?.hash ?? null,
        contentHash: item.contentHash, assetId, size: knownAsset?.size ?? item.size, mimeType: item.mimeType,
        state: (item.contentHash && !assetId ? "pending" : "ready") as ChangeSetItem["state"],
        conflict: null, mergedAssetId: null, linesAdded: null, linesRemoved: null, updatedAt: new Date(),
      };
      await tx.insert(changeSetItems).values({ changeSetId: set.id, ...values })
        .onConflictDoUpdate({ target: [changeSetItems.changeSetId, changeSetItems.path], set: values });
    }
    const [{ count, bytes } = { count: 0, bytes: 0 }] = await tx.select({ count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${changeSetItems.size}), 0)::bigint` })
      .from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id));
    if (count > LIMITS.items) fail(`A change set holds at most ${LIMITS.items} files; split it into smaller change sets`, 413, "CHANGE_SET_TOO_LARGE");
    if (Number(bytes) > LIMITS.bytes) fail("A change set holds at most 500 MB; split it into smaller change sets", 413, "CHANGE_SET_TOO_LARGE");
    // Drafts count toward storage, capped per person per workspace (G6), so drafts can't get round the limit.
    const [{ drafts } = { drafts: 0 }] = await tx.select({ drafts: sql<number>`coalesce(sum(${changeSetItems.size}), 0)::bigint` })
      .from(changeSetItems).innerJoin(changeSets, eq(changeSets.id, changeSetItems.changeSetId))
      .where(and(eq(changeSets.workspaceId, set.workspaceId), eq(changeSets.authorId, userId), inArray(changeSets.status, ["open", "ready"])));
    if (Number(drafts) > LIMITS.draftBytesPerPerson) fail("Your drafts here are over 1 GB; apply or discard some first", 413, "STORAGE_LIMIT");
    await reopenIfReady(tx, locked);
    await recount(tx, set.id);
  });
  const rows = await db.select().from(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), inArray(changeSetItems.path, items.map((i) => i.path))));
  return { items: rows, missingContent: [...missing] };
}

/** DELETE one item (route 5): "revert this file" in the draft. */
export async function dropItem(actor: Actor, changeSetId: string, rawPath: string) {
  const set = await loadForWrite(actor, changeSetId, "author");
  const path = normalizeChangePath(rawPath);
  await db.transaction(async (tx) => {
    const locked = await lockOpenSet(tx, set.id);
    await tx.delete(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.path, path)));
    await reopenIfReady(tx, locked);
    await recount(tx, set.id);
  });
  return { ok: true };
}

/** Stores verified bytes once per workspace and marks the items waiting for them ready (G6). */
async function storeContent(set: ChangeSet, userId: string, hash: string, bytes: Buffer, mimeType: string) {
  const key = contentKey(set.workspaceId, hash);
  if (bytes.byteLength > LIMITS.fileBytes) fail("That file is over the 25 MB per-file limit", 413, "FILE_TOO_LARGE");
  const now = new Date();
  const [inserted] = await db.insert(storageAssets).values({
    ownerUserId: userId,
    projectId: set.workspaceId,
    bucket: "project-files",
    storageKey: key,
    purpose: "change_set_content",
    state: "verified",
    declaredMimeType: mimeType,
    declaredSize: bytes.byteLength,
    verifiedMimeType: mimeType,
    verifiedSize: bytes.byteLength,
    contentHash: hash,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
    verifiedAt: now,
    idempotencyKey: `change-content:${set.workspaceId}:${hash}`,
    requestFingerprint: crypto.createHash("sha256").update(`change-content:${set.workspaceId}:${hash}`).digest("hex"),
    metadata: { changeSetId: set.id, source: "change_set" },
  }).onConflictDoNothing().returning({ id: storageAssets.id });
  const assetId = inserted?.id ?? (await db.select({ id: storageAssets.id }).from(storageAssets).where(and(eq(storageAssets.bucket, "project-files"), eq(storageAssets.storageKey, key))).limit(1))[0]?.id;
  if (!assetId) fail("The stored content couldn't be recorded", 500, "INTERNAL_ERROR");
  // The size that counts is the stored bytes', not the one the client declared (limits, storage, apply).
  await db.transaction(async (tx) => {
    await tx.update(changeSetItems).set({ assetId, state: "ready", size: bytes.byteLength, updatedAt: now })
      .where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.contentHash, hash), eq(changeSetItems.state, "pending")));
    await recount(tx, set.id);
  });
  return assetId;
}

async function pendingMime(changeSetId: string, hash: string) {
  const [item] = await db.select({ mimeType: changeSetItems.mimeType, size: changeSetItems.size }).from(changeSetItems)
    .where(and(eq(changeSetItems.changeSetId, changeSetId), eq(changeSetItems.contentHash, hash))).limit(1);
  return item ?? fail(`No item in this change set has content ${hash.slice(0, 12)}…`, 400, "BAD_REQUEST");
}

/**
 * POST content (route 6). Inline `{ files: [{ hash, base64 }] }` up to 4 MB a call; or `{ hash }` for one larger file:
 * the first call answers with a signed upload URL, and the same call after the upload checks and records the bytes.
 */
export async function putContent(actor: Actor, changeSetId: string, body: { files?: Array<{ hash: string; base64: string }>; hash?: string; confirmSecrets?: boolean }) {
  const userId = userOf(actor);
  const set = await loadForWrite(actor, changeSetId, "author");
  if (!["open", "ready"].includes(set.status)) fail(`This change set is ${set.status}`, 409, "CHANGE_SET_CLOSED");
  const storage = (await createAdminClient()).storage.from("project-files");
  // Content that looks like it holds a password or key is never stored, so a draft can't spread it: people can
  // confirm it's safe, agents can't (G13). The items stay waiting, and finish names them.
  const held: Array<{ hash: string; findings: SecretFinding[] }> = [];
  const secretsIn = async (hash: string, bytes: Buffer) => {
    if (body.confirmSecrets && !isAgent(actor)) return false;
    const paths = await db.select({ path: changeSetItems.path }).from(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.contentHash, hash)));
    const findings = paths.flatMap((p) => scanForSecrets(p.path, bytes));
    if (findings.length) held.push({ hash, findings });
    return findings.length > 0;
  };
  if (Array.isArray(body.files)) {
    let total = 0;
    const stored: string[] = [];
    for (const file of body.files) {
      const hash = String(file.hash ?? "").toLowerCase();
      const bytes = Buffer.from(String(file.base64 ?? ""), "base64");
      total += bytes.byteLength;
      if (total > LIMITS.inlineBytes) fail("Inline content is limited to 4 MB a call; send the rest in another call", 413, "BAD_REQUEST");
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== hash) fail(`The bytes don't match ${hash.slice(0, 12)}…`, 400, "CONTENT_HASH_MISMATCH");
      if (await secretsIn(hash, bytes)) continue;
      const item = await pendingMime(set.id, hash);
      // The bytes match their hash, so writing them again over the same key changes nothing.
      const { error } = await storage.upload(contentKey(set.workspaceId, hash), bytes, { contentType: storableMime(item.mimeType), cacheControl: "31536000", upsert: true });
      if (error) fail(`Couldn't store ${hash.slice(0, 12)}…: ${error.message}`, 502, "INTERNAL_ERROR");
      await storeContent(set, userId, hash, bytes, item.mimeType ?? "application/octet-stream");
      stored.push(hash);
    }
    return { stored, held };
  }
  const hash = String(body.hash ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) fail("Send files, or the hash of one large file", 400, "BAD_REQUEST");
  const item = await pendingMime(set.id, hash);
  const key = contentKey(set.workspaceId, hash);
  // Content already stored and verified is never uploaded over, checked again or removed: the items just use it.
  const [verified] = await db.select({ id: storageAssets.id, size: storageAssets.verifiedSize }).from(storageAssets)
    .where(and(eq(storageAssets.bucket, "project-files"), eq(storageAssets.storageKey, key), eq(storageAssets.state, "verified"))).limit(1);
  if (verified) {
    await db.transaction(async (tx) => {
      await tx.update(changeSetItems).set({ assetId: verified.id, state: "ready", ...(verified.size != null ? { size: Number(verified.size) } : {}), updatedAt: new Date() })
        .where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.contentHash, hash), eq(changeSetItems.state, "pending")));
      await recount(tx, set.id);
    });
    return { stored: [hash] };
  }
  const { data: existing } = await storage.download(key);
  if (existing) {
    const bytes = Buffer.from(await existing.arrayBuffer());
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== hash || bytes.byteLength > LIMITS.fileBytes) {
      // Nothing refers to an unverified upload, so a wrong or oversized one goes.
      await storage.remove([key]);
      fail(bytes.byteLength > LIMITS.fileBytes ? "That file is over the 25 MB per-file limit" : "The uploaded bytes don't match the hash; upload again", bytes.byteLength > LIMITS.fileBytes ? 413 : 400, bytes.byteLength > LIMITS.fileBytes ? "FILE_TOO_LARGE" : "CONTENT_HASH_MISMATCH");
    }
    if (await secretsIn(hash, bytes)) {
      await storage.remove([key]);
      return { stored: [], held };
    }
    await storeContent(set, userId, hash, bytes, item.mimeType ?? "application/octet-stream");
    return { stored: [hash], held };
  }
  const { data, error } = await storage.createSignedUploadUrl(key);
  if (error || !data) fail("Couldn't prepare the upload", 502, "INTERNAL_ERROR");
  return { upload: { url: data!.signedUrl, token: data!.token, contentType: storableMime(item.mimeType) } };
}

/** The bucket refuses some types (drizzle/0003_storage.sql, SVG by the upload rule): those are stored as bytes. */
function storableMime(mime: string | null) {
  const m = (mime ?? "").toLowerCase();
  if (m === "image/svg+xml" || !m) return "application/octet-stream";
  return m.startsWith("text/") && !["text/plain", "text/markdown", "text/csv", "text/html", "text/css", "text/javascript", "text/xml"].includes(m) ? "text/plain" : m;
}

// ── Finish ────────────────────────────────────────────────────────────────────────────────────────────────────────

const isTextual = (bytes: Buffer) => bytes.byteLength <= LIMITS.diffBytes && !bytes.subarray(0, 8192).includes(0);

async function readAsset(assetId: string | null) {
  if (!assetId) return null;
  const [asset] = await db.select({ key: storageAssets.storageKey }).from(storageAssets).where(eq(storageAssets.id, assetId)).limit(1);
  if (!asset) return null;
  const { data } = await (await createAdminClient()).storage.from("project-files").download(asset.key);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

async function baseAssetOf(item: ChangeSetItem) {
  if (!item.baseNodeId || item.baseVersion == null) return null;
  const [v] = await db.select({ assetId: fileVersions.assetId }).from(fileVersions)
    .where(and(eq(fileVersions.nodeId, item.baseNodeId), eq(fileVersions.version, item.baseVersion))).limit(1);
  return v?.assetId ?? null;
}

/** Runs `fn` over `list`, `n` at a time. */
async function inBatches<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < list.length; i += n) await Promise.all(list.slice(i, i + n).map(fn));
}

/** The item list's fingerprint: a yes covers exactly these items (G13). */
async function itemsHash(changeSetId: string) {
  const rows = await db.select({ op: changeSetItems.op, path: changeSetItems.path, from: changeSetItems.fromPath, hash: changeSetItems.contentHash })
    .from(changeSetItems).where(eq(changeSetItems.changeSetId, changeSetId)).orderBy(asc(changeSetItems.path));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("base64url");
}

/** What the set touches that needs the person's yes for agents: deletes, finals, docs, size (G13). */
async function changeKinds(set: ChangeSet): Promise<{ kinds: ChangeKind[]; finals: boolean; docs: boolean }> {
  const items = await db.select({ op: changeSetItems.op, nodeId: changeSetItems.baseNodeId }).from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id));
  const nodeIds = items.flatMap((i) => (i.nodeId ? [i.nodeId] : []));
  const [finals, docs] = nodeIds.length
    ? await Promise.all([
      db.select({ id: taskNodeLinks.nodeId }).from(taskNodeLinks).where(and(inArray(taskNodeLinks.nodeId, nodeIds), sql`${taskNodeLinks.tags} ? 'deliverable'`)).limit(1),
      db.select({ id: workspaceDocuments.id }).from(workspaceDocuments).where(and(eq(workspaceDocuments.projectId, set.workspaceId), inArray(workspaceDocuments.linkedNodeId, nodeIds))).limit(1),
    ])
    : [[], []];
  const kinds: ChangeKind[] = [
    items.length > LIMITS.smallFiles ? "batch" : "small",
    items.some((i) => i.op === "delete") ? "file-move" : "small",
    finals.length ? "final" : "small",
    docs.length ? "doc" : "small",
  ];
  return { kinds, finals: finals.length > 0, docs: docs.length > 0 };
}

/**
 * Finish (route 7): all content stored, secrets checked, line counts made; the set becomes ready. Answers whether it
 * can be applied now or needs the person's yes first (for agents, with the confirmation token for exactly these items).
 */
export async function finishChangeSet(actor: Actor, changeSetId: string, opts: { message?: string | null; confirmSecrets?: boolean } = {}) {
  const userId = userOf(actor);
  const set = await loadForWrite(actor, changeSetId, "author");
  if (!["open", "ready"].includes(set.status)) fail(`This change set is ${set.status}`, 409, "CHANGE_SET_CLOSED");
  const items = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id));
  if (!items.length) fail("This change set has no files yet", 409, "CHANGE_SET_NOT_READY");
  const realBytes = items.reduce((sum, i) => sum + Number(i.size ?? 0), 0);
  if (realBytes > LIMITS.bytes) fail("A change set holds at most 500 MB; split it into smaller change sets", 413, "CHANGE_SET_TOO_LARGE");
  const pending = items.filter((i) => i.state === "pending");
  if (pending.length) fail(`${pending.length} file${pending.length === 1 ? "" : "s"} not uploaded yet (or held because ${pending.length === 1 ? "it looks" : "they look"} like ${pending.length === 1 ? "it holds" : "they hold"} a key)`, 409, "CONTENT_MISSING", { missing: pending.map((i) => ({ path: i.path, contentHash: i.contentHash })) });

  const findings: SecretFinding[] = [];
  const lines = new Map<string, { added: number; removed: number }>();
  await inBatches(items.filter((i) => i.assetId && (i.size ?? 0) <= LIMITS.diffBytes), 8, async (item) => {
    const mine = await readAsset(item.assetId);
    if (!mine || !isTextual(mine)) return;
    findings.push(...scanForSecrets(item.path, mine));
    const base = item.op === "add" ? Buffer.alloc(0) : await readAsset(await baseAssetOf(item));
    if (!base || !isTextual(base)) return;
    const diff = unifiedDiff(base.toString("utf8"), mine.toString("utf8"));
    if (diff) lines.set(item.id, { added: diff.added, removed: diff.removed });
  });
  // People can confirm a finding (as with pushes); agents can't (G13).
  if (findings.length && (isAgent(actor) || !opts.confirmSecrets)) {
    fail("These files look like they contain passwords or keys", 422, "SECRET_DETECTED", { findings });
  }

  await db.transaction(async (tx) => {
    await lockOpenSet(tx, set.id);
    for (const [id, l] of lines) await tx.update(changeSetItems).set({ linesAdded: l.added, linesRemoved: l.removed }).where(eq(changeSetItems.id, id));
    await recount(tx, set.id);
    await tx.update(changeSets).set({ status: "ready", readyAt: new Date(), ...(opts.message != null ? { message: opts.message.trim().slice(0, 2000) || null } : {}) }).where(eq(changeSets.id, set.id));
  });
  const [ready] = await db.select().from(changeSets).where(eq(changeSets.id, set.id));
  const { kinds } = await changeKinds(ready!);
  const { policy } = await workspaceAgentPolicy(set.workspaceId);
  const big = needsYes(kinds, policy);
  const summary = describeSet(ready!);
  if (!big) return { changeSet: ready!, summary, decision: "apply_now" as const };
  const confirm = isAgent(actor) && actor.extensionSessionId
    ? issueConfirmToken({ userId, sessionId: actor.extensionSessionId, body: { changeSetId: set.id, items: await itemsHash(set.id) } })
    : null;
  return { changeSet: ready!, summary, decision: "needs_confirmation" as const, ...(confirm ? { confirmToken: confirm.token, expiresAt: confirm.expiresAt.toISOString(), header: CONFIRM_HEADER } : {}) };
}

/** "Redesign sign-in: 23 files (3 added, 19 changed, 1 deleted), +410 −120". */
export function describeSet(set: Pick<ChangeSet, "title" | "filesAdded" | "filesChanged" | "filesDeleted" | "filesRenamed" | "linesAdded" | "linesRemoved">) {
  const total = set.filesAdded + set.filesChanged + set.filesDeleted + set.filesRenamed;
  const parts = [
    set.filesAdded && `${set.filesAdded} added`,
    set.filesChanged && `${set.filesChanged} changed`,
    set.filesDeleted && `${set.filesDeleted} deleted`,
    set.filesRenamed && `${set.filesRenamed} renamed`,
  ].filter(Boolean);
  const lineWords = set.linesAdded || set.linesRemoved ? `, +${set.linesAdded} −${set.linesRemoved}` : "";
  return `${set.title}: ${total} file${total === 1 ? "" : "s"}${parts.length ? ` (${parts.join(", ")})` : ""}${lineWords}`;
}

// ── Apply ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Conflict = { path: string; kind: "edit" | "deleted" | "exists" | "moved" | "folder_gone"; currentVersion?: number | null; nodeId?: string | null };
type Planned = { item: ChangeSetItem; nodeId: string | null; expectVersion: number | null };

/**
 * Prepare (G10 step 1): reads each file now. A file changed since its base is a conflict until G-3 merges it; the
 * person chooses mine or theirs with resolve.
 */
async function prepare(set: ChangeSet) {
  const items = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id)).orderBy(asc(changeSetItems.path));
  const { conflicts, nodes } = await rebase(set, items);
  const addPaths = await liveFiles(set.workspaceId, items.filter((i) => i.op === "add").map((i) => i.path));
  const fresh = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id)).orderBy(asc(changeSetItems.path));
  const planned: Planned[] = fresh.filter((i) => i.state !== "conflict").map((item) => {
    if (item.op === "add") { const taken = addPaths.get(item.path); return { item, nodeId: taken?.id ?? null, expectVersion: taken?.version ?? null }; }
    const node = nodes.get(item.baseNodeId!);
    return { item, nodeId: node?.id ?? item.baseNodeId, expectVersion: node?.version ?? item.baseVersion };
  });
  return { planned, conflicts };
}

type LiveNode = { id: string; path: string; version: number; deletedAt: Date | null; hash: string | null; assetId: string | null };

/**
 * Brings items whose file changed since their base up to date (G9): a clean three-way merge becomes the item's content
 * with the current version as its new base ("merged automatically"); anything else is a conflict to resolve.
 * Used by prepare (apply) and by "update the draft" (route 10).
 */
async function rebase(set: ChangeSet, items: ChangeSetItem[]) {
  const nodeIds = items.flatMap((i) => (i.baseNodeId ? [i.baseNodeId] : []));
  const rows = nodeIds.length
    ? await db.select({ id: workspaceNodes.id, path: workspaceNodes.path, version: workspaceNodes.currentVersion, deletedAt: workspaceNodes.deletedAt, hash: fileVersions.contentHash, assetId: workspaceNodes.assetId })
      .from(workspaceNodes)
      .leftJoin(fileVersions, and(eq(fileVersions.nodeId, workspaceNodes.id), eq(fileVersions.version, workspaceNodes.currentVersion)))
      .where(inArray(workspaceNodes.id, nodeIds))
    : [];
  const nodes = new Map<string, LiveNode>(rows.map((n) => [n.id, { ...n, version: n.version ?? 1, hash: n.hash?.toLowerCase() ?? null }]));
  const taken = await liveFiles(set.workspaceId, items.filter((i) => i.op === "add" || i.op === "rename").map((i) => i.path));
  const conflicts: Conflict[] = [];
  const merged: string[] = [];
  const mark = async (item: ChangeSetItem, c: Conflict) => {
    conflicts.push(c);
    await db.update(changeSetItems).set({ state: "conflict", conflict: { kind: c.kind, currentVersion: c.currentVersion ?? null, nodeId: c.nodeId ?? null }, updatedAt: new Date() }).where(eq(changeSetItems.id, item.id));
  };
  for (const item of items) {
    if (item.state === "pending") continue;
    if (item.op === "add") {
      const t = taken.get(item.path);
      if (t) await mark(item, { path: item.path, kind: "exists", nodeId: t.id, currentVersion: t.version });
      continue;
    }
    const node = item.baseNodeId ? nodes.get(item.baseNodeId) : undefined;
    if (!node || node.deletedAt) { await mark(item, { path: item.fromPath ?? item.path, kind: "deleted", nodeId: item.baseNodeId }); continue; }
    if (node.path !== (item.fromPath ?? item.path)) { await mark(item, { path: item.fromPath ?? item.path, kind: "moved", nodeId: node.id, currentVersion: node.version }); continue; }
    if (item.op === "rename" && taken.get(item.path)) { await mark(item, { path: item.path, kind: "exists", nodeId: taken.get(item.path)!.id }); continue; }
    const changedSince = node.version !== item.baseVersion && node.hash !== item.baseHash;
    if (!changedSince) {
      if (item.state === "conflict") await db.update(changeSetItems).set({ state: "ready", conflict: null, updatedAt: new Date() }).where(eq(changeSetItems.id, item.id));
      continue;
    }
    const result = item.op === "delete" || !item.contentHash ? null : await mergeItem(set, item, node);
    if (!result) { await mark(item, { path: item.path, kind: "edit", nodeId: node.id, currentVersion: node.version }); continue; }
    merged.push(item.path);
    const lines = unifiedDiff(result.theirs, result.text);
    await db.update(changeSetItems).set({
      baseVersion: node.version, baseHash: node.hash, contentHash: result.hash, assetId: result.assetId, mergedAssetId: result.assetId, size: result.size,
      state: "merged", conflict: { kind: "merged", from: item.baseVersion, onto: node.version }, linesAdded: lines?.added ?? null, linesRemoved: lines?.removed ?? null, updatedAt: new Date(),
    }).where(eq(changeSetItems.id, item.id));
  }
  await db.transaction((tx) => recount(tx, set.id));
  return { conflicts, merged, nodes };
}

/** base + theirs + mine → merged content stored as new content, or null when it can't merge cleanly. */
async function mergeItem(set: ChangeSet, item: ChangeSetItem, node: LiveNode) {
  const [base, theirs, mine] = await Promise.all([readAsset(await baseAssetOf(item)), readAsset(node.assetId), readAsset(item.assetId)]);
  if (!base || !theirs || !mine || ![base, theirs, mine].every((b) => isMergeableText(b))) return null;
  const result = merge3(base.toString("utf8"), theirs.toString("utf8"), mine.toString("utf8"));
  if (!result.ok) return null;
  const bytes = Buffer.from(result.text, "utf8");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const assetId = await storeBytes(set, hash, bytes, item.mimeType);
  return { text: result.text, theirs: theirs.toString("utf8"), hash, size: bytes.byteLength, assetId };
}

/** Content made on the server (a merge, a resolved result): stored once, verified. */
async function storeBytes(set: ChangeSet, hash: string, bytes: Buffer, mimeType: string | null) {
  const key = contentKey(set.workspaceId, hash);
  const [have] = await db.select({ id: storageAssets.id }).from(storageAssets).where(and(eq(storageAssets.bucket, "project-files"), eq(storageAssets.storageKey, key), eq(storageAssets.state, "verified"))).limit(1);
  if (have) return have.id;
  const { error } = await (await createAdminClient()).storage.from("project-files").upload(key, bytes, { contentType: storableMime(mimeType), cacheControl: "31536000", upsert: true });
  if (error) fail(`Couldn't store the merged file: ${error.message}`, 502, "INTERNAL_ERROR");
  const now = new Date();
  const [row] = await db.insert(storageAssets).values({
    ownerUserId: set.authorId, projectId: set.workspaceId, bucket: "project-files", storageKey: key, purpose: "change_set_content", state: "verified",
    declaredMimeType: mimeType ?? "text/plain", declaredSize: bytes.byteLength, verifiedMimeType: mimeType ?? "text/plain", verifiedSize: bytes.byteLength, contentHash: hash,
    expiresAt: new Date(now.getTime() + 15 * 60_000), verifiedAt: now, idempotencyKey: `change-content:${set.workspaceId}:${hash}`,
    requestFingerprint: crypto.createHash("sha256").update(`change-content:${set.workspaceId}:${hash}`).digest("hex"), metadata: { changeSetId: set.id, source: "change_set_merge" },
  }).onConflictDoNothing().returning({ id: storageAssets.id });
  return row?.id ?? (await db.select({ id: storageAssets.id }).from(storageAssets).where(and(eq(storageAssets.bucket, "project-files"), eq(storageAssets.storageKey, key))).limit(1))[0]!.id;
}

/** "Update the draft" (route 10): merges the workspace's newer versions into the items now, before apply. */
export async function updateDraft(actor: Actor, changeSetId: string) {
  const set = await loadForWrite(actor, changeSetId, "author");
  if (!["open", "ready"].includes(set.status)) fail(`This change set is ${set.status}`, 409, "CHANGE_SET_CLOSED");
  const items = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id));
  const { merged, conflicts } = await rebase(set, items);
  const rows = merged.length ? await db.select().from(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), inArray(changeSetItems.path, merged))) : [];
  return { merged: rows.map((r) => ({ path: r.path, contentHash: r.contentHash, baseVersion: r.baseVersion, baseHash: r.baseHash })), conflicts };
}

/**
 * Resolve one conflicted file (route 11, G9): `mine` applies the item over what's there now, `theirs` drops it,
 * `content` makes the given text (or an uploaded hash) the item's content on top of the current version.
 */
export async function resolveItem(actor: Actor, changeSetId: string, input: { path: string; choice: "mine" | "theirs" | "content"; contentHash?: string | null; text?: string | null }) {
  const set = await loadForWrite(actor, changeSetId, "author-or-admin");
  if (!["open", "ready"].includes(set.status)) fail(`This change set is ${set.status}`, 409, "CHANGE_SET_CLOSED");
  const path = normalizeChangePath(input.path);
  const [item] = await db.select().from(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), or(eq(changeSetItems.path, path), eq(changeSetItems.fromPath, path)))).limit(1);
  if (!item) fail("That file isn't in this change set", 404, "NOT_FOUND");
  if (input.choice === "theirs") {
    await db.transaction(async (tx) => { await tx.delete(changeSetItems).where(eq(changeSetItems.id, item!.id)); await recount(tx, set.id); });
    return { item: null };
  }
  const kind = (item!.conflict as { kind?: string } | null)?.kind;
  // The file as it is now becomes the base, so apply sees no change since.
  const [live] = await liveFiles(set.workspaceId, [item!.path]).then((m) => [...m.values()]);
  const baseNode = kind === "deleted" ? null : live ?? (item!.baseNodeId ? (await db.select({ id: workspaceNodes.id, version: workspaceNodes.currentVersion, deletedAt: workspaceNodes.deletedAt }).from(workspaceNodes).where(eq(workspaceNodes.id, item!.baseNodeId)).limit(1))[0] : null);
  const [baseVersionRow] = baseNode && !baseNode.deletedAt ? await db.select({ hash: fileVersions.contentHash }).from(fileVersions).where(and(eq(fileVersions.nodeId, baseNode.id), eq(fileVersions.version, (baseNode as { version: number }).version))).limit(1) : [];
  const rebased = baseNode && !baseNode.deletedAt
    ? { op: (item!.op === "add" ? "change" : item!.op === "rename" && kind === "exists" ? "change" : item!.op) as ChangeSetItem["op"], baseNodeId: baseNode.id, baseVersion: (baseNode as { version: number }).version, baseHash: baseVersionRow?.hash?.toLowerCase() ?? null }
    : { op: (item!.op === "delete" ? "delete" : "add") as ChangeSetItem["op"], baseNodeId: null, baseVersion: null, baseHash: null };
  if (rebased.op === "delete" && !rebased.baseNodeId) {
    // Deleting a file that's already gone: nothing to do.
    await db.transaction(async (tx) => { await tx.delete(changeSetItems).where(eq(changeSetItems.id, item!.id)); await recount(tx, set.id); });
    return { item: null };
  }
  let content: { contentHash: string | null; assetId: string | null; size: number | null; state: ChangeSetItem["state"] } = { contentHash: item!.contentHash, assetId: item!.assetId, size: item!.size, state: "ready" };
  if (input.choice === "content") {
    if (input.text != null) {
      const bytes = Buffer.from(String(input.text), "utf8");
      if (bytes.byteLength > LIMITS.fileBytes) fail("That file is over the 25 MB per-file limit", 413, "FILE_TOO_LARGE");
      const findings = scanForSecrets(item!.path, bytes);
      if (findings.length && isAgent(actor)) fail("That text looks like it holds a password or key", 422, "SECRET_DETECTED", { findings });
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      content = { contentHash: hash, assetId: await storeBytes(set, hash, bytes, item!.mimeType), size: bytes.byteLength, state: "ready" };
    } else {
      const hash = String(input.contentHash ?? "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(hash)) fail("Send the resolved text, or the hash of uploaded content", 400, "BAD_REQUEST");
      const known = (await knownContent(set.workspaceId, [hash])).get(hash);
      content = { contentHash: hash, assetId: known?.id ?? null, size: known?.size ?? null, state: known ? "ready" : "pending" };
    }
  }
  // Moved since: the edit goes to the file at its new path (G9 "apply the edit at the new path").
  const movedTo = kind === "moved" && item!.baseNodeId
    ? (await db.select({ path: workspaceNodes.path }).from(workspaceNodes).where(and(eq(workspaceNodes.id, item!.baseNodeId), isNull(workspaceNodes.deletedAt))).limit(1))[0]?.path ?? null
    : null;
  if (movedTo) {
    const [moved] = await db.select({ version: workspaceNodes.currentVersion, hash: fileVersions.contentHash }).from(workspaceNodes)
      .leftJoin(fileVersions, and(eq(fileVersions.nodeId, workspaceNodes.id), eq(fileVersions.version, workspaceNodes.currentVersion))).where(eq(workspaceNodes.id, item!.baseNodeId!)).limit(1);
    Object.assign(rebased, { op: item!.op === "rename" ? "change" : item!.op, baseNodeId: item!.baseNodeId, baseVersion: moved?.version ?? null, baseHash: moved?.hash?.toLowerCase() ?? null });
  }
  const [row] = await db.transaction(async (tx) => {
    const updated = await tx.update(changeSetItems).set({
      ...rebased, ...content, ...(movedTo ? { path: movedTo } : {}), fromPath: rebased.op === "rename" && !movedTo ? item!.fromPath : null, mergedAssetId: null, conflict: { kind: "resolved", choice: input.choice, was: kind ?? null }, updatedAt: new Date(),
    }).where(eq(changeSetItems.id, item!.id)).returning();
    await recount(tx, set.id);
    return updated;
  });
  return { item: row, ...(row?.state === "pending" ? { missingContent: [row.contentHash] } : {}) };
}

/** The three sides of a conflicted or merged text file, for the merge editor (G12): base, theirs, mine. */
export async function conflictSides(actor: Actor, changeSetId: string, rawPath: string) {
  const set = await loadForWrite(actor, changeSetId, "author-or-admin");
  const path = normalizeChangePath(rawPath);
  const [item] = await db.select().from(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.path, path))).limit(1);
  if (!item) fail("That file isn't in this change set", 404, "NOT_FOUND");
  const nodeId = (item!.conflict as { nodeId?: string } | null)?.nodeId ?? item!.baseNodeId;
  const [node] = nodeId ? await db.select({ assetId: workspaceNodes.assetId, deletedAt: workspaceNodes.deletedAt }).from(workspaceNodes).where(eq(workspaceNodes.id, nodeId)).limit(1) : [];
  const text = async (id: string | null | undefined) => {
    const b = id ? await readAsset(id) : null;
    return b && isMergeableText(b) ? b.toString("utf8") : null;
  };
  const [base, theirs, mine] = await Promise.all([text(await baseAssetOf(item!)), text(node && !node.deletedAt ? node.assetId : null), text(item!.assetId)]);
  return { path, kind: (item!.conflict as { kind?: string } | null)?.kind ?? null, base, theirs, mine };
}

class Raced extends Error {}

export type ApplyResult = {
  applied: Array<{ path: string; nodeId: string; version: number | null; op: ChangeSetItem["op"] }>;
  undo: Array<{ nodeId: string; op: ChangeSetItem["op"]; version: number | null; previousVersion: number | null; fromPath: string | null; path: string }>;
  undoToken: string | null;
};

/** Apply (route 9): all items in one transaction (G10), or nothing. Repeating it returns the stored result. */
export async function applyChangeSet(actor: Actor, request: Request, changeSetId: string, opts: { confirmToken?: string | null; only?: string[] | null; checkScope?: (scope: "file:final" | "doc:write") => Promise<Response | null> } = {}) {
  const userId = userOf(actor);
  let set = await loadForWrite(actor, changeSetId, "author-or-admin");
  if (set.status === "applied" && set.applyResult) return { changeSet: set, ...(set.applyResult as unknown as ApplyResult) };
  if (opts.only?.length) {
    // Apply only some files is the person's choice in review (G12), from a finished set (secrets checked, content complete).
    if (isAgent(actor)) fail("Agents apply whole change sets; the person can apply only some files in the app", 403, "FORBIDDEN");
    if (set.status !== "ready") fail("Finish the change set first", 409, "CHANGE_SET_NOT_READY");
    set = await splitOff(actor, set, opts.only);
  }
  if (set.status !== "ready") fail(set.status === "open" ? "Finish the change set first" : `This change set is ${set.status}`, 409, "CHANGE_SET_NOT_READY");

  const { kinds, finals, docs } = await changeKinds(set);
  // Finals and docs need their own token permissions; agents can ask their person for more (report A5).
  for (const scope of [finals && "file:final", docs && "doc:write"] as const) {
    const denied = scope && opts.checkScope ? await opts.checkScope(scope) : null;
    if (denied) throw new HeldResponse(denied);
  }
  if (isAgent(actor)) {
    const [{ today } = { today: 0 }] = await db.select({ today: sql<number>`count(*)::int` }).from(changeSets)
      .where(and(eq(changeSets.appliedBy, userId), eq(changeSets.via, "agent"), sql`${changeSets.appliedAt} > now() - interval '1 day'`));
    if (today >= LIMITS.appliedPerAgentDay) fail("Agents applied 50 change sets here today; the person can apply more", 429, "RATE_LIMITED");
    const body = { changeSetId: set.id, items: await itemsHash(set.id) };
    const ok = opts.confirmToken && actor.extensionSessionId
      ? await spendConfirmToken(opts.confirmToken, { userId, sessionId: actor.extensionSessionId, body })
      : false;
    if (!ok) {
      const held = await agentGate(actor, request, body, { workspaceId: set.workspaceId, kinds, summary: `Apply ${describeSet(set)}`, taskId: set.taskId });
      if (held) throw new HeldResponse(held);
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { planned, conflicts } = await prepare(set);
    if (conflicts.length) fail(`${conflicts.length} file${conflicts.length === 1 ? "" : "s"} changed since this change set started`, 409, "CHANGE_SET_CONFLICT", { conflicts });
    try {
      const result = await applyPlanned(set, planned, userId);
      return finishApply(actor, set, result);
    } catch (error) {
      if (!(error instanceof Raced) || attempt === 1) throw error;
      // A teammate saved between prepare and apply: prepare once more (G10 step 2.3).
    }
  }
  return fail("Couldn't apply; try again", 409, "CHANGE_SET_CONFLICT");
}

/** A 428 from the agent gate, passed through to the route unchanged. */
export class HeldResponse extends Error {
  constructor(readonly response: Response) { super("needs confirmation"); }
}

async function applyPlanned(set: ChangeSet, planned: Planned[], userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const [locked] = await tx.select().from(changeSets).where(eq(changeSets.id, set.id)).for("update");
    if (locked?.status === "applied" && locked.applyResult) return { already: locked.applyResult as unknown as ApplyResult };
    if (locked?.status !== "ready") fail(`This change set is ${locked?.status ?? "gone"}`, 409, "CHANGE_SET_NOT_READY");
    // Lock every target in node-id order, so two applies never deadlock (G10 step 2.2).
    const ids = [...new Set(planned.flatMap((p) => (p.nodeId ? [p.nodeId] : [])))].sort();
    if (ids.length) await tx.execute(sql`SELECT id FROM workspace_nodes WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
    const now = new Date();
    const applied: ApplyResult["applied"] = [];
    const undo: ApplyResult["undo"] = [];
    const assetKeys = new Map<string, string>();
    const assetIds = [...new Set(planned.flatMap((p) => (p.item.mergedAssetId ?? p.item.assetId ? [(p.item.mergedAssetId ?? p.item.assetId)!] : [])))];
    if (assetIds.length) for (const a of await tx.select({ id: storageAssets.id, key: storageAssets.storageKey }).from(storageAssets).where(inArray(storageAssets.id, assetIds))) assetKeys.set(a.id, a.key);
    const via = await viaColumns();

    for (const { item, nodeId, expectVersion } of planned) {
      await assertWorkspaceWriteAccessTx(tx, set.workspaceId, userId, nodeId ? { nodeId } : undefined);
      let node = nodeId ? (await tx.select().from(workspaceNodes).where(eq(workspaceNodes.id, nodeId)).limit(1))[0] : undefined;
      // Re-check: the file must still be at the version prepare saw (G10 step 2.3).
      if (nodeId && (!node || node.deletedAt || node.currentVersion !== expectVersion)) throw new Raced();
      const assetId = item.mergedAssetId ?? item.assetId;
      const writeVersion = async (target: typeof workspaceNodes.$inferSelect, created: boolean) => {
        const key = assetId ? assetKeys.get(assetId) : null;
        if (!assetId || !key) fail(`The content of ${item.path} is missing`, 409, "CONTENT_MISSING");
        const [history] = await tx.select({ highest: max(fileVersions.version) }).from(fileVersions).where(eq(fileVersions.nodeId, target.id));
        const version = created && !history?.highest ? 1 : nextFileRevisionNumber(Math.max(1, target.currentVersion ?? 1), history?.highest);
        await tx.insert(fileVersions).values({
          ...via, nodeId: target.id, version, s3Key: key!, assetId, size: Number(item.size ?? 0), mimeType: item.mimeType ?? "application/octet-stream",
          contentHash: item.contentHash, uploadedBy: userId, uploadedAt: now, attribution: { source: "change_set", changeSetId: set.id },
          comment: set.title, basedOnVersion: created ? null : target.currentVersion, changeSetId: set.id,
        });
        await tx.update(workspaceNodes).set({ s3Key: key!, assetId, size: Number(item.size ?? 0), mimeType: item.mimeType ?? "application/octet-stream", currentVersion: version, syncStatus: "merged", updatedAt: now })
          .where(eq(workspaceNodes.id, target.id));
        return version;
      };

      if (item.op === "add" && !node) {
        const parentId = await ensureParentFoldersTx(tx, set.workspaceId, item.path, userId);
        const [made] = await tx.insert(workspaceNodes).values({
          projectId: set.workspaceId, parentId, path: item.path, type: "file", name: item.path.split("/").pop()!, size: 0, currentVersion: 1, createdBy: userId, syncStatus: "merged",
        }).returning();
        const version = await writeVersion(made!, true);
        applied.push({ path: item.path, nodeId: made!.id, version, op: "add" });
        undo.push({ nodeId: made!.id, op: "add", version, previousVersion: null, fromPath: null, path: item.path });
      } else if (item.op === "delete") {
        await tx.update(workspaceNodes).set({ deletedAt: now, deletedBy: userId, updatedAt: now }).where(eq(workspaceNodes.id, node!.id));
        applied.push({ path: item.path, nodeId: node!.id, version: null, op: "delete" });
        undo.push({ nodeId: node!.id, op: "delete", version: node!.currentVersion, previousVersion: node!.currentVersion, fromPath: null, path: item.path });
      } else if (item.op === "rename") {
        const parentId = await ensureParentFoldersTx(tx, set.workspaceId, item.path, userId);
        await tx.update(workspaceNodes).set({ path: item.path, name: item.path.split("/").pop()!, parentId, updatedAt: now }).where(eq(workspaceNodes.id, node!.id));
        node = { ...node!, path: item.path };
        const contentChanged = Boolean(item.contentHash && item.contentHash !== item.baseHash);
        const version = contentChanged ? await writeVersion(node, false) : node.currentVersion;
        applied.push({ path: item.path, nodeId: node.id, version, op: "rename" });
        undo.push({ nodeId: node.id, op: "rename", version, previousVersion: expectVersion, fromPath: item.fromPath, path: item.path });
      } else {
        // change (or an add the person chose to apply over a file that appeared meanwhile)
        const version = await writeVersion(node!, false);
        applied.push({ path: item.path, nodeId: node!.id, version, op: item.op });
        undo.push({ nodeId: node!.id, op: "change", version, previousVersion: expectVersion, fromPath: null, path: item.path });
      }
    }
    if (applied.length) await recordNodeEventsBatch(set.workspaceId, userId, applied.map((a) => a.nodeId), "change_set_applied", { changeSetId: set.id, title: set.title, filesCount: applied.length, ...(via.via ? via : {}) }, tx);
    await tx.update(changeSetItems).set({ state: "applied", updatedAt: now }).where(eq(changeSetItems.changeSetId, set.id));
    const result: ApplyResult = { applied, undo, undoToken: null };
    await tx.update(changeSets).set({ status: "applied", appliedAt: now, appliedBy: userId, applyResult: result as unknown as Record<string, unknown>, updatedAt: now }).where(eq(changeSets.id, set.id));
    return { result };
  });
}

async function finishApply(actor: Actor, set: ChangeSet, outcome: { already?: ApplyResult; result?: ApplyResult }) {
  if (outcome.already) return { changeSet: (await findChangeSet(set.id)), ...outcome.already };
  const result = outcome.result!;
  // Agents' and the CLI's 24-hour undo token (A2.9); the app undoes with the change set itself, without a time limit.
  const undoToken = await recordUndo(actor, {
    workspaceId: set.workspaceId,
    operation: "changeset.apply",
    summary: `Applied ${describeSet(set)}`,
    inverse: { kind: "changeset.undo", projectId: set.workspaceId, changeSetId: set.id },
  });
  if (undoToken) {
    result.undoToken = undoToken;
    await db.update(changeSets).set({ undoOperationId: undoToken, applyResult: result as unknown as Record<string, unknown> }).where(eq(changeSets.id, set.id));
  }
  return { changeSet: await findChangeSet(set.id), ...result };
}

/** Apply only some files (G12): the chosen items become their own ready set; the rest stay a draft. */
async function splitOff(actor: Actor, set: ChangeSet, rawPaths: string[]) {
  const paths = rawPaths.map(normalizeChangePath);
  if (set.status !== "ready") fail("Finish the change set first", 409, "CHANGE_SET_NOT_READY");
  return db.transaction(async (tx) => {
    const locked = await lockOpenSet(tx, set.id);
    if (locked.status !== "ready") fail("Finish the change set first", 409, "CHANGE_SET_NOT_READY");
    const chosen = await tx.select({ id: changeSetItems.id, state: changeSetItems.state }).from(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), inArray(changeSetItems.path, paths)));
    if (chosen.length !== paths.length) fail("Some of those files aren't in this change set", 404, "NOT_FOUND");
    if (chosen.some((c) => c.state === "pending")) fail("Some of those files are still uploading", 409, "CONTENT_MISSING");
    const [part] = await tx.insert(changeSets).values({
      workspaceId: set.workspaceId, taskId: set.taskId, authorId: set.authorId, via: set.via, agentName: set.agentName, agentSessionId: set.agentSessionId,
      title: `${set.title} (part)`.slice(0, 120), message: set.message, status: "ready", readyAt: new Date(),
    }).returning();
    await tx.update(changeSetItems).set({ changeSetId: part!.id }).where(inArray(changeSetItems.id, chosen.map((c) => c.id)));
    await recount(tx, part!.id);
    await recount(tx, set.id);
    return (await tx.select().from(changeSets).where(eq(changeSets.id, part!.id)))[0]!;
  });
}

// ── Undo, discard, copy ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Undo (route 13, G11): every file back to its version from before the apply, in one transaction. Refused when a
 * file moved on since (`UNDO_BLOCKED`, naming them); `partial` undoes the others and leaves those.
 */
export async function undoChangeSet(actor: Actor, changeSetId: string, opts: { partial?: boolean } = {}) {
  const userId = userOf(actor);
  const set = await loadForWrite(actor, changeSetId, "author-or-admin");
  if (set.status !== "applied" || !set.applyResult) fail(`Only an applied change set can be undone; this one is ${set.status}`, 409, "CHANGE_SET_CLOSED");
  const { undo } = set.applyResult as unknown as ApplyResult;
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const [locked] = await tx.select({ status: changeSets.status }).from(changeSets).where(eq(changeSets.id, set.id)).for("update");
    if (locked?.status !== "applied") fail("That was undone already", 409, "CHANGE_SET_CLOSED");
    const ids = [...new Set(undo.map((u) => u.nodeId))].sort();
    if (ids.length) await tx.execute(sql`SELECT id FROM workspace_nodes WHERE id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) ORDER BY id FOR UPDATE`);
    const nodes = new Map((ids.length ? await tx.select().from(workspaceNodes).where(inArray(workspaceNodes.id, ids)) : []).map((n) => [n.id, n]));
    const blocked: Array<{ path: string; reason: string }> = [];
    const doable = undo.filter((u) => {
      const node = nodes.get(u.nodeId);
      const why = !node ? "is gone"
        : u.op === "delete" ? (node.deletedAt ? null : "was restored since")
          : node.deletedAt ? "was deleted since"
            : node.currentVersion !== u.version ? `changed since (now v${node.currentVersion})`
              : u.op === "rename" && node.path !== u.path ? "was moved since"
                : null;
      if (why) blocked.push({ path: u.path, reason: why });
      return !why;
    });
    if (blocked.length && !opts.partial) fail(`${blocked.length} file${blocked.length === 1 ? "" : "s"} changed since; undo the rest with partial`, 409, "UNDO_BLOCKED", { blocked });
    const now = new Date();
    for (const u of doable) {
      await assertWorkspaceWriteAccessTx(tx, set.workspaceId, userId, { nodeId: u.nodeId });
      if (u.op === "add") {
        await tx.update(workspaceNodes).set({ deletedAt: now, deletedBy: userId, updatedAt: now }).where(eq(workspaceNodes.id, u.nodeId));
        continue;
      }
      if (u.op === "delete") {
        await tx.update(workspaceNodes).set({ deletedAt: null, deletedBy: null, updatedAt: now }).where(eq(workspaceNodes.id, u.nodeId));
        continue;
      }
      const patch: Partial<typeof workspaceNodes.$inferInsert> = { updatedAt: now };
      if (u.previousVersion != null && u.previousVersion !== u.version) {
        const [prev] = await tx.select().from(fileVersions).where(and(eq(fileVersions.nodeId, u.nodeId), eq(fileVersions.version, u.previousVersion))).limit(1);
        if (prev) Object.assign(patch, { s3Key: prev.s3Key, assetId: prev.assetId, size: prev.size, mimeType: prev.mimeType, currentVersion: prev.version });
      }
      if (u.op === "rename" && u.fromPath) {
        const parentId = await ensureParentFoldersTx(tx, set.workspaceId, u.fromPath, userId);
        Object.assign(patch, { path: u.fromPath, name: u.fromPath.split("/").pop()!, parentId });
      }
      await tx.update(workspaceNodes).set(patch).where(eq(workspaceNodes.id, u.nodeId));
    }
    if (doable.length) await recordNodeEventsBatch(set.workspaceId, userId, doable.map((u) => u.nodeId), "change_set_undone", { changeSetId: set.id, title: set.title, filesCount: doable.length }, tx);
    await tx.update(changeSets).set({ status: "undone", undoneAt: now, updatedAt: now }).where(eq(changeSets.id, set.id));
    if (set.undoOperationId) await tx.update(undoOperations).set({ usedAt: now }).where(and(eq(undoOperations.id, set.undoOperationId), isNull(undoOperations.usedAt)));
    return { undone: doable.map((u) => u.path), blocked };
  });
  return { changeSet: await findChangeSet(set.id), ...outcome };
}

export async function discardChangeSet(actor: Actor, changeSetId: string) {
  const set = await loadForWrite(actor, changeSetId, "author-or-admin");
  const [done] = await db.update(changeSets).set({ status: "discarded", discardedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(changeSets.id, set.id), inArray(changeSets.status, ["open", "ready"]))).returning();
  if (!done) fail(`This change set is ${set.status}; only open or ready ones can be discarded`, 409, "CHANGE_SET_CLOSED");
  return { ok: true, changeSet: done };
}

/** Copy as new draft (G11): an undone or discarded set's items, as a new open set based on the files as they are now. */
export async function copyChangeSet(actor: Actor, changeSetId: string) {
  const source = await findChangeSet(changeSetId);
  if (!["undone", "discarded"].includes(source.status)) fail("Only an undone or discarded change set can be copied", 409, "CHANGE_SET_CLOSED");
  const copy = await startChangeSet(actor, { workspaceId: source.workspaceId, title: source.title, taskId: source.taskId, message: source.message });
  const items = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, source.id));
  for (let i = 0; i < items.length; i += LIMITS.itemsPerCall) {
    await upsertItems(actor, copy.id, items.slice(i, i + LIMITS.itemsPerCall).map((it) => ({
      op: it.op === "add" ? "change" : it.op, path: it.path, fromPath: it.fromPath, contentHash: it.contentHash, size: it.size, mimeType: it.mimeType,
    })));
  }
  return findChangeSet(copy.id);
}

/** The `changeset.undo` kind of the 24-hour undo token (`nb undo`, the MCP tool). */
export async function undoFromToken(actor: Actor, changeSetId: string) {
  const { undone } = await undoChangeSet(actor, changeSetId);
  return `Undid ${undone.length} file${undone.length === 1 ? "" : "s"} of the change set`;
}

/** Open sets older than 30 days are discarded; a reminder goes at day 23 (G19). Returns how many were discarded. */
export async function discardStaleChangeSets(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await db.update(changeSets).set({ status: "discarded", discardedAt: now, updatedAt: now })
    .where(and(inArray(changeSets.status, ["open", "ready"]), lt(changeSets.updatedAt, cutoff), ne(changeSets.status, "applying")))
    .returning({ id: changeSets.id });
  return rows.length;
}

// ── Review ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ItemDiff =
  | { kind: "text"; lines: Array<{ kind: " " | "-" | "+" | "@"; text: string }>; added: number; removed: number }
  | { kind: "too_large"; beforeSize: number | null; afterSize: number | null }
  | { kind: "image"; before: string | null; after: string | null }
  | { kind: "binary"; beforeSize: number | null; afterSize: number | null };

/**
 * One file's diff in review (route 8, G12): text side by side up to 1 MB and 4,000 lines, images before and after
 * (signed links for 10 minutes), other files by size.
 */
export async function diffItem(actor: Actor, changeSetId: string, rawPath: string): Promise<ItemDiff> {
  const set = await findChangeSet(changeSetId);
  const { canWrite } = await workspaceAccess(actor, set.workspaceId);
  if (!canWrite && !["applied", "undone"].includes(set.status)) fail("Change set not found", 404, "NOT_FOUND");
  const path = normalizeChangePath(rawPath);
  const [item] = await db.select().from(changeSetItems).where(and(eq(changeSetItems.changeSetId, set.id), eq(changeSetItems.path, path))).limit(1);
  if (!item) fail("That file isn't in this change set", 404, "NOT_FOUND");
  const beforeAsset = item!.op === "add" ? null : await baseAssetOf(item!);
  const afterAsset = item!.op === "delete" ? null : item!.mergedAssetId ?? item!.assetId;
  const sizes = async () => {
    const ids = [beforeAsset, afterAsset].filter(Boolean) as string[];
    const rows = ids.length ? await db.select({ id: storageAssets.id, size: storageAssets.verifiedSize }).from(storageAssets).where(inArray(storageAssets.id, ids)) : [];
    const sizeOf = (id: string | null) => (id ? Number(rows.find((r) => r.id === id)?.size ?? 0) : null);
    return { beforeSize: sizeOf(beforeAsset), afterSize: sizeOf(afterAsset) };
  };
  if ((item!.mimeType ?? "").startsWith("image/")) {
    const storage = (await createAdminClient()).storage.from("project-files");
    const link = async (id: string | null) => {
      if (!id) return null;
      const [a] = await db.select({ key: storageAssets.storageKey }).from(storageAssets).where(eq(storageAssets.id, id)).limit(1);
      return a ? (await storage.createSignedUrl(a.key, 600)).data?.signedUrl ?? null : null;
    };
    return { kind: "image", before: await link(beforeAsset), after: await link(afterAsset) };
  }
  const size = await sizes();
  if ((size.beforeSize ?? 0) > LIMITS.diffBytes || (size.afterSize ?? 0) > LIMITS.diffBytes) return { kind: "too_large", ...size };
  const [before, after] = await Promise.all([beforeAsset ? readAsset(beforeAsset) : Buffer.alloc(0), afterAsset ? readAsset(afterAsset) : Buffer.alloc(0)]);
  if (!before || !after || !isTextual(before) || !isTextual(after)) return { kind: "binary", ...size };
  const diff = unifiedDiff(before.toString("utf8"), after.toString("utf8"));
  return diff ? { kind: "text", ...diff } : { kind: "too_large", ...size };
}

/** Ask for changes (G12): a note on the change set's task that the agent reads at its next session (D16). */
export async function askForChanges(actor: Actor, changeSetId: string, text: string) {
  const set = await loadForWrite(actor, changeSetId, "author-or-admin");
  const note = String(text ?? "").trim();
  if (!note) fail("Say what to change", 400, "BAD_REQUEST");
  if (!set.taskId) fail("This change set isn't on a task, so there's nowhere for the agent to read it; reply to the agent directly", 409, "CONFLICT");
  const { addAgentNote } = await import("@/lib/domain/task-agent-notes");
  await addAgentNote(userOf(actor), set.taskId!, { note: `Asked for changes on "${set.title}": ${note}`.slice(0, 2000), agentName: null, sessionId: null });
  return { ok: true };
}
