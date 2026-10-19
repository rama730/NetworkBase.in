# Network initial loading — 16 October 2026

The route's Suspense fallback previously covered authentication only. Once authentication resolved, NetworkClient showed its live title, controls and overview while the active people request was still loading inside the tab. This produced the mixed live-header/card-skeleton state in the reported screenshot.

Network now keeps its full route skeleton visible until the first active tab's existing reader settles. The active content stays mounted but hidden, allowing that same request to complete without a duplicate query. Suggested, Connections and Invitations each signal readiness on success, empty results or an error. A one-time page latch prevents later searches, filters, background requests or tab switches from replacing the live header with a full-page skeleton.

The shared route skeleton now includes a visible tagline shimmer and the overview heading's divider. Its header, toolbar, six person cards and overview placeholders preserve the current layout and geometry. Loading is exposed as one visible busy status; live controls remain hidden until ready.

Render/import errors also release the initial loading latch through an optional error-boundary callback, revealing the existing Retry fallback instead of hiding it indefinitely. Existing boundary consumers retain their previous behavior. No backend action, cache key, polling, schema, authorization or data mutation changed.

Verification: focused browser coverage exercises initial loading at desktop and phone widths, delayed completion, first-request failure, a render failure with Retry recovery, header retention during later searches, and loading/live card geometry in Chromium and WebKit. Existing Network/feed unit tests, scoped ESLint and TypeScript are checked for this change.

Passed: six focused loading/recovery browser checks across Chromium and WebKit, six existing Network/feed unit tests, scoped ESLint, standalone TypeScript, the final production build (including its TypeScript check), impact review and whitespace checks. The remaining Network browser checks also passed during the initial regression run. The loading page does not expose a hidden page-search target to the global header until the page is ready.
