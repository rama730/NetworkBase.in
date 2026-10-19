# Person-card scenario review — 2026-10-17

Status: the six confirmed findings were implemented and verified with code-only checks. Rendered pixel geometry remains unverified under the existing no-browser constraint.

## Scope and evidence

Reviewed the linked person-card-design.html gallery and its studio, rendering, CSS and simulated interactions against the shared application components. The preview contains 45 named scenarios. Its script parses, and all 90 scenario/Network-or-rail combinations generate markup without throwing. Basic missing-data, invalid-date, locked-profile masking and revoked/self exclusion checks pass. Fifteen focused application unit tests pass (person-card dates/fallbacks, avatar tones, network browse queries, connection feed contracts and Discover rail contracts).

No browser or screenshot monitoring was used. Code-level markup generation cannot establish rendered pixel dimensions, font metrics, truncation, focus behavior or visual containment at every viewport. Existing browser fixtures were read for coverage only, not executed.

## Confirmed gaps

| Area | Finding | Required correction |
| --- | --- | --- |
| Preview: skill appearance | `.skill` still has a 3px radius, and `skillMarkup` renders text without a branded icon. Production uses pill-shaped `.nb-tag` skills and `SkillIcon`. | Synchronize preview tags with current pill geometry, branded icons and name-only fallback for skills without an icon. Remeasure fitting with icon widths. |
| Preview: invitation dates | `shortRequest` hardcodes `12 Oct` for incoming connections and `12 Oct 2026` for project requests/applications. It ignores `requestedAt`; sent connection requests return no date. | Format each record’s timestamp. Include day, month and year for every invitation/request variant, including compact wording. |
| Preview: legacy connection dates | Unknown and invalid acceptance scenarios still show only `Connected`. Their descriptions and audit instructions predate the approved request-month fallback. | Show a separately labelled request month/year when acceptance is unavailable; preserve verified acceptance precedence and truthful tooltips. Add a case with neither timestamp. |
| Preview: broken avatar | `brokenAvatar` is declared in one scenario but never read by the renderer. Its markup is identical to the complete profile; no image or failure handler is exercised. | Add a real failing image and fallback path to the preview, retaining the avatar box, initials and presence placement. |
| Application: blank action names | `PersonCardContent` trims identity text through `personCardName`, but `PersonCard` derives action labels from `fullName || username`. A whitespace-only full name wins, leaving an effectively blank name in Connect/Requested/Connected action labels. | Use the same canonical name helper for the visible identity and every action label. |
| Application: small metadata targets | The preview expands shared/portfolio/location/subtitle hit areas with a minimum 24px pseudo-element. Production metadata links/shared buttons have no corresponding minimum target or hit-area extension; the 12px metadata line is approximately 16px tall. Primary narrow/touch actions already have 44px rules. | Preserve visible typography and card height while providing the approved minimum disclosure hit area, without overlapping neighboring controls. |

## Scenario groups reviewed

- Identity/data: complete, sparse, name/handle missing, whitespace-only fields, no headline, portfolio fallback, location fallback, no location, no skills, skills-only, portfolio-only, minimal collaboration profile.
- Public evidence: one, many, private-only, completed/historical and untitled portfolio projects; missing metadata; duplicate skills and long labels.
- Relationships: connected, shared plus connected, zero/unknown/large shared counts, incoming/sent connections, project invitations, sent project invitations, applications and long role/project context.
- Access/reliability: collaboration off/unknown, request restrictions, messaging restrictions, signed out, locked, blocked/revoked/deleted, self exclusion, initial loading/failure, background/optional data failure, offline and invalid timestamps.
- Layout rules: 176px card boundary, Network/rail padding, 429px action-placement breakpoint, 40px touch avatar/44px touch action rules, missing-row collapse, one-line identity/context and measured skill overflow, light/dark tokens, mixed-direction content.

The architecture supports these groups, but the six confirmed gaps and unverified rendered geometry mean the gallery should not be described as perfect in every scenario.

## Implementation follow-through

- Preview skills use pill corners and embedded artwork generated from the application’s canonical SkillIcon/catalog and theme policy. Eight supported brands among 21 preview labels have artwork; generic/unknown skills retain names only. The fitting pass measures the resulting icon-plus-text chips.
- All connection/project invitation and application dates are derived from requestedAt and include the year in both full and compact wording. Connection acceptance/request fallback wording matches the app helper. Simulated send/accept actions update their own timestamps. The fictional baseline request now precedes its acceptance.
- Added explicit no-date and UTC year-boundary scenarios (47 scenarios total). Historical-date descriptions and rule text reflect the approved fallback.
- Broken-avatar cards render a failing image above their deterministic initials. A captured image error removes only that image, leaving the avatar box and presence intact.
- PersonCard action labels now use personCardName, matching visible card text for blank, missing and padded names.
- Person-card metadata controls have 24px hit areas without adding grid rows or changing card height. Truncated subtitle links use padding balanced by negative margins, so overflow clipping cannot discard the enlarged hit area; headline and fallback spacing remain distinct. Scope is limited to person cards.

Verification: preview JavaScript syntax and all 94 scenario/surface combinations pass basic render/masking checks. A Node VM harness verifies real preview date functions against the app formatters, every invitation type, year boundaries, missing dates, icon/name-only markup and the avatar error handler. Server rendering of the production PersonCard verifies nine name/status combinations. All 23 focused unit checks pass; TypeScript and targeted ESLint pass. No browser was used, and Messages was not edited.
