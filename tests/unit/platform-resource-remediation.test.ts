import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { isPrivateRealtimeAuthorizationEnabled } from "../../src/lib/realtime/authorization";
import { projectActionsSource } from "./_workspace-actions-source";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Storage and private Realtime share the application key/topic contracts", () => {
  assert.match(read("drizzle/0003_storage.sql"), /VALUES \('project-updates-media', 'project-updates-media', 'f', 8388608/);
  const messaging = read("drizzle/0014_messaging.sql");
  assert.match(messaging, /CREATE POLICY application_topic_read ON realtime\.messages/);
  assert.match(messaging, /CREATE POLICY application_topic_send ON realtime\.messages/);
  assert.match(messaging, /app_private\.nb_can_observe_user_presence/);
  assert.match(messaging, /app_private\.nb_workspace_can_read/);
  assert.doesNotMatch(messaging, /presence:conversation/);
  // Presence follows shared DMs and group chats.
  assert.match(read("drizzle/0001_foundation.sql"), /nb_can_observe_user_presence[\s\S]*chat_channel_members viewer/);
});

test("private Realtime is fail-closed until database authorization is promoted", () => {
  const authorization = read("src/lib/realtime/authorization.ts");
  const presence = read("src/lib/realtime/presence-client.ts");
  const activation = read("drizzle/0014_messaging.sql");
  const exampleEnv = read(".env.local.example");

  assert.match(authorization, /NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED/);
  assert.match(presence, /if \(!isPrivateRealtimeAuthorizationEnabled\(\)\)/);
  assert.match(presence, /await supabase\.realtime\.setAuth\(accessToken\)/);
  assert.doesNotMatch(read("src/lib/realtime/subscriptions.ts"), /private:\s*true/);
  assert.match(activation, /CREATE POLICY application_topic_read ON realtime\.messages/);
  assert.match(activation, /extension = ANY \(ARRAY\['presence'::text, 'broadcast'::text\]\)/);
  assert.match(activation, /extension = 'broadcast'::text/);
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
  const retentionIndexes = ["0002_profiles_accounts", "0004_onboarding", "0017_browser_extension"].map((file) => read(`drizzle/${file}.sql`)).join("\n");
  const registry = read("src/inngest/registry.ts");

  assert.match(retention, /profileReadAuditDays: 30/);
  assert.match(retention, /profileActivityAuditDays: 365/);
  assert.match(retention, /FOR UPDATE SKIP LOCKED/g);
  assert.match(retention, /batchSize: 500/);
  assert.match(retentionIndexes, /ON public\.profile_audit_events USING btree \(created_at, id\)/);
  assert.match(retentionIndexes, /ON public\.onboarding_events USING btree \(created_at, id\)/);
  assert.match(retentionIndexes, /ON public\.extension_device_session_events USING btree \(created_at, id\)/);
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
  const reconciliation = read("src/inngest/functions/workspace-files-reconciliation.ts");
  assert.match(reconciliation, /buildWorkspaceFileKey/);
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
  const projects = projectActionsSource();
  const avatars = read("src/lib/services/avatar-service.ts");

  // The follow catch returns the failure; the pre-counter fallback is gone (followers_count is NOT NULL in every migrated database).
  const catchStart = projects.indexOf('} catch (error) {', projects.indexOf("toggleWorkspaceFollowAction"));
  assert.ok(projects.indexOf('return { success: false, error: "Couldn’t update follow status" };', catchStart) > catchStart);
  assert.doesNotMatch(projects.slice(catchStart, catchStart + 400), /fallback/i);
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
