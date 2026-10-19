# Network page audit: shell, tab bar, Suggested, Connections, and Invitations in depth

## Context

The user requested a complete, professional, read-only audit and plan for the Network page (`/network`, `/people`), matching the depth, structure, and item format of earlier audits (Messages `bubbly-swinging-summit.md`, Discover `okay-now-we-need-spicy-pnueli.md`, and Project Detail `now-you-need-to-greedy-cocke.md`).

**Scope.** Covers every layer of the Network page across the application:
- Page shell and header (title, search bar, metadata, URL query sync `?q=` and `?tab=`, search focus delegation, scroll root);
- Tab bar with live badge counts and keyboard roving focus;
- Suggested tab (`NetworkPeopleTab`, `PersonCard`, `PersonPresenceDot`, suggestion ranking queries, cold-start fallbacks);
- Connections tab (`ConnectionsClient`, connection rows, message link, disconnect, block profile);
- Invitations tab in the deepest depth (`InvitationsClient`, incoming/sent connection requests, incoming/sent project invitations, incoming project applications);
- Realtime notifications & badges (`NetworkNotificationsProvider`, `useNetworkNotifications`, `shell-batch.ts`, Supabase Realtime channels);
- Loading skeletons, empty states, partial error boundaries;
- Mobile (<768px, 375px, 320px) and dark mode tokens;
- Backend database queries, indexes, migrations, rate limits, Redis caching, and Inngest jobs for 1M users.

**Method.** Static source audit by three specialized parallel subagents, design specification diff against `docs/design/networkbase-application-design-specification.html` (§08 Shell, §09 Responsive, §12 Person Cards, §16 Network, §33 Universal States, §34 Accessibility, §35 Appearance), earlier audit verification (2026-09-10 Design Conformance, 2026-09-29 Mobile Redesign, 2026-09-27 Performance), and cross-referencing `backend-database-2026-10-05/inventories/findings.json`.

**User Decisions.**
1. Scope covers all surfaces: header, tab bar, Suggested tab, Connections tab, Invitations tab, realtime counts, loading/error states, mobile (<768), and dark mode.
2. Invitations tab is audited in the deepest depth (accept/decline/withdraw connection requests + project applications/invites, `InvitationsClient` 491 lines, `connections.ts` + `applications/internal.ts`).
3. Backend findings `AUTH-011` (presence privacy), `SEC-010` (block replace/remove), and `COR-033` (application transitions transaction) are owned by the other backend session: listed as cross-references only, no fixes proposed here.
4. Read-only audit only: no code modified and no writes against any database until explicit "implement" instruction.

**What to keep deliberately (verified fine):**
- Atomic suggestion set replacement under advisory lock (`replaceSuggestions`, `suggestions.ts:15-41`, COR-021).
- Feed cursor stability adhering to query order (`buildConnectionDateCursorCondition`, `connections.ts:863-870`, COR-030).
- Privacy relationship enforcement on request feeds (`buildViewerScopedProfileView`, `connections.ts:975-999`, COR-029).
- Anti-spam token bucket and daily limit on connection requests (`CONNECTION_REQUEST_DAILY_CAP = 50`, `connections.ts:1379-1381`).
- Atomic CTE for accepting connection requests and updating profile counts (`connections.ts:1998-2018`).
- Atomic CTE for removing connections and decrementing profile counts (`connections.ts:2262-2282`).
- 64-bit hashtextextended advisory transaction locking on connection pair mutations (`connections.ts:1516-1518`).
- Compound keyset index on precomputed suggestions (`connection_suggestions_user_score_keyset_idx` on `userId, score DESC, suggestedUserId DESC`).
- Batching presence queries within 16ms window (`createBatcher` in `usePresence.ts:27-51`).
- Browser-native `[content-visibility:auto]` and `[contain-intrinsic-size:auto_150px]` in `PersonCardGrid`.
- Client skill resolution from static JSON catalog (`resolveClientSkill`, `client.ts:48-60`).
- WeakMap idempotency key caching in `useConnections.ts:471-479` against React Query retry double-mutations.
- `normalizeTabKey` alias mappings (`NetworkClient.tsx:20-25`) for backward compatibility with `/people` and legacy links.

---

## Phase 1 — Security (6)

1. `[Sec]` **Blocked user can accept pending project invitation and join blocker's project chat channel.**
   - Evidence: `src/lib/projects/project-invitations.ts:247-353` (`resolveProjectInvitationInternal`). While `createProjectInvitation` verifies privacy relationships (`privacy.blockedByViewer || privacy.blockedByTarget`, lines 85–88), `resolveProjectInvitationInternal` completely omits privacy relationship resolution. If Bob blocks Alice after an invitation is sent (or Alice blocks Bob), Alice can still execute `resolveProjectInvitationAction({ invitationId, action: "accept" })`. The invitation updates to `"accepted"`, Alice is added to `project_members`, and line 323 immediately executes `await syncProjectChat(executor, params.projectId, params.userId, "add")`, inserting Alice into the project’s `#general` chat channel with Bob, bypassing the block.
   - Fix: In `resolveProjectInvitationInternal` before accepting, call `resolvePrivacyRelationship(invitation.candidateId, project.owner_id)` and verify `!privacy.blockedByViewer && !privacy.blockedByTarget`. Throw `"Cannot accept invitation due to privacy restrictions"` if blocked.

2. `[Sec]` **No rate limit on project invitation resolution and sent project invitation cancellation.**
   - Evidence: `src/app/actions/project/guidance.ts:157-175` (`resolveProjectInvitationAction`) and `src/app/actions/applications/internal.ts:3130-3155` (`cancelSentProjectInvitationAction`) allow unbounded mutations with no rate limits. A malicious script or rapid button clicking can trigger denial-of-service or database write storms. By contrast, connection actions enforce rate limiting (`connections.ts:1984,2136,2205,2255`).
   - Fix: Enforce `consumeRateLimit(`project-invitation-resolve:${user.id}`, 60, 60)` and `consumeRateLimit(`project-invitation-cancel:${user.id}`, 60, 60)`.

3. `[Sec]` **Signed-out visitor accessing protected tabs (`?tab=invitations`, `?tab=connections`) renders empty state without authentication prompt.**
   - Evidence: `src/components/network/NetworkClient.tsx:69-80,189-199`. `TAB_CONFIG` hides the tab buttons from `visibleTabs` when `!isAuthed`. However, directly loading `/network?tab=invitations` or `/network?tab=connections` sets `activeTab` and mounts `InvitationsClient` or `ConnectionsClient` with `initialUser = null`. The tabs display "No pending invitations" or "Your connections live here" as if the viewer is an authenticated user with an empty network, rather than prompting for sign-in.
   - Fix: In `NetworkClient.tsx`, if `!isAuthed && activeTab !== "suggested"`, render an authenticated gate empty state with `action={<Link href={`/login?redirect=${encodeURIComponent(ROUTES.NETWORK + `?tab=${activeTab}`)}`}>Sign in</Link>}` or redirect to `/login`.

4. `[Sec]` **Signed-out visitor clicking "Connect" on PersonCard falsely mutates UI into "Requested" state without sending request.**
   - Evidence: `src/components/network/NetworkPeopleTab.tsx:28-31` and `src/components/network/PersonCard.tsx:171-179`. In `NetworkPeopleTab`, `handleConnect` catches signed-out status and returns early with `toast.error("Please log in to connect")` without rejecting or throwing. Consequently, `await onConnect(profile.id)` in `PersonCard.connect()` resolves normally, and `setLocalStatus("pending_sent")` is never reset to `null`. The button transforms into the "Requested" dropdown, deceiving the visitor.
   - Fix: In `NetworkPeopleTab.tsx:30`, throw `new Error("Please log in to connect")` and navigate via `router.push("/login?redirect=" + encodeURIComponent(ROUTES.NETWORK))`.

5. `[Sec]` **Pending connection count badge leaks existence of deleted and blocked users.**
   - Evidence: `src/app/actions/connections.ts:54-60` (`readNetworkPendingCountsAction`). The count is calculated with `SELECT COUNT(*) FROM connections WHERE addressee_id = $userId AND status = 'pending'`. It does not join `profiles` to filter `profiles.deleted_at IS NULL`, nor does it verify that the requester is not blocked. Deleted spam accounts or blocked users inflate the badge count, causing a permanent phantom badge that cannot be cleared on the UI.
   - Fix: Add `isNull(profiles.deletedAt)` and block exclusions to the `COUNT(*)` in `readNetworkPendingCountsAction`.

6. `[Sec]` **Cross-Reference: Backend open findings on Network surfaces (Owned by Other Session).**
   - `AUTH-011` (P1): Presence privacy is inconsistent across actions, profile grants, and Realtime (`src/components/presence/usePresence.ts`, `src/app/actions/presence.ts`).
   - `SEC-010` (P1): A blocked user can replace and remove the other person’s block (`src/app/actions/connections.ts:1465,1547`).
   - `COR-033` (P1): Application edits and reopen preconditions escape the transition transaction (`src/app/actions/applications/internal.ts:621,1440`).
   - *Status: Cross-reference only per user decision; no fixes included in this plan.*

---

## Phase 2 — Regressions and Shell Bugs (11)

7. `[Bug]` **Hardcoded `bg-zinc-50` in `page.tsx` overrides semantic design tokens and creates light-mode background seams.**
   - Evidence: `src/app/(site)/(main)/network/page.tsx:29`:
     ```tsx
     className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-zinc-50 dark:bg-background"
     ```
     The outer container forces `bg-zinc-50` in light mode, while `NetworkClient.tsx:131` uses `bg-background` (`#faf9f5` clay palette per design specification §03).
   - Fix: Replace `bg-zinc-50 dark:bg-background` with `bg-background` in `page.tsx:29`.

8. `[Bug]` **Contradictory `overflow-hidden` on scroll root in `page.tsx` threatens scrollability.**
   - Evidence: `src/app/(site)/(main)/network/page.tsx:29`. `className="... overflow-hidden app-scroll app-scroll-y app-scroll-gutter ..."`. Tailwind's `.overflow-hidden` sets `overflow: hidden`, while `.app-scroll-y` sets `overflow-y: auto`. Both classes have equal CSS selector specificity (0,1,0), making vertical scrolling dependent on stylesheet rule order.
   - Fix: Remove `overflow-hidden` from `src/app/(site)/(main)/network/page.tsx:29`.

9. `[Bug]` **Double debounce on search input creates 600ms latency on every keystroke.**
   - Evidence: `src/components/network/NetworkClient.tsx:73,94` debounces `searchValue` by 300ms before updating the URL parameter `?q=`. Then:
     - `NetworkPeopleTab.tsx:20`: `const [debouncedSearch] = useDebounce(searchQuery, 300);`
     - `InvitationsClient.tsx:47`: `const [debouncedSearch] = useDebounce(searchQuery, 300);`
     - `ConnectionsClient.tsx:24`: `const [debouncedSearch] = useDebounce(searchQuery, 300);`
     Each child component debounces the already-debounced query by another 300ms.
   - Fix: Remove the secondary `useDebounce` from `NetworkPeopleTab`, `InvitationsClient`, and `ConnectionsClient`, passing `searchQuery` directly to queries.

10. `[Bug][UX]` **Missing `pageSearch` prop breaks topbar search focus delegation on Network page.**
    - Evidence: `src/components/network/NetworkClient.tsx:142-149`. `GlobalSearch.tsx:91-95` checks `document.querySelector('[data-page-search] input')` to focus the in-page search bar instead of opening the command modal. `SearchField.tsx:32` only sets `data-page-search` when `pageSearch` prop is provided (as done on Discover). Because `NetworkClient` omits `pageSearch`, clicking the topbar search on `/network` incorrectly triggers the global command palette modal instead of focusing the network search.
    - Fix: Add `pageSearch` to `<SearchField ... />` in `src/components/network/NetworkClient.tsx:142`.

11. `[Bug][UX]` **Search query parameter leaks across tab navigation, causing unintended cross-tab filtering.**
    - Evidence: `src/components/network/NetworkClient.tsx:108-113`. In `navigateTab(next: TabKey)`, `params.set("tab", next)` preserves the current `?q=` in `params`. If a user searches for `"alex"` on the Suggested tab and clicks "Invitations", `?tab=invitations&q=alex` mounts `InvitationsClient` with a pre-filtered query for `"alex"`, displaying an empty state.
    - Fix: In `NetworkClient.tsx:108-113`, clear `"q"` on tab change: `params.delete("q"); setSearchValue("");`.

12. `[Bug][Perf]` **Bidirectional `routeQuery` sync effect re-triggers redundant state debouncing.**
    - Evidence: `src/components/network/NetworkClient.tsx:89-91,93-100`. When `router.replace` updates `searchParams`, `routeQuery` updates and triggers `useEffect(() => setSearchValue(routeQuery), [routeQuery])`. Because `setSearchValue` is called unconditionally even when `searchValue === routeQuery`, React re-executes `useDebounce(searchValue, 300)`.
    - Fix: In `NetworkClient.tsx:90`, guard with `if (routeQuery !== searchValue) setSearchValue(routeQuery);`.

13. `[Bug][Perf]` **`NetworkClient` runs `useSuggestedPeople` unconditionally at shell root, fetching page 1 on every tab.**
    - Evidence: `src/components/network/NetworkClient.tsx:82-88`:
      ```tsx
      const suggestedQuery = useSuggestedPeople(20, routeQuery || undefined);
      ```
      This query fires on every mount and search change, even when the user is on the Connections or Invitations tabs.
    - Fix: Pass `enabled: activeTab === "suggested"` to `useSuggestedPeople` in `NetworkClient.tsx`, and read counts from dedicated stats.

14. `[Bug]` **Connections tab badge count is read from the Suggested query page 0.**
    - Evidence: `src/components/network/NetworkClient.tsx:87`:
      ```tsx
      const connectionCount = suggestedQuery.data?.pages[0]?.stats?.totalConnections ?? 0;
      ```
      If a user navigates directly to `/network?tab=connections`, the badge count depends on whether the unrendered Suggested tab's query has loaded. If `suggestedQuery` is disabled or searched, the connections count displays 0 or the search result count.
    - Fix: Include `totalConnections` in `readNetworkPendingCountsAction` (`shell.ts` / `connections.ts:62-66`), so `useNetworkNotifications` delivers all three counts (`pendingConnections`, `pendingInvites`, `totalConnections`) in one authenticated shell batch.

15. `[Bug]` **Suggested tab badge count shows loaded item count rather than total.**
    - Evidence: `src/components/network/NetworkClient.tsx:84`:
      ```tsx
      const suggestedCount = useMemo(() => suggestedQuery.data?.pages.flatMap((page) => page.items).length ?? 0, ...);
      ```
      The badge displays "20" on load, then changes to "40", "60" as the user scrolls down, and drops when filtered.
    - Fix: Omit the numeric count badge from the "Suggested" tab (matching the Discover tab where suggestions are unbounded, per spec §16), or display `stats.totalSuggestions`.

16. `[Bug][Perf]` **All three tabs are dynamic with `ssr: false`, destroying LCP and initial paint.**
    - Evidence: `src/components/network/NetworkClient.tsx:39-41`:
      ```tsx
      const NetworkPeopleTab = dynamic(loadPeopleClient, { ssr: false, loading: TabLoading });
      const ConnectionsClient = dynamic(loadConnectionsClient, { ssr: false, loading: TabLoading });
      const InvitationsClient = dynamic(loadInvitationsClient, { ssr: false, loading: TabLoading });
      ```
      Even the default landing tab (`NetworkPeopleTab`) has zero server-rendered markup. Initial page load renders a skeleton only, hurting 1M-user speed metrics.
    - Fix: Change `NetworkPeopleTab` to `ssr: true` (or import directly). Keep `ConnectionsClient` and `InvitationsClient` as lazy-loaded dynamic chunks.

17. `[Bug]` **`readShellSummaryAction` uses `Promise.all`, causing single reader failure to abort entire shell batch.**
    - Evidence: `src/app/actions/shell.ts:21`. `await Promise.all(unique.map(async (part) => [part, await SHELL_READERS[part]()] as const))`. If any reader (e.g. `chatSummary` or `workspaceSummary`) throws an unhandled error, `readShellPart("networkPendingCounts")` in `NetworkNotificationsProvider` rejects, destroying the network notification badge count.
    - Fix: Use `Promise.allSettled` in `readShellSummaryAction` so partial reader failures return `{ success: false }` for that part without rejecting sibling parts.

---

## Phase 3 — Invitations Tab: Correctness and Races (14) [FOCUS AREA]

18. `[Bug][UX]` **Project applications are completely filtered out and omitted from the Invitations tab.**
    - Evidence: `src/components/network/InvitationsClient.tsx:100-109`:
      ```tsx
      const projectInvitations = useMemo(() => {
          const incoming = (projectQuery.data?.applications ?? [])
              .filter((invitation) => invitation.status === "pending" && invitation.isInvitation);
      ```
      This explicitly excludes `isInvitation === false`. Project owners who have received applications to their projects can never see, review, or accept them on the Network page. `IncomingProjectApplicationRow.tsx` was created in `src/components/network/` specifically for this, but is orphaned. Spec §16 explicitly mandates: "A tab label change must not conflate professional connection requests and project applications... Project applications: Project and role named explicitly; applicant row; status and review action."
    - Fix: In `InvitationsClient.tsx`, import `IncomingProjectApplicationRow` and add an incoming project applications section for `!invitation.isInvitation`, wiring accept/reject actions.

19. `[Bug][DataLoss]` **Sent project invitations to deleted/archived projects are permanently un-cancellable and stuck in UI.**
    - Evidence: `src/app/actions/applications/internal.ts:3078-3088` (`getSentProjectInvitationsAction`) and `src/lib/projects/project-invitations.ts:55,268-274` (`resolveProjectInvitationInternal`). `getSentProjectInvitationsAction` inner joins `projects` without filtering `isNull(projects.deletedAt)`. When the user clicks "Cancel", `cancelSentProjectInvitationAction` calls `resolveProjectInvitationInternal`, which calls `lockProject` (`WHERE id = ${projectId} AND deleted_at IS NULL`). Because the project was deleted, `lockProject` returns `null`, throwing `"Project is unavailable"`. The cancellation fails, leaving the invitation permanently stuck in the list until its 14-day TTL expires. Moreover, if a project is archived, neither the lead nor the inviter can cancel pending invitations.
    - Fix: In `getSentProjectInvitationsAction`, add `isNull(projects.deletedAt)` to the WHERE clause. In `resolveProjectInvitationInternal`, allow `action === "cancel"` even if `project.status === "archived"`.

20. `[Bug][State]` **Optimistic rollback broken for bulk operations (`acceptAllIncoming`, `withdrawAllSent`, `rejectAllIncoming`) due to exact query key lookup mismatch.**
    - Evidence: `src/hooks/useConnections.ts:773,797,812,858,874,897`. `usePendingRequests` stores its cache under `['connections', 'pending-requests', limit, { includeSent }]`. However, all three bulk mutations attempt to snapshot state using `const previousPending = queryClient.getQueryData(['connections', 'pending-requests'])` (exact key match). Because no query matches `['connections', 'pending-requests']` exactly, `previousPending` is always `undefined`. When a mutation fails or is rate-limited, `context?.previousPending` is `undefined`, so rollback fails and the UI remains permanently cleared/empty.
    - Fix: In all three mutations, snapshot matching queries using `queryClient.getQueriesData({ queryKey: ['connections', 'pending-requests'] })`, and restore each matched tuple `[key, data]` on error.

21. `[Sec][Privacy]` **`getIncomingApplicationsAction` and `listInvitationsInternal` bypass privacy projections and leak deleted user data.**
    - Evidence: `src/app/actions/applications/internal.ts:1928-1930,1940-1947,671-708`. Unlike `getConnectionsFeed` (which calls `resolvePrivacyRelationships` and projects every person through `buildViewerScopedProfileView`), `getIncomingApplicationsAction` extracts raw profile fields (`fullName`, `skills`, `headline`, `avatarUrl`) and exposes them directly. Furthermore, `listInvitationsInternal` left-joins `profiles` without `isNull(profiles.deletedAt)`.
    - Fix: Add `isNull(other.deletedAt)` to `listInvitationsInternal` line 701, and pass `mappedApps` and `mappedInvites` through `buildViewerScopedProfileView` before returning.

22. `[Bug][UX]` **`IncomingProjectApplicationRow` displays spinning loader on Accept button when Reject is clicked.**
    - Evidence: `src/components/network/IncomingProjectApplicationRow.tsx:32-37,82-89`. The component receives a single boolean prop `busy`. On line 83, the Accept button renders `{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}` while Reject on line 87 renders a static `<X className="h-3.5 w-3.5" />`. When the user clicks "Reject", `busy` becomes `true`, causing the "Accept" button to spin, misleading the user into believing their rejection is accepting the candidate.
    - Fix: Replace `busy: boolean` in `IncomingProjectApplicationRowProps` with `isAccepting?: boolean; isRejecting?: boolean`, spinning only the clicked action.

23. `[A11y]` **Conditional heading rendering causes dangling `aria-labelledby` on Connection Invitations section.**
    - Evidence: `src/components/network/InvitationsClient.tsx:256-260`. `<section aria-labelledby="connection-invitations-heading">` conditionally renders its `h2` only if `{projectInvitations.length || sentConnectionRequests.length || sentProjectInvitations.length}` is truthy. In the standard scenario where a user has only incoming connection requests, the `<h2>` is omitted, leaving `<section aria-labelledby="connection-invitations-heading">` pointing to an element ID that does not exist in the DOM (WCAG 2.1 SC 1.3.1 violation).
    - Fix: Always render `<h2 id="connection-invitations-heading">`, adding `className={cn("nb-micro mb-3", !hasOtherSections && "sr-only")}` if visually hidden when sole section.

24. `[Bug][UX]` **Unhandled Promise Rejection on "Cancel all" sent connection requests.**
    - Evidence: `src/components/network/InvitationsClient.tsx:159-161,363`. `handleWithdrawAllSent` simply executes `await withdrawAllSent.mutateAsync()`. If the server rate limits the user (`connections-withdraw-all` allows 6/min) or fails, the rejected promise is unhandled in `InvitationsClient`, triggering an uncaught runtime error with no toast notification or user explanation.
    - Fix: Wrap `handleWithdrawAllSent` in `toast.promise(withdrawAllSent.mutateAsync(), { loading: "Cancelling sent requests...", success: "Cancelled sent requests", error: (e) => e?.message || "Failed to cancel requests" })`.

25. `[Bug]` **Accepting or declining connection requests leaves the shell badge count stale.**
    - Evidence: `src/components/network/InvitationsClient.tsx:135-149`. `acceptConnection` and `declineConnection` call `acceptRequest.mutateAsync` and `rejectRequest.mutateAsync`, but never call `refreshPendingCounts()` or `refreshInvitationSurfaces()`. The tab badge in `NetworkClient` remains un-decremented until page reload.
    - Fix: Call `void refreshPendingCounts()` in `acceptConnection` and `declineConnection` upon settlement.

26. `[Bug]` **Realtime notification handler fails to invalidate `joinRequests(50)` due to queryKey limit mismatch.**
    - Evidence: `src/components/providers/NetworkNotificationsProvider.tsx:106`:
      ```tsx
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspace.joinRequests(), refetchType: "active" });
      ```
      `queryKeys.workspace.joinRequests()` defaults to `limit: 20` (`["workspace", "joinRequests", 20]`). `InvitationsClient.tsx:54` queries `queryKeys.workspace.joinRequests(50)` (`["workspace", "joinRequests", 50]`). TanStack Query array prefix matching fails because the 3rd element differs (`20` vs `50`). Realtime events for project invitations never invalidate `InvitationsClient`.
    - Fix: Define `joinRequestsRoot: () => ["workspace", "joinRequests"] as const` in `query-keys.ts`, and invalidate `queryKeys.workspace.joinRequestsRoot()`.

27. `[Bug]` **Sent project invitations are completely missing from Realtime invalidation.**
    - Evidence: `src/components/providers/NetworkNotificationsProvider.tsx:88-117`. When another user accepts or declines a project invitation, the sent list on `InvitationsClient` (`queryKeys.workspace.sentProjectInvitations(50)`) is never invalidated in real-time.
    - Fix: Add invalidation for `queryKeys.workspace.sentProjectInvitations()` when workspace/application decision events arrive.

28. `[Bug]` **No pagination on Invitations tab: lists silently truncate at 50 items.**
    - Evidence: `src/components/network/InvitationsClient.tsx:52,58,68`. `usePendingRequests(50)`, `getIncomingApplicationsAction({ limit: 50 })`, and `getSentProjectInvitationsAction({ limit: 50 })` hardcode `limit: 50` with no cursor pagination, infinite scroll, or "Load more" button. If a user has >50 items, subsequent items are completely hidden and unreachable while the badge shows the real total.
    - Fix: Implement infinite pagination or a "Load more" button when `hasMore` is true.

29. `[Bug]` **Declined connection requests have no Undo affordance, despite server supporting 15-second undo window.**
    - Evidence: `src/app/actions/connections.ts:2183,2199-2238` implements `undoUntil` and `undoRejectConnectionRequest`. But `src/components/network/InvitationsClient.tsx:143-149` shows a simple toast with no action: `toast.promise(..., { success: "Invitation declined" })`.
    - Fix: Attach an Undo action button to the sonner toast: `action: { label: "Undo", onClick: () => undoReject(id) }`.

30. `[Bug]` **"Cancel all" sent connection requests has no confirmation dialog.**
    - Evidence: `src/components/network/InvitationsClient.tsx:361-369`. Clicking "Cancel all" immediately calls `handleWithdrawAllSent()` with no confirmation modal or prompt, making accidental triggers on mobile easy.
    - Fix: Wrap in `ConfirmDialog` (`title="Cancel all sent requests?"`, `description="This will withdraw all pending connection requests you sent."`).

31. `[Bug]` **`getIncomingApplicationsAction` combines applications and invitations with broken tie-breaking cursor.**
    - Evidence: `src/app/actions/applications/internal.ts:1990-1994`. `mappedApps` and `mappedInvites` are combined and sorted by `createdAt` diff, falling back to `b.id.localeCompare(a.id)`. But `id` compares a role application UUID against a project invitation UUID from two disjoint tables.
    - Fix: Scope compound cursor to `(createdAt, source, id)`.

---

## Phase 4 — Suggested and Connections Tabs: Correctness (15)

32. `[Bug]` **Suggestions feed infinite scroll is hard-capped at 50 profiles because precomputed suggestions cap is 50 and fallback query is gated out on pagination.**
    - Evidence: `src/inngest/functions/social-graph-suggestions.ts:150` limits precomputed suggestions to 50 rows. In `src/app/actions/connections.ts:1133`, the fallback query only runs if `!suggestionCursor`. Once a user scrolls past page 2 (50 items), `hasMore` evaluates to `false` (line 1286). Even if a cursor were sent, `!suggestionCursor` evaluates to `false`, completely blocking the fallback query from running. At 1M users, no user can ever browse beyond 50 suggested collaborators.
    - Fix: In `connections.ts:1133`, allow fallback transition when `rows.length < limit` by continuing into `fallbackRows`, and encode a fallback cursor rather than returning `hasMore: false`.

33. `[Bug]` **Cold-start suggestion feed completely lacks keyset cursor pagination support for non-search discovery.**
    - Evidence: `src/app/actions/connections.ts:1189-1195, 1226-1232`. When `searchPattern` is false (cold-start browsing without search when precomputed suggestions are empty or exhausted), line 1189 only builds cursor conditions `if (searchPattern && ...)`. Furthermore, lines 1226-1232 only compute `searchFallbackHasMore` and `searchFallbackNextCursor` when `searchPattern` is true! When `!searchPattern`, `searchFallbackNextCursor` remains `null`. Even with draft fix #20, cold-start pagination cannot advance past page 1.
    - Fix: Add keyset cursor parsing and condition for `(profiles.lastActiveAt, profiles.id)` when `!searchPattern`, and generate `encodeConnectionsCursor(lastFallbackRow.lastActiveAt, lastFallbackRow.id, 'recent')`.

34. `[Bug]` **Cold-start suggestion feed infinite scroll truncates at page 1 because `hasMore` checks empty `rows`.**
    - Evidence: `src/app/actions/connections.ts:1286`:
      ```typescript
      const hasMore = searchPattern ? searchFallbackHasMore : rows.length > limit;
      ```
      When a cold user has no precomputed suggestions, `rows.length === 0`. The fallback query (`fallbackRows`) runs and populates `items`. But line 1286 checks `rows.length > limit` (which is `0 > 20 === false`), so `hasMore` is `false` and `nextCursor` is `null`. A new user can never load more than 20 suggestions.
    - Fix: Check `fallbackRows.length > limit` when `rows.length === 0`, and encode the fallback cursor.

35. `[Bug]` **Blocking a profile from PersonCard or ConnectionsClient does not optimistically remove them from the UI feed.**
    - Evidence: `src/hooks/useConnections.ts:949-956` and `src/components/network/PersonCard.tsx:202-216`. `blockProfile.onMutate` only filters `queryClient`'s `['connections', 'pending-requests']`. It does NOT filter `['connections', 'feed', 'discover']` or `['connections', 'feed', 'network']`. In `PersonCard.tsx`, `handleBlock` does not update `localStatus` or remove the card. The blocked user remains mounted and clickable until background refetch settles.
    - Fix: In `useConnections.ts:950`, update `['connections', 'feed', 'network']` and `['connections', 'feed', 'discover']` to filter out `targetUserId`, and decrement `totalConnections` in stats.

36. `[Bug][A11y]` **Redundant presence store subscriptions: every single `PersonCard` mounts two independent `usePersonPresence` hook instances.**
    - Evidence: `src/components/network/PersonCard.tsx:302, 307`. Line 302 mounts `<PersonPresenceDot userId={profile.id} ... />` (which invokes `usePersonPresence`), and line 307 mounts `<PersonPresenceText userId={profile.id} ... />` (which invokes a second `usePersonPresence`). For 100 mounted cards, 200 React Query presence subscriptions and re-renders occur instead of 100.
    - Fix: Call `usePersonPresence` once at the top of `PersonCard.tsx` and pass the resolved presence view down to both the dot and the screen-reader text.

37. `[Bug][UX]` **"Connected" status on PersonCard renders as a dead static badge with no messaging action or dropdown affordance.**
    - Evidence: `src/components/network/PersonCard.tsx:288-291`. When `status === "connected"`, the card renders `<span className="... text-[var(--status-success)]"><Check /> Connected</span>`. Unlike `ConnectionsClient` (which offers "Message", "Disconnect", "Block"), `PersonCard` provides no interactive message button or options menu for connected collaborators.
    - Fix: Render a "Message" action link (`/messages?userId=${profile.id}`) or an action dropdown when `status === "connected"`.

38. `[Bug]` **`checkConnectionStatus` returns `status: 'open'` which is unhandled by `PersonCard`, rendering a blank action slot.**
    - Evidence: `src/app/actions/connections.ts:2583-2592` and `src/components/network/PersonCard.tsx:218-295`. When `canSendMessage` is true, `checkConnectionStatus` returns `status: 'open'`. `PersonCard.tsx` only handles `none`, `pending_sent`, `pending_received`, `connected`, `blocked`. If `status === 'open'`, `action` resolves to `null` and the button completely disappears.
    - Fix: In `PersonCard.tsx:218`, handle `status === 'open'` and render a "Message" button or dropdown.

39. `[Bug]` **`PersonCardGrid` sliding window slices away earlier items without virtual spacers, causing scroll collapse.**
    - Evidence: `src/lib/network/person-card-bounds.ts:4-8`: `items.slice(items.length - MAX_MOUNTED_PERSON_CARDS)` in `PersonCard.tsx:96`. Dropping cards 0..N from the DOM without virtual windowing spacers causes the scrollbar to jump upward by thousands of pixels when crossing 500 items.
    - Fix: Remove top-slicing in un-virtualized DOM; preserve loaded items with `[content-visibility:auto]`.

40. `[Bug]` **Disconnect and Block actions in `ConnectionsClient` have no confirmation dialog.**
    - Evidence: `src/components/network/ConnectionsClient.tsx:143-145`. In the dropdown menu, clicking "Disconnect" or "Block profile" immediately mutates the database without confirmation.
    - Fix: Wrap both actions in `ConfirmDialog`.

41. `[Bug]` **`PersonPresenceText` missing in `ConnectionsClient`, leaving presence dot inaccessible to screen readers.**
    - Evidence: `src/components/network/ConnectionsClient.tsx:108` renders `<PersonPresenceDot userId={user.id} ... />`, but omits `<PersonPresenceText />`. Screen readers hear the user's name with no presence or availability status.
    - Fix: Include `<PersonPresenceText userId={user.id} lastActiveAt={user.lastActiveAt} />` inside the heading in `ConnectionCard`.

42. `[Bug]` **Connecting state on `PersonCard` has no visual loading spinner or native disabled attribute.**
    - Evidence: `src/components/network/PersonCard.tsx:222-230`: `aria-disabled={connecting || undefined}` is set, but the native `<button>` has no `disabled` prop and no `<Loader2>` spinner.
    - Fix: Add `disabled={connecting}` and render `<Loader2 className="size-3.5 animate-spin mr-1.5" />` when `connecting` is true.

43. `[Bug]` **`useSkillCatalog()` hook called per card creates N redundant external store subscriptions.**
    - Evidence: `src/components/network/PersonCard.tsx:142` and `ConnectionsClient.tsx:96` both call `useSkillCatalog()` inside each individual card component. With 50 cards mounted, 50 subscriptions are registered to the external store.
    - Fix: Hoist `useSkillCatalog()` to parent tab clients.

44. `[Bug][Perf]` **`ConnectionCard` is not memoized with `React.memo`, triggering full list re-renders on any parent state change.**
    - Evidence: `src/components/network/ConnectionsClient.tsx:87`. `function ConnectionCard(...)` is exported without `React.memo`, unlike `PersonCard.tsx:339` which wraps in `memo(PersonCard)`. Every keystroke in the search bar re-renders all mounted connection cards.
    - Fix: Wrap `ConnectionCard` in `React.memo`.

45. `[Bug][Perf]` **Unmemoized skill matching and sorting in `PersonCard` recomputes canonical keys and Sets on every render.**
    - Evidence: `src/components/network/PersonCard.tsx:153-157`. `matchingSkillLabels`, `matchingSkills.map(canonicalSkillKey)`, and `[...(profile.skills ?? [])].sort(...)` execute unmemoized inside the component body on every render tick.
    - Fix: Wrap `skills` calculation in `useMemo(() => ..., [profile.skills, viewerSkills])`.

46. `[Bug]` **`getAcceptedConnections` does not filter out deleted profiles (`deletedAt IS NULL`).**
    - Evidence: `src/app/actions/connections.ts:2391-2397`. Unlike `getConnectionsFeedImpl` (which includes `isNull(profiles.deletedAt)` in line 665), `getAcceptedConnections` queries `connections.status = 'accepted'` without checking `isNull(profiles.deletedAt)`. Deleted profiles leak into external connection listings.
    - Fix: Add `isNull(profiles.deletedAt)` to `conditions` array in `getAcceptedConnections`.

---

## Phase 5 — Accessibility (10)

47. `[A11y]` **Outlines and focus rings are stripped with `!important` on `.nb-person-connect`, violating Spec §34 keyboard accessibility targets.**
    - Evidence: `src/app/globals.css:986-994`. `.nb-person-connect:focus, .nb-person-connect:focus-visible` sets `outline: none !important; --tw-ring-shadow: 0 0 #0000 !important; box-shadow: none !important;`. The only visual change on focus is a subtle background darkening, providing no distinguishable border or focus ring for keyboard navigation per Spec §34.
    - Fix: Remove `.nb-person-connect` from the `!important` outline stripping block in `globals.css` and add a high-contrast focus ring token (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`).

48. `[A11y]` **Sub-44px touch targets on mobile for connection action buttons in `PersonCard` and `ConnectionsClient`.**
    - Evidence: `src/components/network/PersonCard.tsx:226, 238, 285` (`h-[var(--ui-control-height)]` = 36px) and `src/components/network/ConnectionsClient.tsx:128` (`h-9` = 36px). Spec §34 explicitly requires: "Use at least 44px touch targets as the proposed product target; do not make adjacent removal/overflow actions overlap."
    - Fix: Add `max-md:min-h-[44px] min-w-[44px]` to person-card buttons and dropdown triggers on mobile viewports.

49. `[A11y]` **Accept button in `InvitationsClient` lacks `.nb-touch-target` (fails 44px mobile touch target).**
    - Evidence: `src/components/network/InvitationsClient.tsx:470`. While the Decline button (line 466) and CancelButton (line 485) include `nb-touch-target`, the Accept button uses only `className="nb-person-connect"` (34px tall).
    - Fix: Add `nb-touch-target` to the Accept button: `className="nb-touch-target nb-person-connect"`.

50. `[A11y]` **Invalid ARIA: `aria-current="page"` used alongside `role="tab"` and `aria-selected="true"`.**
    - Evidence: `src/components/network/NetworkClient.tsx:160-163`:
      ```tsx
      <button role="tab" aria-selected={selected} aria-current={selected ? "page" : undefined} ...>
      ```
      In WAI-ARIA tab patterns, `aria-current` is invalid on `role="tab"` and causes screen readers to redundantly announce "tab, selected, current page".
    - Fix: Remove `aria-current={selected ? "page" : undefined}` from tab buttons.

51. `[A11y]` **Dangling `aria-controls` references unmounted tabpanels.**
    - Evidence: `src/components/network/NetworkClient.tsx:163,182`: Each tab specifies `aria-controls={`people-panel-${tab.key}`}`, but the container only renders `id={`people-panel-${activeTab}`}`. Inactive tabs point to non-existent DOM IDs.
    - Fix: Omit `aria-controls` on unrendered tabs, or ensure panel ID matches.

52. `[A11y]` **Tab keyboard navigation uses automatic activation on arrow keys without roving focus commit.**
    - Evidence: `src/components/network/NetworkClient.tsx:115-128`: `handleTabKeyDown` immediately navigates (`navigateTab(next.key)`) on `ArrowLeft` / `ArrowRight`. For tabs with heavy route/data sync, manual activation (arrow keys move focus, Space/Enter selects) or smooth roving focus prevents unwanted URL changes on quick arrow navigation.
    - Fix: Separate focus movement from tab navigation; activate on Enter/Space.

53. `[A11y]` **Avatar links in `ConnectionsClient` and `InvitationsClient` are redundant tab stops without accessible labels.**
    - Evidence: `src/components/network/ConnectionsClient.tsx:106` and `InvitationsClient.tsx:271,304,337,387`: `<Link href={profileHref(...)} className="...">` is fully focusable with no `aria-label`, so keyboard users tab through two identical links in a row: the avatar image link and the name link.
    - Fix: Add `tabIndex={-1} aria-hidden="true"` to avatar links (matching `PersonCard.tsx:300`).

54. `[A11y]` **Dropdown menu triggers in `ConnectionsClient` and `PersonCard` lack descriptive labels on mobile.**
    - Evidence: `src/components/network/PersonCard.tsx:247` and `ConnectionsClient.tsx:130`: `<span className="max-sm:sr-only">Connected</span>`. On mobile, only icons are visible. The accessible name must retain full context.
    - Fix: Set `aria-label={`Connection options for ${displayName}`}` explicitly.

55. `[A11y]` **Search clear button lacks scoped accessible label per Design Spec §34.**
    - Evidence: `src/components/ui/SearchField.tsx:48-50`. Design Spec §34 explicitly requires: *"Search clear buttons name the search scope."* The clear button hardcodes `aria-label="Clear search"`.
    - Fix: In `SearchField.tsx:48`, change to `aria-label={`Clear ${label.toLowerCase()}`}` (e.g. `"Clear search your network"`).

56. `[A11y]` **Cascading live region announcements during dynamic client hydration.**
    - Evidence: `NetworkRouteSkeleton.tsx:6-12` announces `"Loading network…"`, `NetworkClient.tsx:28-29` (`TabLoading`) announces `"Loading tab content…"`, and `NetworkPeopleTab.tsx:41-42` announces `"Loading suggested people…"`. Due to `ssr: false` chaining, screen readers announce 3 separate loading messages in under a second. Design Spec §33 mandates: *"Announce loading once without repeated screen-reader chatter. Decorative skeleton blocks are hidden from assistive technology."*
    - Fix: Add `aria-hidden="true"` to `TabLoading` in `NetworkClient.tsx:27-34` and remove redundant live regions from inner tab skeletons.

---

## Phase 6 — UI, UX, States and Design-Spec Conformance (9)

57. `[UX]` **Spec §16 conformance: Layout shift (CLS) between `NetworkRouteSkeleton` (24px gap) and `NetworkClient` (20px gap) vs Spec §16 (18px gap).**
    - Evidence: `src/components/network/NetworkRouteSkeleton.tsx:28` uses `mt-6` (24px) gap above card skeletons; `src/components/network/NetworkClient.tsx:182` uses `pt-5` (20px). Design Spec §16 mandates: *"underlined tabs with mono counts, 18px gap before results."* The mismatch causes a 4px upward jump during hydration, degrading CLS.
    - Fix: Standardize both `NetworkRouteSkeleton.tsx:28` and `NetworkClient.tsx:182` to `pt-[18px]` / `mt-[18px]`.

58. `[UX]` **Tab badges display "0" during initial loading instead of em-dash per Design Spec §33.**
    - Evidence: `src/components/network/NetworkClient.tsx:87,103-106`. Before `suggestedQuery` or `networkPendingCounts` resolves, counts default to `0`, displaying `"Connections 0"` and `"Invitations 0"` on initial paint before abruptly jumping to real counts. Design Spec §33 specifies: *"Unknown count is an em dash or omitted, never silently zero."*
    - Fix: Return `suggestedQuery.isLoading ? "—" : tabCount(tab.key)` in `NetworkClient.tsx:175`.

59. `[UX]` **Headline typography in `ConnectionsClient` violates Spec §12 (uses 15px `nb-body` instead of 13px `nb-compact`).**
    - Evidence: `src/components/network/ConnectionsClient.tsx:120`. `headline ? <p className="nb-body truncate text-muted-foreground" title={headline}>{headline}</p> : null`. Spec §12 specifies: "13px professional headline". `PersonCard.tsx:324` correctly uses `nb-compact` (13px), but `ConnectionsClient` uses `nb-body` (15px).
    - Fix: Replace `nb-body` with `nb-compact line-clamp-2` in `ConnectionsClient.tsx:120`.

60. `[UX]` **Skill tag gap in `PersonCard` is 6px instead of spec-mandated 5px.**
    - Evidence: `src/components/network/PersonCard.tsx:127`. `PERSON_CARD_TAGS = "flex h-6 min-w-0 flex-wrap gap-1.5 overflow-hidden"`. Spec §12 specifies: "22px skill tags with 5px gaps". `gap-1.5` in Tailwind is 6px (0.375rem).
    - Fix: Change `gap-1.5` to `gap-[5px]` in `PERSON_CARD_TAGS`.

61. `[UX]` **Missing stacked/header-first responsive variant for narrow mobile screens (<380px), squeezing names to under 75px.**
    - Evidence: `src/components/network/PersonCard.tsx:59-67`. `PersonCardLayout` enforces a single horizontal flex row (`avatar`, `min-w-0 flex-1`, `aside`). On a 320px viewport with 40px padding and a 125px "Requested" dropdown button, the name column is compressed to ~73px, truncating virtually every name. Spec §12 mandates: "In a 320px rail, use a stacked/header-first variant rather than squeezing long names between avatar and button."
    - Fix: In `PersonCardLayout`, wrap avatar, name, and action in `flex-wrap max-xs:flex-col` or move `aside` below header on narrow viewports.

62. `[UX]` **Connections tab lacks sort order controls (Recent, Name A-Z, Oldest), despite backend fully supporting them.**
    - Evidence: `src/components/network/ConnectionsClient.tsx:25`. `useConnections(50, debouncedSearch || undefined, "recent")` hardcodes `"recent"`. Spec §16 and backend `connections.ts:660` provide full support for `sortBy: 'recent' | 'name' | 'oldest'`, but no UI selector or tab filter exists.
    - Fix: Add a compact Sort dropdown (`Recent`, `Name (A-Z)`, `Oldest`) above the connections grid, synced to query state.

63. `[UX]` **Spec §16 conformance: Missing request history timeline / date buckets.**
    - Evidence: Spec §16 specifies: "Request history: Date buckets Today/Yesterday/This week/Earlier; fine vertical rule if using a timeline. Outcome badge and 13px reason/context; dates 12px mono. Expand/collapse remains keyboard-operable." `src/app/actions/connections.ts:326` defines `historyFilters`, but `InvitationsClient` has no history view.
    - Fix: Add a collapsible "History" accordion in `InvitationsClient` grouped by `Today / Yesterday / Earlier`.

64. `[UX]` **Empty search results state in `ConnectionsClient` does not offer "Clear search".**
    - Evidence: `src/components/network/ConnectionsClient.tsx:58-65` shows `EmptyState` with `action` only when `!debouncedSearch`. When searching and 0 matches are found, it provides no "Clear search" button.
    - Fix: When `searchQuery` is present and items are 0, add an action button `Clear search` that resets `searchValue` to `""`.

65. `[UX]` **Spec §33: Partial error states masquerade as empty states in `ConnectionsClient` and `NetworkPeopleTab`.**
    - Evidence: `src/components/network/NetworkPeopleTab.tsx` and `ConnectionsClient.tsx` do not handle `isError` or `error` state. If `useSuggestedPeople` or `useConnections` fails, they fall through to `profiles.length === 0` and display "No suggestions yet" / "Your connections live here". A network failure looks like an empty network.
    - Fix: Add explicit `isError` check with retry button.

---

## Phase 7 — Performance at 1M Users (9)

66. `[Perf]` **Realtime connection acceptance leaves active connections list and suggestions feed stale.**
    - Evidence: `src/components/providers/NetworkNotificationsProvider.tsx:101-104`. When `connection_request_accepted` arrives, the handler invalidates only `pending()` (`["connections", "pending"]`) and `["connections", "pending-requests"]`. It fails to invalidate `CONNECTIONS_QUERY_KEYS.feed('network', ...)` (prefix `["connections", "feed"]`). The user on `/network?tab=connections` does not see their newly accepted connection until a manual reload.
    - Fix: In `NetworkNotificationsProvider.tsx:101-104`, invalidate `queryKeys.connections.root()` (`["connections"]`), which prefix-matches pending counts, pending requests, active connections feed, and suggestions simultaneously.

67. `[Perf]` **Unconditional `workspace.root()` invalidation refetches entire workspace on every connection event.**
    - Evidence: `src/components/providers/NetworkNotificationsProvider.tsx:100`. Inside the 150ms debounce callback, `queryClient.invalidateQueries({ queryKey: queryKeys.workspace.root(), refetchType: "active" })` executes unconditionally. Even when only a `connection_request_received` arrives, tasks, summary, members, and sprints are refetched across the application.
    - Fix: Guard the workspace invalidation with `if (domains.has("tasks") || domains.has("requests")) { void queryClient.invalidateQueries({ queryKey: queryKeys.workspace.root(), refetchType: "active" }); }`.

68. `[Perf]` **Realtime notification deletions and withdrawals are ignored by reading only `payload.new`.**
    - Evidence: `src/components/providers/NetworkNotificationsProvider.tsx:38-43`. `workspaceNotificationKind` reads `const payload = event.payload.new as Record<string, unknown>`. On Supabase Realtime Postgres `DELETE` events, `event.payload.new` is null/undefined and the record data resides in `event.payload.old`. The function returns `null`, skipping cache invalidation and leaving pending badge counts inflated.
    - Fix: Read `const payload = (event.payload.new ?? event.payload.old) as Record<string, unknown> | undefined;`.

69. `[Perf]` **`usePendingRequests` runs duplicate parallel `getConnectionStatsForUser` table scans on mount.**
    - Evidence: `src/hooks/useConnections.ts:430-435` and `src/app/actions/connections.ts:644-646,516-532`. `usePendingRequests` fires `Promise.all([ getConnectionsFeed({ tab: 'requests_incoming' }), getConnectionsFeed({ tab: 'requests_sent' }) ])`. Because `includeMeta` defaults to `true`, both feeds independently execute `getConnectionStatsForUser(user.id)`, firing two concurrent full table scans (`count(*) FILTER (...)` over `connections`) for the exact same user.
    - Fix: Pass `includeMeta: false` to `getConnectionsFeed({ tab: 'requests_sent', limit, includeMeta: false })` in `usePendingRequests`.

70. `[Perf]` **`getConnectionStatsForUser` executes a full table scan with `COUNT(*) FILTER` over `connections` on every feed request.**
    - Evidence: `src/app/actions/connections.ts:516-532`: Even when querying page 2 or 3 of suggestions with `includeMeta: true`, `getConnectionStatsForUser` executes 3 `COUNT(*) FILTER` aggregations against the live `connections` table. At 1M users with hundreds of thousands of connection rows, this query is slow and repetitive.
    - Fix: Read `profiles.connections_count` for `totalConnections`. Cache stats in Redis with 60s TTL; omit stats calculation on cursor pagination.

71. `[Perf]` **Missing composite index for pending connection requests order.**
    - Evidence: `src/lib/db/schema/index.ts:596-603`. Query filters `(status, addressee_id)` and sorts `created_at DESC`. Postgres must perform an index scan followed by an in-memory Sort.
    - Fix: Add composite index `connections_incoming_pending_idx` on `(addressee_id, status, created_at DESC, id DESC)` and `connections_sent_pending_idx` on `(requester_id, status, created_at DESC, id DESC)`.

72. `[Perf]` **Unindexed `EXISTS (SELECT 1 FROM jsonb_array_elements_text(...) ILIKE ...)` performs per-row sequential scan in discover search at 1M scale.**
    - Evidence: `src/app/actions/connections.ts:473-486`. In `buildDiscoverProfileSearchCondition`, skills and interests searches unroll jsonb arrays per row with `jsonb_array_elements_text(...)` and run `ILIKE`. This completely bypasses the GIN index on `profiles.skills`, resulting in a full table scan across 1M rows on every search query.
    - Fix: Use GIN jsonb containment (`@>`) or pg_trgm GIN expressions on skills.

73. `[Perf]` **Inner join with `OR` on connection participants forces inefficient nested-loop evaluation across 1M rows.**
    - Evidence: `src/app/actions/connections.ts:726-729` and `src/app/actions/connections.ts:2436-2444`. The queries join `profiles` on `or(and(requester_id = user.id, addressee_id = profiles.id), and(addressee_id = user.id, requester_id = profiles.id))`. Postgres cannot optimize an `OR` in an inner join `ON` condition with standard hash or merge joins.
    - Fix: Refactor into a `UNION ALL` of outgoing connections and incoming connections, or join on `profiles.id = CASE WHEN requester_id = user.id THEN addressee_id ELSE requester_id END`.

74. `[Perf]` **`invalidateDiscoverCacheForUser` fails to invalidate search preview cache keys, serving stale relationships for 180 seconds.**
    - Evidence: `src/lib/connections/internal-helpers.ts:14-17` and `src/app/actions/connections.ts:1334`. `invalidateDiscoverCacheForUser` scans and unlinks `discover:profile:${userId}:*` and `connections:inbox_cache:${userId}:*`, but omits `search:preview:people:v2:${userId}:*`. Connection changes remain invisible in search preview for up to 3 minutes.
    - Fix: Add `search:preview:people:v2:${userId}:*` to the cache patterns in `internal-helpers.ts:15`.

---

## Phase 8 — Dead Code and Cuts (Ponytail Audit) (9)

75. `[Cut]` **Delete `src/lib/network/person-card-bounds.ts` completely (dead/harmful sliding window slice).**
    - Evidence: `src/lib/network/person-card-bounds.ts:1-9`. Slicing items from the head of the array destroys scroll position when crossing 500 items. CSS `[content-visibility:auto]` already solves offscreen rendering natively.
    - Fix: Delete `person-card-bounds.ts` and remove wrapper in `PersonCard.tsx:96`.

76. `[Cut]` **Remove unused destructured `sendRequest` mutation in `InvitationsClient.tsx:73`.**
    - Evidence: `const { acceptRequest, rejectRequest, sendRequest, cancelRequest, withdrawAllSent } = useConnectionMutations();`. `sendRequest` is never used.
    - Fix: Delete `sendRequest` from destructuring.

77. `[Cut]` **Dead / unused imports in `NetworkClient.tsx:7`.**
    - Evidence: `import { Search, X } from "lucide-react";`. Neither `Search` nor `X` is used in `NetworkClient.tsx`.
    - Fix: Remove unused `Search, X` imports.

78. `[Cut]` **Move orphaned component `src/components/network/RequestProfileRow.tsx` to `src/components/workspace/`.**
    - Evidence: `RequestProfileRow.tsx` is located under `src/components/network/`, but is never used by any network component (only used in `WorkspaceRequestsTab.tsx`).
    - Fix: Move `RequestProfileRow.tsx` to `src/components/workspace/`.

79. `[Cut]` **Delete phantom query key `["network", "project-applications"]`.**
    - Evidence: `NetworkNotificationsProvider.tsx:107`, `InvitationsClient.tsx:128`. This key is never queried by any component in the entire codebase.
    - Fix: Remove invalidation calls for `["network", "project-applications"]`.

80. `[Cut]` **Remove non-existent notification kinds from `WORKSPACE_NOTIFICATION_KINDS`.**
    - Evidence: `NetworkNotificationsProvider.tsx:23-24`. Lists `"workflow_assigned"`, `"workflow_resolved"`, which do not exist in `NotificationKind`.
    - Fix: Delete both entries and add `"project_application_activity"`.

81. `[Cut]` **Remove dead query key `CONNECTIONS_QUERY_KEYS.requestHistory` and schema parameters.**
    - Evidence: `useConnections.ts:184` and `connections.ts:111-116,126,566`.
    - Fix: Remove `historyFilters` and `requestHistory` until the timeline feature is implemented.

82. `[Cut]` **Remove duplicate `desc(profiles.id)` order clause in fallback discovery query.**
    - Evidence: `src/app/actions/connections.ts:1221`. `desc(profiles.id)` is appended twice to the SQL ORDER BY statement.
    - Fix: Remove the duplicate statement.

83. `[Cut]` **Replace fragile regex test in `network-notifications-provider.test.ts`.**
    - Evidence: `tests/unit/network-notifications-provider.test.ts:14-18` reads source files from disk with `fs.readFileSync` and runs regex assertions against code strings.
    - Fix: Replace with a functional unit test exercising `NetworkNotificationsProvider`.

---

## Execution Order and Conventions

**Phases.** 1 → 8, one commit per phase.
1. Phase 1: Security (6 items)
2. Phase 2: Regressions & Shell Bugs (11 items)
3. Phase 3: Invitations Tab [Focus Area] (14 items)
4. Phase 4: Suggested & Connections Tabs (15 items)
5. Phase 5: Accessibility (10 items)
6. Phase 6: UI, UX & Design-Spec Conformance (9 items)
7. Phase 7: Performance at 1M Users (9 items)
8. Phase 8: Dead Code & Cuts (9 items)

**Conventions.**
- Work on local main; commit only Network files using explicit `git add` paths.
- Follow CLAUDE.md workflow: `ponytail-audit` at the start of each phase, TDD for SQL/query changes, benchmark before and after Phases 3, 4, and 7, `ponytail-review` then `review`.
- No live database changes without user OK, and no push.
- Migration numbering: check next available migration in `drizzle/` (current max ~0211), register in journal and `standards/sql-governance.manifest.json`.
- Expected migrations:
  - Composite indexes `connections_incoming_pending_idx` on `(addressee_id, status, created_at DESC, id DESC)` and `connections_sent_pending_idx` on `(requester_id, status, created_at DESC, id DESC)`.

---

## Verification

- `npx tsc --noEmit`
- `npm run -s lint`
- `npm run -s test:unit`
- `npm run -s check:sql-governance`
- **Unit and contract tests per phase:**
  - `NetworkNotificationsProvider` invalidates `joinRequestsRoot` and `connections.root()`;
  - Double debounce removed: search debounce executes exactly once;
  - Cold-start suggestions query returns `hasMore: true` and paginates with keyset cursors;
  - Rate limiting active on project invitation actions;
  - Deleted and blocked users excluded from pending counts;
  - Blocked users rejected from project invitation resolution.
- **Browser verification (375px mobile, 320px narrow mobile, 1024px tablet, desktop, light + dark mode):**
  - Signed-out visitor on `/network?tab=invitations` sees sign-in prompt;
  - Connecting state shows spinner and disables button;
  - Accepting and declining invitations decrements tab badge immediately;
  - Project applications visible and actionable on Invitations tab;
  - Arrow key navigation on tabs moves focus without premature route replacement;
  - Tabpanel gap measures exactly 18px;
  - Topbar search focuses in-page search bar without opening command palette.
