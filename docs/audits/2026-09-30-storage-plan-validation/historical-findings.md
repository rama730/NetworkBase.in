# Historical finding disposition carried into the new plan

All 209 IDs from the earlier SQL/Supabase audit are retained below. The text is that report’s recorded disposition, not a new assertion of current correctness. Current evidence in the 30 September plan overrides conflicting historical claims. Each row must receive fresh code, deployed-catalog, behavioral-test or measurement evidence before it is closed.

Source: [Complete SQL/Supabase audit](../complete-sql-supabase-audit-2026-08-13.md), section 34. Later section 37 records live Realtime authorization completion; preserve that behavior and retest it.

| ID | Historical disposition | Revalidation phase |
|---|---|---|
| ORG-001 | **Repository-ready/live-blocked:** journal, manifest, ordering, and naming authority are exact; live Supabase/application registry reconciliation remains. | P01/P02 |
| ORG-002 | **External-blocked:** migrations `0153`–`0158` exist locally; immutable changeset review/commit remains outside this implementation run. | P01/P02 |
| ORG-003 | **Live-blocked:** forward migrations cover repository intent; partial unpublished live objects need environment reconciliation. | P01/P02 |
| ORG-004 | **Done:** future numeric prefixes must be unique and increasing; applied legacy duplicates remain frozen. | P01/P02 |
| ORG-005 | **Done:** future journal timestamps must be unique, monotonic, and nonfuture. | P01/P02 |
| ORG-006 | **Done:** governance validates exact membership, order, prefix, timestamp, name, quarantine, and size semantics. | P01/P02 |
| ORG-007 | **Repository-ready/replay-blocked:** `db:generate` is disposable-replay gated; catalog/snapshot parity awaits a replay database. | P01/P02 |
| ORG-008 | **Repository-ready:** `task_pushes` creation, indexes, and fail-closed RLS are in `0153`. | P01/P02 |
| ORG-009 | **Repository-ready:** `task_read_receipts` lineage, keys, index, and fail-closed RLS are in `0153`. | P01/P02 |
| ORG-010 | **Repository-ready/replay-blocked:** replay expectations derive from Drizzle schema with explicit exceptions. | P01/P02 |
| ORG-011 | **Done:** all three sprint-membership foreign keys have leading indexes. | P01/P02 |
| ORG-012 | **Done:** intentional server-only RLS tables are declared in the catalog allowlist. | P01/P02 |
| ORG-013 | **Done:** `db:push` is absent; only governed journaled migrations remain. | P01/P02 |
| ORG-014 | **Done:** standalone partition SQL was removed; one monthly Inngest worker owns maintenance. | P01/P02 |
| ORG-015 | **Done for future history:** new migrations over 1 MiB fail governance; immutable seed history is retained. | P01/P02 |
| ORG-016 | **Done:** message preview refresh delegates to the native PostgreSQL reconciliation owner. | P01/P02 |
| ORG-017 | **Environment-blocked:** `0152` is quarantined; deletion requires exact proof from every environment. | P01/P02 |
| ORG-018 | **Verified/ongoing:** domain owners remain explicit; no generic catch-all repository rewrite was introduced. | P01/P02 |
| ORG-019 | **Partial by design:** cached viewer context and per-route resolution counts exist; raw Auth/Storage clients remain where required and conversion stays touch-driven. | P01/P02 |
| ORG-020 | **Done:** project-follow fallback runs only for the exact historical missing-counter condition. | P01/P02 |
| ORG-021 | **Done:** verified dead compatibility exports and unused avatar wrappers were removed. | P01/P02 |
| ORG-022 | **Done:** one shared typing-user mapper is reused without merging distinct hooks. | P01/P02 |
| ORG-023 | **Verified:** Presence and typing remain intentionally separated under one room registry. | P01/P02 |
| ORG-024 | **Done:** approved direct browser RLS read owners are documented in an ADR. | P01/P02 |
| ORG-025 | **Done:** older SQL/Supabase audits are marked as historical snapshots. | P01/P02 |
| ORG-026 | **Done:** exact canonical bucket MIME sets are checked for drift. | P01/P02 |
| ORG-027 | **Repository-ready:** workflow seed target is qualified, search path is empty, and client execution is revoked. | P01/P02 |
| ORG-028 | **Done:** professional domain-and-intent naming is enforced for all new migrations. | P01/P02 |
| SUP-001 | **Live-blocked:** repository migration authority is exact; live registries still require reconciliation. | P02/P09/P10/P11 |
| SUP-002 | **Repository-ready:** both missing table lineages are supplied by `0153`. | P02/P09/P10/P11 |
| SUP-003 | **Done:** server-only fail-closed RLS decisions are explicit. | P02/P09/P10/P11 |
| SUP-004 | **Repository-ready/live-blocked:** new profile identities are protected by a `NOT VALID` Auth FK; orphan repair and validation remain live. | P02/P09/P10/P11 |
| SUP-005 | **Done:** signed account cleanup uses the admin client and recursively pages every current/legacy Storage domain. | P02/P09/P10/P11 |
| SUP-006 | **Done:** hard-delete phase two resumes safely from `in_progress`. | P02/P09/P10/P11 |
| SUP-007 | **Done:** unused plaintext tokens are removed and completed deletion rows are pseudonymized. | P02/P09/P10/P11 |
| SUP-008 | **Done:** Storage failures propagate for retry and retry references are preserved. | P02/P09/P10/P11 |
| SUP-009 | **Done:** account cleanup pages avatars, attachments, project files, legacy paths, task files, covers, and update media. | P02/P09/P10/P11 |
| SUP-010 | **Repository-ready/live-blocked:** legacy `task-files` rejects viewer writes; object migration/bucket retirement remain live. | P02/P09/P10/P11 |
| SUP-011 | **Done:** dead `project_nodes` Realtime ownership was removed for bounded authoritative reconciliation. | P02/P09/P10/P11 |
| SUP-012 | **Done:** private Presence/project-stat channels install the authenticated Realtime token before subscribing. Forward migration `0160` is applied live and supplies extension-scoped SELECT/INSERT policies for user, conversation, task, and project-stat topics. The live authorization matrix allows self/shared peers and conversations while denying an unrelated user. | P02/P09/P10/P11 |
| SUP-013 | **Done:** remaining Changes bindings are task/project filtered rather than workspace-wide. | P02/P09/P10/P11 |
| SUP-014 | **Done:** the browser no longer overrides Supabase's native Auth lock. | P02/P09/P10/P11 |
| SUP-015 | **Done:** read traffic never manufactures port 6544; primary connection configuration is reused. | P02/P09/P10/P11 |
| SUP-016 | **Done:** the three sprint-membership FK indexes are in `0153`. | P02/P09/P10/P11 |
| SUP-017 | **Repository-ready:** repeated Auth policy evaluation is consolidated in `0154`. | P02/P09/P10/P11 |
| SUP-018 | **Repository-ready:** contribution/stage permissive SELECT policies are consolidated. | P02/P09/P10/P11 |
| SUP-019 | **Repository-ready:** only the proven redundant DM-pair index is removed. | P02/P09/P10/P11 |
| SUP-020 | **Repository-ready:** workflow function search path and execution privileges are hardened. | P02/P09/P10/P11 |
| SUP-021 | **Partial/external:** application password checks exist; the native leaked-password Auth dashboard toggle still needs live enablement. | P02/P09/P10/P11 |
| SUP-022 | **Repository-ready/live-blocked:** one monthly single-concurrency partition worker is registered; deployment heartbeat remains. | P02/P09/P10/P11 |
| SUP-023 | **Repository-ready/live-blocked:** bounded retention worker and indexes exist; rollout heartbeat and product/legal periods remain. | P02/P09/P10/P11 |
| SUP-024 | **External-blocked:** backup/restore runbook exists; off-site export and restore-drill artifacts do not. | P02/P09/P10/P11 |
| SUP-025 | **Repository-ready/external:** least-privilege runtime-role and release gates exist; role provisioning and credential rotation remain. | P02/P09/P10/P11 |
| SUP-026 | **External-blocked:** capacity claims require real staged load, plan, and approval evidence. | P02/P09/P10/P11 |
| SUP-027 | **Repository-ready:** private archive receives fail-closed RLS. | P02/P09/P10/P11 |
| SUP-028 | **Repository-ready:** profile counters have one authority and the legacy projection table is removed by `0156`. | P02/P09/P10/P11 |
| SUP-029 | **Verified:** no unsafe mass unused-index deletion was performed. | P02/P09/P10/P11 |
| QRY-001 | **Done:** Hub forwards normalized `includedIds` to the canonical feed. | P03–P11 |
| QRY-002 | **Done:** malformed, wrong-kind, foreign-fingerprint, and missing-snapshot cursors return the invalid-cursor path. | P03–P11 |
| QRY-003 | **Done:** direct Hub branches fetch `pageSize + 1`, slice, and derive `hasMore` from the extra row. | P03–P11 |
| QRY-004 | **Done:** snapshot pagination consumes later IDs until the page is full or the snapshot ends. | P03–P11 |
| QRY-005 | **Measurement-dependent:** representative one/four/eight-term `EXPLAIN (ANALYZE, BUFFERS)` is required before consolidating search expressions. | P03–P11 |
| QRY-006 | **Done:** the dead project data query module and production imports are removed. | P03–P11 |
| QRY-007 | **Done:** matchmaking authenticates and verifies owner/admin access before reading a narrow candidate projection. | P03–P11 |
| QRY-008 | **Done:** failed file reads throw `FileContentUnavailableError`; fabricated empty content is impossible. | P03–P11 |
| QRY-009 | **Done:** the signed-read owner validates and signs only; it does not upload or mutate database state. | P03–P11 |
| QRY-010 | **Done:** bounded node projection contains the signing key; repeated project/path reads are gone. | P03–P11 |
| QRY-011 | **Done:** federated search authorizes once and delegates to a private already-authorized helper. | P03–P11 |
| QRY-012 | **Done:** indexed search joins authoritative same-project active nodes and excludes soft deletion. | P03–P11 |
| QRY-013 | **Done by retirement:** the unused divergent search/replace preview owner was removed. | P03–P11 |
| QRY-014 | **Done by retirement:** the unused nondeterministic preview cap was removed. | P03–P11 |
| QRY-015 | **Done by retirement:** the unused per-file lease/statement loop was removed. | P03–P11 |
| QRY-016 | **Done by retirement:** the unsafe compensating Storage mutation owner was removed; active writes use the canonical revision owner. | P03–P11 |
| QRY-017 | **Done:** the mismatched flat-tree count/select owner was removed. | P03–P11 |
| QRY-018 | **Done:** full-tree bootstrap is removed; root page size is 100 with lazy folder expansion. | P03–P11 |
| QRY-019 | **Verified bounded/measurement-dependent:** per-parent fairness remains capped; replace only if observed p95/DB duration justifies a window query. | P03–P11 |
| QRY-020 | **Done:** materialized-path/one-query ancestor resolution replaces sequential breadcrumb reads. | P03–P11 |
| QRY-021 | **Done:** normal paths use one indexed equality lookup; exact task compatibility is isolated. | P03–P11 |
| QRY-022 | **Done:** task-title/file-slug scans are retired and current URLs use opaque file IDs. | P03–P11 |
| QRY-023 | **Done:** batch/ID reads enforce active project scope and explicit task/system exclusions. | P03–P11 |
| QRY-024 | **Done:** reconciliation persists a `(projectId,nodeId)` keyset cursor and wraps only at exhaustion. | P03–P11 |
| QRY-025 | **Done:** stale import updates preserve status and cutoff/version predicates. | P03–P11 |
| QRY-026 | **Done:** signed background cleanup uses the admin client. | P03–P11 |
| QRY-027 | **Done:** database records and Storage prefixes are recursively paged/deleted in bounded batches. | P03–P11 |
| QRY-028 | **Done:** the dead document cleanup worker, registry entry, and event are removed. | P03–P11 |
| QRY-029 | **Done:** hard-delete scheduling is ordered and capped at 100. | P03–P11 |
| QRY-030 | **Done:** file-hash backfill is keyset ordered and advances past run-local failures. | P03–P11 |
| QRY-031 | **Repository done/live execution not claimed:** legacy backfill is explicit `--apply`, set-based, transactional, and cycle guarded. | P03–P11 |
| QRY-032 | **Repository done/live execution not claimed:** task-file migration uses deterministic destinations, idempotent copy, locked transactional metadata, and orphan cleanup. | P03–P11 |
| QRY-033 | **Repository done/live execution not claimed:** replacement unique indexes are built concurrently, validated, and atomically swapped without a protection gap. | P03–P11 |
| QRY-034 | **Repository-ready/live-blocked:** scalar Auth subselect policies are in `0154`; Advisor verification remains. | P03–P11 |
| QRY-035 | **Repository-ready/live-blocked:** redundant DM index removal is in `0154`; live dependency verification remains. | P03–P11 |
| QRY-036 | **External-blocked:** readiness gates exist, but representative load/capacity/plan approval is still required. | P03–P11 |
| QRY-037 | **Done:** collision preflight clamps input and traverses only submitted sibling/ancestor chains. | P03–P11 |
| QRY-038 | **Done:** GitHub changes/deletions use bounded set-based batches with bounded progress writes. | P03–P11 |
| QRY-039 | **Done:** Git Storage uses bounded concurrency and persists only confirmed uploads. | P03–P11 |
| QRY-040 | **Done:** expired upload cleanup claims locked batches and retries failed Storage deletions. | P03–P11 |
| QRY-041 | **Done:** integrations aggregates use native database count/max projections. | P03–P11 |
| QRY-042 | **Done:** the unused purge owner is removed. | P03–P11 |
| QRY-043 | **Done:** block/unblock invalidates blocked-pair, connection, inbox, and discovery projections. | P03–P11 |
| QRY-044 | **Done:** bulk decisions condition on pending state/party and counters derive from returned transitions. | P03–P11 |
| QRY-045 | **Done:** connection pairs are serialized with a canonical advisory transaction lock. | P03–P11 |
| QRY-046 | **Done:** pending application capacity and insert share a user-scoped serialization boundary. | P03–P11 |
| QRY-047 | **Done:** comments and mention projections commit atomically; notifications follow commit. | P03–P11 |
| QRY-048 | **Done:** reply creation/deletion share parent advisory locking. | P03–P11 |
| QRY-049 | **Done:** replies are capped previews with totals and `hasMore`. | P03–P11 |
| QRY-050 | **Done:** workspace projects, sprints, joins, and application reads are bounded/keyset-paginated. | P03–P11 |
| QRY-051 | **Done:** Redis misses fall back to bounded indexed social-proof reads and repopulation. | P03–P11 |
| QRY-052 | **Done:** accepted/removed pairs update existing Redis sets incrementally; cold sets remain unknown for database fallback. | P03–P11 |
| QRY-053 | **Done:** task subtasks/files/comments/receipt counts use grouped CTE aggregates. | P03–P11 |
| QRY-054 | **Done:** finalization consistently excludes soft-deleted tasks. | P03–P11 |
| QRY-055 | **Done:** shared task/comment field limits and unique mention caps are enforced at trust boundaries. | P03–P11 |
| QRY-056 | **Done:** subtasks are stably bounded and followed projects are scoped to the visible page. | P03–P11 |
| QRY-057 | **Done:** collaborator/open-role previews have stable order, totals, cursors, and `hasMore`. | P03–P11 |
| QRY-058 | **Done:** bounded invite selection excludes pending applications and unexpired invitations in SQL. | P03–P11 |
| QRY-059 | **Done:** unified history maintains independent source cursors, so older application events remain reachable. | P03–P11 |
| QRY-060 | **Done:** the weaker Supabase lifecycle mutation was replaced with Drizzle optimistic concurrency. | P03–P11 |
| QRY-061 | **Done:** project update access reuses one project snapshot. | P03–P11 |
| QRY-062 | **Done:** cache-only relationship state no longer exposes synthetic persistent IDs. | P03–P11 |
| QRY-063 | **Done:** hydration errors use bounded retry rather than false completion. | P03–P11 |
| QRY-064 | **Done:** extension root nodes use per-project window ranking/caps. | P03–P11 |
| QRY-065 | **Done:** project/profile selectors use narrow search/keyset pagination. | P03–P11 |
| QRY-066 | **Done:** one durable worker resumes due snoozed/quiet-hours push delivery. | P03–P11 |
| QRY-067 | **Done:** aggregate upserts preserve explicit future snoozes. | P03–P11 |
| QRY-068 | **Done:** delivery increments failures, resets success state, and retention uses failure counts. | P03–P11 |
| QRY-069 | **Done:** push delivery occurs only from committed durable notification state. | P03–P11 |
| QRY-070 | **Done:** preferences are batched and fanout/delivery runs in bounded chunks. | P03–P11 |
| QRY-071 | **Measurement-dependent:** representative unseen-badge plans are required before adding a partial index. | P03–P11 |
| QRY-072 | **Done:** redaction is participant/key bounded, returns no unused rows, and does not mutate activity ordering. | P03–P11 |
| QRY-073 | **Done:** notification cursors require UUID IDs and reject nonfinite limits. | P03–P11 |
| QRY-074 | **Done:** attachment object paths are durable before signing can fail. | P03–P11 |
| QRY-075 | **Done:** only fresh `uploaded` sessions can be claimed; committed IDs cannot be reused. | P03–P11 |
| QRY-076 | **Done:** structured sends use idempotent client identities and nonfatal post-commit work. | P03–P11 |
| QRY-077 | **Done:** structured sends share ordinary burst notification behavior. | P03–P11 |
| QRY-078 | **Done:** redundant participant-by-participant preview refresh is removed. | P03–P11 |
| QRY-079 | **Done:** project summaries batch metadata/hydration rather than invoking N helpers. | P03–P11 |
| QRY-080 | **Done:** global message attention uses the canonical summary batch API. | P03–P11 |
| QRY-081 | **Done:** thread hydration reuses one authorization scope and concurrent private reads. | P03–P11 |
| QRY-082 | **Done:** latest applications use database window ranking instead of full-history JavaScript dedupe. | P03–P11 |
| QRY-083 | **Measurement-dependent:** representative production search plans are required before altering trigram/filename indexes. | P03–P11 |
| QRY-084 | **Done:** each uploader's latest row is selected first, then editors are ordered by recency. | P03–P11 |
| QRY-085 | **Done:** task-file notifications reuse one project/actor/member context and batched events. | P03–P11 |
| QRY-086 | **Done:** workflow/task post-commit projections are idempotent and nonfatal. | P03–P11 |
| QRY-087 | **Done:** logout deletes the authenticated push record before local/Auth teardown. | P03–P11 |
| QRY-088 | **Done:** private channels use Auth-derived identity, authenticated startup, invalidation-only Broadcast, and live Realtime RLS. Custom reconnect ownership and generic-avatar channel fanout were removed; user-room observers cannot publish into a peer's room. | P03–P11 |
| QRY-089 | **Done:** heartbeat debounce is recorded only after successful or known-fresh persistence. | P03–P11 |
| QRY-090 | **Done:** reaction reads/writes reuse hidden-message accessibility. | P03–P11 |
| QRY-091 | **Done:** verified dead messaging helpers, imports, and in-flight state are removed. | P03–P11 |
| EGR-001 | **Done:** historical chat videos render intent-only thumbnails; no autoplay/loop. | P05/P06/P07/P11 |
| EGR-002 | **Done:** the viewer loads only current media; adjacent items remain thumbnails. | P05/P06/P07/P11 |
| EGR-003 | **Done:** attachment signed URLs are reused and Range/conditional behavior is preserved. | P05/P06/P07/P11 |
| EGR-004 | **Historical/live-blocked:** July route/object attribution cannot be reconstructed from the current capped logs. | P05/P06/P07/P11 |
| EGR-005 | **Done:** conversation hover no longer fetches a 30-message thread. | P05/P06/P07/P11 |
| EGR-006 | **Done:** PDFs stream through the stable route and avoid blob cloning/cache defeat. | P05/P06/P07/P11 |
| EGR-007 | **Done:** file signed URLs are retained with expiry in the file store. | P05/P06/P07/P11 |
| EGR-008 | **Done:** Files tree entry is cursor-paged rather than serializing 2,500 nodes. | P05/P06/P07/P11 |
| EGR-009 | **Done:** extension large-file reads use signed Range transfer. | P05/P06/P07/P11 |
| EGR-010 | **Done:** project cover URLs are versioned with ETag and authenticated/public cache behavior. | P05/P06/P07/P11 |
| EGR-011 | **Done:** document assets use versioned ETags, conditional responses, and private browser caching. | P05/P06/P07/P11 |
| EGR-012 | **Done:** update media uses ETags and a 12-minute private redirect cache inside signed validity. | P05/P06/P07/P11 |
| EGR-013 | **Done:** avatar uploads use shared off-main-thread compression and immutable metadata. | P05/P06/P07/P11 |
| EGR-014 | **Done:** public profile metadata/body share one request-cached loader. | P05/P06/P07/P11 |
| EGR-015 | **Done:** owner profile metadata/body share one cached projection. | P05/P06/P07/P11 |
| EGR-016 | **Done:** followed-project lookup is restricted to deduplicated visible project IDs. | P05/P06/P07/P11 |
| EGR-017 | **Done:** three-second integrations polling is removed; focus/mutation reconciliation remains. | P05/P06/P07/P11 |
| EGR-018 | **Done:** signed-in layout passes its server profile into the Auth provider. | P05/P06/P07/P11 |
| EGR-019 | **Done:** onboarding telemetry is bounded and committed with step boundaries rather than hot-path requests. | P05/P06/P07/P11 |
| EGR-020 | **Verified intentional:** account export remains explicit and intentionally unbounded. | P05/P06/P07/P11 |
| EGR-021 | **Repository-ready/external:** strict capacity evidence now requires Supabase bytes, cache, rooms, signed-URL reuse, and attribution fields. | P05/P06/P07/P11 |
| RES-001 | **Repository done/live repair pending:** missing file content is terminal and can no longer be overwritten with fabricated empty bytes. | P03/P08/P09/P10 |
| RES-002 | **Repository-ready/live run pending:** path-correlated disconnected objects have a bounded reconciliation owner and are not treated as safe orphans. | P03/P08/P09/P10 |
| RES-003 | **Done:** reconciliation has durable keyset progress, mutually exclusive categories, metadata verification, and idempotent behavior. | P03/P08/P09/P10 |
| RES-004 | **Repository owner verified/live backlog pending:** attachment retention uses locked bounded batches. | P03/P08/P09/P10 |
| RES-005 | **Repository UX/finalization done/live repair pending:** missing message media is terminal and finalization confirms object existence. | P03/P08/P09/P10 |
| RES-006 | **Done:** deletion ownership covers all current and legacy Storage domains. | P03/P08/P09/P10 |
| RES-007 | **Done:** upload-intent cleanup has a scheduled, bounded, retryable owner. | P03/P08/P09/P10 |
| RES-008 | **External-blocked:** historical embedded-URL/reference verification is required before candidate deletion. | P03/P08/P09/P10 |
| RES-009 | **Repository-ready/live-blocked:** legacy bucket policy/cleanup are aligned; the remaining object and bucket retirement need live proof. | P03/P08/P09/P10 |
| RES-010 | **Safety complete/decision pending:** no ETag-only deletion was introduced; wider canonical-body dedupe needs body-hash evidence. | P03/P08/P09/P10 |
| RES-011 | **Repository done/live cleanup pending:** avatar preparation and superseded-object cleanup are unified; historical stale objects require verification. | P03/P08/P09/P10 |
| RES-012 | **Done:** unavailable image transforms are capability-gated. | P03/P08/P09/P10 |
| RES-013 | **Done:** eligible chat PNGs convert to WebP and pass a bounded size loop. | P03/P08/P09/P10 |
| RES-014 | **Done:** immutable objects use one-year cache metadata; mutable file writers use explicit revalidation profiles. | P03/P08/P09/P10 |
| RES-015 | **Done:** finalization uses object metadata and only a 32-byte Range probe, never a whole download. | P03/P08/P09/P10 |
| RES-016 | **Done:** project application and upload security share a 10 MiB hard contract. | P03/P08/P09/P10 |
| RES-017 | **Repository-ready/live-blocked:** update-media bucket limit is corrected to 8 MiB in `0157`. | P03/P08/P09/P10 |
| RES-018 | **Repository-ready/live rollout pending:** bounded read/activity retention and supporting indexes exist. | P03/P08/P09/P10 |
| RES-019 | **Repository-ready/live rollout pending:** monthly future partitions and DEFAULT-row monitoring have one worker. | P03/P08/P09/P10 |
| RES-020 | **Repository-ready/external:** capacity evidence requires owner/project concentration and soft-budget baselines. | P03/P08/P09/P10 |
| RES-021 | **Repository-ready/live-blocked:** canonical and legacy Storage path grammar are aligned in `0157`. | P03/P08/P09/P10 |
| RES-022 | **Verified:** database bloat is not treated as the quota problem; no broad `VACUUM FULL` was added. | P03/P08/P09/P10 |
| RES-023 | **Verified:** recovery-draft lifecycle remains bounded and retry-safe. | P03/P08/P09/P10 |
| CAP-001 | **Operational/live-blocked:** repository budgets exist; current quota attribution and restriction handling require dashboard evidence. | P10/P11/P12 |
| CAP-002 | **Done:** Presence is message/popup scoped and hidden/idle tabs pause or release rooms. | P10/P11/P12 |
| CAP-003 | **Done:** native Supabase Auth locking owns multi-tab serialization. | P10/P11/P12 |
| CAP-004 | **Partial by design:** cached viewer context is reused and privacy-safe per-route auth-resolution counts exist; migration remains incremental. | P10/P11/P12 |
| CAP-005 | **Done:** custom application reconnect loops are removed; native Supabase reconnect owns recovery. | P10/P11/P12 |
| CAP-006 | **Done:** project-files channel cleanup uses `removeChannel`, preventing retained replacement channels. | P10/P11/P12 |
| CAP-007 | **Done:** remaining Changes subscriptions are project/task filtered. | P10/P11/P12 |
| CAP-008 | **Done:** dead `project_nodes` listeners are removed. | P10/P11/P12 |
| CAP-009 | **Done:** private Presence/Broadcast authorization is active through live migration `0160`; exact topic grammars and extension checks are enforced and the positive/negative SQL authorization matrix passes. | P10/P11/P12 |
| CAP-010 | **Repository-ready/external:** hidden rooms release and capacity schema requires measured peak rooms per tab. | P10/P11/P12 |
| CAP-011 | **Done:** hydration is Realtime-first with a 30-second missed-progress threshold and 15-second fallback. | P10/P11/P12 |
| CAP-012 | **Done:** no port-6544 rewrite or duplicate inferred pool remains. | P10/P11/P12 |
| CAP-013 | **Repository done/execution external:** the load suite opens real private WebSockets; credentials and k6 results remain. | P10/P11/P12 |
| CAP-014 | **Repository-ready/live evidence pending:** quota/cache/channel/room/signed-URL/forecast/concentration alerts are required by the strict contract. | P10/P11/P12 |
| CAP-015 | **Done:** push server cleanup precedes Auth signout and preserves retryability. | P10/P11/P12 |
| CAP-016 | **Verified baseline:** present Auth/Realtime counters are safe but not scale proof. | P10/P11/P12 |
| CAP-017 | **Verified:** singleton clients, shared rooms, task registry, throttles, coalescing, and native ownership remain the canonical controls. | P10/P11/P12 |

## Explicit current overrides

- RES-015: a Range request alone does not bound a response if the origin ignores Range; the current verifier still needs a byte cap and timeout.
- EGR-006/EGR-007/EGR-012: all current PDF consumers, private URL caches and redirects must satisfy the new five-minute revocation contract.
- RES-003/RES-006/RES-007: bounded workers still have coverage, throughput, reference and lifecycle gaps; a heartbeat is insufficient.
- QRY-075: attachment presign/reset/finalize routes must be tested together with message commit, including direct Data API writes.
- RES-023: recovery retention bounds are retained, but direct lifecycle mutation and finalized-draft read handling require revalidation.
- EGR-020: account export is explicitly bounded and streamed in the replacement plan; an unbounded full-history JSON allocation is not accepted.
- SUP-018: the live advisor still reports overlapping contribution policies. Repository remediation is not proof of live deployment.
- SUP-021: the live Auth advisor still reports leaked-password protection disabled.
