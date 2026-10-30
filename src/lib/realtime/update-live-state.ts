// The small rules behind live update cards (the "Update card real-time" report), kept pure so they can be tested.

const lastSeq = new Map<string, number>();

/** Counts are absolute and versioned: anything older than what's been seen is ignored, so repeats and reordering do no harm. */
export function acceptSeq(updateId: string, seq: unknown) {
  if (typeof seq !== "number") return true;
  if (seq < (lastSeq.get(updateId) ?? -1)) return false;
  lastSeq.set(updateId, seq);
  return true;
}

/** Likes this tab is waiting on: incoming counts leave the like number alone until the answer arrives, so it never jumps back. */
export const likesInFlight = new Set<string>();

const MAX_CARD_JOINS = 20;
let cardJoins = 0;
/** Discover joins only cards on screen, up to a limit (RT4). */
export function takeCardJoin() {
  if (cardJoins >= MAX_CARD_JOINS) return false;
  cardJoins += 1;
  return true;
}
export function releaseCardJoin() {
  cardJoins = Math.max(0, cardJoins - 1);
}

export function resetUpdateLiveState() {
  lastSeq.clear();
  likesInFlight.clear();
  cardJoins = 0;
}
