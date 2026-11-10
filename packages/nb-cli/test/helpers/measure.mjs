// Timing helpers for budgets and benchmarks: medians of repeated CLI runs.
import { execFileSync } from "node:child_process";
import { PACKAGE_DIR, runCli } from "./run-cli.mjs";

/** @param {number[]} values */
export const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/**
 * Median wall time of `runs` executions; `prepare` runs before each one, untimed.
 * @param {number} runs
 * @param {(i: number) => Promise<() => Promise<unknown>>} prepare returns the timed action
 */
export async function medianMs(runs, prepare) {
  /** @type {number[]} */
  const times = [];
  for (let i = 0; i < runs; i++) {
    const action = await prepare(i);
    const start = performance.now();
    await action();
    times.push(performance.now() - start);
  }
  return Math.round(median(times) ?? 0);
}

/** @param {string[]} args @param {string} api @param {number} [runs] */
export const cliMs = (args, api, runs = 10) => medianMs(runs, async () => () => runCli(args, { api }));

/** Unpacked size of the published package, from `npm pack --dry-run`. */
export function unpackedBytes() {
  const out = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], { cwd: PACKAGE_DIR, encoding: "utf8", shell: process.platform === "win32" });
  // npm 11 prints a list; npm 12 an object keyed by package name.
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]).unpackedSize;
}
