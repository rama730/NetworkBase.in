// Message bodies are plain text with markdown plus three tokens:
//   <@user-id>   user mention      <#channel-id>   channel link
//   <!channel> / <!here>           broadcast mention
// The server derives mentions from the body, so clients cannot spoof them.
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const TOKEN = new RegExp(`<@(${UUID})>|<#(${UUID})>|<!(channel|here)>`, "g");

export type BodySegment =
  | { type: "text"; value: string }
  | { type: "user"; id: string }
  | { type: "channel"; id: string }
  | { type: "broadcast"; value: "channel" | "here" };

export function parseMentions(body: string): { userIds: string[]; broadcast: "channel" | "here" | null } {
  const userIds = new Set<string>();
  let broadcast: "channel" | "here" | null = null;
  for (const match of body.matchAll(TOKEN)) {
    if (match[1]) userIds.add(match[1].toLowerCase());
    if (match[3] === "channel" || (match[3] === "here" && broadcast === null)) broadcast = match[3];
  }
  return { userIds: [...userIds], broadcast };
}

export function splitTokens(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: "text", value: body.slice(last, index) });
    if (match[1]) segments.push({ type: "user", id: match[1].toLowerCase() });
    else if (match[2]) segments.push({ type: "channel", id: match[2].toLowerCase() });
    else segments.push({ type: "broadcast", value: match[3] as "channel" | "here" });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ type: "text", value: body.slice(last) });
  return segments;
}

/** The people and channels a body names: looked up once so a preview can say their names. */
export function previewIds(body: string) {
  const users = new Set<string>();
  const channels = new Set<string>();
  for (const segment of splitTokens(body)) {
    if (segment.type === "user") users.add(segment.id);
    if (segment.type === "channel") channels.add(segment.id);
  }
  return { users: [...users], channels: [...channels] };
}

/** Who a message mentions: the people named, or everyone it reaches for @channel / @here. */
export function mentionedRecipients(userIds: string[], broadcast: "channel" | "here" | null, notify: string[]) {
  return broadcast ? [...notify] : userIds;
}

export function tokensToPlainText(
  body: string,
  nameOf: (userId: string) => string | undefined = () => undefined,
  channelNameOf: (channelId: string) => string | undefined = () => undefined,
) {
  return splitTokens(body)
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      if (segment.type === "user") return `@${nameOf(segment.id) ?? "someone"}`;
      if (segment.type === "channel") return `#${channelNameOf(segment.id) ?? "channel"}`;
      return `@${segment.value}`;
    })
    .join("");
}

/** One-line previews (lists, pushes): tokens as names, markdown marks dropped. "**Hi** <https://x.co>" → "Hi https://x.co". */
export function previewText(
  body: string,
  nameOf?: (userId: string) => string | undefined,
  channelNameOf?: (channelId: string) => string | undefined,
) {
  return tokensToPlainText(body, nameOf, channelNameOf)
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!?\[([^\]]*)\]\([^)\s]+\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/^\s{0,3}(?:>|#{1,6})\s?/gm, "")
    .trim();
}

// Fenced blocks (closed or still open) and inline code: mentions are never encoded inside them.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

function outsideCode(text: string, encode: (part: string) => string) {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    const index = match.index ?? 0;
    out += encode(text.slice(last, index)) + match[0];
    last = index + match[0].length;
  }
  return out + encode(text.slice(last));
}

/**
 * Draft → body: "@Full Name" for a known person becomes <@id> (longest names
 * first, so "Ann Lee" wins over "Ann"); @channel and @here become broadcasts
 * unless `broadcast` is false (threads, big channels). Code is left as typed.
 */
export function encodeMentions(text: string, people: Array<{ id: string; name: string }>, options: { broadcast?: boolean } = {}) {
  const named = people.filter((person) => person.name).sort((a, b) => b.name.length - a.name.length);
  return outsideCode(text, (part) => {
    let out = options.broadcast === false
      ? part
      : part.replace(/(^|\s)@(channel|here)(?=$|[\s.,!?;:)])/g, (_match, pre: string, kind: string) => `${pre}<!${kind}>`);
    for (const person of named) {
      const escaped = person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`(^|\\s)@${escaped}(?=$|[\\s.,!?;:)])`, "g"), `$1<@${person.id}>`);
    }
    return out;
  });
}
