// nb message (report C4, M4d): your channels and direct messages from the terminal. The person's own sign-in only:
// the server refuses agents, and tokens need message:read / message:write.
import { CliError, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { ask } from "../tui/ask.mjs";
import { formatWhen } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx @returns {Promise<any[]>} */
async function conversations(ctx) {
  return /** @type {any} */ (await ctx.api.get("/api/v1/chat/conversations")).conversations ?? [];
}

/**
 * "#design", "@sam", a group's name or a number from `nb message list`. A channel name in several workspaces asks
 * which (--workspace picks; scripts get the choices). @param {Context} ctx @param {string | undefined} ref
 */
async function pick(ctx, ref) {
  if (!ref) throw usage("Which conversation?", "nb message read #design, @sam, or a number from nb message list");
  const all = await conversations(ctx);
  if (/^\d+$/.test(ref)) {
    const hit = all[Number(ref) - 1];
    if (!hit) throw new CliError("NOT_FOUND", `No conversation ${ref}`, { hint: "nb message list" });
    return hit;
  }
  const want = ref.toLowerCase();
  const ws = ctx.flags.workspace ? String(ctx.flags.workspace).toLowerCase() : null;
  const named = all.filter((c) => c.label.toLowerCase() === want || (!/^[#@]/.test(want) && c.label.toLowerCase() === `#${want}`));
  const hits = ws ? named.filter((c) => String(c.workspace ?? "").toLowerCase() === ws || String(c.workspaceId ?? "").toLowerCase() === ws) : named;
  if (hits.length === 1) return hits[0];
  if (!hits.length) {
    const near = all.filter((c) => c.label.toLowerCase().includes(want.replace(/^[#@]/, ""))).slice(0, 5).map((c) => (c.workspace ? `${c.label} (${c.workspace})` : c.label));
    throw new CliError("NOT_FOUND", `No conversation ${ref}`, { hint: near.length ? `Did you mean ${near.join(", ")}?` : "nb message list" });
  }
  const id = await ask(ctx, { key: "conversation", header: "Which", question: `${ref} is in ${hits.length} workspaces. Which one?`, options: hits.slice(0, 4).map((c) => ({ value: c.id, label: `${safe(c.label)} in ${safe(c.workspace ?? "no workspace")}` })) });
  return hits.find((c) => c.id === id) ?? hits[0];
}

/** nb message list. @param {Context} ctx */
export async function list(ctx) {
  const all = (await conversations(ctx)).filter((c) => !ctx.flags.unread || c.unread > 0);
  const { c } = ctx.out;
  ctx.out.result("nb.message.list/1", { conversations: all }, (d) => d.conversations.length ? [
    ...d.conversations.map((/** @type {any} */ m, /** @type {number} */ n) => `${String(n + 1).padStart(3)}  ${m.unread ? c.brand(ctx.out.sym.brand) : " "} ${safe(m.label).padEnd(22)} ${c.muted(safe(m.workspace ?? "").padEnd(16))} ${m.unread ? c.bold(`${m.unread} new`.padEnd(7)) : "".padEnd(7)} ${c.muted(m.lastAt ? formatWhen(m.lastAt) : "")}  ${safe(m.lastPreview ?? "").replace(/\n/g, " ").slice(0, 60)}`),
    c.muted("  nb message read <#channel|@person|n> · nb message send <#channel|@person> \"text\""),
  ] : ctx.flags.unread ? "Nothing unread" : "No conversations yet. Start one in the app: Messages", { page: true });
}

/** nb message read #design: the latest messages, oldest first, then marks them read. @param {Context} ctx */
export async function read(ctx) {
  const conv = await pick(ctx, ctx.positionals[0]);
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/chat/conversations/${encodeURIComponent(conv.id)}/messages`, { query: ctx.flags.before ? { before: Number(ctx.flags.before) } : {} }));
  /** @type {any[]} */
  const messages = res.messages ?? [];
  const last = messages.at(-1);
  if (last && !ctx.flags["keep-unread"] && !ctx.flags.before) await ctx.api.post(`/api/v1/chat/conversations/${encodeURIComponent(conv.id)}/read`, { seq: last.seq }).catch(() => {});
  const { c } = ctx.out;
  ctx.out.result("nb.message.read/1", { conversation: { id: conv.id, label: conv.label, workspace: conv.workspace }, messages }, (d) => d.messages.length ? [
    c.bold(safe(d.conversation.label)) + (d.conversation.workspace ? c.muted(` · ${safe(d.conversation.workspace)}`) : ""),
    ...d.messages.map((/** @type {any} */ m) => `${c.muted(String(m.seq).padStart(5))}  ${c.bold(safe(m.author))} ${c.muted(formatWhen(m.at))}${m.edited ? c.muted(" (edited)") : ""}\n       ${safe(m.text).replace(/\n/g, "\n       ")}${m.files.length ? c.muted(`\n       ${m.files.length} file${m.files.length === 1 ? "" : "s"}: ${m.files.map(safe).join(", ")}`) : ""}${m.replies ? c.muted(`\n       ${m.replies} repl${m.replies === 1 ? "y" : "ies"} (open in the app)`) : ""}`),
    c.muted(`  Older: nb message read ${d.conversation.label} --before ${d.messages[0].seq} · Reply: nb message send ${d.conversation.label} "text"`),
  ] : "No messages here yet", { page: true });
}

/** nb message send #design "text" [--reply <seq>]. @param {Context} ctx */
export async function send(ctx) {
  const [ref, ...words] = ctx.positionals;
  const text = String(ctx.flags.message ?? words.join(" ")).trim();
  if (!ref || !text) throw usage('nb message send <#channel|@person> "text"');
  const conv = await pick(ctx, ref);
  if (!conv.canReply) throw new CliError("FORBIDDEN", `You can't reply in ${conv.label}`, { hint: "nb message list" });
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/chat/conversations/${encodeURIComponent(conv.id)}/messages`, { text, ...(ctx.flags.reply ? { replyTo: Number(ctx.flags.reply) } : {}) }));
  ctx.out.result("nb.message.send/1", { conversation: conv.label, seq: res.seq }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Sent to ${safe(d.conversation)}`);
}
