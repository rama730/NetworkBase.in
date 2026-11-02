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

## Rules that keep it down

- Covers are 256 px WebP, re-encoded on the server, 300 KB at most. New image types shown small get the same treatment.
- A public image route sends a cacheable header to every viewer. Keep `max-age=300`: that is the revocation budget for visibility changes.
- A poll stops when the tab is hidden, and new polls need a reason realtime can't cover.
- Files in `/ide-icons`, `/skill-icons` and `/social-icons` are immutable for a year: replacing one means renaming it.

## Add when

| Cut | Trigger |
|---|---|
| Thumbnails for chat and update images | Media over 20 MB/day |
| Public avatar variants by default | `/_next/image` over 5 MB/day |
| Redirects for non-PDF previews | Previews over 50 MB/day |
| Session pooler with prepared statements | Database traffic is the top item |
| Moving a read from POST to GET | It is top 3 in `server_action` logs |
| Limit on `chat_bootstrap` | Users with over 200 channels |
| Trim Discover and workspace payloads | Average response over 20 KB (about 6 KB today) |
