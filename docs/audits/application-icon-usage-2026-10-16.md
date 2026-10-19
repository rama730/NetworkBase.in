# Application icon usage audit — 16 October 2026

Status: implemented for all in-scope removal recommendations. The entire Messages system remains excluded and unchanged. Audit and implementation checks were performed through source code and command-line tooling only; no browser, screenshots, or runtime visual checks were used.

## Explicit exclusion: entire Messages system

Per the user's updated scope, the entire Messages system is excluded from this cleanup. Do not change its icons, headings, labels, spacing, styling, dialogs, canvas, editors, navigation, attachments, sharing flows or behavior. This covers Messages wherever it appears, including full-page, project-channel, drawer, floating-window and mobile surfaces.

All previously recorded Messages removal recommendations are withdrawn and removed below. Do not modify Messages components or routes as part of this audit's implementation. Shared-component or global-style changes must preserve every Messages consumer's existing output; scope changes to non-Messages consumers instead when necessary. This exclusion takes precedence over the general rules in this document.

## Scope and evidence

The original source inventory covered all 442 `.tsx`/`.jsx` files under `src/app`, `src/components`, and `src/lib`, including Messages before its exclusion. A TypeScript AST inventory found 240 files importing Lucide, 1,382 render sites for imported Lucide icons or common dynamic icon components, and 291 HTML/dialog heading sites. These historical inventory totals do not describe the reduced implementation scope. They are static source counts, not counts of visible icons or confirmed defects. Conditional branches, unused components, repeated list renders and alternative layouts affect what actually appears.

The review combined that inventory with searches for icon props, shared heading components, navigation definitions, inline SVG, branded artwork and render context. Findings below distinguish confirmed redundant heading/label artwork from meaningful actions, navigation and state. Source analysis cannot establish exact rendered spacing, overflow or visual weight; those should not be represented as visually verified.

## Application-wide decision rule

These rules apply only to in-scope surfaces outside the Messages system.

1. Ordinary content headings and section labels use text. Do not put a generic pictogram or boxed pictogram before them merely to repeat their title.
2. Preserve navigation icons in app/sidebar navigation, project tabs, settings section navigation, wizard navigation and compact/mobile destination selectors.
3. Preserve controls and their affordances: search, filter, add, edit, close, copy, download, expand/collapse, ordering, editor formatting and menus.
4. Preserve meaningful state and identity: private/locked access, mandatory policies, errors, warnings, loading, task status/priority, unread/saved/pinned state, notification event types, file/folder types, provider logos, proper skill artwork, actual avatars and presence.
5. A click target does not automatically justify a decorative leading icon. In a settings accordion, the category picture can be removed while the chevron, counts, mandatory-lock indication and interaction remain.
6. Standalone empty/success/error states and explanatory illustrations are a separate pattern. Keep one purposeful state illustration where appropriate, rather than treating it as an ordinary section-heading prefix or introducing multiple repeated decorations.
7. This audit does not authorize stripping user-authored document graphics, emoji, avatars, or project artwork.

## Implemented removals and preserved baselines

The table records the original findings and pre-implementation source locations. All proposed removals below are implemented outside Messages. Existing plain-heading baselines remain in place. Public marketing feature pictograms were deliberately simplified as well, while navigation/action icons and brand artwork remain.

| Surface | Code evidence | Proposed treatment |
| --- | --- | --- |
| Public and own profile sections | `src/components/profile/v2/sections/AboutCard.tsx:25`; `ProjectContributionsCard.tsx:74` | Remove User and Briefcase from the headings. Keep edit/add controls, private-contribution state, timeline information and project identity. |
| Shared profile card header | `src/components/profile/v2/sections/Card.tsx:26` | Remove the decorative icon slot or stop feeding it; remove its wrapper and associated gap. Keep semantic section headings and action slots. |
| Main Settings document | `src/components/settings/SettingsDocument.tsx:33` | Remove the boxed icon before each content-section title. Keep the icons in `SettingsLayout` navigation. |
| Main Settings nested headings | `src/components/settings/NotificationsSettings.tsx:172` | Remove BellOff before the static “Muted scopes” heading. Actual mute controls and mute state retain their meaning. |
| Project Settings → collaborators | `src/components/projects/tabs/ProjectSettingsTab.tsx:1786,1850` | Remove pictograms before “Project leadership” and “Team directory” section labels. Preserve member roles, permissions and relevant state. |
| Project Settings → documents and updates | `ProjectSettingsTab.tsx:1999,2061` | Remove SlidersHorizontal before “Content delivery & notification rules” and “Publishing permissions.” Keep their switches, scope labels and saving feedback. |
| Project Settings → notifications | `ProjectSettingsTab.tsx:2264`; `src/components/projects/settings/ProjectNotificationSettings.tsx:80` | Remove the static workflow-heading bell and boxed category icons. Keep accordion chevrons, active counts, mandatory locks and delivery settings. |
| Project Settings → file policies | `src/components/projects/settings/FileWorkspaceMembers.tsx:145,234` | Remove Shield/Users decorating “Project Leadership” and “Team Member Intake.” Keep the lead-policy indicator and locked/mandatory state within policy content. |
| Project Settings → roles | `src/components/projects/settings/ProjectRolesEditor.tsx:255,336` | Remove Users/Briefcase decorating “Occupied” and “Open” group labels. Keep seat selection, role identities, counts and preview actions. |
| Project Settings → policy explanations | `src/components/projects/settings/SettingsPolicyDetails.tsx:229` | Repeated KeyRound on each explanatory list item adds no item-specific information. Prefer plain list content; retain actual permission/security warnings. |
| Project Settings existing plain headers | `src/components/projects/settings/SettingsFormFields.tsx:43`; `GeneralSettingsSection.tsx:545` | Existing plain SettingsCard headings and “Project avatar” title already provide a baseline. Do not add icons to them. |
| Workspace task project groups | `src/components/workspace/WorkspaceTasksTab.tsx:489` | Remove the generic Folder before the project name. Keep the collapse arrow, key, task count, filters, assignee and task state. Workspace launcher and tab icons remain navigation. |
| Project edit/apply/invite dialogs | `src/components/projects/EditProjectModal.tsx:258`; `src/components/projects/dashboard/InviteCollaboratorModal.tsx:522` | Use plain titles instead of Sparkles or role/team title icons. Keep action buttons, member search, validation and invitation/application state. |
| File and task version-history titles | `src/components/projects/v2/tasks/components/FileVersionHistoryDrawer.tsx:228`; `src/components/projects/v2/files-tab/file/FileVersionHistoryPanel.tsx:320` | Remove History from the ordinary panel/dialog title in both flows. Preserve close controls, version identities, comparison actions and actual history entries. |
| Documents rail heading | `src/components/projects/doc/ProjectDocRail.tsx:115` | Remove FileText from the “Documents” group title. Keep document-item type/identity icons, navigation actions and loading state. |
| Project-creation review | `src/components/projects/create-wizard/phases/Phase5Review.tsx:57` | Remove decorative icons from plain ReviewRow labels such as Category, Tags and technologies, Project lead and Project journey. Preserve underlying source/provider artwork, real file types, access state and actionable links. |
| Task-creation subtask previews | `src/components/projects/v2/tasks/CreateTaskModal.tsx:633` | The fixed CheckSquare before each draft subtask title is decorative, not an interactive completion control. Remove it; preserve actual task/subtask checkboxes elsewhere. |
| Sprint summaries | `src/components/projects/tabs/sprint/SprintTimelineContent.tsx:102`; `src/components/projects/v2/sprints/CreateSprintModal.tsx:396` | Flag repeated before text-labelled Started/Completed events and CalendarDays before a fully labelled schedule summary can be omitted. Keep actual date-input controls, lifecycle state and completion controls. |
| Auth decorative embellishments | `src/components/auth/SignupForm.tsx:462,707` | Invitation and generated-handle Sparkles are decorative candidates. Keep provider logos, password visibility, validation, verification results and security-state indicators. |
| Public marketing decoration | `src/app/(site)/page.tsx:31,32,36` | Includes a static FolderKanban illustration and feature pictograms. These are marketing illustrations rather than app navigation. They are covered by the inventory, but should be an explicit illustration exception or a deliberate simplification—not accidentally deleted by a shared app-heading change. |

## Functional and semantic icons to retain, by area

| Area reviewed | Retain |
| --- | --- |
| App shell, mobile navigation and global search | Navigation destinations, theme controls, search affordances, result-type identification in mixed results, notification controls and account identity. A settings search-result icon is a destination cue, unlike a repeated content heading. |
| Discover and Network | Search/filter controls, connection actions and states, location pins, shared-connection metadata, collaboration/presence state and proper skill artwork. Main titles and rail headings already use text. |
| Profile editing | Left section navigation, upload/change/remove photo controls, edits, actions and meaningful warnings. Existing content titles are already plain. |
| Project dashboard | Project-tab navigation, journey status, recent-activity event types, open-role application status, actual project links/provider identity and action controls. Rail headings already use text through `RailSectionHeading`. |
| Tasks and sprints | Actual status/priority symbols, selectable completion controls, attachment/comment counts, assignees/unassigned state, drag/menu affordances and date controls. These are not equivalent to a static CheckSquare decorating a draft title. |
| Files and storage | Actual file/folder types, selected state, expansion, upload/download, transfer progress, trash/restore actions, sync/conflict/error state, GitHub/IDE identity and linked-task types in mixed lists. Generic file-type artwork remains useful even though generic skill fallback artwork was removed in the previous task. |
| Documents and editors | Formatting controls, smart-block/reference types, command actions and embedded content identity. A reference icon distinguishes a task from a file or person and is not a heading decoration. |
| Updates and comments | Media types, like/comment/pin states, reply affordances, actions and loading/failure feedback. Static rail titles already use text. |
| Sharing outside Messages | Preserve share actions and destination-type cues on non-Messages surfaces. Messages sharing flows and any shared components used within Messages remain unchanged under the explicit exclusion. |
| Notifications | Event-type icons and read/unread/action state. One empty-state illustration is separate from a normal title prefix. |
| Settings and integrations | Navigation, service/provider identity, device/session identification, action controls, verified/mandatory/private states, security warnings and progress. Theme/visibility option icons describe choices rather than repeating document headings. |
| Authentication and onboarding | Provider identity, step navigation/progress, validation and verification state, password controls, location input cues and security/authorization warnings. Ordinary onboarding titles already use text. |
| Legal, privacy and cookies | Legal document headings are already plain. Keep expand/external-link controls and meaningful consent/security state. Essential/Analytics icons describe preference categories; they do not require global deletion as heading icons. |

## Shared-component and maintenance findings

Implementation resolution: the profile Card, unused DashboardCard heading, and FileInspectorPanelHeader no longer expose decorative title-icon slots. Main Settings and project Settings loading placeholders no longer reserve decorative icon space. The remaining notes explain the original maintenance findings and preservation rules.

- `src/components/profile/v2/sections/Card.tsx` exposes a decorative heading icon slot. Fixing only its current callers leaves an easy route for inconsistent usage to return.
- `src/components/projects/dashboard/DashboardCard.tsx` also offers a boxed heading icon. No external consumers were found in `src` during this audit. Treat it as a latent consistency issue, not evidence of a current visible defect.
- `FileInspectorPanelHeader` permits a title icon; only the version-history caller supplies one among the consumers inspected. Do not remove file-type artwork elsewhere in the inspector.
- `SettingsSectionCard`, project `SettingsCard`, `SettingsPageHeader`, `RailSectionHeading` and onboarding `StepHeader` demonstrate existing text-led patterns. Reuse their hierarchy rather than introducing new heading styles.
- Icon use is not confined to literal HTML headings. Several decorative section labels are `<span>` or `<p>` nodes; others are nested inside buttons, custom card props or dialog wrappers. An automated rule limited to `<h*>` or a global CSS rule hiding SVGs would miss candidates and break meaningful controls.
- Settings accordion artwork and navigation artwork share icon sources. Their placement and responsibility—not the Lucide import name—determine whether they belong.
- Preserve user/project avatar fallbacks. The earlier removal of skill monograms does not imply removing identity fallback initials throughout the application.

## Layout and accessibility requirements applied

- Remove decorative wrappers, reserved widths, icon-specific left padding and surplus gaps with the icon. Let titles align naturally with descriptions and body content.
- Keep the existing page/section/card heading hierarchy and design tokens. Removing a pictogram does not mean making all headings the same size.
- Retain right-side edit/add/close controls, their accessible names and touch targets. Preserve `aria-expanded`, `aria-controls`, heading IDs and section relationships.
- Do not remove state solely because it is an icon. Preserve or provide the accompanying state text and accessible label.
- Apply the same treatment to desktop/mobile variants, owner/visitor states, dialogs/drawers and relevant skeleton placeholders. Avoid leaving an icon-sized loading block for a text-only header.
- Prefer targeted shared-component and call-site changes. Do not hide all icons in headings, settings panels or cards with broad CSS selectors.
- Preserve the entire Messages system, including indirect effects from shared components, typography tokens, global CSS, dialogs, editors and skeletons. If a shared change would alter Messages, restrict the change to in-scope consumers.
- Verification covers existing source-contract tests, TypeScript, ESLint and a server-rendered scope check; no browser checks were used.

## Implementation and validation results

- Removed audited decorative artwork from profile, main Settings, nested project Settings, Workspace task groups, project dialogs, version-history headings, the Docs heading, project-creation review labels, draft-subtask previews, sprint summaries, signup embellishments and public marketing feature labels.
- Preserved semantic review icons for source/repository/folder type and visibility, along with navigation, actions, warnings, mandatory-policy locks, file identities, empty-state illustrations and real avatars.
- Dependency tracing found three shared components used by Messages: InviteCollaboratorModal, CreateTaskModal and the task FileVersionHistoryDrawer. They preserve their original presentation by default. A DOM-free PlainContentHeadings provider opts project-dashboard, profile-invitation and role-application entry points into the cleanup; Messages callers remain untouched. Server rendering confirms that the opt-in does not leak into default consumers.
- All 130 files in the saved Messages source baseline remain byte-for-byte unchanged. No shared global CSS, common dialog primitive, or typography token was changed by this implementation.
- TypeScript passes; ESLint passes for all 30 changed implementation files; whitespace checks pass.
- 148 existing focused tests executed: 138 pass. The ten failing project-settings source-contract assertions also fail against the saved pre-cleanup source. They expect a historical SectionHeader suppression expression that was already absent; this cleanup introduces no additional failures in this run. Tests were not rewritten to mask those existing failures.
