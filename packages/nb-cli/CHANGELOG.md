# Changelog

## 2.0.0 (unreleased)

A rewrite. Folders you linked with 1.x keep working; `nb init` in them moves the old mirror aside and stops the 1.x background process.

### Changed
- One command shape: `nb <thing> <action>` (`nb task start 4`, `nb subtask check 2`). Old names still work and print the new one once a day.
- `nb push` uploads only the files you name, or `--all`. It never changes a task's status. `push --done`, `--wip` and `sync --done` still run but only upload, and say how to change status.
- `nb pull` never overwrites your edits; both-changed files get a conflict copy and `nb resolve`.
- `nb push` stops when someone else pushed a newer version since your pull (exit 4).
- `nb watch` runs in the foreground only and pushes saves of tracked files as drafts.
- File roles are reference, draft and final, the same words as the app.
- Unknown flags are errors, with a suggestion.
- `--json` prints `{ ok, schema, data }`; exit codes are documented (`nb help`).
- Colors follow your terminal's theme; `--plain` and `NO_COLOR` turn off color and symbols.
- Needs Node.js 20 or newer.

### Added
- `nb mcp` rebuilt: 35 tools for Claude Code, Codex and Cursor that run the same checks as the commands; finishing a task, final files and doc changes need the user's yes; tasks and workspaces found by words; tasks readable as `networkbase://task/{n}`; progress for long pushes; stdout carries only protocol messages.
- `nb agent setup claude|codex|cursor` connects an agent to `nb mcp` with its own sign-in limited to this workspace (`--token mine` uses yours) and adds a short NetworkBase section to its instructions file (asks first); `nb agent status`, `nb agent remove`.
- `nb doc set` replaces a doc's text from a file or stdin.
- `--workspace` takes a slug.
- `nb task count`, `nb task view --context` (agent brief), `nb task review`, `nb task resubmit`, `nb task pull`.
- `nb comment add` posts a real task comment (1.x posted nowhere).
- `nb doc list|view|edit` (edit the README in your editor; refuses if someone saved in between).
- `nb diff` (works offline), `nb resolve`, `nb doctor`, `nb search`, `nb member list`.
- Pushes made offline are queued (exit 8) and sent by the next `nb sync`; a teammate's change in between is a conflict.
- `nb setup shell` adds completions (asks first); `nb prompt` prints the workspace and task for your shell prompt.
- `nb feedback` prints a report for support with no tokens, names or paths.
- A once-a-day notice on stderr when a newer version is out (never with `--json`, in CI, or with `NB_NO_UPDATE_CHECK=1`).
- `nb login --device` signs in with a code you approve at networkbase.in/device on any device (used automatically over SSH or without a display); `--agent "Claude Code"` asks for an agent token that only reaches the one workspace you pick.
- `nb login --with-token` reads a token from stdin; `NETWORKBASE_TOKEN` works without a file.
- Questions show as a numbered card in a terminal; scripts answer with `--answer key=value` or `--yes`.
- `nb undo` reverses the last change from this computer within 24 hours (`--list`, `--session` for everything one agent session did).
- `nb ask` puts a question to you, the assignee or the reviewer in the app and waits for the answer (`nb ask list|answer|wait`).
- `nb task edit|assign|report|delete|open`, `nb subtask edit|delete|move`, `nb comment list|resolve`, `nb comment add --file path:line`.
- `nb workspace view|open`, `nb activity --since 3h`, `nb sprint list|view` (in your organization's words), `nb update post`.
- `nb file history|move|rename|delete|attach|detach`.
- `nb token list|revoke`, `nb whoami --all`, `nb logout --all`.
- Tokens are kept in the macOS Keychain, the Linux keyring or Windows-encrypted storage when available (`NB_CREDENTIAL_STORE=file` keeps the file).
- `--confirm <token>` sends the yes for a change the server held for one.

### Removed
- The background auto-push process and `.networkbase/mirror`.
- `nb hook install`, `nb auth setup-git`, `nb auth git-credential`.
- The `cli` command name (use `nb` or `networkbase`).

### Security
- Browser sign-in uses PKCE and answers only the page that asked.
- A token is only sent to the server that issued it; a project's `.networkbase/config.json` can no longer name a server.
- Text from other people (task titles, comments, file names) is printed with terminal control characters removed.
- Files are only written inside the linked folder.
- Pushing a file that looks like it holds a secret needs a yes.
- Device sign-ins last 90 days and extend while used (at most a year); one unused for 90 days needs a new sign-in. Use from a new country emails you.
- An agent's big changes (finishing a task, final files, deleting, someone else's task) wait for your yes; the workspace can ask for everything or pause agents.

## 1.0.4 and earlier

See the npm release history.
