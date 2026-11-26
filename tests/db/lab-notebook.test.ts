import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.2b (report 35.5 calls 2–5): entries lock at the end of their day, then take amendments; Run this protocol records
// the Approved version and warns when untrained; experiments group entries; the lab's PI and Researchers read every
// notebook; nothing is public.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.249" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let nb: typeof import("../../src/app/actions/lab-notebook");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  nb = await loadAppModule(() => import("../../src/app/actions/lab-notebook"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const blank = { aim: "", inputs: "", steps: "", deviations: "", results: "", next: "", links: [] as string[], protocolDocId: null as string | null, experimentId: null as string | null };

test("35.5: entries, lock and amend, Run this protocol, experiments; who reads", async () => {
  const [pi, researcher, student, viewer, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "private" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active', time_zone = 'Asia/Calcutta' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${researcher!}, 'admin'), (${org}, ${student!}, 'member'), (${org}, ${viewer!}, 'member')`;
  const ws = await sql.begin((tx) => createProject(tx, student!, { visibility: "public" }));
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${student!}, 'owner'), (${ws}, ${viewer!}, 'viewer') ON CONFLICT DO NOTHING`;
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${org}, 'rig', 'Capture rig.md', ${sql.json({ kind: "protocol", org: { lifecycle: "published" } })}) RETURNING id`;
  await sql`INSERT INTO lab_protocols (doc_id, workspace_id, needs_training) VALUES (${d!.id}, ${org}, true)`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Calcutta" }).format(new Date());

  viewerId = student!;
  assert.equal((await nb.saveEntryAction(ws, null, { ...blank, title: "Run", day: today, protocolDocId: d!.id })).success, false, "no Approved version yet");
  await sql`INSERT INTO lab_protocol_versions (workspace_id, doc_id, version, state, content) VALUES (${org}, ${d!.id}, 1, 'approved', '## Steps\n1. Power on\n2. Calibrate\n')`;
  const steps = await nb.readProtocolStepsAction(ws, d!.id);
  assert.ok(steps.success && steps.steps.join("|") === "Power on|Calibrate");
  const run = await nb.saveEntryAction(ws, null, { ...blank, title: "Night run 7", day: today, protocolDocId: d!.id, steps: "1. Power on", deviations: "Exposure 1/30" });
  assert.ok(run.success && run.untrained, "running untrained warns, not blocks");
  const entryId = run.success ? run.id : "";
  assert.equal((await nb.saveEntryAction(ws, null, { ...blank, title: "Old", day: "2020-01-01" })).success, false, "only today or yesterday");
  const x = await nb.saveExperimentAction(ws, null, { title: "Depth at 0.1 lux", hypothesis: "It works", status: "running", conclusion: "" });
  assert.ok(x.success);
  assert.ok((await nb.saveEntryAction(ws, entryId, { ...blank, title: "Night run 7", day: today, experimentId: x.success ? x.id : null, steps: "1. Power on\n2. Calibrate", deviations: "Exposure 1/30" })).success, "the author edits until it locks");
  assert.equal((await nb.amendEntryAction(ws, entryId, "not yet")).success, false, "edit, don't amend, while open");

  viewerId = researcher!;
  assert.equal((await nb.saveEntryAction(ws, entryId, { ...blank, title: "Mine now", day: today })).success, false, "only the author edits");
  await sql`UPDATE lab_entries SET locks_at = now() - interval '1 minute' WHERE id = ${entryId}`;
  viewerId = student!;
  assert.match(String((await nb.saveEntryAction(ws, entryId, { ...blank, title: "Changed", day: today }) as { error?: string }).error), /locked/);
  viewerId = researcher!;
  assert.ok((await nb.amendEntryAction(ws, entryId, "Exposure was 1/30, not 1/60")).success, "the lab's Researchers amend");
  const read = await nb.readNotebookAction(ws);
  assert.ok(read.success && !read.writer, "a Researcher reads every notebook but writes in their own");
  const e = read.success ? read.entries[0]! : null;
  assert.deepEqual([e?.locked, e?.untrained, e?.protocol?.version, e?.experiment, e?.amendments.length], [true, true, 1, "Depth at 0.1 lux", 1]);
  assert.equal((e?.body as { deviations?: string }).deviations, "Exposure 1/30");

  viewerId = viewer!;
  const vr = await nb.readNotebookAction(ws);
  assert.ok(vr.success && !vr.writer && !vr.canAmend, "a Viewer of the workspace reads only");
  assert.equal((await nb.saveEntryAction(ws, null, { ...blank, title: "x", day: today })).success, false);
  viewerId = outsider!;
  assert.equal((await nb.readNotebookAction(ws)).success, false, "a public workspace's notebook isn't public");
  viewerId = pi!;
  assert.ok((await nb.readNotebookAction(ws)).success, "the PI reads it");

  // Review: a lab Viewer who writes in this workspace doesn't get the lab's protocols.
  await sql`UPDATE workspace_members SET role = 'viewer' WHERE workspace_id = ${org} AND user_id = ${viewer!}`;
  await sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${ws} AND user_id = ${viewer!}`;
  viewerId = viewer!;
  const lv = await nb.readNotebookAction(ws);
  assert.ok(lv.success && lv.writer && lv.protocols.length === 0);
  assert.equal((await nb.readProtocolStepsAction(ws, d!.id)).success, false);
  // The database refuses to change a locked entry, whatever writes.
  await assert.rejects(async () => { await sql`UPDATE lab_entries SET title = 'quietly changed' WHERE id = ${entryId}`; }, /locked/);
  // The protocol page goes; the entry keeps what was run. The lab goes; the notebook stays with its workspace.
  await sql`DELETE FROM workspace_documents WHERE id = ${d!.id}`;
  viewerId = student!;
  const after1 = await nb.readNotebookAction(ws);
  assert.ok(after1.success && after1.entries[0]!.protocol?.title === "Capture rig" && after1.entries[0]!.protocol?.version === 1);
  await sql`DELETE FROM workspaces WHERE id = ${org}`;
  const [left] = await sql`SELECT count(*)::int AS n FROM lab_entries WHERE workspace_id = ${ws}`;
  assert.equal(left!.n, 1, "nothing removed when the lab is deleted");
});
