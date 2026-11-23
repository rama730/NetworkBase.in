// Launches from the terminal (report 38.10 W10, plan A3.1): list. New launches and Launch now are made in the app
// until docs can be made from a template here (A6.35).
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** nb launches list [--all] @param {Context} ctx */
export async function list(ctx) {
  const id = ctx.requireWorkspace();
  const d = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/launches`));
  const rows = /** @type {any[]} */ (d.launches).filter((l) => ctx.flags.all || (l.stage !== "closed" && l.stage !== "cancelled"));
  ctx.out.result("nb.launches.list/1", { launches: rows }, (r) => {
    if (!r.launches.length) return "No launches · make one from Documents → Launches";
    return [
      ...ctx.out.table([
        { title: "Launch", value: (l) => safe(l.name), flex: true },
        { title: "Date", value: (l) => l.date ?? "—" },
        { title: "Stage", value: (l) => String(l.stage).replace(/_/g, " ") },
        { title: "Steps", value: (l) => (l.total ? `${l.done} of ${l.total}` : "—"), align: "right" },
      ], r.launches),
    ];
  });
}
