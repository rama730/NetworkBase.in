import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Decisions (docs/trust-and-safety-concept.md §7, C7–C9): no violation restores an auto-hide; actions apply with
// a strike; Undo inside 10 seconds reverts everything; notices wait for the Undo window; Lift ends a limit; org
// moderators can only hide, remove and warn.

moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let cases: typeof import("../../src/lib/trust/cases");
let decide: typeof import("../../src/lib/trust/decide");
let appeals: typeof import("../../src/lib/trust/appeals");
before(async () => {
  cases = await loadAppModule(() => import("../../src/lib/trust/cases"));
  decide = await loadAppModule(() => import("../../src/lib/trust/decide"));
  appeals = await loadAppModule(() => import("../../src/lib/trust/appeals"));
});
// Tests share one database: what these leave behind (public posts, safety notices) would show up in other suites.
const made: string[] = [];
async function project(owner: string) {
  const id = await sql.begin((tx) => createProject(tx, owner));
  made.push(id);
  return id;
}
after(async () => {
  await sql`DELETE FROM user_notifications WHERE kind = 'trust_safety'`;
  if (made.length) await sql`DELETE FROM workspaces WHERE id IN ${sql(made)}`;
  await sql.end();
  await closeAppDb();
});

const staffActor = (id: string, role: "admin" | "moderator" = "moderator") => ({ id, scope: "staff" as const, role });

async function reportedPost(reason: "spam" | "intimate_images" = "spam") {
  const [author, reporter, mod] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const workspace = await project(author!);
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${author}, 'buy now') RETURNING id`;
  const filed = await cases.fileReport(reporter!, { kind: "update", targetId: row!.id, reason });
  assert.equal(filed.ok, true, JSON.stringify(filed));
  const [c] = await sql`SELECT id FROM moderation_cases WHERE target_id = ${row!.id}`;
  return { author: author!, reporter: reporter!, mod: mod!, workspace, postId: row!.id as string, caseId: c!.id as string };
}

test("no rule broken brings back what was hidden on the first report", async () => {
  const t = await reportedPost("intimate_images");
  assert.equal((await sql`SELECT deleted_at IS NOT NULL AS hidden FROM workspace_updates WHERE id = ${t.postId}`)[0]!.hidden, true);
  const result = await decide.decideCase(t.caseId, staffActor(t.mod), { outcome: "no_violation" });
  assert.equal(result.ok, true);
  assert.equal((await sql`SELECT deleted_at IS NOT NULL AS hidden FROM workspace_updates WHERE id = ${t.postId}`)[0]!.hidden, false);
  const [c] = await sql`SELECT state, outcome FROM moderation_cases WHERE id = ${t.caseId}`;
  assert.deepEqual({ ...c }, { state: "decided", outcome: "no_violation" });
});

test("remove plus a limit: one strike, the limit blocks writes elsewhere, Undo puts everything back", async () => {
  const t = await reportedPost();
  const result = await decide.decideCase(t.caseId, staffActor(t.mod), { outcome: "actioned", content: "remove", account: { action: "limit", days: 7 }, rule: 4, note: "Past the suggested step on purpose", message: "No ads." });
  assert.equal(result.ok, true, JSON.stringify(result));
  const actions = await sql`SELECT action, strike, ends_at IS NOT NULL AS ends, appeal_until IS NOT NULL AS appeal FROM moderation_actions WHERE case_id = ${t.caseId} ORDER BY action`;
  assert.deepEqual(actions.map((a) => ({ ...a })), [
    { action: "limit", strike: true, ends: true, appeal: true },
    { action: "remove", strike: false, ends: false, appeal: true },
  ]);
  assert.equal(await decide.activeStrikes((await import("../../src/lib/db")).db, t.author), 1);
  const other = await project(t.reporter);
  await assert.rejects(sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${other}, ${t.author}, 'hi')`, /account_limited/);

  const undo = await decide.undoDecision(t.caseId, t.mod);
  assert.equal(undo.ok, true, JSON.stringify(undo));
  assert.equal((await sql`SELECT deleted_at FROM workspace_updates WHERE id = ${t.postId}`)[0]!.deleted_at, null);
  const [c] = await sql`SELECT state, assignee_id FROM moderation_cases WHERE id = ${t.caseId}`;
  assert.deepEqual({ ...c }, { state: "in_review", assignee_id: t.mod });
  await assert.doesNotReject(sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${other}, ${t.author}, 'hi')`);
});

test("notices wait for the Undo window, then the person and the reporter hear once", async () => {
  const t = await reportedPost();
  await decide.decideCase(t.caseId, staffActor(t.mod), { outcome: "actioned", content: "remove", rule: 4, message: "No ads." });
  await decide.deliverDecisionNotices(t.caseId);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.author} AND kind = 'trust_safety'`)[0]!.n, 0, "not before 10 seconds");
  await sql`UPDATE moderation_actions SET notify_after = now() - interval '1 second' WHERE case_id = ${t.caseId}`;
  await sql`UPDATE moderation_cases SET decided_at = now() - interval '11 seconds' WHERE id = ${t.caseId}`;
  await decide.deliverDecisionNotices(t.caseId);
  await decide.deliverDecisionNotices(t.caseId);
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${t.author} AND kind = 'trust_safety'`;
  assert.match(String(notice?.title), /We removed your post/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM email_outbox WHERE user_id = ${t.author} AND kind = 'trust_person'`)[0]!.n, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.reporter} AND kind = 'trust_safety'`)[0]!.n, 1);
  assert.equal((await decide.undoDecision(t.caseId, t.mod)).ok, false, "too late to undo");
});

test("lifting a limit ends it at once", async () => {
  const t = await reportedPost();
  await decide.decideCase(t.caseId, staffActor(t.mod), { outcome: "actioned", account: { action: "limit", days: 7 }, rule: 4, note: "Past the suggested step on purpose" });
  const [limit] = await sql`SELECT id FROM moderation_actions WHERE case_id = ${t.caseId} AND action = 'limit'`;
  assert.equal((await decide.reverseAction(limit!.id, t.mod, "lifted", "Mistake")).ok, true);
  assert.equal((await sql`SELECT app_private.moderation_restriction(${t.author}::uuid) AS r`)[0]!.r, null);
});

test("moderators can't ban; org moderators can only hide, remove or warn", async () => {
  const t = await reportedPost();
  const ban = await decide.decideCase(t.caseId, staffActor(t.mod), { outcome: "actioned", account: { action: "ban" }, rule: 4 });
  assert.match((ban as { error: string }).error, /Only admins/);
  await sql`UPDATE moderation_cases SET routed_to = 'org', org_id = ${t.workspace} WHERE id = ${t.caseId}`;
  const org = { id: t.mod, scope: "org" as const, orgId: t.workspace };
  const limit = await decide.decideCase(t.caseId, org, { outcome: "actioned", account: { action: "limit", days: 7 }, rule: 4 });
  assert.equal(limit.ok, false);
  assert.equal((await decide.decideCase(t.caseId, org, { outcome: "actioned", content: "hide", rule: 4 })).ok, true);
  assert.equal((await sql`SELECT count(*)::int AS n FROM moderation_actions WHERE case_id = ${t.caseId} AND strike`)[0]!.n, 0, "org actions never strike");
});

async function decided() {
  const t = await reportedPost();
  await decide.decideCase(t.caseId, staffActor(t.mod), { outcome: "actioned", content: "remove", account: { action: "limit", days: 30 }, rule: 4, note: "Past the suggested step on purpose", message: "No ads." });
  const [c] = await sql`SELECT number::int AS number FROM moderation_cases WHERE id = ${t.caseId}`;
  return { ...t, number: c!.number as number };
}

test("one appeal per decision; reversed restores the post, lifts the limit and drops the strike", async () => {
  const t = await decided();
  assert.equal((await appeals.fileAppeal(t.reporter, t.number, "not mine", false)).ok, false, "only the person it's about");
  const filed = await appeals.fileAppeal(t.author, t.number, "It was a real offer, not an ad.", false);
  assert.equal(filed.ok, true, JSON.stringify(filed));
  assert.equal((await appeals.fileAppeal(t.author, t.number, "again", false)).ok, false, "no second appeal");
  const reviewer = await sql.begin((tx) => createUser(tx));
  const result = await appeals.decideAppeal(t.caseId, reviewer, "reversed", "We got this wrong.", "");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await sql`SELECT deleted_at FROM workspace_updates WHERE id = ${t.postId}`)[0]!.deleted_at, null);
  assert.equal((await sql`SELECT app_private.moderation_restriction(${t.author}::uuid) AS r`)[0]!.r, null);
  assert.equal(await decide.activeStrikes((await import("../../src/lib/db")).db, t.author), 0);
  assert.equal((await sql`SELECT state FROM moderation_appeals WHERE case_id = ${t.caseId}`)[0]!.state, "reversed");
});

test("reduced keeps the strike with a lighter limit; upheld changes nothing", async () => {
  const t = await decided();
  await appeals.fileAppeal(t.author, t.number, "Too harsh for a first time.", false);
  const reviewer = await sql.begin((tx) => createUser(tx));
  assert.equal((await appeals.decideAppeal(t.caseId, reviewer, "reduced", "Lighter.", "", { action: "limit", days: 7 })).ok, true);
  const [limit] = await sql`SELECT strike, extract(day FROM ends_at - created_at)::int AS days FROM moderation_actions WHERE case_id = ${t.caseId} AND action = 'limit'`;
  assert.deepEqual({ ...limit }, { strike: true, days: 7 });

  const u = await decided();
  await appeals.fileAppeal(u.author, u.number, "Please look again.", false);
  assert.equal((await appeals.decideAppeal(u.caseId, reviewer, "upheld", "It stays.", "")).ok, true);
  assert.equal((await sql`SELECT app_private.moderation_restriction(${u.author}::uuid) AS r`)[0]!.r, "limit");
});

test("a ban signs out everywhere, blocks the email, and a new account with it is banned at setup", async () => {
  const t = await reportedPost();
  const admin = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO auth.sessions (id, user_id) VALUES (gen_random_uuid(), ${t.author})`;
  await sql`INSERT INTO auth.identities (user_id, provider, provider_id, identity_data) VALUES (${t.author}, 'github', ${`gh-${t.author}`}, '{}')`;
  const result = await decide.decideCase(t.caseId, staffActor(admin, "admin"), { outcome: "actioned", content: "remove", account: { action: "ban" }, rule: 4, note: "Past the suggested step on purpose" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await sql`SELECT count(*)::int AS n FROM auth.sessions WHERE user_id = ${t.author}`)[0]!.n, 0);
  assert.equal((await sql`SELECT app_private.moderation_restriction(${t.author}::uuid) AS r`)[0]!.r, "ban");

  const standing = await loadAppModule(() => import("../../src/lib/trust/standing"));
  const evader = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO auth.identities (user_id, provider, provider_id, identity_data) VALUES (${evader}, 'github', ${`gh-${t.author}`}, '{}')`;
  assert.equal(await standing.banIfBlockedIdentity(evader), true);
  assert.equal((await sql`SELECT app_private.moderation_restriction(${evader}::uuid) AS r`)[0]!.r, "ban");
});
