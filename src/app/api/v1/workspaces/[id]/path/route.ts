import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { markLessonAction, readPathAction } from "@/app/actions/learning-path";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report 38.18 W9 (`nb path`, plan A7.7): the path with my ticks and Up next. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const r = await readPathAction(id);
    if (!r.success) return jsonError(r.error, 403, "FORBIDDEN");
    return jsonSuccess({ steps: r.steps, done: r.done, upNext: r.upNext, settings: r.settings }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/path", fallback: "Couldn’t read the path" });
  }
}

/** W9: `nb path done NB-410` (or --undo). People only: agents are refused (call 6). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    if (auth.tokenKind === "agent") return jsonError("Agents can’t mark lessons done; the person does.", 403, "FORBIDDEN");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const body = z.object({ number: z.number().int().positive(), done: z.boolean().default(true) }).safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Send { number, done }", 400, "BAD_REQUEST");
    const [lesson] = await db.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.projectId, id), eq(tasks.taskNumber, body.data.number), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt))).limit(1);
    if (!lesson) return jsonError(`NB-${body.data.number} isn’t a lesson here`, 404, "NOT_FOUND");
    const r = await markLessonAction(id, { taskId: lesson.id, done: body.data.done });
    if (!r.success) return jsonError(r.error, 409, "CONFLICT");
    return jsonSuccess({ number: body.data.number, done: body.data.done });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/path", fallback: "Couldn’t save that" });
  }
}
