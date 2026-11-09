import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  validateUploadSelection,
  stripOsJunkFiles,
  FORBIDDEN_ROOT_DIRS,
  EXE_BLOCKLIST,
} from "@/lib/files/upload-validator";

function createMockFile(name: string, relativePath?: string, size: number = 100): File {
  const file = new File([new Uint8Array(size)], name, { type: "text/plain" });
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      writable: false,
    });
  }
  return file;
}

describe("Upload Security & Selection Validation", () => {
  it("rejects empty file selection", () => {
    const res = validateUploadSelection([]);
    assert.equal(res.valid, false);
    assert.match(res.error || "", /No files were selected/i);
    assert.equal(res.files.length, 0);
  });

  it("rejects null or undefined file selection", () => {
    const res = validateUploadSelection(null);
    assert.equal(res.valid, false);
    assert.match(res.error || "", /No files were selected/i);
  });

  it("rejects selections containing ONLY OS junk metadata (.DS_Store, Thumbs.db)", () => {
    const junkFiles = [
      createMockFile(".DS_Store"),
      createMockFile("Thumbs.db"),
      createMockFile("desktop.ini"),
      createMockFile("._metadata.txt"),
    ];
    const res = validateUploadSelection(junkFiles);
    assert.equal(res.valid, false);
    assert.match(res.error || "", /contains no valid files/i);
    assert.equal(res.files.length, 0);
  });

  it("strips OS junk files while preserving legitimate files", () => {
    const mixedFiles = [
      createMockFile(".DS_Store"),
      createMockFile("document.pdf"),
      createMockFile("Thumbs.db"),
      createMockFile("image.png"),
    ];
    const clean = stripOsJunkFiles(mixedFiles);
    assert.equal(clean.length, 2);
    assert.equal(clean[0]!.name, "document.pdf");
    assert.equal(clean[1]!.name, "image.png");

    const res = validateUploadSelection(mixedFiles);
    assert.equal(res.valid, true);
    assert.equal(res.files.length, 2);
  });

  it("rejects root disk uploads where files span multiple system directories (Macintosh HD scenario)", () => {
    // When the user clicks "Upload" on Macintosh HD in macOS Finder:
    const macintoshHdFiles = [
      createMockFile("Safari.app", "Applications/Safari.app/Contents/Info.plist"),
      createMockFile("system.log", "Library/Logs/system.log"),
      createMockFile("kernel", "System/Library/Kernels/kernel"),
      createMockFile(".bashrc", "Users/john/.bashrc"),
    ];

    const res = validateUploadSelection(macintoshHdFiles, { isFolder: true });
    assert.equal(res.valid, false);
    assert.match(res.error || "", /Cannot upload root disk or system directories/i);
  });

  it("rejects uploads targeting single forbidden system directories", () => {
    const forbiddenExamples = [
      { name: "Applications", path: "Applications/App.app/file.txt" },
      { name: "System", path: "System/Library/file.txt" },
      { name: "Library", path: "Library/Preferences/file.plist" },
      { name: "usr", path: "usr/bin/python" },
      { name: "bin", path: "bin/bash" },
      { name: "etc", path: "etc/hosts" },
      { name: "var", path: "var/log/syslog" },
      { name: "Windows", path: "Windows/System32/calc.exe" },
      { name: "Program Files", path: "Program Files/Common/file.dll" },
      { name: "node_modules", path: "node_modules/react/index.js" },
      { name: ".git", path: ".git/HEAD" },
    ];

    for (const item of forbiddenExamples) {
      const files = [createMockFile("test.txt", item.path)];
      const res = validateUploadSelection(files, { isFolder: true });
      assert.equal(res.valid, false, `Expected ${item.name} to be rejected`);
      assert.match(res.error || "", /Cannot upload system directory/i);
    }
  });

  it("rejects path traversal attempts (.. in relative path)", () => {
    const traversalFiles = [
      createMockFile("secret.txt", "project/../../secret.txt"),
    ];
    const res = validateUploadSelection(traversalFiles, { isFolder: true });
    assert.equal(res.valid, false);
    assert.match(res.error || "", /directory traversal is prohibited/i);
  });

  it("accepts valid workspace files and folders", () => {
    const validFiles = [
      createMockFile("index.ts", "my-project/src/index.ts"),
      createMockFile("Button.tsx", "my-project/src/components/Button.tsx"),
      createMockFile("logo.png", "my-project/assets/logo.png"),
    ];

    const res = validateUploadSelection(validFiles, { isFolder: true });
    assert.equal(res.valid, true);
    assert.equal(res.files.length, 3);
    assert.equal(res.folderName, "my-project");
  });

  it("enforces safety limit on oversized batch uploads (> 5,000 files)", () => {
    const files: File[] = [];
    for (let i = 0; i < 5001; i++) {
      files.push(createMockFile(`file_${i}.txt`, `big-folder/file_${i}.txt`));
    }
    const res = validateUploadSelection(files, { isFolder: true });
    assert.equal(res.valid, false);
    assert.match(res.error || "", /Upload limit is 5,000 files/i);
  });

  it("FORBIDDEN_ROOT_DIRS includes standard OS and dangerous package directories", () => {
    assert.equal(FORBIDDEN_ROOT_DIRS.has("macintosh hd"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("system"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("library"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("applications"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("usr"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("bin"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("node_modules"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has(".git"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("windows"), true);
    assert.equal(FORBIDDEN_ROOT_DIRS.has("program files"), true);
  });

  it("rejects user home directory uploads (CH Rama, chrama, or home profile indicators)", () => {
    // Scenario 1: Folder name explicitly matches known user profile name (CH Rama)
    const chRamaFiles = [
      createMockFile("notes.txt", "CH Rama/Desktop/notes.txt"),
      createMockFile("photo.jpg", "CH Rama/Pictures/photo.jpg"),
    ];
    const res1 = validateUploadSelection(chRamaFiles, { isFolder: true });
    assert.equal(res1.valid, false);
    assert.match(res1.error || "", /Cannot upload user home directory \(CH Rama\)/i);

    // Scenario 2: Folder contains multiple standard user home indicators (Desktop, Downloads, Documents)
    const userProfileFiles = [
      createMockFile("work.docx", "myuser/Desktop/work.docx"),
      createMockFile("app.dmg", "myuser/Downloads/app.dmg"),
      createMockFile("tax.pdf", "myuser/Documents/tax.pdf"),
    ];
    const res2 = validateUploadSelection(userProfileFiles, { isFolder: true });
    assert.equal(res2.valid, false);
    assert.match(res2.error || "", /Cannot upload user home directory/i);
  });

  it("EXE_BLOCKLIST includes dangerous executables and scripts", () => {
    assert.equal(EXE_BLOCKLIST.has("exe"), true);
    assert.equal(EXE_BLOCKLIST.has("bat"), true);
    assert.equal(EXE_BLOCKLIST.has("cmd"), true);
    assert.equal(EXE_BLOCKLIST.has("sh"), true);
    assert.equal(EXE_BLOCKLIST.has("ps1"), true);
  });

  it("rejects uploads containing executable or script files", () => {
    const dangerousFiles = [
      createMockFile("virus.exe"),
      createMockFile("script.sh", "scripts/script.sh"),
      createMockFile("installer.msi"),
    ];
    for (const file of dangerousFiles) {
      const res = validateUploadSelection([file]);
      assert.equal(res.valid, false);
      assert.match(res.error || "", /Uploading executable or script files/i);
    }
  });

  it("rejects files exceeding the maximum upload size limit (10MB)", () => {
    const oversized = createMockFile("My Movie 1.mov", undefined, 22 * 1024 * 1024);
    const res = validateUploadSelection([oversized]);
    assert.equal(res.valid, false);
    assert.match(res.error || "", /exceeds the maximum upload size limit of 10MB/i);
    assert.equal(res.files.length, 0);
  });

  it("respects custom maxFileBytes option in validateUploadSelection", () => {
    const file = createMockFile("photo.jpg", undefined, 5 * 1024 * 1024);
    const resPass = validateUploadSelection([file], { maxFileBytes: 10 * 1024 * 1024 });
    assert.equal(resPass.valid, true);
    assert.equal(resPass.files.length, 1);

    const resFail = validateUploadSelection([file], { maxFileBytes: 2 * 1024 * 1024 });
    assert.equal(resFail.valid, false);
    assert.match(resFail.error || "", /exceeds the maximum upload size limit of 2MB/i);
  });
});

describe("Design & UX Hardening Contracts (Darkening & Upload Scenarios)", () => {
  const dialogPath = path.resolve(process.cwd(), "src/components/ui/dialog.tsx");
  const explorerDialogsPath = path.resolve(
    process.cwd(),
    "src/components/workspaces/v2/explorer/ExplorerDialogsHost.tsx"
  );
  const mutationsPath = path.resolve(
    process.cwd(),
    "src/components/workspaces/v2/explorer/useExplorerMutations.ts"
  );

  it("dialog.tsx uses the design-system modal scrim without backdrop blur", () => {
    const source = readFileSync(dialogPath, "utf-8");
    assert.match(source, /bg-\[rgba\(13,17,20,0\.44\)\]/);
    assert.doesNotMatch(source, /backdrop-blur/);
  });

  it("ExplorerDialogsHost uses transparent non-darkening backdrop overlay for all modal dialogs", () => {
    const source = readFileSync(explorerDialogsPath, "utf-8");
    assert.doesNotMatch(
      source,
      /bg-\[rgba\(13,17,20,0\.44\)\]/,
      "Must not have harsh 0.44 dark overlay in ExplorerDialogsHost"
    );
    assert.match(source, /overlayClassName="z-\[300\] bg-transparent backdrop-blur-none"/);
  });

  it("ExplorerDialogsHost strictly disables Create button when folder or file name is empty", () => {
    const source = readFileSync(explorerDialogsPath, "utf-8");
    assert.match(source, /disabled=\{!canEdit \|\| !createDialog\.name\.trim\(\)\}/);
  });

  it("no upload pop-up remains (CLI report §19.2, A10 done means)", () => {
    for (const gone of ["src/components/workspaces/v2/files-tab/upload/FilesTabUploadModal.tsx", "src/components/workspaces/v2/tasks/components/TaskFileUploadModal.tsx"]) {
      assert.throws(() => readFileSync(path.resolve(process.cwd(), gone), "utf-8"), /ENOENT/);
    }
  });

  it("useExplorerMutations guards openFolderUpload and uploadFilesDirectly with validation", () => {
    const source = readFileSync(mutationsPath, "utf-8");
    assert.match(source, /validateUploadSelection\(rawFiles, \{ isFolder: true \}\)/);
    assert.match(source, /validateUploadSelection\(files, \{ isFolder: true \}\)/);
  });
});
