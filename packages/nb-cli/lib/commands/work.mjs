// task edit|assign|delete|report, subtask edit|delete|move, comment list|resolve and line comments (report §17.4,
// §17.4.1, D10). Changes go through the same server rules as the app; agents' big ones wait for a yes there.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { CliError, EXIT, usage } from "../errors.mjs";
import { commentText, safe } from "../print/style.mjs";
import { confirm } from "../tui/ask.mjs";
import { parseDate } from "../dates.mjs";
import { bulkChange, formatWhen, resolveTask, taskRef } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx @param {Record<string, unknown>} body */
const update = (ctx, body) => ctx.api.patch("/api/v1/extension/task-update", { projectId: ctx.requireWorkspace(), ...body });

/** @param {Context} ctx */
export async function taskEdit(ctx) {
  /** @type {Array<[string, string | null]>} */
  const changes = [];
  if (ctx.flags.title) changes.push(["title", String(ctx.flags.title)]);
  if (ctx.flags.message !== undefined) changes.push(["description", String(ctx.flags.message)]);
  if (ctx.flags.priority) {
    if (!["low", "medium", "high", "urgent"].includes(ctx.flags.priority)) throw usage("--priority must be low, medium, high or urgent");
    changes.push(["priority", ctx.flags.priority]);
  }
  if (ctx.flags.due) {
    // Natural dates everywhere a date is taken (C2): friday, next week, in 3 days, 2026-12-01.
    const due = String(ctx.flags.due);
    const date = due === "none" ? null : parseDate(due);
    if (due !== "none" && !date) throw usage(`--due ${due} isn't a date I know`, "Use today, tomorrow, friday, next week, in 3 days, 2026-12-01, or none");
    changes.push(["dueDate", date]);
  }
  // Labels, "blocked by" and links (C2, C12, 0087) go to the task's meta route.
  const list = (/** @type {unknown} */ v) => (v === undefined ? [] : /** @type {string[]} */ ([v].flat()).flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean));
  const labelAdd = list(ctx.flags.label).map((l) => l.toLowerCase()), labelRemove = list(ctx.flags.unlabel).map((l) => l.toLowerCase()), blockAdd = list(ctx.flags["blocked-by"]), blockRemove = list(ctx.flags["not-blocked-by"]), linkAdd = list(ctx.flags.link);
  const metaWanted = labelAdd.length || labelRemove.length || blockAdd.length || blockRemove.length || linkAdd.length;
  // Report 38.5 W12 (A1.5): --part-of 40 puts it in project #40; --part-of none takes it out.
  const partOf = ctx.flags["part-of"] === undefined ? undefined : String(ctx.flags["part-of"]);
  if (partOf !== undefined) {
    if (ctx.positionals.length > 1) throw usage("--part-of changes one task at a time");
    const task = await resolveTask(ctx, taskRef(ctx, ctx.positionals[0]), { brief: true });
    const project = partOf === "none" ? null : await resolveTask(ctx, partOf, { brief: true });
    await update(ctx, { kind: "part_of", taskId: task.id, partOfId: project?.id ?? null });
    for (const [field, value] of changes) await update(ctx, { kind: "edit", taskId: task.id, field, value });
    return ctx.out.result("nb.task.edit/1", { number: task.taskNumber, changed: [...changes.map(([f]) => f), "partOf"], partOf: project?.taskNumber ?? null }, (d) =>
      `${ctx.out.c.success(ctx.out.sym.done)} ${d.partOf ? `#${d.number} is now Part of #${d.partOf}` : `#${d.number} is out of its project`}`);
  }
  if (!changes.length && !metaWanted) throw usage("nb task edit <task…> [--title text] [-m description] [--priority high] [--due friday|none] [--label bug] [--blocked-by 7] [--link url] [--part-of 40|none]");
  if (metaWanted) {
    if (ctx.positionals.length > 1) throw usage("Labels, blocked-by and links change one task at a time");
    const task = await resolveTask(ctx, taskRef(ctx, ctx.positionals[0]), { brief: true });
    const ids = async (/** @type {string[]} */ refs) => Promise.all(refs.map(async (r) => (await resolveTask(ctx, r, { brief: true })).id));
    const meta = /** @type {any} */ (await ctx.api.patch(`/api/v1/tasks/${task.id}/meta`, {
      ...(labelAdd.length || labelRemove.length ? { labels: { ...(labelAdd.length ? { add: labelAdd } : {}), ...(labelRemove.length ? { remove: labelRemove } : {}) } } : {}),
      ...(blockAdd.length || blockRemove.length ? { blockedBy: { ...(blockAdd.length ? { add: await ids(blockAdd) } : {}), ...(blockRemove.length ? { remove: await ids(blockRemove) } : {}) } } : {}),
      ...(linkAdd.length ? { links: { add: linkAdd.map((url) => ({ url })) } } : {}),
    }));
    for (const [field, value] of changes) await update(ctx, { kind: "edit", taskId: task.id, field, value });
    return ctx.out.result("nb.task.edit/1", { number: task.taskNumber, changed: changes.map(([f]) => f), labels: meta.labels, blockedBy: meta.blockedBy.map((/** @type {any} */ t) => t.number), links: meta.links }, (d) => [
      `${ctx.out.c.success(ctx.out.sym.done)} Changed #${d.number}${d.changed.length ? `: ${d.changed.join(", ")}` : ""}`,
      ...(d.labels.length ? [`  labels ${d.labels.map((/** @type {string} */ l) => `[${safe(l)}]`).join(" ")}`] : []),
      ...(d.blockedBy.length ? [`  waiting on ${d.blockedBy.map((/** @type {number} */ n) => `#${n}`).join(", ")}`] : []),
      ...(d.links.length ? [`  links ${d.links.map((/** @type {any} */ l) => safe(l.title ?? l.url)).join(", ")}`] : []),
    ]);
  }
  if (ctx.positionals.length > 1) {
    if (changes.some(([f]) => f === "title" || f === "description")) throw usage("Several tasks take --priority and --due; change a title one task at a time");
    let numbers = [];
    for (const [field, value] of changes) numbers = (await bulkChange(ctx, ctx.positionals, { kind: "edit", field, value })).tasks.map((/** @type {any} */ t) => t.number);
    ctx.out.result("nb.task.edit/1", { numbers, changed: changes.map(([f]) => f) }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Changed ${d.changed.join(", ")} on ${d.numbers.map((/** @type {number} */ n) => `#${n}`).join(", ")}`);
    return;
  }
  const task = await resolveTask(ctx, taskRef(ctx, ctx.positionals[0]));
  for (const [field, value] of changes) await update(ctx, { kind: "edit", taskId: task.id, field, value });
  ctx.out.result("nb.task.edit/1", { number: task.taskNumber, changed: changes.map(([f]) => f) }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Changed ${d.changed.join(", ")} on #${d.number}`);
}

/** A person for --to and task assign: @username, me, or none (null). @param {Context} ctx @param {string} who */
export async function resolvePerson(ctx, who) {
  if (who === "none") return null;
  if (who === "me") return /** @type {any} */ (await ctx.api.get("/api/v1/me")).user.id;
  const name = who.replace(/^@/, "").trim().toLowerCase();
  const { members } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/members`, { query: { q: name } }));
  // A username, then a full name, then the only member whose name holds every word (report D2). Several: ask which.
  const words = name.split(/\s+/).filter(Boolean);
  const text = (/** @type {any} */ m) => `${m.username ?? ""} ${m.fullName ?? ""}`.toLowerCase();
  const hit = members.find((/** @type {any} */ m) => String(m.username ?? "").toLowerCase() === name)
    ?? members.find((/** @type {any} */ m) => String(m.fullName ?? "").toLowerCase() === name);
  if (hit) return hit.id;
  const fits = members.filter((/** @type {any} */ m) => m.username && words.every((w) => text(m).includes(w)));
  if (fits.length === 1) return fits[0].id;
  if (!fits.length) throw new CliError("NOT_FOUND", `No member @${name} in this workspace`, { hint: "nb member list" });
  const { ask } = await import("../tui/ask.mjs");
  const picked = await ask(ctx, { key: "person", header: "Who", question: `Which member did you mean by "${who}"?`, options: fits.slice(0, 4).map((/** @type {any} */ m) => ({ value: `@${m.username}`, label: safe(m.fullName ?? m.username), description: `@${m.username}` })) });
  return resolvePerson(ctx, picked);
}

/**
 * A picker when the person is left out (C2): in a terminal, choose; scripts and agents get exit 6 with the choices.
 * @param {Context} ctx @returns {Promise<string>}
 */
async function pickPerson(ctx) {
  const { members } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/members`));
  const { ask } = await import("../tui/ask.mjs");
  const meId = ctx.profile?.user?.id ?? (/** @type {any} */ (await ctx.api.get("/api/v1/me").catch(() => null)))?.user?.id ?? null;
  return ask(ctx, { key: "person", header: "Assign to", question: "Who should do it?", options: [
    { value: "me", label: "Me", recommended: true },
    // You are "Me" already, so your own name isn't listed again (T16 live test).
    ...members.filter((/** @type {any} */ m) => m.username && m.id !== meId).slice(0, 7).map((/** @type {any} */ m) => ({ value: `@${m.username}`, label: safe(m.fullName ?? m.username), description: `@${m.username}` })),
    { value: "none", label: "Nobody" },
  ] });
}

/** Watching and starring are your own (C2, 0087): `nb task watch 4`, `nb task star 4`, and `--off`. @param {Context} ctx @param {"watch" | "star"} what */
async function personal(ctx, what) {
  const task = await resolveTask(ctx, taskRef(ctx, ctx.positionals[0]), { brief: true });
  const on = !ctx.flags.off;
  await ctx.api.patch(`/api/v1/tasks/${task.id}/meta`, { [what]: on });
  ctx.out.result(`nb.task.${what}/1`, { number: task.taskNumber, [what === "watch" ? "watching" : "starred"]: on }, () =>
    `${ctx.out.c.success(ctx.out.sym.done)} ${what === "watch" ? (on ? `Watching #${task.taskNumber}: you'll hear when it changes` : `Stopped watching #${task.taskNumber}`) : on ? `Starred #${task.taskNumber} · nb task list --starred` : `Unstarred #${task.taskNumber}`}`);
}
/**
 * `nb task remind 4 "tomorrow 9am" [-m note]` (C2, 0088): your own reminder, delivered to your inbox (and push or
 * email as your settings say). `--list` shows yours on the task; `--off` cancels them.
 * @param {Context} ctx
 */
export async function taskRemind(ctx) {
  const [ref, ...words] = ctx.positionals;
  if (!ref) throw usage('nb task remind <task> "tomorrow 9am" [-m note]', "Or --list to see yours, --off to cancel them");
  const task = await resolveTask(ctx, ref, { brief: true });
  const path = `/api/v1/tasks/${task.id}/reminders`;
  if (ctx.flags.off) {
    const { cancelled } = /** @type {any} */ (await ctx.api.request("DELETE", path));
    return ctx.out.result("nb.task.remind/1", { number: task.taskNumber, cancelled }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Cancelled ${d.cancelled} reminder${d.cancelled === 1 ? "" : "s"} on #${d.number}`);
  }
  if (ctx.flags.list || !words.length) {
    const { reminders } = /** @type {any} */ (await ctx.api.get(path));
    return ctx.out.result("nb.task.reminders/1", { number: task.taskNumber, reminders }, (d) => (d.reminders.length
      ? d.reminders.map((/** @type {any} */ r) => `  ${new Date(r.remindAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}${r.note ? `  ${ctx.out.c.muted(safe(r.note))}` : ""}`)
      : `No reminders on #${d.number} · nb task remind ${d.number} "tomorrow 9am"`));
  }
  const { parseWhen } = await import("../dates.mjs");
  const at = parseWhen(words.join(" "));
  if (!at) throw usage(`"${words.join(" ")}" isn't a time I know`, 'Try: "tomorrow 9am", "friday 14:30", "in 2 hours", "today 5pm"');
  const { reminder } = /** @type {any} */ (await ctx.api.post(path, { at: at.toISOString(), ...(ctx.flags.message ? { note: String(ctx.flags.message) } : {}) }));
  ctx.out.result("nb.task.remind/1", { number: task.taskNumber, at: reminder.remindAt, note: reminder.note }, (d) =>
    `${ctx.out.c.success(ctx.out.sym.done)} I'll remind you about #${d.number} ${new Date(d.at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`);
}

/** @param {Context} ctx */
export const taskWatch = (ctx) => personal(ctx, "watch");
/** @param {Context} ctx */
export const taskStar = (ctx) => personal(ctx, "star");

/** @param {Context} ctx */
export async function taskAssign(ctx) {
  // nb task assign 4 @sam, or several: nb task assign 3 4 --to sam (C2). Left out: choose from the members.
  const picking = !ctx.flags.to && ctx.positionals.length === 1;
  const refs = ctx.flags.to || picking ? ctx.positionals : ctx.positionals.slice(0, -1);
  const who = ctx.flags.to ? String(ctx.flags.to) : picking ? await pickPerson(ctx) : ctx.positionals.at(-1);
  const [ref] = refs;
  if (!ref || !who) throw usage("nb task assign <task…> <@username|me|none>, or --to @sam");
  if (refs.length > 1) {
    const assigneeId = await resolvePerson(ctx, who);
    const d = await bulkChange(ctx, refs, { kind: "assign", assigneeId });
    ctx.out.result("nb.task.assign/1", { numbers: d.tasks.map((/** @type {any} */ t) => t.number), assignee: who === "none" ? null : who.replace(/^@/, "") }, (r) => `${ctx.out.c.success(ctx.out.sym.done)} ${r.numbers.map((/** @type {number} */ n) => `#${n}`).join(", ")} ${r.assignee ? `assigned to ${r.assignee === "me" ? "you" : `@${safe(r.assignee)}`}` : "unassigned"}`);
    return;
  }
  const task = await resolveTask(ctx, ref);
  const assigneeId = await resolvePerson(ctx, who);
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
    d.comments.length ? d.comments.map((/** @type {any} */ c) => `  ${ctx.out.c.muted(formatWhen(String(c.at)))} ${c.by ? `@${safe(c.by)}` : "someone"}: ${commentText(c.text).replace(/\n/g, " ")}${c.id ? ctx.out.c.muted(`  ${String(c.id).slice(0, 8)}`) : ""}`) : `#${d.number} has no comments`);
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
