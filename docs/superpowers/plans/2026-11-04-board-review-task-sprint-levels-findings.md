# Board copies, review layout, New task, two-level sprints, and team channels in Messages — findings, 4 November 2026

Sources: the user's two screenshots (CSE 3B board and review queue on localhost), the code, and an end-to-end audit
of this report against the user's request (same day). No code changed.

## 0. What was asked, and where it's answered

| The user's words | Section |
|---|---|
| "Whenever a student has submitted… it's showing in two different ways… completed list… still showing in progress" | §1 |
| "The header is taking up too much space… keep search, the assignment dropdown and oldest first… All tasks and Sprint on the right… all in a proper line" | §2 |
| "Private conversation… redirecting. It should show in this place only… same flow as comments" | §3 |
| "New task… two different ways… two buttons on the top for task and assignment… placed according to our design specifications" | §4 |
| "Keep it the same way as the Overview and Portfolio buttons are aligned… same way on the sprint" | §5 (and decision D6) |
| "Sprint clarity… a main sprint and a sub-sprint… the CO… one month or one and a half… in those, we can create sprints" | §6 |
| "Messages… for the organization it has a channel… if any organization has a workspace, it's showing that as a separate… instead of a channel" | §7 |

Audit corrections to the first version: the **+ New** menu has no Assignment item today (§4 adds it); the main
card goes to Completed only when everyone is done or the assignment is closed (§1 now says so); the profile request
may mean the Sprints page itself, not only the form (§5, D6); §6 now lists everything two levels touch, and
decisions grew from 5 to 9. Added the same day: §7, team workspaces in Messages (D10).

---

## 1. A hand-in shows twice on the admin's board

**What happens.** The admin's board shows the main card **ALM-1** in In progress ("1 to review · 0 of 1 done") and
Rama's own copy **ALM-1** in Completed ("In review", C3D-9). With 60 students, every copy the admin opens adds a card.

**Why.** The server already leaves copies off an admin's board (`orgTaskReadFilter` in
`src/lib/organizations/assignments.ts`: admins get `assignment_id IS NULL`). The copy is added in the browser: when
an admin opens a copy (review queue, the roster's Open, a notification, a link), the task panel's change goes
through `patchWorkspaceTaskCaches` → `patchTaskQueryData` (`src/lib/workspaces/task-cache.ts`), which **inserts** a task it
doesn't find into the first page of every cached list. The board, the drag code (`KanbanBoard`) and the task
mutations (`useTaskSurfaceMutations`) all write through that one function. The reload that follows keeps the extra
card. It also lands in the column its own status says (Completed while it waits for review), so the column's line
reads "2 completed · 1 in review".

**Design.**
- An admin's organization board holds **one card per assignment**, the main card:
  - It moves by itself (unchanged rule, `assignmentColumn`): To do while a draft or nobody has started;
    In progress once anyone starts; Completed when everyone is done (excused people don't count) or it's closed.
  - It says "40 of 60 done · 12 to review · 8 not in" with the progress bar, and a "12 to review" chip.
- Students' copies never appear on an admin's board. They live in the Assignment tab and the review queue. The
  admin's **Mine** still shows copies given to the admin themselves (unchanged).
- A student's board holds only their own copy (unchanged; a handed-in copy sits in Completed with "In review", as
  decided before).
- **Fix:** `patchTaskQueryData` never inserts an assignment copy (`assignmentId` set) into a list that doesn't already
  hold it; it only updates one that's there. Nothing else changes; new copies reach a student through the normal load.

**Done when.** Opening, reviewing or returning any number of copies leaves the admin's board with one card per
assignment and correct column counts, with no reload needed. A unit test pins the cache rule; a browser test opens a
copy from the queue and checks the board.

## 2. Review: one line above the work

**What happens.** Three rows sit above the work: the board's tabs (All tasks · Sprint · Backlog · In review ·
Assignments · Mine), the queue's heading ("To review 1 waiting" · Back to board), and its filters (Search names · All
assignments · Oldest first · Late only · 1 of 1 waiting · ‹ Next). The file, the waiting list and the conversation
start about a third of the way down the screen.

**Design.**
- **One line.** Left: Search names · All assignments · Oldest first · Late only (and Mine · All when reviewers are
  set). Right: the board's tabs, with **In review** showing its count ("In review 1").
- The heading row goes: the In review tab says where you are and how many; **All tasks** is the way back (Esc too).
- "1 of 1 · ‹ Next" moves to the top of the waiting list.
- The three columns start right under the line and fill the rest of the screen: the waiting list and the
  conversation scroll inside their columns; the file viewer takes the full column height.
- **Phone:** the board's tabs stay on their own scrolling row (as on the board today); the filters wrap under them;
  the three parts stack (waiting, file, conversation and decision), with Approve and Return pinned at the bottom.

**Done when.** At 1440×900 the file's first page starts within the top third of the screen; nothing scrolls sideways
at 390px; the browser test checks one toolbar row on desktop.

## 3. Private conversation, in place

**What happens.** The right column shows the last three messages and a one-line reply; "Open the whole conversation"
leaves the queue for the copy's panel.

**Design.**
- The private conversation **is** the copy's comments. The right column shows the task panel's own comments
  component (`CommentsTab` with `useTaskDiscussionResource`): the whole thread, replies, files, edits, typing and live
  updates, scrolling inside the column, with the composer (text and files) at its foot.
- Order in the column: their note, steps, the conversation, then Approve / Return at the bottom (unchanged order).
- It shows only the private conversation (decision 16); class questions stay in the copy's panel.
- Moving to the next person switches the conversation to theirs. An Approve note still posts as a message, so it
  appears in the thread.
- Ordinary board tasks waiting for review get the same column with that task's comments.
- No "Open the whole conversation" link.

**Done when.** Replying with text or a file from the queue appears in the thread at once and in the copy's panel;
switching people switches threads; the browser test covers both.

## 4. New task: Task and Assignment tabs

**What happens.** One dialog, "Create task". Picking Everyone, Some people or Groups under **Assigned to** turns it into
"Create assignment" with other fields. A second assignment dialog (`AssignmentComposer`) is used for "Use again".
The **+ New** menu offers Task, Announcement, Sprint and Workspace; there is no Assignment item.

**Design.**
- The organization board's **New task** button opens **New**, with two tabs at the top: **Task** and
  **Assignment**. A team workspace and a normal workspace keep Task only (no tabs).
  - **Task:** one piece of work for one person. Title, description, assigned to (one person or nobody), sprint,
    due, priority, points, steps, files — as today.
  - **Assignment:** everyone it goes to gets their own copy. Title, instructions, goes to (everyone · some people ·
    groups), hand in (file · link · text · nothing), review (who), due and late rule, sprint, materials, steps,
    publish (now · on a date · save as draft). The button says what happens: "Publish to 60", "Schedule",
    "Save draft".
  - Title, description and sprint carry over when switching tabs.
- **Assigned to** lists people only; it no longer switches modes.
- The **+ New** menu gains **Assignment**; its Task and Assignment items open the dialog on that tab.
- One assignment form: "Use again" opens the same dialog on the Assignment tab, filled in. `AssignmentComposer`'s
  fields and this tab are the same component.
- Only owners and admins see the Assignment tab (members can't create on an organization's board, unchanged).

**Done when.** From the button and from + New, both tabs create what they say; nothing in Assigned to changes the form;
"Use again" opens the same Assignment tab; browser tests cover both tabs.

## 5. One tab style, like the profile

**What happens.** The profile page switches Overview · Portfolio with **underline tabs**: plain text, an orange line
under the chosen one, a hairline under the row (`src/components/profile/v2/ProfileTabs.tsx`). The New sprint form uses a
boxed two-part toggle for One sprint · Several.

**Design.** Every "which kind" choice uses the profile's underline tabs, from one shared component taken from
`ProfileTabs` (tablist, arrow keys, Home/End):
- New sprint: One sprint · Several.
- New task: Task · Assignment (§4).
- Organization New sprint: CO · Sprint inside a CO (§6).

If the request also means the **Sprints page** should have profile-style tabs of its own (for example Overview · Work
· Teams), that's decision D6.

**Done when.** The three dialogs use the same component; a contract test pins it.

## 6. Two-level sprints for an organization

**The idea (the user's).** An organization's term is a row of **main sprints** — a CO (course outcome), one to
one-and-a-half months each. Inside each CO, shorter **sprints** (a week or two). Teams' sprints and the class's
assignments sit inside those.

**Design.**
- **Rail (Term):** each CO is a block with its dates and "week 3 of 6"; its sprints are listed inside it (closed,
  running, upcoming); gaps show between COs and between sprints inside a CO. Past COs fold away.
- **A CO's page:** state, dates and week; the goal; a strip of its sprints, each with its done count; the CO's
  roll-up ("Across CO1: 11 of 23 done · 2 assignments open · 1 team has no sprint yet"); time passed against work
  done for the whole CO; CO materials (shown in every sprint inside it). Main button: **Add a sprint inside CO1**.
- **A sprint's page:** as built, with "Inside CO1 · week 3 of 6" above its name, the CO's materials beside its own,
  and Add work, People, Teams for that sprint.
- **New sprint:** tabs **CO (main sprint)** · **Sprint inside a CO**.
  - A sprint picks its CO first; its dates start inside the CO and can't go outside; the term strip shows its
    neighbours inside that CO.
  - **Several**: for COs, plan the term's COs (as today's series); inside a CO, split it evenly ("CO1 into 3 sprints
    of 2 weeks").
- **Editing a CO's dates:** sprints inside must still fit; the form offers "Move the sprints inside too" (like "Move
  later sprints too"), or says which sprint is in the way.
- **Ending:** a sprint closes as today. A CO's Close waits until its sprints are closed, or offers "Close CO1 and its
  running sprint" with one choice for where open work goes. Cancelling a CO asks about the sprints inside it.
- **Where the running sprint shows** (two can run at once: the CO and its current sprint), always shown together as
  "CO1 · Week 3–4":
  - Overview ("This week" and the sprint card) and the organization header's sprint chip.
  - The board's **Sprint** filter (the running sprint; the CO when none of its sprints runs).
  - Task and assignment sprint pickers, grouped by CO; task cards' sprint chip names the sprint, the CO on hover.
  - The calendar shows COs as spans with their sprints inside.
  - Teams: the "plan your sprint" prompt and Remind follow decision D3.
- **Notices:** a CO's start posts once; its sprints' starts notify only the people with work in them (decision D7).

**Data and rules (no new table, no migration expected).** `workspace_sprints.parent_sprint_id` already exists (team
sprints use it to sit inside an organization sprint).
- Inside one organization: a CO has no parent; a sprint's parent is a CO in the same organization; no deeper levels.
- COs don't overlap each other; sprints fit inside their CO and don't overlap each other.
- The rule "an organization's sprints are not inside another sprint" (`assertOrgSprintRules`) goes; the
  organization's overlap check runs per level.
- Code that picks "the" running organization sprint (`org-dashboard` Overview and header, `readSprintOrgContext`'s
  running sprint, sprint notices) learns the two levels.
- Existing organization sprints become COs (they have no parent); nothing moves.
- The scheduler already starts each sprint on its own date; codes (SPR-n) keep counting across both levels.

**Done when.** A CO with three sprints shows nested in the rail, rolls up on its page, keeps its sprints inside its
dates when edited, closes cleanly, and the Overview, header chip, Sprint filter and pickers show "CO1 · Week 3–4";
DB tests cover the rules; browser tests cover the rail, the CO page and the form.

## 7. Messages: a team workspace shows as its own workspace, not inside its organization

**What happens** (two screenshots of /messages):
- **All workspaces view:** the sidebar lists "CSE 3B · Data S" with #general, and then **"Team Falcon: Ha"** as a
  separate workspace beside it, with "#team-falcon-hash-table-libra…". The team is a workspace of CSE 3B, but it
  reads like an unrelated one. Names are cut short ("Network for bui", "CSE 3B · Data S").
- **CSE 3B open:** Channels holds #general, Browse channels and Create channel; then **"Team Falcon: Hash table"**
  comes as a second heading of the same weight, with its channel under it. It looks like another workspace, not one
  of the class's channels.

**Root causes** (`src/components/messages/ChatSections.tsx`, `src/lib/organizations/chat-rules.ts`):
1. **Two different lists.** The workspace switcher uses `workspaceWorkspaces(...)`, which keeps a team workspace inside
   its organization (report §25.1). The sidebar's all-workspaces view uses the raw `projectsByActivity(data)`, so
   every team workspace becomes a top-level group beside its organization. (Since P13, ff2b6a854.)
2. **Teams drawn as peers of Channels.** With an organization open, each team workspace is its own `Section` after
   Channels, with the same heading as Channels and Direct messages, so it reads as a separate place. The team's
   default channel is named after the team on purpose (`defaultChannelName`: "#team-falcon-hash-table-library") so it
   reads as one of the class's channels — but the heading above it undoes that.
3. **Headings in the small capitals font.** Workspace names in group headings use the section-title style (11px mono,
   letter-spaced) — made for "Channels" and "Direct messages", not names — so they're cut at about 15 characters.

**Design (same for the sidebar, the floating chat window and phones):**
- **An organization's group holds its teams.** Under the organization: its own channels first, then a quiet divider
  **Team workspaces**, then each team you're in:
  - a team with one channel you can see is **one channel row**: the team's small badge, then
    "#team-falcon-hash-table-library" (full name on hover);
  - a team with more channels is one row "Team Osprey · 3 channels" that opens to list them, indented;
  - **Browse workspaces** (owners and admins) ends the group, as today.
- **All workspaces view:** the same nesting inside each organization's group. A team never appears at the top level
  when you're also in its organization. Someone in a team but not in its organization (an outside person) still
  sees the team on its own, labelled "CSE 3B · Viewer" (unchanged, §25.7).
- **Organization open:** the Team workspaces divider and rows sit inside the **Channels** section, under the
  organization's channels, Browse channels and Create channel. No team headings.
- **Unread counts:** a team's unread and mentions count toward its organization's group; a collapsed organization still
  shows its unread rows, team rows included (as other sections do).
- **Names readable:** workspace names in group headings use the normal interface font, sentence case, so
  "Network for builders" and "CSE 3B · Data Structures 2026" fit; they shorten only when they truly don't fit, with
  the full name on hover.
- Starring, muting, mark-read, the unreads-only filter and ⌘K keep working on team channel rows as on any channel.
- Nothing changes in the database: channel names, membership and who can read what stay as they are.

**Fix outline.** One grouping helper in `chat-rules.ts` (organizations with their teams' channels, outside
teams on their own) used by both views; the all-workspaces list starts from `workspaceWorkspaces`; team channels
render inside the organization's group / Channels section; group headings get the normal font.

**Done when.** With CSE 3B and Team Falcon both joined, the sidebar shows Team Falcon's channel only inside CSE 3B, in
both views and in the chat window; an outside person still sees Team Falcon on its own; names aren't cut at 1440px; a
unit test pins the grouping and the messaging browser test checks both views.

## 8. Order of work

1. §1 the board fix and §7 the Messages grouping (bugs; small, ship first).
2. §2 and §3 the review layout and conversation.
3. §5 the shared tabs, then §4 New task.
4. §6 two-level sprints, after decisions D1–D5 and D7–D9.

## 9. Decisions for the user

- **D1 · Name of the main sprint.** "CO" for Education. For other organization types, their own word ("Phase",
  "Module")? Proposal: the type's word, set per organization.
- **D2 · Stand-alone sprints.** Can a sprint sit outside any CO, or must every sprint be inside one?
- **D3 · Team workspaces.** Does a team's sprint sit inside the class's weekly sprint, or inside the CO?
- **D4 · Assignments.** Given to a weekly sprint (counted in its CO), to the CO directly, or either?
- **D5 · Today's CO1.** It becomes a CO with no sprints inside until some are added. Fine?
- **D6 · The profile's tabs on the Sprints page.** Only for the form choices (§5), or should the Sprints page itself
  get underline tabs (for example Overview · Work · Teams)?
- **D7 · Start notices.** Notify everyone when a CO starts and only people with work when a sprint starts — or
  something else?
- **D8 · Normal workspaces.** Two levels for organizations only, or also for normal workspaces (for example a
  release made of sprints)? Proposal: organizations only for now.
- **D9 · Closing a CO with a sprint still running.** Close both together (proposal), or require the sprint closed
  first?
- **D10 · Team channel rows in Messages.** Show the team's channel by its channel name ("#team-falcon-hash-table-library",
  proposal, as it is everywhere else) or by the team's name ("Team Falcon")?

### Decisions as built (4 November 2026)

The user asked for the whole report to be built without waiting on answers, so each decision takes the report's
proposal, or the simplest choice that keeps today's data working:
- **D1:** "CO" for Education, "Phase" for other organization types (from the type profile).
- **D2:** every sprint sits inside a main sprint; a sprint without a parent *is* a main sprint (so today's
  sprints keep working as COs).
- **D3:** a team's sprint sits inside the class's main sprint or one of its sprints; the picker lists both, grouped.
- **D4:** either — the sprint picker lists each CO and its sprints, grouped.
- **D5:** yes, today's CO1 becomes a CO with no sprints inside.
- **D6:** the underline tabs are for the form choices only; the Sprints page keeps its layout.
- **D7:** a CO's start notifies as today (its own "notify on start" setting); a sprint inside a CO notifies only
  the people with work in it.
- **D8:** organizations only.
- **D9:** closing a CO with a sprint still running closes both, with one choice for where open work goes.
- **D10:** team channel rows show the channel's own name.
