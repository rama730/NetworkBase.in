/** "Seen" in a one-to-one DM (Rich board): the line's words and where it goes. Never "Sent" or "Delivered". */

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Seen 9:42 AM" today, "Seen yesterday 6:10 PM", else "Seen Nov 21"; the spoken form says "at". */
export function seenLabel(at: string, now = new Date(), locale?: string) {
  const when = new Date(at);
  const time = when.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(when, now)) return { text: `Seen ${time}`, spoken: `Seen at ${time}` };
  if (sameDay(when, yesterday)) return { text: `Seen yesterday ${time}`, spoken: `Seen yesterday at ${time}` };
  const day = when.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return { text: `Seen ${day}`, spoken: `Seen ${day}` };
}

type Row = { seq: number; author_id: string | null; kind: string; thread_root_seq: number | null };

/** The seq to show "Seen" under: your newest message, once they have read it; else null. */
export function seenAfter(messages: readonly Row[], meId: string | null, peerSeen: { seq: number; at: string } | null | undefined) {
  if (!meId || !peerSeen) return null;
  const top = messages.filter((m) => m.kind === "user" && m.thread_root_seq === null && m.seq > 0);
  const last = top.at(-1);
  // Only under the newest message, when it's yours and they have read it; their reply ends it.
  return last && last.author_id === meId && last.seq <= peerSeen.seq ? last.seq : null;
}
