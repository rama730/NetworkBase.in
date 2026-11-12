// Looking at and settling changes: nb diff (offline, against the last-pulled copy) and nb resolve (report A1.7).
import fs from "node:fs";
import path from "node:path";

import { CliError, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { unifiedDiff } from "../sync/diff.mjs";
import { acquireLock, readBaseCopy, writeState } from "../sync/state.mjs";
import { downloadTo, renameRetry, uploadFiles } from "../sync/transfer.mjs";
import { ask } from "../tui/ask.mjs";
import { buildPlan, localPathOf, moveToLocalTrash, recordBase, relativeArgs } from "./files.mjs";

/** @typedef {import("../context.mjs").Context} Context */

// ───────────────────────────────── diff

/** @param {Context} ctx */
export async function diff(ctx) {
  // Two server versions (C3): nb diff report.md --from v1 --to v3 (--to defaults to the active one).
  if (ctx.flags.from) return versionDiff(ctx);
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

/** @param {Context} ctx */
async function versionDiff(ctx) {
  const p = ctx.positionals[0];
  if (!p) throw usage("nb diff <path> --from v1 [--to v3]");
  const num = (/** @type {unknown} */ v) => Number(String(v ?? "").replace(/^v/i, ""));
  const { nodeOf } = await import("./browse.mjs");
  const node = await nodeOf(ctx, p);
  const nodeId = node.nodeId ?? node.id;
  const projectId = ctx.requireWorkspace();
  const from = num(ctx.flags.from);
  let to = ctx.flags.to ? num(ctx.flags.to) : null;
  if (to === null) to = (/** @type {any} */ (await ctx.api.get("/api/v1/extension/file-history", { query: { projectId, nodeId } }))).activeVersion;
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || /** @type {number} */ (to) < 1) throw usage("Versions look like v1, v3", "See them: nb file history <path>");
  const read = async (/** @type {number} */ v) => /** @type {any} */ (await ctx.api.get("/api/v1/extension/file-history", { query: { projectId, nodeId, version: v } })).content;
  const [a, b] = await Promise.all([read(from), read(/** @type {number} */ (to))]);
  const binary = String(a).includes("\u0000") || String(b).includes("\u0000");
  const result = binary ? null : unifiedDiff(String(a), String(b));
  const { c } = ctx.out;
  ctx.out.result("nb.diff.versions/1", { path: node.path ?? p, from, to, binary, diff: result }, (d) => [
    c.bold(`${safe(d.path)}: v${d.from} → v${d.to}`),
    ...(d.binary ? [c.muted("  binary file: no line diff")] : !d.diff?.lines.length ? [c.muted("  the same content")] : d.diff.lines.map((/** @type {any} */ l) => (l.kind === "@" ? c.muted(l.text) : l.kind === "+" ? c.success(`+${safe(l.text)}`) : l.kind === "-" ? c.danger(`-${safe(l.text)}`) : ` ${safe(l.text)}`))),
  ]);
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
      // The server names the copy; it must sit next to the original and not replace another file here.
      if (path.posix.dirname(copy.path) !== path.posix.dirname(item.path)) throw new CliError("UNEXPECTED_RESPONSE", `The server put your copy at ${safe(copy.path)}, not next to ${safe(item.path)}`, { hint: "Your file is unchanged here; run nb pull" });
      const copyAbs = localPathOf(root, project.remoteRoot, copy.path);
      if (fs.existsSync(copyAbs)) throw new CliError("LOCAL_CONFLICT", `${safe(copy.path)} already exists here`, { hint: "Move it aside, then run nb pull" });
      renameRetry(item.local.abs, copyAbs);
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
