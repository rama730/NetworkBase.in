import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { catalogEntry } from "@/lib/workflows/catalog";
import { readWorkspaceWorkflows } from "@/lib/workflows/server";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report 38.2 call 9 (`nb workflows`, networkbase_workflow_list): the workflows a workspace has, read-only, with the
 * types they add and those types' stages. Adding and removing stay in the app.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const id = (await context.params).id;
    if (!z.string().uuid().safeParse(id).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    const state = await readWorkspaceWorkflows(id, auth.user.id);
    return jsonSuccess({
      enabled: state.enabled,
      workflows: state.added.map((w) => {
        const entry = catalogEntry(w.workflow);
        return {
          id: w.workflow, name: entry?.name ?? w.workflow, line: entry?.line ?? null, locked: w.locked, addedBy: w.locked ? w.by : w.addedBy,
          types: (entry?.types ?? []).filter((t) => WORKFLOW_TYPES[t]).map((t) => ({
            id: t, label: WORKFLOW_TYPES[t]!.label, joinsAt: WORKFLOW_TYPES[t]!.joinStage,
            stages: WORKFLOW_TYPES[t]!.stages.map((s) => ({ key: s.key, label: s.label, onBoard: s.onBoard })),
          })),
        };
      }),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/workflows", fallback: "Couldn’t read workflows" });
  }
}
