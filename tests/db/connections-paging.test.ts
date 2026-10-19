import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

moduleStubs.set("@/lib/redis", { redis: null, getRedisClient: () => null, getCachedData: async () => null, cacheData: async () => undefined });

moduleStubs.set("../../inngest/client", { inngest: { send: async () => ({ ids: [] }) } });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }) } });

moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true, count: 1, limit: 60, remaining: 59, resetAt: Date.now() + 60000, degraded: false }) });

let viewerId = "";
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
moduleStubs.set("next/server", { after: () => undefined, NextResponse: class {}, NextRequest: class {} });

let connections: typeof import("../../src/app/actions/connections");
before(async () => {
  connections = await loadAppModule(() => import("../../src/app/actions/connections"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function pageThrough<T extends { id: string }>(load: (cursor?: string) => Promise<{ success: boolean; items: T[]; nextCursor: string | null; error?: string }>) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await load(cursor);
    assert.equal(result.success, true, String(result.error));
    seen.push(...result.items.map((item) => item.id));
    if (!result.nextCursor) return seen;
    cursor = result.nextCursor;
  }
  throw new Error("paging did not terminate");
}

test("connection cards retain all legacy skills without overriding canonical skill privacy", async () => {
  const viewer = await sql.begin(tx => createUser(tx));
  const person = await sql.begin(tx => createUser(tx));
  viewerId = viewer;
  const labels = ['React', 'Next.js', 'TypeScript', 'Node.js', 'UX Design'];
  try {
    await sql`UPDATE profiles SET skills=${sql.json(labels)}, onboarding_status='completed' WHERE id=${person}`;
    await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${viewer},${person},'accepted')`;
    const legacy = await connections.getConnectionsFeed({tab:'network',limit:10});
    assert.equal(legacy.success, true);
    assert.deepEqual(legacy.items[0]?.otherUser.skills, labels);
    const [skill] = await sql`SELECT id,name FROM skills WHERE status='active' ORDER BY name LIMIT 1`;
    assert.ok(skill);
    await sql`INSERT INTO profile_skills(profile_id,skill_id,visibility) VALUES(${person},${skill.id},'private')`;
    const hidden = await connections.getConnectionsFeed({tab:'network',limit:10});
    assert.deepEqual(hidden.items[0]?.otherUser.skills, []);
    await sql`UPDATE profile_skills SET visibility='public' WHERE profile_id=${person}`;
    const canonical = await connections.getConnectionsFeed({tab:'network',limit:10});
    assert.deepEqual(canonical.items[0]?.otherUser.skills, [skill.name]);
  } finally {
    await sql`DELETE FROM connections WHERE requester_id=${viewer} OR addressee_id=${viewer}`;
    await sql`DELETE FROM auth.users WHERE id=ANY(${[viewer,person]}::uuid[])`;
  }
});

// COR-030: the cursor must describe the query's own order.
test("Discover shared summary deduplicates live accepted peers and excludes hidden, deleted and unrelated people", async () => {
  const viewer = await sql.begin(tx => createUser(tx));
  viewerId = viewer;
  const created = [viewer];
  try {
    const targets: string[] = [];
    const peers: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = await sql.begin(tx => createUser(tx)); created.push(id);
      await sql`UPDATE profiles SET onboarding_status='completed', full_name=${`Peer ${String(i).padStart(2, '0')}`} WHERE id=${id}`;
      (i < 3 ? targets : peers).push(id);
    }
    for (const target of targets.slice(0, 2)) {
      await sql`INSERT INTO connection_suggestions(user_id,suggested_user_id,score) VALUES(${viewer},${target},10)`;
    }
    for (let i = 0; i < peers.length; i++) {
      const peer = peers[i]!;
      const status = i === 9 ? 'pending' : i === 10 ? 'blocked' : 'accepted';
      await sql`INSERT INTO connections(requester_id,addressee_id,status,blocked_by,blocked_at) VALUES(${i % 2 ? peer : viewer},${i % 2 ? viewer : peer},${status},${i === 10 ? viewer : null},${i === 10 ? new Date() : null})`;
      await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${peer},${i === 11 ? targets[2]! : targets[0]!},'accepted')`;
    }
    await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${targets[1]!},${peers[0]!},'accepted')`;
    await sql`UPDATE profiles SET visibility='connections' WHERE id=${peers[0]!}`;
    await sql`UPDATE profiles SET visibility='private' WHERE id=${peers[6]!}`;
    await sql`UPDATE profiles SET deleted_at=now() WHERE id=${peers[7]!}`;
    await sql`UPDATE profiles SET onboarding_status='in_progress' WHERE id=${peers[8]!}`;
    const input = { tab: 'discover' as const, limit: 3, includeMeta: false, filters: { openProfilesOnly: true } };
    const plain = await connections.getConnectionsFeed(input);
    assert.equal(plain.sharedConnections, undefined);
    const result = await connections.getConnectionsFeed({ ...input, includeSharedConnections: true });
    assert.equal(result.success, true);
    assert.deepEqual(new Set(result.sharedConnections?.targetIds), new Set(targets.slice(0, 2)));
    assert.equal(result.sharedConnections?.total, 6);
    const disclosure = await connections.readPersonSharedConnectionsAction({ targetId: targets[0]! });
    assert.equal(disclosure.success, true);
    assert.equal(disclosure.summary?.total, 6);
    assert.equal(disclosure.summary?.people.length, 6);
    const changedPage = await connections.readPersonSharedConnectionsAction({ targetId: targets[0]!, offset: 20 });
    assert.equal(changedPage.success, false);

    assert.deepEqual(result.sharedConnections?.people.map(person => person.id), peers.slice(0, 4));
    assert.equal(result.sharedConnections?.people.length, 4);
    await sql`UPDATE connections SET status='blocked',blocked_by=${viewer},blocked_at=now() WHERE requester_id=${viewer} AND addressee_id=${peers[0]!}`;
    await sql`UPDATE profiles SET deleted_at=now() WHERE id=${peers[1]!}`;
    const updated = await connections.getConnectionsFeed({ ...input, includeSharedConnections: true });
    assert.equal(updated.sharedConnections?.total, 4);
    assert.deepEqual(updated.sharedConnections?.people.map(person => person.id), peers.slice(2, 6));
    await sql`UPDATE connections SET status='rejected' WHERE requester_id=ANY(${targets.slice(0, 2)}::uuid[]) OR addressee_id=ANY(${targets.slice(0, 2)}::uuid[])`;
    const empty = await connections.getConnectionsFeed({ ...input, includeSharedConnections: true });
    assert.equal(empty.sharedConnections?.total, 0);
    assert.deepEqual(empty.sharedConnections?.people, []);
    const additional = await sql.begin(tx => createUser(tx)); created.push(additional);
    await sql`UPDATE connections SET status='rejected' WHERE requester_id=${peers[11]!} AND addressee_id=${targets[2]!}`;
    await sql`UPDATE profiles SET onboarding_status='completed' WHERE id=${additional}`;
    await sql`INSERT INTO connection_suggestions(user_id,suggested_user_id,score) VALUES(${viewer},${targets[2]!},10),(${viewer},${additional},0)`;
    await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${peers[2]!},${additional},'accepted')`;
    const expanded = await connections.getConnectionsFeed({ ...input, limit: 7, includeSharedConnections: true });
    assert.equal(expanded.items.length, 4);
    assert.equal(expanded.sharedConnections?.targetIds.length, 3);
    assert.equal(expanded.sharedConnections?.total, 0, 'Compact suggestions must not affect mutual counts for the three cards');
  } finally {
    await sql`DELETE FROM connections WHERE requester_id=ANY(${created}::uuid[]) OR addressee_id=ANY(${created}::uuid[])`;
    await sql`DELETE FROM auth.users WHERE id=ANY(${created}::uuid[])`;
  }
});

test("incoming requests page in the chosen direction without gaps or repeats", async () => {
  const viewer = await sql.begin((tx) => createUser(tx));
  viewerId = viewer;
  const others: string[] = [];
  try {
    const requestIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const other = await sql.begin((tx) => createUser(tx));
      others.push(other);
      const [row] = await sql`INSERT INTO connections (requester_id, addressee_id, status, created_at) VALUES (${other}, ${viewer}, 'pending', ${new Date(Date.UTC(2026, 0, 1, 0, i))}) RETURNING id`;
      requestIds.push(row!.id as string);
    }
    for (const sort of ["oldest", "recent", "mutual"] as const) {
      const seen = await pageThrough((cursor) => connections.getConnectionsFeed({ tab: "requests_incoming", limit: 2, cursor, requestSortBy: sort }) as never);
      const expected = sort === "oldest" ? requestIds : [...requestIds].reverse(); // no mutuals: mutual falls back to newest first
      assert.deepEqual(seen, expected, sort);
    }
  } finally {
    await sql`DELETE FROM connections WHERE addressee_id = ${viewer}`;
    await sql`DELETE FROM auth.users WHERE id = ANY(${others}::uuid[])`;
  }
});

test("discovery text search pages by relevance, then recency, with no gaps or repeats", async () => {
  const viewer = await sql.begin((tx) => createUser(tx));
  viewerId = viewer;
  const ids: string[] = [];
  try {
    const person = async (username: string, fullName: string, minutes: number) => {
      const id = await sql.begin((tx) => createUser(tx));
      ids.push(id);
      await sql`UPDATE profiles SET username = ${username}, full_name = ${fullName}, onboarding_status = 'completed', updated_at = ${new Date(Date.UTC(2026, 0, 1, 0, minutes))} WHERE id = ${id}`;
      return id;
    };
    // Relevance buckets for "zoe": username match 100, username prefix 80, otherwise 10.
    const exact = await person("zoe", "Someone Else", 1);
    const prefixOld = await person("zoealpha", "Alpha One", 2);
    const prefixNew = await person("zoebeta", "Beta Two", 9);
    const lowOld = await person("lowgamma", "Dr Zoe Gamma", 3);
    const lowNew = await person("lowdelta", "Dr Zoe Delta", 8);
    const seen = await pageThrough((cursor) => connections.getConnectionsFeed({ tab: "discover", limit: 2, search: "zoe", cursor }) as never);
    assert.deepEqual(seen, [exact, prefixNew, prefixOld, lowNew, lowOld]);
  } finally {
    await sql`DELETE FROM auth.users WHERE id = ANY(${ids}::uuid[])`;
  }
});

test("pausing collaboration removes role recommendation boosts immediately, with consistent paging", async () => {
  const viewer = await sql.begin(tx => createUser(tx));
  viewerId = viewer;
  const active = await sql.begin(tx => createUser(tx));
  const generic = await sql.begin(tx => createUser(tx));
  try {
    await sql`UPDATE profiles SET onboarding_status='completed', open_to_collaborate=true WHERE id=${active}`;
    await sql`UPDATE profiles SET onboarding_status='completed' WHERE id=${generic}`;
    await sql`INSERT INTO connection_suggestions (user_id,suggested_user_id,score,reason,mutual_connections_count)
      VALUES (${viewer},${active},60,'Matches your open role: Developer',1),(${viewer},${generic},20,'Skills overlap: Rust',1)`;
    const before = await connections.getConnectionsFeed({tab:'discover',limit:1});
    assert.equal(before.success,true);
    assert.equal(before.items[0]?.id,active);
    await sql`UPDATE profiles SET open_to_collaborate=false WHERE id=${active}`;
    const afterPause = await connections.getConnectionsFeed({tab:'discover',limit:1});
    assert.equal(afterPause.success,true);
    assert.equal(afterPause.items[0]?.id,generic);
    assert.ok(afterPause.nextCursor);
    const next = await connections.getConnectionsFeed({tab:'discover',limit:1,cursor:afterPause.nextCursor!});
    assert.equal(next.items[0]?.id,active);
    assert.doesNotMatch((next.items[0] as {recommendationReason?:string}).recommendationReason || '',/open role/);
  } finally {
    await sql`DELETE FROM auth.users WHERE id IN (${viewer},${active},${generic})`;
  }
});
