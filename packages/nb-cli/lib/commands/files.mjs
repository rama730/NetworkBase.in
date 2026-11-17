// status, pull, push, sync and the offline queue (report §17.4, A1, A4.4, A12.4).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DIR_NAME, readProjectConfig, readUserConfig, writeProjectConfig } from "../config.mjs";
import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { scanLocal, toRelative, toRemote } from "../sync/local.mjs";
import { planSync, stateLabel } from "../sync/plan.mjs";
import { enqueue, QUEUE_TTL_MS, readQueue, writeQueue } from "../sync/queue.mjs";
import { acquireLock, pruneBaseCopies, readState, saveBaseCopy, writeState } from "../sync/state.mjs";
import { conflictCopyPath, downloadTo, fetchManifest, renameRetry, safeJoin, uploadFiles } from "../sync/transfer.mjs";
import { confirm } from "../tui/ask.mjs";
import { branchTask, resolveTask } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */
/** @typedef {import("../sync/plan.mjs").PlanItem} PlanItem */

/** Paths given on the command line, as paths relative to the linked folder. @param {Context} ctx @param {string} root */
export function relativeArgs(ctx, root) {
  // No paths given: the folders this copy keeps (C3, nb sync --only), or everything.
  if (!ctx.positionals.length && ctx.project?.only?.length) return [...ctx.project.only];
  return ctx.positionals.map((p) => {
    const rel = path.relative(root, path.resolve(ctx.cwd, p));
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw usage(`${p} is outside the linked folder ${root}`);
    return rel;
  });
}

/**
 * Server, base and local side by side. Offline: the server side is the base, and status says so (A12.4).
 * @param {Context} ctx @param {{ only?: string[], noFollow?: boolean, leaving?: boolean }} [options]
 */
export async function buildPlan(ctx, options = {}) {
  // A copy that keeps only some folders (C3) plans just those, so status doesn't list the rest as server-only.
  if (!options.only?.length && ctx.project?.only?.length) options = { ...options, only: ctx.project.only };
  const { root, project } = ctx.requireRoot();
  // The folder follows its git branch first (report H6); offline it stays where it is.
  if (!options.noFollow) {
    const { followGit } = await import("./branch.mjs");
    await followGit(ctx).catch((error) => { if (!(error instanceof CliError) || error.code !== "OFFLINE") throw error; });
  }
  const state = readState(root, project.workspaceId);
  let offline = false;
  /** @type {Awaited<ReturnType<typeof fetchManifest>>} */
  let manifest;
  try {
    manifest = await fetchManifest(ctx.api, project.workspaceId, project.branch?.id ?? null);
  } catch (error) {
    // Leaving a branch that was deleted or merged (H24): its side is what was last pulled, so edits still show.
    const gone = options.leaving && error instanceof CliError && error.code === "BRANCH_DELETED";
    if (!(error instanceof CliError) || (error.code !== "OFFLINE" && !gone)) throw error;
    offline = !gone;
    manifest = { files: new Map(Object.entries(state.files).map(([p, b]) => [p, { path: p, nodeId: b.nodeId, version: b.baseVersion, hash: b.baseHash, size: b.size }])), canWrite: true, largestFileBytes: 0, branch: null };
  }
  // The folder keeps its branch by id; a rename elsewhere only changes the name it shows (H24).
  if (project.branch && manifest.branch?.id === project.branch.id && manifest.branch.name !== project.branch.name) {
    project.branch = { id: project.branch.id, name: manifest.branch.name };
    writeProjectConfig(root, { ...readProjectConfig(root), ...project });
  }
  // Only the part of the workspace this folder is linked to (A1.1 item 5).
  const remote = new Map([...manifest.files].filter(([p]) => toRelative(project.remoteRoot, p) !== null));
  const { files: local, skipped } = await scanLocal({ root, remoteRoot: project.remoteRoot, base: state.files, maxFileBytes: manifest.largestFileBytes || undefined, only: options.only });
  let items = planSync({ base: state.files, local, remote });
  if (options.only?.length) {
    const prefixes = options.only.map((rel) => toRemote(project.remoteRoot, rel));
    items = items.filter((i) => prefixes.some((pre) => i.path === pre || i.path.startsWith(pre.endsWith("/") ? pre : `${pre}/`)));
  }
  return { root, project, state, manifest, items, skipped, offline };
}

/** @param {string} root @param {string} remoteRoot @param {string} remotePath */
export const localPathOf = (root, remoteRoot, remotePath) => safeJoin(root, /** @type {string} */ (toRelative(remoteRoot, remotePath)));

/** Moves a local file into .networkbase/trash (kept 30 days) instead of deleting it (A1.6). @param {string} root @param {string} abs */
export function moveToLocalTrash(root, abs) {
  const dest = path.join(root, DIR_NAME, "trash", new Date().toISOString().replace(/[:.]/g, "-"), path.relative(root, abs));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  renameRetry(abs, dest);
  return dest;
}

/** Records a synced file as the new base. @param {import("../sync/state.mjs").SyncState} state @param {string} p @param {{ nodeId: string, version: number, hash: string, abs: string }} f */
export function recordBase(state, p, f) {
  const st = fs.statSync(f.abs);
  state.files[p] = { nodeId: f.nodeId, baseVersion: f.version, baseHash: f.hash, size: st.size, mtimeMs: st.mtimeMs };
  delete state.conflicts[p];
}

// ───────────────────────────────── status

/** @param {Context} ctx */
export async function status(ctx) {
  // The day's counts ride along (C2 "a home screen in nb status"); offline or refused, status still works.
  const started = ctx.project?.startedTask?.id ?? null;
  const homeP = ctx.api.get("/api/v1/home", { query: started ? { task: started } : {} }).then((/** @type {any} */ h) => h, () => null);
  const { root, project, items, skipped, offline, manifest } = await buildPlan(ctx);
  const home = /** @type {any} */ (await homeP);
  const today = home ? { dueThisWeek: home.tasks.dueThisWeek, overdue: home.tasks.overdue, unread: home.unread } : null;
  // A started task deleted elsewhere (or no longer yours to see) stops being this folder's task (found in M4a).
  if (started && home && home.currentTask === null) {
    writeProjectConfig(root, { ...project, startedTask: null });
    ctx.out.note(ctx.out.c.muted(`#${project.startedTask?.number ?? ""} was deleted (or you can't see it now), so no task is started here: nb task start <n>`));
    project.startedTask = null;
  }
  const changed = items.filter((i) => i.state !== "unchanged");
  const conflicts = changed.filter((i) => i.state === "conflict");
  const data = {
    workspace: { id: project.workspaceId, slug: project.slug, title: project.title },
    branch: project.branch ? project.branch.name : "main",
    // The current task (C8): the started one, or the one the nb/<n>- git branch names.
    startedTask: project.startedTask ?? ((n) => (n ? { number: Number(n), title: "(from the git branch)" } : null))(branchTask(root)),
    offline,
    readOnly: !manifest.canWrite,
    queued: readQueue(root).length,
    today,
    files: changed.map((i) => ({ path: i.path, state: i.state, action: i.action, ...(i.note ? { note: i.note } : {}), ...(i.remote ? { remoteVersion: i.remote.version } : {}) })),
    skipped,
  };
  const { c, sym } = ctx.out;
  ctx.out.result("nb.status/1", data, (d) => {
    const task = d.startedTask ? ` · #${d.startedTask.number ?? ""} ${safe(d.startedTask.title ?? "")}` : "";
    const head = `${c.brand(sym.brand)} ${safe(project.slug ?? project.workspaceId)}${project.branch ? ` · on branch ${c.accent(safe(project.branch.name))}` : ""}${task}${d.readOnly ? ` · ${c.warning("read only")}` : ""}${d.offline ? ` · ${c.warning("offline: server side not checked")}` : ""}`;
    const queued = d.queued ? [`  ${c.warning(`${d.queued} push(es) queued while offline: nb queue`)}`] : [];
    const t = d.today;
    const here = d.files.filter((f) => f.action === "push" || f.state === "conflict").length;
    const day = t ? [t.dueThisWeek && `${t.dueThisWeek} due this week`, t.overdue && c.warning(`${t.overdue} overdue`), t.unread && `${t.unread} unread`, here && `${here} ${here === 1 ? "file" : "files"} changed here`].filter(Boolean) : [];
    if (day.length) queued.unshift(`  ${day.join(" · ")}`);
    if (!d.files.length) return [head, ...queued, `  ${c.muted(`Up to date · ${root}`)}`, ...skippedLines(d.skipped)];
    // A freshly linked folder: hundreds of server files are one line, not a table (C16 #5).
    const waiting = d.files.filter((f) => f.state === "remote-added");
    if (waiting.length > 20) {
      const rest = d.files.filter((f) => f.state !== "remote-added");
      const line = `  ${waiting.length} files on the server · ${c.muted("nb pull to get them")}`;
      if (!rest.length) return [head, ...queued, line, ...skippedLines(d.skipped)];
      d = { ...d, files: rest };
      queued.push(line);
    }
    const color = (/** @type {string} */ s) => (s === "conflict" ? c.danger : s === "modified" || s === "added" ? c.accent : s.startsWith("remote") ? c.info : c.muted);
    const counts = Object.entries(d.files.reduce((/** @type {Record<string, number>} */ acc, f) => ({ ...acc, [f.state]: (acc[f.state] ?? 0) + 1 }), {})).map(([s, n]) => `${n} ${s}`).join(" · ");
    const rows = ctx.out.table([
      { title: "State", value: (f) => color(f.state)(stateLabel(/** @type {any} */ (f))) },
      { title: "Path", value: (f) => safe(f.path), flex: true, path: true },
      { title: "", value: (f) => (f.note ? c.muted(f.note) : "") },
    ], d.files);
    const next = conflicts.length ? `nb resolve ${safe(conflicts[0]?.path.slice(1) ?? "")} --mine|--theirs|--both` : changed.some((f) => f.action === "push") ? "nb push <files>" : "nb pull";
    return [head, ...queued, `  ${counts}`, "", ...rows, ...skippedLines(d.skipped), "", `  ${c.muted(next)}`];
  });
  if (conflicts.length) return EXIT.conflict;
  return offline ? EXIT.offline : EXIT.ok;
}

/** @param {Array<{ path: string, reason: string }>} skipped */
const skippedLines = (skipped) => (skipped.length ? ["", `  skipped: ${skipped.slice(0, 5).map((s) => `${safe(s.path)} (${s.reason})`).join(", ")}${skipped.length > 5 ? ` and ${skipped.length - 5} more` : ""}`] : []);

// ───────────────────────────────── pull

/** @param {Context} ctx @param {{ quietResult?: boolean }} [options] */
export async function pull(ctx, options = {}) {
  const { root } = ctx.requireRoot();
  const only = relativeArgs(ctx, root);
  const release = ctx.flags["dry-run"] ? () => {} : await acquireLock(root, "nb pull");
  try {
    const plan = await buildPlan(ctx, { only });
    if (plan.offline) throw new CliError("OFFLINE", "Can't reach the server to pull", { hint: "Try again when you're online" });
    const { project, state } = plan;
    let todo = plan.items.filter((i) => ["pull", "restore", "adopt", "remove-local", "conflict"].includes(i.action));
    // On disks that ignore letter case (macOS, Windows), Report.md and report.md would be one file: the first one
    // wins and the other is skipped with a note, never overwritten (A1.16).
    /** @type {Array<{ path: string, reason: string }>} */
    const skipped = [];
    if (process.platform === "darwin" || process.platform === "win32") {
      const taken = new Map(Object.keys(state.files).concat(todo.map((i) => i.path)).sort().map((p) => [p.toLowerCase(), p]));
      todo = todo.filter((i) => {
        const owner = taken.get(i.path.toLowerCase());
        if (owner === i.path || state.files[i.path]) return true;
        skipped.push({ path: i.path, reason: `same name as ${owner} except for letter case` });
        return false;
      });
    }
    if (ctx.flags["dry-run"]) {
      return ctx.out.result("nb.pull.plan/1", { files: todo.map((i) => ({ path: i.path, action: i.action })) }, (d) => (d.files.length ? d.files.map((f) => `  would ${f.action.replace("-", " ")}  ${safe(f.path)}`) : "Nothing to pull"));
    }
    /** @type {Array<{ path: string, did: string, version?: number, by?: string, copy?: string }>} */
    const results = [];
    /** @param {PlanItem} item */
    const apply = async (item) => {
      const r = /** @type {import("../sync/plan.mjs").RemoteFile} */ (item.remote);
      let abs;
      try {
        abs = localPathOf(root, project.remoteRoot, item.path);
      } catch (error) {
        if (error instanceof CliError && error.code === "UNSAFE_PATH" && /** @type {any} */ (error.details)?.protected) {
          skipped.push({ path: item.path, reason: "it's inside a .git or .networkbase folder, which nb never writes" });
          return;
        }
        if (!(error instanceof CliError) || error.code !== "RESERVED_NAME") throw error;
        skipped.push({ path: item.path, reason: "Windows can't hold a file with this name" });
        return;
      }
      if (item.action === "adopt") {
        recordBase(state, item.path, { nodeId: r.nodeId, version: r.version, hash: r.hash ?? "", abs });
        return;
      }
      if (item.action === "remove-local") {
        const kept = moveToLocalTrash(root, abs);
        delete state.files[item.path];
        results.push({ path: item.path, did: "removed (deleted on the server)", copy: path.relative(root, kept) });
        return;
      }
      if (item.action === "conflict") {
        // Never overwrite: the server's version lands next to yours (A1.7, D18).
        const copy = conflictCopyPath(abs, r.version);
        await downloadTo(ctx.api, project.workspaceId, item.path, copy, r.hash, project.branch?.id ?? null);
        state.conflicts[item.path] = { remoteVersion: r.version, copy: path.relative(root, copy) };
        results.push({ path: item.path, did: "conflict", version: r.version, copy: path.relative(root, copy) });
        return;
      }
      const got = await downloadTo(ctx.api, project.workspaceId, item.path, abs, r.hash, project.branch?.id ?? null).catch((error) => {
        // A file whose content isn't on the server yet (an unfinished import) is skipped, not the end of the pull.
        if (error instanceof CliError && error.code === "CONTENT_NOT_READY") { skipped.push({ path: item.path, reason: "its content isn't on the server yet" }); return null; }
        throw error;
      });
      if (!got) return;
      // Executable files (scripts, bin/) come back executable (report G16). Windows has no such bit.
      if (/** @type {any} */ (r).executable && process.platform !== "win32") fs.chmodSync(abs, fs.statSync(abs).mode | 0o111);
      if (got.content) saveBaseCopy(root, got.hash, got.content);
      recordBase(state, item.path, { nodeId: r.nodeId, version: r.version, hash: got.hash, abs });
      results.push({ path: item.path, did: item.action === "restore" ? "restored" : item.base ? "updated" : "new", version: r.version });
      // State is saved every 100 files; after a crash, a downloaded file matching the server is adopted next run.
      if (results.length % 100 === 0) writeState(root, state);
    };
    // 8 downloads at a time, 4 on Windows (A12.6).
    let next = 0;
    const worker = async () => { while (next < todo.length) await apply(/** @type {PlanItem} */ (todo[next++])); };
    // What did arrive is recorded even when a later file stops the pull, so it isn't a conflict next time.
    await Promise.all(Array.from({ length: Math.min(process.platform === "win32" ? 4 : 8, todo.length) }, worker)).catch((error) => { writeState(root, state); throw error; });
    results.sort((a, b) => a.path.localeCompare(b.path));
    writeState(root, state);
    pruneBaseCopies(root, state, Number(readUserConfig(ctx.env)["base-cache-mb"] ?? 200) * 1024 * 1024);
    const conflicts = results.filter((r) => r.did === "conflict");
    if (!options.quietResult) {
      ctx.out.result("nb.pull/1", { files: results, skipped }, (d) => {
        const skippedLines = d.skipped.map((x) => ctx.out.c.warning(`  skipped   ${safe(x.path)} (${x.reason})`));
        if (!d.files.length) return skippedLines.length ? ["Up to date", ...skippedLines] : "Up to date";
        const { c, sym } = ctx.out;
        return [
          `${c.success(sym.done)} Pulled ${d.files.length - conflicts.length} ${d.files.length - conflicts.length === 1 ? "file" : "files"}${conflicts.length ? ` · ${c.danger(`${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`)}` : ""}`,
          ...d.files.map((f) => `  ${f.did === "conflict" ? c.danger("conflict") : f.did.padEnd(8)}  ${safe(f.path)}${f.version ? c.muted(` v${f.version}`) : ""}${f.copy ? c.muted(` → ${safe(f.copy)}`) : ""}`),
          ...(conflicts.length ? [c.muted(`  Server's version saved next to yours. Settle with nb resolve <path> --mine|--theirs|--both`)] : []),
          ...skippedLines,
        ];
      });
    }
    return conflicts.length ? EXIT.conflict : EXIT.ok;
  } finally {
    release();
  }
}

// ───────────────────────────────── push

/** 1.x `--done` / `--wip` changed task status as a side effect of uploading; 2.0 only uploads (finding 135). @param {Context} ctx */
function oldStatusFlags(ctx) {
  if (ctx.flags.done) ctx.out.warn("--done no longer changes the task's status. After the push: nb task done");
  if (ctx.flags.wip) ctx.out.warn("--wip no longer changes the task's status. Use: nb task move <task> in_progress");
}

/** @param {Context} ctx */
/**
 * Main's protection, read before pushing to main (report H5, H6). Returns null to push as usual, or the exit code of
 * the push it made on a new branch. Offline or with Branches off it changes nothing.
 * @param {Context} ctx @param {string} root
 */
async function pushToProtectedMain(ctx, root) {
  const project = /** @type {any} */ (ctx.requireRoot().project);
  if (project.branch || ctx.flags["dry-run"] || /** @type {any} */ (ctx).queueId) return null;
  const rules = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(project.workspaceId)}/protection`).catch(() => null))?.rules;
  const agent = String(ctx.profile?.token ?? "").startsWith("nb_agt_");
  if (!rules || !(rules.requireMergeRequest || (agent && rules.agentsOnBranches))) return null;
  const { readGitHead, switchTo } = await import("./branch.mjs");
  if (readGitHead(root)) {
    throw new CliError("BRANCH_PROTECTED", agent ? "Agents work on a branch here: main changes only through merge requests" : "main is protected: it changes only through merge requests", {
      hint: "git switch -c <you>/<what>, then nb push again (NetworkBase follows git and offers to make the branch)",
    });
  }
  const day = new Date().toISOString().slice(0, 10);
  const who = String(ctx.profile?.user?.username ?? "me").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-") || "me";
  const base = agent ? `agent/${day}-push` : `${who}/${day}`;
  if (!agent) {
    const ok = await confirm(ctx, { key: "branch", question: `main is protected: push to branch ${base} and open a merge request?`, yesLabel: "Push to branch", defaultYes: true });
    if (!ok) return EXIT.cancelled;
  }
  /** @type {any} */
  let made = null;
  for (let i = 1; !made && i <= 20; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    made = await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(project.workspaceId)}/branches`, { name }).catch((/** @type {any} */ error) => {
      if (error instanceof CliError && error.code === "BRANCH_EXISTS") return null;
      throw error;
    });
  }
  if (!made) throw new CliError("BRANCH_EXISTS", `Couldn't find a free branch name after ${base}`, { hint: "nb branch create <name>, nb branch switch <name>, then nb push" });
  const branch = made.branch;
  await switchTo(ctx, { ...branch, isDefault: false }, { carry: true });
  ctx.out.note(ctx.out.c.muted(`main is protected: this folder is now on ${safe(branch.name)}`));
  const code = await push(ctx);
  if (code !== EXIT.ok && code !== undefined) return code;
  const opened = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(project.workspaceId)}/merge-requests`, { source: branch.name, ...(ctx.flags.message ? { title: String(ctx.flags.message) } : {}) }));
  const n = opened?.mergeRequest?.number;
  ctx.out.note(`${ctx.out.c.success(ctx.out.sym.done)} Opened merge request !${n} for review${ctx.out.c.muted(` · nb merge-request view ${n}`)}`);
  return EXIT.ok;
}

export async function push(ctx) {
  oldStatusFlags(ctx);
  const { root } = ctx.requireRoot();
  // --from-git: what the last commit changed, its subject as the message, its NetworkBase-Task trailer as the task.
  if (ctx.flags["from-git"]) {
    const { filesFromLastCommit } = await import("./extras.mjs");
    const last = await filesFromLastCommit(ctx.cwd);
    if (!last.paths.length) throw usage("The last commit changed no files in this folder");
    ctx.positionals = last.paths;
    ctx.flags.message ??= last.subject || undefined;
    if (last.task && !ctx.flags.task) ctx.flags.task = last.task;
  }
  const only = relativeArgs(ctx, root);
  if (!only.length && !ctx.flags.all && !ctx.out.interactive) {
    // Never upload a whole folder without being told which files (finding 21).
    throw usage("Say which files to push", "nb push <paths…>, or nb push --all for every changed tracked file");
  }
  // A push always goes to the branch the folder is on (report H6); a detached git head has none, so it's refused.
  const { readGitHead } = await import("./branch.mjs");
  if (readGitHead(root)?.detached) throw new CliError("DETACHED_HEAD", "git isn't on a branch here (a detached HEAD), so there's no branch to push to", { hint: "git switch <branch> (or git switch -c <new-branch>), then nb push" });
  const as = ctx.flags.as ?? readUserConfig(ctx.env)["default-as"] ?? null;
  if (as && !["reference", "draft", "final"].includes(as)) throw usage(`--as must be reference, draft or final (not ${as})`);
  // A protected main (report H5): the push goes to a new branch with a merge request instead (asked first; agents
  // go straight to theirs). In a git folder NetworkBase follows git, so the fix is a git branch.
  const onBranch = await pushToProtectedMain(ctx, root);
  if (onBranch !== null) return onBranch;
  const keyBase = /** @type {any} */ (ctx).queueId ?? crypto.randomUUID();
  const queueOffline = () => {
    if (ctx.flags["dry-run"]) return new CliError("OFFLINE", "Can't reach the server", { hint: "Try again when you're online" });
    const flags = Object.fromEntries(["task", "as", "message", "keep-both", "folder", "all"].filter((k) => ctx.flags[k] !== undefined).map((k) => [k, ctx.flags[k]]));
    const n = enqueue(root, { id: keyBase, op: "push", paths: only, flags, queuedAt: new Date().toISOString(), reason: "the server couldn't be reached" });
    return new CliError("OFFLINE", `Offline: queued this push${n > 1 ? ` (${n} waiting)` : ""}`, { hint: "It sends with your next nb sync; your files are unchanged" });
  };
  const release = ctx.flags["dry-run"] ? () => {} : await acquireLock(root, "nb push");
  try {
    const plan = await buildPlan(ctx, { only });
    if (plan.offline) throw queueOffline();
    const { project, state } = plan;
    // A file you named that can't go up is an error that says why, never "Nothing changed" (C16 #2).
    const named = new Set(only.map((p) => p.split(path.sep).join("/").replace(/^\/+/, "")));
    const refused = plan.skipped.find((s) => named.has(s.path.replace(/^\/+/, "")));
    if (refused) {
      const limit = plan.manifest.largestFileBytes;
      const bytes = (() => { try { return fs.statSync(path.join(root, refused.path)).size; } catch { return 0; } })();
      const mb = (/** @type {number} */ n) => Math.ceil(n / 1024 / 1024);
      throw /^over the/.test(refused.reason) && limit
        ? new CliError("PLAN_LIMIT_FILE_SIZE", `${safe(refused.path)} is ${mb(bytes)} MB; files can be up to ${mb(limit)} MB`, { hint: "Make it smaller, or share it as a link" })
        : new CliError("USAGE", `${safe(refused.path)} can't be pushed: ${refused.reason}`);
    }
    if (!plan.manifest.canWrite) throw new CliError("READ_ONLY", "You can read this workspace but not change it", { hint: "Ask an owner for member access" });
    // With no paths, only files NetworkBase already tracks; new files are pushed by naming them (A1.6, §17.4).
    let items = plan.items.filter((i) => i.action === "push" && (only.length || i.base));
    let moves = plan.items.filter((i) => i.action === "move");
    // --recreate: files deleted on the server that you still have go back up as new files (§17.4.1).
    if (ctx.flags.recreate) items = items.concat(plan.items.filter((i) => (i.action === "remove-local" || i.action === "keep-local") && i.local).map((i) => ({ ...i, base: undefined })));
    const conflicts = plan.items.filter((i) => i.action === "conflict");
    const deletions = only.length ? plan.items.filter((i) => i.action === "delete-remote") : [];
    const behind = plan.items.filter((i) => i.action === "pull" || i.action === "restore");

    if (conflicts.length && !ctx.flags.force) {
      throw new CliError("LOCAL_CONFLICT", `${conflicts.length === 1 ? safe(conflicts[0]?.path) : `${conflicts.length} files`} changed here and on the server`, { hint: `Run nb resolve ${safe(conflicts[0]?.path.slice(1) ?? "<path>")}, or nb pull to get a copy of the server's version`, details: { conflicts: conflicts.map((i) => ({ path: i.path, remoteVersion: i.remote?.version })) } });
    }
    if (conflicts.length && ctx.flags.force) {
      const ok = await confirm(ctx, { key: "force", question: `Replace the server's newer version of ${conflicts.length} file(s) with yours?`, yesLabel: "Replace", defaultYes: false });
      if (!ok) return EXIT.cancelled;
      items = items.concat(conflicts);
    }
    if (!only.length && !ctx.flags.all && items.length) {
      const ok = await confirm(ctx, { key: "push", question: `Push ${items.length} changed file(s)?`, preview: items.slice(0, 10).map((i) => i.path).join("\n"), yesLabel: "Push", defaultYes: true });
      if (!ok) return EXIT.cancelled;
    }
    if (ctx.flags["dry-run"]) {
      return ctx.out.result("nb.push.plan/1", { files: items.map((i) => ({ path: i.path, state: i.state })), moves: moves.map((m) => ({ from: m.from, to: m.path })), deletions: deletions.map((i) => i.path) }, (d) => (d.files.length || d.deletions.length || d.moves.length ? [...d.files.map((f) => `  would push    ${safe(f.path)}`), ...d.moves.map((m) => `  would move    ${safe(m.from)} ${ctx.out.sym.arrow} ${safe(m.to)}`), ...d.deletions.map((p) => `  would delete  ${safe(p)}`)] : "Nothing to push"));
    }
    // On a branch everything goes up as one change set saved on that branch (report H6, H14); task files, roles and
    // folders belong to main.
    if (project.branch) {
      if (as || ctx.flags.folder || ctx.flags["keep-both"]) throw usage("On a branch, files go to the branch; task files and roles stay on main", "nb branch switch main for those");
      const { pushToBranch } = await import("./change.mjs");
      return await pushToBranch(ctx, root, project, state, { items, moves, deletions, conflicts: ctx.flags.force ? conflicts : [] });
    }
    // Moves and renames keep the file's history (A1.17). One the server can't do in place (a new folder, or both
    // name and folder changed) goes up as a new file and the old one to Trash, like before.
    let moved = 0;
    for (const m of moves) {
      const done = await moveOnServer(ctx, project.workspaceId, m).catch(() => false);
      const local = /** @type {import("../sync/local.mjs").LocalFile} */ (m.local);
      if (done) {
        delete state.files[/** @type {string} */ (m.from)];
        recordBase(state, m.path, { nodeId: /** @type {any} */ (m.remote).nodeId, version: /** @type {any} */ (m.remote).version, hash: local.hash, abs: local.abs });
        moved++;
      } else {
        items.push({ ...m, action: "push", state: "added", base: undefined, remote: undefined });
        deletions.push({ ...m, path: /** @type {string} */ (m.from), action: "delete-remote", state: "deleted" });
      }
    }
    moves = moves.filter((m) => state.files[m.path]);
    // The started task gets the files unless told otherwise (C16 #1, C8): nb task start promises it.
    // The current task (C8): --task, the started one, or the nb/<n>- git branch; --no-task opts out.
    const taskRef = ctx.flags.task ?? (ctx.flags["no-task"] ? null : ctx.project?.startedTask?.id ?? branchTask(root));
    const task = taskRef ? await resolveTask(ctx, String(taskRef)) : null;
    // Bigger than one upload call (50 files, 4 MB): a plain push goes up as one change set, so all of it lands or
    // none (report G17). With a task, a role, a folder or keep-both it goes up as before.
    const bytes = items.reduce((n, i) => n + Number(i.local?.size ?? 0), 0);
    // Agents' saves go into change sets as they work (nb mcp); their pushes keep the yes flow they have.
    const agentToken = String(ctx.profile?.token ?? "").startsWith("nb_agt_");
    if ((items.length > 50 || bytes > 4 * 1024 * 1024) && !task && !agentToken && (!as || as === "draft") && !ctx.flags.folder && !ctx.flags["keep-both"] && !ctx.flags.force) {
      const { pushAsChangeSet } = await import("./change.mjs");
      const done = await pushAsChangeSet(ctx, root, project, items);
      if (done) {
        for (const a of done.applied) {
          const item = items.find((i) => i.path === a.path);
          if (item?.local && a.version != null) recordBase(state, a.path, { nodeId: a.nodeId, version: a.version, hash: item.local.hash, abs: item.local.abs });
        }
        writeState(root, state);
        return ctx.out.result("nb.push/1", { files: done.applied, changeSet: { id: done.changeSet.id, title: done.changeSet.title } }, (d) => [
          `${ctx.out.c.success(ctx.out.sym.done)} Pushed ${d.files.length} files as one change set: ${safe(d.changeSet.title)}`,
          ctx.out.c.muted(`  Undo all of it: nb change undo ${d.changeSet.id.slice(0, 8)}`),
        ]);
      }
    }
    const uploaded = items.length
      ? await uploadFiles(ctx.api, {
          workspaceId: project.workspaceId,
          items: items.map((i) => ({ path: i.path, abs: /** @type {any} */ (i.local).abs, size: /** @type {any} */ (i.local).size, hash: /** @type {any} */ (i.local).hash, baseVersion: ctx.flags.force && i.state === "conflict" ? null : i.base?.baseVersion ?? null })),
          taskId: task?.id ?? null,
          as,
          message: ctx.flags.message ?? null,
          keepBoth: Boolean(ctx.flags["keep-both"]),
          folder: ctx.flags.folder ?? null,
          confirmSecrets: Boolean(ctx.flags["confirm-secrets"]),
          keyBase,
          // A big file shows how far it got (C3), on one line in a terminal.
          onBytes: ctx.out.interactive && !ctx.out.json ? (p, sent, total) => {
            const mb = (/** @type {number} */ n) => (n / 1024 / 1024).toFixed(1);
            ctx.out.stderr.write(`\r\x1b[2K${ctx.out.c.muted(`Uploading ${safe(p)} ${mb(sent)} of ${mb(total)} MB`)}${sent >= total ? "\n" : ""}`);
          } : undefined,
        }, (done, total) => { if (total > 1) ctx.out.note(ctx.out.c.muted(`Uploading ${done} of ${total}`)); }).catch((error) => handlePushError(ctx, root, state, error instanceof CliError && error.code === "OFFLINE" ? queueOffline() : error))
      : { files: [], transition: null };

    for (const f of uploaded.files) {
      const item = items.find((i) => i.path === f.path);
      if (item?.local) recordBase(state, f.path, { nodeId: f.nodeId, version: f.version, hash: f.contentHash ?? item.local.hash, abs: item.local.abs });
      if (item?.local && f.status !== "unchanged") saveBaseCopy(root, item.local.hash, fs.readFileSync(item.local.abs));
    }
    // Deleting on the server is a change other people see: it asks first (report §26.6).
    let deleted = 0;
    if (deletions.length && (await confirm(ctx, { key: "delete", question: `Move ${deletions.length} file(s) you deleted here to the workspace Trash?`, preview: deletions.map((d) => d.path).join("\n"), yesLabel: "Move to Trash", defaultYes: false }))) {
      for (const d of deletions) {
        await ctx.api.post("/api/v1/extension/file-operation", { kind: "trash", projectId: project.workspaceId, nodeId: d.remote?.nodeId, expectedUpdatedAt: d.remote?.updatedAt });
        delete state.files[d.path];
        deleted++;
      }
    }
    writeState(root, state);

    const changedFiles = uploaded.files.filter((/** @type {any} */ f) => f.status !== "unchanged");
    const data = { files: uploaded.files.map((/** @type {any} */ f) => ({ path: f.path, status: f.status, version: f.version, versionTransition: f.versionTransition })), task: task ? { id: task.id, number: task.taskNumber, title: task.title } : null, as, transition: uploaded.transition, deleted, moved, moves: moves.map((m) => ({ from: m.from, to: m.path })), behind: behind.map((b) => b.path) };
    ctx.out.result("nb.push/1", data, (d) => {
      const { c, sym } = ctx.out;
      if (!changedFiles.length && !d.deleted && !d.moved) return `Nothing changed${d.behind.length ? c.muted(` · ${d.behind.length} newer on the server: nb pull`) : ""}`;
      const where = d.task ? ` to #${d.task.number ?? ""} ${safe(d.task.title ?? "")}${d.as ? ` as ${d.as}` : ""}` : d.as ? ` as ${d.as}` : "";
      const lines = [`${c.success(sym.done)} Pushed ${changedFiles.length} ${changedFiles.length === 1 ? "file" : "files"}${where}${d.moved ? ` · ${d.moved} moved` : ""}${d.deleted ? ` · ${d.deleted} moved to Trash` : ""}`];
      for (const m of d.moves.slice(0, 20)) lines.push(`  ${safe(m.from)} ${c.muted(sym.arrow)} ${safe(m.to)}`);
      for (const f of changedFiles.slice(0, 20)) lines.push(`  ${safe(f.path)} ${c.muted(f.status === "new" ? "v1 (new)" : `v${f.version - 1} ${sym.arrow} v${f.version}`)}`);
      if (d.transition) lines.push(d.transition.ok ? `  ${d.transition.outcome === "submitted" ? "Sent for review" : `Task moved to ${String(d.transition.status).replace("_", " ")}`}` : c.warning(`  Task status didn't change: ${safe(d.transition.message)}`));
      if (d.behind.length) lines.push(c.muted(`  ${d.behind.length} newer on the server: nb pull`));
      return lines;
    });
    return EXIT.ok;
  } finally {
    release();
  }
}

/**
 * Renames in place, or moves to a folder that exists on the server. False when it can't (then: upload + Trash).
 * @param {Context} ctx @param {string} workspaceId @param {PlanItem} m
 */
async function moveOnServer(ctx, workspaceId, m) {
  const from = /** @type {string} */ (m.from);
  const [fromDir, toDir] = [path.posix.dirname(from), path.posix.dirname(m.path)];
  const [fromName, toName] = [path.posix.basename(from), path.posix.basename(m.path)];
  if (fromDir !== toDir && fromName !== toName) return false;
  const nodeId = /** @type {any} */ (m.remote).nodeId;
  const meta = /** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId: workspaceId, path: from, transfer: "metadata" } }));
  const expectedUpdatedAt = new Date(meta.updatedAt).toISOString();
  if (fromDir === toDir) {
    await ctx.api.post("/api/v1/extension/file-operation", { kind: "rename", projectId: workspaceId, nodeId, name: toName, expectedUpdatedAt });
    return true;
  }
  const parentId = toDir === "/" ? null : (/** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId: workspaceId, path: toDir, transfer: "metadata" } }))).nodeId;
  if (toDir !== "/" && !parentId) return false;
  await ctx.api.post("/api/v1/extension/file-operation", { kind: "move", projectId: workspaceId, nodeId, parentId, expectedUpdatedAt });
  return true;
}

/**
 * Turns server refusals into the folder's state and a clear next step.
 * @param {Context} ctx @param {string} root @param {import("../sync/state.mjs").SyncState} state @param {unknown} error
 * @returns {never}
 */
function handlePushError(ctx, root, state, error) {
  if (error instanceof CliError && error.code === "VERSION_CONFLICT") {
    const list = /** @type {any} */ (error.details)?.conflicts ?? [];
    for (const conflict of list) state.conflicts[conflict.path] = { remoteVersion: conflict.currentVersion, copy: "" };
    writeState(root, state);
    throw new CliError("VERSION_CONFLICT", error.message, { hint: "Run nb pull (your files stay; the server's version is saved next to them), then nb resolve", details: error.details });
  }
  if (error instanceof CliError && error.code === "SECRET_DETECTED") {
    const findings = /** @type {any} */ (error.details)?.findings ?? [];
    throw new CliError("SECRET_DETECTED", `Not pushed: ${findings.map((/** @type {any} */ f) => `${f.path}${f.line ? `:${f.line}` : ""} (${f.rule})`).join(", ")}`, { hint: "Remove the secret, or add --confirm-secrets if it's safe to share", details: error.details });
  }
  throw error;
}

// ───────────────────────────────── sync

/** Pull, then push changed tracked files; new files are pushed by naming them (report §17.4). @param {Context} ctx */
export async function sync(ctx) {
  oldStatusFlags(ctx);
  // `nb sync --only design/ docs/` remembers which folders this copy keeps; `--only all` goes back to everything (C3).
  if (ctx.flags.only !== undefined) {
    const { root, project } = ctx.requireRoot();
    const raw = /** @type {string[]} */ ([ctx.flags.only].flat()).concat(ctx.positionals).flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean);
    const only = raw.includes("all") ? [] : raw.map((p) => {
      const rel = path.relative(root, path.resolve(ctx.cwd, p));
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw usage(`${p} is outside the linked folder ${root}`);
      return rel;
    });
    writeProjectConfig(root, { ...project, only });
    ctx.project = { ...project, only };
    ctx.positionals = [];
    ctx.out.note(only.length ? `This copy keeps ${only.map((o) => `${o}/`).join(", ")} in sync · nb sync --only all for everything` : "This copy keeps everything in sync");
  }
  await replayQueue(ctx);
  const pulled = await pull(ctx, { quietResult: true });
  if (pulled === EXIT.conflict) {
    ctx.out.warn("Conflicts after pulling: settle them with nb resolve, then nb sync again");
    return status(ctx);
  }
  const plan = await buildPlan(ctx);
  const tracked = plan.items.filter((i) => i.action === "push" && i.base);
  const fresh = plan.items.filter((i) => i.action === "push" && !i.base);
  if (!tracked.length) {
    ctx.out.result("nb.sync/1", { pushed: [], newFiles: fresh.map((i) => i.path) }, (d) => [`${ctx.out.c.success(ctx.out.sym.done)} In sync`, ...(d.newFiles.length ? [ctx.out.c.muted(`  ${d.newFiles.length} new file(s) here aren't on NetworkBase yet: nb push <files>`)] : [])]);
    return EXIT.ok;
  }
  const ctx2 = /** @type {Context} */ ({ ...ctx, positionals: [], flags: { ...ctx.flags, all: true } });
  return push(ctx2);
}

// ───────────────────────────────── queue (C6)

/** What's waiting to send, since when and why (C6). @param {Context} ctx */
export async function queue(ctx) {
  const { root } = ctx.requireRoot();
  const entries = readQueue(root).map((e, i) => ({ n: i + 1, id: e.id, paths: e.paths, task: e.flags?.task ?? null, queuedAt: e.queuedAt, reason: e.reason ?? "the server couldn't be reached", dropsAt: new Date(Date.parse(e.queuedAt) + QUEUE_TTL_MS).toISOString() }));
  const { c } = ctx.out;
  ctx.out.result("nb.queue/1", { entries }, (d) => (d.entries.length ? [
    `${d.entries.length} ${d.entries.length === 1 ? "push is" : "pushes are"} waiting to send`,
    ...d.entries.map((e) => `  ${e.n}. ${e.paths.length ? e.paths.map((p) => safe(p)).slice(0, 3).join(", ") + (e.paths.length > 3 ? ` and ${e.paths.length - 3} more` : "") : "every changed file"}${e.task ? ` · task ${safe(String(e.task))}` : ""}  ${c.muted(`queued ${e.queuedAt.slice(0, 16).replace("T", " ")}: ${e.reason}`)}`),
    c.muted("  nb queue retry sends them · nb queue drop <n> forgets one (your files stay as they are)"),
  ] : "Nothing waiting: every push has gone up"));
}

/** Send the queue now (C6). @param {Context} ctx */
export async function queueRetry(ctx) {
  const { root } = ctx.requireRoot();
  const before = readQueue(root).length;
  await replayQueue(ctx);
  ctx.out.result("nb.queue.retry/1", { sent: before }, (d) => (d.sent ? `${ctx.out.c.success(ctx.out.sym.done)} Sent ${d.sent} queued ${d.sent === 1 ? "push" : "pushes"}` : "Nothing waiting"));
}

/** Forget queued pushes; the files themselves don't change (C6). @param {Context} ctx */
export async function queueDrop(ctx) {
  const { root } = ctx.requireRoot();
  const entries = readQueue(root);
  if (!ctx.flags.all && !ctx.positionals.length) throw usage("Which ones?", "nb queue drop 1, or nb queue drop --all");
  const drop = ctx.flags.all ? entries : ctx.positionals.map((r) => {
    const hit = /^\d+$/.test(r) ? entries[Number(r) - 1] : entries.find((e) => e.id.startsWith(r));
    if (!hit) throw new CliError("NOT_FOUND", `Nothing queued as ${r}`, { hint: "nb queue" });
    return hit;
  });
  writeQueue(root, entries.filter((e) => !drop.includes(e)));
  ctx.out.result("nb.queue.drop/1", { dropped: drop.length }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Dropped ${d.dropped} queued ${d.dropped === 1 ? "push" : "pushes"}; your files are unchanged (nb status shows them)`);
}

/**
 * Sends pushes queued while offline, oldest first. A conflict stops the queue there (later pushes may depend on
 * it); still offline keeps it; expired entries are dropped with a note (A12.4).
 * @param {Context} ctx
 */
async function replayQueue(ctx) {
  const { root } = ctx.requireRoot();
  const entries = readQueue(root);
  if (!entries.length) return;
  const fresh = entries.filter((e) => Date.now() - Date.parse(e.queuedAt) < QUEUE_TTL_MS);
  if (fresh.length < entries.length) ctx.out.warn(`Dropped ${entries.length - fresh.length} queued push(es) older than 7 days; your files are unchanged, push them again`);
  writeQueue(root, fresh);
  for (const entry of fresh) {
    ctx.out.note(ctx.out.c.muted(`Sending a push queued ${entry.queuedAt.slice(0, 16).replace("T", " ")}`));
    const ctx2 = /** @type {Context} */ ({ ...ctx, cwd: root, positionals: entry.paths, flags: { ...ctx.flags, ...entry.flags, done: false, wip: false }, queueId: entry.id });
    try {
      await push(ctx2);
    } catch (error) {
      if (error instanceof CliError && error.code === "OFFLINE") throw new CliError("OFFLINE", `Still offline: ${fresh.length} push(es) wait in the queue`, { hint: "Run nb sync when you're online" });
      writeQueue(root, readQueue(root).filter((e) => e.id !== entry.id));
      throw error;
    }
    writeQueue(root, readQueue(root).filter((e) => e.id !== entry.id));
  }
}
