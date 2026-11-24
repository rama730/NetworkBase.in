/**
 * Report 30.9 W8 (plan B1.3): sections in a class. Pure rules: Split students, seats left, the review-load warning
 * and the section settings.
 */
export type SplitMethod = "even" | "random" | "surname";
export type SplitStudent = { id: string; name: string };
export type SplitSection = { id: string; name: string; seatLimit: number | null };

/** A deterministic shuffle (the preview and Apply give the same answer for the same seed). */
function seeded(list: SplitStudent[], seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1_000_000) / 1_000_000; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const surname = (name: string) => (name.trim().split(/\s+/).at(-1) ?? name).toLowerCase();

/**
 * Split students… : evenly in name order, randomly, or by surname range (contiguous blocks). Sizes differ by at most
 * one and never pass a seat limit; anyone who doesn't fit stays unplaced.
 */
export function splitStudents(students: SplitStudent[], sections: SplitSection[], method: SplitMethod, seed = "split"): { placed: Array<{ userId: string; sectionId: string }>; unplaced: string[] } {
  if (!sections.length) return { placed: [], unplaced: students.map((s) => s.id) };
  const ordered = method === "random" ? seeded([...students].sort((a, b) => a.id.localeCompare(b.id)), seed)
    : [...students].sort((a, b) => (method === "surname" ? surname(a.name).localeCompare(surname(b.name)) : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const base = Math.floor(ordered.length / sections.length);
  const extra = ordered.length % sections.length;
  const sizes = sections.map((s, i) => Math.min(base + (i < extra ? 1 : 0), s.seatLimit ?? Number.MAX_SAFE_INTEGER));
  const placed: Array<{ userId: string; sectionId: string }> = [];
  let k = 0;
  sections.forEach((s, i) => { for (let n = 0; n < sizes[i]!; n++) placed.push({ userId: ordered[k++]!.id, sectionId: s.id }); });
  return { placed, unplaced: ordered.slice(k).map((s) => s.id) };
}

export const seatsLeft = (limit: number | null, students: number) => (limit == null ? null : Math.max(0, limit - students));

/** Call 9: a TA's review load is flagged above 1.5× the average across TAs. */
export function reviewLoadWarnings(load: Array<{ userId: string; toReview: number }>) {
  if (load.length < 2) return new Set<string>();
  const avg = load.reduce((n, l) => n + l.toReview, 0) / load.length;
  return new Set(load.filter((l) => avg > 0 && l.toReview > 1.5 * avg).map((l) => l.userId));
}

export type SectionSettings = { word: "Section" | "Batch" | "Lab group" | "Tutorial"; taOnlyOwn: boolean; selfPick: boolean };
export const SECTION_WORDS = ["Section", "Batch", "Lab group", "Tutorial"] as const;
export function readSectionSettings(orgSettings: unknown): SectionSettings {
  const raw = ((orgSettings as { sections?: Record<string, unknown> } | null)?.sections ?? {}) as Record<string, unknown>;
  return {
    word: SECTION_WORDS.includes(raw.word as SectionSettings["word"]) ? raw.word as SectionSettings["word"] : "Section",
    taOnlyOwn: raw.taOnlyOwn !== false,
    selfPick: raw.selfPick === true,
  };
}
