# Contextual right rail headings

Scope: the project detail Dashboard rail and the profile rail, using Discover's
“People you should meet” presentation as the reference.

- Shared `RailSectionHeading` renders the 11px medium mono label, flexible
  hairline, 12px content gap, and optional trailing actions. `RailSection`
  associates that external heading with its bordered content panel.
- Project: Journey, Recent activity and Open roles. Profile: Role preferences,
  Links and Profile completeness. Internal header rows/icons are removed.
- Journey navigation and profile editing remain in the external heading row.
  The mobile Journey stage summary remains inside the content panel.
- Rail sections use 24px spacing. Loading placeholders use the same external
  headings. Main content card headers and other project tabs keep their existing
  presentation.
- Existing privacy/owner checks, role/application/invitation actions, activity
  loading/retry states, social redirects, progress and empty states are retained.
  No data sources, commands, authorization or cache policy changed.

Validation:

- 41 related unit checks passed.
- All 12 browser checks passed across Chromium and WebKit.
- TypeScript and scoped ESLint passed.
- Browser fixtures exercise production rail components, the real application
  stylesheet and local fonts, with isolated data/action substitutes. Coverage:
  reference typography; external heading/divider placement; edit, Journey and
  role actions; visitor/empty/pending states; activity loading/retry; 320px touch
  layouts in both themes. Chromium and WebKit are exercised.
- WebKit's headless visibility check after role expansion needs a painted frame;
  the mobile check captures that frame before checking the expanded role's
  geometry. No production workaround was added for this test behavior.

These isolated checks do not replace authenticated live-account acceptance.
