import { chatError, withChat } from "@/app/api/v1/chat/_shared";
import { isUuid } from "@/lib/messaging/server";
import { jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { messageMarkReadSchema } from "@/lib/api/v1-schemas";
import { markConversationRead } from "@/lib/messaging/api";
import { countsOrNothing } from "@/lib/messaging/inbox-counts";
import { publishUser } from "@/lib/messaging/publish";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string }> };

/** Read up to a message, as opening the conversation in the app does; the app's badges update at once. */
export async function POST(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return withChat(request, "api/v1/chat/read", async (auth) => {
    const { channelId } = await context.params;
    if (!isUuid(channelId)) return jsonError("Conversation not found", 404, "NOT_FOUND");
    const parsed = messageMarkReadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("seq is the last message read", 400, "BAD_REQUEST");
    try {
      const moved = await markConversationRead(auth.user.id, channelId, parsed.data.seq);
      if (moved) publishUser(auth.user.id, "read.moved", { channel_id: channelId, seq: parsed.data.seq, ...(await countsOrNothing(auth.user.id)) });
      return jsonSuccess({ moved });
    } catch (error) {
      return chatError(error, "api_mark_read");
    }
  });
}
