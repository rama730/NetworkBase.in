import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { BANNED_TERMS } from "../src/lib/copy/terms";

/**
 * Terminology contract (report §14). Scans the copy people can see in src/ and counts words and styles the report retired.
 * Counts are ratcheted per file in standards/terminology-baseline.json: a file may only go down. New files start at zero.
 * Also fails any new file path containing "project" (§14.3).
 */

export type Rule = "banned" | "org-word" | "project" | "ampersand" | "ellipsis" | "apostrophe" | "exclamation" | "successfully" | "please" | "log-in" | "british" | "title-case" | "annotation";
type Counts = Record<string, Partial<Record<Rule, number>>>;
export type Baseline = { strings: Counts; paths: string[] };

const BASELINE_FILE = "standards/terminology-baseline.json";
const PROPER_NAMES = /NetworkBase|Gmail|Outlook|Yahoo|GitHub|GitLab|Google|Microsoft|Apple|VS Code|Visual Studio|Supabase|Figma|Slack|Notion|Cursor|Windsurf|LinkedIn|Product Hunt|Hacker News|Stack Overflow|Creative Commons|Data Processing|End User|Open Source|Pro Bono|Terms of|Privacy Policy|Cookie Notice|Acceptable Use/;

const RULES: Array<[Rule, (text: string) => boolean]> = [
  ["banned", (t) => BANNED_TERMS.some((term) => term.pattern.test(t))],
  // The organization glossary's "never say" words (report §39.4, decisions 44, 108, 110). "Org" only on screen.
  ["org-word", (t) => /\bReturned for changes\b|\bGuests?\b|\bNeeds you\b|\bOrg\b|\bmaster assignments?\b|\bRole box(?:es)?\b/.test(t)],
  ["project", (t) => /\bprojects?\b/i.test(t.replace(/\b(?:external|side|open[- ]source) projects?\b/gi, ""))],
  ["ampersand", (t) => /\s&\s/.test(t)],
  ["ellipsis", (t) => t.includes("...")],
  ["apostrophe", (t) => /[A-Za-z]'[A-Za-z]/.test(t)],
  ["exclamation", (t) => /[A-Za-z)]!\s*$/.test(t)],
  ["successfully", (t) => /\bsuccessfully\b/i.test(t)],
  ["please", (t) => /\bplease\b/i.test(t)],
  ["log-in", (t) => /\blog ?in\b|\blog ?out\b/i.test(t)],
  ["british", (t) => /\b(?:licence|organis(?:e|ed|es|ing|ation|ations|ational)|recognis\w*|colour\w*|cancell(?:ed|ing)|behaviour|favour\w*)\b/i.test(t)],
  ["title-case", (t) => /^(?:[A-Z][a-z]+ ){1,5}[A-Z][a-z]+$/.test(t) && !PROPER_NAMES.test(t)],
  // A note from the report ("Connection request *(keep)*") that was applied as if it were wording.
  ["annotation", (t) => /\*?\(keep\)\*?/i.test(t)],
];

const SKIP_ATTRIBUTES = /^(className|id|href|key|data-|htmlFor|name|type|role|aria-controls|aria-labelledby|aria-describedby|src|rel|target|method|action|variant|size|as|accept|autoComplete|inputMode|pattern|form|value|defaultValue|lang|dir|style)/;
const SKIP_CALLS = /(logger|console|queryKey|metric|captureException|\.get$|\.has$|\.set$|^eq$|sql|revalidate|revalidatePath|revalidateTag|redirect|router\.|fetch|URL|RegExp|Error$|require|import|matchMedia|querySelector|getElementById|addEventListener|setAttribute|cookies\(\)|headers\(\)|z\.|\.parse|\.split|\.join|\.replace|\.includes|\.startsWith|\.endsWith|\.test|\.match)/;
const looksLikeCode = (s: string) => !/\s/.test(s) && (/[_/.@:#=<>{}()[\]]/.test(s) || /^[a-z][a-zA-Z0-9]*$/.test(s) || (/-/.test(s) && s === s.toLowerCase()));
const looksLikeSql = (s: string) => /^\s*(WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|DO |BEGIN)\b/.test(s) || / (FROM|JOIN|WHERE) [a-z_]/.test(s);

/** Every piece of visible copy in one source file. */
export function copyStrings(source: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const add = (raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text && /[A-Za-z]/.test(text) && !looksLikeCode(text) && !looksLikeSql(text)) out.push(text);
  };
  (function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isJsxText(node)) add(node.getText());
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if (ts.isPropertyAssignment(parent) && parent.name === node) return;
      if (ts.isElementAccessExpression(parent) || ts.isCaseClause(parent)) return;
      if (ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return;
      if (ts.isJsxAttribute(parent) && SKIP_ATTRIBUTES.test(parent.name.getText())) return;
      if (ts.isCallExpression(parent) && SKIP_CALLS.test(parent.expression.getText())) return;
      add(node.text);
    } else if (ts.isTemplateExpression(node)) {
      const parent = node.parent;
      if (ts.isCallExpression(parent) && SKIP_CALLS.test(parent.expression.getText())) return;
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      // URLs, ids and keys built from templates are code; copy has at least two words in one literal part.
      if (parts.some((part) => /[A-Za-z]{2,}\S*\s+[A-Za-z]{2,}/.test(part))) add(parts.join(" {} "));
      node.templateSpans.forEach((span) => visit(span.expression));
      return;
    } else if (ts.isTaggedTemplateExpression(node)) return;
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

export function ruleHits(text: string): Rule[] {
  return RULES.filter(([, test]) => test(text)).map(([rule]) => rule);
}

/**
 * Words the report keeps on purpose (§7.2, §12.5): proper names (skill catalog, platforms, products, a font),
 * stored values (interest tags, the "Quality Assurance" category, "Lead" seniority), search synonyms people type,
 * and external projects in contributions.
 */
const KEPT: Array<[RegExp, RegExp]> = [
  [/src\/lib\/skills\//, /./],
  [/src\/lib\/profile\/(?:domain-presence|normalization|interests)\.ts$/, /./],
  [/src\/lib\/profile\/role-preferences\.ts$/, /^(?:Lead|Quality Assurance|freelance projects|consulting projects)$/],
  [/src\/lib\/profile\/contribution-story\.ts$/, /^Enter the workspace or project name\.$/],
  // Document block syntax stored in Markdown (report 38.3): `{% project.decisions %}` is a saved format, not copy.
  [/src\/lib\/workspaces\/doc-live-blocks\.ts$/, /^\{% project\.[a-z_]+ %\}$/],
  [/src\/components\/layout\/header\/global-search\.ts$/, /\blog(?:in|out)\b/],
  // Report 38.5 T1: "Project" is a workflow item type, so Project planner and its Projects view keep the word.
  [/src\/(?:lib|components\/workspaces)\/workflows\//, /\b(?:Project planner|Projects view)\b|^Projects?$/],
  [/src\/components\/workspaces\/v2\/tasks\/PlannerParts\.tsx$/, /\bprojects?\b/i],
  [/src\/(?:app\/actions\/task|lib\/workspaces\/server\/tasks|components\/workspaces\/v2\/(?:TasksTab|tasks\/TaskStageControl))\.tsx?$/,
    /^(?:Projects|Name the project|Couldn’t make the project|Couldn’t load projects|The project is completed either way\.|Part of must be a project in this workspace|A project can’t be Part of another project)$/],
  [/./, /^(?:Apache Airflow|John Doe|Office Online|Excel Online|Android Studio|Samsung Internet|Claude Code|Instrument Sans)$/],
];

export function countFile(source: string, fileName: string) {
  const counts: Partial<Record<Rule, number>> = {};
  const file = fileName.split(path.sep).join("/");
  for (const text of copyStrings(source, fileName)) {
    if (KEPT.some(([where, what]) => where.test(file) && what.test(text))) continue;
    for (const rule of ruleHits(text)) counts[rule] = (counts[rule] ?? 0) + 1;
  }
  return counts;
}

function walk(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function scan(root: string): Baseline {
  const strings: Counts = {};
  for (const file of walk(path.join(root, "src"))) {
    if (!/\.tsx?$/.test(file) || /\.d\.ts$|\.(test|spec)\./.test(file)) continue;
    const rel = path.relative(root, file).split(path.sep).join("/");
    const counts = countFile(fs.readFileSync(file, "utf8"), file);
    if (Object.keys(counts).length) strings[rel] = counts;
  }
  const paths = ["src", "tests", "scripts"].flatMap((dir) => walk(path.join(root, dir)))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((rel) => /project/i.test(rel)).sort();
  return { strings, paths };
}

/** Compares a scan with the baseline: anything above it fails; `lowered` says the baseline can shrink. */
export function ratchet(current: Baseline, baseline: Baseline) {
  const failures: string[] = [];
  let lowered = false;
  for (const [file, counts] of Object.entries(current.strings)) {
    for (const [rule, n] of Object.entries(counts) as Array<[Rule, number]>) {
      const allowed = baseline.strings[file]?.[rule] ?? 0;
      if (n > allowed) failures.push(`${file}: ${n - allowed} new "${rule}" string(s)`);
    }
  }
  for (const [file, counts] of Object.entries(baseline.strings)) {
    for (const [rule, n] of Object.entries(counts) as Array<[Rule, number]>) if ((current.strings[file]?.[rule] ?? 0) < n) lowered = true;
  }
  const known = new Set(baseline.paths);
  for (const p of current.paths) if (!known.has(p)) failures.push(`${p}: new file name contains "project" (use "workspace")`);
  if (current.paths.length < baseline.paths.length) lowered = true;
  return { failures, lowered };
}

export function totals(scanResult: Baseline) {
  const sum: Partial<Record<Rule | "paths", number>> = { paths: scanResult.paths.length };
  for (const counts of Object.values(scanResult.strings)) for (const [rule, n] of Object.entries(counts) as Array<[Rule, number]>) sum[rule] = (sum[rule] ?? 0) + n;
  return sum;
}

function main() {
  const root = process.cwd();
  const file = path.join(root, BASELINE_FILE);
  const current = scan(root);
  if (process.argv.includes("--report")) console.log(JSON.stringify(totals(current), null, 2));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${JSON.stringify(current, null, 1)}\n`);
    return console.log("[terminology] first baseline written");
  }
  const baseline: Baseline = JSON.parse(fs.readFileSync(file, "utf8"));
  const { failures, lowered } = ratchet(current, baseline);
  if (failures.length) {
    console.error(`[terminology] ${failures.length} problem(s). Use the words in src/lib/copy/terms.ts (report §8–10):`);
    for (const failure of failures.slice(0, 200)) console.error(`  ${failure}`);
    process.exit(1);
  }
  if (process.argv.includes("--update-baseline")) {
    fs.writeFileSync(file, `${JSON.stringify(current, null, 1)}\n`);
    console.log(`[terminology] baseline ${lowered ? "lowered" : "written"}`);
  } else if (lowered) console.log("[terminology] ok; counts went down, run with --update-baseline to lock them in");
  else console.log("[terminology] ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
