# Text-selection browser checks

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
