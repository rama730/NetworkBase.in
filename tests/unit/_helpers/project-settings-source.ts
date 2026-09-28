import fs from "node:fs";
import path from "node:path";

const FILES = [
  "src/components/projects/tabs/ProjectSettingsTab.tsx",
  "src/components/projects/settings/SettingsFormFields.tsx",
  "src/components/projects/settings/SettingsPolicyDetails.tsx",
  "src/components/projects/settings/ProjectNotificationSettings.tsx",
  "src/components/projects/settings/MemberNotificationSettingsEditor.tsx",
  "src/components/projects/settings/FileWorkspaceMembers.tsx",
  "src/components/projects/settings/CollaboratorCard.tsx",
  "src/components/projects/settings/LifecycleSettingsEditor.tsx",
  "src/components/projects/settings/PublicTabVisibilityEditor.tsx",
];

export function projectSettingsSource() {
  return FILES.map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
}
