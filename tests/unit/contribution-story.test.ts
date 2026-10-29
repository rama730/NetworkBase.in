import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  blankContributionStory,
  contributionStorySchema,
  storyPeriod,
  storyValidation,
  positionDuration,
  removeStoryPosition,
  mergeContributionStory,
  storyProjectLinks,
  referenceToken,
  storyReferences,
  sortedStoryPositions,
  storyFromContribution,
  parseContributionStory,
  reconcileStoryCurrentStatus,
  type ContributionStory,
} from "@/lib/profile/contribution-story";
const role = (
  changes: Partial<ContributionStory["positions"][number]> = {},
) => ({
  id: randomUUID(),
  recordedStageId: null,
  title: "Engineer",
  start: "2025-01",
  end: "",
  current: false,
  description: "Built the workspace.",
  hidden: false,
  ...changes,
});

test("missing end dates show only the start month; Present requires an explicit current flag", () => {
  assert.equal(
    storyPeriod({ start: "2026-03", end: "", current: false }),
    "Mar 2026",
  );
  assert.equal(
    storyPeriod({ start: "2026-03", end: "", current: true }),
    "Mar 2026 – Present",
  );
  assert.equal(
    storyPeriod({ start: "2026-03", end: "2026-07", current: false }),
    "Mar 2026 – Jul 2026",
  );
  assert.equal(storyPeriod({ start: "", end: "", current: false }), "");
  assert.equal(
    storyPeriod({ start: "", end: "2026-07", current: false }),
    "Until Jul 2026",
  );
});
test("a non-current project clears stale current positions without inventing dates or changing recorded history", () => {
  const position = role({ current: true, recordedStageId: randomUUID() });
  const ended = role({ end: "2026-04" });
  const story = {
    ...blankContributionStory("Ponytail"),
    positions: [position, ended],
  };
  const normalized = reconcileStoryCurrentStatus(story);
  assert.equal(normalized.positions[0]!.current, false);
  assert.equal(normalized.positions[0]!.end, "");
  assert.equal(
    normalized.positions[0]!.recordedStageId,
    position.recordedStageId,
  );
  assert.equal(normalized.positions[1], ended);
  assert.equal(position.current, true);
  assert.deepEqual(parseContributionStory(story), normalized);
  const ongoing = { ...story, current: true };
  assert.equal(reconcileStoryCurrentStatus(ongoing), ongoing);
});
test("story shape and publication validation reject executable URLs, arbitrary media URLs and size overflow", () => {
  const base = blankContributionStory("A project");
  assert.equal(contributionStorySchema.safeParse(base).success, true);
  for (const url of [
    "javascript:alert(1)",
    "http://127.0.0.1/private",
    "data:text/html,x",
  ])
    assert.equal(
      storyValidation(
        { ...base, links: [{ id: randomUUID(), label: "Work", url }] },
        { publish: true },
      ).some((error) => error.section === "skills"),
      true,
    );
  assert.equal(
    contributionStorySchema.safeParse({ ...base, summary: "x".repeat(10001) })
      .success,
    false,
  );
  assert.equal(
    contributionStorySchema.safeParse({
      ...base,
      positions: Array.from({ length: 21 }, () => role()),
    }).success,
    false,
  );
  assert.equal(
    contributionStorySchema.safeParse({
      ...base,
      images: [{ id: randomUUID(), url: "https://example.com/a.png" }],
    }).success,
    false,
  );
  assert.equal(
    contributionStorySchema.safeParse({ ...base, membershipRole: "owner" })
      .success,
    false,
  );
});
test("publication validates content, overall dates, position bounds and image permission", () => {
  const story = blankContributionStory();
  assert.match(
    storyValidation(story, { publish: true })
      .map((e) => e.message)
      .join(" "),
    /workspace or project name/,
  );
  const invalid = {
    ...story,
    title: "A",
    start: "2026-04",
    end: "2026-02",
    positions: [role({ start: "2026-01", current: true })],
  };
  assert.ok(
    storyValidation(invalid, {
      publish: true,
      now: new Date("2026-10-23"),
    }).some((e) => /earlier/.test(e.message)),
  );
  assert.ok(
    storyValidation(invalid, { publish: true }).some((e) =>
      /within/.test(e.message),
    ),
  );
  const image = {
    id: randomUUID(),
    assetId: randomUUID(),
    caption: "Work",
    alt: "",
    positionId: null,
    projectFileId: randomUUID(),
    permission: false,
  };
  const errors = storyValidation(
    { ...story, title: "A", images: [image] },
    { publish: true },
  );
  assert.ok(errors.some((e) => /description/.test(e.message)));
  assert.ok(errors.some((e) => /permission/.test(e.message)));
  assert.equal(
    storyValidation(
      {
        ...story,
        title: "A",
        summary: "I built this.",
        positions: [role({ start: "", end: "" })],
      },
      { publish: true },
    ).length,
    0,
  );
});
test("overlapping positions count once and hidden positions do not extend duration", () => {
  assert.equal(
    positionDuration([
      role({ start: "2025-01", end: "2025-06" }),
      role({ start: "2025-04", end: "2025-12" }),
      role({ start: "2020-01", end: "2024-12", hidden: true }),
    ]),
    "1 yr",
  );
  assert.equal(
    positionDuration(
      [role({ start: "2026-03", current: true })],
      new Date("2026-10-23"),
    ),
    "8 mo",
  );
  assert.equal(positionDuration([role({ start: "2026-03", end: "" })]), null);
});
test("personal-role removal detaches images; recorded roles are hidden without erasing history", () => {
  const position = role();
  const image = {
    id: randomUUID(),
    assetId: randomUUID(),
    caption: "",
    alt: "Work",
    positionId: position.id,
    projectFileId: null,
    permission: true,
  };
  const story = {
    ...blankContributionStory("A"),
    positions: [position],
    images: [image],
  };
  const removed = removeStoryPosition(story, position.id);
  assert.equal(removed.positions.length, 0);
  assert.equal(removed.images[0]!.positionId, null);
  const recorded = {
    ...story,
    positions: [{ ...position, recordedStageId: randomUUID() }],
  };
  const hidden = removeStoryPosition(recorded, position.id);
  assert.equal(hidden.positions.length, 1);
  assert.equal(hidden.positions[0]!.hidden, true);
  assert.equal(
    removeStoryPosition(hidden, position.id).positions[0]!.hidden,
    false,
  );
});
test("three-way recovery keeps independent fields and merges individual role edits", () => {
  const p = role();
  const base = {
    ...blankContributionStory("A"),
    summary: "Base",
    positions: [p],
  };
  const mine = {
    ...base,
    summary: "My story",
    positions: [{ ...p, title: "Lead" }],
  };
  const theirs = {
    ...base,
    skills: ["React"],
    positions: [{ ...p, description: "New description" }],
  };
  const merged = mergeContributionStory(base, mine, theirs);
  assert.equal(merged.summary, "My story");
  assert.deepEqual(merged.skills, ["React"]);
  assert.equal(merged.positions[0]!.title, "Lead");
  assert.equal(merged.positions[0]!.description, "New description");
});
test("three-way recovery preserves removal and independent additions", () => {
  const p = role(),
    q = role();
  const base = { ...blankContributionStory("A"), positions: [p] };
  assert.deepEqual(
    mergeContributionStory(
      base,
      { ...base, positions: [] },
      { ...base, positions: [p, q] },
    ).positions,
    [q],
  );
});
test("website and repository classification is safe while incomplete URLs are being edited", () => {
  const links = [
    {
      id: randomUUID(),
      label: "Usability report",
      url: "https://example.com/report",
    },
    { id: randomUUID(), label: "Project website", url: "https://example.com" },
    { id: randomUUID(), label: "Code", url: "https://github.com/example/app" },
    { id: randomUUID(), label: "Website", url: "htt" },
  ];
  const result = storyProjectLinks(links);
  assert.equal(result.identity.length, 2);
  assert.equal(result.supporting.length, 1);
  assert.equal(result.supporting[0]!.label, "Usability report");
});
test("references carry identities only and activity is an optional inline token", () => {
  const summary = `Worked with ${referenceToken("person", randomUUID())} and ${referenceToken("activity", "files")}.`;
  assert.deepEqual(
    storyReferences(summary).map((r) => r.kind),
    ["person", "activity"],
  );
  assert.equal(storyReferences("Email me at work@example.com.").length, 0);
  assert.equal(storyReferences('{% ref.person id="bad\"script" %}').length, 0);
});
test("visible positions follow explicit current status and start dates", () => {
  const first = role({ start: "2026-05" }),
    current = role({ start: "2026-01", current: true }),
    hidden = role({ hidden: true });
  assert.deepEqual(
    sortedStoryPositions([first, hidden, current]).map((p) => p.id),
    [current.id, first.id],
  );
});
test("legacy contributions migrate without inventing a current position when an end date exists", () => {
  const id = randomUUID();
  const c = {
    id,
    projectId: null,
    title: "Engineer",
    projectTitle: "Legacy",
    projectHref: null,
    repoUrl: null,
    description: "My work",
    startDate: "2025-01-01",
    endDate: "2025-07-01",
    currentlyActive: false,
    skills: ["TypeScript"],
    source: "manual",
    verified: false,
    roleStages: [],
    visibility: "public" as const,
  };
  const story = storyFromContribution(c);
  assert.equal(story.summary, "My work");
  assert.equal(story.current, false);
  assert.equal(story.end, "2025-07");
  assert.equal(story.visible, true);
  assert.deepEqual(storyFromContribution({ ...c, draftStory: story }), story);
});
