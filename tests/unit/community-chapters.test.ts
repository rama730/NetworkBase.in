import assert from "node:assert/strict";
import { test } from "node:test";

import { chapterFlags, proposalSchema, readChapterSettings } from "../../src/lib/organizations/chapters";

const now = new Date("2026-11-26T12:00:00Z");
test("34.6 calls 6–7: Needs a co-organiser with one organiser; Dormant after the set days without events or posts", () => {
  assert.deepEqual(chapterFlags(1, "2026-11-20T00:00:00Z", "2026-01-01T00:00:00Z", now, 180), { needsCoOrganiser: true, dormant: false });
  assert.deepEqual(chapterFlags(2, "2026-05-01T00:00:00Z", "2026-01-01T00:00:00Z", now, 180), { needsCoOrganiser: false, dormant: true });
  assert.equal(chapterFlags(2, null, "2026-11-01T00:00:00Z", now, 180).dormant, false, "a new chapter isn't dormant");
});
test("34.6 settings and proposals: members propose by default; Dormant after 30–730 days; places are typed", () => {
  assert.deepEqual(readChapterSettings(null), { proposeBy: "members", dormantDays: 180, kitAbout: "" });
  assert.equal(readChapterSettings({ community: { chapters: { dormantDays: 5 } } }).dormantDays, 180);
  assert.ok(proposalSchema.safeParse({ name: "Bangalore", kind: "local", place: "Bengaluru", why: "", coOrganiserId: null }).success);
  assert.equal(proposalSchema.safeParse({ name: "B", kind: "local", place: "x", why: "", coOrganiserId: null }).success, false);
});
