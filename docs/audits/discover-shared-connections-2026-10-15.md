# Discover Shared connections

Replace Explore people below the suggestion cards with the design reference's
Shared connections heading, hairline and sunken avatar panel. Render at most
four square avatars linking to profiles; show the exact remaining count, with
singular/plural handling. When shared connections are absent, unavailable or
scoped to a different set of cards, show up to four additional suggestions as
“More people to meet”, with profile links and View more to Network's Suggested
tab. Hide the panel if neither source has eligible data.

“Shared” means an accepted connection of the viewer who is also an accepted
connection of at least one of the three full cards currently shown. Count each person once
across those cards. Exclude private/deleted/incomplete profiles and pending
or blocked viewer relationships. Connected profiles with connections-only
visibility remain eligible because the viewer is an accepted connection.

The existing authenticated suggestion feed optionally includes this summary.
The same bounded response loads seven suggestions: three cards and up to four
additional profiles. Shared totals apply only to the first three cards. The
additional profiles are never labelled as mutuals or counted toward that total.
One SQL read returns four shared identities and the distinct total; no per-card
requests, new endpoint, polling or schema change. The Discover parent and rail
share the same query key and SSR seed. Server cache/in-flight keys include the
summary flag. Other connection feeds do not request this additional read.
Summary failures log `connections.shared_summary_failed` and omit this optional
summary without failing the suggestion list or its additional suggestions.
Stale shared summaries for a different card set are hidden. Existing relationship/privacy invalidation remains
in use.

Validation:

- Targeted database integration check passed on disposable local Postgres. It
  exercises the actual authenticated action, opt-in/opt-out, both edge
  directions, deduplication across suggestions, four-avatar cap, exact total,
  visibility/deletion/onboarding, pending/blocked/unrelated peers and subsequent
  live graph updates.
- Six targeted browser checks passed across Chromium/WebKit with the real
  stylesheet and fonts, production rail/avatar components and isolated data.
  Checks cover desktop/narrow geometry, profile links, square fallback avatars,
  overflow count, compact drawer, empty/stale omission and additional suggestion
  fallback with three cards, four distinct extra profiles and View more.
- Five focused discovery/connection unit checks passed. TypeScript, scoped
  ESLint and query-key/impact-review checks passed.
- Broader existing failures outside this change: `discover-round2.test.ts`
  expects `s-maxage=3600` directly in the project OG route, which already
  delegates to `renderShareImage`; SQL governance reports the existing
  `drizzle/0216_project_members_user_role_idx.sql` missing from its manifest.
  Neither those files nor their behavior was changed for this task.

No authenticated live-account acceptance was performed; browser data and actions
are isolated and all database fixtures use the disposable database.
