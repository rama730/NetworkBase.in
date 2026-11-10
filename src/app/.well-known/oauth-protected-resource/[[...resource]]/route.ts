import { oauthIssuer } from "@/lib/extension/oauth";

export const runtime = "nodejs";

/**
 * Protected resource metadata (RFC 9728) for the hosted MCP server, at /.well-known/oauth-protected-resource and its
 * path form /.well-known/oauth-protected-resource/api/mcp: which authorization server issues its tokens.
 */
export async function GET(request: Request) {
  const issuer = oauthIssuer(request);
  return Response.json(
    { resource: `${issuer}/api/mcp`, authorization_servers: [issuer], bearer_methods_supported: ["header"], resource_name: "NetworkBase" },
    { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
  );
}
