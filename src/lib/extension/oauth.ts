/**
 * OAuth for the hosted MCP server (MCP authorization spec 2025-06-18, migration 0080). An editor registers itself
 * (RFC 7591), sends the person to /oauth/authorize, which becomes a device code shown on the /device approval page,
 * and swaps the one-time code for a token at /api/oauth/token with PKCE (S256 only). The token is the same
 * workspace-bound agent token as `nb login --device --agent`, made by the same issueApprovedToken.
 */
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { deviceCodes, extensionDeviceSessions, oauthClients, oauthRefreshTokens } from "@/lib/db/schema";
import { createDeviceCode, issueApprovedToken, normalizeUserCode } from "@/lib/extension/device-codes";

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const s256 = (verifier: string) => crypto.createHash("sha256").update(verifier).digest("base64url");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "http:", "ftp:", "ws:", "wss:"]);

/** Where an authorization may send the person back: https, http on this machine (RFC 8252), or an app's own scheme. */
export function validRedirectUri(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.hash || raw.length > 500) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return !BLOCKED_SCHEMES.has(url.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

export async function registerClient(input: { clientName: string; redirectUris: string[] }): Promise<{ clientId: string; clientName: string; redirectUris: string[] } | { error: string }> {
  const name = input.clientName.trim().slice(0, 100);
  const uris = [...new Set(input.redirectUris)];
  if (!name) return { error: "client_name is required" };
  if (!uris.length || uris.length > 10 || !uris.every(validRedirectUri)) return { error: "redirect_uris must be 1–10 https, loopback http or app-scheme URLs" };
  const [row] = await db.insert(oauthClients).values({ clientName: name, redirectUris: uris }).returning({ id: oauthClients.id });
  return { clientId: row!.id, clientName: name, redirectUris: uris };
}

export type AuthorizeError = { error: "invalid_request" | "invalid_client" | "unsupported_response_type"; description: string; redirectable: boolean };

/** An authorization request becomes a pending device code for the approval page; only a registered redirect counts. */
export async function startAuthorization(input: {
  clientId: string; redirectUri: string; state: string | null; codeChallenge: string; codeChallengeMethod: string;
  ipAddress?: string | null; userAgent?: string | null;
  /** OAuth `scope` words (report A10): networkbase:full|small|read and networkbase:workspace:<uuid>. */
  scope?: string | null; country?: string | null;
}): Promise<{ userCode: string } | AuthorizeError> {
  const client = /^[0-9a-f-]{36}$/i.test(input.clientId)
    ? (await db.select().from(oauthClients).where(eq(oauthClients.id, input.clientId)).limit(1))[0]
    : undefined;
  if (!client) return { error: "invalid_client", description: "Unknown client_id", redirectable: false };
  if (!client.redirectUris.includes(input.redirectUri)) return { error: "invalid_request", description: "redirect_uri isn't registered for this client", redirectable: false };
  if (input.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    return { error: "invalid_request", description: "PKCE with code_challenge_method=S256 is required", redirectable: true };
  }
  const words = (input.scope ?? "").split(/\s+/);
  const requestedAccess = (["full", "small", "read"] as const).find((a) => words.includes(`networkbase:${a}`)) ?? null;
  const requestedWorkspace = words.map((w) => /^networkbase:workspace:([0-9a-f-]{36})$/i.exec(w)?.[1]).find(Boolean) ?? null;
  const created = await createDeviceCode({
    requestedAccess, requestedWorkspace, country: input.country ?? null,
    clientName: client.clientName, deviceName: "OAuth sign-in", type: "agent", agentName: client.clientName,
    ipAddress: input.ipAddress ?? null, userAgent: input.userAgent ?? null,
    oauth: { clientId: client.id, redirectUri: input.redirectUri, state: input.state?.slice(0, 500) ?? null, codeChallenge: input.codeChallenge },
  });
  return { userCode: created.userCode };
}

/** After the person answers on /device: where to send them for an OAuth request (with a one-time code), else null. */
export async function redirectAfterDecision(userCode: string): Promise<string | null> {
  const normalized = normalizeUserCode(userCode);
  if (!normalized) return null;
  const [row] = await db.select().from(deviceCodes).where(eq(deviceCodes.userCode, normalized)).limit(1);
  if (!row?.oauthClientId || !row.redirectUri) return null;
  const url = new URL(row.redirectUri);
  if (row.oauthState) url.searchParams.set("state", row.oauthState);
  if (row.status !== "approved") {
    url.searchParams.set("error", "access_denied");
    return url.toString();
  }
  const code = crypto.randomBytes(32).toString("base64url");
  const set = await db.update(deviceCodes).set({ oauthCodeHash: sha256Hex(code) })
    .where(and(eq(deviceCodes.id, row.id), isNull(deviceCodes.oauthCodeHash))).returning({ id: deviceCodes.id });
  if (!set.length) return null;
  url.searchParams.set("code", code);
  return url.toString();
}

/** The token endpoint: the code once, from the same client and redirect, with the verifier for its challenge. */
export async function exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string; clientId: string }, now = new Date()) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(deviceCodes).where(eq(deviceCodes.oauthCodeHash, sha256Hex(input.code))).limit(1).for("update");
    const invalid = { error: "invalid_grant" as const, description: "The code is wrong, used, expired, or doesn't match this request" };
    if (!row || row.status !== "approved" || row.expiresAt <= now) return invalid;
    if (row.oauthClientId !== input.clientId || row.redirectUri !== input.redirectUri) return invalid;
    if (!row.codeChallenge || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier) || s256(input.codeVerifier) !== row.codeChallenge) return invalid;
    const issued = await issueApprovedToken(tx, row, now, "oauth");
    // A sign-in the person chose to keep short (7 days) ends then: only 30 and 90 days renew (report F4).
    const renews = issued.expiresAt.getTime() - now.getTime() >= RENEWABLE_MS;
    const refreshToken = renews ? await issueRefreshToken(tx, { sessionId: issued.sessionId, clientId: input.clientId, familyId: crypto.randomUUID() }, now) : null;
    return { accessToken: issued.token, expiresAt: issued.expiresAt, scopes: issued.scopes, refreshToken };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const RENEWABLE_MS = 29 * 86_400_000;
const REFRESH_LIFE_MS = 90 * 86_400_000;
/** A renewed access token lasts 30 days; its refresh token 90, so an editor used at least every 90 days never signs in again. */
const ACCESS_LIFE_MS = 30 * 86_400_000;

async function issueRefreshToken(tx: Tx, input: { sessionId: string; clientId: string; familyId: string }, now: Date) {
  const raw = `nb_rft_${crypto.randomBytes(32).toString("hex")}`;
  await tx.insert(oauthRefreshTokens).values({ ...input, tokenHash: sha256Hex(raw), expiresAt: new Date(now.getTime() + REFRESH_LIFE_MS), createdAt: now });
  return raw;
}

/**
 * grant_type=refresh_token (report F4): a new 30-day access token for the same sign-in, and the next refresh token. Each refresh token works once; a used one coming back means it was copied,
 * so its family and the sign-in are revoked. A revoked sign-in never renews.
 */
export async function refreshAccessToken(input: { refreshToken: string; clientId: string }, now = new Date()) {
  return db.transaction(async (tx) => {
    const invalid = { error: "invalid_grant" as const, description: "The refresh token is wrong, used, expired or revoked; sign in again" };
    if (!/^nb_rft_[0-9a-f]{64}$/.test(input.refreshToken)) return invalid;
    const [row] = await tx.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, sha256Hex(input.refreshToken))).limit(1).for("update");
    if (!row || row.clientId !== input.clientId || row.revokedAt || row.expiresAt <= now) return invalid;
    if (row.usedAt) {
      await tx.update(oauthRefreshTokens).set({ revokedAt: now }).where(and(eq(oauthRefreshTokens.familyId, row.familyId), isNull(oauthRefreshTokens.revokedAt)));
      await tx.update(extensionDeviceSessions).set({ revokedAt: now }).where(and(eq(extensionDeviceSessions.id, row.sessionId), isNull(extensionDeviceSessions.revokedAt)));
      return invalid;
    }
    const [session] = await tx.select().from(extensionDeviceSessions).where(eq(extensionDeviceSessions.id, row.sessionId)).limit(1).for("update");
    if (!session || session.revokedAt) return invalid;
    const raw = `nb_agt_${crypto.randomBytes(24).toString("hex")}`;
    const expiresAt = new Date(now.getTime() + ACCESS_LIFE_MS);
    // The old access token stops working now: the editor uses the new one.
    await tx.update(extensionDeviceSessions).set({ tokenHash: sha256Hex(raw), tokenPrefix: raw.slice(0, 11), expiresAt, lastSeenAt: now }).where(eq(extensionDeviceSessions.id, session.id));
    await tx.update(oauthRefreshTokens).set({ usedAt: now }).where(eq(oauthRefreshTokens.id, row.id));
    const refreshToken = await issueRefreshToken(tx, { sessionId: session.id, clientId: row.clientId, familyId: row.familyId }, now);
    return { accessToken: raw, expiresAt, scopes: (session.scopes as string[] | null) ?? [], refreshToken };
  });
}

/** The public address OAuth documents name: the configured site, or this request's origin (local runs). */
export function oauthIssuer(request: Request) {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
}
