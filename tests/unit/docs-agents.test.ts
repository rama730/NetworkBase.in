import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// Report A8, 0.8 #12: /docs/agents explains presets, All my workspaces, asking for more and renewal, under the anchors
// the approval page's "What's this?" and the error messages link to, and only quotes commands the CLI has.
const page = fs.readFileSync("src/app/(legal)/docs/agents/page.tsx", "utf8");
const commands = JSON.parse(fs.readFileSync("src/lib/cli/commands.json", "utf8")) as { commands?: { name: string; flags?: { name: string }[] }[] } | { name: string }[];
const names = new Set((Array.isArray(commands) ? commands : commands.commands ?? []).map((c) => c.name));

test("the anchors the app links to exist", () => {
  for (const id of ["presets", "all-workspaces", "asking-for-more", "renewal"]) assert.match(page, new RegExp(`id: "${id}"`), id);
});

test("every nb command the page quotes exists", () => {
  const quoted = [...page.matchAll(/\bnb ((?:[a-z]+)(?: [a-z]+)?)/g)].map((m) => m[1]!);
  assert.ok(quoted.length > 3);
  for (const q of quoted) assert.ok(names.has(q) || names.has(q.split(" ")[0]!), `nb ${q}`);
});

test("it no longer says agents are limited to one workspace", () => {
  assert.doesNotMatch(page, /limited to one workspace|only reaches this workspace|pick the one workspace/);
});
