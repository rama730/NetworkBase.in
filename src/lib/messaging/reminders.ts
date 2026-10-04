// "Later" times: one list for Remind me (message menu, Saved) and Schedule message (Composer).
// Labels use the viewer's clock format; each time is computed when picked (a menu left open stays right).

export type LaterTime = { label: string; at: () => Date };

const clockLabel = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function laterTimes(kind: "remind" | "schedule", now?: Date): LaterTime[] {
  const base = () => (now ? new Date(now) : new Date());
  const inMinutes = (minutes: number) => () => new Date(base().getTime() + minutes * 60_000);
  const nineAm = (daysAhead: (day: Date) => number) => () => {
    const at = base();
    at.setDate(at.getDate() + daysAhead(at));
    at.setHours(9, 0, 0, 0);
    return at;
  };
  const tomorrow = nineAm(() => 1);
  const monday = nineAm((day) => (8 - day.getDay()) % 7 || 7);
  const nine = clockLabel(tomorrow());
  const times: LaterTime[] = [
    ...(kind === "remind" ? [{ label: "In 20 minutes", at: inMinutes(20) }] : []),
    { label: "In 1 hour", at: inMinutes(60) },
    ...(kind === "remind" ? [{ label: "In 3 hours", at: inMinutes(180) }] : []),
    { label: `Tomorrow at ${nine}`, at: tomorrow },
  ];
  // On Sundays Monday is tomorrow: one entry, not two.
  if (base().getDay() !== 0) times.push({ label: `Monday at ${nine}`, at: monday });
  return times;
}
