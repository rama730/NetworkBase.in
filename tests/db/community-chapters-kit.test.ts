import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B5.5d (report 34.6 calls 4–7, M1, M3): the Chapter kit, Pick your chapter, the community calendar with chapter events,
// health counts, the report chain (chapter → community → NetworkBase) and takeover when a chapter's owner leaves.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.246" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
stubNextAfter();
let chap: typeof import("../../src/app/actions/community-chapters");
let fd: typeof import("../../src/app/actions/community-front-door");
let ev: typeof import("../../src/app/actions/community-events");
let mod: typeof import("../../src/app/actions/community-moderation");
let orgs: typeof import("../../src/app/actions/organizations");
let cases: typeof import("../../src/lib/trust/cases");
let server: typeof import("../../src/lib/organizations/community-server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  chap = await loadAppModule(() => import("../../src/app/actions/community-chapters"));
  fd = await loadAppModule(() => import("../../src/app/actions/community-front-door"));
  ev = await loadAppModule(() => import("../../src/app/actions/community-events"));
  mod = await loadAppModule(() => import("../../src/app/actions/community-moderation"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  cases = await loadAppModule(() => import("../../src/lib/trust/cases"));
  server = await loadAppModule(() => import("../../src/lib/organizations/community-server"));
});
const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR org_settings->>'chapterOf' = ${id}`;
  await sql.end();
  await closeAppDb();
});

const doc = async (org: string, slug: string, filename: string, content: string) => {
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${org}, ${slug}, ${filename}, ${sql.json({ org: { lifecycle: "published", readVersion: 0 } })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${org}, ${d!.id}, 1, ${content}, ${slug}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  return d!.id as string;
};
const event = async (org: string, by: string, title: string, start: Date, who: "members" | "public") =>
  (await sql`INSERT INTO tasks (workspace_id, creator_id, title, item_type, stage, type_fields) VALUES (${org}, ${by}, ${title}, 'event', 'planned',
    ${sql.json({ kind: "community", start: start.toISOString(), end: new Date(start.getTime() + 36e5).toISOString(), format: "online", place: null, who, hosts: [by], runOfShow: [] })}) RETURNING id`)[0]!.id as string;

async function setup() {
  const [owner, a, b, c] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  created.push(org);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${a!}, 'member'), (${org}, ${b!}, 'member'), (${org}, ${c!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'community', status = 'active', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  await doc(org, "coc", "Code of conduct.md", "## Rules\n1. Be kind\n2. No spam");
  return { org, owner: owner!, a: a!, b: b!, c: c! };
}
async function chapter(s: Awaited<ReturnType<typeof setup>>, by: string, co: string | null) {
  viewerId = by;
  assert.ok((await chap.proposeChapterAction(s.org, { name: `Ch ${by.slice(0, 4)}`, kind: "local", place: "Pune", why: "", coOrganiserId: co })).success);
  viewerId = s.owner;
  const v = await chap.readChaptersAction(s.org);
  const p = v.success ? v.proposals.find((x) => x.by === by)! : null;
  const made = await chap.decideChapterProposalAction(s.org, p!.id, { approve: true, reason: null });
  assert.ok(made.success && made.chapterId);
  return made.success ? made.chapterId! : "";
}

test("call 4: the Chapter kit freezes chosen documents, Getting started and rituals; a new chapter starts from it", async () => {
  const s = await setup();
  const guide = await doc(s.org, "guide", "Organiser guide.md", "# Running a meetup\nBook a room.");
  await sql`UPDATE workspace_documents SET settings = ${sql.json({ version: 1, kind: "guide", invitedIds: [s.b], answers: { [s.b]: "going" } })} WHERE id = ${guide}`;
  await sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{community}', jsonb_build_object(
    'gettingStarted', ${sql.json([{ id: "say", label: "Say hello", href: "/messages" }])}::jsonb,
    'rituals', ${sql.json([{ id: "wins-01", name: "Weekly wins", kind: "thread", freq: "weekly", weekday: 5, time: "18:00", hostId: s.owner, prompt: "Wins?", leadDays: 0, paused: false, savedBy: s.owner, lastPostedFor: "2026-11-20" }])}::jsonb)) WHERE id = ${s.org}`;
  viewerId = s.a;
  assert.equal((await chap.readChapterKitAction(s.org)).success, false, "organisers only");
  viewerId = s.owner;
  const k = await chap.readChapterKitAction(s.org);
  assert.ok(k.success && k.kit === null && k.docs.map((d) => d.filename).join() === "Organiser guide.md", "the Code of conduct is never in the kit");
  assert.ok((await chap.saveChapterKitAction(s.org, { docIds: [guide] })).success);
  // Frozen: editing the community's guide afterwards doesn't change what new chapters get.
  await sql`UPDATE workspace_document_versions SET content = 'changed' WHERE doc_id = ${guide}`;
  const ch = await chapter(s, s.a, null);
  const [copy] = await sql`SELECT d.filename, v.content FROM workspace_documents d JOIN workspace_document_versions v ON v.id = d.published_version_id WHERE d.workspace_id = ${ch}`;
  assert.deepEqual({ ...copy }, { filename: "Organiser guide.md", content: "# Running a meetup\nBook a room." });
  const [cs] = await sql`SELECT settings FROM workspace_documents WHERE workspace_id = ${ch}`;
  assert.deepEqual(cs!.settings, { version: 1, kind: "guide" }, "layout only: never who's invited or their answers");
  viewerId = s.owner;
  const again = await chap.readChapterKitAction(s.org);
  assert.ok(again.success && again.kit?.docIds.includes(guide), "re-saving starts from the kit's documents");
  const [st] = await sql`SELECT org_settings->'community' AS c FROM workspaces WHERE id = ${ch}`;
  assert.equal(st!.c.gettingStarted[0].id, "say");
  assert.deepEqual([st!.c.rituals[0].paused, st!.c.rituals[0].hostId, st!.c.rituals[0].lastPostedFor], [true, s.a, undefined], "rituals start paused, hosted by the chapter's organiser");
  await sql`UPDATE workspace_document_versions SET content = ${"x".repeat(41_000)} WHERE doc_id = ${guide}`;
  assert.equal((await chap.saveChapterKitAction(s.org, { docIds: [guide] })).success, false, "the 40,000-character budget");
});

test("M1 + M3 + health: Pick your chapter ticks itself; the calendar shows chapters' public events only; counts for organisers", async () => {
  const s = await setup();
  const ch = await chapter(s, s.a, null);
  viewerId = s.b;
  await sql`UPDATE workspace_members SET joined_at = now() WHERE workspace_id = ${s.org}`;
  let me = await fd.readMyCommunityAction(s.org);
  assert.ok(me.success && me.gettingStarted?.items.some((i) => i.id === "chapter" && !i.done && i.auto));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ch}, ${s.b}, 'member')`;
  me = await fd.readMyCommunityAction(s.org);
  assert.ok(me.success && me.gettingStarted?.items.find((i) => i.id === "chapter")?.done === true);

  const soon = new Date(); soon.setUTCDate(soon.getUTCDate() + 2);
  await event(s.org, s.owner, "Community night", soon, "members");
  await event(ch, s.a, "Chapter meetup", soon, "public");
  await event(ch, s.a, "Chapter organisers only", soon, "members");
  const month = soon.toISOString().slice(0, 7);
  const cal = await ev.readCommunityCalendarAction(s.org, month);
  assert.ok(cal.success);
  assert.deepEqual(cal.events.map((e) => `${e.title}:${e.chapter?.id === ch ? "ch" : "here"}`).sort(), ["Chapter meetup:ch", "Community night:here"]);
  assert.ok(cal.events.find((e) => e.chapter)!.link === null && !cal.events.find((e) => e.chapter)!.canEdit);
  assert.equal((await ev.readCommunityCalendarAction(s.org, "2026-13")).success, false);
  await sql`UPDATE workspaces SET visibility = 'private' WHERE id = ${ch}`;
  viewerId = s.c;
  const hidden = await ev.readCommunityCalendarAction(s.org, month);
  assert.ok(hidden.success && hidden.chapters.length === 0 && !hidden.events.some((e) => e.chapter), "a private chapter only for its members");
  viewerId = s.b;
  const shown = await ev.readCommunityCalendarAction(s.org, month);
  assert.ok(shown.success && shown.events.some((e) => e.chapter));
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${ch}`;

  viewerId = s.owner;
  const past = new Date(Date.now() - 5 * 864e5);
  await event(ch, s.a, "Last week", past, "members");
  const v = await chap.readChaptersAction(s.org);
  assert.ok(v.success && v.chapters[0]!.events90d === 1 && v.chapters[0]!.openReports === 0);
});

test("call 5: a chapter's report goes to its moderators, then the community's organisers, then NetworkBase", async () => {
  const s = await setup();
  const ch = await chapter(s, s.a, s.b);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ch}, ${s.c}, 'member')`;
  const spam = (await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ch}, ${s.c}, 'buy my course') RETURNING id`)[0]!.id as string;
  await cases.fileReport(s.b, { kind: "update", targetId: spam, reason: "spam" });
  const [c] = await sql`SELECT id, org_id, routed_to FROM moderation_cases WHERE target_id = ${spam}`;
  assert.deepEqual([c!.org_id, c!.routed_to], [ch, "org"]);
  viewerId = s.owner;
  let q = await mod.readCommunityModerationAction(s.org);
  assert.ok(q.success && q.cases.length === 0, "not the community's yet");
  viewerId = s.a;
  q = await mod.readCommunityModerationAction(ch);
  assert.ok(q.success && q.cases.length === 1 && q.pass === "community");
  assert.ok((await mod.moderateCommunityReportAction(ch, c!.id, { choice: "pass", rule: 2 })).success);
  q = await mod.readCommunityModerationAction(ch);
  assert.ok(q.success && q.cases.length === 0, "with the community now");
  const consoleMod = await loadAppModule(() => import("../../src/lib/trust/console"));
  assert.equal((await consoleMod.readOrgCases(ch, s.b)).length, 0, "Settings → Moderation in the chapter doesn't keep it either");
  const decide = await loadAppModule(() => import("../../src/lib/trust/decide"));
  assert.equal((await decide.decideCase(c!.id, { id: s.b, scope: "org", orgId: ch }, { outcome: "no_violation" })).ok, false, "the chapter can't dismiss it after passing it up");
  viewerId = s.owner;
  q = await mod.readCommunityModerationAction(s.org);
  assert.ok(q.success && q.cases.length === 1 && q.cases[0]!.chapter !== null);
  assert.ok((await mod.moderateCommunityReportAction(s.org, c!.id, { choice: "hide", rule: 2 })).success, "community organisers decide it");
  const [done] = await sql`SELECT state FROM moderation_cases WHERE id = ${c!.id}`;
  assert.equal(done!.state, "decided");

  // About a chapter organiser: the community's organisers get it (the job moves it up), not the chapter.
  const own = (await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ch}, ${s.b}, 'rude') RETURNING id`)[0]!.id as string;
  await cases.fileReport(s.c, { kind: "update", targetId: own, reason: "spam" });
  const [c2] = await sql`SELECT id, routed_to, org_id FROM moderation_cases WHERE target_id = ${own}`;
  assert.deepEqual([c2!.routed_to, c2!.org_id], ["org", s.org], "filed on the community from the start");
  viewerId = s.a;
  q = await mod.readCommunityModerationAction(ch);
  assert.ok(q.success && !q.cases.some((x) => x.id === c2!.id), "a chapter never judges its own organisers");
  viewerId = s.owner;
  q = await mod.readCommunityModerationAction(s.org);
  assert.ok(q.success && q.cases.some((x) => x.id === c2!.id));

  // A plain chapter member who is a community admin: when it goes up, NetworkBase takes it (T6).
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${s.org} AND user_id = ${s.c}`;
  const third = (await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ch}, ${s.c}, 'again') RETURNING id`)[0]!.id as string;
  await cases.fileReport(s.b, { kind: "update", targetId: third, reason: "spam" });
  const [c3] = await sql`SELECT id FROM moderation_cases WHERE target_id = ${third}`;
  await sql`UPDATE moderation_cases SET created_at = now() - interval '30 hours', org_deadline_at = now() + interval '1 hour' WHERE id = ${c3!.id}`;
  await server.passChapterReportsUp();
  const [s3] = await sql`SELECT routed_to FROM moderation_cases WHERE id = ${c3!.id}`;
  assert.equal(s3!.routed_to, "staff");
});

test("call 6: a chapter's owner may leave — the co-organiser takes over; with none, the community's owner", async () => {
  const s = await setup();
  const withCo = await chapter(s, s.a, s.b);
  viewerId = s.a;
  assert.ok((await orgs.leaveOrgAction(withCo)).success);
  const [o1] = await sql`SELECT owner_id FROM workspaces WHERE id = ${withCo}`;
  assert.equal(o1!.owner_id, s.b);
  const paused = await chapter(s, s.b, s.c);
  await sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{community}', coalesce(org_settings->'community', '{}'::jsonb) || jsonb_build_object('pauses', jsonb_build_object(${s.c}::text, jsonb_build_object('until', ${new Date(Date.now() + 36e5).toISOString()}::text)))) WHERE id = ${s.org}`;
  viewerId = s.b;
  assert.ok((await orgs.leaveOrgAction(paused)).success);
  const [o3] = await sql`SELECT owner_id FROM workspaces WHERE id = ${paused}`;
  assert.equal(o3!.owner_id, s.owner, "a paused co-organiser is skipped");
  await sql`UPDATE workspaces SET org_settings = org_settings #- '{community,pauses}' WHERE id = ${s.org}`;
  const alone = await chapter(s, s.c, null);
  viewerId = s.c;
  assert.ok((await orgs.leaveOrgAction(alone)).success);
  const [o2] = await sql`SELECT owner_id, (SELECT role FROM workspace_members WHERE workspace_id = ${alone} AND user_id = ${s.owner}) AS role FROM workspaces WHERE id = ${alone}`;
  assert.deepEqual([o2!.owner_id, o2!.role], [s.owner, "owner"]);
  viewerId = s.owner;
  assert.equal((await orgs.leaveOrgAction(s.org)).success, false, "a community's owner still transfers first");
});
