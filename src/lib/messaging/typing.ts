import { CHAT_TYPING_THROTTLE_MS, CHAT_TYPING_TTL_MS } from "@/lib/messaging/constants";

export type Typers = Record<string, { name: string; at: number }>;

/** Slack wording: "A is typing", "A and B are typing", "Several people are typing". */
export function typingLabel(names: string[]): { names: string[]; text: string } | null {
  if (names.length === 0) return null;
  if (names.length === 1) return { names, text: "is typing" };
  if (names.length === 2) return { names, text: "are typing" };
  return { names: [], text: "Several people are typing" };
}

/** Drop typers whose last signal is older than the TTL; same object when nothing changed. */
export function pruneTypers(typers: Typers, now: number, ttl = CHAT_TYPING_TTL_MS): Typers {
  const kept = Object.entries(typers).filter(([, typer]) => now - typer.at < ttl);
  return kept.length === Object.keys(typers).length ? typers : Object.fromEntries(kept);
}

export function withoutTyper(typers: Typers, userId: string): Typers {
  if (!typers[userId]) return typers;
  const { [userId]: _gone, ...rest } = typers;
  return rest;
}

/** Send "typing on" at most once per throttle window. */
export function shouldSendTyping(lastSentAt: number, now: number, throttle = CHAT_TYPING_THROTTLE_MS) {
  return now - lastSentAt >= throttle;
}
