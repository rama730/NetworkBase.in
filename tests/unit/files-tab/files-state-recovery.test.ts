import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { filesReturnQuery, taskFilesHref } from "@/lib/files/task-navigation";
import { confirmFileNavigation } from "@/lib/files/unsaved-navigation";
import { confirmStore } from "@/lib/ui/ask-confirm";
import { useFilesStore } from "@/stores/filesStore";
import {
  formatBytes,
  formatFileActor,
  formatFileTimestamp,
} from "@/components/workspaces/v2/files-tab/folder/format";
import { FileIcon } from "@/components/workspaces/v2/explorer/FileIcons";
import { FileTypeChip, resolveFileTypeMark } from "@/components/workspaces/v2/files-tab/FileTypeChip";
import { isTextLike } from "@/components/workspaces/v2/utils/fileKind";

test("task drawer returns to the same Files scope, query, file and inspector", () => {
  const origin = new URLSearchParams({
    tab: "files",
    filesView: "tasks",
    filesTask: "task-1",
    filesRole: "reference",
    filesQuery: "design & notes",
    fileId: "file-1",
    path: "docs/a.txt",
    filesPanel: "linked_tasks",
    filesNav: "tree",
  });
  const href = new URLSearchParams(
    taskFilesHref(`?${origin}`, "task-2", "file-1"),
  );
  assert.equal(href.get("drawerId"), "task-2");
  assert.equal(href.get("panelTab"), "files");
  assert.equal(href.get("fileId"), "file-1");
  assert.deepEqual(
    new URLSearchParams(filesReturnQuery(href.get("filesReturn")!)!).size,
    origin.size,
  );
  for (const [key, value] of origin)
    assert.equal(new URLSearchParams(href.get("filesReturn")!).get(key), value);
});

test("return context is bounded and cannot introduce an external route or task drawer", () => {
  assert.equal(filesReturnQuery("https://evil.example/?tab=files"), null);
  assert.equal(filesReturnQuery("tab=tasks"), null);
  assert.equal(filesReturnQuery("tab=files&path=" + "a".repeat(8192)), null);
  assert.equal(
    filesReturnQuery(
      "tab=files&redirect=https://evil.example&drawerId=other&filesReturn=nested",
    ),
    "tab=files",
  );
});

test("unknown metadata never becomes zero bytes, today's date, or a guessed author", () => {
  assert.equal(formatBytes(null), "");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatFileTimestamp(null), "Not recorded");
  assert.equal(formatFileTimestamp("not a date"), "Not recorded");
  assert.equal(
    formatFileActor({ updatedByName: "  ", updatedByUsername: "  author  " }),
    "author",
  );
  assert.equal(formatFileActor({}), "Not recorded");
});

test("extensionless images and PDFs retain MIME-aware icons", () => {
  const render = (mimeType: string) =>
    renderToStaticMarkup(
      React.createElement(FileIcon, { name: "asset", type: "file", mimeType }),
    );
  assert.notEqual(render("image/png"), render("application/octet-stream"));
  assert.notEqual(
    render("application/pdf"),
    render("application/octet-stream"),
  );
});

test("FileIcon provides accurate license and readme iconography adhering to design specifications", () => {
  const render = (name: string, isFolder?: boolean) =>
    renderToStaticMarkup(React.createElement(FileIcon, { name, isFolder: !!isFolder }));

  const licenseMarkup = render("LICENSE");
  const licenceMarkup = render("LICENCE");
  const licenseMdMarkup = render("LICENSE.md");
  const readmeMarkup = render("README.md");
  const readmeLower = render("readme.txt");
  const folderMarkup = render("docs", true);

  // License files use the legal FileBadge icon and amber token #9A6B00
  assert.match(licenseMarkup, /text-\[#9A6B00\]/);
  assert.equal(licenseMarkup, licenceMarkup);
  assert.equal(licenseMarkup, licenseMdMarkup);

  // Readme files use BookOpen and cobalt token #2563C9
  assert.match(readmeMarkup, /text-\[#2563C9\]/);
  assert.match(readmeLower, /text-\[#2563C9\]/);

  // Folders use brand clay token #D14E24
  assert.match(folderMarkup, /text-\[#D14E24\]/);

  // Main row chips (resolveFileTypeMark) classify LICENSE as LIC and hub as TXT
  assert.equal(resolveFileTypeMark("LICENSE"), "LIC");
  assert.equal(resolveFileTypeMark("LICENCE"), "LIC");
  assert.equal(resolveFileTypeMark("LICENSE.md"), "LIC");
  assert.equal(resolveFileTypeMark("README.md"), "TXT");
  assert.equal(resolveFileTypeMark("hub"), "TXT");

  // Main row chips (FileTypeChip) render the exact icons (FileBadge for license, ShieldCheck for security, BookOpen for readme)
  const licenseChip = renderToStaticMarkup(React.createElement(FileTypeChip, { name: "LICENSE" }));
  const securityChip = renderToStaticMarkup(React.createElement(FileTypeChip, { name: "SECURITY.md" }));
  const readmeChip = renderToStaticMarkup(React.createElement(FileTypeChip, { name: "README.md" }));

  assert.match(licenseChip, /text-\[#9A6B00\]/); // Amber legal icon
  assert.match(securityChip, /text-\[#2F6B4F\]/); // Moss green shield icon
  assert.match(readmeChip, /text-\[#2563C9\]/); // Cobalt book icon

  // isTextLike classifies LICENSE, hub, and readme as text (not binary)
  assert.equal(isTextLike({ type: "file", name: "LICENSE", mimeType: null }), true);
  assert.equal(isTextLike({ type: "file", name: "hub", mimeType: null }), true);
  assert.equal(isTextLike({ type: "file", name: "README.md", mimeType: null }), true);
});

test("cancelled cross-tab navigation preserves the draft; discard targets only this file", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = useFilesStore.persist.getOptions().storage;
  useFilesStore.persist.setOptions({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const events: CustomEvent[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: (event: CustomEvent) => {
        events.push(event);
        return true;
      },
    },
  });
  const store = useFilesStore.getState();
  const projectId = "recovery-test";
  let went = 0;
  const go = () => { went += 1; };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  try {
    store.ensureProjectFilesState(projectId);
    store.setDirtyFile(projectId, "file-1", true);
    // Unsaved: the shared dialog asks (no browser pop-up), and Keep editing leaves the draft and stays.
    confirmFileNavigation(projectId, go);
    assert.equal(confirmStore.current()?.title, "Discard unsaved file changes and leave this file?");
    confirmStore.current()!.answer(false);
    await settle();
    assert.equal(went, 0);
    assert.equal(useFilesStore.getState().byProjectId[projectId]?.dirtyFileId, "file-1");
    assert.equal(events.length, 0);
    // Discard clears only this file's draft, then goes.
    confirmFileNavigation(projectId, go);
    confirmStore.current()!.answer(true);
    await settle();
    assert.equal(went, 1);
    assert.equal(useFilesStore.getState().byProjectId[projectId]?.dirtyFileId, null);
    assert.equal(events[0]?.type, "project:discard-file-edits");
    assert.deepEqual(events[0]?.detail, { projectId, nodeId: "file-1" });
    // Nothing unsaved: it goes at once, without asking.
    confirmFileNavigation(projectId, go);
    assert.equal(went, 2);
    assert.equal(confirmStore.current(), null);
    assert.equal(events.length, 1);
  } finally {
    useFilesStore.persist.setOptions({ storage: originalStorage });
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("editor snapshot and failed notes remain recoverable without closing the editor", () => {
  const text = readFileSync(
    "src/components/workspaces/v2/files-tab/file/TextViewer.tsx",
    "utf8",
  );
  assert.match(text, /const loadVersion = editSnapshot.current\?\.version/);
  assert.match(text, /baseVersion,\s*baseHash,\s*lease,/);
  assert.match(text, /Try editing again/);
  assert.doesNotMatch(text, /baseVersion: node.currentVersion/);
  const notes = readFileSync(
    "src/components/workspaces/v2/files-tab/file/LinkedTasksPanel.tsx",
    "utf8",
  );
  assert.match(
    notes,
    /if \(!result.success\) \{[\s\S]*?setSaveError\([\s\S]*?return;\s*\}\s*setIsEditing\(false\)/,
  );
});

test("subsequent task file pages use the query cache, not disposable local state", () => {
  const text = readFileSync(
    "src/components/workspaces/v2/files-tab/TaskFilesCollection.tsx",
    "utf8",
  );
  assert.match(text, /fileCursor: taskId \? pageParam : undefined/);
  assert.match(text, /getNextPageParam:[\s\S]*?nextFileCursor/);
  assert.match(text, /result.data\?\.pages.flatMap/);
});

test("all browser uploads share one bounded retry and concurrency owner", () => {
  const source = readFileSync(
    "src/lib/upload/supabase-signed-upload-client.ts",
    "utf8",
  );
  assert.match(source, /const MAX_TRANSFERS = 4/);
  assert.match(source, /const MAX_RESUMABLE_TRANSFERS = 2/);
  assert.match(source, /for \(let attempt = 0; attempt < 4; attempt \+= 1\)/);
  assert.match(source, /await acquireTransferSlot\(options\.signal\)/);
  assert.match(source, /cancelSupabaseUploadOperation/);
});
