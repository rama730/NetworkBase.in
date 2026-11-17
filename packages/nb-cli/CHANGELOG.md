# Changelog

## 2.4.1 (2026-11-17)

The first release with these changes: 2.4.0 was tagged but not published (the package size check stopped it).

### Added
- History: `nb log` lists the saves on this folder's branch (or a file's with `nb log <path>`), `nb show <save>` shows one with its files and diffs, and `nb revert <save>` undoes one as a new save.
- Branches: `nb branch list|create|switch|rename|delete|update`. A folder is on one branch at a time; `nb push` and `nb pull` use it, never main by accident. In a git folder NetworkBase follows git's branch and asks before making a NetworkBase one; a detached HEAD is refused with how to fix it.
- Merge requests: `nb merge-request` (alias `nb mr`) `create|list|view|review|comment|apply|merge|close|reopen|ready`: review with comments, line comments and suggested edits, approve or request changes, and merge or squash into main with one undo.
- A protected main: `nb push` on main asks to push to a new branch (`you/<date>`) and opens a merge request; in a git folder it says to make a git branch. Agents go to their own branch without asking.
- Agent tools in a new `branches` pack: `networkbase_branch_status`, `networkbase_branch_create`, `networkbase_merge_request_open`, `networkbase_merge_request_view`, `networkbase_merge_request_update` and `networkbase_merge_request_merge` (an unprotected main only, after the person's yes).

### Changed
- `nb file` commands that change files (restore, mkdir, copy, use, move, rename, delete, edit) refuse in a folder that's on a branch: they change main.
- `nb revert` on a protected main puts the revert on a branch with a merge request.
- New error codes: `BRANCH_PROTECTED`, `APPROVAL_REQUIRED`, `CHECKS_FAILED`, plus the branch and merge request codes.

## 2.3.0 (2026-11-17)

### Added
- `nb change finish --from-git main..HEAD`: turns commits into one change set, with their files as at the last commit and the first commit's subject as the title.
- `nb agent activity`: what your agents did in this workspace in the last 24 hours, by session; `--undo <session>` undoes one session's changes.
- `nb agent pause` and `nb agent resume`: the workspace's agent switch, for owners and admins.
- Cloud agents on the hosted MCP server get `fs_list`, `fs_read`, `fs_search`, `fs_edit`, `fs_write`, `fs_delete`, `fs_move` and `fs_finish`: they work on the workspace's files in a change set, with no folder of their own.

### Changed
- `nb change apply` takes a short id from `nb change list`.
## 2.2.2 (2026-11-17)

### Fixed
- `nb change status` shows the change set even when an upload fails, saying what's waiting; with nothing open, it lists the recently applied change sets and how to undo them.
- `nb change finish` opens a change set for saves that weren't captured yet, instead of saying there's nothing to finish.
- `nb change resolve` writes only inside the linked folder, never in `.git`.

### Added
- Agent tools `networkbase_change_update` (bring in teammates' changes) and `networkbase_change_resolve` (keep yours or theirs) in the changes pack.

## 2.2.1 (2026-11-16)

### Added
- `nb change split` makes one finished change set per top-level folder when a change set is over the limits.
- A file's executable bit travels with it: change sets keep it, and `nb pull` sets it again.
- `nb change status` and `nb change view` show the review's open comments (line comments from the app).

### Fixed
- `nb pull` never writes inside a `.git` or `.networkbase` folder, at any depth, in any letter case (and Windows spellings of them); such a file is skipped with a note.
- `nb change apply` on a small set finished earlier applies without asking; `nb change view` and `status` take a short id.

## 2.2.0 (2026-11-16)

### Added
- Change sets (where your workspace has them on): `nb change start`, `status`, `list`, `view`, `finish`, `apply`, `undo`, `discard`, `copy`. Your saved files become one change that lands all at once or not at all and undoes in one step.
- `nb change update` merges teammates' newer versions into your files (three-way, line based); files changed in the same lines get a conflict copy, and `nb change resolve <path> --mine|--theirs` settles them.
- `nb watch --change` adds your saves to the open change set as you work.
- `nb mcp`: an agent's saved files go into one change set as it works, opened on its first save and named after the started task; agent tools in a `changes` pack.
- A push over 50 files or 4 MB, with no task or role, goes up as one change set.
- A file that looks like it holds a password or key isn't uploaded until you confirm it (`--confirm-secrets`); agents can't.

## 2.1.7 (2026-11-16)

### Fixed
- `nb pull` skips a file whose content isn't on the server yet (a GitHub import still downloading it) with a note, instead of stopping, and files it already fetched no longer read as conflicts.
- In a folder linked to a remote folder (`nb init --path`), `nb file history`, `nb diff --from`, `nb file use|move|rename` and `nb edit` take paths relative to that folder.
- `nb message read general` works without the `#` (in most shells an unquoted `#general` is a comment); a channel name in several workspaces asks by workspace, and a message never goes to a guessed conversation.
- `--format md` and `csv` lists have no terminal markers.

## 2.1.6 (2026-11-16)

### Added
- `nb message list`, `nb message read #design|@sam` and `nb message send <#channel|@person> "text" [--reply <n>]`: your channels and direct messages from the terminal. Your own sign-in only; agent sign-ins can't read or send messages, and the agent tools ask before reading or sending.
- `nb learn`: five minutes of guided practice (link, status, push, task start, done) in a practice workspace that's deleted at the end (`--keep` leaves it for 24 hours).
- `npx @networkbase/cli start` (`nb start`): signs in, links this folder (the workspace named like it first) and pulls, asking only what it can't guess.
- `nb ui`: tasks, inbox and changed files in one full-screen view. Enter opens, `d` done (twice for a task), `p` push, `/` filter, `?` keys. `--plain` or a pipe prints `nb status`.
- A single-file `nb` (macOS Apple silicon, Linux x64, Windows x64) is built with every release; Homebrew and Scoop follow once the tap is set up.

### Fixed
- `--dry-run` stops at the first yes, local changes included (`nb agent setup --dry-run --yes` no longer writes `.mcp.json`).
- An MCP session Claude Code stops still sends its "What I did" summary and leaves its tasks at once.

## 2.0.4 (2026-11-11)

### Added
- One-click agent sign-in: `nb agent setup` and `nb login --device --agent` open the approval page by themselves, show the code large and, on a wide terminal, a QR code for approving from a phone. The wait counts down; once approved the CLI repeats what you allowed ("Claude Code connected · all workspaces · asks before big changes · until 11 Dec").
- `nb login --device --agent <name> --access full|small|read --workspace <ws>|--all-workspaces` asks for that access; the page starts there and you can change it.
- `nb agent access claude --read-only|--small|--full [--workspace <ws>|--all-workspaces]` opens the agent's Settings page, ready to change.
- `nb agent status` lists your signed-in agents with what each may do; `nb whoami` shows an agent's access in the same words.
- The MCP server starts with an access card (who the agent works for, where, what waits for a yes, when access ends). A Read only agent sees only the tools that read. When the agent lacks a permission, NetworkBase asks you in your inbox and the tool says `access_requested`.

## 2.0.3 (2026-11-11)

### Added
- `nb assignment unsubmit <copy>` takes a hand-in back before it's approved, so you can change it and hand in again.
- Editors can connect to the hosted MCP server (`https://networkbase.in/api/mcp`) with a browser sign-in (OAuth); no token to paste.

### Fixed
- Agents run small changes at once (with Undo) instead of asking first; finishing tasks, final files, doc edits and deleting still wait for your yes, asked once.
- Every MCP write tool accepts the confirmation token, so a "yes" given for a held change goes through.
- A "yes" for finishing a task with checks now matches the run it was given for.
- Files up to 25 MB upload (was 10 MB).
- `nb doc set` / `nb doc edit` (and the agent's doc tool) can change a new workspace's starter README; the first save creates `README.md`.
- A bare group like `nb assignment` lists its actions instead of saying it isn't a command.

## 2.0.2 (2026-11-10)

### Fixed
- `nb doc list` keeps file names in one column when a doc has a long name.
- A refused `nb doc edit` / `nb doc set` says who can edit the doc.
- With `--plain` (and in MCP tool results) the marker before a name is `-`, so you no longer see `@ @name`.
- The package includes its Apache-2.0 LICENSE file.

## 2.0.1 (2026-11-10)

### Fixed
- `nb login --workspace <slug>` no longer stops with "You're not signed in". Signing in an agent picks its workspace on the approval page.

Also on networkbase.in (no CLI update needed): approving a sign-in at /device works, and "Verify it's you" with a password works again.

## 2.0.0 (2026-11-10)

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
- `nb inbox` shows your notifications as in the app (`--unread`, `read`, `open`); `--follow` waits for new ones and `--notify` also shows them as desktop notifications.
- `nb watch` also pulls teammates' new versions as they land (`--no-pull` to only push); your edits are never overwritten.
- Classes: `nb assignment list|view|pull|hand-in|question` with the app's late and lock rules and the assignment's AI policy; reviewers get `nb review list|view|approve|return|pull`.
- `nb task start 4 --branch` switches to a git branch `nb/4-…`; `nb push --from-git` pushes what the last commit changed, using its subject as the message and its `NetworkBase-Task: 4` trailer as the task.
- `nb task list --save <name>` keeps filters for `nb task list @name`; `nb task create --from tasks.md` makes one task per heading, with `- [ ]` lines as subtasks, after one yes.
- `NB_WORKSPACE` sets a default workspace for scripts and CI.
- Hosted MCP for agents in the cloud: `https://networkbase.in/api/mcp` with an agent sign-in (`nb login --device --agent …`).
- `--fields`, a pager for long views (`--no-pager`), clickable links in terminals that support them, and server errors link to their entry on /docs/cli.

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
