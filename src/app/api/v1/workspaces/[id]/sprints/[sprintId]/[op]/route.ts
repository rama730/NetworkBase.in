import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentGate } from "@/lib/agents/policy";
import { validateCsrf } from "@/lib/security/csrf";
import { SprintCliError, addTasksToSprint, closeSprintFromCli } from "@/lib/workspaces/server/sprint-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; sprintId: string; op: string }> };

/**
 * Report F2: `tasks` `{ numbers: [3, 4, 5] }` puts tasks in the sprint (anyone who can change tasks); `close` closes a
 * running sprint and moves its unfinished tasks to the next planned one, or to the backlog (owners and admins).
 */
async function handlePost(request: Request, context: Ctx) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id, sprintId, op } = await context.params;
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(sprintId).success) return jsonError("Invalid sprint", 400, "BAD_REQUEST");
    const body = (await request.json().catch(() => null)) ?? {};
    if (op === "tasks") {
      const parsed = z.object({ numbers: z.array(z.number().int().positive()).min(1).max(200) }).safeParse(body);
      if (!parsed.success) return jsonError("Send { numbers: [3, 4, 5] }", 400, "BAD_REQUEST");
      const held = await agentGate(auth, request, { sprintId, ...parsed.data }, { workspaceId: id, kinds: parsed.data.numbers.length > 20 ? ["batch"] : ["small"], summary: `Add ${parsed.data.numbers.length} tasks to a sprint` });
      if (held) return held;
      return jsonSuccess(await addTasksToSprint(auth.user.id, id, sprintId, parsed.data.numbers));
    }
    if (op === "close") {
      const held = await agentGate(auth, request, { sprintId, close: true }, { workspaceId: id, kinds: ["batch"], summary: "Close the sprint and move its unfinished tasks" });
      if (held) return held;
      return jsonSuccess(await closeSprintFromCli(id, sprintId));
    }
    return jsonError("Not found", 404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof SprintCliError) return jsonError(error.message, error.status, error.code as never);
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/sprints/op", fallback: "Couldn’t change the sprint" });
  }
}

export async function POST(request: Request, context: Ctx) {
  return idempotentWrite(request, "workspace.sprints.op", (req) => handlePost(req, context));
}
