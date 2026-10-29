export function toIsoString(value: Date | string | null | undefined): string | null {
  return toDateValue(value)?.toISOString() ?? null;
}

export function toDateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type DateInput = Date | number | string;

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];
const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

// ponytail: one fixed locale (en-US) so server and browser render the same text. Decision 31 asks for the
// viewer's locale; that needs dates rendered only in the browser (hydration), so it waits for that change.
/** Decision 31: the short date ("Oct 29"), in a time zone when one is known. */
export function formatShortDate(value: DateInput, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(toDate(value));
}

/** Decision 31: the long date ("Oct 29, 2026, 3:40 PM"). */
export function formatLongDate(value: DateInput, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(toDate(value));
}

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDistanceToNow(value: DateInput, options: { addSuffix?: boolean } = {}): string {
  const seconds = Math.round((toDate(value).getTime() - Date.now()) / 1000);
  const [unit, size] = RELATIVE_UNITS.find(([, unitSeconds]) => Math.abs(seconds) >= unitSeconds) ?? ["second", 1];
  const amount = Math.round(seconds / size);
  if (options.addSuffix) return relativeFormatter.format(amount, unit);
  return new Intl.NumberFormat("en", { style: "unit", unit, unitDisplay: "long" }).format(Math.abs(amount));
}

export const formatDistanceToNowStrict = formatDistanceToNow;

export function format(value: DateInput, pattern: "MMM d" | "MMM d, yyyy" | "p" | "MMM d, yyyy h:mm a" | "yyyy-MM-dd"): string {
  const date = toDate(value);
  if (pattern === "MMM d") return monthDay.format(date);
  if (pattern === "MMM d, yyyy") return monthDayYear.format(date);
  if (pattern === "p") return shortTime.format(date);
  if (pattern === "MMM d, yyyy h:mm a") return `${monthDayYear.format(date)} ${shortTime.format(date)}`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseISO(value: string): Date {
  return new Date(value);
}

export function startOfDay(value: DateInput): Date {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(value: DateInput, days: number): Date {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
}

export function subDays(value: DateInput, days: number): Date {
  return addDays(value, -days);
}

export function isAfter(value: DateInput, other: DateInput): boolean {
  return toDate(value).getTime() > toDate(other).getTime();
}

export function isBefore(value: DateInput, other: DateInput): boolean {
  return toDate(value).getTime() < toDate(other).getTime();
}

export function isToday(value: DateInput): boolean {
  return startOfDay(value).getTime() === startOfDay(Date.now()).getTime();
}

export function isSameYear(value: DateInput, other: DateInput): boolean {
  return toDate(value).getFullYear() === toDate(other).getFullYear();
}
