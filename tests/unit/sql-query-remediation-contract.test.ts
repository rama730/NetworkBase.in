import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

const read = (path: string) => readFileSync(path, "utf8");

describe("SQL audit query remediations", () => {
  it("persists and advances the workspace-file reconciliation keyset", () => {
    const source = read("src/inngest/functions/workspace-files-reconciliation.ts");
    assert.match(source, /jobHeartbeats\.lastPayload/);
    assert.match(source, /workspaceNodes\.projectId}, \$\{workspaceNodes\.id}\) > /);
    assert.match(source, /\.limit\(MAX_KEYS_PER_PROJECT\)/);
    assert.match(source, /target: jobHeartbeats\.jobId/);
  });

  it("bounds Git storage writes and persists only confirmed uploads", () => {
    const source = read("src/lib/github/sync-service.ts");
    assert.match(source, /const uploads = await Promise\.allSettled\(/);
    assert.match(source, /if \(upload\.status === "fulfilled" && upload\.value\)\s*snapshotRefs\.push\(upload\.value\)/);
    assert.match(source, /if \(failed\?\.status === "rejected"\) throw failed\.reason;/);
    assert.match(source, /githubSyncSnapshotAssets/);
    assert.match(source, /canonical abandoned-asset worker/);
    assert.doesNotMatch(source, /if \(!persisted && uploaded\.length\) await storage\.remove\(uploaded\);/);
    assert.match(source, /for \(let offset = 0; offset < choices\.length; offset \+= batchSize\)/);
  });

  it("claims a bounded upload-intent batch and delegates canonical deletion", () => {
    const source = read("src/lib/upload/upload-intents.ts");
    assert.match(source, /\.limit\(100\)\s*\.for\("update", \{ of: uploadIntents, skipLocked: true \}\)/);
    assert.match(source, /credentialGraceCutoff/);
    assert.match(source, /state: "delete_pending"/);
    assert.match(source, /legacyExpired/);
  });

  it("serializes connection reactivation and application capacity", () => {
    const connections = read("src/app/actions/connections.ts");
    const applications = read("src/app/actions/applications/internal.ts");
    assert.match(connections, /pg_advisory_xact_lock\(hashtextextended\('connection-pair:' \|\| \$\{pairKey\}, 0\)\)/);
    assert.match(connections, /eq\(connections\.status, 'pending'\)/);
    assert.match(connections, /jsonb_to_recordset/);
    // One shared lock-and-count serialises every path that can add a pending application.
    assert.match(applications, /pg_advisory_xact_lock\(hashtextextended\('application-pending-cap:' \|\| \$\{applicantId\}, 0\)\)/);
    assert.match(applications, /APPLICATION_PENDING_CAP_PER_USER/);
    assert.equal((applications.match(/await lockPendingCap\(tx, /g) ?? []).length >= 2, true);
  });

  it("keeps selector reads search-keyset paginated and bounded", () => {
    const profile = read("src/lib/profile/collaboration.ts");
    const projects = projectActionsSource();
    assert.match(profile, /input: \{ search\?: string; cursor\?: string; limit\?: number; projectId\?: string \}/);
    assert.match(profile, /ORDER BY p\.updated_at DESC, p\.id DESC/);
    assert.match(projects, /input: \{ search\?: string; cursor\?: string; limit\?: number \}/);
    assert.match(projects, /\.limit\(limit \+ 1\)/);
  });

  it("bounds upload collision preflight to submitted sibling chains", () => {
    const source = read("src/app/actions/files/mutations.ts");
    assert.match(source, /paths\.length > 5000/);
    assert.match(source, /segmentCount > 10_000/);
    assert.match(source, /WITH RECURSIVE input_paths/);
    assert.match(source, /node\.parent_id IS NOT DISTINCT FROM walk\.parent_id/);
    assert.match(source, /lower\(node\.name\) = lower\(walk\.segments\[walk\.depth\]\)/);
  });

  it("applies GitHub reconciliation mutations in bounded set-based batches", () => {
    const source = read("src/lib/github/workspace-import-runner.ts");
    assert.match(source, /filesToUpdate\.slice\(index, index \+ RECONCILE_DELETE_BATCH_SIZE\)/);
    assert.match(source, /FROM jsonb_to_recordset/);
    assert.match(source, /nodeIdsToDelete\.slice\(index, index \+ RECONCILE_DELETE_BATCH_SIZE\)/);
    assert.doesNotMatch(source, /for \(const remote of fileNodes\)[\s\S]{0,1800}\.update\(workspaceNodes\)/);
  });

  it("bounds workspace pages and consolidates project task aggregates", () => {
    const workspace = read("src/app/actions/my-work.ts");
    const projects = projectActionsSource();
    assert.match(workspace, /function normalizeMyWorkLimit/);
    assert.match(workspace, /Number\.isFinite\(parsed\)/);
    assert.match(workspace, /const visibleProjectCheck = exists\(/);
    assert.match(workspace, /eq\(workspaceMembers\.userId, user\.id\)/);
    assert.match(workspace, /limit: safeLimit \+ 1/);
    assert.match(projects, /WITH selected_tasks AS/);
    assert.match(projects, /subtask_counts AS/);
    assert.match(projects, /file_counts AS/);
    assert.match(projects, /comment_counts AS/);
    assert.match(projects, /membersCount = Number\(membersResult\[0\]\?\.totalCount \?\? 0\)/);
  });

  it("updates accepted connection cache pairs incrementally", () => {
    const helpers = read("src/lib/connections/internal-helpers.ts");
    const actions = read("src/app/actions/connections.ts");
    assert.match(helpers, /applyConnectionPairsToRedis/);
    assert.match(helpers, /pipeline\.sadd/);
    assert.match(helpers, /pipeline\.srem/);
    assert.match(helpers, /existencePipeline\.exists/);
    assert.match(helpers, /missing set means "unknown"/);
    assert.match(actions, /applyConnectionPairsToRedis\(accepted, 'add'\)/);
  });

  it("uses OCC for lifecycle writes and one project snapshot for update access", () => {
    const projects = projectActionsSource();
    const updates = read("src/app/actions/workspace/updates.ts");
    assert.match(projects, /eq\(workspaces\.updatedAt, project\.updatedAt\)/);
    assert.match(projects, /Stages changed\. Refresh and retry\./);
    assert.match(updates, /computeWorkspaceReadAccess\(project\.visibility, project\.status, isOwner, isMember, parentOrgRole\)/);
    assert.doesNotMatch(updates, /getWorkspaceAccessById/);
  });

  it("retries transient push delivery and only closes terminal attempts", () => {
    const source = read("src/lib/notifications/push-queue.ts");
    assert.match(source, /delivery\.status IN \('delivered', 'dropped'\)/);
  });
});
