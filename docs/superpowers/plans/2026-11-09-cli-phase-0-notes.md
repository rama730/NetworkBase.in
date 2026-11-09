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

_Filled in by Task 6._
