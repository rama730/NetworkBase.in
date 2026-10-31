import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

// Sentry hears about a caught error only through logger.error or console.error. logApiRoute logs at info, which
// production drops, so a route that relies on it alone fails silently.
test("every API route that returns a 500 logs the error", () => {
  const routes = execSync("grep -rlE 'status: 500|, 500\\)' src/app/api --include='*.ts'", { encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !file.startsWith("src/app/api/e2e/"));
  assert.ok(routes.length > 0);
  const silent = routes.filter((file) => !/\b(logger|console)\.error\(/.test(readFileSync(file, "utf8")));
  assert.deepEqual(silent, []);
});
