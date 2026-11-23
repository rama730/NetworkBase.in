import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CharCount } from "@/components/ui/CharCount";

test("a counter reads '7 / 80' in mono, warns near the limit and turns red past it", () => {
  assert.match(renderToStaticMarkup(<CharCount value={7} max={80} />), /class="nb-count[^"]*"[^>]*>7 \/ 80</);
  assert.match(renderToStaticMarkup(<CharCount value={75} max={80} />), /data-near="true"/);
  assert.doesNotMatch(renderToStaticMarkup(<CharCount value={10} max={80} />), /data-near/);
  assert.match(renderToStaticMarkup(<CharCount value={81} max={80} />), /data-over="true"/);
  assert.match(renderToStaticMarkup(<CharCount value={1200} max={5000} />), />1,200 \/ 5,000</);
});
