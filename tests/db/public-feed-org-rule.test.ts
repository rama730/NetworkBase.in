import assert from "node:assert/strict";
import { after, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Decision 160 (live-check follow-up): Discover's first page follows the same rule as its search: a new organization
// shows after 3+ members and 7+ days, or once verified.
after(async () => { await sql.end(); await closeAppDb(); });

test("decision 160: the public feed holds back a new, small organization until it qualifies or is verified", async () => {
  const feed = await loadAppModule(() => import("../../src/lib/workspaces/public-feed-service"));
  const owner = await sql.begin((tx) => createUser(tx));
  const org = await sql.begin((tx) => createProject(tx, owner, { visibility: "public" }));
  try {
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', status = 'active' WHERE id = ${org}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner}, 'owner')`;
    const ids = async () => (await feed.queryAndCachePublicWorkspacesFeed(50, null)).projects.map((i: { id: string }) => i.id);
    assert.equal((await ids()).includes(org), false, "new, one member: waits");
    await sql`UPDATE workspaces SET verified_at = now() WHERE id = ${org}`;
    assert.equal((await ids()).includes(org), true, "verified: shows");
  } finally {
    await sql`DELETE FROM workspaces WHERE id = ${org}`;
  }
});
