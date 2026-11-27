import assert from "node:assert/strict";
import { test } from "node:test";

import { isRecruiting, readRecruiting } from "../../src/lib/organizations/club";
import { CLUB_GETTING_STARTED, hasFrontDoor, readCommunitySettings } from "../../src/lib/organizations/community";

// Report 36.2 (B7.1a): the recruiting period turns itself off; clubs share the front door with club Getting started.
test("recruiting: from the start date through the end date, then off", () => {
  const r = readRecruiting({ club: { recruiting: { from: "2026-09-01", to: "2026-09-14", line: "Taster night", firstEventId: null } } });
  assert.ok(r);
  assert.equal(isRecruiting(r, "2026-08-31"), false);
  assert.equal(isRecruiting(r, "2026-09-01"), true);
  assert.equal(isRecruiting(r, "2026-09-14"), true);
  assert.equal(isRecruiting(r, "2026-09-15"), false);
  assert.equal(readRecruiting({ club: { recruiting: { from: "2026-09-14", to: "2026-09-01", line: "", firstEventId: null } } }), null, "an end before the start is no period");
});

test("clubs get the front door and their own Getting started", () => {
  assert.ok(hasFrontDoor("club") && hasFrontDoor("community") && !hasFrontDoor("company"));
  assert.deepEqual(readCommunitySettings({}, "club").gettingStarted, CLUB_GETTING_STARTED);
  assert.notDeepEqual(readCommunitySettings({}, "community").gettingStarted, CLUB_GETTING_STARTED);
});

test("Season renewal: states, new joiners not asked, the window", async () => {
  const { renewalState, windowClosed } = await import("../../src/lib/organizations/club");
  const r = { on: true, season: "2026-09-01", ask: "Staying this Season?", days: 30 };
  assert.equal(renewalState(r, null, "2025-01-01T00:00:00Z"), "not_answered");
  assert.equal(renewalState(r, { season: "2026-09-01", answer: "staying" }, "2025-01-01T00:00:00Z"), "staying");
  assert.equal(renewalState(r, { season: "2025-09-01", answer: "staying" }, "2025-01-01T00:00:00Z"), "not_answered", "last Season's answer doesn't count");
  assert.equal(renewalState(r, null, "2026-08-20T00:00:00Z"), "not_asked", "joined in the 30 days before");
  assert.equal(windowClosed(r, "2026-09-30"), false);
  assert.equal(windowClosed(r, "2026-10-01"), true);
});

test("positions: the starter list and a Season name until the President saves their own", async () => {
  const { readPositions, STARTER_POSITIONS } = await import("../../src/lib/organizations/club");
  const p = readPositions({}, new Date("2026-11-27T00:00:00Z"));
  assert.equal(p.season, "2026–27");
  assert.deepEqual(p.positions, STARTER_POSITIONS);
  assert.equal(p.positions.filter((x) => x.gives === "president").length, 1);
  assert.equal(readPositions({}, new Date("2026-03-01T00:00:00Z")).season, "2025–26");
});

test("tally: the most votes wins; abstain counts only as turnout; a tie goes to a run-off; no votes leaves it open", async () => {
  const { tally } = await import("../../src/lib/organizations/club");
  assert.deepEqual(tally(["a", "b", "a", null], ["a", "b"]), { counts: { a: 2, b: 1 }, abstained: 1, winner: "a", tied: [] });
  assert.deepEqual(tally(["a", "b", null], ["a", "b", "c"]).tied, ["a", "b"]);
  assert.equal(tally(["a", "b"], ["a", "b"]).winner, null);
  assert.deepEqual(tally([null, null], ["a"]), { counts: { a: 0 }, abstained: 2, winner: null, tied: [] });
  assert.equal(tally(["x"], ["a"]).winner, null, "a choice that isn't a candidate counts for nobody");
});

test("handover: the checklist opens three weeks before; due on the date, once", async () => {
  const { checklistOpen, handoverDue, readHandover } = await import("../../src/lib/organizations/club");
  const h = { season: "2027–28", date: "2027-04-01" };
  assert.equal(checklistOpen(h, "2027-03-10"), false);
  assert.equal(checklistOpen(h, "2027-03-11"), true);
  assert.equal(handoverDue(h, "2027-03-31"), false);
  assert.equal(handoverDue(h, "2027-04-01"), true);
  assert.equal(handoverDue({ ...h, switchedAt: "2027-04-01T00:00:00Z" }, "2027-04-02"), false);
  assert.equal(readHandover({ club: { handover: { season: "", date: "2027-04-01" } } }), null);
});

test("constitution: an amendment adds, changes or removes one article; two-thirds of those voting", async () => {
  const { applyAmendment, amendmentLine, amendmentPasses, STARTER_ARTICLES, readClubMeetings } = await import("../../src/lib/organizations/club");
  const added = applyAmendment(STARTER_ARTICLES, { article: "4.1", title: "Tech officer", text: "A Tech officer looks after the club's tools." })!;
  assert.deepEqual(added.map((a) => a.n), ["1", "2", "3", "4", "4.1", "5", "6"]);
  assert.equal(applyAmendment(STARTER_ARTICLES, { article: "9", text: "No title" }), null, "a new article needs a title");
  assert.equal(applyAmendment(STARTER_ARTICLES, { article: "9", text: null }), null, "can't remove a missing article");
  assert.equal(applyAmendment(added, { article: "2", text: "Build robots." })!.find((a) => a.n === "2")!.text, "Build robots.");
  assert.equal(applyAmendment(added, { article: "4.1", text: null })!.length, 6);
  assert.equal(amendmentLine(STARTER_ARTICLES, { article: "4.1", title: "x", text: "y" }), "Article 4.1 added");
  assert.equal(amendmentPasses({ for: 2, against: 1 }, 2 / 3), true);
  assert.equal(amendmentPasses({ for: 27, against: 14 }, 2 / 3), false);
  assert.equal(amendmentPasses({ for: 0, against: 0 }, 2 / 3), false);
  assert.equal(readClubMeetings({ club: { meetings: { agendaDays: 3, propose: true, quorumShare: 0.25 } } }).amendThreshold, 2 / 3, "older settings get the default");
});

test("competitions: details checked, typed links only, days left as words", async () => {
  const { competitionSchema, daysLeft } = await import("../../src/lib/organizations/club");
  const base = { title: "Robocon 2027", organiser: "IIT Delhi", category: "Robotics", starts: "2027-03-14", ends: "2027-03-16", registerBy: "2027-01-20", place: "IIT Delhi", link: "https://robocon.example", teamSize: 5, subs: 1, picking: "tryouts" as const };
  assert.ok(competitionSchema.safeParse(base).success);
  assert.equal(competitionSchema.safeParse({ ...base, link: "javascript:alert(1)" }).success, false);
  assert.equal(competitionSchema.safeParse({ ...base, ends: "2027-03-01" }).success, false);
  assert.equal(daysLeft("2027-01-20", "2027-01-08"), "12 days left");
  assert.equal(daysLeft("2027-01-20", "2027-01-19"), "1 day left");
  assert.equal(daysLeft("2027-01-20", "2027-01-21"), "closed");
});

test("placing: results as words", async () => {
  const { placing } = await import("../../src/lib/organizations/club");
  assert.deepEqual([placing(1, 32), placing(2, null), placing(3, 10), placing(4, 32), placing(11, 40), placing(12, 40), placing(13, 40), placing(21, 40), placing(22, 40), placing(112, 200)],
    ["1st of 32", "2nd", "3rd of 10", "4th of 32", "11th of 40", "12th of 40", "13th of 40", "21st of 40", "22nd of 40", "112th of 200"]);
});


test("volunteers: shift times, the check-in window, Short within 14 days, hours from shifts", async () => {
  const { checkInOpen, isShort, readVolunteers, shiftHours, shiftSchema, volunteersFor } = await import("../../src/lib/organizations/volunteers");
  const start = "2099-12-06T08:00:00.000Z";
  const at = (iso: string) => Date.parse(iso);
  assert.equal(checkInOpen(start, at("2099-12-06T07:44:00Z")), false);
  assert.equal(checkInOpen(start, at("2099-12-06T07:45:00Z")), true);
  assert.equal(checkInOpen(start, at("2099-12-06T08:30:00Z")), true);
  assert.equal(checkInOpen(start, at("2099-12-06T08:31:00Z")), false);
  assert.equal(isShort(start, 3, 6, at("2099-12-04T08:00:00Z")), true);
  assert.equal(isShort(start, 6, 6, at("2099-12-04T08:00:00Z")), false);
  assert.equal(isShort(start, 3, 6, at("2099-11-01T08:00:00Z")), false, "more than 14 days away");
  assert.equal(shiftHours([{ start, end: "2099-12-06T11:00:00.000Z" }, { start: "2099-12-07T10:00:00.000Z", end: "2099-12-07T11:30:00.000Z" }]), 4.5);
  assert.equal(shiftSchema.safeParse({ roleId: "sorting", place: "", start, end: start, places: 8, note: "" }).success, false);
  assert.deepEqual(readVolunteers({}).roles, []);
  assert.deepEqual(["other", "community", "club"].map(volunteersFor), [true, false, false]);
});

test("fixed time: the countdown, offsets as words, starters inside their window", async () => {
  const { addDays, countdown, defaultEnd, offsetWords, readFixedTime, STARTERS } = await import("../../src/lib/organizations/fixed-time");
  const f = { keyDate: "2027-02-13", endDate: "2027-03-15" };
  assert.equal(countdown(f, "2027-01-21").line, "23 days to go");
  assert.equal(countdown(f, "2027-01-21").state, "planning");
  assert.deepEqual(countdown(f, "2027-02-10"), { state: "this_week", line: "3 days to go" });
  assert.deepEqual(countdown(f, "2027-02-13"), { state: "today", line: "Today" });
  assert.deepEqual(countdown(f, "2027-03-03"), { state: "wrap_up", line: "Wrap-up: 12 days left" });
  assert.equal(countdown(f, "2027-03-16").state, "ended");
  assert.deepEqual([offsetWords(-14), offsetWords(0), offsetWords(1)], ["14 days before", "On the day", "1 day after"]);
  assert.equal(defaultEnd("2027-02-13"), "2027-03-15");
  assert.equal(addDays("2027-02-13", -21), "2027-01-23");
  assert.ok(STARTERS.event!.tasks.every((t) => t.offset >= -56 && t.offset <= 14), "Event: 8 weeks before to 2 weeks after");
  assert.equal(readFixedTime({ fixedTime: { keyDate: "2027-02-13", endDate: "2027-02-01" } }), null, "the end comes on or after the key date");
});

test("fixed time: Run it again keeps the dates' distance, drops owners, pins the debrief; Next time lines become tasks", async () => {
  const { carryOver, nextTimeTasks } = await import("../../src/lib/organizations/fixed-time");
  const f = { keyDate: "2027-02-13", endDate: "2027-03-15", workstreams: [{ id: "venue", name: "Venue", owner: "u1" }], debrief: { summary: "Good year", well: "Volunteers", wrong: "Permit late", next: "- Apply for the permit in December\n• Book two sound techs\n" } };
  assert.deepEqual(carryOver(f, "2028-02-12", "Book Fest 2027"), { keyDate: "2028-02-12", endDate: "2028-03-13", workstreams: [{ id: "venue", name: "Venue", owner: null }],
    pinned: { ...f.debrief, from: "Book Fest 2027" } });
  assert.deepEqual(nextTimeTasks(f.debrief), ["Apply for the permit in December", "Book two sound techs"]);
});


test("programs: up to 5 measures, dates in order, values as text", async () => {
  const { measureLine, programSchema } = await import("../../src/lib/organizations/impact");
  const base = { title: "Reading circles", aim: "Children read weekly", place: "Whitefield", start: "2026-06-01", end: null, goal: "Children's literacy", ownerId: "11111111-1111-4111-8111-111111111111", public: true,
    measures: [{ id: "sessions", name: "Sessions held", source: "sessions" as const, target: 50 }], brief: { change: "", reality: "", whyNow: "", mission: "", serves: "Children 6-10", howWeKnow: "" } };
  assert.ok(programSchema.safeParse(base).success);
  assert.equal(programSchema.safeParse({ ...base, measures: Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: "x", source: "typed", target: null })) }).success, false);
  assert.equal(programSchema.safeParse({ ...base, end: "2026-01-01" }).success, false);
  assert.deepEqual([measureLine(46, 50), measureLine(null, 50), measureLine(12, null)], ["46 of 50", "not yet confirmed", "12"]);
});

test("kits: six kits from parts that exist; offered only when every part works; the word list suggests one", async () => {
  const { KITS, PARTS, kitReady, partsOn, readyKits, suggestKit } = await import("../../src/lib/organizations/kits");
  assert.deepEqual(KITS.map((k) => k.id), ["nonprofit", "event_team", "association", "public_sector", "faith", "blank"]);
  for (const k of KITS) for (const p of k.parts) assert.ok(PARTS[p], `${k.id}: ${p} is a known part`);
  assert.ok(readyKits().every(kitReady) && readyKits().some((k) => k.id === "blank"));
  assert.equal(KITS.find((k) => k.id === "event_team")!.needsEndDate, true, "the Event team kit needs an end date (X3)");
  assert.deepEqual(["Hostel committee", "Bengaluru Book Fest", "Food bank NGO", "St Mary's Church", "Ward council", "Chess club friends"].map(suggestKit),
    ["association", "event_team", "nonprofit", "faith", "public_sector", null]);
  assert.deepEqual(partsOn({ parts: { on: ["volunteers", "nope", 3] } }), ["volunteers"]);
});

test("kits: a ready kit saves its id and switches its parts on; Blank and unready kits save nothing", async () => {
  const { kitSettings, readyKits } = await import("../../src/lib/organizations/kits");
  assert.deepEqual(kitSettings("nonprofit"), { kit: "nonprofit", parts: { on: ["volunteers", "programs", "boardMeetings", "events"] } });
  assert.deepEqual(kitSettings("blank"), {});
  assert.deepEqual(kitSettings("association"), {}, "not ready yet: its parts don't work in Other organizations");
  assert.deepEqual(readyKits().map((k) => k.id), ["nonprofit", "event_team", "blank"]);
  assert.deepEqual(kitSettings("event_team", "2027-02-13"), { kit: "event_team", parts: { on: ["fixedTime", "volunteers", "events", "meetings"] }, fixedTime: { keyDate: "2027-02-13", endDate: "2027-03-15" } }, "the Event team kit keeps its event date");
});
