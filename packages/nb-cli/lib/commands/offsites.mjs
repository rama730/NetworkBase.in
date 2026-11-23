// Off-sites from the terminal (report 38.14 W7, plan A5.4): the list.
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** nb offsites list @param {Context} ctx */
export async function list(ctx) {
  const id = ctx.requireWorkspace();
  const d = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/offsites`));
  ctx.out.result("nb.offsites.list/1", { offsites: d.offsites }, (r) => {
    if (!r.offsites.length) return "No off-sites coming up";
    return ctx.out.table([
      { title: "Dates", value: (o) => `${o.dateFrom}${o.dateTo && o.dateTo !== o.dateFrom ? ` → ${o.dateTo}` : ""}` },
      { title: "Off-site", value: (o) => safe(o.name), flex: true },
      { title: "Place", value: (o) => safe(o.place ?? "—"), optional: true },
      { title: "Answers", value: (o) => `${o.counts.going} going · ${o.counts.cant} can't · ${o.counts.unanswered} not answered` },
    ], r.offsites);
  });
}
