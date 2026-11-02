import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 9d (report §27.9, decision 56): the Verified badge is rechecked when the website or name changes.

moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let verification: typeof import("../../src/lib/organizations/verification");
let detail: typeof import("../../src/lib/organizations/detail");
before(async () => {
  verification = await loadAppModule(() => import("../../src/lib/organizations/verification"));
  detail = await loadAppModule(() => import("../../src/lib/organizations/detail"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(verified: { domain: string | null }) {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()},
    verified_at = now(), verification_domain = ${verified.domain}, external_links = ${sql.json([{ url: "https://www.rvce.edu.in" }])} WHERE id = ${id}`;
  created.push(id);
  return { id, owner };
}

test("27.9: the website moving off the verified domain removes ✓, keeps the reason and tells the owner", async () => {
  const o = await org({ domain: "rvce.edu.in" });
  assert.equal(await verification.recheckOrgVerification(o.id, { links: true }), "keep", "still on the domain");
  await sql`UPDATE workspaces SET external_links = ${sql.json([{ url: "https://cse3b.example.com" }])} WHERE id = ${o.id}`;
  assert.equal(await verification.recheckOrgVerification(o.id, { links: true }), "remove");
  const [row] = await sql`SELECT verified_at, org_settings->'verification' AS v FROM workspaces WHERE id = ${o.id}`;
  assert.deepEqual([row!.verified_at, row!.v.state, row!.v.reason], [null, "removed", "The website in Links moved off rvce.edu.in."]);
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.owner} AND title LIKE 'CSE 3B isn’t verified any more%'`;
  assert.ok(notice);
  const d = await detail.readOrgDetail(o.id, { userId: o.owner, isAdmin: true, isInOrg: true });
  assert.deepEqual([d?.verificationOutcome?.state, d?.hasWebsite], ["removed", true], "Settings shows the reason, with Ask again");
});

test("27.9: renaming keeps a domain badge and sends a staff-given one back to Requested", async () => {
  const byDomain = await org({ domain: "rvce.edu.in" });
  assert.equal(await verification.recheckOrgVerification(byDomain.id, { renamed: true }), "keep");
  const byStaff = await org({ domain: null });
  assert.equal(await verification.recheckOrgVerification(byStaff.id, { renamed: true }), "request_again");
  const [row] = await sql`SELECT verified_at, verification_requested_at FROM workspaces WHERE id = ${byStaff.id}`;
  assert.equal(row!.verified_at, null);
  assert.ok(row!.verification_requested_at);
});
