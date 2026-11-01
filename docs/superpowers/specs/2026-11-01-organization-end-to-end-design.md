# Organizations: End-to-End Concept

**Date:** 1 November 2026
**Status:** Proposal for the owner's review. Nothing here is built.
**Builds on:** `docs/organization-workspace-parity-report.md` (audit) and `docs/organization-concept-report.md` (the earlier locked concept). Where this document differs from a locked decision, it says so in section 13.

## 1. Intent

An organization is a workspace with more powers. Someone who knows a workspace should already know how an organization works.

The owner's direction:

- Every tab, button, form and card is designed end to end, including how it looks when empty.
- A person who was removed must not keep showing as a contributor.
- Empty states should teach, such as: plan a sprint and it appears here as a stage.
- Invite, copy and email should feel like real product, not plain text.
- The profile must show organizations and their workspaces properly.
- The structure behind the screens must be as clean as the screens.

### Goals

- **One product:** shared screens, not parallel ones.
- **Honest records:** a profile says only what is true today.
- **No dead ends:** every empty screen explains itself and offers the next step, for the right person.

### Not doing

- No new organization types, billing, or analytics.
- No real-time presence for organizations. That was removed on purpose.
- No "activity feed" as a product of its own. Activity stays a small card.

### What would count as failure

- Organizations gain more special screens.
- A removed person still appears as verified or current anywhere.
- A member sees another member's work or marks.
- A simple class of one teacher has to wade through options meant for a 2,000-person company.

## 2. Five rules for every screen

1. **Same screen first.** If a workspace has it, the organization uses that component and adds to it.
2. **Six states, always designed.** Loading, empty, one item, many items, error, and no permission.
3. **Each person sees their own version.** Owner, admin, member, guest and visitor are designed separately, not by hiding bits.
4. **Add options only at the moment they matter.** A form shows what most people need, and the rest appears once it is relevant.
5. **Plain words.** The organization's own names (Teacher, Student) replace "owner" and "member" everywhere people read them. "Project" is never shown.

## 3. The people

| Person | Example | What they need | Tabs |
|---|---|---|---|
| Owner | Teacher | See who is behind, and act in one click | All |
| Admin | TA | Same, except ownership and admins | All |
| Member | Student | What is due, where materials are, proof they submitted | Overview, About, Documents, Updates, Sprints, Tasks, Files, Workspaces |
| Team lead | Group lead | Their team's space, and what the organization expects | Same, plus their workspace |
| Guest | External examiner | Read what they are allowed, without breaking anything | Overview, About, Documents, Updates, and any others allowed |
| Visitor | Prospective student | Decide whether to join | About, Documents, Updates |
| Former member | Removed student | A clear explanation, and nothing else from inside | About, if public |

The Members and Settings tabs stay restricted as they are today. Exact tab rules should be confirmed against `isWorkspaceTabVisibleToViewer` during the build.

## 4. Membership and credit

This is the back-bone of your removal example.

### 4.1 What happens today

Traced through the code:

| Step | Behavior | File |
|---|---|---|
| Join | A contribution entry is created automatically, including a verified date | `collaboration.ts:1134` |
| Remove | `removeFromOrg` removes them from child workspaces and the organization, and `endProfileWorkspaceContributionMembership` sets an end date only | `members.ts:125`, `collaboration.ts:1267` |
| Reason | Whether they left or were removed is **not stored on the entry** | Same |
| Verification | Stays after removal, as the old concept specified | Concept §24.5 |
| Organization chip | The profile's chip row shows every organization entry and **does not check the end date** | `OrgChipsRow.tsx:8` |
| Role | "Owner", "Member" and "Contributor" are treated as generic and removed from the title, so with nothing else set it shows **"Contributor"**. Your Teacher role shows as "Contributor" for this reason. | `contribution-position.ts` |

Other people only see an entry once it is published and public. However, a person's own profile shows everything looking the same as public, so it reads as though they are still part of the organization.

I could not check production data for a specific removed person in this session, because that read was declined. The code alone explains what you saw.

### 4.2 The principle

**Joining is not contributing.** A record appears publicly only when someone did something, and it always says how it ended.

### 4.3 Membership states

| State | Profile: others see | Profile: the person sees | Inside the organization |
|---|---|---|---|
| Invited or requested | Nothing | Nothing (it lives in My work) | Pending list |
| Joined, nothing written | Nothing | Draft: "Add your contribution" | Member |
| Active, published | Chip and entry, "Student · Oct 2026 – Present" | Same, with Edit | Member |
| Role changed | History: "Student → TA" | Same | New role |
| Left, published | Entry, "Left Nov 2026", no chip | Same | Gone; their past work stays |
| Removed | **Nothing** | Private note: "Removed Nov 2026", their own words kept | Gone; admins keep the history |
| Removed and blocked | **Nothing** | Same as removed; the block is never mentioned | Can't rejoin |
| Term ended or archived | Entry, "Completed Dec 2026" | Same, with a nudge to write it up | Read only |
| Show on profile turned off | Nothing | Same as active, "Hidden" | Unchanged |
| Organization deleted | Name kept with no link, "No longer on NetworkBase" | Same | Gone |
| Rejoined | Same as active; old period kept in history | Same | Member |

Rules that follow:

- **Chips show current members only.** A chip means "is part of this now."
- **Removal withdraws verification**, because verification speaks for the organization.
- **A person's own words always stay theirs.** Removal hides them from others. It does not delete them, and they stay in the person's data export.
- **Removal of nested work:** a removed person's child workspace entries follow the same rule.
- **Leaving keeps credit.** Someone who finished and left did nothing wrong.

### 4.4 Role labels

Show: **organization role name · their title**, for example `Teacher · Course Instructor`.

- "Contributor" appears only when no role can be found at all.
- The role comes from the organization's own names, so a renamed role updates here too.

### 4.5 Profile design

**Organizations chips** sit at the top: logo, name, role. Current only.

**Contributions** is split into two groups, so organizations no longer blend in with everything else:

```
ORGANIZATIONS
[CS] CSE 3B · Data Structures 2026            ✓ Verified by CSE 3B
     Teacher · Course Instructor · Oct 2026 – Present
     "Teaching the course and running lab sessions…"     Read contribution
     │
     ├─ [TF] Team Falcon: Hash table library
     │       Team lead · Nov 2026 – Present
     │       "Built the open addressing module…"         Read contribution
     │
     12 of 12 assignments · 5 sprints  (only if turned on)

WORKSPACES
[PO] Ponytail · Tester · Jul 2026
```

Details:

- **Status chip:** Current, Left, Completed. Nothing for the normal case on other people's view.
- **Nested workspaces** use one line and a rail, and collapse after three with "Show 4 more".
- **Empty nested entries** (no words written) show one line only.
- **On your own profile:** drafts are grouped at the end under "Not on your profile yet", with Publish, so a draft can't be mistaken for a public entry.
- **Visitors** never see a workspace that is private to the organization, beyond what §24.6 of the old concept allows.

### 4.6 Edit profile

The contribution editor gets one list, in the same structure as the profile:

- **Left panel:** Organizations, each with its workspaces nested, then Workspaces, then Drafts. Every row has a status.
- **Facts from the record, locked:** organization, role, start and end, verified. They explain why they're locked ("Set by CSE 3B").
- **Your own, editable:** story, skills, images, featured.
- **Publishing is per entry.** One "Show on my profile" switch covers the organization and its nested workspaces, with per-entry control under it.
- **Helpers:** "Start from my work" and "Start from About" stay. Work record stays off by default.
- **Removed entries:** read only, marked "Private to you", with Delete. They can't be published.
- **Mismatch:** if they ask to change a locked fact, "Ask an admin" opens the existing message link.

### 4.7 What removal does everywhere

| Area | Result |
|---|---|
| Access, sidebar, search | Gone at once |
| Their assignment copies | Archived, removed from counts; submissions stay for admins |
| Tasks assigned to them | Unassigned, with a "was assigned to X" note in history |
| Files they uploaded | Stay; shown with their name |
| Posts and comments | Stay |
| Org channels | Removed from channels |
| DMs | Unaffected |
| Workspace they own | Removal is blocked until transferred, as today. The screen should offer Transfer right there |
| Notifications | Removed; they get one final notice |
| Email | The reason is included only if the admin wrote one |
| Links they saved | "You're no longer in CSE 3B", with About if it's public |
| Person card, "shared organization" | Disappears |

The admin's removal dialog should show this as a short list before confirming, using the counts already calculated in `collaborator-lifecycle.ts`.

## 5. Shared building blocks

These are built once and used everywhere. Each is a small product of its own.

### 5.1 Section

Micro label, hairline, optional action on the right, then a card. Already exists as `RailSection`. Long titles cut off with "…", fixing the 21px overflow.

### 5.2 Row

The one list row for Overview, About, and the organization lists.

- **Parts:** icon or avatar, title, one quiet line, right side (chip, count, time, or arrow).
- **States:** default, hover, focus, unread dot where it applies, done.
- **Rules:** the whole row is the link, title cuts off at one line, 44px tall on touch.

### 5.3 Activity item

Used on Overview, About, workspace Overview, and Updates' recent activity. Replaces both current designs.

| Kind | Icon | Example |
|---|---|---|
| Sprint | `IterationCcw` | CO1 started |
| Workspace | `FolderKanban` | Team Falcon was created |
| Join | `UserRoundPlus` | Asha joined |
| Announcement | `Megaphone` | Welcome to CSE 3B |
| Document | `BookOpenText` | Syllabus was updated |
| File | `FilePlus2` | Rubric was added |
| Assignment | `ClipboardCheck` | Lab 1 was assigned |
| Submission | `CheckCircle2` | 12 submitted Lab 1 |
| Task | `ListTodo` | Rubric moved to In progress |
| GitHub | `GitBranch` | Pushed to GitHub |

- **Layout:** icon, one or two lines of text, time underneath in small mono. Same as a workspace today.
- **Time:** real event time, always. Sprints use `started_at`, not the planned date. Joins are per person, or one grouped row with the time of the latest ("3 people joined").
- **Grouping:** same kind in the same hour is one row.
- **Privacy:** same rules as `activityVisible`.
- **Filters:** All, Assignments, People, Files and docs, Workspaces become a small menu on the section, on Overview only. The rail versions show the latest 5 with "See all".
- **Empty:** "Activity will show here once people start working."

### 5.4 Empty state

A teaching pattern with four parts:

1. **Preview:** a faint picture of what will be here, not a generic icon.
2. **What it is:** one sentence.
3. **How it fills:** one sentence, such as "Plan a sprint and it appears here as a stage."
4. **Action:** one button, only for someone who can do it.

Each role gets its own line. A member sees "Your teacher hasn't planned sprints yet", not a button they can't use. Visitors see nothing for sections with no public value.

### 5.5 Invite panel

One component replaces today's three versions (Invite dialog, About right column, Members right column). See section 7.11.

### 5.6 Task form, sprint form, and detail panel

Single shared components. See 7.5 and 7.6.

### 5.7 Status chips

One vocabulary across the app: Planning, Running, Completed; To do, In progress, Submitted, Returned, Done, Missing, Excused. One color each.

## 6. Lifecycle of an organization

| Stage | What people see |
|---|---|
| Creating | The 5-step wizard, already built. Fix the typo and the Discover copy. |
| Just created | A "ready" screen with the invite panel and a next step, then Overview. |
| Setting up | Overview shows a Setup card with steps, progress, and links. Disappears when done, and can be dismissed. |
| Running | Overview becomes the daily view. |
| Term ending | Prompts: review open work, verify members, archive. Members get "Write up your contribution". |
| Archived | Everything read only, with one notice. Credit changes to "Completed". |
| Scheduled for deletion | Banner with Restore. |
| Deleted | Profiles keep the name with no link. |
| Suspended | Read only, with the reason for members. |

## 7. Tab by tab

### 7.1 Header (all tabs)

Built. Remaining:

- Deploy the image gap fix.
- Visitors see "Request to join" or "Join" as the primary button.
- Replace the unexplained `1 · 0` numbers with labeled tooltips and the same style as a workspace.
- Guest and former member versions need a check.

### 7.2 Overview

**Purpose:** "What needs me today?" Not a description. That's About.

| Section | Owner and admin | Member | Empty |
|---|---|---|---|
| Pinned announcement | Row, dismissible | Same | Hidden |
| Setup | Steps with progress `2 of 5`, each a link | Hidden | Goes away when complete |
| Needs you | Requests, submissions to review, overdue workspaces | Their due and returned work | "You're all caught up" with a check icon |
| This sprint | Name, days left, progress bar, assignment rows with counts | Their own items and status | Plan your first sprint, with preview |
| Coming up | Date tiles, label, next 7 calendar days | Their own items | "Nothing due in the next 7 days" |
| Activity | Section 5.3 | Same, by privacy rules | Teaching line |
| Right: Workspaces | Rows with avatar, updated time, attention chip | Their own first | "Create the first workspace" |
| Right: People | Photos, count, joined this week, requests | Photos and count | Invite panel |

**Layout:** same two columns as a workspace's Overview, with the same section design. Member and admin order differs only in the content.

### 7.3 About

**Purpose:** "What is this, and should I join?"

- **Main:** welcome note (members), About, Who it's for, What happens here, Workspaces.
- **Right:**
  - **Stages** (see below)
  - **Recent activity**, using section 5.3
  - **Per-person card:** Invite panel, "You're a Student · Joined Oct 3", or Join
  - **Owner and admins:** avatar, name, title, Message
  - **Details:** handle, your role, time zone, since

**Stages, all states:**

| State | Admin | Member | Visitor |
|---|---|---|---|
| No sprints | Ghost timeline with 3 faded stops. "Your sprints become stages here." **Plan your first sprint** | "Stages appear once sprints are planned." | Hidden |
| One sprint | That stop plus a faint "next" stop, and "Add the next sprint" | One stop | One stop |
| Many | Full timeline with current marked | Same | Same, if Sprints is public |
| All done | All checked, "Completed Dec 2026" | Same | Same |

Stages is read only here. Clicking a stop opens that sprint.

**Member and Admin empty prompts:** "Add who it's for" stay, as small inline links.

### 7.4 Documents

Same screen as a workspace: content on the left, list on the right.

- **Add document:** `+` in the rail opens a dialog: title and a choice of Blank, Syllabus, or Rubric templates, plus pick from Files. On save, **stays in Documents and opens the document for editing**, right away. The file is created in the background.
- **Right rail:** groups, per-doc access chip, "Pin to About". Admin tools are in the doc's `⋯` menu, not beside it.
- **Empty:** a faint page preview. "Documents are where your syllabus and guides live." **Add document** for admins; members see "Nothing shared yet."
- **Child workspace:** read only "From CSE 3B" group in the rail. Built.
- **Visitor:** only documents marked public. An empty draft is never public. (The empty `Course syllabus` I created tests this.)

### 7.5 Tasks

**Purpose:** one board for all work.

**"New task" button** is the only create button. The header's `+ New` menu has Task, Announcement, Sprint and Workspace, with Task opening this same form.

**The form, top to bottom:**

| Field | Default | Notes |
|---|---|---|
| Title | Empty | Required |
| Description | Empty | Same editor |
| **Assign to** | Unassigned | People picker with: a person, Everyone, a team, each workspace, selected workspaces |
| Sprint | Current sprint | |
| Status, Priority | To do, Medium | Hidden when assigning to many |
| Due | Empty | Required when assigning to many |
| Points | Hidden if the organization hides them | |
| Subtasks | Empty | Called "Steps" when assigning to many; copied to everyone |
| Attach | Empty | Reference files |

**When "Assign to" is many people, one section appears:**

- **What they hand in:** File, Link, Text, or Nothing.
- **Review:** "Check each submission before it's done." On by default.
- **Late work:** Allowed, Until a date, Not allowed.
- **Tell people:** Share in #general, Post an announcement.
- **Buttons:** Save as draft, and **Publish to 40 people** with the real count.

**Board:**

- Single-person tasks work as they do in a workspace.
- An assignment is **one card** in its column: title, due, and a progress badge `12/40`. It never appears as both a list and a card.
- **Members** see their own copy as a normal card, with a Submit button.
- **Filters:** All tasks, Sprint, Backlog, In review, Assignments, Mine.
- **Opens on the first column**, fixing the sideways bug, which also affects workspaces.
- **Completion note** moves into the board's `⋯` menu.

**Opening an assignment card** uses the same side panel, with a Roster section:

- Counts: Done, Submitted, Missing, Excused.
- Per-person rows with status, a review button, and Remind.
- Bulk: Approve all submitted, Remind missing.
- Close and Delete in the panel's `⋯` menu.

**Empty board:** the same empty columns as a workspace, with "Create the first task" in To do. Members: "Nothing assigned yet."

**One-person organization:** "Publish to 0 people" is confusing, so the form explains: "No students yet. Save as draft, or share the invite." Publishing still works, and new joiners get a copy.

**Behind it:** the existing server actions and permissions stay. The form picks which to call. Whether new joiners get copies automatically should be confirmed in `assignments.ts`.

### 7.6 Sprints

**"New sprint"** is the only create button, in the left column, as on a workspace. "Plan a series" is removed as a button.

**The form:**

| Part | Field | Notes |
|---|---|---|
| Basics | Name, Goal, Description | |
| Schedule | Start, End, 1/2/4 weeks | |
| **Repeat** | Off, or "Repeat for N sprints", with naming preview: `CO1, CO2, CO3` | Replaces Plan a series |
| Workspaces (organization only) | Share with: All, Selected, None. Create matching sprints: on or off | Plain words replacing the current checkboxes |
| Start | "Start automatically on the start date" | |
| Tell people | Post an announcement | Today this only appears on Start now |

**Sprint page:** same layout as a workspace.

- **Header:** name, goal, status chip, dates. The "Started Nov 1" and "Starts automatically" contradiction is fixed: Planning says "Starts Nov 1", Running says "Started Nov 1".
- **Numbers:** progress, days left, tasks, files.
- **Materials:** same.
- **Work:** the task list, with assignments shown as rows with counts. The separate Assignments block goes away.
- **Workspaces** (organization only): one line, "3 of 5 workspaces linked" with a link, opening a small panel. Hidden when there are no workspaces.

**Empty tab:** faint timeline preview. "Sprints break your term into steps. Each one shows up as a stage on About." **Plan your first sprint**, with the Repeat option mentioned for classes. Members: "No sprints planned yet."

### 7.7 Files

Same screen as a workspace.

- **Left panel:** All files, Task files, Recent, Starred, Trash; **Sprint materials** and **Submissions** (the organization type's own word) added as views. Storage bar at the bottom.
- **Folder access:** in each folder's `⋯` menu: "Who can see this?" Members, Admins only, Public. A small lock chip on the row. "Use as template" sits in the same menu.
- **New organization:** starter folders stay, with "Staff" chip visible.
- **Empty:** "Share materials here. Everyone in CSE 3B can see what you add." Upload. Members: "No files shared yet."
- **Delete warning:** "In use by sprint materials" stays.

### 7.8 Updates

Same screen as a workspace.

- **Composer:** one box at first. Once writing, it reveals: Announcement or Discussion, audience, Also email, Pin, and Comments off.
- **Copy:** "Announcements and discussions for CSE 3B", and "Share something with CSE 3B."
- **Visibility:** default is Members. Public is a deliberate choice, with "Also on Discover" spelled out.
- **Filters:** All, Announcements, Discussions, From workspaces. Same style as other filters.
- **Empty:** a faint post. "Post your first announcement. Everyone gets notified." Members: "No announcements yet."
- **Right:** Recent activity using section 5.3.

### 7.9 Workspaces

**Purpose:** "How are the teams doing?"

- **Summary line:** clickable and correct: `5 workspaces · 1 needs attention · 1 quiet · 2 people not in one`.
- **Controls:** Search, Status, Sort, Mine, List or Cards, New workspace. A "Filters" button holds Visibility, Stage, Owner, and Sprint.
- **Row:** avatar, name, visibility chip, lead, member count, stage; open, overdue, and in-review counts; `Updated by X · time`, not cut off; attention reason in plain words.
- **Bulk (admins):** Remind leads, Archive.
- **Empty:** two faint cards. "Teams work inside workspaces. Each has its own tasks, files and updates." **Create the first workspace**. Members: "You're not in a workspace yet", with Browse.

### 7.10 Members

- **Roster:** Search, Role, Workspace, Status, Sort. Row: avatar, name, role chip with the organization's words, title, workspaces, work line, last active.
- **Right:** Requests, Invite panel (section 7.11), Summary with correct plurals.
- **Member panel:** role, title, work, activity, Message, Change role, Verify, Remove.
- **Remove dialog:** what happens (section 4.7), reason (optional, sent as written), and "Block from rejoining". If they own a workspace, offers Transfer in place.
- **Verify:** one at a time or in bulk, with what it covers: "Role and dates, not their words."
- **Empty:** Invite panel, with the owner as the only row and the line "You're the only one here so far."

### 7.11 Invite panel

Replaces today's plain line in About, the row in Members, and the dialog. Same component, sized for its space.

```
INVITE PEOPLE                                       ⋯
┌───────────────────────────────────────────────┐
│  N Z W H M 9                       [Copy code]│
│  networkbase.in/join/NZWHM9        [Copy link]│
└───────────────────────────────────────────────┘
[ Invite by email ]
Anyone with this code can join.  Joining: Needs approval
```

- **Code:** large mono, tap to copy, with a "Copied" check right there, not just a toast.
- **Link:** full link with its own copy button.
- **Invite by email:** opens a dialog with a chips input (paste many), role, optional title, optional workspace, optional message, and a live preview of the email. Sends with a count: "Invite 12 people". Bad addresses are called out inline.
- **`⋯` menu:** New code (with a warning that the old one stops working), Turn off joining with a code, and Join settings.
- **Pending invites:** count with a link. Each has Resend and Cancel in Members.
- **Off state:** "Joining by code is off", with Turn on.
- **Who sees it:** owners and admins only. Members with "Members can invite" see a smaller version.

**The join page** gets the same care: logo, name, type, member count, a tagline, who runs it, "Request to join" or "Join", and a clear explanation of what the person gets. Handles: expired code, off code, already a member, removed and blocked (a neutral "This code isn't available"), and signed out.

### 7.12 Settings

Same layout and starting point as a workspace.

- **Menu order:** Workspace details order first, with organization items in place: Details, Organization profile, Links, Access and visibility, Joining, People and roles, Workspaces, Work, Members, Documents, Updates, Stages and workflow, Files and storage, Notifications, Privacy, My membership, Management.
- **Menu title:** "Organization settings".
- **Opens on:** Details for owners and admins, My membership for members.
- **Plain words** for every setting, each with a one-line explanation and who it affects. Each section shows "Saved by X · time", which already exists.
- **Danger:** Archive, Transfer, Delete at the end, separated.

## 8. Workspaces inside an organization

- **Header:** "Part of CSE 3B" under the buttons. Built, not yet seen live with real data.
- **Overview:** About first, then What's happening.
- **Tasks:** group assignments carry a `From CSE 3B` chip.
- **Documents and Files:** read-only "From CSE 3B" sections.
- **Sprints:** "Inside CO1" when linked.
- **Updates:** "Share to CSE 3B".
- **Admins from the organization:** shown as such, with what they can and can't do.
- **Moving in or out:** preview of what changes, and credit is labeled "with CSE 3B (until Nov 2026)".

## 9. Everywhere else

| Place | Change |
|---|---|
| Sidebar | Row design is live. Fix the plus button link. Stop the "No workspaces yet" flash by showing a loading row. Fix the long-title Rows. |
| Top bar search | Placeholder reads "Search this organization…". Results group by kind. Already scoped; check privacy for removed people. |
| Discover | Organization card uses the same card, with type chip, member photos, and workspace count. A new organization appears after 3 members and 7 days, as today. |
| Notifications | Consistent wording, using the organization's role names. Each item goes to the exact place. |
| Emails | Same voice as the app. Removal email reviewed. Invite email previewed in the dialog. |
| Messages | `#general` and team channels grouped under the organization. Removal clears them. |
| My work | Assignments appear with status and Submit. Invites and requests stay in one place. |
| Person card | Shared organization chip only for current members with it shown. |
| Network | Same rule. |
| Trust and safety | Reports on organization content route to admins, then staff, as built. |
| Account deletion | Owners are blocked until they transfer, as built, with a clear path. |
| Phones | Every section stacks, the board scrolls by column, forms become full-height sheets. |
| Dark mode | Empty-state previews and chips checked in both themes. |

## 10. Behind the screens

"Well-structured on the back side" means:

### 10.1 Data

- **Add `end_reason` to `profile_contributions`:** `left`, `removed`, `term_ended`, `org_deleted`, or null. Set in `endProfileWorkspaceContributionMembership`, passed down from `removeFromOrg` and `leaveOrgAction`. Existing ended entries stay null and count as "left", because their real reason wasn't recorded.
- **Clear on rejoin:** confirm `upsertProfileWorkspaceContributionFromMembership` handles this and keeps history as a stage.
- **Public query filter:** removed entries are never public, enforced in the query at `collaboration.ts`, not only in the screen.
- **Verification:** cleared on removal, with `verification_revoked_reason` set.
- **Activity times:** use `workspace_sprints.started_at` and real join times.

### 10.2 One way to do each thing

| Today | After |
|---|---|
| Two create forms for work | One form, choosing the right action behind it |
| Three invite displays | One panel, one data read |
| Two activity designs and two reads | One component, one shape |
| Several `Part of` and detail readers | One small organization context, loaded once per page |
| Scattered organization `if`s in shared screens | Named slots on the shared screens, such as extra menu items |
| Hand-written plurals | One helper |

### 10.3 Rules stay on the server

- Permissions stay in one place: `orgGrant` and `getWorkspaceAccess`.
- Screens never decide privacy. Roster, activity and profile privacy are enforced in the read.
- Pure rules stay testable, in the style of `dashboard-rules.ts` and `profile-rules.ts`.

### 10.4 Scale

- The concept targets 2,000 members, as the existing checks do.
- Rosters page. Bulk actions run in batches. Counts are read in one query.
- Measure Overview, Tasks and Files load times before and after each step, as the project workflow asks.

### 10.5 Tests

- Database tests for each row of the membership table in section 4.3.
- Browser checks for each tab, with six states and at least owner, member and visitor.
- The 14 failing browser files should be repaired first, or new checks stay blind.

## 11. New gaps found

Beyond the parity report:

| # | Gap | Where it's handled |
|---|---|---|
| 1 | Removal doesn't record why, or remove the chip, or withdraw verification | 4 |
| 2 | Owner's role shows as "Contributor" | 4.4 |
| 3 | Own profile doesn't separate drafts from public | 4.5 |
| 4 | Three invite designs; two lack a link, a clear copied state, or email preview | 7.11 |
| 5 | Stages is hidden when empty, so nobody learns it exists | 7.3 |
| 6 | A single sprint shows a lone dot | 7.3 |
| 7 | "Get started" can't be clicked | 7.2 |
| 8 | Publishing to zero people gives no explanation | 7.5 |
| 9 | An empty document may be visible to visitors | 7.4 |
| 10 | Updates default to Public, which also reaches Discover | 7.8 |
| 11 | Removed-person links have no explanation page | 4.7 |
| 12 | Removal dialog doesn't show consequences | 7.10 |
| 13 | Term-end has no guided moment for verifying and writing up | 6 |
| 14 | Join page doesn't handle every code state clearly (to confirm) | 7.11 |

## 12. Build order

Each step is reviewed before the next. This replaces the order in the parity report.

| Step | What | Why this order | Database change |
|---|---|---|---|
| 0 | Deploy `5464d41ad` when told | Already done | No |
| 1 | Bugs and wording from the parity report | Quick and safe | No |
| 2 | **Membership and profile** (section 4) | The accuracy problem you raised | Yes, `end_reason` |
| 3 | Shared blocks: Section, Row, Activity, Empty state, Plurals | Everything after uses them | No |
| 4 | Overview and About, including Stages | Most visible | No |
| 5 | Invite panel and join page | Used on three tabs | No |
| 6 | Files, Documents, Updates, Settings | Layout matching | No |
| 7 | Workspaces and Members | Organization-only tabs | No |
| 8 | Sprints: one form, Repeat | Medium | No |
| 9 | Tasks: one form, one board, roster panel | Largest; own plan | Unlikely; to confirm |
| 10 | Everywhere else, phones, dark mode, final pass | Finish | No |

Repairing the browser test suite should run alongside steps 1 and 2.

## 13. Decisions for the owner

Where this changes something locked:

| # | Decision | Old concept | Recommended |
|---|---|---|---|
| 1 | After removal, what do others see? | Entry stays with an end date, verified | **Nothing. The person keeps a private copy.** |
| 2 | After leaving by choice? | "Left Oct 2026", verified | **Same as old concept.** No chip. |
| 3 | Does a removed person get their words back if they rejoin? | Not covered | **Yes, as an unpublished draft.** |
| 4 | Is "Show on my profile" one switch or per entry? | Per member | **One switch, with per-entry publish under it.** |
| 5 | Default visibility for organization posts | Public possible | **Members.** |
| 6 | Tasks: does assignment stay a word people see? | "Assignment" | **Yes, as a chip on cards, for classes.** The button stays "New task". |

## 14. Calls made in writing this

These are my choices, not agreed decisions. Correct any:

- Two contribution groups on the profile.
- Removed entries are hidden even when they had real work.
- Icons listed in 5.3.
- Settings menu order in 7.12.
- Setup card replaces "Get started".
- Document templates in 7.4 are optional and can be dropped.
- QR codes were left out of the invite panel as unnecessary for now.
- Step order in 12.

## 15. Left to the builder

- Exact spacing, following the existing design tokens.
- Component and file names, reusing what exists first.
- How to group activity efficiently.
- Migration details, under the project's migration rules.
