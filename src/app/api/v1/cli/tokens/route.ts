import { z } from "zod";
import {
  getRequestId,
  jsonError,
  jsonSuccess,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { validateCsrf } from "@/lib/security/csrf";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "@/app/actions/personal-access-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createBodySchema = z.object({
  label: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(["repo:read", "repo:write", "task:write", "sprint:manage"]))
    .min(1)
    .optional(),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

const deleteBodySchema = z.object({
  tokenId: z.string().uuid(),
});

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
      return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    const res = await listPersonalAccessTokens();
    if (!res.success) {
      return jsonError(res.error, 400, "BAD_REQUEST");
    }
    return jsonSuccess({ tokens: res.tokens });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/cli/tokens",
      fallback: "Couldn’t list personal access tokens",
    });
  }
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
      return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    const body = await request.json().catch(() => null);
    const parsed = createBodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid token creation payload", 400, "BAD_REQUEST");
    }

    const res = await createPersonalAccessToken(parsed.data);
    if (!res.success) {
      return jsonError(res.error, 400, "BAD_REQUEST");
    }

    return jsonSuccess({
      rawToken: res.rawToken,
      token: res.token,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/cli/tokens",
      fallback: "Couldn’t create personal access token",
    });
  }
}

export async function DELETE(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
      return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }

    const body = await request.json().catch(() => null);
    const parsed = deleteBodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid token ID", 400, "BAD_REQUEST");
    }

    const res = await revokePersonalAccessToken(parsed.data.tokenId);
    if (!res.success) {
      return jsonError(res.error, 400, "BAD_REQUEST");
    }

    return jsonSuccess({ revoked: true });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/cli/tokens",
      fallback: "Couldn’t revoke personal access token",
    });
  }
}
