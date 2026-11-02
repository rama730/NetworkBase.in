# Organizations: End-to-End Concept

**Date:** 1 November 2026, updated 2 November 2026
**Status:** Decisions locked by the owner on 2 November 2026, see section 13. Nothing here is built yet.
**Builds on:** `docs/organization-workspace-parity-report.md` (audit) and `docs/organization-concept-report.md` (the earlier locked concept). Where this document differs from a locked decision, it says so in section 13.

## 1. Intent

An organization is a workspace with more powers. Someone who knows a workspace should already know how an organization works.

The owner's direction:

- Every tab, every section in it, every button, form and card is designed end to end, for every stage, including how it looks when empty.
- The organization must stop looking plain. Sections need real design, not lines of text.
- Get started is temporary and smart: once real work exists, it goes.
- Updates, Sprints, Tasks and Files each become one unified view, the same as a workspace, with organization options inside.
- Storage moves out of Files into its own Settings section.
- On the profile, organizations move to their own right-column section, and people choose what shows.
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
| Member | Student | What is due, where materials are, proof they submitted | Overview, About, Documents, Updates, Sprints, Tasks, Files, Workspaces, and their own part of Settings (22.3) |
| Workspace lead | Project lead | Their workspace, and what the organization expects | Same, plus their workspace |
| Viewer | External examiner | Read what they are allowed, without breaking anything | Per 26.8 |
| Visitor | Prospective student | Decide whether to join | Per the table in 34.2 |
| Former member | Removed student | A clear explanation, and nothing else from inside | About, if public |

Members stays admin only. Settings follows 22.3. Visitor tabs follow 34.2.

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
| Active, published | Organizations row and entry, "Student · Oct 2026 – Present" | Same, with Edit | Member |
| Role changed | History: "Student → TA" | Same | New role |
| Left, published | Entry, "Left Nov 2026", no Organizations row | Same | Gone; their past work stays |
| Removed | **Nothing** | Private note: "Removed Nov 2026", their own words kept | Gone; admins keep the history |
| Removed and blocked | **Nothing** | Same as removed; the block is never mentioned | Can't rejoin |
| Term ended or archived | Entry, "Completed Dec 2026" | Same, with a nudge to write it up | Read only |
| Show on profile turned off | Nothing | Same as active, "Hidden" | Unchanged |
| Organization deleted | Name kept with no link, "No longer on NetworkBase" | Same | Gone |
| Rejoined | Same as active; old period kept in history | Same | Member |

Rules that follow:

- **The Organizations section shows current members only.** A row means "is part of this now."
- **Removal withdraws verification**, because verification speaks for the organization.
- **A person's own words always stay theirs.** Removal hides them from others. It does not delete them, and they stay in the person's data export.
- **Removal of nested work:** a removed person's child workspace entries follow the same rule.
- **Leaving keeps credit.** Someone who finished and left did nothing wrong.

### 4.4 Role labels

Show: **organization role name · their title**, for example `Teacher · Course Instructor`.

- "Contributor" appears only when no role can be found at all.
- The role comes from the organization's own names, so a renamed role updates here too.

### 4.5 Profile design

**The chip row at the top is removed.** Current organizations move to a new **Organizations** section in the right column, between Collaboration preferences and Links:

```
COLLABORATION PREFERENCES
…
ORGANIZATIONS                                      ✎
[CS] CSE 3B · Data Structures 2026
     Teacher · Since Oct 2026
[+]  Join with code          (only on your own profile)
LINKS
…
```

- **Each row:** logo, name, role, opens the organization.
- **Current only:** leaving or being removed takes it off immediately.
- **People choose:** the pencil opens **Manage organizations**: a row per organization with a Show on my profile switch, and drag to set the order. Turning one off hides it from others, along with its contribution entry and nested workspaces.
- **Empty:** others see no section. You see a one-line hint.
- **Placement:** locked by the owner: right column, between Collaboration preferences and Links.

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
- **Visitors** never see a workspace that is private to the organization, beyond what §24.6 of the old concept allows. Section 38.5 has the full table, including private organizations.

### 4.6 Edit profile

Section 38 designs the editor field by field.

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

The admin's removal dialog shows this as a short list before confirming, using the counts already calculated in `collaborator-lifecycle.ts`. Designed in 36.5.

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
| GitHub | `GitBranch` | Pushed to GitHub (workspaces only; 24.3) |

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

Single shared components. See 7.6 and 7.7.

### 5.7 Status chips

One vocabulary across the app. Assignments: Not started, In progress, Submitted, Returned, Completed, Missing, Excused, plus a Late mark. Sprints: Upcoming, Active, Completed, Archived, Cancelled. Board column: Completed. One color each (39.1).

## 6. Lifecycle of an organization

Section 33 designs how this runs day to day.

| Stage | What people see |
|---|---|
| Creating | The 5-step wizard, already built. Fix the typo and the Discover copy. |
| Just created | A "ready" screen with the invite panel and a next step, then Overview. |
| Setting up | Overview shows Get started: three action cards, only while nothing exists. |
| Running | Overview becomes the daily view. |
| Term ending | Prompts: review open work, verify members, archive. Members get "Write up your contribution". |
| Archived | Everything read only, with one notice. Credit changes to "Completed". |
| Scheduled for deletion | Banner with Restore. |
| Deleted | Profiles keep the name with no link. |
| Suspended | Read only. The reason goes to the owner and admins only (27.7). |

## 7. Tab by tab, section by section

Section 16 describes how the combined tabs behave in each scenario. Every section below answers the same questions:

- **Job:** why it exists.
- **Stages:** how it behaves when empty, starting, active, and when something is wrong.
- **People:** what the owner or admin (A), member (M), guest (G) and visitor (V) get.
- **Buttons:** what each one does, and what happens after.

Unless a section says otherwise, loading uses a placeholder of the same shape, errors say what failed and offer Retry, and every action confirms in place.

### 7.1 Header (all tabs)

The tab bar below it is in 37.6.

| Part | Job | Behavior |
|---|---|---|
| Icon slot | Identity | Image, initials, or camera for owner. Camera opens Settings → Details at the image control. |
| Name, tagline | Identity | Tagline wraps; on phones it runs full width. |
| People row | Who is here | Photos, `40 members`, `· 5 workspaces`. For admins, members opens the roster; for others it's a count (34.2). Workspaces opens the Workspaces tab. `+` adds links, for those who can. |
| Numbers | Reach | Labeled the same as a workspace; tooltip names them. |
| Updated line | Freshness | As built. |
| Details line | Context | As built. |

**Buttons:**

| Button | Who | Does |
|---|---|---|
| `+ New` | A | Menu: Task, Announcement, Sprint, Workspace. Each opens the same form as its tab. This is the page's one filled button. |
| Invite | A | Opens the invite panel in a dialog. |
| Join or Request to join | V | Joins, or sends the request. Becomes "Request pending · Cancel". |
| Follow | V | Signed-in visitors of a public organization (37.8). |
| Share | All | The dialog in 37.7. |
| `⋯` | Signed-in non-owners | Report; Leave organization for members. |

**Top bar fix:** the top bar's "New workspace" is filled inside an organization but outlined inside a workspace. It becomes outlined everywhere, so the page has one main action.

### 7.2 Overview

**Job of the tab:** "What needs me today?" It stays calm when nothing does.

**Order:** Pinned, Get started (only while new), Today (33.5, which takes over Needs your attention's job and keeps its row design), How the class is doing for admins, This sprint, This week (was Coming up), Activity. Right column: Workspaces, People.

#### Pinned announcement

| Stage | Shows |
|---|---|
| None pinned | Nothing |
| Pinned | Megaphone icon, author photo, one line, time. |
| Unread by you | Same, with a dot. |
| Expired or unpinned | Goes away |

**Buttons:** the row opens the post. `×` hides it for you only. A: `⋯` → Unpin.

#### Get started

**Problem:** it's a plain list, none of it can be clicked, and it stays even when the organization is clearly running. Yours still says "Share the join code" while you have a sprint, an assignment, a workspace and an announcement.

**The rule:** Get started is temporary. It exists only while an organization has nothing in it.

| Situation | Result |
|---|---|
| Brand new: nothing created, only the owner | Shows, to A only |
| **Any real thing exists:** an announcement, sprint, task or assignment, workspace, document, uploaded file, or a second member | **Gone, with no leftover list** |
| Everything later deleted | Comes back, because the organization is truly empty again |

- **No workflow behind it:** it's calculated each time, with nothing stored and no database change. Starter folders don't count as uploaded files.
- **Nothing is lost when it goes:** each remaining idea now lives where it belongs. "Share the code" moves to the People section while you're alone. "Plan a sprint" lives in This sprint. "Post" lives in Updates' empty state.
- **Look:** a single row of 3 action cards, each with an icon and one line: **Invite people**, **Plan your first sprint**, **Create the first workspace**. Each opens the real form. No checklist, no progress bar.

**People:** A only. M, G and V never see it.

#### Today (was Needs your attention)

Section 33.5 makes this Today. The row design and types below stay.

**Problem:** rows read like plain text, with no sense of type or urgency.

**Row design:** icon by type, a bold short title, a quiet line of detail, a right-side action, and an arrow if it just opens something.

```
[icon]  3 submissions to review              Review →
        Lab 1 · oldest 2 days ago
[icon]  1 join request                       Review →
        Rama · via code · 1 day ago
[icon]  Team Osprey needs a new owner        Assign →
        Lead left the organization
```

| Type | Icon | Who | Action |
|---|---|---|---|
| Submissions to review | `ClipboardCheck` | A | Review → opens the task's roster |
| Join requests | `UserPlus` | A | Approve in place when there's one; otherwise Review → Members |
| Sprint ended | `IterationCcw` | A | Complete → opens the sprint |
| Workspace asks to leave | `LogOut` | A | Review → opens the request |
| Workspace has no lead | `UserX` | A | Assign → opens the dialog in 35.4 |
| Organization is full | `AlertTriangle` | A | Manage → opens Settings |
| Unusual joins | `ShieldAlert` | A | Review → opens Access |
| Verify at term end | `BadgeCheck` | A | Verify → opens Members |
| Overdue or due soon | `Clock` | M | Open → opens the task |
| Returned for changes | `CornerDownLeft` | M | Fix → opens the task |
| Unread required document | `BookOpenText` | M | Read → opens the document |
| Unread announcement | `Megaphone` | M | Read → opens the post |

| Stage | Shows |
|---|---|
| Nothing needs you | Compact "You're all caught up" with a check icon, one line tall |
| 1–5 | Rows, most urgent first: overdue, then review, then the rest |
| More than 5 | First 5, then "Show 3 more" expanding in place |

Rows leave the moment they're handled. Amber is used only for overdue, and red only for blocked.

#### This sprint

**Problem:** the whole name and date is crammed into the small label, and rows are plain.

**Design:** a real card.

```
THIS SPRINT                                   All sprints →
CO1 Arrays and linked lists          [Running]  13 days left
Everyone can implement and test arrays…
▓▓▓▓░░░░░░░░  4 of 12 tasks done

[icon] Lab 1: Arrays and linked lists   Due Sun 8 Nov   12/40 ▸
[icon] Prepare the rubric               Rama            In progress ▸
```

| Stage | A | M |
|---|---|---|
| No sprints | Ghost timeline, "Plan your first sprint" button | "No sprint right now" |
| Planned, not started | "CO1 starts Mon 9 Nov" and **Start now** | "CO1 starts Mon 9 Nov" |
| Running, nothing in it | "Nothing in this sprint yet", **Add task** | "Nothing assigned yet" |
| Running | As above, with class progress | Their own items and status, with Submit |
| Ended, not completed | "CO1 ended", **Complete** | "CO1 ended" |
| Between sprints | "Next: CO2 starts…" | Same |

**Buttons:** All sprints → Sprints tab. Rows open the task panel. For A, a `12/40` badge opens the roster.

**"0 of 0 done"** becomes "Nobody has joined yet", and links to Invite (39.4).

#### This week (was Coming up)

**Design:** small date tile (`SUN / 8`), title, type icon. Grouped: Today, Tomorrow, This week.

| Stage | Shows |
|---|---|
| Nothing | "Nothing due in the next 7 days", one line |
| Items | Up to 5, "See all" → Tasks |

- **Includes:** task and assignment dues, sprint starts and ends. M sees their own. A sees all.
- **Fix:** counts calendar days in the organization's time zone, so Lab 1 appears.
- **Buttons:** the row opens the item.

#### Activity

Uses section 5.3. Filters become one small menu in the section header. Shows 5, then "Show more".

| Stage | Shows |
|---|---|
| Nothing | "Activity shows here once people start working" |
| Items | Icon, sentence with bold subject, time underneath |

**Privacy:** M never sees another member's submission.

#### Workspaces (right)

**Problem:** a name and a time.

**Row:** avatar, name, one quiet line (`Rama · 6 members`), and a right-side chip: `2 overdue` or nothing. Time is the "Updated" time.

| Stage | A | M |
|---|---|---|
| None | "Teams work inside workspaces." **Create the first workspace** | "You're not in a workspace yet" |
| Some | 5, most in need first | Theirs first |

**Buttons:** rows open the workspace. See all → Workspaces tab. `+` in the section header (A).

#### People (right)

**Problem:** "Ramanayudu, 1 joined this week".

**Design:** stacked photos, `40 members`, `3 joined this week`. For A: `1 request` as a chip link.

| Stage | Shows |
|---|---|
| Only you (A) | Short invite panel: code with Copy, Invite by email |
| Growing | Photos and counts, Invite button |
| M | Photos and count, with no link (34.2) |

### 7.3 About

**Job:** "What is this, and should I join?" Same two columns as a workspace's Overview.

#### Welcome note

| Stage | A | M | V |
|---|---|---|---|
| None | Inline "Add a welcome note" | Hidden | Hidden |
| Has one | Note, with Edit | Note with `×` to tuck it away | Hidden |

#### About card

Same `WorkspaceOverviewCard` as a workspace: About, Who it's for, What happens here, with Read more.

- **Empty:** A sees "Tell people what this is" with **Add**. Others see a short fallback built from type and location.
- **Buttons:** Edit (A), Read more.

#### Workspaces list

Uses Row (5.2), not a dotted text line.

- **V:** public workspaces only.
- **None:** hidden for V; a prompt for A.

#### Stages (right)

| Stage | A | M, G | V |
|---|---|---|---|
| No sprints | Ghost timeline with 3 faded stops. "Your sprints become stages here." **Plan your first sprint** | "Stages appear once sprints are planned." | Hidden |
| One sprint | That stop plus a faint next stop, and "Add the next sprint" | One stop | One stop |
| Many | Full timeline, current marked | Same | Same, if Sprints is public |
| All done | All checked, "Completed Dec 2026" | Same | Same |

Stages is read only here. Clicking a stop opens that sprint for those who can see Sprints.

#### Recent activity (right)

Same 5.3 component, with public-safe kinds only.

#### Your card (right)

| Person | Card |
|---|---|
| A | Invite panel |
| M | "You're a Student · Joined 3 Oct", links to My membership |
| G | "Viewer · read only" |
| V signed out | Sign up to join |
| V signed in | Join, or Request to join |
| Request pending | "Requested · Cancel" |

#### Owner and admins (right)

Avatar, name, role in the organization's words, title, Message. Long names cut off. V sees only those who chose to show.

#### Details (right)

As built: handle, your role (A), time zone, since. Handle gets a Copy button.

### 7.4 Documents

Same screen as a workspace.

#### Document list (right)

| Stage | A | M, G | V |
|---|---|---|---|
| None | Empty state with **Add document** | "Nothing shared yet" | Tab says "No public documents" |
| Some | Groups, drag to reorder, `+` | Groups, unread dot, required chip | Public only |

**Row:** icon, title, chips: Required, Admins, New.

#### Reader (left)

Same reader as a workspace. Header shows title, updated by, read status. Empty document: "This document is empty", with **Start writing** for A. **Empty documents are never shown to V.**

#### Buttons

| Button | Does |
|---|---|
| `+` Add document | Dialog: title, Blank or template, or pick from Files. Stays on Documents and opens it in the editor. |
| Edit | Same editor as a workspace. |
| `⋯` | Group, Required, Who can see it, Show in workspaces, Link to sprint, History, Delete. All of today's admin tools move here. |

### 7.5 Updates

Same screen as a workspace, with **no separate options box.**

**Today:** `OrgUpdateOptions` sits in the right column as a box above the composer (`UpdatesTab.tsx:460`, `:580`), which is why it looks random.

#### Composer

| State | Looks like |
|---|---|
| Closed | Same one-line box as a workspace: photo, "Share something with CSE 3B…" |
| Open | Same composer. Organization options sit in its toolbar, the same way a workspace's options do. |

**Options inside the composer:**

| Control | Default | Notes |
|---|---|---|
| Type: Announcement, Discussion | Announcement for A, Discussion for M | Small switch at the top |
| Audience chip | Members | Everyone, Admins, Students, Selected workspaces, Public. Public spells out "Also on Discover". Live count: "Goes to 40 people". |
| Pin | Off | Toolbar icon, with until-date |
| Also email | Off | Toolbar icon; A only. Shows count. |
| Share in #general | Off | Toolbar icon |
| Comments | On | In the `⋯` menu |
| Task, sprint, file, image, link | As a workspace | Same icons |

**Buttons:** Post, with the real audience: "Post to 40 people". Discard asks first when there's text. M can post only if Settings allows; otherwise the composer is hidden and the tab says who posts here.

#### Feed (left)

Same post card. Adds an Announcement chip, Pinned at top, audience label. "From Team Falcon" for posts shared up.

| Stage | A | M | V |
|---|---|---|---|
| None | Faint post, "Post your first announcement. Everyone gets notified." | "No announcements yet" | "No public updates" |
| Filter empty | "No discussions yet", Clear filter | Same | Same |

**Filters:** All, Announcements, Discussions, From workspaces. Same style as workspace.

#### Recent activity (right)

Section 5.3. Empty line fixed: today says "Workspace members will appear here".

### 7.6 Sprints

Same screen as a workspace: list left, sprint right.

#### New sprint button

The only create button, top of the left column. **"Plan a series" is removed as a button** and lives in the form. Header `+ New → Sprint` opens the same form.

#### Create sprint form

Same dialog as a workspace. Same top half; organization parts are added in place.

| Group | Field | Default | Behavior |
|---|---|---|---|
| Basics | Sprint name | Next in sequence: `CO2` | Follows your naming |
| | Goal | Empty | One line |
| | Description | Empty | |
| Schedule | Start, End | Day after last sprint ends | 1, 2, 4 week shortcuts; shows `14 days · 2 weeks` |
| Repeat | "Plan more sprints like this" | Off | Turns on: How many, and preview: `CO1 · 1–14 Nov`, `CO2 · 15–28 Nov`, `CO3…`. Replaces Plan a series. Warns if it passes the term end. |
| Workspaces | Share with workspaces | All | All, Selected, or None |
| | Teams plan their own sprint inside it | Off | Plain words for "create a matching sprint" |
| Start | Start automatically on the start date | On | |
| Tell people | Post an announcement | Off | Text prefilled, editable |

**Buttons:** Create sprint, or **Create 5 sprints** when repeating, and Cancel. Saved changes confirm with a link to the new sprint.

**Settings defaults** still apply, as they do today (`OrgSettingsSections.tsx:465`).

#### Sprint list (left)

Grouped: Active, Upcoming, Completed, as on a workspace. Row: name, dates, goal, key.

| Stage | A | M |
|---|---|---|
| None | Timeline preview, teaching line, **Plan your first sprint** | "No sprints planned yet" |
| Some | Grouped | Same, without create |

#### Sprint detail (right)

| Section | Behavior | Buttons |
|---|---|---|
| Header | Name, goal, status, dates. Planning: "Starts 1 Nov". Running: "Started 1 Nov". | Edit, `⋯` by stage (37.2) |
| Primary action | Planning: **Start now**. Running: **Complete**. Completed: nothing. | Start asks about announcing; Complete asks about unfinished work |
| Numbers | Progress, days left, tasks, files | Open filtered Tasks and Files |
| Materials | Same as a workspace | Add material |
| Workspaces (A) | One line: `3 of 5 workspaces linked` | Opens a small panel: per-workspace status, Remind leads |
| Work | Task rows. Assignments have `12/40`. Same rows as a workspace | Row opens task panel; Add task |

**Removed:** the separate Assignments block, because the work list covers it.

**M sees:** their own status on each row, no class counts, no Workspaces block.

### 7.7 Tasks

Same screen as a workspace: **one board, one create button.**

**Removed:** the Assignments box above the board.

#### Create task button and form

"New task" is the only create button on the tab. The form is `CreateTaskModal`. It is called Create task for one person, and becomes Create assignment when it goes to many, without changing screens.

| Group | Field | Notes |
|---|---|---|
| Basics | Title, Description | Same |
| Who | **Assign to** | One picker (34.5): search a person, or choose Everyone, Admins, Groups, Each workspace, Selected workspaces |
| Sprint and status | Sprint, Priority | Status appears for one person only |
| Schedule | Due date | Required when many; includes time and shows the time zone |
| Points | | Hidden if Settings hides points |
| Steps | Subtasks, or "Steps copied to everyone" | Same control |
| Files | Attach | Reference material |
| **Hand-in** (appears only for many) | What they hand in: File, Link, Text, Nothing | |
| | Check each submission before it's done | On, from Settings |
| | Late work: Allowed, Until a date, Not allowed | From Settings |
| | Groups: auto-make, copy, or by hand (25.7) | Only when Assign to is Groups |
| Tell people | Share in #general, Post an announcement | Only for many |

**Buttons:**

- **One person:** Create task, Cancel.
- **Many:** **Publish to 40 people**, Save as draft, Cancel.
- **No one to publish to:** "Nobody has joined yet. New people get this when they join." Publish still works, and new joiners get copies, as the code does today.
- **Past due date:** warns before publishing, as today.

#### Toolbar

Same as a workspace: Board with count, Filter, All tasks, Sprint, Backlog, In review. **Assignments** and **Mine** are added as filters. Code editor moves into `⋯` unless you've connected one (24.2). New column (A). Completion note moves into `⋯`.

#### Board and cards

**Fix:** always opens at the first column.

| Card | Shows |
|---|---|
| Normal task | Same as a workspace |
| Assignment (A view) | Title, due, `Assignment` chip, progress `12/40`, sprint chip. One card, moved by its overall state. |
| Assignment copy (M view) | Normal card, `From CSE 3B`, due, status: Not started, Submitted, Returned, Done |
| Group copy | Same, with group name |

| Stage | A | M |
|---|---|---|
| Nothing | Empty columns, To do says **Create the first task** | "Nothing assigned yet" |
| Draft assignment | Card with `Draft` | Hidden |
| Overdue | Same as a workspace | Same |

#### Task panel

Same side panel as a workspace. Assignments add one section, **Roster** (A):

| Part | Behavior |
|---|---|
| Counts | Done, Submitted, Missing, Excused. Each filters the list. |
| Row | Name, status, late mark, submission, Approve, Return |
| Buttons | Approve all submitted, Remind missing, Extend, Excuse, Close, Delete |

**M gets a Submit section,** designed in full in 34.4.

### 7.8 Files

Same screen as a workspace, top to bottom. **Nothing sits above the browser.**

**Removed from this tab:** the storage line (moved to Settings) and the Folder access box (moved into each folder).

#### Left panel

| Item | Who | Notes |
|---|---|---|
| All files | All | Same name as a workspace, replacing "Org files" |
| Task files | A, M | Same |
| Sprint materials | A, M | Today a separate box |
| Submissions or Final files | A | The organization type's word; today a separate box |
| Recent, Starred, Trash | All | Trash only for those who can delete |

#### File list

Same table: name, last updated, size, updated by, `⋯`. Folders with limited access show a small chip: `Admins`, `Public`, `Template`.

#### Folder access

Inside each folder's `⋯` → **Who can see this?** Opens a small dialog:

- **Choices:** Everyone in CSE 3B, Admins only, Public.
- **Consequence line:** "12 files inside will become public."
- **Also here:** "Use as template for new workspaces".

Also available from the folder's header. Members never see these controls.

#### Buttons

| Button | Who | Does |
|---|---|---|
| Upload | A | Same as a workspace |
| New folder | A | Same; asks who can see it |
| Code editor, `⋯` | Same | Same |
| `⋯` on a file | A | Same menu, plus "In use by CO1" when delete would break something |

#### Stages

| Stage | A | M | V |
|---|---|---|---|
| New | Starter folders, each with one line about its purpose | Folders they can see | Public only |
| No files | "Share materials here. Everyone in CSE 3B can see what you add." **Upload** | "No files shared yet" | Tab hidden if nothing is public |
| Storage nearly full | Single slim notice: "Storage is 85% full · Manage", opening Settings | Nothing | Nothing |
| Full | Upload explains and links to Settings | "Storage is full. Ask an admin." | Nothing |

### 7.9 Workspaces

**Job:** "How are the teams doing?" Section 35.5 holds its layout, rows and actions in full.

| Section | Behavior | Buttons |
|---|---|---|
| Summary | `5 workspaces · 1 needs attention · 1 quiet · 2 people not in one`. Each part filters. | Filter |
| Controls | Search, Status, Sort, Mine, List or Cards | **Filters** menu: Visibility, Stage, Owner, Sprint |
| Create | One button | **New workspace** opens the wizard with this organization picked |
| List row | Avatar, name, visibility chip, lead, members, stage, counts, Updated line, reason in plain words | Open, Remind lead, `⋯` Archive or Detach |
| Card view | Same `WorkspaceCard` as Discover | Same |
| Bulk | Selecting shows a bar | Remind leads, Archive |

| Stage | A | M |
|---|---|---|
| None | Two faint cards, teaching line, **Create the first workspace** | "You're not in a workspace yet", Browse |
| Filter empty | "No workspaces match", Clear filters | Same |
| Needs attention | Reason shown in amber with one action | Hidden |

**M sees:** their workspaces first, no bulk, no attention reasons.

### 7.10 Members

A only, as today. Role changes, Outside actions, Former and the Remove dialog are in section 36.

| Section | Behavior | Buttons |
|---|---|---|
| Summary | `40 members · 2 admins · 1 guest · 3 behind · 2 inactive`. Each filters. Correct plurals. | Filter |
| Controls | Search, Role, Workspace, Status, Sort | Clear |
| Roster row | Photo, name, role chip, title, workspaces, work line, last active | Row opens the panel |
| Bulk | Selecting shows a bar | Remind, Add to workspace, Change role, Verify, Remove |
| Requests | Name, how they came, note, age | Approve, Decline, Approve all |
| Invite | Invite panel, 7.11 | |
| Pending invites | Email, age | Resend, Cancel |

**Member panel:** role, title, work, activity, then Message, Change role, Verify, Remove. Remove opens the dialog in section 4.7, showing consequences, and offers Transfer in place if they own a workspace.

| Stage | Shows |
|---|---|
| Only you | Your row, "You're the only one here so far", invite panel larger |
| Requests | Sorted to top; on phones they come first |
| Filter empty | "No one matches", Clear |

### 7.11 Invite panel

```
INVITE PEOPLE                                       ⋯
┌───────────────────────────────────────────────┐
│  N Z W H M 9                       [Copy code]│
│  networkbase.in/join/NZWHM9        [Copy link]│
└───────────────────────────────────────────────┘
[ Invite by email ]
Anyone with this code can join · Needs approval
```

| Button | Does | After |
|---|---|---|
| Copy code | Copies | Check and "Copied" on the button for 2 seconds |
| Copy link | Copies the full link | Same |
| Invite by email | Opens the dialog | See below |
| `⋯` New code | Warns the old one stops working | New code, "Old code no longer works" |
| `⋯` Turn off code | Stops code joining | "Joining by code is off", Turn on |
| `⋯` Join settings | Opens Settings → Joining | |

**Invite by email dialog:**

- **Fields:** emails as chips (paste many; bad ones flagged in place), role, title, workspace, message.
- **Preview:** live preview of the email.
- **Send:** "Invite 12 people". Shows results: sent, already members, failed.

**Join page:** logo, name, type, tagline, member count, who runs it, what you get, and Join or Request to join. It handles expired code, off code, already a member, blocked ("You can't join this organization."), and signed out.

### 7.12 Settings

Section 22 holds the menu and every field. The Storage design below stays here.

#### Storage section (new)

Modeled on your Mac's Storage screen, with one clear bar and a list. Replaces the line on Files.

```
Storage
CSE 3B                                    0.4 GB of 5 GB used
[▓▓▓▓▒▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]      4.6 GB free
● Documents  ● Images  ● Video  ● Code  ● Submissions  ● Other

RECOMMENDATIONS
Empty Trash                               Free up 120 MB  [Empty]
Review large files        3 files over 100 MB            [Review]
Old versions                              Free up 60 MB  [Review]

BY TYPE                                   BY WORKSPACE
Documents        210 MB  →                Team Falcon    90 MB  →
Images            90 MB  →                Team Osprey    40 MB  →
Trash            120 MB  →
```

| Part | Behavior |
|---|---|
| Bar | Segments by type. Amber from 80%, red at 100%. |
| Recommendations | Shown only when they'd help. Each one states what it frees. Hidden when none apply. |
| By type | Opens Files, filtered. |
| By workspace | A read-only Teams list; team storage stays separate (19.2) |
| Empty | "Nothing stored yet. Your 5 GB is ready." |
| Who | A only. M sees nothing. |

**Data:** the total comes from `storage_quota_scopes`, as today. Type totals come from file size and type, and should be cached rather than recalculated on every open. Workspaces get the same section, for consistency.

### 7.13 Consistency for members

Every tab above has a member version. The rules:

- **Same layout as admins.** Controls they can't use are absent, never disabled.
- **Their own work first:** status, due, and Submit.
- **No class numbers:** never others' progress or marks.
- **Empty states say who acts:** "Your teacher hasn't…", using the organization's word.
- **Same parity with workspaces:** a member of an organization should recognize every tab from any workspace they've been in.

## 8. Workspaces inside an organization

Sections 17 and 18 hold the full audit and design.

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
| 9 | Empty documents should never reach visitors. New organization documents already start as members only (`AddDocDialog.tsx:52`). Child workspaces' starter documents are still to check. | 7.4, 18.5 |
| 10 | Updates default to Public, which also reaches Discover | 7.8 |
| 11 | Removed-person links have no explanation page | 4.7 |
| 12 | Removal dialog doesn't show consequences | 7.10 |
| 13 | Term-end has no guided moment for verifying and writing up | 6 |
| 14 | Join page doesn't handle every code state clearly (to confirm) | 7.11 |
| 15 | Get started stays after work has clearly begun | 7.2 |
| 16 | Needs your attention has no type, urgency, or one-click action | 7.2 |
| 17 | Top bar button is filled in organizations but outlined in workspaces, giving two main buttons | 7.1 |
| 18 | Storage shows as a stray line on Files and has no way to free space | 7.12 |
| 19 | Updates options are a box outside the composer | 7.5 |
| 20 | Empty line in Recent activity is wrong for organizations | 7.5 |
| 21 | Handle has no copy button | 7.3 |
| 22 | A member can get an assignment twice: the main task and their own copy | 16.1 |
| 23 | "X left" notifications reuse the member-joined setting | 16.11 |
| 24 | Assignment cards don't reflect class progress on the board | 16.1 |
| 25 | Admin chip shows for the workspace's own owner | 17.1 |
| 26 | Organization name appears three times in a child workspace's header | 17.1 |
| 27 | Follow and view counts show on organization-only workspaces | 17.1 |
| 28 | Browser tab title is generic for people who can see the workspace | 17.1 |
| 29 | Linked sprint dates can run past the organization sprint's end | 17.3 |
| 30 | Sprints' empty state has two competing main buttons | 17.3 |
| 31 | `GroupCopiesPanel` and "From the organization" repeat the split on Tasks and Files | 17.4, 17.5 |
| 32 | "Open roles" and "Teams and open seats" are two names for one thing | 17.2, 17.8 |
| 33 | Composer defaults to Public on an organization-only workspace | 17.7, 18.4 |
| 34 | Default dates make linked sprints fail | 18.1, 18.2 |
| 35 | "Not part of an organization sprint" can mislead on a following workspace | 18.1, 18.2 |
| 36 | Following can't be changed after creation | 18.1, 18.7 |
| 37 | Tasks have no team assignment | 18.3 |
| 38 | Group work's locked fields aren't marked on the card (locks to confirm on the server) | 18.3 |
| 39 | Composer's audience doesn't match the workspace | 18.4 |
| 40 | Visibility is split across two settings sections | 18.7 |
| 41 | Random address endings, even when the name is free | 18.1, 18.7 |
| 42 | Team sprint has no fix when CO1's dates change | 18.2 |

Section 20 lists a further 68 missing or thin areas, plus 6 conflicts.

## 12. Build order

Each step is reviewed before the next. Section 41 has the rollout rules, and 41.2 lists each database change.

| Step | What | Why this order | Database change |
|---|---|---|---|
| 1a | Privacy (41.3), plus hiding drafts (42.7), hiding Admins-only material names (42.10), the sprint timeline rule (42.12), the live update rule (42.13) and the post audience fixes (42.15) | People's data comes first | Yes, Last active here and the database visibility rule |
| 1b | Correct work (41.3), plus the fixes in 42.7, 42.10, 42.12, 42.16 and 42.17, and the editor's task push (45.4) | Stops wrong or lost work | No |
| 1c | Notices (41.3), plus Reminders Off covering overdue (42.7) and the deleted-account notice (45.5) | Stops people losing reminders | To confirm, the two new event types |
| 1d | Wording (41.3) | Quick and safe | No |
| Before the tabs | The type profile (21.5) | Every tab reads it | Yes, fills saved settings for existing organizations |
| 2 | **Membership and profile**, including the Organizations section, the private page states, the leave dialog (26.11), who ended a membership (36.7), and the full contribution editor (38.10) | The accuracy problem you raised | Yes, `end_reason`, who ended it, the reason, and nudge dismissed |
| 3 | Shared blocks: Section, Row, Activity, Empty state, Plurals and role words (39.5), Tab bar (37.6) | Everything after uses them | No |
| 4 | Overview, including temporary Get started, Today, This week, How the class is doing, the sprint-ending row, Close-out list, and redesigned sections | Most visible | Yes, welcome panel dismissed |
| 5 | About, including Stages | Uses the same blocks | No |
| 6 | Invite panel and join page | Used on three tabs | No |
| 7 | Updates: options inside the composer | Contained | Yes, Hide from organization |
| 8 | Files: unified, folder access in menus | Removes extra boxes | No |
| 9 | Settings (section 22), including the new Storage section, Term summary, files attached to assignments on Duplicate (42.7), Ask to take over (45.2), and the downloads in Archive and Delete (45.7) | Receives what Files gave up | Yes, the take-over request |
| 10 | Documents | Small | No |
| 11 | Workspaces and Members, including Export progress | Organization-only tabs | No |
| 12 | Sprints: one form with Repeat, the sprint summary, sprint handover (42.6), Plan your sprint bringing group work, and sprint materials on Duplicate | Medium | No |
| 13 | Tasks: one form, one board, roster panel, Use again, Export progress, publish timing, Fix by, submission record, materials (42.5), Late after (45.3) | Largest; own plan | Yes, submission record table and Late after |
| Discover | The card, filters and ✓ (31.8) | Small and separate | No |
| 14 | Everywhere else, phones, dark mode, Preview as member (45.6), final pass | Finish | No |
| Pilot | One real class for two weeks (41.1) | Real use before opening up | No |
| Before opening up | Landing section and teacher guide (45.8) | People can find it | No |
| After the pilot | Away, Catch up and Reviewers | Medium priority (33.8) | Yes, Away table and Reviewers field |
| Later | Repeat assignment and Calendar | Valuable, but bigger | Yes for Calendar, a private link token |

Section 17 and 18's changes for child workspaces ship in the same step as the matching organization tab, because they share screens.

Repairing the browser test suite runs alongside steps 1a to 1d. Section 21.5 says where types, permissions and limits go.

## 13. Locked decisions

Locked by the owner on 2 November 2026. Where marked, these replace the older concept report.

| # | Decision | Replaces older rule? |
|---|---|---|
| 1 | After removal, others see nothing. The person keeps a private copy of their own words. | Yes |
| 2 | After leaving by choice, the entry stays with "Left Nov 2026" and no Organizations row. | Partly |
| 3 | A removed person who rejoins gets their words back as an unpublished draft. | New |
| 4 | "Show on my profile" is one switch per organization, with per-entry publish under it. | Refines |
| 5 | Organization posts default to Members. | Yes |
| 6 | "Assignment" stays as a chip on cards. The button is "New task". | Refines |
| 7 | Get started is temporary and disappears once any real thing exists. | Yes |
| 8 | Updates, Sprints, Tasks and Files are unified with the workspace screen. Organization options live inside them. | Yes |
| 9 | Plan a series moves into the Create sprint form. | Yes |
| 10 | Assignments and tasks share one create form and one board. | Yes |
| 11 | Folder access moves into each folder's menu. | Yes |
| 12 | Storage moves from Files to its own Settings section. | Yes |
| 13 | The profile's chip row is removed; organizations get a right-column section, between Collaboration preferences and Links, that people control. | Yes |
| 14 | Assignments sit on the one board and move automatically, from what students have done. Teachers don't drag them. | Yes, replaces older decision 25 (separate list, board for staff only) |
| 15 | Students see only their own copy of an assignment, never the main task as well. | Yes |
| 16 | Assignments keep shared class questions and a private conversation with the reviewer. A student's copy shows both, because they no longer open the main task. | Keeps older decision 26 |
| 17 | Past-due work isn't given to late joiners automatically; the teacher can give it. | Matches current code |
| 18 | Scheduled posts are left out for now. | New |
| 19 | Section 16 is the agreed behavior for every combined tab, the profile, and edit contribution. | New |
| 20 | Section 17 is the agreed design for workspaces inside an organization. | New |
| 21 | On a child workspace, What's happening stays above About. | Yes, replaces older decision 79 |
| 22 | Follow and view counts are hidden on organization-only workspaces. | New |
| 23 | Section 18 is the agreed design for child workspace forms and panels. | New |
| 24 | Create linked sprint is removed; one form covers every case. | Yes |
| 25 | Assigning to many stays with the organization, not teams. | Matches older concept |
| 26 | Teams can't delete group work. | Matches older concept |
| 27 | Posts never default to Public. | Extends decision 5 |
| 28 | Leaving the organization moves to Management in Settings. Members and admins see only Leave there (22.3). | New |
| 29 | Deleting an organization: each workspace chosen separately; other people's workspaces are always kept (19.1). | Refines older decisions 127 and 166 |
| 30 | Team storage stays separate from the organization's, at 2 GB inside an organization (19.2). | New |
| 31 | Group work fields are locked on the server, by one shared check (19.3). | New |
| 32 | Organization type sets words and starting values, never power. Settings stop following the type once saved (21.2). | New |
| 33 | One permissions table decides everything, and a test keeps the actions in line with it (21.3). | New |
| 34 | Every limit is checked before starting and has a plain message. Up to 500 invites per paste (21.4). | Replaces the older 200 |
| 35 | Organization Settings follows the menu and fields in section 22. Members, Stages, Task completion and member upload controls are removed for organizations. | New |
| 36 | One review setting, in Work, replaces Task completion and Review required on an organization (22.4). | New |
| 37 | Comments follow the same visibility rule as the task, so private conversations stay private (23.5). | New |
| 38 | Assignment cards can't be dragged and always sit in a fixed column (23.4). | New |
| 39 | After publishing, steps can only be added. Hand-in type locks at the first submission (23.3). | Extends the older concept |
| 40 | Approved copies can be returned, and closed assignments can be reopened (23.2, 23.3). | New |
| 41 | Inside an organization, an Organization only or Private workspace can only use a private repository. Checked on connect and on every push (24.3). | New |
| 42 | The code editor follows the website's rules: members are read only on organization files, and the button says so (24.2). | Follows the older concept |
| 43 | Assignment copies aren't offered in publish-and-complete, and closing keywords are dropped. Hand-in goes through Submit (24.3). | Replaces an older concept line |
| 44 | Workspace, Workspace lead, Team, Team lead and Group each mean one thing (25.2). | New |
| 45 | One Teams screen for leads and admins. Accepted applicants are placed in their team. Up to 10 seats per team (25.3, 25.4). | New |
| 46 | Ask to change team goes only to organization admins, as a request they can act on (25.5). | Extends B48 |
| 47 | Late joiners on group assignments show in the roster, and admins are told (25.7). | New |
| 48 | The private organization page shows each person their own state: invited, waiting, declined, left, removed, blocked or ended (26.9). | Extends gap 11 |
| 49 | A welcome panel shows once after joining (26.7). | Follows the older concept |
| 50 | Someone who leaves and comes back gets new copies of open assignments (26.10). | New |
| 51 | Viewer replaces Guest on screen. Viewers join only by email invite (26.8). | New |
| 52 | Duplicate moves dates from the term start, or else the first sprint (27.4). | New |
| 53 | A suspension's reason goes only to the owner and admins (27.7). | Replaces section 6 |
| 54 | Term-end prompt for Education, from 14 days before. Nothing archives by itself (27.5). | New |
| 55 | Names are 3–100 characters and welcome notes 500, everywhere (27.8). | Replaces older 2–80 |
| 56 | A verified badge is rechecked when the website or, for staff-verified organizations, the name changes (27.9). | New |
| 57 | Move-in and leave requests get Approve and Decline, in Workspaces → Requests and Needs your attention (28.6). | New |
| 58 | Admins see Seen and Read counts from existing data. "Read" means opened (28.3, 28.4). | Older concept said later |
| 59 | Editing a sprint's dates can move later Planning sprints too; there's no series record (28.2). | New |
| 60 | Inactive counts 14 days from joining. Remind reports who was really sent and skipped (28.7, 28.8). | New |
| 61 | Admins-only folders can't be templates (28.5). | New |
| 62 | Admins see last active in this organization only, never account-wide (29.4). | New |
| 63 | People are told what admins can see, on the join page, in What's allowed and in the Privacy Policy (29.4). | New |
| 64 | A personal block never stops work or tells anyone. Auto-made groups quietly avoid blocked pairs (29.3). | Extends the blocking design |
| 65 | People blocked from rejoining are listed, and can be unblocked (29.3). | New |
| 66 | Reminders and team or group moves get their own event types (30.4). | New |
| 67 | No new email types. The author is told when the daily limit stops an email (30.5). | New |
| 68 | My work gets a Submitted filter with Download, including during deletion. Invitations is renamed Requests (30.7). | Delivers 19.1 |
| 69 | Discover, the sitemap and page indexing use one check, so new organizations aren't indexed until they qualify (31.2). | Extends older decision 160 |
| 70 | The organization's ✓ shows on its header, cards and Discover (31.6). | Delivers older concept 30.3 |
| 71 | The profile's Workspaces section holds workspaces only; organizations live in the section from 4.5 (31.3). | New |
| 72 | Members shows who's verified, with a filter. People who've left can't be verified afterwards (31.4). | New |
| 73 | Discover cards have no Join button; Join is on the page (31.6). | New |
| 74 | Due dates are entered in the organization's zone and shown in your own; notices always use the person's zone (32.5). | New |
| 75 | One visible focus ring everywhere, and every browser pop-up becomes the shared dialog (32.3). | New |
| 76 | Roster, review queue, Overview, badges and Members requests update live, by reloading their own data (32.4). | New |
| 77 | A failed save always keeps what the person wrote (32.6). | New |
| 78 | No swipe to approve on phones (32.7). | New |
| 79 | Stages come from the data; nobody sets them (33.2). | New |
| 80 | Overview leads with Today, by person. Coming up becomes This week (33.5). | Changes 7.2 |
| 81 | Admins see How the class is doing: on track, behind, inactive (33.5). | New |
| 82 | Use again, Export progress, Close-out list and Term summary are high priority; Away, Catch up and Reviewers medium; Repeat assignment and Calendar later (33.8). | New |
| 83 | Exports hold statuses and dates, never submission content (33.5). | New |
| 84 | One set of status words, and one visitor tab table (34.2). | Settles conflicts |
| 85 | Submit lives in the task panel, for every hand-in type, with an optional note. Approved work is locked (34.4). | New |
| 86 | Returned work keeps showing Returned past its due date (34.4). | Fixes code |
| 87 | Only owners and admins create tasks on the organization's board (34.5). | Follows older concept 16.2 |
| 88 | Give to makes a copy for someone without one, with a due date (34.6). | Delivers decision 17 |
| 89 | Team tasks use the one task form; the Team task button goes (34.7). | New |
| 90 | A workspace holding work handed in to the organization can't be deleted, only archived (35.3). | Extends decision 23 |
| 91 | Workspaces can be unarchived. If an admin archived it, only an admin can (35.3). | New |
| 92 | Admins assign a new lead only when a workspace has none; otherwise only the lead can transfer (35.4). | Keeps 17.10 |
| 93 | Archiving a workspace always tells its team and lead (35.3). | New |
| 94 | Changing a role changes copies too: admins hold none; Viewers made Members get open work. The dialog lists the effects (36.2). | New |
| 95 | Nobody can review their own or their group's submission (36.2). Assignment copies only; normal workspace tasks keep today's rule (42.18). | New |
| 96 | Outside people can submit only group work assigned to them (36.3, corrected in 39.1). | Follows the permissions table |
| 97 | Members gets a Former filter, keeping who ended a membership and the reason written (36.4). | New |
| 98 | Nothing depends on the person who created work; "From" falls back to the organization (36.6). | New |
| 99 | Sprints get Cancel and Archive; Duplicate sprint is dropped (37.2). | Changes 7.6 |
| 100 | Admins can hide a shared post from the organization's feed; it stays in the workspace (37.3). | New |
| 101 | Documents have Draft, Published and Unpublished changes. Telling members is off by default (37.4). | New |
| 102 | Only organizations and workspaces get the Share dialog; items inside get Copy link (37.7). | New |
| 103 | Followers get public posts in Discover only, with no notifications by default and no list (37.8). | New |
| 104 | Role and dates from the record are locked on the server; people can add detail and their own marked steps (38.3, 38.4). | Fixes code |
| 105 | A private organization's entry shows only to you and its members (38.5). | Follows older concept 24.4 |
| 106 | Start from my work and Work record count only approved or finished work (38.7, 38.8). | Fixes code |
| 107 | Write-up nudges appear in the product, once each, and clear on publish or dismiss (38.6). | New |
| 108 | The shipped terminology in `terms.ts` wins: sprints are Upcoming, Active, Completed, Archived, Cancelled; finished work is Completed (39.1). | Corrects 34.2 |
| 109 | The permissions in 39.2 and notices in 39.3 are the full lists. | New |
| 110 | One glossary by type; sentences avoid "a/an" and role plurals (39.4). | New |
| 111 | The mockups in section 40 are the look to build to; where they differ from the report on behaviour, the report wins. | New |
| 112 | Step 1 ships as four deploys: privacy, correct work, notices, wording (41.3). | Replaces the single step 1 |
| 113 | No feature flags. If real classes are running when the Tasks step arrives, that step alone gets one temporary switch (41.1). | New |
| 114 | One real class pilots for two weeks before opening up (41.1). | New |
| 115 | Normal workspaces look unchanged unless listed in 41.6. | New |
| 116 | Database changes only add, and go live before the code that uses them (41.2). | New |
| 117 | Rollout sends no catch-up notices, and an empty Last active here never counts as inactive until the full inactive period has passed (41.4). | New |
| 118 | Success is measured by one read-only SQL file run monthly, with no analytics tool. Targets are set after the pilot (41.7). | New |
| 119 | The launch adds no scheduled job (41.8). | New |
| 120 | One lifecycle each for assignment, copy, sprint and group work (42.3). Members see only Open and Closed assignments. | New |
| 121 | Three shared rules in the code: who can see an assignment, when something was handed in, and when a lead changes (42.4). | New |
| 122 | When the next sprint's start arrives and the current sprint's end date has passed, the current one completes by itself, with nothing moved, and the next starts (42.6). Organization sprints only; other sprints close by hand (42.18). | Changes 37's "Never automatic" |
| 123 | A series ends each sprint the day before the next starts (42.6). | Changes the series rule |
| 124 | Assignments stay in their sprint when it closes; only tasks count as unfinished work (42.3). | New |
| 125 | Publish now, When the sprint starts, On a date, or Save as draft (42.5). | New |
| 126 | Return asks for a reason and a Fix by date, 3 days by default; that person can resubmit until then (42.5). | Changes 34.4's "if late work is allowed" |
| 127 | Each hand-in is saved and locked as a version; files change only by resubmitting (42.5). | New |
| 128 | Materials live on the main assignment and show read only on each copy (42.5). | New |
| 129 | Group work is held by whoever leads the workspace, whichever way the lead changed; a workspace that moves in gets open group work (42.2, 42.4). | Extends 35 |
| 130 | Detaching keeps handed-in group work on the teacher's roster as Detached; only unsubmitted work is released (42.5). | New |
| 131 | Plan your sprint offers to pull in the workspace's group copies (42.5). | New |
| 132 | Duplicate also copies sprint materials and files attached to assignments (42.2). | Extends 27.4 |
| 133 | Every assignment email, notice and search result opens that exact work; links use the Tasks tab and the task panel (42.10). | New |
| 134 | Transfer asks the person to confirm their identity in place, on organizations and workspaces (42.10). | New |
| 135 | "Allowed until a date" requires a date, 7 days after the due date by default (42.10). | New |
| 136 | Publishing a draft handles people or workspaces that are gone; Duplicate resets who it's assigned to (42.10). | New |
| 137 | A file in an Admins-only folder can't quietly become a sprint material, and its name stays hidden from members (42.10). | New |
| 138 | Moving someone between teams offers to move them on open team tasks too (42.10). | Extends 25.5 |
| 139 | An organization admin not on the team can create and move tasks in a workspace, marked `Viewing as admin`, the same as its Sprints tab (42.11). | Settles a conflict |
| 140 | A copy reaches Submitted or Completed only through Submit; moving it on the board can't hand it in (42.12). | Extends 34.4 |
| 141 | One review path: the task panel and the queue use the same actions and the same notices (42.12). | Extends 23.2 |
| 142 | Deleting a main assignment always follows the assignment rule, from any screen, and tells the people who had it (42.12). | Extends 23 |
| 143 | Anything already handed in stays when someone leaves, including Returned work (42.12). | Extends 36.6 |
| 144 | An organization sprint's numbers count assignments by their copies, and its timeline uses the same visibility rule as the board (42.12). | New |
| 145 | Live board updates for a copy go only to its people and the organization's admins, never to the whole organization (42.13). | New |
| 146 | Admins can put tasks in sprints, the same as owners, in organizations and normal workspaces (42.13). | New |
| 147 | A main assignment's panel has no Status, Section or Assignee controls; its state comes from its copies (42.13). | Extends 23.4 |
| 148 | The state and role tables in 42.13 are the full rules for what each person can do on an assignment. | New |
| 149 | Only admins and a team's lead reassign a copy within its team; an individual copy can't be reassigned (42.14). | New |
| 150 | Organization admins can open, read and review group work from the organization, with its files and private conversation (42.14). | New |
| 151 | Files on a handed-in copy are locked with the submission (42.14). | Extends 127 |
| 152 | Organization posts default to the organization's members; Public is chosen on purpose and says "Also on Discover" (42.15). | Matches 7.5 |
| 153 | Followers hear only about Public posts meant for everyone (42.15). | New |
| 154 | One audience rule for the feed, Overview, the sidebar dot, likes and comments (42.15). | New |
| 155 | The server sets the post type by role, on create and on edit: admins announce, members discuss (42.15). | New |
| 156 | Read-only organizations and workspaces refuse every post change, not only new posts (42.15). | New |
| 157 | Handing in is never blocked by organization storage; hand-ins have their own allowance (42.16). | New |
| 158 | The assignee or team can rename, remove and replace files on their own copy before Submit, from Files, the task panel or the editor (42.16). | Extends 151 |
| 159 | In a workspace's Settings, organization admins not on the team see Organization and Members and teams, so they can manage teams and seats (42.17). | Follows 139 and 21.3 |
| 160 | Settings' second Members list on an organization is removed in deploy 1b, not the Settings step, because it skips organization rules (42.17). | Moves 22.1 #7 earlier |
| 161 | Every organization fix is scoped to organizations, their workspaces or assignment copies, unless 41.6 lists it as shared on purpose (42.18). | New |
| 162 | Each shared change gets a normal workspace test before it ships (42.18). | New |
| 163 | Launch is 18 and over only. The Education card says "A college or university class"; the join page and invite email say "You must be 18 or older to join"; Report gains "This person may be under 18", sent to the team in 29.2. Built in deploy 1d. School classes are a separate project later, with parent consent and a lawyer (44.1). | Settles 29.5 |
| 164 | The pilot runs on Resend's free plan with one class. Resend Pro ($20 a month) is bought before a second class or any organization over 60 people starts. The measures SQL counts emails waiting more than an hour; no new alert (44.2). | New |
| 165 | Inngest stays on the free plan through the pilot, checked weekly. A paid plan is bought before more than 5 classes are active, half the estimate in 44.2, as a margin. | New |
| 166 | Until the owner runs the count in 44.4, every deploy assumes real classes are running: the Tasks step gets its temporary switch (113), and each of deploys 1a to 1c sends one notice to every organization's owner saying what changed. | Settles 113's condition |
| 167 | The Privacy Policy section is drafted in deploy 1d and kept unpublished until a lawyer reviews it. Opening up waits for that (41.9). | New |
| 168 | Notification load is measured without a staging step: the scale test also counts the notices and emails one publish writes, and the pilot reads the real cost from the Inngest and Resend dashboards (44.3). | Replaces "measured on staging" |
| 169 | The choices that began as my recommendations (122, 139, 146, 149–151, 157) stay as written. | Confirms them |
| 170 | When the owner hasn't been active in the organization for 30 days, an admin can Ask to take over. The owner has 7 days to refuse; after that the admin confirms and becomes owner, and the old owner becomes an admin (45.2). | Corrects 33.7 |
| 171 | Each assignment has Late after, 15 minutes past the due time by default, set by admins, 0 allowed. Members still see the due time (45.3). | Extends 20 |
| 172 | Resumable uploads wait for the pilot: the measures file counts failed hand-in uploads, and they're built only if those show up (45.3). | New |
| 173 | The editor's task push names its task in the shared write check, and the hand-in lock lives in that check, so Files, the task panel and the editor obey the same rule (45.4). | Extends 151 and 158 |
| 174 | When a member's account is finally deleted, each of their organizations' admins get one notice saying how many submissions went; the roster shows them under Former as "Deleted user" (45.5). | Extends 30.7 |
| 175 | Admins get a read-only Preview as member, through the member read rules, with a banner and every action off. Nobody is signed in as anyone else (45.6). | New |
| 176 | The Archive and Delete dialogs offer Export progress and Download all, one assignment at a time, before the owner confirms (45.7). | Extends 27.5 and 19.1 |
| 177 | Before opening up: a "For classes and teams" section on the landing page, and one help page, "Running a class on NetworkBase", linked from the Ready screen and the empty Overview (45.8). | New |


## 14. Calls made in writing this

These are my choices, not agreed decisions. Correct any:

- Two contribution groups on the profile.
- Removed entries are hidden even when they had real work.
- Icons listed in 5.3.
- Settings menu order in 22.3.
- The three action cards in Get started, and what counts as "real work".
- Needs your attention icons and actions, and the This sprint card design.
- The Storage section's recommendations, and showing By workspace.
- Adding Storage to workspaces too.
- Moving the Organizations section with Manage organizations and drag to reorder.
- Making the top bar's "New workspace" outlined everywhere.
- Document templates in 7.4 are optional and can be dropped.
- QR codes were left out of the invite panel as unnecessary for now.
- Step order in 12.

## 15. Left to the builder

- Exact spacing, following the existing design tokens.
- Component and file names, reusing what exists first.
- How to group activity efficiently.
- Migration details, under the project's migration rules.

## 16. How each part works, end to end

Accepted by the owner on 2 November 2026. Section 7 says what each screen contains. This section says how the combined versions behave, in every scenario.

**The idea behind everything:** an organization has one kind of work, one kind of post, one kind of file and one kind of sprint. What changes is how many people each one reaches and who is looking.

### 16.1 Tasks: one board that holds both

**What exists:** an assignment is already a main task plus one copy per person, in the same `tasks` table. Owners and admins already see only the main task on the board (`orgTaskReadFilter`, `assignments.ts:23`).

**Gap:** the same rule gives a member the main task and their own copy, so a student can get `Lab 1` twice. Students should see only their copy.

**How one card moves.** A teacher doesn't drag an assignment. It moves by itself, based on what students have done:

| Column | When the assignment sits there | Card shows |
|---|---|---|
| To do | Draft, or published with nobody started | `Draft`, or `0 of 40` |
| In progress | Anyone started, or anything is waiting for review | Progress bar, `12 of 40 done`, plus `6 to review` when work is waiting |
| Completed | Everyone is done or excused, or it was closed | `All done · 2 excused` |

A student's card moves as a normal task does, but Completed requires Submit, plus approval if review is on.

**Who sees what:**

| Person | Board |
|---|---|
| Owner, admin | Their own tasks and one card per assignment |
| Member | Their own tasks and their own copies |
| Group member | The group's copy, with the group name |
| Guest | Read only, per Settings |
| Workspace team | The group copy with `From CSE 3B`, on that workspace's board |

**One form.** "New task" always opens `Create task`. Choosing many people in Assign to changes the title to `Create assignment`, and the Hand-in section appears. Switching back removes it without losing text.

| Assign to | Result |
|---|---|
| Nobody or one person | Normal task. Create task. |
| Everyone or Admins | One copy per person. Publish to 40 people. |
| Selected people | Same, with the people picked. |
| Groups | Choose or auto-make groups. One copy per group. |
| Each workspace | One copy per workspace. |

**Task panel:**

| Section | Teacher | Student |
|---|---|---|
| Top | Title, chip, due, sprint | Same, with their status |
| Details | Instructions, steps, files | Same |
| Roster or Submit | Roster with Approve, Return, Remind, Excuse, Extend | What to hand in, Submit, and proof with the time |
| Comments | Class-wide questions, plus each student's private conversation from the roster | Class-wide questions, plus their own private conversation with the reviewer |
| `⋯` | Close, Delete, Edit for everyone | Nothing destructive |

**Awkward cases:**

| Case | What happens |
|---|---|
| Student joins late | Gets a copy if it's still open (`createCopiesForNewMember` already does this). Past-due work is skipped, and the teacher can "Give to Asha". |
| Student leaves or is removed | Unsubmitted copy goes away and counts drop. Submitted work stays for admins. |
| Team lead leaves | Next teammate becomes lead (already works). |
| Teacher changes the due date | Everyone's copy updates, and they're notified. |
| Teacher edits instructions after publishing | Asks "Tell everyone?" |
| Assignment moved to another sprint | All copies move. |
| Published to nobody | Saved, and new joiners get copies. The card reads "Nobody has joined yet". |
| Deleted with submissions | Not allowed; Close only (older decision 23). Delete is available only while nobody has submitted. |
| Student submits late | Marked Late if allowed; otherwise blocked with a clear reason. |

**Filters:** All, Sprint, Backlog, In review, Assignments, Mine.

**Behind it:** one action decides the column from the counts, the server hides the main task from members, and the board loads counts in a single query so 2,000 members stay fast.

### 16.2 Sprints: one form, one page

**One form.** Turning on **Plan more like this** shows How many and a live, editable list:

```
CO1 · 1–14 Nov    CO2 · 15–28 Nov    CO3 · 29 Nov–12 Dec
```

The button becomes `Create 3 sprints`. It warns if the list runs past the term end or overlaps another sprint.

**One page, by stage:**

| Stage | Top action | Page shows |
|---|---|---|
| Planning | Start now | Goal, dates, work so far, "Starts 1 Nov" |
| Running | Complete | Progress, days left, work, materials, team progress |
| Ended, not completed | Complete | "Ended 15 Nov", unfinished work counted |
| Completed | None | Final numbers and history |

**Complete** asks what to do with unfinished work: keep it, move to Backlog, or move to the next sprint (`completeSprintAction` already supports these). For an assignment, it also asks whether to close it or leave it open.

**Organization and team sprints together:**

```
TEAMS                        3 of 5 linked
Team Falcon   Parser week      6 of 10 tasks
Team Osprey   Not planned      Remind
```

| Person | Sees |
|---|---|
| Teacher | All teams' progress |
| Student | Their own items and their team's sprint |
| Team lead | "CO1 started. Plan your sprint", one click |
| Visitor | Timeline only, if allowed |

**Awkward cases:** auto-start blocked by a running sprint shows in Needs your attention. Deleting a sprint with work asks where that work goes. A detached workspace's sprint keeps running on its own.

### 16.3 Updates: one composer, one feed

| Control | Behavior |
|---|---|
| Type | Announcement or Discussion. Members only get Discussion, if allowed. |
| Audience chip | Everyone inside, Admins, Students, a workspace, or Public. Live count. |
| Pin, Email, #general | Icons that highlight when on, with a count where it applies. |
| Button | "Post to 40 people". Scheduling is left out for now. |

**One feed:** same post card, with an `Announcement` chip, audience label, pinned at top, and `From Team Falcon` for shared posts.

| Person | Sees |
|---|---|
| Teacher | Everything, plus who read it |
| Student | Posts for them, with unread marks |
| Visitor | Public only |
| Workspace member | Share to CSE 3B, locked with a reason if the workspace is private |

**Awkward cases:** editing an announcement doesn't notify again unless chosen. Posts stay if the author leaves. A reported post follows Trust and safety.

### 16.4 Files: one browser

**Left panel:** All files, Task files, Sprint materials, Submissions, Recent, Starred, Trash.

| Item | Teacher | Student |
|---|---|---|
| Folder rows | All, with `Admins`, `Public`, `Template` chips | Only what they can see, no chips |
| Sprint materials | Grouped by sprint; files can be attached | Read only |
| Submissions | Grouped by assignment, with who and when | Their own only |
| `⋯` on folder | Who can see this, Use as template, Rename, Move, Delete | Download |

**Flows:**

- **Upload** goes to the folder you're in, asks who can see it if the folder is new, and shows progress the same way as a workspace.
- **Workspace members** see a read-only `From CSE 3B` item with Copy to this workspace, and a "Source updated" hint.
- **Delete** warns when a file is in use by a sprint or assignment.
- **Full storage:** the upload explains why and links to Settings.

### 16.5 Documents: one list

| Section | Design |
|---|---|
| List | Groups, Required chip, unread dot, `+`. The same rail as a workspace. |
| Reader | Title, updated by, read status. |
| `⋯` | Group, Required, Who can see it, Show in workspaces, Link to sprint, History, Delete. |
| Add | Title, or pick from Files. Stays on Documents. |
| Student | Opening a Required document counts as read (28.4). |
| Workspace | Read-only `From CSE 3B` group. |
| Visitor | Public documents with content only. |

### 16.6 Overview, by stage

| Section | Empty | Starting | Active | Problem |
|---|---|---|---|---|
| Pinned | Hidden | Hidden | One line with author | Hidden when expired |
| Get started | 3 action cards | **Gone** | Gone | Back only if truly empty |
| Today | Small "All caught up" | Requests | Icon, title, detail, action | Overdue in amber, blocked in red |
| This sprint | Ghost timeline, Plan | Starts on date, Start now | Card with progress | Ended: Complete |
| This week | One line | Next items | Date tiles, grouped | Overdue moves to Today |
| Activity | Teaching line | First rows | Icons, grouped | Error with Retry |
| Workspaces | Create the first | Few rows | Avatar, chip, time | `2 overdue`, `No owner` |
| People | Invite panel | Photos, Invite | Photos, counts, requests | Full: Manage |

A student's Overview is the same page: their own due items, status and Submit, with no class numbers.

### 16.7 About, by person

| Section | Empty | Filled | Student | Visitor |
|---|---|---|---|---|
| Welcome note | Add note (admin) | Note | Note with `×` | Hidden |
| About card | Add | Same card as a workspace | Read | Read |
| Workspaces | Create | Rows | Rows | Public only |
| Stages | Ghost timeline and Plan | Timeline, click to open | Same | Only if public |
| Recent activity | Line | Icons | Public-safe kinds | Public-safe kinds |
| Your card | Invite panel | Same | `You're a Student` | Join or Request |
| Owner and admins | Owner only | Rows with Message | Same | Those who chose to show |
| Details | Always | Handle with Copy, time zone, since | Same | Same, without your role |

### 16.8 Workspaces, Members and Settings

**Workspaces scenarios:** lead left: Assign. Asks to leave: Approve. Move in: preview. Archive: read only, kept in `Archived`.

**Members:** guests get their own filter, showing what they can see. The rest is in 7.10.

**Settings:** every setting has one plain line and says who it affects. Members see My membership, What's allowed, Privacy and Leave (22.3).

### 16.9 Profile

| Section | Design | Others see | You see |
|---|---|---|---|
| Organizations (right column) | Logo, name, role, since | Current, shown only | Same, with pencil and Join with code |
| Contributions: Organizations | Organization entry with its workspaces nested | Published only | Same, with Edit |
| Contributions: Workspaces | Standalone work | Published only | Same |
| Not on your profile yet | Drafts, with Publish | Nothing | Your own list |
| Private to you | Removed entries | Nothing | Read only, with Delete |

**An organization entry:** logo, name, type; verified by the organization; role and title with dates; position history (Student → TA); your story; nested workspaces with role and dates; work record only if turned on.

| Event | Result |
|---|---|
| Join | Draft for you; others see nothing |
| Publish | Entry and Organizations row appear |
| Role change | Added to history |
| Verified | Badge |
| Verification revoked | Badge goes; you see the reason |
| Leave | Entry stays as `Left`; row goes |
| Removed | Everything hidden from others; your words stay private |
| Rejoin | Back as a draft; old dates stay in history |
| Term ends | `Completed`, with a nudge to write it up |
| Workspace detached | "with CSE 3B (until Nov)" |
| Organization deleted | Name stays, with no link |
| Switch off | Hidden from others; nothing deleted |

### 16.10 Edit contribution

Section 38 designs this in full.

**Left list:** the same structure as the profile, with a status per row: Published, Draft, Hidden, Left, Completed, Private.

| Section | Editable? | Design |
|---|---|---|
| Header | No | Organization, verified state, "Set by CSE 3B" |
| Role and dates | No, for records from the organization | "Ask an admin" if wrong |
| Your words | Yes | Same editor, with Start from my work and Start from About |
| Position history | Automatic | Add detail to each step |
| Nested workspaces | Each has its own editor | Parent shows them in order |
| Skills, images | Yes | Only your own submissions and team files, never admin-only files |
| Work record | Switch | Off by default, from platform numbers |
| Publish | Switch | One for the organization, one per entry beneath it |
| Delete | Yes | Removes your words only, never the record |

Removed entries are read only and can't be published.

### 16.11 Everything connected

| Place | Design |
|---|---|
| Joining | Code, link or email leads to one join page, handling off, expired, blocked and already-a-member cases. Then a welcome panel: welcome note, what to do first, Add to profile. Designed in 26. |
| Sidebar | Organization row with its workspaces nested, Archived, Join with code; correct plus link; loading row instead of "No workspaces yet". |
| Workspace inside | Every tab shows its `From CSE 3B` thread: tasks, documents, files, sprints, updates. |
| Search | Grouped by kind, scoped, never showing other people's marks. Removed people lose access at once. |
| Discover | Same card with type chip; organization-only work is never shown. |
| Notifications | Exact link, the organization's own role words, grouped. "Joins and leaves" stays one setting (30.4). |
| Emails | Invite, approved, removed, assignment, reminders; one voice. |
| Messages | `#general` and team channels under the organization; access follows membership. |
| My work | Assignments with Submit; requests in one place. |
| Person card | Shared organization only if current and shown. |
| Phones | Sections stack, board scrolls by column, forms become full sheets. |

### 16.12 Whole-life scenarios

| Event | What every part does |
|---|---|
| Created | Ready screen with invite panel, then Get started |
| First work | Get started goes |
| Member joins | Gets open assignments, draft entry, channels; admins notified |
| Role changes | Permissions, history and labels update everywhere |
| Owner leaves | Must transfer first; involuntary removal hands over automatically |
| Term ends | Prompt to review, verify, archive; members nudged to write up |
| Archived | Read only everywhere; entries say `Completed` |
| Scheduled for deletion | Banner with Restore; notice to members |
| Deleted | Removed everywhere; profile keeps the name with no link |
| Suspended | Read only; the reason goes to the owner and admins only (27.7) |
| Account deleted | Memberships hidden, individual work removed, team work anonymized, as already decided |

### 16.13 Behind the screen

| Change | Why |
|---|---|
| Hide the main assignment from members' boards | Stops the duplicate card |
| Calculate an assignment's column from its counts | One card moves by itself |
| `end_reason` on contributions | Tells left from removed |
| Removed entries blocked in the query | Privacy can't depend on the screen |
| A separate "member left" notification | Correct settings and wording |
| Real times in activity | Honest order |
| Calendar days in Coming up | Lab 1 appears |
| Cached storage totals by type | Storage section stays fast |
| Options passed into shared screens, not `if` checks everywhere | Keeps one screen maintainable |
| Database and browser tests per scenario | Each table above becomes a check |

## 17. Workspaces inside an organization: audit and design

Audited on 2 November 2026 using Team Falcon. Replaces the short list in section 8 where they differ.

**The main finding:** the same split exists here. Organization features sit in extra boxes above the normal workspace screen.

**The principle:** a child workspace is a normal workspace with one thin thread back to its organization. The organization appears once in the header, then inside each tab where relevant, never as a box stacked on top.

**How far this audit went:**

- **Seen live, fully loaded:** header, Overview, Sprints including its form, and Settings.
- **Not seen fully loaded:** Documents, Updates, Tasks and Files. The browser pane was hidden, which paused those pages. Their requests finished in about 0.2 seconds, so this isn't a bug. These come from the code and the same tabs on DeepScope AI.
- **One view only:** the owner of both the organization and the workspace. Other people's views come from the code and the older concept.
- **Little data:** no group assignment, team or files existed, so those states come from the code.

### 17.1 Header, line by line

| Line | Today | Problem | Change |
|---|---|---|---|
| Breadcrumb | `CSE 3B · Data Structures 2026 /` | Ends in a slash above the title, with nothing after it | Keep as the one organization link, without the slash |
| Title | Wraps at 1100px | The right side squeezes it | The details line gets shorter, which helps |
| Tagline | Fine | None | Keep |
| Chip 1 | `ORGANIZATION` | Reads like a type, but means "visible to the organization", which is the default | Show a chip only when unusual, such as `Private` |
| Chip 2 | `ADMIN · FROM CSE 3B · DATA STRUCTURES 2026` | **Bug:** shows even for the workspace's own owner, because it only checks the organization role (`detail.ts:239`). Also loud and long. | Show only to non-members, as a small `Viewing as admin` |
| People row | `1 member`, `+` | Fine | Keep |
| Numbers | `0 views yet`, `0` followers | Meaningless on an organization-only workspace | Hide when organization-only or private |
| Follow | Shown to the owner | Nothing to follow on your own team's organization-only workspace | Hide for members and on organization-only workspaces |
| Updated | Fine | None | Keep |
| Details | `Part of CSE 3B · … · CO1 Arrays and linked lists ends Sun 15 Nov` | Third mention of the organization; wraps mid-name | `Inside CO1 · ends Sun 15 Nov`. The breadcrumb names the organization. |
| Browser tab title | `Workspace on NetworkBase` on every tab | DeepScope AI gets `Tasks · DeepScope AI`. Looks like a privacy fallback reaching members; cause not confirmed. | Real title for people who can see it |

### 17.2 Overview

| Section | Today | Change |
|---|---|---|
| What's happening | Plain sentence naming the workspace you're already in | Same row design as Needs your attention: "CO1 started" with **Plan your sprint** |
| Order | What's happening sits above About; older decision 79 says About first | What's happening stays on top |
| About card | A stray divider with nothing under it when there's no Problem or Approach | Remove the line; add `Add the problem you're solving` for leads |
| Team list (`ChildUnitsLine`) | Plain dropdown text, with `★ team lead` written out | Team rows with photos, lead mark and open seats |
| Stages | Plan, Build, Iterate, Polish, Ship, separate from the organization's sprints | Keep as the team's own journey, with `Inside CO1` beside them |
| Open roles | "No open roles yet." Settings calls this "Teams and open seats" | One name. "Teams" for a class. |
| Recent activity | Hidden when empty | Shared activity card, with a teaching line |
| From the organization | Nothing unless there's work | Group assignments in the same row design, with `From CSE 3B` |

### 17.3 Sprints

| Part | Today | Change |
|---|---|---|
| Empty state | A box inside a box, with two main buttons: Create linked sprint and Create sprint | One button: **Plan your sprint**, already linked to CO1 |
| Copy | "this space will turn into a clean execution timeline" | "CO1 is running. Plan what your team will do during it." |
| Form dates | Showed 2–16 Nov, past CO1's 15 Nov end | Default to the organization sprint's dates, and stay inside them |
| Form wording | "Not part of an organization sprint" | "Inside CO1", on by default, with a switch to turn it off |
| Sprint page | `Inside CO1 · … · ends…` line exists | Keep, with the shared sprint page design |
| CO1 ends | Prompt to complete, per the code | Row in What's happening |

### 17.4 Tasks

| Part | Today (from code) | Change |
|---|---|---|
| Group assignment | `GroupCopiesPanel`, a box above the board (`WorkspaceDashboardClient.tsx:1195`) | Remove the box. One card on the board with `From CSE 3B`. |
| Duplicate risk | The box and the card can show the same work | Fixed by removing the box |
| Submit | Lives in the box | Moves into the task panel, for the lead or the team |
| Two review rules | Workspace tasks use its own review; organization work goes to the teacher | Keep both, labeled "Reviewed by CSE 3B" on the card |
| Late arrival | New workspaces get open group assignments, per the older concept | Keep; confirm when building |

### 17.5 Files

| Part | Today | Change |
|---|---|---|
| Organization files | "From the organization", a box above the browser | Remove the box. Add `From CSE 3B` in the left panel, read only. |
| Wording | "From the organization" | Use the organization's name |
| Copy | Copy to this workspace | Keep, in the file's `⋯` menu |
| Source updated | "Newer version" with Update copy | Keep, as a small chip on the file |
| Final files | Marked with the organization's review | Same left panel |

### 17.6 Documents

| Part | Today (from code) | Change |
|---|---|---|
| From the organization | Read-only group in the list | Keep |
| Templates | Copy from the organization | Keep, in the Add dialog |
| Starter document | Created at setup as a draft | Check it's empty-safe, and never public while empty |

### 17.7 Updates

| Part | Today (from code) | Change |
|---|---|---|
| Share to CSE 3B | Options box outside the composer | Moves into the composer's toolbar, locked with a reason if private |
| Copy | "Progress posts for followers and workspace visitors" | "Updates for your team" on an organization-only workspace |
| Default audience | Composer defaults to Public (`WorkspaceUpdateComposer.tsx:223`) | Match the workspace's visibility. See 18.4. |

### 17.8 Settings

| Part | Today | Change |
|---|---|---|
| Heading | "Workspace or workspace" | Fix |
| Link address | `team-falcon-hash-table-library-oxao5` | The random ending is ugly. Check why it's added. |
| Avatar preview | One letter, `T`, where the header style uses two | Same initials everywhere |
| Organization section | Second in the menu, with locked rows | Keep. Locked rows say why and link to the organization. |
| Category | Offers Side project, Startup, Hackathon | Default to the organization's type |
| Team section | "Teams and open seats" | Keep this name everywhere |

### 17.9 Sidebar and creation

- **Plus button:** the "not a member" bug (`SidebarWorkspaces.tsx:51`).
- **Nested rows:** text only, while other workspaces have icons. Add the same icon.
- **Review step:** says the card "will appear in Discover" on organization-only work.
- **"All workspaces" link:** shown even with one child. Show it only when there's more to see.

### 17.10 People

| Person | Should see | To verify when building |
|---|---|---|
| Team lead | Everything; submits group work | Plan your sprint prompt |
| Team member | Board and their work; From CSE 3B reading | No admin controls |
| Organization admin, not on the team | Everything, marked `Viewing as admin` | Can't delete, rename, or remove the lead |
| Outside person | The workspace only, with no organization links | The organization name without a link |
| Other organization member | Read, if organization-only | No edit controls |
| Visitor | Only if public | Organization parts hidden |

### 17.11 Life events

| Event | Expected | Gap |
|---|---|---|
| Lead leaves the organization | Blocked until transferred | Offer Transfer in place |
| Member removed from the organization | Removed here too, seat reopens, lead told | Works in code; profile follows section 4 |
| Workspace moved into the organization | Preview, then approval | Check wording |
| Workspace leaves the organization | Links cleared; sprints continue; profile says "with CSE 3B (until Nov)" | Works in code; check the confirmation |
| Organization archived | Child workspaces read only, `Archived with CSE 3B` | Check all tabs |
| Organization deleted | See 19.1 | Decided |
| Teacher returns work | Shows on the card and in What's happening | Check when Tasks is built |

## 18. Child workspaces: forms and panels in depth

Accepted by the owner on 2 November 2026. Extends section 17. This comes from reading the code; no forms were submitted, so behavior is from the code unless marked as seen live.

### 18.1 What the deeper look found

| # | Finding | Evidence |
|---|---|---|
| 1 | Create linked sprint likely fails with its own default dates. The form opened with 2–16 Nov, but a linked sprint must stay inside CO1, which ends 15 Nov. | Form seen live; rule in `assertOrgSprintRules` (`sprints.ts`) |
| 2 | The two sprint buttons are nearly the same. On a workspace that follows the organization, the server links a sprint automatically or refuses it, even if "Not part of an organization sprint" is picked. | `assertOrgSprintRules` |
| 3 | "Follow organization sprints" can only be set at creation. No control was found in the Organization settings section. | `Phase4Settings.tsx`, `ChildOrgSection.tsx` |
| 4 | The task form has no team option, though teams exist in the workspace. | `CreateTaskModal.tsx` |
| 5 | The composer defaults to Public on an organization-only workspace and offers only Public or Members. "Share to CSE 3B" is a separate checkbox outside it. | `WorkspaceUpdateComposer.tsx:223` |
| 6 | "Add document" opens Files because the code sends it there. | `AddDocDialog.tsx:59`–`66` |
| 7 | Visibility is shown in one section and changed in another. Access and visibility only links away. | `WorkspaceSettingsTab.tsx:1443` |
| 8 | Every workspace address gets a random ending, even when the name is free. | `slug.ts:38` |

### 18.2 Sprints: one button, one form

| Situation | Shows | Button |
|---|---|---|
| CO1 is running | "CO1 is running. Plan what your team will do during it." | **Plan your sprint** |
| CO1 is planned, not started | "CO1 starts 9 Nov. Get ready." | **Plan your sprint** |
| No organization sprint | "Plan your team's first sprint." | **Create sprint** |
| Member, no permission | "Your team hasn't planned a sprint yet." | None |

**Create linked sprint is removed.** One form covers every case.

| Field | Default | Behavior |
|---|---|---|
| Inside | The running organization sprint | Panel: `Inside CO1 · 1–15 Nov · Change` |
| Change | Opens a list | Other planned sprints, plus "Not inside a sprint" if the workspace doesn't follow |
| Name | Empty, placeholder only | Free text. Never copies the organization's name. |
| Goal, Description | Empty | Same as a workspace |
| Start | Today, or CO1's start if later | Can't go before CO1 starts |
| End | CO1's end | Can't go after CO1 ends |
| Shortcuts | 1, 2, 4 weeks | Limited to what fits; the rest are disabled with a reason |
| Start automatically | On | Same as a workspace |
| Plan one for each | Off | Creates one sprint per planned organization sprint |
| Tell the team | Off | Posts to the team |

**Button:** `Create sprint`, or `Create 3 sprints`. **Errors** appear beside the field before saving: "CO1 ends 15 Nov. Pick an earlier date."

**Sprint page:**

| Part | Behavior |
|---|---|
| Header | Name, goal, status, dates, `Inside CO1 · CSE 3B · ends 15 Nov` |
| Start now | Warns if CO1 hasn't started |
| Complete | Asks about unfinished work, keep or move |
| Work | Team tasks and `From CSE 3B` work together |
| Materials | The team's own, with CO1's materials as read-only |
| CO1 changes date | Amber `Outside CO1`, with **Fix dates** |
| CO1 deleted | Team sprint stays and is unlinked, with a notice |
| CO1 ends first | Row: "CO1 ended. Complete Parser week?" Never closes by itself. |

| Person | Can |
|---|---|
| Lead, workspace admin | Create, edit, start, complete, delete |
| Organization admin | Same; marked `Viewing as admin` |
| Member | See it, and work on tasks |
| Outside person | See the team sprint; the CO1 name has no link |

### 18.3 New task

| Field | Behavior |
|---|---|
| Title, Description | Same as a workspace |
| Assign to | A person, a team, each team, or new groups (34.7) |
| Sprint | Defaults to the running sprint; shows its end date beside Due |
| Due | Warns if past the sprint's end, never blocks |
| Status, Priority, Points | Same; Points follows the organization's setting |
| Subtasks, Files | Same |
| Create assignment | Never appears here. Only the organization assigns to many. |

**Buttons:** Create task, Cancel, with a quiet "Create another" tick.

**Group work from the organization** is one card with `From CSE 3B`:

| Field | Team can |
|---|---|
| Title, instructions, due, hand-in type | Read only, marked `Set by CSE 3B` |
| Assignee | Lead can reassign within the team |
| Subtasks, comments, files | Add freely |
| Status | Moves normally until submitted |
| Submit | Lead or assigned person, once, for the team |
| Delete | Not allowed; it belongs to the organization |

The code shows only a `From` chip on these cards, and the locks aren't enforced on the server. See 19.3.

| Case | Result |
|---|---|
| Assignee leaves the team | Unassigned, with a note; lead told |
| Lead leaves with group work | Goes to the new lead |
| Teacher returns work | Card moves back to In progress, with the reason |
| Outside person | Sees the brief, with no link into the organization |

### 18.4 Update composer

**Closed:** one line, "Share something with your team…"

**Open:** a single **Who sees this** choice replaces the Public or Members choice and the Share checkbox:

| Choice | Means | Available when |
|---|---|---|
| Team | Workspace members only | Always |
| Everyone in CSE 3B | Also appears under From workspaces | Unless private, then locked with a reason |
| Public | Anyone, including Discover | Only if the workspace is public and the organization allows it |

**Default:** private and organization-only start on Team; public starts on Everyone in CSE 3B. Public is never the default.

| Part | Behavior |
|---|---|
| Toolbar | Task, sprint, file, image, link, as today |
| Draft | Autosave stays |
| Limit | 2,000 characters, as today |
| Button | "Post to your team" or "Post to CSE 3B" |
| After posting | Stays in the feed with its audience label |
| Announcements | Not here; only the organization posts those |
| Heading | "Updates for your team" |
| Post | Same card, with a `Shared to CSE 3B` label |
| From CSE 3B | Announcements for this team on top, read here, replied to on the organization's post |
| Empty | "Post your team's first update." |
| Recent activity | Shared card with icons |

### 18.5 Documents

| Section | Design |
|---|---|
| List | Team documents, then a read-only **From CSE 3B** group with a lock icon. Required ones are marked. |
| Add | `+` opens the dialog: Title, Templates from CSE 3B, or pick from Files |
| After adding | Stays on Documents and opens the editor |
| Template | Copied, with `{{project}}` filled in, then fully editable |
| Reader | Same as a workspace; From CSE 3B documents show "Read only · Open in CSE 3B" |
| Required | Opening counts as read, counted for the teacher (28.4) |
| Submit with a document | From the task panel |
| `⋯` | Rename, History, Who can see it, Delete, for team documents |
| Empty | "Write your team's plan here." With Add document, and any templates suggested |
| Outside person | Team documents only |
| Visitor | Public documents with content only |

The starter document contains only a title, so it should count as empty and stay hidden from visitors. To confirm when building.

### 18.6 Files

Same browser as a workspace, with the box removed.

| Left panel item | Behavior |
|---|---|
| All files | Team files, as today |
| Task files | Same |
| From CSE 3B | Read-only organization tree, minus admin-only folders |
| Final files | Group work handed in, with `Reviewed by CSE 3B` |
| Recent, Starred, Trash | Same |

| Inside From CSE 3B | Behavior |
|---|---|
| Top line | `CSE 3B · Read only · Open in CSE 3B` |
| File `⋯` | Preview, Download, Copy to this workspace, Star |
| Copy | Asks which folder, then shows `Copied from CSE 3B · v2` |
| Newer version | Chip `Newer version · Update copy`. Asks first; saves as a new version. |
| Empty | "CSE 3B hasn't shared files yet." |
| Outside person | Item hidden |
| Student | Reads, and can copy only if allowed to upload |

**Storage** moves to Settings. A team's files don't count against the organization's 5 GB; see 19.2.

### 18.7 Settings

| Person | Sees |
|---|---|
| Lead | Everything, in the order below |
| Workspace admin | Organization first, then Links, Access, Members, Teams, Documents, Updates, Files |
| Organization admin, not on the team | Organization only, as today |
| Member | Your membership, Privacy |

| Section | Design |
|---|---|
| Details | Image, name, summary, description, category defaulting to the organization's. Address without a random ending when it's free. |
| Organization | See below |
| Links | Same |
| Access and visibility | One place for visibility. Options the organization blocks show `Set by CSE 3B`. |
| Members | Roster, with organization admins marked. People must already be in the organization, unless outsiders are allowed. |
| Teams and open seats | One name everywhere; team cards with lead and seats |
| Documents, Updates | Who can edit and post; organization limits shown as locked |
| Stages and workflow | Same; review applies to team tasks only |
| Files and storage | Upload rules and the Storage section |
| Notifications, Privacy | Same |
| Management | Transfer, Archive or Unarchive, Leave the organization, Delete, with the rules in 35.3 |

**Organization section:**

| Part | Design |
|---|---|
| Top | Logo and `CSE 3B` link, type |
| Follow organization sprints | A switch, with what it changes |
| Rules from CSE 3B | Locked rows with a reason: highest visibility, outside people, leaving |
| Admins from CSE 3B | Photos, roles, what they can and can't do |
| Leaving | Moved to Management, with a preview: what's kept, what goes, and that it becomes private |

## 19. Decisions on the three open questions

Accepted by the owner on 2 November 2026. Findings come from reading the code; the actions weren't run.

### 19.1 When an organization is deleted

**Today:** the owner chooses to detach or delete all workspaces together (`scheduleOrgDeletion`, `lifecycle.ts:90`). Detach happens immediately: the workspace becomes private, unsubmitted group work goes, sprints unlink, and channels move back (`detachFromOrg`, `children.ts:96`). The organization has a 30-day grace period. Restore doesn't bring detached workspaces back.

**Problems:** deleting with the organization lets its owner delete other people's workspaces, against older decision 127. There's no per-workspace choice, and Restore is lopsided.

| Step | Design |
|---|---|
| Delete dialog | Lists each workspace with its lead, members and files |
| A workspace you own | Choose Keep as personal (default) or Delete |
| Someone else's workspace | Always kept. It goes to its lead, and you can't delete it. |
| Confirm | Type the handle, with a summary: "3 kept, 1 deleted, 40 people notified" |
| At that moment | Kept workspaces detach and become private; each lead gets an email saying what changed |
| Team's work | Tasks, files, documents and copied files stay. Unsubmitted organization assignments go. Submitted ones stay in the team's history as files. |
| During the 30 days | Banner for the owner with Restore. Members can download their own submissions from My work. |
| Restore | Organization returns, with a list of detached workspaces and "Invite back". Each lead accepts with one click. |
| After 30 days | Everything in the organization is removed. Profiles keep the name with no link. |
| Public kept workspace | Starts private; the lead chooses again. |

### 19.2 Team storage

**Today:** each workspace has its own counter, so a team's files don't count against the organization (`upload-intents.ts:388`, `:438`, `storage-quota.ts:3`). Organization 5 GB, each workspace 10 GB, personal 1 GB.

**Problems:** a team gets twice its organization's space, 200 workspaces could hold 2 TB, and the teacher can't see team storage.

| Part | Design |
|---|---|
| Counters | Stay separate. A full organization never blocks a team's work, and the reverse. |
| Team limit | 2 GB inside an organization. Back to 10 GB if it detaches. |
| Already over | Nothing is deleted. Uploads stop, with "Team storage is full · Manage". |
| Organization's Storage section | Its own 5 GB bar, plus a read-only Teams list with each team's use |
| Team's Storage section | Same design, with its own bar |
| Copies | Copying an organization file uses no extra team space, until the team edits it. A code comment says copies are "counted once"; confirm when building. |
| At 80% and 100% | The team lead gets a notice; the teacher sees a chip on that team's row |

### 19.3 Group work locks

**Today:** the field update action has no check for organization copies (`updateTaskFieldAction`, `task.ts:53`), so title and due date look editable by anyone with task write access. A child workspace's owner can delete a group copy, since the delete check only looks at workspace ownership (`tasks.ts`). Students may be able to change a due date on their own copy; this was read, not tried. Review is handled properly: copies go to the organization.

| Field on a copy | Who can change it |
|---|---|
| Title, instructions, hand-in type | Organization admins only, from the main assignment. Updates all copies. |
| Due date | Admins only, through Extend per person or for everyone |
| Assignee | Team lead, within the team |
| Sprint | Team, within their own sprints |
| Subtasks, comments, files | Team |
| Status | Normal, up to Submit, then the organization's review |
| Delete | Nobody on the team. Admins only while nothing is submitted (older decision 23). |

**Built as:** one server check that every task write passes through, including field updates, delete, sprint moves, archive and the code editor extension. Clear error: "Set by CSE 3B". The form shows those fields locked. A database test for each row, for each role.

## 20. Report audit: what's still missing

Audited on 2 November 2026 against the older concept's 34 sections, every organization component, and the server actions.

**Verdict at the time:** this report wasn't yet end to end. It went deep on the tabs, profile and child workspaces, but said little about several whole systems. 🔴 marks a real gap in behavior, not just missing wording.

**Now:** every gap below is closed, and the launch plan is in section 41. One decision remains open for the owner: age and school classes (29.5).

### 20.1 Conflicts

| # | Conflict | Fix |
|---|---|---|
| C1 | 16.1 said deleting an assignment with submissions "warns". Older decision 23 says Close only. | Fixed: follows decision 23 |
| C2 | The 7.12 settings menu leaves out Messages, Admin batching and Verified badge, which exist today | Settled: Messages gets a menu item, Admin batching becomes Admin emails under Notifications, Verified badge goes in Details (22) |
| C3 | "Submissions" and "Final files" are used for overlapping things | Settled: Submissions for Education, Final files for the rest (21.2) |
| C4 | Section 8 and sections 17–18 repeat each other | Section 8 points to them only |
| C5 | Invites: the older concept says 200 per paste, the code says 500 | Settled: 500 (21.4) |
| C6 | 7.11 mentions a "Members can invite" setting that couldn't be confirmed | Settled: members can't invite, and the setting doesn't exist (21.3) |

### 20.2 Whole systems

| # | Area | Status in this report |
|---|---|---|
| 1 | 🔴 Organization types. Only a class is described. Company, community, club and research words, defaults and term fields are missing. | Designed in 21.2 |
| 2 | Messages: channels, `#general`, browse, settings, reparenting, floating window | Designed in 30.3 |
| 3 | Notifications: every trigger, wording, grouping, tray, push | Designed in 30.4 |
| 4 | Emails: every template, its look, who gets it, batching | Designed in 30.5 |
| 5 | Admin batching and digest | Designed in 30.6 |
| 6 | My work drawer: assignments, To review, requests, submission downloads | Designed in 30.7 |
| 7 | Search and ⌘K: scopes, results, privacy | Designed in 32.2 |
| 8 | Moderation: reports, suspension, appeals, restricted state, `OrgReportsSection` | Designed in 29.2 |
| 9 | Blocking inside an organization: blocked people in the same class or team | Designed in 29.3 |
| 10 | Permissions matrix: one table of every action by role | Designed in 21.3 |
| 11 | Limits: what people see at each limit | Designed in 21.4 |
| 12 | Accessibility: keyboard, screen readers, focus, drag alternatives, color | Designed in 32.3 |
| 13 | Live updates: board, roster and counts when others act; two admins at once | Designed in 32.4 |
| 14 | Time zones: organization versus viewer, due times | Designed in 32.5 |
| 15 | Failure states: per action, offline, lost permission mid-session | Designed in 32.6 |
| 16 | Privacy and legal: what admins can see of members, data after removal, retention, terms | Designed in 29.4; age decision open (29.5) |
| 17 | Rollout: order, feature flags, existing organizations, rollback | Designed in 41.1, 41.4, 41.5 |
| 18 | Success measures | Designed in 41.7 |
| 19 | Monitoring: Sentry and background job budgets for new work | Designed in 41.8 |
| 20 | Public pages: share previews, sitemap, page titles, signed-out organization page | Designed in 31.2 |

### 20.3 Teams

| # | Gap |
|---|---|
| 21 | Closed: one Teams screen (25.3) |
| 22 | Closed: applying designed, and accepted people are placed in their team (25.4) |
| 23 | Closed: moving and asking (25.5) |
| 24 | Closed: the existing bulk Add, with seats checked, and a clearer attention rule (25.6) |
| 25 | Closed: group assignments (25.7) |
| 26 | Closed: team mentions (25.8) |

### 20.4 Joining and leaving

| # | Gap |
|---|---|
| 27 | Closed: joining by code (26.2) |
| 28 | Closed: invite emails (26.3) |
| 29 | Closed: invite banner and accepting (26.4) |
| 30 | Closed: join requests (26.5) |
| 31 | Closed: organization full (26.6) |
| 32 | Closed: welcome panel (26.7) |
| 33 | Closed: Viewers (26.8) |
| 34 | Closed: private page states (26.9) |
| 35 | Closed: leaving (26.10) |

### 20.5 Creating and lifecycle

| # | Gap |
|---|---|
| 36 | Closed: creation wizard (27.2) |
| 37 | Closed: ready screen (27.3) |
| 38 | Closed: duplicate (27.4) |
| 39 | Closed: archive and unarchive (27.5) |
| 40 | Closed: transfer (27.6) |
| 41 | Closed: suspended and deleting states (27.7) |
| 42 | Closed: name and handle rules (27.8) |
| 43 | Closed: Verified badge (27.9) |

### 20.6 Tabs

| # | Tab | Gap |
|---|---|---|
| 44 | Tasks | Closed: the 2,000-member cap means no assignment passes 2,000 copies, so no background job or progress state is needed (21.4) |
| 45 | Tasks | Closed: review queue designed (23.2) |
| 46 | Tasks | Closed: editing designed field by field (23.3) |
| 47 | Tasks | Closed: always a fixed column, and it moves by itself (23.4) |
| 48 | Tasks | Closed: two conversations in the panel (23.5) |
| 49 | Sprints | Closed: Repeat preview and Move later sprints (28.2) |
| 50 | Updates | Closed: Seen counts, replies, reactions, pins (28.3) |
| 51 | Updates | Closed: email limit (28.3) |
| 52 | Documents | Closed: required reading (28.4) |
| 53 | Documents | Closed: groups, history, templates (28.4) |
| 54 | Files | Closed: templates, download all, size messages (28.5) |
| 55 | Workspaces | Closed: move-in and leave requests (28.6) |
| 56 | Members | Closed: member panel and flags (28.7) |
| 57 | Members | Closed: Remind (28.8) |
| 58 | Settings | Closed: designed field by field (22) |
| 59 | Settings | Closed: reports move to Moderation, requests stay in the Members tab (22.4) |

### 20.7 Other connected places

| # | Gap |
|---|---|
| 60 | Closed: Workspaces section holds workspaces only (31.3) |
| 61 | Closed: verifying and revoking (31.4) |
| 62 | Closed: sidebar rows (31.5) |
| 63 | Closed: Discover card and filters (31.6) |
| 64 | Closed: Network and person cards (31.7) |
| 65 | Closed: code editor and GitHub designed (24) |
| 66 | Closed: lead's side of moving in (28.6) |
| 67 | Closed: phones, tab by tab (32.7) |
| 68 | Closed: dark mode rules (32.8) |

### 20.8 How these get handled

- **Settled in section 21:** 1 (organization types), 10 (permissions), 11 (limits), 44 (large assignments).
- **Bring across from the older concept:** done.
- **Settled in section 22:** 58 and 59 (Settings).
- **Settled in section 23:** 45–48 (Tasks).
- **Settled in section 24:** 65 (code editor and GitHub).
- **Settled in section 25:** 21–26 (Teams).
- **Settled in section 26:** 27–35 (Joining and leaving).
- **Settled in section 27:** 36–43 (Creation and lifecycle).
- **Settled in section 28:** 49–57 and 66 (Remaining tab details).
- **Settled in section 29:** 8, 9 and 16 (Trust and privacy).
- **Settled in section 30:** 2–6 (Messages and notifications).
- **Settled in section 31:** 20 and 60–64 (Connected places).
- **Settled in section 32:** 7, 12–15, 67 and 68 (Everyday experience).
- **Settled in section 41:** 17–19 (Launch plan).
- **Order:** area by area. Organization types, permissions, limits, Settings, Tasks details, the code editor and GitHub, Teams, Joining and leaving, Creation and lifecycle, the remaining tab details, trust and privacy, messages and notifications, connected places, and everyday experience are done. Section 33 adds the day-to-day lifecycle. Each area is shown to the owner before it goes in this report.

## 21. Organization types, permissions and limits

Designed on 2 November 2026 from the code and the older concept (§5, §29.4, §30.4, §34.6). Approved by the owner. This closes gaps 1, 10, 11 and 44, and conflicts C3, C5 and C6.

### 21.1 What the code showed

- **Changing type can silently change rules.** Review, late work, story points and #general notifications read from the type when nobody has set them (`settings.ts:120`, `chat-rules.ts:17`). Changing the type changes them with no warning.
- **The permissions table isn't the real check.** The Settings table comes from `permissions.ts`, but only `organizations.ts` and `OrgSettingsSections.tsx` import it. `childGrant` isn't used anywhere in `src`. Other actions have their own checks, so the table can say one thing while the app does another.
- **Some limits may not be enforced.** Ten limits have no check under their name in `ORG_LIMITS`. A check could be hard-coded under another name, as pinned posts are (`0012_workspace_updates.sql:64`), so the build confirms each one. Two of the ten were later found to be enforced (30.1).

### 21.2 Organization types

**The rule:** type sets words and starting values, never power. A Teacher and a company Owner can do exactly the same things.

| | Education | Company | Research | Community | Club | Other |
|---|---|---|---|---|---|---|
| **Roles** (owner / admin / member / viewer) | Teacher / TA / Student / Viewer | Owner / Manager / Member / Viewer | PI / Researcher / Member / Viewer | Owner / Admin / Member / Viewer | President / Coordinator / Member / Viewer | Owner / Admin / Member / Viewer |
| **Finished work is called** | Submissions | Final files | Final files | Final files | Final files | Final files |
| **Term dates** | Shown | Hidden | Hidden | Hidden | Hidden | Hidden |
| **Sprint name** | CO1 | Sprint 1 | Sprint 1 | Sprint 1 | Sprint 1 | Sprint 1 |
| **Joining** | Instant | Approval | Approval | Instant | Instant | Approval |
| **Visibility** | Private | Private | Private | Public | Public | Private |
| **Members can post discussions and create channels** | No | Yes | Yes | Yes | Yes | Yes |
| **#general notifies** | Mentions | All | All | All | All | All |
| **Review required** | On | Off | Off | Off | Off | Off |
| **Late work** | Until a date | Always | Always | Always | Always | Always |
| **Story points** | Hidden | Shown | Shown | Shown | Shown | Shown |
| **Starter folders** | Course materials, Docs, Templates, Staff | Shared, Docs, Templates, Managers | Shared, Docs, Templates, Admins | Same as Research | Same as Research | Same as Research |

These rows match today's code, except that term dates are hidden outside Education, which is new. "Other" also shows the organization's own label for its type.

- **One source:** a single type profile replaces the checks now scattered across about eight files (listed in 21.5).
- **Settings stop following the type:** the values are saved when the organization is created. Existing organizations get theirs filled in once, from their current type, so nothing changes for them.
- **Changing type:** only the owner can do it, and a confirmation lists what happens.
  - **Changes:** role names, unless customised, and labels such as Submissions.
  - **Stays the same:** people, folders, work, joining, visibility and rules.
- **Same word everywhere:** "task" is used for every type, because one board and one form shouldn't change their words by type.
- **No classroom wording elsewhere:** "Plan your term" (`OrgAboutTab.tsx:69`) becomes "Plan your sprints" outside Education.
- **Two teachers:** the second teacher is an admin with the title "Teacher". Titles already exist, so this needs no new role.

### 21.3 Permissions

**The rule:** one table decides everything. As each action is built or changed, its server check moves to that table, and a test confirms the table and the actions agree. Every action isn't rewritten at once.

These rows are new, and 39.2 adds the rest. The existing rows in `permissions.ts` stay as they are.

| Action | Owner | Admin | Member | Viewer | Visitor |
|---|---|---|---|---|---|
| Edit a group task's shared details (title, due date, instructions) | Yes | Yes | No | No | No |
| Update own copy (status, attachments, submission) | No copy | No copy | Own | No | No |
| Close an assignment that has submissions (never delete it) | Yes | Yes | No | No | No |
| See storage breakdown | Yes | Yes | No | No | No |
| Set folder access | Yes | Yes | No | No | No |
| Change organization type | Yes | No | No | No | No |
| Remove an admin | Yes | No | No | No | No |
| Delete the organization (19.1) | Yes | No | No | No | No |

**Child workspaces:**

- **Admin powers:** organization admins can manage, archive and detach a child workspace, but only its lead can delete it.
- **How admins appear:** they get a chip saying "Admin from CSE 3B". They aren't listed as members and get no contribution credit. This also fixes the wrong chip (`detail.ts:239`).
- **Team copies:** any team member can update the copy and submit, but the shared details stay locked. The server enforces this (19.3).

**Scenarios:**

| Scenario | What happens |
|---|---|
| Archived organization or workspace | Read only for every role. The owner can still restore it, and people can still leave and download. |
| Only owner leaving | They must transfer ownership first. |
| Pending join request | The person is still a visitor. |
| Removed member | They become a visitor immediately. Their credit follows section 4. |
| Member wants to invite someone | Members can't invite, and there is no "Members can invite" setting. |

**What people see:**

- **No permission:** the button isn't there, rather than greyed out.
- **Admins-only setting:** a single line explains it, such as "Admins create workspaces here."
- **Old link or outdated page:** a plain message and a refresh, with nothing half saved.
- **Settings table:** it's generated from the real table and uses the organization's own role names. Rows that depend on a setting link to that setting.

### 21.4 Limits

**The rule:** check before starting and never leave anything half done. Admins see "CSE 3B has reached 200 workspaces" and "Contact support to raise this". Members see "Ask an admin". Admins also get an early warning at 80% for storage, members and workspaces.

| Limit | Value | Today | What people see at the limit |
|---|---|---|---|
| Organizations owned | 5 | Checked | The create button explains the limit |
| Organizations joined | 50 | **No check found** | "You've joined 50 organizations. Leave one to join this one." |
| Workspaces per organization | 200 | **Comment only** | The create button is replaced by the limit message |
| Members | 2,000 | Checked | "This organization is full." The join request isn't created |
| Admins | 20 | **No check found** | Make admin is blocked, with the message |
| Teams per workspace | 20 | **No check found** | Add team is blocked |
| Members per team | 10 | Checked | That team shows as full |
| Teams per assignment | 500 | **No check found** | The form says so before anything is sent |
| Pinned posts | 3 | Checked in the database | "Unpin one first," and it names the pinned posts |
| Announcement emails | 5 a day | Checked, with no message to the author (30.1) | The email option turns off with "Resets tomorrow"; posting still works |
| Documents | 500 | **No check found** | New doc is blocked |
| Document groups | 20 | Checked | New group is blocked |
| Sprints per series | 52 | Checked | The Repeat field stops at 52 |
| Storage | 5 GB | Checked | The upload is refused before it starts |
| Team storage | 2 GB (19.2) | Today's limit is 10 GB | Same as storage |
| Channels | 200 | Checked in the database (30.1) | New channel is blocked |
| Invites per paste | 500 | Checked | "You pasted 612. Up to 500 at a time," and the list stays in the box |
| Invites per day | 1,000 | **No check found** | "412 left today" before sending |
| Reminders per person | 1 per 12 hours | Checked | "Reminded 3 hours ago" |
| Download all | 2 GB | **No check found** | "Too large for one download. Download by folder." |
| Handle change | 7 days, old one held 90 days | Checked | The next allowed date is shown |
| Join code attempts | 5 a minute per account | Checked | "Too many attempts. Wait a minute and try again." |

**Calls made:**

- **500 invites per paste (C5):** 200 is too low for a large course intake, and the daily limit already guards against abuse.
- **No progress screen for large assignments (gap 44):** an organization has at most 2,000 members, so an assignment can't go past the 2,000 copies created in one go. `assignments.ts:139` says the same. A background job is needed only if the member cap is ever raised.
- **Member cap:** an admin can't set it below the current member count.

### 21.5 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The group work locks, already listed, go through the permissions table |
| Before the tab steps | The type profile, replacing the checks at `CreateWorkspaceWizard.tsx:118`, `FilesTabRoot.tsx:797`, `CreateSprintModal.tsx:338`, `chat-rules.ts:17`, `creation.ts:91`, `file-rules.ts:34`, `settings.ts:120` and `lifecycle.ts:901`. Includes filling in saved settings for existing organizations, which is a database change. |
| With each tab step | That tab's permission checks move to the table, and its limits get their check and message |

## 22. Organization Settings, field by field

Designed on 2 November 2026 from `OrgSettingsSections.tsx`, `WorkspaceSettingsTab.tsx`, `settings.ts` and `permissions.ts`. Approved by the owner. This replaces the menu in 7.12 and closes conflict C2 and gaps 58 and 59. Findings come from reading the code; nothing was run.

### 22.1 What's wrong today

| # | Problem | Fix |
|---|---|---|
| 1 | Admins can change the organization type, because it saves with the profile (`ORG_SECTION_OWNER_ONLY`). Section 21 says owner only. | Type gets its own owner-only save |
| 2 | The Type help says changing it "keeps your role names" (`OrgSettingsSections.tsx:168`). The code changes them unless they were customised (`config.ts:47`). | Correct the wording; the confirmation lists what changes |
| 3 | 7.12 said admins open on Details, but only owners can see that section today (`settings.ts:32`). | Admins see Details, with some fields read only |
| 4 | Review is set in two places: "Task completion" and "Review required". | One setting, in Work |
| 5 | The Stages editor seems to do nothing on an organization, because About builds its stages from sprints (`org-dashboard.ts:241`). | Remove it for organizations |
| 6 | Settings offers member upload controls, but the permissions table says members can only read organization files. | Remove them; the build confirms nothing relies on them |
| 7 | Settings has a Members section as well as the Members tab. | Remove it; the Members tab is the one place |
| 8 | Reply rules and announcement defaults sit under "Admin batching". Messages and Verified badge have no menu item (C2). | Move each to its proper place |
| 9 | Decision 28 puts Leave in Management, but 7.12 put it in My membership. Members can't see Management at all. | Leave goes in Management, and members see that one action |
| 10 | Leave says "You can join again later with the code", which is untrue if the code is off. Headings also still say "Workspace" and "project". | Correct the wording |

### 22.2 Rules for the whole page

- **Layout:** same as a workspace, titled "Organization settings". On phones, the menu is the existing dropdown.
- **Saving:** Save and Cancel appear once something changes, with a "Saved" message and "Last changed by". Leaving with unsaved changes asks first.
- **Every field:** a label and one plain line saying who it affects.
- **Fields you can't change:** the value shows read only, with "Only the owner can change this." This is the one exception to "the button isn't there" (21.3), because admins still need to see the value.
- **Rule changes:** they apply to new items only, and the line says so. If existing items would change, a confirmation gives the count first.
- **Archived:** everything is read only, with a notice. Management still offers Unarchive.
- **Scheduled for deletion:** the owner gets Restore, and everyone else can only read.

### 22.3 Menu

| Section | Owner | Admin | Member, Viewer |
|---|---|---|---|
| Details | Edit | Partly read only | No |
| Organization profile | Edit | Type read only | No |
| Links | Edit | Edit | No |
| Access and visibility | Edit | Read only | No |
| Joining | Edit | Edit | No |
| People and roles | Edit | Read only | No |
| Workspaces | Edit | Edit | No |
| Work | Edit | Edit | No |
| Documents | Edit | Edit | No |
| Updates | Edit | Edit | No |
| Messages | Edit | Edit | No |
| Storage | Edit | Edit | No |
| Notifications | Edit | Edit | No |
| Moderation | Edit | Edit | No |
| My membership | Edit | Edit | Edit |
| What's allowed | No | No | Read only |
| Privacy | Yes | Yes | Yes |
| Management | Everything | Leave only | Leave only |

Owners and admins open on Details. Members and viewers open on My membership. Visitors have no Settings tab.

**Removed for organizations:** Members, Stages, Task completion and the member upload controls. Workspaces keep them.

### 22.4 Section by section

#### Details

| Field | Control | Rule | Who |
|---|---|---|---|
| Image | Upload, adjust, remove | Initials if empty; the header camera opens here | Owner |
| Name | Text | 3–100 characters (27.8) | Owner |
| Handle | Text with availability check | Moved from Profile; once every 7 days, old address redirects for 90 days | Owner |
| Tagline | One line | Shows on cards and Discover | Owner, Admin |
| Description | Text | Shows on About | Owner, Admin |
| Tags | Chips | The workspace skills field is hidden | Owner, Admin |
| Verified badge | Status and Request button | Not verified, Requested or Verified; needs a website, otherwise "Add your website in Links" | Owner |

#### Organization profile

| Field | Control | Rule | Who |
|---|---|---|---|
| Type | Dropdown and its own Save | Opens the confirmation from 21.2 | Owner |
| What do you call it? | Text, up to 30 characters | Only for Other; required | Owner |
| Part of, Where | Text, up to 100 characters | Optional; both show in the header | Owner, Admin |
| Term | Start and end dates | Education only; end must be after start; dates are kept if the type changes | Owner, Admin |
| Time zone | Searchable list, replacing free text | Sets due dates and the admin email time; empty means each person's own | Owner, Admin |
| Who it's for, What happens here | Text | Show on About | Owner, Admin |
| Welcome note | Text, up to 500 characters (27.8) | Shows on About | Owner, Admin |

#### Links

Same as a workspace. The website here is what Verified badge checks.

#### Access and visibility

| Field | Control | Rule | Who |
|---|---|---|---|
| Visibility | Public or Private | Going Private confirms it leaves Discover | Owner |
| What visitors can see | One switch per tab | Only shown when Public; list matches the organization's tabs | Owner |

#### Joining

| Field | Control | Rule |
|---|---|---|
| Join code | Code, Copy, Make a new code | A new code stops the old one at once, after a confirmation |
| Code works | Switch | Off means nobody can join by code; the code itself doesn't change |
| Join mode | Instant or Approval | Waiting requests stay until decided, with "3 requests waiting · Review" |
| Max members | Number | Shows "38 members now"; can't go below that; empty means up to 2,000 |

Invites stay in the Members tab, and Join settings there opens this section.

#### People and roles

| Field | Control | Rule | Who |
|---|---|---|---|
| Role names | Four text fields, up to 30 characters | "guest" is relabelled Viewer; **new:** Reset to the type's names | Owner |
| Admins | "3 of 20" and a link | Managed in the Members tab | Owner |
| What each role can do | Full read-only table | Generated from the real permissions, grouped by area; rows that depend on a setting link to it | Everyone here |

#### Workspaces

| Field | Control | Rule |
|---|---|---|
| Usage | "12 of 200 workspaces" | Read only |
| Who can create workspaces | All members or Admins only | New workspaces only |
| Highest allowed visibility | Public, Organization only or Private | A confirmation gives the count that will be lowered, replacing today's inline line |
| Outside people can be added | Switch | Turning it off removes nobody, and shows how many are there |
| Share updates to the organization | Switch | Private workspaces never share |
| Default teams | Chips, replacing the text box | Up to 20; each workspace can still edit them |
| New workspaces follow sprints | Switch | New workspaces only; each has its own switch (18.7) |

#### Work

These apply to new tasks and sprints, and each one can still override them. The "On for Education" lines go away, because the saved value now stands on its own (21.2).

| Field | Control | Rule |
|---|---|---|
| Check finished work | Switch | **Replaces both review settings**; prefills the task form |
| Late work | Allowed, Until a date or Not allowed | Prefills the task form |
| Reminders | Both, 24 hours before, Due day or Off | 9:00 in each person's own time zone |
| Story points | Shown or Hidden | Hides the field everywhere in this organization |
| Start automatically | Switch | Starts on the sprint's start date |
| Notify on start | Switch | Members hear when it starts |
| Show in every workspace | Switch | Workspaces can link to the running sprint |
| Create matching sprints | Switch | Only available when Show in every workspace is on |

#### Documents, Updates and Messages

| Section | Field | Control | Rule |
|---|---|---|---|
| Documents | External images | Switch | Same as a workspace |
| Updates | Members can post discussions | Switch | Announcements stay admin only |
| Updates | Who can reply | Members or Anyone signed in | Moved from Admin batching |
| Updates | Announcements notify | In-app or In-app and email | Starting choice in the composer; "5 emails a day" shown |
| Messages | Only admins post in #general | Switch | Everyone can still reply in threads |
| Messages | Members can create channels | Switch | Shows "12 of 200 channels" |
| Messages | #general default notifications | All or Mentions | Applies to people who join from now on |

#### Storage

As designed in 7.12: the bar, recommendations and breakdowns. Download history moves here from Files.

#### Notifications

| Field | Control | Rule |
|---|---|---|
| What notifies members | Event switches | Required safety events stay locked on |
| Admin emails (was "Admin batching") | Daily summary or Instant | Daily sends at 8:00 in the organization's time zone, and is skipped when empty |

#### Moderation

| Part | Design |
|---|---|
| Reports | Moved from the Members tab sidebar (`OrgMembersTab.tsx:169`); the menu shows a count, and Needs your attention links here |
| Each report | Reason, content link and details, with Dismiss, Hide, Remove and Warn, as today |
| Empty | "No open reports." |
| Blocked people | Listed with Unblock, after a confirmation (29.3) |

Join requests stay in the Members tab, because they're about people rather than safety.

#### My membership and What's allowed

| Field | Control | Rule |
|---|---|---|
| Role and joined date | Read only | Uses the organization's own role name |
| Your title | Text, up to 60 characters | Shows beside your name |
| Show on my profile | Switch | On by default; follows section 4.5 |

What's allowed is the same permissions table, read only, for members and viewers.

#### Privacy

Same as today. It applies to your own account, and the line says so.

#### Management

| Action | Who | Design |
|---|---|---|
| Transfer | Owner | Choose an admin; with no admins, it says "Make someone an admin first" |
| Archive, Unarchive | Owner | Asks first; everything becomes read only |
| Duplicate | Owner | Same as today; 7.12 had left it out |
| Delete | Owner | As in 19.1 |
| Leave | Everyone | Says what happens to their work; the owner sees "Transfer ownership first" |

### 22.5 Child workspaces

Section 18.7 stands and follows the page rules in 22.2. Child workspaces keep their own Members, Stages and Task completion.

### 22.6 Calls made

- One review setting, not two, because there's now one board and one form.
- Reset for role names is new, so custom names can be undone.
- Reports move out of the Members tab.

## 23. Tasks details: review, editing, columns and questions

Designed on 2 November 2026 from `assignments.ts`, `AssignmentsPanel.tsx`, `task-comment.ts`, `workflow.ts`, `task-transition-service.ts` and the older concept's section 16. Approved by the owner. This closes gaps 45–48 and corrects the column table in 16.1. Findings come from reading the code; nothing was run.

### 23.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Likely privacy bug.** Task comments only check that you belong to the organization (`assertTaskAccess`, `task-comment.ts:97`), not that you can see that task. | A student who has the ID of another student's copy could probably read and post in that private conversation. Read in the code, not tried. Fixed in build step 1. |
| 2 | **Editing a published assignment has no screen.** `updateAssignmentAction` exists, but no screen calls it, and it only covers title, instructions and due date. | The whole edit flow needed designing. |
| 3 | **16.1 described the wrong board.** It used an In review column, but the fixed columns are To do, In progress, Blocked and Completed. In review is a filter. | 16.1 is corrected. |
| 4 | **Assignment cards can be dragged like tasks.** `moveTaskToWorkflowColumnAction` has no check for them. | The server must refuse the drag, or the card's position stops matching real progress. |
| 5 | **Review uses browser pop-ups.** Return uses `window.prompt`, and the queue shows no submission and has no Previous. | The queue is redesigned. |
| 6 | **A review can't be changed.** Only waiting submissions can be reviewed, and a closed assignment can't be reopened. | A wrong Approve or Close is permanent today. |
| 7 | **Students lose class questions once 16.1's fix lands.** Class questions sit on the main assignment, which 16.1 hides from students. | They reach those questions from their own copy. |

### 23.2 Review queue (gap 45)

**Opening it:**

- The **In review** filter shows every card waiting for review, with **Review all 14** above the board.
- An assignment's `6 to review` chip opens the same queue for just that assignment.

```
Review                                   3 of 14    [‹] [›]  [×]
Asha Rao · Lab 1 · Submitted 2 hours ago · Late · Version 2
─────────────────────────────────────────────────────────────
[submission: file preview, link or text]        Compare versions
Steps 4 of 5 ticked
Private conversation (2)
─────────────────────────────────────────────────────────────
[Approve]  [Return]                                  [Add note]
```

| Part | Design |
|---|---|
| Order | Oldest first, as today. Filters: Assignment, Late only. |
| Contents | Assignment submissions, plus normal tasks waiting for review, because there's one board |
| Long lists | The queue loads 200 at a time and says "200 of 340". It loads more as you finish. |
| Approve | One click, then the next one opens. Add note is optional and goes in the private conversation. |
| Return | The reason box opens in the panel and is required. Replaces the browser pop-up. |
| Team work | "Team Falcon · Submitted by Asha" |
| Finished | "All caught up", with Back to board |

**Bulk actions, in the roster:**

| Action | Design |
|---|---|
| Tick rows | Actions appear for the selected people |
| Approve selected, Approve all | "Approve 6 submissions? Each person is told." |
| Return selected | One reason goes to everyone selected |
| Change a decision | An approved copy can be returned with a reason while the assignment is open |

**Keyboard:**

| Key | Action |
|---|---|
| `A` | Approve |
| `R` | Return, with the cursor in the reason box |
| `J`, `K` | Next, Previous |
| `Esc` | Close |

Keys don't fire while you're typing. They're listed in the panel, and every action also has a button. On phones, Approve and Return stay fixed at the bottom.

**Awkward cases:**

| Case | What happens |
|---|---|
| Another admin already reviewed it | "Already reviewed by Priya," and it moves on |
| A new version arrives while you're looking | Approve is refused: "Asha sent a new version. Showing it now." |
| Student removed while waiting | The submission stays for admins and is marked "Left the organization" |

### 23.3 Editing a published assignment (gap 46)

**Where:** `⋯` → **Edit for everyone** opens the same task form. It shows "Changes reach 40 people", and the button says **Save for 40 people**. Each save sends one notification at most.

| Field | Draft | Published, nobody submitted | After first submission |
|---|---|---|---|
| Title | Free | Everyone's copy updates, quietly | Same |
| Instructions | Free | Asks "Tell everyone?" | Same; those who already submitted aren't reopened |
| Due date | Free | "38 move, 2 keep their extended date"; those who move are told | Same; if it moves earlier, it warns how many will show Late |
| Late work | Free | Editable | Applies from now on; past submissions keep their marks |
| Hand-in type | Free | Editable | **Locked**, with the reason shown |
| Check each submission | Free | Editable | Turning it off doesn't approve anything already waiting; turning it on doesn't undo anything finished |
| Sprint | Free | All copies move | Same |
| Priority, Points | Free | All copies update, quietly | Same |
| Steps | Free | **Add only**; existing ticks stay | Add only |
| Files | Free | Add or remove for everyone | Same; removing asks first |
| Assign to | Free | Moves to the roster | Roster only |
| Share in #general, Post an announcement | At publish | Not offered | Not offered |

**Roster changes after publishing:**

- **Give to:** add a person or team.
- **Excuse:** takes someone out of the counts, with a reason.
- **Remove:** only for a copy nobody has started.

**States:**

| State | What happens |
|---|---|
| Closed | **Reopen** is new, and submissions resume. Instructions and due date can be changed only after reopening. |
| Sprint archived | Read only |
| Someone else saved first | "This changed elsewhere," and it reloads |
| Student's view | "Instructions updated 2 Nov" appears on their copy; there's no change history |

**Why steps are add only:** each copy holds its own steps, with no link back to the main assignment, so renaming or removing would mean guessing which tick belongs to which step. Instructions can cover any wording change.

### 23.4 Custom board columns (gap 47)

| Rule | Design |
|---|---|
| Fixed columns | To do, In progress, Blocked, Completed. Up to 6 columns in total, as today. |
| Where an assignment card sits | Always in a fixed column; it never moves into a custom one |
| Moving it | Nobody can drag it, and the server refuses: "This moves by itself as people work." It can still be reordered within its column. |
| Blocked | Never holds the assignment card. A blocked copy counts as started. |
| Copies | Students and teams can drag their own copy into any column. Each custom column already maps to a status, so the Submit rule still applies. |
| Return | The copy goes back to In progress |
| Deleting a custom column | Refused while it holds tasks, as today |

The card's column follows the corrected table in 16.1.

### 23.5 Class questions (gap 48)

The copy's panel has two conversations:

```
Comments
[ Private with teachers (2) ]  [ Class questions (5) ]
Only you and CSE 3B's Teachers and TAs see this.
```

| Rule | Design |
|---|---|
| Storage | Class questions stay on the main assignment, and private ones on the copy. No new table. |
| Default | Private, because posting to the whole class by mistake is the worse error |
| Who sees what | The line above the box always says who will see the message |
| Teacher's view | The assignment panel shows Class questions, and each roster row opens that person's private conversation |
| Team copy | Private means the team plus organization admins |
| People outside the organization | No Class questions tab, as in the older concept |
| Viewers | Can read class questions but not post |
| Mentions | Only people who can see that conversation can be mentioned |
| Answered | A question shows `Answered` once an admin replies |
| Closed assignment | Read only |

**Notifications:**

| Event | Who hears |
|---|---|
| New question | Admins, following their Admin emails setting |
| Reply | The person who asked, and others in that thread |
| Teacher ticks "Tell everyone" | Everyone on the assignment |

**The access fix:** comments follow the same visibility rule as the task itself. That closes finding 1 and lets students reach class questions from their own copy. Each case gets a database test.

### 23.6 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The comment privacy fix and the server block on dragging assignment cards |
| Tasks step | Everything else in this section |

### 23.7 Left out on purpose

- **Undo after Approve:** the student has already been told, and Return covers mistakes.
- **Anonymous questions:** not requested.
- **Moving a private message to Class questions:** the teacher can just post it there.

## 24. Code editor and GitHub in organizations

Designed on 2 November 2026 from `OpenInIdeButton.tsx`, the extension routes, `github-sync.ts`, `sync-runner.ts` and the older concept (decision 85, §23). Approved by the owner. This closes gap 65 and changes the toolbar line in 7.7. Findings come from reading the code; nothing was run.

### 24.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Org-only work can probably reach a public repository.** Connecting a repository (`connectGitHubSyncRepository`, `github-sync.ts:214`) checks that you can push to it, but no check against the workspace's visibility or the organization's limit was found. | "Nothing leaves the organization" isn't enforced for GitHub. This is the main gap. |
| 2 | **The code editor button has no role check.** It appears on Tasks, the task panel and Files for anyone who can see those tabs, and it never says you're read only. | This is the "why does the button show" problem. |
| 3 | **Members may be able to lock organization files from the editor.** The lock only checks general write access (`file-lock/route.ts:73`), while the website limits file changes to admins (`WorkspaceDashboardClient.tsx:576`). The older concept says members are read only. | The extension can break the website's rule. The build also checks its upload path. |
| 4 | **The editor can attach files to tasks without a visibility check.** No check was seen in `task-push` that you can see the task. | A member with another student's copy ID could probably add files to it. |
| 5 | **GitHub shows only to members with a linked GitHub account, but most sync actions are lead only** (`FilesTabRoot.tsx:184`, `requireSyncOwner`). | Some people see controls they can't use, and teammates without a link see nothing. |
| 6 | **Publishing can mark a task complete, which can bypass Submit** (`sync-runner.ts:856`). | A group copy with file hand-in could finish with no submission recorded. Group copies must not be offered there. |

**Already correct:**

- Organizations can't connect a repository (`github-sync.ts:225`).
- Task files, including submissions, aren't published (`sync-runner.ts:71`).
- The editor already hides Admins-only folders and other people's copies from members (`extension/workspace/route.ts:147`, `orgFileAccessSql`).

### 24.2 Code editor

**The rule:** the button shows when you can open something here, and it tells you what you can do once you're in.

**In an organization:**

| Person | Button | Files | Tasks |
|---|---|---|---|
| Owner, Admin | Shows | Edit | Full, within the locks in 19.3 |
| Member | Shows, marked "Read only" | Read only; no locks or saves | Their own copy: status up to Submit, steps, attach their file |
| Viewer | Shows, marked "Read only" | Read only | Read only |
| Visitor | Hidden | None | None |

**In a child workspace:**

| Person | Button | Can do |
|---|---|---|
| Lead, workspace admin | Shows | Same as a normal workspace |
| Organization admin, not on the team | Shows | Same as a workspace admin; that access exists today |
| Team member | Shows | Same as a normal workspace, with the group copy locks in 19.3 |
| Outside person | Shows | That workspace only, with no organization content |
| Organization member, not on the team | Hidden | None |

**Placement:**

| Place | Organization | Child workspace |
|---|---|---|
| Files | Stays | Stays |
| Tasks toolbar, task panel | Moves into `⋯`, unless you've already connected an editor | Stays |
| Phones | In `⋯`, as today | In `⋯`, as today |
| Archived, or scheduled for deletion | Read only for everyone | Read only for everyone |

**What read-only people see:**

- **In the picker:** "Read only here. You can open files, but only admins can change them."
- **When saving in the editor:** "Only admins can change CSE 3B's files. Your changes stay on your computer."
- **Handing in link or text work:** "Use Submit to hand this in," with a link that opens the task panel in the browser.

**Server changes:**

- Locks and saves in an organization follow the same admin rule as the website.
- Attaching files to a task first checks that you can see that task.

### 24.3 GitHub

**Organizations:** still no GitHub (older decision 85), because publishing could expose Admins-only folders. There's no button and no sync view.

**Child workspaces, who does what:**

| Person | Sees | Can do |
|---|---|---|
| Lead | Full GitHub view | Connect, push, disconnect (as today for most actions; the build confirms Connect) |
| Team member | "Synced to `owner/repo` · 2 hours ago", when connected | Read only, with no personal GitHub link needed; nothing shows when not connected |
| Organization admin, not on the team | The same status line | Read only |
| Everyone else | Nothing | Nothing |

**The new visibility rule**, which applies only to workspaces inside an organization:

| Workspace visibility | Repositories allowed |
|---|---|
| Public | Public or private |
| Organization only | Private only |
| Private | Private only |

| Moment | What happens |
|---|---|
| Choosing a repository | Public ones are refused: "This workspace is only visible inside CSE 3B, so its repository must be private." |
| Creating a new repository | The Public option isn't offered |
| Connecting | One line: "People with access on GitHub can see these files, even outside CSE 3B." |
| Every push | Checked again, because a repository can be made public on GitHub. If it was: "This repository is now public. Make it private or disconnect it." |
| Workspace or organization limit tightened | The connection stays, but pushes to public repositories stop. The confirmation in Settings → Workspaces (22.4) gives the count. |

**Assignments and GitHub:**

| Case | Design |
|---|---|
| Handing in code | Link hand-in: paste the repository or pull request |
| Publishing and completing a task | Assignment copies aren't offered; hand-in goes through Submit |
| Submission files | Never published, as today |
| Closing keywords in commits | Dropped. The older concept mentioned them, and they weren't found in the code. |

**When things change:**

| Case | What happens |
|---|---|
| Moving a workspace in | If it would break the rule, the confirmation says pushes will stop |
| Detaching, or deleting the organization | The connection stays with the lead; the rule no longer applies |
| New lead | The connection stays, and they see "Connect your GitHub to push" |
| Lead leaves the workspace | Same as a new lead, for whoever takes over |

**Activity:** "Pushed to GitHub" appears only on a workspace's activity, because an organization never has GitHub.

### 24.4 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The visibility rule, member locks in the editor, the task check on file attachments, and removing copies from publish-and-complete |
| Files and Tasks steps | The button placement and read-only wording |
| Child workspace steps | The GitHub status line for the team |

### 24.5 Calls made

- **No new setting.** The rule follows visibility, so nobody has to configure anything. If teachers later want to block GitHub entirely, a setting can be added.
- **Button in `⋯` on organizations.** Most classes and clubs don't code, so it stops taking up space until someone connects an editor.

### 24.6 Left out on purpose

- **Seeing and submitting assignments from the editor:** the older concept already marks this as later.
- **GitHub for organizations:** still not in this version.

## 25. Teams

Designed on 2 November 2026 from `child-units.ts`, `ChildUnitsPanel.tsx`, `applications/internal.ts`, `assignments.ts`, `blocking.ts` and the older concept (§14.4, §16.11, decisions 12, 13, 29–34, 107). Approved by the owner. This closes gaps 21–26 and corrects the team seat limit in 21.4. Findings come from reading the code; nothing was run.

### 25.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Accepted applicants don't get placed in their team.** Accepting records the role title but doesn't set the person's team (`acceptApplicationAction`, `applications/internal.ts:1079`). | The seat appears filled, while the person shows as "Not in a team". This is the real gap in gap 22. |
| 2 | **Outsiders can probably apply to a Public child workspace, even with "Outside people" off.** Apply only checks that you can read the workspace, and no such check was seen on accept. | The organization's rule can be bypassed. |
| 3 | **Teams are managed in two places with different rules.** "Workspace roles" creates and removes them, owner only. `ChildUnitsPanel` edits them, for leads and admins, but can't add or remove. | They become one screen. |
| 4 | **Being moved sends no notice** (`moveMemberToUnitAction`, `child-units.ts:90`). | People change teams without knowing. |
| 5 | **Late joiners get nothing on group assignments.** `createCopiesForNewMember` (`assignments.ts:192`) skips them with no sign. | They silently have no work. |
| 6 | **Open seats don't appear on the organization's Workspaces tab.** You have to open the workspace to find them. | Members can't browse what's open. |
| 7 | **Corrected (26.1):** "Not in a workspace" has an action. Admins can filter to those people, select them and add them to a workspace and team. | Only the seat limit check is left to confirm. |
| 8 | **"Ask to change team" ends in a notification** (`askToChangeTeamAction`, `blocking.ts:120`). It opens the Members tab, with no request waiting there. | Admins have nothing to act on. |
| 9 | **The screen says the lead gets the team's mentions, but the code notifies everyone** (`ChildUnitsPanel.tsx`, `task-comment.ts`). | The wording is wrong; the code is the better behavior. |
| 10 | **Section 21.4 said "Members per team: 100, checked".** Every path allows 10, and the 100 only appears in a code comment (`validations/workspace.ts:9`, `:16`). | 21.4 is corrected to 10. |

### 25.2 Naming

"Team" meant three different things, so these words apply across this report. The full glossary is in 39.4. Where an earlier section says "team lead" or "team" for a whole workspace or an assignment's people, this table wins. "Team Falcon" stays as an example workspace name.

| Word | Means | Example |
|---|---|---|
| **Workspace** | A child workspace | Team Falcon: Hash table library |
| **Workspace lead** | The person who runs it | Asha |
| **Team** | A named box inside a workspace | Frontend |
| **Team lead ★** | The contact for that box | Ravi ★ |
| **Group** | People sharing one assignment copy | Group A for Lab 2 |

Assign to becomes: a person, Everyone, Admins, **Groups**, Each workspace, Selected workspaces.

### 25.3 Creating and editing teams (gap 21)

**Where:** Settings → **Teams and open seats**. One screen replaces both of today's.

```
Frontend                                  3 of 4 · 1 open seat   ⋯
Ravi ★   Asha   Kiran                              [+ Add people]
Skills: React, CSS
```

| Field | Rule |
|---|---|
| Name | Required, up to 100 characters, unique in the workspace |
| Description, Skills | Optional; shown to people applying |
| Seats | 1 to 10; can't go below the people in it |
| Team lead ★ | Must be on the team; optional |
| Add people | Organization roster, with a "Not in a team" filter |
| `⋯` | Rename, Remove |

| Case | What happens |
|---|---|
| Who can edit | Workspace lead, workspace admin, organization admin. Replaces "Only the owner". |
| Everyone else on the workspace | Sees team rows with photos, ★ and open seats |
| Limit | 20 teams per workspace |
| No teams | "No teams yet. A workspace works fine without them." **Add team** |
| Removing a team | "4 people stay in the workspace, not in a team." Waiting applications are closed, and those people are told. |
| Team lead leaves or moves | The team has no lead, and the workspace lead is told |

**What ★ gives:** a label and first contact, with no extra permissions.

### 25.4 Applying for an open seat (gap 22)

**Where members find seats:**

- The organization's Workspaces tab shows `1 open seat` on the row, with Apply and a **Has open seats** filter.
- The workspace's Overview, in the Teams section.
- The "You're not in a workspace yet" empty state lists open seats.

**Who can apply:**

| Person | Can apply |
|---|---|
| Organization member | Yes, except to a Private workspace, which they can't see |
| Viewer | No |
| Already on this workspace | No; uses Ask to change team |
| Outside person | Only if the workspace is Public and Outside people is on. Checked on apply and accept. |
| Blocked from this workspace | Sees "Not available", with no reason |

**The flow:**

| Step | What happens |
|---|---|
| Apply | Team, seats left, description, and a short message |
| After sending | "Applied to Frontend" with Edit and Withdraw |
| Review | Lead, workspace admin or organization admin sees it at the top of Teams and open seats, with Accept and Decline. They're notified too. |
| Accept | The person joins **and is placed in that team**, and is told |
| Decline | An optional reason, and they're told |
| Seats fill up | Other waiting applications close and those people are told, as today |
| Applicant leaves the organization | The application closes |
| Workspace archived | Applying stops |

### 25.5 Moving people and asking to change (gap 23)

| Action | Who | Design |
|---|---|---|
| Move to another team | Lead, admins | `Move to…`; a full team says "Add a seat first"; **the person is now told** |
| Remove from a team | Lead, admins | They stay in the workspace |
| Move to another workspace | Organization admins | **New:** choose workspace and team; old lead hears only "1 seat open" |
| Workspace lead | Nobody | Must transfer the workspace first |

**Their work when moved to another workspace:** open tasks in the old workspace are unassigned, as on removal. Anything already handed in stays.

**Ask to change team:**

| Part | Design |
|---|---|
| Who sees it | Only organization admins. It stays private because it can be about a block. |
| Where | **Members → Requests**, a new row: "Asha asks to change team" |
| Actions | Move, Dismiss |
| Asker | "Sent. Nobody else is told." Once a day, as today |

### 25.6 People not in a team or workspace (gap 24)

| Case | Design |
|---|---|
| Member not in a workspace | The existing filter and bulk Add stay: choose workspace and team, with seats checked first |
| Needs your attention | Only when an open "Each workspace" assignment exists, because those people can't do it. Otherwise it's only the count, since many organizations don't need everyone in a workspace. |
| Their own view | "You're not in a workspace yet", with open seats and Create if allowed |
| In a workspace, not in a team | Fine as is. Listed under "Not in a team" with `Move to…`, and no warning. |

### 25.7 Group assignments (gap 25)

**Creating:** the Assign to field's Groups option offers:

| Way | Design |
|---|---|
| Auto-make | Choose a size; a random split, adjustable afterwards |
| Copy groups from | An earlier assignment; people who left are dropped, and new people land in "Not in a group" |
| By hand | Add group, add people, `Move to…` |
| Not in a group | Each gets their own copy |
| Preview | "Creates 4 copies: 3 groups (10 people) + 1 individual · notifies 11 people" |

| Case | What happens |
|---|---|
| One person, one group | Enforced per assignment |
| Group lead | First person by default; has no extra power, and anyone can submit |
| Late joiner | **Shows in the roster under "Not in a group"**, with Add to group or Give own copy, and admins are told |
| Member leaves | They come off the group; if they were lead, the next person takes over, as today |
| Last member leaves | The copy goes unless it was handed in |
| After a group submits | Locked; nobody moves in or out, as today |
| Return, Approve | Applies to the whole group |
| Excuse | One person; the group carries on |
| Extend | The whole group |
| Wants a different group | Asks in the private conversation; the admin moves them |

### 25.8 Team mentions (gap 26)

| Rule | Design |
|---|---|
| Where | Comments in a child workspace |
| Shows as | `@Frontend · 4` in the picker |
| Reaches | Everyone on the team, as the code does today. The wrong line about the lead is removed. |
| Empty team | Not offered |
| Group copies | No `@Group`; every comment already goes to the group |
| Private conversations | Follows 23.5: only people who can see it can be mentioned |
| Whole organization | No `@everyone`; announcements cover that |
| Blocked people | Not notified, as with any mention |

### 25.9 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | Placing accepted applicants in their team, and the outside-people check |
| Tasks step | Group assignments and late joiners |
| Workspaces and Members step | One Teams screen, open seats on the tab, the seat check on bulk Add, Move to another workspace, and the Requests row |

### 25.10 Calls made

- **"Group" for assignments.** It's the one wording change that clears the confusion.
- **Ask to change stays with admins only.** Telling the lead could reveal a block.
- **10 seats per team.** This suits real teams, and the 100 was never in use.

### 25.11 Left out on purpose

- **Permanent organization-wide groups:** older decision 29 says per assignment, with Copy groups from.
- **Team channels:** older decision 107 says later.
- **Teams in personal workspaces:** older decision 13 says later.

## 26. Joining and leaving

Designed on 2 November 2026 from `join-rules.ts`, `join.ts`, `organizations.ts`, `org-members.ts`, `members.ts`, the join pages, `PrivateOrgHeader.tsx`, `OrgInviteBanner.tsx` and the older concept (§20.7, §29.1). Approved by the owner. This closes gaps 27–35 and corrects 25.1 and 25.6. Findings come from reading the code; nothing was run.

### 26.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **The private organization page is a dead end.** Everyone outside sees the same "Join with code" (`workspace-route.tsx:119`), whether they're invited, waiting, declined or removed. | An invited person opening the page sees no Accept. Someone waiting doesn't see their request. A removed person gets no explanation. |
| 2 | **Leaving and rejoining probably loses assignments.** The check for an existing copy also counts the copy deleted on leaving (`createCopiesForNewMember`, `assignments.ts:192`). | They rejoin and silently get no copy of open work. |
| 3 | **There's no welcome panel.** This report and the older concept describe one, but none was found in the code. | People land on the Overview with no first steps. |
| 4 | **Expired invites vanish for the invited person.** They're simply filtered out (`openInvitesFor`, `members.ts`), with no message. | They see nothing and don't know why. |
| 5 | **Joining through setup skips the note.** An approval request sent after signing up has no note, and the note can't be added later. | Admins see a stranger's name with no context. |
| 6 | **The join page has no Cancel.** Someone waiting can only cancel from the organization's header, which a private organization never shows them. | They can't withdraw. |
| 7 | **The invite banner always says "a guest"** (`OrgInviteBanner.tsx`). It ignores the organization's role names. | A "Viewer" reads a different word than the rest of the app. |
| 8 | **Leave is refused for workspace leads with no way forward** (`leaveOrgAction`, `organizations.ts:345`). It says to transfer or detach, but doesn't link to them or list which ones. | The person has to find them alone. |
| 9 | **Section 25 was wrong about "Not in a workspace".** The Members tab already lets admins select people and add them to a workspace and team (`addMembersToChildAction`, `org-members.ts:375`). | 25.1 and 25.6 are corrected. Only the seat limit check is left to confirm. |

**Already working:** code to sign-up to setup to joined is built, including keeping the code through setup. Invites apply their role, title, workspace and team. A full organization keeps an invite open.

### 26.2 Joining by code with no account (gap 27)

| Step | What they see |
|---|---|
| 1. Preview | Logo, name, type; member count only if public; "You've been invited to join" |
| 2. Sign up | Google, GitHub or email, with the code kept |
| 3. Setup | Same steps, with "You'll join CSE 3B after setup" |
| 4. Finish | **Continue to CSE 3B** |
| 5. Join | No extra click. Instant joins; Approval sends the request. |
| 6. Arrival | Instant: welcome panel. Approval: "Request sent", with Add a note and Cancel. |

**What the preview page says:**

| Case | Message | Action |
|---|---|---|
| Wrong code, or the code is off or replaced | "That code doesn't work. Ask your organization for the current one." | Enter a code |
| Too many tries | "Too many attempts. Wait a minute and try again." | |
| Full | "This organization is full." | |
| Ended or suspended | "This organization isn't accepting new members." | |
| Blocked | "You can't join this organization." | |
| Already a member | Name and logo | Open CSE 3B |
| Waiting | "Request sent" | Add a note, Cancel |
| Recently declined | "Your last request was declined. You can ask again tomorrow." | |
| 50 organizations joined | "You've joined 50 organizations. Leave one to join this one." | |

If joining fails at the end of setup, the account is still created and they land on this page with the reason.

### 26.3 Invite emails (gap 28)

| Case | What happens |
|---|---|
| Has an account | Email and tray notice, with **Accept** |
| No account | **Create your account**, with the email filled in; after setup it's accepted automatically |
| Google or GitHub sign-up | Works if it's the same address |
| Link | One invite link for both, opening the same join page, with the role and title shown |
| Expired, after 14 days | "This invite has expired. Ask CSE 3B for a new one." |
| Cancelled | "This invite is no longer open." |
| Signed in with another address | "This invite went to `a•••@gmail.com`. Sign in with that address, or ask for a new invite." Nothing is accepted. |
| Full | "This organization is full." The invite stays open. |
| Already a member | Open CSE 3B |

**Admins' side, Members → Invited:**

- Each row shows the address, role and when it expires.
- **Expired invites stay listed** with an `Expired` chip and Resend, so nobody disappears silently.
- Cancel removes one, as today.

### 26.4 Invite banner and accepting (gap 29)

| Place | Design |
|---|---|
| Organization page header | "You're invited as Student · Section B", with Accept and Decline. Uses the organization's role names. |
| Private organization page | The same, in the page's card |
| Network → Invitations | As today |
| Accept | Joins, then shows the welcome panel |
| Decline | Removes the invite. The inviter isn't told, and the row leaves the Invited list. |

### 26.5 Join requests (gap 30)

| Stage | Person asking | Admins |
|---|---|---|
| Send | Optional note, up to 500 characters | Row in Requests, with name, how they came, note and age |
| Waiting | "Request sent", with **Add a note** and **Cancel** on the join page, private page and header | Same row; the note updates |
| Approved | "You're in CSE 3B", then the welcome panel on their next visit | Row goes |
| Declined | Optional reason, and they can ask again tomorrow | Row goes |
| Cancelled | No waiting period | Row goes, with no notice |
| Code replaced | Request stays | Same |
| Switching to Instant | Request stays until decided (22.4) | Same |
| Organization ended | The request closes, and they're told | |

Requests don't expire, and the row's age shows how long they've waited.

### 26.6 Organization full (gap 31)

| Where | What happens |
|---|---|
| Joining by code or from the page | "This organization is full." Nothing is created. |
| Accepting an invite | Same message; the invite stays open |
| Approving requests | "This organization is full (40 members). Raise Max members first." Nobody is partly approved. |
| Admins | Needs your attention: "Organization is full · Manage", opening Settings → Joining |
| At 80% | The early warning from 21.4 |

### 26.7 Welcome panel (gap 32)

It shows once, at the top of Overview, the first time someone arrives after joining.

```
Welcome to CSE 3B                                              ×
"Read the syllabus first, then join a lab team."  — Ms. Rao

START HERE
[BookOpenText]  Read the Course syllabus                    Open
[ClipboardCheck] Lab 1 · due Fri                            Open
[Users]         Join a workspace · 3 open seats           Browse

[Add to your profile]
```

| Part | Design |
|---|---|
| Welcome note | Only if set; it stays on About afterwards |
| Start here | At most 3 rows, only ones that apply: required or pinned document, next due work, open seats or their own workspace |
| Add to your profile | Opens the draft from 4.3; hidden if already published |
| By role | Admin: Invite people, Open Members. Viewer: the note and what they can read. |
| Nothing to show | "You're in CSE 3B." with × |
| Dismiss | × hides it for good, on every device. This needs one small database column. |
| Existing members | Never see it |

### 26.8 Viewers (gap 33)

The word on screen is **Viewer**, or the organization's own role name. "Guest" goes away, and where earlier sections say Guest, they mean Viewer.

| Part | Design |
|---|---|
| How they join | By email invite only; a code always makes a Member |
| Overview, About | Read only; the header says "Viewer · read only" |
| Documents, Files | Read, except Admins-only |
| Updates | Read; no posting or comments |
| Sprints, Tasks | Counts only, with no names, and no copies or Submit |
| Workspaces | Read |
| Messages | Not added to #general; admins can add them to channels |
| Members | Hidden |
| Settings | My membership, What's allowed, Privacy, Leave |
| Max members | Viewers count |
| Made a Member | They receive open assignments and are told. The build confirms this path. |

### 26.9 The private organization page (gap 34)

It stays minimal: logo, name and "Private organization". The rest depends on who's looking:

| Person | Shows | Action |
|---|---|---|
| Signed out | Nothing more | Join with code, Sign in |
| Signed in, no link to it | Nothing more | Join with code |
| Invited | "You're invited as Student" | Accept, Decline |
| Waiting | "Request sent" | Add a note, Cancel |
| Declined | "Your request was declined. You can ask again tomorrow." | |
| Left | "You left CSE 3B on 2 Nov." | Join with code |
| Removed | "You're no longer in CSE 3B." | Join with code |
| Blocked | "You can't join this organization." | None |
| Ended | "This organization has ended." | None |

On a **public** organization, a former member sees the same line on About. Nothing else from inside is shown.

### 26.10 Leaving by choice (gap 35)

**Where:** Settings → Management → Leave.

```
Leave CSE 3B?
· You'll leave Team Falcon and Team Osprey; your seats reopen
· 3 open assignments are removed
· 2 submitted assignments stay with the Teachers and TAs
· Your profile entry stays, as "Left Nov 2026"
· To come back, you'll need the current code or a new invite
                                          [Cancel]  [Leave]
```

| Case | What happens |
|---|---|
| Leads a workspace | Leave is replaced by the list of those workspaces, each with Transfer and Detach |
| Only owner | "Transfer ownership first," with a link |
| On a group | They come off the group; the next person takes over as lead |
| Team lead | The team has no lead, and the workspace lead is told (25.3) |
| Afterwards | Back to About if public, otherwise Discover, with "You left CSE 3B" |
| Who hears | Admins, grouped as today; each workspace lead hears "1 seat open" |
| Coming back | Treated as joining fresh, with **new copies of open assignments**; past submissions stay with admins |

### 26.11 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The rejoin fix, and checking the 50-organization limit |
| Step 2 (Membership) | The private page states and the leave dialog, because Left and Removed need the new end reason |
| Members step | The expired invite row, the banner wording and join request notes |
| Overview step | The welcome panel |

### 26.12 Calls made

- **One message for a wrong, off or replaced code.** It doesn't reveal whether a code ever existed.
- **Welcome shows once.** It doesn't nag, and About keeps the note.
- **Declining an invite is silent.** The inviter just sees the row go, so nobody feels called out.

### 26.13 Left out on purpose

- **Waiting list when full:** admins can raise the limit.
- **Requests that expire:** age is enough.
- **Domain-locked joining:** the older concept removed it.

## 27. Creation and lifecycle

Designed on 2 November 2026 from `OrgWizardFields.tsx`, `Phase5Review.tsx`, `OrganizationCreatedScreen.tsx`, `lifecycle.ts`, `OrgDangerZone.tsx`, `OrgHeaderParts.tsx`, `handle.ts`, `trust.ts` and the older concept (§30.2, §30.3, §30.5, §34). Approved by the owner. This closes gaps 36–43 and changes section 6 and 22.4. Findings come from reading the code; nothing was run.

### 27.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Duplicating won't move dates without a term start.** Dates shift by the gap between term starts, and with no term on the old organization, the shift is zero (`duplicateOrg`, `lifecycle.ts:170`). | 21.2 hides Term outside Education, so every company or club duplicate would keep last term's dates. |
| 2 | **Suspension reasons appear to go to everyone who can see the page.** `OrgStatusBanner` adds the reason for any viewer. The older concept tells only the owner. | A moderation reason could be read by every member. |
| 3 | **The "5 organizations" limit is checked only at the end** (`server/lifecycle.ts:609`). | Someone can fill in the whole wizard and be refused at Create. |
| 4 | **Transfer doesn't check the new owner's limit** (`transferWorkspaceOwnership`, `account.ts`). It does notify them (corrected in 30.1). | An admin can become an owner past the limit of 5. |
| 5 | **Term-ending prompts aren't built.** Section 6 describes them, but the code only asks admins to verify after archiving (`needs-you.ts`). | Nothing reminds a teacher that a term is ending. |
| 6 | **The rules differ by screen.** Names: 3–100 in the wizard, at least 2 in Duplicate, 2–80 in the older concept. Welcome note: 500 in the wizard, 2,000 in Settings. | One rule each is set below. |
| 7 | **The wizard still has steps that no longer apply.** It offers member upload settings for organizations, and its review step says the card appears on Discover, even when it won't. | Removed or corrected below. |
| 8 | **A verified badge stays when the website changes.** It's checked only at the moment of asking (`requestOrgVerificationAction`, `trust.ts:34`). | An organization could keep ✓ after moving to another domain. |

**Already working:** the wizard, the ready screen, its soft checks, the handle rules and holds, staff review of verification requests, and removing a badge.

### 27.2 Creation wizard (gap 36)

Same 5 steps. Nothing is required except type, name, handle and About.

| Step | Fields | Rule |
|---|---|---|
| **Start** | Type; "What do you call it?" for Other | Nothing preselected. **At 5 owned organizations, the card says so before you begin.** |
| **Details** | Name, handle, tagline, Part of, subject, where, time zone | Placeholders by type; handle suggested and checked live |
| | About, who it's for, what members do, welcome note | About is 20–5,000 characters |
| | Topics | No skills picker |
| **People** | Your title, role names, co-admins (up to 10) | Viewer replaces Guest |
| | Join mode, max members | Defaults from 21.2 |
| | Invite emails (up to 500) | Shows "62 emails, 2 look wrong" |
| **Setup** | Visibility, picture, links | Defaults from 21.2 |
| | Term dates | **Education only** |
| | Plan your first sprints | Named CO1 or Sprint 1 by type |
| | Who creates workspaces, highest visibility, outside people, default teams | Same as Settings → Workspaces |
| | Members can post discussions | The **upload setting is removed** |
| | Work defaults | One summary line with Change |
| | Starter document | Syllabus, Team handbook, Lab guide, Code of conduct or Blank |
| **Review** | Card preview, grouped summary, soft checks | The fixes below |

**Review step fixes:**

| Today | Change |
|---|---|
| "Select Create workspaceect" | "Select Create organization" |
| "This is how your workspace card will appear in Discover" | Public: "This is how it appears on Discover." Private: "Only members see this card." |
| Notifications row | Kept, in plain words |

**On Create:** the values from 21.2 are saved, not just implied by the type. Everything is created together, and a failed email never stops it.

### 27.3 Ready screen (gap 37)

It's mostly built, and only small things change:

```
CSE 3B is ready
People join with this code.
N Z W H M 9
[Copy code]  [Copy invite message]
Needs your approval · 2 co-admin and 62 member invites sent
2 addresses looked wrong and were skipped
[Go to organization]
```

| Part | Design |
|---|---|
| Join mode line | New: says whether people join instantly or need approval |
| Skipped addresses | New: lists how many, so nobody is missed silently |
| Invite message | Includes the link, signed with your name and title, as today |
| Afterwards | The Invite panel holds the same code. Get started shows finished steps as ticked. |

### 27.4 Duplicate for the next term (gap 38)

**Where:** Settings → Management, and also offered in the term-end prompt.

| Field | Rule |
|---|---|
| Name | 3–100 characters |
| Handle | Checked live |
| Start date | "Term start" for Education, "Start date" otherwise |
| What to copy | About and settings; Documents; Folders and admin files; Sprint plan; Assignments as drafts; Channel names; Invite current admins |

**Never copied:** members, workspaces, submissions, messages, posts, contributions or the join code.

| Case | What happens |
|---|---|
| **Moving dates** | **From the old term start. Without one, from the first sprint. With neither, there's nothing to move.** |
| Copied sprints | All start in Planning |
| Copied assignments | Drafts; nothing goes to anyone |
| Dates still in the past | Listed afterwards: "3 sprints have past dates" |
| While it builds | "We'll tell you when CSE 3B 2027 is ready" |
| Ready | A notice opens its ready screen with the new code |
| Failed | "Couldn't finish CSE 3B 2027," and any partial copy is removed |
| Archived organization | Can be duplicated; this is the common case |
| Owner at 5 organizations | Refused before starting, as today |

### 27.5 Archive and Unarchive (gap 39)

**Before archiving,** a preview lists: workspaces archived with it, sprints that stop, and "6 submissions still waiting for review", with a link to review them.

| Place | While archived |
|---|---|
| Header | `Archived` chip with one notice; no New or Invite |
| Overview | History stays. Needs your attention shows only "Verify members' contributions". |
| About, Documents, Files | Read and download |
| Updates | Read only |
| Sprints, Tasks | Read only; no Submit or review |
| Workspaces | Read; each shows "Archived with CSE 3B" and is read only |
| Members | List and Verify only |
| Messages | Read only |
| Settings | Read only, except Management and My membership |
| Sidebar, Discover | Moves under Archived; leaves the Discover feed; a public page stays reachable |
| Profiles | Credit changes to "Completed" |

**Unarchive:** everything returns, and workspaces archived with it reopen. There's a new code, off until switched on, shown as "Turn on the new code". Sprints with passed dates don't start by themselves. Members are told.

**Term-end prompt (new, Education only):** from 14 days before the term ends, admins see "Term ends 15 Dec · Review open work · Verify members · Archive · Duplicate". It never archives by itself.

### 27.6 Transfer ownership (gap 40)

| Step | Design |
|---|---|
| Choose | From existing admins only; with none, "Make someone an admin first" |
| Check | Their 5-organization limit: "Priya already owns 5 organizations" |
| Confirm | "Priya becomes Teacher (Owner). You become TA (Admin). Only Priya can archive, delete or transfer." Then re-enter your sign-in, as today. |
| After | Both are told, as today. Your title stays until you change it. |
| Workspaces | Unaffected; their leads stay |
| Leaving afterwards | Now allowed |

### 27.7 Suspended and deleting states (gap 41)

| Part | Suspended | Scheduled for deletion |
|---|---|---|
| Who can open it | Everyone who could before | Owner only |
| Notice | "This organization is suspended. Everything is read only." | "Scheduled for deletion on 2 Dec · Restore" |
| **Reason** | **Owner and admins only**, with how to appeal | Not applicable |
| Buttons | No New, Invite, Post or Submit | Restore, and read only |
| Join code | Stops | Stops |
| Emails | Stop | One email with the date and "Download your submissions" (19.1) |
| Discover, search | Hidden | Hidden |
| Child workspaces | Read only, with "CSE 3B is suspended" | As in 19.1 |
| Members | Read only | No access, except their own submissions in My work |
| Other people opening the link | Private page line: "This organization isn't available." | Same |

Report, appeal and restricted states stay with Moderation (gap 8).

### 27.8 Name and handle rules (gap 42)

| Rule | Name | Handle |
|---|---|---|
| Length | **3–100 characters, everywhere** | 3–40 characters |
| Characters | Any language; no links or control characters | `a–z 0–9 -`; a letter or number at both ends; no `--` |
| Duplicates | Allowed | Must be unique |
| Reserved | No | Yes, as today |
| Changing | Owner, any time | Owner, once every 7 days |
| Old value | Past notices keep it | Redirects and is held for 90 days; the organization can take it back |

**Handle messages:** "That handle is reserved." "@cse-3b is taken." "Use 3–40 letters, numbers or single dashes." "You can change it again on 9 Nov."

**Welcome note:** 500 characters everywhere, replacing the 2,000 in 22.4. It's meant to be read at a glance in the welcome panel.

### 27.9 Verified badge (gap 43)

| State | Owner sees | Action |
|---|---|---|
| No website | "Add your website in Links" | Open Links |
| Ready | What ✓ means | Request verification |
| Email domain matches website | Verified at once | |
| Otherwise | "Requested. The NetworkBase team will review it." | Staff review, as today |
| Declined | The reason | Ask again |
| Verified | "This organization is verified" | |
| Removed by staff | The reason | Ask again |

**When a badge is rechecked:**

| Change | What happens |
|---|---|
| Website moves off the verified domain | ✓ goes, and the owner is told |
| Renamed, verified by domain | ✓ stays |
| Renamed, verified by staff | Goes back to Requested |
| Ownership transferred | ✓ stays; the organization earned it, not the person |

**Where ✓ shows:** header, cards and Discover. Part of is never treated as verified.

### 27.10 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The duplicate date fix, showing suspension reasons only to owners and admins, the owner limit on transfer, and the limit check at the start of the wizard |
| Settings step | Transfer, Archive and Verified changes |
| Overview step | The term-end prompt and archived states across tabs |
| Alongside step 1's wording fixes | Wizard and ready screen changes |

### 27.11 Calls made

- **Suspension reason for owners and admins only.** A moderation reason could embarrass someone in front of a whole class.
- **Term-end prompt for Education only.** Other types have no term under 21.2.
- **Names 3–100, welcome note 500.** These match the wizard.
- **Transfer needs no acceptance.** The person is already an admin, and they're told at once.

### 27.12 Left out on purpose

- **Automatic archiving at term end:** too easy to do by surprise.
- **Scheduled transfers or a co-owner role:** the owner is one person, as decided.

## 28. Remaining tab details

Designed on 2 November 2026 from `sprint-rules.ts`, `sprints.ts`, `org-updates.ts`, `OrgUpdateParts.tsx`, `org-docs.ts`, `org-files.ts`, `organizations.ts`, `member-rules.ts`, `OrgMembersTab.tsx`, `assignments.ts` and the older concept (§15.3, §17.4, §19.4, §23.8). Approved by the owner. This closes gaps 49–57. Findings come from reading the code; nothing was run.

### 28.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Move-in requests can't be approved.** `approveMoveInAction` (`organizations.ts:485`) exists, but only a test calls it, and there's no Decline at all. | A lead who asks to move a workspace in waits forever, unless they cancel. The admin's notice opens a tab with nothing to act on. |
| 2 | **Corrected (30.1):** the limit of 5 announcement emails a day is enforced, but the author isn't told when it stops an email. | A teacher believes everyone was emailed when they weren't. |
| 3 | **New members can count as inactive at once.** Anyone with no recorded activity counts, regardless of when they joined (`memberStatus`, `member-rules.ts`). | Someone who joined today can show as "Inactive". |
| 4 | **Remind reports the wrong number.** It says everyone was reminded, even when the 12-hour rule skipped them (`remindMembersAction`, `remindCopiesAction`). The window is also a fixed clock block, not 12 hours since the last reminder. | Admins are told people were reminded when they weren't. |
| 5 | **Read data exists but isn't shown.** Documents record who opened which version (`docOpens`), and members record when they last saw Updates (`lastSeenUpdatesAt`). No screen uses either. | "Who read it" needs only a screen, with no new tracking. |
| 6 | **A sprint series can't be moved together.** Each sprint moves alone, and the server refuses the first overlap (`sprints.ts:48`). | Shifting a term by a week means editing every sprint in reverse order. |
| 7 | **Revoking verification uses a browser pop-up** (`window.prompt`, `OrgMembersTab.tsx`). | Same fix as the Return reason in 23.2. |

**Already working:** overlap checks, "Move due dates too", the pin limit message, version history, per-person document opens, template folders at workspace creation, the 10 MB message and download-all.

### 28.2 Sprint series (gap 49)

**Repeat form, the preview shows every sprint before saving:**

```
CO1 · 1–14 Nov
CO2 · 15–28 Nov   ⚠ Overlaps Mid-term break
CO3 · 29 Nov–12 Dec   ⚠ Passes the term end
```

| Case | What happens |
|---|---|
| Overlap | Create is blocked, with **Start after Mid-term break** to fix it in one click |
| Passes the term end | A warning only |
| Numbering | Continues from the last sprint: CO4, CO5 |
| Limit | Up to 52 |

**Editing a sprint's dates, the form adds one option:**

| Option | Design |
|---|---|
| **Move later sprints too** | "CO3, CO4 and CO5 also move by 7 days." Only shown when later Planning sprints exist. |
| Move due dates too | Exists today; applies to all the sprints being moved |
| Running or finished sprints | Never moved by this |
| Would overlap | Nothing is saved, and the clash is named |
| Saving | All together or not at all |
| Linked workspace sprints | Never changed; flagged "Outside CO3 dates" for the workspace lead, as today |

There's no separate series record: "later sprints" just means later sprints.

### 28.3 Updates (gaps 50 and 51)

| Part | Design |
|---|---|
| **Seen count** | Admins see `Seen by 32 of 40` on announcements. It counts people in the audience who've opened Updates since it was posted. |
| Who hasn't seen it | Clicking the count lists them, with Remind. Only admins see this. |
| New marker | For members, as today |
| Important announcements | In Needs your attention until opened, as today |
| Replies | The composer's reply setting starts from Settings: Members, Anyone signed in, or Off. It can be changed per post. |
| Comments off later | Existing comments stay, and a line says "Comments are off" |
| Reactions | The existing like, with who liked it; no other reactions |
| Pins | Up to 3. At the limit, Pin shows "Unpin one first" and lists the three. A pin can end on a date. |
| Editing | Shows `Edited`, and notifies only if "Notify again" is ticked |

**Email limit:**

| State | Composer shows |
|---|---|
| Under the limit | "Also email · 3 of 5 left today" |
| At the limit | The tick turns off: "5 emails sent today. Resets tomorrow." Posting still works. |
| Counted | When sent, per organization, by the organization's day. The server checks it. |

### 28.4 Documents (gaps 52 and 53)

**Required reading:**

| Part | Admin | Member |
|---|---|---|
| Marking | Required switch on the document | `Required` chip |
| Tracking | `Read by 32 of 40`, using the existing opens | In Needs your attention until opened |
| Not read | Clicking lists them, with Remind | |
| Changing it | **Ask to re-read** counts from zero | `New` again |
| Normal update | No reset; `Updated` for 7 days | `Updated` chip |
| Viewers | Not counted | Can read |

"Read" means opened. The line says so, because we can't know more.

**Group editor, history and templates:**

| Part | Design |
|---|---|
| Groups | In the same right-hand panel a workspace uses: rename, reorder, add; up to 20 |
| Removing a group | Documents move to the first group, after a confirmation |
| Version history | The existing screen: compare and restore; restoring makes a new version |
| Templates | Template switch on the document |
| Using one | **Use this template**, then choose one of your workspaces; a copy is made there. Copies don't update later. |
| Workspaces | "From CSE 3B" section, read only, for documents shown there |

### 28.5 Files (gap 54)

| Part | Design |
|---|---|
| Template folders | Folder `⋯` → **Use as template**; shows a `Template` chip |
| Using one | When creating a workspace, "Start from a template" lists them; files are copied, not linked |
| Admins-only folder | Can't be a template, because copying would expose it |
| Empty template folder | Not offered |
| Download all | In the assignment panel: one folder per person or group, with their latest files |
| Over 2 GB | "Too large for one download. Download by group or person." |
| File over 10 MB | "Asha's report.pdf is 14 MB. Files can be up to 10 MB.", naming each file |
| Several files, one too large | The others still upload, and the one is listed |

### 28.6 Move-in and leave requests (gaps 55 and 66)

**Asking to move in, lead's side:** lives in the workspace's Settings → Organization.

| Stage | Lead | Organization admins |
|---|---|---|
| Choose | Lists organizations they belong to; says what changes: its rules, visibility limit and admin access | |
| Blocked | "2 people aren't in that organization," named, with Remove | |
| Admin asks | Happens at once, without a request | |
| Member asks | "Request pending," with Cancel | **New row in Workspaces → Requests and Needs your attention:** workspace, lead, members, files, with **Approve** and **Decline** |
| Approved | "Team Falcon is now part of CSE 3B" | Row goes |
| Declined | Optional reason; can ask again | Row goes |

**Asking to leave:**

| Stage | Lead | Organization admins |
|---|---|---|
| Ask | Says what changes: it becomes private, unsubmitted group work goes, and sprints unlink | Same row: **Approve**, **Decline** |
| Cancelled | Row goes, with no notice | |
| Approved | Told; workspace is now private | |
| Declined | Optional reason | |
| Admin detaches without a request | The lead is told, as today | |

### 28.7 Member panel (gap 56)

Opens from a roster row, in the same side panel used everywhere.

| Section | Contents |
|---|---|
| Top | Photo, name, role, title, joined date, last active; View profile, Message |
| Work | Their assignments with status and late mark; each opens that copy; Excuse and Extend there |
| Workspaces and teams | Each with its team, and `Move to…` |
| Contribution credit | Verified or not; Verify; **Revoke opens a proper dialog** with a required reason, which they'll see |
| Recent activity | Last 10 events, with one icon set |
| Membership | Title, Change role |
| Bottom | Remove, opening the dialog from 4.7 |

**Who's flagged:**

| Label | Rule | Shown as |
|---|---|---|
| Behind | Anything missing, not counting excused or closed work | `Behind · 2 missing` |
| Inactive | **No activity for 14 days, counted from when they joined** | `Inactive · 20 days` |
| New | Joined in the last 14 days with no activity | No label |

Both labels are visible to admins only.

### 28.8 Remind (gap 57)

| Part | Design |
|---|---|
| Where | Roster (one or all not done), Members bulk bar, member panel, unseen and unread lists |
| Rule | **Once per person per item every 12 hours, counted from their last reminder** |
| Before sending | Button says "Remind 12" |
| After | **"Sent to 9. 3 were reminded recently."** |
| Nothing to send | The button shows "Reminded 3 hours ago" |
| Skipped automatically | Excused, already handed in, and left |
| Wording | "Reminder: Lab 1 is due Fri." Names no one else. |
| Who can | Owner and admins |

The rule needs a small record of when each person was last reminded, which also fixes finding 4.

### 28.9 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The Approve and Decline actions for move-in, and the corrected inactive rule |
| Sprints step | The Repeat preview and Move later sprints |
| Updates step | Seen counts, the email counter and the at-limit message |
| Documents step | Read counts |
| Files step | Template and size messages |
| Workspaces and Members step | The Requests row, member panel and Remind |

### 28.10 Calls made

- **"Seen" and "Read" are honest words.** Seen means they opened Updates since it was posted. Read means they opened the document. Neither proves more.
- **Move later sprints, not a series record.** It's the same result with no new data.
- **Admins-only folders can't be templates.** This prevents accidental exposure.
- **Like only, no other reactions.** It's what exists, and keeps this simple.

### 28.11 Left out on purpose

- **Read receipts for members:** only admins see these counts.
- **Signing documents as read:** opening is enough for now.
- **Editing the series as a group:** Move later sprints covers the real need.

## 29. Trust and privacy

Designed on 2 November 2026 from `docs/trust-and-safety-concept.md`, `org-members.ts`, `blocking.ts`, `join.ts`, `assignment-rules.ts`, `hard-delete.ts`, `lifecycle.ts` and the Privacy Policy and Terms pages. Approved by the owner. Moderation and blocking are already designed and built app-wide; this section settles how they work inside an organization, and what admins can see of members. It closes gaps 8, 9 and 16. Findings come from reading the code; nothing was run.

### 29.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Admins see account-wide "last active".** The roster reads the person's last activity anywhere on NetworkBase (`profiles.lastActiveAt`, `org-members.ts:67`), not in this organization. | A teacher can see that a student was active on their personal work on Sunday night. It also makes "Inactive" wrong, since someone active elsewhere never counts as inactive here. |
| 2 | **Members aren't told what admins can see.** The Privacy Policy covers reports in organizations, but nothing was found on activity, submissions, private conversations or channels, and no screen says it either. | People join without knowing. Section 28's Seen and Read counts add to this. |
| 3 | **Blocked-from-rejoining people can't be unblocked.** The block is saved and checked (`orgJoinBlocks`, `join.ts:112`), but no list or Unblock was found. | A mistake is permanent. 22.4 assumed this existed. |
| 4 | **Auto-made groups ignore personal blocks** (`splitIntoTeams`, `assignment-rules.ts:68`). | Two people who've blocked each other can land in one group. |
| 5 | **Members see nothing when an organization is restricted.** The moderation concept says "restricted for now" (§8.7). | They don't know why the page changed. |
| 6 | **No Standing row in the organization's Settings.** The moderation concept puts the owner's appeal there (§10.2), and none was found in the organization screens. The account-level banner may cover it, so the build confirms. | The owner may have no way to appeal from Settings. |

**Already correct:** reporters are never named. Admins never see DMs or personal block lists. The roster doesn't show members' email addresses. An admin viewing someone they're in a block with is recorded for safety. Join requests go to an admin who isn't in a block with the person, when there is one.

### 29.2 Moderation in an organization (gap 8)

The rules stay as locked in the moderation concept. Who decides:

| Report about | Who decides |
|---|---|
| Everyday content in the organization | Owner and admins first, then NetworkBase at the deadline |
| Urgent reasons | NetworkBase only; admins are told nothing |
| The owner or an admin | NetworkBase only |
| The organization itself | NetworkBase only |

**What people see:**

| Place | Design |
|---|---|
| Report | Organization header `⋯`, its card, the join page, and each post, comment, document, file and message |
| Admins | Settings → Moderation (22.4), a count in the menu, a Needs your attention row and the daily email |
| Admin actions | Dismiss, Hide, Remove, Warn. No strikes on the account. |
| Author of removed content | A tray notice with the reason, and Appeal to NetworkBase |
| If NetworkBase reverses it | The content returns, and admins are told |
| 3 removals for one person in 30 days | Opens a case with NetworkBase automatically |

**Organization states:**

| State | Members see | Owner sees |
|---|---|---|
| Hidden from Discover | Nothing | Banner, with Appeal |
| Restricted | **"This organization is restricted for now."** | Banner with the reason, and Appeal |
| Suspended | Read-only notice (27.7) | Banner with the reason, and Appeal |
| Removed | The deletion notice with the date | Banner with the date, and Appeal; deletion waits for the decision |

**Standing:** the owner gets a Standing row at the top of Settings → Moderation: "In good standing", or the action, reason and Appeal. Admins see the state and reason, but only the owner can appeal.

### 29.3 Blocking inside an organization (gap 9)

**The rule:** a personal block limits contact, and never stops someone's work or tells anyone else.

| Situation | What happens | Who learns of the block |
|---|---|---|
| Same class | Both stay; no DMs or mentions between them | Nobody |
| Comments on shared work | Folded for the person who blocked, as in Messages | Nobody |
| Mentions | The blocked person isn't offered in the picker | Nobody |
| **Auto-made groups** | **The split quietly avoids putting them together** | Nobody |
| Groups or teams made by hand | Allowed, with no warning, because a warning would reveal the block | Nobody |
| Already together | Either can use Ask to change team (25.5) | Admins see only the request |
| Admin in a block with a member | Their duty continues, and the view is recorded for safety | Safety staff only |
| Join request or review | Goes to another admin when there is one; otherwise stays with them | Nobody |
| Class questions | Folded the same way; answers still reach everyone | Nobody |
| Announcements | Everyone still gets them | Nobody |

**Block from rejoining** is separate: it's the organization's own decision, and it's visible to admins.

| Part | Design |
|---|---|
| Where | Settings → Moderation → Blocked people |
| Shows | Name, who blocked them, date |
| Unblock | After a confirmation; they aren't told, and they can join again |
| Who | Owner and admins |
| The person sees | "You can't join this organization." |

### 29.4 What admins can see (gap 16)

| Admins **can** see | Admins **can't** see |
|---|---|
| Name, role, title, joined date | DMs |
| **Last active here** | Activity outside this organization |
| Assignment status, submissions and files | Other organizations or personal workspaces |
| Private conversations on assignments | Email addresses, unless they invited by email |
| Recent activity in this organization and its workspaces | Personal block lists |
| Seen and Read lists (28.3, 28.4) | Who reported something |
| Who downloaded a file, kept for 90 days | Contribution drafts |
| Channels here, including a workspace's channels if they open them | |

**Last active here:** it's the last time they opened or did something in this organization or its workspaces. It replaces the account-wide time everywhere in Members, and Inactive (28.7) uses it too. It needs a small value on each membership, updated at most hourly.

**Telling people:**

| Place | Design |
|---|---|
| Join page | One line: "CSE 3B's Teachers and TAs can see your work here and when you were last active here. They can't see your DMs or anything outside CSE 3B." Links to the full list. |
| Settings → What's allowed | The full list above |
| Workspace channel details | "Organization admins can open this channel." |
| Private conversation | The "who sees this" line (23.5) |
| Privacy Policy | A new section with the same list, plus the retention table below |

**What happens to data:**

| Data | After leaving or removal | After the organization is deleted |
|---|---|---|
| Submissions | Stay for admins; the person loses access | Downloadable by them for 30 days, then gone |
| Unsubmitted copies | Removed | Gone |
| Group work | Stays with the group | Gone, except kept workspaces (19.1) |
| Posts, comments, files | Stay, with their name | Gone after 30 days |
| Channel messages | Stay | Gone after 30 days |
| Seen, Read and activity history | Stay for admins | Gone after 30 days |
| Download history | 90 days | Gone after 30 days |
| Profile entry | As in 4.3 | Keeps the name, with no link |
| Account deleted | Own copies go; group work shows "Deleted user", as today | Same |

**An archived organization keeps everything** until its owner deletes it. There's no automatic expiry, and the Privacy Policy says so.

**Asking for your data:** a person's account export should include their own submissions and organization memberships. The build confirms this.

### 29.5 Age, decided

**Age.** The Terms say users must be at least 18, but Education organizations could easily be used by school classes.

Decided (163): launch is 18 and over only, with the Education card worded "A college or university class". School classes are a separate project later, with parent consent and a lawyer's review. The Privacy Policy section is drafted in deploy 1d and reviewed by a lawyer before opening up (167).

### 29.6 How this gets built

| Build step | What goes in |
|---|---|
| Step 1a | Last active here, because it's a privacy fix |
| Settings step | Standing and Blocked people |
| Tasks step | Auto-made groups avoiding blocks |
| Overview step | The restricted notice |
| Members step | The join page line and the admin list |
| Before launch | The Privacy Policy section |

### 29.7 Calls made

- **No warning when blocked people are placed together by hand.** A warning would reveal the block, which matters more than the awkwardness.
- **Admins can see the Standing state; only the owner appeals.** This matches the moderation concept, and 27.7 already gives admins the reason.
- **Archived data has no automatic expiry.** A class record may be needed for years, and the owner can delete it.

### 29.8 Left out on purpose

- **Letting a member hide their activity from admins:** the work belongs to the organization. The join line tells them up front.
- **Anonymous reporting choices:** reporters are already never named.
- **Age checks:** part of the decision in 29.5.

## 30. Messages and notifications

Designed on 2 November 2026 from `notify.ts`, `org-updates.ts`, `org-chat.ts`, `workspace-policy.ts`, `org-templates.ts`, `org-digests.ts`, the My work components and the older concept (§25, §26). Approved by the owner. This closes gaps 2–6 and corrects 21.1, 21.4, 27.1 and 28.1. Findings come from reading the code; nothing was run.

### 30.1 Corrections to earlier sections

Earlier sections searched for limits by their config names, and these checks use other names.

| Earlier claim | What's true | Corrected in |
|---|---|---|
| The limit of 5 announcement emails a day isn't enforced | It is enforced, in `notifyAnnouncement` (`notify.ts`). Posts past the limit reach the tray but aren't emailed. | 21.4, 28.1, 28.9 |
| Channel limit: no check found | The database enforces 200 channels (`0014_messaging.sql:418`). | 21.4 |
| Transfer sends no notice to the new owner | It does, with a tray notice and an email (`account.ts:376`). | 27.1, 27.6 |

The other "No check found" rows in 21.4 are still unconfirmed for the same reason. The build checks each one.

### 30.2 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Past the email limit, the author isn't told.** The tick stays on and the post goes out, but no email is sent and no message appears. The count is also a rolling 24 hours. | A teacher believes everyone was emailed when they weren't. |
| 2 | **Reminders and group moves are sent as "due date changed".** They reuse `assignments.due_changed`. | Turning off due date changes also turns off reminders. |
| 3 | **My work has no download for your own submissions.** 19.1 promises this while an organization is being deleted. | People can't get their work out in those 30 days. |
| 4 | **The new designs add about 20 notices** that aren't in any list. | They follow one set of rules below. |
| 5 | **The "Invitations" tab in My work holds more than invitations.** It also has requests and applications. | The name is misleading. |

**Already working:** channels and `#general`, Browse workspaces, cards shared in `#general`, the tray, push, 14 email templates, one-click email mute, the daily digest, the per-organization choices in Settings, and To review in My work.

### 30.3 Messages (gap 2)

The older concept's section 25 stays, and these rules apply:

| Person | Sees |
|---|---|
| Owner, Admin | `#general`, channels, Workspaces with **Browse workspaces**, DMs |
| Member | `#general`, channels, their own workspaces, DMs |
| Viewer | Not in `#general`; only channels an admin adds them to |
| Outside person | Only that workspace's channels |

| Moment | What happens |
|---|---|
| Joining | Added to `#general`, with the default notify level from Settings |
| Joining a workspace | Added to its channel, with no push |
| Leaving or removed | Removed from everything at once (4.7) |
| Organization admin opens a workspace channel | Mentions only; a system line says "Ms. Rao joined"; details say "Organization admins can open this channel" |
| Workspace detached | Channels move with it, and organization admins lose access |
| Workspace moved in | Its channels move under Workspaces |
| Archived | Readable, with no posting |
| Suspended | Readable, with no posting |
| Scheduled for deletion | Removed for members |
| Limit | 200 channels; `#general` doesn't count |

| Part | Design |
|---|---|
| `#general` | Can't be left. Only admins post, if that's turned on in Settings; threads stay open. |
| Share in `#general` | A live card. An assignment card shows each person their own status. |
| Group assignments | No channel; their conversation is on the copy (23.5) |
| DMs | Members of the same organization can message, subject to each person's privacy setting. Blocks always win. |
| Phones and the floating window | One organization row, with workspaces inside it, as today |

### 30.4 Notifications (gap 3)

**The rules:**

| Rule | Design |
|---|---|
| Wording | Uses the organization's role names, its name, and "CSE 3B / Team Falcon" for workspaces |
| Link | Always the exact place: the copy, roster row, request, post or document |
| Grouping | Bursts combine: "5 new submissions for Lab 1" |
| Needs your attention | A to-do list from current state; it clears itself and isn't dismissed by hand |
| Email | Only when someone must act or would miss something important |
| Privacy | Never names someone else's status, or reveals a block |

**Two new event types,** so each can be turned off on its own:

| New type | Covers |
|---|---|
| `assignments.reminded` | Every Remind |
| `org.team_changed` | Being moved between teams or groups |

"Joins and leaves" stays one setting, because it's already named clearly.

**Notices from the new designs (39.3 adds the later ones):**

| Trigger | Who | Tray text | Important | Attention | Push |
|---|---|---|---|---|---|
| Reminder | Person | "Reminder: Lab 1 is due Fri" | Yes | Already there | Yes |
| New class question | Admins | "Asha asked about Lab 1" | No | No | No |
| Reply to a question | Asker, thread | "Ms. Rao answered your question" | Yes | No | Yes |
| Tell everyone | Everyone on it | "New answer on Lab 1" | Yes | No | Yes |
| Instructions changed, Tell everyone | Everyone on it | "Lab 1 instructions changed" | Yes | No | Yes |
| Approved work returned | Person or group | "Lab 1 was returned: add tests" | Yes | Yes | Yes |
| Assignment reopened | People not done | "Lab 1 is open again" | Yes | Yes | Yes |
| Late joiner on a group assignment | Admins | "Asha needs a group for Lab 2" | No | Yes | No |
| Moved to a team or group | Person | "You're now in Backend" | Yes | No | No |
| Application accepted | Applicant | "You're in Frontend" | Yes | No | Yes |
| Application declined | Applicant | "Your application was declined" | Yes | No | No |
| Ask to change team | Org admins | "Asha asks to change team" | Yes | Yes | No |
| Team has no lead | Workspace lead | "Frontend has no team lead" | No | No | No |
| Move-in or leave decided | Lead | "Team Falcon is now part of CSE 3B" | Yes | No | Yes |
| Term ending | Admins | "Term ends 15 Dec" | Yes | Yes | No |
| Duplicate ready or failed | Owner | "CSE 3B 2027 is ready" | Yes | No | Yes |
| Badge removed | Owner | "CSE 3B's ✓ was removed" | Yes | No | No |
| Unarchived | Members | "CSE 3B is open again" | Yes | No | No |
| New report | Admins | Combined: "2 reports to review" | No | Yes | No |
| GitHub push blocked | Workspace lead | "This repository is now public" | Yes | Yes | No |

### 30.5 Emails (gap 4)

**No new email types are needed.** The 14 existing ones cover this:

| Email | Change |
|---|---|
| Invite (both kinds) | Role name from the organization; an expired or wrong-address link follows 26.3; shown as a preview in the invite dialog |
| Welcome | The welcome note, plus the privacy line from 29.4 |
| Assignment, due soon, overdue, returned | Say "Group" where relevant; link to the copy |
| Announcement | Stops at the daily limit, and the author is told |
| Removed | Reason only if written; never mentions a block |
| Ended, ownership, deleted | As today; always sent |
| All | "Viewer" replaces "Guest"; one-click mute for that organization |

**Announcement limit:** the composer follows 28.3, and the count moves to the organization's calendar day, replacing the rolling 24 hours.

### 30.6 Admin emails and digest (gap 5)

| Part | Design |
|---|---|
| Daily summary | 8:00 in the organization's time zone; one per organization; skipped when empty |
| Order | To review, join requests, move-in and leave requests, reports, sprints to complete, term end, full |
| Each row | A count and a link; never student content |
| Reports | Excludes urgent cases and cases about that admin |
| Instant | No summary, only the tray |
| Personal choice | Email off for that organization also stops the summary |
| Subject | "CSE 3B today: 18 submissions, 2 join requests" |

### 30.7 My work (gap 6)

Two tabs: **Tasks** and **Requests** (renamed from Invitations).

**Tasks:**

| Part | Design |
|---|---|
| Rows | Context chip, "From Ms. Rao", due, Late or Missing, group name |
| Opening a copy | The same task panel, with Submit |
| Filters | Due soon, Missing, To review; All, Personal or each organization; **Submitted** is new |
| Submitted | Your handed-in work, with status and **Download** |
| Main assignments | Never shown to members |
| Excused | Hidden |
| To review | Opens the review queue (23.2) |
| Viewers | No assignment rows |

**Requests:**

| Part | Design |
|---|---|
| Organization invitations | Role, title, Accept, Decline |
| Join requests you run | First 5 with Approve and Decline, then Review all |
| Workspace invitations, applications | As today, with the team name |
| Your own requests | Waiting status, with Cancel |

**During an organization's deletion:** a line says "CSE 3B is being deleted. Download your submissions by 2 Dec." Submitted lists them, even though the organization can't be opened.

### 30.8 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The two new event types, because they stop people losing reminders |
| Updates step | The email counter and the at-limit message |
| Tasks step | New notices for assignments, and My work's Submitted |
| Members and Workspaces steps | Their notices |
| Later steps | The rest of the notices arrive with their features |

### 30.9 Calls made

- **No new email types.** Important new events use the tray and push, and existing emails carry the rest.
- **Private by default in My work.** Your submissions appear only for you.
- **New class questions don't push admins.** They use the digest and tray, so a busy class doesn't flood them.

### 30.10 Left out on purpose

- **Team channels:** older decision 107 says later.
- **Per-student notification overrides by admins:** each person controls their own.
- **A combined digest across organizations:** one per organization is clearer.

## 31. Connected places

Designed on 2 November 2026 from `sitemap.ts`, `sharing/read.ts`, `discover.ts`, `WorkspaceCard.tsx`, `WorkspacesGridCard.tsx`, `org-profile.ts`, `OrgMembersTab.tsx`, `SidebarWorkspaces.tsx` and the older concept (§24, §30.6). Approved by the owner. This closes gaps 20 and 60–64. Findings come from reading the code; nothing was run.

### 31.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **An organization's ✓ doesn't appear on any public screen checked.** The verified value is read (`detail.ts:148`), but only Settings uses it. No ✓ was found on the header or cards. | Getting verified changes almost nothing that people see. |
| 2 | **Search engines can list brand-new organizations.** Discover waits for 3 members and 7 days, or a badge (`discover.ts:334`). The sitemap (`sitemap.ts:34`) and page indexing (`sharing/read.ts`) don't use that rule. | A spam organization stays off Discover but can still reach Google on day one. |
| 3 | **The profile shows organizations twice.** The Workspaces section has an Organizations group (`WorkspacesGridCard.tsx:85`), and 4.5 adds its own Organizations section. | They need one place. |
| 4 | **Discover can't filter organizations by type.** Show has "Organizations", but the Type filter only lists workspace types. | Nobody can look for just clubs or research groups. |
| 5 | **Members can't see who's verified.** There's Verify and Revoke, but no status on the row or filter. | At term end, a teacher can't tell who's left to verify. |
| 6 | **Revoking keeps the entry, with no public sign.** The person sees the reason, and everyone else simply sees no ✓. | This is the right behavior, and it's recorded as the rule. |

**Already working:** the sitemap's other exclusions, share previews that respect privacy, sidebar rows and order, Show all, Requested, outside and Archived rows, the shared organization chip on person cards, and Network's organization invitations.

### 31.2 Public pages (gap 20)

**Who gets what when opening an organization's link:**

| Organization | Signed-out person | Share preview | Search engines |
|---|---|---|---|
| Public, on Discover | About, plus any tabs set public | Logo, name, type, tagline | Listed |
| **Public, too new for Discover** | Same page | Same preview | **Not listed until it qualifies** |
| Private | Private page (26.9) | "Private organization", with no details | Not listed |
| Hidden from Discover | Same page | Same preview | Not listed |
| Archived | About, with `Archived` | Same, with "Archived" | Listed, but not in the Discover feed |
| Suspended, deleting or restricted | "This organization isn't available." | Generic | Not listed |

**The signed-out page:**

| Part | Design |
|---|---|
| Lands on | About |
| Tabs | Per the table in 34.2 |
| Header | Logo, name, type, ✓, Part of, member count |
| Button | Join or Request to join, which opens sign-in and returns to joining |
| Page titles | "About · CSE 3B · NetworkBase" |
| Child workspace | Public ones have their own page; Organization only shows the "not available" page |

**One rule for all three:** Discover, the sitemap and page indexing all use the same check, so they can't disagree.

### 31.3 Profile's Workspaces section (gap 60)

| Part | Design |
|---|---|
| Contents | **Workspaces only.** The Organizations group goes; organizations live in the section from 4.5. |
| Card | The same workspace card, with a `CSE 3B` chip for child workspaces |
| Order | Pinned, then most recent |
| Others see | Public workspaces only |
| Organization members see | Also Organization only workspaces in that organization |
| You see | Everything you're in, with Private marked |
| Archived | Shows `Archived` |
| Empty | Others: no section. You: "No workspaces yet," with Create. |
| Left or removed | Follows 4.3 |

### 31.4 Verifying members (gap 61)

**On the Members tab:**

| Part | Design |
|---|---|
| Row | A small `✓` when verified |
| New filter | Verified, Not verified |
| Bulk | Select, then **Verify 12**; shows "Verify covers role and dates, not what they wrote" |
| Term-end prompt | Opens this filter (27.5) |
| Member panel | Status, who verified and when; Verify or Revoke |

**What each state looks like:**

| State | Others see | The person sees | Admins see |
|---|---|---|---|
| Not verified | No ✓ | "Not verified yet" | Verify |
| Verified | ✓ Verified by CSE 3B | Same | Who and when; Revoke |
| Person edits their words | ✓ stays, because it covers role and dates | Same | Same |
| Role changes | ✓ stays, for the old role in history | Same | Verify the new role |
| Revoked | No ✓ | Private note with the reason | Who, when and why |
| Left by choice | ✓ stays, with `Left` | Same | Read only |
| Removed | Nothing (4.3) | Private note | History |
| Organization deleted | ✓ becomes the plain name; "Organization no longer on NetworkBase" | Same | Gone |

**People who've left** can't be verified afterwards, so the Leave dialog and term-end prompt come first. This matches how the code works today.

### 31.5 Sidebar (gap 62)

| Row | Design |
|---|---|
| Organization | Logo, name, plus, count or dot, drop-down (already live) |
| More than 8 | Show all; order is most recently opened |
| Child workspaces | Your own, with the same icon as other workspaces; "N more" if there are many |
| All workspaces | Only when there's more to see (17.9) |
| Plus | Sends the handle, fixing the "not a member" bug (`SidebarWorkspaces.tsx:51`) |
| Requested | Greyed; opens the page with "Request sent" and Cancel (26.9) |
| Outside | "CSE 3B / Team Falcon"; only that workspace |
| Archived | Under a collapsed Archived group |
| Suspended | Stays, with no badge; the page explains |
| Scheduled for deletion | Owner only, marked "Deleting" |
| Collapsed sidebar | Logos with a count dot |
| Join with code | Always at the bottom |
| Loading | A placeholder, never "No workspaces yet" before data arrives (parity bug 10) |

### 31.6 Discover (gap 63)

**The organization card:**

| Part | Design |
|---|---|
| Top | Logo, name, ✓, type chip |
| Under the name | Part of |
| Body | Tagline, or the start of About |
| Bottom | Member photos, member count, workspace count |
| Button | View; Join only inside the page, so the card stays simple |
| Your own | "You're a member" replaces the count |

| Filter | Design |
|---|---|
| Show | All, Workspaces, Organizations, Updates (today's) |
| **Organization type** | **New:** appears when Show is Organizations, using the 6 types |
| Verified only | **New:** a switch, when Show is Organizations |
| Empty | "No organizations match," with Clear filters |

**Who appears:** public, not hidden, and 3+ members and 7+ days, or verified. Archived organizations don't appear in the feed. Members-only posts never reach Discover.

### 31.7 Network and person cards (gap 64)

| Part | Design |
|---|---|
| Shared chip | Shows `CSE 3B` only if you're both in it **and** they show it on their profile |
| Several shared | The first, then "+2" |
| Removed or left | The chip goes at once (4.7) |
| Blocked | No card, as today |
| Viewers | Count like anyone else for the chip |
| Invitations tab | Organization invitations first, then workspace invitations and applications, labelled with the organization |
| Join requests | A link only: "2 join requests in CSE 3B" |
| Connecting | Not needed to DM inside an organization (30.3) |
| Suggestions from organizations | Left for later, as older decision 3 says |

### 31.8 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The plus button (already listed), and the rule that stops new organizations being indexed |
| Overview step | The ✓ on the header |
| Members step | Verified status and filter |
| Discover (new, small step) | The card, filters and ✓ |
| Step 2 (Profile) | The Workspaces section change |
| Alongside step 1's fixes | The remaining sidebar rows |

### 31.9 Calls made

- **Same rule for Discover and search engines.** It's simpler, and it closes the spam gap.
- **✓ stays when someone leaves by choice.** They did the work, and older concept 24.5 says so.
- **No Join button on cards.** It keeps Discover from becoming a one-click way to join strangers' organizations.

### 31.10 Left out on purpose

- **Sorting Discover by size:** not needed now.
- **Verifying people after they've left:** the term-end prompt comes first.
- **Organization suggestions in Network:** already decided as later.

## 32. Everyday experience

Designed on 2 November 2026. These rules apply to every screen already designed. Approved by the owner. This closes gaps 7, 12–15, 67 and 68. Findings come from reading the code; nothing was run, and only part of the search code was read, so the build checks its privacy rows.

### 32.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Some notices can show the wrong day.** "Due date moved to Mon" and reminders format the date on the server with no time zone (`assignments.ts:176`, `:523`). | With a server on UTC, something due at 1 AM Friday in India would say Thursday. |
| 2 | **Due times are entered in the creator's browser time** (`AssignmentsPanel.tsx:168`). The form doesn't say which zone, and the organization's zone isn't used. | A teacher travelling could set the wrong time for the whole class. |
| 3 | **Keyboard focus outlines are removed globally** (`globals.css:368`). Any control without its own focus ring shows nothing. | Keyboard users can lose their place, especially on the plain selects and links in the organization screens. |
| 4 | **About 10 browser pop-ups remain** in organization screens: `window.prompt` and `window.confirm`. | They're inconsistent, awkward on phones, and can't be styled. |
| 5 | **Only the board updates live.** The roster, review queue, Members and Overview don't update when others act. | Two admins can act on stale screens. |
| 6 | **No phone-size browser tests for organization screens** were found by name. An `axe` accessibility helper exists (`tests/browser/axe.ts`). | Phones and accessibility could regress unnoticed. |

**Already working:** organization search with permission filters, the connection status indicator, a tab error boundary, drag by keyboard with announcements, press-and-hold drag on phones, and live events that carry only an ID, so they can't leak content. Dark mode tokens are used throughout, and no hard-coded colors were found in organization screens.

### 32.2 Search and ⌘K (gap 7)

| Scope | Results |
|---|---|
| Inside an organization | "Search CSE 3B" first: documents, assignments, workspaces, files, sprints, then people for admins. Global results follow. |
| Inside a child workspace | "Search this workspace", plus "From CSE 3B" items; not for outside people |
| Global | Organizations you're in, your workspaces, then public ones |

| Person | Sees |
|---|---|
| Member | Their own copy: `Lab 2 · due Fri · Submitted` |
| Admin | The assignment, with counts |
| Viewer | Only what they can read, with no assignments |
| Visitor | Public organizations and public content only |

**Never in results:** private organizations for non-members, not even names; Admins-only file names; other people's copies; members' lists for non-admins.

**Quick actions:** Join with code, New task in CSE 3B, New workspace in CSE 3B, shown only when allowed.

**Empty:** "Nothing found in CSE 3B," with Search everywhere.

### 32.3 Accessibility (gap 12)

| Area | Rule |
|---|---|
| Focus | **One visible focus ring everywhere**, using a token; the global removal goes |
| Keyboard | Every action works by keyboard; panels and dialogs trap focus and return it on close |
| Drag | Every drag has a `Move to…` alternative |
| Screen readers | Icons have labels; live changes are announced politely: "6 to review" |
| Status | Never by color alone: chips always have words |
| Contrast | Meets WCAG AA in both themes |
| Dialogs | **All browser pop-ups replaced by the shared dialog** |
| Forms | Each field has a label; errors are linked to their field |
| Touch | 44px targets, using the existing class |
| Motion | Respects reduced motion |
| Tests | The existing `axe` helper runs on each organization tab, as owner and member |

### 32.4 Live updates (gap 13)

**The rule:** other people's actions appear on their own, without ever interrupting what you're typing.

| Place | Updates live |
|---|---|
| Board | Yes, as today |
| Roster counts, review queue | **New** |
| Overview's Needs your attention, This sprint | **New** |
| Sidebar count, tab badges | **New** |
| Members requests | **New** |
| Updates | "3 new posts" button, as workspaces have; doesn't jump the page |
| Files, Documents | On next open, or a small "Updated" line |
| Settings | Not live; checked on Save |

**How it works:** the existing event carries only an ID, and each screen reloads its own data, combined over about 2 seconds so a class submitting together doesn't flood anyone. Only the tab you can see reloads.

**Two admins at once:**

| Case | What happens |
|---|---|
| Both approve | Second sees "Already reviewed by Priya" (23.2) |
| Both edit an assignment or setting | Second sees "Priya changed this a moment ago," with their text kept and Reload |
| Both handle a join request | Second sees "Already approved" |
| Someone changes your role | The page updates at next action; a tray notice explains |

### 32.5 Time zones (gap 14)

| Item | Rule |
|---|---|
| **Entering a due date** | **In the organization's time zone, and the form says so:** "11:59 PM, India time" |
| No organization zone | The creator's browser zone, and the form names it |
| **Showing it** | In your own time. If that differs from the organization's, a second line: "Fri 11:59 PM your time · Sat 9:29 AM in CSE 3B" |
| Notices and emails | **Always formatted in the person's zone**, fixing finding 1 |
| Reminders | 9:00 in your zone, as today |
| Admin summary | 8:00 in the organization's zone, as today |
| "Next 7 days", term dates | Calendar days in the organization's zone |
| Late or not | Compared on the exact moment, so zones can't change it |
| Sprints | Dates are whole days in the organization's zone |
| Daylight saving | Handled by the zone rules, with no special cases |

### 32.6 Failure states (gap 15)

| Case | What happens |
|---|---|
| Any save fails | **Your text stays.** An inline message with Try again. |
| Offline | The existing indicator; buttons that need the network explain on click |
| Upload fails | The file stays listed, with Try again |
| Submit fails | "Couldn't submit. Your work is still here," with Try again; no proof line until it succeeds |
| Due date passes while working | "The due date just passed. This will count as late," if allowed |
| Closed while working | "Lab 1 was closed," and their files stay on their copy |
| **Permission lost** | "You no longer have access to this," with Refresh |
| Removed from the organization | The next action or page shows 26.9's page |
| Role lowered | Admin buttons go at next action; the server already refuses |
| Organization archived or suspended | The notice appears, and actions explain why |
| Session expired | Sign in, then back to the same page; unsent text is kept where the app already keeps drafts |
| Too many tries | "Too many attempts. Wait a minute and try again." |
| A tab crashes | The existing boundary: "Couldn't load this tab," with Try again; other tabs keep working |
| A section fails | Only that section shows the error, not the whole page |
| Background job fails | The notice says what failed and what to do (27.4) |

**Wording:** say what happened and what to do, with no error codes, and never blame the person.

### 32.7 Phones (gap 67)

| Screen | Design |
|---|---|
| Header | Logo, name, one primary button, the rest in `⋯` |
| Tabs | Scrollable row, as today; selected tab stays in view |
| Overview, About | Stack; Needs your attention first |
| Tasks | Board scrolls by column; snaps to each; column dots show position; a card's `⋯` has Move to |
| New task form | Full-height sheet; Hand-in collapsed until needed |
| Task panel | Full screen; Submit fixed at the bottom |
| Roster | Rows, not a table; tick mode from a long press or Select; Approve and Return fixed at the bottom |
| Review queue | Full screen; swipe isn't used, to avoid accidental decisions |
| Sprints | List, then the sprint as its own screen |
| Updates | Composer opens as a sheet; options inside |
| Documents, Files | As a workspace: list, then file; `⋯` for actions |
| Members | Requests first; bulk from Select |
| Settings | Dropdown menu; tables become rows, with the permissions table scrolling sideways on its own |
| Dialogs | Become bottom sheets |
| Width | Nothing scrolls the page sideways at 375px |

**Tests:** new browser checks at phone width for the board, roster and composer, including the sideways-scroll check.

### 32.8 Dark mode (gap 68)

| Rule | Design |
|---|---|
| Colors | Tokens only, as today; no hard-coded colors in new blocks |
| Chips, status | Same words, checked for contrast in both themes |
| Storage bar, progress | Token colors; amber and red stay distinct |
| Images and logos | A subtle border so dark logos don't vanish |
| Emails | Keep their own theme |
| Tests | Screenshots of each new block in both themes during review |

### 32.9 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The wrong-day fix in notices and the global focus ring |
| Tasks step | Due date entry and display, live roster and queue, and the board on phones |
| Each tab step | Its own failure states, phone layout, dark check and `axe` test |
| Overview and Members steps | Their live updates |
| Step 14 (final pass) | Search's privacy rows, and a full review of phones, dark mode and accessibility |

### 32.10 Calls made

- **Due dates entered in the organization's zone.** A class needs one shared deadline, whichever device the teacher uses.
- **No swipe to approve.** Too easy to trigger by accident on someone's grade.
- **Live means reloading, not merging.** The existing events make this simple, and it can't leak content.
- **AA contrast as the target.** It's the common standard, and AAA would limit the design too much.

### 32.11 Left out on purpose

- **Working fully offline:** the app needs the server for permissions.
- **Live cursors or typing indicators in forms:** not needed.
- **A separate mobile app design:** this covers the web on phones.

## 33. The day-to-day lifecycle

Designed on 2 November 2026 from `needs-you.ts`, `org-dashboard.ts`, `dashboard-rules.ts`, `org-digests.ts`, `sprint-schedule.ts` and this report's Overview design. Approved by the owner. Findings come from reading the code; nothing was run. "Not found" means a search found nothing.

**The main idea:** an organization has a rhythm: a term, sprints within it, weeks within those, and days within those. Each screen knows where you are in that rhythm and shows what matters now, so nobody has to go looking.

### 33.1 What's missing today

| # | Gap | What happens today |
|---|---|---|
| 1 | **Nobody is told who's falling behind** | Needs your attention lists submissions and requests, but not people missing work (`needs-you.ts`). Teachers have to open Members. |
| 2 | **Nothing warns that a sprint is ending** | Only the daily email says it (`org-digests.ts:142`). Overview shows a sprint only after it has ended. |
| 3 | **Work can't be reused** | No copy or repeat for assignments was found. A weekly report means filling in the form every week. |
| 4 | **No overall class picture** | Overview shows counts per assignment, but nothing like "34 of 40 on track". |
| 5 | **No way to mark someone away** | Excuse works one assignment at a time. A student who's ill for two weeks needs each one done by hand. |
| 6 | **No record to take away** | No progress export was found. At term end, a teacher can't get a sheet of who did what. |
| 7 | **No calendar** | No calendar view or calendar feed was found, though everything has a date. |
| 8 | **Nothing tells members what's ahead** | They get reminders one item at a time, with no view of the week. |
| 9 | **Late joiners can't catch up** | They get open work, but nothing says what they missed. |
| 10 | **Reviewers aren't shared out** | Two TAs see one queue, with no way to divide it. |

### 33.2 The lifecycle

| Stage | When | What it's for | What Overview leads with |
|---|---|---|---|
| **1. Prepare** | Before people join | Set up sprints, documents, files | Get started |
| **2. Open** | People joining | Get everyone in and placed | Who's joined, who's not placed |
| **3. Run** | Most of the time | Do the work | Today, and who needs help |
| **4. Crunch** | Big deadlines | Keep up with the volume | Today's deadline and review progress |
| **5. Close** | Last 14 days | Finish, verify and wrap up | The close-out list |
| **6. Ended** | Archived | Keep the record | The term summary |
| **7. Next** | Next term | Start again | Duplicate |

**Stages aren't something anyone sets.** They come from what's already there, and stage 4 isn't a mode: it's just Run with more deadlines showing. Organizations with no term, like a company or club, simply stay in Run and move sprint to sprint.

### 33.3 A day, by person

#### Teacher or manager

**Morning, on Overview:**

```
Good morning, Ms. Rao                         Tue 10 Nov · Week 6 of 16

TODAY
Lab 3 due tonight          28 of 40 in      Remind 12
6 submissions to review    oldest 2 days    Review
CO3 ends Thursday          4 people behind  See who

HOW THE CLASS IS DOING
34 on track · 4 behind · 2 inactive         See all →

THIS SPRINT ...   THIS WEEK ...   ACTIVITY ...
```

| Moment | They do | How |
|---|---|---|
| Morning | See what needs them | Overview's **Today** |
| Between classes | Clear reviews | Review queue on a phone: Approve or Return |
| When something changes | Post an announcement | Composer, with Seen count after |
| Deadline passes | Chase missing work | Roster, Remind |
| Weekly | Plan next week | Sprints, then reuse last week's assignment |

#### TA or admin

Same as the teacher, plus **My reviews** if reviewers are shared out. They never touch ownership or admins.

#### Student or member

```
Good morning, Asha                            Tue 10 Nov · Week 6 of 16

TODAY
Lab 3 due tonight, 11:59 PM     In progress   Open
Grading policy to read                        Read

THIS WEEK
Thu  CO3 ends
Fri  Quiz 2 · not started
```

| Moment | They do | How |
|---|---|---|
| Open the app | See what's due | **Today** and **This week** |
| Working | Hand in | Task panel, Submit, proof with the time |
| Stuck | Ask | Class questions or a private message |
| Returned | Fix it | Top of Today, with the reason |
| On the go | Check due dates | My work on a phone |

They never see class numbers or other people's status.

#### Workspace lead

They see the organization's Today, plus **their workspace's**: group work due, "CO3 started: plan your sprint", open seats, and "Reviewed by CSE 3B".

#### Viewer

No Today, just the About-style summary and what they can read.

### 33.4 A week, and a sprint

| When | What happens by itself | Who's told |
|---|---|---|
| **Monday morning** | Sprint starts if due | Members, with what's in it |
| **Monday** | New: **This week** updates | Everyone, on Overview |
| **Day before a due date** | Reminder at 9:00 | People not done |
| **Due day** | Reminder, and Today shows the count | People not done; admins see it |
| **After due** | Missing and Late marked | Person, and the admin's behind count |
| **Sprint ends in 2 days** | **New:** row "CO3 ends Thursday · 4 behind" | Admins |
| **Sprint ended** | "Complete CO3?" By hand, unless the next sprint takes over (42.6). | Admins |
| **On completing** | **New:** short summary: done, missing, unfinished work moved | Admins, and members get "you completed 3 of 3" |
| **Next sprint** | Next one starts; workspace leads get "plan your sprint" | Leads |

### 33.5 New features for the rhythm

Each uses existing data, except where noted.

| Feature | Design | Fixes |
|---|---|---|
| **Today** | Top of Overview, by person; replaces most of Needs your attention's job. At most 5 rows, most urgent first. | 1, 2, 8 |
| **This week** | Next 7 days as a short list; replaces Coming up, with the same data | 8 |
| **How the class is doing** | Admins only: on track, behind, inactive. Each opens Members filtered. Uses the type's word: class, team, lab, group (34.2). | 1, 4 |
| **Week line** | "Week 6 of 16" from the term; hidden without a term | Rhythm |
| **Use again** | Assignment `⋯` → Use again: opens the form filled in, with new dates. | 3 |
| **Repeat assignment** | In the form: "Repeat weekly until…", making one draft per week, reviewable before publishing. | 3 |
| **Away** | Member panel → Mark away: dates and optional reason. Copies due in that time are excused automatically; they're told; new ones skip them. Needs one small table. | 5 |
| **Catch up** | Late joiners see "You joined in week 6. Here's what you missed": earlier sprints and materials, with no copies. | 9 |
| **Export progress** | Roster and Members → Export CSV: person, each assignment's status, dates, late mark. No submission content. Admins only. | 6 |
| **Calendar** | A view on Sprints showing sprints and due dates, per person; plus a private calendar link for Google or Apple. | 7 |
| **Reviewers** | Optional field on an assignment: who reviews. Queue gets **Mine** and **All**. Unassigned goes to everyone. | 10 |
| **Term summary** | On archive: sprints, assignments, completion; members see their own: "12 of 12 done" | Close |

### 33.6 How it looks at each stage

| Stage | Top of Overview for admins | For members |
|---|---|---|
| **Prepare** | Get started cards (7.2), and a "Ready to open?" check: sprints, materials, welcome note | Nobody's here yet |
| **Open** | "12 joined · 3 requests · 8 not in a workspace", with Invite | Welcome panel, then Today |
| **Run** | Today, then How the class is doing | Today, then This week |
| **Crunch** | Same, with deadline rows on top and review progress: "28 of 40 reviewed" | Same; Today shows the deadline |
| **Close** | **Close-out list:** review open work (6), verify members (40), remind about contributions, then Archive or Duplicate | "Term ends 15 Dec · Write up your contribution" |
| **Ended** | Term summary, verify if any left, Duplicate | Their own record, and their submissions |
| **Quiet** | "Nothing needs you today," one line, then This week | "You're all caught up" |

### 33.7 Every scenario

| Scenario | What happens |
|---|---|
| Teacher away for a week | The TA does everything except ownership; nothing is tied to one person |
| Student ill for two weeks | Mark away; they're excused automatically and catch up on return |
| Holiday moves the schedule | Edit a sprint with Move later sprints and Move due dates (28.2) |
| Exam week | Pause sprints by leaving a gap; Today stays calm |
| Deadline extended for everyone | Edit for everyone; people who move are told (23.3) |
| Whole class misses a deadline | Roster shows it; Extend for all, or Remind 40 |
| Nobody reviews for a week | Row turns amber: "12 waiting, oldest 7 days" |
| Student never opened anything | Shows under Inactive, counted from joining (28.7) |
| Workspace goes silent | Row in Workspaces: "Quiet 7 days" |
| Team lead quits | "Team Osprey needs a new owner" in Today |
| Two sections in one class | Use titles or Selected people; a Sections feature is left out |
| Student transfers classes | Removed from one, joined to another; their work stays with the first |
| Company with no term | No week line or term end; sprints are the rhythm |
| Club meeting monthly | Quiet Today most days; This week fills up near events |
| Large class, 500 submissions | Grouped rows, the queue, and combined live updates |
| Owner disappears mid-term | Admins keep running it, and after 30 days one can Ask to take over (45.2). Succession only runs when an account is deleted or banned. |
| Term ends with nothing archived | The prompt stays; nothing happens by itself |
| Teacher wants a final record | Export progress, then Archive |

### 33.8 How this gets built

These go in with the matching tabs, not as a separate project.

| Priority | Features | Why |
|---|---|---|
| **Essential** | Today, This week, How the class is doing, sprint-ending row, sprint summary | They make Overview answer "what needs me today?" |
| **High** | Use again, Export progress, Close-out list, Term summary | Teachers would feel these every week and every term |
| **Medium** | Away, Catch up, Reviewers | Real, but less frequent |
| **Later** | Repeat assignment, Calendar | Valuable, but bigger, and Use again covers most of repeat |

### 33.9 Calls made

- **No stage switch.** Stages come from the data, so nobody manages them.
- **Today replaces the job of Needs your attention.** Two lists would compete. Its row design from 7.2 stays, and Today adds deadlines to it.
- **Coming up is renamed This week.** It's the same data, with a clearer promise.
- **CSV has no submission content.** Only statuses and dates, so it can't leak work.

### 33.10 Left out on purpose

- **Grades and marks:** older decision 4 says later, and Approve or Return covers review for now.
- **Attendance:** a different product.
- **Class sections as a feature:** titles and groups cover it for now.
- **Automatic archiving:** already ruled out in 27.

## 34. Second audit and core work flows

Audited and designed on 2 November 2026. Sections 1–20 were re-read line by line, sections 21–33 were checked against what was written in the same session, and every organization component and server action was compared with this report. Nothing was run. Approved by the owner.

### 34.1 What the second audit found

The report wasn't yet fully end to end. This list tracks what's left. Items are closed as each batch is designed.

| Batch | Work | Items | Status |
|---|---|---|---|
| 1 | Conflicts | Below | **Settled (34.2)** |
| 2 | Core work flows: Submit, task form, roster actions, member tasks, team tasks | 1, 6, 7, 14, 15 | **Designed (34.3–34.7)** |
| 3 | Workspaces in an organization: creation, life, no lead, tab actions | 2, 3, 4, 20 | **Designed (35)** |
| 4 | People: role changes, outside people, former members, Remove dialog, leaving mid-work | 5, 8, 10, 21, 39 | **Designed (36)** |
| 5 | Remaining tab detail: sprint actions, post card, document publishing, Files pages, tab bar, sharing, followers | 9, 11, 16, 17, 18, 19, 23 | **Designed (37)** |
| 6 | Profile: Edit contribution in full | 22 | **Designed (38)** |
| 7 | Rules: permissions for newer actions, section 33's notices, glossary and plurals of custom role names | 36, 37, 38 | **Designed (39)** |
| 8 | Visual design: real mockups of the key screens | 13 | **Designed (40)** |
| 9 | Launch plan: effect on normal workspaces, one list of database changes, rollout, measures, monitoring, splitting step 1 | 12, 40–44 | **Designed (41)** |

### 34.2 The conflicts settled

| # | Conflict | Settled as |
|---|---|---|
| 24 | Do members have Settings? | Yes: My membership, What's allowed, Privacy, Leave (22.3). Section 3 changed. |
| 25 | "Mark as read" or opening? | Opening counts. The button is removed everywhere. |
| 26 | Blocked wording | "You can't join this organization." everywhere |
| 27 | Old Overview sections | 7.2 and 16.6 now point to Today and This week |
| 28 | Status words | **Assignments:** Not started, In progress, Submitted, Returned, Completed, Missing, Excused, plus a Late mark. **Sprints:** Upcoming, Active, Completed, Archived, Cancelled, as already agreed (corrected in 39.1). **Board column:** Completed. |
| 29 | Can members open the roster? | No. They see photos and a count, not a link. Members stays admin only. |
| 30 | Visitor tabs | The table below |
| 31 | Storage By workspace | Settled: a read-only Teams list (19.2) |
| 32 | New-joiner copies | Confirmed: the code does this |
| 33 | "Contact support to raise this" | Stays, with one honest limit: raising is a platform change for now. A per-organization override waits for the first real request. |
| 34 | "How the class is doing" | Uses the type: class, team, lab, group |
| 35 | Stale verdict and build table | Updated in batch 9 |

**Visitor tabs on a public organization:**

| Tab | Visitor sees it when | Shows |
|---|---|---|
| About | Always | Everything public |
| Documents | Tab is on | Documents marked Public, with content |
| Updates | Tab is on | Posts marked Public |
| Files | Tab is on | Only Public folders; the tab hides if none exist |
| Sprints | Tab is on, off by default | The timeline, no work |
| Tasks, Members, Settings, Overview, Workspaces | Never | Public workspaces appear on About |

### 34.3 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Returned work past its due date shows as Missing.** The check for overdue comes before Returned (`copyState`, `assignment-rules.ts`). | A student sees "Missing", and the teacher's reason disappears from the state. |
| 2 | **Approved work can probably be submitted again.** Submit checks closed, excused and late rules, but not "already approved" (`submitAssignmentAction`). | Approved work could go back to waiting. |
| 3 | **Submit isn't in the task panel.** It's a dialog from the Assignments box. For a file, it says to go and attach it elsewhere first. | Two trips for the most common hand-in. |
| 4 | **A note can't go with a file or link.** One value per type. | "I used the second dataset" has nowhere to go. |
| 5 | **Members can probably create tasks on the organization's board,** though the older concept says admins only. A task they don't assign to themselves then **vanishes for them**, because they only see their own (`orgTaskReadFilter`). | Confusing, and against the rules. |
| 6 | **"Give to Asha" doesn't exist.** Decision 17 relies on it. | Late joiners can't be given past-due work. |
| 7 | **Extend asks for typed text:** "YYYY-MM-DD HH:MM" (`AssignmentsPanel.tsx`). | Easy to get wrong. |

### 34.4 Student Submit flow (item 1)

The Submit section sits in the task panel, on the student's copy.

```
Lab 1: Arrays and linked lists            In progress
Due Fri 8 Nov, 11:59 PM · Late work until Sun
Reviewed by Ms. Rao's team

HAND IN
What's asked: a file
[ Drop your file, or Choose ]    report.pdf · 2.1 MB  ×
Add a note (optional)
[ Submit ]
```

**By hand-in type:**

| Type | Field | Rules |
|---|---|---|
| **File** | Drop or choose, **right here**; several allowed | Up to 10 MB each; a file picked from the copy's existing files also works |
| **Link** | URL; in a workspace, also "Pick a document" | Must be a valid link |
| **Text** | Text box | Up to 10,000 characters; autosaved as a draft |
| **Nothing** | Just **Mark as done** | Nothing to attach |
| All | Optional note, up to 500 characters | New, goes with the submission |

**By state:**

| State | Student sees | Can do |
|---|---|---|
| Not started | Instructions, steps, Hand in | Start, Submit |
| In progress | Same, with their files | Submit |
| Submitted | "Submitted 2 Nov, 4:12 PM · Version 1", what they sent, "Waiting for review" | **Replace submission**, until it's reviewed |
| Done, no review | "Done 2 Nov, 4:12 PM" and what they sent | Replace, until the due date |
| Approved | "Approved by Ms. Rao 3 Nov" | Nothing more; read and download |
| Returned | **Top of panel: the reason**, then what they sent | Submit again, as Version 2 |
| Returned, past due | **Still shows Returned with the reason and Fix by date (42.5)**, and a Late mark only if resubmitted after that date | Submit again, until the Fix by date |
| Missing, late allowed | "Overdue. Late work accepted until Sun." | Submit, marked Late |
| Missing, not allowed | "The due date has passed. Ask Ms. Rao if you need more time." | Message |
| Closed | "This assignment is closed." | Read their files |
| Excused | "You're excused: reason" | Nothing required |

**Rules:**

- **Approved work is locked** by the server.
- **Group copies:** anyone can submit: "Submitted by Asha for Group A". Everyone sees the same state and proof.
- **Versions:** each submission is kept. The reviewer sees the latest, with Compare.
- **Steps:** optional; unticked steps never block Submit.
- **Failure:** covered by 32.6: the file and text stay.
- **Workspace group work:** same section on the workspace's card, with "Reviewed by CSE 3B".
- **Board drag:** dragging to Completed opens this section.

### 34.5 The task form, and who can use it (items 14 and 6)

**Who gets New task:**

| Place | Who |
|---|---|
| Organization's board | **Owner and admins only**; the server refuses others |
| Child workspace board | Its team, as a normal workspace |
| Members who want their own task | Their workspace, or a personal workspace |

Members still see tasks an admin assigned to them, and can update status, steps, comments and files.

**Assign to picker:**

```
Assign to
[ Search people or teams…                    ]
EVERYONE
  Everyone           40 Students
  Admins              2
GROUPS
  Groups…            Make groups for this
WORKSPACES
  Each workspace      5
  Selected workspaces…
PEOPLE
  Asha Rao · Student
  Selected people…
```

| Choice | Next | Result |
|---|---|---|
| A person | Nothing more | Normal task; Create task |
| Everyone | Count shown | Publish to 40 people |
| Admins | Count shown | Publish to 2 people |
| Selected people | Searchable list with ticks, Select all, and filters by role, workspace and group | Publish to 12 people |
| Groups | The group builder (25.7) | Publish to 4 groups (10 people) |
| Each workspace | Count shown; none: "Create a workspace first" | Publish to 5 workspaces |
| Selected workspaces | Ticks | Publish to 2 workspaces |

Viewers are never offered.

**Validation, shown beside each field before saving:**

| Field | Rule | Message |
|---|---|---|
| Title | 1–200 characters | "Give it a title." |
| Due date | Required for many; in the organization's zone (32.5) | "Pick a due date and time." |
| Past due date | Warns only | "This date has passed. Publish anyway?" |
| Late until | After the due date | "Must be after the due date." |
| Instructions | Up to 10,000 characters | Live count near the limit |
| Steps | Up to 50 | "Up to 50 steps." |
| Group builder | Every group has someone; each person in one | Names the group or person |

**Drafts:**

| Part | Design |
|---|---|
| Saving | Save as draft keeps everything, including the chosen people |
| Where | On the board with `Draft`, admins only; nobody is told |
| Editing | The same form; all fields free |
| Publishing | Publish to N: rechecks who's in the group, and copies are made then |
| People since changed | "2 people have left, and were removed from this." |
| Deleting | Allowed, after a confirmation |

### 34.6 Roster actions (item 15)

Every browser pop-up becomes a proper dialog.

| Action | Dialog | Rule |
|---|---|---|
| **Extend** (one) | Date and time, in the organization's zone, with shortcuts: +1 day, +3 days, +1 week | They're told. Clears Missing if the new date is ahead. |
| **Extend** (selected) | Same, "Extend for 4 people" | Each is told |
| **Excuse** | Reason, required; they see it | Leaves the counts; their work stays |
| **Un-excuse** | Confirmation | Back in the counts; told |
| **Give to** | **New:** late joiners or anyone without a copy: choose a due date | A copy is made; told |
| **Remind** | 28.8 | |
| **Approve, Return** | 23.2 | |
| **Close** | "12 people haven't submitted. They'll stay Missing." | Reopen later (23.3) |
| **Delete** | Only while nobody has submitted: "Everyone's copy goes." | Otherwise offers Close |
| **Download all** | 28.5 | |

**Roster row, with groups:** the group name, its people with the lead, status, "Submitted by Asha", and a `⋯` on each person with Move, Own copy and Excuse.

**Viewers** see counts only, and never names.

### 34.7 Team tasks in a workspace (item 7)

The separate **Team task** button and dialog (`TeamTaskDialog`) go, and the one task form covers it, as 18.3 wanted.

**Assign to in a workspace:**

| Choice | Result |
|---|---|
| A person | Normal task |
| **A team** | One shared task for that team; its lead is the assignee, with everyone on it |
| **Each team** | One shared task per team with people; empty teams are skipped, and the form says how many |
| **New groups** | Make groups here, as in 25.7, for this task only |

| Rule | Design |
|---|---|
| Who | Workspace lead and workspace admins for many; anyone for a person |
| Card | Team name chip and photos, on every teammate's board |
| Moving | Any teammate |
| No Hand-in | Team tasks are normal work; only the organization assigns hand-ins |
| Team has no lead | The first person becomes the assignee |
| Someone moves team | They stay on existing tasks, and the lead can change that |

### 34.8 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | Returned stays visible past due, approved work locked, the server refusing member-created tasks on the organization's board |
| Tasks step | The Submit section, task form, roster dialogs, Give to, and team tasks in the one form |
| Everywhere | The status words and visitor tab table from 34.2 |

### 34.9 Calls made

- **Members don't create tasks on the organization's board.** This follows the older concept, and stops tasks vanishing.
- **Replace stays open until review.** After approval, the record is final, unless a reviewer returns it (decision 40).
- **Unticked steps never block Submit.** Steps are a help, not a gate.

### 34.10 Left out on purpose

- **Withdrawing a submission:** Replace covers it, and a blank withdrawal could look like Missing.
- **Comments in the Submit section:** the two conversations in 23.5 cover them.

## 35. Workspaces in an organization: creation, life, no lead, tab actions

Designed on 2 November 2026 from `CreateLocation.tsx`, `ChildTeamFields.tsx`, `Phase4Settings.tsx`, `server/lifecycle.ts`, `organizations.ts`, `ChildOrgSection.tsx`, `succession.ts`, `OrgOverviewParts.tsx`, `org-dashboard.ts` and the older concept (§14). Approved by the owner. This is batch 3 of 34.1. Findings come from reading the code; nothing was run.

### 35.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Admins can't assign a new lead.** Transfer works only for the current owner (`transferWorkspaceOwnership`, `account.ts`), and no other way was found. Needs your attention says "needs a new owner", but that only opens the tab. | The row has no action behind it. If a lead's account is deleted, the organization's owner can get stuck holding the workspace. |
| 2 | **Deleting a workspace takes no account of the organization.** No check for handed-in group work was seen in the delete (`deleteWorkspace`, `server/lifecycle.ts:2171`). | A lead could delete work already submitted to the teacher. |
| 3 | **No Unarchive for a workspace** was found in Settings or the organization section. | An archive made by mistake can't be undone from the screen. |
| 4 | **An admin archiving a workspace tells nobody** (`archiveChildAction`). | A team finds its workspace read only with no explanation. |
| 5 | **Remind lead uses "due date changed" too** (`remindLeadsAction`). | Covered by the new event type in 30.4. |
| 6 | **Workspaces rows are text with many filters.** Six dropdowns show by default. | Already flagged in the parity report; designed below. |

**Already working:** the Where picker and its locked chip, added versus invited, default teams, templates, the visibility limit, re-checks at Create, and handing over a workspace when an account is deleted.

### 35.2 Creating a workspace

**Where it starts:**

| Entry | Behavior |
|---|---|
| Workspaces tab → New workspace | Locked chip: "In CSE 3B" |
| Sidebar plus | Same; the "not a member" bug is fixed (31.5) |
| Needs your attention: "Lab 3 needs workspaces" | Same |
| Global New workspace | **Where** picker: Personal, then your organizations; ones you can't use are disabled, with the reason |
| Link for an organization you're not in | Falls back to Personal, with one line saying so |

**The five steps:**

| Step | Field | Rule |
|---|---|---|
| **Start** | Where | As above |
| | Source | Scratch, GitHub, upload, or **From a CSE 3B template** when one exists |
| **Details** | Name | 3–100 characters; a name already used here warns, and doesn't block |
| | Summary, description | Same as a workspace |
| | Category | Defaults to the organization's (17.8) |
| | Tags | Suggested from the organization; skills stay |
| **Team** | Lead | Admins pick from the roster; a member is the lead |
| | Teams | Default teams pre-filled; same team card as 25.3 |
| | Add people | Side sheet: search, filters, and a **Not in a team or workspace** filter |
| | Not in a team | For small teams |
| | Admins from CSE 3B | Read-only rows |
| **Setup** | Visibility | Organization only by default; options the limit blocks show `Set by CSE 3B` |
| | Follow CSE 3B's sprints | From Settings; switch stays available later (18.7) |
| | Members post, upload | Start from the organization's values |
| | Starter document | Organization templates first; empty stays hidden from visitors |
| **Review** | Summary, card preview | "4 added · 3 invited · 1 open seat"; Discover wording fixed (27.2) |

**Added or invited:**

| Creator | Person's chip | After Create |
|---|---|---|
| Owner, Admin | **Will be added** | Member at once, in their team, and told |
| Member | **Will be invited** | Invitation with the team; Accept joins that team; Decline reopens the seat |
| Anyone, outside person | **Will be invited** | Only when Outside people is on |

**On Create:** the workspace opens at its Overview with a short next step: "Plan your sprint" or "Invite your team". Open group assignments arrive, an activity row appears, and admins get a combined notice.

**Checks at Create:**

| Change since opening | What happens |
|---|---|
| Removed from the organization, or now admins only | "You're no longer able to create in CSE 3B," with **Create as personal**, keeping everything |
| Organization archived | Same |
| Limit of 200 reached | Same message as 21.4, with Create as personal |
| Visibility limit tightened | Lowered to the highest allowed, and it says so |
| Outside person no longer allowed | Removed from the list, with the reason |

**Drafts:** a draft remembers where it belongs: "Resume draft · in CSE 3B".

### 35.3 A workspace's life

| Action | Who | What it does | Who's told |
|---|---|---|---|
| **Rename** | Lead, workspace admin | Channel renames too, with a system line | Team |
| **Change visibility** | Lead, workspace admin, organization admin | Within the limit. Going tighter confirms what stops: shared posts, Discover, or a public repository (24.3). | Lead, if an admin did it |
| **Lowered by a limit change** | Automatic, from the confirmation in 22.4 | "Team Falcon is now Organization only because CSE 3B changed its rules" | Lead and admins |
| **Transfer** | Lead | To any team member in the organization; not Viewers or outside people | New lead, and the team |
| **Archive** | Lead, organization admin | Read only; applications close; **shows who archived it** | Team and lead, **now always** |
| **Unarchive** | **New:** whoever could archive it. If an admin archived it, only an admin can. | Everything returns | Team |
| **Leave the organization** | Lead asks, admin decides (28.6) | Private; sprints unlink; unsubmitted group work goes | Lead and team |
| **Delete** | Lead only | See below | Team |

**Delete rule:**

| Workspace holds | Delete does |
|---|---|
| **Work handed in to CSE 3B** | **Refused:** "This workspace has work handed in to CSE 3B. Archive it instead." |
| Open, unsubmitted group work | Warns; those copies go, and the roster shows them as gone |
| Nothing from the organization | Type the name to confirm, as today |

Credit stays on profiles: the entry keeps the name, with no link. An organization admin can't delete it (17.10).

**While archived:**

| Part | Behavior |
|---|---|
| Board, Files, Documents, Updates | Read and download only |
| Channels | Readable, with no posting |
| Open group assignments | Stay open on the roster, and can show Missing; a chip says "Workspace archived" |
| New group assignments | Skip it |
| Team seats | Applications close |
| Members | Stay, read only |
| Sidebar | Under Archived |
| Organization archived | Shows "Archived with CSE 3B"; returns with it |

### 35.4 A workspace with no lead

**When it happens:** the lead's account is deleted, they're banned, or they left in a way the checks couldn't stop. It already hands over automatically to a workspace admin, then a team member, then the organization's owner, and flags it (`succession.ts`).

**Today row:**

```
[UserX]  Team Osprey needs a new lead          Assign
         Rama's account was closed · held by Ms. Rao
```

**Assign dialog:**

| Part | Design |
|---|---|
| Who can open it | Owner and admins |
| List | Team members first, with team and role, then **anyone in CSE 3B** via search |
| Excluded | Viewers, outside people, blocked people |
| Confirm | "Asha will lead Team Osprey. Ms. Rao steps back to admin access." |
| After | New lead told; the flag clears; group work moves to them |
| Nobody suitable | **Archive** is offered |

**Limits on this power:**

| Case | Rule |
|---|---|
| Lead is still here | No Assign. Admins can Message them. Only the lead can transfer, as 17.10 says. |
| Lead is inactive for a long time | Admins message them; this stays manual |
| Held by the owner | Doesn't count against any limit, and shows as "held by" until assigned |

### 35.5 Workspaces tab actions

**Layout, top to bottom:**

| Part | Design |
|---|---|
| **Requests** | **Only when there are some:** move-in and leave rows (28.6), with Approve and Decline |
| Summary | `5 workspaces · 1 needs attention · 1 quiet · 2 people not in one`, each filtering |
| Controls | Search, Status, Sort, Mine, List or Cards, and a **Filters** menu for visibility, stage, lead and sprint |
| List | Rows below |

**Row:**

```
[TF] Team Falcon  [Organization]  [New]         Updated by Asha · 2h
     Asha (lead) · 6 people · Build · CO3
     12 open · 3 overdue · 2 in review
     ⚠ 3 overdue · Lab 3 missing            Remind lead   ⋯
```

**Why a row is flagged (already in the code, `dashboard-rules.ts`):**

| Reason | Rule |
|---|---|
| Overdue | 3 or more overdue tasks |
| Quiet | No activity for 7 days |
| Group work | Missing or returned |
| No lead | Lead left the organization |

**Actions:**

| Action | Dialog | Rule |
|---|---|---|
| **Remind lead** | One click; says what about: "Lab 3 is missing" | Once per 12 hours; reports who was sent and skipped (28.8) |
| **Message lead** | Opens the message | |
| **Assign lead** | 35.4 | Only when flagged |
| **Archive** | "6 people will have read-only access. They'll be told." | Unarchive from the Archived filter |
| **Detach** | Same preview as leaving (28.6), naming what's lost | Lead told |
| **Bulk** | Remind leads, Archive, with a count | Skips those that don't apply, and says how many |

**Other states:**

| State | Shows |
|---|---|
| New here | `New` chip for 7 days after moving in |
| Archived filter | Rows greyed, with who archived it and Unarchive |
| Member's view | Their workspaces first, then others they can see, with `1 open seat` and Apply; no flags or bulk |
| Viewer's view | Read only |
| More than 50 | Show 50 more, as today |

### 35.6 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | Blocking delete when handed-in work exists, and the archive notice |
| Workspaces and Members step | Tab layout, Requests, Assign dialog, Unarchive, row actions |
| Alongside step 1's wording fixes | Wizard changes |

### 35.7 Calls made

- **Deleting is refused when work was handed in.** This matches decision 23 for assignments: Close, not delete, once anyone has submitted.
- **Admins can't replace a lead who's still here.** 17.10 says so, and a teacher who needs this can still ask them, or detach.
- **The person who archived controls Unarchive, with admins above leads.** A team can't undo an admin's decision.
- **Next step after Create is a short line, not a tour.** It's in keeping with Get started's approach.

### 35.8 Left out on purpose

- **Creating workspaces in bulk for groups:** the older concept says later.
- **"Members create, admins approve":** the older concept says later.
- **Moving a workspace directly between organizations:** detach, then move in, as the older concept says.

## 36. People: role changes, outside people, former members, removal, leaving mid-work

Designed on 2 November 2026 from `org-members.ts`, `member-rules.ts`, `OrgMembersTab.tsx`, `members.ts`, `collaborator-lifecycle.ts`, `assignments.ts` and the older concept (decisions 6, 66, 106). Approved by the owner. This is batch 4 of 34.1. Findings come from reading the code; nothing was run.

### 36.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Changing a role doesn't touch assignment copies.** `changeMemberRoleAction` only changes the role and sends a notice. | A student made TA keeps their open copies. A Viewer made Member gets none, which 26.8 needs. |
| 2 | **Nothing stops someone reviewing their own work.** No check was seen in the review action (`reviewAssignmentCopyAction`). | A student promoted to TA could approve their own submission. |
| 3 | **The Outside list is read only.** Names and workspaces, with no actions. | Admins can see outside people but do nothing from there. |
| 4 | **No list of former members.** Ended contribution entries exist, but no screen uses them. | "Admins keep the history" has nowhere to appear. |
| 5 | **The removal reason isn't kept.** It goes in the email and notice, and wasn't seen stored anywhere. | Later, nobody can see why someone was removed. |
| 6 | **Remove uses browser pop-ups,** with no counts, and refuses a lead with only a message. | The list in 4.7 was never built into a dialog. |
| 7 | **Assignments keep their creator's name.** "From Ms. Rao" remains after they leave. | Students may be told to ask someone who's gone. |

**Already working:** only the owner manages admins, leads must transfer before leaving, and removal clears workspaces and channels and reopens seats.

### 36.2 Changing someone's role

**Who can:** the owner for anything involving Admin; owner and admins between Member and Viewer. The owner only changes through Transfer.

**What each change does:**

| Change | Open assignments | Handed-in work | Messages | Workspaces |
|---|---|---|---|---|
| **Member → Admin** | Unsubmitted copies are removed; off any groups, with the next person leading | Stays in their record | Stays | Stays on teams |
| **Admin → Member** | Gets open assignments, as a late joiner; past-due ones through Give to | Unchanged | Stays | Stays |
| **Member → Viewer** | Unsubmitted copies are removed; off any groups | Stays | Removed from `#general` | **Removed from teams;** blocked if they lead one |
| **Viewer → Member** | Gets open assignments | None | Added to `#general` | Can now join |
| **Admin → Viewer** | None | Unchanged | Removed from `#general` | Same as Member → Viewer |
| **Viewer → Admin** | None | None | Added to `#general` | Can now join |

**The dialog:**

```
Make Asha a TA?
· 2 open assignments are removed from her list
· 3 submitted assignments stay in her record
· She leaves Group A for Lab 2; Ravi takes over
· She can now review work, except her own
              [Cancel]  [Make TA]
```

| Rule | Design |
|---|---|
| **Own work** | **Nobody can review their own submission, or their group's.** It stays with other admins; if there's no one else, the owner can. The server enforces this. |
| Leads a workspace | Member → Viewer is refused: "Transfer Team Falcon first," with a link |
| Limit | 20 admins, checked before opening |
| Bulk | Same list as totals: "12 people · 4 open assignments removed" |
| Title | Stays, with a nudge: "Update Asha's title?" |
| Profile | History adds "Student → TA" (4.3) |
| Told | "Your role in CSE 3B is now TA. You can now review work." Says what changed. |
| Yourself | Admins can't change their own role; they use Leave |

### 36.3 Outside people

**They're always one workspace's guests, never in the organization.**

| Stage | Design |
|---|---|
| **Adding** | Only when Outside people is on. Lead or admin searches public profiles in Add people's Outside tab, and they're **always invited**. |
| **Invitation** | Names the workspace: "Join Team Falcon, part of CSE 3B" |
| **Sidebar** | "CSE 3B / Team Falcon" |
| **Chip** | `Outside CSE 3B` in the workspace's members and team cards |
| **Leaving** | Leave the workspace, as anyone would |
| **Setting turned off** | Existing people stay until removed, with a count in the confirmation; new ones can't be added |
| **Workspace detached** | They become normal members |
| **Organization deleted** | Stays with the kept workspace |

**What they see, tab by tab:**

| Tab | Outside person |
|---|---|
| Overview | The workspace's; no organization rows |
| Tasks | Team tasks and the group copy's brief, with no link to the organization or class questions |
| Sprints | The team's; "Inside CO1" with no link |
| Updates | Team posts; no pinned organization line; **Everyone in CSE 3B isn't offered** |
| Documents, Files | Team items; no From CSE 3B |
| Messages | That workspace's channels only |
| Settings | Your membership, Privacy, Leave |
| Organization page | As any visitor |
| Submit | Only group work assigned to them, shown as "Submitted by Sam (outside CSE 3B)" (39.1) |

**Members → Outside filter, now with actions:**

| Part | Design |
|---|---|
| Row | Name, `Outside`, each workspace with who added them |
| Actions | Message; **Remove from workspace**, after a confirmation and with the lead told |
| Join | They can still join the organization normally; the chip then goes |
| Hidden from | Everyone else's Members; they never count toward Max members |

### 36.4 Former members

**Members → Status → Former** is a new filter, for owner and admins.

```
Rama Naidu        Left 2 Nov              3 of 4 done · Team Falcon
Asha Rao          Removed 28 Oct · Ms. Rao · "Repeated no-shows"
Kiran S           Removed 12 Oct · Blocked
```

| Part | Design |
|---|---|
| Row | Name, how it ended, when, who, reason if written, what they did |
| Panel | Their submissions, activity and period; read only |
| Actions | Message if allowed; Invite back; Unblock (29.3) |
| Search | Works like the roster |
| Empty | "Nobody has left yet." |
| Privacy | Admins only. Names stay even if their profile changes. |
| Account deleted | "Deleted user", with counts |

**Where the data comes from:** ended contribution entries, plus `end_reason` from section 10. It adds two small values: who ended it, and the reason written.

### 36.5 The Remove dialog

```
Remove Asha Rao from CSE 3B?

This will:
· Remove her from Team Falcon; 1 seat opens
· Remove 2 unsubmitted assignments
· Keep 3 submitted assignments for admins
· Unassign 1 task
· Remove her from channels here
· Hide her profile entry and withdraw verification

Reason (optional)  [                     ]
She'll see this. Leave it empty to send no reason.

☐ Also block her from rejoining

              [Cancel]  [Remove Asha]
```

| Case | What happens |
|---|---|
| Leads a workspace | Replaces the list: "Asha leads Team Falcon. Transfer it first," with **Assign a new lead** here |
| Admin | Only the owner; says so |
| Several people | Totals; anyone blocked by the lead rule is listed and left out: "Remove 11, skip 1" |
| Block ticked | "She won't be told. She'll see 'You can't join this organization.'" |
| After | "Asha was removed," with a link to Former |
| Regret | Invite back from Former; a removed person's words return as a draft (decision 3) |

### 36.6 People leaving mid-work

Nothing depends on the person who created it.

| When someone leaves | Their | What happens |
|---|---|---|
| Admin | Assignments they created | Stay and keep working; all admins manage them |
| | "From Ms. Rao" | **Becomes "From CSE 3B"** |
| | Reviews waiting | Stay in the shared queue; if they were the set reviewer (33.5), it goes back to everyone |
| | Drafts | Stay, visible to all admins, labelled "Draft by Ms. Rao" |
| | Tasks assigned to them | Unassigned, with a Today row: "3 tasks need someone" |
| | Sprints, documents, files, announcements | Stay, showing their name |
| | Pinned post | Stays; any admin can unpin |
| **Last admin besides the owner** | | Allowed; the owner is told |
| Owner | | Must transfer first (27.6) |
| Owner's account closed or banned | | Passes to the longest-serving admin, as today |
| Member on a group | Group copy | Stays; next person leads (25.7) |
| Workspace lead | Workspace | Must transfer; if impossible, 35.4 |
| Team lead | Team | No lead; workspace lead told |

### 36.7 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | Nobody reviews their own work |
| Step 2 (Membership) | Who ended it and the reason, alongside `end_reason` |
| Workspaces and Members step | Role dialog and effects, Outside actions, Former, Remove dialog |
| Tasks step | The "From" fallback, drafts and the Today row |

### 36.8 Calls made

- **Admins don't hold copies.** The permissions table already says admins don't submit, so a student made TA stops being assigned work, but their record stays.
- **Former is a filter, not a new tab.** It's the same list with the same tools.
- **Removal reasons are kept for admins.** The person has already seen it, so this adds nothing new about them.

### 36.9 Left out on purpose

- **Temporary roles with an end date:** no real need yet.
- **Custom roles beyond the four:** role names cover it.
- **A separate audit log screen:** Former and Last changed cover what's needed.

## 37. Remaining tab detail

Designed on 2 November 2026 from `server/sprints.ts`, `OrgSprintParts.tsx`, `updates.ts`, `UpdateCard.tsx`, `org-docs.ts`, `OrgDocParts.tsx`, `org-files.ts`, the Files components, `settings-policies.ts`, `assignments.ts`, `ShareDialog.tsx`, `discover.ts` and the older concept (§15, §17, §19, §23). Approved by the owner. This is batch 5 of 34.1. Findings come from reading the code; nothing was run.

### 37.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Duplicate sprint has nothing behind it.** 7.6 listed it, but no such action was found. Cancel and Archive do exist (`server/sprints.ts`), and the report didn't mention them. | The sprint menu in the report didn't match the code. |
| 2 | **Share only covers the whole organization or workspace.** No sprint, document or assignment can be shared through the dialog. | Those need a simple Copy link. |
| 3 | **Following gives very little.** It feeds Discover's Following view and ranking, and no notices for followers were found. | "Same as a workspace" needed spelling out for an organization. |
| 4 | **Storage's Review actions have no screen behind them.** 7.12 lists "Review large files" and "Old versions". Deleting a version exists, but one by one. | They need a real destination. |
| 5 | **Students have no page for their own submissions in Files.** The Submissions view was designed for admins, and 16.4 says "their own only" without detail. | Covered below, using My work's list. |

**Already working:** edit, delete with a reason, pin, reply settings, likes, who liked, report, block and mute on posts; sprint Start, Complete, Delete and Materials; document options; version history and edit locks; Trash; and tab badges.

### 37.2 Sprint actions

**The `⋯` menu:**

| Stage | Top action | `⋯` |
|---|---|---|
| Planning | Start now | Edit, Cancel, Delete |
| Running | Complete | Edit, Cancel |
| Ended, not completed | Complete | Edit |
| Completed | None | Archive |
| Archived | None | None; read only |

**Duplicate is dropped,** because Use again (33.5) and Repeat cover the need. Cancel and Archive join the report.

| Action | Dialog | Rule |
|---|---|---|
| **Start now** | "Start CO3 now? Members will be told." with **Post an announcement**, off by default | If another is running: "CO2 is still running. Complete it first," with a link |
| **Complete** | Unfinished tasks: keep, Backlog, or next sprint. Open assignments: close them, or leave them open. Summary after (33.4). | By hand, except when the next sprint takes over (42.6) |
| **Cancel** | "CO3 won't run. 4 items move to Backlog. Linked workspace sprints are unlinked, and their leads are told." | Stays in the list as Cancelled |
| **Delete** | Planning only, with where the work goes | Once started, Cancel instead |
| **Archive** | "Read only, and moves to Archived." | Completed only |
| **Edit** | The same form, with Move later sprints and Move due dates (28.2) | Linked sprints are flagged, never changed |

**Materials:**

| Part | Design |
|---|---|
| Add | Search files and documents in this organization |
| Admins-only file | Warns: "Members won't be able to open this." |
| Remove | Removes the link, not the file |
| Member | Read; the row hides when empty |
| Visitor | Not shown |

**Workspaces panel (Remind leads):**

| Part | Design |
|---|---|
| Line | `3 of 5 workspaces linked` |
| Panel | Each workspace: its sprint and progress, or `Not planned` |
| Remind | One or all unlinked; 12-hour rule, with an honest count (28.8) |
| Shown to | Admins only |

### 37.3 The post card

**Actions by person:**

| Action | Author | Admin | Member | Viewer | Visitor |
|---|---|---|---|---|---|
| Like, see who liked | Yes | Yes | Yes | See only | See only, if public |
| Comment | Per reply rule | Yes | Per reply rule | No | Public posts, if signed in and allowed |
| Edit | Yes | Own only | Own only | No | No |
| Delete | Yes | Anyone's, with a required reason | Own | No | No |
| Pin | Announcements | Yes | No | No | No |
| Reply setting | Yes | Yes | Own | No | No |
| Copy link, Share | Yes | Yes | Yes | Yes | If public |
| Report, Mute, Block | Not on their own | Yes | Yes | Yes | Report, if signed in |

**Audience, shown on the card:**

| Choice | Who sees it | Label |
|---|---|---|
| Everyone in CSE 3B | Members, admins, Viewers | `Members` |
| Admins | Owner and admins | `Admins` |
| Students (a role) | That role and admins | `Students` |
| Selected workspaces | Their teams, and admins | `Team Falcon +2` |
| Public | Anyone; Discover too | `Public` |

**Rules:** changing the audience later can only widen it after a confirmation. Narrowing it applies at once, with a line saying people who already saw it may remember it.

**States:**

| State | Shows |
|---|---|
| Edited | `Edited`, and Notify again if ticked |
| Deleted by an admin | Author told the reason; gone for others |
| Author left | Stays with their name; comments stay |
| Comments off | "Comments are off"; old ones stay |
| Hidden by moderation | Follows 29.2 |

**From workspaces moderation (admins):**

| Action | Effect |
|---|---|
| Pin | In the organization's feed only |
| **Hide from CSE 3B** | Removed from the organization's feed; stays in the workspace; lead told |
| Comment | Shared with the workspace's post |
| Workspace unshares, detaches or is deleted | Leaves the feed |

### 37.4 Document publishing

| Stage | Admins | Members | Visitors |
|---|---|---|---|
| **Draft** (new or empty) | `Draft`, can edit | Hidden | Hidden |
| **Published** | Seen in its group | Reads it | If marked Public |
| **Changed, not published** | "Unpublished changes," with Publish | Sees the last published | Same |
| **Updated** | | `Updated` for 7 days | |
| **Removed** | Stays in Files | Gone | Gone |

**Publish dialog:**

| Field | Rule |
|---|---|
| What changed | Up to 200 characters; goes in history |
| Tell members | Off by default |
| Ask to re-read | Only on Required; counts restart (28.4) |
| Button | "Publish" or "Publish and tell 40 people" |

**The `⋯` options:**

| Option | Design |
|---|---|
| Who can see it | Members only (default) or Public; Public warns if empty, and the organization must be public |
| Group | Pick one |
| Required | Switch; Read counts appear |
| Template | Switch; moves to the Templates group |
| Show in workspaces | On by default; not for outside people |
| Link to sprint | Pick one; appears in Materials |
| History | Compare and restore |
| Remove | Stays as a file; asks first |

### 37.5 Files pages

**The file view:**

| Part | Admin | Member |
|---|---|---|
| Preview, Raw | Yes | Yes |
| Edit | With a lock (as today) | No |
| Versions | Compare, restore, upload, delete old | See only |
| Linked tasks | Yes | Those they can see |
| Used by | "In use by CO1 and Lab 3" | Not shown |
| Copy link, Download | Yes | Yes |
| Add to Documents | Yes | No |
| Code editor | 24.2 | Read only |

**Submissions page (Final files for other types):**

| Part | Design |
|---|---|
| List | Grouped by assignment; each person or group, with version, when, Late, status |
| Filters | Assignment, status, Late |
| Open | Goes to the review queue for that person |
| Download | One, or Download all per assignment (28.5) |
| Student | **Not a Files page:** My work → Submitted (30.7) is their one list, and their copy's files are in the task panel |

**Sprint materials page:** grouped by sprint, each with its files and documents, and Add for admins. Members read.

**Task files page:** admins see files by task, including every copy. Members see only their own.

**Trash:**

| Part | Design |
|---|---|
| Who | Those who can delete |
| Row | Name, who deleted it, when, days left |
| Restore | Back to where it was, or the root if that's gone |
| Delete forever, Empty | Asks first, with the size freed |

**In-use warning:** deleting says "Used by CO1 and Lab 3. They'll lose this file." The choice stays yours.

**Storage's Review:**

| Row | Opens |
|---|---|
| Review large files | A list, largest first, with Delete and Open |
| Old versions | Files with many versions, with **Keep latest 3** after a confirmation |
| Empty Trash | Confirmation, with the size freed |

### 37.6 The tab bar

| Order | Tab | Owner, Admin | Member | Viewer | Visitor |
|---|---|---|---|---|---|
| 1 | Overview | Yes | Yes | Yes | No |
| 2 | About | Yes | Yes | Yes | Yes; lands here |
| 3 | Documents | Yes | Yes | Yes | If on |
| 4 | Updates | Yes | Yes | Yes | If on |
| 5 | Sprints | Yes | Yes | Yes | If on |
| 6 | Tasks | Yes | Yes | Counts only | No |
| 7 | Files | Yes | Yes | Yes | If on |
| 8 | Workspaces | Yes | Yes | Yes | No |
| 9 | Members | Yes | No | No | No |
| 10 | Settings | Yes | Their part | Their part | No |

**Badges:**

| Tab | Admin | Member |
|---|---|---|
| Tasks | To review count | Due within 2 days |
| Updates | Dot for unseen announcements | Same |
| Members | Join requests | None |
| Workspaces | Requests count | None |
| Settings | Open reports count | None |

**Other rules:** the opening tab is Overview, or About for visitors. Each tab has a link you can share. Opening a tab you can't see goes to About, with no error. On phones, the row scrolls and keeps the current tab in view. Child workspaces use the same order, without About, Workspaces and Members.

### 37.7 Sharing

**The Share dialog on an organization or workspace:**

| Part | Design |
|---|---|
| Preview | The same card a link shows (31.2) |
| Copy link | The public address |
| Send in a message | To a person or channel; the card appears there |
| Note | "People without access will see the private page." when it isn't public |
| Join code | **Never shared here;** that's the Invite panel |

**Other items get Copy link only:** a sprint, document, file, assignment or post has Copy link in its `⋯`.

**What a link opens:**

| Person | Result |
|---|---|
| Can see it | The exact item |
| In the organization, can't see it | "You don't have access to this," with a link to the organization |
| Member opening someone else's copy | Same; never says whose it is |
| Not in the organization, private | Private page (26.9) |
| Not in the organization, public | The item if public; otherwise About |
| Signed out | Sign in, then back to the same link |
| Deleted item | "This is no longer here." |

### 37.8 Followers of a public organization

| Part | Design |
|---|---|
| Who can follow | Signed-in visitors of a public organization; **not members** |
| Button | Follow beside Join; becomes Following |
| What they get | Public posts in Discover's Following view; **no notifications**, unless they turn on the bell for announcements |
| What they don't get | Anything members-only, or access of any kind |
| Count | Shown on the header |
| Who sees followers | The count only; no list |
| Joining | Following ends quietly; they're a member now |
| Leaving | Doesn't come back by itself |
| Going Private | Followers stay, invisibly, and see nothing; if public again, it resumes |
| Archived | Stays; no new posts |
| Suspended or deleted | Follow disappears |
| Block | A blocked person can't follow |

### 37.9 How this gets built

| Build step | What goes in |
|---|---|
| Sprints step | Menus, dialogs, Materials, Workspaces panel |
| Updates step | Card actions, audience, Hide from CSE 3B |
| Documents step | States, Publish dialog |
| Files step | Pages, Trash, in-use warning, Review |
| Step 3 (Shared blocks) | The tab bar |
| Final pass | Sharing and followers |

### 37.10 Calls made

- **Duplicate sprint is dropped.** It has no backend, and Use again and Repeat cover the need.
- **Only Copy link for items inside.** A full share dialog on every item would add clutter, and what matters is that the link behaves correctly.
- **Followers get no notifications by default.** Following is a soft interest; they opt in to more.
- **No list of followers.** Only the count, so following stays private.
- **Students use My work for submissions.** One list, rather than two.

### 37.11 Left out on purpose

- **Sharing with a link that grants access:** the join code and invites already do this.
- **Multiple reactions on posts:** decided in 28.
- **Comments on documents:** the older concept says no, and questions go to Updates.

## 38. The profile and Edit contribution

Designed on 2 November 2026 from `ContributionEditor.tsx`, `OrgStoryHelpers.tsx`, `org-profile.ts`, `contribution-stories.ts`, `collaboration.ts`, `org-templates.ts` and the older concept (§24.4–24.6). Approved by the owner. This is batch 6 of 34.1. Sections 4.5, 4.6, 16.9 and 16.10 design the profile's structure; this fills in the editor itself. Findings come from reading the code; nothing was run.

### 38.1 What the code showed

| # | Finding | What it means |
|---|---|---|
| 1 | **Dates on a verified entry can be edited.** The start and end fields are open on organization entries (`ContributionEditor.tsx:1349`), the server saves them (`contribution-stories.ts:730`), and the ✓ stays. | ✓ says "role and dates", so someone could change the dates and keep the badge. |
| 2 | **Start from my work counts unreviewed work as completed.** Submitting sets the status to done, and the list reads that status (`readOrgStoryStarterAction`). | Work still waiting for review, or later returned, can appear as finished. |
| 3 | **Work record saves at once,** while everything else waits for Save or Publish (`setWorkRecordAction`). | One switch behaves differently from the rest. |
| 4 | **The write-up nudge is only an email** (`org_ended`). Nothing was found on the profile or editor. | Most people will miss it. |
| 5 | **Private organizations weren't settled.** The older concept hides them from others; 4.3 didn't mention them. | A private class could show on a public profile. |
| 6 | **Image import from workspaces** wasn't confirmed to respect Admins-only folders. | The build must check this. |

**Already working:** drafts with local recovery, Save and Publish, role history with up to 20 steps, up to 8 images, skills, featured entries, and Start from About.

### 38.2 Manage organizations

Opened by the pencil on the profile's Organizations section.

```
Manage organizations
⠿ [CS] CSE 3B · Teacher            [Show ●]   Edit contribution
⠿ [AS] Acme Sales · Member         [Show ○]   Edit contribution
Private organizations show only to you and their members.
                                             [Done]
```

| Part | Design |
|---|---|
| Rows | Logo, name, role, Show switch, Edit contribution |
| Order | Drag, or Move up and down by keyboard; this sets the order on your profile |
| Show off | Hides the row, the entry and nested workspaces from others; nothing's deleted |
| Saves | At once, with a quiet "Saved" |
| Empty | "You're not in an organization yet," with Join with code |
| Same switch | Also in Settings → My membership; they stay in step |

### 38.3 The editor

**Left list,** with a status on every row:

```
ORGANIZATIONS
CSE 3B · Data Structures          Published
  └ Team Falcon                   Draft
Acme Sales                        Hidden
WORKSPACES
Ponytail                          Published
NOT ON YOUR PROFILE YET
Vision Lab                        Draft
PRIVATE TO YOU
Old Class                         Removed
```

**An organization entry:**

| Section | Field | Editable? | Rule |
|---|---|---|---|
| **Header** | Organization, type, logo | No | "Set by CSE 3B" |
| | Verified | No | ✓ with who and when; or "Not verified yet" |
| **Role and dates** | Role, start, end | **No** | **Locked on the server.** "Ask an admin" if wrong |
| | Your title | Edits in My membership | Link |
| **Your words** | Summary | Yes | One or two lines, shown on the card |
| | Story | Yes | The existing editor |
| | Helpers | Yes | Start from my work; Start from About for admins |
| **Position history** | Steps | See 38.4 | |
| **Skills and images** | Skills | Yes | Picker |
| | Images | Yes, up to 8 | Uploads, own submissions and team files; **never Admins-only, checked by the server** |
| **Show** | On my profile | Yes | 38.5 |
| | Featured | Yes | Moves it first |
| | Work record | Yes | **Saved with the rest, like everything else** |

**A nested workspace entry:** the same, but role and dates are locked from the workspace, with the team and team lead mark. It's verified by the lead, workspace admins or organization admins.

**A personal workspace entry:** as today, except the heading becomes "Workspace".

**A manual entry (nothing on NetworkBase):** every field is editable, with no ✓.

### 38.4 Position history

```
Teacher                Oct 2026 – Present     From CSE 3B ✓
Add detail: "Ran weekly lab sessions"

TA                     Aug – Oct 2026         From CSE 3B ✓
Add detail

Course mentor          Sep – Oct 2026         Added by you
Edit · Remove
```

| Step | Design |
|---|---|
| **From the record** | Role changes add a step by themselves. Name and dates are locked; you can add detail, or hide it. |
| **Added by you** | Allowed, and clearly marked; never shows ✓ |
| Hiding | The record stays; others don't see that step |
| Current role | From the record; can't be hidden on a current membership |
| Limit | 20 steps, as today |

### 38.5 Publishing

| Status | Others see | You see |
|---|---|---|
| **Draft** | Nothing | Under "Not on your profile yet" |
| **Published** | The last published version | Same; "Unpublished changes" if you've edited |
| **Hidden** | Nothing | "Hidden," with Show |
| **Left, Completed** | With that status | Same, with Edit |
| **Removed** | Nothing | "Private to you", read only, with Delete |

**Buttons:** Save draft, and Publish updates once there's something new. Publish checks that a summary exists, and points to anything missing. Delete removes your words only, never the record.

**Who sees an entry:**

| Organization | Person | Sees |
|---|---|---|
| Public | Anyone | Published entries and the Organizations row |
| **Private** | **Members of it, and you** | **The entry; everyone else sees nothing,** and you see `Private · only you and members` |
| Workspace set to Organization only | Organization members | A normal link |
| | Others, if the organization is public | Name, role, dates and your words, with no link (`Visible to CSE 3B members`) |
| Private workspace | Its team | The entry; others see nothing |

### 38.6 The write-up nudge

| Moment | Where | Says |
|---|---|---|
| Just joined | Welcome panel (26.7) | "Add to your profile" |
| Own profile, any time | Under "Not on your profile yet" | "Write about your work in CSE 3B" |
| Term end close-out (33.6) | Today, for members | "Term ends 15 Dec · Write up your contribution" |
| Archived | Existing email, plus one tray notice | "CSE 3B has ended. Add this to your profile." |
| Leaving | After the Leave dialog | "You left CSE 3B. You can still write up your work." |

Each appears once and disappears after you publish, or dismiss it. It never appears on anyone else's view.

### 38.7 Start from my work

| Part | Design |
|---|---|
| Counts as done | **Approved, or done with no review; never waiting or returned** |
| Lists | Completed assignments and workspaces with their team |
| Inserts | As editable text at the cursor; nothing is published automatically |
| Empty | "Nothing finished yet. Come back when you've done some work." |
| Start from About | Admins only; copies the description as editable text |

### 38.8 Work record

| Part | Design |
|---|---|
| Default | Off |
| Shows | `12 of 12 assignments · 5 sprints`; from the record, not editable |
| Counts | Done or approved, out of those required; excused work is left out; group work counts for each person |
| Never shows | Marks, Late, returned counts or who reviewed |
| Removed | Hidden with the entry |
| Who can turn it on | Only you |

### 38.9 The profile page itself

| State | Others | You |
|---|---|---|
| Entry with no words | One line: name, role, dates | Same, with "Add your words" |
| Nested workspaces | Collapse after 3 | Same |
| Role changed | Current role, with history inside | Same |
| Organization renamed | The new name | Same |
| Organization deleted | Old name, no link | Same |
| Rejoined | Same entry; old period in history | Draft words back if removed (decision 3) |

**Phones:** the left list becomes the first screen, opening each entry full screen. Section tabs scroll.

### 38.10 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | Locked dates and role on the server for organization and workspace entries, and the fix to Start from my work |
| Step 2 (Membership and profile) | Manage organizations, the editor, position history, publishing, nudges, and who sees an entry |

### 38.11 Calls made

- **Dates and roles are locked for anything from the record.** ✓ means nothing otherwise. Manual entries stay free.
- **You can add your own history steps, clearly marked.** People often do more than their role says.
- **Private organizations show only to you and their members.** This follows the older concept, and it's the safe choice.
- **Hiding a history step is allowed.** It only affects what others see, and the record stays.

### 38.12 Left out on purpose

- **Asking an admin to change a locked fact from the editor:** the existing message link covers it.
- **Endorsements or recommendations:** a different feature.
- **Auto-writing the story with AI:** not requested.

## 39. The rules: permissions, notices, glossary

Designed on 2 November 2026 from `permissions.ts`, `terms.ts`, `member-rules.ts`, `check-terminology-contract.ts` and sections 21–38. Approved by the owner. This is batch 7 of 34.1. Findings come from reading the code; nothing was run.

### 39.1 Corrections to earlier sections

**1. Status words (34.2).** They were set without checking the terminology already agreed and shipped in `terms.ts`, which a script guards.

| What | 34.2 said | Already agreed | Now |
|---|---|---|---|
| Sprint | Planning, Running, Completed | Upcoming, Active, Completed, Archived, Cancelled | **As agreed** |
| Finished assignment chip | Done | Completed | **Completed** |
| Short counts | `12 of 40 done` | Not covered | Stays; it's a plain count, not a status |

Stage names in sections 7, 16, 33 and 37 follow this list wherever they say Planning or Running.

**2. Outside people submitting (36.3, 36.8, decision 96).** 36.8 said the permissions table gives them no Submit. It does: they can submit their own, if assigned. The owner agreed to follow the table: an outside person can submit only group work assigned to them, shown as "Submitted by Sam (outside CSE 3B)".

### 39.2 Permissions

The existing table in `permissions.ts` stays; these rows join it, along with 21.3's. Every server action checks this table, and a test keeps them matched.

**Organization:**

| Action | Owner | Admin | Member | Viewer | Visitor |
|---|---|---|---|---|---|
| **Work** | | | | | |
| Create tasks on the organization's board | Yes | Yes | No | No | No |
| Update a task assigned to them | Yes | Yes | Own | No | No |
| Edit for everyone, Use again, Repeat | Yes | Yes | No | No | No |
| Extend, Excuse, Give to, Remind | Yes | Yes | No | No | No |
| Close, Reopen | Yes | Yes | No | No | No |
| Approve, Return | Yes, not own | Yes, not own | No | No | No |
| Set reviewers | Yes | Yes | No | No | No |
| Export progress | Yes | Yes | No | No | No |
| Download all | Yes | Yes | No | No | No |
| Submit, ask class questions | No | No | Yes | Questions: read | No |
| **People** | | | | | |
| See class overview, Seen and Read lists | Yes | Yes | No | No | No |
| Mark away | Yes | Yes | No | No | No |
| Change Member or Viewer role | Yes | Yes | No | No | No |
| Change anything involving Admin | Yes | No | No | No | No |
| See Former | Yes | Yes | No | No | No |
| Invite back, Unblock | Yes | Yes | No | No | No |
| Approve join requests | Yes | Yes | No | No | No |
| Move someone to another workspace | Yes | Yes | No | No | No |
| Remove an outside person | Yes | Yes | No | No | No |
| Handle Ask to change team | Yes | Yes | No | No | No |
| **Workspaces** | | | | | |
| Approve move-in, leave | Yes | Yes | No | No | No |
| Assign a lead (only when none) | Yes | Yes | No | No | No |
| Archive, Detach | Yes | Yes | No | No | No |
| Remind leads | Yes | Yes | No | No | No |
| **Posts and documents** | | | | | |
| Hide a shared post | Yes | Yes | No | No | No |
| Delete someone else's post, with a reason | Yes | Yes | No | No | No |
| Publish a document, Required | Yes | Yes | No | No | No |
| **Files** | | | | | |
| Storage: see, Review | Yes | Yes | No | No | No |
| Empty Trash | Yes | Yes | No | No | No |
| **Trust** | | | | | |
| Handle reports | Yes | Yes | No | No | No |
| See Standing | Yes | Yes | No | No | No |
| Appeal | Yes | No | No | No | No |
| **Organization** | | | | | |
| Change type, role names, name, handle, image | Yes | No | No | No | No |
| Request ✓ | Yes | No | No | No | No |
| Transfer, Archive, Duplicate, Delete | Yes | No | No | No | No |
| Follow | No | No | No | No | Public |
| Copy link | Yes | Yes | Yes | Yes | If public |

**Child workspace:**

| Action | Lead | Workspace admin | Org admin | Team | Outside | Other member | Visitor |
|---|---|---|---|---|---|---|---|
| Add, remove, edit teams | Yes | Yes | Yes | No | No | No | No |
| Accept or decline applications | Yes | Yes | Yes | No | No | No | No |
| Apply for a seat | No | No | No | No | No | Yes | Only per 25.4 |
| Task for a team, or each team | Yes | Yes | Yes | No | No | No | No |
| Reassign group work | Yes | Yes | Yes | No | No | No | No |
| Submit group work | Own | Own | Yes | Own | Own, if assigned | No | No |
| GitHub: connect, push | Yes | No | No | No | No | No | No |
| GitHub: see status | Yes | Yes | Yes | Yes | Yes | No | No |
| Unarchive | If they archived it | No | Yes | No | No | No | No |
| Delete | Yes, unless work was handed in | No | No | No | No | No | No |
| Leave | After transfer | Yes | No | Yes | Yes | No | No |

### 39.3 Notices

These are the additions since 30.4, on the same rules.

| Trigger | Who | Tray text | Important | Attention | Push | Group |
|---|---|---|---|---|---|---|
| Marked away | Person | "You're marked away until 20 Nov" | Yes | No | No | Membership |
| Back from away | Admins | Only in the summary | No | No | No | Membership |
| Sprint ends in 2 days | Admins | "CO3 ends Thursday · 4 behind" | Yes | Yes | No | Sprints |
| Sprint summary | Admins | "CO3 completed: 34 done, 6 missing" | No | No | No | Sprints |
| Sprint result | Members | "CO3 closed · you completed 3 of 3" | No | No | No | Sprints |
| Set as reviewer | That admin | "You're reviewing Lab 3" | No | No | No | Assignments |
| Given work | Person | "You've been given Lab 2 · due Mon" | Yes | Yes | Yes | Assignments |
| Workspace archived | Team | "Team Falcon was archived by Ms. Rao" | Yes | No | No | Workspace |
| Workspace unarchived | Team | "Team Falcon is open again" | No | No | No | Workspace |
| Made lead by an admin | New lead | "You're now the lead of Team Osprey" | Yes | No | Yes | Workspace |
| Shared post hidden | Lead | "Your post was hidden from CSE 3B" | No | No | No | Updates |
| Removed from a workspace | Outside person | "You were removed from Team Falcon" | Yes | No | No | Workspace |
| Role changed | Person | "Your role in CSE 3B is now TA. You can now review work." | Yes | No | Yes | Membership |
| Write-up nudge | Person | Per 38.6, once | No | Yes | No | Credit |

**No notice at all:** Use again, Export, Catch up, Seen and Read counts, Follow, Hide a history step.

### 39.4 The glossary

**The words on screen:**

| Word | Means | Never say |
|---|---|---|
| Organization | The whole thing | Org, on screen |
| Workspace | A child workspace | Project |
| Workspace lead | Runs a workspace | Owner of a child workspace, Team lead |
| Team | A box inside a workspace | Unit, Role box |
| Team lead ★ | The team's contact | |
| Group | People sharing one assignment | Team, in Assign to |
| Task | Any piece of work | |
| Assignment | A task to many; a chip | Master |
| Your work, submission | A person's own part | Copy, on screen |
| Viewer | Read-only role | Guest |
| Today, This week | Overview sections | Needs you, Dashboard |
| Documents | The tab | Docs, Readme |
| Requests | My work's tab | |

**By type:**

| | Education | Company | Research | Community | Club | Other |
|---|---|---|---|---|---|---|
| Owner, plural | Teacher, Teachers | Owner, Owners | PI, PIs | Owner, Owners | President, Presidents | Owner, Owners |
| Admin, plural | TA, TAs | Manager, Managers | Researcher, Researchers | Admin, Admins | Coordinator, Coordinators | Admin, Admins |
| Member, plural | Student, Students | Member, Members | Member, Members | Member, Members | Member, Members | Member, Members |
| Viewer, plural | Viewer, Viewers | Same | Same | Same | Same | Same |
| How the ___ is doing | class | team | lab | group | club | group |
| Finished work | Submissions | Final files | Final files | Final files | Final files | Final files |
| Sprint name | CO1 | Sprint 1 | Sprint 1 | Sprint 1 | Sprint 1 | Sprint 1 |
| Week line | "Week 6 of 16" | None | None | None | None | None |
| Calendar word | Term | | | | | |

**Custom role names:**

| Case | Rule |
|---|---|
| **Plurals** | Add "s", unless it already ends in "s" or is an uncountable word like Staff, Faculty, Crew or Team |
| **Sentences** | **Avoid "a" and "an".** "Your role is now TA", not "You're now a TA" |
| **Empty lines** | **Avoid the role word:** "Nobody has joined yet", not "No students yet" |
| **Counts** | Always a count with the plural: "40 Students", "1 Student" |
| **Members screen** | The name with the base role, as today: `Teacher · Owner` |
| **Other-type label** | Shown wherever type appears; "How the group is doing" |

**Guarding it:** add the new banned on-screen words to `check-terminology-contract.ts`, the script that already guards vocabulary.

### 39.5 How this gets built

| Build step | What goes in |
|---|---|
| Step 1 | The role-change notice wording, and adding to the terminology check |
| Each step | Moves its server checks to the table, and adds its notices |
| Step 3 (Shared blocks) | The role-word helper for plurals and counts |

### 39.6 Calls made

- **The shipped terminology wins.** It was agreed and is guarded by a script; a design note shouldn't override it.
- **Sentences avoid "a/an" and role plurals.** Custom names make those guesses unreliable, and rewording is simpler than asking owners to type plurals.
- **No per-role custom permissions.** Only the four roles, as decided.

### 39.7 Left out on purpose

- **A plural field for custom role names:** the rule covers nearly all, and rare oddities can be reworded.
- **Translations:** not in scope; it would use this list as its base later.

## 40. Visual design: the mockups

Mockups: https://claude.ai/artifact/5g54UupcpNCxS5bT32WcYQ (private until the owner shares it). Approved 2026-11-02.

### 40.1 The boards

| Board | Shows | Designed in |
|---|---|---|
| Overview, teacher | Today, This week, How the class is doing | 33 |
| Overview, student | The student's own view of the same tab | 33 |
| Overview, dark | The teacher view in dark | 32.8, 33 |
| Board | Assignment cards on the task board | 23, 34 |
| Task panel | Submit: ready, handed in, returned past due | 34.4 |
| Review queue | Waiting list, submission, Approve, Return with reason, keys | 23.2 |
| Members | Roster, bulk actions, Requests, Invite, Former members | 7.10, 28.7, 36 |
| Profile | Organizations section, verified contribution with nested workspaces, draft | 4.5, 38 |
| Phone, Today | Today on a phone | 32.7, 33 |
| Phone, board | One column at a time, Move to | 32.7 |
| Phone, dark | Today in dark | 32.7, 32.8 |

### 40.2 What the mockups are and are not

- **Static:** buttons do nothing, and states such as Return's reason box are drawn already showing.
- **Example data only:** names, counts and dates are made up. Asha is a Student on Members and Review and a TA on Profile, because that board shows a role changing over time.
- **Not checked visually by me:** they were written from the report, then approved by the owner.
- **Dark:** only Overview and phone Today have dark boards. The other screens use the same color tokens at build time and must be checked in dark then.
- **Colors:** the pale warning, danger and info backgrounds in light mode are estimates. The build uses the values in `src/app/globals.css`.

### 40.3 Calls made

- **Export on Members, Unblock on a blocked former member, and the sample contribution wording** weren't specified elsewhere. They were shown to the owner as my choices and kept.
- **The report wins on behaviour.** The mockups settle the look, not the rules.

### 40.4 Left out on purpose

- **Every screen as a mockup:** the eleven boards set the pattern, and other tabs follow it.
- **Clickable prototypes:** the build itself comes next, so a second working version adds nothing.

## 41. Launch plan

Designed on 2 November 2026 from sections 12 and 20, every "How this gets built" list, the schema, `tests/unit/inngest-budget.test.ts`, and the Inngest and Sentry setup. Approved by the owner. This closes batch 9 and gaps 17–19.

**Not checked:**
- **Live organizations:** a read-only count on production was denied when this was written, so how many organizations exist, and how many real people are in them, is unknown. This count is the first task before the first deploy.
- **Normal workspaces:** 41.6 comes from the report's build lists. Not every shared function was traced.

**What this corrected:**

| Report said | Actually |
|---|---|
| Step 0: deploy `5464d41ad` | Already live, so the step is gone |
| Step 1 needs no database change | Last active here needs a new value |
| Most steps need no database change | Eleven changes are needed (41.2) |
| Section 33's features have no build step | Placed in section 12 |
| A code comment (`validations/workspace.ts`) says a feature flag guards organizations | No such flag was found, so people can probably create organizations today |

### 41.1 Rollout order

1. **Fixes:** 1a to 1d, with the browser test repair alongside.
2. **Foundations:** type settings, Membership and profile, Shared blocks.
3. **Tabs:** steps 4 to 13, plus the small Discover step.
4. **Final pass:** step 14.
5. **Pilot:** one real class for two weeks.
6. **After the pilot:** Away, Catch up and Reviewers, then Repeat assignment and Calendar later.

**Each deploy:** apply the migration, then the owner approves the push. Then re-sync Inngest if jobs changed, check the live site and record the measurements.

**Feature flags:** none, because small deploys make them unnecessary. If the count shows real classes already running when the Tasks step arrives, that step gets one temporary switch.

### 41.2 Every database change

All are additions, starting at migration `0042`, and each goes live before the code that uses it. Nothing is dropped in the same release.

| # | Change | Step |
|---|---|---|
| 1 | Last active here on each membership, updated at most hourly | 1a |
| 2 | `end_reason`, who ended it, and the written reason, on the contribution entry | 2 |
| 3 | Fill in saved type settings for existing organizations | Before the tabs |
| 4 | Welcome panel dismissed, on the membership | 4 |
| 5 | Write-up nudge dismissed, on the contribution entry so it survives leaving | 2 |
| 6 | Hide from organization, on the post | 7 |
| 7 | Away table and Reviewers field | After the pilot |
| 8 | The database visibility rule hides drafts from members (`nb_task_visible`, 42.7) | 1a |
| 9 | Submission record table (42.5) | Tasks |
| 10 | Live update rule: copy changes stop going to the organization's board topic (42.13) | 1a |
| 11 | The read-only guard on posts and comments covers edits too, not only new rows (42.15) | 1b |
| 12 | Take-over request: who asked and when, on the organization (45.2) | Settings |
| 13 | Late after, in minutes, on the main assignment (45.3) | Tasks |

**To confirm at build time:** whether `assignments.reminded` and `org.team_changed` need a change. Indexes get added only if the measurements call for them.

**Later:** Calendar's private link needs a small token.

### 41.3 Step 1, split into four deploys

| Deploy | What's in it |
|---|---|
| **1a Privacy** | Hiding drafts from members (42.7), hiding Admins-only material names (42.10), comment privacy, suspension reason shown only to owners and admins, Last active here, the indexing rule, outsiders applying, the GitHub visibility rule, nobody reviews their own work |
| **1b Correct work** | The rejoin fix, delete block with handed-in work, drag block on assignment cards, approved work locked, group work locks, Returned stays visible, refusing member-created tasks, placing accepted applicants, locked record fields, Start from my work, duplicate dates, editor locks and the task check on attachments, removing copies from publish-and-complete, the owner limit on transfer, the 50-organization check, the wizard's limit check, and the editor's task push with the hand-in lock in the shared check (45.4) |
| **1c Notices** | The deleted-account notice to admins (45.5), the two new event types, the wrong-day fix, the archive notice, role-change wording, Remind's wrong count, move-in Approve and Decline, the corrected inactive rule |
| **1d Wording** | The focus ring, plus button, remaining sidebar rows, wizard and ready screen wording, the terminology check, and the parity report's remaining wording |

Where another section's build list says "Step 1", it now means the matching deploy here.

### 41.4 Existing organizations

| Item | Handling |
|---|---|
| Old ended entries | No guessing left or removed. They show as today, and the Former row says "Ended 2 Nov". |
| Last active here | Starts empty and shows "No data yet" |
| Inactive | Empty never counts as inactive until the full inactive period has passed; otherwise everyone looks inactive on day one |
| Old assignments | No catch-up notices. Fixes change what people see, not who gets alerted. |
| Role names and settings | Kept as they are; the fill only adds what's missing |
| Already public organizations | Stay indexed; the rule covers new ones only |

### 41.5 Rollback

- Each deploy is one or a few commits, so the previous version gets redeployed.
- Added columns stay in place, which is harmless. Migrations only move forward.
- Inngest gets re-synced if jobs changed.
- **Roll back when:** there's any privacy problem, a core flow fails on the live check, or a new Sentry error hits real users. Anything else gets fixed going forward.

### 41.6 Effect on normal workspaces

Rechecked in 42.18 against the code each fix touches.

**Shared on purpose, so normal workspaces change:**

| Change | What people in normal workspaces notice | Guard |
|---|---|---|
| Visible focus ring, shared dialog instead of browser pop-ups | Every page changes slightly | `axe` checks and screen checks |
| Wrong-day fix in notices | Correct dates | Notice date tests |
| Locked dates and role on contribution entries | The biggest change: they can no longer edit these | `contribution-stories.test.ts` |
| Contribution editor, heading becomes "Workspace" | New editor | Profile tests |
| Admins can put tasks in sprints (146) | Workspace admins gain this | New test: admin adds a task to a sprint |
| Read-only guard covers edits (156) | An archived workspace's posts can't be edited or pinned | New test in `workspace-updates-actions.test.ts` |
| Transfer asks for identity in place (134) | Transfer works instead of dead-ending | New test of the step-up flow |
| Unified Updates, Sprints, Tasks and Files | Should look the same; this is the highest risk | Workspace tests, plus a screen check of a normal workspace |

**Shared code, but no change for normal workspaces:**

| Change | Why nothing changes | Guard |
|---|---|---|
| Comment privacy (`assertTaskAccess`) | Every member can see every task in a workspace | `task-discussion.test.ts` |
| Step and reassign checks (`lockSubtaskWriteScope`, `assignTaskAction`) | The new rule applies to assignment copies and main assignments only | `workspace-tasks-actions.test.ts` |
| Handing in only through Submit, one review path (`transitionTaskTx`, `approveTaskReviewAction`) | Applies to copies only; normal review stays as today | New test: a normal task's review flow is unchanged |
| Deleting through the assignment rule (`deleteTaskAction`) | Applies to main assignments and copies only | New test |
| Own copy file actions (`assertWorkspaceWriteAccess` callers) | The copy target is used only in organizations | `workspace-files-actions.test.ts`, `file-capabilities.test.ts` |
| Live update rule | Copies exist only in organizations | `live-row-events.test.ts` |
| Sprint handover (122) | Organization sprints only | New test: a normal workspace's sprint still waits for Complete |
| Self-review block (95) | Assignment copies only | New test |
| Post audience, type and follower rules | Organizations only; workspace posts keep Public and followers as today | `workspace-updates-actions.test.ts` |
| Max members check | Organizations only | Organization tests |

**Rule:** a normal workspace looks and works the same unless it's in the first table. Each tab step must pass the workspace tests and a check of a normal workspace screen.

### 41.7 Success measures

Section 1 rules out an analytics tool, so these come from one read-only SQL file, run by hand each month.

| Question | Measure |
|---|---|
| Do classes get set up? | Created to first assignment published; invited people joining within 7 days |
| Does the work flow? | Copies handed in by the due date; time to review; hand-in uploads that failed (45.3) |
| Do they stay? | Organizations active in week 4; members returning weekly |
| Is the profile accurate? | Entries published and verified; entries still showing "Contributor" should be zero |
| Is it fast? | Overview, Tasks and Files no more than 20% slower than before; board with 2,000 members under 2 seconds |

Targets for the first four rows are set after the pilot, because setting them now would be guesswork.

### 41.8 Monitoring and budgets

- **Sentry:** the existing alert, uptime check and job-failure report cover this, so nothing new is needed.
- **Scheduled jobs:** 416 of the 480 runs a day allowed by `inngest-budget.test.ts` are used, and this design adds no new job.
  - Due reminders stay in `org-due-soon`.
  - Term-end prompts and Today are worked out when the page opens.
  - Term-end notices use the existing admin digest.
  - Away acts when it's marked and when copies are made.
- **Inngest executions:** those runs already cost about 830 to 1,250 of the roughly 1,650 executions a day. Check the dashboard after each phase. The earlier 24-hour usage check also needs closing.
- **Costs to check before launch:** one announcement to a class of 40 is 40 emails, against a Resend limit not yet checked. At 5 GB of storage per organization, Supabase storage and Railway egress need a look too.

### 41.9 Must be done before opening it up

1. The 18-and-over wording in place (163).
2. The Privacy Policy section reviewed by a lawyer and published, plus `check:legal-readiness` (167).
3. Browser tests passing, plus the signed-in and two-browser checks.
4. Resend Pro and an Inngest plan bought at the points in 164 and 165.
5. The pilot finished with no privacy or data-loss bugs.
6. The landing section and teacher guide live (177).

### 41.10 Calls made

- **The 20% and 2-second speed limits** are my choice, and can change after the first measurements.
- **Nudge dismissed lives on the contribution entry** because the membership ends when someone leaves, and the nudge continues after that.
- **Term summary is placed in Settings,** with archiving. **Close-out list is placed on Overview,** with the term-end prompt.
- **Use again and Export progress ship with the Tasks and Members steps,** where their buttons live.

### 41.11 Left out on purpose

- **A dashboard for the measures:** one SQL file answers the same questions.
- **New Sentry alerts:** the existing one already emails on new and regressed errors.
- **Undoing migrations:** additions are harmless to leave, and undo scripts would be untested code.
- **Guessing why old memberships ended:** a wrong "Removed" on someone's record is worse than no reason.

## 42. The core workflow

Audited on 2 November 2026 by tracing one piece of work from start to finish through the code. Approved by the owner. Every problem here was checked by reading the code, not by running it.

**Coverage:**
- **Read fully:** the main assignment, member, sprint, workspace, document, settings, lifecycle and overview code.
- **Read in part:** sprint and task code, only the parts that touch organizations.
- **Only searched at first, now read (42.10):** every file in `src/components/organizations`, plus `org-files`, `org-updates`, `creation` and `detail`.
- **Workspace screens, third pass (42.11):** `SprintPlanning` and `DocTab` read fully; `WorkspaceDashboardClient` read for its tabs, access and organization parts.
- **Read for their organization parts only:** `TasksTab`, `TaskDetailPanel`, `UpdatesTab`, `FilesTabRoot`, `WorkspaceLayout`, `WorkspaceDocRail`, `SprintLifecycleModals` and `WorkspaceSettingsTab`.

### 42.1 The flow

| Stage | Who | What happens | Problems (42.2) |
|---|---|---|---|
| 1. Set up | Owner | Type, roles, join code | None found |
| 2. Plan | Owner, admin | Sprints, drafts, materials | 1, 3 |
| 3. Publish | Admin | Copies go to people, teams or workspaces | 1, 7, 10 |
| 4. Work | Member, lead | Steps, files, group work | 5, 10 |
| 5. Hand in | Member, lead | Submit, with a record of what was sent | 8, 9 |
| 6. Review | Admin | Approve or Return | 2, 8, 9 |
| 7. Close a sprint | Admin | Next sprint starts | 3, 4 |
| 8. Close the term | Owner | Verify, archive, duplicate | 6, and smaller bug 7 |

### 42.2 What the code showed

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 1 | **Draft assignments are visible to students.** | A teacher's unpublished exam shows on the student's board and in This sprint, and Overview activity says "was assigned". Its attached files are readable too. | `orgTaskReadFilter`, `nb_task_visible`, `readOrgDashboardAction`, `readActivity`, `files/internal-helpers.ts:60` |
| 2 | **On-time work gets marked Late.** | Late is measured from the approval time, so work handed in on time and reviewed after the due date shows Late, including on the Export. | `copyState`, `assignment-rules.ts` |
| 3 | **Back-to-back sprints can't start by themselves.** | CO2 starts the day CO1 ends, CO1 can't be closed until that day is over, and only one sprint can be active. | `buildSprintSeries`, `isSprintReadyToClose`, `startSprint` |
| 4 | **"Move unfinished work" moves every assignment.** | Nothing marks a main assignment finished, so a completed lab counts as unfinished and leaves its sprint. The summary then shows no assignments. | `completeSprintAction` |
| 5 | **Group work doesn't follow a new lead.** | After a transfer or handover, the old lead can still submit and the new lead can't. | `transferWorkspaceOwnership`, `makeOwner` |
| 6 | **Detaching erases the teacher's record.** | All group copies unlink, including handed-in and approved ones, so they vanish from the roster. The roster's "Detached" label can never appear. | `releaseGroupCopies` |
| 7 | **A workspace that moves in gets no group work.** | New workspaces receive open group assignments; moved-in ones don't. | `moveIntoOrg` |
| 8 | **Return can be a dead end.** | Work returned past due with late work off, or on a closed assignment, can't be resubmitted. | `canStillSubmit` |
| 9 | **Compare versions has nothing to compare.** | Each submission overwrites the last, and attached files aren't frozen. | `submitAssignmentAction` |
| 10 | **Materials may not reach the student.** | Copies get the title, instructions and steps. No code was found that gives them attached files, and hiding the main assignment would cut off the current route. | `createCopies` |

**Smaller bugs:**

1. Sprint rows count excused people in the total; the Tasks tab doesn't.
2. Overdue emails still go out when Reminders is Off.
3. A non-lead leaving a team can create a second team lead.
4. Excused work stays in the review queue.
5. "You completed 3 of 3" counts work still waiting for review.
6. If something fails after saving, publishing can report failure, and a retry makes a second assignment with a second set of copies.
7. Duplicate drops sprint materials and files attached to assignments.
8. The sidebar runs the full attention query, plus document reads for members, for every organization on each load. This was read in the code, not measured.

**Notice links:** checked in 42.10. `?tab=projects` works; `?tab=assignments` doesn't.

### 42.3 One lifecycle for each thing

| Thing | States | Rules |
|---|---|---|
| **Assignment** | Draft → Scheduled → Open → Closed, and Closed can reopen | Only Open and Closed are visible to members. Delete only if nothing was handed in. |
| **Copy** | Not started → In progress → Submitted → Returned or Completed | Missing is worked out from the date. Excused sits on top of any state. |
| **Sprint** | Upcoming → Active → Completed | Only one is active. Unfinished work means tasks; assignments stay in their sprint. |
| **Group work** | Follows the workspace | Held by whoever leads the workspace, whichever way the lead changed. |

### 42.4 Three shared rules in the code

| Rule | Used by | Fixes |
|---|---|---|
| **Who can see an assignment** | Board, task panel, Overview, sprint timeline, activity, files and the database rule | Problem 1 |
| **When something was handed in:** the submission time | Roster, My work, Export, Members | Problem 2 |
| **When a lead changes** | Transfer, handover and Assign | Problem 5 |

### 42.5 Enhancements

| Enhancement | Design | Storage |
|---|---|---|
| **Publish timing** | Publish now, When the sprint starts, On a date, or Save as draft, so a teacher can plan a term once. Today warns about a draft in a sprint starting soon. | In the assignment's settings; uses the existing hourly sprint job |
| **Fix by date on Return** | Return asks for a reason and a date, 3 days by default. That person can resubmit until then, even past the due date. Close warns "3 returned people can't resubmit". | The copy's own due date |
| **Submission record** | Each hand-in saves its link or text and file versions, then locks them. Files change only by resubmitting. This makes Compare versions real. | One small table |
| **Materials on the assignment** | The form gets a Materials field, and the copy shows the main assignment's files, read only. Admins-only folders stay hidden. | None |
| **Plan your sprint brings group work** | Creating a linked sprint offers to pull in the workspace's group copies from its backlog. | None |
| **Detached work stays on record** | Handed-in copies stay on the roster as "Team Falcon · Detached". Only unsubmitted work is released. | None |

### 42.6 Sprint handover

When the next sprint's start time arrives and the current sprint's end date has passed:

1. The current sprint completes by itself.
2. Unfinished work stays where it is, so nothing moves.
3. The next sprint starts.
4. Admins get the summary.

A series ends each sprint the day before the next starts, so an active CO1 is over when CO2 is due. Sprints that aren't back to back still close by hand. This runs in the existing hourly sprint job.

### 42.7 How this gets built

| Build step | What goes in |
|---|---|
| 1a Privacy | Problem 1, including the database rule |
| 1b Correct work | Problems 2, 4, 5, 6, 7 and smaller bugs 1, 3, 4, 5, 6 |
| 1c Notices | Smaller bug 2 |
| Sprints step | Problem 3 with sprint handover, Plan your sprint bringing group work, sprint materials on Duplicate |
| Tasks step | Publish timing, Fix by date, submission record, materials |
| Settings step | Files attached to assignments on Duplicate |
| Final pass | Smaller bug 8 |

### 42.8 Calls made

- **Sprint handover changes "Never automatic".** The owner approved this on 2 November 2026. Nothing moves, which was the original reason for closing by hand.
- **3 days for Fix by** is my default. It can be changed each time.
- **Materials are read through to the main assignment, not copied,** so a corrected file reaches everyone.

### 42.9 Left out on purpose

- **Grades and rubrics:** nobody has asked for them, and this report doesn't design them.
- **Automatic close for sprints with no successor:** nothing is waiting on them.
- **Full version history of steps and comments:** the submission is what gets reviewed.

### 42.10 Second pass: the screens

Read on 2 November 2026: all 27 files in `src/components/organizations`, plus `org-files`, `org-updates`, `creation` and `detail`. Approved by the owner to add. As before, this comes from reading the code, not running it.

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 11 | **Assignment links open the wrong page.** `?tab=assignments` isn't a tab, so it falls back to Overview, or About for visitors. `copy` and `view` are never read. | "Open assignment", "Open my work" and "Open review queue" in emails and notices, assignment search results, and the New assignment quick action don't reach that work. | `org-templates.ts`, `assignment-notify.ts`, `org-digests.ts`, `org-workspace.ts`, `resolveAllowedWorkspaceTab` |
| 12 | **Transfer can dead-end.** It needs an identity check from the last 5 minutes, and neither transfer screen offers one. | Unless they just confirmed their identity somewhere else, the owner or lead only sees "Re-authenticate to transfer workspace ownership" with no way to do it. | `transferWorkspaceOwnership`, `OrgDangerZone`, `WorkspaceSettingsTab` |
| 13 | **"Allowed until a date" works without a date.** Education defaults to it, and the form doesn't require the date. | Saved with no date, late work is silently refused, while the setting says it's allowed. | `AssignmentComposer`, `canStillSubmit` |
| 14 | **Students don't see their extended date.** My assignments and This sprint show the main assignment's date. | Someone given an extension still sees the old date there. | `listAssignmentsAction`, `readOrgDashboardAction` |
| 15 | **Saved people and workspaces go stale.** Publishing a draft assigned to someone who has left stops with a general error. Duplicate keeps the old organization's people, teams and workspaces. | Duplicated "Selected people", "Teams" and "Selected workspaces" assignments can't be published in the new term. | `resolveRecipients`, `duplicateOrg` |
| 16 | **Admins-only files can leak by name.** Sprint materials skip the folder access check on this list, and the picker doesn't warn. | Members can see a name such as "Exam answers.pdf" in the sprint, though they can't open the file. | `readSprintMaterials`, `MaterialPicker` |
| 17 | **Team tasks don't follow team moves.** Moving someone between teams leaves them on the old team's open tasks. | The person keeps the old team's work and doesn't get the new team's. | `moveMemberToUnitAction`, `createTeamTasksAction` |
| 18 | **Moving a main assignment to another sprint leaves its copies behind.** | Copies keep the old sprint, so the sprint's rows and each person's view disagree. | `updateTaskFieldAction` |

**Smaller bugs:**

9. Ticked people stay selected when the Members filter changes, so Remove can include people no longer on screen.
10. Final files from workspaces show the raw word "rejected", and files on work not handed in yet say "Handed in".
11. ~~Term end can be before term start.~~ Checked in 42.17: the database refuses it, and Settings says "the term must end after it starts".
12. Returned work shows as "Returned for changes" in some places, against the shipped word "Returned".

**Design:**

| Fix | Design |
|---|---|
| **Links** | One helper builds every assignment link: `?tab=tasks&drawerType=task&drawerId=<copy>`. A person's own copy opens for them, and the review queue opens with the In review filter. Old `tab=assignments` links redirect to Tasks, because sent emails can't be changed. |
| **Transfer** | When the check is needed, the same identity dialog used by account deletion opens in place, then the transfer continues. |
| **Late date** | The date is required for "Allowed until a date" and starts at 7 days after the due date. Existing assignments with no date show "Late work closed" until an admin sets one. |
| **Extended date** | Everyone sees their own copy's date everywhere, with "Extended" beside it. |
| **Stale people** | Publish says "2 people have left. Publish to the other 38?" Duplicate resets drafts: Selected people and Teams become Everyone, and Selected workspaces becomes Each workspace, with a note on each draft. |
| **Admins-only materials** | The picker warns "Members can't open this. Move it first, or add it anyway." Members don't see those names. |
| **Team moves** | The move asks "Also move them on 2 open team tasks?", on by default. Handed-in tasks stay as they are. |
| **Moving an assignment's sprint** | The main assignment and its copies move together. |

**Build steps:**

| Build step | What goes in |
|---|---|
| 1a Privacy | Hiding Admins-only material names |
| 1b Correct work | Problems 11, 12, 13, 14, 15, 18 and smaller bugs 9, 10, 11 |
| Sprints step | The material picker warning |
| Workspaces and Members step | Team moves |
| Step 1d Wording | Smaller bug 12 |

**Calls made:** the 7-day default is mine, and "Late work closed" shows what actually happens today rather than guessing a date for existing assignments.

### 42.11 Third pass: the workspace screens

Read on 2 November 2026. Coverage is at the top of this section. As before, this comes from reading the code, not running it.

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 19 | **Organization admins can't act on a workspace's tasks.** The permissions table and 17 give them full access, and their Sprints tab works. On Tasks, New task and Team task are hidden, and the server refuses changes to normal tasks unless they're on the team. | A TA helping a team can read its board but can't add or move anything, while the same TA can run its sprints. | `WorkspaceDashboardClient.tsx:572`, `lockTaskForWrite`, `permissions.ts` `create_move_tasks` |

**Checked and fine:**

- **Org admins and the Members tab:** they can open it. Only the first render uses `isOwner`; the page corrects it straight away, so this risk is closed.
- **Chat assignment cards:** these already link correctly with `?tab=tasks&drawerType=task&drawerId=`, so the fix for problem 11 reuses that form.
- **Completing a sprint:** the dialog starts on Keep, so problem 4 happens only when someone chooses to move work. It's still fixed.
- **Student file hand-in:** the upload rule allows a member's own copy.

**Smaller bugs:**

13. An admin opening `?tab=members` directly may briefly see Overview first.
14. Plan a series always suggests the name "Sprint", while the creation wizard suggests "CO" for Education.

**Design:** organization admins get the same task powers as a workspace admin: create, move, assign and Team task, with `Viewing as admin` shown. They still can't delete or rename the workspace, or remove its lead (17). This is my recommendation, because the permissions table, 17 and the Sprints tab already say so; the code comment saying admin tools stay with the team is the odd one out.

**Build steps:**

| Build step | What goes in |
|---|---|
| Tasks step | Problem 19 and the server rule behind it |
| Sprints step | Smaller bug 14 |
| Step 3 (Shared blocks) | Smaller bug 13, with the tab bar |

### 42.12 Fourth pass: the task panel and shared task code

Read on 2 November 2026: `task.ts` and `task-transition-service.ts` in full, plus the sprint timeline and summary queries, the task panel's review and delete paths, and the post and settings rules. As before, this comes from reading the code, not running it.

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 20 | **The board gets around deadlines.** Moving a file or no-submission copy to Done ignores the late rule, Closed and Excused. | A student can hand in after the assignment is closed. Nothing records who handed in or which version. | `transitionTaskTx` |
| 21 | **Approve in the task panel fails.** Submit doesn't save the check value that panel Approve needs. | The queue's Open link leads to a panel where Approve says "requirements, subtasks or files changed. Ask the assignee to resubmit", though nothing changed. Return there also takes the general task path rather than the assignment one. | `submitAssignmentAction`, `approveTaskReviewAction` |
| 22 | **Deleting a main assignment from the panel strands its copies.** The panel's Delete removes only that task and skips the handed-in rule. | Students keep copies they can no longer submit, and the teacher loses the roster and handed-in work. | `deleteTaskAction`, `TaskDetailPanel` |
| 23 | **Members can edit the main assignment.** Any member can change its title, instructions, due date and priority from the panel. | One student can rename everyone's Lab 3 at the source, and the change doesn't reach the copies. 19.3 named copies; this covers the main task too. | `updateTaskFieldAction`, `lockTaskForWrite` |
| 24 | **The sprint timeline has no visibility rule.** It lists everything linked to the sprint. | Draft assignments show to members. After "Move to next sprint", every student's copy appears there too, with names, to all members. | `readSprintTaskActivityPage` |
| 25 | **Organization sprint numbers are always wrong.** They count main assignments, which never finish. | A finished sprint can still show 0 completed. | `readSprintSummary` |
| 26 | **Leaving can delete handed-in work.** A Returned copy isn't protected, though it holds an earlier submission. | Someone who leaves or is removed after a Return loses that record, against "Submitted work stays". | `releaseCopiesOnLeave` |
| 27 | **Deleting an assignment tells nobody.** | It disappears from students' lists with no notice. | `deleteAssignmentAction` |
| 28 | **Any member can change steps on any task.** The step check only asks whether you're a member, not whose task it is. | With a task's ID, a student can tick, rename or delete steps on the main assignment or another student's copy. | `lockSubtaskWriteScope` |

**Checked and fine:**

- **Changing another student's copy status:** the transition refuses unless you're the assignee, on the team or a reviewer.
- **Announcements:** the server refuses them from non-admins, and audience, pin and comments-off apply only for admins.
- **Settings:** the server checks who may save each section.

**Smaller bugs:**

15. If two admins review at the same moment, the second writes an extra activity row and sends a second, possibly opposite, notice.
16. The server doesn't check that "late until" stays after a moved due date.
17. "Due date moved" notices also reach people who have finished. "Move due dates too" updates in separate steps, and a failure is only logged, so some dates can move and others not.
18. Extend on a closed assignment changes the date but doesn't let them submit, with no warning.

**Design:**

| Fix | Design |
|---|---|
| **Handing in** | Moving a copy to Completed opens Submit. Only Submit hands in, so it always checks the late rule, Closed and Excused, and records who and which version. |
| **Reviewing** | Queue, roster and panel call one action, with the same checks and notices. |
| **Deleting** | The panel's Delete on a main assignment uses the assignment rule: blocked once anything is handed in, with Close offered instead. Otherwise the people who had it get "Lab 3 was removed". |
| **Editing** | The one server check in 19.3 covers the main assignment and steps too: only admins change the main assignment, and changes reach copies as in 23.3; a step on a copy changes only for its assignee or team. |
| **Timeline** | It uses the shared visibility rule. |
| **Sprint numbers** | "18 of 30 done" comes from copies, for assignments. |
| **Leaving** | Any copy with a submission stays. |
| **Reviewing together** | The second admin gets "Already reviewed by Priya", with no extra row or notice. |
| **Dates** | Late until is checked on the server. Notices skip finished people, and shifts run in one transaction. Extend on a closed assignment asks "Reopen it for Asha?". |

**Build steps:**

| Build step | What goes in |
|---|---|
| 1a Privacy | Problems 24 and 28 |
| 1b Correct work | Problems 20, 21, 22, 23, 25, 26 and smaller bugs 15, 16, 17 |
| 1c Notices | Problem 27 |
| Tasks step | Smaller bug 18 |

### 42.13 Tasks: one assignment through every state and role

Read on 2 November 2026: `TasksTab` in full; the first part of `DetailsTab` and its status and sprint controls; the permission points in `FilesTab`, `SubtasksTab` and `KanbanBoard`; the live update rules. `CommentsTab` wasn't opened. As before, this comes from reading the code, not running it.

**New problems:**

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 29 | **Every Submit looks changed.** Submit doesn't save the check value, so the panel treats the work as altered. | Right after handing in, the panel says "This task changed after it was submitted. Submit it again". The teacher's Approve there is greyed out. This is what causes problem 21. | `getTaskReviewStateAction`, `DetailsTab` |
| 30 | **Live updates send every task's ID to every member.** Each task change goes to the organization's board topic with its ID, including other students' copies. | The ID-based problems (comment privacy, 28, attachments in 24) don't need a guessed ID; it can be collected from the live connection. One class handing in also makes everyone's board refresh. | `0034_live_row_events.sql`, `useRealtimeTasks` |
| 31 | **Admins can't put tasks in sprints.** The form, the panel and the server all allow only the owner, though admins run sprints. | A TA can create and start CO3 but can't put a task in it. This also affects normal workspaces. | `createTaskAction`, `updateTaskFieldAction`, `TasksTab.tsx:925`, `TaskDetailPanel.tsx:564` |
| 32 | **The owner can delete a student's copy from the panel.** No handed-in check or notice applies. | Handed-in work can vanish with one click, and the student isn't told. | `deleteTaskAction` |
| 33 | **The review count and filter disagree.** The Tasks badge and the queue include workspaces' group work, but the In review filter shows only the organization's own. | The badge says 6, and the filter shows 4. | `readOrgTabBadgesAction`, `tasks.ts:205` |
| 34 | **A main assignment's panel has live controls.** Status, Section and Assignee all work on it. | An admin can mark Lab 3 Completed while students are working, and the card stops matching reality. | `DetailsTab`, `transitionTaskTx` |

**Smaller bug 19:** the line above the board ("Marking work as done completes it immediately") follows the workspace setting, while each assignment has its own review setting.

**Checked and fine:** live updates carry only the action and the ID, not titles or names.

**Main assignment, what each person can do:**

| State | Owner, admin | Member | Viewer |
|---|---|---|---|
| **Draft** | Edit, Publish, Schedule, Delete | Hidden everywhere | Hidden everywhere |
| **Scheduled** | Edit, Publish now, Back to draft, Delete | Hidden everywhere | Hidden everywhere |
| **Open** | Roster, Remind, Edit (23.3), Add step, Close; Delete only if nothing is handed in | Their own copy only | Counts, no names |
| **Closed** | Roster, review what's waiting, Export, Reopen | Their own copy, read only | Counts, no names |

**Copy, what each person can do:**

| State | Assignee or teammate | Owner, admin |
|---|---|---|
| **Not started** | Tick steps, add files, comment, Submit | Extend, Excuse, Remind |
| **In progress** | Same, plus Blocked | Same |
| **Submitted** | Read what was sent; Replace submission until it's reviewed | Approve, Return with reason and Fix by; Excuse clears it from the queue |
| **Returned** | See the reason and Fix by; Submit again | Extend, Excuse, Remind |
| **Completed, reviewed** | Read and download only | Return with a reason while Open (23.2) |
| **Completed, no review** | Replace until the due date | Excuse |
| **Missing** | Submit if late work is allowed; otherwise see who to ask | Extend, Excuse, Remind |
| **Excused** | See the reason; nothing required | Un-excuse |
| **Assignment closed** | Read only, unless Fix by or Reopen applies | Reopen, or reopen for one person |

**Never available on a copy:** changing title, instructions, due date, sprint or hand-in type for members; deleting; moving it to Completed without Submit. Workspace group copies follow the same table, with the organization's admins reviewing.

**Design:**

| Fix | Design |
|---|---|
| **Problem 29** | Goes away with one review path (141) and the submission record: the panel compares against the saved version. |
| **Live updates** | The organization's board topic gets only main assignment changes. A copy's change goes to its people and to admins, with no change for normal workspaces. |
| **Sprints** | Owners and admins can put tasks in sprints. |
| **Deleting a copy** | Removed. Excuse replaces it. |
| **Review count** | The In review filter, badge and queue all read the same list, including group work. |
| **Main assignment panel** | Shows its state and counts from copies, with no Status, Section or Assignee. |
| **Line above the board** | Hidden on organizations; the Hand in section says what happens for that assignment. |

**Build steps:**

| Build step | What goes in |
|---|---|
| 1a Privacy | Problem 30 |
| 1b Correct work | Problems 29, 31, 32, 34 |
| Tasks step | Problem 33, smaller bug 19, and both tables above |

### 42.14 Tasks: remaining rules

Read on 2 November 2026: `TaskDetailPanel` and the discussion part of `task-comment.ts`; the file link, reassign and refresh rules; and the permission points in `CommentsTab`. As before, this comes from reading the code, not running it.

**The three questions from 42.13, answered:**

| Question | Answer |
|---|---|
| Can a student reassign their own copy? | **Yes.** Members have `assign_tasks`, and nothing checks whose task it is. See problem 37. |
| Can handed-in files be removed? | **Yes, by an admin.** Members are refused, because this path doesn't say which copy it's for. See problems 38 and 39. |
| How much does one assignment make boards refresh? | **Every task change refreshes every open board,** batched per 250 ms. Publishing to 2,000 people sends 2,000 live events. The fix in 42.13 removes both. |

**New problems:**

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 35 | **Group work won't open from the review queue.** Open looks for the task in the organization, but a group copy lives in the workspace. | The teacher gets "Couldn't open the requested task". | `ReviewQueue`, `getWorkspaceTaskDetailAction` |
| 36 | **Organization admins can't review group work in its panel.** In a workspace they aren't on, Comments and Files say "visible to workspace members", and Approve and Return don't show. | The reviewer named for group work can't see what was handed in there, or talk privately with the group. | `TaskDetailPanel.tsx:140`, `DetailsTab.tsx:129`, `assertTaskAccess` |
| 37 | **Any member can reassign any task.** It only checks that you may assign tasks. | A student can give their copy to someone else, or take over the main assignment. | `assignTaskAction` |
| 38 | **Handed-in files aren't locked.** Removing a link doesn't check whether the work was handed in or approved, and an admin can do it. | Files can change after review, so what's approved may not be what was submitted. | `unlinkNodeFromTask` |
| 39 | **Students can't remove a wrong file from their own copy.** The remove path doesn't pass which copy it's for, so the organization rule refuses it. | A student who attaches the wrong file gets an error and can't take it off before submitting. | `unlinkNodeFromTask`, `assertOrgWrite` |

**Checked and fine:**

- **Comment mentions:** 23.5 already limits these to people who can see the conversation. The code doesn't yet, so it's part of the comment privacy fix.
- **Comment content in live updates:** those events carry IDs and times, not text.

**Design:**

| Fix | Design |
|---|---|
| **Opening group work** | The shared link helper (133) uses the copy's own workspace. |
| **Reviewing group work** | Organization admins get Comments, Files, Approve and Return on group copies, without joining the workspace. `lockTaskForWrite` already treats them as reviewers, so read access and the screen follow it. |
| **Reassigning** | Only admins and a team's lead, within that team. An individual copy has no reassign control. The main assignment has none (147). |
| **File lock** | Before Submit, the assignee or team can add and remove files on their own copy. On Submit, the files lock with that version (127). Replace submission is the only way to change them, until reviewed. Approved files never change. |

**Build steps:**

| Build step | What goes in |
|---|---|
| 1a Privacy | Problem 37 |
| 1b Correct work | Problems 35, 36, 38, 39 |

### 42.15 Updates

Read on 2 November 2026: the post, edit, delete, pin, like, comment and reply-setting actions and the access rule in `actions/workspace/updates.ts`; the audience, notice and email-limit code; the Updates screen's posting path; and the composer's defaults. The draft, media and mention parts weren't read line by line. As before, this comes from reading the code, not running it.

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 40 | **Posts default to Public.** The composer starts on Public, and the organization options don't change it. | In a public organization, every announcement and every student's discussion is public by default, unless someone notices. 7.5 says the default is Members. | `WorkspaceUpdateComposer.tsx:174`, `createWorkspaceUpdateAction` |
| 41 | **Followers get the text of limited announcements.** Any Public post 80 characters or longer notifies followers, with an excerpt, whatever its audience. | An announcement meant only for admins or one role reaches people outside the organization by notice. | `createWorkspaceUpdateAction`, `shouldNotifyWorkspaceUpdateFollowers` |
| 42 | **Shared-up posts are mostly read only for the organization.** Likes and comments go to the workspace, which accepts only its own team unless the post is Public. | The card offers Comment, but organization people get "This update isn't available". | `UpdateCard.tsx:68`, `assertReadableUpdate`, `toggleWorkspaceUpdateLikeAction` |
| 43 | **Viewers can comment and like.** Neither action checks the role. | Read-only Viewers post replies, against the permissions table. | `createWorkspaceUpdateCommentAction`, `toggleWorkspaceUpdateLikeAction` |
| 44 | **A failed post loses its audience.** The options reset before the result comes back, and drafts don't keep them. | Posting again after an error sends an Admins-only announcement to everyone. | `UpdatesTab.tsx:202`, `WorkspaceUpdateComposer` |
| 45 | **Members can turn their post into an announcement.** Edit takes any type, and create doesn't force members to Discussion. | A student's post shows as an Announcement, under that filter. | `editWorkspaceUpdateAction`, `resolveOrgPostOptions` |
| 46 | **Pin slots get stuck.** Pins on shared posts still count after the post is deleted or its workspace leaves. | The organization can end up unable to pin, with nothing visible to unpin. | `pinSharedInOrgFeed`, `deleteWorkspaceUpdateAction` |
| 47 | **Audience posts go missing in places.** Overview's pinned line and activity show members only posts for everyone. The sidebar dot ignores audience and lights up for your own posts. | A pinned notice for Students doesn't show on Students' Overview, while the dot lights for posts they can't open. | `readOrgDashboardAction`, `readActivity`, `readSidebarWorkspacesAction` |
| 48 | **Read-only isn't read only for posts.** The database guard covers only new rows, and the actions don't check. | In an archived or suspended organization, posts can still be edited, pinned and have their reply setting changed. | `0012_workspace_updates.sql`, update actions |
| 49 | **Likes skip the audience rule.** | With a post's ID, someone outside its audience can like it. | `toggleWorkspaceUpdateLikeAction` |

**Smaller bugs:**

20. Organization feeds still say "Progress posts for followers and workspace visitors", "Share the first progress post so followers…" and "Workspace update posted".
21. The daily email limit counts deleted posts and a rolling 24 hours, not the organization's day (28.3).
22. Someone removed from a public organization can still edit their old posts there.

**Checked and fine:**

- **Comments on audience posts:** comment reads and writes use the audience rule.
- **Removing someone's post:** it needs a reason, and the author is told.
- **Announcements:** only admins can post them.
- **Pins:** the limit of 3 applies.

**Design:**

| Fix | Design |
|---|---|
| **Default audience** | Organization posts start on Members. Public is an audience choice that says "Also on Discover", and the composer's Post button names the real reach. |
| **Followers** | Followers hear only about Public posts meant for everyone. |
| **Shared posts** | Likes and comments on a shared post follow the organization feed's rule, with its own reply setting. |
| **Viewers** | Read and see likes only. |
| **Audience on failure** | Options reset only after a post succeeds, and drafts keep them. |
| **Type** | The server sets it by role, on create and on edit. |
| **Pins** | Only live shared posts count, and deleting or detaching removes their pins. |
| **One audience rule** | The feed, Overview, the sidebar dot, likes and comments use the same rule (`audienceSql`). The dot skips your own posts. |
| **Read only** | The database guard covers updates too, and the actions say "This organization is read-only". The composer hides. |
| **Wording** | Organization feeds say "Announcements and discussions for CSE 3B", with matching empty states and messages. |

**Build steps:**

| Build step | What goes in |
|---|---|
| 1a Privacy | Problems 40, 41, 44, 49 |
| 1b Correct work | Problems 42, 43, 45, 46, 47, 48 and smaller bug 22 |
| 1d Wording | Smaller bug 20 |
| Updates step | Smaller bug 21 and the composer design in 7.5 |

### 42.16 Files

Read on 2 November 2026: the organization file rule and the write checks in `internal-helpers.ts`; the access check on every file action in `actions/files`; the preview, export and submissions routes; the code editor's file routes; and the storage admission check. The Files screen and the internals of trash, versions and collections weren't read line by line. As before, this comes from reading the code, not running it.

**What's right:** every read path checked applies the organization rule: listing, metadata, breadcrumbs, path lookup, text, preview, versions, task file groups, export, and the editor's file, search, content search, folder and comment routes. Admins-only folders and other people's copies stay hidden from members, and visitors see only what sits under Public. Download history is admins only, and Download all is organization admins only.

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 50 | **Hand-ins count against the organization's 5 GB.** Copies live in the organization, so every submission and version uses its storage. | When the organization is full, students can't hand in, and the teacher can't upload either, right when work is due. A 2,000-member organization fills quickly. | `upload-intents.ts:433` |
| 51 | **Students can't manage files on their own copy.** Only adding a file passes which copy it's for. Rename, Trash, saving a new version and editor saves are refused for members. | A student can add a file but can't fix a wrong name, remove it or upload a better version. Problem 39 is one case of this. | `renameNode`, `bulkTrashNodes`, `applyUploadedFileRevision`, `_file-revision.ts`, `unlinkNodeFromTask` |

**Smaller bug 23 (withdrawn in 44.3):** ~~an opened preview link keeps working after someone loses access.~~ The preview route checks access on every request and streams the file itself, so access ends at once. A download hands out a storage link that lasts 60 seconds (`download-link.ts`), which is fine.

**Already in the report:** members locking organization files from the editor (24.1 #3).

**Design:**

| Fix | Design |
|---|---|
| **Hand-in storage** | Submissions and their versions count in a separate allowance, 50 MB per person, not against the organization's 5 GB. Upload is still blocked at the 10 MB file limit. At 80% of the organization's storage, admins see the Storage section's warning; hand-ins carry on. |
| **Own copy files** | Every file action passes the copy it's for, so the assignee or team can rename, remove and replace files on their own copy until Submit. After Submit the lock in 151 applies. |

**Build steps:**

| Build step | What goes in |
|---|---|
| 1b Correct work | Problems 50, 51 |
| Files step | The Files screen design (7.8, 37.5) |

**Calls made:** the 50 MB per-person allowance is my default. It's enough for a term of lab reports and screenshots, and it can be raised in `ORG_LIMITS` when real classes need more.

### 42.17 Settings

Read on 2 November 2026: how `WorkspaceSettingsTab` picks sections by role, for organizations and workspaces inside them; the organization sections; the server checks behind each organization save; and the member, role and visibility actions the shared sections call. Section 22 already designs Settings field by field, and its findings 22.1 #1–10 still stand. As before, this comes from reading the code, not running it.

| # | Problem | What happens to people | Where |
|---|---|---|---|
| 52 | **Settings' second Members list skips organization rules.** 22.1 #7 already removes it. Until then, Remove there calls the plain workspace action. | Someone removed there stays in the organization's workspaces and keeps their unfinished copies, and they're told "removed you from a workspace". A role change there doesn't touch copies. | `WorkspaceSettingsTab.tsx:1513`, `removeWorkspaceMemberAction`, `updateWorkspaceMemberRoleAction` |
| 53 | **Organization admins can't manage a workspace's teams from its Settings.** They see only the Organization section, though the server lets them manage teams and seats. | A TA can't fix a full team or pick a team lead for a team they look after. | `WorkspaceSettingsTab.tsx:231`, `child-units.ts` |

**Checked and fine:**

- **Who saves what:** each organization section checks the role on the server, and role names are owner only. Type is the exception, already in 22.1 #1.
- **Term dates:** the database refuses an end before the start, so smaller bug 11 is withdrawn.
- **Tightening visibility:** tightening the cap lowers workspaces above it straight away, and their leads are told.
- **Danger zone:** organizations get their own danger zone, not the workspace one.
- **Blocking:** removing and blocking in Settings uses the organization's own block, so the join code stops working for them too.

**Smaller bug 24:** Max members can be saved below the current count with no warning, which closes joining at once. Section 22 already designs the fix ("can't go below that"); the server needs to enforce it too.

**Design:**

| Fix | Design |
|---|---|
| **Second Members list** | Removed from organizations in deploy 1b. The Members tab is the one place, as 22.1 #7 says. |
| **Org admins in a workspace** | Settings shows Organization, then Members and teams, with `Viewing as admin`. They can't delete or rename the workspace, or remove its lead. |
| **Max members** | As section 22: it can't go below the current count, and the server refuses it too. |

**Build steps:**

| Build step | What goes in |
|---|---|
| 1b Correct work | Problem 52 |
| Workspaces and Members step | Problem 53 |
| Settings step | Smaller bug 24 and section 22 |

### 42.18 Normal workspaces

Checked on 2 November 2026: every change in sections 42.2 to 42.17 that touches shared code, against the code paths normal workspaces use, and the tests that protect them. 41.6 is rewritten from this.

**What the check found:**

| # | Finding | Fix |
|---|---|---|
| 1 | **Sprint handover (122) wasn't scoped.** The sprint schedule job is shared, so it would also have closed normal workspaces' sprints by itself. | Organization sprints only (122 updated) |
| 2 | **The self-review block (95) wasn't scoped.** A workspace admin reviewing their own task is allowed today. | Assignment copies only (95 updated) |
| 3 | **Transfer dead-ends in normal workspaces too (problem 12).** | Already fixed by 134; now listed as a change people will notice |
| 4 | **Normal workspace sprints have no database tests.** Only organization sprints do (`organizations-sprints.test.ts`, `organizations-sprint-pass.test.ts`); normal sprints have unit tests only (`sprint-permissions`, `sprint-validation` and others). | Add one before the Sprints step: create, start, complete with each unfinished-work choice, cancel |
| 5 | **Normal review is covered only by a unit test** (`task-review-lifecycle-contract.test.ts`), with no database test to show it's unchanged when copies get one path. | Add a database test in the Tasks step |

**Rule:** every organization fix is scoped to organizations, their workspaces or assignment copies, unless 41.6 lists it as shared on purpose. A shared change ships with a normal workspace test.

**Not checked:** how normal workspaces look after the tab steps unify the screens. That's checked per step, with screenshots of a normal workspace before and after.

## 43. Open risks

Written on 2 November 2026. Everything here stays open until it's built or checked. Nothing gets built until the owner is satisfied with this report and says "implement".

| # | Risk | What it means | Closed by |
|---|---|---|---|
| 1 | **Live privacy bugs** | Probably live now: students can see draft assignments and their files, comments may be readable on other students' copies, suspension reasons may show to everyone, and admins see account-wide last active times. Read in the code, not tried on the live site. | Deploy 1a (41.3) |
| 2 | **Live correct-work bugs** | Probably live now: on-time work marked Late, assignments leaving a closed sprint, group work stuck with an old lead, detached work leaving the roster, and others in 41.3 and 42.2. | Deploy 1b |
| 3 | **Some workspace screens read only in part** | `TasksTab`, `TaskDetailPanel`, `UpdatesTab`, `FilesTabRoot`, `WorkspaceLayout`, `WorkspaceDocRail`, `SprintLifecycleModals` and `WorkspaceSettingsTab` were read for their organization parts, not every line. Behavior they share with normal workspaces wasn't audited. | Each tab step reads its own screens first |
| 4 | **Nothing here was run** | Every problem comes from reading code. Some may behave differently when run. | A test for each fix |
| 5 | **Mockups not seen rendered** | Text may overflow or sit badly, and only Overview and phone Today have dark versions. | Checks in each tab step |
| 6 | **Live organization count unknown** | A read-only production query was denied, so how many real classes a deploy would touch is unknown. | The owner runs the query in 44.4; until then deploys assume real classes (166) |
| 7 | **Normal workspaces** | 41.6 comes from build lists, and not every shared function was traced. Unified tabs are the highest risk. | Workspace tests in each tab step |
| 8 | **Age and school classes** | Terms say 18+, but Education organizations could be used by school classes (29.5). | Decided: 18 and over (163) |
| 9 | **Privacy Policy** | The new section needs a lawyer's review (41.9). | Drafted in 1d, reviewed before opening up (167) |
| 10 | **Email limit** | One announcement to a class of 40 is 40 emails; the free plan sends 100 a day (44.2). | Resend Pro before a second class (164) |
| 11 | **Storage and egress costs** | At 5 GB per organization, Supabase storage and Railway egress were checked: a few dollars a month (44.2). | Closed |
| 12 | **Inngest budget** | Scheduled jobs already use about 830 to 1,250 of roughly 1,650 executions a day, and the earlier 24-hour check isn't closed. | Weekly check; paid plan before 5 classes (165) |
| 13 | **Size of the build** | The report runs to 45 sections and 177 decisions, and step 13 is large. Later steps may need changes once earlier ones are real. | One short plan per step |

### 43.1 Everything still open

Every decision is now made (163 to 169). What's left can only be done by someone outside, or once things are built:

| Item | Who | When | Default meanwhile |
|---|---|---|---|
| Count real organizations with the query in 44.4 | Owner | Any time before deploy 1a | Assume real classes are running (166) |
| Review the drafted Privacy Policy section | Lawyer | After deploy 1d, before opening up | Section stays unpublished (167) |
| Buy Resend Pro, then an Inngest plan | Owner | Before a second class; before 5 active classes (164, 165) | Free plans, checked weekly |
| Each fix's test; screen, phone and dark checks | Build | Each step (44.5, 44.6) | Nothing ships without them |
| Read each shared screen's layout line by line | Build | First thing in each tab step (44.8) | Rules are already checked |
| Notification load, and the pilot | Build, then one class | After step 14 (168, 44.7) | Stop rules in 44.7 |

## 44. Open items, analyzed

Done on 2 November 2026 for every item in 43.1. Facts about outside services come from their public pricing pages and legal commentary as of November 2026, and should be checked again when buying a plan.

### 44.1 Age and school classes

**Today:** the Terms (`/terms`, section 2) and signup ask people to confirm they're at least 18 (`SignupForm.tsx:488`, `legal/accept`). Nothing else checks age.

**The law:** India's Digital Personal Data Protection Act treats everyone under 18 as a child. Its Rules, notified in November 2025, require verifiable consent from a parent or guardian before processing a child's data, and forbid tracking and behavioural monitoring of children. Schools have an exemption for their own educational activities, but commentators disagree on whether it covers a platform like NetworkBase. That needs a lawyer.

| | **A. Keep 18+ for launch** (recommended) | **B. Allow school classes** |
|---|---|---|
| Who can join | Adults only, as today | Under-18s in Education organizations a school creates |
| What changes | The Education card says "A college or university class". The join page and invite email say "You must be 18 or older to join". A Report option "This person may be under 18" goes to the team in 29.2. | An age question at signup; a parent consent flow with the parent's identity checked; a school agreement making the school responsible for its data |
| What must be off for children | Nothing new | Presence, Last active and activity timelines; public profiles, Discover and public contributions; messages from people outside the organization |
| Build size | Small, in the 1d wording deploy | Several steps of its own, after launch |
| Legal | Privacy Policy section only | Lawyer's review of consent, the school agreement and the exemption |

**Decided (163):** A for launch. B is its own project if schools ask for it.

### 44.2 Email, storage, egress and background jobs

**Email (Resend):** the free plan sends 100 a day and 3,000 a month. Pro is $20 a month for 50,000. ([Resend pricing](https://resend.com/pricing.md), [free tier](https://resend.com/blog/new-free-tier.md))

| Size | Emails in a normal week | Fits the free plan? |
|---|---|---|
| One class of 40 | About 150: published 40, due tomorrow 40, overdue and returned about 10, admin digests 14, one emailed announcement 40 | Only alone. Two classes publishing on the same day pass 100 |
| An organization of 2,000 | One publish is 2,000 emails, about 24,000 a month | No; Pro needed |

When Resend refuses with "too many", the outbox waits and retries (`delivery.ts:389`), so mail arrives late, not lost. **Decided (164):** the one-class pilot runs on the free plan; Pro is bought before a second class or any organization over 60 people. The measures SQL counts emails waiting more than an hour.

**Storage (Supabase):** Pro includes 100 GB of file storage, then $0.021 per GB a month. ([Supabase pricing](https://www.activepieces.com/blog/supabase-pricing-free-tier-limits-pro-costs-egress.md)) A class of 40 handing in 12 labs of 5 MB uses about 2.4 GB a term. The worst case for a 2,000-member organization at the 50 MB hand-in allowance (157) is 100 GB, about $2 a month beyond what's included. Storage cost isn't a risk.

**Egress:** file previews and downloads stream through the app (`preview/route.ts:195`), so each file byte is paid twice: Supabase egress (250 GB included, then $0.09 per GB) and Railway egress (about $0.05 per GB). ([Railway pricing](https://docs.railway.com/reference/pricing/plans)) A class's term is a few GB. A large organization downloading all submissions each week could reach tens of GB a month, a few dollars. The bigger egress risk is still the cover image and image route in `project_railway_egress`.

**Background jobs (Inngest):** the free plan allows 50,000 executions a month, about 1,650 a day. Scheduled jobs already use about 830 to 1,250. Notices are batched five at a time (`notification-fanout.ts:37`). One active class adds roughly 30 to 60 executions a day from submissions, reviews and reminders, so the free plan holds about 10 active classes. **Decided (165):** checked weekly during the pilot; a paid plan before more than 5 classes are active.

These are estimates from the code and published prices, not measured bills.

### 44.3 Measured on a test database

Run on 2 November 2026 with `tests/db/organizations-scale.test.ts` against a throwaway local database built from every migration, with 2,000 members and 20 workspaces. Production wasn't touched.

| Action | Time |
|---|---|
| Publishing to everyone (1,999 copies) | 4.7 seconds |
| Members tab | 89 ms |
| Overview | 105 ms |
| About | 5 ms |
| Workspaces tab | 8 ms |
| Assignments list | 27 ms |
| Assignment roster | 31 ms |
| To review | 7 ms |
| Sidebar, as a member | 14 ms |
| My work, as a member | 9 ms |

**What it means:**

- **Reads stay fast at the limit.**
- **Publishing doesn't need a background job.** It does need a progress state: "Publishing to 1,999 people…", with the button disabled. That's added to the Tasks step.
- **Not measured:** notifications and emails, because their network calls can't run locally; and live refresh load. The scale test will also count the notices and emails one publish writes, and the pilot reads the real cost from the dashboards (168).

**Withdrawn:** smaller bug 23. The preview route (`workspaces/[id]/files/[nodeId]/preview/route.ts:79–115`) checks access on every request and keeps the storage link on the server, so a removed person loses access at once. Downloads get a 60-second link.

### 44.4 How many real organizations are live

My read-only query on production was refused, as it should be without your say-so. To find out, run this yourself in the Supabase SQL editor. It only reads.

```sql
SELECT count(*) FILTER (WHERE kind = 'organization' AND deleted_at IS NULL) AS live_orgs,
       count(*) FILTER (WHERE parent_id IS NOT NULL AND deleted_at IS NULL) AS workspaces_in_orgs,
       (SELECT count(*) FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE w.kind = 'organization' AND w.deleted_at IS NULL) AS org_members,
       (SELECT count(*) FROM tasks WHERE assignment_id IS NOT NULL AND deleted_at IS NULL) AS copies
FROM workspaces;
```

| Result | What it changes |
|---|---|
| Not run yet | Treated as real classes running (166) |
| Only test organizations | Deploy as planned; no temporary switch (113) |
| Real classes running | The Tasks step gets its one temporary switch, and deploys 1a to 1c send each organization's owner a notice of what changed |

### 44.5 Test plan

Every problem gets one test that fails before its fix and passes after. They go in the existing files.

| Deploy | Problems | Test file | What the test proves |
|---|---|---|---|
| 1a | 1, 24, 30 | `organizations-assignments.test.ts`, `live-row-events.test.ts` | A member can't list, open or see in a timeline, Overview, activity or files a draft or another person's copy; copy changes don't reach the organization topic |
| 1a | 16, 28, 37 | `organizations-files.test.ts`, `workspace-tasks-actions.test.ts` | Admins-only material names stay hidden; members can't change steps on, or reassign, others' tasks |
| 1a | 40, 41, 44, 49 | `organizations-updates.test.ts` | Posts default to Members; followers get nothing from limited posts; likes follow the audience; a failed post keeps its audience (unit) |
| 1b | 2, 20, 21, 22, 23, 29, 32, 34, 35, 36 | `organizations-assignments.test.ts` | Late is from the submission time; the board can't hand in; one review path works from the panel; deleting follows the assignment rule; members can't edit the main assignment; group work opens and can be reviewed |
| 1b | 3, 4, 25 | `organizations-sprints.test.ts` | Series hand over; assignments stay in their sprint; sprint numbers count copies |
| 1b | 5, 6, 7, 26 | `organizations-children.test.ts`, `organizations-members.test.ts` | Group work follows the lead and survives detaching; moved-in workspaces get group work; leaving keeps handed-in work |
| 1b | 8, 9, 13, 14, 15, 38, 39, 50, 51 | `organizations-assignments.test.ts`, `organizations-files.test.ts` | Fix by; submission record; late date required; own extended date shown; stale targets handled; files lock on Submit; own copy files can be fixed; hand-ins aren't blocked by storage |
| 1b | 11, 12, 31, 42–48, 52 | `organizations-notifications.test.ts`, `organizations-updates.test.ts`, `organizations-settings.test.ts` | Links open the work; transfer asks for identity; admins put tasks in sprints; shared posts, Viewers, post type, pins, audience places and read-only all behave; Settings' second Members list is gone |
| Normal workspaces | 42.18 | `workspace-tasks-actions.test.ts`, `workspace-updates-actions.test.ts`, new sprint and review database tests | Shared changes behave as 41.6 says |

Each test runs on the throwaway database (`scripts/db/disposable-db.sh`), as 44.3 did.

### 44.6 Screen, phone and dark checks

For every tab step, before it ships:

| Check | How |
|---|---|
| Phone width 375 | Screenshot of each state in the step's tables |
| Dark mode | Same screenshots in dark |
| Keyboard | Tab through every control; the focus ring shows (75) |
| `axe` | `tests/browser/axe.ts` on the tab, no serious issues |
| Normal workspace | Screenshot of the same tab in a normal workspace, before and after |
| Mockups | Compared with the matching board in section 40 |

### 44.7 The pilot

| Part | Plan |
|---|---|
| Who | One college class of 30 to 60, with a teacher who agrees to report problems |
| When | After step 14, for two weeks covering one full sprint and at least two assignments |
| Setup | The teacher creates the organization; students join by code; one assignment with review, one with teams |
| Support | A direct contact, and Sentry watched daily |
| Measured | 41.7, plus every bug, by severity |
| Stop at once | Any privacy problem or lost work: roll back (41.5) |
| Finish | No privacy or data-loss bugs, every serious bug fixed, and the teacher would keep using it. Then open it up. |

### 44.8 Code not read line by line

Every shared screen's rules are now checked: who can see, change, delete and review, in Tasks, Updates, Files and Settings (42.13 to 42.17). Mentions on audience posts are limited to admins, drafts belong to their author, and media uploads need posting rights; all were checked and are fine. What's unread is layout and small behavior in those screens. Each tab step reads its own screens first and adds anything it finds to this report.

## 45. Final completeness pass

Done on 2 November 2026. The report was checked against the code it hardly mentioned before: the VS Code extension's routes, account deletion, handover after an owner leaves, uploads, and the public site. The extension's read and search routes already hide Admins-only folders and other people's copies (`visibleFileNodesSql`). Four real gaps and four additions came out of it.

### 45.1 What the code showed

| # | Finding | Effect |
|---|---|---|
| 1 | Succession (`succession.ts`) runs only when an account is deleted or banned. No staff tool or admin path calls it. | 33.7 was wrong: if an owner stops logging in, admins can't add admins, archive or hand over. |
| 2 | Late is measured from Submit, which follows the upload. A failed upload starts again from zero after up to 4 tries (`supabase-signed-upload-client.ts:184`). | A large hand-in on a weak phone connection, started before the due time, is marked Late. |
| 3 | The editor's task push checks write access without naming its task (`extension/task-push`). | In an organization, members can't attach editor files to their own copy, against 158. In a child workspace, a teammate can attach files to group work already handed in, around 151. |
| 4 | A member's final account deletion removes their own copies, including handed-in work (`hard-delete.ts:96`). Nobody is told. | The roster changes silently. |
| 5 | No way to see a page as a member. | A teacher can't check what Admins-only folders, audiences and visibility actually hide. |
| 6 | Archive and Delete don't offer the records that already exist. | After 30 days, the term's submissions are gone. |
| 7 | The landing page (`(site)/page.tsx`) never mentions organizations or classes, and there's no help page. | A teacher can't find the feature. |

### 45.2 Ask to take over (gap 1)

| When | What happens |
|---|---|
| Owner active in the organization within 30 days | The option isn't shown. Uses Last active here (step 1a). |
| An admin chooses **Ask to take over** in Settings → Ownership | Owner gets an email and a notice: "Priya asked to take over CSE 3B. Refuse by 9 Nov." Other admins see "Take-over asked by Priya" |
| Owner chooses Refuse | Request ends; the admin is told |
| Owner is active again | Request stays until they refuse or 7 days pass, so a quick visit doesn't cancel it silently |
| 7 days pass with no refusal | The admin sees **Take over now** and confirms with the identity check (134). Old owner becomes an admin and is told. Last changed records it. |
| Two admins ask | One request at a time: "Priya has already asked" |

No scheduled job: the 7 days are checked when the admin opens Settings. A child workspace with no lead already hands over (35.4), so this is for organizations only.

### 45.3 Hand-ins at the deadline (gap 2)

- **Late after:** a field in the assignment form's due-date row, "Late after 15 minutes", 0 to 60. Members still see "Due 11:59 PM", and the Late mark uses the due time plus this.
- **Uploads:** the existing client keeps its retries. The measures file (41.7) counts hand-in uploads that failed; resumable uploads get built only if the pilot shows them (172).

### 45.4 The editor's task push (gap 3)

- Task push passes its task to the shared write check (`assertWorkspaceWriteAccessTx` with the task), so a member can push to their own copy and nobody else's.
- The hand-in lock (151) lives in that same check, so pushing to handed-in work is refused from the editor, Files and the task panel alike: "Lab 1 was handed in. Resubmit to change its files."
- Tests: a member pushes to their own copy (allowed); to another's (refused); to handed-in group work in a child workspace (refused).

### 45.5 Accounts deleted mid-term (gap 4)

Deletion still removes the person's own copies, because their data must go. At that moment, each organization they were in tells its admins once: "A member's account was deleted. Their 3 submissions were removed." The roster shows them under Former as "Deleted user", with no name. Nobody is told earlier, because asking to delete is private.

### 45.6 Preview as member (gap 5)

```
Previewing as a member · Nothing you do here is saved      [Exit preview]
```

- In the header's menu for owners and admins, on every tab.
- Reads go through the member rules, with the admin as an ordinary member who has no copies of their own. Admins-only folders, drafts and admin posts disappear.
- Every button is off, and the server refuses changes while previewing.
- Nobody is signed in as another person, so no one's private work is shown.

### 45.7 Records before Archive or Delete (gap 6)

The Archive and Delete dialogs list **Export progress** (the existing sheet) and **Download all** for each assignment, one at a time to stay under the 2 GB limit. Nothing new is built; it puts the existing buttons where the decision is made.

### 45.8 Finding it (gap 7)

| Part | Design |
|---|---|
| Landing section | "For classes and teams": create an organization, invite by code or email, assign and review. One **Create an organization** button, which goes to signup first for visitors. |
| Teacher guide | One help page, "Running a class on NetworkBase": create, invite, assign, review, end of term. Linked from the Ready screen (27.3) and the empty Overview. |
| When | Before opening up, not for the pilot, where the teacher is shown directly |

### 45.9 How this gets built

| Item | Step |
|---|---|
| Editor's task push and the shared hand-in lock | 1b |
| Deleted-account notice | 1c |
| Ask to take over; records in Archive and Delete | 9, Settings |
| Late after | 13, Tasks |
| Preview as member | 14 |
| Landing section and teacher guide | Before opening up |
| Resumable uploads | Only if the pilot shows failed hand-ins |

### 45.10 Calls made

- **30 days of inactivity and 7 days to refuse** are my choice. They're long enough not to take an organization from someone on holiday.
- **15 minutes for Late after** covers a slow 50 MB upload on a phone connection.
- **Preview uses the admin's own account with member rules,** not someone else's, so it can't show anyone's private work.

### 45.11 Left out on purpose

Grades and rubrics, attendance, peer review and splitting credit within a group, importing from Google Classroom or other learning systems, plagiarism checks, AI writing, billing, and parent accounts (launch is 18 and over). Each is a product of its own, and nobody has asked for them.

