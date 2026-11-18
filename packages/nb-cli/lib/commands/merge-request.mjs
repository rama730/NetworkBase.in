// nb merge-request (report H6, phase H-3): open, list, view, review, comment, merge, close, reopen and mark ready.
// Without a number, the commands use the open merge request of this folder's branch.

import { CliError, EXIT, needsNetwork } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { confirm } from "../tui/ask.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const enc = encodeURIComponent;
const base = (/** @type {Context} */ ctx) => `/api/v1/workspaces/${enc(ctx.requireWorkspace())}/merge-requests`;
const csv = (/** @type {unknown} */ v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const STATE = { draft: "Draft", open: "Open", approved: "Approved", changes_requested: "Changes requested", merged: "Merged", closed: "Closed" };

/** This folder's branch, following git first (like the sync commands). @param {Context} ctx */
async function folderBranch(ctx) {
  if (!ctx.root) return null;
  const { followGit } = await import("./branch.mjs");
  await followGit(ctx).catch((error) => { if (!(error instanceof CliError) || error.code !== "OFFLINE") throw error; });
  return ctx.project?.branch ?? null;
}

/** The merge request named (3, !3, #3), or this folder's branch's open one. @param {Context} ctx */
async function numberOf(ctx) {
  const given = ctx.positionals[0];
  if (given) {
    const n = Number(String(given).replace(/^[!#]/, ""));
    if (!Number.isInteger(n) || n < 1) throw new CliError("USAGE", `${given} isn't a merge request number`, { hint: "nb merge-request list shows them" });
    return n;
  }
  const branch = await folderBranch(ctx);
  if (!branch) throw new CliError("USAGE", "Which merge request?", { hint: "nb merge-request view 3, or run it in a folder on the branch" });
  const list = /** @type {any} */ (await ctx.api.get(base(ctx), { query: { state: "open" } }));
  const mine = list.mergeRequests.find((/** @type {any} */ m) => m.source.id === branch.id);
  if (!mine) throw new CliError("NOT_FOUND", `${branch.name} has no open merge request`, { hint: "nb merge-request create" });
  return mine.number;
}

const who = (/** @type {any} */ p) => (p ? (p.username ? `@${p.username}` : p.name ?? "someone") : "someone");

/** nb merge-request create: from this folder's branch (or --from) into main. @param {Context} ctx */
export async function create(ctx) {
  const source = ctx.flags.from ? String(ctx.flags.from) : (await folderBranch(ctx))?.name;
  if (!source) throw new CliError("USAGE", "This folder is on main; open a merge request from a branch", { hint: "nb merge-request create --from feature-x" });
  let taskId = null;
  if (ctx.flags.task) taskId = (await (await import("./tasks.mjs")).resolveTask(ctx, String(ctx.flags.task), { brief: true })).id;
  const res = /** @type {any} */ (await needsNetwork("Opening a merge request", ctx.api.post(base(ctx), {
    source, target: String(ctx.flags.into ?? "main"),
    ...(ctx.flags.title ? { title: String(ctx.flags.title) } : {}), ...(ctx.flags.message ? { description: String(ctx.flags.message) } : {}),
    ...(taskId ? { taskId } : {}), ...(ctx.flags.draft ? { draft: true } : {}), ...(ctx.flags.reviewer ? { reviewers: csv(ctx.flags.reviewer) } : {}),
  })));
  const m = res.mergeRequest;
  ctx.out.result("nb.merge-request.create/1", res, () => [
    `${ctx.out.c.success(ctx.out.sym.done)} Opened !${m.number} ${safe(m.title)}${m.state === "draft" ? " (draft)" : ""}`,
    ctx.out.c.muted(`  ${safe(m.source.name)} → main · ${m.reviewers.length ? `review asked of ${m.reviewers.map((/** @type {any} */ r) => who(r.person)).join(", ")}` : "no reviewers"}`),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function list(ctx) {
  // "My reviews" across every workspace (H23): --review-requested --all.
  if (ctx.flags.all) return myReviews(ctx);
  const state = ctx.flags.merged ? "merged" : ctx.flags.closed ? "closed" : "open";
  const res = /** @type {any} */ (await ctx.api.get(base(ctx), { query: { state, ...(ctx.flags["review-requested"] ? { review: "1" } : {}), ...(ctx.flags.mine ? { mine: "1" } : {}) } }));
  const { c } = ctx.out;
  ctx.out.result("nb.merge-request.list/1", res, (d) => d.mergeRequests.length
    ? ctx.out.table([
        { title: "", value: (m) => `!${m.number}` },
        { title: "Title", value: (m) => safe(m.title), flex: true },
        { title: "Branch", value: (m) => safe(m.source.name), optional: true },
        { title: "State", value: (m) => (m.state === "open" && m.changesRequested ? c.warning("Changes requested") : m.state === "open" && m.approvals ? c.success("Approved") : STATE[/** @type {keyof typeof STATE} */ (m.state)]) },
        { title: "", value: (m) => (m.reviewRequested ? c.brand("your review") : "") },
      ], d.mergeRequests)
    : state === "open" ? "No open merge requests" : `No ${state} merge requests`);
  return EXIT.ok;
}

/** Open merge requests waiting on your review in all your workspaces (H23 "My reviews"). @param {Context} ctx */
async function myReviews(ctx) {
  const res = /** @type {any} */ (await ctx.api.get("/api/v1/me/reviews"));
  ctx.out.result("nb.merge-request.reviews/1", res, (d) => d.reviews.length
    ? ctx.out.table([
        { title: "Workspace", value: (r) => safe(r.workspace.slug ?? r.workspace.title) },
        { title: "", value: (r) => `!${r.number}` },
        { title: "Title", value: (r) => safe(r.title), flex: true },
        { title: "Branch", value: (r) => safe(r.source), optional: true },
      ], d.reviews)
    : "Nothing is waiting on your review");
  return EXIT.ok;
}

/** @param {Context} ctx */
export async function view(ctx) {
  const n = await numberOf(ctx);
  const d = /** @type {any} */ (await ctx.api.get(`${base(ctx)}/${n}`));
  const m = d.mergeRequest;
  const { c } = ctx.out;
  const check = (/** @type {any} */ k) => `${k.state === "passed" ? c.success("✓") : k.state === "failed" ? c.danger("✗") : c.muted("…")} ${safe(k.name)}${k.url ? c.muted(` ${safe(k.url)}`) : ""}`;
  ctx.out.result("nb.merge-request.view/1", d, () => [
    `!${m.number} ${c.bold(safe(m.title))}  ${STATE[/** @type {keyof typeof STATE} */ (m.shownState)] ?? m.shownState}`,
    c.muted(`${safe(m.source.name)} → main · by ${who(m.author)}${m.madeWith ? ` ${m.madeWith}` : ""}${m.task ? ` · task #${m.task.number}` : ""}`),
    ...(m.description ? ["", ...safe(m.description).split("\n").map((/** @type {string} */ l) => `  ${l}`)] : []),
    "",
    `Reviewers: ${m.reviewers.length ? m.reviewers.map((/** @type {any} */ r) => `${who(r.person)} ${c.muted(r.state.replace("_", " "))}${r.earlierSave ? c.muted(" (an earlier save)") : ""}`).join(", ") : c.muted("none")}`,
    ...(m.checks.length ? [`Checks: ${m.checks.map(check).join("  ")}`] : []),
    ...(m.state === "open" || m.state === "draft"
      ? [m.bothChanged.length ? c.warning(`Main changed ${m.bothChanged.length} of these files too; it may not merge: nb branch update ${safe(m.source.name)}`) : m.behind ? c.muted(`${m.behind} save(s) behind main; merges cleanly so far`) : c.muted("Up to date with main")]
      : m.merged ? [c.success(`Merged (${m.merged.method}) by ${who(m.merged.by)}`)] : []),
    "",
    `Saves (${d.saves.length}${d.moreSaves ? "+" : ""}):`,
    ...d.saves.slice(0, 10).map((/** @type {any} */ s) => `  ${String(s.number).padStart(3)}  ${safe(s.message)} ${c.muted(who(s.author))}`),
    ...(d.files ? ["", `Files changed (${d.files.files.length}):`, ...d.files.files.slice(0, 30).map((/** @type {any} */ f) => `  ${f.op.padEnd(7)} ${safe(f.path)}`)] : []),
    ...(d.comments.length ? ["", `Comments (${d.comments.length}):`, ...d.comments.slice(-10).map((/** @type {any} */ x) => `  ${who(x.author)}${x.reviewState && x.reviewState !== "commented" ? c.muted(` ${x.reviewState.replace("_", " ")}`) : ""}${x.path ? c.muted(` ${safe(x.path)}:${x.line}`) : ""}: ${safe(x.body).split("\n")[0]}${x.suggestion != null ? c.muted(` [suggestion${x.appliedSaveId ? ", applied" : ""} ${x.id.slice(0, 8)}]`) : ""}`)] : []),
  ]);
  return EXIT.ok;
}

/** nb merge-request review <n> --approve | --request-changes -m | --comment -m @param {Context} ctx */
export async function review(ctx) {
  const state = ctx.flags.approve ? "approve" : ctx.flags["request-changes"] ? "request_changes" : ctx.flags.comment ? "comment" : null;
  if (!state) throw new CliError("USAGE", "Approve, request changes or comment", { hint: "nb merge-request review 3 --approve, or --request-changes -m \"…\"" });
  const n = await numberOf(ctx);
  const res = /** @type {any} */ (await ctx.api.post(`${base(ctx)}/${n}/reviews`, { state, ...(ctx.flags.message ? { body: String(ctx.flags.message) } : {}) }));
  ctx.out.result("nb.merge-request.review/1", res, () => `${ctx.out.c.success(ctx.out.sym.done)} ${state === "approve" ? "Approved" : state === "request_changes" ? "Asked for changes on" : "Commented on"} !${n}`);
  return EXIT.ok;
}

/** nb merge-request comment <n> -m text [--file p --line 3[-5]] [--suggest text] @param {Context} ctx */
export async function comment(ctx) {
  const n = await numberOf(ctx);
  const [line, endLine] = String(ctx.flags.line ?? "").split("-").map((x) => (x ? Number(x) : null));
  if (ctx.flags.line && (!ctx.flags.file || !line)) throw new CliError("USAGE", "A line comment needs --file and --line", { hint: "nb merge-request comment 3 --file src/a.ts --line 12 -m \"…\"" });
  if (ctx.flags.suggest != null && !ctx.flags.line) throw new CliError("USAGE", "A suggestion replaces lines: add --file and --line", { hint: "nb merge-request comment 3 --file src/a.ts --line 12 --suggest \"new line\"" });
  const res = /** @type {any} */ (await ctx.api.post(`${base(ctx)}/${n}/comments`, {
    body: String(ctx.flags.message ?? ""), ...(ctx.flags.file ? { path: String(ctx.flags.file) } : {}), ...(line ? { line, endLine: endLine ?? line } : {}),
    ...(ctx.flags.suggest != null ? { suggestion: String(ctx.flags.suggest) } : {}),
  }));
  const id = res?.comment?.id ? String(res.comment.id).slice(0, 8) : null;
  ctx.out.result("nb.merge-request.comment/1", res, () => [
    `${ctx.out.c.success(ctx.out.sym.done)} ${ctx.flags.suggest != null ? "Suggested an edit on" : "Commented on"} !${n}`,
    ...(ctx.flags.suggest != null && id ? [ctx.out.c.muted(`  The branch's author applies it with: nb merge-request apply ${n} ${id}`)] : []),
  ]);
  return EXIT.ok;
}

/** nb merge-request apply <n> <comment>: applies a suggested edit as a save on the branch. @param {Context} ctx */
export async function applySuggestion(ctx) {
  const [ref, commentRef] = ctx.positionals;
  if (!ref || !commentRef) throw new CliError("USAGE", "nb merge-request apply <n> <comment id>", { hint: "nb merge-request view <n> shows suggestions with their ids" });
  ctx.positionals = [ref];
  const n = await numberOf(ctx);
  const d = /** @type {any} */ (await ctx.api.get(`${base(ctx)}/${n}`));
  const hit = d.comments.find((/** @type {any} */ x) => x.id === commentRef || x.id.startsWith(commentRef));
  if (!hit) throw new CliError("NOT_FOUND", `No comment ${commentRef} on !${n}`);
  const res = /** @type {any} */ (await ctx.api.post(`${base(ctx)}/${n}/suggestions`, { commentId: hit.id }));
  ctx.out.result("nb.merge-request.apply/1", res, () => [`${ctx.out.c.success(ctx.out.sym.done)} Applied the suggestion on ${safe(d.mergeRequest.source.name)}`, ctx.out.c.muted("  nb pull brings it into a folder on the branch")]);
  return EXIT.ok;
}

/** nb merge-request merge <n> [--squash]: into main, all at once, one undo. @param {Context} ctx */
export async function merge(ctx) {
  const n = await numberOf(ctx);
  const method = ctx.flags.squash ? "squash" : "merge";
  const ok = await confirm(ctx, { key: "merge", question: `${method === "squash" ? "Squash and merge" : "Merge"} !${n} into main?`, yesLabel: "Merge", defaultYes: true });
  if (!ok) return EXIT.cancelled;
  const res = /** @type {any} */ (await needsNetwork("Merging", ctx.api.post(`${base(ctx)}/${n}/merge`, { method, ...(ctx.flags.confirm ? { confirmToken: String(ctx.flags.confirm) } : {}), ...(ctx.flags["confirm-secrets"] ? { confirmSecrets: true } : {}) })));
  const { c } = ctx.out;
  if (res.outcome === "conflicts") {
    ctx.out.result("nb.merge-request.merge/1", res, () => [
      `${c.warning(ctx.out.sym.warn)} Can't merge yet: ${res.conflicts.length} file(s) changed on both the branch and main`,
      ...res.conflicts.map((/** @type {any} */ x) => `  ${safe(x.path)} ${c.muted(String(x.kind).replace(/_/g, " "))}`),
      c.muted("  Settle them on the branch: nb branch update (then merge again)"),
    ]);
    return EXIT.conflict;
  }
  // A folder on the branch that just merged goes back to main, keeping any edits (M9 walkthrough: it stopped with
  // "was merged into main" on the next command).
  let backOnMain = false;
  if (!res.branchMoved && ctx.root && ctx.project?.branch?.id && ctx.project.branch.id === res.branch?.id) {
    const { switchTo } = await import("./branch.mjs");
    await switchTo(ctx, { isDefault: true, name: "main" }, { carry: true });
    backOnMain = true;
  }
  ctx.out.result("nb.merge-request.merge/1", { ...res, backOnMain }, () => [
    `${c.success(ctx.out.sym.done)} Merged !${n} into main${res.save ? ` (save ${res.save.number})` : ""}${backOnMain ? "; this folder is on main again" : ""}`,
    ...(res.task && res.task.outcome !== "unchanged" ? [c.muted(`  Task #${res.task.number} ${res.task.outcome === "review" ? "went for review" : "is done"}`)] : []),
    res.branchMoved
      ? c.warning(`  Saves reached ${safe(res.branch.name)} while it merged; they aren't in main yet: open another merge request`)
      : c.muted(`  Undo: nb revert ${res.save?.number ?? ""} · delete the branch: nb branch delete ${safe(res.branch.name)}`),
  ]);
  return EXIT.ok;
}

/** @param {Context} ctx @param {Record<string, unknown>} patch @param {string} said */
async function patchMr(ctx, patch, said) {
  const n = await numberOf(ctx);
  const res = /** @type {any} */ (await ctx.api.patch(`${base(ctx)}/${n}`, patch));
  ctx.out.result("nb.merge-request.update/1", res, () => `${ctx.out.c.success(ctx.out.sym.done)} ${said} !${n}`);
  return EXIT.ok;
}
/** @param {Context} ctx */
export const close = (ctx) => patchMr(ctx, { state: "closed" }, "Closed");
/** @param {Context} ctx */
export const reopen = (ctx) => patchMr(ctx, { state: "open" }, "Reopened");
/** @param {Context} ctx */
export const ready = (ctx) => patchMr(ctx, { draft: false }, "Marked ready");
