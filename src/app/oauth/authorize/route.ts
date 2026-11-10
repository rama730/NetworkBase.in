import { oauthIssuer, startAuthorization } from "@/lib/extension/oauth";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getTrustedRequestIp } from "@/lib/security/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The authorization endpoint: a valid request becomes a sign-in code and the person lands on the /device approval
 * page with it filled in, to pick the one workspace the editor may use. Errors before the redirect is known are shown
 * here; after that they go back to the editor (RFC 6749 §4.1.2.1).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ip = getTrustedRequestIp(request) ?? "unknown";
  if (!(await consumeRateLimit(`oauth:authorize:${ip}`, 30, 600)).allowed) return new Response("Too many sign-in requests. Try again in a few minutes.", { status: 429 });
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state");
  if (params.get("response_type") !== "code") return new Response("This sign-in link is broken: response_type must be code.", { status: 400 });
  const started = await startAuthorization({
    clientId: params.get("client_id") ?? "", redirectUri, state,
    codeChallenge: params.get("code_challenge") ?? "", codeChallengeMethod: params.get("code_challenge_method") ?? "",
    ipAddress: ip, userAgent: request.headers.get("user-agent"),
  });
  if ("error" in started) {
    if (!started.redirectable) return new Response(`This sign-in link can't be used: ${started.description}.`, { status: 400 });
    const back = new URL(redirectUri);
    back.searchParams.set("error", started.error);
    back.searchParams.set("error_description", started.description);
    if (state) back.searchParams.set("state", state);
    return Response.redirect(back.toString(), 302);
  }
  return Response.redirect(`${oauthIssuer(request)}/device?code=${encodeURIComponent(started.userCode)}`, 302);
}
