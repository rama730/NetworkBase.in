/**
 * The "nothing remaining" ledger for docs/superpowers/plans/2026-11-11-cli-agents-next-round.md (report Part 0.9).
 *
 *   npx tsx scripts/plan/report-items.ts sync    add rows for new report items, mark rows whose item vanished
 *   npx tsx scripts/plan/report-items.ts check   fail on missing rows, finished rows without a test, or open rows in a closed milestone
 *   npx tsx scripts/plan/report-items.ts status  counts per milestone
 *
 * An item is a top-level bullet, numbered step or table row under a section (`## X1.`, `**X1.**`, `**0.8 …**`).
 * Its key is the section plus a short hash of its text, so adding items never renumbers others.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";

export const REPORT = "docs/superpowers/plans/2026-11-11-cli-agents-next-round.md";
export const LEDGER = "docs/superpowers/plans/2026-11-11-ledger.json";
const VIEW = "docs/superpowers/plans/2026-11-11-ledger.md";

export type Status = "todo" | "built" | "tested" | "live" | "n/a-live";
export type Kind = "build" | "fact" | "register" | "rule";
export type Row = { key: string; section: string; text: string; kind: Kind; milestone: string; status: Status; test: string; evidence: string; orphan?: boolean };
export type Ledger = { report: string; closedMilestones: string[]; rows: Row[] };
export type Item = { key: string; section: string; text: string; kind: Kind };

const normalize = (text: string) => text.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim();

/** Section ids that state what exists today rather than what to build. */
const FACT_SECTIONS = new Set(["A1", "G2", "H9"]);

export function extractItems(markdown: string): Item[] {
  const items: Item[] = [];
  let part = "";
  let section = "";
  let factBlock = false;
  let stop = false;
  for (const line of markdown.split("\n")) {
    if (stop) break;
    const partHead = line.match(/^# (Part ([0A-H])|Registers|Review log)\b/);
    if (partHead) {
      if (partHead[1] === "Review log") { stop = true; continue; }
      part = partHead[2] ?? "R";
      section = part === "R" ? "" : part;
      factBlock = false;
      continue;
    }
    const sub = line.match(/^## ([A-H]\d+b?)\./) ?? line.match(/^\*\*([A-HR]\d+b?|0\.\d)\.?\s/);
    if (sub) { section = sub[1]!; factBlock = false; continue; }
    // "What exists today", "Found by …", "Facts it builds on", "Why today isn't enough", "Asked" describe, not build.
    if (/^\*\*(What exists today|What's there today|Found by|Facts it builds on|Why today isn't enough|Asked|Today:)/.test(line)) { factBlock = true; continue; }
    if (/^\*\*[A-Z]/.test(line) && !/^\*\*(What|Found|Facts|Why|Asked|Today)/.test(line)) factBlock = false;
    if (!section || !part) continue;
    const bullet = line.match(/^(?:- |\d+\. )(.+)/);
    const row = /^\|/.test(line) && !/^\|\s*-/.test(line) ? line : null;
    let text: string | null = null;
    if (bullet) text = bullet[1]!;
    else if (row) {
      const cells = row.split("|").slice(1, -1).map((c) => c.trim());
      // Skip table header rows: the line after them is the |---| separator, so detect common header words.
      if (cells.every((c) => /^(#|Item|Milestone|Situation|What happens|Where|What it may do|How long|Column|Type|Rule|From|To|Who|Notes|Method and path|Scope|Body → answer|Errors|Action|Table|Key columns|Phase|Builds|Migration|Release|Risk|Handling|Layer|Covers|Step|Target|Area|Behaviour with branches|Word|Meaning|Failure|Result|Piece|Mechanism|Shape|Server change|Tool|Does|What|Limit|Limit or target|Choices|Default|Contents|Read access|Write access|Owners and admins|Agents|Person \(write access\)|Agent: Full help|Agent: Small changes|Agent: Read only|Covered by branches|Stays on main only \(with the reason\)|Routes|Part|Milestone|Report items|Migrations|Two-account live check|Item|Where handled|Situation|`conflict.kind`|Item|Undo does|Set|Features)?$/.test(c))) continue;
      text = cells.filter(Boolean).join(" · ");
    }
    if (!text) continue;
    const clean = normalize(text);
    if (clean.length < 3) continue;
    // Part 0's rules are ways of working, proven by the gates; its 0.8 polish rows are things to build.
    const kind: Kind = part === "R" ? "register" : part === "0" && section !== "0.8" ? "rule" : factBlock || FACT_SECTIONS.has(section) ? "fact" : "build";
    const key = `${section}.${createHash("sha256").update(`${section}|${clean}`).digest("hex").slice(0, 8)}`;
    items.push({ key, section, text: clean.slice(0, 160), kind });
  }
  return items;
}

/** Which milestone builds a section (report register R2 and the implementation plan). */
export function milestoneFor(section: string, text = ""): string {
  // Polish rows (0.8) name their milestone(s) in the last cell. A row spanning several closes with the last one;
  // "each milestone" rows are proven in the final audit (M9). Earlier milestones' phase plans carry their share.
  if (section === "0.8") return text.match(/\bM\d\b/g)?.at(-1) ?? "M9";
  if (/^0\./.test(section) || section === "0") return "M0";
  if (section === "F7") return "M1";
  if (section === "F4") return "M6";
  if (section === "G14" || section === "G18") return "M6";
  if (section === "E9") return "M9";
  const letter = section[0];
  return ({ A: "M1", B: "M2", E: "M3", C: "M4", D: "M4", G: "M5", H: "M8", F: "M7", R: "M0" } as Record<string, string>)[letter!] ?? "M0";
}

export function readLedger(): Ledger {
  return fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : { report: REPORT, closedMilestones: [], rows: [] };
}

export function sync(items: Item[], ledger: Ledger): Ledger {
  const byKey = new Map(ledger.rows.map((r) => [r.key, r]));
  const live = new Set(items.map((i) => i.key));
  const rows: Row[] = items.map((i) => {
    const existing = byKey.get(i.key);
    if (existing) return { ...existing, text: i.text, section: i.section, kind: existing.kind ?? i.kind, orphan: undefined };
    return { key: i.key, section: i.section, text: i.text, kind: i.kind, milestone: milestoneFor(i.section, i.text), status: i.kind === "build" ? "todo" : "n/a-live", test: "", evidence: "" };
  });
  // Rows whose item changed or vanished stay visible until their evidence is moved; rows with no evidence go.
  for (const r of ledger.rows) if (!live.has(r.key) && (r.test || r.evidence)) rows.push({ ...r, orphan: true });
  return { ...ledger, rows };
}

const ORDER: Status[] = ["todo", "built", "tested", "live"];

export function check(items: Item[], ledger: Ledger): string[] {
  const problems: string[] = [];
  const rows = new Map(ledger.rows.map((r) => [r.key, r]));
  for (const i of items) if (!rows.has(i.key)) problems.push(`no ledger row for ${i.key}: ${i.text.slice(0, 70)}`);
  for (const r of ledger.rows) {
    if (r.orphan) problems.push(`orphan row ${r.key} (its report text changed or was removed): move its evidence, then delete it`);
    if (r.kind !== "build") continue;
    if (r.status !== "todo" && !r.test) problems.push(`${r.key} is ${r.status} but names no test`);
    if (ledger.closedMilestones.includes(r.milestone) && ORDER.indexOf(r.status as Status) < ORDER.indexOf("tested") && r.status !== "n/a-live") {
      problems.push(`${r.key} is still ${r.status} in closed milestone ${r.milestone}`);
    }
  }
  return problems;
}

export function status(ledger: Ledger) {
  const by = new Map<string, Record<string, number>>();
  for (const r of ledger.rows) {
    if (r.kind !== "build" || r.orphan) continue;
    const m = by.get(r.milestone) ?? {};
    m[r.status] = (m[r.status] ?? 0) + 1;
    by.set(r.milestone, m);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([milestone, counts]) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const done = (counts.tested ?? 0) + (counts.live ?? 0) + (counts["n/a-live"] ?? 0);
    return { milestone, total, remaining: total - done, ...counts };
  });
}

function writeView(ledger: Ledger) {
  const lines = [
    "# Ledger: CLI and agents, next round",
    "",
    `Generated from \`${LEDGER}\` by \`scripts/plan/report-items.ts\`. Edit the JSON, not this file.`,
    "",
    "| Milestone | Items | Remaining |",
    "|---|---|---|",
    ...status(ledger).map((s) => `| ${s.milestone} | ${s.total} | ${s.remaining} |`),
    "",
    "| Key | Milestone | Status | Test | Item |",
    "|---|---|---|---|---|",
    ...ledger.rows.filter((r) => r.kind === "build").map((r) => `| ${r.key}${r.orphan ? " (orphan)" : ""} | ${r.milestone} | ${r.status} | ${r.test ? `\`${r.test}\`` : ""} | ${r.text.replace(/\|/g, "\\|")} |`),
    "",
  ];
  fs.writeFileSync(VIEW, lines.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "status";
  const items = extractItems(fs.readFileSync(REPORT, "utf8"));
  const ledger = readLedger();
  if (command === "sync") {
    const next = sync(items, ledger);
    fs.writeFileSync(LEDGER, `${JSON.stringify(next, null, 2)}\n`);
    writeView(next);
    console.log(`[plan-ledger] ${items.length} report items, ${next.rows.filter((r) => r.orphan).length} orphan rows`);
  } else if (command === "check") {
    const problems = check(items, ledger);
    if (problems.length) {
      console.error(`[plan-ledger] ${problems.length} problem(s):`);
      for (const p of problems.slice(0, 50)) console.error(` - ${p}`);
      process.exit(1);
    }
    console.log(`[plan-ledger] ok (${items.length} items)`);
  } else {
    for (const s of status(ledger)) console.log(`${s.milestone.padEnd(4)} ${String(s.total).padStart(4)} items · remaining ${s.remaining}`);
  }
}
