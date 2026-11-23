import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import { PixelBeat } from "@/components/ui/PixelBeat";

test("a pending button keeps its width, says what it's doing with the pixel beat, and can't be pressed again", () => {
  const html = renderToStaticMarkup(<Button pending pendingLabel="Saving">Save changes</Button>);
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-pending=""/);
  assert.match(html, /class="nb-btn-hold"[^>]*aria-hidden="true">Save changes</, "the original label stays to hold the width");
  assert.match(html, /nb-pixel-beat/);
  assert.match(html, /Saving/);
  assert.doesNotMatch(html, /animate-spin/);
  const idle = renderToStaticMarkup(<Button>Save changes</Button>);
  assert.doesNotMatch(idle, /aria-busy|nb-pixel-beat|data-pending/);
});

test("the pixel beat is three cells, hidden from screen readers", () => {
  const html = renderToStaticMarkup(<PixelBeat />);
  assert.equal((html.match(/<i/g) ?? []).length, 3);
  assert.match(html, /aria-hidden="true"/);
});
