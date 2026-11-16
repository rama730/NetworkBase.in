import "server-only";
/**
 * Files for cloud agents (report G14, routes 14–18): list, read and search a workspace as a change set's draft sees
 * it, and edit, write, delete or move files in that draft. Writes go through the change set functions, so locks,
 * limits and the key check stay in one place. The text index fills when a search needs it (M6 plan, decision 1).
 */
import crypto from "node:crypto";
import path from "node:path";
import { and, eq, inArray, isNull, notLike, sql } from "drizzle-orm";


import { db } from "@/lib/db";
import { changeSetItems, fileTextIndex, fileVersions, storageAssets, workspaceNodes } from "@/lib/db/schema";
import { assertWorkspaceFileReadAccess, visibleFileNodesSql } from "@/lib/files/internal-helpers";
import { createAdminClient } from "@/lib/supabase/server";
import { ChangeSetError, dropItem, findChangeSet, isTextual, normalizeChangePath, putContent, upsertItems, type Actor } from "@/lib/domain/change-sets";
import { mimeFor } from "../../../packages/nb-cli/lib/sync/transfer.mjs";

const fail = (message: string, status: number, code: string, details?: Record<string, unknown>): never => {
  throw new ChangeSetError(message, status, code, details);
};
const userOf = (actor: Actor) => actor.user?.id ?? fail("Sign in to continue", 401, "UNAUTHORIZED");

export const FS_LIMITS = { readFiles: 50, readBytes: 1024 * 1024, matches: 200, indexPerSearch: 300, indexParallel: 8, listFiles: 20_000, searchMs: 5_000 };
const BINARY_MIME = /^(image|video|audio|font)\/|^application\/(zip|gzip|x-tar|pdf|octet-stream|vnd\.)/;

type Entry = { path: string; hash: string | null; key: string | null; assetId: string | null; size: number | null; mimeType: string | null; live: boolean; draft: boolean; renamedFrom: string | null };

/**
 * The workspace's files as the viewer may see them (task files and /.system as the manifest leaves them out), with the
 * change set's items laid over them when one is named. ponytail: one read of up to 20,000 files; page it past that.
 */
async function view(actor: Actor, workspaceId: string, changeSetId?: string | null): Promise<Map<string, Entry>> {
  const access = await assertWorkspaceFileReadAccess(workspaceId, userOf(actor));
  const rows = await db.select({ path: workspaceNodes.path, hash: fileVersions.contentHash, key: workspaceNodes.s3Key, size: workspaceNodes.size, mimeType: workspaceNodes.mimeType })
    .from(workspaceNodes)
    .leftJoin(fileVersions, and(eq(fileVersions.nodeId, workspaceNodes.id), eq(fileVersions.version, workspaceNodes.currentVersion)))
    .where(and(eq(workspaceNodes.projectId, workspaceId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), notLike(workspaceNodes.path, "/.system%"), visibleFileNodesSql(access)))
    .limit(FS_LIMITS.listFiles);
  const files = new Map<string, Entry>(rows.map((r) => [r.path, { path: r.path, hash: r.hash?.toLowerCase() ?? null, key: r.key, assetId: null, size: r.size ?? null, mimeType: r.mimeType, live: true, draft: false, renamedFrom: null }]));
  if (!changeSetId) return files;
  const set = await findChangeSet(changeSetId);
  if (set.workspaceId !== workspaceId) fail("Change set not found", 404, "NOT_FOUND");
  // Drafts are for people who can change the files (as getChangeSet decides).
  if (!access.canWrite && !["applied", "undone"].includes(set.status)) fail("Change set not found", 404, "NOT_FOUND");
  if (!["open", "ready"].includes(set.status)) return files;
  const items = await db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, set.id));
  for (const item of items) {
    if (item.fromPath) files.delete(item.fromPath);
    if (item.op === "delete") { files.delete(item.path); continue; }
    files.set(item.path, { path: item.path, hash: item.contentHash, key: null, assetId: item.mergedAssetId ?? item.assetId, size: item.size, mimeType: item.mimeType, live: Boolean(item.baseNodeId) && !item.fromPath, draft: true, renamedFrom: item.fromPath });
  }
  return files;
}

async function bytesOf(entry: Entry): Promise<Buffer | null> {
  let key = entry.key;
  if (!key && entry.assetId) key = (await db.select({ key: storageAssets.storageKey }).from(storageAssets).where(eq(storageAssets.id, entry.assetId)).limit(1))[0]?.key ?? null;
  if (!key) return null;
  const { data } = await (await createAdminClient()).storage.from("project-files").download(key);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const asText = (bytes: Buffer) => (bytes.byteLength <= FS_LIMITS.readBytes && isTextual(bytes) && !bytes.includes(0) ? bytes.toString("utf8") : null);
const matcher = (glob?: string | null) => {
  if (!glob) return () => true;
  const g = glob.startsWith("/") ? glob : `/${glob.includes("/") ? glob : `**/${glob}`}`;
  return (p: string) => path.posix.matchesGlob(p, g);
};

// ── Route 14: list ────────────────────────────────────────────────────────────────────────────────────────────────

export async function listFiles(actor: Actor, workspaceId: string, opts: { changeSet?: string | null; glob?: string | null; limit?: number } = {}) {
  const files = await view(actor, workspaceId, opts.changeSet);
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);
  const match = matcher(opts.glob);
  const all = [...files.values()].filter((f) => match(f.path)).sort((a, b) => byPath(a.path, b.path));
  return { files: all.slice(0, limit).map((f) => ({ path: f.path, size: f.size, hash: f.hash, ...(f.draft ? { inDraft: true } : {}) })), total: all.length, truncated: all.length > limit };
}

// ── Route 15: read ────────────────────────────────────────────────────────────────────────────────────────────────

export async function readFiles(actor: Actor, workspaceId: string, opts: { paths: string[]; changeSet?: string | null }) {
  if (!Array.isArray(opts.paths) || !opts.paths.length) fail("Name the files to read", 400, "BAD_REQUEST");
  if (opts.paths.length > FS_LIMITS.readFiles) fail(`At most ${FS_LIMITS.readFiles} files a call`, 400, "BAD_REQUEST");
  const files = await view(actor, workspaceId, opts.changeSet);
  const out = await Promise.all(opts.paths.map(async (raw) => {
    const p = normalizeChangePath(raw);
    const entry = files.get(p);
    if (!entry) return { path: p, error: "NOT_FOUND" as const };
    if ((entry.size ?? 0) > FS_LIMITS.readBytes) return { path: p, size: entry.size, error: "TOO_LARGE" as const };
    const bytes = await bytesOf(entry);
    if (!bytes) return { path: p, error: "CONTENT_UNAVAILABLE" as const };
    const text = asText(bytes);
    return text == null ? { path: p, size: bytes.byteLength, binary: true } : { path: p, size: bytes.byteLength, hash: entry.hash, text };
  }));
  return { files: out };
}

// ── Route 16: search ──────────────────────────────────────────────────────────────────────────────────────────────

/** Indexes the text of up to 300 files the index hasn't seen; answers how many are still left. */
async function fill(entries: Entry[]) {
  const hashes = [...new Set(entries.flatMap((e) => (e.hash ? [e.hash] : [])))];
  if (!hashes.length) return 0;
  const known = new Set((await db.select({ h: fileTextIndex.contentHash }).from(fileTextIndex).where(inArray(fileTextIndex.contentHash, hashes))).map((r) => r.h));
  const byHash = new Map(entries.filter((e) => e.hash && !known.has(e.hash)).map((e) => [e.hash!, e]));
  const todo = [...byHash.values()].slice(0, FS_LIMITS.indexPerSearch);
  for (let i = 0; i < todo.length; i += FS_LIMITS.indexParallel) {
    await Promise.all(todo.slice(i, i + FS_LIMITS.indexParallel).map(async (e) => {
      const skip = (e.size ?? 0) > FS_LIMITS.readBytes || BINARY_MIME.test(e.mimeType ?? "");
      const bytes = skip ? null : await bytesOf(e);
      // Bytes that don't match their hash are never indexed under it.
      if (bytes && crypto.createHash("sha256").update(bytes).digest("hex") !== e.hash) return;
      if (!skip && !bytes) return; // not readable now: tried again next search
      const text = bytes ? asText(bytes) : null;
      await db.execute(sql`INSERT INTO file_text_index (content_hash, content, bytes) VALUES (${e.hash}, ${text}, ${bytes?.byteLength ?? e.size ?? 0}) ON CONFLICT (content_hash) DO NOTHING`);
    }));
  }
  return byHash.size - todo.length;
}

export async function searchFiles(actor: Actor, workspaceId: string, opts: { query: string; regex?: boolean; caseSensitive?: boolean; glob?: string | null; changeSet?: string | null; limit?: number }) {
  const query = String(opts.query ?? "");
  if (!query.trim() || query.length > 500) fail("Search for 1 to 500 characters", 400, "BAD_REQUEST");
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), FS_LIMITS.matches);
  const match = matcher(opts.glob);
  const entries = [...(await view(actor, workspaceId, opts.changeSet)).values()].filter((e) => e.hash && match(e.path));
  const notIndexed = await fill(entries);
  const pathsOf = new Map<string, string[]>();
  for (const e of entries) pathsOf.set(e.hash!, [...(pathsOf.get(e.hash!) ?? []), e.path]);
  if (!pathsOf.size) return { matches: [], truncated: false, notIndexed };
  const hashes = sql`ARRAY[${sql.join([...pathsOf.keys()].map((h) => sql`${h}`), sql`, `)}]::text[]`;
  // Postgres matches the lines, under a time limit, so a slow pattern can't hold a server process (no regex in Node).
  const op = sql.raw(opts.caseSensitive ? "~" : "~*");
  const pattern = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${FS_LIMITS.searchMs}`));
    return tx.execute<{ h: string; n: number; line: string }>(sql`
      SELECT i.content_hash AS h, l.n::int AS n, left(l.line, 300) AS line
      FROM file_text_index i, regexp_split_to_table(i.content, E'\n') WITH ORDINALITY AS l(line, n)
      WHERE i.content_hash = ANY(${hashes}) AND i.content ${op} ${pattern} AND l.line ${op} ${pattern}
      ORDER BY i.content_hash, l.n
      LIMIT ${limit + 1}`);
  }).catch((error: unknown) => {
    const text = String((error as { cause?: { message?: string } })?.cause?.message ?? (error as Error)?.message ?? "");
    if (/statement timeout/i.test(text)) fail("The search took too long; narrow it with a folder glob or a simpler pattern", 422, "SEARCH_TOO_SLOW");
    if (/invalid regular expression/i.test(text)) fail("That isn't a valid regular expression", 400, "BAD_REQUEST");
    throw error;
  });
  const matches = Array.from(rows).flatMap((r) => (pathsOf.get(r.h) ?? []).map((p) => ({ path: p, line: r.n, text: r.line })))
    .sort((a, b) => byPath(a.path, b.path) || a.line - b.line);
  return { matches: matches.slice(0, limit), truncated: matches.length > limit, notIndexed };
}

// ── Routes 17–18: edit, write, delete, move in a change set ────────────────────────────────────────────────────────

async function draftEntry(actor: Actor, changeSetId: string, rawPath: string) {
  const set = await findChangeSet(changeSetId);
  const p = normalizeChangePath(rawPath);
  return { set, path: p, entry: (await view(actor, set.workspaceId, set.id)).get(p) ?? null };
}

export async function writeFile(actor: Actor, changeSetId: string, input: { path: string; text?: string | null; base64?: string | null }) {
  const p = normalizeChangePath(input.path);
  const bytes = input.text != null ? Buffer.from(String(input.text), "utf8") : input.base64 != null ? Buffer.from(String(input.base64), "base64") : fail("Send the file's text or base64", 400, "BAD_REQUEST");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const { missingContent } = await upsertItems(actor, changeSetId, [{ op: "add", path: p, contentHash: hash, size: bytes.byteLength, mimeType: mimeFor(p) }]);
  const held = missingContent.includes(hash) ? (await putContent(actor, changeSetId, { files: [{ hash, base64: bytes.toString("base64") }] })).held ?? [] : [];
  return { path: p, hash, size: bytes.byteLength, held: held.length > 0 };
}

type Edit = { oldText: string; newText: string; all?: boolean };
/**
 * "Replace this with that" edits (an agent's usual edit), several per call, in order, all or none: each old text must
 * be in the file exactly once (EDIT_NOT_UNIQUE with the count otherwise) unless `all`, the rule local agents use.
 */
export async function editFile(actor: Actor, changeSetId: string, input: { path: string; edits: Edit[] }) {
  const { path: p, entry } = await draftEntry(actor, changeSetId, input.path);
  if (!entry) fail(`${p} isn't in the workspace or this change set`, 404, "NOT_FOUND");
  if (!Array.isArray(input.edits) || !input.edits.length || input.edits.length > 50) fail("Send 1 to 50 edits", 400, "BAD_REQUEST");
  const bytes = await bytesOf(entry!);
  let text = bytes ? asText(bytes) : null;
  if (text == null) fail(`${p} isn't a text file under 1 MB; write it whole instead`, 422, "NOT_TEXT");
  let replaced = 0;
  input.edits.forEach((edit, i) => {
    const oldText = String(edit.oldText ?? "");
    const at = input.edits.length > 1 ? ` (edit ${i + 1})` : "";
    if (!oldText) fail(`Say which text to replace${at}`, 400, "BAD_REQUEST");
    const count = text!.split(oldText).length - 1;
    if (!count) fail(`That text isn't in ${p}${at}`, 409, "EDIT_NOT_FOUND", { edit: i });
    if (count > 1 && !edit.all) fail(`That text is in ${p} ${count} times${at}; include more of the lines around it, or replace all`, 409, "EDIT_NOT_UNIQUE", { count, edit: i });
    text = edit.all ? text!.split(oldText).join(String(edit.newText ?? "")) : text!.replace(oldText, () => String(edit.newText ?? ""));
    replaced += edit.all ? count : 1;
  });
  return { ...(await writeFile(actor, changeSetId, { path: p, text: text! })), replaced };
}

export async function deleteFile(actor: Actor, changeSetId: string, rawPath: string) {
  const { path: p, entry } = await draftEntry(actor, changeSetId, rawPath);
  if (!entry) fail(`${p} isn't in the workspace or this change set`, 404, "NOT_FOUND");
  // A file only this draft added just leaves the draft; a workspace file gets a delete item (for a draft move, the
  // file it moved from).
  const base = entry!.renamedFrom ?? (entry!.live ? p : null);
  if (base) await upsertItems(actor, changeSetId, [{ op: "delete", path: base }]);
  if (base !== p) await dropItem(actor, changeSetId, p);
  return { path: p, deleted: true };
}

export async function moveFile(actor: Actor, changeSetId: string, input: { from: string; to: string }) {
  const { path: from, entry } = await draftEntry(actor, changeSetId, input.from);
  const to = normalizeChangePath(input.to);
  if (!entry) fail(`${from} isn't in the workspace or this change set`, 404, "NOT_FOUND");
  if (from === to) return { from, to };
  if (!entry!.hash) fail(`${from}'s content isn't on the server yet`, 409, "CONTENT_MISSING");
  const content = { contentHash: entry!.hash, size: entry!.size ?? 0, mimeType: entry!.mimeType ?? mimeFor(to) };
  // A workspace file (or one this draft moved already) is renamed from where it is in the workspace.
  const base = entry!.renamedFrom ?? (entry!.live ? from : null);
  const moved = await upsertItems(actor, changeSetId, [base ? { op: "rename", path: to, fromPath: base, ...content } : { op: "add", path: to, ...content }]);
  // Content the change set store hasn't got yet (a file uploaded before change sets): sent from the workspace's copy.
  if (moved.missingContent.length) {
    const bytes = await bytesOf(entry!);
    if (!bytes) fail(`${from}'s content couldn't be read`, 409, "CONTENT_MISSING");
    await putContent(actor, changeSetId, { files: [{ hash: entry!.hash!, base64: bytes!.toString("base64") }] });
  }
  if (base !== from) await dropItem(actor, changeSetId, from);
  return { from, to };
}


/** Daily: drops entries for content no file version or draft refers to any more, a few thousand at a time. */
export async function pruneTextIndex() {
  const rows = await db.execute(sql`
    DELETE FROM file_text_index i WHERE i.content_hash IN (
      SELECT i2.content_hash FROM file_text_index i2
      WHERE i2.indexed_at < now() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM file_versions v WHERE v.content_hash = i2.content_hash)
        AND NOT EXISTS (SELECT 1 FROM change_set_items c WHERE c.content_hash = i2.content_hash)
      LIMIT 5000)
    RETURNING 1`);
  return Array.from(rows).length;
}
