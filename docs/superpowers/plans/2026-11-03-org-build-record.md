# Organization end-to-end build record

What the master plan (`2026-11-02-organization-end-to-end-implementation.md`) asked for at each step, and what was
actually done. Written 2026-11-03, after the build; the plan's checkboxes were ticked from this record.

## Step 0, recorded after the fact

Step 0 was not run before the first line of code. What it asked for, recorded now:

- **Git:** local `main` is 81 commits ahead of `origin/main` (`fa12f9171`). Nothing was pushed. The working tree also
  holds the owner's untracked `.claude/skills/security-audit/`, `docs/organization-*.md`,
  `docs/trust-and-safety-concept.md`, `skills-lock.json` and modified `artifacts/*.json`. None of it is part of
  this build.
- **The 44.4 count:** not run. Only the owner can run it, in the Supabase SQL editor (pilot runbook step 1).
- **Baseline before code:** not taken. Instead, a before/after benchmark was run on 2026-11-03: the same script,
  origin/main and local main, on the same disposable database. The workspace has 600 tasks, 400 files and
  20 members. Each figure is the median of 3 runs of 25 samples:

  | Normal workspace read | origin ms | main ms | Change | Limit |
  |---|---|---|---|---|
  | Tasks: `fetchWorkspaceTasksAction` (100) | 4.4 | 4.9 | +11% | 20% |
  | Files: `getWorkspaceNodes` (100) | 2.3 | 2.3 | 0% | 20% |
  | Overview: `readWorkspaceDetailShell` | 2.0 | 2.0 | 0% | 20% |
  | Overview: `readWorkspaceRecentActivityAction` | 1.3 | 1.3 | 0% | 20% |

  Organization scale, from `tests/db/organizations-scale.test.ts` with 2,000 members (no origin baseline, since the
  feature is new):
  - Publish to 1,999 people: 3.0 s
  - Members: 127 ms
  - Overview: 33 ms
  - Sidebar: 11 ms
- **Migration numbering:** 0042–0058; `check:db:migration-journal` passes.
- **`test:e2e:critical:dev` and `check:route-baseline-regression`:** not run. Both need a disposable Supabase
  project (`E2E_SUPABASE_URL` and keys); `assertE2EEnvironmentIsolated` refuses the primary project, as it should.
  This machine has no Docker, so there is no local Supabase either.

## Per-step workflow, honestly

| Workflow item | What happened |
|---|---|
| Cut (`ponytail-audit`, `ponytail-debt`) | Not run per step. `ponytail-review` ran on the whole phase twice (3ba355c66..b7cfe8fb9, and 09fd4345a..6fd38470d); its cuts were applied. |
| Plan | Step plans exist for 1c, 1d, T, 2, 3, 4, 7, 8, 11, 12, 13, 14 and the pilot. Steps 1a, 1b, 5, 6, 9, 10 and D were built straight from the master plan; their commits are listed below. |
| Scope guard (`freeze`) | Not used. Others share this checkout, so only this build's files were staged. |
| Build (TDD) | Each step's SQL and query changes have DB tests; see the test files per step. |
| Measure | Not per step. One before/after benchmark (above) plus the scale test. |
| Review | `ponytail-review` as above. Correctness was reviewed inline, plus browser tests for the riskiest paths. The gstack `review` skill's subagents and Codex were not run. |
| Gate | typecheck, unit, DB, browser and the four contract checks, run at the end of the phase (see the last section). Lint fails only on the owner's untracked `.claude/skills/security-audit/` files. |
| Ship, canary | Not done: needs the owner's approval (pilot runbook). |
| Talk | Short status messages and one-line commit subjects. |

## Steps without their own plan

| Step | Commits |
|---|---|
| 1a Privacy | df5d1b871, ae93abab5, 45ed9f927, 3ba355c66 (permissions table and journal dates) |
| 1b Correct work | 9a6659133 … e80d9cde1 (23 commits), bdc1520b3, eedb09eed |
| 5 About | 871103d1f, 4e38e4add |
| 6 Invite panel and join page | f9bc3da76, 4e38e4add |
| 9 Settings | 5a9e7bf24, 60ce15b8d, 6db4b85e0, 8b32f1334, 27b921407, 657aea748, 4e38e4add |
| 10 Documents | 8b7f4e739 |
| D Discover | cb4f6d82b |

## The second audit (2026-11-03)

Checking all 207 plan items against the code turned up these gaps. All are now built:

- **Decision 75:** the last four browser pop-ups now ask in the shared dialog. That covers profile leave, workspace
  links, file navigation and upload collisions. A unit test fails if `window.confirm`, `prompt` or `alert` comes
  back anywhere in `src` (09fd4345a, 6fd38470d).
- **Calendar tokens:** only the token's SHA-256 is stored, and the link is shown once (fac2f7b62).
- **The "no team lead" notice:** it waits for the removal to commit (`transactionThen`/`afterCommit`). It also used
  to skip the lead whenever an organization admin did the removal; now it doesn't (fac2f7b62).
- **Preview as member:** it was made to hold in search and the sidebar too (fac2f7b62). The owner then asked for the whole feature to be removed (3 Nov 2026), and it was.
- **Reviewers:** they can be picked when an assignment is created (fac2f7b62).
- **33.7 "Nobody reviews for a week":** the review row turns amber and shows the oldest wait (b8f751b14).
- **33.7 "Term ends with nothing archived":** the prompt stays after the term ends (b8f751b14).
- **33.7 and the rest of 16.12:** every row is walked through the real actions in
  `tests/db/organizations-scenarios-33-7.test.ts` (b8f751b14).

## Left for the owner

The 44.4 count; a disposable Supabase project for `test:e2e:critical:dev`, the route baseline and the signed-in
two-browser walks; the seven `LEGAL_*` values and the lawyer's review; the Resend and Inngest plans; approval for
each deploy stage, including running `scripts/org-release-notice.ts` after 1a, 1b and 1c; and the pilot itself.

## Gate (2026-11-03, after the second audit)

Run on a freshly rebuilt disposable database (58 migrations):

- **typecheck, lint and contract checks:** typecheck passes. Lint of `src`, `tests` and `scripts` passes.
  `check:terminology`, `check:authz-contract`, `check:rls-contract`, `check:db:migration-journal`,
  `check:api-envelope-contract` and `check:page-contract` all pass.
- **Unit:** 3,110/3,110.
- **DB:** 810/810.
- **Browser (Chromium and WebKit):** 401 passed, 3 skipped, none failed.
