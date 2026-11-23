// Meetings and decisions from the terminal (report 38.11 W12, plan A4.1b): lists. New meetings are made in the app
// until documents can be made from a template here (A6.35).
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {string} iso @param {string} tz */
const when = (iso, tz) => new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** nb meetings list [--week] [--past] @param {Context} ctx */
export async function list(ctx) {
  const id = ctx.requireWorkspace();
  const d = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/meetings`));
  const now = Date.now();
  let rows = /** @type {any[]} */ (d.meetings).filter((m) => m.startsAt);
  rows = ctx.flags.past ? rows.filter((m) => Date.parse(m.startsAt) < now) : rows.filter((m) => Date.parse(m.startsAt) + m.lengthMinutes * 60_000 >= now);
  if (ctx.flags.week) rows = rows.filter((m) => Date.parse(m.startsAt) < now + 7 * 86_400_000);
  rows.sort((a, b) => (ctx.flags.past ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));
  ctx.out.result("nb.meetings.list/1", { timeZone: d.timeZone, meetings: rows, openActionItems: d.openActionItems }, (r) => {
    if (!r.meetings.length) return ctx.flags.past ? "No past meetings" : "No meetings coming up";
    return [
      ...ctx.out.table([
        { title: "When", value: (m) => when(m.startsAt, r.timeZone) },
        { title: "Meeting", value: (m) => safe(m.title), flex: true },
        { title: "Length", value: (m) => `${m.lengthMinutes} min`, optional: true },
        { title: "Attendees", value: (m) => String(m.attendees), align: "right", optional: true },
      ], r.meetings),
      ctx.out.c.muted(`  times in ${r.timeZone} · ${r.openActionItems.length} open action ${r.openActionItems.length === 1 ? "item" : "items"}`),
    ];
  });
}

/** nb decisions list @param {Context} ctx */
export async function decisions(ctx) {
  const id = ctx.requireWorkspace();
  const d = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(id)}/decisions`));
  ctx.out.result("nb.decisions.list/1", { decisions: d.decisions }, (r) => {
    if (!r.decisions.length) return "No decisions recorded yet";
    return ctx.out.table([
      { title: "#", value: (x) => x.label },
      { title: "Decision", value: (x) => safe(x.title), flex: true },
      { title: "Status", value: (x) => x.status },
      { title: "Date", value: (x) => x.date ?? "—", optional: true },
    ], r.decisions);
  });
}
