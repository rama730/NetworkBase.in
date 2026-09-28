# Speed audit — implementation record (2026-09-28)

Implements `docs/superpowers/plans/2026-09-27-networkbase-speed-audit.md` on local `main`, from baseline commit `b9e97a37` to `a6ee03a3` (47 commits). Code only: no migration was run on Supabase and nothing was changed in Railway.

## Measured results

| Measure | Before | After | How measured |
|---|---|---|---|
| Lines (whole repo) | — | +3,698 / −62,136 | `git diff --shortstat b9e97a37 HEAD` |
| Lines in `src/` | — | +1,970 / −5,721 | same, `-- src` |
| Runtime dependencies | 73 | 64 | `package.json` |
| Client JS, static and legal pages | 730 KB | 600 KB | local production build, sum of `<script>` files in the HTML |
| Client JS, `/login` · `/signup` | 1,020 · 1,024 KB | 1,001 · 1,005 KB | same |
| CSS | 438 KB | 308 KB | `.next/static/css` |
| Skill icons downloaded on first chip | 4.1 MB sprite | only the icons on screen | `public/skill-sprites.svg` deleted |
| App shell requests on load (static trace) | 9 | 4 | `roundtrips.cjs` + `surfaces.py` |
| Settings tab server actions on load | 6 (queued one at a time) | 1 | code: `readProjectSettingsBootstrapAction` |
| Auth network calls per surface (trace) | 1–13 | 0 | server `getUser` is local JWT verification; analyzer fixed |
| Unit suite | 40 failing suites | same 40 | `tsx --test tests/unit/**/*.test.ts` (no new failures) |

The "before" JS column is the build just before the provider move (same method); the P0 baseline file used a different, over-counting method.

## Round trips per surface (static trace, on load)

| Surface | Requests | Server actions | SQL statements reachable | Auth network |
|---|---|---|---|---|
| App shell (every signed-in page) | 9 → 4 | 7 → 2 | 54 → 14 | 8 → 0 |
| /discover | 4 → 4 | 2 → 2 | 49 → 49 | 2 → 0 |
| /messages | 8 → 8 | 6 → 6 | 57 → 57 | 7 → 0 |
| /my-profile | 9 → 9 | 4 → 4 | 69 → 69 | 8 → 0 |
| /projects/[slug] | 4 → 4 | 2 → 2 | 52 → 52 | 3 → 0 |
| /settings | 10 → 9 | 4 → 3 | 40 → 38 | 9 → 0 |
| Project · Files tab | 14 → 14 | 14 → 14 | 55 → 55 | 13 → 0 |
| Project · Settings tab | 8 → 1 action + 2 API | 6 → 1 | — | 8 → 0 |

The trace counts the six Settings loaders because they remain as the refresh path; on mount they all read from one bootstrap call.

## Status by task

| Task | Status | Commit(s) / reason |
|---|---|---|
| T1.1 Railway runtime on main | done | `88948db4` |
| T2.1 Docs table migration | done | `a6ee03a3` (`0175`): archives the 6 unpublished drafts, the draft contributor row and any assets into `app_private.retired_domain_archive`, then drops the asset and draft-contributor tables, draft columns, the asset function and enum, two unused version indexes, and the stale settings keys |
| T2.2 · T2.3 Docs env and one action per open | done | `5ce27149`, `7554bca0` |
| T3.1–T3.5 proxy, rate limits, landing, appearance, Tailwind | done | `69e414c5` … `84c3a6ba` |
| T4.1 · T4.2 single proxy, local auth only | done | `7286eda0`, `4f964302` |
| T5.1 Realtime publication | done | `87fdc7c6` (migration `0168`) |
| T5.2 DB pool | done | `60c7ad43` |
| T5.3 indexes | done | `2b59766d` (`0169`); dm_pairs duplicate already handled by `0154` |
| T5.4 crons | done | `310b6e21` |
| T5.5 presence | done | `f507104a` (the unconditional write was already gone on main) |
| T5.6 RLS / functions | done | `3232b889` (`0170`); policies already fixed by `0154` |
| T5.7 SQL naming | done | `a133287b` (`0171`, tested on a local Postgres) |
| T5.8 drop unused objects | done | `a6ee03a3` (`0174`): archives rows (20 in `profile_interests`) then drops 4 tables and 1 view; orphan `0152` and its exception removed. `nb_validate_dm_conversation` is **in use** by two triggers — kept |
| T5.9 single node-events table | done | `284a7304` (`0173`, tested locally) |
| T5.10 query shape | done | `9ebf645c`; badge count was already one FILTER query; E2E already refuses the app database |
| T6.1 Discover / Network / My profile | done | `dca2efb8`; 308 redirects kept |
| T6.2 duplicate and hidden routes | done | `a446ffdd`; production calls `/api/inngest` (103k/week), so that path was kept and the v1 alias removed; `admin/notifications` kept |
| T6.3 merge privacy and sessions routes | done | `191898b0` |
| T7.1 static legal pages | done (local) | `58a6362c`, `63a42d68`: `(site)` and `(legal)` root layouts share `RootDocument`; the 11 legal pages are prerendered (`x-nextjs-cache: HIT`). Trade-off: the proxy gives those paths `script-src 'self' 'unsafe-inline'` with no nonce; every other route keeps the nonce policy. The CSP contract pins this to the legal path list |
| T7.2 parallel reads | done (local) | `aebf625f`, `03ffacf7`: main layout paints providers and chrome after local auth and suspends only the content slot on the legal check; sprint detail streams as a promise under its own Suspense; file/task titles move client-side (two per-link DB reads removed) |
| T7.3 i18n, flags, revalidations | done | `3473c27a`; only one `revalidatePath` was dead — the rest refresh the current page after an action |
| T7.4 fewer queued actions | done (local) | `e6ec875e`, `3e1792f5`, `d8c3ef08`; `6d3d0ead` batches the Files tab header reads (git sync, installed IDEs, extension sessions) into one server action |
| T7.5 emitters | done | `51edd3db` (removed; wire later if wanted) |
| T7.6 caches | done (local) | `f326b3da` weights as constants; `c2810c1d` removes the Discover in-process snapshot cache (feed now reads the DB each request — pairs with the region move) |
| T8.1 root providers | done | `fc58e253`; `MotionConfig` removed later with framer-motion |
| T8.2 skill icons | done (local) | `e8d73afb`, `13d2eff2`; also fixes 6 broken numbered Lucide icons. `82fb90fd` moves the skill catalog out of the JS bundle into `/skill-catalog.json`, loaded on first use |
| T8.3 auth pages | done (local) | `3884d7f6`, `ea47e7cd`, `06e5d63a`, `8a757ed6`: auth pages drop the app provider stack and load Supabase on first action; login/signup are server shells (form HTML in the first response); legal footer links no longer prefetch; page titles. /login 269 → 163 KB gzip |
| T8.4 split large components | done (local, safe split) | `524c9d30`, `d40e490c`, `0c8618cc`, `98b2df16`: leaf components move to modules unchanged (ProjectSettingsTab 5,363 → 3,692, UpdatesTab 2,580 → 519) and on-demand dialogs load lazily. `9f672712`: General settings (identity, cover image drag) and collaborator search keep their own state, so typing or dragging no longer re-renders the whole tab (ProjectSettingsTab now 2,735 lines); unused section-dirty code removed; cheap useMemo removed in the settings tab; a dependency-aware pass removes 36 more useMemo/useCallback wrappers across the split components (the rest feed dependency lists or memoised children). Needs signed-in QA before push |
| T8.5 timers, polls, fonts | done | `9a28b9c3`; `1651ae60` drops `prefetch={false}` and manual route warming for default `Link` prefetch |
| T8.6 motion, dates, theme | done (local) | `cc2c8c05`, `2ffc732c`, `c5b210ae`, `1507b410` (theme provider 490 → 277 lines, same sync behaviour) |
| T9.1 packages and lockfiles | done | `1300b331` |
| T9.2 test-only code | done | `cce70b55` (−2,247 lines) |
| T9.3 telemetry, scale tooling, env knobs | done | `021c1cda`; `MOCK_USER_ID` auth bypass removed; bloom filter was write-only |
| T9.4 conventions and build config | done (local) | `c1642aab`; `84a9a38f` drops the action barrels (callers import from each module); `57574316` replaces the E2E alias with one auth route that 404s in production builds. Turbopack builds 5× faster but ships ~60 KB more JS per page — webpack kept |
| T9.5 clutter | done (local) | `44ad74dd`, `c9b57c2e`: screenshots, scratch/, tmp/, checkpoints/, graphify-out/, .agents/, skills/ and Playwright MCP logs moved to `~/nb-s3-clutter-archive/` (not deleted); QA matrices to `docs/qa/` |
| T10.1 skill workflow | done | `65dc6310` |
| T11.1 re-measure | done | this file; analyzer fix `994d3419` |
| T11.2 stale markers | done | all seven listed markers are gone |

## Production rollout (2026-09-28)

- `main` pushed to GitHub; both Railway services (`networkbase-web`, `networkbase-worker`) now deploy from `main` with the Dockerfile. Both deployments are healthy.
- All 22 pending migrations applied to production with `npm run db:setup`, after a full trial run inside a rolled-back transaction. Three migration files needed fixes first: `0150` (column already existed; now `ADD COLUMN IF NOT EXISTS`), `0163` (constraint names were double-quoted), `0164` (wrong column `path` → `file_path`; removed an index on columns `task_node_links` does not have).
- Checked after rollout: home, legal, login, Discover redirect, public project pages including the Docs and Updates tabs, health and readiness endpoints; no database errors in web or worker logs; Inngest calls to the worker keep returning 2xx.
- Regression found and fixed during rollout: the T5.2 database-client cleanup had removed the production switch from the Supabase session pooler (port 5432, 15-client cap shared by web and worker) to the transaction pooler (6543). Production briefly ran on the session pool and filled it. `6361193d` restores the switch; after redeploy the pages serve normally and the app logs show no connection errors.
- `check:db:live-lineage` still reports "strict migration order mismatch" because production applied `0161`/`0162` before `0153`–`0160`. Every migration is applied; only the historical order differs.

## Local-only follow-up (not pushed)

Commits `1651ae60` … `63a42d68` are on local `main` only; production still runs `6361193d`. No migration is involved.

- Checked locally on a production build: legal pages prerendered and hydrate with no CSP errors; `/login` and the global 404 keep the nonce CSP with every inline script nonced.
- Contracts: csp, head, scroll, page, query-key, runtime-boundaries pass. The scroll contract had been checking zero pages since the route-group move; it now checks `(site)/(main)`. build-rendering, appearance, brand and canonical-logic fail exactly as on the commit before (JS budgets 200/220 KB exceeded by ~8 KB on `/`, legal, `/login`, `/signup`; missing brand icon files).
- Unit suite: 41 failing suites, the same set as before these commits.

## Second local round (not pushed)

Commits `c9b57c2e` … `8a757ed6`. Checks on the final state:

- Unit suite 2,044 / 2,044 pass (was 41 failing suites); onboarding component tests 170 / 170; typecheck and whole-repo lint clean.
- Every offline contract passes. `check:build-rendering-contract` now measures the scripts each page's HTML loads from a production server; the old manifest lookup used Turbopack keys under webpack and reported static pages 60 KB too high and auth pages 45 KB too low. Measured: `/` and legal 144 KB gzip, `/login` 163, `/signup` 165, `/forgot-password` 157, `/reset-password` 155. Signed-in routes are listed as not measured there.
- `check:db:remigration-replay` still needs `DATABASE_URL_FRESH` (a disposable SSL Supabase database).
- Real defects fixed on the way: push notifications lost their badge icon (`icon-ink-64.png` was deleted); the attachment presign POST/PUT had no CSRF check; attachment redirects could be served for up to an hour after their signed URL expired; the scroll contract checked zero pages; Google One Tap's stylesheet was blocked by the CSP.
- Not verified here: signed-in screens (settings, updates, files, messages, create wizard, main layout). The component splits move code without changing it, but click through those screens before pushing.

## Remaining production steps (yours)

1. Set the web service's `INNGEST_EXECUTION_ROLE` to exactly `web` (its current value is rejected, so `/api/inngest` on the web domain returns 500; Inngest itself calls the worker, which works).
2. Unset `PROJECT_VIEWS_WRITE_THROUGH`, `DOC_COLLABORATION_TOKEN_SECRET`, `REDIS_URL`.
3. Consider moving the Railway services to the database region (ap-southeast-1).
4. Supabase: limit API exposed schemas to `public`; enable leaked-password protection.
5. Point E2E at a disposable database (`E2E_DATABASE_URL`).
6. Reset `pg_stat_statements` and re-check the slow queries after a day of traffic.
