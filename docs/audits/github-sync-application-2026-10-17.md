# GitHub Sync: approved design implemented in the application

2026-10-17 · application and worker implementation · code-only verification

The approved `github-sync-design.html` flow has been implemented in the project Files tab. Preview playback, fictional actors, sample repositories and simulated outcomes are not shipped in the product. Product screens use authenticated server actions, actual source revisions and durable run results. Messages is outside this change.

## Interaction and visual structure

2026-10-18 divider correction: the Sync stylesheet and shared controls referenced undefined `--border-subtle`, `--border-default`, surface, text and focus-ring tokens. These are now mapped directly to the application's canonical `--border`, `--background`, `--card`, `--muted`, `--foreground`, `--muted-foreground` and ring utilities. This restores existing preview boundaries across repository context, routes, activity, tables, review footers, inspection metadata, confirmations, team/history rows and dialogs without adding extra separators or changing spacing. A code-only CSS parse confirmed all 93 theme-token references resolve, 12 section/table/dialog boundary selectors use the canonical border, and light/dark divider colors match the approved preview. All 88 code-render checks passed, including its 85 approved scenarios; scoped lint passed. No browser monitoring was used.

- One connected overview: repository/branch context, Settings, Compare → Review → Confirm sequence, compact Push/Pull choices, one comparison action, secondary activity/history and retained-operation recovery.
- Flat setup: inline back/title/guidance and Create new/Connect existing switch. Owner choices come from the authenticated GitHub account and organization memberships; another organization can be entered explicitly. Visibility, initial/source/target branch, compact direction controls and publication method remain contextual. Repository/branch setup does not save a connection or create a remote branch during comparison.
- New branch dialog: Git-compatible validation, existing starting branch, duplicate-name handling, initial-branch naming for empty/new repositories, write-permission guidance and deferred creation. Pull uses existing source branches. Direct push and PR source/base branches are separate. Returning to an existing branch restores the prior publication method.
- Compact file review: arrow-only back, inline title/subtitle, single-line wrapping transfer route and filter/search/selection toolbar. No default file selection. Deletions and exact renames may be selected deliberately; exclusions and unresolved conflicts are not included by Select eligible. Filtering/paging never silently clears selection.
- Metadata follows Files: Name, Last updated, Size, Updated by and Inspect. Outgoing updater/time are read from the current project-file version and live profile. Incoming source author/time are fetched lazily for visible paths at the immutable reviewed commit. Names and 18px profile images are distinct from Git co-author credit. Relative timestamps reuse the Files formatter, with the full date available as a title. Missing records stay unknown; failed images preserve the name.
- Inspection is contextual, with a retry for failed diff reads, binary/large-file fallback, full side-by-side comparison, common baseline, directional conflict resolution, skip and editable combined text. Failed blob reads no longer become an apparently empty successful comparison.
- Compact commit/import message and publication controls, contextual attribution, final reviewed selection and explicit confirmation. Public visibility, remote branch creation, deletion consequences and PR-versus-merge behavior are repeated where the user commits the action.
- Recorded stages for both directions. Queued is not completed. Pull shows durable applied operations against the immutable selected total; verification remains a separate stage. Push has no invented percentage, timer or ETA. Active checks pause while the document is hidden and retain a last-checked time plus reconnect feedback.
- Durable results and recovery: queued cancellation with an execution-race guard, review expiry, changed local/remote baselines, interruption, partial import, created repository, published-commit follow-up, branch protections, workflow permission, rate limits and offline state. Safe retry reuses the operation and its external effects. A changed baseline requires a new comparison. A setup-change route remains available before publication; a published commit is not blindly republished.
- Plain attribution and repository settings, verified commit-email choices, team linking status, explicit destination confirmation and disconnect confirmation. Unlinked team members do not block a transfer. Only the project owner can configure/execute; other members may choose their own verified attribution.
- Application fonts and semantic tokens, thin dividers, compact notices, 34px desktop controls, 28px small controls and 44px coarse-pointer targets. Checkbox/radio glyphs remain small inside larger labels. Container rules stack controls/metadata at narrow workspace widths; long paths and mixed-direction text wrap. Dialog titles/actions remain available while scrolling.

## Backend behavior and integrity

The manifest has backward-compatible optional `newBranch`, `visibility` and per-file update metadata. No schema migration is needed. All comparisons, metadata reads, preparation and mutations retain owner/session checks. Server-side comparison validates the new-repository owner/membership and accessible name collisions before review. GitHub's own creation policy is enforced again by the actual creation API.

A pending new branch compares against the chosen base commit. At publication the worker checks the base and missing target, and the native publisher uses an empty ref lease for the new branch, so a branch created concurrently cannot be overwritten. PRs use the chosen new source branch and its separate base. GitHub branch protection remains authoritative.

Changing the connection is explicit through Settings or happens when the reviewed transfer succeeds. New repository creation remains a recorded external effect during partial failure. Existing run IDs, snapshot integrity checks, workflow authorization, per-project active-run uniqueness and worker leases remain in place.

Exact outgoing renames now remove the old path in the published snapshot and preserve unselected files. Incoming renames keep their existing canonical file identity behavior. Excluded paths remain visible with reasons, while preparation/publishing still block them. Literal paths named `constructor`, `toString` or `__proto__` are treated as ordinary unselected filenames rather than inherited object properties.

Cancellation now checks the updated row before claiming success. Review/failed/needs_review states remain reachable on remount through the latest recorded operation; historical reviews cannot permanently block a later completed transfer. Obsolete prepared reviews are cancelled before a replacement is prepared.

## Sign-in and permission recovery

The application uses its canonical GitHub identity-link and repository-authorization helpers. A pending redirect can be cancelled before navigation; a superseded request cannot redirect the user when its provider lookup returns. The OAuth destination must match the configured Supabase authorization endpoint. The existing provider/session, account-match and PKCE callback checks remain authoritative.

Access denial and unverifiable exchanges return to the requesting Sync workspace with a specific recovery message. Setup and file choices are retained in a bounded, expiring, viewer/project-scoped session draft. Restoring selected paths performs a fresh comparison and drops stale/blocked choices with an explanation; it never submits a transfer automatically. Prepared run IDs resume their retained review/recovery state. Organization access can be checked after approval without automatically restarting identity linking.

## Scenario coverage

The complete 85-state approved preview inventory is preserved in `tests/fixtures/github-sync-approved-scenarios.json`. Each entry is mapped to the real application's JSX in the code-only rendering suite, including loading/error/readonly, setup/auth/access states, review/metadata/inspection/limits, queued/progress/reconnect, recovery/results, branches, settings and history. These checks parse the actual rendered markup and validate named actions, unique IDs and label structure; they are not screenshot comparisons.

Additional behavioral tests cover setup and selection invariants, default-unselected semantics, Git ref syntax, expiry/partial-result retry rules, viewer-scoped OAuth drafts, changed-revision restoration, cancelled/superseded sign-in requests and rejection of unexpected authorization destinations. Local bare-Git tests prove branch/base separation, refusal to overwrite an existing new-branch ref, source branches for PR publication, exact rename removal, executable bits and preservation of unselected files.

## Verification

- `npm run build`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- ESLint on the changed application/GitHub modules and new tests: passed.
- `node --import tsx --test tests/unit/*github*.test.ts tests/unit/files-tab/*github*.test.ts tests/unit/repo-validation.test.ts tests/unit/auth-oauth.test.ts`: 193 tests passed, including 85 approved scenario entries.
- Scoped `git diff --check`: passed.

No browser monitoring or live GitHub authorization/publication was performed. These checks establish code paths, markup, native Git behavior and compilation, not measured rendered geometry or a live organization policy decision. Live OAuth/SSO, deployment worker delivery, branch protections and real pull-request creation still require an authorized disposable repository. No real repository, branch, PR or project file was created or published during implementation.

## Deployment and rollback

2026-10-18 scope clarification: GitHub identity linking, repository authorization, repository/branch creation, native Git publication, pull-request creation and incoming file application are implemented production paths, not preview simulations. The earlier statement about no live authorization/publication described testing only. The user requested code-only checks and no repeated live verification; no further browser sign-in or live publication is required for this implementation task. No test repository, branch, pull request or project file was created in the follow-up. The existing implementation and verification results above are retained.

Deploy the application and reviewed-sync worker code together: new-branch manifests require the updated publisher/PR-base behavior. No database migration or manual data rewrite is required. Existing manifests without the optional fields remain supported.

For rollback, finish already-confirmed operations with the current worker and cancel unsubmitted reviews that use the new manifest behavior before reverting the UI/worker changes together. Retain all run records and external effects. Do not remove created repositories/branches or reverse partial imports as an automatic rollback. Preserve unrelated working-tree and Messages changes.
