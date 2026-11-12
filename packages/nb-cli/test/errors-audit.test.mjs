import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXES } from "../lib/error-fixes.mjs";
import { runCli } from "./helpers/run-cli.mjs";
import { startFakeServer } from "./helpers/fake-server.mjs";

// Report C5: every error ends with its next command and links to its entry on /docs/cli.
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function* sources(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(f);
    else if (f.endsWith(".mjs")) yield f;
  }
}

it("every error code nb raises is in the catalog, so it has a next step and a docs entry", () => {
  const missing = [];
  for (const file of [...sources(path.join(pkg, "lib")), path.join(pkg, "bin", "nb.mjs")]) {
    for (const [, code] of fs.readFileSync(file, "utf8").matchAll(/new CliError\("([A-Z_]+)"/g)) {
      if (!FIXES[code]) missing.push(`${path.relative(pkg, file)}: ${code}`);
    }
  }
  assert.deepEqual(missing, [], "add these to CLI_ONLY in src/lib/api/errors.ts, then npx tsx scripts/api/export-schemas.ts");
});

it("errors print their next step and docs link, and usage errors point at the command's help", async () => {
  const api = await startFakeServer();
  try {
    const usage = await runCli(["task", "move", "1"], { api: api.url });
    assert.match(usage.stderr, /See nb task move --help/);
    assert.match(usage.stderr, /docs\/cli#error-USAGE/);
    const notLinked = await runCli(["status", "--json"], { api: api.url });
    const body = JSON.parse(notLinked.stdout);
    assert.equal(body.error.code, "NOT_LINKED");
    assert.ok(body.error.hint, "a next step");
    assert.equal(body.error.docs, "https://networkbase.in/docs/cli#error-NOT_LINKED");
  } finally {
    api.close();
  }
});
