import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("Supabase Auth and database clients keep one native owner", () => {
  const browserClient = source("src/lib/supabase/client.ts");
  const database = source("src/lib/db/index.ts");

  assert.doesNotMatch(browserClient, /\block\s*:/, "browser Auth must use Supabase's native navigator lock");
  assert.doesNotMatch(database, /6544/, "read traffic must never invent an undocumented pooler port");
  assert.doesNotMatch(database, /READ_DATABASE_URL|readDb/, "one database client serves reads and writes");
  assert.match(database, /fetch_types: false/);
});

test("application wrappers do not compete with native Realtime reconnect", () => {
  const provider = source("src/components/providers/RealtimeProvider.tsx");
  const taskResource = source("src/lib/realtime/task-resource.ts");
  const projectFiles = source("src/lib/realtime/project-files-channel.ts");

  for (const implementation of [provider, taskResource, projectFiles]) {
    assert.doesNotMatch(implementation, /scheduleReconnect|reconnectTimer|reconnectAttempt|MAX_BACKOFF_MS|BACKOFF_START_MS/);
  }
  assert.match(provider, /void supabase\.removeChannel\(channel\)/);
  assert.match(taskResource, /native Realtime owns reconnects/);
  assert.match(projectFiles, /Supabase Realtime owns socket reconnect and channel rejoin/);
});

test("Realtime health distinguishes authentication startup from terminal channel failure", () => {
  const provider = source("src/components/providers/RealtimeProvider.tsx");
  const notifications = source("src/hooks/useNotifications.ts");
  const typing = source("src/hooks/usePresenceTyping.ts");
  const online = source("src/hooks/useOnlineUsers.ts");
  const publisher = source("src/hooks/usePublishOnlinePresence.ts");

  assert.match(provider, /'idle' \| 'connecting' \| 'connected' \| 'disconnected'/);
  assert.match(notifications, /notificationStatus !== 'disconnected'/);
  assert.match(provider, /notificationStatus === 'disconnected' \? 'unavailable' : 'reconnecting'/);
  for (const hook of [typing, online, publisher]) {
    assert.match(hook, /session\?\.access_token/);
    assert.match(hook, /realtimeReady/);
  }
});

test("hydration is Realtime-first with a bounded fallback", () => {
  const hydration = source("src/components/projects/HydrationProgressBanner.tsx");

  assert.match(hydration, /REALTIME_MISSED_PROGRESS_MS = 30_000/);
  assert.match(hydration, /FALLBACK_POLL_MS = 15_000/);
  assert.match(hydration, /status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT" \|\| status === "CLOSED"/);
  assert.doesNotMatch(hydration, /setTimeout\(fetchProgress, 5000\)/);
  assert.match(hydration, /if \(meta === undefined\) \{[\s\S]*queuePoll\(FALLBACK_POLL_MS\)/);
});

test("logout deletes the authenticated push record before local and Auth teardown", () => {
  const push = source("src/lib/notifications/web-push-client.ts");
  const auth = source("src/components/providers/AuthProvider.tsx");
  const sessionRoute = source("src/app/api/v1/auth/session/route.ts");
  const signOut = auth.slice(auth.indexOf("const signOut = useCallback"));

  assert.ok(push.indexOf("deletePushSubscriptionAction(endpoint)") < push.indexOf("sub.unsubscribe()"));
  assert.match(push, /return \{ ok: false, reason: "server_cleanup_failed" \}/);
  assert.ok(signOut.indexOf("await unsubscribeWebPush()") < signOut.indexOf("syncBrowserSessionToServer(null)"));
  assert.ok(signOut.indexOf("await unsubscribeWebPush()") < signOut.indexOf("supabase.auth.signOut({ scope: 'local' })"));
  assert.match(source("src/lib/auth/browser-auth-actions.ts"), /if \(session && token === lastSyncedSessionToken\) return/);
  assert.match(sessionRoute, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(sessionRoute, /expireBrowserSessionCookies\(response, cookieNames\)/);
  assert.doesNotMatch(sessionRoute, /jsonError\("Failed to clear browser session"/);
});

test("presence is app-wide and debounce markers follow persistence", () => {
  const runtime = source("src/components/providers/MainRuntimeProviders.tsx");
  const chat = source("src/components/providers/PresenceProvider.tsx");
  const heartbeat = source("src/app/api/v1/presence/heartbeat/route.ts");

  assert.match(runtime, /<LazyPresenceProvider presenceEnabled=\{true\} \/>/);
  assert.match(chat, /const presenceActive = active && presenceEnabled/);
  assert.match(chat, /document\.hidden \? pause\(\) : resume\(\)/);
  assert.match(chat, /IDLE_MS/);
  assert.match(chat, /presenceActive && engaged && !hidden \? <OnlinePresencePublisher/);
  assert.match(chat, /addEventListener\('pagehide'/);
  assert.match(heartbeat, /withDbRetry\("presence\.heartbeat\.last_active"/);
  assert.match(heartbeat, /lt\(profiles\.lastActiveAt/);
  // No debounce marker may gate the DB write. Redis holds only the short-lived
  // "Active now" key (presence:live:<id>) and the time zone (presence:tz:<id>);
  // neither ever skips a write. Closing a tab may delete the live key.
  assert.doesNotMatch(heartbeat, /localHeartbeatDebounce|heartbeat:debounce/);
  for (const redisUse of heartbeat.match(/getRedisClient\(\)\?\.\w+\([^)]*/g) ?? []) assert.match(redisUse, /\.set\(`presence:(live|tz):|\.del\(`presence:live:/);
});

test("extension workspace bounds root files per project", () => {
  const workspace = source("src/app/api/v1/extension/workspace/route.ts");

  assert.match(workspace, /CROSS JOIN LATERAL \(\s*SELECT id\s*FROM project_nodes\s*WHERE project_id = p\.id[\s\S]*?LIMIT 100\s*\) n/);
  assert.doesNotMatch(workspace, /\.limit\(Math\.max\(100, projectIds\.length \* 100\)\)/);
});
