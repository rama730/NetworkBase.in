import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("primary actions derive hover and pressed states from the active light or dark accent", () => {
  const css = source("src/app/globals.css");
  const topNav = source("src/components/layout/header/TopNav.tsx");
  const githubSync = source("src/components/projects/v2/files-tab/RepositorySync.tsx");
  const folderList = source("src/components/projects/v2/files-tab/folder/FolderListView.tsx");

  assert.match(css, /--theme-action-hover-light: color-mix/);
  assert.match(css, /--theme-action-hover-dark: color-mix/);
  assert.match(css, /--primary-hover: var\(--theme-action-hover-light\)/);
  assert.match(css, /--primary-hover: var\(--theme-action-hover-dark\)/);
  assert.match(css, /--primary-active: var\(--theme-action-active-dark\)/);
  assert.match(topNav, /hover:bg-\[var\(--primary-hover\)\]/);
  assert.match(topNav, /active:bg-\[var\(--primary-active\)\]/);
  assert.doesNotMatch(topNav, /hover:bg-\[var\(--nb-brand-hover\)\]/);
  assert.match(githubSync, /const primaryButton[\s\S]*?bg-primary[\s\S]*?hover:bg-\[var\(--primary-hover\)\]/);
  assert.match(folderList, /bg-primary[\s\S]*?hover:bg-\[var\(--primary-hover\)\]/);
});
