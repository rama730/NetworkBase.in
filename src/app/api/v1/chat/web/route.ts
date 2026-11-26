import { getChannel } from "@/app/actions/chat/channels";
import { listMessages } from "@/app/actions/chat/messages";

// The web app's first reads of a conversation, as plain GETs: server actions run one at a time per page, so the
// message list used to wait behind every other read (11–14 of them, 2.5 s warm, 8–13 s cold). Same functions,
// same sign-in check (requireChatUser), same answers.
export const dynamic = "force-dynamic";

const int = (value: string | null) => (value && /^\d{1,12}$/.test(value) ? Number(value) : undefined);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const channelId = params.get("channelId") ?? "";
  const fn = params.get("fn");
  const result = fn === "channel"
    ? await getChannel({ channelId })
    : fn === "messages"
      ? await listMessages({ channelId, before: int(params.get("before")), around: int(params.get("around")) })
      : { success: false as const, error: "chat_invalid_input" };
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
