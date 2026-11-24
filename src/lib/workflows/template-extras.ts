/**
 * Report 38.15 calls 3–4 and 7 (A6.36): the interactive parts of some templates, worked out from the document's own
 * Markdown when it's shown, so the file stays the source and nothing is stored twice.
 */
import { DOC_TEMPLATES } from "@/lib/workflows/doc-templates";

export const EXTRA_TEMPLATES = ["assumptions-check", "business-model-canvas", "test-plan", "tech-spec", "prd"] as const;
export type ExtraTemplate = (typeof EXTRA_TEMPLATES)[number];

/** Which template a document came from: its `kind` (set when made), else its file name ("Tech spec – Sign-in.md"). */
export function templateOfDoc(doc: { kind?: string | null; filename: string }): string | null {
  if (doc.kind && DOC_TEMPLATES.some((t) => t.id === doc.kind)) return doc.kind;
  const name = doc.filename.replace(/\.md$/i, "");
  return DOC_TEMPLATES.find((t) => name === t.name || name.startsWith(`${t.name} – `))?.id ?? null;
}

const clean = (s: string) => s.replace(/\\\|/g, "|").replace(/[*_`]/g, "").trim();

/** The first Markdown table after `heading` (or in the whole text): its header and non-empty rows. */
export function parseTable(markdown: string, heading?: string): { header: string[]; rows: string[][] } {
  let text = markdown;
  if (heading) {
    const m = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").exec(markdown);
    if (!m) return { header: [], rows: [] };
    text = markdown.slice(m.index + m[0].length).split(/^##\s/m)[0] ?? "";
  }
  const lines = text.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l, i) => l.startsWith("|") && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""));
  if (start < 0) return { header: [], rows: [] };
  const cells = (l: string) => l.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(clean);
  const header = cells(lines[start]!);
  const rows: string[][] = [];
  for (const l of lines.slice(start + 2)) {
    if (!l.startsWith("|")) break;
    const row = cells(l);
    if (row.some(Boolean)) rows.push(header.map((_, i) => row[i] ?? ""));
  }
  return { header, rows };
}
const col = (header: string[], name: RegExp) => header.findIndex((h) => name.test(h));

/** Call 4: Pass · Fail · Blocked · Not run (anything else counts as Not run); the rate is passed of those run. */
export function testPlanSummary(markdown: string) {
  const { header, rows } = parseTable(markdown);
  const r = col(header, /^result$/i), c = col(header, /^case$/i), s = col(header, /^steps$/i), e = col(header, /^expected$/i);
  const counts = { pass: 0, fail: 0, blocked: 0, notRun: 0 };
  const failing: Array<{ case: string; steps: string; expected: string }> = [];
  for (const row of rows) {
    const v = (row[r] ?? "").toLowerCase();
    if (v === "pass") counts.pass++;
    else if (v === "fail") { counts.fail++; failing.push({ case: row[c] ?? "", steps: row[s] ?? "", expected: row[e] ?? "" }); }
    else if (v === "blocked") counts.blocked++;
    else counts.notRun++;
  }
  const run = counts.pass + counts.fail + counts.blocked;
  return { ...counts, total: rows.length, rate: run ? Math.round((counts.pass / run) * 100) : null, failing };
}

/** 11.8: each assumption with its test and status; rows others depend on are load-bearing. */
export function assumptionRows(markdown: string) {
  const { header, rows } = parseTable(markdown);
  const a = col(header, /^assumption$/i), d = col(header, /^depends on$/i), t = col(header, /^cheapest test$/i), st = col(header, /^status$/i);
  const list = rows.filter((row) => row[a]).map((row) => ({ assumption: row[a]!, dependsOn: row[d] ?? "", test: row[t] ?? "", status: row[st] || "Untested" }));
  const norm = (x: string) => x.toLowerCase().trim();
  return list.map((row) => ({
    ...row,
    broken: /^broken$/i.test(row.status),
    loadBearing: list.some((other) => other !== row && other.dependsOn.split(/[,;]/).map(norm).includes(norm(row.assumption))),
  }));
}

/** 20.2: Must requirements (Create roadmap items) and the user stories that aren't the placeholder (Make tasks). */
export function prdParts(markdown: string) {
  const { header, rows } = parseTable(markdown, "Requirements");
  const q = col(header, /^requirement$/i), p = col(header, /^priority/i);
  const must = rows.filter((row) => row[q] && /^must$/i.test(row[p] ?? "")).map((row) => row[q]!);
  const section = /^##\s+User stories\s*$/im.exec(markdown);
  const body = section ? (markdown.slice(section.index + section[0].length).split(/^##\s/m)[0] ?? "") : "";
  const stories = body.split("\n").map((l) => /^\s*[-*]\s+(.*)$/.exec(l)?.[1]?.trim() ?? "").filter((s) => s && !/^As a …/.test(s));
  return { must, stories };
}

/** Call 3: the canvas's nine boxes from its headings, in canvas order; a box the document lacks is empty. */
export const BMC_BOXES = ["Key partners", "Key activities", "Key resources", "Value propositions", "Customer relationships", "Channels", "Customer segments", "Cost structure", "Revenue streams"] as const;
export function bmcBoxes(markdown: string) {
  const parts = new Map<string, string>();
  for (const chunk of markdown.split(/^##\s+/m).slice(1)) {
    const [title = "", ...rest] = chunk.split("\n");
    parts.set(title.trim().toLowerCase(), rest.join("\n").trim());
  }
  return BMC_BOXES.map((title) => ({ title, body: parts.get(title.toLowerCase()) ?? "" }));
}

/** 13.4 / 20.2 Request review: In review until every review task is done, then Approved. */
export function reviewState(tasks: Array<{ done: boolean }>) {
  if (!tasks.length) return { state: "draft" as const, done: 0, total: 0 };
  const done = tasks.filter((t) => t.done).length;
  return { state: done === tasks.length ? ("approved" as const) : ("in_review" as const), done, total: tasks.length };
}
