import assert from "node:assert/strict";
import test from "node:test";
import robots from "../../src/app/robots";

// Search + AI findability, middle option (2026-11-26): training crawlers are refused; search and AI readers are not.
const TRAINING = ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "Amazonbot", "meta-externalagent"];
const READERS = ["PerplexityBot", "OAI-SearchBot", "Claude-SearchBot", "ChatGPT-User", "Claude-User"];

test("robots.txt blocks AI training crawlers and names none of the readers", () => {
  const rules = [robots().rules].flat();
  const agents = (r: (typeof rules)[number]) => [r.userAgent ?? []].flat();
  const training = rules.find((r) => TRAINING.every((bot) => agents(r).includes(bot)));
  assert.ok(training, "a rule lists every training crawler");
  assert.equal(training.disallow, "/");
  for (const bot of READERS) assert.equal(rules.some((r) => agents(r).includes(bot)), false, bot);
});

test("the markdown route is not crawled directly", () => {
  const all = [robots().rules].flat().find((r) => [r.userAgent].flat().includes("*"));
  assert.ok([all?.disallow].flat().includes("/md/"));
});
