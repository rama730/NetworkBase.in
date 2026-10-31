import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const moduleLoad = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const realLoad = moduleLoad._load;
moduleLoad._load = (request, ...args) => (request === "@/app/actions/files/download-history" ? { readDownloadHistoryAction: async () => ({}) } : realLoad(request, ...args));

const row = (overrides = {}) => ({
  id: "1", fileName: "report.pdf", kind: "file", fileCount: 1, cursorAt: "x",
  // What the server action delivers: a real Date, with microseconds already cut.
  createdAt: new Date("2026-10-31T05:02:03.123Z"), actorId: "a", actorName: "Asha", ...overrides,
});

test("a history row shows a real date and the person", async () => {
  const { DownloadHistoryRow } = await import("../../src/components/workspaces/settings/DownloadHistory");
  const html = renderToStaticMarkup(createElement(DownloadHistoryRow, { row: row() as never }));
  assert.doesNotMatch(html, /Invalid Date/);
  assert.match(html, /2026/);
  assert.match(html, /Asha/);
  assert.match(html, /report\.pdf/);
  const zip = renderToStaticMarkup(createElement(DownloadHistoryRow, { row: row({ kind: "folder_zip", fileCount: 3, actorId: null, actorName: null }) as never }));
  assert.match(zip, /Folder zip/);
  assert.match(zip, /3 files/);
  assert.match(zip, /Signed-out visitor/);
});
