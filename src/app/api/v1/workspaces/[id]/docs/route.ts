import { z } from "zod";

import { getRequestId, idempotentWrite, jsonError, jsonSuccess, requireAuthenticatedUser, requireTokenScope } from "@/app/api/v1/_shared";
import { ChangeSetError, HeldResponse } from "@/lib/domain/change-sets";
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
    // `nb doc templates` (38.15 W6): the templates are the same for every workspace.
    if (new URL(request.url).searchParams.get("templates")) {
      const { DOC_TEMPLATES } = await import("@/lib/workflows/doc-templates");
      return jsonSuccess({ templates: DOC_TEMPLATES.map(({ id: tid, name, group, line }) => ({ id: tid, name, group, line })) });
    }
    const result = await listWorkspaceDocsAction(id);
    if (!result.success) return jsonError(result.error, 400, "BAD_REQUEST");
    return jsonSuccess({ docs: result.docs }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/docs", fallback: "Couldn’t list docs" });
  }
}

/**
 * `nb doc add <file>` (report F3): the file becomes a workspace doc, where it is. An agent asks first (a doc).
 * `nb docs new --template <id> [title]` (38.15 W6, A6.35): the template's text is written to Docs/ through a change set
 * (so protected main, token scopes and agents' approval all apply as for any write), then made a doc.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "workspace.docs.add", async (req) => {
    try {
      const auth = await requireAuthenticatedUser();
      if (auth.response) return auth.response;
      if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
      const { id } = await context.params;
      const raw = await req.json().catch(() => null);
      const fromTemplate = z.object({ template: z.string().trim().min(1).max(60), title: z.string().trim().max(120).default("") }).safeParse(raw);
      if (z.string().uuid().safeParse(id).success && fromTemplate.success) return await newFromTemplate(auth as Auth, req, id, fromTemplate.data);
      const body = z.object({ path: z.string().trim().min(1).max(1024) }).safeParse(raw);
      if (!z.string().uuid().safeParse(id).success || !body.success) return jsonError("Send { path } or { template, title }", 400, "BAD_REQUEST");
      const held = await agentGate(auth, req, body.data, { workspaceId: id, kinds: ["doc"], summary: `Make ${body.data.path} a workspace doc` });
      if (held) return held;
      return jsonSuccess(await addDocFromCli(auth.user.id, id, body.data.path), undefined, { status: 201 });
    } catch (error) {
      if (error instanceof WorkspaceCliError) return jsonError(error.message, error.status, error.code as never);
      if (error instanceof HeldResponse) return error.response;
      if (error instanceof ChangeSetError) return jsonError(error.message, error.status, error.code as never);
      return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/docs", fallback: "Couldn’t add the doc" });
    }
  });
}

type Auth = NonNullable<Awaited<ReturnType<typeof requireAuthenticatedUser>>> & { user: { id: string } };
async function newFromTemplate(auth: Auth, req: Request, workspaceId: string, input: { template: string; title: string }) {
  const { templateBody, templateById, templateFileName } = await import("@/lib/workflows/doc-templates");
  const template = templateById(input.template);
  if (!template) return jsonError(`No template "${input.template}"; nb docs templates lists them`, 404, "NOT_FOUND");
  const path = `Docs/${templateFileName(template.name, input.title)}`;
  const held = await agentGate(auth, req, { template: template.id, title: input.title }, { workspaceId, kinds: ["doc"], summary: `Make ${path} from the ${template.name} template` });
  if (held) return held;
  const { applyChangeSet, finishChangeSet, startChangeSet } = await import("@/lib/domain/change-sets");
  const { writeFile } = await import("@/lib/domain/change-set-fs");
  const changeSet = await startChangeSet(auth, { workspaceId, title: `New document: ${path.slice(5, 120)}` });
  await writeFile(auth, changeSet.id, { path, text: templateBody(template, input.title) });
  await finishChangeSet(auth, changeSet.id);
  const applied = await applyChangeSet(auth, req, changeSet.id, { checkScope: (scope) => requireTokenScope(auth, scope) }) as { changeSet?: { status?: string } };
  // An agent's apply can wait for its person (report A5); the doc is added once the file is on main.
  if (applied.changeSet?.status !== "applied") return jsonSuccess({ changeSetId: changeSet.id, waiting: true, path }, undefined, { status: 202 });
  return jsonSuccess({ ...(await addDocFromCli(auth.user.id, workspaceId, path)), path }, undefined, { status: 201 });
}
