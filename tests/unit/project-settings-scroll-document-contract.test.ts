import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project settings tab renders a continuous single-scroll document with all 12 sections mounted simultaneously", () => {
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // 1. Must have data-project-settings-document attribute on main container
    assert.match(
        settingsTab,
        /<main[^>]*data-project-settings-document/,
        "ProjectSettingsTab must render <main data-project-settings-document> continuous scroll container",
    );

    // 2. All 12 canonical section IDs must be present as continuous section containers
    const canonicalSections = [
        "general",
        "links",
        "access",
        "collaborators",
        "roles-applications",
        "readme",
        "updates",
        "tasks-workflow",
        "files-workspace",
        "notifications",
        "privacy-policies",
        "danger",
    ];

    for (const sectionId of canonicalSections) {
        assert.match(
            settingsTab,
            new RegExp(`id="project-settings-${sectionId}"`),
            `Section #project-settings-${sectionId} must exist in ProjectSettingsTab`,
        );
        assert.match(
            settingsTab,
            new RegExp(`id="project-settings-${sectionId}"[^>]*data-project-settings-section`),
            `Section #project-settings-${sectionId} must have data-project-settings-section attribute`,
        );
    }

    // 3. Sections must appear in canonical order in the continuous document
    let lastIndex = -1;
    for (const sectionId of canonicalSections) {
        const currentIndex = settingsTab.indexOf(`id="project-settings-${sectionId}"`);
        assert.ok(
            currentIndex > lastIndex,
            `Section #${sectionId} (pos ${currentIndex}) must appear after previous section (pos ${lastIndex})`,
        );
        lastIndex = currentIndex;
    }
});

test("project settings sidebar organizes navigation into 4 semantic category groups aligned with top tabs", () => {
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // Must define SECTION_GROUPS with 4 distinct category clusters
    assert.match(settingsTab, /SECTION_GROUPS/, "ProjectSettingsTab must declare SECTION_GROUPS");
    assert.match(settingsTab, /label:\s*"(?:Project )?Profile"/, "SECTION_GROUPS must include Profile category");
    assert.match(settingsTab, /label:\s*"Access & Team"/, "SECTION_GROUPS must include Access & Team category");
    assert.match(settingsTab, /label:\s*"Workspace Policies"/, "SECTION_GROUPS must include Workspace Policies category");
    assert.match(settingsTab, /label:\s*"System & Governance"/, "SECTION_GROUPS must include System & Governance category");

    // Desktop sidebar preserves the Settings workspace gutter below the sticky project tabs while the route scrolls.
    assert.match(
        settingsTab,
        /<aside[^>]*sticky top-\[calc\(var\(--project-tabs-height\)\+1\.5rem\)\][^>]*w-\[248px\]/,
        "Sidebar navigation rail must preserve clearance below the project tabs",
    );

    // Mobile navigation selector preserves the compact version of the same clearance.
    assert.match(
        settingsTab,
        /<details[^>]*sticky top-\[calc\(var\(--project-tabs-height\)\+1\.25rem\)\][^>]*xl:hidden/,
        "Mobile view must preserve clearance below the project tabs",
    );

    assert.match(settingsTab, /gap-6[^\n]*px-4 pb-6 pt-5 sm:px-6 sm:pb-8 sm:pt-6/, "Project settings should keep horizontal page insets plus top and bottom gutters");
    assert.doesNotMatch(settingsTab, /max-w-\[1320px\][^\n]*(?:p-4|sm:p-6)/, "Project settings should meet the project tabs and viewport bottom without a vertical gap");
    assert.doesNotMatch(settingsTab, /data-project-settings-document className="[^"]*overflow-y-auto/, "Settings content must use the route scroll so the project header can move away");
    assert.doesNotMatch(settingsTab, /data-project-settings-document className="[^"]*pb-16/, "The settings document should not reserve an artificial trailing gap");
});

test("project settings implements 60fps RAF ScrollSpy and non-thrashing navigation lock", () => {
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // Must have requestAnimationFrame throttling for ScrollSpy
    assert.match(
        settingsTab,
        /window\.requestAnimationFrame/,
        "ScrollSpy must be throttled with window.requestAnimationFrame",
    );

    assert.match(settingsTab, /const root = document\.querySelector<HTMLElement>\('\[data-scroll-root="route"\]'\)/, "ScrollSpy must observe the project route scroller");
    assert.doesNotMatch(settingsTab, /target\.scrollIntoView/, "Section navigation must not move the shared project route scroller");
    assert.match(settingsTab, /stickyTabsHeight/, "Section navigation must account for the sticky project tab height");
    assert.match(settingsTab, /scrollRoot\.scrollTo\(/, "Section navigation must scroll the route explicitly without scrollIntoView side effects");
    assert.doesNotMatch(settingsTab, /scroll-mt-\[var\(--project-tabs-height\)\]/, "Contained sections must not reserve a second project-tab offset");
    assert.match(settingsTab, /settingsScrollTop/, "File picker interactions must preserve the contained Settings scroll position");

    // Must have navigation lock to prevent URL thrashing during programmatic smooth scrolling
    assert.match(
        settingsTab,
        /locallyNavigatedSectionRef/,
        "Must maintain locallyNavigatedSectionRef navigation lock during smooth scroll",
    );

    // URL sync must avoid scrolling with { scroll: false }
    assert.match(
        settingsTab,
        /scroll:\s*false/,
        "router.replace must be called with { scroll: false } to prevent browser fighting smooth scroll",
    );
});

test("tasks tab is completely untouched by project settings continuous document architecture", () => {
    const tasksTab = source("src/components/projects/v2/TasksTab.tsx");

    // Strict boundary: tasks tab must not contain settings document elements
    assert.doesNotMatch(
        tasksTab,
        /data-project-settings-document/,
        "TasksTab must NOT contain data-project-settings-document",
    );
    assert.doesNotMatch(
        tasksTab,
        /data-project-settings-section/,
        "TasksTab must NOT contain data-project-settings-section",
    );
});
