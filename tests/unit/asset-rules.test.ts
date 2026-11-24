import assert from "node:assert/strict";
import { test } from "node:test";

import { assetDetailsSchema, defaultAssetType, groupByStatus, isAssetMime, mentions, readAssetDetails, usedIn } from "../../src/lib/workflows/assets";

test("A7.1: which files are assets on their own, and their default type", () => {
  assert.deepEqual(["image/png", "video/mp4", "audio/mpeg", "font/woff2", "application/zip", null].map((m) => isAssetMime(m)), [true, true, true, true, false, false]);
  assert.equal(isAssetMime("application/octet-stream", "Brand.otf"), true);
  assert.deepEqual([defaultAssetType("image/svg+xml"), defaultAssetType("image/jpeg"), defaultAssetType("application/pdf")], ["logo", "photo", "other"]);
});

test("A7.1: details are validated, read back safely, grouped by status", () => {
  assert.deepEqual(assetDetailsSchema.parse({ tags: ["Brand", "dark-mode"], productionStatus: "final" }), { tags: ["brand", "dark-mode"], productionStatus: "final" });
  assert.equal(assetDetailsSchema.safeParse({ tags: ["has space"] }).success, false);
  assert.equal(assetDetailsSchema.safeParse({ type: "logo", extra: 1 }).success, false);
  assert.equal(readAssetDetails({ asset: { type: "nope" } }), null);
  assert.deepEqual(readAssetDetails({ other: 1, asset: { type: "logo" } }), { type: "logo" });
  const groups = groupByStatus([{ details: { productionStatus: "review" as const } }, { details: null }, { details: { productionStatus: "concept" as const } }]);
  assert.deepEqual(groups.map((g) => [g.label, g.items.length]), [["Concept", 1], ["Review", 1], ["No status", 1]]);
});

test("A7.1: Used in counts each place once; documents mention a file by path, name or id", () => {
  const list = usedIn([{ id: "a", title: "Launch post", number: 12, type: "content" }, { id: "a", title: "Launch post", number: 12, type: "content" }], [{ slug: "brand", title: "Brand guide" }]);
  assert.deepEqual(list.map((x) => x.label), ["NB-12 Launch post", "Brand guide"]);
  const file = { id: "6b0c…", name: "Logo dark.svg", path: "/brand/Logo dark.svg" };
  assert.equal(mentions("![logo](/brand/Logo%20dark.svg)", file), true);
  assert.equal(mentions("Use the Logo dark.svg on black", file), true);
  assert.equal(mentions("Nothing here", file), false);
});

test("A7.3: colors, outside links (http(s) only), the stored library read safely, version notice recipients", async () => {
  const { colorSchema, outsideLinkSchema, readAssetLibrary, newVersionRecipients } = await import("../../src/lib/workflows/assets");
  assert.deepEqual(colorSchema.parse({ name: "Ink", hex: "141a1e" }), { name: "Ink", hex: "#141A1E" });
  assert.equal(colorSchema.safeParse({ name: "Bad", hex: "#12345" }).success, false);
  assert.equal(outsideLinkSchema.safeParse({ id: "abc123", name: "Raw footage", url: "javascript:alert(1)", type: "footage" }).success, false);
  assert.equal(outsideLinkSchema.safeParse({ id: "abc123", name: "Raw footage", url: "https://drive.example.com/x", type: "footage" }).success, true);
  const lib = readAssetLibrary({ assets: { colors: [{ name: "Ink", hex: "#141A1E" }, { name: "x" }], outsideLinks: [{ id: "abc123", name: "Raw", url: "ftp://x", type: "footage" }] } });
  assert.deepEqual([lib.colors.length, lib.outsideLinks.length], [1, 0]);
  assert.deepEqual(readAssetLibrary(null), { colors: [], outsideLinks: [] });
  assert.deepEqual(newVersionRecipients([{ assigneeId: "a", done: false }, { assigneeId: "a", done: false }, { assigneeId: "b", done: true }, { assigneeId: "me", done: false }, { assigneeId: null, done: false }], "me"), ["a"]);
});

test("A7.3: the Brand guide's Colors section is a live colors block", async () => {
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const { templateById } = await import("../../src/lib/workflows/doc-templates");
  assert.deepEqual(parseLiveBlocks(templateById("brand-guide")!.body).map((b) => b.kind), ["colors"]);
});
