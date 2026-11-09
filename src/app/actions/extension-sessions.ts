"use server";

import { db } from "@/lib/db";
import { extensionDeviceSessions, extensionDeviceSessionEvents } from "@/lib/db/schema";
import { withDbRetry } from "@/lib/db/retry";
import { getTrustedHeadersIp } from "@/lib/security/request-ip";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { eq, and, isNull } from "drizzle-orm";
import crypto from "crypto";
import { issueExtensionAuthCode } from "@/lib/extension/auth-code";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import { listActiveExtensionSessionsForUser } from "@/lib/extension/active-sessions";
import { buildExtensionRevocationUri, inferExtensionCallbackUri, normalizeExtensionCallbackUri } from "@/lib/extension/session-callback";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { resolveStepUpCapabilities } from "@/lib/security/step-up-capabilities";
import { logger } from "@/lib/logger";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import { recordSecurityEventFromHeaders } from "@/lib/security/audit-from-headers";
import { z } from "zod";

type ExtensionTokenAuthMethod = "web_login" | "manual_token";

type GenerateExtensionTokenOptions = {
    authMethod?: ExtensionTokenAuthMethod;
    clientVersion?: string;
    editorHost?: string;
    editorName?: string;
    editorPlatform?: string;
    editorVersion?: string;
    requestState?: string | null;
    callbackUri?: string | null;
    /** PKCE S256 challenge from the CLI; the code exchange then needs the matching verifier (report A3.1, F37). */
    codeChallenge?: string | null;
};

const extensionSessionIdSchema = z.string().uuid();

function normalizeSessionMetadata(value: unknown, maxLength = 120) {
    if (typeof value !== "string") return null;
    const normalized = value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeDeviceName(deviceName: string, authMethod: ExtensionTokenAuthMethod) {
    const trimmed = deviceName.trim();
    if (trimmed) return trimmed.slice(0, 120);
    return authMethod === "web_login" ? "Editor extension" : "Manual token";
}

export async function getActiveExtensionSessions(
    options: { limit?: number; cursor?: string | null } = {},
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue" };
        }

        const page = await listActiveExtensionSessionsForUser(user.id, options);

        return {
            success: true as const,
            sessions: page.sessions,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
        };
    } catch (e) {
        console.error("Failed to fetch extension sessions:", e);
        return { success: false as const, error: "Couldn’t fetch active extension sessions" };
    }
}

export async function revokeExtensionSession(sessionId: string) {
    try {
        if (!extensionSessionIdSchema.safeParse(sessionId).success) {
            return { success: false as const, error: "Invalid editor session" };
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue" };
        }

        const session = await db.query.extensionDeviceSessions.findFirst({
            where: and(
                eq(extensionDeviceSessions.id, sessionId),
                eq(extensionDeviceSessions.userId, user.id)
            ),
        });

        if (!session) {
            return { success: false as const, error: "Session not found" };
        }

        const now = new Date();
        const headerStore = await headers();
        const revoked = await withDbRetry("extension.revoke_session", () => db.transaction(async (tx) => {
            const [updated] = await tx
                .update(extensionDeviceSessions)
                .set({
                    revokedAt: now,
                    revocationReason: "user_settings_disconnect",
                })
                .where(and(
                    eq(extensionDeviceSessions.id, sessionId),
                    eq(extensionDeviceSessions.userId, user.id),
                    isNull(extensionDeviceSessions.revokedAt),
                ))
                .returning({ id: extensionDeviceSessions.id });

            if (!updated) return false;

            await tx.insert(extensionDeviceSessionEvents).values({
                sessionId,
                eventType: EXTENSION_DEVICE_SESSION_EVENTS.revocation,
                ipAddress: getTrustedHeadersIp(headerStore),
                userAgent: headerStore.get("user-agent")?.trim() || null,
                metadata: { reason: "user_settings_disconnect" },
                createdAt: now,
            });
            return true;
        }), { module: "extension" });

        return {
            success: true as const,
            alreadyRevoked: !revoked,
            disconnectUri: buildExtensionRevocationUri(
                session.callbackUri ?? inferExtensionCallbackUri(session.editorHost, session.editorName),
                session.id,
            ),
        };
    } catch (e) {
        console.error("Failed to revoke extension session:", e);
        return { success: false as const, error: "Couldn’t revoke extension session" };
    }
}

export async function generateExtensionToken(
    deviceName: string,
    options: GenerateExtensionTokenOptions = {},
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false as const, error: "Sign in to continue" };
        }

        const rateLimitResult = await consumeRateLimit(`extension:token:${user.id}`, 10, 3600);
        if (!rateLimitResult.allowed) {
            return {
                success: false as const,
                error: "Too many extension tokens generated recently. Wait before creating another.",
            };
        }

        const authMethod = options.authMethod ?? "manual_token";
        // A manual token is a year-long bearer credential made from Settings: it needs the same fresh check as other
        // account-protection changes (when the account has anything to check with), and the editor details the
        // browser sends along are not trusted: the editor reports its own when it first connects.
        if (authMethod === "manual_token") {
            const { availableMethods } = await resolveStepUpCapabilities({ supabase: supabase as never, user });
            if (availableMethods.length > 0 && !(await resolveSecurityStepUp(user.id)).ok) {
                return { success: false as const, error: "Verify this device before creating a token", stepUpRequired: true as const };
            }
        }
        const trusted = authMethod === "manual_token" ? {} : options;
        const headerStore = await headers();
        const ipAddress = getTrustedHeadersIp(headerStore);
        const userAgent = headerStore.get("user-agent")?.trim() || null;
        const editorHost = normalizeSessionMetadata(trusted.editorHost, 80);
        const editorName = normalizeSessionMetadata(trusted.editorName, 120);
        const editorPlatform = normalizeSessionMetadata(trusted.editorPlatform, 80);
        const editorVersion = normalizeSessionMetadata(trusted.editorVersion, 80);
        const callbackUri = normalizeExtensionCallbackUri(options.callbackUri);

        // Generate token and hash
        const rawToken = "nb_dev_" + crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const tokenPrefix = rawToken.slice(0, 11); // "nb_dev_" + 4 characters

        // Token expires in 1 year
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);

        const createdAt = new Date();
        const session = await withDbRetry("extension.generate_token", async () => {
            return db.transaction(async (tx) => {
                const insertedSessions = await tx
                    .insert(extensionDeviceSessions)
                    .values({
                        userId: user.id,
                        tokenHash,
                        tokenPrefix,
                        deviceName: normalizeDeviceName(deviceName, authMethod),
                        clientVersion: trusted.clientVersion?.trim().slice(0, 40) || "pending",
                        ipAddress,
                        userAgent,
                        editorHost,
                        editorName,
                        editorPlatform,
                        editorVersion,
                        callbackUri,
                        expiresAt,
                        createdAt,
                        lastSeenAt: createdAt,
                    })
                    .onConflictDoNothing({ target: extensionDeviceSessions.tokenHash })
                    .returning({
                        id: extensionDeviceSessions.id,
                        userId: extensionDeviceSessions.userId,
                    });

                const session = insertedSessions[0] ?? (await tx
                    .select({
                        id: extensionDeviceSessions.id,
                        userId: extensionDeviceSessions.userId,
                    })
                    .from(extensionDeviceSessions)
                    .where(eq(extensionDeviceSessions.tokenHash, tokenHash))
                    .limit(1))[0];

                if (!session) {
                    throw new Error("Couldn’t insert extension session");
                }

                await tx.insert(extensionDeviceSessionEvents).values({
                    sessionId: session.id,
                    eventType: EXTENSION_DEVICE_SESSION_EVENTS.login,
                    ipAddress,
                    userAgent,
                    metadata: {
                        method: authMethod,
                        editorHost,
                        editorName,
                        editorPlatform,
                        editorVersion,
                    },
                    createdAt,
                });

                return session;
            });
        }, { module: "extension" });

        logger.info("extension.token_created", { module: "extension", userId: user.id, method: authMethod, sessionId: session.id });
        // A browser sign-in from the editor is something the person just did; a hand-made token is a credential to know about.
        if (authMethod === "manual_token") {
            await recordSecurityEventFromHeaders({ userId: user.id, eventType: "editor_token_created", metadata: { label: deviceName.slice(0, 120) } });
            await queueSecurityEmail(user.id, "security_token_created", { detail: deviceName });
        }
        return { success: true as const, rawToken, session };
    } catch (e) {
        console.error("Failed to generate extension token:", e);
        return { success: false as const, error: "Couldn’t generate extension token" };
    }
}

export async function generateExtensionAuthCode(
    deviceName: string,
    options: GenerateExtensionTokenOptions = {},
) {
    const callbackUri = normalizeExtensionCallbackUri(options.callbackUri);
    const requestState = typeof options.requestState === "string" ? options.requestState : "";
    if (!callbackUri || !requestState || requestState.length > 256) {
        return { success: false as const, error: "Invalid editor authorization request" };
    }
    const codeChallenge = options.codeChallenge ?? null;
    if (codeChallenge !== null && !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
        return { success: false as const, error: "Invalid editor authorization request" };
    }

    const requestStateHash = crypto.createHash("sha256").update(requestState).digest("hex");
    const result = await generateExtensionToken(deviceName, {
        ...options,
        callbackUri,
        authMethod: options.authMethod ?? "web_login",
    });

    if (!result.success) {
        return result;
    }

    try {
        const headerStore = await headers();
        const issued = issueExtensionAuthCode({
            rawToken: result.rawToken,
            sessionId: result.session.id,
            userId: result.session.userId,
        });

        await withDbRetry("extension.auth_code.issue_event", async () => {
            await db.insert(extensionDeviceSessionEvents).values({
                sessionId: result.session.id,
                eventType: EXTENSION_DEVICE_SESSION_EVENTS.authCodeIssued,
                ipAddress: getTrustedHeadersIp(headerStore),
                userAgent: headerStore.get("user-agent")?.trim() || null,
                metadata: {
                    codeHash: issued.codeHash,
                    codeId: issued.codeId,
                    expiresAt: issued.expiresAt.toISOString(),
                    requestStateHash,
                    ...(codeChallenge ? { codeChallenge } : {}),
                },
                createdAt: new Date(),
            });
        }, { module: "extension" });

        return {
            success: true as const,
            code: issued.code,
            expiresAt: issued.expiresAt.toISOString(),
            session: result.session,
        };
    } catch (error) {
        console.error("Failed to generate extension auth code:", error);
        return { success: false as const, error: "Couldn’t generate extension authorization code" };
    }
}
