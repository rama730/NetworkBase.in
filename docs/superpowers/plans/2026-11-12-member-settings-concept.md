# Member settings in a workspace: concept

**Status:** LIVE 2026-11-23 (origin 30c2f7454, web and worker deployed). Migration 0114 is in production (applied and checked the same day). Started 2026-11-12 and parked during the CLI and agents round.
- **2026-11-23:** the user added **Completing your part** (Part 2).
- **2026-11-23:** an end-to-end check against the code found 24 gaps (§9). They are closed in this version.

**Why:** a member opened workspace settings looking for "Show when agents helped" and found nothing. Only owners and admins get workspace settings today. Nothing marks the end of a person's work in a workspace, so their profile says "Now · Since Mar 2026" forever.

## 0. What exists today (checked in the code, 2026-11-23)

The design builds on these and doesn't duplicate them:

| Exists | Where | Used for |
|---|---|---|
| One membership row per person per workspace: role, `joined_at`, `title`, `show_on_profile`, `notification_preferences` (per-event overrides), `last_opened_at`, `unit_id` | `workspace_members` | Part 1 settings live here. No new table. |
| Profile entries: one per person per workspace, with `started_at`, `ended_at`, `end_reason` (left, removed, term_ended, org_deleted), `ended_by`, `end_note`, `verified_*` | `profile_contributions` | Completing your part sets `ended_at` and a new reason |
| Role periods within an entry (at most one open), with a `source` check list | `profile_contribution_stages` | A new stage when you reopen |
| Ending an entry | `endProfileWorkspaceContributionMembership()` | Reused, with new reasons |
| The profile's **Completed** chip (for an ended term) | `entryStatus()` in `profile-rules.ts` | The word for a completed part. **"Done" is not used on screen.** |
| Leaving | `DELETE /api/v1/workspaces/:id/members {leave:true}`, `nb workspace leave` | Only unassigns tasks; no preview, no choices, no Undo, nobody is told, **no button in the app** |
| Removing a member | `removeWorkspaceMemberInternal()` (one transaction, reassign or unassign tasks) | Leave and Complete reuse its task handling |
| Ownership transfer | `transferWorkspaceOwnership()` | The owner's way out |
| Workspace status **completed** | `workspaces.status` (draft, active, completed, archived); `updateWorkspace()` accepts it; no button sets it | "Complete the workspace" hooks into it |
| Write access: the app's resolver and a SQL function that mirrors it | `getWorkspaceAccess()` / `computeWorkspaceWriteAccess()` and `app_private.nb_workspace_can_write()` (45 uses in SQL) | Read-only after completing is enforced in both |
| Agent gates | `workspaceAgentPolicy(workspaceId)` (per request) and `agentWorkspaceFilter()` (lists) | Gain a per-person "keep my agents out" |
| Notification mutes | `muteNotificationScope()`, scope kind `project` | Gains an end time (`until`) |
| Members routes accept your own sign-in only (never an agent token) and need "verify it's you" from a terminal to remove someone | `personAt()`, `requireStepUp()` | Same rules for every route below |
| Idempotent writes, undo records | `idempotentWrite()`, `undo_operations` | Completing and leaving are idempotent and undoable |

## 1. Principles (architecture)

1. **The membership row is the one source of truth** for a person's place in a workspace: role, settings, and whether their part is completed. The profile entry is written from it in the same transaction, never separately.
2. **Two kinds of settings, never mixed.** The workspace's settings belong to the owner and admins. Your settings only affect you, and can only be **stricter** than the workspace's.
3. **Enforced once, everywhere.**
   - Read-only after completing is decided by the access resolver and its SQL mirror, never by each screen.
   - A contract test keeps the two in step.
   - The app, the API, the CLI, agents and realtime all go through them.
4. **One domain module.** It is `src/lib/workspaces/member-journey.ts`: preview, complete, reopen, leave, undo, confirm. Server actions (app) and API routes (CLI) are thin layers over it, so their rules can't drift.
5. **Every change is one transaction.** It is idempotent, takes a row lock on the membership, records an event, and returns an undo token where Undo is offered.
6. **History is never rewritten.** Reopening or rejoining starts a new period. Old dates stay.
7. **People act for themselves.** Completing, reopening, leaving and settings need your own sign-in. Agents can read your status but can never complete or leave for you.

## 2. Part 1: "Your settings" (every role)

The first tab in workspace settings, for owner, admin, member and viewer. Owners and admins see the workspace tabs after it.

| Section | What it holds | Stored in |
|---|---|---|
| **Your part here** | Role, joined date, status (**Active**, or **Completed · 18 Nov 2026**, with your note and "confirmed by Sam" when confirmed). Who the owner and admins are, and what your role can do in plain words. Buttons: **Complete my part** or **Reopen my part**, and **Ask for a different role** (owner gets a request with your note). | `workspace_members` + `profile_contributions` |
| **Notifications** | All, mentions and assignments only, or off. Per-event switches for events the owner allows members to change (mandatory ones show locked with the reason). **Mute for 1 day / 1 week / until I turn it back on**, the same mute as the inbox's "mute this workspace". | `notification_preferences` (exists) + mute scope with `until` (new) |
| **How your work shows** | Only when the owner turns on **Let members choose**: hide "with Claude Code" on your own work (stricter only). **Show this workspace on my profile** (exists as `show_on_profile`). | `workspace_members.hide_agent_label` (new), `show_on_profile` (exists) |
| **Your agents here** | Each agent sign-in that can reach this workspace, with its access sentence and **Change access**. **Keep my agents out of this workspace**: checked on every agent request, including "all my workspaces" agents. | `workspace_members.agents_blocked_at` (new) |
| **Your devices** | Folders linked to this workspace from the CLI, last sync, **Unlink**. | `extension_device_sessions` sync records (exist) |
| **Your view** | Default tab when you open the workspace, and compact or comfortable task cards for you. | `workspace_members.view_prefs` jsonb (new, small) |
| **Leave workspace** | Part 3. The owner sees "Transfer ownership first" with a link instead. | — |

## 3. Part 2: Completing your part

**The idea:** joining starts your work in a workspace; **Complete my part** closes it. You stay part of the history. Your profile shows when you started and when you finished.

**Complete is not Leave:**

| | Complete my part | Leave |
|---|---|---|
| You stay a member | yes, as **Completed** | no |
| You can open the workspace | yes: read, comment, and react | only as a visitor if it's public |
| Profile | **Mar – Nov 2026 · Completed**, with your note | **Mar – Nov 2026 · Left** |
| Coming back | **Reopen my part**, one click | only a new invite |

**Who can:**
- Members, admins and viewers complete their own part.
- The owner can't. They transfer ownership first, or complete the whole workspace (below).
- Organization owners and admins acting through the organization (inherited admins) aren't members of the workspace, so they have nothing to complete there.

**Step 1: the wrap-up check (a preview, nothing changes).** It shows, with real numbers:
- **Open tasks assigned to you:**
  - choose **Keep them assigned to me** (default),
  - or **Give them to <person>**,
  - or **Unassign them**.
  - Completing isn't blocked by open tasks.
- **Reviews and hand-ins waiting on you:** handed to the owner or a reviewer you pick. Default: the owner.
- **Your open work:**
  - change sets still open,
  - branches with saves not in main,
  - merge requests you opened,
  - task files only you can see,
  - unpublished doc and update drafts.
  - Each item has **Open** and **Hand over**; the default is leave it as it is.
- **What stays:** your files, versions, comments and updates, all under your name.

**Step 2: confirm.**
- "Complete your part in DeepScope AI?"
- An optional **closing note** ("What I did", up to 280 characters). It shows on your profile under the same visibility as the entry.
- The button: **Complete my part**.

**What changes (one transaction):**
- **Membership:** `completed_at`, `completion_note`, and `completed_by` (you) are set. Your role is kept, so reopening restores it.
- **Access:** you become **read-only** here, through the access resolver and its SQL mirror.
  - App, API, CLI pushes (a refusal that says "Your part here is completed: Reopen my part, or nb workspace reopen"), and realtime writes all follow.
  - Reading, commenting and reacting stay allowed (comments are conversation, not work).
- **Profile:**
  - the entry gets `ended_at` and `end_reason = completed`, and the open stage closes;
  - the timeline shows **"Mar – Nov 2026 · Completed"** with your note;
  - the About card's "Now" list drops it;
  - the profile summary is marked stale (exists).
- **Workspace:**
  - the members list shows "Completed · Nov 2026";
  - activity says "Rama completed their part · 'Built the sign-in…'";
  - assign and reviewer pickers stop offering you, and the server refuses new assignments to a completed member with "Rama has completed their part here".
  - Mentions still reach you.
- **Notifications:** your workspace mode becomes "mentions only". You can change it back.
- **Agents:** your agents here can read but not write, because they act as you and you're read-only. Nothing is revoked.
- **The owner and admins:** one inbox item, "Rama completed their part · 3 open tasks kept", with **Confirm** and **Not yet**.
  - **Confirm** sets `completion_confirmed_by/at`. Your profile shows "confirmed by Sam".
  - **Not yet** sends you their note and asks you to reopen. It never reopens on its own.
  - These are separate from `verified_*`, which means "Verified by <organization>".
- **Undo:** 10 seconds from the toast (and `nb undo` from the terminal, which has 10 minutes) removes the completion entirely. There's no new period.

**Reopen my part:**
- **Who and where:** you, from Your settings, the ⋯ menu or `nb workspace reopen`.
- **What changes:**
  - your role and write access come back;
  - `completed_*` moves into the history (§6) and clears;
  - the profile entry reopens with a **new stage** starting today, so the profile reads **"Mar – Nov 2026 · Completed"** and then **"Jan 2027 – Now"**.
- **Who's told:** the owner and admins get "Rama reopened their part".

**The owner completes someone's part:** for someone who stopped showing up.
- **Rules:**
  - same preview, choices and transaction;
  - `completed_by` is the owner;
  - from a terminal it needs "verify it's you", like removing someone.
- **What the person sees:**
  - they're told;
  - their profile says "marked completed by Sam";
  - they can reopen it.
  - Admins can do this to members and viewers, not to other admins.

**Completing the whole workspace:** the owner changes the workspace status to **completed** (exists).
- **What it does:** in the same transaction, every active member's part completes with that date, `end_reason = workspace_completed`, and the note "Workspace completed".
- **What the profile shows:** "Mar – Nov 2026 · Completed" for everyone.
- **Setting the workspace back to active:** doesn't reopen anyone. Each person reopens their own part.

**Organizations:**
- **A team workspace in an organization:** the same as above.
- **An assignment copy:** nothing to build. A copy is a task in the organization's workspace, not a workspace of its own, so the student has no part there to complete; their organization membership follows its term rules (checked in the code, 2026-11-23).
- **An organization itself:** its own membership and term rules apply (term_ended already shows Completed).

**Edge cases:**
- **Role change while completed:** refused, "Reopen their part first", so no stage opens behind the person's back.
- **Removed while completed:** the entry keeps its Completed dates. The reason stays `completed`, not `removed`, so their credit isn't taken away.
- **Leaving after completing:** allowed. The dates stay and the chip stays **Completed**.
- **Completing twice or reopening twice:** idempotent, and returns the current state.
- **Toggling:** at most 10 completes or reopens per person per workspace per day, and the owner's inbox groups repeats.
- **Account deletion and data export:** completion fields are included in the export and removed with the account like the rest.

## 4. Part 3: Leaving a workspace

This extends the existing leave route and CLI. It doesn't add a second path.
- **Who:**
  - members, admins and viewers can leave;
  - the owner transfers ownership first;
  - an assignment copy can't be left;
  - an organization uses its own leave flow.
- **Preview:** the same wrap-up check as Part 2, with the same choices. The default for open tasks here is **Unassign** (today's behaviour).
- **Confirm:** "Leave DeepScope AI? 3 open tasks become unassigned." You type the name only when you're the last admin.
- **What happens (one transaction, through `removeWorkspaceMemberInternal`):**
  - **Membership:**
    - before the row is deleted, an **undo snapshot** is kept in `undo_operations`: role, title, unit, notification preferences, profile flags, and the ids of tasks moved;
    - the membership row is deleted;
    - the profile entry ends with `end_reason = left`, unless it is already `completed`.
  - **Agents and folders:**
    - one-workspace agent sign-ins are revoked;
    - "all my workspaces" agents lose this workspace at once;
    - linked folders say "you left this workspace" on the next sync and stop. Local files stay.
  - **Personal links:** reminders, watches, stars and mutes here are removed.
  - **Access afterwards:**
    - a private workspace closes at once;
    - a public one is still visible as a visitor.
- **After:**
  - you land on Discover, and the toast offers **Undo** for 10 seconds:
    - Undo restores the snapshot;
    - it moves back only tasks that nobody touched since.
  - After that, only a new invite brings you back. That starts a new profile period.
  - The owner and admins get one item, "Rama left DeepScope AI · 3 tasks unassigned".

## 5. Part 4 (later): what each role may do

- **The tab:** a **Roles** tab for owners. One row per ability (create, edit or delete tasks, upload finals, invite, see Files, see draft updates, use agents, export) and a column each for Admin, Member and Viewer.
- **Defaults:** they match today's rules exactly. Stored in `workspaces.role_abilities` jsonb; null means today's rules.
- **Enforcement:** through the same access resolver and SQL mirror.
- **Organization workspaces:** show the organization's rules, read-only.
- **Contract test:** every permission check reads the abilities, so a test makes sure no check bypasses them.

## 6. Data (one migration, columns before code)

**`workspace_members`** (add):
- `completed_at timestamptz`, `completed_by uuid` (you or the owner), `completion_note text` (≤ 280 characters)
- `completion_confirmed_by uuid`, `completion_confirmed_at timestamptz`
- `hide_agent_label boolean default false`, `agents_blocked_at timestamptz`, `view_prefs jsonb default '{}'`
- Index: `(workspace_id) WHERE completed_at IS NULL`, for pickers and "active members"

**`workspace_member_periods`** (new, append-only history):
- columns: `workspace_id`, `user_id`, `started_at`, `ended_at`, `end_reason`, `note`, `ended_by`, `confirmed_by`, `confirmed_at`
- one row per finished period, so reopen and rejoin never lose earlier dates;
- server-only, browser roles revoked, `nb_app` granted.

**Profile tables:**
- `profile_contributions.end_reason` adds `completed` and `workspace_completed`;
- `profile_contribution_stages.source` adds `completion` and `reopen`;
- `entryStatus()` shows **Completed** for both.

**`workspaces`:** `members_choose_labels boolean default false`; for Part 4, `role_abilities jsonb`.

**Mutes:** the mute scope gains `until`. Delivery skips scopes whose `until` has passed.

**SQL access:**
- `app_private.nb_workspace_can_write()` adds `AND pm.completed_at IS NULL` for members;
- `computeWorkspaceWriteAccess()` and `getWorkspaceAccess()` do the same and set `writeBlocked: "completed"` with its sentence;
- a contract test compares the two for every role and state.

**Agent gates:** `workspaceAgentPolicy(workspaceId, userId)` and `agentWorkspaceFilter()` add the per-person block (5 callers updated).

## 7. Endpoints and commands

All routes:
- go through `personAt()` (your own sign-in, CSRF), never an agent token;
- accept `Idempotency-Key`;
- return the API's usual `{ data }` / error codes;
- are listed in `token-access.ts` with `agent: "never"` for writes.

| Route | Does |
|---|---|
| `GET /api/v1/workspaces/:id/me` | Your part: role, joined, status, completion (note, by, confirmed), what your role can do, your settings |
| `PATCH /api/v1/workspaces/:id/me` | Your settings: notification overrides, mute `until`, `hide_agent_label` (only if allowed), `agents_blocked`, `view_prefs`, `show_on_profile` |
| `GET /api/v1/workspaces/:id/me/wrap-up` | The preview for complete and leave: open tasks, reviews, open work, counts. Changes nothing. |
| `POST /api/v1/workspaces/:id/me/complete` | `{ note?, tasks: keep \| give \| unassign, giveTo?, reviewsTo?, handOver? }` → your part, plus `undoToken` |
| `POST /api/v1/workspaces/:id/me/reopen` | Reopens; refuses when you're not completed |
| `DELETE /api/v1/workspaces/:id/members` `{ leave: true, … }` | **Existing route, extended** with the same choices and an `undoToken` |
| `POST /api/v1/undo/:id` | **Existing** undo route (`undo_operations`); its inverse gains complete and leave, within 10 seconds |
| `PATCH /api/v1/workspaces/:id/members` `{ username, complete: true, note? }` | The owner (or an admin) completes someone's part. A terminal needs "verify it's you". |
| `POST /api/v1/workspaces/:id/members/:username/completion` | `{ decision: confirm \| not_yet, note? }` from the owner's inbox |
| `PATCH /api/v1/workspaces/:id/settings` `{ status: "completed" }` | **Extended:** the route takes `status` (today it takes title and description). In the app, `updateWorkspace()` already accepts `status: completed`, but there's **no button**: Part 2 adds **Complete this workspace** in the owner's settings. Either way, every active part completes. |
| `POST /api/v1/workspaces/:id/me/role-request` | Ask for a different role, with a note |

**Server actions** (same module, for the app): `getMyPartAction`, `updateMySettingsAction`, `previewWrapUpAction`, `completeMyPartAction`, `reopenMyPartAction`, `leaveWorkspaceAction` (wraps the existing removal), `completeMemberPartAction`, `decideCompletionAction`, `requestRoleAction`.

**CLI:**
- `nb workspace me` shows your part and settings.
- `nb workspace complete [-m note] [--give-tasks-to @user | --unassign | --keep] [--yes]`.
- `nb workspace reopen`.
- `nb workspace leave` gains the same choices and summary.
- `nb workspace settings` keeps the workspace's settings for owners and admins.
- All of them support `--json`.
- **MCP:** a read-only `networkbase_my_part` tool. No tool can complete or leave.

**Realtime:** `member.updated` on the workspace's live channel, so member lists, pickers and the Your part card refresh. **Docs:** `/docs/workspaces/your-part` and `llms.txt`.

## 8. Events and notifications

- **New workspace events:**
  - `member.completed`, `member.reopened`, `member.left` (normal workspaces have none today);
  - `member.completion_confirmed`, `member.completion_not_yet`, `workspace.completed`.
  - They sit in the `membership_access` group and go to the owner and admins, grouped over 10 minutes.
  - Not mandatory, so owners can turn them off.
- **To the person:** "Sam confirmed your part in DeepScope AI", "Sam asked you to reopen your part", and "Sam marked your part completed" (always delivered).
- **Activity entries:** everything above. A completion shows its note.

## 9. Gaps found in the check and how they're closed

| # | Gap in the 12 Nov plan | Closed by |
|---|---|---|
| 1 | Said members "can't leave": a leave route and `nb workspace leave` exist (unassign only, no preview, no Undo, no notice, no app button) | Part 3 extends them |
| 2 | A new settings table would duplicate `notification_preferences` and `show_on_profile` on `workspace_members` | Columns on `workspace_members`; no new settings table |
| 3 | "Done" on the profile clashed with the existing **Completed** chip | The word is **Completed** everywhere |
| 4 | The profile's `end_reason` and the stage `source` lists don't allow the new values | Migration adds them (§6) |
| 5 | A completed member who stays a member could get a new stage opened by a role change | Role changes refused while completed |
| 6 | Read-only only in the app would leave SQL and realtime writes open (45 uses of `nb_workspace_can_write`) | Both changed plus a contract test |
| 7 | "Keep my agents out" had no place to check: the agent gate only knows the workspace | `workspaceAgentPolicy(workspaceId, userId)`, and the lists filter too |
| 8 | "Mute for 1 day" impossible: mutes have no end time | `until` on the mute scope |
| 9 | Normal workspaces have no "member left" notification | New events (§8) |
| 10 | Undo of a leave impossible: the membership row is deleted | Snapshot in `undo_operations` before deleting |
| 11 | Reopen and rejoin would overwrite earlier dates | `workspace_member_periods`, plus new profile stages |
| 12 | Owner "Confirm" could be mistaken for organization verification | Separate `completion_confirmed_*` fields |
| 13 | New tasks could still be assigned to a completed member | Pickers hide them, and the server refuses |
| 14 | "Complete the workspace" was a new idea, but the **completed** status already exists (accepted by `updateWorkspace()`, with no button and not in the settings route) | Hooked into that status change; a button and the route field added |
| 15 | Organization inherited admins aren't members; Complete and Leave would break for them | Not offered to them |
| 16 | Assignment copies had no rule for when the student's part ends | Not needed: a copy is a task, not a workspace (§3, Organizations) |
| 17 | Owner marking someone completed could be abused | They're told, can reopen, profile says who; terminal needs verify-it's-you; admins can't do it to admins |
| 18 | Removing a completed member would replace "Completed" with "Removed" | The reason stays completed |
| 19 | Toggling complete and reopen could spam owners | A daily limit, plus grouped inbox items |
| 20 | No preview: the counts would be computed by each screen | One `wrap-up` endpoint used by app, CLI, complete and leave |
| 21 | Two code paths (app action and API) could drift | One domain module; actions and routes are thin |
| 22 | Agents could complete or leave for the person | Writes need your own sign-in; MCP gets a read-only tool |
| 23 | Linked folders got a generic refusal after completing | A sentence that names the reason and the way back |
| 24 | Realtime member lists would go stale | `member.updated` broadcast |

## 10. Tests (when built)

- **Unit:** `entryStatus()` and the profile dates for completed, workspace completed, reopened (two ranges) and left after completed; the stricter-only label rule.
- **Database** (disposable database):
  - **Complete and reopen:**
    - complete with each task choice;
    - Undo within 10 seconds leaves no trace;
    - reopen makes a new stage and period;
    - role change refused while completed.
  - **Owner actions:**
    - owner completes someone, confirm, and not yet;
    - workspace completed closes every part, and setting it back to active doesn't reopen;
    - an assignment copy completes on approval.
  - **Leave:**
    - leave with each choice, and Undo restores the snapshot and only untouched tasks;
    - a removed completed member keeps Completed.
  - **Access, idempotency and limits:**
    - SQL and app write access agree for every role and state;
    - agent block and read-only after completing;
    - idempotency, and the daily limit.
- **API and CLI:** every route above, refused for agent tokens; CLI output and `--json` match the app.
- **Browser:**
  - Your settings for each role;
  - complete and leave dialogs on phone and desktop, in both themes;
  - profile timeline after completing and after reopening.
- **Live check:** with the owner and a member account.

## 11. Build order

1. **Migration** (columns, periods table, new reasons and sources, SQL write check) to production first, then the access changes and their contract test.
2. **Complete and reopen:**
   - the domain module, routes, actions and CLI;
   - the Your part card;
   - the profile Completed display;
   - the owner's Confirm and Not yet.
3. **Leave, extended:** preview and choices, Undo snapshot, notice, the app button.
4. **Your settings:** notifications (with mute until), how your work shows (with Let members choose), agents (with the per-person block).
5. **Workspace completed** hook, and the assignment-copy rule.
6. **Devices and view.** Then Part 4, Roles.

## 12. Done (2026-11-23, live in 30c2f7454)

**Commits:** 5876f0b89 (0114), e3f7c9051 (backend), 8fcb25ffd (security fix), e8c86ee34 (app screens), 7cfe46700 and c45a9d3c1 (profile), 8b2d9ca27 (CLI and MCP), e9fa4f5b1 (docs), 5f3d6ed45 (pickers), and the Part 4 commit after them.

| Part | Built | Where |
|---|---|---|
| §6 Data | 0114: membership columns, `workspace_member_periods`, new end reasons and stage sources, `members_choose_labels`, `role_abilities`, the SQL write check, the assign-a-completed-member trigger, `nb_workspace_role_allows()` with the task and file-upload policies | `drizzle/0114_member_journey.sql` |
| §1 Principles | One domain module; actions and routes are thin; each change is one transaction with an event and an undo | `src/lib/workspaces/member-journey.ts`, `src/app/actions/workspace/member-journey.ts` |
| Part 1 Your settings | First section of Settings for every role: your part, notifications (all / mentions / off, each notice, mute 1 day / 1 week / until), how your work shows (hide the label when the owner lets members choose; show on profile), your agents (keep my agents out, Change access), your devices, your view (first tab, compact cards), leave | `YourSettingsSection.tsx` |
| Part 2 Completing | Wrap-up check, closing note, read-only in the resolver and in SQL, profile Completed, mentions only, owner Confirm / Not yet, Undo, reopen with a new period, owner or admin completes someone, Complete this workspace, role change refused while completed, removed or left keeps Completed, 10 a day | domain module, `CollaboratorCard.tsx`, `CompleteWorkspaceCard` |
| Part 3 Leaving | Same check, unassign or give, snapshot and Undo, Left period, one-workspace agents revoked, stars, watches, reminders, pins and mutes removed, owner told; a linked folder says you left | `leaveWorkspace`, manifest route |
| Part 4 Roles | Roles tab for the owner: 9 abilities × Admin, Member, Viewer; defaults are today's rules; viewers never get write abilities; organizations show their own rules read-only. Checked at create, edit (`lockTaskForWrite`), delete, upload, invite, Files, doc drafts, agents and export, and mirrored in SQL | `role-abilities.ts`, `RoleAbilitiesSection.tsx` |
| §7 Endpoints | All routes in the table, `/projects` aliases, token rules, CSRF, idempotency, `undoToken` | `src/app/api/v1/workspaces/[id]/me…` |
| §7 CLI and MCP | `nb workspace me`, `complete`, `reopen`; `leave` with the check and choices; read-only `networkbase_my_part` (people pack) | `packages/nb-cli/lib/commands/docs.mjs` |
| §7 Realtime, docs | `member.updated` refreshes Your settings, the members list and pickers; `/docs/workspaces/your-part` and `llms.txt` | `useMemberUpdates.ts` |
| §8 Events | 7 event keys, the person's own notices | `workspace-policy.ts` |

**Changed from the plan while building:**
- **Devices:** the server keeps no record of which folder is linked where, so Your devices lists your CLI and editor sign-ins with Sign out; a folder unlinks with `nb unlink` in it.
- **"See draft updates"** became **"See and edit doc drafts"**: update drafts are each person's own, so the real draft gate is the doc's.
- **Event keys** are `members.completed`, `members.reopened`, `members.left`, `members.marked_completed`, `members.completion_decided`, `members.role_requested`, `members.workspace_completed`.
- **Two gaps found and closed:** task edits (`lockTaskForWrite`) and the file-upload transaction read the member's role directly, so a completed member could still edit tasks and upload; both now refuse, and both read the role abilities.
- **Security review fixes:** undoing someone else's completion re-checks that you're still their owner or admin; reviews can't be handed to a viewer or a completed member; a note someone else wrote when marking your part completed shows only to you, never on your public profile.

**Added in the double-check against this report:**
- Activity entries for completing (with the note, members only), being marked completed, reopening, being confirmed, leaving, and completing the workspace.
- The wrap-up check lets you pick who takes your reviews (the owner by default) and links each open item (change set, branch, merge request, doc draft).
- The ⋯ menu has **Your settings**, or **Reopen my part** when your part is completed.
- A linked folder says why it can't push: "Your part here is completed" (hint `nb workspace reopen`), or "You left this workspace" (hint `nb unlink`).

**Not built, and why:**
- **Hand over** on each open item: there's no way today to give someone else your change set, branch or merge request. Open is there; handing over needs an ownership transfer for those three first.
- **"Task files only you can see"** in the check: workspace task files are visible to the workspace, so there's nothing private to list.
- **Confirm and Not yet inside the inbox item:** the inbox item links to the members list, where Confirm and Not yet are.
- **Not yet in the activity feed:** it stays between the owner and the person.

**Tests:** unit 3,704 (profile dates, label rule, pickers, roles contract, tab rules, activity wording); database 15 new on a disposable database (member journey 12, role abilities 3, including SQL and app agreeing for every role and ability), and the full database suite 1,242 of 1,244 (the 2 left are the workflow session's bug-closing tests, not this work); CLI 356.

**Still open:**
1. ~~Apply 0114 in production~~ done 2026-11-23: the 8 membership columns, both workspace columns, the periods table, the role function, the trigger, the 3 task policies and the completed check in the SQL write function are all there. Deployed 2026-11-23: 14 commits cherry-picked onto origin (30c2f7454), build passed, web and worker SUCCESS; live: the docs page and llms.txt serve, the new routes answer 401 signed out and refuse writes without CSRF, workspace pages render, no errors in the web logs.
2. Release the CLI with the new commands (needs your go-ahead).
3. Signed-in check in Chrome, 2026-11-23, as the owner in wt-test-a2-3 (desktop, light):
   - **Passed:** Your settings shows first with every part; mute for 1 day and turn back on; Your view saves; Roles shows today's rules with viewer writes locked, a change saves with its toast, Back to the default rules resets it; Let members choose and Complete this workspace are there; the profile loads; no console errors. Test changes were put back.
   - **Found and fixed (ccc24ae93, local, not deployed):** Your view was saved but not applied for the owner (only members); "Delete tasks" still said "Today only the owner deletes tasks" after the owner turned it on.
   - **Not checked:** complete, reopen, leave, Undo, Confirm and Not yet need a second (member) account; Complete this workspace wasn't pressed, as it ends the owner's own entry; dark theme and phone.
4. Live check with an owner and a member account.
