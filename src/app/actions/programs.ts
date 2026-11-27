"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { briefMarkdown, PROGRAM_STATES, programSchema, readProgram, type Measure, type ProgramMark, type ProgramState } from "@/lib/organizations/programs";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 37.5 (plan B8.3a, X4 calls 1–5): an Other organization's programs. Admins start a program from its brief (a
 * private workspace under the organization, marked Program, with an owner), with up to 5 measures. Hours come from X2's
 * shifts tagged to the program (checked in), sessions from the program's finished meetings, and typed numbers wait for
 * an admin's Confirm (every value kept as history). Members see programs they're in and public ones; admins see all.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function org(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "other" || !a.canRead || !(a.isOwner || a.isMember)) return null;
  return { userId, w, admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, member: !a.writeBlocked && (a.isOwner || a.memberRole !== "viewer") };
}

type Row = { id: string; title: string; slug: string | null; owner: string; owner_name: string | null; mark: ProgramMark; inside: boolean };
async function programs(orgId: string, userId: string, admin: boolean, only?: string) {
  return Array.from(await db.execute<Row>(sql`
    SELECT w.id, w.title, w.slug, w.owner_id AS owner, coalesce(p.full_name, p.username) AS owner_name, w.org_settings->'program' AS mark,
      EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL) OR w.owner_id = ${userId}::uuid AS inside
    FROM workspaces w LEFT JOIN profiles p ON p.id = w.owner_id
    WHERE w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND w.org_settings ? 'program' ${only ? sql`AND w.id = ${only}::uuid` : sql``}
      AND (${admin} OR coalesce((w.org_settings->'program'->>'public')::boolean, false) OR w.owner_id = ${userId}::uuid
        OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL))
    ORDER BY w.title LIMIT 100`));
}

/** The value of each measure: hours (checked-in shifts tagged to it), sessions (finished meetings in it), or the latest confirmed typed number. */
async function values(orgId: string, programId: string, measures: Measure[]) {
  const [hours] = Array.from(await db.execute<{ h: string | null }>(sql`
    SELECT sum(extract(epoch FROM ((t.type_fields->>'end')::timestamptz - (t.type_fields->>'start')::timestamptz)) / 3600)::text AS h
    FROM tasks t JOIN community_rsvps r ON r.task_id = t.id AND r.checked_in_at IS NOT NULL
    WHERE t.workspace_id = ${orgId}::uuid AND t.type_fields->>'kind' = 'shift' AND t.type_fields->>'programId' = ${programId} AND t.deleted_at IS NULL`));
  const [sessions] = Array.from(await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM workspace_documents WHERE workspace_id = ${programId}::uuid AND settings->>'section' = 'meetings' AND settings ? 'finishedAt'`));
  const typed = Array.from(await db.execute<{ measure_id: string; value: string | null; waiting: boolean }>(sql`
    SELECT measure_id, (SELECT n.value::text FROM program_numbers n WHERE n.program_id = ${programId}::uuid AND n.measure_id = x.measure_id AND n.state = 'confirmed' ORDER BY n.confirmed_at DESC LIMIT 1) AS value,
      EXISTS (SELECT 1 FROM program_numbers n WHERE n.program_id = ${programId}::uuid AND n.measure_id = x.measure_id AND n.state = 'waiting') AS waiting
    FROM (SELECT DISTINCT measure_id FROM program_numbers WHERE program_id = ${programId}::uuid) x`));
  return measures.map((m) => {
    const t = typed.find((x) => x.measure_id === m.id);
    const value = m.source === "hours" ? Math.round(Number(hours?.h ?? 0) * 10) / 10 : m.source === "sessions" ? sessions?.n ?? 0 : t?.value != null ? Number(t.value) : null;
    return { ...m, value, waiting: m.source === "typed" && Boolean(t?.waiting) };
  });
}

/** Programs (members): name, state, dates or Ongoing, owner, goal, measures with values; admins also the numbers waiting confirmation. */
export async function readProgramsAction(orgId: string) {
  const ctx = await org(orgId);
  if (!ctx) return DENIED;
  const rows = await programs(orgId, ctx.userId, ctx.admin);
  const out = [];
  for (const r of rows) out.push({ id: r.id, title: r.title, slug: r.inside || ctx.admin ? r.slug ?? r.id : null, owner: r.owner_name, canType: ctx.admin || (r.owner === ctx.userId && ctx.member),
    state: r.mark.state, start: r.mark.start, end: r.mark.end, goal: r.mark.goal, aim: r.mark.aim, public: r.mark.public, measures: await values(orgId, r.id, r.mark.measures ?? []) });
  const waiting = ctx.admin ? Array.from(await db.execute<{ id: string; program: string; measure_id: string; value: string; note: string; by: string | null; at: string }>(sql`
    SELECT n.id, w.title AS program, n.measure_id, n.value::text AS value, n.note, coalesce(p.full_name, p.username) AS by, n.typed_at AS at FROM program_numbers n
    JOIN workspaces w ON w.id = n.program_id LEFT JOIN profiles p ON p.id = n.typed_by WHERE n.org_id = ${orgId}::uuid AND n.state = 'waiting' ORDER BY n.typed_at LIMIT 100`)) : [];
  const people = ctx.admin ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 300`)) : [];
  return { success: true as const, admin: ctx.admin, people, programs: out,
    waiting: waiting.map((w) => ({ id: w.id, program: w.program, measure: rows.find((r) => r.title === w.program)?.mark.measures.find((m) => m.id === w.measure_id)?.name ?? w.measure_id, value: Number(w.value), note: w.note, by: w.by, at: new Date(w.at).toISOString() })) };
}

/** Start a program (admins): from its brief, a private workspace under the organization, marked Program, led by its owner. */
export async function startProgramAction(orgId: string, input: unknown): Promise<{ success: true; id: string; slug: string } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.admin) return DENIED;
  const parsed = programSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Give the program a name, an aim and an owner; up to 5 measures." };
  const d = parsed.data;
  if (new Set(d.measures.map((m) => m.id)).size !== d.measures.length) return { success: false, error: "Give the program a name, an aim and an owner; up to 5 measures." };
  const { createWorkspaceAction } = await import("@/lib/workspaces/server/lifecycle");
  const made = await createWorkspaceAction({
    title: d.title, description: `${d.aim} A program of ${ctx.w.title}.`.padEnd(20, "."), project_type: "other", custom_project_type: "Program", visibility: "private", status: "active",
    tags: [], technologies_used: [], lifecycle_stages: [], current_stage_index: 0, member_updates_enabled: true, member_file_upload_default: true, doc_edit_policy: "members", is_draft: false, metadata: {},
    readme: { mode: "skip", publishOnCreate: false, includeRoles: false }, parent_org_id: orgId, lead_user_id: d.ownerId,
  } as Parameters<typeof createWorkspaceAction>[0]);
  if (!made.success || !("project" in made) || !made.project) return { success: false, error: "error" in made && made.error ? made.error : "Couldn’t make the program workspace." };
  const mark: ProgramMark = { aim: d.aim, place: d.place, start: d.start, end: d.end, goal: d.goal, public: d.public, measures: d.measures, brief: d.brief, state: d.start && d.start > new Date().toISOString().slice(0, 10) ? "planned" : "running" };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('program', ${JSON.stringify(mark)}::jsonb) WHERE id = ${made.project.id}::uuid`);
  const { applyCreationIntentAction } = await import("@/app/actions/workspace/doc");
  await applyCreationIntentAction(made.project.id, { mode: "starter", publishOnCreate: true, includeRoles: false, starterContent: briefMarkdown(d.title, d.brief) }).catch(() => undefined);
  return { success: true, id: made.project.id, slug: made.project.slug ?? made.project.id };
}

/** Planned · Running · Paused · Closed (admins); closing keeps a note and the measures' history. */
export async function setProgramStateAction(orgId: string, programId: string, state: ProgramState, closingNote?: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.admin || !isLooseUuid(programId) || !PROGRAM_STATES.includes(state)) return DENIED;
  const note = typeof closingNote === "string" ? closingNote.trim().slice(0, 500) : "";
  const done = Array.from(await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{program}', org_settings->'program' || jsonb_build_object('state', ${state}::text${state === "closed" ? sql`, 'closingNote', ${note}::text` : sql``}))
    WHERE id = ${programId}::uuid AND parent_id = ${orgId}::uuid AND org_settings ? 'program' AND deleted_at IS NULL RETURNING id`));
  return done.length ? { success: true } : DENIED;
}

/** Type a number for a typed measure (the program's owner or admins); it waits for an admin's Confirm. */
export async function typeNumberAction(orgId: string, programId: string, measureId: string, value: number, note = ""): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(programId) || typeof measureId !== "string" || !(Number.isFinite(value) && value >= 0 && value < 1e12)) return DENIED;
  const [r] = await programs(orgId, ctx.userId, true, programId);
  if (!r || !(ctx.admin || r.owner === ctx.userId)) return DENIED;
  if (!(r.mark.measures ?? []).some((m) => m.id === measureId && m.source === "typed")) return { success: false, error: "Only typed measures take a number; hours and sessions count themselves." };
  await db.execute(sql`INSERT INTO program_numbers (org_id, program_id, measure_id, value, note, typed_by) VALUES (${orgId}::uuid, ${programId}::uuid, ${measureId}, ${Math.round(value * 100) / 100}, ${String(note).slice(0, 500)}, ${ctx.userId}::uuid)`);
  const admins = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role IN ('owner', 'admin') AND completed_at IS NULL LIMIT 20`));
  const slug = ctx.w.slug ?? orgId;
  for (const a of admins) if (a.id !== ctx.userId) await createNotification({ recipientUserId: a.id, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
    title: "Program numbers are waiting for confirmation", href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `program-numbers:${orgId}:${a.id}:${new Date().toISOString().slice(0, 10)}` }).catch(() => undefined);
  return { success: true };
}

/** Confirm (or decline) a typed number (admins). Only confirmed numbers reach reports and About; earlier values stay as history. */
export async function confirmNumberAction(orgId: string, numberId: string, confirm: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.admin || !isLooseUuid(numberId) || typeof confirm !== "boolean") return DENIED;
  const done = Array.from(await db.execute(sql`UPDATE program_numbers SET state = ${confirm ? "confirmed" : "declined"}, confirmed_by = ${ctx.userId}::uuid, confirmed_at = now()
    WHERE id = ${numberId}::uuid AND org_id = ${orgId}::uuid AND state = 'waiting' RETURNING id`));
  return done.length ? { success: true } : DENIED;
}

// ── B8.3b (report 37.5 calls 6–9): stories with consent, the impact report, About → Our programs ─────────────────────

type Person = { name: string; memberId: string | null; consent: { by: string; at: string; recordedBy: string } | null };
const allConsented = (people: Person[]) => people.every((p) => p.consent);

/** Write a story (the program's owner or admins): a headline, a few lines and the people named or shown in it. */
export async function saveStoryAction(orgId: string, programId: string, input: { headline: string; body: string; people: Array<{ name: string; memberId: string | null }> }): Promise<{ success: true; id: string } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(programId)) return DENIED;
  const [r] = await programs(orgId, ctx.userId, true, programId);
  if (!r || !(ctx.admin || r.owner === ctx.userId)) return DENIED;
  const headline = String(input?.headline ?? "").trim().slice(0, 140);
  if (!headline) return { success: false, error: "Give the story a headline." };
  const raw = (Array.isArray(input?.people) ? input.people : []).slice(0, 20);
  // Security review: a member named is checked against the organization's active members and named as their profile says,
  // so only they can give their yes (nobody can name themselves in someone else's place).
  const ids = [...new Set(raw.flatMap((p) => (p?.memberId && isLooseUuid(p.memberId) ? [p.memberId] : [])))];
  const members = ids.length ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL AND m.user_id = ANY(${`{${ids.join(",")}}`}::uuid[])`)) : [];
  if (members.length !== ids.length) return { success: false, error: "People marked as members are members of the organization." };
  const people: Person[] = raw.flatMap((p) => {
    const member = p?.memberId ? members.find((m) => m.id === p.memberId) : null;
    const name = member ? member.name.slice(0, 80) : String(p?.name ?? "").trim().slice(0, 80);
    return name ? [{ name, memberId: member?.id ?? null, consent: null }] : [];
  });
  const [made] = Array.from(await db.execute<{ id: string }>(sql`INSERT INTO program_stories (org_id, program_id, headline, body, people, created_by)
    VALUES (${orgId}::uuid, ${programId}::uuid, ${headline}, ${String(input?.body ?? "").slice(0, 4000)}, ${JSON.stringify(people)}::jsonb, ${ctx.userId}::uuid) RETURNING id`));
  const slug = ctx.w.slug ?? orgId;
  for (const p of people) if (p.memberId && p.memberId !== ctx.userId) await createNotification({ recipientUserId: p.memberId, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
    title: `You’re named in a story: “${headline}”. Your yes is needed before it’s shared`, href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `program-story-consent:${made!.id}:${p.memberId}` }).catch(() => undefined);
  return { success: true, id: made!.id };
}

/**
 * Consent for one person in a story: a member named gives (or withdraws) their own yes; for someone outside, the owner
 * records who gave it and when. Withdrawing unpublishes the story at once.
 */
export async function setStoryConsentAction(orgId: string, storyId: string, index: number, input: { give: boolean; by?: string; at?: string }): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(storyId) || !Number.isInteger(index) || index < 0 || typeof input?.give !== "boolean") return DENIED;
  return db.transaction(async (tx) => {
    const [s] = Array.from(await tx.execute<{ program_id: string; people: Person[]; owner: string }>(sql`
      SELECT s.program_id, s.people, w.owner_id AS owner FROM program_stories s JOIN workspaces w ON w.id = s.program_id WHERE s.id = ${storyId}::uuid AND s.org_id = ${orgId}::uuid FOR UPDATE OF s`));
    const p = s?.people[index];
    if (!s || !p) return DENIED;
    const canRecord = ctx.admin || s.owner === ctx.userId;
    // A member named decides for themselves; the owner records only for people outside the organization.
    if (p.memberId ? p.memberId !== ctx.userId : !canRecord) return DENIED;
    const consent = input.give ? { by: p.memberId ? p.name : String(input.by ?? "").trim().slice(0, 80) || p.name, at: typeof input.at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.at) ? input.at : new Date().toISOString().slice(0, 10), recordedBy: ctx.userId } : null;
    const people = s.people.map((x, i) => (i === index ? { ...x, consent } : x));
    await tx.execute(sql`UPDATE program_stories SET people = ${JSON.stringify(people)}::jsonb${input.give ? sql`` : sql`, state = 'draft', published_at = NULL`} WHERE id = ${storyId}::uuid`);
    return { success: true as const };
  });
}

/** Publish a story (the program's owner or admins): only once everyone named has consented (server test). */
export async function publishStoryAction(orgId: string, storyId: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(storyId)) return DENIED;
  const [s] = Array.from(await db.execute<{ people: Person[]; owner: string }>(sql`SELECT s.people, w.owner_id AS owner FROM program_stories s JOIN workspaces w ON w.id = s.program_id WHERE s.id = ${storyId}::uuid AND s.org_id = ${orgId}::uuid`));
  if (!s || !(ctx.admin || s.owner === ctx.userId)) return DENIED;
  if (!allConsented(s.people)) return { success: false, error: "Everyone named in the story gives their yes first." };
  await db.execute(sql`UPDATE program_stories SET state = 'published', published_at = now() WHERE id = ${storyId}::uuid AND state = 'draft' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(people) x WHERE x->'consent' IS NULL OR x->'consent' = 'null'::jsonb)`);
  return { success: true };
}

/** A program's stories (its people and admins; a member named sees the ones they're in, to give their yes). */
export async function readStoriesAction(orgId: string, programId: string) {
  const ctx = await org(orgId);
  if (!ctx || !isLooseUuid(programId)) return DENIED;
  const [r] = await programs(orgId, ctx.userId, ctx.admin, programId);
  const rows = Array.from(await db.execute<{ id: string; headline: string; body: string; people: Person[]; state: string; at: string | null }>(sql`
    SELECT id, headline, body, people, state, published_at AS at FROM program_stories WHERE program_id = ${programId}::uuid AND org_id = ${orgId}::uuid
      AND ((${Boolean(r)} AND state = 'published') OR ${Boolean(r) && (ctx.admin || r!.owner === ctx.userId || r!.inside)} OR people @> ${JSON.stringify([{ memberId: ctx.userId }])}::jsonb)
    ORDER BY created_at DESC LIMIT 50`));
  // Security review: drafts reach admins, the owner, the program's own people and those named; others see published ones.
  const canEdit = Boolean(r) && (ctx.admin || r!.owner === ctx.userId);
  return { success: true as const, canEdit, me: ctx.userId, stories: rows.map((s) => ({ id: s.id, headline: s.headline, body: s.body, state: s.state as "draft" | "published",
    people: s.people.map((p) => ({ name: p.name, member: Boolean(p.memberId), mine: p.memberId === ctx.userId, consent: p.consent ? { by: p.consent.by, at: p.consent.at } : null })) })) };
}

/**
 * The impact report (admins): a draft document for the year — a letter, the confirmed numbers per program (unconfirmed
 * ones say so), published stories with consent, and thanks. Finances and donors appear only when Money exists (not yet).
 */
export async function readImpactReportAction(orgId: string, year: number) {
  const ctx = await org(orgId);
  if (!ctx?.admin || !Number.isInteger(year) || year < 2000 || year > 2100) return DENIED;
  const rows = await programs(orgId, ctx.userId, true);
  const lines: string[] = [`# Impact report ${year}`, "", "## A letter", "_A few paragraphs from the director: the year in plain words._", "", "## Numbers"];
  for (const r of rows) {
    const ms = await values(orgId, r.id, r.mark.measures ?? []);
    if (!ms.length) continue;
    lines.push(`### ${r.title}`, ...ms.map((m) => `- ${m.name}: ${m.value === null ? "not yet confirmed" : m.target ? `${m.value} of ${m.target}` : m.value}`), "");
  }
  const stories = Array.from(await db.execute<{ headline: string; body: string; program: string }>(sql`
    SELECT s.headline, s.body, w.title AS program FROM program_stories s JOIN workspaces w ON w.id = s.program_id WHERE s.org_id = ${orgId}::uuid AND s.state = 'published'
      AND extract(year FROM s.published_at) = ${year} ORDER BY s.published_at LIMIT 20`));
  lines.push("## Stories", ...(stories.length ? stories.flatMap((s) => [`### ${s.headline}`, `_${s.program}_`, "", s.body, ""]) : ["_No published stories yet._", ""]));
  lines.push("## Thank you", "_The volunteers, partners and supporters who made it happen._", "");
  return { success: true as const, title: `Impact report ${year}`, markdown: lines.join("\n") };
}

/** About → Our programs (anyone who can see the organization): public programs, confirmed headline numbers, published stories. */
export async function readOurProgramsAction(orgId: string) {
  if (!isLooseUuid(orgId)) return DENIED;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null }>(sql`SELECT org_type AS type FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "other" || !a.canRead) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; title: string; mark: ProgramMark }>(sql`
    SELECT id, title, org_settings->'program' AS mark FROM workspaces WHERE parent_id = ${orgId}::uuid AND deleted_at IS NULL AND org_settings ? 'program'
      AND coalesce((org_settings->'program'->>'public')::boolean, false) AND org_settings->'program'->>'state' <> 'planned' ORDER BY title LIMIT 30`));
  const out = [];
  for (const r of rows) {
    const stories = Array.from(await db.execute<{ headline: string; body: string }>(sql`SELECT headline, body FROM program_stories WHERE program_id = ${r.id}::uuid AND state = 'published' ORDER BY published_at DESC LIMIT 3`));
    // Only confirmed numbers reach About (typed ones are confirmed; hours and sessions count themselves).
    out.push({ id: r.id, title: r.title, aim: r.mark.aim, goal: r.mark.goal, state: r.mark.state, measures: (await values(orgId, r.id, r.mark.measures ?? [])).filter((m) => m.value !== null).map((m) => ({ name: m.name, value: m.value, target: m.target })), stories });
  }
  return { success: true as const, programs: out };
}
