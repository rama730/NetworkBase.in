import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activityActorName,
  describeGithubPush,
  describeMembershipEvent,
  isPublishableFileMetadata,
  newestProjectActivities,
  recentActivityAudience,
  type ProjectRecentActivityItem,
} from "../../src/lib/workspaces/recent-activity";

const root = process.cwd();

test("recent activity orders all four categories and suppresses duplicate source events", () => {
  const item = (id: string, type: ProjectRecentActivityItem["type"], minute: number): ProjectRecentActivityItem => ({
    id, type, text: id, occurredAt: new Date(Date.UTC(2026, 8, 20, 12, minute)).toISOString(), href: "/workspaces/example",
  });
  assert.deepEqual(newestProjectActivities([
    item("member:1", "member", 1), item("task:2", "task", 2), item("file:3", "file", 3),
    item("github:4", "github", 4), item("github:4", "github", 4),
  ]).map((entry) => entry.id), ["github:4", "file:3", "task:2"]);
  const file = item("file:first", "file", 1);
  const retry = { ...item("file:retry", "file", 4), href: file.href };
  assert.deepEqual(newestProjectActivities([file, item("task:transition", "task", 2), retry]).map((entry) => entry.id),
    ["file:retry", "task:transition"]);
});

test("public audience excludes non-public task and file categories while members see both", () => {
  assert.deepEqual(recentActivityAudience(false, { tasks: false, files: false }), {
    mayReadTasks: false, mayReadFiles: false, mayReadTaskFiles: false, requirePublicProfile: true,
  });
  assert.deepEqual(recentActivityAudience(false, { tasks: false, files: true }), {
    mayReadTasks: false, mayReadFiles: true, mayReadTaskFiles: false, requirePublicProfile: true,
  });
  assert.deepEqual(recentActivityAudience(true, { tasks: false, files: false }), {
    mayReadTasks: true, mayReadFiles: true, mayReadTaskFiles: true, requirePublicProfile: false,
  });
});

test("legacy file privacy flags fail closed and do not leak private uploads", () => {
  assert.equal(isPublishableFileMetadata(null), true);
  for (const metadata of [
    { visibility: "private" }, { visibility: "members" }, { isSystem: true },
    { publicVisible: false }, { privacy: { publicVisible: false } },
    { privacy: { visibility: "members" } },
    { privacy: { private: true } }, { analytics: { publicVisible: false } },
    { analyticsVisible: false }, { analytics: { analyticsVisible: false } },
  ]) assert.equal(isPublishableFileMetadata(metadata), false);
});

test("member joins and role changes are distinct while no-op updates are excluded", () => {
  assert.equal(describeMembershipEvent("Ada", "project_member.added", { previousRole: null, nextRole: "member" }), "Ada joined the workspace");
  assert.equal(describeMembershipEvent("Ada", "project_member.role_changed", { previousRole: "member", nextRole: "admin" }), "Ada became admin");
  assert.equal(describeMembershipEvent("Ada", "project_member.added", { previousRole: "member", nextRole: "member" }), null);
});

test("completed direct pushes and pull requests have distinct copy and private names have a fallback", () => {
  assert.equal(describeGithubPush("Ada", "direct"), "Ada pushed to GitHub");
  assert.equal(describeGithubPush("Ada", "pr"), "Ada opened a GitHub pull request");
  assert.equal(activityActorName(null), "A workspace member");
});

test("old Analytics links, visibility defaults, and migration point to the seven-tab dashboard", () => {
  const client = readFileSync(`${root}/src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx`, "utf8");
  const layout = readFileSync(`${root}/src/components/workspaces/dashboard/WorkspaceLayout.tsx`, "utf8");
  const migration = readFileSync(`${root}/drizzle/0166_project_recent_activity.sql`, "utf8");
  const action = readFileSync(`${root}/src/app/actions/workspace/recent-activity.ts`, "utf8");
  assert.match(client, /tab === 'analytics'\) return 'dashboard'/);
  assert.doesNotMatch(layout, /id: "analytics"/);
  assert.match(migration, /public_tab_visibility - 'analytics'/);
  assert.match(migration, /SET DEFAULT/);
  assert.match(action, /isNull\(tasks\.deletedAt\)/);
  assert.match(action, /isNull\(projectNodes\.deletedAt\)/);
  assert.match(action, /eq\(member\.visibility, "public"\)/);
  assert.match(action, /eq\(githubSyncRuns\.status, "completed"\)/);
  assert.match(action, /result}->>'pushed' = 'true'/);
  assert.match(action, /result}->>'pullRequestUrl'/);
  assert.match(action, /tab=tasks&drawerType=task&drawerId=/);
});

test("recent-activity card hides an empty feed while retaining accessible loading and retry states", () => {
  const card = readFileSync(`${root}/src/components/workspaces/dashboard/RecentActivityCard.tsx`, "utf8");
  const dashboard = readFileSync(`${root}/src/components/workspaces/tabs/DashboardTab.tsx`, "utf8");
  assert.match(card, /<RailSection title="Recent activity" headingId="project-recent-activity-title"/);
  assert.match(card, /h-3\.5 w-3\.5.*text-muted-foreground/);
  assert.match(card, /role="status" aria-label="Loading recent activity"/);
  assert.match(card, /role="alert"/);
  assert.match(card, /activity\.data\?\.length === 0\) return null/);
  assert.doesNotMatch(card, /No recent activity yet/);
  assert.match(card, /focus-visible:outline/);
  assert.ok(dashboard.indexOf("<JourneyTimeline") < dashboard.indexOf("<RecentActivityCard"));
  assert.ok(dashboard.indexOf("<RecentActivityCard") < dashboard.indexOf("<OpenRolesCard"));
});
