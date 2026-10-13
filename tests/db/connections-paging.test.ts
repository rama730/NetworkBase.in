import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

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

// COR-030: the cursor must describe the query's own order.
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
