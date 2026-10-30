import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// The last trust and safety pieces: hidden content in place, the session gate for suspended accounts, suspension
// leaving search, reporting an org from its join page, and "Reported · in review".

moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let cases: typeof import("../../src/lib/trust/cases");
let decide: typeof import("../../src/lib/trust/decide");
let placeholders: typeof import("../../src/lib/trust/placeholders");
let gate: typeof import("../../src/lib/trust/session-gate");
let jobs: typeof import("../../src/lib/trust/jobs");
before(async () => {
  cases = await loadAppModule(() => import("../../src/lib/trust/cases"));
  decide = await loadAppModule(() => import("../../src/lib/trust/decide"));
  placeholders = await loadAppModule(() => import("../../src/lib/trust/placeholders"));
  gate = await loadAppModule(() => import("../../src/lib/trust/session-gate"));
  jobs = await loadAppModule(() => import("../../src/lib/trust/jobs"));
});

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

const staff = (id: string) => ({ id, scope: "staff" as const, role: "admin" as const });

async function decided(action: "hide" | "remove") {
  const [author, reporter, mod] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const workspace = await project(author!);
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${author}, 'buy now') RETURNING id`;
  await cases.fileReport(reporter!, { kind: "update", targetId: row!.id, reason: "spam" });
  const [c] = await sql`SELECT id FROM moderation_cases WHERE target_id = ${row!.id}`;
  await decide.decideCase(c!.id, staff(mod!), { outcome: "actioned", content: action, rule: 4 });
  await sql`UPDATE moderation_actions SET notified_at = now() WHERE case_id = ${c!.id}`;
  return { author: author!, reporter: reporter!, workspace, postId: row!.id as string };
}

test("hidden posts keep their place: the author sees the rule and Appeal, others only that it was hidden", async () => {
  const t = await decided("hide");
  const [mine] = await placeholders.moderatedInWorkspace(t.workspace, t.author);
  assert.equal(mine!.state, "hidden");
  assert.equal(mine!.rule, 4);
  assert.equal(mine!.canAppeal, true);
  assert.match(mine!.caseLabel ?? "", /^NB-\d+$/);
  const [theirs] = await placeholders.moderatedInWorkspace(t.workspace, t.reporter);
  assert.deepEqual({ state: theirs!.state, rule: theirs!.rule, caseLabel: theirs!.caseLabel }, { state: "hidden", rule: null, caseLabel: null });
});

test("removed posts show only to their author", async () => {
  const t = await decided("remove");
  assert.equal((await placeholders.moderatedInWorkspace(t.workspace, t.author))[0]!.state, "removed");
  assert.equal((await placeholders.moderatedInWorkspace(t.workspace, t.reporter)).length, 0);
});

test("a suspended person's old token counts as signed out, and a new sign-in can read but not write", async () => {
  const t = await decided("remove");
  const [c] = await sql`SELECT id FROM moderation_cases WHERE target_id = ${t.postId}`;
  const issuedBefore = Math.floor(Date.now() / 1000) - 60;
  await sql`INSERT INTO moderation_actions (case_id, subject_id, target_kind, action, ends_at) VALUES (${c!.id}, ${t.author}, 'account', 'suspension', now() + interval '14 days')`;
  gate.resetModerationGateCache();
  const signedIn = (issuedAt: number) => ({ session: null, error: null, user: { id: t.author } as never, snapshot: { issuedAt } as never });
  assert.equal((await gate.withModerationGate(signedIn(issuedBefore), { writes: false })).user, null, "old token");
  const fresh = signedIn(Math.floor(Date.now() / 1000) + 5);
  assert.notEqual((await gate.withModerationGate(fresh, { writes: false })).user, null, "pages still open, to show the restricted screen");
  assert.equal((await gate.withModerationGate(fresh, { writes: true })).user, null, "no writes");
  gate.resetModerationGateCache();
});

test("a suspension takes the profile out of search and gives it back when it ends", async () => {
  const t = await decided("remove");
  const [c] = await sql`SELECT id FROM moderation_cases WHERE target_id = ${t.postId}`;
  await sql`UPDATE moderation_cases SET state = 'open', outcome = NULL WHERE id = ${c!.id}`;
  const mod = await sql.begin((tx) => createUser(tx));
  assert.equal((await decide.decideCase(c!.id, staff(mod), { outcome: "actioned", account: { action: "suspension", days: 14 }, rule: 4, note: "Past the suggested step on purpose" })).ok, true);
  assert.equal((await sql`SELECT visibility FROM profiles WHERE id = ${t.author}`)[0]!.visibility, "private");
  await sql`UPDATE moderation_actions SET ends_at = now() - interval '1 minute' WHERE case_id = ${c!.id} AND action = 'suspension'`;
  await jobs.runTrustRestrictions();
  assert.equal((await sql`SELECT visibility FROM profiles WHERE id = ${t.author}`)[0]!.visibility, "public");
});

test("an org can be reported from its join page by someone who isn't in it yet", async () => {
  const [owner, visitor] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx)]);
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  made.push(org);
  const code = generateJoinCode();
  await sql`UPDATE workspaces SET kind = 'organization', join_code = ${code}, join_code_enabled = true WHERE id = ${org}`;
  assert.equal((await cases.fileReport(visitor!, { kind: "project", targetId: org, reason: "scam" })).ok, false, "without the code it isn't visible");
  const result = await cases.fileReport(visitor!, { kind: "project", targetId: org, reason: "scam", joinCode: code });
  assert.equal(result.ok, true, JSON.stringify(result));
  const open = await cases.openReportsOf(visitor!);
  assert.equal(open[0]!.targetId, org, "Reported · in review");
});
