"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { createEventAction } from "@/app/actions/school-events";
import { saveSchoolYearAction } from "@/app/actions/school-year";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { eventsOf } from "@/lib/organizations/school-events-server";
import { kindOf, type ImportRow } from "@/lib/organizations/school-import";
import { planNextYear } from "@/lib/organizations/school-next-year";
import { readSchoolYear, schoolYearSchema, yearSpan } from "@/lib/organizations/school-year";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.2 calls 6 and the Import preview (plan B3.1d): Start next year (repeating events move to the same term
 * week, one-offs are ticked from a list) and Import… a CSV or .ics read in the browser (the server never fetches).
 * School admins only; never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function schoolCtx(schoolId: string) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  if (!auth.user || auth.tokenKind != null) return null;
  const a = await getWorkspaceAccessById(schoolId, auth.user.id);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown }>(sql`SELECT org_level AS level, org_settings AS settings FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canWrite || !(a.isOwner || a.memberRole === "admin")) return null;
  return { year: readSchoolYear(w.settings) };
}

async function plan(schoolId: string, input: unknown) {
  const ctx = await schoolCtx(schoolId);
  if (!ctx) return DENIED;
  if (!ctx.year) return { success: false as const, error: "Set up the school year first." };
  const parsed = schoolYearSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the school year." };
  if (yearSpan(parsed.data).start <= yearSpan(ctx.year).end) return { success: false as const, error: "The new year starts after this one ends." };
  const events = (await eventsOf([schoolId])).filter((e) => e.workspace_id === schoolId && e.stage !== "cancelled");
  return { success: true as const, year: parsed.data, ...planNextYear(events, ctx.year, parsed.data) };
}

/** The preview: what moves on its own, what's offered to tick, and what can't move. */
export async function previewNextYearAction(schoolId: string, input: unknown) {
  const r = await plan(schoolId, input);
  if (!r.success) return r;
  return { success: true as const, copy: r.copy.map((e) => ({ id: e.id, title: e.title, date: e.fields.date })), offer: r.offer.map((e) => ({ id: e.id, title: e.title, from: e.from, date: e.fields.date })), cannot: r.cannot };
}

/** Start next year: the new year replaces this one (classes follow it); repeats and ticked one-offs are added again. */
export async function startNextYearAction(schoolId: string, input: unknown, keep: string[]): Promise<{ success: true; added: number; classes: number } | Failure> {
  const r = await plan(schoolId, input);
  if (!r.success) return r;
  const saved = await saveSchoolYearAction(schoolId, r.year);
  if (!saved.success) return saved;
  const ticked = new Set(Array.isArray(keep) ? keep.slice(0, 500) : []);
  let added = 0;
  for (const e of [...r.copy, ...r.offer.filter((o) => ticked.has(o.id))]) if ((await createEventAction(schoolId, e.title, e.fields)).success) added += 1;
  return { success: true, added, classes: saved.classes };
}

/** Import…: holidays, staff days and half days join the year; the rest become school events. Rows are checked again here. */
export async function importSchoolCalendarAction(schoolId: string, rows: ImportRow[]): Promise<{ success: true; days: number; events: number } | Failure> {
  const ctx = await schoolCtx(schoolId);
  if (!ctx) return DENIED;
  if (!Array.isArray(rows) || !rows.length || rows.length > 300) return { success: false, error: "Import 1–300 rows at a time." };
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ok = rows.filter((r) => r && typeof r.name === "string" && r.name.trim() && DATE.test(String(r.start)) && DATE.test(String(r.end)) && r.end >= r.start)
    .map((r) => ({ ...r, name: r.name.trim().slice(0, 60), kind: (["holiday", "staff", "half", "event"] as const).includes(r.kind) ? r.kind : kindOf(r.name) }));
  const days = ok.filter((r) => r.kind !== "event");
  if (days.length) {
    if (!ctx.year) return { success: false, error: "Set up the school year first; holidays sit inside its terms." };
    const have = new Set(ctx.year.days.map((d) => `${d.name}|${d.start}`));
    const merged = { ...ctx.year, days: [...ctx.year.days, ...days.filter((d) => !have.has(`${d.name}|${d.start}`)).map((d) => ({ name: d.name, kind: d.kind as "holiday" | "staff" | "half", start: d.start, end: d.end }))] };
    const saved = await saveSchoolYearAction(schoolId, merged);
    if (!saved.success) return saved;
  }
  let events = 0;
  for (const e of ok.filter((r) => r.kind === "event")) {
    const fields = { type: "event", date: e.start, until: e.end > e.start ? e.end : null, time: e.time || null, place: String(e.place ?? "").slice(0, 120) };
    if ((await createEventAction(schoolId, e.name, fields)).success) events += 1;
  }
  return { success: true, days: days.length, events };
}
