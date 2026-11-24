/**
 * Report 30.6 W5 (plan B1.8a): the thesis workspace, pure. Chapters are documents in the Chapters section with a word
 * target and a status; words are counted from the Markdown, leaving out code, comments and the reference list (call).
 */
export const CHAPTER_STATUSES = ["not_started", "in_progress", "drafted", "completed"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];
export const CHAPTER_STATUS_WORDS: Record<ChapterStatus, string> = { not_started: "Not started", in_progress: "In progress", drafted: "Drafted", completed: "Completed" };
export const DEFAULT_CHAPTERS = ["Introduction", "Literature review", "Method", "Results", "Discussion", "Conclusion"] as const;
export const DEFAULT_CHAPTER_TARGET = 6000;

export type Chapter = { number: number; target: number; status: ChapterStatus };

export function readChapter(settings: unknown): Chapter | null {
  const c = (settings as { chapter?: Partial<Chapter> } | null)?.chapter;
  if (!c) return null;
  return {
    number: Number.isInteger(c.number) && c.number! > 0 && c.number! < 100 ? c.number! : 1,
    target: Number.isInteger(c.target) && c.target! >= 0 && c.target! <= 500_000 ? c.target! : DEFAULT_CHAPTER_TARGET,
    status: CHAPTER_STATUSES.includes(c.status as ChapterStatus) ? (c.status as ChapterStatus) : "not_started",
  };
}

const REFERENCE_HEADING = /^#{1,6}\s+(references|bibliography|works cited|reference list)\s*$/im;

/** Words in a chapter: prose only — no code blocks, inline code, HTML comments, link targets, Markdown marks or references. */
export function countWords(markdown: string): number {
  let text = markdown.replace(/\r\n/g, "\n");
  const refs = text.search(REFERENCE_HEADING);
  if (refs >= 0) text = text.slice(0, refs);
  text = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/{%[\s\S]*?%}/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~|#>]/g, " ");
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** "18,400 / 40,000"; a chapter over 110% of its target shows red (layer 6). */
export const overTarget = (words: number, target: number) => target > 0 && words > target * 1.1;
export function writingTotals(chapters: Array<{ words: number; target: number }>) {
  return { words: chapters.reduce((n, c) => n + c.words, 0), target: chapters.reduce((n, c) => n + c.target, 0) };
}

/** The starter Markdown for a chapter: its heading and a line to write over. */
export const chapterMarkdown = (number: number, title: string) => `# ${number}. ${title}\n\nStart writing here.\n`;

/** Thesis settings on the workspace (workflow_settings.thesis): research questions and the supervisor labels (call). */
export type ThesisSettings = { questions: string[]; supervisorId: string | null; coSupervisorId: string | null };
export function readThesisSettings(raw: unknown): ThesisSettings {
  const t = (raw as { thesis?: Partial<ThesisSettings> } | null)?.thesis ?? {};
  return {
    questions: Array.isArray(t.questions) ? t.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim().slice(0, 300)).slice(0, 8) : [],
    supervisorId: typeof t.supervisorId === "string" ? t.supervisorId : null,
    coSupervisorId: typeof t.coSupervisorId === "string" ? t.coSupervisorId : null,
  };
}
