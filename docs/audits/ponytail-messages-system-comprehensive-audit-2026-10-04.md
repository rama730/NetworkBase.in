# Comprehensive Message System Architectural Audit & 1M-Scale Ponytail Report

**Audit Date:** 2026-10-04  
**Workspace:** `/Users/chrama/Downloads/nb-s3`  
**Standard:** Pure Optimization, Zero Bloat, Native/Stdlib Priority, Sub-50ms Latency for 1,000,000 Concurrent Active Users  
**Methodology:** Ponytail Engineering Framework (`delete:`, `stdlib:`, `native:`, `shrink:`, `yagni:`)  
**Status:** Verified against the code and resolved on 2026-10-04 — see **§0 Verified Status** (supersedes the original claims below where they differ)  


---

## 0. Verified Status (2026-10-04)

Every entry below was checked against the code; the original text after this section is kept for history.

**Corrections to the report itself**
- The register lists **42** issues, not 43.
- The scorecard figures (380 ms → 4,800 ms, 40–100 MB per channel, etc.) were **not measured**; they are projections and should not be quoted as baselines.
- Chat storage uses **Supabase Storage signed URLs** (plus an independent AWS backup bucket), not presigned S3 PUTs. Fixes that depend on `x-amz-checksum-*`, S3 multipart presigning or prefix sharding don't apply as written.

**Outcome:** 23 fixed · 15 rejected (not real or by design) · 4 kept as documented ceilings · 1 deferred with a ledger entry (S3-07). (Some rows combine: ACT-06 is resolved by the ACT-05 cap.)

| ID | Verified finding | Adequate fix? | Resolution |
|---|---|---|---|
| S3-01 | Partly real: the object is streamed and hashed with constant memory (chat doesn't decode images); cost is one storage egress per upload, not an OOM | No, client checksums + HeadObject aren't available for Supabase signed uploads, and the full streamed SHA-256 is a deliberate integrity rule | **Kept**, `ponytail:` ledger in `upload-intents.ts` (upgrade: ranged magic-byte read + provider checksums if egress shows up) |
| S3-02 | **Real, critical**: canvas images were eligible for deletion one hour after upload | Yes | **Fixed**: `hasNoLiveReference()` checks `chat_canvases.asset_ids @> ARRAY[id]` (GIN) |
| S3-03 | Not real at this scale; S3 auto-partitions prefixes; content-addressed dedupe leaks file existence | No | **Rejected** |
| S3-04 | **Real**: signed TUS uploads (> 6 MB) were sent to `/upload/resumable`; signed uploads need `/upload/resumable/sign` | No, multipart rewrite is unnecessary | **Fixed**: one-line endpoint path (all features using the client) |
| S3-05 | By design: app credentials can't delete backups; a 30-day retention policy expires them | No, app-side deletes weaken ransomware protection | **Rejected**; ops check: confirm the backup lifecycle rule |
| S3-06 | **Real**: 5-minute signed URLs break seeking in long video/audio | Partly | **Fixed**: 2-hour links for `video/*` and `audio/*` only (`attachment-ttl.ts`) |
| S3-07 | Overstated: uploads are already compressed to ≤ 1920 px and ≤ 5 MB (≈ 6–10 MB for 20 photos) | Premature (no image transforms on the current plan) | **Deferred**, ledger in `MessageRow.tsx` |
| S3-08 | Not real: the quota row lock spans one short transaction | No | **Rejected** |
| LOAD-01 | Not real: 4 indexed PK-prefix probes per row with runtime partition pruning | No | **Rejected** |
| LOAD-02 | Minor (deep links only) | Not worth it | **Rejected** |
| LOAD-03 | Real, small | Yes | **Fixed**: invite/application counts only on full loads; delta polls keep the previous counts |
| LOAD-04 | Real | **No**: cursor reads never set `read_at`, so a `read_at IS NULL` index would match almost everything | **Fixed (0189)**: `chat_mark_read`/`chat_mark_thread_read` stamp `read_at`; backfill; partial index `chat_mentions_unread_idx`; the count reads only truly unread rows |
| LOAD-05 | Not real: the subquery is served by `role_applications_accepted_member_idx` | No | **Rejected** |
| LOAD-06 | Partly real (documented ceiling L-39) | No, a 60-day window hides history | **Fixed**: 3 s `statement_timeout` + "narrow your search" error |
| UPL-01 | Overstated: compression already uses `createImageBitmap` + `OffscreenCanvas` | No, a worker pool is overkill | **Fixed**: at most 2 compressions at once (`upload.ts`) |
| UPL-02 | Real | Overbuilt | **Fixed**: no state update unless the rounded percent changes |
| UPL-03 | Real | Yes | **Fixed**: AbortController per upload (remove, channel switch, unmount) |
| UPL-04 | Not real: the deletion job already reaps unreferenced chat uploads after one hour | No | **Rejected** |
| REND-01 | Real | Yes | **Fixed**: memoized `useSavedSeqs` return |
| REND-02 | Real | Yes | **Fixed**: rows invalidate only the bootstrap query |
| REND-03 | Already fixed: draft events fire only on empty ↔ non-empty | n/a | **Rejected** |
| REND-04 | Not a bug: React's documented "adjust state while rendering" pattern | No (a ref breaks the refs rule) | **Rejected** |
| REND-05 | Not real: media reserves its aspect ratio | n/a | **Rejected** |
| VIRT-01 | Real | Yes | **Fixed**: module-level Header/Footer via Virtuoso `context` (Timeline, ThreadPane) |
| STATE-01 | Not real: the cache is 50 messages, debounced 1 s | n/a | **Rejected** |
| PROX-01 | By design: auth per open, bytes never through the server, redirect cached 4 min | No | **Rejected** |
| PROX-02 | Not real: `src/proxy.ts` signs the CSRF cookie only when missing | n/a | **Rejected** |
| PROX-03 | Not real: supabase-js 2.90 refreshes Realtime auth on token refresh (singleton client) | n/a | **Rejected** |
| REAL-01 | Real, small | Yes | **Fixed**: no typing topic where typing is off |
| REAL-02 | Not real: far below Realtime join limits; 1.5 s grace already absorbs switching | No | **Rejected** |
| REAL-03 | Real | Yes | **Fixed**: member/channel events no longer refetch message pages |
| ITEM-01 | Documented ceiling L-17 | Not needed now | **Kept** (ledger) |
| ITEM-02 | Documented ponytail in `maintenance.ts` | Not needed now | **Kept** (ledger) |
| ITEM-03 | Real | Yes | **Fixed**: `evictCachedTimelines()` snapshots keys first (unit-tested) |
| ITEM-04 | Documented ceiling L-3 | Not needed now | **Kept** (ledger) |
| ACT-01 | Real | Yes | **Fixed**: one `jsonb_to_recordset` UPDATE |
| ACT-02 | Real | Overbuilt (rewriting `chat_send_message`) | **Fixed**: channel name fetched in the author query that already runs in parallel with the send |
| ACT-03 | Real, small | Yes | **Fixed**: `publishUsers()` one REST batch |
| ACT-04 | Real (plus: Home's "Mark all read" only marked the 8 visible rows) | Yes | **Fixed**: `markReadMany()` one roundtrip, one broadcast batch; Home marks every unread conversation |
| ACT-05 | Real | Yes | **Fixed**: push fan-out in chunks of 10 |
| ACT-06 | Real | Partly | **Resolved by the ACT-05 cap** (≤ 10 concurrent indexed lookups); ledger in `publish.ts` |
| MUT-01 | Real | Yes | **Fixed (0189)**: `chat_edit_message(..., p_mentions)` adds/removes @person mentions, adjusts unread mention counts, hints newly mentioned people (no push, like Slack) |

**Bug found while verifying:** Postgres arrays come back from `db.execute` as text, so the edit's newly-mentioned list is returned as `jsonb` (caught by the new action check).

**Verification:** `tsc`, eslint, 2,055 unit tests (new `chat-audit-fixes.test.ts`), `check:chat:db` (77), `check:chat:actions` (48: read-stamping, edit mention sync, bulk mark-read, canvas asset guard), production build, `check:db-catalog-drift`; migration 0189 applied.

---

## 1. Executive Summary & 1M-Scale Performance Scorecard

The NetworkBase messaging subsystem has recently transitioned to a channel-first, Slack-style architecture governed by migrations `0180` through `0188`, backed by 32 hash partitions, gap-free channel sequences, and private Supabase broadcast channels.

Following our exhaustive second-pass multi-angle audit—with specific focus on **alignment with our architecturally optimized S3 bucket and object storage pipelines**, Realtime WebSocket multiplexing, media lifecycle synchronization, and client-state virtualization—we have cataloged a total of **43 critical architectural bottlenecks, memory leaks, re-render cascades, S3 synchronization leaks, and concurrency hotspots** that will cause system degradation and connection exhaustion under 1,000,000 active users (100,000 concurrent peak users / 130,000 browser connections).

### Performance & Scalability Baseline vs. Production Target (unmeasured projections — see §0)

| Performance & Operational Metric | Current Observed Baseline | Projected Under 1M Active Users | Production Target (1M Users) | Ponytail Architectural Strategy |
|---|---|---|---|---|
| **Initial Channel Mount Latency** | 380 ms | 4,800 ms (Timeout / 504) | **< 45 ms** | Eliminating 200 correlated subqueries per page via set-based CTE hydration. |
| **Channel Switch Transition** | 120 ms | 1,800 ms (Lag & Thrash) | **< 5 ms** | Bounded 50-message cache slice, snapshot eviction, and pre-warmed memory cache. |
| **Keystroke INP During Typing** | 48 ms | 280 ms (Unresponsive) | **< 8 ms (120 FPS)** | Eliminate 300ms global draft storage events; decouple sidebar from composer. |
| **Media Upload Throughput** | 2.1 MB/s (Main-thread lock)| Tab Crash / OOM on Mobile | **25 MB/s (Direct S3)** | Bounded 2-worker compression pool; unmanaged CSS progress updates. |
| **Upload Finalize Server RAM Spike**| Up to 50 MB / upload | Severe Serverless OOM | **< 200 KB (Zero-Stream)** | Native S3 `x-amz-checksum-sha256`; serverless calls `HeadObject` without streaming. |
| **Image Download Roundtrips** | 2 HTTP requests per asset | Connection exhaustion | **1 HTTP request (Direct CDN)**| Pre-signed CDN asset tokens; elimination of Next.js 302 redirect route. |
| **Timeline Media Bandwidth** | 40–100 MB per channel | Network congestion | **< 1.5 MB (98% reduction)** | 400px WebP thumbnail derivatives (`assets/${id}/thumb.webp`) in feed. |
| **Database Pool Utilization** | 45% (10 conn max) | 100% (Instant Starvation) | **< 25% at 1M users** | Single-query batch actions; elimination of redundant round trips in `sendAs`. |
| **Background Delta Poll DB Load** | 12 ms / query | Severe lock contention | **< 1.5 ms** | Eliminate unrelated invite/application scans on delta ticks; partial index on mentions. |
| **Realtime Topic Connections** | 2 topics per user (200k) | Cluster memory saturation | **1 multiplexed topic (100k)**| Merge typing indicator broadcasts into channel topic; filter large rooms. |
| **Timeline Re-render Frequency** | 15-20 renders / minute | Continuous 60 FPS churn | **0 idle re-renders** | Decouple `useChatShell` from `MessageRow`; memoize `useSavedSeqs` return. |
| **Realtime Web Push Dispatch** | Inline `Promise.all` (N+1)| Serverless socket timeout | **Decoupled chunked queue**| Chunked push dispatch capped at 10 concurrent requests; single batch query. |

---

## 2. Assessment of Current Status from Every Angle

### 2.1 Architectural Assessment: S3 Bucket & Object Storage Integration
The application’s central S3 object store is architecturally optimized with native AWS SigV4 signed operations (`src/lib/storage/s3-backup-client.ts`), strict content hashes, and structured lifecycle states. However, the connection between the messaging system and this S3 architecture is fundamentally misaligned:
1. **The Triple-Hop Proxy Trap:** Chat attachments currently traverse `Client → Next.js Route → Supabase Storage Gateway → AWS S3 Signed URL → 302 Redirect → Browser`. Every image view pays for 2 HTTP network calls and an authenticated database query.
2. **Synchronous Serverless Memory Ingestion:** During upload finalization (`PUT /presign`), the Next.js server streams up to 50MB of file bytes from S3 into its Node.js memory buffer solely to compute SHA-256 and verify magic bytes, risking serverless OOMs.
3. **Orphaned Canvas Assets:** Background S3 asset deletion (`hasNoLiveReference()`) checks messages, profiles, and projects, but completely omits Channel Canvases (`chat_canvases.asset_ids`), causing canvas images to be permanently deleted after 1 hour.
4. **S3 Backup Tombstone Deletion Leak:** When message attachments are deleted, `asset-deletion.ts` purges the primary bucket but fails to delete the backup copy in S3, permanently leaking storage and violating privacy invariants.
5. **Missing Thumbnail Pipeline:** Chat feeds load full-resolution 1920x1920 images directly in the timeline, wasting up to 100MB of bandwidth per conversation view instead of serving lightweight 15KB thumbnails.

### 2.2 Realtime WebSocket Multiplexing & Connection Lifecycle
- **Topic Duplication:** Every conversation joins two separate WebSocket topics: `chat:channel:<id>` and `chat:typing:<id>`, doubling Phoenix channel connection overhead on the Supabase cluster to 200,000 concurrent topics.
- **Large-Room Typing Storms:** Rooms with > 50 members still join `chat:typing:<id>` WebSocket subscriptions, receiving unnecessary typing broadcasts.
- **Over-Invalidation Cascades:** Broad metadata events (`channel.updated`, `member.changed`) trigger full invalidation of the message query, refetching 500 loaded messages across all pages.

### 2.3 Virtualization, Rendering & DOM Performance
- **React-Virtuoso Component Remounting:** Inline component function literals in `Timeline.tsx` (`Header: () => ...`) cause Virtuoso to unmount and remount header and footer DOM wrappers on every render pass.
- **Context Invalidation Cascades:** `useSavedSeqs` creates a new object reference on every render, invalidating `ConversationContext` and forcing all 50–100 mounted `MessageRow` components to re-render constantly.
- **Unbounded Client-Side Timeline Cache:** Serializing up to 500 messages into `sessionStorage` via `JSON.stringify` on every incoming message blocks the main thread for 15–25ms.

---

## 3. Comprehensive Issue Catalog (43 Issues Identified)

### Category A: S3 Bucket Architecture & Object Storage Alignment

#### Issue S3-01: Synchronous 50MB Serverless Stream & Memory Spikes in Upload Finalize
- **Location:** `src/lib/upload/upload-intents.ts:786-794` & `src/app/api/v1/chat/attachments/presign/route.ts:110-117`
- **Root Cause:** When the client calls `PUT /api/v1/chat/attachments/presign`, `finalizeUploadIntent` invokes `verifyStoredObjectBytes`, which downloads the full file (up to 50MB) over HTTP from S3 into the serverless Node.js memory buffer to compute `createHash("sha256")`.
- **Scale Failure Mode (1M Users):** 20 concurrent uploads download 1GB into serverless container memory, blowing memory limits (1024MB default), causing OOM crashes, high S3 egress costs, and 504 Gateway Timeouts.
- **Ponytail Solution:** `native: S3 Native Checksums & Zero-Stream Finalization`.
  Leverage AWS S3 native checksum validation (`x-amz-checksum-sha256` or `x-amz-checksum-crc32c`). The client computes SHA-256 via Web Crypto API in the browser and supplies `x-amz-checksum-sha256` during presigned PUT. S3 validates the checksum during ingress. On finalize, the Next.js API executes `HeadObject` on S3 (or Supabase `info`), verifying size and checksum in < 5ms without transferring any bytes.

---

#### Issue S3-02: Missing Channel Canvas Reference Guard in S3 Asset Deletion
- **Location:** `src/lib/storage/asset-deletion.ts:28-85`
- **Root Cause:** In `hasNoLiveReference()`, the query verifies that no live references exist in `profiles`, `projects`, `projectNodes`, `fileVersions`, `chatAttachments`, and `projectUpdateMediaAssets`. However, it **does NOT check `chat_canvases` (`chat_canvases.asset_ids`)**!
- **Scale Failure Mode (1M Users):** When users insert images onto a Channel Canvas (migration `0182`), those images are referenced only in `chat_canvases.asset_ids`. After 1 hour (draft expiry), `deleteEligibleStorageAssets` considers the canvas images orphaned, marks them `delete_pending`, and permanently deletes them from S3, breaking all images on the canvas.
- **Ponytail Solution:** `shrink: Include chat_canvases reference check`.
  Add `NOT EXISTS (SELECT 1 FROM chat_canvases WHERE asset_ids @> ARRAY[storage_assets.id])` to `hasNoLiveReference()` in `asset-deletion.ts`.

---

#### Issue S3-03: S3 Key Hot-Prefix Contention & Missing CAS Deduplication
- **Location:** `src/app/api/v1/chat/attachments/presign/route.ts:61`
- **Root Cause:** Chat keys are structured as `${channelId}/${user.id}/${clientUploadId}.${extension}`. All uploads and views in an active channel hit the same prefix `${channelId}/...`. Furthermore, identical files uploaded across channels are uploaded repeatedly.
- **Scale Failure Mode (1M Users):** S3 partitions throughput by prefix (3,500 PUTs/sec per prefix). High-velocity channels bottleneck on a single S3 prefix. Additionally, duplicate uploads waste gigabytes of storage and multiply S3 backup and bandwidth costs.
- **Ponytail Solution:** `native: CAS Prefix Sharding & Client Deduplication`.
  Adopt a hash-sharded Content-Addressable Storage (CAS) key format:
  `chat/${contentHash.slice(0, 2)}/${contentHash.slice(2, 4)}/${contentHash}.${extension}`.
  This distributes S3 I/O uniformly across 65,536 prefixes, and enables instant zero-byte deduplication in `presign`: if `contentHash` is already present and verified in `storage_assets`, return the existing `assetId` immediately with 0ms upload time.

---

#### Issue S3-04: TUS Resumable Upload Authorization Rejection for Files > 6MB
- **Location:** `src/lib/upload/supabase-signed-upload-client.ts:344-347` & `src/app/api/v1/chat/attachments/presign/route.ts:74`
- **Root Cause:** For files > 6MB, `uploadToSupabaseSignedUrl` delegates to `uploadResumable` (TUS) at `/storage/v1/upload/resumable`. But `presign/route.ts` creates standard upload signed URLs via `createSignedUploadUrl`, whose tokens are invalid on the TUS resumable endpoint (which requires Supabase JWT Auth).
- **Scale Failure Mode (1M Users):** Any chat attachment larger than 6MB (e.g. 10MB PDF, 25MB video) fails with 401/403 or signature invalid errors when routed through TUS.
- **Ponytail Solution:** `native: S3 Multipart Upload Alignment`.
  For files > 6MB, align with S3 Multipart Upload architecture or use direct multipart presigned URLs (5MB chunks), avoiding incompatible TUS endpoints.

---

#### Issue S3-05: S3 Backup Deletion Leak (Orphaned Backup Objects)
- **Location:** `src/lib/storage/asset-deletion.ts:241-247` & `src/lib/storage/s3-backup-client.ts`
- **Root Cause:** When `deleteEligibleStorageAssets` deletes an asset from the primary bucket via `admin.storage.from(bucket).remove(...)`, it NEVER removes the object from the S3 backup bucket (`s3-backup-client.ts` does not implement `deleteS3Backup`).
- **Scale Failure Mode (1M Users):** Hundreds of thousands of deleted message attachments remain permanently in the S3 backup bucket (`assets/${assetId}/...`), permanently increasing S3 storage costs and violating GDPR/privacy compliance.
- **Ponytail Solution:** `stdlib: S3 Backup Deletion Hook`.
  Implement `deleteS3Backup` using SigV4 DELETE in `s3-backup-client.ts` and invoke it during asset deletion finalization.

---

#### Issue S3-06: Video/Audio Range Request Incompatibility and 5-Minute Stream Cutoff
- **Location:** `src/app/api/v1/chat/attachments/[assetId]/route.ts:9,45-51`
- **Root Cause:** Returns a `302 Found` redirect to a presigned URL with `SIGNED_URL_SECONDS = 300` (5 minutes). When media players stream video/audio, they send HTTP `Range` requests.
- **Scale Failure Mode (1M Users):** Pausing or playing a video longer than 5 minutes causes subsequent range requests (scrubbing/seeking) to fail with HTTP 403 Forbidden because the signed URL signature expired.
- **Ponytail Solution:** `native: Streaming Proxy with Range Support or CloudFront Signed Cookies`.
  Support `Range: bytes=` with HTTP `206 Partial Content` directly, or issue 2-hour signed cookies for media streams.

---

#### Issue S3-07: Full-Resolution Image Downloads in Timeline (Missing Thumbnail Derivatives)
- **Location:** `src/components/messages/MessageRow.tsx:41-45` & `src/components/messages/parts/message-attachments.tsx`
- **Root Cause:** `toViewerAttachment` sets `thumbnailUrl: null`. Every message row embeds the full-resolution image URL (`/api/v1/chat/attachments/${attachment.asset_id}`).
- **Scale Failure Mode (1M Users):** Viewing a channel with 20 photos downloads 40–100MB of full 1920x1920 images just to render 200px inline feed cards, causing network congestion, mobile data exhaustion, and slow rendering.
- **Ponytail Solution:** `shrink: 400px WebP Thumbnails`.
  Generate a lightweight 400px WebP thumbnail during upload verification (`assets/${assetId}/thumb.webp`). Serve the 15KB thumbnail in the timeline and load the full-res asset only in `MediaViewerModal`.

---

#### Issue S3-08: Exclusive Row Lock on User Quota Contention During Concurrent Uploads
- **Location:** `src/lib/upload/upload-intents.ts:815-822`
- **Root Cause:** `finalizeUploadIntent` acquires `SELECT ... FROM storage_quota_scopes WHERE scopeType = 'user' AND scopeId = intent.userId FOR UPDATE`.
- **Scale Failure Mode (1M Users):** When a user attaches 5 files at once, all 5 `PUT /presign` requests finalize in parallel and contend for the exact same user row lock, serializing uploads and triggering transaction timeouts.
- **Ponytail Solution:** `shrink: Batch Finalize Single Lock`.
  Finalize all attachments in a single batch call (`PUT /api/v1/chat/attachments/presign/batch`), locking the quota row once for the entire batch.

---

### Category B: Loads, Fetching, Bootstrapping & Caching

#### Issue LOAD-01: 200 Correlated Subqueries per Page in `selectMessages`
- **Location:** `src/lib/messaging/queries.ts:13-53`
- **Root Cause:** For every row selected from `chat_messages` (50 rows per page), `selectMessages` executes 4 scalar subqueries in the `SELECT` projection (nested `GROUP BY` reactions, attachments, cards, pins).
- **Scale Failure Mode (1M Users):** 50 rows × 4 subqueries = 200 correlated subqueries per page fetch. Under 1,100 reads/sec, PostgreSQL executes >220,000 subqueries/second, causing CPU saturation and connection starvation.
- **Ponytail Solution:** `shrink: Single-pass CTE batch hydration`.
  Structure the query using a single CTE that selects the 50 message rows first, and then executes four set-based `LEFT JOIN` aggregations against the 50 selected message sequence IDs.

---

#### Issue LOAD-02: Double Query Execution on Deep-Link Around-Queries
- **Location:** `src/lib/messaging/queries.ts:58-65`
- **Root Cause:** When a deep link includes `?m=<seq>`, `listTopLevel` executes two independent queries in parallel: `Promise.all([selectMessages(..., older), selectMessages(..., newer)])`.
- **Scale Failure Mode (1M Users):** Each deep link claims 2 database connections simultaneously from a pool capped at 10 connections in production, halving concurrent capacity.
- **Ponytail Solution:** `native: Single SQL window query`.
  Execute a single query with a `UNION ALL` or `ORDER BY abs(channel_seq - ${around})` inside a single CTE to retrieve both halves in one roundtrip using a single connection.

---

#### Issue LOAD-03: Background Delta Poll Scans Unrelated Project Invites & Applications
- **Location:** `src/app/actions/chat/read.ts:19-28`
- **Root Cause:** The 90s client delta poll calls `bootstrap({ since })`, which executes subqueries over `project_invitations` and `role_applications`.
- **Scale Failure Mode (1M Users):** 100,000 active users generate ~1,100 delta polls per second, triggering 2,200 table scans/sec across unrelated tables that do not change on chat sends.
- **Ponytail Solution:** `shrink: Omit counts query when since is provided`.
  Execute the invitations and applications count query strictly on initial bootstrap (`since === null`). On delta ticks (`since !== null`), omit the query and return `pending: undefined`.

---

#### Issue LOAD-04: `chat_inbox_unread` Scans 32 Partitions on Every Background Poll
- **Location:** `drizzle/0187_chat_reorganize.sql:206-220`
- **Root Cause:** `chat_bootstrap` calls `app_private.chat_inbox_unread(p_user_id)` on every poll, joining 4 tables across 32 partitioned `chat_messages` tables without a partial index on unread mentions.
- **Scale Failure Mode (1M Users):** 1,100 executions per second of this 4-table join on partitioned tables saturates Postgres CPU.
- **Ponytail Solution:** `native: Partial index on unread mentions`.
  Create `CREATE INDEX chat_mentions_unread_user_idx ON public.chat_mentions (user_id) WHERE read_at IS NULL;` and rewrite `chat_inbox_unread` to scan strictly this partial index.

---

#### Issue LOAD-05: N+1 Correlated Subquery Loop in `listMembers`
- **Location:** `src/app/actions/chat/channels.ts:201-210`
- **Root Cause:** When listing channel members (up to 500 members), each member row evaluates a correlated subquery on `role_applications`.
- **Scale Failure Mode (1M Users):** Opening channel member details in a 500-member room executes 500 subqueries on `role_applications` in a single SQL statement (600–900ms latency).
- **Ponytail Solution:** `shrink: Pre-join role titles or derive from project_members`.
  Project member roles are already stored on `project_members.role`. Query via a single `LEFT JOIN LATERAL` or CTE with `DISTINCT ON (ra.applicant_id)`.

---

#### Issue LOAD-06: Unranked GIN Full-Text Search Across 32 Partitions
- **Location:** `src/app/actions/chat/search.ts:53-68`
- **Root Cause:** Global message search joins `chat_channel_members` to `chat_messages` across all channels without plan-time partition pruning. GIN indexes lack B-tree sorting, forcing full in-memory sorting by `created_at DESC`.
- **Scale Failure Mode (1M Users):** Searching for generic terms matches tens of thousands of rows across 32 partitions, allocating megabytes of memory and triggering multi-second timeouts.
- **Ponytail Solution:** `native: Bounded time-window search or keyset search`.
  Restrict default global search to a 60-day window (`created_at >= now() - interval '60 days'`) to prune historical partitions, and enforce pagination cursors on `(created_at, channel_seq)`.

---

### Category C: Uploads, Media Pipeline & Compression

#### Issue UPL-01: Main-Thread CPU Starvation During Bulk Image Compression
- **Location:** `src/components/messages/Composer.tsx:326-342` & `src/lib/messaging/image-compression.ts`
- **Root Cause:** Attaching up to 10 images iterates through `Array.from(files)` and immediately compresses all files in parallel via HTML5 `<canvas>` elements on the main thread.
- **Scale Failure Mode (1M Users):** High-resolution camera photos allocate >200MB memory when decoded concurrently on the main thread, freezing the UI for 1.5–3.5s and dropping framerates to 0 FPS.
- **Ponytail Solution:** `stdlib: Bounded concurrency queue (max 2 workers)`.
  Route image compression through a concurrency-bounded worker pool (max 2 workers) using `OffscreenCanvas` in a Web Worker, ensuring 0ms main-thread blockage and capping browser memory to ≤64MB.

---

#### Issue UPL-02: Render Cascades on Every Upload Progress Event
- **Location:** `src/components/messages/Composer.tsx:338`
- **Root Cause:** Progress callbacks fire `setUploads` on every chunk event (60–100 FPS), re-rendering the 751-line `Composer` and TipTap editor continuously.
- **Scale Failure Mode (1M Users):** Freezes keystrokes and typing feedback during file transfers (INP > 280ms).
- **Ponytail Solution:** `native: Unmanaged DOM progress in isolated tile`.
  Extract upload tiles into an isolated memoized component (`UploadTile`) updating DOM progress directly via CSS custom properties (`--upload-progress`).

---

#### Issue UPL-03: Missing AbortController on Upload Removal
- **Location:** `src/components/messages/Composer.tsx:318-324`
- **Root Cause:** Clicking the "X" button to cancel an upload purges it from state but does NOT abort the in-flight network transfer.
- **Scale Failure Mode (1M Users):** Canceled uploads continue transferring in the background, wasting mobile cellular data and S3 ingress bandwidth.
- **Ponytail Solution:** `stdlib: AbortController registration`.
  Store an `AbortController` in an in-memory `Map` and execute `controller.abort()` when an upload tile is removed.

---

#### Issue UPL-04: Permanent S3 Storage Leaks from Abandoned Draft Uploads
- **Location:** `src/app/api/v1/chat/attachments/presign/route.ts:95-124`
- **Root Cause:** Verified assets from abandoned drafts remain permanently in `storage_assets` and S3 without a message reference.
- **Scale Failure Mode (1M Users):** Leaks terabytes of unreferenced assets in S3 over time.
- **Ponytail Solution:** `native: Pending claim deadline & Inngest reaper`.
  Add `claim_deadline = now() + interval '2 hours'`, cleared on message send; prune expired unclaimed assets via nightly Inngest reaper.

---

### Category D: Rendering, Layout & Virtualization

#### Issue REND-01: `ConversationContext` Invalidated on Every Single Render
- **Location:** `src/components/messages/ConversationView.tsx:317-322` & `src/components/messages/useConversation.ts:335`
- **Root Cause:** `useSavedSeqs` returns `{ seqs, setSaved }` as a new object literal on every call. `ctx = useMemo(..., [..., saved])` includes `saved`, causing `ctx` to be recreated on EVERY render of `ConversationView`.
- **Scale Failure Mode (1M Users):** Every `MessageRow` subscribes to `ConversationContext` and immediately re-renders, defeating `React.memo(MessageRow)` completely.
- **Ponytail Solution:** `stdlib: Memoize useSavedSeqs return & isolate context selectors`.
  Memoize the return value in `useSavedSeqs` and split `ConversationContext` into static metadata context and dynamic state context.

---

#### Issue REND-02: Broad `useChatShell` Subscription Forces All Messages to Re-Render
- **Location:** `src/components/messages/MessageRow.tsx:137`
- **Root Cause:** `MessageRow` executes `const shell = useChatShell();`, but only uses `shell.refresh()` inside a single secondary action.
- **Scale Failure Mode (1M Users):** Background delta polls and unread badge changes re-render EVERY visible `MessageRow` in the open channel (120–250ms main-thread freeze).
- **Ponytail Solution:** `delete: Remove useChatShell from MessageRow`.
  Eliminate `const shell = useChatShell()` from `MessageRow`. Replace with direct query invalidation.

---

#### Issue REND-03: 300ms Draft Debounce Triggers Full Sidebar Re-Renders While Typing
- **Location:** `src/components/messages/Composer.tsx:190-194` & `src/components/messages/ChatSections.tsx:403`
- **Root Cause:** `writeDraft` dispatches `chat-drafts` window events every 300ms while typing, forcing `ChatSections` to re-scan `localStorage` and re-render the sidebar 3 times per second.
- **Scale Failure Mode (1M Users):** Severe typing lag (INP > 150ms) and high battery drain on laptops and mobile devices.
- **Ponytail Solution:** `shrink: Emit draft events only on state transitions`.
  Dispatch `chat-drafts` strictly when transitioning between empty and non-empty drafts. Keystrokes write silently to localStorage.

---

#### Issue REND-04: Synchronous Render-Phase State Update in `Timeline.tsx`
- **Location:** `src/components/messages/Timeline.tsx:84`
- **Root Cause:** Prepending older messages executes `setPrepend({ head, first: firstItemIndex })` directly within the component render function.
- **Scale Failure Mode (1M Users):** Forces React into an immediate second render pass, doubling rendering work on every scroll-up page load.
- **Ponytail Solution:** `native: Pure ref or offset derivation`.
  Store prepend offsets in a React ref (`useRef`) and derive `firstItemIndex` mathematically.

---

#### Issue REND-05: Missing Layout Containment & Height Reservation on Media
- **Location:** `src/components/messages/parts/message-attachments.tsx`
- **Root Cause:** Attachment containers render without explicit aspect-ratio reservation or CSS layout containment.
- **Scale Failure Mode (1M Users):** As images load asynchronously, container heights expand dynamically, causing layout shifts (CLS > 0.15) and forcing `Virtuoso` to recalculate scroll offsets.
- **Ponytail Solution:** `native: CSS aspect-ratio reservation & content-visibility`.
  Enforce `aspectRatio: width / height` on containers and apply `content-visibility: auto; contain-intrinsic-size: 56px;` to message row wrappers.

---

#### Issue VIRT-01: React-Virtuoso Header/Footer Remounting Churn on Every Render
- **Location:** `src/components/messages/Timeline.tsx:209-212`
- **Root Cause:** Inline component functions `components={{ Header: () => ..., Footer: () => ... }}` are declared inside JSX.
- **Scale Failure Mode (1M Users):** Virtuoso detects new component types on every render, tearing down and re-mounting header/footer DOM nodes continuously during scrolling.
- **Ponytail Solution:** `stdlib: Memoized Virtuoso Components Definition`.
  Extract `Header` and `Footer` outside the render function or memoize them via `useMemo`.

---

#### Issue STATE-01: Synchronous Large JSON Serialization to SessionStorage on Every Message
- **Location:** `src/components/messages/useConversation.ts:230-234` & `src/lib/messaging/storage-cache.ts`
- **Root Cause:** `setCachedTimeline(channelId, messages)` serializes up to 500 messages via synchronous `JSON.stringify(messages)` into `sessionStorage`.
- **Scale Failure Mode (1M Users):** Blocks the main thread for 15–25ms on every incoming message.
- **Ponytail Solution:** `shrink: Bounded Cache Slice`.
  Cache only the newest 50 messages (`messages.slice(-50)`) rather than the entire 500-message timeline.

---

### Category E: Proxies, Gateways, Middleware & Realtime

#### Issue PROX-01: Two-Hop 302 Redirect Waterfall on Attachment Downloads
- **Location:** `src/app/api/v1/chat/attachments/[assetId]/route.ts:17-52`
- **Root Cause:** Requesting an attachment hits `/api/v1/chat/attachments/[assetId]`, which performs an auth check, DB query, Supabase Storage API call, and returns an HTTP `302 Found` redirect to S3.
- **Scale Failure Mode (1M Users):** Viewing 10 images requires 20 HTTP network requests over the internet.
- **Ponytail Solution:** `native: Short-lived HMAC signed CDN URLs directly in message DTO`.
  Generate short-lived signed URLs directly when serializing message attachments on the server, or route through an Edge proxy with HMAC signature verification directly to S3.

---

#### Issue PROX-02: Edge Middleware CSRF Signing on Idempotent GET Requests
- **Location:** `middleware.ts:181`
- **Root Cause:** Edge middleware generates and signs HMAC CSRF cookies on read-only GET requests to `/messages/*`.
- **Scale Failure Mode (1M Users):** Adds 10–15ms of Edge CPU latency and Web Crypto computation to every TTFB measurement for read-only page loads.
- **Ponytail Solution:** `native: Restrict CSRF to mutating methods`.
  Only verify and generate CSRF tokens on mutating HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`).

---

#### Issue PROX-03: Realtime Authorization Token Expiry on Long-Lived Tabs
- **Location:** `src/lib/realtime/private-broadcast.ts:35-42`
- **Root Cause:** `private-broadcast.ts` sets the auth token once during channel creation without listening for Supabase Auth token refreshes.
- **Scale Failure Mode (1M Users):** After 1 hour, the JWT access token expires. The WebSocket connection drops authorization, causing reconnection errors (401/403) until the user manually reloads the tab.
- **Ponytail Solution:** `native: Global onAuthStateChange listener`.
  Attach `supabase.auth.onAuthStateChange` to refresh the Realtime auth token continuously.

---

#### Issue REAL-01: Redundant WebSocket Topic Joins for Typing Indicators
- **Location:** `src/components/messages/useConversation.ts:258-281` & `drizzle/0183_chat_typing_topic.sql`
- **Root Cause:** In every open channel, the client subscribes to both `chat:channel:<id>` AND `chat:typing:<id>` simultaneously.
- **Scale Failure Mode (1M Users):** 100,000 active users maintain 200,000 active WebSocket channel subscriptions on the Realtime cluster, doubling connection tracking memory and Elixir process overhead.
- **Ponytail Solution:** `shrink: Channel-Multiplexed Broadcasts`.
  Omit typing topic subscription when `memberCount > CHAT_TYPING_MAX_MEMBERS`.

---

#### Issue REAL-02: Rapid Channel Switching Topic Churn & Rate Limit Exceeded
- **Location:** `src/lib/realtime/private-broadcast.ts:78-83`
- **Root Cause:** Switching channels triggers `unsubscribe` with a `RELEASE_GRACE_MS = 1_500` timer and immediately opens the new channel. Fast browsing (`Cmd+K` or arrow navigation) creates 10–20 topic joins and leaves within seconds.
- **Scale Failure Mode (1M Users):** Triggers Realtime rate limit errors (`429 Too Many Requests`), causing WebSocket connection drops and fallback to polling.
- **Ponytail Solution:** `stdlib: Debounced Topic Switching`.
  Debounce channel topic joins by 300ms so transient navigation doesn't join intermediate topics.

---

#### Issue REAL-03: Over-Invalidation of Full Message List on Channel Metadata/Member Updates
- **Location:** `src/components/messages/useConversation.ts:185-190`
- **Root Cause:** When `member.changed` or `channel.updated` broadcast events arrive, `useConversation.ts` calls `queryClient.invalidateQueries({ queryKey: key })`, where `key` is the message infinite query.
- **Scale Failure Mode (1M Users):** A member joining or an admin renaming a channel forces all active viewers to refetch up to 500 loaded messages across all pages.
- **Ponytail Solution:** `delete: Remove message query invalidation from metadata events`.
  Invalidate only `queryKeys.chat.channel(channelId)` and `queryKeys.chat.members(channelId)`.

---

### Category F: Audited Data Items, Partitions, Indexes & Caching

#### Issue ITEM-01: Per-Channel `last_seq` Row Lock Serialisation Bottleneck
- **Location:** `drizzle/0180_chat_rebuild_additive.sql:352-359`
- **Root Cause:** `chat_send_message` increments the sequence number via `UPDATE public.chat_channels SET last_seq = last_seq + 1 ... WHERE id = p_channel_id RETURNING last_seq`, placing an exclusive row lock on the channel row.
- **Scale Failure Mode (1M Users):** Limits throughput to ~300 sends/second per channel (L-17). In large announcement channels, concurrent senders queue on the row lock, causing lock waits and transaction timeouts.
- **Ponytail Solution:** `native: Sequence block leasing or per-channel Postgres sequence`.
  For high-traffic channels, allocate sequence numbers using PostgreSQL sequences or sequence block leasing in blocks of 10.

---

#### Issue ITEM-02: Sequential Table Scan in Mentions Retention Cleaner
- **Location:** `src/lib/messaging/maintenance.ts:12-23`
- **Root Cause:** `purgeOldChatMentions` runs `DELETE FROM chat_mentions WHERE created_at < now() - interval '90 days' LIMIT 5000`. `chat_mentions` has NO index on `(created_at)` alone.
- **Scale Failure Mode (1M Users):** Each of the 40 batches in the nightly Inngest retention job performs a full sequential table scan across millions of rows in `chat_mentions`, causing severe disk I/O and lock contention.
- **Ponytail Solution:** `native: Index on created_at or range partitioning`.
  Create `CREATE INDEX chat_mentions_created_at_idx ON public.chat_mentions (created_at);`.

---

#### Issue ITEM-03: Storage Cache Eviction Loop Index-Skipping Bug
- **Location:** `src/lib/messaging/storage-cache.ts:66-72`
- **Root Cause:** When `sessionStorage` quota is exceeded, the eviction logic runs a forward `for` loop while mutating `sessionStorage`, shifting indices and skipping every second matching key.
- **Scale Failure Mode (1M Users):** Fails to free sufficient storage space during quota exceptions, causing timeline cache writes to throw unhandled exceptions.
- **Ponytail Solution:** `stdlib: Snapshot keys array before eviction`.
  `Object.keys(sessionStorage).filter(k => k.startsWith(STORAGE_PREFIX)).forEach(k => sessionStorage.removeItem(k));`

---

#### Issue ITEM-04: In-Memory Token Bucket Instance Drift
- **Location:** `src/lib/messaging/send-bucket.ts:1-24`
- **Root Cause:** `takeSendToken` and `takeReactToken` store token state in an in-memory `Map` per serverless process.
- **Scale Failure Mode (1M Users):** In a horizontally scaled cluster of 20–50 Node.js instances, an aggressive user or bot can cycle requests across instances, multiplying their effective rate limit by 50×.
- **Ponytail Solution:** `native: Redis sliding-window token bucket`.
  Upgrade the token bucket to use Upstash/Redis `rateLimit('chat:send:' + userId)` when cluster instance count exceeds 5.

---

### Category G: Audited Server Actions & Background Jobs

#### Issue ACT-01: Sequential N+1 Updates in `saveChannelTabs`
- **Location:** `src/app/actions/chat/channels.ts:303-308`
- **Root Cause:** `saveChannelTabs` loops over `tabs.entries()` and executes an `await chatRows(sql'UPDATE chat_channel_tabs ...')` per tab sequentially.
- **Scale Failure Mode (1M Users):** Updating 10 tabs executes 10 sequential database roundtrips, increasing mutation latency to >350ms.
- **Ponytail Solution:** `shrink: Single bulk UPDATE statement`.
  Execute a single bulk update using `jsonb_to_recordset`:
  `UPDATE chat_channel_tabs t SET title = x.title, position = x.position FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, title text, position int) WHERE t.id = x.id AND t.channel_id = $2::uuid;`

---

#### Issue ACT-02: Redundant Database Roundtrip in `sendAs`
- **Location:** `src/lib/messaging/send.ts:97-100`
- **Root Cause:** After calling `app_private.chat_send_message`, `sendAs` executes a second query to fetch `channel_name` just for push notification formatting.
- **Scale Failure Mode (1M Users):** `app_private.chat_send_message` already reads the `chat_channels` row. An extra query adds 700 redundant queries/second at peak.
- **Ponytail Solution:** `shrink: Return channel_name directly from chat_send_message`.
  Include `'channel_name', v_channel.name` in `chat_send_message`'s return JSONB, eliminating 1 database roundtrip per message send.

---

#### Issue ACT-03: Looping Unbatched `publishUser` Calls in `addMembers`
- **Location:** `src/app/actions/chat/members.ts:54`
- **Root Cause:** Adding multiple members runs `for (const id of userIds) publishUser(id, ...)`, scheduling independent `after()` callbacks that each execute a separate HTTP POST to Supabase Realtime REST API.
- **Scale Failure Mode (1M Users):** Adding 10 members fires 10 independent outbound HTTP requests to Supabase Realtime instead of 1 batched payload.
- **Ponytail Solution:** `shrink: Batched user broadcast`.
  Create `publishUsers(userIds, event, payload)` dispatching 1 single HTTP POST request.

---

#### Issue ACT-04: Client-Side Parallel Spam in `HomePane.markAll`
- **Location:** `src/components/messages/HomePane.tsx:71-74`
- **Root Cause:** Clicking "Mark all read" in `HomePane` loops through all unread channels and invokes `void markRead({ channelId, seq })` individually in parallel.
- **Scale Failure Mode (1M Users):** Fires 15+ concurrent server actions simultaneously, swamping serverless execution slots.
- **Ponytail Solution:** `shrink: Single bulk markAllReadAction`.
  Create a single server action `markAllReadAction(channels)` executing 1 SQL update across all member rows in 1 roundtrip.

---

#### Issue ACT-05: Unbounded Inline Web Push Fanout in Next.js `after()`
- **Location:** `src/lib/messaging/publish.ts:67-82`
- **Root Cause:** In `publishSentMessage`, `Promise.all(recipients.map(...))` fires Web Push dispatches for all notify recipients directly inside the Next.js `after()` callback.
- **Scale Failure Mode (1M Users):** An `@channel` broadcast in a 100-member room triggers 100 parallel outbound push notifications within a single serverless function instance, risking socket exhaustion and timeouts.
- **Ponytail Solution:** `shrink: Concurrency-capped push queue`.
  Limit parallel push dispatch to batches of 10, or enqueue notifications to an Inngest background job when recipient count exceeds 20.

---

#### Issue ACT-06: N+1 Individual Push Subscription Queries in `publishSentMessage`
- **Location:** `src/lib/messaging/publish.ts:67-82` & `src/lib/notifications/web-push.ts:121-129`
- **Root Cause:** `sendPushToUser` is called individually per recipient, executing `SELECT ... FROM push_subscriptions WHERE user_id = recipient.id` on each call.
- **Scale Failure Mode (1M Users):** Notifying 50 users fires 50 individual database queries in `after()`, consuming database connections.
- **Ponytail Solution:** `shrink: Single Batch Query for Push Subscriptions`.
  Execute a single `SELECT ... FROM push_subscriptions WHERE user_id = ANY($1)` before fanout.

---

#### Issue MUT-01: Message Edit Does Not Synchronize `chat_mentions`
- **Location:** `drizzle/0180_chat_rebuild_additive.sql:888-906`
- **Root Cause:** `app_private.chat_edit_message` updates `chat_messages.body` but does not update `chat_mentions`.
- **Scale Failure Mode (1M Users):** Adding an `@mention` in an edit never notifies the user or adds it to their unread inbox; removing a mention leaves stale unread items.
- **Ponytail Solution:** `native: Re-tokenize Mentions in chat_edit_message`.
  Extract mentions in `chat_edit_message` and synchronize `chat_mentions`.

---

## 4. End-to-End Ponytail Architectural Solutions Blueprint

Below is the consolidated blueprint aligning the messaging system with the optimized S3 architecture and the sub-50ms 1M-user performance target:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PONYTAIL 1M-USER & S3 ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. S3 OBJECT STORAGE & MEDIA ENGINE (Direct CDN & Zero Serverless Waste)   │
│     - Native S3 Checksums: Validate x-amz-checksum-sha256 in S3 (Zero RAM)  │
│     - CAS Key Sharding: chat/${hash[0..1]}/${hash[2..3]}/${hash}.${ext}     │
│     - Instant Deduplication: Return existing assetId if hash exists in DB   │
│     - S3 Multipart Alignment: Direct 5MB chunk presigning for files > 6MB   │
│     - Thumbnail Derivatives: 400px WebP thumbnails (15KB) in message feed   │
│     - Canvas Reference Guard: Include chat_canvases in asset deletion check │
│     - Backup Tombstone Sync: SigV4 DELETE in s3-backup-client on purge      │
│     - Media Range Streaming: 206 Partial Content / 2-hour signed media URLs │
├─────────────────────────────────────────────────────────────────────────────┤
│  2. CLIENT RUNTIME & VIRTUALIZATION (Zero-Jank 120 FPS Interaction)        │
│     - Virtuoso Prepend: Ref-based index derivation (0 render-phase setStates│
│     - Component Extraction: Memoized Header/Footer; isolated UploadTile     │
│     - Context Partitioning: Static metadata vs dynamic editing state        │
│     - Memoized Hooks: Stable useSavedSeqs return reference                  │
│     - Draft Persistence: Window events emitted strictly on empty/non-empty  │
│     - Worker Compression: 2-worker OffscreenCanvas pool (<= 64MB RAM cap)   │
│     - Storage Cache: Bounded 50-message slice with snapshot key eviction    │
├─────────────────────────────────────────────────────────────────────────────┤
│  3. REALTIME & NETWORK GATEWAY (Single Multiplexed Stream & Zero Waterfalls)│
│     - Multiplexed Topics: Merge typing into channel topic; filter large rms │
│     - Debounced Subscriptions: 300ms join debounce prevents 429 rate limit  │
│     - Token Renewal: onAuthStateChange listener prevents 1-hour drops       │
│     - Edge CSRF: Bypass on all idempotent GET requests (Save 15ms TTFB)     │
│     - Single-Hop Media: Short-lived HMAC signed CDN tokens in message DTO   │
├─────────────────────────────────────────────────────────────────────────────┤
│  4. DATABASE & TRANSACTION ENGINE (Single-Pass Set-Based Queries)           │
│     - selectMessages: 1 CTE + 4 set-based LEFT JOINs (Cut 200 subqueries)   │
│     - chat_send_message: Return channel_name in JSONB (Cut 1 roundtrip)     │
│     - chat_bootstrap: Delta ticks omit invites/applications count (1.1k qps)│
│     - chat_inbox_unread: Partial index on (user_id) WHERE read_at IS NULL   │
│     - chat_mentions: Partial index on created_at for retention reaper       │
│     - Push Batches: 1 query for push subscriptions + 1 batched push queue   │
│     - saveChannelTabs: Bulk UPDATE via jsonb_to_recordset (Cut N queries)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Expanded Ponytail Debt Ledger (Ceilings & Upgrade Triggers)

| Ledger ID | Subsystem | Current Shortcut | Operational Ceiling | Upgrade Trigger |
|---|---|---|---|---|
| **L-34** | Timeline Load | CTE batch hydration (50 rows/page) | 500 messages/page | Pagination size increased past 100 → Keyset cursor with partial index. |
| **L-35** | Uploads | 2-worker OffscreenCanvas pool | 20 MP images / 2 concurrent | RAW/HEIC files supported → WebAssembly Libraw worker. |
| **L-36** | Attachments | Short-lived HMAC CDN token URLs | 100k downloads/min | CDN bandwidth costs exceed storage budget → Direct Cloudflare Images integration. |
| **L-37** | Presence | 10-minute heartbeat, 30-day Redis tz | 10-minute resolution | Sub-minute live presence requested → Supabase Presence topic multiplexing. |
| **L-38** | Rate Limiting | In-memory token bucket per instance | 5 server instances | Autoscaling fleet > 5 instances → Upstash Redis sliding window. |
| **L-39** | Search | Postgres FTS with simple config | 10M messages | Query latency p95 > 250ms → Dedicated search cluster (Meilisearch/pgvector). |
| **L-40** | Push Dispatch | Inline capped batch of 10 in `after()` | 100 recipients / send | Channels > 100 members with broadcast → Asynchronous Inngest push worker. |
| **L-41** | S3 Finalization | Direct S3 HeadObject verification | 1,000 uploads/sec | Fleet upload throughput > 1,000/sec → S3 Event Notifications via SQS queue. |
| **L-42** | S3 Deduplication | DB contentHash index lookup in presign | 50M assets | DB lookup p95 > 15ms → Redis bloom filter for pre-flight hash check. |
| **L-43** | S3 Thumbnails | Sharp WebP on device/worker | 10 MB originals | Large media ingestion > 25 MB → CloudFront Image Optimization on-the-fly. |
| **L-44** | Typing Topics | Client-side room member filter (< 50) | 50 typers/room | Enterprise rooms with > 1,000 members → Server-side ephemeral presence state. |
| **L-45** | Push Subscriptions| Single batch query in `after()` | 500 recipients / send | Enterprise all-hands broadcasts → Redis push subscription cache. |

---

## 6. Verification & Implementation Roadmap (Pass/Fail Gates)

When implementation authorization is granted in a future phase, work must be verified against 5 rigorous gates:

1. **Gate 1: S3 & Storage Pipeline Verification**
   - Upload finalization of a 50MB file must allocate **< 5 MB** of serverless container memory (zero byte streaming).
   - Media downloads must return directly from CDN/S3 in **1 single HTTP request** (zero 302 redirects).
   - Video streaming must support `Range: bytes=` seeking without playback failure after 5 minutes.
   - Channel canvas image assets must be preserved by `storageAssetDeletion` without deletion.
2. **Gate 2: SQL Governance & Query Performance**
   - `EXPLAIN (ANALYZE, BUFFERS)` on `selectMessages` (50 rows) must execute in **< 5.0 ms** with zero correlated subqueries.
   - `chat_bootstrap` on delta ticks must execute in **< 2.0 ms** without touching `project_invitations` or `role_applications`.
   - Mentions retention reaper must execute an index-range scan in **< 10 ms**.
3. **Gate 3: Client Rendering & Interaction Responsiveness**
   - INP during continuous fast typing in `Composer`: **< 8 ms (120 FPS)**.
   - Channel switch transition: **< 5 ms** with zero layout shift.
   - Memory allocation during 5-image upload: **< 64 MB heap peak**.
   - React-Virtuoso header/footer components: 0 unmount/remount churn during scroll.
4. **Gate 4: Realtime Gateway & WebSocket Multiplexing**
   - WebSocket topics per channel view: exactly **1 topic** (`chat:channel:<id>`), zero duplicate typing topics.
   - Rapid channel switching (`Cmd+K` 10 channels in 5 seconds): 0 HTTP 429 rate limit errors or disconnects.
   - Channel member/metadata updates: exactly 0 message queries refetched.
5. **Gate 5: Automated Contract Suites**
   - `npm run check:chat:db`: PASS.
   - `npm run check:chat:actions`: PASS.
   - `npx tsx --test 'tests/unit/message*.test.ts' 'tests/unit/chat*.test.ts'`: PASS (100% of unit contracts).
