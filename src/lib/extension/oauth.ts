/**
 * OAuth for the hosted MCP server (MCP authorization spec 2025-06-18, migration 0080). An editor registers itself
 * (RFC 7591), sends the person to /oauth/authorize, which becomes a device code shown on the /device approval page,
 * and swaps the one-time code for a token at /api/oauth/token with PKCE (S256 only). The token is the same
 * workspace-bound agent token as `nb login --device --agent`, made by the same issueApprovedToken.
 */
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { deviceCodes, oauthClients } from "@/lib/db/schema";
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
}): Promise<{ userCode: string } | AuthorizeError> {
  const client = /^[0-9a-f-]{36}$/i.test(input.clientId)
    ? (await db.select().from(oauthClients).where(eq(oauthClients.id, input.clientId)).limit(1))[0]
    : undefined;
  if (!client) return { error: "invalid_client", description: "Unknown client_id", redirectable: false };
  if (!client.redirectUris.includes(input.redirectUri)) return { error: "invalid_request", description: "redirect_uri isn't registered for this client", redirectable: false };
  if (input.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    return { error: "invalid_request", description: "PKCE with code_challenge_method=S256 is required", redirectable: true };
  }
  const created = await createDeviceCode({
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
    return { accessToken: issued.token, expiresAt: issued.expiresAt, scopes: issued.scopes };
  });
}

/** The public address OAuth documents name: the configured site, or this request's origin (local runs). */
export function oauthIssuer(request: Request) {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
}
