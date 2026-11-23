import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.10 D2 part 7 (plan A3.1): launch rules.
test("launchProgress: done of total, canceled steps left out; none says No steps", async () => {
  const { launchProgress } = await import("../../src/lib/workflows/launches");
  const steps = [...Array(14).fill({ status: "done" }), ...Array(17).fill({ status: "todo" }), { status: "done", stage: "cancelled" }];
  assert.equal(launchProgress(steps).text, "14 of 31 steps");
  assert.equal(launchProgress([{ status: "done", stage: "cancelled" }]).text, "No steps");
});

test("whatsNew: Feature → Added, Improvement → Improved, Fix items and bugs fixed in this version → Fixed", async () => {
  const { whatsNew } = await import("../../src/lib/workflows/launches");
  const w = whatsNew([{ title: "SSO", itemType: "feature" }, { title: "Faster search", itemType: "improvement" }, { title: "Export crash", itemType: "fix" }],
    [{ title: "Login typo", fixedIn: "v2.4" }, { title: "Old bug", fixedIn: "v2.3" }, { title: "No version", fixedIn: null }], "V2.4");
  assert.deepEqual(w, { added: ["SSO"], improved: ["Faster search"], fixed: ["Export crash", "Login typo"] });
  assert.deepEqual(whatsNew([], [{ title: "Login typo", fixedIn: "v2.4" }], null).fixed, [], "no version label, no bugs");
});

test("shiftDates, closeSuggested, countdown, stageAfterStepStarted", async () => {
  const { shiftDates, closeSuggested, countdown, stageAfterStepStarted } = await import("../../src/lib/workflows/launches");
  assert.deepEqual(shiftDates([{ dueDate: "2026-12-10" }, { dueDate: null }], 5).map((s) => s.dueDate), ["2026-12-15", null]);
  assert.equal(closeSuggested("2026-11-01T10:00:00Z", new Date("2026-11-14T10:00:00Z")), false);
  assert.equal(closeSuggested("2026-11-01T10:00:00Z", new Date("2026-11-15T10:00:00Z")), true);
  assert.equal(closeSuggested(null, new Date()), false);
  assert.deepEqual([countdown("2026-12-18", "2026-11-25"), countdown("2026-11-25", "2026-11-25"), countdown("2026-11-24", "2026-11-25")], ["in 23 days", "today", "1 day ago"]);
  assert.equal(countdown("2026-12-12", "2026-11-25", "2026-12-12T09:00:00Z"), "Launched Dec 12");
  assert.deepEqual([stageAfterStepStarted("planning"), stageAfterStepStarted(undefined), stageAfterStepStarted("getting_ready"), stageAfterStepStarted("launched")], ["getting_ready", "getting_ready", null, null]);
});

test("launchMarkdown: a heading and a fixed-key task-rows block per stage, then What's new", async () => {
  const { launchMarkdown, launchPreset } = await import("../../src/lib/workflows/launches");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const md = launchMarkdown(launchPreset("blank")!, "v2.4: Faster sign-in");
  assert.match(md, /^# v2\.4: Faster sign-in\n/);
  assert.deepEqual(parseLiveBlocks(md).map((b) => [b.kind, b.key, b.label]), [["task_rows", "launch1", "Checklist"]]);
  assert.match(md, /## 1\. Checklist\n/);
  assert.match(md, /## What’s new\n\n### Added\n\n### Improved\n\n### Fixed\n$/);
});

// Plan A3.2: the Product launch preset (11.5).
test("Product launch: seven stages in Notion's order, each with a why and starter steps, blocks launch1–launch7", async () => {
  const { launchMarkdown, launchPreset } = await import("../../src/lib/workflows/launches");
  const { parseLiveBlocks } = await import("../../src/lib/workspaces/doc-live-blocks");
  const p = launchPreset("product")!;
  assert.deepEqual(p.stages.map((s) => s.name), ["Market research", "Goal identification", "Marketing plan", "Sales and support training", "Testing and beta testing", "Launch day", "After launch"]);
  assert.ok(p.stages.every((s) => s.why && s.steps.length >= 2));
  assert.deepEqual(p.stages[0]!.steps.slice(0, 2), ["Create buyer personas", "Competitive analysis"], "11.5's sketch");
  const md = launchMarkdown(p, "v2.4");
  assert.deepEqual(parseLiveBlocks(md).map((b) => b.key), ["launch1", "launch2", "launch3", "launch4", "launch5", "launch6", "launch7"]);
  assert.match(md, /## 1\. Market research\n\n_Who it’s for and what they need\._\n/);
});

// Plans A3.3–A3.8: every preset's stages exactly as its source section; steps start unassigned (they're titles only).
test("presets A3.3–A3.8: stages as 11.5, 20.4, 22.4 and 25.5 list them; Blank is one Checklist; ids unique", async () => {
  const { LAUNCH_PRESETS, launchPreset } = await import("../../src/lib/workflows/launches");
  const stages = (id: string) => launchPreset(id)!.stages.map((s) => s.name).join(" · ");
  assert.equal(stages("feature"), "Build done · QA · Docs · Announce · Watch");
  assert.equal(stages("app"), "Build and test · Store listing · Privacy · Submit for review · Release · After release");
  assert.equal(stages("store"), "3+ months before · 1 month before · Launch week · After launch");
  assert.equal(stages("digital"), "Make · Listing · Launch · After");
  assert.equal(stages("content"), "Script · Record · Edit · Publish · Promote");
  assert.equal(stages("blank"), "Checklist");
  assert.deepEqual(LAUNCH_PRESETS.map((p) => p.name), ["Product launch", "Feature release", "App release", "Store launch", "Digital product launch", "Content launch", "Blank"]);
  assert.equal(new Set(LAUNCH_PRESETS.map((p) => p.id)).size, 7);
  assert.deepEqual(launchPreset("store")!.stages[0]!.steps, ["Store page", "Capsule art", "Trailer", "Wishlist campaign"], "22.4");
  assert.deepEqual(launchPreset("app")!.stages[2]!.steps, ["Store privacy labels", "Data-safety form", "Privacy policy link"], "20.4");
});
