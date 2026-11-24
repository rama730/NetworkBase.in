/**
 * Report 21.4 and 38.15 W5/W6 (A6.35): a snippet is a small document (settings kind "snippet") with a name, a language,
 * the code, what it's for, tags and a source link. The code is the document's first fenced block, so editing the file
 * in Files changes what Copy and `nb snippets get` give.
 */
export const SNIPPET_LANGUAGES = ["TypeScript", "JavaScript", "Python", "SQL", "Shell", "Go", "Rust", "Java", "Kotlin", "Swift", "C#", "C++", "Ruby", "PHP", "HTML", "CSS", "JSON", "YAML", "Markdown", "Other"] as const;
export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number];

/** The fence's info string: lower case, no spaces (c# → csharp, c++ → cpp). */
export function fenceLanguage(language: string) {
  const l = language.toLowerCase();
  return l === "c#" ? "csharp" : l === "c++" ? "cpp" : l === "other" ? "" : l.replace(/[^a-z0-9]/g, "");
}

/** A fence long enough that the code can't close it early. */
function fenceFor(code: string) {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(longest + 1);
}

export function snippetMarkdown(input: { name: string; language: string; code: string; purpose?: string; sourceUrl?: string }) {
  const fence = fenceFor(input.code);
  return [`# ${input.name}`, "", ...(input.purpose ? [input.purpose, ""] : []), `${fence}${fenceLanguage(input.language)}`, input.code.replace(/\n+$/, ""), fence,
    ...(input.sourceUrl ? ["", `Source: <${input.sourceUrl}>`] : []), ""].join("\n");
}

/** The first fenced block's code, or null when the document has none. */
export function snippetCode(markdown: string): string | null {
  const m = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?^\1[ \t]*$/m.exec(markdown);
  return m ? m[2]! : null;
}

/** Tags: lower case, trimmed, no duplicates, at most 8 of 30 characters. */
export function cleanTags(tags: string[]) {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter((t) => t && t.length <= 30))].slice(0, 8);
}

/** The Snippets view's search: name, purpose, language and tags, every word must match. */
export function matchesSnippet(s: { name: string; purpose?: string | null; language?: string; tags?: string[] }, query: string) {
  const hay = [s.name, s.purpose ?? "", s.language ?? "", ...(s.tags ?? [])].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
