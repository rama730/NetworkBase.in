import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.1 (report 30.2 W1): Class details, sessions, the syllabus card; who sees and changes what. (Harness from institutions.test.ts.)
// Plan B0.1 (report 29.2, with its correction): an Education organization becomes an institution; classes join it
// by institution_id (at once for its admins, by request otherwise), leave or are removed; the institution sees counts
// and states only and never gains read of a class or its students' work.
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

let home: typeof import("../../src/app/actions/class-home");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  home = await loadAppModule(() => import("../../src/app/actions/class-home"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [teacher, ta, student, visitor] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "public" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, time_zone = 'Asia/Kolkata',
    term_start = '2027-01-11', term_end = '2027-01-29' WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${ta!}, 'admin'), (${klass}, ${student!}, 'member')`;
  return { teacher: teacher!, ta: ta!, student: student!, visitor: visitor!, klass };
}
const details = { courseCode: "CS 301", meets: [{ day: 2, start: "10:30", end: "12:00" }], room: "LH-2 204", onlineLink: "https://meet.example/abc", officeHours: { days: [3], start: "15:00", end: "16:00", place: "Room 12" },
  credits: 4, breaks: [{ name: "Break", start: "2027-01-18", end: "2027-01-22" }], show: { courseCode: true, meets: true, term: true, room: false, officeHours: false } };
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("only the teacher saves details; students see them all; visitors only the rows switched on", async () => {
  const t = await setup();
  viewerId = t.ta;
  assert.equal((await home.saveClassDetailsAction(t.klass, details)).success, false, "a TA can't edit the details");
  viewerId = t.teacher;
  assert.match(errorOf(await home.saveClassDetailsAction(t.klass, { ...details, onlineLink: "http://x.example" })), /https/);
  assert.equal((await home.saveClassDetailsAction(t.klass, details)).success, true);
  viewerId = t.student;
  const mine = await home.readClassHomeAction(t.klass);
  assert.ok(mine.success);
  assert.deepEqual([mine.role, mine.details?.room, mine.details?.onlineLink, mine.canEditDetails, mine.canChangeSessions], ["member", "LH-2 204", "https://meet.example/abc", false, false]);
  viewerId = t.visitor;
  const seen = await home.readClassHomeAction(t.klass);
  assert.ok(seen.success);
  assert.deepEqual([seen.role, seen.details?.courseCode, seen.details?.room, seen.details?.onlineLink, seen.details?.officeHours, seen.next], ["visitor", "CS 301", null, null, null, null]);
  assert.deepEqual(seen.details?.meets, details.meets);
});

test("a TA cancels, moves and restores one session; a made-up session is refused; students can't", async () => {
  const t = await setup();
  viewerId = t.teacher;
  await home.saveClassDetailsAction(t.klass, details);
  viewerId = t.student;
  assert.equal((await home.changeSessionAction(t.klass, { key: "2027-01-12T10:30", change: "cancel" })).success, false);
  viewerId = t.ta;
  assert.match(errorOf(await home.changeSessionAction(t.klass, { key: "2027-01-19T10:30", change: "cancel" })), /isn’t in this term/, "the break week has no class");
  assert.equal((await home.changeSessionAction(t.klass, { key: "2027-01-12T10:30", change: "cancel" })).success, true);
  assert.equal((await home.changeSessionAction(t.klass, { key: "2027-01-26T10:30", change: { moveTo: "2027-01-27T09:00" } })).success, true);
  const [row] = await sql`SELECT org_settings->'sessionChanges' AS c FROM workspaces WHERE id = ${t.klass}`;
  assert.deepEqual(row!.c, { "2027-01-12T10:30": { cancelled: true }, "2027-01-26T10:30": { movedTo: "2027-01-27T09:00" } });
  assert.equal((await home.changeSessionAction(t.klass, { key: "2027-01-12T10:30", change: "restore" })).success, true);
  assert.deepEqual((await sql`SELECT org_settings->'sessionChanges' AS c FROM workspaces WHERE id = ${t.klass}`)[0]!.c, { "2027-01-26T10:30": { movedTo: "2027-01-27T09:00" } });
});

test("the syllabus card shows the Syllabus document; outsiders only once it's published and not members-only", async () => {
  const t = await setup();
  const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, filename, slug, settings) VALUES (${t.klass}, 'Syllabus.md', 'syllabus', '{"kind":"syllabus"}'::jsonb) RETURNING id`;
  viewerId = t.student;
  const inside = await home.readClassHomeAction(t.klass);
  assert.deepEqual(inside.success && inside.syllabus && [inside.syllabus.title, inside.syllabus.published], ["Syllabus", false]);
  viewerId = t.visitor;
  const before = await home.readClassHomeAction(t.klass);
  assert.equal(before.success && before.syllabus, null);
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash, created_by)
    VALUES (${t.klass}, ${doc!.id}, 1, ${"# Syllabus\n\nTrees, graphs and **hashing** in ten weeks.\n\n## Units"}, 'h1', ${t.teacher}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${doc!.id}`;
  const after = await home.readClassHomeAction(t.klass);
  assert.equal(after.success && after.syllabus?.firstParagraph, "Trees, graphs and hashing in ten weeks.");
});
