/** What a row or push button acts on (notifications mix): a connection request, an agent question or an access request. */
export type ActTarget = { source: "connection" | "agent_question" | "agent_access"; id: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY = new RegExp(`^(connection|agent_question|agent_access):(${UUID})$`, "i");
const DEDUPE: Array<[RegExp, ActTarget["source"]]> = [
  [new RegExp(`^connection:(${UUID}):received$`, "i"), "connection"],
  [new RegExp(`^agent-question:(${UUID})$`, "i"), "agent_question"],
  [new RegExp(`^agent-access-request:(${UUID})$`, "i"), "agent_access"],
];

/** A Needs you item's key ("connection:<uuid>"); reviews and notices are opened, never acted on. */
export function parseNeedsYouKey(key: string): ActTarget | null {
  const match = KEY.exec(key);
  return match ? { source: match[1]!.toLowerCase() as ActTarget["source"], id: match[2]! } : null;
}

/** The same target from a notification row's dedupe key (the push service worker only knows the row). */
export function actTargetFromDedupeKey(dedupeKey: string): ActTarget | null {
  for (const [pattern, source] of DEDUPE) {
    const match = pattern.exec(dedupeKey);
    if (match) return { source, id: match[1]! };
  }
  return null;
}
