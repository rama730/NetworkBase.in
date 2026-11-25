import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelTabBar } from "@/components/messages/ChannelTabBar";
import { MessageBody } from "@/components/messages/MessageBody";
import { conversationTabs } from "@/lib/messaging/channel-tabs";

const noop = () => undefined;

test("tab bar renders the tabs with even spacing, close only on canvas/shared tabs, no canvas dot", () => {
  const tabs = conversationTabs({
    pinCount: 3, canvasTitle: "Plan", canvasHidden: false, active: "messages", projectId: "p1",
    shared: [{ id: "f", kind: "files", title: "Files", url: null }, { id: "b", kind: "link", title: "Spec", url: "https://x.test" }],
  });
  const html = renderToStaticMarkup(createElement(ChannelTabBar, { activeTab: "messages", tabs, pinCount: 3, onSelectTab: noop, onCloseTab: noop, onAddBookmark: noop }));
  for (const label of ["Messages", "Plan", "Pins", "Files", "Spec"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /<span class="sr-only">3 pinned<\/span>/);
  assert.match(html, /aria-label="Hide note tab"/);
  // Round 2 #109: a bookmark is a link to a website, not a tab.
  assert.match(html, /aria-label="Remove Spec bookmark"/);
  assert.match(html, /<a href="https:\/\/x\.test\/"[^>]*target="_blank"/);
  assert.match(html, /aria-label="Remove Files tab"/);
  assert.doesNotMatch(html, /Shared with the channel|rounded-full bg-/, "no dot after the canvas name");
  assert.doesNotMatch(html, /pr-7/, "closable tabs don't reserve extra room");
  // Unprefixed padding only: on touch, closable tabs reserve room for their always-visible ×.
  const paddings = [...html.matchAll(/role="tab"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*role="tab"/g)].map((m) => (m[1] ?? m[2])!.match(/(?<![:\w-])p[xlr]-\d+(\.\d+)?/g)?.join(" "));
  assert.equal(new Set(paddings).size, 1, "every tab has the same horizontal padding");
  assert.doesNotMatch(html, /Close Pins|Remove Pins|Remove Messages/, "built-in tabs can't be closed");
  assert.match(html, /aria-label="Add a tab"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 4);
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
});

test("shared-message links render as in-app links; other relative links do not", () => {
  const body = "> hello\n— Ana in #general · [View message](/messages/11111111-1111-1111-1111-111111111111?m=12) [bad](/settings)";
  const html = renderToStaticMarkup(createElement(MessageBody, { body, nameOf: () => undefined, channelNameOf: () => undefined, meId: null }));
  assert.match(html, /<a[^>]*href="\/messages\/11111111-1111-1111-1111-111111111111\?m=12"[^>]*>View message<\/a>/);
  assert.doesNotMatch(html, /href="\/settings"/);
});

test("(edited) sits inline after the last paragraph", () => {
  const html = renderToStaticMarkup(createElement(MessageBody, { body: "first\n\nsecond", nameOf: () => undefined, channelNameOf: () => undefined, meId: null, suffix: createElement("span", null, "(edited)") }));
  assert.match(html, /\[&amp;&gt;p:nth-last-child\(2\)\]:inline/);
  assert.match(html, /<p[^>]*>second<\/p><span>\(edited\)<\/span><\/div>$/);
});
