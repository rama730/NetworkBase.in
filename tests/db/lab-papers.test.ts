import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B6.3a (report 35.3): Submitted refused until every member author confirms (server test); internal review by the PI;
// Rejected returns to Drafting with history; private papers for authors and the PI; unpublished titles never reach About.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.251" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let pa: typeof import("../../src/app/actions/lab-papers");
let lab: typeof import("../../src/app/actions/lab");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  pa = await loadAppModule(() => import("../../src/app/actions/lab-papers"));
  lab = await loadAppModule(() => import("../../src/app/actions/lab"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("35.3: confirm → review → submit; rejected back to Drafting; private; About shows only Published", async () => {
  const [pi, researcher, student, other, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, pi!, { visibility: "public" }));
  created.push(org);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'research', status = 'active' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${pi!}, 'owner'), (${org}, ${researcher!}, 'admin'), (${org}, ${student!}, 'member'), (${org}, ${other!}, 'member')`;
  const ws = await sql.begin((tx) => createProject(tx, student!, { visibility: "private" }));
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${student!}, 'owner') ON CONFLICT DO NOTHING`;
  const base = { kind: "paper" as const, venue: "", deadline: "2026-12-15", link: "", doi: "", private: false, preprintPublic: false };

  viewerId = student!;
  assert.equal((await pa.savePaperAction(ws, null, { ...base, title: "X", authors: [{ userId: outsider! }] })).success, false, "member authors are people in the lab");
  const made = await pa.savePaperAction(ws, null, { ...base, title: "Low-light depth from video", authors: [{ userId: student! }, { name: "A. Collaborator" }, { userId: researcher! }] });
  assert.ok(made.success);
  const id = made.success ? made.id : "";
  assert.ok((await pa.movePaperAction(ws, id, { to: "drafting" })).success);
  assert.match(String((await pa.movePaperAction(ws, id, { to: "submitted" }) as { error?: string }).error), /confirms the author list/, "Submitted refused until every member author confirms");
  assert.ok((await pa.confirmAuthorsAction(ws, id)).success);
  viewerId = other!;
  assert.equal((await pa.confirmAuthorsAction(ws, id)).success, false, "only authors confirm");
  viewerId = researcher!;
  assert.ok((await pa.confirmAuthorsAction(ws, id)).success);
  viewerId = student!;
  assert.match(String((await pa.movePaperAction(ws, id, { to: "submitted" }) as { error?: string }).error), /internal review/);
  assert.ok((await pa.movePaperAction(ws, id, { to: "internal_review" })).success);
  viewerId = researcher!;
  assert.equal((await pa.reviewPaperAction(ws, id, { approve: true, note: "" })).success, false, "the PI reviews");
  viewerId = pi!;
  assert.ok((await pa.reviewPaperAction(ws, id, { approve: true, note: "" })).success);
  viewerId = student!;
  assert.ok((await pa.movePaperAction(ws, id, { to: "submitted", venue: "ICCV 2027" })).success);
  assert.ok((await pa.movePaperAction(ws, id, { to: "rejected", note: "Needs a stronger baseline" })).success);
  let read = await pa.readPapersAction(ws);
  let p = read.success ? read.papers[0]! : null;
  assert.equal(p?.stage, "drafting", "Rejected returns to Drafting");
  assert.ok(p?.history.some((h) => h.stage === "rejected" && h.venue === "ICCV 2027"), "with the rejection in its history");
  // Review: generic task moves and task readers never touch papers.
  const transition = await loadAppModule(() => import("../../src/lib/workspaces/task-transition-service"));
  await assert.rejects(async () => { await sql.begin(async () => undefined); const { db } = await loadAppModule(() => import("../../src/lib/db")); await db.transaction((tx) => transition.lockTaskForWrite(tx as never, id, student!)); }, /Papers/);
  const [paperCount] = await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${ws} AND item_type = 'paper'`;
  assert.equal(paperCount!.n, 1);
  // Reordering the authors asks again.
  assert.ok((await pa.savePaperAction(ws, id, { ...base, title: "Low-light depth from video", authors: [{ userId: researcher! }, { userId: student! }, { name: "A. Collaborator" }] })).success);
  read = await pa.readPapersAction(ws);
  p = read.success ? read.papers[0]! : null;
  assert.equal(p?.iConfirmed, false);

  // Review: a lab member outside a private workspace still confirms from the lab's Papers.
  viewerId = researcher!;
  assert.ok((await pa.confirmAuthorsAction(ws, id)).success);
  viewerId = other!;
  assert.equal((await pa.savePaperAction(ws, id, { ...base, title: "Low-light depth from video", private: true, authors: [{ userId: researcher! }, { userId: student! }, { name: "A. Collaborator" }] })).success, false, "non-writers, non-authors can't edit");

  viewerId = "";
  let about = await lab.readLabAboutAction(org);
  assert.ok(about.success && about.publications.length === 0, "unpublished titles never reach About");
  await sql`UPDATE tasks SET stage = 'published' WHERE id = ${id}`;
  about = await lab.readLabAboutAction(org);
  assert.ok(about.success && about.publications[0]?.title === "Low-light depth from video");

  // Review: from Submitted on, the author list stays as sent.
  viewerId = student!;
  const sub = await pa.savePaperAction(ws, null, { ...base, kind: "talk", title: "Lab talk", authors: [{ userId: student! }] });
  const subId = sub.success ? sub.id : "";
  await pa.movePaperAction(ws, subId, { to: "drafting" });
  await pa.confirmAuthorsAction(ws, subId);
  assert.ok((await pa.movePaperAction(ws, subId, { to: "submitted" })).success, "a talk skips internal review");
  assert.match(String((await pa.savePaperAction(ws, subId, { ...base, kind: "talk", title: "Lab talk", authors: [{ userId: student! }, { userId: researcher! }] }) as { error?: string }).error), /stay as sent/);
  assert.ok((await pa.movePaperAction(ws, subId, { to: "revising" })).success);
  assert.ok((await pa.savePaperAction(ws, subId, { ...base, kind: "talk", title: "Lab talk", authors: [{ userId: student! }, { userId: researcher! }] })).success);
  assert.match(String((await pa.movePaperAction(ws, subId, { to: "submitted" }) as { error?: string }).error), /confirms/, "a resubmission with a new list asks again");

  viewerId = student!;
  const priv = await pa.savePaperAction(ws, null, { ...base, title: "Secret idea", private: true, authors: [{ userId: student! }] });
  assert.ok(priv.success);
  viewerId = other!;
  const all = await pa.readLabPapersAction(org);
  assert.ok(all.success && !all.papers.some((x) => x.title === "Secret idea"), "private papers stay with their authors and the PI");
  viewerId = pi!;
  const piView = await pa.readLabPapersAction(org);
  assert.ok(piView.success && piView.papers.some((x) => x.title === "Secret idea"));
  await sql`UPDATE tasks SET stage = 'published' WHERE title = 'Secret idea'`;
  viewerId = "";
  about = await lab.readLabAboutAction(org);
  assert.ok(about.success && !about.publications.some((x) => x.title === "Secret idea"), "a private paper never goes public");
});
