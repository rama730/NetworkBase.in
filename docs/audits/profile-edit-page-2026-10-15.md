# Dedicated Edit profile page — 15 October 2026

Implemented the approved dedicated page with section tabs using the Ponytail workflow. The earlier application-link design work remains untouched. No design prototype, schema migration, dependency or new sharing/messaging system was added.

## Result

`/my-profile/edit?section=general` fills the existing main application content area. The app sidebar and top navigation remain provided by the existing main layout. The My profile sidebar entry stays active on the child route.

The page retains General Properties, Project Contributions, Skills & Expertise, Social Presence and Role Preferences. On desktop, these sections form a vertical left navigation column beside the selected form on the right, following the application navigation pattern. The column stays in place while the form scrolls. Tabs wrap on small screens instead of adding horizontal scrolling. The existing media-query hook keeps Radix keyboard orientation aligned with the layout: Up/Down on desktop and Left/Right on narrow screens. The visible editor header and completion row have been removed; the visible Edit profile page heading now sits at the top of the section navigation, with a divider below and spacing before the tabs, using the workspace heading style. The selected form has its own scrolling area and a slim action row spanning only its own column, with right-aligned controls. Changing sections starts at the top of the next panel. Native Radix keyboard navigation remains available.

Every owner edit affordance in ProfileV2Client now navigates to the dedicated route rather than loading an overlay. About/header opens General; contributions opens Project Contributions; skills, social links and role preferences open their existing section IDs. The existing `EditProfileModal` implementation was moved to `EditProfileEditor`, preserving its form normalization, validation, image upload/finalization, contribution paging, versioned saves, rollback, conflict merging and partial-success error handling. No parallel form or server command was created. Contract checks now reference the renamed file.

The allowlisted `section` query survives direct links and reload. Tab changes use the existing native-history integration to update the URL without fetching the server page or losing the shared draft. `returnTab=portfolio` preserves the profile's Portfolio return context; every other value returns to the fixed `/my-profile` route. No arbitrary return URL is accepted.

Save changes commits the existing profile/contribution operations and returns to the owner profile only on success. Failure or conflict retains the draft; Review latest changes preserves local edits while loading the latest base. Cancel asks before discarding dirty fields. Reset restores the loaded baseline. Editor action buttons use the shared control sizing, including 44px controls on small/touch screens. Editor notifications use the top-right position so they do not cover the page's bottom Save/Cancel controls.

## Authorization and data handling

The new server route authenticates before reading profile data, uses the canonical owner reader with view recording disabled, checks owner identity, and redirects missing/onboarding users through the existing flows. Its metadata is noindex/nofollow/noarchive. The URL takes no target profile ID. The client hides the editor under a different account and requires the matching signed-in actor before save. Existing server action authorization and expected versions remain authoritative.

The initial draft is scoped to a component mount keyed by owner identity. Refreshing props or switching section does not silently overwrite edits. Contribution-load generation checks discard late results after unmount, including development Strict Mode effect cleanup/replay. Private drafts are not written to local/session storage by the application.

## Unsaved navigation

The guard covers ordinary same-window links, Cancel, reload/tab close, browser Back/Forward, and the existing global search/command palette's programmatic route changes. Opening another tab keeps the editor open. Saving disables repeated actions and blocks tested in-app exits until the response settles.

Committed draft flags and the current history snapshot are recorded in a layout effect before the next browser event. Native navigation traversal cancellation is used when it is dispatched before entry change. Engines dispatching after entry change use the popstate fallback, restoring the original framework history state when the user cancels. No global router patch, synthetic history sentinel or third-party navigation package is used. Global search dispatches a cancelable leave-check event before route navigation; without an editor mounted, the event is a no-op. New-tab search results do not unnecessarily prompt.

Refresh/close warnings follow the browser's native rules and require prior user interaction. Network interruption or browser process termination cannot be guaranteed to preserve an in-memory draft. Profile/contribution saves retain their existing multi-operation partial-success behavior; this change does not claim atomicity across those commands.

## Verification

- 44 Chromium/WebKit browser checks passed using the actual profile client, editor, tabs and guard with isolated server/auth/router data. Coverage includes existing availability/preferences/connections/profile layout plus page bounds, no dialog overlay, direct section URLs, reload, draft retention across tabs, mobile wrapping and visible actions, desktop navigation/form placement, vertical and horizontal keyboard navigation, responsive orientation changes and no form overflow at 768/1024/1440px, Cancel/Reset/discard, duplicate-save prevention, conflicts, account changes, Portfolio return and canceled/confirmed Back/sidebar/programmatic search navigation.
- 24 targeted unit checks passed, including the actual compiled editor server route with mocked auth/data boundaries: guests do not read profiles, only the current owner renders, invalid/multiple section values fall back safely, onboarding redirects and private metadata are preserved. Existing profile collaboration/contribution contracts remain in the set.
- Seven additional global-search unit/contract tests passed. TypeScript, scoped lint and the production webpack build passed. The route is registered as a private dynamic user shell with no editor response cache and one delegated form scroll root. No database command was changed, so this task does not introduce a new database fixture or claim a production traffic soak.

The browser fixture uses real native browser navigation events but an isolated router adapter; the production webpack build validates the actual Next route and client integration. Completed browser evidence is Chromium and WebKit.

Commands:

```sh
npx tsc --noEmit
npx tsx --test tests/unit/profile-edit-route.test.ts tests/unit/profile-role-layout-contract.test.ts tests/unit/profile-collaboration.test.ts tests/unit/profile-contribution-visibility-contract.test.ts
npx playwright test --config tests/browser/playwright.config.ts profile.spec.ts --project=chromium --project=webkit
NEXT_DIST_DIR=.next-profile-edit-page-check npm run build
npm run check:profile-contributions
npm run check:query-key-contract
npm run check:global-search-contract
npm run check:canonical-logic-contract
npm run check:scroll-contract
npm run check:impact-review
```


Repository validation: profile-contribution, query-key, global-search, canonical-logic, head, page-performance and impact-review checks passed. The scroll checker validates the new route through its actual `EditProfileTabs` scrolling container. Its remaining failure is pre-existing: `src/components/projects/EditProjectModal.tsx` contains `scrollbar-none` in HEAD and is outside this change. No allowlist was widened and that unrelated project editor was not modified.

## Left navigation refinement

The first follow-up changed the editor section layout and its responsive keyboard orientation, reusing the existing media-query hook. The 44-check Chromium/WebKit profile suite, scoped ESLint and TypeScript checks passed after the refinement; the production build evidence above belongs to the preceding dedicated-page implementation.

## Compact editor shell refinement

Removed the entire visible Edit profile header, description, back-button and completion row. The section column now uses `--nb-sidebar-width`, the existing `nb-nav-link` styles and matching inset spacing; it follows the main sidebar density rather than oversized tab styling. The section column fills the available height. The Save/Cancel, Reset, error and discard controls live in the right-hand column in a slim, plain row outside the form scroller, spanning only the right-hand column. The former rounded corner panel and left border have been removed. The loading skeleton follows the same column layout.

The screenshot also showed the floating chat launcher covering Save. The existing route visibility helper now suppresses that launcher/window while on `/my-profile/edit`; its state remains intact for return navigation. No conversation layout, message behavior or chat data flow changed.

Validation: all 44 Chromium/WebKit profile checks and 30 focused unit checks passed, along with TypeScript and scoped ESLint. Browser assertions compare the editor navigation width and button dimensions/styles with the application-navigation fixture; verify the header is absent, the navigation extends to the bottom and the slim action area stays in the form column; and exercise mobile dirty, failed-save and discard states without covering form content. The production build evidence above belongs to the original dedicated-page implementation.

The navigation-heading/action-row follow-up passed four focused Chromium/WebKit checks (desktop geometry, heading/divider/tab order, plain full-column action row, keyboard navigation, responsive widths and mobile dirty/error/discard states), TypeScript and scoped ESLint.

The final design-token audit and its corrections are recorded in `docs/audits/profile-edit-design-conformance-2026-10-15.md`.
