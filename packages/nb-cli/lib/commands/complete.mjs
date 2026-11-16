// Tab completion with real names (report C8): task numbers with their titles, member names and file paths, from a
// small cache per workspace that a background `nb complete --refresh` keeps no older than 10 minutes. Completing
// never waits on the network: it answers from the cache, even an old one, and refreshes behind.
import { spawn } from "node:child_process";
import { self } from "../self.mjs";
import fs from "node:fs";
import path from "node:path";

import { globalDir, readJson, writeAtomic } from "../config.mjs";

/** @typedef {import("../context.mjs").Context} Context */
/** @typedef {{ at: number, tasks: Array<[number, string]>, members: string[], files: string[] }} CompleteCache */

export const FRESH_MS = 10 * 60_000;

/** Which kind of name each command's arguments take, for the shell scripts. */
export const ARG_KINDS = /** @type {Record<string, "tasks" | "members" | "files">} */ ({
  "task start": "tasks", "task view": "tasks", "task done": "tasks", "task move": "tasks", "task edit": "tasks", "task assign": "tasks",
  "task watch": "tasks", "task star": "tasks", "task remind": "tasks", "task review": "tasks", "task delete": "tasks", "task open": "tasks",
  "member role": "members", "member remove": "members", "member invite": "members",
  push: "files", pull: "files", diff: "files", edit: "files",
  "file history": "files", "file use": "files", "file view": "files", "file star": "files", "file lock": "files",
  "file copy": "files", "file move": "files", "file rename": "files", "file delete": "files",
});

/** @param {Context} ctx @param {string} workspaceId */
const cacheFile = (ctx, workspaceId) => path.join(globalDir(ctx.env), "complete", `${workspaceId.replace(/[^a-z0-9-]/gi, "")}.json`);

/** Fetches the names and writes the cache. @param {Context} ctx @param {string} workspaceId */
async function refresh(ctx, workspaceId) {
  const [tasks, members, manifest] = await Promise.all([
    ctx.api.get("/api/v1/extension/workspace-tasks", { query: { projectId: workspaceId, scope: "all", open: "1", limit: "100" } }).then((/** @type {any} */ r) => r.tasks, () => []),
    ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`).then((/** @type {any} */ r) => r.members, () => []),
    ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/manifest`).then((/** @type {any} */ r) => r.files, () => []),
  ]);
  /** @type {CompleteCache} */
  const cache = {
    at: Date.now(),
    tasks: tasks.map((/** @type {any} */ t) => [t.taskNumber, String(t.title).slice(0, 60)]),
    members: members.map((/** @type {any} */ m) => m.username).filter(Boolean).slice(0, 200),
    files: manifest.map((/** @type {any} */ f) => String(f.path).replace(/^\//, "")).slice(0, 2000),
  };
  const file = cacheFile(ctx, workspaceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(cache));
  return cache;
}

/**
 * `nb complete tasks|members|files [prefix]`: one candidate per line, `value<TAB>description` for tasks. Hidden; the
 * shell scripts call it. `--refresh` updates the cache now.
 * @param {Context} ctx
 */
export async function complete(ctx) {
  const workspaceId = ctx.project?.workspaceId ?? (typeof ctx.flags.workspace === "string" ? ctx.flags.workspace : null);
  if (!workspaceId || !ctx.profile.token) return 0;
  if (ctx.flags.refresh) { await refresh(ctx, workspaceId); return 0; }
  /** @type {CompleteCache | null} */
  let cache = null;
  try { cache = readJson(cacheFile(ctx, workspaceId)); } catch { cache = null; }
  if (!cache || Date.now() - cache.at > FRESH_MS) {
    // Behind the shell's back, so the Tab press doesn't wait.
    spawn(...self(["complete", "--refresh"]), { cwd: ctx.cwd, detached: true, stdio: "ignore", env: ctx.env }).unref();
  }
  if (!cache) return 0;
  const [kind, prefix = ""] = ctx.positionals;
  const lines = kind === "tasks" ? cache.tasks.map(([n, title]) => `${n}\t${title}`)
    : kind === "members" ? cache.members.map((m) => `@${m}`)
    : kind === "files" ? cache.files
    : [];
  ctx.out.raw(lines.filter((l) => l.startsWith(prefix)).join("\n"));
  return 0;
}
