"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";
import { activeTypes } from "@/lib/workflows/requests";
import { readRequestTypes } from "@/lib/workflows/request-store";
import { statusForStage } from "@/lib/workflows/rules";

/**
 * Report 33.6 (plan B4.5, K5): requests to central teams. A team in a company with Requests (T4) switches on Take
 * requests from the company (call 1); anyone in the company but Viewers asks with the team's types and questions
 * (call 2), with matching handbook pages shown first and nothing blocked (call 3); the team triages by hand (call 5);
 * the asker follows it in My asks and never sees the team's board (call 6); Did this solve it? is Yes or No, and No
 * reopens it (call 7). No requests from email or outside people (call 8). Never a token.
 * ponytail: private request types (call 4) wait for a task read rule across the team's board; not built yet.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function companyMember(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null }>(sql`SELECT org_type AS type FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "company" || !(a.isOwner || (a.isMember && a.memberRole !== "viewer"))) return null;
  return { userId };
}

/** Teams taking requests from the company: a team workspace in it, with Requests added and the switch on. */
async function askableTeams(orgId: string) {
  return Array.from(await db.execute<{ id: string; title: string }>(sql`
    SELECT w.id, w.title FROM workspaces w
    WHERE w.parent_id = ${orgId}::uuid AND w.kind = 'workspace' AND w.deleted_at IS NULL AND w.status <> 'archived'
      AND w.workflow_settings->>'companyRequests' = 'true'
      AND EXISTS (SELECT 1 FROM workspace_workflows f WHERE f.workspace_id = w.id AND f.workflow = 'requests' AND f.hidden_at IS NULL)
    ORDER BY w.title LIMIT 100`));
}

/** Ask a team (the form): the teams taking requests and their active types with questions. */
export async function readAskableTeamsAction(orgId: string) {
  const ctx = await companyMember(orgId);
  if (!ctx) return DENIED;
  const teams = await askableTeams(orgId);
  const out = [];
  for (const t of teams) {
    const types = activeTypes(await readRequestTypes(t.id));
    if (types.length) out.push({ id: t.id, title: t.title, types: types.map((x) => ({ id: x.id, name: x.name, questions: x.questions })) });
  }
  return { success: true as const, teams: out };
}

/** Call 3: published company pages whose title shares a word with what's being asked — shown above the form, never blocking. */
export async function matchingPagesAction(orgId: string, text: string) {
  const ctx = await companyMember(orgId);
  if (!ctx) return DENIED;
  const words = String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 8);
  if (!words.length) return { success: true as const, pages: [] };
  const { listWorkspaceDocsAction } = await import("@/app/actions/workspace/doc");
  const listed = await listWorkspaceDocsAction(orgId);
  const pages = (listed.success ? listed.docs : []).map((d) => ({ slug: d.slug, title: d.title ?? d.filename.replace(/\.(md|mdx|markdown)$/i, "") }))
    .filter((d) => words.some((w) => d.title.toLowerCase().includes(w))).slice(0, 3);
  return { success: true as const, pages };
}

const askSchema = z.object({ teamId: z.string().uuid(), typeId: z.string().uuid(), title: z.string().trim().min(1, "Say what you need in a line.").max(200),
  answers: z.record(z.string().max(40), z.string().max(5000)).default({}) }).strict();

/** Ask: a request in the team's Requests at New, from the asker, with the type's answers; the team's triagers are told. */
export async function askTeamAction(orgId: string, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await companyMember(orgId);
  if (!ctx) return DENIED;
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the request." };
  const a = parsed.data;
  if (!(await askableTeams(orgId)).some((t) => t.id === a.teamId)) return { success: false, error: "That team isn’t taking requests." };
  const type = activeTypes(await readRequestTypes(a.teamId)).find((t) => t.id === a.typeId);
  if (!type) return { success: false, error: "Pick one of the team’s request types." };
  // ponytail: file questions are answered in the team's own form; from the company they never block sending.
  const required = type.questions.find((q) => q.required && q.kind !== "file" && !String(a.answers[(q as { id: string }).id] ?? "").trim());
  if (required) return { success: false, error: "Answer the required questions." };
  const answers = Object.fromEntries(type.questions.map((q) => [(q as { id: string }).id, String(a.answers[(q as { id: string }).id] ?? "").slice(0, 5000)]).filter(([, v]) => v));
  const [row] = Array.from(await db.execute<{ id: string }>(sql`
    WITH n AS (UPDATE workspaces SET current_task_number = coalesce(current_task_number, 0) + 1 WHERE id = ${a.teamId}::uuid RETURNING current_task_number)
    INSERT INTO tasks (workspace_id, title, status, priority, item_type, stage, on_board, type_fields, creator_id, task_number)
    SELECT ${a.teamId}::uuid, ${a.title}, ${statusForStage("request", "new")}, 'medium', 'request', 'new', false,
      ${JSON.stringify({ requestTypeId: type.id, answers, fromCompany: orgId })}::jsonb, ${ctx.userId}::uuid, n.current_task_number FROM n RETURNING id`));
  const { scheduleRequestClock } = await import("@/lib/workflows/request-clock-server");
  const { notifyRequestNew } = await import("@/lib/workflows/request-notify");
  await scheduleRequestClock(row!.id).catch(() => undefined);
  await notifyRequestNew(row!.id, ctx.userId, type.triagerIds).catch(() => undefined);
  return { success: true, id: row!.id };
}

const STAGE_WORD: Record<string, string> = { new: "New", accepted: "Accepted", in_progress: "In progress", waiting: "Waiting on you", review: "In review", delivered: "Delivered", declined: "Declined" };

/** My asks (call 6): the requests I asked of the company's teams — never the teams' boards. */
export async function readMyAsksAction(orgId: string) {
  const ctx = await companyMember(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; title: string; stage: string | null; team: string; fields: Record<string, unknown> | null; created_at: string }>(sql`
    SELECT t.id, t.title, t.stage, w.title AS team, t.type_fields AS fields, t.created_at::text FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
    WHERE w.parent_id = ${orgId}::uuid AND t.item_type = 'request' AND t.creator_id = ${ctx.userId}::uuid AND t.deleted_at IS NULL
      AND (t.stage NOT IN ('delivered', 'declined') OR t.updated_at > now() - interval '30 days') ORDER BY t.created_at DESC LIMIT 50`));
  return { success: true as const, asks: rows.map((r) => ({ id: r.id, title: r.title, team: r.team, stage: r.stage ?? "new", stageWord: STAGE_WORD[r.stage ?? "new"] ?? r.stage ?? "New",
    declineReason: r.stage === "declined" ? (r.fields?.declineReason as string | undefined) ?? null : null, solved: (r.fields?.solved as string | undefined) ?? null, at: r.created_at.slice(0, 10) })) };
}

/** Did this solve it? (call 7): the asker answers Yes or No once delivered; No (with what's missing) reopens it. */
export async function answerMyAskAction(orgId: string, taskId: string, input: { solved: "yes" | "no"; note?: string }): Promise<{ success: true } | Failure> {
  const ctx = await companyMember(orgId);
  if (!ctx || !isLooseUuid(taskId) || !["yes", "no"].includes(input?.solved)) return DENIED;
  const [r] = Array.from(await db.execute<{ stage: string | null; creator_id: string; fields: Record<string, unknown> | null }>(sql`
    SELECT t.stage, t.creator_id, t.type_fields AS fields FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
    WHERE t.id = ${taskId}::uuid AND w.parent_id = ${orgId}::uuid AND t.item_type = 'request' AND t.deleted_at IS NULL`));
  if (!r || r.creator_id !== ctx.userId) return DENIED;
  if (r.stage !== "delivered") return { success: false, error: "Answer once it’s delivered." };
  const { mergeRequestFields, reopenForAsker } = await import("@/lib/workflows/request-flow");
  if (input.solved === "yes") { await mergeRequestFields(taskId, { solved: "yes" }); return { success: true }; }
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (!note) return { success: false, error: "Say what’s still missing" };
  const reopenCount = (typeof r.fields?.reopenCount === "number" ? r.fields.reopenCount : 0) + 1;
  await mergeRequestFields(taskId, { solved: "no", reopenCount, notSolvedNote: note });
  const { notifyRequestPerson } = await import("@/lib/workflows/request-notify");
  await notifyRequestPerson(taskId, ctx.userId, "handler", `Answered No: ${note.slice(0, 120)}`).catch(() => undefined);
  // The asker isn't in the team's workspace, so the team's owner moves it back to In progress on their behalf.
  const [team] = Array.from(await db.execute<{ owner: string }>(sql`SELECT w.owner_id AS owner FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ${taskId}::uuid`));
  const reopened = await reopenForAsker(taskId, { id: team!.owner }).then(() => true, (error) => { logger.error("company_requests.reopen_failed", { taskId, error: error instanceof Error ? error.message : String(error) }); return false; });
  if (!reopened) return { success: false, error: "Couldn’t send it back to the team. Try again." };
  return { success: true };
}

/** Take requests from the company (call 1): a team's owner or admins, with Requests added, in a company. */
export async function setCompanyRequestsAction(teamId: string, on: boolean): Promise<{ success: true } | Failure> {
  if (!isLooseUuid(teamId) || typeof on !== "boolean") return DENIED;
  const { userId } = await getViewerAuthContext();
  if (!userId) return DENIED;
  const a = await getWorkspaceAccessById(teamId, userId);
  if (!(a.isOwner || a.memberRole === "admin")) return DENIED;
  const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM workspaces w JOIN workspaces o ON o.id = w.parent_id AND o.kind = 'organization' AND o.org_type = 'company'
    WHERE w.id = ${teamId}::uuid AND EXISTS (SELECT 1 FROM workspace_workflows f WHERE f.workspace_id = w.id AND f.workflow = 'requests' AND f.hidden_at IS NULL)) AS ok`));
  if (!ok?.ok) return { success: false, error: "Add Requests to a team in a company first." };
  await db.execute(sql`UPDATE workspaces SET workflow_settings = coalesce(workflow_settings, '{}'::jsonb) || jsonb_build_object('companyRequests', ${on}::boolean) WHERE id = ${teamId}::uuid`);
  return { success: true };
}

/** For the team's Requests tab: whether this team can take company requests, and whether it does. */
export async function readCompanyRequestsSettingAction(teamId: string) {
  if (!isLooseUuid(teamId)) return { success: true as const, available: false, on: false };
  const { userId } = await getViewerAuthContext();
  const a = userId ? await getWorkspaceAccessById(teamId, userId) : null;
  const [w] = Array.from(await db.execute<{ company: boolean; on: boolean }>(sql`SELECT (o.org_type = 'company') AS company, coalesce(w.workflow_settings->>'companyRequests' = 'true', false) AS on
    FROM workspaces w LEFT JOIN workspaces o ON o.id = w.parent_id AND o.kind = 'organization' WHERE w.id = ${teamId}::uuid`));
  return { success: true as const, available: Boolean(w?.company && a && (a.isOwner || a.memberRole === "admin")), on: Boolean(w?.on) };
}
