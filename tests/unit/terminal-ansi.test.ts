import assert from "node:assert/strict";
import { it } from "node:test";

import { commandsOf, parseAnsi, stripAnsi } from "../../src/lib/terminal/ansi";

it("keeps SGR colors as tones, drops other escapes", () => {
  const runs = parseAnsi("\x1b[32m✓ ok\x1b[0m \x1b[1;31mfail\x1b[22;39m\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\\x1b[2K");
  assert.deepEqual(runs.map((r) => [r.text, r.tone ?? null, Boolean(r.bold)]), [["✓ ok", "success", false], [" ", null, false], ["fail", "danger", true], ["link", null, false]]);
  assert.equal(parseAnsi("\x1b[38;2;192;86;56mbrand").at(0)?.tone, "danger");
  assert.equal(parseAnsi("\x1b[38;5;245mgrey").at(0)?.tone, "muted");
  assert.equal(parseAnsi("\x1b[90mmuted").at(0)?.tone, "muted");
});

it("copy strips escapes and prompts, keeps line continuations", () => {
  assert.equal(stripAnsi("\x1b[33mwarn\x1b[0m done"), "warn done");
  assert.equal(commandsOf("$ npx @networkbase/cli init \\\n    --workspace design-lab\n$ nb push a.md"), "npx @networkbase/cli init \\\n    --workspace design-lab\nnb push a.md");
});
