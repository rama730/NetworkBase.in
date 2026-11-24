import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.5c (report 30.8 call): peer review — 2 other hand-ins each, never your own, names hidden both ways, no tokens.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.182" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let peer: typeof import("../../src/app/actions/peer-review");
let token: string | null = null;
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  peer = await loadAppModule(() => import("../../src/app/actions/peer-review"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});
const RUBRIC = { id: "r1", name: "Essay", criteria: [{ id: "c1", name: "Argument", levels: [{ label: "Good", points: 10, text: "" }, { label: "Weak", points: 0, text: "" }] }] };

async function setup(peerReview = true, submissionType = "text") {
  const people = await Promise.all([0, 1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const [teacher, a, b, c, d] = people as string[];
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${a!}, 'member'), (${klass}, ${b!}, 'member'), (${klass}, ${c!}, 'member'), (${klass}, ${d!}, 'member')`;
  const settings = { version: 1, submissionType, reviewRequired: true, lateRule: "none", lateUntil: null, target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null, marking: { mode: "rubric", rubric: RUBRIC }, peerReview };
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Essay 1', 'todo', 'medium', ${teacher!}, 'assignment', ${sql.json(settings as never)}) RETURNING id`;
  const copy: Record<string, string> = {};
  for (const [k, s] of [["a", a], ["b", b], ["c", c], ["d", d]] as const) {
    const handedIn = k !== "d";
    copy[k] = (await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, review_status, submission)
      VALUES (${klass}, 'Essay 1', ${handedIn ? "done" : "todo"}, 'medium', ${s!}, 'task', ${master!.id}, ${s!}, ${handedIn ? "pending" : "none"}, ${handedIn ? sql.json({ text: `Essay by ${k}`, by: s, version: 1 } as never) : null}) RETURNING id`)[0]!.id;
  }
  return { teacher: teacher!, a: a!, b: b!, c: c!, d: d!, klass, master: master!.id as string, copy };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("each student who handed in reviews 2 others (never their own), names hidden both ways; Send needs every level", async () => {
  const t = await setup();
  viewerId = t.d;
  assert.match(errorOf(await peer.startPeerReviewsAction(t.copy.d!)), /Hand in your own work first/);
  viewerId = t.a;
  assert.deepEqual(await peer.startPeerReviewsAction(t.copy.a!), { success: true, drawn: 2 });
  assert.deepEqual(await peer.startPeerReviewsAction(t.copy.a!), { success: true, drawn: 0 }, "never more than 2");
  const mine = await peer.readPeerReviewAction(t.copy.a!);
  assert.ok(mine.success && mine.on);
  assert.deepEqual(mine.todo.map((x) => x.label), ["Hand-in A", "Hand-in B"]);
  assert.equal(mine.todo.some((x) => x.text === "Essay by a"), false, "never your own");
  assert.equal(JSON.stringify(mine).includes(t.b) || JSON.stringify(mine).includes(t.c), false, "no ids of the authors");
  assert.match(errorOf(await peer.savePeerReviewAction(mine.todo[0]!.id, { levels: {}, submit: true })), /Pick a level for Argument/);
  assert.equal((await peer.savePeerReviewAction(mine.todo[0]!.id, { levels: { c1: 0 }, comment: "Clear thesis", submit: true })).success, true);
  assert.match(errorOf(await peer.savePeerReviewAction(mine.todo[0]!.id, { levels: { c1: 1 }, submit: true })), /sent this review/);
  viewerId = t.b;
  assert.equal((await peer.savePeerReviewAction(mine.todo[1]!.id, { levels: { c1: 0 }, submit: true })).success, false, "only the reviewer saves it");
  const [target] = await sql`SELECT copy_id FROM peer_reviews WHERE id = ${mine.todo[0]!.id}`;
  const author = target!.copy_id === t.copy.b ? t.b : t.c;
  viewerId = author;
  const theirs = await peer.readPeerReviewAction(target!.copy_id);
  assert.ok(theirs.success && theirs.on);
  assert.deepEqual(theirs.feedback, [{ label: "Reviewer 1", levels: { c1: 0 }, comment: "Clear thesis" }]);
  assert.equal(JSON.stringify(theirs).includes(t.a), false, "the author never learns who reviewed");
  viewerId = t.b;
  assert.equal((await peer.readPeerReviewAction(t.copy.c!)).success, false, "nobody reads another's copy page data");
});

test("off unless the assignment asks for it, with a rubric and text or link hand-ins; tokens are refused", async () => {
  const off = await setup(false);
  viewerId = off.a;
  const r = await peer.readPeerReviewAction(off.copy.a!);
  assert.ok(r.success && !r.on);
  const files = await setup(true, "file");
  viewerId = files.a;
  const f = await peer.readPeerReviewAction(files.copy.a!);
  assert.ok(f.success && !f.on, "file hand-ins stay private");
  const on = await setup();
  viewerId = on.a;
  token = "pat";
  assert.equal((await peer.startPeerReviewsAction(on.copy.a!)).success, false);
  token = null;
});
