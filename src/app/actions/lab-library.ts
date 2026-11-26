"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { readLabSettings } from "@/lib/organizations/lab";
import { NOTE_SECTIONS, sourceSchema, themeRows, type NoteSection, type ReadingState } from "@/lib/organizations/lab-library";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";
import { sourceKey } from "@/lib/workflows/literature";

/**
 * Report 35.4 (plan B6.4a, R3 calls 1–4, 8, 9): a research lab's Library. Sources are literature_sources rows whose
 * workspace is the lab; only the lab's members (not Viewers) read it, and it never reaches About (call 8). Lab notes are
 * shared and signed (call 2). Reading states and private notes are read and written only for the person (call 3);
 * nothing here counts or ranks people's reading. Themes are the lab's list with a people-set Disagrees (call 4).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const PAGE = 200;

async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, blocked: Boolean(a.writeBlocked), settings: readLabSettings(w.settings) };
}

/** A source of this lab, locked for a change when asked. */
async function sourceOf(tx: typeof db, orgId: string, id: string, lock = false) {
  if (!isLooseUuid(id)) return null;
  const [s] = Array.from(await tx.execute<{ id: string; added_by: string | null }>(sql`
    SELECT id, added_by FROM literature_sources WHERE id = ${id}::uuid AND workspace_id = ${orgId}::uuid ${lock ? sql`FOR UPDATE` : sql``}`));
  return s ?? null;
}

export type LibraryRow = { id: string; title: string; authors: string | null; year: number | null; venue: string | null; link: string | null; doi: string | null;
  themes: Array<{ theme: string; disagrees: boolean }>; notesBy: string[]; myState: ReadingState | null; iWroteNotes: boolean; code: boolean | null; data: boolean | null };

/** Library → All (members): newest first, 200 a page, with a title/author search; my state only, never others'. */
export async function readLibraryAction(orgId: string, opts: { q?: string; page?: number; mine?: boolean } = {}) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const q = typeof opts.q === "string" ? opts.q.trim().slice(0, 100) : "";
  const page = Number.isInteger(opts.page) && opts.page! > 0 ? Math.min(opts.page!, 50) : 0;
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = Array.from(await db.execute<{ id: string; title: string; authors: string | null; year: number | null; venue: string | null; link: string | null; doi: string | null;
    themes: LibraryRow["themes"] | null; notes_by: string[] | null; my_state: ReadingState | null; i_wrote: boolean; code: boolean | null; data: boolean | null }>(sql`
    SELECT s.id, s.title, s.authors, s.year, s.venue, s.link, s.doi, s.code_available AS code, s.data_available AS data,
      (SELECT jsonb_agg(jsonb_build_object('theme', t.theme, 'disagrees', t.disagrees) ORDER BY t.theme) FROM lab_source_themes t WHERE t.source_id = s.id) AS themes,
      (SELECT to_jsonb(array_agg(DISTINCT coalesce(p.full_name, p.username, 'Someone'))) FROM lab_source_notes n JOIN profiles p ON p.id = n.author_id WHERE n.source_id = s.id) AS notes_by,
      (SELECT r.state FROM lab_reading r WHERE r.source_id = s.id AND r.user_id = ${ctx.userId}::uuid) AS my_state,
      EXISTS (SELECT 1 FROM lab_source_notes n WHERE n.source_id = s.id AND n.author_id = ${ctx.userId}::uuid) AS i_wrote
    FROM literature_sources s
    WHERE s.workspace_id = ${orgId}::uuid ${q ? sql`AND (s.title ILIKE ${like} OR s.authors ILIKE ${like})` : sql``}
      ${opts.mine ? sql`AND EXISTS (SELECT 1 FROM lab_reading r WHERE r.source_id = s.id AND r.user_id = ${ctx.userId}::uuid)` : sql``}
    ORDER BY s.created_at DESC, s.id LIMIT ${PAGE + 1} OFFSET ${page * PAGE}`));
  const [counts] = Array.from(await db.execute<{ total: number; links: Array<{ theme: string; disagrees: boolean }> | null }>(sql`
    SELECT (SELECT count(*)::int FROM literature_sources WHERE workspace_id = ${orgId}::uuid) AS total,
      (SELECT jsonb_agg(jsonb_build_object('theme', t.theme, 'disagrees', t.disagrees)) FROM lab_source_themes t JOIN literature_sources s ON s.id = t.source_id WHERE s.workspace_id = ${orgId}::uuid) AS links`));
  return { success: true as const, admin: ctx.admin, writer: !ctx.blocked, themes: ctx.settings.themes, total: counts?.total ?? 0, more: rows.length > PAGE,
    themeRows: themeRows(counts?.links ?? [], ctx.settings.themes),
    rows: rows.slice(0, PAGE).map((r): LibraryRow => ({ id: r.id, title: r.title, authors: r.authors, year: r.year, venue: r.venue, link: r.link, doi: r.doi, themes: r.themes ?? [],
      notesBy: r.notes_by ?? [], myState: r.my_state, iWroteNotes: r.i_wrote, code: r.code, data: r.data })) };
}

/** + Add or Paste BibTeX / RIS (members): rows the browser read; one the lab has (same DOI or title) is "Already in the library". */
export async function addSourcesAction(orgId: string, input: unknown): Promise<{ success: true; added: number; already: string[] } | Failure> {
  const ctx = await lab(orgId);
  const parsed = z.array(sourceSchema).min(1).max(200).safeParse(input);
  if (!ctx || ctx.blocked) return DENIED;
  if (!parsed.success) return { success: false, error: "Every source needs a title; links start with https://." };
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-library:${orgId}`}))`);
    const [n] = Array.from(await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM literature_sources WHERE workspace_id = ${orgId}::uuid`));
    if ((n?.n ?? 0) + parsed.data.length > 5000) return { success: false as const, error: "The library holds up to 5,000 sources." };
    const have = new Set(Array.from(await tx.execute<{ title: string; doi: string | null }>(sql`SELECT title, doi FROM literature_sources WHERE workspace_id = ${orgId}::uuid`))
      .flatMap((r) => [sourceKey({ title: r.title, doi: null }), ...(r.doi ? [sourceKey({ title: r.title, doi: r.doi })] : [])]));
    const already: string[] = [];
    let added = 0;
    for (const s of parsed.data) {
      const keys = [sourceKey({ title: s.title, doi: null }), ...(s.doi ? [sourceKey(s)] : [])];
      if (keys.some((k) => have.has(k))) { already.push(s.title); continue; }
      keys.forEach((k) => have.add(k));
      await tx.execute(sql`INSERT INTO literature_sources (workspace_id, title, authors, year, venue, link, doi, added_by)
        VALUES (${orgId}::uuid, ${s.title}, ${s.authors || null}, ${s.year}, ${s.venue || null}, ${s.link || null}, ${s.doi || null}, ${ctx.userId}::uuid)`);
      added += 1;
    }
    return { success: true as const, added, already };
  });
}

/** Source page (members): details, signed lab notes, my reading (only mine), themes, and the theses that link it. */
export async function readSourceAction(orgId: string, id: string) {
  const ctx = await lab(orgId);
  if (!ctx || !isLooseUuid(id)) return DENIED;
  const [s] = Array.from(await db.execute<{ id: string; title: string; authors: string | null; year: number | null; venue: string | null; link: string | null; doi: string | null;
    code: boolean | null; data: boolean | null; added_by: string | null; added_by_name: string | null; suggested_by: string | null }>(sql`
    SELECT s.id, s.title, s.authors, s.year, s.venue, s.link, s.doi, s.code_available AS code, s.data_available AS data, s.added_by, s.suggested_by,
      (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = s.added_by) AS added_by_name
    FROM literature_sources s WHERE s.id = ${id}::uuid AND s.workspace_id = ${orgId}::uuid`));
  if (!s) return DENIED;
  const notes = Array.from(await db.execute<{ section: NoteSection; body: string; author: string | null; at: string }>(sql`
    SELECT n.section, n.body, (SELECT coalesce(p.full_name, p.username, 'Someone') FROM profiles p WHERE p.id = n.author_id) AS author, n.updated_at::text AS at
    FROM lab_source_notes n WHERE n.source_id = ${id}::uuid`));
  const [mine] = Array.from(await db.execute<{ state: ReadingState; note: string }>(sql`
    SELECT state, private_note AS note FROM lab_reading WHERE source_id = ${id}::uuid AND user_id = ${ctx.userId}::uuid`));
  const themes = Array.from(await db.execute<{ theme: string; disagrees: boolean; why: string }>(sql`SELECT theme, disagrees, why FROM lab_source_themes WHERE source_id = ${id}::uuid ORDER BY theme`));
  // Theses that link this source, only those this person can open as a member (thesis work is private).
  const citedBy = Array.from(await db.execute<{ id: string; title: string; slug: string | null }>(sql`
    SELECT DISTINCT w.id, w.title, w.slug FROM literature_sources l JOIN workspaces w ON w.id = l.workspace_id AND w.deleted_at IS NULL
    WHERE l.lab_source_id = ${id}::uuid AND (w.owner_id = ${ctx.userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${ctx.userId}::uuid)) LIMIT 20`));
  // B6.4b: the reading group sessions it was in.
  const sessions = Array.from(await db.execute<{ at: string; done: boolean }>(sql`
    SELECT starts_at::text AS at, done_at IS NOT NULL AS done FROM lab_reading_sessions WHERE source_id = ${id}::uuid AND org_id = ${orgId}::uuid ORDER BY starts_at DESC LIMIT 10`));
  return { success: true as const, source: s, notes, mine: mine ?? null, themes, citedBy, labThemes: ctx.settings.themes, admin: ctx.admin, sessions,
    suggested: Boolean(s.suggested_by), suggestedByMe: s.suggested_by === ctx.userId,
    canEdit: !ctx.blocked && (ctx.admin || s.added_by === ctx.userId), writer: !ctx.blocked };
}

const editSchema = sourceSchema.extend({ code: z.boolean().nullable(), data: z.boolean().nullable() }).strict();

/** Edit a source's details (whoever added it, the PI and Researchers). */
export async function editSourceAction(orgId: string, id: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = editSchema.safeParse(input);
  if (!ctx || ctx.blocked) return DENIED;
  if (!parsed.success) return { success: false, error: "Every source needs a title; links start with https://." };
  const d = parsed.data;
  const ok = await db.transaction(async (tx) => {
    const s = await sourceOf(tx as never, orgId, id, true);
    if (!s || !(ctx.admin || s.added_by === ctx.userId)) return false;
    await tx.execute(sql`UPDATE literature_sources SET title = ${d.title}, authors = ${d.authors || null}, year = ${d.year}, venue = ${d.venue || null}, link = ${d.link || null},
      doi = ${d.doi || null}, code_available = ${d.code}, data_available = ${d.data} WHERE id = ${id}::uuid`);
    return true;
  });
  return ok ? { success: true } : DENIED;
}

/** Remove a source (whoever added it, the PI and Researchers) — refused while a thesis links it (layer 12: merge instead). */
export async function removeSourceAction(orgId: string, id: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked) return DENIED;
  const out = await db.transaction(async (tx) => {
    const s = await sourceOf(tx as never, orgId, id, true);
    if (!s || !(ctx.admin || s.added_by === ctx.userId)) return "denied";
    const [linked] = Array.from(await tx.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM literature_sources WHERE lab_source_id = ${id}::uuid) AS ok`));
    if (linked?.ok) return "linked";
    await tx.execute(sql`DELETE FROM literature_sources WHERE id = ${id}::uuid`);
    return "ok";
  });
  if (out === "linked") return { success: false, error: "A thesis links this source, so it stays in the library." };
  return out === "ok" ? { success: true } : DENIED;
}

const noteSchema = z.object({ section: z.enum(Object.keys(NOTE_SECTIONS) as [NoteSection, ...NoteSection[]]), body: z.string().trim().max(5000) }).strict();

/** Lab notes (members write; the section shows who wrote it last). An empty section is removed. */
export async function saveLabNoteAction(orgId: string, id: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = noteSchema.safeParse(input);
  if (!ctx || ctx.blocked || !parsed.success) return DENIED;
  const { section, body } = parsed.data;
  const ok = await db.transaction(async (tx) => {
    if (!(await sourceOf(tx as never, orgId, id, true))) return false;
    if (!body) await tx.execute(sql`DELETE FROM lab_source_notes WHERE source_id = ${id}::uuid AND section = ${section}`);
    else await tx.execute(sql`INSERT INTO lab_source_notes (source_id, section, body, author_id) VALUES (${id}::uuid, ${section}, ${body}, ${ctx.userId}::uuid)
      ON CONFLICT (source_id, section) DO UPDATE SET body = EXCLUDED.body, author_id = EXCLUDED.author_id, updated_at = now()`);
    return true;
  });
  return ok ? { success: true } : DENIED;
}

const readingSchema = z.object({ state: z.enum(["to_read", "reading", "read"]).nullable(), note: z.string().max(5000) }).strict();

/** My reading (call 3): only this person's row, ever; no state clears it (the private note goes with it). */
export async function setMyReadingAction(orgId: string, id: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = readingSchema.safeParse(input);
  if (!ctx || !parsed.success) return DENIED;
  const { state, note } = parsed.data;
  if (!(await sourceOf(db, orgId, id))) return DENIED;
  if (!state) await db.execute(sql`DELETE FROM lab_reading WHERE source_id = ${id}::uuid AND user_id = ${ctx.userId}::uuid`);
  else await db.execute(sql`INSERT INTO lab_reading (source_id, user_id, state, private_note) VALUES (${id}::uuid, ${ctx.userId}::uuid, ${state}, ${note})
    ON CONFLICT (source_id, user_id) DO UPDATE SET state = EXCLUDED.state, private_note = EXCLUDED.private_note, updated_at = now()`);
  return { success: true };
}

const themeSchema = z.object({ theme: z.string().trim().min(1).max(60), on: z.boolean(), disagrees: z.boolean(), why: z.string().trim().max(300) }).strict();

/** Put a source in one of the lab's themes (members), with an optional Disagrees and a line on why (call 4). */
export async function setSourceThemeAction(orgId: string, id: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = themeSchema.safeParse(input);
  if (!ctx || ctx.blocked || !parsed.success) return DENIED;
  const t = parsed.data;
  if (t.on && !ctx.settings.themes.includes(t.theme)) return { success: false, error: "Pick one of the lab’s themes (set in Settings, under Lab)." };
  const ok = await db.transaction(async (tx) => {
    if (!(await sourceOf(tx as never, orgId, id, true))) return false;
    if (!t.on) await tx.execute(sql`DELETE FROM lab_source_themes WHERE source_id = ${id}::uuid AND theme = ${t.theme}`);
    else await tx.execute(sql`INSERT INTO lab_source_themes (source_id, theme, disagrees, why, set_by) VALUES (${id}::uuid, ${t.theme}, ${t.disagrees}, ${t.disagrees ? t.why : ""}, ${ctx.userId}::uuid)
      ON CONFLICT (source_id, theme) DO UPDATE SET disagrees = EXCLUDED.disagrees, why = EXCLUDED.why, set_by = EXCLUDED.set_by`);
    return true;
  });
  return ok ? { success: true } : DENIED;
}

/** The lab Overview's Library line (members): how big it is and what's on my list — mine only. */
export async function readLibraryCardAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const [r] = Array.from(await db.execute<{ total: number; to_read: number; reading: number }>(sql`
    SELECT (SELECT count(*)::int FROM literature_sources WHERE workspace_id = ${orgId}::uuid) AS total,
      (SELECT count(*)::int FROM lab_reading r JOIN literature_sources s ON s.id = r.source_id WHERE s.workspace_id = ${orgId}::uuid AND r.user_id = ${ctx.userId}::uuid AND r.state = 'to_read') AS to_read,
      (SELECT count(*)::int FROM lab_reading r JOIN literature_sources s ON s.id = r.source_id WHERE s.workspace_id = ${orgId}::uuid AND r.user_id = ${ctx.userId}::uuid AND r.state = 'reading') AS reading`));
  // B6.4b: the next reading group session, for This week.
  const [next] = Array.from(await db.execute<{ at: string; presenter: string | null; title: string | null }>(sql`
    SELECT r.starts_at::text AS at, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = r.presenter_id) AS presenter, (SELECT title FROM literature_sources WHERE id = r.source_id) AS title
    FROM lab_reading_sessions r WHERE r.org_id = ${orgId}::uuid AND r.done_at IS NULL AND r.starts_at > now() ORDER BY r.starts_at LIMIT 1`));
  return { success: true as const, admin: ctx.admin, total: r?.total ?? 0, toRead: r?.to_read ?? 0, reading: r?.reading ?? 0,
    next: next ? { at: new Date(next.at).toISOString(), presenter: next.presenter, title: next.title } : null };
}
