# Network header and browse audit — 16 October 2026

## Delivered

Network uses Discover's page-title/body typography, gutters and 24px page inset, with a 16px tagline-to-toolbar gap and 16px toolbar-to-results gap. The desktop toolbar reads Suggested / Invitations / Connections, compact 256px search, ordering, then Filters, with 8px between controls. The selected orange underline shares the gray divider's baseline. Narrow layouts wrap the control group above the tabs, keep horizontal tab navigation, and preserve the same baseline. Touch inputs/actions retain 44px targets. Existing cards retain their approved 176px boundary and internal layout.

Suggested retains its existing recommendation ranking (Best match when searching). Its filters match all selected public skills, location text, live visible shared connections and saved Open to collaborate status. Connections offers Recently connected / Name with public skills, location and shared-connection filters. Its recent order now uses acceptance time; legacy records without a known acceptance time use request time for ordering only, without displaying a fabricated connected date. Invitations offers Newest / Oldest, Received / Sent and connection / project request filters.

Filter dialogs have draft state, Cancel and explicit Apply; applied filters appear as removable chips with Clear all. Search, filters and ordering are independently stored for each tab in URL parameters, with refresh and Back restoration. Switching tabs also saves keystrokes entered before the search debounce completes. Clearing filters preserves the search and ordering; empty filtered results offer a full search/filter reset. The loading shell follows the same toolbar and card geometry.

## Data and architecture

- People filtering is applied in SQL before cursor predicates and LIMIT in the existing connection-feed reader, including the recommendation fallback source.
- Shared skill/mutual SQL projections are reused by filtering and card detail. Canonical assignments remain authoritative: private canonical skills never fall back to public legacy labels. Location matching escapes SQL wildcard characters.
- The Network-specific invitation reader unions pending connection requests, unexpired project invitations and authorized incoming project applications before search, direction/type filtering and keyset pagination. It searches the complete matching set rather than three truncated initial lists. Existing decision/mutation services remain the owners of relationship changes.
- Invitation cursors use timestamp/source/id tuples. Both invitation and recent-connection cursors preserve PostgreSQL microseconds, preventing skips among same-timestamp rows. Limits and cursor inputs are validated; reads are authenticated and rate-limited.
- Blocked/deleted people, expired invitations, deleted projects and applications outside the viewer's current authority are excluded. Optional private profile metadata cannot match filters or invitation search and is omitted from returned locked-card details.
- Invitation query keys sit under the existing pending invalidation prefix, outside the optimistic pending-request data shape. Existing connection and project decisions refresh the new reader. Global Cancel all is hidden while invitation filters/search are active.
- Failed next-page reads retain cards and offer an explicit retry; an intersecting pagination sentinel cannot automatically retry a failed page indefinitely. Invitation refresh failures also remain visible.
- No new polling, dependency, migration or data rewrite was introduced. Messages services were not changed by this work.

## Verification

- 11 focused unit tests passed: URL normalization/isolation/history, card rules, bounded loading and feed architecture.
- 11 disposable PostgreSQL tests passed: filter-before-pagination, legacy aliases/canonical skill privacy, literal location, saved availability, live shared counts, complete invitation search beyond 50 records, mixed-source paging in both directions, authorization/expiration/block/privacy exclusions, precise timestamp ties, existing person-card projections and connection paging.
- 56 browser tests passed in Chromium and WebKit using the real components with isolated service fixtures. Coverage includes 320–1440px layouts, every Network tab's underline, header geometry, compact search placement, filters/Cancel/chips/Back/refresh, explicit retry, empty reset, coarse-pointer targets, invitation failures, card geometry, shared people disclosure, and existing Discover/profile/project rails.
- Passed: scoped ESLint, final production build (including TypeScript), standalone TypeScript, query-key contract, canonical-logic contract, impact review (16 records), and whitespace/diff checks. The filter/history scenario was re-run successfully in both browsers after adopting the shared themed checkbox and preserving pre-debounce keystrokes.

The repository-wide data-shape check still reports pre-existing snake_case field violations in unrelated Messages, PersonHoverCard, project creation review and task-comment components. Those files were not changed for this task. Existing migration-journal/SQL-governance findings about the unregistered 0216 migration are outside this toolbar change. No whole-repository release-gate success is claimed.

## Rollback

Revert only the toolbar/browse files listed in `standards/impact-reviews/2026-10-16-network-browse-toolbar.json`. Preserve earlier card, profile, settings, rail and messaging changes already in the working tree. No database rollback is required.
