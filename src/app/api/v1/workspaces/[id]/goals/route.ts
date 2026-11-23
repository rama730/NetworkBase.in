import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { checkInAction, readGoalsAction } from "@/app/actions/workspace/doc";
import { agentGate } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { validateCsrf } from "@/lib/security/csrf";
import { tasks, workspaceDocuments, workspaces } from "@/lib/db/schema";
import { goalSettings, periodOf } from "@/lib/workflows/goals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function currentDoc(id: string) {
  const [ws] = await db.select({ settings: workspaces.workflowSettings }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
  const period = periodOf(new Date().toISOString().slice(0, 10), goalSettings((ws?.settings as Record<string, unknown> | null)?.goals));
  const [doc] = await db.select({ slug: workspaceDocuments.slug }).from(workspaceDocuments)
    .where(and(eq(workspaceDocuments.projectId, id), sql`${workspaceDocuments.settings}->>'section' = 'goals'`, sql`${workspaceDocuments.settings}->>'period' = ${period}`)).limit(1);
  return { period, slug: doc?.slug ?? null };
}

/** Report 38.12 W10 (`nb goals list`, networkbase_goal_list, plan A5.1b): this period's objectives and key results. Members only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const doc = await currentDoc(id);
    if (!doc.slug) return jsonSuccess({ period: doc.period, label: null, objectives: [] });
    const r = await readGoalsAction(id, doc.slug);
    if (!r.success) return jsonError("Not found", 404, "NOT_FOUND");
    return jsonSuccess({ period: r.period, label: r.label, week: r.week, viewerId: r.viewerId, objectives: r.objectives.map((o) => ({
      number: o.number, title: o.title, assignee: o.assigneeName, assigneeId: o.assigneeId, progress: o.progress, status: o.status,
      keyResults: o.keyResults.map((k) => ({ number: k.number, title: k.title, assignee: k.assigneeName, assigneeId: k.assigneeId, current: k.current, target: k.target, unit: k.unit,
        progress: k.progress, status: k.status, confidence: k.confidence, due: k.due, measuredBy: k.measuredBy })),
    })) });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/goals", fallback: "Couldn’t read goals" });
  }
}

/** W10: `nb goals checkin NB-301 --value 42 --confidence 7 --note "…"` (agents: a person's yes first, tier "yes"). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const body = z.object({ task: z.number().int().positive(), value: z.number().finite(), confidence: z.number().int().min(1).max(10), note: z.string().max(1000).optional() }).safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Give the key result's number, a value and a confidence 1–10", 400, "BAD_REQUEST");
    const [kr] = await db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.projectId, id), eq(tasks.taskNumber, body.data.task), inArray(tasks.itemType, ["key_result"]), isNull(tasks.deletedAt))).limit(1);
    if (!kr) return jsonError("That isn't a key result in this workspace", 404, "NOT_FOUND");
    // Security review: a check-in is the person's own numbers (report W10, tier "yes"), so an agent waits for their yes.
    const held = await agentGate(auth, request, body.data, { workspaceId: id, kinds: ["message"], summary: `Check in on NB-${body.data.task}: ${body.data.value} · confidence ${body.data.confidence}/10`, taskId: kr.id });
    if (held) return held;
    const r = await checkInAction(id, { taskId: kr.id, value: body.data.value, confidence: body.data.confidence, ...(body.data.note ? { note: body.data.note } : {}) });
    if (!r.success) return jsonError(r.error, 403, "FORBIDDEN");
    return jsonSuccess({ checkedIn: true });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/goals", fallback: "Couldn’t check in" });
  }
}
