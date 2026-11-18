// Change set capture (report G8): the folder's saved files, compared with what was last synced, become the open
// change set's items. Each sync sends only what changed since the last one and uploads only content the server is
// missing; a journal in .networkbase/changes/ lets a crash or a lost connection resume where it stopped.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { Readable } from "node:stream";

import { DIR_NAME, readJson, writeAtomic } from "../config.mjs";
import { scanLocal } from "../sync/local.mjs";
import { readState } from "../sync/state.mjs";
import { mimeFor } from "../sync/transfer.mjs";

export const FILE_LIMIT = 25 * 1024 * 1024;
const INLINE_BYTES = 3 * 1024 * 1024;
const ITEMS_PER_CALL = 200;
const PARALLEL = process.platform === "win32" ? 4 : 8;

/**
 * @typedef {{ op: "add" | "change" | "delete" | "rename", path: string, fromPath?: string, abs?: string, contentHash?: string, size?: number, mimeType?: string, baseVersion?: number, baseHash?: string, executable?: boolean }} DraftItem
 * @typedef {{ id: string, title: string, sent: Record<string, string>, missing: string[], held?: Record<string, string> }} Journal
 *   held: content the server didn't store because it looks like it holds a key, by hash → path
 */

const dir = (/** @type {string} */ root) => path.join(root, DIR_NAME, "changes");

/** The change set a plain push opened and hasn't applied yet (stopped with Ctrl+C): the next push carries it on. @param {string} root */
export const pendingPush = (root) => /** @type {string | null} */ (readJson(path.join(dir(root), "push.json"))?.id ?? null);
/** @param {string} root @param {string | null} id */
export function setPendingPush(root, id) {
  fs.mkdirSync(dir(root), { recursive: true });
  if (id) writeAtomic(path.join(dir(root), "push.json"), `${JSON.stringify({ id })}\n`);
  else fs.rmSync(path.join(dir(root), "push.json"), { force: true });
}

/** @param {string} root @param {string} id @returns {Journal} */
export function readJournal(root, id) {
  return { id, title: "", sent: {}, missing: [], ...(readJson(path.join(dir(root), `${id}.json`)) ?? {}) };
}
/** @param {string} root @param {Journal} journal */
export function writeJournal(root, journal) {
  fs.mkdirSync(dir(root), { recursive: true });
  writeAtomic(path.join(dir(root), `${journal.id}.json`), `${JSON.stringify(journal)}\n`);
}
/** The change set this folder is working on, if any. @param {string} root @returns {string | null} */
export function currentChange(root) {
  return readJson(path.join(dir(root), "current.json"))?.id ?? null;
}
/** @param {string} root @param {string | null} id */
export function setCurrentChange(root, id) {
  fs.mkdirSync(dir(root), { recursive: true });
  if (id) writeAtomic(path.join(dir(root), "current.json"), `${JSON.stringify({ id })}\n`);
  else {
    const prev = currentChange(root);
    fs.rmSync(path.join(dir(root), "current.json"), { force: true });
    if (prev) fs.rmSync(path.join(dir(root), `${prev}.json`), { force: true });
  }
}

/**
 * The draft: every file that differs from what was last synced. A delete and an add with the same content are a
 * rename (one each per content, as `nb push` decides moves).
 * @param {string} root @param {{ workspaceId: string, remoteRoot: string }} project
 * @returns {Promise<{ items: DraftItem[], skipped: Array<{ path: string, reason: string }> }>}
 */
export async function draftItems(root, project) {
  const state = readState(root, project.workspaceId);
  // A folder kept to some folders (nb sync --only) changes only those, as nb push does (T16 live test: an agent's
  // change set took .mcp.json and CLAUDE.md from the folder's top level into the workspace).
  const only = project.only?.length ? project.only : undefined;
  const { files: local, skipped } = await scanLocal({ root, remoteRoot: project.remoteRoot, base: state.files, maxFileBytes: FILE_LIMIT, only });
  /** @type {DraftItem[]} */
  const items = [];
  for (const [p, base] of Object.entries(state.files)) {
    const file = local.get(p);
    if (!file) items.push({ op: "delete", path: p, baseVersion: base.baseVersion, baseHash: base.baseHash });
    else if (file.hash !== base.baseHash) items.push({ op: "change", path: p, abs: file.abs, contentHash: file.hash, size: file.size, mimeType: mimeFor(p), baseVersion: base.baseVersion, baseHash: base.baseHash });
  }
  for (const [p, file] of local) if (!state.files[p]) items.push({ op: "add", path: p, abs: file.abs, contentHash: file.hash, size: file.size, mimeType: mimeFor(p) });
  /** @param {DraftItem[]} list @param {(i: DraftItem) => string | undefined} hashOf */
  const byHash = (list, hashOf) => {
    /** @type {Map<string, DraftItem[]>} */
    const m = new Map();
    for (const i of list) { const h = hashOf(i); if (h) m.set(h, [...(m.get(h) ?? []), i]); }
    return m;
  };
  const gone = byHash(items.filter((i) => i.op === "delete"), (i) => i.baseHash);
  const added = byHash(items.filter((i) => i.op === "add"), (i) => i.contentHash);
  /** @type {Set<DraftItem>} */
  const drop = new Set();
  for (const [hash, adds] of added) {
    const dels = gone.get(hash);
    if (adds.length !== 1 || dels?.length !== 1) continue;
    const [to] = adds;
    const [from] = dels;
    drop.add(/** @type {DraftItem} */ (from));
    Object.assign(/** @type {DraftItem} */ (to), { op: "rename", fromPath: from?.path, baseVersion: from?.baseVersion, baseHash: from?.baseHash });
  }
  const kept = items.filter((i) => !drop.has(i)).sort((a, b) => a.path.localeCompare(b.path));
  // The executable bit travels with the file (G16); Windows has none, so it's left as it is there.
  if (process.platform !== "win32") for (const i of kept) if (i.abs) { try { i.executable = (fs.statSync(i.abs).mode & 0o100) !== 0; } catch { /* gone since the scan */ } }
  return { items: kept, skipped };
}

/** What the server has for an item; a different key means it needs sending again. @param {DraftItem} i */
const keyOf = (i) => `${i.op}:${i.fromPath ?? ""}:${i.contentHash ?? ""}:${i.baseVersion ?? ""}:${i.executable ? "x" : ""}`;
/** @param {DraftItem} i */
const wire = (i) => ({ op: i.op, path: i.path, ...(i.fromPath ? { fromPath: i.fromPath } : {}), ...(i.contentHash ? { contentHash: i.contentHash, size: i.size, mimeType: i.mimeType } : {}), ...(typeof i.executable === "boolean" ? { executable: i.executable } : {}), ...(i.baseVersion != null ? { baseVersion: i.baseVersion, baseHash: i.baseHash } : {}) });

/**
 * Sends the draft's changes since the last sync, then the content the server doesn't have.
 * @param {import("../api.mjs").Api} api @param {string} root @param {string} id @param {DraftItem[]} items
 * @param {{ confirmSecrets?: boolean }} [opts] the person says files that look like they hold a key are safe to send
 * @returns {Promise<{ sent: number, dropped: number, uploaded: number, pending: number, held: string[] }>}
 */
export async function syncDraft(api, root, id, items, { confirmSecrets = false, onBytes = /** @type {((path: string, sent: number, total: number) => void) | undefined} */ (undefined) } = {}) {
  const journal = readJournal(root, id);
  const now = new Map(items.map((i) => [i.path, i]));
  const renamedFrom = new Set(items.flatMap((i) => (i.fromPath ? [i.fromPath] : [])));
  const toSend = items.filter((i) => journal.sent[i.path] !== keyOf(i));
  const toDrop = Object.keys(journal.sent).filter((p) => !now.has(p));
  const enc = encodeURIComponent(id);
  for (let i = 0; i < toSend.length; i += ITEMS_PER_CALL) {
    const chunk = toSend.slice(i, i + ITEMS_PER_CALL);
    const res = /** @type {any} */ (await api.put(`/api/v1/change-sets/${enc}/items`, { items: chunk.map(wire) }));
    for (const item of chunk) journal.sent[item.path] = keyOf(item);
    journal.missing = [...new Set([...journal.missing, ...(res.missingContent ?? [])])];
    writeJournal(root, journal);
  }
  let dropped = 0;
  for (const p of toDrop) {
    // A rename replaces the item at its old path on the server by itself.
    if (!renamedFrom.has(p)) { await api.delete(`/api/v1/change-sets/${enc}/items`, { query: { path: p } }); dropped += 1; }
    delete journal.sent[p];
    writeJournal(root, journal);
  }
  const uploaded = await uploadMissing(api, root, journal, items, confirmSecrets, onBytes);
  const held = Object.values(journal.held ?? {});
  return { sent: toSend.length, dropped, uploaded, pending: journal.missing.length, held };
}

/**
 * @param {import("../api.mjs").Api} api @param {string} root @param {Journal} journal @param {DraftItem[]} items @param {boolean} confirmSecrets
 * @param {(path: string, sent: number, total: number) => void} [onBytes] progress of each big file (C3)
 */
async function uploadMissing(api, root, journal, items, confirmSecrets, onBytes) {
  /** @type {Map<string, DraftItem>} */
  const byHash = new Map();
  for (const i of items) if (i.contentHash && i.abs) byHash.set(i.contentHash, i);
  // Content that changed again since is no longer wanted: its newer hash is on the list instead.
  journal.missing = journal.missing.filter((h) => byHash.has(h));
  journal.held = Object.fromEntries(Object.entries(journal.held ?? {}).filter(([h]) => byHash.has(h) && !confirmSecrets));
  const enc = encodeURIComponent(journal.id);
  /** The server held these: not sent again until the person confirms. @param {any} res */
  const noteHeld = (res) => { for (const h of res?.held ?? []) { journal.held = { ...journal.held, [h.hash]: byHash.get(h.hash)?.path ?? h.hash }; } };
  const waiting = journal.missing.filter((h) => !journal.held?.[h]);
  /** Reads the file now; null when it changed since the scan. @param {string} hash */
  const read = (hash) => {
    const item = /** @type {DraftItem} */ (byHash.get(hash));
    try {
      const bytes = fs.readFileSync(/** @type {string} */ (item.abs));
      return crypto.createHash("sha256").update(bytes).digest("hex") === hash ? bytes : null;
    } catch {
      return null;
    }
  };
  const done = (/** @type {string} */ hash) => { journal.missing = journal.missing.filter((h) => h !== hash); writeJournal(root, journal); };
  let uploaded = 0;
  const small = waiting.filter((h) => (byHash.get(h)?.size ?? 0) <= INLINE_BYTES);
  const large = waiting.filter((h) => (byHash.get(h)?.size ?? 0) > INLINE_BYTES);
  /** @type {string[][]} */
  const batches = [];
  let batch = /** @type {string[]} */ ([]);
  let bytes = 0;
  for (const h of small) {
    const size = byHash.get(h)?.size ?? 0;
    if (batch.length && bytes + size > INLINE_BYTES) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(h);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  for (let i = 0; i < batches.length; i += PARALLEL) {
    await Promise.all(batches.slice(i, i + PARALLEL).map(async (hashes) => {
      const files = hashes.flatMap((hash) => { const b = read(hash); return b ? [{ hash, base64: b.toString("base64") }] : []; });
      if (!files.length) return;
      const res = /** @type {any} */ (await api.post(`/api/v1/change-sets/${enc}/content`, { files, ...(confirmSecrets ? { confirmSecrets: true } : {}) }));
      noteHeld(res);
      for (const f of files) if (!journal.held?.[f.hash]) { done(f.hash); uploaded += 1; }
      writeJournal(root, journal);
    }));
  }
  for (const hash of large) {
    const b = read(hash);
    if (!b) continue;
    const extra = confirmSecrets ? { confirmSecrets: true } : {};
    const first = /** @type {any} */ (await api.post(`/api/v1/change-sets/${enc}/content`, { hash, ...extra }));
    let last = first;
    if (first.upload) {
      // In 1 MB pieces, so a terminal shows how far it got (C3; T16 live test: a 24 MB push showed nothing for 9 s).
      const name = byHash.get(hash)?.path ?? hash;
      let sent = 0;
      const body = Readable.from((function* () { for (let o = 0; o < b.length; o += 1 << 20) { const piece = b.subarray(o, o + (1 << 20)); sent += piece.length; onBytes?.(name, sent, b.length); yield piece; } })());
      const put = await fetch(first.upload.url, /** @type {RequestInit} */ ({ method: "PUT", body: /** @type {any} */ (body), duplex: "half", headers: { "content-type": first.upload.contentType ?? "application/octet-stream", "content-length": String(b.length) } }));
      if (!put.ok) throw new Error(`Upload of a large file failed (${put.status})`);
      last = await api.post(`/api/v1/change-sets/${enc}/content`, { hash, ...extra });
    }
    noteHeld(last);
    if (journal.held?.[hash]) { writeJournal(root, journal); continue; }
    done(hash);
    uploaded += 1;
  }
  return uploaded;
}
