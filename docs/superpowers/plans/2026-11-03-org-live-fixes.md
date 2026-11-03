# Fix all 66 live-check problems — organization pages, profile and contributions

## Context

On 3 November the organization build went live (773052541, migrations 0042–0058). Checking networkbase.in screen by
screen against the design report (`docs/superpowers/specs/2026-11-01-organization-end-to-end-design.md`) found 66
problems, plus React error #418 on every page. They're listed in `docs/superpowers/plans/2026-11-03-org-live-check.md`.
The worst ones:
- Tabs take 3.6–17.5 s to load.
- Tasks is two areas with three create buttons and two forms.
- You can't post an update at a 1280-pixel width.
- Several Overview sections still look like the report's own "before" examples.
- An organization contribution can't be published.

The intended outcome: every row in that list fixed at its root cause, each fix pinned by a test, checked live against
the report, and nothing pushed until you approve.

Owner decisions (3 Nov):
- Sprint sharing gets **All / Selected / None**.
- Hiding a pinned post is **remembered on the account**.
- **Preview as member stays removed** (ebdcdf772, local).

## How each phase runs (CLAUDE.md workflow)

1. Write the failing test first (TDD) for every SQL, query or permission change.
2. Make the smallest change that fixes the root cause.
3. Run `ponytail-review`, then `review`.
4. Gate:
   - `typecheck`
   - lint on the changed files
   - `test:unit`
   - `test:db` on the disposable database (rebuild it after each new migration)
   - the browser specs the phase touches
   - `check:terminology`, `check:authz-contract`, `check:rls-contract`, `check:db:migration-journal`
5. Commit locally, one commit per phase.

New migrations start at **0059** and follow the usual recipe:
- `drizzle/NNNN_*.sql`
- the journal entry
- `standards/sql-governance.manifest.json`
- `src/lib/db/schema/index.ts`
- RLS on; revoke from anon/authenticated; grant to nb_app and service_role

Source tests that read file text, such as `organization-1d-wording.test.ts:47-64` and
`organization-shared-blocks.test.ts:18` (both read AssignmentsPanel), are updated in the same commit as the code they read.

## Phase 1 — Speed, loading state, error #418 (problems 1, 2, #418)

Cause (#1): Next.js runs server actions from one browser tab one at a time
(`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:26-30`). Each org tab fires 10–16 of them.

- **Start each tab's main read on the server,** the way `workspace-route.tsx:117-120,160-163` already starts the sprint read.
  - Start these for the active `?tab=`: `readOrgDashboardAction`, `readOrgWorkspacesAction` and `readOrgMembersAction`, plus the Tasks boot reads.
  - Pass them down as promises and read them with `use()`, as `SprintPlanning.tsx:82` does.
  - Feed them to React Query as `initialData`, so revisits still use the cache.
- **Fold the no-argument reads into the existing shell batch** (`SHELL_READERS` in `src/app/actions/shell.ts`, `createPartBatcher` in `src/lib/part-batcher.ts`): `readSidebarWorkspacesAction`, `staffBadgeAction`, `readOrgTabBadgesAction`.
- **Drop wasted calls:**
  - `getRoleApplicationCountsAction` on organizations (`WorkspaceDashboardClient.tsx:853`; only the non-org Dashboard uses it).
  - The Overview activity filter re-fetching the whole dashboard. Filter on the client: the server already returns 30 rows.
- **Members:** `readOrgMembersAction` returns the invite-panel fields (`codeEnabled`, `joinMode`, `roleNames`) and seeds `['org-invite-panel', orgId]` with `setQueryData`, so the panel needs no request (also fixes #40).
- **Tasks:** one `readOrgTasksBoot` server read covering tasks, sprints, workflow columns, units and the completion policy, started in the route.
- **Loading state (#2):**
  - `src/app/(site)/(main)/layout.tsx:49` passes `getViewerIdentityContext()` (`src/lib/server/viewer-context.ts:105`) as `initialProfile` instead of `null`.
  - The sidebar queries key off `user.id` and use `isPending` (`AppSidebar.tsx:83,93,99`), so the loading row shows instead of "No workspaces yet".
  - "Trust and safety" depends only on `isStaff` (`AppSidebar.tsx:116`).
- **#418:** `GlobalSearch.tsx:35-38,129` uses the existing `useSyncExternalStore(noSubscribe, modKeyHint, () => "⌘K")` pattern (`ChatSections.tsx:420-421`, `messages/keys.ts`).
  - Also format `OrgAboutTab.tsx:41` and `OrgHeaderParts.tsx:149` dates in the organization's time zone.
  - Then check the live console is clean on every page.
- **Targets:** each tab ready in ≤ 2 s, Overview ≤ 1.5 s, at most 2 sequential actions on first load. Measured live before and after with the same `performance` script used in the live check. Run `benchmark` before and after.

## Phase 2 — Tasks: one board, one form, one review path (problems 3–10, 47–48)

- **Remove the separate box (#3, #4):** stop rendering `AssignmentsPanel` above the board (`WorkspaceDashboardClient.tsx:1203`).
  - Move Publish, Publish now, Schedule, Back to draft and Delete into `AssignmentManageSection` (`AssignmentsPanel.tsx:929-973`).
  - Reuse `publishAssignmentAction`, `scheduleAssignmentAction`, `deleteAssignmentAction` and `ConfirmDialog`.
  - Drafts and scheduled assignments stay on the board as To do cards, as they already are (`assignmentColumn`, `TaskCard.tsx:37-42`).
  - The admin Review button goes; the In review filter already shows `ReviewQueue` (`TasksTab.tsx:923`).
  - `+ New → Task` (`OrgHeaderParts.tsx:157-159`) opens `CreateTaskModal`, through a `startCreate` prop like `SprintPlanning.tsx:162-166`.
  - The search quick action becomes "New task" (`org-workspace.ts:290`).
- **One form (#5):** `CreateTaskModal` stays open.
  - When "Assign to" is a many-people choice, its title becomes "Create assignment" and an `AssignmentHandInSection` appears. That section is the composer body moved out of `AssignmentsPanel.tsx:336-495` together with its `save()` → `createAssignmentAction`.
  - Title and description stay in the one form, so switching back keeps them.
  - Offer every assign mode: everyone, Admins (role), selected people, groups, each workspace, selected workspaces.
- **Filters (#6):** add `assignments` and `mine` to the scope union.
  - Client: `TaskFilters.tsx:5-15`, `TasksTab.tsx:189-194`, `useWorkspaceTasksData.ts:11-22`, `query-keys.ts:5`, `task-cache.ts:24-39`.
  - Server: `server/tasks.ts:111-113,210-217,471-475`, reusing the `own` expression in `orgTaskReadFilter` (`assignments.ts:34-37`).
- **Assignment cards (#7):** `canDrag = false` and no "Move to…" when `isMaster` (`KanbanBoard.tsx:95-98,156-162`). The server already refuses.
- **Main assignment panel (#8):** add `kind` and `assignmentId` to `getWorkspaceTaskDetailAction` (`server/tasks.ts:730-750`).
  - Define `isMaster = kind === 'assignment' && !assignmentId` (the same rule as `assignmentWriteContext`, `assignments.ts:319`).
  - Hide Status, Section, Assignee and the ordinary review block on masters (`DetailsTab.tsx:322-369,649-893`).
- **One review path (#9):**
  - `lockTaskForWrite` returns `isMaster`.
  - `transitionTaskTx` refuses masters *before* the `reviewReason`/`resubmit` skip (`task-transition-service.ts:263`).
  - `approveTaskReviewAction` (`task.ts:657`) refuses masters.
  - The admin "In review" scope excludes masters (`assignments.ts:30`).
  - Migration **0059_master_review_cleanup** resets `review_status`, `review_submitted_at`, `review_content_hash` and `completed_*` on masters.
- **Board scroll (#10):** `KanbanBoard.tsx:861-877` only scrolls when a column is added by hand, never on the 0 → N first load.
- **Search (#47, #48):**
  - Add an `org` context in `CommandPalette.tsx:52-59,157-160,444,460,484`: "Search this organization…", with hints Assignments, Documents, Files, Sprints, People.
  - Split `orgResults` by kind, with one heading each (`:328-338`), using `OrgSearchResultCard`.
  - On org pages skip the workspace task previews (`useGlobalSearchPreviews.ts:314-332`).
  - Exclude files linked to a document (`org-workspace.ts:215`, `NOT EXISTS workspace_documents.linked_node_id`).
  - Fix links: `?tab=tasks&drawerType=task&drawerId=` (not `tab=assignments`), and documents `tab=docs`.

## Phase 3 — Overview, header and About (problems 11–21)

- **Pinned (#11):**
  - Select author, avatar, `created_at` and unread (versus `lastSeenUpdatesAt`) in `org-dashboard.ts:154-158`.
  - Row: megaphone icon, photo, one line, time, an unread dot, `×`, and `⋯ → Unpin` (`toggleWorkspaceUpdatePinAction`, `updates.ts:1992`).
  - Migration **0060_update_hidden_for_user** adds `workspace_update_hidden(user_id, update_id, hidden_at)`, plus `hidePinnedForMeAction` with the RLS/grants recipe. The dashboard skips hidden pins.
- **Today (#12):** `TodayRow` gains `title`, `detail`, `icon` (kind→icon map like `activityIcon`) and `action`.
  - Join requests carry name, source and age.
  - With one request, "Approve" works in place through `approveJoinRequestsAction`.
  - Split `reviewRow` into a title and a detail line.
- **This sprint (#13, #14):**
  - A card with name, status chip (`SPRINT_STATUS_PRESENTATION`), "N days left", goal, progress bar "x of y tasks done", "All sprints →", and rows for normal tasks as well as assignments (fix the query at `org-dashboard.ts:161-162,183`).
  - "0 of 0 done" becomes "Nobody has joined yet", linking to Invite.
- **This week (#15):** date tiles (`SUN / 8`) in the organization's time zone, a type icon from a new `kind` field, and the group label only when it differs from the section title.
- **Activity (#16):** use the shared `ActivityItem` (`src/components/ui/activity-item.tsx`). The filter becomes one small menu. Show 5 rows, then "Show more".
- **Workspaces (#17):** avatar (a new 24px `WorkspaceAvatar` size), "Lead · N members", an overdue chip, and `+` in the header for admins. Reuse the subqueries in `readOrgWorkspacesAction` (`org-dashboard.ts:392-396`).
- **People (#18):** stacked photos (`UserAvatar`, the `WorkspaceTeamAvatars` markup), "N members · N joined this week", and a "1 request" chip. When you're alone, a compact `OrgInvitePanel`.
- **Header (#4 tie-in):** `+ New` offers Task, Announcement, Sprint, Workspace.
- **About (#19–21):**
  - Welcome note and About card get Edit for owners and admins (`OrgAboutTab.tsx:55-62`, `isCreator`, `WorkspaceOverviewCard.tsx:100-106`); the wording becomes "Edit details".
  - A single sprint shows one solid stop plus one faint next stop (reuse the ghost timeline at `:90`).
  - Owner and admins: avatar plus "Role · Title" (`org-dashboard.ts:340`, `OrgAboutTab.tsx:127`).

## Phase 4 — Sprints (problems 30–35)

- **Complete (#30):** show Complete while a sprint is `active` (`SprintHeader.tsx:51,118,159`), and relax `server/sprints.ts:1879-1882` for running sprints. Reuse `SprintLifecycleModals.tsx` and `completeSprintAction`. Add "N days left" (new helper in `sprint-detail.ts`, unit tested). Update `sprint-permissions.test.ts:72-75`.
- **Assignments in the work list (#31):** select `t.kind` and `t.assignment_id` in `readSprintTaskActivityPage` (`server/sprints.ts:611-660`). Masters render "12/40" (the progress SQL from `server/tasks.ts:370-382`), not "Unassigned". Delete the `SprintAssignmentRows` block (`SprintPlanning.tsx:520`).
- **Defaults (#32, #33):**
  - Start date = the day after the latest planning or active sprint ends (`addDaysToSprintDateInput`, `seriesPreview().startAfter`).
  - Name: recompute `nextSeriesNumber` when `existingSprints` changes, instead of once at mount (`CreateSprintModal.tsx:175-213`).
  - A test with sprints arriving after the modal opens must produce CO2.
- **Form (#34):**
  - "Share with workspaces: All / Selected / None". Migration **0061_sprint_shared_workspaces** adds `sprint_shared_workspaces(sprint_id, workspace_id)`. Selected = `show_in_children` plus rows; None = off.
  - Read it in `organizations/sprints.ts:171,191` and wherever child workspaces read the org sprint, with a DB test that an unselected workspace doesn't see it.
  - "Teams plan their own sprint inside it" replaces "Create a matching sprint…".
  - "Post an announcement", off by default, with prefilled editable text (the `StartNowButton` pattern, `postOrgAnnouncement`).
- **Dash (#35):** remove the separator; the goal goes on its own line (`SprintHeader.tsx:63-72`).

## Phase 5 — Documents, Updates, Files (problems 22–29, 36–37)

- **One title helper (#25):** `docTitle(filename)` in `src/lib/organizations/doc-rules.ts` replaces the ~7 copied `.replace(/\.(md|mdx|markdown)$/)` calls. The rail, list and dialogs show the title.
- **Reader header (#22):** title, "Updated by … · when" (`useFileVersions` `uploadedByName`), read status (`ReadByLine` / `OrgDocItem.label`), Edit, and `⋯`.
- **Empty (#23):** Add document creates blank content (`AddDocDialog.tsx:138`); the title comes from the filename. "Empty" means nothing but whitespace or a single heading equal to the title, in the viewer and in the server visitor checks (`doc.ts:173-175`). Shows "This document is empty" with "Start writing".
- **`⋯` menu (#24):** move `OrgDocAdminTools` out of the rail (`WorkspaceDocRail.tsx:188`) into an `ItemMenu`:
  - Group, Required, Who can see it, Show in workspaces, Link to sprint, Template
  - History (`FileVersionHistoryPanel`)
  - Remove (`rail.askRemove`)
  - Publish opens `PublishDialog` whenever the state isn't published (check `docState` for linked docs, `doc-rules.ts:91-98`).
- **Add (#26):** "Blank, or start from a template". Organization templates are offered in org mode too (`AddDocDialog.tsx:39`).
- **Title and URL (#27):**
  - `workspace-route.tsx:79` maps `docs` → `readme` for the visibility check, so the title gets "Documents ·".
  - Switching tabs keeps `doc=<real slug>` (`WorkspaceDashboardClient.tsx:640-643`), `DocTab` rewrites the URL to `data.docSlug`, and the notification links (`workspace-events.ts:154`) use the slug.
- **Updates (#28, #29):**
  - The composer toolbar wraps: `flex-wrap` at `WorkspaceUpdateComposer.tsx:976`, with only the Post group `shrink-0`. Add a browser assertion that Post is inside the column at 1280px and at 375px.
  - `UpdatesTab` gets `isOrganization` / `isChild` props from `WorkspaceDashboardClient.tsx:275-282`, so the wording is right before the feed loads.
- **Files (#36, #37):**
  - `starterFolders()` (`file-rules.ts:35-43`) gains `template` and `purpose`, written as metadata in `org-files.ts:18`. The row shows the purpose next to the chip (`FolderListRow.tsx:517`). Migration **0062_starter_folder_metadata** backfills existing organizations' starter folders by their known names.
  - After "New folder" in an organization, open `FolderAccessDialog` on the new folder for admins (`ExplorerDialogsHost.tsx:551-620`, `useExplorerMutations.ts:170-189`, `setFolderAccessAction`).

## Phase 6 — Workspaces, Members, Settings, Join, Discover, Teams (problems 38–46, 49–51)

- **Workspaces (#38):** row avatar (select the cover image at `OrgOverviewParts.tsx:391`), "Remind lead" visible on rows that need it, and `⋯` says "Detach" (dialog text too, `:305,418-430`).
- **Members (#39–42):**
  - #39: photo on each roster row (`avatarUrl` is already returned).
  - #40: "You're the only one here so far" with the larger invite panel; the panel data comes from Phase 1.
  - #41: an `isSelf` flag hides Block, Verify and Revoke on your own panel (`OrgMembersTab.tsx:394-396,438-441`), and the actions refuse self on the server, with a DB test.
  - #42: the drawer gets `sm:max-w-[560px]` (`OrgMembersTab.tsx:235`).
- **Settings (#43–46):**
  - "Organization settings", "Organization image" and "Links" when `organization` (`WorkspaceSettingsNavigation.tsx:112,124`, `GeneralSettingsSection.tsx:572-574,617`, `WorkspaceSettingsTab.tsx:1430-1432`).
  - Hide `ReadOnlySlugField` on organizations (`GeneralSettingsSection.tsx:780`).
  - "All details are saved." (`:829`).
  - Members get their sections: change the early return to `if (!canManageSettings && !organization)` (`WorkspaceSettingsTab.tsx:1315`), so `orgSettingsSectionIds` shows My membership, What's allowed, Privacy, and Management (Leave), opening on My membership. Add a browser and a DB check that members can't save admin sections.
- **Join (#49):** the description follows `preview.state`: member or owner → "You're already in CSE 3B" with "Open CSE 3B". `orgHref` uses `/org/` (`join/[code]/page.tsx:45,47`).
- **Discover (#50):** select `kind`, `org_type`, `org_settings`, `verified_at` and the child count in `public-feed-service.ts:117-148`, and map them in `mapPublicWorkspaceToDiscoverWorkspace` (`public-feed.ts:104-167`). The first page then uses the organization card. Update `public-workspace-owner-mask.test.ts`.
- **Teams (#51):** `OpenRolesCard.tsx:86-93` in an organization: "Teams", "No teams yet. A workspace works fine without them.", "Add team".

## Phase 7 — Profile and contributions (problems 52–66)

- **Profile page:**
  - #52: `storyMonth()` → "Since Oct 2026" (`ProfileOrganizationsSection.tsx:46`).
  - #56: logos with `WorkspaceAvatar` (add `coverImage` to `MyProfileOrganization`, `organizations.ts:436-443`).
  - #53: drafts nest with `nestContributions` too (`profile-rules.ts:70-81`).
  - #54: the nudge uses `c.projectTitle` (`WorkspaceContributionsCard.tsx:165`).
  - #55: Publish shows beside the nudge, and both open that entry (`profileEditHref("experience","overview",{contribution:id})`).
- **Edit links (#59):** "Edit contribution" in Manage organizations deep-links to the entry; `readMyProfileOrganizationsAction` returns the contribution id.
- **Editor list (#57, #60):**
  - Group with `groupProfileContributions` / `nestContributions`: Organizations (nested), Workspaces, Not on your profile yet, Private to you, each with a status.
  - Previews render mentions through `STORY_REFERENCE_PATTERN` with `resolvedReferences`, and strip markdown escapes (`ContributionEditor.tsx:1126-1128`).
- **Role (#58):** a child workspace owner shows "Team lead" (`contributionRoleLabel`, `collaboration.ts:447-466`), with a unit test.
- **Organization entry (#61–66):**
  - #61: header from `projectKind`, `orgVerified`, `coverImage`, "Set by CSE 3B", and "✓ Verified by …" (`OrgEntryLine` wording).
  - #62: organization wording at `:1176,1322,1404`; hide the "Clearing this…" hint when `recordLocked`. The validation copy at `contribution-story.ts:262` follows the kind.
  - #63: Publish is always available for an unpublished entry (change the `hasPublishChanges` rule at `:236-243,965`). Validation runs at once and lists what's missing (a summary). The Show switch saves.
  - #64: `roleCount(n,"position")`.
  - #65: "View as visitor" names the first reason it's hidden (`:2436-2456`).
  - #66: nested workspace entries listed under the organization entry, each opening its own editor.
- **Tests:** extend `organization-profile.test.ts`, `contribution-editor-state.test.ts`, `organizations-profile.test.ts` (publish an org entry; nested drafts), and `profile.spec.ts` (publish flow).

## Verification (end to end)

1. **Local:** each phase's tests, then the full gate:
   - `typecheck`, lint
   - unit, DB on a rebuilt disposable database
   - all browser specs (Chromium and WebKit)
   - the contract checks
2. **Before and after numbers:** the normal-workspace benchmark script (`bench-normal-workspace.mts`, within 20%) and `organizations-scale.test.ts`.
3. **Push on your approval only:**
   - apply 0059–0062 live first (the migration runner now uses a 5 s lock timeout)
   - push
   - re-sync Inngest if jobs changed
   - `canary`
4. **Live re-check:** repeat the live walk in the browser pane on networkbase.in for all 66 rows: every tab, menu, form and dialog, with the same timing script, and the console checked for #418. Each row in `2026-11-03-org-live-check.md` gets marked Fixed with its commit.
5. **Later, as agreed:** student-side views (board, Hand in, review, Mark away, emails, two-browser live updates) with a second account.

## Order and size

Phases run in order 1 → 7. Phase 1 (speed) and Phase 2 (Tasks) matter most and come first.

New migrations, all additive:

| Migration | Purpose |
|---|---|
| 0059 | Data cleanup: main assignments that went through ordinary review |
| 0060 | Hidden pinned posts, per person |
| 0061 | Which workspaces an organization sprint is shared with |
| 0062 | Starter folder metadata backfill |

No push, no live migration and no Railway changes without your word at each stage.
