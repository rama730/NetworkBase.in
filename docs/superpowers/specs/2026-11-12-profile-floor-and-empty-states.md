# Profile empty states — end-to-end design (v2)

Date: 2026-11-12 · Status: design agreed, not built · Trigger: Vijay Kumar's profile (@vijay23) looks blank to others.

## 0. What was decided

- **Onboarding stays as it is.** No new required fields, so nobody is blocked for lacking an experience level or skills.
- **Front-end only.** No migration, no gate, no server change.
- **The owner sees every section.** Empty sections show one prompt each.
- **Visitors see only what exists, plus two cards that are always there** (About and Details). The page never ends in blank space.
- Dropped from v1: the required minimum, the onboarding reorder, the finish-profile gate, the Discover exclusion and "View as others".

## 1. Rules

1. **Owner sees every section.** Each empty one has one sentence and one button that opens the right edit section.
2. **Visitors see only filled sections**, except About and Details, which are always shown.
3. **A fact appears in one place only.** The header already shows location, skills, website, mutual connections and presence, so no card repeats them.
4. **One rule, one place.** The person subtitle fallback is `personCardSubtitle`, and completion is `calculateProfileCompletion`. Surfaces call these instead of writing their own checks.

## 2. Gaps found in the current code

| # | Gap | Where | Fix |
|---|---|---|---|
| G1 | About disappears for visitors when there is no bio, so the main column is empty | `sections/AboutCard.tsx:18` | About is always shown (§3.2) |
| G2 | Right column is empty for visitors when there are no roles, organizations or links | `ProfileV2Client.tsx`, `ProfileRightRail.tsx` | New **Details** card, always shown (§3.3) |
| G3 | Experience level, weekly availability and interests reach the visitor but show nowhere unless "Open to collaborate" is on | `privacy/profile-views.ts` sends them; no component shows interests at all | Details card shows them |
| G4 | "0 connections 0 projects" reads as a dead account. "projects" is the old word: the tab and cards say workspaces | `ProfileHeader.tsx:278,287` | "New member · joined Nov 2026" for visitors when both are 0; label becomes "workspaces" |
| G5 | Local time shows on the hover card but not on the profile | `PersonHoverCard.tsx` uses `usePersonContext` | Details card shows local time with the same rule |
| G6 | Owner with no links gets no prompt; the Links block just disappears | `ProfileRightRail.tsx` (`links.length > 0 ? … : null`) | Owner sees an empty Links block with "Add links" |
| G7 | Completion items are plain bullets, not links | `ProfileRightRail.tsx` | Each item opens its edit section |
| G8 | Mobile completion prompt names the next item but always opens General | `ProfileHeader.tsx:340` (`onClick={onEdit}`) | Opens the section of the item it names |
| G9 | Owner prompts look like part of the public page. Owners can't tell which parts visitors don't see | All owner empty cards | One small line on owner-only prompts: "Only you can see this" |
| G10 | Request rows, application cards, the likers list and the invite picker show a bare name when there's no headline | `RequestProfileRow.tsx:35`, `messages/cards/ApplicationCard.tsx:169`, `WorkspaceUpdateLikersModal.tsx:182`, `InviteCollaboratorModal.tsx` (candidate row) | Use `personCardSubtitle` |
| G11 | The loading skeleton doesn't have the new cards, so the page jumps when it loads | `ProfileRouteSkeleton.tsx` | Add About and Details placeholders |
| G12 | Local time comes from a server action that may refuse signed-out visitors | `getPersonContext` | Row hidden when there's no data. Never an error |

## 3. The profile page

### 3.1 Header

| Item | Visitor | Owner |
|---|---|---|
| Name, @username, presence, headline, location, skills, website, mutual connections | Unchanged; each already hides when empty | Unchanged |
| Counts, both 0 | **"New member · joined Nov 2026"** (from `createdAt`) | "0 connections · 0 workspaces" (unchanged, apart from the word) |
| Counts, either above 0 | "3 connections · 0 workspaces" | Same |
| Mobile completion prompt | — | Opens the section of the item it names (G8) |

The headline gets no fallback in the header. The location is already one line below, and repeating it would break rule 3.

### 3.2 About card (main column, Overview tab)

| State | Visitor | Owner |
|---|---|---|
| Has bio | Bio (unchanged) | Bio and the edit pencil (unchanged) |
| No bio | **"Vijay hasn't written an introduction yet."** in muted text, one line, with no icon or button | "Add a bio to tell others about yourself" and **Add bio** (exists), plus "Only you can see this" |

Name rule: first word of the full name; if there is no full name, `@username`.

About holds only the person's own words. Facts go in Details. This is a change from the earlier draft, which put facts in About and repeated what the header already shows.

### 3.3 Details card (new; right column on desktop, below About on phones)

One small card, `RailSection` titled **Details**. Each row shows only when it has a value:

| Row | Source | Example |
|---|---|---|
| Experience | `experienceLevel` → label from `EXPERIENCE_LEVEL_OPTIONS` | Student |
| Availability | `hoursPerWeek` → label from `WEEKLY_CAPACITY_OPTIONS` | 5–10 hours a week |
| Interests | `interests` → labels from `INTEREST_OPTIONS`, as plain chips (`nb-tag`) | Design · Open source |
| Local time | `usePersonContext(id).timeZone`, shown **only when it differs from the viewer's** (same rule as the hover card) | 9:04 PM local time |
| Joined | `createdAt` | Joined November 2026 |

- **Joined is always present**, so the card is never empty for a profile anyone can open.
- **Owner:** missing Experience, Availability and Interests rows show as "Add experience level" and the like, linking to `profileEditHref('opportunity')` or `profileEditHref('skills')`. Local time is not shown to the owner, since it's their own clock.
- **Placement:** first item in the `highlights` slot of `ProfileShell`, so on phones it comes right after About (CSS order 3), before Contributions.
- **Locked or private shell:** not rendered. That shell already hides the right column, and `createdAt` is null there.

### 3.4 Other sections

| Section | Visitor when empty | Owner when empty | Change |
|---|---|---|---|
| Open to roles | Hidden | Prompt (exists) | Add "Only you can see this" |
| Organizations | Hidden | Prompt (exists) | Same |
| Contributions | Hidden | "No workspace contributions" and **Add contribution** (exists) | Same |
| Links | Hidden | **New:** "Add your GitHub, LinkedIn or site." and **Add links** → `profileEditHref('social')` | G6 |
| Portfolio tab | "No public workspaces have been published yet." (exists) | "Workspaces you create or contribute to will appear here." (exists) | Header word only (G4) |

### 3.5 Profile completeness (owner)

- Same scoring, same items (`calculateProfileCompletion`). No weight change.
- Each missing item becomes a link. One map in `src/lib/profile/edit-route.ts`, `completionItemSection(item)`:
  - photo, name, username, headline, bio, location, website → `general`
  - skills → `skills`
  - social link → `social`
- The rail shows the first 3 items (unchanged). The mobile header prompt uses the same map (G8).

## 4. What Vijay's profile looks like to a visitor after this

Header: photo, name, @vijay23, location, **New member · joined Nov 2026**, Figma chip, Accept.
Main: **About**: "Vijay hasn't written an introduction yet."
Right: **Details**: Joined November 2026 (plus experience, availability, interests or local time if he has them).

It's still a thin profile, but it no longer looks broken, and every line on it is true.

## 5. Outside the profile page

`personCardSubtitle` (`src/lib/network/person-card.ts:51`) is already the right chain: headline → portfolio → location → @username. It stays as it is, and these surfaces start using it:

| Surface | File | Rule |
|---|---|---|
| Connection request rows (Network, workspace launcher) | `RequestProfileRow.tsx` | Subtitle from the helper. Show the separate location line only when the subtitle isn't already the location |
| Application card in messages | `messages/cards/ApplicationCard.tsx` | Subtitle from the helper |
| Who-liked list | `WorkspaceUpdateLikersModal.tsx` | Subtitle from the helper |
| Invite picker candidate row | `InviteCollaboratorModal.tsx` | Subtitle from the helper |
| Person cards, Discover rail | `PersonCardContent.tsx` | Already uses it |
| Hover card | `PersonHoverCard.tsx` | Leave as it is; it has its own working order (location first) |
| Application review | `ApplicationReview.tsx` | Leave as it is; it already shows headline · location |

Where a surface only has `headline` in its data, check during the build that `location` and `username` are already in the row. If a query doesn't select them, add them to that select. This is the only place the work could touch a server file.

## 6. Every state, checked

| State | Visitor | Owner |
|---|---|---|
| Nothing optional filled | Header + About line + Details (Joined) | Header + every card with its prompt + completeness |
| Some fields filled | Filled sections + About + Details | All sections, filled or prompting |
| Everything filled | Everything | Everything, completeness says complete |
| Signed out | Same as visitor; local time hidden if the action refuses | — |
| Private or connections-only (no access) | Existing locked shell, no About or Details | — |
| Blocked | Existing blocked shell | — |
| Loading | Skeleton has header, tabs, About and Details blocks (G11) | Same |
| A card throws | Existing `ComponentErrorBoundary` per card; add one around Details | Same |
| Dark mode, phone width | Uses existing tokens and `RailSection` | Same |

## 7. Files

| File | Change |
|---|---|
| `src/components/profile/v2/sections/AboutCard.tsx` | Visitor empty line instead of `return null`; owner "Only you can see this" |
| `src/components/profile/v2/sections/DetailsCard.tsx` | **New**, about 60 lines, built on `RailSection` |
| `src/components/profile/v2/ProfileV2Client.tsx` | Put DetailsCard first in `highlights`, inside an error boundary |
| `src/components/profile/v2/ProfileHeader.tsx` | "New member" line, "workspaces" word, mobile prompt section |
| `src/components/profile/v2/ProfileRightRail.tsx` | Owner empty Links, completion items as links |
| `src/lib/profile/edit-route.ts` | `completionItemSection()` |
| `src/components/profile/v2/ProfileRouteSkeleton.tsx` | About and Details placeholders |
| `OpenToRolesCard.tsx`, `ProfileOrganizationsSection.tsx`, `WorkspaceContributionsCard.tsx` | "Only you can see this" on the owner empty state |
| `RequestProfileRow.tsx`, `ApplicationCard.tsx`, `WorkspaceUpdateLikersModal.tsx`, `InviteCollaboratorModal.tsx` | `personCardSubtitle` |

No new dependency, no migration, no new API.

## 8. Tests (written before the change)

1. **Profile render, visitor, empty profile:** About line and Details "Joined" are present; no Links, Roles, Organizations or Contributions cards.
2. **Profile render, owner, empty profile:** every section shows its prompt, and each prompt links to the right edit section.
3. **Details rows:** each row shows only with its value, and local time shows only when it differs from the viewer's.
4. **`completionItemSection`:** every string `calculateProfileCompletion` can return maps to a section. This fails if someone adds an item without a mapping.
5. **`personCardSubtitle`:** the existing tests cover the chain; add one test for the request row so the location isn't shown twice.

## 9. End-to-end check after the build (signed in, two browsers)

1. Visitor opens Vijay's profile → header, "New member", About line, Details. No blank right column on desktop. On a phone, Details sits under About.
2. Vijay opens his own profile → every section prompts; "Only you can see this" on the hidden ones; each prompt and completion item opens the right edit section; mobile prompt opens the named section.
3. Vijay adds a bio → visitor's About shows it; the line is gone.
4. Network → his request row shows location (or @username), not a bare name.
5. Private profile → locked shell unchanged.
6. Signed out → same as visitor, no errors in the console.

## 10. Out of scope

- Required onboarding fields, gates and Discover filtering (decided against).
- "View as others" (decided against).
- Changing the completion weights.
- The OG image and share preview: the share preview already falls back to the page description. Check the OG image during the build and only change it if it shows a bare name.
