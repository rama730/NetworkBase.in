"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { processSteps } from "@/lib/organizations/doc-rules";
import { BODY_KEYS, entryLock, entrySchema, experimentSchema, isLocked } from "@/lib/organizations/lab-notebook";
import { validTimeZone } from "@/lib/notifications/preferences";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.5 (plan B6.2b, R4 calls 2–5): the Notebook of a workspace inside a research lab. Its members write entries
 * (Viewers read); the lab's PI and Researchers read every notebook (call 5). Nothing here is public, even when the
 * workspace is. An entry is its author's to edit until it locks at the end of its day; after that anyone who writes
 * here, the author, or the lab's PI and Researchers add amendments — nothing is removed (call 3). Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function notebook(workspaceId: string) {
  if (!isLooseUuid(workspaceId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const [w] = Array.from(await db.execute<{ org: string; tz: string | null; lab_role: string | null; lab_owner: string }>(sql`
    SELECT o.id AS org, o.time_zone AS tz, o.owner_id AS lab_owner,
      (SELECT m.role FROM workspace_members m WHERE m.workspace_id = o.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL) AS lab_role
    FROM workspaces w JOIN workspaces o ON o.id = w.parent_id AND o.kind = 'organization' AND o.org_type = 'research' AND o.deleted_at IS NULL AND o.deletion_scheduled_at IS NULL
    WHERE w.id = ${workspaceId}::uuid AND w.kind = 'workspace' AND w.deleted_at IS NULL`));
  if (!w) return null;
  const a = await getWorkspaceAccessById(workspaceId, userId);
  const labLead = w.lab_owner === userId || w.lab_role === "admin";
  // Review: the lab's protocols are for its members (not its Viewers, not outsiders who joined one workspace).
  const labMember = w.lab_owner === userId || (w.lab_role !== null && w.lab_role !== "viewer");
  const member = a.isOwner || (a.isMember && Boolean(a.memberRole));
  // Call 5: members of this workspace, or the lab's PI and Researchers — never a public visitor.
  if (!a.canRead || !(member || labLead)) return null;
  const writer = !a.writeBlocked && (a.isOwner || (a.isMember && a.memberRole !== "viewer"));
  // Review: one zone for server and browser — the lab's, or UTC when it has none (or a bad one).
  return { userId, orgId: w.org, tz: validTimeZone(w.tz) ?? "UTC", writer, labMember, labLead, blocked: Boolean(a.writeBlocked), manager: a.isOwner || a.memberRole === "admin" };
}

/** Same rule as the lab's Protocols card: a draft or leaders-only page is the PI's and Researchers' (and a draft its owner's). */
const pageVisible = (ctx: { labLead: boolean; userId: string }) => sql`(${ctx.labLead} OR ((coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft'
  OR d.settings->'org'->>'owner' = ${ctx.userId}::text) AND coalesce(d.settings->>'visibilityOverride', '') <> 'leaders_only'))`;

type EntryRow = { id: string; author: string | null; author_name: string | null; day: string; title: string; body: Record<string, unknown>; protocol: string | null; version: number | null;
  version_state: string | null; experiment_id: string | null; experiment: string | null; untrained: boolean; written_later: boolean; locks_at: string; amendments: unknown };

/** Notebook (Today · By experiment): the latest entries with their amendments, experiments, and protocols to run. */
export async function readNotebookAction(workspaceId: string) {
  const ctx = await notebook(workspaceId);
  if (!ctx) return DENIED;
  const entries = Array.from(await db.execute<EntryRow>(sql`
    SELECT e.id, e.author_id AS author, coalesce(p.full_name, p.username) AS author_name, e.entry_date::text AS day, e.title, e.body,
      coalesce(e.protocol_title, regexp_replace(d.filename, '\\.md$', '')) AS protocol, coalesce(e.protocol_version, v.version) AS version, v.state AS version_state, e.experiment_id, x.title AS experiment,
      e.untrained, e.written_later, e.locks_at::text AS locks_at,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', am.id, 'body', am.body, 'at', am.created_at, 'by', coalesce(ap.full_name, ap.username, 'Someone')) ORDER BY am.created_at), '[]'::jsonb)
        FROM lab_entry_amendments am LEFT JOIN profiles ap ON ap.id = am.author_id WHERE am.entry_id = e.id) AS amendments
    FROM lab_entries e LEFT JOIN profiles p ON p.id = e.author_id LEFT JOIN workspace_documents d ON d.id = e.protocol_doc_id
      LEFT JOIN lab_protocol_versions v ON v.id = e.protocol_version_id LEFT JOIN lab_experiments x ON x.id = e.experiment_id
    WHERE e.workspace_id = ${workspaceId}::uuid ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 200`));
  const experiments = Array.from(await db.execute<{ id: string; title: string; hypothesis: string; status: "planned" | "running" | "done" | "stopped"; conclusion: string; entries: number }>(sql`
    SELECT x.id, x.title, x.hypothesis, x.status, x.conclusion, (SELECT count(*)::int FROM lab_entries e WHERE e.experiment_id = x.id) AS entries
    FROM lab_experiments x WHERE x.workspace_id = ${workspaceId}::uuid ORDER BY x.created_at DESC LIMIT 100`));
  // Only Approved versions can be run (call 1); visible pages only (not drafts or leaders-only).
  const protocols = ctx.writer && ctx.labMember ? Array.from(await db.execute<{ id: string; title: string; version: number; needs: boolean | null; trained: boolean }>(sql`
    SELECT d.id, regexp_replace(d.filename, '\\.md$', '') AS title, v.version, lp.needs_training AS needs,
      EXISTS (SELECT 1 FROM lab_trainings t WHERE t.doc_id = d.id AND t.user_id = ${ctx.userId}::uuid) AS trained
    FROM lab_protocol_versions v JOIN workspace_documents d ON d.id = v.doc_id LEFT JOIN lab_protocols lp ON lp.doc_id = d.id
    WHERE v.workspace_id = ${ctx.orgId}::uuid AND v.state = 'approved' AND d.settings->>'kind' = 'protocol'
      AND ${pageVisible(ctx)}
    ORDER BY d.filename LIMIT 200`)) : [];
  const now = new Date();
  return { success: true as const, me: ctx.userId, writer: ctx.writer, canAmend: !ctx.blocked && (ctx.writer || ctx.labLead), tz: ctx.tz,
    experiments, protocols: protocols.map((p) => ({ id: p.id, title: p.title, version: p.version, needsTraining: p.needs === true, trained: p.trained })),
    entries: entries.map((e) => ({ id: e.id, authorId: e.author, author: e.author_name ?? "Someone", day: e.day, title: e.title, body: e.body,
      protocol: e.protocol ? { title: e.protocol, version: e.version, state: e.version_state } : null, experimentId: e.experiment_id, experiment: e.experiment,
      untrained: e.untrained, writtenLater: e.written_later, locked: isLocked(e.locks_at, now), locksAt: e.locks_at,
      amendments: (Array.isArray(e.amendments) ? e.amendments : []) as Array<{ id: string; body: string; at: string; by: string }> })) };
}

/** Run this protocol (call 2): the Approved version's Steps, to start an entry with. */
export async function readProtocolStepsAction(workspaceId: string, docId: string) {
  const ctx = await notebook(workspaceId);
  if (!ctx?.writer || !ctx.labMember || !isLooseUuid(docId)) return DENIED;
  const [v] = Array.from(await db.execute<{ content: string; version: number; title: string }>(sql`
    SELECT v.content, v.version, regexp_replace(d.filename, '\\.md$', '') AS title FROM lab_protocol_versions v JOIN workspace_documents d ON d.id = v.doc_id
    WHERE v.doc_id = ${docId}::uuid AND v.workspace_id = ${ctx.orgId}::uuid AND v.state = 'approved' AND d.settings->>'kind' = 'protocol'
      AND ${pageVisible(ctx)}`));
  if (!v) return { success: false as const, error: "Only an Approved protocol version can be run." };
  return { success: true as const, title: v.title, version: v.version, steps: processSteps(v.content) };
}

/** + Entry or Run this protocol (writers); edit your own entry until it locks. */
export async function saveEntryAction(workspaceId: string, entryId: string | null, input: unknown): Promise<{ success: true; id: string; untrained: boolean } | Failure> {
  const ctx = await notebook(workspaceId);
  const parsed = entrySchema.safeParse(input);
  if (!ctx?.writer || (entryId !== null && !isLooseUuid(entryId))) return DENIED;
  if (!parsed.success) return { success: false, error: "Check the entry: a title, today or yesterday, and http links only." };
  const d = parsed.data;
  const body = Object.fromEntries(BODY_KEYS.map((k) => [k, d[k]]));
  if (d.experimentId) {
    const [x] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM lab_experiments WHERE id = ${d.experimentId}::uuid AND workspace_id = ${workspaceId}::uuid`));
    if (!x) return DENIED;
  }
  if (entryId) {
    // Editing: only the author, only before it locks; the day, protocol and version stay as written.
    const [e] = await db.execute<{ id: string }>(sql`
      UPDATE lab_entries SET title = ${d.title}, body = ${JSON.stringify(body)}::jsonb, experiment_id = ${d.experimentId}::uuid, updated_at = now()
      WHERE id = ${entryId}::uuid AND workspace_id = ${workspaceId}::uuid AND author_id = ${ctx.userId}::uuid AND locks_at > now() RETURNING id`).then((r) => Array.from(r)).catch(() => []);
    return e ? { success: true, id: e.id, untrained: false } : { success: false, error: "This entry is locked. Add an amendment instead." };
  }
  const lock = entryLock(d.day, ctx.tz);
  if (!lock) return { success: false, error: "Entries are for today, or yesterday once if you’re writing it up later." };
  let versionId: string | null = null;
  let snapshot: { title: string; version: number } | null = null;
  let untrained = false;
  if (d.protocolDocId) {
    if (!ctx.labMember) return DENIED;
    const [v] = Array.from(await db.execute<{ id: string; needs: boolean | null; trained: boolean; title: string; version: number }>(sql`
      SELECT v.id, v.version, regexp_replace(d.filename, '\\.md$', '') AS title, lp.needs_training AS needs, EXISTS (SELECT 1 FROM lab_trainings t WHERE t.doc_id = v.doc_id AND t.user_id = ${ctx.userId}::uuid) AS trained
      FROM lab_protocol_versions v JOIN workspace_documents d ON d.id = v.doc_id LEFT JOIN lab_protocols lp ON lp.doc_id = v.doc_id
      WHERE v.doc_id = ${d.protocolDocId}::uuid AND v.workspace_id = ${ctx.orgId}::uuid AND v.state = 'approved' AND d.settings->>'kind' = 'protocol'
        AND ${pageVisible(ctx)}`));
    if (!v) return { success: false, error: "Only an Approved protocol version can be run." };
    versionId = v.id;
    snapshot = { title: v.title.slice(0, 200), version: v.version };
    // Call 6: running untrained only warns; the entry says so.
    untrained = v.needs === true && !v.trained;
  }
  const [e] = await db.execute<{ id: string }>(sql`
    INSERT INTO lab_entries (workspace_id, author_id, entry_date, title, body, protocol_doc_id, protocol_version_id, protocol_title, protocol_version, experiment_id, untrained, written_later, locks_at)
    VALUES (${workspaceId}::uuid, ${ctx.userId}::uuid, ${d.day}::date, ${d.title}, ${JSON.stringify(body)}::jsonb, ${d.protocolDocId}::uuid, ${versionId}::uuid,
      ${snapshot?.title ?? null}, ${snapshot?.version ?? null}, ${d.experimentId}::uuid, ${untrained}, ${lock.writtenLater}, ${lock.locksAt}::timestamptz)
    RETURNING id`).then((r) => Array.from(r)).catch(() => []);
  return e ? { success: true, id: e.id, untrained } : { success: false, error: "That entry is too long to save. Move detail into Files." };
}

const amendSchema = z.string().trim().min(1).max(4000);

/** Amend a locked entry (writers here, its author, the lab's PI and Researchers): added below with author and time. */
export async function amendEntryAction(workspaceId: string, entryId: string, body: unknown): Promise<{ success: true } | Failure> {
  const ctx = await notebook(workspaceId);
  const parsed = amendSchema.safeParse(body);
  if (!ctx || ctx.blocked || !isLooseUuid(entryId) || !parsed.success) return DENIED;
  const [e] = Array.from(await db.execute<{ author: string | null; locked: boolean }>(sql`
    SELECT author_id AS author, locks_at <= now() AS locked FROM lab_entries WHERE id = ${entryId}::uuid AND workspace_id = ${workspaceId}::uuid`));
  if (!e) return DENIED;
  if (!(ctx.writer || ctx.labLead || e.author === ctx.userId)) return DENIED;
  if (!e.locked) return { success: false, error: "It isn’t locked yet: edit the entry instead." };
  await db.execute(sql`INSERT INTO lab_entry_amendments (entry_id, author_id, body) VALUES (${entryId}::uuid, ${ctx.userId}::uuid, ${parsed.data})`);
  return { success: true };
}

/** Experiments (writers): a hypothesis, status (Planned · Running · Done · Stopped) and a conclusion (call 4). */
export async function saveExperimentAction(workspaceId: string, experimentId: string | null, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await notebook(workspaceId);
  const parsed = experimentSchema.safeParse(input);
  if (!ctx?.writer || (experimentId !== null && !isLooseUuid(experimentId))) return DENIED;
  if (!parsed.success) return { success: false, error: "An experiment needs a title." };
  const x = parsed.data;
  const [row] = experimentId
    ? Array.from(await db.execute<{ id: string }>(sql`
        UPDATE lab_experiments SET title = ${x.title}, hypothesis = ${x.hypothesis}, status = ${x.status}, conclusion = ${x.conclusion}, updated_at = now()
        WHERE id = ${experimentId}::uuid AND workspace_id = ${workspaceId}::uuid RETURNING id`))
    : Array.from(await db.execute<{ id: string }>(sql`
        INSERT INTO lab_experiments (workspace_id, title, hypothesis, status, conclusion, created_by)
        VALUES (${workspaceId}::uuid, ${x.title}, ${x.hypothesis}, ${x.status}, ${x.conclusion}, ${ctx.userId}::uuid) RETURNING id`));
  return row ? { success: true, id: row.id } : DENIED;
}
