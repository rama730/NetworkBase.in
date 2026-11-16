import { it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";

import { safeJoin } from "../lib/sync/transfer.mjs";

// M5 security review: nb never writes inside a .git or .networkbase folder, whatever the spelling.
const refused = (p) => { try { safeJoin(os.tmpdir(), p); return false; } catch { return true; } };

it("refuses .git and .networkbase folders at any depth, in any case, with trailing dots or spaces", () => {
  for (const p of [".git/config", "x/.GIT/config", "x/.git./hooks/a", "x/.git /hooks", "y/.networkbase/state.json", "../out.txt"]) assert.ok(refused(p), p);
  for (const p of ["a/b.txt", "ok/.gitignore", "ok/git/x", ".github/workflows/ci.yml"]) assert.ok(!refused(p), p);
});

it("on Windows, also backslashes, 8.3 short names and stream suffixes", { skip: process.platform !== "win32" }, () => {
  for (const p of ["sub\\.git\\hooks\\pre-commit", "GIT~1/config", "x/NETWOR~1/state.json", "x/file.txt:stream"]) assert.ok(refused(p), p);
});
