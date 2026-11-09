import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "yaml";

// Report A7.12: at least 50 requests, ambiguous / destructive / injection cases, and only tools that exist.
it("the agent evaluation requests are complete and name real tools", async () => {
  const { TOOLS } = await import("../../packages/nb-cli/lib/mcp/tools.mjs");
  const names = new Set((TOOLS as Array<{ name: string }>).map((t) => t.name));
  const requests = parse(fs.readFileSync("tests/agents/requests.yaml", "utf8")) as Array<{ id: string; say: string; expect?: string[]; forbid?: string[] }>;
  assert.ok(requests.length >= 50, `${requests.length} requests`);
  assert.equal(new Set(requests.map((r) => r.id)).size, requests.length, "ids are unique");
  for (const prefix of ["ambiguous-", "destructive-", "injection-"]) assert.ok(requests.some((r) => r.id.startsWith(prefix)), prefix);
  const unknown = requests.flatMap((r) => [...(r.expect ?? []), ...(r.forbid ?? [])]).filter((t) => !names.has(t));
  assert.deepEqual(unknown, []);
});
