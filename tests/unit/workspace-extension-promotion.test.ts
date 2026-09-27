import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildIdeLaunchUri,
  buildIdeMarketplaceUri,
  resolveIdeFromSession,
  getAlwaysOpenDirect,
  setAlwaysOpenDirect,
  SUPPORTED_IDES,
  EXTENSION_URI_AUTHORITY,
  IDE_ALWAYS_OPEN_STORAGE_KEY,
} from "@/lib/extension/ide-protocol";

describe("WorkSpace Extension Desktop Deep-Linking & Promotion Contract", () => {
  describe("Protocol Scheme & URI Builder", () => {
    const projectId = "11111111-2222-3333-4444-555555555555";
    const projectSlug = "test-project";

    it("generates correct URI for Cursor editor", () => {
      const uri = buildIdeLaunchUri({
        ide: "cursor",
        projectId,
        projectSlug,
      });

      assert.ok(uri.startsWith("cursor://"));
      assert.ok(uri.includes(`cursor://${EXTENSION_URI_AUTHORITY}/open`));
      assert.ok(uri.includes(`projectId=${projectId}`));
      assert.ok(uri.includes(`slug=${projectSlug}`));
    });

    it("generates correct URI for VS Code", () => {
      const uri = buildIdeLaunchUri({
        ide: "vscode",
        projectId,
        projectSlug,
      });

      assert.ok(uri.startsWith(`vscode://${EXTENSION_URI_AUTHORITY}/open`));
      assert.ok(uri.includes(`projectId=${projectId}`));
    });

    it("generates correct URI for Windsurf", () => {
      const uri = buildIdeLaunchUri({
        ide: "windsurf",
        projectId,
        projectSlug,
      });

      assert.ok(uri.startsWith(`windsurf://${EXTENSION_URI_AUTHORITY}/open`));
    });

    it("generates correct URI for VSCodium", () => {
      const uri = buildIdeLaunchUri({
        ide: "vscodium",
        projectId,
        projectSlug,
      });

      assert.ok(uri.startsWith(`vscodium://${EXTENSION_URI_AUTHORITY}/open`));
    });

    it("injects fileId and filePath context for Files Tab deep-linking", () => {
      const uri = buildIdeLaunchUri({
        ide: "cursor",
        projectId,
        projectSlug,
        fileId: "file-999",
        filePath: "src/main.ts",
      });

      assert.ok(uri.includes("fileId=file-999"));
      assert.ok(uri.includes("filePath=src%2Fmain.ts"));
    });

    it("injects taskId context for Tasks Tab deep-linking", () => {
      const uri = buildIdeLaunchUri({
        ide: "vscode",
        projectId,
        projectSlug,
        taskId: "task-456",
      });

      assert.ok(uri.includes("taskId=task-456"));
    });

    it("supports in-editor marketplace URIs to install extension directly", () => {
      assert.equal(
        buildIdeMarketplaceUri("cursor"),
        `cursor:extension/${EXTENSION_URI_AUTHORITY}`,
      );
      assert.equal(
        buildIdeMarketplaceUri("vscode"),
        `vscode:extension/${EXTENSION_URI_AUTHORITY}`,
      );
      assert.equal(
        buildIdeMarketplaceUri("windsurf"),
        `windsurf:extension/${EXTENSION_URI_AUTHORITY}`,
      );
      assert.equal(
        buildIdeMarketplaceUri("vscodium"),
        `vscodium:extension/${EXTENSION_URI_AUTHORITY}`,
      );
    });

    it("resolves active extension session metadata to supported IDE definitions", () => {
      assert.equal(resolveIdeFromSession({ editorName: "Cursor" }), "cursor");
      assert.equal(resolveIdeFromSession({ editorName: "Visual Studio Code" }), "vscode");
      assert.equal(resolveIdeFromSession({ editorName: "Windsurf" }), "windsurf");
      assert.equal(resolveIdeFromSession({ editorName: "VSCodium" }), "vscodium");
      assert.equal(resolveIdeFromSession({ editorName: "Code - Insiders" }), "vscode-insiders");
      assert.equal(resolveIdeFromSession({ editorName: "Unknown Editor" }), "vscode");
    });

    it("supports all declared IDE definitions with valid icon assets", () => {
      const ideKeys = Object.keys(SUPPORTED_IDES);
      assert.ok(ideKeys.includes("cursor"));
      assert.ok(ideKeys.includes("vscode"));
      assert.ok(ideKeys.includes("windsurf"));
      assert.ok(ideKeys.includes("vscodium"));

      for (const key of ideKeys) {
        const ide = SUPPORTED_IDES[key as keyof typeof SUPPORTED_IDES];
        assert.ok(ide.scheme.length > 0);
        assert.ok(ide.icon.startsWith("/ide-icons/"));
      }
    });

    it("provides getAlwaysOpenDirect and setAlwaysOpenDirect helpers", () => {
      assert.equal(typeof getAlwaysOpenDirect, "function");
      assert.equal(typeof setAlwaysOpenDirect, "function");
      assert.equal(IDE_ALWAYS_OPEN_STORAGE_KEY, "nb:ide-always-open-direct");
    });
  });

  describe("Custom Open Confirmation Modal & 'Always allow' Flow Contract", () => {
    it("OpenInIdeButton contains custom Open modal with 'Always allow' tick mark and 'Open' button", () => {
      const buttonPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/files-tab/OpenInIdeButton.tsx",
      );
      const content = fs.readFileSync(buttonPath, "utf-8");

      assert.ok(
        content.includes("confirmModalOpen"),
        "OpenInIdeButton must have confirmModalOpen state",
      );
      assert.ok(
        content.includes("Always allow"),
        "OpenInIdeButton must include 'Always allow' tick mark label",
      );
      assert.ok(
        content.includes("handleConfirmOpen"),
        "OpenInIdeButton must include handleConfirmOpen handler",
      );
      assert.ok(
        content.includes("setAlwaysOpenDirect(true)"),
        "OpenInIdeButton must persist preference when ticked",
      );
      assert.ok(
        content.includes("getAlwaysOpenDirect()"),
        "OpenInIdeButton must check getAlwaysOpenDirect() to skip modal when allowed",
      );
    });
  });

  describe("Tasks Tab WorkSpace Extension Promotion Removal Contract", () => {
    it("does not render WorkspaceExtensionPromotionCard in TasksTab.tsx", () => {
      const tasksTabPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/TasksTab.tsx",
      );
      const content = fs.readFileSync(tasksTabPath, "utf-8");

      assert.ok(
        !content.includes("WorkspaceExtensionPromotionCard"),
        "TasksTab.tsx must not import or render WorkspaceExtensionPromotionCard",
      );
    });
  });

  describe("Files Tab Open in IDE Tool & State-Aware Flow Contract", () => {
    it("renders OpenInIdeButton in FilesWorkspaceHeader.tsx", () => {
      const headerPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/files-tab/FilesWorkspaceHeader.tsx",
      );
      const content = fs.readFileSync(headerPath, "utf-8");

      assert.ok(
        content.includes("OpenInIdeButton"),
        "FilesWorkspaceHeader must import and render OpenInIdeButton",
      );
      assert.ok(
        content.includes("<OpenInIdeButton"),
        "FilesWorkspaceHeader must include JSX element for OpenInIdeButton",
      );
    });

    it("FilesTabMain passes projectSlug down to FilesWorkspaceHeader", () => {
      const mainPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/files-tab/FilesTabMain.tsx",
      );
      const content = fs.readFileSync(mainPath, "utf-8");

      assert.ok(
        content.includes("projectSlug={projectSlug}"),
        "FilesTabMain must forward projectSlug to FilesWorkspaceHeader",
      );
    });

    it("OpenInIdeButton implements state-aware flow: shows laptop IDEs when unconnected, only connected IDEs when authenticated", () => {
      const buttonPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/files-tab/OpenInIdeButton.tsx",
      );
      const content = fs.readFileSync(buttonPath, "utf-8");

      // Hook lookup
      assert.ok(content.includes("useExtensionSessionsData"));

      // State branches
      assert.ok(content.includes("!hasConnected"));
      assert.ok(content.includes("Connect Desktop IDE"));
      assert.ok(content.includes("initiateLaunch"));
      assert.ok(content.includes("connectedIdes.length === 1"));

      // When only 1 connected, shows only that connected IDE
      assert.ok(content.includes("Open in {connectedIdes[0].ide.name}"));

      // Connected indicator dot
      assert.ok(content.includes("bg-emerald-500"));

      // Supports taskId parameter
      assert.ok(content.includes("taskId?: string | null;"));
      assert.ok(content.includes("taskId: taskId || undefined"));
    });
  });

  describe("Task Detail Panel Open in IDE Top Header Integration", () => {
    it("renders OpenInIdeButton at the top of TaskDetailPanel.tsx with taskId context", () => {
      const taskDetailPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/tasks/TaskDetailPanel.tsx",
      );
      const content = fs.readFileSync(taskDetailPath, "utf-8");

      assert.ok(
        content.includes("OpenInIdeButton"),
        "TaskDetailPanel must import OpenInIdeButton",
      );
      assert.ok(
        content.includes("<OpenInIdeButton"),
        "TaskDetailPanel must render OpenInIdeButton JSX element in top header",
      );
      assert.ok(
        content.includes("taskId={resource.task.id}"),
        "TaskDetailPanel must pass taskId={resource.task.id} to OpenInIdeButton",
      );
      assert.ok(
        content.includes("projectId={projectId}"),
        "TaskDetailPanel must pass projectId={projectId} to OpenInIdeButton",
      );
      assert.ok(
        content.includes("projectSlug={projectSlug}"),
        "TaskDetailPanel must pass projectSlug={projectSlug} to OpenInIdeButton",
      );
    });
  });

  describe("Tasks Tab Open in IDE Toolbar Integration", () => {
    it("renders OpenInIdeButton before New section in TasksTab.tsx", () => {
      const tasksTabPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/TasksTab.tsx",
      );
      const content = fs.readFileSync(tasksTabPath, "utf-8");

      assert.ok(
        content.includes("OpenInIdeButton"),
        "TasksTab must import OpenInIdeButton",
      );
      assert.ok(
        content.includes("<OpenInIdeButton"),
        "TasksTab must render OpenInIdeButton JSX element in toolbar",
      );

      const ideBtnIndex = content.indexOf("<OpenInIdeButton");
      const toolbarNewSectionIndex = content.indexOf(
        '<span className="hidden sm:inline">New section</span>',
      );
      assert.ok(
        ideBtnIndex !== -1 &&
          toolbarNewSectionIndex !== -1 &&
          ideBtnIndex < toolbarNewSectionIndex,
        "OpenInIdeButton must appear before 'New section' button in TasksTab toolbar",
      );
    });
  });

  describe("Dynamic Laptop Installed IDEs Detection Contract", () => {
    it("detects installed IDEs from user machine with valid platform mapping", async () => {
      const { detectInstalledLaptopIdesAction } = await import(
        "@/app/actions/laptop-ides"
      );
      const result = await detectInstalledLaptopIdesAction();

      assert.equal(result.success, true);
      assert.ok(["darwin", "win32", "linux", "unknown"].includes(result.platform));
      assert.ok(Array.isArray(result.installedIds));

      // In macOS environment, verifies installed IDEs exist in SUPPORTED_IDES
      for (const id of result.installedIds) {
        assert.ok(id in SUPPORTED_IDES, `Detected IDE ${id} must exist in SUPPORTED_IDES`);
      }

      // Verification of zero false positives:
      // Even if ~/.windsurf exists, windsurf must NOT be detected unless Windsurf.app or binary exists
      if (result.platform === "darwin") {
        const hasWindsurfApp =
          fs.existsSync("/Applications/Windsurf.app") ||
          fs.existsSync(path.join(process.env.HOME || "", "Applications/Windsurf.app"));
        if (!hasWindsurfApp) {
          assert.equal(
            result.installedIds.includes("windsurf"),
            false,
            "Windsurf must NOT be detected when Windsurf.app is not installed",
          );
        }
      }
    });

    it("OpenInIdeButton integrates useLaptopInstalledIdes", () => {
      const buttonPath = path.resolve(
        process.cwd(),
        "src/components/projects/v2/files-tab/OpenInIdeButton.tsx",
      );
      const buttonContent = fs.readFileSync(buttonPath, "utf-8");

      assert.ok(
        buttonContent.includes("useLaptopInstalledIdes"),
        "OpenInIdeButton must import useLaptopInstalledIdes",
      );
      assert.ok(
        buttonContent.includes("Installed on Your"),
        "OpenInIdeButton must render 'Installed on Your' section when detected",
      );
    });
  });
});

