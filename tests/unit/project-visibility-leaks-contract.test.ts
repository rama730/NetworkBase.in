import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const fnBody = (source: string, name: string) => {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf("\nexport ", start + name.length);
  return source.slice(start, next < 0 ? undefined : next);
};

test("COR-002: the file-content server action has no caller-controlled bypass", () => {
  const action = read("src/app/actions/files/content.ts");
  const facade = fnBody(action, "export async function getProjectFileContent(");
  assert.match(facade, /getProjectFileContent\(projectId: string, nodeId: string\)/);
  assert.match(facade, /assertProjectFileReadAccess\(projectId, actorId\)/);
  assert.doesNotMatch(action, /skipFileTabCheck/);
  const reader = read("src/lib/files/content-reader.ts");
  assert.doesNotMatch(reader, /^"use server"/m, "the private reader must not be a server action");
  assert.match(reader, /^import "server-only";/m);
  assert.match(reader, /assertTaskFileNodeVisible\(access, node\)/);
});

test("COR-006: GitHub blob recovery resolves credentials through the sealed resolver", () => {
  const reader = read("src/lib/files/content-reader.ts");
  assert.match(reader, /resolveGithubRepoAccess\(/);
  assert.doesNotMatch(reader, /importAuth \|\| importSource\.metadata\?\.githubToken/);
});

test("COR-034/COR-035: doc reads honor draft status, hide task files and never delete docs", () => {
  const doc = read("src/app/actions/project/doc.ts");
  assert.equal((doc.match(/projectStatus: project\.status/g) ?? []).length, 2);
  assert.equal((doc.match(/fileScope\)/g) ?? []).length, 2);
  const readAction = fnBody(doc, "export async function readProjectDocAction(");
  assert.doesNotMatch(readAction, /db\.delete\(projectDocs\)/);
  assert.match(readAction, /eq\(projectNodes\.projectId, projectId\)/);
});

test("COR-003: Files task search returns nothing without Tasks visibility", () => {
  const search = fnBody(read("src/app/actions/files/links.ts"), "export async function searchProjectTasks(");
  const guard = search.indexOf("if (!canReadProjectTaskFiles(access)) return [];");
  assert.ok(guard > 0 && guard < search.indexOf("db\n") + 1e9 && guard < search.indexOf(".from(tasks)"), "guard before any task query");
});

test("COR-022: project statuses use the canonical readability rule (drafts hidden)", () => {
  const statuses = fnBody(read("src/app/actions/presence.ts"), "export async function getProjectStatuses(");
  assert.match(statuses, /getProjectAccessByIds\(ids, user\?\.id \?\? null\)/);
  assert.match(statuses, /access\[id\]\?\.canRead/);
  assert.doesNotMatch(statuses, /coalesce\(p\.visibility, 'public'\) <> 'private'/);
});

test("COR-043: task, sprint and member loaders gate on their tab, sprint task rows on Tasks", () => {
  const project = read("src/app/actions/project/index.ts");
  const tasks = fnBody(project, "async function fetchProjectTasksForActor(");
  assert.match(tasks, /canReadProjectTab\(access, "tasks"\)/);
  assert.match(fnBody(project, "export async function fetchProjectSprintsAction("), /assertProjectTabReadAccess\(projectId, actorId, "sprints"\)/);
  assert.match(fnBody(project, "export async function getProjectTaskDetailAction("), /assertProjectTabReadAccess\(projectId, actorId, "tasks"\)/);
  for (const name of ["async function buildSprintDetailPayload(", "async function buildSprintTimelinePagePayload("]) {
    const body = fnBody(project, name);
    assert.match(body, /canReadProjectTab\(access, "sprints"\)/, name);
    assert.match(body, /showTasks \? readSprintTaskActivityPage/, name);
  }
  assert.equal((project.match(/resolveProjectDocPermission\(\{/g) ?? []).length, 2, "shell + public metadata README gated by doc permission");
});

test("COR-042: exported project readers derive the actor from the session", () => {
  const project = read("src/app/actions/project/index.ts");
  assert.match(fnBody(project, "export async function readProjectDetailShell("), /getViewerAuthContext\(\)/);
  assert.match(fnBody(project, "export async function readProjectSprintDetail("), /getViewerAuthContext\(\)/);
  assert.doesNotMatch(project, /export async function getProjectDetailShellAction/);
});

test("COR-044: profile role picker is session-scoped and lists only publicly readable non-draft projects", () => {
  const picker = fnBody(read("src/app/actions/project/index.ts"), "export async function getProfileProjectsWithOpenRolesAction(");
  assert.match(picker, /\(\s*targetProfileId: string,\s*input:/);
  assert.match(picker, /getViewerAuthContext\(\)/);
  assert.match(picker, /relationship\?\.canViewProfile/);
  assert.match(picker, /inArray\(projects\.visibility, \["public", "unlisted"\]\)/);
  assert.match(picker, /<> 'draft'/);
});

test("COR-038: update references hydrate only from visible tabs; sync task list needs Tasks", () => {
  const updates = read("src/app/actions/project/updates.ts");
  const summaries = fnBody(updates, "async function contextSummariesForRows(");
  assert.match(summaries, /canReadTasks && taskIds\.size > 0/);
  assert.match(summaries, /canReadSprints && sprintIds\.size > 0/);
  assert.match(summaries, /canReadFiles && fileIds\.size > 0/);
  assert.match(summaries, /canReadTasks \? undefined : projectContentNodeSql/);
  assert.match(fnBody(updates, "export async function resolveProjectUpdateMentionTargetAction("), /canReadProjectUpdateTargetTab\(access, "task"\) \? undefined : projectContentNodeSql/);
  assert.match(fnBody(read("src/app/actions/github-sync.ts"), "export async function getProjectSyncTasks("), /assertProjectTabReadAccess\(projectId, user\.id, "tasks"\)/);
});

test("AUTH-002/AUTH-004/VALID-001: extension readers and heartbeat use the canonical tab rules", () => {
  for (const route of ["project-summary", "project-tasks"]) {
    assert.match(read(`src/app/api/v1/extension/${route}/route.ts`), /canReadProjectTab\(access, "tasks"\)/, route);
  }
  const folder = read("src/app/api/v1/extension/folder/route.ts");
  assert.match(folder, /canReadProjectTab\(access, "files"\)/);
  assert.match(folder, /canReadProjectTab\(access, "tasks"\) \? undefined : projectContentNodeSql/);
  const detail = read("src/app/api/v1/extension/task-detail/route.ts");
  assert.match(detail, /canReadProjectTab\(access, "tasks"\)/);
  assert.doesNotMatch(detail, /row\.visibility === "public"/);
  const heartbeat = read("src/app/api/v1/extension/heartbeat/route.ts");
  assert.match(heartbeat, /getProjectAccessByIds\(Object\.keys\(parsed\.data\.projectWatermarks\), user\.id\)/);
  assert.match(heartbeat, /\.record\(z\.string\(\)\.uuid\(\), z\.string\(\)\.max\(64\)\)/);
  assert.match(heartbeat, /consumeRateLimit\(`extension-heartbeat:/);
});

test("AUTH-013: profile project projections carry public links only; cached summaries re-versioned", () => {
  const collaboration = read("src/lib/profile/collaboration.ts");
  assert.match(collaboration, /externalLinks: filterProjectLinksForAudience\(row\.external_links, false\)/);
  assert.doesNotMatch(collaboration, /externalLinks: row\.external_links/);
  assert.match(collaboration, /const SUMMARY_VERSION = 7;/);
});

test("COR-029: request feeds and role alignment project people through profile privacy", () => {
  const connections = read("src/app/actions/connections.ts");
  const requestBranch = connections.slice(connections.indexOf("if (tab === 'requests_incoming' || tab === 'requests_sent')"));
  assert.match(requestBranch.slice(0, requestBranch.indexOf("let suggestionCursor")), /resolvePrivacyRelationships\(user\.id, dedupedItems\.map/);
  const accepted = fnBody(connections, "export async function getAcceptedConnections(");
  assert.match(accepted, /resolvePrivacyRelationship\(user\?\.id \?\? null, targetUserId\)/);
  assert.match(accepted, /buildViewerScopedProfileView\(/);
  assert.doesNotMatch(accepted, /visibility === 'private'/);
  const resolver = read("src/app/actions/matchmaking/resolver.ts");
  assert.ok(resolver.indexOf("relationship?.canViewProfile") < resolver.indexOf("db.query.profiles.findFirst"));
});

test("COR-059: subtree rewrites match literal path prefixes within the task scope", () => {
  const merge = read("src/lib/projects/merge-sandbox.ts");
  assert.doesNotMatch(merge, /path LIKE/);
  const project = read("src/app/actions/project/index.ts");
  assert.doesNotMatch(project, /path LIKE \$\{`\$\{node\.path\}\/%`\}/);
  assert.match(project, /AND task_id = \$\{taskId\}\s+AND starts_with\(path, \$\{`\$\{node\.path\}\/`\}\)/);
});

test("COR-006: hydration resolves GitHub access itself and events carry no credential", () => {
  const hydrate = read("src/inngest/functions/project-import-hydrate.ts");
  assert.match(hydrate, /resolveGithubRepoAccess\(\{/);
  assert.doesNotMatch(hydrate, /importSource\.metadata\?\.importAuth/);
  assert.match(read("src/lib/github/project-import-runner.ts"), /importSource: clearSealedGithubTokenFromImportSource\(project\.importSource\)/);
});
