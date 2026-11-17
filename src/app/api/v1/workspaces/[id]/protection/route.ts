import { changeSetRoute, readJson } from "@/app/api/v1/change-sets/_route";
import { getProtection, setProtection, type Protection } from "@/lib/domain/branch-protection";
import { personStepUp } from "@/lib/security/change-set-step-up";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const KEYS = ["requireMergeRequest", "approvals", "reapproveOnNewSaves", "requiredChecks", "mergeBy", "agentsOnBranches", "allowGithubSync"] as const;

/** Main's protection (report H5, H14): anyone in the workspace reads it. */
export async function GET(request: Request, context: Ctx) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "read", workspaceId: id }, (auth) => getProtection(auth, id));
}

/**
 * Owners and admins change it, people only. Loosening it needs "Verify it's you", which only the app can give, so a
 * terminal can tighten the rules but not loosen them. Every change goes to the security log.
 */
export async function PUT(request: Request, context: Ctx) {
  const { id } = await context.params;
  return changeSetRoute(request, { limit: "other", workspaceId: id }, async (auth, req) => {
    const body = await readJson(req);
    const patch = Object.fromEntries(KEYS.filter((k) => k in body).map((k) => [k, body[k]])) as Partial<Protection>;
    const verified = !auth.tokenScopes && (await personStepUp(auth)) === null;
    return { rules: (await setProtection(auth, id, patch, { verified, request: req })).rules };
  });
}
