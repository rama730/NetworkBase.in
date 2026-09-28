# Speed audit — implementation record (2026-09-28)

Implements `docs/superpowers/plans/2026-09-27-networkbase-speed-audit.md` on local `main`, from baseline commit `b9e97a37` to `994d3419` (45 commits). Code only: no migration was run on Supabase and nothing was changed in Railway.

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
| T2.1 Docs table migration | blocked | Classifier blocked the DROP migration; write it yourself using the new `project_doc*` names |
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
| T5.8 drop unused objects | blocked | Classifier blocked the commit; patch at `scratch/t58-drop-unused.patch` (regenerate its journal hunk). `nb_validate_dm_conversation` is **in use** by two triggers — kept |
| T5.9 single node-events table | done | `284a7304` (`0173`, tested locally) |
| T5.10 query shape | done | `9ebf645c`; badge count was already one FILTER query; E2E already refuses the app database |
| T6.1 Discover / Network / My profile | done | `dca2efb8`; 308 redirects kept |
| T6.2 duplicate and hidden routes | done | `a446ffdd`; production calls `/api/inngest` (103k/week), so that path was kept and the v1 alias removed; `admin/notifications` kept |
| T6.3 merge privacy and sessions routes | done | `191898b0` |
| T7.1 static legal pages | partial | `58a6362c` removed redundant `force-dynamic`. Static legal pages conflict with the nonce CSP (Next inlines per-request scripts); making them static needs `unsafe-inline` — not done |
| T7.2 parallel reads | partial | `aebf625f` sprint read now parallel. Layout already verifies auth locally; file/task metadata titles left as is |
| T7.3 i18n, flags, revalidations | done | `3473c27a`; only one `revalidatePath` was dead — the rest refresh the current page after an action |
| T7.4 fewer queued actions | partial | `e6ec875e`, `3e1792f5`, `d8c3ef08`. Files-tab reads take per-call arguments; not merged |
| T7.5 emitters | done | `51edd3db` (removed; wire later if wanted) |
| T7.6 caches | partial | `f326b3da` weights as constants. Discover snapshot cache kept: it hides the cross-region DB round trip until the region move. No in-flight dedupe overlaps a `cache()` wrapper |
| T8.1 root providers | done | `fc58e253`; `MotionConfig` removed later with framer-motion |
| T8.2 skill icons | partial | `e8d73afb`, `13d2eff2`; also fixes 6 broken numbered Lucide icons. Client skill catalog kept: removing it needs resolved skills in every read model |
| T8.3 auth pages | partial | `3884d7f6` (third-party scripts on idle). Server-shell rewrite needs signed-in visual QA |
| T8.4 split large components | deferred | Needs signed-in visual QA |
| T8.5 timers, polls, fonts | done | `9a28b9c3`; `prefetch={false}` kept (default prefetch on dynamic routes adds requests) |
| T8.6 motion, dates, theme | partial | `cc2c8c05`, `2ffc732c`, `c5b210ae`. Theme provider shrink needs signed-in QA of appearance sync |
| T9.1 packages and lockfiles | done | `1300b331` |
| T9.2 test-only code | done | `cce70b55` (−2,247 lines) |
| T9.3 telemetry, scale tooling, env knobs | done | `021c1cda`; `MOCK_USER_ID` auth bypass removed; bloom filter was write-only |
| T9.4 conventions and build config | partial | `c1642aab`. Barrels kept (`"use server"` files cannot re-export). E2E alias kept (keeps dev sign-in code out of prod bundles). Turbopack builds 5× faster but ships ~60 KB more JS per page — webpack kept |
| T9.5 clutter | partial | `44ad74dd`; `.agents/` and `skills/` kept (Codex skills) |
| T10.1 skill workflow | done | `65dc6310` |
| T11.1 re-measure | done | this file; analyzer fix `994d3419` |
| T11.2 stale markers | done | all seven listed markers are gone |

## Production checklist (you run these)

1. Apply migrations `0150`–`0171` and `0173` in order (there is no `0172` until you apply the T5.8 patch).
2. Switch Railway production to `main` (Dockerfile builder); consider moving to the database region.
3. Unset `PROJECT_VIEWS_WRITE_THROUGH`, `DOC_COLLABORATION_TOKEN_SECRET`, `REDIS_URL`.
4. Supabase: limit API exposed schemas to `public`; enable leaked-password protection.
5. Point E2E at a disposable database (`E2E_DATABASE_URL`).
6. Reset `pg_stat_statements` after deploy and re-check the slow queries.
