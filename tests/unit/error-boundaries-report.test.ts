import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldReportBoundaryError } from "../../src/lib/observability/use-report-boundary-error";

test("an error with a digest came from the server, which already reported it", () => {
  assert.equal(shouldReportBoundaryError({ digest: "1234" }), false);
});

test("an error without a digest happened in the browser and is reported", () => {
  assert.equal(shouldReportBoundaryError({}), true);
});

test("a thrown non-Error value is reported, not a crash inside the error screen", () => {
  assert.equal(shouldReportBoundaryError(null), true);
  assert.equal(shouldReportBoundaryError(undefined), true);
});

test("every error screen reports what it catches", () => {
  const screens = execSync("find src/app -name 'error.tsx' -o -name 'global-error.tsx'", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  assert.ok(screens.includes("src/app/global-error.tsx"));
  const silent = screens.filter((file) => !readFileSync(file, "utf8").includes("useReportBoundaryError(error)"));
  assert.deepEqual(silent, []);
});
