import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step D (report §31.2, §31.6; decisions 70, 73): the organization card, its filters and its share preview.

moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }), getSession: async () => ({ data: { session: null }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.140" }) });

let discover: typeof import("../../src/lib/data/discover");
let sharing: typeof import("../../src/lib/sharing/read");
before(async () => {
  discover = await loadAppModule(() => import("../../src/lib/data/discover"));
  sharing = await loadAppModule(() => import("../../src/lib/sharing/read"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(type: string, tag: string) {
  const people = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, people[0]!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${people[0]!}, 'owner'), (${id}, ${people[1]!}, 'admin'), (${id}, ${people[2]!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = ${type}, join_code = ${generateJoinCode()}, title = ${`Org ${tag}`}, slug = ${`org-${tag}`},
    short_description = 'Learning together', visibility = 'public', created_at = now() - interval '30 days' WHERE id = ${id}`;
  created.push(id);
  return { id, member: people[2]! };
}

test("31.6, decision 70: Organization type and Verified only filter the organizations; cards carry the ✓ and You're a member", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const school = await org("education", `${tag}a`);
  const club = await org("club", `${tag}b`);
  await sql`UPDATE workspaces SET verified_at = now() WHERE id = ${school.id}`;
  const feed = async (filters: Record<string, unknown>, viewerId: string | null = null) =>
    (await discover.getDiscoverWorkspaces({ status: "all", type: "all", tech: [], sort: "newest", search: tag, show: "organizations", ...filters } as never, undefined, 60, { view: "all", viewerId })).projects;
  assert.deepEqual((await feed({})).map((p) => p.id).sort(), [school.id, club.id].sort());
  assert.deepEqual((await feed({ orgType: "club" })).map((p) => p.id), [club.id]);
  assert.deepEqual((await feed({ verified: true })).map((p) => p.id), [school.id]);
  const card = (await feed({}, school.member)).find((p) => p.id === school.id)!;
  assert.deepEqual([card.orgVerified, card.viewerIsMember], [true, true]);
  assert.equal((await feed({}, school.member)).find((p) => p.id === club.id)!.viewerIsMember, false);
});

test("31.2: an organization's share preview by state: type and tagline, Archived, Private organization, not available", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const o = await org("education", `${tag}c`);
  const url = `https://networkbase.test/org/org-${tag}c`;
  const open = await sharing.readSharePreview(url, null, "https://networkbase.test");
  assert.equal(open?.description, "Education · Learning together");
  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${o.id}`;
  assert.equal((await sharing.readSharePreview(url, null, "https://networkbase.test"))?.description, "Archived · Education · Learning together");
  await sql`UPDATE workspaces SET status = 'active', visibility = 'private' WHERE id = ${o.id}`;
  assert.equal((await sharing.readSharePreview(url, null, "https://networkbase.test"))?.title, "Private organization");
  await sql`UPDATE workspaces SET visibility = 'public', suspended_at = now() WHERE id = ${o.id}`;
  assert.equal((await sharing.readSharePreview(url, null, "https://networkbase.test"))?.description, "This organization isn’t available.");
});

test("31.2: an organization-only workspace is recognised for the not-available page; a public one isn't", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const o = await org("education", `${tag}d`);
  const owner = await sql.begin((tx) => createUser(tx));
  const [inside, open] = [await sql.begin((tx) => createProject(tx, owner, { visibility: "org" })), await sql.begin((tx) => createProject(tx, owner))];
  await sql`UPDATE workspaces SET parent_id = ${o.id}, slug = ${`inside-${tag}`} WHERE id = ${inside}`;
  await sql`UPDATE workspaces SET parent_id = ${o.id}, slug = ${`open-${tag}`} WHERE id = ${open}`;
  created.push(inside, open);
  const detail = await loadAppModule(() => import("../../src/lib/organizations/detail"));
  assert.deepEqual([await detail.isOrgOnlyWorkspace(`inside-${tag}`), await detail.isOrgOnlyWorkspace(`open-${tag}`)], [true, false]);
});
