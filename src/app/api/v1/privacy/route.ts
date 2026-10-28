import { handlePrivacySettingPatch } from "@/app/api/v1/privacy/_update";
import {
  enforceRouteLimit,
  getRequestId,
  jsonError,
  jsonSuccess,
  logApiRoute,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { logger } from "@/lib/logger";
import { validateCsrf } from "@/lib/security/csrf";
import { listPrivacyActivity } from "@/lib/privacy/audit";
import { getPrivacySettingsPayload, listBlockedAccounts } from "@/lib/privacy/settings";

function getVisibilitySummary(value: "public" | "connections" | "private") {
  if (value === "connections") return "connections only";
  return value;
}

function formatPrivacyActivityEntry(entry: Awaited<ReturnType<typeof listPrivacyActivity>>[number]) {
  switch (entry.eventType) {
    case "profile_visibility_changed": {
      const nextVisibility = typeof entry.nextValue?.visibility === "string" ? entry.nextValue.visibility : "public";
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Profile visibility updated",
        summary: `Profile visibility changed to ${getVisibilitySummary(nextVisibility as "public" | "connections" | "private")}.`,
      };
    }
    case "message_privacy_changed": {
      const nextValue = typeof entry.nextValue?.messagePrivacy === "string" ? entry.nextValue.messagePrivacy : "connections";
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Messaging updated",
        summary: nextValue === "everyone" ? "Messages are now open to everyone." : "Messages are now limited to connections.",
      };
    }
    case "connection_privacy_changed": {
      const nextValue = typeof entry.nextValue?.connectionPrivacy === "string" ? entry.nextValue.connectionPrivacy : "everyone";
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Request permissions updated",
        summary:
          nextValue === "nobody"
            ? "New connection requests are now turned off."
            : nextValue === "mutuals_only"
              ? "Only mutual connections can send new requests."
              : "Connection requests are now open to everyone eligible.",
      };
    }
    case "account_blocked":
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Account blocked",
        summary: `Blocked ${typeof entry.metadata?.targetUsername === "string" ? `@${entry.metadata.targetUsername}` : "an account"}.`,
      };
    case "account_unblocked":
      return {
        id: entry.id,
        eventType: entry.eventType,
        createdAt: entry.createdAt,
        label: "Account unblocked",
        summary: "Removed a blocked account restriction.",
      };
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);

  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) {
    return auth.response ?? jsonError("Not authenticated", 401, "UNAUTHORIZED");
  }
  const limitResponse = await enforceRouteLimit(request, "api:v1:privacy:get", 120, 60, "default", auth.user.id);
  if (limitResponse) return limitResponse;

  try {
    const [settings, blockedPage, privacyActivity] = await Promise.all([
      getPrivacySettingsPayload(auth.user.id),
      listBlockedAccounts(auth.user.id),
      // The tab shows the four most recent and expands to the rest.
      listPrivacyActivity(auth.user.id, 10),
    ]);

    logApiRoute(request, {
      requestId,
      action: "privacy.get",
      userId: auth.user.id,
      startedAt,
      success: true,
      status: 200,
    });
    return jsonSuccess(
      {
        settings,
        blockedAccounts: blockedPage.accounts,
        blockedAccountsNextCursor: blockedPage.nextCursor,
        privacyActivity: privacyActivity.map(formatPrivacyActivityEntry),
      },
      undefined,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    logger.error("[api/v1/privacy] failed", { module: 'api', error: error instanceof Error ? error.message : String(error) });
    logApiRoute(request, {
      requestId,
      action: "privacy.get",
      userId: auth.user.id,
      startedAt,
      success: false,
      status: 500,
      errorCode: "INTERNAL_ERROR",
    });
    return jsonError("Failed to load privacy settings", 500, "INTERNAL_ERROR");
  }
}

const PRIVACY_SETTINGS = [
  {
    kind: "profileVisibility",
    bodyKey: "visibility",
    responseKey: "visibility",
    values: ["public", "connections", "private"] as const,
    invalidMessage: "Invalid profile visibility",
    failureMessage: "Failed to update profile visibility",
  },
  {
    kind: "connectionPrivacy",
    bodyKey: "connectionPrivacy",
    responseKey: "connectionPrivacy",
    values: ["everyone", "mutuals_only", "nobody"] as const,
    invalidMessage: "Invalid connection request privacy",
    failureMessage: "Failed to update connection request privacy",
  },
  {
    kind: "messagePrivacy",
    bodyKey: "messagePrivacy",
    responseKey: "messagePrivacy",
    values: ["everyone", "connections"] as const,
    invalidMessage: "Invalid messaging privacy",
    failureMessage: "Failed to update messaging privacy",
  },
] as const;

export async function PATCH(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
  const matches = PRIVACY_SETTINGS.filter((candidate) => body && candidate.bodyKey in body);
  // One setting per request: applying only the first of several would silently drop the rest.
  if (matches.length !== 1) return jsonError(matches.length ? "Change one privacy setting at a time" : "Unknown privacy setting", 400, "BAD_REQUEST");
  const setting = matches[0]!;
  return handlePrivacySettingPatch<string>(request, setting);
}
