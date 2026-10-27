import assert from "node:assert/strict";
import { test } from "node:test";

import { childProjectsOf, defaultChannelName, orgChatSettings, workspaceProjects } from "../../src/lib/organizations/chat-rules";

test("a child project's default channel is its handle; others stay #general", () => {
  assert.equal(defaultChannelName("compiler_lab", true), "compiler-lab");
  assert.equal(defaultChannelName("North Region!", true), "north-region");
  assert.equal(defaultChannelName("---", true), "general");
  assert.equal(defaultChannelName("compiler-lab", false), "general");
});

test("org chat settings default by type: Education keeps channel creation for admins", () => {
  assert.deepEqual(orgChatSettings({}, "education"), { membersCreateChannels: false, generalAdminsOnly: false });
  assert.deepEqual(orgChatSettings({}, "company"), { membersCreateChannels: true, generalAdminsOnly: false });
  assert.deepEqual(orgChatSettings({ membersCreateChannels: true, generalAdminsOnly: true }, "education"), { membersCreateChannels: true, generalAdminsOnly: true });
});

test("child projects live inside their org's workspace; outside people see theirs as a Guest workspace", () => {
  const projects = [
    { id: "org", title: "CSE-3A", kind: "organization" },
    { id: "lab", title: "Compiler Lab", parent_id: "org", parent_title: "CSE-3A" },
    { id: "north", title: "North region", parent_id: "acme", parent_title: "Acme Sales" },
    { id: "solo", title: "Side project" },
  ];
  assert.deepEqual(workspaceProjects(projects).map((p) => [p.id, p.guestOf ?? null]), [["org", null], ["north", "Acme Sales"], ["solo", null]]);
  assert.deepEqual(childProjectsOf(projects, "org").map((p) => p.id), ["lab"]);
});
