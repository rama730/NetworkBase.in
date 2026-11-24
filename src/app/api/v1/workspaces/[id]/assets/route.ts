import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readAssetsAction, tagAssetByPathAction } from "@/app/actions/assets";
import { agentGate } from "@/lib/agents/policy";
import { validateCsrf } from "@/lib/security/csrf";
import { ASSET_TYPES } from "@/lib/workflows/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report 38.16 W10 (`nb assets list [--type logo]`, plan A7.1): the Assets view as a list. Reads like Files. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: id });
    if (outside) return outside;
    const type = new URL(request.url).searchParams.get("type");
    if (type && !(ASSET_TYPES as readonly string[]).includes(type)) return jsonError(`Type is one of ${ASSET_TYPES.join(", ")}`, 400, "BAD_REQUEST");
    const r = await readAssetsAction(id);
    if (!r.success) return jsonError("Not found", 404, "NOT_FOUND");
    return jsonSuccess({ assets: r.assets.filter((a) => !type || a.type === type).map((a) => ({ path: a.path, name: a.name, type: a.type, version: a.version,
      tags: a.details?.tags ?? [], productionStatus: a.details?.productionStatus ?? null, usageRights: a.details?.usageRights ?? null })) }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/assets", fallback: "Couldn’t read assets" });
  }
}

/** W10: `nb assets tag <file> <tag>`: adds a tag (and makes any file an asset). A small write for agents. */
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
    const body = z.object({ path: z.string().trim().min(1).max(1024), tag: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,29}$/) }).safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError("Send { path, tag }; a tag is one short word (letters, numbers, dashes)", 400, "BAD_REQUEST");
    const held = await agentGate(auth, request, body.data, { workspaceId: id, kinds: ["small"], summary: `Tag ${body.data.path} "${body.data.tag}"` });
    if (held) return held;
    const r = await tagAssetByPathAction(id, body.data.path, body.data.tag);
    if (!r.success) return jsonError(r.error, /No file/.test(r.error) ? 404 : 403, /No file/.test(r.error) ? "NOT_FOUND" : "FORBIDDEN");
    return jsonSuccess({ path: body.data.path, tag: body.data.tag });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/assets", fallback: "Couldn’t tag the asset" });
  }
}
