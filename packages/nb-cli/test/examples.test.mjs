import { it } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS } from "../lib/commands/table.mjs";
import { parseFlags, resolveCommand } from "../lib/args.mjs";

// Report A6.8, A9.10: every example in the help and on /docs/cli is a command the CLI accepts.
it("every example parses to its own command with known flags", () => {
  let n = 0;
  for (const spec of COMMANDS) {
    for (const example of spec.examples ?? []) {
      // The nb part of a shell line (`echo … | nb login --with-token`, `nb task list --json | jq …`).
      // …or what an agent runs: `claude mcp add networkbase -- npx -y @networkbase/cli@2 mcp`.
      const line = example.split("|").map((s) => s.trim()).find((s) => s.startsWith("nb ")) ?? example.replace(/^.*@networkbase\/cli(@\S+)?\s+/, "nb ");
      const argv = line.replace(/^nb\s+/, "").match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, "")) ?? [];
      const { spec: found, rest } = resolveCommand(argv);
      assert.ok(found, example);
      assert.doesNotThrow(() => parseFlags(/** @type {any} */ (found), rest), example);
      n++;
    }
  }
  assert.ok(n >= 15, `only ${n} examples`);
});
