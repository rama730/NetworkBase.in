# NetworkBase application design-conformance audit

**Audit date:** 2026-09-10  
**Repository:** `/Users/chrama/Downloads/nb-s3`  
**Specification:** `docs/design/networkbase-application-design-specification.html`  
**Method:** static source audit, specification-led implementation, supplied screenshot comparison, and automated contract verification  
**Implementation boundary:** code-only review and implementation, per the user’s instruction; no browser automation was used

## 1. Baseline assessment

The baseline audit found NetworkBase **partially conformant**. Its global design foundation is substantially aligned with the specification, but feature components frequently bypass that foundation. At the time of the initial scan, the visible difference between the Dashboard's **Journey** and **Open Roles** headings is a representative symptom:

- `DashboardCard` renders card headings at `text-xl` (20px), so Open Roles inherits a 20px title.
- `JourneyTimeline` implements its own header and renders Journey at `text-base` (16px).
- The specification defines card titles at **17px/1.28**, section titles at **20px/1.28**, and section-header icons at **18px**.

The correct repair is to give both cards one shared header contract at 17px and reuse it throughout the project dashboard. A one-off adjustment to either heading would leave the same inconsistency elsewhere.

No release-blocking functional defect was identified in the baseline design pass. The highest-risk design debt was systemic: primitive typography does not encode the specification, arbitrary 9–10px text is widespread, and raw neutral/accent utilities prevent a single token change from producing a consistent result.

## 2. Implementation result

The audited design debt has been remediated at the shared-system and application-surface levels. The earlier findings below are retained as the baseline record that drove the changes.

- The application now maps its global type scale to the specification: 11, 12, 13, 15, 17, 20, 24, 30, 38, 48, and 60px, with the specified line heights. Shared page, section, card, body, compact, UI, metadata, micro-label, icon, and empty-state roles are available.
- Button, input, card, tabs, dialog, avatar, stacked-avatar, tooltip, and empty-state primitives now use the required type, radius, control-height, icon, and motion contracts.
- Neutral Tailwind palettes resolve through the NetworkBase semantic drafting-table palette, allowing legacy feature classes to inherit the specification without page-by-page color forks.
- Journey and Open roles use the same dashboard-card header anatomy: 17px title, 18px section icon, 20px horizontal inset, consistent actions, and a shared separator.
- Dashboard, Docs, Updates, Sprints, Tasks, Files, Analytics, and Settings retain their behavior and scroll ownership while using the normalized type, spacing, icon, control, empty-state, and motion roles.
- Profile, Hub, People, Messages, account settings, authentication, onboarding, the sidebar, and top navigation inherit the same scale and shared control anatomy.
- The unsupported 9px/10px application text was removed. A current scan reports no authored UI text below 11px. All 530 remaining arbitrary text declarations are on the approved scale or are non-font token values; 442 are the 11px micro role.
- `transition-all`, pulse, bounce, scale/spring stepper motion, and legacy feature durations were removed or replaced with named-property motion using the approved 80/130/180/260/340ms rhythm. The typing indicator remains an intentional activity affordance and respects global reduced-motion handling.
- The broken integrations fallback link now points to the Hub, and the mobile menu control retains its accessible name and full touch target.

### Verification completed

- ESLint: passed with zero errors (one pre-existing unused-disable warning in `src/lib/redis.ts`).
- TypeScript: passed with `tsc --noEmit`.
- Theme, appearance, scroll, profile-contribution, and document-head contracts: passed.
- Focused project-detail/profile/sidebar/settings/files contracts: 26/26 passed.
- Dashboard/settings/top-navigation follow-up contracts: 19/19 passed.
- Production compilation and its TypeScript phase passed. Final page-data collection could not complete because Next.js reported an absent generated `pages-manifest.json` in both the default and isolated dist directories; source compilation and the build TypeScript phase passed before that tooling-stage failure.
- The full unit-suite audit was run. Its remaining failures are historical behavioral/source-string contracts outside this design implementation, including mutually incompatible integration-card expectations; they are recorded as repository test debt rather than hidden by changing tests.

## 3. Audit scope and evidence limits

The audit covered:

- the application shell, sidebar, top navigation, global search, notifications, overlays, and responsive shell behavior;
- Hub/Discover and project cards;
- Network/People and person cards;
- profile header, Overview, Portfolio, and right rail;
- Messages page and popup surfaces;
- account settings and project settings;
- authentication and onboarding surfaces;
- the project-detail header and all eight tabs: Dashboard, Docs, Updates, Sprints, Tasks, Files, Analytics, and Settings;
- shared primitives for buttons, inputs, cards, tabs, tooltips, dialogs, and avatars;
- typography, spacing, radii, borders, elevation, motion, icons, responsive behavior, and state presentation.

The current tree contains **345** `.tsx` files under `src/app` and `src/components`, including 132 project, 29 chat, 22 account-settings, 16 profile, 10 people, 5 Hub, and 14 layout files.

This was a code-only audit, per the user's instruction. It does not claim pixel verification at every breakpoint, complete keyboard testing, screen-reader certification, or inspection of every data/permission branch. The supplied screenshot was used only as visual evidence for the reported dashboard mismatch.

## 4. Governing design contracts

The specification establishes these relevant contracts:

| Category | Required contract |
|---|---|
| Font families | Instrument Sans for interface/content; JetBrains Mono for metadata and micro labels |
| Page title | 30px/1.28, weight 600, `-0.015em` tracking |
| Section title | 20px/1.28, weight 600 |
| Card title | 17px/1.28, weight 600 |
| Body | 15px/1.5 |
| Compact copy | 13px/1.5 |
| UI label | 13px/1.2 |
| Metadata | JetBrains Mono, 12px/1.35, tabular numerals |
| Micro label | JetBrains Mono, 11px/1.2, `0.09em`, uppercase |
| Literal type scale | 11, 12, 13, 15, 17, 20, 24, 30, 38, 48, 60px |
| Core spacing | 0, 1, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 112px |
| Common gaps | 8px controls, 12px stacks, 16px grids, 24px major columns, 32px major groups |
| Insets | 20px cards, 24px panels/pages, 16px mobile |
| Radii | 3px badge, 5px control, 8px card, 12px dialog, 18px marketing |
| Control heights | 28, 34, and 42px; 44px minimum touch target on coarse pointers |
| Avatars | 20, 26, 34, 48, and 72px, with squared 5px/8px corners |
| Icons | Lucide; 14px dense, 16px controls, 18px section headers, 24px empty states; 1.75 stroke |
| Borders/elevation | 1px borders, 2px active underline, flat content cards |
| Motion | 80/130/180/260/340ms with `cubic-bezier(.2,.8,.3,1)`; no pulse, bounce, spring, shimmer, or scale motion |
| Content width | Paragraphs generally limited to 64ch |

The 224px expanded and 64px collapsed application sidebar are treated as approved product deviations because they implement the user's later explicit sidebar requirements. The wider Updates and Dashboard right rails are also treated as approved page-specific adaptations, provided their outer insets and column gaps remain consistent.

## 5. What is already conformant

The foundation should be preserved:

1. `src/app/layout.tsx` loads the local Instrument Sans, JetBrains Mono, and Instrument Serif assets.
2. `src/app/globals.css:309-315` establishes the correct 15px/1.5 body typography.
3. `src/app/globals.css:119-216` provides coherent light/dark semantic color, control-height, inset, row-height, and shell tokens.
4. `src/app/globals.css:840-888` correctly defines the wordmark, micro and metadata styles, 30px page titles, 17px project-card titles, tags, status badges, icon buttons, and the global Lucide 1.75 stroke.
5. `src/app/globals.css:362-410` provides both a user-controlled reduced-motion mode and `prefers-reduced-motion` fallback.
6. `src/app/globals.css:895-908` implements the desktop shell, 16px mobile inset, 24px mobile page title, and 44px coarse-pointer targets.
7. `src/components/projects/ProjectCard.tsx:73-109` uses the shared 17px project-card title, status, tag, metadata, avatar, and footer contracts.
8. `src/components/projects/dashboard/ProjectLayout.tsx:264-476` keeps all eight tabs, proper tab keyboard behavior, per-workspace scroll ownership, 64ch project summary, 180ms shell motion, and a 2px active tab underline.
9. `src/components/ui/tooltip.tsx:8-54` is close to the tooltip contract: 130ms delay, 12px copy, 3px radius, 7px/4px padding, and no arrow.
10. `src/components/profile/v2/ProfileHeader.tsx:215-300` now uses the specified 72px squared avatar, 30px identity title, mono metadata, status badge, and clickable connection/project counts.

## 6. Prioritized findings

### P1-01 — Typography roles are not encoded in shared primitives

The core primitives use Tailwind defaults rather than the specification's literal roles:

- `src/components/ui/button.tsx:8-31` uses `text-sm` (14px) instead of the 13px UI-label role.
- `src/components/ui/card.tsx:31-46` uses an 18px card title and 14px description instead of 17px and 13/15px.
- `src/components/ui/input.tsx:5-15` switches between 16px and 14px instead of the 15px body or 13px control role.
- `src/components/ui/tabs.tsx:21-50` uses 14px labels instead of 13px.
- `src/components/ui/dialog.tsx:115-137` uses an 18px title and 14px description.

**Impact:** every feature must override the primitive to comply, and most do not. This is the primary cause of cross-page drift.

**Required correction:** introduce named typography utilities or component variants for page, section, card, body, compact, UI, metadata, and micro roles. Make the compliant role the primitive default.

### P1-02 — Dashboard right-rail headers use incompatible component contracts

- `src/components/projects/dashboard/DashboardCard.tsx:35-52` renders Open Roles through a 20px heading with a 16px icon.
- `src/components/projects/dashboard/JourneyTimeline.tsx:101-125` renders Journey through a separate 16px heading with a 16px icon.
- Both headers use 8px icon-wrapper corners, while a control-sized wrapper should use the 5px control radius.

**Impact:** the two adjacent cards look unrelated despite having the same hierarchy, exactly as shown in the supplied screenshot.

**Required correction:** extract or reuse a single dashboard-card header with a 17px/1.28 title, 18px icon, 20px horizontal inset, 16px vertical inset, 8px title/icon gap, consistent actions, and a 1px separator. Journey must use this shared header.

### P1-03 — Unsupported 9px and 10px text is widespread

The static scan found **527 arbitrary text-size declarations across 125 files**. The largest groups are 226 uses of 11px, 201 uses of 10px, and 23 uses of 9px. The specification's literal scale starts at 11px.

Concrete examples:

- `src/components/projects/dashboard/JourneyTimeline.tsx:174-188` uses a 9px Current label and a 10px custom tooltip.
- `src/components/projects/dashboard/OpenRolesCard.tsx:152-175` uses 14px role titles, 9px state badges, and 11px attribute tags; the role title should be 17px and the state badge no smaller than 11px.
- `src/components/ui/StackedAvatars.tsx:17-44` uses 10px avatar initials and a 9px overflow count.
- `src/app/globals.css:868` reduces collapsed-sidebar count badges to 9px.
- `src/components/projects/tabs/AnalyticsTab.tsx:148-179` uses a 10px eyebrow with nonstandard tracking.

**Impact:** small labels lose legibility and visual rhythm, particularly on iPad, zoomed layouts, and lower-density displays.

**Required correction:** migrate 9/10px UI text to the 11px micro role, 12px metadata role, or 13px compact/UI role. Preserve smaller sizes only inside user-provided media.

### P1-04 — Feature code bypasses semantic color and surface tokens

The source scan found roughly **7,420 direct neutral utility references across 233 files** and **1,340 direct blue/purple references across 120 files**. The largest concentration is the project-detail area: about 4,687 neutral and 1,015 blue/purple references across 132 files.

High-density owners include GitHub sync, project settings, Updates, Files workspace headers, task details, profile editing, and message composers. Some neutral names are currently remapped globally, but direct feature ownership still prevents reliable theme or palette changes.

**Impact:** dark-mode parity, state contrast, and future token changes require editing many components; similar states can render differently.

**Required correction:** use `background`, `card`, `muted`, `foreground`, `muted-foreground`, `border`, `input`, `ring`, `primary`, and status tokens. Keep raw colors only for third-party branding, user content, charts with documented series semantics, and approved problem/solution status surfaces.

### P1-05 — Radius and elevation rules are bypassed in feature components

The scan found **414 `rounded-xl`/`rounded-2xl`/`rounded-3xl`/`rounded-full` occurrences across 134 files** and **63 medium-or-heavier shadow occurrences across 45 files**. Pills are legitimate for tags and status values, but they are also used for tabs, buttons, panels, empty-state wrappers, and editor controls.

Examples:

- `src/components/projects/tabs/AnalyticsTab.tsx:160-179` implements navigation as filled pill buttons.
- `src/components/projects/tabs/UpdatesTab.tsx:2552-2566` renders Load more as a pill rather than a 5px-radius control.
- `src/components/profile/v2/sections/Card.tsx:35-42` uses an 8px radius for a small icon button.
- `src/components/settings/SettingsLayout.tsx:25-48` uses 8px radii for navigation rows and icon wells.

**Impact:** dense product tools appear softer and heavier than the drafting-table reference.

**Required correction:** centralize `badge=3`, `control=5`, `card=8`, `dialog=12`, and `marketing=18`; reserve full pills for tags/status groups and circular geometry for status dots or round avatars explicitly required by product content.

### P1-06 — Icon anatomy is globally close but locally inconsistent

The code uses Lucide consistently—203 source files import it—and `src/app/globals.css:887-888` correctly enforces a 1.75 stroke. The remaining issue is local sizing and framing:

- card-header icons vary between 16px and 20px rather than 18px;
- empty-state icons often use 32px instead of 24px;
- some icon-only controls use 12–14px icons without the shared icon-button primitive;
- several decorative icons omit `aria-hidden`, while some icon-only buttons correctly include accessible labels;
- third-party logos are generally preserved and should remain outside Lucide normalization.

**Required correction:** add `dense`, `control`, `section`, and `empty` icon roles and make shared icon-only controls responsible for size, focus, disabled state, and accessible naming.

### P1-07 — Motion uses unsupported timings and broad transitions

The scan found **81 `transition-all` uses across 44 files**, with concentrations in Open Roles, project-edit dialogs, login, task controls, and settings. Five source sites reference pulse animation, including the sidebar project skeleton at `src/components/layout/AppSidebar.tsx:124-129`. Theme and dialog transitions use 200ms `ease` at `src/app/globals.css:347-355` and `src/components/ui/dialog.tsx:33-72`; the specified nearest token is 180ms with `cubic-bezier(.2,.8,.3,1)`.

**Impact:** transitions animate unintended properties and the product does not share one motion rhythm.

**Required correction:** replace `transition-all` with named properties, use the specified timing/easing tokens, and replace repeated pulse with static or one-pass shape-aware loading states. Keep reduced-motion behavior intact.

### P1-08 — Empty-state and recovery presentation is fragmented

- `src/components/projects/tabs/DocTab.tsx:50-59` uses 32px padding, a 32px icon, an 18px title, and a solid card, instead of the 24px icon, 17px title, maximum 24px inset, and prescribed empty-state treatment.
- Sprint and Files surfaces contain additional one-off empty/loading states with different icon wells, copy sizes, borders, and action geometry.
- Some failures use inline red cards, others toasts, and others return blank/null states.

**Required correction:** use one EmptyState/RecoveryState contract with 24px icon, 17px heading, 13/15px copy, optional standard action, and explicit retry/permission/offline variants.

## 7. Project-detail tab audit

| Tab | Status | Findings | Required disposition |
|---|---|---|---|
| Dashboard | **Major drift** | Journey is 16px, Open Roles is 20px, role titles are 14px, Current is 9px, tooltip is 10px; overview uses 24/28px insets, a 14px uppercase sans heading, 14px statement titles, 20px column gaps, and an 18px rail stack gap. | Unify right-rail headers at 17px; use 18px header icons and shared tooltip; make overview heading either a 20px section title or 11px mono micro label; normalize insets/gaps. Preserve the approved 360–420px rail. |
| Docs | **Moderate drift** | The reader's max-width/300px rail and scroll ownership are correct. The unavailable state is oversized. Quick Console and document chrome contain many 9–11px custom labels and raw neutral/accent colors. | Keep reader/editor behavior; normalize empty state, toolbar typography, control radius, tooltips, and rail tokens. Do not restyle rendered user document content as application UI. |
| Updates | **Moderate drift** | The 24px grid and approved 320–380px rail are sound. Project Feed is 18px instead of a 20px section title; summary is 14px instead of 13/15px; rail uses off-scale 28px padding; Load more is a pill; local animations use 200ms and broad transition patterns. | Use 20px section heading, 13px compact summary, 24px rail inset/gap, 5px controls, and 180ms named-property motion. Preserve the wider right rail and collapsed-sidebar alignment. |
| Sprints | **Moderate drift** | The planning split uses a 220px rail and 20px major gap; empty states use 32px icons and 18px titles; primary actions are about 40px high with 8px corners. | Change the major gap to 24px, normalize empty states, and use 34/42px controls with 5px corners. Preserve scheduling and close-out behavior. |
| Tasks | **Major drift** | `src/components/projects/v2/TasksTab.tsx:708-758` adds a redundant nested header card, constrains a wide board to `max-w-5xl`, uses a 20px “Task Board” title, 14px summary, 8px buttons, and a 300ms transition. Labels use title case (“New Section”, “New Task”). | Remove the nested decorative header/card, keep the board wide, place filters/actions in the project tool toolbar, use 13px UI labels, 5px controls, 180ms motion, and sentence case. |
| Files | **Major drift** | Scroll/workspace ownership is strong, but this is the largest style-debt area: about 123 arbitrary sizes, 1,337 raw neutral references, 377 raw accent references, 35 large/pill radii, and 11 heavy shadows across 44 files. GitHub sync and workspace headers are the primary owners. | Preserve the explorer, leases, deep links, workers, transfers, and IDE handoff. Normalize only the application chrome: header, breadcrumbs, rows, toolbar, side rail, dialogs, status, empty/loading/error states. |
| Analytics | **Major drift** | `src/components/projects/tabs/AnalyticsTab.tsx:148-180` duplicates a page header inside the tab, uses a 10px eyebrow with `0.28em` tracking, 12px description, and pill buttons with `aria-pressed` instead of the shared underline tab contract. | Use a 20px section title and 13px summary, remove redundant framing, implement semantic tabs with the shared underline treatment and roving keyboard behavior, and use chart tokens for series colors. |
| Settings | **Major drift** | `src/components/projects/tabs/ProjectSettingsTab.tsx:2044-2090` has the correct max width but a 20px major gap. `SectionHeader` at 3282–3318 uses a 24px title, 12px sans eyebrow with `0.22em` tracking, 14px description, and an extra card. Many subforms use pill choice buttons and raw blue/zinc colors. | Use 24px major gap, 20px section titles, 11px mono micro labels, 13/15px descriptions, shared field/control primitives, and semantic state tokens. Keep all 13 current settings sections and permission/recovery logic. |

## 8. Application-wide surface audit

| Surface | Status | Findings and disposition |
|---|---|---|
| Application shell | **Mostly conformant** | Correct fixed shell, 56px top bar, 224/64px sidebar, 32/44px nav rows, 13px labels, active state, focus, and accessible collapse control. Fix the 9px collapsed count, pulse skeleton, 160ms `ease` shell transition, and raw fallback colors. |
| Top navigation | **Moderate drift** | Structure and iPad visibility behavior are correct. `src/components/layout/header/TopNav.tsx:129-227` uses 14px action labels, raw border/hover colors, circular avatar-loading fallback, and 8px radius on mobile/sign-in controls. Normalize to 13px labels, semantic colors, squared avatar fallback, and 5px controls. |
| Hub/Discover | **Mostly conformant** | `HubHeader` uses the shared 30px page title and project cards use the shared 17px anatomy. Subtitle and select use 14/16px instead of 13/15px, and the select is 40px instead of 34/42px. Normalize those primitives; preserve filters and virtualized loading. |
| Network/People | **Moderate drift** | Person/relationship flows are present, but person cards and request/application states use mixed 14/16/18px copy, direct relationship colors, and inconsistent control radii. Move identity metadata to 12px mono, card titles to 17px, descriptions to 13/15px, and relationships to semantic status tokens. |
| Profile | **Mostly conformant** | The identity header and 1060px shell are close. `ProfileShell` uses approved 320px rail but 20px column gap instead of 24px. Profile section cards use 18px or compact 14px headings, 16px icons, and 8px icon buttons. Normalize all profile card headers to 17px/18px and major columns to 24px. |
| Portfolio | **Mostly conformant** | Project card anatomy is shared with Discover in the main implementation. Verify that all portfolio variants use `nb-project-card`; eliminate any older ProjectsGridCard-specific typography and image fallback divergence. |
| Messages | **Major drift** | The messaging surface owns correct local scrolling and bespoke bubbles, but the 29 files contain about 67 arbitrary sizes, 651 raw neutral references, 49 direct accent references, 79 large/pill radii, and 7 heavy shadows. Normalize the conversation rail, thread header, composer, attachment controls, reaction controls, loading, and empty states while preserving bubble identity, realtime, virtualization, and outbox behavior. |
| Account settings | **Major drift** | `SettingsPageHeader` is correctly 30px but descriptions are 14px. `SettingsSectionCard` uses 16px headings, 14px descriptions, and 24px responsive padding where 17px/13–15px/20px are required. Navigation rows and icon wells use 8px corners. Fix shared settings components first; most sections will inherit the repair. |
| Auth and onboarding | **Moderate drift** | Layout foundations and focus behavior are present, but surfaces retain custom 14/16px controls, large radii, raw colors, 200ms transitions, and selectable-card variants. Normalize shared form, step, alert, and action primitives without changing auth, Turnstile, or onboarding state. |
| Dialogs, popovers, and global overlays | **Moderate drift** | `Dialog` has the correct 12px centered radius and 24px inset, but overlay/content share `z-50`, transitions use 200ms, and titles/descriptions use 18/14px. Set an explicit overlay/content layer pair, use 180ms motion, and 17px/13–15px typography. Tooltip is already close and should replace custom feature tooltips. |

## 9. Spacing and responsive findings

1. Major two-column layouts frequently use 20px gaps (`gap-5`) even where the normalized specification calls for 24px. The project body, profile main/rail, Docs reader, Dashboard, and project settings should use one named major-column gap.
2. Off-scale 28px spacing appears through `p-7`/`pl-7`; use 24px or 32px according to hierarchy.
3. Several components add their own centered `max-w-*` container inside an already constrained route container. Tasks is the clearest example. This creates inconsistent left edges and wasted width when the sidebar collapses.
4. Shell offset is correctly tied to `--nb-sidebar-width` and `--nb-sidebar-collapsed-width`. Page containers should remain centered inside the resulting main frame and must not add a second sidebar-sized offset.
5. Coarse-pointer targets are globally raised to 44px, which is correct. Components with explicit fixed heights can still override that protection and require migration to the shared control variables.
6. Tool tabs correctly own local scroll regions in ProjectLayout, Docs, and Files. Updates and Dashboard remain page-scrolling views. This scroll ownership should be retained during visual cleanup.

## 10. Accessibility and content findings

Positive evidence:

- global focus-visible outlines are present;
- project tabs implement keyboard navigation;
- sidebar collapse controls expose labels, `aria-controls`, and `aria-expanded`;
- many decorative Lucide icons are hidden from assistive technology;
- reduced-motion handling exists globally.

Gaps:

1. Some decorative icons in ProfileHeader, DashboardCard, Journey, and settings lack `aria-hidden`.
2. Analytics' inner view switcher uses pressed buttons rather than tab semantics, so arrow-key behavior and selected-tab relationships are absent.
3. Some icon-only feature controls rely on `title` without a consistent accessible label.
4. Text at 9/10px is an accessibility concern even when contrast is adequate.
5. Uppercase UI copy is overused outside the 11px mono micro-label role. Examples include “Vision & Description,” project-settings section labels, and some analytics/status treatments.
6. Interface actions should use sentence case: “New task,” “New section,” “Project feed,” and “Open roles,” while proper nouns remain capitalized.
7. Custom smooth scrolling in feature code must observe the same reduced-motion preference used by the shell.

## 11. Static drift inventory

The following counts are migration signals, not a claim that every occurrence is a defect:

| Pattern | Count | Interpretation |
|---|---:|---|
| Arbitrary `text-[…]` declarations | 527 / 125 files | 9/10px values are definite violations; 11/12/13/15px should move to named roles |
| Direct neutral utilities | ~7,420 / 233 files | Most should move behind semantic surface/text/border tokens |
| Direct blue/purple utilities | ~1,340 / 120 files | Review for state semantics or third-party exceptions |
| Large/full radius utilities | 414 / 134 files | Keep real tags/status/circles; normalize controls and cards |
| `transition-all` | 81 / 44 files | Replace with explicit properties |
| Medium-or-heavier shadows | 63 / 45 files | Content cards should remain flat |
| Gradient references | 12 / 7 files | System decoration should be flat; user media is exempt |
| Backdrop blur references | 50 / 33 files | Review overlays; drafting-table surfaces should remain solid |
| Pulse references | 5 / 3 files | Replace repeated pulse loading with compliant loading states |

## 12. Root-cause remediation plan

The repair should proceed in this order:

1. **Encode the specification in primitives.** Add named typography, icon, spacing, radius, and motion roles. Correct Button, Card, Input, Tabs, Dialog, Avatar, StackedAvatars, EmptyState, and icon-button defaults.
2. **Unify shared feature headers.** Create a card-header contract used by Dashboard, Profile, Settings, rail cards, and recovery surfaces. This directly fixes Journey/Open Roles.
3. **Normalize the project shell and eight tabs.** Fix Dashboard first, then shared project toolbars, empty/recovery states, and each tab in the order Tasks, Analytics, Settings, Updates, Sprints, Docs, Files.
4. **Migrate high-traffic application surfaces.** Hub, People, Profile, Messages, account settings, auth, and onboarding.
5. **Remove token bypasses.** Replace raw colors, unsupported font sizes, radii, shadows, and broad transitions; document the small set of legitimate exceptions.
6. **Run visual and interaction acceptance.** Validate light/dark and default/compact/comfortable density at 360, 390, 768, 1024, 1280, 1440, and 1920px; test 200% zoom, coarse pointer, keyboard, reduced motion, loading, empty, error, offline, forbidden, and destructive states.

## 13. Acceptance criteria

The audit can be considered remediated when:

- adjacent cards with the same hierarchy use the same title, icon, inset, action, and separator contract;
- no application-authored UI text is below 11px;
- page, section, card, body, compact, UI, metadata, and micro roles are traceable to named utilities or primitives;
- controls use the 3/5/8/12/18 radius system and 28/34/42px height system;
- feature code does not use raw neutral/accent colors unless the exception is documented;
- Lucide icons use the prescribed 14/16/18/24 sizes and the global 1.75 stroke;
- content cards are flat and use 1px borders;
- motion uses only named properties, approved durations/easing, and reduced-motion fallbacks;
- every project-detail tab retains its behavior, data, permission, recovery, and scroll contracts;
- every registered route passes the specified viewport, theme, density, zoom, keyboard, and state matrix.

## 14. Disposition

The screenshot issue is confirmed. Journey and Open Roles differ because they are rendered by separate header implementations with 16px and 20px titles. The target is a shared 17px card-heading contract with an 18px icon. The same primitive-level correction should be applied before page-by-page polish; otherwise the application will continue to accumulate one-off typography and spacing fixes.

