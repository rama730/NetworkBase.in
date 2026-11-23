// Content from the terminal (report 38.8 W12, plan A2.9): add, list, ideas and mark published.
import { parseDate } from "../dates.mjs";
import { usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { resolveTask } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx */
async function readAll(ctx) {
  const id = ctx.requireWorkspace();
  return /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/content`));
}

/** "2026-12-03T10:00", "2026-12-03 10:00", "2026-12-03" or "friday" → { day, time? }. @param {string} text */
export function parsePublish(text) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]([01]\d|2[0-3]):([0-5]\d))?$/.exec(text.trim());
  if (m) return { day: m[1], ...(m[2] ? { time: `${m[2]}:${m[3]}` } : {}) };
  const day = parseDate(text);
  return day ? { day } : null;
}

/** @param {any} r @param {string} tz */
const when = (r, tz) => (r.publishAt ? new Date(r.publishAt).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

/** @param {Context} ctx @param {any} d @param {any[]} rows @param {string} empty */
function table(ctx, d, rows, empty) {
  ctx.out.result("nb.content.list/1", { timeZone: d.timeZone, items: rows }, (r) => {
    if (!r.items.length) return empty;
    return [
      ...ctx.out.table([
        { title: "#", value: (q) => String(q.number ?? ""), align: "right" },
        { title: "Piece", value: (q) => safe(q.title), flex: true },
        { title: "Channels", value: (q) => q.channels.join(", ") || "—", optional: true },
        { title: "Stage", value: (q) => String(q.stage ?? "idea") },
        { title: "Publishes", value: (q) => when(q, r.timeZone) },
        { title: "Writer", value: (q) => safe(q.writer ?? "—"), optional: true },
      ], r.items),
      ctx.out.c.muted(`  ${r.items.length} ${r.items.length === 1 ? "piece" : "pieces"} · times in ${r.timeZone}`),
    ];
  });
}

/** nb content list [--week] @param {Context} ctx */
export async function list(ctx) {
  const d = await readAll(ctx);
  // A2.9 live check: canceled pieces stay in history, not in the list.
  let rows = /** @type {any[]} */ (d.items).filter((r) => r.stage !== "idea" && r.stage !== "cancelled");
  if (ctx.flags.week) {
    const now = new Date(), monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
    const end = monday.getTime() + 7 * 86_400_000;
    rows = rows.filter((r) => r.publishAt && Date.parse(r.publishAt) >= monday.getTime() && Date.parse(r.publishAt) < end);
  }
  rows.sort((a, b) => (a.publishAt ? Date.parse(a.publishAt) : Infinity) - (b.publishAt ? Date.parse(b.publishAt) : Infinity));
  table(ctx, d, rows, ctx.flags.week ? "Nothing publishing this week" : "No content here yet");
}

/** nb content ideas: the Ideas rail. @param {Context} ctx */
export async function ideas(ctx) {
  const d = await readAll(ctx);
  table(ctx, d, d.items.filter((/** @type {any} */ r) => r.stage === "idea"), "No ideas yet · nb content add \"<title>\" saves one");
}

/** nb content add "<title>" [--channels blog,linkedin] [--type article] [--publish 2026-12-03T10:00] @param {Context} ctx */
export async function add(ctx) {
  const title = ctx.positionals.join(" ").trim();
  if (!title) throw usage('nb content add "<title>" [--channels blog,linkedin] [--type article] [--publish 2026-12-03T10:00]');
  const d = await readAll(ctx);
  if (!d.channels.length) throw usage("Content isn't set up here yet", "An owner or admin picks the channels on the Content tab first");
  const channels = ctx.flags.channels ? String(ctx.flags.channels).split(",").map((c) => c.trim().toLowerCase()).filter(Boolean) : [];
  for (const c of channels) if (!d.channels.some((/** @type {any} */ x) => x.id === c)) throw usage(`No channel "${c}"`, `Channels here: ${d.channels.map((/** @type {any} */ x) => x.id).join(", ")}`);
  const type = ctx.flags.type ? d.types.find((/** @type {any} */ t) => t.id === String(ctx.flags.type).toLowerCase() || t.name.toLowerCase() === String(ctx.flags.type).toLowerCase()) : null;
  if (ctx.flags.type && !type) throw usage(`No content type "${ctx.flags.type}"`, `Types here: ${d.types.map((/** @type {any} */ t) => t.id).join(", ")}`);
  const publish = ctx.flags.publish === undefined ? null : parsePublish(String(ctx.flags.publish));
  if (ctx.flags.publish !== undefined && !publish) throw usage(`--publish ${ctx.flags.publish} isn't a date I know`, "Try 2026-12-03T10:00, 2026-12-03 or friday");
  const typeFields = { ...(channels.length ? { channels } : {}), ...(type ? { contentType: type.id } : {}), ...(publish?.time ? { publishTime: publish.time } : {}) };
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/extension/create-task", { projectId: ctx.requireWorkspace(), title, itemType: "content", stage: publish ? "drafting" : "idea", typeFields, ...(publish ? { dueDate: publish.day } : {}) }));
  const task = res.task ?? res;
  ctx.out.result("nb.content.add/1", { id: task.id, number: task.taskNumber, title: task.title ?? title, stage: publish ? "drafting" : "idea" },
    (r) => `${ctx.out.c.success(ctx.out.sym.done)} #${r.number} ${safe(r.title)} · ${r.stage === "idea" ? "in Ideas" : `Drafting · publishes ${publish?.day}${publish?.time ? ` ${publish.time}` : ""}`}`);
}

/** nb content published <n> --link linkedin=https://… (one per channel; links are never opened) @param {Context} ctx */
export async function published(ctx) {
  const [ref] = ctx.positionals;
  const links = /** @type {string[]} */ (ctx.flags.link ?? []);
  if (!ref || !links.length) throw usage("nb content published <piece> --link channel=https://…");
  /** @type {Record<string, { link: string }>} */
  const body = {};
  for (const l of links) {
    const at = l.indexOf("=");
    if (at < 1) throw usage(`--link ${l}: write it as channel=https://…`);
    body[l.slice(0, at).trim().toLowerCase()] = { link: l.slice(at + 1).trim() };
  }
  const task = await resolveTask(ctx, String(ref), { brief: true });
  const res = /** @type {any} */ (await ctx.api.patch("/api/v1/extension/task-update", { projectId: ctx.requireWorkspace(), taskId: task.id, kind: "content_published", links: body }));
  ctx.out.result("nb.content.published/1", { number: task.taskNumber, state: res.state ?? null },
    (r) => `${ctx.out.c.success(ctx.out.sym.done)} #${r.number} ${r.state === "all" ? "Published" : "marked published on those channels"}`);
}
