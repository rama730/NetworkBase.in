# NetworkBase design implementation

Updated 8 September 2026. Source: `networkbase-application-design-specification.html` and the supplied NetworkBase Design System folder. Implementation began 7 September 2026.

**Status: implementation and source-verification pass completed; full application acceptance is pending.** Do not interpret the source register or passing build as proof that every authenticated screen, permission branch and recovery state matches the reference.

## Preparation and decisions

- Retained Next.js 16, React 19, Tailwind 4, Radix, Supabase and the existing application architecture.
- Preserved existing Tasks/Files/IDE work and unrelated audit changes. A pre-change source snapshot was used to distinguish baseline test failures from redesign regressions.
- Literal reference geometry: 248px desktop sidebar, 56px topbar, 20px workspace inset/gaps, 24px discovery/profile gutters, 16px portfolio gaps. Tablet navigation uses a 56px rail; mobile opens a labeled drawer.
- Bundled Instrument Sans, Instrument Serif and JetBrains Mono locally with their SIL Open Font Licenses. Next localFont removes build-time font CDN dependence. Kept installed Lucide 0.562 with 1.75 strokes; third-party logos remain separate.
- Persisted statuses stay unchanged: draft → Forming, active → Building, completed → Shipped, archived → Archived. Custom lifecycle names are preserved.
- Decorative clay is #D14E24; accessible action clay is #C24720. Small neutral text uses accessible aliases. Six accents, three densities and light/dark/system preferences are retained.
- Reference testimonials, prices, example identities and statistics are not production data. Existing root authentication redirects are retained.

## Implemented presentation work

| Family | Changes |
|---|---|
| Foundations / brand | Paper/ink/clay semantic tokens, type scale, spacing, radii, flat surfaces, icon strokes, focus outlines, reduced-motion behavior, local fonts, square wordmark, favicons, application icons and sharing images. |
| Shared primitives / feedback | Buttons, inputs, checkbox, cards, tabs, dialogs/drawers, tooltips, toast position, skeletons, empty/error states and squared avatar fallbacks use the shared system. Existing interaction APIs remain available. |
| Shell / navigation | Desktop sidebar, tablet rail, mobile drawer, breadcrumb topbar, skip link, profile identity, message/request attention, notifications, contextual search and My work entry. |
| Discover / Network | Flat discovery layout with supporting context, card/list selector, stage/type/sort filters, scope controls, project-card anatomy, skill labels, follow busy/error handling, people cards and underlined Network tabs. |
| Profiles | Identity header and squared 72px avatar, underlined tabs with keyboard navigation, content/320px rail layout, two-column portfolio with actual stages, roles, skills, identities and available counts. |
| Project workspace | Expanded identity hierarchy, compact tool header, eight retained tabs, 20px workspace geometry, dashboard main/300px context rail and standardized cards. |
| Tasks / sprints | 300px Kanban columns, wrapping task cards, bounded task drawer, 220px sprint navigation, shared timeline/modal styling. Lifecycle stage editing has keyboard move controls as a drag alternative. |
| Documents / Files | Reading/editor widths, file tree baseline 240px, flat preview surfaces, 320px inspector with an actual-container check that reserves 520px of canvas, drawer fallback, existing version/sync/IDE flows and scroll ownership retained. |
| Updates / analytics | Main/300px update rail, matching loading skeleton, flat composer/content surfaces and shared analytic typography, borders and colors. |
| Messages / personal work | 320px conversation rail, flat message surfaces and squared identity fallbacks, in-flow composer with safe-area padding and 44px action targets, retained attachments/replies/drafts, 520px personal-work drawer. |
| Creation / onboarding | Numbered five-phase creation header, proper modal/page presentations, bounded content, responsive footer and draft status, safe-area padding, onboarding rail and common typography. |
| Settings | 200px navigation, shared section surfaces and fields; project settings retain all sections and use a native section selector below wide desktop. |
| Authentication / supporting routes | 380px sign-in form and reference editorial split, visible email fields, password-toggle keyboard access, branded legal and missing/error pages. Legal copy and auth actions retained. |

## Verification performed

- Production build passed, including the final focus-style fix (`/tmp/nb-design-build-verified.log`, exit 0).
- TypeScript passed after the current component changes.
- ESLint passed for changed tracked TypeScript sources/tests plus the new sidebar, project status helper and color tests.
- Full unit suite: **1,905 tests, 1,881 passes, 24 failures**. Comparing failed test names with the pre-change baseline found no new failing case. See [existing failures](verification-failures.md); this is not a clean release gate.
- Scroll, theme and appearance contracts passed. The global-search contract retains a pre-existing `tasks_project_idx` schema expectation failure; no schema migration was made.
- Color tests cover all six action foreground pairs in both themes plus small semantic metadata and success/warning/danger/info pairs at ≥4.5:1. The final focused color/theme/reduced-motion run passed all 19 tests.
- Browser: dark sign-in checked at 1280×900 and 390×844; no horizontal overflow. Dark mobile privacy page checked at 390px; typography and wrapping verified. Local fonts loaded.
- Browser: password-toggle keyboard focus verified after removing a legacy `outline: none !important` authentication override; rendered outline is solid 2px.
- Browser viewport overrides were restored. The user's sign-in form was not submitted or filled.
- `git diff --check` reports only existing trailing whitespace in `docs/audits/heroui-v3-design-system-audit.md`; unrelated content was preserved.

## Required next acceptance pass

The preview remains signed out. An authorized test-account session is needed to inspect actual Discover, project, profile, Network, messages and settings data and role-specific controls. Credentials must stay out of chat.

Pending checks include light/default reference comparison, tablet/wide/200% zoom, saved themes/densities, keyboard/portal interactions, all owner/member/viewer states, private identities, long/large content, empty/error/offline states, drafts, message outbox, file leases/conflicts and recovery. Existing failing behavioral tests need owning-feature review before release.

The browser URL policy blocked opening the local HTML report for the atlas review. No alternate access route was attempted. Its eight added reference sections and detailed visual compositions remain unverified visually in this pass.

See [implementation coverage](implementation-coverage.md) for all 30 original routes and all 301 current component sources. Direct edits and inherited styling are identified separately from runtime acceptance. The report contains a current-status banner; its original analysis remains intact as the reference record.
