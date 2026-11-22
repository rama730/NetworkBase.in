import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Profile mix (spec: docs/superpowers/specs/2026-11-23-profile-mix-prototype.html): Move up / Move down on the
// contributions timeline (0112), and pins on the Portfolio tab (0113).

let viewerId = "";
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let mix: typeof import("../../src/app/actions/profile-mix");
let collab: typeof import("../../src/lib/profile/collaboration");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", { ...viewerContext, getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }) });
  mix = await loadAppModule(() => import("../../src/app/actions/profile-mix"));
  collab = await loadAppModule(() => import("../../src/lib/profile/collaboration"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function space(owner: string, member?: string) {
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "public" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${owner}, 'owner', now())`;
  if (member) await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${member}, 'member', now())`;
  created.push(id);
  return id;
}

async function contribution(profileId: string, workspaceId: string) {
  const [row] = await sql<{ id: string }[]>`INSERT INTO profile_contributions (profile_id, workspace_id, source) VALUES (${profileId}, ${workspaceId}, 'membership') RETURNING id`;
  return row!.id;
}

test("0112: Move up / Move down writes the timeline order for your own entries only", async () => {
  const [me, other] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const [a, b, c] = await Promise.all([space(me!), space(me!), space(me!)]);
  const [ca, cb, cc] = [await contribution(me!, a), await contribution(me!, b), await contribution(me!, c)];
  const theirs = await contribution(other!, await space(other!));

  viewerId = me!;
  assert.deepEqual(await mix.setContributionTimelineOrderAction([cc, ca, cb, theirs]), { success: true });
  const rows = await sql<{ id: string; timeline_order: number | null }[]>`SELECT id, timeline_order FROM profile_contributions WHERE id IN ${sql([ca, cb, cc, theirs])}`;
  const order = Object.fromEntries(rows.map((r) => [r.id, r.timeline_order]));
  assert.deepEqual([order[cc], order[ca], order[cb]], [0, 1, 2]);
  assert.equal(order[theirs], null, "someone else's entry is never touched");

  const timeline = await collab.getProfileCollaborationSummary(me!, { includePrivate: true });
  assert.deepEqual(timeline.contributions.filter((x) => [ca, cb, cc].includes(x.id)).map((x) => x.timelineOrder).sort(), [0, 1, 2]);

  viewerId = "";
  assert.equal((await mix.setContributionTimelineOrderAction([ca])).success, false, "signed out can't reorder");
  assert.equal((await mix.setContributionTimelineOrderAction(["not-a-uuid"])).success, false);
});

test("0113: Portfolio pins need membership, put the workspace first, and unpin cleanly", async () => {
  const [me, other] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const older = await space(me!);
  await sql`UPDATE workspaces SET created_at = now() - interval '30 days' WHERE id = ${older}`;
  const newer = await space(other!, me!);
  const outside = await space(other!);

  viewerId = me!;
  assert.deepEqual(await mix.setPortfolioPinAction(older, true), { success: true });
  assert.equal((await mix.setPortfolioPinAction(outside, true)).success, false, "only workspaces you're in");
  let portfolio = await collab.getProfilePortfolioWorkspaces(me!, { includePrivate: false });
  assert.equal(portfolio.projects[0]!.id, older, "pinned comes first even though it's older");
  assert.equal(portfolio.projects[0]!.pinned, true);
  assert.equal(portfolio.projects.find((p) => p.id === newer)!.pinned, false);

  assert.deepEqual(await mix.setPortfolioPinAction(older, false), { success: true });
  portfolio = await collab.getProfilePortfolioWorkspaces(me!, { includePrivate: false });
  assert.equal(portfolio.projects[0]!.id, newer);
  assert.equal((await sql`SELECT 1 FROM profile_portfolio_pins WHERE profile_id = ${me!}`).length, 0);
});
