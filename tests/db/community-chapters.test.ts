import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.5a (report 34.6 calls 1–4, 6–7): members propose chapters; organisers approve; a chapter is a community org linked
// to its community, reads its Code of conduct, takes only its members, and is never more public than it.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.244" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let chap: typeof import("../../src/app/actions/community-chapters");
let join: typeof import("../../src/lib/organizations/join");
let fd: typeof import("../../src/app/actions/community-front-door");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  chap = await loadAppModule(() => import("../../src/app/actions/community-chapters"));
  join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  fd = await loadAppModule(() => import("../../src/app/actions/community-front-door"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR org_settings->>'chapterOf' = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("34.6 calls 1–4: propose → approve → a chapter owned by the proposer with the co-organiser; members only join; rules are the community's", async () => {
  const [owner, a, b, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${a!}, 'member'), (${org}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()}, visibility = 'private' WHERE id = ${org}`;
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${org}, 'coc', 'Code of conduct.md', ${sql.json({ org: { lifecycle: "published", readVersion: 0 } })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${org}, ${d!.id}, 1, '## Rules\n1. Be kind\n2. No spam', 'k') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;

  viewerId = a!;
  assert.equal((await chap.proposeChapterAction(org, { name: "Bangalore", kind: "local", place: "Bengaluru", why: "Meet in person", coOrganiserId: outsider! })).success, false, "the co-organiser is a member");
  assert.ok((await chap.proposeChapterAction(org, { name: "Bangalore", kind: "local", place: "Bengaluru", why: "Meet in person", coOrganiserId: b! })).success);
  let view = await chap.readChaptersAction(org);
  assert.ok(view.success && view.proposals.length === 1 && !view.organiser);
  const proposalId = view.success ? view.proposals[0]!.id : "";
  assert.equal((await chap.decideChapterProposalAction(org, proposalId, { approve: true, reason: null })).success, false, "members don't approve");

  viewerId = owner!;
  assert.equal((await chap.decideChapterProposalAction(org, proposalId, { approve: false, reason: null })).success, false, "a decline says why");
  const made = await chap.decideChapterProposalAction(org, proposalId, { approve: true, reason: null });
  assert.ok(made.success && made.chapterId);
  const chapterId = made.success ? made.chapterId! : "";
  const roles = Object.fromEntries((await sql`SELECT user_id, role FROM workspace_members WHERE workspace_id = ${chapterId}`).map((r) => [r.user_id, r.role]));
  assert.deepEqual([roles[a!], roles[b!], roles[owner!]], ["owner", "admin", undefined], "proposer owns it, co-organiser is an admin, joining the community joined nobody");
  const [ch] = await sql`SELECT org_type, visibility, org_settings->>'chapterOf' AS parent FROM workspaces WHERE id = ${chapterId}`;
  assert.deepEqual({ ...ch }, { org_type: "community", visibility: "private", parent: org });
  assert.equal((await chap.decideChapterProposalAction(org, proposalId, { approve: true, reason: null })).success, false, "decided once");

  view = await chap.readChaptersAction(org);
  assert.ok(view.success && view.chapters.length === 1 && view.chapters[0]!.needsCoOrganiser === false && view.chapters[0]!.dormant === false);
  viewerId = a!;
  const memberView = await chap.readChaptersAction(org);
  assert.ok(memberView.success && !("dormant" in memberView.chapters[0]!), "flags are for organisers only");

  // A pause in the community holds in the chapter, even for its owner.
  const { communityPostBlock } = await loadAppModule(() => import("../../src/lib/organizations/community-server"));
  await sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{community}', coalesce(org_settings->'community', '{}'::jsonb) || jsonb_build_object('pauses', jsonb_build_object(${a!}::text, jsonb_build_object('until', ${new Date(Date.now() + 36e5).toISOString()}::text)))) WHERE id = ${org}`;
  assert.match(String(await communityPostBlock(chapterId, a!)), /paused/);
  await sql`UPDATE workspaces SET org_settings = org_settings #- '{community,pauses}' WHERE id = ${org}`;
  // Rules: the chapter reads its community's Code of conduct.
  viewerId = b!;
  const rules = await fd.readCommunityRulesAction(chapterId);
  assert.ok(rules.success && rules.rules.length === 2);

  // Joining: only community members; an outsider is refused even with the code.
  const [code] = await sql`SELECT join_code FROM workspaces WHERE id = ${chapterId}`;
  await assert.rejects(join.joinOrgByCode(outsider!, code!.join_code, null, { agreed: true, answers: {} }), /community first/);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${outsider!}, 'member')`;
  const joined = await join.joinOrgByCode(outsider!, code!.join_code, null, { agreed: true, answers: {} });
  assert.ok(joined && joined.outcome === "joined");
});

test("34.6 call 3: a chapter is never more public than its community; a community made private makes its chapters private", async () => {
  const [owner] = await Promise.all([1].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  const chapter = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(chapter);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active' WHERE id IN (${org}, ${chapter})`;
  await sql`UPDATE workspaces SET org_settings = jsonb_build_object('chapterOf', ${org}::text) WHERE id = ${chapter}`;
  const access = await loadAppModule(() => import("../../src/lib/workspaces/server/access"));
  viewerId = owner!;
  const set = async (id: string, v: "public" | "private") => {
    const pre = await access.getWorkspaceAccessTransitionPreflightAction(id, v);
    const token = pre.success ? (pre as unknown as { data?: { confirmationToken?: string }; confirmationToken?: string }).data?.confirmationToken ?? (pre as unknown as { confirmationToken?: string }).confirmationToken ?? "" : "";
    return access.updateWorkspaceVisibilityAction(id, v, token) as Promise<{ success: boolean; message?: string }>;
  };
  assert.ok((await set(org, "private")).success);
  const [c] = await sql`SELECT visibility FROM workspaces WHERE id = ${chapter}`;
  assert.equal(c!.visibility, "private", "the cap reaches the chapter");
  const up = await set(chapter, "public");
  assert.equal(up.success, false);
  assert.match(String(up.message), /Set by/);
});
