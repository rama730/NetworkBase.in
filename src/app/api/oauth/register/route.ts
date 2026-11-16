import { z } from "zod";

import { registerClient } from "@/lib/extension/oauth";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getTrustedRequestIp } from "@/lib/security/request-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ client_name: z.string().max(200).optional(), redirect_uris: z.array(z.string().max(500)).min(1).max(10) }).passthrough();
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });

/** Dynamic client registration (RFC 7591) for editors connecting to the hosted MCP server: public clients only. */
export async function POST(request: Request) {
  const ip = getTrustedRequestIp(request) ?? "unknown";
  if (!(await consumeRateLimit(`oauth:register:${ip}`, 20, 3600)).allowed) return json({ error: "slow_down", error_description: "Too many registrations; try again later" }, 429);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_client_metadata", error_description: "Send redirect_uris (and client_name)" }, 400);
  const result = await registerClient({ clientName: parsed.data.client_name ?? "MCP client", redirectUris: parsed.data.redirect_uris });
  if ("error" in result) return json({ error: "invalid_redirect_uri", error_description: result.error }, 400);
  return json({
    client_id: result.clientId, client_name: result.clientName, redirect_uris: result.redirectUris,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  }, 201);
}
