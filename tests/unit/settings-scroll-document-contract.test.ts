import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("personal settings render as one navigable scroll document", () => {
  const route = read("src/app/(main)/settings/page.tsx");
  const document = read("src/components/settings/SettingsDocument.tsx");
  const layout = read("src/components/settings/SettingsLayout.tsx");
  const globals = read("src/app/globals.css");

  assert.doesNotMatch(route, /tab === "integrations"/, "Integrations should stay on the shared settings surface");
  assert.match(route, /return <SettingsDocument \/>/, "All personal settings should share one document");

  for (const section of ["account", "security", "privacy", "notifications", "appearance", "integrations", "privacy-policies", "delete-account"]) {
    assert.match(document, new RegExp(`id="settings-${section}"`), `${section} should have a stable scroll target`);
  }

  assert.ok(document.indexOf('id="settings-privacy-policies"') > document.indexOf('id="settings-integrations"'), "Privacy and Policies should follow Integrations");
  assert.ok(document.indexOf('id="settings-delete-account"') > document.indexOf('id="settings-privacy-policies"'), "Delete account should be the final settings action");

  assert.match(layout, /scrollIntoView\(\{ behavior, block: "start" \}\)/);
  assert.match(layout, /router\.replace\(item\.href, \{ scroll: false \}\)/);
  assert.match(layout, /locallyNavigatedTabRef/, "URL synchronization should not issue a competing scroll after a local tab click");
  assert.doesNotMatch(document, /scrollIntoView|useSearchParams/, "The settings document should not compete with the layout scroll controller");
  assert.match(layout, /data-scroll-root="route"/);
  assert.match(layout, /w-\[248px\]/, "Desktop section navigation should keep the specified width");
  assert.match(layout, /data-scroll-root="route" className="h-full min-h-0 w-full app-scroll app-scroll-y app-scroll-gutter"/, "Settings should have one route-level vertical scroller");
  assert.match(layout, /max-w-\[1320px\][^\n]*gap-6 px-4 py-6 sm:px-6/, "The settings shell should keep a 24px route gutter below the global header");
  assert.match(layout, /nb-settings-local-nav hidden w-\[248px\] self-start lg:block/, "Desktop section navigation should use its natural height");
  assert.doesNotMatch(layout, /<aside[^>]*app-scroll(?:-y)?/, "The section navigation must not create a nested scrollbar");
  assert.match(layout, /nb-settings-local-nav-panel app-scroll app-scroll-y app-scroll-hidden/, "Short viewports should keep every full-size tab accessible without exposing a scrollbar");
  assert.match(globals, /@media \(min-width:1024px\)[\s\S]*\.nb-settings-local-nav-panel[\s\S]*position: fixed;[\s\S]*top: calc\(var\(--ui-topnav-height\) \+ 24px\);[\s\S]*max-height: calc\(100dvh - var\(--ui-topnav-height\) - 48px\);/, "The full-size navigation should remain fixed below the global header at every desktop viewport height");
  assert.doesNotMatch(globals, /@media \(min-width:1024px\) and \(min-height:/, "Fixed settings navigation must not be disabled on shorter desktop viewports");
  assert.doesNotMatch(layout, /space-y-6 pb-10/, "The settings document should not leave an artificial gap after its final section");
  assert.match(layout, /SETTINGS_SECTION_META\["privacy-policies"\]/, "Privacy and Policies should be a first-class navigation item");
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
  assert.match(security, /title="Sign-in protection"/);
  assert.match(security, /title="Sessions and sign-ins"/);
  assert.doesNotMatch(privacy, /Privacy Overview|OverviewChip/);
  assert.match(privacy, /title="Privacy controls"/);
  assert.match(privacy, /title="Blocked accounts and activity"/);
  assert.match(privacy, /\.slice\(0, 4\)/, "Privacy history should be limited to four recent changes");
  assert.doesNotMatch(privacy, /LegalAndDataRightsSection/, "Legal controls should live at the end of the settings document");
  assert.match(notifications, /SettingsSwitch/);
  assert.match(notifications, /title="Notification preferences"/);
  assert.match(notifications, /Turn all off/);
  assert.match(notifications, /checked \? "On" : "Off"/);
  assert.match(appearance, /title="Theme and color"/);
  assert.match(appearance, /title="Layout and motion"/);
  assert.doesNotMatch(privacy, /<Check\b/, "Privacy choices should not render a tick indicator");
  assert.doesNotMatch(appearance, /ml-auto size-2 rounded-full|<Check\b/, "Appearance choices should not render a dot or tick indicator");
  assert.match(integrations, /embedded = false/);
  assert.match(integrations, /title="Editor connections"/);
  assert.doesNotMatch(integrations, /(?:bg|text|border)-(?:zinc|amber|emerald|blue|red)-/, "Integrations should use semantic design tokens");
});

test("sign out is located in account settings after cache management and removed from settings nav", () => {
  const account = read("src/components/settings/AccountSettings.tsx");
  const layout = read("src/components/settings/SettingsLayout.tsx");

  assert.doesNotMatch(layout, />Sign out</, "Settings navigation must not render a Sign Out button");
  assert.doesNotMatch(layout, /\bonSignOut\b/, "Settings layout navigation should not accept onSignOut");

  assert.match(account, /title="Cache management"/, "Account settings must include Cache management");
  assert.match(account, /title="Sign out"/, "Account settings must include Sign out section");

  const cacheIndex = account.indexOf('title="Cache management"');
  const signoutIndex = account.indexOf('title="Sign out"');
  assert.ok(cacheIndex > 0 && signoutIndex > cacheIndex, "Sign out must be placed directly after Cache management in Account settings");

  assert.match(account, /ConfirmDialog/, "Account settings should trigger a ConfirmDialog for signing out");
  assert.match(account, /signOut\(\)/, "Account settings should call signOut when confirmed");
});
