import { padCount } from "@/lib/ui/tab-marker";

const DAY_MS = 86_400_000;

/** Why someone is suggested, or null when the reason only repeats the mutual count (the card shows that) or says nothing. */
export function suggestionReason(reason?: string | null): string | null {
  const text = reason?.trim();
  if (!text || /^\d+ mutual connections?$/i.test(text) || text === "Suggested for your network") return null;
  return text;
}

/** A request is new for its first 24 hours. */
export function isNewRequest(createdAt?: string | Date | null, nowMs = Date.now()): boolean {
  if (!createdAt) return false;
  const age = nowMs - new Date(createdAt).getTime();
  return age >= 0 && age <= DAY_MS;
}

/** Loaded rows as a padded count, with "+" while more pages exist. */
export function loadedCount(count: number, more: boolean): string {
  return padCount(count) + (more ? "+" : "");
}

export function searchMatchLine(count: number, more: boolean, q: string, total?: number): string {
  return `${loadedCount(count, more)}${total === undefined ? "" : ` of ${padCount(total)}`} match “${q}”`;
}
