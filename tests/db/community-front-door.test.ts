import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B5.1a (report 34.2): a community's rules from its Code of conduct, agreeing to the current version (again after a
// change), Getting started, join answers and Settings → Joining.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.239" }) });

let fd: typeof import("../../src/app/actions/community-front-door");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  fd = await loadAppModule(() => import("../../src/app/actions/community-front-door"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("34.2: rules show to visitors; members agree to the current version and again after a change; Getting started; Joining", async () => {
  const [owner, member, visitor] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${owner!}, 'owner', now() - interval '1 year'), (${id}, ${member!}, 'member', now() - interval '2 days')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const { orgStarterDoc } = await import("../../src/lib/organizations/creation");
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'code-of-conduct', 'Code of conduct.md', ${sql.json({ org: { lifecycle: "published", readVersion: 0 } })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${id}, ${d!.id}, 1, ${orgStarterDoc("community", { title: "Pune Devs" })}, 'c1') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;

  // A draft Code of conduct never shows: only its published version.
  await sql`UPDATE workspace_documents SET published_version_id = NULL WHERE id = ${d!.id}`;
  viewerId = visitor!;
  assert.ok((await fd.readCommunityRulesAction(id) as { rules: unknown[] }).rules.length === 0);
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  viewerId = visitor!;
  const rules = await fd.readCommunityRulesAction(id);
  assert.ok(rules.success);
  assert.equal(rules.rules.length, 5, "visitors read the rules summary");
  assert.equal((await fd.readMyCommunityAction(id)).success, false, "visitors have no member front door");

  viewerId = member!;
  let me = await fd.readMyCommunityAction(id);
  assert.ok(me.success && me.agree && !me.agree.again, "first time: agree");
  assert.ok(me.gettingStarted && me.gettingStarted.items.length === 3);
  assert.equal((await fd.agreeToCodeAction(id)).success, true);
  me = await fd.readMyCommunityAction(id);
  assert.ok(me.success && me.agree === null);
  await sql`UPDATE workspace_documents SET settings = jsonb_set(settings, '{org,readVersion}', '1') WHERE id = ${d!.id}`;
  me = await fd.readMyCommunityAction(id);
  assert.ok(me.success && me.agree?.again, "a new version asks again");
  await fd.agreeToCodeAction(id);
  assert.equal((await fd.tickGettingStartedAction(id, "nope")).success, false);
  assert.equal((await fd.tickGettingStartedAction(id, "rules")).success, true);
  me = await fd.readMyCommunityAction(id);
  assert.ok(me.success && me.gettingStarted?.items.find((i) => i.id === "rules")?.done);

  assert.equal((await fd.saveJoiningSettingsAction(id, { agreeRequired: true, questions: [], gettingStarted: [], welcomePost: false, firstDayLimit: true })).success, false, "organisers set Joining");
  viewerId = owner!;
  assert.match((await fd.saveJoiningSettingsAction(id, { agreeRequired: true, questions: [], gettingStarted: [{ id: "x", label: "Out", href: "https://evil.example" }], welcomePost: false, firstDayLimit: true }) as { error: string }).error, /inside NetworkBase/);
  for (const href of ["//evil.example", "/\\evil.example", "?x=1\\y"]) {
    assert.equal((await fd.saveJoiningSettingsAction(id, { agreeRequired: true, questions: [], gettingStarted: [{ id: "x", label: "Out", href }], welcomePost: false, firstDayLimit: true })).success, false, href);
  }
  assert.equal((await fd.saveJoiningSettingsAction(id, { agreeRequired: true, questions: [{ id: "why", label: "What brings you here?" }], gettingStarted: [{ id: "hello", label: "Say hi", href: "/messages" }], welcomePost: false, firstDayLimit: true })).success, true);
  viewerId = member!;
  assert.equal((await fd.saveJoinAnswersAction(id, { answers: { why: "Learning Rust", other: "ignored" }, showAnswer: false })).success, true);
  const [prefs] = await sql`SELECT view_prefs->'community'->'answers' AS a FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${member!}`;
  assert.deepEqual(prefs!.a, { why: "Learning Rust" }, "only the community's questions are kept");
});
