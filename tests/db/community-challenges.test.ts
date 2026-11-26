import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { copyState } from "../../src/lib/organizations/assignment-rules";
import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.4a (report 34.5 call 1): a community challenge is an Optional assignment — copies only for people who Join, never
// Missing or Overdue; Leave removes a copy with nothing handed in; no reminders to take part.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.242" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let assignments: typeof import("../../src/app/actions/assignments");
let ch: typeof import("../../src/app/actions/community-challenges");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  ch = await loadAppModule(() => import("../../src/app/actions/community-challenges"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(type: string) {
  const [owner, a, b, viewer] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member'), (${id}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = ${type}, status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  return { id, owner: owner!, a: a!, b: b!, viewer: viewer! };
}
const challenge = (orgId: string, due: string) => assignments.createAssignmentAction({ projectId: orgId, title: "Build a CLI", description: "Make a tool you'd use every day.", dueDate: due, publish: true,
  submissionType: "link", reviewRequired: false, lateRule: "none", target: { mode: "optional" }, steps: [] });

test("34.5 call 1: nobody gets a copy until they Join; a joined copy has no due date and is never Missing; Leave; no reminders", async () => {
  const o = await org("community");
  viewerId = o.owner;
  const made = await challenge(o.id, new Date(Date.now() + 2 * 864e5).toISOString());
  assert.ok(made.success, JSON.stringify(made));
  const masterId = made.success ? made.masterId : "";
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${masterId}`)[0]!.n, 0, "no copies at publish");

  viewerId = o.a;
  const joined = await ch.joinChallengeAction(o.id, masterId);
  assert.ok(joined.success);
  const again = await ch.joinChallengeAction(o.id, masterId);
  assert.ok(again.success && joined.success && again.copyId === joined.copyId, "one copy each");
  const [copy] = await sql`SELECT due_date, status, review_status, excused_at, completed_at FROM tasks WHERE id = ${joined.success ? joined.copyId : ""}`;
  assert.equal(copy!.due_date, null);
  const st = copyState({ dueDate: null, status: copy!.status, reviewStatus: copy!.review_status, excusedAt: null, completedAt: null, submittedAt: null } as Parameters<typeof copyState>[0], new Date(Date.now() + 365 * 864e5));
  assert.notEqual(st.state, "missing", "never Missing, even long after");

  for (const who of [o.viewer]) { viewerId = who; assert.equal((await ch.joinChallengeAction(o.id, masterId)).success, false, "viewers don't join"); }
  viewerId = o.owner;
  assert.equal((await assignments.remindCopiesAction(masterId)).success, false, "no reminders to take part");

  viewerId = o.a;
  let list = await ch.readChallengesAction(o.id);
  assert.ok(list.success && list.challenges[0]!.joined === 1 && list.challenges[0]!.mine);
  assert.ok((await ch.leaveChallengeAction(o.id, masterId)).success);
  list = await ch.readChallengesAction(o.id);
  assert.ok(list.success && list.challenges[0]!.joined === 0 && !list.challenges[0]!.mine);

  // A paused member can't join; a closed challenge takes nobody.
  await sql`UPDATE workspaces SET org_settings = jsonb_build_object('community', jsonb_build_object('pauses', jsonb_build_object(${o.b}::text, jsonb_build_object('until', ${new Date(Date.now() + 36e5).toISOString()}::text)))) WHERE id = ${o.id}`;
  viewerId = o.b;
  assert.equal((await ch.joinChallengeAction(o.id, masterId)).success, false);
  await sql`UPDATE tasks SET due_date = now() - interval '1 hour' WHERE id = ${masterId}`;
  viewerId = o.a;
  assert.equal((await ch.joinChallengeAction(o.id, masterId)).success, false, "closed");
  // Review: after the closing date nobody hands in, even with a copy and no Close pressed.
  await sql`UPDATE tasks SET due_date = now() + interval '1 hour' WHERE id = ${masterId}`;
  const late = await ch.joinChallengeAction(o.id, masterId);
  assert.ok(late.success);
  await sql`UPDATE tasks SET due_date = now() - interval '1 minute' WHERE id = ${masterId}`;
  assert.equal((await assignments.submitAssignmentAction(late.success ? late.copyId : "", { link: "https://example.com/late" })).success, false);
});

test("34.5: optional challenges are for communities only; a handed-in entry stays when you Leave", async () => {
  const e = await org("education");
  viewerId = e.owner;
  const refused = await challenge(e.id, new Date(Date.now() + 864e5).toISOString());
  assert.equal(refused.success, false);

  const o = await org("community");
  viewerId = o.owner;
  const made = await challenge(o.id, new Date(Date.now() + 864e5).toISOString());
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  viewerId = o.a;
  const joined = await ch.joinChallengeAction(o.id, masterId);
  assert.ok(joined.success);
  assert.ok((await assignments.submitAssignmentAction(joined.copyId, { link: "https://example.com/tz-now" })).success);
  assert.equal((await ch.leaveChallengeAction(o.id, masterId)).success, false, "handed in: it stays");
  const list = await ch.readChallengesAction(o.id);
  assert.ok(list.success && list.challenges[0]!.entries === 1 && list.challenges[0]!.mine?.handedIn);
});

test("34.5 calls 4–6: the maker's card and public yes; organisers Feature with a line; visitors see only yes'd entries in a public community; Featured first", async () => {
  const o = await org("community");
  const [visitor] = await Promise.all([1].map(() => sql.begin((tx) => createUser(tx))));
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${o.id}`;
  viewerId = o.owner;
  const made = await challenge(o.id, new Date(Date.now() + 864e5).toISOString());
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  const copies: Record<string, string> = {};
  for (const who of [o.a, o.b]) {
    viewerId = who;
    const j = await ch.joinChallengeAction(o.id, masterId);
    assert.ok(j.success);
    copies[who] = j.success ? j.copyId : "";
    assert.ok((await assignments.submitAssignmentAction(copies[who]!, { link: `https://example.com/${who.slice(0, 6)}` })).success);
  }
  viewerId = o.b;
  assert.equal((await ch.saveEntryCardAction(o.id, copies[o.a]!, { title: "Not mine", line: null, isPublic: true })).success, false, "only the maker");
  viewerId = o.a;
  assert.ok((await ch.saveEntryCardAction(o.id, copies[o.a]!, { title: "tz-now", line: "Time zones at a glance", isPublic: true })).success);
  viewerId = o.a;
  assert.equal((await ch.featureEntryAction(o.id, copies[o.b]!, "tiny and useful")).success, false, "members don't feature");
  viewerId = o.owner;
  assert.ok((await ch.featureEntryAction(o.id, copies[o.b]!, "tiny and useful")).success);

  viewerId = o.a;
  // Review: a featured entry that changes loses Featured; give-a-copy never works on a challenge.
  viewerId = o.b;
  await assignments.unsubmitAssignmentAction(copies[o.b]!);
  assert.ok((await assignments.submitAssignmentAction(copies[o.b]!, { link: "https://example.com/swapped" })).success);
  const [f] = await sql`SELECT featured_at FROM community_showcase WHERE copy_id = ${copies[o.b]!}`;
  assert.equal(f!.featured_at, null, "changed entry: no longer featured");
  viewerId = o.owner;
  assert.equal((await assignments.giveCopyAction(masterId, o.viewer, new Date(Date.now() + 864e5).toISOString())).success, false);
  assert.ok((await ch.featureEntryAction(o.id, copies[o.b]!, "tiny and useful")).success);
  viewerId = o.a;
  const inside = await ch.readShowcaseAction(o.id);
  assert.ok(inside.success);
  assert.deepEqual(inside.entries.map((e) => e.featured), [true, false], "Featured first");
  assert.equal(inside.entries[0]!.why, "tiny and useful");

  viewerId = visitor!;
  let outside = await ch.readShowcaseAction(o.id);
  assert.ok(outside.success);
  assert.deepEqual(outside.entries.map((e) => e.title), ["tz-now"], "only the entry its maker said yes to");
  // Untick: it leaves the public Showcase; a private community has none.
  viewerId = o.a;
  await ch.saveEntryCardAction(o.id, copies[o.a]!, { title: "tz-now", line: null, isPublic: false });
  viewerId = visitor!;
  outside = await ch.readShowcaseAction(o.id);
  assert.ok(outside.success && outside.entries.length === 0);
  viewerId = o.a;
  await ch.saveEntryCardAction(o.id, copies[o.a]!, { title: "tz-now", line: null, isPublic: true });
  await sql`UPDATE workspaces SET visibility = 'private' WHERE id = ${o.id}`;
  viewerId = visitor!;
  const priv = await ch.readShowcaseAction(o.id);
  assert.ok(!priv.success || priv.entries.length === 0, "a private community has no public Showcase");
});

test("34.5 calls 2, 10: a prompt's title and text never reach members before Opens on; people who joined hear once a day", async () => {
  const o = await org("community");
  viewerId = o.owner;
  const made = await challenge(o.id, new Date(Date.now() + 7 * 864e5).toISOString());
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  const past = new Date(Date.now() - 10 * 60_000).toISOString();
  const later = new Date(Date.now() + 864e5).toISOString();
  assert.ok((await ch.savePromptsAction(o.id, masterId, [{ title: "Pick a problem", body: "Something you do daily", opensAt: past }, { title: "Secret twist", body: "Add colour", opensAt: later }])).success);
  viewerId = o.a;
  assert.equal((await ch.savePromptsAction(o.id, masterId, [])).success, false, "members don't edit prompts");
  const seen = await ch.readPromptsAction(o.id, masterId);
  assert.ok(seen.success);
  assert.equal(seen.prompts[0]!.title, "Pick a problem");
  assert.equal(seen.prompts[1]!.title, null, "hidden until it opens");
  assert.equal(JSON.stringify(seen).includes("Secret twist"), false);
  assert.equal(JSON.stringify(seen).includes("Add colour"), false);
  viewerId = o.owner;
  const own = await ch.readPromptsAction(o.id, masterId);
  assert.ok(own.success && own.prompts[1]!.title === "Secret twist", "organisers see every prompt");

  viewerId = o.a;
  await ch.joinChallengeAction(o.id, masterId);
  const { notifyChallengePrompts } = await loadAppModule(() => import("../../src/lib/organizations/community-server"));
  await notifyChallengePrompts();
  await notifyChallengePrompts();
  const told = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.a} AND title LIKE 'New prompt in%'`;
  assert.equal(told.length, 1, "one line a day");
  const notJoined = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${o.b} AND title LIKE 'New prompt in%'`;
  assert.equal(notJoined[0]!.n, 0, "only people who joined");
});
