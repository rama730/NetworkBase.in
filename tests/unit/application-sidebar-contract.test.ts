import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("application sidebar supports a persisted accessible icon-only state", () => {
  const sidebar = read("src/components/layout/AppSidebar.tsx");
  const css = read("src/app/globals.css");

  assert.match(sidebar, /networkbase:sidebar-collapsed/);
  assert.match(sidebar, /function readSidebarCollapsedPreference\(\)/);
  assert.match(sidebar, /function writeSidebarCollapsedPreference\(collapsed: boolean\)/);
  assert.match(sidebar, /useUIStore\(\(state\) => state\.sidebarCollapsed\)/);
  assert.match(sidebar, /setSidebarCollapsed\(next\);\s+writeSidebarCollapsedPreference\(next\);/);
  assert.match(sidebar, /data-collapsed=\{preferenceReady \? String\(collapsed\) : undefined\}/);
  assert.match(sidebar, /aria-label=\{collapsed \? "Expand sidebar" : "Collapse sidebar"\}/);
  assert.match(sidebar, /aria-controls="application-sidebar-navigation"/);
  assert.match(sidebar, /aria-expanded=\{!collapsed\}/);
  assert.match(sidebar, /PanelLeftOpen/);
  assert.match(sidebar, /PanelLeftClose/);
  assert.match(sidebar, /aria-label="Settings and sidebar controls"/);
  assert.match(sidebar, /nb-sidebar-scroll app-scroll app-scroll-y min-h-0 flex-1 space-y-3 pr-1/);
  assert.match(sidebar, /<section className="nb-sidebar-workspace space-y-3"/);
  assert.doesNotMatch(sidebar, /nb-sidebar-scroll app-scroll app-scroll-y min-h-0 flex-1 space-y-5 pr-1/);
  assert.doesNotMatch(sidebar, /<section className="nb-sidebar-workspace space-y-2"/);
  assert.match(sidebar, /<h2[^>]*>Workspaces<\/h2>/);
  assert.match(sidebar, /<div className="flex items-center gap-3 px-2">\s*<h2 id="sidebar-workspace-heading" className="nb-micro whitespace-nowrap">Workspaces<\/h2>\s*<div className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" \/>/);
  assert.ok(
    sidebar.indexOf("<WorkspaceIndicator />") > sidebar.indexOf('aria-label="My profile"')
      && sidebar.indexOf("<WorkspaceIndicator />") < sidebar.indexOf('className="nb-sidebar-workspace'),
    "My Work should appear directly after My Profile and before the Workspaces project list",
  );
  assert.match(sidebar, /data-layout=\{preferenceReady \? \(collapsed \? "stacked" : "inline"\) : undefined\}/);
  assert.ok(
    sidebar.indexOf('className="nb-nav-link nb-sidebar-toggle"') > sidebar.indexOf('aria-label="Settings and sidebar controls"'),
    "the sidebar toggle should live in the fixed footer with Settings",
  );
  assert.doesNotMatch(sidebar, /nb-sidebar-toggle[\s\S]*?<span className="nb-sidebar-label">/);
  assert.match(css, /\.nb-sidebar-footer \{ display:flex; flex:none; flex-flow:row nowrap;/);
  assert.match(css, /\.nb-sidebar-toggle \{ width:32px;/);
  assert.match(css, /\.nb-sidebar-footer\[data-layout="stacked"\] \{ flex-direction:column;/);
  assert.match(css, /\.nb-sidebar-footer\[data-layout="stacked"\] > \.nb-nav-link \{ width:100%;/);
  assert.match(css, /--nb-sidebar-width: 224px/);
  assert.match(css, /--nb-sidebar-collapsed-width: 64px/);
  assert.match(css, /\.nb-sidebar\[data-collapsed="true"\] \+ \.nb-main-frame/);
  assert.match(css, /\.nb-sidebar\[data-collapsed="true"\] \.nb-sidebar-label \{ display:none; \}/);
  assert.match(css, /\.nb-sidebar\[data-collapsed="true"\] \.nb-sidebar-workspace \{ display:none; \}/);
  assert.match(css, /@media \(min-width:768px\) and \(max-width:1023px\)/);
});

test("workspace project links in application sidebar render titles without file/folder icons", () => {
  const sidebar = read("src/components/layout/AppSidebar.tsx");

  // 1. FolderKanban is not imported or rendered in AppSidebar
  assert.doesNotMatch(sidebar, /FolderKanban/);

  // 2. Workspaces project links render title directly in nb-sidebar-label without leading icon
  // With organizations on, SidebarWorkspaces renders the tree (report §29.3); the plain list stays the fallback.
  assert.match(sidebar, /<section className="nb-sidebar-workspace[\s\S]*?(?:\{|\{workspaces \? <SidebarWorkspaces data=\{workspaces\} \/> : )projects\.map\(\(project\) => \{/);
  assert.match(sidebar, /<Link key=\{project\.id\} href=\{project\.href\} className="nb-nav-link"[^>]*>\s*<span className="nb-sidebar-label truncate">\{project\.title\}<\/span>\s*<\/Link>/);
});
