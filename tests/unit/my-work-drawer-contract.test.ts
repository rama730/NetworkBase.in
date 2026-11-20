import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("My work drawer contracts", () => {
  it("uses the same incoming application source and row as Connections", () => {
    const requests = read("src/components/my-work/MyWorkRequestsTab.tsx");
    const drawer = read("src/components/my-work/MyWorkDrawer.tsx");

    // Shell redesign v3: one compact line per request (RequestRow), org requests in the same compact look.
    assert.match(requests, /function RequestRow/);
    assert.match(requests, /<OrgRequestsSection compact/);
    assert.match(requests, /usePendingRequests\(20, isMyWorkOpen && isActive, \{ includeSent: false \}\)/);
    assert.match(requests, /app\.isInvitation/);
    assert.match(requests, /queryKeys.myWork\.joinRequests\(20\)/);
    assert.match(requests, /getIncomingApplicationsAction\(\{ limit: 20 \}\)/);
    assert.match(requests, /View all invitations/);
    // Report §30.7: Invitations became Requests.
    assert.match(drawer, /label: "Requests"/);
    assert.match(drawer, /getMyWorkSummaryAction/);
    assert.match(drawer, /queryKeys.myWork\.summary\(\)/);
  });

  it("keeps task scope, status, and search filters in one overflow menu", () => {
    const tasks = read("src/components/my-work/MyWorkTasksTab.tsx");
    const drawer = read("src/components/my-work/MyWorkDrawer.tsx");

    assert.match(tasks, /DropdownMenuTrigger asChild/);
    assert.match(tasks, /aria-label="Filter tasks"/);
    assert.match(tasks, /DropdownMenuRadioGroup/);
    assert.match(tasks, /SlidersHorizontal/);
    assert.match(tasks, /z-\[202\]/);
    // The View menu lives inside the one search field; it also groups (time / workspace) and switches list or cards.
    assert.match(tasks, /<kbd aria-hidden="true">\/<\/kbd>\s*\{taskFiltersMenu\}/);
    assert.match(tasks, /By time/);
    assert.match(tasks, /By workspace/);
    assert.match(tasks, /Missing hand-ins/);
    assert.doesNotMatch(tasks, /absolute right-0 top-0/);
    assert.match(tasks, /resetScope = \(nextScope: MyWorkScope\)/);
    assert.match(tasks, /queryKeys.myWork\.tasks\(scope, limit\)/);
    assert.match(tasks, /Assigned to me/);
    assert.match(tasks, /Team tasks/);
    assert.match(tasks, /All open tasks/);
    assert.match(tasks, /useState<MyWorkScope>\("all"\)/);
    assert.match(tasks, /OPEN_STATUSES/);
    assert.match(tasks, /TASK_STATUS_PRESENTATION/);
    assert.match(tasks, /Search tasks or workspaces/);
    assert.doesNotMatch(tasks, /Virtuoso/);
  });

  it("opens My work tasks through the workspace panel without exposing drawer IDs", () => {
    const tasks = read("src/components/my-work/MyWorkTasksTab.tsx");
    const store = read("src/stores/ui-store.ts");
    const dashboard = read("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");

    assert.match(tasks, /createMyWorkTaskHandoff\(projectId, task\.id\)/);
    assert.match(tasks, /setMyWorkTaskHandoff\(handoff\)/);
    assert.match(tasks, /MY_WORK_TASK_HANDOFF_STORAGE_KEY/);
    assert.match(tasks, /setMyWorkOpen\(false\)/);
    assert.match(tasks, /router\.push\(`\/workspaces\/\$\{projectIdentifier\}\?tab=tasks`\)/);
    assert.doesNotMatch(tasks, /drawerType=task&drawerId=/);
    assert.doesNotMatch(tasks, /router\.prefetch/);
    assert.match(store, /myWorkTaskHandoff/);
    assert.match(dashboard, /initialTaskDrawerId \?\? myWorkInitialTaskId/);
    assert.match(dashboard, /onInitialTaskOpened=\{myWorkInitialTaskId \? consumeMyWorkTaskHandoff : undefined\}/);
    assert.match(dashboard, /Keep the handoff alive until TasksTab has actually opened the panel/);
    assert.match(dashboard, /sessionTaskHandoff/);
    assert.match(dashboard, /readMyWorkTaskHandoff/);
    assert.match(store, /MY_WORK_TASK_HANDOFF_MAX_AGE_MS/);
  });

  it("shows owner and member project tasks in team and all scopes", () => {
    const workspace = read("src/app/actions/my-work.ts");

    assert.match(workspace, /const visibleProjectCheck = exists/);
    assert.match(workspace, /eq\(workspaces\.ownerId, user\.id\)/);
    assert.match(workspace, /eq\(workspaceMembers\.userId, user\.id\)/);
    assert.match(workspace, /or\(isNull\(tasks\.assigneeId\), ne\(tasks\.assigneeId, user\.id\)\)/);
    assert.match(workspace, /scopeWhere = visibleProjectCheck/);
    assert.match(workspace, /scope: "my" \| "team" \| "all" = "all"/);
  });

  it("builds a PostgreSQL UUID array when enriching workspace task counts", () => {
    const workspace = read("src/app/actions/my-work.ts");

    assert.match(workspace, /const taskIdArray = sql`ARRAY\[/);
    assert.match(workspace, /taskIds\.map\(\(taskId\) => sql`\$\{taskId\}::uuid`\)/);
    assert.match(workspace, /SELECT unnest\(\$\{taskIdArray\}\) AS id/);
    assert.match(workspace, /WHERE task_id = ANY\(\$\{taskIdArray\}\)/);
    assert.doesNotMatch(workspace, /\$\{taskIds\}::uuid\[\]/);
  });

  it("keeps workspace refreshes scoped to task and request notifications", () => {
    const provider = read("src/components/providers/NetworkNotificationsProvider.tsx");

    assert.match(provider, /MY_WORK_NOTIFICATION_KINDS/);
    assert.match(provider, /event\.kind !== "notification"/);
    assert.match(provider, /task_assigned/);
    assert.match(provider, /application_received/);
    assert.match(provider, /connection_request_received/);
    assert.match(provider, /queryKeys.myWork\.root\(\)/);
    assert.match(provider, /myWorkInvalidationDomains/);
    assert.match(provider, /pendingInvalidationDomainsRef/);
  });

  it("uses shared lifecycle rows with contextual request controls", () => {
    const row = read("src/components/network/IncomingWorkspaceApplicationRow.tsx");
    const requests = read("src/components/my-work/MyWorkRequestsTab.tsx");

    assert.match(row, /Workspace invitation/);
    assert.match(row, /formatDistanceToNowStrict/);
    assert.match(row, /aria-label=\{`Accept/);
    assert.match(requests, /removeOptimistically/);
    assert.match(requests, /queryKeys\.notifications\.root\(\)/);
  });
});

it("keeps the drawer state and deep links on the same two-tab contract", () => {
  const drawer = read("src/components/my-work/MyWorkDrawer.tsx");
  const host = read("src/components/my-work/MyWorkDrawerHost.tsx");
  const store = read("src/stores/ui-store.ts");

  assert.match(drawer, /role="tab"/);
  assert.match(drawer, /aria-selected/);
  assert.match(drawer, /id="my-work-drawer"/);
  assert.match(host, /setMyWorkOpen\(true\)/);
  assert.match(host, /workspaceTab/);
  assert.match(host, /myWorkDeepLink/);
  assert.match(host, /router\.replace/);
  assert.match(host, /usePathname/);
  assert.match(host, /setMyWorkOpen, setMyWorkTab, myWorkDeepLink/);
  assert.match(store, /export type MyWorkTab = "tasks" \| "requests"/);
});

it("uses the shared drawer motion contract and concise workspace naming", () => {
  const drawer = read("src/components/my-work/MyWorkDrawer.tsx");
  const host = read("src/components/my-work/MyWorkDrawerHost.tsx");
  const indicator = read("src/components/layout/header/MyWorkIndicator.tsx");

  // Shell redesign v3: a panel beside the sidebar; only the page dims, and nothing dims when pinned.
  assert.match(drawer, /className="nb-mw"/);
  assert.match(drawer, /modal=\{!pinned\}/);
  assert.match(drawer, /pinned \? null : <DialogPrimitive\.Overlay className="nb-mw-scrim"/);
  assert.match(drawer, /<DialogPrimitive\.Title[^>]*>My work<\/DialogPrimitive\.Title>/);
  assert.match(host, /const \[hasMounted, setHasMounted\]/);
  assert.match(host, /return hasMounted \? <MyWorkDrawer \/> : null/);
  assert.match(indicator, />\s*My work\s*</);
  assert.doesNotMatch(indicator, /PanelRightOpen/);
});

it("keeps actionable workspace state visible without task-tab scaffolding", () => {
  const indicator = read("src/components/layout/header/MyWorkIndicator.tsx");
  const tasks = read("src/components/my-work/MyWorkTasksTab.tsx");
  const drawer = read("src/components/my-work/MyWorkDrawer.tsx");

  assert.match(indicator, /readShellPart\("myWorkSummary"\)/);
  assert.match(indicator, /useNetworkNotifications/);
  assert.match(indicator, /summary\.taskCount \+ summary\.requestCount \+ pendingConnections/);
  assert.match(indicator, /className="nb-nav-count"/);
  assert.doesNotMatch(indicator, /(?:text|bg)-rose-/);
  assert.match(indicator, /<ListChecks size=\{16\}/);
  assert.match(indicator, /actionCount/);
  assert.match(drawer, /useNetworkNotifications/);
  assert.match(drawer, /summary\.requestCount : 0\) \+ pendingConnections/);
  assert.doesNotMatch(drawer, /needsAttention/);
  assert.match(drawer, /className="nb-mw-n"/);
  assert.doesNotMatch(drawer, /(?:text|bg|border)-rose-/);
  assert.doesNotMatch(tasks, />Workspace Tasks</);
  assert.match(tasks, /groups\.map\(\(group, index\)/);
  assert.match(tasks, /API's urgency-aware task order/);
  assert.match(tasks, /grid-cols-1 gap-2/);
  assert.match(tasks, /Load more tasks/);
  assert.match(drawer, /className="nb-mw-body"/);
  assert.match(drawer, /className="nb-mw-foot"/);
});

it("finishes work in place and reads the week from the same list (shell redesign v3)", () => {
  const tasks = read("src/components/my-work/MyWorkTasksTab.tsx");
  const drawer = read("src/components/my-work/MyWorkDrawer.tsx");
  const css = read("src/app/globals.css");

  // Status and due date change through the existing task actions, each with Undo.
  assert.match(tasks, /updateTaskStatusAction\(task\.id, to, projectId\)/);
  assert.match(tasks, /updateTaskFieldAction\(task\.id, "dueDate", to, projectId\)/);
  assert.match(tasks, /label: "Undo"/);
  assert.match(tasks, /pickNextUp\(/);
  assert.match(tasks, /BUCKETS\.map/);
  assert.match(tasks, /event\.key === "e" \|\| event\.key === "E"/);
  assert.match(tasks, /if \(pinned\) setTimeout\(\(\) => setIsNavigating\(false\), 600\);\s*else setMyWorkOpen\(false\);/);
  assert.match(drawer, /weekColumns\(todayKey\)/);
  assert.match(drawer, /useTypedPath\(target, 22\)/);
  // The code editor is footer cells and one sheet inside the panel; Esc closes the sheet before the panel.
  assert.match(drawer, /<MyWorkEditor open=\{editorOpen\} onOpenChange=\{setEditorOpen\} \/>/);
  assert.match(drawer, /onEscapeKeyDown=\{\(event\) => \{ if \(editorOpen\) \{ event\.preventDefault\(\); setEditorOpen\(false\); \} \}\}/);
  const editor = read("src/components/my-work/MyWorkEditor.tsx");
  assert.match(editor, /aria-label=\{`Open in \$\{active\.name\}`\}/);
  assert.match(editor, /<span className="t">\{active\.name\}<\/span>/);
  assert.match(editor, /aria-label="Choose a workspace"/);
  assert.match(editor, /aria-label="Desktop editor picker"/);
  assert.doesNotMatch(editor, /bg-\[var\(--status-success\)\]/);
  // No coloured edge on the Next up card; a picked day fills.
  assert.match(css, /\.nb-mw-next \{ display:grid; gap:12px; padding:14px; border:1px solid var\(--border\); border-radius:8px; background:var\(--card\); \}/);
  assert.match(css, /\.nb-mw-col\[aria-pressed="true"\] \{ background:var\(--text-inverse\)/);
});
