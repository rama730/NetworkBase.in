import { exchangeCode, refreshAccessToken } from "@/lib/extension/oauth";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getTrustedRequestIp } from "@/lib/security/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "Access-Control-Allow-Origin": "*" } });

/** The token endpoint (RFC 6749 §4.1.3 with PKCE, §6 refresh): a one-time code or a refresh token becomes a workspace-bound agent token. */
export async function POST(request: Request) {
  const ip = getTrustedRequestIp(request) ?? "unknown";
  if (!(await consumeRateLimit(`oauth:token:${ip}`, 30, 600)).allowed) return json({ error: "slow_down", error_description: "Too many attempts; try again later" }, 429);
  const type = request.headers.get("content-type") ?? "";
  const raw = type.includes("application/json")
    ? Object.fromEntries(Object.entries((await request.json().catch(() => ({}))) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]))
    : Object.fromEntries(new URLSearchParams(await request.text()));
  const result = raw.grant_type === "refresh_token"
    ? raw.refresh_token && raw.client_id
      ? await refreshAccessToken({ refreshToken: raw.refresh_token, clientId: raw.client_id })
      : ({ error: "invalid_request", description: "Send refresh_token and client_id" } as const)
    : raw.grant_type === "authorization_code"
      ? raw.code && raw.code_verifier && raw.redirect_uri && raw.client_id
        ? await exchangeCode({ code: raw.code, codeVerifier: raw.code_verifier, redirectUri: raw.redirect_uri, clientId: raw.client_id })
        : ({ error: "invalid_request", description: "Send code, code_verifier, redirect_uri and client_id" } as const)
      : ({ error: "unsupported_grant_type", description: "authorization_code or refresh_token" } as const);
  if ("error" in result) return json({ error: result.error, error_description: result.description }, 400);
  return json({
    access_token: result.accessToken, token_type: "Bearer",
    expires_in: Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)), scope: result.scopes.join(" "),
    ...(result.refreshToken ? { refresh_token: result.refreshToken } : {}),
  }, 200);
}
