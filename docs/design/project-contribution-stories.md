# Project contribution stories — application implementation

The approved local preview is the reference for this implementation, including the final flat position-history rows and the rule that a start month stands alone when Current is unchecked and no end month is supplied. Illustrative projects, demo counts, the preview banner, and Explore scenarios are fixtures; production uses real authenticated records and failure handling.

## Feature closure

| Preview capability | Application implementation | Code verification |
| --- | --- | --- |
| Contribution overview, search, visibility filter and incremental loading | `ContributionWorkspace`, existing paginated profile API, 50 rows/page and 500/session | Contribution contracts; bounded read/database tests |
| Dedicated project editor instead of an accordion | `EditProfileTabs` mounts `ContributionWorkspace`; `?section=experience&contribution=<id>` selects the project | Source contract; production type/build checks |
| Full summary, formatting, lists, links, undo/redo and writing starters | `ContributionSummaryEditor` uses the application's Tiptap/Markdown dependencies | SSR escaping/render checks; shared editor compilation |
| Teammate, file, task and sprint mentions, including typed @ | Updates' shared inline reference options, name/username search, non-inclusive styled links, atomic deletion and live public-resource resolution; stored tokens contain identities only | Editor callback/ProseMirror/serialization tests and database search/revocation checks |
| Optional file contribution count inside the summary | Activity reference resolves the real distinct eligible project-file count; no separate evidence card | Public read and summary render contracts |
| Compact visitor story and faded image glimpse | A single measured-height reveal expands summary, media, positions, skills and links together | SSR single-reveal/inert checks; reduced-motion CSS |
| Project website, repository and supporting links with identity | Public links use accessible icon-only anchors at the heading: GitHub for GitHub destinations, globe for other sites; duplicate URLs and unsafe URLs are excluded | Link classification and SSR heading/icon/accessibility checks |
| Personal start/end months and explicit current status | Presentation dates are distinct from recorded team membership | Date/model tests and immutable-record database checks |
| App-native flat position history | Open divided rows; metadata date column; pencil Edit and inline fields; mobile container queries | Compiled UI and design tokens; source contract |
| Visitor position history | Shown only for two or more visible positions; a single role stays in the heading and its unique responsibilities remain in the body | SSR one/multiple/hidden-position tests |
| Missing end date | Start month/year alone; Present appears only for explicit Current | Date/model and SSR checks |
| Concurrent roles, responsibilities, hidden recorded roles and personal roles | Up to 20 presentation positions; recorded stage IDs validated; actual stage rows remain immutable | Position/duration tests; provenance-forgery database test |
| Role removal and Undo | Personal role removal detaches images; Undo restores still-unassigned image associations | Pure position tests and restoration handlers |
| Skill selection | Existing canonical SkillPicker and relational contribution skill synchronization | Existing contribution/skills contracts; publish path |
| Images from upload, paste, drop or public project files | Private signed uploads, upload intents/quotas, decode verification, explicit project-image publication consent | Upload-scope/quota binding and image-access database tests; existing upload security tests |
| Caption, image description, cover, ordering and role association | Eight images; required publication descriptions; drag or keyboard arrow ordering; optional position association | Story validation, model tests and typed editor handlers |
| Replace, remove, per-image retry and Undo | Replacement preserves caption/position, requires a fresh description; cancelled uploads do not attach; failures retain the story | Media handlers, validation and shared asset lifecycle tests |
| Image viewer | Previous/Next, arrow keys, counter, position context, Escape/focus restoration through the shared dialog | SSR/component compilation; shared dialog primitive |
| Separate private draft and public publication | Private draft table and published parent snapshot; Save draft and Publish updates are distinct commands | Real database draft/public separation test |
| Draft recovery and multiple sessions | Account-scoped IndexedDB journal, serialized autosave across projects, BroadcastChannel refresh, optimistic versions and three-way conflict review | Three-way merge tests; database stale-version/idempotency tests |
| Owner draft preview and visitor preview | Preview draft uses the private document; Visitor view uses the last publication and current sharing gates | Draft/public database tests; SSR story tests |
| Hide, private-project restrictions and unlisted consent | Hide updates parent visibility immediately; private/draft/deleted projects cannot publish; unlisted listing requires consent | Restriction, hide and unlisted database tests |
| External creation, deletion and Undo | Private external records; recoverable soft deletion; restoration remains private | External lifecycle database tests |
| Link external contribution / reviewed duplicate merge / Undo | Membership authorization, duplicate review, private-only merge, idempotent retry and version-checked atomic undo | Real database link/merge/retry/undo test |
| Pin and export | Featured ordering; per-contribution JSON export; account export includes published and private documents | Typed handlers; schema and owner-scoped account export |
| Restore published content | Explicit restore into a private draft with Undo; visitors remain unchanged until Publish | Separate snapshot persistence contract |
| Membership/team changes | Recorded identity/access/history stay canonical; new recorded stages reconcile into the next owner draft without silently changing publication | Legacy normalization/provenance tests; lifecycle read model |
| Loading, empty, validation, save failures and conflicts | Persistent status/error states, retry controls, preserved recovery journal, actionable validation and bounded loading | Unit/database rejection and rollback tests |
| Themes, narrow layouts and keyboard access | Shared application tokens, semantic statuses, 44px touch targets, visible focus, accessible field labels/dialogs and reduced motion | Theme contract, SSR semantics and compilation; no visual/browser verification claimed |

## Authority and privacy

- `profile_project_contributions.presentation` is the last published story. Its parent `visibility` remains the public visibility authority.
- `profile_contribution_drafts.document` is private. It has owner-only RLS, and public queries never select it. Saving a draft does not rewrite published content or canonical membership fields.
- `profile_contribution_media_assets` protects assets referenced by either a draft or its published snapshot from garbage collection. Reattaching a recently retired image safely restores it from pending deletion while holding the asset lock.
- Uploads use private `contribution-images` storage and the existing upload-intent, quota, integrity and deletion services. File names and arbitrary image URLs are not trusted as authorization.
- `/api/v1/contribution-images/[id]` checks the current published snapshot, profile relationship, project availability and project-file permissions before proxying bytes. Responses are private/no-store. No permanent public storage URL is published.
- Structured references contain kind/ID, never an author-supplied public label. Current public profile/project/tab access supplies display names and destinations. Restricted resources use generic labels; published project images are removed from the delivered story if their source becomes unavailable.
- Mentioning a person sends no notification. Independently written prose or text embedded in an image remains the author's content; structured-reference checks do not pretend to redact that content.
- General profile updates and the retired stage endpoint remain separate. Presentation positions do not change team roles, membership, or permissions.

## Database rollout

Migration `0237_profile_contribution_stories.sql` adds the published presentation, private drafts, media references, retry index and private storage bucket. It is registered in the journal and SQL-governance manifest. Following user authorization, it was applied to the configured application database through `npm run db:setup` on October 23, 2026 (Asia/Kolkata), completing at `2026-10-22T23:53:37.401Z`. It was the only pending migration. Read-only SQL verified the source checksum, journal index, columns, defaults, private tables, owner RLS policies, constraints, indexes, private image bucket limits and role grants. `npm run check:db:live-lineage` passed with 235 canonical tags and 7 legacy aliases. Application deployment remains separate and was not performed.

## Verification boundary

Checks for this implementation use code, SSR rendering, build compilation, static contracts, disposable database integration, and read-only application database catalog verification after the authorized migration. No browser automation, manual browser inspection, screenshot comparison or production deployment is part of this verification. Storage-provider signing/stream transport is stubbed at the external boundary in the image-access database tests; ownership, SQL persistence, RLS, snapshot selection and permission changes use the real migrated disposable database. Fixture tests were not run against the application database.

The machine-readable result is in `project-contribution-stories-verification.json`. A broader existing runtime-boundary check also flags direct Supabase channel use in `GitHubSyncWorkspace.tsx`, which is outside these contribution changes.


## Final check results

- 84 unit, SSR and direct editor-state checks passed; no browser or DOM engine was used.
- 13 database checks passed against a dedicated local PostgreSQL instance, including draft/public separation, stale versions, request replay, owner-only drafts, public reference revocation, upload scope/quota binding, image delivery, unlisted consent, merge/undo and hiding with unavailable media. One of these checks covers the existing shared asset-reference lifecycle.
- 45 existing Desktop IDE, task Files integration, launch-route and design contracts passed. The shared Files/task toolbar control and My Work header were retained and audited through code.
- TypeScript, scoped ESLint, production build, contribution contract, theme contract, API envelope, migration journal, SQL governance and impact review passed.
- The broader runtime-boundary check still reports the pre-existing direct channel subscription in `GitHubSyncWorkspace.tsx`. No contribution code introduces a direct Supabase subscription.

Reproduce the new functional checks with `npx tsx --test tests/unit/contribution-story.test.ts tests/unit/contribution-story-render.test.tsx tests/unit/contribution-workspace-state.test.ts`. Run `tests/db/contribution-stories.test.ts` with `DATABASE_URL_FRESH` pointing at a separately migrated disposable database. Do not point fixture tests at the application database.

## October 23 status and layout follow-up

The personal project current flag now bounds the current flags of its positions. Clearing it clears position current flags while preserving known dates and leaving unknown end dates blank. Selecting a current position marks the personal project ongoing and clears its end month. These rules apply in editor callbacks, story reads/recovery, published rendering and server writes. Canonical team membership and recorded role history remain unchanged; previously inconsistent snapshots render consistently without a data migration.

The project title and primary position share one non-wrapping identity row. Component-local Tailwind utilities keep the metadata aligned; long identity text truncates with the full title available on hover and in the DOM. Position history and individual positions have emphasized semantic headings. Contribution padding, section gaps and skill pills are smaller; summary typography stays at the application's readable body size. The subsequent upload/editor follow-up below moves the icon links onto the first row before the date.

Follow-up code-only verification passed: 36 unit/SSR/editor-state/profile tests, 13 disposable database tests, TypeScript, scoped ESLint, contribution and theme contracts, and application CSS compilation without warnings. No browser was used, and no fixture tests touched the application database.

The subsequent header correction also passes a compiled CSS regression test for the two-column first row, baseline alignment, non-wrapping identity/date, right-aligned second-row links and truncation. SSR assertions check that the rendered header uses those compiled utilities. This supplements the earlier source-only layout assertions; it does not claim browser verification.

## Position source and link simplification follow-up

The read mapper previously passed recorded role-stage labels straight into stories. Those labels could contain old generated values such as `Lead - Lead`, even while the project's current lead focus held the correct position. Current stage presentation now resolves the project position from live team metadata or an accepted role, with a specific recorded title as fallback. Contribution labels place the position first and membership second, for example `Product Designer · Lead`. Ended stages retain their own historical position. Generated generic/decorated titles in existing drafts and publications reconcile on read; distinct personal title overrides and stored canonical history are preserved.

Visitor history is omitted when fewer than two positions are visible. A sole position's unique responsibilities remain readable without repeating its heading. Empty single-role entries no longer create a Read contribution control just for duplicate history. The Linked project/Self-reported text is removed. Safe website, repository and supporting links appear once as icon-only links, using GitHub for GitHub URLs and globe for other sites, with explicit accessible labels and destination tooltips.

Code-only verification passed: 40 unit/SSR/editor-state/profile/compiled-CSS tests and 14 isolated database tests, plus TypeScript, scoped ESLint, contribution and theme contracts. The database regression reproduces a stale parent, stage and snapshot with a correct live project position, verifies corrected owner/public reads, and checks that custom titles and stored historical records remain unchanged. Application database inspection for diagnosis was read-only; no browser or application data migration was needed.

## Upload, validation and editor footer follow-up

Section navigation and invalid-field focus now scroll only the owned editor pane, rather than using `scrollIntoView` on all ancestors. Outer editor containers use overflow clipping. Native file input is hidden and excluded from keyboard focus; selection restores the visible trigger with `preventScroll`. The contribution action footer portals into a sibling of the scrolling pane, with no sticky positioning or negative bottom offsets, so content remains reachable above it.

Publication validation identifies individual images and fields. Missing descriptions receive a red invalid-field outline, an associated inline alert, and focus within the editor pane; correcting the text clears the error. Project image permission errors are also associated with their checkbox. Image descriptions retain their alternative-text purpose and now appear visibly below expanded published images and in the image viewer, separately from optional captions, with duplicate text suppressed. A database check confirms descriptions survive publication/public reads and rejects missing descriptions without a partial publication.

Header icons now appear immediately before the joining period in the first row. Publish updates appears only when the working document differs from the last publication (or images are pending), remains available after saving an unpublished draft, and disappears after successful publication. Cancel follows Save draft, preserves local private recovery, and exits to the normal profile. If other profile sections have unsaved changes, the existing discard decision remains visible before leaving.

Code-only verification passed: 47 unit/SSR/editor-state/profile-route/compiled-CSS tests, 14 isolated database tests, TypeScript, scoped ESLint and contribution/theme contracts. The state harness verifies conditional publishing, field-specific validation and focus, Cancel recovery, portal destination, hidden file input and non-scrolling focus restoration. No browser was used; no application database migration was needed.

## Footer runtime stylesheet and Updates mention parity follow-up

A read of the running development app's CSS response revealed that it still served the obsolete `.nb-story-footer` rule with sticky positioning and negative bottom/margin offsets. The contribution footer no longer uses that selector: its flex layout, padding and safe-area spacing are local Tailwind utilities on the action element. The unused global rule was removed, and the development server was restarted. A subsequent HTTP source read confirmed that the served stylesheet contains no obsolete footer rule and includes the current safe-area padding. This checks the running artifact without a browser.

Updates and contribution summaries now share `ComposerReferenceOptions`, including search styling, option rows, loading/empty/error states, native keyboard controls, Escape dismissal and non-scrolling input focus. Contribution mentions open inline below the editor, including typed `@`, and insert at the retained editor cursor. Reference links use Updates' non-inclusive, emphasized style; trailing text is outside the link. Both editors share the ProseMirror whole-reference Backspace/Delete extension, including links split across formatted text nodes, without requesting ancestor scrolling. Contribution tokens still persist identities alone. Name and `@username` searches are restricted to public project teammates, and labels/targets are rechecked on public reads.

Code-only verification passed: 89 targeted unit/SSR/editor/ProseMirror/Updates checks and 14 isolated database tests (103 total), TypeScript, scoped ESLint and contribution/theme contracts. Tests cover typed mention opening, debounced search, insertion and dismissal, identity serialization with special-character names, atomic deletion, footer portal/layout classes, username search and private-profile revocation. The development CSS response was verified directly; no browser was used.
