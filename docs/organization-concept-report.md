# NetworkBase Organizations — Concept Report (Locked)

Status: **Concept locked, 2026-10-26.** Covers: child project creation and Phase 3 units (§14), sprints (§15), tasks (§16), updates (§17), headers (§18), docs (§19), members (§20), settings (§21), the About tab (§22), Files (§23, replacing the earlier Files plan), cards, Discover and profile contributions (§24), Messages (§25) and notifications and email (§26), the Dashboard (§27) and the Projects tab (§28). All 174 decisions are locked. Section 34 (locked 2026-10-29, decisions 175–186) redesigns organization creation end to end. Section 29 designs G1–G4 (join flow, My work, left nav, permissions) and Section 30 designs G5–G11 (search, names, trust and safety, limits, lifecycle, Network, account data). Section 31 lists what is left for the implementation plan or later (G12–G17). No plan or code yet.

This report replaces the earlier external `organization-architecture-report.md`. Everything agreed so far is here. Items marked **[reuse]** already exist in the app, **[adapt]** exist and need org-specific changes, **[new]** must be built.

---

## 1. Purpose

A teacher starting a semester, or a manager starting a team, today runs the group through WhatsApp: people are added by hand or by QR, documents are lost in chat, assignments are announced as messages, deadlines need manual reminders, and nobody can see who actually finished.

An **Organization** in NetworkBase is a container for **people and projects**. It runs its own sprints, tasks, docs and files, and it holds **child projects** under it — the way GitHub holds repositories under an organization and Notion holds teamspaces under a workspace.

| Setting | Organization | Sprint | Assignment | Child project |
|---|---|---|---|---|
| College | Class or semester (e.g. CSE-3A 2026) | A course outcome or unit (CO1, one week) | Lab, homework, quiz | A student group project |
| Company | Company, department or program | A release, quarter or milestone | Training, report, deliverable | A team project |

The organization must work equally for colleges and for corporate project work.

---

## 2. Ground rules

1. **Same frame as projects.** Header, tab bar, 8-column main area and 4-column right rail, `RailSection`, `nb-nav-link`, the settings side navigation and the creation wizard shell. An org page and a child project page must look like a project page.
2. **No big cards, no percentage bars or rings.** State is shown as plain text rows in the style of the existing Recent activity rail: icon, one line, mono timestamp. Example: `Assignment 1 · 12 of 30 done · due Fri`.
3. **One page, three views.** Every tab is designed for the admin, the member and the visitor separately.
4. **Reuse first.** The org is built on the existing project model; new code only where the org genuinely differs.

---

## 3. Patterns borrowed from other products

| Product | Pattern | What NetworkBase takes |
|---|---|---|
| GitHub Organizations | Repositories under an org; People list; members choose public or private membership | Child projects; Members tab; "Show on my profile" toggle |
| Notion | Teamspaces nested in the sidebar; guests | Org row in the left nav that expands to its child projects; Guest role |
| Google Classroom | Class code; topics per unit; Assigned / Turned in / Missing | Join code; sprint = unit; roster with a Missing state |
| Linear | Workspace → teams → cycles | Org sprint (release or unit) with child project sprints inside it |
| Slack | One default channel everyone joins | Org `#general`; child project channels grouped under the org |

---

## 4. Data model

**An organization is a project with `kind = 'organization'`. A child project is a normal project with `parent_id` pointing to the org.**

The current project already has almost everything an org needs:

| Org need | Already in the app |
|---|---|
| Sprints | `project_sprints` (one active sprint per project), sprint lifecycle and events |
| Tasks and Kanban | `tasks`, `project_workflow_columns`, `KanbanBoard`, subtasks, comments |
| Teacher approval | `projects.task_review_required`, `tasks.review_status` |
| Docs | `project_docs`, `project_doc_versions`, `ProjectDocRail` |
| Files | `project_nodes`, `file_versions`, files tab, locks, task file links |
| Roles | `project_members.role`: owner, admin, member, viewer |
| Mentor or guide | `project_guidance_appointments` |
| Invitations | `project_invitations` |
| Profile credit | `profile_project_contributions` with `verified_by` |
| Chat | `chat_channels.project_id` |
| Notifications and email | `user_notifications`, `email_outbox` |

Because the org is a project, it gets the Kanban, sprints, docs, files, roles, chat and notifications without new infrastructure.

**Limits:** two levels only. An org cannot be inside another org, and a child project cannot have children.
**When to change:** move to a separate `organizations` table only if orgs need something a project can never have, such as billing or nested orgs.

---

## 5. People and how each one feels

| Person | College | Company | The feeling we design for |
|---|---|---|---|
| Owner / Admin | Teacher, TA | Manager, lead | "I see who is behind in five seconds and act in one click." |
| Member | Student | Employee | "I know what is due, where the material is, and that my work was submitted." |
| Child project member | Group member | Team member | "This is my team's space, and I still see what the org expects from us." |
| Guest (viewer) | External examiner | Client, auditor | "I can read everything I am allowed to, and I cannot break anything." |

**Role names follow the org type [new]:**

| Underlying role | Education | Company |
|---|---|---|
| owner | Teacher | Owner |
| admin | TA | Manager |
| member | Student | Member |
| viewer | Guest | Guest |

Labels are editable in settings. Permissions always come from the underlying role.

---

## 6. Organization creation — the same 5-phase wizard

> Redesigned end to end in **Section 34** (locked 2026-10-29). Where they differ, Section 34 wins.

Same shell, same footer, same live preview.

### Phase 1 — Starting point [adapt]
- A fourth card, **Organization**, beside Start from scratch, Import from GitHub and Upload a folder.
- Choosing it reveals the org type: Education, Company, Community, Research, Club.
- A link at the bottom: **"Have a code? Join an organization."**

### Phase 2 — Information [reuse]
- Category, name, **@handle** [new], tagline, description, problem, solution, tags.
- Optional term or period dates [new].
- Everything entered here is displayed on the **About** tab exactly as written.

### Phase 3 — People [adapt]
Replaces "Build the initial team" for orgs.
- Your title (defaults to Teacher or Owner).
- Invite co-admins by search or email.
- Role names (preset by type, editable).
- How people join: **join code** (Section 6.1); instant or approval required.
- Open roles are hidden for orgs — people join with the join code or an invitation.

### Phase 4 — Settings [adapt]
- Kept from today: visibility, picture, links, starter doc (e.g. a syllabus template), what members can do (post updates). For orgs, "New members can upload files" becomes **Member uploads to the org tree** (off by default — members submit on their own copies, Section 23).
- New: **who can create child projects** (All members by default, or Admins only); visibility cap for child projects; whether people outside the org can be added to child projects; optional default units (Section 14.4).
- Optional: **Plan your first sprints** (e.g. CO1–CO5 with dates). For orgs this **replaces "Journey stages"**: the org's Journey is built from its sprints (Section 22).

### Phase 5 — Review [reuse]
- The same summary list.
- The card preview becomes the **Discover organization card**.

### After creation [new]
A success screen with the **join code shown large**, **Copy code** and **Copy invite message** ("Join CSE-3A on NetworkBase with code K7M2QX"), then **Go to organization**.

### 6.1 Joining with a code [new]

There is **no QR code**. People join with a short code.

- **The code:** 6 characters from uppercase letters and digits, without look-alikes (no O/0, I/1), e.g. `K7M2QX`. Easy to write on a board, say in class or paste in chat.
- **One active code per org.** Admins can **copy** it or **regenerate** it; regenerating instantly invalidates the old code.
- **Where people enter it:** a **Join with code** dialog, reachable from the left nav (workspace section) and from Create project Phase 1 ("Have a code? Join an organization").
- **The same code in a link:** `/join/K7M2QX` opens the same dialog already filled in. It is the same code, not a separate system.
- **Flow:**
  1. Enter the code.
  2. A preview shows the org: avatar, name, type, member count.
  3. **Join**, or **Request to join** when approval is on (the request goes to the admins' Needs you and the Members tab).
  4. A welcome panel shows the admin's welcome note, pinned docs and **Add to your profile**.
- **Private orgs** can be joined only with the code. **Public orgs** can also be joined from their About page or the Discover card.
- **Protection:** wrong attempts are rate-limited per account (e.g. 5 per minute). A wrong code says only "That code doesn't match an organization." Archived orgs reject codes.

---

## 7. Organization tabs

Order: **Dashboard · About · Updates · Docs · Sprints · Tasks · Files · Projects · Members · Settings**.
Visitors land on About. Members land on Dashboard.

### 7.1 Dashboard [new layout, reused parts] — full design in Section 27

Today the project dashboard shows the overview card on the left and Journey, Recent activity and Open roles on the right. For the org, the overview content moves to About, and the **main column becomes a "What's happening" list** built like `RecentActivityCard`, at full width. Three blocks of rows:

1. **Needs you**
   - Admin: `5 submissions to review · Assignment 1`, `2 join requests`, `Lab 2 due tomorrow · 18 not started`.
   - Member: `Assignment 1 due tomorrow · not submitted`, `New doc: CO2 notes`.
2. **This sprint** — `CO2 · ends Fri · 3 of 5 tasks closed`, then each task as a row with `12 of 30 done`.
3. **Activity** — joins, submissions, uploads, published docs, new projects.

A **pinned strip** (newest pinned announcement, one line) sits at the top of the main column, and a **Coming up · next 7 days** block follows This sprint (Section 27).

Right rail, same style:
- **People [reuse]** — `ProjectTeamAvatars` with recent joiners.
- **Projects** — short list of child projects with last activity.
- Visitors do not see the Dashboard; they land on About, where the **Join** card lives (Section 22).

### 7.2 About [new tab — organizations only] — full design in Section 22 (the Journey lives here, not on the Dashboard)
- Tagline, description, problem, solution, category, tags, links (the `ProjectOverviewCard` content moved here).
- Leaders: owner and admins.
- One plain line of facts: `64 members · 12 projects · since Aug 2026 · Term Aug–Dec`.
- Join button.
- This is the org's public face. **Normal projects and child projects do not get an About tab.**

### 7.3 Updates [reuse composer and cards] — full design in Section 17
- Admins post announcements with **Pin** and **Notify** (in-app by default; email chosen per post — Sections 17 and 26). This replaces the WhatsApp broadcast.
- Comments act as Q&A, so questions stay attached to the announcement.
- Members post only when Discussion is allowed.
- A **From projects** filter shows child project updates shared upward via the new **Share to org** toggle.

### 7.4 Docs [reuse doc rail] — full design in Section 19
- Groups: Getting started, Guides and policies, Unit notes, Templates.
- Admins write; members read.
- **Required reading [new, light]** — appears as "New" in the member's Needs you list until opened. Read tracking comes later.
- **Templates** — child projects can create "New doc from org template".

### 7.5 Sprints [adapt] — full design in Section 15
A sprint is a unit or CO in college and a release or quarter in a company. Name, goal and dates as today, plus:
- **Materials [new]** — link docs and files to the sprint (`CO1 notes`, `Lab 1 sheet`).
- **Term plan [adapt]** — the left rail lists all planned sprints (CO1–CO5). One active sprint at a time; optional "start next on date".
- **Sprint view** — each assignment as a row: `28 of 30 done · 2 missing`, with the names behind it.
- **Closing [reuse]** — existing unfinished-task handling plus a Missing summary by student and assignment.
- **Child alignment [new]** — a child project sprint can be linked to the org sprint and must sit inside its dates. The child sprint header shows `Inside CO2 (CSE-3A) · ends Fri`. This gives a company team its program increment and a student group its unit deadline.

### 7.6 Tasks [adapt `CreateTaskModal` and the board] — full design in Section 16

The task modal gets a **type** at the top: **Task** (one assignee, as today) or **Assignment** [new]. An assignment adds:
- **Assign to:** Everyone · A role (only Students) · Selected people · **Teams** (Section 16.11) · **Each child project** / selected child projects (one copy per group, assigned to the group lead).
- **Submission:** none / file / link / text; review required (reuses `task_review_required`); late submission allowed.
- **Reminders:** 24 hours before and on the due day by default, sent only to people who have not finished. Can be changed per task.
- **Materials:** attach from org Files or Docs (existing References section).

**How it works:** one master task plus one copy per assignee (or team), linked by `assignment_id` (Section 16.10). Each copy is a normal task row with one assignee, so the Kanban, dragging, review, comments and files work unchanged. Progress (`12 of 30`) is a count of copies with status `done`. Editing the master's title or due date updates all copies. A member who joins later receives a copy if the assignment is not overdue.
*Ceiling:* rows grow as members × assignments (500 × 40 = 20,000, fine). For orgs above ~10,000 members, switch to a fulfilment table.

**Admin view:** assignments are a **list view**, one row per master showing `12 of 30 done`; the Kanban shows staff tasks only (decision 25). Opening a row shows the **roster** grouped as Not started / In progress / Submitted / Done / Missing, with **Remind**, **Approve all submitted** and **Return with comment**.

**Member board:** their own copies plus normal tasks on the same Kanban. Drag To Do → In Progress, then **Submit** (pick a file, send a link or write text). With review on, the task moves to In Review.

**Missing** is not a new status: it means overdue and not done.

### 7.7 Files [adapt] — full design in Section 23

The earlier plan here (Shared / My files / Submissions spaces, drop folders, a "Share with all projects" flag) is **replaced** by Section 23: one org tree with folder access levels (Admins only / Members / Public), submissions as the existing task files and deliverables on assignment copies, and a read-only **From <org>** view with Copy to this project in child projects. Later: release on date, storage line.

### 7.8 Projects [new tab, reused card] — full design in Section 28
- Child projects as a list or grid with `ProjectCard`.
- Each row: lead, members, active sprint, last activity, and plain text such as `3 overdue` or `quiet 7 days`.
- Filters: stage, lead, Needs attention.
- **+ New project** opens the wizard with the org locked (details in Section 14).
- Members can request to join a child project, reusing the open roles and applications flow.
- Later: **Create projects for groups** (give a list of groups, get N child projects with members).

### 7.9 Members [new tab] — full design in Section 20
- **Admin view:** rows with name, role label, title (`Section B`, `TA`), joined date, projects, `8 of 10 done`, last active. Filters: role, project, **Behind** (has missing tasks). Actions: change role, message, remind, remove. Top area: **Requests** (approve one or all) and **Invite** (join code with copy and regenerate, email list).
- **Member view:** hidden in v1 (decision 45); a directory comes later (decision 3).

### 7.10 Settings — see Sections 9 and 21.

---

## 8. Child project tabs

Same tabs as today: Dashboard · Updates · Docs · Sprints · Tasks · Files · Settings (no About tab). The org is a thread through all of them:

| Area | What changes |
|---|---|
| Header | `CSE-3A / Compiler Lab`, the org chip links to the org |
| Dashboard | **Overview card stays at the top** of the main column (no About tab), then **Needs you + This sprint** (Section 27.5). Rail as today (project Journey with manual stages, Recent activity, Open roles) plus one line: `Part of CSE-3A · CO2 ends Fri · 1 assignment due` |
| Tasks | Group assignments from the org appear with a `From CSE-3A` chip; the team splits them into subtasks |
| Docs | Read-only **From CSE-3A** section in the rail |
| Files | Read-only **From CSE-3A** view with Copy to this project (Section 23) |
| Sprints | Can be linked to the org sprint |
| Updates | **Share to CSE-3A** toggle in the composer; locked when the project is private |
| Supervision | Org admins appear as **inherited admins** and can open any child project without an invitation |

---

## 9. Settings people understand — full design in Section 21

Each section opens with one plain sentence (e.g. "Who can join and how"). A rule set by the org appears in a child project as a **locked row labelled "Set by CSE-3A"**, so nobody wonders why it cannot be changed.

| Who | Sections |
|---|---|
| Org admin | The 12 sections of Section 21.2: **General** · **Access & joining** (incl. Public page) · **People & roles** · **Projects** · **Work** · **Docs** · **Files** · **Updates & messages** · **Notifications** · **Profile credit** · **Privacy & policies** · **Lifecycle & danger** (owner) |
| Org member | "You" sections: My membership (title, show on my profile) · My notifications · Leave organization |
| Child project lead | Today's sections plus **Organization**: parent org, inherited rules (locked), linked sprint, detach (needs admin approval) |
| Child project member | Notifications · Leave project |

---

## 10. Profile and credit — full design in Section 24

**Org side**
- The admin writes the **About** content for people deciding whether to join.
- The admin writes a **Welcome note** shown on joining.

**Member side [adapt `ProjectContributionsCard`]**
- The org becomes a contribution entry: `CSE-3A 2026 · Student · Aug–Dec`, with the existing story editor, skills and summary.
- **Verified by the org [reuse `verified_by`]** — an admin verifies one entry or all at the end of the term.
- Child project work nests under it: `CSE-3A → Compiler Lab · Lead`.
- An **Organizations** row of logo chips appears on the profile.
- **Show on my profile** — per-member toggle, like GitHub's public or private membership.
- Child project pages and Discover cards show the org chip, so credit flows both ways.

---

## 11. Everywhere else in the app

| Surface | Change |
|---|---|
| Left nav (`AppSidebar`) | Orgs first with nested child projects, personal projects, Archived, Join with code (full design in Section 29.3) |
| Discover | New `kind: "organization"` feed card, public orgs only; org line on child project cards; Show and Organization filters (full design in Section 24) |
| Search / ⌘K | Orgs, assignments, org docs, "Search <org>" scope, strict privacy (full design in Section 30.1) |
| Notifications | Org group: assignments, reminders, announcements, reviews, join requests (full design in Section 26) |
| Messages | Org `#general`; child project channels grouped under the org (full design in Section 25) |
| Invitations inbox | Org invitations and admins' join requests in the My work drawer (Section 29.2), reusing `project_invitations` |
| Email digest | The planned personal B1 digest gets an org section after launch — separate from the admin daily digest E11 (Section 26) |

---

## 12. Locked decisions

| # | Decision | Answer |
|---|---|---|
| 1 | About tab scope | **Organizations only.** Normal and child projects keep today's tabs. |
| 2 | Submission privacy | **Private** to the student (or team) and the org admins — via the files on their assignment copy (Section 23). |
| 3 | Who sees the member list | Default when built: Education shows **names only** to members; Company shows the **full list**. Admins always see everything. **Built later** — v1 shows members to admins only. |
| 4 | Points or grades on assignments | **Later.** |
| 5 | "Assign to each child project" (group assignments) in v1 | **Yes, in v1.** It is the main bridge between the org and its child projects (group labs, team deliverables). It uses the same copy mechanism as Assign to everyone — one copy per child project, assigned to the lead — so it adds almost no cost. |
| 6 | People outside the org in child projects | **A setting, off by default.** When on, outside people join only that child project, never the org. They do not see org-level content: the From org views, org docs and org updates are hidden from them. This keeps classes and company teams closed by default while allowing a client or external mentor where needed. |
| 7 | Who can create child projects | Org setting in the creation wizard and Settings → Projects. **Default: All members.** Alternative: Admins only. |
| 8 | Adding people when creating a child project | **Admin creates → added directly. Member creates → invitations.** |
| 9 | Visibility for child projects | New **Org only** option, the **default** for child projects. |
| 10 | "Members create, admins approve" policy | **Later.** Two policies in v1. |
| 11 | Lead picked by an admin | **Becomes owner immediately**, with a notification; can hand ownership back. |
| 12 | Name of the team boxes | **Units.** |
| 13 | Units in normal personal projects | **Later.** v1 ships units for child projects only. |
| 14 | One person in several child projects of the same org | **Allowed**, shown as a hint. A "one project per member" rule can come later. |
| 15 | How people join | **Join code only, no QR.** The `/join/CODE` link is kept and pre-fills the same code. |
| 16 | "Create a matching sprint in every child project" | **An option, off by default.** |
| 17 | Org sprints overlapping | **Not allowed.** |
| 18 | Automatic sprint start / completion | **Auto-start on the start date: yes. Auto-complete: never** — the admin is asked. |
| 19 | What members see in org tasks and sprints | **Master assignments, their own copies, and tasks assigned to them.** Staff tasks are hidden from members (required by submission privacy). |
| 20 | What guests see | **Counts without names.** |
| 21 | Org time zone | **Yes**, a setting in General; deadlines follow it, everyone sees local time. |
| 22 | Who creates tasks and assignments in the org | **Owners and admins only.** Members work in child projects. |
| 23 | Deleting an assignment with submissions | **Not allowed — Close only.** Delete only while nobody has submitted. |
| 24 | Excuse and per-person extension | **In v1.** |
| 25 | Admin task layout | **Assignments as a list view; the Kanban shows staff tasks only.** |
| 26 | Comments on assignments | **Master comments are shared Q&A; copy comments are private** to the person and admins. |
| 27 | Org Tasks tab for visitors | **Never public.** |
| 28 | Group copy in a child project | **The lead can reassign it within the project.** |
| 29 | Where assignment teams live | **Per assignment**, reusable with **Copy teams from**. No permanent org-wide teams. |
| 30 | Who submits for a team | **Any team member.** |
| 31 | Review and excuse for teams | **Approve and Return apply to the whole team; Excuse applies to one person.** |
| 32 | Teams in child projects | **Yes** — Teams and Each unit in the child project task modal. |
| 33 | Members changing their own team | **No** — they ask the admin. |
| 34 | Changing a team after it submitted | **Locked.** Changes allowed only until that team submits. |
| 35 | Pinned updates | **Up to 3**, each with an optional unpin date. |
| 36 | Announcement notifications | **In-app by default; email chosen per post** for important announcements. |
| 37 | Announcement audience targeting | **In v1** — Everyone, a role, or selected child projects. |
| 38 | Member posts in the org feed | **Default on for Company, off for Education.** |
| 39 | Sharing child project updates to the org | **Off by default per post**; org setting can switch sharing off. |
| 40 | Org updates inside child projects | **Only the pinned org line**, never the full org feed. |
| 41 | Sprint start / assignment publish | **Offers "Also post an announcement", off by default.** |
| 42 | Admin quick actions in the org header | **"+ New" menu**: Assignment, Announcement, Sprint, Project. |
| 43 | Tab count badges | **Yes** — Tasks count, Updates dot, Members requests. |
| 44 | Follow, Views and Followers | **Only on public orgs and public child projects.** |
| 45 | Tabs for members in v1 | **Members tab hidden; Settings tab shows personal sections only.** |
| 46 | Visibility chip in the child header | **Yes** — `Org only` / `Private`. |
| 47 | Inherited admin chip in the child header | **Yes** — `<org> admin`, shown only to inherited admins. |
| 48 | Pinned announcement in the header | **No** — dashboard and Updates only. |
| 49 | Doc groups | **Four defaults** (Getting started, Guides & policies, Unit notes, Templates); admins can rename and add. |
| 50 | Blank doc creation | **New doc** next to Add from Files, also for normal projects. |
| 51 | Org docs in child projects | **"Show in child projects" per doc, on by default.** |
| 52 | Opening an org doc from a child project | **Opens in place, read-only**, with a link to the org. |
| 53 | Templates | **Copied, not linked**, filling `{{project}}`, `{{team}}`, `{{date}}`. |
| 54 | Important doc changes | **Publish & notify** and **Ask members to re-read**. |
| 55 | Comments on docs | **None** — questions go to Updates. |
| 56 | Submitting an assignment with a doc | **Yes** — Submit can pick a project doc. |
| 57 | Managing admins | **Only the owner** promotes, demotes or removes admins; admins manage members and guests. |
| 58 | Role when joining by code | **Always Member.** Admins and guests only via email invite. |
| 59 | Email invites without an account | **Yes** — the invite waits until they sign up with that email. |
| 60 | Rejoining after removal | **Allowed with the code** unless **Block from rejoining** is ticked. |
| 61 | Member drawer work view | **Yes** — each person's work across all assignments. |
| 62 | Member cap | **Optional Max members, off by default.** |
| 63 | Header avatars for visitors | **Only members with "Show on my profile" on**; count stays full. |
| 64 | Member titles | **Members set their own; admins can edit anyone's.** |
| 65 | Owner-only settings | **Name and handle, public/private, role names, Lifecycle & danger, managing admins.** Admins manage everything else. |
| 66 | Org rule changes reaching child projects | **Applied automatically with a notice**; existing outside people stay until removed. |
| 67 | Risky setting changes | **Impact preview before saving.** |
| 68 | Settings change record | **"Last changed by · date" per section**; full history later. |
| 69 | Defaults by org type | **Education: review on, member posts off, story points hidden; Company: the opposite.** |
| 70 | Personal settings | **"You" sections (My membership, My notifications, Leave) for everyone**, including admins and guests. |
| 71 | Child project Organization section | **Placed second**, after General. |
| 72 | Duplicate for next term | **In the owner's Lifecycle & danger section.** |
| 73 | Where the org Journey lives | **About tab rail**, built from the org's sprints; the org Dashboard rail does not show it. |
| 74 | Manual journey stages for orgs | **Not used.** Phase 4 "Journey stages" becomes "Plan your first sprints". |
| 75 | Journey for visitors | **Only when the Public page shows Sprints.** |
| 76 | Projects on About | **Up to 3 most active child projects the viewer can see**, with See all. |
| 77 | Activity on About | **Public-safe milestones only**; full activity stays on the Dashboard. |
| 78 | Leaders shown to visitors | **Only leaders with "Show on my profile" on.** |
| 79 | Child project Dashboard | **Overview card stays at the top**, then Needs you + This sprint; Activity stays in the rail (refined by decision 123). |
| 80 | Org folder access | **Admins only / Members / Public** on folders, inherited and only stricter going down. |
| 81 | Member writes in org Files | **Not in the org tree** — only on their own assignment copies. Replaces "My files" and drop folders. |
| 82 | Where submissions live | **Existing task files and deliverables on each copy**; no separate space. |
| 83 | Org files in child projects | **Read-only "From <org>" view** with **Copy to this project**. |
| 84 | Copies of org files | **Independent**, with a "Source updated" hint and **Update copy**. |
| 85 | GitHub sync for orgs | **Not in v1.** Child projects keep it. |
| 86 | Starter folders | **By org type**, including one Admins-only folder. |
| 87 | Notify on admin upload | **Optional "Notify members", off by default.** |
| 88 | Download all submissions | **Zip in v1**, built in the background for large assignments. |
| 89 | Org card | **ProjectCard org variant**: type chip, focus tags, member avatars respecting Show on my profile, project count, membership chip. |
| 90 | Child project card | **ProjectCard with the org line above the title.** |
| 91 | Discover | **Org cards in the main feed**, a **Show** filter (Everything / Projects / Organizations / Updates) and an **org filter** from chips. |
| 92 | Profile layout | **Organizations group above Projects in Portfolio**; Overview keeps the logo chips. |
| 93 | Org contribution entries | **Created automatically like projects**, private until published. |
| 94 | Child project contributions | **Nested under their org entry** on the profile. |
| 95 | Verification | **Existing verification by org admins ("Verified by <org>")**, covering role and dates, not text; revocable with a reason. |
| 96 | Work record | **Optional, off by default.** |
| 97 | Org-only child project on a public profile | **Member's own story shown, without link or project details.** |
| 98 | Org address | **`/org/<handle>`**, with redirects after a rename. |
| 99 | Child project chat | **Inside the org workspace**: default channel `#<handle>` grouped under Projects; no own workspace or `#general`. |
| 100 | Access to child project channels | **Private to the project team**; org admins can open and join any, not auto-added. |
| 101 | Guests and `#general` | **Not auto-joined**; admins can add them to channels. |
| 102 | Org `#general` size | **Exempt from the 500-member cap**; existing `@channel` and typing limits stay. |
| 103 | Chat settings | **Who can post in #general** (Everyone), **Members can create org channels** (Education off, Company on), **Default notifications for #general** (Education mentions). |
| 104 | Sharing to chat | **"Also share in #general"** on announcements and assignments, off by default, posting a live card. |
| 105 | DMs inside an org | **Org admins and members of the same org can always DM**; member to member follows privacy. |
| 106 | Outside people in chat | **Org workspace limited to their child project's channels**, labelled Guest. |
| 107 | Unit channels | **Later.** |
| 108 | Detached child project chat | **Becomes its own workspace**, default channel keeps its name. |
| 109 | Email sender | **`NetworkBase <notifications@networkbase.in>`** for all org and child project emails; Welcome stays on `welcome@`. |
| 110 | Which events email | **Only the 14 email-worthy events (E1–E14)**; everything else is tray or push. |
| 111 | Always-sent emails | **E1, E3, E12, E13, E14** ignore the email opt-out (bounce blocking still applies). |
| 112 | Due-soon email cap | **At most one per person per org per day, at 9:00 local time.** |
| 113 | Admin email | **Daily digest on by default** for owner and admins instead of instant submission emails. |
| 114 | Org email mute | **"Mute emails from <org>" one-click link** in every footer. |
| 115 | Email design | **One shared shell matching today's Welcome and Task emails**; the two existing emails unchanged. |
| 116 | Personal notification settings | **Organizations block**: All / Important only / Off, email switch, Include child projects. |
| 117 | Push | **Important items only**, respecting quiet hours. |
| 118 | Needs you | **A to-do list derived from current state**, not a notification type. |
| 119 | Dashboard pinned strip | **One-line pinned announcement at the top of the main column.** |
| 120 | Dashboard Coming up | **"Coming up · next 7 days" block**; members see only their own items. |
| 121 | Dashboard Activity privacy | **Admins see all; members and guests see org-level events and their own only.** |
| 122 | New-org Get started list | **Derived checklist for admins** that disappears when done. |
| 123 | Child Dashboard | **What's happening = Needs you + This sprint; Activity stays in the rail.** |
| 124 | Visitors and the Dashboard | **Never shown**; visitors land on About. |
| 125 | Projects default view | **List for admins, Cards for members.** |
| 126 | Needs attention rule | **3+ overdue · quiet 7 days · group copy missing or returned · sprint outside org dates · lead left.** |
| 127 | Child project removal by org admins | **Archive and detach yes; delete only by the project owner.** |
| 128 | Projects bulk actions | **Archive selected · Remind leads.** |
| 129 | Member Projects view | **Your projects first, then all org-only and public projects; Private only if a member.** |
| 130 | Private child projects in the list | **Admins see all; members only their own.** |
| 131 | Logged-out join link | **Public preview page** (logo, name, type, member count) with sign-up and log-in; private orgs show nothing more. |
| 132 | Join code during onboarding | **Saved with the onboarding draft**, surviving closed tabs and device switches. |
| 133 | Joining after onboarding | **Automatic** join or request, no extra click; finish button "Continue to <org>". |
| 134 | Email invites at sign-up | **Accepted automatically** when the email matches, applying role, title, child project and unit. |
| 135 | Logged-out code lookups | **Rate-limited per network address**, plain error message. |
| 136 | My work drawer additions | **Org context chips, Organization filter, quick filters Due soon / Missing / To review.** |
| 137 | To review | **New My work view** for admins, leads and reviewers across orgs and projects. |
| 138 | Invitations tab | **Adds org invitations and admins' join requests**; other admin requests stay in Needs you. |
| 139 | Copies in My work | **Members see only their own copies** (team copies for teammates); masters never. |
| 140 | Sidebar order | **Orgs first with nested child projects** (only yours; admins get All projects), then personal projects. |
| 141 | Sidebar badges | **Org row: Needs you count and unseen-announcement dot**; child rows none. |
| 142 | Sidebar extras | **Archived group, greyed Requested rows, Join with code link.** |
| 143 | Collapsed sidebar | **Org logos with badge dots.** |
| 144 | Permissions source of truth | **§29.4 tables**; the rest of the report is corrected to match. |
| 145 | Inherited org admins | **Project admin rights plus Archive and Detach**; never delete, transfer ownership, edit name/handle/avatar or remove the lead. |
| 146 | Guests | **Read-only everywhere.** |
| 147 | New search results | **Organizations, assignments (own copies only), org docs.** |
| 148 | Scoped search | **"Search <org>" first inside an org**; From org results inside child projects. |
| 149 | Search privacy | **Follows §29.4 exactly**; hidden names never shown. |
| 150 | Shared-org chip on people | **Only if they show that org on their profile.** |
| 151 | ⌘K quick actions | **Join with code · New assignment · New project in an org.** |
| 152 | Handle format | **3–40 characters, `a–z 0–9 -`.** |
| 153 | Handle uniqueness | **Unique across all project addresses**; reserved lists plus org words. |
| 154 | Handle renames | **Owner only, once every 7 days; old handle redirected and held 90 days.** |
| 155 | Display names | **2–80 characters; duplicates allowed.** |
| 156 | Child channel names | **`_` becomes `-`.** |
| 157 | Reporting | **Orgs, posts, docs and comments**, reviewed on a new platform admin Reports page. |
| 158 | Moderation actions | **Dismiss, hide from Discover, remove content, suspend.** |
| 159 | Verified badge | **Automatic by matching email domain; otherwise platform admin review.** |
| 160 | New public orgs on Discover | **After 3+ members and 7+ days, or when verified.** |
| 161 | Email announcements | **At most 5 per org per day.** |
| 162 | Join spikes | **Alert admins** to regenerate the code. |
| 163 | Limits | **One limits table in one settings file**, plain message on hit. |
| 164 | Archive | **Read-only, code off, scheduled work stops; unarchive creates a new code.** |
| 165 | Duplicate | **Copies setup, docs, files, plan and draft assignments; never members, submissions, messages or child projects.** |
| 166 | Delete | **30-day grace with restore; child projects detached immediately by default; members can download own submissions.** |
| 167 | Transfer ownership | **Only to an admin**; old owner becomes admin. |
| 168 | Network Invitations | **Adds org invitations and org labels.** |
| 169 | Org-mate suggestions | **Later.** |
| 170 | Person cards | **Shared-org chip.** |
| 171 | Account export | **Adds memberships, own copies, submission details, own org posts and comments.** |
| 172 | Org owners deleting accounts | **Blocked until ownership is transferred or the org deleted**; automatic hand-over only for involuntary removal. |
| 173 | Child projects of a deleted account | **Pass to project admin → unit lead → org owner**; never deleted with the account. |
| 174 | Account deletion grace and final deletion | **Memberships hidden then restored if cancelled; individual work removed, team work anonymized.** |
| 175 | Type preselection | **None.** Continue is disabled until a type is chosen |
| 176 | Other type | **Add "Other"** with a required short label ("What do you call it?") and neutral defaults |
| 177 | Research and Club role names | **PI · Researcher** and **President · Coordinator** (today both use Owner · Admin) |
| 178 | Org step labels | **Details · People · Setup**, positions unchanged |
| 179 | Problem / Solution for orgs | Replaced by **Who it's for** and **What members do here**, stored in the same columns |
| 180 | New identity fields | **Part of** and **Where + time zone** in Phase 2; Category becomes a Subject / Department label by type |
| 181 | Welcome note | **Asked in Phase 2** (optional), not only in Settings |
| 182 | Skills picker for orgs | **Hidden**; Topics only |
| 183 | Term and sprints | **Move to Setup** as one Calendar group |
| 184 | Co-admins and roster invites in the wizard | **Yes**: co-admins (up to 10) and pasted member emails (up to 500), sent at creation |
| 185 | Defaults by type | Join mode, visibility and Work defaults **follow the type** (34.4, 34.5); untouched fields follow a type change |
| 186 | Switching to a project mid-wizard | Keep the shared text and **drop org-only fields after a confirm** |

---

## 13. End of the cycle — full design in Section 30.5

- **Archive (end of term or program):** everything becomes read-only. Members keep access to their own submissions. Contributions can be bulk-verified. Child projects stay in the archive, or a student detaches theirs to keep for their portfolio.
- **Duplicate for next term:** copies About, docs, sprint plan (dates shifted), assignments as drafts and template folders. Does not copy members or submissions.
- **Transfer ownership:** for handing a class or team to someone else.
- **Delete:** choose whether child projects are deleted or detached to their leads.

---

## 14. Child project creation (locked 2026-10-26)

The same wizard at `/projects/new`. It keeps one draft per user and returns you to where you came from on close. The org adds one thing: a **location** (Personal or an org) carried through all five phases, with org rules layered on top.

### 14.1 Where creation starts

| # | Entry | Behaviour |
|---|---|---|
| E1 | Org **Projects tab → + New project** | Opens `/projects/new?org=<handle>`. Phase 1 shows a locked chip **In CSE-3A**. Closing returns to the Projects tab. |
| E2 | Org row in the left nav → **+** (hover) | Same as E1. |
| E3 | Org dashboard **Needs you** row "Group assignment needs projects" | Same as E1. Shown to admins when an assignment targets each child project and the org has none. |
| E4 | Global **Create project** button | Phase 1 shows a **Where** picker: **Personal** (default) and each org the user belongs to. Orgs where the user cannot create are listed disabled, with the reason. |
| E5 | Deep link `?org=<handle>&source=github` | Like E1 with the source preselected (extends the existing `?source=` support). |
| E6 | `?org=` for an org the user is not in, or an archived org | Falls back to Personal with one line: "You're not a member of CSE-3A. This will be a personal project." |

### 14.2 Who can create

**Org setting "Who can create projects in <org>"**, shown in the org creation wizard (Phase 4) and in org **Settings → Projects**, with the same control:
- ◉ **All members** (default for every org type) — any member can start a child project and becomes its lead.
- ○ **Admins only** — members see "Only admins create projects here" and a **Message admins** button.

Owners and admins can always create. Guests never can. Changing the setting affects only new creation; open drafts are re-checked at submit.

| Creator | Lead and owner | Other people |
|---|---|---|
| Owner / Admin | Picks the lead from the roster; the lead becomes owner immediately and is notified. The admin remains an inherited admin. | **Added directly**, no invitation to accept (like Classroom groups). |
| Member | The member is lead and owner. | Receive **invitations** (existing `project_invitations`) and join only if they accept. |

### 14.3 Phase by phase

**Phase 1 — Source**
- Where picker (E4) or locked chip (E1).
- Sources: scratch, GitHub, upload, and **From an org template** (only when the org has template folders).
- The Organization card is hidden: orgs cannot nest.

**Phase 2 — Information**
- Same fields. Category defaults to the org's category; tags are suggested from org tags.
- A title that duplicates another project in the org shows a warning, not a block.

**Phase 3 — Team (units)** — see 14.4.

**Phase 4 — Settings**
- Visibility gains a new **Org only** option:
  - **Public** — only when the org is public and its cap allows.
  - **Org only** (default) — every org member can see it.
  - **Private** — the team and org admins.
  - Options the cap blocks show as locked rows "Set by CSE-3A".
- Member permissions (post updates, upload files) start from the org's values.
- **Follow org sprints** toggle: project sprints link to org sprints and stay inside their dates.
- Starter doc: org templates listed first.
- The **From CSE-3A** Files view is always on.

**Phase 5 — Review**
- New summary rows: Organization, Visibility, Inherited admins, Follows org sprints, and the team line `4 added · 3 invited · 1 open seat`.
- The card preview shows the org chip.
- **Create** opens the child project and adds an org Activity row ("Ravi created Compiler Lab"). Group assignments that are not overdue are copied into the new project, by the same rule as late joiners.

### 14.4 Phase 3 — Units and the roster picker

A child project's team is organised into **units**: named boxes such as "Developer testing unit" or "Frontend developers", filled with people picked from the org roster.

**Built on what exists.** Phase 3 already has role boxes (title, description, skills, seats via `project_open_roles.count` / `filled`), and invitations can already target a role (`project_invitations.role_id`). **A unit is a role box filled with real people.** Unfilled seats stay open for org members to apply to through the existing applications flow.
New: `project_members.unit_id` (member → unit) and the admin direct-add path.
Units live inside one child project; there is no org-wide squad table.

**Layout of Phase 3, top to bottom**
1. **Project lead** — as today; admins get a lead picker over the roster.
2. **Units**
   ```
   ┌ Frontend developers ─────────────────── 3 of 4 seats ┐
   │ (Ravi ★) (Asha) (Kiran)  [+ Add people]  1 open seat │
   │ Skills: React, CSS            ⋯ Rename · Remove      │
   └──────────────────────────────────────────────────────┘
   ┌ Developer testing unit ──────────────── 2 of 2 seats ┐
   │ (Meena ★) (John)                     [+ Add people]  │
   └──────────────────────────────────────────────────────┘
   [+ Add unit]   Suggestions: Backend · Design · Testing · Docs
   ```
   - Name (required), optional description.
   - Seats default to the number of people picked; raise it to leave seats open.
   - **Unit lead (★)**, optional: receives the unit's mentions and reminders.
   - Skills optional (existing field). Compensation hidden for Education orgs, collapsed for Company orgs.
   - Move people between units by dragging a chip, or with the chip menu **Move to…** (keyboard).
3. **Not in a unit** — people added without a unit, for small projects.
4. **Inherited admins** — read-only rows, e.g. "Ms. Rao, Teacher · Set by CSE-3A".
5. **Guide** (optional) — a TA or teacher via the existing guidance appointment.

**Roster picker (+ Add people)** — a side sheet over the wizard:
- Search by name, email or title ("Section B").
- Filters: role (Students / TAs / Members), **Not in a project yet**, skills.
- Each row: avatar, name, title, and a hint such as "In Compiler Lab" (a hint, never a block).
- Multi-select, then **Add 4 to Frontend developers**. People already in the project show as ticked and disabled.
- **Outside CSE-3A** tab appears only when that org setting is on.
- A person sits in one unit at a time. Unit names are unique within the project.

**Added vs. invited** — the chip shows the result before creation:

| Creator | Chip | After Create |
|---|---|---|
| Owner / Admin | **Will be added** | Member immediately, placed in the unit. Notified: "You were added to Compiler Lab · Frontend developers". |
| Member | **Will be invited** | Invitation with the unit attached. Accept → member in that unit. Decline → seat reopens. Optional note; existing expiry rules. |

**Inside the child project after creation**
- **Dashboard rail → Team** (adapt `ProjectTeamAvatars`): one row per unit, e.g. `Frontend developers · 3  (R)(A)(K)  1 open seat`. Clicking lists names with the unit lead marked.
- **Open roles card:** open seats appear here; in an org-only project only org members see and apply.
- **Settings → Collaborators:** grouped by unit; the lead or an admin moves people, renames units, changes seats.
- **Tasks:** Unit filter on the board; `@Frontend developers` in a comment notifies the unit.
- **Org side:** Projects tab row `3 units · 9 members`; Members tab shows `Compiler Lab · Frontend`; admin Needs you row `12 students not in any project`.

**Additions**
1. **Default units** — org Settings → Projects → "Default units" (e.g. Frontend, Backend, Testing) pre-fill Phase 3 for every new child project; still editable.
2. **Not in a project yet** filter plus the dashboard nudge.
3. **Unit lead.**
4. **Extra seats become open roles** inside the org ("we need one more tester").
5. **Leaving the org removes the person from its child projects**; their seat reopens (except outside people added under decision 6).

### 14.5 Drafts and leaving
- The draft remembers its location; the resume prompt reads "Resume draft · in CSE-3A".
- Opening the wizard for another org while a draft exists: "You have a draft in CSE-3A: Resume or Start new". Start new discards it.
- Leave setup returns to where the user came from (already works).

### 14.6 Checks at submit (server re-checks everything)

| Change since the wizard opened | Result |
|---|---|
| Removed from the org | "You're no longer in CSE-3A." **Create as a personal project** keeps all entered data. |
| Policy became Admins only | Same message and option. |
| Org archived | "CSE-3A is archived." Same option. |
| Visibility cap tightened | Visibility drops to the highest allowed, with "Changed by CSE-3A rules". |
| Outside person added but the setting is now off | Removed from the list with a reason. |

### 14.7 Moving projects in and out
- **Into an org:** project Settings → Organization → **Move to an organization** (owner only). A preview lists what changes: visibility capped, org admins gain access, outside people flagged (if the setting is off, the move is blocked until they are removed). If the owner is not an org admin, it becomes a request in the admins' Needs you.
- **Detach:** admin approval; the project becomes Private; From org views disappear; linked sprints unlink; assignment copies remain as normal tasks and show as "Detached" on the org roster.
- **Org to org:** two steps — detach, then move.
- **Org deleted:** owner chooses detach or delete for child projects (Section 13).

### 14.8 Later
- Bulk **Create projects for groups**.
- **Start a project for this assignment** (an assignment whose submission is a project).
- Policy **Members create, admins approve**.
- Units for normal personal projects.
- Optional org rule **One project per member**.

---

## 15. Sprints end to end (locked 2026-10-26)

Built on today's sprint system, which stays: statuses planning → active → completed / archived / cancelled; **one active sprint per project**; on completion, unfinished work is kept in history, moved to the backlog, or moved to a planned sprint; Sprint tab layout = sprint list rail, header (name, goal, description), timeline (created row, one row per task, completed row); no progress bars or big cards; dates live in the sprint list, not the header.

### 15.1 Two levels

| Level | Meaning | College | Company |
|---|---|---|---|
| **Org sprint** | Shared time box for the whole org | CO1 · Oct 27–Nov 2 | October push · Oct 1–31 · goal 120 demos |
| **Child project sprint** | The team's own time box, optionally **inside** an org sprint | Compiler Lab · Sprint 1 (inside CO1) | North region · Week 3 (inside October push) |

- One active org sprint at a time; one active sprint per child project.
- **Org sprints never overlap**, so the term plan reads CO1 → CO2 → CO3.
- A **linked child sprint must fit inside its org sprint's dates.** Several child sprints may run one after another inside one org sprint.

### 15.2 Creating an org sprint (admin)

Sprints tab → **New sprint**: the existing modal (Basics, Schedule) plus three new sections.

| Section | Fields |
|---|---|
| Basics (existing) | Name, goal, description. Name suggestions by type: "CO1" (Education), "Sprint 12" (Company) |
| Schedule (existing + new) | Start, end, **Start automatically on the start date** (new, on by default) |
| **Materials** (new) | Attach org docs and files (existing attachment picker) |
| **Child projects** (new) | **Show in child projects** (on by default) · **Create a matching sprint in every child project** (off by default) |
| **Notify** (new) | Notify members when it starts (on by default) |

- **Plan a series** (new): prefix, count, length, start date → e.g. CO1–CO5 weekly from Oct 27, created as planned sprints. Same generator as the org wizard's "Plan your first sprints".
- Checks: end after start; no overlap with another org sprint.
- If a sprint is already active, the new one is saved as planned — this is how the term plan builds up.

### 15.3 Lifecycle of an org sprint

| Moment | Behaviour |
|---|---|
| **Planned** | Listed with dates; members see what is coming |
| **Starts** (manual or automatic) | Members notified ("CO1 started · 3 assignments · 2 materials"). Org Activity row "CO1 started". Dashboard "This sprint" switches to CO1. Child leads without a linked sprint get Needs you: "CO1 started. Plan your sprint inside it" |
| **During** | Admins add assignments and tasks to it (existing Sprint field). A group assignment's copy goes into each child project's linked sprint, or its backlog with a `From CSE-3A · CO1` chip |
| **Dates change** | Linked child sprints that no longer fit are flagged "Outside CO1 dates" for their lead; never changed automatically. Assignment due dates stay unless the admin ticks **Move due dates too** |
| **1 day before end** | Admins: "CO1 ends tomorrow · 6 people have missing work". Members get the normal assignment reminders |
| **End date passes** | **Never auto-completes.** Admin Needs you: "CO1 ended yesterday. Complete it?" |
| **Complete** | Existing unfinished-work choice for org tasks. Unfinished assignments stay **Missing** in history; late submissions still count if allowed. Completed row: "Ms. Rao completed CO1 · 4 assignments · 2 people with missing work". Child leads are asked to complete their linked sprints (not auto-closed) |
| **Cancel** | Assignments move to backlog; linked child sprints are unlinked with a notice |
| **Archive** | Read-only, as today |

### 15.4 Org sprint by person

**Admin (Teacher / Manager)**
- Sprint list: all sprints with dates and status; planned ones form the term plan; **New sprint** and **Plan a series** here.
- Header: name, goal, description, lifecycle menu.
- **Materials** row under the header.
- Timeline: task rows as today; **assignment rows** `Assignment · Lab 1 — 18 of 30 done · 4 missing`; expanding opens the roster (Not started / In progress / Submitted / Done / Missing) with **Remind** and **Approve all submitted**.
- **Linked projects** block: `Compiler Lab · Sprint 1 · active`, `Quiz App · Sprint 1 · planned`, `3 projects not linked`, each linking to that sprint.

**Member (Student / Employee)**
- Same tab, read-only (no New sprint, no lifecycle menu).
- Sprint list shows past, current and planned sprints.
- Materials always visible.
- Timeline shows only what concerns them: their assignments with **their own** status (`Lab 1 · Submitted`, `Lab 2 · due Fri · not started`) and tasks assigned to them. Expanding shows their copy: brief, due, their submission, feedback.
- Linked projects: only their own child project's sprint.
- Dashboard: `CO1 · ends Fri · you have 2 of 3 done`.

**Guest (examiner, client)** — the admin view, read-only, **counts without names** (`18 of 30 done`, no roster).

**Visitor** — Sprints tab hidden by default (existing public-tab setting). If enabled under Settings → Public page: sprint list, names, goals, dates and assignment titles only — no counts, names or materials.

### 15.5 In the child project

**Creating a child sprint** (project lead, child admins, inherited org admins)
- Existing modal plus an **Inside org sprint** picker listing the org's planned and active sprints.
- Picking one defaults the dates to the org sprint's; the lead can shorten them but not go outside.
- When the org chose **Create a matching sprint in every child project**, each project receives a planned sprint labelled **"Created from October push"**. The lead may rename it, change its goal, adjust dates within bounds, or remove it (unlinks).

**Child Sprint tab**
- Header: the child sprint's own name and goal, plus `Inside October push · Acme Sales · ends Oct 31` linking to the org sprint.
- No own sprint while an org sprint runs: empty state "October push is running in Acme Sales. Plan your sprint inside it" with **Create linked sprint**.
- Timeline: own tasks as today; **group assignment rows** with a `From Acme Sales` chip (e.g. `Weekly pipeline report · due Fri`); expanding shows the org's brief, due date, submission and review status.
- Closing: existing unfinished-work options; "Move to a planned sprint" lists the next linked sprint first.
- When the org sprint ends: lead Needs you "October push ended. Complete Week 4?" — never auto-closed.

**Child dashboard rail** — `Part of Acme Sales · October push ends Oct 31 · 1 assignment due`.

| Person in the child project | Sees |
|---|---|
| Project lead / admins | Everything, including create, link and lifecycle |
| Inherited org admins | Everything and can act; mainly observers |
| Unit members | The sprint, timeline and their own work, as members do today |
| Outside people (if allowed) | The child sprint only; the org sprint line shows name and dates without a link into the org |
| Visitors | Per the project's public-tab setting, as today |

### 15.6 Company example — Acme Sales
1. Manager creates org sprint **October push (Oct 1–31)**, goal "120 demos", materials "Pitch deck v3" and "Pricing sheet".
2. Ticks **Create a matching sprint in every child project** → North region and Enterprise accounts each get a planned "October push" sprint.
3. Creates assignment **Weekly pipeline report** to **each child project**, due every Friday → each lead gets a copy inside the linked sprint.
4. North region's lead splits it into Week 1–4 sprints inside October; the team works the Kanban as usual.
5. Manager's Sprint tab: `Weekly pipeline report — 1 of 2 done · Enterprise missing`, `North region · Week 3 active`.
6. Nov 1: "October push ended. Complete it?" → completed; the missing report stays in history; leads are asked to close their own sprints.

### 15.7 Notifications

| When | Who | Message |
|---|---|---|
| Org sprint starts | Members | "CO1 started · 3 assignments · 2 materials" |
| Org sprint starts | Child leads without a linked sprint | "CO1 started. Plan your sprint inside it" |
| 1 day before end | Admins | "CO1 ends tomorrow · 6 people have missing work" |
| End date passed | Admins | "Complete CO1?" (Needs you) |
| Completed | Members | "CO1 closed · you completed 3 of 3" (low priority) |
| Completed | Child leads | "Complete your linked sprint?" (Needs you) |
| Dates changed | Child leads whose sprint no longer fits | "Your sprint is outside CO1's new dates" |

### 15.8 Edge cases
- Member joins mid-sprint: sees the sprint; receives copies of assignments that are not overdue.
- Child project detached: links removed; its sprints become ordinary sprints.
- Org archived: all sprints read-only.
- Start date in the past: allowed; starting makes it active immediately.
- **Org time zone** (Settings → General) defines when "due Friday" ends. Everyone sees their local time, with org time on hover.

### 15.9 Data

| Need | How |
|---|---|
| Org sprints | Reuse `project_sprints` on the org project |
| Child sprint inside org sprint | New nullable `project_sprints.parent_sprint_id` |
| Materials | Small link table: sprint → doc or file |
| Auto-start | New `auto_start` flag, run by the existing background job system |
| Matching sprints | One server action creating a linked planned sprint per child project |
| Members see only their own copies | Read rule on org tasks: members see master assignments and their own copies; admins see all |
| Org time zone | One new org setting |

---

## 16. Tasks end to end (locked 2026-10-26)

Built on today's task system, which stays: statuses To do / In progress / Done / Blocked plus custom board sections; Kanban with views All / Backlog / Sprint / In review; task drawer with subtasks, attachments, comments, mentions and copy-link; optional review (Done → submitted for review → approve, or request changes with a reason → In progress); changed work after submission must be resubmitted; members move their own or unassigned tasks, leads move any; the IDE extension and GitHub closing keywords follow the same rules.

### 16.1 Three kinds of work

| Kind | Goes to | Where copies live | Example |
|---|---|---|---|
| **Task** | One person | The org board, as today | "Prepare CO2 quiz" (staff work) |
| **Assignment** | Everyone, a role, selected people, or **teams** (16.11) | **One master + one copy per person or per team** | "Lab 1", "Complete compliance training" |
| **Group assignment** | Each child project or selected child projects | One copy **in each child project**, assigned to its lead | "Mini-project proposal", "Weekly pipeline report" |

Child projects keep their own normal tasks and also receive group assignment copies.

### 16.2 Creating work in the org (owners and admins only)

Entry: Tasks tab → **New task**; Sprint tab → add to sprint; Needs you → "Create projects first" when a group assignment has no target projects.

The existing `CreateTaskModal` with a **type switch** at the top: **Task | Assignment**.

| Section | Task | Assignment |
|---|---|---|
| Basics (existing) | Title, description | Same |
| Planning & assignment (adapt) | Assignee, sprint, status, priority | **Assign to:** Everyone · A role · Selected people · Teams (16.11) · Each child project · Selected child projects. Sprint |
| Schedule (adapt) | Due date, story points | **Due date and time** (org time zone). Story points hidden for Education |
| **Submission** (new) | — | Type: none / file / link / text · **Review required** (default from org settings) · **Late submissions:** not allowed / until a date / always |
| **Reminders** (new) | — | 24 h before and on the due day (org defaults), only to people not done |
| Materials (existing References) | Attach docs and files | Same |
| Subtasks (existing) | Checklist | **Steps copied into every copy** |

Footer: **Publish** or **Save as draft**, with a preview line: "Creates 30 copies · notifies 30 people" or "Creates 6 copies · one per project lead".

### 16.3 Assignment lifecycle

**Master**

| State | Behaviour |
|---|---|
| Draft | Admins only; no copies |
| Published | Copies created; recipients notified "Ms. Rao assigned Lab 1 · due Fri 11:59 PM"; Activity row |
| Open | Members work; admins see counts change |
| Due soon | Reminders to people not done |
| Past due | Unfinished copies show **Missing**; if late submissions are allowed, submissions continue labelled **Late** |
| Closed | Admin action, or automatic at the late cut-off date. No more submissions; Missing stays in history |
| Archived | Read-only once its sprint is archived |

**Each copy**

```
To do → In progress → Submitted (In review) → Done
              ↑                │
              └── Returned ────┘   (admin requests changes with a reason)
Blocked: any time (existing)       Missing / Late: derived labels
```

**After publishing**
- Editing the master's title, description, materials or due date updates every copy; a due-date move notifies "Due date moved to Mon".
- A new step is added to every copy; existing ticks stay.
- Submission type locks after the first submission.
- **Delete only while nobody has submitted; afterwards, Close only.**

**Per-person admin actions**
- **Extend** — one person's due date (each copy already has its own `due_date`).
- **Excuse** — not required for this person; removed from counts; shown "Excused" with a reason.
- **Remind** — one person or everyone not done.

### 16.4 Submission and review

**Member**
1. Opens their copy → **Submit**.
2. Attaches what is required: a file (uploaded to their copy), a link, or text.
3. Review on → **Submitted**. Review off → **Done**.
4. Resubmitting before review creates a new version; work changed after submission must be resubmitted (existing rule).
5. With type "file", the card cannot be dragged to Done without a file; a message explains why.

**Admin**
- Opens a copy from the roster or the **Review** queue; sees the submission with the existing file preview and version compare.
- **Approve** → Done. **Return** requires a reason → In progress, member notified.
- **Approve all submitted** per assignment.

**Conversation**
- **Master comments = shared Q&A** visible to every recipient.
- **Copy comments = private** between that person and the admins.

### 16.5 Org Tasks tab by person

**Admin (Teacher / Manager)**

| View | Content |
|---|---|
| **Assignments** (new, admin default) | One row per master: `Lab 1 · due Fri · 18 of 30 done · 4 submitted · 3 missing · CO1`. Opens to **Brief** (description, materials, steps), **Roster** (Not started / In progress / Submitted / Done / Missing / Excused with Remind, Approve all, Extend, Excuse) and **Discussion** (master comments) |
| **Board** (existing) | Staff **tasks** only — copies never appear |
| **Review** (existing, adapted) | Marking inbox across all assignments: `Asha · Lab 1 · 2h ago · Late` → Approve / Return → **Next** |
| Backlog / Sprint (existing) | Staff tasks and masters |
| **Projects** (new) | One row per child project: `Compiler Lab · 12 open · 3 overdue · 2 in review`, opening that board |

**Member (Student / Employee)**
- **Board** (default): Kanban of their own copies and tasks assigned to them. Cards show title, due, "From Ms. Rao", sprint chip, Late / Missing.
- Drag their own cards; dropping on Done with review on opens **Submit**.
- **Assignments** view: their to-do list with own status, due date, and feedback when returned.
- **Review** view: what they submitted that is waiting.
- Never sees staff tasks, other people's copies or the roster.

**Guest** — Assignments view only, read-only, counts without names.

**Visitor** — the org Tasks tab is never public.

### 16.6 Tasks in the child project
- Own tasks: board, views, review policy, unit filter and `@unit` mentions as today.
- **Group assignment copy:** card with a `From CSE-3A` chip, in the linked sprint or backlog, assigned to the **lead**. The lead may **reassign it within the project**. The team splits work with the copy's steps, subtasks or its own tasks.
- **Submit** happens once, on behalf of the project, and goes to the **org's** review ("Reviewed by CSE-3A"). Approval shows Done in the project and on the org roster; a return shows the reason and moves the card to In progress.
- Two review rules coexist: the project's policy for its own tasks; the org's review for org assignments.

| Person in the child project | Sees |
|---|---|
| Lead / project admins | Everything; reassign and submit the group copy |
| Inherited org admins | Everything; can review the group copy from the project |
| Unit members | Board and drawer as today; can work the group copy if assigned; see its brief |
| Outside people (if allowed) | The group copy card and brief, without links to the org master or org Q&A |
| Visitors | Per the project's public-tab setting |

### 16.7 Company example — Weekly pipeline report
1. Manager creates a group assignment to each child project: due every Friday, type file, review on, steps "Update CRM" → "Export report" → "Upload".
2. Each lead gets a copy; North region's lead reassigns it to Kiran.
3. Kiran completes the steps, uploads the file, **Submit**.
4. Manager's Review queue: `North region · Weekly pipeline report · 1h ago` → **Approve**.
5. Enterprise accounts passes Friday → **Missing** → manager clicks **Remind**.

### 16.8 Notifications

| When | Who | Message |
|---|---|---|
| Published | Recipients | "Lab 1 assigned · due Fri 11:59 PM" |
| Group copy arrives | Child lead | "CSE-3A assigned Mini-project proposal to Compiler Lab" |
| 24 h before / due day | People not done | "Lab 1 is due tomorrow" |
| Submissions | Admins | Batched: "5 new submissions for Lab 1" |
| Returned | Member or lead | "Lab 1 was returned: add the test cases" |
| Approved | Member or lead | "Lab 1 approved" (low priority) |
| Due date changed / extended / excused | Affected people | "Lab 1 is now due Mon" |
| Master Q&A comment | Admins and mentioned people | As current comment notifications |

### 16.9 Edge cases
- Member joins late → copies of open assignments not past due.
- Member leaves → copies archived and removed from counts; submissions stay in history for admins.
- Child project detached → group copies become normal tasks; org roster shows "Detached".
- Org archived → all tasks read-only; members keep access to their own submissions.
- Publishing with a past due date → warning "Publish as already late?"
- 2,000+ recipients → copies created by the existing background job system; master shows "Creating copies…".
- IDE extension and GitHub: copies are ordinary tasks; GitHub closing keywords complete only that person's copy; review still applies.

### 16.10 Data

| Need | How |
|---|---|
| Master and copies | `tasks.assignment_id` on copies → master; master has `kind = 'assignment'` |
| Group copies | Same column; the copy row lives in the child project and points to the org master |
| Assignment settings | Submission type, late rule, reminders stored on the master |
| Excuse | `excused_at`, `excused_reason` on the copy |
| Late / Missing | Derived from due date and submission time; no new statuses |
| Per-person extension | The copy's existing `due_date` |
| Members see only their own work | Read rule (decision 19) |
| Shared Q&A vs private feedback | Master comments visible to all recipients; copy comments to the person and admins |
| Reminders | Scheduled job over copies due soon and not done |

### 16.11 Team assignments (locked 2026-10-26)

When picking people for an assignment, an admin can **group them into team boxes**. Each box gets **one shared copy** the whole team works on. People outside a box get their own copy.

```
Lab 2 · due Fri
┌ Team A ──────── 3 ┐ ┌ Team B ──────── 3 ┐ ┌ Team C ──────── 4 ┐
│ Ravi ★ Asha Kiran │ │ Meena ★ John Sara │ │ Ali ★ Bo Chen Dev │
└───────────────────┘ └───────────────────┘ └───────────────────┘
Not in a team: Priya        → 4 copies: 3 team copies + 1 individual
```

**One rule:** every copy belongs to a group of one or more people. An individual is a group of one. Lifecycle, review, Missing / Late, reminders, Extend, Excuse and the roster (16.3–16.5) are unchanged.

Teams belong to **one assignment**; there is no permanent org-wide team table. Reuse is one click via **Copy teams from**.

**Creating (admin)** — `CreateTaskModal`, type Assignment, **Assign to** gains **Teams**: Everyone · A role · Selected people · **Teams** · Each child project · Selected child projects.
- The **same boxes as Phase 3 units**: **+ Add team** (default names Team A, B, C; renamable), **+ Add people** opens the same roster picker with a **Not in a team yet** filter.
- **Team lead (★)** optional; defaults to the first person picked.
- Drag chips between boxes or use **Move to…**.
- **Not in a team** box: each person gets an individual copy.
- **Auto-make teams** (choose a size; random split, then adjust) and **Copy teams from** (an earlier assignment).
- One team per person per assignment; every team needs at least one person.
- Preview: "Creates 4 copies: 3 team copies (10 people) + 1 individual · notifies 11 people".
- Per team: one submission, review applies to the team, steps shared (each tick records who), due date per team (Extend per team).

**Team members' experience**

| Moment | Member sees |
|---|---|
| Published | "You're in Team A for Lab 2 with Ravi and Asha · due Fri" |
| Board | One card `Lab 2 · Team A` with teammates' avatars, due date and "From Ms. Rao", on every teammate's board |
| Working | **Any teammate can move the card**; steps show who ticked them ("✓ Write tests · Kiran") |
| Discussion | Team copy comments are **private to the team and admins**; master comments stay the shared Q&A |
| Files | Submission is stored on the **team copy** (its task files), visible to the team and admins |
| Submit | **Any teammate can submit for the team** — "Submitted by Asha for Team A" |
| Returned | Everyone on the team sees the reason; card back to In progress for all |
| Approved | Done for everyone; each member's own record shows the assignment done |
| Different team wanted | Members cannot change teams; they ask in a comment and the admin moves them |

Team members see each other's names on their copy and never see other teams' copies (decision 19).

**Admin view**
- Assignments row: `Lab 2 · due Fri · Teams · 2 of 4 done · 1 submitted · 7 of 11 people` (copies first, people secondary).
- Roster, one row per team:
  ```
  Team A · Ravi ★ · Asha · Kiran        Submitted 2h ago by Asha
  Team B · Meena ★ · John · Sara        Done
  Team C · Ali ★ · Bo · Chen · Dev      In progress · 2 of 4 steps
  Priya (individual)                    Missing
  ```
  Opening a team shows members, who ticked each step, who submitted and the version history.
- Actions: Remind (team or person), Extend (per team), **Excuse one person** (the team continues), Approve all submitted.
- Review queue: `Team A · Lab 2 · submitted by Asha · 2h ago`.
- **Changing teams after publish:** move a person, add or split a team **until that team submits**; then the team is locked. A moved person leaves the old copy and joins the new one.
- Late joiners are not added automatically in Teams mode; Needs you: "2 new members aren't in a team for Lab 2" with **Add to team**.

**Inside a child project** (lead, project admins, inherited org admins) — the task modal offers **Assign to: One person · Several people (Teams) · Each unit**.
- **Teams:** same boxes and picker, limited to project members.
- **Each unit:** Phase 3 units become the teams; one copy per unit, led by the unit lead.
- Same behaviour (shared card, any teammate moves or submits, steps record who). Review follows the **project's** policy.
- The lead sees all team rows; team members see their team's copy; other project members see the task as today (child project tasks stay visible to the whole team).
- Org group assignments: the lead may still reassign (decision 28); splitting into teams is done with the project's own team task.

**Company example** — "Customer demo pitch", Teams: Team A (Kiran ★, Lee, Mo from North region), Team B (Sam ★, Tia, Uma from Enterprise accounts), individual Zoe. Lee ticks "Draft slides", Mo submits the deck. Roster: `Team A · Submitted by Mo`, `Team B · In progress`, `Zoe · Done`. Approving Team A marks all three Done.

**Edge cases**
- A member leaves the org → removed from the team; an empty team's copy is archived; if the lead leaves, the next member becomes lead.
- Excusing one person → the team still finishes; only that person leaves the counts.
- One person in two teams of the same assignment → not allowed.
- A team of one behaves exactly like an individual.
- Hundreds of teams → auto-make teams plus the existing background job system.

**Data**

| Need | How |
|---|---|
| A copy for several people | New `task_team_members` (task, person, lead/member). The copy's `assignee_id` stays the **team lead**, so "assigned to me" keeps working |
| Team name | `team_name` on the copy |
| Members see their team's copy | Decision-19 read rule extended: assigned to it **or listed as a team member** |
| Team submission files | The team copy's task files (Section 23), visible to the team and admins |
| Who ticked each step | Existing task activity events |
| Copy teams from | Read teams from an earlier assignment's copies |
| Auto-make teams | Random split in the browser before saving |
| Each unit | One copy per unit with its members and lead |

---

## 17. Updates end to end (locked 2026-10-26)

Built on today's Updates system, which stays: post types progress, milestone, release, blocker, decision, collaboration request, behind the scenes; visibility public or members only; reply rule logged-in or members only; composer with rich text, images, links, task / sprint / file references and saved drafts; pinning, likes, threaded comments, edit and delete; the "Members can post updates" setting; public posts in Discover under existing privacy rules.

### 17.1 Purpose
The org Updates tab replaces the WhatsApp group: **official announcements**, **questions and discussion**, and **work shared up from projects**. Announcements are not buried, questions stay attached to the announcement, nothing is lost in chat.

### 17.2 Kinds of post

| Kind | Who posts | Example |
|---|---|---|
| **Announcement** (new type) | Owners and admins | "Midterm moved to Nov 10", "New pricing from Nov 1" |
| **Discussion** (new type) | Members, when the org allows | "Anyone has notes for CO2 lecture 3?" |
| Existing types | Admins; members when allowed | "CO1 recap", "Q3 targets decided" |
| **From projects** | Child project members via **Share to <org>** | "Compiler Lab: parser passes all tests" |

Sprints and assignments do **not** post automatically (Activity records them). Starting a sprint or publishing an assignment offers **Also post an announcement**, off by default, with text pre-filled.

### 17.3 Composer (existing, adapted)
For everyone who can post: type chips (Announcement for admins, Discussion for members, existing types), text, images, links, and context — sprint, task or assignment, file, and **doc** (new).

Admin-only controls on announcements:

| Control | Options |
|---|---|
| **Audience** (new) | Everyone · A role · Selected child projects |
| **Notify** (new) | In-app (default) · **In-app + email** |
| **Pin** (adapted) | Pin, optional **Unpin on** date |
| **Comments** (adapted) | Members can reply (default) · **Comments off** |
| **Visibility** | **Members only** (default) · Public — only if the org is public and Public page shows Updates |

Preview line: "Visible to 30 Students · notifies 30 people by in-app and email".

### 17.4 Announcement lifecycle

| Moment | Behaviour |
|---|---|
| Draft | Auto-saved; author only |
| Posted | Top of the feed for its audience; notifications per Notify; **New** marker for unseen; Needs you row for important (email) announcements |
| Pinned | Up to **3 pinned** at the top. The newest pin shows as a one-line strip on the org dashboard and in child projects |
| Unpin date reached | Quietly unpinned; stays in the feed |
| Edited | "Edited" label; no new notification unless **Notify again** |
| Comments | Existing threads as Q&A; admin can switch comments off any time |
| Deleted | Author or admin; deleting someone else's post requires a reason (`deleted_by`) |
| Org archived | Feed read-only and readable |

### 17.5 Org Updates tab by person

Layout as today (feed, composer, right rail). Filters: **All · Announcements · Discussion · From projects**.

**Admin** — all post kinds and controls; up to 3 pinned posts, can pin any post including shared ones; moderation (delete any post or comment with a reason, comments off per post, member Discussion on/off in Settings); From projects filter with project chips; Activity row per announcement.

**Member** — feed for their audience (targeted announcements only reach that role or those child projects, plus admins); **New** markers; important announcements in Needs you until opened; comments where allowed; Discussion and existing types **only when member posts are allowed**; edit/delete own posts; no pin or notify.

**Guest** — read-only; posts for everyone; no comments.

**Visitor** — public posts only, when the org is public and Public page shows Updates. These also appear in **Discover** as the existing update cards with the org chip. Members-only posts never reach Discover.

### 17.6 Sharing up from a child project
- Child composer gets **Share to CSE-3A**, **off by default** per post.
- Locked when the project is **Private** ("Private projects can't share to the org") or when the org turned sharing off.
- **No copy:** the post stays in the project and is also listed in the org feed under From projects, with a project chip. Likes and comments are shared in both places.
- Labelled **"Shared to CSE-3A"** in the project. Org members comment from the org feed under the org's reply rule.
- Leaves the org feed when unshared, deleted, or the project is detached or deleted.
- Org admins may pin a shared post in the org feed (org feed only).

### 17.7 Updates in the child project
The project's own Updates tab stays the project's log. The org adds:
1. **Pinned org line** — one row at the top, e.g. `📌 CSE-3A · Midterm moved to Nov 10 →`. **The full org feed is never shown in the project.** Outside people do not see this line.
2. **Share to CSE-3A** in the composer.
3. **Inherited org admins** can moderate project updates.

| Person in the child project | Sees |
|---|---|
| Lead / project admins | Everything; posting, pinning, moderation; Share to org |
| Inherited org admins | Same, including moderation |
| Unit members | As members today, plus the pinned org line and Share to org on own posts |
| Outside people (if allowed) | Project updates only; no pinned org line or org links |
| Visitors | Public project updates, as today |

### 17.8 Company example — Acme Sales
1. Manager posts an **Announcement** "New pricing from Nov 1": Everyone, in-app + email, pinned until Nov 1, with the Pricing sheet attached.
2. Members get email and in-app; `📌 Acme Sales · New pricing from Nov 1` shows on the org dashboard and in North region and Enterprise accounts.
3. Uma asks in comments "Does it apply to renewals?"; the manager answers in the thread.
4. North region posts a milestone "Closed Contoso" with **Share to Acme Sales** on; it appears under From projects and the manager pins it.
5. On Nov 1 the pricing post unpins itself and stays in the feed.

### 17.9 Notifications

| When | Who | Channel |
|---|---|---|
| Announcement posted | Audience | In-app; email if chosen (respecting personal email settings) |
| Edited with Notify again | Audience | In-app |
| Discussion post | Mentioned people only | In-app |
| Shared-up post | No one | Feed only |
| Comment | Author, mentioned people, thread participants | Existing rules |
| Post deleted by an admin | Author | In-app with the reason |

### 17.10 Org Settings → Updates
- **Members can post** (Discussion and existing types). Default **off for Education, on for Company**.
- **Child projects can share updates to the org.** Default on.
- **Default notify level** for announcements. Default in-app.
- **Default reply rule:** org members only.

### 17.11 Edge cases
- Member leaves → posts stay with the saved name.
- A member who later joins a targeted role or child project sees past announcements for that audience.
- Child project turns Private → its shared posts leave the org feed.
- Org turns private → its public posts leave Discover immediately.
- Targeted audience with nobody in it → warning before posting.

### 17.12 Data

| Need | How |
|---|---|
| Org posts | Reuse `project_updates` on the org project |
| New kinds | Add `announcement` and `discussion` to `update_type` |
| Audience | `audience` on the post (roles, child project ids); empty = everyone |
| Notify level | Stored on the post; email via existing `email_outbox` |
| Unpin date | `pinned_until` |
| Comments off | `closed` value for the reply rule |
| Share up | `shared_to_org_at` on the child post; org feed also reads shared child posts |
| New markers | `last_seen_updates_at` on the org membership |

---

## 18. Headers — organization and child project (locked 2026-10-26)

Built on today's project header (`ProjectLayout`), which stays: identity block that scrolls away (avatar or owner "Add avatar" chip; title, presence dot without avatar; status control with emoji, text and expiry; tagline clamped with More on mobile; metadata row of team avatars | links cluster); actions on the right (Views · Followers, Invite, Follow, Share); sticky tab bar filtered by public-tab settings, with the files sync badge; on mobile Files / Tasks / Sprints, a compact bar with avatar, title, stage chip and ⋯ menu. Both new headers use this exact layout; only content and buttons change.

### 18.1 Org header

```
[Logo]  CSE-3A 2026                                   [+ New ▾] [Invite] [↗]
        @cse-3a · Education · 🎓 Midterms week
        Data Structures, Section A — Aug–Dec 2026
        (R)(A)(K)(M) +60 · 12 projects | 🌐 college.edu
──────────────────────────────────────────────────────────────────────────────
Dashboard  About  Updates•  Docs  Sprints  Tasks 5  Files  Projects  Members 2  Settings
```

| Part | Content |
|---|---|
| Avatar | Org logo; same component and size; owner "Add avatar" |
| Title | Org name |
| Line under title (new) | `@handle · Type`, then the existing status control |
| Tagline | Phase 2 tagline, clamped on mobile |
| Metadata row | Member avatars with count (`ProjectTeamAvatars`) · `12 projects` · links cluster |
| Pinned announcement | **Not in the header** — dashboard and Updates only |

### 18.2 Org header actions by person

| Person | Buttons |
|---|---|
| Owner / Admin | **+ New ▾** (Assignment · Announcement · Sprint · Project, each opening the existing modal) · **Invite** (join code copy / regenerate, email list) · **Share** |
| Member | **Share**; role chip after the type (`· Student`) |
| Guest | **Share**; `· Guest` chip |
| Visitor, public org | **Join** (or **Request to join**) · **Follow** · **Share** |
| Visitor with a pending request | **Request pending** (disabled) · **Cancel request** |
| Visitor, private org | **Minimal header**: avatar, name, "Private organization", **Join with code**; no tabs or content |

Follow, Views and Followers appear only on **public** orgs.

### 18.3 Org tab bar by person

| Tab | Admin | Member | Guest | Visitor |
|---|---|---|---|---|
| Dashboard | ✓ landing | ✓ landing | ✓ landing | — |
| About | ✓ | ✓ | ✓ | ✓ landing |
| Updates | ✓ | ✓ | ✓ | if Public page allows |
| Docs | ✓ | ✓ | ✓ | if Public page allows |
| Sprints | ✓ | ✓ | ✓ counts only | if Public page allows |
| Tasks | ✓ | ✓ own work | ✓ counts only | never |
| Files | ✓ | ✓ | ✓ read | Public folders only, if allowed |
| Projects | ✓ | ✓ | ✓ | public child projects only |
| Members | ✓ | — (until the directory exists) | — | never |
| Settings | ✓ full | personal sections only (My membership, Notifications, Leave) | personal sections | — |

**Tab badges** (styled like the files sync badge):

| Badge | Admin | Member |
|---|---|---|
| Tasks | Submissions waiting for review (`5`) | Assignments due within 2 days (`2`) |
| Updates | Dot for unseen announcements | Dot for unseen announcements |
| Members | Pending join requests (`2`) | — |

### 18.4 Child project header

```
CSE-3A /                                         (small org logo + name, link)
[Avatar] Compiler Lab                       Views · Followers  [Invite] [Follow] [↗]
         Org only · 🚧 Parser week                     [CSE-3A admin]  ← inherited admins only
         A tiny compiler for a C subset
         (R)(A)(K) +6 | GitHub
──────────────────────────────────────────────────────────────────────────────
Dashboard  Updates  Docs  Sprints  Tasks  Files  Settings
```

| Part | Content |
|---|---|
| **Breadcrumb** (new) | Small org logo and name above the title (`CSE-3A /`). Links to the org for org members, to the org About for visitors when the org is public; outside people see the name without a link |
| Title, status, tagline, metadata | As today; team avatars cover all units |
| **Visibility chip** (new) | `Org only` or `Private` before the status; public projects show no chip |
| **Inherited admin chip** (new) | `CSE-3A admin` beside the actions, shown only to inherited org admins |
| Tabs | As today; no About tab |

### 18.5 Child header actions by person

| Person | Buttons |
|---|---|
| Lead / project admins | **Invite** (org roster picker: admins add directly, members invite) · **Follow** (public only) · **Share** |
| Inherited org admin | Same, plus the `CSE-3A admin` chip |
| Unit member | **Follow** (if public) · **Share** |
| Org member not in the project | **Share**; with open seats, the existing "N open roles" link to Apply |
| Outside people (if allowed) | As unit members; breadcrumb without a link |
| Visitor, public project | **Follow** · **Share** |

Views and Followers appear only when the project is **public**.

### 18.6 States

| State | Org header | Child header |
|---|---|---|
| Archived | `Archived` chip; one line "This organization is archived. Everything is read-only."; only Share | `Archived with CSE-3A` chip and the same line |
| Detached | — | Breadcrumb removed; normal personal project header |
| Loading | Existing header skeleton | Existing skeleton plus breadcrumb placeholder |
| Private org, non-member | Minimal header (18.2) | Not reachable, as any private project |

### 18.7 Mobile
- Identity block scrolls away; sticky tab bar stays.
- On Files / Tasks / Sprints:
  - **Org:** logo, name, **active sprint chip** (`CO1`) in place of the stage chip, ⋯ menu with New (admin), Invite (admin), Share, Org overview.
  - **Child:** avatar, name, stage chip and ⋯ menu as today; breadcrumb shortened to a small org logo before the name.

### 18.8 Examples
- Ms. Rao (admin) opens CSE-3A: Tasks `5` → Review queue; **+ New → Announcement** "Midterm moved"; Members `2` → approves requests.
- Asha (student): `· Student`, Tasks `2` (due soon), Updates dot → reads "Midterm moved".
- Visitor on public Acme Sales: lands on About with **Join · Follow · Share**; no Tasks or Members tabs.
- Ms. Rao opens Compiler Lab: breadcrumb `CSE-3A /`, chips `Org only` and `CSE-3A admin`, Settings tab and Invite available.

### 18.9 Data
Almost nothing new: org handle, type and child project count; badge counts (small queries); visibility and admin chips derived from data already loaded. Org follow reuses `project_follows`. All buttons open existing modals.

---

## 19. Docs end to end (locked 2026-10-26)

Built on today's Docs system, which stays: a doc is a Markdown file from Files shown as a readable page (README by default); doc list rail; **Add doc** picks a `.md` from Files; published versions with change summary and co-authors; heading outline; edit rule leaders only or all members; per-doc visibility (same as project / public / members only); smart blocks for roles, contributors, files, tasks and sprints plus inline references, rendered per viewer permission.

### 19.1 Purpose
The org's **single source of truth** — syllabus, handbook, policies, unit notes, templates. Teachers stop re-sending PDFs, child projects see org docs read-only, and teams start their docs from org templates.

### 19.2 Doc groups (new)
Four defaults; admins can rename, reorder and add groups.

| Group | College | Company |
|---|---|---|
| **Getting started** | Course welcome, how to submit | Onboarding, tools setup |
| **Guides & policies** | Syllabus, grading policy, honour code | Handbook, security policy, sales playbook |
| **Unit notes** | CO1 notes, CO2 notes (sprint chip) | Q3 plan, October push brief |
| **Templates** | Lab report, project proposal | Weekly report, customer brief |

A doc linked to a sprint via sprint Materials shows the sprint chip (`CO1`).

### 19.3 Creating and publishing (admin)
- **Add from Files** (existing) or **New doc** (new — creates a blank `.md` in the org's `Docs` folder and opens the editor). New doc is also available to normal projects.
- Options:

| Option | Values |
|---|---|
| Group | One of the groups |
| Visibility | **Members only** (default) · Public (org public and Public page shows Docs) |
| **Required reading** | On / off |
| **Template** | On / off (Templates group) |
| **Show in child projects** | **On by default** |
| Linked sprint | Optional |

- Editing: owners and admins only (existing "leaders" rule); the file lives in the org's `Docs` folder, and members cannot write to the org tree (Section 23).
- **Publish & notify** (new): in-app notification to members using the change summary ("Grading policy updated: late work now −10%"). For required docs, **Ask members to re-read** marks it New again for everyone.
- Without notify, a changed doc shows **Updated** for 7 days and nobody is pinged.

### 19.4 Lifecycle

| Moment | Behaviour |
|---|---|
| Draft | File exists, not published; admins only |
| Published | Members see it in its group |
| Required | **New** label and a Needs you row until opened. Read tracking comes later, reusing the same open record |
| Updated | New version with change summary; **Updated** for 7 days; notification only with Publish & notify |
| Re-read requested | New again for all members |
| Removed from Docs | File stays in Files |
| Org archived | Read-only, readable |
| Org duplicated | Docs copied to the new term |

### 19.5 Smart blocks
Existing blocks work in the org (sprints = term plan, tasks = assignments, files = materials). New kind: **Projects** (live list of child projects). Everything renders per viewer — a student's assignments block shows only their own status. Example: "Course welcome" embeds the term plan and upcoming assignments and never goes stale.

### 19.6 Org Docs tab by person
- **Admin:** doc list with groups; **New doc**, **Add from Files**; per-doc menu (edit, group, history, Required, Template, Show in child projects, visibility, remove); **Publish & notify**, **Ask members to re-read**.
- **Member:** reads published docs with outline, copy link, New / Updated labels; required docs in Needs you until opened; **Use this template** on templates → choose one of their child projects (where they can add docs) → a copy is created there. Cannot edit. **Docs have no comments** — questions go to Updates.
- **Guest:** reads, including members-only docs; no templates, no edits.
- **Visitor:** only docs marked Public, when the org is public and the Public page shows Docs (e.g. syllabus public, unit notes members only).

### 19.7 Docs in the child project
The project's own docs stay as today. The org adds:
1. **From CSE-3A** section at the bottom of the doc list, read-only: org docs with Show in child projects on, under their group names, with a lock icon. Clicking one **opens it in place** with `From CSE-3A · read-only · Open in CSE-3A →`. New labels carry over.
2. **New doc from an org template:** Add doc gains *From CSE-3A templates*. The template is **copied** (not linked) into an editable project doc, filling `{{project}}`, `{{team}}`, `{{date}}` (e.g. "Lab report: Compiler Lab — Oct 30").
3. Phase 4 starter doc lists org templates first.
4. **Submit with a doc:** on file or link assignments, Submit can pick a doc from the child project.
5. Child doc visibility is capped by the project's visibility; Public docs only in public projects.

| Person in the child project | Sees |
|---|---|
| Lead / project admins | Own docs with full editing, From org section, template copying |
| Inherited org admins | Same; their edits carry their name |
| Unit members | Own docs per the project's edit rule, From org section, template copying if allowed to add docs |
| Outside people (if allowed) | Own docs only — no From org section, no org templates |
| Visitors | Public project docs, as today |

### 19.8 Company example — Acme Sales
1. Manager creates **Sales playbook** (Guides & policies, Required) and **Weekly report** (Templates, Show in child projects).
2. Members see *Sales playbook · New* in Needs you; Kiran opens it and the label clears.
3. In North region, Kiran: **Add doc → From Acme Sales templates → Weekly report** → "Weekly report: North region — Oct 30" opens for editing.
4. Weekly pipeline report assignment: **Submit → pick doc → Weekly report**.
5. Manager updates the playbook ("New discount rules") with **Publish & notify** and **Ask members to re-read** → notification to everyone; New again in the org and in every project's From Acme Sales section.

### 19.9 Notifications

| When | Who | What |
|---|---|---|
| Publish & notify | Members (the doc's audience) | "Grading policy updated: late work now −10%" |
| New required doc / re-read requested | Members | Needs you row until opened; no push without Publish & notify |
| Updated without notify | No one | "Updated" label for 7 days |
| Template copied | No one | — |

### 19.10 Edge cases
- Doc file deleted in Files → admins see "File removed"; members don't see the doc.
- Required doc removed → its Needs you rows disappear.
- Child project detached → From org section disappears; template copies stay.
- Member leaves → nothing changes in Docs.
- Org turns private → its public docs stop being public immediately.
- Child project turns Private → still sees From org (privacy limits what goes out, not what comes in).

### 19.11 Data

| Need | How |
|---|---|
| Org docs | Reuse `project_docs` and its versions on the org project |
| Group, Required, Template, Show in child projects | New keys in the existing doc `settings` field |
| New doc | Create a `.md` in the org's `Docs` folder and link it (existing actions) |
| New / required tracking | Small "has opened" record per member and doc version; later read tracking reuses it |
| Projects smart block | One new block kind |
| From org section | Org docs with Show in child projects on, read for org members |
| Template copy | Copy content into a new child file, fill 3 placeholders |
| Submit with a doc | Assignment Submit picker can choose a project doc |

---

## 20. Members end to end (locked 2026-10-26)

Built on today's tools, which stay: collaborator management in project settings (change role, assign role seat, remove member, transfer ownership); invitations with note and expiry; guide appointments; `profiles.last_active_at`; direct messages. Already locked for orgs: role labels by type, member titles, join code with approval, requests in admins' Needs you, Members tab admin-only in v1 (directory later), leaving the org removes the person from its child projects, admins verify profile contributions.

### 20.1 Purpose
One roster answering: who is in, with what role and title · which projects and units · who is falling behind · who is waiting to join.

### 20.2 Layout
Main column = roster; right rail = Requests, Invite and summary lines. No big cards.

```
Search members…   Role ▾  Project ▾  Status ▾  Sort: Behind first ▾      ┃ Requests · 2
☐ (A) Asha Kumar · Student · Section B                                    ┃  Ravi S. · via code · 2h
     Compiler Lab · Frontend       8 of 10 done · 1 missing   2h ago  ⋯  ┃  "Section B student"
☐ (K) Kiran Rao · TA                                                      ┃  [Approve] [Decline]
     — not in a project            —                          1d ago  ⋯  ┃  Approve all
☐ (M) Meena J. · Student · Invited                                        ┃ ─────────────
     (email invite · expires Nov 2)         Resend · Cancel               ┃ Invite
                                                                          ┃  Code K7M2QX  Copy · New code
                                                                          ┃  Invite by email
                                                                          ┃ ─────────────
                                                                          ┃ 64 members · 58 students
                                                                          ┃ 4 TAs · 2 guests
                                                                          ┃ 6 behind · 12 not in a project
                                                                          ┃ 3 inactive 14 days
```

- **Row:** avatar, name, role chip, title · child projects and units · `8 of 10 done · 1 missing` · last active (mono) · ⋯ menu.
- **Filters:** Role (Owner · Admins · Members · Guests) · Project (any child project, **Not in a project**) · Status (Active · **Behind** · **Invited** · **Inactive 14 days** · **Outside people** in child projects) · Sort (Name · Joined · Last active · **Behind first**).
- Rail summary lines are filter links.

### 20.3 Member drawer
Side panel like the task drawer.

| Section | Content |
|---|---|
| Header | Avatar, name, role, title, joined, last active, **View profile**, **Message** |
| **Work** | Assignments by sprint with status (Done, Late, Missing, Excused), linking to their copy |
| Projects & units | e.g. `Compiler Lab · Frontend · Unit lead` |
| Recent activity | Last 10 events |
| Membership | Change role, edit title, remove |
| Profile credit | **Verify contribution** |

### 20.4 Roles and titles
- Roles: owner / admin / member / viewer with the type's labels.
- **Exactly one owner**; ownership changes only via **Transfer ownership** (Settings → Danger).
- Owner can do everything. Admins add, remove and change roles of **members and guests**. **Only the owner** promotes to admin, demotes or removes an admin.
- **Titles** are free text ("Section B", "TA · Lab 2"); members set their own (Settings → My membership); admins can edit anyone's.

### 20.5 How people come in
1. **Join code** — always joins as **Member**. In approval mode the person lands in Requests, with an optional note ("Section B student").
2. **Invite by email** — paste emails (comma or newline); role **Member, Admin or Guest** (admins and guests only this way); optional title, child project and unit. Existing users get the in-app invitation (note, expiry). People without an account get an email invite that waits until they **sign up with that email**. Pending invites show as **Invited** with Resend / Cancel.
3. **Requests** — name, email, "via code · 2h ago", note; **Approve**, **Decline** (optional reason), **Approve all**. A declined person may ask again after the existing application cool-down.

**Max members** (Settings → Access & joining), off by default. When full: the code says "This organization is full", approvals are blocked, admins can raise the cap.

### 20.6 Bulk actions
Select rows or **Select all in filter**:

| Action | Example |
|---|---|
| **Remind** about missing work | Everyone in Behind |
| **Change role** | Make 4 people TAs (owner only) |
| **Add to child project** | Child project and unit picker; direct-add |
| **Verify contributions** | End-of-term verification |
| **Remove** | One confirmation |

Bulk messaging comes later; use an Announcement with an audience.

### 20.7 Leaving and removal
- **Member leaves** (Settings → Leave): confirmation lists the effects — removed from all child projects (seats reopen); assignment copies archived, submissions stay for admins; profile entry stays (verified or not). **The owner cannot leave** without transferring ownership.
- **Admin removes:** same effects, optional reason, notification "You were removed from CSE-3A". Removed people **can rejoin with the code** unless **Block from rejoining** is ticked ("You can't join this organization"). A tip suggests regenerating the code after a removal for misuse.
- **Account deleted:** row disappears; submissions show "Deleted user".
- **Owner account deleted:** owners must transfer or delete their orgs before deleting their account; only an **involuntary** removal passes ownership to the longest-serving admin, who is notified (Section 30.7).

### 20.8 Who sees what

| Person | Members tab |
|---|---|
| Owner | Everything, including managing admins and Transfer ownership |
| Admin | Everything except changing or removing admins and the owner |
| Member | **Hidden in v1**; sees people via header avatars and child project collaborators. Directory later: names only (Education), full list (Company) |
| Guest | Hidden |
| Visitor | Never. Public org header avatars show **only members with "Show on my profile" on**; the count stays the full number |

In child projects there is no Members tab: Settings → Collaborators groups people by unit, shows inherited org admins read-only and labels outside people **"Outside CSE-3A"**.

### 20.9 Company example — Acme Sales
1. Manager pastes 12 emails into Invite by email: Member, title "North region", child project North region.
2. Nine existing users accept in-app; three sign up later with those emails and land in the org and North region.
3. Rail shows "2 behind" → filter → select both → **Remind**.
4. A contractor is invited as **Guest** to review progress (counts only).
5. Lee leaves the company → removed with **Block from rejoining**; code regenerated.

### 20.10 Notifications

| When | Who | Message |
|---|---|---|
| Join request | Admins | Batched: "3 people asked to join CSE-3A" |
| Approved / declined | Requester | "You're in CSE-3A" / "Your request was declined" (+ reason) |
| Invited | Invitee | In-app invitation plus email E2; without an account, email E3 (Section 26) |
| Invite accepted | Inviter | Low priority: "Meena joined CSE-3A" |
| Role changed | Member | "You're now a TA in CSE-3A" |
| Removed | Member | "You were removed from CSE-3A" |
| Someone left | Admins | Low priority |
| Ownership passed | New owner | "You're now the owner of CSE-3A" |

### 20.11 Edge cases
- Joining when already a member → "You're already in CSE-3A."
- Requesting while an invite is waiting → invite accepted automatically.
- Mistyped invite email → cancel and resend; invites match the exact address only.
- Org archived → roster read-only; leaving still allowed.
- Cap lowered below the current count → nobody removed; new joins blocked until below the cap.

### 20.12 Data

| Need | How |
|---|---|
| Org members | Reuse `project_members` on the org project |
| Title, Show on my profile | New `title`, `show_on_profile` on the membership |
| Join requests | Reuse the applications flow without a role (pending / accepted / declined, cool-down) |
| Invites for existing users | Existing `project_invitations` |
| Invites without an account | Small pending-email-invite table (email, role, title, project, unit, expiry), matched at sign-up |
| Block from rejoining | Small block list (org, person) |
| Work counts and Behind | Derived from each member's assignment copies |
| Last active | Existing `profiles.last_active_at` |
| Max members | Reuse `max_collaborators` on the org project |

---

## 21. Settings end to end (locked 2026-10-26)

Built on today's project Settings, which stays: section list on the left (dropdown on mobile), each section saved on its own. Today's sections: General · Links · Access & Visibility (incl. public tabs) · Team Members · Roles & Applications · Documentation · Updates & Discussions · Lifecycle & Workflow (journey, task defaults, review) · Files & Storage · Notifications · Privacy and Policies · Danger Zone (archive, transfer, delete with pre-checks). The owner alone transfers, archives, deletes and edits General; admins manage public tabs, notifications, collaborators, roles, tasks and files; members do not open Settings today.

### 21.1 Principles
1. Settings show only what you can act on.
2. Every section opens with one plain sentence; every option has one line of help with an example and the type default.
3. Org-enforced rules appear in child projects as locked rows 🔒 *"Set by Acme Sales"*; org admins also see **View in Acme Sales →**.
4. Risky changes show an **impact preview** before saving ("This will change 2 projects to Org only and notify their leads").
5. Each section footer shows **"Last changed by Ms. Rao · Oct 26"**; full history later.

### 21.2 Org sections
Owner-only items are marked **(owner)**; everything else is for owners and admins.

| # | Section | Contents |
|---|---|---|
| 1 | **General** | Avatar · **Name and @handle (owner)** · Type · Category · Tagline · Description · Problem · Solution · Tags · Links · Term dates · **Time zone** · **Welcome note** · **Request verification** (Section 30.3). This is the About tab content |
| 2 | **Access & joining** | **Public / Private (owner)** · **Join code** (copy, regenerate) · **Join mode** (instant / approval) · **Max members** (off) · **Public page** tabs (About always; Updates, Docs, Sprints, Projects, Files (Public folders only) optional; Tasks and Members never) |
| 3 | **People & roles** | **Role names (owner)** · read-only plain-language table of what each role can do · "Only the owner manages admins" |
| 4 | **Projects** | **Who can create** (All members default / Admins only) · **Visibility cap** · **Outside people** (off) · **Default units** · **New projects follow org sprints** (on) |
| 5 | **Work** | Assignments: **Review required** default · **Late submissions** default · **Reminders** (24 h before / due day) · **Story points** shown or hidden. Sprints: **Start automatically** default · **Notify on start** · **Show in child projects** default · **Create matching sprints** default (off) |
| 6 | **Docs** | **Doc groups** (rename, reorder, add) · **Show new docs in child projects** default (on) |
| 7 | **Files** | **Member uploads to the org tree** (off by default; members always submit on their own copies) · **Notify members** default for admin uploads (off) · **Starter folders** by type (Section 23) |
| 8 | **Updates & messages** | **Members can post** · **Child projects can share to the org** (on) · **Default notify level** (in-app) · **Default reply rule** (org members) · **Who can post in #general** · **Members can create org channels** · **Default notifications for #general** (Section 25.4) |
| 9 | **Notifications** | Existing editor as the **org default for members** (announcements, assignments and reminders, sprints, membership) · **Admin batching**: daily digest E11 (default) or instant (Section 26) |
| 10 | **Profile credit** | **Members can show this org on their profile** (on) · **Verify contributions** in bulk · verified label text ("Verified by CSE-3A") |
| 11 | **Privacy & policies** | Existing section for the org's code of conduct or terms; linked on the join screen |
| 12 | **Lifecycle & danger (owner)** | **Duplicate for next term** · **Archive / Unarchive** · **Transfer ownership** · **Delete** (child projects: delete or detach to leads) |

### 21.3 Personal sections — "You" (everyone in the org, admins included)

| Section | Contents |
|---|---|
| **My membership** | Role (read-only), **title** (editable), joined date, **Show this org on my profile** |
| **My notifications** | Use org default, or customise: announcements (in-app / email), assignment reminders, sprint notices, comments |
| **Leave organization** | Preview of effects (removed from child projects, copies archived, submissions kept); owner sees "Transfer ownership first" |

### 21.4 Who sees which org sections

| Person | Sections |
|---|---|
| Owner | You (3) + all 12 |
| Admin | You (3) + sections 1–11; owner-only items read-only with "Only the owner can change this"; section 12 hidden |
| Member | You (3) |
| Guest | You (3); role reads "Guest · read-only" |
| Visitor | No Settings tab |

### 21.5 Defaults by org type

| Setting | Education | Company | Community / Research / Club |
|---|---|---|---|
| Role names | Teacher / TA / Student / Guest | Owner / Manager / Member / Guest | Owner / Admin / Member / Guest |
| Review required for assignments | **On** | Off | Off |
| Members can post updates | **Off** | On | On |
| Story points | **Hidden** | Shown | Shown |
| Who can create child projects | All members | All members | All members |
| Late submissions | Allowed until a date | Always allowed | Always allowed |
| Member directory (later) | Names only | Full list | Full list |

### 21.6 Child project settings

| # | Section | Change |
|---|---|---|
| 1 | General | As today |
| 2 | **Organization** (new, second) | Parent org link · **Inherited rules** as locked rows (visibility cap, outside people, share to org, review of org assignments) · **Follow org sprints** · linked sprint · **Inherited admins** (read-only) · **Detach** (request for lead, immediate for org admin) · **Move to another org** (two steps) |
| 3 | Links | As today |
| 4 | Access & Visibility | **Public / Org only / Private**; blocked options as locked rows; public tabs as today |
| 5 | Team Members | Grouped **by unit**; invite via the **org roster** (admins add, members invite); outside people labelled **"Outside Acme Sales"**; inherited admins read-only; transfer ownership |
| 6 | **Units & open seats** (was Roles & Applications) | Units (rename, seats, unit lead); open seats visible to org members; applications as today |
| 7 | Documentation | As today; From org section has no setting |
| 8 | Updates & Discussions | As today; **Share to org** allowed or locked per org rule |
| 9 | Lifecycle & Workflow | Journey, task defaults, **review for own tasks**; locked row "Org assignments are reviewed by Acme Sales" |
| 10 | Files & Storage | As today; the From org view has no setting |
| 11 | Notifications | As today (project level) |
| 12 | Privacy and Policies | As today |
| 13 | Danger Zone | Archive (locked if org archived) · Transfer ownership (project members only) · **Detach** · Delete; pre-checks as today |

| Person | Child project sections |
|---|---|
| Lead (owner) | All 13 |
| Project admins | All except owner-only items |
| Inherited org admins | As project admins, plus **Approve detach** and **Detach now** |
| Unit members | **My notifications** · **Leave project** |
| Outside people | **My notifications** · **Leave project**; no Organization section |
| Visitors | No Settings tab |

### 21.7 When the org changes a rule

| Org change | Effect on child projects |
|---|---|
| Visibility cap tightened | Projects above the cap are **lowered automatically**; leads notified ("North region is now Org only because Acme Sales changed its rules"); shown in the preview first |
| Outside people turned off | **Existing outside people stay** until removed; no new ones; Members filter shows "3 outside people remain" |
| Share to org turned off | Toggle locked; already-shared posts stay |
| Default units changed | New child projects only |
| Who can create → Admins only | Existing projects stay; open drafts re-checked at submit |
| Follow org sprints default changed | New projects only |
| Org goes private | Public child projects become Org only; public posts and docs leave Discover |
| Org archived | Child projects read-only; Settings shows "Archived with Acme Sales" |

| Enforced in child projects (locked) | Defaults only (child may change) |
|---|---|
| Visibility cap · Outside people allowed · Share to org allowed · Review of org assignments · Detach needs admin approval · Only org members (or allowed outside people) can join | Default units · Follow org sprints · Starter doc templates · Member upload default |

### 21.8 Company example — Acme Sales / North region
1. Manager (owner) → Projects → **Visibility cap: Org only**. Preview: "1 project (Enterprise accounts) will change from Public to Org only." Saved; the Enterprise lead is notified.
2. Work → **Review required** on, reminders 24 h before.
3. North region lead → **Organization**: 🔒 Visibility cap Org only · 🔒 Outside people not allowed · Follow org sprints On (editable) · Inherited admins: the manager.
4. Access & Visibility: **Public** greyed with a lock; **Org only** selected.
5. Kiran (member) sees only **My notifications** and **Leave project** in the child project, and the three **You** sections in the org.

### 21.9 Mobile
Existing section dropdown; **You** group first; locked rows keep the lock and "Set by" text.

### 21.10 Notifications

| When | Who | Message |
|---|---|---|
| Child project lowered by an org rule | Its lead and admins | "North region is now Org only because Acme Sales changed its rules" |
| Detach requested | Org admins | Needs you: "North region wants to leave Acme Sales" |
| Detach approved / declined | Lead | "North region left Acme Sales" / "Detach declined" |
| Join code regenerated | Admins | Low priority: "The join code was changed by Ms. Rao" |
| Ownership transferred | New and previous owner | Existing message |
| Org archived / unarchived | All members | "CSE-3A is archived. Everything is read-only" |

### 21.11 Data

| Need | How |
|---|---|
| Org settings | On the org project (existing columns plus new org fields); existing sections reused where they fit |
| Type defaults | One defaults table applied at creation |
| Locked rows | Derived from the parent org's rules; nothing copied |
| Rule changes reaching children | One server action per rule with preview, notices and automatic lowering |
| "Last changed by" | Who and when per section |
| Personal sections | Existing member notification preferences plus `title`, `show_on_profile` |
| Detach requests | Small request record approved by an org admin |

---

## 22. About tab end to end (locked 2026-10-26)

The org About tab **is the project Dashboard page for an organization**: same layout, same components, same order.

### 22.1 Where the Journey lives
- The Journey is in the **About** rail, in the same place as on a project Dashboard. The org Dashboard rail does **not** show it (the Dashboard's This sprint block already covers the current sprint).
- **The Journey is built from the org's sprints**: each sprint is a stop (✓ done with completion date, ● current, ○ planned with start date) and it **advances by itself** as sprints start and complete. No manual "Advance stage".
- Orgs do **not** use manual journey stages; Phase 4 "Journey stages" is replaced by **Plan your first sprints**.

### 22.2 Layout

```
┌───────────────── main (8) ─────────────────┐ ┌──────── rail (4) ────────┐
│ About CSE-3A 2026                 [Edit]   │ │ Journey                  │
│ Data Structures, Section A — a semester…   │ │ ✓ CO1 · Arrays   Oct 3   │
│ Read full description                      │ │ ● CO2 · Trees    now     │
│                                            │ │ ○ CO3 · Graphs   Nov 10  │
│ The problem   Students juggle WhatsApp…    │ │ ○ CO4 · Sorting          │
│ The solution  One place for notes, labs…   │ ├──────────────────────────┤
│                                            │ │ Recent activity          │
│ Category  Education · Computer science     │ │ CO1 completed · 3d       │
│ Focus     #dsa #c #algorithms              │ │ Compiler Lab created · 5d│
│                                            │ ├──────────────────────────┤
│ 64 members · 12 projects · since Aug 2026  │ │ Join CSE-3A              │
│ · Term Aug–Dec · Asia/Kolkata              │ │ [Join] or have a code?   │
│                                            │ ├──────────────────────────┤
│ Projects                       See all →   │ │ Leaders                  │
│ Compiler Lab · Quiz App · Heap Visualizer  │ │ Ms. Rao · Teacher        │
│                                            │ │ Kiran · TA               │
└────────────────────────────────────────────┘ └──────────────────────────┘
```

**Main column** (existing `ProjectOverviewCard`, reused)

| Block | Content | Source |
|---|---|---|
| Overview | Description (Read full description), **The problem**, **The solution** | Phase 2 |
| Category and Focus | Category and type; tags as focus chips | Phase 2 |
| **Facts line** (new) | `64 members · 12 projects · since Aug 2026 · Term Aug–Dec · Asia/Kolkata` | Org data, Settings → General |
| **Projects** (new) | Up to **3 child projects** the viewer can see, most active first; **See all →** to the Projects tab | Child projects |

**Right rail** (same order as a project Dashboard)

| Card | Replaces on a project | Content |
|---|---|---|
| **Journey** | Journey (same component, rail layout) | Sprints as stops |
| **Recent activity** | Recent activity (same component) | **Public-safe milestones only**: sprint completed, child project created, members joined as a count ("5 people joined this week"), public announcements |
| **Join** | Open roles | Per viewer (22.3) |
| **Leaders** (new) | — | Owner and admins with role names; members can Message them |

### 22.3 By person

| Person | About shows |
|---|---|
| Owner / Admin | Everything plus **Edit** (existing edit dialog with org fields = Settings → General); empty-state prompts ("Add the problem CSE-3A solves"); Journey empty → **Plan your term** (Plan a series); Join card becomes **Invite** (code `K7M2QX` · Copy · Invite by email) |
| Member | Everything, read-only; Join card becomes **You're a Student · joined Aug 2**; Message on leaders |
| Guest | As a member; card reads **Guest · read-only** |
| Visitor, public org (landing) | Overview, facts, up to 3 **public** child projects; **Journey only if the Public page shows Sprints**; public-safe activity; Join card (**Join** / **Request to join** / **Request pending · Cancel**, "Have a code?"); **leaders only if "Show on my profile" is on** |
| Visitor, private org | No About tab — minimal header with **Join with code** |

### 22.4 Lifecycle

| Moment | About shows |
|---|---|
| Created | Phase 2 text; Journey from sprints planned in Phase 4, or "Plan your term" for admins |
| During the term | Journey advances with sprints; activity and facts update |
| Archived | `Archived` chip; all Journey stops done; no Join card; readable |
| Duplicated | Text copied; Journey shows the copied plan with new dates; facts reset |
| Turns private | About disappears for visitors (minimal header) |

### 22.5 Child projects
No About tab (decision 1). The child Dashboard **keeps its overview card at the top**, then Needs you + This sprint (Section 27.5); the rail stays as today (project Journey with manual stages, Recent activity, Open roles) plus the org line `Part of CSE-3A · CO2 ends Fri · 1 assignment due`.

### 22.6 Connections
Discover org cards open About. `/join/CODE` lands joiners on Dashboard; visitors who do not join see About. Search results and shared links for a public org open About; the header's Share copies the About link.

### 22.7 Company example — Acme Sales
- A visitor from Discover lands on **About**: "Sales team for the APAC region…", problem and solution, `42 members · 3 projects · since Jan 2026`, Projects: North region · Enterprise accounts; no Journey (Sprints not public); **Join** (approval) and Leaders.
- The manager sees the same page with **Edit**, the **Journey** (✓ September push → ● October push → ○ November push) and the **Invite** card.

### 22.8 Data
Journey = existing component fed with the org's sprints by date. Facts derived from existing data. Projects block = 3 most active visible child projects. Activity = existing source filtered to public-safe milestones. Edit reuses the existing dialog.

---

## 23. Files end to end (locked 2026-10-26)

Designed from the current Files tab, not from the earlier 7.7 plan.

### 23.1 Today's Files tab (the base)

| Area | What exists |
|---|---|
| Structure | One folder tree per project: upload files / folder, New file, New folder, move (drag and drop or Move…), rename, star |
| Sidebar views | **Project files** · **Task files** (grouped by task) · **Deliverables** (submitted outputs with per-version review status) · **Recent**, **Starred** (browser-saved) · **Trash** · **GitHub sync** |
| Task file roles | **Working file**, **reference** or **deliverable**. Task working files are task-owned drafts hidden from the tree and must be **published** to Project files before they can be moved |
| File view | Preview / Raw · **Edit** (browser editor with exclusive **edit locks**) · **Version history** (compare, restore, upload revision) · Details · **Linked tasks** with annotations · Copy link · Download · Add to / Remove from Docs · **Open in IDE** (Cursor, VS Code, NB extension) |
| Tools | **Quick open** (access-aware) · **Transfers** panel · Trash (restore, delete permanently, empty) · per-file labels |
| Permissions | Owner and admins manage; members write only with their **upload switch** on; viewers read-only; visitors read when the public Files tab is on |
| Limits | Existing per-file upload limit (10 MB default) and path rules |

### 23.2 What the org needs
1. Admins publish materials members can read but not change.
2. Some material is staff-only (answer keys, exam papers, HR).
3. Members hand in work that stays private to them (or their team) and the admins.
4. Admins collect, review and download that work in one place.
5. Child projects use org material without re-uploading.
6. Everything else stays: versions, edit locks, IDE, search, Trash.

### 23.3 Org Files structure

**One org tree with folder access levels:**

| Access | Who can open | Example |
|---|---|---|
| **Admins only** 🔒 | Owner and admins (not guests) | `Staff/answer-keys`, `Leadership/budgets` |
| **Members** (default) | All org members and guests | `Course materials/CO1`, `Sales collateral` |
| **Public** 🌐 | Also visitors, when the org is public and the Public page shows Files | `Public/syllabus.pdf` |

- Access is **inherited and only stricter going down**.
- **Starter folders by type:** Education `Course materials` · `Docs` · `Templates` · `Staff` 🔒; Company `Shared` · `Docs` · `Templates` · `Leadership` 🔒.
- **Template mark** on folders: listed in child project creation Phase 1 "From an org template".
- Chips: 🔒 Admins only · 🌐 Public · `Template` · existing version pill.

**Sidebar by person**

| View | Admin | Member / Guest |
|---|---|---|
| **Org files** (was Project files) | Whole tree | Tree without Admins-only folders; read-only |
| **Sprint materials** (new) | Files grouped by sprint, same layout as Task files | Same, read-only |
| **Task files** | Staff task files and every assignment copy, grouped by assignment | **My work**: files on their own copies (working files, materials as references) |
| **Deliverables** (labelled **Submissions** in Education) | Every submission by assignment → person or team, with review status and versions; includes child project group copies | Their own submissions only |
| Recent / Starred | As today | As today (accessible files only) |
| Trash | As today | Hidden |
| GitHub sync | Hidden for orgs in v1 | Hidden |

### 23.4 Org Files actions by person

| Action | Admin | Member | Guest | Visitor |
|---|---|---|---|---|
| Browse, preview, Raw, Download, Copy link | ✓ | ✓ (Members, Public) | ✓ | Public only |
| Upload files / folder, New file, New folder | ✓ with optional **Notify members** (off) | ✗ in the org tree | ✗ | ✗ |
| Edit (lock), upload revision, restore version | ✓ | ✗ (history visible) | ✗ | ✗ |
| Rename, Move, Move to trash | ✓ with access warnings | ✗ | ✗ | ✗ |
| Set folder access, mark Template | ✓ | ✗ | ✗ | ✗ |
| Link to sprint (Materials) | ✓ (also from the Sprint modal) | ✗ | ✗ | ✗ |
| Attach to task / assignment as reference | ✓ | ✗ | ✗ | ✗ |
| Add to Docs (`.md`) | ✓ | ✗ | ✗ | ✗ |
| Open in IDE | ✓ edit | ✓ read-only copy | ✓ read-only | ✗ |
| Star, Recent, Quick open | ✓ | ✓ (accessible only) | ✓ | — |
| Trash: restore, delete permanently, empty | ✓ | — | — | — |
| **Download all** submissions (zip) | ✓ | — | — | — |

### 23.5 Submissions = task files on assignment copies
No separate "My files" space. Each person's or team's copy is a task, and today's task files cover the flow:
1. **Submit** on the copy uploads a file as a **deliverable on that copy**, stored with the copy. **Members can always add files to their own copy**, even when org-tree upload is off.
2. **Privacy is automatic**: a copy's files are visible only to the people on the copy and the admins (decision 19 read rule, extended to team members).
3. **Per-version review** (existing): resubmitting creates a new version needing new approval; approval stamps that version.
4. Admin view:
   ```
   Lab 2 · due Fri · 22 of 30 submitted                  [Download all]
     Asha Kumar        lab2.zip   v2 · Approved
     Team A (3)        report.pdf v1 · In review · submitted by Asha
     Ravi S.           —          Missing
   ```
   Each row opens the existing file view and version compare with **Approve / Return**.
5. **Download all**: one folder per person or team with the latest submitted version; excused people skipped; big jobs run in the background with a "ready" notification.
6. Members see their own deliverables only. Materials attached by the admin appear on the copy as **references** into the org tree (no copies).

### 23.6 Child project Files
Everything as today (tree, Task files, Deliverables, Recent, Starred, Trash, GitHub sync, IDE, edit locks), plus:

| Addition | Behaviour |
|---|---|
| **From CSE-3A** view | The org tree **read-only**, minus Admins-only folders, opened in place: `From CSE-3A · read-only · Open in CSE-3A →` |
| **Copy to this project** | Copies an org file or folder into the current folder using the **same stored file** (no re-upload); chip `Copied from CSE-3A · v2` |
| **Source updated** hint | `Newer version in CSE-3A (v3)` with **Update copy** (saves as a new version of the copy, existing version flow) |
| **Start from an org template** | Phase 1 copies a Template folder into the new project tree |
| Org group assignments | The group copy's deliverables appear in Deliverables, marked `Reviewed by CSE-3A` with the org's status |
| Inherited org admins | Full access, like project admins |

| Person | Child Files |
|---|---|
| Lead / project admins | Everything as today, plus From org, Copy, Update copy |
| Inherited org admins | Same |
| Unit members | As today (writing per upload switch); From org read; Copy if they can upload |
| Outside people | As members today; **no From org view**; org links show "Not available" |
| Visitors | Public project files as today; never From org |

### 23.7 Company example — Acme Sales
1. Manager uploads `Pitch deck v3.pptx` to `Shared/Collateral` with **Notify members** → "New file in Acme Sales: Pitch deck v3". Budgets live in `Leadership` 🔒.
2. Manager links `Pricing sheet.xlsx` to the October push sprint → appears in **Sprint materials**.
3. In North region, Kiran opens **From Acme Sales → Shared/Collateral → Pitch deck v3 → Copy to this project** → `Copied from Acme Sales · v3`.
4. Manager uploads v4 → Kiran's copy shows `Newer version in Acme Sales (v4) · Update copy`.
5. Kiran submits `pipeline-oct-27.xlsx` on North region's group copy → manager's Deliverables: `North region · pipeline-oct-27.xlsx · v1 · In review` → **Approve**.

### 23.8 Lifecycle

| Event | Org files | Submissions | Child copies |
|---|---|---|---|
| File updated | New version | — | Source updated hint |
| Folder access changed | Visibility changes immediately after a preview | — | From org updates |
| File trashed | Restorable; warning if in use | — | Copies unaffected |
| Member removed / leaves | — | Stay for admins; person loses access | — |
| Copy excused / archived | — | Kept; **Archived** filter | — |
| Child project detached | — | Group deliverables stay in the project | Copies stay; From org disappears |
| Org archived | Read-only; downloads allowed; no edit locks | Read-only; people keep access to their own | From org read-only |
| Org duplicated | Tree copied with access levels and template marks | Not copied | — |

### 23.9 Gap check

| # | Gap | Resolution |
|---|---|---|
| 1 | Members can't upload to the org tree but must submit | They can always add files to their own copy only |
| 2 | Assignment material in an Admins-only folder | Warning when attaching; members see "You don't have access" |
| 3 | Shared link to an Admins-only file | Access checked on open; generic "not found" |
| 4 | Search reveals hidden names | Search and Quick open filter by access |
| 5 | Moving files between access levels | Preview: "Members will lose access to 3 files" / "3 files will become visible" |
| 6 | Doc `.md` in an Admins-only folder | Doc visibility cannot exceed its folder's access; moving it there makes the doc admins-only with a notice |
| 7 | Team member removed | Files stay with the team copy; removed person loses access |
| 8 | Excused / archived copies | Files kept under an Archived filter |
| 9 | Outside people meet org links | "Not available"; From org hidden |
| 10 | Org updates a copied file | Copy stays independent; Source updated + Update copy, no silent changes |
| 11 | Trashing an org file in use (material, reference, template) | Warning lists usages; references show "File in Trash"; trashed template leaves the wizard |
| 12 | Storage counted twice for copies | Copies point to the same stored file; counted once |
| 13 | Member edits org file in the IDE | Read-only; no edit lock without upload rights |
| 14 | Group copy deliverables live in child projects | Org Deliverables also lists child project group copies |
| 15 | Download-all for a big class | Background job, ready notification, excused skipped |
| 16 | Public folder inside a Members folder | Not allowed — access only stricter going down |
| 17 | Recent / Starred shows a now-hidden file | Already excluded |
| 18 | Submitting after the assignment closed | Blocked: "Lab 2 is closed" |
| 19 | Submission changed after approval | New approval required (existing) |
| 20 | Copy name clash | Existing conflict handling: `name (1)` or new version |
| 21 | Dataset over the upload limit | Existing limit in v1; raise for orgs later |
| 22 | GitHub sync could publish Admins-only files | No GitHub sync for orgs in v1 |
| 23 | Guest examiners need submission files | Guests see counts only; make them Admin if needed; **Reviewer role later** |
| 24 | Member's mistaken submission | Remove the file before review; after submitting, upload a new version |
| 25 | Org archived with active edit locks | Locks released, edits blocked, unsaved browser text kept read-only (existing) |
| 26 | Team member opens a teammate's working file | Allowed — team members share their copy's files |
| 27 | "Shared space" wording in Docs | Retired; new docs go to the org's `Docs` folder |
| 28 | Child project's own files | Follow the child project's rules, unaffected by the org |

### 23.10 Notifications

| When | Who | Message |
|---|---|---|
| Admin upload with Notify members | Members who can open the folder | "New in CSE-3A: CO2 slides" |
| Submission arrives | Admins | Batched (assignment rule) |
| Download-all ready | Requesting admin | "Lab 2 submissions are ready to download" |
| Source updated | — | Hint on the copy only |
| Folder access narrowed | — | Preview only |
| Files moved / published | Existing "files organized" notice | Existing |

### 23.11 Data

| Need | How |
|---|---|
| Org files | Reuse `project_nodes`, file versions, edit locks and Trash on the org project |
| Folder access | `access` on folders (admins / members / public), inherited and only stricter; checked on reads, search and links |
| Template mark | `template` on folders |
| Sprint materials | Sprint → file link table |
| Submissions | Existing task-owned files and the deliverable role on assignment copies |
| Upload to own copy | Capability rule: allowed even with the upload switch off |
| From org view | Org tree minus Admins-only folders, read for org members inside a child project |
| Copy to project | New node pointing to the same stored file, with its source (node, version) |
| Source updated | Compare the copy's source version to the org file's current version |
| Download all | Background zip job with notification |
| Default folders | Created at org creation by type |

---

## 24. Cards, Discover and profile contributions (locked 2026-10-26)

Built on what exists: **ProjectCard** (avatar, title, 2-line tagline, up to 6 skill tags; footer with team avatars, "N open roles" or the viewer's application chip, links, views, follow bell); profile tabs **Overview** (Project contributions card) and **Portfolio** (grid of project cards); contribution entries (project, role title, dates, recorded and editable **position history**, a **story** with summary, images incl. project files, skills, links, **verification** by a person on the project shown as "Platform verified role", featured, public/private, drafts; created automatically on create/join, private until published); Discover views All · Trending · For you · Following with sort, Type, Stage, Skills, search and Hide opened, public items only.

### 24.1 Organization card
Same card with an org variant:

```
┌───────────────────────────────────────────────────────────────┐
│ [Logo] CSE-3A 2026                              Education     │
│        Data Structures, Section A — Aug–Dec 2026 semester…    │
│ #dsa  #c  #algorithms                                         │
│ (R)(A)(K)(M) +60   12 projects  · Member     🌐 ⓘ  📊 1.2k 🔔 84│
└───────────────────────────────────────────────────────────────┘
```

| Part | Project card | Org card |
|---|---|---|
| Avatar, title | Project avatar and title | Org logo and name; **type chip** on the right |
| Line 2 | Tagline | Org tagline |
| Tag row | Skill tags | **Focus tags** (org tags), same style and skill icons where they match |
| Footer left | Team avatars · open roles or application chip | **Member avatars** (only members with Show on my profile; full count) · `12 projects` · viewer **membership chip** (`Member` / `Requested` / `Invited`) |
| Footer right | Links · views · follow bell | Same; Follow on public orgs only |
| Click | Opens the project | Opens the org **About** tab |

Appears on Discover (public orgs), profile Portfolio, search results, and the Projects tab empty state. Private orgs never appear to non-members; on your own profile a private org card shows `Private · only you`.

### 24.2 Child project card
The same project card with **one line above the title** mirroring the child header breadcrumb:

```
┌───────────────────────────────────────────────────────────────┐
│ ▪ CSE-3A /                                                    │
│ [Av] Compiler Lab                                             │
│      A tiny compiler for a C subset                           │
│ React  TypeScript  C                                          │
│ (R)(A)(K) +3   1 open role                    ⧉  📊 230  🔔 12│
└───────────────────────────────────────────────────────────────┘
```

- The org line (small logo + name) is its own link to the org, layered above the card link like today's link icons.
- Everything else is today's card; avatars cover all units; open roles count open unit seats.
- No visibility chip on Discover (public only). In org contexts (org Projects tab, own profile) cards show `Org only`.

### 24.3 Discover

| Change | Behaviour |
|---|---|
| Org cards in the feed | New `organization` feed item following existing sort, views and ranking; For you uses focus tags and skills |
| **Show** filter | **Everything · Projects · Organizations · Updates**, beside Type, Stage, Skills |
| **Organization filter** | Org chip **⋯ → Show everything from CSE-3A**, or `?org=cse-3a`: public child projects and public updates, with a removable `CSE-3A ×` chip |
| Following | Followed orgs add **public announcements** and **new public child projects** |
| Search | Org name, @handle, tagline, focus tags |
| Update cards | Public org announcements show org identity (logo, name, type chip); shared-up child updates show the project with its org line |
| Privacy | Existing rules: only public orgs, public child projects and public posts |
| Hide opened, Refresh, people rail | Unchanged |

### 24.4 Profile — Portfolio and Overview
- **Portfolio:** **Organizations** group at the top (org cards for orgs the member chose to show; current first, then most recent), then **Projects** as today (child projects with their org line).
- **Overview:** the **Organizations** logo-chip row in the right rail (`[logo] CSE-3A · Student`); the Project contributions card holds org entries (24.5).
- An org appears on a profile only when the member has **Show this org on my profile** on **and** the org is public or the viewer is the profile owner. Private orgs: owner only, `Private · only you`.

### 24.5 Org contribution entries
**Creation:** like projects — creating an org adds an entry (source owner), joining adds one (source membership). **Private until published.** The welcome panel's **Add to your profile** opens it.

```
[Logo] CSE-3A 2026 · Education                       ✓ Verified by CSE-3A
Student · Section B · Aug 2026 – Dec 2026
Position history:  Student (Aug–Oct) → TA, Lab 2 (Oct–Dec)
"Completed the DSA course and ran Lab 2 sessions as a TA…"   Read contribution
Skills: C · Data structures · Teaching
  ├ [Av] Compiler Lab · Frontend developers · Unit lead · Sep–Nov
  │      "Built the parser and the error reporter…"           Read contribution
  └ [Av] Heap Visualizer · Member · Nov–Dec
         "Animated heap operations in React…"                 Read contribution
Work record: 12 of 12 assignments · 5 sprints        (only if turned on)
```

| Part | Source |
|---|---|
| Header | Org logo, name, type chip; **✓ Verified by CSE-3A** when an org admin verified |
| Role line | Org role name, member title, dates (joined → left or term end) |
| Position history | Recorded automatically (Student → TA, Member → Manager) |
| Story | Written by the member (existing story editor) |
| **Nested child projects** | Each child project contribution grouped under its org entry: project, unit, unit-lead mark, role, dates, short summary, **Read contribution** |
| **Work record** | Optional, **off by default**: counts from platform records (`12 of 12 assignments · 5 sprints`), not editable |

| Person | Org entry | Child project entries |
|---|---|---|
| Owner / Admin | Own role story; **Start from About** pre-fills from the org description (editable). About stays org content | As any project member |
| Member | Own words; **Start from my work** inserts an editable list of completed assignments and child projects. Images from **their own submissions** and child project files, never Admins-only org files | Own words; **role filled from their unit** ("Frontend developers · Unit lead"); images from project files |
| Guest | No automatic entry; manual allowed | — |
| Outside people | No org entry | Standalone, labelled "Project of CSE-3A" (not nested) |

**Verification** — the existing verification, done by **org admins** (one by one or bulk), shown as **"Verified by CSE-3A"**. It covers **role and dates, not the text**. Child entries are verified by the child lead / admins or inherited org admins. Admins can **revoke** with a reason (member notified). Editing the story keeps verification.

| Event | Entry |
|---|---|
| Role change | Added to position history |
| Leaves / removed | End date set ("Left Oct 2026"); verification stays unless revoked |
| Org archived | "Term ended Dec 2026", not current; admins prompted to bulk-verify |
| Org duplicated | New org, new entries; old untouched |
| Child project detached | Child entry stays labelled "with CSE-3A (until Nov 2026)" and leaves the org group |
| Org deleted | Org name kept as it was, no link: "Organization no longer on NetworkBase" |
| Show on my profile off | Org entry, nested entries and cards hidden from others |

### 24.6 Org-only child projects on a public profile
Visitors see the project name, org line, role, dates and **the member's own published story** — no link, project description or team; label `Visible to CSE-3A members`. Org members see a normal link. Portfolio shows a project card only when the viewer can open the project.

### 24.7 Org address
**`/org/<handle>`** (e.g. `/org/cse-3a`), an alias for the same page. Used by cards, chips, shares and Discover. `/join/CODE` unchanged. Old handles redirect after a rename.

### 24.8 Company example — Acme Sales
- Discover: Acme Sales org card (`Company`, "#saas #b2b", `42 members · 3 projects`, Follow) and the North region card with `▪ Acme Sales /`; chip **⋯ → Show everything from Acme Sales** filters the feed.
- Kiran's profile: Portfolio shows Acme Sales under Organizations and North region under Projects; Overview entry **Acme Sales · Member · North region · Jan 2026 – present ✓ Verified by Acme Sales**, nested **North region · Account executives · Unit lead**, with Kiran's own story.
- Manager's profile: **Acme Sales · Owner**, story started from About, rewritten in their own words.

### 24.9 Notifications

| When | Who | Message |
|---|---|---|
| Joined an org | Member | Welcome panel **Add to your profile** (no push) |
| Verified | Member | "Ms. Rao verified your role in CSE-3A" |
| Verification revoked | Member | "Your verification in CSE-3A was removed: <reason>" |
| Org archived | Members | Important; email E10 "CSE-3A 2026 has ended" with Update your contribution (Section 26) |
| Org archived | Admins | Needs you: "Verify members' contributions" |

### 24.10 Gap check

| # | Gap | Resolution |
|---|---|---|
| 1 | Private org cards on profiles | Owner only |
| 2 | Avatars of members who hid the org | Only Show on my profile members; count stays full |
| 3 | Org-only child project linked from a public profile | No link or description; member's own story only |
| 4 | Story images from Admins-only org files | Not offered; only own submissions and child project files |
| 5 | Verification read as approving the text | Badge covers role and dates; story labelled as the member's own |
| 6 | Misconduct after verification | Revoke with a reason; member notified |
| 7 | Outside people looking like members | Not nested; "Project of CSE-3A" |
| 8 | Child project detached | History label; moved out of the org group |
| 9 | Org deleted or renamed | Name kept as it was; no dead links |
| 10 | Guests getting contributions | No automatic entry |
| 11 | Org and its children both on Discover | Allowed; Organizations filter narrows |
| 12 | Following an org floods the feed | Only public announcements and new public child projects |
| 13 | Work record as surveillance | Opt-in, counts only, never grades |
| 14 | Handle change breaks links | Redirect from old `/org/<handle>` |

### 24.11 Data

| Need | How |
|---|---|
| Org card | `ProjectCard` variant for `kind = organization` |
| Child card | `ProjectCard` plus org line from `parent_id` |
| Discover | `organization` feed kind, **Show** filter, `org` filter, search fields, existing public rules |
| Org contributions | Reuse `profile_project_contributions` with the org project; sources owner / membership; role title = org role name + title |
| Nesting | Grouped by the child's parent org at render; org name and dates kept on the entry for history |
| Verification | Existing `verified_at` / `verified_by` by org admins, plus `revoked_reason` |
| Work record | Derived from assignment copies and sprints; opt-in switch on the entry |
| Story helpers | **Start from About**, **Start from my work** fill editable text |
| Org URL | `/org/<handle>` alias with redirects after a rename |

---

## 25. Messages end to end (locked 2026-10-26)

Built on the Slack-style Messages that is live today, which stays: each project is a chat workspace with a default public `#general` (everyone who joins is added automatically; it cannot be left or archived); project members create public or private channels (200 per project, 500 members per channel); leaving or removal from a project removes the person from all its channels at once; on `/messages` a **workspace rail** (one tile per project, ordered by recent activity) and a **sidebar** (Inbox · Saved · Drafts & scheduled · Starred · Channels · Direct messages · My applications); conversation tabs Messages · Canvas · Pins · Files plus shared Tasks / bookmark tabs; threads, mentions, reactions and live **cards** (application, task, invite); DMs and group chats (up to 9) belong to no project and follow message privacy (everyone / connections) and blocks; `@channel` / `@here` refused above 100 members; typing off above 50. "Organisations above projects" was out of scope for Messages v1 — this section adds it.

### 25.1 Model

| Today | With organizations |
|---|---|
| A project is a workspace with its own rail tile and `#general` | **An org is a workspace**: one rail tile and `#general` for all members |
| A child project would be another workspace | **A child project is a channel group inside the org workspace** — no rail tile, no own `#general` |

```
Rail          Sidebar: CSE-3A 2026 ▾
[CSE-3A] ●    Inbox · Saved · Drafts & scheduled
[Acme]        Starred
[Personal     Channels
 project]       # general
                # lab-help
              Projects
                ▾ Compiler Lab
                    # compiler-lab        ← the project's default channel
                    # compiler-lab-tests
                ▸ Quiz App
              Direct messages
              My applications
```

- A child project's **default channel** is named after its handle (`#compiler-lab`); every project member is added.
- Other channels created in the child project sit under its group.
- The **Projects** section lists only child projects you belong to; admins also get **Browse projects**.
- Personal projects keep their own rail tiles as today.

### 25.2 Automatic behaviour

| Event | Chat result |
|---|---|
| Org created | Workspace and `#general` created; owner joins |
| Someone joins the org | Added to `#general` |
| Child project created | Default channel `#<handle>` created under Projects; lead and members added |
| Someone joins a child project | Added to its default channel |
| Leaves / removed from a child project | Removed from all its channels |
| Leaves / removed from the org | Removed from `#general`, all org channels and all child project channels at once |
| Child project renamed / handle changed | Default channel renamed with a system message |
| Child project archived | Its channels read-only; group moves to an **Archived** row |
| Child project deleted | Its channels deleted (existing) |
| Child project detached | Its channels become **its own workspace** with a rail tile; default channel keeps its name; org admins lose access |
| Personal project moved into an org | Its `#general` renamed to `#<handle>` and moved under Projects with its other channels |
| Org archived | Workspace read-only, readable |
| Org deleted | Workspace removed; detached child projects keep their own workspaces |

### 25.3 Who sees and joins what

| Channel | Owner / Admin | Member | Guest | Child project member | Outside person |
|---|---|---|---|---|---|
| `#general` | Joined | **Auto-joined, cannot leave** | **Not auto-joined**; admins may add | Joined | ✗ |
| Org public channels | Browse and join | Browse and join | Only if added | Browse and join | ✗ |
| Org private channels | Invited | Invited | Invited | Invited | ✗ |
| Child default channel | **Can open and join any** from Browse projects; not auto-added; joins as mentions-only | Only if in that project | ✗ | Auto-joined | Auto-joined |
| Child project's other channels | Can open and join any | Only if in that project (public) or invited | ✗ | As today | As project members |

Child project channels are **private to the project team** regardless of project visibility; org admins can open them for supervision.

**Outside people** see the org workspace **limited to their child project's channels**: `CSE-3A · Guest`, only **Projects ▸ Compiler Lab**, no `#general`, org channels or Browse.

### 25.4 Org channel rules and settings
New rows in org **Settings → Updates & messages**:

| Setting | Options | Education | Company |
|---|---|---|---|
| **Who can post in #general** | Everyone · Admins only | Everyone | Everyone |
| **Members can create org channels** | On · Off | **Off** | On |
| **Default notifications for #general** | All · Mentions | **Mentions** | All |

- Child project channels follow the existing rule: any project member can create channels in their project.
- The child project's lead and admins (and org admins) rename, set topics and archive its channels, except the default channel.
- **Org `#general` is exempt from the 500-member cap** (up to the org's size or Max members). Existing limits stay: `@channel` / `@here` refused above 100, typing off above 50. Big-class announcements belong in Updates.

### 25.5 Updates, Tasks and chat

| Feature | Behaviour |
|---|---|
| **Also share in #general** | Checkbox on announcements and assignments, **off by default**; posts a live card in `#general` |
| **Announcement card** (new) | Title, first lines, **Open in Updates**; updates on edit |
| **Assignment card** (new) | `Lab 2 · due Fri · Open my copy`; **each viewer sees their own status**; admins see `22 of 30 submitted` |
| Group assignment in a child project | Copy card posted in the project's default channel: "CSE-3A assigned Mini-project proposal" |
| Task cards (existing) | Unchanged in child channels |
| Child channel header | Project avatar + **Open Compiler Lab →**; shared Tasks tab links to the project board |
| `#general` header | Org logo + **Open CSE-3A →**; bookmark tabs to Docs or Sprints |
| Applications for open unit seats | Existing application threads under My applications |

### 25.6 Direct messages
- **Org admins and members of the same org can always DM each other** — shared org membership counts like a connection for that pair.
- Member to member follows each person's privacy setting.
- Blocks always win. Group chats as today.

### 25.7 Sidebar by person

```
Admin                                  Student                               Outside person
CSE-3A 2026 ▾                          CSE-3A 2026 ▾                         CSE-3A · Guest ▾
Inbox · Saved · Drafts & scheduled     Inbox · Saved · Drafts & scheduled    Projects
Starred                                Channels  # general  # lab-help         ▾ Compiler Lab  # compiler-lab
Channels  # general  # staff 🔒        Projects                              Direct messages
          # lab-help                     ▾ Compiler Lab
Projects  ▾ Compiler Lab  # compiler-lab     # compiler-lab  # compiler-lab-tests
          ▸ Quiz App                   Direct messages
          Browse projects (12)         My applications
Direct messages
```

Unread: the org rail tile sums org channels and all joined child channels; a collapsed child group shows its own count.

### 25.8 Mobile and floating window
The workspace switcher sheet lists an org as one row; child projects appear inside its sidebar, never as rows. The floating chat window uses the same list screen with the Projects groups.

### 25.9 Company example — Acme Sales
1. Manager creates **Acme Sales** → workspace and `#general`; 42 members added as they join.
2. **North region** created → `#north-region` under Projects for its 12 members; the team adds `#north-region-deals`.
3. "Weekly pipeline report" published with **Also share in #general** → card "Due Fri · Open my copy"; the manager sees "1 of 2 done".
4. Manager opens **Browse projects → Enterprise accounts**, joins as mentions-only.
5. A contractor (outside person) in North region sees only `CSE-3A · Guest → North region`.
6. North region detached → its channels become their own workspace; the manager loses access.

### 25.10 Notifications

| When | Who | How |
|---|---|---|
| Message in a channel set to All | Members | Unread badge (existing) |
| Mention or DM | That person | Push and badge (existing) |
| Org admin joins a child channel | — | System message "Ms. Rao joined" |
| Added to a child project's channel | Member | Appears in the sidebar, no push |
| Assignment / announcement shared in `#general` | `#general` members | Unread badge; push only for notify All or mentions |

### 25.11 Gap check

| # | Gap | Resolution |
|---|---|---|
| 1 | Teachers flooded by group channels | Not auto-added; join from Browse projects as mentions-only |
| 2 | Students reading other groups' chat | Child channels private to the team plus org admins |
| 3 | `#general` over 500 members | Exempt from the 500 cap; `@channel` off above 100, typing off above 50 |
| 4 | Noisy `#general` in a big class | Education defaults to mentions; posting can be admins only |
| 5 | Teacher cannot DM a student with connections-only privacy | Same-org admin/member DMs always allowed; blocks win |
| 6 | Outside people seeing org chat | Workspace limited to their child project's channels |
| 7 | Name clash when a personal project moves in | `#general` renamed to `#<handle>`; names unique per child project |
| 8 | Guest examiners in `#general` | Not auto-joined; admins add them to specific channels |
| 9 | Detach leaves org admins in the chat | Removed from all the detached project's channels |
| 10 | Archived child project still receiving messages | Channels read-only |
| 11 | Leaves the org but stays in a child project as an outside person | Only if outside people are allowed; keeps the child channels, loses the rest |
| 12 | Assignment cards leaking others' status | Each viewer sees only their own; admins see counts |
| 13 | Rail filling with child projects | Child projects never get a rail tile |
| 14 | Search reaching unjoined child channels | Existing search covers joined channels only |
| 15 | Member removed mid-thread | Removed from every channel at once; messages stay with their name |
| 16 | Account deleted | Existing anonymising applies |
| 17 | 200-channel cap | Applies per child project; the org's own channels have their own cap |

### 25.12 Data

| Need | How |
|---|---|
| Org workspace and `#general` | Already works — the org is a project and the existing chat sync creates them |
| Child channels under the org | Child channels keep the **child project's id** (membership, permissions and deletion keep working); the bootstrap also returns each project's parent org and the client groups children under it |
| Default channel named after the handle | Created as `#<handle>` for child projects; renamed when the handle changes |
| Org admins open child channels | Join rule allows inherited org admins to join child channels, defaulting to mentions |
| `#general` size | 500-member cap not applied to an org's default channel |
| Guests not in `#general` | Membership sync skips the guest role |
| Outside people | Child project members only — existing sync already gives exactly those channels; UI shows the limited Guest workspace |
| Same-org DMs | DM permission check also allows org admins and members of the same org |
| New cards | `announcement` and `assignment` card kinds; the assignment card renders the viewer's own status |
| Settings | Who can post in #general · Members can create org channels · Default notifications for #general |
| Detach / move in | Re-parent channels and rename the default channel; no messages move |

---

## 26. Notifications and email end to end (locked 2026-10-26)

Audit of every trigger in this report, built on today's system. **This section is the source of truth for notifications:** where the per-section tables (15.7, 16.8, 17.9, 19.9, 20.10, 21.10, 23.10, 24.9, 25.10) differ, this section wins.

### 26.1 Today's system (the base)

| Part | What exists |
|---|---|
| In-app tray | **Important** / **More**; Unread / All; New · Today · Earlier; bursts combined ("5 new …"); snooze, dismiss; mute by type, project, task or person |
| Push | Browser push with quiet hours and pause |
| Email | Queue (`email_outbox`) via **Resend**; retries up to 23 h / 8 attempts; bounce and complaint blocking; HTML + plain text; one-click unsubscribe header. Two emails today: **Welcome** (from `welcome@networkbase.in`, on onboarding completion) and **Task assigned** (from `notifications@networkbase.in`). Respects the email switch and mutes |
| Project rules | Presets **Quiet / Balanced / Active**; per event: on/off, recipients, importance, grouping (none / 10-minute burst / digest only); members follow the project or customise |
| Personal settings | Categories (mentions, workflows, projects, tasks, applications, connections); browser / push / email switches; quiet hours; pause; Messages push options |
| Chat | Separate: unread badges, mention and DM push, per-channel notify |

### 26.2 Principles
1. **One event, four places, decided per person:** **Tray** (almost everything) · **Needs you** (things you must act on — a to-do list derived from current state, not a notification; clears itself) · **Push** (Important only) · **Email** (only the list in 26.5).
2. Email only when someone must act or would miss something important while away — never for activity, likes, joins or uploads.
3. Respect existing settings: email switch, mutes, quiet hours for push, pause, bounce blocking.
4. Combine, don't spam: bursts become one row; admins get a **daily digest** instead of instant submission emails.
5. Privacy: no Admins-only files, no other people's status, announcements only to their audience.
6. Context on everything: `CSE-3A` or `CSE-3A / Compiler Lab`.

### 26.3 Trigger catalogue
Legend: **Imp** Important (else More) · **NY** also in Needs you · **P** push · **E** email template · **Grp** burst or digest.

**A. Organization and membership**

| Trigger | Who | Tray text | Imp | NY | P | E | Grp |
|---|---|---|---|---|---|---|---|
| Org created | Owner | "CSE-3A 2026 is ready · share code K7M2QX" | ✓ | — | — | **E1** | — |
| Join request | Admins | "3 people asked to join CSE-3A" | ✓ | ✓ | — | in E11 | burst |
| Request approved | Requester | "You're in CSE-3A" | ✓ | — | ✓ | **E4** | — |
| Request declined | Requester | "Your request to join CSE-3A was declined: <reason>" | ✓ | — | ✓ | — | — |
| Joined with code | Member | Welcome panel | — | — | — | **E4** | — |
| Invited (has account) | Invitee | "Ms. Rao invited you to CSE-3A as TA" | ✓ | ✓ | ✓ | **E2** | — |
| Invited (no account) | Email address | — | — | — | — | **E3** | — |
| Invite accepted | Inviter | "Meena joined CSE-3A" | — | — | — | — | burst |
| Member joined | Admins | "5 people joined CSE-3A" | — | — | — | — | burst |
| Role changed | Member | "You're now a TA in CSE-3A" | ✓ | — | ✓ | — | — |
| Removed | Member | "You were removed from CSE-3A" | ✓ | — | ✓ | **E12** | — |
| Member left | Admins | "Ravi left CSE-3A" | — | — | — | — | burst |
| Blocked from rejoining | — | not told | — | — | — | — | — |
| Ownership transferred / passed on owner deletion | New and previous owner | "You're now the owner of CSE-3A" | ✓ | ✓ (succession) | ✓ | **E13** | — |
| Max members reached | Admins | "CSE-3A is full (60 of 60)" | ✓ | ✓ | — | — | — |
| Join code regenerated | Admins | "The join code was changed by Ms. Rao" | — | — | — | — | — |
| New members not in a team | Admins | — | — | ✓ | — | — | — |

**B. Child projects**

| Trigger | Who | Tray text | Imp | NY | P | E | Grp |
|---|---|---|---|---|---|---|---|
| Child project created | Org admins | "Ravi created Compiler Lab" | — | — | — | — | burst |
| Added directly | Member | "You were added to Compiler Lab · Frontend developers" | ✓ | — | ✓ | — | — |
| Invited by a member | Invitee | Existing invitation | ✓ | ✓ | ✓ | — | — |
| Made lead | New lead | "You're the lead of Compiler Lab" | ✓ | — | ✓ | — | — |
| Made unit lead | Member | "You're unit lead of Frontend developers" | — | — | — | — | — |
| Seat reopened | Lead | "1 seat open in Frontend developers" | — | — | — | — | — |
| Move into org requested | Org admins | "Heap Viz wants to join CSE-3A" | ✓ | ✓ | — | — | — |
| Move approved / declined | Project owner | "Heap Viz is now part of CSE-3A" / "…declined" | ✓ | — | ✓ | — | — |
| Detach requested | Org admins | "North region wants to leave Acme Sales" | ✓ | ✓ | — | — | — |
| Detach approved / declined | Lead | "North region left Acme Sales" / "Detach declined" | ✓ | — | ✓ | — | — |
| Lowered by an org rule | Lead and admins | "North region is now Org only because Acme Sales changed its rules" | ✓ | — | — | — | — |
| Group assignment needs projects / students not in a project | Admins | — | — | ✓ | — | — | — |

**C. Sprints**

| Trigger | Who | Tray text | Imp | NY | P | E |
|---|---|---|---|---|---|---|
| Org sprint starts (Notify on) | Members | "CO1 started · 3 assignments · 2 materials" | ✓ | — | ✓ | — |
| Org sprint starts | Child leads without a linked sprint | "CO1 started. Plan your sprint inside it" | ✓ | ✓ | — | — |
| 1 day before end | Admins | "CO1 ends tomorrow · 6 people have missing work" | ✓ | — | — | in E11 |
| End date passed | Admins | — | — | ✓ "Complete CO1?" | — | — |
| Completed | Members | "CO1 closed · you completed 3 of 3" | — | — | — | — |
| Completed | Child leads | — | — | ✓ "Complete your linked sprint?" | — | — |
| Dates no longer fit | Child leads | "Your sprint is outside CO1's new dates" | ✓ | ✓ | — | — |
| Auto-start failed | Admins | "CO2 couldn't start: CO1 is still active" | ✓ | ✓ | — | — |

**D. Assignments and tasks**

| Trigger | Who | Tray text | Imp | NY | P | E | Grp |
|---|---|---|---|---|---|---|---|
| Published (individual / late joiner) | Recipients | "Ms. Rao assigned Lab 1 · due Fri 11:59 PM" | ✓ | ✓ | ✓ | **E5** | — |
| Published (team) | Team members | "You're in Team A for Lab 2 with Ravi and Asha" | ✓ | ✓ | ✓ | **E5** team | — |
| Group copy arrives | Child lead | "CSE-3A assigned Mini-project proposal to Compiler Lab" | ✓ | ✓ | ✓ | **E5** group | — |
| 24 h before due | People not done | "Lab 1 is due tomorrow" | ✓ | ✓ | ✓ | **E6** (combined daily) | daily |
| Due day | People not done | "Lab 1 is due today at 11:59 PM" | ✓ | ✓ | ✓ | — | — |
| Overdue (late allowed) | People not done | "Lab 1 is overdue · late work accepted until Nov 3" | ✓ | ✓ | — | **E7** (once) | — |
| Closed | People not done | "Lab 1 is closed" | — | — | — | — | — |
| Submission arrives | Admins | "5 new submissions for Lab 1" | — | ✓ | — | **E11** | burst |
| Returned | Member / lead / team | "Lab 1 was returned: add the test cases" | ✓ | ✓ | ✓ | **E8** | — |
| Approved | Member / lead / team | "Lab 1 approved" | — | — | — | — | — |
| Due changed / extended / excused | Affected | "Lab 1 is now due Mon" / "You're excused from Lab 1" | ✓ | — | ✓ | — | — |
| Moved to another team | Member | "You moved to Team B for Lab 2" | ✓ | — | — | — | — |
| Master Q&A comment / mention | Admins, mentioned | Existing comment notifications | existing | — | existing | — | burst |
| Download-all ready | Requesting admin | "Lab 2 submissions are ready to download" | ✓ | — | ✓ | — | — |

**E. Updates**

| Trigger | Who | Tray | Imp | NY | P | E |
|---|---|---|---|---|---|---|
| Announcement (in-app) | Audience | "Ms. Rao: Midterm moved to Nov 10" | ✓ | — | ✓ | — |
| Announcement (in-app + email) | Audience | Same | ✓ | ✓ until opened | ✓ | **E9** |
| Edited with Notify again | Audience | "Updated: Midterm moved to Nov 10" | ✓ | — | ✓ | — |
| Discussion post | Mentioned only | Existing mention | ✓ | — | ✓ | — |
| Shared-up post | No one | — | — | — | — | — |
| Comment | Author, mentioned, thread | Existing | existing | — | existing | — |
| Post deleted by an admin | Author | "Your post was removed: <reason>" | ✓ | — | — | — |

**F. Docs**

| Trigger | Who | Tray | Imp | NY | P | E |
|---|---|---|---|---|---|---|
| Publish & notify | Members who can see the doc | "Grading policy updated: late work now −10%" | ✓ | — | ✓ | — |
| Required doc / re-read requested | Members | — | — | ✓ until opened | — | — |
| Updated without notify | No one | "Updated" label 7 days | — | — | — | — |

**G. Files**

| Trigger | Who | Tray | Imp | P | E |
|---|---|---|---|---|---|
| Admin upload with Notify members | Members who can open the folder | "New in CSE-3A: CO2 slides" | — | — | — |
| Files moved / published | Existing "files organized" | existing | — | — | — |

**H. Lifecycle and governance**

| Trigger | Who | Tray | Imp | NY | P | E |
|---|---|---|---|---|---|---|
| Org archived | All members | "CSE-3A has ended. Everything is read-only" | ✓ | — | — | **E10** |
| Org archived | Admins | — | — | ✓ "Verify members' contributions" | — | — |
| Org unarchived | All members | "CSE-3A is open again" | ✓ | — | — | — |
| Org duplicated | Owner | "CSE-3A 2027 created from CSE-3A 2026" | — | — | — | — |
| Org deleted (incl. child detached to lead) | All members, child leads | "CSE-3A was deleted" | ✓ | — | ✓ | **E14** |
| Org goes private | Members | "CSE-3A is now private" | — | — | — | — |

**I. Profile credit**

| Trigger | Who | Tray | Imp | P | E |
|---|---|---|---|---|---|
| Verified | Member | "Ms. Rao verified your role in CSE-3A" | ✓ | — | — |
| Verification revoked | Member | "Your verification in CSE-3A was removed: <reason>" | ✓ | ✓ | — |
| Org archived | Members | Part of E10 | — | — | E10 |

**J. Messages** — chat keeps its own system (badges, mention and DM push, no email). An org admin joining a child channel shows a system message; being added to a child channel appears in the sidebar without push.

### 26.4 Needs you
- **Admins:** submissions to review · join requests · detach and move-in requests · sprints to complete · contributions to verify after archive · org full · group assignment needs projects · new members not in a team · students not in any project · auto-start failed.
- **Members:** due within 2 days · overdue · returned work · required docs not opened · emailed announcements not opened · pending invitations.
- **Child leads:** plan a sprint inside the org sprint · complete the linked sprint · sprint outside new dates · group assignment copies.
- Rows clear when the state changes (never dismissed by hand), grouped by org, newest first. The tray links into these items rather than duplicating them.

### 26.5 Emails

**Shared design** — every new email uses the layout of today's Welcome and Task-assigned emails:

| Part | Design |
|---|---|
| Page | Paper `#FAF8F4`, ink `#141A1E`, 600 px left-aligned column, mobile-safe |
| Brand bar | Clay dot `#C24720` + **NetworkBase**, thin divider |
| Identity header | 44 px avatar (existing coloured-initials fallback) + uppercase micro label + bold name. Org: logo with `ORGANIZATION · EDUCATION`; child: `CSE-3A / COMPILER LAB`; person-led: avatar with `ASSIGNED BY` / `RETURNED BY` / `POSTED BY` |
| Headline / body | 21 px bold H1; 14 px grey body, line height 1.6 |
| Pills | Existing pill row: due (amber soon, red overdue), status, `Review required`, `Team A`, submission type, role |
| Sections | Uppercase micro headers with top border (like "Subtasks & Scope", "Referenced Files & Assets"): **Steps**, **Materials**, **Your team**, **Pinned docs**, **What's next** |
| Buttons | One clay primary + one outlined secondary; stacked on phones |
| Footer | Reason line · **Manage notification preferences** · **Mute emails from CSE-3A** · Support · Privacy · Security · Terms · © |
| Preview text, plain text, headers | Hidden preview with padding; full plain text; `List-Unsubscribe` + one-click header; reply-to `support@networkbase.in` |
| Sender | **`NetworkBase <notifications@networkbase.in>`** for every org and child project email; Welcome stays on `welcome@` |

Today the two templates each carry their own HTML; the shared shell (`renderEmailShell`) is extracted once, with the Welcome and Task emails producing identical output afterwards.

| # | Email | Subject | Identity header | Body and sections | Buttons |
|---|---|---|---|---|---|
| E1 | Org ready | `CSE-3A 2026 is ready: invite your members` | Org logo · `ORGANIZATION · EDUCATION` | Join code large in mono + `/join/K7M2QX` link · What's next: share the code, plan sprints, add materials | **Open CSE-3A →** · Copy invite link |
| E2 | Invitation (account) | `Ms. Rao invited you to CSE-3A 2026` | Inviter · `INVITED BY` | Org name, tagline, type · pills role, title, `Expires Nov 2` · note as a quote | **Accept invitation →** · View organization |
| E3 | Invitation (no account) | `Ms. Rao invited you to CSE-3A 2026 on NetworkBase` | Inviter · `INVITED BY` | As E2 + "Create your account with this email address and you'll join automatically." | **Create your account →** · What is NetworkBase |
| E4 | Welcome to the org | `You're in CSE-3A 2026` | Org logo · `ORGANIZATION` | Admin's welcome note · Pinned docs (only ones you can open) · What's next: current sprint, due assignments | **Open CSE-3A →** · Add to your profile |
| E5 | New assignment (individual / team / group) | `New assignment: Lab 2 · due Fri 31 Oct, 11:59 PM` | Assigner · `ASSIGNMENT · CSE-3A` (group: `CSE-3A → COMPILER LAB`) | Built on Task-assigned: pills (due, Review required, Submit: file, Team A, CO1) · description · Steps · Materials (accessible only) · Your team | **Open my copy →** · View in CSE-3A |
| E6 | Due soon (combined) | `Due tomorrow: Lab 2` / `2 assignments due tomorrow in CSE-3A` | Org logo · `DUE SOON` | One row per item: title, due pill, your status | **Open my work →** |
| E7 | Overdue | `Lab 2 is overdue: late work accepted until Nov 3` | Org logo · `OVERDUE` | Red due pill · what to do | **Submit now →** |
| E8 | Work returned | `Lab 2 was returned: add the test cases` | Reviewer · `RETURNED BY` | Reason as a quote · version pill `v2` | **Open my copy →** |
| E9 | Announcement | `CSE-3A: Midterm moved to Nov 10` | Author · `ANNOUNCEMENT · CSE-3A` | Full post (formatting simplified) · Attachments (accessible only) | **Read in CSE-3A →** · Reply in comments |
| E10 | Org ended | `CSE-3A 2026 has ended` | Org logo · `ORGANIZATION` | Read-only; your submissions stay available · update your contribution story | **Update your contribution →** · Open CSE-3A |
| E11 | Admin daily digest | `CSE-3A today: 18 submissions, 2 join requests` | Org logo · `DAILY SUMMARY` | To review (per assignment, counts) · Join requests · Needs you · Behind (count). Nothing to report → not sent | **Open review queue →** · Open dashboard |
| E12 | Removed | `You were removed from CSE-3A 2026` | Org logo · `ORGANIZATION` | Reason if given · profile entry stays; submissions remain with the org | View your profile · Contact support |
| E13 | Ownership | `You're now the owner of CSE-3A 2026` (previous owner: `You transferred CSE-3A 2026 to Ms. Rao`) | Org logo · `OWNERSHIP` | What owners can do | **Open settings →** |
| E14 | Org deleted | `CSE-3A 2026 was deleted` | Org logo · `ORGANIZATION` | What happened to your work; child leads: "Compiler Lab is now your personal project" | Open my projects |

**Example — E5:**

```
▪ NetworkBase
────────────────────────────────────────────
(MR)  ASSIGNED BY
      Ms. Rao (@mrao) · Teacher, CSE-3A 2026

New assignment: Lab 2 — Binary Search Trees
[Due Fri 31 Oct, 11:59 PM] [Review required] [Submit: file] [Team A] [CO2]

Implement insert, delete and search…

STEPS (0 of 3)
  ○ 1. Read CO2 notes
  ○ 2. Write the code
  ○ 3. Upload your report

MATERIALS (2)
  📄 CO2 notes.pdf (1.2 MB)                       View →
  📦 lab2-starter.zip (240 KB)                    View →

YOUR TEAM
  Ravi ★ · Asha · Kiran

[ Open my copy → ]  [ View in CSE-3A ↗ ]
────────────────────────────────────────────
You're receiving this because you're a member of CSE-3A 2026.
Manage notification preferences · Mute emails from CSE-3A
Contact Support • Privacy • Security • Terms and Conditions
© NetworkBase™ • All rights reserved
```

**Email rules**

| Rule | Behaviour |
|---|---|
| Sender | `notifications@networkbase.in`, reply-to support@ |
| Follows preferences | E2, E4–E11 respect the email switch and mutes |
| Always sent | E1, E3, E12, E13, E14 (access, ownership, account) — still subject to bounce blocking |
| Due-soon cap | At most one E6 per person per org per day at **9:00 in the person's time zone**; E7 once per assignment |
| Digest | E11 daily at **8:00 in the org's time zone**, **on by default for owner and admins**; "instant" switches to per-event tray items |
| Times | Recipient's time zone, with org time in brackets when different |
| Privacy | No Admins-only files, no others' status or rosters; guests never get submission details; announcements to their audience only |
| One-click mute | Footer link mutes email only for that org |
| Delivery | Existing queue, retries, bounce blocking, test-recipient allowlist |
| Duplicates | One email per event per person; replays send nothing extra |

### 26.6 In-app tray
- New `org_*` kinds (membership, sprint, assignment, announcement, doc, governance, credit) added to existing kinds and reasons.
- Context label `CSE-3A` or `CSE-3A / Compiler Lab`; avatar is the actor, or the org logo for system events.
- Existing burst combining ("5 new submissions for Lab 1", "3 people joined CSE-3A").
- Item mute menu: this assignment · this project · **this organization** · this person · this type.
- Deep links straight to the copy, roster, request, post or doc.

### 26.7 Push
Important items only; quiet hours, pause and lock-screen privacy apply; due-soon pushes follow the once-a-day cap.

### 26.8 Settings
- **Org Settings → Notifications** (§21.2 section 9): org defaults using the existing presets and per-event rules, with new event groups Organization, Assignments, Sprints, Announcements, Docs, Governance; **Admin batching** daily (default) or instant.
- **Personal Settings → Notifications** gains an **Organizations** block:

```
CSE-3A 2026      [ All | Important only | Off ]   Email ☑   Include child projects ☑
Acme Sales       [ All | Important only | Off ]   Email ☐   Include child projects ☑
```

  **Off** still keeps the always-sent emails (E12–E14). **Include child projects** applies the choice to that org's child projects unless a child project has its own setting.

| Default | Education | Company |
|---|---|---|
| Assignment emails (E5–E8) | On | On |
| Admin digest | Daily | Daily |
| Announcement email | Per post | Per post |
| Sprint-start push | On | Off |

### 26.9 Company example — Acme Sales, one week

| Day | Events | Kiran (member) | Manager |
|---|---|---|---|
| Mon | October push starts; Weekly pipeline report published (group) | Push "October push started"; **E5** to the North region lead | Tray "October push started" |
| Thu 9:00 | Due tomorrow | **E6** + push | — |
| Fri | Kiran submits | — | Tray "1 new submission"; Needs you |
| Sat 8:00 | — | — | **E11** "Acme Sales today: 1 submission · Enterprise missing" |
| Sat | Manager returns it | **E8** + push | — |
| Sun | Announcement "New pricing from Nov 1" with email | **E9** + Needs you until opened | — |

### 26.10 Gap check

| # | Gap | Resolution |
|---|---|---|
| 1 | 60 submission alerts for a teacher | Combined in the tray plus the daily digest |
| 2 | Student with email off misses a deadline | Tray, push and Needs you still work |
| 3 | Invitee without an account has no preferences | E3 always sent, with a sign-up link |
| 4 | Reminders at 3 a.m. | Sent at 9:00 in the recipient's time zone |
| 5 | Email links to Admins-only files | Only files the recipient can open |
| 6 | Other people's names in emails | Never, except your own team |
| 7 | Guest examiners | Counts only |
| 8 | Replayed events | One email per event per person |
| 9 | Removal email used to harass | Sent by NetworkBase; reason optional and sent as written |
| 10 | Empty digest | Not sent |
| 11 | Org muted but member removed | E12 still arrives |
| 12 | Child notifications when the org is muted | Include child projects decides; a child's own setting wins |
| 13 | Notify again overused | Tray only, no repeat email |
| 14 | Bounced addresses | Existing bounce blocking |
| 15 | §7.3 said announcements notify "push and email" | Corrected to §17: in-app by default, email per post |
| 16 | Sender spelling | `notifications@` (existing) |
| 17 | Chat noise | Chat stays separate, no email |
| 18 | Many orgs in Needs you | Grouped by org, newest first |

### 26.11 Data

| Need | How |
|---|---|
| Tray kinds and event keys | Extend `NotificationKind` and the project notification event list with the org groups; existing delivery, combining and dedupe |
| Needs you | Derived from current state; no notification rows |
| Email shell | Extract `renderEmailShell` from the two current templates (output unchanged); add 14 kinds to `EmailKind` |
| Sender | `notifications@networkbase.in` for all new kinds |
| Due soon / overdue | Scheduled job: one combined email per person per org per day at 9:00 local |
| Admin digest | Daily job at 8:00 org time; skipped when empty |
| Always-sent | Flag on E1, E3, E12–E14 that bypasses the email opt-out, not bounce blocking |
| Mute emails from an org | Email-channel-only mute for that org plus a signed one-click link |
| Per-org preferences | Stored on the org membership's existing notification preferences plus "include child projects" |

---

## 27. Dashboard tab end to end (locked 2026-10-26)

Deeper pass on 7.1, aligned with every locked section. Visitors never see the Dashboard (they land on About, §18.3).

### 27.1 Layout
Same frame as a project Dashboard: main column (8) and right rail (4); rows in the `RecentActivityCard` style; numbers as plain text; no big cards or bars.

```
┌──────────────────────── main (8) ────────────────────────┐ ┌──────── rail (4) ───────┐
│ 📌 CSE-3A · Midterm moved to Nov 10 →                    │ │ Projects                │
│                                                          │ │ Compiler Lab · 2h       │
│ Needs you                                                │ │ Quiz App · quiet 7 days │
│ 5 submissions to review · Lab 1                      →   │ │ See all 12 →            │
│ 2 join requests                                      →   │ ├─────────────────────────┤
│ CO1 ended yesterday · Complete it?                   →   │ │ People                  │
│                                                          │ │ (R)(A)(K)(M) +60        │
│ This sprint · CO2 · ends Fri                             │ │ 5 joined this week      │
│ Lab 2 · due Fri · 18 of 30 done · 4 missing              │ └─────────────────────────┘
│ Quiz 1 · due Thu · 26 of 30 done                         │
│                                                          │
│ Coming up · next 7 days                                  │
│ Thu  Quiz 1 due                                          │
│ Fri  CO2 ends · Lab 2 due                                │
│ Mon  CO3 starts                                          │
│                                                          │
│ Activity        All · Assignments · People · Files & docs · Projects │
│ Today                                                    │
│ Ms. Rao published CO2 notes · 2h                         │
│ Compiler Lab was created · 5h                            │
└──────────────────────────────────────────────────────────┘
```

### 27.2 Blocks

| Block | Content | Rules |
|---|---|---|
| **Pinned strip** | Newest pinned announcement, one line, link to Updates | Hidden when nothing is pinned or after its unpin date |
| **Needs you** | The §26.4 list for this person, grouped by kind | Up to 5 rows + "See all N"; rows clear when the state changes; empty → hidden |
| **This sprint** | Active org sprint line; then each assignment in it | Admin: `18 of 30 done · 4 missing`. Member: own status (`Submitted`, `Due Fri · not started`). No active sprint → next planned (`CO3 starts Mon`) or, for admins, **Plan your term** |
| **Coming up · next 7 days** | Due dates, sprint ends and starts, by day | Member: only their own due items; admin: all |
| **Activity** | Org events by day, filters **All · Assignments · People · Files & docs · Projects**, Load more | **Privacy:** admins see everything; members and guests see only org-level events (sprints, docs, announcements, new child projects, join counts) and their own events — never other people's submissions or status |
| Rail **Projects** | Member: their child projects with last activity. Admin: 5 most active + `2 need attention` link | Links to the Projects tab |
| Rail **People** | Member avatars (Show on my profile rules) and `5 joined this week`; admins also `2 requests →` | — |

### 27.3 By person

| Person | Dashboard |
|---|---|
| Owner / Admin | All blocks with counts and rosters; Needs you admin items; full Activity |
| Member | Pinned strip, own Needs you, This sprint with own status, own Coming up, privacy-filtered Activity, own projects |
| Guest | Pinned strip, This sprint with counts only (no names), org-level Activity; no Needs you |
| Child project lead | Member view plus lead items in Needs you (plan a linked sprint, complete linked sprint, group copies) |
| Visitor | No Dashboard tab |

### 27.4 States
- **New org (admin):** a **Get started** list derived from state — Share the join code · Plan your sprints · Add materials · Post a welcome announcement · Create the first assignment. Each line disappears when done; the list disappears when all are done.
- **New member with nothing due:** "Nothing due. CO1 starts Mon." plus the pinned strip and Activity.
- **Archived org:** one summary line (`CSE-3A ended Dec 2026 · 5 sprints · 40 assignments · 64 members`), admins keep "Verify contributions" in Needs you; everything else read-only.
- **Loading / error:** existing row skeletons and "Try again" (same as `RecentActivityCard`).
- **Mobile:** the rail folds below; Needs you comes first.
- **Freshness:** refetch on focus and every 30 s while visible (existing activity cadence).

### 27.5 Child project Dashboard
Locked decision 79 refined: **overview card at the top**, then **What's happening = Needs you + This sprint** (the project's own sprint with the line `Inside CO2 (CSE-3A) · ends Fri`). **Activity stays in the rail** as today's `RecentActivityCard`, so nothing is shown twice. Rail: Journey (project stages), Recent activity, Open roles, and the org line `Part of CSE-3A · CO2 ends Fri · 1 assignment due`.

### 27.6 Data
All blocks are derived: Needs you from §26.4 queries; This sprint and Coming up from sprints and assignment copies; Activity from the existing recent-activity source with a per-viewer privacy filter; Get started from org state. No new tables.

---

## 28. Projects tab end to end (locked 2026-10-26)

Deeper pass on 7.8: the org's portfolio of child projects and the admin's oversight view.

### 28.1 Layout

```
12 projects · 3 need attention · 2 quiet · 9 members not in a project        [+ New project]
Search…   Stage ▾  Lead ▾  Status ▾  Visibility ▾  Sprint ▾  ☐ Mine   Sort: Recently active ▾   [List | Cards]
☐ [Av] Compiler Lab   Org only   Ravi (lead) · 9 members · 3 units   Sprint 2 · in CO2
       12 open · 3 overdue · 2 in review   Proposal: submitted   active 2h            ⋯
☐ [Av] Quiz App       Org only   Meena · 4 members                   no sprint
       ⚠ Needs attention: quiet 7 days · Proposal missing          active 8d            ⋯
```

- **List** view (default for admins) and **Cards** view with `ProjectCard` + org line (default for members).
- Summary line items are filter links.

### 28.2 Toolbar

| Control | Options |
|---|---|
| Search | Project name, lead, unit name |
| Stage | The project's journey stage |
| Lead | Any lead |
| Status | Active · **Needs attention** · Quiet 7 days · Archived |
| Visibility | Org only · Private · Public |
| Sprint | Linked to the current org sprint · Not linked |
| Mine | Only projects I belong to |
| Sort | Recently active · Name · Created · Most overdue |

### 28.3 Row content
Avatar, name, visibility chip, lead, members and units count, active sprint (and whether it is inside the org sprint), work counts `12 open · 3 overdue · 2 in review`, the **current group assignment status** (`Proposal: submitted / missing`), last activity, ⋯ menu.

**Needs attention** (with the reason shown) when any of: 3 or more overdue tasks · no activity for 7 days · a group assignment copy missing or returned · sprint outside the org sprint's dates · the lead left the org.

### 28.4 Actions

| Action | Admin | Lead | Member | Guest |
|---|---|---|---|---|
| Open project / open its chat channel | ✓ | ✓ | ✓ (if member, or org-only/public) | read |
| Message the lead | ✓ | — | ✓ | — |
| Add members (roster picker, direct add) | ✓ | ✓ (invitations) | — | — |
| Change lead | ✓ | ✓ (transfer ownership) | — | — |
| Archive / unarchive | ✓ | ✓ | — | — |
| Detach | ✓ (immediate) | Request | — | — |
| Delete | — (project owner only) | ✓ owner | — | — |
| Request to join (open seats) | — | — | ✓ | — |
| **Bulk** (admin): Archive selected · **Remind leads** about overdue or missing group assignments | ✓ | — | — | — |

### 28.5 By person

| Person | Projects tab |
|---|---|
| Owner / Admin | All child projects incl. Private ones, List view, Needs attention, bulk actions |
| Member | **Your projects** (cards) first, then **All projects in CSE-3A** — org-only and public ones; Private projects appear only if they belong. Open seats show **Request to join** |
| Guest | Read-only list with counts; no Private projects |
| Visitor | Only if the Public page shows Projects: public child projects as cards |
| Outside people | No org Projects tab (they only see their child project) |

### 28.6 States
- **No projects (admin):** "Create projects for your groups" with **+ New project** (bulk creation later).
- **No projects (member):** "No projects yet", with **+ New project** if the creation policy allows, otherwise "Only admins create projects here · Message admins".
- **Moved-in project:** `New in CSE-3A` badge for 7 days. **Detached** projects disappear from the list.
- **Archived org:** read-only list, no actions.
- **Large orgs:** 50 rows per page; counts computed per page.

### 28.7 Notifications
Uses §26 only: child project created (admins, burst), move-in / detach requests (Needs you), Remind leads sends the lead "CSE-3A reminded you: Proposal is missing" (tray, Important, push).

### 28.8 Data
Child projects by `parent_id`; per-row counts from tasks and group assignment copies; Needs attention computed from the rules above; no new tables. Remind leads uses the existing notification fanout.

---

## 29. Join flow, My work, left navigation and permissions (G1–G4, locked 2026-10-26)

### 29.1 G1 — Joining without an account

Built on what exists: sign-up with **Google, GitHub or email** (email verified with a **6-digit code**; Google/GitHub sign-ups accept the terms); a `redirect` link carried through the **4 onboarding steps** (Identity, Details, Skills, Privacy); a finish button that can say "Continue" when the person was heading somewhere; the account **Welcome** email queued at onboarding completion for verified addresses; unfinished onboarding saved on the server as a draft.

```
/join/K7M2QX (logged out)
  → Join preview page ──► Sign up (Google / GitHub / Email + 6-digit code)
                           → Onboarding (4 steps, banner: "You'll join CSE-3A 2026 after setup")
                           → Finish: [Continue to CSE-3A]
                           → Joined automatically (or request sent) → welcome panel → org Dashboard
```

| Step | What the person sees |
|---|---|
| **1. Join preview** (new, public) | Org logo, name, type, member count; "You've been invited to join CSE-3A 2026"; **Continue with Google · GitHub · Email** and **Already have an account? Log in**. Approval mode: "Your request will be reviewed by the admins". Private orgs show only logo, name and type |
| **2. Sign up** | Existing sign-up with the join link carried; email verified with the 6-digit code |
| **3. Onboarding** | Same 4 steps plus the banner *"You'll join CSE-3A 2026 after setup."* |
| **4. Finish** | Button reads **Continue to CSE-3A** instead of "Go to Discover" |
| **5. Join** | **No extra click:** instant mode joins; approval mode sends the request, with an optional "Add a note" afterwards |
| **6. Arrival** | Instant: welcome panel (welcome note, pinned docs, Add to your profile) on the org Dashboard. Approval: org About with **Request pending · Cancel** |

**Email order:** the account **Welcome** (welcome@, at onboarding completion), then org **E4 "You're in CSE-3A"** (on approval in approval mode).

| Situation | What happens |
|---|---|
| Has an account, logged out | Log in → back to `/join/K7M2QX` → joined; no onboarding |
| Logged in, onboarding not finished | Onboarding with the banner, joining at the end |
| Logged in and onboarded | The join dialog opens pre-filled (§6.1) |
| Email invite, no account (E3) | **Create your account** opens sign-up with the email pre-filled; after onboarding the invite is **accepted automatically** with its role, title, child project and unit. Google sign-up works if it is the **same email address** |
| Email invite, has an account (E2) | **Accept invitation** → log in if needed → accepted |
| Public org card on Discover, logged out | **Join** → the same preview page |

| Problem | What happens |
|---|---|
| Tab closed or device switched during onboarding | The join code is **saved with the onboarding draft** on the server; the join still happens at the end |
| Code regenerated meanwhile | "That code is no longer valid. Ask your organization for the new code." The account is unaffected |
| Org full, archived, person blocked, already a member | Existing messages, on the preview page or at step 5 |
| Wrong code while logged out | "That code doesn't match an organization"; lookups **rate-limited per network address** |
| Email code expired | Existing "resend code" |
| Signed up with a different email than the invite | Invite not matched; E3 says to use the invited address; the admin can resend |

Data: public join preview page; join code in the onboarding draft; post-onboarding automatic join or request; email-invite matching at sign-up; rate limiting for logged-out lookups.

### 29.2 G2 — The My work drawer

Built on what exists: **My work** in the sidebar opens a drawer over Discover (`/workspace` redirects there) with **Tasks** (All open work / My tasks / Team tasks, status filter, search, card or compact rows) and **Invitations** (project invitations with accept/decline and undo, connection requests, applications to your projects).

**Tasks tab**

| Change | Behaviour |
|---|---|
| Context chip | Every row shows `CSE-3A`, `CSE-3A / Compiler Lab`, or the personal project name |
| Assignment copies | In **My tasks** with "From Ms. Rao", due date, **Late** / **Missing** |
| Team copies | On **every teammate's** My tasks with a `Team A` chip |
| Group copies | On the **lead's** (or reassigned person's) My tasks, and on **Team tasks** for project members |
| Master assignments | **Never** shown to members; admins don't see the copies either |
| **To review** (new view) | For org admins, child leads and project reviewers: every submission waiting for them across orgs and projects (`Asha · Lab 2 · CSE-3A · 2h ago`) |
| Quick filters | `Due soon 3 · Missing 1 · To review 5` as plain-text filter links |
| Organization filter | All · Personal · each org |
| Status filter | Adds **Overdue** |
| Sorting | Soonest due first in My tasks |
| Excused copies | Hidden |
| Closed assignments | Listed as **Missing** until the assignment is archived |

**Invitations tab**

| Change | Behaviour |
|---|---|
| Org invitations | Org logo, name, role, title (and child project and unit): **Accept / Decline** with undo |
| Child project invitations | Existing invitations, showing the unit |
| Join requests (admins) | Grouped by org (`CSE-3A · 3 join requests`): Approve / Decline for the first 5, **Review all →** to the Members tab |
| Unit-seat applications | Existing applications, with the unit name |
| Detach, move-in and other org admin requests | Not here — they stay in the org's Needs you |

Badges: **Tasks** = your open work including copies; **Invitations** = your invitations plus join requests for admins.

### 29.3 G3 — Left navigation

Built on what exists: Discover · Network (pending badge) · Messages (unread badge) · My profile · **My work**; a **Workspaces** heading with up to 12 project names; Settings and collapse at the bottom; the same list in the mobile menu.

```
WORKSPACES ─────────────────────
▾ [logo] CSE-3A 2026      •  3   +
      Compiler Lab
      Quiz App
▸ [logo] Acme Sales            1
  Heap Visualizer
  Portfolio site
  More (4)
▸ Archived (2)
+ Join with code
```

| Rule | Behaviour |
|---|---|
| Order | **Orgs first** (most recently opened), then **personal projects** (as today), then a collapsed **Archived** group |
| Child projects | Under their org: only those **you belong to**, up to 5, then **See all →** (org Projects tab). Admins also get **All projects →** |
| Expand / collapse | Per org, remembered in this browser |
| Badges | Org row: **number** of that org's Needs you items and a **dot** for unseen announcements. Child rows: no badges |
| Click an org row | Opens the org Dashboard |
| "+" on hover | New project in that org, only if the creation rule allows |
| Request waiting for approval | Org row greyed with `Requested`, opening its About page |
| Outside people | Their child project as a normal row labelled `CSE-3A /` in grey; no org row |
| Many orgs | Up to 8 org rows, then **More (n)** |
| Join with code | Link at the bottom of the section, opening the join dialog |
| Collapsed sidebar | Org **logos** with a badge dot and name on hover; personal projects show initials |
| Mobile | Same list in the menu |
| Loading / error | Existing skeletons and "unavailable" text |

Data: the sidebar's projects request also returns orgs, nested child projects, Needs you counts and unseen-announcement dots in one request.

### 29.4 G4 — Permissions (source of truth)

Built on what exists: project roles owner (Lead), admin (Co-leader), member, viewer. Only the owner transfers, archives, deletes and edits General; admins manage tabs, notifications, collaborators, roles, tasks and files; members create and assign tasks, upload files (with their upload switch on) and comment; viewers only comment.

**These two tables are the reference for building and security checks. Anything elsewhere in this report that disagrees is corrected to match.**

Legend: ✓ allowed · ✗ not allowed · 👁 read only · # counts without names

**Organization**

| Action | Owner | Admin | Member | Guest | Visitor (public org) |
|---|---|---|---|---|---|
| Open Dashboard | ✓ | ✓ | ✓ | ✓ | ✗ |
| Open About | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit About / General content | ✓ | ✓ | ✗ | ✗ | ✗ |
| Name and handle, public/private, role names | ✓ | ✗ | ✗ | ✗ | ✗ |
| Join code, join mode, Max members | ✓ | ✓ | ✗ | ✗ | ✗ |
| Invite members or guests by email | ✓ | ✓ | ✗ | ✗ | ✗ |
| Invite or promote admins; demote or remove admins | ✓ | ✗ | ✗ | ✗ | ✗ |
| Approve or decline join requests | ✓ | ✓ | ✗ | ✗ | ✗ |
| Remove or block members and guests | ✓ | ✓ | ✗ | ✗ | ✗ |
| Members tab | ✓ | ✓ | ✗ (v1) | ✗ | ✗ |
| Announcements: post, pin, audience, email | ✓ | ✓ | ✗ | ✗ | ✗ |
| Discussion posts | ✓ | ✓ | if allowed | ✗ | ✗ |
| Comment on posts | ✓ | ✓ | ✓ | ✗ | ✗ |
| Read posts | ✓ | ✓ | their audience | everyone posts | public, if allowed |
| Create or run sprints | ✓ | ✓ | ✗ | ✗ | ✗ |
| See sprints | ✓ | ✓ | own status | # | names and dates, if allowed |
| Create tasks or assignments | ✓ | ✓ | ✗ | ✗ | ✗ |
| Assignment roster with names | ✓ | ✓ | ✗ (own copy) | # | ✗ |
| Review: approve, return, extend, excuse, remind | ✓ | ✓ | ✗ | ✗ | ✗ |
| Submit on own copy | — | — | ✓ | ✗ | ✗ |
| Docs: create, edit, publish | ✓ | ✓ | ✗ | ✗ | ✗ |
| Read docs | ✓ | ✓ | ✓ | ✓ (incl. members-only) | public, if allowed |
| Files: upload, edit, trash, access levels, templates | ✓ | ✓ | ✗ | ✗ | ✗ |
| Read files | all | all | Members + Public | Members + Public | Public, if allowed |
| Download all submissions | ✓ | ✓ | ✗ | ✗ | ✗ |
| Projects tab | all incl. Private | all incl. Private | own + org-only / public | 👁 no Private | public, if allowed |
| Create child project | ✓ | ✓ | per org rule | ✗ | ✗ |
| Archive or detach a child project | ✓ | ✓ | ✗ | ✗ | ✗ |
| Verify contributions | ✓ | ✓ | ✗ | ✗ | ✗ |
| Settings | all 12 + You | 1–11 + You (owner items read-only) | You | You | ✗ |
| Transfer, archive, duplicate, delete the org | ✓ | ✗ | ✗ | ✗ | ✗ |
| `#general` | joined | joined | auto-joined | not auto-joined | ✗ |
| Create org channels | ✓ | ✓ | per org rule | ✗ | ✗ |
| DM org admins or members | always | always | admins always; members per privacy | per privacy | per privacy |
| Follow the org | — | — | — | — | ✓ (public) |
| Leave the org | after transferring ownership | ✓ | ✓ | ✓ | — |

**Child project**

| Action | Lead (owner) | Project admin | Inherited org admin | Unit member | Outside person | Org member not in it | Visitor |
|---|---|---|---|---|---|---|---|
| Open the project | ✓ | ✓ | ✓ | ✓ | ✓ | if Org only / Public | if Public |
| Edit General (name, handle, avatar) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Visibility (within the org cap) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Add or invite members; units and seats | ✓ | ✓ | ✓ (direct add) | ✗ | ✗ | ✗ | ✗ |
| Remove members (never the lead) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Archive | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Detach from the org | request | ✗ | immediate | ✗ | ✗ | ✗ | ✗ |
| Delete | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Create and move tasks | ✓ | ✓ | ✓ | own or unassigned | own or unassigned | ✗ | ✗ |
| Review the project's own tasks | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Submit the group assignment | if assigned | if assigned | ✓ (also reviews) | if assigned | if assigned | ✗ | ✗ |
| Share an update to the org | ✓ | ✓ | ✓ | ✓ (not if Private) | ✗ | ✗ | ✗ |
| See org content (docs, files, pinned line, org sprint) | ✓ | ✓ | ✓ | ✓ | ✗ | (in the org) | ✗ |
| Project chat channels | auto-joined | auto-joined | can join any (mentions) | auto-joined | auto-joined | ✗ | ✗ |
| Apply for an open seat | — | — | — | — | — | ✓ | if public with open roles |
| Leave the project | after transferring ownership | ✓ | — (leave the org) | ✓ | ✓ | — | — |

**Inherited org admin limits:** project admin rights **plus Archive and Detach**; never delete the project, transfer ownership, edit its name / handle / avatar, or remove the lead.

**Guests are read-only everywhere:** counts without names, never submissions, no posts or comments, not auto-joined to chat, read members-only docs and Members / Public folders, no Members tab, "You" sections only in Settings.

---

## 30. Search, names, trust and safety, limits, lifecycle, Network and account data (G5–G11, locked 2026-10-26)

Two findings from the code shape this section: **deleting an account today also hides and deletes every project the person owns**, and **deleting a project today is immediate** with no undo.

### 30.1 G5 — Search and ⌘K

Built on what exists: the ⌘K palette knows the area you are in (default, Discover, Network, Messages, a project with "Search this project", Settings); results are projects, people (with Connect), tasks, links, skills and settings; recent searches are saved per area; searches are rate-limited and signed-in only.

| Change | Behaviour |
|---|---|
| New result types | **Organizations** (logo, name, type, member count, membership chip) · **Assignments** (members: own copy only, `Lab 2 · due Fri · Submitted`; admins: master with counts) · **Org docs** (title and group) |
| Inside an org | **"Search CSE-3A"** first: docs, assignments, child projects, files you can open, sprints, and members (admins only); then global results |
| Inside a child project | Existing "Search this project" plus org docs and files marked **From CSE-3A** (not for outside people) |
| Privacy | Exactly per §29.4: private orgs never shown to non-members (not even names); private child projects only to members and admins; no Admins-only file or folder names; never others' copies or submissions; members only to admins; counts only for guests |
| People | Shared-org chip only if both are in that org **and** the person shows it on their profile |
| Ranking | Orgs you are in → child projects you are in → public |
| Quick actions | **Join with code** · **New assignment in <org>** (admins) · **New project in <org>** (if allowed) |
| Recent searches | Also saved per org |
| Messages quick switcher | Unchanged (§25) |

### 30.2 G6 — Handle and name rules

Built on what exists: usernames 3–20 characters `a–z 0–9 _`, normalized, with a core reserved list, a reserved-names table and kept aliases after a change; project addresses generated from the title, unique, with their own reserved list.

| Rule | Value |
|---|---|
| Handle format | 3–40 characters: `a–z`, `0–9`, `-`; starts and ends with a letter or digit; no `--`; hidden characters cleaned like usernames |
| Uniqueness | Unique across **all project addresses** (the org is a project and its address is the handle); separate from usernames |
| Reserved | Project reserved list + core username list + reserved-names table + `org, orgs, join, invite, team, teams, class, official, verified, staff, security, abuse, billing, status, docs, blog, networkbase` |
| Suggestion | From the name ("CSE-3A 2026" → `cse-3a-2026`) with a live availability check |
| Renaming | Owner only, at most once every 7 days; the old handle redirects and is **held for 90 days** |
| Display name | 2–80 characters, any language; no control characters or links; duplicates allowed |
| Child projects | Existing project rules; chat channel names change `_` to `-` |

### 30.3 G7 — Trust and safety

Built on what exists: chat message reports (no review screen), blocks between people, a platform admin check (used by the admin notifications page). No way to report a project or org today.

| Area | Design |
|---|---|
| Reporting | **Report** in the org header ⋯ and on Discover cards; also on posts, announcements, docs and comments. Reasons: impersonation, spam, harassment, inappropriate content, other + details. One reports table alongside chat reports |
| Review | New **Reports** page in the platform admin area |
| Actions | **Dismiss · Hide from Discover · Remove content · Suspend org** |
| Suspension | Read-only for everyone; hidden from Discover and search; join codes stop; emails stop; members see "This organization is suspended"; owner told the reason, appeal via support@ |
| Verified badge | **Automatic** when the owner's verified email domain matches the org website domain (not a free email provider); otherwise **Request verification** (Settings → General) for platform admin review. ✓ on header, cards, Discover |
| New public orgs | On Discover only after **3+ members and 7+ days**, or when verified; link and code work from day one |
| Email abuse | At most **5 email announcements per org per day** |
| Join spikes | 50+ joins in an hour with one code → admin Needs you "Unusual joins with code K7M2QX · Regenerate?" |
| DMs | Blocks win; existing chat reports |

### 30.4 G8 — Limits

Built on what exists: 10 MB file limit, chat caps (200 channels per project, 500 per channel), optional collaborator cap, a few rate limits; no project or org count limits. v1 values, kept in one settings file:

| Limit | v1 value |
|---|---|
| Orgs a person can own / belong to | 5 / 50 |
| Child projects per org | 200 |
| Members per org (Max members can only lower it) | 2,000 |
| Admins per org | 20 |
| Units per child project / members per unit | 20 / 100 |
| Teams per assignment | 500 |
| Copies created immediately (above: background job) | 2,000 |
| Pinned posts | 3 |
| Email announcements per org per day | 5 |
| Docs per org / doc groups | 500 / 20 |
| Sprints in one Plan a series | 52 |
| Org storage (org files + submissions) | 5 GB, warning at 80% |
| File size | Existing 10 MB |
| Org chat channels | 200 (`#general` uncapped) |
| Wrong join-code tries | 5 / min per account; 20 / min per network address logged out |
| Email invites | 200 per paste, 1,000 per day per org |
| Remind one person on one assignment | Once every 12 hours |
| Download-all zip | 2 GB per zip, larger split |
| Handle renames | 1 every 7 days |

Reaching a limit shows a plain message ("CSE-3A has reached 200 projects") and "Contact support to raise this". Actions are checked before they start, never left half done.

### 30.5 G9 — Archive, Duplicate, Delete, Transfer

Built on what exists: project archive is reversible; project delete requires typing the name and is immediate; account deletion has a 30-day grace period.

**Archive** (owner, with a preview): everything read-only; join code off; scheduled work stops (auto-start sprints, reminders, digests); chat read-only; child projects "Archived with <org>"; public orgs stay reachable with an `Archived` chip but leave the Discover feed; members keep read access; contributions end and admins are prompted to verify. **Unarchive** restores everything, creates a **new** join code (off until switched on), and never starts sprints retroactively.

**Duplicate** (owner; name, handle, term start date):

| Copied (each can be unticked) | Never copied |
|---|---|
| About, settings, role names · Docs · Folders and admin files (not submissions) · Sprint plan with shifted dates · Assignments as drafts with shifted dates · Default units · Org channel names and topics · Invite current admins | Members · child projects · submissions · messages · posts · contributions · join code |

Runs in the background; the owner is notified and the new org opens when ready.

**Delete** (owner; type the handle; preview of child projects, members, files):
1. Child projects: **detach to their leads** (default, immediate) or **delete** (same grace).
2. **30-day grace:** org hidden; members lose access **except My work** to download their own submissions; owner sees "Scheduled for deletion on <date> · Restore".
3. **E14** is sent when deletion is scheduled, with the date and "Download your submissions before <date>".
4. After 30 days the org, its files, chat, assignments and submissions are removed; contribution entries keep the org name as it was.
5. **Restore** brings the org back; detached child projects stay personal and can rejoin via Move into an organization.

**Transfer ownership:** only to an existing admin, 2-step confirmation; the old owner becomes an admin.

### 30.6 G10 — Network page

Built on what exists: tabs Your network · Suggested · Connections · Invitations (Connection requests · Project invitations · Project applications), each searchable.

| Change | Behaviour |
|---|---|
| Invitations tab | New **Organization invitations** section (same rows as My work); project invitations show the org line and unit; project applications include unit-seat applications labelled with the org |
| Join requests (admins) | Link only: "2 join requests in CSE-3A → Members" |
| Suggestions from your orgs | **Later** (matches decision 3) |
| Person cards | Shared-org chip, same rule as search |
| Network badge | Includes org invitations |
| Connections | Not needed for org DMs (decision 105) |

### 30.7 G11 — Account data

Built on what exists: export covers profile, contribution entries (published and drafts) and own messages; account deletion opens a 30-day grace period (restorable) and hides and later deletes every project the person owns.

| Area | Design |
|---|---|
| Export additions | Org memberships (org, role, title, joined / left, Show on my profile) · own assignment copies (title, org, status, due, submitted, review result, feedback) · own submission file details (names, versions, sizes, dates; files downloaded from My work) · own org posts and comments. Never others' data |
| Org owners | Account deletion **blocked while owning an org** ("Transfer ownership or delete it first", with a picker). Automatic hand-over to the longest-serving admin only for **involuntary** removal |
| Child projects they lead | **Never deleted with the account.** Ownership passes to a project admin → unit lead → org owner, with Needs you "Compiler Lab needs a new lead" |
| During the 30-day grace | Org memberships hidden; restored if the deletion is cancelled |
| At final deletion | Individual copies and submissions removed and dropped from rosters; team copies and team submissions stay as "Deleted user"; messages anonymized (existing); org contribution entries deleted |

### 30.8 Gap check

| # | Gap | Resolution |
|---|---|---|
| 1 | Search reveals a private org exists | Never by name to non-members; code holders see only the join preview |
| 2 | Handle copies a real institution | Verified badge, reporting, Discover hides new unverified orgs |
| 3 | Someone takes an old handle | Held 90 days, then released |
| 4 | Account deletion removes an org | Blocked while owning an org |
| 5 | Student deletes their account mid-term | Own copies go at hard delete; team work stays anonymized; group project ownership passes on |
| 6 | Accidental org deletion | 30-day restore; child projects protected by detaching first |
| 7 | Duplicate copies student data | Never — no members, submissions, messages or child projects |
| 8 | Spam email via announcements | 5 per org per day; existing bounce blocking |
| 9 | Suspended org with live join links | Codes stop; preview says "This organization is suspended" |
| 10 | Limit hit mid-action | Checked before starting, clear message, nothing half done |

---

## 31. Gap audit (2026-10-26) — G1–G11 designed; G12–G17 for the plan or later

A check of every app surface an organization touches. Every org tab and child project tab is designed (Sections 14–28). The items below are **not yet designed** and must be added before or during implementation planning.

### 31.1 Must design — they change what gets built

| # | Gap | What is missing |
|---|---|---|
| G1 | ✅ **Designed in §29.1** — **Join flow for people without an account** | Most students arrive through `/join/K7M2QX` logged out. Not designed: sign up → verify email → onboarding that shows the org being joined → automatic join → Dashboard, and the order of the account Welcome email and the org welcome email (E4) |
| G2 | ✅ **Designed in §29.2** — **Workspace page and drawer** (`/workspace`: My tasks · Team tasks · Invitations · Requests) | Not covered. How assignment copies, team copies, group copies for leads and Missing / Late appear across orgs; org invitations and join requests in Invitations / Requests |
| G3 | ✅ **Designed in §29.3** — **Left navigation** (`AppSidebar`) | One line only (§11). Ordering with several orgs, badges, collapse, where "Join with code" sits, archived orgs, mobile menu |
| G4 | ✅ **Designed in §29.4** — **One permissions matrix** | Rules for owner / admin / member / guest / inherited admin / child lead / unit member / outside person / visitor are spread across 15 sections. One table of every action by person is needed for building, security checks and catching contradictions |
| G5 | ✅ **Designed in §30.1** — **Search and ⌘K** (`GlobalSearch`, `CommandPalette`) | One line only (§11). What results include (orgs, child projects, docs, assignments, people) and privacy rules (never Admins-only files, others' copies or private child projects) |
| G6 | ✅ **Designed in §30.2** — **Handle and name rules** | `@handle` format, reserved words (reuse `reserved_usernames`), uniqueness against project slugs and usernames, length and characters |
| G7 | ✅ **Designed in §30.3** — **Trust and safety** | Anyone can create an org named after a real institution or company. Reporting an org, impersonation, a possible **Verified organization** badge (cut earlier, never replaced), spam orgs, join-code abuse beyond rate limits |
| G8 | ✅ **Designed in §30.4** — **Limits and quotas in one place** | Orgs per user, child projects per org, members, channels, assignments × copies, org storage — some scattered, most missing |
| G9 | ✅ **Designed in §30.5** — **Archive, Duplicate and Delete in detail** | §13 is four lines. Exactly what Duplicate copies (settings, role names, folders, docs, sprint plan with shifted dates, draft assignments, default units, channels?), whether Delete has a grace period or undo, data retention |
| G10 | ✅ **Designed in §30.6** — **Network page** | Org invitations in the Invitations tab, unit-seat applications in Application review, later "people from your orgs" suggestions |
| G11 | ✅ **Designed in §30.7** — **Account data** | Whether account export includes org submissions and contributions; what account deletion does to team copies and group projects (owner succession is already covered) |

### 31.2 Implementation plan or later

| # | Item | Where it belongs |
|---|---|---|
| G12 | Rollout: feature flag or beta, full list of database changes, data access rules (RLS), backfills | Implementation plan |
| G13 | Mobile layouts for the Tasks, Members, Files and Projects tabs (headers, Settings and Dashboard are covered) | Implementation plan |
| G14 | VS Code / NB extension: see assignments and submit from the editor | Later |
| G15 | Public org pages: search-engine titles, share previews, sitemap | Implementation plan |
| G16 | Accessibility pass for the new pickers and drag boxes (keyboard "Move to…" already included) | Implementation plan |
| G17 | Admin audit log, class calendar and schedule, attendance, billing | Later or out of scope |

### 31.3 Small fixes to fold in
- ✅ **Guest** permissions made consistent in §29.4.
- ✅ **Inherited org admin limits** stated in §29.4.

---

## 32. Full feature list

**v1:** org kind and parent link · role names by type · join with code (no QR) with approval · About tab (orgs only) · "What's happening" dashboard · assignments (copy per member and per child project) with submissions · automatic reminders · roster with Missing · org Files tree with folder access levels (Admins only / Members / Public) · submissions on assignment copies with Download all · Sprint materials view · From org view with Copy to this project and Source updated · template folders and docs · sprint materials and linked child sprints · Members tab (admin view) · settings with locked "Set by org" rows · org contribution entries with verification · Discover org card · left-nav nesting · archive and duplicate · child project creation in all entry points with the Where picker · Org only visibility · creation policy setting · admin direct-add vs. member invitations · Phase 3 units with roster picker, unit leads, open seats and default units · move into an org and detach · org sprints with materials, auto-start, plan a series and matching child sprints · child sprints inside org sprints · per-person sprint views (admin, member, guest, visitor) · sprint notifications · org time zone · task / assignment / group assignment types · submission types, late rules and reminders · Assignments, Review and Projects views · roster with Extend, Excuse and Remind · shared Q&A and private feedback · group copies submitted to org review · team assignments (Team A/B/C boxes plus individuals, auto-make, copy teams from) in the org and child projects, including Each unit · announcements with audience, notify level, pin with unpin date and comments off · Discussion posts · share-up from child projects · pinned org line in child projects · New markers · Updates settings · org header (handle, type, role chip, + New menu, Invite, Join / Request / Join with code, minimal private header) · per-person org tab bar with badges · child header breadcrumb, visibility chip and inherited admin chip · archived and detached header states · mobile compact bars · doc groups · New doc · required reading with New labels · templates with placeholders and Use this template · Publish & notify and re-read · Projects smart block · From org docs in place in child projects · submit with a doc · Members roster with filters, Behind and Outside people · member drawer · requests with notes · invite by email (including people without an account) · bulk Remind, Change role, Add to child project, Verify, Remove · owner-only admin management · block from rejoining · Max members · 12 org settings sections plus "You" sections · type-based defaults · child project Organization section and Units & open seats · locked "Set by org" rows · impact previews · automatic rule propagation · last-changed footers · detach requests · About tab mirroring the project Dashboard (overview, facts line, projects, Journey from sprints, public-safe activity, Join / Invite card, Leaders) · org Files (folder access, submissions on copies, Sprint materials, From org view with Copy) · org card and child project card · Discover Show and org filters · Portfolio Organizations group · org contribution entries with nested child projects, Verified by <org>, revocation, optional work record · `/org/<handle>` address · logged-out join preview with automatic join after onboarding and email-invite matching · My work drawer with org chips, To review, quick filters and org invitations / join requests · sidebar Workspaces with orgs, nested child projects, badges, Archived and Join with code · permissions matrix (org and child project) · org-aware search and ⌘K · handle rules · reporting, suspension and Verified badge · limits table · archive, duplicate and 30-day delete · Network org invitations · account export and deletion rules for orgs · org chat workspace with auto-joined `#general` · child projects as channel groups (`#<handle>`) inside the org · Browse projects for org admins · limited Guest workspace for outside people · announcement and assignment chat cards with Also share in #general · same-org DMs · #general posting, channel-creation and notification settings · org notification catalogue (tray kinds, importance, push, combining) · Needs you lists for admins, members and child leads · 14 org emails (E1–E14) on a shared email shell from notifications@ · due-soon daily cap and admin daily digest · always-sent access emails · per-org email mute · Organizations block in personal notification settings · Dashboard pinned strip, Coming up, privacy-filtered Activity and Get started list (§27) · Projects tab list/cards, Needs attention, bulk Archive and Remind leads (§28).

**Later:** unit channels · Reviewer role for guest examiners (Files gap 23) · higher upload limit for orgs · member directory visibility (decision 3) · points and grades · release files on a date · bulk group project creation · read tracking for required docs · storage line · gradebook export · "Members create, admins approve" policy · units in personal projects · one-project-per-member rule · start a project from an assignment.

---

## 33. Cut from the earlier external report

Removed as over-scoped: org-wide squads (a child project already is a team; units live inside one child project instead), master cadence synchroniser, zero-copy file symlink engine, live IDE presence ring, Redis rollup tables, multiple join codes, domain lock, showcase and spotlight feeds, acknowledgement read receipts, gradebook CSV, floating broadcast capsule, cover-banner and HUD redesigns. Any of these can return once real usage asks for it.

---

## 34. Organization creation end to end (locked 2026-10-29)

Replaces the outline in Section 6. Today the org path reuses the project wizard with project words: Education is picked before the person chooses, there is no "Other" type, and Phase 2 asks for a problem statement and a solution overview, which don't fit an organization. This section redesigns all five phases for organizations. Projects and child projects keep the wizard exactly as it is.

**Goal:** someone who has never used NetworkBase can create a class, team, lab, club or community in about 3 minutes. Every field answers a question a future member will actually ask.

### 34.1 The flow at a glance

| Step | Org label | Question it answers | Required |
|---|---|---|---|
| 1 Start | Start | What kind of organization? | Type (and a short label for Other) |
| 2 Info | **Details** | What is it, who is it for, what happens there? | Name, handle, About |
| 3 Team | **People** | Who runs it, what are the roles called, how do people join? | Nothing (sensible defaults) |
| 4 Settings | **Setup** | Who sees it, the term and sprints, what members can do | Nothing (type defaults) |
| 5 Review | Review | Does this look right? | — |

The header steps keep their positions. Only the labels change for orgs (Info → Details, Team → People, Settings → Setup), so the shell, footer, autosave and Back/Continue work as they do today.

### 34.2 Phase 1 — Start

**Organization** is the fourth starting-point card. Choosing it reveals **"What kind of organization?"** with **nothing selected**. Continue stays disabled until a type is chosen, and its hint reads "Choose what kind of organization this is."

| Type | Hint on the card | Roles it sets |
|---|---|---|
| Education | A class, batch or semester | Teacher · TA · Student · Guest |
| Company | A team, department or region | Owner · Manager · Member · Guest |
| Community | An open group with shared projects | Owner · Admin · Member · Guest |
| Research | A lab or research group | PI · Researcher · Member · Guest |
| Club | A student or hobby club | President · Coordinator · Member · Guest |
| **Other** [new] | Anything else: a nonprofit, an event, a government team | Owner · Admin · Member · Guest |

- Each card shows its role names in small text, so the choice explains itself.
- **Other** shows one extra field: **"What do you call it?"** (required, up to 30 characters, for example "Nonprofit", "Hackathon", "Hostel committee"). That label appears wherever the type shows: the header chip, About, the Discover card and Review.
- The type only sets **defaults**. Everything stays editable, and the type can be changed later in Settings → General.
- **Changing the type mid-wizard:** fields the person hasn't touched (role names, your title, join mode, visibility, member permissions) switch to the new type's defaults. Fields they edited stay as they are. This uses the dirty-field rule that `member_updates_enabled` already follows.
- "Have a code? Join an organization" stays at the bottom.

### 34.3 Phase 2 — Details

Heading: **Organization details** · "Tell people what this organization is, who it's for and what happens in it." The three sections keep the wizard's layout, but every field is about an organization.

**Identity: "Name your organization"**

| Field | Required | Notes |
|---|---|---|
| Name | Yes, 3–100 | Placeholder by type (34.6) |
| @handle | Yes | Suggested from the name, with a live availability check (as today) |
| Tagline | No, 200 | "One line people see on cards and search results" |
| **Part of** [new] | No, 100 | The bigger body it belongs to: "RV College of Engineering", "Acme Corp". Shown as "CSE-3A · RV College" on cards and About. Not verified; the Verified badge (§30.3) stays separate |
| **Subject / Department / Area** | No | Replaces the project Category select. A free-text label with suggestions by type: Education *Subject*, Company *Department*, Research *Research area*, Community *Topic*, Club *Activity*, Other *Focus* |
| **Where** [new] | No | City or "Online", plus **Time zone**, prefilled from the browser. The time zone drives due times, reminders and digests (§26), so it is asked here instead of being buried in Settings |

**About: "What happens here"** (replaces "Explain the work")

| Field | Required | Replaces | Shown on About as |
|---|---|---|---|
| **About** | Yes, 20–5,000 | Description | The overview paragraph |
| **Who it's for** | No | Problem statement | "Who it's for" |
| **What members do here** | No | Solution overview | "What happens here" |
| **Welcome note** | No, 500 | — (today it's only in Settings) | Shown in the welcome panel right after someone joins, and in the welcome email (E4) |

Each field has a placeholder by type (34.6), so a teacher sees class examples and a manager sees team examples.

**Discovery: "Help the right people find it"**
- **Topics:** the existing tags input (up to 20), with suggestions by type.
- The **skills and technologies** picker is hidden for orgs. Topics cover discovery, and skills belong to the projects inside.
- A note under the section: "Shown on Discover only when the organization is public (Setup step)."

**Moved out of Phase 2:** term dates and "Plan your first sprints" go to Setup (34.5), where the calendar lives.

### 34.4 Phase 3 — People

Heading: **People and joining** · "Who runs it, what the roles are called, and how people get in."

1. **You:** your title, prefilled with the type's owner name (Teacher, Owner, PI…).
2. **Role names:** four rows prefilled from the type, each editable and each with a one-line meaning:
   - **Owner:** runs the organization, can archive or delete it.
   - **Admin:** manages people, work and settings.
   - **Member:** works on projects and hands in work.
   - **Guest:** reads only.
   Permissions always come from the underlying role (§29.4).
3. **Co-admins** (optional): search people on NetworkBase or type an email. They're invited as Admin (TA, Manager…) when the org is created. Up to 10 here; more later from Members.
4. **How people join:**
   - Join code, always on (shown after creation).
   - **Instant** or **Approval required**, defaulted by type: Instant for Education, Community and Club; Approval for Company, Research and Other.
   - **Max members** (optional): blank means the platform cap of 2,000.
5. **Invite people now** (optional): paste a list of emails, for example a class roster. They get member invites when the org is created. People without an account get the invite email (§29.1). Up to 500 here; the count shows as you paste ("62 emails, 2 look wrong").

Open roles, compensation and experience levels stay hidden for orgs.

### 34.5 Phase 4 — Setup

Heading: **Setup** · "Who can see it and how it runs. Everything here is in Settings later."

| Group | Fields | Defaults by type |
|---|---|---|
| **Visibility** | Public / Private (existing control), picture, links | Private for Education, Company, Research and Other; Public for Community and Club |
| **Calendar** [moved here] | Term or period dates, labelled by type (Term, Period, Season); **Plan your first sprints** (series, as today) | Sprint name: CO for Education, Sprint for the rest; starts on the term start |
| **Projects inside** | Who creates projects (All members / Admins only), visibility cap, outside people, default units | All members; outside people off |
| **Members can** | Post updates; member uploads to the org tree | Updates on except Education; uploads off |
| **Work defaults** | One summary line with a Change link that expands the four §21 Work rows (review, late work, reminders, story points) | Education: review on, late until a date, points hidden. Others: review off, late always accepted, points shown |
| **Starter doc** | Existing starter doc with type templates: Syllabus (Education), Team handbook (Company), Code of conduct (Community, Club), Lab guide (Research), Blank (Other) | Off |

Journey stages stay hidden for orgs (§22.1): the Journey comes from sprints.

### 34.6 Copy by type

| | Education | Company | Research | Community / Club / Other |
|---|---|---|---|---|
| Name | CSE-3A 2026 · Data Structures | Acme Sales APAC | Vision Lab | Bangalore Rust Meetup |
| Tagline | Data Structures for 3rd-semester CSE, Section A | The APAC sales team's shared workspace | Computer vision research at RVCE | Monthly meetups and shared projects for Rust developers |
| About | What the course covers, how it runs, what students should know first | What the team does and how work flows | The lab's focus and how projects run | What the group is about and how to take part |
| Who it's for | Students of B.Tech CSE, 3rd semester, Section A | The APAC sales team and its regional leads | PhD and master's students in the lab | Rust developers in Bangalore, beginners welcome |
| What members do here | Weekly labs, two group projects, a mini-project proposal by Oct 15 | Weekly pipeline reports, monthly pushes, shared playbooks | Weekly reading group, paper drafts, shared datasets | Monthly talks, beginner projects, hack nights |
| Welcome note | Read the syllabus first, labs are due Sundays at 11 pm | Start with the team handbook in Docs | Add yourself to a project in Projects | Say hi in #general |

### 34.7 Phase 5 — Review

- **Discover org card preview** (type chip, Part of, tagline, member count 1), with **About tab preview** collapsed below it.
- The summary is grouped as Details · People (roles, co-admins, N email invites) · Setup.
- **Soft checks** (warnings, never blockers): "You're the only admin; add a co-admin?", "No About details for visitors (Who it's for is empty)", "Public, but no topics: it will be hard to find."
- The primary button reads **Create organization**.

### 34.8 After creation

The success screen:
- The **join code** shown large, with Copy code and **Copy invite message** in the type's voice: "Join CSE-3A 2026 on NetworkBase with code K7M2QX." The note is signed with your title, for example "— Ms. Rao, Teacher".
- What was sent: "2 co-admin invites and 62 member invites sent."
- **Go to organization** opens the Dashboard with the Get started list (§27). Steps already done in the wizard (planned sprints, invites, starter doc) show as ticked.

### 34.9 Drafts and switching

- Autosave works as today. The draft keeps the org fields while the person moves between phases.
- Switching the starting point from Organization to a project **keeps** name, tagline, About and topics. It drops the org-only fields (handle, Part of, roles, invites, calendar) after a confirm: "Switch to a project? Organization details like the handle and invites will be removed."
- Leaving mid-wizard uses the existing Leave setup dialog.

### 34.10 Checks at submit (server)

- Type is set, and Other has a label. Name and handle follow §30.2, and the handle is still free.
- About has at least 20 characters. The time zone is a valid IANA zone.
- Co-admins and email invites are de-duplicated, capped at 10 and 500, and checked against blocks. Invalid emails are skipped and reported on the success screen.
- Visibility is checked against the creator's limits (§30.4: orgs per person).
- Everything is created in one transaction. Invites and emails are queued after commit, so a failed email never blocks creation.

### 34.11 Where the fields show later

| Field | About | Discover card | Settings |
|---|---|---|---|
| Type / Other label | Facts line, header chip | Type chip | General |
| Part of | Under the name | Under the name | General |
| Subject / Department | Category line | Category | General |
| Where + time zone | Facts line | — | General |
| About | Overview | Tagline fallback | General |
| Who it's for / What members do here | Two overview blocks (replacing The problem / The solution) | — | General |
| Welcome note | — (welcome panel and E4) | — | General |
| Role names, join mode, max members | Leaders card uses the role names | Join / Request button | People, Access |

### 34.12 Data

- `projects.org_type` gains **`other`** (one migration widens `projects_org_type_check`), plus `org_settings.typeLabel` for Other's label.
- New `org_settings` keys: `partOf` and `location`. Time zone, welcome note, term dates, role names, join mode and max members already exist.
- **Who it's for** and **What members do here** reuse `problem_statement` and `solution_statement`; only the labels change for orgs. This needs no migration, and About, Edit and Settings already read these columns.
- Subject / Department reuses `category` as free text for orgs.
- Co-admin and member invites reuse `org_email_invites` and the Members invite path (§20.5).

### 34.13 Decisions (175–186, locked 2026-10-29)

| # | Topic | Recommendation |
|---|---|---|
| 175 | Type preselection | **None.** Continue is disabled until a type is chosen |
| 176 | Other type | **Add "Other"** with a required short label ("What do you call it?") and neutral defaults |
| 177 | Research and Club role names | **PI · Researcher** and **President · Coordinator** (today both use Owner · Admin) |
| 178 | Org step labels | **Details · People · Setup**, positions unchanged |
| 179 | Problem / Solution for orgs | Replaced by **Who it's for** and **What members do here**, stored in the same columns |
| 180 | New identity fields | **Part of** and **Where + time zone** in Phase 2; Category becomes a Subject / Department label by type |
| 181 | Welcome note | **Asked in Phase 2** (optional), not only in Settings |
| 182 | Skills picker for orgs | **Hidden**; Topics only |
| 183 | Term and sprints | **Move to Setup** as one Calendar group |
| 184 | Co-admins and roster invites in the wizard | **Yes**: co-admins (up to 10) and pasted member emails (up to 500), sent at creation |
| 185 | Defaults by type | Join mode, visibility and Work defaults **follow the type** (34.4, 34.5); untouched fields follow a type change |
| 186 | Switching to a project mid-wizard | Keep the shared text and **drop org-only fields after a confirm** |
