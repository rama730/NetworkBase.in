import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B4.1c (report 33.2 calls 5, 7): Values and Offices (members-only unless shown to visitors); Our teams for people inside.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.234" }) });

let company: typeof import("../../src/app/actions/company");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  company = await loadAppModule(() => import("../../src/app/actions/company"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("33.2: Values and Offices go to visitors only when switched on; Our teams is for people inside, private teams only for their members", async () => {
  const [owner, member, visitor] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const sales = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  const secret = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  await sql`UPDATE workspaces SET parent_id = ${id}, description = 'We sell' WHERE id IN (${sales}, ${secret})`;
  await sql`UPDATE workspaces SET title = 'Sales' WHERE id = ${sales}`;

  viewerId = member!;
  assert.equal((await company.saveCompanyAboutAction(id, { values: [], offices: [], publicValues: false, publicOffices: false })).success, false, "admins edit");
  viewerId = owner!;
  assert.match((await company.saveCompanyAboutAction(id, { values: [], offices: [{ name: "HQ", city: "Pune", zone: "Mars/Base" }], publicValues: false, publicOffices: false }) as { error: string }).error, /time zone/);
  assert.equal((await company.saveCompanyAboutAction(id, { values: [{ name: "Candour", line: "Say it kindly" }], offices: [{ name: "HQ", city: "Pune", zone: "Asia/Kolkata" }], publicValues: true, publicOffices: false })).success, true);

  viewerId = visitor!;
  const seen = await company.readCompanyAboutAction(id);
  assert.ok(seen.success);
  assert.deepEqual([seen.values.length, seen.offices.length, seen.teams.length], [1, 0, 0], "visitors: only what's switched on, and no teams");
  viewerId = member!;
  const inside = await company.readCompanyAboutAction(id);
  assert.ok(inside.success);
  assert.deepEqual([inside.offices.length, inside.teams.map((t) => t.title)], [1, ["Sales"]], "a private team stays with its members");
  assert.equal(inside.teams[0]!.line, "We sell");
  viewerId = owner!;
  const admin = await company.readCompanyAboutAction(id);
  assert.ok(admin.success);
  assert.equal(admin.teams.length, 2);
});

test("33.2: What's new holds the last 7 days' announcements and published pages (not the live pin); Needs review groups late pages by owner for admins", async () => {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(id);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const post = (content: string, extra: { pinned?: boolean; old?: boolean; audience?: object } = {}) => sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, is_pinned, audience, created_at)
    VALUES (${id}, ${owner!}, ${content}, 'announcement', ${extra.pinned ?? false}, ${sql.json((extra.audience ?? {}) as never)}, ${extra.old ? sql`now() - interval '9 days'` : sql`now()`})`;
  await post("## All-hands moved to Thu", { pinned: true });
  await post("Office closed Friday");
  await post("Old news", { old: true });
  await post("Managers only", { audience: { roles: ["admin"] } });
  const now = new Date().toISOString(), old = new Date(Date.now() - 10 * 86_400_000).toISOString();
  await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES
    (${id}, 'travel', 'Travel policy.md', ${sql.json({ org: { lifecycle: "published", publishedAt: now, owner: member!, reviewBy: "2020-01-01" } })}),
    (${id}, 'expenses', 'Expenses.md', ${sql.json({ org: { lifecycle: "published", publishedAt: old, reviewBy: "2020-02-01" } })}),
    (${id}, 'draft', 'Draft.md', ${sql.json({ org: { lifecycle: "draft", publishedAt: now } })})`;
  viewerId = member!;
  const mine = await company.readWhatsNewAction(id);
  assert.ok(mine.success);
  assert.deepEqual(mine.items.map((i) => i.text).sort(), ["Office closed Friday", "Travel policy"], "not the pin, the old post, a post for others, an old or draft page");
  assert.equal((await company.readNeedsReviewAction(id)).success, false, "admins only");
  viewerId = owner!;
  const review = await company.readNeedsReviewAction(id);
  assert.ok(review.success);
  assert.equal(review.total, 2);
  assert.deepEqual(review.owners.map((o) => o.pages.map((p) => p.title)), [["Travel policy"], ["Expenses"]]);
  assert.equal(review.owners[1]!.owner, "No owner");
});
