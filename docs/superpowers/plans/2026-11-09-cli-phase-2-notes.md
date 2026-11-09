# CLI Phase 2 — notes

Commits on local `main`, not pushed: `e3e212d98` (2.0 core), `50554fb93` (package, release, owners), `6f8fe6d97` (security review fixes, offline queue), `b5e951266` (update notice, feedback, setup shell, member list), `b091bb4f7` (parallel pull).

## Numbers (fake API on this Mac, median)

| Measure | 1.0.4 (Phase 0) | 2.0.0-next.1 | Budget (A13.8) |
|---|---|---|---|
| Unpacked package | 193,446 B | 192,466 B | see below |
| `nb --version` | 83 ms | 72 ms | < 120 ms ✓ |
| `nb help` | 83 ms | 76 ms | < 200 ms ✓ |
| Push 1 file | 107 ms | 148 ms | — |
| Push 50 files | 111 ms | 161 ms | — |
| Pull 1,000 files (empty folder) | 355 ms | 730 ms | — |

- 2.0 does more per file: it reads the manifest first (base versions, conflicts), verifies every download's SHA-256, and keeps a copy for offline `nb diff`. Pull was 9.9 s before `b091bb4f7` (one file at a time, state and an fsync'd cache copy written per file).
- The Phase 0 bench didn't check exit codes; the 1.x push numbers are real (`--draft` was a 1.x flag), but whether the 1.x pull baseline actually downloaded 1,000 files wasn't checked. The bench now fails on any command error.

## Decisions and deviations

- **Size budget.** A13.8 aimed for < 150 KB. 2.0 is 192 KB without minifying (no build step: zero dependencies, readable source). CI now holds it to "no bigger than 1.0.4" (193,446 B); `CHANGELOG.md` ships in the repo and GitHub releases, not the tarball. Phase 3 adds the MCP server (~20–30 KB). **Decision for the user before Phase 3 ships:** raise the budget to 250 KB, or add a minify step to the release job?
- **`nb watch` pulls nothing yet.** It pushes saves of tracked files as drafts; pulling teammates' changes live is P5.3 (needs the events stream). Help text says so.
- **Offline queue (A12.4).** Pushes that can't reach the server go to `.networkbase/queue.json` (exit 8); `nb sync` sends them in order. Idempotency keys are derived from the queue entry id plus each batch's paths, hashes and base versions, so a push that reached the server before the connection dropped isn't stored twice. A teammate's change in between is a conflict. Entries older than 7 days are dropped with a note. Pull and read commands don't queue (they say offline).
- **1.x flags.** `push --done/--wip` and `sync --done` are accepted (hidden from help), upload only, and say which command changes status.
- **`nb feedback`** prints the report; nothing is sent (no form exists on networkbase.in yet). Tokens, `@names`, the folder path, home folder and workspace slug are replaced.
- **`nb prompt`** is hidden from `nb help` (it's for shell prompts) and prints nothing on stderr.
- **Security review of `e3e212d98`** (automated): four findings, all fixed in `6f8fe6d97` — `task pull` and `resolve --both` no longer let a server path choose where a local file goes; `doc edit` gives the editor a plain file name; `file view` hides C1 controls.
- **Production `/api/v1/me` is 404** until Phase 1 is deployed, so 2.0 can't sign in against networkbase.in yet. The 2.0 release needs Phase 1 deployed first.

## Not done in Phase 2

- `nb undo` (needs server undo tokens, P3.4/P4.5); `nb activity` (P5.2).
- `--fields`, the pager, OSC 8 links and SIGWINCH redraw (no live-redrawing view exists yet; the question card prints once).
- Crash-at-every-step test, 250 MB upload memory test, "first push < 60 s on clean macOS/Windows/Linux": need CI runners or VMs; the Windows path is untested locally.
- `x-nb-min-client` / `CLIENT_TOO_OLD` (server half moved with P1.11).
- `nb mcp` and the 2.0 release itself wait for Phase 3 (P3.2).

## Phase 3 start (MCP)

- **Size budget raised to 250 KB** (the recommended option above): with `nb mcp` the package is 224.5 KB; startup is unchanged (71 ms) because command modules load only when used. Minifying stays possible later.
- **Found while building the tools:** `--workspace <slug>` was sent to the API as-is (routes need the id). Fixed: the slug or title is looked up once before the command runs.
