import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  closeAppDb,
  createProject,
  createUser,
  loadAppModule,
  moduleStubs,
  sql,
} from "./_helpers";
moduleStubs.set("@/lib/redis", {
  redis: null,
  getRedisClient: () => null,
  getCachedData: async () => null,
  cacheData: async () => undefined,
});
moduleStubs.set("@/inngest/client", {
  inngest: { send: async () => ({ ids: [] }) },
});
moduleStubs.set("../../inngest/client", {
  inngest: { send: async () => ({ ids: [] }) },
});
moduleStubs.set("@/lib/security/rate-limit", {
  consumeRateLimit: async () => ({ allowed: true }),
});
let viewerId: string | null = null;
moduleStubs.set("@/lib/supabase/auth-user", {
  getAuthUser: async () => (viewerId ? { id: viewerId } : null),
});
moduleStubs.set("next/server", {
  after: () => undefined,
  NextResponse: class {},
  NextRequest: class {},
});
let connections: typeof import("../../src/app/actions/connections");
let invitations: typeof import("../../src/app/actions/network-invitations");
before(async () => {
  connections = await loadAppModule(
    () => import("../../src/app/actions/connections"),
  );
  invitations = await loadAppModule(
    () => import("../../src/app/actions/network-invitations"),
  );
});
after(async () => {
  await sql.end();
  await closeAppDb();
});
async function user(ids: string[]) {
  const id = await sql.begin((tx) => createUser(tx));
  ids.push(id);
  await sql`UPDATE profiles SET onboarding_status='completed' WHERE id=${id}`;
  return id;
}
async function cleanup(ids: string[]) {
  await sql`DELETE FROM connections WHERE requester_id=ANY(${ids}::uuid[]) OR addressee_id=ANY(${ids}::uuid[])`;
  await sql`DELETE FROM auth.users WHERE id=ANY(${ids}::uuid[])`;
}

test("Network filters before pagination using public canonical or legacy skills, literal location and saved availability", async () => {
  const ids: string[] = [];
  try {
    const viewer = await user(ids);
    viewerId = viewer;
    const matches: string[] = [];
    for (let i = 0; i < 6; i++) {
      const target = await user(ids);
      await sql`UPDATE profiles SET full_name=${`Browse ${i}`},skills=${sql.json(["React.js"])},location=${i % 2 ? "Porto" : "100%_City"},open_to_collaborate=${i % 2 === 0} WHERE id=${target}`;
      await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${viewer},${target},'accepted')`;
      if (i % 2 === 0) matches.push(target);
    }
    const input = {
      tab: "network" as const,
      limit: 1,
      sortBy: "name" as const,
      filters: {
        skills: ["React"],
        location: "100%_",
        openToCollaborate: true,
      },
    };
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await connections.getConnectionsFeed({ ...input, cursor });
      assert.equal(result.success, true, JSON.stringify(result));
      seen.push(...result.items.map((item) => item.otherUser.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(seen, matches);
    const [skill] =
      await sql`SELECT id,name FROM skills WHERE status='active' ORDER BY name LIMIT 1`;
    await sql`INSERT INTO profile_skills(profile_id,skill_id,visibility) VALUES(${matches[0]!},${skill!.id},'private')`;
    const hidden = await connections.getConnectionsFeed({
      ...input,
      limit: 10,
    });
    assert.equal(
      hidden.items.some((item) => item.otherUser.id === matches[0]),
      false,
      "private canonical assignment prevents legacy fallback",
    );
    await sql`UPDATE profile_skills SET visibility='public' WHERE profile_id=${matches[0]!}`;
    const canonical = await connections.getConnectionsFeed({
      tab: "network",
      limit: 10,
      filters: { skills: [skill!.name as string] },
    });
    assert.equal(canonical.success, true);
    assert.deepEqual(
      canonical.items.map((item) => item.otherUser.id),
      [matches[0]],
    );
  } finally {
    await cleanup(ids);
  }
});

test("Suggested shared filter uses live visible relationships instead of stale recommendation counts", async () => {
  const ids: string[] = [];
  try {
    const viewer = await user(ids);
    viewerId = viewer;
    const target = await user(ids),
      stale = await user(ids),
      peer = await user(ids);
    await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${viewer},${peer},'accepted'),(${peer},${target},'accepted')`;
    await sql`INSERT INTO connection_suggestions(user_id,suggested_user_id,score,mutual_connections_count) VALUES(${viewer},${stale},100,99),(${viewer},${target},1,0)`;
    const result = await connections.getConnectionsFeed({
      tab: "discover",
      limit: 1,
      filters: { hasMutuals: true },
    });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.deepEqual(
      result.items.map((item) => item.id),
      [target],
    );
    await sql`UPDATE profiles SET visibility='private' WHERE id=${peer}`;
    const hidden = await connections.getConnectionsFeed({
      tab: "discover",
      limit: 10,
      filters: { hasMutuals: true },
    });
    assert.equal(hidden.success, true);
    assert.equal(hidden.items.length, 0);
  } finally {
    await cleanup(ids);
  }
});

test("Invitation browse searches beyond fifty rows, pages all sources in both directions, and excludes unavailable requests", async () => {
  const ids: string[] = [];
  const projects: string[] = [];
  try {
    const viewer = await user(ids);
    viewerId = viewer;
    const stamp = "2026-01-01T00:00:00.123456Z";
    const connectionIds: string[] = [];
    for (let i = 0; i < 54; i++) {
      const actor = await user(ids);
      await sql`UPDATE profiles SET full_name=${i === 53 ? "Needle outside initial page" : `Invitation ${i}`} WHERE id=${actor}`;
      const [row] =
        await sql`INSERT INTO connections(requester_id,addressee_id,status,created_at) VALUES(${i % 2 ? actor : viewer},${i % 2 ? viewer : actor},'pending',${stamp}) RETURNING id`;
      connectionIds.push(row!.id as string);
    }
    const actor = await user(ids);
    const project = await sql.begin((tx) => createProject(tx, viewer));
    projects.push(project);
    const [invite] =
      await sql`INSERT INTO project_invitations(project_id,inviter_id,candidate_id,kind,role_title,project_title,expires_at,created_at) VALUES(${project},${viewer},${actor},'ordinary_role','Designer','Snapshot',now()+interval '1 day',${stamp}) RETURNING id`;
    const [application] =
      await sql`INSERT INTO role_applications(project_id,applicant_id,creator_id,status,message,created_at) VALUES(${project},${actor},${viewer},'pending','Application note',${stamp}) RETURNING id`;
    // Expired invitations and unrelated project managers must not be visible.
    await sql`INSERT INTO project_invitations(project_id,inviter_id,candidate_id,kind,role_title,project_title,expires_at) VALUES(${project},${viewer},${ids[1]!},'ordinary_role','Expired','Snapshot',now()-interval '1 day')`;
    const alien = await sql.begin((tx) => createProject(tx, actor));
    projects.push(alien);
    await sql`INSERT INTO role_applications(project_id,applicant_id,creator_id,status) VALUES(${alien},${ids[2]!},${viewer},'pending')`;
    const expected = new Set([
      ...connectionIds,
      invite!.id as string,
      application!.id as string,
    ]);
    for (const sort of ["recent", "oldest"] as const) {
      let cursor: string | undefined;
      const seen: string[] = [];
      do {
        const result = await invitations.readNetworkInvitationsAction({
          sort,
          limit: 7,
          cursor,
        });
        assert.equal(result.success, true, JSON.stringify(result));
        if (!result.success) throw new Error(result.error);
        assert.equal(result.total, 56);
        seen.push(...result.items.map((item) => item.id));
        cursor = result.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(seen.length, 56);
      assert.deepEqual(new Set(seen), expected);
    }
    const search = await invitations.readNetworkInvitationsAction({
      q: "Needle outside",
      limit: 1,
    });
    assert.equal(search.success, true);
    if (!search.success) throw new Error(search.error);
    assert.equal(search.total, 1);
    assert.equal(
      search.items[0]?.person.fullName,
      "Needle outside initial page",
    );
    const sent = await invitations.readNetworkInvitationsAction({
      direction: "sent",
      kind: "connections",
      limit: 60,
    });
    assert.equal(sent.success, true);
    if (!sent.success) throw new Error(sent.error);
    assert.equal(sent.total, 27);
    const received = await invitations.readNetworkInvitationsAction({
      direction: "received",
      kind: "projects",
      limit: 1,
    });
    assert.equal(received.success, true);
    if (!received.success) throw new Error(received.error);
    assert.equal(received.total, 1);
    assert.equal(received.items[0]?.note, "Application note");
    await sql`UPDATE connections SET status='blocked',blocked_by=${viewer},blocked_at=now() WHERE id=${connectionIds[0]!}`;
    await sql`UPDATE profiles SET deleted_at=now() WHERE id=${ids[2]!}`;
    const changed = await invitations.readNetworkInvitationsAction({
      limit: 60,
    });
    assert.equal(changed.success, true);
    if (changed.success) assert.equal(changed.total, 54);
    await sql`UPDATE profiles SET visibility='private',headline='Secret hidden headline',location='Secret hidden location',skills=${sql.json(['Secret skill'])},open_to_collaborate=true WHERE id=${actor}`;
    const privateSearch = await invitations.readNetworkInvitationsAction({q:'Secret hidden'});
    assert.equal(privateSearch.success,true);
    if(privateSearch.success)assert.equal(privateSearch.total,0);
    const locked = await invitations.readNetworkInvitationsAction({kind:'projects'});
    assert.equal(locked.success,true);
    if(locked.success){
      assert.equal(locked.items.length,2);
      for(const item of locked.items){
        assert.equal(item.person.headline,undefined);
        assert.equal(item.person.location,undefined);
        assert.equal(item.person.isLockedProfile,true);
        assert.equal(item.person.openToCollaborate,undefined);
      }
    }
    await sql`INSERT INTO connections(requester_id,addressee_id,status,blocked_by,blocked_at) VALUES(${viewer},${actor},'blocked',${viewer},now())`;
    const blocked = await invitations.readNetworkInvitationsAction({kind:'projects'});
    assert.equal(blocked.success,true);
    if(blocked.success)assert.equal(blocked.items.length,0);
    const invalid = await invitations.readNetworkInvitationsAction({
      cursor: "garbage",
    });
    assert.equal(invalid.success, false);
    viewerId = null;
    assert.equal(
      (await invitations.readNetworkInvitationsAction()).success,
      false,
    );
  } finally {
    for (const project of projects)
      await sql`DELETE FROM projects WHERE id=${project}`;
    await cleanup(ids);
  }
});

test("Recently connected cursor preserves sub-millisecond acceptance ties", async () => {
  const ids: string[] = [];
  try {
    const viewer = await user(ids);
    viewerId = viewer;
    const targets: string[] = [];
    for (let i = 0; i < 5; i++) targets.push(await user(ids));
    await sql.begin(async (tx) => {
      for (const target of targets)
        await tx`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${viewer},${target},'accepted')`;
    });
    for (const sortBy of ["recent", "oldest"] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await connections.getConnectionsFeed({
          tab: "network",
          sortBy,
          limit: 1,
          cursor,
        });
        assert.equal(result.success, true, JSON.stringify(result));
        seen.push(...result.items.map((item) => item.otherUser.id));
        cursor = result.nextCursor ?? undefined;
      } while (cursor);
      assert.equal(seen.length, 5);
      assert.deepEqual(new Set(seen), new Set(targets));
    }
  } finally {
    await cleanup(ids);
  }
});
