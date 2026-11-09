// Notes shown at most once a day per key (old command names, update notices), on stderr only (report §26.7).
import path from "node:path";

import { globalDir, readJson, writeAtomic } from "../config.mjs";

const DAY = 24 * 60 * 60 * 1000;

/** @param {import("../context.mjs").Context} ctx @param {string} key @param {string} text */
export function remindOnce(ctx, key, text) {
  if (ctx.out.json || ctx.flags.quiet) return;
  const file = path.join(globalDir(ctx.env), "reminders.json");
  let seen = /** @type {Record<string, number>} */ ({});
  try {
    seen = readJson(file) ?? {};
  } catch {
    seen = {};
  }
  if (Date.now() - (seen[key] ?? 0) < DAY) return;
  ctx.out.note(ctx.out.c.muted(text));
  try {
    writeAtomic(file, JSON.stringify({ ...seen, [key]: Date.now() }));
  } catch {
    // A read-only home folder only means the note shows again tomorrow.
  }
}
