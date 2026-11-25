/** How a deleted account reads in a mention, a system line or a preview (Edges board: never a live-looking chip). */
export const DELETED_USER = "deleted user";

const MENTION = /<@([0-9a-f-]{36})>/gi;

/** People mentioned in loaded messages that nothing has named yet (asked once per conversation, at most 50). */
export function unknownMentionIds(messages: readonly { body: string }[], nameOf: (id: string) => string | undefined) {
  const ids = new Set<string>();
  for (const message of messages) for (const [, id] of message.body.matchAll(MENTION)) if (!nameOf(id!)) ids.add(id!);
  return [...ids].slice(0, 50);
}
