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
