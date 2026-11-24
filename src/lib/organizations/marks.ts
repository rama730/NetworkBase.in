/**
 * Report 30.8 W7 (plan B1.5): marks and rubrics, pure. No weights, totals across assignments, averages or letter
 * grades (call 3): a mark belongs to one assignment ("21 / 30 · 70%").
 */
export type RubricLevel = { label: string; points: number; text: string };
export type RubricCriterion = { id: string; name: string; levels: RubricLevel[] };
export type Rubric = { id: string; name: string; criteria: RubricCriterion[]; archived?: boolean };
/** On the assignment master: Not marked, Out of N, or a rubric frozen when the assignment is saved (call 2). */
export type Marking = { mode: "none" } | { mode: "outof"; outOf: number } | { mode: "rubric"; rubric: Rubric };
export type MarkDraft = { levels?: Record<string, number>; total?: number; comment?: string | null };

export const DEFAULT_LEVELS: RubricLevel[] = [
  { label: "Excellent", points: 10, text: "" }, { label: "Good", points: 7, text: "" }, { label: "Fair", points: 4, text: "" }, { label: "Missing", points: 0, text: "" },
];

export const rubricOutOf = (r: Rubric) => r.criteria.reduce((n, c) => n + Math.max(0, ...c.levels.map((l) => l.points)), 0);

export function readMarking(settings: unknown): Marking {
  const m = (settings as { marking?: Record<string, unknown> } | null)?.marking;
  if (m?.mode === "outof" && typeof m.outOf === "number" && m.outOf > 0) return { mode: "outof", outOf: m.outOf };
  if (m?.mode === "rubric" && m.rubric && typeof m.rubric === "object") {
    const r = readRubric(m.rubric);
    if (r) return { mode: "rubric", rubric: r };
  }
  return { mode: "none" };
}

export function readRubric(raw: unknown): Rubric | null {
  const r = raw as Partial<Rubric> | null;
  if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !Array.isArray(r.criteria)) return null;
  const criteria = r.criteria.filter((c): c is RubricCriterion => Boolean(c) && typeof c.id === "string" && typeof c.name === "string" && Array.isArray(c.levels))
    .map((c) => ({ id: c.id, name: c.name.slice(0, 80), levels: c.levels.filter((l) => l && typeof l.label === "string" && typeof l.points === "number")
      .map((l) => ({ label: l.label.slice(0, 40), points: Math.max(0, Math.min(1000, l.points)), text: typeof l.text === "string" ? l.text.slice(0, 300) : "" })).slice(0, 6) }))
    .filter((c) => c.levels.length > 0).slice(0, 20);
  return criteria.length ? { id: r.id, name: r.name.slice(0, 80), criteria, ...(r.archived ? { archived: true } : {}) } : null;
}

export function readRubrics(orgSettings: unknown): Rubric[] {
  const list = (orgSettings as { rubrics?: unknown } | null)?.rubrics;
  return (Array.isArray(list) ? list : []).map(readRubric).filter((r): r is Rubric => r !== null).slice(0, 50);
}

/**
 * A mark from what was picked: a rubric totals its chosen levels (every criterion must be picked); Out of takes the
 * typed number (0..N). Null with a reason when it isn't complete yet.
 */
export function markTotal(marking: Marking, draft: MarkDraft): { total: number; outOf: number } | { error: string } {
  if (marking.mode === "none") return { error: "This assignment isn’t marked." };
  if (marking.mode === "outof") {
    const t = draft.total;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > marking.outOf) return { error: `Give a mark from 0 to ${marking.outOf}.` };
    return { total: Math.round(t * 100) / 100, outOf: marking.outOf };
  }
  let total = 0;
  for (const c of marking.rubric.criteria) {
    const i = draft.levels?.[c.id];
    if (typeof i !== "number" || !c.levels[i]) return { error: `Pick a level for ${c.name}.` };
    total += c.levels[i]!.points;
  }
  return { total, outOf: rubricOutOf(marking.rubric) };
}

/** "21 / 30 · 70%". */
export const markText = (total: number, outOf: number) => `${total} / ${outOf} · ${outOf > 0 ? Math.round((total / outOf) * 100) : 0}%`;
