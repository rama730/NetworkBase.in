import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.2 (report 34.3, M2): the members Directory (hide, counts, status never shown to members), organisers' People and
// roles, and Moderators — Hide, Pause posting, Pass to organisers — who never remove, block or change settings.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.240" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();

let members: typeof import("../../src/app/actions/community-members");
let mod: typeof import("../../src/app/actions/community-moderation");
let orgMod: typeof import("../../src/app/actions/moderation-org");
let cases: typeof import("../../src/lib/trust/cases");
let gate: typeof import("../../src/lib/organizations/community-server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/community-members"));
  mod = await loadAppModule(() => import("../../src/app/actions/community-moderation"));
  orgMod = await loadAppModule(() => import("../../src/app/actions/moderation-org"));
  cases = await loadAppModule(() => import("../../src/lib/trust/cases"));
  gate = await loadAppModule(() => import("../../src/lib/organizations/community-server"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [owner, admin, a, b, c, viewer, outsider] = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${owner!}, 'owner', now() - interval '1 year'),
    (${id}, ${admin!}, 'admin', now() - interval '1 year'), (${id}, ${a!}, 'member', now() - interval '200 days'), (${id}, ${b!}, 'member', now() - interval '3 days'),
    (${id}, ${c!}, 'member', now() - interval '100 days'), (${id}, ${viewer!}, 'viewer', now() - interval '10 days')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'coc', 'Code of conduct.md', ${sql.json({ org: { lifecycle: "published", readVersion: 0 } })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${id}, ${d!.id}, 1, '## Rules\n1. Be kind\n2. No spam', 'k') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  return { id, owner: owner!, admin: admin!, a: a!, b: b!, c: c!, viewer: viewer!, outsider: outsider! };
}
const post = async (org: string, author: string, text: string) => (await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${org}, ${author}, ${text}) RETURNING id`)[0]!.id as string;

test("34.3 calls 1–4: every member reads the Directory; hidden members stay out; status and join answers only for organisers", async () => {
  const s = await setup();
  await post(s.id, s.a, "hello");
  await post(s.id, s.a, "again");
  viewerId = s.b;
  let dir = await members.readCommunityDirectoryAction(s.id);
  assert.ok(dir.success);
  assert.equal(dir.me?.isNew, true, "joined 3 days ago: New on the card");
  const cardA = dir.people.find((p) => p.id === s.a)!;
  assert.equal(cardA.posts, 2, "plain counts");
  assert.ok(!("status" in cardA), "status never reaches members");
  assert.equal(dir.people.some((p) => p.id === s.viewer), false, "viewers aren't in the directory");

  viewerId = s.a;
  assert.equal((await members.saveMyCommunityCardAction(s.id, { hidden: true, hideCounts: true })).success, true);
  viewerId = s.b;
  dir = await members.readCommunityDirectoryAction(s.id);
  assert.ok(dir.success && !dir.people.some((p) => p.id === s.a), "hidden from the directory");

  for (const who of [s.viewer, s.outsider]) { viewerId = who; assert.equal((await members.readCommunityDirectoryAction(s.id)).success, false, "viewers and visitors don't read it"); }
  viewerId = s.b;
  assert.equal((await members.readCommunityPeopleAction(s.id)).success, false, "members never see People or status");

  viewerId = s.admin;
  const people = await members.readCommunityPeopleAction(s.id);
  assert.ok(people.success);
  const byId = new Map(people.people.map((p) => [p.id, p]));
  assert.equal(byId.get(s.b)!.status, "new");
  assert.equal(byId.get(s.a)!.status, "active", "posted just now");
  assert.equal(byId.get(s.c)!.status, "quiet", "100 days, nothing posted");
  assert.equal(byId.get(s.a)!.hidden, true, "organisers still see hidden members");
});

test("34.3 calls 5–7: organisers give roles; moderators Hide, Pause and Pass with a rule, logged; never remove, block or change settings", async () => {
  const s = await setup();
  viewerId = s.a;
  assert.equal((await members.setCommunityLabelAction(s.id, s.b, "moderator", true)).success, false, "members can't give roles");
  viewerId = s.admin;
  assert.equal((await members.setCommunityLabelAction(s.id, s.a, "moderator", true)).success, true);
  assert.equal((await members.setCommunityLabelAction(s.id, s.a, "helper", true)).success, true);
  viewerId = s.a;
  // Card switches don't wipe the labels organisers gave (merged saves).
  await members.saveMyCommunityCardAction(s.id, { hidden: false, hideCounts: false });
  viewerId = s.b;
  const dir = await members.readCommunityDirectoryAction(s.id);
  assert.ok(dir.success);
  assert.deepEqual([...dir.people.find((p) => p.id === s.a)!.labels].sort(), ["helper", "moderator"]);

  // b posts spam; c reports it; moderator a sees it.
  const spam = await post(s.id, s.b, "buy my course");
  await cases.fileReport(s.c, { kind: "update", targetId: spam, reason: "spam" });
  viewerId = s.a;
  let q = await mod.readCommunityModerationAction(s.id);
  assert.ok(q.success && q.cases.length === 1 && q.rules.length === 2);
  const caseId = q.cases[0]!.id;
  assert.equal((await mod.moderateCommunityReportAction(s.id, caseId, { choice: "pause", rule: 9, hours: 24 })).success, false, "a rule from the Code of conduct");
  assert.equal((await mod.moderateCommunityReportAction(s.id, caseId, { choice: "pause", rule: 2, hours: 24 })).success, true);
  assert.match(String(await gate.communityPostBlock(s.id, s.b)), /paused until/);
  const [log] = await sql`SELECT org_settings->'community'->'log' AS log FROM workspaces WHERE id = ${s.id}`;
  assert.ok((log!.log as Array<{ action: string; rule?: number }>).some((e) => e.action === "paused" && e.rule === 2), "logged with its rule");
  // The pause ends on its own.
  await sql`UPDATE workspace_members SET view_prefs = jsonb_set(view_prefs, '{community,pause,until}', to_jsonb((now() - interval '1 minute')::text)) WHERE workspace_id = ${s.id} AND user_id = ${s.b}`;
  assert.doesNotMatch(String(await gate.communityPostBlock(s.id, s.b)), /paused/);

  // A report the moderator made never reaches them; Pass hands one to organisers only.
  const spam2 = await post(s.id, s.b, "buy again");
  await cases.fileReport(s.a, { kind: "update", targetId: spam2, reason: "spam" });
  const spam3 = await post(s.id, s.c, "more spam");
  await cases.fileReport(s.b, { kind: "update", targetId: spam3, reason: "spam" });
  q = await mod.readCommunityModerationAction(s.id);
  assert.ok(q.success && q.cases.length === 1, "their own report is left out");
  assert.equal((await mod.moderateCommunityReportAction(s.id, q.cases[0]!.id, { choice: "pass", rule: 2 })).success, true);
  q = await mod.readCommunityModerationAction(s.id);
  assert.ok(q.success && q.cases.length === 0, "passed: off the moderators' list");
  viewerId = s.admin;
  q = await mod.readCommunityModerationAction(s.id);
  assert.ok(q.success && q.cases.length === 2, "organisers still see both");

  // Moderators never remove, block, change settings or give roles.
  viewerId = s.a;
  assert.equal((await orgMod.decideOrgReportAction(s.id, q.cases[0]!.id, "remove")).success, false);
  assert.equal((await members.saveCommunityMembersSettingsAction(s.id, { quietDays: 30, helperWord: "Guide", pauseHours: [24] })).success, false);
  assert.equal((await members.setCommunityLabelAction(s.id, s.c, "moderator", true)).success, false);
  // A label taken away ends the powers.
  viewerId = s.admin;
  await members.setCommunityLabelAction(s.id, s.a, "moderator", false);
  viewerId = s.a;
  assert.equal((await mod.readCommunityModerationAction(s.id)).success, false);
});
