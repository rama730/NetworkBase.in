import { ORG_LIMITS } from "@/lib/organizations/config";

// Org sprint rules (report §15.1–15.2), pure so the modal and the server agree.

type Range = { startDate: Date; endDate: Date };

/** Two sprints overlap when they share time; one ending the day the next starts does not. */
export function overlaps(a: Range, b: Range) {
  return a.startDate.getTime() < b.endDate.getTime() && b.startDate.getTime() < a.endDate.getTime();
}

/** A linked child sprint stays inside its org sprint, bounds included. */
export function fitsInside(child: Range, parent: Range) {
  return child.startDate.getTime() >= parent.startDate.getTime() && child.endDate.getTime() <= parent.endDate.getTime();
}

const DAY = 24 * 3600 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Repeat ("Plan more like this", report §16.2, §28.2): prefix + number, back to back from the start date. Each ends
 * the day before the next starts (decision 123), so the running one is over when the next is due (problem 3).
 */
export function buildSprintSeries(input: { prefix: string; count: number; lengthDays: number; startDate: string; firstNumber?: number }) {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > ORG_LIMITS.sprintsPerSeries) {
    throw new Error(`A series has 1 to ${ORG_LIMITS.sprintsPerSeries} sprints.`);
  }
  if (!Number.isInteger(input.lengthDays) || input.lengthDays < 1 || input.lengthDays > 366) throw new Error("Each sprint lasts 1 to 366 days.");
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime())) throw new Error("Choose a start date.");
  const first = input.firstNumber ?? 1;
  return Array.from({ length: input.count }, (_, i) => ({
    name: `${input.prefix}${first + i}`,
    startDate: isoDay(new Date(start.getTime() + i * input.lengthDays * DAY)),
    endDate: isoDay(new Date(start.getTime() + ((i + 1) * input.lengthDays - 1) * DAY)),
  }));
}

/** The next number for a prefix: CO1–CO3 exist, so Repeat continues at CO4 (report §28.2). */
export function nextSeriesNumber(prefix: string, names: string[]) {
  const numbers = names.flatMap((name) => {
    const rest = name.startsWith(prefix) ? name.slice(prefix.length) : "";
    return /^\d+$/.test(rest) ? [Number(rest)] : [];
  });
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

/**
 * The Repeat preview (report §28.2): an overlap blocks Create and offers "Start after <clash>"; passing the term
 * end only warns.
 */
export function seriesPreview(rows: Array<{ name: string; startDate: string; endDate: string }>, existing: Array<Range & { name: string }>, termEnd: string | null | undefined) {
  const out = rows.map((row) => {
    const range = { startDate: new Date(`${row.startDate}T00:00:00.000Z`), endDate: new Date(`${row.endDate}T00:00:00.000Z`) };
    const clash = existing.find((other) => overlaps(range, other)) ?? null;
    return { ...row, clash: clash?.name ?? null, clashEnd: clash?.endDate ?? null, pastTermEnd: Boolean(termEnd && row.endDate > termEnd) };
  });
  const first = out.find((r) => r.clash);
  return {
    rows: out.map(({ clashEnd: _end, ...row }) => row),
    blocked: Boolean(first),
    startAfter: first?.clashEnd ? isoDay(new Date(first.clashEnd.getTime() + DAY)) : null,
  };
}

const SHORT_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** A linked sprint outside its organization sprint, said beside the field (report §18.2). */
export function insideError(child: Range, parent: Range & { name: string }) {
  if (child.startDate.getTime() < parent.startDate.getTime()) return `${parent.name} starts ${SHORT_DAY.format(parent.startDate)}. Pick a later date.`;
  if (child.endDate.getTime() > parent.endDate.getTime()) return `${parent.name} ends ${SHORT_DAY.format(parent.endDate)}. Pick an earlier date.`;
  return null;
}
