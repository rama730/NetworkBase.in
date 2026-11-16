// nb change (report G7, G8): one named piece of multi-file work. Your saved files become the open change set; finish
// checks it; apply lands every file at once or none; undo puts them all back. The server keeps the rules.
import fs from "node:fs";
import path from "node:path";

import { currentChange, draftItems, readJournal, setCurrentChange, syncDraft, writeJournal } from "../changes/capture.mjs";
import { CliError, EXIT } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { toRelative, toRemote } from "../sync/local.mjs";
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
  const sync = await syncDraft(ctx.api, root, id, items, { confirmSecrets: Boolean(ctx.flags["confirm-secrets"]) });
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
  const id = ctx.positionals[0] ? await fullId(ctx, ctx.positionals[0]) : currentChange(root);
  if (!id) {
    // Nothing open: the last applied ones, so "undo what you applied" is one step (found in the D22 agent run).
    const recent = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/change-sets`, { query: { status: "applied", limit: 3 } }).catch(() => ({ changeSets: [] })));
    const applied = (recent.changeSets ?? []).slice(0, 3).map((/** @type {any} */ s) => ({ id: s.id, title: s.title, appliedAt: s.appliedAt ?? s.updatedAt, files: s.filesAdded + s.filesChanged + s.filesDeleted + s.filesRenamed }));
    ctx.out.result("nb.change.status/1", { changeSet: null, recentlyApplied: applied }, (d) => [
      "No open change set in this folder.",
      ...d.recentlyApplied.map((/** @type {any} */ a) => `  applied ${ctx.out.c.muted(a.id.slice(0, 8))} ${safe(a.title)} ${ctx.out.c.muted(`· ${plural(a.files, "file")} · undo: nb change undo ${a.id.slice(0, 8)}`)}`),
      ctx.out.c.muted("  nb change start \"what you're doing\" opens one; nb change list shows the workspace's."),
    ]);
    return EXIT.ok;
  }
  // Sending the latest saves is best effort: a failed upload (storage down, signed out) still shows the set, with
  // what's waiting (found in the D22 agent run, where a storage error made status itself fail).
  /** @type {Awaited<ReturnType<typeof captureNow>> | null} */
  let capture = null;
  let sendError = null;
  if (!ctx.flags["no-send"]) {
    try { capture = await captureNow(ctx, id); } catch (error) { sendError = error instanceof Error ? error.message : String(error); }
  }
  const view = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  const set = view.changeSet;
  const conflicts = view.items.filter((/** @type {any} */ i) => i.state === "conflict");
  const pending = readJournal(root, id).missing.length;
  const held = Object.values(readJournal(root, id).held ?? {});
  const comments = (view.comments ?? []).filter((/** @type {any} */ c) => !c.resolvedAt);
  ctx.out.result("nb.change.status/1", { changeSet: set, items: view.items, uploadsPending: pending, held, conflicts, comments, skipped: capture?.skipped ?? [], ...(sendError ? { sendError } : {}) }, (d) => [
    `${ctx.out.c.bold(safe(d.changeSet.title))} ${ctx.out.c.muted(`${d.changeSet.id.slice(0, 8)} · ${d.changeSet.status}`)}`,
    `  ${counts(d.changeSet)}${d.changeSet.linesAdded || d.changeSet.linesRemoved ? ctx.out.c.muted(`, +${d.changeSet.linesAdded} −${d.changeSet.linesRemoved}`) : ""}`,
    ...(d.held.length ? [ctx.out.c.warning(`  Not sent, ${d.held.length === 1 ? "it looks" : "they look"} like ${d.held.length === 1 ? "it holds" : "they hold"} a key: ${d.held.map((/** @type {string} */ p) => safe(p)).join(", ")}`), ctx.out.c.muted("  Remove the key, or nb change finish --confirm-secrets if it's safe to share")] : []),
    ...(d.sendError ? [ctx.out.c.warning(`  Your latest saves weren't sent: ${safe(d.sendError)}. They stay here; nb change status tries again`)] : []),
    ...(d.uploadsPending > d.held.length ? [ctx.out.c.warning(`  ${plural(d.uploadsPending - d.held.length, "file")} still to upload: run nb change status again`)] : []),
    ...d.conflicts.map((/** @type {any} */ c) => ctx.out.c.warning(`  ${ctx.out.sym.warn} ${safe(c.path)} changed since you started (${c.conflict?.kind ?? "edit"})`)),
    ...d.skipped.map((/** @type {any} */ s) => ctx.out.c.muted(`  skipped ${safe(s.path)}: ${s.reason}`)),
    ...d.comments.map((/** @type {any} */ c) => `  ${ctx.out.c.brand("»")} ${safe(c.path)}${c.line ? `:${c.line}` : ""} ${ctx.out.c.muted(`${safe(c.author || c.username || "someone")}:`)} ${safe(c.body).replace(/\s+/g, " ").slice(0, 160)}`),
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
  const id = await fullId(ctx, pick(ctx));
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  const sym = /** @type {Record<string, string>} */ ({ add: "+", change: "~", delete: "-", rename: ">" });
  ctx.out.result("nb.change.view/1", res, (d) => [
    `${ctx.out.c.bold(safe(d.changeSet.title))} ${ctx.out.c.muted(`${d.changeSet.id.slice(0, 8)} · ${d.changeSet.status} · ${counts(d.changeSet)}`)}`,
    ...(d.changeSet.message ? [`  ${safe(d.changeSet.message)}`] : []),
    ...(d.comments ?? []).filter((/** @type {any} */ c) => !c.resolvedAt).map((/** @type {any} */ c) => `  ${ctx.out.c.brand("»")} ${safe(c.path)}${c.line ? `:${c.line}` : ""} ${ctx.out.c.muted(`${safe(c.author || c.username || "someone")}:`)} ${safe(c.body).replace(/\s+/g, " ").slice(0, 160)}`),
    ...d.items.map((/** @type {any} */ i) => `  ${sym[i.op] ?? "?"} ${safe(i.fromPath ? `${i.fromPath} → ${i.path}` : i.path)}${i.linesAdded != null ? ctx.out.c.muted(` +${i.linesAdded} −${i.linesRemoved}`) : ""}${i.state === "conflict" ? ctx.out.c.warning(` (changed since: ${i.conflict?.kind ?? "edit"})`) : i.state === "pending" ? ctx.out.c.muted(" (uploading)") : ""}`),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx @param {string} id */
async function finishSet(ctx, id) {
  const { root } = ctx.requireRoot();
  if (currentChange(root) === id) {
    const sent = await captureNow(ctx, id);
    if (sent.held.length) throw new CliError("SECRET_DETECTED", `Not sent: ${sent.held.join(", ")} ${sent.held.length === 1 ? "looks" : "look"} like ${sent.held.length === 1 ? "it holds" : "they hold"} a password or key`, { hint: "Remove the key, or nb change finish --confirm-secrets if it's safe to share (agents can't)" });
    if (sent.pending) throw new CliError("CONTENT_MISSING", `${plural(sent.pending, "file")} couldn't be uploaded yet`, { hint: "Run nb change finish again" });
  }
  return /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/finish`, { ...(ctx.flags.message ? { message: ctx.flags.message } : {}), ...(ctx.flags["confirm-secrets"] ? { confirmSecrets: true } : {}) }));
}

/**
 * The commits in `range` as change set items (report G18, --from-git): each file they changed, as at the range's end,
 * written to a scratch folder for the upload; files outside the linked folder are left out.
 * @param {string} root @param {any} project @param {string} range
 */
async function gitItems(root, project, range) {
  const { execFileSync } = await import("node:child_process");
  const crypto = await import("node:crypto");
  const os = await import("node:os");
  const { mimeFor } = await import("../sync/transfer.mjs");
  const spec = range.includes("..") ? range : `${range}..HEAD`;
  const end = spec.split(/\.\.\.?/)[1] || "HEAD";
  // Never read as a git option (git show -x, git log --output=…).
  if (spec.startsWith("-") || end.startsWith("-")) throw new CliError("USAGE", "Give a range of commits, like main..HEAD");
  /** @param {string[]} args */
  const git = (args) => {
    try { return execFileSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { throw new CliError("USAGE", `git ${args[0]} failed: ${String(/** @type {any} */ (error).stderr ?? error).trim().split("\n")[0]}`, { hint: "Run it in a git repository, with a range like main..HEAD" }); }
  };
  const top = git(["rev-parse", "--show-toplevel"]).toString().trim();
  const subjects = git(["log", "--format=%s", spec, "--"]).toString().split("\n").filter(Boolean);
  if (!subjects.length) throw new CliError("NOT_FOUND", `No commits in ${spec}`);
  const fields = git(["diff", "--name-status", "-z", "-M", "--no-ext-diff", spec, "--"]).toString().split("\0").filter((x) => x !== "");
  const state = readState(root, project.workspaceId);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nb-from-git-"));
  const remoteOf = (/** @type {string} */ p) => { const rel = path.relative(root, path.join(top, p)); return rel.startsWith("..") || path.isAbsolute(rel) ? null : toRemote(project.remoteRoot, rel); };
  /** @type {any[]} */
  const items = [];
  for (let i = 0; i < fields.length;) {
    const status = /** @type {string} */ (fields[i++]);
    const from = /** @type {string} */ (fields[i++]);
    const to = /^[RC]/.test(status) ? /** @type {string} */ (fields[i++]) : from;
    const remote = remoteOf(to);
    if (!remote) continue;
    const base = state.files[status[0] === "R" ? remoteOf(from) ?? "" : remote];
    const baseFields = base ? { baseVersion: base.baseVersion, baseHash: base.baseHash } : {};
    if (status[0] === "D") { items.push({ op: "delete", path: remote, ...baseFields }); continue; }
    const bytes = git(["show", `${end}:${to}`]);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const abs = path.join(scratch, hash);
    fs.writeFileSync(abs, bytes);
    const fromRemote = status[0] === "R" ? remoteOf(from) : null;
    items.push({ op: fromRemote ? "rename" : base ? "change" : "add", path: remote, ...(fromRemote ? { fromPath: fromRemote } : {}), abs, contentHash: hash, size: bytes.byteLength, mimeType: mimeFor(remote), ...baseFields });
  }
  const title = subjects.length === 1 ? subjects[0] : `${subjects.at(-1)} (+${subjects.length - 1} more commits)`;
  return { items, scratch, title: /** @type {string} */ (title).slice(0, 120), message: subjects.length > 1 ? subjects.reverse().map((x) => `- ${x}`).join("\n").slice(0, 2000) : null };
}

/** nb change finish --from-git: a change set made from commits, not from the folder's saves. @param {Context} ctx */
async function finishFromGit(ctx) {
  const { root, project } = ctx.requireRoot();
  if (currentChange(root)) throw new CliError("CONFLICT", "This folder already has an open change set", { hint: "Finish or discard it first: nb change finish, or nb change discard" });
  const { items, scratch, title, message } = await gitItems(root, project, String(ctx.flags["from-git"]));
  try {
    if (!items.length) throw new CliError("NOT_FOUND", "Those commits change no files in this linked folder");
    const started = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${enc(project.workspaceId)}/change-sets`, { title, ...(message ? { message } : {}) }));
    const id = started.changeSet.id;
    writeJournal(root, { id, title, sent: {}, missing: [] });
    const sync = await syncDraft(ctx.api, root, id, items, { confirmSecrets: Boolean(ctx.flags["confirm-secrets"]) });
    if (sync.held.length) throw new CliError("SECRET_DETECTED", `Not sent: ${sync.held.join(", ")} ${sync.held.length === 1 ? "looks" : "look"} like ${sync.held.length === 1 ? "it holds" : "they hold"} a password or key`, { hint: `Remove the key in a new commit, or add --confirm-secrets if it's safe to share; nb change discard ${id.slice(0, 8)} drops this one` });
    const res = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/finish`, { ...(ctx.flags.message ? { message: ctx.flags.message } : {}), ...(ctx.flags["confirm-secrets"] ? { confirmSecrets: true } : {}) }));
    ctx.out.result("nb.change.finish/1", res, (d) => [
      `${ctx.out.c.success(ctx.out.sym.done)} ${safe(d.summary)}`,
      ctx.out.c.muted(`  From ${plural(items.length, "file")} in ${String(ctx.flags["from-git"])}. ${d.decision === "apply_now" ? "Ready: nb change apply" : "Ready, and big enough to look over first: nb change view, then nb change apply"} ${id.slice(0, 8)}`),
    ]);
    return EXIT.ok;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** @param {Context} ctx */
export async function changeFinish(ctx) {
  if (ctx.flags["from-git"]) return finishFromGit(ctx);
  // Saves not captured into a change set yet (an agent finishing before its first save was picked up): one opens now,
  // named like the one nb mcp opens, then finishes (found in the D22 agent run).
  const { root, project } = ctx.requireRoot();
  if (!ctx.positionals[0] && !currentChange(root)) {
    const { items } = await draftItems(root, project);
    if (!items.length) throw new CliError("NOT_FOUND", "Nothing to finish: no saved changes and no open change set here", { hint: "nb change status" });
    const task = project.startedTask;
    const title = String(ctx.flags.message ?? "").split("\n")[0]?.trim() || (task?.number ? `Work on #${task.number}${task.title ? `: ${task.title}` : ""}` : `Changes by ${ctx.env.NB_AGENT_NAME ?? "the terminal"}`);
    const started = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${enc(project.workspaceId)}/change-sets`, { title: title.slice(0, 120) }));
    setCurrentChange(root, started.changeSet.id);
    writeJournal(root, { id: started.changeSet.id, title: started.changeSet.title, sent: {}, missing: [] });
  }
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
  const id = await fullId(ctx, pick(ctx));
  const { root, project } = ctx.requireRoot();
  let view = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  /** @type {any} */
  let finished = null;
  // Finish (again) for the decision: small ones apply without asking. A set finished earlier is checked again, which
  // is cheap; someone else's can't be (only its author finishes), so applying it asks (found in the M5 live check).
  if (view.changeSet.status === "open" || view.changeSet.status === "ready") {
    finished = await finishSet(ctx, id).catch((/** @type {unknown} */ error) => {
      if (view.changeSet.status === "ready" && error instanceof CliError && error.code === "FORBIDDEN") return null;
      throw error;
    });
    view = /** @type {any} */ (await ctx.api.get(`/api/v1/change-sets/${enc(id)}`));
  }
  const only = ctx.flags.only ? String(ctx.flags.only).split(",").map((p) => p.trim()).filter(Boolean) : null;
  if (view.changeSet.status === "ready" && (finished?.decision ?? "needs_confirmation") === "needs_confirmation") {
    const preview = view.items.slice(0, 30).map((/** @type {any} */ i) => `${i.op.padEnd(6)} ${i.fromPath ? `${i.fromPath} → ` : ""}${i.path}`).join("\n");
    const ok = await confirm(ctx, { key: "apply", question: `Apply "${view.changeSet.title}" (${counts(view.changeSet)})?`, preview, heldByServer: true, defaultYes: true });
    if (!ok) throw new CliError("CANCELLED", "Not applied");
  }
  // Never the finish's confirm token: an agent's big change set waits for its person's yes (the server answers 428).
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/apply`, only ? { only } : {}));
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
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/change-sets`, { query: { limit: 100 } }));
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

/**
 * nb change update (report G8 "update the draft"): newer versions from the workspace are merged into your files here
 * with merge3, and become their base; files that can't merge get a conflict copy (nb change resolve). Files only
 * changed on the server are pulled. Your draft then carries the merged files.
 * @param {Context} ctx
 */
export async function changeUpdate(ctx) {
  const { root } = ctx.requireRoot();
  const id = currentChange(root);
  const { buildPlan, recordBase, pull } = await import("./files.mjs");
  const { merge3, isMergeableText } = await import("../sync/merge3.mjs");
  const { readBaseCopy, saveBaseCopy, acquireLock } = await import("../sync/state.mjs");
  const { downloadTo, conflictCopyPath } = await import("../sync/transfer.mjs");
  const plan = await buildPlan(ctx);
  const both = plan.items.filter((i) => i.state === "conflict" && i.local && i.remote);
  /** @type {string[]} */ const merged = [];
  /** @type {Array<{ path: string, copy: string }>} */ const conflicts = [];
  const release = await acquireLock(root, "nb change update");
  try {
    for (const item of both) {
      const local = /** @type {NonNullable<typeof item.local>} */ (item.local);
      const remote = /** @type {NonNullable<typeof item.remote>} */ (item.remote);
      const theirsFile = `${local.abs}.nbtmp-theirs`;
      const got = await downloadTo(ctx.api, plan.project.workspaceId, item.path, theirsFile, remote.hash);
      try {
        const theirs = fs.readFileSync(theirsFile);
        const mine = fs.readFileSync(local.abs);
        const base = item.base ? readBaseCopy(root, item.base.baseHash) : null;
        const result = base && [base, theirs, mine].every((b) => isMergeableText(b)) ? merge3(base.toString("utf8"), theirs.toString("utf8"), mine.toString("utf8")) : null;
        if (result?.ok) {
          fs.writeFileSync(local.abs, result.text);
          saveBaseCopy(root, got.hash, theirs);
          recordBase(plan.state, item.path, { nodeId: remote.nodeId, version: remote.version, hash: got.hash, abs: local.abs });
          // The file now differs from its new base (the merge), so nb sees it as your change again.
          plan.state.files[item.path] = { ...plan.state.files[item.path], mtimeMs: 0 };
          merged.push(item.path);
        } else {
          const copy = conflictCopyPath(local.abs, remote.version);
          fs.renameSync(theirsFile, copy);
          plan.state.conflicts[item.path] = { remoteVersion: remote.version, copy: path.relative(root, copy).split(path.sep).join("/") };
          conflicts.push({ path: item.path, copy: path.relative(root, copy) });
        }
      } finally {
        fs.rmSync(theirsFile, { force: true });
      }
    }
    writeState(root, plan.state);
  } finally {
    release();
  }
  // Files only changed on the server come down as usual (pull never overwrites your edits).
  if (plan.items.some((i) => i.action === "pull")) await pull(/** @type {Context} */ ({ ...ctx, flags: { ...ctx.flags, json: false, quiet: true } }));
  if (id) await captureNow(ctx, id);
  ctx.out.result("nb.change.update/1", { merged, conflicts }, (d) => [
    d.merged.length ? `${ctx.out.c.success(ctx.out.sym.done)} Merged teammates' changes into ${plural(d.merged.length, "file")}: ${d.merged.map((/** @type {string} */ p) => safe(p)).join(", ")}` : `${ctx.out.c.success(ctx.out.sym.done)} Up to date`,
    ...d.conflicts.map((/** @type {any} */ c) => ctx.out.c.warning(`  ${ctx.out.sym.warn} ${safe(c.path)} changed in the same lines: theirs is in ${safe(c.copy)}; nb change resolve ${safe(c.path)} --mine|--theirs`)),
  ]);
  return conflicts.length ? EXIT.conflict : EXIT.ok;
}

/**
 * nb change resolve <path> --mine|--theirs (report G9): settles a file that changed on both sides, here and in the
 * change set on the server. Mine keeps your file over theirs; theirs takes the workspace's file and drops the item.
 * @param {Context} ctx
 */
export async function changeResolve(ctx) {
  const { root, project } = ctx.requireRoot();
  const id = currentChange(root);
  const raw = ctx.positionals[0];
  if (!raw) throw new CliError("USAGE", "nb change resolve <path> --mine|--theirs");
  const choice = ctx.flags.mine ? "mine" : ctx.flags.theirs ? "theirs" : null;
  if (!choice) throw new CliError("USAGE", "Say which to keep: --mine or --theirs", { hint: "nb change view shows what changed" });
  const remote = raw.startsWith("/") ? raw : `/${path.relative(root, path.resolve(ctx.cwd, raw)).split(path.sep).join("/")}`;
  const state = readState(root, project.workspaceId);
  const meta = /** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId: project.workspaceId, path: remote, transfer: "metadata" } }).catch(() => null));
  const rel = toRelative(project.remoteRoot, remote);
  // Inside this folder and never in .git (the same guard as nb pull): an agent's path can't write elsewhere.
  const { safeJoin } = await import("../sync/transfer.mjs");
  const abs = rel ? safeJoin(root, rel) : null;
  if (choice === "theirs" && meta && abs) {
    const { downloadTo } = await import("../sync/transfer.mjs");
    const got = await downloadTo(ctx.api, project.workspaceId, remote, abs, meta.contentHash ?? null);
    const st = fs.statSync(abs);
    state.files[remote] = { nodeId: meta.nodeId ?? meta.id, baseVersion: meta.currentVersion ?? meta.version, baseHash: got.hash, size: st.size, mtimeMs: st.mtimeMs };
  } else if (choice === "mine" && meta) {
    // Yours goes over theirs: their version becomes your base, so the draft sends your file as a change of it.
    state.files[remote] = { ...(state.files[remote] ?? { size: 0 }), nodeId: meta.nodeId ?? meta.id, baseVersion: meta.currentVersion ?? meta.version, baseHash: String(meta.contentHash ?? ""), mtimeMs: 0 };
  }
  const copy = state.conflicts[remote]?.copy;
  if (copy) fs.rmSync((await import("../sync/transfer.mjs")).safeJoin(root, copy.split(path.sep).join("/")), { force: true });
  delete state.conflicts[remote];
  writeState(root, state);
  if (id) {
    await ctx.api.post(`/api/v1/change-sets/${enc(id)}/resolve`, { path: remote, choice }).catch((/** @type {unknown} */ error) => {
      // Not conflicted on the server (only here): nothing to settle there.
      if (!(error instanceof CliError && error.status === 404)) throw error;
    });
    await captureNow(ctx, id);
  }
  ctx.out.result("nb.change.resolve/1", { path: remote, choice }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${safe(d.path)}: kept ${d.choice === "mine" ? "yours" : "theirs"}`);
  return EXIT.ok;
}

/**
 * An oversized nb push as one change set (report G17): all files land or none. Null when change sets are off here,
 * so the push goes up as before.
 * @param {Context} ctx @param {string} root @param {any} project @param {any[]} items plan items with .local
 * @returns {Promise<{ changeSet: any, applied: any[] } | null>}
 */
export async function pushAsChangeSet(ctx, root, project, items) {
  const { mimeFor } = await import("../sync/transfer.mjs");
  const title = String(ctx.flags.message ?? `Push of ${items.length} files`).slice(0, 120);
  /** @type {any} */
  let started;
  try {
    started = await ctx.api.post(`/api/v1/workspaces/${enc(project.workspaceId)}/change-sets`, { title });
  } catch (error) {
    if (error instanceof CliError && error.code === "CHANGE_SETS_OFF") return null;
    throw error;
  }
  const id = started.changeSet.id;
  writeJournal(root, { id, title, sent: {}, missing: [] });
  const draft = items.map((i) => ({
    op: /** @type {"add" | "change"} */ (i.base ? "change" : "add"), path: i.path, abs: i.local.abs, contentHash: i.local.hash, size: i.local.size, mimeType: mimeFor(i.path),
    ...(i.base ? { baseVersion: i.base.baseVersion, baseHash: i.base.baseHash } : {}),
  }));
  const sync = await syncDraft(ctx.api, root, id, draft, { confirmSecrets: Boolean(ctx.flags["confirm-secrets"]) });
  if (sync.held.length) throw new CliError("SECRET_DETECTED", `Not pushed: ${sync.held.join(", ")} ${sync.held.length === 1 ? "looks" : "look"} like ${sync.held.length === 1 ? "it holds" : "they hold"} a password or key`, { hint: "Remove the key, or push with --confirm-secrets if it's safe to share" });
  if (sync.pending) throw new CliError("CONTENT_MISSING", `${plural(sync.pending, "file")} couldn't be uploaded`, { hint: `Run nb push again; nb change status ${id.slice(0, 8)} shows what's left` });
  await ctx.api.post(`/api/v1/change-sets/${enc(id)}/finish`, { ...(ctx.flags.message ? { message: ctx.flags.message } : {}), ...(ctx.flags["confirm-secrets"] ? { confirmSecrets: true } : {}) });
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(id)}/apply`, {}));
  return { changeSet: res.changeSet, applied: res.applied ?? [] };
}

/**
 * nb change split (report G16): a change set over the limits (2,000 files, 500 MB) becomes one per top-level folder,
 * each sent and finished, ready to apply one at a time. The original is discarded; your files stay as they are.
 * @param {Context} ctx
 */
export async function changeSplit(ctx) {
  const { root, project } = ctx.requireRoot();
  const id = currentChange(root);
  if (!id) throw new CliError("NOT_FOUND", "No open change set in this folder to split", { hint: "nb change status" });
  const { items } = await draftItems(root, project);
  if (!items.length) throw new CliError("USAGE", "Nothing to split: no saved changes here");
  const title = readJournal(root, id).title || "Changes";
  const MAX_FILES = 1900;
  const MAX_BYTES = 450 * 1024 * 1024;
  /** @type {Map<string, typeof items>} */
  const byFolder = new Map();
  for (const item of items) {
    const top = item.path.split("/").filter(Boolean).length > 1 ? item.path.split("/")[1] ?? "/" : "/";
    byFolder.set(top, [...(byFolder.get(top) ?? []), item]);
  }
  // A folder bigger than one change set allows goes in parts, in path order.
  /** @type {Array<{ name: string, items: typeof items }>} */
  const groups = [];
  for (const [folder, list] of [...byFolder].sort(([a], [b]) => a.localeCompare(b))) {
    let part = /** @type {typeof items} */ ([]);
    let bytes = 0;
    const name = folder === "/" ? "top level" : folder;
    for (const item of list) {
      if (part.length && (part.length >= MAX_FILES || bytes + (item.size ?? 0) > MAX_BYTES)) { groups.push({ name, items: part }); part = []; bytes = 0; }
      part.push(item);
      bytes += item.size ?? 0;
    }
    if (part.length) groups.push({ name, items: part });
  }
  const counts = new Map();
  for (const g of groups) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
  const seen = new Map();
  /** @type {Array<{ id: string, title: string, files: number, decision: string }>} */
  const made = [];
  for (const g of groups) {
    const n = (seen.get(g.name) ?? 0) + 1;
    seen.set(g.name, n);
    const partTitle = `${title} (${g.name}${counts.get(g.name) > 1 ? ` ${n}` : ""})`.slice(0, 120);
    const started = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${enc(project.workspaceId)}/change-sets`, { title: partTitle }));
    const partId = started.changeSet.id;
    writeJournal(root, { id: partId, title: partTitle, sent: {}, missing: [] });
    const sync = await syncDraft(ctx.api, root, partId, g.items, { confirmSecrets: Boolean(ctx.flags["confirm-secrets"]) });
    if (sync.pending || sync.held.length) throw new CliError("CONTENT_MISSING", `${partTitle}: ${plural(sync.pending, "file")} not uploaded yet`, { hint: `nb change status ${partId.slice(0, 8)}, then nb change finish there` });
    const finished = /** @type {any} */ (await ctx.api.post(`/api/v1/change-sets/${enc(partId)}/finish`, {}));
    made.push({ id: partId, title: partTitle, files: g.items.length, decision: finished.decision });
  }
  await ctx.api.post(`/api/v1/change-sets/${enc(id)}/discard`, {});
  setCurrentChange(root, null);
  ctx.out.result("nb.change.split/1", { from: id, changeSets: made }, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Split into ${plural(d.changeSets.length, "change set")}, each finished:`,
    ...d.changeSets.map((/** @type {any} */ s) => `  ${ctx.out.c.muted(s.id.slice(0, 8))}  ${safe(s.title)} ${ctx.out.c.muted(`· ${plural(s.files, "file")}`)}`),
    ctx.out.c.muted(`  Apply each: nb change apply <id>`),
  ]);
  return EXIT.ok;
}
