import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Pre-release checks on trust and safety: two first reports at once, removing a workspace on the org deletion clock
// (paused by an appeal), Restrict closing joins and invites, deleting an account that has a moderation log, and
// the data export.

moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let cases: typeof import("../../src/lib/trust/cases");
let decide: typeof import("../../src/lib/trust/decide");
let appeals: typeof import("../../src/lib/trust/appeals");
let standing: typeof import("../../src/lib/trust/standing");
let join: typeof import("../../src/lib/organizations/join");
let invitations: typeof import("../../src/lib/workspaces/workspace-invitations");
before(async () => {
  cases = await loadAppModule(() => import("../../src/lib/trust/cases"));
  decide = await loadAppModule(() => import("../../src/lib/trust/decide"));
  appeals = await loadAppModule(() => import("../../src/lib/trust/appeals"));
  standing = await loadAppModule(() => import("../../src/lib/trust/standing"));
  join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  invitations = await loadAppModule(() => import("../../src/lib/workspaces/workspace-invitations"));
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

test("two first reports at the same moment join one case instead of failing", async () => {
  const [author, a, b] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const workspace = await project(author!);
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${author}, 'race me') RETURNING id`;
  const [first, second] = await Promise.all([
    cases.fileReport(a!, { kind: "update", targetId: row!.id, reason: "spam" }),
    cases.fileReport(b!, { kind: "update", targetId: row!.id, reason: "spam" }),
  ]);
  assert.equal(first.ok && second.ok, true, JSON.stringify([first, second]));
  assert.equal((await sql`SELECT count(*)::int AS n FROM moderation_cases WHERE target_id = ${row!.id}`)[0]!.n, 1);
});

test("removing a workspace starts the 30-day deletion clock now; an appeal pauses it and upheld resumes it", async () => {
  const [owner, reporter, mod] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const org = await project(owner!);
  const child = await project(owner!);
  await sql`UPDATE workspaces SET kind = 'organization', join_code = ${generateJoinCode()}, join_code_enabled = true WHERE id = ${org}`;
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${child}`;
  assert.equal((await cases.fileReport(reporter!, { kind: "project", targetId: org, reason: "scam" })).ok, true);
  const [c] = await sql`SELECT id, number::int AS number FROM moderation_cases WHERE target_id = ${org}`;
  assert.equal((await decide.decideCase(c!.id, staff(mod!), { outcome: "actioned", content: "remove_workspace", rule: 6 })).ok, true);

  const [w] = await sql`SELECT extract(epoch FROM now() - deletion_scheduled_at)::int AS age, join_code_enabled FROM workspaces WHERE id = ${org}`;
  assert.ok(w!.age < 60, "scheduled now, so the purge comes 30 days from now");
  assert.equal(w!.join_code_enabled, false);
  assert.notEqual((await sql`SELECT deletion_scheduled_at FROM workspaces WHERE id = ${child}`)[0]!.deletion_scheduled_at, null, "its workspaces go with it");
  const [a] = await sql`SELECT extract(day FROM ends_at - now())::int AS days FROM moderation_actions WHERE case_id = ${c!.id}`;
  assert.ok(a!.days >= 29, "the owner is told the real date");

  assert.equal((await appeals.fileAppeal(owner!, c!.number, "This is our real school.", false)).ok, true);
  const paused = await sql`SELECT deletion_scheduled_at FROM workspaces WHERE id IN (${org}, ${child})`;
  assert.ok(paused.every((r) => r.deletion_scheduled_at === null), "never deleted while the appeal is open");
  assert.equal((await appeals.decideAppeal(c!.id, reporter!, "upheld", "It stays removed.", "")).ok, true);
  const resumed = await sql`SELECT deletion_scheduled_at FROM workspaces WHERE id IN (${org}, ${child})`;
  assert.ok(resumed.every((r) => r.deletion_scheduled_at !== null), "the clock resumes for the org and its workspaces");
});

test("a restricted workspace takes no one new: join codes stop and invitations are refused", async () => {
  const [owner, mod, guest] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const org = await project(owner!);
  const code = generateJoinCode();
  await sql`UPDATE workspaces SET kind = 'organization', join_code = ${code}, join_code_enabled = true WHERE id = ${org}`;
  await sql`INSERT INTO moderation_cases (target_kind, target_id, subject_id, severity, reason, source, routed_to, deadline_at)
    VALUES ('project', ${org}, ${owner}, 'high', 'scam', 'staff', 'staff', now() + interval '1 day')`;
  const [c] = await sql`SELECT id FROM moderation_cases WHERE target_id = ${org}`;
  assert.equal((await decide.decideCase(c!.id, staff(mod!), { outcome: "actioned", content: "restrict", rule: 6 })).ok, true);
  assert.equal((await sql`SELECT visibility FROM workspaces WHERE id = ${org}`)[0]!.visibility, "private");
  assert.equal(await join.joinOrgByCode(guest!, code), null);
  await assert.rejects(invitations.createWorkspaceInvitation({ actorId: owner!, candidateId: guest!, projectId: org, kind: "ordinary_role" }), /restricted/);
});

test("deleting an account keeps the moderation log, with the name blanked", async () => {
  const [person, reporter, mod] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const workspace = await project(person!);
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${person}, 'buy now') RETURNING id`;
  await cases.fileReport(reporter!, { kind: "update", targetId: row!.id, reason: "spam" });
  const [c] = await sql`SELECT id, number::int AS number FROM moderation_cases WHERE target_id = ${row!.id}`;
  await decide.decideCase(c!.id, staff(mod!), { outcome: "actioned", content: "remove", rule: 4 });
  await appeals.fileAppeal(person!, c!.number, "It was a real offer.", false);
  await sql`DELETE FROM workspaces WHERE id = ${workspace}`;
  await sql`DELETE FROM profiles WHERE id = ${person}`;
  const log = await sql`SELECT kind, actor_id FROM moderation_events WHERE case_id = ${c!.id} AND kind = 'appealed'`;
  assert.deepEqual(log.map((r) => ({ ...r })), [{ kind: "appealed", actor_id: null }]);
});

test("the data export lists your reports and the decisions about you, without anyone else's name", async () => {
  const [author, reporter, mod] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const workspace = await project(author!);
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${author}, 'buy now') RETURNING id`;
  await cases.fileReport(reporter!, { kind: "update", targetId: row!.id, reason: "spam" });
  const [c] = await sql`SELECT id FROM moderation_cases WHERE target_id = ${row!.id}`;
  await decide.decideCase(c!.id, staff(mod!), { outcome: "actioned", content: "remove", rule: 4, message: "No ads." });
  await sql`UPDATE moderation_actions SET notified_at = now() WHERE case_id = ${c!.id}`;
  const mine = await standing.exportTrustData(reporter!);
  assert.equal(mine.reports.length, 1);
  assert.equal(mine.reports[0]!.status, "actioned");
  const theirs = await standing.exportTrustData(author!);
  assert.equal(theirs.decisionsAboutYou[0]!.action, "remove");
  assert.ok(!JSON.stringify(theirs).includes(reporter!), "never the reporter");
});
