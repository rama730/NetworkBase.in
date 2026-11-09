# CLI Phase 0 — notes

## Cut list (ponytail-audit, 2026-11-09)

Scope: `packages/nb-cli`, `src/app/api/v1/extension`. Ranked biggest cut first. These are removed or replaced in the phase named; nothing is deleted in Phase 0.

| Tag | Cut | Replacement | Where | Phase |
|---|---|---|---|---|
| delete | 1.x mirror model (`.networkbase/mirror`, `hydrateWorkspaceMirror`, mirror branches of `collectLocalFiles`, ~500 lines) | folder is the working copy (D1) | `bin/nb.mjs:159-275, 555-641, 2393-2461, 4344-4409` | 2 |
| delete | background daemon (`ensureBackgroundDaemon`, `stopBackgroundDaemon`, `getDaemonStatus`, `--daemon-worker`, `daemon.pid`) | foreground `nb watch` (D2) | `bin/nb.mjs:309-372, 4537-4652` | 2 |
| delete | three inline HTML pages in the loopback server (~250 lines, same CSS three times) | one small escaped template | `bin/nb.mjs:1451-1696` | 2 |
| delete | `writeLocalTaskIntelligence` (TASKS.md, tasks.json, cache.json) and its call sites | `nb task view --context`, MCP `task_context` | `bin/nb.mjs:173-274` | 2/3 |
| delete | `hook install`, `auth setup-git`, `auth git-credential` | nothing (D6) | `bin/nb.mjs:1909-1930, 4795-4809` | 2 |
| delete | `last-sync.json` receipts | `state.json` + `nb status` | `bin/nb.mjs:294-307` | 2 |
| yagni | two push paths (fast-push vs pre-push/bulk/task-push) with the result block printed three times | one `files/place` call, one printer | `bin/nb.mjs:3658-4179` | 1/2 |
| stdlib | hand-rolled `parseFlags` + `BOOLEAN_FLAGS` | `util.parseArgs` per command | `bin/nb.mjs:394-462` | 2 |
| shrink | four prompts repeat raw-mode setup/cleanup | one prompt helper | `bin/nb.mjs:875-1374` | 2 |
| yagni | MCP handlers re-implement command logic | tools call the command functions | `bin/nb.mjs:4815-5244` | 3 |
| delete | duplicate task linking and direct status writes in task-push | shared domain function | `src/app/api/v1/extension/task-push/route.ts` | 1 |
| delete | renamed-route shims `project-summary`, `project-tasks` | domain wrappers, then nothing when the VS Code extension moves | `src/app/api/v1/extension/project-*` | after 1 |
| yagni | seven write routes for one operation (pre-push, fast-push, bulk-intent, bulk-finalize, file-upload, file PUT, task-push) | `files/place` + `uploads` (old routes become wrappers) | `src/app/api/v1/extension/*` | 1 |

net: about −2,500 lines possible in `nb.mjs` once split into modules; −5 server routes after the VS Code extension moves; −0 dependencies (there are none).

## Baselines (P0.3)

`node packages/nb-cli/test/bench.mjs` on 2026-11-09, CLI 1.0.4, Node 22.22.0, darwin-arm64, median of 10 (pull: 5). **Fake server on localhost: client overhead only, no network time.**

| Measure | 1.0.4 | 2.0 budget (A13.8) |
|---|---|---|
| Unpacked package | 193,446 B | < 153,600 B |
| `nb --version` | 83 ms | < 120 ms |
| `nb help` | 83 ms | < 200 ms |
| Push 1 file (1 KB, `--draft --json`) | 107 ms | — (compare in Phase 2) |
| Push 50 files (1 KB each) | 111 ms | — |
| Pull 1,000 files (2 KB each) into an empty folder | 355 ms | — |

Notes: 1.x is over the size budget (one 5,393-line file); budgets are report-only until Phase 2. Tests: `cd packages/nb-cli && npm test` (runner `test/run.mjs`, works on Node 20 and 22). Known 1.x MCP bugs F5 and F6 are `todo` tests until P3.2.
