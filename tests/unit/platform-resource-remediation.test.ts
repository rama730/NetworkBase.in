import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { isPrivateRealtimeAuthorizationEnabled } from "../../src/lib/realtime/authorization";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Storage and private Realtime share the application key/topic contracts", () => {
  const migration = read("drizzle/0157_storage_realtime_contract_alignment.sql");
  assert.match(migration, /file_size_limit = 8388608/);
  assert.match(migration, /ELSE split_part\(objects\.name, '\/', 1\)/);
  assert.match(migration, /CREATE POLICY application_topic_read ON realtime\.messages/);
  assert.match(migration, /CREATE POLICY application_topic_send ON realtime\.messages/);
  assert.match(migration, /app_private\.nb_can_observe_user_presence/);
  assert.match(migration, /app_private\.nb_project_can_read/);
  // Since the chat cutover, presence follows shared DMs and group chats.
  const cutover = read("drizzle/0181_chat_rebuild_cutover.sql");
  assert.match(cutover, /nb_can_observe_user_presence[\s\S]*chat_channel_members viewer/);
  assert.doesNotMatch(cutover, /presence:conversation/);
});

test("private Realtime is fail-closed until database authorization is promoted", () => {
  const authorization = read("src/lib/realtime/authorization.ts");
  const presence = read("src/lib/realtime/presence-client.ts");
  const activation = read("drizzle/0160_realtime_authorization_activation.sql");
  const exampleEnv = read(".env.local.example");

  assert.match(authorization, /NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED/);
  assert.match(presence, /if \(!isPrivateRealtimeAuthorizationEnabled\(\)\)/);
  assert.match(presence, /await supabase\.realtime\.setAuth\(accessToken\)/);
  assert.doesNotMatch(read("src/lib/realtime/subscriptions.ts"), /private:\s*true/);
  assert.match(activation, /CREATE POLICY application_topic_read ON realtime\.messages/);
  assert.match(activation, /realtime\.messages\.extension IN \('presence', 'broadcast'\)/);
  assert.match(activation, /realtime\.messages\.extension = 'broadcast'/);
  assert.doesNotMatch(presence, /ensureGlobalAuthListener|onAuthStateChange|connectEntry started/);
  assert.match(exampleEnv, /NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED=0/);
});

test("private Realtime rollout parser enables only explicit true values", () => {
  const previous = process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED;
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), false);
    process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = "0";
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), false);
    process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = "true";
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), true);
    process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = " ON ";
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), true);
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = previous;
    }
  }
});

test("resource retention is bounded and observable", () => {
  const retention = read("src/inngest/functions/data-lifecycle-retention.ts");
  const retentionIndexes = read("drizzle/0158_lifecycle_retention_indexes.sql");
  const registry = read("src/inngest/registry.ts");

  assert.match(retention, /profileReadAuditDays: 30/);
  assert.match(retention, /profileActivityAuditDays: 365/);
  assert.match(retention, /FOR UPDATE SKIP LOCKED/g);
  assert.match(retention, /batchSize: 500/);
  assert.match(retentionIndexes, /profile_audit_events \(created_at, id\)/);
  assert.match(retentionIndexes, /onboarding_events \(created_at, id\)/);
  assert.match(retentionIndexes, /extension_device_session_events \(created_at, id\)/);
  assert.match(registry, /dataLifecycleRetention/);
});

test("account cleanup preserves lifecycle evidence before domain cascades", () => {
  const cleanup = read("src/inngest/functions/account-cleanup.ts");
  assert.match(cleanup, /check-unregistered-references/);
  assert.match(cleanup, /schedule-registered-assets/);
  assert.match(cleanup, /state: "delete_pending"/);
  assert.match(cleanup, /physicalDeletionOwner: "storage-asset-deletion"/);
  assert.doesNotMatch(cleanup, /\.storage[\s\S]*\.remove\(/);
});

test("project-file reconciliation quarantines path-correlated objects pending proof", () => {
  const reconciliation = read("src/inngest/functions/project-files-reconciliation.ts");
  assert.match(reconciliation, /buildProjectFileKey/);
  assert.match(reconciliation, /metadataMatches/);
  assert.match(reconciliation, /storage_reconcile_unclaimed_candidate/);
  assert.match(reconciliation, /quarantineRequired: true/);
  assert.doesNotMatch(reconciliation, /storage_reconcile_attached_object/);
  assert.match(reconciliation, /storage_reconcile_ambiguous_path/);
  assert.match(reconciliation, /orphanStorageRows\.filter\(\(row\) => !candidateByName\.has\(row\.name\)\)/);
  assert.match(reconciliation, /reconciliationKey/);
  assert.match(reconciliation, /FOR UPDATE|onConflictDoUpdate|seenKeys/);
});

test("compatibility and typing behavior have one exact owner", () => {
  const projects = read("src/app/actions/project/index.ts");
  const avatars = read("src/lib/services/avatar-service.ts");

  const catchStart = projects.indexOf('} catch (error) {', projects.indexOf("toggleProjectFollowAction"));
  const fallbackStart = projects.indexOf("if (shouldFollow)", catchStart);
  assert.ok(projects.indexOf('return { success: false, error: "Failed to update follow status" };', catchStart) < fallbackStart);
  assert.doesNotMatch(avatars, /uploadAvatarWithPreview|fileToDataUrl|export async function uploadAvatar\(/);
});

test("presence subscriptions stay in authorized messaging owners", () => {
  const avatar = read("src/components/ui/UserAvatar.tsx");
  const presenceClient = read("src/lib/realtime/presence-client.ts");

  assert.doesNotMatch(avatar, /useOnlineUsers/);
  assert.match(presenceClient, /entry\.roomType !== "user" \|\| entry\.roomId === userId/);
});

test("migrations are hand-written; ORM generation cannot emit native chat DDL (MIG-005)", () => {
  const packageJson = read("package.json");

  assert.doesNotMatch(packageJson, /"db:generate"/);
  assert.equal(existsSync(new URL("../../scripts/generate-db-migration.ts", import.meta.url)), false);
  assert.match(packageJson, /npm run check:db:runtime-role/);
});
