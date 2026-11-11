# CLI and agents, next round (2026-11-11)

Everything agreed on 2026-11-11, in eight parts:

- **Part A:** agent sign-in from start to finish: a one-click approval page with presets and "All my workspaces", the terminal side, and what the agent knows it may do.
- **Part B:** how agent work is labelled ("via Claude Code").
- **Part C:** CLI improvements for a person at the terminal: normal use, daily work, files, working together, errors and help, reliability.
- **Part D:** the flow where a person asks an AI and the AI uses the CLI.
- **Part G:** NetworkBase as a codebase for AI: change sets, so an agent can do a full multi-file coding job (for example "redesign the authentication page") as fast as on a local project, with one review, one apply and one undo. **The most important part.**
- **Part H:** branches in the Files tab, the core loop: branches, saves and history, merge requests, protecting main, and the CLI, git and GitHub on the right branch. Built on Part G.
- **Part E:** a fresh walkthrough of both journeys, to find what's still missing.
- **Part F:** the other areas: classes, planning, workspace admin, agent management, security, automation, updates, data, accessibility, docs.

Basis: all 92 commands in CLI 2.0.3 (`nb help --json`) compared with what the app can do, on 2026-11-11.

Nothing here is built. The user says "implement" when satisfied.

**Reading order:**
- **Part 0** sets the rules every part follows.
- **Parts A–G** describe the work.
- **The registers at the end** list every migration, release, error code, user step and risk in one place.

**Last full review:** 2026-11-11 (see the review log at the end).

---

# Part 0: rules every part follows

**0.1 How work is done**
- **Building starts** only on the user's "implement", on local `main`.
- **Commits:**
  - local, with named files only (never `git add .`, `src/` or `-A`)
  - no push, deploy, production migration or npm release without the user's go-ahead
- **Migrations:** each one goes to production before the push that uses it, with `scripts/setup-database.ts` after checking the live lineage. They're numbered in the order they're applied (register R1).
- **Tooling:**
  - npm only (`npm install --package-lock-only`, then `npm ci`)
  - typecheck with a 6 GB heap
  - no temporary routes in the repository; browser checks run on a scratch copy on port 3100 or live

**0.2 Every server change includes:**
- a domain function holding the rule
- a `/api/v1` route that calls it
- an entry in the token route list with its scope
- workspace access, plus the pause and organization checks (A5)
- for writes:
  - a rate limit
  - `Idempotency-Key` support
  - an undo inverse where the change can be undone
  - the agent policy kind
- new error codes in the error catalog, with a docs anchor
- the OpenAPI and CLI schema regenerated (`scripts/api/export-schemas.ts`)
- DB tests

**0.3 Every CLI command includes:**
- the command table entry and help text
- a `--json` schema (`nb.<area>.<verb>/1`)
- exit codes from the existing table
- a fake-server route and tests
- the help snapshot, `commands.json` and the docs page regenerated
- the size and startup budgets still met

**0.4 Every agent tool includes:**
- a tier: read, small (with Undo), needs-yes, or never
- a pack (core, files, classes, admin or planning)
- a description of one or two sentences
- cases in the agent test (D22)

**0.5 Every screen includes:**
- light and dark themes
- 390 px phone width
- keyboard use and screen-reader labels
- copy through `copyText` or `copyOrSay`
- a browser check after deploy (signed in, where needed with the user)

**0.6 Every part states:**
- its **MVP:** the smallest release that is useful on its own
- its **journeys** for a normal user and a heavy user
- its **situations table** (what happens in each unusual case)

So nothing is left to decide while building.

**0.8 Everyday polish** (found while planning, 2026-11-11; built in the milestone shown)

| # | Item | Milestone |
|---|---|---|
| 1 | Every new list (history, branches, merge requests, change sets, agents, access requests) has an empty state with one sentence and one action, including a copy-ready CLI command | each milestone's screens |
| 2 | **"What's this?"** help links next to new ideas (preset, change set, branch, merge request, save), opening the matching `/docs` section | M1, M5, M8 |
| 3 | A one-time, dismissible **"New: …" banner** in the app when one-click agents, change sets and branches ship | M1, M5, M8 |
| 4 | Unsaved edits in the app editor are kept when switching branch, opening a change set or leaving the page (with the existing leave warning) | M5, M8 |
| 5 | Comment drafts on merge requests and change sets are kept locally until sent | M5, M8 |
| 6 | Every error toast has **Retry** when retrying makes sense, plus the error's next step (C5, in the app) | M4 |
| 7 | Confirm dialogs name the exact thing ("Delete branch task/4-login-bug with 3 saves not in main?") | each milestone |
| 8 | Skeletons, not spinners, for branch switching and diff loading; a branch switch keeps the scroll position per folder | M8 |
| 9 | Times in history, saves and merge requests use the person's time zone, with the exact time on hover | M5, M8 |
| 10 | Notifications group per merge request and per change set | M5, M8 |
| 11 | Keyboard: `/` searches files, `b` opens branches, `?` lists shortcuts on Files screens | M8 |
| 12 | Docs pages: `/docs/agents` (presets, asking for more), `/docs/files/changes`, `/docs/files/branches`, and `llms.txt` updated each milestone | M1, M5, M8 |
| 13 | The yes prompt for README edits names the README ("Change README (+5 lines)") (also D4) | M4 |
| 14 | A failed upload never leaves an empty file entry: the node is made only after the content is stored, or removed on failure | M4 |
| 15 | A starter README (no file yet) gets **Edit** in the app, creating its file the same way the CLI does | M4 |
| 16 | The npm `next` tag moves off 2.0.0-next.3 (with the 2.0.4 approval) | M1 |

**0.9 Tracking:**
- Every item in this report has a row in `docs/superpowers/plans/2026-11-11-ledger.json` (readable view: `2026-11-11-ledger.md`), with its milestone, its test and its status (`todo` → `built` → `tested` → `live`, or `n/a-live`). Rows come from `npx tsx scripts/plan/report-items.ts sync`.
- `npm run check:plan-ledger` fails when an item has no row, a row has no test, or a closed milestone still has unfinished rows.
- Every milestone ends with "Remaining in this milestone: 0".
- Anything new found while building is added here and to the ledger the same day.

**0.7 Done means:**
- unit, DB, CLI and agent tests pass, with typecheck and lint clean
- docs updated
- the part's "done when" list met
- the live check run, with the result recorded in memory and in the report

---

# Part A: agent sign-in from start to finish (approval page, terminal, and what the agent knows)

**Asked:**
- Offer **All my workspaces** when approving an AI agent.
- Stop showing workspace names twice ("Network for builders (network-for-builders)").
- Cut the clicking: today, full help needs ticking three boxes.
- Make the approval understandable end to end: the page, how the CLI shows it, and how the AI understands what it may do.

**Decisions taken** (the recommended options, agreed 2026-11-11):
1. **The default preset is Full help.** Big steps still wait for the person's yes.
2. **The default place** is what the CLI asked for, otherwise **All my workspaces**.
3. **The choice is remembered per agent,** and pre-filled next time.
4. **"Asking for more"** (an agent requesting extra access in the inbox) is built **now**, as part of Part A.

## A1. What's there today

- **Approval form:** "An AI agent" requires one workspace. The `<select>` shows `Title (slug)` (`DeviceClient.tsx:173`).
- **The three extras** (Finish tasks, Final files, Edit docs) are checkboxes, off unless ticked. Without them the agent can't even *ask* to do those things. With them it can ask, and each still waits for the person's yes (`agentGate`).
- **Scopes:**
  - Base agent scopes are `workspace:read`, `task:read`, `task:write`, `file:read`, `file:write`.
  - The extras are `task:complete`, `file:final`, `doc:write`.
  - An empty list means "base" (`token-access.ts:51-58`).
  - There is no read-only agent today.
- **The token stores one `workspace_id`.**
- **Per-request checks run once, at sign-in time** (`_shared.ts:167-178`). They check the token's single workspace for:
  - "Agents are paused"
  - "this organization doesn't allow agents"
  - the daily write limit

  ⚠️ An all-workspaces token has no single workspace, so these checks would be **skipped**. That's the main risk, and A5 moves them.
- **Keeping an agent inside its workspace:** routes call `denyOutsideTokenWorkspace` with the workspace or task they touch; a unit test checks every route does.
- **Lists filtered by the token's workspace:** 7 read routes (`tasks/count`, `me`, `events`, `questions`, `assignments`, `extension/workspaces`, hosted MCP).
- **"Verify it's you"** lasts 5 minutes (`SECURITY_STEP_UP_MAX_AGE_SECONDS`).
- **The CLI has no dependencies** (`packages/nb-cli/package.json`).

**Page review** (live, signed in, Chrome, desktop and phone, 2026-11-11):
- **Heading** reads like a log line: "Approve Page review via NetworkBase CLI?".
- **The code appears twice:** in the sentence and in the big box.
- **The device name is cut off** ("Chs-MacBo…").
- **Location is a raw IPv6 address.**
- **Workspace list** shows slugs, including random suffixes ("team-falcon-hash-table-library-oxao5"), in one flat list.
- **Nothing says what you're about to allow.**
- **"Also allow (off unless you tick)"** makes full help cost three clicks.
- **The side panel** says "Agents only reach the workspace you pick".
- **The signed-out hint** wraps `nb login --device` as "nb login — device".
- **Phone width (390 px):** already fits.

## A2. The approval page: summary first, options on request

The page opens already filled in. The normal case is **one click: Approve.**

```
Claude Code wants to work with you on NetworkBase
Your terminal shows  D9GM-9N7Z
Chs-MacBook · macOS · From India · just now

Claude Code can work in all your workspaces for 30 days. It does small
things itself (reading, tasks, comments, drafts) and asks you before
finishing tasks, final files, doc edits or deleting.            Change

[ Approve ]                                              [ Not me ]
```

- **Heading:** "**<agent>** wants to work with you on NetworkBase". The CLI version and the device go on the line below, not in the heading.
- **The code shows once,** in the big box. The sentence reads: "Approve only if your terminal shows the same code."
- **The device line wraps** instead of cutting off.
- **Location reads "From India"**, with the address in small text after it. This uses Cloudflare's country, saved when the code is made: migration **0082**, `device_codes.country`, nullable.
- **The summary sentence** says who, where, how long, what it does alone, and what waits for a yes. It rewrites itself whenever an option changes, so what you approve is always spelled out in words.
- **Change** opens three groups, each a single choice:

| Where | What it may do | How long |
|---|---|---|
| **All my workspaces (N)** · One workspace | **Full help**: does small things itself and asks before finishing tasks, final files, doc edits and deleting (all three extras) · **Small changes only**: never finishes tasks, finals or docs (base) · **Read only**: looks and reports, changes nothing (new) · **Custom**: the three ticks, as today | 7 · **30** · 90 days |

- **One workspace** opens a picker:
  - titles only, never the slug
  - grouped "Your workspaces", then one group per organization, with a small "Team" or "Class" label where useful
  - a search box once there are more than 8
- **Organizations that turned agents off** show "Agents off" and can't be chosen. They're left out of "All my workspaces (N)".
- **Workspaces where the person is only a viewer** accept **Read only** only. Full help and Small changes don't reach them, and the summary says so.
- **What it pre-fills, in order:**
  1. What the CLI asked for in the sign-in request (A5, A10).
  2. What the person chose last time for this agent name.
  3. Otherwise **Full help · All my workspaces · 30 days**.

## A3. Every situation the page handles

| Situation | What the page does |
|---|---|
| **Signed out** | Sign in, then straight back with the code filled in |
| **No code, or mistyped** | A code box that takes pasting, any letter case, with or without the dash |
| **Code expired or used** | Says so plainly, with the command to run again and a copy button |
| **The person's own terminal, not an agent** | Known from the request. "Sign in **your terminal**" with its own summary (all workspaces, 90 days, does what you can). A small "This is actually an AI agent" link switches |
| **Editor signing in through the browser (OAuth)** | No code box, because the browser came straight from the editor. "Sends you back to <host>" is shown. Agent sign-in only |
| **"Verify it's you" needed** | Asked inside the page. A verification within the existing 5-minute window counts, so a second approval doesn't ask again |
| **Organization turned agents off** | Its workspaces show "Agents off". If nothing is left to choose, the page explains why and who can change it |
| **Only viewer access** | Read only offered; the summary says why the others don't apply |
| **Many workspaces** | Search box and organization groups (A2) |
| **No workspace the person can change** | Read only is still offered (it reaches workspaces they can read). Otherwise: "You don't have a workspace yet", with **Create a workspace** and the sign-in kept waiting until they come back |
| **The same agent asking again** (renewal) | "Renew **Claude Code**'s access", with its current settings, one click |
| **Not me** | "Someone tried to sign in as you from India." Offers **Sign out everywhere**, **Change password**, and a link to Security settings; the request is denied |
| **After approving** | "Claude Code is connected. Go back to your terminal; it continues on its own." Two prompts to try ("What should I do today?", "Work on task 4") and a link to Settings → Integrations |
| **Phone** | Same single column. Approve and Not me full width, stacked |
| **Dark mode** | Same tokens as the rest of the auth pages |

**Also:**
- The side panel reads "Agents reach only the workspaces you allow".
- The signed-out hint shows `nb login --device` as one unbroken code chip.

## A4. The terminal side: how the CLI shows it

**Start:**
- `nb agent setup claude` and `nb login --device --agent` open the browser by themselves, with the code filled in.
- The terminal shows the code large, plus a **QR code** of the approval link, so a server or SSH session can be approved from a phone.
- The QR encoder is built into the CLI (no new dependency). The QR is printed only when the terminal is wide enough, and never with `--json` or `--plain`.

**While waiting:**
```
Waiting for you to approve in the browser… D9GM-9N7Z (expires 03:56)
```

**When approved, the CLI repeats the page's sentence:**
```
✓ Claude Code connected · all workspaces · asks before big changes · until 11 Dec
  Try it: open Claude Code and ask "what should I do today?"
```

**Afterwards:**
- **`nb agent status` and Settings → Integrations** use the same sentence for each connected agent.
- **Changing access needs no new sign-in:**
  - **Change access** in Settings → Integrations, or `nb agent access claude --read-only | --small | --full | --workspace <ws> | --all-workspaces`, updates the existing sign-in.
  - It uses the same "Verify it's you" as the page.
- **Renewal:**
  - 7 days before an agent sign-in expires, the inbox says "Renew Claude Code: one click". That opens the renewal page (A3) with the current settings.
  - Editors that signed in through the browser renew by themselves with refresh tokens (F4).
- **`nb whoami`** says "all your workspaces" or "only <title>", and the access level, instead of today's "one workspace only".

## A5. Server

- **The token:** an "All my workspaces" agent has `workspace_id = NULL` **and** `all_workspaces = true` (migration 0082). The database requires every agent sign-in to have exactly one of the two, so a missing workspace can never happen by accident (found while building M1: 0072 required a workspace for every agent). Scopes per preset:
  - **Full help:** base + all three extras.
  - **Small changes:** base.
  - **Read only:** `workspace:read`, `task:read`, `file:read`, stored explicitly. An empty list keeps meaning "base", so existing tokens don't change.
- **Approval:** `deviceDecisionSchema` accepts `workspace: "all"` and `access: "full" | "small" | "read" | "custom"`.
- **Every request:** `denyOutsideTokenWorkspace` (already called by every route that touches a workspace) runs the pause check, the organization check and your normal access for the workspace that request touches. One-workspace tokens behave as today. The daily write limit stays per token.
- **Lists:** for an all-workspaces agent, the 7 read routes leave out paused workspaces and organizations that turned agents off.
- **Hosted MCP:** with no fixed workspace, tools take the `workspace` argument they already accept, and `workspace_find` helps the agent pick.
- **What the CLI asks for:** the sign-in request (`device-code` and OAuth `/oauth/authorize`) can carry the access it wants (`access`, `workspace`). The page shows it as the proposal; the person can still change it.
- **Remembered choices:** the last choice per person and agent name (where, what, how long) is stored and used to pre-fill. Migration **0083**: a small `agent_access_defaults` table (`user_id`, `agent_name`, `workspace_id` nullable, `access`, `expiry_days`, `updated_at`; one row per person and agent name; RLS, app role only).
- **Changing access in place:** a route updates an existing agent sign-in's scopes and workspace (the person's own, after "Verify it's you") and records a security event.
- **Asking for more:**
  - When an agent hits a missing scope (for example `task:complete` on a Small-changes sign-in), the server doesn't just answer 403. It also creates an access request and tells the agent "Asked the person; they'll answer in NetworkBase".
  - The person gets an inbox item: "**Claude Code** asks to also **finish tasks**", with **Allow once**, **Always** and **No**.
    - **Allow once:** a one-time grant for that exact change, the same mechanism as the confirmation token.
    - **Always:** adds the scope to the sign-in.
    - **No:** the agent is told and doesn't ask again for 24 hours.
  - Limits: at most 3 open requests per sign-in, and they expire after 24 hours.
  - Migration **0084**: `agent_access_requests` (`session_id`, `scope`, `reason`, `status`, `created_at`, `decided_at`; RLS, app role only). Notification kind `agent_access_request`.
- **Renewal notice:** a daily job finds agent sign-ins expiring within 7 days and sends one inbox item each (deduplicated).
- **Tests:**
  - an all-workspaces agent is refused in a paused workspace
  - it's refused in an organization that turned agents off
  - it reads and writes in two workspaces
  - one-workspace tokens behave as before
  - Read only is refused every write
  - presets map to the right scopes
  - a remembered choice pre-fills
  - changing access needs "Verify it's you"
  - "asking for more":
    - Allow once works once
    - Always adds the scope
    - No blocks repeats for 24 hours
    - the 3-request limit holds
  - the renewal notice is sent once

## A6. What the AI understands

1. **An access card at the start.** When an agent connects (local `nb mcp` or hosted MCP), the server's instructions say in plain words:
   - who the person is
   - where it may work (all workspaces, or which one)
   - what it does alone
   - what needs the person's yes
   - when access ends

   The CLAUDE.md block from `nb agent setup` and the plugin skill say the same and point to the card.
2. **Only usable tools are listed.** Read only leaves write tools out of the tool list. Tools that need the person's yes are marked that way in their descriptions.
3. **Asking instead of failing.** A missing permission returns "asked the person", plus what to tell them (A5, "Asking for more"). The agent never invents another way round.
4. **Errors say what to do next.** Every refusal tells the agent what to tell the person, for example "ask them to allow Final files: Settings → Integrations, or the request in their inbox".
5. **The same words everywhere:** the page sentence, the terminal line, `nb agent status`, Settings and the agent's card all come from one function, so the person and the agent read the same description.

## A7. Safety rules that stay

- **Big changes always wait for the person's yes,** whatever the preset.
- **Organization AI rules and "Pause agents"** override every choice on this page.
- **Broad access is visible:**
  - "Full help · All my workspaces" sign-ins are listed first in Settings.
  - Use from a new country is flagged (F5).
  - Revoking takes one click.
- **The code check stays for terminal sign-ins;** it's what stops someone tricking the person into approving their sign-in.
- **Token lifetimes stay 7, 30 or 90 days.** "My terminal" sign-ins already reach all workspaces.

## A8. Docs and settings

- **Settings → Integrations:**
  - agent rows use the A6 sentence
  - each row gets **Change access**
  - the intro drops "limited to one workspace"
- **`/docs/agents`:** explains the presets, All my workspaces, "asking for more" and renewal.

## A9. Build steps

1. **Server** (A5) with DB tests first: all workspaces, presets including Read only, per-request checks, the 7 lists, hosted MCP, what the CLI asks for, change access, asking for more, the renewal notice. Migrations **0082** (`device_codes.country`), **0083** (`agent_access_defaults`), **0084** (`agent_access_requests`).
2. **Page** (A2, A3), **Settings and docs** (A8), and the A6 access card and tool list.
3. **CLI pieces** (A4, A6): opening the browser, the QR code, the connected line, `nb agent access`, `nb whoami` wording, the instructions block. Released as **CLI 2.0.4** right after the server deploy, so the one-click flow works end to end without waiting for 2.1.0.
4. **Live check after deploy,** signed in:
   - approve a test agent with one click (Full help · All my workspaces)
   - change it to Read only from Settings
   - let it ask for more and answer in the inbox
   - check the phone layout
   - revoke it

## A9b. MVP and journeys

**MVP:**
- the one-click page (A2) with the presets
- All my workspaces with per-request checks (A5)
- the CLI 2.0.4 terminal pieces (A4)
- the access card (A6)

**Right after:** remembered choices, "asking for more", the renewal notice, changing access in place.

**Journeys:**
- **Normal user:**
  1. `nb agent setup claude` opens the browser.
  2. The page is already filled in: one click on Approve.
  3. The terminal says "✓ Claude Code connected · …".
  4. They ask Claude something.
- **Heavy user** (several agents, many workspaces):
  - each agent remembers its own choice, so approving again is one click
  - Settings → Integrations lists every agent with its sentence and Change access
  - `nb agent status` shows them all
  - "Read only" agents are used for analysis across every workspace
- **Cautious user:** Change → One workspace · Small changes only · 7 days. The sentence updates as they choose; one click.
- **Team owner:** sees in Settings which members' agents reach the workspace, through the existing agent activity. Pause agents stops them all.

## A10. Build spec: contracts, errors, done

**Routes and actions:**

| Piece | Where | Shape |
|---|---|---|
| Sign-in request with wishes | `POST /api/v1/extension/device-code` (exists) | adds optional `requestedAccess: "full" \| "small" \| "read"` and `requestedWorkspace: "all" \| <id>`; stored on `device_codes` with the country (0082) |
| OAuth wishes | `GET /oauth/authorize` (exists) | standard `scope` parameter: `networkbase:full`, `networkbase:small`, `networkbase:read`, plus optional `networkbase:workspace:<id>` |
| The person's answer | server action `decideDeviceCodeAction` (exists) | input becomes `{ decision, type, access, workspace: "all" \| id, expiryDays, extraScopes? (custom only) }`, validated by `deviceDecisionSchema` |
| Remembered choice | written on approve | upsert `agent_access_defaults` (0083) by `(user_id, agent_name)` |
| One sentence for every place | `describeAgentAccess(session)` in `src/lib/agents/access-words.ts` | used by the page, Settings, `/api/v1/me` (`access.sentence`), the MCP access card and the inbox. The CLI prints the server's sentence, so the words come from one place |
| Change access | Settings → Integrations → **Change access**, a small page like the approval page | "Verify it's you", then it updates the session's `scopes` and `workspace_id`, and records security event `agent_access_changed` |
| Change access from the terminal | `nb agent access claude …` | opens that Settings page pre-filled (the terminal can't do "Verify it's you"), and prints the new sentence when saved |
| Asking for more | in `requireTokenScope` for agent tokens | instead of a plain 403, creates a row in `agent_access_requests` (0084) and answers `403 ACCESS_REQUESTED { requestId, scope }`. The MCP layer turns that into "Asked the person; they'll answer in NetworkBase" |
| The answer | server action `decideAgentAccessRequestAction(id, "once" \| "always" \| "no")` from the inbox item | **once:** the agent's retry with header `X-NB-Access-Request: <id>` and the same request-body hash is allowed one time. **always:** adds the scope. **no:** `ACCESS_DENIED_BY_PERSON` for 24 hours for that scope |
| Renewal notice | a daily Inngest cron | sends one inbox item per agent sign-in expiring within 7 days (dedupe key: session and expiry date); "Renew" opens the approval page in renewal mode |

**New error codes** (added to the error catalog, docs anchors and CLI messages): `ACCESS_REQUESTED`, `ACCESS_DENIED_BY_PERSON`.

**Done when:**
- every test in A5 passes
- the approval page is checked live at 1440 px and 390 px, light and dark, keyboard only
- a real agent connects with one click, is changed to Read only from Settings, asks for more and gets "Allow once"
- `nb whoami` and Settings show the same sentence
- the live check in A9 passes

**Risks:**
- An all-workspaces token is worth more if stolen. Mitigations: new-country flags (F5), one-click revoke, a 30-day default, and every request still checked against the workspace it touches.
- Agents asking for more too often. Mitigations: a limit of 3 open requests and 24 hours of quiet after "No".

---

# Part B: labelling agent work

**Today:** one shared component, `ViaLabel` (`src/components/ui/via-label.tsx`), draws a bot icon and "via Claude Code" next to the person's name. It's used on versions, comments, subtasks, activity and hand-ins. Every agent change also stores `via` and `agent_name`.

**Decision:** keep the record, change how it's shown.

1. **The person is always the author.** The bot badge becomes small muted text after the name: "Ram · with Claude Code", like "edited on iPhone". The agent is a tool the person used, not a co-author. Same for the CLI: "with the CLI", or nothing (see 2).
2. **Workspace owners choose who sees it** in personal and team workspaces. A new setting in workspace settings → Agents, "Show when agents helped", offers:
   - **Everyone:** the default, so nothing changes until an owner chooses.
   - **Only the person:** the person who used the agent still sees it.
   - **No one:** hidden for everyone.

   Stored in a new workspace column (migration 0085). `ViaLabel` reads it, plus who is viewing.
3. **Organizations: always shown where the class asks.** In organization workspaces and assignment copies, the label shows for teachers, reviewers and admins whenever the assignment's AI policy is "Labelled" or "Not allowed". Owners of those copies can't turn it off. Hand-in file labels, the roster's "AI used" column and the export stay as they are.
4. **The record never goes away.** Settings → agent activity, Undo (`nb undo --session`), Pause agents, session summaries and security alerts keep using `via` and `agent_name` whatever is shown.

**Tests:**
- Each setting × each viewer (the person, a teammate, the owner, an organization reviewer).
- An organization assignment can't hide the label.
- Undo and agent activity still find agent changes when the label is hidden.

**Build spec:**
- **Migration 0085:** `workspaces.agent_label_visibility` text NOT NULL DEFAULT `everyone`, CHECK in (`everyone`, `person`, `none`).
- **The server decides, not the browser.** "No one" must also mean the data isn't sent to other people. One helper, `visibleVia(viewer, workspace, row)` in `src/lib/agents/via-visibility.ts`, returns `{ via, agentName }` or nulls. It's applied in every read path that feeds a label:
  - the file version list (`listFileVersionsPage`)
  - task discussion and comments
  - subtasks
  - workspace activity (route and app)
  - hand-ins and the review queue
  - the CLI and API activity outputs

  A unit test finds every reader of `via` or `agent_name` and checks it goes through the helper.
- **Organization rule:** for organization workspaces and assignment copies whose policy is "Labelled" or "Not allowed", the helper always shows the label to owners, admins, teachers and reviewers, whatever the setting.
- **UI:**
  - `ViaLabel` changes to muted text "with Claude Code", or "with the CLI" (no bot icon).
  - The setting lives in workspace settings → Agents, as a three-way choice with one line explaining each.
- **The setting applies when things are read,** so changing it also changes how past work shows. Nothing stored is rewritten.
- **The same helper covers every place authorship shows:**
  - the app
  - the CLI and API
  - email notifications
  - exports (F8)
  - Part H's saves and merge requests
- **MVP:** the muted "with Claude Code" text and the server helper. The three-way setting follows straight after.
- **Journeys:**
  - **Owner:** workspace settings → Agents → "Show when agents helped" → Only the person. Teammates no longer see the label anywhere; the owner still sees their own.
  - **Teacher:** opens a "Labelled" assignment's review. The label shows whatever the student's setting is.
- **Done when:** the tests pass, and it's checked live with two accounts (owner and member) for each setting.
- **Risk:** a forgotten read path leaking labels. The unit test above guards against it.

---

# Part C: CLI improvements for a person at the terminal

Marks used below:
- **(new server)** needs new server work and usually a migration.
- **(app has it)** means the server already supports it and only the CLI needs to reach it.

**Found by trying the CLI as a new, signed-out user (2.0.3, 2026-11-11):**
1. **Plain `nb` prints the full help page,** listing all 92 commands. A new person gets a wall of text instead of "here's what to do first".
2. **The advice comes in the wrong order when signed out.** `nb status`, `nb task list` and `nb push` say "This folder isn't linked to a workspace", but the real first step is signing in. (`nb doctor` already gets the order right.)

**C1. For a normal user (getting started and finding your way)**
- **`nb` on its own becomes a home screen that knows where you are** (today it prints the full help; `nb help` stays):
  - **signed out:** "Sign in", which runs `nb login`
  - **signed in, folder not linked:** "Link this folder? Best matches: Design Lab, Ponytail", using the folder and repository name
  - **linked:** today's view (what changed here, tasks due, unread)
- **Advice in the right order:** every command checks sign-in first, then the folder link, then its own error. A signed-out `nb push` says "Sign in first: nb login", not "link this folder".
- `nb init` suggests the matching workspace from the folder or git repository name.
- **Aliases** people expect (`nb ls` → `nb file list`, `nb add` → `nb task add`). Each prints the real name once.
- **`nb learn`:** a five-minute guided practice in a sandbox workspace made for it. Nothing touches real workspaces, and the sandbox is deleted at the end.
- **A shorter `nb help`:** the 10 most-used commands first, then "more" grouped by area.
- **"Did you mean" for flags and task names too,** not only for command names (today).

**C2. Daily work**
- **A home screen in `nb status`:** "3 tasks due this week · 2 unread · 4 files changed here", then the details.
- **`nb next`:** what to work on now, ranked by overdue, due soon, blocked work to unblock, reviews waiting, and assignments due (see F1).
- **Tasks by words as well as numbers:** `nb task start "login bug"`. One match runs; several ask which (in a terminal) or return the choices (`--json`, agents).
- **Natural dates everywhere a date is taken:** `--due friday`, `--due "next week"`, `--due 2026-12-01`, read in the person's time zone.
- **Pickers when something is left out,** only in a real terminal: `nb task assign 4` → choose a person. Scripts and agents still get the exact error.
- **Quick capture:** `nb task add "fix the footer" --due tomorrow`, a short form of `task create`.
- **`nb task create` takes everything at once:** `--due`, `--to <person>` and `--sprint` (today it takes only a title, description, priority and subtasks; due dates need `task edit`, the assignee needs `task assign`).
- **`nb task list` filters:** `--due today|week|overdue`, `--to <person>`, `--sprint`, `--priority`, `--sort due|priority|updated` (today: `--mine`, `--all`, `--status`, `--limit`, `--save`).
- **Bulk changes:** `nb task move 3 4 5 done`, `nb task assign 3 4 --to sam`, `nb task edit 3 4 --due friday`. One request for each command, all or nothing, one Undo.
- **Search beyond files:** `nb search` finds tasks, comments, docs and people as well as files (today: files only), with `--in tasks|files|comments|docs|people`.
- **Task labels:** `nb task edit 4 --label bug`, `nb task list --label bug`. **(new server)**
- **"Blocked by":** `nb task edit 4 --blocked-by 7`. The task shows it, and finishing #7 tells #4's assignee. **(new server)**
- **Watch a task** to get its notifications without being assigned: `nb task watch 4`. **(new server)**
- **Star a task:** `nb task star 4`, then `nb task list --starred`. **(new server)**
- **Reminders:** `nb task remind 4 "tomorrow 9am"`. Delivered to the inbox and by email, following notification settings. **(new server)**

**C3. Files**
- **Versions:** `nb file history <file>` (exists) gains "based on vN" and which version is active.
- **`nb file use <file> v1`:** the same as "Use this version" in the app (moves the active version; the next save is "based on v1").
- **`nb diff <file>` (exists):** gains comparing two server versions (`--from v1 --to v3`) as well as local against the server.
- **Trash:** `nb file trash` lists deleted files with how many days are left, and `nb file restore <file>` brings one back. **(app has it)**
- **Folders and copies:** `nb file mkdir <folder>`, `nb file copy <file> <to>`.
- **Starred and Recent**, as in the Files tab: `nb file star <file>`, `nb file list --starred`, `nb file recent`. **(new server)** The app keeps Starred in the browser only (`localStorage` in `src/stores/files`), so stars move to the server and the Files tab reads them from there too. Recent comes from the person's own file activity.
- **Locks:** `nb file lock <file>` / `unlock`, which shows teammates "Ram is editing this", using the same leases as the app's editor.
- **Remembered partial pulls:** `nb pull <folder>` works today but nothing remembers it, so the next `nb pull` brings everything. `nb sync --only design/ docs/` saves the choice for this folder.
- **Large uploads** show progress, can be paused with Ctrl+C, and resume on the next push (files can be 25 MB).
- **`--dry-run` on every write command:** prints what would happen and changes nothing (today on push and pull only).

**C4. Working together**
- **Act from the inbox:** `nb inbox reply 3 "done"`, `nb inbox approve 3` (for reviews), plus the existing `read` and `open`.
- **Inbox settings:** `nb inbox mute <workspace|task>`, quiet hours, and turning notification types on or off, matching Settings → Notifications. **(app has it)**
- **@mentions** in comments that complete member names in a terminal, and are checked against members in scripts.
- **Comments:**
  - reply in a thread: `nb comment add --reply 12 -m "…"`
  - edit your own: `nb comment edit 12`
  - delete your own: `nb comment delete 12` **(app has it)**
  - comment on docs: `nb comment add --doc readme`
- **Members** (owner and admin only for changes):
  - `nb member invite <email> --role member` **(app has it)**
  - `nb member role <person> admin`
  - `nb member remove <person>`
  - `nb workspace leave`
- **Updates:** `nb update list` (the workspace's feed), comment on an update, and like one, as well as the existing `nb update post`.
- **Messages:** reading direct messages and channels, and replying: `nb message list`, `nb message read #design`, `nb message send #design "…"`. **(new routes)** The app's messaging has no `/api/v1` routes yet (only attachment uploads), so this needs read and send routes over the existing messaging code, and two new token scopes, `message:read` and `message:write`. Neither is in any agent preset; agents still never send without a yes (D12).
- **`nb review`:** shows what changed since the last hand-in as a diff. Teachers can approve or return several at once (`nb review approve 3 5 8`).

**C5. Errors and help**
- **Every error ends with the exact next command.** An audit checks all of them.
- **Every error links to its docs section** (`/docs/cli#error-…`).
- **`nb help <topic>`** for files, agents, classes, sign-in and offline, with real examples tested in CI.
- **`nb upgrade`** updates the CLI the way it was installed (npm, npx needs nothing).

**C6. Reliability**
- **`nb queue`:** shows the offline queue (what's waiting, since when, why), with `nb queue retry` and `nb queue drop <n>`. Today it's invisible.
- **Token expiry:** a warning 7 days before a sign-in expires, and `nb login` renews the same sign-in instead of making a second one.
- **App and `nb watch` together:** a test where the same file is edited in the app while `nb watch` runs. The result must be a conflict copy, never lost work.
- **Network drops:** a CI test that cuts the network at every step of a push and a pull, and checks nothing is lost or doubled.
- **Large workspaces:** a timed test with 5,000 files and deep folders; `nb status`, `nb pull` and `nb push` stay within set limits.
- **Tested on a real Windows machine:** install, sign in, push and pull, watch, the agent setup.
- **Tested behind a proxy and on a company network** with its own certificates.
- **A startup-speed budget** checked in CI for `nb status` and `nb help`.

**C7. The first minute**
- **One command to start from nothing:** `npx @networkbase/cli start` signs in, links this folder (with the C1 suggestions) and pulls the files, stopping only to ask what it can't guess.
- **Install without Node:**
  - **a single-file `nb`** for macOS, Windows and Linux, built with Node's single-executable support and attached to each GitHub release
  - **a Homebrew formula**
  - **winget and Scoop packages** on Windows

  Many people, including students, don't have Node. The npm package stays the main channel, and `nb upgrade` (C5) updates whichever way it was installed.

**C8. Knowing what you're working on**
- **The CLI remembers your current task.** It comes from `nb task start 4`, or the git branch made by `--branch`.
  - `nb push` attaches files to it
  - `nb done` finishes it
  - `nb comment "…"` comments on it

  No task number to type. `nb status` shows it, and `nb task stop` clears it.
- **The current task in your shell prompt:** `nb prompt` prints a short marker such as `[#4 · 2 changed]`. `nb setup shell` offers to add it to the prompt (asks first, like completions).
- **Tab completion that knows real names:** task numbers with their titles, member names and workspace file paths. They come from a small local cache, refreshed in the background and never older than 10 minutes.

**C9. A terminal dashboard**
- **`nb ui`:** a full-screen, keyboard-driven view with three panes: tasks, inbox and changed files.
  - **Keys:** Enter opens an item, `d` marks it done, `p` pushes, `/` searches, `?` lists the keys.
  - It respects `--plain` (no full-screen mode; it prints the same as `nb status`) and works at 80 columns.
  - It's for people who live in the terminal and want the app's overview without a browser.

**C10. Editing and files**
- **`nb edit <file>`:** pulls the file, opens it in your editor, and saves a new version when the editor closes, with the same conflict rules as `nb push`. Works for any text file, not just docs.
- **`nb open <file> --code`:** opens the file in VS Code or Cursor (whichever is installed), from the linked folder.
- **`nb undo --list`:** your recent changes from this computer, newest first, with what each would undo, so you can choose which one.

**C11. Output you can use**
- **`--format table|json|csv|md` on every list.** Markdown pastes straight into chat or a document; CSV opens in a spreadsheet. `--json` stays the same.
- **Relative times everywhere** in human output: "due in 2 days", "updated 5 min ago". Exact times stay in `--json`.
- **Clickable links** in terminals that support them, with copy-friendly links otherwise (already partly in place; extended to every task, file and comment line).
- **`nb task view`** shows on one screen: the checklist, files with their roles, the latest 3 comments, who's assigned, and who (person or agent) is working on it now.

**C12. Git**
- **`nb commit`:** commits with a `NetworkBase-Task: #4` line added (the current task from C8). Plain `git commit` keeps working.
- **Pull request links:** a pull request that mentions the task shows on the task. Merging it can move the task, through the F6 GitHub Action.

**C13. Staying informed in the terminal**
- **`nb watch` can show inbox events as they happen** ("Sam commented on #4"). Turned on with `--inbox`; quiet otherwise. It follows notification settings and quiet hours.

**C14. Leaving cleanly**
- **`nb uninstall`:** signs out (revoking the sign-in), wipes local NetworkBase data and caches, removes shell additions it made (completions, prompt), and prints the command to remove the package for the way it was installed.

**CLI release:** Part C needs CLI 2.1.0. New commands are added, and nothing existing changes meaning.

**C14b. MVP and journeys**

**MVP** (the first slice of 2.1.0):
- the home screen and the right advice order (C1)
- `task create` with due date and assignee, and the list filters (C2)
- `nb next`
- tasks by words and natural dates
- bulk changes
- `nb file history` with "based on", and `nb file use` (C3)
- inbox reply and approve (C4)
- every error with its next command (C5)
- `nb queue` (C6)

**Journeys:**
- **Normal user's day:**
  1. `nb` shows "3 due this week · 2 unread".
  2. `nb next` → `nb task start "login bug"` → edit → `nb push`.
  3. `nb done`.
  4. `nb inbox reply 1 "fixed"`.
- **Heavy user's day:**
  - `nb ui` open in a side terminal
  - completions with real names, and the prompt showing `[#4 · task/4 · 2 changed]`
  - `nb task move 3 4 5 done` and `nb task list --due week --format md` pasted into chat
  - `nb watch --inbox` running
  - `nb undo --list` after a mistake
- **Offline:**
  - reads come from the cache, labelled "offline"
  - writes queue (`nb queue`) and replay
  - commands that need the server (search, invites, messages) say so

**With branches (Part H):** every file command works on the folder's current branch:
- `nb file history` shows that branch's saves
- `nb file use` on a branch makes a save there
- `nb diff` compares with that branch

**C15. Build spec**

**Server work, per item:**

| Item | Server change |
|---|---|
| Home screen, `nb next` | new `GET /api/v1/home`: counts, tasks due, unread, reviews waiting, assignments due, current task; one call |
| Advice order | CLI only (checks sign-in, then link, then the command) |
| `task create` everything at once | extend the create route with `dueDate`, `assigneeId`, `sprintId` |
| `task list` filters | extend `GET /api/v1/workspaces/:id/tasks` with `due`, `assignee`, `sprint`, `priority`, `label`, `starred`, `sort` |
| Tasks by words, people, dates | new `GET /api/v1/resolve?task=&person=&date=`: one match, or candidates (shared with D2) |
| Bulk changes | new `POST /api/v1/tasks/bulk { ids, action, value }`: one transaction, one undo (new inverse kind `tasks.bulk`) |
| Search beyond files | extend search with `in=tasks,files,comments,docs,people`, using the existing search and text search |
| Labels, blocked by, watch, star tasks, star files, PR links | **migration 0086:** `tasks.labels text[]` (GIN), `task_dependencies (task_id, blocked_by_task_id)`, `task_watchers (task_id, user_id)`, `task_stars (task_id, user_id)`, `node_stars (node_id, user_id)`, `task_links (task_id, url, title, kind, created_by)`, plus routes on the task and file |
| Reminders | **migration 0087:** `task_reminders (id, task_id, user_id, remind_at, sent_at)`, a route, and one Inngest scheduled function that sleeps until `remind_at` (counted against the free plan) |
| `file use`, history, diff between versions | existing version routes, plus `GET …/files/:node/versions/:a/diff/:b` |
| Trash, restore, folders, copy | v1 routes over the existing Files actions (`restore`, `createFolder`, copy as a new node) |
| Locks | the existing file lease routes |
| Inbox reply, approve, settings | reply = comment add; approve = the existing review route; new `GET/PATCH /api/v1/me/notifications` over the existing preferences |
| Comments: reply, edit, delete, on docs | routes over the existing comment actions (`deleteTaskCommentAction` exists; edit and docs are new) |
| Members, updates | routes over the existing invite, role and remove actions; `GET /workspaces/:id/updates` plus like and comment |
| Messages | new chat routes (see C4) |
| `nb learn` | new `POST /api/v1/sandbox`: a temporary workspace flagged as a sandbox, deleted after 24 hours |
| Token expiry, renew | `/api/v1/me` already returns expiry; `nb login` sends `renewSessionId`, so the device flow updates the same session |
| `nb review` diff since the last hand-in | the existing review routes plus version diff |

**CLI:**
- Each new command gets the usual pieces:
  - a command table entry and help
  - a `--json` schema (`nb.<area>.<verb>/1`)
  - exit codes and a fake-server route
  - tests, the help snapshot, `commands.json` and the docs page
- `nb ui`, completions and the prompt are CLI-only.
- The single-file builds, Homebrew, winget and Scoop are release-pipeline work (`publish-cli.yml` and package repositories). **User steps:** create the Homebrew tap repository, and the winget and Scoop accounts or pull requests.

**Release split** (keeps 2.1.0 a safe size):
- **2.1.0:** C1–C6, C8, C10–C14, and the server pieces above apart from messages, `nb learn` and `nb ui`.
- **2.1.x:** `nb ui`, messages, `nb learn`, single-file builds and package managers.

**Done when:**
- every new command passes the CLI suite on Ubuntu, macOS and Windows (Node 20 and 22)
- the new routes pass DB tests
- the size and startup budgets hold
- the live walkthrough steps for the terminal journey (E1) pass on CLI 2.1.0

**Risks:**
- Scope creep makes 2.1.0 too big. Handled by the release split above.
- Messages through tokens raise privacy questions. Handled with their own scopes, which are off for agents.

---

# Part D: the person asks an AI, the AI uses the CLI

**Found by measuring what an agent receives** (local `nb mcp`, CLI 2.0.3, 2026-11-11):
1. **34 tools, about 27,000 characters (~6,700 tokens) of descriptions,** sent before the person says anything. The server instructions are ~200 tokens.
   - Largest: `file_push` (1,569 characters), `ask_user`, `task_done`, `file_attach`, `task_edit`.
   - Adding the Parts C and F commands as tools would roughly double this.
2. **Whole areas are missing as tools:**
   - assignments: view, hand in, take back, ask the class
   - reviews: list, approve, return
   - the inbox
   - answering agent questions
   - posting updates
   - unticking, editing and deleting subtasks

   A student can't say "hand in my assignment", and a teacher can't say "show me what's waiting for review".
3. **What's there today:** 3 prompts (`start-task`, `report-task`, `standup`) and 2 resources.

1. **The agent starts with context.** At the start of a session, the MCP server gives it: who the person is, the linked workspace (or that it may use all), open tasks and anything waiting on the person. It no longer needs 3–4 tool calls to find out.
2. **Everyday words:**
   - "the login bug" → task #12, "Sam" → the right member, "Friday" → a date.
   - The server answers with candidates when more than one matches, and the agent asks only then.
3. **One plan, one yes.** A request with several big steps ("finish #4, push the final report, tell Sam") becomes one combined preview. The person answers yes once, and that yes covers exactly those steps (one confirmation token for the batch).
4. **Clear yes prompts:**
   - The held-change summary names what changes, for example "Change the README (+5 lines)" with the diff.
   - "Push 1 file" goes away (found in flow C on 2026-11-11).
   - Same for final files, finishing tasks and deleting.
5. **Live progress in the app:** while an agent works on a task, the task shows "Claude Code is working on this". One summary arrives when the session ends, as today.
6. **Fix the 4 agent-test misses:** due dates, pushing, when to ask, and one delete case. These are tool description and instruction changes, checked first on today's 56-request test, then kept in the bigger test (22).
7. **Codex and Cursor** run today's 56-request test first (90% or better each), then join the bigger test (22).
8. **More editors:** `nb agent setup` finds which of Claude Code, Codex, Cursor, Gemini CLI and GitHub Copilot are installed and sets up all of them in one go, showing each change first.
9. **Shorter tool answers:** tool results drop fields the agent doesn't need, so it reads less and works faster. Measured as tokens per test request, before and after.
10. **Clean recovery:** when a step fails midway, the agent gets what happened, what was already saved and what is safe to retry. Retries reuse the same request key, so nothing happens twice.
11. **Agents can use the new areas:** every new command in Parts C and F also becomes an agent tool, each with its yes rule:
    - **Runs at once, with Undo:** reading things, labels, watching, starring, folders, restoring from Trash.
    - **Waits for the person's yes:** inviting members, changing roles, sending messages, bulk changes, exports, closing a sprint.
    - **Never:** removing members, or acting on another person's account settings.
12. **Agents never send messages on their own.** A message an agent drafts to a teammate (messages, comments that mention someone, update posts) is shown to the person first, and goes out only with their yes.
13. **A daily briefing on request:** "what changed since yesterday?" uses one tool, which gathers activity, the inbox and due dates into a short summary.
14. **Fewer tools to read, so the agent is faster and makes fewer mistakes:**
    - **A core set is always loaded:** who am I, find, task list, view, create, move, done, comment, push, pull, ask, undo (12), plus the change-set tools once Part G is on (`change_start`, `change_status`, `change_finish`, `change_view`, `change_apply`, `change_discard`, `change_resolve`), 19 in all. The 4,000-token target includes them.
    - **Everything else comes in packs loaded on demand:** files, classes, admin, planning. One tool, `networkbase_more_tools`, lists the packs and loads one for the session (MCP `tools/list_changed`).
    - **Trimmed descriptions:** each says when to use the tool in one or two sentences, with details moved into the argument descriptions.
    - **Target:** under 4,000 tokens per session start, measured in CI. A rise above it fails the build.
15. **Close the gaps:** new tools for:
    - assignments: view, hand in, take back, ask the class
    - reviews: list, approve, return
    - the inbox: read, answer
    - answering agent questions
    - posting updates (always waits for a yes, see 12)
    - the full set of subtask actions

    **The organization's AI policy applies:** on an assignment where AI is "Not allowed", the agent says so and stops (`AGENT_NOT_ALLOWED`). Where it's "Labelled", it works, and the labels follow Part B.
16. **Remembering across sessions:**
    - **Agent notes per task:** at the end of a session the agent saves where it stopped, for example "parsed 3 of 5 files; next: tests" (a `networkbase_task_note` tool).
    - **The next session continues from there,** on any computer: the note is part of the task context.
    - **Notes show on the task in the app** under "Agent notes", where the person can read or delete them.
    - **(new server)** Migration: `task_agent_notes` (`task_id`, `session_id`, `agent_name`, `note`, `created_at`; RLS, app role only).
17. **Two agents at once:**
    - **Presence is per agent,** so the task shows "Codex is also working on #4" next to "Claude Code is working on this" (D5).
    - **File locks (C3)** stop two agents saving over each other. The second gets a clear "Codex is editing this file" answer.
    - **Overlapping drafts** are handled by Part G (G15).
18. **Cloud agents edit files too:** delivered by Part G's `fs_*` tools (G14), which take content inline (up to 1 MB per file) and keep the same version and conflict rules. No separate file tool is built.
19. **Easy to check:**
    - **Every agent write returns one plain sentence plus its Undo** ("Moved #4 to In progress · undo: networkbase_undo abc123").
    - **Every session ends with a "What I did" list** with links. The agent shows it, and it also goes into the session summary notification.
    - **"Undo everything you just did"** undoes the whole session in one step: one tool call, refused only for changes someone else has built on since.
20. **Easy for any AI to learn:**
    - **`https://networkbase.in/llms.txt`:** a short description of NetworkBase, the CLI and its tools, written for AI readers.
    - **A generated tool reference** at `/docs/agents/tools`, from the same definitions as the MCP server.
    - **`nb help --agent`:** a compact guide for AI readers, printed in one go (commands, rules, exit codes).
21. **More prompts and resources:**
    - **New prompts:** "plan my week", "check my hand-in before I submit" (against the assignment's steps and AI policy), and "review my class" (for teachers).
    - **New resources:** the README, a task's context and the workspace overview, which editors let the person @-mention in chat.
22. **A much bigger agent test:**
    - **From 56 requests to about 150:**
      - students, teachers and team leads
      - multi-step requests and vague wording
      - failures: offline, expired sign-in, paused workspace, organization with agents off
      - traps hidden in task text (prompt injection)
      - a few requests in other languages
    - **Agents tested:** Claude Code, Codex, Cursor, Gemini CLI and GitHub Copilot.
    - **Scored on:** the correct result, the right yes prompts (asked when needed, never otherwise), the number of tool calls, tokens and time.
    - **When it runs:** every night against a seeded server, and before every CLI release. A drop below the last release's score blocks the release.

**Release:** Part D ships in CLI 2.1.0 with Part C, plus the server changes it needs: batch confirmation, candidates, presence per agent, agent notes, `llms.txt` and the tool reference. (Cloud file editing comes with Part G.)

**D22b. MVP and journeys**

**MVP:**
- the access card (1)
- everyday words with candidates (2)
- clear yes prompts (4)
- the missing class, review and inbox tools (15)
- tool packs within the token budget (14)
- "What I did" and session undo (19)
- the 4 test misses fixed (6)

**Next:** one plan, one yes (3); presence (5); agent notes (16); the bigger test (22).

**Journeys:**
- **Normal user:** "What should I do today?" → the agent answers from the access card and `nb next` data in one or two tool calls → "Work on the login bug" → it finds #12 → it asks one question if needed → it works → "What I did", with Undo.
- **Heavy user** (several agents and workspaces at once):
  - each agent shows its presence on the task it works on
  - two agents on one task are warned about each other
  - daily caps and Pause agents keep a runaway agent in check
  - `nb agent activity` and Settings list every session with Undo
- **Student:** "Check my hand-in, then hand it in" → the check prompt runs against the assignment's steps and AI policy → hand-in waits for their yes → done. On "Not allowed" assignments the agent says it can't help.
- **Teacher:** "What's waiting for review in CSE 3B?" → the review list → "Return 3 and 5 with 'add tests'" → one yes for the batch.
- **With branches on (Part H):** big work happens on an agent branch with a merge request, never directly on a protected main.

**D23. Build spec: how each piece works**

| Piece | Mechanism |
|---|---|
| **Access card (1, A6)** | MCP `initialize` instructions built from `describeAgentAccess()` plus `GET /api/v1/home` (who, where, tasks, waiting). Under 400 tokens |
| **Everyday words (2)** | `GET /api/v1/resolve` (C15). Several matches answer `409 AMBIGUOUS { candidates: [{ type, id, label }] }`, and the tool tells the agent to ask the person |
| **One plan, one yes (3)** | `POST /api/v1/plans { summary, steps: [{ method, path, body }] }` checks every step's permission and returns one `confirmToken` bound to the hash of all steps. `POST /api/v1/plans/:id/run { confirmToken }` runs the steps in order, each idempotent. On a failure it stops and returns done and not done (10). Steps across different things (a task, then files, then a message) are not one database transaction; the plan says so in its summary. File changes inside a plan go in one change set (Part G), which is all or nothing |
| **Clear yes prompts (4)** | `agentGate` gains a `describe()` per change kind, so the held summary names the object and size ("Change the README (+5 lines)") and carries the diff preview |
| **Presence (5, 17)** | reuses `POST /api/v1/presence/heartbeat` with `{ taskId, agentName, sessionId }`, sent by the MCP server every 60 seconds while tools are used; it expires after 90 seconds. Shown through the existing realtime broadcast on the task topic. No migration |
| **Shorter answers (9)** | each tool's result is shaped by a per-tool `fields` list. CI measures tokens per D22 request, before and after |
| **Recovery (10)** | every multi-step tool returns `{ done: [], notDone: [], safeToRetry: true \| false, undo? }`. Retries reuse `Idempotency-Key` |
| **New areas as tools (11, 15)** | tools added to packs with their tier (read, small, needs-yes, never), following D11 |
| **Messages need a yes (12)** | message, mention-comment and update-post tools are always "needs-yes" for agents, whatever the preset |
| **Daily briefing (13)** | tool `networkbase_briefing`, one call to `GET /api/v1/home?since=` |
| **Tool packs (14)** | `tools.mjs` gains `pack` per tool; the server declares `tools.listChanged`; `networkbase_more_tools { pack }` loads a pack for the session. A CI test counts description characters ÷ 4 and fails above 4,000 |
| **Agent notes (16)** | **migration 0088** `task_agent_notes`; `GET/POST/DELETE /api/v1/tasks/:id/agent-notes`; the notes are part of `task_context`; the app shows them on the task |
| **`llms.txt` and tool reference (20)** | `src/app/llms.txt/route.ts` and `/docs/agents/tools`, both generated from `commands.json` and the tool definitions at build time |
| **Prompts and resources (21)** | added in `lib/commands/mcp.mjs` (prompts) and the resources list |
| **Bigger test (22)** | `tests/agents/requests.yaml` grows to about 150 requests with persona tags; `scripts/agents/eval.mts` gains a runner per agent: `claude -p`, `codex exec`, `gemini -p`, and Cursor's and Copilot's command-line agents where they offer a non-interactive mode (manual runs in Part E otherwise). The nightly run is a scheduled GitHub workflow against a seeded server; scores are stored as a CI artifact and compared with the last release |

**Done when:**
- the token budget test passes
- the D22 score is 90% or better on Claude Code, Codex and Cursor, with no regression from the last release
- the student "hand in my assignment" and teacher "what's waiting for review" requests pass
- presence shows live for two agents on one task

**Risks:**
- Agents ignoring tool packs and calling unloaded tools. Handled: unknown tool calls answer with which pack to load.
- Headless modes differ between agents. Handled: manual runs in Part E where no non-interactive mode exists.

---

# Part G: NetworkBase as a codebase for AI (change sets)

**Asked (2026-11-11):** a person building a website keeps all its files in NetworkBase and asks an agent, "redesign the entire authentication page". The agent must work the way an agent works on a local project:
- read the whole codebase quickly
- search across files
- edit 10, 20 or 50 files
- run the site to check it, and fix what broke
- finish with all the changes saved together, correctly

To the person it feels like working on a normal project on their computer, with NetworkBase holding the files, keeping every version, and showing the work in the app. This is the most important part of the next round.

**Why today isn't enough:**
- **The agent works file by file.** Each push becomes its own version, so a 30-file redesign is 30 separate saves, with no single "this is the redesign" to review or undo.
- **Teammates see half-finished work mid-way.**
- **No project-wide view:** the agent has no easy way to search or run the whole project as one thing.
- **Upload limits break atomicity:** one upload call takes at most **50 files and 4 MB** (`MAX_FAST_PUSH_FILES`, `MAX_FAST_PUSH_BATCH_BYTES` in `src/lib/api/v1-schemas.ts`). A larger change needs several calls, so today it isn't all-or-nothing.

**Facts it builds on (checked in the code, 2026-11-11):**
- **Batches:** more than 20 files is already a "batch" that needs the person's yes (`BATCH_LIMIT`, `src/lib/agents/policy.ts`).
- **Manifest:** pages 5,000 files at a time.
- **Storage:** a workspace holds up to 10 GB (`WORKSPACE_STORAGE_LIMIT_BYTES`).
- **Ignore rules:** sync skips `.gitignore` and `.nbignore` entries, `node_modules`, `.git` and editor temp files (`packages/nb-cli/lib/sync/ignore.mjs`).
- **`nb watch`** waits 500 ms, then 2 seconds of quiet, after a save.
- **File versions only grow,** with "based on". The active version is moved by `activateFileVersion` (`src/lib/files/activate-file-version.ts`, live since 2026-11-11).
- **Uploaded content is already tracked** in `storage_assets` (bucket, storage key, verified state, content hash).
- **`undo_operations`** stores a JSON "inverse" per operation (`UndoInverse` in `src/lib/agents/policy.ts`).
- **`pg_trgm`** is already installed (used since migrations 0002, 0008, 0009).
- **Node:** the CLI requires Node 20+, which supports recursive `fs.watch` on macOS, Windows and Linux.
- **Hosted MCP** already imports the CLI's modules on the server (`src/app/api/mcp/route.ts`), so shared pure-JavaScript code can run in both places.

**With branches (Part H):**
- **A change set becomes a save waiting to happen** on a branch.
- **Part G's review (G12)** becomes the merge request's Files changed tab.
- **Part G's apply (G10)** is the engine for merging into main.
- **Change sets target a branch** (`branch` on route 1; main when absent).
- **Everything below stays valid;** Part H adds branches on top and is built after Part G's core (R2).

## G1. The promise and its rules

**The promise:** an agent can do a full multi-file coding job in NetworkBase as fast as on a local project. The work is grouped into one reviewable unit, applied all at once or not at all, and undone with one click. Nobody loses work, even with teammates editing at the same time.

**Rules the design never breaks:**
1. **Local speed.** The agent edits real files with its own tools, and NetworkBase never sits in the middle of an edit.
2. **All or nothing.** A change set applies completely or not at all.
3. **Reviewable.** Every file and every line can be seen before big work lands.
4. **Reversible.** One Undo reverses the whole change set.
5. **Conflict-safe.** A teammate's change is never overwritten silently.
6. **Never lose work.** Edits exist locally *and* on the server as soon as they're uploaded.
7. **The same everywhere.** Local agents, cloud agents, the CLI and the app all use the same change sets.

## G2. Words used in this part

| Word | Meaning |
|---|---|
| **Workspace files** | The files everyone sees: each file's active version (Files tab, `nb pull`) |
| **Change set** | One named piece of work: a list of file operations waiting to be applied, or already applied |
| **Item** | One operation in a change set: add, change, delete or rename one path |
| **Base** | For each item, the version of the file the work started from |
| **Content** | The bytes of a file version, identified by its SHA-256 hash and stored once |
| **Draft view** | Workspace files with the open change set's items laid on top (what the agent sees) |
| **Capture** | The CLI noticing saved files and adding them to the open change set |
| **Apply** | Turning all items into real file versions in one database transaction |
| **Undo** | Putting every file back to its version from before the apply, in one step |

## G3. Architecture overview

```
 Local agent (Claude Code, Codex…)            Cloud agent (hosted MCP)          Person in the app
   │ edits files with its own tools              │ fs_* tools                      │ Changes view
   ▼                                              ▼                                 ▼
 Linked folder ──► nb mcp / nb change ──► /api/v1/change-sets/* ◄── /api/v1/workspaces/:id/fs/*
   capture: watch, ignore, hash, rename       (routes: auth, scope, token route list,
   upload queue, journal (.networkbase/)        rate limit, idempotency, CSRF for cookies)
                                                   │
                                                   ▼
                                    src/lib/domain/change-sets.ts (all rules live here)
                                     │ start, upsert items, finish, prepare, apply, undo, discard
                                     │ merge3 (shared module), policy (agentGate), secret scan
                    ┌────────────────┼─────────────────────────┬──────────────────────────┐
                    ▼                ▼                         ▼                          ▼
             change_sets      change_set_items         storage_assets + bucket     file_versions / workspace_nodes
             (Postgres)       (Postgres)               "project-files" (content)   (applied versions, append-only)
                    │
                    └── after commit: realtime broadcast · notifications · activity · text index job · GitHub push job
```

- **One domain module** (`src/lib/domain/change-sets.ts`) holds every rule. The `/api/v1` routes, the app's server actions and the hosted MCP tools all call it, never the tables directly. This is the same pattern as the other domain functions from CLI 2.0.
- **One merge module:** `packages/nb-cli/lib/sync/merge3.mjs`, pure JavaScript, used by the CLI ("update the draft" locally) and the server (apply and update). It builds on the existing line diff in `lib/sync/diff.mjs`.

## G4. Data model (migration in G24)

**`change_sets`**

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `workspace_id` | uuid NOT NULL → `workspaces(id)` ON DELETE CASCADE | |
| `task_id` | uuid NULL → `tasks(id)` ON DELETE SET NULL | the task it's for |
| `author_id` | uuid NOT NULL → `profiles(id)` | the person (also when an agent made it) |
| `via` | text NULL CHECK in (`cli`,`agent`) | as in other tables (0073) |
| `agent_name` | text NULL | |
| `agent_session_id` | uuid NULL → `extension_device_sessions(id)` ON DELETE SET NULL | which sign-in |
| `title` | text NOT NULL, 1–120 chars | |
| `message` | text NULL, ≤ 2,000 chars | |
| `status` | text NOT NULL CHECK in (`open`,`ready`,`applying`,`applied`,`discarded`,`undone`) | G5 |
| `files_added`, `files_changed`, `files_deleted`, `files_renamed` | int NOT NULL DEFAULT 0 | kept up to date on every item change |
| `lines_added`, `lines_removed` | int NOT NULL DEFAULT 0 | text files only |
| `bytes` | bigint NOT NULL DEFAULT 0 | total new content |
| `apply_result` | jsonb NULL | stored on apply; returned again if apply is repeated |
| `undo_operation_id` | uuid NULL → `undo_operations(id)` | |
| `created_at`, `updated_at`, `ready_at`, `applied_at`, `discarded_at`, `undone_at` | timestamptz | |
| `applied_by` | uuid NULL → `profiles(id)` | the person who applied it |

- **Indexes:**
  - `(workspace_id, status, updated_at DESC)`
  - `(author_id, status)` WHERE status IN (`open`,`ready`)
  - `(task_id)` WHERE `task_id` IS NOT NULL

**`change_set_items`**

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `change_set_id` | uuid NOT NULL → `change_sets(id)` ON DELETE CASCADE | |
| `op` | text NOT NULL CHECK in (`add`,`change`,`delete`,`rename`) | `rename` may also change content |
| `path` | text NOT NULL | normalised, starts with `/`, ≤ 1,024 chars; the new path for renames |
| `from_path` | text NULL | renames only |
| `base_node_id` | uuid NULL → `workspace_nodes(id)` ON DELETE SET NULL | null for `add` |
| `base_version` | int NULL | null for `add` |
| `base_hash` | text NULL | content hash of the base, for merging |
| `content_hash` | text NULL | null for `delete` (and for a rename with no content change) |
| `asset_id` | uuid NULL → `storage_assets(id)` | the verified content |
| `size` | bigint NULL | |
| `mime_type` | text NULL | |
| `state` | text NOT NULL DEFAULT `pending` CHECK in (`pending`,`ready`,`merged`,`conflict`,`applied`) | G9 |
| `merged_asset_id` | uuid NULL → `storage_assets(id)` | the automatic merge result, when there is one |
| `conflict` | jsonb NULL | kind, the other version, who changed it and when |
| `lines_added`, `lines_removed` | int NULL | |
| `updated_at` | timestamptz NOT NULL | |

- **Unique** `(change_set_id, path)`: one item per path.
- **Index** `(change_set_id, state)`.

**`file_versions.change_set_id`:** uuid NULL → `change_sets(id)` ON DELETE SET NULL, with an index. Versions made by a change set point back to it, so the version panel can say "part of 'Redesign sign-in'".

**`undo_operations`:** no new columns. A new inverse kind, `changeset.undo`, is added to `UndoInverse` (G11).

**Security (same pattern as migration 0080):**
- RLS on for both tables.
- Browser roles (`anon`, `authenticated`) revoked.
- `nb_app` and `service_role` granted.
- All access goes through the domain module.

## G5. State machine

```
            items change                       finish
  ┌──────► open ─────────────────────────────────────────► ready ──┐
  │          ▲  │ discard                                    │      │ apply (G10)
  │          │  ▼                                            │      ▼
  │          │ discarded ◄──────────── discard ──────────────┘   applying ──► applied ──► undone
  │          └─────────────── a new item arrives on a ready set     │ fails: back to ready      (undo, G11)
```

| From | To | Who | Notes |
|---|---|---|---|
| — | `open` | anyone with write access (people, or agents with `file:write`) | `change_start`, `nb change start`, or the first captured save |
| `open` | `ready` | the author (or their agent) | finish: final rescan, all content uploaded, summary computed, secret scan run |
| `ready` | `open` | automatic | a new item arrives (the agent kept working) |
| `ready` | `applying` → `applied` | the author; for big change sets, only after the person's yes; workspace owners and admins may also apply | G10 |
| `applying` | `ready` | automatic | the apply transaction failed; nothing was written |
| `open`/`ready` | `discarded` | the author, workspace owners and admins | the content is kept 7 days, then cleaned up (G19) |
| `applied` | `undone` | the author, workspace owners and admins | G11 |

**Item states:**
- **`pending`:** content not uploaded yet.
- **`ready`:** content verified.
- **`merged`:** someone changed the file since the base, and the automatic merge succeeded.
- **`conflict`:** someone changed the file since the base, and it needs a choice.
- **`applied`.**

## G6. Content: upload once, store once

- **Content is identified by its SHA-256 hash.** The server re-checks the hash after upload, as `storage_assets` verification does today.
- **Storage:** bucket `project-files`, key `<workspace_id>/.changes/<sha256>`. These keys are never workspace nodes, so they don't show in the Files tab.
- **One `storage_assets` row per content,** with purpose `change_set_content`.
- **Deduplication:**
  - Content already stored for this workspace (in `storage_assets` or as an existing file version) is never uploaded again.
  - The items call returns `missingContent`, the hashes the server doesn't have yet.
- **Upload paths:**
  - **Up to 4 MB per call:** inline JSON (base64), several files per call.
  - **Larger files, up to 25 MB:** a signed upload URL, reusing the upload-intent flow; resumable.
- **Storage accounting:** content of open and ready change sets counts toward the workspace's storage. Drafts are capped at 1 GB per person per workspace, so drafts can't be used to get round the limit.
- **On apply,** the item's asset becomes the file version's asset. Nothing is copied.

## G7. API contract

All routes are under `/api/v1`. Each one:
- takes a token or a browser session (with CSRF for browsers)
- goes through the token route list (`TOKEN_ROUTES`) with the scope shown
- runs the workspace access check, plus the pause and organization checks from Part A (A5)
- is rate-limited per token
- makes writes idempotent with `Idempotency-Key`

| # | Method and path | Scope | Body → answer | Errors |
|---|---|---|---|---|
| 1 | `POST /workspaces/:id/change-sets` | `file:write` | `{ title, taskId?, message? }` → `201 { changeSet }` | `CHANGE_SET_LIMIT` (too many open) |
| 2 | `GET /workspaces/:id/change-sets?status=&mine=1&cursor=` | `file:read` | → `{ changeSets[], nextCursor }` | |
| 3 | `GET /change-sets/:cs` | `file:read` | → `{ changeSet, items[] (≤ 500 per page), nextCursor }` | `NOT_FOUND` |
| 4 | `PUT /change-sets/:cs/items` | `file:write` | `{ items: [{ op, path, fromPath?, baseVersion?, baseHash?, contentHash?, size?, mimeType? }] }` (≤ 200) → `{ items[], missingContent[] }` | `CHANGE_SET_CLOSED`, `CHANGE_SET_TOO_LARGE`, `FILE_TOO_LARGE`, `BAD_PATH` |
| 5 | `DELETE /change-sets/:cs/items?path=` | `file:write` | → `{ ok }` (drops one item: "revert this file") | |
| 6 | `POST /change-sets/:cs/content` | `file:write` | inline `{ files: [{ hash, base64 }] }` (≤ 4 MB), or `{ hash, size, mimeType }` → signed upload URL | `HASH_MISMATCH`, `STORAGE_LIMIT` |
| 7 | `POST /change-sets/:cs/finish` | `file:write` | `{ message? }` → `{ summary, decision: "apply_now" \| "needs_confirmation", confirmToken? }` | `CONTENT_MISSING`, `SECRET_DETECTED` |
| 8 | `GET /change-sets/:cs/diff?path=` | `file:read` | → `{ kind: "text" \| "image" \| "binary", hunks? }` (text ≤ 1 MB) | |
| 9 | `POST /change-sets/:cs/apply` | `file:write` (+ `file:final` / `doc:write` when needed) | `{ confirmToken?, only?: [paths] }` → `{ applied: [{ path, nodeId, version }], undoToken }` | `NEEDS_CONFIRMATION` (428), `CHANGE_SET_CONFLICT` (409), `AGENTS_PAUSED`, `HAND_IN_LOCKED` |
| 10 | `POST /change-sets/:cs/update` | `file:write` | → `{ merged[], conflicts[] }` ("update the draft") | |
| 11 | `POST /change-sets/:cs/resolve` | `file:write` | `{ path, choice: "mine" \| "theirs" \| "content", contentHash? }` → `{ item }` | |
| 12 | `POST /change-sets/:cs/discard` | `file:write` | → `{ ok }` | |
| 13 | `POST /change-sets/:cs/undo` | `file:write` | `{ partial?: boolean }` → `{ undone[], blocked[] }` | `UNDO_BLOCKED` (409) |
| 14 | `GET /workspaces/:id/fs/list?glob=&changeSet=` | `file:read` | → `{ files: [{ path, size, version, inDraft }] }` | |
| 15 | `POST /workspaces/:id/fs/read` | `file:read` | `{ paths (≤ 50), changeSet? }` → `{ files: [{ path, content \| base64, version }] }` | `FILE_TOO_LARGE` (> 1 MB per file inline) |
| 16 | `GET /workspaces/:id/fs/search?q=&glob=&regex=0\|1&changeSet=` | `file:read` | → `{ matches: [{ path, line, text }] }` (≤ 200) | |
| 17 | `POST /change-sets/:cs/fs/edit` | `file:write` | `{ path, edits: [{ old, new }] }` → `{ item }` | `EDIT_NOT_FOUND`, `EDIT_NOT_UNIQUE` |
| 18 | `POST /change-sets/:cs/fs/write` · `/fs/delete` · `/fs/move` | `file:write` | whole-file write, delete, rename → `{ item }` | |

**Rate limits per token:**

| Routes | Limit |
|---|---|
| Items | 120 a minute |
| Content | 60 a minute |
| `fs/read` and `fs/search` | 120 a minute |
| Apply and undo | 10 a minute |

All answer with `429` and `Retry-After`.

**JSON schema names** for the CLI's `--json` output:
- `nb.change.start/1`
- `nb.change.status/1`
- `nb.change.view/1`
- `nb.change.finish/1`
- `nb.change.apply/1`
- `nb.change.undo/1`
- `nb.change.list/1`

## G8. Local capture (the CLI side)

**Where it runs:**
- Inside the `nb mcp` process while an agent's session is open. That process is already running, so there's no background service and the CLI 2.0 report's decision D2, no background process, stands.
- For people without an agent: `nb watch --change` captures into the open change set (`nb change start` opens one).

**Auto-open:** the first file save in an MCP session with no open change set opens one automatically, titled from the session's current task ("Work on #4: Login bug"), or "Changes by Claude Code" when there's no task.

**The pipeline, for each event:**
1. **Watch:** `fs.watch(root, { recursive: true })`. Where recursive watching isn't supported (some network drives), it falls back to a poll every 2 seconds using the existing hash cache.
2. **Ignore:** the same rules as sync.
3. **Settle:** wait for the file to settle (500 ms, then 2 seconds of quiet), exactly as `nb watch` does.
4. **Hash:** streamed SHA-256, compared with the base hash from `.networkbase` state and with the last captured hash.
5. **Classify** the change:
   - **add:** not in the base
   - **change:** hash differs from the base
   - **delete:** gone
   - **rename:** a delete and an add with the same hash within 10 seconds
   - **back to the base content:** the item is dropped
6. **Queue** an item upsert (call 4) and upload only what's missing (call 6). The queue runs 8 at a time (4 on Windows) and retries with the existing retry rules.
7. **Journal** each item and its upload state to `.networkbase/changes/<id>.json`, written atomically, so a crash resumes where it stopped.

**Storm guard:** more than 300 events in 2 seconds (a `git checkout`, or an install that writes outside ignored folders) pauses capture. A full rescan (`planSync` against the base) then runs as one batch, instead of 300 separate events.

**Finish:** a final full rescan catches anything the watcher missed. Then the CLI waits for uploads, and calls finish (7).

**Local "update the draft":** pulls the workspace's newer versions, merges them into local files with `merge3` (G9) and records new bases. Files that can't merge get the existing conflict copies and `nb resolve`.

**Status:** `nb change status` shows the open change set, counts by kind, upload progress, and anything conflicted.

## G9. Merging and conflicts

**When it runs:**
- **At apply, in a "prepare" step,** for every item whose file changed since its base.
- **On "update the draft"** (call 10, or `nb change update`).

**The merge (`merge3`):**
- Line-based three-way merge of **base**, **theirs** (the workspace's current version) and **mine** (the item).
- **What counts as text:**
  - no zero byte in the first 8 KB
  - valid UTF-8
  - each of the three sides at most 1 MB
- **Line endings:** follow "theirs" (CRLF or LF), and a final newline is kept as it was.
- **Clean merge** (no overlapping changes): the merged content is stored as new content (G6). The item becomes `merged`, and the review shows "merged automatically" with a diff against both sides.
- **Overlapping changes, binaries and over-size files:** the item becomes `conflict`, with `conflict.kind = "edit"`.

**Other conflicts:**

| Situation | `conflict.kind` | Choices |
|---|---|---|
| The file was deleted since the base | `deleted` | recreate it, or drop the item |
| The file was moved or renamed since the base | `moved` | apply the edit at the new path, or drop it |
| An `add` whose path now exists | `exists` | make it a change of that file (merge), keep both (`name (2).ext`), or drop it |
| A folder in the path was deleted | `folder_gone` | recreate the folder, or drop |

**Resolving:**
- Through call 11 (`mine`, `theirs`, or `content`: a new upload with the edited result).
- In the app's merge editor.
- With `nb change resolve <path>`.
- The agent through `change_resolve`.

Apply stays blocked while any item is in `conflict`.

## G10. Apply: one transaction

**Step 1, prepare (outside the transaction, because storage writes can't be inside it):**
1. Check status, permissions, policy and limits (G13), and that all content is verified.
2. For each item, read the workspace's current version. Where it differs from the base, run `merge3`, store any merged content, and set the item state.
3. Record the version each item expects to replace.

If anything is in `conflict`, return `409 CHANGE_SET_CONFLICT` with the list.

**Step 2, apply (one database transaction):**
1. `SELECT … FOR UPDATE` the change set row. If it's `applied`, return the stored `apply_result` (repeating an apply is harmless). If it isn't `ready`, refuse. Set it to `applying`.
2. Lock every target node with `SELECT … FOR UPDATE`, **in node-id order**, so two applies can never deadlock.
3. **Re-check:** every node's current version must still equal the expected version from prepare. If a teammate saved in between, roll back and run prepare once more. A second change returns 409 with the new conflicts.
4. **Write each item:**
   - **add:** create missing folders, create the node, insert version 1.
   - **change:** insert a new file version (`based_on_version` = the base, `change_set_id`), and point the node at it.
   - **delete:** move the node to Trash (the existing 30-day Trash).
   - **rename:** update the path and name; insert a version if the content changed too.
   - Task attachments and roles stay, because they follow the node id.
5. Insert one `undo_operations` row (kind `changeset.undo`, G11), one node event per file (type `change_set_applied`, with the change set id), and the activity entry with Part B labels.
6. Set the change set to `applied`, with `applied_at`, `applied_by` and `apply_result`.

**Step 3, after commit:**
- realtime broadcast to the workspace and task (open tabs refresh)
- notifications: the task's assignee and watchers, plus the session summary
- doc revalidation when a linked doc changed
- the text index job (G14)
- the GitHub push job when the workspace syncs with GitHub (G18)

**Size:** up to 2,000 items fit in one transaction (a few thousand row writes). The transaction has a 30-second statement timeout. Apply is measured in G22.

## G11. Undo

**The inverse** stored at apply, per item:

| Item | Undo does |
|---|---|
| **change** | make the version that was active before the apply active again (`activateFileVersion`, in one transaction for all files) |
| **add** | move the new node to Trash |
| **delete** | restore the node from Trash |
| **rename** | move it back (and make the previous version active, if the content changed) |

**When it's allowed:**
- Every file must still be at the version this change set gave it. Otherwise the undo is refused with `UNDO_BLOCKED` and the list of files that changed since.
- `partial: true` undoes the other files and leaves those.

**Time limit:**
- **In the app and with `nb change undo`:** none, as long as the files haven't changed since.
- **Agents' undo tokens:** 24 hours, as for all agent undos (`UNDO_TTL_MS`).

**After undo:** the change set becomes `undone`. Undone change sets can't be applied again; the agent or person starts a new one, by copying it with `nb change copy <id>` or **Copy as new draft** in the app.

## G12. Review in the app: the Changes view

**Where:**
- A **Changes** list in the Files tab (open, ready, applied, discarded, undone), linked from the workspace header when something is ready.
- On the task each change set belongs to.
- The address `?tab=files&changes=<id>` opens one directly.

**One change set's page:**
- its title, message, task, who made it (with Part B labels) and when, its size, and its base time ("based on files as of 10:42")
- **the file list:** grouped added, changed, deleted, renamed, conflicted; +/− counts; a filter box; virtualised for 2,000 files
- **diffs:**
  - text: side by side (today's Compare view), up to 1 MB and 5,000 lines; past that, "Too large to show" with download
  - images: before and after
  - other binaries: size before and after
- **merged files** show "merged automatically" and can be opened as three columns: base, theirs, result
- **line comments,** like file comments today
- **a status line,** for example "Ready · 2 files changed since by Sam (merged automatically)"

**Actions:**
- **Apply:** one click. "Verify it's you" is asked only when the files include finals or docs.
- **Discard.**
- **Apply only some files:** the chosen files become their own change set and apply; the rest stay a draft.
- **Ask for changes:** a comment back to the agent, which it reads next session as an agent note (D16).
- **Resolve conflicts:** opens the merge editor per file.
- **Undo** (applied change sets).
- **Copy as new draft** (undone or discarded ones).

**Who sees what:**
- **Open and ready change sets:** the author, workspace owners and admins, and members with write access.
- **Applied ones:** everyone who can read the workspace's files, as part of the history.
- **Files inside task-private folders** follow the existing task access rules (`canReadWorkspaceTab`).

**Phone:** a single column, with the file list first and the diff opening full screen. Both themes; keyboard navigation (`j`/`k` between files).

## G13. Permissions, policy and limits

**Who may do what:**

| Action | Person (write access) | Agent: Full help | Agent: Small changes | Agent: Read only |
|---|---|---|---|---|
| Start, add items, finish | ✓ | ✓ | ✓ | ✗ |
| Apply a small change set | ✓ | ✓ (with Undo) | ✓ (with Undo) | ✗ |
| Apply a big change set | ✓ | only after the person's yes | only after the person's yes; finals and docs need the extra scope (A5 "asking for more") | ✗ |
| Discard or undo their own | ✓ | ✓ | ✓ | ✗ |
| Apply, discard or undo someone else's | owners and admins | ✗ | ✗ | ✗ |

**Small and big:**
- **Small** means up to 20 files, with no deletes, no final files and no docs.
- **Big** means everything else. The workspace's agent policy can make every change set "big" ("ask for everything").

**Checks:**
- **Policy:** `agentGate` decides with a new change kind, `changeset`. One confirmation token covers the whole change set. It's bound to the change set id and the hash of its item list, so any later edit needs a new yes.
- **Secret scan:** runs on every text item at finish. A finding holds the change set (`SECRET_DETECTED`) until the file is fixed. People can confirm (as today); agents can't.
- **Organizations:**
  - Hand-in locks and the assignment's AI policy are checked per item; locked files are refused with `HAND_IN_LOCKED`.
  - On "Not allowed" assignments, agent change sets are refused completely (`AGENT_NOT_ALLOWED`).
- **Pause:** "Pause agents" stops agents' change sets from being applied, and from receiving new items.

**Limits:**

| What | Limit |
|---|---|
| Items per change set | 2,000 |
| Content per change set | 500 MB |
| Per file | 25 MB |
| Open change sets per agent sign-in per workspace | 3 |
| Open change sets per person per workspace | 10 |
| Draft content per person per workspace | 1 GB |
| Applied change sets per agent per day | 50, alongside the daily write limit |

**Record:** start, finish, apply, discard and undo each go into activity and agent activity (Part B labels), and apply and undo into the security log.

## G14. Cloud agents: `fs_*` tools and the text index

**The draft view:** for an open change set, the agent sees each item's content where there is one, and the workspace file otherwise. Deleted items are hidden; renamed items show at their new path.

**Tools, mapping to routes 14–18:**

| Tool | Does |
|---|---|
| `fs_list` | list files by folder or glob |
| `fs_read` | read up to 50 files at once (each ≤ 1 MB inline) |
| `fs_search` | search text across the workspace, with line numbers (≤ 200 matches) |
| `fs_edit` | exact "replace this with that" edits, several per call. Each `old` text must appear exactly once (`EDIT_NOT_UNIQUE` otherwise, with the count), the same rule local agents use |
| `fs_write`, `fs_delete`, `fs_move` | whole-file write, delete, rename |

**The text index** (part of the G24 migration):
- **Table `file_text_index`:** `content_hash` PK, `content` text, `bytes`, `indexed_at`. It's **keyed by content, not by file**, so every file, version, change set and branch with that content shares one entry (Part H searches any branch with it).
- **Table `file_text_index_paths`:** `workspace_id`, `node_id`, `path`, `content_hash`. It maps main's current files to their content, and is updated when versions change.
- **Index:** GIN `gin_trgm_ops` on `content`.
- **What's indexed:** text files up to 1 MB, filled after every version write by a background job, with a one-time backfill job for existing files.
- **Kept in step:** deleted files drop out of the path map, "Use this version" updates it, and content no longer referenced anywhere is removed by the cleanup job.
- **Search:**
  - narrows with the trigram index
  - then finds exact lines in the application
  - draft items are searched directly
  - an optional regular expression, with a time limit
- **Access:** follows workspace file access, so task-private files are excluded for people who can't read them.

**What a cloud agent can't do:** run the site, because there's no machine. It says so, and suggests the person check the result locally (`nb pull`) or with the preview.

## G15. Many people and agents at once

- **Several change sets can be open on the same files.** The one applied second merges or reports conflicts (G9).
- **Presence:**
  - "Claude Code is changing 23 files for #4" shows on the task and on each affected file (from the open change set's items).
  - "Codex also has a draft on 4 of these files" shows when two open change sets share paths.
- **Locks:** optional per file (C3) for things that can't merge, such as design files. A locked file is refused at capture (`FILE_LOCKED`, saying who holds it).
- **The person editing in the app during an agent's session:** the person's save goes to the workspace files. The agent's draft shows "2 files changed since your base", and merges on finish or on "update the draft".

## G16. Large real projects

- **Thousands of files:**
  - paged lists (5,000 per page)
  - parallel downloads, and the local hash cache, so unchanged files are never re-read
  - partial sync (C3) for very large workspaces
- **Never synced:** `node_modules`, build output, `.git`, plus `.gitignore` and `.nbignore` rules.
- **Limits are stated up front** (G13). A bigger change is refused with "split it into smaller change sets", and the CLI offers to split by folder.
- **Text details preserved:** line endings, encoding and the executable bit (stored as item metadata). Symlinks are skipped with a note, as today.

## G17. Compatibility

- **`nb push` and `files/place` stay as they are** (already all or nothing up to 50 files and 4 MB). The CLI moves a push to a change set only when it's bigger than one call allows. Small pushes don't change.
- **CLI 2.0.x and the VS Code extension keep working:** applied change sets are ordinary file versions.
- **Versions, the version panel and "Use this version"** work on change-set versions like any other. The panel shows "part of 'Redesign sign-in'".
- **Undo of a push or drop** (2026-11-11) is unchanged.

## G18. Git, for people who also use it

- **A git folder works as usual:** git and NetworkBase work side by side, and capture follows the folder's files.
- **`nb change finish --from-git main..HEAD`** turns commits into one change set, using their messages as its message (the first line as the title).
- **Workspaces synced with GitHub** (the app's repository sync): an applied change set can push one commit to GitHub with the `NetworkBase-Task` line. This is a background job after apply. If it fails, nothing is rolled back; the person sees "Not pushed to GitHub yet", with Retry.

## G19. Observability and operations

- **Logs:** carry `changeSetId`, `workspaceId`, `via`, `agent` and `client` (alongside the existing request fields).
- **Sentry:** spans for prepare, apply, merge and undo.
- **Measured:**
  - change set size
  - time from finish to apply
  - apply duration
  - automatic merge and conflict rates
  - undo rate
  - capture lag (save to uploaded)
  - fs search time
- **Cleanup jobs (daily):**
  - change sets open with no activity for 30 days get a reminder at day 23, and are discarded at day 30
  - content of discarded and undone change sets is deleted after 7 days if nothing else references it (`scheduleAssetDeletionIfUnreferenced`)
- **Inngest:** the text index and the GitHub push run as background functions. Their counts are checked against the free plan's limit before rollout.

## G20. Failures: never lose work

| Failure | Result |
|---|---|
| Network drops during upload | Resumes from the journal, sending only missing content |
| Laptop crashes mid-session | The draft is on the server up to the last quiet save; the local folder still has everything; the journal resumes |
| Apply is sent twice | The second returns the stored result |
| Server error or timeout mid-apply | One transaction: nothing written; status back to `ready`; retrying is safe |
| A teammate saves during apply | Re-check fails; prepare runs again; conflicts are reported if needed |
| Session ends without finishing | The change set stays open; the next session or `nb change status` picks it up; the 30-day cleanup applies |
| Sign-in expires mid-work | Edits stay local, capture pauses, and after `nb login` it continues from the journal |
| Workspace paused mid-session | Capture keeps the journal locally; the server refuses new items until resumed |
| Storage limit reached | `STORAGE_LIMIT` on content upload; capture pauses and says how much space is needed |

## G21. Edge cases covered

- **Rename and edit in one change.**
- **Delete then recreate with the same name:** becomes a `change`.
- **A case-only rename** (`Login.tsx` → `login.tsx`): handled as a rename, including on case-insensitive disks.
- **Empty files; binary and image files.**
- **Files attached to tasks:** a renamed attachment keeps its task link and role.
- **README and linked docs:** the doc-edit yes applies, and a starter README gets its file (the 2026-11-11 fix).
- **Final files:** the final-file yes applies.
- **A file in Trash** that the change set edits: a `deleted` conflict with "recreate".
- **A folder deleted by a teammate** while the draft adds files into it: `folder_gone`.
- **Two change sets applied in either order:** the result is the same as applying them one after the other with merges.
- **Paths:** Unicode paths are normalised to NFC, and Windows-reserved names are refused (`BAD_PATH`).

## G22. Tests

- **Unit:**
  - `merge3`: property tests (merging with no changes on one side gives the other side; overlapping edits always conflict)
  - line endings
  - text detection
  - capture classification (add, change, delete, rename, storm)
- **Database:**
  - every route in G7
  - every state transition in G5, including refused ones
  - apply all-or-nothing (a forced failure mid-apply writes nothing)
  - lock order (two concurrent applies on overlapping files: no deadlock, one merges)
  - undo, including blocked and partial
  - permissions (G13 table)
  - limits
  - the secret scan
  - organization locks
  - search access rules
- **CLI:**
  - capture against the fake server: saves, renames, a storm, a crash then resume
  - `nb change` commands and their `--json` schemas
  - "update the draft" with merges and conflicts
- **End to end:** an agent redesigns a sign-in page across 30 files in a seeded Next.js project. It runs the site, finishes, gets reviewed, applies, and is undone. Done in CI against a seeded server, and once live.
- **Speed targets:**
  - finishing a 50-file change set: under 10 seconds
  - applying it: under 2 seconds
  - a 2,000-file apply: under 30 seconds
  - capture lag: under 3 seconds after the quiet window
- **Failure tests:** every row of G20, played on purpose in CI.
- **Agent test (D22):** gains coding jobs: multi-file refactors, renames, conflicts mid-session, resuming the next day, and a cloud agent using `fs_*` only.

## G23. Rollout

- **Behind a workspace flag** (`change_sets`): on first for the user's own workspaces, then for everyone once the measures in G19 look healthy for a week.
- **Turning the flag off** hides the Changes view and refuses new change sets. Applied work stays, because it's ordinary file versions. Open drafts stay readable and can be discarded.
- **The agent instructions and tool pack** switch to change sets only where the flag is on. Elsewhere agents keep using `file_push`.

## G24. Build phases

| Phase | Builds | Migration | Release |
|---|---|---|---|
| **G-1. Core** | tables, content upload and dedupe, the domain module, routes 1–7, 9, 12, 13, apply and undo, local capture in `nb mcp`, the `nb change` commands, agent tools `change_*` | **0089**: `change_sets`, `change_set_items`, `file_versions.change_set_id`, inverse kind | site + CLI 2.2.0 (behind the flag) |
| **G-2. Review** | the Changes view, route 8, apply only some files, ask for changes | none | site |
| **G-3. Conflicts** | `merge3`, prepare, routes 10–11, the merge editor, `nb change update` and `resolve` | none | site + CLI 2.2.x |
| **G-4. Cloud agents** | routes 14–18, `fs_*` tools, the text index and its jobs | **0090**: `file_text_index` | site |
| **G-5. Git** | `--from-git`, the GitHub push job | none | site + CLI 2.2.x |

**Each phase is done when:**
- its tests in G22 pass
- its parts of G20 are played
- the speed targets hold
- it's checked live on the user's workspace

## G24b. MVP, journeys, and protected main

**MVP:** G-1 (the core) with G-2 (review). Conflicts merge automatically from G-3 onwards; until then, a conflicted file is shown and the person chooses mine or theirs.

**Journeys:**
- **Normal user ("vibe coding"):**
  1. "Redesign the sign-in page" → the agent edits 23 files and runs the site.
  2. "Done: 23 files, ready for review".
  3. The person opens the Changes view, skims the diffs, and clicks Apply.
  4. Later: "Undo" if needed.
- **Heavy user:**
  - several open change sets at once (one per task, up to 10)
  - "Update the draft" every morning
  - apply only some files to land the safe part first
  - resolve two conflicts in the merge editor
  - `nb change list` to see everything open
- **Cloud agent only:** works through `fs_*` tools on a draft; the person reviews and applies; to run the site, the person pulls it locally.

**When main is protected (Part H):** a change set aimed at a protected main becomes a branch plus a merge request automatically. The review is the merge request's Files changed tab, and Apply becomes Merge.

## G25. Decisions taken (recommended options)

1. **One domain module, and one merge module shared by the CLI and the server,** rather than two implementations.
2. **Capture inside `nb mcp`:** no background service.
3. **The first save auto-opens a change set,** so agents don't need to remember to start one.
4. **"Small" means up to 20 files** with no deletes, finals or docs. Everything else is one yes.
5. **`nb push` stays as it is** for small pushes. Only oversized pushes use change sets.
6. **Undo in the app has no time limit** while the files are unchanged. Agent undo tokens keep 24 hours.
7. **Search uses `pg_trgm`,** which is already installed. No new search service.
8. **Drafts count toward storage,** with a 1 GB cap per person per workspace.
9. **Rollout is behind a workspace flag.**

## G26. Risks and how they're handled

| Risk | Handling |
|---|---|
| Automatic merges that are technically clean but wrong | Merged files are always marked in the review and diffed against both sides; big change sets are reviewed before apply |
| File watching misses events (network drives, some Linux setups) | Polling fallback, plus a full rescan at finish |
| Very large applies slow the database | Item and size limits, node-id lock order, a 30-second timeout, measured in G22 |
| Drafts filling storage | Counted toward the limit, a 1 GB cap, 30-day cleanup |
| An agent applying something harmful | Yes rules, the secret scan, organization rules, Pause agents, and one-click undo |
| Inngest usage (free plan) | Index and GitHub jobs measured before rollout; batching per change set |

---

# Part H: branches in the Files tab (the core loop)

**Asked (2026-11-11):** branches in the Files tab that work end to end like GitHub's, adapted to NetworkBase. The Files tab should also get the rest of what makes GitHub's push, review and merge flow work well. The user chose the **first set, the core loop**:
1. Branches
2. Saves (commits) and history
3. Merge requests
4. Protecting main
5. The CLI, git and GitHub on the right branch

The next and later sets are recorded in H17 for a future round.

**What exists today (checked 2026-11-11):**
- **The Files tab** has:
  - All files, Task files, Sprint materials, From the organization, Final files
  - Repository sync, Recent, Starred, Trash (`FilesViews.tsx`)
  - per-file versions with Compare and "Use this version"
  - line comments, file locks, a preview engine, folder downloads
- **Files and folders** live in `workspace_nodes`:
  - `path`, `parent_id`, `type`, `name`
  - `task_id` for task files
  - `canonical_node_id` from the old sandbox
  - `current_version`, `s3_key`, `asset_id`
  - `git_blob_hash`, `last_synced_commit_sha`, `sync_status`

  Content history is in `file_versions` (append-only, "based on").
- **GitHub sync can push and pull any GitHub branch** (`src/lib/github/sync-service.ts`), with a separate baseline per branch (`github_sync_files.branch`). But the **workspace has only one set of files.** Pull branch `feature-x`, then `main`, and both land in the same files. That's the mixing problem. The CLI pushing from a local git folder that's on another branch does the same.
- **An older, half-built "task sandbox merge"** exists:
  - `src/lib/workspaces/merge-sandbox.ts`
  - `POST /api/v1/workspaces/:id/tasks/:taskId/merge`
  - the `workspace_git_deltas` table

  Nothing in the app or CLI calls it. Branches replace it (H16).

## H1. The idea in one picture

```
main  ──●────●─────────────●──────────●  (what the Files tab shows today, unchanged)
          \                ↑ merge
task/4-login-bug ──●──●──●─┘            (a branch: its own files, its own saves)
                         └ merge request: review → approve → merge (with "Closes #4")
```

- **Main** is today's workspace. Every existing feature keeps working on it unchanged: previews, task files, links, downloads, versions, search, the Documents tab and Discover.
- **A branch** is a separate line of work. It starts as an exact copy of main at one moment, and only its own changes are stored.
- **Saves** are commits: a message, an author, and the files changed.
- **Merge requests** bring a branch back into main (or another branch) after review.

## H2. Feature 1: branches

**Creating:**
- **From the Files tab header:** a branch picker ("main ▾") with **New branch**. You pick a name and a starting point (main, or another branch).
- **From a task:** "Start work on #4" offers **Create branch** `task/4-login-bug`, linked to the task.
- **From the CLI:** `nb branch create <name>`, or automatically when your git folder is on a branch NetworkBase doesn't have yet (asks first, H6).
- **From an agent:** agents start a branch named for the task (`agent/4-login-bug`) when main is protected, or when the change is big (H7).

**Names:** letters, numbers, `-`, `_` and `/`, up to 100 characters, unique per workspace. `main` is reserved. Names can't start or end with `/`, can't contain `//` or `..`, and are compared case-insensitively for uniqueness.

**Switching:**
- **The branch picker switches the whole Files tab:** the tree, the file views, downloads and search all show that branch.
- **The address carries the branch** (`?tab=files&branch=task/4-login-bug`), so links open the right branch.
- **A coloured "On branch task/4-login-bug" bar** shows whenever you're not on main, so nobody edits the wrong branch by mistake.

**What a branch shows:**
- Its own files: main as it was when the branch started, plus the branch's own saves.
- It doesn't change when main changes, exactly like GitHub. **Update from main** brings main's newer work in, with the same merging as Part G (G9).
- **Status in the picker and the branch list:** "3 saves ahead, 5 behind main · updated 2 h ago by Claude Code".

**The branch list** (`?tab=files&view=branches`):
- every branch with its owner, linked task, ahead and behind counts, last save, and its open merge request
- filters: mine, active, merged, stale (no saves for 30 days)

**Renaming, deleting, tidying:**
- **Rename and delete:** by the branch's creator, workspace owners and admins. Main can't be renamed or deleted.
- **After merging:** offers to delete the branch, and deletes it automatically after 7 days. Its history stays in the merge.
- **Deleted branches** can be restored for 30 days, like Trash.

**What branches cover, and what stays main-only:**

| Covered by branches | Stays on main only (with the reason) |
|---|---|
| Everything in **All files**: folders, code, documents, images | **Task working files and final files** (`/.system/tasks/…`, nodes with `task_id`): they're task records, not project code, and reviews and hand-ins depend on them |
| README and linked doc files (seen on the branch in Files) | **The Documents tab** shows main; the branch's version shows in the merge request |
| | **Organization assignment copies:** branches are off there, so hand-in locks and teacher reviews stay simple. Organizations' own team workspaces have branches |

## H3. Feature 2: saves (commits) and history

**What a save is:**
- One unit of change on a branch: files added, changed, deleted and renamed, plus a message, the author ("Ram · with Claude Code", Part B), the time, and optionally a task.
- **It's the Part G change set, applied to a branch.** On main it also updates the files everyone sees, as Part G designs (G10).

**How saves happen** (every path makes a save; nothing changes files without one):

| Where | What becomes a save |
|---|---|
| App editor | each "Save version" (with its optional message) |
| Upload or drop in the Files tab | one save per drop ("Uploaded 12 files") |
| Rename, move, delete in the Files tab | one save each |
| CLI `nb push`, `nb change finish` | one save per push or change set |
| Agents | one save per finished change set |
| GitHub sync pull | one save per synced GitHub commit range |
| "Use this version" on a file | one save ("Use v1 of login.tsx") |
| Restore from Trash | one save ("Restored report.pdf") |

**History screens:**
- **Workspace history** (`?tab=files&view=history&branch=…`): a timeline of saves, with message, author, files, +/− lines and the task. Filter by person, agent, folder or file.
- **One save's page** (`?tab=files&save=<id>`): its file list and diffs, plus **Browse files at this save** (read-only), **Download as zip**, and **Revert**.
- **The file version panel** gains a "Save" link on each version, so you can jump to the whole change it was part of.

**Reverting:**
- **Revert** makes a new save that undoes that save's changes, on the current branch, merging if the files changed since.
- On a protected main, revert goes through a merge request like any change (H5).

**History before branches:** when branches are turned on for a workspace, one starting save, "Start of history", records main exactly as it is (and a full checkpoint, H11). Older per-file versions stay in each file's version panel.

## H4. Feature 3: merge requests (like pull requests)

**Opening one:**
- **From the branch picker or list:** **New merge request** (from a branch, into main by default; another branch can be chosen). It's pre-filled with:
  - a title from the branch name or task
  - a description listing the saves
  - the linked task
- **From the CLI:** `nb merge-request create --into main`.
- **From an agent:** at the end of its work, "opened merge request #3 for your review".
- **Drafts:** a merge request can be marked Draft (not ready); reviewers aren't notified until it's ready.
- **One open merge request per pair** of source and target branch.

**The review page** (`?tab=files&mr=3`):
- **Header:** title and number (shown as "MR !3", H26), state (Draft, Open, Approved, Changes requested, Merged, Closed), the from and into branches, author, task, reviewers and their status, checks.
- **Tabs:**
  - **Conversation:** description, comments, events ("Sam approved", "Claude Code pushed 2 saves").
  - **Saves:** the list of saves.
  - **Files changed:** Part G's Changes view (G12), with diffs, line comments and suggested edits.
- **Suggested edits:** a reviewer writes the replacement lines in a comment, and the author (or their agent) accepts with **Apply suggestion**, which makes a new save on the branch.
- **Reviewers:**
  - chosen by the author
  - defaulting to workspace owners and admins, or the task's reviewer if the task has one
- **Review outcomes:** **Approve**, **Request changes**, or **Comment**. A new save after an approval keeps the approval but marks it "approved an earlier save"; whether that still counts follows the protection rule (H5).
- **Checks:**
  - results posted by automated builds through the F6 GitHub Action or a webhook (`POST /api/v1/merge-requests/:id/checks`)
  - each with a name, state (running, passed, failed) and a link
  - tied to the head save they ran on
- **Conflicts:**
  - Shown as "Can't merge yet: 2 files conflict".
  - **Resolve in the browser** opens Part G's merge editor. The resolution is saved on the branch.
  - **Update from main** brings main in first.

**Merging:**
- **Merge button choices:**
  - **Merge:** keeps every save and adds a merge save.
  - **Squash and merge:** one save on the target, with the merge request's title.
- **It's all or nothing** (Part G's apply transaction, G10): every file updates at once and one Undo covers it.
- **After merging:**
  - The task linked by "Closes #4" (or the merge request's task) moves to Done, or to review if the task needs review, through the normal task rules.
  - Watchers, the author and reviewers are notified.
  - The branch is offered for deletion.

**Undoing a merge:** **Revert merge** makes a new save that undoes it. Right after merging, the toast's **Undo** does the same; on a protected main it goes through a merge request.

**Closing without merging:** **Close**; it can be reopened while the branch exists.

**Notifications** (following each person's settings and quiet hours):
- review requested
- new comment
- approved
- changes requested
- checks failed
- merged
- closed

## H5. Feature 4: protecting main

**Workspace settings → Branches:**

| Rule | Choices | Default |
|---|---|---|
| Change main only through merge requests | on / off | **off** for personal workspaces; **on** for team workspaces with more than one member |
| Approvals needed | 0–5 | 1 when the rule above is on |
| New saves after approval need approval again | on / off | off |
| Checks must pass | on / off, and which checks | off |
| Who may merge into main | everyone with write access / owners and admins | everyone with write access |
| Agents | **always work on a branch and open a merge request** | **on**, and can't be turned off for team workspaces |

The same rules can protect any other branch (for example `release`); main is protected by these defaults.

**What a protected main means everywhere:**
- **In the app:** editing on main asks "Save to a new branch?", one click making `ram/edit-login-page`.
- **Uploads and drops on main** offer the same.
- **The CLI:** `nb push` on main answers "main is protected: pushed to branch ram/2026-11-11 and opened merge request #4?" (asks first).
- **The API:** writes to a protected main are refused with `BRANCH_PROTECTED`, which says how to use a branch.
- **GitHub sync pulls into a protected main** are allowed (the repository is the source of truth for that branch). They're recorded as saves "from GitHub", and the owner chooses this when connecting.

**Owners can override in an emergency:** **Merge without approval**, which asks "Verify it's you" and is recorded in the security log.

## H6. Feature 5: the CLI, git and GitHub on the right branch (fixes the mixing problem)

**The rule:** the folder is always on exactly one NetworkBase branch, and you always know which.

**Without git:**
- `nb init` links the folder to main (or `--branch <name>`).
- `nb branch switch <name>` changes it, like `git checkout`:
  - files that differ are replaced with that branch's version
  - unsaved local changes are kept and carried over, unless they conflict
  - a conflict stops the switch with a clear message ("save or discard 2 files first", or `--carry`)
- **Where you see the branch:**
  - `nb status`: "On branch task/4-login-bug · 2 saves ahead of main"
  - the shell prompt marker (C8): `[task/4 · #4 · 2 changed]`

**With git in the folder (the fix):**
- **NetworkBase follows the git branch automatically.** Each command reads git's current branch (`.git/HEAD`, no git process needed). If it changed since last time, NetworkBase switches to the branch with the same name.
- **A git branch NetworkBase doesn't have yet:** the CLI asks once, "Create NetworkBase branch feature-x from main?". With `--json` or agents it answers `NEEDS_INPUT`, never guessing.
- **`nb push` always goes to the branch the folder is on,** and never into main by accident. Pushing to a protected main follows H5.
- **Pushes from a detached git head** (no branch) are refused with `DETACHED_HEAD` and how to fix it.

**Local state per branch:** `.networkbase` keeps base versions per branch, so switching back and forth is instant and conflict detection stays correct. Part G capture (G8) records into a change set for the folder's current branch.

**Commands:**
- `nb branch list`, `create`, `switch`, `rename`, `delete`, `update` (from main)
- `nb log`: history of the current branch
- `nb show <save>`: one save
- `nb revert <save>`
- `nb merge-request create`, `list`, `view`, `review --approve|--request-changes`, `merge [--squash]`, `close`

**GitHub sync, branch to branch:**
- A connected GitHub repository maps each GitHub branch to the NetworkBase branch of the same name.
- **Pulling** GitHub `feature-x` writes saves on NetworkBase `feature-x`, never on main.
- **Pushing** NetworkBase `feature-x` updates GitHub `feature-x`.
- **Defaults:** main ↔ the repository's default branch (`github_default_branch`). Other branches sync when you turn them on per branch, or for all.
- The existing per-branch baseline (`github_sync_files.branch`) is reused.
- **Merge requests and GitHub pull requests stay separate in this first set.** Merging in NetworkBase pushes the merge result to GitHub main, and merging a pull request on GitHub arrives as a save on NetworkBase main through sync.

## H7. Agents on branches

- **The default for agents is a branch per task:** `agent/4-login-bug`, made on the first save, unless the workspace allows agents on main and the change is small.
- **Their work:**
  - change sets become saves on that branch
  - at the end, the agent opens a merge request with "What I did" as the description, and the person reviews and merges it
- **Agents can't:**
  - merge into a protected main
  - approve merge requests
  - change protection rules
- **They can:**
  - update their branch from main
  - resolve conflicts on their own branch
  - answer review comments with new saves (reading comments as agent notes, D16)
- **The approval page (Part A)** can say "works on branches and opens merge requests for your review", making Full help even safer.
- **New agent tools** (core pack once branches are on): `branch_status`, `branch_create`, `merge_request_open`, `merge_request_view`, `merge_request_update` (reply and push new saves).
  - `merge_request_merge` exists only for unprotected targets, and always needs the person's yes.

## H8. How it works across NetworkBase

| Area | Behaviour with branches |
|---|---|
| **Tasks** | A branch and merge request link to a task; the task page shows "Branch task/4 · MR #3 open · checks passed"; merging closes or moves the task |
| **Task files and final files** | Stay on main (H2). A merge request can attach its result as a final file on the task through an explicit button |
| **Organizations** | Team workspaces: branches on, main protected by default. Assignment copies: branches off in this first set. AI policy, hand-in locks and Part B labels apply on every branch |
| **Docs and README** | Files on a branch show the branch's README; the Documents tab and the workspace page show main |
| **Versions panel** | Shows main's versions; on a branch, a file's history is that branch's saves plus main's history before the branch began |
| **Trash** | Deleting on main uses Trash as today; deleting on a branch is a save (undo by revert, or restore the branch) |
| **Locks** | Per branch: locking a file on one branch doesn't block it on another |
| **Search** | Searches the branch you're on (Part G index for main, plus the branch's own files) |
| **Downloads** | Download a branch or any save as a zip |
| **Activity and Discover** | Activity shows saves and merges per branch. Discover and public pages show main only |
| **Notifications and inbox** | Merge request events (H4); branch saves notify only watchers of that branch |
| **Undo** | Every save can be reverted; a merge has one Undo right after merging |
| **Storage** | Branches store only changed content once (by hash); it counts toward the workspace's storage |
| **Permissions** | Members with read access see all branches (the public sees main only, H24); write access creates branches and saves; protection rules govern main; viewers can comment on merge requests |
| **Realtime** | Saves, merges and merge-request events broadcast on the workspace topic, so open tabs on that branch refresh |
| **Previews and thumbnails** | Work by content (asset), so a branch's files preview like main's |

## H9. Architecture: principles

- **Main stays exactly as it is:** materialised in `workspace_nodes` and `file_versions`, so every existing feature keeps working untouched. Branches are added next to it.
- **Content is stored once by hash** (Part G, G6). Branches and saves only point at it.
- **One save writer:** every change to main records a save (H12).
- **One resolver for "the files of branch X at save Y"** serves the Files tab, the CLI manifest, downloads, search and the `fs_*` tools.
- **Part G's merge and apply** are the engine for "update from main" and "merge" (H13). They're built once.

## H10. Data model (migration in R1, Part H rows)

| Table | Key columns | Notes |
|---|---|---|
| `branches` | `id`, `workspace_id`, `name`, `is_default`, `head_save_id`, `base_save_id` (where it started on its source), `source_branch_id`, `merged_from_target_save_id` (the latest target save already in this branch; the merge base), `task_id`, `created_by`, `status` (`active`, `merged`, `deleted`), `deleted_at`, timestamps | unique `(workspace_id, lower(name))` among non-deleted; exactly one `is_default` per workspace |
| `saves` | `id`, `workspace_id`, `branch_id`, `parent_save_id`, `second_parent_save_id` (merges), `kind` (`start`, `save`, `merge`, `squash`, `revert`, `sync`, `restore`), `message`, `author_id`, `via`, `agent_name`, `task_id`, `change_set_id`, counts, `created_at` | index `(branch_id, created_at DESC)` |
| `save_changes` | `save_id`, `path`, `op` (`add`, `change`, `delete`, `rename`), `from_path`, `content_hash`, `asset_id`, `size`, `mime_type`, `node_id` and `version` (main only) | index `(save_id)`, `(path)` per workspace for file history |
| `branch_files` | `branch_id`, `path`, `state` (`present`, `deleted`), `content_hash`, `asset_id`, `size`, `mime_type`, `updated_save_id` | only paths that differ from the branch's base; primary key `(branch_id, path)` |
| `tree_checkpoints`, `checkpoint_files` | `checkpoint_id`, `save_id`; files: `path`, `content_hash`, `asset_id`, `size`, `mime_type` | written at "Start of history", at each branch start, and every 100 saves on main |
| `merge_requests` | `id`, `workspace_id`, `number` (per workspace), `source_branch_id`, `target_branch_id`, `title`, `description`, `state` (`draft`, `open`, `merged`, `closed`), `author_id`, `via`, `agent_name`, `task_id`, `merge_save_id`, `merged_by`, timestamps | unique open per `(source, target)` |
| `merge_request_reviews` | `merge_request_id`, `reviewer_id`, `state` (`requested`, `approved`, `changes_requested`, `commented`), `save_id` reviewed, timestamps | |
| `merge_request_checks` | `merge_request_id`, `save_id`, `name`, `state`, `url`, `updated_at` | unique `(merge_request_id, save_id, name)` |
| `merge_request_comments` | reuse the file comment anchors with `merge_request_id` and a `save_id`, plus suggestion text | |
| `branch_protection` | `branch_id`, `require_merge_request`, `approvals`, `reapprove_on_new_saves`, `required_checks text[]`, `merge_by` (`writers`, `admins`), `agents_on_branches` | |

All tables have RLS on, browser roles revoked, and `nb_app` and `service_role` granted (pattern of 0080).

## H11. Reading a branch (the resolver)

- **The files of branch B now:** `branch_files` of B over the checkpoint at B's base. Paths marked `deleted` are hidden, and renames are a delete plus an add.
- **The files at save S:**
  1. the nearest checkpoint at or before S on that line
  2. replay the `save_changes` after it, at most 100
- **Main now:** `workspace_nodes` as today (fastest path, unchanged).
- **One function, `resolveTree({ branch, save? })`,** returns a paged list (5,000 per page, like the manifest) and single-file lookups. It's used by the Files tab, `GET …/manifest?branch=`, downloads, search and `fs_*`.
- **Caching:** the resolved list for a branch head is cached by `(branch_id, head_save_id)`, so repeated browsing doesn't rebuild it.

## H12. Writing: one save writer

- **`recordSave(tx, { branchId, kind, message, author, via, agent, taskId, changes[] })`** runs inside the existing transaction of every writer.
- **On main**, the existing writer has already updated `workspace_nodes` and `file_versions`; `recordSave` adds the save and its changes, and moves `head_save_id`.
- **On another branch,** it updates `branch_files` instead. Content arrives through Part G's upload (G6).
- **Writers that must call it** (the list a test enforces):
  - `applyFileRevision`
  - `activateFileVersion`
  - `files/place` (fast-push)
  - folder upload (`upload-import`)
  - the GitHub import and sync runners
  - the merge sandbox (removed, H16)
  - rename, move, delete and restore actions
  - the Part G apply
- **A unit test** lists every function that writes `workspace_nodes` or `file_versions` and fails if one doesn't call `recordSave`. It's the same guard idea as Part B's label test.
- **A protected main** is checked in the same place: `recordSave` refuses non-merge saves on a branch whose protection requires merge requests, unless the save is a GitHub sync allowed by H5. It throws `BRANCH_PROTECTED`.

## H13. Merging and updating (built on Part G)

- **Merge base:** `merged_from_target_save_id` on the source branch: the last target save it already contains. It's set at branch start and on every "update from main". No history search is needed.
- **Three-way merge** per path of base (the checkpoint at the merge base), source head and target head:
  - paths changed on one side only take that side
  - paths changed on both sides go through `merge3` (G9), with the same conflict kinds (`edit`, `deleted`, `moved`, `exists`, `folder_gone`)
- **Into main:** the merge result becomes a Part G change set applied with G10's transaction, all or nothing, with node-id lock order and one undo, then `recordSave(kind: merge or squash)`.
- **Into another branch:** `branch_files` of the target update in one transaction, plus a merge save.
- **Update from main:** the same merge with main as the source and the branch as the target. It moves `merged_from_target_save_id`.
- **Revert:** builds the inverse of a save's changes against the current head (merging where needed) and saves it as `kind: revert`.
- **Conflicts** are stored on the merge request (or the update) until resolved in the merge editor, in the CLI (`nb resolve`), or by the agent. Resolutions become a save on the source branch.

## H14. API contract

All routes follow Part 0.2: token routes with scopes, workspace access plus pause and organization checks, rate limits, `Idempotency-Key`, CSRF for browsers.

| Method and path | Scope | What |
|---|---|---|
| `GET /workspaces/:id/branches?status=&mine=` | `file:read` | list with ahead and behind, last save, merge request |
| `POST /workspaces/:id/branches` | `file:write` | `{ name, from?: branch \| save, taskId? }` → `201` (members only, H26) |
| `PATCH /branches/:b` | `file:write` | rename |
| `DELETE /branches/:b` · `POST /branches/:b/restore` | `file:write` | delete (30-day restore) and restore |
| `POST /branches/:b/update` | `file:write` | update from its target → `{ save? , conflicts[] }` |
| `GET /branches/:b/files?path=&cursor=` | `file:read` | the resolver (H11), also `?save=` |
| `GET /workspaces/:id/saves?branch=&path=&author=&cursor=` | `file:read` | history |
| `GET /saves/:s` · `GET /saves/:s/diff?path=` | `file:read` | one save, and a file's diff |
| `POST /saves/:s/revert` | `file:write` | → a save, or a merge request when the branch is protected |
| `GET /saves/:s/zip` · `GET /branches/:b/zip` | `file:read` | download as zip (reuses the live zip streaming) |
| `POST /workspaces/:id/merge-requests` | `file:write` | `{ source, target, title, description?, taskId?, draft? }` |
| `GET /workspaces/:id/merge-requests?state=` · `GET /merge-requests/:n` | `file:read` | list and detail |
| `PATCH /merge-requests/:n` | `file:write` | title, description, draft or ready, reviewers, close or reopen |
| `POST /merge-requests/:n/reviews` | `file:write` | `{ state: approve \| request_changes \| comment, body? }` (people only; agents refused) |
| `POST /merge-requests/:n/comments` | `file:write` | line or general comments, suggestions |
| `POST /merge-requests/:n/suggestions/:c/apply` | `file:write` | applies a suggestion as a save on the source |
| `POST /merge-requests/:n/checks` | workspace token with `file:write` | `{ save, name, state, url }` |
| `POST /merge-requests/:n/merge` | `file:write` | `{ method: merge \| squash, confirmToken? }` → save; `409 CHANGE_SET_CONFLICT`, `403 BRANCH_PROTECTED`, `409 APPROVAL_REQUIRED`, `409 CHECKS_FAILED` |
| `GET/PUT /branches/:b/protection` | owners and admins | the H5 rules |

**Every write that saves on a branch** carries `expectedHead`; a moved head answers `409 BRANCH_MOVED` (H26).

**Existing routes gain `?branch=`** where they read or write workspace files:
- `manifest`
- `files/place`
- the file content routes
- Part G's change sets (a change set targets a branch)

Without `branch`, they mean main, so old clients keep working.

## H15. Permissions, policy and limits

| Action | Read access | Write access | Owners and admins | Agents |
|---|---|---|---|---|
| See branches, saves, merge requests | ✓ | ✓ | ✓ | ✓ (read scopes) |
| Comment on merge requests | ✓ | ✓ | ✓ | ✓ (comments that mention people need a yes, D12) |
| Create branches, save on unprotected branches | | ✓ | ✓ | ✓ (small changes run; big ones as Part G) |
| Open and update merge requests | | ✓ | ✓ | ✓ |
| Approve or request changes | | ✓ | ✓ | ✗ |
| Merge into unprotected targets | | ✓ | ✓ | only after the person's yes |
| Merge into protected targets | | per the rule | ✓ | ✗ |
| Change protection, merge without approval | | | ✓ ("Verify it's you") | ✗ |
| Delete others' branches | | | ✓ | ✗ |

**Limits:**

| What | Limit |
|---|---|
| Active branches per workspace | 500 (see H25; merged branches don't count) |
| Open merge requests per workspace | 200 |
| Branches per agent sign-in per workspace | 10 |
| Size per save | Part G's limits (2,000 files, 500 MB) |

Storage of branch content counts toward the workspace's 10 GB.

**Organizations:**
- Hand-in locks and AI policy are checked per save and per merge.
- Assignment copies refuse branch creation (`BRANCHES_OFF`).

## H16. Turning it on, data, and removing the old sandbox

- **A workspace setting, "Branches":** off at first, on for the user's own workspaces, then on by default for new workspaces after rollout.
- **Turning it on:**
  1. creates the `main` branch row
  2. writes the "Start of history" save
  3. writes a full checkpoint of main
  4. from then on every writer records saves
- **Turning it off** is only possible when no branches other than main are active. History stays.
- **Removing the old task-sandbox merge:**
  1. Check production for rows in `workspace_git_deltas`, and for nodes using `canonical_node_id`.
  2. If there are none, remove `merge-sandbox.ts`, the `/tasks/:taskId/merge` route, the table (migration) and the column.
  3. If there are some, report them to the user before anything is removed.

## H17. Not in this first set (recorded for later)

- **Next:**
  - compare any two points, blame, permanent line links, workspace-wide code search per branch
  - tags and releases
  - Files tab polish: README under folders, syntax-highlighted code view and raw view, folder history, keyboard navigation (`t`, `y`)
- **Later:** a real git remote (`git clone https://networkbase.in/<workspace>.git`), forks, code owners, insights.
- **Also later:** linking NetworkBase merge requests with GitHub pull requests; branches in assignment copies; branch-aware task files.

## H18. Tests

- **Unit:**
  - branch name rules
  - the resolver (checkpoints plus replay equal a full replay, property-tested)
  - merge base bookkeeping
  - git `HEAD` reading in the CLI (normal, detached, worktrees)
- **Database:**
  - every route in H14
  - **every writer records a save** (the H12 guard test, plus one DB test per writer)
  - protected main refuses non-merge saves, and allows GitHub sync when chosen
  - merge all-or-nothing into main and into a branch
  - squash
  - revert
  - update from main with conflicts
  - permissions (H15 table)
  - limits
  - assignment copies refuse branches
- **CLI:**
  - `nb branch` and `nb merge-request` commands with their `--json` schemas
  - switching with and without local changes
  - following git branches: switch, unknown branch asks, detached head refused
  - push to protected main offers a branch
- **End to end:**
  1. an agent works on `agent/4-login-bug` across 30 files
  2. it opens a merge request
  3. the person reviews, comments and applies a suggestion
  4. a check posts and passes
  5. merge, with the task moving to Done
  6. revert the merge

  Plus a git folder switching between two branches and pushing to each without mixing.
- **Speed:**
  - switching branches in the Files tab: under 1 second for 5,000 files
  - opening a merge request with 200 files: under 2 seconds
  - merging 200 files into main: under 5 seconds

## H19. Rollout and build phases

| Phase | Builds | Release |
|---|---|---|
| **H-1. Saves on main** | tables, `recordSave` in every writer, "Start of history", checkpoints, workspace history and save pages, revert, `nb log` / `show` / `revert` | site + CLI (behind the "Branches" setting) |
| **H-2. Branches** | branch tables, resolver, picker, branch bar, branch list, create, switch, rename, delete, update from main, CLI `nb branch`, git-following, `?branch=` on existing routes | site + CLI |
| **H-3. Merge requests** | merge requests, reviews, comments, suggestions, checks API, merge and squash, notifications, task linking, `nb merge-request` | site + CLI |
| **H-4. Protection and agents** | protection rules and enforcement, agent defaults and tools, the approval-page wording | site + CLI |
| **H-5. GitHub branch mapping and cleanup** | branch-to-branch sync, removing the old sandbox | site |

- **Every phase:** behind the workspace setting, its tests in H18, checked live on the user's workspace, and the user's go-ahead for each deploy.
- **Order with Part G:** Part G's core (G-1 to G-3) comes first; Part H uses its upload, merge and apply (R2).

## H20. Decisions taken (recommended)

1. **Main stays materialised as today;** branches store only their own changes. This keeps every existing feature working without change.
2. **Branches don't move with main** (like GitHub); **Update from main** brings it in.
3. **Task working files, final files and assignment copies stay main-only** in this first set.
4. **Agents work on branches and open merge requests by default.**
5. **Main is protected by default only for team workspaces** (more than one member); personal workspaces keep working directly on main unless the owner turns protection on.
6. **The CLI follows the git branch automatically,** and asks before creating a NetworkBase branch.
7. **NetworkBase merge requests and GitHub pull requests stay separate in this first set,** with branches synced by name.
8. **Every change to main records a save,** through one writer that a test enforces.
9. **Part G change sets become branch saves,** built once for both.

## H21. Risks and how they're handled

| Risk | Handling |
|---|---|
| A writer forgets to record a save, leaving history with gaps | The H12 guard test, plus one DB test per writer |
| Rebuilding old trees gets slow | Checkpoints every 100 saves and at branch starts; head caching |
| People editing the wrong branch | The coloured branch bar, the branch in the address, the CLI status and prompt |
| Protected main blocking urgent fixes | Owners' "Merge without approval", with "Verify it's you" and an audit entry |
| GitHub sync and protection fighting | The explicit choice when connecting (H5); sync saves labelled "from GitHub" |
| Storage growth from many branches | Content stored once by hash; limits; 7-day cleanup of merged branches |
| The old sandbox holding data | Checked before removal; reported to the user if anything is found (H16) |

## H22. The smallest useful first release (MVP)

**MVP:** phases **H-1, H-2 and H-3 without checks.** A person can:
- see workspace history and revert a save
- create a branch, switch to it, save on it, and update it from main
- open a merge request, review it with comments and suggestions, and merge or squash it
- do all of this from the app and the CLI, with the CLI following git branches

**Right after the MVP:**
- checks (H4)
- protection rules (H-4)
- agent defaults (H7)
- GitHub branch-to-branch sync (H-5)

Until protection ships, agents keep Part G's behaviour (a draft change set and one yes), so nothing is less safe in between.

**Why this order:** history alone already fixes "what happened to my files". Branches plus merge requests fix the mixing problem and give the review loop. Protection and agent defaults then make it the safe default.

## H23. Journeys, step by step

**1. A new user meets branches for the first time**
1. Opens Files. The branch picker shows "main ▾" with a small "New" dot the first time.
2. Opens the picker and sees one line: "Branches let you try changes without touching main. Merge when you're happy." Then **Create a branch**.
3. Names it (suggested: `ram/try-new-header`) and lands on it. The coloured bar says "On branch ram/try-new-header · nothing changed yet".
4. Edits a file and saves. The bar now says "1 save ahead of main", with **Open merge request**.
5. Opens the merge request (pre-filled), merges it themselves (personal workspace, no protection), and accepts **Delete branch**. They're back on main with the change.

**2. A team member builds a feature with review (team workspace, protected main)**
1. On task #4, clicks **Start work → Create branch** `task/4-login-bug`.
2. Works in the app, or in a linked folder with `nb` (the folder follows the git branch, or `nb branch switch`).
3. Pushes several saves.
4. Opens a merge request with "Closes #4". The task shows "MR !3 open".
5. A reviewer comments and suggests an edit. The author applies it (a new save). The reviewer approves.
6. Checks pass (if configured).
7. **Merge** (or squash). The task moves to Done, or to review, and the branch is offered for deletion.

**3. A reviewer**
1. Gets "Review requested: MR !3" in the inbox (and email, per settings). `nb inbox` and `nb merge-request list --review-requested` show it too.
2. Opens **Files changed**, comments on lines, suggests edits, and approves or requests changes.
3. Gets "!3 merged" when it lands.
4. **"My reviews"** (inbox filter, and the CLI command above) lists every merge request waiting on them, across all workspaces.

**4. A heavy user (many branches, every day)**
- **The branch picker:**
  - recent branches first (the last 5 used)
  - a search box
  - keyboard: `b` opens the picker, arrows move, Enter switches
- **The branch list:**
  - filters (mine, active, stale, merged)
  - sort by last save
  - **Delete merged branches**, which tidies all of them in one action
- **Keyboard and CLI:**
  - merge request list keyboard: `j`/`k`, Enter opens, `a` approves when allowed
  - `nb branch list --mine --stale` and `nb merge-request list --mine` cover the same from the terminal
- **Stale branches:** after 30 days without saves, a branch shows "Stale". After 90 days its owner gets one inbox note: "Archive or keep?". Nothing is deleted without a click.
- **Updating:** "Update from main" is offered on the branch bar whenever the branch is more than 20 saves behind.

**5. Someone asking an agent**
1. Asks Claude Code: "fix the login bug in task 4".
2. The agent creates `agent/4-login-bug` (or uses the task's branch), works and saves.
3. It opens MR !5 with its "What I did" list, and says "Opened merge request !5 for your review".
4. The person reviews. Comments become agent notes, and the agent answers with new saves next session.
5. The person merges. The agent never merges into a protected main.

**6. A GitHub user**
1. Connects the repository. main ↔ the repository's default branch; other branches sync when turned on.
2. Works locally with git on `feature-x`. `nb push` goes to NetworkBase `feature-x`, and GitHub sync keeps GitHub `feature-x` in step.
3. Merges in NetworkBase. The result goes to GitHub main.
4. If they merge a pull request on GitHub instead, it arrives on NetworkBase main as a save "from GitHub".

**7. A teacher in an organization's team workspace**
- Branches work as for any team. Main is protected by default; teachers and admins merge.
- Students' assignment copies have no branches (H2). Their hand-ins work exactly as today.

**8. On a phone**
- **The branch picker opens as a bottom sheet** with search.
- **The branch bar** stays visible under the header.
- **Merge requests:**
  - files open one at a time, with a unified diff instead of side by side
  - Approve, Request changes and Merge are full-width buttons at the bottom
  - creating branches and merging work on the phone; resolving conflicts asks to use a larger screen (the merge editor needs width), but still allows "theirs" or "mine" per file

**9. Working offline in the terminal**
- `nb branch switch` to a branch whose files were pulled before works offline, and is labelled "offline".
- Saves go into the offline queue (C6) tagged with their branch, and replay to that branch.
- Creating a branch, opening a merge request and merging need the network, and say so.

## H24. Every situation, and what happens

| Situation | What happens |
|---|---|
| **Protected main and "Use this version"** on a file | Offers "Make a branch with this version" and opens a merge request; owners can override (H5) |
| **Protected main and restoring from Trash** | Restore goes to a branch plus a merge request; owners can restore directly |
| **Protected main and the Documents tab README editor** | Saving offers "Save to a new branch" and opens a merge request; the Documents tab keeps showing main until it merges |
| **Protected main and drops or uploads** | Offered a branch (H5) |
| **A merge request with no changes** | Can't be opened; "This branch has nothing that main doesn't already have" (`MERGE_REQUEST_EMPTY`) |
| **The source branch changes after approval** | The approval stays but is marked "approved an earlier save"; whether it counts follows "new saves need approval again" (H5) |
| **Main moves while a merge request is open** | Ahead and behind update; conflicts are rechecked when merging; "Update from main" is offered |
| **Two saves on the same branch at the same moment** | The second is checked against the head it started from and gets `BRANCH_MOVED` (H26); the app and CLI retry by merging, as with file conflicts |
| **Renaming a branch** | Its merge requests, linked CLI folders (stored by branch id, not name) and GitHub mapping follow. The GitHub branch is renamed only if the person agrees, because others may use it there |
| **Deleting a branch with an open merge request** | Asks first; the merge request closes with "Branch deleted"; restoring the branch reopens it |
| **Deleting a branch with saves not in main** | Asks with the count ("3 saves aren't in main"); restorable for 30 days |
| **The branch a CLI folder is on is deleted** | The next command says so and offers `nb branch switch main` (local edits are kept) |
| **A file over 25 MB on a branch** | Refused as on main (`FILE_TOO_LARGE`) |
| **A file locked on main** | Not locked on branches (H8); merging into main waits until the lock is released or its holder agrees |
| **A member is removed from the workspace** | Their branches stay (owned by the workspace) and show "former member"; their open merge requests stay open for others to finish or close |
| **A person deletes their account** | Their branches and merge requests stay, shown as "deleted user", as other authored content is today |
| **The workspace is archived** | Branches and merge requests become read-only |
| **The workspace is public** | The public sees **main only**. Branches, saves on branches and merge requests are visible to members only, because drafts aren't for the public |
| **Branches turned off with only main** | History stays; branch screens hide |
| **Someone opens an old link to a deleted branch** | "This branch was deleted on <date>", with **Restore** (within 30 days, for those allowed) or **Go to main** |
| **Many saves in a short time** (an agent saving every few seconds) | Branch watchers get one batched notification per 15 minutes, as agent session summaries are batched today |

## H25. Scale and heavy use

| What | Limit or target |
|---|---|
| Active branches per workspace | **500** (raised from 100 for heavy users); merged branches don't count |
| Open merge requests per workspace | 200 |
| Saves per merge request shown at once | 250, then paged |
| Files changed in one merge request | Part G limit (2,000); the Files changed tab is virtualised |
| Switching branches | under 1 second for 5,000 files |
| Opening a merge request | under 2 seconds for 200 files |
| Branch picker | instant for 500 branches (served from one cached list per workspace) |
| History page | 50 saves per page, under 500 ms |

## H26. Architecture additions found in the audit

- **Moving a branch's head safely:**
  - every save carries `expectedHead` (the head save it started from)
  - `recordSave` locks the branch row (`SELECT … FOR UPDATE`) and refuses with `BRANCH_MOVED` if the head moved
  - the app, the CLI and Part G capture then merge and retry, so no save is ever lost or silently overwritten
- **Branch identity:** CLI folders, GitHub mappings, merge requests and links store the **branch id**. Names are only for display and the address; a renamed branch's old name redirects for 30 days.
- **Reference words:**
  - merge requests are shown as **"MR !3"** and referenced with `!3`; tasks keep `#4`
  - "Closes #4" closes task 4
  - `!3` in comments links to the merge request
- **Visibility:** branch, save and merge-request routes require workspace **membership**, not just read access. Public readers get main only (H24).
- **Search on any branch:** the Part G text index is keyed by **content hash** (G14). A branch's files, and any save's files, are searched through the same index without re-indexing.
- **Events:**
  - the realtime topic per workspace carries `branch.updated`, `save.created`, `merge_request.updated` and `merge_request.merged` with ids only; clients refetch
  - the activity feed and the security log record branch deletion and restore, protection changes and owner overrides
- **Cleanup jobs** (one daily background function, counted against the Inngest plan):
  - delete merged branches after 7 days
  - purge deleted branches' files after 30 days
  - delete content no longer referenced (`scheduleAssetDeletionIfUnreferenced`)
  - the stale-branch notes (H23)
- **Accessibility:**
  - the branch picker is a labelled combobox
  - the branch bar is announced when it changes
  - diffs give screen readers "added line" and "removed line" text, not only colour
  - every merge request action works from the keyboard
- **Export (F8):** `nb export` covers main by default; `--branch <name>` exports a branch; `--all-branches` adds each active branch as a folder in the zip.
- **Email:** merge-request notifications follow the existing email settings and templates, with a link straight to the right tab.

## H27. Audit check: every journey has an answer

Each journey in H23 was walked against H1–H26:
- every step names its screen or command, what the person sees, and what the server does
- every situation in H24 has a defined outcome
- every rule has its place in the architecture (H9–H16, H26)
- every promise has a test in H18, extended by the H23 journeys as end-to-end tests

---

# Part E: fresh walkthrough of both journeys

Before Parts C, D and G are built in detail, walk both journeys as real people would, and write down every confusing, slow or unclear moment.

**E0. When, on what, and who**
- **When:** after Parts A and B are live (CLI 2.0.4 and the new approval page). It walks what exists then; features not built yet are noted as "planned in C/D/G", not tested.
- **Who runs it:**
  - **Claude:** the scripted terminal runs and the agent runs.
  - **The user:** the steps that need their account (sign-ins, approvals, two-account checks), plus finding the real first-time person (E9).
- **Machines:**
  - macOS: the user's Mac.
  - Linux and Windows scripted runs: GitHub Actions runners.
  - A real Windows machine: the user's, if they have one; otherwise a cloud Windows VM, with the user's go-ahead for any cost.
- **Where findings go:** `docs/superpowers/plans/<date>-walkthrough-findings.md`, linked from this report as "Part E results".

**E1. The journeys**
1. **At the terminal:** install → `nb` → sign in → link a folder → see tasks → work on one → push → hand in an assignment → see the review → undo a mistake.
2. **Through an AI:** `nb agent setup` → approve (one click) → "what should I do today?" → "work on #4" → questions → drafts → "finish it" → the yes → the reviewer's view.
3. **Branches and merge requests** (once Part H is live): create a branch → save on it → a git folder switching branches → open a merge request → review with a suggestion → merge with "Closes #4" → revert. Plus the H23 journeys for a reviewer, a heavy user, a GitHub user and a phone.

**E2. Who walks them** (one run per person type)
- **A student:** classes, hand-ins, take back, "check my hand-in".
- **A teacher:** review queue, batch return, class progress.
- **A team lead:** planning a sprint, assigning, reviewing.
- **A solo developer:** files, git, `nb watch`, an agent on their own work.
- **An organization admin:** agent policy, pausing agents, roles.
- **Someone with no Node installed:** the single-file install (C7).
- **A heavy user:** many branches, many open change sets, the terminal dashboard, bulk commands.
- **A GitHub user:** a repository connected, working locally with git on several branches.

**E3. Where**
- macOS, Windows and Linux.
- A server over SSH (no browser; QR approval from a phone, A4).
- A cloud sandbox (GitHub Codespaces).
- Behind a company proxy with its own certificates.

**E4. Which agents**
- Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot.
- A cloud agent on hosted MCP (OAuth sign-in, no local folder).

**E5. Success criteria and time targets**

| Step | Target |
|---|---|
| Install to first push | under 3 minutes |
| Connecting an agent | 1 approval click |
| The agent's first useful answer | under 60 seconds |
| Handing in an assignment | no help page needed |
| Any error | says the next step without reading docs |

**E6. Failures played on purpose**
- The network drops in the middle of a push.
- The sign-in expires, or is revoked from Settings while in use.
- The workspace is paused, or the organization turns agents off.
- A conflict with a teammate's change.
- A 25 MB file.
- A slow connection (throttled).

**E7. Accessibility pass**
- The terminal journey with a screen reader (VoiceOver, Narrator), using `--plain`.
- The approval page with a screen reader and keyboard only.

**E8. What each run records**
- **Terminal recordings and agent transcripts,** kept with the findings (secrets removed).
- **Every finding with a severity:** blocker, annoying, or polish.
- **Every finding marked** "already planned in A–D/F" or "new".
- **Times measured** against E5.

**E9. Kept afterwards**
- **The walkthrough becomes automated tests:** the stable parts of each journey (scripted terminal steps against a seeded server, and the agent steps through the Part D test) run before every release, so the same problems can't come back.
- **Repeated after every minor release** (2.1, 2.2), with the findings list updated.
- **A real first-time person:** at least one walkthrough with someone who has never used NetworkBase, with the user's help finding them. They're watched, not guided, noting where they hesitate. It finds things no script does.

**Output:** the findings list is added to this report as Part E results. The user then chooses what goes in, and anything new is added to C, D or F.

---

# Part F: the other areas

**F1. Classes and organizations**
- **Students:** everything due across all their classes in one view (`nb assignment list --due week`), and assignments included in `nb next`.
- **Teachers:**
  - a roster and progress view per assignment (`nb class progress <assignment>`: handed in, late, returned, approved)
  - returning several hand-ins with one comment (`nb review return 3 5 8 -m "…"`)
- **Announcements:** organization announcements shown in `nb inbox` and `nb class announcements`.
- **Unchanged:** creating assignments stays in the app (the CLI 2.0 report's decision D21).

**F2. Sprints and planning** **(app has it)**
- `nb sprint create "<name>" --from monday --to friday`
- adding tasks: `nb sprint add 3 4 5`
- closing a sprint, with its unfinished tasks moved to the next one: `nb sprint close`
- a simple text burndown in `nb sprint view`

Each uses the organization's own words (Unit, Week) where it has them.

**F3. Workspace admin** (owner and admin only)
- `nb workspace create "<title>"`, `nb workspace settings` (view and change), and `nb workspace archive`.
- **The agent policy** (ask for everything / important only / trust drafts and docs) from the CLI.
- **Docs:** `nb doc add <file>` makes a file a workspace doc, and `nb doc remove <slug>` unlinks it (the file stays).

**F4. Agent management**
- **`nb agent activity`:** what agents did, grouped by session, with Undo per session.
- **`nb agent pause` / `nb agent resume`** for a workspace (owner only), the same as the switch in workspace settings.
- **OAuth refresh tokens for hosted MCP:** editors that sign in through the browser get no refresh token today, so every 30 days the editor has to sign in again. The MCP authorization standard supports refresh tokens. Add them, rotate them on every use, and revoke them with the sign-in.

**F5. Account and security**
- **New-country warning:** the server already records the country a token was last used from (migration 0076). `nb token list` shows it, and use from a new country is flagged.
- **`nb whoami --security`:** your sign-ins, whether two-factor is on, and recent security events.
- **"Verify it's you" for risky CLI actions,** like the app: making a personal access token, removing members, exporting.
- `nb logout --all` (exists) stays.

**F6. Automation and CI**
- **A GitHub Action** (`networkbase/action`): push build output to a task, or move a task when a pull request merges, using a workspace token.
- **`nb api <METHOD> <path>`:** calls any `/api/v1` route with your sign-in, for anything the CLI doesn't cover yet. Writes follow the same yes rules.
- **Scripting recipes** in the docs: cron jobs, CI steps and shell loops using `--json` and the exit codes.

**F7. Updates and versions**
- `nb upgrade` (see C5).
- **The npm `next` tag** moves off 2.0.0-next.3 (needs the user's npm two-factor code).
- **"What's new":** `nb version` says "2.1.0 is out: what's new", following the existing once-a-day notice rule.

**F8. Data and privacy**
- **`nb export`:** a zip of a workspace's tasks, comments, docs and files, for backups. It needs a yes for agents.
- **A clear note in `/docs/cli`** of what the CLI keeps on the computer, and **`nb logout --purge`** to wipe all of it (credentials, caches, queue, base copies).

**F9. Accessibility and language**
- **`--plain`** tested with a real screen reader (VoiceOver on macOS, Narrator on Windows).
- **Never colour alone:** every colour-coded state also has a word or symbol.
- **Time zone:** already honoured. Other languages come later.

**F10. Learning and docs**
- **Recipes in `/docs/cli`:** start the day, hand in an assignment, review a class, set up an agent, back up a workspace. Each is copy-ready and tested in CI.
- **Every error links to its docs section** (see C5).

**F10b. MVP and journeys**

**MVP:**
- F4 refresh tokens (no more re-signing in every 30 days)
- F7 `next` tag
- F1 student "due across classes" and teacher batch return
- F2 sprint create and add

**Journeys:**
- **Student:** `nb assignment list --due week` → `nb next` shows the nearest.
- **Teacher:** `nb class progress lab-2` → `nb review return 3 5 8 -m "add tests"`.
- **Admin:** `nb workspace settings` → set the agent policy → `nb agent pause` during an incident.
- **Backup:** `nb export` (main) or `--all-branches` (Part H).

**F11. Build spec**

| Item | Server change |
|---|---|
| F1 student "due across classes" | extend `GET /api/v1/assignments` with `due` |
| F1 class progress | new `GET /api/v1/assignments/:master/progress` over the existing roster data |
| F1 batch return | extend the review return route to take several ids and one comment |
| F1 announcements | read route over the existing organization announcements |
| F2 sprints | `POST` (create), `POST …/:sprint/tasks` (add), `POST …/:sprint/close` on top of `GET /workspaces/:id/sprints` (exists), using the existing sprint server functions |
| F3 workspace create, settings, archive | v1 routes over the existing workspace actions; owner and admin only |
| F3 agent policy | `PATCH /workspaces/:id/agents { policy, paused }` (also serves F4 pause and resume) |
| F3 docs add and remove | v1 routes over `linkWorkspaceDocAction` and `unlinkWorkspaceDocAction` |
| F4 agent activity | `GET /api/v1/agent-sessions` and `…/:id/activity` (the `agent-sessions` folder exists) |
| F4 refresh tokens | **migration 0091** `oauth_refresh_tokens (id, session_id, token_hash, family_id, expires_at, used_at, revoked_at)`; the token endpoint accepts `grant_type=refresh_token`; each use issues a new refresh token; reusing an old one revokes the whole family; revoking the sign-in revokes the family |
| F5 new country | `last_country` exists (0076); `nb token list` shows it; a new country on a token sends a security notification |
| F5 security summary | `GET /api/v1/me/security` |
| F5 "Verify it's you" in the CLI | for risky CLI actions the CLI opens a short browser page to verify, then continues (the same pattern as A10 change access) |
| F6 GitHub Action | a new public repository `networkbase/action` (**user step:** create it), using a workspace personal access token |
| F6 `nb api` | CLI only; calls go through the same token route list and scopes, so nothing new is reachable |
| F8 export | reuses the folder and workspace zip from the downloads work, plus a JSON file of tasks, comments and docs; `--branch` and `--all-branches` with Part H (H26); agents need a yes |
| F8 `logout --purge` | CLI only |
| F7 `next` tag | **user step:** npm two-factor code |

**Done when:**
- each item's command and route pass the CLI and DB suites
- the refresh-token rotation and reuse tests pass
- the GitHub Action runs in a test repository
- the docs recipes pass in CI

**Risks:**
- Refresh-token mistakes. Handled with rotation, family revocation and tests modelled on the OAuth 2.0 security best practice.
- Export size. It reuses the zip streaming that is already live.

---

# Registers

**R1. Migrations, in planned order** (the last applied is 0081, versions-only-grow, live 2026-11-11)

| # | Part | What |
|---|---|---|
| 0082 | A | `device_codes.country`, plus the requested access fields |
| 0083 | A | `agent_access_defaults` |
| 0084 | A | `agent_access_requests`; notification kind `agent_access_request` |
| 0085 | B | `workspaces.agent_label_visibility` |
| 0086 | C | `tasks.labels`, `task_dependencies`, `task_watchers`, `task_stars`, `node_stars`, `task_links` |
| 0087 | C | `task_reminders` |
| 0088 | D | `task_agent_notes` |
| 0089 | G | `change_sets`, `change_set_items`, `file_versions.change_set_id`, inverse kind `changeset.undo` |
| 0090 | G | `file_text_index` keyed by content hash, plus `file_text_index_paths` (`pg_trgm`) |
| 0091 | F | `oauth_refresh_tokens` |
| 0092 | H | `branches`, `saves`, `save_changes`, `tree_checkpoints`, `checkpoint_files`, `branch_files` (phases H-1, H-2) |
| 0093 | H | `merge_requests`, `merge_request_reviews`, `merge_request_checks`, comment anchors for merge requests (H-3) |
| 0094 | H | `branch_protection` (H-4) |
| 0095 | H | drop the old sandbox: `workspace_git_deltas`, `workspace_nodes.canonical_node_id` (H-5, only after the H16 check) |

If parts are built in a different order, numbers follow the order they're applied in, and this table is updated.

**R2. Milestones and releases**

| Milestone | Contents | Release |
|---|---|---|
| **M1** | Part A | 0082–0084, site deploy, **CLI 2.0.4** |
| **M2** | Part B | 0085, site deploy |
| **M3** | Part E walkthrough on M1 and M2 | findings file; the user chooses what's added |
| **M4** | Parts C and D (2.1.0 scope in C15) | 0086–0088, site deploy, **CLI 2.1.0**; then 2.1.x for `nb ui`, messages, `nb learn` and installers |
| **M5** | Part G phases G-1 to G-3 (core, review, conflicts) | 0089, site deploy, **CLI 2.2.0** behind the workspace flag |
| **M6** | Part G phases G-4 and G-5 (cloud agents, git) | 0090, site deploy, CLI 2.2.x |
| **M7** | Part F | 0091, site deploy, **CLI 2.3.0** |
| **M8** | Part H phases H-1 to H-5 | 0092–0095, site deploys per phase, **CLI 2.4.0** (branch, log, merge-request commands, git-following) |
| **M9** | Final audit | `check:plan-ledger` with 0 remaining across the report; all suites; the E9 walkthrough repeated |

- **Order (agreed 2026-11-11 with the implementation plan):** M0 (preparation) → M1 → M2 → M3 → M4 → M5 → M6 → **M8 → M7** → M9. Part H comes before Part F because branches matter more.
- **Deploys:** per milestone, with one go-ahead each and a live check after.
- **M8 (branches) starts after M5,** because it uses Part G's upload, merge and apply.
- **Moved earlier:** F7's `next` tag goes with M1, and F4's refresh tokens with M6.
- **Version numbers** follow the order releases ship.
- **Live checks with two people:** owner @ramanayudu_ch, member @ch_rama.

**R3. New error codes**
- **Part A:** `ACCESS_REQUESTED`, `ACCESS_DENIED_BY_PERSON`
- **Part D:** `AMBIGUOUS`
- **Part G:** `CHANGE_SET_LIMIT`, `CHANGE_SET_CLOSED`, `CHANGE_SET_TOO_LARGE`, `CHANGE_SET_CONFLICT`, `CONTENT_MISSING`, `HASH_MISMATCH`, `STORAGE_LIMIT`, `UNDO_BLOCKED`, `EDIT_NOT_FOUND`, `EDIT_NOT_UNIQUE`, `BAD_PATH`, `FILE_LOCKED`, `HAND_IN_LOCKED`
- **Part H:** `BRANCH_PROTECTED`, `BRANCH_NOT_FOUND`, `BRANCH_EXISTS`, `BAD_BRANCH_NAME`, `BRANCHES_OFF`, `BRANCH_LIMIT`, `BRANCH_MOVED`, `DETACHED_HEAD`, `APPROVAL_REQUIRED`, `CHECKS_FAILED`, `MERGE_REQUEST_EXISTS`, `MERGE_REQUEST_EMPTY`

Each gets a docs anchor (`/docs/cli#error-…`) and a CLI message ending with the next step.

**R4. New token scopes**
- `message:read` and `message:write` (C4), in no agent preset.
- A Read only agent uses existing read scopes.

**R5. Steps only the user can do**
- **npm:** approve each staged release (2.0.4, 2.1.0, 2.2.0, 2.3.0) and move the `next` tag (two-factor code).
- **GitHub repositories:** create `networkbase/action` (F6) and the Homebrew tap (C7); winget and Scoop submissions.
- **Accounts and people:**
  - sign-ins and approvals in live checks
  - a second account for the label and permission checks
  - finding the real first-time person (E9)
- **Go-ahead:** every deploy, production migration and paid machine (for example a cloud Windows VM).
- **Part H:**
  - turning "Branches" on for each workspace during rollout
  - choosing whether GitHub sync may pull into a protected main
  - approving removal of the old sandbox after the H16 check

**R6. Server work by type**
- **New tables and columns:** R1.
- **New routes:**
  - Part A: A10
  - Part C: C15
  - Part D: D23
  - Part G: G7
  - Part F: F11
- **Already in the app,** and only needs routes or the CLI:
  - sprints
  - invites and roles
  - comment delete
  - trash restore
  - notification settings
  - workspace create
  - doc link and unlink
- **Browser-only today, moving to the server:** Starred files (`node_stars`).
- **Local only (no server):**
  - remembered partial pulls
  - `nb queue`
  - `nb ui`, completions and the prompt
  - `nb logout --purge`
  - `nb uninstall`
  - the QR code
- **Already in the CLI** (improve, don't add): `nb diff`, `nb file history`, `nb pull <path>`, `nb task list --save`, `nb inbox --follow --notify`, `nb logout --all`, `nb task start --branch`, `nb task create --from`.
- **Release pipeline:** single-file builds, Homebrew, winget, Scoop, the nightly agent test workflow.
- **Part H new routes:** H14.
- **Part H writers that must record saves:** H12.
- **Part H removed code:** the old task sandbox merge (H16).

**R7. Top risks across parts**

| Risk | Where handled |
|---|---|
| All-workspaces agent tokens are worth more if stolen | A10 risks, F5 |
| Labels leaking when hidden | B build spec (server-side helper and test) |
| 2.1.0 grows too big | C15 release split |
| Too many tools slow agents down | D14 packs and the token budget test |
| Change-set merges or large applies go wrong | G26 |
| Inngest free-plan usage (reminders, renewal, index, GitHub jobs) | measured before each rollout (G19, C15) |
| Branch history with gaps, or editing the wrong branch | H21 |
| Drafts on branches seen by the public | H24, H26 (members only) |
| Two saves racing on one branch | H26 (`expectedHead`, `BRANCH_MOVED`) |

# Review log

**2026-11-11, full end-to-end review.** Found and fixed:
1. **Part A** had no API contract. Added A10: routes, the sentence function, how "Allow once" is bound, why change access opens a browser page, errors, done, risks.
2. **Part B** hid labels only in the browser. Now the server decides (`visibleVia`), with a test against forgotten read paths.
3. **Part C:**
   - Starred files are browser-only, and messages have no v1 routes. Both are corrected to new server work, with scopes for messages.
   - Added C15 (server work per item, CLI pieces, release split, done, risks).
4. **Part D:**
   - Items 6–7 now lead into the bigger test.
   - Item 18 is delivered by Part G's `fs_*` tools, not a second file tool.
   - The core tool count now includes the change-set tools (19).
   - Added D23 (how each piece works: plans, candidates, presence, packs, notes, the agent test).
5. **Part E** didn't say when or by whom. Added E0: after A and B, Claude with the user, GitHub runners, and the findings file.
6. **Part F** had no build spec, and an unlisted migration. Added F11 and migration 0091.
7. **Part G** was a concept. It's now a full architecture:
   - G2 words, G3 overview
   - G4 tables and indexes
   - G5 state machine
   - G6 content storage
   - G7 API contract
   - G8 capture
   - G9 merge
   - G10 apply transaction
   - G11 undo
   - G12 review
   - G13 permissions and limits
   - G14 cloud tools and index
   - G19 operations
   - G22 tests
   - G23 rollout
   - G24 phases
   - G25 decisions
   - G26 risks
8. **Whole report:**
   - Added Part 0 (rules) and the registers: migration numbers so none collide, milestones, error codes, scopes, user-only steps, server work by type, and risks.
   - Fixed the old release line that put Part C's new-server items under Part F.

**2026-11-11, branches added (Part H).**
- The user chose the core loop: branches, saves and history, merge requests, protecting main, and the CLI, git and GitHub on the right branch.
- **Part H has 21 sections:**
  - what exists and the mixing problem
  - the five features
  - agents on branches
  - behaviour across every NetworkBase area
  - architecture: principles, data model, resolver, the one save writer, merging on Part G, API, permissions and limits
  - turning it on, and removing the old sandbox
  - later sets, tests, phases, decisions, risks
- **Part G** now notes how change sets become branch saves.
- **Registers:** migrations 0092–0095, milestone M8 (CLI 2.4.0), Part H error codes, user steps and risks.

**2026-11-11, final user-level audit.** Every part was walked as journeys: a new user, a normal user, a heavy user, a team, a reviewer, an agent, a GitHub user, a teacher, a phone user and offline. Found and fixed:

1. **Part H:**
   - Added **H22** (the MVP slice), **H23** (nine step-by-step journeys), **H24** (21 situations, including protected main with "Use this version", Trash restore and the README editor; empty merge requests; renames and deletes with open merge requests; removed members; archived and public workspaces).
   - Added **H25** (scale: 500 active branches), **H26** (head check with `BRANCH_MOVED`, branch ids not names, "MR !3" references, members-only visibility, events, cleanup jobs, accessibility, export, email) and **H27** (the audit check).
   - Updated limits, routes and permissions to match.
2. **Part G:**
   - The text index is now keyed by content hash, so every branch is searchable.
   - Added the MVP, journeys, and how change sets behave on a protected main (G24b).
3. **Parts A, B, C, D, F:**
   - Each now has its MVP and normal and heavy journeys (A9b, B, C14b, D22b, F10b).
   - A no-workspace row in A3.
   - B's setting applies when things are read, and to emails, exports and branch saves.
   - C's file commands follow the current branch.
   - F's export covers branches.
4. **Part E:** the branch journey, and heavy-user and GitHub-user people, added.
5. **Part 0:** the new rule 0.6, every part states its MVP, journeys and situations; "done" is now 0.7.
6. **Registers:**
   - migration 0090 described as hash-keyed
   - `BRANCH_MOVED` and `MERGE_REQUEST_EMPTY` added
   - two new risks
