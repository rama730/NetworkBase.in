// nb branch (report H6): the folder is always on one NetworkBase branch, and you always know which. It follows the git
// branch by itself (.git/HEAD, no git process); nb branch switch changes it like git checkout, keeping your edits.
import fs from "node:fs";
import path from "node:path";

import { readProjectConfig, writeProjectConfig } from "../config.mjs";
import { CliError, EXIT, needsNetwork } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { STATE_VERSION, writeState } from "../sync/state.mjs";
import { downloadTo, fetchManifest } from "../sync/transfer.mjs";
import { toRelative, toRemote } from "../sync/local.mjs";
import { ask, confirm } from "../tui/ask.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const enc = encodeURIComponent;
/** git names for the default branch: they follow NetworkBase's main. */
export const MAIN_NAMES = new Set(["main", "master", "trunk", "default"]);

/**
 * git's current branch, read from .git/HEAD (worktrees too). Null when the folder isn't in a git repository.
 * @param {string} dir @returns {{ branch: string | null, detached: boolean } | null}
 */
export function readGitHead(dir) {
  for (let d = dir; d; d = path.dirname(d) === d ? null : path.dirname(d)) {
    const dotGit = path.join(d, ".git");
    if (!fs.existsSync(dotGit)) continue;
    try {
      const gitDir = fs.statSync(dotGit).isFile() ? path.resolve(d, fs.readFileSync(dotGit, "utf8").replace(/^gitdir:\s*/, "").trim()) : dotGit;
      const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
      const ref = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
      return ref ? { branch: ref, detached: false } : { branch: null, detached: true };
    } catch {
      return null;
    }
  }
  return null;
}

/** @param {Context} ctx */
async function branchesOf(ctx) {
  const ws = ctx.requireWorkspace();
  return /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ws)}/branches`)).branches;
}

/** A branch by name (any letter case) or id, "main" for main. @param {Context} ctx @param {string} name */
async function findBranch(ctx, name) {
  const list = await branchesOf(ctx);
  const want = String(name).toLowerCase();
  const found = list.find((/** @type {any} */ b) => b.id === name || b.name.toLowerCase() === want || (want === "main" && b.isDefault));
  if (found) return found;
  // A merged branch isn't in the active list, but can still be deleted or looked at by name (M9 walkthrough).
  const merged = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/branches`, { query: { status: "merged" } })).branches
    .find((/** @type {any} */ b) => b.id === name || b.name.toLowerCase() === want);
  if (merged) return merged;
  throw new CliError("BRANCH_NOT_FOUND", `No branch ${name} here`, { hint: `nb branch create ${name}, or nb branch list` });
}

/** Remembers which git branch was followed, so nothing happens again until git's changes. @param {string} root @param {string | null} gitBranch */
function rememberGit(root, gitBranch) {
  const config = readProjectConfig(root);
  if (config && config.gitBranch !== gitBranch) writeProjectConfig(root, { ...config, gitBranch });
}

/**
 * Follows git (report H6): when git's branch changed since the last command, the folder switches to the NetworkBase
 * branch of the same name (main for main and master). A git branch NetworkBase doesn't have asks once; --json and
 * agents get NEEDS_INPUT, never a guess; a read-only command (nb status) just says so. Workspaces without branches are
 * left alone.
 * @param {Context} ctx @param {{ readOnly?: boolean }} [opts]
 */
export async function followGit(ctx, { readOnly = false } = {}) {
  const { root, project } = ctx.requireRoot();
  const head = readGitHead(root);
  if (!head?.branch || head.branch === project.gitBranch) return;
  const want = head.branch;
  const target = MAIN_NAMES.has(want.toLowerCase()) ? "main" : want;
  const current = project.branch?.name ?? "main";
  if (target.toLowerCase() === current.toLowerCase()) return rememberGit(root, want);
  /** @type {any[]} */
  let list;
  try {
    list = await branchesOf(ctx);
  } catch (error) {
    // No branches here (History off): nothing to follow.
    if (error instanceof CliError && ["BRANCHES_OFF", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) return rememberGit(root, want);
    throw error;
  }
  let found = list.find((b) => (target === "main" ? b.isDefault : b.name.toLowerCase() === target.toLowerCase()));
  if (!found && readOnly) {
    // nb status only reads (E1 walk: it stopped with "needs input"): say so, and let the next push ask.
    ctx.out.note(ctx.out.c.muted(`git is on ${want}, which NetworkBase doesn't have yet; nb push asks to create it`));
    return;
  }
  if (!found) {
    const choice = await ask(ctx, {
      key: "branch",
      header: "Branch",
      question: `git is on ${want}, which NetworkBase doesn't have. Create NetworkBase branch ${want} from main?`,
      options: [{ value: "create", label: `Create ${want}`, recommended: true }, { value: "stay", label: `Stay on ${current}` }],
    });
    if (choice !== "create") return rememberGit(root, want);
    found = (/** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${enc(project.workspaceId)}/branches`, { name: want }))).branch;
  }
  ctx.out.note(ctx.out.c.muted(`git is on ${want}: switching this folder to ${found.isDefault ? "main" : found.name}`));
  await switchTo(ctx, found, { carry: true });
  rememberGit(root, want);
}

/**
 * Switches the folder (report H6): files that differ are replaced with the branch's; your unsaved edits are kept and
 * carried over, unless the file is different on the other branch (then it stops, unless `carry`).
 * @param {Context} ctx @param {any} target @param {{ carry?: boolean }} [opts]
 */
export async function switchTo(ctx, target, opts = {}) {
  const { root, project } = ctx.requireRoot();
  const { buildPlan, localPathOf, moveToLocalTrash, recordBase } = await import("./files.mjs");
  const plan = await buildPlan(ctx, { noFollow: true, leaving: true });
  if (plan.offline) return switchOffline(ctx, plan, target, opts);
  const dirty = plan.items.filter((i) => ["push", "conflict", "delete-remote", "move", "keep-local"].includes(i.action));
  const branchId = target.isDefault ? null : target.id;
  const manifest = await fetchManifest(ctx.api, project.workspaceId, branchId);
  // Only the part this folder is linked to, and only its nb sync --only folders (E1 walk: a docs/-only folder fetched 144 files).
  const onlyPrefixes = (project.only ?? []).map((rel) => toRemote(project.remoteRoot, rel)).map((pre) => (pre.endsWith("/") ? pre : `${pre}/`));
  const remote = new Map([...manifest.files].filter(([p]) => toRelative(project.remoteRoot, p) !== null && (!onlyPrefixes.length || onlyPrefixes.some((pre) => `${p}/`.startsWith(pre)))));
  // An edit to a file that is different on the other branch would mix the two: stop and say so.
  const blocking = dirty.filter((i) => (remote.get(i.path)?.hash ?? null) !== (i.base?.baseHash ?? i.remote?.hash ?? null));
  if (blocking.length && !opts.carry) {
    throw new CliError("LOCAL_CHANGES", `${blocking.length === 1 ? safe(blocking[0]?.path) : `${blocking.length} files`} changed here ${blocking.length === 1 ? "is" : "are"} different on ${target.isDefault ? "main" : target.name}`, {
      hint: `Push or discard ${blocking.length === 1 ? "it" : "them"} first, or nb branch switch ${target.isDefault ? "main" : target.name} --carry to bring your edits along`,
      details: { files: blocking.map((i) => i.path) },
    });
  }
  // Before files change, keep a copy of each unchanged text file of this branch, so switching back offline works.
  const { readBaseCopy, saveBaseCopy } = await import("../sync/state.mjs");
  for (const i of plan.items) {
    if (!i.local || !i.base || i.local.hash !== i.base.baseHash || (i.local.size ?? 0) > 1024 * 1024 || readBaseCopy(root, i.base.baseHash)) continue;
    try { saveBaseCopy(root, i.base.baseHash, fs.readFileSync(i.local.abs)); } catch { /* unreadable: switching back will need the network */ }
  }
  const prior = readProjectConfig(root);
  // The branches this folder has been on, by id, so a switch back works offline (H23 journey 9).
  const known = { ...(prior?.knownBranches ?? {}), ...(project.branch ? { [project.branch.id]: project.branch.name } : {}), ...(branchId ? { [target.id]: target.name } : {}) };
  const next = { ...prior, ...project, branch: branchId ? { id: target.id, name: target.name } : null, knownBranches: known };
  writeProjectConfig(root, next);
  project.branch = next.branch;
  /** @type {import("../sync/state.mjs").SyncState} */
  const state = { schemaVersion: STATE_VERSION, workspaceId: project.workspaceId, files: {}, conflicts: {} };
  const keep = new Set(dirty.flatMap((i) => [i.path, ...(i.from ? [i.from] : [])]));
  const conflicted = new Set(dirty.filter((i) => i.action === "conflict").map((i) => i.path));
  const localHash = new Map(plan.items.flatMap((i) => (i.local ? [[i.path, i.local.hash]] : [])));
  let downloaded = 0;
  let removed = 0;
  // A file this folder never pulled from the old branch stays on the server (nb pull gets it); only what the folder
  // keeps, and what's new on the other branch, comes down (M9 walkthrough: a one-file folder fetched 143 files).
  const tracked = new Set(plan.items.flatMap((i) => (i.local || i.base ? [i.path] : [])));
  const before = plan.manifest.files;
  for (const [p, f] of remote) {
    const abs = localPathOf(root, project.remoteRoot, p);
    // Leaving a merged or deleted branch, its full list is unknown: anything untracked stays for nb pull.
    if (!tracked.has(p) && (plan.leftGone || before.has(p))) continue;
    if (localHash.get(p) === f.hash) { recordBase(state, p, { nodeId: f.nodeId, version: f.version, hash: /** @type {string} */ (f.hash), abs }); continue; }
    if (keep.has(p)) {
      // A conflict (both sides differ, no common base) stays one: recording a base would make it a plain edit that
      // nb push sends over the server's copy (E2 GitHub walk).
      if (!fs.existsSync(abs) || conflicted.has(p)) continue;
      recordBase(state, p, { nodeId: f.nodeId, version: f.version, hash: /** @type {string} */ (f.hash), abs });
      // The base is the other branch's file, not this edit: hash it again next time, never trust its size and time.
      state.files[p] = { ...state.files[p], mtimeMs: 0, size: -1 };
      continue;
    }
    await downloadTo(ctx.api, project.workspaceId, p, abs, f.hash, branchId);
    recordBase(state, p, { nodeId: f.nodeId, version: f.version, hash: /** @type {string} */ (f.hash), abs });
    downloaded++;
  }
  // Files the other branch doesn't have go to .networkbase/trash (kept 30 days), never deleted, and never your edits.
  for (const i of plan.items) {
    if (!i.base || remote.has(i.path) || keep.has(i.path) || !i.local || i.local.hash !== i.base.baseHash) continue;
    moveToLocalTrash(root, i.local.abs);
    removed++;
  }
  writeState(root, state);
  return { branch: target.isDefault ? "main" : target.name, downloaded, removed, carried: dirty.length };
}

/**
 * Offline (H23 journey 9): a switch to a branch this folder had before works from what it kept: that branch's base list
 * and the text copies of its files. Anything it can't rebuild here (a file it never kept a copy of) needs the network.
 * @param {Context} ctx @param {any} plan @param {any} target @param {{ carry?: boolean }} opts
 */
async function switchOffline(ctx, plan, target, opts) {
  const { root, project } = ctx.requireRoot();
  const { localPathOf, moveToLocalTrash } = await import("./files.mjs");
  const { readBranchState, readBaseCopy } = await import("../sync/state.mjs");
  const branchId = target.isDefault ? null : target.id;
  const name = target.isDefault ? "main" : target.name;
  const saved = readBranchState(root, branchId);
  if (!saved || saved.workspaceId !== project.workspaceId) throw new CliError("OFFLINE", `Switching to ${name} needs the network: this folder hasn't had its files`, { hint: "Try again when you're online" });
  const dirty = plan.items.filter((/** @type {any} */ i) => ["push", "conflict", "delete-remote", "move", "keep-local"].includes(i.action));
  const keep = new Set(dirty.flatMap((/** @type {any} */ i) => [i.path, ...(i.from ? [i.from] : [])]));
  const localHash = new Map(plan.items.flatMap((/** @type {any} */ i) => (i.local ? [[i.path, i.local.hash]] : [])));
  const blocking = dirty.filter((/** @type {any} */ i) => (saved.files[i.path]?.baseHash ?? null) !== (i.base?.baseHash ?? null));
  if (blocking.length && !opts.carry) throw new CliError("LOCAL_CHANGES", `${blocking.length} file(s) changed here are different on ${name}`, { hint: `Push or discard them first, or nb branch switch ${name} --carry`, details: { files: blocking.map((/** @type {any} */ i) => i.path) } });
  /** @type {Array<{ abs: string, content: Buffer }>} */
  const writes = [];
  const missing = [];
  for (const [p, b] of Object.entries(saved.files)) {
    if (keep.has(p) || localHash.get(p) === b.baseHash) continue;
    const content = readBaseCopy(root, b.baseHash);
    if (!content) { missing.push(p); continue; }
    writes.push({ abs: localPathOf(root, project.remoteRoot, p), content });
  }
  if (missing.length) throw new CliError("OFFLINE", `Switching to ${name} needs the network: ${missing.length} of its files aren't kept here (only text files up to 1 MB are)`, { hint: "Try again when you're online", details: { files: missing.slice(0, 20) } });
  for (const w of writes) { fs.mkdirSync(path.dirname(w.abs), { recursive: true }); fs.writeFileSync(w.abs, w.content); }
  // Files the other branch doesn't have go to .networkbase/trash (kept 30 days), never your edits.
  let removed = 0;
  for (const i of plan.items) {
    if (!i.base || saved.files[i.path] || keep.has(i.path) || !i.local || i.local.hash !== i.base.baseHash) continue;
    moveToLocalTrash(root, i.local.abs);
    removed++;
  }
  const next = { ...readProjectConfig(root), ...project, branch: branchId ? { id: target.id, name: target.name } : null };
  writeProjectConfig(root, next);
  project.branch = next.branch;
  // The other branch's base stays as it was saved; its files are hashed again next time.
  for (const p of Object.keys(saved.files)) saved.files[p] = { ...saved.files[p], mtimeMs: 0, size: -1 };
  writeState(root, saved);
  return { branch: name, downloaded: writes.length, removed, carried: dirty.length, offline: true };
}

// ───────────────────────────────── commands

/** Commands that read "this folder's branch" follow git first, as the sync commands do. @param {Context} ctx */
async function followHere(ctx) {
  if (!ctx.root) return;
  await followGit(ctx).catch((error) => { if (!(error instanceof CliError) || error.code !== "OFFLINE") throw error; });
}

/** @param {Context} ctx */
export async function branchList(ctx) {
  await followHere(ctx);
  const list = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/branches`, { query: { ...(ctx.flags.mine ? { mine: "1" } : {}), ...(ctx.flags.stale ? { status: "stale" } : ctx.flags.deleted ? { status: "deleted" } : {}) } }));
  const here = ctx.project?.branch?.id ?? null;
  const { c } = ctx.out;
  ctx.out.result("nb.branch.list/1", { ...list, current: here ?? "main" }, (d) => d.branches.length
    ? ctx.out.table([
        { title: "", value: (b) => ((here ? b.id === here : b.isDefault) ? c.brand("*") : " ") },
        { title: "Branch", value: (b) => safe(b.name), flex: true },
        { title: "Ahead", value: (b) => (b.isDefault ? "" : String(b.ahead)), align: "right" },
        { title: "Behind", value: (b) => (b.isDefault ? "" : String(b.behind)), align: "right" },
        { title: "Last save", value: (b) => (b.lastSave ? `${safe(b.lastSave.message).slice(0, 40)} ${c.muted(b.lastSave.createdAt.slice(0, 10))}` : c.muted("none yet")), optional: true },
        { title: "", value: (b) => (b.stale ? c.muted("stale") : b.status !== "active" ? c.muted(b.status) : "") },
      ], d.branches)
    : "No branches");
  return EXIT.ok;
}

/** nb branch create <name> [--from b] [--task n]: makes it and moves this folder onto it (like git switch -c). @param {Context} ctx */
export async function branchCreate(ctx) {
  const name = ctx.positionals[0];
  if (!name) throw new CliError("USAGE", "Name the branch", { hint: "nb branch create ram/try-new-header" });
  let taskId = null;
  if (ctx.flags.task) taskId = (await (await import("./tasks.mjs")).resolveTask(ctx, String(ctx.flags.task), { brief: true })).id;
  const res = /** @type {any} */ (await needsNetwork("Making a branch", ctx.api.post(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/branches`, { name, ...(ctx.flags.from ? { from: String(ctx.flags.from) } : {}), ...(taskId ? { taskId } : {}) })));
  const switched = ctx.root && !ctx.flags["no-switch"] ? await switchTo(ctx, res.branch, { carry: true }) : null;
  ctx.out.result("nb.branch.create/1", { branch: res.branch, switched }, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Created ${safe(d.branch.name)}${d.switched ? " and moved this folder onto it" : ""}`,
    ctx.out.c.muted(d.switched ? "  Save on it as usual (nb push); nb branch update brings main's newer work in." : `  To work on it: nb branch switch ${safe(d.branch.name)}`),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function branchSwitch(ctx) {
  const name = ctx.positionals[0];
  if (!name) throw new CliError("USAGE", "Which branch?", { hint: "nb branch list shows them" });
  const target = await findBranch(ctx, name).catch((error) => {
    // Offline: a branch this folder has been on (or main) is found from what the folder remembers.
    if (!(error instanceof CliError) || error.code !== "OFFLINE") throw error;
    /** @type {any} */ (ctx).knownOffline = true;
    if (String(name).toLowerCase() === "main") return { id: null, name: "main", isDefault: true, status: "active" };
    const known = Object.entries(/** @type {Record<string, string>} */ (ctx.project?.knownBranches ?? {})).find(([, n]) => n.toLowerCase() === String(name).toLowerCase());
    if (!known) throw new CliError("OFFLINE", `Switching to ${name} needs the network: this folder hasn't been on it`, { hint: "Try again when you're online" });
    return { id: known[0], name: known[1], isDefault: false, status: "active" };
  });
  if (target.status !== "active") throw new CliError("BRANCH_DELETED", `${target.name} was ${target.status}`, { hint: "Restore it in the Files tab, or pick another branch" });
  const done = await switchTo(ctx, target, { carry: Boolean(ctx.flags.carry) });
  ctx.out.result("nb.branch.switch/1", done, (d) => `${ctx.out.c.success(ctx.out.sym.done)} On ${safe(d.branch)}${/** @type {any} */ (d).offline ? ` ${ctx.out.c.warning("(offline)")}` : ""} · ${d.downloaded} file(s) updated${d.removed ? `, ${d.removed} set aside in .networkbase/trash` : ""}${d.carried ? `, ${d.carried} edit(s) kept` : ""}`);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function branchRename(ctx) {
  const [from, to] = ctx.positionals;
  if (!from || !to) throw new CliError("USAGE", "nb branch rename <old> <new>");
  const branch = await findBranch(ctx, from);
  const res = /** @type {any} */ (await ctx.api.patch(`/api/v1/branches/${enc(branch.id)}`, { name: to }));
  // The folder stores the branch by id, so it stays on it; only the name it shows changes (H24).
  if (ctx.root && ctx.project?.branch?.id === branch.id) {
    writeProjectConfig(ctx.root, { ...readProjectConfig(ctx.root), ...ctx.project, branch: { id: branch.id, name: res.branch.name } });
  }
  ctx.out.result("nb.branch.rename/1", res, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Renamed to ${safe(d.branch.name)}`);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function branchDelete(ctx) {
  const name = ctx.positionals[0];
  if (!name) throw new CliError("USAGE", "nb branch delete <name>");
  await followHere(ctx);
  const branch = await findBranch(ctx, name);
  if (ctx.project?.branch?.id === branch.id) throw new CliError("CONFLICT", "This folder is on that branch", { hint: "nb branch switch main first" });
  const ok = await confirm(ctx, { key: "delete", question: `Delete ${branch.name}?${branch.ahead ? ` ${branch.ahead} save(s) aren't in main.` : ""} It can be restored for 30 days.`, yesLabel: "Delete", defaultYes: false });
  if (!ok) return EXIT.cancelled;
  const res = /** @type {any} */ (await ctx.api.delete(`/api/v1/branches/${enc(branch.id)}`));
  ctx.out.result("nb.branch.delete/1", { branch: { id: branch.id, name: branch.name }, ...res }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Deleted ${safe(d.branch.name)} · restorable until ${String(d.restoreUntil).slice(0, 10)}`);
  return EXIT.ok;
}

/**
 * nb branch update [name]: brings main's newer work in (report H13). Files both sides changed merge; a real conflict
 * stops with the list, settled with --keep-branch or --take-main.
 * @param {Context} ctx
 */
export async function branchUpdate(ctx) {
  const name = ctx.positionals[0];
  await followHere(ctx);
  const branch = name ? await findBranch(ctx, name) : ctx.project?.branch ? { id: ctx.project.branch.id, name: ctx.project.branch.name } : null;
  if (!branch) throw new CliError("USAGE", "This folder is on main; name a branch to update", { hint: "nb branch update feature-x" });
  const list = (/** @type {string} */ v) => String(v ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => `/${p.replace(/^\/+/, "")}`);
  const resolutions = Object.fromEntries([...list(ctx.flags["keep-branch"]).map((p) => [p, "branch"]), ...list(ctx.flags["take-main"]).map((p) => [p, "main"])]);
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/branches/${enc(branch.id)}/update`, { resolutions }));
  const { c } = ctx.out;
  ctx.out.result("nb.branch.update/1", res, (d) => d.upToDate
    ? `${safe(branch.name)} already has everything on main`
    : d.conflicts.length
      ? [`${c.warning(ctx.out.sym.warn)} ${d.conflicts.length} file(s) changed on both ${safe(branch.name)} and main:`, ...d.conflicts.map((/** @type {any} */ x) => `  ${safe(x.path)} ${c.muted(x.kind.replace(/_/g, " "))}`), c.muted(`  Choose: nb branch update ${safe(branch.name)} --keep-branch <paths> --take-main <paths>`)]
      : [`${c.success(ctx.out.sym.done)} Updated ${safe(branch.name)} from main`, ...(ctx.project?.branch?.id === branch.id ? [c.muted("  nb pull brings the merged files into this folder")] : [])]);
  return res.conflicts?.length ? EXIT.conflict : EXIT.ok;
}
