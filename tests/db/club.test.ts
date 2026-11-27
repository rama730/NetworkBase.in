import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B7.1a (report 36.2): a club has the community front door; its recruiting period is officers-only, turns itself off,
// shows in Discover's Recruiting filter, and its drive counts never name anyone.
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
let club: typeof import("../../src/app/actions/club");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  fd = await loadAppModule(() => import("../../src/app/actions/community-front-door"));
  club = await loadAppModule(() => import("../../src/app/actions/club"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("36.2: club front door, recruiting period, drive counts, Discover filter", async () => {
  const join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  const [pres, coord, newbie, visitor] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, pres!, { visibility: "public" }));
  created.push(id);
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${pres!}, 'owner'), (${id}, ${coord!}, 'admin')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active', join_code = ${code}, join_code_enabled = true, title = 'WT Robotics Club' WHERE id = ${id}`;

  // The front door: a club with a published Code of conduct asks for I agree.
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'code-of-conduct', 'Code of conduct.md', ${sql.json({ org: { lifecycle: "published", readVersion: 0 } })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${id}, ${d!.id}, 1, ${"# Code of conduct\n\n## Rules\n1. Be kind\n2. Share the tools"}, 'c1') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  await assert.rejects(() => join.joinOrgByCode(newbie!, code, null, { agreed: false }), /Agree to the Code of conduct/);
  assert.equal((await join.joinOrgByCode(newbie!, code, null, { agreed: true }))?.outcome, "joined");
  viewerId = newbie!;
  const me = await fd.readMyCommunityAction(id);
  assert.ok(me.success && JSON.stringify(me).includes("Join a committee"), "club Getting started");

  // Recruiting: officers only; it shows while the dates cover today and turns itself off.
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await club.saveRecruitingAction(id, { from: today, to: later, line: "Taster night", firstEventId: null })).success, false, "members don't set it");
  viewerId = coord!;
  assert.match(String((await club.saveRecruitingAction(id, { from: later, to: today, line: "", firstEventId: null }) as { error?: string }).error), /end date/);
  assert.ok((await club.saveRecruitingAction(id, { from: today, to: later, line: "Taster night", firstEventId: null })).success);
  viewerId = visitor!;
  const seen = await club.readRecruitingAction(id);
  assert.ok(seen.success && seen.recruiting && seen.line === "Taster night" && seen.poster === null && seen.settings === null, "visitors see the banner, not the settings or poster");
  assert.equal((await club.readDriveCountsAction(id)).success, false);
  viewerId = coord!;
  const counts = await club.readDriveCountsAction(id);
  assert.ok(counts.success && counts.counts?.joined === 2, "joined during the drive (the newcomer and the coordinator, counted as numbers)");
  const poster = await club.readRecruitingAction(id);
  assert.ok(poster.success && poster.poster?.code === code);

  // Discover: Recruiting now lists the club only while recruiting.
  // The same condition src/lib/data/discover.ts adds for Recruiting now.
  const [on] = await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ${id} AND org_type = 'club'
    AND (org_settings->'club'->'recruiting'->>'from') <= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AND (org_settings->'club'->'recruiting'->>'to') >= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  assert.equal(on!.n, 1);
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{club,recruiting,to}', ${sql.json("2000-01-02")}) , updated_at = now() WHERE id = ${id}`;
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{club,recruiting,from}', ${sql.json("2000-01-01")}) WHERE id = ${id}`;
  viewerId = visitor!;
  const off = await club.readRecruitingAction(id);
  assert.ok(off.success && !off.recruiting, "it turns itself off after the end date");
});
