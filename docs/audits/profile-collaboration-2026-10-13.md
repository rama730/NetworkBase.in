# Profile connections and collaboration availability

Implemented with local Ponytail 4.10.0. No new dependencies.

## Root causes and cuts

- The configured database had two profiles with stored count 0 and two actual accepted connections each. Profile headers trusted the projection; network totals counted relationships. Reuse one authoritative aggregate in both surfaces, counting accepted relationships in either direction with active peers.
- Both collaboration edit entry points routed to Skills & Expertise. Reuse the editor section type and route them to the existing Role Preferences tab.
- Availability was inferred from role lists/capacity. Replace that inference with one persisted boolean. The existing accessible settings switch serves both the header and editor.
- Preference-only saves no longer reload project contributions. The role card now shows custom roles and categories.

## Saved flow

Role Preferences owns the draft availability switch, roles, custom titles, categories, experience and capacity. Save publishes them together; discard preserves the last saved state. The header quick toggle submits availability and its expected timestamp only. The role card pencil opens the role tab; the header has no duplicate preference-edit link. A pause preserves preferences, removes the public badge/opportunity card, and leaves ordinary networking and explicit applications alone. New users may enable general collaboration without role selections.

Duplicate requests are prevented while saving. Failed quick saves restore the displayed state. Failed editor saves retain drafts. Concurrent writes follow the existing timestamp conflict guard. Review latest changes keeps the draft edits and loads other saved fields; retry writes only edited fields. Private or blocked profiles expose no collaboration availability or role card. A paused candidate loses project-role recommendation boosts immediately in reads and worker computations, but stays eligible for networking.

## Database rollout

Migration 0218 adds a boolean, backfills legacy visible availability once, defaults new profiles to false, and repairs compatibility counters from accepted relationships. Replays preserve an explicit pause. Deploy the schema before application code. Previous migrations remain unchanged.

## Verification

Unit checks cover false preservation, snake/camel normalization, boolean validation and privacy projections. Disposable database checks cover migration replay/defaults, authoritative counts, atomic preference saves, conflicts and paused recommendation pagination. Browser checks render the production profile/editor/modal components with substituted backend calls; they cover navigation, save/discard, quick toggles, failures, conflicts, custom roles, paging/search, mobile layout and visitor privacy. These browser checks do not claim production authentication or deployment verification.

## Configured database verification

Applied only migration 0218 and its counter reconciliation, with the registered checksum and index, under the migration advisory lock. Both `ch_rama` and `ramanayudu_ch` now have stored connection count 2. The active-profile counter mismatch count fell from 2 to 0. Other pending migrations were not applied.

Chromium and WebKit each passed all eight browser scenarios. Firefox hung during headless launch and was stopped; no Firefox pass is claimed. The repository contains concurrent unrelated changes, so global check failures outside this scope are reported separately from focused profile validation.

Final checks: production webpack build and TypeScript passed; scoped ESLint passed; 54 focused unit checks, 7 disposable database checks and 16 Chromium/WebKit browser checks passed. Profile contribution, query-key, canonical-logic and scoped impact-review contracts passed. Repository-wide migration governance reports the unrelated `0216_project_members_user_role_idx` file missing from the journal/manifest. The data-shape contract reports existing component violations in messaging, presence and task comments. Application code has not been deployed by this task.


## UI refinement from the owner screenshot

Removed the duplicate header edit link and persistent paused/saved messaging. The Role preferences title stays constant in both availability states. The card uses definition-list rows in one 96px-label / flexible-value grid: Role types, Desired roles, Categories, Experience, Weekly hours. Unset fields are omitted; multiple values stack in their own value column; long custom titles wrap without clipping. Desktop card insets are 20px, mobile insets 16px, row gaps 12px, and compact text uses the shared 13px/1.5 role from design specification sections 04, 05, 09 and 17.

Weekly hours use a compact display while retaining the full label for assistive technology. Editor language matches the summary and explains that turning availability off keeps preferences, without suggesting unsaved drafts have already been saved. The card pencil is the edit entry point; Save/Cancel, failure rollback and conflict review continue unchanged. General collaboration remains possible without selected roles.

Visitor actions use the existing Button component in full-width rows with 44px touch targets. Their layout follows the card width rather than a viewport breakpoint; absent callbacks do not leave an empty action area.

UI refinement verification: 20 Chromium/WebKit browser scenarios passed, including label/value column geometry at 280px and 320px, long titles, full-width visitor actions, and mobile overflow. The 13 focused profile/role unit checks and scoped ESLint passed. Visual captures were inspected at `/tmp/nb-role-preferences-desktop.png` and `/tmp/nb-role-preferences-mobile.png`. Full typechecking initially passed, then concurrent create-project wizard edits introduced unrelated errors in `CreateProjectWizard.tsx` and `useCreateProjectWizard.ts`; no profile errors were reported. The global whitespace check also reported a trailing blank line in the unrelated `src/lib/utils/project-ids.ts`.

Follow-up alignment: selected values align to the card's inner right edge, with each label vertically centered beside its value group. Chromium and WebKit checks passed for actual text-edge alignment, centered rows and wrapping at 280px and 320px; scoped ESLint passed.

## Profile header space and status placement

The owner status control now sits beneath the collaboration switch. Desktop identity and actions occupy the first grid row; location, connection/project counts, website and skills span the card beneath the avatar, following the Network person-card use of lower space. Mobile keeps identity and details together before the actions. Visitor status remains beside identity. Long saved statuses wrap within the action column, and the relocated control retains the status-picker callback.

Browser geometry checks cover 1440px, 1024px and 390px, the status-picker callback, long saved statuses and visitor controls. All 22 Chromium/WebKit profile scenarios and six profile layout unit checks passed; scoped ESLint passed. Inspected desktop and mobile captures at `/tmp/nb-profile-header-1440.png` and `/tmp/nb-profile-header-390.png`.

Spacing refinement (14 October): reduced the details margin from 16px to 8px and desktop action gaps from 10px to 6px. This removes 16px of excess space beneath the avatar in the usual owner header while preserving separation. The Chromium/WebKit geometry checks now enforce a maximum 24px avatar-to-details gap at desktop widths; both passed, along with scoped ESLint.

Tab scrollbar correction (14 October): removed the tablist's `overflow-x-auto` and legacy `scrollbar-none`. Horizontal auto overflow also makes vertical overflow auto, creating an unnecessary scroll container around the tab buttons. The two tabs now use normal visible overflow. Chromium/WebKit checks at 1440px, 1024px and 390px verify neither axis scrolls, both tabs fit, click switching works and arrow-key navigation retains focus; scoped ESLint passed.

## Approved visitor status badge (14 October)

Visitor profiles now display a saved personal status immediately after the collaboration badge in the identity row. The badge reuses the shared status shape with neutral styling, sentence case and wrapping. Presence text is omitted from visitors' headers; the existing avatar indicator retains its accessible label and native hover tooltip. Saved statuses remain independent of automatic presence and collaboration availability. Empty statuses leave no badge, and locked shells omit the personal-status component. Own-profile status controls remain beneath the collaboration switch. Existing server status audience and expiry filtering continue to supply the same presence hook.

All 26 Chromium/WebKit profile checks passed. The visitor regression renders the production avatar indicator and covers automatic presence states, tooltip labels, independent status/collaboration, emoji-only and text-only statuses, absent statuses, locked shells and long unbroken text at 1024px, 390px and 320px. Fifty profile/presence/social unit checks, scoped ESLint and scoped whitespace checks passed. Actual component captures were inspected at `/tmp/nb-profile-visitor-status-desktop.png` and `/tmp/nb-profile-visitor-status-mobile.png`. No new dependencies or database changes.
