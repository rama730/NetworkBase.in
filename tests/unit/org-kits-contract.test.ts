// Plan B8.4–B8.10 (report 37.2): a kit is offered only once each of its parts works in an Other organization.
// Contract: every ready part is gated somewhere in src (partOn / clubLike / companyLike / communityLike / parts.includes).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { KITS, PARTS, kitReady, kitSettings } from "../../src/lib/organizations/kits";

const gated = (part: string) => {
  const re = `(partOn\\([^)]*|Like\\([^)]*|parts\\??\\.includes\\(|hasFrontDoor\\([^)]*)["']${part}["']`;
  try { return execFileSync("grep", ["-rEl", re, "src"], { encoding: "utf8" }).trim().split("\n").filter(Boolean); } catch { return []; }
};

test("every ready part has a gate in the app, and every offered kit is made only of ready parts", () => {
  for (const p of Object.values(PARTS).filter((x) => x.ready)) assert.ok(gated(p.id).length > 0, `${p.id} is ready but nothing in src checks it`);
  for (const k of KITS.filter(kitReady)) assert.ok(k.parts.every((p) => PARTS[p].ready), k.id);
});

test("B8.10: Blank switches nothing on and saves nothing", () => {
  assert.deepEqual(KITS.find((k) => k.id === "blank")!.parts, []);
  assert.deepEqual(kitSettings("blank"), {});
});
