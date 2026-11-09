// Due dates in the organization's time zone (report §32.5, decision 74): the form takes wall time there, and the
// moment is stored exactly, so Late never depends on whose browser entered it.

/** How far `timeZone` is ahead of UTC at `date`, in milliseconds. */
function offsetMs(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** A datetime-local value ("2026-11-08T23:59") read as wall time in `timeZone`; the browser's own zone without one. */
export function zonedInputToIso(local: string, timeZone: string | null | undefined) {
  if (!timeZone) return new Date(local).toISOString();
  const asUtc = Date.parse(`${local.slice(0, 16)}:00Z`);
  // Twice, so a daylight-saving change between the guess and the answer settles.
  const first = asUtc - offsetMs(new Date(asUtc), timeZone);
  return new Date(asUtc - offsetMs(new Date(first), timeZone)).toISOString();
}

/** The datetime-local value for `iso` as wall time in `timeZone`. */
export function isoToZonedInput(iso: string, timeZone: string | null | undefined) {
  const date = new Date(iso);
  if (!timeZone) return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return new Date(date.getTime() + offsetMs(date, timeZone)).toISOString().slice(0, 16);
}

/** "India Standard Time", for "11:59 PM, India Standard Time" beside the field. */
export function zoneName(timeZone: string | null | undefined) {
  if (!timeZone) return "your time";
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * A date as text in the organization's zone, or UTC without a valid one. Text the server renders must not depend on
 * the machine's zone, or the browser draws something else (React error #418).
 */
export function formatInZone(date: string | Date, options: Intl.DateTimeFormatOptions, timeZone: string | null | undefined) {
  const at = new Date(date);
  try {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: timeZone || "UTC" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(at);
  }
}

// Assignment form redesign (2026-11-09): a date and a time picked apart. Days are "YYYY-MM-DD" in the organization's
// zone, times "HH:MM"; together they are the datetime-local value the forms already send.

/** The time a picked date gets until someone changes it (Settings → Work → Due time). */
export const DEFAULT_DUE_TIME = "23:59";
export const isTimeOfDay = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
/** Every half hour, and 11:59 PM so "end of the day" never reads as midnight. */
export const TIME_OPTIONS = [...Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`), "23:59"];

export function todayInZone(timeZone: string | null | undefined, now = new Date()) {
  return isoToZonedInput(now.toISOString(), timeZone).slice(0, 10);
}
export function addDaysToDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** The next `weekday` (0 = Sunday) after `day`, never `day` itself. */
export function nextWeekday(day: string, weekday: number) {
  return addDaysToDay(day, (weekday - new Date(`${day}T00:00:00Z`).getUTCDay() + 7) % 7 || 7);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function timeLabel(time: string) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
export function relativeDay(days: number) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 1 ? `in ${days} days` : `${-days} days ago`;
}
const dayText = (day: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)).replace(",", "");

/** "Sat 14 Nov, 11:59 PM", "in 5 days", and the viewer's own clock when it reads differently ("6:29 PM"). */
export function describeLocal(local: string, timeZone: string | null | undefined, viewerZone: string | null | undefined, now = new Date()) {
  const [day = "", time = "00:00"] = local.split("T");
  let yourTime: string | null = null;
  if (timeZone && viewerZone) {
    const yours = isoToZonedInput(zonedInputToIso(local, timeZone), viewerZone);
    if (yours !== local.slice(0, 16)) yourTime = yours.slice(0, 10) === day ? timeLabel(yours.slice(11, 16)) : `${dayText(yours.slice(0, 10))}, ${timeLabel(yours.slice(11, 16))}`;
  }
  return { text: `${dayText(day)}, ${timeLabel(time.slice(0, 5))}`, relative: relativeDay(daysBetween(todayInZone(timeZone, now), day)), yourTime };
}

/** The days "Repeat weekly until" makes: the first, then each week up to `until` (the server's limit: 26 more). */
export function weeklyDays(first: string, until: string) {
  const days = [first];
  while (days.length < 27) {
    const next = addDaysToDay(days[days.length - 1]!, 7);
    if (next > until) break;
    days.push(next);
  }
  return days;
}
/** "14, 21, 28 Nov, 5 Dec". */
export function dayList(days: string[]) {
  const month = (day: string) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  const groups: Array<{ month: string; dates: number[] }> = [];
  for (const day of days) {
    const m = month(day);
    if (groups.at(-1)?.month !== m) groups.push({ month: m, dates: [] });
    groups.at(-1)!.dates.push(Number(day.slice(8, 10)));
  }
  return groups.map((g) => `${g.dates.join(", ")} ${g.month}`).join(", ");
}
