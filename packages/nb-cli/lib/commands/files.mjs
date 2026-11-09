// init, unlink, status, pull, push, sync, diff, resolve, file list, file view (report §17.4, A1, A4.4).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DIR_NAME, findRoot, readUserConfig, writeProjectConfig } from "../config.mjs";
import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { unifiedDiff } from "../sync/diff.mjs";
import { scanLocal, toRelative, toRemote } from "../sync/local.mjs";
import { planSync, stateLabel } from "../sync/plan.mjs";
import { acquireLock, pruneBaseCopies, readBaseCopy, readState, saveBaseCopy, writeState } from "../sync/state.mjs";
import { conflictCopyPath, downloadTo, fetchManifest, safeJoin, uploadFiles } from "../sync/transfer.mjs";
import { ask, confirm } from "../tui/ask.mjs";
import { resolveTask } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */
/** @typedef {import("../sync/plan.mjs").PlanItem} PlanItem */

/** Paths given on the command line, as paths relative to the linked folder. @param {Context} ctx @param {string} root */
function relativeArgs(ctx, root) {
  return ctx.positionals.map((p) => {
    const rel = path.relative(root, path.resolve(ctx.cwd, p));
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw usage(`${p} is outside the linked folder ${root}`);
    return rel;
  });
}

/**
 * Server, base and local side by side. Offline: the server side is the base, and status says so (A12.4).
 * @param {Context} ctx @param {{ only?: string[] }} [options]
 */
async function buildPlan(ctx, options = {}) {
  const { root, project } = ctx.requireRoot();
  const state = readState(root, project.workspaceId);
  let offline = false;
  /** @type {Awaited<ReturnType<typeof fetchManifest>>} */
  let manifest;
  try {
    manifest = await fetchManifest(ctx.api, project.workspaceId);
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== "OFFLINE") throw error;
    offline = true;
    manifest = { files: new Map(Object.entries(state.files).map(([p, b]) => [p, { path: p, nodeId: b.nodeId, version: b.baseVersion, hash: b.baseHash, size: b.size }])), canWrite: true, largestFileBytes: 0 };
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
const localPathOf = (root, remoteRoot, remotePath) => safeJoin(root, /** @type {string} */ (toRelative(remoteRoot, remotePath)));

/** Moves a local file into .networkbase/trash (kept 30 days) instead of deleting it (A1.6). @param {string} root @param {string} abs */
function moveToLocalTrash(root, abs) {
  const dest = path.join(root, DIR_NAME, "trash", new Date().toISOString().replace(/[:.]/g, "-"), path.relative(root, abs));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
  return dest;
}

/** Records a synced file as the new base. @param {import("../sync/state.mjs").SyncState} state @param {string} p @param {{ nodeId: string, version: number, hash: string, abs: string }} f */
function recordBase(state, p, f) {
  const st = fs.statSync(f.abs);
  state.files[p] = { nodeId: f.nodeId, baseVersion: f.version, baseHash: f.hash, size: st.size, mtimeMs: st.mtimeMs };
  delete state.conflicts[p];
}

// ───────────────────────────────── init / unlink

/** @param {Context} ctx */
export async function init(ctx) {
  const target = ctx.positionals[0] ?? ctx.flags.workspace;
  const here = path.resolve(ctx.cwd);
  if (here === path.resolve(os.homedir()) || here === path.parse(here).root) {
    throw usage("Link a project folder, not your home folder or the disk root", "mkdir my-project && cd my-project && nb init <workspace>");
  }
  const outer = findRoot(path.dirname(here));
  if (outer && !ctx.flags.nested && !fs.existsSync(path.join(here, DIR_NAME, "config.json"))) {
    throw usage(`This folder is inside ${outer}, which is already linked`, "Work from there, or pass --nested to link this folder separately");
  }
  const { workspaces } = /** @type {any} */ (await ctx.api.get("/api/v1/extension/workspaces"));
  let chosen = target ? workspaces.find((/** @type {any} */ w) => w.id === target || String(w.slug).toLowerCase() === String(target).toLowerCase()) : null;
  if (target && !chosen) {
    throw new CliError("WORKSPACE_NOT_FOUND", `No workspace ${target} in your list`, { hint: workspaces.length ? `Yours: ${workspaces.slice(0, 8).map((/** @type {any} */ w) => w.slug).join(", ")}` : "Create one at networkbase.in first", details: { workspaces: workspaces.map((/** @type {any} */ w) => ({ slug: w.slug, title: w.title })) } });
  }
  if (!chosen) {
    if (!workspaces.length) throw new CliError("WORKSPACE_NOT_FOUND", "You have no workspaces yet", { hint: "Create one at networkbase.in first" });
    const slug = await ask(ctx, { key: "workspace", header: "Workspace", question: "Which workspace should this folder link to?", options: workspaces.slice(0, 9).map((/** @type {any} */ w, /** @type {number} */ i) => ({ value: w.slug, label: safe(w.title), description: w.slug, recommended: i === 0 })) });
    chosen = workspaces.find((/** @type {any} */ w) => w.slug === slug);
  }
  const remoteRoot = ctx.flags.path ? `/${String(ctx.flags.path).replace(/^\/+|\/+$/g, "")}` : "/";
  writeProjectConfig(here, { workspaceId: chosen.id, slug: chosen.slug, title: chosen.title, remoteRoot: remoteRoot === "/" ? "/" : remoteRoot, startedTask: null, linkedAt: new Date().toISOString() });
  const notes = migrateLegacy(here);
  ctx.out.done(`Linked this folder to ${safe(chosen.title)} (${safe(chosen.slug)})${remoteRoot !== "/" ? ` · only ${remoteRoot}` : ""}`);
  for (const note of notes) ctx.out.warn(note);
  if (ctx.flags.task) {
    const { start } = await import("./tasks.mjs");
    const ctx2 = /** @type {Context} */ ({ ...ctx, root: here, project: { workspaceId: chosen.id, slug: chosen.slug, title: chosen.title, remoteRoot, startedTask: null }, positionals: [String(ctx.flags.task)] });
    await start(ctx2);
  }
  ctx.out.result("nb.init/1", { workspace: { id: chosen.id, slug: chosen.slug, title: chosen.title }, root: here, remoteRoot, notes }, () =>
    ctx.out.c.muted(`Next: nb pull to get the files, or edit and nb push <files>${ctx.flags.task ? "" : " (nb task start <n> to work on a task)"}`));
}

/**
 * 1.x left a mirror folder and maybe a background process (A1.20). The mirror moves aside (never deleted);
 * the old auto-push process is stopped.
 * @param {string} root
 */
function migrateLegacy(root) {
  const notes = [];
  const dir = path.join(root, DIR_NAME);
  const pidFile = path.join(dir, "daemon.pid");
  if (fs.existsSync(pidFile)) {
    try {
      const { pid } = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      const command = process.platform === "win32" ? "" : execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
      if (command.includes("--daemon-worker")) { process.kill(pid, "SIGTERM"); notes.push("Stopped the 1.x background auto-push process; nb watch replaces it (in the foreground)."); }
    } catch {
      // Already gone.
    }
    fs.rmSync(pidFile, { force: true });
  }
  const mirror = path.join(dir, "mirror");
  if (fs.existsSync(mirror)) {
    fs.renameSync(mirror, path.join(dir, "legacy-mirror"));
    notes.push(`1.x kept a copy of the workspace in ${DIR_NAME}/mirror; it moved to ${DIR_NAME}/legacy-mirror. Edits made only there aren't pushed: copy them into this folder, then nb push.`);
  }
  for (const old of ["cache.json", "last-sync.json"]) fs.rmSync(path.join(dir, old), { force: true });
  return notes;
}

/** @param {Context} ctx */
export async function unlink(ctx) {
  const { root } = ctx.requireRoot();
  const ok = await confirm(ctx, { key: "unlink", question: `Unlink ${root}? Your files stay; NetworkBase's sync records here are removed.`, yesLabel: "Unlink", defaultYes: false });
  if (!ok) return EXIT.cancelled;
  fs.rmSync(path.join(root, DIR_NAME), { recursive: true, force: true });
  if (ctx.flags["purge-local"]) fs.rmSync(path.join(root, ".tasks"), { recursive: true, force: true });
  ctx.out.result("nb.unlink/1", { root, purgedTasks: Boolean(ctx.flags["purge-local"]) }, () => `${ctx.out.c.success(ctx.out.sym.done)} Unlinked ${root}`);
}

// ───────────────────────────────── status

/** @param {Context} ctx */
export async function status(ctx) {
  const { root, project, items, skipped, offline, manifest } = await buildPlan(ctx);
  const changed = items.filter((i) => i.state !== "unchanged");
  const conflicts = changed.filter((i) => i.state === "conflict");
  const data = {
    workspace: { id: project.workspaceId, slug: project.slug, title: project.title },
    startedTask: project.startedTask ?? null,
    offline,
    readOnly: !manifest.canWrite,
    files: changed.map((i) => ({ path: i.path, state: i.state, action: i.action, ...(i.note ? { note: i.note } : {}), ...(i.remote ? { remoteVersion: i.remote.version } : {}) })),
    skipped,
  };
  const { c, sym } = ctx.out;
  ctx.out.result("nb.status/1", data, (d) => {
    const task = d.startedTask ? ` · #${d.startedTask.number ?? ""} ${safe(d.startedTask.title ?? "")}` : "";
    const head = `${c.brand(sym.brand)} ${safe(project.slug ?? project.workspaceId)}${task}${d.readOnly ? ` · ${c.warning("read only")}` : ""}${d.offline ? ` · ${c.warning("offline: server side not checked")}` : ""}`;
    if (!d.files.length) return [head, `  ${c.muted(`Up to date · ${root}`)}`, ...skippedLines(d.skipped)];
    const color = (/** @type {string} */ s) => (s === "conflict" ? c.danger : s === "modified" || s === "added" ? c.accent : s.startsWith("remote") ? c.info : c.muted);
    const counts = Object.entries(d.files.reduce((/** @type {Record<string, number>} */ acc, f) => ({ ...acc, [f.state]: (acc[f.state] ?? 0) + 1 }), {})).map(([s, n]) => `${n} ${s}`).join(" · ");
    const rows = ctx.out.table([
      { title: "State", value: (f) => color(f.state)(stateLabel(/** @type {any} */ (f))) },
      { title: "Path", value: (f) => safe(f.path), flex: true, path: true },
      { title: "", value: (f) => (f.note ? c.muted(f.note) : "") },
    ], d.files);
    const next = conflicts.length ? `nb resolve ${safe(conflicts[0]?.path.slice(1) ?? "")} --mine|--theirs|--both` : changed.some((f) => f.action === "push") ? "nb push <files>" : "nb pull";
    return [head, `  ${counts}`, "", ...rows, ...skippedLines(d.skipped), "", `  ${c.muted(next)}`];
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
    const todo = plan.items.filter((i) => ["pull", "restore", "adopt", "remove-local", "conflict"].includes(i.action));
    if (ctx.flags["dry-run"]) {
      return ctx.out.result("nb.pull.plan/1", { files: todo.map((i) => ({ path: i.path, action: i.action })) }, (d) => (d.files.length ? d.files.map((f) => `  would ${f.action.replace("-", " ")}  ${safe(f.path)}`) : "Nothing to pull"));
    }
    /** @type {Array<{ path: string, did: string, version?: number, by?: string, copy?: string }>} */
    const results = [];
    for (const item of todo) {
      const r = /** @type {import("../sync/plan.mjs").RemoteFile} */ (item.remote);
      const abs = localPathOf(root, project.remoteRoot, item.path);
      if (item.action === "adopt") {
        recordBase(state, item.path, { nodeId: r.nodeId, version: r.version, hash: r.hash ?? "", abs });
        continue;
      }
      if (item.action === "remove-local") {
        const kept = moveToLocalTrash(root, abs);
        delete state.files[item.path];
        results.push({ path: item.path, did: "removed (deleted on the server)", copy: path.relative(root, kept) });
        continue;
      }
      if (item.action === "conflict") {
        // Never overwrite: the server's version lands next to yours (A1.7, D18).
        const copy = conflictCopyPath(abs, r.version);
        await downloadTo(ctx.api, project.workspaceId, item.path, copy, r.hash);
        state.conflicts[item.path] = { remoteVersion: r.version, copy: path.relative(root, copy) };
        results.push({ path: item.path, did: "conflict", version: r.version, copy: path.relative(root, copy) });
        continue;
      }
      const got = await downloadTo(ctx.api, project.workspaceId, item.path, abs, r.hash);
      if (got.content) saveBaseCopy(root, got.hash, got.content);
      recordBase(state, item.path, { nodeId: r.nodeId, version: r.version, hash: got.hash, abs });
      results.push({ path: item.path, did: item.action === "restore" ? "restored" : item.base ? "updated" : "new", version: r.version });
      writeState(root, state);
    }
    writeState(root, state);
    pruneBaseCopies(root, state, Number(readUserConfig(ctx.env)["base-cache-mb"] ?? 200) * 1024 * 1024);
    const conflicts = results.filter((r) => r.did === "conflict");
    if (!options.quietResult) {
      ctx.out.result("nb.pull/1", { files: results }, (d) => {
        if (!d.files.length) return "Up to date";
        const { c, sym } = ctx.out;
        return [
          `${c.success(sym.done)} Pulled ${d.files.length - conflicts.length} ${d.files.length - conflicts.length === 1 ? "file" : "files"}${conflicts.length ? ` · ${c.danger(`${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""}`)}` : ""}`,
          ...d.files.map((f) => `  ${f.did === "conflict" ? c.danger("conflict") : f.did.padEnd(8)}  ${safe(f.path)}${f.version ? c.muted(` v${f.version}`) : ""}${f.copy ? c.muted(` → ${safe(f.copy)}`) : ""}`),
          ...(conflicts.length ? [c.muted(`  Server's version saved next to yours. Settle with nb resolve <path> --mine|--theirs|--both`)] : []),
        ];
      });
    }
    return conflicts.length ? EXIT.conflict : EXIT.ok;
  } finally {
    release();
  }
}

// ───────────────────────────────── push

/** @param {Context} ctx */
export async function push(ctx) {
  const { root } = ctx.requireRoot();
  const only = relativeArgs(ctx, root);
  if (!only.length && !ctx.flags.all && !ctx.out.interactive) {
    // Never upload a whole folder without being told which files (finding 21).
    throw usage("Say which files to push", "nb push <paths…>, or nb push --all for every changed tracked file");
  }
  const as = ctx.flags.as ?? readUserConfig(ctx.env)["default-as"] ?? null;
  if (as && !["reference", "draft", "final"].includes(as)) throw usage(`--as must be reference, draft or final (not ${as})`);
  const release = ctx.flags["dry-run"] ? () => {} : await acquireLock(root, "nb push");
  try {
    const plan = await buildPlan(ctx, { only });
    if (plan.offline) throw new CliError("OFFLINE", "Can't reach the server to push", { hint: "Your files are unchanged; push again when you're online" });
    const { project, state } = plan;
    if (!plan.manifest.canWrite) throw new CliError("READ_ONLY", "You can read this workspace but not change it", { hint: "Ask an owner for member access" });
    // With no paths, only files NetworkBase already tracks; new files are pushed by naming them (A1.6, §17.4).
    let items = plan.items.filter((i) => i.action === "push" && (only.length || i.base));
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
      return ctx.out.result("nb.push.plan/1", { files: items.map((i) => ({ path: i.path, state: i.state })), deletions: deletions.map((i) => i.path) }, (d) => (d.files.length || d.deletions.length ? [...d.files.map((f) => `  would push    ${safe(f.path)}`), ...d.deletions.map((p) => `  would delete  ${safe(p)}`)] : "Nothing to push"));
    }
    const task = ctx.flags.task ? await resolveTask(ctx, String(ctx.flags.task)) : null;
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
        }, (done, total) => { if (total > 1) ctx.out.note(ctx.out.c.muted(`Uploading ${done} of ${total}`)); }).catch((error) => handlePushError(ctx, root, state, error))
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
    const data = { files: uploaded.files.map((/** @type {any} */ f) => ({ path: f.path, status: f.status, version: f.version, versionTransition: f.versionTransition })), task: task ? { id: task.id, number: task.taskNumber, title: task.title } : null, as, transition: uploaded.transition, deleted, behind: behind.map((b) => b.path) };
    ctx.out.result("nb.push/1", data, (d) => {
      const { c, sym } = ctx.out;
      if (!changedFiles.length && !d.deleted) return `Nothing changed${d.behind.length ? c.muted(` · ${d.behind.length} newer on the server: nb pull`) : ""}`;
      const where = d.task ? ` to #${d.task.number ?? ""} ${safe(d.task.title ?? "")}${d.as ? ` as ${d.as}` : ""}` : d.as ? ` as ${d.as}` : "";
      const lines = [`${c.success(sym.done)} Pushed ${changedFiles.length} ${changedFiles.length === 1 ? "file" : "files"}${where}${d.deleted ? ` · ${d.deleted} moved to Trash` : ""}`];
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

// ───────────────────────────────── diff

/** @param {Context} ctx */
export async function diff(ctx) {
  const { root } = ctx.requireRoot();
  const plan = await buildPlan(ctx, { only: relativeArgs(ctx, root) });
  const changed = plan.items.filter((i) => i.local && (i.state === "modified" || i.state === "conflict" || i.state === "added"));
  /** @type {Array<{ path: string, state: string, diff: ReturnType<typeof unifiedDiff> | null, binary: boolean }>} */
  const files = [];
  for (const item of changed) {
    const mine = fs.readFileSync(/** @type {any} */ (item.local).abs);
    const base = item.base ? readBaseCopy(root, item.base.baseHash) : Buffer.alloc(0);
    const binary = mine.includes(0) || (base?.includes(0) ?? false);
    files.push({ path: item.path, state: item.state, binary, diff: base && !binary ? unifiedDiff(base.toString("utf8"), mine.toString("utf8")) : null });
  }
  const { c } = ctx.out;
  ctx.out.result("nb.diff/1", { files }, (d) => {
    if (!d.files.length) return "No changes";
    const lines = [];
    for (const f of d.files) {
      lines.push(c.bold(`${f.state === "added" ? "new" : f.state}: ${safe(f.path)}`));
      if (f.binary) { lines.push(c.muted("  binary file changed")); continue; }
      if (!f.diff) { lines.push(c.muted("  no saved copy of the last-pulled version to compare (it was large, or pulled before 2.0)")); continue; }
      for (const l of f.diff.lines) lines.push(l.kind === "@" ? c.muted(l.text) : l.kind === "+" ? c.success(`+${safe(l.text)}`) : l.kind === "-" ? c.danger(`-${safe(l.text)}`) : ` ${safe(l.text)}`);
    }
    return lines;
  });
}

// ───────────────────────────────── resolve

/** @param {Context} ctx */
export async function resolve(ctx) {
  const { root } = ctx.requireRoot();
  const rel = relativeArgs(ctx, root)[0];
  if (!rel) throw usage("nb resolve <path> --mine|--theirs|--both");
  const plan = await buildPlan(ctx, { only: [rel] });
  const item = plan.items.find((i) => i.state === "conflict");
  if (!item || !item.remote || !item.local) throw usage(`${rel} has no conflict to settle`, "See nb status");
  let choice = ctx.flags.mine ? "mine" : ctx.flags.theirs ? "theirs" : ctx.flags.both ? "both" : null;
  choice ??= await ask(ctx, {
    key: "resolve", header: "Conflict", question: `${item.path} changed here and on the server (v${item.remote.version}). Keep which?`,
    options: [
      { value: "both", label: "Keep both", description: "yours stays; the server's becomes a separate file", recommended: true },
      { value: "mine", label: "Mine", description: "replace the server's version with yours" },
      { value: "theirs", label: "Theirs", description: "take the server's version (yours goes to .networkbase/trash)" },
    ],
  });
  const { project, state } = plan;
  const leftover = state.conflicts[item.path]?.copy;
  const release = await acquireLock(root, "nb resolve");
  try {
    if (choice === "theirs") {
      moveToLocalTrash(root, item.local.abs);
      const got = await downloadTo(ctx.api, project.workspaceId, item.path, item.local.abs, item.remote.hash);
      recordBase(state, item.path, { nodeId: item.remote.nodeId, version: item.remote.version, hash: got.hash, abs: item.local.abs });
    } else if (choice === "mine") {
      const res = await uploadFiles(ctx.api, { workspaceId: project.workspaceId, items: [{ path: item.path, abs: item.local.abs, size: item.local.size, hash: item.local.hash, baseVersion: item.remote.version }], message: ctx.flags.message ?? null });
      const f = res.files[0];
      recordBase(state, item.path, { nodeId: f.nodeId, version: f.version, hash: item.local.hash, abs: item.local.abs });
    } else {
      // Keep both: yours goes up as name (2).ext; the server's version takes the original name here.
      const res = await uploadFiles(ctx.api, { workspaceId: project.workspaceId, items: [{ path: item.path, abs: item.local.abs, size: item.local.size, hash: item.local.hash }], keepBoth: true, message: ctx.flags.message ?? null });
      const copy = res.files[0];
      const copyAbs = localPathOf(root, project.remoteRoot, copy.path);
      fs.renameSync(item.local.abs, copyAbs);
      recordBase(state, copy.path, { nodeId: copy.nodeId, version: copy.version, hash: item.local.hash, abs: copyAbs });
      const got = await downloadTo(ctx.api, project.workspaceId, item.path, item.local.abs, item.remote.hash);
      recordBase(state, item.path, { nodeId: item.remote.nodeId, version: item.remote.version, hash: got.hash, abs: item.local.abs });
    }
    if (leftover && fs.existsSync(path.join(root, leftover))) fs.rmSync(path.join(root, leftover));
    delete state.conflicts[item.path];
    writeState(root, state);
  } finally {
    release();
  }
  ctx.out.result("nb.resolve/1", { path: item.path, choice }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Settled ${safe(d.path)}: ${d.choice === "both" ? "kept both" : d.choice === "mine" ? "kept yours" : "took the server's"}`);
}

// ───────────────────────────────── file list / view

/** @param {Context} ctx */
export async function fileList(ctx) {
  const workspaceId = ctx.requireWorkspace();
  if (ctx.flags.task) {
    const task = await resolveTask(ctx, String(ctx.flags.task));
    const files = /** @type {any[]} */ (task.files ?? []).map((f) => ({ path: f.path ?? f.name, as: f.role === "deliverable" ? "final" : f.role === "working" ? "draft" : f.role ?? "draft", version: f.currentVersion ?? null, size: f.size ?? null }));
    return ctx.out.result("nb.file.list/1", { task: { id: task.id, number: task.taskNumber }, files }, (d) => (d.files.length ? ctx.out.table([{ title: "Path", value: (f) => safe(f.path), flex: true, path: true }, { title: "Role", value: (f) => f.as }, { title: "Version", value: (f) => (f.version ? `v${f.version}` : ""), align: "right" }], d.files) : "No files on this task"));
  }
  const { files } = await fetchManifest(ctx.api, workspaceId);
  const folder = ctx.positionals[0] ? `/${ctx.positionals[0].replace(/^\/+|\/+$/g, "")}/` : "/";
  const list = [...files.values()].filter((f) => f.path.startsWith(folder)).sort((a, b) => a.path.localeCompare(b.path));
  ctx.out.result("nb.file.list/1", { files: list.map((f) => ({ path: f.path, version: f.version, size: f.size })) }, (d) =>
    d.files.length ? ctx.out.table([{ title: "Path", value: (f) => safe(f.path), flex: true, path: true }, { title: "Version", value: (f) => `v${f.version}`, align: "right" }, { title: "Size", value: (f) => formatBytes(f.size), align: "right" }], d.files) : "No files");
}

/** @param {number} bytes */
export const formatBytes = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Prints a file; raw bytes when piped, control characters made visible on a terminal (A3.11). @param {Context} ctx */
export async function fileView(ctx) {
  const workspaceId = ctx.requireWorkspace();
  const p = ctx.positionals[0];
  if (!p) throw usage("nb file view <path>");
  const remotePath = p.startsWith("/") ? p : `/${p}`;
  const response = await ctx.api.download("/api/v1/extension/file", { projectId: workspaceId, path: remotePath, transfer: "raw" }).catch(async () => null);
  /** @type {Buffer} */
  let bytes;
  if (response) bytes = Buffer.from(await response.arrayBuffer());
  else {
    const inline = /** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId: workspaceId, path: remotePath, transfer: "inline" } }));
    bytes = Buffer.from(inline.content ?? "", inline.encoding === "base64" ? "base64" : "utf8");
  }
  if (ctx.out.json) return ctx.out.result("nb.file.view/1", { path: remotePath, size: bytes.length, contentBase64: bytes.toString("base64") }, () => null);
  if (process.stdout.isTTY) {
     
    ctx.out.raw(bytes.toString("utf8").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (ch) => `^${String.fromCharCode(ch.charCodeAt(0) + 64)}`));
  } else ctx.out.raw(bytes);
}
