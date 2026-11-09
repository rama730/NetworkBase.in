// Text snapshots for rendered CLI screens. UPDATE_SNAPSHOTS=1 rewrites them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "__snapshots__");

/** @param {string} name @param {string} text */
export function matchSnapshot(name, text) {
  const file = path.join(dir, `${name}.txt`);
  const normalized = text.replace(/[ \t]+$/gm, "").trimEnd() + "\n";
  if (process.env.UPDATE_SNAPSHOTS === "1" || !fs.existsSync(file)) {
    if (!fs.existsSync(file) && process.env.CI) assert.fail(`Missing snapshot ${name}; run with UPDATE_SNAPSHOTS=1 locally`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, normalized);
    return;
  }
  assert.equal(normalized, fs.readFileSync(file, "utf8"), `snapshot ${name} changed; run with UPDATE_SNAPSHOTS=1 if intended`);
}
