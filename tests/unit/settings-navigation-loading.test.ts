import assert from "node:assert/strict";
import test from "node:test";

import { SETTINGS_SECTIONS, resolveSettingsTarget, sectionFromElementId, settingsSectionHref, settingsSectionId } from "@/lib/settings/navigation";

// The shell's observers and scrolling need a browser (tests/browser/settings.spec.ts); what the address means is plain logic.

test("with nothing in the address Settings starts at Account", () => {
  assert.deepEqual(resolveSettingsTarget({}), { elementId: "settings-account", section: "account" });
  assert.deepEqual(resolveSettingsTarget({ hash: "", tab: null }), { elementId: "settings-account", section: "account" });
});

test("the older ?tab= form still lands on its section, and an unknown tab falls back to Account", () => {
  assert.equal(resolveSettingsTarget({ tab: "integrations" }).section, "integrations");
  assert.equal(resolveSettingsTarget({ tab: "privacy-policies" }).elementId, "settings-privacy-policies");
  assert.equal(resolveSettingsTarget({ tab: "nonsense" }).section, "account");
});

test("a #hash wins over ?tab=, and a hash inside a section selects that section", () => {
  assert.deepEqual(resolveSettingsTarget({ hash: "#settings-notifications", tab: "security" }), { elementId: "settings-notifications", section: "notifications" });
  assert.deepEqual(resolveSettingsTarget({ hash: "#settings-security-sessions" }), { elementId: "settings-security-sessions", section: "security" });
  assert.equal(resolveSettingsTarget({ hash: "#not-a-settings-anchor", tab: "appearance" }).section, "appearance");
});

test("a longer section name is never read as a shorter one (privacy-policies is not privacy)", () => {
  assert.equal(sectionFromElementId("settings-privacy-policies"), "privacy-policies");
  assert.equal(sectionFromElementId("settings-privacy-policies-export"), "privacy-policies");
  assert.equal(sectionFromElementId("settings-privacy-blocked"), "privacy");
  assert.equal(sectionFromElementId("settings-delete-account"), "delete-account");
  assert.equal(sectionFromElementId("settings-"), null);
  assert.equal(sectionFromElementId(undefined), null);
});

test("every section has an address that resolves back to itself", () => {
  for (const section of SETTINGS_SECTIONS) {
    assert.equal(settingsSectionHref(section), `/settings#${settingsSectionId(section)}`);
    assert.equal(resolveSettingsTarget({ hash: new URL(settingsSectionHref(section), "https://x.test").hash }).section, section);
  }
});
