// After a command (report A6.5): "What's new" on the first run of a new minor version, and once a day a check of
// npm for a newer release. stderr only; never with --json, in CI, when piped, or with NB_NO_UPDATE_CHECK.
import path from "node:path";

import { globalDir, readJson, writeAtomic } from "../config.mjs";

const DAY = 24 * 60 * 60 * 1000;

/** [major, minor, patch, isRelease]. @param {string} v */
const parts = (v) => {
  const [core = "", pre] = v.split("-");
  return [...core.split(".").map((n) => Number(n) || 0), pre ? 0 : 1];
};

/** True when a is a later version than b. @param {string} a @param {string} b */
export function newer(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** @param {import("../context.mjs").Context} ctx */
export async function afterCommand(ctx) {
  // 7 days before this computer's sign-in ends, once a day (C6); nb login renews the same sign-in.
  const ends = ctx.profile.profile?.source === "file" ? Date.parse(ctx.profile.profile.expiresAt ?? "") : NaN;
  if (ends > Date.now() && ends - Date.now() < 7 * DAY) {
    const { remindOnce } = await import("./remind.mjs");
    remindOnce(ctx, "sign-in-ends", `Your sign-in on this computer ends ${new Date(ends).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: nb login renews it`);
  }
  if (ctx.out.json || ctx.flags.quiet || ctx.env.CI || ctx.env.NB_NO_UPDATE_CHECK || !process.stderr.isTTY) return;
  const file = path.join(globalDir(ctx.env), "update.json");
  /** @type {{ lastRun?: string, checkedAt?: number, latest?: string }} */
  let seen = {};
  try { seen = readJson(file) ?? {}; } catch { seen = {}; }
  const { c } = ctx.out;

  const minor = (/** @type {string} */ v) => v.split(".").slice(0, 2).join(".");
  if (seen.lastRun && minor(seen.lastRun) !== minor(ctx.version)) {
    ctx.out.note(`${c.brand(ctx.out.sym.brand)} Updated to nb ${ctx.version}`);
    ctx.out.note(c.muted("  What changed: https://www.npmjs.com/package/@networkbase/cli?activeTab=readme · nb help"));
  }
  if (Date.now() - (seen.checkedAt ?? 0) > DAY) {
    try {
      const res = await fetch("https://registry.npmjs.org/@networkbase/cli/latest", { signal: AbortSignal.timeout(1500) });
      if (res.ok) seen.latest = String((/** @type {any} */ (await res.json())).version ?? "");
    } catch {
      // Offline or slow: try again tomorrow.
    }
    seen.checkedAt = Date.now();
  }
  if (seen.latest && newer(seen.latest, ctx.version)) ctx.out.note(c.muted(`nb ${seen.latest} is available (you have ${ctx.version}): npm i -g @networkbase/cli`));
  try { writeAtomic(file, JSON.stringify({ ...seen, lastRun: ctx.version })); } catch { /* read-only home: fine */ }
}
