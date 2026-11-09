// Undo tokens the server returned for this machine's changes, newest last (report A2.9). Kept 24 hours, like the
// server keeps them; `nb undo` uses the newest unless told which.
import path from "node:path";

import { globalDir, readJson, writeAtomic } from "./config.mjs";

const DAY = 24 * 60 * 60 * 1000;

/** @typedef {{ token: string, at: number, method: string, path: string, origin: string, session?: string | null }} UndoEntry */

/** @param {NodeJS.ProcessEnv} env */
const file = (env) => path.join(globalDir(env), "undo.json");

/** @param {NodeJS.ProcessEnv} env @param {string} origin @returns {UndoEntry[]} */
export function readUndoLog(env, origin) {
  let entries = [];
  try { entries = readJson(file(env))?.entries ?? []; } catch { entries = []; }
  return entries.filter((/** @type {UndoEntry} */ e) => e.origin === origin && Date.now() - e.at < DAY);
}

/** @param {NodeJS.ProcessEnv} env @param {UndoEntry} entry */
export function appendUndo(env, entry) {
  let entries = [];
  try { entries = readJson(file(env))?.entries ?? []; } catch { entries = []; }
  const kept = entries.filter((/** @type {UndoEntry} */ e) => Date.now() - e.at < DAY).slice(-49);
  try { writeAtomic(file(env), JSON.stringify({ entries: [...kept, entry] })); } catch { /* read-only home: undo by token still works */ }
}

/** @param {NodeJS.ProcessEnv} env @param {string} token */
export function dropUndo(env, token) {
  let entries = [];
  try { entries = readJson(file(env))?.entries ?? []; } catch { return; }
  try { writeAtomic(file(env), JSON.stringify({ entries: entries.filter((/** @type {UndoEntry} */ e) => e.token !== token) })); } catch { /* fine */ }
}
