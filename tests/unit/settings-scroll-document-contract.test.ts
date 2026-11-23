import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("personal settings render as one navigable scroll document", () => {
  const route = read("src/app/(site)/(main)/settings/page.tsx");
  const document = read("src/components/settings/SettingsDocument.tsx");
  const layout = read("src/components/settings/SettingsLayout.tsx");
  const globals = read("src/app/globals.css");

  assert.doesNotMatch(route, /tab === "integrations"/, "Integrations should stay on the shared settings surface");
  assert.match(route, /return <SettingsDocument \/>/, "All personal settings should share one document");

  for (const section of ["account", "security", "privacy", "notifications", "appearance", "integrations", "privacy-policies", "delete-account"]) {
    // Each section's id is `settings-<section>` (DocumentSection builds it from `section`).
    assert.match(document, /const id = `settings-\$\{section\}`/);
    assert.match(document, new RegExp(`section="${section}"`), `${section} should have a stable scroll target`);
  }

  assert.ok(document.indexOf('section="privacy-policies"') > document.indexOf('section="integrations"'), "Privacy should follow Integrations");
  assert.ok(document.indexOf('section="delete-account"') > document.indexOf('section="privacy-policies"'), "Delete account should be the final settings action");

  assert.match(layout, /root\.scrollTo\(\{ top, behavior: smooth && !reducedMotion\(\) \? "smooth" : "auto" \}\)/, "a jump scrolls the settings pane itself");
  assert.doesNotMatch(layout, /scrollIntoView\(/, "scrollIntoView would also scroll the application shell around the pane");
  assert.match(layout, /className="relative [^"]*app-scroll/, "the pane contains its absolutely positioned screen-reader text, so the document cannot scroll");
  assert.match(layout, /window\.history\.replaceState\(window\.history\.state, "", item\.href\)/, "the address follows the section that was chosen");
  assert.match(layout, /alignRef/, "a jump keeps itself aligned while content loads, until the person scrolls");
  assert.match(layout, /IntersectionObserver/, "the highlight follows the page without reading layout on every scroll");
  assert.doesNotMatch(document, /contentVisibility|containIntrinsicSize/, "Section targets should retain real layout geometry for native scrolling");
  assert.doesNotMatch(document, /scrollIntoView|useSearchParams/, "The settings document should not compete with the layout scroll controller");
  assert.match(layout, /data-scroll-root="route"/);
  assert.match(layout, /md:w-\[var\(--nb-sidebar-width\)\]/, "Section navigation should use the same width as the main sidebar");
  // Settings mix (2026-11-23): the nav is hairline cells with mono counters and the sliding marker; Delete sits apart.
  assert.match(layout, /className=\{cn\("nbs-nl"/, "nav links are the mix cells");
  assert.match(layout, /nbs-marker/, "one marker slides to the section you're in");
  assert.match(layout, /nbs-navfoot/, "Delete account sits apart at the bottom");
  assert.match(layout, /<SettingsFind onJump=\{findJump\} \/>/, "Find a setting lives in the nav head");
  assert.match(layout, /<h1 id="settings-navigation-title" className="nbs-eyebrow max-md:sr-only">Settings<\/h1>/);
  assert.doesNotMatch(document, /title="Settings"/, "The page title belongs in the navigation column");
  assert.match(layout, /<div ref=\{scrollRootRef\} data-scroll-root="route"[^\n]*className="relative min-w-0 min-h-0 flex-1 app-scroll app-scroll-y/);
  assert.doesNotMatch(layout, /position: fixed|nb-settings-local-nav-panel|<details/, "Navigation should participate in the full-height page layout");
  assert.doesNotMatch(globals, /\.nb-settings-local-nav-panel/, "Remove the replaced floating navigation styling");
  assert.match(layout, /event\.metaKey \|\| event\.ctrlKey/, "Native modified-link navigation should remain available");
  assert.match(layout, /isReducedMotionEnabled/, "the in-app Reduce motion setting also stops smooth scrolling");
  assert.doesNotMatch(layout, /space-y-6 pb-10/, "The settings document should not leave an artificial gap after its final section");
  assert.match(layout, /SETTINGS_SECTION_META\["privacy-policies"\]/, "Privacy should be a first-class navigation item");
});

test("settings primitives keep the application typography and spacing grammar", () => {
  const card = read("src/components/settings/ui/SettingsSectionCard.tsx");
  const row = read("src/components/settings/ui/SettingsRow.tsx");
  const navigation = read("src/components/settings/SettingsLayout.tsx");

  assert.match(card, /rounded-lg border border-border bg-card/);
  assert.match(card, /border-b border-border p-6/);
  assert.match(row, /min-h-16/);
  assert.match(row, /nb-ui-label/);
  assert.match(row, /nb-compact/);
  assert.doesNotMatch(navigation, /bg-red-|text-red-|bg-zinc-900 text-white/);
});

test("personal settings keep only the necessary grouped surfaces", () => {
  const security = read("src/components/settings/SecuritySettings.tsx");
  const privacy = read("src/components/settings/PrivacySettings.tsx");
  const notifications = read("src/components/settings/NotificationsSettings.tsx");
  const appearance = read("src/components/settings/AppearanceSettings.tsx");
  const integrations = read("src/components/settings/IntegrationsSettings.tsx");

  assert.doesNotMatch(security, /SecurityOverviewSection|Security Overview/);
  assert.match(security, /title="Two-step verification"/);
  assert.match(security, /title="Signed-in devices"/);
  assert.doesNotMatch(privacy, /Privacy Overview|OverviewChip/);
  assert.match(privacy, /title="Who can see and reach you"/);
  assert.match(privacy, /title="Blocked people"/);
  assert.match(privacy, /\.slice\(0, 4\)/, "Privacy history should be limited to four recent changes");
  assert.doesNotMatch(privacy, /LegalAndDataRightsSection/, "Legal controls should live at the end of the settings document");
  assert.match(notifications, /SettingsSwitch/);
  assert.match(notifications, /title="Notification preferences"/);
  assert.match(notifications, /Turn all off/);
  assert.match(notifications, /<SettingsSwitch showLabel/, "switches show their On/Off text through the shared switch");
  assert.match(appearance, /title="Theme and color"/);
  assert.match(appearance, /title="Layout and motion"/);
  assert.doesNotMatch(privacy, /<Check\b/, "Privacy choices should not render a tick indicator");
  assert.doesNotMatch(appearance, /ml-auto size-2 rounded-full|<Check\b/, "Appearance choices should not render a dot or tick indicator");
  assert.doesNotMatch(integrations, /embedded/, "settings sections only exist inside the one document");
  assert.match(integrations, /title="CLI, agents and editors"/);
  assert.doesNotMatch(integrations, /(?:bg|text|border)-(?:zinc|amber|emerald|blue|red)-/, "Integrations should use semantic design tokens");
});

test("sign out is located in account settings after cache management and removed from settings nav", () => {
  const account = read("src/components/settings/AccountSettings.tsx");
  const layout = read("src/components/settings/SettingsLayout.tsx");

  assert.doesNotMatch(layout, />Sign out</, "Settings navigation must not render a Sign Out button");
  assert.doesNotMatch(layout, /\bonSignOut\b/, "Settings layout navigation should not accept onSignOut");

  // Settings mix: one "This device" group, Storage then Sign out.
  assert.match(account, /title="This device"/, "Account settings must include This device");
  const cacheIndex = account.indexOf('title="Storage"');
  const signoutIndex = account.indexOf('title="Sign out"');
  assert.ok(account.indexOf('title="This device"') < cacheIndex && cacheIndex > 0 && signoutIndex > cacheIndex, "Sign out must be placed directly after Storage in This device");

  assert.match(account, /SignOutConfirmDialog/, "Account settings should use the shared sign-out confirmation");
  assert.match(account, /onConfirm=\{signOut\}/, "Account settings should call signOut when confirmed");
});
