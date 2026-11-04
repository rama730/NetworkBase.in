import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// D7 (2026-11-05-org-address-discovery-verification-findings.md §8a, replaces decision 160): a public organization
// reaches Discover once it has a tagline or description, and a workspace or a second member — or once it's verified.
// Settings' On Discover row says "listed" exactly when the feed lists it.
after(async () => { await sql.end(); await closeAppDb(); });

test("D7: the public feed lists an organization once it looks real, and Settings agrees with the feed", async () => {
  const feed = await loadAppModule(() => import("../../src/lib/workspaces/public-feed-service"));
  const { readOrgDetail } = await loadAppModule(() => import("../../src/lib/organizations/detail"));
  const { orgDiscoverStatus } = await loadAppModule(() => import("../../src/lib/organizations/profile-rules"));
  const owner = await sql.begin((tx) => createUser(tx));
  const friend = await sql.begin((tx) => createUser(tx));
  const org = await sql.begin((tx) => createProject(tx, owner, { visibility: "public" }));
  const child = await sql.begin((tx) => createProject(tx, owner, { visibility: "public" }));
  try {
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', status = 'active', short_description = NULL, description = NULL WHERE id = ${org}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner}, 'owner')`;
    const listed = async () => (await feed.queryAndCachePublicWorkspacesFeed(50, null)).projects.some((i: { id: string }) => i.id === org);
    const settingsSays = async () => {
      const detail = (await readOrgDetail(org, { userId: owner, isAdmin: true, isInOrg: true }))!;
      return orgDiscoverStatus({ verified: detail.verified, hasDescription: detail.hasDescription, workspaces: detail.childProjectCount, members: detail.memberCount,
        visibility: "public", archived: detail.archived, deletionScheduledAt: detail.deletionScheduledAt, suspended: detail.suspended, discoverHidden: detail.discoverHidden }).state;
    };
    const agree = async (expected: boolean, why: string) => {
      assert.equal(await listed(), expected, why);
      assert.equal((await settingsSays()) === "listed", expected, `Settings agrees: ${why}`);
    };

    await agree(false, "no description, one member: waits");
    await sql`UPDATE workspaces SET short_description = 'Data Structures, Section B' WHERE id = ${org}`;
    await agree(false, "a description, but nothing in it yet");
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${friend}, 'member')`;
    await agree(true, "a description and a second member");
    await sql`DELETE FROM workspace_members WHERE workspace_id = ${org} AND user_id = ${friend}`;
    await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${child}`;
    await agree(true, "a description and a workspace");
    await sql`UPDATE workspaces SET short_description = '  ', description = NULL WHERE id = ${org}`;
    await agree(false, "a blank tagline isn't a description");
    await sql`UPDATE workspaces SET verified_at = now() WHERE id = ${org}`;
    await agree(true, "verified: shows");
  } finally {
    await sql`DELETE FROM workspaces WHERE id IN (${child}, ${org})`;
  }
});
