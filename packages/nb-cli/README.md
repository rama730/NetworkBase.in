# @networkbase/cli

NetworkBase in your terminal: link a folder to a workspace, push and pull files, work on tasks, edit docs.

Needs Node.js 20 or newer. No other dependencies.

```bash
npx @networkbase/cli login
npx @networkbase/cli init design-lab
```

Or install it once and use `nb`:

```bash
npm install -g @networkbase/cli
```

## A first session

```bash
nb login                 # opens the browser; over SSH it shows a code to approve at networkbase.in/device
nb init design-lab       # link this folder (asks which workspace if you leave it out)
nb pull                  # get the files
nb task start 4          # this folder works on task 4; moves it to In progress
nb push notes.md         # same path = new version; never deletes anything
nb task done 4 -m "Login works" --check "npm test=pass"
```

`nb push` uploads only the files you name (or `--all` for every tracked file that changed). It never changes a task's status; `nb task start`, `nb task move` and `nb task done` do, and say so.

## Your edits are safe

- `nb pull` never overwrites a file you changed. If you and the server both changed it, you get a conflict copy (`report.remote-v4.md`) and `nb resolve`.
- `nb push` refuses when someone pushed a newer version since your last pull, and tells you to pull first.
- `nb diff` works offline against the version you last pulled. A push made offline waits in a queue until `nb sync`.
- Tokens are tied to the server that issued them; a project file can't send your token somewhere else.

## Scripts and agents

- `--json` prints one result on stdout: `{ "ok": true, "schema": "nb.task.list/1", "data": … }`. Errors go to stderr.
- Exit codes: 0 done, 1 failed, 2 usage, 3 sign-in or access, 4 conflict, 5 blocked (secret found, plan limit, read-only), 6 needs an answer, 7 needs a yes, 8 offline, 130 cancelled.
- Never asks a question when not in a terminal: pass `--answer key=value` or `--yes`, or read the question from exit code 6.
- `nb task view 4 --context` prints a brief for an AI agent, with people's text marked as data, not instructions.
- `NETWORKBASE_TOKEN` signs in without a file; `NB_HOME` moves the settings folder.

## AI agents

```bash
nb agent setup claude     # or codex, cursor: shows the change and asks first
```

Then ask Claude Code (or Codex, Cursor) things like "how many tasks do I have", "create a task to update the logo" or "change the README to add install steps". The agent signs in with its own token that only reaches the folder's linked workspace, and its changes show "via Claude Code" in the app. Finishing a task, final files, deleting and changing someone else's task wait for your yes; task text and files are passed to the agent as data, not instructions. When it's unsure, it asks you in the app (`nb ask`). `nb undo --session` reverses what one agent session did.

## Commands

Run `nb help` for the list and `nb help <command>` for flags and examples.

| Area | Commands |
|---|---|
| Account | `login`, `logout`, `whoami`, `token list/revoke`, `doctor`, `version`, `config`, `completion`, `setup shell`, `feedback`, `undo` |
| Folder | `init`, `unlink`, `status`, `open`, `activity` |
| Files | `pull`, `push`, `sync`, `diff`, `resolve`, `watch`, `file list/view/history/move/rename/delete/attach/detach` |
| Tasks | `task list/count/view/create/edit/assign/start/stop/move/done/report/review/resubmit/delete/open/pull`, `subtask list/add/check/uncheck/edit/delete/move`, `comment list/add/resolve`, `sprint list/view` |
| Docs | `doc list/view/edit/set`, `workspace list/view/open`, `member list`, `search`, `update post` |
| Agents | `agent setup/status/remove`, `mcp`, `ask` |
| Classes | `assignment list/view/pull/hand-in/question`, `review list/view/approve/return/pull` |
| Inbox | `inbox [--unread] [--follow --notify]`, `inbox read/open` |

## Coming from 1.x

- The background auto-push process is gone. `nb init` stops it and moves `.networkbase/mirror` to `.networkbase/legacy-mirror` (never deleted). `nb watch` runs in the foreground instead.
- `push --done`, `--wip` and `sync --done` no longer change status; use `nb task done` / `nb task move`.
- `nb hook install` and the git credential commands were removed.
- Old command names (`task work`, `task check`, …) still work in 2.x and print the new name once a day.

## Security

Report problems to support@networkbase.in (see SECURITY.md in the repository). The CLI sends no telemetry.
