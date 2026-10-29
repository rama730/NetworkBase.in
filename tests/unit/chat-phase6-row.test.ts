import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { restoreTabOrder } from "@/lib/messaging/channel-tabs";
import { DEFAULT_REACTIONS, pushRecent, quickReactions } from "@/lib/messaging/reactions";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("one quick-reaction set: recently used first, then the defaults, six in all", () => {
  assert.deepEqual(quickReactions([]), [...DEFAULT_REACTIONS]);
  assert.deepEqual(quickReactions(["🔥", "👍"]), ["🔥", "👍", "❤️", "😂", "🎉", "👀"]);
  assert.deepEqual(pushRecent(["👍", "🔥"], "🔥"), ["🔥", "👍"]);
  for (const file of ["src/components/messages/MessageRow.tsx", "src/components/messages/parts/ReactionQuickBar.tsx"]) {
    assert.match(read(file), /useQuickReactions\(\)/, `${file} uses the shared set`);
  }
  assert.doesNotMatch(read("src/components/messages/MessageRow.tsx"), /const QUICK = |HOVER_QUICK_REACTIONS = /);
});

test("Undo of a removed tab puts it back where it was", () => {
  const before = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];
  assert.deepEqual(restoreTabOrder(before, "b", { id: "b2", title: "B" }).map((t) => t.id), ["a", "b2", "c"]);
});

test("header and tabs: archive icon, no delete key, ?tab= in the URL, canvas confirms", () => {
  const view = read("src/components/messages/ConversationView.tsx");
  // Menu items take the shared sizing and the destructive variant (round 3 #153).
  assert.match(view, /<DropdownMenuItem variant="destructive" onSelect=\{\(\) => setConfirm\("archive"\)\}>\s*<Archive \/> Archive channel/);
  assert.match(view, /conversationHref\(channelId, id === "messages" \? \{ tab: null \} : \{ tab: id, m: null \}/);
  assert.match(view, /title=\{confirm === "replace" \? "Replace the note\?"/);
  assert.match(view, /key=\{`\$\{channelId\}:\$\{timeline\.epoch\}`\}/);
  const tabs = read("src/components/messages/ChannelTabBar.tsx");
  assert.doesNotMatch(tabs, /"Backspace"|onContextMenu/);
  assert.match(tabs, /hasCanvas \? "Open note" : "New note"/);
  assert.match(read("src/components/messages/ChannelCanvas.tsx"), /Clear the note for everyone\?/);
  // #87 then #152: Details and the header share notifyChoices, whose mute choice reads "Mute".
  assert.match(read("src/components/messages/DetailsPane.tsx"), /notifyChoices\(channel\)\.map/);
  assert.match(read("src/lib/messaging/channel-view.ts"), /\{ value: "mute", label: MESSAGE_LEVEL_LABELS\.mute \}/);
});

test("message row: keyboard, time button, grouped icons, delete with replies, failed sends, pins", () => {
  const row = read("src/components/messages/MessageRow.tsx");
  assert.match(row, /tabIndex=\{tabStop \? 0 : -1\}/);
  assert.match(read("src/components/messages/Timeline.tsx"), /onKeyDown=\{onListKeyDown\}/);
  // Round 2 #145: pinned and saved read as a small label line above the message.
  assert.match(row, /<Pin size=\{14\} aria-hidden="true" \/> Pinned/);
  assert.match(row, /own && !message\.reply_count \? removeWithUndo\(\) : setConfirmDelete\(true\)/);
  assert.match(row, /Not sent[\s\S]*Retry[\s\S]*Delete/);
  assert.match(row, /if \(ctx\.share && hasContent\)/);
  assert.match(read("src/components/messages/Composer.tsx"), /failSend\(queryClient, clientId,/);
  const view = read("src/components/messages/ConversationView.tsx");
  assert.match(view, /function PinRow[\s\S]*Jump to message[\s\S]*Unpin/);
  assert.doesNotMatch(view, /<MessageRow /, "Pins no longer render the full row with every action");
});
