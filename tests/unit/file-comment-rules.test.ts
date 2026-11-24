import assert from "node:assert/strict";
import { test } from "node:test";

import { anchorValid, formatMoment, mediaKindOf, otherVersionCount, versionComments } from "../../src/lib/workflows/file-comments";

test("A7.2: a spot only on images, a moment only on media, within its length", () => {
  assert.deepEqual(["image/png", "video/mp4", "audio/mpeg", "application/pdf"].map(mediaKindOf), ["image", "media", "media", "other"]);
  assert.equal(anchorValid({ x: 0.5, y: 0.2 }, "image"), true);
  assert.equal(anchorValid({ x: 1.2, y: 0.2 }, "image"), false);
  assert.equal(anchorValid({ x: 0.5, y: 0.2 }, "media"), false);
  assert.equal(anchorValid({ t: 42 }, "media", 60), true);
  assert.equal(anchorValid({ t: 90 }, "media", 60), false);
  assert.equal(anchorValid({ t: 4 }, "image"), false);
  assert.equal(anchorValid(null, "other"), true);
  assert.equal(anchorValid({ x: 0.1, y: 0.1, z: 1 }, "image"), false);
  assert.deepEqual([formatMoment(42), formatMoment(62.9), formatMoment(3725)], ["0:42", "1:02", "1:02:05"]);
});

test("A7.2: one version's threads, pins numbered in order, replies nested, deleted left out", () => {
  const c = (id: string, version: number, createdAt: string, extra: Record<string, unknown> = {}) => ({ id, version, anchor: null, parentId: null, createdAt, ...extra });
  const all = [
    c("b", 3, "2026-11-24T10:02", { anchor: { x: 0.2, y: 0.3 } }),
    c("a", 3, "2026-11-24T10:01", { anchor: { x: 0.5, y: 0.5 } }),
    c("plain", 3, "2026-11-24T10:03"),
    c("reply", 3, "2026-11-24T10:04", { parentId: "a" }),
    c("old", 2, "2026-11-20T10:00", { anchor: { x: 0.1, y: 0.1 } }),
    c("gone", 3, "2026-11-24T10:05", { anchor: { x: 0.9, y: 0.9 }, deletedAt: "2026-11-24T11:00" }),
  ];
  const v3 = versionComments(all, 3);
  assert.deepEqual(v3.map((x) => [x.id, x.pin, x.replies.map((r) => r.id)]), [["a", 1, ["reply"]], ["b", 2, []], ["plain", null, []]]);
  assert.equal(otherVersionCount(all, 3), 1);
});
