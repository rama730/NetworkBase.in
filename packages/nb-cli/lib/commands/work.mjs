// task edit|assign|delete|report, subtask edit|delete|move, comment list|resolve and line comments (report §17.4,
// §17.4.1, D10). Changes go through the same server rules as the app; agents' big ones wait for a yes there.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { confirm } from "../tui/ask.mjs";
import { resolveTask, taskRef } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx @param {Record<string, unknown>} body */
const update = (ctx, body) => ctx.api.patch("/api/v1/extension/task-update", { projectId: ctx.requireWorkspace(), ...body });

/** @param {Context} ctx */
export async function taskEdit(ctx) {
  const task = await resolveTask(ctx, taskRef(ctx, ctx.positionals[0]));
  /** @type {Array<[string, string | null]>} */
  const changes = [];
  if (ctx.flags.title) changes.push(["title", String(ctx.flags.title)]);
  if (ctx.flags.message !== undefined) changes.push(["description", String(ctx.flags.message)]);
  if (ctx.flags.priority) {
    if (!["low", "medium", "high", "urgent"].includes(ctx.flags.priority)) throw usage("--priority must be low, medium, high or urgent");
    changes.push(["priority", ctx.flags.priority]);
  }
  if (ctx.flags.due) {
    const due = String(ctx.flags.due);
    if (due !== "none" && Number.isNaN(Date.parse(due))) throw usage("--due takes a date like 2026-11-14, or none");
    changes.push(["dueDate", due === "none" ? null : new Date(due).toISOString()]);
  }
  if (!changes.length) throw usage("nb task edit <task> [--title text] [-m description] [--priority high] [--due 2026-11-14|none]");
  for (const [field, value] of changes) await update(ctx, { kind: "edit", taskId: task.id, field, value });
  ctx.out.result("nb.task.edit/1", { number: task.taskNumber, changed: changes.map(([f]) => f) }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Changed ${d.changed.join(", ")} on #${d.number}`);
}

/** @param {Context} ctx */
export async function taskAssign(ctx) {
  const [ref, who] = ctx.positionals;
  if (!ref || !who) throw usage("nb task assign <task> <@username|me|none>");
  const task = await resolveTask(ctx, ref);
  let assigneeId = null;
  if (who === "me") assigneeId = /** @type {any} */ (await ctx.api.get("/api/v1/me")).user.id;
  else if (who !== "none") {
    const name = who.replace(/^@/, "").toLowerCase();
    const { members } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/members`, { query: { q: name } }));
    const hit = members.find((/** @type {any} */ m) => String(m.username ?? "").toLowerCase() === name);
    if (!hit) throw new CliError("NOT_FOUND", `No member @${name} in this workspace`, { hint: "nb member list" });
    assigneeId = hit.id;
  }
  await update(ctx, { kind: "assign", taskId: task.id, assigneeId });
  ctx.out.result("nb.task.assign/1", { number: task.taskNumber, assignee: who === "none" ? null : who.replace(/^@/, "") }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} #${d.number} ${d.assignee ? `is assigned to ${d.assignee === "me" ? "you" : `@${safe(d.assignee)}`}` : "is unassigned"}`);
}

/** @param {Context} ctx */
export async function taskDelete(ctx) {
  const task = await resolveTask(ctx, taskRef(ctx, ctx.positionals[0]));
  if (!(await confirm(ctx, { key: "delete", heldByServer: true, question: `Delete #${task.taskNumber} ${task.title}? Its draft files move to a recovery folder.`, yesLabel: "Delete", defaultYes: false }))) return EXIT.cancelled;
  await update(ctx, { kind: "delete", taskId: task.id });
  ctx.out.result("nb.task.delete/1", { number: task.taskNumber }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Deleted #${d.number}`);
}

/** A report without finishing (report §18.2 "task_report"): what was done and the checks, as a comment. @param {Context} ctx */
export async function taskReport(ctx) {
  const task = await resolveTask(ctx, taskRef(ctx, ctx.positionals[0]));
  const summary = String(ctx.flags.message ?? "").trim();
  if (!summary) throw usage('nb task report <task> -m "what was done" [--check "npm test=pass"]');
  const checks = /** @type {string[]} */ (ctx.flags.check ?? []).map((c) => {
    const [name, rest = "pass"] = c.split("=");
    const [result, note] = rest.split(":");
    return `- ${result === "fail" ? "✗" : "✓"} ${name}${note ? ` — ${note}` : ""}`;
  });
  const text = [`**Report** ${summary}`, ...(checks.length ? ["", ...checks] : [])].join("\n");
  await ctx.api.post("/api/v1/extension/comments", { kind: "task", projectId: ctx.requireWorkspace(), taskId: task.id, text });
  ctx.out.result("nb.task.report/1", { number: task.taskNumber, checks: checks.length }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Reported on #${d.number}${d.checks ? ` with ${d.checks} check${d.checks === 1 ? "" : "s"}` : ""}`);
}

/** @param {Context} ctx @param {string} n */
async function subtaskByNumber(ctx, n) {
  const task = await resolveTask(ctx, taskRef(ctx, undefined));
  const list = task.subtasks.map((/** @type {any} */ s, /** @type {number} */ i) => ({ ...s, n: s.index ?? i + 1 }));
  const hit = list.find((/** @type {any} */ s) => String(s.n) === n.replace("#", "") || s.id === n);
  if (!hit) throw usage(`#${task.taskNumber} has no subtask ${n}`, `nb subtask list --task ${task.taskNumber}`);
  return { task, subtask: hit, count: list.length };
}

/** @param {Context} ctx */
export async function subtaskEdit(ctx) {
  const [n, ...words] = ctx.positionals;
  if (!n || !words.length) throw usage('nb subtask edit <n> "<new title>" [--task 4]');
  const { task, subtask } = await subtaskByNumber(ctx, n);
  await update(ctx, { kind: "subtask_edit", taskId: task.id, subtaskId: subtask.id, title: words.join(" ") });
  ctx.out.result("nb.subtask.edit/1", { number: task.taskNumber, n: subtask.n }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Renamed subtask ${d.n} on #${d.number}`);
}

/** @param {Context} ctx */
export async function subtaskDelete(ctx) {
  const n = ctx.positionals[0];
  if (!n) throw usage("nb subtask delete <n> [--task 4]");
  const { task, subtask } = await subtaskByNumber(ctx, n);
  if (!(await confirm(ctx, { key: "delete", question: `Delete subtask ${subtask.n} "${subtask.title}" on #${task.taskNumber}?`, yesLabel: "Delete", defaultYes: false }))) return EXIT.cancelled;
  await update(ctx, { kind: "subtask_delete", taskId: task.id, subtaskId: subtask.id });
  ctx.out.result("nb.subtask.delete/1", { number: task.taskNumber, n: subtask.n }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Deleted subtask ${d.n} on #${d.number}`);
}

/** @param {Context} ctx */
export async function subtaskMove(ctx) {
  const [n, to] = ctx.positionals;
  if (!n || !to || !/^\d+$/.test(to)) throw usage("nb subtask move <n> <new position, 1 = first> [--task 4]");
  const { task, subtask, count } = await subtaskByNumber(ctx, n);
  const position = Math.min(Math.max(Number(to), 1), count) - 1;
  await update(ctx, { kind: "subtask_move", taskId: task.id, subtaskId: subtask.id, position });
  ctx.out.result("nb.subtask.move/1", { number: task.taskNumber, from: subtask.n, to: position + 1 }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Subtask ${d.from} is now ${d.to} on #${d.number}`);
}

/** "src/app.ts:12" or "src/app.ts:12-18" → path and lines. @param {string} spec */
function fileSpec(spec) {
  const m = /^(.*?):(\d+)(?:-(\d+))?$/.exec(spec);
  return m ? { path: `/${String(m[1]).replace(/^\/+/, "")}`, start: Number(m[2]), end: Number(m[3] ?? m[2]) } : { path: `/${spec.replace(/^\/+/, "")}`, start: null, end: null };
}

/** @param {Context} ctx @param {string} remotePath */
async function fileNode(ctx, remotePath) {
  const meta = /** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId: ctx.requireWorkspace(), path: remotePath, transfer: "metadata" } }).catch((error) => {
    if (error instanceof CliError && error.status === 404) throw new CliError("NOT_FOUND", `No file ${remotePath} in this workspace`);
    throw error;
  }));
  return meta;
}

/** @param {Context} ctx @param {string} nodeId */
async function fileThreads(ctx, nodeId) {
  const { events } = /** @type {any} */ (await ctx.api.get("/api/v1/extension/comments", { query: { projectId: ctx.requireWorkspace(), nodeId } }));
  /** @type {Map<string, any>} */
  const threads = new Map();
  for (const e of events) {
    const m = e.metadata ?? {};
    const id = m.threadId ?? e.id;
    const t = threads.get(id) ?? { id, anchor: null, comments: [], resolved: false, sequence: 0 };
    if (m.anchor) t.anchor = m.anchor;
    if (typeof m.text === "string") t.comments.push({ by: e.name ?? null, text: m.text, at: e.createdAt });
    if (typeof m.resolved === "boolean") t.resolved = m.resolved;
    t.sequence = Math.max(t.sequence, Number(e.sequence ?? 0));
    threads.set(id, t);
  }
  return [...threads.values()];
}

/** @param {Context} ctx */
export async function commentList(ctx) {
  if (ctx.flags.file) {
    const spec = fileSpec(String(ctx.flags.file));
    const node = await fileNode(ctx, spec.path);
    const threads = await fileThreads(ctx, node.nodeId ?? node.id);
    return ctx.out.result("nb.comment.list/1", { path: spec.path, threads }, (d) =>
      d.threads.length ? d.threads.flatMap((t) => [`${t.resolved ? ctx.out.c.muted("resolved") : ctx.out.c.accent("open")} ${safe(d.path)}${t.anchor ? `:${t.anchor.startLine}${t.anchor.endLine !== t.anchor.startLine ? `-${t.anchor.endLine}` : ""}` : ""}  ${ctx.out.c.muted(String(t.id).slice(0, 8))}`, ...t.comments.map((/** @type {any} */ c) => `  ${c.by ? `${safe(c.by)}: ` : ""}${safe(c.text)}`)]) : `No comments on ${safe(d.path)}`);
  }
  const task = await resolveTask(ctx, taskRef(ctx, undefined));
  const comments = task.comments.map((/** @type {any} */ c) => ({ id: c.id, by: c.authorUsername ?? c.authorName ?? null, text: c.content, at: c.createdAt }));
  ctx.out.result("nb.comment.list/1", { number: task.taskNumber, comments, untrusted: true }, (d) =>
    d.comments.length ? d.comments.map((/** @type {any} */ c) => `  ${ctx.out.c.muted(String(c.at).slice(0, 16).replace("T", " "))} ${c.by ? `@${safe(c.by)}` : "someone"}: ${safe(c.text).replace(/\n/g, " ")}`) : `#${d.number} has no comments`);
}

/** A comment on lines of a file (report D10): `nb comment add -m "…" --file src/app.ts:12-18`. @param {Context} ctx */
export async function commentOnFile(ctx) {
  const spec = fileSpec(String(ctx.flags.file));
  if (spec.start === null) throw usage("Say which lines: --file src/app.ts:12 or src/app.ts:12-18");
  const text = String(ctx.flags.message ?? ctx.positionals.join(" ")).trim();
  if (!text) throw usage('nb comment add -m "<text>" --file <path>:<line>');
  const node = await fileNode(ctx, spec.path);
  const local = ctx.root ? path.join(ctx.root, spec.path.slice(1)) : null;
  const hash = node.contentHash ?? (local && fs.existsSync(local) ? crypto.createHash("sha256").update(fs.readFileSync(local)).digest("hex") : null);
  if (!hash) throw new CliError("NOT_FOUND", "Couldn't tell which version of the file the lines are in", { hint: "nb pull, then try again" });
  await ctx.api.post("/api/v1/extension/comments", { kind: "create", projectId: ctx.requireWorkspace(), nodeId: node.nodeId ?? node.id, text, anchor: { version: node.currentVersion, hash, startLine: spec.start, endLine: spec.end } });
  ctx.out.result("nb.comment.add/1", { path: spec.path, lines: [spec.start, spec.end] }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Commented on ${safe(d.path)}:${d.lines[0]}${d.lines[1] !== d.lines[0] ? `-${d.lines[1]}` : ""}`);
}

/** @param {Context} ctx */
export async function commentResolve(ctx) {
  const id = ctx.positionals[0];
  if (!id || !ctx.flags.file) throw usage("nb comment resolve <thread id> --file <path> [--reopen]");
  const spec = fileSpec(String(ctx.flags.file));
  const node = await fileNode(ctx, spec.path);
  const thread = (await fileThreads(ctx, node.nodeId ?? node.id)).find((t) => String(t.id).startsWith(id));
  if (!thread) throw new CliError("NOT_FOUND", `No comment thread ${id} on ${spec.path}`, { hint: `nb comment list --file ${spec.path.slice(1)}` });
  const resolved = !ctx.flags.reopen;
  await ctx.api.post("/api/v1/extension/comments", { kind: "resolve", projectId: ctx.requireWorkspace(), nodeId: node.nodeId ?? node.id, threadId: thread.id, expectedSequence: thread.sequence, resolved });
  ctx.out.result("nb.comment.resolve/1", { thread: thread.id, resolved }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${d.resolved ? "Resolved" : "Reopened"} the thread`);
}
