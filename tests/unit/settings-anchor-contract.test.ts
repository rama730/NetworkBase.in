import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";

import { SETTINGS_SECTIONS, settingsSectionId } from "../../src/lib/settings/navigation";

const sh = (cmd: string) => execSync(cmd, { cwd: process.cwd(), encoding: "utf8" });

test("every /settings#settings-… link in the app points at an id that exists", () => {
  const linked = new Set(sh(`grep -rhoE "settings#settings-[a-z-]+" src || true`).split("\n").filter(Boolean).map((l) => l.replace("settings#", "")));
  const defined = new Set(sh(`grep -rhoE "id=\\"settings-[a-z-]+\\"" src/components/settings || true`).split("\n").filter(Boolean).map((l) => l.slice(4, -1)));
  for (const section of SETTINGS_SECTIONS) defined.add(settingsSectionId(section));
  assert.ok(linked.size > 10, "found the deep links");
  const missing = [...linked].filter((id) => !defined.has(id));
  assert.deepEqual(missing, []);
});
