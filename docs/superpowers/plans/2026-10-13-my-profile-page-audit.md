# My Profile & Public Profile Comprehensive Audit Plan

**Pages Audited**: My Profile (`/my-profile`) and Public Profile (`/u/[username]`)  
**Audited Against**: Design Specification §17 (Profiles, Portfolio, Editing, Restricted Views), §33 (Universal State Matrix), §34 (Accessibility), §35 (Appearance & Dark Mode Tokens), §09 (Responsive/Touch), and Backend Database Findings (`AUTH-011`, `SEC-010`, `VALID-004`, `PERF-013`).  
**Auditors**: 5 Parallel Specialist Subagents (UI/UX completely; Security & Privacy; Edit Profile Forms & Mutations; Backend & 1M Performance; Shell, A11y & Realtime).

---

## Context & Synthesis

### Why
The Profile system is the core identity and portfolio anchor of NetworkBase. Following our comprehensive audits of Messages, Discover, and Network, this audit evaluated the entire profile subsystem across:
1. Routing and server components (`/my-profile`, `/u/[username]`)
2. Client shell and layout (`ProfileV2Client`, `ProfileHeader`, `ProfileTabs`, `ProfileRightRail`, `ProfileShell`, `ProfileRouteSkeleton`)
3. Section cards (`AboutCard`, `OpenToRolesCard`, `ProjectContributionsCard`, `ProjectsGridCard`, `Card`)
4. Modals (`EditProfileModal`, `EditProfileTabs`, `UserConnectionsModal`, `ProfileInviteModal`)
5. Server actions, data layer, and services (`src/app/actions/profile.ts`, `profile-contributions.ts`, `src/lib/data/profile.ts`, `src/lib/services/profile-service.ts`, `src/lib/privacy/*`)

### What Was Verified
- **Authentication & Authorization**: Server mutations strictly bind to `supabase.auth.getUser()`. No IDOR exists on updating other users' profiles or contributions.
- **XSS & Injection**: Text children are rendered via native React escaping (`{bio}`, `{headline}`); no `dangerouslySetInnerHTML` is used.
- **Mutual Connection Masking**: Mutual connection count is masked to `0` when a profile is private or when viewer/target are blocked.
- **Critical Regressions Found**:
  - Avatar uploads immediately update PostgreSQL and bump `updatedAt` without updating the editor's ref, causing a guaranteed `PROFILE_CONFLICT` error when the user clicks "Save Changes".
  - Double-Escape or outside clicks permanently wipe dirty edits without confirmation.
  - Blocker cannot unblock targets from the profile header because `isInteractionBlocked` hides the action dropdown (SEC-010 UI deadlock).
  - Blocked users can overwrite and erase the blocker's block row via `replaceRelationshipWithBlockedState` (SEC-010 block reversal).
  - Target's `lastActiveAt` leaks in the public profile payload to all viewers, ignoring `show_activity: false` (AUTH-011).
  - Severe layout shifts (CLS) caused by skeleton geometry mismatches (highlights card rendered on left in skeleton vs right rail in shell; mobile flex order inversion).
  - Project contributions are completely missing from the Portfolio tab despite Spec §17 requirement.
  - Multiple 1M scale bottlenecks: unindexed OR queries across 3 tables in project aggregation, unthrottled audit log database INSERT on every profile visit, and uncached public profile SSR.

### Keep Deliberately (Things that are fine)
1. **`UserAvatar` 72px squared geometry (`rounded-[3px]`)**: Accurately implements the NetworkBase profile avatar baseline (§17 / §05).
2. **`connections_active_pair_unique`**: `(LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))` constraint guarantees bidirectional pair uniqueness and prevents race condition duplicates.
3. **`PersonPresenceBadge` with `size={22}` anchored to avatar corner**: Cleanly integrates live presence and availability status.
4. **64ch prose limit in `AboutCard.tsx` (`max-w-[64ch]`)**: Respects optimal reading line length for long-form biographical text.
5. **Polled presence over WebSockets (`usePersonPresence`)**: 90s React Query poll with a 16ms window batcher (`createBatcher`) avoids unbounded Supabase Realtime channels and connection socket leaks for viewers browsing profiles.
6. **Sharp WebP optimization and 16MP limit (`publish-profile-image.ts`)**: Strong security barrier against decompression bombs; strips EXIF data and enforces 400x400 cover WebP derivatives.
7. **Rate limits in `src/app/actions/profile.ts`**: Strong per-user defense against avatar upload abuse and handle squatting.
8. **React `cache()` in `readPublicProfileRoute` and `readOwnerProfileRoute`**: Deduplicates database reads across `generateMetadata()` and page rendering within the same request pass.
9. **`ComponentErrorBoundary` on `AboutCard` and `OpenToRolesCard`**: Prevents localized card rendering errors from unmounting the profile shell.

---

## Ponytail Debt

| Area | Shortcut / Debt | Ceiling | Upgrade Trigger |
| :--- | :--- | :--- | :--- |
| **Profile SSR** | Request-scoped React `cache()` without Next.js Data Cache | Fast for individual visits, but full database re-fetch on every hit under traffic spikes | Traffic > 50 concurrent requests/sec to top public profiles |
| **Summary Cache Invalidation** | Process-local `inFlightPromises` Map | Single-replica deduplication only; concurrent multi-pod misses trigger duplicate CTE calculations | Multi-replica deployment or >500k active users |
| **Mutual Connections** | Redis `SINTER` returning string array | Efficient up to ~500 connections; high memory/wire overhead on high-degree network nodes | High-degree influencers with >2,000 connections |
| **Counters** | Imperative increments/decrements in application actions | Minor drift possible on hard database errors or direct DB deletions | Periodic background reconciliation cron |
| **Modal Loading** | Manual `useState` dynamic import on click | Chunk loading latency on first modal open | Move to `next/dynamic({ ssr: false })` at module level |

---

## Phase Execution & Commit Status

| Phase | Description | Scope | Status | Commit |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | Security & Privacy | Items 1–8 | **COMPLETED & VERIFIED** | `6b18580e` |
| **Phase 2** | Regressions, Data Loss & Races | Items 9–14 | **COMPLETED & VERIFIED** | `2c89f871` |
| **Phase 3** | Correctness & Spec §17 Alignment | Items 15–24 | **COMPLETED & VERIFIED** | `89bd736c` |
| **Phase 4** | Accessibility & Mobile Touch Targets | Items 25–31 | **COMPLETED & VERIFIED** | `ac4b35b8` |
| **Phase 5** | UI/UX, States (§33) & Design Spec | Items 32–40 | **COMPLETED & VERIFIED** | `32cef8c8` |
| **Phase 6** | 1M Scale Performance & Caching | Items 41–49 | **COMPLETED & VERIFIED** | `51b3932a` |
| **Phase 7** | Ponytail Cuts & Dead Code Cleanup | Items 50–61 | **COMPLETED & VERIFIED** | `9993f142` |

---

## Phase 1: Security & Privacy (COMPLETED - Commit `6b18580e`)

1. **[Sec] [High] Blocker cannot unblock from profile UI due to `isInteractionBlocked` suppressing action dropdown**
   - *Evidence*: `src/components/profile/v2/profile-action-state.ts:24-38`, `src/components/profile/v2/ProfileHeader.tsx:364-413`
   - *Problem*: `isInteractionBlocked` is `true` when `blockedByViewer` is `true`. Because `showRelationshipAction` requires `!isInteractionBlocked`, the dropdown menu is omitted entirely. A blocker is permanently locked out of unblocking the user from their profile page.
   - *Fix*: Decouple `canManageBlock` from `!isInteractionBlocked` in `resolveProfileActionState`:
     ```ts
     const showRelationshipAction = Boolean(
         isAuthenticated
         && ((!isInteractionBlocked && (hasConnectionMenuAction || showMessageAction)) || canManageBlock),
     )
     ```

2. **[Sec] [High] Block override and removal vulnerability (SEC-010)**
   - *Evidence*: `src/lib/privacy/relationship-transition.ts:12-44`, `src/lib/privacy/blocks.ts:31-35`
   - *Problem*: When user B is blocked by user A, B can call `POST /api/v1/privacy/blocks` with `{ userId: A }`. `replaceRelationshipWithBlockedState` unconditionally deletes ALL connection rows between A and B (including A's block of B) and inserts a block row owned by B. B can then call `DELETE /api/v1/privacy/blocks/A`, completely destroying A's block without A's consent.
   - *Fix*: In `replaceRelationshipWithBlockedState`, check if an existing block row exists where `blockedBy === blockedUserId`. If so, reject the request or retain the blocker's existing block edge.

3. **[Sec] [High] Presence and `lastActiveAt` leak bypasses `show_activity: false` and mutual sharing rules (AUTH-011)**
   - *Evidence*: `src/lib/data/profile.ts:251`, `src/lib/privacy/profile-views.ts:49`, `src/components/profile/v2/ProfileHeader.tsx:218, 236`
   - *Problem*: `getProfileDetails` reads `profiles.last_active_at` and `buildViewerScopedProfileView` includes it whenever `!blocked && canViewProfile`. Anonymous crawlers and visitors receive the target's raw `lastActiveAt` timestamp in the initial RSC payload, bypassing `show_activity: false`.
   - *Fix*: In `buildViewerScopedProfileView:49`, set `lastActiveAt: isOwner ? profile.lastActiveAt ?? null : null`. Let `getPresence` in `src/app/actions/presence.ts` be the sole source of truth for non-owner activity timestamps, honoring `show_activity` and mutual sharing rules.

4. **[Sec] [Med] Private/locked and blocked profiles disclose connection, project, and follower statistics**
   - *Evidence*: `src/lib/data/profile.ts:391-396`, `src/lib/privacy/profile-views.ts:27-31, 56-76`
   - *Problem*: When `lockedShell` is `true` or viewer is blocked, `getProfileDetails` sets `mutualCount: 0` but leaves `connectionsCount`, `projectsCount`, and `followersCount` populated in the payload. Furthermore, internal owner metrics (`profileStrength`, `completionMissing`) are exposed in `safe`.
   - *Fix*: In `buildViewerScopedProfileView`, when `!exposeFullProfile`, return `connectionsCount: 0`, `projectsCount: 0`, `followersCount: 0`, `profileStrength: 0`, `completionMissing: []`. In `ProfileHeader.tsx:264-275`, disable connection and project count buttons when `lockedShell` is true.

5. **[Sec] [Med] Unbounded database INSERT on every profile view: Missing rate limiting in `recordPrivacyReadEvent`**
   - *Evidence*: `src/lib/data/profile.ts:373-384`, `src/lib/privacy/audit.ts:131-145`
   - *Problem*: Every profile view by an authenticated user executes an immediate SQL INSERT into `profileAuditEvents` without rate limiting or deduplication. Repeated reloads flood PostgreSQL with audit rows.
   - *Fix*: Add Redis-backed throttling in `getProfileDetails`:
     ```ts
     const { allowed } = await consumeRateLimit(`audit:profile-view:${viewerUser.id}:${profileData.id}`, 1, 86400);
     if (allowed && privacyRelationship.canViewProfile) { ... }
     ```

6. **[Sec] [Med] Missing authorization check on `GET /api/v1/profiles/[id]/project-invite-options`**
   - *Evidence*: `src/app/api/v1/profiles/[id]/project-invite-options/route.ts:25-29`, `src/lib/profile/collaboration.ts:880-931`
   - *Problem*: The route handler does not verify `resolvePrivacyRelationship`. A blocked caller can probe invite eligibility against a blocker's profile or private profile.
   - *Fix*: Add privacy check:
     ```ts
     const relationship = await resolvePrivacyRelationship(auth.user.id, id);
     if (!relationship?.canViewProfile || relationship.blockedByViewer || relationship.blockedByTarget) {
       return jsonError("Profile is not eligible for invites", 403, "FORBIDDEN");
     }
     ```

7. **[Sec] [Med] Private & locked profiles on `/u/[username]` return "Profile Not Found" metadata without `noindex` robots directive**
   - *Evidence*: `src/app/(site)/(main)/u/[username]/page.tsx:43-49`, `src/app/(site)/(main)/my-profile/page.tsx:34-57`
   - *Problem*: When `lockedShell` is true, the page renders the locked profile banner, but `generateMetadata` returns "Profile Not Found" without setting `robots: { index: false, follow: false }`. Search engine crawlers index the page under "Profile Not Found".
   - *Fix*: In `u/[username]/page.tsx`, if `lockedShell` is true or `profile.visibility === 'private'`, pass `robots: { index: false, follow: false, noarchive: true }`. In `/my-profile/page.tsx`, always pass `robots: { index: false, follow: false }`.

8. **[Sec] [Low] GDPR account erasure leaves `viewerUserId` in target audit events**
   - *Evidence*: `src/lib/account/deletion.ts:75`, `src/lib/privacy/audit.ts:138`
   - *Problem*: Deleting an account removes rows where `userId = deletedUser.id`, but retains rows where the user viewed other profiles (`metadata.viewerUserId = deletedUser.id`).
   - *Fix*: In `src/lib/account/deletion.ts`, sanitize `metadata.viewerUserId` to `'deleted_user'` in `profile_audit_events`.

---

## Phase 2: Regressions & Data Loss / Race Conditions

9. **[Bug] [High] Avatar upload immediately mutates DB and bumps `profiles.updatedAt`, triggering a guaranteed `PROFILE_CONFLICT` on subsequent profile save**
   - *Evidence*: `src/app/actions/profile.ts:334-338`, `src/components/profile/edit/EditProfileTabs.tsx:146-154`, `src/components/profile/edit/EditProfileModal.tsx:269, 284-299`
   - *Problem*: `finalizeProfileImageUploadAction` commits immediately to PostgreSQL and sets `profiles.updatedAt = new Date()`, but returns only `{ publicUrl }` without the new timestamp. `EditProfileModal`'s `lastKnownUpdatedAtRef.current` remains set to the old timestamp. When the user subsequently clicks "Save Changes" after editing text fields, `updateProfileAction` fails with `PROFILE_CONFLICT` ("Profile was updated elsewhere"), blocking the user from saving.
   - *Fix*: Return `updatedAt: string` from `finalizeProfileImageUploadAction`. Pass an `onImageFinalized?: (avatarUrl: string, updatedAt: string) => void` callback to `EditProfileTabs`, and in `EditProfileModal` update both `baseProfileRef.current.avatarUrl = avatarUrl` and `lastKnownUpdatedAtRef.current = updatedAt`.

10. **[Bug] [High] Accidental outside-click or double-Escape silently closes modal and wipes unsaved edits after discard confirm prompt is displayed**
    - *Evidence*: `src/components/profile/edit/EditProfileModal.tsx:409-418`
    - *Problem*: When dirty (`hasChanges === true`), pressing Escape or clicking outside sets `showDiscardConfirm = true`. If the user accidentally presses Escape or clicks outside a second time while this prompt is visible, `hasChanges && !showDiscardConfirm` evaluates to `false`, abruptly closing the dialog and permanently wiping all unsaved changes.
    - *Fix*: In `handleOpenChange`, if `hasChanges` is true, never close the dialog via outside-click or Escape—require explicit interaction with the footer buttons:
      ```ts
      const handleOpenChange = (openValue: boolean) => {
          if (!openValue) {
              if (hasChanges) {
                  setShowDiscardConfirm(true);
                  return;
              }
              setShowDiscardConfirm(false);
              onOpenChange(false);
          }
      };
      ```
      Add `onPointerDownOutside={(e) => { if (hasChanges) e.preventDefault(); }}` to `<DialogContent>`.

11. **[Bug] [High] Premature image mutation breaks Cancel/Discard contract: uploaded avatar is live in DB and storage even after user clicks "Discard"**
    - *Evidence*: `src/components/profile/edit/EditProfileTabs.tsx:146-153`, `src/components/profile/edit/EditProfileModal.tsx:445-454`
    - *Problem*: `finalizeProfileImageUploadAction` commits the avatar directly to the PostgreSQL `profiles` table while the modal is still open. When the user subsequently clicks "Cancel" -> "Discard", only the local React state reverts; the database and Supabase storage already retain the new photo.
    - *Fix*: Separate image preparation from profile mutation. `finalizeProfileImageUploadAction` should verify and store the derivative in storage assets without updating `profiles.avatarUrl`, returning the publishable URL. The actual update to `profiles.avatarUrl` should occur only when the user clicks "Save Changes" via `updateProfileAction({ avatarUrl: formState.avatarUrl })`.

12. **[Bug] [High] Query cache and viewer session left stale when contribution save fails after profile details succeed**
    - *Evidence*: `src/components/profile/edit/EditProfileModal.tsx:284, 305, 309, 324, 348`
    - *Problem*: When both profile details and project contributions are dirty, `updateProfileAction` runs first. If it succeeds, but `saveProfileContributionsAction` fails, execution jumps to the `catch` block. Lines 348–350 (`invalidateProfileReads` and `refreshProfile`) are skipped, leaving React Query caches desynchronized from database reality.
    - *Fix*: Execute `invalidateProfileReads(profilePayload)` and `refreshProfile()` whenever `profileSaved` is true, regardless of whether contribution mutations subsequently fail.

13. **[Bug] [Med] Async contribution loading race condition overwrites user typing or skips loading full contributions**
    - *Evidence*: `src/components/profile/edit/EditProfileModal.tsx:182-194`
    - *Problem*: When the modal opens, `loadProfileContributionsPage` runs asynchronously. If the user begins typing in any field within the first 100ms, `draftTouchedRef.current` becomes `true` and incoming contributions are discarded. Conversely, if the user starts typing just as the promise resolves, `setFormState(complete)` overwrites `formState` with original fields, clobbering keystrokes.
    - *Fix*: Merge only the contribution entries into the active state without replacing the entire `formState`:
      ```ts
      const incoming = page.contributions.map(contributionToEditorEntry);
      baseProfileRef.current = { ...baseProfileRef.current, experience: incoming, contributionBase: incoming };
      setFormState((prev: any) => prev ? { ...prev, experience: incoming, contributionBase: incoming } : prev);
      ```

14. **[Bug] [High] Cascading account deletion causes irreversible `connections_count` drift**
    - *Evidence*: `src/lib/account/hard-delete.ts:100`, `src/lib/db/schema/index.ts:569, 572`
    - *Problem*: When an account is hard-deleted, foreign key CASCADE automatically deletes all rows in `connections` where the user was `requester_id` or `addressee_id`. However, `profiles.connections_count` on all connected peers is never decremented, leaving phantom connection counts indefinitely.
    - *Fix*: Before deleting the profile in `src/lib/account/hard-delete.ts`, decrement peers' counters within the transaction:
      ```sql
      WITH deleted_peers AS (
        SELECT CASE WHEN requester_id = ${userId}::uuid THEN addressee_id ELSE requester_id END AS peer_id
        FROM connections
        WHERE status = 'accepted' AND (requester_id = ${userId}::uuid OR addressee_id = ${userId}::uuid)
      )
      UPDATE profiles
      SET connections_count = GREATEST(0, connections_count - 1), updated_at = now()
      WHERE id IN (SELECT peer_id FROM deleted_peers);
      ```

---

## Phase 3: Correctness & Spec §17 Conformance

15. **[Bug] [High] Missing Project Contributions on the Portfolio Tab (§17)**
    - *Evidence*: `src/components/profile/v2/ProfileV2Client.tsx:517-552`
    - *Problem*: §17 specifies Portfolio as "Shared ProjectCard grid plus contribution rows/cards naming project, role, time, skills, and work summary". Currently, `ProjectContributionsCard` is only rendered on the Overview tab and completely unmounts on the Portfolio tab.
    - *Fix*: In `renderMainBottom()`, render `ProjectContributionsCard` when `activeTab === 'portfolio'` as well as `'overview'`.

16. **[UX] [High] Connect & Message actions collapsed into dropdown trigger instead of distinct co-actions (§17)**
    - *Evidence*: `src/components/profile/v2/ProfileHeader.tsx:366-384`
    - *Problem*: §17 specifies: "Share/Edit or Connect/Message actions align right on desktop and below identity on mobile." The current implementation hides "Message" inside a `DropdownMenu` trigger disguised as the `Connect` button (`Connect ⌵`), forcing a stranger who can message the user to search inside a secondary dropdown menu.
    - *Fix*: Render primary `Connect` button and `Message` button (`<Button variant="outline" onClick={onMessage}><MessageSquare className="size-4" />Message</Button>`) side-by-side in `ProfileHeader`, reserving the dropdown menu only for secondary overflow actions (`Disconnect`, `Block`).

17. **[UX] [High] Missing "Quiet Omission" for strangers on empty cards (§17)**
    - *Evidence*: `src/components/profile/v2/sections/AboutCard.tsx:45-50`, `src/components/profile/v2/sections/ProjectContributionsCard.tsx:188-196`, `src/components/profile/v2/sections/ProjectsGridCard.tsx:106-108`
    - *Problem*: §17 states: "Missing optional data produces an own-profile completion action or a quiet omission for other viewers." Currently, if a user has no bio or no contributions, strangers see full cards with empty placeholder messages ("No bio added yet", "No project contributions yet") instead of the card being omitted. In `ProjectsGridCard`, strangers even see owner copy: "Projects you create or contribute to will appear here."
    - *Fix*: In `AboutCard.tsx`, add `if (!isOwner && !hasBio) return null;`. In `ProjectContributionsCard.tsx`, add `if (!isOwner && visibleContributions.length === 0) return null;`. In `ProjectsGridCard.tsx`, adjust empty state copy when viewer is not the owner.

18. **[Bug] [High] "Share profile" on `/my-profile` shares private dashboard URL instead of public canonical URL `/u/[username]`**
    - *Evidence*: `src/components/profile/v2/ProfileV2Client.tsx:657-664`
    - *Problem*: When an owner is viewing their own profile at `/my-profile` and clicks "Share profile", `window.location.href` is shared as `https://networkbase.in/my-profile`. When an external person opens this shared URL, they are redirected to `/login` and see their own profile.
    - *Fix*: Use `window.location.origin + profileHref(safeProfile)` instead of `window.location.href`.

19. **[Bug] [Med] VALID-004: Invalid profile website is silently treated as clearing the saved field**
    - *Evidence*: `src/lib/validations/profile.ts:56`, `src/lib/profile/normalization.ts:408-410`, `src/app/actions/profile.ts:535`
    - *Problem*: `profileUpdateSchema` only checks string length for `website`. When an invalid URL is supplied, `normalizeOptionalProfileUrl` returns `''`. `updateProfileAction` maps `''` to `null` via `toNullableString('')` and updates the database, silently wiping the user's previously saved website without an error.
    - *Fix*: Add URL refinement to `profileUpdateSchema`:
      ```ts
      website: z.string().trim().max(PROFILE_LIMITS.websiteMax)
          .refine((val) => !val || isSafeHttpUrl(/^https?:\/\//i.test(val) ? val : `https://${val}`), 'Invalid website URL')
          .optional(),
      ```

20. **[Bug] [Med] `getUserProfile` drops `openToCustomRoles` and `preferredCategories` from select projection**
    - *Evidence*: `src/lib/data/profile.ts:98-135`, `89-90`
    - *Problem*: `getUserProfile` selects 32 explicit columns from `profiles`, but omits `openToCustomRoles` and `preferredCategories`. In `toBootstrapProfile`, `(profile as any).openToCustomRoles` is always undefined and defaults to `[]`, losing persisted preferences on reload.
    - *Fix*: Add `openToCustomRoles: profiles.openToCustomRoles` and `preferredCategories: profiles.preferredCategories` to `.select({...})` in `getUserProfile`.

21. **[Bug] [Med] Profile detail updates leave stale collaboration summaries**
    - *Evidence*: `src/app/actions/profile.ts:762-768`
    - *Problem*: If a user updates their `fullName`, `avatarUrl`, `headline`, or `username`, `markProfileCollaborationSummaryStale` is skipped because lines 762-768 only check skills, openTo, and experience level. Cached summaries across projects serve stale identity data for up to 10 minutes.
    - *Fix*: Include `patch.fullName`, `patch.avatarUrl`, `patch.username`, and `patch.headline` in the staleness condition in `updateProfileAction`.

22. **[Bug] [Med] Project metadata changes never invalidate owner/member profile collaboration summaries**
    - *Evidence*: `src/app/actions/project/index.ts`
    - *Problem*: When project title, slug, cover image, or visibility is updated, `markProfileCollaborationSummaryStale` is never invoked for project owners or members.
    - *Fix*: In `updateProjectAction` and `deleteProjectAction`, call `await markProfileCollaborationSummaryStale([project.ownerId, ...memberUserIds], tx);`.

23. **[Bug] [Low] `getProfileViewerOverlayAction` hardcodes `mutualCount: 0` overwriting client badges**
    - *Evidence*: `src/app/actions/profile.ts:855`, `src/components/profile/v2/ProfileV2Client.tsx:407`
    - *Problem*: `getProfileViewerOverlayAction` returns `mutualCount: 0` unconditionally. When a viewer interacts with a profile, `refreshViewerOverlay` replaces the SSR-rendered mutual count with 0.
    - *Fix*: Compute `mutualCount` in `getProfileViewerOverlayAction` via `getProfileMutualCount(user.id, profileId)`.

24. **[UX] [Med] 30-day username change cooldown is not disclosed in the UI warning box**
    - *Evidence*: `src/components/profile/edit/EditProfileTabs.tsx:383-391`, `src/app/actions/profile.ts:64, 501-510`
    - *Problem*: The server strictly enforces a 30-day cooldown between username changes (`USERNAME_COOLDOWN`). The warning box in the General tab claims "Your public handle updates immediately" without warning the user that they cannot change it again for 30 days.
    - *Fix*: Add explicit callout in the warning banner: *"Note: You can only change your username once every 30 days."*

---

## Phase 4: Accessibility (§34) & Mobile Touch Targets (§09)

25. **[A11y] [High] `EditProfileTabs` bypasses Radix TabsList / TabsTrigger (§34)**
    - *Evidence*: `src/components/profile/edit/EditProfileTabs.tsx:176-196`
    - *Problem*: Raw `<button role="tab">` elements are rendered inside an `<aside>` without a parent `role="tablist"` or `aria-controls`, completely breaking keyboard arrow navigation (ArrowUp/ArrowDown) and ARIA parent-child relationships.
    - *Fix*: Wrap tab buttons in `<TabsList className="flex flex-col h-auto w-full bg-transparent p-0 border-none">` and use `<TabsTrigger value={tab.id}>`.

26. **[A11y] [High] Immediate unmount on modal close bypasses Radix focus restoration and transitions in `UserConnectionsModal` and `ProfileInviteModal` (§34)**
    - *Evidence*: `src/components/profile/v2/ProfileV2Client.tsx:759-767, 777-785`
    - *Problem*: Conditional unmounting (`isOpen && <Modal />`) unmounts the modal component before Radix UI's exit lifecycle can restore focus to the triggering element, dropping keyboard focus on `document.body`.
    - *Fix*: Load components via `next/dynamic({ ssr: false })` at module level, keep components mounted with `open={isOpen}`, and pass an explicit trigger ref or `onCloseAutoFocus` callback.

27. **[A11y] [Med] Project contributions card rendered outside the active `role="tabpanel"` (§34)**
    - *Evidence*: `src/components/profile/v2/ProfileShell.tsx:26-32`, `src/components/profile/v2/ProfileV2Client.tsx:507, 550-563`
    - *Problem*: `main` contains `role="tabpanel"`. But `mainBottom` (`ProjectContributionsCard`) is placed outside in `<div className="order-4">{mainBottom}</div>`. Screen readers encounter orphan content outside the active tab context.
    - *Fix*: Render `mainBottom` inside `renderMainContent()` under the `overview` case so all overview tab content is encapsulated within `profile-panel-overview`.

28. **[A11y] [Med] Sub-44px touch targets on mobile for status picker button, share button, and link health button (§09, §34)**
    - *Evidence*: `src/components/profile/v2/ProfileHeader.tsx:52, 308-311`, `src/components/profile/v2/ProfileRightRail.tsx:90`
    - *Problem*: `PresenceChips` status button is hardcoded to `h-[26px]`. On mobile, `ProfileHeader` share button has text hidden via `max-md:sr-only`, reducing touch width to ~32px. `ProfileRightRail` "Update" button has height ~28px (`py-1.5`).
    - *Fix*: Add `.nb-touch-target` or `max-md:min-h-11 max-md:min-w-11` to these buttons.

29. **[A11y] [Med] `display: contents` on `<aside>` stripping accessible landmark (§34)**
    - *Evidence*: `src/components/profile/v2/ProfileShell.tsx:33`
    - *Problem*: In WebKit and Blink, `display: contents` can remove the complementary landmark role from the accessibility tree.
    - *Fix*: Replace `contents` with standard block/flex layout or apply explicit `role="complementary"`.

30. **[A11y] [Med] ProfileTabs missing horizontal scroll container for narrow viewports (≤400px) (§09)**
    - *Evidence*: `src/components/profile/v2/ProfileTabs.tsx:32-33`
    - *Problem*: §09 states: "≤400px or 200% zoom: Tabs scroll horizontally with visible active tab." `ProfileTabs` uses a fixed `w-full` flex container with no `overflow-x-auto`.
    - *Fix*: Add `overflow-x-auto scrollbar-none` to the tablist wrapper: `className="flex min-h-11 w-full items-end gap-5 overflow-x-auto border-b border-border bg-background scrollbar-none"`.

31. **[A11y] [Low] Social links sortable grid lacks accessible non-drag alternative and 2D grid keyboard navigation issues (§17, §34)**
    - *Evidence*: `src/components/links/SortableLinkList.tsx:102-104`, `src/components/profile/edit/EditProfileTabs.tsx:1073-1076`
    - *Problem*: Spec §17 requires keyboard alternatives for drag-and-drop. In `SortableLinkList`, `sortableKeyboardCoordinates` is designed for 1D single-axis lists, which causes jumping in 2-column grid (`sm:grid-cols-2`). There are no explicit "Move Up" / "Move Down" buttons for screen reader users.
    - *Fix*: Add accessible "Move up" and "Move down" icon buttons on `SortableSocialLinkCard`.

---

## Phase 5: UI/UX, States (§33) & Design Spec (§17/§35)

32. **[Perf/UX] [High] Dynamic client-side import waterfall causing double skeleton flash (§33)**
    - *Evidence*: `src/components/profile/v2/ProfileV2Client.tsx:27-114`
    - *Problem*: In `ProfileV2Client.tsx`, core sections (`ProfileHeader`, `ProfileRightRail`, `OpenToRolesCard`, `ProjectContributionsCard`, `ProjectsGridCard`) are dynamically imported with `next/dynamic` inside a client component that already waited for the server shell (`ProfileRouteSkeleton`). Users experience a second wave of skeleton shimmer for components that should be synchronously rendered.
    - *Fix*: Statically import `ProfileHeader`, `ProfileRightRail`, and section cards in `ProfileV2Client.tsx`. Reserve `dynamic()` only for heavy modals (`EditProfileModal`, `UserConnectionsModal`, `ProfileInviteModal`, `ApplyRoleModal`).

33. **[Perf] [High] Severe CLS caused by structural mismatch between `ProfileRouteSkeleton` and `ProfileShell` / `ProfileHeader` / `ProfileTabs` (§33)**
    - *Evidence*: `src/components/profile/v2/ProfileRouteSkeleton.tsx:15-87`, `src/components/profile/v2/ProfileShell.tsx:25-45`
    - *Problem*: On desktop, `highlights` lives in the right rail, but `ProfileRouteSkeleton` renders it in the left column. On mobile, `ProfileShell` uses flex ordering (`order-1` to `order-5`), while skeleton renders in static order. Skeleton has `p-6` at all breakpoints; `ProfileHeader` has `p-4 md:p-6`. Skeleton tabs are `h-9 rounded-t-md`; real tabs are `min-h-11` flat underline.
    - *Fix*: Match the exact layout geometry and classes of `ProfileShell` in `ProfileRouteSkeleton.tsx`: move highlights skeleton to right rail, set tab skeletons to `h-11 gap-5`, and header container to `p-4 md:p-6`.

34. **[UX] [High] Rampant raw zinc and untokenized palette classes in `EditProfileTabs` (§35)**
    - *Evidence*: `src/components/profile/edit/EditProfileTabs.tsx` (over 40 instances)
    - *Problem*: §35 and §17 anchors forbid raw zinc and foreign palette classes in favor of semantic tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-muted`).
    - *Fix*: Batch replace `zinc-*`, `indigo-*`, `emerald-*`, and `red-*` with semantic tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-destructive`).

35. **[UX] [Med] `ProfileShell` mobile re-ordering inversion (§09)**
    - *Evidence*: `src/components/profile/v2/ProfileShell.tsx:30-41`
    - *Problem*: On mobile, `highlights` (`OpenToRolesCard`) has `order-3`, while main content is `order-2` and `mainBottom` (`ProjectContributionsCard`) is `order-4`, arbitrarily placing a right-rail card between About prose and Project Contributions.
    - *Fix*: Set `mainBottom` to `order-3` and `highlights` to `order-4`.

36. **[UX] [Med] `UserConnectionsModal` missing count header and row actions (§17)**
    - *Evidence*: `src/components/profile/v2/UserConnectionsModal.tsx:140, 187-214`
    - *Problem*: §17 specifies: "Connections modal: Searchable roster, 34px avatars, count header, row actions." The modal title omits the count, and list rows are bare links without row actions.
    - *Fix*: Display count in title (`<DialogTitle>{`${ownerDisplayName}'s Connections (${connections.length})`}</DialogTitle>`) and provide compact row action buttons (`Message` / `Connect`).

37. **[UX] [Med] `UserConnectionsModal` uses generic spinner instead of row skeleton (§33)**
    - *Evidence*: `src/components/profile/v2/UserConnectionsModal.tsx:161-164`
    - *Problem*: §33 specifies layout-matched skeleton shimmer; `UserConnectionsModal` displays a raw spinner.
    - *Fix*: Replace spinner with 3-4 row skeletons (`<Skeleton className="size-[34px] rounded-[3px]" />` + text bars).

38. **[UX] [Low] `EditProfileTabs` nav width mismatch (220px vs 200px) (§17)**
    - *Evidence*: `src/components/profile/edit/EditProfileTabs.tsx:182`
    - *Problem*: §17 specifies left section nav 200px; code uses `md:w-[220px]`.
    - *Fix*: Change `md:w-[220px]` to `md:w-[200px]`.

39. **[UX] [Low] Incomplete button label in `OpenToRolesCard` ("Invite to")**
    - *Evidence*: `src/components/profile/v2/sections/OpenToRolesCard.tsx:139-141`
    - *Problem*: Button label is abruptly truncated to "Invite to" without the destination noun.
    - *Fix*: Change label to "Invite to project".

40. **[UX] [Low] Hardcoded hex color `#8F2E12` in `ProfileHeader` toggle (§35)**
    - *Evidence*: `src/components/profile/v2/ProfileHeader.tsx:329`
    - *Problem*: "Open to collaborators" switch hardcodes untokenized border color `#8F2E12`.
    - *Fix*: Replace with `border-primary`.

---

## Phase 6: 1M Scale Performance, SQL Optimization & Caching

41. **[Perf] [High] In-database nested loop / full table scan in profile project aggregation query**
    - *Evidence*: `src/lib/profile/collaboration.ts:461-534`
    - *Problem*: Driving from `projects p` with an `OR` condition spanning three tables (`p.owner_id = profileId OR pm_self.id IS NOT NULL OR pc.id IS NOT NULL`) prevents PostgreSQL from pushing down an index scan, forcing a sequential scan across all projects at 1M scale.
    - *Fix*: Pre-filter candidate project IDs using an indexed `UNION` CTE:
      ```sql
      WITH user_project_ids AS (
        SELECT id FROM projects WHERE owner_id = ${profileId}::uuid AND deleted_at IS NULL
        UNION
        SELECT project_id AS id FROM project_members WHERE user_id = ${profileId}::uuid
        UNION
        SELECT project_id AS id FROM profile_project_contributions WHERE profile_id = ${profileId}::uuid AND deleted_at IS NULL AND project_id IS NOT NULL
      )
      SELECT ... FROM projects p
      INNER JOIN user_project_ids up ON up.id = p.id
      WHERE p.deleted_at IS NULL AND ...
      ```

42. **[Perf] [High] Uncached public profile SSR sparks multi-query thundering herd at 1M scale**
    - *Evidence*: `src/app/(site)/(main)/u/[username]/page.tsx:24-38, 90`
    - *Problem*: Public profile page executes 6–10 live DB queries on every request without Next.js Data Cache or ISR.
    - *Fix*: Cache the public target profile projection using `unstable_cache` tagged with `['profile:' + userId, 'profile:' + username]` (60-300s TTL). Stream viewer interaction state via client overlay.

43. **[Perf] [High] In-flight deduplication map lacks cluster-wide stampede protection**
    - *Evidence*: `src/lib/profile/collaboration.ts:800-804`, `src/lib/utils/inflight-dedupe.ts:1-21`
    - *Problem*: `runInFlightDeduped` uses a process-local Node.js `Map`, bypassing deduplication across multiple serverless / pod replicas.
    - *Fix*: Use Redis distributed lock (`SET lock:profile-summary:[id] "1" NX EX 15`) with stale-while-revalidate semantics.

44. **[Perf] [Med] Redis `SINTER` materializes unbounded mutual connection IDs into Node memory**
    - *Evidence*: `src/lib/data/profile.ts:208-210`
    - *Problem*: `redis.sinter` transfers the full array of mutual member IDs over the network wire into a Node array of strings, only to call `.length`.
    - *Fix*: Use Redis `SINTERCARD`:
      ```ts
      const mutualCount = await redis.sintercard(2, [viewerKey, profileKey]);
      return typeof mutualCount === 'number' ? mutualCount : 0;
      ```

45. **[Perf] [Med] Missing composite index on `project_members(user_id, role)` and contribution order mismatch**
    - *Evidence*: `src/lib/db/schema/index.ts:944`, `src/app/actions/project/index.ts:9945`
    - *Problem*: `getProfileProjectsWithOpenRolesAction` filters `project_members` by `user_id = targetProfileId AND role IN ('owner', 'admin')`. The existing index is on `(user_id)` alone, requiring heap fetches for role evaluation.
    - *Fix*: Add composite index:
      ```sql
      CREATE INDEX project_members_user_role_idx ON project_members (user_id, role);
      ```

46. **[Perf] [Med] `/api/v1/profiles/[id]/projects` fetches heavy project data before viewer authorization**
    - *Evidence*: `src/app/api/v1/profiles/[id]/projects/route.ts:34-41`
    - *Problem*: Route executes `getProfilePortfolioProjects` in parallel with `resolvePrivacyRelationship` via `Promise.all` before checking `relationship.canViewProfile`, wasting database compute if private or blocked.
    - *Fix*: Await `resolvePrivacyRelationship` first; return 403 immediately if unauthorized before executing the portfolio query.

47. **[Perf] [Med] Profile owner always bypasses collaboration summary cache on `/my-profile`**
    - *Evidence*: `src/lib/data/profile.ts:344-346`, `src/lib/profile/collaboration.ts:805`
    - *Problem*: When `isOwner` is true, `preferCached` is forced to `false` and `includePrivate` is `true`, executing live CTE queries on every visit to `/my-profile`.
    - *Fix*: Cache the owner-view summary with an owner key in Redis or `unstable_cache` with tag `profile-owner:[userId]` and a 60s TTL.

48. **[Perf] [Low] Double `UPDATE` on contributions table within same transaction**
    - *Evidence*: `src/app/actions/profile-contributions.ts:200-219, 310-324`
    - *Problem*: Platform and external contributions are updated with raw user skills in the loop, and then re-updated in a second batch `UPDATE` with canonical skill names.
    - *Fix*: Resolve canonical skills via `syncContributionSkillsBatch` before the primary `UPDATE`/`INSERT`, writing canonical skills in a single pass.

49. **[Bug] [Low] `refreshProfile()` in `AuthProvider` replaces full profile with partial projection missing `skills`, `bio`, `openToCustomRoles`**
    - *Evidence*: `src/lib/profile/browser-profile.ts:41-49`, `src/components/providers/AuthProvider.tsx:343-350`
    - *Problem*: `loadBrowserProfile` selects only 7 columns. When `refreshProfile()` runs after saving, it replaces `state.profile` in `AuthProvider` with this sparse record, erasing skills and bio until full page reload.
    - *Fix*: In `AuthProvider.refreshProfile`, merge updated fields into `prev.profile`: `setState(prev => ({ ...prev, profile: { ...prev.profile, ...profile } }))`.

---

## Phase 7: Ponytail Cuts (Dead Code & Cleanup)

50. **[Cut] Delete "Shortcuts" RailCard in `ProfileRightRail.tsx:160-200`**:
    - Developer explicitly commented: `/* Duplicates the header actions and Portfolio tab; desktop-only. */`. Duplicates Edit profile, My projects, and Message buttons. Delete to clean up the 320px rail.
51. **[Cut] Delete triple style/class duplication in `ProjectsGridCard.tsx:71-72, 81-82, 90-91`**:
    - Combines `.nb-portfolio-grid`, Tailwind `flex flex-col gap-4 w-full`, and inline styles `style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}`. Remove inline styles and redundant Tailwind utilities.
52. **[Cut] Delete dead `"education"` type and state in `EditProfileTabs.tsx:65` and `EditProfileModal.tsx:88, 222`**:
    - Relic from an abandoned tab. Delete from union types, arrayKeys, and optimistic patch logic.
53. **[Cut] Delete unused `density` prop in `sections/Card.tsx:18, 22`**:
    - `density?: 'default' | 'compact'` is accepted and defaulted to `'default'`, but never used in rendering.
54. **[Cut] Delete redundant local `Chip` in `ProfileHeader.tsx:20-31`**:
    - 12-line local component used in exactly one place (line 409). Delete and use `nb-status` directly.
55. **[Cut] Delete cross-module dependency `NB_CARD_HEADER_MOBILE` in `Card.tsx:6` and `ProfileRightRail.tsx:5`**:
    - Imports a class constant from `@/components/projects/dashboard/DashboardCard`. Replace with native `nb-card-header` or local utility classes.
56. **[Cut] Delete span duplication hack in `sections/Card.tsx:33`**:
    - `<span className="md:hidden">{mobileTitle}</span><span className="hidden md:inline">{title}</span>` duplicates DOM text nodes for casing differences ("Open to Roles" vs "Open to roles"). Delete and standardize title case.
57. **[Cut] Delete dead `pendingSection` state in `EditProfileModal.tsx:123, 452`**:
    - `const [pendingSection, setPendingSection] = useState<EditProfileSection | null>(null);` is never read or set.
58. **[Cut] Delete dead `hint` property in `ProfileTabs.tsx:6-9`**:
    - Never rendered in DOM, tooltips, or ARIA attributes. Delete from type and tab definitions.
59. **[Cut] Delete dead skeleton elements in `ProfileRouteSkeleton.tsx:72-86`**:
    - Renders dummy 5-tag pill cards and two 40px buttons that do not exist in `ProfileRightRail`. Match real rail cards.
60. **[Cut] Delete duplicate export `export { normalizeProfile }` in `src/lib/data/profile.ts:15`**:
    - Line 16 already imports and re-exports it.
61. **[Cut] Consolidate redundant triple profile normalizers**:
    - Consolidate `src/lib/utils/normalize-profile.ts`, `src/lib/profile/browser-profile.ts`, and `src/lib/profile/normalization.ts` into a single canonical normalizer.

---

## Verification Plan

### 1. Automated Tests & Typecheck
- **TypeScript**: `npx tsc --noEmit` must pass with 0 errors.
- **ESLint**: `npx eslint src/components/profile/ src/app/actions/profile*.ts src/lib/data/profile.ts` must pass with 0 errors.
- **Unit & Contract Tests**:
  - `tests/unit/profile-action-state.test.ts` (test blocker can unblock from header).
  - `tests/unit/profile-normalization.test.ts` (test normalizer parity and custom roles retention).
  - `tests/unit/profile-contributions-card.test.ts` (test presence on portfolio tab).
  - Run all unit tests: `npm run test:unit`.

### 2. Database & SQL Verification
- Verify execution plan on `src/lib/profile/collaboration.ts` project query using `EXPLAIN ANALYZE` on indexed UNION CTE vs old 3-table OR join.
- Verify composite index creation: migration `0216_profile_members_role_idx.sql`.
- Run disposable database check: `npm run check:db:migration-sources`.

### 3. Browser & Interactive Verification
- **Conflict Bug**: Open Edit Profile, upload new avatar, edit bio, click "Save Changes". Confirm save succeeds without `PROFILE_CONFLICT`.
- **Discard Prompt**: Make dirty edits, press Escape once (verify "Discard unsaved changes?" prompt appears), click outside or press Escape again (verify modal remains open until user explicitly clicks "Discard").
- **Unblock Flow**: User A blocks User B. Navigate to B's profile as User A. Confirm dropdown menu is accessible and contains "Unblock [Name]". Click Unblock and verify relationship restores to stranger/none.
- **Spec §17 Portfolio Tab**: Navigate to profile, click Portfolio tab. Verify both project cards AND project contribution cards render.
- **Spec §17 Quiet Omission**: View profile with no bio and no contributions as stranger. Verify empty placeholder cards are omitted.
- **Responsive & Touch**: Test on mobile viewport (<768px):
  - Verify touch targets for presence status button, share button, and edit buttons are ≥ 44px.
  - Verify right rail stacks below main contributions (`order-3` contributions, `order-4` highlights).
- **Dark Mode**: Switch between light and dark modes. Verify zero raw zinc or untokenized borders in `EditProfileTabs`.
- **CLS Check**: Reload `/u/[username]` with Network throttling (Fast 3G). Verify `ProfileRouteSkeleton` layout matches hydrated `ProfileShell` with zero visual shift.
