import fs from "node:fs";
import path from "node:path";

const SPLIT_COMPONENTS: Record<string, string[]> = {
  "src/components/projects/tabs/ProjectSettingsTab.tsx": [
    "src/components/projects/settings/GeneralSettingsSection.tsx",
    "src/components/projects/settings/ProjectSettingsNavigation.tsx",
    "src/hooks/useProjectSettingsNavigation.ts",
    "src/components/projects/settings/CollaboratorSearchField.tsx",
    "src/components/projects/settings/SettingsFormFields.tsx",
    "src/components/projects/settings/SettingsPolicyDetails.tsx",
    "src/components/projects/settings/ProjectNotificationSettings.tsx",
    "src/components/projects/settings/MemberNotificationSettingsEditor.tsx",
    "src/components/projects/settings/FileAccessMembers.tsx",
    "src/components/projects/settings/CollaboratorCard.tsx",
    "src/components/projects/settings/LifecycleSettingsEditor.tsx",
    "src/components/projects/settings/PublicTabVisibilityEditor.tsx",
  ],
  "src/components/projects/tabs/UpdatesTab.tsx": [
    "src/components/projects/updates/update-helpers.tsx",
    "src/components/projects/updates/UpdateContent.tsx",
    "src/components/projects/updates/UpdateComments.tsx",
    "src/components/projects/updates/UpdateCard.tsx",
    "src/components/projects/updates/UpdatesRightRail.tsx",
    "src/components/projects/updates/UpdateDetailPanel.tsx",
  ],
};

export function componentSource(file: string) {
  return [file, ...(SPLIT_COMPONENTS[file] ?? [])]
    .map((part) => fs.readFileSync(path.join(process.cwd(), part), "utf8"))
    .join("\n");
}
