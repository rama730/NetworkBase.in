import { NextRequest } from "next/server";
import {
    jsonError,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { getProjectAccessById } from "@/lib/data/workspace-access";
import { jsonSuccessConditional } from "@/app/api/v1/_conditional";
import { buildFileCapabilities } from "@/lib/workspaces/file-capabilities";
import { isLooseUuid } from "@/lib/validations/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/workspaces/[id]/capabilities
 * Fetches the capability policy checklist for the current authenticated user on the project.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {

    const { user, response } = await requireAuthenticatedUser();
    if (response) return response;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const { id: projectId } = await context.params;
    if (!isLooseUuid(projectId)) {
        return jsonError("Invalid workspace id", 400, "BAD_REQUEST");
    }

    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project) {
        return jsonError("Workspace not found", 404, "NOT_FOUND");
    }

    if (!access.canRead) {
        return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    }

    const capabilities = buildFileCapabilities(access);

    return jsonSuccessConditional(request, capabilities, {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
    });
}
