import { withChat } from "@/app/api/v1/chat/_shared";
import { jsonSuccess } from "@/app/api/v1/_shared";
import { listConversations } from "@/lib/messaging/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Your channels, direct messages and group chats, newest first, with unread counts (nb message list). */
export async function GET(request: Request) {
  return withChat(request, "api/v1/chat/conversations", async (auth) =>
    jsonSuccess({ conversations: await listConversations(auth.user.id) }, undefined, { headers: { "Cache-Control": "private, no-store" } }));
}
