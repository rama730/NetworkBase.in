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

test("34.2 calls 1–2 (B5.1b): joining a community needs I agree; approval needs the join answers, which reach organisers", async () => {
  const join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  const [owner, a, b] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(id);
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${code}, join_code_enabled = true,
    org_settings = ${sql.json({ community: { agreeRequired: true, questions: [{ id: "why", label: "What brings you here?" }], gettingStarted: [], welcomePost: false, firstDayLimit: true } })} WHERE id = ${id}`;
  await assert.rejects(() => join.joinOrgByCode(a!, code, null, { agreed: false }), /Agree to the Code of conduct/);
  const joined = await join.joinOrgByCode(a!, code, null, { agreed: true, answers: { why: "Rust meetups" } });
  assert.equal(joined?.outcome, "joined");
  const [m] = await sql`SELECT view_prefs->'community' AS c FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${a!}`;
  assert.equal((m!.c as { answers: Record<string, string> }).answers.why, "Rust meetups");
  assert.ok((m!.c as { agreed: { at: string } }).agreed.at, "the agreement is kept with its date");

  await sql`UPDATE workspaces SET org_settings = org_settings || '{"joinMode":"approval"}'::jsonb WHERE id = ${id}`;
  await assert.rejects(() => join.joinOrgByCode(b!, code, null, { agreed: true }), /Answer the join questions/);
  const asked = await join.joinOrgByCode(b!, code, "Hi", { agreed: true, answers: { why: "Learning Go" } });
  assert.equal(asked?.outcome, "requested");
  const [req] = await sql`SELECT message FROM role_applications WHERE workspace_id = ${id} AND applicant_id = ${b!}`;
  assert.match(String(req!.message), /What brings you here\? Learning Go/);
});

test("34.2 call 4 (B5.1c): a member behind the current Code of conduct reads on but can't post until they agree", async () => {
  const { communityPostBlock } = await loadAppModule(() => import("../../src/lib/organizations/community-server"));
  const [owner, m] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, view_prefs) VALUES (${id}, ${owner!}, 'owner', '{}'::jsonb), (${id}, ${m!}, 'member', ${sql.json({ community: { agreed: { version: 0, at: "2026-11-01T00:00:00Z" } } })})`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'coc', 'Code of conduct.md', ${sql.json({ org: { lifecycle: "published", readVersion: 0 } })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${id}, ${d!.id}, 1, '## Rules\n1. Be kind', 'k') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  assert.equal(await communityPostBlock(id, m!), null);
  await sql`UPDATE workspace_documents SET settings = jsonb_set(settings, '{org,readVersion}', '1') WHERE id = ${d!.id}`;
  assert.match(String(await communityPostBlock(id, m!)), /Agree to the Code of conduct/);
  // Organisers set the rules: the owner (never agreed) and an admin post without agreeing and aren't asked to.
  assert.equal(await communityPostBlock(id, owner!), null);
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${id} AND user_id = ${m!}`;
  assert.equal(await communityPostBlock(id, m!), null);
  viewerId = m!;
  const me = await fd.readMyCommunityAction(id);
  assert.ok(me.success && me.agree === null, "an admin isn't asked to agree");
});

test("34.5 + B5.1 live check: the wizard's starter doc in a community is the Code of conduct the front door reads", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "public" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${owner}, 'owner', now())`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const { orgStarterDoc } = await import("../../src/lib/organizations/creation");
  const doc = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
  viewerId = owner;
  const applied = await doc.applyCreationIntentAction(id, { mode: "starter", starterContent: orgStarterDoc("community", { title: "Pune Devs" }), publishOnCreate: false, includeRoles: true });
  assert.ok(applied.success, JSON.stringify(applied));
  const [d] = await sql`SELECT id, filename, published_version_id FROM workspace_documents WHERE workspace_id = ${id}`;
  assert.equal(d!.filename, "Code of conduct.md", "named for the type, not README.md");
  assert.equal((await fd.readCommunityRulesAction(id) as { rules: unknown[] }).rules.length, 0, "a draft shows no rules");
  await sql`UPDATE workspace_documents SET published_version_id = (SELECT id FROM workspace_document_versions WHERE doc_id = ${d!.id}) WHERE id = ${d!.id}`;
  assert.equal((await fd.readCommunityRulesAction(id) as { rules: unknown[] }).rules.length, 5, "published: the five starter rules");
});
