"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { readWorkspaceFileText } from "@/lib/files/content-reader";
import { createNotification } from "@/lib/notifications/service";
import { processSteps } from "@/lib/organizations/doc-rules";
import { readLabSettings } from "@/lib/organizations/lab";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.5 (plan B6.2a, R4 calls 1, 6): a lab's protocols are its documents made from the Protocol template. A
 * version's text is frozen when someone asks to approve it; the PI (and Researchers if the lab allows) approves it,
 * which retires the one before — so v2 can be drafted while v1 stays usable. Trainers (or the PI and Researchers) sign
 * people off as Trained. Members read protocols; viewers and visitors don't. Never a token; agents never approve.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; owner: string; slug: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, owner_id AS owner, slug, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  const settings = readLabSettings(w.settings);
  const pi = a.isOwner;
  const admin = pi || a.memberRole === "admin";
  return { userId, owner: w.owner, slug: w.slug ?? orgId, pi, admin, blocked: Boolean(a.writeBlocked), access: a, settings,
    approver: !a.writeBlocked && (pi || (admin && settings.protocolApprovers === "researchers")) };
}

/** Review: a draft page only for admins and its owner; a leaders-only page only for admins (as runProcessAction and Documents). */
const visible = (admin: boolean, me: string) => sql`(${admin} OR ((coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft' OR d.settings->'org'->>'owner' = ${me}::text)
  AND coalesce(d.settings->>'visibilityOverride', '') <> 'leaders_only'))`;

/** A protocol document of this lab (made from the Protocol template) that this person may see. */
async function protocolDoc(orgId: string, docId: string, ctx: { admin: boolean; userId: string }) {
  if (!isLooseUuid(docId)) return null;
  const [d] = Array.from(await db.execute<{ id: string; filename: string; node: string | null; published: string | null; owner: string | null; lifecycle: string | null }>(sql`
    SELECT d.id, d.filename, d.linked_node_id AS node, d.published_version_id AS published, d.settings->'org'->>'owner' AS owner, d.settings->'org'->>'lifecycle' AS lifecycle
    FROM workspace_documents d WHERE d.id = ${docId}::uuid AND d.workspace_id = ${orgId}::uuid AND d.settings->>'kind' = 'protocol' AND ${visible(ctx.admin, ctx.userId)}`));
  return d ?? null;
}

const titleOf = (filename: string) => filename.replace(/\.md$/i, "");

/** Lab Overview → Protocols (members): name, Approved and Draft versions, needs training with my status, owner. */
export async function readProtocolsAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; filename: string; slug: string; owner: string | null; review_by: string | null; approved: number | null; draft: number | null; needs: boolean | null; trained: boolean }>(sql`
    SELECT d.id, d.filename, d.slug, coalesce(p.full_name, p.username) AS owner, d.settings->'org'->>'reviewBy' AS review_by,
      (SELECT v.version FROM lab_protocol_versions v WHERE v.doc_id = d.id AND v.state = 'approved') AS approved,
      (SELECT v.version FROM lab_protocol_versions v WHERE v.doc_id = d.id AND v.state = 'draft') AS draft,
      lp.needs_training AS needs, EXISTS (SELECT 1 FROM lab_trainings t WHERE t.doc_id = d.id AND t.user_id = ${ctx.userId}::uuid) AS trained
    FROM workspace_documents d LEFT JOIN lab_protocols lp ON lp.doc_id = d.id LEFT JOIN profiles p ON p.id::text = d.settings->'org'->>'owner'
    WHERE d.workspace_id = ${orgId}::uuid AND d.settings->>'kind' = 'protocol' AND ${visible(ctx.admin, ctx.userId)}
    ORDER BY d.filename LIMIT 300`));
  return { success: true as const, slug: ctx.slug, protocols: rows.map((r) => ({ id: r.id, title: titleOf(r.filename), slug: r.slug, owner: r.owner, reviewBy: r.review_by,
    approved: r.approved, draft: r.draft, needsTraining: r.needs === true, trained: r.trained })) };
}

/** One protocol (members): its versions, trainers, who's trained (PI, Researchers, trainers) and what I can do. */
export async function readProtocolAction(orgId: string, docId: string) {
  const ctx = await lab(orgId);
  const d = ctx ? await protocolDoc(orgId, docId, ctx!) : null;
  if (!ctx || !d) return DENIED;
  const [lp] = Array.from(await db.execute<{ needs: boolean; trainers: string[] }>(sql`SELECT needs_training AS needs, trainers FROM lab_protocols WHERE doc_id = ${docId}::uuid`));
  const trainers = lp?.trainers ?? [];
  const canTrain = !ctx.blocked && (ctx.admin || trainers.includes(ctx.userId));
  const versions = Array.from(await db.execute<{ id: string; version: number; state: "draft" | "approved" | "retired"; by: string | null; at: string | null; created: string; content: string }>(sql`
    SELECT v.id, v.version, v.state, coalesce(p.full_name, p.username) AS by, v.approved_at::text AS at, v.created_at::text AS created,
      CASE WHEN v.state = 'draft' AND ${ctx.approver} THEN v.content ELSE '' END AS content
    FROM lab_protocol_versions v LEFT JOIN profiles p ON p.id = v.approved_by WHERE v.doc_id = ${docId}::uuid ORDER BY v.version DESC LIMIT 50`));
  const people = canTrain ? Array.from(await db.execute<{ id: string; name: string | null; username: string | null; trained: boolean; signed: string | null; trainer: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username, t.user_id IS NOT NULL AS trained, t.signed_at::text AS signed, coalesce(tp.full_name, tp.username) AS trainer
    FROM workspace_members m JOIN profiles p ON p.id = m.user_id LEFT JOIN lab_trainings t ON t.doc_id = ${docId}::uuid AND t.user_id = m.user_id LEFT JOIN profiles tp ON tp.id = t.trainer_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL AND p.deleted_at IS NULL
      AND (m.user_id = ${ctx.userId}::uuid OR NOT app_private.blocked_between(${ctx.userId}::uuid, m.user_id))
    ORDER BY coalesce(p.full_name, p.username) LIMIT 500`)) : [];
  const [mine] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM lab_trainings WHERE doc_id = ${docId}::uuid AND user_id = ${ctx.userId}::uuid) AS ok`));
  return { success: true as const, approver: ctx.approver, canTrain, canEdit: !ctx.blocked && (ctx.admin || d.owner === ctx.userId), me: ctx.userId,
    needsTraining: lp?.needs === true, trainers, trained: Boolean(mine?.ok), versions,
    people: people.map((p) => ({ id: p.id, name: p.name ?? p.username ?? "Someone", trained: p.trained, signedAt: p.signed, trainer: p.trainer })) };
}

/** The page's current text: the file members edit, else what's published. */
async function currentText(ctx: NonNullable<Awaited<ReturnType<typeof lab>>>, orgId: string, d: NonNullable<Awaited<ReturnType<typeof protocolDoc>>>) {
  if (d.node && ctx.access.project) {
    const text = await readWorkspaceFileText({ ...ctx.access, project: ctx.access.project }, orgId, d.node).catch(() => null);
    if (text) return text;
  }
  if (!d.published) return null;
  const [v] = Array.from(await db.execute<{ content: string }>(sql`SELECT content FROM workspace_document_versions WHERE id = ${d.published}::uuid`));
  return v?.content ?? null;
}

/** Ask to approve (any member but viewers): freezes the page's text as the next version's Draft; approvers hear it (Normal). */
export async function askApproveProtocolAction(orgId: string, docId: string): Promise<{ success: true; version: number } | Failure> {
  const ctx = await lab(orgId);
  const d = ctx ? await protocolDoc(orgId, docId, ctx!) : null;
  if (!ctx || ctx.blocked || !d) return DENIED;
  // Review: the page's live text only for people who edit it (admins, its owner); others freeze what's published.
  const editor = ctx.admin || d.owner === ctx.userId;
  const text = editor ? await currentText(ctx, orgId, d) : await currentText({ ...ctx, access: { ...ctx.access, project: null } } as never, orgId, d);
  if (!text || !processSteps(text).length) return { success: false, error: "A protocol needs Steps before it can be approved." };
  if (text.length > 200_000) return { success: false, error: "This protocol is too long to version. Move detail into Files." };
  const version = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-protocol:${docId}`}))`);
    await tx.execute(sql`INSERT INTO lab_protocols (doc_id, workspace_id) VALUES (${docId}::uuid, ${orgId}::uuid) ON CONFLICT DO NOTHING`);
    const [open] = Array.from(await tx.execute<{ version: number; requested_by: string | null }>(sql`SELECT version, requested_by FROM lab_protocol_versions WHERE doc_id = ${docId}::uuid AND state = 'draft'`));
    if (open) {
      // Only the person who asked, the page's owner or an admin replaces an open Draft (review).
      if (!editor && open.requested_by !== ctx.userId) return null;
      await tx.execute(sql`UPDATE lab_protocol_versions SET content = ${text}, requested_by = ${ctx.userId}::uuid, created_at = clock_timestamp() WHERE doc_id = ${docId}::uuid AND state = 'draft'`);
      return open.version;
    }
    const [next] = Array.from(await tx.execute<{ version: number }>(sql`
      INSERT INTO lab_protocol_versions (workspace_id, doc_id, version, state, content, requested_by)
      VALUES (${orgId}::uuid, ${docId}::uuid, (SELECT coalesce(max(version), 0) + 1 FROM lab_protocol_versions WHERE doc_id = ${docId}::uuid), 'draft', ${text}, ${ctx.userId}::uuid)
      RETURNING version`));
    return next!.version;
  });
  if (version === null) return { success: false, error: "A draft is already waiting for approval." };
  const approvers = ctx.settings.protocolApprovers === "researchers" ? Array.from(await db.execute<{ who: string }>(sql`
    SELECT user_id AS who FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role = 'admin' AND completed_at IS NULL`)) : [];
  for (const a of [{ who: ctx.owner }, ...approvers]) {
    if (a.who === ctx.userId) continue;
    await createNotification({ recipientUserId: a.who, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `${titleOf(d.filename)} v${version} is waiting for approval`, href: `/org/${encodeURIComponent(ctx.slug)}?tab=docs`,
      entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `lab-protocol-ask:${docId}:${version}` }).catch(() => undefined);
  }
  return { success: true, version };
}

/** Approve (approvers): the Draft becomes Approved and the one before is Retired; only Approved versions are run (call 1). */
export async function approveProtocolAction(orgId: string, docId: string, version: number, seen: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const d = ctx ? await protocolDoc(orgId, docId, ctx!) : null;
  if (!ctx?.approver || !d || !Number.isInteger(version) || typeof seen !== "string") return DENIED;
  const ok = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-protocol:${docId}`}))`);
    // Review: approve exactly the text the approver saw — a draft updated since is refused.
    const [draft] = Array.from(await tx.execute<{ id: string }>(sql`SELECT id FROM lab_protocol_versions WHERE doc_id = ${docId}::uuid AND version = ${version} AND state = 'draft' AND created_at::text = ${seen}`));
    if (!draft) return false;
    await tx.execute(sql`UPDATE lab_protocol_versions SET state = 'retired' WHERE doc_id = ${docId}::uuid AND state = 'approved'`);
    await tx.execute(sql`UPDATE lab_protocol_versions SET state = 'approved', approved_by = ${ctx.userId}::uuid, approved_at = now() WHERE id = ${draft.id}::uuid`);
    return true;
  });
  return ok ? { success: true } : { success: false, error: "That draft changed or was already decided. Look again before approving." };
}

/** Retire the Approved version (approvers): nothing can be run until a new version is approved; entries keep their link. */
export async function retireProtocolAction(orgId: string, docId: string, version: number): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const d = ctx ? await protocolDoc(orgId, docId, ctx!) : null;
  if (!ctx?.approver || !d || !Number.isInteger(version)) return DENIED;
  const done = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-protocol:${docId}`}))`);
    return Array.from(await tx.execute(sql`UPDATE lab_protocol_versions SET state = 'retired' WHERE doc_id = ${docId}::uuid AND state = 'approved' AND version = ${version} RETURNING id`)).length > 0;
  });
  return done ? { success: true } : { success: false, error: "That draft changed or was already decided. Look again before approving." };
}

const settingsSchema = z.object({ needsTraining: z.boolean(), trainers: z.array(z.string().uuid()).max(20) }).strict();

/** Per protocol (the PI, Researchers, the page's owner): needs training, and who trains. Trainers are lab members. */
export async function saveProtocolSettingsAction(orgId: string, docId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const d = ctx ? await protocolDoc(orgId, docId, ctx!) : null;
  const parsed = settingsSchema.safeParse(input);
  if (!ctx || ctx.blocked || !d || !(ctx.admin || d.owner === ctx.userId) || !parsed.success) return DENIED;
  const [current] = Array.from(await db.execute<{ trainers: string[] }>(sql`SELECT trainers FROM lab_protocols WHERE doc_id = ${docId}::uuid`));
  // Review: the page's owner sets Needs training; only the PI and Researchers choose trainers.
  const trainers = ctx.admin ? [...new Set(parsed.data.trainers)] : current?.trainers ?? [];
  if (trainers.length) {
    const ok = Array.from(await db.execute<{ id: string }>(sql`
      SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL AND user_id = ANY(${`{${trainers.join(",")}}`}::uuid[])`));
    if (ok.length !== trainers.length) return { success: false, error: "Trainers are people in the lab." };
  }
  await db.execute(sql`INSERT INTO lab_protocols (doc_id, workspace_id, needs_training, trainers) VALUES (${docId}::uuid, ${orgId}::uuid, ${parsed.data.needsTraining}, ${JSON.stringify(trainers)}::jsonb)
    ON CONFLICT (doc_id) DO UPDATE SET needs_training = excluded.needs_training, trainers = excluded.trainers, updated_at = now()`);
  return { success: true };
}

/** Sign off (a trainer, the PI or a Researcher): the person is Trained on this protocol, with the trainer's name and date. */
export async function signOffTrainingAction(orgId: string, docId: string, userId: string, trained: boolean): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const d = ctx ? await protocolDoc(orgId, docId, ctx!) : null;
  if (!ctx || ctx.blocked || !d || !isLooseUuid(userId) || typeof trained !== "boolean") return DENIED;
  const [lp] = Array.from(await db.execute<{ trainers: string[] }>(sql`SELECT trainers FROM lab_protocols WHERE doc_id = ${docId}::uuid`));
  if (!ctx.admin && !(lp?.trainers ?? []).includes(ctx.userId)) return DENIED;
  if (userId === ctx.userId) return { success: false, error: "Someone else signs off your training." };
  const [member] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role <> 'viewer' AND completed_at IS NULL`));
  if (!member) return DENIED;
  if (!trained) {
    await db.execute(sql`DELETE FROM lab_trainings WHERE doc_id = ${docId}::uuid AND user_id = ${userId}::uuid`);
    return { success: true };
  }
  const [made] = Array.from(await db.execute<{ ok: boolean }>(sql`
    INSERT INTO lab_trainings (doc_id, user_id, workspace_id, trainer_id) VALUES (${docId}::uuid, ${userId}::uuid, ${orgId}::uuid, ${ctx.userId}::uuid)
    ON CONFLICT DO NOTHING RETURNING true AS ok`));
  if (made) {
    await createNotification({ recipientUserId: userId, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `You’re signed off on ${titleOf(d.filename)}`, href: `/org/${encodeURIComponent(ctx.slug)}?tab=docs`,
      entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `lab-training:${docId}:${userId}` }).catch(() => undefined);
  }
  return { success: true };
}

/** My trainings (each person): protocols that need training, and whether I'm Trained. */
export async function readMyTrainingsAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; filename: string; trained: boolean }>(sql`
    SELECT d.id, d.filename, EXISTS (SELECT 1 FROM lab_trainings t WHERE t.doc_id = d.id AND t.user_id = ${ctx.userId}::uuid) AS trained
    FROM lab_protocols lp JOIN workspace_documents d ON d.id = lp.doc_id WHERE lp.workspace_id = ${orgId}::uuid AND lp.needs_training AND ${visible(ctx.admin, ctx.userId)} ORDER BY d.filename LIMIT 200`));
  return { success: true as const, trainings: rows.map((r) => ({ id: r.id, title: titleOf(r.filename), trained: r.trained })) };
}
