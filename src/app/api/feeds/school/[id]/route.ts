import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { eventsOf, schoolOrg } from "@/lib/organizations/school-events-server";
import { occurrences } from "@/lib/organizations/school-events";
import { readSchoolYear } from "@/lib/organizations/school-year";
import { zonedInputToIso } from "@/lib/organizations/zoned-time";
import { isLooseUuid } from "@/lib/validations/uuid";
import { icsCalendar } from "@/lib/workflows/meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ITEMS = 500;

/**
 * Report 32.2 call 7 (plan B3.1c): a school's public feed — only events marked Show publicly and its holidays, for a
 * school anyone may see. No audience, owner or notes. Calendar apps can't sign in, so it's read as a visitor.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: raw } = await context.params;
  const id = raw.replace(/\.ics$/i, "");
  if (!isLooseUuid(id)) return new Response("Not found", { status: 404 });
  const o = await schoolOrg(id);
  if (!o || o.level !== "institution" || !(await getWorkspaceAccessById(id, null)).canRead) return new Response("Not found", { status: 404 });
  const year = readSchoolYear(o.settings);
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  const events = (await eventsOf([id])).filter((e) => e.fields.public && e.stage !== "cancelled")
    .flatMap((e) => occurrences(e.fields, today, until, year).map((day) => ({ uid: `${e.id}-${day}@networkbase`, title: e.title, day, end: e.fields.repeat ? day : e.fields.until ?? day, time: e.fields.time })));
  const holidays = (year?.days ?? []).filter((d) => d.kind === "holiday" && d.end >= today).map((d) => ({ uid: `${id}-${d.start}-holiday@networkbase`, title: d.name, day: d.start, end: d.end, time: null }));
  const url = `https://networkbase.in/org/${encodeURIComponent(o.slug || o.id)}?tab=about`;
  const body = icsCalendar([...events, ...holidays].slice(0, MAX_ITEMS).map((e) => ({ uid: e.uid, title: e.title, url, ...(e.time ? { startsAt: zonedInputToIso(`${e.day}T${e.time}`, o.zone), lengthMinutes: 60 } : { day: e.day, endDay: e.end }) })), new Date(), o.title);
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=900", "X-Robots-Tag": "noindex" } });
}

