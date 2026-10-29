import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  formatContributionPosition,
  contributionPositionName,
} from "@/lib/profile/contribution-position";
import {
  blankContributionStory,
  reconcileRecordedPositionTitles,
} from "@/lib/profile/contribution-story";
import type { ProfileCollaborationRoleStage } from "@/lib/profile/collaboration";

test("a contribution shows the role title, never the access level; legacy decorations are stripped", () => {
  assert.equal(
    formatContributionPosition({
      title: "Lead - Lead",
      projectPosition: "Product Designer",
    }),
    "Product Designer",
  );
  assert.equal(
    formatContributionPosition({ title: "Lead / Tester" }),
    "Tester",
  );
  assert.equal(
    formatContributionPosition({
      title: "Lead",
      projectPosition: "Full stack developer",
    }),
    "Full stack developer",
  );
  assert.equal(
    formatContributionPosition({
      title: "Co-lead",
      projectPosition: "QA Engineer",
    }),
    "QA Engineer",
  );
  assert.equal(
    formatContributionPosition({
      title: "Engineer · Member",
    }),
    "Engineer",
  );
  assert.equal(
    formatContributionPosition({ title: "Lead - Lead" }),
    "Contributor",
  );
  assert.equal(
    contributionPositionName("Full-stack Developer"),
    "Full-stack Developer",
  );
  assert.equal(contributionPositionName("Technical Lead"), "Technical Lead");
});

test("generated recorded titles reconcile while custom personal titles and historical periods stay intact", () => {
  const id = randomUUID();
  const story = {
    ...blankContributionStory("Caveman"),
    positions: [
      {
        id,
        recordedStageId: id,
        title: "Lead - Lead",
        start: "2026-05",
        end: "",
        current: true,
        hidden: false,
        description: "Designed the product.",
      },
    ],
  };
  const stages = [
    { id, roleTitle: "Product Designer · Lead" },
  ] as ProfileCollaborationRoleStage[];
  const result = reconcileRecordedPositionTitles(story, stages)!;
  assert.equal(result.positions[0]!.title, "Product Designer · Lead");
  assert.equal(result.positions[0]!.start, "2026-05");
  assert.equal(result.positions[0]!.description, "Designed the product.");
  assert.equal(story.positions[0]!.title, "Lead - Lead");
  const custom = {
    ...story,
    positions: [{ ...story.positions[0]!, title: "Principal Designer" }],
  };
  assert.equal(
    reconcileRecordedPositionTitles(custom, stages)!.positions[0]!.title,
    "Principal Designer",
  );
  const personal = {
    ...story,
    positions: [{ ...story.positions[0]!, recordedStageId: null }],
  };
  assert.equal(
    reconcileRecordedPositionTitles(personal, stages)!.positions[0]!.title,
    "Lead - Lead",
  );
  assert.equal(reconcileRecordedPositionTitles(null, stages), null);
});
