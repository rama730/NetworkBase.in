import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { getPersonAvatarTone, PERSON_AVATAR_TONES } from "../../src/lib/ui/avatar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("person avatar tones are stable for an identity and vary across people", () => {
  assert.equal(getPersonAvatarTone("person-123"), getPersonAvatarTone(" PERSON-123 "));
  const tones = ["Ada Okonjo", "Ravi Menon", "Sofia Lind", "Tom Ek", "E2E Files QA", "Codex E2E User"]
    .map(getPersonAvatarTone);
  assert.ok(new Set(tones).size >= 3, "the palette should not collapse to a single tone");
  for (const tone of tones) assert.ok(PERSON_AVATAR_TONES.includes(tone));
});

test("person tones use readable semantic color pairs in light and dark mode", () => {
  const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const palette = readFileSync(path.join(root, "src/lib/ui/avatar.ts"), "utf8");
  const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
  const dark = css.slice(css.indexOf(".dark {"));
  const luminance = (hex: string) => {
    const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => parseInt(channel, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const statusForTone = { amber: "warning", blue: "info", mint: "success", rose: "danger" } as const;
  for (const tone of PERSON_AVATAR_TONES) {
    const status = statusForTone[tone];
    assert.match(palette, new RegExp(`${tone}: \\{ backgroundColor: 'var\\(--status-${status}-soft\\)'`));
    for (const theme of [light, dark]) {
      const background = theme.match(new RegExp(`--status-${status}-soft:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
      const foreground = theme.match(new RegExp(`--status-${status}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
      assert.ok(background && foreground, `${tone} needs both color tokens`);
      const values = [luminance(background.slice(1)), luminance(foreground.slice(1))].sort((a, b) => b - a);
      assert.ok((values[0]! + 0.05) / (values[1]! + 0.05) >= 4.5, `${tone} initials need readable contrast`);
    }
  }
});

test("all person avatars use identity tones without replacing uploaded photos", () => {
  const avatar = readFileSync(path.join(root, "src/components/ui/UserAvatar.tsx"), "utf8");
  const radixAvatar = readFileSync(path.join(root, "src/components/ui/avatar.tsx"), "utf8");
  assert.match(avatar, /const fallbackTone = getPersonAvatarTone\(presentation\.id/);
  assert.match(avatar, /!shouldRenderImage\s*\?\s*\(/);
  assert.match(avatar, /data-avatar-tone=\{fallbackTone\}/);
  assert.match(radixAvatar, /data-avatar-tone=\{tone\}/);

  for (const component of [
    "src/components/workspaces/WorkspaceCard.tsx",
    "src/components/network/PersonCard.tsx",
    "src/components/network/ConnectionsClient.tsx",
    "src/components/network/InvitationsClient.tsx",
    "src/components/network/RequestProfileRow.tsx",
    "src/components/network/IncomingWorkspaceApplicationRow.tsx",
    "src/components/messages/MessageRow.tsx",
    "src/components/messages/NewMessage.tsx",
    "src/components/messages/cards/MessageCard.tsx",
    "src/components/messages/parts/MentionDropdown.tsx",
    "src/components/workspaces/dashboard/InviteCollaboratorModal.tsx",
    "src/components/notifications/NotificationAvatar.tsx",
  ]) {
    const source = readFileSync(path.join(root, component), "utf8");
    if (/import \{ PersonCardContent \} from "\.\/PersonCardContent"/.test(source)) {
      assert.match(source, /<PersonCardContent\b/, `${component} should render the shared person card`);
      assert.match(readFileSync(path.join(root, "src/components/network/PersonCardContent.tsx"), "utf8"), /<UserAvatar\b/);
    } else assert.match(source, /<UserAvatar\b/, `${component} should use the shared person avatar`);
  }
});
