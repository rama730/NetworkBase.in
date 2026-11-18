# One motion and detail system for every NetworkBase page

Date: 18 Nov 2026. Status: report for review. Nothing designed or built yet.
Builds on: `2026-11-18-grid-auth-404-report.md` (locked grid, sign-in, 404) and `2026-11-18-marketing-redesign-concept.md` (home page).

## 1. Summary

The marketing page set a level of craft the user wants everywhere. The recommendation is to carry the **craft** to every page but scale the **motion** to how the page is used:

| Level | For | Motion | Craft |
|---|---|---|---|
| **Showcase** | Pages seen once or rarely: marketing, sign-in, 404 and errors, first-run onboarding, public faces | Full: load sequences, decoding labels, pixel words, the trail, scroll reveals | Full |
| **Moments** | Real events in the app: a task done, a sprint finished, a merge, a first workspace | One short, earned animation, once, after the server confirms | Full |
| **Work** | Screens people use for hours: tasks, files, messages, settings, dashboards, admin | Calm and fast: 150ms state changes on one curve; no trails, no reveals, no load sequences | Full: the same type, path lines, colours, grid, spacing, crisp edges |

One set of tokens and rules serves all three, so the app reads as one product.

## 2. What exists today (audited 18 Nov 2026)

- **58 page routes** across five groups: site and marketing, auth, main app, onboarding, legal.
- **No motion library.** No framer-motion or similar. Motion is CSS: `tw-animate-css` (`animate-in` 33 uses, `animate-out` 9), Tailwind `animate-spin` (140, spinners), `animate-pulse` (21), `animate-ping` (3).
- **23 keyframes in `globals.css`**: presence badge (11), typing dots (2), message `send-fly`, auth step, `nb-welcome-in`, `nb-signin-rise`, story expand, skeleton shimmer, link pending, `nb-returned`.
- **Durations are scattered:** 75, 100, 130, 150, 180, 200, 220, 300, 400, 500, 600, 700 and 980ms all appear. Tailwind `duration-150` is the most common (38).
- **Four easings:** `(.2,.8,.3,1)` ×10, `(.2,0,0,1)` ×4, `(.45,.05,.2,1)` ×3, one spring `(.34,1.56,.64,1)`. The marketing work uses `(.16,1,.3,1)`.
- **Confetti** (`canvas-confetti`) in two places: the workspace onboarding modal and network invitations. It doesn't match the pixel language.
- **Reduced motion:** 12 `prefers-reduced-motion` blocks in `globals.css`, but not every animation is covered.

**Finding:** there is no shared motion system. Each feature picked its own duration and curve. Unifying the tokens is the first job, before any new motion.

## 3. The three levels

### 3.1 Showcase
- Allowed: the locked grid trail, pixel words, the orange square flying in, decoding mono labels, one orchestrated load sequence (under 1.5s), scroll reveals (0.6s, 24px, once), the button ring.
- Rules: content is readable at once (reveals start from visible, or finish within 0.9s); the load sequence never blocks input; reduced motion shows the final state; touch screens get no trail.

### 3.2 Moments
- Allowed: one animation per real event, 300–900ms, drawn from the pixel language (pixels, the ring, the orange square, the six colours).
- Rules: only for the person who did the action; only after the server confirms; never blocks the next action; at most one moment every 2 seconds; never on bulk actions beyond a single summary; reduced motion shows a static confirmation.

### 3.3 Work
- Allowed: 150ms colour and opacity changes, 220ms panels and menus, 300ms for larger layout changes, skeleton shimmer while loading.
- Not allowed: trails, reveals on scroll, staggered lists longer than 8 items, decoding text, load sequences, looping animation except spinners and presence.
- Craft that carries over: the type scale, mono path lines in headers, the six colours for labels and chips, the quiet grid on empty states (Subtle preset), the focus ring, tabular numbers, crisp 1px hairlines.

## 4. Every page, sorted

| Group | Route | Level | What it gets |
|---|---|---|---|
| Marketing | `/` | Showcase | The marketing prototype (artifact U69rCV4K, version 3) |
| Marketing | `/help/running-a-class` | Showcase-lite | Path line, serif title, reveals on first view only |
| Marketing | `/open-source`, `/support`, `/security-reporting` | Work (reading) | Path line header, calm |
| Docs | `/docs/cli`, `/docs/agents`, `/docs/agents/tools`, `/docs/files/branches`, `/docs/files/changes` | Work (reading) | Path line, mono code blocks with Copy, no motion |
| Legal | `/privacy`, `/terms`, `/cookies`, `/copyright`, `/dpa`, `/eula`, `/acceptable-use`, `/grievances`, `/subprocessors`, `/legal/accept` | Work (reading) | Calm; long-form reading type |
| Auth | `/login` (with sign-in code and two-step), `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/device`, `/authorize`, `/join`, `/join/[code]` | Showcase | Locked panel (pixel word, serif headline, `nb login` chip on sign-in) |
| Auth | `/cli/verify` | — | Redirect only |
| Errors | 404 (site and global), `(main)/error`, `(auth)/error`, `(onboarding)/error`, `global-error`, Messages inline 404 | Showcase | Locked 404; errors get the same layout with OOPS and Try again |
| Onboarding | `/onboarding`, `/workspaces/new` (wizard), organization creation | Showcase (first run) | Short entrance, pixel progress, a moment on finish |
| Public faces | `/u/[username]`, `/org/[slug]` (public view), `/join/[code]` preview | Showcase-lite | Path line, serif name, one-time reveal, the quiet grid behind the header |
| Browse | `/discover`, `/network` | Work, with moments | Calm lists; a moment when a connection is accepted or a role applied for |
| Daily work | `/my-work` | Work | Path line header, moments on task done |
| Workspace | `/workspaces/[slug]` and its tabs: overview, tasks, files, docs, updates, sprint, dashboard, members, settings, changes, branches, merge requests, review, assignments, calendar | Work, with moments | Calm; moments on done, merged, sprint finished, change set applied |
| Organization | `/org/[slug]` (member view): overview, workspaces, members, files, docs, sprints, review queue, assignments, settings | Work, with moments | Calm; moments on hand-in approved and assignment published |
| Messages | `/messages`, `/messages/[channelId]`, `/messages/drafts`, `/messages/inbox`, `/messages/new`, `/messages/saved`, `/messages/search`, `/messages/w/[workspaceId]`, `/messages/w/[workspaceId]/browse` | Work | Keep the existing send and typing motion, unified to the tokens |
| Profile | `/my-profile`, `/my-profile/edit` | Work | Calm; public view rules apply to `/u/[username]` |
| Settings | `/settings`, `/settings/agents/[id]` | Work | Calm |
| Admin | `/admin/notifications`, `/admin/reports`, `/admin/trust`, `/admin/trust/cases/[number]`, `/admin/trust/appeals/[number]`, `/admin/trust/people/[handle]`, `/appeal/[number]` | Work (strict) | No decoration at all; speed and clarity only |

## 5. Moments, tied to real actions

Each moment fires after its server action succeeds. Action names are from `src/app/actions`.

| Event | Action | Moment | Where |
|---|---|---|---|
| Task moved to Done | `updateTaskStatusAction` | 6–10 pixels in the six colours pop from the card's corner and fade (400ms) | Task board, My work |
| Task review approved | `approveTaskReviewAction` | The pixel ring runs once around the card (600ms) | Review lanes |
| Hand-in submitted | `submitAssignmentAction` | A pixel check assembles in the status chip | Assignment (student) |
| Hand-ins approved | `approveAllSubmittedAction` | One summary moment: the count ticks up in mono, no per-row effects | Review queue (teacher) |
| Hand-ins returned | `returnCopiesAction` | Calm confirmation only (returning is not a celebration) | Review queue |
| Sprint finished | `completeSprintAction` | The sprint bar fills cell by cell and the orange square lands at the end (900ms) | Sprint tab |
| Merge request merged | `mergeMergeRequest` | Two pixel lines (branch and main) join into one (700ms) | Merge request view |
| Change set applied | `applyChangeSetAction` | Changed files tick in, one per 40ms, capped at 12 | Changes view |
| Workspace created | `createWorkspaceAction` | The orange square flies into the new workspace's title (replaces confetti) | Wizard finish |
| Organization created | `OrganizationCreatedScreen` | The organization's initials assemble as a pixel word | Created screen |
| Onboarding finished | `completeOnboarding` | The HEY-style pixel word with the person's first initial; then straight to work | Onboarding end |
| Connection accepted | `acceptConnectionRequest` | A short pixel bridge between the two avatars (500ms) | Network, invitations (replaces confetti) |
| Joined an organization | `joinOrganizationAction`, `acceptOrgInviteAction` | The organization's colour square flies into the sidebar | Join flow |
| Application accepted | `acceptApplicationAction` | The ring around the new member's card | Workspace members |
| First update posted | `createWorkspaceUpdateAction` | First time only: the post settles with the orange square | Updates tab |
| Message sent | existing `send-fly` | Keep, retimed to the tokens | Messages |

**Deletion:** with the pixel moments in place, `canvas-confetti` and `@types/canvas-confetti` can be removed.

## 6. The shared detail system

### 6.1 Motion tokens (one file, replaces the scattered values)
```
--nb-ease:          cubic-bezier(.16, 1, .3, 1)   one curve for entering and moving
--nb-ease-exit:     cubic-bezier(.4, 0, 1, 1)     short exits only
--nb-dur-instant:   0ms      (reduced motion)
--nb-dur-fast:      150ms    colour, opacity, hover, press
--nb-dur-base:      220ms    menus, popovers, panels, tabs
--nb-dur-slow:      300ms    layout changes, drawers
--nb-dur-moment:    600ms    moments (up to 900ms for sprint finished)
--nb-dur-showcase:  900ms    showcase reveals and load sequences
```
Spinners, presence and typing dots keep their loops but use these curves.

### 6.2 Craft that every page shares
- **Type:** Instrument Sans for UI; Instrument Serif only for showcase headlines and public names; JetBrains Mono for paths, labels, meta and code; tabular numbers wherever digits line up.
- **Path line headers:** `networkbase / design-studio / tasks` in mono at the top of work pages, replacing ad-hoc breadcrumbs; the last part in the foreground colour; no blinking cursor on work pages.
- **The grid:** Hero grid on showcase pages; the Subtle grid only on empty states in the app (as locked); never behind lists or forms.
- **Pixel language:** the brand square, pixel words and the ring are reserved for showcase and moments, so they stay special.
- **Colour:** the six pixel colours for labels, chips and moments; clay stays the action colour.
- **Hairlines and edges:** 1px borders, sharp pixel edges snapped to device pixels, one focus ring.
- **Loading:** one skeleton shimmer (the existing `nb-skeleton-shimmer`), retimed; no spinners over 1 second without text.

### 6.3 Rules for every level
1. Animation never delays content or input.
2. Reduced motion gets the final state everywhere, including moments.
3. Only `transform` and `opacity` animate; no layout properties.
4. No invented data inside any animation.
5. One easing curve, the durations above, nothing else.
6. Off-screen animation stops.

## 7. Budgets

| | Showcase | Moments | Work |
|---|---|---|---|
| Canvases on the page | up to 6 | 0 at rest, 1 during a moment | 0 (1 on an empty state) |
| Longest single animation | 1.5s load | 900ms | 300ms |
| Looping animation | trail, band | none | spinners and presence only |
| Main-thread time for motion | under 4ms a frame | under 2ms | under 1ms |
| Interaction to next paint | under 200ms | under 200ms | under 100ms |

## 8. Rollout

| Phase | Work | Done when |
|---|---|---|
| P0 Tokens | Add the motion tokens; move every duration and easing in `globals.css` and components onto them; cover every animation with reduced motion | One curve, the listed durations, no stray values (a lint check counts them) |
| P1 Showcase | Build the locked sign-in pages, 404 and errors; then the marketing page | Matches the prototypes; reduced motion and touch checked |
| P2 First run and public faces | Onboarding, workspace wizard, organization created, `/u/[username]`, `/org/[slug]` public, join preview | One entrance each; moments on finish |
| P3 Moments | The 16 moments in section 5, one shared `pixelMoment()` helper; remove confetti | Each fires once, after success, with a static fallback |
| P4 Work polish | Path line headers, unified skeletons and empty states, hover and focus timing, per area: workspace, organization, messages, my work, settings, admin | Every work page uses the tokens and the path line; no new motion added |
| P5 Measure | Before and after numbers for each phase (benchmark skill), signed-in checks | Budgets in section 7 met |

## 9. Risks and open questions

- **Overlap with the workflow-tabs plan** (147 units, approved 18 Nov): its work pages should adopt P0 tokens and P4 path lines as they are built, rather than being polished twice. Decide whether P0 lands first.
- **Moments can get noisy.** Frequency guards are in section 3.2; the list in section 5 should be trimmed if any feels like too much in use.
- **Instrument Serif on public faces** (profiles, organization pages) is new there; confirm.
- **Admin stays strict**: no moments, no decoration.
- **Removing confetti** changes two existing celebrations; the pixel replacements need to feel as rewarding.

## 10. Next step

One prototype of a real work page in the calm-but-crafted style, with two moments wired in, so the Work and Moments levels can be judged before the plan is approved. Suggested page: the workspace overview with its task board (task done → pixel pop; sprint finished → bar fill).
