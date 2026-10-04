# Storage redesign implementation status

Date: 30 September 2026; updated 2 October 2026

This record describes the implementation now present in the working tree. It supplements the original audit evidence, which remains a historical snapshot. It does not claim production qualification or completion of the one-million-user workload.

## Current outcome

The application now has one canonical storage lifecycle for new and repaired assets:

`pending -> verified -> delete_pending -> deleting -> deleted`

The lifecycle uses immutable bucket/key identities, request-bound idempotency, full streamed SHA-256 verification, fenced verification and deletion leases, domain references, durable repair failures, and independent backup state. Provider reads and deletes run outside database transactions.

Canonical lifecycle support is implemented for:

- Project and task files, retained versions, active node content, Trash and permanent deletion.
- Chat attachments and authenticated chat downloads/previews.
- Profile avatars and banners.
- Project covers.
- Published and draft project-update media.
- Extension recovery drafts.
- GitHub import manifests and imported files.
- Account and project deletion scheduling.

Private reads use application routes with authorization, conditional requests, single-range streaming, safe disposition headers, `nosniff`, request cancellation, a four-minute maximum stream authority, and private no-store caching by default. Public versioned project media may opt into immutable public caching only after domain authorization establishes public visibility.

## Phase status

| Phase | Status | Implemented evidence | Remaining release gate |
|---|---|---|---|
| P01 Baseline | Implemented locally | Coverage and finding ledgers retained; migrations 0176-0179 are in the journal and governance manifest; runtime-role checker executes | Re-run delta inventory at release freeze; production runtime currently uses an over-privileged `postgres` role |
| P02 Database and permissions | Implemented and deployed to the connected database | Migrations 0178 and 0179 are applied; live lineage reports 177 canonical tags and 7 legacy aliases; catalog drift, project-update schema and cross-project hardening checks pass; quota counters were reconciled | Run disposable replay and production-shaped upgrade; replace the `postgres` application credential with a least-privilege runtime role and rerun the real-role attack matrix |
| P03 Canonical upload/publication | Implemented for migrated purposes | Immutable intent keys, metadata-bound fingerprints, full verification, lease fences, atomic per-scope quota reservation, a 64-intent user ceiling, bounded server image decoding, atomic file/version publication, stable operation status/cancellation and stable retries | Provider integration and response-loss fault campaign |
| P04 Shared transfer client | Implemented | One browser transfer owner, four-transfer queue, two resumable slots, rolling signing, lazy TUS, 6 MiB threshold/chunks, bounded retries, deadlines, cancellation and account-scoped resume records | Weak-network/browser matrix and measured native-upload comparison |
| P05 Private reads and chat | Implemented | Authenticated stream owner, chat membership/block/hidden/deleted checks, canonical attachment publication, no private redirect response | Live session-revocation and long-stream integration tests |
| P06 Profiles, cards, covers, updates | Implemented; connected legacy data migrated | 2 MiB/16 MP image rules, private profile-image staging, verified and sanitized public WebP publication, atomic references, normalized update media, reference-safe cleanup, provider-rendered 64/128/400 avatar variants, one-day public avatar cache policy, bounded person cards, three legacy avatars sanitized, and all retained cover/update-media references attached | Provider/mobile/accessibility verification across the deployment matrix |
| P07 Files, tasks, documents, extension, export | Implemented locally | Revision-bound publication, authorized file/version reads, keyset-paged retained versions, bounded provider reads, canonical inline and large extension saves, recovery drafts, permanent deletion, cursor-streamed account JSON, and server-streamed authenticated ZIP export with deletion pins | Complete extension compatibility fixtures and provider/cancellation integration tests |
| P08 Creation, folders, imports, sync | Implemented locally | Server-allocated project keys, folder-only tree staging, rolling upload signing, verified file plus initial-version publication, canonical GitHub import identities, bounded manifest reads/validation, safe abort, partial hydration state, reviewed-sync asset pins and retained-snapshot lifecycle | Complete end-to-end folder/import resume, expanded-archive and provider fault qualification |
| P09 Repair and maintenance | Implemented and executed against the connected data | All 5,859 missing current versions were repaired; all recoverable retained objects were fully streamed, hashed and registered; authoritative current-key drift was repaired; the final audit has zero missing/incomplete current versions and zero unattached cover/update/chat/avatar references; irrecoverable history is explicitly quarantined | Recover 14 overwritten historical file revisions, 2,264 overwritten Git sync snapshots and eight absent chat objects from an independent backup if one exists; prove outage catch-up at qualification scale |
| P10 Monitoring, backup, operations | Partially implemented | S3 SigV4 backup client, one-worker bounded backup flow, full-byte backup verification, deletion backup gate, expired deletion-lease recovery, production-safe metric emission, finite batch metrics, capped queue-depth/oldest-age snapshots, and expired export-pin pruning | Configure independent AWS account/bucket, deployment metric sink/alerts, combined restore drill and password-protection setting |
| P11 Qualification/provider comparison | Not run | Test workload and gates are specified in the plan | Seed 1M accounts/50M references, run load/soak/overload, measure headroom and compare AWS/CloudFront |
| P12 Canary and handoff | Not run | Compatibility paths remain in place for migration | 1/10/50/100% canary, rollback exercise, owner acceptance and removal of legacy paths after retention windows |

## Implemented invariants

1. Clients cannot choose or replace a canonical asset bucket/key during finalization.
2. Finalization is bound to owner, purpose, scope, target metadata, expected bytes/MIME and the issued operation.
3. Full content identity comes from a bounded server stream. Prefix hashes, names and ETags are not treated as proof.
4. Domain publication accepts only a verified asset and records the reference atomically.
5. Lost responses reconcile through stable operation state. Canonical callers do not delete possibly committed bytes.
6. Deletion claims are bounded and fenced. A worker rechecks all known live references before and after provider deletion.
7. Account and project cascades stop when any profile, cover, node, version, update, draft, chat, import or recovery reference still lacks an asset ID.
8. Permanent file deletion detaches rows and schedules lifecycle deletion within the transaction; provider I/O occurs afterward.
9. Published assets require verified independent backup evidence before physical deletion. Invalid abandoned uploads may use `not_required`.
10. Reconciliation records path-correlated objects as quarantine candidates. It does not attach or delete based on path resemblance.
11. Legacy file repair compares the original key/revision before updating and records partial failures durably.
12. Person-card sessions retain at most 500 people across ten query pages.
13. Reviewed GitHub sync pins every reused or generated snapshot by asset ID until its retention expires.
14. Account export does not create a redundant storage object; it keyset-pages retained datasets, exports all selected messages, emits JSON incrementally and stops on cancellation.
15. Folder export pins verified assets, streams ZIP entries through the server with backpressure, terminates on missing content, rechecks authorization and is bounded to 20,000 entries and 1 GiB.
16. Expired deletion leases are reclaimed in bounded batches and fenced retries treat already-missing bytes as success.
17. Legacy update-media cleanup targets are recorded before domain detachment, survive cascades, and are claimed with fenced retries instead of trusting queue payloads.
18. Raw and explicitly unoptimized public-avatar consumers request bounded 64, 128 or 400-pixel variants; external, private and local preview URLs are never rewritten.
19. Metrics bypass the verbose application-log filter in production, while ordinary info/debug logs remain suppressed; storage workers emit finite batch counts and outcomes.
20. Upload admission serializes on a user row and optional project row, reserves declared bytes, transfers verified bytes to retained usage, and releases counters after safe deletion. Existing over-quota bytes stay readable.
21. Asset ownership and project scope remain on lifecycle tombstones after domain deletion, so cleanup and quota evidence survive cascades.
22. The unused CDN purge stub was removed because it reported success without contacting a provider.
23. CSP explicitly permits authorized HTTPS and blob media, blob PDF frames, public/transformed images and bundled/blob workers while keeping object embedding disabled.
24. Project covers and update media with mutable visibility use a five-minute public revalidation window; private responses remain no-store.
25. Project and chat PDF viewers point at authenticated application streams directly, allowing browser Range reads without cloning the full document into a Blob.
26. Git fallback reads are bound to the node's immutable blob SHA, use a ten-second deadline and cap both the JSON response and decoded inline bytes.
27. Contribution ordering uses a dedicated per-project counter row; batch events reserve one sequence range, so file activity no longer locks the full project settings row.
28. Queue metrics cap every database scan at 10,001 rows while preserving an overload signal; verification, backup, deletion, expired leases, legacy cleanup and repair failures report their oldest age.
29. Private streams reject mismatched provider lengths and ranges, then enforce the exact authorized byte count while streaming.
30. Browser roles cannot mutate nodes, versions or lifecycle tables directly; public node/version reads honor project state plus file/task tab visibility, and private buckets no longer expose direct read policies.
31. Existing update-media records are rewritten to the authorized application route before rendering, so making the bucket private does not break legacy posts.
32. Profile, cover and update images must pass a bounded Sharp decode with a 16-megapixel ceiling after full signature and digest verification.
33. Quota reconciliation includes empty stale counter rows and retains bytes/outstanding slots for terminal uploads until physical deletion finishes.
34. Profile source bytes remain private; only a server-decoded, sanitized derivative becomes public after full verification, with one quota charge transferred atomically between the two immutable assets.
35. File, historical-version and chat reads require an exact verified asset ID, bucket and key binding. A quarantined path cannot become readable merely because bytes later reappear at the same provider key.

## Validation completed

| Check | Result |
|---|---|
| TypeScript | Final `npm run typecheck` passed after the private-read binding changes |
| Lint | Final full-repository `npm run lint` passed |
| API response envelopes | Passed for all 83 route files |
| Storage-focused tests | Latest broad storage run: 168 passed, 0 failed across 11 suites |
| Private-read regression set | 93 passed, 0 failed after requiring exact verified asset ID, bucket and key bindings for message attachments, file previews and inline file reads |
| Extended storage-adjacent run | 195 passed; one pre-existing Project Updates UI contract failed on the `useDesktopUpdatesRail` source-name expectation |
| Migration source dry run | Passed |
| SQL governance | Passed with 177 governed migration files; journal parity and all migration-source validation also passed |
| Production build | Passed with build-only backup placeholders; without them it correctly fails closed on missing backup configuration |
| Full unit snapshot | 2,091 passed and 12 unrelated UI/source-contract failures across 2,103 tests; all previously identified storage-related failures are resolved |
| Disposable migration replay | Correctly refused to run because neither `DATABASE_URL_FRESH` nor `DATABASE_URL_REPLAY_FRESH` is configured; the primary database was not mutated |
| Connected migration deployment | Migrations 0178 and 0179 applied transactionally; PostgREST schema reload requested |
| Live migration lineage | Passed: 177 canonical tags and 7 legacy aliases |
| Live catalog/project-update checks | Passed |
| Live cross-project hardening | Passed |
| Storage data migration | 5,859 missing current versions repaired; 9,801 verified assets; zero incomplete current versions, cover gaps, update-media gaps, chat reference gaps or managed-avatar gaps |
| Explicit quarantine | 14 overwritten historical file revisions, 2,264 overwritten Git sync snapshots and eight missing provider chat objects; no placeholder bytes were fabricated |
| Quota reconciliation | Passed for 3 user scopes and 5 project scopes; no scope over limit |
| Current-key reconciliation | Three legacy current-version key mismatches were verified and repaired; idempotent dry run reports zero candidates |
| Browser verification | Discover recovered from the Redis timeout and rendered projects and people; DeepScope Docs rendered its README; DeepScope Files rendered 19 files without the reported missing-table or missing-column overlays |

The storage run covers lifecycle state behavior, immutable binding, retry classification, exact private Range streaming, quota reconciliation, SQL policy hardening, permanent-deletion transaction boundaries, extension recovery retention, account and folder exports, account cleanup evidence, quarantine reconciliation, chat routing, person-card bounds, GitHub sync, document media and SQL query contracts.

## External and environment gates

The following evidence cannot be produced from source changes alone and remains mandatory before the system is described as qualified:

- The deployed application/worker database credential must stop using the `postgres` superuser and pass the repaired runtime-role checker.
- Migrations 0178 and 0179 must replay in a disposable database and upgrade a production-shaped snapshot. They are already applied to the connected database.
- Independent AWS backup credentials and retention policy must be configured; backup and combined DB/object restore must finish within the stated RPO/RTO.
- Provider integration tests must exercise direct upload, TUS resume, storage throttling, ignored Range responses and object disappearance.
- The 1M-account/50M-reference workload, 24-hour soak, 2x overload, hot-project skew and reconnect storm must run with SQL, Auth, Realtime and workers enabled.
- The AWS S3/CloudFront comparison must use the same correctness, recovery, bandwidth and operating-cost contract.
- Canary rollout, rollback and named operational ownership remain release work.

Until those gates pass, the accurate status is: **designed for the stated one-million-user workload and awaiting production qualification**.

## Primary implementation anchors

- `drizzle/0178_storage_asset_lifecycle.sql`
- `drizzle/0179_live_catalog_storage_release_hardening.sql`
- `src/lib/upload/upload-intents.ts`
- `src/lib/upload/project-upload-allocation.ts`
- `src/lib/upload/supabase-signed-upload-client.ts`
- `src/lib/storage/bounded-object-read.ts`
- `src/lib/storage/private-object-response.ts`
- `src/lib/storage/asset-deletion.ts`
- `src/lib/storage/asset-backup.ts`
- `src/lib/storage/s3-backup-client.ts`
- `src/lib/storage/legacy-cleanup.ts`
- `src/lib/files/folder-export.ts`
- `src/lib/account/export-stream.ts`
- `src/lib/profile/avatar-variants.ts`
- `src/lib/files/permanent-delete.ts`
- `scripts/backfill-file-hashes.ts`
- `scripts/repair-missing-file-versions.ts`
- `scripts/repair-current-file-reference-drift.ts`
- `scripts/migrate-legacy-storage-assets.ts`
- `scripts/migrate-legacy-profile-images.ts`
- `scripts/audit-storage-migration.ts`
- `scripts/reconcile-storage-quotas.ts`
