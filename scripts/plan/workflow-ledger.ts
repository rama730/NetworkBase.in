/**
 * The ledger for the workflow tabs build (docs/superpowers/plans/2026-11-18-workflow-tabs-implementation.md).
 *
 *   npx tsx scripts/plan/workflow-ledger.ts sync    add rows for new units, journeys and calls; mark rows that vanished
 *   npx tsx scripts/plan/workflow-ledger.ts check   fail on missing rows, finished rows without a test, parked rows without a reason
 *   npx tsx scripts/plan/workflow-ledger.ts status  counts per milestone
 *
 * Rows: one per plan unit (A0.1 … B8.10), one per walkthrough in report section 38 (`38.2.W4`) and one per agreed call
 * in sections 30–38 (`38.2.call4`, `30.3.call2`), so a skipped journey or call shows up as an open row.
 */
import fs from "node:fs";

export const PLAN = "docs/superpowers/plans/2026-11-18-workflow-tabs-implementation.md";
export const REPORT = "docs/superpowers/plans/2026-11-16-workflow-tabs-report.md";
export const LEDGER = "docs/superpowers/plans/2026-11-18-workflow-tabs-ledger.json";

export type Status = "todo" | "built" | "tested" | "live" | "live-pending" | "n/a-live";
export type Kind = "unit" | "journey" | "call";
export type Row = { key: string; section: string; text: string; kind: Kind; milestone: string; status: Status; test: string; evidence: string; orphan?: boolean };
export type Item = Pick<Row, "key" | "section" | "text" | "kind" | "milestone">;

const clean = (text: string) => text.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);

/** Report section → the plan wave its journeys and calls belong to. */
export function milestoneOf(section: string): string {
  const [major, minor] = section.split(".").map(Number);
  if (major === 38) {
    if (minor! <= 4) return "A0";
    if (minor === 5) return "A1";
    if (minor! <= 9) return "A2";
    if (minor === 10) return "A3";
    if (minor === 11) return "A4";
    if (minor! <= 14) return "A5";
    if (minor === 15) return "A6";
    return "A7";
  }
  return `B${major! - 29}`;
}

/** Units are the plan's bold ids (`**A0.1 …**`) and table rows (`| A3.2 |`); `B8.5–B8.10` expands to six. */
export function extractUnits(plan: string): Item[] {
  const seen = new Map<string, Item>();
  for (const line of plan.split("\n")) {
    const range = line.match(/\*\*([AB]\d+)\.(\d+)–\1\.(\d+)\b/);
    if (range) for (let n = Number(range[2]); n <= Number(range[3]); n++) seen.set(`${range[1]}.${n}`, { key: `${range[1]}.${n}`, section: "plan", text: clean(line), kind: "unit", milestone: range[1]! });
    for (const m of line.matchAll(/\*\*([AB]\d+)\.(\d+)\b/g)) {
      const key = `${m[1]}.${m[2]}`;
      if (!seen.has(key)) seen.set(key, { key, section: "plan", text: clean(line), kind: "unit", milestone: m[1]! });
    }
    const row = line.match(/^\| ([AB]\d+)\.(\d+) \|(.*)$/);
    if (row && !seen.has(`${row[1]}.${row[2]}`)) seen.set(`${row[1]}.${row[2]}`, { key: `${row[1]}.${row[2]}`, section: "plan", text: clean(row[3]!.replace(/\|/g, "·")), kind: "unit", milestone: row[1]! });
  }
  return [...seen.values()];
}

/** Walkthroughs (`**W4 · …`) in 38.x, and numbered calls under a "Calls" heading in 30.x–38.x. */
export function extractReportItems(report: string): Item[] {
  const items: Item[] = [];
  let section = "";
  let inCalls = false;
  for (const line of report.split("\n")) {
    const head = line.match(/^### (3[0-8]\.\d+) /);
    if (head) { section = head[1]!; inCalls = false; continue; }
    if (/^#{1,3} /.test(line) && !/^### 3[0-8]\./.test(line)) { if (/^#{1,2} /.test(line)) section = ""; inCalls = false; }
    if (!section) continue;
    if (/^(#### 11\. Calls|\*\*Calls agreed)/.test(line)) { inCalls = true; continue; }
    if (inCalls && /^(\*\*Next|\*\*Build calls|#### |---)/.test(line)) inCalls = false;
    const call = inCalls ? line.match(/^(\d+)\. (.+)/) : null;
    if (call) { items.push({ key: `${section}.call${call[1]}`, section, text: clean(call[2]!), kind: "call", milestone: milestoneOf(section) }); continue; }
    const walk = section.startsWith("38.") ? line.match(/^\*\*W(\d+) · ([^*]+)\*\*/) : null;
    if (walk) items.push({ key: `${section}.W${walk[1]}`, section, text: clean(walk[2]!), kind: "journey", milestone: milestoneOf(section) });
  }
  return items;
}

export function sync(rows: Row[], items: Item[]): Row[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const keys = new Set(items.map((i) => i.key));
  const out: Row[] = rows.map((r) => (keys.has(r.key) ? { ...r, orphan: undefined } : { ...r, orphan: true }));
  for (const item of items) if (!byKey.has(item.key)) out.push({ ...item, status: "todo", test: "", evidence: "" });
  return out;
}

export function problems(rows: Row[], items: Item[]): string[] {
  const have = new Set(rows.map((r) => r.key));
  const out = items.filter((i) => !have.has(i.key)).map((i) => `missing row ${i.key}`);
  for (const r of rows) {
    if (r.orphan) out.push(`row ${r.key} no longer in the plan or report`);
    if (["built", "tested", "live", "live-pending"].includes(r.status) && !r.test.trim()) out.push(`row ${r.key} is ${r.status} without a test`);
    if (r.status === "n/a-live" && !r.evidence.trim()) out.push(`row ${r.key} is n/a-live without a reason`);
    if (r.status === "live-pending" && !/revisit \d{4}-\d{2}-\d{2}/.test(r.evidence)) out.push(`row ${r.key} is live-pending without "revisit YYYY-MM-DD"`);
  }
  return out;
}

function main() {
  const [command] = process.argv.slice(2);
  const items = [...extractUnits(fs.readFileSync(PLAN, "utf8")), ...extractReportItems(fs.readFileSync(REPORT, "utf8"))];
  const rows: Row[] = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")).rows : [];
  if (command === "sync") {
    const next = sync(rows, items);
    fs.writeFileSync(LEDGER, `${JSON.stringify({ plan: PLAN, report: REPORT, rows: next }, null, 2)}\n`);
    console.log(`${next.length} rows (${next.length - rows.length} new)`);
  } else if (command === "check") {
    const found = problems(rows, items);
    for (const p of found) console.error(p);
    if (found.length) process.exit(1);
    console.log(`workflow ledger ok: ${rows.length} rows`);
  } else if (command === "status") {
    const by = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const m = by.get(r.milestone) ?? {};
      m[r.status] = (m[r.status] ?? 0) + 1;
      by.set(r.milestone, m);
    }
    for (const [m, counts] of [...by].sort()) console.log(m.padEnd(4), Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(" · "));
  } else {
    console.error("usage: workflow-ledger.ts sync | check | status");
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("workflow-ledger.ts")) main();
