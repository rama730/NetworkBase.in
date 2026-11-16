import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { chatFailure } from "@/lib/messaging/server";

type Auth = Awaited<ReturnType<typeof requireAuthenticatedUser>> & { user: { id: string } };

/**
 * Messages from a token (report C4): the person's own sign-in or a token with message:read / message:write. Agents
 * never read or send messages (C15 risk: privacy), whatever their access.
 */
export async function withChat(request: Request, scope: string, run: (auth: Auth) => Promise<Response>) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    if (auth.tokenKind === "agent") return jsonError("Agents can't read or send messages; ask the person to", 403, "AGENT_NOT_ALLOWED");
    return await run(auth as Auth);
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope, fallback: "Couldn’t reach messages" });
  }
}

/** The chat functions' error codes as API errors; a block never says which way (B31). */
export function chatError(error: unknown, action: string) {
  const failure = typeof error === "string" ? { error } : chatFailure(error, action);
  const code = failure.error;
  if (code === "chat_rate_limited") return jsonError("Too many messages at once; wait a few seconds", 429, "RATE_LIMITED");
  if (code === "chat_not_member" || code === "chat_channel_not_found" || code === "chat_not_project_member") return jsonError("Conversation not found, or you're not in it", 404, "NOT_FOUND");
  if (code === "chat_cannot_reply") return jsonError("You can't reply in this conversation", 403, "FORBIDDEN");
  if (code === "chat_org_read_only") return jsonError("This conversation is read-only", 403, "FORBIDDEN");
  if (code === "chat_invalid_input" || code === "chat_invalid_body") return jsonError("That message can't be sent", 400, "BAD_REQUEST");
  if (code === "chat_unavailable") return jsonError("Messages aren't available right now; try again", 503, "UNAVAILABLE");
  return jsonError("You can't send messages here", 403, "FORBIDDEN");
}
