// nb log, nb show, nb revert (report H3, H6): the workspace's history of saves. Every change to the files is a save
// once History (Branches) is on; revert makes a new save that undoes one, merging with later work.
import { CliError, EXIT } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { confirm } from "../tui/ask.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const enc = encodeURIComponent;
/** @param {any} s */
const counts = (s) => [s.files.added && `${s.files.added} added`, s.files.changed && `${s.files.changed} changed`, s.files.deleted && `${s.files.deleted} deleted`, s.files.renamed && `${s.files.renamed} moved`].filter(Boolean).join(", ");
/** @param {any} s */
const byWhom = (s) => `${s.author?.username ? `@${s.author.username}` : s.author?.name ?? "someone"}${s.via === "agent" ? ` with ${s.agentName ?? "an agent"}` : s.via === "cli" ? " (terminal)" : ""}`;
/** Local time, like the app (0.8 #9). @param {string} iso */
const when = (iso) => {
  const d = new Date(iso);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** A save named by its number ("12") or id. @param {Context} ctx @param {string | undefined} given */
async function saveId(ctx, given) {
  if (!given) throw new CliError("USAGE", "Name a save by its number", { hint: "nb log lists them: nb show 12" });
  if (/^[0-9a-f-]{36}$/i.test(given)) return given;
  const n = Number(String(given).replace(/^#/, ""));
  if (!Number.isInteger(n) || n < 1) throw new CliError("USAGE", `Not a save number: ${given}`, { hint: "nb log lists them" });
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/saves`, { query: { number: n, limit: 1 } }));
  if (!res.saves?.length) throw new CliError("NOT_FOUND", `No save ${n} here`, { hint: "nb log lists them" });
  return res.saves[0].id;
}

/** nb log: newest first. @param {Context} ctx */
export async function log(ctx) {
  const query = {
    ...(ctx.positionals[0] || ctx.flags.path ? { path: String(ctx.flags.path ?? ctx.positionals[0]) } : {}),
    ...(ctx.flags.author ? { author: String(ctx.flags.author) } : {}),
    ...(ctx.flags.agent ? { agent: String(ctx.flags.agent) } : {}),
    limit: Math.min(Number(ctx.flags.limit ?? 20) || 20, 50),
  };
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${enc(ctx.requireWorkspace())}/saves`, { query }));
  const { c } = ctx.out;
  ctx.out.result("nb.log/1", res, (d) => d.saves.length
    ? [
        ...d.saves.map((/** @type {any} */ s) => `${c.brand(String(s.number).padStart(4))}  ${safe(s.message)}${s.kind !== "save" ? c.muted(` [${s.kind}]`) : ""}\n      ${c.muted(`${safe(byWhom(s))} · ${when(s.createdAt)}${counts(s) ? ` · ${counts(s)}` : ""}${s.task?.number ? ` · #${s.task.number}` : ""}`)}`),
        ...(d.nextCursor ? [c.muted("  Older saves: nb log --limit 50, or open History in the Files tab")] : []),
      ]
    : "No saves yet");
  return EXIT.ok;
}

/** nb show <save>: what it says and its files; --diff <path> prints one file's diff. @param {Context} ctx */
export async function show(ctx) {
  const id = await saveId(ctx, ctx.positionals[0]);
  const { c } = ctx.out;
  if (ctx.flags.diff) {
    const diff = /** @type {any} */ (await ctx.api.get(`/api/v1/saves/${enc(id)}/diff`, { query: { path: String(ctx.flags.diff) } }));
    ctx.out.result("nb.show.diff/1", diff, (d) => d.kind === "text"
      ? d.lines.map((/** @type {any} */ l) => (l.kind === "+" ? c.success(`+${safe(l.text)}`) : l.kind === "-" ? c.danger(`-${safe(l.text)}`) : l.kind === "@" ? c.muted(safe(l.text)) : ` ${safe(l.text)}`))
      : d.kind === "image" ? "An image: open the save in the Files tab to compare" : `${d.kind === "too_large" ? "Too large to show" : "Not a text file"} (${d.beforeSize ?? "—"} → ${d.afterSize ?? "deleted"} bytes)`);
    return EXIT.ok;
  }
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/saves/${enc(id)}`));
  const sym = /** @type {Record<string, string>} */ ({ add: "+", change: "~", delete: "-", rename: ">" });
  ctx.out.result("nb.show/1", res, (d) => [
    `${c.bold(`Save ${d.save.number}`)} ${safe(d.save.message)}`,
    c.muted(`  ${safe(byWhom(d.save))} · ${when(d.save.createdAt)}${d.save.task?.number ? ` · #${d.save.task.number}` : ""}`),
    ...d.files.map((/** @type {any} */ f) => `  ${sym[f.op] ?? "?"} ${safe(f.fromPath ? `${f.fromPath} → ${f.path}` : f.path)}`),
    ...(d.truncated ? [c.muted("  …more files: open the save in the Files tab")] : []),
    ...(d.files.length ? [c.muted(`  One file's diff: nb show ${d.save.number} --diff ${d.files[0].path}`)] : []),
  ]);
  return EXIT.ok;
}

/** nb revert <save>: a new save that undoes it. @param {Context} ctx */
export async function revert(ctx) {
  const id = await saveId(ctx, ctx.positionals[0]);
  const one = /** @type {any} */ (await ctx.api.get(`/api/v1/saves/${enc(id)}`));
  const ok = await confirm(ctx, { key: "revert", question: `Revert save ${one.save.number} (“${one.save.message}”)?`, preview: one.files.map((/** @type {any} */ f) => `${f.op} ${f.path}`).slice(0, 20).join("\n") });
  if (!ok) throw new CliError("CANCELLED", "Nothing reverted");
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/saves/${enc(id)}/revert`, {}));
  const { c } = ctx.out;
  ctx.out.result("nb.revert/1", res, (d) => d.outcome === "reverted"
    ? `${c.success(ctx.out.sym.done)} Reverted save ${one.save.number}${d.saveId ? c.muted(" · nb log shows the new save") : ""}`
    : d.outcome === "nothing" ? "Nothing to revert: those files are already as they were before"
      : [`${c.warning(ctx.out.sym.warn)} ${d.conflicts?.length ?? "Some"} file(s) changed since; choose for each`, c.muted(`  nb change view ${d.changeSetId.slice(0, 8)}, then nb resolve, then nb change apply ${d.changeSetId.slice(0, 8)}`)]);
  return res.outcome === "conflicts" ? EXIT.conflict : EXIT.ok;
}
