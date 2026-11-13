import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(__dirname, "../..");

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("Ponytail memory (RAM) resource contracts", () => {
  it("disables eager route preloading, bounds in-memory cache to 0, and enables webpack memory optimizations in next.config.ts", () => {
    const src = readRepoFile("next.config.ts");

    assert.match(src, /cacheMaxMemorySize:\s*0\b/);
    assert.match(src, /enablePrerenderSourceMaps:\s*Boolean\(process\.env\.SENTRY_AUTH_TOKEN\)/);
    assert.match(src, /preloadEntriesOnStart:\s*false\b/);
    assert.match(src, /webpackBuildWorker:\s*true\b/);
    assert.match(src, /webpackMemoryOptimizations:\s*true\b/);
    assert.match(src, /imgOptConcurrency:\s*1\b/);
    assert.match(src, /imgOptOperationCache:\s*false\b/);
  });

  it("bounds V8 old-space heap, caps glibc malloc arenas at 2, omits git, prunes node_modules metadata, and boots via start-production.cjs in Dockerfile", () => {
    const dockerfile = readRepoFile("Dockerfile");
    const builderStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS builder"),
      dockerfile.indexOf("FROM base AS runner"),
    );
    const runnerStage = dockerfile.slice(dockerfile.indexOf("FROM base AS runner"));

    assert.match(builderStage, /NODE_OPTIONS=--max-old-space-size=4096\b/);
    assert.match(runnerStage, /MALLOC_ARENA_MAX=2\b/);
    assert.match(runnerStage, /NODE_OPTIONS="--max-old-space-size=384"/);
    assert.doesNotMatch(runnerStage, /\bgit\b/, "runner image must not install unused git CLI binary");
    assert.match(
      runnerStage,
      /COPY --from=builder --chown=nextjs:nodejs \/app\/scripts\/start-production\.cjs \.\/start-production\.cjs/,
    );
    assert.match(runnerStage, /find \.\/node_modules[\s\S]*?-delete/);
    assert.match(runnerStage, /CMD \["node", "start-production\.cjs"\]/);
  });

  it("fast-paths /api/v1/live and runs a lightweight non-Next HTTP server on networkbase-worker", async () => {
    const entrypoint = readRepoFile("scripts/start-production.cjs");
    assert.match(entrypoint, /pathname === "\/api\/v1\/live"/);
    assert.match(entrypoint, /isWorker && pathname !== "\/api\/inngest"/);
    assert.match(entrypoint, /serviceName !== "networkbase-web"/);
    assert.match(entrypoint, /createLightweightWorkerServer/);
    assert.match(entrypoint, /require\("\.\/server\.js"\)/);

    const liveRoute = readRepoFile("src/app/api/v1/live/route.ts");
    assert.match(liveRoute, /from "@\/app\/api\/v1\/_envelope"/);
    assert.doesNotMatch(
      liveRoute,
      /from "@\/app\/api\/v1\/_shared"/,
      "/api/v1/live must not import _shared (which pulls in Drizzle, Supabase, Redis, Sentry, and email outbox)",
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const startProd = require("../../scripts/start-production.cjs") as {
      resolveIsWorker: (env: Record<string, string | undefined>) => boolean;
      handleFastPathOrWorkerGuard: (
        req: { url?: string; method?: string },
        res: {
          writeHead: (status: number, headers: Record<string, unknown>) => void;
          end: (body?: string) => void;
        },
        isWorker: boolean,
      ) => boolean;
      createLightweightWorkerServer: (options?: { inngestRoutePath?: string }) => import("node:http").Server;
    };

    assert.equal(startProd.resolveIsWorker({ INNGEST_EXECUTION_ROLE: "worker" }), true);
    assert.equal(startProd.resolveIsWorker({ NB_SERVICE_ROLE: "worker" }), true);
    assert.equal(startProd.resolveIsWorker({ RAILWAY_SERVICE_NAME: "networkbase-worker" }), true);
    assert.equal(startProd.resolveIsWorker({ INNGEST_EXECUTION_ROLE: "web", RAILWAY_SERVICE_NAME: "networkbase-web" }), false);
    assert.equal(
      startProd.resolveIsWorker({ INNGEST_EXECUTION_ROLE: "worker", RAILWAY_SERVICE_NAME: "networkbase-web" }),
      false,
      "merging worker into networkbase-web must not block web routes",
    );

    let capturedStatus = 0;
    let capturedBody: string | undefined;
    const mockRes = {
      writeHead(status: number) {
        capturedStatus = status;
      },
      end(body?: string) {
        capturedBody = body;
      },
    };

    assert.equal(startProd.handleFastPathOrWorkerGuard({ url: "/api/v1/live", method: "GET" }, mockRes, false), true);
    assert.equal(capturedStatus, 200);
    assert.equal(capturedBody, JSON.stringify({ success: true, data: { status: "ok", probe: "liveness" } }));

    assert.equal(startProd.handleFastPathOrWorkerGuard({ url: "/discover", method: "GET" }, mockRes, true), true);
    assert.equal(capturedStatus, 404);

    for (const probeUrl of ["/.env", "/composer.json", "/wp-login.php", "/_next/static/chunks/app.js.map"]) {
      assert.equal(startProd.handleFastPathOrWorkerGuard({ url: probeUrl, method: "GET" }, mockRes, false), true, `${probeUrl} should be dropped at socket layer`);
      assert.equal(capturedStatus, 404);
      assert.equal(capturedBody, undefined);
    }

    assert.equal(startProd.handleFastPathOrWorkerGuard({ url: "/api/v1/openapi.json", method: "GET" }, mockRes, false), false);
    assert.equal(startProd.handleFastPathOrWorkerGuard({ url: "/api/inngest?fnId=test", method: "POST" }, mockRes, true), false);
    assert.equal(startProd.handleFastPathOrWorkerGuard({ url: "/discover", method: "GET" }, mockRes, false), false);
  });

  it("disables libvips 50 MB operation cache and caps sharp concurrency to 1 across all server image pipelines", () => {
    const sharpCallers = [
      "src/lib/profile/publish-profile-image.ts",
      "src/lib/upload/upload-intents.ts",
      "src/lib/workspaces/server/cover-image.ts",
      "src/lib/sharing/social-image.tsx",
      "src/app/actions/contribution-stories.ts",
    ];

    for (const relPath of sharpCallers) {
      const src = readRepoFile(relPath);
      assert.match(src, /sharp\.cache\(false\)/, `${relPath} must call sharp.cache(false)`);
      assert.match(src, /sharp\.concurrency\(1\)/, `${relPath} must call sharp.concurrency(1)`);
    }
  });

  it("bounds module-scope Map and Set caches across server modules", () => {
    const syncService = readRepoFile("src/lib/github/sync-service.ts");
    assert.match(syncService, /const GIT_BLOB_CACHE_MAX_ENTRIES = 1000;/);
    assert.match(syncService, /const GIT_BLOB_CACHE_TTL_MS = 30 \* 60 \* 1000;/);
    assert.match(syncService, /gitBlobCache\.size >= GIT_BLOB_CACHE_MAX_ENTRIES/);

    const legalAcceptance = readRepoFile("src/lib/legal/acceptance.ts");
    assert.match(legalAcceptance, /const LEGAL_ACCEPTANCE_CACHE_MAX_ENTRIES = 1000;/);

    const authResolver = readRepoFile("src/lib/github/auth-resolver.ts");
    assert.match(authResolver, /const MAX_INSTALLATION_CACHE_ENTRIES = 500;/);
    assert.match(authResolver, /setBoundedCacheEntry\(installationTokenCache/);
    assert.match(authResolver, /setBoundedCacheEntry\(installationIdByRepoCache/);

    const previewRoute = readRepoFile("src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route.ts");
    assert.match(previewRoute, /const MAX_SIGNED_URL_CACHE_SIZE = 500;/);

    const sendBucket = readRepoFile("src/lib/messaging/send-bucket.ts");
    assert.match(sendBucket, /maxKeys = 2_000/);

    const pushPolicy = readRepoFile("src/lib/messaging/push-policy.ts");
    assert.match(pushPolicy, /maxEntries = 1_000/);

    const completion = readRepoFile("src/lib/onboarding/completion.ts");
    assert.match(completion, /const COMPLETED_USERS_MAX = 1_000;/);

    const accountHealth = readRepoFile("src/lib/github/account-health.ts");
    assert.match(accountHealth, /const MAX_CACHE_ENTRIES = 500;/);

    const publish = readRepoFile("src/lib/messaging/publish.ts");
    assert.match(publish, /function runAfterResponse\(/);
  });

  it("restricts Railway watchPatterns so docs/, packages/nb-cli/, and tests/ commits do not trigger 4 GB rebuilds", () => {
    const railwayJson = JSON.parse(readRepoFile("railway.json")) as {
      build?: { watchPatterns?: string[] };
      deploy?: { healthcheckPath?: string };
    };
    const patterns = railwayJson.build?.watchPatterns ?? [];
    assert.ok(patterns.includes("src/**"));
    assert.ok(patterns.includes("Dockerfile"));
    assert.ok(patterns.includes("next.config.ts"));
    assert.ok(!patterns.some((p) => p.startsWith("docs") || p.startsWith("packages/nb-cli") || p.startsWith("tests")));
    assert.equal(railwayJson.deploy?.healthcheckPath, "/api/v1/live");

    const railwayTs = readRepoFile(".railway/railway.ts");
    assert.match(railwayTs, /watchPatterns:\s*PRODUCTION_WATCH_PATTERNS/);
  });
});
