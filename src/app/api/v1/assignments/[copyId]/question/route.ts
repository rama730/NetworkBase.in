import { eq } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readClassQuestionsAction } from "@/app/actions/task-comment";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createTaskCommentAs } from "@/lib/domain/task-comments";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ask the class a question about an assignment (`nb assignment question`, report A8.4): the app's Class questions. */
export async function POST(request: Request, context: { params: Promise<{ copyId: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = z.string().uuid().safeParse((await context.params).copyId);
    const body = z.object({ text: z.string().trim().min(1).max(5000) }).strict().safeParse(await request.json().catch(() => null));
    if (!id.success || !body.success) return jsonError("Write your question", 400, "BAD_REQUEST");
    const thread = await readClassQuestionsAction(id.data);
    if (!thread.success) return jsonError(thread.error, 403, "FORBIDDEN");
    if (!thread.canPost) return jsonError("This assignment is closed, or you can read but not post", 403, "FORBIDDEN");
    const [profile] = await db.select({ fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl }).from(profiles).where(eq(profiles.id, auth.user.id)).limit(1);
    const result = await createTaskCommentAs({ userId: auth.user.id, profile: profile ?? null }, thread.masterId, thread.orgId, body.data.text);
    if (!result.success) return jsonError(result.error ?? "Couldn’t post the question", 409, "CONFLICT");
    return jsonSuccess({ asked: true });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/assignments/question", fallback: "Couldn’t post the question" });
  }
}
