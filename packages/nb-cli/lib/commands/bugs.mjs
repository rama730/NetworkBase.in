// Bugs from the terminal (report 38.6 W14, plan A2.3): list, report, move, close, and turn tasks into bugs.
import { usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { list as taskList, resolveTask } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const SEVERITY = ["urgent", "major", "minor"];
const REASONS = /** @type {Record<string, string>} */ ({ wont_fix: "Won’t fix", duplicate: "Duplicate", cant_reproduce: "Can’t reproduce" });

/** `--where web:firefox:132`, `app:ios:17.2`, or any other words. @param {string} value */
export function parseWhere(value) {
  const [kind, a = "", b = ""] = value.split(":");
  if (kind === "web") return { kind: "web", browser: a.slice(0, 40), version: b.slice(0, 40) };
  if (kind === "app") return { kind: "app", platform: a.slice(0, 40), version: b.slice(0, 40) };
  return { kind: "other", text: value.slice(0, 200) };
}

/** nb bugs list [--stage new]: the workspace's bugs, open ones unless --status says otherwise. @param {Context} ctx */
export async function list(ctx) {
  ctx.flags.type = "bug";
  return taskList(ctx);
}

/** nb bugs report "<title>" [--steps] [--expected] [--where] [--severity] [--found-in]: a bug at New. @param {Context} ctx */
export async function report(ctx) {
  const title = ctx.positionals.join(" ").trim();
  if (!title) throw usage('nb bugs report "<title>" [--steps text] [--expected text] [--where web:firefox:132] [--severity major]');
  const severity = ctx.flags.severity ? String(ctx.flags.severity).toLowerCase() : undefined;
  if (severity && !SEVERITY.includes(severity)) throw usage("--severity must be urgent, major or minor (leave it out for Not sure)");
  // Shells pass "\n" literally; steps are lines.
  const steps = ctx.flags.steps ? String(ctx.flags.steps).replace(/\\n/g, "\n") : undefined;
  const typeFields = {
    ...(severity ? { severity } : {}), ...(steps ? { steps } : {}),
    ...(ctx.flags.expected ? { expected: String(ctx.flags.expected) } : {}),
    ...(ctx.flags.where ? { where: parseWhere(String(ctx.flags.where)) } : {}),
    ...(ctx.flags["found-in"] ? { foundIn: String(ctx.flags["found-in"]) } : {}),
  };
  const projectId = ctx.requireWorkspace();
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/extension/create-task", { projectId, title, itemType: "bug", stage: "new", typeFields }));
  const task = res.task ?? res;
  ctx.out.result("nb.bug.report/1", { id: task.id, number: task.taskNumber, title: task.title ?? title, stage: "new", severity: severity ?? null }, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Reported #${d.number} ${safe(d.title)} · at New`,
    ctx.out.c.muted(`  Next: nb bugs move ${d.number} confirmed`),
  ]);
}

/** nb bugs move <bug> <stage> [--backlog]: Confirmed, Fixing, Fixed, Verified (closing has its own command). @param {Context} ctx */
export async function move(ctx) {
  const [ref, stage, extra] = ctx.positionals;
  if (!ref || !stage || extra) throw usage("nb bugs move <bug> new|confirmed|fixing|fixed|verified [--backlog]");
  const to = stage.toLowerCase();
  if (REASONS[to]) throw usage(`Close a bug with its reason: nb bugs close ${ref} --reason ${to}`);
  const bug = await resolveTask(ctx, ref, { brief: true });
  const res = /** @type {any} */ (await ctx.api.patch("/api/v1/extension/task-update", { kind: "stage", projectId: ctx.requireWorkspace(), taskId: bug.id, stage: to, ...(ctx.flags.backlog ? { backlog: true } : {}) }));
  ctx.out.result("nb.bug.move/1", { number: bug.taskNumber, stage: to, status: res.status ?? null }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} #${d.number} is at ${d.stage.replace(/_/g, " ")}`);
}

/** nb bugs close <bug> --reason wont_fix|duplicate|cant_reproduce [--of <bug>] [-m message]: asks first. @param {Context} ctx */
export async function close(ctx) {
  const [ref, extra] = ctx.positionals;
  const reason = String(ctx.flags.reason ?? "").toLowerCase();
  if (!ref || extra || !REASONS[reason]) throw usage("nb bugs close <bug> --reason wont_fix|duplicate|cant_reproduce [--of <bug>] [-m message]");
  if (reason === "duplicate" && !ctx.flags.of) throw usage("Say which bug it duplicates: --of <bug>");
  if (reason === "cant_reproduce" && !ctx.flags.message) throw usage("Tell the reporter what you need: -m \"Which browser?\"");
  const bug = await resolveTask(ctx, ref, { brief: true });
  const of = ctx.flags.of ? await resolveTask(ctx, String(ctx.flags.of), { brief: true }) : null;
  const { ask } = await import("../tui/ask.mjs");
  const choice = await ask(ctx, { key: "close", header: "Close bug", question: `Close #${bug.taskNumber} "${safe(bug.title)}" as ${REASONS[reason]}${of ? ` of #${of.taskNumber}` : ""}?`, options: [
    { value: "yes", label: `Close as ${REASONS[reason]}`, recommended: true },
    { value: "no", label: "Keep it open" },
  ] });
  if (choice !== "yes") return ctx.out.result("nb.bug.close/1", { number: bug.taskNumber, closed: false }, () => "Kept open; nothing changed");
  await ctx.api.patch("/api/v1/extension/task-update", { kind: "bug_close", projectId: ctx.requireWorkspace(), taskId: bug.id, reason, ...(of ? { duplicateOfId: of.id } : {}), ...(ctx.flags.message ? { message: String(ctx.flags.message) } : {}) });
  ctx.out.result("nb.bug.close/1", { number: bug.taskNumber, closed: true, reason }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} #${d.number} closed as ${REASONS[d.reason]}`);
}

/** nb bugs from <task…> [--stage confirmed]: turn plain tasks into bugs (Confirmed, Fixing once started, Fixed when done). @param {Context} ctx */
export async function from(ctx) {
  if (!ctx.positionals.length) throw usage("nb bugs from <task…> [--stage confirmed|new|fixing|fixed|verified]");
  const projectId = ctx.requireWorkspace();
  const stage = ctx.flags.stage ? String(ctx.flags.stage).toLowerCase() : undefined;
  /** @type {number[]} */
  const numbers = [];
  for (const ref of ctx.positionals) {
    const task = await resolveTask(ctx, ref, { brief: true });
    await ctx.api.patch("/api/v1/extension/task-update", { kind: "change_type", projectId, taskId: task.id, toType: "bug", ...(stage ? { stage } : {}) });
    numbers.push(task.taskNumber);
  }
  ctx.out.result("nb.bug.from/1", { numbers }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${d.numbers.map((/** @type {number} */ n) => `#${n}`).join(", ")} ${d.numbers.length === 1 ? "is a bug" : "are bugs"} now`);
}
