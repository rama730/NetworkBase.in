import { oauthIssuer } from "@/lib/extension/oauth";

export const runtime = "nodejs";

/** Authorization server metadata (RFC 8414): public clients, authorization code with PKCE (S256), self-registration. */
export async function GET(request: Request) {
  const issuer = oauthIssuer(request);
  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      service_documentation: `${issuer}/docs/agents`,
    },
    { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
  );
}
