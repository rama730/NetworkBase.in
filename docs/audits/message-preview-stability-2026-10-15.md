# Message preview stability — 15 October 2026

Implemented the final scoped addition to the profile/project sharing review. The complete project-sharing implementation and its 16 disposable-database checks are documented in [project-sharing-implementation-2026-10-15.md](project-sharing-implementation-2026-10-15.md). The Messages shell, navigation, presence, composer, attachment layout and sharing destination picker were not redesigned.

## Changes and root causes

- The previous `.msg-rich-content` unlayered max-width overrode the first-party card's Tailwind maximum. First-party previews now have a dedicated wrapper: 50% of the actual message content lane, capped at 480px; below a 640px lane they use available width, capped at 480px. Native container queries also cover threads and split windows. Existing card content, font sizes and outer message rows remain in place.
- The author-only remove control is a 44px card-corner button, separate from the linked card. It appears on hover/focus and remains visible on touch. The existing message menu/touch sheet provides remove/restore. The redundant permanent action row is gone. The existing server mutation still enforces author, live membership and nondeleted message rules. Local duplicate mutations are guarded; failures roll back and announce the error; focus returns to message actions or the touch row.
- First-party previews previously refetched every 30 seconds and replaced their content with a generic loading card whenever `isFetching` was true. Zero cache retention also restarted loading on remount. The shared hook now distinguishes fetching from display authorization; unchanged content retains its structural reference and the memoized card. Only initial loading uses skeletons. A bounded neutral slot reduces movement when authorization must be masked.

## Authorization and cache boundaries

The existing private no-store first-party endpoint returns a display authorization record with viewer ID, SHA-256 session binding, opaque resource identity and issue/expiry times. No raw session, token, viewer context or secret is returned. Expected actor/session headers are checked against the verified server context before resource reads. The expiry is at most 60 seconds and is capped by the verified token expiry.

The client validates actor/session/resource, charges the entire request's elapsed time and enforces both monotonic and wall-clock deadlines. HTTP Date rounding cannot extend a sub-second token lifetime. The record is a UI freshness bound; server resource reads and destination actions continue enforcing authorization independently.

Query keys retain URL/account/session scoping and move to v4 for the new snapshot shape. The existing Query cache provides request deduplication and structural sharing; no second cache or dependency was introduced. Five-minute in-memory inactive retention avoids remount churn but never extends display permission. There is no persisted private preview snapshot or sender-provided identity payload.

Only visible message occurrences enable their query observer; any visible occurrence keeps the shared URL active. Hidden/offscreen cards stop interval work. Offline and hidden-page transitions mask proofs, and return/back-forward restoration obtains fresh access. Known privacy changes, membership events and sign-out mask/cancel before renewal. Canonical profile/project mutations notify existing eligible private user topics using resource hashes only. Late/canceled reads cannot restore old-account details. Failed or unknown authorization never falls back to a cached private card.

Best-effort broadcasts do not reach every public visitor and can be missed. Visible queries retain a 30-second authorization fallback and a maximum 60-second lease; a remote change with a missed event can remain displayed until the next check or expiry. This bounded limitation is deliberate and matches the approved design. Previously received images/content cannot be recalled from a recipient's browser. Ordinary external-site preview behavior was retained. The approved project-specific social-image renderer is covered in the full implementation report.

The shared hook also feeds project social links and the project update composer; the same freshness boundary applies there. ShareDialog's separate destination queries and chat synchronization retain their existing policies.

## Verification

- TypeScript passed and scoped ESLint passed, including the changed profile/project actions.
- 29 unit checks passed across the display contract, actual first-party route with isolated auth/data boundaries, existing sharing presentation, messaging metadata and destination scope. They cover actor/session rejection before reads, token-limited expiry, generic restricted responses, normalization and scoped invalidation.
- 48 browser checks passed in Chromium and WebKit using the actual sharing dialog, message rows, preview hook and card components with isolated network/auth data. They cover both card kinds, narrow/desktop sizing, author/recipient controls, desktop and touch restore, error rollback, offline/hidden/offscreen behavior, repeated URLs, expired/mismatched proofs, real content changes, late old-account responses, failed renewal and back-forward recovery.
- The two-minute browser sample in both engines used two visible messages containing the same URL. Each made five requests total (one initial request and four renewals), retained the same message/card DOM and text, and recorded **zero card content DOM mutations**. React Profiler recorded 16 subtree commits across the two observers as query state/proofs changed; this is not a claim of zero React renders. The memoized card content remained stable.
- Production webpack build completed successfully in the isolated `.next-preview-stability-check` directory. Temporary build-only tsconfig includes were removed afterward.
- API envelope/versioning, query-key, canonical-logic and impact-review checks passed. No database migration or data rewrite was needed.
- Firefox was attempted, but its local headless browser startup stalled; that owned test process was terminated. The completed browser evidence is Chromium and WebKit. These isolated component checks are not a claim of a production-server traffic soak.

Commands:

```sh
npx tsc --noEmit
npx tsx --test tests/unit/link-preview-display.test.ts tests/unit/link-preview-route.test.ts tests/unit/profile-sharing.test.ts tests/unit/messaging-url-metadata.test.ts tests/unit/share-destination-scope.test.ts
npx playwright test --config tests/browser/playwright.config.ts sharing.spec.ts --project=chromium --project=webkit
npx playwright test --config tests/browser/playwright.config.ts sharing.spec.ts --project=chromium --project=webkit -g 'two minutes'
NEXT_DIST_DIR=.next-preview-stability-check npm run build
npm run check:api-envelope-contract
npm run check:api-versioning-contract
npm run check:query-key-contract
npm run check:canonical-logic-contract
npm run check:impact-review
```
