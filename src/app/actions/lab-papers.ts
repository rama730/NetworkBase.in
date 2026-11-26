"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { readLabSettings } from "@/lib/organizations/lab";
import { authorListKey, LOCKED_STAGES, memberAuthors, moveProblem, paperSchema, type PaperFields, type PaperHistory, type PaperStage } from "@/lib/organizations/lab-papers";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";
import { statusForStage } from "@/lib/workflows/rules";

/**
 * Report 35.3 (plan B6.3a, R2 calls 1–10): a paper is a `paper` item in the lab workspace where the work lives. Its
 * workspace's writers and its member authors edit it; members of the lab read it, except a private paper, which only its
 * authors and the PI see (call 10). Every member author confirms the author list before Submitted (call 5), and with the
 * lab's internal review on, the PI approves a paper first (call 6). Rejected is recorded and returns to Drafting (call 3).
 * Deadlines and venues are typed; nothing is fetched or submitted anywhere (call 7). Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function paperContext(workspaceId: string) {
  if (!isLooseUuid(workspaceId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const [w] = Array.from(await db.execute<{ org: string; slug: string | null; title: string; owner: string; settings: unknown; lab_role: string | null }>(sql`
    SELECT o.id AS org, w.slug, w.title, o.owner_id AS owner, o.org_settings AS settings,
      (SELECT m.role FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL) AS lab_role
    FROM workspaces w JOIN workspaces o ON o.id = w.parent_id AND o.kind = 'organization' AND o.org_type = 'research' AND o.deleted_at IS NULL AND o.deletion_scheduled_at IS NULL
    WHERE w.id = ${workspaceId}::uuid AND w.kind = 'workspace' AND w.deleted_at IS NULL`));
  if (!w) return null;
  const a = await getWorkspaceAccessById(workspaceId, userId);
  const labMember = w.owner === userId || (w.lab_role !== null && w.lab_role !== "viewer");
  const member = a.isOwner || (a.isMember && Boolean(a.memberRole));
  if (!a.canRead || !(member || labMember)) return null;
  return { userId, orgId: w.org, slug: w.slug ?? workspaceId, title: w.title, pi: w.owner, isPi: w.owner === userId, blocked: Boolean(a.writeBlocked),
    writer: !a.writeBlocked && (a.isOwner || (a.isMember && a.memberRole !== "viewer")), settings: readLabSettings(w.settings) };
}

/** Call 10: a private paper only for its authors and the PI. */
const canSee = (me: string) => sql`(coalesce((t.type_fields->>'private')::boolean, false) = false OR t.type_fields->'authors' @> jsonb_build_array(jsonb_build_object('userId', ${me}::text))
  OR ${me}::uuid = (SELECT o.owner_id FROM workspaces o JOIN workspaces w2 ON w2.parent_id = o.id WHERE w2.id = t.workspace_id))`;

type Row = { id: string; title: string; stage: PaperStage; fields: PaperFields; workspace_id: string; workspace: string; slug: string | null };
async function paperRows(where: ReturnType<typeof sql>, me: string) {
  return Array.from(await db.execute<Row>(sql`
    SELECT t.id, t.title, t.stage, t.type_fields AS fields, t.workspace_id, w.title AS workspace, w.slug
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
    WHERE t.item_type = 'paper' AND t.deleted_at IS NULL AND ${where} AND ${canSee(me)}
    ORDER BY CASE WHEN t.stage IN ('published', 'withdrawn') THEN 1 ELSE 0 END, (t.type_fields->>'deadline') NULLS LAST, t.updated_at DESC LIMIT 300`));
}

async function namesFor(rows: Row[]) {
  const ids = [...new Set(rows.flatMap((r) => memberAuthors(r.fields.authors ?? [])))];
  if (!ids.length) return new Map<string, string>();
  return new Map(Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT id, coalesce(full_name, username, 'Someone') AS name FROM profiles WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).map((p) => [p.id, p.name]));
}

const shape = (r: Row, me: string, names: Map<string, string>, isPi: boolean, reviewOn: boolean) => {
  const f = r.fields;
  const key = authorListKey(f.authors ?? []);
  return { id: r.id, title: r.title, stage: r.stage, kind: f.kind, venue: f.venue, deadline: f.deadline, link: f.link, doi: f.doi, private: f.private, preprintPublic: f.preprintPublic,
    workspace: { id: r.workspace_id, title: r.workspace, slug: r.slug },
    authors: (f.authors ?? []).map((a) => ("userId" in a ? { userId: a.userId, name: names.get(a.userId) ?? "Someone", confirmed: f.confirmed?.[a.userId] === key } : { name: a.name })),
    mine: memberAuthors(f.authors ?? []).includes(me), iConfirmed: f.confirmed?.[me] === key, reviewed: Boolean(f.review && f.review.listKey === key),
    history: (f.history ?? []).slice(-20), canReview: isPi && r.stage === "internal_review", reviewOn };
};

/** A workspace's Papers (its members and the lab's members; private ones per call 10). */
export async function readPapersAction(workspaceId: string) {
  const ctx = await paperContext(workspaceId);
  if (!ctx) return DENIED;
  const rows = await paperRows(sql`t.workspace_id = ${workspaceId}::uuid`, ctx.userId);
  const names = await namesFor(rows);
  const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT DISTINCT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id IN (${workspaceId}::uuid, ${ctx.orgId}::uuid) AND m.role <> 'viewer' AND m.completed_at IS NULL AND p.deleted_at IS NULL ORDER BY 2 LIMIT 300`));
  return { success: true as const, me: ctx.userId, writer: ctx.writer, people, papers: rows.map((r) => shape(r, ctx.userId, names, ctx.isPi, ctx.settings.paperReview)) };
}

/** Add or edit a paper (the workspace's writers; on an existing paper, its member authors too). Member authors are people here. */
export async function savePaperAction(workspaceId: string, paperId: string | null, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await paperContext(workspaceId);
  const parsed = paperSchema.safeParse(input);
  if (!ctx || ctx.blocked || (paperId !== null && !isLooseUuid(paperId))) return DENIED;
  if (!parsed.success) return { success: false, error: "A paper needs a title, a kind and at least one author." };
  const { title, ...rest } = parsed.data;
  const members = memberAuthors(rest.authors);
  if (members.length) {
    const ok = Array.from(await db.execute<{ id: string }>(sql`
      SELECT DISTINCT user_id AS id FROM workspace_members WHERE workspace_id IN (${workspaceId}::uuid, ${ctx.orgId}::uuid) AND role <> 'viewer' AND completed_at IS NULL
        AND user_id = ANY(${`{${members.join(",")}}`}::uuid[])`));
    if (ok.length !== members.length) return { success: false, error: "Member authors are people in the lab; add others as typed names." };
  }
  if (!paperId) {
    if (!ctx.writer) return DENIED;
    const { insertTask } = await import("@/lib/organizations/assignments");
    const id = await db.transaction(async (tx) => {
      const tid = await insertTask(tx as never, { projectId: workspaceId, title, description: null, dueDate: null, sprintId: null, assigneeId: null, creatorId: ctx.userId,
        kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
      const fields: PaperFields = { ...rest, confirmed: {}, history: [{ stage: "idea", at: new Date().toISOString(), by: ctx.userId }], review: null };
      await tx.execute(sql`UPDATE tasks SET item_type = 'paper', stage = 'idea', status = ${statusForStage("paper", "idea")}, on_board = false, type_fields = ${JSON.stringify(fields)}::jsonb WHERE id = ${tid}::uuid`);
      return tid;
    });
    return { success: true, id };
  }
  const done = await db.transaction(async (tx) => {
    // Review: only a paper this person can see (call 10).
    const [p] = Array.from(await tx.execute<{ stage: PaperStage; fields: PaperFields }>(sql`
      SELECT t.stage, t.type_fields AS fields FROM tasks t WHERE t.id = ${paperId}::uuid AND t.workspace_id = ${workspaceId}::uuid AND t.item_type = 'paper' AND t.deleted_at IS NULL
        AND ${canSee(ctx.userId)} FOR UPDATE`));
    if (!p) return "denied";
    const author = memberAuthors(p.fields.authors ?? []).includes(ctx.userId);
    if (!(ctx.writer || author)) return "denied";
    // Review: from Submitted on, the author list and kind are what was sent.
    if (LOCKED_STAGES.includes(p.stage) && (authorListKey(rest.authors) !== authorListKey(p.fields.authors ?? []) || rest.kind !== p.fields.kind)) return "locked";
    // Review: only its member authors decide privacy and whether a preprint goes public (call 8).
    const fields: PaperFields = { ...p.fields, ...rest, ...(author ? {} : { private: p.fields.private, preprintPublic: p.fields.preprintPublic }) };
    await tx.execute(sql`UPDATE tasks SET title = ${title}, type_fields = ${JSON.stringify(fields)}::jsonb, updated_at = now() WHERE id = ${paperId}::uuid`);
    return "ok";
  });
  if (done === "locked") return { success: false, error: "Once it’s submitted, the authors and kind stay as sent. Withdraw it or move it to Revising first." };
  return done === "ok" ? { success: true, id: paperId } : DENIED;
}

/**
 * Confirm the author list (each member author, call 5). Review: an author who is active in the lab confirms even when the
 * workspace is private to them — they see the paper on the lab's Papers card.
 */
export async function confirmAuthorsAction(workspaceId: string, paperId: string): Promise<{ success: true } | Failure> {
  if (!isLooseUuid(workspaceId) || !isLooseUuid(paperId)) return DENIED;
  const { userId } = await getViewerAuthContext();
  if (!userId) return DENIED;
  const ok = await db.transaction(async (tx) => {
    const [p] = Array.from(await tx.execute<{ fields: PaperFields; active: boolean }>(sql`
      SELECT t.type_fields AS fields,
        (EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL) OR o.owner_id = ${userId}::uuid
          OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL)) AS active
      FROM tasks t JOIN workspaces w ON w.id = t.workspace_id JOIN workspaces o ON o.id = w.parent_id AND o.org_type = 'research' AND o.deleted_at IS NULL
        AND o.deletion_scheduled_at IS NULL AND o.suspended_at IS NULL AND o.status <> 'archived'
      WHERE t.id = ${paperId}::uuid AND t.workspace_id = ${workspaceId}::uuid AND t.item_type = 'paper' AND t.deleted_at IS NULL AND w.deleted_at IS NULL FOR UPDATE OF t`));
    if (!p?.active || !memberAuthors(p.fields.authors ?? []).includes(userId)) return false;
    const fields = { ...p.fields, confirmed: { ...(p.fields.confirmed ?? {}), [userId]: authorListKey(p.fields.authors) } };
    await tx.execute(sql`UPDATE tasks SET type_fields = ${JSON.stringify(fields)}::jsonb, updated_at = now() WHERE id = ${paperId}::uuid`);
    return true;
  });
  return ok ? { success: true } : DENIED;
}

const moveSchema = z.object({ to: z.enum(["drafting", "internal_review", "submitted", "revising", "accepted", "published", "withdrawn", "rejected"]),
  venue: z.string().trim().max(200).optional(), note: z.string().trim().max(1000).optional() }).strict();

/** Move a paper (writers and member authors): the rules of call 3, 5 and 6; Rejected is recorded and lands in Drafting. */
export async function movePaperAction(workspaceId: string, paperId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await paperContext(workspaceId);
  const parsed = moveSchema.safeParse(input);
  if (!ctx || ctx.blocked || !isLooseUuid(paperId) || !parsed.success) return DENIED;
  const { to, venue, note } = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [p] = Array.from(await tx.execute<{ title: string; stage: PaperStage; fields: PaperFields }>(sql`
      SELECT t.title, t.stage, t.type_fields AS fields FROM tasks t WHERE t.id = ${paperId}::uuid AND t.workspace_id = ${workspaceId}::uuid AND t.item_type = 'paper' AND t.deleted_at IS NULL
        AND ${canSee(ctx.userId)} FOR UPDATE`));
    if (!p) return { error: DENIED.error };
    if (!(ctx.writer || memberAuthors(p.fields.authors ?? []).includes(ctx.userId))) return { error: DENIED.error };
    const problem = moveProblem(p.fields, p.stage, to, ctx.settings.paperReview);
    if (problem) return { error: problem };
    const stage: PaperStage = to === "rejected" ? "drafting" : to;
    const entry: PaperHistory = { stage: to, at: new Date().toISOString(), by: ctx.userId, ...(venue || p.fields.venue ? { venue: venue || p.fields.venue } : {}), ...(note ? { note } : {}) };
    // Review: back to Drafting from internal review or Withdrawn asks the PI again.
    const clearReview = stage === "drafting" && (p.stage === "internal_review" || p.stage === "withdrawn");
    const fields: PaperFields = { ...p.fields, ...(venue ? { venue } : {}), ...(clearReview ? { review: null } : {}), history: [...(p.fields.history ?? []), entry].slice(-100) };
    await tx.execute(sql`UPDATE tasks SET stage = ${stage}, status = ${statusForStage("paper", stage)}, type_fields = ${JSON.stringify(fields)}::jsonb, updated_at = now() WHERE id = ${paperId}::uuid`);
    return { title: p.title, authors: memberAuthors(p.fields.authors ?? []) };
  });
  if ("error" in result) return { success: false, error: result.error! };
  const href = `/workspaces/${encodeURIComponent(ctx.slug)}`;
  const tell = to === "internal_review" ? [ctx.pi] : ["submitted", "accepted", "rejected", "published"].includes(to) ? result.authors : [];
  const word = to === "internal_review" ? "is waiting for your internal review" : to === "rejected" ? "was rejected; it’s back in Drafting" : `is ${to}`;
  for (const u of new Set(tell)) {
    if (u === ctx.userId) continue;
    await createNotification({ recipientUserId: u, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `${result.title} ${word}`, href, entityRefs: { projectId: workspaceId, projectSlug: ctx.slug }, dedupeKey: `lab-paper:${paperId}:${to}:${new Date().toISOString().slice(0, 16)}` }).catch(() => undefined);
  }
  return { success: true };
}

const reviewSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(2000) }).strict();

/** Internal review (the PI, call 6): approve this author list for submission, or return it to Drafting with a note. */
export async function reviewPaperAction(workspaceId: string, paperId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await paperContext(workspaceId);
  const parsed = reviewSchema.safeParse(input);
  if (!ctx?.isPi || ctx.blocked || !isLooseUuid(paperId) || !parsed.success) return DENIED;
  if (!parsed.data.approve && !parsed.data.note) return { success: false, error: "Say what to change, so the authors know." };
  const out = await db.transaction(async (tx) => {
    const [p] = Array.from(await tx.execute<{ title: string; stage: PaperStage; fields: PaperFields }>(sql`
      SELECT title, stage, type_fields AS fields FROM tasks WHERE id = ${paperId}::uuid AND workspace_id = ${workspaceId}::uuid AND item_type = 'paper' AND deleted_at IS NULL FOR UPDATE`));
    if (!p || p.stage !== "internal_review") return null;
    const at = new Date().toISOString();
    const fields: PaperFields = parsed.data.approve
      ? { ...p.fields, review: { approvedBy: ctx.userId, at, listKey: authorListKey(p.fields.authors), kind: p.fields.kind }, history: [...(p.fields.history ?? []), { stage: "internal_review" as const, at, by: ctx.userId, note: parsed.data.note || "Approved for submission" }].slice(-100) }
      : { ...p.fields, review: null, history: [...(p.fields.history ?? []), { stage: "drafting" as const, at, by: ctx.userId, note: parsed.data.note }].slice(-100) };
    const stage: PaperStage = parsed.data.approve ? "internal_review" : "drafting";
    await tx.execute(sql`UPDATE tasks SET stage = ${stage}, status = ${statusForStage("paper", stage)}, type_fields = ${JSON.stringify(fields)}::jsonb, updated_at = now() WHERE id = ${paperId}::uuid`);
    return { title: p.title, authors: memberAuthors(p.fields.authors ?? []) };
  });
  if (!out) return { success: false, error: "It isn’t waiting for internal review." };
  for (const u of out.authors) {
    if (u === ctx.userId) continue;
    await createNotification({ recipientUserId: u, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: parsed.data.approve ? `${out.title} is approved for submission` : `${out.title} is back in Drafting: ${parsed.data.note.slice(0, 80)}`,
      href: `/workspaces/${encodeURIComponent(ctx.slug)}`, entityRefs: { projectId: workspaceId, projectSlug: ctx.slug }, dedupeKey: `lab-paper-review:${paperId}:${Date.now()}` }).catch(() => undefined);
  }
  return { success: true };
}

/** The lab's Papers (lab members): every workspace's papers by stage, private ones per call 10; the PI's internal reviews first. */
export async function readLabPapersAction(orgId: string) {
  if (!isLooseUuid(orgId)) return DENIED;
  const { userId } = await getViewerAuthContext();
  if (!userId) return DENIED;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; owner: string; settings: unknown }>(sql`
    SELECT org_type AS type, owner_id AS owner, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || (a.isMember && a.memberRole !== "viewer"))) return DENIED;
  const rows = await paperRows(sql`w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL`, userId);
  const names = await namesFor(rows);
  const reviewOn = readLabSettings(w.settings).paperReview;
  return { success: true as const, isPi: w.owner === userId, papers: rows.map((r) => shape(r, userId, names, w.owner === userId, reviewOn)) };
}
