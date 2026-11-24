import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readSnippetCodeAction, readSnippetsAction } from "@/app/actions/workspace/doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report 21.4, 38.15 W6 (plan A6.35): `nb snippets list`, and with ?name= `nb snippets get` (the code). Snippets are
 * documents, so the document read rules decide who sees them; agents read with their person's access.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const r = await readSnippetsAction(id);
    if (!r.success) return jsonError("Not found", 404, "NOT_FOUND");
    const name = new URL(request.url).searchParams.get("name")?.trim().toLowerCase();
    if (!name) return jsonSuccess({ snippets: r.snippets }, undefined, { headers: { "Cache-Control": "private, no-store" } });
    const hit = r.snippets.find((s) => s.name.toLowerCase() === name || s.slug === name) ?? null;
    if (!hit) return jsonError(`No snippet named "${name.slice(0, 80)}"`, 404, "NOT_FOUND");
    const code = await readSnippetCodeAction(id, hit.slug);
    if (!code.success) return jsonError(code.error, 404, "NOT_FOUND");
    return jsonSuccess({ snippet: { ...hit, code: code.code } }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/snippets", fallback: "Couldn’t read snippets" });
  }
}
