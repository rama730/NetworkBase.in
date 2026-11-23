import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { UploadBar } from "@/components/ui/UploadBar";

test("an upload bar is a labelled progressbar with a slim fill and its percent in mono", () => {
  const html = renderToStaticMarkup(<UploadBar value={3} max={4} label="Upload progress: notes.pdf" showPercent />);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="75"/);
  assert.match(html, /aria-label="Upload progress: notes.pdf"/);
  assert.match(html, /style="width:75%"/);
  assert.match(html, /75%/);
  assert.doesNotMatch(renderToStaticMarkup(<UploadBar value={0} label="x" />), /NaN/);
});
