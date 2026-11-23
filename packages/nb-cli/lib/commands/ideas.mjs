// Ideas from the terminal (report 38.13 W9, plan A5.3): the ranked list, and adding one.
import { usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const WORD = /** @type {Record<string, string>} */ ({ idea: "idea", validating: "validating", building: "building", launched: "launched" });

/** nb ideas list @param {Context} ctx */
export async function list(ctx) {
  const id = ctx.requireWorkspace();
  const d = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/ideas`));
  ctx.out.result("nb.ideas.list/1", { ideas: d.ideas, dropped: d.dropped }, (r) => {
    if (!d.doc) return "No Ideas document yet";
    if (!r.ideas.length) return "No ideas yet";
    return [...ctx.out.table([
      { title: "#", value: (x) => (x.rank == null ? "–" : String(x.rank)) },
      { title: "Idea", value: (x) => safe(x.title), flex: true },
      { title: "I·E·C", value: (x) => [x.impact, x.ease, x.confidence].map((n) => n ?? "–").join("·") },
      { title: "Score", value: (x) => (x.score == null ? "not scored" : String(x.score)), align: "right" },
      { title: "Stage", value: (x) => WORD[x.stage] ?? x.stage, optional: true },
    ], r.ideas), ...(r.dropped ? [ctx.out.c.muted(`  ${r.dropped} dropped`)] : [])];
  });
}

/** nb ideas add "<name>" [--pitch] [--impact 1-5] [--ease 1-5] [--confidence 1-5] @param {Context} ctx */
export async function add(ctx) {
  const id = ctx.requireWorkspace();
  const title = ctx.positionals.join(" ").trim();
  if (!title) throw usage('nb ideas add "<name>" [--impact 1-5] [--ease 1-5] [--confidence 1-5] [--pitch text]');
  /** @param {string} k */
  const score = (k) => {
    if (ctx.flags[k] == null) return undefined;
    const n = Number(ctx.flags[k]);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw usage(`--${k} runs from 1 to 5`);
    return n;
  };
  const body = { title, ...(ctx.flags.pitch ? { pitch: String(ctx.flags.pitch) } : {}), impact: score("impact"), ease: score("ease"), confidence: score("confidence") };
  const d = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(id)}/ideas`, body));
  ctx.out.result("nb.ideas.add/1", { number: d.number, title }, () => `Added idea${d.number ? ` NB-${d.number}` : ""}: ${safe(title)}`);
}
