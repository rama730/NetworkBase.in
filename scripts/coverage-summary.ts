import { readFileSync } from "node:fs";

// Node 22's coverage table crashes on a folder named `file` (files-tab/file/): it reads that folder as a
// file entry and calls split() on its missing path. test:unit:coverage therefore writes lcov instead,
// and this prints the totals and enforces the thresholds.
const THRESHOLDS = { lines: 70, functions: 60, branches: 60 };

const totals: Record<keyof typeof THRESHOLDS, [found: number, hit: number]> = { lines: [0, 0], functions: [0, 0], branches: [0, 0] };
const keys = { LF: ["lines", 0], LH: ["lines", 1], FNF: ["functions", 0], FNH: ["functions", 1], BRF: ["branches", 0], BRH: ["branches", 1] } as const;
for (const line of readFileSync("coverage/lcov.info", "utf8").split("\n")) {
  const [key, value] = line.split(":");
  const slot = keys[key as keyof typeof keys];
  if (slot) totals[slot[0]][slot[1]] += Number(value);
}

let failed = false;
for (const [name, [found, hit]] of Object.entries(totals) as [keyof typeof THRESHOLDS, [number, number]][]) {
  const percent = found ? (100 * hit) / found : 100;
  const ok = percent >= THRESHOLDS[name];
  failed ||= !ok;
  console.log(`[coverage] ${name} ${percent.toFixed(1)}% (minimum ${THRESHOLDS[name]}%)${ok ? "" : " FAILED"}`);
}
if (failed) process.exit(1);
