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

test("actual project position precedes membership and generic legacy duplicates cannot replace it", () => {
  assert.equal(
    formatContributionPosition({
      roleKind: "owner",
      title: "Lead - Lead",
      projectPosition: "Product Designer",
    }),
    "Product Designer · Lead",
  );
  assert.equal(
    formatContributionPosition({ roleKind: "owner", title: "Lead / Tester" }),
    "Tester · Lead",
  );
  assert.equal(
    formatContributionPosition({
      roleKind: "owner",
      title: "Lead",
      projectPosition: "Full stack developer",
    }),
    "Full stack developer · Lead",
  );
  assert.equal(
    formatContributionPosition({
      roleKind: "admin",
      title: "Co-lead",
      projectPosition: "QA Engineer",
    }),
    "QA Engineer · Co-lead",
  );
  assert.equal(
    formatContributionPosition({
      roleKind: "member",
      title: "Engineer · Member",
    }),
    "Engineer · Member",
  );
  assert.equal(
    formatContributionPosition({ roleKind: "owner", title: "Lead - Lead" }),
    "Lead",
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
