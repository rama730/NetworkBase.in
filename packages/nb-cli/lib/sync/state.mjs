// What was last synced (the base for three-way decisions, report A1.2), the process lock (A1.10) and base
// copies for offline diff (A1.12).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DIR_NAME, readJson, writeAtomic } from "../config.mjs";
import { CliError } from "../errors.mjs";

export const STATE_VERSION = 1;

/**
 * @typedef {{ nodeId: string, baseVersion: number, baseHash: string, size: number, mtimeMs: number }} BaseEntry
 * @typedef {{ schemaVersion: number, workspaceId: string, files: Record<string, BaseEntry>, conflicts: Record<string, { remoteVersion: number, copy: string }> }} SyncState
 */

/** @param {string} root @param {string} workspaceId @returns {SyncState} */
export function readState(root, workspaceId) {
  const raw = readJson(path.join(root, DIR_NAME, "state.json"));
  if (raw) {
    if (raw.schemaVersion > STATE_VERSION) throw new CliError("CLIENT_TOO_OLD", "This folder was synced by a newer nb", { hint: "Update: npm i -g @networkbase/cli" });
    if (raw.workspaceId === workspaceId) return { conflicts: {}, ...raw };
    return { schemaVersion: STATE_VERSION, workspaceId, files: {}, conflicts: {} };
  }
  // 1.x kept versions in manifest.json; they become the base so nothing is re-downloaded (A1.20).
  const legacy = readJson(path.join(root, DIR_NAME, "manifest.json"));
  /** @type {Record<string, BaseEntry>} */
  const files = {};
  if (legacy?.projectId === workspaceId) {
    for (const [p, entry] of Object.entries(/** @type {Record<string, any>} */ (legacy.files ?? {}))) {
      if (entry?.nodeId && entry?.contentHash) files[p] = { nodeId: entry.nodeId, baseVersion: entry.version ?? 1, baseHash: String(entry.contentHash).toLowerCase(), size: entry.size ?? 0, mtimeMs: 0 };
    }
  }
  return { schemaVersion: STATE_VERSION, workspaceId, files, conflicts: {} };
}

/** @param {string} root @param {SyncState} state */
export function writeState(root, state) {
  writeAtomic(path.join(root, DIR_NAME, "state.json"), `${JSON.stringify(state)}\n`);
}

/** Process start time, so a PID reused after a reboot isn't mistaken for a running nb (finding 26). @param {number} pid */
function processStart(pid) {
  try {
    if (process.platform === "linux") return fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[21] ?? null;
    process.kill(pid, 0);
    return "alive";
  } catch {
    return null;
  }
}

/**
 * One nb at a time writes a folder (A1.10). Waits up to `waitMs`, takes over a lock whose process is gone.
 * @param {string} root @param {string} command @param {number} [waitMs]
 * @returns {Promise<() => void>} release
 */
export async function acquireLock(root, command, waitMs = 10_000) {
  const file = path.join(root, DIR_NAME, "lock");
  const mine = JSON.stringify({ pid: process.pid, start: processStart(process.pid), command, at: new Date().toISOString() });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(file, mine, { flag: "wx", mode: 0o600 });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try { if (fs.readFileSync(file, "utf8") === mine) fs.rmSync(file); } catch { /* already gone */ }
      };
      process.once("exit", release);
      return release;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
    }
    const holder = (() => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } })();
    const alive = holder?.pid && processStart(holder.pid) !== null && (holder.start === "alive" || processStart(holder.pid) === holder.start);
    if (!alive) {
      fs.rmSync(file, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new CliError("LOCKED", `Another nb is working in this folder (${holder.command}, pid ${holder.pid})`, { hint: "Wait for it to finish, or stop it" });
    await new Promise((r) => setTimeout(r, 200));
  }
}

const BASE_MAX_BYTES = 1024 * 1024;

/** Keeps a text base ≤ 1 MB for offline diff (A1.12, D26). @param {string} root @param {string} hash @param {Buffer} content */
export function saveBaseCopy(root, hash, content) {
  if (content.length > BASE_MAX_BYTES || content.includes(0)) return;
  const file = path.join(root, DIR_NAME, "base", hash);
  if (!fs.existsSync(file)) writeAtomic(file, content);
}

/** @param {string} root @param {string} hash */
export function readBaseCopy(root, hash) {
  try {
    return fs.readFileSync(path.join(root, DIR_NAME, "base", hash));
  } catch {
    return null;
  }
}

/** Drops base copies no file points to, then trims oldest past the cap. @param {string} root @param {SyncState} state @param {number} capBytes */
export function pruneBaseCopies(root, state, capBytes = 200 * 1024 * 1024) {
  const dir = path.join(root, DIR_NAME, "base");
  if (!fs.existsSync(dir)) return;
  const live = new Set(Object.values(state.files).map((f) => f.baseHash));
  const kept = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (!live.has(name)) { fs.rmSync(file, { force: true }); continue; }
    const st = fs.statSync(file);
    kept.push({ file, size: st.size, at: st.mtimeMs });
  }
  let total = kept.reduce((sum, f) => sum + f.size, 0);
  for (const f of kept.sort((a, b) => a.at - b.at)) {
    if (total <= capBytes) break;
    fs.rmSync(f.file, { force: true });
    total -= f.size;
  }
}

/** Streaming SHA-256 (no whole-file buffers, A12.7). @param {string} file */
export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => hash.update(d)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}
