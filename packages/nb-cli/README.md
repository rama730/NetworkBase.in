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
nb login                 # opens the browser; on a server use: echo $TOKEN | nb login --with-token
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
- `nb diff` works offline against the version you last pulled.
- Tokens are tied to the server that issued them; a project file can't send your token somewhere else.

## Scripts and agents

- `--json` prints one result on stdout: `{ "ok": true, "schema": "nb.task.list/1", "data": … }`. Errors go to stderr.
- Exit codes: 0 done, 1 failed, 2 usage, 3 sign-in or access, 4 conflict, 5 blocked (secret found, plan limit, read-only), 6 needs an answer, 7 needs a yes, 8 offline, 130 cancelled.
- Never asks a question when not in a terminal: pass `--answer key=value` or `--yes`, or read the question from exit code 6.
- `nb task view 4 --context` prints a brief for an AI agent, with people's text marked as data, not instructions.
- `NETWORKBASE_TOKEN` signs in without a file; `NB_HOME` moves the settings folder.

## Commands

Run `nb help` for the list and `nb help <command>` for flags and examples.

| Area | Commands |
|---|---|
| Account | `login`, `logout`, `whoami`, `doctor`, `version`, `config`, `completion` |
| Folder | `init`, `unlink`, `status`, `open` |
| Files | `pull`, `push`, `sync`, `diff`, `resolve`, `watch`, `file list`, `file view` |
| Tasks | `task list/count/view/create/start/stop/move/done/review/resubmit/pull`, `subtask list/add/check/uncheck`, `comment add` |
| Docs | `doc list/view/edit`, `workspace list`, `search` |

## Coming from 1.x

- The background auto-push process is gone. `nb init` stops it and moves `.networkbase/mirror` to `.networkbase/legacy-mirror` (never deleted). `nb watch` runs in the foreground instead.
- `push --done`, `--wip` and `sync --done` no longer change status; use `nb task done` / `nb task move`.
- `nb hook install` and the git credential commands were removed.
- Old command names (`task work`, `task check`, …) still work in 2.x and print the new name once a day.
- `nb mcp` comes back with agent sign-in in the next release.

## Security

Report problems to support@networkbase.in (see SECURITY.md in the repository). The CLI sends no telemetry.
