# Profile sharing implementation — 14 October 2026

Implements the approved interactive design with Ponytail, reusing the existing username resolver, privacy rules, project access checks, dialog, avatar, messaging permissions/idempotency and preview endpoint. Existing unrelated workspace changes are retained. No new dependencies, database migration, live fixture writes or actual recipient messages were needed.

## Delivered behavior

- Owner and permitted visitor profile sharing, project sharing, and Share NetworkBase in desktop/mobile account navigation use one accessible review dialog.
- The dialog shows a selectable canonical link, outside/in-app previews, honest access copy, manual-copy recovery, feature-detected native sharing and authorized conversation selection with an optional note.
- Owner username setup uses the existing profile action with conflict protection. It changes only the username, preserves privacy and guards account changes.
- Copying a resolved link works while its preview loads/fails. Missing usernames cannot become `/my-profile` or `/u/{id}` links. Invalid/lookalike routes never become first-party identity cards.
- Native payloads always use the anonymous projection; cancellation is quiet and a returned native share does not claim delivery. Real in-app success is a server-accepted message.
- Anonymous server metadata and generated 1200×630 images are independent of owner/viewer sessions. Private/connections-only/deleted/uncertain states return neutral metadata and appropriate indexing preferences.
- Images use actual approved avatar/cover asset references, fixed paper/ink/clay branding and local Instrument Sans/JetBrains Mono fonts. Failed photos use canonical initials. Unsupported scripts or extreme renderer labels use a branded image while preserving complete HTML/in-app text.
- Exactly one eligible public project shows its canonical title; several show a neutral distinct total. No current-work claim. Completed/archived/ended participation survives only through a public contribution record. Private/unlisted/draft/deleted/unpublished/view-only references are excluded. Published external history uses count-free wording because cross-source identity cannot be proven.
- Canonical public skill edges supply complete labels for up to four skills, then actual +N. Private/hidden/merged skills and legacy profile JSON are not exported.
- Project cards show the actual title/description and approved imagery; a public owner byline is optional. Unlisted direct links follow the existing project policy and noindex, without entering public profile portfolio totals. App sharing always targets the configured root.
- In-app first-party cards resolve for the current recipient and open within NetworkBase. The sender's hydrated identity is never persisted in the message or public Redis cache. Unknown/loading/offline cards withhold protected details and allow retry. Author-controlled removal/restoration preserves the message text.
- Public metadata includes canonical URL, OG type/title/description/image dimensions/type/alt and a large-image Twitter card. Project document tab titles retain their existing authorized behavior, while OG fields remain anonymous and query-free.
- Recognized preview crawlers receive a lean anonymous page projection without loading the interactive profile/project shell, viewer-qualified tab titles, contribution history or collaboration controls. The user-agent branch never grants access.

## Architectural fixes and edge cases

The old share handler immediately copied/invoked native sharing; it now opens the review flow. The old profile/project page metadata reused viewer-qualified reads; OG projection now reads anonymously. The old URL-only 24-hour preview cache now separates accounts/sessions, uses no persistence for first-party cards, hides them during offline/refetching, and cancels/clears them on account/privacy changes. Generic external preview behavior and its bounded outbound fetch remain intact.

Trusted first-party localhost/staging routes use domain reads; they never enter the outbound loopback fetch path. Pasted message text stays intact. Username aliases resolve through existing permanent claims. Shared project messages display their readable canonical URL but use an internal stable project id destination, preserving the resource through a later slug rename.

Messages contain only the link/reference and optional note. The shared link precedes the note so a separate URL in the note cannot replace the intended preview. Conversation authorization remains enforced by the existing SQL send function. A compose intent survives failures/lost acknowledgment; a deliberate new send receives a new intent. Receipt lookup precedes URL resolution so a renamed profile cannot cause a duplicate after a lost acknowledgment. An opaque resource identity keeps that intent stable across canonical URL changes. Account changes clear drafts/targets; same-account reauthentication retains a draft and requires explicit Send. Send and username actions also compare the expected account with the authoritative server session, preventing a credential change between the last UI render and action execution. No contact/connect action is executed automatically after sign-in.

Profile projections recheck live identity and permissions after asynchronous portfolio/skill aggregation. Project projections recheck access through the existing uncached batch policy reader so request memoization cannot conceal revocation. Image responses use `private, no-store, no-cache, must-revalidate`, intentionally stronger than the draft's proposed public cache TTL. Every old image revision rechecks current access. Reads after asset loading and after PNG rendering discard changed/revoked snapshots; a pixel-level integration check covers a public→private change during asset loading. Missing local renderer fonts redirect to the generic brand image. Our service cannot remove a snapshot already cached by an external platform.

## Verification

The new unit and disposable-database checks cover URL/metadata boundaries, distinct portfolio lifecycle, canonical skills, anonymous versus owner/connection/blocked access, immediate revocation, aliases/deletion, private/draft/unlisted project policy, actual PNG generation, stable project references, no duplicated sends and avatar-loading privacy races. All test messages/records live only in the isolated disposable database.

The browser fixtures exercise the production components with simulated API/action responses. They cover manual copying, native cancellation/failure, separate public/private owner previews, receipt retries, session/account draft handling, offline private-card hiding, mobile overflow and dialog focus. Existing profile behaviors are also checked. A WebKit role-editor click timed out once in the broader run and passed its focused rerun; it did not fail a sharing assertion.

Read-only localhost checks confirmed actual anonymous profile metadata, canonical URL/image type/dimensions/alt, the current approved avatar, one-public-project title and correct four-skill overflow.

Final targeted results:

- 26 unit checks passed; 19 isolated database checks passed, including revocation during aggregation, image-load privacy races, profile/project renames, receipt recovery and server-session account changes.
- All 12 sharing browser checks passed across Chromium and WebKit. Existing profile regression coverage passed after the focused WebKit role-editor rerun described above.
- Scoped sharing ESLint and whitespace checks passed. API envelopes (86 routes), versioning (88 routes), query keys, canonical logic and impact review (9 records) passed.
- A compiler API semantic check completed despite the unrelated JSX failures. Its seven diagnostics were confined to the concurrently edited project/task editors; sharing modules, integrations and routes had no semantic diagnostics.
- An earlier production build completed successfully. Its standalone output included all three local renderer fonts; a real standalone OG request returned a 1200×630 PNG with no-store headers.
- The final whole-workspace typecheck/build cannot pass while unrelated concurrent edits contain invalid JSX in `src/components/projects/v2/tasks/TaskCard.tsx` and `src/components/projects/EditProjectModal.tsx`. The final build encountered the task-card syntax error. These files were preserved; no task/editor work was reverted to force a green check.
- Temporary build output was moved outside the repository, generated temporary TypeScript include paths were removed, and the isolated test PostgreSQL instance was stopped. No live database migrations or external messages were sent.

## Practical limits

External services control whether they render, crop and cache a preview. No implementation can promise an immediate third-party refresh or delivery confirmation from the native OS sheet. Current-script support is bounded by the packaged fonts; other scripts retain accurate text metadata and a generic brand image. No provider credentials or live external messages were used for validation.
