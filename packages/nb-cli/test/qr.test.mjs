import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { qrLines, qrMatrix } from "../lib/print/qr.mjs";

// Report A4: the approval link as a QR code. The reference matrix was decoded by macOS Core Image (CIDetector) on
// 2026-11-11, together with codes for versions 1–10 and UTF-8 text, so it is checked against a real reader.
it("draws the reference matrix for an approval link", () => {
  const want = fs.readFileSync(new URL("./fixtures/qr-device-url.txt", import.meta.url), "utf8").trim().split(/\r?\n/);
  const got = qrMatrix("https://networkbase.in/device?code=D9GM-9N7Z").map((r) => r.map((d) => (d ? "#" : ".")).join(""));
  assert.deepEqual(got, want);
});

it("picks the smallest version, and refuses what doesn't fit in version 10", () => {
  assert.equal(qrMatrix("hello").length, 21, "version 1");
  assert.equal(qrMatrix("x".repeat(271)).length, 57, "version 10 holds 271 bytes");
  assert.throws(() => qrMatrix("x".repeat(272)), /Too long/);
});

it("prints two module rows per line, with a quiet zone", () => {
  const lines = qrLines("https://networkbase.in/device?code=D9GM-9N7Z");
  assert.equal(lines.length, Math.ceil((29 + 4) / 2));
  for (const line of lines) assert.equal([...line].length, 33);
  assert.equal(lines[0], "█".repeat(33), "the top quiet zone is light");
});
