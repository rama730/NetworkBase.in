import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { projectActionsSource } from "./_workspace-actions-source";

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('legacy bulk-read support remains defensive but is removed from the tray workflow', () => {
    const actions = readProjectFile('src/app/actions/notifications.ts');
    const hook = readProjectFile('src/hooks/useNotifications.ts');
    const tray = readProjectFile('src/components/layout/header/NotificationPreview.tsx');

    assert.doesNotMatch(actions, /markAllNotificationsReadAction/);
    assert.doesNotMatch(tray, /Mark all read/);
});

test('tray reviews are staged until close, then committed as seen without consuming linked content', () => {
    const actions = readProjectFile('src/app/actions/notifications.ts');
    const service = readProjectFile('src/lib/notifications/service.ts');
    const hook = readProjectFile('src/hooks/useNotifications.ts');
    const row = readProjectFile('src/components/notifications/NotificationRow.tsx');

    assert.match(actions, /export async function markNotificationsSeenAction\(notificationIds: string\[\]\)/);
    assert.match(actions, /markNotificationsSeen\(user\.id, notificationIds, db\)/);
    assert.match(service, /export async function markNotificationsSeen\(/);
    assert.match(service, /\.slice\(0, 50\)/);
    assert.match(hook, /viewedNotificationIdsRef/);
    assert.match(hook, /stageViewedNotifications/);
    assert.match(hook, /commitViewedNotifications/);
    assert.match(hook, /markNotificationsSeenAction\(notificationIds\)/);
    assert.match(hook, /markNotificationsSeenInInfiniteData/);
    assert.match(row, /setTimeout\(markViewed, QUALIFIED_VIEW_MS\)/);
    assert.doesNotMatch(row, /markNotificationsReadAction/);
    assert.doesNotMatch(hook, /markNotificationsReadAction/);
});

test('notification ordering is based on source activity and actor previews are canonicalized once per fan-out', () => {
    const schema = readProjectFile('src/lib/db/schema/index.ts');
    const service = readProjectFile('src/lib/notifications/service.ts');
    const fanout = readProjectFile('src/lib/notifications/fanout.ts');
    const migration = readProjectFile('drizzle/0128_notification_activity_state_contract.sql');

    assert.match(schema, /activityAt:\s*timestamp\(["']activity_at["']/);
    assert.match(service, /orderBy\(desc\(userNotifications\.activityAt\), desc\(userNotifications\.id\)\)/);
    assert.match(service, /activityAt: now/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS "activity_at"/);
    assert.match(fanout, /async function hydrateActorPreviews/);
    assert.match(fanout, /inArray\(profiles\.id, actorIds\)/);
    assert.match(fanout, /writes = await hydrateActorPreviews/);
});

test('message notification previews are redacted from existing rows', () => {
    const migration = readProjectFile('drizzle/0132_message_notification_preview_redaction.sql');

    assert.match(migration, /UPDATE public\.user_notifications/);
    assert.match(migration, /SET body = NULL/);
    assert.match(migration, /WHERE kind = 'message_burst' AND body IS NOT NULL/);
});

test('all source notification writes persist inline and only use the worker to retry failed writes', () => {
    const fanout = readProjectFile('src/lib/notifications/fanout.ts');

    assert.match(fanout, /import \{ db \} from ["']@\/lib\/db["']/);
    assert.match(fanout, /source-action:inline/);
    assert.match(fanout, /deliverNotificationFanout\([\s\S]*executor \?\? db/);
    assert.match(fanout, /source-action:inline-retry/);
    assert.match(fanout, /const failedWrites = deliveries\.flatMap/);
});

test('profile enrichment failure does not prevent durable notification writes', () => {
    const fanout = readProjectFile('src/lib/notifications/fanout.ts');

    assert.match(fanout, /let writes = normalizedWrites;/);
    assert.match(fanout, /notifications\.actor_preview_hydration_failed/);
    assert.match(fanout, /writes = await hydrateActorPreviews/);
});

test('every user-visible project notification preference has a concrete source trigger', () => {
    const policy = readProjectFile('src/lib/notifications/workspace-policy.ts');
    const sourceFiles = [
        'src/app/actions/workspace/index.ts',
        'src/lib/workspaces/server/common.ts',
        'src/lib/workspaces/server/detail.ts',
        'src/lib/workspaces/server/lifecycle.ts',
        'src/lib/workspaces/server/access.ts',
        'src/lib/workspaces/server/settings.ts',
        'src/lib/workspaces/server/tasks.ts',
        'src/lib/workspaces/server/sprints.ts',
        'src/app/actions/task.ts',
        'src/app/actions/task-comment.ts',
        'src/app/actions/workspace/doc.ts',
        'src/app/actions/org-docs.ts',
        'src/app/actions/workspace/updates.ts',
        'src/app/actions/account.ts',
        'src/app/actions/files/mutations.ts',
        'src/app/actions/files/versions.ts',
        'src/app/actions/applications/internal.ts',
        'src/lib/applications/notifications.ts',
        'src/lib/notifications/task-file.ts',
        'src/lib/notifications/task-comment-mention.ts',
        'src/lib/workspaces/task-assignment.ts',
        'src/lib/workspaces/task-transition-service.ts',
    ].map(readProjectFile).join('\n');
    const visibleEntries = Array.from(policy.matchAll(/^    "([^"]+)": E\(\{[\s\S]*?\n    \}\),/gm))
        .filter((entry) => /visible: true/.test(entry[0]));

    assert.ok(visibleEntries.length > 0);
    for (const entry of visibleEntries) {
        const key = entry[1]!;
        assert.match(sourceFiles, new RegExp(`["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
    }
});

test('normal and collaborator-removal assignments use the canonical activity and notification flow', () => {
    const actions = readProjectFile('src/app/actions/task.ts');
    const lifecycle = readProjectFile('src/lib/workspaces/collaborator-lifecycle.ts');
    const projectActions = projectActionsSource();
    const assignment = readProjectFile('src/lib/workspaces/task-assignment.ts');
    for (const source of [actions, lifecycle]) {
        assert.match(source, /await recordTaskAssignment\(/);
        assert.match(source, /taskAssignmentNotification\(/);
    }
    assert.match(assignment, /eventKey: "tasks.assigned"/);
    assert.match(assignment, /sourceEventId: input\.eventId/);
    assert.match(projectActions, /await enqueueWorkspaceNotificationEvents\(txResult\.lifecycle\.assignmentNotifications\)/);
    assert.match(projectActions, /return \{ ok: true as const, lifecycle \};\s*\}\)\.catch\(/);
});
