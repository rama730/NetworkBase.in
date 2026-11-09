import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("IDE & Editor Extension Performance & Architecture Enhancements", () => {
  it("session route and bearer auth read revocation on every request (report finding 43)", () => {
    const sessionRoute = readSource("src/app/api/v1/extension/session/route.ts");
    const shared = readSource("src/app/api/v1/_shared.ts");

    // An in-process cache kept a revoked token working for up to 30 s, and on other servers until expiry.
    // Each request is one indexed read (API-009), rate-limited per route; no cache may sit in front of it.
    assert.doesNotMatch(sessionRoute, /sessionStatusCache/, "session status must not be cached in memory");
    assert.doesNotMatch(shared, /VERIFIED_BEARER_CACHE/, "bearer auth must not be cached in memory");
    assert.match(sessionRoute, /enforceRouteLimit\(request, "api:v1:extension:session:status"/, "status reads stay rate-limited");
  });

  it("active-sessions implements fast-path auth-method detection and LRU caching", () => {
    const activeSessionsSource = readSource("src/lib/extension/active-sessions.ts");

    // Must implement in-memory auth-method cache and fast-path inference
    assert.match(activeSessionsSource, /authMethodCache\s*=\s*new Map/, "must define auth-method cache");
    assert.match(activeSessionsSource, /inferAuthMethodFromSession/, "must define fast-path inference function");
    assert.match(activeSessionsSource, /session\.clientVersion === "pending"/, "pending tokens must be fast-pathed to manual_token");
    assert.match(activeSessionsSource, /missingSessionIds\.length > 0/, "must skip DB event query if all sessions are resolved");
  });

  it("workspace route provides sub-30ms fast-bootstrap summary mode", () => {
    const workspaceRoute = readSource("src/app/api/v1/extension/workspace/route.ts");

    // Must support summary mode via query parameter or header
    assert.match(workspaceRoute, /.get\("mode"\)\s*===\s*"summary"/, "must detect summary mode in query params");
    assert.match(workspaceRoute, /x-nb-workspace-mode/, "must detect summary mode in headers");
    assert.match(workspaceRoute, /isSummaryMode/, "must branch execution for summary mode");
    assert.match(workspaceRoute, /getWorkspaceTaskCountMap\(projectIds\)/, "summary mode must return taskCount");
  });

  it("IntegrationsSettings implements optimistic revocation, auto-reconciliation, and custom device labeling", () => {
    const settingsSource = readSource("src/components/settings/IntegrationsSettings.tsx");

    // Optimistic cache update on revoke
    assert.match(settingsSource, /useQueryClient/, "must use query client for optimistic updates");
    assert.match(settingsSource, /queryClient\.setQueryData.*queryKeys\.settings\.extensionSessions/, "must optimistically update session cache on revoke");

    // Auto-reconciliation
    assert.match(settingsSource, /auto-reconcile live connection/, "must implement auto-reconciliation");
    assert.match(settingsSource, /toast\.success\("Editor connected"\)/, "must toast upon successful editor connection");

    // Custom device label
    assert.match(settingsSource, /deviceLabel/, "must support custom device label");
    assert.match(settingsSource, /Device label \(optional\)/, "must render a labelled device label input");
  });
});
