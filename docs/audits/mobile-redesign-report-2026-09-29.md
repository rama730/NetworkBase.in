# Mobile redesign report — v3 (final), 2026-09-29

> **v3 final audit:** §13 is a deep, measured audit and redesign of the **project detail page** (header, all tabs, the main Overview card) and the **profile page** (header and every card). It adds findings F39–F66, and §11 now includes the resulting phase changes.

**Scope.** Every page, tab, drawer and overlay below **768px**. Desktop (≥768px) is frozen.

**Source of truth.** `docs/design/networkbase-application-design-specification.html`: §04 type, §05 geometry, §08 shell, §09 responsive/touch, and the mobile clauses in §13–§31. The current navigation rules also come from code: `AppSidebar.tsx`, `nav-items.ts`, `WorkspaceIndicator.tsx`, `tests/unit/application-sidebar-contract.test.ts`, and `tests/unit/topnav-contract.test.ts`.

**What changed from v1**
- Every signed-in page was verified live at 375×812 (coarse pointer) and at 320×640.
- Added §5, the quick-navigation conformance audit, and §6, a coverage matrix listing every page and tab.
- Added 13 new findings (F26–F38). Three of them are P0 layout breaks that only show up live.
- Added §8, the full mobile design system: type, tokens, and every screen.

---

## 1. Verdict

Mobile is in poor shape for four reasons, in order of damage:

1. **The project workspace is visually broken on every modern phone (336–767px).**
   - The identity column collapses to 40px, so the description wraps one word per line.
   - The header eats 530px, which is 65% of the screen.
   - All seven project tabs overlap each other, so the labels are unreadable.
   - Both breaks come from one Tailwind class each (F26, F27).
2. **Quick navigation breaks the current rules.**
   - Four of the seven required destinations are missing (Settings, New project, My profile, and the Workspaces list).
   - "My work" is renamed "Workspace" and styled as an alarm.
   - The item order differs from the sidebar, and the menu opens from the wrong side (§5).
3. **Dead ends and touch-hostile interactions.**
   - A Messages thread has no Back button.
   - Message and subtask actions only appear on hover.
   - Swiping the Kanban board grabs cards.
   - The chat button sits on top of the New task button.
4. **The 44px touch token never applies.** A density selector has higher specificity, so every control is 34px on phones (F16b). This is a one-line fix.

Typography families conform: Instrument Sans and JetBrains Mono on every route probed. Type sizes do not: there is 10px text, 14px text, and off-scale doc headings (F33).

---

## 2. Method and evidence

| Evidence | How |
|---|---|
| Live, signed-in | In-app browser, 375×812 `isMobile`/coarse pointer, plus 320×640. A script probe on each route counted horizontal overflow, interactive elements under 44px, computed font families, font sizes off the §04 scale, and fixed layers. Screenshots cover the project header, tasks, files, sprints, docs, settings, messages, network, profile, account settings, the wizard, the workspace drawer, the quick-nav menu, legal, and 404. |
| Code | File and line cited for every finding. |
| Not reachable live | `/admin/notifications` returns 404 for a non-admin. `/onboarding` redirects to Discover once onboarding is complete. Auth pages redirect when signed in. The v1 public-page measurements are still used for those. |

**Data note.** During the sweep, one scripted click hit the swipe-revealed *Archive* button on the "Rama" conversation. I unarchived it right away from the conversation menu and confirmed the inbox shows Rama and Lakshmi CH again. No other data changed.

---

## 3. Spec rules governing mobile

| # | Rule | Spec |
|---|---|---|
| R1 | 56px mobile topbar containing **menu, compact wordmark, search, and the essential notification action**. | §09 |
| R2 | Global navigation is a drawer `min(320px, 100vw−32px)` with the desktop destinations: **Discover, Network, Messages, My profile** → **Workspaces list** → **My work** (opens the drawer) → **Settings at the bottom**. | §08, §09 |
| R3 | 16px page gutters, 16px card insets, single-column cards. | §05, §09 |
| R4 | 44px minimum tap target. Controls may look 42px inside a 44px target. Nothing depends on hover. | §05, §09, §10 |
| R5 | Rails are reached through labeled context buttons. | §09 |
| R6 | Task detail, messages and file preview are full-screen. The sticky bottom bar or composer respects the safe area. | §09 |
| R7 | Messages alternate list and thread with an explicit **Back**, restoring selection and scroll. | §27 |
| R8 | ≤400px: tabs scroll horizontally with the active tab visible. Metadata moves below the title. **Primary action stays visible.** The project footer becomes two rows. | §09 |
| R9 | Tool tabs compact the project context. Name, active tab and back path stay visible. | §08 |
| R10 | One scroller per view. Page and pane never both scroll. | §08 |
| R11 | Sprint rail becomes a select or drawer. The settings section selector is labeled. The setting control moves below its label. | §21, §29, §30 |
| R12 | Toasts sit at a bottom inset. Bottom controls reserve their height plus the safe area. The keyboard never hides the composer. | §09, §31 |
| R13 | Marketing headings are 32–40px on mobile, with 40–48px section spacing. | §13 |
| R14 | Active nav row is a paper well (`--sidebar-accent`) with a clay icon. Radii: badge 3, control 5, card 8, panel 12. | §05, §08 |
| R15 | **Type scale:** 11, 12, 13, 15, 17, 20, 24, 30, 38, 48, 60px. Micro labels are JetBrains Mono 11px uppercase. Code is JetBrains Mono 13px, **14px on touch**. | §04 |
| R16 | **Families:** Instrument Sans for UI and body; Instrument Serif for editorial only; JetBrains Mono for labels, metadata and code. | §04 |
| R17 | **Colour:** clay, ink, paper and status tokens only. No raw zinc, rose, blue or amber palettes in product chrome. | §03 |
| R18 | Drawer and wizard progress: onboarding and creation on mobile use a compact **labeled progress bar**, not a sidebar or stepper. | §14, §18 |

---

## 4. Desktop freeze contract

- Every change is gated by one of: `max-md:`, `md:hidden`, `hidden md:flex`, `@media (max-width:767px)`, `(pointer:coarse)`, or `(hover:none)`.
- JS gates reuse the existing `matchMedia("(max-width: 767px)")` pattern (`FilesTabSidebar.tsx:170`).
- Check: Playwright screenshots at 1280×800 of `/discover`, `/messages`, `/projects/<slug>` (all seven tabs) and `/settings`, compared before and after each phase. The diff must be zero pixels.

---

## 5. Quick navigation: conformance to current rules

### 5.1 The rule

The desktop sidebar (`AppSidebar.tsx`) is the **current rule**. It is pinned by `application-sidebar-contract.test.ts` and matches spec §08:

| Order | Item | Behaviour | Badge |
|---|---|---|---|
| 1 | Discover | route | none |
| 2 | Network | route | `people.totalPending` in `.nb-nav-count` |
| 3 | Messages | route | unread count in `.nb-nav-count`, or a clay dot |
| 4 | My profile | route | none |
| 5 | My work | opens WorkspaceDrawer (`WorkspaceIndicator`) | tasks + requests + pending connections, `.nb-nav-count` |
| 6 | Workspaces list | project titles, **no icons** (contract line 59–67), up to 12 | none |
| 7 | Settings | footer | none |

Row style: `.nb-nav-link`, 44px under coarse pointer. Active state is `--sidebar-accent` with a clay icon.

### 5.2 Current mobile quick nav, measured live

`MobileMenu.tsx`, opened at 375px:

| Check | Rule | Live | Result |
|---|---|---|---|
| Side / width | drawer ≤320px (spec doesn't fix a side; sidebar origin is left) | right side, 320px | ⚠️ |
| Items | 7 items above | Search current section, **Workspace**, Discover, Network, Messages, **Notifications**, Sign out | ❌ |
| Missing | none | **My profile, Workspaces list, Settings, New project** | ❌ P0 (F1–F3) |
| Order | Discover first | "Workspace" is above Discover | ❌ |
| Label | "My work" | "Workspace" in the menu, "Workspace" as the drawer title, "My work" in the sidebar | ❌ (F31) |
| Network badge | pending count | none (icon tint only, for connection health) | ❌ |
| Badge style | `.nb-nav-count` (mono 11px, secondary) | `bg-rose-500` pills, rose label text | ❌ R17 |
| Active row | paper well + clay icon | `bg-primary/10` clay tint with clay text | ❌ R14 |
| Radius | control 5px | 8px (`rounded-lg`) | ❌ R14 |
| Targets | 44px | Close 36px, Sign out 34px | ❌ R4 |
| Duplicates | none | Notifications row duplicates the topbar bell; Sign out is also in the avatar menu | ❌ |
| Data | one source | Menu count comes from TopNav's `getWorkspaceSummaryAction`. Sidebar count comes from `readShellPart("workspaceSummary")`. Both use **the same query key** with different fetchers (F36). | ❌ |
| Topbar | menu, wordmark, search, bell | wordmark, bell, **theme 34×34**, divider, **avatar**, menu on the right; **no search** | ❌ (F5) |

### 5.3 Target quick nav

This follows the current rules exactly by *rendering the sidebar's own nav body* inside the drawer. There is one source, so it can't drift again.

```
Topbar 56px (<768)                       Drawer, left, min(320px, 100vw-32px)
┌─────────────────────────────────────┐  ┌──────────────────────────────┐
│ ☰  ■ NetworkBase          🔍   🔔•  │  │ [av] Full Name           ✕  │ → My profile
└─────────────────────────────────────┘  │      @username (mono 11)     │
 44px targets, 16px gutters               │ [ + New project ]  primary   │ 44px
 ☰ gets a status dot when realtime is    │ ──────────────────────────── │
 unhealthy                                │ ◎ Discover                   │ ┐
                                          │ 👥 Network               3   │ │ sidebar nav body,
                                          │ 💬 Messages             12   │ │ same component,
                                          │ 👤 My profile                │ │ same order, counts,
                                          │ ☑ My work               5  › │ │ and styles
                                          │ WORKSPACES ───────────────── │ │ mono micro label
                                          │   DeepScope AI               │ │ titles, no icons
                                          │   Network for builders       │ │
                                          │   Ponytail                   │ ┘
                                          │ ──────────────────────────── │ pinned footer
                                          │ ⚙ Settings                   │
                                          │ ◐ Theme  System ▾            │
                                          │ ⎋ Sign out                   │
                                          └──────────────────────────────┘
```

- **Removed from the drawer:** the Search row (search is in the topbar) and the Notifications row (the bell is in the topbar).
- **Removed from the mobile topbar:** ThemeToggle, avatar dropdown, divider, New project, and ConnectionStatusIndicator. Connection state moves to a dot on ☰ and a row in the drawer.
- **Behaviour:**
  - Tapping any route closes the drawer.
  - "My work" closes the drawer and opens the WorkspaceDrawer.
  - Focus returns to ☰.
  - The drawer uses Radix Dialog, so focus is trapped and Esc/scrim closes it.
- **Label:** "My work" everywhere, including the WorkspaceDrawer title (currently "Workspace").
- **Tests:** update `topnav-contract.test.ts:214–221`. Add one assertion that MobileMenu renders the shared nav component, so the drawer and sidebar can't diverge again.

---

## 6. Coverage matrix: every page and every tab

Legend: **L** = verified live at 375px; **C** = verified from code; ✅ = passes; ⚠️ = issues; ❌ = broken.
The "<44" column counts interactive elements under 44px within the first two screens, measured live. It includes the shell's five topbar items.

### 6.1 Global shell

| Surface | Ev. | State | <44 | Findings |
|---|---|---|---|---|
| Topbar | L | ❌ | 4 of 5 | F5, F16b, F35 |
| Quick-nav drawer (MobileMenu) | L | ❌ | 2 | F1–F3, F6, F31, F36 |
| Chat launcher FAB and popup | L | ❌ | n/a | F7 (covers the New task button) |
| Workspace drawer: Tasks, Invitations tabs | L | ⚠️ | n/a | F22, F31 (does not close on route change) |
| Command palette (search) | C | ✅ | n/a | Already full-screen |
| Notifications tray | C | ⚠️ | n/a | F23 |
| Toasts | L | ✅ | n/a | Bottom placement seen live; R12 offset in §8 |
| Skip link | L | ✅ | n/a | Appears only on focus |

### 6.2 Main routes

| Route / tab | Ev. | State | <44 | Findings |
|---|---|---|---|---|
| `/discover`: views All, Trending, For you, Following | L | ⚠️ | 12 | F16 (People rail unreachable), F16b |
| `/network` Suggested | L | ⚠️ | 17 | F32 (tabs 28px), F33 (14px text ×7) |
| `/network` Invitations | L | ⚠️ | 21 | F32 |
| `/network` Connections | L | ⚠️ | 12 | F32 |
| `/messages`: Chats, Applications, Project groups; Archived | L | ❌ | 9 | F4, F8, F9, F24, F32 ("Chats" 22px, "Archived" 24px), F34 (blue/amber swipe actions) |
| `/messages` thread | L | ❌ | n/a | F4 (no Back, confirmed), F8 (message actions 24×24), conversation actions 32×32 |
| `/my-profile` Overview, Portfolio | L | ✅ | 18 | F32 (connection/project links 16px tall) |
| `/u/[username]` | C | ✅ | n/a | Same shell as my-profile |
| `/settings`: Account, Security, Privacy, Notifications, Appearance, Integrations, Privacy & policies | L | ✅ | 9 | F16b (Sign out and Clear cache 34px) |
| `/workspace` | L | ✅ | n/a | Redirects and opens My work (by design) |
| `/projects/new` wizard, phases 1–5 | L | ❌ | n/a | F28 (title and stepper overlap), F2 (no entry) |
| `/onboarding`, 4 steps | C | ✅ | n/a | `MobileProgressBar` plus bottom actions (R18) |
| `/legal/accept` | C | ✅ | n/a | Single column |
| `/admin/notifications` | L | n/a | n/a | 404 for non-admin (correct) |
| 404 / global-not-found | L | ✅ | n/a | none |

### 6.3 Project workspace `/projects/[slug]`

| Tab / sub-view | Ev. | State | <44 | Findings |
|---|---|---|---|---|
| Header: identity, stats, Invite, Follow, Share | L | ❌ | n/a | **F26** (40px identity column, 530px header), F13, "Add avatar" 34×18 |
| Tab bar: 7 tabs | L | ❌ | n/a | **F27** (labels overlap; tabs shrink instead of scrolling) |
| Dashboard | L | ✅ | 6 | Cards stack |
| Docs: doc switcher, reader, command blocks | L | ⚠️ | 10 | F20, F33 (headings 26/22/18px, code in `ui-monospace` at 13px) |
| Updates: feed, composer | L | ⚠️ | 7 | "Expand composer" 28×28 |
| Sprints: rail, timeline, lifecycle modals | L | ⚠️ | 6 | F15 |
| Tasks: toolbar, board | L | ❌ | 21 | F10, F11 (confirmed: two unlabeled "+", "Connect Desktop IDE"), F12, F33 (10px ×4), F7 |
| Task detail: Details, Subtasks, Comments, Files | C | ⚠️ | n/a | F22, F37 (hover-only subtask actions) |
| Create task modal | C | ✅ | n/a | `sm:max-w`, stacks |
| Files: Project files, Task files, Deliverables, GitHub Sync, Recent, Starred, Trash; tree drawer | L | ⚠️ | 32 | **F29** (toolbar clipped at right), F14 |
| File view: preview, versions, compare, inspector, linked tasks | C | ⚠️ | n/a | Compare needs unified mode (§24); inspector as a sheet |
| Settings: 12 sections (General → Danger Zone) | L | ⚠️ | 21 | F21, F33 (10px ×5, 16px ×1), F17 |

### 6.4 Public and auth

| Route | Ev. | State | Findings |
|---|---|---|---|
| `/` landing | L (v1) | ⚠️ | F19 (h1 48px), 19 targets under 44px |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/authorize` | L (login) / C | ⚠️ | F18 (cookie banner covers 45%) |
| 11 legal routes (`/privacy`, `/terms`, …) | L | ✅ | Single column, h1 30px |

**Coverage:** 30 routes, 7 project tabs, 12 project-settings sections, 7 account-settings sections, 3 network tabs, 3 message tabs plus Archived, 2 profile tabs, 7 file collections, 4 task-detail tabs, 2 workspace tabs, 4 onboarding steps, and 5 wizard phases. None are unlisted.

---

## 7. Findings

IDs from v1 are kept. New items are marked **(new)**.

### P0: breaks a core task or renders unusably

**F1–F3. Settings, New project, Workspaces list and My profile have no mobile entry.**
- `MobileMenu.tsx:94` renders only `MAIN_NAV_ITEMS`.
- `TopNav.tsx:205` hides New project below 640px.
- Confirmed live (§5.2).

**F4. Messages thread has no Back button.**
Live, the list is `display:none`, the thread is `flex`, and there are 0 Back buttons. `ConversationHeaderV2.tsx:69` only renders Back when `compact` (popup mode).

**F16b. The 44px touch token is dead.**
- Live: `pointer:coarse` is true, but `--ui-control-height` is `34px`.
- Cause: `:root[data-density="default"]` (specificity 0,2,0, at `globals.css:242`) beats `@media (pointer:coarse){ :root{…} }` (0,1,0, at `:1015`). `data-density` is always set.
- Fix: `@media (pointer:coarse) { :root, :root[data-density] { … } }`.

**F26 (new). Project identity collapses on phones 336–767px wide.**
- `ProjectLayout.tsx:245`: `.nb-project-identity` is `flex flex-wrap justify-between`, and its first child is `flex-1`, i.e. `flex-basis: 0%`.
- A zero-basis item never forces a wrap. The 287px action cluster stays on the first line, and the identity gets what is left.
- Live at 375px: the identity column is 40px wide and 494px tall, the description breaks one word per line, the "129" view count overlaps the title, and the header is 530px (65% of the viewport). At 320px it happens to wrap correctly.
- Fix: `max-md:basis-full` on the identity column (one class).

**F27 (new). Project tabs overlap instead of scrolling.**
- `ProjectLayout.tsx:424`: tab buttons have no `shrink-0`, so seven tabs shrink into 343px. For example, Dashboard renders 57px wide with 86px of content.
- Icons are squeezed out, labels overlap ("DashboarDocs", "UpdatesSprints"), and the scroll container never scrolls, so R8 fails.
- Fix: add `shrink-0` (one class). The existing auto-centering of the active tab then works as designed.

**F28 (new). Create-project wizard header overlaps.**
- `WizardHeader.tsx:15–17`: below md, the header is three equal grid columns. The title is `whitespace-nowrap`, and the stepper `nav` is `justify-self-center`, so it sizes to max-content.
- Live: the stepper spans x = −94…469px on the same line (y=90) as the "Create project" title.
- Fix: below md, show a title row plus a compact labeled progress bar (R18) and hide the stepper. Reuse `components/onboarding/MobileProgressBar.tsx` after adding a `label` prop; it currently hard-codes "Setup", "Onboarding progress" and `lg:hidden`.

### P1: works badly or violates the spec

**F5. Topbar contents.**
The topbar has theme toggle (34×34), avatar, divider, and menu on the right, and no search. It overflows to ~408px when the connection indicator shows.

**F6. MobileMenu is a second nav system with off-token styling.** See §5.2.

**F7. Chat FAB.**
Live, it sits on top of the Tasks toolbar's primary "+" button and covers the lower-right of every page.

**F8 / F37 (new). Hover-only actions.**
- `MessageBubbleV2.tsx:934`: react and actions show at `opacity-0` until hover, and render at 24×24 when visible.
- `SubtasksTab.tsx:259`: subtask row actions are hover-only.
- `ProjectDocRail.tsx:147`: doc item action is hover-only.
- Live proof: tapping where the hidden conversation-row "Unarchive" button sat opened the thread instead.

**F9. Messages loading skeleton** uses two columns at 375px (`messages/page.tsx:45`).

**F10. Kanban** registers `PointerSensor` only (`KanbanBoard.tsx:478`), so on touch a scroll gesture starts a drag.

**F11. Task toolbar**, confirmed live:
- The filter input is 144×34.
- There are two identical unlabeled "+" buttons.
- "Connect Desktop IDE" takes a full row on a phone.

**F12.** Kanban columns are a fixed `w-[300px]` with no scroll snap.

**F13.** Project action cluster has no stable position. It is superseded by F26 plus the §8.4 design.

**F14. Files tab double scroll** (`ProjectLayout.tsx:462`): the page scrolls under a pane that also scrolls.

**F15. Sprint rail** stacks the whole sprint list above the selected sprint.

**F16. Discover People rail** is `display:none` below 1200px, with no labeled entry (R5).

**F17.** 154 hard-coded `h-[30–39px]` control heights bypass the touch token. The top offenders are listed in the v1 table and carried into Phase 5.

**F18. Cookie banner** covers about 45% of `/login` at 375px.

**F29 (new). Files toolbar is clipped.**
- Live at 375px, the toolbar row is sidebar toggle, GitHub, "Connect Desktop IDE" (about 50% of the width), and Upload. The next button is cut off at the right edge.
- §23 says "Compact into overflow on mobile while preserving core actions".

**F31 (new). My work naming and drawer behaviour.**
- The label is "Workspace" in MobileMenu and in the WorkspaceDrawer title, but "My work" in the sidebar and spec §28.
- The drawer does not close on route change (`WorkspaceDrawerHost.tsx` has no pathname effect). On a phone the drawer is full-screen, so browser or hardware Back leaves it covering the new page.
- Fix: close the drawer on a `pathname` change below md.

**F32 (new). Small targets that the F16b fix will not cover**, because they don't use the token (all measured live):

| Surface | Element | Size |
|---|---|---|
| Network | tabs | 28px tall |
| Messages | "Chats" | 70×22 |
| Messages | "Archived" | 86×24 |
| Messages | conversation actions | 32×32 |
| Messages | message actions | 24×24 |
| Profile | "View N connections" / "View N projects" | 16px tall |
| Project | "Add project avatar" | 34×18 |
| Updates | "Expand composer" | 28×28 |
| Docs | doc chips | 32px |
| Docs | "Add doc" | 32×32 |
| Mobile menu | Close | 36px |

**F33 (new). Type scale (R15).** Families conform on every route. Sizes do not:
- `text-[10px]` appears 92 times in 34 files. Seen live in Tasks (×4) and Project settings (×5). It is below the 11px floor.
- `text-sm` (14px) appears 423 times. 14px is not on the scale; seen live in Network (×7). Use 13px (`nb-compact`) or 15px (`nb-body`).
- Doc headings are 26/22/18px (`ProjectDocRenderer.tsx:533–535`). Map them to 24/20/17.
- Doc code blocks (`ProjectDocCommandBlock.tsx:103`) compute to the `ui-monospace, SFMono…` stack, not JetBrains Mono. The `font-mono` class maps correctly in `@theme` (`globals.css:11`), so something later in the cascade overrides it; trace it in Phase 4. Code is also 13px on touch, where the spec says 14px.

**F34 (new). Off-token colour in mobile-visible chrome (R17).**
- MobileMenu uses rose and zinc.
- Conversation swipe actions use `bg-blue-500` and `bg-amber-500` (`ConversationListV2.tsx:464,471`).
- The Discover profile checklist uses emerald.
- Repo-wide there are 1,230 `zinc-*` and 935 rose/blue/amber/emerald/red/green utilities. Fix only in files touched by these phases; a repo-wide colour sweep is out of scope.

### P2: polish

- **F19.** Landing: hero h1 is 48px (should be 36px); footer links are 16px tall.
- **F20.** Docs: the doc chip row wraps into a wall; the outline drawer is deferred.
- **F21.** Project-settings open selector (12 sections) has no max-height.
- **F22.** Task detail and Workspace drawer use `px-6`; should be `px-4` below md.
- **F23.** Notifications tray is a popover; should be a full-height sheet below md.
- **F24.** Conversation header is `h-16 px-5`; should be `h-14 px-4` below md.
- **F25.** `MainLayout.tsx:14` has an unused `useAuth()`.
- **F35 (new).** The topbar hydrates in two passes: the bell and theme toggle appear after mount, which shifts the row. The §5.3 topbar has static slots, so this goes away.
- **F36 (new).** Two different fetchers share `queryKeys.workspace.summary()`: TopNav `getWorkspaceSummaryAction` and WorkspaceIndicator `readShellPart`. The fix is deletion: the drawer reuses WorkspaceIndicator, and TopNav's query and prop plumbing go away.
- **F38 (new).** Account settings shows "Username: Not set" while the profile shows `@ramanayudu_ch`. This is a data or display mismatch, not a mobile issue. Flagged only.

---

## 8. The new mobile design (<768px)

This is a complete mobile design. It changes layout, placement, navigation and controls. It keeps the spec's families, type scale, colour tokens, radii and spacing, so mobile reads as the same product as desktop.

### 8.1 Mobile tokens

These are existing spec values, picked for mobile.

| Role | Font | Size / line | Usage |
|---|---|---|---|
| Page title (`.nb-page-title`) | Instrument Sans 600 | 24/1.2 (already the ≤639px override) | Discover, Network, project name |
| Section title | Instrument Sans 600 | 20/1.25 | Settings section, wizard phase |
| Card title | Instrument Sans 600 | 17/1.28 | Project and person cards |
| Body | Instrument Sans 400 | 15/1.5 | Descriptions, messages |
| Compact / UI label | Instrument Sans 500 | 13/1.5 | Rows, buttons, tabs |
| Meta | JetBrains Mono 400 | 12 | Timestamps, counts, IDs |
| Micro label | JetBrains Mono 500 | 11, .09em, uppercase | Section keys, badges |
| Code | JetBrains Mono | 14 on touch | Docs, diffs |
| Marketing hero | Instrument Sans 600 | 36 (32–40) | Landing only |
| Editorial | Instrument Serif | 30 | Sign-in panel quote only |

**Geometry**
- Gutter 16px; card inset 16px; stacked gap 12px; sibling gap 8px.
- Controls look 42px inside a 44px target; nav rows 44px.
- Radius: control 5px, card 8px, sheet top corners 12px.
- Colour: active row is `--sidebar-accent` with a clay icon; primary is clay; counts use `.nb-nav-count` / `.nb-tab-count`; status uses `--status-*`.

**Layers (§09 scale):** sticky 10, chrome 20, popover 30, drawer 40, scrim 50, dialog 51, toast 60.

### 8.2 Shell

Specified in §5.3. The chat FAB and popup do not mount below md.

### 8.3 Messages

```
List (full screen)                    Thread (full screen)
┌─────────────────────────────┐       ┌─────────────────────────────┐
│ Chats ▾              🔍  ✎ │ 56px  │ ←  [av] Rama   • online   ⋯ │ 56px, 44px targets
│ Inbox            Archived  │       │                             │
│ [av] Rama           1 day  │ 64px  │  bubble … (tap → actions)   │
│      You: Hello            │ rows  │                             │
│ [av] Lakshmi CH   4 weeks  │ swipe │                             │
└─────────────────────────────┘ acts  │ [ + ] [ Message…      ] [➤] │ composer + safe area
                                      └─────────────────────────────┘
```

- **Back:** `ConversationHeaderV2.tsx:69` renders Back whenever `onBack` is set, with class `compact ? '' : 'md:hidden'`.
- **Touch actions:** under `(hover:none)`, tapping a bubble toggles the existing `showReactionBar`. Targets are 44px.
- **Swipe actions:** keep swipe-to-reveal, but recolour to tokens: Archive is `--secondary`, Mute is `--status-warning-soft`.
- **Loading skeleton:** single column below md.

### 8.4 Project workspace

```
Overview tabs (Dashboard, Docs, Updates, Settings)
┌─────────────────────────────────────┐
│ [48] Ponytail                  (24) │ identity: full width (F26 fix)
│ Lazy senior dev mode for AI agents. │ body 15, wraps
│ The best code is the code you never │
│ wrote.                              │
│ RC · ⎇ · 🔗 Links 1 · 👁 129 · ♥ 0  │ meta row, mono 12, wraps
│ [ Follow ]  [ Invite ]  [ ⤴ ]       │ action row, 44px, fixed order
├─────────────────────────────────────┤ sticky
│ Dashboard  Docs  Updates  Sprints  ›│ shrink-0 tabs scroll (F27 fix),
└─────────────────────────────────────┘ edge fade, no icons below 640px

Tool tabs (Tasks, Files, Sprints): compact context (R9)
┌─────────────────────────────────────┐
│ [24] Ponytail                    ⋯ │ 48px row; ⋯ = Follow, Invite, Share
├─────────────────────────────────────┤
│ Dashboard  Docs  Updates  Sprints  ›│
└─────────────────────────────────────┘ pane fills the rest; one scroller (R10)
```

**Tasks**

```
[ 🔍 Filter tasks…                        ]   full width
[ All ▾ ]              [ + Task ]   [ ⋯ ]     ⋯ = New section, Connect desktop IDE
┌───────────────────────────────┐┌─
│ TO DO · 4                     ││   column = min(300px, 100vw−48px)
│ card                          ││   snap-x mandatory; one column + peek
```

- Add `TouchSensor {delay: 250, tolerance: 5}`.
- Task detail is already full screen; set `px-4`.
- Subtask actions go in a visible ⋯ per row on `(hover:none)`.

**Files**
- Toolbar: `[☰ tree] [breadcrumb…] [⤒ Upload] [⋯]`. The ⋯ menu holds GitHub, Connect desktop IDE, New folder, View and Transfers.
- The tree is already a drawer.
- File preview is full screen with a Back control. Compare uses unified view below md.

**Sprints**
- `[ Sprint: Current · Sprint 1 ▾ ]` is a native `<select>` with `<optgroup>`s for Current, Upcoming and Completed, next to `[ + Sprint ]`.
- The timeline takes the full width.

**Docs**
- The doc switcher is one horizontally scrolling chip row (`flex-nowrap overflow-x-auto`).
- Headings use the 24/20/17 scale; code is JetBrains Mono 14px.

**Settings (12 sections)**
- The existing sticky labeled selector stays, with the open list capped at `max-h-[60dvh] overflow-y-auto`.
- Rows stack their controls.

### 8.5 Create project wizard (route and dialog)

```
┌─────────────────────────────────────┐
│ Create project                   ✕ │ 56px
│ 02 INFO · Phase 2 of 5  ●●○○○       │ MobileProgressBar(label="Create project")
├─────────────────────────────────────┤
│ form, one column, 16px              │
├─────────────────────────────────────┤
│ [💾]                  [ Continue › ]│ existing .nb-wizard-footer (safe area)
└─────────────────────────────────────┘
```

The stepper `nav` is `hidden md:block`.

### 8.6 Discover, Network, Profile, Settings

- **Discover:** header row `Discover` with `[ People ]` below 1200px. The button opens `Dialog presentation="right-drawer"` containing `DiscoverPeopleRail`. The view select stays full width.
- **Network:** tabs get 44px targets (F32); body text moves from 14px to 13/15px.
- **Profile:** already correct. Enlarge the connection and project link targets to 44px rows.
- **Account settings:** already correct (labeled selector, stacked rows). The touch token fix brings its buttons to 44px.

### 8.7 Overlays and public pages

- **Notifications:** full-height sheet below md.
- **Toasts:** bottom inset, lifted above the composer or wizard footer via Sonner `mobileOffset`.
- **Workspace drawer:** full screen, title "My work", `px-4`, closes on route change.
- **Landing:** h1 36px; footer links as 44px rows.
- **Cookie banner:** one line plus three buttons, at most 35dvh.

---

## 9. Cut list

| Delete | Replacement |
|---|---|
| MobileMenu's own nav list, rose/zinc styles, Search and Notifications rows (~110 lines) | Shared sidebar nav body |
| TopNav's `getWorkspaceSummaryAction` query and `workspaceActionCount` plumbing (F36) | `WorkspaceIndicator` (already queries) |
| Mobile topbar ThemeToggle, avatar dropdown, divider | Drawer identity row and footer |
| Chat FAB and popup below md | Messages nav item |
| Wizard stepper below md | Reused `MobileProgressBar` |
| `OpenInIdeButton` and GitHub in phone toolbars | ⋯ overflow |
| Stacked sprint rail below lg | Native `<select>` |
| `MainLayout.tsx:14` unused `useAuth()` | none |

**Not building**
- **A bottom tab bar.** §09 specifies a topbar plus drawer, and a bottom bar fights the composer and wizard footers for the safe area.
- **Separate mobile routes or components**, a `useIsMobile` hook, or a sheet/drawer dependency. Radix Dialog `right-drawer` already exists.
- **A repo-wide colour or `text-sm` sweep.** Fix these only in files touched by these phases.

---

## 10. Measurements

Baseline captured live on 2026-09-29 at 375px, signed in.

| Metric | Baseline | Target |
|---|---|---|
| Taps to Settings / New project / a project / My profile | ∞ / ∞ / 3+ / 2 (avatar menu) | 2 / 2 / 2 / 2 |
| Taps to leave a thread | browser Back only | 1 |
| Project header height before tabs | 530px | ≤ 280px (overview), 48px (tool tabs) |
| Tabs with overlapping labels | 7 of 7 | 0 |
| `--ui-control-height` on coarse pointer | 34px | 44px |
| Controls under 44px in the first 2 screens | discover 12, network 17–21, messages 9, profile 18, settings 9, dashboard 6, docs 10, updates 7, sprints 6, tasks 21, files 32, project settings 21, landing 19 | 0, except inline prose links |
| Horizontal overflow, including clipped toolbars | files toolbar clipped; wizard stepper −94…469px | 0 |
| Off-scale font sizes on touched routes | 10px, 14px, 16px, 18px, 22px, 26px | 0 |
| Desktop 1280px pixel diff | n/a | 0 |

**Runnable check:** one new spec, `tests/e2e/mobile.spec.ts`, plus a `mobile` project in `playwright.config.ts` using `devices['iPhone 13']`. At 375px it asserts, for each route in §6:
- nothing extends past `innerWidth`, including inside `overflow-hidden` parents;
- no interactive element is smaller than 44px;
- the drawer contains the §5.1 items in order;
- the thread has a visible Back button;
- project tab buttons don't overlap.

At 1280px it runs the desktop screenshot comparison.

---

## 11. Phases

Each phase follows CLAUDE.md: freeze to the folder, update tests first, build, benchmark, `ponytail-review` then `review`, ship.

| Phase | Freeze | Findings | Contract tests first |
|---|---|---|---|
| 0. Baseline | none | §10 numbers (already captured), add `mobile.spec.ts` (expected to fail) | none |
| 1. Touch token + project layout | `src/app/globals.css`, `src/components/projects/dashboard/*`, `src/components/projects/ProjectStatsBar.tsx`, `src/components/projects/tabs/DashboardTab.tsx` | **F16b, F26, F27, F39** (one-class fixes first), then the §13.2 header, F13, F14, F40–F45, and the §13.4 dashboard (F47–F52) | `project-layout-scroll-contract`, `project-dashboard-settings-ui-contract`, `journey-completion` |
| 2. Quick nav + shell | `src/components/layout`, `src/components/workspace`, `ChatPopupV2.tsx` | F1–F3, F5, F6, F7, F25, F31, F35, F36 | `topnav-contract:214–221`, `application-sidebar-contract`, `sign-out-confirm-dialog-contract` |
| 3. Messages | `src/components/chat`, `messages/page.tsx` | F4, F8, F9, F24, F32 (messages), F34 (swipe colours) | messages contracts |
| 4. Project tools + wizard | `…/v2/tasks`, `TasksTab.tsx`, `…/files-tab`, `…/tabs/sprint*`, `…/doc`, `create-wizard`, `onboarding/MobileProgressBar.tsx` | F10–F12, F15, F20–F22, F28, F29, F33 (doc type), F37 | `task-design`, `sprint-design`, `files-tab-design`, `project-doc-design`, `create-project-phase*` |
| 5. Rails, overlays, public | `discover`, `NotificationPreview.tsx`, cookie banner, `(site)` landing, `network` | F16, F18, F19, F23, F32 (network, profile), F33 (network) | `notification-redesign-contract` |
| 4b. Project tabs (final audit) | same as Phase 4, plus `…/updates` | F53–F58 (§13.5) | `project-updates-design-contract`, `task-design-contract` |
| 5b. Profile | `src/components/profile` | F59–F66 (§13.6) | `profile-role-layout-contract`, `profile-display`, `profile-contribution-visibility-contract` |
| 6. Touch sweep | per file, F17 list | F17, remaining F32/F33 in touched files | e2e: 0 controls under 44px |

Phase 1 is three class changes and fixes the most visible breakage. Phases 1–3 clear every P0.

---

## 12. Open questions (defaults chosen)

1. **Tablet (768–1023px)** stays desktop and is untouched. It already uses the collapsed rail.
2. **Drawer side:** left, matching the sidebar's origin.
3. **Theme control:** drawer footer. Settings → Appearance also keeps it.
4. **F38** (username shows "Not set" in Account settings) is out of scope here. It needs its own ticket.

---

## 13. Final audit: project detail page and profile page

**Evidence.** Live at 375×812 with a coarse pointer, signed in as the project owner, on two projects:
- `deepscope-ai` has an avatar, 3 members, 5 tasks, 1 sprint, 3 docs, updates, and files.
- `ponytail` has no avatar and an empty board.

On the profile side: `/my-profile` Overview and Portfolio. Every number below is measured with `getBoundingClientRect` unless it cites code.

Spec anchors:
- **§19:** header order is *breadcrumb → title and stage → summary → team/activity → object tabs*. Overview must "expand long content without oversized text walls". Team shows as 34px roster rows with role labels. Stats are a compact mono strip with 11px labels. On tool tabs the summary compacts.
- **§17:** profile actions sit *below identity on mobile*; the rail *collapses below main content*; missing optional data becomes an *own-profile completion action*.
- **§09:** reading order is *title → summary → status → action*, with no visual reordering that contradicts keyboard order.

### 13.1 What the page looks like today at 375px

| Region | Measured | Verdict |
|---|---|---|
| Header, no avatar (`ponytail`) | 530px tall; identity column 40px; one word per line | ❌ F26 |
| Header, with avatar (`deepscope-ai`) | 273px tall; **Invite button (x 157–238, y 77–121) covers the title (x 112–241, y 79–140)**; view count "25" is under the title | ❌ F39 |
| Stage / status | Not in the header. First visible 1,741px down, in the Journey card | ❌ F40 |
| Stats | "129" and "0" beside unlabeled icons, zinc colours | ❌ F41 |
| Team | 34px avatar stack. Names and roles appear only in tooltips; 44px touch targets overlap by 6px | ❌ F42 |
| Tabs | 7 tabs squeezed into 343px, labels overlap | ❌ F27 |
| Dashboard main card | **1,327px** text wall; Journey at y 1,741; Open roles at y 2,138 | ❌ F47, F48 |
| Tasks | Toolbar takes 3 rows; column controls 28×28; task detail puts Delete (32px) next to Close (32px) | ❌ F53, F54 |
| Files | **New folder (x 358–394) and Files actions (x 402–434) are off-screen**; the file view has no name and no back control | ❌ F29, F56 |
| Sprints | Rail 251px stacked above the sprint; title squeezed to 68px beside Edit and ⋯ | ❌ F15, F57 |
| Docs | Body reflows cleanly; the chip row wraps to 2 rows for 3 docs | ⚠️ F20 |
| Updates | Feed reads well; detail opens at the top of the feed; targets 16–28px | ⚠️ F58 |
| Settings | Sticky labeled selector at top 63px; cards stack | ✅ |
| Profile header | 414px tall; text column 209px beside a 72px avatar; switch 20px tall; count links 16px tall | ⚠️ F59 |
| Profile cards | 20px insets; 28px edit buttons; title case; Contributions 754px; Links truncated; Shortcuts duplicates the header | ⚠️ F60–F64 |
| Portfolio | ProjectCards 343px wide with 16px padding | ✅ F65 |

### 13.2 Project header: findings and redesign

**Findings**

**F39 (P0). The Invite button covers the project title when the project has an avatar.**
Same root cause as F26 (the identity column's `flex-1` has a 0 basis, so it never wraps), made worse by the avatar branch's inner row `flex items-start gap-4` (`ProjectLayout.tsx:285`), which lacks `min-w-0`. The h1 overflows under the action cluster.
Fix: `max-md:basis-full` on the identity column plus `min-w-0` on the inner row.

**F40 (P1). No stage in the header.**
§19 requires *title and stage*. The current stage ("Beta release") appears only inside the Journey card, below the fold. The data is already in `ProjectDashboardClient` (`lifecycleStages`, `currentStageIndex`).

**F41 (P1). Stats are icons without labels.**
`ProjectStatsBar.tsx` renders `BarChart2 129 · UsersRound 0` in `text-zinc-500/900`. §19 says a compact mono strip with 11px labels; R17 forbids raw zinc.

**F42 (P1). The team is hover-only.**
`ProjectTeamAvatars.tsx:128–143` puts name and role in a `Tooltip`, which never shows on touch. The `.nb-avatar-trigger` 44px coarse targets overlap because of `-space-x-1.5`; §09 says "do not tightly overlap target areas". §19 wants 34px roster rows with role labels.

**F43 (P2). Undersized header controls.**
"Add avatar" is 34×18. The Manage-links "+" is `h-7 w-7` (28px).

**F44 (P2). Follow has no label below 640px.**
`hidden sm:inline-block` leaves only a UserPlus/UserCheck icon, so Follow and Following are hard to tell apart. §04 says actions name the verb and object.

**F45 (P1). The header doesn't compact on tool tabs** (R9). On Tasks, the toolbar starts about 560px down on the no-avatar project.

**Redesign (<768px, overview tabs)**

```
┌─────────────────────────────────────┐ white, hairline bottom, 16px inset
│ [48] DeepScope AI           (24/1.2)│ avatar 48 (spec avatar step), title wraps ≤2 lines
│      ● BETA RELEASE · 2 of 3        │ nb-status chip + mono 12 (F40)
│ See Beyond the Surface of Any       │ summary 15px, full width, ≤3 lines + "More"
│ Website.                            │
│ [RC][LC][R] 3 members ›             │ avatars 26px, NOT individual targets;
│                                     │ one 44px button → team sheet (F42)
│ VIEWS 25 · FOLLOWERS 0 · ⎇ · Links 2│ mono strip, 11px labels (F41), links
│                                     │ overflow already OK
│ [ ＋ Follow ][ Invite ][ ⤴ ]         │ 44px row, fixed order, labels visible (F44)
│ [ 2 open roles › ]  (visitors)      │ jumps to Open roles card = primary action
├─────────────────────────────────────┤ sticky tabs (F27 shrink-0 fix)
│ Dashboard  Docs  Updates  Sprints  ›│
└─────────────────────────────────────┘
```

**Tool tabs (Tasks, Files, Sprints).** Collapse to one 48px row: `[24 avatar] DeepScope AI · BETA   ⋯`. The ⋯ menu holds Follow, Invite, Share and Team. Everything else is hidden below md (R9).

**Team sheet.** Use the existing `Dialog presentation="right-drawer"`, full width on mobile. Each member is a 34px avatar row with name, role, and presence. This satisfies §19's roster and removes the dependency on tooltips.

**Reading order in the DOM stays title → stage → summary → team → stats → actions**, which satisfies §09 with no visual reordering.

### 13.3 Tabs bar

- **F27** fix: `shrink-0` on tab buttons, plus a right-edge `mask-image` fade below md. Hide tab icons below 640px so about 4.5 labels fit.
- The active tab auto-centres; the code for this already exists (`ProjectLayout.tsx:197–212`).
- **F46 (flag, not mobile).** §19 lists 8 tabs including **Analytics**. The app ships 7, and `src/components/projects/analytics/` is empty. This is a product decision; the report does not add the tab.

### 13.4 Dashboard tab and the main Overview card

**Findings**

**F47 (P0 on mobile). The main card is an oversized text wall.**
`ProjectOverviewCard.tsx` renders the full description (1,327px tall on DeepScope), which violates §19's "expand long content without oversized text walls". Also:
- `p-5 sm:p-6` gives a 20px inset; mobile should be 16px (R3).
- The Problem and Solution boxes are `min-h-44` (176px) each and stack.
- The copy says "Click to read full text"; touch devices don't click.
- Tags and Skills are separated by `gap-12` (48px).
- The category and collaboration-intent key/value rows from §19 are not rendered.

**F48 (P1). Status and actions are buried.**
Journey starts at y 1,741 and Open roles at y 2,138. The fix is to cap F47's height and add the header stage chip (F40) and "N open roles" link (§13.2). Don't reorder the DOM (§09).

**F49 (P1). Journey card.**
- Stage completion dates exist only in a hover tooltip (`JourneyTimeline.tsx:207–211`).
- The back and advance buttons are 28×28 (`:117, :129`).
- The last label is cut off at the card edge ("Launch & Iterat…").

**F50 (P2). Recent activity uses different anatomy.**
The heading sits outside the card as mono with `.16em` tracking; the spec says `.09em`. The body is `text-sm` (14px, off-scale). The skeleton persisted more than 8s on load.

**F51 (P1). Open roles.**
- The card has a nested `max-h-[320px] overflow-y-auto` scroller (R10).
- Invitation Accept and Decline are 28px (`OpenRolesCard.tsx:130, :138`).
- It uses `text-[14px]` and `text-[10px]` (R15).
- "Manage roles" is 34px, and the chat FAB covers it.

**F52 (P2, deletion). Four card anatomies for one pattern.**
`DashboardCard`, the profile `Card` (`sections/Card.tsx`), `RailCard` (`ProfileRightRail.tsx:29`), and RecentActivity's ad-hoc card are all *icon + 17px title + hairline + body*. Keep `DashboardCard` and route the other three through it. That is one header, one set of mobile insets (`px-4 py-3` below md), and one 44px action slot.

**Redesign: main Overview card (<768px)**

```
┌─────────────────────────────────────┐ DashboardCard, 16px inset
│ Overview                      (20)  │ section title, sentence case
│ CATEGORY    Browser extension       │ key/value rows (§19): mono 11 label,
│ LOOKING FOR Collaborators           │ 13px value, 40px rows
│                                     │
│ DeepScope AI is a smart browser     │ 15px prose, clamp 6 lines
│ extension + web dashboard that …    │ (line-clamp-6)
│ [ Read full description ]           │ 44px text button → expands inline;
│                                     │   collapses back (aria-expanded)
│ ▸ The problem                       │ 44px disclosure rows (<details>),
│ ▸ The solution                      │   native, no dialog needed on mobile
│                                     │
│ TAGS   #ai #extension …             │ tags wrap; gap 12 (not 48)
│ SKILLS [React][TS] +4               │ SkillList maxVisible=6 on mobile
└─────────────────────────────────────┘ ≈ 420–520px instead of 1,327px
```

**Why native `<details>` (ladder rung 4).** It gives expand and collapse, keyboard access, and correct semantics with no JS. On mobile it replaces the 176px boxes and the modal. Desktop keeps the boxes and the modal, gated by `md:` classes.

**Journey card (mobile)**
- Header: `Journey · Beta release (2 of 3)`.
- Controls: back and advance buttons at 44px targets.
- Dates: shown inline under each stage as mono 11 (`Jul 2`), not in a tooltip.
- Columns: `minmax(6.5rem,1fr)` with snap, so the last label shows in full.

**Open roles (mobile)**
- Remove the nested scroller; show the first 3 roles plus "Show all N roles".
- Each role: title 17, `1 SPOT LEFT` badge, 13px summary, skill tags, full-width 44px **Apply** (visitor) or **Manage roles** (owner).
- Invitation Accept and Decline become 44px buttons.

**Recent activity:** move into `DashboardCard` with an icon, "Recent activity" title, 13px rows, and mono 12 time.

**Dashboard order below md:** header → Overview (capped) → Journey → Recent activity → Open roles. This matches the DOM, and the header already shows stage and the roles action, so nothing important is below the fold.

### 13.5 Tool tabs: findings and redesign

**Tasks**

**F53 (P1). Toolbar and board.**
- The toolbar takes 3 rows: filter 144×34; scope segment All / Sprint / Backlog at 28px tall; "Connect desktop IDE" 180×36; two unlabeled "+" buttons (40×34 and 42×34).
- Column header Options and Reorder are 28×28. The Reorder drag handle competes with swipe scrolling (F10).
- The FAB covers the card ID ("DA-…").

**F54 (P1). Task detail.**
- Delete (32×32) sits right next to Close (32×32). A mistaken tap on a destructive control is one pixel away; §09 says do not place removal actions tightly against others.
- The tabs Details / Subtasks / Comments / Files are 28px tall, and Comments truncates to "Comme…".
- The IDE select takes header space.
- Date shortcuts "Today" and "+1 Week" are 20px tall.
- The status and priority badges wrap into two rows beside the ID.

**F55 (flag).** A task in **Done** still shows an `OVERDUE` badge. This is display logic, not mobile.

**Redesign (<768px)**

```
Board                                   Task detail (full screen)
[ 🔍 Filter tasks…                ]     ┌─────────────────────────────────┐
[ All | Sprint | Backlog ] 44px seg    │ ←  DA-2 · TO DO · HIGH         ⋯ │ 56px: Back left, ⋯ right
[ + Task ] (primary, labeled)  [ ⋯ ]   │ Details  Subtasks  Comments  Fil›│ 44px tabs, scroll, no truncation
 ⋯ = New section, Connect desktop IDE  │ Front-end design for all pages   │ 20px title
┌──────────────────────────────┐┌─    │ PROPERTIES rows 44px             │
│ TO DO · 3                 ⋯  │     │ Due  02/08/2026 [Today][+1 week] │ 44px chips
│ card (title, badges, meta)   │     └─────────────────────────────────┘
```

- ⋯ in task detail holds Copy link, Connect desktop IDE, and **Delete**. Delete moves into the menu, away from Close, and keeps its existing confirm dialog.
- Columns are `min(300px, 100vw−48px)` with snap. Reorder moves into the column ⋯ menu below md; the handle is hidden.
- `TouchSensor {delay 250, tolerance 5}` (F10).

**Files**

**F29 (P0 on mobile).** New folder and Files actions render off-screen (x 358–434 at a 375px viewport), so they can't be reached. The breadcrumb "Project files" (x 64–159) sits under the GitHub button (x 84–120).

**F56 (P1). File view has no identity or back control.**
The name and breadcrumb aren't visible, and there's no Back-to-folder button, so leaving depends on browser Back. Code renders at 13px; §04 says 14px on touch.

**Redesign (<768px)**

```
┌─────────────────────────────────────┐
│ [☰] Project files ▸ docs       [⤒][⋯]│ 44px: tree, breadcrumb (truncates start),
└─────────────────────────────────────┘ Upload, ⋯ = New folder, GitHub, IDE, View, Transfers
File view:
│ ←  .pre-commit-config.yaml       ⋯ │ Back to folder, name, ⋯ = versions/download/tasks
│ 1.4 KB · Ramanayudu CH · 7 mo ago   │ mono 12 metadata strip
│ code, 14px JetBrains Mono, local x-scroll │
```

**Sprints**

**F57 (P1). Sprint header squeeze.**
`SprintHeader.tsx:59–111` is `flex justify-between` with no wrap, so the title is 68px wide beside Edit and ⋯, and the header is 201px tall. "New Sprint" is title case (§04 wants sentence case). The full-width primary "+ New Sprint" sits above the list.

**Redesign.** Sprint picker row: `[ Sprint 1 · Completed ▾ ]  [ + ]`. The picker is a native `<select>` with optgroups (F15). Below it:

```
Sprint 1 — testing extention          (20, wraps full width)
COMPLETED · Jun 18 – Jul 2, 2026      (mono 12)
[ Edit ]  [ ⋯ ]                       (44px row under title)
```

**Docs (F20)**
- The doc switcher becomes one row with `overflow-x-auto snap-x`; the active doc chip scrolls into view. Chips and "Add doc" are 44px.
- The body is already correct. Keep its 24/20/17 heading mapping (F33).

**Updates**

**F58 (P1).** Tapping an update opens its detail inline at the **top** of the feed (`UpdatesTab.tsx:438`), which loses your place (§09 says Back restores scroll). The `UpdatesRightRail` shortcuts (xl only) can't be reached. Targets: Update options 22×28, like/comment 43×24, inline Task/Sprint chips 16px tall, Expand composer 28×28.

**Redesign.** On mobile, detail opens as a full-screen `right-drawer` with Back, and the feed position is kept underneath. Shortcuts move into a labeled "Shortcuts" button beside the feed title (R5). Like, comment, and options become 44px targets, and inline chips get 44px padding.

**Settings.** Already correct (sticky labeled selector, stacked cards). Only F21 applies (cap the open list at 60dvh).

### 13.6 Profile page: header and every card

**Findings**

**F59 (P1). Profile header.**
- The 72px avatar with a 20px gap leaves a **209px** text column for name, handle, headline, location (wraps to 2 lines), counts, and 6 skill tags (4 rows).
- The header is 414px tall with a 20px inset; mobile should be 16px.
- The "0 connections" and "4 projects" links are 16px tall.
- The "Open to collaborators" switch row is 20px tall.
- §17 says actions go below identity on mobile, and they do; the problem is the narrow identity column.

**F60 (P2). All profile cards.**
- Headers are `px-5 py-4` (20px); mobile should be 16px.
- Edit buttons are `p-1.5` (28×28) with `rounded-[3px]`; controls should be 5px radius (R14).
- Titles are title case: "Open to Roles", "Project Contributions", "Profile Completeness"; §04 wants sentence case.
- Icon sizes vary between 16, 18 and 20px.

**F61 (P1). Project contributions is 754px tall.** All 4 contributions render in full; project-name links are 19px tall; each row is 295–324px.

**F62 (P2). Links rail** uses `grid-cols-2`, so account labels truncate to "rama…" (`ProfileRightRail.tsx:71`).

**F63 (P2). Profile completeness** is a full card at the bottom (y 1,914). §17 says missing data should appear as an *own-profile completion action*; §08 says a small panel with a 6px bar and one hint.

**F64 (P2, deletion).** The Shortcuts card (Edit profile, My projects) duplicates the header's Edit profile and the Portfolio tab, and the FAB covers "My projects".

**F65 (pass).** Portfolio ProjectCards are full width with 16px padding, 262–324px tall.

**F66 (pass).** Rail cards stack below the main column via `contents` and `order-*`, as §17 requires.

**Redesign (<768px)**

```
┌─────────────────────────────────────┐ 16px inset, white, 8px radius
│ [72] Ramanayudu CH            (24)  │ avatar row carries only name + handle
│      @ramanayudu_ch   (mono 12)     │ + availability badge
│      ● OPEN TO COLLABORATE          │
│ Full stack developer          (15)  │ everything below is FULL WIDTH (F59)
│ 📍 Vijayawada, Andhra Pradesh, India│ mono 12
│ [0 connections] · [4 projects]      │ 44px-tall text buttons
│ [Claude Code][CodeRabbit][Cursor]…  │ tags wrap full width → 2 rows, not 4
│ [ ✎ Edit profile      ][ ⤴ ]        │ primary flex-1 + Share icon, 44px
│ Open to collaborators        [■  ]  │ 44px switch row
│ 89% complete · Add website  ›       │ own-profile completion strip (F63):
└─────────────────────────────────────┘ 6px clay bar under text, one hint
 Overview | Portfolio                     clay underline tabs, 44px
```

Other viewers see `[ Connect ▾ ]  [ Message ]` in the actions row instead of Edit and Share. That is the same row with a different behaviour (§17: "public/own context is behavioral").

**Cards (all through `DashboardCard`, F52)**

| Card | Mobile design |
|---|---|
| About | Title "About"; 44px edit target (28px visual). Body 15px, clamp 8 lines + "Read more". Empty state for own profile: "Add a short bio" 44px action; other viewers: omit the card. |
| Open to roles | Role tags wrap. Experience and capacity as key/value rows, mono 11 label + 13px value, 40px rows. |
| Project contributions | Show the first 2 contributions + "Show all 4" (44px). Each row: project link as a 44px row with name, role (13px), date (mono 12), skill tags max 4 + "+N". Private badge kept. |
| Links | **Single column** 44px rows: 16px provider mark, platform label, account label, then chevron. No truncation to "rama…". |
| Profile completeness | Removed as a card below md; replaced by the header strip above (owner only). |
| Shortcuts | `max-md:hidden` (duplicate). Desktop unchanged. |
| Portfolio: ProjectCards | Keep (passes). |

**Mobile order (Overview tab):** header → tabs → About → Open to roles → Project contributions → Links. The DOM already matches this, so no reordering is needed.

### 13.7 Measurements for these two pages (targets)

| Metric | Now | Target |
|---|---|---|
| Project header height, overview tabs | 273px (avatar) / 530px (no avatar) | ≤ 300px |
| Project header height, tool tabs | same as above | 48px |
| Title overlapped by controls | yes (Invite over title) | never |
| Dashboard: y of Journey card | 1,741px | ≤ 900px |
| Main Overview card height | 1,327px | ≤ 520px collapsed |
| Unreachable Files toolbar controls | 2 | 0 |
| Destructive control next to Close (task detail) | yes | no |
| Profile header height / text column | 414px / 209px | ≤ 400px / 311px (full width) |
| Profile Overview total scroll height | ≈ 2,220px | ≤ 1,700px |
| Card-anatomy components | 4 | 1 (`DashboardCard`) |

The e2e spec in §10 gains these assertions:
- No element inside `.nb-project-identity` intersects the h1 box.
- Every Files toolbar control lies within `innerWidth`.
- The Delete control in `[data-testid=task-detail-panel]` isn't adjacent to Close.
- The profile header text column is at least 300px wide at 375px.

---

## 14. Network person cards: placement and height (2026-09-30)

Applies to Suggested, Connections and Invitations, on mobile and desktop. Shipped in `b37b74f5`.

### 14.1 Placement rule

> **One line sits under the name: the location if there is one, otherwise the real headline.** The headline moves full width below the avatar only when a location took that line. Secondary meta ("shared connections", "Connected …", "Role · …") follows that line. No filler text.

The rule lives in one place, `PersonCardLayout` (`src/components/network/PersonCard.tsx`): `{location ?? (headline ? … : null)}` beside the avatar, then `headlineBelow = location ? headline : null` below it.

| Card | Beside the avatar | Below the avatar |
|---|---|---|
| Suggested, no location | Name · headline · shared connections | Skill tags |
| Suggested, with location | Name · location · shared connections | Headline · skill tags |
| Suggested, private profile | Name · "Private profile" | — |
| Connection | Name · location or headline · "Connected …" | Headline (if location) · skill tags |
| Invitation received | Name · location or headline | Headline (if location) · real message |
| Project invitation (received / sent) | Name · "Invited (you) to join …" · Role | Badge / "Pending response" |
| Sent connection request | Name · location or headline | Headline (if location) · "Pending response" |

### 14.2 Findings

| # | Issue | Root cause | Resolution |
|---|---|---|---|
| F67 | Headline stacked under the location beside the avatar | Previous rule "headline beside avatar when fewer than 2 meta lines", so location plus headline both sat beside the photo | The rule now keys on location (§14.1) |
| F68 | Fake headline "NetworkBase member" on cards without one | `\|\| "NetworkBase member"` fallback in 4 places | Real headline only (`headline?.trim()`). The name fallback stays, because that is identity. |
| F69 | Filler invite message "Wants to connect and collaborate with you." | Same fallback pattern | Show the message only when the sender wrote one |
| F70 | Every card 168px, however little it holds; sparse cards show about 80px of empty space | `VirtuosoGrid` needs uniform item heights → `h-[168px]` / `min-h-[158px]` | `PersonCardGrid`: a CSS grid, cards sized to content, rows stretch to their tallest card |
| F71 | Empty 12px gap at the bottom of sparse cards | The body block always rendered | The block renders only when a headline-below or body exists |
| F72 | Invitations forced to 168px although they are not virtualized | Fixed height copied onto invitation cards | Removed |
| F73 | Skeletons fixed at 168px; Connections used bare blocks | Fixed wrapper; `Skeleton` blocks | Natural-height `PersonCardSkeleton` everywhere |
| F74 | A contract test pinned the fixed height | `topnav-contract.test.ts` asserted `min-h-[158px]` | Now asserts no fixed height, no filler, and the slot rule |

### 14.3 Heights (padding and border 34px; name 22px; meta line 22px; headline line 26.5px)

| Card content | Before | After |
|---|---|---|
| Name only | 168px | ≈ 82px |
| Name + headline | 168px | ≈ 85px |
| Name + headline + tags | 168px | ≈ 121px |
| Name + location, then headline + tags | 168px | ≈ 149px |
| Name + location + shared/connected, then headline + tags (fullest) | 168px | ≈ 169px |

A sparse card that shares a row with a rich card matches the rich card's height, so actions and edges stay aligned. A row of sparse cards is short.

### 14.4 Trade-off: virtualization removed

- **Before:** `VirtuosoGrid` kept only the on-screen cards in the DOM, but it forced one height on every card.
- **Now:** a plain grid. An `IntersectionObserver` sentinel (`rootMargin: 600px`, the same pattern as `WorkspaceTasksTab.tsx`) loads the next page. Each item has `content-visibility: auto; contain-intrinsic-size: auto 150px`, the same technique `.nb-project-card` uses, so off-screen cards skip layout and paint.
- **Ceiling:** the DOM grows by one page (20 suggestions or 50 connections) per scroll. This is fine into the low thousands.
- **Upgrade trigger:** if a user reaches thousands of connections and scrolling shows jank, switch to a Virtuoso list of 2-card rows (variable row height). The `ponytail:` comment on `PersonCardGrid` records this.

---

## 15. Create project: a page, not a modal (2026-09-30)

Shipped in `75dd9435` (code) and `95c09688` (e2e). "New project" no longer opens a modal. It goes to `/projects/new`, a normal page.

**Correction (same day):** the first version hid the sidebar and top bar. That was wrong. The page now keeps the app shell and only the main content area changes, exactly like Network or Discover. The chat button stays hidden here because the footer's Continue sits in that corner.

### 15.1 Behaviour

| Moment | Behaviour |
|---|---|
| New project (top bar, mobile menu, Discover empty state) | `<Link href="/projects/new">`. Sidebar and top bar stay; the main area shows the matching skeleton (`CreateProjectShellSkeleton`) until the page loads. |
| ✕ / Esc, no changes | Return to the originating page, recorded by `MainLayout` in sessionStorage; fall back to `/discover`. |
| ✕ / Esc, unsaved | "Leave project setup?" dialog. Leave discards. |
| Browser Back | Leaves immediately and saves a draft on unmount (`useCreateProjectWizard`). |
| Refresh / close tab, unsaved | Native browser prompt, except during the GitHub sign-in hand-off. |
| GitHub sign-in return | The route client restores the snapshot and strips the parameters. Close uses `replace`, never history back, so it can't land on github.com. |
| Created | `router.replace('/projects/<id>')` and refresh the Discover and search caches. Success no longer also calls close. |

### 15.2 Layout

| Element | Desktop ≥768px | Mobile <768px |
|---|---|---|
| Header | 64px band: title · stepper (numbers only on 768–1023px, except the current step) · ✕ `title="Close (Esc)"` | 56px row plus 48px progress row (hidden at height ≤ 500px) |
| Body | One scroller; `WIZARD_COLUMN` = 1000px, `px-6 py-8` | `px-4 pt-5 pb-6`, `scroll-pb-32` |
| Source tiles | Content height (no `min-h-44`), `p-6` | Compact rows, `p-4`, `gap-3` |
| Phase 1 summary | Side-by-side with left border | Stacked, top border |
| Draft strip | Band; inner aligned to the column | Text above two equal buttons |
| Footer | Band; Back · status · Save draft + Continue aligned to the column | Status line, then Back · icon Save draft · `flex-1` Continue; safe-area padding |

### 15.3 Removed
- The Dialog presentation of `CreateProjectWizard`.
- The TopNav wizard mount and its `?createProject=1` effect.
- The Discover wizard mount, its modal-state sessionStorage, and its `?createProject=1` effect.
- The `onNewProject` prop on MobileMenu.

`?createProject=1` on other pages is no longer handled. It was internal only.

### 15.4 Refinements (ideas 1–6)

| # | Change | Where |
|---|---|---|
| 1 | Esc no longer closes the page. ✕ became "Cancel" (icon-only on phones). | `CreateProjectWizard.tsx`, `WizardHeader.tsx` |
| 2 | Finished steps in the stepper are buttons back to that step (`goToPhase`); later steps stay locked. | `WizardHeader.tsx` |
| 3 | On `/projects/new`, the top-bar and mobile-menu "New project" read as the current page (`aria-current="page"`, muted). | `TopNav.tsx`, `MobileMenu.tsx` |
| 4 | Save draft button removed; the footer status reads "Phase N of 5 · Saved … · Save now" (autosave stays primary). | `WizardFooter.tsx` |
| 5 | "Continue your saved draft?" strip moved from above the footer to above the form. | `CreateProjectWizard.tsx` |
| 6 | Phones: one 56px header row (title plus "Step N of 5 · Label") and a 2px progress line replace the 48px progress row, giving about 46px back to the form. | `WizardHeader.tsx` |
