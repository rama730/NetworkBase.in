// Runs every *.test.mjs under test/ with node:test. Node 20 can't expand globs in
// `node --test`, and Node 22 no longer accepts a folder, so the files are listed here.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(dir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => path.join(dir, f))
  .sort();

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
