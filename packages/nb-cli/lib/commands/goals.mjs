// Goals from the terminal (report 38.12 W10, plan A5.1b): this period's list and check-ins.
import { usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const WORD = /** @type {Record<string, string>} */ ({ on_track: "on track", at_risk: "at risk", off_track: "off track" });
/** @param {number|null} n */
const num = (n) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** nb goals list [--mine] @param {Context} ctx */
export async function list(ctx) {
  const id = ctx.requireWorkspace();
  const d = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/goals`));
  const me = d.viewerId;
  const objectives = (/** @type {any[]} */ (d.objectives ?? [])).map((o) => ({ ...o, keyResults: ctx.flags.mine ? o.keyResults.filter((/** @type {any} */ k) => k.assigneeId === me) : o.keyResults }))
    .filter((o) => !ctx.flags.mine || o.assigneeId === me || o.keyResults.length);
  ctx.out.result("nb.goals.list/1", { period: d.period, label: d.label, objectives }, (r) => {
    if (!r.label) return `No goals document for ${r.period} yet`;
    if (!r.objectives.length) return `${r.label}: no objectives${ctx.flags.mine ? " of yours" : ""} yet`;
    const rows = r.objectives.flatMap((/** @type {any} */ o) => [
      { n: `NB-${o.number}`, title: safe(o.title), now: `${o.progress}%`, status: WORD[o.status] ?? o.status, due: "" },
      ...o.keyResults.map((/** @type {any} */ k) => ({ n: `NB-${k.number}`, title: `  ${safe(k.title)}`, now: `${num(k.current)} / ${num(k.target)}${k.unit ? ` ${k.unit}` : ""}`, status: WORD[k.status] ?? k.status, due: k.due ? "check in" : "" })),
    ]);
    return [ctx.out.c.muted(`  ${r.label}`), ...ctx.out.table([
      { title: "#", value: (x) => x.n },
      { title: "Objective / key result", value: (x) => x.title, flex: true },
      { title: "Now", value: (x) => x.now },
      { title: "Status", value: (x) => x.status },
      { title: "", value: (x) => x.due, optional: true },
    ], rows)];
  });
}

/** nb goals checkin <key result> --value n --confidence 1-10 [--note] @param {Context} ctx */
export async function checkin(ctx) {
  const id = ctx.requireWorkspace();
  const ref = String(ctx.positionals[0] ?? "");
  const task = Number(ref.replace(/^[A-Za-z]+-/, ""));
  const value = Number(ctx.flags.value);
  const confidence = Number(ctx.flags.confidence);
  if (!Number.isInteger(task) || task <= 0) throw usage("Name the key result, like NB-301");
  if (ctx.flags.value == null || !Number.isFinite(value)) throw usage("Give --value, the new number");
  if (!Number.isInteger(confidence) || confidence < 1 || confidence > 10) throw usage("Give --confidence from 1 to 10");
  await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(id)}/goals`, { task, value, confidence, ...(ctx.flags.note ? { note: String(ctx.flags.note) } : {}) });
  ctx.out.result("nb.goals.checkin/1", { task, value, confidence }, () => `Checked in on ${ref}: ${num(value)} · confidence ${confidence}/10`);
}
