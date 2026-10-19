# Messaging metadata and URL correction

Date: 13 October 2026. Status: implemented in the local working tree; not deployed.

## Contract and coverage inventory

| Producer / consumer | Required contract | Implementation and evidence |
| --- | --- | --- |
| Messages home, Inbox, Saved, Drafts, Search and New message routes | Generic metadata, canonical path without query state, no indexing | Shared messaging layout supplies robots policy; existing page generators supply route metadata. Browser fixtures execute all nine route generators. |
| Conversation route, project message landing and project channel browser | Stable route metadata rather than inherited previous-page titles | New metadata generators use validated IDs and generic descriptions/social cards. Contextual browser titles come from authorized channel/project data. |
| Root document and shared metadata builder | Site identity without root ownership of page metadata | Open Graph site name moved to the route builder; head-contract passes. |
| Conversation header, group, DM, self-DM and project headings | Authorized names; useful titles; no message bodies in head metadata | Existing title-prefix hook retained. Prefix suppressed without authentication or after detail errors; unnamed groups receive authorized participant previews. No conversation name is written into social metadata. |
| Floating chat and full-page promotion | Keep host-page title; retain channel, thread and focused message | Window target resolution and promotion use the shared builders. Show-in-conversation stays inside the window instead of borrowing host query state. |
| Thread/details drawer, selected conversation tab and mobile history | Refreshable state; independent fields survive updates | Shared parser/query patcher owns `m`, `thread`, `details`, `tab`, `pane`; mobile history ownership belongs to the actual conversation entry. Desktop replaces; mobile pushes once. |
| Explicit message target and incomplete legacy reply links | Resolve actual authorized location; do not silently show a different message | `resolveMessageTarget` reuses timeline authorization. The page corrects absent/conflicting thread state. Missing/deleted/inaccessible messages show an unavailable state. |
| Old thread replies, earlier/newer loading and Latest | Bounded reads with explicit gaps | Thread action accepts `around` and `after`, returns `hasNewer`, and retains `before`/`hasOlder`. UI loads both directions and fetches latest before sending from a historical window. A 605-reply database fixture verifies old targets and both paging directions. |
| Inbox, mentions, followed threads, Saved, search, pins, Files, reminders, copied/shared messages | Stable channel/message/thread identity | Existing `messageHref` and `threadHref` remain authoritative. Conversation/thread copy links preserve relevant view state. Existing legacy redirects and DM-intent aliases remain. |
| Task “Open source” links | Source message's own preview and thread identity | Source query joins the actual message, excludes deleted sources, supplies `thread_root_seq`, and flattens preview text. Consumer uses `messageHref`. |
| Conversation bookmarks, message links, composer links, canvas links | Normalize actual destinations; validate at rendering and write boundaries | Shared safe-URL gate rejects unsupported schemes, credentials, private hosts, whitespace/control characters and backslashes. Bare web addresses receive HTTPS; root-relative application paths stay internal. IPv4-mapped private IPv6 is recognized after native URL serialization. |
| Preview extraction and metadata cards | Match rendered Markdown rather than code/image text; never render unsafe cached destinations | Installed Markdown/GFM parser collects actual link/reference nodes. Code/images and same-origin messaging links do not generate previews. Cached/API data is validated again at the hook/card boundary. |
| Link-preview API and Redis | Authenticate; validate before cache reads; bounded fetch/parsing; private HTTP cache | DNS validation, redirects, body and deadline limits retained. Redis and client query cache keys changed to v2. HTTP caching is private. Metadata extraction handles attribute order, quoting, entities, relative images, OG/Twitter/HTML fallbacks, and response charset; YouTube oEmbed retained. |
| Compressed uploads, verification, send payloads and attachment display | Name, MIME, size and dimensions describe actual uploaded bytes | Upload uses the compressed filename and stores original filename only as attribution metadata. Verification writes EXIF-oriented image dimensions using existing Sharp. Complete video dimensions remain bounded hints. Bad legacy dimensions become null rather than breaking SQL casts. |
| Signed media, thumbnails and playback | Stable asset references; temporary capabilities; bounded recovery | Existing 5-minute ordinary / 2-hour audio-video lifetimes retained. Image/video errors can renew the stable endpoint once; video position is restored. Terminal failure shows unavailable state. |
| Ordinary sends, retries, scheduled sends and invitation cards | One canonical message shape; duplicates must reflect stored state | Duplicate sends read authoritative edited content, timestamps, flags and counters; no second publication. Timestamp projections normalize driver Dates or SQL timestamp text to canonical ISO strings, matching first-send responses. Invitation cards reuse `sendAs` instead of building a separate payload. Verified attachments must belong to the sender and chat bucket. |
| React Query, retired storage cache and failed sends | No account-unscoped persisted timelines or restored messages | Retired timeline cache removed; legacy keys purged from both storage types. Account change/sign-out clears chat queries, window and failed sends. Failed restoration checks author identity, validates stored shape, and works for threads as well as timelines. Blob URLs are excluded from persisted failed messages. |
| Web push, service-worker clicks and in-app navigation | Same-origin HTTP(S) destinations; preserve query identity | Worker validates destinations before opening/navigating, and page listener applies the shared path validator. Exact conversation matching suppresses focused-tab notifications. Worker behavior is tested with isolated clients. |
| Auth/login/onboarding redirect round trips | Preserve the full path/query/fragment | Existing `x-networkbase-request-target` and auth redirect normalization already preserve destination state. They were retained. |
| Canvas asset retention and image rendering | Only genuine application image references retain assets | Markdown image destinations are parsed; same-origin attachment paths are matched exactly. Foreign hosts, code and plain text cannot pin assets merely by containing the same path. Rendering rejects unsafe sources while local uploading blobs remain temporary. |

## Interfaces and ceilings

- `Panes` adds optional `pane: "thread" | "details"`; its default is Thread when both drawers are present. URLs with only one drawer omit it.
- `readPanes`, `patchConversationParams`, `isMessageSeq` and `parseMessageSeq` centralize URL state. Existing builders retain their original callers and accept optional view state.
- Sequence values are positive decimal integers through 2,147,483,647, matching existing SQL int4 projections. This deliberate ceiling is documented beside the helper; changing the wire projections is required before raising it.
- `resolveMessageTarget` returns only sequence/thread identity after an authorized read. `listThread` adds mutually exclusive `around`/`after` cursors and `hasNewer`; windows remain capped at 500.
- Task-source results add `thread_root_seq`. `ChatMessageView` retains its existing wire fields.
- Image/video dimensions use a shared 20,000-pixel per-axis display limit and complete pairs. Image verification reuses the existing 16-million-pixel image policy, including animation pages. Unsupported/unreadable images fail verification; nullable video hints do not require a new decoder dependency.
- External destinations retain the 2,000-character messaging limit. Preview fetches remain capped at 512 KiB, parsing at the first 65,536 UTF-16 code units, individual captured metadata values at 8,192 characters, titles at 160 and descriptions at 500. DNS validation and each outbound fetch have 5-second bounds. Parsing is intentionally a bounded metadata reader, not a new general HTML engine.
- Twitter fallback uses the existing `provider` title-source value to preserve project-link consumers' existing source enum. Normalized preview data is idempotent and already-decoded title text can bypass HTML entity decoding.
- No dependencies, database columns, RPC changes or new migrations were added. Existing migration/journal and unrelated Files/project changes were preserved.

## Validation evidence

Passed locally:

- **194 focused unit/contract tests**, covering messaging, metadata, safe URLs, mapped IPv6, Markdown references/code, preview attributes/entities, cached-data validation, canvas ownership, worker navigation, upload security and storage lifecycle.
- **8 disposable PostgreSQL tests**, exercising real message actions/SQL: 605-reply deep links, bounded forward/around paging, canonical duplicate sends, outsider/deleted-target protection, public project-member preview and access removal, task-source identity, actual Sharp verification of EXIF dimensions, invalid legacy attachment metadata, bucket isolation and unnamed-group names.
- **18 browser checks in Chromium and WebKit**, covering desktop and mobile URL/history restoration, invalid parameter cleanup, nine route generators on navigation and reload, title-prefix reset/rename/privacy, compressed upload request metadata, bounded media recovery/playback position and account isolation of persisted messages.
- Production `npm run build`, standalone typecheck, scoped ESLint, `check:head-contract`, `check:query-key-contract` and `git diff --check`.

The repository-wide unit run completed **2,244 tests: 2,237 passed, 7 failed, 0 cancelled**. Remaining failures are outside this change's messaging paths:

1. Three Files mutation authorization source contracts in `tests/unit/files-tab/role-gate-viewer.test.ts` disagree with the existing unrelated Files edits.
2. A project lifecycle source contract in `project-dashboard-settings-ui-contract.test.ts` disagrees with existing project action edits.
3. A notification push SQL-source contract in `sql-query-remediation-contract.test.ts` fails against the unchanged push-delivery implementation.
4. A hydration fallback source contract in `sql-supabase-runtime-remediation.test.ts` disagrees with existing hydration edits.
5. A date-sensitive task-email assertion in `transactional-email.test.ts` fails. Its implementation and test were not edited here.

An import-boundary regression introduced while consolidating invitation sends was detected by the full suite and corrected with a server-only dynamic import. The subsequent full run has no cancelled tests.

Browser checks run the production route generators, URL hook, title-prefix hook, player and upload function inside isolated fixtures. Framework navigation is modeled with native history integration; backend/Auth/Storage is substituted. The playback restoration check controls the media element's metadata event and position. These are **not authenticated Next/Supabase end-to-end acceptance tests** or real expired Storage capability tests. Database verification uses real PostgreSQL/Sharp with a substituted storage provider. No live production database/catalog, deployed headers, auth session, storage or crawler validation is claimed.

The chat E2E helper and smoke assertion were updated to the current contenteditable composer and `?thread=` route. Running them still requires a correctly isolated disposable Supabase Auth/Storage environment and E2E credentials.

## Ponytail review and release notes

The implementation follows the installed Ponytail skills: trace all callers, reuse shared/native facilities, fix root causes, retain boundary validation, and provide runnable checks. Complexity cuts include the separate persisted timeline cache, invitation DTO duplication, repeated bookmark parsing and bespoke tab query rebuilding. It adds no new framework, metadata store or dependency. Existing deliberate shortcuts remain; the sequence ceiling is explicit.

Before release, run authenticated E2E against disposable Supabase, including full-page/window target promotion, private membership removal, login redirects, real signed-URL expiry and seeking, and message edit/delete/preview removal across tabs. Validate the deployed private metadata and cache headers. The unrelated seven unit failures prevent claiming the complete repository release gate is green.

Rollback is a revert of this task's application/test/documentation edits; no data migration rollback is needed. Keep unrelated working-tree edits. Removing v2 preview reads leaves old Redis entries to expire naturally. Legacy timeline-cache keys are deliberately purged; no message rows are deleted by that purge.
