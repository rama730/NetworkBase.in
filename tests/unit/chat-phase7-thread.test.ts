import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { draftKeyOf } from "@/components/messages/useFileDrop";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("dropped files reach the composer with the same draft key", () => {
  assert.equal(draftKeyOf("c1", null), "c1");
  assert.equal(draftKeyOf("c1", 7), "c1:7");
  const composer = read("src/components/messages/Composer.tsx");
  assert.match(composer, /const draftKey = draftKeyOf\(channelId, threadRootSeq\)/);
  assert.match(composer, /detail\?\.draftKey === draftKey/);
  assert.match(read("src/components/messages/ConversationView.tsx"), /dropFilesTo\(draftKeyOf\(channelId, null\), files\)/);
  assert.match(read("src/components/messages/ThreadPane.tsx"), /dropFilesTo\(draftKeyOf\(channelId, rootSeq\), files\)/);
});

test("composer: /code opens an empty code block, Discard has Undo, Aa and / in threads, no live typing", () => {
  const composer = read("src/components/messages/Composer.tsx");
  assert.doesNotMatch(composer, /Write your code here/);
  // One code-block behaviour for /code, + and the toolbar (round 3 #225): toggle at the caret.
  assert.match(composer, /toggleCodeBlock\(language \? \{ language \} : undefined\)/);
  assert.match(composer, /toast\("Draft discarded", \{\s*action: \{\s*label: "Undo"/);
  assert.doesNotMatch(composer, /threadRootSeq \? null : \(\s*<button type="button" aria-label=\{formatting/);
  assert.doesNotMatch(composer, /!threadRootSeq && Boolean\(readChatUi\(\)\.formatting\)/);
  assert.doesNotMatch(composer.slice(composer.indexOf("function TypingIndicator"), composer.indexOf("function barButton")), /aria-live/);
  // Scheduling says why it's off (aria-disabled + reason, round 3 #210, #184, #185).
  assert.match(composer, /disabled=\{Boolean\(scheduleBlocked\) \|\| sending\}/);
  assert.match(composer, /Commands can't be scheduled/);
  assert.match(read("src/components/messages/Timeline.tsx"), /revealSeq/);
});

test("thread: newest replies first with Load earlier, true count, Following toggle, quiet log, reasons, Latest pill", () => {
  const pane = read("src/components/messages/ThreadPane.tsx");
  assert.match(pane, /Load earlier replies/);
  assert.match(pane, /"No replies yet"/);
  assert.match(pane, /root\?\.reply_count/);
  assert.match(pane, /<Check size=\{14\} aria-hidden="true" \/> Following/);
  assert.doesNotMatch(pane, /BellOff|Mark as read/);
  // The list stays quiet (aria-live off); only the sr-only line announces replies (round 2 #29).
  assert.match(pane, /role="log"\s+aria-live="off"\s+aria-label="Thread replies"/);
  assert.match(pane, /aria-live="polite">\{announce\}/);
  assert.match(pane, /This channel is archived\. You can read it, but not reply\./);
  assert.match(pane, /Join \{channelLabel \?\? "the channel"\} to reply\./);
  assert.match(pane, /Jump to latest reply/);
  // Show in conversation keeps the thread open beside the timeline at 1024px+, closes it below (round 2 #32).
  assert.match(pane, /router\.replace\(showInConversationHref\(channelId, rootSeq,/);
  // On a phone it goes back to the conversation and reveals the root there (round 3 #43).
  assert.match(pane, /REVEAL_EVENT, \{ detail: \{ channelId, seq: rootSeq \} \}/);
  assert.match(read("src/lib/messaging/routes.ts"), /thread: wide \? rootSeq : null/);
  const drawer = read("src/components/messages/ChatDrawer.tsx");
  assert.match(drawer, /aria-modal=\{modal \|\| undefined\}/);
  assert.match(drawer, /opener\?\.isConnected\) opener\.focus/);
  assert.match(read("src/components/messages/keys.ts"), /\[role=dialog\]:not\(\[data-chat-pane\]\)/);
  assert.match(read("src/app/actions/chat/messages.ts"), /sql`m\.channel_seq DESC`, limit \+ 1/);
});

test("0190 de-duplicates the thread follows upsert and is registered", () => {
  const sql = read("drizzle/0190_chat_thread_self_reply.sql");
  assert.match(sql, /FROM \(SELECT DISTINCT u FROM unnest\(ARRAY\[p_author_id, v_root\.author_id\]\) AS u\) AS d/);
  assert.match(read("drizzle/meta/_journal.json"), /"tag": "0190_chat_thread_self_reply"/);
});
