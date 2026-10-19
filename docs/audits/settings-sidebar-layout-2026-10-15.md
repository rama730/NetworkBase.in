# Settings sidebar layout — 15 October 2026

Settings now follows the approved Edit profile navigation layout: a full-height secondary navigation column, the shared main-sidebar width and compact navigation links, a mono Settings title and divider, and an independently scrolling right column. The floating rounded navigation card, descriptive navigation rows and duplicate page heading were removed. Section headings use the shared 20px typography role. The route loading state no longer reserves a duplicate page header.

The existing continuous settings document remains mounted. No account, security, privacy, notification, appearance, integration, legal/data-rights or deletion command was changed. Sign-out and deletion confirmations remain in their existing sections. Section URLs, reload, Back and nested legal/deletion anchors are retained; local draft fields survive navigation.

The right column has one route scroll marker. At narrow widths, section links wrap; on short screens their navigation area can scroll without taking the whole content view. Coarse pointers retain 44px link targets. The main sidebar remains provided by the application's existing shell.

Navigation verification found that returning through the URL to Account could leave the document at another section. The controller now handles Account like the other sections. A Safari touch case also exposed unreliable navigation positions from content-visibility placeholder heights. The bounded settings sections now retain their real layout geometry; they were already mounted, and their data/commands remain unchanged. Native section scrolling no longer needs timed alignment retries. The initial URL-alignment frame is canceled by later navigation or wheel/touch/keyboard input and cleaned up on unmount. No polling or new dependency was introduced. Reduced-motion users receive immediate scrolling, and modifier-clicks retain native link behavior.

Verification: eight Chromium/WebKit browser checks, four settings contract/unit checks, TypeScript and scoped ESLint passed. The browser tests render the actual SettingsLayout, SettingsDocument, heading primitive, global CSS and bundled fonts; individual settings action panels are isolated stubs so the checks do not execute personal account or security mutations. They cover sidebar geometry, heading/link styles, document-only scrolling, URL/reload/Back behavior, mounted-field retention, scroll highlighting, nested deletion anchors and 320px/768px touch layouts including short viewports.

Commands:

```sh
npx playwright test --config tests/browser/playwright.config.ts settings.spec.ts --project=chromium --project=webkit
npx tsx --test tests/unit/settings-scroll-document-contract.test.ts
npx tsc --noEmit
npm run check:impact-review
```
