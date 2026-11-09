import { validateCsrf } from "@/lib/security/csrf";
import {requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
  idempotentWrite
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { createTaskAction } from "@/app/actions/workspace";
import { z } from "zod";
export const runtime = "nodejs";
const schema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});
async function handlePost(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Invalid task", 400, "BAD_REQUEST");
    const result = await createTaskAction({
      ...parsed.data,
      status: "todo",
      priority: parsed.data.priority || "medium",
    });
    return result.success
      ? jsonSuccess(result)
      : jsonError(result.error || "Couldn’t create task", 400, "BAD_REQUEST");
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/create-task",
      fallback: "Task creation failed",
    });
  }
}

/** Retries with the same Idempotency-Key and body write once (report A2.4, F72). */
export async function POST(request: Request) {
  return idempotentWrite(request, "extension.create-task", handlePost);
}
