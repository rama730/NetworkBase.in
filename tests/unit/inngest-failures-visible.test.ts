import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A rejected event key went unnoticed for days because each caller swallowed the failure.
test("a refused email wake reaches Sentry through the shared send", () => {
  const source = readFileSync("src/lib/email/outbox.ts", "utf8");
  assert.match(source, /sendHint\(\{ name: "email\/outbox\.wake", data: \{\} \}\)/);
  assert.doesNotMatch(source, /email\.wake_failed/);
});

test("a lost urgent trust alert is an error, because nothing else alerts staff at once", () => {
  assert.match(readFileSync("src/lib/trust/cases.ts", "utf8"), /logger\.error\("trust\.urgent_alert_send_failed"/);
});

test("in production a refused import hydration fails the import instead of showing it as ready", () => {
  const source = readFileSync("src/lib/github/workspace-import-runner.ts", "utf8");
  assert.match(source, /process\.env\.NODE_ENV !== "production" && \(err\?\.message\?\.includes\('401'\)/);
});
