# Part E results: the fresh walkthrough (M3), 12 Nov 2026

Walked on the live site after M1 (one-click agent sign-in, CLI 2.0.4) and M2 (agent labels) shipped. Terminal and agent runs by Claude on the user's Mac with the member account @ch_rama in its own workspace Gstack; two-account steps were done with the user during the M1 and M2 live checks. Test objects were removed afterwards (task deleted, file in Gstack's Trash). Recordings, with no tokens, are in the session scratchpad.

## Times against E5

| Step | Target | Measured |
|---|---|---|
| Install (`npm i -g @networkbase/cli`) | | 2.7 s |
| Link a folder, list tasks, whoami | | 0.5 to 0.6 s each |
| Install to first push | under 3 minutes | about 15 s of commands, plus the sign-in (one click, M1 live check) |
| Connecting an agent | 1 approval click | 1 click (M1 live check) |
| The agent's first useful answer | under 60 s | Claude Code 18 s, GitHub Copilot 18 s |
| Agent: edit, push a draft, ask to finish | | Claude Code 28 s, held for the yes as designed |
| Handing in an assignment | no help page | passed live in the previous round; no open assignment this time |
| A file over 25 MB | says the next step | **fails** (finding 2) |

## Findings

Severity: **blocker** (stops the journey), **annoying** (works around it, but shouldn't have to), **polish**.

| # | Severity | Where | Finding | Planned? | Suggested fix |
|---|---|---|---|---|---|
| 1 | annoying | terminal | `nb task start 1` says "nb push <files> links to it", but `nb push` ignores the started task; only `--task` links. `nb task done` then says "No task files are linked yet". | new | push links to the started task by default (and says so); `--no-task` to opt out |
| 2 | annoying | terminal | `nb push big.bin` with a 26 MB file says "Nothing changed": the file is skipped silently. Only `nb status` lists it as skipped. | new | a file named on the command line that's skipped is an error with the reason and the limit ("big.bin is 26 MB; files can be up to 25 MB") |
| 3 | annoying | agents | With the person's own sign-in, a held change can't be confirmed from a headless agent (`claude -p --continue`, CI): the yes token lives in the MCP server's memory, and each turn starts a new server ("New token (prior one expired)"). Agent sign-ins aren't affected (the server holds those). | new | sign local yes tokens like the server's (HMAC with the profile's key, 10 minutes), so any process can check them |
| 4 | annoying | terminal | `nb task create` and `nb task start` don't assign the task to you, so it never shows in your own `nb task list` ("No open tasks assigned to you" right after creating one). | new | create assigns to the creator unless `--assignee` says otherwise; start assigns an unassigned task to you |
| 5 | polish (bug) | terminal | In a workspace without a task key, the task list shows task 1 as "-1". | new | show "#1" when there's no key |
| 6 | polish | terminal | Bare `nb` prints about 80 lines of help. | planned (C, "nb on its own becomes a home screen") | — |
| 7 | polish | terminal | `nb status` in a freshly linked folder lists "379 remote-added" as a table. | new | one line: "379 files on the server · nb pull to get them" |
| 8 | polish | terminal | Undo says "Undid: Moved the task from in_progress to done (Moved the task back to in progress)". | new | "Undid: #1 back to In progress" |
| 9 | polish | terminal | `nb whoami` says "11 permissions" for your own terminal, while agents get a plain sentence. | new | "your own sign-in: does what you can, in all your workspaces, until <date>" |
| 10 | polish | terminal | `nb task create` gives no next step. | new | "Next: nb task start 1" |
| 11 | polish | speed | `nb task start` took 3.1 s; everything else is about 0.5 s. | new | measure and trim (likely the start-on-copy and move done one after the other) |
| 12 | polish | terminal | Help has a "Classes" group, but `nb class list` isn't a command. | new | alias `nb class list` → `nb assignment list` (and `nb class` → the group) |
| 13 | polish | agents | `networkbase_task_count` counts across all workspaces; Copilot merged "1 overdue" from another workspace with task #1 here. | new | the count names the workspaces it covers, and the tool says "across all your workspaces" |

## Passed
- One-click agent approval, connected line, `whoami` sentence, MCP access card, Read only, asking for more, Allow once (M1 live check, 11 Nov).
- "with Claude Code" and all three label settings for the owner and member (M2 live check, 12 Nov).
- Over SSH in a real terminal: no browser opened, the code shown large, a 33-column QR code that macOS decodes to the exact approval link, the countdown.
- The agent's own push linked its file to the task, and finishing waited for the person's yes.
- `--plain` output has no colour or box drawing.

## Not walked this time, and why
- **Planned, not built yet:** branches and merge requests (H), change sets (G), the single-file install (C7), the heavy user and the terminal dashboard (C9), the GitHub user's git-branch flow (H).
- **Covered by tests rather than live:** network drop mid-push, conflicts (CLI sync tests), a paused workspace and an organization with agents off (DB tests), a revoked sign-in in use (M1 live: revoked token answers "sign in again").
- **Needs the user or another machine:** a real Windows machine; screen readers (VoiceOver with `--plain`, Narrator); GitHub Codespaces; a company proxy; a throttled connection. Linux and Windows run the full CLI test suite in CI on every release.
- **Agents:** Codex's install on this Mac is broken (its binary is missing), and Cursor and Gemini CLI aren't installed. They're covered by the Part D agent test in M4.
- **A real first-time person** (E9) is part of M9.
