import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";

import { jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { agentAccessCard } from "@/lib/agents/access-settings";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { oauthIssuer } from "@/lib/extension/oauth";
import { validateCsrf } from "@/lib/security/csrf";
// The same handler and tool definitions as `nb mcp` (CLI report A7.1 item 2, P6.1): one place decides what each
// tool does, and the tools call this server's own /api/v1 routes with the caller's token.
import { createMcpHandler } from "../../../../packages/nb-cli/lib/commands/mcp.mjs";
import { VERSION } from "../../../../packages/nb-cli/lib/context.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCRATCH = path.join(os.tmpdir(), "nb-hosted-mcp");

/**
 * Hosted MCP over Streamable HTTP: POST one JSON-RPC message (or a batch), get the answer as JSON. Cloud agents sign
 * in like any agent (`nb login --device --agent "<name>"`, report A3.1) and send `Authorization: Bearer nb_agt_…`.
 * Only agent tokens: their big changes wait for the person's yes on the server, so nothing here keeps state between
 * requests; each Mcp-Session-Id is one agent session for Undo and the end-of-session summary.
 */
export async function POST(request: Request) {
  // An editor's first call carries no token: answer 401 with the OAuth hint before the browser-only CSRF check,
  // which would otherwise turn it into a 403 the editor can't act on.
  if (!/^bearer\s+nb_(agt|dev|pat)_/i.test(request.headers.get("authorization")?.trim() ?? "")) {
    return withAuthHint(request, jsonError("The hosted MCP server takes an agent sign-in: connect with OAuth, or nb login --device --agent \"Your agent\"", 401, "UNAUTHORIZED"));
  }
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const auth = await requireAuthenticatedUser();
  if (auth.response) return auth.response;
  if (!auth.user) return withAuthHint(request, jsonError("Sign in to continue", 401, "UNAUTHORIZED"));
  const token = request.headers.get("authorization")?.replace(/^bearer\s+/i, "").trim() ?? "";
  if (auth.tokenKind !== "agent" || !token.startsWith("nb_agt_")) {
    return withAuthHint(request, jsonError("The hosted MCP server takes an agent sign-in: nb login --device --agent \"Your agent\"", 403, "FORBIDDEN"));
  }
  // The tools call this site's own API. Its address comes from configuration, never from the request's Host header
  // (which the caller controls); only a local dev server may use its own origin.
  const own = new URL(request.url);
  const apiUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? (["localhost", "127.0.0.1"].includes(own.hostname) ? own.origin : null);
  if (!apiUrl) return jsonError("The hosted MCP server isn't configured (APP_URL)", 503, "UNAVAILABLE");
  const body = await request.json().catch(() => undefined);
  if (body === undefined) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  const sessionId = request.headers.get("mcp-session-id")?.slice(0, 80) || randomUUID();
  const replies: unknown[] = [];
  // Each token gets its own scratch settings folder, so no request ever reads another person's local state.
  const home = path.join(SCRATCH, createHash("sha256").update(token).digest("hex").slice(0, 32));
  const sessionRowId = auth.extensionSessionId;
  const userId = auth.user.id;
  const scopes = [...(auth.tokenScopes ?? [])];
  const handle = createMcpHandler({
    hosted: true,
    // The access card and the Read only tool list come straight from the database (report A6), not a call to /me.
    access: async () => {
      const [profile] = await db.select({ username: profiles.username, fullName: profiles.fullName, email: profiles.email }).from(profiles).where(eq(profiles.id, userId)).limit(1);
      return { user: profile ?? { username: null, fullName: null, email: null }, access: sessionRowId ? await agentAccessCard(sessionRowId) : null, scopes };
    },
    version: VERSION,
    send: (message: unknown) => replies.push(message),
    where: {
      cwd: home,
      env: {
        NETWORKBASE_TOKEN: token,
        NETWORKBASE_API_URL: apiUrl,
        NB_HOME: home,
        NB_CREDENTIAL_STORE: "file",
        NB_NO_UPDATE_CHECK: "1",
        NB_PLAIN: "1",
        NB_WORKSPACE: auth.tokenWorkspaceId ?? "",
        NB_AGENT_SESSION: sessionId,
      } as unknown as NodeJS.ProcessEnv,
    },
  });
  await mkdir(home, { recursive: true, mode: 0o700 });
  for (const message of messages) await handle(message);
  const headers = { "Mcp-Session-Id": sessionId, "Cache-Control": "no-store" };
  // Only notifications in the request: nothing to answer (Streamable HTTP: 202).
  if (!replies.length) return new Response(null, { status: 202, headers });
  return Response.json(Array.isArray(body) ? replies : replies[0], { headers });
}

/** No server-sent stream: every answer comes back on its POST. */
export function GET() {
  return new Response("Use POST", { status: 405, headers: { Allow: "POST" } });
}

/** Points editors at OAuth (RFC 9728 resource_metadata), so they can sign in without a pasted token. */
function withAuthHint(request: Request, response: Response) {
  const metadata = `${oauthIssuer(request)}/.well-known/oauth-protected-resource/api/mcp`;
  // RFC 6750 §3.1: an error code only when a token was sent; a token-less first call just learns where to sign in.
  const error = request.headers.get("authorization") ? `, error="invalid_token", error_description="Sign in with OAuth, or use an agent token: nb login --device --agent"` : "";
  response.headers.set("WWW-Authenticate", `Bearer realm="networkbase", resource_metadata="${metadata}"${error}`);
  return response;
}
