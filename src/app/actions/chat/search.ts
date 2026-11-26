"use server";

import { CHAT_LIST_PAGE } from "@/lib/messaging/constants";
import { chatFailure, invalidInput, isUuid, requireChatUser, unauthorized } from "@/lib/messaging/server";
import { searchMessagesAs, type SearchHit, type SearchInput } from "@/lib/messaging/search-messages";

export type { SearchHit, SearchInput };

const date = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

/** Message search across every conversation you're in (in:, from:, has:file, date range). */
export async function searchMessages(input: SearchInput) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const query = typeof input?.query === "string" ? input.query.trim().slice(0, 200) : "";
  // Any filter is enough on its own (In, From, Has file, a date): browse a channel or a day without typing.
  if (query.length < 2 && !input.authorId && !input.hasFile && !input.channelId && !input.after && !input.before) return { success: false as const, error: "chat_search_too_short" };
  if ((input.channelId && !isUuid(input.channelId)) || (input.authorId && !isUuid(input.authorId))) return invalidInput;
  const after = date(input.after);
  const before = date(input.before);
  const cursor = date(input.cursor);
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(input.limit!, 1), CHAT_LIST_PAGE) : CHAT_LIST_PAGE;
  try {
    const hits = await searchMessagesAs(user.id, { ...input, query, after, before, cursor, limit });
    return { success: true as const, hits };
  } catch (error) {
    const code = ((error as { cause?: { code?: string } })?.cause ?? (error as { code?: string }))?.code;
    if (code === "57014") return { success: false as const, error: "chat_search_too_broad" };
    return chatFailure(error, "search");
  }
}
