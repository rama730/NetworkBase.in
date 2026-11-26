/**
 * Report 30.6 W5 (plan B1.8b): the literature list, pure. BibTeX is read and written here, in the browser; nothing is
 * looked up from a DOI (14.3). Errors are reported per entry (layer 14).
 */
export type Source = { title: string; authors: string | null; year: number | null; link: string | null; doi: string | null; keyIssues: string[]; summary: string | null;
  /** B6.3c: the journal or proceedings, for a lab's past papers (the literature list ignores it). */
  venue?: string | null };

const clean = (v: string) => v.replace(/[{}]/g, "").replace(/\\&/g, "&").replace(/\s+/g, " ").trim();

/** Read @type{key, field = {value} | "value" | 123, …} entries. Unknown fields are ignored. */
export function parseBibtex(text: string): { sources: Source[]; errors: string[] } {
  const sources: Source[] = [];
  const errors: string[] = [];
  const starts = [...text.matchAll(/@(\w+)\s*\{/g)];
  starts.forEach((m, i) => {
    const kind = m[1]!.toLowerCase();
    if (kind === "comment" || kind === "string" || kind === "preamble") return;
    const body = text.slice(m.index! + m[0].length, i + 1 < starts.length ? starts[i + 1]!.index : text.length);
    const key = body.split(",")[0]!.trim() || `entry ${i + 1}`;
    const fields: Record<string, string> = {};
    for (const f of body.matchAll(/(\w+)\s*=\s*(\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g)) fields[f[1]!.toLowerCase()] = clean(f[3] ?? f[4] ?? f[5] ?? "");
    if (!fields.title) { errors.push(`${key}: no title`); return; }
    const year = fields.year ? Number.parseInt(fields.year, 10) : NaN;
    const doi = fields.doi ? fields.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : null;
    sources.push({
      title: fields.title.slice(0, 500), authors: fields.author ? fields.author.split(/\s+and\s+/i).map((a) => a.trim()).join("; ").slice(0, 1000) : null,
      year: year >= 1000 && year <= 3000 ? year : null, link: fields.url && /^https?:\/\//.test(fields.url) ? fields.url.slice(0, 1000) : null,
      doi: doi ? doi.slice(0, 200) : null, venue: (fields.journal || fields.booktitle || fields.publisher || "").slice(0, 200) || null, keyIssues: fields.keywords ? fields.keywords.split(/[;,]/).map((k) => k.trim()).filter(Boolean).slice(0, 10) : [], summary: null,
    });
  });
  return { sources, errors };
}

/** BibTeX for an export, one @article per source, keys like rao2020graph. */
export function toBibtex(sources: Array<Pick<Source, "title" | "authors" | "year" | "link" | "doi">>): string {
  const esc = (v: string) => v.replace(/[{}]/g, "");
  return sources.map((s, i) => {
    const first = (s.authors ?? "").split(";")[0]!.trim().split(/[\s,]+/).filter(Boolean);
    const key = `${(first[first.length - 1] ?? "source").toLowerCase().replace(/[^a-z]/g, "") || "source"}${s.year ?? ""}${(s.title.match(/[A-Za-z]{4,}/)?.[0] ?? "").toLowerCase()}` || `source${i + 1}`;
    const lines = [`  title = {${esc(s.title)}}`, s.authors ? `  author = {${esc(s.authors.split(";").map((a) => a.trim()).join(" and "))}}` : null,
      s.year ? `  year = {${s.year}}` : null, s.doi ? `  doi = {${esc(s.doi)}}` : null, s.link ? `  url = {${esc(s.link)}}` : null].filter(Boolean);
    return `@article{${key},\n${lines.join(",\n")}\n}`;
  }).join("\n\n");
}

/** Already in the list: the same DOI, or the same title ignoring case and punctuation. */
export const sourceKey = (s: Pick<Source, "title" | "doi">) => (s.doi ? `doi:${s.doi.toLowerCase()}` : `title:${s.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`);
