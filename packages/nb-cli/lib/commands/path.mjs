// The learning path from the terminal (report 38.18 W9, plan A7.7): see it, and tick your own lessons.
import { CliError } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */
const base = (/** @type {Context} */ ctx) => `/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/path`;

/** nb path @param {Context} ctx */
export async function show(ctx) {
  const d = /** @type {any} */ (await ctx.api.get(base(ctx)));
  ctx.out.result("nb.path/1", d, (r) => {
    if (!r.steps.length) return "No steps yet";
    const done = new Set(r.done);
    return r.steps.flatMap((/** @type {any} */ s, /** @type {number} */ i) => [
      `${i + 1}. ${safe(s.name)}${s.progress ? ctx.out.c.muted(`  ${s.progress.done} of ${s.progress.total} done`) : ""}${s.locked ? ctx.out.c.muted("  locked") : ""}`,
      ...s.lessons.map((/** @type {any} */ l) => `   ${done.has(l.id) ? "[x]" : "[ ]"} ${safe(l.title)}${l.number ? ctx.out.c.muted(`  NB-${l.number}`) : ""}${r.upNext?.lessonId === l.id ? "  ← up next" : ""}`),
    ]);
  });
}

/** nb path done NB-410 [--undo] @param {Context} ctx */
export async function done(ctx) {
  const ref = String(ctx.positionals[0] ?? "");
  const number = Number(ref.replace(/^NB-/i, "").replace(/^#/, ""));
  if (!Number.isInteger(number) || number <= 0) throw new CliError("USAGE", "Name the lesson", { hint: "nb path done NB-410" });
  const d = /** @type {any} */ (await ctx.api.post(base(ctx), { number, done: !ctx.flags.undo }));
  ctx.out.result("nb.path.done/1", d, (r) => `${ctx.out.c.success(ctx.out.sym.done)} NB-${r.number} ${r.done ? "done" : "not done"}`);
}
