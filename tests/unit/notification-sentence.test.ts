import assert from "node:assert/strict";
import test from "node:test";

import { notificationSentence } from "../../src/lib/notifications/sentence";
import { awaySummary, splitTray, waitingLabel, whyYouGotIt } from "../../src/lib/notifications/tray-model";
import type { NotificationItem } from "../../src/lib/notifications/types";

const NOW = new Date("2026-11-27T12:00:00Z");
function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: over.id ?? Math.random().toString(36).slice(2), userId: "u", actorUserId: "a", kind: "task_comment_mention", importance: "more",
    title: "Ben mentioned you on Week 6 quiz", body: null, href: "/x", entityRefs: { projectId: "p", taskId: "t" },
    preview: { actorName: "Ben", contextLabel: "CSE 3B" }, reason: "mention", dedupeKey: "d", aggregateCount: 1,
    readAt: null, seenAt: null, dismissedAt: null, snoozedUntil: null,
    createdAt: NOW.toISOString(), activityAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
  };
}

test("a row reads as who, what, which: the actor's name leads and is split from the verb", () => {
  const s = notificationSentence(item());
  assert.equal(s.actor, "Ben");
  assert.equal(s.verb, " mentioned you on Week 6 quiz");
  assert.equal(s.context, "CSE 3B");
  assert.equal(s.glyph, "at");
});

test("a title without the actor stays whole; a quoted name becomes the bold object", () => {
  const s = notificationSentence(item({ actorUserId: null, preview: null, kind: "saved_search_matches", title: "4 new matches for your saved search “react”" }));
  assert.equal(s.actor, "");
  assert.equal(s.verb, "4 new matches for your saved search ");
  assert.equal(s.object, "“react”");
  assert.equal(s.glyph, "search");
});

test("every family gets its glyph and tint", () => {
  assert.equal(notificationSentence(item({ kind: "trust_safety" })).tone, "bad");
  assert.equal(notificationSentence(item({ kind: "merge_request" })).glyph, "branch");
  assert.equal(notificationSentence(item({ kind: "org_assignment" })).tone, "act");
  assert.equal(notificationSentence(item({ kind: "agent_session_summary" })).tone, "info");
  assert.equal(notificationSentence(item({ kind: "project_update_like" })).glyph, "heart");
});

test("waiting shows after a day, in days", () => {
  assert.equal(waitingLabel(new Date(NOW.getTime() - 5 * 3600_000).toISOString(), NOW), null);
  assert.equal(waitingLabel(new Date(NOW.getTime() - 49 * 3600_000).toISOString(), NOW), "waiting 2d");
});

test("the tray: Needs you rows never repeat in New; likes fold into Activity; Unread shows only unseen", () => {
  const linked = item({ id: "conn-row", kind: "connection_request_received", title: "Kiran Patel wants to connect" });
  const like1 = item({ kind: "project_update_like", title: "Rama liked your post" });
  const like2 = item({ kind: "project_update_like", title: "Ana liked your post" });
  const seen = item({ seenAt: NOW.toISOString(), title: "Old", entityRefs: { projectId: "p", taskId: "t2" } });
  const mention = item();
  const tray = splitTray([linked, like1, like2, seen, mention], [{ notificationId: "conn-row" }], "unread", NOW);
  assert.deepEqual(tray.fresh.map((b) => b.lead.title), ["Ben mentioned you on Week 6 quiz"]);
  assert.equal(tray.activity?.count, 2);
  assert.equal(tray.activity?.label, "2 likes today");
  const all = splitTray([linked, like1, seen, mention], [{ notificationId: "conn-row" }], "all", NOW);
  assert.equal(all.fresh.length + all.earlier.length, 2, "All shows the seen row too, still not the linked one or the like");
});

test("one row per thing: a comment, a mention and a status change on one task within a day are one thread", () => {
  const a = item({ kind: "task_comment_reply", title: "Ana replied on Week 6 quiz", preview: { actorName: "Ana" } });
  const b = item({ kind: "task_status_attention", title: "Week 6 quiz moved to In review", actorUserId: null, preview: null, activityAt: new Date(NOW.getTime() - 3600_000).toISOString() });
  const tray = splitTray([a, b], [], "unread", NOW);
  assert.equal(tray.fresh.length, 1);
  assert.equal(tray.fresh[0]!.items.length, 2);
});

test("away summary after a day; why line names the reason", () => {
  const items = [item(), item({ kind: "project_update_like" }), item({ kind: "project_update_like" })];
  assert.equal(awaySummary({ lastOpenedAt: new Date(NOW.getTime() - 3 * 86400_000).toISOString(), needsCount: 3, items, now: NOW }),
    "Since Tuesday: 3 need you · 3 new · 2 likes, 1 mention");
  assert.equal(awaySummary({ lastOpenedAt: new Date(NOW.getTime() - 3600_000).toISOString(), needsCount: 3, items, now: NOW }), null);
  assert.equal(whyYouGotIt(item()), "You were mentioned.");
  assert.equal(whyYouGotIt(item({ kind: "branch_saves" })), "You follow this branch.");
});

test("live check 2026-11-28: a task code (WT-7) is never named as the place you're a member of", () => {
  assert.equal(whyYouGotIt(item({ kind: "project_task_activity", preview: { contextLabel: "WT-7" } })), "You’re a member of this workspace.");
  assert.equal(whyYouGotIt(item({ kind: "project_task_activity", preview: { contextLabel: "CSE 3B" } })), "You’re a member in CSE 3B.");
});
