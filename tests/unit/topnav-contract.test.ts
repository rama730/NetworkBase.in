import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { settingsTabHref } from "@/constants/routes";
import { projectActionsSource } from "./_workspace-actions-source";
import {
  buildGlobalSearchClearHref,
  buildGlobalSearchHref,
  getGlobalSearchQuery,
  getGlobalSearchRecentScope,
  getWorkspaceIdentifierFromPathname,
  isWorkspaceDetailPath,
  mergeRecentGlobalSearches,
  readRecentGlobalSearches,
  removeRecentGlobalSearch,
  rememberRecentGlobalSearch,
  rememberRecentGlobalSearchPreview,
  resolveGlobalSearchContext,
  searchSettings,
  type RecentGlobalSearchItem,
} from "@/components/layout/header/global-search";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("top-nav routes use tabbed settings and correctly classify project detail routes", () => {
  assert.equal(settingsTabHref("notifications"), "/settings?tab=notifications");
  assert.equal(isWorkspaceDetailPath("/workspaces/new"), false);
  assert.equal(isWorkspaceDetailPath("/workspaces/deepscope-ai"), true);
  assert.equal(getWorkspaceIdentifierFromPathname("/workspaces/deepscope-ai"), "deepscope-ai");
  assert.equal(getWorkspaceIdentifierFromPathname("/workspaces/new"), null);
  assert.equal(resolveGlobalSearchContext("/workspaces/new").context, "default");
  assert.equal(resolveGlobalSearchContext("/workspaces/deepscope-ai").context, "project");
  assert.equal(resolveGlobalSearchContext("/settings").context, "settings");
  assert.equal(resolveGlobalSearchContext("/messages").context, "messages");
});

test("global-search preserves unrelated filters and only resets task pagination", () => {
  assert.equal(
    buildGlobalSearchClearHref({
      pathname: "/discover",
      searchParams: new URLSearchParams("q=react&tech=GitHub&type=startup&sort=popular"),
      context: "discover",
    }),
    // Discover's skills are filters with their own tags: clearing the search keeps them.
    "/discover?tech=GitHub&type=startup&sort=popular",
  );
  assert.equal(
    buildGlobalSearchClearHref({
      pathname: "/workspaces/deepscope-ai",
      searchParams: new URLSearchParams("tab=docs&search=design&page=4"),
      context: "project",
    }),
    "/workspaces/deepscope-ai?tab=docs&page=4",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/workspaces/deepscope-ai",
      searchParams: new URLSearchParams("tab=docs&page=4"),
      context: "project",
      query: "roadmap",
    }),
    "/workspaces/deepscope-ai?tab=tasks&page=1&search=roadmap",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/network",
      searchParams: new URLSearchParams("tab=requests"),
      context: "network",
      query: "TypeScript",
    }),
    "/network?tab=suggested&q=TypeScript",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/network",
      searchParams: new URLSearchParams("tab=network"),
      context: "network",
      query: "Ramanayudu",
    }),
    "/network?tab=network&q=Ramanayudu",
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/messages",
      searchParams: new URLSearchParams(),
      context: "messages",
      query: "roadmap",
    }),
    null,
  );
  assert.equal(
    buildGlobalSearchHref({
      pathname: "/my-profile",
      searchParams: new URLSearchParams("edit=true"),
      context: "default",
      query: "design systems",
    }),
    "/discover?q=design+systems",
  );
});

test("global-search shows only the text search on Discover (skills are filter tags there)", () => {
  assert.equal(getGlobalSearchQuery(new URLSearchParams("tech=GitHub"), "discover"), "");
  assert.equal(getGlobalSearchQuery(new URLSearchParams("tech=GitHub,React"), "default"), "GitHub, React");
  assert.equal(getGlobalSearchQuery(new URLSearchParams("q=pony&tech=GitHub"), "discover"), "pony");
  assert.equal(
    buildGlobalSearchClearHref({
      pathname: "/discover",
      searchParams: new URLSearchParams("tech=GitHub&type=startup"),
      context: "default",
    }),
    "/discover?type=startup",
  );
});

test("recent global searches are scoped, deduplicated, and bounded", () => {
  assert.equal(getGlobalSearchRecentScope("default", "discover", null), "discover");
  assert.equal(getGlobalSearchRecentScope("discover", "discover", null), "discover");
  assert.equal(getGlobalSearchRecentScope("network", "network", null), "network:network");
  assert.equal(getGlobalSearchRecentScope("project", "discover", "deepscope-ai"), "project:deepscope-ai");
  const query = (value: string): RecentGlobalSearchItem => ({ kind: "query", key: `query:${value.toLowerCase()}`, label: value, query: value });
  assert.deepEqual(mergeRecentGlobalSearches([query("React"), query("GitHub")], query("react")), [query("react"), query("GitHub")]);
  assert.deepEqual(mergeRecentGlobalSearches(["a", "b", "c", "d", "e"].map(query), query("f")), ["f", "a", "b", "c", "d"].map(query));
});

test("recent global-search storage isolates users and contexts and tolerates malformed data", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });

  try {
    rememberRecentGlobalSearch("alice", "discover", "React");
    rememberRecentGlobalSearch("alice", "discover", "GitHub");
    rememberRecentGlobalSearch("alice", "network:discover", "Lakshmi");
    rememberRecentGlobalSearch("bob", "discover", "Supabase");

    assert.deepEqual(readRecentGlobalSearches("alice", "discover").map((item) => item.label), ["GitHub", "React"]);
    assert.deepEqual(readRecentGlobalSearches("alice", "network:discover").map((item) => item.label), ["Lakshmi"]);
    assert.deepEqual(readRecentGlobalSearches("bob", "discover").map((item) => item.label), ["Supabase"]);
    assert.deepEqual(readRecentGlobalSearches("", "discover"), []);

    assert.deepEqual(removeRecentGlobalSearch("alice", "discover", "query:github").map((item) => item.label), ["React"]);
    assert.deepEqual(readRecentGlobalSearches("alice", "discover").map((item) => item.label), ["React"]);
    assert.deepEqual(removeRecentGlobalSearch("alice", "network:discover", "missing").map((item) => item.label), ["Lakshmi"]);

    const preview = { id: "project:ponytail", title: "Ponytail", kind: "project" as const, href: "/workspaces/ponytail" };
    rememberRecentGlobalSearchPreview("alice", "discover", preview);
    const selected = readRecentGlobalSearches("alice", "discover")[0];
    assert.equal(selected?.kind, "preview");
    assert.equal(selected?.label, "Ponytail");
    assert.deepEqual(selected?.kind === "preview" ? selected.preview : null, preview);

    storage.set("nb:global-search:recent:v1:broken", "{");
    assert.deepEqual(readRecentGlobalSearches("broken", "discover"), []);

    storage.set("nb:global-search:recent:v1:legacy", JSON.stringify({ discover: ["React"] }));
    assert.equal(readRecentGlobalSearches("legacy", "discover")[0]?.label, "React");
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("settings search resolves user intent to the canonical tabbed settings route", () => {
  assert.equal(searchSettings("change color theme")[0]?.id, "theme");
  assert.equal(searchSettings("VS Code disconnect")[0]?.href, "/settings#settings-integrations-editors");
  assert.equal(searchSettings("").length, 6);
});

test("top-nav keeps one accessible, route-aligned implementation", () => {
  const topNav = source("src/components/layout/header/TopNav.tsx");
  const mobileMenu = source("src/components/layout/header/MobileMenu.tsx");
  const notifications = source("src/components/layout/header/NotificationPreview.tsx");
  const runtime = source("src/components/providers/MainRuntimeProviders.tsx");
  const realtime = source("src/lib/realtime/subscriptions.ts");
  const chat = source("src/components/providers/PresenceProvider.tsx");
  const layout = source("src/components/layout/MainLayout.tsx");
  const notificationActions = source("src/app/actions/notifications.ts");
  const people = source("src/components/network/NetworkClient.tsx");
  const discoverPeople = source("src/components/network/NetworkPeopleTab.tsx");
  const networkPeople = source("src/components/network/ConnectionsClient.tsx");
  const taskAction = projectActionsSource();
  const commandPalette = source("src/components/layout/header/CommandPalette.tsx");
  const globalSearch = source("src/components/layout/header/GlobalSearch.tsx");
  const globalSearchContract = source("src/components/layout/header/global-search.ts");
  const searchPreviews = source("src/hooks/useGlobalSearchPreviews.ts");
  const connectionsHook = source("src/hooks/useConnections.ts");
  const connectionsAction = source("src/app/actions/connections.ts");
  const personCard = source("src/components/network/PersonCard.tsx");
  const personContent = source("src/components/network/PersonCardContent.tsx");
  const resultCards = source("src/components/layout/header/GlobalSearchResultCards.tsx");
  const hubData = source("src/lib/data/discover.ts");
  const globals = source("src/app/globals.css");

  assert.match(topNav, /e\.key\.toLowerCase\(\) === "k"/);
  assert.match(topNav, /useChatUi\.getState\(\)\.setSwitcherOpen\(true\)/);
  assert.match(topNav, /\[data-messages-surface\]/);
  assert.doesNotMatch(topNav, /OPEN_MESSAGES_SEARCH_EVENT|open-messages-local-search/);
  assert.match(source("src/components/layout/AppSidebar.tsx"), /MAIN_NAV_ITEMS/);
  assert.match(topNav, /hidden min-w-0 flex-1 items-center md:flex/);
  assert.match(topNav, /<div className="md:hidden">\s*<Logo/);
  // The label also says when there are unread messages (the dot alone isn't heard; round 3 #92).
  assert.match(topNav, /className="nb-mobile-menu-trigger[^\"]*md:hidden"\s+aria-label=\{chatUnread \? "Open mobile menu, unread messages" : "Open mobile menu"\}/);
  assert.match(globals, /@media \(min-width:768px\) \{[\s\S]*?\.nb-mobile-menu-trigger \{ display:none; \}/);
  assert.doesNotMatch(topNav, /createProject=1/);
  assert.match(topNav, /href="\/workspaces\/new"/);
  assert.match(topNav, /className="flex shrink-0 items-center gap-2"/);
  assert.match(topNav, /recentSearchOwnerId=\{user\?\.id\}/);
  assert.match(mobileMenu, /<Dialog open=\{props\.isOpen\}/);
  assert.match(mobileMenu, /p-4 md:hidden/);
  // Mobile quick nav renders the sidebar's own nav body so destinations, order and counts cannot drift.
  assert.match(mobileMenu, /import \{ SidebarNav \} from "@\/components\/layout\/AppSidebar"/);
  assert.match(mobileMenu, /<SidebarNav \/>/);
  assert.match(source("src/components/layout/AppSidebar.tsx"), /<SidebarNav \/>/);
  assert.match(notifications, /href=\{settingsTabHref\("notifications"\)\}/);
  assert.match(notifications, /onItemsViewed/);
  assert.match(notifications, /data-\[state=open\]/);
  assert.doesNotMatch(notifications, /Mark all read/);
  assert.match(runtime, /<NetworkNotificationsProvider>/);
  assert.doesNotMatch(runtime, /PresencePublisher|startPresenceHeartbeat/);
  assert.match(realtime, /resourceType: 'profile'/);
  assert.doesNotMatch(realtime, /table: 'tasks'/);
  assert.match(chat, /usePublishOnlinePresence\(\)/);
  assert.match(layout, /MyWorkDrawerHost/);
  assert.match(people, /searchParams\?\.get\("q"\)/);
  assert.match(people, /searchQuery=\{routeQuery\}/);
  assert.doesNotMatch(discoverPeople, /type="search"|Search people by name/);
  assert.doesNotMatch(networkPeople, /type="search"|Search your connections/);
  assert.match(taskAction, /project-task-search/);
  assert.match(taskAction, /ilike\(t\.title, searchPattern\)/);
  assert.match(commandPalette, /Skills in these workspaces/);
  assert.match(commandPalette, /<SkillIcon skill=\{resolveClientSkill\(result\.title\)\}/);
  assert.match(commandPalette, /<AppScrollArea axis="x" variant="hidden"/);
  assert.match(commandPalette, /shrink-0 items-center/);
  assert.match(commandPalette, /<form onSubmit=\{handleSubmit\} className="flex min-h-0 min-w-0/);
  assert.match(commandPalette, /People results/);
  assert.match(commandPalette, /Task search results/);
  assert.match(commandPalette, /SearchSkeletons/);
  assert.match(commandPalette, /Search is temporarily paused/);
  assert.match(commandPalette, /h-dvh w-screen/);
  assert.match(commandPalette, /aria-activedescendant/);
  assert.match(commandPalette, /data-testid="global-search-enter-hint"/);
  assert.match(commandPalette, /const palettePlaceholder = `Search \$\{presentation\.label\}…`/);
  assert.match(commandPalette, /normalizedQuery \? \(/);
  assert.match(commandPalette, /<kbd>Esc<\/kbd>/);
  assert.match(commandPalette, /Recent searches/);
  assert.match(commandPalette, /readRecentGlobalSearches/);
  assert.match(commandPalette, /rememberRecentGlobalSearch/);
  assert.match(commandPalette, /rememberRecentGlobalSearchPreview/);
  assert.match(commandPalette, /removeRecentGlobalSearch/);
  assert.match(commandPalette, /Remove \$\{recent\.label\} from recent searches/);
  assert.match(commandPalette, /sm:group-hover:opacity-100/);
  assert.doesNotMatch(commandPalette, /<DialogHeader|ContextIcon|ChevronLeft/);
  assert.match(commandPalette, /press Enter to run the full search/);
  assert.doesNotMatch(commandPalette, /↑↓.*Navigate|Search all “|Enter a search term/);
  assert.match(globalSearch, /h-\[var\(--ui-control-height\)\] w-60 lg:w-80/);
  assert.doesNotMatch(globalSearch, /hover:w-/);
  assert.match(globalSearchContract, /searchParams\.get\("tech"\)/);
  assert.match(globalSearchContract, /params\.delete\("tech"\)/);
  assert.match(globalSearchContract, /MAX_RECENT_GLOBAL_SEARCHES = 5/);
  assert.match(globalSearchContract, /nb:global-search:recent:v1/);
  assert.match(resultCards, /WorkspaceSearchResultCard/);
  assert.match(resultCards, /ProfileSearchResultCard/);
  assert.match(resultCards, /Connect with \$\{result\.title\}/);
  assert.match(resultCards, /result\.connectionStatus === "none" && result\.canConnect/);
  assert.match(commandPalette, /useConnectionMutations\(\)/);
  assert.match(commandPalette, /getConnectionRequestSuccessMessage/);
  assert.match(searchPreviews, /userId: profile\.id/);
  assert.match(connectionsHook, /queryKeys\.globalSearch\.networkRoot\(\)/);
  assert.match(discoverPeople, /getConnectionRequestSuccessMessage/);
  assert.match(resultCards, /TaskSearchResultCard/);
  assert.match(resultCards, /SettingsSearchResultCard/);
  assert.match(resultCards, /SkillIconRail/);
  assert.match(resultCards, /border-zinc-300 bg-zinc-50 shadow-none/);
  assert.doesNotMatch(resultCards, /border-primary\/25 bg-primary/);
  assert.doesNotMatch(resultCards, /FolderKanban/);
  assert.doesNotMatch(resultCards, /taskCode\.split/);
  assert.doesNotMatch(resultCards, /identity=\{result\.assignee\}/);
  assert.doesNotMatch(resultCards, /h-7 w-7 items-center justify-center rounded-md border/);
  assert.doesNotMatch(resultCards, /rounded-md bg-zinc-100 px-1 text-\[10px\].*\+\{hidden\}/);
  assert.match(resultCards, /followersCount\.toLocaleString\(\).*following/);
  assert.match(resultCards, /viewCount\.toLocaleString\(\)/);
  assert.match(resultCards, /connectedFriends\.map/);
  assert.match(resultCards, /more connection/);
  assert.match(hubData, /row_number\(\) over/);
  assert.match(hubData, /lte\(rankedConnectedMembers\.connectionRank, 3\)/);
  assert.match(hubData, /eq\(connections\.status, 'accepted'\)/);
  assert.match(hubData, /connectedFriend/);
  assert.match(hubData, /acceptedRoleTitle/);
  assert.match(hubData, /Owner \/ /);
  assert.match(hubData, /connectionRank/);
  assert.match(searchPreviews, /fetchDiscoverWorkspacesAction/);
  assert.match(searchPreviews, /getConnectionsFeed/);
  assert.match(searchPreviews, /fetchWorkspaceTaskPreviewsAction/);
  assert.match(connectionsAction, /accepted_connection\.status = 'accepted'/);
  assert.match(connectionsAction, /app_private\.blocked_between\(/);
  assert.match(connectionsAction, /applySuggestedProfilePrivacy\(user\.id, items\)/);
  assert.doesNotMatch(personCard, /onDismiss/);
  // Shared wording (lib/connections/copy): "1 shared connection", "3 mutual connections".
  assert.match(personContent, /CONNECTION_COPY\.shared\(/);
  // Approved person cards share fixed geometry, with truthful subtitle and labelled context.
  for (const card of [personCard, networkPeople]) {
    assert.doesNotMatch(card, /h-\[168px\]|min-h-\[158px\]|VirtuosoGrid/);
    assert.doesNotMatch(card, /\|\| "NetworkBase member"<\/p>/);
  }
  assert.match(personCard, /<PersonCardContent/);
  assert.match(networkPeople, /<PersonCardContent/);
  assert.match(personContent, /personCardSubtitle\(person\)/);
  assert.match(personContent, /title=\{name\} dir="auto">\{name\}/);
  assert.match(personContent, /<PersonPresenceDot/);
  assert.match(personContent, /<MapPin className="size-3\.5 shrink-0"/);
  assert.match(personContent, /title=\{value\}/);
  assert.match(personContent, /<PersonCardSkillStrip/);
  assert.match(networkPeople, /<DropdownMenuItem asChild>/);
  assert.doesNotMatch(networkPeople, /className="nb-icon-button size-9/);
  assert.doesNotMatch(networkPeople, /<h3 className="truncate/);
  assert.match(searchPreviews, /query\.trim\(\)\.length <= 3 \? 450 : 250/);
  assert.match(searchPreviews, /debouncedQuery\.length >= 2/);
  assert.match(searchPreviews, /previewContext === "discover" \? 60_000/);
  assert.match(searchPreviews, /queryKeys\.globalSearch\.preview/);
  assert.match(searchPreviews, /isDebouncing/);
  assert.match(searchPreviews, /refetchOnWindowFocus: false/);
  assert.match(taskAction, /fetchProjectTasksForActor/);
  assert.match(taskAction, /projectTaskPreviewInputSchema/);
  assert.match(taskAction, /taskNumberSearch/);
  assert.doesNotMatch(searchPreviews, /fetch\("\/api\//);
  assert.match(connectionsAction, /jsonb_array_elements_text/);
  assert.match(connectionsAction, /jsonb_typeof\(\$\{profiles\.skills\}\) = 'array'/);
  assert.doesNotMatch(connectionsAction, /profiles\.skills\}::text\[\]/);
  assert.match(connectionsAction, /Search must cover every eligible profile/);
  assert.match(connectionsAction, /isNull\(profiles\.deletedAt\)/);
  assert.match(connectionsAction, /searchFallbackNextCursor/);
  assert.match(connectionsAction, /idColumn: profiles\.id/);
  assert.doesNotMatch(connectionsAction, /filters: z\.any|historyFilters: z\.any/);
  assert.doesNotMatch(topNav, /target instanceof HTMLInputElement/);
  assert.doesNotMatch(notificationActions, /@\/app\/actions\/messaging\/_all/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "src/components/layout/MobileNav.tsx")), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), "src/components/layout/header/ProfileMenu.tsx")), false);
});
