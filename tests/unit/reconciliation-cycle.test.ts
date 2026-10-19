import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres@localhost:1/none";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://t.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "a";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "s";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require("../../src/inngest/functions/project-files-reconciliation") as typeof import("../../src/inngest/functions/project-files-reconciliation");

// PERF-006: the full-pass delay is computed from the page size and cadence, and bounded by a stated limit.
test("estimates the hours one full pass takes", () => {
  assert.equal(mod.estimateReconciliationCycleHours(0), 0);
  assert.equal(mod.estimateReconciliationCycleHours(200), 1);
  assert.equal(mod.estimateReconciliationCycleHours(201), 2);
  assert.equal(mod.estimateReconciliationCycleHours(100_000), 500);
});

test("the stated limit is one week", () => {
  assert.equal(mod.RECONCILIATION_MAX_CYCLE_HOURS, 168);
  assert.ok(mod.estimateReconciliationCycleHours(33_600) <= mod.RECONCILIATION_MAX_CYCLE_HOURS);
  assert.ok(mod.estimateReconciliationCycleHours(33_601) > mod.RECONCILIATION_MAX_CYCLE_HOURS);
});
