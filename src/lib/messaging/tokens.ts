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

export function tokensToPlainText(body: string, nameOf: (userId: string) => string | undefined = () => undefined) {
  return splitTokens(body)
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      if (segment.type === "user") return `@${nameOf(segment.id) ?? "someone"}`;
      if (segment.type === "channel") return "#channel";
      return `@${segment.value}`;
    })
    .join("");
}
