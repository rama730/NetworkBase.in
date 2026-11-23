// Requests from the terminal (report 38.7 W13, plan A2.6): ask, list, accept, decline, wait and deliver.
import { parseDate } from "../dates.mjs";
import { usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { resolveTask } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx */
async function readAll(ctx) {
  const id = ctx.requireWorkspace();
  return /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/requests`));
}

/** "design" or "Design request" → the type; a unique start of the name is enough. @param {any[]} types @param {string} name */
export function pickType(types, name) {
  const n = name.trim().toLowerCase();
  const exact = types.find((t) => t.name.toLowerCase() === n || t.name.toLowerCase() === `${n} request`);
  if (exact) return exact;
  const starts = types.filter((t) => t.name.toLowerCase().startsWith(n));
  return starts.length === 1 ? starts[0] : null;
}

/** `--field brief="…"` by question id or label (any case). @param {any} type @param {string[]} fields */
export function answersFor(type, fields) {
  /** @type {Record<string, string>} */
  const answers = {};
  for (const f of fields) {
    const at = f.indexOf("=");
    if (at < 1) throw usage(`--field ${f}: write it as name=value`);
    const key = f.slice(0, at).trim().toLowerCase(), value = f.slice(at + 1);
    const q = type.questions.find((/** @type {any} */ x) => x.id.toLowerCase() === key || x.label.toLowerCase().replace(/[?’']/g, "") === key.replace(/[?’']/g, ""));
    if (!q) throw usage(`${type.name} has no question "${f.slice(0, at)}"`, `Its questions: ${type.questions.map((/** @type {any} */ x) => `${x.id} (${x.label})`).join(", ")}`);
    answers[q.id] = value;
  }
  return answers;
}

/** @param {any} c */
const clockWords = (c) => {
  if (!c || c.state === "off") return "—";
  const m = Math.abs(c.leftMinutes), d = Math.floor(m / 480), h = Math.floor((m % 480) / 60), r = m % 60;
  const span = d ? `${d} d${h ? ` ${h} h` : ""}` : h ? `${h} h${r ? ` ${r} m` : ""}` : `${r} m`;
  return c.state === "stopped" ? "done" : c.state === "breached" ? `breached ${span} ago` : `${c.state === "paused" ? "paused · " : ""}${span} left`;
};

/** nb requests list [--mine | --asked | --breaching] @param {Context} ctx */
export async function list(ctx) {
  const d = await readAll(ctx);
  const me = ctx.flags.mine || ctx.flags.asked ? /** @type {any} */ (await ctx.api.get("/api/v1/me")).user : null;
  let rows = /** @type {any[]} */ (d.requests);
  if (ctx.flags.breaching) rows = rows.filter((r) => r.clock && (r.clock.state === "soon" || r.clock.state === "breached")).sort((a, b) => a.clock.leftMinutes - b.clock.leftMinutes);
  else if (ctx.flags.asked) rows = rows.filter((r) => r.askedById === me.id);
  else if (ctx.flags.mine) rows = rows.filter((r) => r.assigneeId === me.id && ["accepted", "in_progress", "in_review"].includes(r.stage));
  else rows = rows.filter((r) => !["delivered", "declined"].includes(r.stage));
  ctx.out.result("nb.request.list/1", { requests: rows }, (r) => {
    if (!r.requests.length) return ctx.flags.breaching ? "Nothing is close to its response time" : "No requests here";
    return [
      ...ctx.out.table([
        { title: "#", value: (q) => String(q.number ?? ""), align: "right" },
        { title: "Request", value: (q) => safe(q.title), flex: true },
        { title: "Type", value: (q) => safe(q.type ?? "—"), optional: true },
        { title: "Stage", value: (q) => String(q.stage).replace(/_/g, " ") },
        { title: "Clock", value: (q) => clockWords(q.clock) },
        { title: "Asked by", value: (q) => safe(q.askedBy ?? "—"), optional: true },
      ], r.requests),
      ctx.out.c.muted(`  ${r.requests.length} ${r.requests.length === 1 ? "request" : "requests"} · nb requests accept <n> --to @someone`),
    ];
  });
}

/** nb requests new "<title>" [--type design] [--field brief="…"] [--need-by date] @param {Context} ctx */
export async function create(ctx) {
  const title = ctx.positionals.join(" ").trim();
  if (!title) throw usage('nb requests new "<title>" [--type design] [--field name=value] [--need-by 2026-12-01]');
  const d = await readAll(ctx);
  if (!d.types.length) throw usage("This workspace has no request types yet");
  const type = ctx.flags.type ? pickType(d.types, String(ctx.flags.type)) : d.types[0];
  if (!type) throw usage(`No request type "${ctx.flags.type}"`, `Types here: ${d.types.map((/** @type {any} */ t) => t.name).join(", ")}`);
  const answers = answersFor(type, /** @type {string[]} */ (ctx.flags.field ?? []));
  const needBy = ctx.flags["need-by"] === undefined ? undefined : parseDate(String(ctx.flags["need-by"]));
  if (needBy === null) throw usage(`--need-by ${ctx.flags["need-by"]} isn't a date I know`, "Try friday, next week, or 2026-12-01");
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/extension/create-task", { projectId: ctx.requireWorkspace(), title, itemType: "request", stage: "new", typeFields: { requestTypeId: type.id, answers }, ...(needBy ? { dueDate: needBy } : {}) }));
  const task = res.task ?? res;
  ctx.out.result("nb.request.new/1", { id: task.id, number: task.taskNumber, title: task.title ?? title, type: type.name }, (r) => `${ctx.out.c.success(ctx.out.sym.done)} Asked #${r.number} ${safe(r.title)} · ${safe(r.type)} · in the Inbox`);
}

/** @param {Context} ctx @param {Record<string, unknown>} body @param {string} done */
async function update(ctx, body, done) {
  const [ref] = ctx.positionals;
  const task = await resolveTask(ctx, String(ref), { brief: true });
  await ctx.api.patch("/api/v1/extension/task-update", { projectId: ctx.requireWorkspace(), taskId: task.id, ...body });
  ctx.out.result("nb.request.update/1", { number: task.taskNumber, kind: body.kind }, (r) => `${ctx.out.c.success(ctx.out.sym.done)} #${r.number} ${done}`);
}

/** nb requests accept <n> --to @someone @param {Context} ctx */
export async function accept(ctx) {
  if (!ctx.positionals[0] || !ctx.flags.to) throw usage("nb requests accept <request> --to @someone");
  const { resolvePerson } = await import("./work.mjs");
  const assigneeId = await resolvePerson(ctx, String(ctx.flags.to));
  if (!assigneeId) throw usage("Accept with someone to handle it: --to @someone");
  await update(ctx, { kind: "request_accept", assigneeId }, "accepted · on the Tasks board");
}

/** nb requests decline <n> --reason "…" @param {Context} ctx */
export async function decline(ctx) {
  if (!ctx.positionals[0] || !ctx.flags.reason) throw usage('nb requests decline <request> --reason "why (the asker sees this)"');
  await update(ctx, { kind: "request_decline", reason: String(ctx.flags.reason) }, "declined");
}

/** nb requests wait <n> --on @someone "question" @param {Context} ctx */
export async function wait(ctx) {
  const [ref, ...words] = ctx.positionals;
  const question = words.join(" ").trim();
  if (!ref || !ctx.flags.on || !question) throw usage('nb requests wait <request> --on @someone "your question"');
  const { resolvePerson } = await import("./work.mjs");
  const onUserId = await resolvePerson(ctx, String(ctx.flags.on));
  if (!onUserId) throw usage("Say who it waits on: --on @someone");
  ctx.positionals = [ref];
  await update(ctx, { kind: "request_wait", onUserId, question }, "is waiting · clock paused");
}

/** nb requests resume <n> @param {Context} ctx */
export async function resume(ctx) {
  if (!ctx.positionals[0]) throw usage("nb requests resume <request>");
  await update(ctx, { kind: "request_resume" }, "clock running again");
}

/** nb requests deliver <n> [--link https://…] @param {Context} ctx */
export async function deliver(ctx) {
  if (!ctx.positionals[0]) throw usage("nb requests deliver <request> [--link https://…]");
  await update(ctx, { kind: "request_deliver", ...(ctx.flags.link ? { link: String(ctx.flags.link) } : {}) }, "delivered · the asker is asked if it solved it");
}
