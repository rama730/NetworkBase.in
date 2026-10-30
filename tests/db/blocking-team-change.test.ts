import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// "Ask to change team" (Blocking B48): a member of a team inside an organization asks its admins, privately.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let viewerId = "";
const notices: Array<{ to: string[]; title: string }> = [];
let blocking: typeof import("../../src/app/actions/blocking");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", { ...viewerContext, getViewerAuthContext: async () => ({ userId: viewerId || null }) });
  moduleStubs.set("@/lib/organizations/notify", {
    notifyOrg: async (notice: { to: string[]; title: string }) => { notices.push(notice); },
    orgHref: (org: { slug: string | null; id: string }, query = "") => `/org/${org.slug ?? org.id}${query}`,
  });
  blocking = await loadAppModule(() => import("../../src/app/actions/blocking"));
});
const made: string[] = [];
const people: string[] = [];
after(async () => {
  if (made.length) await sql`DELETE FROM workspaces WHERE id IN ${sql(made)}`;
  if (people.length) await sql`DELETE FROM profiles WHERE id IN ${sql(people)}`;
  await sql.end();
  await closeAppDb();
});

test("a team member's request reaches every org admin and owner, and names nobody else", async () => {
  const [owner, admin, member] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  people.push(owner!, admin!, member!);
  const org = await sql.begin((tx) => createProject(tx, owner!));
  const team = await sql.begin((tx) => createProject(tx, owner!));
  made.push(team, org);
  await sql`UPDATE workspaces SET kind = 'organization' WHERE id = ${org}`;
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${team}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${admin}, 'admin'), (${org}, ${member}, 'member'), (${team}, ${member}, 'member')`;

  viewerId = member!;
  const result = await blocking.askToChangeTeamAction(team);
  assert.deepEqual(result, { success: true });
  assert.equal(notices.length, 1);
  assert.deepEqual([...notices[0]!.to].sort(), [owner!, admin!].sort());

  viewerId = admin!;
  assert.equal((await blocking.askToChangeTeamAction(team)).success, false, "only the team's own members can ask");
});
