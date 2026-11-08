# Organization design consistency: full audit and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every organization screen (creation, the header and all tabs, Settings, the child workspaces, joining, and every place outside that shows an organization) follows the NetworkBase design specification exactly, using one set of shared parts.

**Architecture:** The audit found the same few root causes everywhere: there is no shared select, textarea, radio, notice, copy button or verified mark, so each file styles its own. The fix builds those once (Task 2) and then moves each surface onto them (Tasks 3–15). A source contract test (Task 1) fails today and lists every banned pattern; each task deletes its share until the test passes. No new tables, actions or dependencies.

**Tech stack:** Next.js 16, React 19, Tailwind (tokens in `src/app/globals.css`), Radix primitives in `src/components/ui`, node:test, Playwright browser fixtures.

**Spec:** `docs/design/networkbase-application-design-specification.html` (§03 colour, §04 type, §05 geometry, §06 icons, §08 shell, §10 primitives, §18 creation, §19 project shell, §33 states, §34 accessibility) and `docs/superpowers/specs/2026-11-01-organization-end-to-end-design.md` (§2 five rules, §5 shared building blocks, §7 tab by tab). The design spec never names organizations, so organization screens follow its project and primitive rules.

**Audit method:** I read every file in `src/components/organizations/` (46 files, about 11,000 lines), the organization branches of the workspace shell, dashboard, Settings, the creation wizard, Updates, Sprints, Tasks and Files, and the outside surfaces (Discover, search, cards, sidebar, My work, Network, the join page). I also ran pattern counts across the folder. Nothing was run in a browser. Line numbers are from `82fd8f983`.

**Counts across `src/components/organizations/`:** 66 native `<select>` (9 heights), 34 native checkboxes, 16 native radios, 28 textareas styled 6 ways, 105 raw `<button>`, 27 see-through backgrounds (`bg-muted/30`…), 15 uses of 9–10px text, 9 hard-coded hex colours, 0 uses of the shared `ErrorNotice`, `EmptyState`, `Select` or `UnderlineTabs`.

## Global Constraints

- Colours come only from semantic tokens: `--primary`, `--muted`, `--border`, `--status-success|warning|danger|info` and their `-soft` versions. No hex, no Tailwind palette (`amber-700`, `sky-500`…), no `/NN` alpha tints for surfaces or text (§03, §06A).
- Type scale 11, 12, 13, 15, 17, 20, 24, 30px (Tailwind `text-xs`=12, `sm`=13, `base`=15, `lg`=17, `xl`=20, `2xl`=24, `3xl`=30). Uppercase only in the mono micro label (`.nb-micro`) or badge (`.nb-status`) (§04).
- Radii: badge 3 (`rounded-sm`), control 5 (`rounded-md`), card 8 (`rounded-lg`), dialog 12 (`rounded-xl`). Nothing else. Pills (`rounded-full`) only for human topic tags (`.nb-tag`), progress tracks and presence dots (§05, §10).
- Control heights 28 / 34 / 42px (`--ui-control-height-sm|default|lg`); 44px touch target on coarse pointers (§05, §09).
- Avatars square: 20 / 26 / 34 / 48 / 72px; 5px radius up to 34, 8px at 48 and 72 (§05, §10).
- Badge = system status (`.nb-status`, 11px mono uppercase, 3px). Tag = human topic (`.nb-tag`). Counts are mono metadata (`.nb-meta`), never a badge or tag (§10).
- Switch only for settings that save at once; a value saved by a Save button uses a checkbox (§10).
- One filled (primary) button per local decision area; in the organization header that is `+ New` (§10, org spec §7.1).
- Field: 13px medium label, 13px hint and error, label tied to the input, required mark in clay (§10).
- States on every surface: layout-matched skeleton, no-content (dashed blueprint panel), no-matches with Clear filters, inline error with Retry, restricted, archived (§33; org spec §2 rule 2).
- No generic spinner; no opacity on readable text (opacity is for disabled controls only) (§05, §06A).
- The organization's own role words everywhere people read them (org spec §2 rule 5).
- Copy: sentence case, verb + object on actions, periods on sentences, none on labels, no exclamation marks (§04).
- Commit locally only; nothing is pushed or deployed without the user's word.

## Review Focus

1. **Dark theme**: the hex colours in Files have `dark:` patches, so their replacement must still read in dark mode. Task 12's browser check takes a dark-mode screenshot.
2. **A member and a visitor, not only the owner**: most findings were read in owner code paths. Every task's browser step checks the member and visitor versions where the surface shows them.
3. **Phone width (390px)**: moving to 34px controls and square avatars can wrap toolbars (Members, Workspaces, Review queue). Each task's browser step checks 390px with no sideways page scroll.
4. **Switches that now save at once (Task 7)**: a failed save must flip the switch back and say why. Pinned in Task 7's test.
5. **Shared shell changes reach every workspace**: Task 3 edits `WorkspaceLayout.tsx`, which every workspace uses. Its browser step checks a plain workspace too.

## Status (2026-11-09): implemented on local main, not pushed

Commits: the first part (contract test, shared parts, header, Overview, About, Members, invites) was folded by another session into `9cdb50f5c`; then `85f4fd54d` Settings, `b8ed5494d` creation, `45f3b15cb` Workspaces tab, `d7a173e76` Updates/Documents/Files/Sprints, `178eddb96` assignments and review, `7aa7bd7e0` cards, search, Discover, sidebar.

Checks: `tests/unit/org-design-contract.test.ts` passes 25 of 25; unit suite passes except four tests broken by the CLI commit `d2eaf2fa2` (IDE extensions, personal settings, migration lineage, integrations); the 110 organization and workspace browser tests pass; the failing `settings-tabs`, `person-card` and `desktop-ide` browser tests fail identically at `d2eaf2fa2`, before this work. Screenshots taken at 1280 and 390px, light and dark, for the header, Overview, About, Members and Workspaces.

Where the build differs from a finding, on purpose:
- SH1: the identity image stays 64px (sized to the name and tagline block, covered by `workspace-header.spec.ts`); only its corners changed to 8px.
- ST6, CR14: checked and already right; no change.
- CR3: the eyebrow is uppercase by CSS, so only the repeated title changed.
- CH6: the organization's document rows already matched the workspace's own rows; only the heading changed.
- TK8: the split Approve button already used the shared Button and menu; only its heights changed.
- OUT4: the person card keeps the other session's own chip styling (and its test); the default chip used in search became metadata.
- OUT6: the sidebar toggle stays 20px on desktop inside the 32px row and grows to 44px on touch.
- UP7: the organization toast reads "Update posted".

Not checked: a signed-in run against real data, and the Settings sections in a browser (they are covered by type checks and unit tests only).

## Decisions (defaults confirmed by the user, 2026-11-05)

| # | Question | Default in this plan | Other choice |
|---|---|---|---|
| D1 | Org Settings switches wait for Save; workspace Settings switches save at once, in the same document | Org switches save at once, like workspace Settings (Task 7) | Keep Save buttons and change the switches to checkboxes |
| D2 | Visibility words: Public / Organization only / Organization / Members only / Private are all used | **Public · Organization only · Private** everywhere | — |
| D3 | Sprint status words: Running, Ended, planned, active, completed are all used | Org spec §5.7: **Upcoming · Active · Completed · Archived · Cancelled** | — |
| D4 | Avatars: organization screens use round avatars, the spec says square | Square, per spec | Keep round everywhere (spec change) |
| D5 | Links: the spec says cobalt (`#2563C9`), the app uses clay (`text-primary`) everywhere | Keep clay and use **one** link style (`Button variant="link"`); cobalt is an app-wide change | Switch the app to cobalt links |
| D6 | Active tab label: clay text in the shell; the spec says strong text with a clay underline | Strong text + clay underline (changes workspaces too) | Leave as is |
| D7 | Archive confirmation: red (destructive) today, though Archive can be undone | Outline/default confirm for Archive; red only for Delete, Remove, Detach | — |

---

## Findings register

Each row: **ID · where · what is wrong · rule broken · fix.** "Fix" names the shared part from Task 2 where one applies.

### G: Across all organization screens (root causes)

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| G1 | 66 `<select>` in 26 files | Nine heights (20, 24, 28, 30, 32, 34, 36px…) and four radii; e.g. `AssignmentsPanel.tsx:397` h-5 10px, `ChildTeamFields.tsx:156` h-6 11px, `OrgOverviewParts.tsx:365` h-7 4px radius, `OrgMembersTab.tsx:60` h-9 | §10 Select: input-matched, 28/34/42, 5px | `NativeSelect` (Task 2) |
| G2 | 34 checkboxes | Browser-default checkbox, no clay check, no drawn focus (e.g. `OrgMembersTab.tsx:206`, `OrgDangerZone.tsx` Duplicate, `OrgDocParts.tsx:199-201`) | §10 Checkbox 16px, 3px, clay | `ui/checkbox` |
| G3 | 16 radios | Browser-default radios (`OrgSettingsSections.tsx:318-319,487-488,497,653-657`, `ChildOrgSection.tsx:185`, `OrgFilesPanel.tsx:92-99`, `OrgWizardFields.tsx` join mode, creation) | §10 Radio 16px, 8px clay centre | `.nb-radio` (Task 2) |
| G4 | 28 textareas | Six styles: 13px + ring-2 (`HandInSection.tsx:22`, `ReviewQueueParts.tsx:48`, `ClassQuestions.tsx:14`, `AssignmentDialogs.tsx:14` copied four times), 15px (`OrgWizardFields.tsx` textAreaClass), 8px corners + no resize (`JoinOrgButton.tsx`), `focus:border-primary` (`OrgWorkspacesTab.tsx:538`), bare (`OrgInvitePanel.tsx:124,144`) | §10 Textarea 10×12 inset, 5px, focus clay border | `ui/textarea` (Task 2) |
| G5 | 105 raw `<button>` | Actions styled by hand instead of `Button`; many are underlined text pretending to be links | §10 Button variants | `Button` / `Button variant="link"` |
| G6 | Text actions | At least six link looks: underline foreground (`OrgAboutTab.tsx:66`), `text-primary hover:underline` (`OrgAboutTab.tsx:97`), `font-medium text-primary` (`OrgWorkspacesTab.tsx:328`), 12px underline (`OrgOverviewParts.tsx:146`), `text-xs font-semibold text-primary` (`OrgRequestsSection.tsx` Review all), muted underline (`OrgWorkspacesTab.tsx:410`) | §04/§10 one link role | One link style (D5) |
| G7 | 15 places | 9px and 10px text: `OrgOverviewParts.tsx:135,436`, `OrgFileBrowser.tsx:58,101,119`, `OrgDocParts.tsx:90,96`, `FolderAccessChip.tsx:19-21`, `ReviewQueue.tsx:40,277,278,302`, `AssignmentsPanel.tsx:397` | §04 smallest is 11px | 11px `.nb-micro` / 12px `.nb-meta` |
| G8 | Radii | `rounded` (4px) ×15, `rounded-[4px]` ×6, `rounded-[6px]` ×6, `rounded-[2px]` (`WorkspaceCard.tsx:81`), plus 32 literal `[3px]/[5px]/[8px]` instead of `rounded-sm/md/lg` | §05 radii 3/5/8/12 | Token classes only |
| G9 | Files | Hex colours `#DBD5C8 #FAF8F5 #4C5A61 #E8E3D9 #141A1E #8E9AA1 #F3F0EA #D14E24 #FCF0EA #B23F1C` in `OrgFileBrowser.tsx:49,56,58,67,81,95,120` and `OrgFileViews.tsx:88,147` | §06A no hard-coded colour | Tokens |
| G10 | Palette colours | `amber-600/700/800` (`OrgOverviewParts.tsx:85,344,412`, `OrgWorkspacesTab.tsx:277`, `OrgFilesPanel.tsx:122`, `OrgSprintParts.tsx:63,205`, `AssignmentsPanel.tsx:471,484`, `OrgStorageSection.tsx:66`), `sky/emerald/violet/amber/rose/slate-500` (`OrgStorageSection.tsx:21-26`), `amber-500/red-500` (`WorkspaceLayout.tsx:513-514`), `ring-amber-500` (`OrgStorageSection.tsx:61`) | §03 status colours only | `--status-*` |
| G11 | 27 places | See-through surfaces `bg-muted/30/40/50`, `bg-secondary/50`, `bg-primary/5/10`, `border-primary/40`, `bg-destructive/5`, `border-destructive/30` | §03 sunken = paper-100; status soft tokens | `bg-muted`, `--status-*-soft` |
| G12 | Faded content | `opacity-60` on archived rows (`OrgWorkspacesTab.tsx:428,459`), next stage (`OrgAboutTab.tsx:95`), ghost stages `opacity-40` (`OrgAboutTab.tsx:101`), blocked audience chips (`OrgUpdateParts.tsx:119`), placed people (`ChildTeamFields.tsx:112`); `hover:opacity-90` (`OrgOverviewParts.tsx:356`) | §05 opacity is a disabled treatment only | Muted text token + `Archived` badge |
| G13 | Badges | Four badge systems: `.nb-status` (correct); a local `Badge` in `OrgFileBrowser.tsx:118-124` (10px, clay used as "warning"); doc chips `OrgDocParts.tsx:90-101` (10px); hand-made 11px sans chips for role/Blocked/Outside/visibility/New (`OrgMembersTab.tsx:175,219,222`, `OrgWorkspacesTab.tsx:304-305`, `SharedOrgChip.tsx:29`, `FolderAccessChip.tsx:19-21`) | §10 Badge contract | `.nb-status` with tones (Task 2) |
| G14 | Tags as status/counts | `.nb-tag` (pill topic tag) used for sprint status (`OrgOverviewParts.tsx:151`), counts `12/40` (`:172`), `N overdue` (`:344`), `N requests` (`:361`), health counts (`OrgWorkspacesTab.tsx:268-270`), doc status (`OrgDocParts.tsx:250`) | §10 counts never masquerade as status; tags are human topics | Badge for status, `.nb-meta` for counts |
| G15 | Wrong status meaning | Archived drawn as draft/amber (`OrgWorkspacesTab.tsx:305`); Private as draft/amber (`OrgHeaderParts.tsx:130`); "Viewing as admin" as active/blue (`:131`); org type as active status (`WorkspaceCard.tsx:86`); Submitted mapped to `draft` (`HandInSection.tsx:23`) | §10 system-known status | Tone map (Task 2) |
| G16 | Verified mark | Five versions: `✓` at 0.6em in the H1 (`WorkspaceDashboardClient.tsx:1140`), `✓` span (`WorkspaceCard.tsx:90`), `BadgeCheck` icon (`OrgDiscoverySections.tsx:165`), "✓ Verified" text (`:368`), `✓` on members (`OrgMembersTab.tsx:220,415`) | §06 one Lucide vocabulary | `VerifiedMark` (Task 2) |
| G17 | Team lead mark | `★` text (`ChildUnitsPanel.tsx:71,79`, `OrgOverviewParts.tsx:440`, `AssignmentsPanel.tsx:587`) vs Lucide `Star` (`ChildTeamFields.tsx:151`) | §06 icons, not glyphs | Lucide `Star` 14px + "Team lead" text |
| G18 | Avatars | Round avatars at 20/24/28/32px (`OrgOverviewParts.tsx:55,357`, `OrgAboutTab.tsx:137`, `OrgMembersTab.tsx:215`, `AssignmentRoster.tsx:151`); 18px (`OrgFileBrowser.tsx:101`); hand-made initial circles (`OrgOverviewParts.tsx:436`) | §05/§10 square 20/26/34/48/72 | `UserAvatar` default square, sizes from the scale (D4) |
| G19 | Loading | Text "Loading…" (`OrgMembersTab.tsx:120,401,433`, `OrgMemberDialogs.tsx:141`, `OrgFilesPanel.tsx:165`); three generic bars (`OrgOverviewParts.tsx:221`); nothing (`OrgAboutTab`, `ChildUnitsPanel.tsx:24`, `OrgInviteBanner`) | §33 layout-matched skeleton | `.nb-skeleton` in the section's shape |
| G20 | Errors | Five patterns: centred grey line + underlined "Try again" (`OrgOverviewParts.tsx:223-226`); empty-state box + "Try again" (`OrgWorkspacesTab.tsx:115-118`); error text with no Retry (`OrgMembersTab.tsx:119`); silent (`OrgAboutTab`, `ChildUnitsPanel`, `OrgInviteBanner` Decline, Restore in `OrgHeaderParts.tsx:155`, End now in `OrgMembersTab.tsx:492`); one `toast()` for both outcomes (`OrgReportsSection` decide). `ErrorNotice` exists and is used 0 times here | §33 inline error with Retry | `ErrorNotice` |
| G21 | Empty | `EmptyState` used 0 times; `.nb-empty-state` copied by hand in `OrgWorkspacesTab.tsx:505`, `ReviewQueue.tsx:230,337`, `OrgFileBrowser.tsx:133`; elsewhere a grey sentence. Titles mix periods ("No workspaces yet." vs "No workspaces match these filters") | §33; org spec §5.4 teaching empty | `EmptyState` |
| G22 | False empty while loading | "Make someone an admin first." shows before admins load (`OrgDangerZone.tsx` TransferRow); "Nobody is blocked." shows before the list loads (`OrgModerationSection.tsx`) | §33 no empty state before data resolves | Wait for data |
| G23 | Confirmations | Six ways to confirm comparable actions: `ConfirmDialog`, swap the button for "Yes, …" (Transfer, Archive), inline box (new code in `OrgInvitePanel.tsx:77-84`), expand + type the handle (Delete), a plain `Dialog` (Leave), `ReasonDialog`. "New join code" is confirmed inline-red in the invite panel and by `ConfirmDialog` with a ghost trigger in Settings (`OrgSettingsSections.tsx:298-306`) | §10 one dialog contract | `ConfirmDialog` everywhere; type-to-confirm only for Delete |
| G24 | Destructive styling | Red confirm on reversible Archive (`OrgWorkspacesTab.tsx:557`, `ChildOrgSection.tsx:162`, `OrgDangerZone.tsx` ArchiveRow) and on "Make a new code"; red-free, unconfirmed "Remove" of reported content (`OrgReportsSection`) | §10 danger = destructive only | D7 |
| G25 | Save feedback | Inline "Saved." line (`OrgSettingsSections.tsx:61-71`, `OrgDangerZone.tsx` useRun, `ChildOrgSection.tsx:32-44`, `OrgDocParts.tsx:213`) vs toast elsewhere | §33 Success: brief past-tense toast | Toast; inline only for errors |
| G26 | Copy feedback | Button turns "Copied" (`OrgInvitePanel.tsx:67,72`), toast (`OrgDiscoverySections.tsx:31`, `OrgAboutTab.tsx:156`), status line (`OrganizationCreatedScreen`), nothing (`OrgSettingsSections.tsx:297`) | consistency | `CopyButton` (Task 2) |
| G27 | Role words | Generic words where the org's names belong: Members filter "Admins/Members/Viewers" (`OrgMembersTab.tsx:133`), "Admin" option (`:291`), summary "owners and admins · viewers" (`:248`), invite banner "a guest / an admin / a member" (`OrgInviteBanner.tsx`), audience "Admins" (`OrgUpdateParts.tsx:234`), comments "Members" (`:97`), Settings reply "Members" (`OrgSettingsSections.tsx:691`), picker "Members/Admins" (`ChildTeamFields.tsx`) | org spec §2 rule 5 | `orgRoleNames` / `label()` |
| G28 | Visibility words | Public / Organization only / Organization / Members only / Private (`ChildOrgSection.tsx:29-30`, `OrgWorkspacesTab.tsx:54,398`, `OrgDocParts.tsx:184`, Settings cap) | consistency | D2 |
| G29 | Lead words | "Owner" (`ChildTeamFields.tsx` ChildLeadAndUnassigned heading), "workspace lead", "Lead X" (`OrgWorkspacesTab.tsx:273`), "team lead" for the same or overlapping role | consistency | "Workspace lead" for a workspace, "Team lead" for a team |
| G30 | Doc naming | "Doc options", "Document options", "Doc", "Starter doc" | consistency | "Document" in interface copy |
| G31 | Dates | `toLocaleDateString` with the browser locale and no org zone (`OrgOverviewParts.tsx:38`, `OrgWorkspacesTab.tsx:56`, `OrgMembersTab.tsx:194,478`, `OrgAboutTab.tsx:124`) while other rows use `formatInZone`; dates in sans instead of mono metadata | §04 metadata mono, timezone where timing matters | `formatInZone` + `.nb-meta` |
| G32 | Counts | "Requests · N", "Requests (N)" (`OrgWorkspacesTab.tsx:597`), "Organization invitations (N)" (`OrgRequestsSection.tsx`), "More (N)" (sidebar); big numbers not tabular (`OrgOverviewParts.tsx:305-307`) | §04 middle dot, tabular numerals | "Label · N", `tabular-nums` |
| G33 | Arrow glyphs | Text arrows "→ ← ↓" as icons (`OrgOverviewParts.tsx:96,146,249,328`, `OrgAboutTab.tsx:79`, `OrgMembersTab.tsx:129`, `OrgDiscoverySections.tsx:86`, `OrgRequestsSection.tsx`) | §06 Lucide icons | `ArrowRight`/`ChevronRight` or no arrow |
| G34 | Section headings | Four heading looks for the same level: `.nb-micro`, `.nb-card-title`, 13px semibold h3/h4, and uppercase *sans* 11px (`OrgDocParts.tsx:134,174`, `OrgSettingsSections.tsx:559,582`) | §04 uppercase only in mono | `.nb-micro` for section keys, `.nb-card-title` for card headings |
| G35 | Field labels | Creation: 13px medium label, 13px hint (correct). Settings, Danger zone, Discovery: 13px **semibold** label, **12px** hint, `nb-compact` and `text-xs` together (`OrgSettingsSections.tsx:43-44`, `OrgDangerZone.tsx:23-24`, `OrgDiscoverySections.tsx:26-27`). Dialogs: 12px labels (`OrgDocParts.tsx:171-201`, `OrgMembersTab.tsx:498-499`). Errors in 12px (`OrgSettingsSections.tsx:253,327`, `OrgHeaderParts.tsx:82`, `OrgSprintParts.tsx:243,250`) | §10 Field | One `labelClass`/`hintClass` in Task 2 |
| G36 | Control heights | 24, 26, 28, 30, 32, 34, 36, 44px mixed in single toolbars (Members 36 + 28; Workspaces 30; Review queue 30; Files 24) | §05 28/34/42 | `sm` (28) in dense toolbars, default (34) elsewhere |
| G37 | Small targets | Icon buttons at 18–24px: pinned ⋯ and × (`OrgOverviewParts.tsx:61,73`), welcome × (`:246`), new-workspace + (`:332`), About × and pencil (`OrgAboutTab.tsx:61,63`), invite ⋯ (`OrgInvitePanel.tsx:53`), group arrows (`OrgDocParts.tsx:291-293`), chip buttons (`ChildTeamFields.tsx:150,162`), material × (`AssignmentsPanel.tsx:472`), sidebar toggle (`SidebarWorkspaces.tsx:94`) | §10 IconButton 28/34, 44 touch | `Button size="icon-sm"` + `nb-touch-target` |
| G38 | Tabs and toggles | Six tab builds: shell tabs, Workspaces status tabs, Updates filter chips (`role=tablist`), people-picker pills (`ChildTeamFields.tsx`), Review tabs (`ReviewQueueParts`), and the unused `UnderlineTabs`. Four "selected" looks: clay 10% fill, grey fill, dark border, solid clay | §10 Tabs: underline; filter tags: ink fill | `UnderlineTabs` for views; `.nb-tag[aria-pressed]` ink fill for filters |
| G39 | Dialogs | Widths `max-w-md/lg/xl/2xl/3xl` chosen per file; footers differ (Cancel outline vs ghost, "Done", "Close" with × icon in `OrgWorkspacesTab.tsx:665`); no paper footer | §10 Dialog 460px, paper footer | Default `DialogContent` width; `DialogFooter`; Cancel = outline |
| G40 | Duplicates | "Seen by" (`OrgUpdateParts.tsx:250-280`) and "Read by" (`OrgDocParts.tsx:339-365`) are the same dialog built twice with different link styles, Remind labels and toasts; three `useSave`/`useRun` hooks; `usePlace` and `useBrowserPlace` | one way to do each thing (org spec §10.2) | `NotYetDialog` (Task 2) |
| G41 | Placeholder as label | Duplicate name and address (`OrgDangerZone.tsx` DuplicateRow), Publish "What changed?" (`OrgDocParts.tsx:326`), decline reasons (`OrgOverviewParts.tsx:117`, `OrgWorkspacesTab.tsx:612`), Remind note (`:538`) | §10 visible label | Visible labels |
| G42 | Hover-only meaning | Verified label only in `title` (`WorkspaceCard.tsx:90`); "Request pending" reason only on a disabled button | §34 nothing essential only on hover | Visible text |

### SH: Header and tab bar (shared with workspaces where marked ◆)

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| SH1 ◆ | `WorkspaceLayout.tsx:329` | Identity image with 10px corners | §05 radius 8px | `rounded-lg`. Size stays 64px: it is sized to match the name and tagline block (earlier decision, `workspace-header.spec.ts`), and the spec's avatar scale is for people |
| SH2 ◆ | `WorkspaceLayout.tsx:390` | Follow shows a spinning `Loader2` | §06A no generic spinner | Busy label, stable width |
| SH3 | `WorkspaceLayout.tsx:383-384,445` | Follow says "Follow workspace" on an organization | copy | "Follow organization" |
| SH4 | `WorkspaceLayout.tsx:451` vs `:364` | Phone menu "Invite a member", desktop "Invite people" | copy | "Invite people" |
| SH5 ◆ | `WorkspaceLayout.tsx:360-409`, `OrgHeaderParts.tsx:58,73-79,182` | Invite, Follow and Share are hand-built buttons at 34px; `+ New`, Join and Request pending are `size="sm"` at 28px in the same row | §10 one height per row | `Button`, one size |
| SH6 ◆ | `WorkspaceLayout.tsx:498-504` | Active tab text is clay; inactive tab icons use `/70` alpha | §05 selected tab: strong text, clay underline | D6 |
| SH7 ◆ | `WorkspaceLayout.tsx:511-525` | Tab counts are a filled clay 10px box; sync badge `amber-500`/`red-500` | §10 Tabs: 12px mono counts | `.nb-tab-count` |
| SH8 | `WorkspaceDashboardClient.tsx:1140` | Verified ✓ typed into the H1 at 0.6em | G16 | `VerifiedMark` |
| SH9 | `OrgHeaderParts.tsx:35-41,143-157`, `OrgOverviewParts.tsx:238`, `OrgWorkspacesTab.tsx:321` | Five looks for lifecycle states: Archived (badge + sentence), Suspended (red 5% box), Scheduled for deletion (red 5% box + underlined Restore), Restricted (grey box), "organization is archived" (grey 40% box). Restore shows no busy state or error | §33 Archived: quiet badge + recovery; Failure: red-soft notice | `Notice` (Task 2), Restore as `Button` with error |
| SH10 | `OrgHeaderParts.tsx:71-76` | "Request pending" is a disabled button | §33 status ≠ disabled control | `.nb-status` "Requested" + Add a note + Cancel request |
| SH11 | `WorkspaceDashboardClient.tsx:1130`, `OrgInviteBanner.tsx` | "You're invited as a member" sentence and two buttons squeezed into the header's action row; Decline errors ignored | §19 actions group; §33 failure | `Notice` above the tabs with Accept / Decline |
| SH12 | `OrgHeaderParts.tsx:97-99` | Invite dialog title starts with an icon; width `max-w-md` | §06 headings without decorative icon; §10 460px | Plain title, default width |
| SH13 | `OrgHeaderParts.tsx:109-118` | Child workspace breadcrumb is one org link with a `Building2` icon, no separator, no current crumb | §10 Breadcrumbs: 13px, mono slash, final crumb strong | `Org / Workspace` |
| SH14 | `OrgHeaderParts.tsx:132-133` | Long sentences in uppercase mono badges ("ARCHIVED WITH CSE-3A", "CSE-3A IS SUSPENDED · READ ONLY") | §10 Badge is a short status | Badge "Archived" / "Suspended" + sentence in `Notice` |
| SH15 | `OrgHeaderParts.tsx:190-193` | Phone compact mark: image without a fallback, `alt` repeats the title next to it | §06 fallback without changing geometry | `WorkspaceAvatar size 20`, `alt=""` |
| SH16 | `WorkspaceDashboardClient.tsx:1125` | "· 5 workspaces" is plain text | org spec §7.1: opens the Workspaces tab | Link |

### OV: Overview

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| OV1 | `OrgOverviewParts.tsx:269-311` | The main column uses rail headings (`RailSection`) for Get started, Today, How the class is doing and This sprint, while Welcome and Catch up use card titles | §19: micro heading in the rail; main cards keep their own header | Main column: cards with `.nb-card-title` headers |
| OV2 | `:148`, `:277`, `:354` | Cards inside cards: the sprint card inside `RailSection`'s card, the Get started tiles inside a card, the invite panel's bordered code box inside the People card | §02 nested content uses a well or separators | Remove inner borders; use `bg-muted` well |
| OV3 | `:313` | Right column does not stick; the workspace Dashboard's does (`DashboardTab.tsx:57`) | §19 sticky rail | Same sticky props |
| OV4 | `:234` | Greeting sized by hand (`text-[20px]`) | §04 Section title | `.nb-section-title` |
| OV5 | `:221` | Loading is three grey bars, not the page's shape | G19 | Greeting line + 3 main cards + rail skeleton |
| OV6 | `:223-226` | Error: centred grey line, underlined "Try again", "could not" | G20 | `ErrorNotice` "Overview couldn't load." Retry |
| OV7 | `:238-240` | Restricted, archived summary and "Your record" are bare lines | §33 | `Notice` (restricted), `.nb-meta` lines |
| OV8 | `:243-251` vs `OrgAboutTab.tsx:59-64` | Two different welcome-note designs; close × is 24px | one Row/Section (org spec §5) | One `WelcomeNote` |
| OV9 | `:53-73`, `OrgUpdateParts.tsx:367` | Pinned row: megaphone icon + round avatar + colour-only unread dot, 30% grey fill, tiny ⋯ and ×; the child's pinned line uses a pin icon instead | G11/G18/G37; §34 colour alone | One `PinnedLine` with `Pin` icon, "New" badge |
| OV10 | `:84-127` | Today actions in four styles in one list: outline Approve button, 12px "Review →" text, filled Confirm, outline Decline; amber palette title; 32px reason input | §10 one action style per list | Row action = `Button size="sm" variant="outline"` |
| OV11 | `:292` vs `:327` | "Nothing needs you today" (no period) vs "Nothing due in the next 7 days." | §04 | Periods on sentences |
| OV12 | `:146,290,328,333,372` | "All sprints →", "See all →", "See all", "Show 3 more", "Show more" | consistency | "See all" link; "Show N more" button |
| OV13 | `:134-136` | Date tile: 9px weekday, 4px corners | G7/G8 | 11px `.nb-micro`, `rounded-sm` |
| OV14 | `:151` | Sprint status as a pill tag "Running/Ended" | G14; D3 | `.nb-status` "Active/Completed" |
| OV15 | `:38,169,172` | "12/40" as a pill tag; due dates in browser locale, sans | G14/G31 | `.nb-meta` "12 of 40"; `formatInZone` |
| OV16 | `:160` | Progress label 11px | §10 ProgressBar 12px mono | `.nb-meta` |
| OV17 | `:299-307`; `OrgMembersTab.tsx:228,230` | Standing bar 8px with 3px corners; numbers not tabular; "Behind" is amber here but red on Members | §10; consistency | 6px pill track; `tabular-nums`; warning colour on both |
| OV18 | `:332` | New-workspace "+" is an 18px target | G37 | `icon-sm` |
| OV19 | `:344,361` | "2 overdue" and "3 requests" as pill tags in amber palette | G14/G10 | Badge (warning) / `.nb-meta` link |
| OV20 | `:356-357` | 24px round avatars, up to 6, no "+N"; `hover:opacity-90` | §10 AvatarStack 26px, max 4, +N | `AvatarStack` |
| OV21 | `:365` | Activity filter: 28px select, 4px corners, 12px | G1 | `NativeSelect size="sm"` |
| OV22 | `:292,327,349,374` | Every empty section is one grey line | org spec §5.4 teaching empty | Short teaching line + one action for admins |

### AB: About

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| AB1 | `OrgAboutTab.tsx:33-34` | No loading or error state: rail sections pop in; a failed read shows nothing | §33 | Rail skeleton; `ErrorNotice` |
| AB2 | `:84` | Rail does not stick | §19 | as OV3 |
| AB3 | `:59-64` | Welcome note differs from Overview's; × and pencil are 24px | OV8/G37 | `WelcomeNote` |
| AB4 | `:66,72-73,97,103,126` | Admin prompts in three looks (underlined text, underlined buttons, clay link) | G6 | One link style |
| AB5 | `:79` vs `OrgOverviewParts.tsx:338` | Workspaces: text + "→" here; avatar + lead + members on Overview | org spec §5.2 one Row | One `WorkspaceRow` |
| AB6 | `:86-107` | Stages: the full journey uses `JourneyTimeline`, one sprint and "ghost" use hand-made dots with faded text | §19 Journey; G12 | `JourneyTimeline` for all three |
| AB7 | `:120-127` | Member card is titled with the org name; join date in browser locale | consistency/G31 | Title "Your membership"; `formatInZone` |
| AB8 | `:137,141` | Leaders: 24px round avatars; 12px underlined "Message" | G18/G6 | 26px square; link style |
| AB9 | `:40-45,156` | Copy as underlined text; web address not mono; time zone shown as "Asia/Kolkata" | G26; §04 IDs mono | `CopyButton`; `.nb-meta`; readable zone name |
| AB10 | `:56` | Former-member line in a 40% grey box | G11 | `Notice` neutral |
| AB11 | `:128-129` | A visitor sees two filled Join buttons (header and rail) | §10 one dominant action | Rail shows the facts; header keeps Join |
| AB12 | `:54,84` | Main `space-y-4`, rail `space-y-6`; Overview main is `space-y-6` | §05 12/24px rhythm | Same spacing on both tabs |
| AB13 | `:118` | Invite panel in the rail has its own heading, not a `RailSection` | consistency | Wrap in `RailSection title="Invite people"` |

### MB: Members

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| MB1 | `OrgMembersTab.tsx:119-120` | Loading is a sentence; error has no Retry | G19/G20 | Row skeletons; `ErrorNotice` |
| MB2 | `:126` | 1240px page with a 320px rail; Overview/About use 8/4 columns and Workspaces 1040px | §08 normal content max 1200, workspace rail 300 | One org page frame for every tab (Task 2) |
| MB3 | `:131-160` | Toolbar: 36px search and selects, 28px Export | G36 | 28px toolbar |
| MB4 | `:133,153` | Filter in generic role words; "Sort: Name" prefix only on one select | G27 | Org role words; visible "Sort" label |
| MB5 | `:206,212` | Browser checkboxes | G2 | `Checkbox` |
| MB6 | `:215` | 32px round avatars | G18 | 34px square |
| MB7 | `:175,219,220,222` | Role, Blocked, Outside as hand-made chips; verified as ✓ | G13/G16 | Badge / `VerifiedMark` |
| MB8 | `:228,230` | "Behind" in red; Overview uses amber | OV17 | Warning colour |
| MB9 | `:226` | "— not in a workspace" | §04 copy | "Not in a workspace" |
| MB10 | `:204-235` | Filters that match nobody show only "0 people" | §33 No matches + Clear filters | `EmptyState` with Clear filters |
| MB11 | `:194-198` | Invite expiry in browser locale; "Expired" said twice (text and badge); "Resend" toasts "Invite extended" | G31/copy | One badge; toast "Invite resent" |
| MB12 | `:178-183` | Outside people: underlined Message next to ghost buttons | G6 | Link style / buttons |
| MB13 | `:238-252,321` | Rail: Requests heading is 13px semibold, invite panel has its own heading, summary has none; summary items are plain text buttons | consistency | Three `RailSection`s; summary as linked `.nb-meta` rows |
| MB14 | `:320-346` | Each request has a filled Approve plus a filled Approve all; heading "Requests · 0" shows when empty; "via code" | §10 one dominant action | Approve outline per row, Approve all filled; hide when empty |
| MB15 | `:282-313` | Bulk bar: 30% grey fill; two red buttons, one labelled "Remove and block from organization"; up to three selects | G11; §10 | Bulk bar on `bg-muted`; Remove menu with two items |
| MB16 | `:389-466` | Drawer: name is a `<p>`, sections are 13px semibold h4 (Review and Hand in use mono micro labels); "Loading…"; states as raw enums ("in progress"); "✓ Verified." | §34 headings; G34; org spec §5.7 | H2 name; `.nb-micro` sections; `ASSIGNMENT_STATE_LABELS`; `VerifiedMark` |
| MB17 | `:446-449` | Title input 36px beside a 28px Save | G36 | Same height |
| MB18 | `:478-509` | Away: 12px labels; dates in `'en'` format; End now has no feedback | G35/G31/G20 | Field labels; `formatInZone`; toast + error |
| MB19 | `:129` | "← Workspaces" with a text arrow | G33 | `ChevronLeft` link |

### IV: Invite, requests and joining

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| IV1 | `OrgInvitePanel.tsx:49-89` | 24px ⋯; prominent box uses a 30% grey fill; code size changes between 17/24px here, 24px in Settings, 48px on the Ready screen; "Make a new code" confirmed by an inline red box | G37/G11/G23 | One `JoinCode` display; `ConfirmDialog` |
| IV2 | `OrgInvitePanel.tsx:94-161` | Email dialog: bare textareas, 36px selects, `max-w-2xl`, "Done" button; email preview iframe forced white | G1/G4/G39 | Primitives; Cancel + Invite N people |
| IV3 | `OrgHeaderParts.tsx:71-76`, `PrivateOrgHeader.tsx`, `JoinOrgButton.tsx` JoinRequestPending | Three designs for "request pending" | consistency | One `RequestPending` (badge, note, Cancel request) |
| IV4 | `OrgInviteBanner.tsx`, `PrivateOrgHeader.tsx`, `OrgRequestsSection.tsx` | Three designs for "you're invited" with different toasts ("You joined" / "You're in X") and Decline behaviour (undo toast, immediate, silent) | consistency | One `InviteRow`; Decline with Undo everywhere |
| IV5 | `OrgInviteBanner.tsx` | "a guest / an admin / a member" | G27 | Org role words |
| IV6 | `join/[code]/page.tsx`, `JoinOrgButton.tsx` | "You've been invited" also shows for a typed code; note textarea has 8px corners and no resize | copy; G4 | "Join {title}"; `Textarea` |
| IV7 | `OrgRequestsSection.tsx:49,68,91` | 6px cards; "(N)" counts; h4 under the page's h2; 12px bold "Review all"; Decline without the reason dialog Members uses | G8/G32/G23 | Invitation-row style from Network (§11 reuse) |
| IV8 | `PrivateOrgHeader.tsx` | Avatar at default size; a 44px Join button only here | §10 | 72px avatar; standard button |

### WS: Workspaces tab

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| WS1 | `OrgWorkspacesTab.tsx:114,128,320` | 1040px wide (Members 1240) | MB2 | Org page frame |
| WS2 | `:52,316-317,361,372-373,487` | 30px and 26px controls | G36 | 28px |
| WS3 | `:334-350` | Status tabs built by hand: semibold label, sans count, no Home/End | G38 | `UnderlineTabs` with mono counts |
| WS4 | `:361,393,412-414` | Three selected looks in one toolbar (clay 10% fill, clay 10% fill + border, grey fill) | G38 | Filter tags ink fill; view toggle one segmented style |
| WS5 | `:381` | Search is a raw `<input>`; Members uses `Input` | consistency | `SearchField` |
| WS6 | `:316` | Filled "New workspace" beside the header's filled `+ New` | org spec §7.1 one filled button | Outline |
| WS7 | `:266-272` | Health counts as three pill tags | G14 | `.nb-meta` "4 open · 1 overdue · 2 in review", overdue in danger text |
| WS8 | `:303-306` | Archived as amber draft; visibility and New as hand-made chips | G15/G13 | Badges with correct tones |
| WS9 | `:254,277` | Attention line in `amber-800`; fix actions underlined bold | G10/G6 | Warning token; link style |
| WS10 | `:428,459` | Archived rows faded to 60% | G12 | Archived badge, normal text |
| WS11 | `:287,293` | "Open seats · Apply" and "Message workspace lead" are actions written in mono metadata | §04 mono is for metadata | UI-label links |
| WS12 | `:324-329,597` | Requests line on 30% grey fill; drawer title "Requests (3)" | G11/G32 | `Notice`; "Requests · 3" |
| WS13 | `:449,460` | List header 12px sans; browser checkboxes | G2/G34 | `.nb-micro` headers; `Checkbox` |
| WS14 | `:115-118,505-520` | Hand-copied empty state; "Try again"; title punctuation mixed | G20/G21 | `EmptyState`, `ErrorNotice` |
| WS15 | `:557` | Archive confirm is red | D7 | Default confirm |
| WS16 | `:643,665` | Ask-to-add: 4px skeleton; footer "Close" with × icon | G8/G39 | `DialogFooter` Cancel |
| WS17 | `:690-695` | Assign-lead list has no avatars; selection is a grey fill | §10 roster rows | 26px avatar rows, radio semantics |
| WS18 | `:538` | Remind note textarea styled locally; label only `aria-label` | G4/G41 | `Textarea` + label |
| WS19 | `:394-408` | Native selects inside a dropdown menu | G1 | Filters as `DropdownMenuRadioGroup`s |

### ST: Settings (organization sections)

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| ST1 | every switch in `OrgSettingsSections.tsx`; vs `WorkspaceSettingsTab.tsx:1873,2021`, `ChildOrgSection.tsx:114` | Org switches wait for a Save button; workspace and child switches save at once, on the same Settings page | §10 Switch = immediate save | D1 |
| ST2 | `OrgSettingsSections.tsx:43-44` | 13px semibold labels, 12px hints | G35 | Shared field classes |
| ST3 | `:318-319,487-488,497,653-657` | Browser radios | G3 | `.nb-radio` |
| ST4 | `:215,554,629,690,697` | Four select class strings | G1 | `NativeSelect` |
| ST5 | `:559,582` | "TASKS" / "SPRINTS" in uppercase sans | G34 | `.nb-micro` |
| ST6 | `:648` | ~~Admin emails card has no section wrapper~~ Checked: it sits inside the Notifications section on purpose; a wrapper would split the index | — | No change |
| ST7 | `:90,210,291,386,481,558,611,649,679` | Card inner gaps alternate 16/20/24px | §05 | 24px |
| ST8 | `:57-73` | "Saved." line next to the button | G25 | Toast |
| ST9 | `:296-306` | Copy gives no feedback; 24px code; "Make a new code" ghost + dialog | G26/IV1 | `CopyButton`, `JoinCode`, `ConfirmDialog` |
| ST10 | `:221,250-251,392` | Labels of type, term and role names are 12px grey wrapped around inputs | G35 | Field labels |
| ST11 | `:253,327` | 12px errors | G35 | 13px |
| ST12 | `:256-259` vs `OrgWizardFields.tsx` time zone | Settings: free-text datalist, no check. Creation: select | consistency | Same select in both |
| ST13 | `:264` | Welcome textarea has a ring focus, unlike `Input` | G4 | `Textarea` |
| ST14 | `:407,482` | Unknown counts show "…" | §33 unknown count: em dash or omit | Omit until loaded |
| ST15 | Settings vs creation | Same setting, different words and control: "Story points" / "Estimate"; "Check finished work" / "Review submissions before they count as done"; "Allowed" / "Accepted"; "Approval:" / "Approval required"; outside people switch / checkbox | §18 reuse field groups | One label map (`lib/organizations/settings-labels`) used by both |
| ST16 | `:528` | `aria-label` says "org sprints"; visible label "organization's sprints" | copy | Match the visible label |
| ST17 | `:147-148,177` | Owner sees "Transfer ownership first." with no link; Leave dialog Cancel is outline, other dialogs use ghost | §33; G39 | Link to Transfer; one footer |
| DZ1 | `OrgDangerZone.tsx` | Five confirmation styles in one card (Transfer swap, Archive swap + list, Duplicate expand, Delete expand + type, Restore) | G23 | Each row: description + button → `ConfirmDialog`; Delete keeps type-to-confirm inside it |
| DZ2 | TransferRow | "Make someone an admin first." before admins load | G22 | Skeleton until loaded |
| DZ3 | DuplicateRow | Name and address have no visible label; date has one | G41 | Labels |
| DZ4 | DuplicateRow, DeleteRow | Browser checkboxes; 36px and 32px selects | G1/G2 | Primitives |
| DZ5 | ArchiveRow | Reversible Archive confirmed in red | D7 | Default |
| DZ6 | `useRun` | Result line instead of toast | G25 | Toast |
| STO1 | `OrgStorageSection.tsx:21-26,61-66` | Six-colour palette, round legend dots, amber ring, 12px bar | G10; §10 ProgressBar 6px | Tokens; categories by pattern or one colour + table |
| STO2 | `:39` | "Empty" only opens the Trash view | §04 verb names the action | "Open Trash" |
| STO3 | `:87-119` | Sizes in sans; type rows underline on hover | §04 sizes mono | `.nb-meta` |
| STO4 | LargeFilesDialog | No empty state | §33 | `EmptyState` |
| MOD1 | `OrgModerationSection.tsx` | "Nobody is blocked." while loading | G22 | Skeleton |
| MOD2 | `OrgReportsSection.tsx` | Card titled "Reports" contains another heading "Reports · N" | §34 heading order | Drop the inner heading |
| MOD3 | `OrgReportsSection.tsx` decide | One plain `toast()` for success and error; Remove has no confirm | G20/G24 | `toast.error`; `ConfirmDialog` for Remove |
| DS1 | `OrgDiscoverySections.tsx:165,368` | Verified marks | G16 | `VerifiedMark` |
| DS2 | `:60,107,158` | Sub-headings are 13px semibold h3 inside a card | G34 | `.nb-card-title` or `.nb-micro` |
| DS3 | `:160` | "Do you need it?" tip in a 50% grey box | G11 | `Notice` neutral |
| DS4 | `:216,284` | "Ask CSE" is filled; the other three ways are outline | §10 hierarchy | All outline |
| DS5 | `:28,54,79,86` | Actions written as clay text next to outline buttons; "↓" glyph | G6/G33 | Link style |
| DS6 | `:353-374` | Part-of suggestions: 5px menu corners, no arrow-key selection, own z-index | §08 menus 8px; §34 listbox keys | `Command`/`Popover` listbox |
| DS7 | `:324-334` | Textareas and file input unstyled; 12px labels | G4/G35 | `Textarea`, field labels |
| DS8 | `:117` | "networkbase.in/org/" prefix is loose text, not an input affix | §10 Input affix | Mono leading affix |

### CR: Creating an organization

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| CR1 | `Phase4Settings.tsx:341,355,415,428,465,495`; `Phase5Review.tsx:165,263,386-389,414,420` | An organization's creator reads "Workspace picture", "Choose workspace visibility", "Workspace links", "Starter doc… The workspace Doc tab", "Workspace files", "Workspace-wide notification rules", "Untitled workspace", "Private workspace", "No workspace links added" | org spec §2 rule 5 | Org copy map for each section and review line |
| CR2 | `Phase4Settings.tsx:299-307` | The org-only Calendar and "Workspaces inside and work" sections have no numbered eyebrow and are not in the sticky section index; the eight standard sections are | §18 numbered sections + index | Add them to `SECTIONS` as 01, 02… |
| CR3 | `Phase4Settings.tsx:294-295` | The title "Setup" repeats the eyebrow (the eyebrow's case is CSS uppercase, so that part was fine) | §04 | Title "Choose how the organization starts", as the workspace's |
| CR4 | `Phase4Settings.tsx:~313` | Validation summary says "Finish the workspace links" for an organization | copy | Follow the org copy map |
| CR5 | `OrgWizardFields.tsx` OrgTypePicker | Type tiles hide the radio; selected tile is clay border + grey fill | §18 checked radio + paper active well | Visible radio, `bg-muted` selected well |
| CR6 | `OrgWizardFields.tsx` handle, type label | Required "*" in text colour | §10 required mark clay | `text-primary` |
| CR7 | `OrgWizardFields.tsx` handle | "✓ available" glyph; prefix loose text | G16/DS8 | `Check` icon; input affix |
| CR8 | time zone select | Differs from Settings | ST12 | Same control |
| CR9 | term, plan sprints, max members | 13px grey labels wrapped around inputs | G35 | Field labels |
| CR10 | co-admins | Chips with 5px corners; search list disabled at 50% opacity | G13/G12 | Person chips (square avatar + name + remove) |
| CR11 | `OrgSettingsFields` | Work defaults as checkboxes and different words from Settings | ST15 | Shared label map |
| CR12 | `OrgSettingsFields` | "Change / Done" underlined toggle | G6 | Disclosure button |
| CR13 | `OrganizationCreatedScreen.tsx` | 24px title (page title is 30px); 48px code; a second `<main>` inside the app's main; copy result as a status line; link hard-codes `networkbase.in` while the join link uses `window.location.origin` | §04; §34 one main; G26 | `.nb-page-title`, `JoinCode`, `<section>`, `CopyButton`, one origin helper |
| CR14 | `Phase5Review.tsx` | Checked: the preview already passes `kind: 'organization'` | — | No change |
| CR15 | `CreateLocation.tsx` | Icon before the select; "—" inside option text; locked chip on `bg-secondary` | §06; copy | Plain select; "(only admins)"; Badge |
| CR16 | `ChildTeamFields.tsx` | Picker tabs as grey pills; 32px selects at 12px; 24px buttons inside pill chips; "Owner" heading for the workspace lead; 11px "Will be added" | G38/G1/G37/G29 | `UnderlineTabs`; primitives; "Workspace lead" |

### CH: Workspaces inside an organization

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| CH1 | `OrgOverviewParts.tsx:397-416` | "What's happening" uses a rail heading in the main column; amber palette; "→" glyphs | OV1/G10/G33 | Card with header; tokens |
| CH2 | `OrgOverviewParts.tsx:423-446` | Team list: 10px initial circles, "★ team lead" text, unstyled `<details>` | G7/G17/G18 | `AvatarStack`, Star icon, disclosure button |
| CH3 | `ChildUnitsPanel.tsx:24,51-115` | No loading or error; its own bordered card instead of `SettingsCard`; 32px inputs; 12px labels; "★" inside select options; pill chips holding a select | G19/G20/G35/G17 | `SettingsCard`; primitives; person rows |
| CH4 | `ChildOrgSection.tsx:111-152,185` | Labels semibold; browser radios; result as a status line | G35/G3/G25 | Shared field classes; toast |
| CH5 | `OrgSprintParts.tsx:63` | "Outside CO1" in `amber-600` | G10 | Warning token |
| CH6 | `OrgDocParts.tsx:133-153` | "FROM CSE-3A" in uppercase sans; each document is a bordered card, unlike the workspace's own document rows | G34; consistency | `.nb-micro`; same row as `WorkspaceDocRail` |
| CH7 | `OrgFilesPanel.tsx:233-300` | Org files list uses plain icon rows, not the file rows with DOC/IMG type chips; chevron breadcrumbs at 12px; 11px bordered "Update" button | §06 file type chips; §10 Breadcrumbs | `FolderListRow` + `FileTypeChip`; shared breadcrumb |
| CH8 | `OrgUpdateParts.tsx:105-131` | Audience chips 32px with dark-border selection; blocked choice faded | G38/G12 | Radio tags with reason text |

### UP: Updates

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| UP1 | `OrgUpdateParts.tsx:63,137,158-164` | Composer uses three control looks (32px chips, a segmented control, 28px tools); the member's "Discussion · Members" looks like a button but does nothing | G38; §10 | One segmented control; plain text for fixed values |
| UP2 | `:173` | "Unpin on" date input unstyled | G1 | `Input type="date" size="sm"` |
| UP3 | `:97,234` | "Members", "Admins" | G27 | Org role words |
| UP4 | `:347-357` | Feed filters are chips with `role="tablist"` but no arrow keys | G38; §34 | `UnderlineTabs` |
| UP5 | `:341` | "All" with nothing says "No announcements yet" | copy | "No posts yet" |
| UP6 | `:250-280` vs `OrgDocParts.tsx:339-365` | "Seen by" (11px, no underline) and "Read by" (underlined) are the same feature styled twice | G40 | `NotYetDialog` |
| UP7 | `UpdatesTab.tsx:402` | Toast "Posted" for an org, "Workspace update posted" for a workspace | copy | "Update posted" |
| UP8 | `:366-367` | Pinned line on 30% grey fill | OV9 | `PinnedLine` |

### DC: Documents

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| DC1 | `OrgDocParts.tsx:90-101,250` | List chips 10px mono, "New" filled black; the reader header shows the same state as a pill tag | G7/G13/G14 | `.nb-status` everywhere |
| DC2 | `:171-201,256` | Options dialog: 12px text, 11px hints, 32px selects, browser checkboxes; "DOC OPTIONS" heading inside a dialog titled "Document options" | G35/G1/G2/G30 | Field primitives; drop the inner heading |
| DC3 | `:184` | "Members only" | D2 | "Organization only" |
| DC4 | `:211,213` | "Edit groups" underlined toggle; "Saved" line | G6/G25 | Button; toast |
| DC5 | `:291-293` | Group arrows and × at ~22px, disabled at 30% | G37 | `icon-sm` buttons |
| DC6 | `:326-328` | Publish: placeholder as label; browser checkboxes | G41/G2 | Label; `Checkbox` |

### FL: Files

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| FL1 | `OrgFileBrowser.tsx:49-123`, `OrgFileViews.tsx:88,147` | Hard-coded hex everywhere in the filter bar and rows | G9 | Tokens |
| FL2 | `OrgFileBrowser.tsx:118-124` | A private `Badge` where "warning" is clay | G13 | `.nb-status` |
| FL3 | `:54-58,67` | 24px mono filter pills with solid clay selection; 24px search | §05 selected filter = ink fill; G36 | `.nb-tag` pressed; 28px `SearchField` |
| FL4 | `:101` | 18px avatars, 9px initials | G18/G7 | 20px square |
| FL5 | `:81,95` | Row focus ring and folder name in hex | G9 | `ring-ring`, `text-foreground` |
| FL6 | `OrgFilesPanel.tsx:122` | Storage warning in `amber-700` | G10 | Warning token |
| FL7 | `OrgFilesPanel.tsx:165-167` | Preview "Loading…"; text preview on 40% grey at 12px | G19/G11 | Skeleton; `bg-muted`, 13px mono |
| FL8 | `OrgFilesPanel.tsx:92-105` | Folder access radios unstyled; 12px hint | G3/G35 | `.nb-radio`; hint class |
| FL9 | `FolderAccessChip.tsx:19-21` | 10px chips | G7/G13 | `.nb-status` |

### SP: Sprints

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| SP1 | `OrgSprintParts.tsx:101-104,143-145` | Teams and Materials boxes have 5px corners and 13px semibold headings | §05 card 8px; G34 | `rounded-lg`, `.nb-card-title` |
| SP2 | `:113` | Raw status words "planned / active / completed" | D3 | Sprint status badge |
| SP3 | `:120` | Remind as 12px clay text | G6 | `Button size="sm" variant="outline"` |
| SP4 | `:82` | Running-sprint prompt on 50% secondary | G11 | `Notice` info |
| SP5 | `:151-162` | Material chips: 5px corners, 24px remove | G13/G37 | Person/file chip pattern |
| SP6 | `:236-250` | Start-now confirm is an inline box; 12px errors | G23/G35 | `ConfirmDialog` with the announcement option |

### TK: Tasks, assignments, review and hand-in

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| TK1 | `AssignmentsPanel.tsx:127,148` vs `HandInSection.tsx:137` | Two hand-in designs: a "Submit {title}" dialog with a vague "Submit" button, and the "Hand in" section | §04 verb + object; consistency | One `HandIn`; button "Hand in" (or the type's word) |
| TK2 | `AssignmentsPanel.tsx:333-496` | Labels wrap inputs; hints in brackets; browser checkboxes and datetime fields | G35/G2 | Field primitives |
| TK3 | `:457,472` | Step "Remove" as 12px underline; 20px material × | G6/G37 | `icon-sm` |
| TK4 | `:759,782` | Delete appears as a ghost button and as a red menu item | G24 | Menu only, red, confirmed |
| TK5 | `:747` | Assignment heading 15px | §04 card title 17px | `.nb-card-title` |
| TK6 | `:395,397,470,587` | Round person chips; 20px select at 10px; "★" | G1/G7/G17 | Primitives |
| TK7 | `AssignmentRoster.tsx:76-78,151,163,186` | Tiles selected by an outline in "currentColor"; 28px round avatars; 28px 4px selects | §05 selected; G18/G1 | Pressed tile = `bg-muted` + clay underline; 26px square |
| TK8 | `ReviewQueue.tsx:25,40,249,258-263,277-278,302,337,369`; `ReviewQueueParts.tsx:200,205-208` | 30px controls; 10px chips; 24px prev/next; a hand-built split Approve button; hand-built popover (z-30); clay 10% "incoming" button; red 10% error box; 6px empty box; 40% grey help | G36/G7/G37/G11/G20 | Primitives; `DropdownMenu` for the split action; `ErrorNotice` |
| TK9 | `HandInSection.tsx:23-26,133,149` | Section has 6px corners; state boxes mix soft tokens with 50% grey; "Submitted" drawn as draft | G8/G11/G15 | `rounded-lg`; `Notice` tones; tone map |
| TK10 | 4 files | `area` textarea class copied | G4 | `Textarea` |
| TK11 | `AssignmentDialogs.tsx:54` | Reason chips 3px corners | G13 | `.nb-tag` buttons |
| TK12 | `TeamTaskDialog.tsx:67` | Lead pick as round chips | G13 | Radio rows |

### OUT: Outside the organization

| ID | Where | What is wrong | Rule | Fix |
|---|---|---|---|---|
| OUT1 | `WorkspaceCard.tsx:77-90` | Org card: the type ("Education") is drawn as a blue status badge; ✓ text; org line marker is a 2px-radius square at 60% black with a trailing "/"; type label capitalised by `charAt` instead of `orgTypeLabel` | G15/G16/G8/G12 | Type as `.nb-meta`; `VerifiedMark`; `WorkspaceAvatar` 20 + name |
| OUT2 | `DiscoverHeader.tsx:212` | Filter tag shows "@cse-3a"; the web-address decision dropped "@" | 2026-11-05 findings G1 | Show the org name |
| OUT3 | `GlobalSearchResultCards.tsx:387,401` | Org result kind in 11px mono sentence case; "Doc" | §04 micro label uppercase; G30 | `.nb-micro`; "Document" |
| OUT4 | `SharedOrgChip.tsx:29` | Hand-made 11px chip on person cards and search | G13 | `.nb-meta` line "Both in CSE-3A" |
| OUT5 | `OrgRequestsSection.tsx` in My work and Network | Cards differ from Network's own invitation rows | §11 reuse invitation rows | IV7 |
| OUT6 | `SidebarWorkspaces.tsx:94,102,211,217` | 20px expand button; unseen dot by colour (name in the link's label is fine); "More (4)"; "Requested" in 11px sans | G37/G32/G13 | `icon-sm`; "More · 4"; `.nb-status` |

**Total: 248 findings** (G 42, SH 16, OV 22, AB 13, MB 19, IV 8, WS 19, ST 17 + DZ 6 + STO 4 + MOD 3 + DS 8, CR 16, CH 8, UP 8, DC 6, FL 9, SP 6, TK 12, OUT 6).

---

## Organization-only features: keep or fix

The design spec has no section for these. Each is measured against the spec's general rules and the closest workspace screen. **Keep** = the design stays and is the agreed pattern. **Fix** = brought onto the standard; the finding IDs say how.

| Feature | Verdict | Measured against | Findings |
|---|---|---|---|
| Org type picker (creation) | Fix | §18 source tiles: visible radio, paper well | CR5 |
| Web address field with live check | Keep the flow; fix prefix and ✓ | §10 Input affix | CR7, DS8 |
| Role names editor (creation, Settings) | Keep | §10 Field | ST10 |
| "Is ready" screen | Keep the content; fix title, code, landmark, copy | §04, §34 | CR13 |
| Join code display | Fix: one `JoinCode` size (24px mono) | §04 mono IDs | IV1, ST9 |
| Invite panel | Keep the content and order; fix controls | §10 | IV1, IV2 |
| Join page | Keep (auth shell, one action) | §17 auth shell | IV6 |
| Request pending / you're invited | Fix: one design each | §33 | IV3, IV4, SH10, SH11 |
| Private-organization page | Keep; fix avatar size and button | §19 identity | IV8 |
| Permissions table | Keep | §10 table, role words | ST18 |
| Verified badge and four ways | Keep the flow; fix mark, headings, tip, button hierarchy | §06, §10 | DS1–DS8 |
| Overview greeting and week line | Keep; use `.nb-section-title` | §04 | OV4 |
| Today list | Keep; one action style | §10 | OV10–OV12 |
| Class standing | Keep the idea; fix to the progress bar and tabular numbers | §10 ProgressBar | OV17 |
| This week date tiles | Keep; fix 9px and 4px | §04, §05 | OV13 |
| Announcement composer options | Keep the options; fix control looks and words | §10 | UP1–UP3 |
| Seen by / Read by | Fix: one dialog | org spec §10.2 | G40, UP6 |
| Pinned announcement | Fix: one `PinnedLine` | §06 | OV9, UP8 |
| Document groups, publish, required reading | Keep the flow; fix the options dialog | §10 Field | DC1–DC6 |
| Assignment form | Keep the fields; fix field styling | §10 Field | TK2, TK3 |
| Roster tiles | Keep; fix selected state and avatars | §05 selected | TK7 |
| Review queue (three columns) | Keep the layout; fix parts | §10 | TK8 |
| Hand in box | Keep the coloured state box; fix corners and tones | §33 | TK1, TK9 |
| Class questions | Keep | §10 | — |
| Org sprint Teams and Materials | Keep; fix card corners, status words | §05, D3 | SP1–SP6 |
| Teams and seats (child) | Keep the model; fix panel and controls | §10 | CH2, CH3 |
| Inherited rules (locked rows) | Keep | §33 read-only | — |
| Members drawer, Away, verify | Keep the content; fix headings and states | §34, §33 | MB16–MB18 |
| Storage breakdown | Keep the content; fix palette and bar | §10 ProgressBar | STO1–STO4 |
| Moderation, reports, blocked people | Keep; fix loading and confirm | §33 | MOD1–MOD3 |
| Danger zone | Keep the content; one confirmation style | §10 Dialog | DZ1–DZ6 |
| Ownership take-over | Keep | §33 | — |
| Lifecycle banners | Fix: one `Notice` | §33 | SH9, SH14 |

## File structure

The shared field parts are CSS classes in `globals.css` (they style the native elements every file already uses, so no handler changes): `.nb-select` (+ `[data-size="sm"]`), `.nb-textarea`, `.nb-check`, `.nb-radio`, `.nb-link`, and `.nb-status[data-tone]`.

New (each one small, used by the tasks below):

- `src/components/ui/notice.tsx`: `Notice` (`tone: neutral | info | warning | danger`, icon, text, one action).
- `src/components/ui/copy-button.tsx`: `CopyButton` (label turns "Copied" for 2s, toast on failure).
- `src/components/organizations/org-ui.tsx`: `VerifiedMark`, `JoinCode`, `WelcomeNote`, `PinnedLine`, `WorkspaceRow`, `RequestPending`, `InviteRow`, `NotYetDialog`, `orgStatusTone()`, and `fieldLabel` / `fieldHint` / `fieldError` class strings.
- `src/lib/organizations/settings-labels.ts`: one label map for settings that appear in both creation and Settings (ST15).
- `tests/unit/org-design-contract.test.ts`: the contract test.

Changed: `src/app/globals.css` (status tones, `.nb-radio`, `.nb-tab-count`), every file named in the register.

## Tasks

### Task 1: The contract test

**Files:** Create `tests/unit/org-design-contract.test.ts`.

**Interfaces:** Produces `BANNED: Array<{ name: string; pattern: RegExp; allow?: string[] }>` and a scan of `src/components/organizations/**/*.tsx` plus the org lines of `WorkspaceCard.tsx`, `SidebarWorkspaces.tsx`, `DiscoverHeader.tsx`, `OrganizationCreatedScreen.tsx`.

- [ ] **Step 1: Write the test.** One `t.test` per pattern; the failure message lists `file:line` for every hit. Patterns:
  - hex colour `/#[0-9A-Fa-f]{6}\b/` in a `className`
  - palette `/\b(text|bg|border|ring)-(red|amber|sky|emerald|violet|rose|slate|green|blue|yellow|orange|gray)-\d{3}\b/`
  - off-scale text `/text-\[(9|10|14|16|18)px\]/`
  - off-scale radius `/rounded(-\[(2|4|6)px\])?(?=[\s"'`])/` (bare `rounded` and 2/4/6px)
  - alpha surfaces `/\b(bg-(muted|secondary|primary|destructive)|border-(primary|destructive))\/\d+/`
  - faded content `/\bopacity-(40|60)\b/` (except inside `disabled:`)
  - native controls `/<select\b/`, `/type="checkbox"/`, `/type="radio"/` outside `native-select.tsx`
  - spinners `/Loader2|animate-spin/`
  - glyphs used as icons `/[✓★→←↓]/` in JSX text
  - text loading `/Loading…</`
  - browser dates `/toLocaleDateString\(/`
  - wrong status `/data-status="draft">(Archived|Private)/`
- [ ] **Step 2: Run it; it fails** with roughly the counts in this register. `npx tsx --test tests/unit/org-design-contract.test.ts`
- [ ] **Step 3: Commit** `test(org): design contract that lists every off-spec pattern`. The test stays red until Task 16; each task's own check runs it filtered to that task's files (`ORG_CONTRACT_FILES=OrgOverviewParts.tsx npx tsx --test …`).

### Task 2: Shared parts (fixes G1–G4, G13, G15–G16, G19–G21, G25–G26, G35, G40 at the root)

**Files:** the new files above; `src/app/globals.css`.

**Interfaces:**
- `NativeSelect(props: ComponentProps<'select'> & { size?: 'sm' | 'default' })`
- `Textarea(props: ComponentProps<'textarea'> & { size?: 'default' | 'lg' })`
- `Notice({ tone, children, action }: { tone: 'neutral' | 'info' | 'warning' | 'danger'; children: ReactNode; action?: ReactNode })` with `role="status"` (danger: `role="alert"`)
- `CopyButton({ text, label, size }: { text: string; label: string; size?: 'sm' | 'default' })`
- `orgStatusTone(kind: 'archived' | 'private' | 'suspended' | 'draft' | 'published' | 'submitted' | 'returned' | 'approved' | 'missing' | 'excused' | 'upcoming' | 'active' | 'completed' | 'cancelled' | 'requested' | 'expired'): 'neutral' | 'info' | 'warning' | 'success' | 'danger'`
- CSS: `.nb-status[data-tone="neutral|info|warning|success|danger"]` (keep the old `data-status` names working), `.nb-radio`, `.nb-tab-count`.
- `NotYetDialog({ title, description, load, remind, noun })` replacing SeenCount and ReadByLine.

- [ ] **Step 1: Failing tests** in `tests/unit/org-mockup-parity.test.ts` (existing file): `orgStatusTone('archived') === 'neutral'`, `('submitted') === 'warning'`, `('private') === 'neutral'`, `('returned') === 'danger'`, `('active') === 'info'`. A browser fixture `tests/browser/org-primitives.fixture.tsx` renders each primitive; the spec checks: select height 34px (28 for `sm`), radius 5px; textarea radius 5px; `Notice tone="danger"` has `role="alert"`; `CopyButton` reads "Copied" after a click.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** with existing tokens only.
- [ ] **Step 4: Run; they pass.** Add `org-primitives` to the browser `testMatch`.
- [ ] **Step 5: Commit** `feat(ui): native select, textarea, notice, copy button and org status tones`.

### Task 3: Header and tab bar (SH1–SH16)

**Files:** `WorkspaceLayout.tsx`, `WorkspaceDashboardClient.tsx` (1119–1140), `OrgHeaderParts.tsx`, `OrgInviteBanner.tsx`.

- [ ] **Step 1: Failing browser test** in `tests/browser/org-tabs.spec.ts`: header image 72×72 with 8px radius; every header action 34px high; active tab label colour equals `--foreground` with a 2px clay underline (D6); tab count is mono 12px; no element with `animate-spin`; visitor with a pending request sees a "Requested" badge, not a disabled button; child header shows "CSE-3A / Team Falcon" with the last crumb strong; archived org shows one `Notice`.
- [ ] **Step 2: Run; it fails.**
- [ ] **Step 3: Implement** the SH fixes; Follow/Invite/Share become `Button`; the invite banner moves under the identity block as a `Notice`.
- [ ] **Step 4: Run; it passes.** Also open a plain workspace (◆ rows) at 1280 and 390px.
- [ ] **Step 5: Commit** `fix(org): header and tabs follow the spec`.

### Task 4: Overview (OV1–OV22, CH1–CH2)

**Files:** `OrgOverviewParts.tsx`, `org-ui.tsx` (`WelcomeNote`, `PinnedLine`, `WorkspaceRow`).

- [ ] **Step 1: Failing browser test** (`org-tabs`): main column cards have `.nb-card-title` headings and no card inside a card (no bordered descendant of a bordered section); rail is `position: sticky`; loading shows the page-shaped skeleton; a failed read shows "Overview couldn't load." with Retry; sprint status is a badge "Active"; "12 of 40" is `.nb-meta`; avatar stack shows at most 4 + "+N"; every icon button is ≥28px (44px under `pointer: coarse`).
- [ ] **Step 2–4:** fail, implement, pass. Run the contract test filtered to the file; it passes for it.
- [ ] **Step 5: Commit** `fix(org): Overview follows the spec`.

### Task 5: About (AB1–AB13)

**Files:** `OrgAboutTab.tsx`.

- [ ] **Step 1: Failing browser test:** About shows a rail skeleton while loading and `ErrorNotice` on failure; Workspaces rows match Overview's (`WorkspaceRow`); one welcome-note design on both tabs; a visitor sees exactly one filled button; stages use the journey timeline in all three cases.
- [ ] **Steps 2–5** as above. Commit `fix(org): About follows the spec`.

### Task 6: Members, invite and joining (MB1–MB19, IV1–IV8)

**Files:** `OrgMembersTab.tsx`, `OrgMemberDialogs.tsx`, `OrgInvitePanel.tsx`, `OrgRequestsSection.tsx`, `PrivateOrgHeader.tsx`, `JoinOrgButton.tsx`, `OrgInviteBanner.tsx`, `src/app/(site)/(auth)/join/[code]/page.tsx`, `org-ui.tsx` (`JoinCode`, `RequestPending`, `InviteRow`).

- [ ] **Step 1: Failing tests.** Unit: the role filter options read the org's names (`{member:'Student'}` → "Students"). Browser: toolbar controls all 28px; checkboxes are the `Checkbox` primitive; filters that match nobody show "No members match" with Clear filters; drawer name is an H2 and work states read "In progress"; rail has three `RailSection` headings; the three request-pending places render the same `RequestPending`; Decline on an invite shows an Undo toast in all three places.
- [ ] **Steps 2–5.** Commit `fix(org): Members, invites and joining follow the spec`.

### Task 7: Settings (ST1–ST17, DZ1–DZ6, STO1–STO4, MOD1–MOD3, DS1–DS8)

**Files:** `OrgSettingsSections.tsx`, `OrgDangerZone.tsx`, `OrgStorageSection.tsx`, `OrgModerationSection.tsx`, `OrgReportsSection.tsx`, `OrgDiscoverySections.tsx`, `src/lib/organizations/settings-labels.ts`.

**Interfaces:** `ORG_SETTING_LABELS: Record<'reviewRequired' | 'lateRule' | 'reminders' | 'storyPoints' | 'joinMode' | 'outsidePeople' | 'childCreation', { label: string; options?: Record<string, string> }>`, used by Task 8 too.

- [ ] **Step 1: Failing tests.** Unit: `ORG_SETTING_LABELS.storyPoints.label === 'Story points'` and the creation wizard imports it (source check). DB (`tests/db/organizations-settings.test.ts` or the nearest existing file): flipping a switch calls the action at once; a refused save restores the old value and shows the error (Review Focus 4). Browser: no Save button in sections that only hold switches (D1); radios are `.nb-radio`; Admin emails is reachable from the section index; the danger zone opens a `ConfirmDialog` for each action and Archive's confirm is not red; Moderation shows a skeleton, not "Nobody is blocked.", while loading.
- [ ] **Steps 2–5.** Commit `fix(org): Settings follows the spec`.

### Task 8: Creating an organization (CR1–CR16)

**Files:** `Phase1SourceSelection.tsx` (org branch), `Phase2Information.tsx`, `Phase3TeamRoles.tsx`, `Phase4Settings.tsx`, `Phase5Review.tsx`, `OrgWizardFields.tsx`, `OrganizationCreatedScreen.tsx`, `CreateLocation.tsx`, `ChildTeamFields.tsx`, `src/lib/organizations/creation.ts` (copy map).

- [ ] **Step 1: Failing tests.** Unit (`tests/unit/create-workspace-phase4-redesign.test.ts`): with `organization` set, no section title or description contains "workspace" (except "Workspaces inside"); Calendar and "Workspaces inside and work" are in the numbered index. Browser (`org-create.spec.ts`): type tiles show a checked radio; Review shows the organization card; the Ready screen has one `main`, a 30px title and a `CopyButton`.
- [ ] **Steps 2–5.** Commit `fix(org): creation speaks about the organization and follows the spec`.

### Task 9: Workspaces tab (WS1–WS19)

**Files:** `OrgWorkspacesTab.tsx`.

- [ ] **Step 1: Failing browser test:** status tabs are `UnderlineTabs` with Home/End; toolbar controls 28px; "New workspace" is outline; archived rows have full-opacity text and a neutral "Archived" badge; health is one `.nb-meta` line; empty and error use the shared components.
- [ ] **Steps 2–5.** Commit `fix(org): Workspaces tab follows the spec`.

### Task 10: Updates (UP1–UP8, CH8)

**Files:** `OrgUpdateParts.tsx`, `UpdatesTab.tsx`.

- [ ] **Step 1: Failing tests.** Unit: audience menu labels use the org names (`{admin:'TA'}` → "TAs"). Browser: feed filters respond to arrow keys; "Seen by" opens `NotYetDialog`; empty "All" reads "No posts yet".
- [ ] **Steps 2–5.** Commit `fix(org): Updates follows the spec`.

### Task 11: Documents (DC1–DC6, CH6)

**Files:** `OrgDocParts.tsx`, `WorkspaceDocRail.tsx` (From org rows).

- [ ] **Step 1: Failing browser test:** list and header show the same `.nb-status` for a draft; Options dialog has 13px labels, 34px selects and `Checkbox`; "Read by" opens `NotYetDialog`; From-org rows match the workspace's own rows.
- [ ] **Steps 2–5.** Commit `fix(org): Documents follows the spec`.

### Task 12: Files (FL1–FL9, CH7)

**Files:** `OrgFileBrowser.tsx`, `OrgFileViews.tsx`, `OrgFilesPanel.tsx`, `FolderAccessChip.tsx`.

- [ ] **Step 1: Failing browser test** (`org-files.spec.ts`): no computed colour outside the token set on the filter bar in light and dark (Review Focus 1); selected filter has the ink fill; From-org files use the type chips.
- [ ] **Steps 2–5.** Commit `fix(org): Files follows the spec`.

### Task 13: Sprints (SP1–SP6, CH5)

**Files:** `OrgSprintParts.tsx`.

- [ ] **Step 1: Failing test:** unit `sprintStatusLabel('planning') === 'Upcoming'`, `('active') === 'Active'` (D3); browser: Teams and Materials boxes have 8px corners; Start now opens a `ConfirmDialog`.
- [ ] **Steps 2–5.** Commit `fix(org): Sprints follows the spec`.

### Task 14: Tasks, assignments, review and hand-in (TK1–TK12)

**Files:** `AssignmentsPanel.tsx`, `AssignmentRoster.tsx`, `AssignmentDialogs.tsx`, `HandInSection.tsx`, `ReviewQueue.tsx`, `ReviewQueueParts.tsx`, `ClassQuestions.tsx`, `TeamTaskDialog.tsx`.

- [ ] **Step 1: Failing tests.** Browser (`review-queue.spec.ts`, `org-board.spec.ts`): one hand-in component on both paths with a "Hand in" button; Review queue controls 28px; Approve's extra choices open from a `DropdownMenu`; "Submitted" badge has the warning tone.
- [ ] **Steps 2–5.** Commit `fix(org): assignments and review follow the spec`.

### Task 15: Outside surfaces (OUT1–OUT6)

**Files:** `WorkspaceCard.tsx`, `DiscoverHeader.tsx`, `GlobalSearchResultCards.tsx`, `SharedOrgChip.tsx`, `SidebarWorkspaces.tsx`.

- [ ] **Step 1: Failing browser test** (`org-discovery.spec.ts`, `org-sidebar.spec.ts`): the org card's type is not a `.nb-status`; the Discover org filter tag shows the name without "@"; the sidebar expand button is ≥28px.
- [ ] **Steps 2–5.** Commit `fix(org): cards, search and sidebar follow the spec`.

### Task 16: Gate

- [ ] The contract test passes with zero hits.
- [ ] Typecheck (`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit -p .`), lint the changed files, `npm run -s test:unit`, the chromium browser suite, and the four repository checks (terminology, authz contract, RLS contract, migration journal).
- [ ] Screenshots of every tab for owner, member and visitor at 1280px and 390px, light and dark, compared side by side with the spec specimens (§38 checklist).
- [ ] Commit locally. Push only on your word.

## What this plan does not change

- No behaviour, permission, data or route changes; only how things look and read.
- Link colour (D5) and active-tab colour (D6) are app-wide; if you choose the other option, those rows become a separate change.
- I did not run the app for this audit. Some findings (CR14, the dark-mode look of FL1) need the browser check in their task to confirm.
