import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { chatWindowHiddenOn } from "@/components/messages/chat-window-store";
import { canAddPeople } from "@/lib/messaging/channel-view";
import { REMINDER_TIMES } from "@/lib/messaging/reminders";
import { conversationHref, messageHref } from "@/lib/messaging/routes";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("old Home and DMs pages are gone and redirect to /messages", () => {
  assert.equal(fs.existsSync("src/app/(site)/(main)/messages/home/page.tsx"), false);
  assert.equal(fs.existsSync("src/app/(site)/(main)/messages/dms/page.tsx"), false);
  const config = read("next.config.ts");
  assert.match(config, /source: '\/messages\/home', destination: '\/messages'/);
  assert.match(config, /source: '\/messages\/dms', destination: '\/messages'/);
});

test("conversation links come from one helper", () => {
  assert.equal(conversationHref("c1"), "/messages/c1");
  assert.equal(messageHref("c1", 9, 4), "/messages/c1?m=9&thread=4");
  for (const file of ["src/components/messages/ChatSections.tsx", "src/components/messages/HomePane.tsx", "src/components/messages/NewMessage.tsx", "src/components/messages/MessageBody.tsx", "src/components/messages/CreateChannelDialog.tsx"]) {
    assert.doesNotMatch(read(file), /`\/messages\/\$\{/, `${file} builds conversation URLs by hand`);
  }
});

test("Add people follows the server rule: any member of a live, non-DM conversation", () => {
  assert.equal(canAddPeople({ kind: "public", is_member: true, channel_archived_at: null }), true);
  assert.equal(canAddPeople({ kind: "private", is_member: true, channel_archived_at: null }), true);
  assert.equal(canAddPeople({ kind: "dm", is_member: true, channel_archived_at: null }), false);
  assert.equal(canAddPeople({ kind: "public", is_member: false, channel_archived_at: null }), false);
  assert.equal(canAddPeople({ kind: "public", is_member: true, channel_archived_at: "2026-01-01" }), false);
});

test("one reminder list, used by the message menu and Saved", () => {
  assert.deepEqual(REMINDER_TIMES.map((t) => t.label), ["In 20 minutes", "In 1 hour", "In 3 hours", "Tomorrow at 9:00", "Next Monday at 9:00"]);
  for (const t of REMINDER_TIMES) assert.ok(Date.parse(t.at()) > Date.now());
  assert.match(read("src/components/messages/MessageRow.tsx"), /REMINDER_TIMES\.map/);
  assert.match(read("src/components/messages/MessagesViews.tsx"), /REMINDER_TIMES\.map/);
});

test("the chat window and its launcher share one hidden-routes list", () => {
  assert.equal(chatWindowHiddenOn("/messages"), true);
  assert.equal(chatWindowHiddenOn("/messages/inbox"), true);
  assert.equal(chatWindowHiddenOn("/projects/new"), true);
  assert.equal(chatWindowHiddenOn("/projects/abc"), false);
  assert.equal(chatWindowHiddenOn("/messagesx"), false);
  assert.match(read("src/components/messages/ChatLauncher.tsx"), /chatWindowHiddenOn\(pathname\)/);
});

test("New message sends through the shared Composer", () => {
  const source = read("src/components/messages/NewMessage.tsx");
  assert.match(source, /<Composer[\s\S]*send=\{send\}/);
  assert.doesNotMatch(source, /<textarea/);
});
