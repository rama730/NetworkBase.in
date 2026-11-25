/** What a Message button does for one person (EntryPoints board). */
export type MessageGate =
  | { state: "open" }
  | { state: "off"; tag: "Can’t message"; reason: "Only accepts messages from connections" | null }
  | { state: "unblock" };

/** Why the server said no, when it is safe to say: their own message privacy (connections only). Never a block. */
export type MessageReason = "connections" | null;

/**
 * You blocked them (known on your side only): no Message, the block cell reads Unblock. The server said no: off with
 * the tag, plus the reason only when it is their privacy. Unknown: open, and the server decides on the click.
 */
export function messageGate(at: { canMessage: boolean | undefined; reason: MessageReason | undefined; blockedByMe: boolean }): MessageGate {
  if (at.blockedByMe) return { state: "unblock" };
  if (at.canMessage !== false) return { state: "open" };
  return { state: "off", tag: "Can’t message", reason: at.reason === "connections" ? "Only accepts messages from connections" : null };
}
