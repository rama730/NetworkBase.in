# Organization student check — 4 November 2026

Checked live on networkbase.in. The owner deleted and re-created "Lab 1: Arrays and linked lists" (C3D-4, published to Everyone,
same settings). Then the student account (Rama, `ch_rama`) went through every tab in Chrome: Overview, the Lab 1 copy (C3D-5),
hand-in, status, class questions, comments, the board and its filters, Documents, Updates (a reply was posted), Sprints, Files,
Workspaces, a team workspace, Settings (My membership, What's allowed, Privacy, Leave dialog, cancelled), search, notifications,
My work, the profile, and phone width.

Changes made on the live site while testing, as the student: Lab 1 copy moved to In progress, one class question, one reply on
the pinned update. A 188-byte test zip was chosen for hand-in; it was refused (problem 1), so nothing was handed in.

## Now: broken for students today

| # | Problem | What the student sees | Cause | Fix |
|---|---|---|---|---|
| 1 | **No student can hand in a file.** | Choosing a file shows "Couldn’t add the file. Try again. Minified React error #441". Submit stays grey. | `getUploadCollisionSummary` (`src/app/actions/files/mutations.ts:678`) checks upload access with no task, so the "your own copy" rule never applies and it throws "Only organization owners and admins can change the organization’s files." (Railway log 20:10:31). The server hides the message in production, and the raw React code is shown. | Pass the copy's task to the check. Show a plain message when a server action throws. |
| 2 | **Menus and dialogs opened from the task panel are hidden behind it.** | Status, Priority, Assignee, Section and ⋯ open nothing you can see. Owner side: Edit for everyone and the Delete confirmation are hidden too. | The panel is drawn at layer 200/201 (`TaskDetailPanel.tsx:303`, `CreateTaskModal.tsx:318`, `MyWorkDrawer.tsx:55`). Menus are at 60, dialogs at 50/51, so they open underneath. | Menus, popovers, selects and dialogs stack above the panel. |
| 3 | **A teacher's own tasks show in a student's My work.** | "Prepare the Lab 1 grading rubric" (C3D-2) is listed for the student. Clicking it opens Tasks with nothing open, and the board never shows it. | My work's default "all" view (`orgCopyRules`, `src/app/actions/my-work.ts:18`) lets every ordinary organization task through. The board's rule (members see only their own work) isn't applied there. | In an organization, a member's My work holds only their own work, the same as the board. |
| 4 | **Students lose every document's title, header and list.** | Documents → Course syllabus shows only "This document is empty", with no title, no Updated line and no list of documents. (The file really holds only its title, so "empty" is true; the missing header and list aren't.) | `DocTab.tsx:122` passed the Report menu as `inPlaceBanner`, the prop that switches the viewer to the child-workspace mode, so every person who can't edit got the bare layout. | Report gets its own `reportMenu` slot; the header and list stay. |
| 5 | **The copy offers edits the server refuses.** | The title is editable, Description has Edit, the due date has Today/+1 Week/Clear, Assignee opens, Status offers "Submit for review", and the card's Move to… offers Completed. Each one fails ("Set by CSE 3B…", "Use Submit to hand this in."). | The panel and card don't apply the assignment rules (`assignmentWriteBlock`, `reassignBlock`) that the server uses. | On a student's own copy: title, description, due date, assignee and sprint are read-only. Status offers To do, In progress and Blocked only, and Completed isn't in Move to…. |
| 6 | **A refused edit stays on the board.** | After the title was refused, the board card read "Lab 1: Arrays and linked lists x" until a reload. | The panel rolls back; the board's cached copy doesn't. | Roll the board back too when a save fails. |
| 7 | **Students see New task.** | The form opens (it even offers assigning the teacher) and fails on Create. | The button ignores `create_org_tasks`, which is "no" for members. | Hide New task for members. |
| 8 | **Joining a team is a dead end.** | Welcome → "Join a workspace" leads to the Workspaces tab, where Team Falcon has no open seats, so nothing can be joined. | The design (§25.4, §26.7) has members apply for open seats; the Welcome row showed whether or not any existed. ("Message workspace lead" does open a direct message; first reading was wrong.) | The Welcome row names the open seats ("Join a workspace · 2 open seats"), opens their own workspace once they're in one, and is left out when neither applies. |
| 9 | **Sprints number tasks "Task-4" while the board says "C3D-4".** | CO1 lists "Lab 1 · Task-4". (The deleted Lab 1 shows as Removed on purpose, as sprint history, and "0/2" is right: the rubric task and Rama's copy.) | The page's workspace record drops `key` (`detail.ts` schema), so Sprints falls back to "Task". | The shell carries the key. |
| 10 | **Search shows the wrong state.** | Search says Lab 1 is "To do" while the copy is In progress. | The search row shows the main assignment's state. | For a member, show their copy's state. |
| 11 | **Notifications explain the setting instead of the news.** | "Ramanayudu CH assigned Lab 1…" followed by "Recipients hear about new work and its due date." | The notification's description field holds the settings text. | Show the due date or what changed, never the settings text. |
| 12 | **What's allowed is wrong for students.** | "Read posts: Their own" (they read every post). "See workspaces: Their own" (they see Team Falcon). "Upload and change files: —" (they upload hand-ins). | The table's labels for members. | Correct the three rows. |
| 13 | **Privacy in organization Settings is the account page.** | "…not everyone in this workspace" and "Deletion and export are above and in Delete account below", with no Delete account below. | The account legal section is reused as-is. | Organization wording, and no pointer to a section that isn't there. |
| 14 | **Profile "Since" and My membership differ after a rejoin.** | "Student · Since Oct 2026" against "joined Nov 4, 2026". | The profile counts from the first time they joined; My membership from this time. | No change: both are true, and a contribution record keeps its start. |
| 15 | **Small wording.** | "0 seconds ago" on a new class question. "Reviewed by CSE 3B · Data Structures 2026" (names the organization, not a reviewer). The class-questions line "Everyone with this assignment sees this." appears twice. The search button is labelled "Search this workspace" for screen readers. Today says "You're all caught up" beside a lab due Sunday that isn't started. | — | "just now". "Reviewed by the teacher" (the role name). One helper line. "Search this organization". "Nothing due in the next 2 days". |

## Owner side, found while deleting and re-creating Lab 1

| # | Problem | Fix |
|---|---|---|
| 16 | Same as 2: Edit for everyone and the Delete confirmation open behind the task panel. | Covered by 2. |
| 17 | After Publish, nothing confirms it worked. (The board does refetch; it came in after my 4-second look, behind the slower publish.) | "Published Lab 1: 1 copy handed out." |
| 18 | The Delete confirmation doesn't say each person's copy goes too. | "Delete Lab 1? 1 person's copy goes with it, along with its questions." |
| 19 | The Create assignment box tells screen readers "Create a new task" (hidden text; the header stays caption-free by design). | Screen readers hear "Everyone it goes to gets their own copy." |

## Upcoming: what will break for students next

| # | When | What will go wrong | Fix |
|---|---|---|---|
| 20 | Once 1 is fixed | Submit, In review, Approve, Return and Resubmit have never run live for a student, because hand-in was blocked. | Run the full loop live after the next deploy. |
| 21 | Students outside India | "Due Sun, Nov 8, 11:00 PM" on the copy has no time zone. It's IST, but someone elsewhere reads it as their own time. | Add the organization's zone (IST) on assignment due lines when the viewer's zone differs. |
| 22 | A teacher deletes started work | The confirmation in 18 doesn't say anyone has started. Their class questions and comments go too. | Say how many have started (covered with 18). |
| 23 | Required reading | Checked: a required document that's still a draft stays out of members' lists and Today, then shows as "Read …" once published. | No change. |
| 24 | Team assignments | Students can't join teams (8), so team assignments reach no one, and late joiners get nothing (spec §25.1 #5). | Covered by 8 for seats. A team assignment without members is flagged to the owner at publish. |
| 25 | More teacher tasks | Every ordinary organization task would show in every student's My work (3). | Covered by 3. |

## Not code: needs a look on the owner's side

| # | Problem | Why it isn't fixed here |
|---|---|---|
| 26 | Bursts of 503 (server busy) on page prefetches and on a few task-panel actions while testing. Railway's own request log has no 503 for that time, so they came from Cloudflare. They stopped a minute later. | It's a Cloudflare setting (a rate-limit or bot rule), not app code. Check Security → Events for networkbase.in around 01:38–01:42 IST on 4 Nov. |

## Fixed locally (4 November)

All of 1–13, 15–19, 21, 22 and 24, each with a test (`tests/unit/org-student-check.test.ts`, `tests/browser/panel-layers.spec.ts`,
and DB cases named "student check N"). 14 and 23 need no change. 20 is the live loop after deploy, and 26 is Cloudflare.

## After the deploy (f6d0f3d11, 4 November)

The student handed in `lab1-rama.zip` live: it attached, Submit opened, and the copy reads "Waiting for review" (problem 1 fixed).
Locked fields, the named zone and "Reviewed by Teacher or TA" showed as built. Then:

| # | Problem | Cause | Fix |
|---|---|---|---|
| 27 | **The teacher's Tasks tab crashed** ("Something went wrong in Tasks") as soon as a file was waiting for review. | The review queue read file names with `array_agg`; production runs with `fetch_types: false`, so the list arrived as the text `{lab1-rama.zip}` and `.join` threw. Tests passed because the test database parses arrays. The roster's skills had the same read. | Both wrap the list in `to_jsonb`, like the other queries that already did. |
| 28 | The handed-in copy's header chip read "COMPLETED". | The panel didn't pass the review state to the badge. | It reads "In review". |
| 29 | "Choose file" stayed while the hand-in waited for review, though its files are locked (decision 173). | — | Hidden while waiting or approved; back when returned. |

After a666ab334 went live, the whole loop ran on production: the teacher's queue showed `lab1-rama.zip`; Return with a reason
reached the student ("Returned: … Fix by …", Choose file back); the student handed in version 2 (chip In review, Choose file
hidden); the teacher approved; the student sees "Approved · It's locked now" and the card sits in Completed.

Small things the loop showed, fixed locally afterwards:

| # | Problem | Fix |
|---|---|---|
| 30 | The Return reason box ("What should they change?") has no accessible name. | Label it. |
| 31 | Once the queue empties it reads "· 0 of 1 loaded". | Drop the line when nothing is waiting. |
| 32 | Approve and Return from the queue say nothing. | "Approved Rama's Lab 1" / "Returned to Rama". |
| 33 | The default Fix by is exactly three days from the click (Sat 2:43 AM). | 11:59 PM three days on, in the queue and the roster's Return. |
| 34 | A resubmission keeps the first version's file next to the new one (v2 held both zips). | Each file on open work has Remove; a removed file is left out of the hand-in and the next version (it was still counted). |
