// status, pull, push, sync and the offline queue (report §17.4, A1, A4.4, A12.4).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DIR_NAME, readUserConfig } from "../config.mjs";
import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { scanLocal, toRelative, toRemote } from "../sync/local.mjs";
import { planSync, stateLabel } from "../sync/plan.mjs";
import { enqueue, QUEUE_TTL_MS, readQueue, writeQueue } from "../sync/queue.mjs";
import { acquireLock, pruneBaseCopies, readState, saveBaseCopy, writeState } from "../sync/state.mjs";
import { conflictCopyPath, downloadTo, fetchManifest, safeJoin, uploadFiles } from "../sync/transfer.mjs";
import { confirm } from "../tui/ask.mjs";
import { resolveTask } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */
/** @typedef {import("../sync/plan.mjs").PlanItem} PlanItem */

/** Paths given on the command line, as paths relative to the linked folder. @param {Context} ctx @param {string} root */
export function relativeArgs(ctx, root) {
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
export async function buildPlan(ctx, options = {}) {
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
export const localPathOf = (root, remoteRoot, remotePath) => safeJoin(root, /** @type {string} */ (toRelative(remoteRoot, remotePath)));

/** Moves a local file into .networkbase/trash (kept 30 days) instead of deleting it (A1.6). @param {string} root @param {string} abs */
export function moveToLocalTrash(root, abs) {
  const dest = path.join(root, DIR_NAME, "trash", new Date().toISOString().replace(/[:.]/g, "-"), path.relative(root, abs));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
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
  const { root, project, items, skipped, offline, manifest } = await buildPlan(ctx);
  const changed = items.filter((i) => i.state !== "unchanged");
  const conflicts = changed.filter((i) => i.state === "conflict");
  const data = {
    workspace: { id: project.workspaceId, slug: project.slug, title: project.title },
    startedTask: project.startedTask ?? null,
    offline,
    readOnly: !manifest.canWrite,
    queued: readQueue(root).length,
    files: changed.map((i) => ({ path: i.path, state: i.state, action: i.action, ...(i.note ? { note: i.note } : {}), ...(i.remote ? { remoteVersion: i.remote.version } : {}) })),
    skipped,
  };
  const { c, sym } = ctx.out;
  ctx.out.result("nb.status/1", data, (d) => {
    const task = d.startedTask ? ` · #${d.startedTask.number ?? ""} ${safe(d.startedTask.title ?? "")}` : "";
    const head = `${c.brand(sym.brand)} ${safe(project.slug ?? project.workspaceId)}${task}${d.readOnly ? ` · ${c.warning("read only")}` : ""}${d.offline ? ` · ${c.warning("offline: server side not checked")}` : ""}`;
    const queued = d.queued ? [`  ${c.warning(`${d.queued} push(es) queued while offline: nb sync`)}`] : [];
    if (!d.files.length) return [head, ...queued, `  ${c.muted(`Up to date · ${root}`)}`, ...skippedLines(d.skipped)];
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
    const todo = plan.items.filter((i) => ["pull", "restore", "adopt", "remove-local", "conflict"].includes(i.action));
    if (ctx.flags["dry-run"]) {
      return ctx.out.result("nb.pull.plan/1", { files: todo.map((i) => ({ path: i.path, action: i.action })) }, (d) => (d.files.length ? d.files.map((f) => `  would ${f.action.replace("-", " ")}  ${safe(f.path)}`) : "Nothing to pull"));
    }
    /** @type {Array<{ path: string, did: string, version?: number, by?: string, copy?: string }>} */
    const results = [];
    /** @param {PlanItem} item */
    const apply = async (item) => {
      const r = /** @type {import("../sync/plan.mjs").RemoteFile} */ (item.remote);
      const abs = localPathOf(root, project.remoteRoot, item.path);
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
        await downloadTo(ctx.api, project.workspaceId, item.path, copy, r.hash);
        state.conflicts[item.path] = { remoteVersion: r.version, copy: path.relative(root, copy) };
        results.push({ path: item.path, did: "conflict", version: r.version, copy: path.relative(root, copy) });
        return;
      }
      const got = await downloadTo(ctx.api, project.workspaceId, item.path, abs, r.hash);
      if (got.content) saveBaseCopy(root, got.hash, got.content);
      recordBase(state, item.path, { nodeId: r.nodeId, version: r.version, hash: got.hash, abs });
      results.push({ path: item.path, did: item.action === "restore" ? "restored" : item.base ? "updated" : "new", version: r.version });
      // State is saved every 100 files; after a crash, a downloaded file matching the server is adopted next run.
      if (results.length % 100 === 0) writeState(root, state);
    };
    // 8 downloads at a time, 4 on Windows (A12.6).
    let next = 0;
    const worker = async () => { while (next < todo.length) await apply(/** @type {PlanItem} */ (todo[next++])); };
    await Promise.all(Array.from({ length: Math.min(process.platform === "win32" ? 4 : 8, todo.length) }, worker));
    results.sort((a, b) => a.path.localeCompare(b.path));
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

/** 1.x `--done` / `--wip` changed task status as a side effect of uploading; 2.0 only uploads (finding 135). @param {Context} ctx */
function oldStatusFlags(ctx) {
  if (ctx.flags.done) ctx.out.warn("--done no longer changes the task's status. After the push: nb task done");
  if (ctx.flags.wip) ctx.out.warn("--wip no longer changes the task's status. Use: nb task move <task> in_progress");
}

/** @param {Context} ctx */
export async function push(ctx) {
  oldStatusFlags(ctx);
  const { root } = ctx.requireRoot();
  const only = relativeArgs(ctx, root);
  if (!only.length && !ctx.flags.all && !ctx.out.interactive) {
    // Never upload a whole folder without being told which files (finding 21).
    throw usage("Say which files to push", "nb push <paths…>, or nb push --all for every changed tracked file");
  }
  const as = ctx.flags.as ?? readUserConfig(ctx.env)["default-as"] ?? null;
  if (as && !["reference", "draft", "final"].includes(as)) throw usage(`--as must be reference, draft or final (not ${as})`);
  const keyBase = /** @type {any} */ (ctx).queueId ?? crypto.randomUUID();
  const queueOffline = () => {
    if (ctx.flags["dry-run"]) return new CliError("OFFLINE", "Can't reach the server", { hint: "Try again when you're online" });
    const flags = Object.fromEntries(["task", "as", "message", "keep-both", "folder", "all"].filter((k) => ctx.flags[k] !== undefined).map((k) => [k, ctx.flags[k]]));
    const n = enqueue(root, { id: keyBase, op: "push", paths: only, flags, queuedAt: new Date().toISOString() });
    return new CliError("OFFLINE", `Offline: queued this push${n > 1 ? ` (${n} waiting)` : ""}`, { hint: "It sends with your next nb sync; your files are unchanged" });
  };
  const release = ctx.flags["dry-run"] ? () => {} : await acquireLock(root, "nb push");
  try {
    const plan = await buildPlan(ctx, { only });
    if (plan.offline) throw queueOffline();
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
          keyBase,
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
  oldStatusFlags(ctx);
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
