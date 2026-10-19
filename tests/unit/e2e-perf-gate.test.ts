import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatePerf } from "../../scripts/check-e2e-perf-gate";

const REQUIRED = ["route.interactive.core", "route.server.ttfb", "route.hydration.ms", "project.detail.shell.interactive", "task.detail.panel.open"];
const full = (valueMs = 50) => REQUIRED.map((metric) => ({ metric, valueMs }));

// OPS-005: a missing metric is a coverage failure, not a silent pass; a slow one is a threshold failure.
test("a complete, fast run has no failures", () => {
  const result = evaluatePerf(full(), "critical");
  assert.deepEqual([result.coverageFailures, result.thresholdFailures], [[], []]);
});

test("missing required metrics are reported as coverage, separately from regressions", () => {
  const result = evaluatePerf(full().slice(0, 3), "critical");
  assert.equal(result.thresholdFailures.length, 0);
  assert.deepEqual(result.coverageFailures.map((line) => line.split(":")[0]), ["project.detail.shell.interactive", "task.detail.panel.open"]);
});

test("a slow metric is a threshold failure, not a coverage one", () => {
  const result = evaluatePerf(full(99_999), "critical");
  assert.equal(result.coverageFailures.length, 0);
  assert.ok(result.thresholdFailures.length >= 4);
});

test("non-finite or negative durations and unknown scopes are rejected", () => {
  assert.match(evaluatePerf([...full(), { metric: "route.server.ttfb", valueMs: Number.NaN }], "critical").coverageFailures.join(), /non-finite or negative/);
  assert.match(evaluatePerf([...full(), { metric: "route.server.ttfb", valueMs: -5 }], "critical").coverageFailures.join(), /non-finite or negative/);
  assert.match(evaluatePerf(full(), "smoke").coverageFailures.join(), /no coverage manifest/);
});
