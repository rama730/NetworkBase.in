import { z } from "zod";

import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentGate } from "@/lib/agents/policy";
import { validateCsrf } from "@/lib/security/csrf";
import { WorkspaceCliError, addDocFromCli } from "@/lib/workspaces/server/workspace-cli";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { listWorkspaceDocsAction } from "@/app/actions/workspace/doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The workspace's docs (README first) that the caller may read: `nb doc list`, agents' doc lookup. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    // `nb doc templates` and `nb doc new --template` (38.15 W6, A6.35): the templates are the same everywhere; with
    // ?template= the CLI gets the file's path and text, pushes it like any file (nb push's rules), then adds the doc.
    const q = new URL(request.url).searchParams;
    if (q.get("templates") || q.get("template")) {
      const { DOC_TEMPLATES, templateBody, templateById, templateFileName } = await import("@/lib/workflows/doc-templates");
      if (!q.get("template")) return jsonSuccess({ templates: DOC_TEMPLATES.map(({ id: tid, name, group, line }) => ({ id: tid, name, group, line })) });
      const t = templateById(q.get("template")!);
      if (!t) return jsonError(`No template "${q.get("template")!.slice(0, 60)}"; nb doc templates lists them`, 404, "NOT_FOUND");
      const title = (q.get("title") ?? "").slice(0, 120);
      return jsonSuccess({ template: { id: t.id, name: t.name }, path: `Docs/${templateFileName(t.name, title)}`, text: templateBody(t, title) });
    }
    const result = await listWorkspaceDocsAction(id);
    if (!result.success) return jsonError(result.error, 400, "BAD_REQUEST");
    return jsonSuccess({ docs: result.docs }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/docs", fallback: "Couldn’t list docs" });
  }
}

/** `nb doc add <file>` (report F3): the file becomes a workspace doc, where it is. An agent asks first (a doc). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "workspace.docs.add", async (req) => {
    try {
      const auth = await requireAuthenticatedUser();
      if (auth.response) return auth.response;
      if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
      const { id } = await context.params;
      const body = z.object({ path: z.string().trim().min(1).max(1024) }).safeParse(await req.json().catch(() => null));
      if (!z.string().uuid().safeParse(id).success || !body.success) return jsonError("Send { path }", 400, "BAD_REQUEST");
      const held = await agentGate(auth, req, body.data, { workspaceId: id, kinds: ["doc"], summary: `Make ${body.data.path} a workspace doc` });
      if (held) return held;
      return jsonSuccess(await addDocFromCli(auth.user.id, id, body.data.path), undefined, { status: 201 });
    } catch (error) {
      if (error instanceof WorkspaceCliError) return jsonError(error.message, error.status, error.code as never);
      return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/docs", fallback: "Couldn’t add the doc" });
    }
  });
}

