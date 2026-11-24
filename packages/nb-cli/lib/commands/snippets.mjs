// Snippets from the terminal (report 21.4, 38.15 W6, plan A6.35): list them, and print one's code.
import { CliError } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */
const base = (/** @type {Context} */ ctx) => `/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/snippets`;

/** nb snippets list @param {Context} ctx */
export async function list(ctx) {
  const d = /** @type {any} */ (await ctx.api.get(base(ctx)));
  ctx.out.result("nb.snippets.list/1", { snippets: d.snippets }, (r) => {
    if (!r.snippets.length) return "No snippets yet";
    return ctx.out.table([
      { title: "Snippet", value: (s) => safe(s.name), flex: true },
      { title: "Language", value: (s) => safe(s.language) },
      { title: "Tags", value: (s) => safe(s.tags.join(", ") || "—"), optional: true },
    ], r.snippets);
  });
}

/** nb snippets get <name>: the code alone, ready to pipe. @param {Context} ctx */
export async function get(ctx) {
  const name = ctx.positionals.join(" ").trim();
  if (!name) throw new CliError("USAGE", "Name the snippet", { hint: 'nb snippets get "Retry with backoff"' });
  const d = /** @type {any} */ (await ctx.api.get(base(ctx), { query: { name } }));
  ctx.out.result("nb.snippets.get/1", { snippet: d.snippet }, (r) => r.snippet.code);
}
