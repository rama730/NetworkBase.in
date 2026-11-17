import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { changeSets, saves } from "@/lib/db/schema";
import { ChangeSetError, HeldResponse } from "@/lib/domain/change-sets";
import { validateCsrf } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { eq } from "drizzle-orm";

export type Auth = Awaited<ReturnType<typeof requireAuthenticatedUser>> & { user: NonNullable<Awaited<ReturnType<typeof requireAuthenticatedUser>>["user"]> };

/** Per-token limits a minute (report G7). */
export const LIMIT = { items: 120, content: 60, read: 120, apply: 10, other: 60 } as const;

/**
 * Every change set route: sign-in, CSRF for cookie sessions, a per-token rate limit, idempotent writes, the token's
 * workspace, and the domain's errors as API errors. `workspaceId` names the workspace when the path has it; otherwise
 * the change set's (or save's, report H3) own workspace is checked.
 */
export async function changeSetRoute(
  request: Request,
  opts: { limit: keyof typeof LIMIT; changeSetId?: string; saveId?: string; workspaceId?: string },
  run: (auth: Auth, request: Request) => Promise<unknown>,
) {
  const write = request.method !== "GET" && request.method !== "HEAD";
  const go = async (req: Request) => {
    if (write) {
      const csrf = validateCsrf(req);
      if (csrf) return csrf;
    }
    try {
      const auth = await requireAuthenticatedUser();
      if (auth.response) return auth.response;
      if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
      const who = auth.extensionSessionId ?? auth.user.id;
      const rate = await consumeRateLimit(`api:v1:change-sets:${opts.limit}:${who}`, LIMIT[opts.limit], 60);
      if (!rate.allowed) {
        const limited = jsonError("Too many change set requests; wait a minute", 429, "RATE_LIMITED");
        limited.headers.set("Retry-After", "60");
        return limited;
      }
      let workspaceId = opts.workspaceId ?? null;
      if (!workspaceId && opts.changeSetId && /^[0-9a-f-]{36}$/i.test(opts.changeSetId)) {
        const [set] = await db.select({ workspaceId: changeSets.workspaceId }).from(changeSets).where(eq(changeSets.id, opts.changeSetId)).limit(1);
        workspaceId = set?.workspaceId ?? null;
      }
      if (!workspaceId && opts.saveId && /^[0-9a-f-]{36}$/i.test(opts.saveId)) {
        const [save] = await db.select({ workspaceId: saves.workspaceId }).from(saves).where(eq(saves.id, opts.saveId)).limit(1);
        workspaceId = save?.workspaceId ?? null;
      }
      if (workspaceId) {
        const outside = await denyOutsideTokenWorkspace(auth, { projectId: workspaceId });
        if (outside) return outside;
      }
      const data = await run(auth as Auth, req);
      return data instanceof Response ? data : jsonSuccess(data, undefined, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (error instanceof HeldResponse) return error.response;
      if (error instanceof ChangeSetError) return jsonError(error.message, error.status, error.code as never, error.details);
      return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/change-sets", fallback: "Couldn’t do that with the change set" });
    }
  };
  return write ? idempotentWrite(request, `change-sets:${opts.limit}`, go) : go(request);
}

export const readJson = async (request: Request) => (await request.json().catch(() => null)) ?? {};
