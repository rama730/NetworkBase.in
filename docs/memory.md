# Memory (RAM) Architecture & Ponytail Resource Contracts

This document records the forensic findings from the Railway production memory audit (`1,061.99 minutely GB` at screenshot time / `1,335.58 minutely GB` at CLI pull across `networkbase-web` and `networkbase-worker`, representing `95.8%` of total cloud billing) and the Ponytail (`// ponytail:`) architectural controls that bound steady-state RSS and build/deploy memory spikes.

---

## 1. Root-Cause Breakdown (Before Remediation)

1. **`networkbase-worker` Running a Duplicate Full Next.js 16 Server (`40.0%` of RAM bill = `424.89 minutely GB`)**:
   - `networkbase-worker` booted the full standalone Next.js server (`194.9 MB` steady RSS; `p95 = 548.0 MB`; `max = 1,074.8 MB`) while averaging `0.0001 vCPU`, solely to serve `POST /api/inngest` and `GET /api/v1/live`.
2. **Next.js 16 `experimental.preloadEntriesOnStart: true` Default (`+41 MB` to `+75 MB` Permanent RSS per Container)**:
   - At second 0 on container boot, `NextNodeServer.unstable_preloadEntries()` eagerly `require()`d all **156 App Router routes** (46 UI pages + 110 API routes) into V8 Old Space before a single request arrived.
3. **Unfiltered Auto-Deploy Rebuild Spikes (`320.2 minutely GB` in 5 deploy hours = `24.0%` of Billing Period RAM)**:
   - Empty `watchPatterns` caused `docs/` and `packages/nb-cli/` commits (`57%` of deployments) to trigger dual 4 GB Webpack builds and container overlap spikes up to `1,241.6 MB` (`web`) and `1,074.8 MB` (`worker`).
   - Custom `webpack()` in `next.config.ts` silently disabled Next.js's isolated `webpackBuildWorker`.
4. **Uncapped V8 Heap on 8 GB Container (`limit_mb: 8192`), `cacheMaxMemorySize: 50 MB`, & glibc 64-Arena Retention**:
   - `Dockerfile` ran `CMD ["node", "server.js"]` without `NODE_OPTIONS`, causing Node.js 22 to default to a `4,096 MB` V8 heap ceiling on Railway's 8 GB container host and defer Major Mark-Sweep-Compact GC after traffic bursts (`371.5 MB` retained across hours of idle).
   - Unset `MALLOC_ARENA_MAX` on 8-vCPU Debian Bookworm allowed up to 64 glibc malloc arenas, compounded by unconfigured `sharp.cache(false)` / `sharp.concurrency(1)` (`libvips` 50 MB operation cache + 8 worker threads).
   - `src/app/api/v1/live/route.ts` imported from `@/app/api/v1/_shared`, pulling Drizzle ORM, Supabase, Redis, Sentry, and the email outbox into the liveness probe bundle.

---

## 2. Ponytail Memory Controls Implemented

| Surface | Control Implemented | Ponytail Ceiling & Upgrade Trigger |
| :--- | :--- | :--- |
| **Lazy Route Loading (`next.config.ts`)** | `experimental.preloadEntriesOnStart: false` loads route bundles on first visit instead of `require()`-ing all 156 routes at boot (`-41 MB` to `-75 MB` RSS). | **Ceiling**: `~5-15 ms` cold-require on first hit to an unvisited route after deploy.<br>**Upgrade**: Selectively warm top 3 routes post-boot if first-hit latency matters. |
| **Disable Next.js 50 MB Heap Cache (`next.config.ts`)** | `cacheMaxMemorySize: 0` disables Next.js's 50 MB in-memory LRU cache (`hot` data already uses bounded Ponytail Maps and Upstash Redis). | **Ceiling**: `0 MB` Next.js heap cache.<br>**Upgrade**: Custom Redis `cacheHandler` if ISR/fetch caching is introduced. |
| **Isolated Build Worker (`next.config.ts` & `Dockerfile`)** | `experimental.webpackBuildWorker: true`, `experimental.webpackMemoryOptimizations: true`, `enablePrerenderSourceMaps: Boolean(process.env.SENTRY_AUTH_TOKEN)`, and `NODE_OPTIONS=--max-old-space-size=4096` in builder stage. | **Ceiling**: Single build worker process inside 4 GB heap.<br>**Upgrade**: `parallelServerCompiles` if build time exceeds CI budget. |
| **V8 Heap, glibc Arena Bounds, & Runner Pruning (`Dockerfile`)** | Runner stage sets `MALLOC_ARENA_MAX=2` and `NODE_OPTIONS="--max-old-space-size=384"`, omits unused `git` package, and strips `.d.ts`, `.map`, and `.md` files from `node_modules`. | **Ceiling**: `384 MB` V8 old-space heap per replica.<br>**Upgrade**: Raise `--max-old-space-size` to `512` or scale horizontally if `p95` concurrent SSR exceeds `300 MB`. |
| **`libvips` / `sharp` Native Memory (`next.config.ts` & 5 callers)** | `imgOptConcurrency: 1`, `imgOptOperationCache: false` in `next.config.ts`, plus `sharp.cache(false)` and `sharp.concurrency(1)` in all 5 server-side `sharp` callers. | **Ceiling**: 1 concurrent `libvips` pipeline per replica with `0 MB` retained operation cache.<br>**Upgrade**: Dedicated image worker pool or CDN transform if concurrent image resizing queues. |
| **Standalone Worker HTTP Server & Socket Liveness (`scripts/start-production.cjs`, `live/route.ts`, `publish.ts`)** | On `networkbase-worker`, `start-production.cjs` boots a minimal `node:http` server (`createLightweightWorkerServer`) that serves `/api/v1/live` (`~36.3 MB` RSS at boot) and lazy-loads `/api/inngest/route.js` (`~96.5 MB` RSS) without ever booting `next-server.js`. On `networkbase-web`, `start-production.cjs` answers `/api/v1/live` at the socket layer. `live/route.ts` imports `jsonSuccess` from `_envelope`. | **Ceiling**: Serves `/api/v1/live` and `/api/inngest` on worker.<br>**Upgrade**: Merge `networkbase-worker` into `networkbase-web` (`INNGEST_EXECUTION_ROLE=worker` on web) and pause `networkbase-worker` to eliminate `100%` of the second container's RAM. |
| **In-Process LRU Bounds (`sync-service.ts`, `acceptance.ts`, `auth-resolver.ts`, `preview/route.ts`, `send-bucket.ts`, `push-policy.ts`, `completion.ts`, `account-health.ts`)** | `gitBlobCache` capped at `1,000` entries with a 30m TTL; `legalAcceptanceCache` at `1,000`; `installationTokenCache` & `installationIdByRepoCache` at `500`; `mediaSignedUrlCache` at `500`; `send-bucket` at `2,000`; `push-policy` at `1,000`; `completedUsers` at `1,000`; `healthCache` at `500`. | **Ceiling**: Bounded sub-megabyte in-process maps per replica.<br>**Upgrade**: Upstash Redis key-value cache if multi-replica fleet requires shared state. |
| **Deploy Watch Patterns (`railway.json` & `.railway/railway.ts`)** | Restricts Railway auto-deploys to `src/**`, `public/**`, `drizzle/**`, `scripts/**`, and root build configs so `docs/`, `packages/nb-cli/`, and `tests/` commits do not trigger dual 4 GB Docker builds. | **Ceiling**: Manual redeploy if an unlisted root dotfile changes.<br>**Upgrade**: Decouple CI image build from Railway deploy trigger. |
