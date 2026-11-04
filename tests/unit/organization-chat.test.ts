import assert from "node:assert/strict";
import { test } from "node:test";

import { childWorkspacesOf, defaultChannelName, orgChatSettings, workspaceWorkspaces } from "../../src/lib/organizations/chat-rules";

test("a child project's default channel is its handle; others stay #general", () => {
  assert.equal(defaultChannelName("compiler_lab", true), "compiler-lab");
  assert.equal(defaultChannelName("North Region!", true), "north-region");
  assert.equal(defaultChannelName("---", true), "general");
  assert.equal(defaultChannelName("compiler-lab", false), "general");
});

test("org chat settings default by type: Education keeps channel creation for admins", () => {
  assert.deepEqual(orgChatSettings({}, "education"), { membersCreateChannels: false, generalAdminsOnly: false, generalNotify: "mentions" });
  assert.deepEqual(orgChatSettings({}, "company"), { membersCreateChannels: true, generalAdminsOnly: false, generalNotify: "all" });
  assert.deepEqual(orgChatSettings({ membersCreateChannels: true, generalAdminsOnly: true, generalNotify: "all" }, "education"), { membersCreateChannels: true, generalAdminsOnly: true, generalNotify: "all" });
});

test("child projects live inside their org's workspace; outside people see theirs as a Guest workspace", () => {
  const projects = [
    { id: "org", title: "CSE-3A", kind: "organization" },
    { id: "lab", title: "Compiler Lab", parent_id: "org", parent_title: "CSE-3A" },
    { id: "north", title: "North region", parent_id: "acme", parent_title: "Acme Sales" },
    { id: "solo", title: "Side project" },
  ];
  assert.deepEqual(workspaceWorkspaces(projects).map((p) => [p.id, p.guestOf ?? null]), [["org", null], ["north", "Acme Sales"], ["solo", null]]);
  assert.deepEqual(childWorkspacesOf(projects, "org").map((p) => p.id), ["lab"]);
});

test("board/review report §7: Messages keeps a team workspace inside its organization in every view; an outside person still sees the team alone", async () => {
  const { workspaceGroups } = await import("../../src/lib/organizations/chat-rules");
  const projects = [
    { id: "falcon", title: "Team Falcon: Hash table library", kind: "project", parent_id: "cse", parent_title: "CSE 3B" },
    { id: "cse", title: "CSE 3B · Data Structures 2026", kind: "organization", parent_id: null },
    { id: "nfb", title: "Network for builders", kind: "project", parent_id: null },
    { id: "osprey", title: "Team Osprey", kind: "project", parent_id: "cse", parent_title: "CSE 3B" },
    { id: "lone", title: "Compiler Lab", kind: "project", parent_id: "other-org", parent_title: "CSE-3A" },
  ];
  const groups = workspaceGroups(projects);
  assert.deepEqual(groups.map((g) => [g.project.id, g.teams.map((t) => t.id)]), [["cse", ["falcon", "osprey"]], ["nfb", []], ["lone", []]], "teams nest; order follows the list");
  assert.equal((groups[2]!.project as { guestOf?: string }).guestOf, "CSE-3A", "an outside person's team says whose it is");
  const { readFileSync } = await import("node:fs");
  const sections = readFileSync("src/components/messages/ChatSections.tsx", "utf8");
  assert.match(sections, /workspaceGroups\(projects\)/);
  assert.doesNotMatch(sections, /childWorkspacesOf\(data\.projects/, "no team headings beside Channels");
  assert.match(sections, />Team workspaces</);
});
