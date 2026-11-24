/**
 * Report 31.3 C2 (plan B2.2a): a self-paced class's progress, pace, Stuck and drop-off, pure. A module is a path step;
 * its lessons are the steps a learner marks done. Never a score, streak, points or rank (call).
 */
type Module = { id: string; lessons: Array<{ id: string }> };
const DAY = 86_400_000;

/** "58%, 14 of 24 steps": every step done ÷ every step; nothing to do reads as 0%. */
export function pathPercent(modules: Module[], done: Set<string>) {
  const total = modules.reduce((n, m) => n + m.lessons.length, 0);
  const finished = modules.reduce((n, m) => n + m.lessons.filter((l) => done.has(l.id)).length, 0);
  return { done: finished, total, percent: total ? Math.round((finished / total) * 100) : 0 };
}

/**
 * Pace (call): with weeks per module, module i is due by start + (i + 1) × weeks; On pace when every module due by
 * today is finished. Nothing is locked or marked late by pace. Null when pace is off or the learner hasn't started.
 */
export function paceState(modules: Module[], done: Set<string>, start: Date | null, weeksPerModule: number | null, now = new Date()): "on" | "behind" | null {
  if (!weeksPerModule || !start) return null;
  const dueCount = Math.min(modules.length, Math.floor((now.getTime() - start.getTime()) / (weeksPerModule * 7 * DAY)));
  return modules.slice(0, dueCount).every((m) => m.lessons.every((l) => done.has(l.id))) ? "on" : "behind";
}

/** Stuck: no step done for `days` (counted from their last step, or their start), and not finished. */
export function stuckDays(lastDone: Date | null, start: Date | null, finished: boolean, days = 14, now = new Date()) {
  const since = lastDone ?? start;
  if (finished || !since) return null;
  const n = Math.floor((now.getTime() - since.getTime()) / DAY);
  return n >= days ? n : null;
}

/** The drop-off line (staff): how many learners reached each module (did a step in it or a later one); ⚠ on the biggest fall. */
export function dropOff(modules: Module[], learners: Array<Set<string>>) {
  const reached = modules.map((_, i) => learners.filter((done) => modules.slice(i).some((m) => m.lessons.some((l) => done.has(l.id)))).length);
  let worst = -1, fall = 0;
  for (let i = 1; i < reached.length; i++) {
    const drop = reached[i - 1]! - reached[i]!;
    if (drop > fall) { fall = drop; worst = i; }
  }
  return { reached, worst: fall > 0 ? worst : null, dropPercent: fall > 0 && reached[worst - 1] ? Math.round((fall / reached[worst - 1]!) * 100) : 0 };
}
