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
  const loading = source("src/components/network/NetworkRouteSkeleton.tsx");

  assert.match(hub, /import NetworkPeopleTab from "@\/components\/network\/NetworkPeopleTab"/);
  assert.match(hub, /const loadConnectionsClient = \(\) =>\s*import\("@\/components\/network\/ConnectionsClient"\)/);
  assert.match(hub, /const loadInvitationsClient = \(\) =>\s*import\("@\/components\/network\/InvitationsClient"\)/);
  assert.match(hub, /dynamic\(loadConnectionsClient/);
  assert.match(hub, /dynamic\(loadInvitationsClient/);
  assert.match(hub, /onMouseEnter=\{\(\) =>\s*preloadTab\(tab\.key\)\s*\}/);
  assert.match(hub, /pendingConnections \+ pendingInvites/);
  assert.match(invitations, /useInfiniteQuery\(/);
  assert.match(invitations, /readNetworkInvitationsAction\(/);
  assert.match(invitations, /getNextPageParam/);
  assert.doesNotMatch(invitations, /getIncomingApplicationsAction|getSentWorkspaceInvitationsAction/);
  assert.match(invitations, /resolveWorkspaceInvitationAction/);
  assert.match(loading, /aria-label="Loading network"/);
});

test("discover-only metadata is neither queried nor awaited by other tabs (PERF-008)", () => {
  const connections = source("src/app/actions/connections.ts");
  assert.match(connections, /const metadataPromise = tab !== 'discover' \? null : Promise\.all\(/);
  assert.equal(connections.match(/await metadataPromise/g)?.length, 1);
});
