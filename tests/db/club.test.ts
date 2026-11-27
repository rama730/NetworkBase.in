import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B7.1a (report 36.2): a club has the community front door; its recruiting period is officers-only, turns itself off,
// shows in Discover's Recruiting filter, and its drive counts never name anyone.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.239" }) });

let fd: typeof import("../../src/app/actions/community-front-door");
let club: typeof import("../../src/app/actions/club");
let pos: typeof import("../../src/app/actions/club-positions");
let el: typeof import("../../src/app/actions/club-elections");
let groups: typeof import("../../src/app/actions/community-groups");
let ho: typeof import("../../src/app/actions/club-handover");
let srv: typeof import("../../src/lib/organizations/club-server");
let comp: typeof import("../../src/app/actions/club-competitions");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  fd = await loadAppModule(() => import("../../src/app/actions/community-front-door"));
  club = await loadAppModule(() => import("../../src/app/actions/club"));
  pos = await loadAppModule(() => import("../../src/app/actions/club-positions"));
  el = await loadAppModule(() => import("../../src/app/actions/club-elections"));
  groups = await loadAppModule(() => import("../../src/app/actions/community-groups"));
  ho = await loadAppModule(() => import("../../src/app/actions/club-handover"));
  srv = await loadAppModule(() => import("../../src/lib/organizations/club-server"));
  comp = await loadAppModule(() => import("../../src/app/actions/club-competitions"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("36.2: club front door, recruiting period, drive counts, Discover filter", async () => {
  const join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  const [pres, coord, newbie, visitor] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, pres!, { visibility: "public" }));
  created.push(id);
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${pres!}, 'owner'), (${id}, ${coord!}, 'admin')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active', join_code = ${code}, join_code_enabled = true, title = 'WT Robotics Club' WHERE id = ${id}`;

  // The front door: a club with a published Code of conduct asks for I agree.
  const [d] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'code-of-conduct', 'Code of conduct.md', ${sql.json({ org: { lifecycle: "published", readVersion: 0 } })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${id}, ${d!.id}, 1, ${"# Code of conduct\n\n## Rules\n1. Be kind\n2. Share the tools"}, 'c1') RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${d!.id}`;
  await assert.rejects(() => join.joinOrgByCode(newbie!, code, null, { agreed: false }), /Agree to the Code of conduct/);
  assert.equal((await join.joinOrgByCode(newbie!, code, null, { agreed: true }))?.outcome, "joined");
  viewerId = newbie!;
  const me = await fd.readMyCommunityAction(id);
  assert.ok(me.success && JSON.stringify(me).includes("Join a committee"), "club Getting started");

  // Recruiting: officers only; it shows while the dates cover today and turns itself off.
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await club.saveRecruitingAction(id, { from: today, to: later, line: "Taster night", firstEventId: null })).success, false, "members don't set it");
  viewerId = coord!;
  assert.match(String((await club.saveRecruitingAction(id, { from: later, to: today, line: "", firstEventId: null }) as { error?: string }).error), /end date/);
  assert.ok((await club.saveRecruitingAction(id, { from: today, to: later, line: "Taster night", firstEventId: null })).success);
  viewerId = visitor!;
  const seen = await club.readRecruitingAction(id);
  assert.ok(seen.success && seen.recruiting && seen.line === "Taster night" && seen.poster === null && seen.settings === null, "visitors see the banner, not the settings or poster");
  assert.equal((await club.readDriveCountsAction(id)).success, false);
  viewerId = coord!;
  const counts = await club.readDriveCountsAction(id);
  assert.ok(counts.success && counts.counts?.joined === 2, "joined during the drive (the newcomer and the coordinator, counted as numbers)");
  const poster = await club.readRecruitingAction(id);
  assert.ok(poster.success && poster.poster?.code === code);

  // Discover: Recruiting now lists the club only while recruiting.
  // Security review: a members-only first event never reaches visitors; a public one does.
  const [ev] = await sql`INSERT INTO tasks (workspace_id, title, item_type, stage, status, type_fields, creator_id, task_number)
    VALUES (${id}, 'WT Members social', 'event', 'scheduled', 'todo', ${sql.json({ who: "members", start: "2099-01-01T10:00:00Z" })}, ${pres!}, 9101) RETURNING id`;
  viewerId = coord!;
  assert.ok((await club.saveRecruitingAction(id, { from: today, to: later, line: "Taster night", firstEventId: ev!.id })).success);
  viewerId = visitor!;
  assert.ok(((await club.readRecruitingAction(id)) as { firstEvent: unknown }).firstEvent === null);
  await sql`UPDATE tasks SET type_fields = type_fields || ${sql.json({ who: "public" })} WHERE id = ${ev!.id}`;
  assert.equal(((await club.readRecruitingAction(id)) as { firstEvent: { title: string } | null }).firstEvent?.title, "WT Members social");
  // The same condition src/lib/data/discover.ts adds for Recruiting now.
  const [on] = await sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ${id} AND org_type = 'club'
    AND (org_settings->'club'->'recruiting'->>'from') <= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AND (org_settings->'club'->'recruiting'->>'to') >= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  assert.equal(on!.n, 1);
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{club,recruiting,to}', ${sql.json("2000-01-02")}) , updated_at = now() WHERE id = ${id}`;
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{club,recruiting,from}', ${sql.json("2000-01-01")}) WHERE id = ${id}`;
  viewerId = visitor!;
  const off = await club.readRecruitingAction(id);
  assert.ok(off.success && !off.recruiting, "it turns itself off after the end date");
});

test("36.2 call 6: Season renewal asks once, answers for officers only, ends only non-officers who didn't stay, after the window", async () => {
  const [pres, coord, stay, leave, quiet, fresh] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, pres!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${id}, ${pres!}, 'owner', now() - interval '2 years'), (${id}, ${coord!}, 'admin', now() - interval '1 year'),
    (${id}, ${stay!}, 'member', now() - interval '1 year'), (${id}, ${leave!}, 'member', now() - interval '1 year'), (${id}, ${quiet!}, 'member', now() - interval '1 year'), (${id}, ${fresh!}, 'member', now() - interval '5 days')`;
  const season = new Date().toISOString().slice(0, 10);
  viewerId = stay!;
  assert.equal((await club.saveRenewalAction(id, { on: true, season, ask: "Staying this Season?", days: 30 })).success, false);
  viewerId = coord!;
  assert.ok((await club.saveRenewalAction(id, { on: true, season, ask: "Staying this Season?", days: 30 })).success);
  const [asked] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE dedupe_key LIKE ${`club-renewal:ask:${id}:%`}`;
  assert.equal(asked!.n, 4, "each member asked once, not the one who started it, not the one who just joined");
  viewerId = stay!;
  assert.ok((await club.answerRenewalAction(id, "staying")).success);
  const mine = await club.readRenewalAction(id);
  assert.ok(mine.success && mine.on && mine.mine === "staying" && mine.people.length === 0, "members never see others' answers");
  viewerId = leave!;
  assert.ok((await club.answerRenewalAction(id, "leaving")).success);
  viewerId = coord!;
  const view = await club.readRenewalAction(id);
  assert.ok(view.success && view.on && view.people.find((p) => p.id === quiet!)?.state === "not_answered" && view.people.find((p) => p.id === fresh!)?.state === "not_asked");
  assert.match(String((await club.endNotRenewedAction(id) as { error?: string }).error), /window has closed/, "nobody is removed before the window closes");
  const [still] = await sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${id} AND completed_at IS NULL`;
  assert.equal(still!.n, 6, "Leaving changes nothing on its own");
  // The window closes: the Season started 31 days ago.
  const earlier = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  await sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{club,renewal,season}', ${sql.json(earlier)}) WHERE id = ${id}`;
  await sql`UPDATE workspace_members SET view_prefs = jsonb_set(view_prefs, '{club,renewal,season}', ${sql.json(earlier)}) WHERE workspace_id = ${id} AND user_id IN (${stay!}, ${leave!})`;
  await sql`INSERT INTO profile_contributions (profile_id, workspace_id, source, role_kind) VALUES (${quiet!}, ${id}, 'membership', 'member')`;
  const ended = await club.endNotRenewedAction(id);
  assert.ok(ended.success && ended.ended === 2, "Leaving and Not answered end; Staying, officers and the new joiner stay");
  const left = await sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${id}`;
  const ids = left.map((r) => r.user_id);
  assert.ok(ids.includes(pres!) && ids.includes(coord!) && ids.includes(stay!) && ids.includes(fresh!) && !ids.includes(leave!) && !ids.includes(quiet!));
  const [why] = await sql`SELECT end_reason FROM profile_contributions WHERE profile_id = ${quiet!} AND workspace_id = ${id}`;
  assert.equal(why?.end_reason, "term_ended", "recorded as Season ended");
});

test("36.3 (B7.2a): positions give their role on accept and take back only what they gave; the presidency never; committees by officers; history", async () => {
  const [pres, coord, mia, raj, visitor] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, pres!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${pres!}, 'owner'), (${id}, ${coord!}, 'admin'), (${id}, ${mia!}, 'member'), (${id}, ${raj!}, 'member')`;
  viewerId = coord!;
  assert.equal((await pos.appointAction(id, "secretary", mia!)).success, false, "only the President appoints");
  viewerId = pres!;
  assert.match(String((await pos.appointAction(id, "president", mia!) as { error?: string }).error), /Transfer ownership/);
  assert.match(String((await pos.appointAction(id, "secretary", visitor!) as { error?: string }).error), /people in the club/);
  assert.ok((await pos.appointAction(id, "secretary", mia!)).success);
  assert.match(String((await pos.appointAction(id, "secretary", raj!) as { error?: string }).error), /already has someone/);
  assert.ok((await pos.appointAction(id, "treasurer", coord!)).success, "a Coordinator already can hold one");
  viewerId = visitor!;
  const before = await pos.readCommitteeAction(id);
  assert.ok(before.success && !before.positions.some((p) => p.holder), "visitors don't see offers that weren't accepted");
  viewerId = mia!;
  const offer = await pos.readCommitteeAction(id);
  const sec = offer.success ? offer.positions.find((p) => p.id === "secretary")!.holder! : null;
  assert.ok((await pos.answerAppointmentAction(id, sec!.termId, true)).success);
  const [miaRole] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${mia!}`;
  assert.equal(miaRole!.role, "admin", "holding Secretary makes her a Coordinator");
  viewerId = coord!;
  const coordView = await pos.readCommitteeAction(id);
  const tre = coordView.success ? coordView.positions.find((p) => p.id === "treasurer")!.holder! : null;
  assert.ok((await pos.answerAppointmentAction(id, tre!.termId, true)).success);
  assert.ok((await pos.endTermAction(id, tre!.termId)).success, "stepping down");
  const [coordRole] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${coord!}`;
  assert.equal(coordRole!.role, "admin", "a role the term didn't give stays");
  viewerId = pres!;
  assert.ok((await pos.endTermAction(id, sec!.termId)).success);
  const [miaAfter] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${mia!}`;
  assert.equal(miaAfter!.role, "member", "the role the term gave goes with it");
  // History: a new Season keeps the past, ends last Season's terms and takes back the roles they gave (security review).
  const settings = await pos.readCommitteeAction(id);
  assert.ok(settings.success);
  await sql`INSERT INTO club_position_terms (org_id, position_id, position_label, season, user_id, holder_name, how, state, gave_role)
    VALUES (${id}, 'events', 'Events officer', ${settings.success ? settings.season : ""}, ${raj!}, 'Raj', 'appointment', 'holding', true)`;
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${id} AND user_id = ${raj!}`;
  assert.ok((await pos.savePositionsAction(id, { season: "2099–00", positions: settings.success ? settings.positions.map(({ id: pid, label, filled, gives, docId }) => ({ id: pid, label, filled, gives, docId })) : [] })).success);
  const [rajAfter] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${raj!}`;
  assert.equal(rajAfter!.role, "member", "last Season's Events officer is no longer a Coordinator");
  const [coordStill] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${coord!}`;
  assert.equal(coordStill!.role, "admin", "a Coordinator not made by a term stays one");
  viewerId = raj!;
  const hist = await pos.readCommitteeAction(id);
  assert.ok(hist.success && hist.history.some((h) => h.position === "Secretary" && h.season !== "2099–00"), "past Seasons are kept");
  // Committees: officers start them in a club; members can't.
  assert.match(String((await groups.startGroupAction(id, { title: "WT Events committee", kind: "committee", purpose: "", meets: "", cap: 20, join: "open", chapterId: null }) as { error?: string }).error), /Officers start committees/);
  viewerId = coord!;
  assert.match(String((await groups.startGroupAction(id, { title: "WT Study club", kind: "study", purpose: "", meets: "", cap: 20, join: "open", chapterId: null }) as { error?: string }).error), /Officers start committees/, "a club's groups are committees");
  const made = await groups.startGroupAction(id, { title: "WT Events committee", kind: "committee", purpose: "Plan the term's events", meets: "", cap: 20, join: "ask", chapterId: null });
  assert.ok(made.success);
  viewerId = raj!;
  const joined = await groups.joinGroupAction(id, made.success ? made.id : "");
  assert.ok(joined.success && joined.outcome === "asked", "Ask sends a request to the chair");
});

test("36.3 (B7.2b): secret ballots — never joinable to a voter; one vote; the returning officer can't stand; run-off on a tie; winners hold", async () => {
  const [pres, ro, ann, bob, cat, dan] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, pres!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active', org_settings = ${sql.json({ club: { committee: { season: "2026–27", positions: [
    { id: "president", label: "President", filled: "election", gives: "president", docId: null }, { id: "secretary", label: "Secretary", filled: "election", gives: "coordinator", docId: null }] } } })} WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${pres!}, 'owner'), (${id}, ${ro!}, 'member'), (${id}, ${ann!}, 'member'), (${id}, ${bob!}, 'member'), (${id}, ${cat!}, 'member'), (${id}, ${dan!}, 'viewer')`;

  // Storage: ballots have no voter column; the voted record has no choice; they share no id.
  const cols = async (t: string) => (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${t}`).map((c) => String(c.column_name)).sort();
  assert.deepEqual(await cols("club_ballots"), ["choice_id", "election_id", "id", "position_id", "round"], "a ballot never names its voter");
  assert.deepEqual(await cols("club_voted"), ["election_id", "position_id", "round", "user_id"], "the voted record never holds a choice");

  viewerId = ann!;
  assert.equal((await el.startElectionAction(id, { season: "2027–28", returningOfficerId: ro!, showCounts: true })).success, false, "the President starts it");
  viewerId = pres!;
  assert.ok((await el.startElectionAction(id, { season: "2027–28", returningOfficerId: ro!, showCounts: true })).success);
  assert.match(String((await el.startElectionAction(id, { season: "x", returningOfficerId: ro!, showCounts: false }) as { error?: string }).error), /already running/);
  viewerId = ann!;
  assert.match(String((await el.nominateAction(id, "secretary", ro!) as { error?: string }).error), /returning officer can’t stand/);
  assert.ok((await el.nominateAction(id, "secretary", ann!)).success);
  assert.ok((await el.nominateAction(id, "secretary", bob!)).success);
  assert.ok((await el.answerNominationAction(id, "secretary", { stand: true, statement: "Minutes within a day." })).success);
  viewerId = bob!;
  assert.ok((await el.answerNominationAction(id, "secretary", { stand: true, statement: "I'll keep the records tidy." })).success);
  assert.equal((await el.openVotingAction(id)).success, false, "only the returning officer opens voting");
  viewerId = ro!;
  assert.ok((await el.openVotingAction(id)).success);

  // Round 1: a tie (Ann 1, Bob 1, Cat abstains).
  viewerId = ann!; assert.ok((await el.voteAction(id, "secretary", ann!)).success);
  assert.match(String((await el.voteAction(id, "secretary", bob!) as { error?: string }).error), /voted for this position/, "one vote");
  viewerId = bob!; assert.ok((await el.voteAction(id, "secretary", bob!)).success);
  viewerId = cat!; assert.ok((await el.voteAction(id, "secretary", null)).success);
  viewerId = dan!; assert.equal((await el.voteAction(id, "secretary", ann!)).success, false, "Viewers don't vote");
  const late = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${late}, 'member')`;
  viewerId = late; assert.equal((await el.voteAction(id, "secretary", ann!)).success, false, "security review: someone who joins after the election starts doesn't vote");
  const view = await (async () => { viewerId = cat!; return el.readElectionAction(id); })();
  assert.ok(view.success && "positions" in view && view.positions.find((p) => p.id === "secretary")!.turnout === 3);
  viewerId = ro!;
  const close1 = await el.closeVotingAction(id);
  assert.ok(close1.success && close1.runoffs === 1, "a tie goes to a run-off");
  // Run-off round 2: Ann wins.
  viewerId = ann!; assert.ok((await el.voteAction(id, "secretary", ann!)).success);
  viewerId = cat!; assert.ok((await el.voteAction(id, "secretary", ann!)).success);
  viewerId = bob!; assert.ok((await el.voteAction(id, "secretary", bob!)).success);
  viewerId = ro!;
  const close2 = await el.closeVotingAction(id);
  assert.ok(close2.success && close2.runoffs === 0);
  const res = await el.readElectionAction(id);
  const sec = res.success && "positions" in res ? res.positions.find((p) => p.id === "secretary")! : null;
  assert.equal(sec?.result?.winner?.id, ann!);
  assert.deepEqual(sec?.result?.counts?.map((c) => c.n).sort(), [1, 2]);
  const [term] = await sql`SELECT state, how, season FROM club_position_terms WHERE org_id = ${id} AND user_id = ${ann!} AND position_id = 'secretary'`;
  assert.deepEqual({ ...term }, { state: "holding", how: "election", season: "2027–28" });
  const [counts] = await sql`SELECT (SELECT count(*)::int FROM club_ballots b JOIN club_elections e ON e.id = b.election_id WHERE e.org_id = ${id}) AS ballots,
    (SELECT count(*)::int FROM club_voted v JOIN club_elections e ON e.id = v.election_id WHERE e.org_id = ${id}) AS voted`;
  assert.deepEqual({ ...counts }, { ballots: 6, voted: 6 }, "one ballot per voted record, and nothing ties them");
});

test("36.3 (B7.2c): the handover — checklist, open work moves, roles switch on the date and outgoing officers lose Coordinator", async () => {
  const [pres, sam, ann, eve, tom, tia] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, pres!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active', org_settings = ${sql.json({ club: { committee: { season: "2026–27", positions: [
    { id: "president", label: "President", filled: "election", gives: "president", docId: null }, { id: "secretary", label: "Secretary", filled: "election", gives: "coordinator", docId: null },
    { id: "events", label: "Events officer", filled: "appointment", gives: "coordinator", docId: null }, { id: "tech", label: "Tech officer", filled: "appointment", gives: "coordinator", docId: null }] } } })} WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${pres!}, 'owner'), (${id}, ${sam!}, 'admin'), (${id}, ${ann!}, 'member'), (${id}, ${eve!}, 'admin'), (${id}, ${tom!}, 'admin'), (${id}, ${tia!}, 'member')`;
  const term = async (pos: string, u: string, season: string) => (await sql`INSERT INTO club_position_terms (org_id, position_id, position_label, season, user_id, holder_name, how, state, gave_role)
    VALUES (${id}, ${pos}, ${pos}, ${season}, ${u}, 'WT Holder', 'appointment', 'holding', ${season === "2026–27"}) RETURNING id`)[0]!.id as string;
  const samTerm = await term("secretary", sam!, "2026–27");
  await term("events", eve!, "2026–27");
  await term("tech", tom!, "2026–27");
  await term("events", eve!, "2027–28");
  await term("tech", tia!, "2027–28");
  const [t1] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, creator_id, task_number) VALUES (${id}, 'WT Minutes', 'todo', ${sam!}, ${pres!}, 9301), (${id}, 'WT Done one', 'done', ${sam!}, ${pres!}, 9302),
    (${id}, 'WT Site', 'in_progress', ${tom!}, ${pres!}, 9303), (${id}, 'WT Agenda', 'in_progress', ${sam!}, ${pres!}, 9304) RETURNING id`;
  assert.ok(t1);
  await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'wt-minutes-book', 'Minutes book.md', ${sql.json({ org: { lifecycle: "published", owner: sam! } })})`;
  await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${id}, 'wt-sam-draft', 'Sam draft.md', ${sql.json({ org: { lifecycle: "draft", owner: sam! } })})`;
  // A committee (a group of the club): Sam's open task there moves too, since Ann belongs to it.
  const committee = await sql.begin((tx) => createProject(tx, pres!, {}));
  created.push(committee);
  await sql`UPDATE workspaces SET org_settings = ${sql.json({ groupOf: id, group: { kind: "committee" } })} WHERE id = ${committee}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${committee}, ${ann!}, 'member')`;
  await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, creator_id, task_number) VALUES (${committee}, 'WT Committee minutes', 'todo', ${sam!}, ${pres!}, 9311)`;

  viewerId = sam!;
  assert.equal((await ho.saveHandoverAction(id, { season: "2027–28", date: "2099-04-01" })).success, false, "the President sets the handover");
  viewerId = pres!;
  assert.match(String((await ho.saveHandoverAction(id, { season: "2026–27", date: "2099-04-01" }) as { error?: string }).error), /its own name/);
  assert.ok((await ho.saveHandoverAction(id, { season: "2027–28", date: "2026-12-01" })).success);
  assert.ok((await pos.appointAction(id, "secretary", ann!, "2027–28")).success, "the incoming Season can be appointed");
  assert.equal((await pos.appointAction(id, "secretary", ann!, "2030–31")).success, false, "only the current or incoming Season");

  viewerId = ann!;
  assert.equal((await ho.tickHandoverAction(id, samTerm, "role_page", true)).success, false, "only the outgoing officer (or the President) ticks");
  const seen = await ho.readHandoverAction(id);
  assert.ok(seen.success && seen.handover && "rows" in seen, "the incoming officer sees the handover");
  viewerId = sam!;
  assert.equal((await ho.tickHandoverAction(id, samTerm, "tasks", true)).success, false, "moving work is ticked by moving it");
  assert.ok((await ho.tickHandoverAction(id, samTerm, "role_page", true)).success);
  assert.match(String((await ho.moveWorkAction(id, samTerm) as { error?: string }).error), /accepts the position first/);
  viewerId = ann!;
  const offer = (await sql`SELECT id FROM club_position_terms WHERE org_id = ${id} AND user_id = ${ann!} AND state = 'offered'`)[0]!.id as string;
  assert.ok((await pos.answerAppointmentAction(id, offer, true)).success);
  assert.equal((await sql`SELECT role FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${ann!}`)[0]!.role, "member", "the incoming role comes on the date, not now");
  viewerId = sam!;
  const moved = await ho.moveWorkAction(id, samTerm);
  assert.ok(moved.success && moved.tasks === 3 && moved.docs === 1, "open tasks (in the club and its committee) and owned documents move; done ones stay");
  const [draft] = await sql`SELECT settings->'org'->>'owner' AS owner FROM workspace_documents WHERE workspace_id = ${id} AND slug = 'wt-sam-draft'`;
  assert.equal(draft!.owner, sam!, "security review: a private draft never moves (ownership would open it)");
  const view = await ho.readHandoverAction(id);
  const row = view.success && "rows" in view ? view.rows!.find((r) => r.id === "secretary") : null;
  assert.equal(row?.done, 3, "role page, tasks, documents");

  // The date: roles switch; outgoing lose Coordinator; a holder who carries on keeps it; unmoved work moves anyway.
  const r1 = await srv.handoverSteps(new Date("2026-12-01T01:00:00Z"));
  assert.equal(r1.switched, 1);
  const roles = Object.fromEntries((await sql`SELECT user_id, role FROM workspace_members WHERE workspace_id = ${id}`).map((m) => [String(m.user_id), String(m.role)]));
  assert.equal(roles[sam!], "member", "the outgoing Secretary loses Coordinator");
  assert.equal(roles[tom!], "member");
  assert.equal(roles[ann!], "admin", "the incoming Secretary becomes a Coordinator");
  assert.equal(roles[tia!], "admin");
  assert.equal(roles[eve!], "admin", "someone who carries on keeps it");
  const [site] = await sql`SELECT assignee_id FROM tasks WHERE workspace_id = ${id} AND task_number = 9303`;
  assert.equal(site!.assignee_id, tia!, "work the outgoing officer didn't move moves anyway (edge 12)");
  const [w] = await sql`SELECT org_settings->'club'->'committee'->>'season' AS season, org_settings->'club'->'handover' ? 'switchedAt' AS switched FROM workspaces WHERE id = ${id}`;
  assert.deepEqual({ ...w }, { season: "2027–28", switched: true });
  assert.equal((await sql`SELECT count(*)::int AS n FROM club_position_terms WHERE org_id = ${id} AND season = '2026–27' AND state = 'holding'`)[0]!.n, 0);
  assert.equal((await srv.handoverSteps(new Date("2026-12-01T02:00:00Z"))).switched, 0, "once");
  // Next Season, Eve steps down: the role her carried-on term holds goes with it.
  const eveTerm = (await sql`SELECT id FROM club_position_terms WHERE org_id = ${id} AND user_id = ${eve!} AND state = 'holding'`)[0]!.id as string;
  viewerId = eve!;
  assert.ok((await pos.endTermAction(id, eveTerm)).success);
  assert.equal((await sql`SELECT role FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${eve!}`)[0]!.role, "member");
});

test("36.5 (B7.4a): competitions — tryouts with private outcomes, accepted places, team workspaces that can't see each other", async () => {
  const [pres, coord, ann, bob, cat, dan, vic] = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, pres!, { visibility: "public" }));
  created.push(id);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'club', status = 'active' WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${pres!}, 'owner'), (${id}, ${coord!}, 'admin'), (${id}, ${ann!}, 'member'), (${id}, ${bob!}, 'member'),
    (${id}, ${cat!}, 'member'), (${id}, ${dan!}, 'member'), (${id}, ${vic!}, 'viewer')`;
  const details = { title: "WT Robocon 2027", organiser: "IIT Delhi", category: "Robotics", starts: "2099-03-14", ends: "2099-03-16", registerBy: "2099-01-20", place: "IIT Delhi", link: "https://robocon.example", teamSize: 3, subs: 1, picking: "tryouts" as const };
  viewerId = ann!;
  assert.equal((await comp.saveCompetitionAction(id, null, details)).success, false, "officers add competitions");
  viewerId = coord!;
  const made = await comp.saveCompetitionAction(id, null, details);
  assert.ok(made.success);
  const cid = made.id;
  const [row] = await sql`SELECT item_type, stage, on_board FROM tasks WHERE id = ${cid}`;
  assert.deepEqual({ ...row }, { item_type: "competition", stage: "planned", on_board: false }, "a club item, never on the board");
  viewerId = ann!;
  assert.match(String((await comp.signUpAction(id, cid, { handIn: "x" }) as { error?: string }).error), /isn’t open/);
  viewerId = coord!;
  assert.ok((await comp.setCompetitionStageAction(id, cid, "picking")).success);
  viewerId = ann!;
  assert.match(String((await comp.signUpAction(id, cid, { wish: "Driver" }) as { error?: string }).error), /needs your hand-in/);
  assert.ok((await comp.signUpAction(id, cid, { wish: "Driver", handIn: "My line-follower video: https://example.com/v" })).success);
  viewerId = bob!; assert.ok((await comp.signUpAction(id, cid, { wish: "Programming", handIn: "A PID write-up" })).success);
  viewerId = vic!; assert.equal((await comp.signUpAction(id, cid, { handIn: "x" })).success, false, "Viewers don't try out");

  // Outcomes stay between the person and the officers (server test).
  viewerId = ann!;
  assert.equal((await comp.readPickingAction(id, cid)).success, false, "members never read the picking list");
  viewerId = coord!;
  const pick = await comp.readPickingAction(id, cid);
  assert.ok(pick.success && pick.people.length === 2 && pick.people.every((p) => p.state === "trying" && p.handIn));
  const rowOf = (u: string) => pick.success ? pick.people.find((p) => p.userId === u)!.id : "";
  assert.ok((await comp.decidePlaceAction(id, rowOf(ann!), true)).success);
  assert.ok((await comp.decidePlaceAction(id, rowOf(bob!), false)).success);
  const told = await sql`SELECT user_id, title FROM user_notifications WHERE user_id IN (${pres!}, ${coord!}, ${ann!}, ${bob!}, ${cat!}, ${dan!}, ${vic!})
    AND title LIKE ${"%WT Robocon 2027%"} AND (title LIKE 'You’re selected%' OR title LIKE '%Not this time%')`;
  assert.deepEqual(told.map((n) => String(n.user_id)).sort(), [ann!, bob!].sort(), "each outcome reaches only that person");
  viewerId = ann!;
  const mine = await comp.readCompetitionsAction(id);
  assert.ok(mine.success && mine.competitions[0]!.mine?.state === "selected" && mine.competitions[0]!.counts === null, "a member sees only their own place");
  viewerId = bob!;
  const his = await comp.readCompetitionsAction(id);
  assert.ok(his.success && his.competitions[0]!.mine?.state === "not_this_time");

  viewerId = ann!; assert.ok((await comp.answerPlaceAction(id, cid, true)).success);
  viewerId = coord!;
  assert.ok((await comp.offerPlaceAction(id, cid, cat!)).success);
  assert.ok((await comp.offerPlaceAction(id, cid, dan!)).success);
  viewerId = cat!; assert.ok((await comp.answerPlaceAction(id, cid, true)).success);
  viewerId = dan!; assert.ok((await comp.answerPlaceAction(id, cid, true)).success);
  viewerId = coord!;
  assert.match(String((await comp.makeTeamAction(id, cid, { name: "Team A", captainId: ann!, people: [{ userId: ann!, role: "Driver", substitute: false }, { userId: bob!, role: "", substitute: false }] }) as { error?: string }).error), /accepted a place/);
  const a = await comp.makeTeamAction(id, cid, { name: "Team A", captainId: ann!, people: [{ userId: ann!, role: "Driver", substitute: false }, { userId: cat!, role: "", substitute: true }] });
  assert.ok(a.success, JSON.stringify(a));
  const b = await comp.makeTeamAction(id, cid, { name: "Team B", captainId: dan!, people: [{ userId: dan!, role: "Programming", substitute: false }] });
  assert.ok(b.success, JSON.stringify(b));
  const [ws] = await sql`SELECT parent_id, visibility, owner_id FROM workspaces WHERE id = ${a.success ? a.workspaceId : ""}`;
  assert.deepEqual([ws!.parent_id, ws!.visibility, ws!.owner_id], [id, "private", ann!], "a private workspace under the club, the captain its lead");
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${a.success ? a.workspaceId : ""} AND user_id = ${cat!}`)[0]!.n, 1);
  // Two teams in one competition never see each other's work.
  const { getWorkspaceAccessById } = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  assert.equal((await getWorkspaceAccessById(a.success ? a.workspaceId : "", dan!)).canRead, false);
  assert.equal((await getWorkspaceAccessById(b.success ? b.workspaceId : "", ann!)).canRead, false);
  viewerId = ann!;
  const list = await comp.readCompetitionsAction(id);
  assert.ok(list.success);
  assert.deepEqual(list.competitions[0]!.teams.map((t) => [t.name, t.size, t.subs, t.mine]), [["Team A", 1, 1, true], ["Team B", 1, 0, false]]);
});

