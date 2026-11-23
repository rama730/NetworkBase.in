// The roadmap from the terminal (report 38.9 W12, plan A2.10): list and add. Work links with nb task edit --part-of.
import { usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const COLUMNS = ["now", "next", "later"];
const TYPES = ["feature", "improvement", "fix", "milestone"];
const MILESTONES = ["Concept", "Prototype", "Vertical slice", "Alpha", "Beta", "Release"];

/** nb roadmap list [--now | --next | --later] @param {Context} ctx */
export async function list(ctx) {
  const id = ctx.requireWorkspace();
  const d = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/roadmap`));
  const only = COLUMNS.find((c) => ctx.flags[c]);
  const order = { now: 0, next: 1, later: 2 };
  let rows = /** @type {any[]} */ (d.items).filter((r) => r.stage !== "launched" && r.stage !== "wont_do");
  if (only) rows = rows.filter((r) => r.column === only);
  rows.sort((a, b) => (order[/** @type {"now"} */ (a.column)] ?? 3) - (order[/** @type {"now"} */ (b.column)] ?? 3));
  ctx.out.result("nb.roadmap.list/1", { items: rows }, (r) => {
    if (!r.items.length) return only ? `Nothing in ${only[0].toUpperCase()}${only.slice(1)}` : "The roadmap is empty · nb roadmap add \"<name>\"";
    return [
      ...ctx.out.table([
        { title: "#", value: (q) => String(q.number ?? ""), align: "right" },
        { title: "Item", value: (q) => safe(q.title), flex: true },
        { title: "Column", value: (q) => q.column ?? "—" },
        { title: "Stage", value: (q) => String(q.stage ?? "backlog").replace(/_/g, " ") },
        { title: "Type", value: (q) => (q.type === "milestone" && q.milestone ? q.milestone : q.type), optional: true },
        { title: "Done", value: (q) => (q.progress === null ? "—" : `${q.progress}%`), align: "right" },
      ], r.items),
      ctx.out.c.muted(`  ${r.items.length} ${r.items.length === 1 ? "item" : "items"} · link work with nb task edit <task> --part-of <item>`),
    ];
  });
}

/** nb roadmap add "<name>" [--type feature] [--column next] [--milestone Alpha] [--outcome "…"] @param {Context} ctx */
export async function add(ctx) {
  const title = ctx.positionals.join(" ").trim();
  if (!title) throw usage('nb roadmap add "<name>" [--type feature] [--column next] [--outcome "what changes for people"]');
  const type = String(ctx.flags.type ?? "feature").toLowerCase();
  if (!TYPES.includes(type)) throw usage(`--type ${ctx.flags.type}: use ${TYPES.join(", ")}`);
  const column = String(ctx.flags.column ?? "next").toLowerCase();
  if (!COLUMNS.includes(column)) throw usage(`--column ${ctx.flags.column}: use now, next or later`);
  const milestone = ctx.flags.milestone === undefined ? null : MILESTONES.find((m) => m.toLowerCase() === String(ctx.flags.milestone).toLowerCase());
  if (ctx.flags.milestone !== undefined && !milestone) throw usage(`--milestone ${ctx.flags.milestone}: use ${MILESTONES.join(", ")}`);
  if (milestone && type !== "milestone") throw usage("--milestone goes with --type milestone");
  const typeFields = { column, itemType: type, ...(milestone ? { milestone } : type === "milestone" ? { milestone: MILESTONES[0] } : {}), ...(ctx.flags.outcome ? { outcome: String(ctx.flags.outcome).slice(0, 200) } : {}) };
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/extension/create-task", { projectId: ctx.requireWorkspace(), title, itemType: "roadmap_item", stage: "backlog", typeFields }));
  const task = res.task ?? res;
  ctx.out.result("nb.roadmap.add/1", { id: task.id, number: task.taskNumber, title: task.title ?? title, column },
    (r) => `${ctx.out.c.success(ctx.out.sym.done)} #${r.number} ${safe(r.title)} · ${r.column[0].toUpperCase()}${r.column.slice(1)} · Backlog`);
}
