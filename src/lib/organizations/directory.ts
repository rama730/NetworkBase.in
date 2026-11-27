// Report 33.3 (plan B4.2, K2): the company directory's pure rules — Reports to loops, the org chart tree, off hours.
// Client-safe.

export type ReportsTo = Record<string, string>;

/** Call 4: "Dev can't report to someone who reports to Dev" — true when `person` → `manager` would close a loop. */
export function wouldLoop(reportsTo: ReportsTo, person: string, manager: string | null): boolean {
  if (!manager) return false;
  const seen = new Set<string>([person]);
  for (let at: string | undefined = manager; at; at = reportsTo[at]) {
    if (seen.has(at)) return true;
    seen.add(at);
  }
  return false;
}

export type ChartNode = { id: string; reports: ChartNode[]; count: number };

/**
 * The org chart (call 4): a tree from Reports to, drawn never edited. People whose manager isn't in the company (or
 * who have none) sit at the top. A loop in old data never hangs it: a person already placed isn't placed again.
 */
export function orgChart(people: string[], reportsTo: ReportsTo): ChartNode[] {
  const inCompany = new Set(people);
  const under = new Map<string, string[]>();
  for (const p of people) {
    const m = reportsTo[p];
    if (m && m !== p && inCompany.has(m)) under.set(m, [...(under.get(m) ?? []), p]);
  }
  const placed = new Set<string>();
  const build = (id: string): ChartNode => {
    placed.add(id);
    const reports = (under.get(id) ?? []).filter((c) => !placed.has(c)).map(build);
    return { id, reports, count: reports.reduce((n, r) => n + 1 + r.count, 0) };
  };
  const roots = people.filter((p) => !reportsTo[p] || !inCompany.has(reportsTo[p]!) || reportsTo[p] === p).map(build);
  // Anyone left only sits in a loop: put them at the top so nobody disappears.
  for (const p of people) if (!placed.has(p)) roots.push(build(p));
  return roots;
}

export type WorkingHours = { from: string; to: string };

/** "3:40 pm" in their zone, and Off hours outside their own working hours (call 2; states). */
export function localTime(now: Date, zone: string | null, hours: WorkingHours | null) {
  if (!zone) return null;
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now); } catch { return null; }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hm = `${get("hour")}:${get("minute")}`;
  const weekend = get("weekday") === "Sat" || get("weekday") === "Sun";
  const h = Number(get("hour")), m = get("minute");
  const label = `${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
  const offHours = Boolean(hours && (weekend || hm < hours.from || hm >= hours.to));
  return { label, offHours };
}

export type ImportRow = { email: string; title: string; team: string };

/**
 * Import people (layer 3): "email, title, team" per line (a header row is skipped), grouped so each group is one email
 * invite with its title and team. ponytail: plain commas only, no quoted fields; a real CSV parser if people paste them.
 */
export function importGroups(text: string): { groups: Array<{ title: string; team: string; emails: string[] }>; skipped: number } {
  const groups = new Map<string, { title: string; team: string; emails: string[] }>();
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const [email = "", title = "", team = ""] = line.split(",").map((c) => c.trim());
    if (!email || /^e-?mail$/i.test(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { skipped++; continue; }
    const key = `${title}\u0000${team}`;
    const g = groups.get(key) ?? { title: title.slice(0, 60), team, emails: [] };
    g.emails.push(email.toLowerCase());
    groups.set(key, g);
  }
  return { groups: [...groups.values()], skipped };
}

/** Plan B4.2c (call 5): time off is Away with a type; the names are renameable in Settings → Directory. */
export const TIME_OFF_TYPES = [
  { id: "vacation", name: "Vacation" }, { id: "sick", name: "Sick" }, { id: "ooo", name: "Out of office" }, { id: "other", name: "Other" },
] as const;
export type TimeOffType = (typeof TIME_OFF_TYPES)[number]["id"];
export const isTimeOffType = (v: unknown): v is TimeOffType => TIME_OFF_TYPES.some((t) => t.id === v);

/** The organization's names for the four types: a saved name (1–30 letters) wins over the default. */
export function timeOffNames(saved: unknown): Record<TimeOffType, string> {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  return Object.fromEntries(TIME_OFF_TYPES.map((t) => {
    const v = typeof s[t.id] === "string" ? (s[t.id] as string).trim().slice(0, 30) : "";
    return [t.id, v || t.name];
  })) as Record<TimeOffType, string>;
}

/** Layer 16: the type reaches the person, their line manager and admins; everyone else sees "Away". */
export const seesTimeOffType = (viewer: string, person: string, admin: boolean, reportsTo: ReportsTo) =>
  admin || viewer === person || reportsTo[person] === viewer;

const dayKey = (d: Date, zone: string | null) => new Intl.DateTimeFormat("en-CA", { timeZone: zone ?? undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Who's out (B4.2c): the next 14 days from today in the organization's zone, as YYYY-MM-DD keys. */
export function nextDays(now: Date, zone: string | null, n = 14): string[] {
  const base = Date.parse(`${dayKey(now, zone)}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

/** The span (day indexes) an Away covers within `days`, or null when it falls outside them. */
export function outSpan(fromIso: string, untilIso: string, days: string[], zone: string | null): { start: number; end: number } | null {
  const from = dayKey(new Date(fromIso), zone), until = dayKey(new Date(untilIso), zone);
  const start = days.findIndex((k) => k >= from);
  let end = -1;
  days.forEach((k, i) => { if (k <= until) end = i; });
  return start === -1 || end === -1 || end < start ? null : { start, end };
}
