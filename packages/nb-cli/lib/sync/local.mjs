// What's in the linked folder (report A1.2, A1.3, A1.16). Files are hashed only when size or mtime changed
// since the last sync, like git's index; symlinks and ignored paths are reported, not uploaded.
import fs from "node:fs";
import path from "node:path";

import { createIgnore } from "./ignore.mjs";
import { hashFile } from "./state.mjs";

/**
 * @typedef {{ remote: string, abs: string, size: number, mtimeMs: number, hash: string }} LocalFile
 * @typedef {{ path: string, reason: string }} Skipped
 */

/** Workspace path for a folder-relative path: NFC, forward slashes, under the linked remote folder. @param {string} remoteRoot @param {string} rel */
export function toRemote(remoteRoot, rel) {
  const clean = rel.split(path.sep).join("/").normalize("NFC").replace(/^\/+/, "");
  return remoteRoot === "/" ? `/${clean}` : `${remoteRoot.replace(/\/+$/, "")}/${clean}`;
}

/** Folder-relative path for a workspace path, or null when it's outside the linked remote folder. @param {string} remoteRoot @param {string} remote */
export function toRelative(remoteRoot, remote) {
  const prefix = remoteRoot === "/" ? "/" : `${remoteRoot.replace(/\/+$/, "")}/`;
  return remote.startsWith(prefix) ? remote.slice(prefix.length) : null;
}

/**
 * @param {{ root: string, remoteRoot: string, base: Record<string, import("./state.mjs").BaseEntry>, maxFileBytes?: number, only?: string[] }} input
 *   `only`: folder-relative paths (files or folders) to limit the scan to
 * @returns {Promise<{ files: Map<string, LocalFile>, skipped: Skipped[] }>}
 */
export async function scanLocal({ root, remoteRoot, base, maxFileBytes, only }) {
  const ignored = createIgnore(root);
  /** @type {Map<string, LocalFile>} */
  const files = new Map();
  /** @type {Skipped[]} */
  const skipped = [];

  /** @param {string} rel */
  async function visit(rel) {
    const abs = path.join(root, rel);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return;
    }
    const relPosix = rel.split(path.sep).join("/");
    if (st.isSymbolicLink()) { skipped.push({ path: relPosix, reason: "symlink (not followed)" }); return; }
    if (relPosix && ignored(relPosix, st.isDirectory())) return;
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) await visit(rel ? path.join(rel, name) : name);
      return;
    }
    if (!st.isFile()) return;
    if (maxFileBytes && st.size > maxFileBytes) {
      skipped.push({ path: relPosix, reason: `over the ${Math.round(maxFileBytes / 1024 / 1024)} MB file limit` });
      return;
    }
    const remote = toRemote(remoteRoot, rel);
    const known = base[remote];
    const hash = known && known.size === st.size && known.mtimeMs === st.mtimeMs ? known.baseHash : /** @type {string} */ (await hashFile(abs));
    files.set(remote, { remote, abs, size: st.size, mtimeMs: st.mtimeMs, hash });
  }

  if (only?.length) for (const rel of only) await visit(path.normalize(rel));
  else await visit("");
  return { files, skipped };
}
