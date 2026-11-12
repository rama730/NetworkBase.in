// Classes from the terminal (report A8.4–A8.5): a student's copies (list, view, pull, hand in, ask the class) and a
// reviewer's queue (list, view, approve, return, pull). Every rule is the app's: the server runs the same Submit
// and Review. Creating assignments stays in the app (D21).
import fs from "node:fs";
import path from "node:path";

import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { hashFile } from "../sync/state.mjs";
import { downloadTo, safeJoin, uploadFiles } from "../sync/transfer.mjs";
import { confirm } from "../tui/ask.mjs";
import { formatDate } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const STATE_WORDS = /** @type {Record<string, string>} */ ({ not_started: "not started", in_progress: "in progress", submitted: "handed in", returned: "returned", done: "done", missing: "missing", excused: "excused" });
const AI_WORDS = /** @type {Record<string, string>} */ ({ allowed: "AI agents allowed", labelled: "AI agents allowed, labelled", not_allowed: "No AI agents" });
const slugOf = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "assignment";

/** @param {Context} ctx */
async function myCopies(ctx) {
  return /** @type {any[]} */ ((/** @type {any} */ (await ctx.api.get("/api/v1/assignments"))).copies);
}

/** A copy by its number, id (or the start of it), or words of its title. @param {Context} ctx @param {string | undefined} ref */
async function copyByRef(ctx, ref) {
  if (!ref) throw usage("Which assignment?", "nb assignment list shows them");
  const copies = await myCopies(ctx);
  const r = ref.replace(/^#/, "").toLowerCase();
  const hits = copies.filter((c) => String(c.number) === r || c.id.toLowerCase().startsWith(r) || c.title.toLowerCase().includes(r));
  if (hits.length !== 1) throw new CliError(hits.length ? "NEEDS_INPUT" : "NOT_FOUND", hits.length ? `${ref} matches ${hits.length} assignments` : `No assignment ${ref}`, { hint: "nb assignment list", details: { candidates: hits.map((c) => ({ id: c.id, title: c.title })) } });
  return hits[0];
}

/** @param {Context} ctx */
export async function assignmentList(ctx) {
  const wanted = ctx.flags.status ? String(ctx.flags.status).split(",").map((s) => s.trim()) : null;
  const copies = (await myCopies(ctx)).filter((c) => !wanted || wanted.includes(c.state));
  ctx.out.result("nb.assignment.list/1", { copies }, (d) => d.copies.length ? ctx.out.table([
    { title: "#", value: (c) => (c.number ? String(c.number) : "—"), align: "right" },
    { title: "Assignment", value: (c) => safe(c.title), flex: true },
    { title: "Due", value: (c) => (c.due ? formatDate(c.due) : "—") },
    { title: "State", value: (c) => `${STATE_WORDS[c.state] ?? c.state}${c.late ? " · late" : ""}` },
    { title: "From", value: (c) => safe(c.org), optional: true },
    { title: "AI", value: (c) => (c.aiPolicy === "not_allowed" ? "none" : c.aiPolicy === "labelled" ? "labelled" : "allowed"), optional: true },
  ], d.copies) : "No assignments");
}

/** @param {Context} ctx @param {string} id */
const view = async (ctx, id) => /** @type {any} */ (await ctx.api.get(`/api/v1/assignments/${encodeURIComponent(id)}`));

/** @param {Context} ctx */
export async function assignmentView(ctx) {
  const copy = await copyByRef(ctx, ctx.positionals[0]);
  const a = await view(ctx, copy.id);
  const { c } = ctx.out;
  ctx.out.result("nb.assignment.view/1", a, (d) => [
    `${c.brand(ctx.out.sym.brand)} ${c.bold(safe(d.title))}${d.number ? c.muted(` #${d.number}`) : ""}`,
    `  ${STATE_WORDS[d.state] ?? d.state}${d.late ? " · late" : ""} · due ${d.dueDate ? formatDate(d.dueDate) : "—"}${d.lateLabel ? ` · ${safe(d.lateLabel)}` : ""}`,
    `  hand in: ${d.submissionType === "none" ? "nothing (mark done)" : d.submissionType}${d.reviewRequired ? ` · reviewed by ${safe(d.reviewers)}` : ""} · from ${safe(d.from)}`,
    `  ${AI_WORDS[d.aiPolicy] ?? d.aiPolicy}${d.aiNote ? `: ${safe(d.aiNote)}` : ""}`,
    ...(d.team ? [`  team: ${safe(d.team)}`] : []),
    ...(d.returned ? ["", c.warning(`  Returned${d.returned.by ? ` by ${safe(d.returned.by)}` : ""}: ${safe(d.returned.reason ?? "")}`), ...(d.returned.fixBy ? [`  Fix by ${formatDate(d.returned.fixBy)}`] : [])] : []),
    ...(d.instructions?.trim() ? ["", ...safe(d.instructions.trim()).split("\n").map((/** @type {string} */ l) => `  ${l}`), ...(d.instructionsUpdatedAt ? [c.muted(`  (instructions updated ${formatDate(d.instructionsUpdatedAt)})`)] : [])] : []),
    ...(d.materials.length ? ["", "  Materials", ...d.materials.map((/** @type {any} */ m) => `  ${safe(m.name)}`)] : []),
    ...(d.files.length ? ["", "  Your files", ...d.files.map((/** @type {any} */ f) => `  ${safe(f.name)}`)] : []),
    ...(d.canSubmit ? ["", c.muted(`  Hand in: nb assignment hand-in ${d.number ?? copy.id.slice(0, 8)}${d.submissionType === "file" ? " <files>" : d.submissionType === "link" ? " --link <url>" : d.submissionType === "text" ? ' --text "…"' : ""}`)] : []),
  ], { page: true });
}

/**
 * Downloads files into a folder: never outside it, one plain name each.
 * @param {Context} ctx @param {string} root @param {string} dir @param {Array<{ name: string, path: string | null, projectId: string }>} files @param {boolean} readOnly
 */
async function downloadAll(ctx, root, dir, files, readOnly) {
  /** @type {string[]} */
  const got = [];
  for (const f of files) {
    const name = path.posix.basename(String(f.name).replace(/\\/g, "/"));
    if (!f.path || !name || name === "." || name === "..") continue;
    const dest = safeJoin(root, `${dir}/${name}`);
    await downloadTo(ctx.api, f.projectId, f.path, dest, null);
    if (readOnly) fs.chmodSync(dest, 0o444);
    got.push(path.relative(root, dest));
  }
  return got;
}

/** Instructions' materials and my files into .tasks/<n>-<slug>/ (report A8.4). @param {Context} ctx */
export async function assignmentPull(ctx) {
  const copy = await copyByRef(ctx, ctx.positionals[0]);
  const a = await view(ctx, copy.id);
  const root = ctx.root ?? ctx.cwd;
  const dir = `.tasks/${a.number ?? copy.id.slice(0, 8)}-${slugOf(a.title)}`;
  const got = [...await downloadAll(ctx, root, `${dir}/materials`, a.materials, true), ...await downloadAll(ctx, root, dir, a.files, false)];
  ctx.out.result("nb.assignment.pull/1", { folder: dir, files: got }, (d) => (d.files.length ? [`${ctx.out.c.success(ctx.out.sym.done)} Pulled ${d.files.length} file(s) into ${d.folder}`, ...d.files.map((/** @type {string} */ f) => `  ${f}`)] : "Nothing to pull yet"));
}

/**
 * Hand in by the assignment's submission type: files go on the copy as final first. Late hand-ins ask first, with
 * the assignment's late rule (report A8.4). @param {Context} ctx
 */
export async function assignmentHandIn(ctx) {
  const [ref, ...paths] = ctx.positionals;
  const copy = await copyByRef(ctx, ref);
  const a = await view(ctx, copy.id);
  if (!a.canSubmit) throw new CliError("CONFLICT", a.closed ? "This assignment is closed" : a.approved ? "Approved work is locked" : a.excusedReason ? "You're excused from this one" : "This can't be handed in now", { hint: `nb assignment view ${a.number ?? copy.id.slice(0, 8)}` });
  if (a.submissionType === "link" && !ctx.flags.link) throw usage("This assignment takes a link", `nb assignment hand-in ${ref} --link https://…`);
  if (a.submissionType === "text" && !ctx.flags.text) throw usage("This assignment takes a written answer", `nb assignment hand-in ${ref} --text "…"`);
  if (a.submissionType === "file" && !paths.length && !a.files.length) throw usage("This assignment takes files", `nb assignment hand-in ${ref} <files>`);
  if (a.wouldBeLate && !(await confirm(ctx, { key: "late", question: `Hand in late? ${a.lateLabel ?? "It will be marked Late."}`, yesLabel: "Hand in late", defaultYes: false }))) return EXIT.cancelled;
  if (paths.length) {
    const items = [];
    for (const p of paths) {
      const abs = path.resolve(ctx.cwd, p);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw usage(`${p} isn't a file`);
      items.push({ path: `/${path.basename(abs)}`, abs, size: fs.statSync(abs).size, hash: /** @type {string} */ (await hashFile(abs)) });
    }
    await uploadFiles(ctx.api, { workspaceId: a.projectId, items, taskId: copy.id, as: "final", message: ctx.flags.message ? String(ctx.flags.message) : null });
  }
  await ctx.api.post(`/api/v1/assignments/${encodeURIComponent(copy.id)}/hand-in`, {
    ...(ctx.flags.link ? { link: String(ctx.flags.link) } : {}), ...(ctx.flags.text ? { text: String(ctx.flags.text) } : {}), ...(ctx.flags.message ? { note: String(ctx.flags.message) } : {}),
  });
  ctx.out.result("nb.assignment.hand-in/1", { id: copy.id, files: paths.length, late: Boolean(a.wouldBeLate), reviewed: a.reviewRequired }, (d) =>
    `${ctx.out.c.success(ctx.out.sym.done)} Handed in ${safe(a.title)}${d.files ? ` with ${d.files} file${d.files === 1 ? "" : "s"}` : ""}${d.late ? " (late)" : ""}${d.reviewed ? " · waiting for review" : ""}`);
}

/**
 * Take back a hand-in before it's approved: the copy goes back to In progress so you can change it and hand in again.
 * The server applies the app's rule (approved, closed and past-due hand-ins stay). @param {Context} ctx
 */
export async function assignmentUnsubmit(ctx) {
  const [ref] = ctx.positionals;
  const copy = await copyByRef(ctx, ref);
  const a = await view(ctx, copy.id);
  if (a.approved) throw new CliError("CONFLICT", "Approved work is locked", { hint: `nb assignment view ${a.number ?? copy.id.slice(0, 8)}` });
  await ctx.api.request("DELETE", `/api/v1/assignments/${encodeURIComponent(copy.id)}/hand-in`);
  ctx.out.result("nb.assignment.unsubmit/1", { id: copy.id }, () =>
    [`${ctx.out.c.success(ctx.out.sym.done)} Took back ${safe(a.title)}: back to In progress`, ctx.out.c.muted(`  Hand it in again: nb assignment hand-in ${a.number ?? copy.id.slice(0, 8)}`)]);
}

/** @param {Context} ctx */
export async function assignmentQuestion(ctx) {
  const copy = await copyByRef(ctx, ctx.positionals[0]);
  const text = String(ctx.flags.message ?? "").trim();
  if (!text) throw usage('nb assignment question <ref> -m "your question"');
  await ctx.api.post(`/api/v1/assignments/${encodeURIComponent(copy.id)}/question`, { text });
  ctx.out.result("nb.assignment.question/1", { id: copy.id }, () => `${ctx.out.c.success(ctx.out.sym.done)} Asked the class about ${safe(copy.title)}`);
}

// ───────────────────────────────── reviewers

/** @param {Context} ctx */
async function queue(ctx) {
  const org = ctx.requireWorkspace();
  return /** @type {any} */ (await ctx.api.get("/api/v1/reviews", { query: { org, ...(ctx.flags.mine ? { mine: 1 } : {}) } })).rows.filter((/** @type {any} */ r) => r.kind === "copy");
}

/** A queue row by its place in `nb review list` or the start of its id. @param {Context} ctx @param {string | undefined} ref */
async function rowByRef(ctx, ref) {
  if (!ref) throw usage("Which hand-in?", "nb review list -w <organization>");
  const rows = await queue(ctx);
  const hit = /^\d+$/.test(ref) ? rows[Number(ref) - 1] : rows.find((/** @type {any} */ r) => r.copyId.startsWith(ref.toLowerCase()));
  if (!hit) throw new CliError("NOT_FOUND", `No hand-in ${ref} waiting for review`, { hint: "nb review list -w <organization>" });
  return hit;
}

/** @param {Context} ctx */
export async function reviewList(ctx) {
  const rows = await queue(ctx);
  ctx.out.result("nb.review.list/1", { rows }, (d) => d.rows.length ? ctx.out.table([
    { title: "#", value: (r) => String(d.rows.indexOf(r) + 1), align: "right" },
    { title: "Assignment", value: (r) => safe(r.title), flex: true },
    { title: "Who", value: (r) => safe(r.who) },
    { title: "Handed in", value: (r) => `${formatDate(r.submittedAt)}${r.late ? " · late" : ""}` },
    { title: "Version", value: (r) => (r.version ? `v${r.version}` : "—"), optional: true },
  ], d.rows) : "Nothing waiting for review");
}

/** @param {Context} ctx */
export async function reviewView(ctx) {
  const row = await rowByRef(ctx, ctx.positionals[0]);
  const a = await view(ctx, row.copyId);
  ctx.out.result("nb.review.view/1", { ...a, who: row.who }, (d) => [
    `${ctx.out.c.bold(safe(d.title))} · ${safe(d.who)}${d.late ? ctx.out.c.warning(" · late") : ""}`,
    ...(d.latest ? [`  v${d.latest.version} handed in ${formatDate(d.latest.at)} by ${safe(d.latest.by)}`, ...(d.latest.note ? [`  note: ${safe(d.latest.note)}`] : []), ...(d.latest.link ? [`  link: ${safe(d.latest.link)}`] : []), ...(d.latest.text ? ["", ...safe(d.latest.text).split("\n").map((/** @type {string} */ l) => `  ${l}`)] : []), ...d.latest.files.map((/** @type {any} */ f) => `  ${safe(f.name)}`)] : ["  Nothing handed in"]),
    `  ${AI_WORDS[d.aiPolicy] ?? d.aiPolicy}`,
    "", ctx.out.c.muted(`  nb review approve ${ctx.positionals[0]} · nb review return ${ctx.positionals[0]} -m "what to fix"`),
  ], { page: true });
}

/**
 * Approve or return one hand-in, or several at once (`nb review approve 3 5 8`, C4). Each is its own decision, so one
 * that fails (changed meanwhile) is reported and the rest still go through.
 * @param {Context} ctx @param {"approve" | "return"} decision
 */
async function decide(ctx, decision) {
  const refs = ctx.positionals.length ? ctx.positionals : [undefined];
  const reason = String(ctx.flags.message ?? "").trim();
  if (decision === "return" && !reason) throw usage('Say what to fix: nb review return <ref> -m "…"');
  // Read the queue once: numbers refer to it as listed, before any decision moves rows.
  const rows = await Promise.all(refs.map((ref) => rowByRef(ctx, /** @type {string} */ (ref))));
  /** @type {Array<{ copyId: string, who: string, title: string, ok: boolean, error?: string }>} */
  const done = [];
  for (const row of rows) {
    try {
      await ctx.api.post(`/api/v1/reviews/${encodeURIComponent(row.copyId)}`, decision === "approve" ? { decision } : { decision, reason, ...(ctx.flags["fix-by"] ? { fixBy: new Date(String(ctx.flags["fix-by"])).toISOString() } : {}) });
      done.push({ copyId: row.copyId, who: row.who, title: row.title, ok: true });
    } catch (error) {
      if (rows.length === 1) throw error;
      done.push({ copyId: row.copyId, who: row.who, title: row.title, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const verb = decision === "approve" ? "Approved" : "Returned";
  ctx.out.result(`nb.review.${decision}/1`, rows.length === 1 ? { copyId: rows[0].copyId } : { results: done }, () => done.map((r) => (r.ok ? `${ctx.out.c.success(ctx.out.sym.done)} ${verb} ${safe(r.who)}’s ${safe(r.title)}` : ctx.out.c.warning(`  ${safe(r.who)}’s ${safe(r.title)}: ${safe(r.error ?? "")}`))));
  return done.some((r) => !r.ok) ? 1 : 0;
}

/** What changed since the last hand-in (C4): files added, removed and changed between the latest two. @param {Context} ctx */
export async function reviewDiff(ctx) {
  const row = await rowByRef(ctx, ctx.positionals[0]);
  const versions = [...(row.versions ?? [])].sort((a, b) => a.version - b.version);
  const [before, after] = versions.slice(-2);
  // ponytail: hand-ins record which files, not which version of each, so changes are by size; a line diff needs the
  // hand-in to keep each file's version number.
  const files = !before || !after ? [] : [
    ...after.files.filter((/** @type {any} */ f) => !before.files.some((/** @type {any} */ b) => b.nodeId === f.nodeId)).map((/** @type {any} */ f) => ({ name: f.name, change: "added" })),
    ...before.files.filter((/** @type {any} */ b) => !after.files.some((/** @type {any} */ f) => f.nodeId === b.nodeId)).map((/** @type {any} */ b) => ({ name: b.name, change: "removed" })),
    ...after.files.filter((/** @type {any} */ f) => before.files.some((/** @type {any} */ b) => b.nodeId === f.nodeId && b.size !== f.size)).map((/** @type {any} */ f) => ({ name: f.name, change: "changed" })),
  ];
  ctx.out.result("nb.review.diff/1", { from: before?.version ?? null, to: after?.version ?? null, files }, (d) => (d.from === null
    ? `${safe(row.who)}’s ${safe(row.title)} has one hand-in so far · nb review view ${ctx.positionals[0]}`
    : [`${safe(row.who)}’s ${safe(row.title)}: v${d.from} → v${d.to}`, ...(d.files.length ? d.files.map((/** @type {any} */ f) => `  ${f.change === "added" ? ctx.out.c.success("+") : f.change === "removed" ? ctx.out.c.danger("-") : ctx.out.c.accent("~")} ${safe(f.name)} ${ctx.out.c.muted(f.change)}`) : [ctx.out.c.muted("  the same files, the same sizes")])]));
}
/** @param {Context} ctx */
export const reviewApprove = (ctx) => decide(ctx, "approve");
/** @param {Context} ctx */
export const reviewReturn = (ctx) => decide(ctx, "return");

/** The hand-in into reviews/<assignment>/<person>/, read-only (report A8.5). @param {Context} ctx */
export async function reviewPull(ctx) {
  const row = await rowByRef(ctx, ctx.positionals[0]);
  const a = await view(ctx, row.copyId);
  const root = ctx.root ?? ctx.cwd;
  const dir = `reviews/${slugOf(a.title)}/${slugOf(row.who)}`;
  const got = await downloadAll(ctx, root, dir, a.latest?.files ?? [], true);
  ctx.out.result("nb.review.pull/1", { folder: dir, files: got }, (d) => (d.files.length ? [`${ctx.out.c.success(ctx.out.sym.done)} Pulled ${d.files.length} file(s) into ${d.folder} (read-only)`, ...d.files.map((/** @type {string} */ f) => `  ${f}`)] : "No files in this hand-in"));
}
