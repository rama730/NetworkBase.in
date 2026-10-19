import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// AUTH-011: hiding activity stops the realtime publisher at once.
test("the picker announces a visibility change and the provider reacts", () => {
  assert.match(readFileSync("src/components/presence/StatusPicker.tsx", "utf8"), /dispatchEvent\(new CustomEvent\(PRESENCE_VISIBILITY_EVENT, \{ detail: \{ hidden: !showActivity \} \}\)\)/);
  const provider = readFileSync("src/components/providers/PresenceProvider.tsx", "utf8");
  assert.match(provider, /addEventListener\(PRESENCE_VISIBILITY_EVENT, onVisibility\)/);
  assert.match(provider, /presenceActive && engaged && !hidden \? <OnlinePresencePublisher \/> : null/);
});
