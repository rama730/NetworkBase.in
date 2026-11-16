// nb fs (report G14, M6): a workspace's files without a folder on this computer, for cloud agents on the hosted MCP
// server. Reads see the session's draft; the first write opens a change set for the session, and fs finish checks
// (and with --apply applies) it. Hidden: people and local agents work in a linked folder.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { globalDir } from "../config.mjs";
import { CliError, EXIT } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */
const enc = encodeURIComponent;

/** This session's change set in this workspace, kept beside the session's settings. @param {Context} ctx @param {string} ws */
function sessionFile(ctx, ws) {
  const key = crypto.createHash("sha256").update(`${ctx.env.NB_AGENT_SESSION ?? "terminal"}:${ws}`).digest("hex").slice(0, 24);
  return path.join(globalDir(ctx.env), "fs-sessions", `${key}.json`);
}
/** @param {Context} ctx @param {string} ws @returns {string | null} */
function sessionSet(ctx, ws) {
  try { return JSON.parse(fs.readFileSync(sessionFile(ctx, ws), "utf8")).id ?? null; } catch { return null; }
}
/** @param {Context} ctx @param {string} ws @param {string | null} id */
function setSessionSet(ctx, ws, id) {
  const file = sessionFile(ctx, ws);
  if (!id) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ id }), { mode: 0o600 });
}

/** Runs a write in the session's open change set, opening one first (or again, if the last one was finished elsewhere). @param {Context} ctx @param {string} op @param {any} body */
async function write(ctx, op, body) {
  const ws = ctx.requireWorkspace();
  const open = async () => {
    const title = String(ctx.flags.title ?? "").trim() || `Changes by ${ctx.env.NB_AGENT_NAME ?? "a cloud agent"}`;
    const res = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${enc(ws)}/change-sets`, { title: title.slice(0, 120) }));
    setSessionSet(ctx, ws, res.changeSet.id);
    return /** @type {string} */ (res.changeSet.id);
  };
  let id = sessionSet(ctx, ws) ?? (await open());
  try {
    return { id, res: /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/fs/${op}`, body)) };
  } catch (error) {
    // Finished, applied or discarded elsewhere (the person, in the app): the session goes on in a new one.
    if (!(error instanceof CliError) || !(error.code === "CHANGE_SET_CLOSED" || (error.code === "NOT_FOUND" && /change set not found/i.test(error.message)))) throw error;
    id = await open();
    return { id, res: /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/fs/${op}`, body)) };
  }
}
/** @param {Context} ctx */
const readQuery = (ctx) => { const id = sessionSet(ctx, ctx.requireWorkspace()); return id ? { changeSet: id } : {}; };

/** @param {Context} ctx */
export async function fsList(ctx) {
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/fs/list`, { query: { ...readQuery(ctx), ...(ctx.positionals[0] ? { glob: ctx.positionals[0] } : {}) } }));
  ctx.out.result("nb.fs.list/1", res, (d) => [...d.files.map((/** @type {any} */ f) => `${safe(f.path)}${f.inDraft ? ctx.out.c.muted("  (in your change set)") : ""}`), ...(d.truncated ? [ctx.out.c.muted(`  …${d.total - d.files.length} more; narrow with a glob`)] : [])]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function fsRead(ctx) {
  if (!ctx.positionals.length) throw new CliError("USAGE", "Name the files to read", { hint: "nb fs read src/app.ts" });
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/fs/read`, { query: { ...readQuery(ctx), path: ctx.positionals } }));
  ctx.out.result("nb.fs.read/1", res, (d) => d.files.flatMap((/** @type {any} */ f) => [ctx.out.c.bold(safe(f.path)), f.text ?? ctx.out.c.muted(f.error ? `  ${f.error}` : `  binary, ${f.size} bytes`)]));
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function fsSearch(ctx) {
  const query = ctx.positionals.join(" ");
  if (!query) throw new CliError("USAGE", "Say what to search for", { hint: "nb fs search \"useState(\"" });
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/fs/search`, { query: { ...readQuery(ctx), query, ...(ctx.flags.regex ? { regex: "true" } : {}), ...(ctx.flags.case ? { caseSensitive: "true" } : {}), ...(ctx.flags.glob ? { glob: String(ctx.flags.glob) } : {}) } }));
  ctx.out.result("nb.fs.search/1", res, (d) => [
    ...d.matches.map((/** @type {any} */ m) => `${safe(m.path)}:${m.line}: ${safe(m.text)}`),
    ...(d.truncated ? [ctx.out.c.muted("  …more; narrow with --glob")] : []),
    ...(d.notIndexed ? [ctx.out.c.muted(`  ${d.notIndexed} files not searched yet; search again to include them`)] : []),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx @param {string} schema @param {string} op @param {any} body @param {(d: any) => string} line */
async function writeCommand(ctx, schema, op, body, line) {
  const { id, res } = await write(ctx, op, body);
  ctx.out.result(schema, { ...res, changeSet: id }, (d) => [`${ctx.out.c.success(ctx.out.sym.done)} ${line(d)}`, ...(d.held ? [ctx.out.c.warning("  Held: it looks like it holds a password or key, so it wasn't stored; take the key out and write it again")] : [])]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function fsWrite(ctx) {
  const [p] = ctx.positionals;
  if (!p || ctx.flags.text == null) throw new CliError("USAGE", "Name the file and its text", { hint: "nb fs write src/app.ts --text \"…\"" });
  return writeCommand(ctx, "nb.fs.write/1", "write", { path: p, text: String(ctx.flags.text) }, (d) => `Wrote ${safe(d.path)} in your change set`);
}

/** @param {Context} ctx */
export async function fsEdit(ctx) {
  const [p] = ctx.positionals;
  /** @type {any[] | null} */
  let edits = null;
  if (ctx.flags.edits != null) {
    try { edits = JSON.parse(String(ctx.flags.edits)); } catch { /* checked below */ }
    if (!Array.isArray(edits)) throw new CliError("USAGE", "--edits takes a JSON list of { oldText, newText, all? }");
  } else if (ctx.flags.old != null && ctx.flags.new != null) {
    edits = [{ oldText: String(ctx.flags.old), newText: String(ctx.flags.new), all: Boolean(ctx.flags.all) }];
  }
  if (!p || !edits) throw new CliError("USAGE", "Name the file, the text to replace and its replacement", { hint: "nb fs edit src/app.ts --old \"a\" --new \"b\"" });
  return writeCommand(ctx, "nb.fs.edit/1", "edit", { path: p, edits }, (d) => `Edited ${safe(d.path)} (${d.replaced} ${d.replaced === 1 ? "place" : "places"})`);
}

/** @param {Context} ctx */
export async function fsDelete(ctx) {
  const [p] = ctx.positionals;
  if (!p) throw new CliError("USAGE", "Name the file", { hint: "nb fs delete src/old.ts" });
  return writeCommand(ctx, "nb.fs.delete/1", "delete", { path: p }, (d) => `Deleted ${safe(d.path)} in your change set`);
}

/** @param {Context} ctx */
export async function fsMove(ctx) {
  const [from, to] = ctx.positionals;
  if (!from || !to) throw new CliError("USAGE", "Name the file and where it goes", { hint: "nb fs move src/a.ts src/b.ts" });
  return writeCommand(ctx, "nb.fs.move/1", "move", { from, to }, (d) => `Moved ${safe(d.from)} to ${safe(d.to)} in your change set`);
}

/** Finish the session's change set; with --apply, apply it too (big ones wait for the person's yes). @param {Context} ctx */
export async function fsFinish(ctx) {
  const ws = ctx.requireWorkspace();
  const id = sessionSet(ctx, ws);
  if (!id) throw new CliError("NOT_FOUND", "No change set in this session: nothing written yet", { hint: "Write or edit a file first" });
  const finished = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/finish`, ctx.flags.message ? { message: String(ctx.flags.message) } : {}));
  if (!ctx.flags.apply) {
    ctx.out.result("nb.fs.finish/1", { ...finished, changeSet: finished.changeSet ?? { id } }, (d) => [`${ctx.out.c.success(ctx.out.sym.done)} ${safe(d.summary)}`, ctx.out.c.muted(d.decision === "apply_now" ? "  Ready: nb fs finish --apply" : "  Ready for the person to look over and apply")]);
    return EXIT.ok;
  }
  const applied = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/apply`, {}));
  if (applied.changeSet?.status === "applied") setSessionSet(ctx, ws, null);
  ctx.out.result("nb.fs.apply/1", applied, (d) => [`${ctx.out.c.success(ctx.out.sym.done)} Applied ${safe(d.changeSet.title)}: ${d.applied.length} files`, ctx.out.c.muted(`  Undo all of it: nb change undo ${d.changeSet.id.slice(0, 8)}`)]);
  return EXIT.ok;
}
