# Storage redesign implementation traceability

Date: 2 October 2026

This matrix is the final source-tree audit against F01-F65 and T01-T33. It distinguishes code that is complete in the working tree from evidence that can only be produced after deployment or in a dedicated qualification environment.

Status meanings:

- **Local complete**: the source-controlled implementation and local contract coverage are present.
- **Prepared**: the repository change is complete, but deployment, provider, browser or live-database evidence remains.
- **External gate**: the plan requires infrastructure, traffic, credentials, time or operational approval that is unavailable in this workspace.

No **Prepared** or **External gate** item is represented as production-qualified.

## Finding disposition: F01-F65

| ID | Status | Implemented disposition and primary evidence |
|---|---|---|
| F01 | Local complete | Canonical upload creation uses server-generated immutable keys and scoped idempotency in `src/lib/upload/upload-intents.ts` and `src/lib/upload/project-upload-allocation.ts`; provider writes use `upsert: false`. |
| F02 | Local complete | Intent fingerprints bind owner, purpose, scope/target, bucket, key, size, MIME and expected revision; bucket and key form one identity in migration 0178. |
| F03 | Local complete | File, version, chat, profile, cover and update publication accept verified asset IDs and write domain references in the publication transaction; unattached assets remain lifecycle cleanup candidates. |
| F04 | Local complete | Verification uses bounded streamed reads, byte ceilings, deadlines and cancellation in `src/lib/upload/upload-intents.ts` and `src/lib/storage/bounded-object-read.ts`, including origins that ignore Range. |
| F05 | Local complete | Verification failures are classified, leases have fencing tokens, and stale completions cannot overwrite a newer claim. |
| F06 | Local complete | `src/lib/upload/supabase-signed-upload-client.ts` is the single browser transfer owner with four global transfers, two resumable transfers, bounded retry/backoff and cancellation. |
| F07 | Local complete | Purpose contracts, finite integer validation, quotas, 64 outstanding intents per user, 50-item server batches and aligned file limits are enforced in shared upload code and migration 0178. |
| F08 | Local complete | Deletion requires lifecycle claims and live-reference rechecks; cancellation changes operation state and delayed deletion covers credential replay risk. |
| F09 | Local complete | Chat initiation and publication recheck conversation membership and message visibility in the attachment presign/publication flow. |
| F10 | Local complete | Chat finalization resolves the stored intent and rejects replacement keys, foreign assets and unverified state. |
| F11 | Local complete | Verification computes a full streamed SHA-256 digest; path, client hash, prefix and ETag are not authoritative. |
| F12 | Local complete | Chat uses the shared direct-transfer client and stable intent/attachment identity; the duplicate server byte-upload fallback is removed. |
| F13 | Local complete | `src/app/api/v1/messages/attachments/[attachmentId]/route.ts` serves authenticated streams with membership, block, hidden and deletion checks and does not redirect to a private provider URL. |
| F14 | Local complete | Shared transfer state separates transfer, verification and publication, supports abortable waits, uses authenticated thumbnails, and returns safe filenames. |
| F15 | Local complete | Retention selects eligible rows in bounded claims, records terminal cleanup state and checks all surviving asset references. |
| F16 | Local complete | Profile image publication is transactional and reference-safe; source bytes remain private, public output is sanitized and preview URLs are released by the UI lifecycle. |
| F17 | Local complete | Profile inputs use a 2 MiB limit, JPEG/PNG/WebP signatures, a 16 MP decoder ceiling, quota reservation and purpose rate controls. |
| F18 | Local complete | Cover reads use visibility-aware application routes and bounded cache policy; cleanup is reference/asset based rather than folder-wide. |
| F19 | Local complete | Update media is resolved through its update/project authorization route; migration 0178 removes direct public-bucket read exposure. |
| F20 | Local complete | Normalized update-media rows own asset references; abandoned media stays eligible for asset-ID cleanup and legacy targets are tombstoned before cascades. |
| F21 | Local complete | Verified 64/128/400 avatar variants and bounded public URLs are used by shared avatar/card consumers; private/local URLs are never rewritten into a public cache. |
| F22 | Local complete | File preview and extension routes check project, node, task, tab, deletion and version scope before reading. |
| F23 | Local complete | Private response identity is derived from immutable asset/revision identity, so byte changes cannot reuse a stale validator. |
| F24 | Local complete | Callers reconcile stable operation state after uncertain responses; canonical publication code does not compensate by deleting possibly committed bytes. |
| F25 | Local complete | Deletion checks current nodes, retained versions, Trash, recovery, sync and export pins before provider removal. |
| F26 | Local complete | Private PDFs and large objects stream with byte/range caps; Git fallback is tied to the immutable blob SHA with response and decoded-byte limits. |
| F27 | Local complete | Private viewers use stable authorized application routes with `private, no-store`; viewer state is bounded and scoped. |
| F28 | Local complete | File history uses keyset pagination and the task-file UI uses the shared bounded transfer client. |
| F29 | Local complete | Uploaded-project relative document media is resolved through contained paths and domain authorization; Git fallback uses immutable revisions. |
| F30 | Local complete | Folder export streams ZIP entries with pins, preserves logical paths, caps entries/bytes and stops on missing content. |
| F31 | Local complete | Account export uses cursor-based incremental JSON streaming and no longer creates a redundant `exports` bucket object. |
| F32 | Local complete | Folder creation stages folders separately; each file is exposed only after verified asset, node and valid initial version publication. |
| F33 | Prepared | Rolling signing windows and operation status are implemented; browser/server recovery claims are bounded. Weak-network, expiry and cross-reload provider testing remains. |
| F34 | Local complete | Mirror/import paths require a complete bounded manifest, validate generation/revision identity and publish in bounded chunks. |
| F35 | Local complete | Git import applies the 10 MiB file limit and server-issued canonical asset/intent identity. |
| F36 | Local complete | Import finalization and cancellation use stable operation state and retry-safe counters; abort does not remove already-published assets. |
| F37 | Local complete | Entry count, path length, total expanded bytes and queues are bounded; traversal and unsupported links are rejected. |
| F38 | Local complete | Hydration operations use leases, heartbeats and explicit partial/failed status with retryable error retention. |
| F39 | Local complete | Extension deletion/publication resolves stored assets and leases; caller-provided arbitrary object keys are not deletion authority. |
| F40 | Local complete | Extension batches are capped, bindings are exact, and the 512 KiB inline cap applies even when a force flag is sent. |
| F41 | Local complete | Recovery draft read/finalization/expiry is asset-bound; pruning is durable and keeps three generations for 30 days. |
| F42 | Local complete | Sync snapshots and operation objects use explicit expiring asset pins. |
| F43 | Local complete | Cascade-safe asset/tombstone rows preserve cleanup evidence for profiles, covers, nodes, versions, updates, chat, imports and drafts. |
| F44 | Local complete | Cleanup/repair jobs use bounded keyset batches and compare-and-swap; copied destinations are verified before reference switches and source deletion. |
| F45 | Local complete | Provider reads, backup and deletion occur outside row-lock/database transaction sections. |
| F46 | Prepared | Workers have bounded claims, finite metrics, oldest-age reporting, lease recovery and fair queues. Arrival-rate and outage catch-up sizing require the qualification environment. |
| F47 | Local complete | Repair failures have a durable ledger independent of cursors; path-only matches are quarantined rather than attached or deleted. |
| F48 | Local complete | The fake CDN purge owner was removed; storage metrics bypass production verbose-log suppression and use finite labels. |
| F49 | Prepared | Independent AWS S3 backup, full-byte verification, deletion gating and restore metadata are implemented. An isolated AWS account/bucket and combined restore drill remain external. |
| F50 | Local complete | CSP permits the required authenticated image/video/PDF/blob-worker behavior while keeping object embedding disabled. |
| F51 | Local complete | Transfer resume keys and wizard drafts include account and operation scope and are cleared across account changes. |
| F52 | Prepared | Migration 0178 revokes browser lifecycle mutations and server code owns transitions. Deployment and real-role attack testing remain. |
| F53 | Prepared | Migrations 0178/0179 align public node/version reads and harden server-only tables/functions; live role/RLS/catalog verification must be rerun after deployment. |
| F54 | Local complete | Migration 0178 adds asset-reference, due-work and transitional storage-key indexes, including retained versions and Trash-sensitive lookups. |
| F55 | Local complete | Hash repair changes metadata only and does not emit contribution events or assign the maintenance operator. |
| F56 | Local complete | A dedicated project event counter allocates short sequence ranges without locking the project settings row for unrelated writers. |
| F57 | Local complete | Asset and legacy cleanup tombstones keep owner/project scope after account/project cascades. |
| F58 | Local complete for connected data | The 5,859 missing current versions were repaired from verified bytes. Full hash/asset registration and current-key reconciliation leave zero missing or incomplete current versions. Unavailable historical bytes are retained as explicit quarantine evidence rather than fabricated content. |
| F59 | Local complete | Obsolete task-file migration behavior is superseded by the governed journal and maintained repair/manifest scripts. |
| F60 | Local complete | Hash repair streams bytes, checks original key/revision before update, checkpoints progress and exits visibly on partial failures. |
| F61 | Prepared | Journal/governance/source checks pass for 177 migrations. Migrations 0178/0179 are applied; live lineage, catalog drift and hardening pass. Disposable replay is unavailable and the live credential is still `postgres`. |
| F62 | Prepared | Migration 0179 consolidates overlapping contribution reads; native leaked-password protection remains a deployment configuration task. |
| F63 | Prepared | The plan preserves all uncertain indexes and only permits removal after workload evidence; production query/index statistics remain a qualification input. |
| F64 | External gate | The mixed SQL/Auth/Realtime/storage/worker qualification workload is specified but has not run at 1M accounts/50M references. |
| F65 | Local complete | Person lists use cursor pagination, retain at most ten pages and cap mounted/retained people at 500; contract tests cover 500/2,000/10,000-result behavior. |

## Acceptance-test disposition: T01-T33

| ID | Status | Evidence or remaining work |
|---|---|---|
| T01 | Local complete | Upload-security and lifecycle tests cover cross-owner/project/bucket/key/purpose/target substitution and asset reuse. |
| T02 | Local complete | Lifecycle and project-publication tests cover duplicate initiation/finalization and stable operation status. |
| T03 | Local complete | Lease/fence tests cover stale verification workers, expiry and classified retry behavior. |
| T04 | Local complete | Bounded read and private-response tests cover truncation, size/digest mismatch, ignored Range, oversized bodies and cancellation. |
| T05 | Prepared | Queue, TUS expiry/resume, scoped recovery and cancellation contracts are covered locally; real browser/network fault testing remains. |
| T06 | Local complete | Purpose size/MIME/count/quota and empty-file contracts are covered by upload and quota tests. |
| T07 | Local complete | Deletion and permanent-delete tests cover shared references, versions, Trash, pins, lease races and replay windows. |
| T08 | Local complete | Attachment tests cover membership, hidden/deleted/blocked state, immutable attachment binding and retries. |
| T09 | Prepared | Source and SQL policy tests cover roles and visibility states; real JWT/PostgREST checks remain after migrations deploy. |
| T10 | Local complete | Private-object tests cover HEAD, conditional requests, 206/416, revision identity, MIME, filenames, length/range enforcement and stream expiry. |
| T11 | Prepared | Profile/avatar/card source contracts and bounded variants pass; deployed provider/mobile/accessibility journeys remain. |
| T12 | Prepared | Cover replacement and visibility/cache transitions have local coverage; provider race integration remains. |
| T13 | Local complete | Normalized update-media and cleanup tests cover state/visibility/deletion and asset-ID cleanup. |
| T14 | Local complete | Extension contract tests cover sessions, leases, revisions, arbitrary keys, inline caps, bulk failures and recovery retention. |
| T15 | Local complete | Document media tests cover contained local paths, traversal, deletion/privacy and immutable Git fallback. |
| T16 | Local complete | Scoped cache/draft/resume contracts cover logout and account-switch isolation. |
| T17 | Prepared | Keyset pagination and bounded workers cover large sets locally; provider outage catch-up at production volume remains. |
| T18 | Local complete | Export tests cover duplicate bytes at distinct paths, authorization, missing content, cancellation and hard bounds. |
| T19 | Prepared | Manifest validation and publication tests cover malicious/partial/duplicate data and bounds; full provider resume/archive campaign remains. |
| T20 | Local complete | Worker operation tests cover duplicate events, stale leases, retries, abort/commit races, permission loss and pins. |
| T21 | Prepared | Cascade and tombstone source/SQL tests cover all media families; a production-shaped failure drill remains. |
| T22 | Prepared | Lock ordering, event sequences and quota contention are covered locally; hot-project pool saturation needs load infrastructure. |
| T23 | External gate | The 1M/50M peak, soak, overload, skew and reconnect qualification has not run. |
| T24 | Prepared | Metric delivery paths and finite labels have local coverage; deployment alert delivery and log-sink evidence remain. |
| T25 | External gate | Independent database/object restore with link/hash/permission validation requires configured backup infrastructure and a full drill. |
| T26 | Prepared | SQL security tests verify revocations/policies in source; real JWT/PostgREST/RPC/runtime-role attacks remain after deployment. |
| T27 | Prepared | Migration constraints and publication tests cover valid initial/current versions and same-project references; staged legacy validation remains. |
| T28 | External gate | Representative 50M-reference `EXPLAIN` plans and production RLS/search/index measurements require a seeded disposable environment. |
| T29 | Local complete | Contribution tests verify no repair contribution and ordered unique events for real writes. |
| T30 | Prepared | Repair tools ran to completion and are idempotent on the connected data. They use full streamed verification, CAS publication and explicit quarantine. Backup recovery and production-shaped fault injection remain. |
| T31 | Prepared | Journal, 177-source, governance, live lineage, catalog drift and read-only hardening checks pass after applying 0178/0179. Fresh replay is blocked by a missing disposable URL and the runtime role remains `postgres`. |
| T32 | External gate | Full application journeys under simultaneous storage/background load have not run. |
| T33 | Prepared | Person-card bounds are covered by local contracts; browser memory/variable-height/navigation measurements remain. |

## Verification snapshot

| Check | Result |
|---|---|
| Production build | Passed with build-only placeholder backup variables; a normal production build correctly fails closed when backup variables are absent. |
| TypeScript | Final check passed after the private-read binding changes. |
| Full repository lint | Passed. |
| API response envelopes | Passed for all 83 route files. |
| Focused storage tests | 45 passed, 0 failed in the final migration/runtime regression set; earlier broader storage runs also passed. |
| Private-read regression set | 93 passed, 0 failed after exact verified asset binding was added to message attachments, file previews and inline file reads. |
| Full repository unit snapshot | 2,091 passed, 12 failed, 2,103 total. Remaining failures are unrelated UI/source-contract tests and are listed in `/tmp/nb-s3-unit-final-2026-10-02.log` for this workspace session. |
| SQL governance | Passed: 177 migrations. |
| Migration journal | Passed. |
| Migration source validation | Passed: 177 sources. |
| Disposable replay | Blocked safely because no disposable URL is configured. |
| Live hardening read-only check | Cross-project hardening check passed. |
| Live runtime role | Failed: the configured runtime connection reports `postgres`. |
| Live lineage | Passed: migrations 0178 and 0179 are deployed; 177 canonical tags and 7 legacy aliases are accounted for. |
| Live catalog drift | Passed. |
| Connected data migration | Zero missing/incomplete current versions and zero unattached cover/update/chat/avatar references. Quarantine ledger retains 14 overwritten historical revisions, 2,264 overwritten sync snapshots and eight missing chat objects. |
| Browser smoke checks | Discover, project Docs and project Files rendered without the reported Redis timeout or missing-schema overlays. |

## Final release blockers

1. Replace the application and worker `postgres` connection with least-privilege runtime roles.
2. Provide a disposable fresh database and a production-shaped snapshot for replay/upgrade checks.
3. Configure the independent AWS backup account, bucket, credentials, retention and alerting; run a combined restore drill and recover quarantined history if backups contain it.
4. Run provider/browser fault tests for direct upload, TUS, ignored Range, cancellation, visibility churn and session revocation.
5. Seed and run the 1M-account/50M-reference mixed load, soak, overload, hot-tenant and reconnect campaigns.
6. Run the equivalent AWS S3/CloudFront benchmark and cost comparison.
7. Complete staged canary, rollback, operational-owner sign-off and legacy retirement windows.

Until all seven items have evidence, the supported statement remains: **implemented for the connected data and awaiting production qualification**.
