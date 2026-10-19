import { handlePrivacySettingPatch } from "@/app/api/v1/privacy/_update";
import {
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

function getProfilePreview(value: "public" | "connections" | "private") {
  if (value === "private") {
    return "Strangers see a locked profile shell with only limited identity and the actions you allow.";
  }
  if (value === "connections") {
    return "Strangers can still find you, but only accepted connections can open the full profile.";
  }
  return "Your full profile is open. Messaging and request rules still apply separately.";
}

function getInteractionPreview(
  messagePrivacy: "everyone" | "connections",
  connectionPrivacy: "everyone" | "mutuals_only" | "nobody",
) {
  const messages =
    messagePrivacy === "everyone" ? "Anyone can message you." : "Only connections can message you.";
  const requests =
    connectionPrivacy === "mutuals_only"
      ? "Only mutual connections can send requests."
      : connectionPrivacy === "nobody"
        ? "New connection requests are turned off."
        : "Anyone eligible can send a connection request.";
  return `${messages} ${requests}`;
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

  try {
    const [settings, blockedPage, privacyActivity] = await Promise.all([
      getPrivacySettingsPayload(auth.user.id),
      listBlockedAccounts(auth.user.id),
      listPrivacyActivity(auth.user.id, 10),
    ]);
    const overview = {
      profileVisibility: settings.profileVisibility,
      messagePrivacy: settings.messagePrivacy,
      connectionPrivacy: settings.connectionPrivacy,
      blockedCount: settings.blockedCount,
      summary: `Your profile is visible to ${getVisibilitySummary(settings.profileVisibility)}. ${settings.messagePrivacy === "everyone" ? "Anyone can message you." : "Only connections can message you."} ${settings.connectionPrivacy === "mutuals_only" ? "Only mutual connections can send requests." : settings.connectionPrivacy === "nobody" ? "New connection requests are turned off." : "Anyone eligible can send a connection request."}`,
    };

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
        overview,
        privacyActivity: privacyActivity.map(formatPrivacyActivityEntry),
        previews: {
          profileVisibility: getProfilePreview(settings.profileVisibility),
          interactionPermissions: getInteractionPreview(settings.messagePrivacy, settings.connectionPrivacy),
        },
      },
      undefined,
      { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" } },
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
  const setting = PRIVACY_SETTINGS.find((candidate) => body && candidate.bodyKey in body);
  if (!setting) return jsonError("Unknown privacy setting", 400, "BAD_REQUEST");
  return handlePrivacySettingPatch<string>(request, setting);
}
