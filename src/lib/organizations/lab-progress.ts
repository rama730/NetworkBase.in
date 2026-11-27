import type { MilestoneStep } from "@/lib/organizations/lab";

// Report 35.6 (plan B6.5b, R5 calls 3–4): milestones from a template and the supervision rhythm. Pure and client-safe.

export const MILESTONE_WORDS = { upcoming: "Upcoming", handed_in: "Handed in", done: "Done" } as const;
export type MilestoneState = keyof typeof MILESTONE_WORDS;

/** "2024-09-01" plus n months, kept on the month's last day when the day doesn't exist (Jan 31 + 1 → Feb 28/29). */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Call 4: a person's milestones from the template for their position, due from their start date; part-time doubles the
 * months. A repeating step (the annual review) repeats until the last one-off step, numbered "Annual review 1, 2, …".
 */
export function milestonePlan(steps: MilestoneStep[], startDate: string, partTime: boolean) {
  const scale = partTime ? 2 : 1;
  const lastOnce = Math.max(0, ...steps.filter((s) => !s.every).map((s) => s.month));
  const out: Array<{ key: string; name: string; dueOn: string }> = [];
  for (const s of steps) {
    if (!s.every) { out.push({ key: s.key, name: s.name, dueOn: addMonths(startDate, s.month * scale) }); continue; }
    for (let i = 0, m = s.month; m <= Math.max(lastOnce, s.month) && i < 10; i++, m += s.every) {
      out.push({ key: `${s.key}-${i + 1}`.slice(0, 40), name: `${s.name} ${i + 1}`, dueOn: addMonths(startDate, m * scale) });
    }
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

const DAY = 86_400_000;
/** The supervision rhythm: next due from the last meeting (or the start); "due" once it's a week past (layer 15). */
export function supervisionRhythm(lastMet: string | null, startDate: string, weeks: number, today: string) {
  const from = lastMet ?? startDate;
  const next = new Date(Date.parse(`${from}T00:00:00Z`) + weeks * 7 * DAY).toISOString().slice(0, 10);
  return { next, overdue: Date.parse(`${today}T00:00:00Z`) > Date.parse(`${next}T00:00:00Z`) + 7 * DAY };
}

/** Milestone notices (layer 15): 30 days and 7 days before, each once, while not done. */
export function milestoneNotices(m: { dueOn: string; state: MilestoneState; notice30At: string | null; notice7At: string | null }, today: string) {
  const left = (Date.parse(`${m.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY;
  return { d30: m.state !== "done" && !m.notice30At && left <= 30 && left > 7, d7: m.state !== "done" && !m.notice7At && left <= 7 && left >= 0 };
}
