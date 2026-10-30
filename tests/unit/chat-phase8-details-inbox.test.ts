import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { CHAT_LIST_PAGE } from "@/lib/messaging/constants";
import { groupNoun, mergeByTime } from "@/lib/messaging/inbox";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("Inbox All merges mentions and reactions newest first, one page", () => {
  const a = [{ id: "m1", created_at: "2026-10-04T10:00:00Z" }, { id: "m2", created_at: "2026-10-04T08:00:00Z" }];
  const b = [{ id: "r1", created_at: "2026-10-04T09:00:00Z" }];
  assert.deepEqual(mergeByTime(a, b, 2).map((x) => x.id), ["m1", "r1"]);
  assert.equal(CHAT_LIST_PAGE, 50);
});

test("group labels say what they hold", () => {
  assert.equal(groupNoun(["user", "channel", "here"]), "mentions");
  assert.equal(groupNoun(["thread_reply", "thread_reply"]), "replies");
  assert.equal(groupNoun(["reaction"]), "reactions");
  assert.equal(groupNoun(["user", "reaction"]), "updates");
});

test("lists share one page size with Load more", () => {
  for (const file of ["src/app/actions/chat/activity.ts", "src/app/actions/chat/later.ts", "src/app/actions/chat/search.ts"]) {
    assert.match(read(file), /CHAT_LIST_PAGE/, `${file} uses the shared page size`);
  }
  assert.doesNotMatch(read("src/app/actions/chat/later.ts"), /LIMIT 200/);
  assert.doesNotMatch(read("src/app/actions/chat/activity.ts"), /listDirectMessages/);
  const views = read("src/components/messages/MessagesViews.tsx");
  assert.match(views, /savedPages\.fetchNextPage/);
  assert.match(views, /resultPages\.fetchNextPage/);
  assert.match(views, /threadPages\.fetchNextPage/);
});

test("Inbox: tab panel semantics, per-tab empty text, read toggle, thread actions", () => {
  const views = read("src/components/messages/MessagesViews.tsx");
  assert.match(views, /role="tabpanel" aria-labelledby=\{`inbox-tab-\$\{filter\}`\}/);
  assert.match(views, /aria-controls="inbox-panel"/);
  assert.match(views, /mentions: \{ title: "No mentions yet", text: "When someone @mentions you, it shows up here\." \}/);
  // Unread is a tab of its own, like the Notifications tray (round 3 #134).
  assert.match(views, /\{ id: "unread", label: "Unread" \}/);
  assert.match(views, /markInboxUnread\(\{ channelId: item\.channel_id, seq: item\.seq \}\)/);
  assert.match(views, /Unfollow/);
  assert.match(views, /markThreadRead\(\{ channelId: thread\.channel_id, rootSeq: thread\.root_seq, seq: thread\.last_reply_seq \}\)/);
});

test("Details: star + copy link, archived and preview banners, privacy switch, virtual member list", () => {
  const pane = read("src/components/messages/DetailsPane.tsx");
  assert.match(pane, /function QuickActions/);
  assert.match(pane, /This channel is archived\. History stays readable\./);
  assert.match(pane, /You’re previewing/);
  assert.match(pane, /setChannelPrivacy\(\{ channelId, private: channel\?\.kind !== "private" \}\)/);
  assert.match(pane, /customScrollParent=\{scrollParent\}/);
  assert.match(pane, /pointer-fine:group-focus-within\/member:opacity-100/);
  const sql = read("drizzle/0014_messaging.sql");
  assert.match(sql, /v_channel\.is_default/);
});
