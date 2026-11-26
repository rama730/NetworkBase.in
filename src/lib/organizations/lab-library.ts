import { z } from "zod";

import type { Source } from "@/lib/workflows/literature";

// Report 35.4 (plan B6.4a, R3): a lab's Library — one source per paper for the whole lab, shared signed lab notes,
// each person's private reading state, and themes with a people-set Disagrees mark. Pure and client-safe.

export const NOTE_SECTIONS = { question: "Research question", method: "Method", findings: "Key findings", limitations: "Limitations" } as const;
export type NoteSection = keyof typeof NOTE_SECTIONS;
export const READING_STATES = { to_read: "To read", reading: "Reading", read: "Read" } as const;
export type ReadingState = keyof typeof READING_STATES;
/** Agreed change 4: a theme with fewer than 3 sources is Thin — a count, never a claim. */
export const THIN = 3;

export const sourceSchema = z.object({
  title: z.string().trim().min(1).max(500),
  authors: z.string().trim().max(1000).nullable(),
  year: z.number().int().min(1000).max(3000).nullable(),
  venue: z.string().trim().max(200).nullable(),
  link: z.string().trim().max(1000).refine((u) => !u || /^https?:\/\//i.test(u)).nullable(),
  doi: z.string().trim().max(200).nullable(),
}).strict();
export type LabSourceInput = z.infer<typeof sourceSchema>;

/** Themes with counts, Thin under 3, and how many sources are marked Disagrees; the lab's list order, then any others. */
export function themeRows(links: Array<{ theme: string; disagrees: boolean }>, themes: string[]) {
  const names = [...themes, ...[...new Set(links.map((l) => l.theme))].filter((t) => !themes.includes(t)).sort()];
  return names.map((theme) => {
    const mine = links.filter((l) => l.theme === theme);
    return { theme, count: mine.length, thin: mine.length < THIN, disagrees: mine.filter((l) => l.disagrees).length };
  });
}

/** Extracted (agreed change 2): Read, and this person wrote lab notes on it. */
export const readingWord = (state: ReadingState | null, wroteNotes: boolean) =>
  state === "read" && wroteNotes ? "Extracted" : state ? READING_STATES[state] : null;

/** RIS (call 9), read in the browser: TY … ER records; unknown tags are ignored. */
export function parseRis(text: string): { sources: Source[]; errors: string[] } {
  const sources: Source[] = [];
  const errors: string[] = [];
  let cur: Record<string, string[]> | null = null;
  const flush = (n: number) => {
    if (!cur) return;
    const one = (...tags: string[]) => tags.map((t) => cur![t]?.[0]).find(Boolean)?.trim() ?? "";
    const title = one("TI", "T1", "CT", "BT");
    if (!title) errors.push(`entry ${n}: no title`);
    else {
      const year = Number.parseInt(one("PY", "Y1", "DA").slice(0, 4), 10);
      const url = one("UR", "L1");
      const doi = one("DO").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
      sources.push({ title: title.slice(0, 500), authors: [...(cur.AU ?? []), ...(cur.A1 ?? [])].map((a) => a.trim()).filter(Boolean).join("; ").slice(0, 1000) || null,
        year: year >= 1000 && year <= 3000 ? year : null, link: /^https?:\/\//.test(url) ? url.slice(0, 1000) : null, doi: doi ? doi.slice(0, 200) : null,
        venue: one("JO", "JF", "T2", "J2").slice(0, 200) || null, keyIssues: (cur.KW ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 10), summary: null });
    }
    cur = null;
  };
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, value] = m as unknown as [string, string, string];
    if (tag === "TY") { flush(n); n += 1; cur = {}; continue; }
    if (tag === "ER") { flush(n); continue; }
    if (cur) (cur[tag] ??= []).push(value);
  }
  flush(n);
  return { sources, errors };
}
