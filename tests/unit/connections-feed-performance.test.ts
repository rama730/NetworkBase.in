import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("connections feed shares auth, overlaps reads, and keeps privacy auditing off the response path", () => {
  const action = source("src/app/actions/connections.ts");
  const feedImpl = action.slice(
    action.indexOf("async function getConnectionsFeedImpl"),
    action.indexOf("export async function getConnectionsFeed(input"),
  );

  assert.doesNotMatch(feedImpl, /const user = await getAuthUser\(\)/);
  assert.match(feedImpl, /const statsPromise: Promise<ConnectionsFeedStats>/);
  assert.match(feedImpl, /after\(async \(\) =>/);
  assert.match(feedImpl, /logger\.metric\('connections\.feed'/);
  assert.match(action, /runInFlightDeduped\(dedupeKey, \(\) => getConnectionsFeedImpl\(input, user\)\)/);
});

test("People lazily loads inactive tabs and has a route-level loading shell", () => {
  const hub = source("src/components/network/NetworkClient.tsx");
  const invitations = source("src/components/network/InvitationsClient.tsx");
  const loading = source("src/app/(site)/(main)/network/loading.tsx");

  assert.match(hub, /const loadPeopleClient = \(\) => import\("@\/components\/people\/NetworkPeopleTab"\)/);
  assert.match(hub, /const loadConnectionsClient = \(\) => import\("@\/components\/people\/ConnectionsClient"\)/);
  assert.match(hub, /const loadInvitationsClient = \(\) => import\("@\/components\/people\/InvitationsClient"\)/);
  assert.match(hub, /dynamic\(loadPeopleClient/);
  assert.match(hub, /dynamic\(loadConnectionsClient/);
  assert.match(hub, /dynamic\(loadInvitationsClient/);
  assert.match(hub, /onMouseEnter=\{\(\) => preloadTab\(tab\.key\)\}/);
  assert.doesNotMatch(hub, /import NetworkPeopleTab from/);
  assert.match(hub, /pendingConnections \+ pendingInvites/);
  assert.match(invitations, /getIncomingApplicationsAction\(\{ limit: 50 \}\)/);
  assert.match(invitations, /invitation\.isWorkflowItem/);
  assert.match(invitations, /resolveMessageWorkflowActionV2/);
  assert.match(loading, /aria-label="Loading connections"/);
});
