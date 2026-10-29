import fs from "node:fs";
import path from "node:path";

const SPLIT_COMPONENTS: Record<string, string[]> = {
  "src/components/workspaces/tabs/WorkspaceSettingsTab.tsx": [
    "src/components/workspaces/settings/GeneralSettingsSection.tsx",
    "src/components/workspaces/settings/WorkspaceSettingsNavigation.tsx",
    "src/hooks/useWorkspaceSettingsNavigation.ts",
    "src/components/workspaces/settings/CollaboratorSearchField.tsx",
    "src/components/workspaces/settings/SettingsFormFields.tsx",
    "src/components/workspaces/settings/SettingsPolicyDetails.tsx",
    "src/components/workspaces/settings/WorkspaceNotificationSettings.tsx",
    "src/components/workspaces/settings/MemberNotificationSettingsEditor.tsx",
    "src/components/workspaces/settings/FileAccessMembers.tsx",
    "src/components/workspaces/settings/CollaboratorCard.tsx",
    "src/components/workspaces/settings/LifecycleSettingsEditor.tsx",
    "src/components/workspaces/settings/PublicTabVisibilityEditor.tsx",
  ],
  "src/components/workspaces/tabs/UpdatesTab.tsx": [
    "src/components/workspaces/updates/update-helpers.tsx",
    "src/components/workspaces/updates/UpdateContent.tsx",
    "src/components/workspaces/updates/UpdateComments.tsx",
    "src/components/workspaces/updates/UpdateCard.tsx",
    "src/components/workspaces/updates/UpdatesRightRail.tsx",
    "src/components/workspaces/updates/UpdateDetailPanel.tsx",
  ],
};

export function componentSource(file: string) {
  return [file, ...(SPLIT_COMPONENTS[file] ?? [])]
    .map((part) => fs.readFileSync(path.join(process.cwd(), part), "utf8"))
    .join("\n");
}
