import type { Slot } from "@/lib/organizations/school-timetable";

/**
 * Report 32.5 S4 calls 5–6 (plan B3.4b): cover, pure. An absence covers a whole day or a run of periods; the absent
 * teacher's slots in it are open cover slots. Suggestions: free that period → same department → fewest covers this
 * term. The manager picks; nothing is assigned on its own. Cover counts are never shown as a ranking.
 */
export type Absence = { userId: string; from: string | null; to: string | null };

/** The lesson periods an absence takes, in the day's order (null from/to = the whole day). */
export function absentPeriods(order: string[], a: Absence) {
  if (!a.from && !a.to) return order;
  const i = a.from ? order.indexOf(a.from) : 0, j = a.to ? order.indexOf(a.to) : order.length - 1;
  return i < 0 || j < 0 || j < i ? [] : order.slice(i, j + 1);
}

/** Open cover slots: the absent teachers' slots that day in the periods they're away. */
export function coverSlots(daySlots: Slot[], order: string[], absences: Absence[]) {
  return daySlots.filter((s) => s.teacherId && absences.some((a) => a.userId === s.teacherId && absentPeriods(order, a).includes(s.period)));
}

export type Candidate = { userId: string; name: string; department: string | null };
/**
 * Suggestions for one slot: people who are free that period (no lesson, not away, not already covering), then the
 * slot teacher's department first, then fewest covers this term; the reason in words.
 */
export function suggestions(slot: Slot, period: string, staff: Candidate[], busy: Set<string>, away: Set<string>, covering: Set<string>, coverCounts: Map<string, number>, deptOf: string | null, limit = 3) {
  return staff.filter((p) => p.userId !== slot.teacherId && !busy.has(p.userId) && !away.has(p.userId) && !covering.has(p.userId))
    .map((p) => ({ ...p, same: Boolean(deptOf && p.department === deptOf), covers: coverCounts.get(p.userId) ?? 0 }))
    .sort((a, b) => Number(b.same) - Number(a.same) || a.covers - b.covers || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((p) => ({ userId: p.userId, name: p.name, reason: ["free " + period, p.same ? "same department" : null, `${p.covers} ${p.covers === 1 ? "cover" : "covers"} this term`].filter(Boolean).join(", ") }));
}
