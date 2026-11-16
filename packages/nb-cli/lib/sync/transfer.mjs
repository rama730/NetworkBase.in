// Moving bytes (report A1.7, A1.9, A12.7, A12.10, A12.11): manifest pages, streamed downloads written
// atomically and hash-checked, uploads through files/place with base versions, conflict copies.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { CliError } from "../errors.mjs";
import { renameRetry } from "../config.mjs";
import { hashFile } from "./state.mjs";

export { renameRetry };

/** @typedef {import("../api.mjs").Api} Api */

/** Every visible file with version and hash (A2.5 manifest, pages of 5,000). @param {Api} api @param {string} workspaceId */
export async function fetchManifest(api, workspaceId) {
  /** @type {Map<string, import("./plan.mjs").RemoteFile & { path: string }>} */
  const files = new Map();
  let cursor = null;
  /** @type {any} */
  let page;
  do {
    page = await api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/manifest`, { query: { cursor } });
    for (const f of page.files) files.set(f.path, { path: f.path, nodeId: f.nodeId, version: f.version, hash: f.contentHash ? String(f.contentHash).toLowerCase() : null, size: f.size ?? 0, updatedAt: f.updatedAt ?? null, ...(f.executable ? { executable: true } : {}) });
    cursor = page.nextCursor;
  } while (cursor);
  return { files, canWrite: Boolean(page.canWrite), largestFileBytes: page.limits?.largestFileBytes ?? 25 * 1024 * 1024 };
}

/** Rejects paths that would land outside the folder (report A3.12, finding 34). @param {string} root @param {string} rel */
export function safeJoin(root, rel) {
  if (!rel || rel.includes("\0") || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new CliError("UNSAFE_PATH", `Refusing an unsafe path from the server: ${JSON.stringify(rel)}`);
  const target = path.resolve(root, ...rel.split("/"));
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new CliError("UNSAFE_PATH", `Refusing a path outside this folder: ${JSON.stringify(rel)}`);
  // Never inside a .git or .networkbase folder, at any depth or letter case: a file there (a hook, a config) would run
  // commands or replace nb's own state (M5 security review). Checked on the resolved path, so Windows' own rules apply:
  // "\" separators, trailing dots and spaces, 8.3 short names (GIT~1) and stream suffixes (":").
  const parts = inside.split(path.sep).map((part) => part.replace(/[. ]+$/, ""));
  const win = process.platform === "win32";
  if (parts.some((part) => /^\.(git|networkbase)$/i.test(part) || (win && (/^(git|networ)~\d+$/i.test(part) || part.includes(":"))))) {
    throw new CliError("UNSAFE_PATH", `Refusing a file inside a .git or .networkbase folder: ${JSON.stringify(rel)}`, { details: { protected: true } });
  }
  if (process.platform === "win32" && inside.split(path.sep).some((part) => /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))) {
    throw new CliError("RESERVED_NAME", `Windows can't hold a file named ${JSON.stringify(rel)}`);
  }
  return target;
}

/**
 * Streams a file to `dest` via a temp file in the same folder, checks its hash, then renames (A1.9, A12.10).
 * @param {Api} api @param {string} workspaceId @param {string} remotePath @param {string} dest @param {string | null} expectedHash
 * @returns {Promise<{ hash: string, size: number, content: Buffer | null }>} content only for small text-like files (base copies)
 */
export async function downloadTo(api, workspaceId, remotePath, dest, expectedHash) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.nbtmp-${crypto.randomBytes(4).toString("hex")}`;
  try {
    const response = await api.download("/api/v1/extension/file", { projectId: workspaceId, path: remotePath, transfer: "raw" }).catch(async (error) => {
      // Files the storage check hasn't verified are served inline instead.
      if (!(error instanceof CliError) || error.status !== 404) throw error;
      return null;
    });
    if (response?.body) {
      await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), fs.createWriteStream(tmp, { mode: 0o644 }));
    } else {
      const inline = /** @type {any} */ (await api.get("/api/v1/extension/file", { query: { projectId: workspaceId, path: remotePath, transfer: "inline" } }));
      fs.writeFileSync(tmp, Buffer.from(inline.content ?? "", inline.encoding === "base64" ? "base64" : "utf8"), { mode: 0o644 });
    }
    const hash = /** @type {string} */ (await hashFile(tmp));
    if (expectedHash && hash !== expectedHash) throw new CliError("CORRUPT_DOWNLOAD", `${remotePath} didn't arrive intact`, { hint: "Run the command again" });
    const size = fs.statSync(tmp).size;
    const content = size <= 1024 * 1024 ? fs.readFileSync(tmp) : null;
    renameRetry(tmp, dest);
    return { hash, size, content };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** `report.md` → `report.remote-v5.md`, next to it so it opens in the same app (A1.7, D18). @param {string} abs @param {number} version */
export function conflictCopyPath(abs, version) {
  const ext = path.extname(abs);
  return `${abs.slice(0, abs.length - ext.length)}.remote-v${version}${ext}`;
}

const MIME = /** @type {Record<string, string>} */ ({
  ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".csv": "text/csv", ".html": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/plain", ".tsx": "text/plain", ".jsx": "text/plain", ".py": "text/x-python",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".pdf": "application/pdf", ".zip": "application/zip", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});
/** @param {string} p */
export const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";

const INLINE_BATCH_BYTES = 3 * 1024 * 1024;
const BATCH_FILES = 50;

/**
 * Uploads through files/place in batches (≤ 50 files, ≤ 3 MiB inline); bigger files use signed upload slots.
 * @param {Api} api
 * @param {{ workspaceId: string, items: Array<{ path: string, abs: string, size: number, hash: string, baseVersion?: number | null }>, taskId?: string | null, as?: string | null, message?: string | null, keepBoth?: boolean, folder?: string | null, confirmSecrets?: boolean, keyBase?: string, onBytes?: (path: string, sent: number, total: number) => void }} input
 * @param {(done: number, total: number) => void} [progress]
 */
export async function uploadFiles(api, input, progress) {
  /** @type {any[]} */
  const results = [];
  /** @type {any} */
  let lastTransition = null;
  const small = input.items.filter((i) => i.size <= INLINE_BATCH_BYTES);
  const large = input.items.filter((i) => i.size > INLINE_BATCH_BYTES);
  let done = 0;
  for (let i = 0; i < small.length;) {
    const batch = [];
    let bytes = 0;
    while (i < small.length && batch.length < BATCH_FILES && (batch.length === 0 || bytes + (small[i]?.size ?? 0) <= INLINE_BATCH_BYTES)) {
      const item = /** @type {typeof small[number]} */ (small[i++]);
      bytes += item.size;
      batch.push(item);
    }
    const body = {
      projectId: input.workspaceId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.as ? { role: input.as } : {}),
      ...(input.message ? { message: input.message } : {}),
      ...(input.keepBoth ? { onSameName: "keep-both" } : {}),
      ...(input.folder ? { folder: input.folder } : {}),
      ...(input.confirmSecrets ? { confirmSecrets: true } : {}),
      files: batch.map((item) => {
        const content = fs.readFileSync(item.abs);
        return { path: item.path, contentHash: item.hash, size: content.length, mimeType: mimeFor(item.path), contentBase64: content.toString("base64"), ...(item.baseVersion ? { baseVersion: item.baseVersion } : {}) };
      }),
    };
    // Same files and bases → same key, so a push replayed from the offline queue can't land twice (A12.4).
    const key = input.keyBase ? crypto.createHash("sha256").update(`${input.keyBase}:${JSON.stringify(body.files.map((f) => [f.path, f.contentHash, f.baseVersion ?? null]))}`).digest("hex") : undefined;
    const res = /** @type {any} */ (await api.post("/api/v1/files/place", body, { key }));
    results.push(...res.files);
    if (res.transition) lastTransition = res.transition;
    done += batch.length;
    progress?.(done, input.items.length);
  }
  if (large.length) {
    results.push(...(await uploadLarge(api, input.workspaceId, large, input.message ?? null, input.onBytes)));
    progress?.(input.items.length, input.items.length);
  }
  return { files: results, transition: lastTransition };
}

/**
 * Files over 3 MiB: signed upload slots, PUT, then finalize (the 1.x bulk path). The base-version check happened
 * just before through a fresh manifest; the bulk routes don't take one (noted in the phase notes).
 * @param {Api} api @param {string} workspaceId @param {Array<{ path: string, abs: string, size: number, hash: string }>} items @param {string | null} message
 * @param {(path: string, sent: number, total: number) => void} [onBytes] progress of each big file (C3)
 */
async function uploadLarge(api, workspaceId, items, message, onBytes) {
  /** @type {any[]} */
  const out = [];
  for (let i = 0; i < items.length; i += BATCH_FILES) {
    const batch = items.slice(i, i + BATCH_FILES);
    const intent = /** @type {any} */ (await api.post("/api/v1/extension/bulk-intent", {
      projectId: workspaceId,
      files: batch.map((f) => ({ path: f.path, size: f.size, mimeType: mimeFor(f.path), contentHash: f.hash, ...(message ? { comment: message } : {}) })),
    }));
    for (const slot of intent.files) {
      const item = batch.find((f) => f.path === slot.path);
      if (!item) continue;
      // ponytail: a file stopped midway (Ctrl+C) goes up whole on the next push, not from where it stopped; files are
      // at most 25 MB. Byte-level resume needs a resumable upload protocol on storage.
      const stream = fs.createReadStream(item.abs);
      let sent = 0;
      stream.on("data", (chunk) => { sent += chunk.length; onBytes?.(item.path, sent, item.size); });
      const put = await fetch(slot.uploadUrl, /** @type {RequestInit} */ ({ method: "PUT", headers: { "content-type": mimeFor(item.path), "content-length": String(item.size) }, body: /** @type {any} */ (stream), duplex: "half", signal: AbortSignal.timeout(10 * 60_000) }));
      if (!put.ok) throw new CliError("UPLOAD_FAILED", `Uploading ${item.path} failed (HTTP ${put.status})`, { hint: "Run the command again" });
    }
    const finalized = /** @type {any} */ (await api.post("/api/v1/extension/bulk-finalize", {
      projectId: workspaceId,
      uploadSessionId: intent.uploadSessionId,
      files: intent.files.map((/** @type {any} */ slot) => ({ path: slot.path, uploadIntentId: slot.uploadIntentId, checksum: batch.find((f) => f.path === slot.path)?.hash, ...(message ? { comment: message } : {}) })),
    }));
    out.push(...finalized.files);
  }
  return out;
}
