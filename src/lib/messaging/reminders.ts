// "Remind me about this": one list for the message menu and Saved, each time computed when picked.

function nineAm(daysAhead: (now: Date) => number) {
  const at = new Date();
  at.setDate(at.getDate() + daysAhead(at));
  at.setHours(9, 0, 0, 0);
  return at.toISOString();
}
const inMinutes = (minutes: number) => () => new Date(Date.now() + minutes * 60_000).toISOString();

export const REMINDER_TIMES: readonly { label: string; at: () => string }[] = [
  { label: "In 20 minutes", at: inMinutes(20) },
  { label: "In 1 hour", at: inMinutes(60) },
  { label: "In 3 hours", at: inMinutes(180) },
  { label: "Tomorrow at 9:00", at: () => nineAm(() => 1) },
  { label: "Next Monday at 9:00", at: () => nineAm((now) => (8 - now.getDay()) % 7 || 7) },
];
