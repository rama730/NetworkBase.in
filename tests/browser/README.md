# Text-selection browser checks

Desktop IDE: `npx playwright test -c tests/browser/playwright.config.ts desktop-ide.spec.ts --project chromium --project webkit` renders the production control and My Work header with isolated auth/session data. It covers nested drawers, editor search and keyboard focus, connected preferences, protocol fallback, project selection and paging, dark mode, mobile sheets and touch sizing. OS editor launches are intercepted.

Run from the repository root:

```sh
npx playwright test --config tests/browser/playwright.config.ts
```

The suite renders the production Input, Button, Tiptap editor, and Files
TextViewer against the compiled application stylesheet. File reads and saves
are replaced with isolated data; it needs no app server, credentials, or
database. Chromium, Firefox, and WebKit are configured. Install their test
binaries with `npx playwright install chromium firefox webkit` if needed.

Coverage includes both themes, all six accents, densities, native text and
control selection, touch-enabled controls, copy and replacement, and Files
Raw/View/Edit modes with multiple and rectangular selections. Screenshots
are written under `test-results/text-selection`. Touch checks emulate coarse
pointers and touch input; native mobile long-press handles require a device.

To run the two engines verified on this development host:

```sh
npx playwright test --config tests/browser/playwright.config.ts --project chromium --project webkit
```

Firefox could not launch on this host: it reports a macOS sandbox-extension
error and times out before a page opens. Its suite remains enabled for runs
on a host where the browser starts successfully.

## Messaging metadata and URL checks

The messaging suite executes production route metadata generators, the URL/history
hook, title prefixes, upload requests and media recovery with isolated framework
and backend substitutes. It requires no credentials or production database:

```sh
npx playwright test --config tests/browser/playwright.config.ts messaging.spec.ts --project chromium --project webkit
```

These fixtures complement the real disposable-Postgres tests in
`tests/db/messaging-metadata.test.ts`; they do not replace authenticated
Next/Supabase end-to-end acceptance.


Profile collaboration: `npx playwright test -c tests/browser/playwright.config.ts profile.spec.ts --project=chromium --project=webkit`.
These scenarios render the production profile, editor and connections modal with substituted backend calls. They cover saved availability, draft/discard, correct tab navigation, custom roles, paging/search, mobile layout, save failures, concurrent-edit review and visitor privacy. They do not use account credentials or a database.

Contextual rails: `npx playwright test -c tests/browser/playwright.config.ts rails.spec.ts --project=chromium --project=webkit`.
These checks render the production profile and project Dashboard rail components
against the application stylesheet and fonts, with isolated action/query data.
They cover Discover heading parity, desktop/mobile placement, owner/visitor and
empty states, role actions, Journey controls and activity loading/retry.
