# Network filter panel refinement — 16 October 2026

This refinement supersedes the inline ordering controls and centered filter dialog described in the earlier Network toolbar audit.

- Removed the Suggested Recommended/Best match label from the toolbar. Existing server recommendation/search ordering is unchanged.
- Moved Invitations Newest/Oldest and Connections Recently connected/Name into Filters. Every Network tab now has the same compact search + Filters toolbar.
- Extracted Discover's existing drawer presentation into `src/components/ui/filter-panel.tsx`; Discover and Network both consume that exact shell. Desktop width, mobile bottom-sheet breakpoint/height, header, scrollable body padding, footer, Clear all and Done share one implementation.
- Discover and Network both apply each selection immediately while the panel stays open, including skill, location, checkbox, direction/type and sorting changes. Clear all updates immediately. Done, Escape, overlay and close only dismiss the panel and preserve selected options. The shared shell has no apply-on-Done callback. Selected ordering is included in the active-option count and Clear all reset.
- Reused shared skill picker, checkbox, select and input components; kept section-specific controls and saved URL state. Updated the loading shell to remove the extra ordering placeholder.
- No action, query, privacy rule, database schema or persisted record changed in this refinement.

Verification covers both pages' drawer geometry, desktop and phone layouts, sorting placement, reset, focus restoration, URL state, tab baselines, compact search and loading/card geometry in Chromium and WebKit. Passed: 18 browser checks across Chromium and WebKit, six URL/feed unit tests, scoped ESLint, standalone TypeScript, the production build, impact review (16 records), and whitespace/diff checks. No database tests were repeated because this refinement changes only UI composition and existing filter controls.

Follow-up: removed Network draft state and the shared apply-on-Done callback. Browser coverage now checks updated feed arguments and URL state while the panel remains open, closure without a second history change, and selections surviving close/reopen and Back navigation.

Immediate-filter follow-up verification passed: six Chromium/WebKit browser checks, scoped ESLint, standalone TypeScript, impact review, and whitespace checks. Tests cover live feed arguments, multi-word location typing, skill and checkbox selection, ordering, invitation direction/type, immediate Clear all, close/reopen, Back restoration, and Done closing without an additional URL/history update.
