# Project sharing implementation — 15 October 2026

Implemented the approved project-sharing design and its final compact/stable message-preview addition through the Ponytail workflow. Existing profile-sharing behavior is retained with the shared stability and image-revision improvements. The Messages shell, navigation, composer, presence design, attachments and destination picker were not redesigned.

## Visible behavior

- Project previews use the current project title and permitted description. A missing or failed project image removes the entire artwork box and its gap; there is no project-initial placeholder.
- One avatar stack includes the current owner and eligible current members, deduplicated and ordered, with at most five box-shaped portraits and an eligible-member overflow count. Skills, role chips and their overflow chips also use the design specification’s box-shaped borders. In-app hover and keyboard focus reveal names and roles. There is no separate creator byline. The schema has no immutable original-creator history, so the truthful fallback label is **Lead**, optionally followed by the configured lead focus, including after ownership transfer; no creator history is invented. Accepted member role titles and membership designations use the same `formatProjectTeamRole` helper as the detail page. Active guidance labels follow its member/public-consent visibility rules.
- Team privacy is applied before selecting or counting people. Deleted, blocked and unreadable identities do not contribute to the visible stack or overflow. Public crawlers see public identities only; authenticated previews use the recipient's permissions. If the project's dashboard is not readable, team, skills, recruitment and full-description details are withheld.
- Read-only view and follower aggregates use the detail-page BarChart2 and UsersRound icons. Zero, singular, compact large numbers, partial and unknown values are handled. Unknown is not converted to zero; preview reads never increment views or trigger follows.
- Up to four canonical, visible project skills appear with a remaining-count chip. Up to three currently available role titles appear with overflow attached to the third. Eligibility uses active roles with unfilled seats. Completed, archived and unpublished projects do not advertise recruitment. The card advises opening the project to check current availability. No presence, building, productivity or new lifecycle badge is added.
- Draft sharing is explicitly unpublished. Private, unavailable and unknown responses stay generic and do not retain former names, images or newly discovered readable slugs.

## URLs, sharing and send recovery

General Share actions produce the canonical project root without workspace, task or tracking state. Explicitly pasted project content links preserve validated, tab-specific destinations. The shared URL parser bounds values and rejects traversal, protocol-like paths and unrelated parameters while allowing normal Unicode file paths. A preview's resource identity stays separate from its opening destination.

The share dialog keeps its existing Projects → that project's channels / Direct messages picker. Copy, native sharing, manual-copy fallback, sign-in and offline states retain the draft and require deliberate actions. Account changes synchronously hide the previous account's draft, resolved URL and receipt before effects clear state.

An uncertain send retains its original idempotency ID, destination and note across Back/reopen. **Check earlier send** is a receipt-only server request: it cannot insert or publish a message. A confirmed missing receipt permits an explicit retry of the original intent. Edited notes and a different destination remain a separate draft; they never silently reuse the old request or auto-send. After a canonical URL changes, explicit retry may use its current canonical URL only when the verified resource identity still matches, retaining the original idempotency ID. Live resource/destination authorization is rechecked for actual sends.

Existing slug/UUID resolution is reused. There is no historical slug-alias database; a title edit does not introduce slug editing or guessed redirects.

## External artwork and assets

Project social artwork is a real 1200 × 630 PNG with fixed light styling, a stable title/description layout, team portraits, the same metric icons, skills and open roles. Without project artwork, text starts at the left content edge. Team images use verified owner-matched assets; project artwork uses verified project-matched assets. Unsupported or missing member portraits use safe initials. Reads are bounded by asset size, pixel limits, per-read deadlines and a total asset-time budget, with limited concurrency. The renderer fetches no arbitrary remote image or font.

Image revisioning includes current asset IDs, hashes/keys and URLs, so replacing an asset at the same URL changes the revision. Resource permissions and security-sensitive model fields are rechecked after asset reads and after rendering. Revoked/changed data cannot return the old image. Volatile counters are excluded from the final security signature so ordinary view increments do not incorrectly suppress every render.

Optional skills/roles are omitted from the fixed image as a whole when available space or bundled-font coverage cannot represent them legibly. If the main identity text cannot be rendered by the bundled font, the image uses branded generic artwork with accurate generic alt text; HTML metadata retains the full permitted Unicode identity. Image alt text includes the approved team/role/statistics summary when the corresponding project artwork is rendered.

Third-party apps may cache previously public metadata/images. Versioning and no-store responses protect future reads but cannot recall a recipient's retained copy or promise instant external refresh.

## Compact, stable previews in messages

Both profile and project cards use 50% of the actual message-content lane, capped at 480px. Below a 640px lane they use available width, capped at 480px, including threads and split panes. Content and typography are preserved. The author-only 44px remove control sits in the upper-right corner, with hover/focus and touch access; restore uses the existing message menu/touch sheet. The server's existing author and live-membership rules remain authoritative. Mutation errors roll back and return focus without adding a permanent action row.

The root causes were an unlayered max-width overriding the card utility, loading replacement on every 30-second background read, and zero inactive cache retention. The shared query now retains structurally unchanged content and deduplicates visible occurrences by URL/account/session. Offscreen observers pause requests; hidden/offline pages mask authorization. A server-issued actor/session/resource-bound display lease lasts at most 60 seconds and is capped by verified token expiry. The client charges request elapsed time, enforces monotonic and wall-clock expiry, and masks failed, mismatched, expired or known-revoked access. Cache retention does not extend display authorization. Refocus/back-forward recovery rechecks access; late old-account responses cannot restore content. Existing private user topics carry resource hashes after canonical mutations.

A missed remote event can leave a visible card until its next 30-second check or lease expiry. This approved bounded display policy is not server authorization. See [message-preview-stability-2026-10-15.md](message-preview-stability-2026-10-15.md) for the detailed display contract.

## Verification

- TypeScript and scoped ESLint passed.
- **29 unit tests passed** for presentation, metadata, destination validation, normalization, actor/session/resource binding, deadlines, scoped cache invalidation and the actual preview route with isolated data/auth boundaries.
- **17 database tests passed** against an owned disposable PostgreSQL 17 instance, using the migrated schema and real queries. Coverage includes public/member/blocked/deleted identity filtering before team overflow, skills and active vacancies, completed/archived/draft states, dashboard privacy, read-only counters, receipt-only no-write behavior, asset ownership, same-URL asset revision changes, and actual 1200 × 630 PNG output. A positive portrait-pixel assertion confirms a permitted portrait renders; revocation removes it.
- **48 browser tests passed** across Chromium and WebKit using the actual share dialog, message row, preview hook and cards with isolated auth/network responses. Coverage includes desktop/narrow/fractional container widths, both card kinds, pointer/keyboard/touch controls, rollback, loading, wrong/expired proofs, hidden/offline/offscreen/refocus/remount behavior, account races, genuine content updates, external-preview compatibility, team/metrics/role/no-image layout, explicit versus general destinations, and uncertain receipt recovery with changed drafts.
- In the two-minute same-URL browser sample, two visible messages made five total requests and retained the same message/card DOM and text with zero card-content DOM mutations. React Profiler recorded 16 subtree commits across query/proof updates; this is not a claim of zero React renders.
- The isolated production webpack build passed. API envelope/versioning, query-key, canonical-logic and impact-review checks passed. No dependency, migration or data rewrite was added for this implementation.
- Firefox's local headless startup stalled during an attempted run; the completed browser evidence is Chromium and WebKit. Component/database tests and builds do not constitute a production traffic soak or pixel-exact third-party crawler certification.

Two broader repository checks still report pre-existing issues: SQL governance flags the unregistered `drizzle/0216_project_members_user_role_idx.sql`; data-shape governance flags direct snake_case identity fields in existing messaging, presence, create-wizard and task comment surfaces. This implementation does not introduce those identity accesses or repair unrelated application architecture.

Runnable checks:

```sh
npx tsc --noEmit
npx tsx --test tests/unit/link-preview-display.test.ts tests/unit/link-preview-route.test.ts tests/unit/profile-sharing.test.ts tests/unit/messaging-url-metadata.test.ts tests/unit/share-destination-scope.test.ts
# DATABASE_URL_FRESH must point to an owned disposable database, never shared data.
npx tsx --test --test-concurrency=1 tests/db/profile-sharing.test.ts
npx playwright test --config tests/browser/playwright.config.ts sharing.spec.ts --project=chromium --project=webkit
NEXT_DIST_DIR=.next-preview-stability-check npm run build
npm run check:api-envelope-contract
npm run check:api-versioning-contract
npm run check:query-key-contract
npm run check:canonical-logic-contract
npm run check:impact-review
```

Core implementation: `src/lib/sharing/read.ts`, `presentation.ts`, `social-image.tsx`, `metadata.ts`; `src/components/sharing/ProjectShareContents.tsx`, `SharePreviewCard.tsx`, `ShareDialog.tsx`; existing sharing action, preview endpoint/hook and scoped message-card integration. Rollback requires reverting only this sharing/display-contract work, preserving unrelated workspace edits. No data rollback is required.


## Follow-up correction — avatar/chip geometry and role labels

Replaced circular project-team portraits (including overflow and external PNG portraits) with the detail-page box shape. Skills in both profile/project sharing previews, project role titles and overflow chips use 3px box corners without altering the shared global tag style. Replaced generic “Project owner” / “Team member” tooltip labels with the existing detail-page role formatter: “Lead / Engineering”, “Design · Member”, “Design · Co-leader”, or the canonical fallback when a specific role is absent. Accepted roles are read with the same current role-title source as the detail page; pending applications are excluded. Active guidance attribution is shown only to project members or when public consent permits it. A membership change during the read discards the old attribution result.

Follow-up verification adds computed corner-radius and keyboard-tooltip assertions in Chromium/WebKit and a real database regression covering lead fallback, accepted/pending role titles, co-leader labels, and guidance consent/end states. TypeScript and scoped production/test ESLint passed. The existing browser fixture has a separate pre-existing React immutability lint failure in its render-time test-data initializer; it is not part of the production source lint result.
