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
 * "Plan a series": prefix + number, back to back from the start date (CO1–CO5 weekly). Each ends the day the
 * next starts, the same way a single sprint's end date is set.
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
    endDate: isoDay(new Date(start.getTime() + (i + 1) * input.lengthDays * DAY)),
  }));
}
