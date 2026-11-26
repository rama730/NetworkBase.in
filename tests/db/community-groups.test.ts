import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.5b (report 34.6 calls 8–9): small groups — private workspaces listed to the community; Open, Ask, Invite only; a cap.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.245" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let groups: typeof import("../../src/app/actions/community-groups");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  groups = await loadAppModule(() => import("../../src/app/actions/community-groups"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR org_settings->>'groupOf' = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("34.6 calls 8–9: a group is a private workspace listed by name and size; Open under the cap; Ask goes to the hosts; organisers never read it", async () => {
  const [owner, host, a, b, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${host!}, 'member'), (${org}, ${a!}, 'member'), (${org}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;

  viewerId = host!;
  const open = await groups.startGroupAction(org, { title: "Rustlings study group", kind: "study", purpose: "Work through rustlings", meets: "Tuesdays 20:00", cap: 2, join: "open", chapterId: null });
  assert.ok(open.success, JSON.stringify(open));
  const ask = await groups.startGroupAction(org, { title: "Founders circle", kind: "accountability", purpose: "", meets: "Fridays", cap: 8, join: "ask", chapterId: null });
  const invite = await groups.startGroupAction(org, { title: "Core team", kind: "other", purpose: "", meets: "", cap: 5, join: "invite", chapterId: null });
  assert.ok(ask.success && invite.success);
  const [w] = await sql`SELECT visibility, parent_id, kind FROM workspaces WHERE id = ${open.success ? open.id : ""}`;
  assert.deepEqual({ ...w }, { visibility: "private", parent_id: null, kind: "workspace" }, "private, and not a child the organisers inherit");

  viewerId = a!;
  let list = await groups.readGroupsAction(org);
  assert.ok(list.success && list.groups.length === 3);
  assert.equal(JSON.stringify(list).includes("requests\":[\""), false, "only hosts see requests");
  assert.deepEqual((await groups.joinGroupAction(org, open.success ? open.id : "")), { success: true, outcome: "joined" });
  viewerId = b!;
  const full = await groups.joinGroupAction(org, open.success ? open.id : "");
  assert.equal(full.success, false, "cap 2: host + a");
  assert.deepEqual(await groups.joinGroupAction(org, ask.success ? ask.id : ""), { success: true, outcome: "asked" });
  assert.equal((await groups.joinGroupAction(org, invite.success ? invite.id : "")).success, false, "invite only");
  viewerId = outsider!;
  assert.equal((await groups.joinGroupAction(org, open.success ? open.id : "")).success, false, "not in the community");

  viewerId = a!;
  assert.equal((await groups.answerGroupRequestAction(org, ask.success ? ask.id : "", b!, true)).success, false, "only hosts answer");
  viewerId = host!;
  list = await groups.readGroupsAction(org);
  assert.ok(list.success && list.groups.find((g) => g.title === "Founders circle")!.requests.includes(b!));
  assert.ok((await groups.answerGroupRequestAction(org, ask.success ? ask.id : "", b!, true)).success);
  const [m] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${ask.success ? ask.id : ""} AND user_id = ${b!}`;
  assert.equal(m!.role, "member");

  // The community's owner sees the groups listed but isn't in them, so can't read their content.
  const access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  const ownerAccess = await access.getWorkspaceAccessById(open.success ? open.id : "", owner!);
  assert.equal(ownerAccess.canRead, false);
});

test("34.6 call 10: a group poll — members tick (several times each), counts, the starter or a host picks and it closes; outsiders can't see it", async () => {
  const [owner, host, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${host!}, 'member'), (${org}, ${a!}, 'member'), (${org}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  viewerId = host!;
  const g = await groups.startGroupAction(org, { title: "Book club", kind: "book", purpose: "", meets: "monthly", cap: 12, join: "open", chapterId: null });
  assert.ok(g.success);
  const gid = g.success ? g.id : "";
  viewerId = a!;
  await groups.joinGroupAction(org, gid);
  assert.ok((await groups.createGroupPollAction(gid, { question: "When should we meet?", kind: "times", options: ["Tue 20:00", "Wed 19:00", "Sat 11:00"], closesAt: new Date(Date.now() + 864e5).toISOString() })).success);
  let view = await groups.readGroupPollsAction(gid);
  assert.ok(view.success && view.isGroup);
  const pollId = view.success ? view.polls[0]!.id : "";
  for (const o of [0, 2]) await groups.voteGroupPollAction(gid, pollId, o, true);
  viewerId = host!;
  await groups.voteGroupPollAction(gid, pollId, 0, true);
  view = await groups.readGroupPollsAction(gid);
  assert.ok(view.success);
  assert.deepEqual(view.polls[0]!.options.map((o) => o.count), [2, 0, 1]);
  viewerId = b!;
  assert.equal((await groups.readGroupPollsAction(gid)).success, false, "not in the group");
  assert.equal((await groups.voteGroupPollAction(gid, pollId, 1, true)).success, false);
  viewerId = host!;
  assert.ok((await groups.pickGroupPollAction(gid, pollId, 0)).success);
  viewerId = a!;
  assert.equal((await groups.voteGroupPollAction(gid, pollId, 1, true)).success, false, "picked: closed");
  view = await groups.readGroupPollsAction(gid);
  assert.ok(view.success && view.polls[0]!.picked === 0 && !view.polls[0]!.open);
  // Security review: an Ask from someone who then left the community can't be accepted.
  viewerId = host!;
  const askG = await groups.startGroupAction(org, { title: "Circle", kind: "accountability", purpose: "", meets: "", cap: 6, join: "ask", chapterId: null });
  assert.ok(askG.success);
  viewerId = b!;
  await groups.joinGroupAction(org, askG.success ? askG.id : "");
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${org} AND user_id = ${b!}`;
  viewerId = host!;
  assert.equal((await groups.answerGroupRequestAction(org, askG.success ? askG.id : "", b!, true)).success, false);
});
