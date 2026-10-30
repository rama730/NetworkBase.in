import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// The live console (Trust & Safety Console Redesign S1–S12): versions refuse stale writes, claims are leases that
// lapse, the log is a cursor, assign and escalate, decide together sends one notice, skipping a step needs a note.

moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let cases: typeof import("../../src/lib/trust/cases");
let decide: typeof import("../../src/lib/trust/decide");
let inbox: typeof import("../../src/lib/trust/inbox");
before(async () => {
  cases = await loadAppModule(() => import("../../src/lib/trust/cases"));
  decide = await loadAppModule(() => import("../../src/lib/trust/decide"));
  inbox = await loadAppModule(() => import("../../src/lib/trust/inbox"));
});
const made: string[] = [];
after(async () => {
  await sql`DELETE FROM user_notifications WHERE kind = 'trust_safety'`;
  if (made.length) await sql`DELETE FROM workspaces WHERE id IN ${sql(made)}`;
  await sql.end();
  await closeAppDb();
});

const staff = (id: string) => ({ id, scope: "staff" as const, role: "moderator" as const });

async function reported(author?: string) {
  const [a, reporter, mod, other] = await sql.begin(async (tx) => [author ?? await createUser(tx), await createUser(tx), await createUser(tx), await createUser(tx)]);
  const workspace = await sql.begin((tx) => createProject(tx, a!));
  made.push(workspace);
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${a}, 'buy now') RETURNING id`;
  assert.equal((await cases.fileReport(reporter!, { kind: "update", targetId: row!.id, reason: "spam" })).ok, true);
  const [c] = await sql`SELECT id, version FROM moderation_cases WHERE target_id = ${row!.id}`;
  return { author: a!, mod: mod!, other: other!, caseId: c!.id as string, version: c!.version as number };
}

test("only a real change bumps the version, never a claim, release or renewal; a stale decision is refused and logged", async () => {
  const t = await reported();
  assert.equal((await inbox.claimLease(t.caseId, t.other, "claim")).ok, true);
  assert.equal(await inbox.releaseLease(t.caseId, t.other), true);
  assert.equal((await inbox.claimLease(t.caseId, t.mod, "claim", t.version)).ok, true, "someone else's claim and release don't make my view stale");
  const [{ version: v1 }] = await sql`SELECT version FROM moderation_cases WHERE id = ${t.caseId}`;
  assert.equal(v1, t.version);
  await sql`UPDATE moderation_cases SET severity = 'urgent' WHERE id = ${t.caseId}`;
  const [{ version: v2 }] = await sql`SELECT version FROM moderation_cases WHERE id = ${t.caseId}`;
  assert.equal(v2, v1 + 1);
  await sql`UPDATE moderation_cases SET severity = 'high' WHERE id = ${t.caseId}`;
  const [{ version: vNow }] = await sql`SELECT version FROM moderation_cases WHERE id = ${t.caseId}`;
  assert.equal(await inbox.renewLease(t.caseId, t.mod, true), true);
  assert.equal((await sql`SELECT version FROM moderation_cases WHERE id = ${t.caseId}`)[0]!.version, vNow);
  const stale = await decide.decideCase(t.caseId, staff(t.mod), { outcome: "no_violation", expectedVersion: v1 });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.code, "stale");
  assert.equal((await sql`SELECT count(*)::int AS n FROM moderation_events WHERE case_id = ${t.caseId} AND kind = 'stale_refused'`)[0]!.n, 1);
  assert.equal((await decide.decideCase(t.caseId, staff(t.mod), { outcome: "no_violation", expectedVersion: vNow })).ok, true);
});

test("a claim blocks others only while it's live; a closed tab frees it within 2 minutes", async () => {
  const t = await reported();
  assert.equal((await inbox.claimLease(t.caseId, t.mod, "claim")).ok, true);
  assert.equal((await inbox.claimLease(t.caseId, t.other, "claim")).ok, false);
  assert.equal((await decide.decideCase(t.caseId, staff(t.other), { outcome: "no_violation" })).ok, false);
  await sql`UPDATE moderation_cases SET claim_seen_at = now() - interval '3 minutes' WHERE id = ${t.caseId}`;
  const [{ number }] = await sql`SELECT number::int AS number FROM moderation_cases WHERE id = ${t.caseId}`;
  const [row] = (await inbox.readInbox(t.other, { view: "unclaimed", q: `NB-${number}` }, null)).items.filter((i) => i.id === t.caseId);
  assert.ok(row, "a lapsed claim shows as unclaimed");
  assert.equal(row!.claimer_id, null);
  assert.equal((await inbox.claimLease(t.caseId, t.other, "claim")).ok, true);
  assert.equal(await inbox.renewLease(t.caseId, t.mod, true), false, "the old holder's heartbeat no longer holds it");
  assert.equal((await inbox.releaseLease(t.caseId, t.other)), true);
});

test("the log is a cursor: everything after a seq, in order", async () => {
  const start = await inbox.latestSeq();
  const t = await reported();
  await inbox.claimLease(t.caseId, t.mod, "claim");
  await inbox.releaseLease(t.caseId, t.mod);
  const { events } = await inbox.eventsSince(start);
  const mine = events.filter((e) => e.case_id === t.caseId).map((e) => e.kind);
  assert.deepEqual(mine.slice(-2), ["claimed", "released"]);
  assert.ok(events.every((e, i) => i === 0 || e.seq > events[i - 1]!.seq));
});

test("assign puts it in their Mine view; escalate marks it for an admin; deciding clears both", async () => {
  const t = await reported();
  assert.equal((await inbox.assignCase(t.caseId, t.mod, t.other, "You know this one")).ok, true);
  assert.ok((await inbox.readInbox(t.other, { view: "mine" }, null)).items.some((i) => i.id === t.caseId));
  assert.ok(!(await inbox.readInbox(t.mod, { view: "needs_me" }, null)).items.some((i) => i.id === t.caseId), "someone else's assignment leaves Needs me");
  assert.equal((await inbox.escalateCase(t.caseId, t.mod, "Needs a ban call", true)).ok, true);
  assert.ok((await inbox.readInbox(t.mod, { view: "escalated" }, null)).items.some((i) => i.id === t.caseId));
  const [{ version }] = await sql`SELECT version FROM moderation_cases WHERE id = ${t.caseId}`;
  assert.equal(((await inbox.assignCase(t.caseId, t.mod, null, "", version - 1)) as { ok: boolean }).ok, false, "stale assign refused");
  assert.equal((await decide.decideCase(t.caseId, staff(t.other), { outcome: "no_violation" })).ok, true);
  assert.equal((await sql`SELECT escalated_at FROM moderation_cases WHERE id = ${t.caseId}`)[0]!.escalated_at, null);
});

test("skipping the suggested step needs a note", async () => {
  const t = await reported();
  const skip = { outcome: "actioned" as const, content: "remove" as const, account: { action: "suspension" as const, days: 14 }, rule: 4 };
  const refused = await decide.decideCase(t.caseId, staff(t.mod), skip);
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.error : "", /suggested step/);
  assert.equal((await decide.decideCase(t.caseId, staff(t.mod), { ...skip, note: "Coordinated scam ring" })).ok, true);
});

test("decide together: the account step lands once, the other cases get the content action quietly", async () => {
  const a = await reported();
  const b = await reported(a.author);
  const r = await decide.decideTogether(a.caseId, [b.caseId], staff(a.mod), { outcome: "actioned", content: "remove", account: { action: "warning" }, rule: 4 });
  assert.equal(r.ok && r.done, 2);
  const rows = await sql`SELECT case_id, action, coalesce((restore->>'quiet')::boolean, false) AS quiet FROM moderation_actions WHERE case_id IN (${a.caseId}, ${b.caseId}) ORDER BY created_at`;
  assert.deepEqual(rows.filter((x) => x.case_id === b.caseId).map((x) => [x.action, x.quiet]), [["remove", true]]);
  assert.equal(rows.filter((x) => x.action === "warning").length, 1);
  const [{ strikes }] = await sql`SELECT count(*)::int AS strikes FROM moderation_actions WHERE case_id IN (${a.caseId}, ${b.caseId}) AND strike`;
  assert.equal(strikes, 1, "one decision, one strike");
  await sql`UPDATE moderation_actions SET notify_after = now() - interval '1 second' WHERE case_id IN (${a.caseId}, ${b.caseId})`;
  await decide.deliverDecisionNotices();
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${a.author} AND kind = 'trust_safety' AND dedupe_key LIKE 'trust:decision:%'`;
  assert.equal(n, 2, "one notice per action of the primary case, none for the quiet one");
});

test("the inbox pages by cursor with no repeats; counts come from one query", async () => {
  for (let i = 0; i < 3; i += 1) await reported();
  const first = await inbox.readInbox(crypto.randomUUID(), { view: "unclaimed" }, null);
  assert.ok(first.items.length > 0);
  const counts = await inbox.inboxCounts(true);
  assert.ok(counts.open >= first.items.filter((i) => i.type === "case").length || first.next !== null);
  if (first.next) {
    const second = await inbox.readInbox(crypto.randomUUID(), { view: "unclaimed" }, first.next);
    const ids = new Set(first.items.map((i) => i.id));
    assert.ok(second.items.every((i) => !ids.has(i.id)));
  }
});
