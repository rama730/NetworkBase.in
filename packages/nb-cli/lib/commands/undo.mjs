// nb undo (report A2.9, §17.4): reverses a change made from this machine in the last 24 hours, if nothing has
// happened since that it would undo. The server keeps the rules; this only picks which change.
import { CliError } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { dropUndo, readUndoLog } from "../undo-log.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const WHAT = /** @type {Record<string, string>} */ ({
  "/api/v1/files/place": "push", "/api/v1/extension/fast-push": "push", "/api/v1/extension/create-task": "task created",
  "/api/v1/extension/task-subtask": "subtask added", "/api/v1/extension/task-update": "task or subtask change", "/api/v1/extension/comments": "comment",
});

/** @param {Context} ctx */
export async function undo(ctx) {
  const log = readUndoLog(ctx.env, ctx.profile.origin);
  if (ctx.flags.list) {
    return ctx.out.result("nb.undo.list/1", { changes: log.slice().reverse().map((e) => ({ token: e.token, at: new Date(e.at).toISOString(), what: WHAT[e.path] ?? e.path })) }, (d) =>
      d.changes.length ? d.changes.map((c, i) => `  ${i === 0 ? ctx.out.c.brand(ctx.out.sym.brand) : " "} ${c.at.slice(11, 16)}  ${c.what}  ${ctx.out.c.muted(c.token.slice(0, 8))}`) : "Nothing to undo from the last 24 hours");
  }
  if (ctx.flags.session) {
    // Everything this agent session did, newest first (report A7.7): `nb mcp` tags its changes with a session id.
    const session = ctx.env.NB_AGENT_SESSION;
    if (!session) throw new CliError("USAGE", "--session works inside an agent session (nb mcp)");
    const mine = log.filter((e) => e.session === session).reverse();
    if (!mine.length) throw new CliError("NOT_FOUND", "This agent session hasn't changed anything that can be undone");
    /** @type {Array<{ token: string, ok: boolean, message: string }>} */
    const results = [];
    for (const e of mine) {
      try {
        const res = /** @type {any} */ (await ctx.api.post(`/api/v1/undo/${encodeURIComponent(e.token)}`, {}));
        dropUndo(ctx.env, e.token);
        results.push({ token: e.token, ok: true, message: String(res.result ?? res.undone) });
      } catch (error) {
        results.push({ token: e.token, ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    }
    ctx.out.result("nb.undo.session/1", { results }, (d) => d.results.map((r) => `${r.ok ? ctx.out.c.success(ctx.out.sym.done) : ctx.out.c.warning(ctx.out.sym.warn)} ${safe(r.message)}`));
    return results.every((r) => r.ok) ? 0 : 4;
  }
  const given = ctx.positionals[0];
  const entry = given ? log.find((e) => e.token.startsWith(given)) ?? { token: given } : log.at(-1);
  if (!entry) throw new CliError("NOT_FOUND", "Nothing to undo from the last 24 hours on this machine", { hint: "nb undo --list" });
  try {
    const res = /** @type {any} */ (await ctx.api.post(`/api/v1/undo/${encodeURIComponent(entry.token)}`, {}));
    dropUndo(ctx.env, entry.token);
    ctx.out.result("nb.undo/1", { token: entry.token, undone: res.undone, result: res.result }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${safe(d.result || `Undid: ${d.undone}`)}`);
  } catch (error) {
    if (error instanceof CliError && error.status === 410) dropUndo(ctx.env, entry.token);
    throw error;
  }
}
