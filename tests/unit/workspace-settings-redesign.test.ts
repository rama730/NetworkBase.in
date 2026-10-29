import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SettingsCard } from "../../src/components/workspaces/settings/SettingsFormFields";
import { OpenSettingsSections } from "../../src/components/settings/ui/SettingsSectionLayout";
import { WorkspaceSettingsNavigation } from "../../src/components/workspaces/settings/WorkspaceSettingsNavigation";
import { getVisibleWorkspaceSettingsSections } from "../../src/lib/workspaces/settings-policies";
import {
  resolveWorkspaceSettingsSection,
  selectVisibleSettingsSection,
} from "../../src/lib/workspaces/settings-navigation";
import {
  encodeFilePermissionCursor,
  normalizeFilePermissionOptions,
  parseFilePermissionCursor,
} from "../../src/lib/workspaces/file-permission-pagination";

const noop = () => {};
const source = (path: string) => readFileSync(path, "utf8");
function renderSection(loadState?: {
  loading: boolean;
  hasData: boolean;
  error: string | null;
  retry: () => void;
}) {
  return renderToStaticMarkup(
    h(
      OpenSettingsSections,
      null,
      h(SettingsCard, {
        title: "Document publishing",
        description: "External images",
        loadState,
        footer: h("button", { type: "button" }, "Save changes"),
        children: h("input", {
          name: "externalImages",
          defaultValue: "authoritative value",
        }),
      }),
    ),
  );
}

test("settings documents render open sections while standalone consumers retain their frame", () => {
  const open = renderSection();
  assert.doesNotMatch(open, /rounded-lg border bg-card|bg-muted\/10|p-6/);
  assert.match(open, /border-t border-border py-4/);
  assert.match(open, /Document publishing/);
  const standalone = renderToStaticMarkup(
    h(SettingsCard, { title: "Standalone", children: "Content" }),
  );
  assert.match(standalone, /rounded-lg border bg-card/);
});

test("initial load and failed reads never render editable default settings", () => {
  const pending = renderSection({
    loading: true,
    hasData: false,
    error: null,
    retry: noop,
  });
  assert.match(pending, /role="status"/);
  assert.doesNotMatch(pending, /name="externalImages"/);
  const failed = renderSection({
    loading: false,
    hasData: false,
    error: "Read failed",
    retry: noop,
  });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Retry/);
  assert.doesNotMatch(failed, /name="externalImages"/);
});

test("refresh errors keep authoritative values mounted and disable mutations", () => {
  const stale = renderSection({
    loading: false,
    hasData: true,
    error: "Refresh failed",
    retry: noop,
  });
  assert.match(stale, /authoritative value/);
  assert.match(stale, /fieldset disabled=""/);
  assert.match(stale, /Showing the last loaded settings/);
  const retrying = renderSection({
    loading: true,
    hasData: true,
    error: null,
    retry: noop,
  });
  assert.match(retrying, /authoritative value/);
  assert.match(retrying, /fieldset disabled=""/);
});

test("navigation exposes all permitted sections with one current item in each responsive menu", () => {
  const sections = getVisibleWorkspaceSettingsSections();
  assert.equal(sections.length, 12);
  const markup = renderToStaticMarkup(
    h(WorkspaceSettingsNavigation, {
      sections,
      activeSection: "notifications",
      onNavigate: noop,
    }),
  );
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 2); // desktop and mobile
  assert.equal((markup.match(/class="nb-nav-link min-w-0/g) ?? []).length, 24);
  assert.doesNotMatch(
    markup,
    /Project preferences|Project Profile|Workspace Policies/,
  );
  const filtered = renderToStaticMarkup(
    h(WorkspaceSettingsNavigation, {
      sections: sections.filter(
        (section) => section.id !== "danger" && section.id !== "general",
      ),
      activeSection: "links",
      onNavigate: noop,
    }),
  );
  assert.doesNotMatch(
    filtered,
    /project-settings-danger|project-settings-general/,
  );
});

test("section routing preserves aliases, anchors and accessible fallbacks", () => {
  const sections = getVisibleWorkspaceSettingsSections();
  for (const alias of [
    "privacy",
    "privacy-terms",
    "privacy-policies",
    "#project-settings-privacy-policies",
  ]) {
    assert.equal(
      resolveWorkspaceSettingsSection(alias, sections),
      "privacy-policies",
    );
  }
  for (const alias of [null, "unknown", "security-audit", "security-data"])
    assert.equal(resolveWorkspaceSettingsSection(alias, sections), "general");
  const admin = sections.filter(
    (section) => section.id !== "general" && section.id !== "danger",
  );
  assert.equal(resolveWorkspaceSettingsSection("danger", admin), "links");
  assert.equal(
    resolveWorkspaceSettingsSection("#project-settings-tasks-workflow", sections),
    "tasks-workflow",
  );
});

test("scroll selection ignores passed sections and chooses the heading nearest the sticky tabs", () => {
  assert.equal(
    selectVisibleSettingsSection(
      [
        { id: "general", top: -500, bottom: 100 },
        { id: "links", top: 110, bottom: 500 },
        { id: "access", top: 520, bottom: 900 },
      ],
      110,
    ),
    "links",
  );
  assert.equal(selectVisibleSettingsSection([], 0), undefined);
  const navigation = source("src/hooks/useWorkspaceSettingsNavigation.ts");
  for (const event of [
    "popstate",
    "hashchange",
    "wheel",
    "touchstart",
    "keydown",
    "scrollend",
  ])
    assert.match(navigation, new RegExp(`addEventListener\\("${event}"`));
  assert.match(navigation, /prefers-reduced-motion/);
  assert.match(navigation, /ResizeObserver/);
  assert.doesNotMatch(navigation, /setTimeout/);
  assert.doesNotMatch(navigation, /scrollIntoView/);
});

test("file permission cursors round-trip complete ordering keys and reject malformed values", () => {
  const key = {
    rank: 2,
    name: "Ada · 研究",
    id: "00000000-0000-4000-8000-000000000123",
  };
  assert.deepEqual(
    parseFilePermissionCursor(encodeFilePermissionCursor(key)),
    key,
  );
  for (const value of [
    null,
    "garbage",
    "x".repeat(3000),
    Buffer.from("{}").toString("base64url"),
    encodeFilePermissionCursor({ ...key, id: "'; DROP TABLE" }),
    encodeFilePermissionCursor({ ...key, rank: 10 }),
  ])
    assert.equal(parseFilePermissionCursor(value), null);
  assert.equal(normalizeFilePermissionOptions({ limit: 0 }).limit, 1);
  assert.equal(normalizeFilePermissionOptions({ limit: 10000 }).limit, 100);
  assert.equal(normalizeFilePermissionOptions({ limit: NaN }).limit, 100);
  assert.equal(
    normalizeFilePermissionOptions({ query: `  ${"a".repeat(300)}  ` }).query
      .length,
    160,
  );
  assert.equal(
    normalizeFilePermissionOptions({ permissionFilter: "disabled" })
      .permissionFilter,
    "disabled",
  );
});

test("pagination remains scoped to project capabilities with project-wide totals and explicit bulk scope", () => {
  const server = source("src/lib/workspaces/server/settings.ts");
  const read = server
    .split("export async function readFileAccessSettings")[1]!
    .split("export async function updateWorkspaceMemberFileUploadAction")[0]!;
  assert.match(read, /capabilityFromAccess[\s\S]*?"manage_files"/);
  assert.match(
    read,
    /conditions = \[eq\(workspaceMembers.projectId, projectId\)\]/,
  );
  assert.match(
    read,
    /\.where\(and\(\.\.\.conditions\)\)[\s\S]*?\.orderBy\(rank, name, workspaceMembers.userId\)/,
  );
  assert.match(read, /limit\(page.limit \+ 1\)/);
  assert.match(read, /nextCursor: hasMore && lastRow/);
  assert.match(
    read,
    /count\(\*\) filter[\s\S]*?\.where\(eq\(workspaceMembers.projectId, projectId\)\)/,
  );
  const members = source(
    "src/components/workspaces/settings/FileAccessMembers.tsx",
  );
  assert.match(members, /outside the current filter or loaded pages/);
  assert.match(members, /default for future members/);
  assert.match(members, /member.uploadPermissionLocked/);
});

test("independent drafts and pending states survive section navigation and unrelated refreshes", () => {
  const general = source(
    "src/components/workspaces/settings/GeneralSettingsSection.tsx",
  );
  assert.equal((general.match(/Save changes/g) ?? []).length, 1);
  assert.match(general, /if \(identityDirty\) return/);
  assert.match(general, /setSavedIdentity\(resetIdentityFromWorkspace/);
  const tab = source("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
  assert.match(tab, /key=\{props.projectId\}/);
  assert.match(tab, /savingAccess/);
  assert.match(tab, /savingRoles/);
  assert.match(tab, /savingNotifications/);
  assert.doesNotMatch(tab, /setSavingSettings/);
  assert.match(tab, /seq !== fileAccessRequestRef.current/);
  assert.match(tab, /!mountedRef.current/);
  assert.match(
    tab,
    /!projectNotificationData \|\| settingsErrors.notifications/,
  );
  assert.match(
    tab,
    /!readmeLoaded \|\| savingReadmeKey \|\| settingsErrors.readme/,
  );
});


test("inline workspace links preserve pending edits on refresh and recover from network failures", () => {
  const links = source("src/components/workspaces/dashboard/WorkspaceSocialLinksCard.tsx");
  const manager = links.split("const hasUnsavedChanges = changeCount > 0 || hasComposerDraft;")[1]!.split("const requestOpenChange")[0]!;
  assert.match(manager, /if \(mode === 'inline' && hasUnsavedChanges\) return/);
  assert.match(manager, /catch \(error\) \{[\s\S]*?setSaveError/);
  assert.match(manager, /finally \{[\s\S]*?setSaving\(false\)/);
});
