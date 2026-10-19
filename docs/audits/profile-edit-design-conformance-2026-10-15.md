# Edit profile design conformance — 15 October 2026

Audited all five editor sections against the application design specification, shared CSS tokens/primitives and the approved page layout. The supplied screenshot shows a scrolled form; the clipped fields at its top do not require another fixed header.

## Findings and corrections

| Area | Finding | Correction |
| --- | --- | --- |
| Typography | The main 20px/17px hierarchy was correct. Navigation and section labels mixed title case with sentence case; a contribution card title inherited body sizing. Skills descriptions used mono metadata, while skill categories included an off-scale 10px label. | Sentence-case interface labels; 17px contribution titles; 13px compact skills descriptions and control labels; 12px mono category metadata; 11px mono micro headings. User-entered names, role titles and skills retain their spelling. |
| Spacing | A fixed 32px panel inset ignored density; general form sections combined nested spacing and extra vertical padding. | Mobile gutter 16px; panel insets 20/24/28px for compact/default/comfortable. Shared field gaps, 32px major general-section transitions, aligned footer/content insets, and the specified 72px square photo preview. |
| Shapes and selection | Role/category controls and counts used pills; selected roles used a clay wash. | Squared 3px tags/filters and ink-filled selected filters. Sidebar selection continues to use the shared navigation surface, text and accent icon. Switches retain the existing shared switch shape. |
| Controls | Some inputs and selects hard-coded 40px, and contribution visibility had a separate switch implementation. | Existing density-aware input/control heights and shared SettingsSwitch. Touch removal/actions use the shared 44px target policy. |
| Themes and feedback | Local amber/green classes duplicated status palettes. | Existing semantic success/warning colors and soft warning surface. Persistent errors and discard/conflict recovery remain. Keyboard focus uses visible tint/brightness or existing field feedback, consistent with the application's current line-free focus policy. |
| Responsive form | Viewport breakpoints could create two columns inside a narrow form beside the sidebar. Long URL hints and social actions could compete for width. | Form-container breakpoints, wrapping URL hints/social actions, full mobile section labels and stacked contribution controls. |
| Field meaning | The URL hint hard-coded networkbase.org; counts and some select labels lacked explicit associations. | Reused sharing-origin/profile-path helpers; associated hints/counts and select labels. The action to add a desired role now says “Add role”. |
| Reference consistency | The profile section of the specification still prescribed the replaced dialog. | Updated that entry to the approved dedicated page, sidebar heading/divider, shared navigation width and slim right-column action row. |

## Retained layout and behavior

“Edit profile” remains a mono micro heading above the navigation divider. The column uses the main sidebar width and density. The form scrolls independently; the slim Save/Cancel row belongs only to its right column. The floating chat launcher does not cover this editor's actions. No Messages layout or conversation behavior changed.

Existing save validation, version/conflict handling, contribution permissions, shared draft, section URLs, account checks and unsaved navigation protection remain in place.

## Verification

- 48 Chromium/WebKit browser checks passed using the production profile/editor components, actual global CSS, bundled Instrument Sans/JetBrains Mono fonts and real skills picker, with isolated auth/action/catalog data.
- Added computed typography, light/dark selection, compact/default/comfortable density and populated touch-layout checks at 320/768/1024px. Existing 1440px geometry and save/error/discard/navigation coverage remains.
- 34 focused profile/skills unit checks passed. TypeScript, scoped ESLint, theme and profile-contribution checks passed.
- Browser evidence validates rendered components with isolated service boundaries; it does not claim a production-server or production-traffic audit.

Commands:

```sh
npx playwright test --config tests/browser/playwright.config.ts profile.spec.ts --project=chromium --project=webkit
npx tsx --test tests/unit/profile-edit-route.test.ts tests/unit/profile-role-layout-contract.test.ts tests/unit/profile-collaboration.test.ts tests/unit/profile-contribution-visibility-contract.test.ts tests/unit/skills-ecosystem-contract.test.ts
npx tsc --noEmit
npm run check:theme-contract
npm run check:profile-contributions
npm run check:impact-review
```
