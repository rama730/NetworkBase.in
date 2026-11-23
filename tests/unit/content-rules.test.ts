import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.8 T5 part 7 (plan A2.7): content settings and rules.
test("setupChannels: Blog gives Blog and Newsletter (on Updates); Social gives six platforms; both together", async () => {
  const { setupChannels } = await import("../../src/lib/workflows/content");
  assert.deepEqual(setupChannels(["blog"]).map((c) => `${c.name}:${c.updates}`), ["Blog:true", "Newsletter:false"]);
  assert.deepEqual(setupChannels(["social"]).map((c) => c.name), ["Instagram", "TikTok", "YouTube", "LinkedIn", "X", "Facebook"]);
  assert.equal(setupChannels(["blog", "social"]).length, 8);
  assert.equal(new Set(setupChannels(["blog", "social"]).map((c) => c.id)).size, 8, "ids are unique");
});

test("contentSettingsSchema: up to 20 channels and 20 types, checklists up to 10 steps, a default time", async () => {
  const { contentSettingsSchema, starterSettings } = await import("../../src/lib/workflows/content");
  const s = starterSettings(["social"]);
  assert.equal(contentSettingsSchema.safeParse(s).success, true);
  assert.equal(s.defaultTime, "10:00");
  assert.deepEqual(s.types.find((t) => t.name === "Reel")?.checklist, ["Hook", "Captions", "Cover image"]);
  assert.equal(contentSettingsSchema.safeParse({ ...s, defaultTime: "25:00" }).success, false);
  assert.equal(contentSettingsSchema.safeParse({ ...s, types: [{ ...s.types[0]!, checklist: Array.from({ length: 11 }, (_, i) => `S${i}`) }] }).success, false);
});

test("defaultPublishAt: 10:00 in Kolkata on Dec 3 is 04:30 UTC; New York keeps 10:00 across daylight saving", async () => {
  const { defaultPublishAt } = await import("../../src/lib/workflows/content");
  assert.equal(defaultPublishAt("2026-12-03", "10:00", "Asia/Kolkata"), "2026-12-03T04:30:00.000Z");
  assert.equal(defaultPublishAt("2026-10-30", "10:00", "America/New_York"), "2026-10-30T14:00:00.000Z");
  assert.equal(defaultPublishAt("2026-11-02", "10:00", "America/New_York"), "2026-11-02T15:00:00.000Z");
});

test("checklistFor: none, three steps; publishState: none, partial, all; archived channels aren't needed", async () => {
  const { checklistFor, publishState } = await import("../../src/lib/workflows/content");
  assert.deepEqual(checklistFor(undefined), []);
  assert.deepEqual(checklistFor({ checklist: ["Hook", "Captions", "Cover image"] }), ["Hook", "Captions", "Cover image"]);
  const ch = [{ id: "a", archived: false }, { id: "b", archived: false }, { id: "c", archived: true }];
  assert.equal(publishState(["a", "b"], {}, ch), "none");
  assert.equal(publishState(["a", "b"], { a: { link: "https://x" } }, ch), "partial");
  assert.equal(publishState(["a", "b", "c"], { a: { link: "https://x" }, b: { link: "https://y" } }, ch), "all");
});

test("weekDays: Monday to Sunday headings with each piece by its publish time", async () => {
  const { weekDays } = await import("../../src/lib/workflows/content");
  const items = [{ id: "1", publishAt: "2026-11-25T09:00:00.000Z" }, { id: "2", publishAt: "2026-11-25T04:30:00.000Z" }, { id: "3", publishAt: "2026-12-01T04:30:00.000Z" }];
  const days = weekDays("2026-11-23", items, "Asia/Kolkata");
  assert.equal(days.length, 7);
  assert.deepEqual(days[2]!.items.map((i) => i.id), ["2", "1"], "Wednesday, earliest first");
  assert.equal(days.flatMap((d) => d.items).length, 2, "next week's piece isn't in this week");
});

// Report 38.8 part 7 (plan A2.9): results, Performance and the Overview card.
test("resultsDue: 6 days no, 7 days yes, switched off no", async () => {
  const { resultsDue } = await import("../../src/lib/workflows/content");
  const now = new Date("2026-11-30T10:00:00Z");
  assert.equal(resultsDue("2026-11-24T10:00:00Z", now, true), false);
  assert.equal(resultsDue("2026-11-23T10:00:00Z", now, true), true);
  assert.equal(resultsDue("2026-11-23T10:00:00Z", now, false), false);
  assert.equal(resultsDue(null, now, true), false);
});

test("nbUpdateResults and performanceRows: an Update's likes and comments are live, views blank; typed numbers elsewhere", async () => {
  const { nbUpdateResults, performanceRows, publishedAt } = await import("../../src/lib/workflows/content");
  assert.deepEqual(nbUpdateResults({ likes: 4, comments: 2 }), { views: null, likes: 4, comments: 2, clicks: null });
  const rows = performanceRows([{ id: "a", title: "Guide", live: { blog: { likes: 4, comments: 2 } },
    typeFields: { published: { blog: { updateId: "u", at: "2026-11-20T10:00:00Z" }, linkedin: { link: "https://x", at: "2026-11-21T10:00:00Z" } }, results: { linkedin: { views: 900, clicks: 12 }, blog: { views: 5 } } } }]);
  assert.deepEqual(rows.map((r) => [r.channel, r.views, r.likes, r.comments, r.clicks, r.live]), [["blog", null, 4, 2, null, true], ["linkedin", 900, null, null, 12, false]]);
  assert.equal(publishedAt({ blog: { at: "2026-11-20T10:00:00Z" }, linkedin: { at: "2026-11-21T10:00:00Z" } }), "2026-11-21T10:00:00Z", "the last channel's time");
  assert.equal(publishedAt({}), null);
});

test("postsPerWeek: counts by channel per Monday week in the workspace's zone; older weeks fall off", async () => {
  const { postsPerWeek } = await import("../../src/lib/workflows/content");
  const weeks = postsPerWeek([
    { channel: "blog", at: "2026-11-23T10:00:00Z" }, { channel: "x", at: "2026-11-24T10:00:00Z" }, { channel: "x", at: "2026-11-25T10:00:00Z" },
    { channel: "blog", at: "2026-11-22T20:00:00Z" }, // Monday 01:30 in Kolkata
    { channel: "blog", at: "2026-01-01T10:00:00Z" },
  ], "Asia/Kolkata", "2026-11-23", 2);
  assert.deepEqual(weeks, [{ week: "2026-11-16", counts: {} }, { week: "2026-11-23", counts: { blog: 2, x: 2 } }]);
});

test("contentSummary: this week's publishing pieces, waiting for edit, and the next one", async () => {
  const { contentSummary } = await import("../../src/lib/workflows/content");
  const p = (title: string, stage: string, publishAt?: string) => ({ title, stage, typeFields: publishAt ? { publishAt } : {} });
  const s = contentSummary([p("Old", "published", "2026-11-24T10:00:00Z"), p("Guide", "scheduled", "2026-11-26T10:00:00Z"), p("Post", "editing", "2026-11-25T10:00:00Z"),
    p("Later", "drafting", "2026-12-10T10:00:00Z"), p("Idea", "idea")], new Date("2026-11-24T12:00:00Z"), "UTC", "2026-11-23");
  assert.deepEqual(s, { thisWeek: 2, editing: 1, next: { title: "Post", at: "2026-11-25T10:00:00Z" } });
});
