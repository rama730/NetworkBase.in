import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.2a (report 35.5 calls 1, 6): protocol versions Draft → Approved → Retired; only approvers approve; v2 drafts
// while v1 stays Approved; trainers sign people off.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.248" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let lp: typeof import("../../src/app/actions/lab-protocols");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  lp = await loadAppModule(() => import("../../src/app/actions/lab-protocols"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const seen = async (org: string, doc: string) => {
  const r = await lp.readProtocolAction(org, doc);
  return r.success ? r.versions.find((v) => v.state === "draft")?.created ?? "" : "";
};
const publish = async (org: string, doc: string, n: number, content: string) => {
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${org}, ${doc}, ${n}, ${content}, ${`h${n}`}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${doc}`;
};

test("35.5: ask → approve v1; v2 drafts while v1 runs; approving v2 retires v1; trainers sign off, never themselves", async () => {
  const [pi, researcher, member, viewer] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "private" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${researcher!}, 'admin'), (${org}, ${member!}, 'member'), (${org}, ${viewer!}, 'viewer')`;
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${org}, 'rig', 'Capture rig.md', ${sql.json({ kind: "protocol", org: { lifecycle: "published" } })}) RETURNING id`;
  const doc = d!.id as string;
  await publish(org, doc, 1, "# Capture rig\n\n## Purpose\nx\n");

  viewerId = member!;
  assert.match(String((await lp.askApproveProtocolAction(org, doc) as { error?: string }).error), /Steps/, "no Steps, nothing to approve");
  await publish(org, doc, 2, "# Capture rig\n\n## Steps\n1. Power on\n2. Calibrate\n");
  const asked = await lp.askApproveProtocolAction(org, doc);
  assert.ok(asked.success && asked.version === 1);
  assert.equal((await lp.approveProtocolAction(org, doc, 1, await seen(org, doc))).success, false, "members don't approve");
  viewerId = researcher!;
  assert.equal((await lp.approveProtocolAction(org, doc, 1, await seen(org, doc))).success, false, "Researchers approve only if the lab allows");
  viewerId = viewer!;
  assert.equal((await lp.readProtocolsAction(org)).success, false, "viewers don't read protocols");
  viewerId = pi!;
  const token = await seen(org, doc);
  viewerId = member!;
  await lp.askApproveProtocolAction(org, doc);
  viewerId = pi!;
  assert.equal((await lp.approveProtocolAction(org, doc, 1, token)).success, false, "a draft updated since the PI looked isn't approved");
  assert.ok((await lp.approveProtocolAction(org, doc, 1, await seen(org, doc))).success);
  assert.equal((await lp.approveProtocolAction(org, doc, 1, await seen(org, doc))).success, false, "decided once");

  await publish(org, doc, 3, "# Capture rig\n\n## Steps\n1. Power on\n2. Calibrate\n3. Check exposure\n");
  viewerId = member!;
  const v2 = await lp.askApproveProtocolAction(org, doc);
  assert.ok(v2.success && v2.version === 2);
  let list = await lp.readProtocolsAction(org);
  assert.ok(list.success && list.protocols[0]!.approved === 1 && list.protocols[0]!.draft === 2, "v2 drafts while v1 stays usable");
  viewerId = researcher!;
  assert.equal((await lp.askApproveProtocolAction(org, doc)).success, true, "an admin may update a draft someone else asked for");
  const labActions = await loadAppModule(() => import("../../src/app/actions/lab"));
  const ls = await labActions.readLabSettingsAction(org);
  assert.equal((await labActions.saveLabSettingsAction(org, { ...(ls.success ? ls.settings : {}), protocolApprovers: "researchers" })).success, false, "only the PI decides who approves");
  viewerId = pi!;
  assert.ok((await labActions.saveLabSettingsAction(org, { ...(ls.success ? ls.settings : {}), protocolApprovers: "researchers" })).success);
  viewerId = researcher!;
  assert.ok((await lp.approveProtocolAction(org, doc, 2, await seen(org, doc))).success, "now Researchers approve too");
  const states = await sql`SELECT version, state, content FROM lab_protocol_versions WHERE doc_id = ${doc} ORDER BY version`;
  assert.deepEqual(states.map((s) => [s.version, s.state]), [[1, "retired"], [2, "approved"]]);
  assert.match(String(states[0]!.content), /Calibrate\n$/, "a version's text is frozen");

  viewerId = member!;
  assert.equal((await lp.saveProtocolSettingsAction(org, doc, { needsTraining: true, trainers: [member!] })).success, false, "members don't set training");
  viewerId = pi!;
  assert.equal((await lp.saveProtocolSettingsAction(org, doc, { needsTraining: true, trainers: [viewer!] })).success, false, "viewers don’t train");
  assert.ok((await lp.saveProtocolSettingsAction(org, doc, { needsTraining: true, trainers: [researcher!] })).success);
  viewerId = member!;
  assert.equal((await lp.signOffTrainingAction(org, doc, member!, true)).success, false, "nobody signs themselves off");
  viewerId = researcher!;
  assert.equal((await lp.signOffTrainingAction(org, doc, researcher!, true)).success, false);
  assert.ok((await lp.signOffTrainingAction(org, doc, member!, true)).success);
  viewerId = member!;
  const mine = await lp.readMyTrainingsAction(org);
  assert.ok(mine.success && mine.trainings[0]!.trained);
  list = await lp.readProtocolsAction(org);
  assert.ok(list.success && list.protocols[0]!.needsTraining && list.protocols[0]!.trained);

  // Review: a draft page is the owner's and admins' only; retire names its version.
  const [hidden] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${org}, 'wip', 'WIP.md', ${sql.json({ kind: "protocol", org: { lifecycle: "draft", owner: pi! } })}) RETURNING id`;
  await sql`INSERT INTO lab_protocols (doc_id, workspace_id, needs_training) VALUES (${hidden!.id}, ${org}, true)`;
  viewerId = member!;
  assert.equal((await lp.readProtocolAction(org, hidden!.id)).success, false);
  const myT = await lp.readMyTrainingsAction(org);
  assert.ok(myT.success && !myT.trainings.some((t) => t.id === hidden!.id));
  viewerId = researcher!;
  assert.equal((await lp.retireProtocolAction(org, doc, 1)).success, false, "v1 is no longer the Approved one");
  assert.ok((await lp.retireProtocolAction(org, doc, 2)).success);
});
