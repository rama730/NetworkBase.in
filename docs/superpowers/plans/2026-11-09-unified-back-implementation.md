# Unified Back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Going back (in-app arrow, browser back, swipe) returns to the previous page instantly: same scroll, same card, same tab, filters and search, no loading.
- One left-arrow back button sits in the existing top bar, with the approved motion.
- Every scenario in the report is covered.

**Architecture:**
- **History entries.** Each history entry gets a small stamp in `history.state.nb`: id, depth and the page it came from. The stamp powers three things: "is there one of our pages behind?", per-entry scroll memory, and the "Back to …" label.
- **Scroll memory.** One shared hook in `MainLayout` saves and restores each page's `data-scroll-root="route"` box and any named inner areas. It anchors on the card at the top, not on a pixel position.
- **The arrow.** A table of routes decides which pages show the arrow and where it falls back to. The arrow lives in `TopNav`.
- **Tabs, filters and drawers.** Tabs and filters replace the current history entry instead of adding one. Drawers and viewers push an entry marked as theirs, so back closes them.

**Tech Stack:** Next.js 16.4.3 App Router, React 19, TanStack Query, Zustand, Tailwind, lucide-react. Tests run on `node:test` through `tsx`. There is no DOM in unit tests, so tests use pure functions and a fake `window`/`history`. Browser checks use the built-in browser.

**Spec:** `docs/superpowers/plans/2026-11-09-unified-back.md`. Sections 1–15 are the requirements; this plan refers to their item ids (A1–A8, B9–B15, R1–R14). The executor reads both.

**Decided with the user while planning (2026-11-09):**
- **R2:** when back reopens the search, Esc or a click outside closes it. The next back leaves the page, so Forward still works. This changes the report's "back again closes".
- **R5:** Files keeps its folder and file history on every screen size. It's the one exception to "desktop adds no step".
- **R4:** the in-app arrow skips github.com. The browser's own back button may show GitHub once; this is a known limit.

## Global Constraints

- Work on local `main`. Commit locally per task. Never push, never run `db:setup`, never deploy.
- Stage named files only. Never `git add .`, `-A` or `src/`.
- No new dependencies. If one is ever needed, use `npm install --package-lock-only` then `npm ci`, never pnpm.
- Read the relevant guide in `node_modules/next/dist/docs/` before touching Next APIs.
- Arrow icon: lucide `ArrowLeft`, icon only. Accessible name "Back", or "Back to <name>" when known.
  - Desktop: 34px control (`--ui-control-height`). Phone: 44px tap target.
  - Style: `nb-icon-button`. Tooltip: the existing `src/components/ui/tooltip.tsx`.
- Motion:
  - Slot width 0 → 44px. Arrow opacity 0 → 1 with `translateX(-8px → 0)`.
  - Phone: the logo goes `translateX(0 → 8px)` and fades out while the arrow fades in.
  - Timing: 220ms, `cubic-bezier(.2, 0, 0, 1)`.
  - Reduced motion is already handled globally (`globals.css:491–508` and `html[data-reduce-motion="true"]` at 427–458). Use CSS transitions only.
- Storage: every `sessionStorage` / `localStorage` read and write is wrapped in try/catch. Blocked storage means "start at the top / no draft".
- Scroll memory: at most 50 records per tab, oldest dropped. Keys are prefixed `nb-scroll:`.
- The restore wait is up to 1500ms of animation frames. It stops at once on user wheel, touch or keydown.
- Copy:
  - "Review queue" (not "Back to queue").
  - The upload guard asks "An upload is still running. Leave anyway?"
  - The returned-card tint lasts 1000ms.
- Commits: short caveman-commit style, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test commands:
  - one file: `npx tsx --test tests/unit/<name>.test.ts`
  - all unit tests: `npm run test:unit`
  - also `npm run typecheck` and `npm run lint`.

## Review Focus

1. **Raw `history.pushState(null, …)` calls drop our stamp.** Examples: Discover thread, TrustInbox, the dashboard tab switch. The depth must not drift. Task 1 pins this with a "raw push without stamp" test.
2. **Content arrives late.** Network hides its content until `onReady`, Virtuoso renders lazily, and the page cache is cleared after `revalidatePath`. Restore must wait for the anchor, not give up and land at the top. Task 5 and Task 6 test this.
3. **Query parameters from different organization tabs collide.** New names must be unique, and switching tabs must clear them. Task 8 tests this.
4. **The arrow must not become a dead button.** While a guard (profile save, upload) blocks leaving, the arrow must show the guard's question, not fail silently. Task 17 tests this.
5. **Deep links.** With nothing of ours behind the page, the arrow must use the fallback (or the page's registered parent) and never leave the site. Task 2 and Task 1 test this.

---

## Task 0: Baseline numbers (R12 "before")

**Files:** append the numbers to the report as a new section 16 "Measurements".

- [ ] Ask the user to sign in on local dev in the built-in browser. Use the user's running dev server; no temporary routes.
- [ ] Use the `benchmark` skill (or `javascript_tool` timing) on four journeys: Discover, Network, a workspace, someone's profile.
  - For each: open the page, scroll about 3 screens, open a card, press back.
  - Record:
    - the time from back until the anchored card is visible,
    - whether any skeleton or loading screen showed,
    - the scroll position difference in px.
- [ ] Write the table to the report's section 16 under "Before".
- [ ] Commit: `git add docs/superpowers/plans/2026-11-09-unified-back.md && git commit -m "docs(back): baseline back-nav numbers"`

## Task 1: Exact history entries (A7)

**Files:**
- Modify: `src/lib/navigation/in-app-history.ts`. Rewrite it, keeping `canGoBackInApp` and `resetInAppHistory`. Delete the `ponytail:` ceiling note it fixes.
- Modify: `src/instrumentation-client.ts`. Add the `onRouterTransitionStart` export, keeping the Sentry init.
- Modify: `src/components/layout/MainLayout.tsx:26–29`. Stamp on every pathname or search change, using `useSearchParams` alongside `usePathname`.
- Test: `tests/unit/in-app-history.test.ts` (new). Update `tests/unit/chat-phase5-sidebar.test.ts:53–65` to the new API.

**Interfaces (produces):**
```ts
export type HistoryEntry = { id: string; depth: number; from: { path: string; title: string } | null; skip?: number }
export type WinLike = { history: { state: any; length: number; replaceState(s: any, t: string, u?: string): void }; location: { pathname: string; search: string; href: string }; document?: { title: string } }
export function noteTransition(type: 'push' | 'replace' | 'traverse'): void   // called by onRouterTransitionStart
export function stampEntry(win: WinLike): HistoryEntry                         // called by MainLayout after each URL change
export function currentEntry(): HistoryEntry | null
export function canGoBackInApp(): boolean                                       // currentEntry().depth > 0 || !!skip
export function arrivedByTraverse(now?: number): boolean                        // moved from DiscoverClient.tsx:88–95
export function subscribeEntry(fn: (e: HistoryEntry) => void): () => void
export function resetInAppHistory(): void
```

`stampEntry` rules:
- If `history.state?.nb` is present, adopt it. This covers traverse, reload, and native calls that kept our keys.
- If it's absent, decide the navigation type from the pending `noteTransition` type. With none pending (a raw native call), use `history.length` growth since the last stamp: it grew means push, otherwise replace.
  - **push:** `{id: new, depth: prev.depth + 1, from: {path: prev path + search, title: prev title}}`.
  - **replace:** keep the previous id, depth and from.
- Then write it back with `win.history.replaceState({ ...win.history.state, nb: entry }, '', win.location.href)`. Next's patched `replaceState` copies its own internals in (`app-router.js:128–139`).

- [ ] **Step 1: Write failing tests**, using a FakeHistory like `tests/unit/files-tab/url-sync-deep-link.test.ts:72–76`. Test names:
  - `fresh load has nothing behind it`: depth 0, `canGoBackInApp() === false`.
  - `push records depth and from`: depth 1, `from.path === '/discover'`.
  - `traverse back adopts the stored entry`: depth 0.
  - `forward after back adopts depth 1`: fixes the old "forward counts as back" bug.
  - `replace keeps id and depth`.
  - `router.replace that drops nb keeps depth`.
  - `raw pushState(null) with longer history counts as push`.
  - `reload with nb in state adopts it`.
  - `arrivedByTraverse true within 1500ms of a traverse note, false after`.
- [ ] **Step 2:** `npx tsx --test tests/unit/in-app-history.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Add `export function onRouterTransitionStart(url: string, type: 'push'|'replace'|'traverse') { noteTransition(type) }` to `src/instrumentation-client.ts`. Call `stampEntry(window)` in the MainLayout effect, keyed on `pathname + searchParams.toString()`.
- [ ] **Step 4:** Run the test and `tests/unit/chat-phase5-sidebar.test.ts` → PASS. Then `npm run typecheck`.
- [ ] **Step 5:** Commit: `fix(nav): exact in-app history depth per entry`.

## Task 2: Back routes, fallbacks, parents and the shared hook (section 6, B13)

**Files:**
- Create: `src/lib/navigation/back-routes.ts`
- Create: `src/hooks/useBack.ts`. Move it from `src/components/messages/useBack.ts`, delete the old file, and update the imports in `ConversationView.tsx:225` and `ViewScreen.tsx:15`.
- Modify: `src/stores/ui-store.ts` (or wherever `ui-store.ts` lives). Add `backParent: string | null`, `setBackParent`.
- Create: `src/hooks/useBackParent.ts`
- Test: `tests/unit/back-routes.test.ts`

**Interfaces (produces):**
```ts
export const START_PATHS: readonly string[]   // '/discover','/network','/messages','/settings','/my-profile','/my-work','/admin/trust'
export function backTargetFor(pathname: string): { show: boolean; fallback: string }
export function backLabel(from: { title: string } | null): string   // "Back to X" | "Back"
export function shortTitle(docTitle: string): string                 // strip " · NetworkBase", take last remaining " · " segment
export function useBack(fallback: string): () => void                // confirmAppNavigation → skip ? history.go(-skip) : canGoBackInApp ? router.back() : router.push(fallback)
export function useBackParent(href: string | null): void             // sets ui-store backParent while mounted, clears on unmount
```

Route table:

| Route | Arrow | Fallback |
|---|---|---|
| start paths and `/messages/*` | no | none |
| `/workspaces/new` | no | none |
| `/u/*` | yes | `/network` |
| `/my-profile/edit` | yes | `/my-profile`, or `/my-profile?tab=portfolio` when `returnTab=portfolio` (reuse `profileEditReturnHref` in `src/lib/profile/edit-route.ts:23`) |
| `/workspaces/*` | yes | `/discover` |
| `/org/*` | yes | `/discover` |
| `/admin/trust/(cases\|appeals\|people)/*` | yes | `/admin/trust` |
| `/appeal/*` | yes | `/discover` |
| anything else | yes | `/discover` |

The effective fallback is `backParent ?? table fallback`.

- [ ] **Step 1:** Failing tests:
  - `start pages hide the arrow` (each START_PATH)
  - `messages and create workspace hide it`
  - `detail fallbacks match the table`
  - `unknown path shows arrow with /discover`
  - `backLabel` with a title, and with null giving `"Back"`
  - `shortTitle('Tasks · Campus robotics kit · NetworkBase') === 'Campus robotics kit'`
  - `shortTitle('Discover · NetworkBase') === 'Discover'`

  First verify the real title formats from `buildRouteMetadata` (`src/lib/metadata/route-metadata.ts:43–87`) and adjust the expected strings to match.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Register parents:
  - `WorkspaceDashboardClient.tsx`: `useBackParent(parentOrg ? '/org/' + slug : null)`.
  - Child organization pages: the parent organization.
  - Trust detail pages: static, so no registration.
- [ ] **Step 4:** Run → PASS, then typecheck.
- [ ] **Step 5:** Commit: `feat(nav): back route table and shared useBack`.

## Task 3: Every-page contract test (A8, R7)

**Files:** Test: `tests/unit/back-routes-contract.test.ts`. Use the same file-walk style as `tests/unit/org-design-contract.test.ts:10–11`.

- [ ] **Step 1:** Write the test:
  - Walk `src/app/(site)/(main)/**/page.tsx`. Turn each into a sample pathname: drop route groups, replace `[x]` with `sample`.
  - Assert each one is either in `START_PATHS` or matches an explicit detail rule. Reaching the "anything else" default fails the test, with the file name in the message.
  - Assert `OrgBreadcrumb` in `src/components/organizations/OrgHeaderParts.tsx` contains no `Back` text (R7).
- [ ] **Step 2:** Run. It should PASS against Task 2's table; if not, add the missing rule to the table.
- [ ] **Step 3:** Commit: `test(nav): every page has a back decision`.

## Task 4: Arrow in the top bar with motion (section 7, B14)

**Files:**
- Create: `src/components/layout/header/BackButton.tsx`
- Modify: `src/components/layout/header/TopNav.tsx:152–174` (left cluster: desktop slot before `GlobalSearch`, phone swap with `<Logo>`)
- Modify: `src/app/globals.css`. Add `.nb-back-slot`, `.nb-back-arrow`, `.nb-back-logo` and `[data-returned]` rules.
- Test: `tests/unit/back-button-contract.test.ts`

**Interfaces:**
- Consumes: `backTargetFor`, `backLabel`, `shortTitle` and `useBack` (Task 2); `currentEntry` and `subscribeEntry` (Task 1).
- Produces: `<BackButton variant="bar" | "standalone" fallback?: string />`. "standalone" is used by Task 13 outside the top bar.

**Behaviour:**
- **Visibility:** `show` comes from `backTargetFor(pathname)`.
- **Animation:**
  - The slot gets `data-animate` only after the first client navigation, so a fresh load or refresh shows the final state with no transition.
  - Between two arrow pages, or two start pages, `show` doesn't change, so nothing moves.
  - When hidden, the slot is `inert` and `aria-hidden`.
- **Label:** tooltip and `aria-label` are `backLabel(currentEntry()?.from ? { title: shortTitle(from.title) } : null)`.
- **Phone:** the arrow and the logo share one positioned box next to the menu button.

- [ ] **Step 1:** Failing contract test (source regex):
  - TopNav renders `<BackButton`.
  - BackButton uses `ArrowLeft`, `inert` and `useBack`.
  - The globals.css slot transition is `width 220ms cubic-bezier(.2, 0, 0, 1)`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS, plus typecheck and lint.
- [ ] **Step 5: Browser check** (desktop 1280 and mobile 375):
  - Discover → workspace: the slot grows and the search narrows; the row height is unchanged.
  - Back reverses it. Refresh on a workspace: the arrow is there with no animation.
  - Workspace → another workspace: no flicker.
  - With reduce motion emulated: instant.
  - Tab skips the hidden arrow.
  - Take screenshots.
- [ ] **Step 6:** Commit: `feat(nav): top-bar back arrow with motion`.

## Task 5: Shared scroll memory with card anchors (3.1, A4, B9, B10, R10, R11)

**Files:**
- Create: `src/lib/navigation/scroll-memory.ts` (pure)
- Create: `src/hooks/useScrollMemory.ts`. Called once in `MainLayout.tsx`.
- Modify: `src/components/discover/DiscoverClient.tsx`. Delete `SCROLL_KEY`, `cameBackByHistory` and the save/restore effect at `85–95` and `298–336`. Add `data-restore-id={feedItemKey(item)}` on feed items.
- Add `data-restore-id` to representative cards:
  - Network person cards
  - Kanban task cards (`KanbanBoard.tsx`)
  - organization Workspaces tab cards
  - Members rows
  - Messages channel rows
  - Trust inbox rows
- Add `data-scroll-memory="<name>"` to:
  - the Kanban board row, `kanban-board` (`KanbanBoard.tsx:1031`)
  - the Files list, `files-list` (`FolderListView.tsx:1128`; keep its in-memory Map)
  - the Messages sidebar, `messages-sidebar` (`MessagesSidebar.tsx:20`, `ListScreen.tsx:27`)
  - the Trust inbox list, `inbox-list` (`InboxList.tsx:114`)
- Test: `tests/unit/scroll-memory.test.ts`

**Interfaces:**
```ts
export type ScrollRecord = { top: number; anchors: string[]; anchorOffset: number; opened: string | null; areas: Record<string, { top: number; left: number }> }
export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export function saveRecord(store: StorageLike, entryId: string, rec: ScrollRecord): void   // cap 50, oldest dropped, index key 'nb-scroll:index'
export function loadRecord(store: StorageLike, entryId: string): ScrollRecord | null        // never throws
export function chooseAnchors(items: { id: string; top: number; bottom: number }[], viewportTop: number): { anchors: string[]; anchorOffset: number } // first visible + next 4
export function pickAnchor(anchors: string[], exists: (id: string) => boolean): string | null // R10: first that still exists
```

**Hook behaviour:**
- Save the record on scroll, at most once per animation frame, keyed by `currentEntry().id`.
- In a click capture listener, record `opened` as the closest `[data-restore-id]`.
- On an entry change with `arrivedByTraverse()`:
  1. Set the route root's `scrollTop` to `rec.top`. This makes Virtuoso render that region.
  2. For up to 1500ms of animation frames: find `pickAnchor(...)`, then correct `scrollTop` so the anchor sits at `anchorOffset`. Stop after 2 stable frames, or at once on user wheel, touch or keydown. Re-apply once if the anchor moves within the window; this covers a background refetch inserting rows (B11).
  3. Restore the named `areas`.
  4. Focus `opened` with `{ preventScroll: true }` and set `data-returned` on it for 1000ms (B9).
- Any other arrival starts at the top.

- [ ] **Step 1:** Failing tests:
  - `cap keeps the newest 50`
  - `blocked storage: save is a no-op and load returns null` (store throws)
  - `chooseAnchors picks the first visible item and the next four`
  - `pickAnchor skips deleted cards`
  - `pickAnchor returns null when none exist` (pixel fallback)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the module and the hook. Wire them in MainLayout. Remove Discover's copy. Add the attributes and the `[data-returned]` tint CSS: `background: color-mix(in srgb, var(--primary) 6%, transparent)`, no outline.
- [ ] **Step 4:** Run → PASS, plus typecheck and the existing Discover unit tests.
- [ ] **Step 5: Browser check:**
  - Discover deep (3+ "load more") → card → back: same card, same offset.
  - The same check on Network, a workspace Kanban (including horizontal scroll), Files and the Messages sidebar.
  - Keyboard focus lands on the opened card.
- [ ] **Step 6:** Commit: `feat(nav): shared scroll memory anchored on cards`.

## Task 6: No loading screen on return (B11, the Network skeleton)

**Files:**
- Modify: `src/components/network/NetworkClient.tsx:86–88, 199–201`
- Audit: Discover, workspace and profile lists for spinners tied to `isFetching` (keep `isLoading && !data` only)
- Test: `tests/unit/network-initial-skeleton.test.ts`

**Interfaces:** `export function needsInitialSkeleton(wantsData: boolean, hasCachedData: boolean): boolean`, in `NetworkClient.tsx` or `src/lib/network/`.

- [ ] **Step 1:** Failing test: `cached data skips the skeleton` (true, true) → false; (true, false) → true; (false, false) → false.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Start `initialLoadPending` as `needsInitialSkeleton(isAuthed || activeTab === 'suggested', queryClient.getQueryData(<active tab's query key>) !== undefined)`. Take the key from `NetworkPeopleTab`, `ConnectionsClient` and `InvitationsClient`. Remove any `isFetching`-only spinners found in the audit.
- [ ] **Step 4:** Run → PASS. Browser: Network → profile → back shows no skeleton.
- [ ] **Step 5:** Commit: `fix(network): no skeleton when data is cached`.

## Task 7: Tabs and filters replace instead of push (A2)

**Files:** change only these calls from push to replace:
- `WorkspaceDashboardClient.tsx:678` (`pushState` → `replaceState`, passing `window.history.state`, not `null`)
- `NetworkClient.tsx:153, 169`
- `src/hooks/discover/useDiscoverUrlFilters.ts:39–40`
- `DiscoverClient.tsx:155, 602–607` (first filter change)
- `TrustInbox.tsx:69` (filters only)
- `ConsoleHeader.tsx:35`
- `SprintPlanning.tsx:207, 466`, `SprintLeftRail.tsx:56`
- `useWorkspaceSettingsNavigation.ts:76`
- `FilesViews.tsx:267` (view and task filter only)

Files folder and file path pushes in `useFilesTabUrlSync.ts` stay, as the user decided.

Test: `tests/unit/tabs-filters-replace-contract.test.ts`.

- [ ] **Step 1:** Failing contract test. Assert that each listed file/function uses `replace`/`replaceState` at those call sites (regex on the function body). Assert `useFilesTabUrlSync.ts` still pushes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Make the changes. Update the comment at `WorkspaceDashboardClient.tsx:676` to: "A tab click replaces the entry; back leaves the page (unified back A2)".
- [ ] **Step 4:** Run → PASS, plus the related existing tests (Discover filters, workspace tabs).
- [ ] **Step 5: Browser check:** click 4 workspace tabs, then back: you leave the page in one step. Forward returns to the last tab.
- [ ] **Step 6:** Commit: `fix(nav): tabs and filters replace history`.

## Task 8: Page settings live in the address (R3)

**Files:**
- Create: `src/lib/navigation/url-state.ts`
- Create: `src/hooks/useUrlParam.ts`
- Modify (move `useState` to `useUrlParam`):
  - `OrgMembersTab.tsx:79–83, 152–153`
  - `ReviewQueue.tsx:53–59`
  - `AssignmentRoster.tsx:46–50`
  - `OrgFileViews.tsx:48–52, 175–176, 236–237`
  - `TasksTab.tsx:683` (`unitFilter`)
  - `SprintTimelineContent.tsx:49, 60`
- Modify: `clearProjectDetailScopedParams` (find it from `WorkspaceDashboardClient.tsx:671`). Register every new parameter so switching tabs clears it.
- Test: `tests/unit/url-state.test.ts`

**Interfaces:**
```ts
export function patchSearch(search: string, patch: Record<string, string | null>): string   // null removes; keeps order of untouched keys
export function writeUrl(win: WinLike, href: string, mode: 'push' | 'replace'): void         // passes { ...history.state } so nb survives
export function useUrlParam(name: string, fallback: string, opts?: { debounceMs?: number }): [string, (v: string | null) => void] // replace; debounce 300ms for text
```

Parameter names. All are new and must not collide with existing ones:

| Screen | Parameters |
|---|---|
| Members | `mq`, `msort`, `mproject`, `mstatus`, `minv`, `mout`, `mformer` (keep reading the old `project`/`status` once for links already sent) |
| Review queue | `assignment` (now also written), `rqlate`, `rqmine`, `rqq`, `rqsort` |
| Roster | `rosterTile` (now also written), `rtq`, `rtsort`, `rtlate` |
| Org files | `ofstatus`, `ofq`, `ofonly`, `ofsort`, `ofdir`, `ofphase`, `ofstate` |
| Tasks | `team` |
| Sprint timeline | `tlby`, `tlmine` |

- [ ] **Step 1:** Failing tests:
  - `patchSearch adds, replaces and removes`
  - `patchSearch keeps unrelated params`
  - `writeUrl keeps nb in state`
  - `new param names are unique across the list`
  - `tab switch clears every new param` (call `clearProjectDetailScopedParams`)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and convert the screens.
- [ ] **Step 4:** Run → PASS, plus typecheck.
- [ ] **Step 5: Browser check:** on each screen set a search, a filter and a sort, open an item, go back: everything is the same.
- [ ] **Step 6:** Commit: `feat(nav): page settings live in the address`.

## Task 9: Back closes what's open over the page (A3, R5)

**Files:**
- Create: `src/lib/navigation/overlay-history.ts`
- Modify:
  - `TasksTab.tsx:476–546`: open uses `openOverlay`; close uses `closeOverlay`. Deep links keep replace.
  - My work drawer: `MyWorkDrawerHost.tsx` plus `ui-store` `isMyWorkOpen`. Open pushes a marked entry with `my-work=<tab>`; popstate leaving that entry closes it.
  - `src/components/ui/media-viewer.tsx`: open pushes a marked same-URL entry; popstate closes; `handleClose` uses `closeOverlay`.
  - Member drawer in `OrgMembersTab.tsx:86, 284` (`member=<id>`).
  - `TrustInbox.tsx:98–107`:
    - open: wide (≥1024px, `useMediaQuery('(min-width: 1024px)')` from `src/hooks/useMediaQuery.ts`) replaces; narrow uses `openOverlay`;
    - close (now a push at :107) uses `closeOverlay`.
- Leave as they are (already correct): Messages panes `usePanes.ts` (`nbChatDrawer`), Discover thread `useDiscoverUpdateThread.ts`, Files history, Review queue.
- Test: `tests/unit/overlay-history.test.ts`

**Interfaces:**
```ts
export function openOverlay(win: WinLike & { history: { pushState(s: any, t: string, u?: string): void } }, href: string, key: string): void // push { ...state, nbOverlay: key }
export function closeOverlay(win: WinLike & { history: { back(): void } }, href: string, key: string): void // marked entry → back(); else replaceState(href)
export function isOverlayEntry(state: any, key: string): boolean
```

- [ ] **Step 1:** Failing tests:
  - `open pushes a marked entry`
  - `close on our entry goes back`
  - `close on a deep-linked entry replaces`
  - `switching from overlay A to B replaces, so one back closes`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Browser check** (phone and desktop):
  - Each overlay: swipe or back closes it and stays on the page.
  - Close with X, then back: you leave the page in one step.
  - Trust inbox on desktop: picking cases adds no steps.
- [ ] **Step 6:** Commit: `feat(nav): back closes drawers and viewers first`.

## Task 10: Fix the back links and the Edit profile exit (sections 8 and 9)

**Files:**
- `OrgMembersTab.tsx:84, 150`: delete the "‹ Workspaces" link, the `cameFromWorkspaces` state and the `?from=` read. Also remove the `from=` writer in the Workspaces "Place them" link.
- `HandInSection.tsx:160`: delete the link and the now-unused `ChevronLeft` import.
- `ReviewQueueParts.tsx:259, 274–277`: `<a href>` → `next/link` `<Link>`; the text becomes "Review queue".
- `EditProfileEditor.tsx:229–234`: `onClose = () => { allowLeave(); back() }` with `const back = useBack(returnHref)`. Remove `router.replace` and `router.refresh`. The save action already calls `revalidatePath` (`src/app/actions/profile.ts:776–778`), so back shows fresh data.
- Test: `tests/unit/back-links-contract.test.ts`

- [ ] **Step 1:** Failing contract test:
  - no "‹ Workspaces" or `cameFromWorkspaces` in OrgMembersTab;
  - no "Back to the assignment" in HandInSection;
  - ReviewQueueParts has no `<a href` and contains "Review queue";
  - EditProfileEditor's `onClose` has no `router.refresh`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Make the edits.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Browser check:**
  - Edit profile: Save, back shows the new values. Cancel, back shows the profile where you left it. The unsaved-changes warning still works.
  - "Review queue" and "Next waiting" don't reload the browser (the network tab shows no document request).
- [ ] **Step 6:** Commit: `fix(nav): real back for profile edit and review links`.

## Task 11: Back never lands on finished or deleted pages (A5)

**Files** (push → replace; `location.assign`/`href` → `location.replace`):
- `WorkspaceSettingsTab.tsx:1299–1308` (delete workspace)
- `OrgSettingsSections.tsx:166–173` (leave organization or org workspace)
- `AccountDeletionSettings.tsx:31`, `AccountDeletionWizard.tsx:94`
- `LoginForm.tsx:130, 239`
- `SignupForm.tsx:152, 224, 266`
- `WelcomeFlightOverlay.tsx:187, 216, 274`
- `src/app/(site)/(onboarding)/onboarding/page.tsx:432`
- `JoinOrgButton.tsx:29`

Already correct, don't touch: create-workspace close and finish (`CreateWorkspaceRouteClient.tsx:75–77, 92, 110`), `/legal/accept`, conversation exit (`useConversationExit.ts:31–33`), message delete (in place).

Test: `tests/unit/finished-pages-replace-contract.test.ts`.

- [ ] **Step 1:** Failing contract test: each listed site uses `replace`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Edit.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Browser: delete a test workspace, then back: no deleted page. Sign in, then back: not the login page.
- [ ] **Step 6:** Commit: `fix(nav): finished screens leave history`.

## Task 12: Nothing private after sign-out (A6)

**Files:**
- `src/components/providers/AuthProvider.tsx:155–176, ~342`: `location.href = '/login'` → `location.replace('/login')`.
- `SessionsList.tsx:85`: `assign` → `replace`.
- Add a `pageshow` listener in AuthProvider:
  - if `event.persisted`, set `document.documentElement.style.visibility = 'hidden'` synchronously;
  - then `supabase.auth.getSession()`: no session → `location.replace('/login')`, else restore visibility.
- Test: `tests/unit/signout-restore.test.ts`

**Interfaces:** `export function shouldEjectRestoredPage(persisted: boolean, hasSession: boolean): boolean`

- [ ] **Step 1:** Failing test: (true, false) → true; (true, true) → false; (false, false) → false.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Browser: sign out, press back twice. No private content flashes. Test the sign-in step with the user's own account only; never enter credentials yourself.
- [ ] **Step 6:** Commit: `fix(auth): no private page on back after sign-out`.

## Task 13: A way back on every page, and offline (A1, R9)

**Files:**
- `<BackButton variant="standalone" />` in:
  - `src/app/(site)/not-found.tsx`
  - `src/app/global-not-found.tsx`
  - `src/components/legal/LegalDocumentPage.tsx` (next to `<Logo/>`, fallback `/`)
  - `src/app/(site)/admin/notifications/page.tsx` header (fallback `/admin/trust`)
- `src/app/global-error.tsx`: a plain inline-styled button that runs `history.length > 1 ? history.back() : location.assign('/discover')` (no app components there).
- `src/app/(site)/(main)/error.tsx`: when `useOnlineStatus()` (`src/hooks/useOnlineStatus.ts`) is false, show "You're offline. Pages you opened still work when you go back." in place of the generic error text.
- Test: `tests/unit/ways-back-contract.test.ts`

- [ ] **Step 1:** Failing contract test: each listed file contains `BackButton` (or the inline back for `global-error`), and `(main)/error.tsx` uses `useOnlineStatus`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Browser check:**
  - Mobile emulation: every listed page has a way back.
  - Open 3 pages, go offline (DevTools), go back twice: the pages show with the offline indicator.
- [ ] **Step 6:** Commit: `feat(nav): way back on every page`.

## Task 14: Conversation back on desktop when opened from outside Messages (R1)

**Files:** `ConversationView.tsx:537–543`. Test: `tests/unit/conversation-back.test.ts`.

**Interfaces:** `export function cameFromOutsideMessages(from: { path: string } | null): boolean`, in `src/lib/messaging/routes.ts`.

- [ ] **Step 1:** Failing test:
  - `/u/priya` → true
  - `/messages/w/1` → false
  - `null` → false
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** When `cameFromOutsideMessages(currentEntry()?.from)` is true, render the back button without the `lg:hidden` wrapper; it calls `goBack`. Otherwise it stays as today.
- [ ] **Step 4:** Run → PASS. Browser at desktop width: open a conversation page from a notification or a workspace link (not the floating window). The conversation's arrow shows and returns there at the same scroll. Opened from the Messages list, no arrow shows on desktop.
- [ ] **Step 5:** Commit: `feat(messages): desktop back when opened from outside`.

## Task 15: Back to your search results (R2)

**Files:**
- Create: `src/lib/navigation/search-return.ts`
- Modify: `CommandPalette.tsx:149–150, 252–300`. Remember before opening a result; accept `initialActiveIndex`.
- Modify: `TopNav.tsx:68–106`. In `subscribeEntry`, on a traverse arrival, `takeSearchReturn(...)` and then `openGlobalSearch(query, context)` with the active index.
- Test: `tests/unit/search-return.test.ts`

**Interfaces:**
```ts
export type SearchReturn = { entryId: string; query: string; context?: string; activeIndex: number }
export function rememberSearchReturn(store: StorageLike, r: SearchReturn): void   // sessionStorage key 'nb-search-return'
export function takeSearchReturn(store: StorageLike, entryId: string): SearchReturn | null // one-shot; null when the id differs
```

Esc or a click outside closes the search (existing); the next back leaves the page (user decision).

- [ ] **Step 1:** Failing tests:
  - `take returns it once`
  - `wrong entry returns null`
  - `blocked storage returns null`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Browser: search, open the 3rd result, back: the search is open with the same query and the 3rd result highlighted. Esc closes it. Forward still reaches the result.
- [ ] **Step 5:** Commit: `feat(search): back reopens your search`.

## Task 16: Round trips to GitHub (R4)

**Files:**
- Create: `src/lib/navigation/external-return.ts`
- Modify:
  - `src/lib/github/oauth-client.ts:59–139, 145–156`: call `rememberDeparture` before each `location.assign` or provider redirect.
  - `Phase1SourceSelection.tsx:330–363`: the same before the GitHub import.
  - `in-app-history.ts` `stampEntry`: on a fresh document load with no `nb`, call `takeDeparture`; when it returns a skip, set `entry.skip`.
- Test: `tests/unit/external-return.test.ts`

**Interfaces:**
```ts
export function rememberDeparture(store: StorageLike, historyLength: number, now: number): void  // key 'nb-external-departure'
export function takeDeparture(store: StorageLike, historyLength: number, now: number): number | null // skip = historyLength - savedLength (departure index = saved − 1, current index = now − 1); one-shot; null if older than 10 minutes or skip ≤ 0
```

`useBack` (Task 2) already does `history.go(-skip)` when `skip` is set. This assumes no Forward entries existed when leaving, which is normal right after clicking Connect.

- [ ] **Step 1:** Failing tests:
  - `skip lands on the departure entry`: saved 5, now 8 → 3
  - `stale departure ignored`: older than 10 minutes → null
  - `non-positive skip ignored`: saved 8, now 8 → null
  - `one-shot`: a second take → null
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Browser (the user connects GitHub themselves): Settings → connect → return → arrow lands where you were before Settings, not on GitHub. Record the known limit (the browser's own back may show GitHub once) in report section 13.
- [ ] **Step 5:** Commit: `feat(nav): arrow skips GitHub after a round trip`.

## Task 17: Ask before leaving while an upload or save runs (R6)

**Files:**
- Create: `src/hooks/useLeaveGuard.ts`. Generalized from `src/components/profile/edit/useProfileEditNavigationGuard.ts`, which becomes a thin wrapper with the same behaviour.
- Modify: `FileTransfers.tsx:54–63`: `useLeaveGuard(active > 0, 'An upload is still running. Leave anyway?')`.
- `useBack` already goes through `confirmAppNavigation` (`src/lib/navigation/confirm-navigation.ts:9–11`), so the arrow triggers guards.
- Test: `tests/unit/leave-guard-contract.test.ts`

**Interfaces:** `export function useLeaveGuard(active: boolean, message: string, opts?: { blockSilently?: boolean }): { allowLeave(): void; leaveDialog: ReactNode }`

- [ ] **Step 1:** Failing contract test:
  - FileTransfers uses `useLeaveGuard` with the exact message;
  - `useBack` calls `confirmAppNavigation`;
  - the profile wrapper passes `blockSilently` only while saving.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Browser: start a large upload, then press the arrow, browser back and a sidebar item: each one asks.
- [ ] **Step 5:** Commit: `feat(nav): ask before leaving a running upload`.

## Task 18: Clear tab titles everywhere (R8)

**Files:** `useDocumentTitlePrefix` (`src/hooks/useDocumentTitlePrefix.ts`) in:
- `WorkspaceDashboardClient.tsx` (tab label, for workspaces and organizations)
- the Discover thread (`DiscoverClient.tsx`, update title)
- `MyWorkDrawer.tsx` ("My work")
- `TrustInbox.tsx` (case label)

Extend `tests/unit/canonical-route-metadata-contract.test.ts`: every `(main)` `page.tsx` exports `metadata` or `generateMetadata`.

- [ ] **Step 1:** Extend the test → FAIL where a page lacks metadata.
- [ ] **Step 2:** Add the missing metadata with `buildRouteMetadata` and the prefixes.
- [ ] **Step 3:** Run → PASS. Browser: after a few steps, long-pressing the browser back button lists named entries, and the arrow tooltip reads "Back to <name>".
- [ ] **Step 4:** Commit: `feat(nav): clear titles for history and back label`.

## Task 19: Keep typed text (B12)

**Files:**
- Create: `src/hooks/useSessionDraft.ts`
- Use it in:
  - `UpdateComments.tsx:58, 360, 363`: keys `draft:update-comment:<updateId>`, `…:reply:<commentId>`, `…:focused:<commentId>`
  - `TaskDetailTabs/CommentsTab.tsx:421–422`: `draft:task-comment:<taskId>`, `…:reply:<commentId>`
  - `TaskDetailTabs/DetailsTab.tsx:163`: `draft:task-description:<taskId>`, only while editing
- Clear on send, save or cancel.
- Leave the message composer and the workspace update composer alone; they already keep drafts.
- Test: `tests/unit/session-draft.test.ts`

**Interfaces:** `export function readSessionDraft(store: StorageLike, key: string): string | null`, `writeSessionDraft(store, key, value)` (an empty value removes it), and `useSessionDraft(key: string | null, initial?: string): [string, (v: string) => void, () => void]`.

- [ ] **Step 1:** Failing tests:
  - `write then read`
  - `empty removes`
  - `blocked storage returns null without throwing`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run → PASS. Browser: type half a comment, leave, come back: the text is there. Send: the draft is cleared.
- [ ] **Step 5:** Commit: `feat(nav): keep half-typed comments on back`.

## Task 20: Real links, outside links, instant feedback (B15, R13, R14)

**Files:**
- B15:
  - `GlobalSearchResultCards.tsx:81–89`: `div role="option"` → `<Link role="option">`. Keyboard Enter in the palette keeps `router.push`; a click goes through `confirmAppNavigation` and then lets the Link navigate.
  - `MyWorkTasksTab.tsx:110–113, 352`: `<Link>`.
  - `NotificationRow.tsx:142–144`: `<Link>`, keeping the mark-read `onClick`.
- R13: check the update post link renderer at `UpdateContent.tsx:149`. External `http(s)` links get `target="_blank" rel="noopener noreferrer"`; internal links stay in the tab.
- R14: create `src/components/ui/LinkPending.tsx`. It uses `useLinkStatus` and, after 300ms pending, renders a 2px top bar inside the card. Add a `.nb-pressable:active` pressed style in globals.css. Apply both to:
  - `WorkspaceCard`
  - Discover update cards
  - Network person cards
  - search results
  - notification rows
  - My work tasks
- Test: `tests/unit/links-contract.test.ts`

- [ ] **Step 1:** Failing contract test:
  - the three files render `Link`, not `role="button"` / `div` handlers that push;
  - the update link renderer sets `target="_blank"` for external links;
  - `LinkPending` uses `useLinkStatus`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Browser:
  - Cmd-click and middle-click open in a new tab on each.
  - An outside link opens in a new tab.
  - With Slow 3G throttling, a tap shows the pressed state at once and the bar after 300ms.
- [ ] **Step 5:** Commit: `feat(nav): real links and instant tap feedback`.

## Task 21: After numbers, full check, review (R12 "after", section 12)

- [ ] Repeat Task 0's four journeys and write the "After" table in report section 16. Goal: no loading screen and a 0px position difference on all four.
- [ ] Run the full check list in report section 12 and every per-item check in sections 14–15, at desktop 1280 and mobile 375, in light and dark. Note any that couldn't be checked, for example signed-in flows needing the user.
- [ ] Run `npm run test:unit`, `npm run typecheck` and `npm run lint`. All pass, or the failures are reported with their output.
- [ ] Run the `ponytail-review` skill on the diff, apply cuts, then the `review` skill. Fix the confirmed findings.
- [ ] Update the report status to "Built locally 2026-11-xx, not pushed". Update the memory file `project_unified_back.md`.
- [ ] Commit: `docs(back): after numbers and status`.

---

## Self-review

- **Spec coverage:**
  - Section 3.1 → T5. 3.2 / section 8 → T10. 3.3 / section 6 → T2–T4. 3.4 → T5, T8, T19.
  - Section 5 rows → T1, T2, T7, T9, T11, T12, T15, T16, T17, T13.
  - Section 7 → T4. Section 9 → T10. Section 10 → T19, T8. Section 12 → T21.
  - A1 → T13. A2 → T7. A3 → T9. A4 → T5. A5 → T11. A6 → T12. A7 → T1. A8 → T3.
  - B9 → T5. B10 → T5. B11 → T5, T6. B12 → T19. B13 → T2. B14 → T4, T18. B15 → T20.
  - R1 → T14. R2 → T15. R3 → T8. R4 → T16. R5 → T9 (Files keeps history; Review queue and Messages already comply). R6 → T17. R7 → T3. R8 → T18. R9 → T13. R10 → T5. R11 → T5. R12 → T0, T21. R13 → T20. R14 → T20.
  - R15 and R16 need nothing.
- **Known limits carried into the report:**
  - The browser's own back after a GitHub round trip (R4).
  - Expanded sections still reset (section 10).
  - "N new" waiting behind a pill exists only where Discover already polls. Elsewhere the anchored card stays pinned during the restore window instead.
- **Names used across tasks:** `currentEntry`, `subscribeEntry`, `arrivedByTraverse`, `backTargetFor`, `backLabel`, `shortTitle`, `useBack`, `useBackParent`, `StorageLike`, `WinLike`, `writeUrl`, `openOverlay` / `closeOverlay`, `useLeaveGuard`. They are defined once (T1, T2, T5, T8, T9, T17) and used with the same signatures.
