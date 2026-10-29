import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Reporting into cases (docs/trust-and-safety-concept.md §5–§6): grouping, severity, routing, duplicates, your own
// content, hide-on-first-report for intimate images, the self-harm notice, and the database restriction guards.

moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let cases: typeof import("../../src/lib/trust/cases");
before(async () => {
  cases = await loadAppModule(() => import("../../src/lib/trust/cases"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function post(author: string, workspace: string, text = "hello") {
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${workspace}, ${author}, ${text}) RETURNING id`;
  return row!.id as string;
}

test("reports on one post join one case; severity only rises; a second report by the same person is refused", async () => {
  const [author, a, b] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const workspace = await sql.begin((tx) => createProject(tx, author));
  const id = await post(author, workspace);

  const first = await cases.fileReport(a!, { kind: "update", targetId: id, reason: "spam" });
  assert.equal(first.ok, true, JSON.stringify(first));
  const again = await cases.fileReport(a!, { kind: "update", targetId: id, reason: "spam" });
  assert.equal(again.ok, false);
  assert.match((again as { error: string }).error, /already reported/);
  const second = await cases.fileReport(b!, { kind: "update", targetId: id, reason: "harassment", details: "Targets me" });
  assert.equal(second.ok && first.ok && second.caseNumber === first.caseNumber, true);

  const [row] = await sql`SELECT severity, reason, routed_to, state, (SELECT count(*)::int FROM content_reports r WHERE r.case_id = c.id) AS reports,
    snapshot->>'content' AS content FROM moderation_cases c WHERE target_id = ${id}`;
  assert.deepEqual({ ...row }, { severity: "high", reason: "harassment", routed_to: "staff", state: "open", reports: 2, content: "hello" });
});

test("you can't report your own content, and reasons must fit the kind", async () => {
  const author = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, author));
  const id = await post(author, workspace);
  const own = await cases.fileReport(author, { kind: "update", targetId: id, reason: "spam" });
  assert.equal(own.ok, false);
  assert.match((own as { error: string }).error, /your own/);
  const reporter = await sql.begin((tx) => createUser(tx));
  const wrong = await cases.fileReport(reporter, { kind: "update", targetId: id, reason: "impersonation" });
  assert.equal(wrong.ok, false);
});

test("intimate images are hidden on the first report and the author is told; the case is urgent and staff-only", async () => {
  const [author, reporter] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx)]);
  const workspace = await sql.begin((tx) => createProject(tx, author));
  const id = await post(author, workspace, "a photo");
  const result = await cases.fileReport(reporter!, { kind: "update", targetId: id, reason: "intimate_images" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const [upd] = await sql`SELECT deleted_at IS NOT NULL AS hidden FROM workspace_updates WHERE id = ${id}`;
  assert.equal(upd!.hidden, true);
  const [c] = await sql`SELECT severity, routed_to, auto_hidden_at IS NOT NULL AS auto FROM moderation_cases WHERE target_id = ${id}`;
  assert.deepEqual({ ...c }, { severity: "urgent", routed_to: "staff", auto: true });
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${author} AND kind = 'trust_safety'`;
  assert.match(String(notice?.title), /hidden while we review/);
});

test("a self-harm report sends the person a support notice, not a penalty", async () => {
  const [person, reporter] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx)]);
  const result = await cases.fileReport(reporter!, { kind: "person", targetId: person!, reason: "self_harm" });
  assert.equal(result.ok, true, JSON.stringify(result));
  const [notice] = await sql`SELECT body FROM user_notifications WHERE user_id = ${person} AND kind = 'trust_safety'`;
  assert.match(String(notice?.body), /Tele-MANAS 14416/);
  const [actions] = await sql`SELECT count(*)::int AS n FROM moderation_actions WHERE subject_id = ${person}`;
  assert.equal(actions!.n, 0);
});

test("org content goes to org moderators with half the deadline; content about the org's admins goes to staff", async () => {
  const [owner, member, reporter] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`UPDATE workspaces SET kind = 'organization' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner}, 'owner'), (${org}, ${member}, 'member'), (${org}, ${reporter}, 'member')`;
  const byMember = await post(member!, org);
  const byOwner = await post(owner!, org);
  await cases.fileReport(reporter!, { kind: "update", targetId: byMember, reason: "spam" });
  await cases.fileReport(reporter!, { kind: "update", targetId: byOwner, reason: "spam" });
  const rows = await sql`SELECT target_id, routed_to, extract(epoch FROM (org_deadline_at - created_at))::int / 3600 AS org_hours FROM moderation_cases WHERE target_id IN (${byMember}, ${byOwner})`;
  const byId = new Map(rows.map((r) => [r.target_id, r]));
  assert.equal(byId.get(byMember)!.routed_to, "org");
  assert.equal(byId.get(byMember)!.org_hours, 36);
  assert.equal(byId.get(byOwner)!.routed_to, "staff");
});

test("database guards: a suspended account writes nothing; a limited one can't reach outside its workspaces", async () => {
  const [limited, suspended, owner] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  const mine = await sql.begin((tx) => createProject(tx, limited!));
  const theirs = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO moderation_actions (subject_id, target_kind, action, ends_at) VALUES (${limited}, 'account', 'limit', now() + interval '7 days'), (${suspended}, 'account', 'suspension', now() + interval '14 days')`;
  await assert.doesNotReject(post(limited!, mine));
  await assert.rejects(post(limited!, theirs), /account_limited/);
  await assert.rejects(post(suspended!, mine), /account_suspended/);
  await assert.rejects(sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${limited}, ${owner}, 'pending')`, /account_limited/);
});
