import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { cameFromOutsideMessages } from "../../src/lib/messaging/routes";

// Unified back R1: a conversation opened from a profile, workspace or notification gets its back
// arrow on desktop too; opened from Messages, the list beside it is the way back.
test("cameFromOutsideMessages", () => {
  assert.equal(cameFromOutsideMessages({ path: "/u/priya" }), true);
  assert.equal(cameFromOutsideMessages({ path: "/workspaces/robot?tab=tasks" }), true);
  assert.equal(cameFromOutsideMessages({ path: "/messages/w/1" }), false);
  assert.equal(cameFromOutsideMessages({ path: "/messages" }), false);
  assert.equal(cameFromOutsideMessages(null), false);
});

test("the conversation shows its arrow on desktop when opened from outside", () => {
  const src = fs.readFileSync("src/components/messages/ConversationView.tsx", "utf8");
  assert.match(src, /cameFromOutsideMessages\(entry\?\.from \?\? null\)/);
  assert.match(src, /<span className=\{outside \? "contents" : "contents lg:hidden"\}>/);
});
