# Terminology, roles and workspace rename audit — 2026-10-28

Report only. Nothing in the app, database, SQL or file names was changed to produce it. Every count comes from read-only scans of `src/`, `drizzle/`, `tests/`, `scripts/` and `docs/` on local `main`.

**Contents**

1. [Summary and decisions](#1-summary-and-decisions)
2. [Terminology strategy and writing rules](#2-terminology-strategy-and-writing-rules)
3. [Roles: what the code does today](#3-roles-what-the-code-does-today)
4. [Roles: the decided model](#4-roles-the-decided-model)
5. [Free the word "workspace" first](#5-free-the-word-workspace-first)
6. [The workspace page (today's project detail page)](#6-the-workspace-page-todays-project-detail-page)
7. ["Project" across the rest of the product](#7-project-across-the-rest-of-the-product)
8. [Complete term table](#8-complete-term-table)
9. [Approved vocabulary](#9-approved-vocabulary)
10. [Terms not to use](#10-terms-not-to-use)
11. [Example product language](#11-example-product-language)
12. [Code, routes and database](#12-code-routes-and-database)
13. [Constraints on order](#13-constraints-on-order)
14. [Tooling to keep it consistent](#14-tooling-to-keep-it-consistent)
15. [Related findings](#15-related-findings)
16. [Other sections across the app](#16-other-sections-across-the-app)
17. [Second pass: every page, panel and dialog](#17-second-pass-every-page-panel-and-dialog)
18. [Workspace page tabs, string by string](#18-workspace-page-tabs-string-by-string)
19. [Remaining areas and corrections](#19-remaining-areas-and-corrections)
20. [Last pass: remaining screens, punctuation and formatting](#20-last-pass-remaining-screens-punctuation-and-formatting)
21. [Messages and notifications, end to end](#21-messages-and-notifications-end-to-end)
22. [Toast messages](#22-toast-messages)
23. [Appendices A–E: every location, line by line](#appendix-a-every-user-facing-string-containing-project)

---

## 1. Summary and decisions

### 1.1 Decisions (1–5 locked 2026-10-28; 6–47 accepted 2026-10-29)

| # | Decision | Outcome |
|---|---|---|
| 1 | Role names | **Owner / Admin / Member / Viewer**, one ladder for workspaces and organizations. "Lead" survives only as **Team lead**. |
| 2 | Invited advisor (today "Guide") | **Mentor** |
| 3 | Read-only level | **Viewer** (organizations may still display "Guest" as a custom name) |
| 4 | Database depth | **Full rename** in one new migration, old names kept as compatibility views for one release. Existing migration files untouched. |
| 5 | Public API | **Add `/api/v1/workspaces` now**; keep `/api/v1/projects` until the VS Code extension moves over. |

Decisions 6–47 were accepted as recommended on 2026-10-29. They are listed in §16.13, §17.14, §18.9, §19.14, §20.4, §21.4 and §22.5. All 47 decisions are now locked.

No implementation has started.

### 1.2 The size of it

| Layer | What exists today |
|---|---|
| User-facing strings with "project" | **1,543** strings in **308** files (plus 85 raw SQL strings) |
| Biggest areas | Workspace page 151 · Organizations 133 · Workspace setup 104 · Profile and contributions 103 · Workspace settings 100 · Files 76 · Error and toast copy (`lib/feedback/copy.ts`) 70 · Messages 53 · Notifications 47 · Legal pages 37 · Navigation 37 |
| Role label maps | **8** separate maps giving one role different names (§3.1) |
| Folders named `*project*` | 14 (`src/components/projects` alone holds 205 files; `src/lib/projects` 62) |
| Files named `*project*` | 149 across `src/`, `tests/`, `scripts/` |
| App routes | `/projects/[slug]`, `/projects/new`, `/messages/p/[projectId]` |
| API route folders | 11 (`/api/v1/projects/*`, `/api/v1/discover/projects`, `/api/v1/profiles/[id]/projects`, `/project-invites`, `/project-invite-options`, `/api/v1/extension/project-summary`, `/project-tasks`, `/api/og/project`) |
| Database tables | **29** named `projects` / `project_*` / `profile_project_*` |
| Columns | `project_id` in 41 tables, plus `project_title`, `project_url`, `source_project_id`, `child_project_id`, `project_count`, `projects_count`, `visible_project_count` |
| SQL functions and triggers named "project" | **29** (§12.4) |
| Stored values containing "project" | `kind = 'project'`, enum type `status_project`, `inherit_project`, asset kinds `project_cover` / `project_file` / `project_update_media` / `project_update_draft_media`, `project_invite`, `project_member.ownership_transferred` |
| Background events | `project/import`, `project/import.hydrate`, `project/updates.cleanup` |
| Storage | bucket `project-files`, object keys `projects/{id}/project-images/…` |
| Migration files | 255 SQL files + `drizzle/meta/_journal.json` |

### 1.3 The three things to know first

1. **The role confusion is a labelling problem.** The database already stores `owner / admin / member / viewer`. The screens translate those into Lead, Co-lead, Co-leader, Owner, Teacher, TA and Guest depending on where you are.
2. **"Workspace" is already taken** by five other things (§5). They must be renamed before projects take the word.
3. **The layers carry very different risk.** Words people see can change fully. Code and file names change by script. Database tables are renamed in one migration with views. Existing migrations, stored storage keys and role values never change.

---

## 2. Terminology strategy and writing rules

1. **One concept, one word, one plural.** Workspace / workspaces; Member / members; Contribution / contributions.
2. **Access levels and roles are separate words.** An access level is Owner, Admin, Member or Viewer. A role is what someone does ("Frontend developer"). They never share words.
3. **The label follows the stored value.** Where the database already has the right word (`owner`, `admin`, `member`, `viewer`, `blocked`, `completed`), the screen uses that word. Translation layers are where drift starts.
4. **Sentence case, "and" instead of "&", verb-first buttons** ("Create workspace", "Save changes", "Publish contribution", "Transfer ownership").
5. **"Project" keeps one meaning only:** an external project not hosted on NetworkBase (§7.2).
6. **Organization stays Organization.** It contains workspaces; it is not a workspace, even though both share one table today (`kind = 'organization'`).
7. **"Workspace" is never used for drawers, panels, file views or tools** (§5).
8. **One source file holds the vocabulary**, and a check fails the build when a banned term appears (§14).

Distinctions used throughout:

| Term | Means |
|---|---|
| Workspace | A shared collaborative space hosted in the app |
| Organization | A group (class, company, club) that contains workspaces |
| My work | A person's own tasks, invitations and responsibilities |
| Contribution | A person's documented involvement in a workspace or external project |
| Portfolio | Work a person chooses to showcase |
| Repository | An external GitHub or code repository |
| Member | Someone belonging to a workspace |
| Contributor | Someone whose work is documented in a contribution |
| Role | A professional function or an open position |
| Access level | The permissions granted to a member (Owner, Admin, Member, Viewer) |
| Connection | A two-way personal relationship between people |
| Follow | A one-way subscription to updates |
| Join workspace | Becoming a member of a workspace |

---

## 3. Roles: what the code does today

### 3.1 One database role, many labels

| Where | `owner` shows as | `admin` shows as | `viewer` shows as |
|---|---|---|---|
| `src/lib/projects/settings-policies.ts:148` (workspace settings, member cards) | Lead | **Co-leader** | Viewer |
| `src/lib/profile/contribution-position.ts:1` (profile contributions) | Lead | **Co-lead** | Viewer |
| `src/components/projects/settings/ProjectRolesEditor.tsx:330–494` | Lead / "Project Lead" / "Lead Role · Fixed (1 Seat)" | Co-lead | — |
| `src/components/projects/settings/CollaboratorCard.tsx:185` | "Project Lead" | — | — |
| `src/components/projects/create-wizard/phases/Phase3TeamRoles.tsx:151` | "Project lead", "You are the project lead" | — | — |
| `src/components/organizations/ChildTeamFields.tsx:215` | "Project lead": "The lead **owns** the project. You stay an **admin**…" | admin | — |
| `src/lib/organizations/config.ts:38` (org defaults) | Owner / Teacher | Admin / Manager / **TA** | **Guest** |
| `src/lib/organizations/notify.ts:114`, `OrgMembersTab.tsx:47`, `OrgRequestsSection.tsx:16` | Owner | Admin | **Guest** |
| `src/components/messages/DetailsPane.tsx:45` (chat channel roles) | Owner | Admin | — |
| `src/lib/projects/settings-policies.ts:639` (visibility audience) | "Owner" | — | — |
| `ProjectSettingsTab.tsx:1296` | "Leads can manage every setting. Co-leaders can manage…" | | |
| `ProjectSettingsTab.tsx:1470` | "Visibility is managed by the project lead" | | |
| `TasksTab.tsx:737`, `TaskCompletionSettings.tsx:51` | "A project lead approves completion" (the server lets owners **and** admins approve) | | |
| `ConversationView.tsx:553` | "With X · Lead of {project}" | | |
| `ProjectDashboardClient.tsx:1128`, `OpenRolesCard.tsx:168` | "project leaders", "Leadership appointment" | | |
| `app/actions/account.ts:340` | — | "You are now a co-leader" | |

One person can be **Lead** on the workspace page, **Owner** in the organization, **Co-lead** on someone's profile and **Co-leader** in settings, all on the same day. Appendix C lists all 93 user-facing "lead" strings and 88 "collaborator" strings.

### 3.2 Four more things called "lead"

1. **The creator's "role type".** `src/lib/validations/project.ts:27` keeps `role_type: 'founder' | 'lead' | 'contributor' | 'advisor'`. The setup flow always sends `lead` (`useCreateProjectWizard.ts:96`), saved into `import_source.metadata.creatorRoleType` with a free-text "Lead focus" (`lifecycle.ts:404`). It is a dead dimension that looks like a role.
2. **Unit lead ★.** `project_open_roles.lead_user_id` (migration `0257_unit_leads.sql`): a person in a role box who receives that group's mentions and reminders. A responsibility, not an access level.
3. **Team lead** in assignment groups (`AssignmentsPanel.tsx:219`).
4. **Profile seniority.** `profiles` experience level includes `lead` and `founder` (`schema/index.ts:218`).

A fifth near-role is **Guide** (`project_guidance_appointments`, "This project already has an active Guide"): an invited advisor, not a member role.

### 3.3 Where creator, owner and lead diverge

From `docs/organization-concept-report.md` §16.2 and `ChildTeamFields.tsx`:

| Who clicks "create" | Who becomes `owner` | What the creator becomes |
|---|---|---|
| A person, for a personal workspace | The creator | Owner |
| A member inside an organization | The creator | Owner |
| An org owner or admin, for a workspace in the organization | **The person they pick** ("Project lead") | Inherited admin through the organization |

This is the root of the confusion. The screens name the role after the act of creating ("you are the lead"), but the creator is not always the accountable person. **The role is named by accountability (Owner). "Created by" is a fact on the record, not a role.**

### 3.4 Two sources of truth for "who is owner"

`projects.owner_id` **and** `project_members.role = 'owner'` both exist. `CollaboratorCard.tsx:32` derives the role from `ownerId`, while RLS and server code check the membership row (32 server references to `role … 'owner'`; 431 references to `ownerId` in `src`). Renaming labels doesn't fix this. One column should be canonical, with a constraint or trigger keeping the other in step.

---

## 4. Roles: the decided model

### 4.1 Access levels (permissions)

| Access level | Pronunciation | Count | Can do (from `PROJECT_MEMBER_ROLE_CAPABILITIES`) | Cannot do |
|---|---|---|---|---|
| **Owner** | "OH-ner" | Exactly 1 | Everything, including **Transfer ownership**, **Archive workspace**, **Delete workspace** and all settings | — |
| **Admin** | "AD-min" | 0 or more | Manage members, roles and applications, tasks, files, notifications and public tabs; review applications; approve completed work | Transfer, archive, delete, owner-only settings |
| **Member** | "MEM-ber" | 0 or more | Create and assign tasks, upload files, comment | Manage other people or settings |
| **Viewer** | "VYOO-er" | 0 or more | Read and comment | Change work |

Why Owner and not Lead:

- It matches the stored value, so the screen and the code say the same word. The Lead ↔ owner translation layer disappears.
- It matches what organizations already show, so people see one ladder everywhere.
- It is the convention people already know (GitHub, Slack, Notion, Google Workspace, Figma).
- "Lead" is a job function. It collides with "Role" (a professional function), with "Frontend lead", with "Team lead" and with the seniority level "lead".
- "Co-lead" promises an equal position, but admins cannot transfer, archive or delete.

Why Viewer and not Guest: the stored value is `viewer`, and the word describes the access ("can view"), not where the person came from.

### 4.2 Responsibilities (on top of an access level, never instead of one)

| Term | Pronunciation | Meaning | Replaces |
|---|---|---|---|
| **Team lead** | "teem leed" | The person in a team (today's "unit") who receives that team's mentions and reminders | Unit lead ★, team lead |
| **Mentor** | "MEN-tor" | An invited advisor attached to a workspace | Guide |
| **Reviewer** | "ri-VYOO-er" | The person who approves submitted work | "project lead approves" |
| **Created by** | "kree-AY-tid by" | A fact shown on the record | Founder, creator role type |

Rule: **bare "Lead" is never written.** It always appears as "Team lead".

### 4.3 Organizations

The same four base levels. Org types keep **custom display names**, but the screen always shows the base level beside them ("Teacher · Owner"), so a TA is visibly an Admin.

| Org type | owner | admin | member | viewer |
|---|---|---|---|---|
| Default | Owner | Admin | Member | Viewer |
| Education | Teacher (Owner) | TA (Admin) | Student (Member) | Viewer |
| Company | Owner | Manager (Admin) | Member | Viewer |

An org admin's power inside one of its workspaces shows as **"Admin · from {organization}"** (today: "You stay an admin through {org}").

### 4.4 The role wording in workspace setup

| Today | Decided |
|---|---|
| Project lead: "You are the project lead…" | **Owner**: "You'll own this workspace. You can make others admins later, or transfer ownership." |
| Lead focus | Your role in this workspace *(free text, e.g. "Product design")* |
| Lead Role · Fixed (1 Seat) | Owner · 1 person |
| *(workspace in an organization)* Project lead: "The lead owns the project." | **Owner**: "Pick who owns this workspace. You stay an admin through {organization}." |

This separates **access** (fixed: Owner) from **what I do** (free text: "Your role"). Today both are packed into "Lead · Frontend".

---

## 5. Free the word "workspace" first

| Current meaning | Evidence | Rename to |
|---|---|---|
| The personal hub drawer (tasks, invitations, requests) | `components/workspace/*` (WorkspaceDrawer, WorkspaceTasksTab, WorkspaceRequestsTab, WorkspaceDrawerHost), `app/actions/workspace.ts`, route `/workspace` and its title "Workspace \| NetworkBase", `ROUTES.WORKSPACE`, `useUIStore.isWorkspaceOpen/openWorkspace`, `queryKeys.workspace`, `header/WorkspaceIndicator.tsx`, `lib/workspace/counter-buffer.ts`, `inngest/functions/workspace-counter-refresh.ts` | **My work**, route `/my-work` (redirect `/workspace`) |
| The Files tab layout | `stores/filesWorkspaceStore`, `FilesWorkspaceHeader.tsx`, `FilesWorkspaceViews`, `data-workspace-file-item`, `"files-workspace"` | **Files view** |
| GitHub sync screen | `GitHubSyncWorkspace.tsx`, `SyncWorkspace.module.css`, `lib/github/sync-workspace`, "Open GitHub Sync workspace" | **Repository sync** |
| Profile contribution editor | `profile/edit/ContributionWorkspace.tsx`, `nb-contribution-workspace` | **Contribution editor** |
| VS Code extension | "NetworkBase Workspace extension", `nb-workspace.nb-vscode-sync`, `/api/v1/extension/workspace` | **NetworkBase for VS Code** (keep the API path and extension ID; the published extension uses them) |
| Sidebar list of organizations and projects | `AppSidebar.tsx:112` "Workspaces", `SidebarWorkspaces`, `org-workspace.ts` | **Keep.** It already means the new thing |

If projects are renamed before these rows, `WorkspaceDrawer` would mean "My work" while `WorkspaceSettings` would mean a project.

---

## 6. The workspace page (today's project detail page)

### 6.1 Route and page

| Today | Workspace page |
|---|---|
| URL `/projects/{slug}` | `/workspaces/{slug}`, with a permanent redirect from `/projects/{slug}` |
| URL `/projects/new` | `/workspaces/new` (redirect kept) |
| Messages URL `/messages/p/{projectId}` | `/messages/w/{workspaceId}` (redirect kept) |
| Page component `ProjectDetailPage`, `ProjectRoute`, `project-route.tsx` | `WorkspacePage`, `WorkspaceRoute`, `workspace-route.tsx` |
| Client shell `ProjectDashboardClient.tsx`, `ProjectLayout.tsx`, `ProjectTabsRegistry.tsx` | `WorkspacePageClient.tsx`, `WorkspaceLayout.tsx`, `WorkspaceTabsRegistry.tsx` |
| "Loading project…" (`projects/[slug]/loading.tsx:8`) | "Loading workspace…" |
| "Project on NetworkBase" / "Open this project on NetworkBase." (`project-route.tsx:111`) | "Workspace on NetworkBase" / "Open this workspace on NetworkBase." |
| Organization pages share this page (`/org/{handle}`) | Keep `/org/{handle}` |

### 6.2 Tabs

The tab labels (`ProjectLayout.tsx:77`) and browser titles (`project-route.tsx:62`) disagree today. One list should drive both.

| Tab id (unchanged) | Tab label today | Browser title today | Decided |
|---|---|---|---|
| `dashboard` | Dashboard | — | **Overview** |
| `about` | About | About | About |
| `readme` / `docs` | Docs | Docs | **Documents** |
| `updates` | Updates | **Project Feed** | **Updates** |
| `sprints` | Sprints | Sprints | Sprints |
| `tasks` | Tasks | Tasks | Tasks |
| `files` | Files | Files | Files |
| `projects` *(organizations only)* | Projects | Projects | **Workspaces** |
| `members` | Members | Members | Members |
| `settings` | Settings | Settings | Settings |

Browser title format: `{Tab} · {Workspace name} · NetworkBase`.

### 6.3 Header and actions

| Today | Recommended |
|---|---|
| Add project avatar (`ProjectLayout.tsx:356`) | Add workspace image |
| Invite a project member (`ProjectLayout.tsx:387`) | Invite members |
| Follow / Unfollow project, "Following project", "Unfollowed project" | Follow / Unfollow · "You're following this workspace" / "You unfollowed this workspace" |
| Open project chat (`OpenRolesCard.tsx:140`) | Open workspace conversation |
| Project journey stages (`JourneyTimeline.tsx:146`) | Workspace stages |
| "Only the project owner can advance/revert the stage" | "Only the owner can change the stage" |
| "Project is already at the starting/final stage" | "This workspace is already at the first/last stage" |
| "That project tab is not visible for your current access." | "You don't have access to this tab." |
| "…restricted by the project leaders." (`ProjectDashboardClient.tsx:1128`) | "…restricted by the workspace owner or admins." |
| "Project members cannot apply for an additional role" | "Members of this workspace can't apply for another role" |
| "You have an invitation to this project. Accept or decline it first." | "You've been invited to this workspace. Accept or decline the invitation first." |
| "Leadership appointment for this project." (`OpenRolesCard.tsx:168`) | "Owner role for this workspace." |
| Cards `ProjectOverviewCard`, `ProjectSocialLinksCard`, `ProjectTeamAvatars`, `ProjectStatsBar` | Workspace details · Links · Members · Activity |

### 6.4 Workspace settings

From `src/lib/projects/settings-policies.ts:536–601`:

| Today | Recommended |
|---|---|
| General | Workspace details |
| Links | Links |
| Access & Visibility | Access and visibility |
| Team Members | Members |
| Roles & Applications | Roles and applications |
| Documentation | Documents |
| Updates & Discussions | Updates and discussions |
| Lifecycle & Workflow | Stages and workflow |
| Files & Storage | Files and storage |
| Notifications | Notifications |
| Privacy and Policies | Privacy |
| Danger Zone | Workspace management |

Role copy inside these sections follows §4. For example, "Leads can manage every setting. Co-leaders can manage member and viewer lifecycle…" (`ProjectSettingsTab.tsx:1296`) becomes "The owner can change every setting. Admins can manage members and viewers."

### 6.5 Workspace setup (today's creation wizard)

| Today | Recommended |
|---|---|
| "Create project \| NetworkBase", "Start a new project on NetworkBase." (`projects/new/page.tsx:12`) | "Create workspace · NetworkBase", "Set up a new workspace on NetworkBase." |
| "This will be a personal project." / "Create as a personal project" | "This will be a personal workspace." / "Create as a personal workspace" |
| Phase 1 · source | Step 1 · Start |
| Phase 2 · information | Step 2 · Details |
| Phase 3 · people / Phase 3 · team | Step 3 · Members and access |
| Phase 4 · settings | Step 4 · Settings |
| Phase 5 · review | Step 5 · Review |
| Build the initial team | Set up your team |
| Project lead / Lead focus | Owner / Your role in this workspace (§4.4) |
| Project picture (`Phase4Settings.tsx:36`) | Workspace image |
| "Controls who can find the project now…" | "Controls who can find this workspace, and which tabs visitors see." |
| "Give future collaborators enough context to decide whether the project is a fit." | "Give future members enough context to decide whether this workspace is a fit." |
| "Failed to create project" | "Couldn't create the workspace. Try again." |
| `CreateProjectWizard`, `useCreateProjectWizard`, `Phase1SourceSelection`… | `WorkspaceSetup`, `useWorkspaceSetup`, `Step1Start`, `Step2Details`, `Step3Members`, `Step4Settings`, `Step5Review` |

---

## 7. "Project" across the rest of the product

### 7.1 By area

Representative lines; Appendix A has every one.

| Area | Count | Examples today → recommended |
|---|---|---|
| **Navigation and search** (`components/layout`, `CommandPalette.tsx`, `global-search.ts`) | 37 | "Discover / Projects" → "Discover / Workspaces" · "No projects yet" → "No workspaces yet" · "Projects unavailable" → "Couldn't load workspaces" |
| **Home page** (`app/(site)/page.tsx`) | 17 | "Give your project a place to grow." → "Give your work a place to grow." · "Start a project" → "Create a workspace" |
| **Discover** | 23 | Project cards and filters → workspace cards and filters; `ProjectCard` → `WorkspaceCard` |
| **Network** | 25 | "All declared skills" → "All skills" · portfolio "projects" → "workspaces and contributions" |
| **Messages** | 53 | "Project messages" → "Workspace conversations" · "All projects" → "All workspaces" · "a project role" → "a workspace role" |
| **My work** | 13 | "Project invitations" → "Workspace invitations" · "Project applications" → "Role applications" |
| **Profile and contributions** | 103 | "Project contributions" → "Contributions" · "Link to an existing project" → "Link to a workspace" · "Add external project" **stays** |
| **Organizations** | 133 | "Changing this affects new projects only." → "…new workspaces only." · "New project in {org}" → "New workspace in {org}" · child project → "workspace in {organization}" |
| **Tasks and sprints** | 20 | "{name} was removed from the project" → "…from the workspace" · "No tasks in this project yet." → "No tasks in this workspace yet." |
| **Files** | 76 | "Project files are stored in folders…" → "Files are stored in folders…" · "Search projects" → "Search workspaces" |
| **Updates** | 25 | "project update" → "update" |
| **Notifications** | 47 | "Project invitation" → "Workspace invitation" · "Project ownership transferred" (`account.ts:327`) → "Workspace ownership transferred" · "You are now a co-leader" → "You're now an admin" |
| **Error and toast copy** (`lib/feedback/copy.ts`) | 70 | "Couldn't load project notification settings." → "Couldn't load notification settings for this workspace." |
| **Server action errors shown as toasts** (`app/actions`) | 180 | "Project not found" → "Workspace not found" · "Only project members can add a document." → "Only members can add documents." · "Invalid project" → "Workspace not found" |
| **API error messages** (`app/api`) | 40 | Same pattern; these reach the VS Code extension too |
| **Emails** (`lib/email`, `inngest`) | 17 | "Explore Projects →" → "Explore workspaces →" · welcome email "collaborate on projects, and manage tasks seamlessly across your workspace" → "join workspaces, and manage your work in one place" |
| **Legal pages** (`app/(legal)`) | 37 | Terms §6 "Projects and collaborators" → "Workspaces and members" · Privacy §16 "Account and project deletion" → "Account and workspace deletion" (§7.3) |

### 7.2 Where "project" stays

| Location | Text that stays |
|---|---|
| `ContributionWorkspace.tsx:1058` | "Add external project" |
| `ContributionWorkspace.tsx:1185` | "External project · self-reported" |
| `ContributionWorkspace.tsx:1176`, `contribution-stories.ts:141` | "Untitled external project" |
| `ContributionWorkspace.tsx:1192` | "Tell the story behind your work on this external project." |
| `ContributionWorkspace.tsx:778` | "Could not add an external project. Try again." |
| `ProjectContributionsCard.tsx:152` | "Add your external projects or contribute to **workspaces** on NetworkBase." (half changes) |
| `profile_project_contributions.project_title` / `project_url` | The external project's own name and link (data, unchanged) |

Appendix A marks these rows "Keep 'project': external". It also flags 77 rows mentioning GitHub or a repository, where "project" may mean the repository; a person must read each.

### 7.3 Legal pages

Terms, Privacy, Cookies, Acceptable use, Copyright and EULA mention "project" 37 times. Changing legal wording needs a new version date on each page and, if `check-legal-readiness.ts` and the legal-accept flow (commit `5a1f3fb6`) track versions, a re-acceptance prompt. The meaning does not change, so it can be framed as "wording updated, no change to your rights".

---

## 8. Complete term table

*Where it appears* gives the main file; Appendix B lists every location of the other terms, and Appendix C every role and people string.

### 8.1 Workspaces

| Current term | Recommended term | Pronunciation | Where it appears | Reason |
|---|---|---|---|---|
| Project | Workspace | "WURK-spays" | ~1,543 strings in 308 files | The product is a shared space for work, not a single deliverable |
| Projects | Workspaces | "WURK-spay-siz" | Sidebar, Discover, profile, routes | Same plural everywhere |
| Project detail page | Workspace page | "WURK-spays payj" | `app/(site)/(main)/projects/[slug]` | Plain |
| Project dashboard / Dashboard tab | Overview | "OH-ver-vyoo" | `ProjectLayout.tsx:77`, `PROJECT_PUBLIC_TAB_LABELS.dashboard` | "Dashboard" suggests analytics |
| Project creation / Creation wizard | Workspace setup | "WURK-spays SET-up" | `create-wizard/*` | "Wizard" is technical slang |
| Create project | Create workspace | "kree-AYT WURK-spays" | Sidebar, Discover, org "+ New ▾" (8 places) | Verb-first |
| Create as a personal project | Create as a personal workspace | "PUR-suh-nul WURK-spays" | `useCreateProjectWizard.ts:981` | Consistency |
| Phase 1…5 | Step 1…5 | "step" | `Phase*.tsx` | "Phase" is a project-management term |
| Info / Information | Details | "DEE-taylz" | `Phase2Information.tsx` | Standard |
| People and joining | Members and access | "MEM-berz and AK-ses" | `Phase3TeamRoles.tsx` | Names what you set |
| Build the initial team | Set up your team | "set up yor teem" | `Phase3TeamRoles.tsx` | Plainer |
| Project details | Workspace details | "WURK-spays DEE-taylz" | Settings → General | Consistency |
| Project avatar / picture | Workspace image | "WURK-spays IM-ij" | `Phase4Settings.tsx:36`, `ProjectLayout.tsx:356` | "Picture" is informal |
| Project owner / Project lead / Lead | Owner | "OH-ner" | §3.1, Appendix C | One accountable person, one word |
| Co-lead / Co-leader | Admin | "AD-min" | `settings-policies.ts:150`, `contribution-position.ts:3`, Appendix C | Matches the database and organizations |
| Collaborators / Team Members / project members | Members | "MEM-berz" | `settings-policies.ts:554`, `ChildUnitsPanel.tsx`, `InviteCollaboratorModal.tsx` (88 strings) | One word for people in a workspace |
| Unit / Unit lead ★ | Team / Team lead | "teem leed" | `ChildUnitsPanel.tsx`, `ChildTeamFields.tsx`, `child-units.ts`, `0257` | "Unit" is vague; "lead" is qualified |
| Guide | Mentor | "MEN-tor" | `InviteCollaboratorModal.tsx`, `ProjectTeamAvatars.tsx`, `guidance.ts` (21 strings) | Universal word |
| Project settings | Workspace settings | "WURK-spays SET-ingz" | `ProjectSettingsTab.tsx` | Consistency |
| General | Workspace details | — | `settings-policies.ts:536` | Says what is inside |
| Access & Visibility | Access and visibility | "AK-ses and viz-uh-BIL-i-tee" | `settings-policies.ts:548`, `OrgSettingsSections.tsx` | No "&", sentence case |
| Team Members | Members | "MEM-berz" | `settings-policies.ts:554` | Sentence case, one word |
| Roles & Applications | Roles and applications | "rohlz and ap-li-KAY-shunz" | `settings-policies.ts:559`, `notifications/project-policy.ts` | No "&" |
| Documentation | Documents | "DOK-yoo-ments" | `settings-policies.ts:565` | Matches the tab |
| Updates & Discussions | Updates and discussions | "UP-dayts and dis-KUSH-unz" | `settings-policies.ts:571` | No "&" |
| Lifecycle & Workflow | Stages and workflow | "STAY-jiz and WURK-floh" | `settings-policies.ts:577`, `ProjectSettingsTab.tsx` | "Lifecycle" is jargon |
| Files & Storage | Files and storage | "fylz and STOR-ij" | `settings-policies.ts:582` | No "&" |
| Privacy and Policies (workspace settings) | Privacy | "PRY-vuh-see" | `settings-policies.ts:595` | Shorter; legal pages are separate |
| Danger Zone | Workspace management | "WURK-spays MAN-ij-ment" | `settings-policies.ts:601`, `ProjectSettingsTab.tsx`, `CreateSprintModal.tsx` (5 places) | Calm, professional; destructive buttons stay red |
| Project invitation(s) | Workspace invitation(s) | "WURK-spays in-vi-TAY-shun" | Notifications, `guidance.ts:99`, Network | Consistency |
| Project applications | Role applications | "rohl ap-li-KAY-shunz" | Inbox, My work | Says what is applied for |
| Project conversation | Workspace conversation | "WURK-spays kon-ver-SAY-shun" | Messages `/messages/p/[projectId]` | Consistency |
| Choose a project / Select a project | Choose a workspace | "chooz uh WURK-spays" | `InviteCollaboratorModal.tsx:511,595,602` (7 places) | Consistency |
| "A project lead approves completion" | "An owner or admin approves completed work" | — | `TasksTab.tsx:737`, `TaskCompletionSettings.tsx:51` | Also more accurate |
| "Visibility is managed by the project lead" | "Only the owner can change visibility" | — | `ProjectSettingsTab.tsx:1470` | Accurate and direct |
| "With X · Lead of {project}" | "With X · Owner of {workspace}" | — | `ConversationView.tsx:553` | Consistency |
| Child project | Workspace in {organization} | — | Org screens, `ChildOrgSection.tsx` | "Child" is a data-structure word |
| Detach | Remove from organization | "ri-MOOV" | `ChildOrgSection.tsx` | Plain |
| Project Feed (browser title) | Updates | "UP-dayts" | `project-route.tsx:63` | Matches the tab |

### 8.2 Profiles and contributions

| Current term | Recommended term | Pronunciation | Where it appears | Reason |
|---|---|---|---|---|
| General properties | Profile details | "PROH-fyl DEE-taylz" | `EditProfileTabs.tsx` | "Properties" is technical |
| Personal identity | Basic information | "BAY-sik in-fer-MAY-shun" | `EditProfileTabs.tsx` | Plain |
| Social presence | Links and profiles | "links and PROH-fylz" | `EditProfileTabs.tsx` | Says what you enter |
| Skills & expertise | Skills | "skilz" | `EditProfileTabs.tsx`, `SkillPicker.tsx` | Shorter; one concept |
| Role preferences | Collaboration preferences | "kuh-lab-uh-RAY-shun PREF-er-en-siz" | `EditProfileTabs.tsx`, `OpenToRolesCard.tsx`, `ProfileRouteSkeleton.tsx` | Covers roles, hours and type |
| Desired roles | Preferred roles | "pri-FURD rohlz" | `OpenToCollaborateBadge.tsx`, `OpenToRolesCard.tsx`, `EditProfileTabs.tsx` | More natural |
| Weekly hours | Weekly availability | "WEEK-lee uh-vay-luh-BIL-i-tee" | Same three files | Professional |
| Positions & dates | Roles and dates | "rohlz and dayts" | `ContributionWorkspace.tsx` | One word for roles |
| Contribution summary | Your contribution | "yor kon-tri-BYOO-shun" | `ContributionWorkspace.tsx`, `ContributionSummaryEditor.tsx` | Personal, direct |
| Visitor view | View as visitor | "vyoo az VIZ-i-ter" | `ContributionWorkspace.tsx` | Verb-first |
| Link to an existing project | Link to a workspace | "link too uh WURK-spays" | `ContributionWorkspace.tsx` | Consistency |
| Project contributions | Contributions | "kon-tri-BYOO-shunz" | `ProjectContributionsCard.tsx` | Shorter |
| Add project contribution | Add contribution | "ad kon-tri-BYOO-shun" | Profile | Shorter |
| Contribution editor (component named "Workspace") | Contribution editor | "kon-tri-BYOO-shun ED-i-ter" | `ContributionWorkspace.tsx` | Frees "workspace" |
| Lead / Co-lead on contribution cards | The person's **role title** ("Product designer") | — | `contribution-position.ts` | A profile shows what someone did, not their permissions |
| Onboarding | Profile setup | "PROH-fyl SET-up" | `app/(site)/(onboarding)`, `lib/onboarding/*` (13 strings) | Users don't say "onboarding" |
| Identity (setup step) | Basics | "BAY-siks" | `lib/onboarding/step-ui-config.ts` | "Identity" means security elsewhere |
| Details · optional | About you · optional | "uh-BOWT yoo" | `step-ui-config.ts` | Friendly, clear |
| All declared skills | All skills | "awl skilz" | `PersonCardContent.tsx` | "Declared" is legalistic |

### 8.3 Tasks and planning

| Current term | Recommended term | Pronunciation | Where it appears | Reason |
|---|---|---|---|---|
| Assignee | Assigned to | "uh-SYND too" | `TaskDetailPanel.tsx`, `task.ts`… (21 strings) | Plain English |
| Issues (status column) | Blocked | "blokt" | `task-workflow.ts:49,51`, `sprint-detail.ts:190` | The stored value is `blocked`; "Issues" means GitHub issues |
| Done | Completed | "kum-PLEE-tid" | `notifications/presentation.ts:53`, `AssignmentsPanel.tsx:36`, `OrgOverviewParts.tsx:23`, `MessageCard.tsx:52` | One word for one state |
| On Time | On time | "on tym" | `task-presentation.ts:235` | Sentence case |
| Late | Overdue | "oh-ver-DOO" | `task-presentation.ts:247` | Standard term |
| Rolled Over | Incomplete | "in-kum-PLEET" | `task-presentation.ts:252`, `SprintTimelineContent.tsx` | Jargon |
| Connect desktop IDE | Connect your code editor | "kuh-NEKT yor kohd ED-i-ter" | `TasksTab.tsx`, `TaskDetailPanel.tsx`, `FilesWorkspaceHeader.tsx` | "IDE" is jargon |
| Open in IDE | Open in editor | "OH-pen in ED-i-ter" | `files-tab/OpenInIdeButton.tsx` | Same |

### 8.4 Files and documents

| Current term | Recommended term | Pronunciation | Where it appears | Reason |
|---|---|---|---|---|
| Docs (tab) | Documents | "DOK-yoo-ments" | `ProjectLayout.tsx:79`, `PROJECT_PUBLIC_TAB_LABELS.readme`, `project-route.tsx:67` | Professional; no abbreviation |
| New doc title | Document title | "DOK-yoo-ment TY-tul" | `AddDocDialog.tsx` | Consistency |
| Files workspace | Files | "fylz" | `filesWorkspaceStore`, `FilesWorkspaceHeader.tsx` | Frees "workspace" |
| File inspector | File details | "fyl DEE-taylz" | Files side panel (component names only) | Plain |
| GitHub Sync workspace | Repository sync | "ri-POZ-uh-tor-ee sink" | `GitHubSyncWorkspace.tsx` | Frees "workspace" |

### 8.5 Messages and notifications

| Current term | Recommended term | Pronunciation | Where it appears | Reason |
|---|---|---|---|---|
| Project invitation | Workspace invitation | "WURK-spays in-vi-TAY-shun" | `lib/notifications/presentation.ts`, emails | Consistency |
| Connection request | Connection request *(keep)* | "kuh-NEK-shun ri-KWEST" | Network | Already clear |
| Role application | Role application *(keep)* | "rohl ap-li-KAY-shun" | Inbox | Already clear |
| "Only channel admins can do that." | Keep | — | `messaging/errors.ts:17` | Channel admin is a separate, correct scope |
| My work drawer / "Workspace" page title | My work | "my wurk" | `/workspace` page metadata | Frees "workspace" |

### 8.6 Settings and account access

| Current term | Recommended term | Pronunciation | Where it appears | Reason |
|---|---|---|---|---|
| Account connections | Sign-in methods | "SYN-in METH-udz" | `IntegrationsSettings.tsx`, `global-search.ts` | Says what they are |
| Active sessions | Signed-in devices | "synd-IN dee-VY-siz" | `LoginHistory.tsx`, `SecuritySettings.tsx`, `global-search.ts` | People think in devices |
| Login and security activity | Sign-in activity | "SYN-in ak-TIV-i-tee" | `global-search.ts` | One verb: "sign in" |
| Editor extension sessions | Connected editors | "kuh-NEK-tid ED-i-terz" | `global-search.ts` | Plain |
| Interface density | Display spacing | "dis-PLAY SPAY-sing" | `AppearanceSettings.tsx`, `global-search.ts` | Plain |
| Privacy and policies (account settings tab) | Legal and data rights | "LEE-gul and DAY-tuh ryts" | `ROUTES.SETTINGS_TABS` (`privacy-policies`), settings nav | Separates it from the Privacy tab |
| Login (in copy) | Sign in | "syn in" | Auth screens | One verb pair: sign in / sign out |

The terms to keep (Discover, Network, Messages, Inbox, Conversations, Threads, Mentions, Reactions, Drafts, Tasks, Subtasks, Sprints, Priority, Due date, Reviewer, Submit for review, Connections, Follow, Join workspace, Repository, Version history, Linked tasks, Upload, Download, Rename, Restore, Move to trash, Account, Security, Privacy, Notifications, Appearance, Integrations, Recovery codes, Authenticator app) need no change.

---

## 9. Approved vocabulary

**Workspaces.** Workspace ("WURK-spays") · Workspaces · Workspace page · Overview ("OH-ver-vyoo") · Workspace setup · Create workspace · Workspace details · Workspace image · Workspace settings · Workspace management · Workspace invitation · Workspace conversation · Join workspace · Organization ("or-guh-nuh-ZAY-shun") · Workspace in {organization} · Team ("teem") · Stages and workflow · Access and visibility · Archive workspace ("AR-kyv") · Transfer ownership ("TRANS-fer OH-ner-ship")

**Access levels.** Owner ("OH-ner") · Admin ("AD-min") · Member ("MEM-ber") · Viewer ("VYOO-er") · Access level ("AK-ses LEV-ul")

**Profiles and contributions.** Profile ("PROH-fyl") · Profile details · Basic information · Links and profiles · Skills · Collaboration preferences ("kuh-lab-uh-RAY-shun") · Preferred roles · Weekly availability ("uh-vay-luh-BIL-i-tee") · Contribution ("kon-tri-BYOO-shun") · Contributions · Add contribution · Contribution editor · Your contribution · Roles and dates · View as visitor · Portfolio ("port-FOH-lee-oh") · Contributor ("kun-TRIB-yoo-ter") · Profile setup · Basics · About you · Publish contribution · External project

**People and relationships.** Network ("NET-wurk") · Connection ("kuh-NEK-shun") · Connections · Connection request · Follow ("FOL-oh") · Members · Team lead · Mentor ("MEN-tor") · Role ("rohl") · Role application · Preferred roles

**Tasks and planning.** Tasks · Subtasks ("SUB-tasks") · Sprints · Priority ("pry-OR-i-tee") · Due date ("doo dayt") · Assigned to · Reviewer ("ri-VYOO-er") · Submit for review · Blocked · Completed · On time · Overdue · Incomplete · Linked tasks · My work

**Files and documents.** Files ("fylz") · File details · Documents ("DOK-yoo-ments") · Document title · Repository ("ri-POZ-uh-tor-ee") · Repository sync · Version history ("VUR-zhun HIS-tuh-ree") · Upload · Download · Rename · Restore ("ri-STOR") · Move to trash · Open in editor · Connect your code editor

**Messages and notifications.** Messages ("MES-ij-iz") · Inbox ("IN-boks") · Conversations · Workspace conversation · Threads ("thredz") · Mentions ("MEN-shunz") · Reactions ("ree-AK-shunz") · Drafts · Notifications ("noh-ti-fi-KAY-shunz") · Updates and discussions

**Settings and account access.** Account ("uh-KOWNT") · Security ("si-KYOOR-i-tee") · Privacy ("PRY-vuh-see") · Notifications · Appearance ("uh-PEER-ens") · Integrations ("in-tuh-GRAY-shunz") · Sign in / Sign out · Sign-in methods · Signed-in devices · Sign-in activity · Connected editors · Display spacing · Legal and data rights · Recovery codes ("ri-KUV-er-ee kohdz") · Authenticator app ("aw-THEN-ti-kay-ter")

---

## 10. Terms not to use

| Do not use | Why | Use instead |
|---|---|---|
| **Lead** (bare), Project lead, Co-lead, Co-leader, Leader, Leadership | Means job, seniority, access level and team responsibility at once | Owner / Admin / Team lead / role title |
| Founder, Creator (as a role) | Creation is an event, not an access level | "Created by" |
| Collaborator(s) | Overlaps with Member and Contributor | Member (in a workspace), Contributor (on a contribution) |
| Project (for hosted work) | Replaced | Workspace; keep "project" only for external projects |
| Workspace (for drawers, panels, file views, tools) | Collides with the entity | My work, Files, Contribution editor, Repository sync |
| Unit | Vague | Team |
| Child project, parent | Data-structure words | Workspace in {organization} |
| Guide | Replaced | Mentor |
| Guest (as a base level) | Duplicates Viewer | Viewer (orgs may still use "Guest" as a custom name) |
| Dashboard (workspace tab), Project Feed | Analytics / mismatched | Overview, Updates |
| Phase, Wizard | Process jargon | Step, Setup |
| Danger zone | Alarmist | Workspace management |
| Issues (task status) | Means GitHub issues | Blocked |
| Done | Two words for one state | Completed |
| Rolled over, Late | Jargon / blunt | Incomplete, Overdue |
| IDE | Jargon | Code editor |
| Doc, Docs, Info | Abbreviations | Document(s), Details |
| Session(s), Login | Technical | Signed-in devices, Sign in |
| Identity (in profile setup) | Means auth and security elsewhere | Basics |
| Declared, Properties, Presence | Formal or technical | (drop), Details, Links |
| & | Writing rule 3 | and |

---

## 11. Example product language

> Create a workspace, invite members, assign tasks, manage files, and showcase your contributions.

> **Owner** — You'll own this workspace. Make trusted members admins, or transfer ownership any time.

> **Admin** — Admins manage members, roles, tasks and files. Only the owner can archive, delete or transfer the workspace.

> Ana Ruiz invited you to join **Compiler Lab** as a member. · Join workspace

> Marking work as completed sends it to a reviewer. An owner or admin approves it.

---

## 12. Code, routes and database

### 12.1 Risk by layer

| Layer | Risk | Decided handling |
|---|---|---|
| UI copy and role labels | Low | Rename fully |
| Code identifiers and file names | Low–medium (imports, `check-files-store-imports.ts`) | Rename by codemod, one pass per area |
| App URLs | Medium (sent emails, bookmarks, SEO) | `/workspaces/*` with permanent redirects from `/projects/*`, kept indefinitely |
| Public API | **High** (versioned contract, `check-api-versioning-contract.ts`; the VS Code extension calls it) | Add `/api/v1/workspaces/*`; keep `/api/v1/projects/*` as an alias until the extension moves over |
| Tables, columns, SQL functions | **High** | One new migration with compatibility views for one release; then a later migration drops the views |
| Role values `owner/admin/member/viewer` | — | **Keep**; they already match the decided words |
| Stored values with "project" | **Very high** | §12.5 |
| Storage keys, migration files | — | **Never rename** |

### 12.2 Folders (full file list in Appendix D)

| Today | Proposed |
|---|---|
| `src/components/projects` (205 files) | `src/components/workspaces` |
| `src/lib/projects` (62) | `src/lib/workspaces` |
| `src/app/actions/project` (7) | `src/app/actions/workspace` *(after today's `actions/workspace.ts` becomes `actions/my-work.ts`)* |
| `src/hooks/projects` (5) | `src/hooks/workspaces` |
| `src/app/(site)/(main)/projects` | `src/app/(site)/(main)/workspaces` (+ redirects) |
| `src/app/(site)/(main)/messages/(lists)/p/[projectId]` | `…/w/[workspaceId]` (+ redirect) |
| `src/app/api/v1/projects` | **add** `src/app/api/v1/workspaces`; keep `projects` as an alias |
| `src/app/api/v1/discover/projects`, `profiles/[id]/projects`, `profiles/[id]/project-invites`, `project-invite-options` | add `…/workspaces`, `workspace-invites`, `workspace-invite-options`; keep the old ones as aliases |
| `src/app/api/v1/extension/project-summary`, `project-tasks` | add `workspace-summary`, `workspace-tasks`; keep the old ones until the extension updates |
| `src/app/api/og/project` | `src/app/api/og/workspace` (old path redirects; links already shared on social sites use it) |

Code identifiers (`projectId`, `ProjectMemberRole`, `isProjectOwner`, `PROJECT_MEMBER_ROLE_LABELS`, `projectsQuery`…) follow the same rule. Query keys (`["discover", "projects-simple"]`, `["presence", "project", id]`…) are client cache keys and can rename freely.

### 12.3 Tables and columns

| Today | Proposed |
|---|---|
| `projects` | `workspaces` |
| `project_members` | `workspace_members` |
| `project_invitations` | `workspace_invitations` |
| `project_guidance_appointments` | `workspace_mentors` |
| `project_open_roles` | `workspace_open_roles` |
| `project_follows` | `workspace_follows` |
| `project_skills`, `project_tags` | `workspace_skills`, `workspace_tags` |
| `project_docs`, `project_doc_versions` | `workspace_documents`, `workspace_document_versions` |
| `project_updates`, `project_update_comments`, `project_update_likes`, `project_update_media_assets`, `project_update_drafts`, `project_update_draft_media_assets` | `workspace_updates`, `workspace_update_comments`, `workspace_update_likes`, `workspace_update_media_assets`, `workspace_update_drafts`, `workspace_update_draft_media_assets` |
| `project_sprints`, `project_sprint_events` | `workspace_sprints`, `workspace_sprint_events` |
| `project_workflow_columns`, `project_task_policy_events` | `workspace_workflow_columns`, `workspace_task_policy_events` |
| `project_nodes`, `project_node_events`, `project_node_locks`, `project_node_conflicts`, `project_file_index` | `workspace_nodes`, `workspace_node_events`, `workspace_node_locks`, `workspace_node_conflicts`, `workspace_file_index` |
| `project_git_deltas`, `project_event_counters` | `workspace_git_deltas`, `workspace_event_counters` |
| `profile_project_contributions`, `profile_project_contribution_stages` | `profile_contributions`, `profile_contribution_stages` *(they also hold external projects, so "workspace" would be wrong)* |

Columns: `project_id` → `workspace_id` (41 tables) · `source_project_id` → `source_workspace_id` · `child_project_id` → `child_workspace_id` · `project_count` / `projects_count` / `visible_project_count` → `workspace_count` / `workspaces_count` / `visible_workspace_count` · `lead_user_id` (0257) → `team_lead_user_id` · **`project_title` and `project_url` stay** (they describe external projects). Constraint and index names (`projects_owner_idx`, `project_open_roles_lead_user_idx`…) are renamed in the same migration.

### 12.4 How Postgres handles the rename, and the SQL functions

- `ALTER TABLE projects RENAME TO workspaces` is metadata-only and instant. **Foreign keys, indexes, RLS policies, triggers, views and realtime publications follow automatically**, because they point at the table's internal id, not its name.
- **Function bodies do not follow.** `plpgsql` and non-atomic `sql` functions store their bodies as text, so every function that names a renamed table breaks at its next call. They must be re-created in the same migration. That includes functions without "project" in their name; list them at implementation time from `pg_proc` where `prosrc` mentions a renamed table.
- **Constraint and index names** keep the old name unless renamed explicitly.
- **Raw SQL in TypeScript** does not follow either: 85 statements in 41 files (Appendix E).

The 29 functions and triggers with "project" in the name, each becoming `…workspace…` (for example `nb_workspace_can_admin`):

`allocate_project_node_event_sequence` · `chat_is_project_member` · `chat_reparent_project` · `chat_sync_project_members` · `drop_chat_of_deleted_project` · `nb_project_can_admin` · `nb_project_can_read` · `nb_project_can_write` · `nb_project_doc_member_can_read` · `nb_project_node_can_read` · `nb_project_public_doc_visible` · `nb_project_public_readme_visible` · `nb_project_read_only` · `nb_project_read_only_guard` · `nb_project_tab_visible` · `nb_project_update_pin_limit` · `nb_projects_two_levels` · `nb_task_node_link_same_project` · `project_node_events_sequence_before_insert` · `project_update_comments_read_only_guard` · `project_updates_pin_limit` · `project_updates_read_only_guard` · `projects_drop_chat_on_soft_delete` · `projects_two_levels` · `seed_project_workflow_columns` · `sync_project_open_roles_count` · `task_node_links_before_write_same_project_trigger` · `trigger_sync_project_open_roles_count` · `user_notifications_cascade_project`

### 12.5 Stored values

| Value | Recommendation | Why |
|---|---|---|
| `kind = 'project'` (vs `'organization'`) | Rewrite to `'workspace'` in the same migration, with a new check | Code branches on it (14 sites) |
| Enum type `status_project` | Rename the type to `status_workspace` (metadata only) | Consistency; values unchanged |
| Notification mode `inherit_project` | Rewrite to `inherit_workspace` in `notification_preferences` | Stored per member |
| Asset kinds `project_cover`, `project_file`, `project_update_media`, `project_update_draft_media` | Rewrite to `workspace_*` with the check constraint | Data plus constraint |
| Invitation source `project_invite`, notification type `project_member.ownership_transferred` | Rewrite old rows in the migration, or let readers accept both for one release | The inbox reads historical rows |
| Role values `owner`, `admin`, `member`, `viewer` | **Keep** | Already the decided words |
| Profile seniority `lead` (`profiles.experience_level`) | **Keep** | It is seniority, not a workspace role |
| Creator role type `founder / lead / contributor / advisor` | **Delete** | Always `lead`; dead |
| Background events `project/import`, `project/import.hydrate`, `project/updates.cleanup` | Rename to `workspace/*`; re-sync the Inngest worker after deploy | In-flight old events must drain first |
| Storage bucket `project-files`, keys `projects/{id}/…` | **Never rename** | Existing objects and signed URLs |
| The 255 migration files and `_journal.json` | **Never rename** | `check-migration-journal.ts`, `check-live-migration-lineage.ts` and the replay check depend on them |

---

## 13. Constraints on order

Dependencies to respect, not a plan:

1. §5 lands before any project → workspace rename, or the names collide.
2. Old URLs and API paths get redirects or aliases **from the moment** new ones exist, because sent emails and the published VS Code extension point at them.
3. The database migration, the re-created functions, the Drizzle schema and the 85 raw SQL strings ship in **one deploy**. The compatibility views cover anything missed for one release.
4. Legal text changes (§7.3) go out with a version date and, if versions are tracked, a re-acceptance prompt.
5. The banned-terms check (§14) lands **with** the copy change, so old words can't come back.

---

## 14. Tooling to keep it consistent

The repo already enforces contracts with `scripts/check-*.ts` (66 scripts, 52 `check:` entries in `package.json`). Terminology should follow that pattern rather than adding a framework.

1. **One vocabulary file**, for example `src/lib/copy/terms.ts`, holding the access-level labels (`{ owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" }`), entity nouns and status labels. It replaces the 8 scattered label maps in §3.1.
2. **A banned-terms check**, `scripts/check-terminology-contract.ts`: scans string literals and JSX text in `src/` for the §10 terms (bare `Lead`, `Co-lead`, `Danger Zone`, `&` in labels, Title Case labels, "project" outside an allowlist) and fails CI with file and line. An allowlist covers legitimate uses such as external projects.
3. **A naming check for files and SQL**: fails a new file whose name contains `project` once the codemod lands, and a new migration that creates a `project_*` object. It extends `standards/sql-governance.manifest.json`.
4. **Codemods for the rename itself**: `ts-morph` (or `jscodeshift`) renames identifiers, exports, files and import paths together; `git mv` keeps file history.
5. **Generated database types as the guard**: after the migration, Drizzle schema diffing (`check-db-catalog-drift.ts` already exists) catches references to tables that no longer exist.
6. **Optional prose linting**: Vale or `cspell` with a custom dictionary on `docs/` and the email templates (`src/lib/email/*-templates.ts`).
7. **A glossary page** in `docs/`, generated from `terms.ts`.

There is no i18n library in `package.json`, so a full framework (next-intl, Lingui) isn't needed for consistency. If translation comes later, `terms.ts` becomes its seed.

---

## 15. Related findings

1. **Owner has two sources of truth** (`projects.owner_id` and `project_members.role = 'owner'`), §3.4.
2. **Completion copy is wrong today**: "A project lead approves completion", but admins also hold `merge_task`.
3. **Dead creator role dimension** (`founder | lead | contributor | advisor`), always `lead`.
4. **Profile contributions show access levels** ("Lead", "Co-lead") where a role title belongs. `contribution-position.ts` already strips these words with regexes, which shows they have leaked into stored titles ("Lead - Lead").
5. **Tab label and browser title disagree** ("Updates" against "Project Feed").
6. **The Settings browser title is gated to owners only** (`project-route.tsx:83`, `canManageSettings = capabilities.isOwner`), though admins manage most settings. Check it is intended.
7. **The welcome email already says "across your workspace"** in the old loose sense.
8. **Error messages say the same thing several ways** ("Project not found", "Invalid project", "That project tab is not visible…"). Moving them into `lib/feedback/copy.ts`, which already holds 70, gives one place to fix wording.
9. **Status labels are cased differently**: `OrgOverviewParts.tsx:23` lower-cases them ("not started", "in progress") while two other files title-case them.
10. **The visibility audience says "Owner"** (`settings-policies.ts:639`) on the same page that calls that person "Lead".
11. **Organization invite notifications show the raw role value** ("…invited you to CSE-3A as viewer"), ignoring display names and the organization's own role names (`src/app/actions/org-members.ts:261`). Details in §21.1.
12. **33 specific error toasts are replaced by "Action couldn’t finish"** because their text is not in the toast catalog, so people lose the detail that tells them what to do (for example `IntegrationsSettings.tsx:340`, `ProjectDashboardClient.tsx:949`, `Composer.tsx:521`). Details in §22.2.
13. **Straight versus curly apostrophes break toast catalog matches**: "Couldn't copy the link" (`DiscoverUpdateCard.tsx:138`) misses the catalog's "Couldn’t copy the link" and falls back to the generic text. Details in §22.2.

---

## 16. Other sections across the app

This section reviews every other name and section in the app, beyond Project → Workspace and the roles. It is based on a read-only scan of about 7,700 distinct labels in `src/`. *Recommended* is the pick; where several ideas were weighed, the alternatives are listed. Items marked **Decided** were accepted on 2026-10-29 (see §16.13).

### 16.1 Patterns that repeat across the app

| Pattern | What exists today | Recommended |
|---|---|---|
| Title Case labels | 247 multi-word labels, such as "Create Sprint", "Due Date", "End Date", "Delete Task", "Add Section", "Edit Label", "Change Color", "Compare Mode", "Add Bio" (some are tool and skill names, which stay) | Sentence case everywhere: "Create sprint", "Due date" |
| "&" in labels | About 100, such as "Drafts & scheduled", "Access & joining", "Files & docs", "Launch & Iterate", "QA & Review", "Approve & complete" | "and". Skill categories ("AI & Machine Learning"): **Decided** |
| The same state written two ways | "In progress" / "In Progress", "In review" / "In Review", "My profile" / "My Profile" | One sentence-case form |
| Sign in or log in | "Log in" 28 times, "Sign in" 45 times ("Please log in to connect") | Always "Sign in" / "Sign out" |
| Error messages | "Failed to …" (hundreds), "Couldn't …", "Could not …", and the generic "Action couldn't finish" (66) | One form: "Couldn't save the task. Try again." |
| Raw system codes that may reach users | "Unauthorized" (105), "Not authenticated" (103), "Forbidden" (54), "Rate limit exceeded" (31), "Invalid request body" | Plain sentences: "Sign in to continue", "You don't have access to this", "Too many attempts. Try again in a minute." |
| Empty states | 68 "No … yet" messages, each worded differently | One pattern: what's missing, then what to do ("No tasks yet. Create the first one.") |

### 16.2 Navigation and page titles

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Builders": "Find builders & collaborators…", "Network / Builders" | People, Professionals, Members | **People** ("Find people…"). **Decided** |
| "Discover / Projects" | — | Discover / Workspaces |
| "Workspace \| NetworkBase" (the My work page) | — | My work |
| "Drafts & scheduled" | Drafts and scheduled messages | **Drafts and scheduled** |
| "Support & Help Center" | Help center | **Help and support** |
| "Grievances & Redressal" | — | Grievance redressal (the legal name in India) |
| "Connect Editor" | — | Connect your code editor |
| "Join with code" | Join with an invite code | Join with code (already clear) |

### 16.3 Discover

| Today | Alternatives considered | Recommended |
|---|---|---|
| "For you", "Trending", "Most followed", "Most viewed" | Recommended, Popular | Keep (familiar sorting words) |
| "Hiding projects you opened" | — | Hiding workspaces you've viewed |
| "People you should meet", "More people to meet" | — | **Suggested people** (one phrase instead of two) |
| "Projects and updates" | — | Workspaces and updates |
| Filters "Stage", "Type" | — | Stage, Workspace type |

### 16.4 Network and applications

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Open to collaborate" (badge) | Available | **Open to collaboration** |
| "Declared skills" | — | Skills |
| "Capacity", "Commitment" (application fields) | Availability | **Weekly availability**, **Time commitment** |
| "No cover letter." | No message | **No message included** |
| "Decided applications" | Past applications | **Reviewed applications** |
| "Project requests" | Workspace requests | Role applications |
| "Request Sent" | — | Request sent |
| "Block profile" | Block person | **Block** (a person is blocked, not a profile) |

### 16.5 Inside a workspace

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Journey", "Lifecycle", "Stage" for one idea (`JourneyTimeline.tsx`, "Project Lifecycle") | Progress, Milestones | **Stages** everywhere |
| Stage templates (`lifecycle-templates.ts`): "MVP Build", "Launch & Iterate", "QA & Review", "Alpha Release", "Community Feedback", "Stable Release" | — | "MVP build", "Launch and iterate", "Testing and review", "Alpha release", "Community feedback", "Stable release"; keep "Vertical slice" (a game-development term) |
| Status "Finished & Live" (`EditProjectModal.tsx`) | Live | **Completed** (matches the stored status) |
| "Open roles", "Positions", "Seats" for one idea | Openings | **Open roles**, counted in people, not seats ("2 of 3 filled") |
| "Public surface", "Surfaces", "Public surfaces changed" | Visitor view | **Public page** ("Public page settings changed") |
| Workspace types such as "Side project" | Personal project | Keep "Side project": a kind of work, not the hosted thing |

### 16.6 Organizations

| Today | Alternatives considered | Recommended |
|---|---|---|
| Unit, group and team for nearly the same thing (48 "unit", 109 "group") | — | **Team** for people inside a workspace; **Group** only for assignment groups. **Decided** |
| "Detach", "Move-in and detach requests" | Remove from organization | **Move in** / **Move out**, grouped as "Organization move requests" |
| "Handle" | Username | **Organization URL** ("networkbase.in/org/…") |
| "Behind", "Behind first" | Falling behind | **Needs attention** |
| Assignment states "Excused", "Returned", "Missing" | — | Keep "Excused" (standard school term); "Returned for changes"; "Not submitted" |
| "Brief" (assignment) | — | **Instructions** |
| "Course materials", "Materials" | — | Keep for education organizations |
| "Inherited admins" | — | Admins from the organization |
| "Needs you" | — | Needs your attention |
| "Danger zone" (organization settings) | — | Organization management (matches Workspace management) |
| "Access & joining", "Files & docs", "Guides & policies" | — | Joining and access, Files and documents, Guides and policies |

### 16.7 Messages

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Canvas" (54 uses) | Canvas (familiar from Slack), Notes, Pages | **Channel notes**: doesn't clash with workspace documents and needs no explanation. **Decided** |
| "Decision record" | — | **Decision** |
| "Bookmarks" | Pinned links, Saved links | Keep |
| "Copy ID" | Developer-only view | Remove from the menu |
| "Default channel", "Direct messages", "Channels", "Threads" | — | Keep |

### 16.8 Tasks and sprints

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Section", "Column", "Workflow section" for one thing | Status, Stage | **Column** ("Add column") |
| "Backlog", "Backlog (no sprint)" | — | "Backlog" alone |
| "Checkpoints" (completed subtasks) | — | Subtasks ("All subtasks complete") |
| "Close-out required" | Review before closing | **Wrap-up needed** |
| "Sprint story", "Sprint rhythm" | — | Sprint summary, Sprint schedule |
| "Mention Teammate", "Teammate" (18) | — | Member ("Mention a member") |
| "Approve & complete" | — | Approve and complete |
| "Destination Sprint" | — | Move to sprint |
| "Mark all done", "Mark as done" | — | Mark as completed (pairs with Done → Completed) |

### 16.9 Files

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Revision" (60) next to "Version history" | — | **Version** everywhere |
| "Active revision", "Apply to Active Revision", "Commit as New Revision" | — | Current version, Make this the current version, Save as new version |
| File roles: reference, working file, deliverable / final deliverable | Reference / Working / Deliverable | **Reference / Draft / Final**. **Decided** |
| "File role" | File type | **File purpose** |
| "Project root", "Project Files" | Workspace files | **All files** |
| "Compare Mode", "Close Comparison" | — | Compare versions |
| "Commit attribution" | — | Commit author |
| "Associated Task" | — | Linked task |
| "Publication" (GitHub sync) | Publish to repository | "Publish", saying where: "Publish to GitHub" |

### 16.10 Updates and documents

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Add Context" | Add references | **Link work** |
| "Link File", "Link Sprint", "Link Task" | — | Link a file / sprint / task |
| "Doc", "Add doc", "New doc" | — | Add document |
| "Former member" | — | Keep |

### 16.11 Profiles and contributions

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Contribution story", "Tell the story…" | Case study | **Contribution**; "story" may stay in helper text |
| Story sections: "Decisions & challenges", "Outcomes & lessons", "Responsibilities & outcomes", "Demo & media" | — | Same wording with "and" |
| "Work examples" | — | **Work samples** |
| "Position" (61) next to "Role" | — | **Role** everywhere ("Add role", "Roles and dates") |
| "Demonstrated skills" | Proven skills | **Skills used** |
| "Profile credit" (notifications) | — | Contribution credit |
| "Currently contributing" | — | Current |
| "Weekly capacity" (setup), "Weekly hours" (profile), "Capacity" (applications) | — | **Weekly availability** on all three |
| "Social destinations", "Social links" | — | **Links** |
| "Professional information" | — | Work details |
| "How you identify" (gender) | — | Gender (optional) |

### 16.12 Settings, notifications and legal

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Authorized sessions" (a third name, besides "Active sessions") | — | Signed-in devices |
| "Cache management", "Application cache" | — | **Storage on this device** |
| "Blocked accounts and activity" | — | Blocked people |
| "Dev check" | — | Hide from regular users |
| "Cookies & Local Storage", "Copyright & Takedowns" | — | Cookies and storage, Copyright and takedowns |
| Notification groups "Files & Workspace", "Membership & Access", "Security & Audit", "Project Lifecycle", "Future Surfaces" | — | Files, Members and access, Security, Stages, Public page |
| "Follower digest" | — | Follower summary |
| "Snooze", "Quiet hours" | — | Keep |
| "End User **Licence** Agreement" and "End User **License** Agreement" both appear | — | **License** (US English, decision 23; corrected in §19.1) |
| "Data Processing **Addendum**" and "Data Processing **Agreement**" both appear | — | One name: whichever the legal document actually is |

### 16.13 Decisions (accepted 2026-10-29)

| # | Question | Decision (accepted 2026-10-29) |
|---|---|---|
| 6 | Canvas: keep it, or call it "Channel notes"? | Channel notes |
| 7 | Unit, group, team: "Team" for people in a workspace and "Group" only for assignment groups? | Yes |
| 8 | File roles: "Reference / Draft / Final" or "Reference / Working / Deliverable"? | Reference / Draft / Final |
| 9 | "&" in skill categories: replace with "and" too, or let the skill list keep "&"? | Replace, for one rule everywhere |
| 10 | "Builders": part of the brand voice, or becomes "People"? | People |
| 11–15 | Second pass decisions | See §17.14 |

---

## 17. Second pass: every page, panel and dialog

A deeper read-only pass, covering full sentences, helper text, tooltips and dialog titles on every surface: marketing, sign-in, profile setup, profile, workspace page, workspace settings, task panel, sprints, settings, Discover, Network, Messages and the file viewer. Everything here is new; items already in §8 or §16 are not repeated. Items marked **Decided** were accepted on 2026-10-29 (see §17.14).

### 17.1 The biggest findings

| # | Problem | What exists today | Recommended |
|---|---|---|---|
| A1 | **A workspace's progress has four different sets of words** | Stored status (Draft, Active, Completed, Archived); card status (**Forming, Building, Shipped, "Finished & Live"**); edit-dialog status (**Concept, Team Formation, Beta, Launch**); stage templates (Discovery, Design…) | Two concepts only. **Status:** Draft, Active, Completed, Archived. **Stage:** the workspace's own stages. Drop Forming, Building and Shipped. **Decided** |
| A2 | **Four ways to keep something for later** in Messages | **Saved** (messages with reminders), **Starred** (conversations), **Pins** (inside a conversation), **Bookmarks** (links in the channel header) | **Saved:** private items. **Pinned:** shared in a conversation. **Starred:** keep. **Bookmarks → Channel links**. **Decided** |
| A3 | **Two editors for the same workspace details, with different section names** | The edit dialog (`EditProjectModal.tsx`): "Essentials, Details, Stack & Links, Journey, Team & Roles"; Settings: "General, Links, Lifecycle & Workflow…" | One set of section names, the same as Settings (§6.4) |
| A4 | **Several words for one description** | "Tagline", "Short description", "A brief pitch…"; "Full Description"; "Problem Statement" / "The Problem"; "Solution Overview" / "The Solution" | **Summary**, **Description**, **Problem**, **Approach**. **Decided** |
| A5 | **Technical wording people can see** | "Editing lease is not held", "Synchronization lease was lost", "Upload intent expired", "positions remain complete and deterministic", "Issuing revocable session token…", "Local IDE Bridge", "virtual files", "Manual fallback token", "Web login", "intake", "hub and portfolio feed", "Keyword tags used for search indexing" | Plain words: "Someone else is editing this file", "Upload timed out. Try again", "Connecting to your editor…", "Tags help people find this workspace" |
| A6 | **"Updates" means two things** | Contributions say "Publish updates" and "Updates published", but "Updates" is also a workspace tab | Contributions: **Publish changes**, **Changes published** |
| A7 | **Copy assumes everyone is a developer** | "Connect with developers…" (welcome text), though the app also serves designers, students and researchers | "Connect with people…" |
| A8 | **Discover and Discovery** | The page is "Discover"; profile setup says "hidden from Discovery" | **Discover** everywhere |
| A9 | **Five words for people in a workspace** | Teammate, collaborator, team member, people, member | **Member** (Contributor only on contributions) |
| A10 | **Tone** | "Welcome to the Team!", "Access Granted", "Link copied!", "Editor connected successfully!", "SPOTS LEFT", "STATUS: ARCHIVED" | No exclamation marks, no all-caps, no "successfully" ("Invitation sent") |
| A11 | **Sample text in form fields** | "John Doe", "San Francisco, CA", "e.g. NextGen CRM", "Full Stack Developer \| OSS", "Words go here", "e.g., CO1" | Neutral, local examples: "e.g. Bengaluru, India", "e.g. Product designer", "Start writing…" |

### 17.2 Marketing site

| Today | Alternatives considered | Recommended |
|---|---|---|
| "The talent pool" | People on NetworkBase | **Find people** ("talent pool" sounds like recruiting) |
| "Discover projects, find collaborators… in one workspace" | — | "Discover workspaces, find people by skill…" |
| "Dashboard — Activity, progress and contributions at a glance" | — | "Overview — …" |
| "Editor sync — Work on project files…" | Editor integration | **Code editor**: "Work on files and tasks from VS Code, Cursor or Windsurf" |
| "Roles and permissions — Decide who can view, edit and manage each project" | — | "Access levels — Decide who can view, edit and manage each workspace" |
| "Messages — Channels and direct messages for every project" | — | "…for every workspace" |
| "Invite collaborators and agree on the next steps." | — | "Invite members and agree on the next steps." |
| "Trade Mark" (footer) | — | **Trademark** |
| "Example project", "3 people on the team" | — | "Example workspace", "3 members" |
| "Start a project" | — | "Create a workspace" |

### 17.3 Sign in, sign up and password

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Two-step sign-in", "Sign-in protection", "MFA factor", "Authenticator" (four names for one feature) | Two-step sign-in | **Two-step verification** (the most recognised term). **Decided** |
| "Verify you are human" | — | **Security check** (other screens already say "Complete the security check") |
| "I've verified, continue" | — | "I've verified my email" |
| "Your first project is three steps away." | — | "Your first workspace is three steps away." |
| "Unlocks messages and projects" | — | "Unlocks messages and workspaces" |
| "Account recovery — We'll get you back in." | — | Keep the panel; the page title stays "Reset your password" |
| "Failed to sign out. Please try again." | — | "Couldn't sign out. Try again." |
| Editor connect page: "Local IDE Bridge", "Issuing revocable session token…", "Generating revocable device token…", "Handing off to editor…" | — | "Connect your code editor", "Connecting…", "Opening your editor…" |
| "Your workspace, inside your editor." | — | "Your work, inside your code editor." (avoids the old meaning of "workspace") |
| "Projects, virtual files and task pushes." | — | "Workspaces, files and tasks." |

### 17.4 Profile setup

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Let's set up your profile" | — | Keep |
| "Final review" / "Ready to finish" | — | **Review** / "Ready to finish" |
| "Setup hit a problem" | — | "Setup couldn't continue" |
| "Other people see a limited profile shell." | — | "Other people see a limited profile." |
| "Optional topics help refine project and collaborator recommendations." | — | "Topics help us suggest workspaces and people." |
| "Your profile is live. Connect with developers…" | — | "Your profile is live. Find people, join workspaces and start working together." |
| "A short tagline for your profile." (Headline field) | — | "A one-line summary of what you do." |

### 17.5 Profile page and contribution editor

| Today | Alternatives considered | Recommended |
|---|---|---|
| "My Profile \| NetworkBase", "Your personal profile and presence…" | — | "My profile" |
| "Position history" | — | **Role history** |
| "Platform verified role", "Verified position" | — | **Verified role** |
| "Featured contribution" next to "Pin contribution" | Pin | **Feature on profile** / **Featured** (the database field is already `featured`) |
| "Restore to presentation", "Hide from presentation" | — | "Show on profile" / "Hide from profile" |
| "Writing starters" | Ideas to start | **Writing prompts** |
| "Project identity" (contribution section) | — | "Workspace or project" |
| "Overall contribution" | — | "Whole contribution" |
| "Associate with a position" | — | "Link to a role" |
| "Skills demonstrated" next to "Demonstrated skills" | — | **Skills used** (one name) |
| "Mention a teammate", "Find teammate by name" | — | "Mention a member" |
| "Platform contributions appear when you join a project." | — | "Contributions appear when you join a workspace." |

### 17.6 Workspace page and its dialogs

| Today | Alternatives considered | Recommended |
|---|---|---|
| Welcome card: "Welcome to the Team!", "Access Granted", "You are now an official member of…" | — | "Welcome to {workspace}" · "You're now a member. You can see documents, tasks and sprints." |
| "My Tasks — View your assignments" | — | "Your tasks" ("assignments" belongs to organizations) |
| "Read Docs — Get up to speed" | — | "Read documents — Catch up on the work" |
| "Invite Collaborator" | — | **Invite members** |
| "Apply to Join" | — | **Apply for a role** |
| "SPOT LEFT", "SPOTS LEFT" | — | "1 open", "2 open" |
| "Guidance label", "Invite as Guide", "Guide capacity" | — | "Mentor focus", "Invite as mentor", "Mentor limit" |
| "Make your project stand out" (edit dialog) | — | "Edit workspace details" |
| "Project Status" (Forming / Building / Shipped) | — | Removed (A1) |
| "Roadmap synchronization", "Milestone journey stages…", "Drag stages using the grip handle to reorder the project roadmap timeline." | — | "Stages" · "Drag to reorder stages." |
| "The project's reviewers have been told." | — | "The reviewers have been notified." |
| "Tell the reviewers why you are a fit." | — | Keep |

### 17.7 Workspace settings

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Project avatar", "Replace avatar", "Square avatar displayed on project cards…" | — | **Workspace image** throughout |
| "public identity" | — | "name and image" |
| "Primary category to help builders discover your project." | — | "…helps people find this workspace." |
| "Lifecycle roadmap alignment", "Define the journey stages used by the project dashboard, roadmap, and milestone tracking." | — | "Stages — the steps this workspace moves through." |
| "File permission rules", "Enabled members", "Disabled members" | — | "Upload permissions", "Can upload", "Can't upload" |
| "Locked on for responsibility or safety." | — | "Always on for owners and admins." |
| "Use project defaults", "Managed by project policy." | — | "Use workspace defaults", "Set by the workspace." |
| "Project group" (the member chat) | — | "Workspace channel" |
| "Restore active collaboration, intake, notifications, and publishing" | — | "Members can work, apply, post and get notifications again." |
| "Leaders", "Docs stay leaders-only." | — | "Owner and admins", "Only the owner and admins can see documents." |
| "What members can do", "What the team is told about", "Launch settings" | — | Keep the first two; "Launch settings" → "Starting settings" |

### 17.8 Task panel

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Properties" (task side panel) | — | **Details** |
| "Task References", "Final Deliverables", "Attachments" (three file groupings) | — | **Reference files**, **Final files**, **Comment attachments** (follows decision 8) |
| "Story Points", "Unestimated" | Points | **Estimate** / "No estimate". **Decided** (14): Estimate |
| "Planning & Assignment", "Schedule & Estimate", "Subtasks & References" | — | "Sprint and assignee", "Schedule", "Subtasks and files" |
| "Task state" next to "Status" | — | **Status** |
| "Overtime" (alongside Overdue, Late, Rolled over) | — | Remove, or "Completed late" |
| "Needs reassignment", "Removed from project · Needs reassignment" | — | "Needs a new assignee" |
| "Resubmit current work" | — | "Submit again" |
| "Return to In progress" | — | "Move back to In progress" |
| "+1 Week", "+2 Weeks" | — | "+1 week", "+2 weeks" |
| "Only the project owner can add tasks to a sprint." | — | "Only the owner and admins can…" (check the real rule first) |

### 17.9 Sprints

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Planning Sprint", "No Planning or active Sprint available" (shown elsewhere as "Upcoming") | — | **Upcoming sprint** |
| "Sprint lifecycle options", "Sprint lifecycle" | — | "Sprint actions", "Sprint history" |
| "Unfinished task handling" | — | "Unfinished tasks" |
| "Sprint Goal", "Sprint Name", "Start Date" | — | Sentence case |
| "Sprints created by project leads will appear here." | — | "…created by the owner or admins…" |
| "Show in child projects" | — | "Add to every workspace in the organization" |

### 17.10 Settings

| Today | Alternatives considered | Recommended |
|---|---|---|
| "What happens to your things" (account deletion) | — | "What happens to your data" |
| "Download my data", "Export account data", "Download JSON" (three names) | — | **Export your data** |
| "Projects you own are deleted…" | — | "Workspaces you own are deleted…" |
| "The identity attached to your signed-in account." | — | "Your account details." |
| "Choose the interface theme and shared action color." | — | "Choose light or dark, and your accent color." |
| "Manual authentication token", "Manual fallback token", "Web login", "Authorized sessions", "Editor sessions", "Editor connections" | — | **Connected editors** and **Access tokens** only |
| "Connected projects", "Cloned repository" | — | "Connected workspaces", "Repository" |
| Push wording: "Push permission…", "web push" | — | "Browser notifications" |
| Legal list: "Service Providers" (page titled "Subprocessors"), "Security Reporting" (page "Security Reporting Policy"), "Current & Active", "Governing policies", "Policies and account rights" | — | Match each page title; "Accepted"; "Policies"; **Legal and data rights** |
| "Sessions and sign-ins", "Security activity", "Sign-in protection" | — | "Signed-in devices", "Sign-in activity", "Two-step verification" |

### 17.11 Discover and Network

| Today | Alternatives considered | Recommended |
|---|---|---|
| "Builder search results", "Find builders" | — | "People results", "Find people" (decision 10) |
| "Discovery view" | — | "View" |
| "Shared connections", "Has shared connections" | — | **Mutual connections** (the familiar term) |
| "Find people to connect with" | — | Keep |

### 17.12 Messages

| Today | Alternatives considered | Recommended |
|---|---|---|
| Saved, Starred, Pins, Bookmarks | — | See A2 |
| "Switch project", "All projects", "Project channels show up here." | — | Workspace wording |
| "Decided (…)" (applications in the sidebar) | — | "Reviewed" |
| "Notify everyone online" / "Notify everyone in this conversation" | — | "@here: active members", "@channel: everyone" |
| "Words go here" (canvas placeholder), "Jot something down…" | — | "Start writing…", "Write a note…" |
| Canvas template groups "Team, Meetings, Projects, Operations" | — | "Team, Meetings, Planning, Operations" |
| "Conversation views", "Edit tabs", "Hide canvas tab" | — | "Tabs" |
| "Mark as new" (notifications) next to "Mark as unread" (Messages) | — | **Mark as unread** in both |
| "Copy your version" | — | "Copy my version" |

### 17.13 File viewer and other dialogs

| Today | Alternatives considered | Recommended |
|---|---|---|
| Tooltips such as "Toggle Canvas Layout (EMU Positioned) vs Flow View", "Toggle Pixelated Upscaling (Crisp Edges)", "SVG Source Code", "Copy entire filtered table to clipboard as TSV" | — | "Switch layout", "Sharp pixels", "View source", "Copy table" |
| Title Case tooltips and titles: "Zoom In", "Reset Zoom", "Next Slide", "Version History", "Move to Trash", "Edit Project", "Add Section" | — | Sentence case ("Move to trash" is a keep term) |
| Shortcut hints written different ways: "(Esc or F)", "(Right Arrow / L)", "(?)" | — | One style: "Zoom in · +" |
| "Share Options", "Share project" | — | "Share", "Share workspace" |
| "Upload remainder", "Re-upload" | — | "Upload the rest", "Upload again" |
| "Some names already exist" | — | "Some files have the same name" |

### 17.14 Decisions: second pass (accepted 2026-10-29)

| # | Question | Decision (accepted 2026-10-29) |
|---|---|---|
| 11 | Workspace progress words: only Status (Draft, Active, Completed, Archived) plus Stages, dropping Forming, Building, Shipped? | Yes |
| 12 | Keeping things for later: Saved, Pinned, Starred and Channel links? | Yes |
| 13 | Two-step verification, or keep "Two-step sign-in"? | Two-step verification |
| 14 | Story points: keep them, or call them "Estimate"? | Estimate |
| 15 | Description fields: Summary, Description, Problem, Approach? | Yes |
| 16–22 | Workspace tab decisions | See §18.9 |

---

## 18. Workspace page tabs, string by string

A read-only pass over every string inside the workspace page tabs, about 2,700 in all: Overview 378, About 22, Documents 88, Sprints 126, Tasks 386, Files 1,281 (including repository sync and file versions) and Settings 444. Rows already in §16–17 are not repeated. Items marked **Decided** were accepted on 2026-10-29 (see §18.9).

### 18.1 Problems that run across all the tabs

| # | Problem | What exists today | Recommended |
|---|---|---|---|
| W1 | **"Publish" means five things** | Publish a document version; "Publish to Project Files" (moving a task's draft file into Files); publish to GitHub; publish a contribution; "Project update published" | **Publish** only for documents and contributions. Updates are **Posted**. Task drafts are **Added to Files**. GitHub is **Push**. **Decided** |
| W2 | **Task statuses are spelled differently on each screen** | Board: "To do, In progress, Blocked, Done". Files filter: "**Todo**, In Progress, Done, **Needs Review**". Badges: "In Review". Column: "Issues" | One list everywhere: **To do · In progress · In review · Blocked · Completed**. **Decided** |
| W3 | **Five words for notes on a file** | Label, tag, annotation, note, description | **Label** (the short chip) and **Note** (longer text) only. **Decided** |
| W4 | **File views are called "collections"** | Recent, Starred, Trash, Deliverables, Task files, GitHub Sync | **Views**: All files, Recent, Starred, Task files, Final files, Repository sync, Trash. **Decided** |
| W5 | **"Change role" changes the access level** | The member card says "Change role to…" for Owner, Admin, Member, Viewer, but "role" means a job such as "Frontend developer" (§2) | **Change access level**. **Decided** |
| W6 | **Seven words for an open role** | Position, Vacancy, Seat, Spot, Headcount, Occupant, Occupied | **Open role**, **Number of people**, **Filled by**, "2 of 3 filled" |
| W7 | **A third name for Admin, plus "leadership"** | "You will be demoted to **Administrator**", "Project Leadership", "Leadership appointment", "Leaders", "project leaders" | **Owner and admins**; "You'll become an admin" |
| W8 | **Infrastructure words people can see** | S3, slug, preflight, blobs, storage objects, storage key, lease, upload allocation, deep link, buffer, "seeded v1", deterministic, execution, recorded operation, snapshot, UTF-8 | Plain words (examples in each table below) |
| W9 | **Alarming or legal-sounding warnings** | "Warning: Irreversible destruction", "Data to be destroyed", "STEP-UP PROTECTED", "OWNER ONLY", "primary administrative ownership", "Ownership consequence review" | Calm and specific: "This can't be undone. These will be deleted: …" |
| W10 | **"Ask an editor"** | "You have view-only access to this task. Ask an editor to attach files." "Editor" is not an access level | "Ask an owner or admin." |
| W11 | **"Open source" as a button** | In the task panel it opens the chat message the task came from, but reads like open-source software | **Open original message** |
| W12 | **A typo in the extension name** | "NetworkBase **WorkSpace** extension" next to "NetworkBase Workspace extension" | "NetworkBase for VS Code" (§5) |

### 18.2 Overview tab (today "Dashboard")

| Today | Recommended |
|---|---|
| Header: "Project overview", "Project sections", "Project actions", "Add avatar", "Invite a project member" / "Invite a member" / "Invite" | "Workspace overview", "Workspace sections", "Workspace actions", "Add image", **Invite members** |
| "Vision & Description" | **About this workspace** |
| "The Problem" and "The problem" (both casings) | "Problem" (decision 15) |
| "Skills & Tech" | **Skills and tools** |
| "Looking for" / "Not recruiting" | "Looking for" / **Not looking for members** |
| "Click to read full text", "Read full description" | **Read more** |
| "This project has not added an overview, description, or statement yet." | "No details yet." |
| Stage arrows: "Advance to next stage", "Return to previous stage"; toasts "Advanced to X", "Returned to X" | "Next stage", "Previous stage"; "Moved to X" |
| "Stage updated from another session. Synced latest stage." | "Someone else changed the stage. Showing the latest." |
| Open roles card: "Team member", "Review ›", "{n} left" | "Member", **Review applications**, "{n} open" |
| Members card: "Team", "View all N team members", "Loading project team" | "Members", "View all N members" |
| Links card: "Destination", "Destination name", "Identifying destination…", "Refresh destination name", "Purpose" | "Link", "Link name", "Finding the site name…", "Refresh name", **Category** |
| "Paste or drop one or several URLs. They are staged immediately; Save changes commits everything once." | "Paste one or more links. They're saved when you select Save changes." |
| "This URL contains credential-like parameters…" | "This link may contain a password or key. Check it before saving." |
| "Cloned repository", "Connected repository", "Managed by integration", "Name check is over 30 days old" | "Imported from GitHub", "Connected to GitHub", "Managed by GitHub", "Name may be out of date" |
| "Total views", "Total followers" | "Views", "Followers" |
| Default invite note: "Hey {name}, I think you'd be a great fit… Let's build this together!" | "Hi {name}, I think you'd be a good fit for the {role} role on {workspace}." |
| "Why are you a fit?", "Describe your relevant skills, execution style, and first-week contribution.", "Good application detail." | "Why you're a good fit", "Your relevant skills and how you'd get started.", (remove) |
| "Invitation note", "Add a friendly note...", "Portfolio / GitHub" | "Message (optional)", "Portfolio link" |
| "Submit Application", "Send Invitation" | "Submit application", "Send invitation" |
| Edit dialog: "Roadmap synchronization — Use the dashboard Advance button…", "These icons appear beside the project title across every project tab.", "Define milestones your team will progress through" | "Use Next stage on the Overview to move between stages.", "Links appear next to the workspace name.", "Add the stages this workspace moves through." |

### 18.3 About tab (organizations only)

Workspaces have no About tab; their "about" text lives in the Overview card.

| Today | Recommended |
|---|---|
| "Term {start} – {end}", "Plan your term" | Keep "Term" for education organizations; "Period" for other types |
| "Leaders" | **Owner and admins** |
| "Journey" | **Stages** |
| "The join code is off." | "Joining by code is turned off." |
| "Guest · read-only" | "Viewer · read only" |
| "Projects — See all →" | "Workspaces — See all" |

### 18.4 Documents tab (today "Docs")

| Today | Recommended |
|---|---|
| "Doc created", "Add doc", "New doc", "Added to Docs", "Remove from Docs", "Doc unavailable", "No docs yet" | **Document** everywhere: "Document created", "Add document", "Remove from Documents", "No documents yet" |
| "Pin Markdown files from Files to read them here." | "Add Markdown files from Files to see them here." ("pin" means something else in Messages) |
| "This organization doc is not shared with this project." | "This organization document isn't shared with this workspace." |
| Live block "Contributors — Active project contributors and collaborators." | **Members** — "People working in this workspace." |
| "Referenced files — Managed files that are safe for this viewer." | **Linked files** — "Files you have access to." |
| "Referenced tasks — Project work items linked from the Doc." | **Linked tasks** |
| "Sprint story — Planning rhythm and sprint movement.", "Open sprint rhythm" | **Sprint summary** — "Current and upcoming sprints." |
| "Projects — Projects inside this organization, live." | "Workspaces in this organization" |
| "Unknown Doc block — This block is not recognized…", "Editor attention needed" | "Unsupported block", "Needs editing" |
| "Open the project surface for current items" | "Open the workspace to see current items" |
| "Circular reference detected: rendering of X was aborted to prevent infinite loops." | "This document includes itself, so part of it can't be shown." |
| "Document image could not be resolved." | "Image couldn't load." |
| "External image hidden for privacy. Click to load all external images." | "Images from other websites are hidden for privacy. Show images" |
| "Clipboard fallback failed" | "Couldn't copy" |

### 18.5 Sprints tab

| Today | Recommended |
|---|---|
| **"Close sprint"** (header) and **"Complete sprint"** (dialog) for the same action | **Complete sprint** only. **Decided** |
| "Close-out required" | **Ready to complete** |
| "Current" (sidebar) and "Active sprint" (form) | **Active** (matches the stored status) |
| "Keep in sprint history — Close the sprint while retaining unfinished tasks for reporting." | "Leave in this sprint — Unfinished tasks stay recorded here." |
| "Move to a Planning Sprint — Carry unfinished work into a sprint that has not started yet." | "Move to an upcoming sprint" |
| "Only an empty Planning sprint can be deleted. Sprints with work history are permanent." | "You can delete a sprint only before it has tasks. Otherwise, archive it." |
| "Create the first sprint and this space will turn into a clean execution timeline…" | "Create a sprint to plan a set of tasks over a fixed period." |
| "Assign tasks from the Task board to begin tracking this sprint." | "Add tasks from the Tasks tab to start this sprint." |
| "Define the sprint goal and schedule without extra noise.", "Adjust the sprint details and manage it from one place." | "Set the goal and dates.", "Edit sprint details." |
| "Quick set:" | "Quick dates:" |
| "Inside a {org} sprint" / "Not linked" | "Part of the {org} sprint" / "Not part of an organization sprint" |
| "Danger Zone" inside the sprint dialog | "Delete sprint" |
| Badge "Removed" | "Removed from sprint" |

### 18.6 Tasks tab

| Today | Recommended |
|---|---|
| "Task board" | **Board** |
| "A task board supports up to six sections", "Six sections (maximum)" | "A board can have up to six columns." |
| "Tasks moved into this section inherit this state." | "Tasks moved here get this status." |
| "Load all tasks before reordering so positions remain complete and deterministic." | "Load all tasks before reordering." |
| "No files or design assets attached yet." | "No files attached yet." |
| "Open source" (link to the chat message) | **Open original message** (W11) |
| "Waiting for a project lead's approval. Approving completes this task; file publication remains separate." | "Waiting for an owner or admin to approve. Final files are added to Files separately." |
| "Requirements, subtasks or linked files changed. Resubmit the current work before approval." | "This task changed after it was submitted. Submit it again for review." |
| "Approve & complete" | **Approve** |
| Subtasks: "Decompose this task into deliverable checkpoints.", "Break down this task into clear, verifiable sub-items…", "Add a new subtask checkpoint…", "Press Enter ↵ to add checkpoint" | "Break this task into smaller steps.", "Add a subtask…", "Press Enter to add" |
| Subtask filters "All / Open / Done", "Mark all done" | "All / Open / Completed", "Mark all completed" |
| The "Discussion" tab next to "Comments" | **Comments** |
| "No discussion yet — Start the conversation for this task." | "No comments yet." |
| "Live typing is reconnecting. Posting comments remains available." | "Reconnecting… You can still post comments." |
| File actions: "Move to Deliverables / Task References / Working Files", "Publish to Project Files", "Move in Project Files" | "Mark as final / reference / draft", "Add to Files", "Move in Files" |
| "How would you like to categorize these files?" | "What are these files for?" |
| "New Version of Existing File", "Keep folder structure and resolve placement", "Link an existing project file as task input" | "New version of a file", "Keeps your folders as they are", "Link a file from Files" |
| Version drawer: "No version history yet. The first upload seeded v1…", "…Historical blobs remain available for download.", "• active task version is v3" | "Only one version so far.", "Restoring saves it as the newest version. Older versions stay available.", "Current version: v3" |
| "Task scope" (filter) | "Show" |
| "Unnamed user", "Unit ·" (mention list) | "Unknown member", "Team ·" |

### 18.7 Files tab

| Today | Recommended |
|---|---|
| "Project files", "Project root", "Project Root" | **All files**; "Top level" when moving |
| "Upload revision…", "Upload a file revision", "Retry upload revision…" | **Upload new version…** |
| "Attach to task…", "Attach task…", "Link the task", "Link Task", "Attach files" (two verbs) | **Link to task** for files already in Files; "Add files" for new uploads |
| "Raw" | "View plain text" |
| "Locked by X" and "Being edited by X" | **Being edited by X** |
| "Task working files must be published before they can be relocated." | "Add draft files to Files before moving them." |
| "Choose where this task working file should become available in Project Files. Its task role is unchanged." | "Choose a folder in Files. The file stays a draft on the task." |
| "Upload allocation unavailable", "Failed to prepare upload URLs", "Upload allocation is incomplete" | "Upload couldn't start. Try again." |
| "Uploads safe.", "Completed files safe.", "Completed files kept." | "Finished files were saved." |
| "File exceeds maximum upload size limit" | "This file is too large." |
| "Rejected upload selections", "Place among existing files in… Click to browse project tree." | "Files that can't be uploaded", "Save in folder…" |
| "Secure folder export started" | "Preparing folder download…" |
| "Transfers", "No transfers in this session." | **Uploads and downloads** |
| Trash: "Deletion is pending storage cleanup…", "Shared storage objects used by other files are retained. GitHub is not modified." | "Still deleting. It stays in Trash until finished.", "Copies used by other files are kept. Your GitHub repository isn't changed." |
| "Batch restoration failed", "Could not review deletion", "Original Location", "Deleted At", "Deleted By" | "Couldn't restore some files", "Couldn't check what will be deleted", sentence case |
| Editor: "Cannot save: file has no storage key.", "Your unsaved buffer is preserved…", "Retry editing access", "Updated via Editor", "Uploaded via Files Tab" | "This file can't be saved. Reopen it.", "Your changes are kept…", "Try editing again", "Edited in NetworkBase", "Uploaded in Files" |
| Compare: "Split Slider", "Side-by-Side", "Difference Map: v… (identical pixels = black…)", "(Base) / (Target)", "Computing comparison changes..." | "Slider", "Side by side", "Changes highlighted", "(Older) / (Newer)", "Comparing…" |
| Versions: "Active", "Size difference from previous revision", "Its stored bytes will also be deleted" | "Current", "Size change", "This version's file will be deleted" |
| "Add annotation…", "Edit annotation" (linked tasks) | "Add note…" (W3) |
| "Quick open", "Search filenames across the project…" | **Go to file**, "Search file names…" |
| "Used as a Doc" | "Shown in Documents" |
| "Desktop IDE", "Your desktop IDEs", "Connect desktop IDE…" | "Code editor", "Your code editors", "Connect your code editor…" |
| **Repository sync:** "Synchronization" mixed with "Sync" | **Sync** everywhere ("Sync history") |
| "Operation", "Recorded operation", "Open operation", "Cancel queued operation", "Retry follow-up" | "Sync", "Sync details", "Cancel sync", "Try again" |
| "Publication method — Open pull request / Commit directly to branch" | "How to send — Pull request / Direct commit" |
| "Prepare a reviewed snapshot before confirmation." | "Review your selection before confirming." |
| "Cancellation is available until execution starts. An executing transfer cannot be rolled back from this page." | "You can cancel until the sync starts. A running sync can't be undone here." |
| "Combine text", "Combined text must be valid UTF-8 text of no more than 1 MB." | "Merge text", "Merged text must be plain text under 1 MB." |
| "Recorded operations and retained results for this project." | "Past syncs for this workspace." |
| "Inspect", "Close file inspector" | "Details" |
| "Push to GitHub" / "Pull into NetworkBase" | Keep: standard GitHub terms, seen only by GitHub users |

### 18.8 Settings tab

| Today | Recommended |
|---|---|
| "These public fields update project headers, cards, search, notifications, and project links that render project copy." | "Shown on the workspace page, cards, search and notifications." |
| "Project slug — …Editing is locked for now to avoid broken links and stale share previews." | **Workspace URL** — "Can't be changed yet, so existing links keep working." |
| "Animated GIF · 1:1 Direct Upload", "…without lossy compression or frame flattening", "The saved square avatar powers cards and link previews." | "Animated GIFs keep their animation.", "This image appears on cards and link previews." |
| "Others", "Custom category" | "Other" |
| Access: "Control whether this project is discoverable across the platform or restricted to workspace collaborators." | "Choose who can find and see this workspace." |
| "Org only" | **Organization only** |
| "Public surface visibility" | **What visitors can see** |
| Members: "Manage project leadership, team members, roles, and permissions in one place." | "Manage members and their access levels." |
| "Project Leadership", "Team Directory", "Sync directory", "Lead record is unavailable.", "No co-leaders assigned" | "Owner and admins", "Members", "Refresh", "Owner details unavailable.", "No admins yet" |
| Card counts: "{n} active assigned · {n} created active · {n} file review · {n} accepted role" | "{n} assigned tasks · {n} created tasks · {n} files to review · {n} roles" |
| "Change role to", "Not assignable" | **Change access level to** (W5), "Can't be assigned tasks" |
| Removing a member: "Access removal impact", "Removal mode", "Preserve history / Unassign active tasks / Reassign active tasks" | "What happens to their tasks": "Keep them assigned / Unassign them / Give them to someone else" |
| "Clear this member from active task assignee fields while preserving creator/comment/file history." | "Their tasks become unassigned. Their comments and files stay." |
| "Replacement assignee", "Exact affected records", "Affected counts", "Transition checklist" | "New assignee", "What this affects", "Before you continue" |
| Roles: "Project Roles & Team Assignments", "Role Specifications", "Open Role Configuration", "Vacancy", "Seat Allocation", "Total Seats", "Occupant Profile", "headcount", "skill stack" | "Roles", "Role details", "Open role", "Filled", "Number of people", "Filled by" (W6) |
| "Applicant View Preview — Preview how candidates see this vacancy on the public project page." | **Preview as applicant** |
| "These skills power role matching and application recommendations." | "Used to suggest this role to people with these skills." |
| Updates: "Configure member publishing permissions and broadcast settings for project progress updates." | "Choose who can post updates." |
| Files: "Files and workspace" (section name) | **Files** |
| "The starting upload permission for people who join." | "Default for new members" |
| Notifications: "Project notification policy", "Workflow event triggers", "Click any category trigger to expand and customize event delivery." | "Notification defaults", "Choose which events notify members." |
| Delivery levels: "Digest, Realtime, Important, Standard, Mandatory event · Always enabled" | **Summary, Instant, Important, Normal, Required · Always on**. **Decided** |
| "Member preferences can reduce optional project noise. Locked responsibility and security notifications stay enabled." | "Members can turn off optional notifications. Required ones stay on." |
| Management: "Running preflight safety checks...", "Preflight verified · Status:", "Run danger-zone preflight before archiving." | "Checking what this affects…", "Ready" |
| Archive dialog: "STATUS: ARCHIVED", "Archiving effects:", "intake", "open role matching", "discovery visibility in hub and portfolio feeds", "This operation is fully reversible…" | "Archived"; a plain list: "Members can still read everything. Tasks, applications and posting pause. You can unarchive any time." |
| Transfer: "OWNER ONLY", "STEP-UP PROTECTED", "primary administrative ownership", "Ownership consequence review", "You will be demoted to Administrator" | "You'll confirm with two-step verification", "What changes", "You'll become an admin" |
| Delete: "Warning: Irreversible destruction", "Data to be destroyed:", "ACTIVE TASKS", "OPEN ROLES", "All repository files, folders, and S3 file revisions", "…and all associated workspaces" | "This can't be undone. These will be deleted: tasks, open roles, files and all their versions, documents, updates and comments, and the workspace channel." |
| "Add at least one team member to this project before ownership can be transferred." | "Add a member before transferring ownership." |

### 18.9 Decisions: workspace tabs (accepted 2026-10-29)

| # | Question | Decision (accepted 2026-10-29) |
|---|---|---|
| 16 | "Publish" only for documents and contributions; updates are "Posted", task drafts "Added to Files", GitHub "Push"? | Yes |
| 17 | One task status list everywhere: To do · In progress · In review · Blocked · Completed? | Yes |
| 18 | Notes on files: "Label" and "Note" only, dropping "tag" and "annotation"? | Yes |
| 19 | File views called "Views": All files, Recent, Starred, Task files, Final files, Repository sync, Trash? | Yes |
| 20 | "Change access level" for Owner, Admin, Member and Viewer, keeping "role" for jobs? | Yes |
| 21 | Sprints: "Complete sprint" only, and "Active" instead of "Current"? | Yes |
| 22 | Notification levels: Required, Important, Normal, Summary, Instant? | Yes |
| 23–29 | Remaining areas | See §19.14 |

---

## 19. Remaining areas and corrections

A coverage check counted visible strings in every folder of `src/` and compared them with §1–18. These areas had not been audited closely and are covered here: the workspace Updates tab, My work, status and presence, the share dialog, notifications, emails, organizations in depth, moderation screens, the cookie banner, footer and legal names, form validation messages, and page descriptions. Items marked **Decided** were accepted on 2026-10-29 (see §19.14).

### 19.1 Corrections to earlier sections

- **"Fieldnotes" is not a product term.** It is a sample workspace name in the toast-copy catalog `lib/feedback/copy.ts` (for example "Following Fieldnotes"). Its row was removed from §16.10.
- **Spelling is US English, not "Licence".** The app is mostly US English: "organization" 233 times against "organisation" 10, and "color" 326 times against "colour" 1. The British leftovers are "licence" (26), "organisational" and "recognise". §16.12 now says **License**. **Decided** (23)

### 19.2 Workspace Updates tab

| Today | Recommended |
|---|---|
| "Project feed", "Organization feed", "Progress posts for followers…" next to the tab name "Updates" | **Updates** ("Updates from this workspace") |
| "Share a project update for {name}..." | "Share an update…" |
| "Add one supporting reference to this update.", "Connect this post to active project work." | "Link a task, sprint or file." |
| "No likes yet. Be the first to like!" | "No likes yet." |
| "Please log in to like updates", "Please log in to comment" | "Sign in to like", "Sign in to comment" |
| "Are you sure you want to delete this update? This action cannot be undone." | "Delete this update? This can't be undone." |
| "· Limited audience" | "· Members only" |
| "Project members will appear here after their first post." | "Members appear here after they post." |
| Post types "Announcement" and "Discussion" | Keep |
| "Recent Activity" | "Recent activity" |

### 19.3 My work

| Today | Recommended |
|---|---|
| "Close workspace" (the drawer's close button) | "Close My work" |
| **"Reject"** and "Invite rejected" next to "Decline" and "Declined" elsewhere | **Decline** everywhere. **Decided** (26) |
| "Applications to your projects", "Project invitations" | "Applications to your workspaces", "Workspace invitations" |
| "My tasks", "Team tasks", "All open work", "Personal" | "Assigned to me", "Team tasks", "All open tasks", "Personal workspaces" |
| "Density", "Card view", "Compact rows" | "View", "Cards", "List" |
| "To review", "Submissions to review" | Keep |
| "Connection and project decisions that need your attention, in one place." | "Requests and invitations waiting for you." |

### 19.4 Status and presence

| Today | Recommended |
|---|---|
| **"Project status"** (an emoji status such as "Sprinting" or "Hiring") collides with the workspace Status (Draft, Active…) in decision 11 | **Team status**. **Decided** (24) |
| "What's the team doing?" | Keep |
| "Vacationing", "Sprinting", "Launching", "Team on break" | "On vacation", "In a sprint", "Launching", "On a break" |
| "Mentions wait in Activity." (the screen is called "Inbox") | "Mentions wait in your Inbox." |
| "My connections and project teammates", "Only project teammates" | "Connections and workspace members", "Workspace members only" |
| "Only owners and admins can set the project status." | "…the team status." |

### 19.5 Share dialog

| Today | Recommended |
|---|---|
| "Send destination", "Checking destination…" | "Send to", "Checking…" |
| "Earlier send confirmed. No additional message was sent.", "The earlier receipt could not be checked. No new message was attempted." | "Already sent.", "Couldn't confirm it was sent. Nothing new was sent." |
| "Returned from device sharing.", "Device sharing canceled." | Remove the first; "Sharing canceled." |
| "My application conversations", "Candidate and role context" | "Application conversations", "Applicant and role" |
| "Get a readable profile link, then return to sharing." | "Set a username to get a short profile link." |

### 19.6 Notifications

| Today | Recommended |
|---|---|
| Category descriptions with jargon: "application intake, decisions, and review routing", "project momentum", "status attention, and workflow responsibility", "access-sensitive events", "follower digest triggers hidden until enforceable" | Plain one-liners: "New applications and decisions", "Sprint and stage changes", "Tasks assigned to you and mentions", "Security changes"; **remove "Future Surfaces"** |
| Rule text: "Notify project leaders…", "owners and co-leaders", "safe access-removal copy" | "Notify the owner and admins…", "Notify the removed member" |
| "Sprint steps for leads and admins" | "…for the owner and admins" |
| "Mark as new" | "Mark as unread" (§17.12) |
| "Snooze 1 hour / until tomorrow / until next week" | Keep |

### 19.7 Emails

| Today | Recommended |
|---|---|
| "Collaborator", "High Priority", "MEMBER PROFILE", "ASSIGNED TO" | "Member", "High priority", sentence-case labels |
| "Focus & Skills", "Referenced Files & Assets" | "Skills", "Files" |
| "Explore Projects", "View Task →", "View Profile" | "Explore workspaces", "View task", "View profile" |
| Organization emails: "Open the copy →", "Open my copy →" | "Open assignment" (decision 25) |
| "Needs you", "Behind", "Open dashboard" | "Needs your attention", "Needs attention", "Open overview" |
| "Add what you did here to your contribution story." | "Add this to your contributions." |
| Footer "© NetworkBase™ · All rights reserved" (emails) and "NetworkBase™. All rights reserved." (site) | One footer: "© 2026 NetworkBase. All rights reserved." |
| "A task has been assigned to you" | Keep |

Sign-in emails such as confirm signup and reset password may come from Supabase's own templates rather than this repo; check them in the Supabase dashboard.

### 19.8 Organizations in depth

| Today | Recommended |
|---|---|
| Assignments: **"copy"** for each person's piece of work ("Each person… gets their own copy to hand in", "Own copy", "group copy", "Open my copy") | **Assignment**: "Each person gets their own assignment". **Decided** (25) |
| "Hand in your work", "handed-in work" | **Submit** / "submitted work" |
| "Steps" (assignment checklist) next to Subtasks in tasks | Keep "Steps" for assignments; they are a different thing. **Decided** (29) |
| "Roster", "Review queue", "Required reading", "Re-read only", "Marked New for everyone" | "People", "To review", "Required reading" (keep), "Ask to re-read", "Marked as new" |
| "Nothing (mark done)" (submission type) | "No submission (mark as completed)" |
| "Always allowed (labelled Late)" | "Always allowed (marked late)" |
| "Visibility cap", "Public allowed", "Org only at most", "Private only" | "Highest allowed visibility": Public / Organization only / Private |
| "Detach", "Request detach", "Approve and detach", "Detach at once" | "Remove from organization" / "Request to leave" (§16.6) |
| "Inherited admins — …Only the lead deletes it or transfers it." | "Admins from the organization — Only the owner can delete or transfer it." |
| "Duplicate", "What to copy", "Sprint plan, with dates moved to the new term" | Keep "Duplicate"; "What to include" |
| "Handle", "Term start" | "Organization URL" (§16.6); keep "Term start" for education |
| Member filters "Guests", "Inactive 14 days", "Behind first" | "Viewers" (decision 3), "Inactive for 14 days", "Needs attention first" |
| "Verify contributions", "Revoke" (verification) | Keep "Verify"; "Remove verification" |
| "They leave every project here; handed-in work stays." | "They leave every workspace here. Their submitted work stays." |

### 19.9 Moderation and admin screens (NetworkBase staff)

| Today | Recommended |
|---|---|
| Staff screens use **"admin"**, which clashes with the workspace Admin | Staff are the "**NetworkBase team**"; the screens are "**Moderation**". **Decided** (27) |
| "Suspend org", "Lift suspension", "Hide from Discover", "Verification requests" | "Suspend organization", "Lift suspension", keep the others |
| "Reason the owner will see" | Keep |

### 19.10 Cookie banner, footer and legal names

| Today | Recommended |
|---|---|
| Legal names differ between the footer, Settings and the page titles: **"Terms and Conditions"** (footer heading) / "Terms of Service"; "Service Providers" / "Subprocessors"; "Copyright & IP Complaints" / "Copyright & Takedowns" / "Copyright and IP Complaints"; "Cookies & Storage" / "Cookies & Local Storage" / "Cookie and Storage Notice" | One list, the same everywhere: **Terms of Service, Privacy Policy, Cookie Notice, Acceptable Use Policy, EULA, Subprocessors, Data Processing Addendum, Copyright complaints, Security reporting, Grievance redressal**. **Decided** (28) |
| "Reject optional" / "Accept all" (cookie banner) | Keep: rejection is the clearer word for cookies |
| "Non-connections see a locked profile shell." | "People you're not connected to see a limited profile." |
| "Private creator", "Creator" | "Private profile", or the person's name |

### 19.11 Form validation messages

| Today | Recommended |
|---|---|
| Developer wording: "avatarUrl must be a safe http(s) URL", "bannerUrl must be a safe http(s) URL", "Open-to must have N items or fewer" | "Use a link starting with https://", "Choose up to N roles" |
| "Please add a short application message" | "Add a short message" (no "please") |
| "Add at least one position", "A role can have up to 10 positions" | "Add at least one role", "Up to 10 people per role" |
| "Title must be less than 100 characters" | "Use 100 characters or fewer" (one pattern for every length limit) |
| "Org only is for projects in…" | "Organization only…" |

### 19.12 Page descriptions (search results and link previews)

| Today | Recommended |
|---|---|
| Discover: "Discover and collaborate on the best side-projects and indie apps." | "Find workspaces and people to work with." |
| My work: "A stable workspace shell for tasks, notes, inbox, and activity." | "Your tasks, invitations and requests." |
| "Authorize your IDE extension to connect with your NetworkBase workspace." | "Connect your code editor to NetworkBase." |
| "Sign in to NetworkBase to reach your projects, people and messages." | "…your workspaces, people and messages." |
| "Your personal profile and presence on NetworkBase." | "Your profile on NetworkBase." |
| "NetworkBase data-processing terms for eligible organisational customers." | "…organizational customers." (US spelling) |

### 19.13 Still not covered

- **The VS Code extension itself**: its sidebar, commands and messages live in its own repository, so its "NetworkBase Workspace" wording was not audited.
- **Supabase sign-in emails**: confirmation and reset templates are set in the Supabase dashboard.
- **Browser push notification text**: titles are built at send time; check them after the wording changes.
- **The link-preview image** (`/api/og`) has almost no text; nothing to change.
- **The 2,000+ server and API error messages** follow the patterns in §16.1. They need the same mechanical clean-up, not new decisions.

### 19.14 Decisions: remaining areas (accepted 2026-10-29)

| # | Question | Decision (accepted 2026-10-29) |
|---|---|---|
| 23 | Spelling: US English everywhere (License, organization, color, canceled)? | Yes |
| 24 | "Project status" (emoji) becomes **Team status**? | Yes |
| 25 | Assignments: "assignment" instead of "copy", and "Submit" instead of "hand in"? | Yes |
| 26 | **Decline** everywhere, with no "Reject" (cookie banner excepted)? | Yes |
| 27 | Staff screens: "NetworkBase team" and "Moderation", so "admin" means only the workspace and organization role? | Yes |
| 28 | One canonical list of legal page names in the footer, Settings and page titles? | Yes |
| 29 | "Steps" stays for assignments, and "Subtasks" stays for tasks? | Yes |
| 30–34 | Last pass decisions | See §20.4 |

---

## 20. Last pass: remaining screens, punctuation and formatting

A file-by-file coverage check found screens that earlier passes had only sampled. They are covered here, along with a new category: the same thing written in different ways (punctuation, units, dates). Items marked **Decided** were accepted on 2026-10-29 (see §20.4).

### 20.1 Screens not read in full before

**Workspace setup steps (all five)**

| Today | Recommended |
|---|---|
| "**Phase** {n} of {n}" and "**Step** {n} of {n}" both appear in the same flow | "Step {n} of {n}" only |
| "Start from scratch", "Empty project", "Manual setup" (three names for one choice) | **Start empty** |
| "Choose a starting point", "Project source", "Phase 1 · start" | "How do you want to start?" |
| **"Launch"** used for creating the workspace ("Launch settings", "Set up how the project launches", "Visible at launch", "Publish the doc at launch"), while "Launch" is also a stage name | "Starting settings", "When the workspace is created"; "Launch" only as a stage. **Decided** (33) |
| "…review it before publishing" (creating a workspace isn't publishing) | "…review it before you create it" |
| "Project story — Explain the work" | "Description" (decision 15) |
| "Discovery — Make the project easier to find" | "Help people find it" |
| "Which tabs outsiders see", "Private · collaborators only" | "…visitors see", "Private · members only" |
| "Compensation: Unpaid / volunteer, Equity, Paid, Revenue share", while profile role types say "Volunteer / Pro bono" | One list: **Unpaid (volunteer), Paid, Equity, Revenue share**. **Decided** (32) |
| "Positions — One to ten openings." | "Number of people (1–10)" |
| Role suggestions in Title Case: "Frontend Developer", "UI/UX Designer", "QA Engineer" | Sentence case ("Frontend developer"), as on the marketing page |
| "Operating-system metadata", "Preflight failed.", "Run GitHub import checks before continuing." | "System file (skipped)", "Couldn't check the repository.", "Check the repository before continuing." |
| "Off keeps it as a draft only leaders can see.", "Leaders can always do both." | "…only the owner and admins can see." |
| "After creation, in Project settings: …privacy policies, and the danger zone." | "…and workspace management." |
| "Draft erased completely" | "Draft deleted" |
| "Nothing has been created yet. Create the project only when you select Create project in the footer." | "Nothing is created until you select Create workspace." |

**Search and command palette**

| Today | Recommended |
|---|---|
| "**Workspace / Settings**" (a search group that uses the old meaning of "workspace") | "Settings" |
| "Project / Work & Links", "Project Links · {n}" | "Workspace links" |
| "Builders · {n}", "Open builder profile" | "People · {n}", "Open profile" (decision 10) |
| "Manage your fallback password and password credential.", "Review signed-in identity and local application data." | "Change your password.", "Your account details and data on this device." |
| "Waiting for search input" | Remove; it is only read aloud by screen readers |

**Messages (the rest)**

| Today | Recommended |
|---|---|
| "Projects in common" | "Workspaces in common" |
| "Everyone in the project is a member.", "Start one for a topic your project talks about." | "…in the workspace…" |
| "Done with {name}'s message (remove from Saved)" | "Remove from Saved" |
| "Wave to {name}", "Say hello to {name}" | Keep; friendly openers are fine in chat |

**Network invitations and applications**

| Today | Recommended |
|---|---|
| "Sent project invitations", "Connection and project invitations will appear here." | "Sent workspace invitations", "Invitations appear here." |
| Decline reasons "Skills don't match this role", "Needs more experience", "Availability doesn't line up", "Another direction" | Keep the first three; "Another direction" → "We went another way" |
| "You were on this project", "Project closed" | "You were a member", "Workspace closed" |
| "Cancelling…" with "..." | "Canceling…" (US spelling, decision 23) |

**Profile role preference lists**

| Today | Recommended |
|---|---|
| Hours written two ways in the same file: "5–10 hours per week" and "5–10 hrs/week" | One format (decision 31) |
| Experience levels "Student, Junior, Mid-level, Senior, Lead, **Founder**" | "Founder" isn't a level, and "Co-founder" is already a role type: remove it from levels. **Decided** (34) |
| Role categories with "&" ("Sales & Business Dev", "People & HR") | Follows decision 9 |

**Skill picker and document quality hints**

| Today | Recommended |
|---|---|
| "Search the market catalog or add a custom skill." | "Search skills or add your own." |
| "Custom skill · submitted for catalog review" | "Custom skill · we'll review it" |
| "Keep Doc content under 500 KiB", "stay near GitHub Doc width", "use managed Doc media" | "Keep documents under 500 KB", "keep images narrow", "upload the image instead" |
| "Missing getting started", "Missing usage", "Missing contribution guide" | "Add a 'Getting started' section", "Add usage instructions", "Add a 'How to contribute' section" |

### 20.2 Punctuation and formatting

| Pattern | Today | Recommended |
|---|---|---|
| Ellipsis | "…" 216 times, "..." 73 times | Always "…". **Decided** (30) |
| Apostrophes | Straight `'` 226 times, curly `’` 239 times ("Couldn't" and "Couldn’t" side by side) | Always curly `’` |
| Examples | "e.g." 24, "e.g.," 5, "E.g." 1, "For example" 5 | "For example," in sentences; "e.g." only in short placeholders |
| Arrows in buttons | "→" 24, "&rarr;" 4, "›" 1 ("Review ›", "View Task →") | No arrows in app buttons; "→" only on email buttons |
| Exclamation marks | About 10 ("Username is available!", "Looks good!", "Link copied!") | None |
| "Please" | 175 messages | Drop it from instructions and errors ("Try again"); keep it only when asking a favor |
| "successfully" | 22 messages ("Invitation accepted successfully!") | Drop it ("Invitation accepted") |
| Hours per week | "10–20 hours per week", "10–20 hrs/week", "10–20 h / week", "15 hrs/week" | "10–20 hours a week"; "10–20 h/week" on small cards. **Decided** (31) |
| File sizes | "2 MB" 21 times, "2MB" 5 times | Always "2 MB" with a space |
| Date locale | Hard-coded `en-US` in 33 places, `en-GB` in 2 | The viewer's own locale |
| Date formats | "MMM d", "MMM d, yyyy", "MMM d, yyyy h:mm a", "yyyy-MM-dd" (shown to users), plus "(organization time)" and "UTC" | One short format ("Oct 29") and one long ("Oct 29, 2026, 3:40 PM"), in the viewer's time zone, naming the zone only when it differs |
| All caps | "STATUS: ARCHIVED", "SPOTS LEFT", "OWNER ONLY", "MEMBER PROFILE", "DAILY SUMMARY" | Sentence case; use styling instead of capitals |

### 20.3 What is left after this pass

Every folder in `src/` with visible text has now been read. What remains is outside wording decisions:

- **Legal page text.** The legal pages were checked only for "project" and their page names; rewording the body text needs legal review.
- **Server and API error messages (2,000+).** They follow the patterns in §16.1 and need a mechanical clean-up, not new decisions.
- **Skill names in the catalog** (React, Figma…): proper names, unchanged.
- **Outside this repo:** the VS Code extension's own wording and the Supabase email templates (§19.13).
- **Not wording, never in scope:** icons (one per concept), button order and styles in dialogs. Screen-reader labels that still say "project" change with the copy.

### 20.4 Decisions: last pass (accepted 2026-10-29)

| # | Question | Decision (accepted 2026-10-29) |
|---|---|---|
| 30 | Punctuation: "…" and curly apostrophes everywhere, no exclamation marks, no "successfully", no arrows in app buttons? | Yes |
| 31 | Formats: "hours a week"; "2 MB" with a space; dates in the viewer's locale and time zone, with one short and one long format? | Yes |
| 32 | Compensation: one list, Unpaid (volunteer), Paid, Equity, Revenue share? | Yes |
| 33 | "Launch" only as a stage name, never for creating a workspace? | Yes |
| 34 | Experience levels: remove "Founder"? | Yes |
| 35–42 | Messages and notifications decisions | See §21.4 |

---

## 21. Messages and notifications, end to end

Every string in Messages (about 1,200: `components/messages`, `lib/messaging`, the message routes and actions) and in the notification system (about 500: `lib/notifications`, `components/notifications`, notification settings, organization notify rules, background jobs) was read. Earlier sections covered these at label level only. Items marked **Decided** were accepted on 2026-10-29 (see §21.4).

### 21.1 A defect found during the audit

**Organization invite notifications show the raw stored role value.** The title is built as `${inviter} invited you to ${org.title} as ${data.role}` (`src/app/actions/org-members.ts:261`). People see "Ana invited you to CSE-3A as **viewer**" or "as **admin**": lower case, and ignoring the organization's own role names (Teacher, TA, Student). It should use the same display name as the members list. This is a small code fix, not only wording (also listed in §15).

### 21.2 Messages

**Problems that run across Messages**

| # | Problem | What exists today | Recommended |
|---|---|---|---|
| M1 | **The workspace's main channel has five names** | "{name}'s **home channel**", "**Default channel**", "#general", "**Project chat**" (application cards, open roles), "**Project group**" (workspace settings) | **General channel**, shown as #general. **Decided** (35) |
| M2 | **Conversation types have no fixed names** | "Direct messages", "group chat", "Group conversation", "Group", "Personal conversation", "application conversation", "Notes to self" | **Channel · Direct message · Group message · Notes to self · Application conversation**. **Decided** (36) |
| M3 | **"Chat" and "message" mixed** | "Chat messages use push notifications", "Task from chat", "Messages window", "Project chat" | **Message(s)** in everything people see. **Decided** (37) |
| M4 | **Four ways to keep things** | Saved, Starred, Pins, Bookmarks | Decision 12 |
| M5 | **Two lists of report reasons** | Messages: "Spam, Harassment, Hate speech, Inappropriate content, Other". Organizations: "Harassment, Impersonation, Inappropriate content…" | One list: **Spam · Harassment · Hate speech · Impersonation · Inappropriate content · Other**. **Decided** (41) |
| M6 | **A technical error people can see** | "Canvases aren't set up on this server yet (database migration 0182 is pending)." | "Notes aren't available yet. Try again later." |
| M7 | **Leftover workspace wording** | "Channels are where your project talks about a topic.", "Everyone in the project can find and join it.", "This project has reached 200 channels.", "Only project members can do that.", "Message a teammate directly, or join a channel in one of your projects." | "…your workspace…", "Message a member…" |

**Sidebar, home and switching**

| Today | Recommended |
|---|---|
| "Switch project", "All projects", "Create new project", "Project channels show up here.", "{name} · Guest" | "Switch workspace", "All workspaces", "Create workspace", "…Viewer" |
| "Decided (n)" (applications section) | "Reviewed (n)" |
| "unread in your Inbox: mentions and thread replies" | Keep |
| "Message a teammate", "Find a project" | "Message someone", "Find a workspace" |
| Quick switcher: "Jump to a conversation, or search messages", "Channels you can join" | Keep |

**Conversation header and details**

| Today | Recommended |
|---|---|
| "With {name} · Lead of {project}" | "With {name} · Owner of {workspace}" |
| "Conversation views" (tabs) | "Tabs" |
| "Default channel — Everyone in the project is a member." | "General channel — Every workspace member is here." |
| "Make admin", "Remove as admin" (channel admins) | Keep: channel admins are a separate scope (§8.5) |
| "Copy ID" | Remove from the menu (§16.7) |
| "Find among the first 500 members" | "Search the first 500 members" |
| "Projects in common" | "Workspaces in common" |
| "You're previewing" | "You're previewing this channel. Join to post." |

**Composer and commands**

| Today | Recommended |
|---|---|
| "Create a project task", "/task Finish API documentation" | "Create a task" |
| "Notify everyone online" / "Notify everyone in this conversation" | "@here: notify active members", "@channel: notify everyone" |
| "Untick 'Also send' to schedule a reply" | "Clear 'Also send' to schedule a reply" (US English) |
| "Away (they'll see this when they're back):" | Keep |
| "Scheduled messages can't carry files yet", "Commands can't be scheduled" | Keep |
| "{n} Your message is back in the box." | "Your message wasn't sent. It's back in the box." |
| "Usage: /poll Question \| Option 1 \| Option 2" | Keep |

**Message actions, threads, Inbox, Saved, Drafts and Search**

| Today | Recommended |
|---|---|
| "Done with {name}'s message (remove from Saved)" | "Remove from Saved" |
| "Reminded", "Due now" (Saved) | "Reminder sent", "Reminder due" |
| Thread "Follow" / "Following" | Keep: following a thread matches the one-way meaning of Follow (§2) |
| "Following. This conversation is muted, so new replies won't notify you…" | Keep |
| "Mark threads read", "Mark mentions read", "Mark Inbox read" | "Mark all as read" in each tab |
| "Drafts on this device" | Keep |
| Search: "That search is too broad. Narrow it with In, From or dates." | Keep |

**Canvas, tabs and templates**

| Today | Recommended |
|---|---|
| "Canvas", "Canvases", "New canvas", "Canvas templates" | Follows decision 6 ("Channel notes") |
| "Add a bookmark — Keep a doc, dashboard, design or repo one click away." | "Add a link" (decision 12) |
| "Words go here" | "Start writing…" |
| "Someone else saved this canvas first. You're seeing their version; copy yours to paste back what you need." | "Someone else saved first. Copy your version to add it back." |
| Template "Onboarding checklist — A first-week plan for someone joining the project." | "New member checklist — A first-week plan for someone joining the workspace." |
| Template group "Projects", template "Project brief" | "Planning", "Workspace brief" |
| "Decision record" | "Decision" (§16.7) |

**Application conversations and message cards**

| Today | Recommended |
|---|---|
| "Message the reviewers" | Keep |
| "People in an application conversation are fixed: the applicant and the project's reviewers." | "…the applicant and the workspace's reviewers." |
| Card "Open project chat", "Project chat" | "Open general channel" (M1) |
| Assignment card "Open my copy", "Open assignments" | "Open assignment" (decision 25) |
| "Status: {status}. Click to change." | "Status: {status}. Select to change." |
| "Invitation cancelled" | "Invitation canceled" (decision 23) |

### 21.3 Notifications

**Problems that run across the system**

| # | Problem | What exists today | Recommended |
|---|---|---|---|
| N1 | **Seven different category lists** | (1) Personal preferences: Mentions, Invitations, Project activity, Task updates, Applications, Connections. (2) Settings filter: Project, Task, Person, Organization. (3) Workspace rules: Membership & Access, Roles & Applications, Project Lifecycle, Tasks & Workflow, Files & Workspace, Doc, Updates, Security & Audit, Future Surfaces. (4) Organization rules: Organization, Assignments, Announcements, Profile credit, Sprints. (5) Short groups: "Roles and applications", "Tasks and workflow", "Updates and doc changes". (6) Row chips: Mention, Assigned, Message, Application, Connection, Blocked, Done, Workflow, File, Update. (7) Organization reach: All, Important only, Off | **One list everywhere**: **Mentions and replies · Invitations and requests · Applications and roles · Members and access · Tasks · Sprints and stages · Files and documents · Updates and announcements · Assignments · Security**. **Decided** (38) |
| N2 | **Four level scales** | Channels: "All messages / Mentions & threads / Mentions only / Mute". Organizations: "All / Important only / Off". Workspace delivery: "Digest / Realtime / Important / Standard / Mandatory" (decision 22). Personal settings: per-type on and off | Two scales. **Messages:** All · Mentions and threads · Mentions · Off. **Everything else:** All · Important only · Off, with "Required" as a locked label |
| N3 | **Two words for one menu action** | Each row's menu has both "**Turn off {type}**" and "**Mute {type}**" | **Mute** only. **Decided** (39) |
| N4 | **"Seen" against "Read"** | Notifications say "Seen" and "mark a seen notification as new"; Messages says "Read" | **Read / Unread** everywhere. **Decided** (39) |
| N5 | **"Tray", an internal word, shown to people** | "Show a system notification for tray updates…", "updates wait in the tray", "a notification in the tray" | "**Notifications**" ("updates wait in Notifications") |
| N6 | **Confusing delivery options** | "Desktop notifications on this device" and "Push notifications on this device" | "**Browser notifications** — while NetworkBase is open" and "**Push notifications** — even when it's closed". **Decided** (40) |
| N7 | **Two time formats** | "at 9:00 their time" and "Until tomorrow 9 AM" | One format (decision 31) |

**Notification titles (what people receive)**

| Today | Recommended |
|---|---|
| "{inviter} invited you to {org} as **viewer**" (§21.1) | "…as Viewer", or the organization's own role name |
| "**A project Lead** invited you to {workspace}" (fallback name, capital "Lead") | "The owner of {workspace} invited you" |
| "Someone commented on your project update" | "{name} commented on your update" |
| "Someone posted an update in Project" (fallback workspace name "Project") | "{name} posted an update in {workspace}" (never fall back to a generic word) |
| "Someone removed you from a project" | "You were removed from {workspace}" |
| "{name} joined the project" | "{name} joined {workspace}" |
| "Protected project action needs attention", "Protected action failed" | "An action in {workspace} needs your review" |
| "Project data export is ready" | "Your export of {workspace} is ready" |
| "{n} new updates in {workspace}", "Review updates" | Keep |
| "Snoozed — we'll bring it back" | "Snoozed until {time}" |
| "This update no longer has an available destination." | "This item is no longer available." |

The "Someone" fallback appears in many titles; it should show only when the person truly cannot be named, such as a deleted account.

**Notification panel and keyboard help**

| Today | Recommended |
|---|---|
| "Nothing new needs you right now." | "You're all caught up." (already used in the list) |
| "Open notifications, {n} need attention, {n} new total" | Keep |
| "Notifications list. Press J or down arrow to move down… E to dismiss, R to mark a seen notification as new." | "…R to mark as unread." |
| States "Needs attention", "New", "Seen" | "Needs attention", "Unread", "Read" |
| "Clear all", "Dismiss" | Keep both: "Dismiss" removes one, "Clear all" removes everything |

**Notification settings page**

| Today | Recommended |
|---|---|
| "Quiet controls" | "**Pause and quiet hours**" |
| "Choose what appears in the notification tray and when delivery pauses." | "Choose what you're notified about and when." |
| "Paused by your status" | Keep |
| "From {time} to {time} each day, updates wait in the tray until it ends and chat messages don't push (they stay unread in Messages)." | "Each day from {time} to {time}, notifications wait and messages don't send push alerts." |
| "Set a recurring daily period without delivery interruptions." | "Set a daily time when you won't be interrupted." |
| "Nothing muted. Mute a project, task or person from the ⋯ menu on a notification in the tray, or a conversation from its bell menu in Messages" | "Nothing muted. Mute a workspace, task or person from a notification's ⋯ menu, or a conversation from its bell menu." |
| "Replies in threads you follow — …Off: replies still show in your Inbox; @mentions always notify." and "Show message text in notifications — Off: notifications say who and where…" | Keep the meaning; "When off, replies still show in your Inbox." |
| "Push is not configured yet. Contact support.", "Push was disabled here, but server cleanup did not finish." | "Push notifications aren't available right now."; remove the second |
| Organizations: "How much each organization reaches you. Off still sends emails about your access, like removal or ownership.", "Include child projects" | Keep the first; "Include its workspaces" |

**Workspace and organization notification rules** (beyond §18.8 and §19.6)

| Today | Recommended |
|---|---|
| "Invitations — Project invitations and leadership appointments." | "Workspace and mentor invitations." |
| "Project activity — Project-level updates that are important but not noisy." | Absorbed into the single list (N1) |
| "Leaders can review this member's effective policy summary, but only the member can change personal notification overrides." | "The owner and admins can see this member's settings. Only the member can change them." |
| "This member inherits the project-level policy. Changes to project defaults will automatically apply to optional triggers." | "This member uses the workspace defaults." |
| Organization rules: "The project's lead hears the answer.", "Your child project — Leads hear when a seat opens…", "Sprint steps — Leads hear to plan or close their linked sprint" | "The workspace owner hears…", "Your workspace — Owners hear when a role opens…" |
| "Doc published — Notify members when an admin publishes a Doc with Publish & notify." | "Document published — …with Publish and notify." |
| "Follower digest — Digest-ready trigger for grouped follower-facing project updates." | Remove until built, along with "Future Surfaces" |
| "Git sync completed or failed" | "Repository sync finished or failed" |

**Staff-only pages.** The "Notifications ops" page ("Throughput & success rate", "Retention backlog", "Stale subs (pending prune)", "…check Inngest") is only for the NetworkBase team and can keep technical wording. It still follows decision 27 ("Moderation" and "NetworkBase team", not "admin").

**Rest of the app: final check.** All 44 page routes have been covered. One new item: page addresses mix singular and plural (`/projects/…` next to `/org/…`, `/u/…` and `/my-profile` for profiles, `/messages/p/…` for workspace channels). §12.2 already moves `/projects` to `/workspaces` with redirects; optionally the rest could follow one pattern (`/workspaces/…`, `/organizations/…`, `/people/…`) with redirects (decision 42). What remains is unchanged from §20.3.

### 21.4 Decisions: Messages and notifications (accepted 2026-10-29)

| # | Question | Decision (accepted 2026-10-29) |
|---|---|---|
| 35 | Main channel: one name, the **General channel** (#general), replacing "home channel", "Default channel", "Project chat" and "Project group"? | Yes |
| 36 | Conversation types: Channel · Direct message · Group message · Notes to self · Application conversation? | Yes |
| 37 | "Message" instead of "chat" in everything people see? | Yes |
| 38 | One notification category list, used in personal settings, workspace rules, organization rules and notification filters? | Yes |
| 39 | Notification states and actions: Unread and Read (no "Seen"), and Mute (no "Turn off")? | Yes |
| 40 | Delivery names: Email · Browser notifications (while open) · Push notifications (when closed)? | Yes |
| 41 | One list of report reasons for messages, content and organizations? | Yes |
| 42 | Page addresses (optional): plural nouns (`/workspaces`, `/organizations`, `/people`) with redirects? | `/workspaces` only; `/org`, `/u` and `/my-profile` stay as they are |
| 43–47 | Toast decisions | See §22.5 |

---

## 22. Toast messages

Every toast call was read: 670 calls in 116 files, plus the toast copy catalog that decides what people actually see. Items marked **Decided** were accepted on 2026-10-29 (see §22.5).

### 22.1 How toasts work today

- Every toast goes through one API, `@/lib/feedback`; nothing bypasses it.
- A catalog, `src/lib/feedback/copy.ts`, has **584 entries**. When code shows a toast, the system looks up that exact text; if found, it shows the catalog's reviewed wording instead. **210 entries show different text than the code says.**
- **Error toasts whose text is not in the catalog are replaced** with the generic "Action couldn’t finish" (`feedbackError` in `src/lib/feedback/index.ts`).
- For every toast, the system strips "successfully" and "!" and turns "..." into "…" at run time; the source text stays inconsistent.
- Toast types in use: error 390, success 192, warning 28, info 21, loading 10, neutral and "message" (the same thing) 18, promise 10, activity 1.

### 22.2 Defects

| # | Defect | Example | Fix |
|---|---|---|---|
| T1 | **33 specific error toasts are replaced by "Action couldn’t finish"** because their text is not in the catalog; people lose the one detail that tells them what to do | "Add a password or authenticator in Security before creating a token" (`IntegrationsSettings.tsx:340`), "You can apply again in {time}" (`ProjectDashboardClient.tsx:949`), "Up to {n} files per message; {n} skipped" (`Composer.tsx:521`), "You can attach up to {n} items" (`ProjectUpdateComposer.tsx:573`), "You can add up to {n} interests / roles / categories" (`EditProfileTabs.tsx`), "Image must be under 2MB…" (`GeneralSettingsSection.tsx:377`), "Extension mismatch…" (4 places), "{n} of {n} subtasks could not be updated" | Put specific messages in the catalog, or send limit and validation problems as warnings; keep the generic text only for unknown server errors. Server messages passed from `err.message` in the connection actions are lost the same way. **Decided** (43) |
| T2 | **Straight versus curly apostrophes break catalog matches** | `DiscoverUpdateCard.tsx:138` sends "Couldn't copy the link" (straight `'`); the catalog has "Couldn’t copy the link" (curly `’`). They don't match, so people see "Action couldn’t finish" | Normalize apostrophes before the lookup, and adopt decision 30 (curly everywhere) |

Both are also listed in §15.

### 22.3 Catalog problems

| # | Problem | What exists today | Recommended |
|---|---|---|---|
| T3 | **Sample values used as keys** | 31 keys contain example numbers or names ("6 uploaded · 2 need attention", "Kavya mentioned you", "4 new updates in Fieldnotes") that can never match real text; 364 of the 584 keys are never sent as fixed text by any toast | Turn the catalog into **templates with placeholders** ("{uploaded} uploaded · {failed} failed"). **Decided** (44) |
| T4 | **Hidden rewrites, some against the decisions** | Code says "Connection request sent", people see "Request sent"; "Document permissions updated" becomes "Doc permissions updated"; "Project created · folder imported" becomes "Project & files ready". Catalog titles also contain "project" 69 times, "Doc/Docs" 6, "leaders-only" 2, "revision" 6, "Guide capacity", "collaborators" and "cancelled" 5 | Make the catalog the **one home for toast wording** and apply the decisions there; code text should match what people see, so reviews show the real wording. **Decided** (44) |
| T5 | **Automatic clean-up hides inconsistent source text** | "successfully", "!" and "..." are fixed only at run time | Fix the source text; keep the clean-up as a safety net |
| T6 | **An unused button-label rewrite with a risky mapping** | `compactFeedback` renames toast buttons: "Open details" → "Rename group", "Review canvas" → "Review", "Generate codes" → "Get codes". No toast uses these labels today, but a future "Open details" toast button would read "Rename group" | Remove the mapping |

### 22.4 Wording patterns in toasts

| Pattern | Today | Recommended |
|---|---|---|
| Failure openings | "Failed to…" 43, "Could not…" 11, "Couldn't…" (straight) 8 and "Couldn’t…" 3 in code; the catalog uses "Couldn’t" 91 times | **"Couldn’t {action}. Try again."** **Decided** (45) |
| Copy confirmations (15 forms) | "Link copied", "Link copied!", "Task link copied to clipboard", "Copied to clipboard", "SVG code copied to clipboard", "Copied image to clipboard", "Copied {n} rows to clipboard (TSV format)", "Cell value copied", "Hex dump copied"… | **"{Thing} copied"**: "Link copied", "Code copied", "Image copied", "Table copied" |
| Save confirmations | "Saved", "Changes saved", "General settings updated.", "Project links saved", "Profile updated successfully", "Project avatar optimized and updated." | **"Changes saved"** for forms; **"{Thing} updated"** for one item; no period, no "successfully" |
| Periods | 130 of 386 fixed-text toasts end with a period | No period in the title; full sentences with periods in the description |
| One event, three successes | Accepting a connection says "Connection accepted", "You’re connected" (catalog) or "You’re now connected with {name}" (Network) | One message: "You’re now connected with {name}" |
| Loading text | "Sending request...", "Cancelling request...", "Disconnecting...", "Accepting request..." next to "Sending…" | "…" and US spelling: "Canceling request…" |
| "Please" | 12 catalog entries ("Please wait to try again", "Please log in to connect", "Please select a folder first.") | Drop it: "Wait a moment and try again", "Sign in to connect", "Select a folder first" |
| "Already" states typed differently | "is already in your categories" and "already linked" are info; "Application already pending" is a warning | **Info** for "already done", **warning** for "can't do that yet", **error** for real failures |
| Toast types | Eight: neutral, message (same as neutral), info, activity, success, warning, error, loading | **Five:** success, info, warning, error, loading. **Decided** (46) |
| How long toasts stay | Errors and warnings never close on their own, including soft notes such as "Uploads safe." and "Check required fields" | Errors stay until closed; warnings close on their own unless they have an action button. **Decided** (47) |

With toasts done, every way the app shows text has been audited. What remains is unchanged from §20.3; T1 shows that many server error messages never reach people anyway.

### 22.5 Decisions: toasts (accepted 2026-10-29)

| # | Question | Decision (accepted 2026-10-29) |
|---|---|---|
| 43 | Specific error text survives: every specific error is added to the catalog or sent as a warning, and "Action couldn’t finish" is used only for unknown server errors? | Yes |
| 44 | The catalog becomes the single home for toast wording: templates with placeholders, no sample values, and code text that matches what people see? | Yes |
| 45 | Toast patterns: "{Thing} copied", "Changes saved" / "{Thing} updated", "Couldn’t {action}. Try again.", no period in titles? | Yes |
| 46 | Five toast types: success, info, warning, error, loading? | Yes |
| 47 | Closing: errors stay until closed; warnings close on their own unless they have an action button? | Yes |

---

# Appendices

Generated from a read-only scan of `src/` using the TypeScript parser: string literals, template literals and JSX text, skipping imports, class names, ids, hrefs, query keys and log calls. The *Suggested* column is the mechanical replacement; **rows with a note need a person to read them.**

| Appendix | Contents |
|---|---|
| A | Every user-facing string containing "project" (1,543 rows, grouped by file) |
| B | Every location of the other terms from the list |
| C | Every role and people string (lead, co-lead, collaborator, assignee, guide, onboarding) |
| D | Folders and files to rename |
| E | Raw SQL inside TypeScript |

## Appendix A. Every user-facing string containing “project”

### `src/app/(legal)/acceptable-use/page.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 10 | These rules protect collaborators, projects, repositories, and NetworkBase infrastructure. | These rules protect members, workspaces, repositories, and NetworkBase infrastructure. | Legal text: version bump and re-acceptance |
| 13 | Do not access projects, messages, accounts, repositories, APIs, or infrastructure without permission. | Do not access workspaces, messages, accounts, repositories, APIs, or infrastructure without permission. | Legal text: version bump and re-acceptance |

### `src/app/(legal)/copyright/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 12 | The exact NetworkBase URL, project, file, message, profile, or identifier. | The exact NetworkBase URL, workspace, file, message, profile, or identifier. | Legal text: version bump and re-acceptance |

### `src/app/(legal)/dpa/page.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | Subject: collaborative project, profile, file, task, message, integration, support, and security processing. | Subject: collaborative workspace, profile, file, task, message, integration, support, and security processing. | Legal text: version bump and re-acceptance |
| 13 | Data types: identity, contact, professional profile, project content, communications, device, audit, and integration data; regulated or sensitive data is not intended unless expressly agreed. | Data types: identity, contact, professional profile, workspace content, communications, device, audit, and integration data; regulated or sensitive data is not intended unless expressly agreed. | Legal text: version bump and re-acceptance |

### `src/app/(legal)/eula/page.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | NetworkBase and its licensors own the software, interface, service marks, and platform materials. This EULA grants a licence, not a sale. You retain rights in your original project content. No provision transfers your co… | NetworkBase and its licensors own the software, interface, service marks, and platform materials. This EULA grants a licence, not a sale. You retain rights in your original workspace content. No provision transfers your … | Legal text: version bump and re-acceptance |
| 18 | The software processes content only to provide features you invoke and according to the Privacy Policy. A licence to the client does not grant you rights to other users’ content, private projects, repository credentials,… | The software processes content only to provide features you invoke and according to the Privacy Policy. A licence to the client does not grant you rights to other users’ content, private workspaces, repository credential… | Legal text: version bump and re-acceptance |
| 20 | The licence begins when you accept this EULA and ends when your account or authorised access ends. On termination, stop using and remove installed clients. We may remotely invalidate sessions and service access. Local pr… | The licence begins when you accept this EULA and ends when your account or authorised access ends. On termination, stop using and remove installed clients. We may remotely invalidate sessions and service access. Local wo… | Legal text: version bump and re-acceptance |

### `src/app/(legal)/grievances/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | The relevant profile, project, message, file, or URL and enough detail to locate it. | The relevant profile, workspace, message, file, or URL and enough detail to locate it. | Legal text: version bump and re-acceptance |

### `src/app/(legal)/privacy/page.tsx` (11)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 20 | This policy explains how NetworkBase handles information across profiles, collaborative projects, files, messages, integrations, AI assistance, notifications, and recovery features. | This policy explains how NetworkBase handles information across profiles, collaborative workspaces, files, messages, integrations, AI assistance, notifications, and recovery features. | Legal text: version bump and re-acceptance |
| 23 | . The operator determines how personal data is used for the NetworkBase service, except where it processes project data solely on behalf of an organisational customer. | . The operator determines how personal data is used for the NetworkBase service, except where it processes workspace data solely on behalf of an organisational customer. | Legal text: version bump and re-acceptance |
| 24 | This policy applies to networkbase.in, NetworkBase web applications, APIs, browser or editor extensions, project workspaces, messages, and related support. It does not replace the privacy terms of Google, GitHub, or anot… | This policy applies to networkbase.in, NetworkBase web applications, APIs, browser or editor extensions, workspaces, messages, and related support. It does not replace the privacy terms of Google, GitHub, or another serv… | Legal text: version bump and re-acceptance |
| 25 | Projects and work: | Workspaces and work: | Legal text: version bump and re-acceptance |
| 25 | projects, files, code, documentation, tasks, sprints, comments, updates, roles, applications, contributions, version history, deletion states, and recovery drafts. | workspaces, files, code, documentation, tasks, sprints, comments, updates, roles, applications, contributions, version history, deletion states, and recovery drafts. | Legal text: version bump and re-acceptance |
| 26 | We receive information from you, other project participants, your device, connected services such as Google and GitHub, and activity generated while providing and securing the service. Contributor information may come fr… | We receive information from you, other workspace participants, your device, connected services such as Google and GitHub, and activity generated while providing and securing the service. Contributor information may come … | Legal text: version bump and re-acceptance |
| 27 | Provide accounts, profiles, projects, collaboration, messaging, search, notifications, recovery, export, and support. | Provide accounts, profiles, workspaces, collaboration, messaging, search, notifications, recovery, export, and support. | Legal text: version bump and re-acceptance |
| 29 | Public profiles and public project tabs can be viewed without an account and may be copied, indexed, linked, or temporarily cached. Connection-only and private profile settings restrict the application view but do not re… | Public profiles and public workspace tabs can be viewed without an account and may be copied, indexed, linked, or temporarily cached. Connection-only and private profile settings restrict the application view but do not … | Legal text: version bump and re-acceptance |
| 29 | Project owners and authorised members can access shared workspace content according to their roles. Messages are visible to conversation participants and authorised moderation or support personnel when necessary. Do not … | Workspace owners and authorised members can access shared workspace content according to their roles. Messages are visible to conversation participants and authorised moderation or support personnel when necessary. Do no… | Legal text: version bump and re-acceptance |
| 38 | 16. Account and project deletion | 16. Account and workspace deletion | Legal text: version bump and re-acceptance |
| 38 | Deleting an account first hides the profile and begins a 30-day grace period. Before deletion, project owners should transfer projects they want collaborators to retain and export needed information. Permanent deletion c… | Deleting an account first hides the profile and begins a 30-day grace period. Before deletion, workspace owners should transfer workspaces they want members to retain and export needed information. Permanent deletion can… | Legal text: version bump and re-acceptance |

### `src/app/(legal)/security-reporting/page.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 12 | Test only accounts and projects you own or have explicit permission to test. | Test only accounts and workspaces you own or have explicit permission to test. | Legal text: version bump and re-acceptance |
| 20 | : Task assignments, workflow updates, mentions, and project activity alerts. | : Task assignments, workflow updates, mentions, and workspace activity alerts. | Legal text: version bump and re-acceptance |

### `src/app/(legal)/subprocessors/page.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 10 | Account, project, communication, and operational data processed by the application | Account, workspace, communication, and operational data processed by the application | Legal text: version bump and re-acceptance |
| 11 | Account, profile, project, file, message, session, and integration data | Account, profile, workspace, file, message, session, and integration data | Legal text: version bump and re-acceptance |

### `src/app/(legal)/support/page.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 29 | For assistance with account setup, workspace collaboration, project permissions, or general questions regarding NetworkBase, our support desk is reached at | For assistance with account setup, workspace collaboration, workspace permissions, or general questions regarding NetworkBase, our support desk is reached at | Legal text: version bump and re-acceptance |
| 37 | When contacting support, please include your registered account email, relevant project identifiers or URLs, and a concise summary of the issue. Our team operates Monday through Friday and typically acknowledges queries … | When contacting support, please include your registered account email, relevant workspace identifiers or URLs, and a concise summary of the issue. Our team operates Monday through Friday and typically acknowledges querie… | Legal text: version bump and re-acceptance |
| 188 | : Task updates, mentions, collaboration alerts, and project messages. | : Task updates, mentions, collaboration alerts, and workspace messages. | Legal text: version bump and re-acceptance |

### `src/app/(legal)/terms/page.tsx` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 12 | These Terms govern accounts, collaboration, projects, messages, integrations, AI assistance, and public content on NetworkBase. | These Terms govern accounts, collaboration, workspaces, messages, integrations, AI assistance, and public content on NetworkBase. | Legal text: version bump and re-acceptance |
| 16 | NetworkBase provides professional profiles, project discovery, collaborative workspaces, documentation, files, tasks, messaging, notifications, GitHub workflows, recovery features, and optional AI assistance. Features ma… | NetworkBase provides professional profiles, workspace discovery, collaborative workspaces, documentation, files, tasks, messaging, notifications, GitHub workflows, recovery features, and optional AI assistance. Features … | Legal text: version bump and re-acceptance |
| 17 | You confirm that you have the rights and permissions needed for everything you upload, import, share, or direct us to process. Public content may be viewed, linked, cached, indexed, or copied by others. Feedback about Ne… | You confirm that you have the rights and permissions needed for everything you upload, import, share, or direct us to process. Public content may be viewed, linked, cached, indexed, or copied by others. Feedback about Ne… | Legal text: version bump and re-acceptance |
| 18 | 6. Projects and collaborators | 6. Workspaces and members | Legal text: version bump and re-acceptance |
| 18 | Project owners control visibility, roles, invitations, exports, integrations, archival, transfer, and deletion, subject to these Terms. | Workspace owners control visibility, roles, invitations, exports, integrations, archival, transfer, and deletion, subject to these Terms. | Legal text: version bump and re-acceptance |
| 18 | Before leaving or deleting an account, owners should transfer projects that others need. Deletion may remove owned workspaces or conversations as disclosed in the interface. | Before leaving or deleting an account, owners should transfer workspaces that others need. Deletion may remove owned workspaces or conversations as disclosed in the interface. | Legal text: version bump and re-acceptance |
| 18 | A project privacy tab describes the current access state; it does not create a separate NDA or alter these Terms. | A workspace privacy tab describes the current access state; it does not create a separate NDA or alter these Terms. | Legal text: version bump and re-acceptance |
| 19 | Messages and project discussions are for lawful collaboration. Participants may report content. We may review reported or technically necessary information, restrict delivery, preserve evidence, remove content, or suspen… | Messages and workspace discussions are for lawful collaboration. Participants may report content. We may review reported or technically necessary information, restrict delivery, preserve evidence, remove content, or susp… | Legal text: version bump and re-acceptance |
| 23 | NetworkBase is not an NDA, secret manager, health-record system, payment-card vault, or regulated professional repository. Do not upload secrets, credentials, classified material, special-category data, payment-card data… | NetworkBase is not an NDA, secret manager, health-record system, payment-card vault, or regulated professional repository. Do not upload secrets, credentials, classified material, special-category data, payment-card data… | Legal text: version bump and re-acceptance |
| 26 | To the maximum extent permitted by law, NetworkBase is provided “as available” without promises that it will be uninterrupted, error-free, secure against every threat, or suitable for a particular project. Nothing in the… | To the maximum extent permitted by law, NetworkBase is provided “as available” without promises that it will be uninterrupted, error-free, secure against every threat, or suitable for a particular workspace. Nothing in t… | Legal text: version bump and re-acceptance |

### `src/app/(site)/(auth)/authorize/AuthorizeClient.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 26 | Open your projects and virtual files | Open your workspaces and virtual files |  |
| 246 | Approve to connect {…} to your NetworkBase projects, virtual files and tasks. | Approve to connect {…} to your NetworkBase workspaces, virtual files and tasks. |  |
| 333 | Projects, virtual files and task pushes. Revocable any time. | Workspaces, virtual files and task pushes. Revocable any time. |  |

### `src/app/(site)/(auth)/login/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 6 | Sign in to NetworkBase to reach your projects, people and messages. | Sign in to NetworkBase to reach your workspaces, people and messages. |  |

### `src/app/(site)/(auth)/signup/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 6 | Create a NetworkBase account to find collaborators and build projects together. | Create a NetworkBase account to find members and build workspaces together. |  |

### `src/app/(site)/(auth)/verify-email/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 15 | Unlocks messages and projects | Unlocks messages and workspaces |  |

### `src/app/(site)/(main)/discover/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 18 | Discover and collaborate on the best side-projects and indie apps. | Discover and collaborate on the best side-workspaces and indie apps. |  |

### `src/app/(site)/(main)/messages/(lists)/p/[projectId]/browse/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 10 | Browse channels in your project. | Browse channels in your workspace. |  |

### `src/app/(site)/(main)/messages/(lists)/p/[projectId]/page.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 10 | Project messages \| NetworkBase | Workspace messages \| NetworkBase |  |
| 10 | Conversations for your project. | Conversations for your workspace. |  |

### `src/app/(site)/(main)/messages/(lists)/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 10 | Channels and direct messages for your projects. | Channels and direct messages for your workspaces. |  |

### `src/app/(site)/(main)/messages/[channelId]/page.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 8 | Channels and direct messages for your projects. | Channels and direct messages for your workspaces. |  |

### `src/app/(site)/(main)/messages/layout.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 7 | Channels and direct messages for your projects. | Channels and direct messages for your workspaces. |  |

### `src/app/(site)/(main)/projects/[slug]/loading.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 8 | Loading project | Loading workspace |  |
| 11 | Loading project… | Loading workspace… |  |

### `src/app/(site)/(main)/projects/[slug]/project-route.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 63 | Project Feed | Workspace Feed |  |
| 73 | Projects | Workspaces |  |
| 111 | Project on NetworkBase | Workspace on NetworkBase |  |
| 111 | Open this project on NetworkBase. | Open this workspace on NetworkBase. |  |

### `src/app/(site)/(main)/projects/new/page.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 12 | Create project \| NetworkBase | Create workspace \| NetworkBase |  |
| 13 | Start a new project on NetworkBase. | Start a new workspace on NetworkBase. |  |
| 46 | {…}.`} This will be a personal project. | {…}.`} This will be a personal workspace. |  |

### `src/app/(site)/page.tsx` (17)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 14 | Discover projects, find collaborators by skill, and bring tasks, files and conversations together in one workspace. | Discover workspaces, find members by skill, and bring tasks, files and conversations together in one workspace. |  |
| 24 | Browse projects by skills and interests. See the idea, the team and the roles they still need. | Browse workspaces by skills and interests. See the idea, the team and the roles they still need. |  |
| 24 | Explore projects | Explore workspaces |  |
| 26 | Give your project a place to grow. | Give your workspace a place to grow. |  |
| 26 | Start a project | Start a workspace |  |
| 42 | Channels and direct messages for every project. | Channels and direct messages for every workspace. |  |
| 44 | Decide who can view, edit and manage each project. | Decide who can view, edit and manage each workspace. |  |
| 45 | Work on project files and tasks from VS Code, Cursor or Windsurf. | Work on workspace files and tasks from VS Code, Cursor or Windsurf. |  |
| 66 | Example of a project on NetworkBase: open roles, team and tasks | Example of a workspace on NetworkBase: open roles, team and tasks |  |
| 68 | Example project | Example workspace |  |
| 121 | NetworkBase connects people who want to build with the projects that need them, then gives the team one place to plan, write, share and ship. | NetworkBase connects people who want to build with the workspaces that need them, then gives the team one place to plan, write, share and ship. |  |
| 132 | The people, the project, | The people, the workspace, |  |
| 148 | Every profile shows skills, experience, weekly availability and the projects someone has worked on. Search by skill, or post an open role and let the right people find you. | Every profile shows skills, experience, weekly availability and the workspaces someone has worked on. Search by skill, or post an open role and let the right people find you. |  |
| 150 | Post open roles on your project | Post open roles on your workspace |  |
| 177 | Everything a project needs, in one place. | Everything a workspace needs, in one place. |  |
| 197 | Find a project or create one of your own. | Find a workspace or create one of your own. |  |
| 230 | Find collaborators, join projects, and build together in one workspace. | Find members, join workspaces, and build together in one workspace. |  |

### `src/app/actions/account.ts` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 142 | Re-authenticate to transfer project ownership. | Re-authenticate to transfer workspace ownership. |  |
| 293 | Not the project owner | Not the workspace owner |  |
| 295 | New owner must be a project member | New owner must be a workspace member |  |
| 299 | Project not found | Workspace not found |  |
| 327 | Project ownership transferred | Workspace ownership transferred |  |
| 328 | Project ownership changed | Workspace ownership changed |  |
| 338 | Project | Workspace |  |
| 352 | Project ownership transferred to you | Workspace ownership transferred to you |  |
| 353 | Project ownership changed | Workspace ownership changed |  |
| 363 | Project | Workspace |  |

### `src/app/actions/applications/internal.ts` (22)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 228 | A new member joined the project. | A new member joined the workspace. |  |
| 240 | Project | Workspace |  |
| 242 | New project member | New workspace member |  |
| 480 | Project not found | Workspace not found |  |
| 482 | This project is no longer taking applications | This workspace is no longer taking applications |  |
| 850 | Too many attempts for this project. Please retry shortly. | Too many attempts for this workspace. Please retry shortly. |  |
| 882 | Project not found | Workspace not found |  |
| 885 | You cannot apply to your own project | You cannot apply to your own workspace |  |
| 888 | You are already on this project | You are already on this workspace |  |
| 908 | You have an invitation to this project. Accept or decline it first. | You have an invitation to this workspace. Accept or decline it first. |  |
| 923 | This project is private. | This workspace is private. |  |
| 969 | You already have a pending application for this project. Nothing was changed. | You already have a pending application for this workspace. Nothing was changed. |  |
| 975 | Respond to your invitation for this project first | Respond to your invitation for this workspace first |  |
| 1123 | Only the project owner or admins can accept applications | Only the workspace owner or admins can accept applications |  |
| 1435 | Only the project owner or admins can reject applications | Only the workspace owner or admins can reject applications |  |
| 1778 | Only project owner or admins can reopen applications | Only workspace owner or admins can reopen applications |  |
| 1810 | This application was closed with its role or project and cannot be reopened. | This application was closed with its role or workspace and cannot be reopened. |  |
| 1962 | Unknown Project | Unknown Workspace |  |
| 1990 | Unknown Project | Unknown Workspace |  |
| 2080 | Project not found | Workspace not found |  |
| 2352 | Failed to cancel project invitation | Failed to cancel workspace invitation |  |
| 2357 | Failed to cancel project invitation | Failed to cancel workspace invitation |  |

### `src/app/actions/child-units.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 93 | That person is no longer in the project. | That person is no longer in the workspace. |  |

### `src/app/actions/contribution-stories.ts` (12)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 133 | Please wait before adding another project. | Please wait before adding another workspace. |  |
| 141 | Untitled external project | Untitled external workspace | Keep “project”: external |
| 395 | This project cannot be shown publicly. Your private draft is kept. | This workspace cannot be shown publicly. Your private draft is kept. |  |
| 405 | Confirm that you want this unlisted project listed on your profile. | Confirm that you want this unlisted workspace listed on your profile. |  |
| 492 | Choose an external contribution and a project. | Choose an external contribution and a workspace. |  |
| 518 | Choose a project you contribute to. | Choose a workspace you contribute to. |  |
| 535 | This project already has a contribution. Review the existing story before merging. | This workspace already has a contribution. Review the existing story before merging. |  |
| 711 | A project image is no longer public. Remove or replace it before publishing. | A workspace image is no longer public. Remove or replace it before publishing. |  |
| 970 | Invalid project image. | Invalid workspace image. |  |
| 990 | Choose a public PNG, JPG, or WebP project image. | Choose a public PNG, JPG, or WebP workspace image. |  |
| 1000 | This project image is unavailable. | This workspace image is unavailable. |  |
| 1017 | Could not copy the project image. | Could not copy the workspace image. |  |

### `src/app/actions/discover.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 56 | Invalid project search request | Invalid workspace search request |  |
| 228 | Failed to fetch projects | Failed to fetch workspaces |  |

### `src/app/actions/files/collections.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 36 | Invalid project | Invalid workspace |  |

### `src/app/actions/files/content.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 54 | File key does not belong to this project | File key does not belong to this workspace |  |

### `src/app/actions/files/mutations.ts` (11)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 259 | A new folder was added to the project workspace. | A new folder was added to the workspace. |  |
| 342 | Canonical file not found in this project | Canonical file not found in this workspace |  |
| 388 | A file was added to the project workspace. | A file was added to the workspace. |  |
| 627 | Files were added to the project workspace. | Files were added to the workspace. |  |
| 814 | A project file or folder was renamed. | A workspace file or folder was renamed. |  |
| 889 | Task working files must be published to Project Files before they can be relocated | Task working files must be published to Workspace Files before they can be relocated |  |
| 992 | Task working files were published to Project Files. | Task working files were published to Workspace Files. |  |
| 993 | Project files were reorganized. | Workspace files were reorganized. |  |
| 1057 | A project file or folder was restored. | A workspace file or folder was restored. |  |
| 1145 | Project files were moved to trash. | Workspace files were moved to trash. |  |
| 1259 | Project files were restored from trash. | Workspace files were restored from trash. |  |

### `src/app/actions/files/nodes.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 207 | Invalid project nodes cursor; reopen the folder to restart the listing | Invalid workspace nodes cursor; reopen the folder to restart the listing |  |
| 315 | Project | Workspace |  |

### `src/app/actions/files/trash.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 137 | Invalid project | Invalid workspace |  |

### `src/app/actions/files/versions.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 188 | Version key does not belong to this project | Version key does not belong to this workspace |  |
| 328 | Version {…} was added to a project file. | Version {…} was added to a workspace file. |  |

### `src/app/actions/matchmaking/resolver.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 47 | You can only inspect candidate alignment for projects you manage | You can only inspect candidate alignment for workspaces you manage |  |

### `src/app/actions/org-members.ts` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 225 | That project is no longer in this organization. | That workspace is no longer in this organization. |  |
| 368 | This person leads a project here. Transfer or detach it first. | This person leads a workspace here. Transfer or detach it first. |  |
| 399 | That project is no longer in this organization. | That workspace is no longer in this organization. |  |
| 402 | That unit is no longer in the project. | That team is no longer in the workspace. |  |

### `src/app/actions/org-workspace.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 196 | Project · {…} | Workspace · {…} |  |
| 261 | new project | new workspace |  |
| 261 | New project in {…} | New workspace in {…} |  |

### `src/app/actions/organizations.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 472 | This project now has people outside the organization. | This workspace now has people outside the organization. |  |

### `src/app/actions/project/doc.ts` (13)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 164 | Project not found | Workspace not found |  |
| 315 | This project reference is not available to this viewer. | This workspace reference is not available to this viewer. |  |
| 497 | Project member | Workspace member |  |
| 549 | Project not readable | Workspace not readable |  |
| 834 | Projects | Workspaces |  |
| 835 | Projects inside this organization, live. | Workspaces inside this organization, live. |  |
| 883 | Selected project context from this document. | Selected workspace context from this document. |  |
| 884 | Current project context rendered from live project data. | Current workspace context rendered from live workspace data. |  |
| 900 | Failed to load document project references. | Failed to load document workspace references. |  |
| 948 | Only project members can add a document. | Only workspace members can add a document. |  |
| 994 | Only project members can remove a document. | Only workspace members can remove a document. |  |
| 1029 | You cannot initialize documents for this project. | You cannot initialize documents for this workspace. |  |
| 1076 | Initial project document | Initial workspace document |  |

### `src/app/actions/project/guidance.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 99 | Project invitation | Workspace invitation |  |
| 125 | Only the project Lead can appoint a Guide | Only the owner can appoint a Guide | Role wording (Owner/Admin) |
| 229 | Project not found | Workspace not found |  |

### `src/app/actions/project/recent-activity.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 21 | Project not found | Workspace not found |  |
| 24 | Project not found | Workspace not found |  |

### `src/app/actions/project/task-completion.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 30 | Project not found | Workspace not found |  |
| 77 | Only project leads can change completion settings | Only workspace leads can change completion settings |  |

### `src/app/actions/project/updates.ts` (28)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 916 | Attached project media | Attached workspace media |  |
| 918 | Project update | Workspace update |  |
| 1115 | Project updates are unavailable. | Workspace updates are unavailable. |  |
| 1226 | Failed to load project updates | Failed to load workspace updates |  |
| 1234 | Project update unavailable. | Workspace update unavailable. |  |
| 1243 | Project update not found. | Workspace update not found. |  |
| 1246 | Failed to load project update | Failed to load workspace update |  |
| 1317 | Project update context is unavailable. | Workspace update context is unavailable. |  |
| 1339 | Failed to load project update context. | Failed to load workspace update context. |  |
| 1477 | Only child projects share to their organization. | Only workspaces in the organization share to their organization. | Organization context |
| 1524 | You do not have permission to post project updates. | You do not have permission to post workspace updates. |  |
| 1567 | Failed to create project update | Failed to create workspace update |  |
| 1613 | Project update | Workspace update |  |
| 1679 | Project update unavailable. | Workspace update unavailable. |  |
| 1699 | Project update not found. | Workspace update not found. |  |
| 1751 | Project update unavailable. | Workspace update unavailable. |  |
| 1765 | Project update not found. | Workspace update not found. |  |
| 1831 | Only project leaders can pin updates. | Only workspace leaders can pin updates. |  |
| 1879 | Project update unavailable. | Workspace update unavailable. |  |
| 1890 | Project update not found. | Workspace update not found. |  |
| 1998 | Project update unavailable. | Workspace update unavailable. |  |
| 2126 | Project update unavailable. | Workspace update unavailable. |  |
| 2208 | Project update unavailable. | Workspace update unavailable. |  |
| 2212 | Only project members can comment on this update. | Only workspace members can comment on this update. |  |
| 2287 | Project update | Workspace update |  |
| 2314 | {…} commented on your project update | {…} commented on your workspace update |  |
| 2327 | Project update | Workspace update |  |
| 2405 | Project update unavailable. | Workspace update unavailable. |  |

### `src/app/actions/project/workflow.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 94 | Invalid project | Invalid workspace |  |

### `src/app/actions/task-comment.ts` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 130 | Task does not belong to this project | Task does not belong to this workspace |  |
| 133 | Project not found | Workspace not found |  |
| 142 | You do not have permission to perform this project action | You do not have permission to perform this workspace action |  |
| 193 | Comment does not belong to this project | Comment does not belong to this workspace |  |
| 196 | Project not found | Workspace not found |  |
| 205 | You do not have permission to perform this project action | You do not have permission to perform this workspace action |  |

### `src/app/actions/task.ts` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 100 | Task does not belong to this project | Task does not belong to this workspace |  |
| 124 | Only the project owner can change sprint assignments | Only the workspace owner can change sprint assignments |  |
| 137 | Sprint must belong to this project | Sprint must belong to this workspace |  |
| 359 | Task does not belong to this project | Task does not belong to this workspace |  |
| 409 | Task does not belong to this project | Task does not belong to this workspace |  |
| 412 | Only the assignee or a project lead can move this task. | Only the assignee or a owner can move this task. | Role wording (Owner/Admin) |
| 488 | Task does not belong to this project | Task does not belong to this workspace |  |
| 521 | Assignee must be a project member | Assignee must be a workspace member |  |
| 524 | Assignee must be an assignable project member | Assignee must be an assignable workspace member |  |
| 622 | Only project leads can approve tasks | Only workspace leads can approve tasks |  |

### `src/app/actions/upload-import.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 228 | Project not found | Workspace not found |  |
| 343 | Project not found | Workspace not found |  |
| 1051 | Project not found | Workspace not found |  |

### `src/app/api/og/project/[slug]/route.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 11 | Invalid project | Invalid workspace |  |

### `src/app/api/v1/account/deletion-preflight/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 39 | Could not load your projects | Could not load your workspaces |  |

### `src/app/api/v1/extension/_file-revision.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 43 | Project not found | Workspace not found |  |

### `src/app/api/v1/extension/bulk-finalize/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 75 | Project not found | Workspace not found |  |

### `src/app/api/v1/extension/bulk-intent/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 55 | Project not found | Workspace not found |  |

### `src/app/api/v1/extension/comments/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 189 | Only the thread author or project owner can change its state or anchor | Only the thread author or workspace owner can change its state or anchor |  |

### `src/app/api/v1/extension/file-lock/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 72 | Project not found | Workspace not found |  |

### `src/app/api/v1/extension/file-upload/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 273 | Upload intent is missing project id | Upload intent is missing workspace id |  |

### `src/app/api/v1/extension/file/route.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 112 | File key does not belong to this project | File key does not belong to this workspace |  |
| 131 | File key does not belong to this project | File key does not belong to this workspace |  |
| 176 | File key does not belong to this project | File key does not belong to this workspace |  |

### `src/app/api/v1/extension/folder/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 66 | Project not found | Workspace not found |  |

### `src/app/api/v1/extension/heartbeat/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 36 | Too many projects | Too many workspaces |  |

### `src/app/api/v1/extension/project-summary/route.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 32 | Invalid project id | Invalid workspace id |  |
| 37 | Project not found | Workspace not found |  |
| 90 | Failed to get project summary | Failed to get workspace summary |  |

### `src/app/api/v1/extension/project-tasks/route.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 64 | Invalid project task query | Invalid workspace task query |  |
| 72 | Project not found | Workspace not found |  |
| 150 | Failed to get project tasks | Failed to get workspace tasks |  |

### `src/app/api/v1/extension/recovery-drafts/route.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 91 | Project not found | Workspace not found |  |
| 434 | Invalid project id | Invalid workspace id |  |

### `src/app/api/v1/extension/task-push/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 27 | A published file is unavailable in this project | A published file is unavailable in this workspace |  |

### `src/app/api/v1/extension/workspace/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 43 | Invalid project page query | Invalid workspace page query |  |

### `src/app/api/v1/files/locks/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 11 | Invalid project id | Invalid workspace id |  |

### `src/app/api/v1/integrations/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 96 | Untitled Project | Untitled Workspace |  |

### `src/app/api/v1/profiles/[id]/collaboration-stages/[stageId]/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | Stage editing has moved to the project contribution editor | Stage editing has moved to the workspace contribution editor |  |

### `src/app/api/v1/profiles/[id]/project-invites/route.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 67 | You can only invite this profile to projects you manage | You can only invite this profile to workspaces you manage |  |
| 105 | Project invite sent | Workspace invite sent |  |
| 123 | Failed to send project invite | Failed to send workspace invite |  |

### `src/app/api/v1/profiles/[id]/projects/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 85 | Failed to load profile projects | Failed to load profile workspaces |  |

### `src/app/api/v1/projects/[id]/capabilities/route.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 29 | Invalid project id | Invalid workspace id |  |
| 34 | Project not found | Workspace not found |  |

### `src/app/api/v1/projects/[id]/files/export/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 20 | Project Files | Workspace Files |  |

### `src/app/api/v1/projects/[id]/members/route.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 81 | Invalid project id | Invalid workspace id |  |
| 86 | Project not found | Workspace not found |  |

### `src/app/api/v1/projects/[id]/sync-diff/route.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 47 | Invalid project id | Invalid workspace id |  |
| 52 | Project not found | Workspace not found |  |

### `src/app/api/v1/projects/[id]/tasks/[taskId]/merge/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 70 | Project not found | Workspace not found |  |

### `src/app/go/[ownerType]/[ownerId]/[linkKey]/route.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 91 | This link is available to project members only. | This link is available to workspace members only. |  |

### `src/components/applications/DecisionDialog.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 79 | They join the project{…}` : ""} and the other applicants for that role are told if it fills. | They join the workspace{…}` : ""} and the other applicants for that role are told if it fills. |  |

### `src/components/auth/LoginForm.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 21 | Your projects and tasks | Your workspaces and tasks |  |

### `src/components/auth/SignupForm.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 28 | Your first project is three steps away. | Your first workspace is three steps away. |  |
| 29 | Find or start a project | Find or start a workspace |  |
| 34 | Unlocks messages and projects | Unlocks messages and workspaces |  |
| 371 | Find collaborators and build projects together. | Find members and build workspaces together. |  |

### `src/components/discover/DiscoverClient.tsx` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 408 | No projects match | No workspaces match |  |
| 416 | Projects you follow show up here | Workspaces you follow show up here |  |
| 416 | Follow a project to get its updates in this view. | Follow a workspace to get its updates in this view. |  |
| 416 | Browse all projects | Browse all workspaces |  |
| 419 | Add skills and interests to your profile to get projects that fit you. | Add skills and interests to your profile to get workspaces that fit you. |  |
| 421 | No projects yet | No workspaces yet |  |
| 421 | No projects here yet | No workspaces here yet |  |
| 421 | New project | New workspace |  |
| 435 | Projects didn't load. Check your connection and try again. | Workspaces didn't load. Check your connection and try again. |  |
| 498 | Projects and updates | Workspaces and updates |  |

### `src/components/discover/DiscoverFiltersPanel.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 73 | Projects that use any of these skills. | Workspaces that use any of these skills. |  |
| 79 | Hide projects I&apos;ve opened | Hide workspaces I&apos;ve opened |  |

### `src/components/discover/DiscoverHeader.tsx` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 18 | All projects | All workspaces |  |
| 18 | Every open project and its latest updates, newest first. | Every open workspace and its latest updates, newest first. |  |
| 19 | Projects getting the most attention right now. | Workspaces getting the most attention right now. |  |
| 20 | Projects that match your skills and interests. | Workspaces that match your skills and interests. |  |
| 21 | Projects you follow, and what they post. | Workspaces you follow, and what they post. |  |
| 56 | Search projects and updates | Search workspaces and updates |  |
| 141 | Projects | Workspaces |  |
| 150 | Sort projects | Sort workspaces |  |
| 193 | hiding projects you opened | hiding workspaces you opened |  |
| 193 | Hiding projects you opened | Hiding workspaces you opened |  |

### `src/components/discover/DiscoverUpdateCard.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 285 | View in project | View in workspace |  |

### `src/components/layout/AppSidebar.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 58 | Unable to load projects | Unable to load workspaces |  |
| 115 | Your projects | Your workspaces |  |
| 123 | No projects yet | No workspaces yet |  |
| 124 | Projects unavailable | Workspaces unavailable |  |

### `src/components/layout/SidebarWorkspaces.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 54 | New project in {…} | New workspace in {…} |  |
| 54 | New project in {…} | New workspace in {…} |  |
| 67 | All projects → | All workspaces → |  |
| 104 | No projects yet | No workspaces yet |  |

### `src/components/layout/header/CommandPalette.tsx` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 53 | Discover / Projects | Discover / Workspaces |  |
| 53 | Project name | Workspace name |  |
| 54 | Discover / Projects | Discover / Workspaces |  |
| 54 | Project name | Workspace name |  |
| 56 | Project / Work & Links | Workspace / Work & Links |  |
| 315 | Projects · {…} | Workspaces · {…} |  |
| 321 | Project Links · {…} | Workspace Links · {…} |  |
| 419 | Project search results | Workspace search results |  |
| 459 | project work or links | workspace work or links |  |
| 476 | Skills in these projects | Skills in these workspaces |  |

### `src/components/layout/header/GlobalSearch.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 44 | Search projects | Search workspaces |  |
| 50 | Search this project | Search this workspace |  |
| 54 | Search projects | Search workspaces |  |

### `src/components/layout/header/GlobalSearchResultCards.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 180 | Open project {…} | Open workspace {…} |  |
| 345 | Open project link {…}: {…} | Open workspace link {…}: {…} |  |
| 385 | Project | Workspace |  |

### `src/components/layout/header/MobileMenu.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 87 | New project | New workspace |  |

### `src/components/layout/header/TopNav.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 192 | New project | New workspace |  |

### `src/components/layout/header/global-search.ts` (11)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 170 | categories project connection message application | categories workspace connection message application |  |
| 218 | Docs, assignments, projects, files you can open, sprints and tasks in this organization. | Docs, assignments, workspaces, files you can open, sprints and tasks in this organization. |  |
| 224 | Search this project's tasks... | Search this workspace's tasks... |  |
| 225 | Search project tasks | Search workspace tasks |  |
| 226 | Search task keys, titles, and descriptions in this project. | Search task keys, titles, and descriptions in this workspace. |  |
| 243 | Search projects... | Search workspaces... |  |
| 244 | Search projects | Search workspaces |  |
| 245 | Search project names, descriptions, and technologies. | Search workspace names, descriptions, and technologies. |  |
| 266 | Search projects... | Search workspaces... |  |
| 267 | Search projects | Search workspaces |  |
| 268 | Search projects from anywhere in the app. | Search workspaces from anywhere in the app. |  |

### `src/components/messages/CanvasTemplateModal.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 57 | Projects | Workspaces |  |

### `src/components/messages/ChatSections.tsx` (12)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 441 | {…}, switch project{…} | {…}, switch workspace{…} |  |
| 447 | All projects | All workspaces |  |
| 452 | Switch project | Switch workspace |  |
| 456 | All projects | All workspaces |  |
| 466 | No projects yet. | No workspaces yet. |  |
| 470 | Create new project | Create new workspace |  |
| 494 | View project | View workspace |  |
| 495 | Project settings | Workspace settings |  |
| 504 | View project | View workspace |  |
| 816 | No projects yet | No workspaces yet |  |
| 816 | Project channels show up here. | Workspace channels show up here. |  |
| 816 | Create a project | Create a workspace |  |

### `src/components/messages/Composer.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 69 | Create a project task | Create a workspace task |  |

### `src/components/messages/ConversationView.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 94 | a project role | a workspace role |  |
| 101 | This is your application for {…}. {…}. You can still ask or reply here.` : "The project's reviewers answer here, and you can ask or add anything they need."} | This is your application for {…}. {…}. You can still ask or reply here.` : "The workspace's reviewers answer here, and you can ask or add anything they need."} |  |

### `src/components/messages/CreateChannelDialog.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 61 | Channels are where your project talks about a topic. | Channels are where your workspace talks about a topic. |  |
| 66 | Project | Workspace |  |

### `src/components/messages/DetailsPane.tsx` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 362 | Projects in common | Workspaces in common |  |
| 533 | Everyone in the project is a member. | Everyone in the workspace is a member. |  |
| 549 | Everyone in the project can find and join it. | Everyone in the workspace can find and join it. |  |
| 556 | Project | Workspace |  |
| 597 | Everyone in the project will be able to find, preview and join it. | Everyone in the workspace will be able to find, preview and join it. |  |

### `src/components/messages/ExistingCanvasModal.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 89 | No other canvases in this project yet. | No other canvases in this workspace yet. |  |

### `src/components/messages/HomePane.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 124 | Message a teammate directly, or join a channel in one of your projects. | Message a teammate directly, or join a channel in one of your workspaces. |  |
| 127 | Find a project | Find a workspace |  |

### `src/components/messages/MessagesViews.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 244 | You're no longer in that project. | You're no longer in that workspace. |  |
| 351 | Start one for a topic your project talks about. | Start one for a topic your workspace talks about. |  |

### `src/components/messages/OrgBrowseProjects.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 25 | Couldn't open that project's channel. | Couldn't open that workspace's channel. |  |
| 34 | Browse projects | Browse workspaces |  |
| 38 | No projects yet. | No workspaces yet. |  |

### `src/components/messages/cards/ApplicationCard.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 136 | Open project chat | Open workspace chat |  |
| 137 | Open project | Open workspace |  |
| 214 | Project chat | Workspace chat |  |
| 215 | Open project | Open workspace |  |

### `src/components/network/ConnectionsClient.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 274 | They will not be able to view your profile, send you messages, or invite you to projects. | They will not be able to view your profile, send you messages, or invite you to workspaces. |  |

### `src/components/network/IncomingProjectApplicationRow.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 55 | Project invitation | Workspace invitation |  |
| 55 | Project application | Workspace application |  |

### `src/components/network/InvitationsClient.tsx` (16)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 323 | Failed to cancel project invitation | Failed to cancel workspace invitation |  |
| 328 | Cancelling project invitation... | Cancelling workspace invitation... |  |
| 329 | Project invitation cancelled | Workspace invitation cancelled |  |
| 333 | Failed to cancel project invitation | Failed to cancel workspace invitation |  |
| 365 | Failed to update project invitation | Failed to update workspace invitation |  |
| 373 | Accepting project invitation... | Accepting workspace invitation... |  |
| 374 | Declining project invitation... | Declining workspace invitation... |  |
| 377 | Project invitation accepted | Workspace invitation accepted |  |
| 378 | Project invitation declined | Workspace invitation declined |  |
| 382 | Failed to update project invitation | Failed to update workspace invitation |  |
| 544 | Try a different name, role, project, or filter. | Try a different name, role, workspace, or filter. |  |
| 545 | Connection and project invitations will appear here. | Connection and workspace invitations will appear here. |  |
| 645 | Project invitations | Workspace invitations |  |
| 703 | Project applications | Workspace applications |  |
| 833 | the project | the workspace |  |
| 852 | Sent project invitations | Sent workspace invitations |  |

### `src/components/network/NetworkClient.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 394 | Project invitations | Workspace invitations |  |
| 399 | Project applications | Workspace applications |  |

### `src/components/network/NetworkFilters.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 161 | Project invitations and applications | Workspace invitations and applications |  |
| 261 | Project requests | Workspace requests |  |

### `src/components/network/SentApplicationMenu.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 36 | View project | View workspace |  |

### `src/components/onboarding/FinishScreen.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 21 | Your profile is live. Connect with developers, collaborate on projects, and manage tasks across your workspace. | Your profile is live. Connect with developers, collaborate on workspaces, and manage tasks across your workspace. |  |
| 22 | Your profile is set up and visible to your connections. Connect with developers and collaborate on projects. | Your profile is set up and visible to your connections. Connect with developers and collaborate on workspaces. |  |

### `src/components/onboarding/steps/Step3Skills.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 34 | Optional topics help refine project and collaborator recommendations. | Optional topics help refine workspace and member recommendations. |  |

### `src/components/organizations/AssignmentsPanel.tsx` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 83 | Or pick a project doc | Or pick a workspace doc |  |
| 85 | Or pick a project doc… | Or pick a workspace doc… |  |
| 135 | Creates {…} copies · one per project lead | Creates {…} copies · one per owner | Role wording (Owner/Admin) |
| 136 | Creates {…} copies · one per project lead | Creates {…} copies · one per owner | Role wording (Owner/Admin) |
| 167 | Each person (or team, or project) gets their own copy to hand in. | Each person (or team, or workspace) gets their own copy to hand in. |  |
| 189 | Each project in the organization | Each workspace in the organization |  |
| 190 | Selected projects | Selected workspaces |  |
| 236 | Projects | Workspaces |  |
| 374 | No assignments yet. Give everyone (or teams, or each project) their own copy to hand in. | No assignments yet. Give everyone (or teams, or each workspace) their own copy to hand in. |  |
| 428 | Submit for the project | Submit for the workspace |  |

### `src/components/organizations/ChildOrgSection.tsx` (7)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 63 | Move this project into an organization you belong to. Its admins gain access and its rules apply. | Move this workspace into an organization you belong to. Its admins gain access and its rules apply. |  |
| 93 | This project is part of {…}. Some rules come from there. | This workspace is part of {…}. Some rules come from there. |  |
| 121 | They can open, archive and detach this project. Only the lead deletes it or transfers it. | They can open, archive and detach this workspace. Only the lead deletes it or transfers it. | Role wording (Owner/Admin) |
| 128 | Detaching makes this a Private personal project. Its org views go away. | Detaching makes this a Private personal workspace. Its org views go away. |  |
| 134 | Archive project | Archive workspace |  |
| 153 | Archive this project? | Archive this workspace? |  |
| 154 | It becomes a Private personal project of its lead. | It becomes a Private personal workspace of its lead. | Role wording (Owner/Admin) |

### `src/components/organizations/ChildTeamFields.tsx` (8)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 101 | Not in a project yet | Not in a workspace yet |  |
| 104 | They join only this project, by invitation, and never see | They join only this workspace, by invitation, and never see |  |
| 215 | Project lead | Owner | Role wording (Owner/Admin) |
| 216 | The lead owns the project. You stay an admin through | The lead owns the workspace. You stay an admin through | Role wording (Owner/Admin) |
| 218 | Project lead | Owner | Role wording (Owner/Admin) |
| 231 | For small projects: people added without a unit. | For small workspaces: people added without a team. |  |
| 234 | the project | the workspace |  |
| 248 | They can see and help with this project through | They can see and help with this workspace through |  |

### `src/components/organizations/CreateLocation.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 57 | A personal project, or a project inside one of your organizations. | A personal workspace, or a workspace inside one of your organizations. |  |
| 75 | Only admins create projects here. | Only admins create workspaces here. |  |
| 77 | : only admins create projects here. | : only admins create workspaces here. |  |

### `src/components/organizations/OrgAboutTab.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 49 | Projects | Workspaces |  |

### `src/components/organizations/OrgDangerZone.tsx` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 62 | Restored. Detached projects stay personal; they can move back in. | Restored. Detached workspaces stay personal; they can move back in. |  |
| 104 | project is | workspace is |  |
| 104 | projects are | workspaces are |  |
| 138 | A new organization for the next term. Never members, projects, submissions, messages, posts, contributions or the join code. | A new organization for the next term. Never members, workspaces, submissions, messages, posts, contributions or the join code. |  |
| 179 | Child projects | workspaces in the organization | Organization context |
| 180 | Give them to their leads as personal projects (now) | Give them to their leads as personal workspaces (now) |  |

### `src/components/organizations/OrgDocParts.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 180 | Show in child projects | Show in workspaces in the organization | Organization context |
| 239 | Project docs | Workspace docs |  |

### `src/components/organizations/OrgFilesPanel.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 90 | Copied {…} to this project | Copied {…} to this workspace |  |
| 120 | Copy {…} to this project | Copy {…} to this workspace |  |
| 120 | Copy to this project | Copy to this workspace |  |

### `src/components/organizations/OrgMembersTab.tsx` (14)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 76 | Project | Workspace |  |
| 77 | All projects | All workspaces |  |
| 77 | Not in a project | Not in a workspace |  |
| 125 | — not in a project | — not in a workspace |  |
| 144 | not in a project | not in a workspace |  |
| 177 | Child project | workspace in the organization | Organization context |
| 178 | Add to project… | Add to workspace… |  |
| 187 | Added to the project | Added to the workspace |  |
| 194 | Remove {…} {…}? They leave every project here; handed-in work stays. | Remove {…} {…}? They leave every workspace here; handed-in work stays. |  |
| 263 | Child project | workspace in the organization | Organization context |
| 264 | No project | No workspace |  |
| 317 | Projects &amp; units | Workspaces &amp; teams |  |
| 318 | Not in a project. | Not in a workspace. |  |
| 333 | Remove {…}? They leave every project here; handed-in work stays. | Remove {…}? They leave every workspace here; handed-in work stays. |  |

### `src/components/organizations/OrgOverviewParts.tsx` (11)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 24 | Projects | Workspaces |  |
| 87 | Projects | Workspaces |  |
| 89 | No projects yet. | No workspaces yet. |  |
| 89 | You're not in a project yet. | You're not in a workspace yet. |  |
| 128 | Loading projects… | Loading workspaces… |  |
| 146 | members not in a project | members not in a workspace |  |
| 150 | Search projects | Search workspaces |  |
| 161 | + New project | + New workspace |  |
| 165 | Create projects for your groups. | Create workspaces for your groups. |  |
| 165 | No projects yet. | No workspaces yet. |  |
| 165 | No projects match. | No workspaces match. |  |

### `src/components/organizations/OrgSettingsSections.tsx` (16)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 261 | Create projects | Create workspaces |  |
| 321 | Projects choose Public, Org only or Private. | Workspaces choose Public, Org only or Private. |  |
| 323 | Each project is seen by its team and admins only. | Each workspace is seen by its team and admins only. |  |
| 343 | Projects | Workspaces |  |
| 343 | Who creates projects inside the organization, and who can be added to them. | Who creates workspaces inside the organization, and who can be added to them. |  |
| 346 | Who can create projects | Who can create workspaces |  |
| 347 | Owners and admins always can. Changing this affects new projects only. | Owners and admins always can. Changing this affects new workspaces only. |  |
| 355 | The most open a project here can be. Tightening it lowers projects above it. | The most open a workspace here can be. Tightening it lowers workspaces above it. |  |
| 368 | People outside the organization can be added to its projects | People outside the organization can be added to its workspaces |  |
| 369 | Off by default. They see only that project, never the organization&apos;s content. | Off by default. They see only that workspace, never the organization&apos;s content. |  |
| 371 | People outside the organization can be added to its projects | People outside the organization can be added to its workspaces |  |
| 375 | Projects can share updates to the organization | Workspaces can share updates to the organization |  |
| 376 | Shared posts show in the organization&apos;s Updates under From projects. Private projects never share. | Shared posts show in the organization&apos;s Updates under From workspaces. Private workspaces never share. |  |
| 378 | Projects can share updates to the organization | Workspaces can share updates to the organization |  |
| 382 | Pre-fill the team of every new project, one per line, for example Frontend, Backend, Testing. Still editable per project. | Pre-fill the team of every new workspace, one per line, for example Frontend, Backend, Testing. Still editable per workspace. |  |
| 414 | Project teams always create channels in their own projects. | Workspace teams always create channels in their own workspaces. |  |

### `src/components/organizations/OrgSprintParts.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 61 | Linked projects | Linked workspaces |  |
| 62 | Linked projects | Linked workspaces |  |
| 135 | A file or doc from this project, for everyone working in the sprint. | A file or doc from this workspace, for everyone working in the sprint. |  |

### `src/components/organizations/OrgUpdateParts.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 124 | From projects | From workspaces |  |

### `src/components/organizations/OrgWizardFields.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 122 | Who can create projects inside the organization | Who can create workspaces inside the organization |  |
| 135 | People outside the organization can be added to its projects | People outside the organization can be added to its workspaces |  |
| 136 | Off by default. They see only that project, never the organization&apos;s content. | Off by default. They see only that workspace, never the organization&apos;s content. |  |

### `src/components/presence/ProjectStatusControl.tsx` (11)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 50 | Only owners and admins can set the project status. | Only owners and admins can set the workspace status. |  |
| 50 | Couldn't set the project status. Check the end time. | Couldn't set the workspace status. Check the end time. |  |
| 50 | Couldn't set the project status. Check the end time. | Couldn't set the workspace status. Check the end time. |  |
| 53 | Project status updated | Workspace status updated |  |
| 58 | Couldn't clear the project status. | Couldn't clear the workspace status. |  |
| 61 | Project status cleared | Workspace status cleared |  |
| 69 | Project status: {…}. Change | Workspace status: {…}. Change |  |
| 69 | Set project status | Set workspace status |  |
| 75 | Set project status | Set workspace status |  |
| 81 | Project status | Workspace status |  |
| 96 | Project status | Workspace status |  |

### `src/components/presence/StatusPicker.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 241 | My connections and project teammates | My connections and workspace teammates |  |
| 242 | Only project teammates | Only workspace teammates |  |

### `src/components/profile/edit/ContributionSummaryEditor.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 372 | Contributed to {…} project files | Contributed to {…} workspace files |  |
| 404 | Only public teammates and publicly accessible project items. Mentions send no notification. | Only public teammates and publicly accessible workspace items. Mentions send no notification. |  |

### `src/components/profile/edit/ContributionWorkspace.tsx` (37)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 458 | Could not load your projects. Try again. | Could not load your workspaces. Try again. |  |
| 758 | Finish or remove the current external-project draft before adding another. | Finish or remove the current external-workspace draft before adding another. |  |
| 778 | Could not add an external project. Try again. | Could not add an external workspace. Try again. | Keep “project”: external |
| 974 | Project contributions | Workspace contributions |  |
| 1024 | Project contributions | Workspace contributions |  |
| 1058 | Add external project | Add external workspace | Keep “project”: external |
| 1129 | No project contributions yet | No workspace contributions yet |  |
| 1134 | Platform contributions appear when you join a project. You can also add an external project. | Platform contributions appear when you join a workspace. You can also add an external workspace. | Keep “project”: external |
| 1165 | Back to project contributions | Back to workspace contributions |  |
| 1176 | Untitled external project | Untitled external workspace | Keep “project”: external |
| 1182 | Linked NetworkBase project | Linked NetworkBase workspace |  |
| 1185 | External project · self-reported | External workspace · self-reported | Keep “project”: external |
| 1191 | Tell the story behind your contributions, roles, and highlights for this project. | Tell the story behind your contributions, roles, and highlights for this workspace. |  |
| 1192 | Tell the story behind your work on this external project. | Tell the story behind your work on this external workspace. | Keep “project”: external |
| 1260 | Project identity | Workspace identity |  |
| 1282 | Project identity | Workspace identity |  |
| 1283 | Project name | Workspace name |  |
| 1298 | Link to an existing project | Link to an existing workspace |  |
| 1305 | Explain your part in the project, in your own words. | Explain your part in the workspace, in your own words. |  |
| 1369 | I currently contribute to this project | I currently contribute to this workspace |  |
| 1571 | A current position also marks this project as ongoing. | A current position also marks this workspace as ongoing. |  |
| 1576 | Optional. Describe this period without repeating the whole project summary. | Optional. Describe this period without repeating the whole workspace summary. |  |
| 1692 | From project | From workspace |  |
| 1992 | I have permission to publish this project image. | I have permission to publish this workspace image. |  |
| 2257 | Choose a project image | Choose a workspace image |  |
| 2261 | Only public teammates and publicly accessible project items can be included. Mentioning someone sends no notification. | Only public teammates and publicly accessible workspace items can be included. Mentioning someone sends no notification. |  |
| 2356 | Could not add this project image. Please try again. | Could not add this workspace image. Please try again. |  |
| 2378 | No available items. Private project content stays private. | No available items. Private workspace content stays private. |  |
| 2434 | Share an unlisted project on your profile? | Share an unlisted workspace on your profile? |  |
| 2439 | People who visit your profile will be able to discover this project through your contribution. | People who visit your profile will be able to discover this workspace through your contribution. |  |
| 2450 | I want this unlisted project listed on my profile. | I want this unlisted workspace listed on my profile. |  |
| 2554 | Link your contribution to a project | Link your contribution to a workspace |  |
| 2561 | Search your projects | Search your workspaces |  |
| 2562 | Search your projects… | Search your workspaces… |  |
| 2568 | Project to link | Workspace to link |  |
| 2576 | Choose a project | Choose a workspace |  |
| 2586 | This project already has a contribution. The stories will be combined in its private draft. The external entry can be restored after removal. | This workspace already has a contribution. The stories will be combined in its private draft. The external entry can be restored after removal. |  |

### `src/components/profile/edit/EditProfileEditor.tsx` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 179 | Could not load all project contributions | Could not load all workspace contributions |  |
| 258 | Fix the highlighted project contribution before saving. | Fix the highlighted workspace contribution before saving. |  |
| 259 | Fix the highlighted project contribution before saving. | Fix the highlighted workspace contribution before saving. |  |
| 362 | Profile details were saved, but project contributions were not: {…} | Profile details were saved, but workspace contributions were not: {…} |  |
| 407 | Could not load more project contributions | Could not load more workspace contributions |  |

### `src/components/profile/edit/EditProfileTabs.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 101 | Project contributions | Workspace contributions |  |
| 272 | Square avatar displayed on your profile, project cards, and directory. | Square avatar displayed on your profile, workspace cards, and directory. |  |
| 608 | Optional topics that help refine project and collaborator recommendations. | Optional topics that help refine workspace and member recommendations. |  |

### `src/components/profile/v2/ProfileShell.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 34 | Project contributions | Workspace contributions |  |

### `src/components/profile/v2/ProfileV2Client.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 487 | Showing {…} of {…} visible projects | Showing {…} of {…} visible workspaces |  |
| 488 | Showcasing {…} visible projects | Showcasing {…} visible workspaces |  |
| 498 | Some portfolio projects could not be refreshed. Showing the last available projects. | Some portfolio workspaces could not be refreshed. Showing the last available workspaces. |  |
| 521 | Failed to load project contributions. | Failed to load workspace contributions. |  |

### `src/components/profile/v2/sections/OpenToRolesCard.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 117 | Invite to project | Invite to workspace |  |

### `src/components/profile/v2/sections/ProjectContributionsCard.tsx` (8)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | Project of {…} | Workspace of {…} |  |
| 85 | Project contributions | Workspace contributions |  |
| 87 | Add project contribution | Add workspace contribution |  |
| 92 | Edit project contributions | Edit workspace contributions |  |
| 125 | Projects in {…} | Workspaces in {…} |  |
| 149 | No project contributions | No workspace contributions |  |
| 152 | Add your external projects or contribute to projects on NetworkBase. | Add your external workspaces or contribute to workspaces on NetworkBase. | Keep “project”: external |
| 153 | No public project contributions yet. | No public workspace contributions yet. |  |

### `src/components/profile/v2/sections/ProjectsGridCard.tsx` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 67 | Projects | Workspaces |  |
| 81 | Loading projects… | Loading workspaces… |  |
| 88 | Projects | Workspaces |  |
| 117 | No projects yet | No workspaces yet |  |
| 118 | Projects you create or contribute to will appear here. | Workspaces you create or contribute to will appear here. |  |
| 118 | No public projects have been published yet. | No public workspaces have been published yet. |  |

### `src/components/projects/EditProjectModal.tsx` (16)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 203 | Project updated successfully | Workspace updated successfully |  |
| 208 | Failed to update project | Failed to update workspace |  |
| 256 | Edit Project | Edit Workspace |  |
| 257 | Make your project stand out | Make your workspace stand out |  |
| 262 | Close edit project modal | Close edit workspace modal |  |
| 270 | Edit project sections | Edit workspace sections |  |
| 298 | Edit project sections | Edit workspace sections |  |
| 336 | Project Status | Workspace Status |  |
| 345 | Project Title | Workspace Title |  |
| 360 | A brief pitch for your project... | A brief pitch for your workspace... |  |
| 378 | Tell the full story of your project... | Tell the full story of your workspace... |  |
| 399 | How does your project solve it? | How does your workspace solve it? |  |
| 411 | Project skills and technologies | Workspace skills and technologies |  |
| 415 | Project links | Workspace links |  |
| 416 | These icons appear beside the project title across every project tab. | These icons appear beside the workspace title across every workspace tab. |  |
| 465 | Customize the stages your project will progress through. | Customize the stages your workspace will progress through. |  |

### `src/components/projects/LifecycleEditor.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 172 | Project journey stages | Workspace journey stages |  |
| 175 | Milestone journey stages configured for this project. | Milestone journey stages configured for this workspace. |  |
| 176 | Drag stages using the grip handle to reorder the project roadmap timeline. | Drag stages using the grip handle to reorder the workspace roadmap timeline. |  |

### `src/components/projects/ProjectAvatar.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 251 | Change project avatar | Change workspace avatar |  |
| 252 | Change project avatar | Change workspace avatar |  |

### `src/components/projects/ProjectCard.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 131 | Project skills | Workspace skills |  |
| 146 | Your application on this project | Your application on this workspace |  |
| 187 | to follow projects. | to follow workspaces. |  |

### `src/components/projects/create-wizard/CreateProjectShellSkeleton.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 8 | Loading project creation | Loading workspace creation |  |
| 9 | Loading project creation… | Loading workspace creation… |  |

### `src/components/projects/create-wizard/LeaveProjectSetupDialog.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 40 | Leave project setup? | Leave workspace setup? |  |
| 62 | Saved drafts can be resumed from the same project-creation flow. | Saved drafts can be resumed from the same workspace-creation flow. |  |

### `src/components/projects/create-wizard/WizardFooter.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 88 | Create project | Create workspace |  |

### `src/components/projects/create-wizard/WizardHeader.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 29 | Create project | Create workspace |  |
| 34 | Project creation progress | Workspace creation progress |  |
| 74 | Cancel project setup | Cancel workspace setup |  |
| 82 | Project creation progress | Workspace creation progress |  |

### `src/components/projects/create-wizard/phase1/Phase1SourceMethodGroup.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 19 | Create an empty project and add its details manually. | Create an empty workspace and add its details manually. |  |
| 31 | Inspect a local project folder before creating the project. | Inspect a local workspace folder before creating the workspace. |  |
| 37 | A class, company or club that holds people and their projects. | A class, company or club that holds people and their workspaces. |  |

### `src/components/projects/create-wizard/phase1/UploadManifestPreview.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 24 | Review what will be attached when the project is created. | Review what will be attached when the workspace is created. |  |

### `src/components/projects/create-wizard/phases/Phase1SourceSelection.tsx` (12)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 330 | Your project setup could not be saved before connecting GitHub. Please allow session storage and try again. | Your workspace setup could not be saved before connecting GitHub. Please allow session storage and try again. | Check: may mean the repository |
| 437 | An open group with shared projects | An open group with shared workspaces |  |
| 825 | We could not detect this project’s stack. The folder is still ready to use. | We could not detect this workspace’s stack. The folder is still ready to use. |  |
| 1011 | Set up the project in the next steps | Set up the workspace in the next steps |  |
| 1014 | Start with an empty project, then add its details, team, settings, and review it before publishing. | Start with an empty workspace, then add its details, team, settings, and review it before publishing. |  |
| 1018 | Project source | Workspace source |  |
| 1019 | Empty project | Empty workspace |  |
| 1530 | Choose a local project folder, check its contents, and review the detected stack before continuing. | Choose a local workspace folder, check its contents, and review the detected stack before continuing. |  |
| 1567 | Detected project: {…} | Detected workspace: {…} |  |
| 1576 | Select a project folder | Select a workspace folder |  |
| 1594 | Detected project | Detected workspace |  |
| 1649 | {…} project source settings | {…} workspace source settings |  |

### `src/components/projects/create-wizard/phases/Phase2Information.tsx` (16)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 124 | Project details | Workspace details |  |
| 132 | Check the required project details | Check the required workspace details |  |
| 158 | Name and classify the project | Name and classify the workspace |  |
| 159 | Start with the information people see first when they encounter your project. | Start with the information people see first when they encounter your workspace. |  |
| 164 | Project category | Workspace category |  |
| 218 | Project title | Workspace title |  |
| 225 | Name your project | Name your workspace |  |
| 233 | Another project in | Another workspace in |  |
| 247 | A short sentence that explains the project | A short sentence that explains the workspace |  |
| 251 | Optional. This appears beside the project name in compact contexts. | Optional. This appears beside the workspace name in compact contexts. |  |
| 259 | Project story | Workspace story |  |
| 261 | Give future collaborators enough context to decide whether the project is a fit. | Give future members enough context to decide whether the workspace is a fit. |  |
| 275 | Describe the problem, the project’s goals, and what a contributor should understand before joining. | Describe the problem, the workspace’s goals, and what a contributor should understand before joining. |  |
| 303 | How does this project address it? | How does this workspace address it? |  |
| 314 | Make the project easier to find | Make the workspace easier to find |  |
| 378 | Project skills and technologies | Workspace skills and technologies |  |

### `src/components/projects/create-wizard/phases/Phase3TeamRoles.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 151 | Project lead | Owner | Role wording (Owner/Admin) |
| 152 | You are the project lead. Add a focus area if it helps collaborators understand how you will guide the work. | You are the owner. Add a focus area if it helps members understand how you will guide the work. | Role wording (Owner/Admin) |
| 174 | Optional. This appears with your lead role in the project summary. | Optional. This appears with your lead role in the workspace summary. | Role wording (Owner/Admin) |
| 198 | You can create the project without recruiting. Add roles here when you know what help the work needs. | You can create the workspace without recruiting. Add roles here when you know what help the work needs. |  |

### `src/components/projects/create-wizard/phases/Phase4Settings.tsx` (25)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 36 | Project picture | Workspace picture |  |
| 36 | Project picture | Workspace picture |  |
| 144 | Finish adding the project link or clear the URL before continuing. | Finish adding the workspace link or clear the URL before continuing. |  |
| 270 | Set up how the project launches | Set up how the workspace launches |  |
| 271 | Every choice has a sensible default and can be changed later in Project settings. | Every choice has a sensible default and can be changed later in Workspace settings. |  |
| 274 | Organization projects | Organization workspaces |  |
| 281 | Finish the project links before continuing | Finish the workspace links before continuing |  |
| 309 | Project picture | Workspace picture |  |
| 309 | Shown on project cards, search, and the project header. | Shown on workspace cards, search, and the workspace header. |  |
| 312 | Selected project picture | Selected workspace picture |  |
| 323 | Choose project visibility | Choose workspace visibility |  |
| 323 | Controls who can find the project now, and which tabs outsiders see. | Controls who can find the workspace now, and which tabs outsiders see. |  |
| 325 | Project visibility | Workspace visibility |  |
| 328 | Anyone can discover the project and view its public tabs. | Anyone can discover the workspace and view its public tabs. |  |
| 333 | Anyone can discover the project and view its public tabs. | Anyone can discover the workspace and view its public tabs. |  |
| 334 | Only collaborators can access the project until you make it public. | Only members can access the workspace until you make it public. |  |
| 378 | Project title and card only | Workspace title and card only |  |
| 379 | Collaborators only. Public-tab choices take effect after you make the project public. | Members only. Public-tab choices take effect after you make the workspace public. |  |
| 383 | Project links | Workspace links |  |
| 383 | Website, repository, demo, or community. Shown beside the project title and across public surfaces. | Website, repository, demo, or community. Shown beside the workspace title and across public surfaces. | Check: may mean the repository |
| 396 | The project Doc tab: setup notes, guidance, and how to contribute. | The workspace Doc tab: setup notes, guidance, and how to contribute. |  |
| 407 | Off keeps editing to project leaders. | Off keeps editing to workspace leaders. |  |
| 428 | Where the project's files come from and who can add more. | Where the workspace's files come from and who can add more. |  |
| 447 | Project-wide notification rules. Each member can still tune their own. | Workspace-wide notification rules. Each member can still tune their own. |  |
| 457 | After creation, in Project settings: team members and invites, privacy policies, and the danger zone. | After creation, in Workspace settings: team members and invites, privacy policies, and the danger zone. |  |

### `src/components/projects/create-wizard/phases/Phase5Review.tsx` (22)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 81 | A new project will be created without imported files. | A new workspace will be created without imported files. |  |
| 91 | The selected local project files will be uploaded after creation. | The selected local workspace files will be uploaded after creation. |  |
| 152 | Untitled project | Untitled workspace |  |
| 202 | Confirm what collaborators will see at launch. Use Edit to return to the relevant phase; the project is created only when you choose Create project in the footer. | Confirm what members will see at launch. Use Edit to return to the relevant phase; the workspace is created only when you choose Create workspace in the footer. |  |
| 242 | Project details | Workspace details |  |
| 243 | Project title | Workspace title |  |
| 244 | Untitled project | Untitled workspace |  |
| 258 | &apos;s owner and admins can see and help with this project. | &apos;s owner and admins can see and help with this workspace. |  |
| 271 | Admins create projects | Admins create workspaces |  |
| 271 | All members create projects | All members create workspaces |  |
| 315 | Project lead | Owner | Role wording (Owner/Admin) |
| 342 | Project picture | Workspace picture |  |
| 346 | Private project | Private workspace |  |
| 346 | Public project | Public workspace |  |
| 349 | Only collaborators can access the project at launch. | Only members can access the workspace at launch. |  |
| 353 | Project links | Workspace links |  |
| 358 | Project link | Workspace link |  |
| 374 | No project links added. | No workspace links added. |  |
| 383 | Project journey | Workspace journey |  |
| 411 | Nothing has been created yet. Create the project only when you select Create project in the footer. | Nothing has been created yet. Create the workspace only when you select Create workspace in the footer. |  |
| 416 | Project card preview | Workspace card preview |  |
| 425 | This is how your project card will appear in Discover and search results. | This is how your workspace card will appear in Discover and search results. |  |

### `src/components/projects/create-wizard/useCreateProjectWizard.ts` (9)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 594 | Finish adding the project link or clear the URL before continuing. | Finish adding the workspace link or clear the URL before continuing. |  |
| 649 | Creating project… | Creating workspace… |  |
| 653 | Project created | Workspace created |  |
| 763 | Project creation did not return a project ID. | Workspace creation did not return a workspace ID. |  |
| 955 | Project & files ready | Workspace & files ready |  |
| 955 | Project created | Workspace created |  |
| 981 | Create as a personal project | Create as a personal workspace |  |
| 991 | Failed to create project | Failed to create workspace |  |
| 991 | Failed to create project | Failed to create workspace |  |

### `src/components/projects/dashboard/InviteCollaboratorModal.tsx` (13)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 106 | You already have a pending application for this project. Nothing was changed. | You already have a pending application for this workspace. Nothing was changed. |  |
| 324 | Failed to load project options | Failed to load workspace options |  |
| 344 | Failed to load project options | Failed to load workspace options |  |
| 511 | Select a project first | Select a workspace first |  |
| 517 | This project already has an active Guide | This workspace already has an active Guide |  |
| 559 | The project's reviewers have been told. | The workspace's reviewers have been told. |  |
| 595 | Choose a project to apply to. | Choose a workspace to apply to. |  |
| 602 | Select project | Select workspace |  |
| 606 | Available projects | Available workspaces |  |
| 616 | No eligible projects available. | No eligible workspaces available. |  |
| 650 | is already active on this project. | is already active on this workspace. |  |
| 650 | On acceptance, this appointment uses the project’s existing Co-leader access. | On acceptance, this appointment uses the workspace’s existing Admin access. | Role wording (Owner/Admin) |
| 769 | Submitting opens a private conversation with the project\u2019s reviewers (its owner and admins). They are notified, and their answer shows up there and in your notifications. | Submitting opens a private conversation with the workspace\u2019s reviewers (its owner and admins). They are notified, and their answer shows up there and in your notifications. |  |

### `src/components/projects/dashboard/JourneyTimeline.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 146 | Project journey stages | Workspace journey stages |  |
| 151 | Project journey stages | Workspace journey stages |  |

### `src/components/projects/dashboard/OpenRolesCard.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 140 | Open project chat | Open workspace chat |  |
| 168 | Leadership appointment for this project. | Leadership appointment for this workspace. |  |

### `src/components/projects/dashboard/ProjectDashboardClient.tsx` (14)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 613 | That project tab is not visible for your current access. | That workspace tab is not visible for your current access. |  |
| 811 | Following project | Following workspace |  |
| 811 | Unfollowed project | Unfollowed workspace |  |
| 929 | Project members cannot apply for an additional role | Workspace members cannot apply for an additional role |  |
| 941 | You have an invitation to this project. Accept or decline it first. | You have an invitation to this workspace. Accept or decline it first. |  |
| 1039 | Failed to update project stage | Failed to update workspace stage |  |
| 1039 | Failed to update project stage | Failed to update workspace stage |  |
| 1056 | Only the project owner can advance the stage | Only the workspace owner can advance the stage |  |
| 1056 | Only the project owner can revert the stage | Only the workspace owner can revert the stage |  |
| 1056 | Only the project owner can revert the stage | Only the workspace owner can revert the stage |  |
| 1064 | Project is already at the starting stage | Workspace is already at the starting stage |  |
| 1068 | Project is already at the final stage | Workspace is already at the final stage |  |
| 1128 | This tab is not visible to public visitors or has been restricted by the project leaders. | This tab is not visible to public visitors or has been restricted by the workspace leaders. |  |
| 1157 | Projects | Workspaces |  |

### `src/components/projects/dashboard/ProjectLayout.tsx` (19)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 84 | Projects | Workspaces |  |
| 261 | nb-project-identity flex flex-wrap items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6 max-md:gap-3 max-md:pt-4 | nb-workspace-identity flex flex-wrap items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6 max-md:gap-3 max-md:pt-4 |  |
| 356 | Add project avatar | Add workspace avatar |  |
| 357 | Add project avatar | Add workspace avatar |  |
| 387 | Invite a project member | Invite a workspace member |  |
| 388 | Invite a project member | Invite a workspace member |  |
| 406 | Unfollow project | Unfollow workspace |  |
| 406 | Follow project | Follow workspace |  |
| 407 | Unfollow project | Unfollow workspace |  |
| 407 | Follow project | Follow workspace |  |
| 428 | Share project | Share workspace |  |
| 429 | Share project | Share workspace |  |
| 451 | Project actions | Workspace actions |  |
| 459 | Unfollow project | Unfollow workspace |  |
| 459 | Follow project | Follow workspace |  |
| 470 | Share project | Share workspace |  |
| 474 | Project overview | Workspace overview |  |
| 493 | Project sections | Workspace sections |  |
| 549 | flex h-[calc(100dvh-var(--ui-topnav-height)-var(--project-tabs-height))] min-h-[28rem] w-full flex-col overflow-hidden max-md:h-[calc(100dvh-var(--ui-topnav-height)-var(--project-tabs-height)-3rem)] max-md:min-h-0 | flex h-[calc(100dvh-var(--ui-topnav-height)-var(--workspace-tabs-height))] min-h-[28rem] w-full flex-col overflow-hidden max-md:h-[calc(100dvh-var(--ui-topnav-height)-var(--workspace-tabs-height)-3rem)] max-md:min-h-0 |  |

### `src/components/projects/dashboard/ProjectOverviewCard.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 95 | No project details yet | No workspace details yet |  |
| 96 | This project has not added an overview, description, or statement yet. | This workspace has not added an overview, description, or statement yet. |  |
| 103 | Edit project details | Edit workspace details |  |

### `src/components/projects/dashboard/ProjectSocialLinksCard.tsx` (17)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 109 | Open {…} project link{…} | Open {…} workspace link{…} |  |
| 109 | Open {…} more project link{…} | Open {…} more workspace link{…} |  |
| 325 | This project link is already present. | This workspace link is already present. |  |
| 446 | project link | workspace link |  |
| 492 | Project link | Workspace link |  |
| 495 | Paste or drop one or several URLs. They are staged immediately and saved when you create the project. | Paste or drop one or several URLs. They are staged immediately and saved when you create the workspace. |  |
| 545 | Project members only | Workspace members only |  |
| 630 | Project links saved | Workspace links saved |  |
| 632 | Unable to save project links. Your changes are retained. | Unable to save workspace links. Your changes are retained. |  |
| 639 | Discard your unsaved project link changes? | Discard your unsaved workspace link changes? |  |
| 679 | You have unsaved changes in project links ({…} pending). | You have unsaved changes in workspace links ({…} pending). |  |
| 680 | All project links are saved. | All workspace links are saved. |  |
| 722 | Project links | Workspace links |  |
| 782 | Project links | Workspace links |  |
| 797 | Manage project links | Manage workspace links |  |
| 801 | Manage project links | Manage workspace links |  |
| 801 | Add project link | Add workspace link |  |

### `src/components/projects/dashboard/ProjectTeamAvatars.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 101 | Loading project team | Loading workspace team |  |
| 117 | {…} project team {…} | {…} workspace team {…} |  |

### `src/components/projects/doc/ProjectDocRail.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 125 | Project documents | Workspace documents |  |

### `src/components/projects/doc/ProjectDocReferencePreview.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 21 | Project reference | Workspace reference |  |

### `src/components/projects/doc/ProjectDocRenderer.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 211 | Project reference | Workspace reference |  |

### `src/components/projects/doc/ProjectDocSmartBlock.tsx` (7)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 16 | Role needs and application context from the project. | Role needs and application context from the workspace. |  |
| 22 | Active project contributors and collaborators. | Active workspace contributors and members. |  |
| 34 | Project work items linked from the Doc. | Workspace work items linked from the Doc. |  |
| 43 | Projects | Workspaces |  |
| 46 | Projects inside this organization, live. | Workspaces inside this organization, live. |  |
| 98 | Open the project surface for current items | Open the workspace surface for current items |  |
| 102 | Open the organization's projects | Open the organization's workspaces |  |

### `src/components/projects/settings/CollaboratorCard.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 45 | Project group | Workspace group |  |
| 185 | Project Lead | Owner | Role wording (Owner/Admin) |

### `src/components/projects/settings/FileWorkspaceMembers.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 108 | loaded · Totals include everyone on the project | loaded · Totals include everyone on the workspace |  |
| 239 | Applies to all {…} project members, including people outside the current filter or loaded pages, and changes the default for future members. Leaders remain enabled and viewers remain read-only. | Applies to all {…} workspace members, including people outside the current filter or loaded pages, and changes the default for future members. Leaders remain enabled and viewers remain read-only. |  |

### `src/components/projects/settings/GeneralSettingsSection.tsx` (25)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 331 | Failed to update project identity. | Failed to update workspace identity. |  |
| 480 | Project avatar optimized and updated. | Workspace avatar optimized and updated. |  |
| 480 | Project avatar updated. | Workspace avatar updated. |  |
| 488 | Failed to upload project avatar. | Failed to upload workspace avatar. |  |
| 488 | Failed to upload project avatar. | Failed to upload workspace avatar. |  |
| 510 | Failed to remove project avatar | Failed to remove workspace avatar |  |
| 513 | Project avatar removed. | Workspace avatar removed. |  |
| 521 | Failed to remove project avatar. | Failed to remove workspace avatar. |  |
| 521 | Failed to remove project avatar. | Failed to remove workspace avatar. |  |
| 532 | Manage your project’s avatar, public identity, tags, and skills. | Manage your workspace’s avatar, public identity, tags, and skills. |  |
| 560 | Project avatar | Workspace avatar |  |
| 562 | Square avatar displayed on project cards, header, and link previews. | Square avatar displayed on workspace cards, header, and link previews. |  |
| 761 | Project identity | Workspace identity |  |
| 762 | These public fields update project headers, cards, search, notifications, and project links that render project copy. | These public fields update workspace headers, cards, search, notifications, and workspace links that render workspace copy. |  |
| 772 | Project name is required. | Workspace name is required. |  |
| 773 | Project name | Workspace name |  |
| 777 | Project name | Workspace name |  |
| 783 | A one-line project summary for cards and search previews (recommended under 160 characters). | A one-line workspace summary for cards and search previews (recommended under 160 characters). |  |
| 786 | A one-line project summary | A one-line workspace summary |  |
| 792 | Detailed overview explaining what this project does and why it matters. | Detailed overview explaining what this workspace does and why it matters. |  |
| 795 | Describe what this project does and why it matters | Describe what this workspace does and why it matters |  |
| 804 | Primary category to help builders discover your project. | Primary category to help builders discover your workspace. |  |
| 812 | Select the technologies and professional disciplines associated with this project. | Select the technologies and professional disciplines associated with this workspace. |  |
| 860 | Project skills and technologies | Workspace skills and technologies |  |
| 861 | Select the technologies and professional skills used by this project (up to 12 skills). | Select the technologies and professional skills used by this workspace (up to 12 skills). |  |

### `src/components/projects/settings/LifecycleSettingsEditor.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 66 | Project lifecycle | Workspace lifecycle |  |
| 67 | Define the journey stages used by the project dashboard, roadmap, and milestone tracking. | Define the journey stages used by the workspace dashboard, roadmap, and milestone tracking. |  |
| 122 | Stages define the progression milestones shown on your project overview and roadmap. As your team completes deliverables, project leads can advance through these stages directly from the project dashboard header. | Stages define the progression milestones shown on your workspace overview and roadmap. As your team completes deliverables, workspace leads can advance through these stages directly from the workspace dashboard header. |  |

### `src/components/projects/settings/MemberNotificationSettingsEditor.tsx` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 77 | Member preferences can reduce optional project noise. Locked responsibility and security notifications stay enabled. | Member preferences can reduce optional workspace noise. Locked responsibility and security notifications stay enabled. |  |
| 82 | Use project defaults | Use workspace defaults |  |
| 128 | This member inherits the project-level policy. Changes to project defaults will automatically apply to optional triggers. | This member inherits the workspace-level policy. Changes to workspace defaults will automatically apply to optional triggers. |  |
| 140 | Reset to project defaults | Reset to workspace defaults |  |
| 190 | Disabled by project defaults. | Disabled by workspace defaults. |  |
| 193 | Managed by project policy. | Managed by workspace policy. |  |

### `src/components/projects/settings/ProjectDangerModals.tsx` (13)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 62 | Unarchive project | Unarchive workspace |  |
| 62 | Archive project | Archive workspace |  |
| 76 | Restore active collaboration, intake, notifications, and publishing on this project. | Restore active collaboration, intake, notifications, and publishing on this workspace. |  |
| 77 | Archive marks this project as read-only. Existing members keep safe access for historical context. | Archive marks this workspace as read-only. Existing members keep safe access for historical context. |  |
| 144 | Unarchive project | Unarchive workspace |  |
| 144 | Archive project | Archive workspace |  |
| 206 | Transfer project ownership | Transfer workspace ownership |  |
| 219 | &rdquo;. This action permanently changes project control. | &rdquo;. This action permanently changes workspace control. |  |
| 264 | will gain full Owner control over project visibility, team roster, settings, and deletion. | will gain full Owner control over workspace visibility, team roster, settings, and deletion. |  |
| 376 | Delete project permanently | Delete workspace permanently |  |
| 401 | Once confirmed, this project is purged immediately. Cloud S3 files, task records, sprint data, and member permissions cannot be recovered or restored. | Once confirmed, this workspace is purged immediately. Cloud S3 files, task records, sprint data, and member permissions cannot be recovered or restored. |  |
| 429 | Project documents, update announcements, and comments | Workspace documents, update announcements, and comments |  |
| 477 | Delete project permanently | Delete workspace permanently |  |

### `src/components/projects/settings/ProjectRolesEditor.tsx` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 245 | Project Roles & Team Assignments | Workspace Roles & Team Assignments |  |
| 443 | Project Lead | Owner | Role wording (Owner/Admin) |
| 456 | Joined project | Joined workspace |  |
| 700 | Preview how candidates see this vacancy on the public project page. | Preview how candidates see this vacancy on the public workspace page. |  |
| 760 | {…} accepted {…} their place on the project. | {…} accepted {…} their place on the workspace. |  |

### `src/components/projects/settings/ProjectSettingsNavigation.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 64 | Project settings sections | Workspace settings sections |  |
| 99 | Project settings navigation | Workspace settings navigation |  |
| 103 | Project settings | Workspace settings |  |
| 115 | Project settings | Workspace settings |  |

### `src/components/projects/settings/SettingsFormFields.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 152 | Project slug | Workspace slug |  |
| 157 | Project links use this slug. Editing is locked for now to avoid broken links and stale share previews. | Workspace links use this slug. Editing is locked for now to avoid broken links and stale share previews. |  |

### `src/components/projects/settings/TaskCompletionSettings.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 51 | Choose whether completed work needs a project lead’s approval. | Choose whether completed work needs a owner’s approval. | Role wording (Owner/Admin) |
| 82 | Off: marking a task as done completes it immediately. On: it enters In review until a project owner or co-leader approves it. | Off: marking a task as done completes it immediately. On: it enters In review until a workspace owner or admin approves it. | Role wording (Owner/Admin) |

### `src/components/projects/tabs/DashboardTab.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 48 | calc(var(--project-tabs-height, 0px) + 24px) | calc(var(--workspace-tabs-height, 0px) + 24px) |  |
| 57 | Project details | Workspace details |  |

### `src/components/projects/tabs/DocTab.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 42 | This organization doc is not shared with this project. | This organization doc is not shared with this workspace. |  |
| 133 | This project has no docs visible to you. | This workspace has no docs visible to you. |  |

### `src/components/projects/tabs/ProjectSettingsTab.tsx` (61)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 143 | Anyone can discover and view the public project surface. | Anyone can discover and view the public workspace surface. |  |
| 144 | Best for open collaboration, public updates, and shareable project profiles. | Best for open collaboration, public updates, and shareable workspace profiles. |  |
| 149 | Only the owner and approved members can view project content. | Only the owner and approved members can view workspace content. |  |
| 228 | The organization this project belongs to, and its rules. | The organization this workspace belongs to, and its rules. |  |
| 569 | Failed to load project notification settings. | Failed to load workspace notification settings. |  |
| 679 | Failed to update project roles. | Failed to update workspace roles. |  |
| 688 | Project roles updated. | Workspace roles updated. |  |
| 692 | Failed to update project roles. | Failed to update workspace roles. |  |
| 692 | Failed to update project roles. | Failed to update workspace roles. |  |
| 748 | Make project private | Make workspace private |  |
| 748 | Make project public | Make workspace public |  |
| 890 | Project notification settings updated. | Workspace notification settings updated. |  |
| 893 | Failed to save project notification settings. | Failed to save workspace notification settings. |  |
| 943 | Project notification settings reset. | Workspace notification settings reset. |  |
| 946 | Failed to reset project notification settings. | Failed to reset workspace notification settings. |  |
| 958 | Review {…}'s project notification preferences. | Review {…}'s workspace notification preferences. |  |
| 1117 | Failed to archive project. | Failed to archive workspace. |  |
| 1137 | Project ownership transferred successfully. | Workspace ownership transferred successfully. |  |
| 1152 | Project is already archived. | Workspace is already archived. |  |
| 1192 | {…} will move from {…} to {…}. This updates collaborator permissions, task/file access, application review affordances, notifications, and project audit history. | {…} will move from {…} to {…}. This updates member permissions, task/file access, application review affordances, notifications, and workspace audit history. |  |
| 1270 | Failed to delete project. | Failed to delete workspace. |  |
| 1282 | Project cannot be deleted. | Workspace cannot be deleted. |  |
| 1320 | Keep active assignments in place and label them Removed from project · Needs reassignment. | Keep active assignments in place and label them Removed from workspace · Needs reassignment. |  |
| 1399 | Project links | Workspace links |  |
| 1401 | External project destinations and connected repositories displayed beside the project title and across public surfaces. | External workspace destinations and connected repositories displayed beside the workspace title and across public surfaces. | Keep “project”: external |
| 1422 | Project access & visibility | Workspace access & visibility |  |
| 1424 | This one owner-controlled policy is used by project cards, detail pages, search, files, applications, notifications, and public surfaces. | This one owner-controlled policy is used by workspace cards, detail pages, search, files, applications, notifications, and public surfaces. |  |
| 1429 | Project visibility | Workspace visibility |  |
| 1431 | Control whether this project is discoverable across the platform or restricted to workspace collaborators. | Control whether this workspace is discoverable across the platform or restricted to workspace members. |  |
| 1440 | Project visibility | Workspace visibility |  |
| 1470 | Visibility is managed by the project lead | Visibility is managed by the owner | Role wording (Owner/Admin) |
| 1472 | This project is currently | This workspace is currently |  |
| 1472 | . Only the project owner can change visibility. | . Only the workspace owner can change visibility. |  |
| 1482 | Choose which project tabs public visitors can see. Members, leaders, and Co-leaders keep access to their workspace tabs. | Choose which workspace tabs public visitors can see. Members, leaders, and Admins keep access to their workspace tabs. |  |
| 1492 | Defaults are Dashboard, Docs, Updates, and Files on; Sprints and Tasks off. If the project is Private, these settings are saved but only apply after the project becomes Public again. | Defaults are Dashboard, Docs, Updates, and Files on; Sprints and Tasks off. If the workspace is Private, these settings are saved but only apply after the workspace becomes Public again. |  |
| 1511 | Manage project leadership, team members, roles, and permissions in one place. | Manage workspace leadership, team members, roles, and permissions in one place. |  |
| 1572 | Project Leadership | Workspace Leadership |  |
| 1620 | Promote a trusted member to co-leader when they need full project workflow permissions without receiving destructive lead actions. | Promote a trusted member to admin when they need full workspace workflow permissions without receiving destructive lead actions. | Role wording (Owner/Admin) |
| 1715 | Project roles | Workspace roles |  |
| 1727 | You have unsaved changes in project roles. | You have unsaved changes in workspace roles. |  |
| 1728 | All project roles are saved. | All workspace roles are saved. |  |
| 1787 | Allow embedding externally hosted images in documentation. Keep this disabled for private or sensitive projects to prevent tracking pixels and referrer leaks. | Allow embedding externally hosted images in documentation. Keep this disabled for private or sensitive workspaces to prevent tracking pixels and referrer leaks. |  |
| 1829 | Project updates | Workspace updates |  |
| 1831 | Configure member publishing permissions and broadcast settings for project progress updates. | Configure member publishing permissions and broadcast settings for workspace progress updates. |  |
| 1847 | When enabled, all verified project members can author and publish progress updates. When disabled, update authoring is restricted exclusively to the Project Owner and Co-leaders. | When enabled, all verified workspace members can author and publish progress updates. When disabled, update authoring is restricted exclusively to the Workspace Owner and Admins. |  |
| 1881 | Manage task completion and your project’s lifecycle stages. | Manage task completion and your workspace’s lifecycle stages. |  |
| 1982 | Project notification policy | Workspace notification policy |  |
| 1985 | Configure workflow event triggers and delivery rules for your project. Critical responsibility and safety events stay locked on. | Configure workflow event triggers and delivery rules for your workspace. Critical responsibility and safety events stay locked on. |  |
| 2071 | These agreements and data rights apply to your signed-in account, not everyone on this project. | These agreements and data rights apply to your signed-in account, not everyone on this workspace. |  |
| 2081 | Irreversible and sensitive project operations. Archive to preserve read-only history, transfer ownership to a team member, or permanently delete. | Irreversible and sensitive workspace operations. Archive to preserve read-only history, transfer ownership to a team member, or permanently delete. |  |
| 2119 | Archive this project | Archive this workspace |  |
| 2129 | This project is currently archived and in read-only mode. Existing members retain historical access to all records. | This workspace is currently archived and in read-only mode. Existing members retain historical access to all records. |  |
| 2130 | Mark this project as read-only. Existing members keep historical access, but tasks, intake, and publishing are paused. | Mark this workspace as read-only. Existing members keep historical access, but tasks, intake, and publishing are paused. |  |
| 2146 | Archive project | Archive workspace |  |
| 2166 | Transfer primary ownership and administrative authority of this project to an existing team member. You will become an administrator and surrender destructive management privileges. | Transfer primary ownership and administrative authority of this workspace to an existing team member. You will become an administrator and surrender destructive management privileges. |  |
| 2227 | Only the current project owner can transfer ownership. | Only the current workspace owner can transfer ownership. |  |
| 2231 | Add at least one team member to this project before ownership can be transferred. | Add at least one team member to this workspace before ownership can be transferred. |  |
| 2242 | Delete this project | Delete this workspace |  |
| 2251 | Permanently delete this project and all associated workspaces, tasks, documents, and discussions. Once deleted, this action cannot be recovered. | Permanently delete this workspace and all associated workspaces, tasks, documents, and discussions. Once deleted, this action cannot be recovered. |  |
| 2260 | Only the project owner can delete this project. | Only the workspace owner can delete this workspace. |  |
| 2272 | Delete project | Delete workspace |  |

### `src/components/projects/tabs/SprintPlanning.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 340 | You do not have permission to view sprints for this project. | You do not have permission to view sprints for this workspace. |  |
| 361 | No sprints have been planned yet. Sprints created by project leads will appear here. | No sprints have been planned yet. Sprints created by workspace leads will appear here. |  |

### `src/components/projects/tabs/UpdatesTab.tsx` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 119 | Failed to load project updates | Failed to load workspace updates |  |
| 428 | Project update posted | Workspace update posted |  |
| 465 | Follow this project to get notified when the team shares progress. | Follow this workspace to get notified when the team shares progress. |  |
| 517 | Project feed | Workspace feed |  |
| 520 | Progress posts for followers and project visitors. | Progress posts for followers and workspace visitors. |  |

### `src/components/projects/tabs/sprint/SprintTimelineContent.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 157 | /projects/{…}?{…} : {}), }).toString()} | /workspaces/{…}?{…} : {}), }).toString()} |  |

### `src/components/projects/updates/ComposerReferenceOptions.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 91 | No matching project context. | No matching workspace context. |  |

### `src/components/projects/updates/ProjectUpdateComposer.tsx` (10)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 115 | Project update image | Workspace update image |  |
| 736 | Connect this post to active project work. | Connect this post to active workspace work. |  |
| 738 | Connect this post to active project work. | Connect this post to active workspace work. |  |
| 739 | Connect this post to active project work. | Connect this post to active workspace work. |  |
| 755 | Could not load project context. | Could not load workspace context. |  |
| 915 | Share a project update for {…}... | Share a workspace update for {…}... |  |
| 930 | Project members | Workspace members |  |
| 936 | Share a project update for {…}... | Share a workspace update for {…}... |  |
| 981 | Project update image | Workspace update image |  |
| 1097 | Project file | Workspace file |  |

### `src/components/projects/updates/ProjectUpdateLikersModal.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 118 | List of members who liked this project update | List of members who liked this workspace update |  |

### `src/components/projects/updates/ProjectUpdateMediaFrame.tsx` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 136 | Project update media | Workspace update media |  |
| 165 | Open project update media | Open workspace update media |  |
| 198 | Project update media | Workspace update media |  |
| 208 | Project update media preview. | Workspace update media preview. |  |
| 229 | Project update media | Workspace update media |  |

### `src/components/projects/updates/UpdateContent.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 201 | Project update image | Workspace update image |  |

### `src/components/projects/updates/UpdatesRightRail.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 92 | Project members will appear here after their first post. | Workspace members will appear here after their first post. |  |

### `src/components/projects/v2/TasksTab.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 737 | Completion workflow unavailable; the server will apply the current project setting. | Completion workflow unavailable; the server will apply the current workspace setting. |  |
| 737 | Marking work as done submits it for review. A project lead approves completion. | Marking work as done submits it for review. A owner approves completion. | Role wording (Owner/Admin) |

### `src/components/projects/v2/explorer/ExplorerContextMenu.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 136 | Project | Workspace |  |

### `src/components/projects/v2/explorer/ExplorerDialogsHost.tsx` (7)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 404 | Search project folders | Search workspace folders |  |
| 405 | Search project folders | Search workspace folders |  |
| 449 | Project root | Workspace root |  |
| 464 | Project root | Workspace root |  |
| 505 | Project root | Workspace root |  |
| 841 | Choose where this task working file should become available in Project Files. Its task role is unchanged. | Choose where this task working file should become available in Workspace Files. Its task role is unchanged. |  |
| 842 | Choose a new location in Project Files. Task role and final-deliverable status are unchanged. | Choose a new location in Workspace Files. Task role and final-deliverable status are unchanged. |  |

### `src/components/projects/v2/explorer/ExplorerTree.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 217 | You don't have permission to view this project's files. | You don't have permission to view this workspace's files. |  |

### `src/components/projects/v2/explorer/FileTreeItem.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 82 | Project | Workspace |  |

### `src/components/projects/v2/explorer/useExplorerMutations.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 767 | Project Files | Workspace Files |  |
| 768 | Project Files | Workspace Files |  |

### `src/components/projects/v2/files-tab/FilesTabSidebar.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 488 | Project | Workspace |  |

### `src/components/projects/v2/files-tab/FilesWorkspaceHeader.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 112 | Project files | Workspace files |  |
| 399 | Review selected project files before publishing to GitHub or importing changes. Task drafts and Trash are excluded. GitHub permissions and project membership remain separate. | Review selected workspace files before publishing to GitHub or importing changes. Task drafts and Trash are excluded. GitHub permissions and workspace membership remain separate. | Check: may mean the repository |
| 401 | Project files are stored in folders. Search finds accessible filenames across the project, not just the currently loaded rows. Upload and New use the open folder. | Workspace files are stored in folders. Search finds accessible filenames across the workspace, not just the currently loaded rows. Upload and New use the open folder. |  |

### `src/components/projects/v2/files-tab/FilesWorkspaceViews.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 40 | Project files | Workspace files |  |

### `src/components/projects/v2/files-tab/GitHubSyncWorkspace.tsx` (17)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 155 | Project | Workspace |  |
| 186 | Update project files from NetworkBase | Update workspace files from NetworkBase |  |
| 1974 | Choose the files to import into project files. | Choose the files to import into workspace files. |  |
| 1983 | Project files match the reviewed GitHub branch. | Workspace files match the reviewed GitHub branch. | Check: may mean the repository |
| 2073 | latest project-file revision | latest workspace-file revision |  |
| 2346 | Deleted project files move to Trash. | Deleted workspace files move to Trash. |  |
| 2425 | Importing into project files | Importing into workspace files |  |
| 2562 | . Project files and the target branch may still differ until the PR is merged. | . Workspace files and the target branch may still differ until the PR is merged. |  |
| 2628 | imports were recorded. Those project changes remain. A safe retry skips recorded files; a changed baseline requires a fresh comparison. | imports were recorded. Those workspace changes remain. A safe retry skips recorded files; a changed baseline requires a fresh comparison. |  |
| 2817 | Disconnecting stops future synchronization. It does not delete project files or the GitHub repository. | Disconnecting stops future synchronization. It does not delete workspace files or the GitHub repository. | Check: may mean the repository |
| 3080 | Project files and the GitHub repository are kept. Unsubmitted reviews will be cancelled; running operations must finish first. | Workspace files and the GitHub repository are kept. Unsubmitted reviews will be cancelled; running operations must finish first. | Check: may mean the repository |
| 3170 | Recorded operations and retained results for this project. | Recorded operations and retained results for this workspace. |  |
| 3242 | NetworkBase project file | NetworkBase workspace file |  |
| 3303 | Only the project owner can configure or run transfers. | Only the workspace owner can configure or run transfers. |  |
| 3307 | You can configure your own commit attribution. Connecting or transferring project files requires the project owner. | You can configure your own commit attribution. Connecting or transferring workspace files requires the workspace owner. |  |
| 3323 | Your project files have not changed. | Your workspace files have not changed. |  |
| 3369 | Reading the branch and project file revisions. Keep this page open until the comparison returns. | Reading the branch and workspace file revisions. Keep this page open until the comparison returns. |  |

### `src/components/projects/v2/files-tab/IdeProjectPicker.tsx` (14)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 39 | Couldn't load your projects. | Couldn't load your workspaces. |  |
| 86 | Choose a project | Choose a workspace |  |
| 88 | Open a NetworkBase project in | Open a NetworkBase workspace in |  |
| 95 | Search projects | Search workspaces |  |
| 96 | Search projects… | Search workspaces… |  |
| 104 | Sign in to open your projects. | Sign in to open your workspaces. |  |
| 109 | Loading projects | Loading workspaces |  |
| 118 | Couldn&apos;t load your projects. | Couldn&apos;t load your workspaces. |  |
| 155 | No matching projects. Load more or try another name. | No matching workspaces. Load more or try another name. |  |
| 156 | No matching projects. Try another name. | No matching workspaces. Try another name. |  |
| 157 | Join or create a project to open it in your editor. | Join or create a workspace to open it in your editor. |  |
| 170 | Loading projects… | Loading workspaces… |  |
| 171 | Load more projects | Load more workspaces |  |
| 176 | Couldn&apos;t load more projects. Try again. | Couldn&apos;t load more workspaces. Try again. |  |

### `src/components/projects/v2/files-tab/OpenInIdeButton.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 305 | Open your project or task in your connected editor. | Open your workspace or task in your connected editor. |  |

### `src/components/projects/v2/files-tab/TaskFilesCollection.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 993 | Project Root | Workspace Root |  |

### `src/components/projects/v2/files-tab/TrashFilesCollection.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 60 | Project files | Workspace files |  |

### `src/components/projects/v2/files-tab/breadcrumb/BreadcrumbBar.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 111 | Project files | Workspace files |  |

### `src/components/projects/v2/files-tab/folder/FolderListView.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 1262 | Categorize into project files, task references, or file versions | Categorize into workspace files, task references, or file versions |  |
| 1277 | Project Root | Workspace Root |  |
| 1278 | Project Root | Workspace Root |  |

### `src/components/projects/v2/files-tab/github-sync/SyncPrimitives.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 128 | / Project files | / Workspace files |  |

### `src/components/projects/v2/files-tab/picker/TaskSearchPicker.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 294 | No tasks in this project yet. | No tasks in this workspace yet. |  |

### `src/components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 216 | Project files | Workspace files |  |
| 244 | Project files | Workspace files |  |
| 258 | Search all project files… | Search all workspace files… |  |

### `src/components/projects/v2/files-tab/quick-open/QuickOpenDialog.tsx` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 275 | Search project files | Search workspace files |  |
| 291 | Search filenames across the project… | Search filenames across the workspace… |  |
| 292 | Search project files | Search workspace files |  |
| 325 | Searching the full project… | Searching the full workspace… |  |

### `src/components/projects/v2/files-tab/upload/FilesTabUploadModal.tsx` (9)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 112 | Project Root | Workspace Root |  |
| 241 | Project root | Workspace root |  |
| 509 | Select the destination folder for these project files. | Select the destination folder for these workspace files. |  |
| 639 | You can save this upload directly as a new version or choose to place it as a separate project file. | You can save this upload directly as a new version or choose to place it as a separate workspace file. |  |
| 673 | Project Files | Workspace Files |  |
| 682 | . Click to browse project tree. | . Click to browse workspace tree. |  |
| 896 | Search project tasks to link… | Search workspace tasks to link… |  |
| 946 | Project Files | Workspace Files |  |
| 1009 | Search project task for this deliverable… | Search workspace task for this deliverable… |  |

### `src/components/projects/v2/sprints/CreateSprintModal.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 444 | Show in child projects | Show in workspaces in the organization | Organization context |
| 449 | Create a matching sprint in every child project | Create a matching sprint in every workspace in the organization | Organization context |

### `src/components/projects/v2/tasks/CreateTaskModal.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 375 | Only the project owner can add tasks to a sprint. | Only the workspace owner can add tasks to a sprint. |  |

### `src/components/projects/v2/tasks/TaskCard.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 241 | {…} was removed from the project | {…} was removed from the workspace |  |

### `src/components/projects/v2/tasks/TaskDetailPanel.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 621 | on tasks are visible to project members. | on tasks are visible to workspace members. |  |
| 721 | The task is removed from the board. Its working files move to a “Recovered task files” folder in Project Files. | The task is removed from the board. Its working files move to a “Recovered task files” folder in Workspace Files. |  |

### `src/components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 315 | Waiting for a project lead’s approval. Approving completes this task; file publication remains separate. | Waiting for a owner’s approval. Approving completes this task; file publication remains separate. | Role wording (Owner/Admin) |
| 881 | Removed from project · Needs reassignment | Removed from workspace · Needs reassignment |  |

### `src/components/projects/v2/tasks/components/MentionAutocomplete.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 122 | No teammates found on this project. | No teammates found on this workspace. |  |

### `src/components/projects/v2/tasks/components/TaskFileRow.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 387 | Move in Project Files | Move in Workspace Files |  |
| 399 | Publish to Project Files | Publish to Workspace Files |  |

### `src/components/projects/v2/tasks/components/TaskFileUploadModal.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 199 | The completed output of this task. Optionally choose its project folder. | The completed output of this task. Optionally choose its workspace folder. |  |

### `src/components/projects/v2/tasks/components/TaskFilesActionMenu.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 109 | Link an existing project file as task input | Link an existing workspace file as task input |  |

### `src/components/projects/v2/tasks/components/TaskFilesEmptyState.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 45 | Start by linking the file or folder this task depends on. You can drag items here or use one guided entry point to add a new file, folder, or existing project item. | Start by linking the file or folder this task depends on. You can drag items here or use one guided entry point to add a new file, folder, or existing workspace item. |  |

### `src/components/projects/v2/tasks/components/TaskFilesExplorer.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 88 | Published to Project Files | Published to Workspace Files |  |
| 89 | Moved in Project Files | Moved in Workspace Files |  |

### `src/components/reports/AdminReportsClient.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | Project or organization | Workspace or organization |  |

### `src/components/settings/AccountDeletionWizard.tsx` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 126 | Projects you own are deleted, including for the people working in them. | Workspaces you own are deleted, including for the people working in them. |  |
| 131 | Checking your projects… | Checking your workspaces… |  |
| 133 | We couldn’t check your projects. Review them on your Projects page before continuing. | We couldn’t check your workspaces. Review them on your Workspaces page before continuing. |  |
| 140 | Transfer any you want to keep from each project’s Settings tab. | Transfer any you want to keep from each workspace’s Settings tab. |  |
| 140 | Open your projects | Open your workspaces |  |
| 143 | You don’t own any projects. | You don’t own any workspaces. |  |

### `src/components/settings/GitHubCommitAttributionSettings.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 45 | Commits made from NetworkBase are signed with a privacy-safe GitHub address. You can choose which address from each project’s contributor settings. | Commits made from NetworkBase are signed with a privacy-safe GitHub address. You can choose which address from each workspace’s contributor settings. | Check: may mean the repository |
| 68 | Not confirmed yet: choose one in a project | Not confirmed yet: choose one in a workspace |  |

### `src/components/settings/IntegrationsSettings.tsx` (8)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 54 | Connecting asks GitHub to let NetworkBase read your repositories and organizations, and your email, so you can import and sync projects. | Connecting asks GitHub to let NetworkBase read your repositories and organizations, and your email, so you can import and sync workspaces. | Check: may mean the repository |
| 101 | Open project work in your editor and keep access under your account. | Open workspace work in your editor and keep access under your account. |  |
| 440 | Repository access is managed from each project; this page only shows account-level status. | Repository access is managed from each workspace; this page only shows account-level status. | Check: may mean the repository |
| 458 | Connected projects | Connected workspaces |  |
| 467 | No connected projects. | No connected workspaces. |  |
| 602 | Project files, repository links, sync history, and past contributor credit stay unchanged. | Workspace files, repository links, sync history, and past contributor credit stay unchanged. | Check: may mean the repository |
| 603 | Repository access is reviewed per project after the new account is linked. | Repository access is reviewed per workspace after the new account is linked. | Check: may mean the repository |
| 628 | You will no longer be able to sign in with GitHub, and repository access from this account stops. Your projects stay as they are. | You will no longer be able to sign in with GitHub, and repository access from this account stops. Your workspaces stay as they are. | Check: may mean the repository |

### `src/components/settings/LegalAndDataRightsSection.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 245 | Download a JSON file with your profile, project contributions, the projects you own and are a member of, tasks assigned to you, your comments on project updates, your connections, the messages you wrote, and your legal a… | Download a JSON file with your profile, workspace contributions, the workspaces you own and are a member of, tasks assigned to you, your comments on workspace updates, your connections, the messages you wrote, and your l… |  |

### `src/components/settings/NotificationsSettings.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 38 | Project | Workspace |  |
| 221 | Nothing muted. Mute a project, task or person from the ⋯ menu on a notification in the tray, or a conversation from its bell menu in | Nothing muted. Mute a workspace, task or person from the ⋯ menu on a notification in the tray, or a conversation from its bell menu in |  |

### `src/components/settings/OrgNotificationChoices.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 50 | Include child projects | Include workspaces in the organization | Organization context |

### `src/components/settings/PrivacySettings.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 183 | Choose who can start a direct conversation with you. Project invitations and applications still reach you. | Choose who can start a direct conversation with you. Workspace invitations and applications still reach you. |  |

### `src/components/sharing/ProjectShareContents.tsx` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 24 | Project team | Workspace team |  |
| 26 | Open the project to view the team. | Open the workspace to view the team. |  |
| 28 | Project statistics | Workspace statistics |  |
| 32 | Project skills | Workspace skills |  |
| 33 | Open the project to check current availability. | Open the workspace to check current availability. |  |

### `src/components/sharing/ShareDestinationBrowser.tsx` (12)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 51 | Search projects | Search workspaces |  |
| 51 | Search channels in this project | Search channels in this workspace |  |
| 59 | Projects | Workspaces |  |
| 62 | All projects | All workspaces |  |
| 62 | Projects | Workspaces |  |
| 64 | Project conversation type | Workspace conversation type |  |
| 69 | Project {…} | Workspace {…} |  |
| 69 | No projects match. Try another name. | No workspaces match. Try another name. |  |
| 69 | No joined projects. Direct messages are still available. | No joined workspaces. Direct messages are still available. |  |
| 70 | Existing groups outside projects | Existing groups outside workspaces |  |
| 71 | This conversation is no longer in your list. Return to Projects or Direct messages. | This conversation is no longer in your list. Return to Workspaces or Direct messages. |  |
| 74 | Load more projects | Load more workspaces |  |

### `src/components/sharing/SharePreviewCard.tsx` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 33 | . Open project | . Open workspace |  |
| 33 | Open project | Open workspace |  |

### `src/components/workspace/WorkspaceRequestsTab.tsx` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 230 | project invite | workspace invite |  |
| 284 | Connection and project decisions that need your attention, in one place. | Connection and workspace decisions that need your attention, in one place. |  |
| 334 | Project invitations ( | Workspace invitations ( |  |
| 361 | Applications to your projects ( | Applications to your workspaces ( |  |
| 408 | This list shows your 20 newest applications. Each person joins their project right away, and everyone is told. Decline any you are unsure about first. | This list shows your 20 newest applications. Each person joins their workspace right away, and everyone is told. Decline any you are unsure about first. |  |

### `src/components/workspace/WorkspaceTasksTab.tsx` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 294 | Project | Workspace |  |
| 298 | Project | Workspace |  |
| 451 | Search tasks or projects | Search tasks or workspaces |  |
| 524 | No open tasks are available in your projects right now. | No open tasks are available in your workspaces right now. |  |
| 560 | Open project | Open workspace |  |
| 616 | Open a project to view more | Open a workspace to view more |  |

### `src/hooks/discover/useDiscoverProjects.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 20 | Projects didn't load. Check your connection and try again. | Workspaces didn't load. Check your connection and try again. |  |

### `src/hooks/useGlobalSearchPreviews.ts` (7)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 172 | Project preview search failed | Workspace preview search failed |  |
| 183 | Project | Workspace |  |
| 196 | Matched project title | Matched workspace title |  |
| 200 | Matched project description | Matched workspace description |  |
| 215 | View projects using this skill | View workspaces using this skill |  |
| 217 | Skill in matching projects: {…} | Skill in matching workspaces: {…} |  |
| 329 | Matched project link · {…} | Matched workspace link · {…} |  |

### `src/hooks/useSettingsQueries.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 87 | Connect GitHub from a project when repository access is needed. | Connect GitHub from a workspace when repository access is needed. | Check: may mean the repository |

### `src/inngest/functions/flush-likes.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 8 | Flush Project Update Likes from Redis | Flush Workspace Update Likes from Redis |  |

### `src/inngest/functions/flush-views.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 8 | Flush Project Views from Redis | Flush Workspace Views from Redis |  |

### `src/lib/applications/card-state.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 43 | This project is no longer taking applications. | This workspace is no longer taking applications. |  |
| 69 | You were on this project | You were on this workspace |  |

### `src/lib/applications/closing.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | closed this application: the project is no longer taking applications | closed this application: the workspace is no longer taking applications |  |
| 101 | joined the project, so this application is closed | joined the workspace, so this application is closed |  |

### `src/lib/applications/notifications.ts` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 59 | Project: {…} | Workspace: {…} |  |
| 99 | Project closed | Workspace closed |  |
| 124 | The project | The workspace |  |
| 140 | Project: {…} | Workspace: {…} |  |
| 191 | Project: {…} | Workspace: {…} |  |
| 276 | Project | Workspace |  |

### `src/lib/applications/reasons.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 20 | The project is no longer taking applications. | The workspace is no longer taking applications. |  |
| 21 | The role was removed from the project. | The role was removed from the workspace. |  |
| 23 | We need deeper experience for this role at this stage of the project. | We need deeper experience for this role at this stage of the workspace. |  |

### `src/lib/data/discover.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 54 | Invalid project search cursor | Invalid workspace search cursor |  |
| 553 | Popular project | Popular workspace |  |

### `src/lib/data/project-access.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 103 | This project's {…} are not available to this viewer. | This workspace's {…} are not available to this viewer. |  |

### `src/lib/db/schema/index.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 941 | {…} IN ('project', 'organization') | {…} IN ('workspace', 'organization') |  |
| 942 | {…} = 'project' OR {…} IS NULL | {…} = 'workspace' OR {…} IS NULL |  |
| 2807 | {…} IN ('project', 'update', 'update_comment', 'doc', 'task_comment') | {…} IN ('workspace', 'update', 'update_comment', 'doc', 'task_comment') |  |

### `src/lib/email/contracts.ts` (7)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 415 | your project | your workspace |  |
| 444 | \nExplore Projects: {…}\n | \nExplore Workspaces: {…}\n |  |
| 459 | Welcome to NetworkBase, {…} — Your profile is live. Explore projects, connect with developers, and collaborate seamlessly. | Welcome to NetworkBase, {…} — Your profile is live. Explore workspaces, connect with developers, and collaborate seamlessly. |  |
| 478 | &lt;tr> &lt;td style="padding:0 0 16px 0;"> &lt;h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;word-break:break-word;"> Welcome to NetworkBase &lt;/h1> &lt;p style="margin:14px 0… | &lt;tr> &lt;td style="padding:0 0 16px 0;"> &lt;h1 style="font-size:21px;line-height:1.35;font-weight:700;color:#111827;margin:8px 0 0 0;word-break:break-word;"> Welcome to NetworkBase &lt;/h1> &lt;p style="margin:14px 0… |  |
| 489 | &lt;td class="action-btn-cell" style="padding:0 8px 0 0;vertical-align:middle;"> &lt;a href="{…}" class="action-btn" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-co… | &lt;td class="action-btn-cell" style="padding:0 8px 0 0;vertical-align:middle;"> &lt;a href="{…}" class="action-btn" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#FFFFFF;background-co… |  |
| 541 | Project: {…}\n | Workspace: {…}\n |  |
| 570 | Project: {…}\n | Workspace: {…}\n |  |

### `src/lib/email/org-templates.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 248 | Work you did in your own projects is still yours. | Work you did in your own workspaces is still yours. |  |
| 249 | Now your personal projects | Now your personal workspaces |  |
| 250 | Open my projects | Open my workspaces |  |

### `src/lib/feedback/copy.ts` (69)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 137 | Published to Project Files | Published to Workspace Files |  |
| 145 | Creating your project | Creating your workspace |  |
| 148 | Project created | Workspace created |  |
| 151 | Project & files ready | Workspace & files ready |  |
| 154 | Project created | Workspace created |  |
| 159 | Project created | Workspace created |  |
| 164 | Project created | Workspace created |  |
| 171 | Project settings saved | Workspace settings saved |  |
| 174 | Project image updated | Workspace image updated |  |
| 177 | Project image removed | Workspace image removed |  |
| 183 | Project unfollowed | Workspace unfollowed |  |
| 193 | Ask the project owner. | Ask the workspace owner. |  |
| 197 | Project roles updated | Workspace roles updated |  |
| 218 | Project archived | Workspace archived |  |
| 221 | Project deleted | Workspace deleted |  |
| 224 | Project wasn’t deleted | Workspace wasn’t deleted |  |
| 240 | Project draft cleared | Workspace draft cleared |  |
| 451 | Project members can join. | Workspace members can join. |  |
| 536 | Project status updated | Workspace status updated |  |
| 539 | Project status cleared | Workspace status cleared |  |
| 550 | Project update posted | Workspace update posted |  |
| 788 | Project channel limit | Workspace channel limit |  |
| 806 | Project members only | Workspace members only |  |
| 900 | Project channel required | Workspace channel required |  |
| 901 | Create tasks in a project. | Create tasks in a workspace. |  |
| 999 | You're no longer in that project. | You're no longer in that workspace. |  |
| 1042 | Couldn't clear the project status. | Couldn't clear the workspace status. |  |
| 1055 | Fix the highlighted project contribution before saving. | Fix the highlighted workspace contribution before saving. |  |
| 1077 | Project updated | Workspace updated |  |
| 1080 | Couldn’t update project | Couldn’t update workspace |  |
| 1117 | Finish the project link | Finish the workspace link |  |
| 1122 | Project created | Workspace created |  |
| 1127 | Project created | Workspace created |  |
| 1135 | Project created and folder imported. | Workspace created and folder imported. |  |
| 1138 | Project created. | Workspace created. |  |
| 1141 | That project tab is not visible for your current access. | That workspace tab is not visible for your current access. |  |
| 1144 | Project members cannot apply for an additional role | Workspace members cannot apply for an additional role |  |
| 1147 | Project invitation pending | Workspace invitation pending |  |
| 1158 | Project is already at the starting stage | Workspace is already at the starting stage |  |
| 1161 | Project is already at the final stage | Workspace is already at the final stage |  |
| 1164 | Project links saved | Workspace links saved |  |
| 1170 | Project name cannot be empty. | Workspace name cannot be empty. |  |
| 1177 | Couldn’t update project identity. | Couldn’t update workspace identity. |  |
| 1189 | Project avatar removed. | Workspace avatar removed. |  |
| 1205 | Couldn’t load project notification settings. | Couldn’t load workspace notification settings. |  |
| 1211 | Couldn’t update project roles. | Couldn’t update workspace roles. |  |
| 1214 | Project roles updated. | Workspace roles updated. |  |
| 1233 | Couldn’t save project notification settings. | Couldn’t save workspace notification settings. |  |
| 1242 | Couldn’t reset project notification settings. | Couldn’t reset workspace notification settings. |  |
| 1269 | Couldn’t archive project. | Couldn’t archive workspace. |  |
| 1272 | Project ownership transferred | Workspace ownership transferred |  |
| 1281 | Project is already archived. | Workspace is already archived. |  |
| 1291 | Couldn’t delete project. | Couldn’t delete workspace. |  |
| 1297 | Project cannot be deleted. | Workspace cannot be deleted. |  |
| 1645 | Only owners and admins can set the project status. | Only owners and admins can set the workspace status. |  |
| 1648 | Couldn't set the project status. Check the end time. | Couldn't set the workspace status. Check the end time. |  |
| 1663 | Couldn’t create project | Couldn’t create workspace |  |
| 1689 | Following project | Following workspace |  |
| 1692 | Unfollowed project | Unfollowed workspace |  |
| 1707 | Couldn’t update project stage | Couldn’t update workspace stage |  |
| 1710 | Only the project owner can advance the stage | Only the workspace owner can advance the stage |  |
| 1713 | Only the project owner can revert the stage | Only the workspace owner can revert the stage |  |
| 1719 | Project avatar optimized and updated. | Workspace avatar optimized and updated. |  |
| 1722 | Project avatar updated. | Workspace avatar updated. |  |
| 1725 | Couldn’t upload project avatar. | Couldn’t upload workspace avatar. |  |
| 1728 | Couldn’t remove project avatar. | Couldn’t remove workspace avatar. |  |
| 1740 | Project notification settings updated. | Workspace notification settings updated. |  |
| 1746 | Project notification settings reset. | Workspace notification settings reset. |  |
| 1884 | Moved in Project Files | Moved in Workspace Files |  |

### `src/lib/feedback/index.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 29 | Project created | Workspace created |  |

### `src/lib/files/content-reader.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 84 | File key does not belong to this project | File key does not belong to this workspace |  |

### `src/lib/files/internal-helpers.ts` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 15 | Project not found | Workspace not found |  |
| 156 | File uploads are disabled for this project member. | File uploads are disabled for this workspace member. |  |
| 300 | File uploads are disabled for this project member. | File uploads are disabled for this workspace member. |  |
| 409 | Task working files must be published to Project Files before they can be relocated | Task working files must be published to Workspace Files before they can be relocated |  |
| 529 | Project {…} not found | Workspace {…} not found |  |
| 581 | Project {…} not found | Workspace {…} not found |  |

### `src/lib/files/permanent-delete.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 156 | The deletion scope changed. Contact the project owner. | The deletion scope changed. Contact the workspace owner. |  |

### `src/lib/files/upload-validator.ts` (4)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 236 | Cannot upload root disk or system directories (such as Macintosh HD, Applications, or System). Please select a specific project folder. | Cannot upload root disk or system directories (such as Macintosh HD, Applications, or System). Please select a specific workspace folder. |  |
| 248 | Cannot upload system directory "{…}". Please select a specific project folder. | Cannot upload system directory "{…}". Please select a specific workspace folder. |  |
| 281 | Cannot upload user home directory ({…}). Please select a specific folder inside your project. | Cannot upload user home directory ({…}). Please select a specific folder inside your workspace. |  |
| 294 | Cannot upload operating system directories. Please select a specific project folder. | Cannot upload operating system directories. Please select a specific workspace folder. |  |

### `src/lib/github/project-import-runner.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 147 | Project not found | Workspace not found |  |
| 218 | project import rejected for project {…}: repository exceeds file budget ({…} > {…}) | workspace import rejected for workspace {…}: repository exceeds file budget ({…} > {…}) | Check: may mean the repository |
| 223 | project import rejected for project {…}: repository exceeds byte budget ({…} > {…}) | workspace import rejected for workspace {…}: repository exceeds byte budget ({…} > {…}) | Check: may mean the repository |

### `src/lib/github/sync-service.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 113 | Only the project owner can manage GitHub synchronization. | Only the workspace owner can manage GitHub synchronization. | Check: may mean the repository |
| 165 | File content is outside this project | File content is outside this workspace |  |
| 684 | Project files changed during comparison. Compare again. | Workspace files changed during comparison. Compare again. |  |

### `src/lib/github/sync-workspace.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 140 | Apply to project files | Apply to workspace files |  |

### `src/lib/legal/config.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 20 | Task assignments, project updates, mentions, and workflow alerts | Task assignments, workspace updates, mentions, and workflow alerts |  |

### `src/lib/messaging/application-status.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 42 | joined the project | joined the workspace |  |

### `src/lib/messaging/canvas-store.ts` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 69 | A first-week plan for someone joining the project. | A first-week plan for someone joining the workspace. |  |
| 72 | ## Start here _A short welcome and what the first week should achieve._ ## First week - [ ] Get access to the tools you need - [ ] Read the channel overview and project brief - [ ] Meet the people below - [ ] Pick up a f… | ## Start here _A short welcome and what the first week should achieve._ ## First week - [ ] Get access to the tools you need - [ ] Read the channel overview and workspace brief - [ ] Meet the people below - [ ] Pick up a… |  |
| 142 | Project brief | Workspace brief |  |
| 143 | Projects | Workspaces |  |
| 167 | Projects | Workspaces |  |

### `src/lib/messaging/errors.ts` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 12 | This project has reached 200 channels. | This workspace has reached 200 channels. |  |
| 16 | Only project members can do that. | Only workspace members can do that. |  |
| 18 | You can't leave the project's default channel. | You can't leave the workspace's default channel. |  |
| 37 | Tasks can only be created in project channels. | Tasks can only be created in workspace channels. |  |
| 43 | People in an application conversation are fixed: the applicant and the project's reviewers. | People in an application conversation are fixed: the applicant and the workspace's reviewers. |  |

### `src/lib/notifications/preferences.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 77 | Project invitations and leadership appointments. | Workspace invitations and leadership appointments. |  |
| 78 | Project activity | Workspace activity |  |
| 78 | Project-level updates that are important but not noisy. | Workspace-level updates that are important but not noisy. |  |

### `src/lib/notifications/presentation.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 101 | project update | workspace update |  |
| 101 | project updates | workspace updates |  |
| 267 | This project | This workspace |  |

### `src/lib/notifications/project-events.ts` (15)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 72 | Project | Workspace |  |
| 86 | {…} changed project visibility | {…} changed workspace visibility |  |
| 88 | {…} changed public project surfaces | {…} changed public workspace surfaces |  |
| 105 | {…} uploaded project files | {…} uploaded workspace files |  |
| 107 | {…} created a project folder | {…} created a workspace folder |  |
| 109 | {…} organized project files | {…} organized workspace files |  |
| 111 | {…} changed project file availability | {…} changed workspace file availability |  |
| 113 | {…} updated project sync status | {…} updated workspace sync status |  |
| 115 | Protected project action needs attention | Protected workspace action needs attention |  |
| 117 | Project data export is ready | Workspace data export is ready |  |
| 121 | {…} scheduled project deletion | {…} scheduled workspace deletion |  |
| 123 | {…} posted a project update | {…} posted a workspace update |  |
| 125 | {…} commented on your project update | {…} commented on your workspace update |  |
| 127 | {…} has new project updates | {…} has new workspace updates |  |
| 388 | Batched project notification events must share one project and actor | Batched workspace notification events must share one workspace and actor |  |

### `src/lib/notifications/project-policy.ts` (26)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 153 | Project Lifecycle | Workspace Lifecycle |  |
| 153 | Sprint and lifecycle changes that affect project momentum. | Sprint and lifecycle changes that affect workspace momentum. |  |
| 157 | Project progress posts, follower notifications, and update discussions. | Workspace progress posts, follower notifications, and update discussions. |  |
| 160 | Join requests, invitations, roles, removals and child projects. | Join requests, invitations, roles, removals and workspaces in the organization. | Organization context |
| 190 | Notify project leaders when a new member joins through an accepted application or invite. | Notify workspace leaders when a new member joins through an accepted application or invite. |  |
| 205 | Notify the affected member when their project role changes. | Notify the affected member when their workspace role changes. |  |
| 235 | Notify previous and new owner when project ownership changes. | Notify previous and new owner when workspace ownership changes. |  |
| 250 | Notify members when a project becomes public or private. | Notify members when a workspace becomes public or private. |  |
| 567 | Bundle many task updates into one low-noise project notification. | Bundle many task updates into one low-noise workspace notification. |  |
| 583 | Notify members when a file is uploaded to the project workspace. | Notify members when a file is uploaded to the workspace. |  |
| 733 | Notify the requester when a project data export is ready. | Notify the requester when a workspace data export is ready. |  |
| 747 | Project archived | Workspace archived |  |
| 748 | Notify members when the project is archived. | Notify members when the workspace is archived. |  |
| 763 | Notify owners and co-leaders when project deletion is scheduled. | Notify owners and admins when workspace deletion is scheduled. |  |
| 810 | Project update published | Workspace update published |  |
| 811 | Notify followers and members when a project member publishes an update. | Notify followers and members when a workspace member publishes an update. |  |
| 826 | Notify an update author when someone comments on their project update. | Notify an update author when someone comments on their workspace update. |  |
| 841 | Digest-ready trigger for grouped follower-facing project updates. | Digest-ready trigger for grouped follower-facing workspace updates. |  |
| 861 | Added to a project | Added to a workspace |  |
| 861 | A member hears they were added to a child project. | A member hears they were added to a workspace in the organization. | Organization context |
| 862 | Admins hear when a project asks to join or leave. | Admins hear when a workspace asks to join or leave. |  |
| 864 | The project's lead hears the answer. | The workspace's lead hears the answer. | Role wording (Owner/Admin) |
| 872 | Child project created | workspace in the organization created | Organization context |
| 872 | Admins hear when someone creates a project in the organization, combined. | Admins hear when someone creates a workspace in the organization, combined. |  |
| 874 | Your child project | Your workspace in the organization | Organization context |
| 874 | Leads hear when a seat opens or an org rule changes their project. | Leads hear when a seat opens or an org rule changes their workspace. |  |

### `src/lib/organizations/assignments.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 81 | Create projects in the organization first. | Create workspaces in the organization first. |  |

### `src/lib/organizations/child-rules.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 13 | Guests can't create projects. | Guests can't create workspaces. |  |
| 14 | Only admins create projects here. | Only admins create workspaces here. |  |

### `src/lib/organizations/needs-you.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 80 | {…} · {…} for the project | {…} · {…} for the workspace |  |
| 117 | {…} not in a project | {…} not in a workspace |  |
| 118 | {…} needs projects · Create one | {…} needs workspaces · Create one |  |

### `src/lib/organizations/settings.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 16 | Projects | Workspaces |  |
| 16 | Who creates projects inside the organization and who can be added to them. | Who creates workspaces inside the organization and who can be added to them. |  |

### `src/lib/organizations/sprints.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 34 | Project not found | Workspace not found |  |
| 59 | This project follows its organization's sprints: pick dates inside one of them. | This workspace follows its organization's sprints: pick dates inside one of them. |  |
| 62 | Only projects inside an organization link to an org sprint. | Only workspaces inside an organization link to an org sprint. |  |

### `src/lib/organizations/update-rules.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 31 | Private projects can't share to the org. | Private workspaces can't share to the org. |  |

### `src/lib/profile/browser-profile.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 51 | Could not load project contributions | Could not load workspace contributions |  |

### `src/lib/profile/collaboration.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 469 | External project | External workspace | Keep “project”: external |
| 480 | Project website | Workspace website |  |

### `src/lib/profile/contribution-editor.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 106 | Project name is required. | Workspace name is required. |  |
| 112 | Project URL must use http(s) and point to a public host. | Workspace URL must use http(s) and point to a public host. |  |

### `src/lib/profile/contribution-story-server.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 97 | Contributed to {…} project files | Contributed to {…} workspace files |  |

### `src/lib/profile/contribution-story.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 234 | Enter a project name. | Enter a workspace name. |  |
| 309 | Confirm permission to publish each project image. | Confirm permission to publish each workspace image. |  |
| 487 | Project website | Workspace website |  |

### `src/lib/profile/display.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 22 | Untitled project | Untitled workspace |  |

### `src/lib/profile/role-preferences.ts` (11)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 5 | Freelance projects | Freelance workspaces |  |
| 9 | Consulting projects | Consulting workspaces |  |
| 70 | Freelance projects | Freelance workspaces |  |
| 71 | Freelance projects | Freelance workspaces |  |
| 72 | freelance projects | freelance workspaces |  |
| 72 | Freelance projects | Freelance workspaces |  |
| 82 | Consulting projects | Consulting workspaces |  |
| 83 | Consulting projects | Consulting workspaces |  |
| 84 | Consulting projects | Consulting workspaces |  |
| 85 | consulting projects | consulting workspaces |  |
| 85 | Consulting projects | Consulting workspaces |  |

### `src/lib/projects/collaborator-lifecycle.ts` (9)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 68 | Project member | Workspace member |  |
| 173 | Project not found | Workspace not found |  |
| 176 | You do not have permission to perform this project action | You do not have permission to perform this workspace action |  |
| 194 | Project not found | Workspace not found |  |
| 197 | You do not have permission to perform this project action | You do not have permission to perform this workspace action |  |
| 216 | Project not found | Workspace not found |  |
| 383 | Project not found | Workspace not found |  |
| 584 | Project not found | Workspace not found |  |
| 606 | Replacement assignee must be an assignable project member | Replacement assignee must be an assignable workspace member |  |

### `src/lib/projects/doc-blocks.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 85 | Project file | Workspace file |  |
| 92 | Project member | Workspace member |  |

### `src/lib/projects/doc-create-intent.ts` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 24 | Project Doc | Workspace Doc |  |
| 24 | Project Doc | Workspace Doc |  |
| 25 | Describe what this project does, who it helps, and why it exists. | Describe what this workspace does, who it helps, and why it exists. |  |
| 49 | ## Project focus | ## Workspace focus |  |
| 57 | - Add the project scope, stack, and important links here. | - Add the workspace scope, stack, and important links here. |  |
| 68 | Add screenshots, demos, commands, and project references as the project grows. | Add screenshots, demos, commands, and workspace references as the workspace grows. |  |

### `src/lib/projects/doc-quality.ts` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 128 | Add a short explanation of what this project does and why it matters. | Add a short explanation of what this workspace does and why it matters. |  |
| 130 | Show how someone should use or run the project after setup. | Show how someone should use or run the workspace after setup. |  |
| 132 | Add a visual preview when the project benefits from one. | Add a visual preview when the workspace benefits from one. |  |
| 144 | Many project links | Many workspace links |  |
| 144 | Consider grouping project links into an Important Links section. | Consider grouping workspace links into an Important Links section. |  |

### `src/lib/projects/doc-quick-console.ts` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 582 | No project links detected | No workspace links detected |  |
| 602 | {…} project references | {…} workspace references |  |
| 636 | Project links | Workspace links |  |
| 636 | {…} linked project item{…} | {…} linked workspace item{…} |  |
| 663 | {…} project link{…} | {…} workspace link{…} |  |

### `src/lib/projects/merge-sandbox.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 33 | Project {…} not found | Workspace {…} not found |  |
| 51 | ERR_INVALID_CANONICAL: staged files reference nodes outside this project's main tree | ERR_INVALID_CANONICAL: staged files reference nodes outside this workspace's main tree |  |

### `src/lib/projects/project-create-options.ts` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 2 | Side Project | Side Workspace |  |
| 2 | Personal project or hobby | Personal workspace or hobby |  |
| 5 | Learning Project | Learning Workspace |  |
| 6 | Competition project | Competition workspace |  |
| 8 | Art or design project | Art or design workspace |  |
| 10 | Video game project | Video game workspace |  |

### `src/lib/projects/project-detail-metadata.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 24 | Project | Workspace |  |
| 31 | Project | Workspace |  |
| 55 | {…} project image | {…} workspace image |  |

### `src/lib/projects/project-invitations.ts` (14)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 123 | Project is unavailable | Workspace is unavailable |  |
| 153 | You can only invite to projects you manage | You can only invite to workspaces you manage |  |
| 155 | Only the project Lead can appoint a guidance co-leader | Only the owner can appoint a guidance admin | Role wording (Owner/Admin) |
| 159 | The current project Owner cannot hold this appointment | The current workspace Owner cannot hold this appointment |  |
| 160 | User is already a member of this project | User is already a member of this workspace |  |
| 174 | This project role is no longer available | This workspace role is no longer available |  |
| 188 | An invitation for this project is already pending | An invitation for this workspace is already pending |  |
| 210 | This project already has a pending or active guidance appointment | This workspace already has a pending or active guidance appointment |  |
| 227 | Project | Workspace |  |
| 259 | Project is unavailable | Workspace is unavailable |  |
| 260 | Project is unavailable | Workspace is unavailable |  |
| 282 | Only the inviter or project Lead can cancel this invitation | Only the inviter or owner can cancel this invitation | Role wording (Owner/Admin) |
| 307 | The current project Owner cannot hold this appointment | The current workspace Owner cannot hold this appointment |  |
| 319 | This project already has an active guidance appointment | This workspace already has an active guidance appointment |  |

### `src/lib/projects/recent-activity.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 34 | A project member | A workspace member |  |
| 55 | {…} joined the project | {…} joined the workspace |  |

### `src/lib/projects/server/access.ts` (9)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 617 | This project is inside an organization. Change its visibility in Settings → Organization. | This workspace is inside an organization. Change its visibility in Settings → Organization. |  |
| 627 | Project is already {…}. | Workspace is already {…}. |  |
| 732 | Project visibility changed to {…} | Workspace visibility changed to {…} |  |
| 758 | Project is now {…}. | Workspace is now {…}. |  |
| 769 | Failed to update project visibility. | Failed to update workspace visibility. |  |
| 875 | Public project surfaces changed | Public workspace surfaces changed |  |
| 876 | The visible public tabs for this project were updated. | The visible public tabs for this workspace were updated. |  |
| 903 | Project not found | Workspace not found |  |
| 907 | Project not found. | Workspace not found. |  |

### `src/lib/projects/server/common.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 454 | Project not found. | Workspace not found. |  |
| 461 | Only the project owner can change settings. | Only the workspace owner can change settings. |  |

### `src/lib/projects/server/detail.ts` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 583 | Invalid project detail request. | Invalid workspace detail request. |  |
| 590 | Project not found. | Workspace not found. |  |
| 610 | Invalid project detail request. | Invalid workspace detail request. |  |
| 625 | Project not found. | Workspace not found. |  |
| 843 | Project detail payload validation failed. | Workspace detail payload validation failed. |  |
| 863 | Failed to load project detail. | Failed to load workspace detail. |  |

### `src/lib/projects/server/lifecycle.ts` (56)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 77 | Invalid project visibility. | Invalid workspace visibility. |  |
| 115 | Project not found | Workspace not found |  |
| 547 | You must be logged in to create a project | You must be logged in to create a workspace |  |
| 560 | You have created too many projects recently. Please wait a while before creating another. | You have created too many workspaces recently. Please wait a while before creating another. |  |
| 572 | A project creation is already in progress. Please wait a moment. | A workspace creation is already in progress. Please wait a moment. |  |
| 589 | Invalid project details provided. | Invalid workspace details provided. |  |
| 901 | Failed to create project | Failed to create workspace |  |
| 1087 | Project lead | Owner | Role wording (Owner/Admin) |
| 1117 | The open project assignments from {…} weren't copied here. Ask an admin to share them again. | The open workspace assignments from {…} weren't copied here. Ask an admin to share them again. |  |
| 1175 | Failed to generate a unique project ID. Please try again. | Failed to generate a unique workspace ID. Please try again. |  |
| 1201 | Invalid project update | Invalid workspace update |  |
| 1222 | Project not found | Workspace not found |  |
| 1380 | Role not found in this project | Role not found in this workspace |  |
| 1520 | Project roles updated | Workspace roles updated |  |
| 1586 | Too many project image upload attempts. Please try again later. | Too many workspace image upload attempts. Please try again later. |  |
| 1601 | Project image | Workspace image |  |
| 1633 | Failed to prepare project image upload. | Failed to prepare workspace image upload. |  |
| 1653 | Failed to prepare project image upload. | Failed to prepare workspace image upload. |  |
| 1692 | Verified project image is missing lifecycle identity | Verified workspace image is missing lifecycle identity |  |
| 1704 | Project image is no longer publishable | Workspace image is no longer publishable |  |
| 1728 | Failed to publish project image. | Failed to publish workspace image. |  |
| 1750 | Failed to finalize project image upload. | Failed to finalize workspace image upload. |  |
| 1795 | Failed to clear project image. | Failed to clear workspace image. |  |
| 1808 | Failed to clear project image. | Failed to clear workspace image. |  |
| 1836 | Project not found. | Workspace not found. |  |
| 1854 | Only the Lead or a Co-leader can update project links. | Only the Lead or a Admin can update workspace links. | Role wording (Owner/Admin) |
| 1872 | Project links changed in another session. The changes were merged; review and save again. | Workspace links changed in another session. The changes were merged; review and save again. |  |
| 1925 | Failed to update project links. | Failed to update workspace links. |  |
| 1955 | Project is already archived. | Workspace is already archived. |  |
| 1972 | Project archived | Workspace archived |  |
| 2006 | The project was archived from settings. | The workspace was archived from settings. |  |
| 2022 | Project archived. | Workspace archived. |  |
| 2033 | Failed to archive project. | Failed to archive workspace. |  |
| 2146 | Project not found. | Workspace not found. |  |
| 2153 | Only the project owner can delete this project. | Only the workspace owner can delete this workspace. |  |
| 2162 | Project deletion is waiting for {…} storage references to be registered. | Workspace deletion is waiting for {…} storage references to be registered. |  |
| 2207 | Only the project owner can delete this project. | Only the workspace owner can delete this workspace. |  |
| 2208 | Project deletion is waiting for storage references to be registered. | Workspace deletion is waiting for storage references to be registered. |  |
| 2224 | Project deleted successfully. | Workspace deleted successfully. |  |
| 2237 | Failed to delete project. | Failed to delete workspace. |  |
| 2286 | Only draft projects can be discarded. Use project deletion instead. | Only draft workspaces can be discarded. Use workspace deletion instead. |  |
| 2338 | Project not found or private. | Workspace not found or private. |  |
| 2344 | Project not found or private. | Workspace not found or private. |  |
| 2418 | Project not found | Workspace not found |  |
| 2457 | Project views are unavailable until migrations are applied | Workspace views are unavailable until migrations are applied |  |
| 2557 | Project not found | Workspace not found |  |
| 2564 | Only the project owner can advance the stage | Only the workspace owner can advance the stage |  |
| 2641 | Project not found | Workspace not found |  |
| 2648 | Only the project owner can advance the stage | Only the workspace owner can advance the stage |  |
| 2655 | Project lifecycle changed. Refresh and retry. | Workspace lifecycle changed. Refresh and retry. |  |
| 2665 | Failed to update project stage | Failed to update workspace stage |  |
| 2692 | Failed to update project stage | Failed to update workspace stage |  |
| 2733 | Project not found or access denied | Workspace not found or access denied |  |
| 2787 | Project lifecycle changed. Refresh and retry. | Workspace lifecycle changed. Refresh and retry. |  |
| 2802 | Failed to update project lifecycle | Failed to update workspace lifecycle |  |
| 2961 | Untitled Project | Untitled Workspace |  |

### `src/lib/projects/server/settings.ts` (36)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 643 | Project not found | Workspace not found |  |
| 647 | Project not found. | Workspace not found. |  |
| 791 | Project not found | Workspace not found |  |
| 795 | Project not found. | Workspace not found. |  |
| 857 | Project member not found. | Workspace member not found. |  |
| 898 | Project member | Workspace member |  |
| 919 | You can upload files to this project workspace. | You can upload files to this workspace. |  |
| 920 | You can no longer upload files to this project workspace. | You can no longer upload files to this workspace. |  |
| 1034 | Project file uploads enabled | Workspace file uploads enabled |  |
| 1035 | Project file uploads disabled | Workspace file uploads disabled |  |
| 1037 | Members can upload files to this project workspace. | Members can upload files to this workspace. |  |
| 1038 | Members can no longer upload files to this project workspace. | Members can no longer upload files to this workspace. |  |
| 1105 | Project not found. | Workspace not found. |  |
| 1129 | You do not have permission to manage project notifications. | You do not have permission to manage workspace notifications. |  |
| 1135 | Failed to load project notification settings. | Failed to load workspace notification settings. |  |
| 1185 | Project notification settings updated. | Workspace notification settings updated. |  |
| 1202 | You do not have permission to manage project notifications. | You do not have permission to manage workspace notifications. |  |
| 1208 | Failed to update project notification settings. | Failed to update workspace notification settings. |  |
| 1299 | Project member not found. | Workspace member not found. |  |
| 1359 | Members can only update their own project notification settings. | Members can only update their own workspace notification settings. |  |
| 1378 | Project member not found. | Workspace member not found. |  |
| 1399 | Project notification preferences updated. | Workspace notification preferences updated. |  |
| 1467 | Project not found | Workspace not found |  |
| 1471 | Project not found. | Workspace not found. |  |
| 1509 | {…} updated your project role | {…} updated your workspace role |  |
| 1526 | Project | Workspace |  |
| 1607 | This user is no longer a project member. | This user is no longer a workspace member. |  |
| 1689 | Project not found | Workspace not found |  |
| 1693 | Project not found. | Workspace not found. |  |
| 1765 | Project not found | Workspace not found |  |
| 1769 | Project not found. | Workspace not found. |  |
| 1824 | {…} removed you from a project | {…} removed you from a workspace |  |
| 1825 | Project access removed | Workspace access removed |  |
| 1835 | Project | Workspace |  |
| 1837 | Removed from project | Removed from workspace |  |
| 1971 | Only the project owner can access danger zone settings. | Only the workspace owner can access danger zone settings. |  |

### `src/lib/projects/server/sprints.ts` (11)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 62 | Project not found | Workspace not found |  |
| 931 | Project not found | Workspace not found |  |
| 1046 | Project not found | Workspace not found |  |
| 1120 | Project not found | Workspace not found |  |
| 1183 | Project not found | Workspace not found |  |
| 1250 | Project not found. | Workspace not found. |  |
| 1284 | Sprint details are members-only for this project. | Sprint details are members-only for this workspace. |  |
| 1418 | A new sprint was added to the project. | A new sprint was added to the workspace. |  |
| 1778 | Project not found | Workspace not found |  |
| 1781 | Only a project owner or admin can manage the Sprint lifecycle | Only a workspace owner or admin can manage the Sprint lifecycle |  |
| 2181 | That file or doc isn't in this project. | That file or doc isn't in this workspace. |  |

### `src/lib/projects/server/tasks.ts` (16)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 154 | Project not found | Workspace not found |  |
| 478 | Project not found | Workspace not found |  |
| 486 | Project not found | Workspace not found |  |
| 515 | Failed to fetch project link previews | Failed to fetch workspace link previews |  |
| 541 | Project not found | Workspace not found |  |
| 611 | Project not found | Workspace not found |  |
| 886 | Failed to fetch project members | Failed to fetch workspace members |  |
| 923 | Project not found | Workspace not found |  |
| 925 | Only the project owner can assign tasks to a Sprint | Only the workspace owner can assign tasks to a Sprint |  |
| 943 | Assignee must be a project member | Assignee must be a workspace member |  |
| 946 | Assignee must be an assignable project member | Assignee must be an assignable workspace member |  |
| 959 | Project not found | Workspace not found |  |
| 1086 | One or more attachments are invalid for this project | One or more attachments are invalid for this workspace |  |
| 1252 | Project not found | Workspace not found |  |
| 1255 | Only the project owner can delete tasks | Only the workspace owner can delete tasks |  |
| 1271 | Task not found in this project | Task not found in this workspace |  |

### `src/lib/projects/settings-policies.ts` (36)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 219 | Public project overview, summary, roles, team preview, and high-level progress. | Public workspace overview, summary, roles, team preview, and high-level progress. |  |
| 221 | Published project documentation, setup notes, screenshots, commands, and contribution guidance. | Published workspace documentation, setup notes, screenshots, commands, and contribution guidance. |  |
| 225 | Public project files and shared workspace materials that are safe for visitors. | Public workspace files and shared workspace materials that are safe for visitors. |  |
| 430 | Project member | Workspace member |  |
| 480 | No longer has project access | No longer has workspace access |  |
| 493 | Removed from project | Removed from workspace |  |
| 538 | Project identity, collaboration intent, and public-facing summary. | Workspace identity, collaboration intent, and public-facing summary. |  |
| 543 | External project destinations shown beside the project title. | External workspace destinations shown beside the workspace title. | Keep “project”: external |
| 573 | Project update publishing, visibility, follower alerts, and discussion rules. | Workspace update publishing, visibility, follower alerts, and discussion rules. |  |
| 591 | Project event categories and member/follower attention rules. | Workspace event categories and member/follower attention rules. |  |
| 620 | Project cards, Discover, search, and public profile references can show the project | Workspace cards, Discover, search, and public profile references can show the workspace |  |
| 621 | Shared links can show the project title, description, and project image preview | Shared links can show the workspace title, description, and workspace image preview |  |
| 622 | Followers may receive public project updates when an update creates attention | Followers may receive public workspace updates when an update creates attention |  |
| 626 | Only the owner and approved project members can open project detail surfaces | Only the owner and approved workspace members can open workspace detail surfaces |  |
| 627 | Discover, public search, public profile cards, and anonymous metadata hide the project | Discover, public search, public profile cards, and anonymous metadata hide the workspace |  |
| 660 | Can open public project pages and share previews | Can open public workspace pages and share previews |  |
| 661 | Cannot view project content or metadata | Cannot view workspace content or metadata |  |
| 666 | Member-only project access is enforced across project surfaces. | Member-only workspace access is enforced across workspace surfaces. |  |
| 667 | The project is discoverable and visible to everyone. | The workspace is discoverable and visible to everyone. |  |
| 708 | Can discover public project updates. | Can discover public workspace updates. |  |
| 734 | Hide the project from Discover, public search, and public profile project cards. | Hide the workspace from Discover, public search, and public profile workspace cards. |  |
| 741 | Restore Discover, public search, and public profile project cards. | Restore Discover, public search, and public profile workspace cards. |  |
| 742 | Allow shared links to show project title, description, and project image metadata. | Allow shared links to show workspace title, description, and workspace image metadata. |  |
| 751 | {…} keep project access. | {…} keep workspace access. |  |
| 798 | Anonymous project metadata is replaced with safe unavailable copy. | Anonymous workspace metadata is replaced with safe unavailable copy. |  |
| 800 | The project image is served only through the visibility-aware project image route. | The workspace image is served only through the visibility-aware workspace image route. |  |
| 805 | Project title, description, and image route become public share metadata. | Workspace title, description, and image route become public share metadata. |  |
| 890 | Project Files and task Files permissions | Workspace Files and task Files permissions |  |
| 945 | Only the project owner or a Co-leader can manage collaborators. | Only the workspace owner or a Admin can manage members. | Role wording (Owner/Admin) |
| 991 | Project group conversation access will be removed. | Workspace group conversation access will be removed. |  |
| 992 | No project group conversation participant row found. | No workspace group conversation participant row found. |  |
| 994 | Private project access is revoked immediately. | Private workspace access is revoked immediately. |  |
| 995 | Public project pages may remain visible, but member-only controls are revoked. | Public workspace pages may remain visible, but member-only controls are revoked. |  |
| 1020 | Owners and Co-leaders can always upload, replace, organize, and review project files. | Owners and Admins can always upload, replace, organize, and review workspace files. |  |
| 1028 | Project Files tab | Workspace Files tab |  |
| 1075 | Project member | Workspace member |  |

### `src/lib/projects/sprint-presentation.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 11 | A project member | A workspace member |  |

### `src/lib/projects/status-presentation.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 10 | Project | Workspace |  |

### `src/lib/projects/subtask-write-scope.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 42 | You do not have permission to perform this project action | You do not have permission to perform this workspace action |  |

### `src/lib/projects/task-transition-service.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 236 | Only the assignee or a project lead can move this task. | Only the assignee or a owner can move this task. | Role wording (Owner/Admin) |
| 257 | Only project leads can request changes. | Only workspace leads can request changes. |  |

### `src/lib/projects/updates.ts` (6)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 182 | Project tasks | Workspace tasks |  |
| 183 | Project sprints | Workspace sprints |  |
| 184 | Project files | Workspace files |  |
| 185 | Project roles | Workspace roles |  |
| 186 | Project contributors | Workspace contributors |  |
| 187 | Project reference | Workspace reference |  |

### `src/lib/settings/integrations.ts` (5)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 73 | Used by {…} project{…}. | Used by {…} workspace{…}. |  |
| 74 | GitHub is linked; no project uses repository access yet. | GitHub is linked; no workspace uses repository access yet. | Check: may mean the repository |
| 76 | GitHub could not find{…}` : " the linked account"}. Imported project data remains available. | GitHub could not find{…}` : " the linked account"}. Imported workspace data remains available. | Check: may mean the repository |
| 78 | Open a project to manage repository import and synchronization. | Open a workspace to manage repository import and synchronization. | Check: may mean the repository |
| 79 | Repository access becomes active when you connect GitHub from a project. | Repository access becomes active when you connect GitHub from a workspace. | Check: may mean the repository |

### `src/lib/sharing/destination-scope.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 25 | Project conversations | Workspace conversations |  |
| 26 | Projects | Workspaces |  |

### `src/lib/sharing/presentation.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 121 | Public portfolio · {…} projects | Public portfolio · {…} workspaces |  |
| 159 | Draft · unpublished. Sharing this link does not publish the project or grant access. | Draft · unpublished. Sharing this link does not publish the workspace or grant access. |  |
| 163 | This project is unlisted. Anyone with its link can view it, but it is not indexed. | This workspace is unlisted. Anyone with its link can view it, but it is not indexed. |  |

### `src/lib/sharing/read.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 161 | Project on NetworkBase | Workspace on NetworkBase |  |
| 162 | View this project on NetworkBase. | View this workspace on NetworkBase. |  |
| 163 | Project | Workspace |  |

### `src/lib/sharing/social-image.tsx` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 59 | PROJECT | WORKSPACE |  |

### `src/lib/skills/catalog.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 133 | Product Management\|Product Strategy\|Product Discovery\|Product Roadmapping\|Requirements Analysis\|User Research\|User Stories\|Stakeholder Management\|Program Management\|Project Management\|Technical Writing\|Technic… | Product Management\|Product Strategy\|Product Discovery\|Product Roadmapping\|Requirements Analysis\|User Research\|User Stories\|Stakeholder Management\|Program Management\|Workspace Management\|Technical Writing\|Techn… |  |

### `src/lib/skills/service.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 348 | Role not found in this project | Role not found in this workspace |  |

### `src/lib/upload/project-image-upload-client.ts` (2)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 35 | Failed to prepare project avatar upload | Failed to prepare workspace avatar upload |  |
| 45 | Failed to finalize project avatar upload | Failed to finalize workspace avatar upload |  |

### `src/lib/upload/project-upload-allocation.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 12 | Upload request project does not match the allocation scope | Upload request workspace does not match the allocation scope |  |

### `src/lib/upload/upload-intents.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 413 | Failed to lock project upload quota | Failed to lock workspace upload quota |  |
| 611 | exists(select 1 from project_nodes where asset_id = {…}) or exists(select 1 from file_versions where asset_id = {…}) or exists(select 1 from profiles where avatar_asset_id = {…} or banner_asset_id = {…}) or exists(select… | exists(select 1 from project_nodes where asset_id = {…}) or exists(select 1 from file_versions where asset_id = {…}) or exists(select 1 from profiles where avatar_asset_id = {…} or banner_asset_id = {…}) or exists(select… | Check: may mean the repository |
| 744 | Upload intent project mismatch | Upload intent workspace mismatch |  |

### `src/lib/validations/application.ts` (1)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 28 | Invalid project | Invalid workspace |  |

### `src/lib/validations/project.ts` (3)

| Line | Current | Suggested | Note |
|---|---|---|---|
| 126 | Project type is required | Workspace type is required |  |
| 188 | Org only is for projects inside an organization. | Org only is for workspaces inside an organization. |  |
| 219 | Custom project type is required when "Other" is selected. | Custom workspace type is required when "Other" is selected. |  |

## Appendix B. The other terms from the terminology list

Every location of each current term (comment lines skipped).

| Current | Recommended | Locations |
|---|---|---|
| Danger Zone | Workspace management | `components/projects/tabs/ProjectSettingsTab.tsx:2078`, `components/projects/tabs/ProjectSettingsTab.tsx:2305`, `components/projects/v2/sprints/CreateSprintModal.tsx:487`, `components/projects/v2/sprints/CreateSprintModal.tsx:492`, `lib/projects/settings-policies.ts:601` |
| General properties | Profile details | `components/profile/edit/EditProfileTabs.tsx:100`, `components/profile/edit/EditProfileTabs.tsx:243` |
| Personal identity | Basic information | `components/profile/edit/EditProfileTabs.tsx:328`, `components/profile/edit/EditProfileTabs.tsx:331` |
| Social presence | Links and profiles | `components/profile/edit/EditProfileTabs.tsx:103`, `components/profile/edit/EditProfileTabs.tsx:570` |
| Skills & expertise | Skills | `components/profile/edit/EditProfileTabs.tsx:102`, `components/profile/edit/EditProfileTabs.tsx:558`, `components/skills/SkillPicker.tsx:33` |
| Role preferences | Collaboration preferences | `components/profile/OpenToCollaborateBadge.tsx:144`, `components/profile/v2/sections/OpenToRolesCard.tsx:74`, `components/profile/edit/EditProfileTabs.tsx:104`, `components/profile/edit/EditProfileTabs.tsx:579`, `components/profile/v2/ProfileRouteSkeleton.tsx:70` |
| Desired roles | Preferred roles | `components/profile/OpenToCollaborateBadge.tsx:73`, `components/profile/edit/EditProfileTabs.tsx:850`, `components/profile/edit/EditProfileTabs.tsx:889`, `components/profile/v2/sections/OpenToRolesCard.tsx:49` |
| Weekly hours | Weekly availability | `components/profile/OpenToCollaborateBadge.tsx:76`, `components/profile/edit/EditProfileTabs.tsx:924`, `components/profile/v2/sections/OpenToRolesCard.tsx:52` |
| Positions & dates | Roles and dates | `components/profile/edit/ContributionWorkspace.tsx:1262`, `components/profile/edit/ContributionWorkspace.tsx:1332` |
| Contribution summary | Your contribution | `components/profile/edit/ContributionWorkspace.tsx:1303`, `components/profile/edit/ContributionSummaryEditor.tsx:154` |
| Visitor view | View as visitor | `components/profile/edit/ContributionWorkspace.tsx:1248`, `components/profile/edit/ContributionWorkspace.tsx:2392` |
| Link to an existing project | Link to a workspace | `components/profile/edit/ContributionWorkspace.tsx:1298` |
| People and joining | Members and access | `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:108` |
| Build the initial team | Set up your team | `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:119` |
| Lifecycle & Workflow | Stages and workflow | `components/projects/tabs/ProjectSettingsTab.tsx:1881`, `lib/projects/settings-policies.ts:577` |
| Access & Visibility | Access and visibility | `components/organizations/OrgSettingsSections.tsx:209`, `lib/projects/settings-policies.ts:548` |
| Team Members | Members | `lib/projects/settings-policies.ts:554` |
| Roles & Applications | Roles and applications | `lib/projects/settings-policies.ts:559`, `lib/notifications/project-policy.ts:152` |
| Updates & Discussions | Updates and discussions | `lib/projects/settings-policies.ts:571` |
| Files & Storage | Files and storage | `lib/projects/settings-policies.ts:582` |
| Privacy and Policies | Legal and data rights | `app/(legal)/support/page.tsx:82`, `components/projects/tabs/ProjectSettingsTab.tsx:2071`, `lib/projects/settings-policies.ts:595` |
| All declared skills | All skills | `components/network/PersonCardContent.tsx:108` |
| "Issues" | Blocked | `lib/projects/task-workflow.ts:49`, `lib/projects/task-workflow.ts:51`, `lib/projects/sprint-detail.ts:190` |
| "Done" | Completed | `app/actions/project/recent-activity.ts:118`, `components/messages/MessagesViews.tsx:808`, `components/messages/cards/MessageCard.tsx:52`, `components/projects/v2/files-tab/TaskFilesCollection.tsx:636`, `lib/projects/sprint-detail.ts:186`, `lib/projects/task-workflow.ts:60`, `lib/projects/task-workflow.ts:62`, `lib/notifications/presentation.ts:53` |
| 'Done' | Completed | `app/actions/org-workspace.ts:246`, `components/organizations/OrgOverviewParts.tsx:23`, `components/organizations/OrgSprintParts.tsx:211`, `components/organizations/AssignmentsPanel.tsx:36` |
| On Time | On time | `lib/projects/task-presentation.ts:235` |
| "Late" | Overdue | `lib/projects/task-presentation.ts:247` |
| Rolled Over | Incomplete | `components/projects/tabs/sprint/SprintTimelineContent.tsx:190`, `lib/projects/task-presentation.ts:252` |
| Choose a project | Choose a workspace | `app/actions/contribution-stories.ts:518`, `components/projects/v2/files-tab/IdeProjectPicker.tsx:86`, `components/projects/dashboard/InviteCollaboratorModal.tsx:595`, `components/profile/edit/ContributionWorkspace.tsx:2257`, `components/profile/edit/ContributionWorkspace.tsx:2576` |
| Select a project | Choose a workspace | `components/projects/dashboard/InviteCollaboratorModal.tsx:511`, `components/projects/create-wizard/phases/Phase1SourceSelection.tsx:1576` |
| Connect desktop IDE | Connect your code editor | `components/projects/v2/TasksTab.tsx:841`, `components/projects/v2/files-tab/FilesWorkspaceHeader.tsx:501`, `components/projects/v2/tasks/TaskDetailPanel.tsx:415`, `components/projects/v2/files-tab/OpenInIdeButton.tsx:182`, `components/projects/v2/files-tab/OpenInIdeButton.tsx:359` |
| New doc title | Document title | `components/projects/doc/AddDocDialog.tsx:141` |
| Account connections | Sign-in methods | `components/settings/IntegrationsSettings.tsx:436`, `components/layout/header/global-search.ts:179` |
| Active sessions | Signed-in devices | `components/settings/SecuritySettings.tsx:105`, `components/layout/header/global-search.ts:162`, `components/auth/LoginHistory.tsx:153` |
| Login and security activity | Sign-in activity | `components/layout/header/global-search.ts:163` |
| Editor extension sessions | Connected editors | `components/layout/header/global-search.ts:181` |
| Interface density | Display spacing | `components/settings/AppearanceSettings.tsx:94`, `components/layout/header/global-search.ts:176` |
| Project Feed | Updates | `app/(site)/(main)/projects/[slug]/project-route.tsx:63` |
| label: "Dashboard" | Overview | `components/projects/dashboard/ProjectLayout.tsx:77` |
| label: "Docs" | Documents | `components/projects/dashboard/ProjectLayout.tsx:79` |
| readme: "Docs" | Documents | `app/(site)/(main)/projects/[slug]/project-route.tsx:68`, `lib/projects/settings-policies.ts:207` |
| Project picture | Workspace image | `components/projects/create-wizard/useCreateProjectWizard.ts:713`, `components/projects/create-wizard/phases/Phase4Settings.tsx:36`, `components/projects/create-wizard/phases/Phase4Settings.tsx:309`, `components/projects/create-wizard/phases/Phase5Review.tsx:342` |
| Project Lead | Owner | `components/projects/settings/ProjectRolesEditor.tsx:443`, `components/projects/tabs/ProjectSettingsTab.tsx:1572`, `components/projects/settings/CollaboratorCard.tsx:185` |
| Project lead | Owner | `components/organizations/ChildTeamFields.tsx:215`, `components/organizations/ChildTeamFields.tsx:218`, `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:151`, `components/projects/create-wizard/phases/Phase5Review.tsx:315`, `lib/projects/server/lifecycle.ts:1088` |
| project lead | owner | `app/actions/task.ts:412`, `app/actions/task.ts:622`, `app/actions/project/updates.ts:1831`, `app/actions/project/task-completion.ts:77`, `components/organizations/AssignmentsPanel.tsx:135`, `components/organizations/AssignmentsPanel.tsx:136`, `components/projects/tabs/SprintPlanning.tsx:361`, `components/projects/tabs/ProjectSettingsTab.tsx:1470`, `components/projects/tabs/ProjectSettingsTab.tsx:1511`, `components/projects/settings/LifecycleSettingsEditor.tsx:122`, `components/projects/v2/TasksTab.tsx:737`, `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:152`, `components/projects/settings/TaskCompletionSettings.tsx:51`, `components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx:315`, `components/projects/create-wizard/phases/Phase4Settings.tsx:407`, `components/projects/dashboard/ProjectDashboardClient.tsx:1128`, `lib/notifications/project-policy.ts:190`, `lib/projects/task-transition-service.ts:236`, `lib/projects/task-transition-service.ts:257` |
| Co-leader | Admin | `app/actions/project/doc.ts:338`, `components/projects/settings/ProjectRolesEditor.tsx:445`, `components/projects/tabs/ProjectSettingsTab.tsx:1296`, `components/projects/tabs/ProjectSettingsTab.tsx:1482`, `components/projects/tabs/ProjectSettingsTab.tsx:1543`, `components/projects/tabs/ProjectSettingsTab.tsx:1847`, `components/projects/dashboard/ProjectTeamAvatars.tsx:81`, `components/projects/dashboard/InviteCollaboratorModal.tsx:650`, `lib/projects/server/settings.ts:217`, `lib/projects/server/settings.ts:671`, `lib/projects/server/settings.ts:867`, `lib/sharing/read.ts:108`, `lib/projects/settings-policies.ts:150`, `lib/projects/settings-policies.ts:515`, `lib/projects/settings-policies.ts:945`, `lib/projects/settings-policies.ts:950`, `lib/projects/settings-policies.ts:1020`, `lib/projects/server/lifecycle.ts:1862` |
| Co-lead | Admin | `app/actions/project/doc.ts:338`, `components/projects/settings/ProjectRolesEditor.tsx:332`, `components/projects/settings/ProjectRolesEditor.tsx:445`, `components/projects/tabs/ProjectSettingsTab.tsx:1296`, `components/projects/tabs/ProjectSettingsTab.tsx:1482`, `components/projects/tabs/ProjectSettingsTab.tsx:1543`, `components/projects/tabs/ProjectSettingsTab.tsx:1847`, `components/projects/dashboard/InviteCollaboratorModal.tsx:650`, `components/projects/dashboard/ProjectTeamAvatars.tsx:81`, `lib/projects/settings-policies.ts:150`, `lib/projects/settings-policies.ts:515`, `lib/projects/settings-policies.ts:945`, `lib/projects/settings-policies.ts:950`, `lib/projects/settings-policies.ts:1020`, `lib/projects/server/settings.ts:217`, `lib/projects/server/settings.ts:671`, `lib/projects/server/settings.ts:867`, `lib/projects/server/lifecycle.ts:1862`, `lib/sharing/read.ts:108`, `lib/profile/contribution-position.ts:3`, `lib/profile/collaboration.ts:298`, `lib/profile/collaboration.ts:1158` |
| "Lead" | Owner | `components/projects/tabs/ProjectSettingsTab.tsx:324`, `components/projects/settings/ProjectRolesEditor.tsx:316`, `components/projects/settings/ProjectRolesEditor.tsx:330`, `components/projects/settings/ProjectRolesEditor.tsx:469`, `lib/projects/settings-policies.ts:149`, `lib/projects/server/settings.ts:623`, `lib/profile/contribution-position.ts:2`, `lib/profile/collaboration.ts:296` |
| Unit lead | Team lead | `components/organizations/ChildTeamFields.tsx:149`, `components/organizations/ChildUnitsPanel.tsx:53`, `components/organizations/ChildUnitsPanel.tsx:54`, `components/organizations/ChildUnitsPanel.tsx:63`, `components/projects/create-wizard/phases/Phase5Review.tsx:330` |
| unit lead | team lead | `app/actions/child-units.ts:73`, `app/actions/child-units.ts:80`, `components/organizations/OrgOverviewParts.tsx:224`, `components/organizations/ChildTeamFields.tsx:149`, `components/organizations/ChildTeamFields.tsx:196`, `components/organizations/ChildUnitsPanel.tsx:40`, `components/organizations/ChildUnitsPanel.tsx:55`, `components/projects/tabs/ProjectSettingsTab.tsx:218`, `lib/projects/server/lifecycle.ts:1104`, `lib/validations/project.ts:203` |
| Phase 2 · | Step 2 · | `components/projects/create-wizard/phases/Phase5Review.tsx:242`, `components/projects/create-wizard/phases/Phase2Information.tsx:123` |
| Phase 3 · | Step 3 · | `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:107`, `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:118`, `components/projects/create-wizard/phases/Phase5Review.tsx:314` |
| Create project | Create workspace | `app/(site)/(main)/projects/new/page.tsx:12`, `components/organizations/OrgOverviewParts.tsx:165`, `components/organizations/OrgSettingsSections.tsx:261`, `components/projects/create-wizard/WizardHeader.tsx:29`, `components/projects/create-wizard/phases/Phase5Review.tsx:202`, `components/projects/create-wizard/phases/Phase5Review.tsx:411`, `components/projects/create-wizard/WizardFooter.tsx:88`, `lib/organizations/assignments.ts:81` |
| Start a project | Create a workspace | `app/(site)/page.tsx:26` |
| Details · optional | About you · optional | `lib/onboarding/step-ui-config.ts:23` |

## Appendix C. Role and people wording

User-facing strings using lead, co-lead, collaborator, assignee, guide or onboarding.

| Location | Current | Suggested |
|---|---|---|
| `app/(legal)/acceptable-use/page.tsx:10` | These rules protect collaborators, projects, repositories, and NetworkBase infrastructure. | These rules protect members, workspaces, repositories, and NetworkBase infrastructure. |
| `app/(legal)/cookies/page.tsx:12` | The browser may use localStorage, IndexedDB, Cache Storage, or similar technologies for cached application data, offline message delivery, unsaved work, file-editor state, onboarding drafts, and extension recovery. Some … | The browser may use localStorage, IndexedDB, Cache Storage, or similar technologies for cached application data, offline message delivery, unsaved work, file-editor state, profile setup drafts, and extension recovery. So… |
| `app/(legal)/copyright/page.tsx:13` | We may request clarification, preserve evidence, restrict access, notify the affected user, or reject incomplete or abusive requests. A restriction does not decide ownership. Repeated infringement or fraudulent complaint… | We may request clarification, preserve evidence, restrict access, notify the affected user, or reject incomplete or abusive requests. A restriction does not decide ownership. Repeated infringement or fraudulent complaint… |
| `app/(legal)/dpa/page.tsx:13` | Data subjects: customer-authorised users, collaborators, invitees, and people described in customer content. | Data subjects: customer-authorised users, members, invitees, and people described in customer content. |
| `app/(legal)/eula/page.tsx:13` | NetworkBase and its licensors own the software, interface, service marks, and platform materials. This EULA grants a licence, not a sale. You retain rights in your original project content. No provision transfers your co… | NetworkBase and its licensors own the software, interface, service marks, and platform materials. This EULA grants a licence, not a sale. You retain rights in your original workspace content. No provision transfers your … |
| `app/(legal)/privacy/page.tsx:23` | (registration and onboarding), | (registration and profile setup), |
| `app/(legal)/privacy/page.tsx:34` | Onboarding telemetry: up to 90 days; extension session events: up to 180 days. | Profile setup telemetry: up to 90 days; extension session events: up to 180 days. |
| `app/(legal)/privacy/page.tsx:38` | Deleting an account first hides the profile and begins a 30-day grace period. Before deletion, project owners should transfer projects they want collaborators to retain and export needed information. Permanent deletion c… | Deleting an account first hides the profile and begins a 30-day grace period. Before deletion, workspace owners should transfer workspaces they want members to retain and export needed information. Permanent deletion can… |
| `app/(legal)/security-reporting/page.tsx:17` | To protect members and collaborators against phishing, spoofing, and domain impersonation, NetworkBase sends all official, transactional, and administrative emails exclusively from the verified | To protect members and members against phishing, spoofing, and domain impersonation, NetworkBase sends all official, transactional, and administrative emails exclusively from the verified |
| `app/(legal)/security-reporting/page.tsx:19` | : Account activation, member registration, and onboarding completion messages. | : Account activation, member registration, and profile setup completion messages. |
| `app/(legal)/support/page.tsx:184` | : Account registration, onboarding steps, and confirmation notices. | : Account registration, profile setup steps, and confirmation notices. |
| `app/(legal)/terms/page.tsx:18` | 6. Projects and collaborators | 6. Workspaces and members |
| `app/(legal)/terms/page.tsx:18` | NetworkBase does not decide private ownership, employment, compensation, equity, or confidentiality disputes among collaborators. | NetworkBase does not decide private ownership, employment, compensation, equity, or confidentiality disputes among members. |
| `app/(site)/(auth)/signup/page.tsx:6` | Create a NetworkBase account to find collaborators and build projects together. | Create a NetworkBase account to find members and build workspaces together. |
| `app/(site)/(main)/network/page.tsx:10` | Discover collaborators, manage your network, and respond to incoming requests on NetworkBase. | Discover members, manage your network, and respond to incoming requests on NetworkBase. |
| `app/(site)/page.tsx:14` | Discover projects, find collaborators by skill, and bring tasks, files and conversations together in one workspace. | Discover workspaces, find members by skill, and bring tasks, files and conversations together in one workspace. |
| `app/(site)/page.tsx:25` | Profiles are built around skills and contributions. Find collaborators and start a conversation. | Profiles are built around skills and contributions. Find members and start a conversation. |
| `app/(site)/page.tsx:87` | Design the onboarding screens | Design the profile setup screens |
| `app/(site)/page.tsx:197` | Invite collaborators and agree on the next steps. | Invite members and agree on the next steps. |
| `app/(site)/page.tsx:230` | Find collaborators, join projects, and build together in one workspace. | Find members, join workspaces, and build together in one workspace. |
| `app/actions/account.ts:340` | You are now a co-leader | You are now a admin |
| `app/actions/applications/internal.ts:705` | Guide | Mentor |
| `app/actions/applications/internal.ts:706` | Collaborator | Member |
| `app/actions/applications/internal.ts:1992` | Collaborator | Member |
| `app/actions/applications/internal.ts:2294` | Collaborator | Member |
| `app/actions/child-units.ts:73` | The unit lead must be in the unit. | The team lead must be in the team. |
| `app/actions/child-units.ts:80` | You're unit lead of {…} | You're team lead of {…} |
| `app/actions/connections.ts:1091` | {…} IN ('senior', 'lead', 'founder') | {…} IN ('senior', 'lead', 'founder') |
| `app/actions/connections.ts:1202` | {…} IN ('senior', 'lead', 'founder') | {…} IN ('senior', 'lead', 'founder') |
| `app/actions/files/mutations.ts:215` | This folder or one of its contents is currently locked by another collaborator | This folder or one of its contents is currently locked by another member |
| `app/actions/network-invitations.ts:132` | WITH entries AS ( {…}` : sql` SELECT c.id,'connection'::text AS source,CASE WHEN c.requester_id={…}::uuid THEN 'sent' ELSE 'received' END AS direction, c.created_at,c.message AS note,NULL::uuid AS project_id,NULL::text A… | WITH entries AS ( {…}` : sql` SELECT c.id,'connection'::text AS source,CASE WHEN c.requester_id={…}::uuid THEN 'sent' ELSE 'received' END AS direction, c.created_at,c.message AS note,NULL::uuid AS project_id,NULL::text A… |
| `app/actions/onboarding.ts:103` | Invalid onboarding input | Invalid profile setup input |
| `app/actions/onboarding.ts:104` | Unable to complete onboarding right now | Unable to complete profile setup right now |
| `app/actions/onboarding.ts:197` | Verify your email before completing onboarding. | Verify your email before completing profile setup. |
| `app/actions/onboarding.ts:380` | Complete the final step to finish onboarding. | Complete the final step to finish profile setup. |
| `app/actions/onboarding.ts:503` | This onboarding draft changed in another tab. The latest version is ready to review. | This profile setup draft changed in another tab. The latest version is ready to review. |
| `app/actions/org-dashboard.ts:272` | Lead | Owner |
| `app/actions/org-members.ts:368` | This person leads a project here. Transfer or detach it first. | This person leads a workspace here. Transfer or detach it first. |
| `app/actions/organizations.ts:333` | You lead {…} {…} here. Transfer or detach {…} first. | You lead {…} {…} here. Transfer or detach {…} first. |
| `app/actions/project/doc.ts:338` | Co-leader | Admin |
| `app/actions/project/guidance.ts:125` | Only the project Lead can appoint a Guide | Only the owner can appoint a Mentor |
| `app/actions/project/guidance.ts:151` | A collaborator | A member |
| `app/actions/project/task-completion.ts:77` | Only project leads can change completion settings | Only workspace leads can change completion settings |
| `app/actions/task.ts:412` | Only the assignee or a project lead can move this task. | Only the assignee or a owner can move this task. |
| `app/actions/task.ts:521` | Assignee must be a project member | Assigned to must be a workspace member |
| `app/actions/task.ts:524` | Assignee must be an assignable project member | Assigned to must be an assignable workspace member |
| `app/actions/task.ts:622` | Only project leads can approve tasks | Only workspace leads can approve tasks |
| `app/actions/task.ts:628` | Task requirements, subtasks or files changed after submission. Ask the assignee to resubmit before approving. | Task requirements, subtasks or files changed after submission. Ask the assignee to resubmit before approving. |
| `app/api/v1/extension/task-detail/route.ts:123` | Collaborator | Member |
| `app/api/v1/profiles/[id]/project-invites/route.ts:39` | Choose another collaborator to invite | Choose another member to invite |
| `components/auth/SignupForm.tsx:371` | Find collaborators and build projects together. | Find members and build workspaces together. |
| `components/layout/header/global-search.ts:233` | Find builders & collaborators... | Find builders & members... |
| `components/messages/ConversationView.tsx:553` | With {…} · Lead of {…} | With {…} · Lead of {…} |
| `components/onboarding/OnboardingSidebar.tsx:22` | Build a profile that helps the right collaborators find you. | Build a profile that helps the right members find you. |
| `components/onboarding/steps/Step1Identity.tsx:121` | Use the name you want collaborators to see. | Use the name you want members to see. |
| `components/onboarding/steps/Step2Details.tsx:123` | A concise headline and enough context for collaborators to recognise your strengths. | A concise headline and enough context for members to recognise your strengths. |
| `components/onboarding/steps/Step3Skills.tsx:34` | Optional topics help refine project and collaborator recommendations. | Optional topics help refine workspace and member recommendations. |
| `components/organizations/AssignmentsPanel.tsx:135` | Creates {…} copies · one per project lead | Creates {…} copies · one per owner |
| `components/organizations/AssignmentsPanel.tsx:136` | Creates {…} copies · one per project lead | Creates {…} copies · one per owner |
| `components/organizations/AssignmentsPanel.tsx:219` | Make team lead | Make team lead |
| `components/organizations/ChildOrgSection.tsx:121` | They can open, archive and detach this project. Only the lead deletes it or transfers it. | They can open, archive and detach this workspace. Only the owner deletes it or transfers it. |
| `components/organizations/ChildOrgSection.tsx:131` | The lead asked to detach. | The owner asked to detach. |
| `components/organizations/ChildOrgSection.tsx:154` | Everything becomes read-only. The lead can unarchive it. | Everything becomes read-only. The owner can unarchive it. |
| `components/organizations/ChildOrgSection.tsx:154` | It becomes a Private personal project of its lead. | It becomes a Private personal workspace of its owner. |
| `components/organizations/ChildTeamFields.tsx:149` | {…} is unit lead | {…} is team lead |
| `components/organizations/ChildTeamFields.tsx:149` | Make {…} unit lead | Make {…} team lead |
| `components/organizations/ChildTeamFields.tsx:149` | Unit lead | Team lead |
| `components/organizations/ChildTeamFields.tsx:149` | Make unit lead | Make team lead |
| `components/organizations/ChildTeamFields.tsx:196` | Optional: pick a unit lead ★ for its mentions and reminders. | Optional: pick a team lead ★ for its mentions and reminders. |
| `components/organizations/ChildTeamFields.tsx:215` | Project lead | Owner |
| `components/organizations/ChildTeamFields.tsx:216` | The lead owns the project. You stay an admin through | The owner owns the workspace. You stay an admin through |
| `components/organizations/ChildTeamFields.tsx:218` | Project lead | Owner |
| `components/organizations/ChildUnitsPanel.tsx:40` | The team by unit. The unit lead ★ gets the unit&apos;s mentions and reminders. | The team by team. The team lead ★ gets the team&apos;s mentions and reminders. |
| `components/organizations/ChildUnitsPanel.tsx:53` | Unit lead of {…} | Team lead of {…} |
| `components/organizations/ChildUnitsPanel.tsx:54` | Unit lead saved | Team lead saved |
| `components/organizations/ChildUnitsPanel.tsx:55` | No unit lead | No team lead |
| `components/organizations/ChildUnitsPanel.tsx:63` | Unit lead | Team lead |
| `components/organizations/OrgDangerZone.tsx:180` | Give them to their leads as personal projects (now) | Give them to their leads as personal workspaces (now) |
| `components/organizations/OrgOverviewParts.tsx:173` | (lead) · | (lead) · |
| `components/organizations/OrgOverviewParts.tsx:224` | ★ unit lead | ★ team lead |
| `components/profile/edit/EditProfileTabs.tsx:608` | Optional topics that help refine project and collaborator recommendations. | Optional topics that help refine workspace and member recommendations. |
| `components/projects/create-wizard/phases/Phase2Information.tsx:126` | Describe what you are building so collaborators can understand its purpose and find it later. | Describe what you are building so members can understand its purpose and find it later. |
| `components/projects/create-wizard/phases/Phase2Information.tsx:231` | Use a clear, specific name that collaborators can recognize. | Use a clear, specific name that members can recognize. |
| `components/projects/create-wizard/phases/Phase2Information.tsx:261` | Give future collaborators enough context to decide whether the project is a fit. | Give future members enough context to decide whether the workspace is a fit. |
| `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:120` | Confirm your lead role, then add only the openings you plan to recruit for now. | Confirm your owner role, then add only the openings you plan to recruit for now. |
| `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:151` | Project lead | Owner |
| `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:152` | You are the project lead. Add a focus area if it helps collaborators understand how you will guide the work. | You are the owner. Add a focus area if it helps members understand how you will guide the work. |
| `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:157` | Lead | Owner |
| `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:162` | Lead focus | Your role |
| `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:174` | Optional. This appears with your lead role in the project summary. | Optional. This appears with your owner role in the workspace summary. |
| `components/projects/create-wizard/phases/Phase3TeamRoles.tsx:184` | Invite the right collaborators | Invite the right members |
| `components/projects/create-wizard/phases/Phase4Settings.tsx:323` | Private · collaborators only | Private · members only |
| `components/projects/create-wizard/phases/Phase4Settings.tsx:334` | Only collaborators can access the project until you make it public. | Only members can access the workspace until you make it public. |
| `components/projects/create-wizard/phases/Phase4Settings.tsx:379` | Collaborators only. Public-tab choices take effect after you make the project public. | Members only. Public-tab choices take effect after you make the workspace public. |
| `components/projects/create-wizard/phases/Phase5Review.tsx:202` | Confirm what collaborators will see at launch. Use Edit to return to the relevant phase; the project is created only when you choose Create project in the footer. | Confirm what members will see at launch. Use Edit to return to the relevant phase; the workspace is created only when you choose Create workspace in the footer. |
| `components/projects/create-wizard/phases/Phase5Review.tsx:252` | · lead picked by you | · lead picked by you |
| `components/projects/create-wizard/phases/Phase5Review.tsx:315` | Project lead | Owner |
| `components/projects/create-wizard/phases/Phase5Review.tsx:316` | Lead | Owner |
| `components/projects/create-wizard/phases/Phase5Review.tsx:330` | Unit lead | Team lead |
| `components/projects/create-wizard/phases/Phase5Review.tsx:349` | Only collaborators can access the project at launch. | Only members can access the workspace at launch. |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:192` | Guide | Mentor |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:274` | Guide | Mentor |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:485` | Unable to verify the Guide appointment | Unable to verify the Mentor appointment |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:495` | Unable to verify the Guide appointment | Unable to verify the Mentor appointment |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:517` | This project already has an active Guide | This workspace already has an active Mentor |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:517` | This person has reached the active Guide limit | This person has reached the active Mentor limit |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:579` | Invitation sent. This person is nearing their Guide capacity. | Invitation sent. This person is nearing their Mentor capacity. |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:633` | Invite Collaborator | Invite Member |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:648` | Invite as Guide | Invite as Mentor |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:650` | Checking Guide availability… | Checking Mentor availability… |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:650` | This person has reached the active Guide appointment limit. | This person has reached the active Mentor appointment limit. |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:650` | This person is nearing their active Guide appointment capacity. | This person is nearing their active Mentor appointment capacity. |
| `components/projects/dashboard/InviteCollaboratorModal.tsx:650` | On acceptance, this appointment uses the project’s existing Co-leader access. | On acceptance, this appointment uses the workspace’s existing Admin access. |
| `components/projects/dashboard/OpenRolesCard.tsx:101` | Guide | Mentor |
| `components/projects/dashboard/ProjectTeamAvatars.tsx:81` | {…} · Co-leader | {…} · Admin |
| `components/projects/doc/ProjectDocSmartBlock.tsx:22` | Active project contributors and collaborators. | Active workspace contributors and members. |
| `components/projects/doc/ProjectDocSmartBlock.tsx:96` | {…} collaborator{…} visible | {…} member{…} visible |
| `components/projects/settings/CollaboratorCard.tsx:185` | Project Lead | Owner |
| `components/projects/settings/CollaboratorSearchField.tsx:8` | Search collaborators | Search members |
| `components/projects/settings/CollaboratorSearchField.tsx:8` | Search collaborators by name, username, or role... | Search members by name, username, or role... |
| `components/projects/settings/LifecycleSettingsEditor.tsx:122` | Stages define the progression milestones shown on your project overview and roadmap. As your team completes deliverables, project leads can advance through these stages directly from the project dashboard header. | Stages define the progression milestones shown on your workspace overview and roadmap. As your team completes deliverables, workspace leads can advance through these stages directly from the workspace dashboard header. |
| `components/projects/settings/ProjectRolesEditor.tsx:208` | Add one or more roles to publish positions and invite collaborators. | Add one or more roles to publish positions and invite members. |
| `components/projects/settings/ProjectRolesEditor.tsx:316` | Lead | Owner |
| `components/projects/settings/ProjectRolesEditor.tsx:330` | Lead | Owner |
| `components/projects/settings/ProjectRolesEditor.tsx:332` | Co-lead | Admin |
| `components/projects/settings/ProjectRolesEditor.tsx:443` | Project Lead | Owner |
| `components/projects/settings/ProjectRolesEditor.tsx:445` | Co-leader | Admin |
| `components/projects/settings/ProjectRolesEditor.tsx:469` | Lead | Owner |
| `components/projects/settings/ProjectRolesEditor.tsx:494` | Lead Role · Fixed (1 Seat) | Lead Role · Fixed (1 Seat) |
| `components/projects/settings/ProjectRolesEditor.tsx:521` | e.g. Frontend Lead | e.g. Frontend Lead |
| `components/projects/settings/TaskCompletionSettings.tsx:51` | Choose whether completed work needs a project lead’s approval. | Choose whether completed work needs a owner’s approval. |
| `components/projects/settings/TaskCompletionSettings.tsx:82` | Off: marking a task as done completes it immediately. On: it enters In review until a project owner or co-leader approves it. | Off: marking a task as done completes it immediately. On: it enters In review until a workspace owner or admin approves it. |
| `components/projects/tabs/ProjectSettingsTab.tsx:218` | Units, their seats and unit leads; open seats org members can apply to. | Teams, their seats and team leads; open seats org members can apply to. |
| `components/projects/tabs/ProjectSettingsTab.tsx:324` | Lead | Owner |
| `components/projects/tabs/ProjectSettingsTab.tsx:507` | Failed to load collaborators. | Failed to load members. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1192` | {…} will move from {…} to {…}. This updates collaborator permissions, task/file access, application review affordances, notifications, and project audit history. | {…} will move from {…} to {…}. This updates member permissions, task/file access, application review affordances, notifications, and workspace audit history. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1239` | Choose a replacement assignee. | Choose a replacement assignee. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1294` | Settings require collaborator management access | Settings require member management access |
| `components/projects/tabs/ProjectSettingsTab.tsx:1296` | Leads can manage every setting. Co-leaders can manage member and viewer lifecycle. Ask the lead for access if you need to change collaborators. | Leads can manage every setting. Admins can manage member and viewer lifecycle. Ask the owner for access if you need to change members. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1321` | Clear this member from active task assignee fields while preserving creator/comment/file history. | Clear this member from active task assignee fields while preserving creator/comment/file history. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1322` | Move active assigned tasks to another eligible active collaborator. | Move active assigned tasks to another eligible active member. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1343` | Replacement assignee | Replacement assignee |
| `components/projects/tabs/ProjectSettingsTab.tsx:1356` | No eligible replacement assignee is available. | No eligible replacement assignee is available. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1431` | Control whether this project is discoverable across the platform or restricted to workspace collaborators. | Control whether this workspace is discoverable across the platform or restricted to workspace members. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1470` | Visibility is managed by the project lead | Visibility is managed by the owner |
| `components/projects/tabs/ProjectSettingsTab.tsx:1508` | Collaborators | Members |
| `components/projects/tabs/ProjectSettingsTab.tsx:1539` | Filter collaborators by role | Filter members by role |
| `components/projects/tabs/ProjectSettingsTab.tsx:1595` | Lead record is unavailable. | Lead record is unavailable. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1620` | Promote a trusted member to co-leader when they need full project workflow permissions without receiving destructive lead actions. | Promote a trusted member to admin when they need full workspace workflow permissions without receiving destructive lead actions. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1661` | No collaborators found | No members found |
| `components/projects/tabs/ProjectSettingsTab.tsx:1664` | No collaborators matched "{…}". Try a different name or role. | No members matched "{…}". Try a different name or role. |
| `components/projects/tabs/ProjectSettingsTab.tsx:1702` | Load more collaborators | Load more members |
| `components/projects/tabs/ProjectSettingsTab.tsx:1717` | Define open positions for collaborators, set target headcounts, and customize skill profiles for application intake. | Define open positions for members, set target headcounts, and customize skill profiles for application intake. |
| `components/projects/tabs/SprintPlanning.tsx:361` | No sprints have been planned yet. Sprints created by project leads will appear here. | No sprints have been planned yet. Sprints created by workspace leads will appear here. |
| `components/projects/v2/TasksTab.tsx:737` | Marking work as done submits it for review. A project lead approves completion. | Marking work as done submits it for review. A owner approves completion. |
| `components/projects/v2/tasks/CreateTaskModal.tsx:409` | Assignee | Assigned to |
| `components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx:315` | Waiting for a project lead’s approval. Approving completes this task; file publication remains separate. | Waiting for a owner’s approval. Approving completes this task; file publication remains separate. |
| `components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx:794` | Assignee | Assigned to |
| `components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx:806` | Select assignee | Select assignee |
| `components/projects/v2/tasks/components/TaskFilesEmptyState.tsx:59` | The system will guide version updates, folder placement, and existing-file linking so the task starts cleanly and ends with a clear output. | The system will guide version updates, folder placement, and existing-file linking so the task starts cleanly and ends with a clear output. |
| `components/settings/AccountDeletionWizard.tsx:146` | to a new lead in | to a new owner in |
| `hooks/useFileVersions.ts:192` | File is locked by another collaborator | File is locked by another member |
| `inngest/functions/git-sync.ts:64` | Git pull deferred because a collaborator is editing a file until {…} | Git pull deferred because a member is editing a file until {…} |
| `lib/data/discover.ts:912` | Lead / {…} | Lead / {…} |
| `lib/data/discover.ts:912` | Lead | Owner |
| `lib/email/contracts.ts:241` | Collaborator | Member |
| `lib/email/contracts.ts:506` | Collaborator | Member |
| `lib/feedback/copy.ts:1202` | Couldn’t load collaborators. | Couldn’t load members. |
| `lib/feedback/copy.ts:1667` | Guide capacity nearly full. | Mentor capacity nearly full. |
| `lib/legal/config.ts:19` | Account onboarding, confirmation, and welcome messages | Account profile setup, confirmation, and welcome messages |
| `lib/messaging/application-meta.ts:8` | ( SELECT jsonb_build_object( 'status', a.status::text, 'role_title', coalesce(r.title, r.role), 'role_removed', a.role_id IS NULL, 'project_title', p.title, 'project_slug', p.slug, 'decision_at', a.decision_at, 'created_… | ( SELECT jsonb_build_object( 'status', a.status::text, 'role_title', coalesce(r.title, r.role), 'role_removed', a.role_id IS NULL, 'project_title', p.title, 'project_slug', p.slug, 'decision_at', a.decision_at, 'created_… |
| `lib/messaging/canvas-store.ts:67` | Onboarding checklist | Profile setup checklist |
| `lib/messaging/cards.ts:46` | SELECT t.id, t.title, t.status::text AS status, t.priority, t.due_date, t.task_number, t.project_id, p.key AS project_key, p.slug AS project_slug, p.title AS project_title, CASE WHEN asg.id IS NULL THEN NULL ELSE {…} END… | SELECT t.id, t.title, t.status::text AS status, t.priority, t.due_date, t.task_number, t.project_id, p.key AS project_key, p.slug AS project_slug, p.title AS project_title, CASE WHEN asg.id IS NULL THEN NULL ELSE {…} END… |
| `lib/notifications/project-policy.ts:164` | Org sprints starting and closing, and sprint steps for leads and admins. | Org sprints starting and closing, and sprint steps for leads and admins. |
| `lib/notifications/project-policy.ts:491` | Task created with assignee | Task created with assignee |
| `lib/notifications/project-policy.ts:492` | Notify the assignee when a new task is created for them. | Notify the assignee when a new task is created for them. |
| `lib/notifications/project-policy.ts:507` | Notify the new assignee when task ownership changes. | Notify the new assignee when task ownership changes. |
| `lib/notifications/project-policy.ts:864` | The project's lead hears the answer. | The workspace's lead hears the answer. |
| `lib/notifications/project-policy.ts:874` | Leads hear when a seat opens or an org rule changes their project. | Leads hear when a seat opens or an org rule changes their workspace. |
| `lib/notifications/project-policy.ts:877` | Leads hear to plan or close their linked sprint; admins hear a sprint couldn't start. | Leads hear to plan or close their linked sprint; admins hear a sprint couldn't start. |
| `lib/onboarding/step-ui-config.ts:22` | All optional. Add what helps collaborators, or skip for now. | All optional. Add what helps members, or skip for now. |
| `lib/organizations/dashboard-rules.ts:21` | lead left the organization | lead left the organization |
| `lib/organizations/doc-rules.ts:8` | Guides & policies | Mentors & policies |
| `lib/organizations/needs-you.ts:62` | {…} needs a new lead | {…} needs a new owner |
| `lib/organizations/succession.ts:68` | You're the lead of {…} | You're the owner of {…} |
| `lib/profile/collaboration.ts:296` | Lead | Owner |
| `lib/profile/collaboration.ts:298` | Co-lead | Admin |
| `lib/profile/collaboration.ts:324` | Collaborator | Member |
| `lib/profile/collaboration.ts:535` | WITH user_project_candidates AS ( SELECT id FROM {…} WHERE owner_id = {…}::uuid AND deleted_at IS NULL UNION SELECT project_id AS id FROM project_members WHERE user_id = {…}::uuid UNION SELECT project_id AS id FROM {…} W… | WITH user_project_candidates AS ( SELECT id FROM {…} WHERE owner_id = {…}::uuid AND deleted_at IS NULL UNION SELECT project_id AS id FROM project_members WHERE user_id = {…}::uuid UNION SELECT project_id AS id FROM {…} W… |
| `lib/profile/collaboration.ts:1135` | INSERT INTO {…} ( profile_id, project_id, source, role_kind, role_title, skills, started_at, verified_at, verified_by, visibility, updated_at ) SELECT {…}, p.id, CASE WHEN ra.accepted_role_title IS NULL THEN CASE WHEN p.… | INSERT INTO {…} ( profile_id, project_id, source, role_kind, role_title, skills, started_at, verified_at, verified_by, visibility, updated_at ) SELECT {…}, p.id, CASE WHEN ra.accepted_role_title IS NULL THEN CASE WHEN p.… |
| `lib/profile/contribution-position.ts:2` | Lead | Owner |
| `lib/profile/contribution-position.ts:3` | Co-lead | Admin |
| `lib/profile/role-preferences.ts:45` | Lead | Owner |
| `lib/projects/collaborator-lifecycle.ts:387` | You do not have permission to manage this collaborator | You do not have permission to manage this member |
| `lib/projects/collaborator-lifecycle.ts:589` | You do not have permission to remove this collaborator | You do not have permission to remove this member |
| `lib/projects/collaborator-lifecycle.ts:603` | Choose a valid replacement assignee | Choose a valid replacement assignee |
| `lib/projects/collaborator-lifecycle.ts:606` | Replacement assignee must be an assignable project member | Replacement assignee must be an assignable workspace member |
| `lib/projects/doc-quality.ts:129` | Add install, setup, or first-run instructions for new collaborators. | Add install, setup, or first-run instructions for new members. |
| `lib/projects/doc-quality.ts:131` | Missing contribution guide | Missing contribution guide |
| `lib/projects/doc-quality.ts:131` | Explain how collaborators should participate, apply, or ask for help. | Explain how members should participate, apply, or ask for help. |
| `lib/projects/merge-sandbox.ts:88` | Task merge deferred because a collaborator is editing an affected file | Task merge deferred because a member is editing an affected file |
| `lib/projects/project-invitations.ts:91` | Choose another collaborator to invite | Choose another member to invite |
| `lib/projects/project-invitations.ts:155` | Only the project Lead can appoint a guidance co-leader | Only the owner can appoint a guidance admin |
| `lib/projects/project-invitations.ts:176` | Collaborator | Member |
| `lib/projects/project-invitations.ts:176` | Collaborator | Member |
| `lib/projects/project-invitations.ts:282` | Only the inviter or project Lead can cancel this invitation | Only the inviter or owner can cancel this invitation |
| `lib/projects/project-invitations.ts:342` | Guide | Mentor |
| `lib/projects/project-invitations.ts:376` | Guide | Mentor |
| `lib/projects/project-invitations.ts:377` | Collaborator | Member |
| `lib/projects/server/lifecycle.ts:638` | Only admins pick someone else as lead. | Only admins pick someone else as lead. |
| `lib/projects/server/lifecycle.ts:640` | The lead must be a member of {…}. | The owner must be a member of {…}. |
| `lib/projects/server/lifecycle.ts:1084` | You lead {…} | You lead {…} |
| `lib/projects/server/lifecycle.ts:1088` | Project lead | Owner |
| `lib/projects/server/lifecycle.ts:1104` | You're unit lead of {…} | You're team lead of {…} |
| `lib/projects/server/lifecycle.ts:1862` | Only the Lead or a Co-leader can update project links. | Only the owner or a Admin can update workspace links. |
| `lib/projects/server/settings.ts:217` | Co-leader | Admin |
| `lib/projects/server/settings.ts:623` | Lead | Owner |
| `lib/projects/server/settings.ts:654` | You do not have permission to manage collaborators. | You do not have permission to manage members. |
| `lib/projects/server/settings.ts:660` | Failed to load collaborators. | Failed to load members. |
| `lib/projects/server/settings.ts:671` | Co-leader · always on | Admin · always on |
| `lib/projects/server/settings.ts:867` | Owner and Co-leader upload access is always on. | Owner and Admin upload access is always on. |
| `lib/projects/server/settings.ts:1452` | Invalid collaborator role. | Invalid member role. |
| `lib/projects/server/settings.ts:1484` | Failed to update collaborator role. | Failed to update member role. |
| `lib/projects/server/settings.ts:1544` | Updated collaborator role to {…}. | Updated member role to {…}. |
| `lib/projects/server/settings.ts:1545` | Collaborator already has that role. | Member already has that role. |
| `lib/projects/server/settings.ts:1552` | Failed to update collaborator role. | Failed to update member role. |
| `lib/projects/server/settings.ts:1619` | You do not have permission to remove this collaborator. | You do not have permission to remove this member. |
| `lib/projects/server/settings.ts:1700` | You do not have permission to remove this collaborator. | You do not have permission to remove this member. |
| `lib/projects/server/settings.ts:1792` | Failed to remove collaborator. | Failed to remove member. |
| `lib/projects/server/settings.ts:1850` | Collaborator removed. Historical references were preserved. | Member removed. Historical references were preserved. |
| `lib/projects/server/settings.ts:1857` | Failed to remove collaborator. | Failed to remove member. |
| `lib/projects/server/tasks.ts:943` | Assignee must be a project member | Assigned to must be a workspace member |
| `lib/projects/server/tasks.ts:946` | Assignee must be an assignable project member | Assigned to must be an assignable workspace member |
| `lib/projects/settings-policies.ts:149` | Lead | Owner |
| `lib/projects/settings-policies.ts:150` | Co-leader | Admin |
| `lib/projects/settings-policies.ts:492` | Former collaborator | Former member |
| `lib/projects/settings-policies.ts:515` | Co-leader | Admin |
| `lib/projects/settings-policies.ts:891` | Application review and collaborator controls | Application review and member controls |
| `lib/projects/settings-policies.ts:945` | Only the project owner or a Co-leader can manage collaborators. | Only the workspace owner or a Admin can manage members. |
| `lib/projects/settings-policies.ts:979` | {…} will keep {…} as historical assignee and show Needs reassignment. | {…} will keep {…} as historical assignee and show Needs reassignment. |
| `lib/projects/task-transition-service.ts:236` | Only the assignee or a project lead can move this task. | Only the assignee or a owner can move this task. |
| `lib/projects/task-transition-service.ts:257` | Only project leads can request changes. | Only workspace leads can request changes. |
| `lib/projects/updates.ts:241` | co lead | co lead |
| `lib/sharing/read.ts:108` | {…} · Co-leader | {…} · Admin |
| `lib/skills/catalog.ts:162` | Sales\|Business Development\|Account Management\|Customer Success\|Customer Support\|Lead Generation\|Sales Operations\|Financial Modeling\|Accounting\|Recruiting\|People Operations\|Procurement\|Operations Management\|L… | Sales\|Business Development\|Account Management\|Customer Success\|Customer Support\|Lead Generation\|Sales Operations\|Financial Modeling\|Accounting\|Recruiting\|People Operations\|Procurement\|Operations Management\|L… |
| `lib/validations/project.ts:203` | The unit lead must be in the unit. | The team lead must be in the team. |

## Appendix D. Folders and files to rename

Mechanical rule: `project` → `workspace`, `Project` → `Workspace` in the path. Do the existing `workspace` names (§5) first, so nothing collides.

### Folders

| Current | Proposed |
|---|---|
| `src/app/(site)/(main)/messages/(lists)/p/[projectId]` | `src/app/(site)/(main)/messages/(lists)/p/[workspaceId]` |
| `src/app/(site)/(main)/projects` | `src/app/(site)/(main)/workspaces` |
| `src/app/actions/project` | `src/app/actions/workspace` |
| `src/app/api/og/project` | `src/app/api/og/workspace` |
| `src/app/api/v1/discover/projects` | `src/app/api/v1/discover/workspaces` |
| `src/app/api/v1/extension/project-summary` | `src/app/api/v1/extension/workspace-summary` |
| `src/app/api/v1/extension/project-tasks` | `src/app/api/v1/extension/workspace-tasks` |
| `src/app/api/v1/profiles/[id]/project-invite-options` | `src/app/api/v1/profiles/[id]/workspace-invite-options` |
| `src/app/api/v1/profiles/[id]/project-invites` | `src/app/api/v1/profiles/[id]/workspace-invites` |
| `src/app/api/v1/profiles/[id]/projects` | `src/app/api/v1/profiles/[id]/workspaces` |
| `src/app/api/v1/projects` | `src/app/api/v1/workspaces` |
| `src/components/projects` | `src/components/workspaces` |
| `src/hooks/projects` | `src/hooks/workspaces` |
| `src/lib/projects` | `src/lib/workspaces` |

### Files

| Current | Proposed |
|---|---|
| `scripts/check-project-updates-schema.ts` | `scripts/check-workspace-updates-schema.ts` |
| `scripts/check-project.ts` | `scripts/check-workspace.ts` |
| `src/app/(site)/(main)/projects/[slug]/project-route.tsx` | `src/app/(site)/(main)/workspaces/[slug]/workspace-route.tsx` |
| `src/app/api/v1/extension/_project-counts.ts` | `src/app/api/v1/extension/_workspace-counts.ts` |
| `src/components/messages/OrgBrowseProjects.tsx` | `src/components/messages/OrgBrowseWorkspaces.tsx` |
| `src/components/messages/useSelectedProject.ts` | `src/components/messages/useSelectedWorkspace.ts` |
| `src/components/network/IncomingProjectApplicationRow.tsx` | `src/components/network/IncomingWorkspaceApplicationRow.tsx` |
| `src/components/presence/ProjectStatusControl.tsx` | `src/components/presence/WorkspaceStatusControl.tsx` |
| `src/components/profile/v2/sections/ProjectContributionsCard.tsx` | `src/components/profile/v2/sections/WorkspaceContributionsCard.tsx` |
| `src/components/profile/v2/sections/ProjectsGridCard.tsx` | `src/components/profile/v2/sections/WorkspacesGridCard.tsx` |
| `src/components/projects/EditProjectModal.tsx` | `src/components/workspaces/EditWorkspaceModal.tsx` |
| `src/components/projects/ProjectAvatar.tsx` | `src/components/workspaces/WorkspaceAvatar.tsx` |
| `src/components/projects/ProjectBadge.tsx` | `src/components/workspaces/WorkspaceBadge.tsx` |
| `src/components/projects/ProjectCard.tsx` | `src/components/workspaces/WorkspaceCard.tsx` |
| `src/components/projects/ProjectCardSkeleton.tsx` | `src/components/workspaces/WorkspaceCardSkeleton.tsx` |
| `src/components/projects/ProjectOnboardingModal.tsx` | `src/components/workspaces/WorkspaceOnboardingModal.tsx` |
| `src/components/projects/ProjectStatsBar.tsx` | `src/components/workspaces/WorkspaceStatsBar.tsx` |
| `src/components/projects/create-wizard/CreateProjectRouteClient.tsx` | `src/components/workspaces/create-wizard/CreateWorkspaceRouteClient.tsx` |
| `src/components/projects/create-wizard/CreateProjectShellSkeleton.tsx` | `src/components/workspaces/create-wizard/CreateWorkspaceShellSkeleton.tsx` |
| `src/components/projects/create-wizard/CreateProjectWizard.tsx` | `src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx` |
| `src/components/projects/create-wizard/LeaveProjectSetupDialog.tsx` | `src/components/workspaces/create-wizard/LeaveWorkspaceSetupDialog.tsx` |
| `src/components/projects/create-wizard/create-project-return.ts` | `src/components/workspaces/create-wizard/create-workspace-return.ts` |
| `src/components/projects/create-wizard/useCreateProjectWizard.ts` | `src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts` |
| `src/components/projects/dashboard/ProjectDashboardClient.tsx` | `src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx` |
| `src/components/projects/dashboard/ProjectLayout.tsx` | `src/components/workspaces/dashboard/WorkspaceLayout.tsx` |
| `src/components/projects/dashboard/ProjectOverviewCard.tsx` | `src/components/workspaces/dashboard/WorkspaceOverviewCard.tsx` |
| `src/components/projects/dashboard/ProjectSocialLinksCard.tsx` | `src/components/workspaces/dashboard/WorkspaceSocialLinksCard.tsx` |
| `src/components/projects/dashboard/ProjectTabsRegistry.tsx` | `src/components/workspaces/dashboard/WorkspaceTabsRegistry.tsx` |
| `src/components/projects/dashboard/ProjectTeamAvatars.tsx` | `src/components/workspaces/dashboard/WorkspaceTeamAvatars.tsx` |
| `src/components/projects/doc/ProjectDocCommandBlock.tsx` | `src/components/workspaces/doc/WorkspaceDocCommandBlock.tsx` |
| `src/components/projects/doc/ProjectDocRail.tsx` | `src/components/workspaces/doc/WorkspaceDocRail.tsx` |
| `src/components/projects/doc/ProjectDocReferencePreview.tsx` | `src/components/workspaces/doc/WorkspaceDocReferencePreview.tsx` |
| `src/components/projects/doc/ProjectDocRenderer.tsx` | `src/components/workspaces/doc/WorkspaceDocRenderer.tsx` |
| `src/components/projects/doc/ProjectDocSmartBlock.tsx` | `src/components/workspaces/doc/WorkspaceDocSmartBlock.tsx` |
| `src/components/projects/doc/ProjectDocViewer.tsx` | `src/components/workspaces/doc/WorkspaceDocViewer.tsx` |
| `src/components/projects/settings/ProjectDangerModals.tsx` | `src/components/workspaces/settings/WorkspaceDangerModals.tsx` |
| `src/components/projects/settings/ProjectNotificationSettings.tsx` | `src/components/workspaces/settings/WorkspaceNotificationSettings.tsx` |
| `src/components/projects/settings/ProjectRolesEditor.tsx` | `src/components/workspaces/settings/WorkspaceRolesEditor.tsx` |
| `src/components/projects/settings/ProjectSettingsNavigation.tsx` | `src/components/workspaces/settings/WorkspaceSettingsNavigation.tsx` |
| `src/components/projects/tabs/ProjectSettingsTab.tsx` | `src/components/workspaces/tabs/WorkspaceSettingsTab.tsx` |
| `src/components/projects/updates/ProjectUpdateComposer.tsx` | `src/components/workspaces/updates/WorkspaceUpdateComposer.tsx` |
| `src/components/projects/updates/ProjectUpdateLikersModal.tsx` | `src/components/workspaces/updates/WorkspaceUpdateLikersModal.tsx` |
| `src/components/projects/updates/ProjectUpdateMediaFrame.tsx` | `src/components/workspaces/updates/WorkspaceUpdateMediaFrame.tsx` |
| `src/components/projects/updates/ProjectUpdateRichTextEditor.tsx` | `src/components/workspaces/updates/WorkspaceUpdateRichTextEditor.tsx` |
| `src/components/projects/v2/files-tab/IdeProjectPicker.tsx` | `src/components/workspaces/v2/files-tab/IdeWorkspacePicker.tsx` |
| `src/components/sharing/ProjectShareContents.tsx` | `src/components/sharing/WorkspaceShareContents.tsx` |
| `src/constants/project-wizard.ts` | `src/constants/workspace-wizard.ts` |
| `src/hooks/discover/useDiscoverProjects.ts` | `src/hooks/discover/useDiscoverWorkspaces.ts` |
| `src/hooks/mutations/useProjectMutations.ts` | `src/hooks/mutations/useWorkspaceMutations.ts` |
| `src/hooks/projects/useProjectDocData.ts` | `src/hooks/workspaces/useWorkspaceDocData.ts` |
| `src/hooks/projects/useProjectMembers.ts` | `src/hooks/workspaces/useWorkspaceMembers.ts` |
| `src/hooks/projects/useProjectTasksData.ts` | `src/hooks/workspaces/useWorkspaceTasksData.ts` |
| `src/hooks/useProjectSettingsNavigation.ts` | `src/hooks/useWorkspaceSettingsNavigation.ts` |
| `src/inngest/functions/project-files-permanent-delete.ts` | `src/inngest/functions/workspace-files-permanent-delete.ts` |
| `src/inngest/functions/project-files-reconciliation.ts` | `src/inngest/functions/workspace-files-reconciliation.ts` |
| `src/inngest/functions/project-import-hydrate.ts` | `src/inngest/functions/workspace-import-hydrate.ts` |
| `src/inngest/functions/project-import-reconcile.ts` | `src/inngest/functions/workspace-import-reconcile.ts` |
| `src/inngest/functions/project-import.ts` | `src/inngest/functions/workspace-import.ts` |
| `src/lib/data/project-access.ts` | `src/lib/data/workspace-access.ts` |
| `src/lib/github/project-import-runner.ts` | `src/lib/github/workspace-import-runner.ts` |
| `src/lib/notifications/project-events.ts` | `src/lib/notifications/workspace-events.ts` |
| `src/lib/notifications/project-policy.ts` | `src/lib/notifications/workspace-policy.ts` |
| `src/lib/project-key.ts` | `src/lib/workspace-key.ts` |
| `src/lib/projects/project-create-options.ts` | `src/lib/workspaces/workspace-create-options.ts` |
| `src/lib/projects/project-detail-metadata.ts` | `src/lib/workspaces/workspace-detail-metadata.ts` |
| `src/lib/projects/project-invitations.ts` | `src/lib/workspaces/workspace-invitations.ts` |
| `src/lib/projects/project-roles-form.ts` | `src/lib/workspaces/workspace-roles-form.ts` |
| `src/lib/projects/project-visibility.ts` | `src/lib/workspaces/workspace-visibility.ts` |
| `src/lib/realtime/project-files-channel.ts` | `src/lib/realtime/workspace-files-channel.ts` |
| `src/lib/storage/project-file-key.ts` | `src/lib/storage/workspace-file-key.ts` |
| `src/lib/upload/project-image-upload-client.ts` | `src/lib/upload/workspace-image-upload-client.ts` |
| `src/lib/upload/project-upload-allocation.ts` | `src/lib/upload/workspace-upload-allocation.ts` |
| `src/lib/utils/project-ids.ts` | `src/lib/utils/workspace-ids.ts` |
| `src/lib/validations/project.ts` | `src/lib/validations/workspace.ts` |
| `src/lib/view-models/project-card.ts` | `src/lib/view-models/workspace-card.ts` |
| `tests/db/chat-deleted-project.test.ts` | `tests/db/chat-deleted-workspace.test.ts` |
| `tests/db/project-files-actions.test.ts` | `tests/db/workspace-files-actions.test.ts` |
| `tests/db/project-isolation.test.ts` | `tests/db/workspace-isolation.test.ts` |
| `tests/db/project-settings-bootstrap.test.ts` | `tests/db/workspace-settings-bootstrap.test.ts` |
| `tests/db/project-tasks-actions.test.ts` | `tests/db/workspace-tasks-actions.test.ts` |
| `tests/db/project-updates-actions.test.ts` | `tests/db/workspace-updates-actions.test.ts` |
| `tests/db/rls-project-tabs.test.ts` | `tests/db/rls-workspace-tabs.test.ts` |
| `tests/e2e/create-project-wizard.spec.ts` | `tests/e2e/create-workspace-wizard.spec.ts` |
| `tests/e2e/project-tabs-matrix.spec.ts` | `tests/e2e/workspace-tabs-matrix.spec.ts` |
| `tests/e2e/project-views-follows.spec.ts` | `tests/e2e/workspace-views-follows.spec.ts` |
| `tests/unit/_project-actions-source.ts` | `tests/unit/_workspace-actions-source.ts` |
| `tests/unit/chat-project-sync-contract.test.ts` | `tests/unit/chat-workspace-sync-contract.test.ts` |
| `tests/unit/create-project-github-oauth-resume.test.ts` | `tests/unit/create-workspace-github-oauth-resume.test.ts` |
| `tests/unit/create-project-launch-settings.test.ts` | `tests/unit/create-workspace-launch-settings.test.ts` |
| `tests/unit/create-project-leave-dialog.test.ts` | `tests/unit/create-workspace-leave-dialog.test.ts` |
| `tests/unit/create-project-phase1-redesign.test.ts` | `tests/unit/create-workspace-phase1-redesign.test.ts` |
| `tests/unit/create-project-phase2-redesign.test.ts` | `tests/unit/create-workspace-phase2-redesign.test.ts` |
| `tests/unit/create-project-phase3-redesign.test.ts` | `tests/unit/create-workspace-phase3-redesign.test.ts` |
| `tests/unit/create-project-phase4-redesign.test.ts` | `tests/unit/create-workspace-phase4-redesign.test.ts` |
| `tests/unit/create-project-phase5-redesign.test.ts` | `tests/unit/create-workspace-phase5-redesign.test.ts` |
| `tests/unit/create-project-source-switch.test.ts` | `tests/unit/create-workspace-source-switch.test.ts` |
| `tests/unit/create-project-wizard-shell-layout.test.ts` | `tests/unit/create-workspace-wizard-shell-layout.test.ts` |
| `tests/unit/extension-project-image.test.ts` | `tests/unit/extension-workspace-image.test.ts` |
| `tests/unit/files-tab/project-files-channel.test.ts` | `tests/unit/files-tab/workspace-files-channel.test.ts` |
| `tests/unit/github-project-import-pipeline.test.ts` | `tests/unit/github-workspace-import-pipeline.test.ts` |
| `tests/unit/header-new-project-in-place.test.ts` | `tests/unit/header-new-workspace-in-place.test.ts` |
| `tests/unit/project-access-settings-contract.test.ts` | `tests/unit/workspace-access-settings-contract.test.ts` |
| `tests/unit/project-avatar-integration-contract.test.ts` | `tests/unit/workspace-avatar-integration-contract.test.ts` |
| `tests/unit/project-collaborators-settings-contract.test.ts` | `tests/unit/workspace-collaborators-settings-contract.test.ts` |
| `tests/unit/project-danger-settings-contract.test.ts` | `tests/unit/workspace-danger-settings-contract.test.ts` |
| `tests/unit/project-dashboard-settings-ui-contract.test.ts` | `tests/unit/workspace-dashboard-settings-ui-contract.test.ts` |
| `tests/unit/project-detail-metadata.test.ts` | `tests/unit/workspace-detail-metadata.test.ts` |
| `tests/unit/project-detail-ponytail-optimization.test.ts` | `tests/unit/workspace-detail-ponytail-optimization.test.ts` |
| `tests/unit/project-detail-route-performance.test.ts` | `tests/unit/workspace-detail-route-performance.test.ts` |
| `tests/unit/project-detail-security.test.ts` | `tests/unit/workspace-detail-security.test.ts` |
| `tests/unit/project-detail-shell.test.ts` | `tests/unit/workspace-detail-shell.test.ts` |
| `tests/unit/project-doc-collaboration-repair.test.ts` | `tests/unit/workspace-doc-collaboration-repair.test.ts` |
| `tests/unit/project-doc-design-contract.test.ts` | `tests/unit/workspace-doc-design-contract.test.ts` |
| `tests/unit/project-doc-draft-visibility.test.ts` | `tests/unit/workspace-doc-draft-visibility.test.ts` |
| `tests/unit/project-doc-edit-route-stability.test.ts` | `tests/unit/workspace-doc-edit-route-stability.test.ts` |
| `tests/unit/project-doc-no-highlight-contract.test.ts` | `tests/unit/workspace-doc-no-highlight-contract.test.ts` |
| `tests/unit/project-doc.test.ts` | `tests/unit/workspace-doc.test.ts` |
| `tests/unit/project-docs-settings-contract.test.ts` | `tests/unit/workspace-docs-settings-contract.test.ts` |
| `tests/unit/project-file-key.test.ts` | `tests/unit/workspace-file-key.test.ts` |
| `tests/unit/project-files-phase3.test.ts` | `tests/unit/workspace-files-phase3.test.ts` |
| `tests/unit/project-files-workspace-settings-contract.test.ts` | `tests/unit/workspace-files-workspace-settings-contract.test.ts` |
| `tests/unit/project-finalization-active-task.test.ts` | `tests/unit/workspace-finalization-active-task.test.ts` |
| `tests/unit/project-general-settings-contract.test.ts` | `tests/unit/workspace-general-settings-contract.test.ts` |
| `tests/unit/project-layout-scroll-contract.test.ts` | `tests/unit/workspace-layout-scroll-contract.test.ts` |
| `tests/unit/project-lifecycle-settings-contract.test.ts` | `tests/unit/workspace-lifecycle-settings-contract.test.ts` |
| `tests/unit/project-links-ecosystem-contract.test.ts` | `tests/unit/workspace-links-ecosystem-contract.test.ts` |
| `tests/unit/project-links-settings-contract.test.ts` | `tests/unit/workspace-links-settings-contract.test.ts` |
| `tests/unit/project-notifications-settings-contract.test.ts` | `tests/unit/workspace-notifications-settings-contract.test.ts` |
| `tests/unit/project-recent-activity.test.ts` | `tests/unit/workspace-recent-activity.test.ts` |
| `tests/unit/project-repository-provenance.test.ts` | `tests/unit/workspace-repository-provenance.test.ts` |
| `tests/unit/project-roles-settings-contract.test.ts` | `tests/unit/workspace-roles-settings-contract.test.ts` |
| `tests/unit/project-settings-bootstrap-access.test.ts` | `tests/unit/workspace-settings-bootstrap-access.test.ts` |
| `tests/unit/project-settings-policies.test.ts` | `tests/unit/workspace-settings-policies.test.ts` |
| `tests/unit/project-settings-redesign.test.ts` | `tests/unit/workspace-settings-redesign.test.ts` |
| `tests/unit/project-settings-scroll-document-contract.test.ts` | `tests/unit/workspace-settings-scroll-document-contract.test.ts` |
| `tests/unit/project-settings-toggle-lifecycle.test.ts` | `tests/unit/workspace-settings-toggle-lifecycle.test.ts` |
| `tests/unit/project-settings-top-gutter.test.ts` | `tests/unit/workspace-settings-top-gutter.test.ts` |
| `tests/unit/project-status-badge-removal.test.ts` | `tests/unit/workspace-status-badge-removal.test.ts` |
| `tests/unit/project-tab-access.test.ts` | `tests/unit/workspace-tab-access.test.ts` |
| `tests/unit/project-task-workflow-persistence-contract.test.ts` | `tests/unit/workspace-task-workflow-persistence-contract.test.ts` |
| `tests/unit/project-tasks-phase4.test.ts` | `tests/unit/workspace-tasks-phase4.test.ts` |
| `tests/unit/project-three-tab-hardening-contract.test.ts` | `tests/unit/workspace-three-tab-hardening-contract.test.ts` |
| `tests/unit/project-updates-design-contract.test.ts` | `tests/unit/workspace-updates-design-contract.test.ts` |
| `tests/unit/project-updates-settings-contract.test.ts` | `tests/unit/workspace-updates-settings-contract.test.ts` |
| `tests/unit/project-updates.test.ts` | `tests/unit/workspace-updates.test.ts` |
| `tests/unit/project-upload-publication.test.ts` | `tests/unit/workspace-upload-publication.test.ts` |
| `tests/unit/project-visibility-leaks-contract.test.ts` | `tests/unit/workspace-visibility-leaks-contract.test.ts` |
| `tests/unit/public-project-feed.test.ts` | `tests/unit/public-workspace-feed.test.ts` |
| `tests/unit/public-project-owner-mask.test.ts` | `tests/unit/public-workspace-owner-mask.test.ts` |

## Appendix E. Raw SQL inside TypeScript

These do not follow a table rename. Each must change in the same deploy as the database migration.

| Location | Project tables referenced |
|---|---|
| `app/actions/chat/activity.ts:63` | `project_title`, `projects` |
| `app/actions/chat/activity.ts:87` | `project_title`, `projects` |
| `app/actions/chat/activity.ts:265` | `project_title`, `projects` |
| `app/actions/chat/channels.ts:177` | `project_title`, `projects` |
| `app/actions/chat/channels.ts:211` | `project_title`, `project_slug`, `projects` |
| `app/actions/chat/channels.ts:255` | `project_membership_role`, `project_open_roles`, `project_role_title`, `projects`, `project_members` |
| `app/actions/chat/later.ts:80` | `project_title`, `projects` |
| `app/actions/chat/members.ts:179` | `project_members`, `projects` |
| `app/actions/chat/members.ts:185` | `project_title`, `projects` |
| `app/actions/chat/search.ts:58` | `project_title`, `projects` |
| `app/actions/contribution-stories.ts:1028` | `projects`, `project_members` |
| `app/actions/github-sync.ts:240` | `projects` |
| `app/actions/github-sync.ts:294` | `projects` |
| `app/actions/network-invitations.ts:132` | `project_title`, `project_slug`, `project_invitations`, `projects`, `project_open_roles` |
| `app/actions/org-dashboard.ts:282` | `project_members`, `projects` |
| `app/actions/org-workspace.ts:43` | `project_members`, `projects` |
| `app/actions/org-workspace.ts:77` | `projects` |
| `app/actions/org-workspace.ts:97` | `projects`, `project_members` |
| `app/actions/org-workspace.ts:124` | `projects`, `project_members` |
| `app/actions/org-workspace.ts:152` | `project_members`, `projects` |
| `app/actions/org-workspace.ts:188` | `projects`, `project_members` |
| `app/actions/org-workspace.ts:220` | `project_members`, `projects` |
| `app/actions/org-workspace.ts:229` | `project_members`, `projects` |
| `app/actions/org-workspace.ts:251` | `project_docs`, `projects` |
| `app/actions/presence.ts:292` | `projects` |
| `app/actions/presence.ts:310` | `projects`, `project_members` |
| `app/actions/presence.ts:332` | `projects` |
| `app/actions/presence.ts:346` | `projects` |
| `app/actions/project/task-completion.ts:71` | `projects`, `project_members` |
| `app/actions/project/updates.ts:1835` | `projects` |
| `app/actions/project/workflow.ts:71` | `projects`, `project_members` |
| `app/actions/sharing-destinations.ts:45` | `projects`, `project_members` |
| `app/actions/sharing-destinations.ts:50` | `projects`, `project_title` |
| `app/actions/sharing-destinations.ts:81` | `projects` |
| `app/actions/sharing-destinations.ts:101` | `project_members`, `projects` |
| `app/actions/trust.ts:199` | `project_title`, `project_slug`, `project_kind`, `project_updates`, `project_update_comments`, `project_docs`, `projects` |
| `app/actions/workspace.ts:19` | `projects` |
| `app/actions/workspace.ts:233` | `project_title`, `projects` |
| `app/api/v1/contribution-images/[id]/route.ts:45` | `project_visibility`, `project_status`, `project_deleted_at`, `profile_project_contributions`, `projects` |
| `app/api/v1/extension/workspace/route.ts:118` | `projects`, `project_members` |
| `inngest/functions/account-cleanup.ts:47` | `projects`, `project_nodes`, `project_updates`, `project_update_media_assets`, `project_update_drafts`, `project_update_draft_media_assets` |
| `inngest/functions/flush-views.ts:20` | `projects` |
| `inngest/functions/project-files-reconciliation.ts:143` | (project_id / bucket only) |
| `inngest/functions/project-files-reconciliation.ts:151` | (project_id / bucket only) |
| `inngest/functions/project-files-reconciliation.ts:160` | `project_nodes` |
| `lib/account/export-organizations.ts:15` | `project_members`, `projects` |
| `lib/account/export-organizations.ts:20` | `projects` |
| `lib/account/export-organizations.ts:36` | `project_updates`, `projects` |
| `lib/account/export-organizations.ts:40` | `project_update_comments`, `project_updates`, `projects` |
| `lib/account/hard-delete.ts:101` | `projects`, `project_follows` |
| `lib/applications/reviewers.ts:11` | `projects`, `project_members` |
| `lib/data/discover.ts:334` | `projects` |
| `lib/data/discover.ts:343` | `projects` |
| `lib/files/internal-helpers.ts:173` | `projects` |
| `lib/files/internal-helpers.ts:226` | `projects` |
| `lib/files/internal-helpers.ts:269` | `projects` |
| `lib/messaging/application-meta.ts:8` | `project_title`, `project_slug`, `projects`, `project_open_roles` |
| `lib/messaging/cards.ts:24` | `project_title`, `project_slug`, `project_chat_id`, `project_members`, `projects`, `project_open_roles` |
| `lib/messaging/cards.ts:46` | `project_key`, `project_slug`, `project_title`, `project_members`, `projects` |
| `lib/messaging/cards.ts:62` | `project_title`, `project_slug`, `project_members`, `project_invitations`, `projects` |
| `lib/messaging/cards.ts:80` | `project_slug`, `project_title`, `project_members`, `project_updates`, `projects` |
| `lib/messaging/cards.ts:92` | `project_slug`, `project_title`, `project_members`, `projects` |
| `lib/messaging/queries.ts:14` | `project_membership_role`, `project_role_title`, `project_members` |
| `lib/network/person-card-read.ts:40` | `projects`, `profile_project_contributions`, `project_title` |
| `lib/organizations/lifecycle.ts:36` | `projects`, `project_members`, `project_nodes`, `project_sprints` |
| `lib/organizations/lifecycle.ts:141` | `profile_project_contributions`, `project_title` |
| `lib/organizations/needs-you.ts:55` | `projects` |
| `lib/organizations/needs-you.ts:102` | `project_members`, `projects` |
| `lib/organizations/needs-you.ts:125` | `projects`, `project_sprints` |
| `lib/organizations/org-digests.ts:132` | `project_sprints`, `projects` |
| `lib/organizations/sprint-notify.ts:15` | `projects` |
| `lib/organizations/sprint-notify.ts:42` | `projects`, `project_sprints` |
| `lib/organizations/sprint-notify.ts:88` | `project_sprints`, `projects` |
| `lib/organizations/sprint-notify.ts:109` | `projects`, `project_members` |
| `lib/organizations/sprint-notify.ts:121` | `projects` |
| `lib/organizations/sprint-notify.ts:129` | `project_sprints`, `projects` |
| `lib/organizations/sprint-notify.ts:138` | `projects`, `project_sprints` |
| `lib/organizations/sprint-notify.ts:160` | `projects` |
| `lib/organizations/succession.ts:51` | `projects` |
| `lib/profile/collaboration.ts:682` | `project_created_at`, `project_title`, `project_title_override`, `project_url`, `project_node_events`, `project_nodes`, `project_github_repo_url`, `project_external_links`, `project_slug`, `project_visibility`, `project_status`, `profile_project_contribution_stages`, `project_owner_id`, `project_kind`, `project_members`, `project_link_hidden` |
| `lib/profile/contribution-story-server.ts:40` | `projects`, `project_members`, `project_nodes`, `project_sprints` |
| `lib/projects/server/lifecycle.ts:2040` | `projects`, `project_nodes`, `project_updates`, `project_update_media_assets`, `project_update_drafts`, `project_update_draft_media_assets` |
| `lib/projects/task-transition-service.ts:99` | `project_members`, `projects` |
| `lib/sharing/read.ts:17` | `profile_project_contributions`, `projects` |
| `lib/sharing/read.ts:84` | `project_members`, `projects`, `project_open_roles`, `project_guidance_appointments` |
