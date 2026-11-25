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
