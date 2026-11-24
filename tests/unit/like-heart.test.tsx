import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { LikeHeart } from "@/components/ui/LikeHeart";

test("the like heart is an outline until liked, then solid, on whole 2px cells", () => {
  const outline = renderToStaticMarkup(<LikeHeart liked={false} className="h-3.5 w-3.5" />);
  const liked = renderToStaticMarkup(<LikeHeart liked className="h-3.5 w-3.5" />);
  assert.doesNotMatch(outline, /nb-like-heart-in/);
  assert.match(liked, /nb-like-heart-in/);
  for (const html of [outline, liked]) for (const d of html.match(/ d="[^"]+"/g) ?? []) for (const v of d.match(/-?\d+(\.\d+)?/g) ?? []) assert.ok(Number.isInteger(Number(v)), v);
});

test("at 16px the 14px drawing sits 1px in from every edge; a heart that loads liked doesn't animate", () => {
  const html = renderToStaticMarkup(<LikeHeart liked size={16} />);
  assert.match(html, /viewBox="-1 -1 16 16"/);
  assert.doesNotMatch(html, /is-rising/);
  assert.match(html, /aria-hidden="true"/);
});
