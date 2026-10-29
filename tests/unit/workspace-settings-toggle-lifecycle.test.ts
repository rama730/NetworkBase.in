import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Project Settings Access tab implements immediate in-memory and background auto-save toggles without card-level buttons", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");

    // 1. Toggles must update in-memory state and trigger background persistence immediately
    assert.match(
        settingsTab,
        /const handleTogglePublicTab = useCallback\(async \([\s\S]*?setPublicTabVisibility\(next\)[\s\S]*?updateWorkspacePublicTabVisibilityAction/,
        "handleTogglePublicTab must update publicTabVisibility immediately and call updateWorkspacePublicTabVisibilityAction",
    );

    // 2. Saved state is tracked separately from active edit state to enable rollback on failure
    assert.match(
        settingsTab,
        /const \[savedPublicTabVisibility, setSavedPublicTabVisibility\] = useState/,
        "Must maintain savedPublicTabVisibility to track persistent baseline state",
    );

    // 3. Card footer with Cancel and Save changes is removed from access section
    const accessBlock = settingsTab.split('id="project-settings-access"')[1]?.split('id="project-settings-collaborators"')[0] ?? "";
    assert.doesNotMatch(
        accessBlock,
        /Save changes/,
        "Access card must not contain Save changes button in footer",
    );
    assert.doesNotMatch(
        accessBlock,
        /Cancel/,
        "Access card must not contain Cancel button in footer",
    );

    // 4. Clicking visibility options directly invokes handleSelectVisibility
    assert.match(
        accessBlock,
        /onClick=\{\(\) => void handleSelectVisibility\(option\.id\)\}/,
        "Visibility cards must immediately trigger handleSelectVisibility on click",
    );

    // 5. Public tab editor receives saving indicator
    assert.match(
        accessBlock,
        /savingTabId=\{savingPublicTabId\}/,
        "PublicTabVisibilityEditor must receive savingTabId for immediate feedback",
    );
});
