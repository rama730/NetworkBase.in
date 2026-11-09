# Unified back: report

Date: 2026-11-09
Status: built locally 2026-11-09 (plan T1–T20 committed on local main, not pushed). Browser check 2026-11-09: back journeys measured and fixed; some flows still unchecked (§16).

---

## 1. What was asked

1. Going back (in-app back button, browser back button, trackpad or phone swipe) must **not** reload the page. It must work like the Amazon app: you return to the page you came from instantly, with no loading, at the same scroll position, with the same cards, search and filters.
2. A page reloads **only** when the user asks for it:
   - refreshing the browser,
   - clicking an item in the left sidebar (for example NetworkBase → Network),
   - clicking the same button again on the page.
3. One simple back button across the app. Not over-designed, just a back icon.
4. Analyse the whole app: where the back button is missing, and where it goes.
5. The back button must **not** add a new row to the header. It sits in the existing row.
6. The back button must **not** be an X.
7. No fake or duplicate back controls.
8. A smooth animation: when you open a page that has the back button (for example a workspace from Discover), the top search bar narrows smoothly and the back button appears in the freed space. Going back reverses it.

---

## 2. How this Next.js version behaves (checked in `node_modules/next/dist/docs/`)

- Next.js 16.4.3.
- Going back or forward always reuses the page data Next.js already has in memory. No server request (glossary, "Client cache"; `staleTimes.md`: "doesn't change back/forward caching behavior").
- Normal link clicks and `router.push` load the page fresh (from v15 onward, pages aren't reused from the cache on link navigation).
- `next.config.ts` already has `experimental.scrollRestoration: true` and `staleTimes: { dynamic: 30 }`. `cacheComponents` is **not** on.
- With `cacheComponents` on, Next.js keeps the last 3 pages alive but hidden (React `<Activity>`), so the page, scroll and everything on screen survive (`preserving-ui-state.md`). That changes how every page renders (see section 4, option A).

So the data side of "back" already works. The reload feeling comes from our own code (section 3).

---

## 3. Why going back reloads today

### 3.1 Scroll position is lost on almost every page
- The app shell is fixed to the screen height (`MainLayout.tsx`: `h-dvh … overflow-clip`, and `<main … overflow-clip>`). The browser window itself never scrolls.
- Each page scrolls inside its own box marked `data-scroll-root="route"`: Network, My profile, `/u/[username]`, workspace route, workspaces/new, appeal, trust layout, Messages lists and conversation, Settings, Discover, Edit profile.
- The browser and Next.js only restore **window** scroll, so these boxes always start at the top when you come back.
- Only Discover has its own fix: `DiscoverClient.tsx:298–336` saves `scrollTop` in `sessionStorage` (key `discover-scroll:` + query) and restores it when you arrived by back/forward (`cameBackByHistory`, `DiscoverClient.tsx:88–95`). No other page has this.

### 3.2 "Back to…" links that don't go back
They are labelled "Back", but they open the page again as a new visit, so it reloads, starts at the top and adds a new history step:
- Edit profile, Cancel and Save and close: `EditProfileEditor.tsx:230–234` does `router.replace(returnHref)` and then `router.refresh()`. The refresh also throws away the other pages Next.js was keeping in memory.
- "Back to queue" and "Next waiting": `ReviewQueueParts.tsx:259, 276–277`. Plain `<a href>`, which reloads the **whole browser page**.
- "‹ Back to the assignment": `HandInSection.tsx:160`. Plain `<a href>`, which also reloads the whole browser page.
- "‹ Workspaces" above an organization's Members list: `OrgMembersTab.tsx:150`. A `<Link>` to `?tab=projects`, so a new visit.

### 3.3 Most detail pages have no back control
Someone's profile, Edit profile, workspace, organization, trust case/appeal/person and the appeal page have no back button (inventory in section 6).

### 3.4 Pages rebuild when you return
Without `cacheComponents`, the page you left is removed and rebuilt when you come back. Data comes back from memory, but anything held only on screen (half-typed text, an expanded section) resets.

### 3.5 Pieces already in the codebase to reuse
- `src/components/messages/useBack.ts`: goes back if there's one of our pages behind this one, otherwise goes to a fallback.
- `src/lib/navigation/in-app-history.ts`: counts how many of our pages are behind the current one. `MainLayout.tsx` reports every page change to it.
  - Ceiling, written in the file: Forward counts as a step back, and `router.replace` to a new path counts as a step forward. After those, in-app Back may use the fallback or go back one step too far.
- `DiscoverClient.tsx` scroll save/restore (3.1). It becomes the shared version.
- `GlobalSearch` trigger is `flex-1` (`GlobalSearch.tsx:98–100`), so it already stretches to fill its space. The narrowing animation needs no extra search code.

---

## 4. Options considered and the decision

### Option A: switch on `cacheComponents` (not chosen now)
- Pros: Next.js's own way. The last 3 pages stay alive hidden, so going back is truly identical (scroll, typed text, open sections).
- Cons:
  - It changes how every page in the app renders, which is a whole-app migration: route configs, a build check of every route, synchronous `new Date()` / `Math.random()` during render must move.
  - Open dropdowns, dialogs and form messages also stay as you left them, so every one of them must be checked and reset where needed.
  - Only 3 pages are kept.
  - Normal link clicks also restore the kept page, so sidebar clicks would need forcing fresh.
- Kept as the **upgrade path** if the limit in section 10 matters later.

### Option B: fix the causes in our own code (chosen)
- One shared scroll memory for every page's scroll box.
- One shared back button that really goes back, with a fallback.
- The "Back to…" links fixed or removed (section 8).
- Data on return comes from Next.js's page cache plus the React Query cache (`gcTime` 5 minutes, `src/lib/query-defaults.ts`).
- Simple and stable, and it changes only navigation code.

**Decision: option B.** Chosen by the user on 2026-11-09.

---

## 5. Behaviour rules

| Action | Result |
|---|---|
| In-app back arrow | Real back to the previous page. Same scroll, data from memory, no loading. |
| Browser back button | Same as the arrow. |
| Trackpad / phone swipe back | Same as the arrow (the browser treats it as a back). |
| Browser forward | Same restore, in the other direction. |
| Browser refresh | Full fresh load. |
| Left sidebar click (Discover, Network, Messages…) | Fresh load, starts at the top. |
| Clicking the same button again on the page | Fresh load. |
| Any normal link to another page | New visit: fresh, starts at the top. |
| Arrow with nothing of ours behind the page (opened from an email, a bookmark, a new tab, or a refresh at the start of the tab) | Goes to the page's fallback (section 6, refined by B13), never out of the app. |
| Switching a tab or a filter on a page (A2) | Doesn't add a history step. Back leaves the page in one step; coming back lands on the tab or filter you were on. |
| Back while a drawer, thread, viewer or full-screen file is open (A3) | Closes that first. The next back leaves the page. Small confirmation dialogs are not included. |
| Back after a delete, a create, sign-in, onboarding, terms or a join code (A5) | Never lands on the finished or deleted screen. |
| Back after sign-out (A6) | Shows nothing private; goes to login. |
| Back after opening a top-search result (R2) | Reopens the search with the same query and the opened result highlighted. |
| Back after a round trip to another site, such as GitHub connect or import (R4) | Goes to where you were before leaving, never to the other site or a callback page. |
| Picking an item in Messages, the Trust inbox, Files or the Review queue (R5) | Desktop: no history step. Phone: adds a step, so back returns to the list. |
| Back while an upload or save is running (R6) | Asks first. |
| Back while offline (R9) | Shows the page from memory with the offline indicator. |

---

## 6. Back arrow: where it shows

**Rule:** pages you reach from the sidebar or the menu are **starting points**, so no arrow. Pages you open from inside another page get the arrow.

| Page | Back today | Arrow | Fallback when nothing is behind it |
|---|---|---|---|
| Discover `/discover` | none | no (start page) | |
| Network `/network` | none | no (start page) | |
| Messages list `/messages…` | none | no (start page) | |
| Settings `/settings` | none | no (start page) | |
| My profile `/my-profile` | none | no (start page, from the avatar menu) | |
| Someone's profile `/u/[username]` | none | **yes** | `/network` |
| Edit profile `/my-profile/edit` | Cancel/Save reopen and refresh | **yes**; the unsaved-changes warning stays | `/my-profile` (or `?tab=portfolio` when opened from the portfolio, as `profileEditReturnHref` does) |
| Workspace `/workspaces/[slug]` | parent org link only, for org workspaces | **yes** | `/discover` |
| Organization `/org/[slug]` | parent org link only, for child orgs | **yes** | `/discover` |
| Trust case `/admin/trust/cases/[number]` | none | **yes** | `/admin/trust` |
| Trust appeal `/admin/trust/appeals/[number]` | none | **yes** | `/admin/trust` |
| Trust person `/admin/trust/people/[handle]` | none | **yes** | `/admin/trust` |
| Appeal `/appeal/[number]` (often opened from an email) | none | **yes** | `/discover` |
| Messages conversation `/messages/[channelId]` | own ← arrow in the conversation header on phones | **no top-bar arrow** (keeps its own; never two). R1: its own arrow also shows on desktop when opened from outside Messages | |
| Create workspace `/workspaces/new` | Cancel (X) | **no top-bar arrow** (X is right for cancelling a flow) | |
| `/my-work` | redirects to Discover with the My work drawer | no | |

Fallback pages are a proposal; the user can change any of them. B13 refines them: when a page has a real parent (a task's workspace, a workspace's organization, a conversation's Messages, a case's console), the fallback is that parent.

Outside the main app layout (no top bar): auth pages, onboarding, legal pages, `/legal/accept`, `/admin/notifications`, `/admin/reports`. A1 changes this for the installed app: legal pages, admin Notifications/Reports and error/not-found pages must still have a way back (A1, section 14).

---

## 7. Back arrow: design and motion (approved with mockups)

### 7.1 Look
- Icon: **left arrow** (Lucide `ArrowLeft`, already used for back in Messages).
  - Not **X**: X means close or cancel.
  - Not a **chevron (‹)**: the app already uses it for "previous item" and wizard steps.
- Icon only, no text, no border. Same quiet style as the bell and the other top-bar icons (`nb-icon-button`: muted colour, light fill and darker icon on hover).
- Desktop hover: tooltip **"Back"**. Accessible name `aria-label="Back"`. B14 refines it: the tooltip and accessible name name the destination when known ("Back to Discover", "Back to Priya Nair").
- Size: 34px control on desktop (matches `--ui-control-height`), 44px tap target on phones.

### 7.2 Placement: inside the existing top bar (`TopNav.tsx`), never a new row
- **Desktop:** at the far left of the top bar, just before the search box. The page's own header below is unchanged.
- **Phone:** next to the menu button, taking the logo's place. The logo comes back on start pages.
- Built once in the top bar, so it's in the same spot on every page. Putting it in each page's title row was rejected: more than 10 different headers (profile card, workspace hero, edit sidebar…), and the arrow would sit in a different place on each.

### 7.3 Motion
- **Desktop:** a slot at the left of the top bar grows from 0 to 44px (34px arrow plus the gap). Because the search box fills its space, it narrows by exactly that amount on its own. At the same time the arrow fades in (opacity 0 → 1) and slides 8px from the left. Going back reverses it: the slot shrinks, the search widens, the arrow fades out to the left.
- **Phone:** the logo fades out while sliding 8px right; the arrow fades in while sliding from 8px left, in the same spot. Reversed on going back.
- **Timing:** 220ms, curve `cubic-bezier(.2, 0, 0, 1)` (fast start, gentle settle).

### 7.4 Motion rules
1. **It moves the moment you click.** Whether a page has the arrow is decided from the address, so the animation runs together with the page change and never waits for data.
2. **No animation on a fresh load.** A direct link or a refresh shows the arrow already in place.
3. **No motion between two start pages** (Discover → Network), and **none between two arrow pages** (workspace → workspace), so there's no flicker.
4. **Reduce motion respected.** With the system setting on (`prefers-reduced-motion: reduce`), the arrow appears and disappears instantly.
5. **The hidden arrow can't be reached.** While hidden, Tab and screen readers skip it.
6. **The bar never jumps.** Only the arrow slot changes width. The search text, the New workspace button, the right-side icons and the row height stay put.

---

## 8. Existing "Back to…" links (grouping approved)

| Group | Link | File | Change |
|---|---|---|---|
| **Remove** (the arrow does the same job) | "‹ Workspaces" above Members (shown only when you came from Workspaces "Place them") | `OrgMembersTab.tsx:150` | Delete. |
| **Remove** | "‹ Back to the assignment" in a hand-in | `HandInSection.tsx:160` | Delete. |
| **Keep, no browser reload** (jumps to a fixed place, which isn't the same as going back) | "Back to queue" | `ReviewQueueParts.tsx:277` | In-app link instead of `<a href>`; rename to **"Review queue"** so it doesn't read as a second back. |
| **Keep, no browser reload** | "Next waiting: …" | `ReviewQueueParts.tsx:276` | In-app link instead of `<a href>`. |
| **Keep the button, change what happens after** (Cancel and Save mean something on their own) | Edit profile Cancel, and Save and close | `EditProfileEditor.tsx:230–234` | Go back (real back, with the `/my-profile` fallback) instead of `router.replace` + `router.refresh`. |
| **Leave alone** (steps inside a panel or flow, not page back) | "Back to all comments" (updates, task comments), wizard "‹ Back" step, "Back to sign in", "Back to sharing", "Back to draft", "Back to the board" (review queue), Messages ← arrows (`ConversationView`, `ViewScreen`, `ChatWindow`, `ChatDrawer`), thread "Back to conversation", Files "Back to Files" / "Back to search results" / "Back to previous folder", upload "Back to categories", share browser "← All workspaces", create-workspace toast "Back to workspaces" | various | No change. |

Result: every page has exactly one way back. That's the top-bar arrow, plus the browser's back and swipe, which do the same thing.

---

## 9. Edit, then back

- After you save something and go back, the page that shows it reflects your change right away. Everything else stays as you left it, the way Amazon updates the cart count but not your search results.
- How:
  - Edit profile's save already marks the profile data as changed (`EditProfileEditor.tsx:210–226` invalidates the profile, projects, collaboration summary, search and connections queries).
  - Exit becomes a real back instead of reopen + refresh.
  - When building, I'll check that My profile shows the saved values after going back. If server-rendered parts show the old version, the fix is to refresh only that page's data, never a full reload.

---

## 10. Known limit

- Restored: scroll position, loaded data, anything kept in the address (active tab, filters, search query, open drawer).
- Not restored: things held only on screen, such as a section you expanded. These reset on return.
- Half-typed text in composers (comment, message, task description) is kept by B12, so the most painful part of this limit is covered.
- Searches, filters, sorts, views, sprint and folder choices are kept by R3, because they live in the address.
- Upgrade path: option A (`cacheComponents`), as a separate project, only if this gap matters.

---

## 11. Build outline (for when "implement" is given)

1. **Shared scroll memory** in `MainLayout.tsx`, working on the page's `data-scroll-root="route"` box.
   - Save `scrollTop` per page address in `sessionStorage`.
   - Restore only when the arrival was a back/forward, using the same check as Discover's `cameBackByHistory`.
   - Any other arrival starts at the top.
   - Wrap every storage read and write in try/catch, so blocked storage means "start at the top".
   - Remove Discover's copy (`DiscoverClient.tsx:298–336`) once the shared one covers it.
2. **Shared back hook:** move `useBack` out of `components/messages` so the top bar and Messages use one copy. Fallback is per page (section 6).
3. **Arrow in `TopNav.tsx`:** one list of which addresses get the arrow and their fallbacks; the slot, the motion and the rules from section 7. Hidden on start pages, Messages and Create workspace.
4. **Links:** the section 8 changes.
5. **Edit profile exit:** the section 9 change.
6. **Tests:** unit tests for "which page gets the arrow / fallback" and for the scroll save/restore decision. Keep `in-app-history` tests passing.
7. **Additions from section 14**, in this order:
   1. A7 history count fix (the arrow depends on it).
   2. A8 page-list test.
   3. A2 tabs and filters.
   4. A3 panels close first.
   5. A4 card-anchored restore.
   6. A5 no finished or deleted pages.
   7. A6 sign-out.
   8. A1 installed-app exits.
   9. Then B9–B15.
8. **Round 2 from section 15:**
   1. R12 "before" numbers first, ahead of any code change.
   2. R3 settings in the address (A2 and the restore depend on it).
   3. R5 side-by-side rule.
   4. R1 desktop conversation back.
   5. R2 back to search.
   6. R4 round trips.
   7. R6 running uploads.
   8. R7 breadcrumb wording.
   9. R8 titles.
   10. R9–R11.
   11. R13 outside links.
   12. R14 forward feedback.
   13. R12 "after" numbers last.

Project rules that apply: work on local main, stage named files only, commit locally, no push until told.

---

## 12. Checks after building (in the browser)

For each arrow page and each start page:
1. Go in, scroll down, go back:
   - with the arrow,
   - with the browser back button,
   - with a swipe (at phone size).

   Each time: no loading screen, same scroll position, same cards, filters and tab.
2. Sidebar click, the same button again, and browser refresh: each loads fresh and starts at the top.
3. Open an arrow page directly from a link or a new tab: the arrow uses the fallback and stays in the app.
4. Motion:
   - normal speed,
   - no motion on a fresh load,
   - no flicker between two arrow pages,
   - reduce motion on (instant),
   - the bar never jumps.
5. Keyboard: Tab skips the hidden arrow and reaches the visible one; screen reader says "Back".
6. Edit profile: Save then back shows the new values; Cancel then back shows the profile where you left it; the unsaved-changes warning still works.
7. Review queue: "Review queue" and "Next waiting" no longer reload the browser page.
8. Members and hand-in: the removed links are gone and the arrow takes you back.
9. Light and dark theme, desktop and phone.
10. The additions' own checks are listed with each item in sections 14 and 15.
11. Before and after numbers (R12) recorded for Discover, Network, a workspace and a profile.

---

## 13. Open items and risks to watch while building

- **Fallback pages** (section 6) are proposals; the user can change any.
- **Network may flash a loading placeholder** on return (`NetworkClient.tsx:199`, `initialLoadPending`) even with the data in memory. Check each page and fix where it does.
- **Page data in memory can be thrown away** by `router.refresh()` (28 calls in `src/components`) and by server actions that call `revalidatePath`/`revalidateTag` (24 files in `src/app/actions`). After those, going back fetches fresh data. Scroll memory still works, but a short load may show. Check the common paths.
- **`in-app-history` ceiling** (3.5): after browser Forward or a `router.replace` to a new path, the arrow may use the fallback or go back one step too far. Now fixed as part of this work (A7).
- **Swipe back on iPhone Safari** shows the browser's own snapshot during the swipe. Our restore applies when it lands. Check it doesn't jump.

---

## 14. Additions (approved 2026-11-09)

Groups A and B were approved. Group C (optional, later) and group D (skip) are listed at the end for the record.

### Group A: done with this work (without them the concept breaks in some places)

**A1. The installed app has no browser back**
- Fact: `public/manifest.webmanifest` has `"display": "standalone"`. Installed to an iPhone home screen, there is no back button and no swipe-back, so the arrow is the only way back.
- Change: every page must have a way back:
  - error and not-found pages,
  - legal pages opened from Settings (`(legal)` layout),
  - `/admin/notifications` and `/admin/reports` (no top bar today).
- These get the same arrow and fallback. The existing recovery buttons on error pages ("Back to Messages", "Back to sign in") stay, since they recover from a failure.
- Check: in installed mode on a phone, every page has a way out.

**A2. Tabs and filters don't add history steps**
- Fact today:
  - every workspace/organization tab click adds a history step (`WorkspaceDashboardClient.tsx:678`, `window.history.pushState`),
  - so do Network filters (`NetworkClient.tsx:153, 169`, `router.push`).
- So clicking 4 tabs means 4 backs before leaving the page.
- Change (this reverses the earlier "a tab click is a history entry" decision; approved by the user):
  - switching a tab or filter replaces the current history step instead of adding one,
  - back leaves the page in one step,
  - coming back lands on the tab or filter you were on, because it's kept in the address.
- Check: click through several tabs, then back. You leave the page in one step; going forward again returns to the last tab.

**A3. Back closes what's open over the page first**
- Covered: the task drawer (`drawerType`/`drawerId`), the My work drawer, threads (Discover update thread already uses `pushState` in `useDiscoverUpdateThread.ts:51`, Messages thread), the photo/video viewer (`media-viewer.tsx`), and a full-screen file.
- Change: opening one of these adds a history step, so back or swipe closes it first. The next back leaves the page.
- Not covered: small confirmation dialogs.
- Closing with its own X or Esc also removes that step, so you never need an extra back.
- Check: open a drawer, swipe back, and it closes and the page stays. Close with X, then back, and you leave the page in one step.

**A4. Long lists come back exactly**
- Fact: Discover's feed is virtualized (`react-virtuoso`), so only the cards on screen exist, and images load late. A pixel scroll distance can land in the wrong place.
- Change:
  - remember **which card was at the top** of the scroll box (its id) and how far into it, and restore to that card,
  - keep the extra "load more" pages, which the React Query cache already holds for 5 minutes.
- Pixel restore is used only where no card id exists.
- Check: scroll Discover deep (several "load more"), open a card, go back. The same card sits at the same spot, even after images load.

**A5. Back never lands on a finished or deleted page**
- After deleting a workspace, organization or message, the deleted page is replaced in history, so back skips it.
- After creating a workspace, the wizard is replaced by the new workspace, so back goes to where you were before the wizard. The return path already exists: `rememberCreateWorkspaceReturnPath`.
- After sign-in, sign-up, onboarding, accepting the terms (`/legal/accept`) or joining with a code: these screens are replaced, so back doesn't return to them.
- After leaving an organization/workspace or losing access, going back shows a clear "no access" page with the arrow, not a broken page.
- Check: each flow, then back.

**A6. After sign-out, back shows nothing private**
- Fact: sign-out already does a full reload to `/login` (`AuthProvider.tsx`, `window.location.href = '/login'`).
- Gap: the browser keeps its own copy of the last page in memory, and back can briefly show it.
- Change: when a page is shown from that copy and the user is signed out, reload to login immediately.
- Check: sign out, press back. No private content shows, not even briefly.

**A7. Fix the "how many pages are behind me" count**
- Fact: `in-app-history.ts` counts Forward as a step back, and `router.replace` to a new path as a step forward. Today only Messages depends on it; the arrow will depend on it everywhere.
- Change: give each history step its own id, so the count is always exact.
- Check: the existing `in-app-history` tests plus new ones for back, forward, replace and reload.

**A8. A test that lists every page**
- One list of every page: arrow yes or no, and its fallback. A test fails if a page under `src/app` is missing from it.
- A new page can't ship without a decision on back. The organization design-consistency contract test is the precedent.

### Group B: worth adding (clear benefit, small)

**B9. Land on the card you opened**
- After going back, the card you clicked is in view and keyboard focus is on it, so keyboard users continue from there.
- Visual: a soft one-second background tint on that card, with no outline (matches the app's no-focus-ring look; a visible ring only for keyboard focus, as today).
- Check: open a card from a list, go back. The card is in view and Tab continues from it.

**B10. Inner scroll areas remember their position too**
- Kanban columns (`KanbanBoard.tsx`), the Files list (`FilesTabRoot.tsx` / `FolderListView.tsx`) and the Messages sidebar keep their own scroll position.
- Only these named areas, not every small scroll box.

**B11. Instant, then quietly fresh**
- The page you return to shows instantly from memory. If its data is older than the standard freshness time (`QUERY_DEFAULTS.staleTime`), it updates in the background.
- Rule: no spinner, and the content you're reading never moves.
- New items at the top wait behind a small "N new" pill.

**B12. Keep typed text**
- Half-written comments, messages and task descriptions are saved when you leave the page and are there when you come back. Same tab, cleared when sent or cancelled.
- Messages already has Drafts; reuse that where it applies.
- This covers the most painful part of the known limit (section 10) without the `cacheComponents` switch.

**B13. Smarter fallbacks**
- When a page is opened from an email, a notification or a new tab, the arrow goes to the page's real parent:
  - task → its workspace,
  - workspace in an organization → that organization,
  - child organization → parent organization,
  - conversation → Messages,
  - trust case/appeal/person → Trust console.
- The fixed fallbacks in section 6 apply only when there's no parent.

**B14. The tooltip names the destination**
- Tooltip and accessible name say "Back to Discover", "Back to Priya Nair", "Back to Campus robotics kit".
- The name comes from the page you came from; plain "Back" when unknown (for example after a fresh load).

**B15. Cards are real links**
- Fact: some cards open by code on click (for example `NetworkPeopleTab.tsx:98`, `router.push`).
- Change: every card that opens a page is a real link, so Cmd/Ctrl-click, middle-click and long-press "open in new tab" work, and the browser treats it as a normal step.
- Check: audit of cards in Discover, Network, profiles, organizations, workspaces and search results.

### Group C: optional, later (not approved now)

- **C16.** Tapping the active sidebar item: first tap scrolls to top, a second tap at the top reloads, like Instagram/X. This changes the "same button reloads" rule.
- **C17.** Direction-aware page slide (forward from the right, back from the left) using Next.js view transitions. It adds motion to every page change, so it comes after the rest is stable.

### Group D: skip

- **D18.** Long-press the arrow for recent pages: the browser's own back button already does it.
- **D19.** Keyboard back shortcut: Alt+← and Cmd+[ are browser back already, so they get the same behaviour for free.

---

## 15. Round 2 additions (approved 2026-11-09)

Everything in this round was approved, including the optional R14. Group C from section 14 (C16, C17) is still not approved.

### Gaps (places where back still breaks or confuses)

**R1. A conversation opened from outside Messages has no back on desktop**
- Fact: the conversation's back arrow is phone-only (`ConversationView.tsx:540–541`, wrapped in `lg:hidden`).
- So someone's profile → Message, on desktop, has no in-app way back to the profile.
- Change: when the conversation was opened from outside Messages (profile, workspace, organization, notification), its own arrow also shows on desktop and goes back there. Opened from inside Messages, desktop stays as today, since the list is beside it.
- The top-bar arrow stays hidden on Messages, so there's still only one arrow (section 6).
- Check: profile → Message → arrow (desktop and phone) returns to the profile at the same scroll.

**R2. Back to your search results**
- Fact: picking a result in the top search opens the page as a new visit (`CommandPalette.tsx:256, 266, 297`, `router.push`). Back returns to the page underneath and the search is gone.
- Change: going back after opening a result reopens the search with the same query, the same results and the result you opened highlighted. This is the Amazon "back to the results" behaviour.
- The query is remembered for the tab only, so a fresh tab starts empty.
- Pressing back again (or Esc) closes the search and leaves you on the page you searched from.
- Check: search, open the third result, go back. The search is open with the same query and the third result highlighted.

**R3. Everything you set on a page lives in the address**
- Fact: some searches and filters are only held on screen. For example the Members list's search box and role filter (`OrgMembersTab.tsx:79, 152–153`, `useState`). They're lost on back even with sections 3–14.
- Change: every search box, filter, sort, board/list toggle, chosen sprint, open folder and Review queue filter goes into the address, without adding a history step (same rule as A2). On return they come back exactly.
- Audit list to cover, at least:
  - `OrgMembersTab.tsx`, `ReviewQueue.tsx`, `AssignmentRoster.tsx`, `OrgFileViews.tsx`,
  - `NetworkFilters.tsx`, `ApplicationReview.tsx`,
  - workspace task board view and sprint,
  - Files folder and view.
- Typed text in a search box is written to the address after a short pause, not on every key.
- Check: set a search, filter and sort on each, open an item, go back. All the same.

**R4. Round trips to other sites**
- Fact: connecting and disconnecting GitHub (`IntegrationsSettings.tsx:496`, `window.location.assign`) and importing from GitHub in the create wizard leave the site and come back.
- Change: after returning, back doesn't go to GitHub or a callback page. It goes to where you were before you left. The callback/return page replaces itself in history.
- Sign-in with Google/GitHub is already covered by A5.
- Check: connect GitHub from Settings, return, press back. You land where you were before Settings, not on GitHub.

**R5. Side-by-side vs full screen**
- Applies to Messages, the Trust inbox (`?case=`), Files and the Review queue.
- Rule:
  - **desktop (side by side):** picking an item adds no history step; back leaves the page,
  - **phone (full screen):** opening an item adds a step; back returns to the list at the same scroll.
- Same screen, decided by width.
- Check: both widths, each of the four areas.

**R6. Back while something is still running**
- Fact: Files already asks before switching tabs during an unfinished change (`FilesTabRoot.tsx:208`, `confirmFileNavigation`).
- Change: while an upload or a save is running, the arrow, browser back, swipe and sidebar clicks also ask first: "An upload is still running. Leave anyway?" Leaving cancels nothing silently; it says what will be lost.
- Edit profile's existing unsaved-changes warning (`useProfileEditNavigationGuard`) stays.
- Check: start a large upload, press the arrow, then browser back, then a sidebar item. Each asks.

**R7. Back and the "parent" link are two different jobs**
- Fact: child organizations and workspaces inside an organization show a breadcrumb to the parent (`OrgBreadcrumb`, `OrgHeaderParts.tsx:112`).
- Rule:
  - the **arrow** means where you came from,
  - the **breadcrumb** means "this belongs to that parent".
- Both can show on the same page; they're different jobs, not duplicates. The breadcrumb never uses the word "Back", and no breadcrumb is added where there's no real parent.
- Check: on a child organization reached from Discover, the arrow returns to Discover and the breadcrumb goes to the parent organization.

### Polish

**R8. Clear browser tab titles everywhere**
- Every page, tab and drawer sets a clear browser tab title, for example "Tasks · Campus robotics kit · NetworkBase".
- The browser's own history list (long-press on its back button) becomes readable, and the arrow's "Back to …" tooltip (B14) uses the same name.
- Check: long-press the browser back button after a few steps. Each entry is named.

**R9. Back works offline**
- Going back while offline shows the page from memory, with the existing offline indicator (`ConnectionStatusIndicator`), never an error page.
- Actions on that page that need the network say so when used.
- Check: open a few pages, go offline, go back twice. Both pages show.

**R10. The card you return to was deleted**
- If the card that was at the top (A4) was deleted while you were away, land on the nearest card that still exists, not the top of the list.
- Check: open a card, delete the card above it from another tab, go back.

**R11. A size limit on remembered positions**
- Keep at most the last 50 remembered positions per tab, dropping the oldest, so storage never grows without limit.
- Stored for the tab only, so it's cleared when the tab closes.

**R12. Before and after numbers (project rule)**
- With the `benchmark` skill, measure the time from pressing back until the content shows, for Discover, Network, a workspace and someone's profile. Measure once now and once after building.
- Also record whether any loading screen shows and whether the scroll position matched.
- Goal: no loading screen and the same position on all four.

**R13. Links to other sites open in a new tab**
- A GitHub repo link, a website on a profile or any other outside link opens in a new tab (with `rel="noopener noreferrer"`). The app and its back history are never replaced.
- Check: audit outside links in profiles, workspaces, organizations, messages and update posts.

### Optional (approved)

**R14. Instant feedback going forward**
- A card or link shows a pressed state the moment you tap it, and the page change starts at once, so forward feels as fast as back.
- Next.js's `useLinkStatus` can show a small wait sign only if the next page is slow.
- Check: tap a card on a slow connection (throttled). Feedback is immediate.

### Skip (works already, nothing to build)

- **R15.** The mouse's side back button: browsers treat it as back, so it gets the same behaviour.
- **R16.** Android's preview of the previous page while swiping back: the browser handles it, and our restore applies when the swipe completes.


---

## 16. Build notes and measurements

### Built (local main, not pushed)
History stamps (A7), route table and fallbacks (§6, B13), every-page test (A8, R7), top-bar arrow and motion (§7, B14), shared scroll memory with card anchors (§3.1, A4, B9, B10, R10, R11), Network without a skeleton when cached (B11), tabs and filters replace (A2), page settings in the address (R3), back closes drawers and viewers (A3, R5), back links and Edit profile exit (§8, §9), finished pages leave history (A5), sign-out privacy (A6), ways back on every page and offline message (A1, R9), desktop conversation back (R1), back reopens search (R2), GitHub round trip (R4), upload leave guard (R6), tab titles (R8), half-typed text kept (B12), real links and tap feedback (B15, R13, R14).

### Differences from the plan, and known limits
- R4: the browser's own back button may still show GitHub once after connecting; the in-app arrow skips it.
- R2: back reopens the search; Esc or a click outside closes it (Forward still works). Agreed while planning.
- R5: Files keeps folder and file history on every screen size. Agreed while planning.
- B15: My work's task rows stay buttons; they already have their own "Open in new tab" and copy-link buttons, and opening hands the task over without putting it in the address.
- B12: a half-typed task description comes back when you open the description editor again (the editor itself starts closed).
- R14: the thin wait bar shows on search results and notifications; Discover project links and person names get the pressed state only.
- B11: "N new" stays where Discover already had it; elsewhere the remembered card is held in place for 1.5 seconds while a background refresh lands.
- R13: links to other sites in update posts already opened in a new tab; no change needed.
- Unit tests: 3,376 of 3,379 pass. The 3 failures are in Integrations settings (design tokens, "Revoke any time"), from another session's work, not this one.

### Measurements (R12), 2026-11-09

Checked in the built-in browser, signed in, on the local dev server (port 3001), desktop 1280×800. Each journey: scroll down, open a link, wait, press back.

| Journey | Before (old code) | After: content shown | After: card back in place | Loading screen | Scroll position |
|---|---|---|---|---|---|
| Discover → workspace → back | starts at its saved pixel (Discover only) | 196 ms | 196 ms | none | 700 → 700 |
| Network → profile → back | starts at the top, loading skeleton first | 127 ms (2nd run; 1st 1,018 ms while compiling) | 127 ms | none | 600 → 600 |
| Workspace (Updates tab) → profile → back | starts at the top, tab could reset | 1,007 ms | 1,007 ms | none | 600 → 600, Updates tab kept |
| My profile → workspace → back | full page reload, starts at the top | 139 ms | 139 ms | none | 400 → 400 |

- **Before:** the "before" column comes from the old code's behaviour, not measured. A scratch copy of the old code on port 3100 would not render in the browser pane (webpack with a shared `node_modules`).
- **Dev mode:** these are dev-server numbers. The pane throttled animation frames to 1–2 per second during the run, so the workspace number is pessimistic; a normal visible tab runs about 60 per second.

### Fixed during the browser check
- **Lost back flag:** a back that took over 1.5 s to render lost its "came back" flag. The flag now lasts until the page is stamped.
- **Wrong anchor:** Discover's people rail stays on screen beside the feed and was being used as the anchor. Rail cards are no longer anchors.
- **Slow pages:**
  - the restore now waits up to 5 s for the page, then holds the card for 1.5 s;
  - saving pauses while it runs;
  - the first attempt happens immediately instead of on the next frame.
- **Profile workspace links** did a full page reload. They're in-app links now.

### Seen working in the browser
- **Arrow on desktop:** on a workspace it sits before the search in the same row (44 px slot), labelled "Back to Discover"; the history stamp shows depth 1.
- **Arrow on phones:** it sits next to the menu in the logo's place, and the hidden logo is skipped by Tab.
- **Not-found and Terms pages** have their own arrow.
- **Back** returns to the same history entry and exact position on Discover, Network, a workspace and My profile, with no loading screen.

### Not checked in the browser yet
- The motion itself, frame by frame, and reduce motion.
- Drawers closing on back (task, My work, media, member, Trust case).
- Reopening the search on back.
- The GitHub round trip.
- The upload warning.
- Sign-out and then back.
- Half-typed comments.
- Edit profile save → back.
- Offline back.
