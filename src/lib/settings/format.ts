// Settings mix (2026-11-23): one way to show dates, last-active and addresses on the Settings page.

const valid = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const part = (date: Date, timeZone: string | undefined, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(date);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (date: Date, timeZone: string | undefined) => MONTHS[Number(part(date, timeZone, { month: "numeric" })) - 1];

/** The log's date column: "28 Oct", "02 Oct"; another year shows "Sep 2025". */
export function logDate(value: string | null | undefined, now = new Date(), timeZone?: string) {
  const date = valid(value);
  if (!date) return "";
  if (part(date, timeZone, { year: "numeric" }) !== part(now, timeZone, { year: "numeric" })) return `${month(date, timeZone)} ${part(date, timeZone, { year: "numeric" })}`;
  return `${part(date, timeZone, { day: "2-digit" })} ${month(date, timeZone)}`;
}

/** "active now", "active 20 min ago", "active 2 h ago", "active yesterday", "active 3 days ago", then a date. */
export function activeAgo(value: string | null | undefined, now = new Date(), timeZone?: string) {
  const date = valid(value);
  if (!date) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 5) return "active now";
  if (minutes < 60) return `active ${minutes} min ago`;
  if (minutes < 24 * 60) return `active ${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / (24 * 60));
  if (days === 1) return "active yesterday";
  if (days < 7) return `active ${days} days ago`;
  return `active ${logDate(value, now, timeZone)}`;
}

/** The network part of an address: "203.0.113.·", "2001:db8:85a3:·". Never the whole address. */
export function shortIp(value: string | null | undefined) {
  const ip = (value ?? "").trim().replace(/^::ffff:/i, "");
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.·`;
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":")}:·` : "";
  }
  return "";
}

/** "3:30 PM": no seconds. */
export function clockTime(value: string | null | undefined, timeZone?: string) {
  const date = valid(value);
  return date ? new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date) : "";
}
