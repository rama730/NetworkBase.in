import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

let invitations: typeof import("../../src/lib/workspaces/workspace-invitations");
let appDb: typeof import("../../src/lib/db").db;
before(async () => {
  invitations = await loadAppModule(() => import("../../src/lib/workspaces/workspace-invitations"));
  appDb = (await loadAppModule(() => import("../../src/lib/db"))).db;
});
after(async () => { await sql.end(); await closeAppDb(); });

// COR-051: the per-person limit holds when acceptances race on different projects.
test("two concurrent acceptances cannot push a guide past the appointment limit", async () => {
  const ids: string[] = [];
  const user = async () => { const id = await sql.begin((tx) => createUser(tx)); ids.push(id); return id; };
  try {
    const guide = await user();
    const owner = await user();
    const invite = async (projectId: string, status: string) => {
      const [row] = await sql`
        INSERT INTO workspace_invitations (workspace_id, inviter_id, candidate_id, kind, guidance_label, project_title, status, expires_at)
        VALUES (${projectId}, ${owner}, ${guide}, 'guidance_appointment', 'Guide', 'P', ${status}, now() + interval '1 day') RETURNING id`;
      return row!.id as string;
    };
    // The guide already serves 11 projects (the block limit is 12).
    for (let i = 0; i < 11; i += 1) {
      const projectId = await sql.begin((tx) => createProject(tx, owner));
      const invitationId = await invite(projectId, "accepted");
      await sql`INSERT INTO workspace_mentors (workspace_id, guide_user_id, invitation_id, label, status) VALUES (${projectId}, ${guide}, ${invitationId}, 'Guide', 'active')`;
    }
    const [p1, p2] = await Promise.all([sql.begin((tx) => createProject(tx, owner)), sql.begin((tx) => createProject(tx, owner))]);
    const [i1, i2] = [await invite(p1!, "pending"), await invite(p2!, "pending")];

    const accept = (invitationId: string) =>
      appDb.transaction((tx) => invitations.resolveWorkspaceInvitationInternal(tx as never, { invitationId, actorId: guide, action: "accept" }));
    const results = await Promise.allSettled([accept(i1), accept(i2)]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => (r.status === "rejected" ? String((r.reason?.cause?.message ?? r.reason?.message ?? r.reason)).slice(0, 300) : r.status))));
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(String(rejected.reason?.message ?? rejected.reason), /active guidance appointment limit/);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM workspace_mentors WHERE guide_user_id = ${guide} AND status = 'active'` as Array<{ n: number }>;
    assert.equal(n, 12);
  } finally {
    await sql`DELETE FROM workspace_mentors WHERE guide_user_id = ${ids[0]!}`;
    await sql`DELETE FROM workspace_invitations WHERE candidate_id = ${ids[0]!}`;
    await sql`DELETE FROM workspace_members WHERE user_id = ${ids[0]!}`;
    await sql`DELETE FROM workspaces WHERE owner_id = ANY(${ids}::uuid[])`;
  }
});
