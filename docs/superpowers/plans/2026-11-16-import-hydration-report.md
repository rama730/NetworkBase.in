# Imported files without stored content (report, 2026-11-16)

Found in the CLI 2.1.6 live check: `nb start` in a folder named `ponytail` stopped on the first file with no stored content. This report covers what's wrong, why, what people see, and a fix plan. Nothing has been changed.

## What's wrong

12,233 imported files exist as entries (name, size, Git blob hash) with no stored content. Every one has its Git blob hash, so it can be fetched from GitHub.

| Workspace | Repository (public) | Files | No content | Imported |
|---|---|---|---|---|
| antigravity-awesome-skills | sickn33/antigravity-awesome-skills | 17,421 | 11,669 | 31 May |
| gstack | garrytan/gstack | 379 | 379 | 31 May |
| ponytail | DietrichGebert/ponytail | 143 | 143 | 6 Jul |
| caveman | JuliusBrussee/caveman | 143 | 40 | 22 May |
| deepscope-ai | (GitHub import) | 1,153 | 1 | 5 Feb |
| qa-files-workspace-controls | (not an import) | – | 1 (no Git hash) | 11 Feb |

## Why

An import has two phases:

1. The import runner (`src/lib/github/workspace-import-runner.ts`) writes one "virtual" entry per file, with the Git blob hash and no content, then sends `workspace/import.hydrate`.
2. The hydrate job (`src/inngest/functions/workspace-import-hydrate.ts`) downloads the repository archive once and stores each file's content with its first version.

For these four imports, phase 2 never stored anything. There isn't a single version with `attribution.source = "github_hydration"` in any of them. The files that do have content got their versions from a one-off repair on 1–2 October (`missing_file_version_repair`, `scripts/db/repair/repair-missing-file-versions.ts`), and their content was already stored by some earlier path. Git history from May to July is squashed, so the exact cause at the time can't be read back. Three things in today's code make a silent failure likely, and would again:

1. **One step for the whole repository.** Hydration streams the archive and stores every file inside a single `step.run`. A 17,000-file repository can't finish within one run. Each retry starts over, and after the retries run out, `onFailure` marks the import failed, but only through the stored record (see 2).
2. **The runner overwrites the hydration record.** The runner sends the hydrate event and then writes the import record from a copy it read earlier. That write drops `metadata.hydration` if hydrate has already started, and hydrate only finishes the record when it still finds it (`if (finalImportSource?.metadata?.hydration)`). So these workspaces show `sync_status: ready`, with no hydration status and no error.
3. **A dropped event looks like success.** If Inngest accepts the event but never runs it (for example over the free limit, which was far exceeded by late October), the import stays "ready" for good.

The fallback, fetching a file from GitHub when it's opened (`tryRecoverFromGitHub` in `src/lib/files/content-reader.ts`), uses GitHub's API without a token for these public repositories (no app installation, no stored token). GitHub allows 60 such calls an hour per IP, shared by everything on the server. That's why `nb start` in Ponytail got about 26 files and then nothing.

## What people see today

- **Files tab:** the files are listed with their sizes. Opening one fetches it from GitHub one by one. Once the limit is reached, the preview fails with "File content is unavailable. It has not been replaced with an empty file."
- **CLI and agents:** `nb pull` used to stop at the first such file with a 500, and the files already fetched then read as conflicts. Fixed locally in 4205edd62: the route answers 409 `CONTENT_NOT_READY` and `nb pull` skips those files with a note. It isn't deployed yet.
- **Downloads, search, agents' file reads:** the same failure for these files.

## Fix plan

1. **Hydrate in batches, resumably (code).**
   - Hydration becomes one step per batch: about 500 files that still have no content, taken from the archive and stored as now.
   - Each step re-reads only what is still missing, so a retry or a re-run carries on where it stopped.
   - Progress and the final status are written so they can't be overwritten: the runner's last write keeps `metadata.hydration`, or the event is sent after that write.
   - The import counts as "ready" only when no file is left without content. Otherwise it says "files still downloading", or "failed", with the count.
   - Test first: a DB test with a fake archive of 1,200 files, killed after batch 1, that resumes; and one that the runner's write keeps the hydration record.
2. **Say so in the app (code).**
   - A file not yet fetched shows "Not downloaded from GitHub yet", with Fetch now (one GitHub call, or a hydration run for the whole workspace) instead of a failure.
   - The workspace header shows "1,234 files still downloading" while hydration runs.
3. **Backfill the four workspaces (production, needs your OK).**
   - Send `workspace/import.hydrate` once per workspace after step 1 ships: 4 events.
   - Inngest cost: about 25 steps for antigravity-awesome-skills (11,669 files ÷ 500) plus 1 each for the others, about 30 runs in all, against the free limit of about 1,650 a day.
   - Storage: the content of 12,231 files, about the repositories' size.
   - The repositories are public and the files match their Git hashes, so a file whose repository has changed since is skipped and reported, never replaced with other content.
   - The 2 single leftovers (deepscope-ai, the QA workspace) are listed for you to keep or delete.
4. **Optional: a server GitHub token (your step).** A read-only token for public repositories raises the per-file fallback from 60 to 5,000 calls an hour. It isn't needed once step 3 is done.

**Order:** 1 and 2 in one change, with tests. Then deploy with your go-ahead and Inngest re-synced, then 3 with your OK, then a live check that Ponytail pulls all 143 files.

## Built (local, 2026-11-16)

Commits f2c1968a3, 671038b37, 30d72a44f, 12bd7fe72. Not pushed; production unchanged.

- **Steps 1 and 2 built.**
  - `src/lib/github/import-hydration.ts` stores files in batches of 1,000 still without content, in path order, picking up after the last path. Progress and the result (done, incomplete with a sample of failed paths, failed) go in with `jsonb_set`.
  - The job (`workspace-import-hydrate.ts`) only calls it, one step per batch, at most one run per workspace at a time.
  - The import runner writes its record first, then queues hydration.
  - The Files tab shows "Not downloaded from GitHub yet", with Fetch now for people who can change the workspace (`src/app/actions/files/import-download.ts`, once per workspace every 10 minutes).
- **Tests:**
  - `tests/db/import-hydration.test.ts`: batches, skipping a mismatched or missing file, resuming after a stop, and the count.
  - `tests/db/import-download-action.test.ts`: who can fetch, one event, no credential in it, the 10-minute limit.
  - Contracts updated: `github-hydration-integrity`, COR-006.
  - Gates: unit 3,538, DB 1,060, CLI 269, typecheck 0.
- **Repositories now:** antigravity-awesome-skills was renamed `sickn33/agentic-awesome-skills` (GitHub redirects; 453 MB with history). gstack is 266 MB, caveman 22 MB, ponytail 13 MB, all public.
- **Backfill estimate:** 12 batches for antigravity plus 1 each for the others, about 20 Inngest steps in all.
- **Still to do, each needing your go-ahead:**
  1. Deploy (no migration).
  2. Re-sync the Inngest app: the job's concurrency changed.
  3. The backfill: one `workspace/import.hydrate` per workspace, or Fetch now in each.
  4. A live check that Ponytail pulls all 143 files.
