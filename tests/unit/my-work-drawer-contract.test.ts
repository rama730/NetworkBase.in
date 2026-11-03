import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

describe("My work drawer contracts", () => {
  it("uses the same incoming application source and row as Connections", () => {
    const requests = read("src/components/my-work/MyWorkRequestsTab.tsx");
    const drawer = read("src/components/my-work/MyWorkDrawer.tsx");

    assert.match(requests, /IncomingWorkspaceApplicationRow/);
    assert.match(requests, /RequestProfileRow/);
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
    assert.match(tasks, /MoreHorizontal/);
    assert.match(tasks, /z-\[202\]/);
    assert.match(tasks, /index === 0 \? taskFiltersMenu : null/);
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

  assert.match(drawer, /presentation="right-drawer"/);
  assert.match(drawer, /<DialogTitle[^>]*>\s*My work\s*<\/DialogTitle>/);
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
  assert.match(drawer, /className="nb-tab-count"/);
  assert.doesNotMatch(drawer, /(?:text|bg|border)-rose-/);
  assert.doesNotMatch(tasks, />Workspace Tasks</);
  assert.match(tasks, /groups\.map\(\(group, index\)/);
  assert.match(tasks, /API's urgency-aware task order/);
  assert.match(tasks, /grid-cols-1 gap-2/);
  assert.match(tasks, /Load more tasks/);
  assert.match(drawer, /px-4 pb-6 pt-2 pb-\[max\(1\.5rem,env\(safe-area-inset-bottom\)\)\] md:px-6/);
});
