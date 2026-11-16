// nb watch (report A1.13, D2): in the foreground only, so you can see it and stop it with Ctrl+C. Pushes saves of
// files NetworkBase already tracks, as drafts, without linking each save to a task or moving its status. New files
// are pushed by naming them. Waits until an editor finishes saving (500 ms, plus 2 s quiet). It also pulls other
// people's new versions as they land (A1.13 item 5, long-poll /api/v1/events): pull never overwrites your edits, so
// a file you changed too gets a conflict copy. Its polling keeps this sign-in "active" in the app (presence, A11.4).
import fs from "node:fs";
import path from "node:path";

import { CliError, EXIT } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { toRemote } from "../sync/local.mjs";
import { readState } from "../sync/state.mjs";
import { toRelative } from "../sync/local.mjs";
import { pull, push } from "./files.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const SETTLE_MS = 500;
const QUIET_MS = 2000;
const SKIP = /(^|\/)(\.networkbase|\.git|node_modules|\.tasks)(\/|$)|\.nbtmp-|\.swp$|~$|(^|\/)\.#|(^|\/)4913$/;

/** @param {Context} ctx */
export async function watch(ctx) {
  const { root, project } = ctx.requireRoot();
  if (ctx.out.json) throw new CliError("USAGE", "nb watch runs until you stop it, so it has no --json result");
  if (ctx.flags.change) return watchChange(ctx, root, project);
  /** @type {Map<string, number>} relative path → last event time */
  const pending = new Map();
  let busy = false;
  let stopping = false;

  ctx.out.note(`${ctx.out.c.brand(ctx.out.sym.brand)} Watching ${root} → ${safe(project.slug ?? project.workspaceId)}`);
  ctx.out.note(ctx.out.c.muted(`  Saves of tracked files are pushed as drafts${ctx.flags["no-pull"] ? "" : "; teammates' new versions are pulled"}. New files: nb push <file>. Ctrl+C to stop.`));

  /** Files nb itself just wrote by pulling: their change events aren't your saves. */
  const pulledAt = new Map();
  const watcher = fs.watch(root, { recursive: true }, (_event, name) => {
    if (!name) return;
    const rel = String(name).split(path.sep).join("/");
    if (SKIP.test(rel)) return;
    if (Date.now() - (pulledAt.get(rel) ?? 0) < 5000) return;
    pending.set(rel, Date.now());
  });

  // Live pull: wait for new versions from other people, then pull just those files.
  const livePull = async () => {
    let since = new Date().toISOString();
    let backoff = 1000;
    while (!stopping) {
      try {
        const res = /** @type {any} */ (await ctx.api.get("/api/v1/events", { query: { since, workspace: project.workspaceId, inbox: ctx.flags.inbox ? 1 : 0 }, timeoutMs: 40_000 }));
        since = res.cursor;
        backoff = 1000;
        // --inbox (C13): your notifications as they happen, one line each; your settings and quiet hours already apply.
        if (ctx.flags.inbox) for (const n of res.notifications ?? []) ctx.out.note(`${ctx.out.c.brand(ctx.out.sym.brand)} ${safe(n.title ?? "")}${n.body ? ctx.out.c.muted(` · ${safe(String(n.body)).replace(/\s+/g, " ").slice(0, 100)}`) : ""}`);
        if (ctx.flags["no-pull"]) continue;
        const theirs = [...new Set(res.files.filter((/** @type {any} */ f) => !f.mine).map((/** @type {any} */ f) => toRelative(project.remoteRoot, f.path)).filter(Boolean))];
        if (!theirs.length || stopping) continue;
        while (busy) await new Promise((r) => setTimeout(r, 200));
        busy = true;
        try {
          for (const rel of theirs) pulledAt.set(rel, Date.now());
          await pull(/** @type {Context} */ ({ ...ctx, cwd: root, positionals: theirs, flags: { ...ctx.flags } }));
          for (const rel of theirs) pulledAt.set(rel, Date.now());
        } finally {
          busy = false;
        }
      } catch (error) {
        if (error instanceof CliError && (error.code === "UNAUTHORIZED" || error.status === 403)) { ctx.out.warn(`Live pull stopped: ${error.message}`); return; }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(60_000, backoff * 2);
      }
    }
  };
  if (!ctx.flags["no-pull"] || ctx.flags.inbox) void livePull();

  /** One batch: files whose last change is older than the quiet window. */
  async function flush() {
    if (busy || !pending.size) return;
    const now = Date.now();
    const ready = [...pending].filter(([, at]) => now - at >= QUIET_MS).map(([rel]) => rel);
    if (!ready.length) return;
    for (const rel of ready) pending.delete(rel);
    const state = readState(root, project.workspaceId);
    const tracked = ready.filter((rel) => state.files[toRemote(project.remoteRoot, rel)] && fs.existsSync(path.join(root, rel)));
    if (!tracked.length) return;
    busy = true;
    const ctx2 = /** @type {Context} */ ({ ...ctx, cwd: root, positionals: tracked, flags: { ...ctx.flags, as: "draft", task: undefined, message: ctx.flags.message ?? "Saved from nb watch" } });
    try {
      await push(ctx2);
    } catch (error) {
      const e = error instanceof CliError ? error : null;
      ctx.out.warn(`${e?.message ?? String(error)}${e?.hint ? ` — ${e.hint}` : ""}`);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void flush(), SETTLE_MS);
  await new Promise((resolve) => {
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      ctx.out.note(ctx.out.c.muted("Stopping after the current batch…"));
      while (busy) await new Promise((r) => setTimeout(r, 100));
      clearInterval(timer);
      watcher.close();
      resolve(undefined);
    };
    process.removeAllListeners("SIGINT");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  // A live-pull request may still be waiting on the server: don't let it hold the process open.
  setTimeout(() => process.exit(process.exitCode ?? EXIT.ok), 200).unref();
  return EXIT.ok;
}

/**
 * nb watch --change (report G8): saves go into the open change set instead of a push each; nb change finish sends
 * the last ones and checks it. @param {Context} ctx @param {string} root @param {any} project
 */
async function watchChange(ctx, root, project) {
  const { currentChange } = await import("../changes/capture.mjs");
  const { startCapture } = await import("../changes/watch.mjs");
  const id = currentChange(root);
  if (!id) throw new CliError("NOT_FOUND", "No open change set in this folder", { hint: "nb change start \"what you're doing\" first" });
  ctx.out.note(`${ctx.out.c.brand(ctx.out.sym.brand)} Adding your saves in ${root} to the change set ${id.slice(0, 8)}`);
  ctx.out.note(ctx.out.c.muted("  nb change finish when you're done. Ctrl+C to stop."));
  const capture = startCapture({ api: ctx.api, root, project, log: (line) => ctx.out.note(`  ${line}`) });
  await new Promise((resolve) => {
    process.removeAllListeners("SIGINT");
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  capture.stop();
  await capture.flush();
  return EXIT.ok;
}
