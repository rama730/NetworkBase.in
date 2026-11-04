import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { ASSIGNMENT_STATE_LABELS, SPRINT_STATUS_LABELS } from "@/lib/copy/terms";
import { roleCount, rolePlural } from "@/lib/organizations/role-words";
import { activityIcon, activityTime } from "@/lib/organizations/activity-rules";
import { isWorkspaceTabVisibleToViewer } from "@/lib/workspaces/settings-policies";

// Step 3 (report §5, §34.2, §37.6, §39.5): shared words and blocks every later tab step uses.

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

test("5.7, decision 84: one set of status words, kept in terms.ts", () => {
  assert.deepEqual(Object.values(ASSIGNMENT_STATE_LABELS), ["Not started", "In progress", "In review", "Returned", "Done", "Missing", "Excused"]);
  assert.deepEqual(Object.values(SPRINT_STATUS_LABELS), ["Upcoming", "Active", "Completed", "Archived", "Canceled"]);
  for (const file of ["src/components/organizations/AssignmentsPanel.tsx", "src/components/organizations/OrgOverviewParts.tsx", "src/components/organizations/OrgSprintParts.tsx", "src/components/messages/cards/MessageCard.tsx"]) {
    assert.doesNotMatch(source(file), /not_started: ['"]Not started['"]/, `${file} uses ASSIGNMENT_STATE_LABELS`);
  }
});

test("39.5, decision 110: role words make plurals and counts the same way everywhere", () => {
  assert.equal(rolePlural("Student"), "Students");
  assert.equal(rolePlural("TA"), "TAs");
  assert.equal(rolePlural("Researchers"), "Researchers", "already plural");
  for (const word of ["Staff", "Faculty", "Crew", "Team"]) assert.equal(rolePlural(word), word, word);
  assert.equal(roleCount(40, "Student"), "40 Students");
  assert.equal(roleCount(1, "Student"), "1 Student");
  assert.equal(roleCount(0, "TA"), "0 TAs");
});

test("5.3: activity rows use one icon per kind and the real event time", () => {
  assert.deepEqual(["sprint", "workspace", "join", "announcement", "document", "file", "assignment", "submission", "task", "github"].map(activityIcon),
    ["IterationCcw", "FolderKanban", "UserRoundPlus", "Megaphone", "BookOpenText", "FilePlus2", "ClipboardCheck", "CheckCircle2", "ListTodo", "GitBranch"]);
  const started = new Date("2026-11-02T10:05:00Z");
  assert.equal(activityTime({ kind: "sprint", startedAt: started, plannedStart: new Date("2026-11-01T18:30:00Z") }).toISOString(), started.toISOString(), "a sprint uses when it really started");
});

test("37.6, 34.2: the tab table for a public organization", () => {
  const can = (tabId: string, who: "admin" | "member" | "visitor") => isWorkspaceTabVisibleToViewer({
    tabId, isOrganization: true, isOwnerOrMember: who !== "visitor", canManageSettings: who === "admin",
    publicTabVisibility: { dashboard: true, readme: true, updates: true, files: true, sprints: false, tasks: false },
  });
  const tabs = ["dashboard", "about", "readme", "updates", "sprints", "tasks", "files", "projects", "members", "settings"];
  assert.deepEqual(tabs.filter((t) => can(t, "admin")), tabs);
  assert.deepEqual(tabs.filter((t) => can(t, "member")), tabs.filter((t) => t !== "members"));
  assert.deepEqual(tabs.filter((t) => can(t, "visitor")), ["about", "readme", "updates", "files"], "Overview, Tasks, Workspaces, Members and Settings never; Sprints off by default");
});

test("smaller bug 13 and 17.1: admins start on ?tab=members; the child header says only what's unusual", () => {
  assert.match(source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx"), /canManageSettings: isOwner \|\| \(isMember && normalizeWorkspaceMemberRole\(memberRole, 'member'\) === 'admin'\)/);
  const header = source("src/components/organizations/OrgHeaderParts.tsx");
  assert.match(header, /Viewing as admin/);
  assert.doesNotMatch(header, /Admin · from/);
  assert.doesNotMatch(header, /\{parentOrg\.title\} \/<\/span>/, "no trailing slash on the breadcrumb");
  assert.match(source("src/components/layout/header/TopNav.tsx"), /pathname\.startsWith\('\/org\/'\)/, "7.1: outlined on organization pages too");
});
