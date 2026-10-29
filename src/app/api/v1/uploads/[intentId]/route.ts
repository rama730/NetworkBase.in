import { NextRequest } from "next/server";

import { jsonError, jsonSuccess } from "@/app/api/v1/_envelope";
import { enforceRouteLimit, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { isUuid } from "@/lib/validations/uuid";
import {
  cancelUploadOperation,
  readUploadOperationStatus,
} from "@/lib/upload/upload-intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authenticatedIntentId(
  request: NextRequest,
  context: { params: Promise<{ intentId: string }> },
  action: string,
) {
  const limitResponse = await enforceRouteLimit(request, action, 300, 60);
  if (limitResponse) return { response: limitResponse };
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return { response: auth.response ?? jsonError("Unauthorized", 401, "UNAUTHORIZED") };
  }
  const { intentId } = await context.params;
  if (!isUuid(intentId)) return { response: jsonError("Upload operation not found", 404, "NOT_FOUND") };
  return { userId: auth.user.id, intentId };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ intentId: string }> },
) {
  const resolved = await authenticatedIntentId(request, context, "api:v1:uploads:status");
  if ("response" in resolved) return resolved.response;
  const status = await readUploadOperationStatus(resolved);
  if (!status) return jsonError("Upload operation not found", 404, "NOT_FOUND");
  return jsonSuccess(status, undefined, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ intentId: string }> },
) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const resolved = await authenticatedIntentId(request, context, "api:v1:uploads:cancel");
  if ("response" in resolved) return resolved.response;
  const result = await cancelUploadOperation(resolved);
  if (!result) return jsonError("Upload operation not found", 404, "NOT_FOUND");
  if (!result.cancelled) {
    return jsonError("Upload operation can no longer be canceled", 409, "CONFLICT");
  }
  return jsonSuccess(result, undefined, { headers: { "Cache-Control": "private, no-store" } });
}
