# Organization live check — problems found

Checked on networkbase.in on 2026-11-03, after commit 773052541 was deployed. I was signed in as the owner of
"CSE 3B · Data Structures 2026" and compared every tab, menu, form and dialog with the design report
(`docs/superpowers/specs/2026-11-01-organization-end-to-end-design.md`, sections 7, 16, 22, 35–37). Forms and dialogs were
opened and closed without saving; nothing was changed.

The plan ticked most of these as done; the live site shows they're not. **66 problems** in all. "Report §" names the

**Fix plan:** `2026-11-03-org-live-fixes.md` (approved 3 Nov 2026; seven phases, migrations 0059–0062).
section each one comes from.

## 1. Speed — every tab (report 41.7)

| # | Problem |
|---|---|
| 1 | The tabs take far too long to show their content: Overview about 3.6 s, Files about 13 s, Tasks about 14 s, Workspaces about 15 s, Members about 17.5 s. Each tab makes 10–16 server calls one after another (each about 450–1,100 ms) instead of together. |
| 2 | While a tab loads, the sidebar says "No workspaces yet" (plan step 1d said this flash would be replaced by a loading row). The header shows initials instead of your photo, "Trust and safety" and the badges are missing, and the shortcut reads "Ctrl K", so for several seconds the page looks signed out. |

## 2. Tasks (report §16.1, §7.7) — the biggest gap

| # | Report says | Live site does |
|---|---|---|
| 3 | One board holds normal tasks and assignments | Two areas: an "Assignments" box above the board, then the board |
| 4 | One button, "New task"; header `+ New` offers Task | Three buttons ("New assignment", "Review", "New task"), and `+ New` offers "Assignment" |
| 5 | One form: picking many people changes "Create task" to "Create assignment" and shows Hand-in | Picking "Everyone" closes Create task and opens a separate "New assignment" form |
| 6 | Filters: All, Sprint, Backlog, In review, Assignments, Mine | Only All tasks, Sprint, Backlog, In review |
| 7 | An assignment card moves by itself | It has a "Move to…" menu |
| 8 | A main assignment's panel has no Status, Section or Assignee (problem 34, decision 147) | All three are there |
| 9 | Only a student's copy is reviewed | The main assignment went through ordinary review: it shows "Changes requested: Work is not finished", and your activity shows "review submitted" and "changes requested" on Lab 1 |
| 10 | The board opens at the first column | It opens scrolled sideways: "To do" is cut off; on a phone it opens at "Completed" |

## 3. Overview (report §7.2) — several sections still look like the report's "problem" examples

| # | Report says | Live site does |
|---|---|---|
| 11 | Pinned: megaphone, author photo, one line, time; `×` hides it for you; `⋯ → Unpin` | One link with a pin icon and text; no photo, time, `×` or `⋯` |
| 12 | Today rows: icon by type, bold title, a detail line ("Rama · via code · 1 day ago"), an action (Approve in place when there's one request) | A plain "1 join request →" |
| 13 | This sprint is a real card: name, status chip, days left, goal, progress bar, rows, "All sprints →" | The whole name and date sit in the small label (the report's own example of the problem); one row, without the rubric task; no card, progress or days left |
| 14 | "0 of 0 done" becomes "Nobody has joined yet", linking to Invite | Still "0 of 0 done" |
| 15 | This week: date tiles (`SUN / 8`), type icon | Plain text, and the heading "THIS WEEK" shows twice |
| 16 | Activity: filters as one small menu; 5 rows then "Show more"; icons and a bold subject | A row of five filter buttons; 6 rows; no icons |
| 17 | Workspaces (right): avatar, name, a quiet line ("Rama · 6 members"), a chip, and `+` | Name and time only (the report's own example of the problem) |
| 18 | People (right): photos, "1 member", "1 joined this week", a "1 request" chip; when you're alone, a short invite panel | "Ramanayudu / 1 joined this week" (the report's own example of the problem); no invite panel |

## 4. About (report §7.3)

| # | Problem |
|---|---|
| 19 | No Edit on the welcome note or the About card for the owner |
| 20 | Stages is a line of text, not a timeline with "that stop plus a faint next stop" |
| 21 | Owner and admins: no avatar; shows the title ("Course Instructor") but not the role word ("Teacher") |

## 5. Documents (report §7.4, §37.4)

| # | Problem |
|---|---|
| 22 | The reader shows only the title: no "updated by", read status, Edit button or `⋯` menu |
| 23 | An empty document shows nothing; it should say "This document is empty" with "Start writing" |
| 24 | The options sit as a permanent side panel instead of the `⋯` menu; History and Remove are missing; "Published" is a static box, not a Publish action with its dialog |
| 25 | The list shows the file name "Course syllabus.md" instead of the title |
| 26 | The add dialog has no "Blank or template" choice |
| 27 | The browser tab title has no "Documents ·" (every other tab has its name), and the address says `doc=readme` for the syllabus |

## 6. Updates (report §7.5)

| # | Problem |
|---|---|
| 28 | **At a 1280-pixel desktop width the Post button is off-screen.** The composer's toolbar (with the organization's Pin, email and #general icons) is wider than the right column: "Post to 1 person" sits at 1320–1443 px, past the column's edge at 1256 px. Discard is half cut off. |
| 29 | While loading it shows the workspace wording ("Progress posts for followers and workspace visitors", "Share a workspace update…"), then switches |

## 7. Sprints (report §7.6, §37.2)

| # | Problem |
|---|---|
| 30 | A running sprint has no "Complete" button and no "days left" |
| 31 | The separate Assignments block is still there (the report removes it), so Lab 1 shows twice: in the block and again in the task list as "Task-1 · Unassigned" |
| 32 | New sprint fills the name as "CO1", which already exists (should be "CO2") |
| 33 | New sprint fills the start as today, overlapping the running CO1 (should be the day after CO1 ends, 16 Nov) |
| 34 | The form has a single "Add to every workspace" switch (the report: All, Selected or None), still says "Create a matching sprint" (the report asks for plain words), and "Notify members" instead of "Post an announcement" with prefilled text |
| 35 | A stray "—" after the sprint's name |

## 8. Files (report §7.8, §37.5)

| # | Problem |
|---|---|
| 36 | The Templates folder has no "Template" chip; the starter folders have no line about their purpose |
| 37 | "New folder" doesn't ask who can see the folder |

## 9. Workspaces (report §7.9, §35.5)

| # | Problem |
|---|---|
| 38 | Rows have no avatar; "Remind lead" is only in `⋯`, not on the row; `⋯` says "Remove from the organization" where the report says Detach |

## 10. Members (report §7.10, §36)

| # | Problem |
|---|---|
| 39 | Roster rows have no photo |
| 40 | With only you here, the report wants "You're the only one here so far" and a larger invite panel; instead the invite panel stays a grey placeholder |
| 41 | Your own member panel offers "Block Ramanayudu CH" (blocking yourself) and "Revoke" on your own verification |
| 42 | The member panel fills the whole screen instead of opening at the side |

## 11. Settings (report §22)

| # | Problem |
|---|---|
| 43 | Headed "WORKSPACE SETTINGS", with "Workspace image" and "Workspace links"; the report says "Organization settings" |
| 44 | A locked "Workspace slug" sits right next to the "Handle" you can change: two controls for one address (the report moves the address into Handle) |
| 45 | "All General settings are saved." There's no General section |
| 46 | A member sees only "Only the owner and admins can change settings". The report says members open on My membership and also see What's allowed, Privacy and Leave |

## 12. Search (report §32.2)

| # | Problem |
|---|---|
| 47 | Labelled as workspace search: "Search Workspace / Work and Links…", with "Task title / Link name / Link category" |
| 48 | Results aren't grouped by kind: a document, a file, an assignment and two tasks all sit under "TASKS · 2"; Lab 1 shows twice (assignment and task), and the syllabus shows twice (document and file) |

## 13. Join page, Discover, team workspace

| # | Problem |
|---|---|
| 49 | The join page tells the owner "You've been invited to join this organization." |
| 50 | The Discover card has no type chip, member photos or workspace count (step D) |
| 51 | Team Falcon's box is titled "TEAMS" but its button says "Add role" (one name, gap 32) |

## 14. Profile and contributions (report §4.4–4.6, §16.9, §16.10, §38)

Checked on your own profile (`/my-profile`), Manage organizations, and the contribution editor for CSE 3B.

| # | Problem |
|---|---|
| 52 | The Organizations row reads "Since 2026-10-31", an unformatted date; the report shows "Since Oct 2026" |
| 53 | Under "Not on your profile yet", Team Falcon is its own row; the report nests a team workspace under its organization (CSE 3B, then Team Falcon) |
| 54 | Team Falcon's write-up nudge says "Write about your work in CSE 3B · Data Structures 2026", the wrong place |
| 55 | The CSE 3B and Team Falcon drafts have only "Dismiss", no "Publish" (Caveman and Network for builders do have Publish) |
| 56 | Manage organizations rows have no logo |
| 57 | The contribution editor's list is flat. The report groups it: Organizations (with their workspaces nested), Workspaces, Not on your profile yet, Private to you |
| 58 | Team Falcon's role shows "Contributor" though you lead it; the report keeps "Contributor" for when no role is found at all |
| 59 | "Edit contribution" in Manage organizations opens the whole list, not that organization's entry |
| 60 | The editor list's previews are garbled: Ponytail shows stray "\ \" characters, and DeepScope's "working with Lakshmi CH and Rama" shows as "working with and" (the mentioned names are dropped) |
| 61 | The organization entry's header says "Linked NetworkBase workspace". The report wants the organization, its type and logo, "Set by CSE 3B", and the verified state with who and when |
| 62 | Workspace wording throughout an organization entry: "Back to workspace contributions", "Explain your part in the workspace", "I currently contribute to this workspace", and "Clearing this also marks your positions…" under dates that can't be changed |
| 63 | There's no Publish button, only "Save draft". "Show on profile" is switched on, yet the entry is still a Draft, and nothing says what's missing (the report: Publish checks a summary exists and points to what's missing) |
| 64 | "Role history · 1 positions" |
| 65 | "View as visitor" says "This contribution is not shown to public visitors" without saying why or what to do |
| 66 | The organization entry doesn't show its nested workspace (Team Falcon) beneath it |

Works as designed:
- the Organizations section's place (between Collaboration preferences and Links), its pencil and "Join with code"
- Manage organizations' Show switch, up/down order, and "Edit contribution"
- locked role and dates with "Ask an admin"
- the role history step "From team records", locked but able to take detail
- "Start from About", "Start from my work", the Work record switch, up to 8 images, "From workspace", and Featured

## Removed at the owner's request

**Preview as member** (report §45.6, decision 175). It worked live, but the owner doesn't want it. It's removed from the
code: the header button, the bar, the cookie and every check that read it. The plan records it as dropped.

## Every page

React error #418 appears in the browser console on every page, not only the organization (server and browser drew
different text). It's not traced yet, and it may be older than this deploy; it's listed apart until it's traced.

## What matches the report

- **Workspaces:** the summary line filters, the controls, New workspace, row chips, and the `⋯` menu.
- **Members:** the filters, Export CSV, and Requests with Approve and Decline.
- **Updates:** the feed, its filters, and the composer's options ("Goes to 1 person", "Also email · 5 of 5 left today", "Post to 1 person").
- **Files:** the left panel, "Who can see this?" with "Use as template", and Submissions.
- **Settings:** the menu, and one review setting in Work.
- **New features:** the Calendar dialog and "Last active here". (Preview as member worked, but the owner asked for it to be removed; it's gone from the code.)
- **Team workspace:** "Inside CO1" and "From CSE 3B".
- **Phone layout:** no sideways page scroll.

## Not checked yet

These need a second, student account, or would change real data:
- a student's own board and Hand in
- review, Return and Extend on a real copy
- Mark away
- notifications and emails
- live updates across two browsers
- creating a calendar link

The class has one member (the owner), and a join request from "Rama" is waiting.

## Deploy time (for the record)

The 3 November deploy took about 18 minutes: the web compile took 15.0 min, against 2.4–3.6 min before. The new code
compiles about twice as slowly on this Mac (88 s → 2.8 min, under 2 GB of memory); the rest was a slow Railway build
machine on that run. The worker also compiles the whole site.

## Live re-check — 4 November 2026 (after 8e2cfbeb8, migrations 0059–0062)

Signed in as the owner on networkbase.in. Forms and menus were opened and closed without saving. **Fixed** means seen
working on the live site. **Fixed after the next deploy** means the re-check found it incomplete, it's fixed and tested
locally, and it isn't live yet. **Tests only** means it can't be seen without making real changes or a second account.

| # | Result |
|---|---|
| 1 | Fixed. Content on screen: Overview 0.76 s, Tasks 0.55 s, Workspaces 0.37 s, Members 0.56 s, Files 0.65 s, Sprints 0.51 s, Updates 1.36 s, Documents 2.34 s (were 3.6–17.5 s) |
| 2 | Fixed. Photo at once, sidebar workspaces at 0.5 s, Trust and safety at 0.45 s, ⌘K; no #418 in the console |
| 3, 4 | Fixed. No Assignments box; one New task button; + New offers Task |
| 5 | Fixed. Everyone turns the same form into Create assignment, keeping the title; One person · a task goes back |
| 6 | Fixed. All tasks, Sprint, Backlog, In review, Assignments, Mine |
| 7 | Fixed. No Move to… on Lab 1 |
| 8 | Fixed. No Status, Section or Assignee on the main assignment |
| 9 | Fixed. "Changes requested" is gone (0059) |
| 10 | Fixed. Opens at To do on desktop and phone |
| 11–16 | Fixed. Pinned with photo, ⋯ and ×; Today row "Rama · via code" with Approve; sprint card with 12 days left, goal and progress; "Nobody has joined yet"; SUN / 8 tile; activity menu |
| 17 | Fixed after the next deploy. Avatar, lead and + are live, but the member count read 0 (an unqualified column in the subquery); fixed with a test |
| 18 | Fixed |
| 19–21 | Fixed. Edit details and Edit on the welcome note; stage line CO1 → Next; "Teacher · Course Instructor" with photo |
| 22 | Fixed after the next deploy. The header is live, but it read "Updated by System"; now the file's last uploader |
| 23 | Tests only (needs an empty document) |
| 24, 25, 27 | Fixed. Options left the rail; ⋯ has Options…, History, Remove; titles not file names; Documents · title and real slug |
| 26 | Fixed after the next deploy. The template choice now shows even with no templates yet |
| 28 | Fixed. At 1280 px Post ends at 1244 px, inside the column; Discard fully visible |
| 29 | Fixed |
| 30 | Fixed. Complete sprint and 12 days left |
| 31 | Fixed after the next deploy. The separate block is gone, but Lab 1 still read "Unassigned" and "In progress"; now "Nobody has joined yet" with the board's column |
| 32 | Fixed after the next deploy. Named sprints ("CO1 Arrays and linked lists") now count, so the next is CO2 |
| 33, 34, 35 | Fixed. Starts 16 Nov; All / Selected / None, Teams plan their own sprint, Post an announcement; no stray dash |
| 36 | Fixed after the next deploy. The Template chip is live (0062); the purpose line showed only on phones, now on desktop too |
| 37 | Tests only (needs a new folder) |
| 38–42 | Fixed. Avatar and Detach; roster photos; only-one-here line and larger panel; no Block, Verify or Revoke on your own panel; side panel |
| 43–45 | Fixed |
| 46 | Tests only (needs a member account) |
| 47, 48 | Fixed, plus a follow-up after the next deploy: the organization's own tasks are back in organization search; the header button says "Search this organization" |
| 49, 50, 51 | Fixed. 50 also exposed that Discover's first page ignored decision 160 (new organizations wait); fixed after the next deploy, so CSE 3B leaves Discover until it qualifies |
| 52–57, 59–66 | Fixed |
| 58 | Fixed after the next deploy. Team Falcon still read Contributor (the stored default); now Team lead |

Also fixed after the next deploy: the header buttons on an organization say Invite people, Share organization, Manage links and Add organization image; org search shows "1 member".
