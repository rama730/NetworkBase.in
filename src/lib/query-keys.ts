import type { FilterView } from "@/constants/discover";
import type { DiscoverFilters } from "@/types/discover";

const asNullable = (value?: string | null) => value ?? null;
type WorkspaceTaskScope = "all" | "backlog" | "sprint" | "review" | "assignments" | "mine";

export const queryKeys = {
  sharing: {
    root: () => ['sharing'] as const,
    destinationsRoot: () => ["sharing", "destinations"] as const,
    destinations: (actorId: string | null, sessionId: string | null, scope: string, query: string) => ["sharing", "destinations", actorId, sessionId, scope, query] as const,
    destination: (actorId:string|null,sessionId:string|null,channelId:string) => ["sharing","destinations",actorId,sessionId,"selected",channelId] as const,
    preview: (url: string | null, viewerId: string | null, sessionId: string | null = null) => ['sharing', 'preview', viewerId, sessionId, url] as const,
    linksRoot: () => ['link-preview', 'v4'] as const,
    link: (url: string | null, viewerId: string | null, sessionId: string | null) => ['link-preview', 'v4', viewerId, sessionId, url] as const,
  },
  discover: {
    root: () => ["discover"] as const,
    projectsSimpleRoot: () => ["discover", "projects-simple"] as const,
    /** Per viewer: For you and Following differ by account. */
    projectsSimple: (viewerId: string | null, view: FilterView, filters: DiscoverFilters) =>
      ["discover", "projects-simple", asNullable(viewerId), view, filters] as const,
    userFollowedProjects: (userId: string | null | undefined) =>
      ["discover", "user-followed-projects", asNullable(userId)] as const,
    /** Where the viewer's own applications and invitations stand on the projects shown (a card chip). */
    myApplications: (userId: string | null | undefined) =>
      ["discover", "my-applications", asNullable(userId)] as const,
    /** Every Discover update feed (all views and filters): for patches that apply to whichever is loaded. */
    pulseRoot: () => ["discover", "pulse"] as const,
    /** The update cards mixed into the feed: pages of `DiscoverUpdatesPage`. */
    pulse: (viewerId: string | null, view: FilterView, filters: DiscoverFilters) =>
      ["discover", "pulse", asNullable(viewerId), view, filters] as const,
    /** One update opened from a link, when it isn't in a loaded page. */
    singleUpdate: (viewerId: string | null, updateId: string) =>
      ["discover", "update", asNullable(viewerId), updateId] as const,
  },
  /** Presence and status (people and projects). */
  presence: {
    root: () => ["presence"] as const,
    person: (userId: string) => ["presence", "person", userId] as const,
    mine: () => ["presence", "mine"] as const,
  },
  connections: {
    root: () => ["connections"] as const,
    pending: () => ["connections", "pending"] as const,
    invitationBrowse: (userId: string, query: { q: string; sort: string; direction: string; kind: string }) => ["connections", "pending", "browse", userId, query.q, query.sort, query.direction, query.kind] as const,
  },
  /** Slack-style chat. */
  chat: {
    root: () => ["chat-v3"] as const,
    bootstrap: (userId: string | null | undefined) => ["chat-v3", "bootstrap", asNullable(userId)] as const,
    channel: (channelId: string) => ["chat-v3", "channel", channelId] as const,
    messages: (channelId: string) => ["chat-v3", "messages", channelId] as const,
    target: (channelId: string, seq: number | null, userId: string | null) => ["chat-v3", "target", channelId, seq, userId] as const,
    thread: (channelId: string, rootSeq: number) => ["chat-v3", "thread", channelId, rootSeq] as const,
    members: (channelId: string) => ["chat-v3", "members", channelId] as const,
    pins: (channelId: string) => ["chat-v3", "pins", channelId] as const,
    canvas: (channelId: string) => ["chat-v3", "canvas", channelId] as const,
    projectCanvases: (projectId: string) => ["chat-v3", "project-canvases", projectId] as const,
    browse: (projectId: string) => ["chat-v3", "browse", projectId] as const,
    channelSearch: (query: string) => ["chat-v3", "channel-search", query] as const,
    card: (kind: string, refId: string) => ["chat-v3", "card", kind, refId] as const,
    activity: () => ["chat-v3", "activity"] as const,
    inbox: (filter: string) => ["chat-v3", "inbox", filter] as const,
    saved: () => ["chat-v3", "saved"] as const,
    savedSeqs: (channelId: string) => ["chat-v3", "saved-seqs", channelId] as const,
    scheduled: () => ["chat-v3", "scheduled"] as const,
    search: (params: string) => ["chat-v3", "search", params] as const,
    tabs: (channelId: string) => ["chat-v3", "tabs", channelId] as const,
    files: (channelId: string) => ["chat-v3", "files", channelId] as const,
    reactors: (channelId: string, seq: number) => ["chat-v3", "reactors", channelId, seq] as const,
    threads: () => ["chat-v3", "threads"] as const,
    people: (query: string) => ["chat-v3", "people", query] as const,
    taskSource: (taskId: string) => ["chat-v3", "task-source", taskId] as const,
  },
  profile: {
    root: () => ["profile"] as const,
    byTarget: (targetKey: string) => ["profile", targetKey] as const,
    connectionCount: (profileId: string) => ["profile", profileId, "connection-count"] as const,
    collaborationSummary: (userId: string) =>
      ["profile", "collaboration-summary", userId] as const,
    projects: (userId: string) => ["profile", "projects", userId] as const,
    sidebarProjects: (userId: string) => ["profile", "sidebar-projects", userId] as const,
    /** The left navigation's Workspaces (sidebar report G1); under profile, so profile-wide refreshes include it. */
    sidebarWorkspaces: (userId: string) => ["profile", "sidebar-workspaces", userId] as const,
    sidebarWorkspacesRoot: () => ["profile", "sidebar-workspaces"] as const,
    inviteOptions: (userId: string) =>
      ["profile", "project-invite-options", userId] as const,
    stats: (userId: string) => ["profile", "stats", userId] as const,
  },
  globalSearch: {
    root: () => ["global-search"] as const,
    previewsRoot: () => ["global-search", "previews"] as const,
    discoverRoot: () => ["global-search", "previews", "discover"] as const,
    networkRoot: () => ["global-search", "previews", "network"] as const,
    projectRoot: () => ["global-search", "previews", "project"] as const,
    preview: (
      context:
        | "discover"
        | "network"
        | "project"
        | "settings"
        | "messages"
        | "generic",
      peopleScope: "discover" | "network",
      projectIdentifier: string | null,
      query: string,
    ) =>
      [
        "global-search",
        "previews",
        context,
        peopleScope,
        projectIdentifier,
        query,
      ] as const,
  },
  project: {
    root: () => ["project"] as const,
    byId: (projectId: string) => ["project", projectId] as const,
    bySlug: (slug: string) => ["project", slug] as const,
    detail: {
      root: (projectId: string) => ["project", projectId, "detail"] as const,
      shell: (projectId: string) =>
        ["project", projectId, "detail", "shell"] as const,
      guidance: (projectId: string) =>
        ["project", projectId, "detail", "guidance"] as const,
      tasksRoot: (projectId: string) =>
        ["project", projectId, "detail", "tasks"] as const,
      tasks: (
        projectId: string,
        scope: WorkspaceTaskScope = "all",
        search = "",
      ) =>
        search
          ? (["project", projectId, "detail", "tasks", scope, search] as const)
          : (["project", projectId, "detail", "tasks", scope] as const),
      taskPanel: (
        projectId: string,
        taskId: string,
        section: "subtasks" | "comments" | "files" | "agent-notes" | "agent-presence",
      ) =>
        ["project", projectId, "detail", "task-panel", taskId, section] as const,
      sprintTasksRoot: (projectId: string) =>
        ["project", projectId, "detail", "sprint-tasks"] as const,
      sprintTasks: (projectId: string, sprintId: string) =>
        ["project", projectId, "detail", "sprint-tasks", sprintId] as const,
      sprintDetailRoot: (projectId: string) =>
        ["project", projectId, "detail", "sprint-detail"] as const,
      sprintDetail: (projectId: string, sprintId: string) =>
        ["project", projectId, "detail", "sprint-detail", sprintId] as const,
      sprintDetailShell: (projectId: string, sprintId: string | null) =>
        [
          "project",
          projectId,
          "detail",
          "sprint-detail",
          asNullable(sprintId),
          "shell",
        ] as const,
      sprintDetailSummary: (projectId: string, sprintId: string | null) =>
        [
          "project",
          projectId,
          "detail",
          "sprint-detail",
          asNullable(sprintId),
          "summary",
        ] as const,
      sprintTimeline: (projectId: string, sprintId: string | null) =>
        [
          "project",
          projectId,
          "detail",
          "sprint-detail",
          asNullable(sprintId),
          "timeline",
        ] as const,
      sprints: (projectId: string) =>
        ["project", projectId, "detail", "sprints"] as const,
      workflow: (projectId: string) =>
        ["project", projectId, "detail", "workflow"] as const,
      addedWorkflows: (projectId: string) =>
        ["project", projectId, "detail", "added-workflows"] as const,
      lastUpdate: (projectId: string) =>
        ["project", projectId, "detail", "last-update"] as const,
      recentActivity: (projectId: string) =>
        ["project", projectId, "detail", "recent-activity"] as const,
      readme: (projectId: string) =>
        ["project", projectId, "detail", "readme"] as const,
      readmeDraft: (projectId: string) =>
        ["project", projectId, "detail", "readme", "draft"] as const,
      readmeVersions: (projectId: string) =>
        ["project", projectId, "detail", "readme", "versions"] as const,
      readmeSettings: (projectId: string) =>
        ["project", projectId, "detail", "readme", "settings"] as const,
      readmeReferences: (projectId: string, kind: string, query: string) =>
        [
          "project",
          projectId,
          "detail",
          "readme",
          "references",
          kind,
          query,
        ] as const,
      readmeSmartBlockPreviews: (projectId: string, blockSignature: string) =>
        [
          "project",
          projectId,
          "detail",
          "readme",
          "smart-block-previews",
          blockSignature,
        ] as const,
      updates: (projectId: string) =>
        ["project", projectId, "detail", "updates"] as const,
      updateContextOptions: (projectId: string, kind: string, query: string) =>
        [
          "project",
          projectId,
          "detail",
          "updates",
          "context-options",
          kind,
          query,
        ] as const,
      updateDraft: (projectId: string, userId: string) =>
        ["project", projectId, "detail", "updates", "draft", userId] as const,
      updateComments: (
        projectId: string,
        updateId: string | null | undefined,
      ) =>
        [
          "project",
          projectId,
          "detail",
          "updates",
          asNullable(updateId),
          "comments",
        ] as const,
      updateLikes: (
        projectId: string,
        updateId: string | null | undefined,
      ) =>
        [
          "project",
          projectId,
          "detail",
          "updates",
          asNullable(updateId),
          "likes",
        ] as const,
      members: (projectId: string) =>
        ["project", projectId, "detail", "members"] as const,
      filesNodes: (projectId: string, parentId?: string | null) =>
        [
          "project",
          projectId,
          "detail",
          "files-nodes",
          asNullable(parentId),
        ] as const,
    },
  },
  settings: {
    root: () => ["settings"] as const,
    accountDeletion: () => ["settings", "account", "deletion-status"] as const,
    notifications: () => ["settings", "notifications"] as const,
    security: () => ["settings", "security"] as const,
    privacy: () => ["settings", "privacy"] as const,
    integrations: () => ["settings", "integrations"] as const,
    extensionSessions: () =>
      ["settings", "integrations", "extension-sessions"] as const,
  },
  notifications: {
    root: () => ["notifications"] as const,
    page: (limit: number) => ["notifications", "page", limit] as const,
    unreadCount: () => ["notifications", "unread-count"] as const,
  },
  myWork: {
    root: () => ["my-work"] as const,
    ideProjects: (userId: string | null) => ["my-work", "ide-projects", userId] as const,
    summary: () => ["my-work", "summary"] as const,
    /** Report 38.11 part 8 (A4.1b): meetings today; and the person's .ics link state. */
    meetingsToday: () => ["my-work", "meetings-today"] as const,
    meetingFeed: () => ["my-work", "meeting-feed"] as const,
    /** Report 34.4 (B5.3c): community events you're going to or waiting for, the next 14 days. */
    communityEvents: () => ["my-work", "community-events"] as const,
    goalCheckIns: () => ["my-work", "goal-check-ins"] as const,
    offsiteInvites: () => ["my-work", "offsite-invites"] as const,
    toReview: () => ["my-work", "to-review"] as const,
    members: () => ["my-work", "members"] as const,
    sprints: () => ["my-work", "sprints"] as const,
    tasks: (scope: "my" | "team" | "all" = "my", limit = 24) =>
      ["my-work", "tasks", scope, limit] as const,
    joinRequestsRoot: () => ["my-work", "joinRequests"] as const,
    joinRequests: (limit = 20) => ["my-work", "joinRequests", limit] as const,
    sentProjectInvitationsRoot: () => ["my-work", "sentProjectInvitations"] as const,
    sentProjectInvitations: (limit = 50) => ["my-work", "sentProjectInvitations", limit] as const,
  },
} as const;
