import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["text-selection.spec.ts", "messaging.spec.ts", "profile.spec.ts", "sharing.spec.ts", "settings.spec.ts", "settings-controls.spec.ts", "settings-tabs.spec.ts", "welcome-flight.spec.ts", "signin-flight.spec.ts", "rails.spec.ts", "person-card.spec.ts", "desktop-ide.spec.ts", "org-tabs.spec.ts", "org-sidebar.spec.ts", "workspace-last-update.spec.ts", "workspace-header.spec.ts", "org-create.spec.ts", "pdf-viewer.spec.ts", "shared-confirm.spec.ts", "contribution-editor.spec.ts", "panel-layers.spec.ts", "review-queue.spec.ts", "hand-in.spec.ts", "sprints.spec.ts", "chat-sidebar.spec.ts", "org-board.spec.ts", "org-files.spec.ts", "org-workspaces.spec.ts", "org-discovery.spec.ts", "auth-social.spec.ts", "agent-access.spec.ts", "device-approval.spec.ts", "agent-labels.spec.ts", "agent-task.spec.ts", "change-sets.spec.ts", "history.spec.ts", "branches.spec.ts", "merge-requests.spec.ts", "protect-main.spec.ts", "workflow-tabs.spec.ts"],
  outputDir: "../../test-results/text-selection",
  timeout: 30_000,
  workers: 1,
  reporter: "list",
  use: { viewport: { width: 1200, height: 1000 }, screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
