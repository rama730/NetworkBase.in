// nb change (report G7, G8): one named piece of multi-file work. Your saved files become the open change set; finish
// checks it; apply lands every file at once or none; undo puts them all back. The server keeps the rules.
import fs from "node:fs";
import path from "node:path";

import { currentChange, draftItems, readJournal, setCurrentChange, syncDraft, writeJournal } from "../changes/capture.mjs";
import { CliError, EXIT } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { toRelative } from "../sync/local.mjs";
import { hashFile, readState, writeState } from "../sync/state.mjs";
import { confirm } from "../tui/ask.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const enc = encodeURIComponent;
const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** @param {any} s */
const counts = (s) => [s.filesAdded && `${s.filesAdded} added`, s.filesChanged && `${s.filesChanged} changed`, s.filesDeleted && `${s.filesDeleted} deleted`, s.filesRenamed && `${s.filesRenamed} renamed`].filter(Boolean).join(", ") || "no files yet";

/** The change set a command acts on: the one named, else this folder's open one. @param {Context} ctx */
function pick(ctx) {
  const given = ctx.positionals[0];
  if (given) return given;
  const { root } = ctx.requireRoot();
  const id = currentChange(root);
  if (!id) throw new CliError("NOT_FOUND", "No open change set in this folder", { hint: "nb change start \"what you're doing\", or nb change list" });
  return id;
}

/** Sends the folder's saved changes to the open change set. @param {Context} ctx @param {string} id */
export async function captureNow(ctx, id) {
  const { root, project } = ctx.requireRoot();
  const { items, skipped } = await draftItems(root, project);
  const sync = await syncDraft(ctx.api, root, id, items);
  return { items, skipped, ...sync };
}

/** @param {Context} ctx */
export async function changeStart(ctx) {
  const { root, project } = ctx.requireRoot();
  const open = currentChange(root);
  if (open) throw new CliError("CONFLICT", `This folder already has an open change set (${open.slice(0, 8)})`, { hint: "nb change finish, or nb change discard" });
  const title = ctx.positionals.join(" ").trim() || String(ctx.flags.message ?? "").trim();
  if (!title) throw new CliError("USAGE", "Name the change set", { hint: "nb change start \"Redesign the sign-in page\"" });
  const { resolveTask } = await import("./tasks.mjs");
  const taskId = ctx.flags.task ? (await resolveTask(ctx, String(ctx.flags.task), { brief: true })).id : null;
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${enc(project.workspaceId)}/change-sets`, { title, ...(taskId ? { taskId } : {}) }));
  const set = res.changeSet;
  setCurrentChange(root, set.id);
  writeJournal(root, { id: set.id, title: set.title, sent: {}, missing: [] });
  ctx.out.result("nb.change.start/1", { changeSet: set }, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Started ${ctx.out.c.bold(safe(d.changeSet.title))} ${ctx.out.c.muted(d.changeSet.id.slice(0, 8))}`,
    ctx.out.c.muted("  Edit files as usual; nb change status shows them, nb change finish sends and checks them."),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function changeStatus(ctx) {
  const { root } = ctx.requireRoot();
  const id = ctx.positionals[0] ?? currentChange(root);
  if (!id) {
    ctx.out.result("nb.change.status/1", { changeSet: null }, () => ["No open change set in this folder.", ctx.out.c.muted("  nb change start \"what you're doing\" opens one; nb change list shows the workspace's.")]);
    return EXIT.ok;
  }
  const capture = ctx.flags["no-send"] ? null : await captureNow(ctx, id);
  const view = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  const set = view.changeSet;
  const conflicts = view.items.filter((/** @type {any} */ i) => i.state === "conflict");
  const pending = readJournal(root, id).missing.length;
  ctx.out.result("nb.change.status/1", { changeSet: set, items: view.items, uploadsPending: pending, conflicts, skipped: capture?.skipped ?? [] }, (d) => [
    `${ctx.out.c.bold(safe(d.changeSet.title))} ${ctx.out.c.muted(`${d.changeSet.id.slice(0, 8)} · ${d.changeSet.status}`)}`,
    `  ${counts(d.changeSet)}${d.changeSet.linesAdded || d.changeSet.linesRemoved ? ctx.out.c.muted(`, +${d.changeSet.linesAdded} −${d.changeSet.linesRemoved}`) : ""}`,
    ...(d.uploadsPending ? [ctx.out.c.warning(`  ${plural(d.uploadsPending, "file")} still to upload: run nb change status again`)] : []),
    ...d.conflicts.map((/** @type {any} */ c) => ctx.out.c.warning(`  ${ctx.out.sym.warn} ${safe(c.path)} changed since you started (${c.conflict?.kind ?? "edit"})`)),
    ...d.skipped.map((/** @type {any} */ s) => ctx.out.c.muted(`  skipped ${safe(s.path)}: ${s.reason}`)),
    ctx.out.c.muted(d.changeSet.status === "ready" ? "  Ready: nb change apply" : "  nb change finish when you're done"),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function changeList(ctx) {
  const workspaceId = ctx.requireWorkspace();
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(workspaceId)}/change-sets`, { query: { ...(ctx.flags.all ? {} : { status: "open,ready" }), ...(ctx.flags.mine ? { mine: 1 } : {}) } }));
  const { formatWhen } = await import("./tasks.mjs");
  ctx.out.result("nb.change.list/1", { changeSets: res.changeSets }, (d) =>
    d.changeSets.length
      ? d.changeSets.map((/** @type {any} */ s) => `  ${ctx.out.c.muted(s.id.slice(0, 8))}  ${s.status.padEnd(9)} ${safe(s.title)} ${ctx.out.c.muted(`· ${counts(s)} · ${formatWhen(s.updatedAt)}`)}`)
      : [ctx.flags.all ? "No change sets in this workspace yet." : "No open change sets.", ctx.out.c.muted("  nb change start \"what you're doing\" opens one.")]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function changeView(ctx) {
  const id = pick(ctx);
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  const sym = /** @type {Record<string, string>} */ ({ add: "+", change: "~", delete: "-", rename: ">" });
  ctx.out.result("nb.change.view/1", res, (d) => [
    `${ctx.out.c.bold(safe(d.changeSet.title))} ${ctx.out.c.muted(`${d.changeSet.id.slice(0, 8)} · ${d.changeSet.status} · ${counts(d.changeSet)}`)}`,
    ...(d.changeSet.message ? [`  ${safe(d.changeSet.message)}`] : []),
    ...d.items.map((/** @type {any} */ i) => `  ${sym[i.op] ?? "?"} ${safe(i.fromPath ? `${i.fromPath} → ${i.path}` : i.path)}${i.linesAdded != null ? ctx.out.c.muted(` +${i.linesAdded} −${i.linesRemoved}`) : ""}${i.state === "conflict" ? ctx.out.c.warning(` (changed since: ${i.conflict?.kind ?? "edit"})`) : i.state === "pending" ? ctx.out.c.muted(" (uploading)") : ""}`),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx @param {string} id */
async function finishSet(ctx, id) {
  const { root } = ctx.requireRoot();
  if (currentChange(root) === id) {
    const sent = await captureNow(ctx, id);
    if (sent.pending) throw new CliError("CONTENT_MISSING", `${plural(sent.pending, "file")} couldn't be uploaded yet`, { hint: "Run nb change finish again" });
  }
  return /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/finish`, { ...(ctx.flags.message ? { message: ctx.flags.message } : {}), ...(ctx.flags["confirm-secrets"] ? { confirmSecrets: true } : {}) }));
}

/** @param {Context} ctx */
export async function changeFinish(ctx) {
  const id = pick(ctx);
  const res = await finishSet(ctx, id);
  ctx.out.result("nb.change.finish/1", res, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} ${safe(d.summary)}`,
    ctx.out.c.muted(d.decision === "apply_now" ? "  Ready: nb change apply" : "  Ready, and big enough to look over first: nb change view, then nb change apply"),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function changeApply(ctx) {
  const id = pick(ctx);
  const { root, project } = ctx.requireRoot();
  let view = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  /** @type {any} */
  let finished = null;
  if (view.changeSet.status === "open") {
    finished = await finishSet(ctx, id);
    view = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  }
  const only = ctx.flags.only ? String(ctx.flags.only).split(",").map((p) => p.trim()).filter(Boolean) : null;
  if (view.changeSet.status === "ready" && (finished?.decision ?? "needs_confirmation") === "needs_confirmation") {
    const preview = view.items.slice(0, 30).map((/** @type {any} */ i) => `${i.op.padEnd(6)} ${i.fromPath ? `${i.fromPath} → ` : ""}${i.path}`).join("\n");
    const ok = await confirm(ctx, { key: "apply", question: `Apply "${view.changeSet.title}" (${counts(view.changeSet)})?`, preview, heldByServer: true, defaultYes: true });
    if (!ok) throw new CliError("CANCELLED", "Not applied");
  }
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/apply`, { ...(only ? { only } : {}), ...(finished?.confirmToken ? { confirmToken: finished.confirmToken } : {}) }));
  // The applied versions are now what this folder last synced (A1.2), so nb status shows it clean.
  if (res.changeSet.status === "applied") {
    const state = readState(root, project.workspaceId);
    for (const a of res.applied ?? []) {
      const undo = (res.undo ?? []).find((/** @type {any} */ u) => u.path === a.path);
      if (a.op === "delete") { delete state.files[a.path]; continue; }
      if (undo?.fromPath) delete state.files[undo.fromPath];
      const rel = toRelative(project.remoteRoot, a.path);
      const abs = rel ? path.join(root, rel) : null;
      const st = abs && fs.existsSync(abs) ? fs.statSync(abs) : null;
      if (!abs || !st) continue;
      // The hash of the file as it is now: if it changed again after finish, nb status still sees that.
      const item = view.items.find((/** @type {any} */ i) => i.path === a.path);
      const now = /** @type {string} */ (await hashFile(abs));
      state.files[a.path] = { nodeId: a.nodeId, baseVersion: a.version, baseHash: now === item?.contentHash ? now : String(item?.contentHash ?? now), size: st.size, mtimeMs: now === item?.contentHash ? st.mtimeMs : 0 };
    }
    writeState(root, state);
    if (currentChange(root) === id) setCurrentChange(root, null);
  }
  ctx.out.result("nb.change.apply/1", res, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Applied ${ctx.out.c.bold(safe(d.changeSet.title))}: ${plural(d.applied.length, "file")}`,
    ctx.out.c.muted(`  Undo all of it: nb change undo ${d.changeSet.id.slice(0, 8)}`),
  ]);
  return EXIT.ok;
}

/** A short id (from nb change list) as the full one. @param {Context} ctx @param {string} id */
async function fullId(ctx, id) {
  if (/^[0-9a-f-]{36}$/i.test(id)) return id;
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/change-sets`));
  const match = res.changeSets.filter((/** @type {any} */ s) => s.id.startsWith(id));
  if (match.length !== 1) throw new CliError("NOT_FOUND", `No single change set starts with ${id}`, { hint: "nb change list --all" });
  return match[0].id;
}

/** @param {Context} ctx */
export async function changeUndo(ctx) {
  const id = await fullId(ctx, pick(ctx));
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/undo`, { ...(ctx.flags.partial ? { partial: true } : {}) }));
  ctx.out.result("nb.change.undo/1", res, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Undid ${plural(d.undone.length, "file")} of ${safe(d.changeSet.title)}`,
    ...d.blocked.map((/** @type {any} */ b) => ctx.out.c.warning(`  ${ctx.out.sym.warn} left ${safe(b.path)}: it ${b.reason}`)),
    ctx.out.c.muted("  nb pull brings this folder back in step"),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function changeDiscard(ctx) {
  const id = await fullId(ctx, pick(ctx));
  const ok = await confirm(ctx, { key: "discard", question: "Discard this change set? Your files here stay as they are." });
  if (!ok) throw new CliError("CANCELLED", "Kept");
  await ctx.api.post(`/api/v1/change-sets/${enc(id)}/discard`, {});
  const root = ctx.root;
  if (root && currentChange(root) === id) setCurrentChange(root, null);
  ctx.out.result("nb.change.discard/1", { id }, () => `${ctx.out.c.success(ctx.out.sym.done)} Discarded; your files here are unchanged`);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function changeCopy(ctx) {
  const id = await fullId(ctx, pick(ctx));
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/copy`, {}));
  ctx.out.result("nb.change.start/1", res, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Copied as a new draft: ${safe(d.changeSet.title)} ${ctx.out.c.muted(d.changeSet.id.slice(0, 8))}`);
  return EXIT.ok;
}
