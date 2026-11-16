import { chatError, withChat } from "@/app/api/v1/chat/_shared";
import { isUuid } from "@/lib/messaging/server";
import { idempotentWrite, jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import { messageReadQuerySchema, messageSendSchema } from "@/lib/api/v1-schemas";
import { readConversation, sendToConversation } from "@/lib/messaging/api";
import { validateCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ channelId: string }> };

/** The latest messages (or those before ?before=seq), oldest first, as plain text (nb message read). */
export async function GET(request: Request, context: Context) {
  return withChat(request, "api/v1/chat/messages", async (auth) => {
    const { channelId } = await context.params;
    if (!isUuid(channelId)) return jsonError("Conversation not found", 404, "NOT_FOUND");
    const query = messageReadQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return jsonError("before is a message number", 400, "BAD_REQUEST");
    try {
      return jsonSuccess({ messages: await readConversation(auth.user.id, channelId, query.data.before) }, undefined, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return chatError(error, "api_read");
    }
  });
}

/** Sends as the person (nb message send). @handles of the conversation's members become mentions. */
export async function POST(request: Request, context: Context) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  return idempotentWrite(request, "chat.send", (req) => withChat(req, "api/v1/chat/messages", async (auth) => {
    const { channelId } = await context.params;
    if (!isUuid(channelId)) return jsonError("Conversation not found", 404, "NOT_FOUND");
    const parsed = messageSendSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError("Write the message: 1 to 4000 characters", 400, "BAD_REQUEST");
    try {
      const sent = await sendToConversation(auth.user.id, { channelId, text: parsed.data.text, replyTo: parsed.data.replyTo ?? null, clientId: req.headers.get("idempotency-key") });
      if (!sent.success) return chatError(sent.error ?? "chat_forbidden", "api_send");
      return jsonSuccess({ seq: sent.message?.seq ?? null });
    } catch (error) {
      return chatError(error, "api_send");
    }
  }));
}
