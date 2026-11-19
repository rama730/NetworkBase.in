import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const schema = source("src/lib/db/schema/index.ts");
const projectActions = projectActionsSource();
const taskActions = source("src/app/actions/task.ts");
const migration = source("drizzle/0008_tasks_sprints.sql");

describe("sprint lifecycle and history integrity contract", () => {
  it("persists stable Sprint numbers and enforces one Active Sprint per project", () => {
    assert.match(schema, /sprintNumber: integer\("sprint_number"\)\.notNull\(\)/);
    assert.match(schema, /workspace_sprints_one_active_idx/);
    assert.match(migration, /workspace_sprints_one_active_idx[^\n]*WHERE \(status = 'active'/);
  });

  it("uses durable memberships instead of mutable task placement for Sprint history", () => {
    assert.match(schema, /export const sprintTaskMemberships/);
    assert.match(schema, /removedAt: timestamp\("removed_at"/);
    assert.match(projectActions, /FROM \$\{sprintTaskMemberships\}/);
    assert.match(projectActions, /membershipState: row\.membership_removed_at \? "historical" : "committed"/);
    assert.match(taskActions, /tx\.insert\(sprintTaskMemberships\)/);
    assert.match(migration, /CREATE TABLE public\.sprint_task_memberships /);
  });

  it("blocks destructive history deletion and records lifecycle events transactionally", () => {
    assert.match(projectActions, /Sprints with work history are archived instead of deleted/);
    assert.match(projectActions, /tx\.insert\(workspaceSprintEvents\)/);
    assert.match(schema, /taskId: uuid\("task_id"\)[\s\S]*?references\(\(\) => tasks\.id, \{ onDelete: "restrict" \}\)/);
  });

  // Decision 146: owners and admins both plan sprints, in organizations and normal workspaces.
  it("keeps Sprint assignment and lifecycle mutations on the same owner-and-admin boundary", () => {
    // Report 38.4 call 3: a member's sprint pick goes to the Backlog instead of failing; owners and admins keep it.
    assert.match(projectActions, /if \(validated\.sprintId && !ownerOrAdmin\) \{\s*validated\.sprintId = null;\s*backlogged = true;/);
    assert.match(taskActions, /Only owners and admins can change sprint assignments/);
    assert.match(projectActions, /eq\(workspaceSprints\.status, "active"\)/);
  });

  it("preserves readable creator snapshots", () => {
    assert.match(projectActions, /creatorName: creator\.actorName/);
    assert.match(projectActions, /applySprintCreatorSnapshots/);
  });
});
