/** What a Message button does for one person (EntryPoints board). */
export type MessageGate =
  | { state: "open" }
  | { state: "off"; tag: "Can’t message"; reason: "Only accepts messages from connections" | null }
  | { state: "unblock" };

/**
 * You blocked them: no Message, the block cell reads Unblock. They blocked you: off with the tag alone (never say
 * why). Their privacy: off with the tag and the reason. Unknown: open, and the server decides on the click.
 */
export function messageGate(at: { canMessage: boolean | undefined; blocked: boolean; blockedByMe: boolean }): MessageGate {
  if (at.blockedByMe) return { state: "unblock" };
  if (at.canMessage !== false) return { state: "open" };
  return { state: "off", tag: "Can’t message", reason: at.blocked ? null : "Only accepts messages from connections" };
}
