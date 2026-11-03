import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useModKeyHint } from "@/components/messages/keys";

// React error #418 on every page: the top bar's search hint read the platform while rendering, so the server wrote
// "CtrlK" and a Mac browser "⌘K". The server's text must not depend on the platform at all.

function serverText(platform: string) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform, userAgent: platform } });
  try {
    return renderToStaticMarkup(createElement(() => createElement("kbd", null, useModKeyHint("k"))));
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  }
}

test("the shortcut hint renders the same on the server whatever the platform", () => {
  assert.equal(serverText("Linux x86_64"), "<kbd>⌘K</kbd>");
  assert.equal(serverText("MacIntel"), "<kbd>⌘K</kbd>");
});

test("the top bar search and chat sidebar use the shared hint, never the platform while rendering", () => {
  const search = readFileSync("src/components/layout/header/GlobalSearch.tsx", "utf8");
  assert.match(search, /useModKeyHint\("k"\)/);
  assert.doesNotMatch(search, /navigator\./);
  assert.match(readFileSync("src/components/messages/ChatSections.tsx", "utf8"), /useModKeyHint\(/);
});
