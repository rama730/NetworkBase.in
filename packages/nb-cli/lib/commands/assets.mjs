// Assets from the terminal (report 38.16 W10, plan A7.1): the gallery as a list, and tagging a file.
import { CliError } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */
const base = (/** @type {Context} */ ctx) => `/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/assets`;
const LABEL = /** @type {Record<string, string>} */ ({ concept: "Concept", wip: "Work in progress", review: "Review", final: "Final" });

/** nb assets list [--type logo] @param {Context} ctx */
export async function list(ctx) {
  const d = /** @type {any} */ (await ctx.api.get(base(ctx), { query: ctx.flags.type ? { type: String(ctx.flags.type) } : {} }));
  ctx.out.result("nb.assets.list/1", { assets: d.assets }, (r) => {
    if (!r.assets.length) return "No assets yet";
    return ctx.out.table([
      { title: "File", value: (a) => safe(a.path), flex: true },
      { title: "Type", value: (a) => safe(a.type) },
      { title: "Status", value: (a) => (a.productionStatus ? LABEL[a.productionStatus] ?? a.productionStatus : "—"), optional: true },
      { title: "Tags", value: (a) => safe(a.tags.join(", ") || "—"), optional: true },
      { title: "Ver", value: (a) => `v${a.version}` },
    ], r.assets);
  });
}

/** nb assets tag <file> <tag> @param {Context} ctx */
export async function tag(ctx) {
  const [file, word] = ctx.positionals;
  if (!file || !word) throw new CliError("USAGE", "Name the file and the tag", { hint: "nb assets tag brand/Logo-dark.svg brand" });
  const d = /** @type {any} */ (await ctx.api.post(base(ctx), { path: file.replace(/\\/g, "/"), tag: word }));
  ctx.out.result("nb.assets.tag/1", d, (r) => `${ctx.out.c.success(ctx.out.sym.done)} ${safe(r.path)} tagged ${safe(r.tag)}`);
}
