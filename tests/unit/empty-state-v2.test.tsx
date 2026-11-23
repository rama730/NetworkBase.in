import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Inbox } from "lucide-react";
import { EmptyState, NoResults } from "@/components/ui/EmptyState";

test("an empty state can show a pixel figure instead of an icon, one line, one action and an only-you note", () => {
  const html = renderToStaticMarkup(<EmptyState figure="workspace" title="No workspaces yet" description="Start one for your next project." action={<a href="/new">New workspace</a>} onlyYou />);
  assert.match(html, /role="status"/);
  assert.match(html, /nb-empty-figure/);
  assert.match(html, /<svg/);
  assert.match(html, /No workspaces yet/);
  assert.match(html, /Only you see this/);
  assert.match(html, /New workspace/);
});

test("the icon form still works", () => {
  const html = renderToStaticMarkup(<EmptyState icon={Inbox} title="Nothing here" />);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /nb-empty-figure/);
});

test("no results names the search and offers Clear search", () => {
  const html = renderToStaticMarkup(<NoResults query="rivera" onClear={() => undefined} />);
  assert.match(html, /Nothing matches “rivera”/);
  assert.match(html, />Clear search</);
});
