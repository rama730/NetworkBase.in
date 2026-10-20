import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres@localhost:1/none";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://t.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "a";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "s";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { drainRetention } = require("../../src/inngest/functions/data-lifecycle-retention") as typeof import("../../src/inngest/functions/data-lifecycle-retention");

type Counts = Awaited<Parameters<typeof drainRetention>[0] extends (round: number) => Promise<infer C> ? C : never>;
const counts = (partial: Partial<Counts>): Counts => ({
  profile_read_audits: 0, profile_activity_audits: 0, onboarding_events: 0,
  onboarding_drafts: 0, extension_session_events: 0, legal_acceptances: 0, account_deletion_records_anonymized: 0, ...partial,
});
const limits = { maxRounds: 5, batchSize: 10 };

// PERF-006: keep going while a category fills its batch; stop when drained or at the round cap.
test("drains until a round leaves every category under a full batch", async () => {
  const script = [counts({ onboarding_events: 10 }), counts({ onboarding_events: 10, legal_acceptances: 3 }), counts({ onboarding_events: 4 })];
  let round = 0;
  const result = await drainRetention(async () => script[round++]!, limits);
  assert.equal(result.rounds, 3);
  assert.equal(result.onboarding_events, 24);
  assert.equal(result.legal_acceptances, 3);
  assert.equal(result.backlog, false);
});

test("stops at the round cap and reports a backlog", async () => {
  const result = await drainRetention(async () => counts({ profile_read_audits: 10 }), limits);
  assert.equal(result.rounds, 5);
  assert.equal(result.profile_read_audits, 50);
  assert.equal(result.backlog, true);
});

test("an empty first round is one round and no backlog", async () => {
  const result = await drainRetention(async () => counts({}), limits);
  assert.deepEqual([result.rounds, result.backlog], [1, false]);
});
