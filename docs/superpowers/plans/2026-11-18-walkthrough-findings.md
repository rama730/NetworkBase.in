# Part E results, second round: the walkthrough on CLI 2.6.1 (M9), 18 Nov 2026

Walked on networkbase.in after M8 (branches, merge requests, protected main) and M9's B1–B4 shipped, with CLI 2.6.1
installed fresh. Terminal and agent runs by Claude on the user's Mac with the owner account in the workspace Ponytail
(a personal workspace), and read-only class steps in CSE 3B. Test objects were removed afterwards: task #2 deleted,
`/m9-walk.md` in Ponytail's Trash, the test branches deleted (merged ones go with the daily sweep). Logs, with no
tokens, are in the session scratchpad.

## Times against E5

| Step | Target | Measured |
|---|---|---|
| Install (`npm i @networkbase/cli@2.6.1`) | | 1.7 s |
| `nb init`, `nb`, `nb status`, `nb whoami`, `nb next` | | 0.5 to 1.2 s each |
| Install to first push | under 3 minutes | about 12 s of commands (signed in already) |
| `nb task create` | | 2.5 s (the slowest everyday command) |
| `nb task start` → `nb push` → `nb task done` | | 1.3 s, 2.9 s, 1.2 s |
| The agent's first useful answer (Claude Code over `nb mcp`) | under 60 s | 17 s |
| First push after `git checkout -b` in a one-file folder | | **103 s** (finding 1; fixed) |
| `nb merge-request create`, `merge` | | 1.0 s, 2.1 s |
| Teacher: `nb class progress`, announcements, review list | | about 1 s each |
| A 26 MB file | says the next step | 0.9 s: "big.bin is 26 MB; files can be up to 25 MB" (M3 finding 2 fixed) |
| Through a slow proxy (400 ms a chunk, about 64 KB/s) | works | `whoami` 2.4 s, `status` 2.8 s |

## Findings

| # | Severity | Where | Finding | Fix (CLI 2.6.2, local) |
|---|---|---|---|---|
| 1 | blocker | terminal | After `git checkout -b`, the first push switched the folder onto the new branch and downloaded all 143 of the branch's files, though the folder had pulled one; the push took 103 s. | A switch only brings down what the folder keeps and what's new on the other branch; files it never pulled stay on the server. Test: `branch.test.mjs` (a folder that pulled only some files). |
| 2 | annoying | terminal | After `nb merge-request merge` from a branch folder, the next command stopped with "was merged into main · Restore it within 30 days". | The folder goes back to main after merging ("this folder is on main again"); a merged branch's message says the work is in main and to switch. Tests: `merge-request.test.mjs`, `journeys.test.mjs`. |
| 3 | polish | terminal | `nb`/`nb status` showed "1 overdue" under Ponytail; the task was in another workspace (`nb next` said nothing was open). | The folder shows its own workspace's counts. Tests: `home.test.mjs`, `journeys.test.mjs`. |
| 4 | polish | terminal | `nb agent status` outside a linked folder refused ("not linked"), even with `-w`. | It lists your signed-in agents anywhere; in a folder it also shows that folder's setups. |
| 5 | annoying | network | Behind a proxy every command printed Node's "EnvHttpProxyAgent is experimental" warning. | nb's own restart with the proxy turns that warning off (`--disable-warning=UNDICI-EHPA`). Test: `help-network.test.mjs`. |

Not findings: the class commands need `-w <organization>` outside a class folder, and their error says so; Ponytail's
sprints are called "phases" by its workspace type, as in the app.

## Passed

- The terminal journey: install, link, home screen, create (assigned to you, M3 finding 4 fixed), start, push linked
  to the started task (M3 finding 1 fixed), done, next.
- Branches and merge requests with git: the folder followed `git checkout -b`, the push saved on the branch, `nb branch
  list`, `nb merge-request create`, `list`, `merge` with its Undo line; activity shows the branch saves and deletions.
- My reviews in the tray and `nb merge-request list --review-requested --all`.
- Earlier rows checked live again: `nb file history` and `nb diff --from`, `nb sync --only` remembering a partial copy,
  `nb queue`, `nb watch --inbox`, clickable links in the inbox (where the terminal supports them), the sign-in's end
  date in `whoami`.
- The agent (Claude Code over `nb mcp`, read-only) answered "what should I do today?" from live data in 17 s.

## Automated from this round (E9 #1)

`packages/nb-cli/test/journeys.test.mjs` gains the branch journey as walked: a folder that pulled one file follows a git
branch, pushes without fetching the other 40 files, opens and merges a merge request, is on main again, and lists My
reviews. It runs in CI on Linux, macOS and Windows with every CLI change.

## Not walked this time, and why

- **Needs the user or another machine:** a real Windows machine, a first-time person, screen readers (VoiceOver with
  `--plain`, Narrator), GitHub Codespaces (needs a Codespace you allow), a company proxy with its own certificates (the
  proxy part was walked; extra certificates are covered by `help-network.test.mjs`).
- **GitHub merge flows (H23 journey 6):** merging in NetworkBase sending the result to GitHub main, and a pull request
  merged on GitHub arriving as a save. These need a run with your connected repository.
- **Writes in others' data:** handing in and returning assignments, sprint create and close in a team, `nb uninstall`,
  `nb edit` and `nb open --code` (open editors). Their CLI and DB tests pass.
- **Other agents:** Codex, Cursor, Gemini CLI and Copilot weren't run this round; the Part D agent test covers them.
- **The single-file install:** built on every release (run artifacts); publishing waits for the tap repository and its
  token (user step).

# Third round: the E1 and E2 walks on CLI 2.6.3 (M9), 18 Nov 2026

Walked by Claude after M9's leftovers shipped. **E1** (branches and merge requests with a suggested edit) and the
**heavy user** ran in Ponytail. The **GitHub user** ran in DeepScope AI, using a local clone of rama730/deepscope-ai,
with git kept local (no branches were pushed to GitHub). Test objects were removed afterwards: 15 branches, 5 change
sets and 4 tasks deleted, !2 closed, test files in Trash.

| Step | Measured |
|---|---|
| `nb init` + `nb sync --only docs/` | 0.8 s, 2.9 s |
| First push after `git checkout -b` (creates the branch) | 6.4 s |
| git switching main ↔ branch, then `nb status` | 1.4 s, 1.8 s |
| `nb merge-request create`, `comment --suggest`, `apply`, `pull` | 1.1 s, 0.9 s, 1.6 s, 1.3 s |
| `nb merge-request merge` (folder goes back to main) | **97.2 s** (finding 1; fixed) |
| 12 × `nb branch create --no-switch` | 0.7 to 1.1 s each |
| `nb`, `nb status`, `nb branch list` (13 branches), `nb change list --all`, `nb task list` | 0.5 to 0.7 s each |
| `nb task move 3 4 5 6 in_progress` | 1.9 s |
| GitHub clone (1,129 files): `nb init`, first push on a git branch | 1.0 s, 8.2 s |

## Findings

| # | Severity | Where | Finding | Fix (CLI 2.6.4, local) |
|---|---|---|---|---|
| 1 | blocker | terminal | After `nb merge-request merge`, a folder kept to `docs/` downloaded all 144 files to go back to main (97 s). The merged branch's file list is refused, so every file looked new, and the folder's `--only` folders were ignored. The 2.6.2 test that should have caught it counted downloads by a path the CLI doesn't use. | Leaving a merged or deleted branch keeps untracked files on the server, and a switch only brings `--only` folders. The tests now count real downloads. Tests: `journeys.test.mjs`, `branch.test.mjs` (`sync --only`). |
| 2 | blocker | terminal | In a git clone with main protected (DeepScope AI), `nb push` on a new git branch refused: "main is protected… git switch -c, then nb push again", though git already was on its own branch. The protection check ran before the folder followed git. | The push follows git first, then saves on that branch. Test: `branch.test.mjs` (protected main). |
| 3 | annoying | terminal | A file in conflict (the clone's copy differs from NetworkBase's) became a plain "modified" edit after a branch switch, so `nb push` would replace NetworkBase's copy without asking. | A conflict stays a conflict across a switch. Test: `branch.test.mjs`. |
| 4 | annoying | terminal | `--plain` and piped output cut paths (`/CO...S.md`), which is bad for screen readers and logs. | Only a real terminal shortens paths. Test: `print.test.mjs`. |
| 5 | polish | terminal | `nb status` stopped with "needs input" when git was on a branch NetworkBase didn't have; status only reads. | It says "git is on X, which NetworkBase doesn't have yet; nb push asks to create it". Test: `branch.test.mjs`. |
| 6 | polish | terminal | `nb`/`nb status` didn't mention the folder's open change set. | "Change set 7b836fba E2 heavy change 1 is open here". Test: `change.test.mjs`. |
| 7 | polish | terminal | `nb merge-request comment --suggest` didn't say how to apply it. | It prints `nb merge-request apply <n> <id>`. Test: `merge-request.test.mjs`. |
| 8 | polish | terminal | `nb branch create --no-switch` said "Save on it as usual (nb push)", but the folder stayed where it was. | It says `To work on it: nb branch switch <name>`. Test: `branch.test.mjs`. |

Not fixed (noted): `nb task move … doing` isn't accepted (the error lists `in_progress`); the protected-merge hint says
`nb merge-request view <n>` instead of the number.

## Passed

- E1: a git branch becomes a NetworkBase branch, git switching moves the folder both ways, a merge request with a
  suggested edit applied as a save on the branch, own-review refused (SELF_REVIEW), merge, and the folder back on main.
- Heavy user: 13 branches in the app picker with search; 5 open change sets in Changes; branch, change, merge request
  and task lists under a second; a bulk task move with one Undo.
- GitHub user: a clone of the connected repository links, shows where NetworkBase and GitHub differ, follows two git
  branches with saves on each, opens a merge request, and protected main asks for an approval before merging.

# Fourth round: the 16 built-but-never-live items (T16), 18 Nov 2026

Tested live on networkbase.in with CLI 2.6.4 (terminal parts in a real pty), Chrome signed in as the owner, and
Claude Code over `nb mcp`. Test objects removed afterwards (task #7, its branch, test files, change sets, `/src`, the
test sign-in).

| Item | Result |
|---|---|
| C2 pickers in a real terminal | passed; scripts still get the exact question with `--answer` choices |
| C3 large uploads: progress, Ctrl+C, resume | **broken since M5** (finding 1); fixed |
| C10 `nb edit` | passed (in a folder and outside one); finding 3 fixed |
| C10 `nb open --code` | **refused with VS Code installed** (finding 4); fixed |
| E3 proxy with its own certificates | passed through an intercepting proxy with `NODE_EXTRA_CA_CERTS` and `nb config set ca-file`; findings 5, 6 fixed |
| 0.8 #6 Retry on error toasts | **partly built** (finding 7): Retry on 12 of 467 error toasts; added to editor save and task move |
| H2 / H23 Start work → branch | passed: one click made `task/7-t16-picker-check`, linked to #7 |
| E7 approval page, keyboard and screen reader | passed: heading, labelled code and "Who is asking", every control reachable; four stops show no focus mark (the no-focus-ring choice) |
| C6/C15 renew a sign-in | passed: a second `nb login` on the same sign-in kept 2 active, not 3 (the 7-day warning can't be triggered live; tests only) |
| C14 `nb uninstall` | passed (revoked, folder gone, your own sign-in untouched); finding 8 fixed |
| G22 agent coding jobs (Claude Code, live) | 8/8 after finding 9; 7/8 before |
| F3 `nb workspace create` (found on the way) | **failed for everyone** (finding 2); fixed on the server |
| 0.8 #15 starter README Edit | waits for finding 2's deploy (a throwaway workspace) |
| C4/C15 `nb review` diff and bulk approve | need a hand-in from the student account (`ch_rama`) |

## Findings

| # | Severity | Finding | Fix (local) |
|---|---|---|---|
| 1 | blocker | Since change sets (M5), a push over 4 MB goes up as a change set: no progress line, and each Ctrl+C left an open "Push of 1 file" draft while the next push started over. | Progress in the change-set upload; a stopped push carries on in its own change set (`.networkbase/changes/push.json`). Test: `change.test.mjs`. |
| 2 | blocker | `nb workspace create` always failed: "Custom workspace type is required when Other is selected". | The CLI create sends a type name ("General"). Test: `tests/unit/workspace-cli-create.test.ts`. |
| 3 | annoying | `nb edit` / `nb pull <file>` of a file deleted in the folder said "No file … in the workspace" / "Up to date". | A file named on its own comes back. Test: `c10-c14.test.mjs`. |
| 4 | annoying | `nb open --code` refused on a Mac with VS Code installed but `code` not on PATH. | Opens the installed app (`open -a`). Test: `c10-c14.test.mjs`. |
| 5 | annoying | A company proxy's certificate showed as "UNABLE_TO_VERIFY_LEAF_SIGNATURE / Check your connection". | "your network's certificate isn't trusted… nb config set ca-file <file.pem>" for every certificate code. Test: `help-network.test.mjs`. |
| 6 | polish | A setting couldn't be taken off (`nb config set ca-file ""` refused). | `nb config unset <key>`. Test: `help-network.test.mjs`. |
| 7 | annoying | Retry on error toasts is wired in 12 of 467 places; the board's "Couldn't move task" and the editor's "Couldn't save version" had none, and the "check your connection" step is lost where callers replace the error text. | Retry on editor save and task move. **The rest is a sweep for the user to decide.** |
| 8 | annoying | `nb uninstall` left the token in the macOS Keychain. | Each saved sign-in is removed from the keychain too. Test: `c10-c14.test.mjs` (a stand-in `security`). |
| 9 | annoying | With tools loaded on demand, Claude Code found only file tools and pushed "as draft" when asked to apply. | `networkbase_file_push` names `networkbase_change_start` / `networkbase_change_apply` (tools/list stays under 4,000 tokens). Live rerun passed. |

Polish noted, not fixed: the assign picker lists you twice ("Me" and your name); the device code countdown reads
like a clock ("expires 10:00"); Settings' terminal cards don't show the computer name; the branch breadcrumb wraps.
The agent harness now uses the folder's workspace and `nb api` (it assumed the seeded server).
