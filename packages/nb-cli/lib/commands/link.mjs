// Linking a folder to a workspace, and unlinking it (report A1.1, A1.20).
import { execFileSync } from "node:child_process";
import { self } from "../self.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DIR_NAME, findRoot, writeProjectConfig } from "../config.mjs";
import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { ask, confirm } from "../tui/ask.mjs";

/** @typedef {import("../context.mjs").Context} Context */

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
    // The workspace named like this folder (or its repository) comes first (C1).
    const matches = folderMatches(workspaces, here);
    const ordered = [...matches, ...workspaces.filter((/** @type {any} */ w) => !matches.includes(w))];
    const slug = await ask(ctx, { key: "workspace", header: "Workspace", question: "Which workspace should this folder link to?", options: ordered.slice(0, 9).map((/** @type {any} */ w, /** @type {number} */ i) => ({ value: w.slug, label: safe(w.title), description: i === 0 && matches.length ? `${w.slug} · matches this folder` : w.slug, recommended: i === 0 })) });
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

const plain = (/** @type {unknown} */ s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The folder's name and its git repository's name: what a person most likely called the workspace. @param {string} cwd */
function folderNames(cwd) {
  const names = new Set([plain(path.basename(cwd))]);
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    const config = path.join(dir, ".git", "config");
    if (fs.existsSync(config)) {
      const url = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(fs.readFileSync(config, "utf8"))?.[1];
      if (url) names.add(plain(path.basename(url).replace(/\.git$/, "")));
      if (dir !== cwd) names.add(plain(path.basename(dir)));
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  names.delete("");
  return [...names];
}

/**
 * Workspaces whose slug or title matches this folder or its repository, best first (C1).
 * @template {{ slug: string, title: string }} W @param {W[]} workspaces @param {string} cwd @returns {W[]}
 */
export function folderMatches(workspaces, cwd) {
  const names = folderNames(cwd);
  const score = (/** @type {W} */ w) => Math.max(0, ...[plain(w.slug), plain(w.title)].flatMap((label) => names.map((n) => (label === n ? 3 : label && (label.includes(n) || n.includes(label)) && Math.min(label.length, n.length) >= 3 ? 2 : 0))));
  return workspaces.map((w, i) => ({ w, s: score(w), i })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.w);
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

/**
 * nb start (report C7): from nothing to working in one command, `npx @networkbase/cli start`. Signs in if needed,
 * links this folder (suggesting the workspace named like it) if needed, then pulls. It stops only to ask what it
 * can't guess, through the same commands, so every question and answer flag works as they do.
 * @param {Context} ctx
 */
export async function start(ctx) {
  const { spawnSync } = await import("node:child_process");
  const pass = /** @type {const} */ (["profile", "api-url", "yes"]).flatMap((f) => (ctx.flags[f] === true ? [`--${f}`] : ctx.flags[f] ? [`--${f}`, String(ctx.flags[f])] : []));
  const answers = [ctx.flags.answer ?? []].flat().flatMap((a) => ["--answer", String(a)]);
  /** @param {string[]} args */
  const nb = (args) => {
    const r = spawnSync(...self([...args, ...pass, ...answers]), { cwd: ctx.cwd, env: ctx.env, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  const steps = [];
  if (!ctx.profile.token) { nb(["login"]); steps.push("signed in"); }
  if (!findRoot(path.resolve(ctx.cwd))) { nb(["init", ...ctx.positionals.slice(0, 1)]); steps.push("linked this folder"); }
  nb(["pull"]);
  steps.push("pulled the files");
  ctx.out.result("nb.start/1", { steps }, (d) => [`${ctx.out.c.success(ctx.out.sym.done)} Ready: ${d.steps.join(", ")}.`, "  Next: nb next for what to work on, nb status for what changed here."]);
}
