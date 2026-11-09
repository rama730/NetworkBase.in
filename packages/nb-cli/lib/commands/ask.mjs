// nb ask (report §20.4, §26.4): ask the person a question from a script or a cloud agent, wait for the answer;
// answer questions agents asked you. Same nb.question/1 shape as the app's question card.
import { CliError, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** "a", "b" or "a: description" → options; the first is recommended. @param {string[]} raw */
const options = (raw) => raw.map((o, i) => {
  const at = o.indexOf(":");
  const label = (at > 0 ? o.slice(0, at) : o).trim();
  return { value: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `option-${i + 1}`, label: label.slice(0, 80), ...(at > 0 ? { description: o.slice(at + 1).trim().slice(0, 200) } : {}), ...(i === 0 ? { recommended: true } : {}) };
});

/** @param {Context} ctx @param {string} id @param {number} timeoutS */
export async function waitFor(ctx, id, timeoutS) {
  const until = Date.now() + timeoutS * 1000;
  for (;;) {
    const q = /** @type {any} */ (await ctx.api.get(`/api/v1/questions/${encodeURIComponent(id)}`, { query: { wait: 25 }, timeoutMs: 40_000 }));
    if (q.status !== "open" || Date.now() >= until) return q;
  }
}

/** @param {any} q */
const answerText = (q) => Object.entries(q.answer ?? {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("; ");

/** @param {Context} ctx */
export async function ask(ctx) {
  const question = ctx.positionals.join(" ").trim();
  const raw = /** @type {string[]} */ (ctx.flags.option ?? []);
  if (!question || raw.length < 2) throw usage('nb ask "<question>" --option "Yes" --option "No" [--to me|assignee|reviewer] [--task 4] [--wait]');
  if (raw.length > 4) throw usage("At most 4 options");
  const projectId = ctx.requireWorkspace();
  let taskId = null;
  if (ctx.flags.task || ctx.project?.startedTask) {
    const { resolveTask } = await import("./tasks.mjs");
    taskId = (await resolveTask(ctx, String(ctx.flags.task ?? ctx.project?.startedTask?.number ?? ctx.project?.startedTask?.id))).id;
  }
  const asked = /** @type {any} */ (await ctx.api.post("/api/v1/questions", {
    projectId, ...(taskId ? { taskId } : {}), to: ctx.flags.to ?? "me", ...(ctx.flags.context ? { context: ctx.flags.context } : {}),
    questions: [{ key: "answer", header: String(ctx.flags.header ?? "Question").slice(0, 12), question, options: options(raw), allowOther: true }],
  }));
  if (!ctx.flags.wait) {
    return ctx.out.result("nb.ask/1", asked, (d) => [`${ctx.out.c.success(ctx.out.sym.done)} Asked (${d.to}); they'll see it in NetworkBase`, ctx.out.c.muted(`  Wait for the answer: nb ask wait ${d.id}`)]);
  }
  ctx.out.note(ctx.out.c.muted(`Asked; waiting for the answer (up to ${Number(ctx.flags.timeout ?? 600)} s)…`));
  return printAnswer(ctx, await waitFor(ctx, asked.id, Number(ctx.flags.timeout ?? 600)));
}

/** @param {Context} ctx @param {any} q */
function printAnswer(ctx, q) {
  ctx.out.result("nb.ask/1", q, (d) => (d.status === "answered" ? `${ctx.out.c.success(ctx.out.sym.done)} ${safe(answerText(d))}` : `No answer yet (${d.status})`));
  return q.status === "answered" ? 0 : q.status === "open" ? 8 : 1;
}

/** @param {Context} ctx */
export async function askWait(ctx) {
  const id = ctx.positionals[0];
  if (!id) throw usage("nb ask wait <id> [--timeout 600]");
  return printAnswer(ctx, await waitFor(ctx, id, Number(ctx.flags.timeout ?? 600)));
}

/** @param {Context} ctx */
export async function askList(ctx) {
  const { questions } = /** @type {any} */ (await ctx.api.get("/api/v1/questions"));
  ctx.out.result("nb.ask.list/1", { questions }, (d) =>
    d.questions.length
      ? d.questions.flatMap((/** @type {any} */ q) => [`${ctx.out.c.brand(ctx.out.sym.brand)} ${safe(q.agentName ?? "An agent")} asks: ${safe(q.questions[0]?.question ?? "")}  ${ctx.out.c.muted(q.id.slice(0, 8))}`, ...q.questions[0].options.map((/** @type {any} */ o, /** @type {number} */ i) => `    ${i + 1}. ${safe(o.label)}${o.recommended ? ctx.out.c.muted("  (recommended)") : ""}`)])
      : "No questions waiting for you");
}

/** @param {Context} ctx */
export async function askAnswer(ctx) {
  const [idPrefix, ...rest] = ctx.positionals;
  if (!idPrefix || !rest.length) throw usage("nb ask answer <id> <option number or text>");
  const { questions } = /** @type {any} */ (await ctx.api.get("/api/v1/questions"));
  const q = questions.find((/** @type {any} */ x) => x.id.startsWith(idPrefix));
  if (!q) throw new CliError("NOT_FOUND", `No open question ${idPrefix} for you`, { hint: "nb ask list" });
  const first = q.questions[0];
  const given = rest.join(" ");
  const byNumber = /^\d+$/.test(given) ? first.options[Number(given) - 1]?.value : null;
  const answered = /** @type {any} */ (await ctx.api.post(`/api/v1/questions/${q.id}/answer`, { answers: { [first.key]: byNumber ?? given } }));
  ctx.out.result("nb.ask.answer/1", answered, () => `${ctx.out.c.success(ctx.out.sym.done)} Answered`);
}
