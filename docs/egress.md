# Network egress

Railway charges $0.05/GB for what our services send out. The Usage chart is a running total for the billing period, so it only ever rises.

## Baseline, 2026-11-01 to 11-02 (before the cuts, 3 active users)

| Measure | Value |
|---|---|
| Web sent / received | 228 MB / 271 MB per day |
| Worker sent | about 33 MB/day |
| Sent to browsers | 143 MB/day, 9,208 requests |
| One 2 MB GIF cover | 96.4 MB/day, 67% of browser bytes |

Targets at the same usage: web under 80 MB/day, worker under 20 MB/day.

## How to measure

- **Railway:** service metrics `NETWORK_TX_GB` and `NETWORK_RX_GB` (each sample is one minute, so average × samples = total). `network-flow` logs with `@direction:egress` show destinations. Traffic from port 8080 is responses to users.
- **Cloudflare:** GraphQL `httpRequestsAdaptiveGroups`, `requestSource: "eyeball"`, grouped by `clientRequestPath`, ordered by `sum_edgeResponseBytes_DESC`. Up to one day per query.
- **Server actions:** they all POST to the current page, so the path says little. Railway deploy logs carry `{"event":"server_action","route":...,"action":...}`, and `.next/server/server-reference-manifest.json` maps an action id to its function.

## Follow-up audit, 2026-11-12 to 11-13 (2 active users)

| Measure | Value |
|---|---|
| Web egress (`14.84h` flow sample) | 38.92 MB (~62.95 MB/day): 80.6% port 8080 HTTP, 14.2% Supabase DB, 2.1% Upstash, 2.0% Sentry |
| Worker egress (`26.52h` flow sample) | 6.22 MB (~5.63 MB/day): 54.7% Supabase DB, 26.8% port 8080 `/api/inngest`, 14.0% Sentry |
| Non-PDF file previews (`7` requests) | 22.18 MB (56.9% of all web HTTP bytes; 9.4 MB PPTX streamed twice, 726 KB MOV streamed twice) |
| Vulnerability scanners & 404 probes | 11.00 MB across 1,456 bot requests (`4.54 MB` from 699 SSR 404s averaging 6.7 KB) |
| Sentry 60s `client_report` flush | 1.70 MB + 3,418 DNS queries across web and worker while idle |

## Rules that keep it down

- Covers are 256 px WebP, re-encoded on the server, 300 KB at most. New image types shown small get the same treatment.
- A public image route sends a cacheable header to every viewer. Keep `max-age=300`: that is the revocation budget for visibility changes. Conditional `If-None-Match` checks and `HEAD` metadata checks run before minting a storage signed URL.
- Non-PDF file previews (`GET /api/v1/workspaces/:id/files/:nodeId/preview`) redirect (`302`, `Cache-Control: private, no-store`) to short-lived signed storage URLs (`5m` default, `30m` audio/video) instead of proxying multi-megabyte presentations, images, and videos through Railway. Signed URLs are cached with a TTL-scaled safety margin (`20%` of TTL, capped at `5m`) so 5-minute preview URLs stay cacheable for 4 minutes without re-calling Supabase Storage. `getFilePreviewUrl` includes `?v=<currentVersion>` to avoid a `307` canonicalization redirect waterfall. PDF previews and `HEAD` checks stay inline without minting storage URLs on `HEAD`.
- `MediaViewerDriver` uses a static scrubber waveform bar pattern and `preload="metadata"` rather than issuing a second parallel 1 MB `Range` fetch on mount. `ImageViewerDriver` fetches SVG source text only when the user opens the `"code"` tab. `PresentationViewerDriver`, `DocxViewerDriver`, `SheetViewerDriver`, `ArchiveViewerDriver`, and `BinaryInspectorDriver` keep bounded in-memory LRU caches so tab switches and re-renders never re-download files.
- `scripts/start-production.cjs` (at the raw `node:http` socket layer) and `src/proxy.ts` drop dotfile (`/.env*`, `/.git*`), manifest (`/composer.json`, `/package.json`, `/swagger.json`), source-map (`*.map`), and scanner probes (`/wp-admin`, `/actuator`, `/graphql`, `.php`) with a 0-byte cached `404` before Next.js SSR.
- `src/lib/db/index.ts` connects persistent Railway web/worker containers to the Supavisor Session pooler (`:5432`, `max: 5` web / `3` worker) with `prepare: true` so parameterized queries skip per-call `Describe` and `pg_type` catalog round trips.
- Sentry disables 60-second `client_report` outcome flushes (`sendClientReports: false`) and unused OpenTelemetry/channel span hooks (`enableOpenTelemetrySetup: false`, `enableRuntimeChannelInjection: false`).
- A poll stops when the tab is hidden, live feed cards seed their reconcile timestamp on initial mount so freshly rendered cards do not immediately re-fetch their own counts/bodies, and new polls need a reason realtime can't cover.
- Files in `/ide-icons`, `/skill-icons` and `/social-icons` are immutable for a year: replacing one means renaming it.

## Add when

| Cut | Trigger |
|---|---|
| Thumbnails for chat and update images | Media over 20 MB/day |
| Public avatar variants by default | `/_next/image` over 5 MB/day |
| Cloudflare WAF edge rule for scanner paths | Proxy 404 responses over 5,000/day |
| Moving a read from POST to GET | It is top 3 in `server_action` logs |
| Limit on `chat_bootstrap` | Users with over 200 channels |
| Trim Discover and workspace payloads | Average response over 20 KB (about 6 KB today) |
