import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.4d (report 34.5 calls 7–8): rituals post on schedule as Updates naming their host, once; a host who left pauses
// the ritual and the organisers hear.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.243" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let rit: typeof import("../../src/app/actions/community-rituals");
let server: typeof import("../../src/lib/organizations/community-server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  rit = await loadAppModule(() => import("../../src/app/actions/community-rituals"));
  server = await loadAppModule(() => import("../../src/lib/organizations/community-server"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("34.5 call 7: organisers add a ritual with a member host; it posts once as an Update naming the host; a host who left pauses it", async () => {
  const [owner, host, m] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${host!}, 'admin'), (${org}, ${m!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', time_zone = 'UTC', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  const now = new Date();
  const earlier = new Date(now.getTime() - 30 * 60_000);
  const time = `${String(earlier.getUTCHours()).padStart(2, "0")}:${String(earlier.getUTCMinutes()).padStart(2, "0")}`;
  const ritual = { id: "wins", name: "Weekly wins", kind: "thread", freq: "weekly", weekday: now.getUTCDay(), time, hostId: host!, prompt: "Share a win", leadDays: 0, paused: false };
  viewerId = m!;
  assert.equal((await rit.saveRitualAction(org, ritual)).success, false, "members don't add rituals");
  viewerId = owner!;
  const outsider = await sql.begin((tx) => createUser(tx));
  assert.equal((await rit.saveRitualAction(org, { ...ritual, hostId: outsider })).success, false, "the host is a member");
  assert.ok((await rit.saveRitualAction(org, ritual)).success);
  // As if it was set up last week, so today's occurrence is due.
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{community,rituals,0,createdAt}', to_jsonb((now() - interval '7 days')::text)) WHERE id = ${org}`;
  if (earlier.getUTCDate() !== now.getUTCDate()) return; // ponytail: the test straddles midnight UTC; skip rather than flake.

  // The job posts through runAsUser(the organiser who saved it); this suite's auth stub stands in for it.
  viewerId = owner!;
  await server.postDueRituals();
  await server.postDueRituals();
  const posts = await sql`SELECT author_id, content FROM workspace_updates WHERE workspace_id = ${org} AND content LIKE '%Weekly wins%'`;
  assert.equal(posts.length, 1, "once");
  assert.equal(posts[0]!.author_id, owner, "posted as the organiser who saved it, never as the host");
  assert.match(String(posts[0]!.content), /hosted by/);

  // The host leaves; next time it's due, the ritual pauses and the organisers hear.
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${org} AND user_id = ${host!}`;
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{community,rituals,0,lastPostedFor}', '"2000-01-01T00:00:00.000Z"') WHERE id = ${org}`;
  await server.postDueRituals();
  const [w] = await sql`SELECT org_settings->'community'->'rituals'->0->>'paused' AS paused FROM workspaces WHERE id = ${org}`;
  assert.equal(w!.paused, "true");
  const told = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${owner!} AND title LIKE 'Weekly wins is paused%'`;
  assert.equal(told[0]!.n, 1);
  viewerId = m!;
  const seen = await rit.readRitualsAction(org);
  assert.ok(seen.success && seen.rituals[0]!.paused && !seen.canEdit, "members see rituals, can't edit");
});
