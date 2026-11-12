# Member settings in a workspace: concept (parked)

**Status:** concept only, agreed to wait (2026-11-12). Build after the current CLI and agents round (M1–M9). Nothing here is built.

**Why it came up:** during the M2 live check the member account opened workspace settings looking for "Show when agents helped" and found nothing. Today members, viewers, and every non-owner except admins get no workspace settings at all, and a member can't leave a normal workspace (only organizations have a leave flow, `leaveOrgAction`).

## Principles
1. **Two kinds of settings, never mixed.** The workspace's settings belong to the owner (and admins where allowed). A person's settings for a workspace belong to that person and only affect them.
2. **A person's choice can only be stricter than the workspace's,** never looser. A member can hide their own "with Claude Code" if the owner lets them, but can't show it where the owner chose No one.
3. **Every role sees "Your settings"**: owner, admin, member, viewer, and the people in organization workspaces.
4. **The server decides.** Each choice is stored per person and workspace and applied on read, like the Part B rule.
5. **Same in the app and the CLI** (`nb workspace settings`, `nb workspace leave`).

## Part 1: "Your settings" in every workspace
A tab in workspace settings that every role sees first. Owners and admins also see the workspace tabs after it.

| Section | What it holds |
|---|---|
| **Your place here** | Your role, who the owner and admins are, and in plain words what your role can do ("You can create and edit tasks, add files, and comment. You can't invite people or change settings"). **Ask for a different role** sends the owner a request with an optional note. |
| **Notifications from this workspace** | All, Only mentions and things assigned to you, or Off. Then per-kind switches: tasks assigned, comments on your tasks, mentions, files changed, updates posted, sprint start and end, reviews. Mute for 1 day, 1 week, or until turned back on. Built on the existing mute scopes, so the inbox's "mute this workspace" and this page are the same setting. |
| **How your work shows** | Only when the owner turns on "Let members choose": "with Claude Code" on your work follows the workspace, or is hidden on your work (stricter only). Show your name on the public members list (public workspaces). Show you in "Updated by" on the workspace card. |
| **Your agents here** | Every agent sign-in that can reach this workspace (one-workspace or All my workspaces), each with its sentence and **Change access**. **Keep my agents out of this workspace**: a per-person block, checked on every agent request, even for All my workspaces. |
| **Your devices** | Folders linked to this workspace on your computers (from the CLI), last sync, and **Unlink** for each. |
| **Your view** | Default tab when you open the workspace, star or pin it in the sidebar, sidebar order, and compact or comfortable task cards for you only. |
| **Leave workspace** | See Part 2. Hidden for the owner, who sees "Transfer ownership first" instead. |

## Part 2: leaving a workspace, end to end
**Who can leave:** members, admins and viewers. The owner transfers ownership first; the page links to it. In an organization, leaving the organization uses the existing flow. An assignment copy can't be left, because it belongs to the class.

**Before leaving, the page shows what happens, with your real numbers:**
- **Tasks assigned to you (N open):** choose Unassign them, Give them to <person>, or Keep them assigned (the owner sees them as "assigned to someone who left").
- **Reviews waiting on you (N):** handed to the owner, or to the reviewer you pick.
- **Your files, comments, versions and updates stay,** under your name, because they're part of the work.
- **Drafts only you could see (N):** kept, deleted, or handed to the owner. You choose; the default is kept.
- **Agents:** sign-ins limited to this workspace are revoked. All-workspaces agents lose it at once, because they're checked on every request.
- **Linked folders:** they say "you left this workspace" on the next `nb sync` and stop syncing; local files stay.
- **Reminders, watches and stars here are removed.** Notifications stop.
- **Private workspace:** you lose access at once. **Public:** you can still view it as a visitor.

**Confirm:** "Leave DeepScope AI? 3 open tasks go back to the owner." One button names the workspace. Typing the name is only required when you're the last admin.

**After leaving:**
- You go to Discover, with a toast offering **Undo** for 10 seconds (rejoins with the same role, tasks reassigned back).
- After that, only a new invite brings you back.
- The owner and admins get one inbox item, "Rama left DeepScope AI · 3 tasks went to you", and activity shows it.

**CLI:** `nb workspace leave <ws>` prints the same summary, asks once, and takes `--give-tasks-to <user> | --unassign` and `--yes`. With `--json` it returns the same counts.

## Part 3 (later): what the owner lets each role do
The second reading of the idea. It isn't needed for Part 1, but it fits the same page.
- **A "Roles" tab for owners:** one row per ability, and a column each for Admin, Member and Viewer. Abilities: create tasks, edit others' tasks, delete tasks, upload final files, invite people, see Files, see Updates drafts, use AI agents, export.
- **Defaults** match today's rules exactly, so nothing changes until the owner edits a switch.
- **Organization workspaces** keep the organization's role rules; this tab shows them read-only.
- **Risk:** every permission check has to read the switches. It needs a contract test, like the label guard in Part B.

## Data
- **`workspace_member_settings`** (workspace_id, user_id, notify jsonb, label_hide boolean, agents_blocked boolean, default_tab, starred, created_at, updated_at). Per person, browser roles revoked, `nb_app` granted.
- **`workspaces.members_choose_labels`** boolean, default false.
- **Part 3:** `workspaces.role_abilities` jsonb (null = today's defaults).
- **Leave:** `leaveWorkspaceAction(workspaceId, { tasks: "unassign" | "give" | "keep", giveTo?, drafts })` in one transaction. It records a `workspace_member.left` event and revokes one-workspace agent sign-ins.

## Tests (when built)
- Each section for each role; stricter-only label rule; the agent block on every request.
- Leave with each task choice and each draft choice; Undo inside 10 seconds; owner blocked; assignment copy blocked; private vs public afterwards; CLI parity.
- Live check with the owner and member accounts.

## MVP when we start
1. "Your settings": role summary, notifications, Leave (Parts 1 and 2 minus devices and view).
2. Then agents and how your work shows (with "Let members choose").
3. Then devices and view; Part 3 last.
