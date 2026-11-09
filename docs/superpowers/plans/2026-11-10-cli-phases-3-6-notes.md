# CLI Phases 3 (rest) to 6 — notes

Local `main`, not pushed. Commits, oldest first:

| Commit | What |
|---|---|
| `257c84bdf` | via labels (0073), one source for API schemas |
| `bba58f1d5` | agent tiers, workspace agent policy, undo (0074) |
| `ceefe8972` | agents ask people; one summary per agent session (0075) |
| `d76e4e418` | full command set, tokens list/revoke, keychain, token lifetime (0076), sync and output gaps, error catalog, CLIENT_TOO_OLD, Claude Code plugin, eval suite |
| `85f592699` | TerminalBlock, editor theme, via labels in the app, report card, Work with an agent, Settings → CLI, agents and editors |
| `d512b6767` | drops without pop-ups, both upload modals deleted, /docs/cli and /docs/agents |
| `a7ed20aee` | assignment AI policy, org "Allow AI agents", teacher labels, `nb assignment`, `nb review` |
| `4ac87fee9` | `nb inbox`, events long-poll, live pull in `nb watch`, agent activity in Settings |
| `56c16c121` | hosted MCP, `--branch`, `--from-git`, saved filters, `--from tasks.md` |
| `33ee733bf` | hosted MCP: configured site address only, scratch folder per token |

## Before deploying (needs the user's go-ahead)

1. Apply migrations **0072–0076** in production. Until then any page or route that reads the new columns fails against the production database (the dev server on :3000 included): device sessions (settings list, every token request), file version history, subtasks in the task panel, task comments.
2. Re-sync the Inngest worker (new function `agent-notification-flush`).
3. Set `APP_URL` on Railway if it isn't set: the hosted MCP server refuses requests without it (503).
4. `npm ci` once: `package.json` gained `@codemirror/language` and `@lezer/highlight` (already in node_modules as dependencies of dependencies) and dropped `@codemirror/theme-one-dark`; only the lockfile was updated, so the running dev server wasn't disturbed.
5. Create the public plugin repository from `integrations/claude-code-plugin/` (user step).
6. npm release steps from the plan (§42.9): re-add the trusted publisher before 2.0.

## Decisions taken while building (ponytail)

- **No separate crash journal.** Downloads and state writes are atomic, and the three-way plan adopts files that already match the server, so a crash mid-pull or mid-push leaves nothing to replay; stray temp files are ignored and removed by `nb doctor --repair`. Tested in `sync-edges.test.mjs`.
- **No Range-resumed downloads, resumable uploads, ETag caching or 250 MB test** while the largest file is 10 MiB (`WORKSPACE_UPLOAD_MAX_FILE_BYTES`, the bucket's limit). Upgrade trigger: the bucket limit is raised (monetization plan: 25 MB / 250 MB).
- **No Deprecation/Sunset headers** on `/api/v1/extension/*`: CLI 2.0 itself uses those routes (no REST aliases were built, phase 1 notes).
- **Presence** is the sign-in's last-seen time, kept fresh by `nb watch`'s long-poll; no separate heartbeat.
- **SIGWINCH**: every table and progress line reads the width when it prints; there is no live-redrawing view to redraw.
- **`nb assignment unsubmit`** isn't built: the app has no way to take back a hand-in.
- **Hosted MCP auth** is the agent sign-in from the device flow (A3), sent as a bearer token; no OAuth authorization server. Only agent tokens, so every big change is held by the server (stateless signed confirmations). Tools that need local files and the local undo log are left out.
- **Commit trailer**: read by `nb push --from-git` to pick the task; nothing installs git hooks (D6).
- **Drop rules**: same name → new version with Keep both; folder-only collisions no longer ask (folders merge). The Files list no longer links drops to a task; task files go through the task panel bands or a task's row in Task files.

## Checks

- CLI: 126 tests pass; typecheck clean; size budget met.
- DB: the touched suites pass. Known failures that predate this work: org "live-fix 31" (2), "a card's preview: who liked it", and another session's duplicate-index check.
- Browser: `/docs/cli` and `/docs/agents` checked on :3000 (desktop and phone). Signed-in pages were not browser-checked: the dev server's database is production, which lacks 0072–0076, and drops would write production data.
- Not run: the 56-request agent evaluation (`scripts/agents/eval.mts`) needs a live server with these migrations; hosted MCP tool calls (only initialize/tools/list/refusals are tested; tools call the site over HTTP).
