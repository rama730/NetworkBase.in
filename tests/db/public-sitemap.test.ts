import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Search + AI findability (Task 6): the sitemap lists home and every indexable workspace and profile, nothing else.
let sitemap: typeof import("../../src/app/sitemap").default;
const workspaceIds: string[] = [];
const userIds: string[] = [];
before(async () => {
  sitemap = (await loadAppModule(() => import("../../src/app/sitemap"))).default;
});
after(async () => {
  try {
    for (const id of workspaceIds.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
    for (const id of userIds) await sql`DELETE FROM profiles WHERE id = ${id}`;
  } finally {
    await sql.end();
    await closeAppDb();
  }
});

const slugOf = async (id: string) => (await sql`SELECT slug FROM workspaces WHERE id = ${id}`)[0]!.slug as string;
const usernameOf = async (id: string) => (await sql`SELECT username FROM profiles WHERE id = ${id}`)[0]!.username as string;

test("home, public workspaces and public profiles are listed; hidden ones are not", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  userIds.push(owner);
  const ws = async (opts: { visibility?: string; status?: string } = {}, extra?: (id: string) => Promise<unknown>) => {
    const id = await sql.begin((tx) => createProject(tx, owner, opts));
    workspaceIds.push(id);
    await extra?.(id);
    return slugOf(id);
  };
  const shown = await ws();
  const completed = await ws({ status: "completed" });
  const hidden = [
    await ws({ visibility: "private" }),
    await ws({ visibility: "unlisted" }),
    await ws({ status: "draft" }),
    await ws({}, (id) => sql`UPDATE workspaces SET discover_hidden_at = now() WHERE id = ${id}`),
    await ws({}, (id) => sql`UPDATE workspaces SET suspended_at = now() WHERE id = ${id}`),
    await ws({}, (id) => sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${id}`),
  ];
  const orgId = randomUUID();
  await sql`INSERT INTO workspaces (id, owner_id, title, slug, visibility, status, kind, suspended_at)
    VALUES (${orgId}, ${owner}, 'Suspended org', ${`o-${orgId}`}, 'public', 'active', 'organization', now())`;
  workspaceIds.push(orgId);
  hidden.push(await ws({}, (id) => sql`UPDATE workspaces SET parent_id = ${orgId} WHERE id = ${id}`));

  const [pub, priv, conn, gone] = await sql.begin(async (tx) => [
    await createUser(tx), await createUser(tx, { visibility: "private" }), await createUser(tx, { visibility: "connections" }), await createUser(tx),
  ]);
  userIds.push(pub!, priv!, conn!, gone!);
  await sql`UPDATE profiles SET deleted_at = now() WHERE id = ${gone!}`;

  const urls = (await sitemap()).map((entry) => entry.url);
  assert.ok(urls.includes("https://networkbase.in/"));
  for (const slug of [shown, completed]) assert.ok(urls.includes(`https://networkbase.in/workspaces/${slug}`), slug);
  for (const slug of hidden) assert.equal(urls.includes(`https://networkbase.in/workspaces/${slug}`), false, slug);
  assert.ok(urls.includes(`https://networkbase.in/u/${await usernameOf(pub!)}`));
  for (const id of [priv!, conn!, gone!]) assert.equal(urls.includes(`https://networkbase.in/u/${await usernameOf(id)}`), false, id);
  assert.equal(new Set(urls).size, urls.length);
});
