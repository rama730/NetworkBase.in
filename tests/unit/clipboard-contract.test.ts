import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// 2026-11-09: copying text goes through copyText() (src/lib/clipboard.ts), which falls back when the browser refuses
// the Clipboard API; a raw writeText call fails silently in that case (the Code editor's Copy did).
test("text is copied only through copyText", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(tsx?|jsx?)$/.test(entry.name) && file !== path.join("src", "lib", "clipboard.ts")) {
        fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => { if (/clipboard\??\.writeText\(/.test(line)) hits.push(`${file}:${i + 1}`); });
      }
    }
  };
  walk("src");
  assert.deepEqual(hits, [], "use copyText or copyOrSay from @/lib/clipboard");
});
