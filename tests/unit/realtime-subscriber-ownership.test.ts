import assert from "node:assert/strict";
import { test } from "node:test";

import { subscribeActiveResource, subscribeWorkspaceStage } from "../../src/lib/realtime/subscriptions";

// A fake client that keeps channels by topic like supabase-js does.
function fakeClient() {
  const channels: Array<{ topic: string; removed: boolean }> = [];
  const client = {
    getChannels: () => channels.filter((c) => !c.removed),
    removeChannel: async (channel: { removed: boolean }) => { channel.removed = true; },
    channel: (name: string) => {
      const channel = { topic: `realtime:${name}`, removed: false, on() { return channel; }, subscribe() { return channel; } };
      channels.push(channel);
      return channel;
    },
  };
  return { client: client as never, channels };
}
const live = (channels: Array<{ topic: string; removed: boolean }>) => channels.filter((c) => !c.removed).map((c) => c.topic);

// API-018
test("co-mounted listeners on one resource keep separate channels", () => {
  const { client, channels } = fakeClient();
  subscribeWorkspaceStage({ supabase: client, projectId: "p1", onUpdate: () => undefined, subscriberId: "dashboard" });
  subscribeActiveResource({ supabase: client, resourceType: "project_hydration", resourceId: "p1", subscriberId: "hydration-banner", bindings: [] });
  assert.deepEqual(live(channels).sort(), ["realtime:active-resource:project_hydration:p1:dashboard", "realtime:active-resource:project_hydration:p1:hydration-banner"]);
});

test("the same owner resubscribing replaces only its own channel", () => {
  const { client, channels } = fakeClient();
  subscribeWorkspaceStage({ supabase: client, projectId: "p1", onUpdate: () => undefined, subscriberId: "dashboard" });
  subscribeActiveResource({ supabase: client, resourceType: "project_hydration", resourceId: "p1", subscriberId: "hydration-banner", bindings: [] });
  subscribeWorkspaceStage({ supabase: client, projectId: "p1", onUpdate: () => undefined, subscriberId: "dashboard" });
  assert.equal(live(channels).length, 2);
  assert.equal(channels.filter((c) => c.removed).length, 1);
});

test("both real co-mounted components pass distinct owner ids", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx", "utf8"), /subscribeWorkspaceStage\(\{[^}]*subscriberId: 'dashboard'/s);
  assert.match(readFileSync("src/components/workspaces/HydrationProgressBanner.tsx", "utf8"), /subscriberId: "hydration-banner"/);
});
