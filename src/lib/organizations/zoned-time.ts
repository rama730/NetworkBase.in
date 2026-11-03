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
