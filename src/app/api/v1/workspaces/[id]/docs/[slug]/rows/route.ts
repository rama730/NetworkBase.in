import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { addDocRowAction, readDocRowsAction } from "@/app/actions/workspace/doc";
import { agentGate, recordUndo } from "@/lib/agents/policy";
import { db } from "@/lib/db";
import { profiles, workspaceMembers } from "@/lib/db/schema";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A document's live list (report 38.3 W13, `nb docs rows`): its rows, which are tasks. */
export async function GET(request: Request, context: { params: Promise<{ id: string; slug: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id, slug } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    // A token bound to one workspace reads only that workspace (security review: parity with sibling routes).
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!/^[a-z0-9]{4,12}$/.test(key)) return jsonError("Name the list with --list (its key)", 400, "BAD_REQUEST");
    const result = await readDocRowsAction(id, slug, key);
    if (!result.success) return jsonError(result.error, 404, "NOT_FOUND");
    return jsonSuccess({ rows: result.rows, hidden: result.hidden, canAdd: result.canAdd }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/docs/rows", fallback: "Couldn’t read the list" });
  }
}

const addSchema = z.object({
  key: z.string().regex(/^[a-z0-9]{4,12}$/),
  title: z.string().trim().min(1).max(200),
  assignee: z.string().trim().max(64).optional(),
  due: z.string().datetime().optional(),
});

/** Adds a row (W13): the person (or their agent, through the usual approval) must be able to edit the document. */
export async function POST(request: Request, context: { params: Promise<{ id: string; slug: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "workspace.docs.rows.add", async (req) => {
    try {
      const auth = await requireAuthenticatedUser();
      if (auth.response) return auth.response;
      if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
      const { id, slug } = await context.params;
      if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
      const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
      if (outside) return outside;
      const body = addSchema.parse(await req.json());
      const held = await agentGate(auth, req, body, { workspaceId: id, kinds: ["small"], summary: `Add “${body.title}” to the list in ${slug}` });
      if (held) return held;
      let assigneeId: string | null = null;
      if (body.assignee) {
        const username = body.assignee.replace(/^@/, "").toLowerCase();
        const [person] = await db.select({ id: profiles.id }).from(profiles)
          .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, profiles.id), eq(workspaceMembers.projectId, id)))
          .where(eq(profiles.username, username)).limit(1);
        if (!person) return jsonError(`@${username} isn’t a member of this workspace`, 400, "BAD_REQUEST");
        assigneeId = person.id;
      }
      const result = await addDocRowAction(id, { docSlug: slug, blockKey: body.key, title: body.title, assigneeId, dueDate: body.due ?? null });
      if (!result.success) return jsonError(result.error, 400, "BAD_REQUEST");
      const undoToken = await recordUndo(auth, { workspaceId: id, operation: "task.create", summary: `Created "${body.title}"`, inverse: { kind: "task.delete", taskId: result.id, projectId: id } });
      return jsonSuccess({ id: result.id, number: result.number, undoToken }, undefined, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) return jsonError("Give a list key and a title", 400, "BAD_REQUEST");
      return routeErrorResponse(error, { requestId: getRequestId(req), scope: "api/v1/workspaces/docs/rows", fallback: "Couldn’t add to the list" });
    }
  });
}
