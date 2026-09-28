# NetworkBase Speed Audit Implementation Plan

> **Implementation status (2026-09-28):** see `docs/audits/performance-implementation-2026-09-28.md` for what was done, measured results, deferred items with reasons, and the production checklist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every finding in the NetworkBase Speed Audit (https://claude.ai/artifact/2dXeSPoBT9eaoQ4E19nYcj), including the Docs database migration and deploying main before any database object is dropped.

**Architecture:** Work on local `main` in 11 phases ordered by dependency and risk: checkpoint → deploy main → finish Docs → config → proxy → database → routes → server rendering → client → dead code → workflow → re-measure. Every database DROP/RENAME waits until the code that no longer needs the object is live (P1).

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Drizzle ORM + postgres.js, Supabase (Postgres 17, Auth, Storage, Realtime), Upstash Redis, Inngest, Railway, Tailwind v4.

**Coverage:** 356 of 356 report items mapped to exactly one task (47 tasks). Missing: 0. Duplicates: 0. Checked by `plan_data.check_coverage()`.

**Standard gates** (run before every commit unless a task says otherwise): `npm run typecheck && npm run lint && npm run test:unit && npm run build`. The unit suite has 44 failures that predate this plan; a task passes when it adds no new failure.

---

## Phases

| Phase | Name | Why this order | Tasks |
|---|---|---|---|
| P0 | Checkpoint and baseline | Lock in the work already applied to main and record the numbers every later phase is compared against. | T0.1, T0.2 |
| P1 | Deploy main to production | Production runs `codex/railway-production`. Nothing below reaches users, and no database object may be dropped, until main is live and verified. | T1.1, T1.2 |
| P2 | Finish the Docs tab | Only after P1 is verified: drop the Docs storage the new code no longer uses, remove the leftover secret, cut the Docs round trips. | T2.1, T2.2, T2.3 |
| P3 | Infrastructure and configuration | Region, Redis, health checks, caching headers, Tailwind scan scope and other config-level fixes. | T3.1, T3.2, T3.3, T3.4, T3.5 |
| P4 | Middleware / proxy | One proxy file with CSP + CSRF + auth, no DB calls, correct matcher. | T4.1, T4.2 |
| P5 | Database and SQL | Realtime, pooling, indexes, cron queries, RLS, naming, unused objects, partitions, query shape. | T5.1, T5.2, T5.3, T5.4, T5.5, T5.6, T5.7, T5.8, T5.9, T5.10 |
| P6 | Routes and renames | One name per page (Discover, Network, My profile), no duplicate or hidden routes. | T6.1, T6.2, T6.3 |
| P7 | Server rendering and data flow | Static where possible, parallel reads, fewer queued server actions. | T7.1, T7.2, T7.3, T7.4, T7.5, T7.6 |
| P8 | Client, React and bundle | Smaller root bundle, CSS, icons, components, timers, caching behaviour. | T8.1, T8.2, T8.3, T8.4, T8.5, T8.6 |
| P9 | Dead code, dependencies and repo | Remaining Ponytail cuts: packages, flags, telemetry, scripts, clutter, conventions. | T9.1, T9.2, T9.3, T9.4, T9.5 |
| P10 | Claude skill set and workflow | One skill per job; the plan's own execution loop. | T10.1 |
| P11 | Final verification | Re-measure everything, re-run the round-trip trace, close the debt ledger. | T11.1, T11.2 |


## P0 — Checkpoint and baseline

Lock in the work already applied to main and record the numbers every later phase is compared against.


### Task T0.1: Commit the cleanup already applied to main

**Files:**
- `src/** and tests/** (working tree)`

**Report items covered:**
- **DEAD-01** [P2] 53 unreachable source files (6,060 lines) + 7 tests that only cover them (411) _(status: done)_ — Fix: Delete after one `tsc --noEmit` + build. Add `knip` to CI to stop regrowth.
- **PT-04** [P2] 53 unreachable source files _(status: done)_ — Fix: Delete.
- **DEAD-07** [P2] 159 unused exported functions/constants + 37 unused types in live files _(status: done)_ — Fix: Delete, with the tests that only exercise them. Check the emitters first (see RSC-10).
- **DOC-01** [P2] Real-time co-editing leftovers _(status: done)_ — Fix: Removed on main (A).
- **DOC-02** [P2] Doc image uploads _(status: done)_ — Fix: Code removed on main (A); table drop pending.
- **DOC-03** [P2] Write-only drafts _(status: done)_ — Fix: Writes and Drizzle columns removed on main (A); column/table drop pending.
- **DOC-04** [P2] Quick Console and doc helpers _(status: done)_ — Fix: Removed on main (A).
- **DOC-05** [P2] “Notify on publish” toggle _(status: done)_ — Fix: Toggle and both settings removed on main (A); DB default cleanup pending.
- **DOC-06** [P2] Dead doc-edit layout mode _(status: done)_ — Fix: Removed on main (A).
- **DOC-07** [P2] 4 unused doc server actions _(status: done)_ — Fix: Removed on main (A).
- **Ledger:** Dead source files (unreachable from any route, layout, proxy, worker or kept script) (53 files, 6,060 lines, app)
- **Ledger:** Tests that only cover those dead files (7 files, 411 lines, app)

**Steps:**
- [ ] **Step 1:** Review the applied diff: `git diff --stat` (A: Docs cleanup, B: unreachable files, C: unused exports; −11,742 / +62).
- [ ] **Step 2:** Run the gates on main: `npm run typecheck && npm run lint && npm run test:unit && npm run build`. Expected: typecheck 0 errors, unit suite 44 failures that already failed before (no new failures).
- [ ] **Step 3:** Commit your pre-existing ~750 working-tree changes separately from the cleanup so history stays reviewable: stage your own files first, commit, then commit the cleanup.
```bash
git add -A src tests && git commit -m "chore: ponytail cleanup (docs tab, unreachable files, unused exports)"
```
- [ ] **Step 5:** Keep the safety net until P1 is verified: `refs/backups/pre-ponytail-docs-2026-09-27` and the untracked-files tarball.
- [ ] **Verify:** `git status` clean for src/ and tests/; gates green as above.
- [ ] **Commit:** `git commit -m "chore: ponytail cleanup (docs tab, unreachable files, unused exports)"`

### Task T0.2: Record the baseline

**Files:**
- `docs/superpowers/plans/tools/roundtrips.cjs`
- `docs/superpowers/plans/tools/surfaces.py`

**Report items covered:**
- **Measure:** Railway web, 7 days — baseline p50 6–168 ms · p90 161–2,044 ms · p95 up to 2,882 ms · p99 up to 3,948 ms
- **Measure:** Status mix, 7 days — baseline 2xx 1,920 · 3xx 400 · 4xx 1,594 · 5xx 0 (3,914 requests)
- **Measure:** Web memory / CPU — baseline 252–299 MB of 1 GB, flat (no leak) · CPU ≈ 0 of 2 vCPU
- **Measure:** Worker memory / CPU — baseline 140–162 MB · CPU ≈ 0.2%
- **Measure:** GET / (anon) — baseline 307 → /login, TTFB 618–842 ms
- **Measure:** GET /login — baseline TTFB 777 ms (server 562 ms) · DCL 1.30 s · load 2.38 s · 18 JS 295 KB br / 1,000 KB decoded · CSS 53 KB br / 371 KB · CLS 0 · long tasks 0
- **Measure:** GET /terms — baseline TTFB 353 ms · DCL 583 ms · load 752 ms · 15 JS / 735 KB decoded · 72 KB HTML + 43 KB RSC · no-store
- **Measure:** GET /api/v1/live — baseline TTFB 622–739 ms (no DB) — edge→Amsterdam hop
- **Measure:** GET /api/v1/health — baseline TTFB 885–2,107 ms (DB check)
- **Measure:** Protocol / compression — baseline HTTP/2 (Cloudflare) · Brotli · static assets immutable 1 y
- **Measure:** DB connections — baseline 28 open / 60 max (18 idle)
- **Measure:** Realtime publication — baseline 21 tables; 16 subscribed in code; 5 unsubscribed
- **Extreme:** Most total DB time — Realtime `list_changes` WAL poll — 89,757 s cumulative, 18.6 M calls (DB-01)
- **Extreme:** Slowest app SQL (mean) — `project_nodes` reconciliation `(project_id,id) IN …` — 723 ms mean, 2.4 s max (DB-03)
- **Extreme:** Slowest SQL overall (mean) — PostgREST `pg_timezone_names` — 513 ms mean, 3.5 s max (DB-06)
- **Extreme:** Slowest single statement — Realtime WAL poll — 10.0 s max
- **Extreme:** Slowest endpoint measured — `/api/v1/health` — up to 2.1 s TTFB
- **Extreme:** Longest component — `ProjectSettingsTab.tsx` — 5,640 lines, one client component (FE-05)
- **Extreme:** Largest source file — `generated-client-catalog.ts` — 22,473 lines / 372 KB, reaches client (FE-03)
- **Extreme:** Heaviest route (client JS) — `/hub` — 1,675 KB raw across 44 chunks (manifest upper bound)
- **Extreme:** Largest table scan — `project_nodes` — 715 M rows read via 33,163 seq scans (DB-03)
- **Measurement gap:** INP, TBT, TTI, hydration time, re-render counts and component mount times on signed-in routes (/workspace, /projects/[slug], /messages) were not measured: that needs a signed-in session, and I do not enter passwords. Sign in inside the app's browser pane and I can take these with the Performance API and React Profiler.
- **Measurement gap:** FCP/LCP paint entries were empty because the browser pane was hidden during the lab run; TTFB/DCL/load and transfer sizes above are real. Speed Index needs a Lighthouse run.
- **Measurement gap:** Per-route JS sizes come from the Sep 23 local build's client-reference manifests (upper bound: they include lazily loaded chunks).
- **Measurement gap:** `pg_stat_statements` totals are cumulative since the last stats reset, not a fixed window.
- **Measurement gap:** No destructive change was made: no files deleted, no SQL run except read-only stats queries.

**Steps:**
- [ ] **Step 1:** Production timings (repeat 3×): `for u in / /login /terms /api/v1/live /api/v1/health; do curl -s -o /dev/null -w "$u %{time_starttransfer}\n" https://networkbase.in$u; done`.
- [ ] **Step 2:** Railway 7-day p50/p90/p99, status mix, memory and CPU (Railway dashboard or MCP `http-response-time`, `http-requests`, `get-service-metrics`).
- [ ] **Step 3:** Supabase: `select stats_reset from pg_stat_statements_info;` then save the top 45 by total time and by calls. Do not reset yet (reset happens in T5.1).
- [ ] **Step 4:** Signed-in Web Vitals (closes the measurement gaps): sign in on a desktop browser, open /workspace, /projects/<slug> (every tab) and /messages, record INP, TBT, LCP, CLS, hydration time from DevTools Performance and React Profiler (render counts, mount times). Run `npm run build` to refresh per-route JS sizes.
- [ ] **Step 5:** Round-trip baseline: `node docs/superpowers/plans/tools/roundtrips.cjs . /tmp/rt.json && python3 docs/superpowers/plans/tools/surfaces.py /tmp/rt.json /tmp`.
- [ ] **Verify:** A baseline file with every number above exists (paste into the audit report measurements).
- [ ] **Commit:** `git commit -m "docs: record performance baseline"`

## P1 — Deploy main to production

Production runs `codex/railway-production`. Nothing below reaches users, and no database object may be dropped, until main is live and verified.


### Task T1.1: Make main the production branch (deploy before dropping anything)

**Files:**
- `railway.toml`
- `Railway service settings (networkbase-web, networkbase-worker)`

**Report items covered:**
- **INF-06** [P2] Production deploys a different branch than local `main` — Fix: Commit the working tree, then deploy from one branch (`main`) through one pipeline so audit findings map 1:1 to what runs.
- **Pending · Deploy:** Production still runs codex/railway-production (INF-06). None of the savings reach users until main is deployed.

**Steps:**
- [ ] **Step 1:** Gates on main: `npm run typecheck && npm run lint && npm run test:unit && npm run build`.
- [ ] **Step 2:** Diff what production has that main does not: `git fetch origin codex/railway-production && git log --oneline main..origin/codex/railway-production`. Port any production-only fix into main first; do not lose it.
- [ ] **Step 3:** Point both Railway services at `main` (Service → Settings → Source → Branch). Keep `codex/railway-production` untouched as the rollback target.
- [ ] **Step 4:** Deploy. Rollback = switch the branch back and redeploy.
- [ ] **Step 5:** Rule for every later phase: never run a DROP or RENAME against production until the code that no longer needs the old object is live and verified.
- [ ] **Verify:** `curl -sI https://networkbase.in/terms` succeeds; Railway deployment shows the main commit; `/discover` returns 200 for a signed-in user; error rate stays 0% 5xx for 24 h (canary).
- [ ] **Commit:** (deploy, no commit)

### Task T1.2: Move web and worker next to the database

**Files:**
- `Railway multiRegionConfig for networkbase-web and networkbase-worker`

**Report items covered:**
- **INF-01** [P0] Web origin runs in Amsterdam; edge, DB and Auth are in Singapore — Fix: Move `networkbase-web` and `networkbase-worker` to Railway `asia-southeast1` (Singapore), same as Supabase. Keep 1 replica. Expected: −150 to −300 ms per request, and −160 ms for each sequential query in a waterfall.

**Steps:**
- [ ] **Step 1:** Change region `ams` → `asia-southeast1` (Singapore) for both services, 1 replica each.
- [ ] **Step 2:** Redeploy and re-measure the P0 timings.
- [ ] **Verify:** `/api/v1/live` TTFB drops by ≥150 ms from the P0 baseline; p90 no longer shows 2 s spikes over 24 h.
- [ ] **Commit:** (infra, no commit)

## P2 — Finish the Docs tab

Only after P1 is verified: drop the Docs storage the new code no longer uses, remove the leftover secret, cut the Docs round trips.


### Task T2.1: Docs database migration (after T1.1 is verified)

**Files:**
- `drizzle/0167_docs_tab_cleanup.sql`
- `drizzle/meta/_journal.json`

**Report items covered:**
- **Pending · Docs database migration:** Blocked by the Claude Code safety check (it will not write a file with DROP statements). Objects the code no longer uses: tables project_markdown_assets (0 rows) and project_markdown_draft_contributors (1 row); columns project_markdowns.draft_content, draft_updated_by, draft_updated_at; function app_private.nb_readme_asset_is_public; enum status_readme_asset; settings keys mediaUploads, notifyOnPublish; never-scanned indexes project_markdown_versions_project_created_idx, _project_hash_idx, _created_by_idx. Drop only after production runs this code.

**Steps:**
- [ ] **Step 1:** Precondition: production runs main (T1.1) and has served the Docs tab for 24 h without errors.
- [ ] **Step 2:** Confirm the objects are unused in production: `select count(*) from project_markdown_assets;` (expect 0), `select count(*) from project_markdown_draft_contributors;` (expect 1 stale row).
- [ ] **Step 3:** Create `drizzle/0167_docs_tab_cleanup.sql` removing, in this order: table `project_markdown_assets`; table `project_markdown_draft_contributors`; function `app_private.nb_readme_asset_is_public(uuid)`; enum `status_readme_asset`; columns `project_markdowns.draft_content`, `draft_updated_by`, `draft_updated_at`; settings keys `mediaUploads` and `notifyOnPublish` from `project_markdowns.settings` (update rows and the column default); indexes `project_markdown_versions_project_created_idx`, `project_markdown_versions_project_hash_idx`, `project_markdown_versions_created_by_idx`. Use `IF EXISTS` on every statement.
- [ ] **Step 4:** Add the journal entry `{ "idx": 166, "version": "7", "when": <now ms>, "tag": "0167_docs_tab_cleanup", "breakpoints": true }` to `drizzle/meta/_journal.json`.
- [ ] **Step 5:** Run on a Supabase branch first (MCP `create_branch`, then `apply_migration`), load the Docs tab against it, then apply to production with `npm run db:setup` or MCP `apply_migration`.
- [ ] **Step 6:** Run `npm run check:db:migration-journal && npm run check:db-catalog-drift`.
- [ ] **Verify:** Supabase advisors show no new errors; Docs tab loads and links/unlinks a file; `\d project_markdowns` has no draft_* columns.
- [ ] **Commit:** `git commit -m "feat(db): drop unused Docs tab storage"`

### Task T2.2: Remove the leftover co-editing secret

**Files:**
- `Railway variables (networkbase-web)`
- `src/lib/env.ts`

**Report items covered:**
- **Pending · Railway variable DOC_COLLABORATION_TOKEN_SECRET:** Unused by main, but production deploys codex/railway-production, which still has the co-editing route; unset it after deploying main.

**Steps:**
- [ ] **Step 1:** Precondition: T1.1 live (production no longer has the co-editing route).
- [ ] **Step 2:** Delete `DOC_COLLABORATION_TOKEN_SECRET` from Railway variables.
- [ ] **Step 3:** Remove it from `src/lib/env.ts` (schema entry and the secrets list) and run `npm run typecheck`.
- [ ] **Verify:** Service restarts cleanly; `npm run check:security-env-contract` passes.
- [ ] **Commit:** `git commit -m "chore(env): drop unused doc collaboration secret"`

### Task T2.3: Cut Docs tab round trips from 3 queued actions to 1

**Files:**
- `src/app/actions/project/doc.ts`
- `src/hooks/hub/useProjectDocData.ts`
- `src/components/projects/tabs/DocTab.tsx`

**Report items covered:**
- **DOC-08** [P1] Docs tab does 3 queued server actions per open _(status: open)_ — Fix: Pass the doc list from the page shell; verify the JWT locally (`getViewerAuthContext`); one context query with a join.

**Steps:**
- [ ] **Step 1:** In `doc.ts`, replace `getOptionalUserId()` (network `auth.getUser()`) with `(await getViewerAuthContext()).userId` (local JWT verify, cached per request).
- [ ] **Step 2:** Replace the 3 sequential context queries (project, membership, doc row) in `getDocProjectContext` with one `select … from projects left join project_members … left join project_markdowns …`.
- [ ] **Step 3:** Return the doc list from `readProjectDocAction` (it already knows the project) and drop the separate `listProjectMarkdownsAction` call from `DocTab`.
- [ ] **Step 4:** Test: extend `tests/unit/project-doc.test.ts` with an assertion that `DocTab.tsx` no longer imports `useProjectMarkdowns`, run `npx tsx --test tests/unit/project-doc.test.ts`.
- [ ] **Verify:** Re-run the round-trip trace: Docs tab = 1 action on load (+ previews only when smart blocks exist), 0 Auth network calls.
- [ ] **Commit:** `git commit -m "perf(docs): one server action per Docs tab open"`

## P3 — Infrastructure and configuration

Region, Redis, health checks, caching headers, Tailwind scan scope and other config-level fixes.


### Task T3.1: Delete load shedding; co-locate Redis

**Files:**
- `src/lib/routing/load-shedding.ts (delete)`
- `src/lib/supabase/middleware.ts`

**Report items covered:**
- **INF-02** [P1] Redis (Upstash) region not co-located and hit on every document request — Fix: Delete `src/lib/routing/load-shedding.ts` (97 lines) and its proxy call. A global Redis token bucket guards nothing at 16 users; Railway restarts handle overload. Co-locate Upstash with the web service for the per-user limits that stay.
- **PT-08** [P2] Load shedding with a global Redis bucket — Fix: Delete (INF-02).
- **Ledger:** Load shedding (1 files, 97 lines, app)
- **Scale · Global load shedding (Redis token bucket)** (cut) — lib/routing/load-shedding.ts, proxy. Marker: —

**Steps:**
- [ ] **Step 1:** Delete `load-shedding.ts` and its call + 503 branch in `updateSession`.
- [ ] **Step 2:** Create the Upstash database in the same region as T1.2 and update `UPSTASH_REDIS_REST_URL/TOKEN`.
- [ ] **Step 3:** `npm run typecheck && npx tsx --test tests/unit/**/*middleware*.test.ts`.
- [ ] **Verify:** Proxy makes 0 Redis calls on page loads (round-trip trace).
- [ ] **Commit:** `git commit -m "perf(proxy): remove global load shedding"`

### Task T3.2: Rate limits only where abuse is possible

**Files:**
- `src/app/api/v1/live/route.ts`
- `src/app/api/v1/ready/route.ts`
- `src/lib/security/rate-limit.ts`
- `~40 authenticated read routes calling enforceRouteLimit`

**Report items covered:**
- **INF-11** [P1] Liveness and readiness probes go through a Redis rate limit — Fix: Delete the rate limit on `/live` and `/ready`. Probes are internal and cheap.
- **Scale · Rate limit on liveness/readiness probes** (cut) — api/v1/live, api/v1/ready. Marker: —
- **Scale · Per-route rate limits on authenticated reads** (simplify) — ~40 of 73 `enforceRouteLimit` calls (projects, sessions, privacy, skills, profiles, integrations, appearance, files). Marker: ponytail: no Redis limit on authenticated reads. ceiling: per-user abuse by a signed-in account. upgrade: add back per route when logs show >10 req/s from one user.
- **Scale · Rate limits on abuse surfaces** (keep) — auth/*, signup, username-check, link-preview, extension auth-code, webhooks, GitHub import, CSRF. Marker: ponytail: Upstash sliding window per IP/user. ceiling: one region Redis. upgrade: none needed below ~1k rps.
- **Scale · RATE_LIMIT_MODE (distributed-only / best-effort)** (simplify) — lib/security/rate-limit.ts (462 lines). Marker: ponytail: one mode, fail-closed (only abuse surfaces keep limits). ceiling: Redis outage blocks sign-in. upgrade: fail-open mode if that ever happens.

**Steps:**
- [ ] **Step 1:** Remove `enforceRouteLimit` from `/live` and `/ready`.
- [ ] **Step 2:** Remove it from authenticated read-only routes (projects, sessions, privacy GETs, skills, profiles, integrations, appearance, files). Keep it on auth/*, signup, username-check, link-preview, extension auth-code, webhooks, GitHub import, CSRF.
- [ ] **Step 3:** Collapse `RATE_LIMIT_MODE` to one fail-closed mode; delete the mode switch.
- [ ] **Step 4:** Run `npm run check:authz-contract && npx tsx --test tests/unit/**/*rate*limit*.test.ts`.
- [ ] **Verify:** `/api/v1/live` TTFB ≈ TLS + origin only; 0 Redis calls in its trace.
- [ ] **Commit:** `git commit -m "perf(api): rate-limit abuse surfaces only"`

### Task T3.3: Landing redirect, health checks, heap, network extras

**Files:**
- `src/app/page.tsx`
- `railway.toml`
- `package.json`

**Report items covered:**
- **INF-03** [P2] `/` answers 307 → `/login` for anonymous visitors — Fix: Render the login (or landing) page at `/` directly, or use a rewrite instead of a redirect. Saves one full round trip on first visit.
- **INF-07** [P3] Health-check path mismatch and slow `/api/v1/health` — Fix: Use `/api/v1/live` everywhere for liveness; keep `/health` for manual readiness only. Update `railway.toml`.
- **INF-08** [P3] Node heap capped at 384 MB on a 1 GB container — Fix: Raise cap to ~700 MB (headroom for image/tarball work) or remove the flag. No memory leak detected, so no leak work needed.
- **INF-10** [P3] Network basics pass — Fix: Keep. Optional: enable HTTP/3 and Early Hints in Cloudflare.

**Steps:**
- [ ] **Step 1:** Render the login (or landing) page at `/` instead of redirecting to `/login`.
- [ ] **Step 2:** Set `healthcheckPath = "/api/v1/live"` in `railway.toml`.
- [ ] **Step 3:** Change `start` to `next start` with `NODE_OPTIONS='--max-old-space-size=700'` (or drop the flag).
- [ ] **Step 4:** Optional: enable HTTP/3 and Early Hints in Cloudflare.
- [ ] **Verify:** `curl -I /` returns 200; Railway health check green; memory stays < 700 MB.
- [ ] **Commit:** `git commit -m "perf: serve / directly and fix health check path"`

### Task T3.4: Investigate the 41% 4xx

**Files:**
- `Railway logs`

**Report items covered:**
- **INF-05** [P2] 41% of production requests end in 4xx — Fix: Break down 4xx by path in Railway logs. Likely sources: bots on unknown paths, 401s from API calls fired before auth, and the `/discover` 404. Fix callers that fire requests without a session.

**Steps:**
- [ ] **Step 1:** Group 7 days of 4xx by path and status (Railway logs filter `status>=400 status<500`).
- [ ] **Step 2:** Fix callers that request without a session (e.g. appearance on /login, FE-12) and bots on unknown paths (robots.txt / 404 cache).
- [ ] **Verify:** 4xx share < 10% over 7 days.
- [ ] **Commit:** `git commit -m "fix: stop unauthenticated client requests"`

### Task T3.5: Tailwind scan scope, view-count write-through

**Files:**
- `src/app/globals.css`
- `Railway variables`

**Report items covered:**
- **FE-04** [P1] Tailwind scans the whole repo → 431 KB render-blocking CSS — Fix: In `src/app/globals.css`: `@import "tailwindcss" source("../");` so only `src/` is scanned. Re-measure; expect a large cut.
- **DB-08** [P2] Project view counter writes through on every view — Fix: Unset `PROJECT_VIEWS_WRITE_THROUGH`; rely on Redis increments + the flush cron.

**Steps:**
- [ ] **Step 1:** First line of `globals.css`: `@import "tailwindcss" source("../");`
- [ ] **Step 2:** `npm run build` and compare the CSS file size with the 431 KB baseline.
- [ ] **Step 3:** Unset `PROJECT_VIEWS_WRITE_THROUGH` in Railway.
- [ ] **Verify:** Global CSS shrinks; `update projects set view_count` calls stop appearing per view in pg_stat_statements.
- [ ] **Commit:** `git commit -m "perf(css): scan src only"`

## P4 — Middleware / proxy

One proxy file with CSP + CSRF + auth, no DB calls, correct matcher.


### Task T4.1: One proxy file with CSP, CSRF and auth

**Files:**
- `middleware.ts (delete)`
- `src/proxy.ts`
- `src/lib/supabase/middleware.ts`

**Report items covered:**
- **MW-01** [P0] Two middleware files; the one with CSP/CSRF never runs on `main` — Fix: Merge both into one `src/proxy.ts` (CSP + CSRF + auth + canonical redirects) with one matcher, delete root `middleware.ts`, add a build check that asserts CSP is present on `/terms`.
- **MW-02** [P1] Proxy matcher is stale — Fix: Use one catch-all matcher that excludes static files (as the root file already does) and branch on `route-class.ts` inside the proxy. No generated matcher.
- **MW-06** [P2] Middleware bundle is 547 KB — Fix: Proxy imports only what it runs (verify, cookies, redirect). Log errors only; delete per-request info logs. No sampling layer.
- **MW-08** [P3] Production CSP allows `ws://localhost:*` and Vercel analytics — Fix: Check `x-forwarded-host` instead of `nextUrl.hostname`; drop the Vercel host with DEAD-03.
- **Ledger:** Root middleware.ts (never built; merge ~100 lines of CSP/CSRF into proxy) (1 files, 107 lines, app)
- **Stale marker** `middleware.ts:13` "remove / from auth resolution" → Lives in a file Next never builds (MW-01).

**Steps:**
- [ ] **Step 1:** Move `buildCsp`, CSRF cookie issuance and the request-target/route-metric headers from root `middleware.ts` into `src/proxy.ts`; delete `middleware.ts`.
- [ ] **Step 2:** Matcher: one catch-all excluding static files; branch on `route-class.ts` inside.
- [ ] **Step 3:** CSP local hosts: check `x-forwarded-host`, not `nextUrl.hostname`; remove `va.vercel-scripts.com`.
- [ ] **Step 4:** Trim proxy imports to verify + cookies + redirect; log errors only.
- [ ] **Step 5:** Add a check to `scripts/check-csp-contract.ts`: build output `.next/server/middleware.js` contains `Content-Security-Policy`.
- [ ] **Step 6:** `npm run build && npm run check:csp-contract`.
- [ ] **Verify:** `curl -sI https://networkbase.in/terms | grep -i content-security-policy` returns a header (after deploy).
- [ ] **Commit:** `git commit -m "fix(proxy): single proxy with CSP and CSRF"`

### Task T4.2: Proxy and layout auth without network or DB calls

**Files:**
- `src/lib/supabase/middleware.ts`
- `src/lib/auth/snapshot.ts`
- `src/app/(main)/layout.tsx`

**Report items covered:**
- **MW-03** [P1] Proxy may query the DB for onboarding status on each page load — Fix: Stop checking onboarding in the proxy. `(main)/layout` already reads the viewer; redirect to `/onboarding` from there. No JWT hook, zero DB calls in the proxy.
- **MW-04** [P2] Auth resolved 2–3 times per navigation — Fix: Keep one `cache()`d verify per request. The legal check keeps its existing 10-min in-process cache; delete the second verify in the proxy for app routes. No claims hook (MW-03 v2).
- **MW-05** [P2] JWT verification can fall back to a network `auth.getUser()` call — Fix: Switch Supabase to asymmetric JWT signing keys; verify via cached JWKS only; log and reject instead of network fallback.
- **MW-07** [P2] CSRF token needs an extra serial request — Fix: Keep as is until MW-01 lands; then the proxy sets the cookie on first HTML response and the extra GET only happens once per 12 h. Do not add a meta-tag path. (Replacing CSRF with Origin + SameSite is a security decision; route to /cso.)

**Steps:**
- [ ] **Step 1:** Delete `resolveProfileOnboardingComplete` from the proxy; redirect to `/onboarding` from `(main)/layout.tsx`, which already reads the viewer.
- [ ] **Step 2:** Keep one `cache()`d verify per request; delete the second verify for app routes; keep the legal check's in-process cache.
- [ ] **Step 3:** Switch Supabase to asymmetric JWT signing keys; delete the `auth.getUser()` fallback in `resolveAuthSnapshot` (log + reject).
- [ ] **Step 4:** Leave CSRF as is; the proxy now issues the cookie on the first HTML response.
- [ ] **Verify:** Round-trip trace: proxy = 0 SQL, 0 REST, 0 Auth network calls.
- [ ] **Commit:** `git commit -m "perf(auth): claims-only proxy"`

## P5 — Database and SQL

Realtime, pooling, indexes, cron queries, RLS, naming, unused objects, partitions, query shape.


### Task T5.1: Realtime publication trim

**Files:**
- `drizzle/0168_realtime_publication_trim.sql`
- `src/lib/realtime/project-files-channel.ts`

**Report items covered:**
- **DB-01** [P0] Realtime `postgres_changes` WAL polling uses 89% of all DB time — Fix: Step 1 (today): `ALTER PUBLICATION supabase_realtime DROP TABLE connections, task_comment_likes, message_read_receipts, message_delivery_receipts, file_versions;` Step 2 only if Realtime is still >50% of DB time after Step 1 and INF-01: move per-user feeds to Broadcast. ponytail: ceiling = 16 published tables; upgrade = Realtime share stays >50%.
- **RT-07** [P3] Realtime binding on an unpublished table — Fix: Remove the binding (the sync UI already polls) or broadcast sync status explicitly.
- **Scale · Realtime publication (21 tables)** (simplify) — supabase_realtime. Marker: ponytail: publish only the 16 subscribed tables. ceiling: Realtime ≤50% of DB time. upgrade: Broadcast for per-user feeds.

**Steps:**
- [ ] **Step 1:** Migration: `ALTER PUBLICATION supabase_realtime DROP TABLE connections, task_comment_likes, message_read_receipts, message_delivery_receipts, file_versions;`
- [ ] **Step 2:** Remove the `github_sync_runs` binding from `project-files-channel.ts` (table is not published).
- [ ] **Step 3:** Reset stats after deploy: `select pg_stat_statements_reset();` and re-check in 7 days; move per-user feeds to Broadcast only if Realtime is still > 50% of DB time.
- [ ] **Verify:** `select count(*) from pg_publication_tables where pubname='supabase_realtime'` = 16; Realtime share of DB time drops.
- [ ] **Commit:** `git commit -m "perf(realtime): publish only subscribed tables"`

### Task T5.2: Connection pool, single db client

**Files:**
- `src/lib/db/index.ts`
- `src/lib/legal/acceptance.ts`
- `every readDb import`

**Report items covered:**
- **DB-02** [P0] Connection churn: 117k type fetches, 500k pooler auths — Fix: In `src/lib/db/index.ts`: `idle_timeout: 300`, `max_lifetime: 60*30`, `fetch_types: false`, `max: 10`. On a long-lived server prefer the session pooler (5432) or direct connection, with `prepare: true`. Removes a TLS + auth handshake cross-region on most requests.
- **DB-22** [P3] Pool and timeouts — Fix: Keep timeouts. Lower pool max to 10 after DB-02.
- **DB-19** [P2] Read-replica fallback repeats the same SQL on the same pool — Fix: Remove the `readDb`/`db` split until a replica exists; keep `withDbRetry` only.
- **PT-14** [P2] Read replica abstraction with no replica — Fix: One `db` export; delete fallback branches.
- **Scale · DB pool (transaction pooler forced, idle 10 s, max 20)** (rewrite) — lib/db/index.ts. Marker: ponytail: session pooler, max 10, idle 300 s, fetch_types off. ceiling: one long-lived server. upgrade: transaction pooler + max 2 if moved to serverless.
- **Scale · Read replica split (readDb/db)** (cut) — lib/db/index.ts + fallbacks. Marker: —
- **Scale · Statement / idle-tx timeouts (8 s / 5 s)** (keep) — lib/db/index.ts. Marker: ponytail: 8 s statement cap. ceiling: slow report queries fail. upgrade: per-query SET LOCAL for known long jobs.
- **Ledger:** Read-replica split + fallbacks (no replica) (~4 files, 60 lines, app-est)
- **Stale marker** `src/lib/db/index.ts:69-71 + :104` force pooler 6543 "under 1M+ user load"; singleton → Speculative scale; the forced transaction pooler + 10 s idle timeout drive 117k type fetches (DB-02).

**Steps:**
- [ ] **Step 1:** In `db/index.ts`: `idle_timeout: 300`, `max_lifetime: 1800`, `fetch_types: false`, `max: 10`; use the session pooler (5432) with `prepare: true` on the long-lived server; delete the forced 6543 rewrite and its '1M users' comment.
- [ ] **Step 2:** Delete `readDb`/`readClient`; replace imports with `db`; delete the read-fallback branches (legal acceptance).
- [ ] **Step 3:** Keep statement 8 s / idle-tx 5 s timeouts.
- [ ] **Step 4:** `npm run typecheck && npm run test:unit`.
- [ ] **Verify:** pg_stat_statements: `pg_type` type-fetch and `pgbouncer.get_auth` calls stop growing.
- [ ] **Commit:** `git commit -m "perf(db): long-lived pool, one client"`

### Task T5.3: Indexes: add the missing, drop the duplicate

**Files:**
- `drizzle/0169_index_fixes.sql`
- `src/lib/db/schema/index.ts`

**Report items covered:**
- **DB-03** [P1] `project_nodes` full scans: 715 M rows read — Fix: Three partial indexes only: `(project_id, id) WHERE type='file' AND deleted_at IS NULL`; `(s3_key text_pattern_ops) WHERE type='file' AND deleted_at IS NULL`; `(updated_at) WHERE deleted_at IS NOT NULL AND (metadata->>'permanentDeleteRoot') = id::text`. No new column.
- **DB-05** [P1] `project_node_events` JSON lookup with 200 bind params — Fix: Expression index `(project_id, (metadata->>'key'))` + `= ANY($2::text[])`. No schema change.
- **DB-11** [P2] Duplicate index on `dm_pairs` — Fix: `DROP INDEX dm_pairs_user_low_high_unique;` (keep the constraint-backed one).
- **DB-12** [P2] Four unindexed foreign keys — Fix: Add btree indexes (or composite ones that lead with these columns).
- **DB-13** [P3] 208 indexes never used — Fix: Traffic is small (16 users), so stats are thin. Re-check after 30 days of real use, then drop in batches. Drop obvious duplicates now (see DB-14).
- **DB-14** [P2] Workspace counters stored twice — Fix: Keep counters only in `profile_counters`; drop the `profiles` columns and indexes.
- **Scale · Denormalized counters twice (profiles + profile_counters) + 2 reconcile crons** (simplify) — workspace-counter-reconcile, workspace-counter-refresh. Marker: ponytail: counters only in profile_counters, one nightly reconcile. ceiling: drift ≤24 h if a write path misses. upgrade: trigger-maintained counts.

**Steps:**
- [ ] **Step 1:** Partial indexes on project_nodes: `(project_id, id) WHERE type='file' AND deleted_at IS NULL`; `(s3_key text_pattern_ops) WHERE type='file' AND deleted_at IS NULL`; `(updated_at) WHERE deleted_at IS NOT NULL AND (metadata->>'permanentDeleteRoot') = id::text`.
- [ ] **Step 2:** Expression index `project_node_events (project_id, (metadata->>'key'))`; change the IN-list to `= ANY($1::text[])`.
- [ ] **Step 3:** Drop `dm_pairs_user_low_high_unique`; add FK indexes on `github_sync_runs.actor_id` and `sprint_task_memberships(added_by|project_id|removed_by)`.
- [ ] **Step 4:** Counters: keep them only in `profile_counters`; drop the `profiles` counter columns and indexes; one nightly reconcile cron.
- [ ] **Step 5:** Unused indexes (197): re-check after 30 days of traffic, then drop in batches.
- [ ] **Step 6:** Mirror every index in `schema/index.ts`; `npm run check:db-catalog-drift`.
- [ ] **Verify:** `project_nodes` seq_tup_read stops growing; reconciliation query mean < 50 ms.
- [ ] **Commit:** `git commit -m "perf(db): partial and expression indexes"`

### Task T5.4: Cron jobs: stop polling empty work

**Files:**
- `src/inngest/functions/git-sync.ts`
- `src/inngest/functions/*.ts`
- `scripts/backfill-market-skills.ts`

**Report items covered:**
- **DB-04** [P1] `git-sync-recovery` rewrites the same rows every 15 min — Fix: Add `isNotNull(githubSyncRuns.credential)` to the WHERE; fold the three UPDATEs into one CTE; exit early when no `review/running/queued` rows exist (cheap indexed EXISTS).
- **DB-09** [P2] Cron jobs poll even when there is no work — Fix: Delete `job_heartbeats` writes on no-op runs; move idle 15-min crons to hourly. No event wiring.
- **DB-10** [P2] Skill catalog re-upserted at runtime — Fix: The upserts come from the manual `skills:backfill` script. Run it only when `skills-catalog` changes; add nothing.
- **Scale · View/like counters via Redis + 15-min flush (write-through also on)** (simplify) — flush-views, flush-likes, PROJECT_VIEWS_WRITE_THROUGH. Marker: ponytail: unset write-through; Redis + flush only. ceiling: counts lag ≤15 min. upgrade: none.
- **Scale · 22 cron functions (8 at ≤15 min)** (simplify) — inngest/functions/*. Marker: ponytail: hourly for sweeps, daily for retention. ceiling: cleanup lags ≤1 h. upgrade: event triggers for the ones users wait on.
- **Stale marker** `src/inngest/functions/flush-views.ts:9` "15-minute cron prevents polling churn" → Bypassed: `PROJECT_VIEWS_WRITE_THROUGH` is set in Railway, so every view writes directly (DB-08).
- **Stale marker** `src/inngest/functions/notification-push-delivery.ts:42` "cuts idle checks by 80%" → Still 32,805 idle scans returning 16 rows total (DB-09).

**Steps:**
- [ ] **Step 1:** `git-sync-recovery`: add `isNotNull(githubSyncRuns.credential)`, merge the 3 updates into one CTE, exit early when no review/running/queued rows.
- [ ] **Step 2:** Only write `job_heartbeats` when state changes; move idle 15-min crons to hourly, retention to daily.
- [ ] **Step 3:** Run the skill backfill only when the catalog file changes.
- [ ] **Step 4:** View/like counters: Redis + 15-min flush only (write-through unset in T3.5). Update the stale `ponytail:` comments in flush-views.ts and notification-push-delivery.ts with a real ceiling and trigger.
- [ ] **Verify:** pg_stat_statements: the credential UPDATE returns 0 rows and runs hourly at most.
- [ ] **Commit:** `git commit -m "perf(cron): no work, no writes"`

### Task T5.5: One presence mechanism

**Files:**
- `src/components/chat/ChatProvider.tsx`
- `src/app/api/v1/presence/heartbeat/route.ts`

**Report items covered:**
- **DB-07** [P2] Presence writes a hot row that is published to Realtime — Fix: Delete the unconditional `update profiles set last_active_at` path (9,861 calls); keep only the throttled `... AND last_active_at < $3` variant with a 5-min window. No new table.
- **Scale · Three presence mechanisms** (simplify) — 10-min heartbeat POST + Realtime Presence + profiles.last_active_at writes. Marker: ponytail: Realtime Presence for online; throttled last_active_at (5 min) for 'last seen'. ceiling: last-seen accurate to 5 min. upgrade: none.

**Steps:**
- [ ] **Step 1:** Delete the unconditional `update profiles set last_active_at`; keep the throttled `… AND last_active_at < now() - interval '5 minutes'` variant.
- [ ] **Step 2:** Online status from Realtime Presence only; remove the 10-minute heartbeat POST if last-seen can come from the throttled write.
- [ ] **Verify:** `update profiles set last_active_at` ≤ 1 per user per 5 min.
- [ ] **Commit:** `git commit -m "perf(presence): throttle last-seen writes"`

### Task T5.6: RLS and security advisors

**Files:**
- `drizzle/0170_rls_security.sql`

**Report items covered:**
- **DB-15** [P2] RLS policies re-evaluate `auth.uid()` per row — Fix: Wrap as `(select auth.uid())` in both policies.
- **DB-16** [P3] Multiple permissive SELECT policies — Fix: Merge into one policy per role with `OR`.
- **DB-17** [P2] Security advisor warnings — Fix: `REVOKE EXECUTE ... FROM anon, authenticated`; `SET search_path = ''` on both functions; enable HaveIBeenPwned check in Auth settings.
- **SQL plan · Security:** `REVOKE EXECUTE ON FUNCTION sync_profile_to_auth_user_metadata() FROM anon, authenticated`; `SET search_path = ''` on it and `seed_project_workflow_columns` (DB-17).

**Steps:**
- [ ] **Step 1:** Wrap `auth.uid()` as `(select auth.uid())` in `project_invitations_read_authorized` and `project_guidance_appointments_read_authorized`.
- [ ] **Step 2:** Merge the two permissive SELECT policies on `profile_project_contributions` and `…_stages` into one with OR.
- [ ] **Step 3:** `REVOKE EXECUTE ON FUNCTION sync_profile_to_auth_user_metadata() FROM anon, authenticated;` and `SET search_path = ''` on it and `seed_project_workflow_columns`.
- [ ] **Step 4:** Enable leaked-password protection in Supabase Auth settings.
- [ ] **Step 5:** Run MCP `get_advisors` (security + performance).
- [ ] **Verify:** Advisors show 0 WARN for these items.
- [ ] **Commit:** `git commit -m "fix(db): RLS initplan and function hardening"`

### Task T5.7: Rename SQL objects consistently

**Files:**
- `drizzle/0171_sql_naming.sql`
- `src/lib/db/schema/index.ts`
- `all code using projectMarkdown* (docs rename)`

**Report items covered:**
- **DB-24** [P2] SQL naming is inconsistent — Fix: One migration of renames only (instant, no data moves); see the SQL plan. Update `src/lib/db/schema/index.ts` names to match.
- **SQL plan · Rename 56 indexes:** 42 `idx_<t>_<c>` → `<t>_<c>_idx`; 7 `*_uidx` → `*_unique`; 3 `*_pk` → `*_pkey`; `project_git_deltas_unique_seq` → `project_git_deltas_seq_unique`; `conversation_participants_last_reaction_message_conversation_id` → `…_last_reaction_message_idx`. Verified: 0 name collisions. 4 are constraint-backed → `ALTER TABLE … RENAME CONSTRAINT`, the rest `ALTER INDEX … RENAME TO`.
- **SQL plan · Unique naming:** `extension_device_sessions_token_hash_key`, `extension_recovery_drafts_storage_key_key` → `*_unique`. Drop `dm_pairs_user_low_high_unique` (identical to `dm_pairs_user_low_user_high_key`).
- **SQL plan · Rename 114 policies:** Rule `<table>_<command>_<scope>` with scope own / visible / project_writer / project_admin / project_member / author / author_or_admin. Generated in SQL from `pg_policies`: 114 names, all distinct, 0 collisions. Example: "Users can view own connections" → `connections_select_own`.
- **SQL plan · Rename 4 triggers:** `trg_messages_after_insert_consistency` → `messages_insert_consistency`; `trigger_sync_project_open_roles_count` → `project_open_roles_sync_count`; `tr_sync_profile_to_auth_user_metadata` → `profiles_sync_auth_metadata`; `trg_prevent_readme_delete` → `project_docs_prevent_delete`.
- **SQL plan · Docs domain:** Tables `project_markdowns`, `project_markdown_versions`, `project_markdown_assets`, `project_markdown_draft_contributors` → `project_docs`, `project_doc_versions`, `project_doc_assets`, `project_doc_draft_contributors`; enum `status_readme_asset` → `status_doc_asset`; functions `prevent_readme_delete`, `app_private.nb_readme_version_is_public`, `nb_readme_asset_is_public`, `nb_project_public_readme_visible` → `*doc*`. Policies/triggers bind by OID, so they keep working. Code: 156 Drizzle refs in ~15 files (`projectMarkdowns*`).
- **SQL plan · Enum:** `status_role_app` → `status_role_application`.

**Steps:**
- [ ] **Step 1:** Indexes: 56 renames (42 `idx_*` → `*_idx`, 7 `*_uidx` → `*_unique`, 3 `*_pk` → `*_pkey`, 2 odd names); 4 are constraint-backed → `ALTER TABLE … RENAME CONSTRAINT`. Generate the list with the query in the audit's SQL plan; verified 0 collisions.
- [ ] **Step 2:** Unique: `extension_device_sessions_token_hash_key`, `extension_recovery_drafts_storage_key_key` → `*_unique`.
- [ ] **Step 3:** Policies: 114 renames to `<table>_<command>_<scope>` (generated from pg_policies; 114 distinct, 0 collisions).
- [ ] **Step 4:** Triggers: `trg_messages_after_insert_consistency` → `messages_insert_consistency`; `trigger_sync_project_open_roles_count` → `project_open_roles_sync_count`; `tr_sync_profile_to_auth_user_metadata` → `profiles_sync_auth_metadata`; `trg_prevent_readme_delete` → `project_docs_prevent_delete`.
- [ ] **Step 5:** Docs domain: `project_markdowns*` → `project_docs*`, enum `status_readme_asset` (if not dropped in T2.1) → `status_doc_asset`, `nb_readme_*` → `nb_doc_*`; rename the Drizzle exports (`projectMarkdowns` → `projectDocs`, 156 refs) in the same commit.
- [ ] **Step 6:** Enum `status_role_app` → `status_role_application`.
- [ ] **Step 7:** Deploy code and migration together (renames are instant, metadata-only).
- [ ] **Verify:** `npm run check:db-catalog-drift` passes; advisors unchanged.
- [ ] **Commit:** `git commit -m "refactor(db): consistent SQL object names"`

### Task T5.8: Drop unused SQL objects and migration debris

**Files:**
- `drizzle/0172_drop_unused.sql`
- `drizzle/0152_message_preview_backfill.sql (delete)`
- `supabase/migrations (delete empty dir)`
- `src/lib/db/schema/index.ts`

**Report items covered:**
- **DB-23** [P2] Unused SQL objects _(status: pending)_ — Fix: Drop the 4 empty/unused tables with their policies and indexes; keep `skill_icon_assets` only if the catalog script is the source of truth (else drop and read `/skill-icons/v1`). Drop the view and function. Re-check indexes after 30 days of traffic.
- **DEAD-08** [P3] Migration history hygiene — Fix: Delete the orphan file and the empty dir. Optional: squash history into one baseline (`pg_dump --schema-only`) once all environments are on the latest migration; retire the replay/lineage checks with it.
- **SQL plan · Drop unused:** Tables `collection_projects`, `saved_projects`, `skill_popularity_snapshots`, `profile_interests` (+ their 8 policies, indexes); view `onboarding_funnel_dimensions_daily`; function `app_private.nb_validate_dm_conversation`; publication entries per DB-01.
- **SQL plan · Migration files:** Delete orphan `drizzle/0152_message_preview_backfill.sql` and empty `supabase/migrations/`. Squash optional (DEAD-08).
- **Ledger:** Orphan migration drizzle/0152_message_preview_backfill.sql (1 files, 12 lines, sql)

**Steps:**
- [ ] **Step 1:** After deploy: drop tables `collection_projects`, `saved_projects`, `skill_popularity_snapshots`, `profile_interests` (+ their policies and indexes), view `onboarding_funnel_dimensions_daily`, function `app_private.nb_validate_dm_conversation`; decide `skill_icon_assets` (drop if `/skill-icons/v1` is the source of truth).
- [ ] **Step 2:** Remove the matching Drizzle definitions.
- [ ] **Step 3:** Delete the orphan `0152_message_preview_backfill.sql` and the empty `supabase/migrations/`.
- [ ] **Step 4:** Optional: squash history into one baseline with `pg_dump --schema-only` once every environment is current; retire the replay/lineage checks with it.
- [ ] **Verify:** `npm run check:db:migration-journal` passes; advisors unchanged.
- [ ] **Commit:** `git commit -m "chore(db): drop unused objects"`

### Task T5.9: Collapse project_node_events partitions

**Files:**
- `drizzle/0173_node_events_single_table.sql`
- `src/inngest/functions/database-partition-maintenance.ts (delete)`

**Report items covered:**
- **DB-25** [P2] Monthly partitioning for 9.7k rows — Fix: Collapse into one plain table; drop the per-partition triggers, `create_future_partitions()` and the cron. ponytail: ceiling = ~10 M rows; upgrade = retention deletes or scans get slow.
- **SQL plan · Collapse partitions:** `project_node_events` 13 partitions → one table; drop `create_future_partitions()` + 13 per-partition triggers (DB-25).
- **Scale · Monthly partitions on project_node_events** (cut) — 13 partitions, trigger each, create_future_partitions(), monthly cron. Marker: ponytail: one table. ceiling: ~10 M rows. upgrade: partition when retention deletes get slow.

**Steps:**
- [ ] **Step 1:** Create a plain table with the same columns and indexes, copy the ≈9,700 rows, swap names in one transaction.
- [ ] **Step 2:** Drop the 13 per-partition triggers and `create_future_partitions()`; delete the monthly maintenance cron and its registry entry.
- [ ] **Verify:** `select count(*)` matches before/after; inserts still get sequence numbers.
- [ ] **Commit:** `git commit -m "refactor(db): single node-events table"`

### Task T5.10: Query shape: schema reloads, badge counts, N+1, e2e isolation

**Files:**
- `src/app/actions/notifications.ts`
- `src/app/actions/project/workflow.ts`
- `src/app/api/v1/extension/bulk-finalize/route.ts`
- `src/lib/github/sync-runner.ts`
- `src/inngest/functions/flush-views.ts`
- `src/inngest/functions/flush-likes.ts`
- `src/inngest/functions/account-cleanup.ts`
- `playwright.config.ts`

**Report items covered:**
- **DB-06** [P2] PostgREST schema cache reloads cost ~0.8 s DB each — Fix: Avoid DDL at runtime (create a year of partitions ahead in one migration). Limit `db_schemas` in Supabase API settings to `public`. The app reads mostly via Drizzle, so PostgREST use is small.
- **DB-18** [P2] Two COUNT queries for one badge — Fix: One `SELECT count(*) FILTER (WHERE read_at IS NULL), count(*) FILTER (WHERE seen_at IS NULL) ...`. No counter table, no Broadcast.
- **DB-20** [P2] N+1 loops (query per item) — Fix: Batch: `UPDATE t SET ... FROM (VALUES ...) v WHERE t.id = v.id`, `INSERT ... ON CONFLICT` with arrays, `WHERE id = ANY($1)`.
- **DB-21** [P3] E2E cleanup SQL runs against the production database — Fix: Point E2E at a Supabase branch or separate project.

**Steps:**
- [ ] **Step 1:** No runtime DDL (T5.9 removes partition DDL); set Supabase API exposed schemas to `public` only.
- [ ] **Step 2:** One `count(*) FILTER (…)` query for unread + unseen notifications.
- [ ] **Step 3:** Batch the listed N+1 loops with `UPDATE … FROM (VALUES …)`, `INSERT … ON CONFLICT`, `WHERE id = ANY($1)`.
- [ ] **Step 4:** Point E2E at a Supabase branch (never production).
- [ ] **Verify:** pg_stat_statements call counts for these statements drop to one per request.
- [ ] **Commit:** `git commit -m "perf(db): batch loops and merge counts"`

## P6 — Routes and renames

One name per page (Discover, Network, My profile), no duplicate or hidden routes.


### Task T6.1: One name per page: Discover, Network, My profile

**Files:**
- `src/app/(main)/{hub,people,profile} → {discover,network,my-profile}`
- `src/components/hub → discover`
- `src/components/people → network`
- `src/hooks/hub`
- `src/lib/hub`
- `src/lib/data/hub.ts`
- `src/constants/hub.ts`
- `src/types/hub.ts`
- `src/app/actions/hub.ts`
- `src/lib/view-models/hub-user.ts`
- `src/constants/routes.ts`
- `src/lib/query-keys.ts`
- `public/og/hub-card.*`
- `tests`

**Report items covered:**
- **RT-01** [P1] Three pages have two names each — Fix: Move implementations into `discover/`, `network/`, `my-profile/`; delete `hub/`, `people/`, `profile/` (page + loading); replace all legacy strings; drop alias keys; keep the 308 redirects for old links.
- **RT-08** [P3] `hooks/hub/` holds project hooks — Fix: Move them to `src/hooks/projects/` during the Discover rename.
- **Rename** `src/app/(main)/hub/page.tsx` → `src/app/(main)/discover/page.tsx` replace 2-line wrapper; delete hub/loading.tsx (re-export)
- **Rename** `src/app/(main)/people/page.tsx` → `src/app/(main)/network/page.tsx` replace wrapper; delete people/loading.tsx
- **Rename** `src/app/(main)/profile/page.tsx + loading.tsx` → `src/app/(main)/my-profile/` replace wrapper; my-profile/loading.tsx already exists, delete profile/loading.tsx
- **Rename** `src/components/hub/` → `src/components/discover/` SimpleHubClient→DiscoverClient, HubHeader→DiscoverHeader, HubRouteSkeleton→DiscoverRouteSkeleton, HubErrorBoundary→DiscoverErrorBoundary; DiscoverPeopleRail keeps its name; BulkActionBar + ProjectComparisonModal deleted (dead)
- **Rename** `src/components/people/` → `src/components/network/` PeopleHubClient→NetworkClient, PeopleClient→NetworkPeopleTab; ConnectionsClient, InvitationsClient, NetworkRouteSkeleton, PersonCard* keep names; RequestsTab, ProjectApplicationsSection, ApplicationReviewModal deleted (dead)
- **Rename** `src/hooks/hub/useHub*.ts` → `src/hooks/discover/useDiscover*.ts` useHubProjectsSimple→useDiscoverProjects, useHubSessionSeen→useDiscoverSessionSeen, useHubUrlFilters→useDiscoverUrlFilters
- **Rename** `src/hooks/hub/useProject*.ts, useUserInteractions.ts` → `src/hooks/projects/` not Discover code (RT-08)
- **Rename** `src/lib/hub/` → `src/lib/discover/` observability.ts, ranking-config.ts, snapshot-cache.ts
- **Rename** `src/lib/data/hub.ts` → `src/lib/data/discover.ts` 
- **Rename** `src/constants/hub.ts` → `src/constants/discover.ts` 
- **Rename** `src/types/hub.ts` → `src/types/discover.ts` src/types/people.ts deleted (dead)
- **Rename** `src/app/actions/hub.ts` → `src/app/actions/discover.ts` src/app/actions/people-applications.ts deleted (dead)
- **Rename** `src/lib/view-models/hub-user.ts` → `src/lib/view-models/discover-user.ts` 
- **Rename** `src/components/providers/PeopleNotificationsProvider.tsx` → `…/NetworkNotificationsProvider.tsx` 
- **Rename** `src/hooks/usePeopleNotifications.ts` → `src/hooks/useNetworkNotifications.ts` 
- **Rename** `public/og/hub-card.{png,svg}` → `public/og/discover-card.{png,svg}` update buildRouteMetadata image path
- **Rename** `tests/e2e/hub-cursor-integrity.spec.ts, tests/unit/hub-pagination.test.ts` → `discover-*` hub-canonical-contract.test.ts deleted with its script
- **Rename** `tests/e2e/people-matrix.spec.ts, tests/unit/people-notifications-provider.test.ts` → `network-*` 
- **Rename symbol** `SimpleHubClient` → `DiscoverClient` (17 refs, 8 files)
- **Rename symbol** `HubHeader` → `DiscoverHeader` (9 refs, 4 files)
- **Rename symbol** `HubRouteSkeleton` → `DiscoverRouteSkeleton` (9 refs, 4 files)
- **Rename symbol** `HubErrorBoundary` → `DiscoverErrorBoundary` (5 refs, 2 files)
- **Rename symbol** `HubFilters` → `DiscoverFilters` (16 refs, 5 files)
- **Rename symbol** `InvalidHubCursorError` → `InvalidDiscoverCursorError` (14 refs, 4 files)
- **Rename symbol** `HUB_RANKING_SCHEMA_VERSION` → `DISCOVER_RANKING_SCHEMA_VERSION` (12 refs, 3 files)
- **Rename symbol** `getHubRankingWeights` → `getDiscoverRankingWeights` (10 refs, 2 files)
- **Rename symbol** `HubRankingWeights` → `DiscoverRankingWeights` (7 refs, 1 files)
- **Rename symbol** `getHubProjects` → `getDiscoverProjects` (6 refs, 2 files)
- **Rename symbol** `buildHubSnapshotKey` → `buildDiscoverSnapshotKey` (6 refs, 3 files)
- **Rename symbol** `mapPublicProjectToHubProject` → `mapPublicProjectToDiscoverProject` (7 refs, 4 files)
- **Rename symbol** `fetchHubProjectsAction` → `fetchDiscoverProjectsAction` (6 refs, 4 files)
- **Rename symbol** `recordHubMetric` → `recordDiscoverMetric` (4 refs, 2 files)
- **Rename symbol** `HubMetricEvent` → `DiscoverMetricEvent` (2 refs, 1 files)
- **Rename symbol** `HubUser` → `DiscoverUser` (3 refs, 1 files)
- **Rename symbol** `toHubUser` → `toDiscoverUser` (3 refs, 2 files)
- **Rename symbol** `getHubSnapshotCached` → `getDiscoverSnapshotCached` (3 refs, 2 files)
- **Rename symbol** `clearHubSnapshotCache` → `clearDiscoverSnapshotCache` (3 refs, 2 files)
- **Rename symbol** `parseHubCursor` → `parseDiscoverCursor` (2 refs, 1 files)
- **Rename symbol** `getCachedAnonymousHubPage` → `getCachedAnonymousDiscoverPage` (2 refs, 1 files)
- **Rename symbol** `HubQueryOptions` → `DiscoverQueryOptions` (2 refs, 1 files)
- **Rename symbol** `useHubProjectsSimple` → `useDiscoverProjects` (4 refs, 2 files)
- **Rename symbol** `useHubSessionSeen` → `useDiscoverSessionSeen` (4 refs, 2 files)
- **Rename symbol** `useHubUrlFilters` → `useDiscoverUrlFilters` (4 refs, 2 files)
- **Rename symbol** `HubProject` → `DiscoverProject` (0 refs, 0 files)
- **Rename symbol** `PeopleHubClient` → `NetworkClient` (7 refs, 5 files)
- **Rename symbol** `PeopleClient` → `NetworkPeopleTab` (8 refs, 5 files)
- **Rename symbol** `PeopleNotificationsProvider` → `NetworkNotificationsProvider` (9 refs, 6 files)
- **Rename symbol** `PeopleNotificationsContext` → `NetworkNotificationsContext` (4 refs, 1 files)
- **Rename symbol** `usePeopleNotifications` → `useNetworkNotifications` (21 refs, 8 files)
- **Rename symbol** `usePeopleNotificationsContext` → `useNetworkNotificationsContext` (3 refs, 2 files)
- **Rename symbol** `readPeoplePendingCountsAction` → `readNetworkPendingCountsAction` (5 refs, 3 files)
- **Rename symbol** `PeopleSearchScope` → `NetworkSearchScope` (6 refs, 2 files)
- **Rename symbol** `getPeopleSearchScope` → `getNetworkSearchScope` (4 refs, 2 files)
- **Rename rule:** Route strings: replace `/hub`, `/people`, `/profile` literals with `/discover`, `/network`, `/my-profile` (108 in 43 files, incl. `route-class.ts`, `page-contract.ts`, `proxy.ts`, `auth/callback`). Keep the three 308 redirects in `next.config.ts` for old links.
- **Rename rule:** `ROUTES`: delete alias keys `HUB`, `PEOPLE`, `PROFILE`; keep `DISCOVER`, `NETWORK`, `MY_PROFILE`.
- **Rename rule:** Query keys: `queryKeys.hub.*` (11 keys) → `queryKeys.discover.*`; the query-key contract script follows.
- **Rename rule:** Browser storage keys `hub:create-project-modal-state`, `hub.view`, `hub:projects` → `discover:*`. Renaming drops users' saved UI state once; acceptable, no fallback code.
- **Rename rule:** Metric/log names `hub.snapshot.*` → `discover.snapshot.*`.
- **Rename rule:** Keep the `connections` domain (table, actions, `ConnectionsClient`): it names the entity, not the page.
- **Rename rule:** Leave `/u/[username]` and `components/profile/*` as is: they are the profile feature, not the legacy route.
- **Rename rule:** No SQL object uses hub/people naming, so the page rename needs no migration.
- **Ledger:** Canonical-route wrapper files (replaced by the moved pages) (3 files, 6 lines, app)
- **Ledger:** Duplicate loading.tsx after the move (one per route kept) (3 files, 7 lines, app)
- **Stale marker** `src/app/(main)/{discover,network,my-profile}/page.tsx:1` "re-export … without duplicating controller code" → The shortcut created the two-name problem (RT-01); no upgrade trigger.

**Steps:**
- [ ] **Step 1:** `git mv` every row of the audit's rename table (18 file/dir moves); move the 4 project hooks from `hooks/hub` to `hooks/projects`.
- [ ] **Step 2:** Rename the 35 exported symbols listed in the audit (227 references) with the editor's rename-symbol so every import follows.
- [ ] **Step 3:** Replace the 108 `/hub`, `/people`, `/profile` literals in 43 files; delete `ROUTES.HUB/PEOPLE/PROFILE`; `queryKeys.hub` → `queryKeys.discover` (11 keys); storage keys `hub:*` → `discover:*`; metric names `hub.*` → `discover.*`.
- [ ] **Step 4:** Delete the 2-line wrapper pages and the duplicate `loading.tsx` files; keep the three 308 redirects in `next.config.ts`.
- [ ] **Step 5:** `npm run typecheck && npm run test:unit && npm run build`.
- [ ] **Verify:** `grep -rn "/hub\b\|/people\b" src` returns only the redirects; every route renders.
- [ ] **Commit:** `git commit -m "refactor: Discover, Network, My profile naming"`

### Task T6.2: Remove duplicate, hidden and empty routes

**Files:**
- `src/app/api/completion`
- `src/app/api/inngest`
- `src/app/api/v1/completion`
- `src/app/onboarding-preview`
- `src/components/onboarding/OnboardingPreview.tsx`
- `src/app/admin/notifications`

**Report items covered:**
- **RT-02** [P2] Duplicate API aliases — Fix: Delete the non-v1 files (point the Inngest app URL at `/api/v1/inngest` first).
- **RT-03** [P1] AI completion endpoint has no caller — Fix: Delete the route and both packages, unless it is planned work.
- **RT-04** [P2] Hidden pages — Fix: Delete `onboarding-preview` (move harness to tests). Keep admin page only if used; otherwise delete. Keep the e2e alias but exclude from prod build output.
- **RT-05** [P3] 23 empty route directories — Fix: `find src/app -type d -empty -delete`.
- **Ledger:** Unused AI completion route (1 files, 108 lines, app)
- **Ledger:** Hidden onboarding-preview route + harness (3 files, 292 lines, app)

**Steps:**
- [ ] **Step 1:** Point the Inngest app URL at `/api/v1/inngest`, then delete `/api/inngest` and `/api/completion`.
- [ ] **Step 2:** Delete `/api/v1/completion` and uninstall `ai` and `@ai-sdk/google`.
- [ ] **Step 3:** Delete `onboarding-preview` (route + harness); keep or delete `admin/notifications` per your use.
- [ ] **Step 4:** `find src/app -type d -empty -delete`.
- [ ] **Verify:** `npm run build` route list no longer shows these routes.
- [ ] **Commit:** `git commit -m "chore(routes): remove duplicate and hidden routes"`

### Task T6.3: Merge tiny API routes

**Files:**
- `src/app/api/v1/privacy/*`
- `src/app/api/v1/sessions/*`

**Report items covered:**
- **RT-06** [P3] Many tiny API routes — Fix: Merge privacy settings into one PATCH endpoint and sessions into one resource with methods.

**Steps:**
- [ ] **Step 1:** One `PATCH /api/v1/privacy` for the 6 privacy endpoints; one sessions resource with methods.
- [ ] **Step 2:** Update callers; `npm run check:api-versioning-contract`.
- [ ] **Verify:** Settings privacy and sessions screens work end to end.
- [ ] **Commit:** `git commit -m "refactor(api): merge privacy and sessions routes"`

## P7 — Server rendering and data flow

Static where possible, parallel reads, fewer queued server actions.


### Task T7.1: Static legal pages and a header-free root layout

**Files:**
- `src/app/layout.tsx`
- `src/app/(legal)/layout.tsx (new group)`
- `legal page.tsx files`

**Report items covered:**
- **RSC-01** [P1] Root layout forces every route dynamic — Fix: Read the nonce only in layouts that need inline scripts; give legal pages a static route group (INF-04).
- **INF-04** [P2] Static legal pages are sent `no-store` and rendered per request — Fix: Put legal/marketing pages in a route group with their own layout that does not read headers; mark them `force-static`. Cloudflare can then cache them at the edge.
- **RSC-08** [P3] `force-dynamic` in 32 files — Fix: Remove from pages after RSC-01; keep on API routes. Keep the allowlist script.

**Steps:**
- [ ] **Step 1:** Read the CSP nonce only in layouts that render inline scripts; move legal/marketing pages into a `(legal)` group whose layout never calls `headers()`; mark them `export const dynamic = 'force-static'`.
- [ ] **Step 2:** Remove `force-dynamic` from pages that are now static.
- [ ] **Step 3:** `npm run build` — legal routes show as ○ (static).
- [ ] **Verify:** `curl -sI /terms` shows a cacheable `cache-control`.
- [ ] **Commit:** `git commit -m "perf: static legal pages"`

### Task T7.2: Parallel server reads and a streaming shell

**Files:**
- `src/app/(main)/layout.tsx`
- `src/app/(main)/projects/[slug]/page.tsx`

**Report items covered:**
- **RSC-02** [P1] Sequential server waterfall on every app page — Fix: INF-01 first. Then start identity + shell reads together (`Promise.all`) and stream sprint detail in its own Suspense boundary. Legal check stays cached in-process (MW-04).
- **RSC-03** [P2] App shell waits for auth before painting — Fix: Render `MainLayout` chrome outside the suspended part; suspend only the content slot.
- **RSC-09** [P3] `generateMetadata` adds DB reads on files/tasks tabs — Fix: Fold into the shell read, or use a generic title and set the precise one client-side.

**Steps:**
- [ ] **Step 1:** Start identity + shell reads with `Promise.all`; stream sprint detail in its own Suspense.
- [ ] **Step 2:** Render `MainLayout` chrome outside the suspended part.
- [ ] **Step 3:** Fold file/task titles for metadata into the shell read.
- [ ] **Verify:** Project page server render: 2 sequential DB stages instead of 4.
- [ ] **Commit:** `git commit -m "perf(rsc): parallel reads, streaming shell"`

### Task T7.3: Remove next-intl, flags and dead revalidations

**Files:**
- `src/app/layout.tsx`
- `next.config.ts`
- `src/i18n`
- `src/messages`
- `src/lib/features/*`
- `18+ flag call sites`
- `~30 revalidatePath calls`

**Report items covered:**
- **RSC-04** [P2] `next-intl` loads messages for zero consumers — Fix: Remove `next-intl`, the plugin in `next.config.ts`, `src/i18n/`, `src/messages/`.
- **RSC-05** [P2] Eight hardening feature flags are always on — Fix: Delete the flag module and the unused branches.
- **RSC-06** [P2] `revalidatePath` targets wrong or redirected paths — Fix: Delete the ~30 `revalidatePath` calls whose target is a redirect or a non-route. Add no cache layer until a page is measured slow for a cacheable read.
- **PT-06** [P1] ~53 feature flags nobody sets — Fix: Delete the modules; inline `true`; delete the 18+ `false` branches.
- **Ledger:** next-intl config + messages (no consumers) (3 files, 74 lines, app)
- **Ledger:** Feature-flag modules (all flags unset in production) (5 files, 293 lines, app)
- **Ledger:** Flag call-site false branches (~18 files, 180 lines, app-est)
- **Ledger:** Dead revalidatePath calls (redirect / non-route targets) (~12 files, 30 lines, app-est)
- **Scale · Hardening rollout percentages** (cut) — lib/features/hardening.ts (16 env + % knobs). Marker: —

**Steps:**
- [ ] **Step 1:** Delete the NextIntl provider, plugin, `src/i18n`, `src/messages`; uninstall `next-intl`.
- [ ] **Step 2:** Delete `src/lib/features/*` (≈53 flags nobody sets); inline `true`; delete every `false` branch.
- [ ] **Step 3:** Delete `revalidatePath` calls whose target is a redirect or a non-route.
- [ ] **Step 4:** `npm run typecheck && npm run test:unit`.
- [ ] **Verify:** `grep -rn "lib/features\|next-intl" src` is empty.
- [ ] **Commit:** `git commit -m "chore: remove i18n, flags, dead revalidations"`

### Task T7.4: Fewer queued server actions per screen (round-trip reductions)

**Files:**
- `src/components/projects/tabs/ProjectSettingsTab.tsx`
- `src/components/layout/header/TopNav.tsx`
- `src/hooks/useNotifications.ts`
- `src/components/providers/*`
- `src/components/projects/v2/files-tab/**`

**Report items covered:**
- **RSC-07** [P1] Server actions used as GET data loaders in 51 client files — Fix: Per screen, merge the mount-time actions into one action that returns everything (e.g. ProjectSettingsTab's 6 loaders → 1). One queued POST instead of six. Only move a read to a GET route when it must be cached or shared.
- **FE-11** [P2] Hover prefetch fires server actions — Fix: Delete the hover prefetch. The first click loads the group anyway.
- **Stale marker** `src/components/projects/tabs/ProjectSettingsTab.tsx:1219` "initial parallel eager fetch" → False. All 6 loaders are server actions; Next runs them one at a time (RSC-07).

**Steps:**
- [ ] **Step 1:** Per screen, merge mount-time actions into one action returning everything: Settings tab 6 loaders → 1; app shell (workspace summary, notification count + list + preferences, unread messages, network pending counts) → 1 `readShellSummaryAction`; Files tab boot calls → 1.
- [ ] **Step 2:** Pass initial data from the RSC page into React Query (`initialData`) where the server already loaded it.
- [ ] **Step 3:** Delete the hover prefetch server action in TaskFilesCollection.
- [ ] **Step 4:** Fix the false `ponytail:` comment at ProjectSettingsTab.tsx:1219.
- [ ] **Step 5:** Re-run the round-trip trace after each screen.
- [ ] **Verify:** App shell ≤ 2 requests on load; Settings tab ≤ 2; Files tab ≤ 4.
- [ ] **Commit:** `git commit -m "perf: one server action per screen on load"`

### Task T7.5: Notification emitters decision

**Files:**
- `src/lib/notifications/emitters.ts`

**Report items covered:**
- **RSC-10** [P2] 11 notification emitters are defined but never called _(status: partly)_ — Fix: Decide per event: wire the call where users expect the notification, delete the rest. Correctness question, route to /review.

**Steps:**
- [ ] **Step 1:** 9 never-called emitters were removed in step C. For `emitTaskCommentReplyNotification` and `emitTaskFileNotification` (kept, tests only): wire them where users expect the notification, or delete them with their tests.
- [ ] **Verify:** Either real call sites exist or the functions and tests are gone.
- [ ] **Commit:** `git commit -m "fix(notifications): wire or remove remaining emitters"`

### Task T7.6: Discover cache and in-flight dedupe

**Files:**
- `src/lib/hub/snapshot-cache.ts`
- `src/lib/hub/ranking-config.ts`
- `src/lib/utils/inflight-dedupe.ts (33 call sites)`

**Report items covered:**
- **PT-15** [P3] Process-global in-flight dedupe beside React `cache()` — Fix: Delete where a `cache()` wrapper already exists; keep only for cross-request fan-in if measured.
- **Scale · Discover snapshot cache (300 entries) + ranking weights env + schema version** (simplify) — lib/hub/snapshot-cache.ts, ranking-config.ts. Marker: ponytail: one indexed query per page, no snapshot cache, weights as constants. ceiling: ~10k public projects. upgrade: bring back a cache when the feed query >100 ms.
- **Scale · Process-global in-flight dedupe** (simplify) — lib/utils/inflight-dedupe.ts, 33 call sites. Marker: ponytail: React cache() per request only. ceiling: identical concurrent requests hit the DB twice. upgrade: dedupe the one hot path that shows up in pg_stat_statements.

**Steps:**
- [ ] **Step 1:** Replace the Discover snapshot cache with one indexed query; weights as constants; drop `HUB_RANKING_WEIGHTS`.
- [ ] **Step 2:** Delete `runInFlightDeduped` where a `cache()` wrapper already exists.
- [ ] **Verify:** Discover feed query < 100 ms in pg_stat_statements.
- [ ] **Commit:** `git commit -m "refactor: plain queries over bespoke caches"`

## P8 — Client, React and bundle

Smaller root bundle, CSS, icons, components, timers, caching behaviour.


### Task T8.1: Slim root layout and providers

**Files:**
- `src/app/layout.tsx`
- `src/components/providers/*`
- `src/components/privacy/CookieConsentRuntime.tsx`
- `package.json`

**Report items covered:**
- **FE-01** [P1] ~1 MB client JS baseline on every page, including static ones — Fix: Root layout: fonts + theme pre-hydrate script + children. Move Query/Tooltip/Toaster into `(main)`/`(auth)` layouts. Delete `MotionConfig`; CSS `@media (prefers-reduced-motion)` already covers it. Delete Analytics.
- **FE-06** [P2] Unused state subscription re-renders the runtime provider tree — Fix: Delete the two unused values; `dynamic(() => import(...ChatPopupV2), { ssr:false })` when the popup opens.
- **FE-13** [P2] Legal pages hydrate client JS they do not need — Fix: After FE-01 and INF-04, legal pages ship near-zero client JS.
- **FE-17** [P3] `canvas-confetti` types in runtime deps — Fix: Move to `devDependencies`; confirm confetti is `import()`ed on use.
- **FE-18** [P3] Hydration warnings suppressed only where expected — Fix: Keep. Authenticated pages not measured (see gaps).

**Steps:**
- [ ] **Step 1:** Root layout: fonts + theme pre-hydrate script + children; move Query/Tooltip/Toaster into `(main)`/`(auth)` layouts.
- [ ] **Step 2:** Delete `MotionConfig`; delete the unused `popupOpen` and `isMessagesRoute` in MainRuntimeProviders; `dynamic()` import ChatPopupV2.
- [ ] **Step 3:** Move `@types/canvas-confetti` to devDependencies.
- [ ] **Step 4:** `npm run build`; compare per-route JS with the P0 baseline.
- [ ] **Verify:** /terms ships < 150 KB JS; no hydration warnings.
- [ ] **Commit:** `git commit -m "perf: slim root client bundle"`

### Task T8.2: Skill icons and catalog

**Files:**
- `src/components/skills/SkillIcon.tsx`
- `src/lib/skills/generated-client-catalog.ts (delete)`
- `public/skill-sprites.svg (delete)`
- `22 unused public/icon-* files`

**Report items covered:**
- **FE-03** [P1] Skill catalog and icon set shipped to the browser — Fix: Delete `public/skill-sprites.svg` (4.1 MB raw, 818 KB brotli, downloaded whole on the first skill chip) and `generated-client-catalog.ts`. `SkillIcon` already has a path for the 745 per-icon files in `/skill-icons/v1/` (immutable cache): use `<img src>` so a page fetches only the icons it shows. Labels come from the server.
- **PT-02** [P2] Client skill catalog duplicates the `skills` table — Fix: Delete; serve names from the server (see FE-03).
- **PT-03** [P1] 4.1 MB SVG sprite next to 745 per-icon files — Fix: Delete the sprite; `<img src=/skill-icons/v1/<key>.svg>`.
- **PT-17** [P3] 22 unused app icon files — Fix: Delete.
- **Ledger:** Generated client skill catalog (1 files, 22,473 lines, generated)
- **Ledger:** SVG sprite (4.1 MB) (1 files, 20,259 lines, asset)
- **Ledger:** Unused public/icon-* files (22 files, 0 lines, asset)

**Steps:**
- [ ] **Step 1:** SkillIcon: `<img src="/skill-icons/v1/<key>.svg">` (files already exist, cached immutable); delete the sprite.
- [ ] **Step 2:** Serve skill labels from the server; delete the generated client catalog and its generator step.
- [ ] **Step 3:** Delete the 22 unreferenced `public/icon-*` files (list in the audit).
- [ ] **Verify:** No request for skill-sprites.svg; /discover JS drops by ≥ 280 KB.
- [ ] **Commit:** `git commit -m "perf(skills): per-icon files, server labels"`

### Task T8.3: Auth pages as server shells

**Files:**
- `src/app/(auth)/login/page.tsx`
- `signup/page.tsx`
- `(onboarding)/onboarding/page.tsx`

**Report items covered:**
- **FE-02** [P1] Auth and onboarding pages are 1,000+ line client components — Fix: Server page shell + small client form islands; load Turnstile and Google Identity on interaction.
- **FE-12** [P2] Login page fetches appearance settings for anonymous users — Fix: Skip when signed out; read the theme from the existing pre-hydrate cookie/localStorage.

**Steps:**
- [ ] **Step 1:** Server page shell + small client form islands; load Turnstile/Google on interaction.
- [ ] **Step 2:** Skip `/api/v1/appearance` when signed out.
- [ ] **Verify:** /login JS < 400 KB decoded; no appearance request when signed out.
- [ ] **Commit:** `git commit -m "perf(auth): server shells for auth pages"`

### Task T8.4: Split the largest components

**Files:**
- `ProjectSettingsTab.tsx (5,640)`
- `GitHubSyncWorkspace.tsx`
- `UpdatesTab.tsx`
- `MessagesWorkspaceV2.tsx`
- `Phase1SourceSelection.tsx`
- `FolderListView.tsx`

**Report items covered:**
- **FE-05** [P1] Very large client components — Fix: Split per section, `dynamic()` import each settings section, colocate state in leaves.
- **FE-07** [P2] Manual memoization everywhere — Fix: Delete `useCallback`/`useMemo` around cheap values in files you touch. React Compiler is optional later (adds a Babel pass to builds); measure first.

**Steps:**
- [ ] **Step 1:** Split per section; `dynamic()` each settings section.
- [ ] **Step 2:** Delete `useCallback`/`useMemo` around cheap values in files you touch; React Compiler only after measuring.
- [ ] **Verify:** React Profiler: settings tab commit time and render count drop vs P0.
- [ ] **Commit:** `git commit -m "refactor: split large client components"`

### Task T8.5: Timers, polling, invalidation, prefetch, fonts, lists

**Files:**
- `src/lib/utils/visibility.ts`
- `5 refetchInterval views`
- `invalidateQueries call sites`
- `22 prefetch={false} links`
- `src/app/layout.tsx fonts`

**Report items covered:**
- **FE-08** [P2] Timers and listeners not centralized — Fix: Route all 8 intervals through the existing `lib/utils/visibility.ts`. No new store.
- **FE-09** [P2] Polling and realtime both refresh the same data — Fix: Delete the 5 `refetchInterval: 300_000` polls; realtime invalidation + React Query's refetch-on-focus/reconnect already keep them fresh.
- **FE-10** [P2] Broad cache invalidation — Fix: Invalidate exact keys from the existing query-key factory instead of prefixes. No per-mutation cache writes.
- **FE-14** [P3] Prefetch strategy inconsistent — Fix: Delete the 22 `prefetch={false}` and the manual `warmPrefetchRoute`; Next's default viewport prefetch for `<Link>` does the job. No wrapper component.
- **FE-15** [P3] Fonts — Fix: `preload: false` on JetBrains Mono and Instrument Serif. No subsetting step.
- **FE-16** [P3] Lists and tables — Fix: Keep. Virtualize Kanban columns only if a column exceeds ~200 cards.

**Steps:**
- [ ] **Step 1:** Route all 8 intervals through `lib/utils/visibility.ts`.
- [ ] **Step 2:** Delete the 5 `refetchInterval: 300_000` polls.
- [ ] **Step 3:** Invalidate exact keys instead of prefixes.
- [ ] **Step 4:** Delete `prefetch={false}` and `warmPrefetchRoute`.
- [ ] **Step 5:** `preload: false` for JetBrains Mono and Instrument Serif.
- [ ] **Step 6:** Keep react-virtuoso; virtualize Kanban only past ~200 cards.
- [ ] **Verify:** No background requests on an idle tab for 10 minutes (DevTools network).
- [ ] **Commit:** `git commit -m "perf(client): fewer timers and refetches"`

### Task T8.6: Native motion, dates and theme

**Files:**
- `10 framer-motion files`
- `23 date-fns files`
- `src/lib/utils/date.ts`
- `src/components/providers/theme-provider.tsx`

**Report items covered:**
- **PT-10** [P2] framer-motion for fades and one reorder list — Fix: CSS transitions + `tw-animate-css` (already installed) for fades; move LifecycleEditor to `@dnd-kit/sortable`. −1 dep.
- **PT-11** [P3] date-fns for relative time — Fix: `Intl.RelativeTimeFormat` + `Intl.DateTimeFormat` in `lib/utils/date.ts`. −1 dep.
- **PT-12** [P2] 517-line wrapper around next-themes — Fix: Keep next-themes + the accent/reduced-motion bits (~120 lines).
- **Ledger:** theme-provider shrink (517 → ~120) (1 files, 397 lines, app)

**Steps:**
- [ ] **Step 1:** Fades → CSS/tw-animate-css; LifecycleEditor → @dnd-kit/sortable; uninstall framer-motion.
- [ ] **Step 2:** `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` in `lib/utils/date.ts`; uninstall date-fns.
- [ ] **Step 3:** Shrink theme-provider to next-themes + accent/reduced-motion (~120 lines).
- [ ] **Verify:** `npm ls framer-motion date-fns` empty; visual check of animated surfaces.
- [ ] **Commit:** `git commit -m "refactor: native motion and dates"`

## P9 — Dead code, dependencies and repo

Remaining Ponytail cuts: packages, flags, telemetry, scripts, clutter, conventions.


### Task T9.1: Unused packages and lockfiles

**Files:**
- `package.json`
- `pnpm-lock.yaml (delete)`
- `bun.lock (delete)`
- `src/components/privacy/CookieConsentRuntime.tsx`
- `src/lib/supabase/browser-cookie-store.ts`

**Report items covered:**
- **DEAD-03** [P2] Unused or duplicate dependencies — Fix: Remove the four packages; switch the 3 `radix-ui` imports to `@radix-ui/*` and drop the meta package; keep one lockfile (npm, per scripts).
- **PT-13** [P2] Unused packages — Fix: Remove. −7 deps.
- **PT-20** [P3] Three lockfiles — Fix: Keep `package-lock.json`.
- **Ledger:** Extra lockfiles (pnpm-lock.yaml, bun.lock) (2 files, 15,466 lines, clutter)

**Steps:**
- [ ] **Step 1:** Uninstall `@vercel/analytics`, `cookie`, `@types/cookie`, `radix-ui` (switch its 3 imports to `@radix-ui/*`); `next-intl`, `ai`, `@ai-sdk/google` go in T6.2/T7.3.
- [ ] **Step 2:** Keep `package-lock.json` only.
- [ ] **Step 3:** `npm ci && npm run build`.
- [ ] **Verify:** `npm ls` shows none of the removed packages.
- [ ] **Commit:** `git commit -m "chore(deps): remove unused packages"`

### Task T9.2: Test-only modules and exports

**Files:**
- `11 test-only lib modules (audit list)`
- `55 test-only exports`
- `their tests`

**Report items covered:**
- **DEAD-02** [P3] 11 modules used only by tests — Fix: Delete with their tests unless a script depends on them (`lib/standards/*` feeds check scripts — keep those two).
- **Ledger:** Unused exported functions/constants inside live files (body lines) (159 files, 3,217 lines, app)
- **Ledger:** Unused exported types/interfaces (37 files, 188 lines, app)

**Steps:**
- [ ] **Step 1:** For each test-only module/export: delete it with its tests, except `lib/standards/*` (feeds check scripts).
- [ ] **Step 2:** Re-run the dead-code fixpoint (scratch `reduce.cjs` saved under docs/superpowers/plans/tools) and `npm run test:unit`.
- [ ] **Verify:** Export scan reports 0 dead exports.
- [ ] **Commit:** `git commit -m "chore: remove test-only code"`

### Task T9.3: Telemetry, scale scripts, bloom filter, env knobs

**Files:**
- `src/lib/telemetry/otlp.ts`
- `src/components/observability/RoutePerformanceObserver.tsx`
- `src/instrumentation.ts`
- `8 scripts + ops/stability`
- `src/lib/privacy/bloom-filter.ts`
- `src/lib/extension/auth-code.ts`
- `src/app/actions/laptop-ides.ts`
- `src/lib/supabase/server.ts`

**Report items covered:**
- **PT-07** [P2] No-op telemetry stack — Fix: Delete all three. Railway metrics + Supabase stats cover today's needs.
- **INF-09** [P3] OpenTelemetry imports packages that are not installed — Fix: Delete the OTel block and the 3 `serverExternalPackages` entries (PT-07).
- **PT-05** [P2] Scale-readiness tooling for 16 users — Fix: Delete. Re-add a load test when real traffic appears. ponytail: ceiling = current traffic; upgrade = sustained >100 rps.
- **DEAD-05** [P3] Release gate runs ~45 checks one after another — Fix: Delete contracts that guard removed features (hub-canonical, hardening-rollout, 1m-readiness, capacity-audit, production-rollout, load-suite, stability gate). Keep the rest serial; no runner dependency.
- **PT-16** [P3] Dead env knobs and platform sniffing — Fix: Delete the knobs and branches; unset `REDIS_URL`.
- **Ledger:** No-op telemetry (2 files, 415 lines, app)
- **Ledger:** Scale-readiness + retired-contract scripts (8 files, 1,122 lines, app)
- **Ledger:** ops/stability capacity/rollout JSON (5 files, 432 lines, app)
- **Ledger:** Bloom filter for blocked pairs (16 users) (1 files, 134 lines, app)
- **Scale · Bloom filter for blocked pairs** (cut) — lib/privacy/bloom-filter.ts (134 lines). Marker: ponytail: Set of blocked ids per viewer from one query. ceiling: ~10k blocks per user. upgrade: bloom filter if that query shows up.
- **Scale · 1M-readiness / capacity / rollout / load-suite / stability scripts** (cut) — 8 scripts, ops/stability/*.json. Marker: ponytail: no load tooling. ceiling: current traffic (3.9k req/week). upgrade: one k6 script when traffic passes 100 rps.
- **Stale marker** `src/app/api/v1/extension/session/route.ts:23` "avoid hammering DB with 1M heartbeats" → Speculative scale, no trigger. Fine to keep the cache; name a ceiling.

**Steps:**
- [ ] **Step 1:** Delete OTLP telemetry, RoutePerformanceObserver and the OTel block in instrumentation.ts (+ serverExternalPackages).
- [ ] **Step 2:** Delete the 1M-readiness/capacity/rollout/load-suite/stability/hardening/hub-canonical scripts and `ops/stability`; remove them from `test:release-gate`.
- [ ] **Step 3:** Replace the bloom filter with a Set from one query.
- [ ] **Step 4:** Delete env knobs nobody sets (NEXTAUTH/AUTH_SECRET fallback, platform sniffing, MOCK_USER_ID bypass — review with /cso), unset `REDIS_URL`.
- [ ] **Step 5:** Give the extension-session cache a real `ponytail:` ceiling and trigger.
- [ ] **Verify:** `npm run test:release-gate` runs without the removed scripts.
- [ ] **Commit:** `git commit -m "chore: remove no-op telemetry and scale tooling"`

### Task T9.4: Barrels, aliases, e2e route, conventions, build config

**Files:**
- `src/app/actions/project/index.ts`
- `src/app/actions/messaging/index.ts`
- `src/app/api/e2e/auth/*`
- `next.config.ts`
- `src/lib/hooks|stores|types`

**Report items covered:**
- **PT-09** [P3] Barrels that re-export one file — Fix: Rename `_all.ts` → `index.ts`, delete the barrels and re-export files (after RT-01/RT-02).
- **PT-18** [P3] E2E auth route via bundler aliases — Fix: One `route.ts` with `if (process.env.NODE_ENV === 'production') notFound()` like `onboarding-preview`.
- **PT-19** [P3] Duplicate folder conventions — Fix: Pick one of each; delete the empty `services/`.
- **DEAD-06** [P3] Build config leftovers — Fix: Try `next build` with Turbopack and compare output; trim the list.
- **Ledger:** Barrels and alias re-exports (7 files, 166 lines, app)

**Steps:**
- [ ] **Step 1:** Rename `project/_all.ts` → `project/index.ts` and `messaging/_all.ts` → `messaging/index.ts`; delete the re-export barrels.
- [ ] **Step 2:** E2E auth: one `route.ts` with `if (process.env.NODE_ENV === 'production') notFound()`; delete the resolveAlias trick.
- [ ] **Step 3:** Pick one folder per concern (hooks, stores, types, utils); delete empty `services/`.
- [ ] **Step 4:** Try `next build` with Turbopack; trim `optimizePackageImports`.
- [ ] **Verify:** `npm run build` passes with Turbopack.
- [ ] **Commit:** `git commit -m "refactor: flatten barrels and conventions"`

### Task T9.5: Repo clutter and vendored skills

**Files:**
- `53 root scratch files`
- `scratch/`
- `.agents/`
- `.next-verify`
- `.next-codex-audit`

**Report items covered:**
- **DEAD-04** [P3] 53 scratch files in the repo root, 101 more in `scratch/` — Fix: Move to `scratch/` (gitignored) or delete.
- **PT-01** [P2] Vendored agent skills in the repo — Fix: Delete. Installed plugins already provide them.
- **Ledger:** Root scratch files (55 files, 17,840 lines, clutter)
- **Ledger:** scratch/ directory (101 files, 8,722 lines, clutter)
- **Ledger:** Vendored agent skills .agents/ (405 files, 134,012 lines, vendored)

**Steps:**
- [ ] **Step 1:** Move or delete the root scratch files and `scratch/` (they also feed Tailwind scanning before T3.5).
- [ ] **Step 2:** Delete `.agents/` (405 files) once no other tool (e.g. Codex) relies on it.
- [ ] **Step 3:** Delete the extra build dirs.
- [ ] **Verify:** `ls` at repo root shows only config and source.
- [ ] **Commit:** `git commit -m "chore: remove repo clutter"`

## P10 — Claude skill set and workflow

One skill per job; the plan's own execution loop.


### Task T10.1: Claude skill set and workflow

**Files:**
- `CLAUDE.md`
- `.claude/settings.json`
- `skills/ (empty dirs)`
- `skills-lock.json`

**Report items covered:**
- **SK-01** [P2] ~95 Claude skills loaded, heavy overlap — Fix: Keep one skill per job (see workflow). Delete the repo copy `.agents/` (405 files, 123k lines: 33 vendored skills incl. a second copy of Ponytail) and the empty `skills/` dirs; they duplicate installed plugins and Tailwind scans them (FE-04).
- **SK-02** [P3] CLAUDE.md routing table points to 30 skills — Fix: Shrink the table to the 10-skill workflow below.
- **SK-03** [P3] Ponytail plugin now installed — vendored copy duplicates it — Fix: Delete the vendored copy (covered by SK-01). Use `/ponytail-audit` + `/ponytail-debt` as the cut step of every phase.
- **Workflow · Cut:** `ponytail-audit + ponytail-debt` — Start every phase by listing what to delete; ledger any shortcut with ceiling + upgrade.
- **Workflow · Plan:** `superpowers:writing-plans` — One short plan per phase. Brainstorming only for new features.
- **Workflow · Scope guard:** `freeze` — Lock edits to the phase's folder.
- **Workflow · Build:** `ponytail (full) + superpowers:test-driven-development` — Smallest change; test first on SQL/query changes.
- **Workflow · Debug:** `investigate` — Only when a check fails.
- **Workflow · Measure:** `benchmark` — Before/after numbers for every phase.
- **Workflow · Review:** `ponytail-review, then review` — First cut complexity, then correctness. One reviewer each.
- **Workflow · Ship:** `ship → canary` — PR, deploy, watch production.
- **Workflow · Talk:** `caveman lite + caveman-commit` — Short status, short commits.

**Steps:**
- [ ] **Step 1:** Shrink the CLAUDE.md routing table to the 9-step workflow in the audit (ponytail-audit → plan → freeze → build → benchmark → ponytail-review → review → ship → canary).
- [ ] **Step 2:** Disable overlapping skills per project; delete empty `skills/` and the stale `brandkit` lock entry.
- [ ] **Step 3:** Use ponytail-audit + ponytail-debt at the start of each phase of this plan.
- [ ] **Verify:** CLAUDE.md lists one skill per job.
- [ ] **Commit:** `git commit -m "docs: one skill per job"`

## P11 — Final verification

Re-measure everything, re-run the round-trip trace, close the debt ledger.


### Task T11.1: Re-measure and compare

**Files:**
- `docs/audits/performance-audit-2026-09-27.md`

**Report items covered:**
- **Round trips · App shell (every signed-in page):** baseline 9 requests on load, 7 actions, 1 API, 54 SQL sites, 8 Auth calls
- **Round trips · /discover (served by hub/page.tsx):** baseline 4 requests on load, 2 actions, 1 API, 49 SQL sites, 2 Auth calls
- **Round trips · /messages:** baseline 8 requests on load, 6 actions, 1 API, 57 SQL sites, 7 Auth calls
- **Round trips · /network (served by people/page.tsx):** baseline 2 requests on load, 1 actions, 0 API, 11 SQL sites, 1 Auth calls
- **Round trips · /my-profile (served by profile/page.tsx):** baseline 9 requests on load, 4 actions, 4 API, 69 SQL sites, 8 Auth calls
- **Round trips · /projects/[slug]:** baseline 4 requests on load, 2 actions, 1 API, 52 SQL sites, 3 Auth calls
- **Round trips · /projects/new:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /settings:** baseline 10 requests on load, 4 actions, 5 API, 40 SQL sites, 9 Auth calls
- **Round trips · /u/[username]:** baseline 9 requests on load, 4 actions, 4 API, 72 SQL sites, 8 Auth calls
- **Round trips · /workspace:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /acceptable-use:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /admin/notifications:** baseline 1 requests on load, 0 actions, 0 API, 3 SQL sites, 1 Auth calls
- **Round trips · /cookies:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /copyright:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /dpa:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /eula:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /grievances:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /onboarding-preview:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /open-source:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /privacy:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /security-reporting:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /subprocessors:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · /terms:** baseline 1 requests on load, 0 actions, 0 API, 0 SQL sites, 0 Auth calls
- **Round trips · Project · Dashboard tab:** baseline 1 requests on load, 1 actions, 0 API, 6 SQL sites, 0 Auth calls
- **Round trips · Project · Docs tab:** baseline 3 requests on load, 3 actions, 0 API, 26 SQL sites, 4 Auth calls
- **Round trips · Project · Updates tab:** baseline 8 requests on load, 7 actions, 1 API, 53 SQL sites, 3 Auth calls
- **Round trips · Project · Tasks tab:** baseline 6 requests on load, 6 actions, 0 API, 16 SQL sites, 4 Auth calls
- **Round trips · Project · Files tab:** baseline 14 requests on load, 14 actions, 0 API, 55 SQL sites, 13 Auth calls
- **Round trips · Project · Sprints tab:** baseline 2 requests on load, 2 actions, 0 API, 24 SQL sites, 2 Auth calls
- **Round trips · Project · Settings tab:** baseline 8 requests on load, 6 actions, 2 API, 34 SQL sites, 8 Auth calls

**Steps:**
- [ ] **Step 1:** Repeat every T0.2 measurement.
- [ ] **Step 2:** Re-run the round-trip trace and compare each page/tab row with the audit's table.
- [ ] **Step 3:** Update the audit report with before/after.
- [ ] **Verify:** Every surface row is equal or lower than the baseline; no new 5xx.
- [ ] **Commit:** `git commit -m "docs: after-implementation measurements"`

### Task T11.2: Close the debt ledger and record kept mechanisms

**Files:**
- `files named in the ponytail-debt ledger (31 markers without a trigger)`
- `code of the kept scale mechanisms`

**Report items covered:**
- **Scale · Realtime channel budget (4) / presence rooms (3)** (keep) — project-files-channel.ts, useOnlineUsers.ts. Marker: ponytail: hard client caps. ceiling: 4 channels/tab. upgrade: raise when a view needs more.
- **Scale · Precomputed social-graph suggestions + collaboration summaries** (keep (flag)) — connection_suggestions (+cron), profile_collaboration_summaries (20 rows). Marker: ponytail: precompute kept since it exists and works. ceiling: cron cost grows with users². upgrade: compute on read if it is ever cheaper, re-check at 10k users.
- **Scale · 37 module-level Map caches** (keep) — GitHub tokens/health, JWKS, legal acceptance, extension sessions, doc view-model/quality/source-map caches, signed-URL cache…. Marker: ponytail: plain Maps, no caps. ceiling: memory flat at 252–299 MB for 7 days. upgrade: size cap on the doc caches only if memory climbs.
- **Scale · GitHub import budgets (files, dirs, bytes, timeouts)** (keep) — lib/github/worker-guard.ts, env defaults. Marker: ponytail: hard budgets protect worker memory. ceiling: repos above the budget are refused. upgrade: streaming import.
- **Scale · Upload size limits** (keep) — attachments, profile images, project files. Marker: —
- **Scale · Inngest concurrency limits (13)** (keep) — inngest/functions/*. Marker: —
- **Scale · Advisory locks (16)** (keep) — files, sync, sprints. Marker: correctness, not scale
- **Scale · Separate worker service** (keep) — Railway networkbase-worker (INNGEST_EXECUTION_ROLE). Marker: ponytail: worker isolates GitHub imports from web memory. ceiling: 2 services to run. upgrade: merge if imports move to streaming.
- **Scale · Virtualized lists (react-virtuoso)** (keep) — 12 views. Marker: —
- **Scale · Pagination caps and cursors** (keep) — feeds, files (200-item selection), messages. Marker: —
- **Scale · CDN / immutable asset caching** (keep) — next.config.ts headers, images 31-day TTL. Marker: —
- **Marker without trigger** `next.config.ts:22, :118`
- **Marker without trigger** `scripts/check-db-catalog-drift.ts:145`
- **Marker without trigger** `src/app/actions/subtask.ts:82`
- **Marker without trigger** `src/app/actions/project/_all.ts:8135, :8191`
- **Marker without trigger** `src/app/globals.css:700, :704, :711, :781`
- **Marker without trigger** `src/app/actions/task-comment.ts:258`
- **Marker without trigger** `src/app/actions/project/guidance.ts:366`
- **Marker without trigger** `src/app/actions/connections.ts:670`
- **Marker without trigger** `src/app/api/v1/github/account/replacement/route.ts:118`
- **Marker without trigger** `src/app/auth/callback/route.ts:214`
- **Marker without trigger** `src/app/api/v1/extension/session/route.ts:23, :50, :80`
- **Marker without trigger** `src/app/api/v1/projects/[id]/image/route.ts:59, :100`
- **Marker without trigger** `src/app/(main)/{discover,network,my-profile}/page.tsx:1`
- **Marker without trigger** `src/app/(main)/projects/[slug]/page.tsx:16`
- **Marker without trigger** `src/app/(main)/workspace/page.tsx:15`
- **Marker without trigger** `src/inngest/functions/sprint-schedule.ts:7`
- **Marker without trigger** `src/inngest/functions/notification-push-delivery.ts:42`
- **Marker without trigger** `src/inngest/functions/git-sync.ts:137`
- **Marker without trigger** `src/components/projects/v2/tasks/TaskCard.tsx:224`
- **Marker without trigger** `src/components/projects/tabs/sprint/SprintTimelineContent.tsx:158`
- **Marker without trigger** `src/components/layout/header/global-search.ts:118`
- **Marker without trigger** `src/components/projects/ProjectOnboardingModal.tsx:35`
- **Marker without trigger** `src/components/projects/dashboard/ProjectDashboardClient.tsx:230`
- **Marker without trigger** `src/components/projects/dashboard/InviteCollaboratorModal.tsx:96, :514`
- **Marker without trigger** `src/components/projects/tabs/ProjectSettingsTab.tsx:1219`
- **Marker without trigger** `src/components/workspace/WorkspaceTasksTab.tsx:315`
- **Marker without trigger** `src/components/projects/v2/tasks/KanbanBoard.tsx:829`
- **Marker without trigger** `src/components/workspace/WorkspaceRequestsTab.tsx:75`
- **Marker without trigger** `src/components/workspace/WorkspaceDrawerHost.tsx:61`
- **Marker without trigger** `src/components/profile/SocialPresenceIcon.tsx:142`
- **Marker without trigger** `src/lib/projects/social-links.ts:47`

**Steps:**
- [ ] **Step 1:** Add `ceiling:` and `upgrade:` to each of the 31 `ponytail:` comments that name no trigger (list in the audit).
- [ ] **Step 2:** For each kept scale mechanism, write the audit's rewritten `ponytail:` marker next to the code (channel budget, precomputed suggestions, Map caches, import budgets, upload limits, Inngest concurrency, advisory locks, worker service, virtualization, pagination, CDN caching).
- [ ] **Step 3:** Run `/ponytail-debt`: every marker has a trigger.
- [ ] **Verify:** ponytail-debt reports 0 markers with no trigger.
- [ ] **Commit:** `git commit -m "docs: ponytail markers with ceilings and triggers"`

---

## Coverage matrix

Every report item and the task that implements it.

| Report item | Task |
|---|---|
| EXT:0 | T0.2 |
| EXT:1 | T0.2 |
| EXT:2 | T0.2 |
| EXT:3 | T0.2 |
| EXT:4 | T0.2 |
| EXT:5 | T0.2 |
| EXT:6 | T0.2 |
| EXT:7 | T0.2 |
| EXT:8 | T0.2 |
| GAP:0 | T0.2 |
| GAP:1 | T0.2 |
| GAP:2 | T0.2 |
| GAP:3 | T0.2 |
| GAP:4 | T0.2 |
| ISSUE:DB-01 | T5.1 |
| ISSUE:DB-02 | T5.2 |
| ISSUE:DB-03 | T5.3 |
| ISSUE:DB-04 | T5.4 |
| ISSUE:DB-05 | T5.3 |
| ISSUE:DB-06 | T5.10 |
| ISSUE:DB-07 | T5.5 |
| ISSUE:DB-08 | T3.5 |
| ISSUE:DB-09 | T5.4 |
| ISSUE:DB-10 | T5.4 |
| ISSUE:DB-11 | T5.3 |
| ISSUE:DB-12 | T5.3 |
| ISSUE:DB-13 | T5.3 |
| ISSUE:DB-14 | T5.3 |
| ISSUE:DB-15 | T5.6 |
| ISSUE:DB-16 | T5.6 |
| ISSUE:DB-17 | T5.6 |
| ISSUE:DB-18 | T5.10 |
| ISSUE:DB-19 | T5.2 |
| ISSUE:DB-20 | T5.10 |
| ISSUE:DB-21 | T5.10 |
| ISSUE:DB-22 | T5.2 |
| ISSUE:DB-23 | T5.8 |
| ISSUE:DB-24 | T5.7 |
| ISSUE:DB-25 | T5.9 |
| ISSUE:DEAD-01 | T0.1 |
| ISSUE:DEAD-02 | T9.2 |
| ISSUE:DEAD-03 | T9.1 |
| ISSUE:DEAD-04 | T9.5 |
| ISSUE:DEAD-05 | T9.3 |
| ISSUE:DEAD-06 | T9.4 |
| ISSUE:DEAD-07 | T0.1 |
| ISSUE:DEAD-08 | T5.8 |
| ISSUE:DOC-01 | T0.1 |
| ISSUE:DOC-02 | T0.1 |
| ISSUE:DOC-03 | T0.1 |
| ISSUE:DOC-04 | T0.1 |
| ISSUE:DOC-05 | T0.1 |
| ISSUE:DOC-06 | T0.1 |
| ISSUE:DOC-07 | T0.1 |
| ISSUE:DOC-08 | T2.3 |
| ISSUE:FE-01 | T8.1 |
| ISSUE:FE-02 | T8.3 |
| ISSUE:FE-03 | T8.2 |
| ISSUE:FE-04 | T3.5 |
| ISSUE:FE-05 | T8.4 |
| ISSUE:FE-06 | T8.1 |
| ISSUE:FE-07 | T8.4 |
| ISSUE:FE-08 | T8.5 |
| ISSUE:FE-09 | T8.5 |
| ISSUE:FE-10 | T8.5 |
| ISSUE:FE-11 | T7.4 |
| ISSUE:FE-12 | T8.3 |
| ISSUE:FE-13 | T8.1 |
| ISSUE:FE-14 | T8.5 |
| ISSUE:FE-15 | T8.5 |
| ISSUE:FE-16 | T8.5 |
| ISSUE:FE-17 | T8.1 |
| ISSUE:FE-18 | T8.1 |
| ISSUE:INF-01 | T1.2 |
| ISSUE:INF-02 | T3.1 |
| ISSUE:INF-03 | T3.3 |
| ISSUE:INF-04 | T7.1 |
| ISSUE:INF-05 | T3.4 |
| ISSUE:INF-06 | T1.1 |
| ISSUE:INF-07 | T3.3 |
| ISSUE:INF-08 | T3.3 |
| ISSUE:INF-09 | T9.3 |
| ISSUE:INF-10 | T3.3 |
| ISSUE:INF-11 | T3.2 |
| ISSUE:MW-01 | T4.1 |
| ISSUE:MW-02 | T4.1 |
| ISSUE:MW-03 | T4.2 |
| ISSUE:MW-04 | T4.2 |
| ISSUE:MW-05 | T4.2 |
| ISSUE:MW-06 | T4.1 |
| ISSUE:MW-07 | T4.2 |
| ISSUE:MW-08 | T4.1 |
| ISSUE:PT-01 | T9.5 |
| ISSUE:PT-02 | T8.2 |
| ISSUE:PT-03 | T8.2 |
| ISSUE:PT-04 | T0.1 |
| ISSUE:PT-05 | T9.3 |
| ISSUE:PT-06 | T7.3 |
| ISSUE:PT-07 | T9.3 |
| ISSUE:PT-08 | T3.1 |
| ISSUE:PT-09 | T9.4 |
| ISSUE:PT-10 | T8.6 |
| ISSUE:PT-11 | T8.6 |
| ISSUE:PT-12 | T8.6 |
| ISSUE:PT-13 | T9.1 |
| ISSUE:PT-14 | T5.2 |
| ISSUE:PT-15 | T7.6 |
| ISSUE:PT-16 | T9.3 |
| ISSUE:PT-17 | T8.2 |
| ISSUE:PT-18 | T9.4 |
| ISSUE:PT-19 | T9.4 |
| ISSUE:PT-20 | T9.1 |
| ISSUE:RSC-01 | T7.1 |
| ISSUE:RSC-02 | T7.2 |
| ISSUE:RSC-03 | T7.2 |
| ISSUE:RSC-04 | T7.3 |
| ISSUE:RSC-05 | T7.3 |
| ISSUE:RSC-06 | T7.3 |
| ISSUE:RSC-07 | T7.4 |
| ISSUE:RSC-08 | T7.1 |
| ISSUE:RSC-09 | T7.2 |
| ISSUE:RSC-10 | T7.5 |
| ISSUE:RT-01 | T6.1 |
| ISSUE:RT-02 | T6.2 |
| ISSUE:RT-03 | T6.2 |
| ISSUE:RT-04 | T6.2 |
| ISSUE:RT-05 | T6.2 |
| ISSUE:RT-06 | T6.3 |
| ISSUE:RT-07 | T5.1 |
| ISSUE:RT-08 | T6.1 |
| ISSUE:SK-01 | T10.1 |
| ISSUE:SK-02 | T10.1 |
| ISSUE:SK-03 | T10.1 |
| LEDGER:0 | T0.1 |
| LEDGER:1 | T0.1 |
| LEDGER:2 | T9.2 |
| LEDGER:3 | T9.2 |
| LEDGER:4 | T9.3 |
| LEDGER:5 | T9.3 |
| LEDGER:6 | T7.3 |
| LEDGER:7 | T9.3 |
| LEDGER:8 | T3.1 |
| LEDGER:9 | T9.3 |
| LEDGER:10 | T4.1 |
| LEDGER:11 | T9.4 |
| LEDGER:12 | T6.2 |
| LEDGER:13 | T6.2 |
| LEDGER:14 | T7.3 |
| LEDGER:15 | T8.6 |
| LEDGER:16 | T6.1 |
| LEDGER:17 | T6.1 |
| LEDGER:18 | T5.2 |
| LEDGER:19 | T7.3 |
| LEDGER:20 | T7.3 |
| LEDGER:21 | T8.2 |
| LEDGER:22 | T8.2 |
| LEDGER:23 | T8.2 |
| LEDGER:24 | T9.5 |
| LEDGER:25 | T9.5 |
| LEDGER:26 | T9.5 |
| LEDGER:27 | T9.1 |
| LEDGER:28 | T5.8 |
| MEAS:0 | T0.2 |
| MEAS:1 | T0.2 |
| MEAS:2 | T0.2 |
| MEAS:3 | T0.2 |
| MEAS:4 | T0.2 |
| MEAS:5 | T0.2 |
| MEAS:6 | T0.2 |
| MEAS:7 | T0.2 |
| MEAS:8 | T0.2 |
| MEAS:9 | T0.2 |
| MEAS:10 | T0.2 |
| MEAS:11 | T0.2 |
| NOTRIG:0 | T11.2 |
| NOTRIG:1 | T11.2 |
| NOTRIG:2 | T11.2 |
| NOTRIG:3 | T11.2 |
| NOTRIG:4 | T11.2 |
| NOTRIG:5 | T11.2 |
| NOTRIG:6 | T11.2 |
| NOTRIG:7 | T11.2 |
| NOTRIG:8 | T11.2 |
| NOTRIG:9 | T11.2 |
| NOTRIG:10 | T11.2 |
| NOTRIG:11 | T11.2 |
| NOTRIG:12 | T11.2 |
| NOTRIG:13 | T11.2 |
| NOTRIG:14 | T11.2 |
| NOTRIG:15 | T11.2 |
| NOTRIG:16 | T11.2 |
| NOTRIG:17 | T11.2 |
| NOTRIG:18 | T11.2 |
| NOTRIG:19 | T11.2 |
| NOTRIG:20 | T11.2 |
| NOTRIG:21 | T11.2 |
| NOTRIG:22 | T11.2 |
| NOTRIG:23 | T11.2 |
| NOTRIG:24 | T11.2 |
| NOTRIG:25 | T11.2 |
| NOTRIG:26 | T11.2 |
| NOTRIG:27 | T11.2 |
| NOTRIG:28 | T11.2 |
| NOTRIG:29 | T11.2 |
| NOTRIG:30 | T11.2 |
| PENDING:0 | T2.1 |
| PENDING:1 | T2.2 |
| PENDING:2 | T1.1 |
| RDIR:0 | T6.1 |
| RDIR:1 | T6.1 |
| RDIR:2 | T6.1 |
| RDIR:3 | T6.1 |
| RDIR:4 | T6.1 |
| RDIR:5 | T6.1 |
| RDIR:6 | T6.1 |
| RDIR:7 | T6.1 |
| RDIR:8 | T6.1 |
| RDIR:9 | T6.1 |
| RDIR:10 | T6.1 |
| RDIR:11 | T6.1 |
| RDIR:12 | T6.1 |
| RDIR:13 | T6.1 |
| RDIR:14 | T6.1 |
| RDIR:15 | T6.1 |
| RDIR:16 | T6.1 |
| RDIR:17 | T6.1 |
| RNOTE:0 | T6.1 |
| RNOTE:1 | T6.1 |
| RNOTE:2 | T6.1 |
| RNOTE:3 | T6.1 |
| RNOTE:4 | T6.1 |
| RNOTE:5 | T6.1 |
| RNOTE:6 | T6.1 |
| RNOTE:7 | T6.1 |
| RSYM:0 | T6.1 |
| RSYM:1 | T6.1 |
| RSYM:2 | T6.1 |
| RSYM:3 | T6.1 |
| RSYM:4 | T6.1 |
| RSYM:5 | T6.1 |
| RSYM:6 | T6.1 |
| RSYM:7 | T6.1 |
| RSYM:8 | T6.1 |
| RSYM:9 | T6.1 |
| RSYM:10 | T6.1 |
| RSYM:11 | T6.1 |
| RSYM:12 | T6.1 |
| RSYM:13 | T6.1 |
| RSYM:14 | T6.1 |
| RSYM:15 | T6.1 |
| RSYM:16 | T6.1 |
| RSYM:17 | T6.1 |
| RSYM:18 | T6.1 |
| RSYM:19 | T6.1 |
| RSYM:20 | T6.1 |
| RSYM:21 | T6.1 |
| RSYM:22 | T6.1 |
| RSYM:23 | T6.1 |
| RSYM:24 | T6.1 |
| RSYM:25 | T6.1 |
| RSYM:26 | T6.1 |
| RSYM:27 | T6.1 |
| RSYM:28 | T6.1 |
| RSYM:29 | T6.1 |
| RSYM:30 | T6.1 |
| RSYM:31 | T6.1 |
| RSYM:32 | T6.1 |
| RSYM:33 | T6.1 |
| RSYM:34 | T6.1 |
| SCALE:0 | T3.1 |
| SCALE:1 | T3.2 |
| SCALE:2 | T3.2 |
| SCALE:3 | T3.2 |
| SCALE:4 | T3.2 |
| SCALE:5 | T5.2 |
| SCALE:6 | T5.2 |
| SCALE:7 | T5.2 |
| SCALE:8 | T5.9 |
| SCALE:9 | T5.1 |
| SCALE:10 | T11.2 |
| SCALE:11 | T5.5 |
| SCALE:12 | T5.3 |
| SCALE:13 | T5.4 |
| SCALE:14 | T11.2 |
| SCALE:15 | T7.6 |
| SCALE:16 | T7.6 |
| SCALE:17 | T11.2 |
| SCALE:18 | T9.3 |
| SCALE:19 | T7.3 |
| SCALE:20 | T9.3 |
| SCALE:21 | T11.2 |
| SCALE:22 | T11.2 |
| SCALE:23 | T11.2 |
| SCALE:24 | T11.2 |
| SCALE:25 | T5.4 |
| SCALE:26 | T11.2 |
| SCALE:27 | T11.2 |
| SCALE:28 | T11.2 |
| SCALE:29 | T11.2 |
| SKILL:0 | T10.1 |
| SKILL:1 | T10.1 |
| SKILL:2 | T10.1 |
| SKILL:3 | T10.1 |
| SKILL:4 | T10.1 |
| SKILL:5 | T10.1 |
| SKILL:6 | T10.1 |
| SKILL:7 | T10.1 |
| SKILL:8 | T10.1 |
| SQL:0 | T5.7 |
| SQL:1 | T5.7 |
| SQL:2 | T5.7 |
| SQL:3 | T5.7 |
| SQL:4 | T5.7 |
| SQL:5 | T5.7 |
| SQL:6 | T5.8 |
| SQL:7 | T5.9 |
| SQL:8 | T5.6 |
| SQL:9 | T5.8 |
| STALE:0 | T7.4 |
| STALE:1 | T5.2 |
| STALE:2 | T5.4 |
| STALE:3 | T5.4 |
| STALE:4 | T4.1 |
| STALE:5 | T6.1 |
| STALE:6 | T9.3 |
| SURF:0 | T11.1 |
| SURF:1 | T11.1 |
| SURF:2 | T11.1 |
| SURF:3 | T11.1 |
| SURF:4 | T11.1 |
| SURF:5 | T11.1 |
| SURF:6 | T11.1 |
| SURF:7 | T11.1 |
| SURF:8 | T11.1 |
| SURF:9 | T11.1 |
| SURF:10 | T11.1 |
| SURF:11 | T11.1 |
| SURF:12 | T11.1 |
| SURF:13 | T11.1 |
| SURF:14 | T11.1 |
| SURF:15 | T11.1 |
| SURF:16 | T11.1 |
| SURF:17 | T11.1 |
| SURF:18 | T11.1 |
| SURF:19 | T11.1 |
| SURF:20 | T11.1 |
| SURF:21 | T11.1 |
| SURF:22 | T11.1 |
| SURF:23 | T11.1 |
| SURF:24 | T11.1 |
| SURF:25 | T11.1 |
| SURF:26 | T11.1 |
| SURF:27 | T11.1 |
| SURF:28 | T11.1 |
| SURF:29 | T11.1 |
| SURF:30 | T11.1 |
