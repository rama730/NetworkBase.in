import { ACCESS_LEVEL_LABELS, WORKSPACE_TAB_LABELS } from "@/lib/copy/terms";
import { WORKFLOW_CATALOG } from "@/lib/workflows/catalog";
import {
  formatWorkspaceVisibility,
  normalizeWorkspaceVisibility as normalizeCanonicalProjectVisibility,
  type WorkspaceVisibility,
} from "@/lib/workspaces/workspace-visibility";

export type WorkspaceSettingsVisibility = WorkspaceVisibility;

export type WorkspaceSettingsSectionId =
  | "you"
  | "general"
  | "links"
  | "access"
  | "collaborators"
  | "roles-applications"
  | "role-abilities"
  | "tasks-workflow"
  | "files-workspace"
  | "ai-agents"
  | "readme"
  | "updates"
  | "notifications"
  | "privacy-policies"
  | "privacy-terms"
  | "danger"
  // Organizations only (report §21.2–21.3).
  | "you-membership"
  | "org-profile"
  | "org-access"
  | "org-people"
  | "org-projects"
  | "org-work"
  | "org-updates"
  | "org-messages"
  | "org-storage"
  | "org-moderation"
  | "org-allowed"
  | "org-management"
  | "child-org";

type ProjectSettingsSectionDefinition = {
  id: WorkspaceSettingsSectionId;
  label: string;
  description: string;
};

export type WorkspaceSettingsMember = {
  id: string;
  fullName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  membershipRole?: "owner" | "admin" | "member" | "viewer" | string | null;
  projectRoleTitle?: string | null;
  joinedAt?: string | null;
  fileUploadEnabled?: boolean | null;
  responsibilityCounts?: WorkspaceMemberResponsibilityCounts | null;
  /** Child projects of an org (report §21.6 #5): the person's unit, and the org's name when they're not in it. */
  unitTitle?: string | null;
  outsideOf?: string | null;
  /** Member settings §3: their part here is completed (read-only member). */
  completion?: { at: string; note: string | null; byOwner: boolean; confirmed: boolean } | null;
};

export type WorkspaceMemberRole = "owner" | "admin" | "member" | "viewer";

export type WorkspacePublicTabId =
  | "dashboard"
  | "readme"
  | "updates"
  | "sprints"
  | "tasks"
  | "files";

export type WorkspacePublicTabVisibility = Record<WorkspacePublicTabId, boolean>;

export type WorkspaceMemberCapability =
  | "transfer_ownership"
  | "archive_project"
  | "delete_project"
  | "manage_settings"
  | "manage_public_tabs"
  | "manage_notifications"
  | "manage_collaborators"
  | "manage_roles_applications"
  | "manage_tasks"
  | "manage_files"
  | "review_applications"
  | "assign_tasks"
  | "create_tasks"
  | "upload_files"
  | "comment"
  | "merge_task";

export type WorkspaceMemberEligibility = "mention" | "assign" | "review";

export type WorkspaceMemberResponsibilityCounts = {
  activeAssignedTasks: number;
  activeCreatedTasks: number;
  fileReviews: number;
  acceptedApplications: number;
  projectGroupParticipant: boolean;
};

export type WorkspacePersonReferenceState =
  | "active_member"
  | "owner"
  | "co_leader"
  | "viewer"
  | "pending_invite"
  | "former_member"
  | "lost_access"
  | "deactivated_user"
  | "unknown_user"
  | "external_user";

export type WorkspacePersonReference = {
  id: string | null;
  displayName: string;
  avatarUrl: string | null;
  roleLabel: string;
  subtext: string | null;
  state: WorkspacePersonReferenceState;
  isAssignable: boolean;
  isMentionable: boolean;
  canOpenProfile: boolean;
};

type ProjectSettingsPreflightInput = {
  status?: "draft" | "active" | "completed" | "archived" | string | null;
  openRolesCount?: number | null;
  pendingApplicationsCount?: number | null;
  activeTasksCount?: number | null;
  canArchive?: boolean | null;
  canDelete?: boolean | null;
};

type ProjectAccessImpactInput = {
  visibility?: unknown;
  membersCount?: number | null;
  followersCount?: number | null;
  openRolesCount?: number | null;
  pendingApplicationsCount?: number | null;
  activeTasksCount?: number | null;
};

type ProjectAccessTransitionInput = ProjectAccessImpactInput & {
  previousVisibility?: unknown;
  nextVisibility?: unknown;
  hasManagedProjectImage?: boolean | null;
};

type ProjectMemberRemovalPreflightInput = {
  member?: WorkspaceSettingsMember | null;
  visibility?: unknown;
  activeAssignedTasks?: number | null;
  activeCreatedTasks?: number | null;
  fileReviews?: number | null;
  acceptedApplications?: number | null;
  projectGroupParticipant?: boolean | null;
};

/** Decision 1: one ladder, the stored words (src/lib/copy/terms.ts). */
export const WORKSPACE_MEMBER_ROLE_LABELS: Record<WorkspaceMemberRole, string> = ACCESS_LEVEL_LABELS;

export const WORKSPACE_MEMBER_ROLE_CAPABILITIES: Record<
  WorkspaceMemberRole,
  WorkspaceMemberCapability[]
> = {
  owner: [
    "transfer_ownership",
    "archive_project",
    "delete_project",
    "manage_settings",
    "manage_public_tabs",
    "manage_notifications",
    "manage_collaborators",
    "manage_roles_applications",
    "manage_tasks",
    "manage_files",
    "review_applications",
    "assign_tasks",
    "create_tasks",
    "upload_files",
    "comment",
    "merge_task",
  ],
  admin: [
    "manage_public_tabs",
    "manage_notifications",
    "manage_collaborators",
    "manage_roles_applications",
    "manage_tasks",
    "manage_files",
    "review_applications",
    "assign_tasks",
    "create_tasks",
    "upload_files",
    "comment",
    "merge_task",
  ],
  member: ["assign_tasks", "create_tasks", "upload_files", "comment"],
  viewer: ["comment"],
};

export const DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY: WorkspacePublicTabVisibility =
  {
    dashboard: true,
    readme: true,
    updates: true,
    files: true,
    sprints: false,
    tasks: false,
  };

export const WORKSPACE_PUBLIC_TAB_LABELS: Record<WorkspacePublicTabId, string> = {
  dashboard: WORKSPACE_TAB_LABELS.dashboard,
  readme: WORKSPACE_TAB_LABELS.readme,
  updates: "Updates",
  files: "Files",
  sprints: "Sprints",
  tasks: "Tasks",
};

export const WORKSPACE_PUBLIC_TAB_DESCRIPTIONS: Record<
  WorkspacePublicTabId,
  string
> = {
  dashboard:
    "Public workspace overview, summary, roles, team preview, and high-level progress.",
  readme:
    "Published workspace documentation, setup notes, screenshots, commands, and contribution guidance.",
  updates:
    "Public progress posts, milestone notes, releases, blockers, and follower-facing discussion.",
  files:
    "Public workspace files and shared workspace materials that are safe for visitors.",
  sprints:
    "Sprint history and planning details, usually best kept member-only.",
  tasks:
    "Task board and work execution details, usually best kept member-only.",
};

export function normalizeWorkspaceMemberRole(
  value: unknown,
  fallback: WorkspaceMemberRole = "member",
): WorkspaceMemberRole {
  return value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
    ? value
    : fallback;
}

export function getWorkspaceMemberRoleLabel(role: unknown) {
  return (
    WORKSPACE_MEMBER_ROLE_LABELS[normalizeWorkspaceMemberRole(role)] ?? "Member"
  );
}

export function formatWorkspaceTeamRole(input: {
  membershipRole: unknown;
  projectRoleTitle?: string | null;
  leadFocus?: string | null;
}) {
  const membershipRole = normalizeWorkspaceMemberRole(input.membershipRole);
  const membershipLabel = WORKSPACE_MEMBER_ROLE_LABELS[membershipRole];
  const projectRoleTitle = input.projectRoleTitle?.trim() || "";
  const leadFocus = input.leadFocus?.trim() || "";
  const genericTitles: Record<WorkspaceMemberRole, string[]> = {
    owner: ["owner", "lead", "leader"],
    admin: ["admin", "co-lead", "co-leader"],
    member: ["member"],
    viewer: ["viewer"],
  };
  const specificRole = genericTitles[membershipRole].includes(
    projectRoleTitle.toLowerCase(),
  )
    ? ""
    : projectRoleTitle;

  if (membershipRole === "owner") {
    const role = leadFocus || specificRole;
    return role ? `${role} · ${membershipLabel}` : membershipLabel;
  }

  return specificRole
    ? `${specificRole} · ${membershipLabel}`
    : membershipLabel;
}

export function projectMemberCan(
  role: unknown,
  capability: WorkspaceMemberCapability,
) {
  return WORKSPACE_MEMBER_ROLE_CAPABILITIES[
    normalizeWorkspaceMemberRole(role)
  ].includes(capability);
}

export function canWorkspaceMemberUploadFiles(input: {
  role?: unknown;
  fileUploadEnabled?: boolean | null;
}) {
  const role = input.role;
  if (role === "owner" || role === "admin") return true;
  if (role === "viewer") return false;
  if (role !== "member") return false;
  return input.fileUploadEnabled !== false;
}

export function normalizeWorkspacePublicTabVisibility(
  value: unknown,
): WorkspacePublicTabVisibility {
  const source =
    value && typeof value === "object"
      ? (value as Partial<Record<WorkspacePublicTabId, unknown>>)
      : {};
  return {
    dashboard:
      typeof source.dashboard === "boolean"
        ? source.dashboard
        : DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY.dashboard,
    readme:
      typeof source.readme === "boolean"
        ? source.readme
        : DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY.readme,
    updates:
      typeof source.updates === "boolean"
        ? source.updates
        : DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY.updates,
    files:
      typeof source.files === "boolean"
        ? source.files
        : DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY.files,
    sprints:
      typeof source.sprints === "boolean"
        ? source.sprints
        : DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY.sprints,
    tasks:
      typeof source.tasks === "boolean"
        ? source.tasks
        : DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY.tasks,
  };
}

export function areWorkspacePublicTabVisibilitiesEqual(
  left: unknown,
  right: unknown,
) {
  const normalizedLeft = normalizeWorkspacePublicTabVisibility(left);
  const normalizedRight = normalizeWorkspacePublicTabVisibility(right);
  return (
    Object.keys(DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY) as WorkspacePublicTabId[]
  ).every((tabId) => normalizedLeft[tabId] === normalizedRight[tabId]);
}

/**
 * Organizations (report §18.3): About is theirs alone and open to everyone who can read the org; Dashboard,
 * Tasks and Settings ("You" sections for members and guests) are for people in the org; visitors get the
 * public tabs.
 */
export function isWorkspaceTabVisibleToViewer(input: {
  tabId: string;
  isOwnerOrMember: boolean;
  canManageSettings?: boolean;
  publicTabVisibility?: unknown;
  isOrganization?: boolean;
  /** Report 33.3 call 1 (B4.2): in a company, Members is the Directory for every member. */
  orgType?: string | null;
}) {
  if (input.isOrganization) {
    if (input.tabId === "about") return true;
    // Members is owners' and admins' alone in v1 (report §20.8); a company's Directory is for everyone inside (33.3).
    if (input.tabId === "members") return Boolean(input.canManageSettings) || ((input.orgType === "company" || input.orgType === "community") && input.isOwnerOrMember);
    // Projects is for people in the org; visitors see public projects on About (report §28.5).
    if (input.tabId === "projects") return input.isOwnerOrMember;
    if (input.tabId === "dashboard" || input.tabId === "tasks" || input.tabId === "settings") return input.isOwnerOrMember;
  }
  // Member settings Part 1: every member opens Settings for "Your settings"; the workspace sections stay for leaders.
  if (input.tabId === "settings") return Boolean(input.canManageSettings) || input.isOwnerOrMember;
  if (!(input.tabId in DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY)) return false;
  if (input.isOwnerOrMember) return true;
  return normalizeWorkspacePublicTabVisibility(input.publicTabVisibility)[
    input.tabId as WorkspacePublicTabId
  ];
}

export function resolveAllowedWorkspaceTab(input: {
  requestedTab?: string | null;
  isOwnerOrMember: boolean;
  canManageSettings?: boolean;
  publicTabVisibility?: unknown;
  isOrganization?: boolean;
  orgType?: string | null;
}): string | null {
  // Org visitors land on About; everyone else on Dashboard.
  const landingTab = input.isOrganization && !input.isOwnerOrMember ? "about" : "dashboard";
  const requestedTab = input.requestedTab?.trim() || landingTab;
  if (requestedTab === "privacy") {
    const canOpenSettings = isWorkspaceTabVisibleToViewer({ ...input, tabId: "settings" });
    return canOpenSettings ? "settings" : (isWorkspaceTabVisibleToViewer({ ...input, tabId: landingTab }) ? landingTab : null);
  }
  // Workflow tabs (Bugs…) open from a link for the workspace's own people; if the workflow isn't added, the page
  // falls back to the landing tab once the workflows load (A2.1 live check: ?tab=bugs landed on Overview).
  if (input.isOwnerOrMember && !input.isOrganization && WORKFLOW_CATALOG.some((w) => w.tab === requestedTab)) return requestedTab;
  const isKnownTab = requestedTab === "settings" || requestedTab in DEFAULT_WORKSPACE_PUBLIC_TAB_VISIBILITY || (input.isOrganization && (requestedTab === "about" || requestedTab === "members" || requestedTab === "projects"));
  if (isKnownTab && isWorkspaceTabVisibleToViewer({ ...input, tabId: requestedTab })) return requestedTab;
  if (isKnownTab && !input.isOrganization) return null;
  return isWorkspaceTabVisibleToViewer({ ...input, tabId: landingTab }) ? landingTab : null;
}

export function isAssignableWorkspaceMember(role: unknown) {
  const normalized = normalizeWorkspaceMemberRole(role);
  return normalized !== "viewer";
}

export function isEligibleWorkspaceMember(
  role: unknown,
  eligibility: WorkspaceMemberEligibility,
) {
  const normalized = normalizeWorkspaceMemberRole(role);
  if (eligibility === "mention") return true;
  if (eligibility === "assign" || eligibility === "review")
    return normalized !== "viewer";
  return false;
}

export function buildWorkspacePersonReference(input: {
  person?: {
    id?: string | null;
    fullName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  } | null;
  membershipRole?: unknown;
  isActiveMember?: boolean;
  isPendingInvite?: boolean;
  hasLostAccess?: boolean;
  isDeactivated?: boolean;
  isExternal?: boolean;
}): WorkspacePersonReference {
  const person = input.person ?? null;
  const id = person?.id?.trim() || null;
  const displayName =
    person?.fullName?.trim() ||
    person?.username?.trim() ||
    (id ? "Workspace member" : "User unavailable");
  const avatarUrl = person?.avatarUrl?.trim() || null;
  const role = normalizeWorkspaceMemberRole(input.membershipRole, "member");
  const isActiveMember = Boolean(input.isActiveMember);

  if (input.isDeactivated) {
    return {
      id,
      displayName,
      avatarUrl,
      roleLabel: "Unavailable",
      subtext: "Account unavailable",
      state: "deactivated_user",
      isAssignable: false,
      isMentionable: false,
      canOpenProfile: false,
    };
  }
  if (!id) {
    return {
      id: null,
      displayName,
      avatarUrl: null,
      roleLabel: "Unavailable",
      subtext: "User unavailable",
      state: "unknown_user",
      isAssignable: false,
      isMentionable: false,
      canOpenProfile: false,
    };
  }
  if (input.isPendingInvite) {
    return {
      id,
      displayName,
      avatarUrl,
      roleLabel: "Pending",
      subtext: "Invite pending",
      state: "pending_invite",
      isAssignable: false,
      isMentionable: false,
      canOpenProfile: true,
    };
  }
  if (input.hasLostAccess) {
    return {
      id,
      displayName,
      avatarUrl,
      roleLabel: "No access",
      subtext: "No longer has workspace access",
      state: "lost_access",
      isAssignable: false,
      isMentionable: false,
      canOpenProfile: true,
    };
  }
  if (!isActiveMember) {
    return {
      id,
      displayName,
      avatarUrl,
      roleLabel: "Former member",
      subtext: "Removed from workspace",
      state: input.isExternal ? "external_user" : "former_member",
      isAssignable: false,
      isMentionable: false,
      canOpenProfile: true,
    };
  }

  const state: WorkspacePersonReferenceState =
    role === "owner"
      ? "owner"
      : role === "admin"
        ? "co_leader"
        : role === "viewer"
          ? "viewer"
          : "active_member";
  return {
    id,
    displayName,
    avatarUrl,
    roleLabel: WORKSPACE_MEMBER_ROLE_LABELS[role],
    subtext:
      role === "admin" ? "Admin" : role === "viewer" ? "Viewer" : null,
    state,
    isAssignable: isAssignableWorkspaceMember(role),
    isMentionable: true,
    canOpenProfile: true,
  };
}

function formatCount(
  count: number | null | undefined,
  singular: string,
  plural = `${singular}s`,
) {
  const value = Math.max(0, Math.trunc(Number(count ?? 0)));
  return `${value} ${value === 1 ? singular : plural}`;
}

export const WORKSPACE_SETTINGS_SECTIONS: ProjectSettingsSectionDefinition[] = [
  // Group 1: Project Profile
  {
    id: "general",
    label: "Workspace details",
    description:
      "Name, image, summary and what you’re looking for.",
  },
  {
    id: "links",
    label: "Links",
    description: "Links shown next to the workspace name.",
  },
  // Group 2: Access & Team
  {
    id: "access",
    label: "Access and visibility",
    description:
      "Who can find this workspace and what visitors see.",
  },
  {
    id: "collaborators",
    label: "Members",
    description: "Members and their access levels.",
  },
  {
    id: "roles-applications",
    label: "Roles and applications",
    description: "Open roles, applications and who reviews them.",
  },
  // Group 3: Workspace Policies (aligned with top navigation: Docs -> Updates -> Tasks -> Files)
  {
    id: "readme",
    label: "Documents",
    description:
      "Who can publish documents, and how images and live blocks work.",
  },
  {
    id: "updates",
    label: "Updates and discussions",
    description:
      "Who can post updates, who sees them, and comments.",
  },
  {
    id: "tasks-workflow",
    label: "Stages and workflow",
    description: "Stages, task defaults and the task board.",
  },
  {
    id: "files-workspace",
    label: "Files and storage",
    description:
      "Who can upload, versions and file reviews.",
  },
  {
    id: "ai-agents",
    label: "AI agents",
    description: "What agents may change, pausing them, and who sees when they helped.",
  },
  // Group 4: System & Governance
  {
    id: "notifications",
    label: "Notifications",
    description:
      "Which events notify members and followers.",
  },
  {
    id: "privacy-policies",
    label: "Privacy",
    description:
      "Privacy and legal terms for this workspace.",
  },
  {
    id: "danger",
    label: "Workspace management",
    description:
      "Archive, transfer ownership or delete this workspace.",
  },
];

export function getVisibleWorkspaceSettingsSections() {
  return WORKSPACE_SETTINGS_SECTIONS;
}

export const normalizeWorkspaceVisibility = normalizeCanonicalProjectVisibility;

export function buildWorkspaceAccessPolicy(
  project: { visibility?: unknown } | null | undefined,
) {
  const visibility = normalizeWorkspaceVisibility(project?.visibility);
  const affectedAreasByVisibility: Record<WorkspaceSettingsVisibility, string[]> =
    {
      public: [
        "Workspace cards, Discover, search, and public profile references can show the workspace",
        "Shared links can show the workspace title, description, and workspace image preview",
        "Followers may receive public workspace updates when an update creates attention",
        "Docs, Updates, Files, and Applications inherit their own public/member-safe access checks",
      ],
      private: [
        "Only the owner and approved workspace members can open workspace detail surfaces",
        "Discover, public search, public profile cards, and anonymous metadata hide the workspace",
        "Shared links resolve only for members; outsiders get a safe unavailable response",
        "Files, tasks, Docs, Updates, applications, and notifications use member-only access",
      ],
    };

  return {
    visibility,
    label: formatWorkspaceVisibility(visibility),
    affectedAreas: affectedAreasByVisibility[visibility],
    viewerRows: [
      {
        viewer: "Owner",
        publicAccess: "Full access",
        privateAccess: "Full access",
      },
      {
        viewer: "Approved members",
        publicAccess: "Can view and collaborate by role",
        privateAccess: "Can view and collaborate by role",
      },
      {
        viewer: "Followers",
        publicAccess: "Can discover and receive public updates",
        privateAccess: "Hidden unless also a member",
      },
      {
        viewer: "Pending applicants",
        publicAccess: "Can view public context and their application flow",
        privateAccess: "Only their application/conversation stays available",
      },
      {
        viewer: "Anyone with the link",
        publicAccess: "Can open public workspace pages and share previews",
        privateAccess: "Cannot view workspace content or metadata",
      },
    ],
    summary:
      visibility === "private"
        ? "Member-only workspace access is enforced across workspace surfaces."
        : "The workspace is discoverable and visible to everyone.",
  };
}

export function buildWorkspaceAccessImpact(
  input: ProjectAccessImpactInput | null | undefined,
) {
  const visibility = normalizeWorkspaceVisibility(input?.visibility);
  const membersCount = Math.max(
    0,
    Math.trunc(Number(input?.membersCount ?? 0)),
  );
  const followersCount = Math.max(
    0,
    Math.trunc(Number(input?.followersCount ?? 0)),
  );
  const openRolesCount = Math.max(
    0,
    Math.trunc(Number(input?.openRolesCount ?? 0)),
  );
  const pendingApplicationsCount = Math.max(
    0,
    Math.trunc(Number(input?.pendingApplicationsCount ?? 0)),
  );
  const activeTasksCount = Math.max(
    0,
    Math.trunc(Number(input?.activeTasksCount ?? 0)),
  );

  const metrics = [
    {
      label: "Approved members",
      value: membersCount,
      detail: "Keep access in both Public and Private.",
    },
    {
      label: "Followers",
      value: followersCount,
      detail:
        visibility === "private"
          ? "Lose public discovery and update visibility unless they are members."
          : "Can discover public workspace updates.",
    },
    {
      label: "Open roles",
      value: openRolesCount,
      detail:
        visibility === "private"
          ? "Hidden from public application intake."
          : "Visible in public application intake.",
    },
    {
      label: "Pending applications",
      value: pendingApplicationsCount,
      detail:
        "Keep their own application/conversation context where available.",
    },
    {
      label: "Active tasks",
      value: activeTasksCount,
      detail: "Remain member-only work surfaces when private.",
    },
  ];

  const transitionChecklist =
    visibility === "private"
      ? [
          "Hide the workspace from Discover, public search, and public profile workspace cards.",
          "Return safe unavailable metadata for anonymous shared links.",
          "Keep owner and approved member access unchanged.",
          "Keep pending applicant context limited to their own application or conversation.",
          "Keep files, tasks, Doc, Updates, and notifications behind member-safe access checks.",
        ]
      : [
          "Restore Discover, public search, and public profile workspace cards.",
          "Allow shared links to show workspace title, description, and workspace image metadata.",
          "Keep write access role-based; Public does not grant edit rights.",
          "Allow open roles and applications to be discovered publicly.",
          "Keep files/tasks governed by their own member-safe controls where required.",
        ];

  const summary =
    visibility === "private"
      ? [
          `${formatCount(membersCount, "member")} keep workspace access.`,
          `${formatCount(followersCount, "follower")} lose public discovery unless already members.`,
          `${formatCount(openRolesCount, "open role")} are hidden from public intake.`,
        ]
      : [
          `${formatCount(followersCount, "follower")} can discover public updates.`,
          `${formatCount(openRolesCount, "open role")} can appear in public intake.`,
          `${formatCount(membersCount, "member")} keep their existing roles.`,
        ];

  return {
    visibility,
    metrics,
    transitionChecklist,
    summary,
    pendingApplicationsCount,
    activeTasksCount,
  };
}

export function buildWorkspaceAccessTransitionPolicy(
  input: ProjectAccessTransitionInput | null | undefined,
) {
  const previousVisibility = normalizeWorkspaceVisibility(
    input?.previousVisibility,
  );
  const nextVisibility = normalizeWorkspaceVisibility(
    input?.nextVisibility ?? input?.visibility,
  );
  const impact = buildWorkspaceAccessImpact({
    ...input,
    visibility: nextVisibility,
  });
  const direction = `${previousVisibility}_to_${nextVisibility}` as const;
  const hasManagedProjectImage = Boolean(input?.hasManagedProjectImage);

  const requiresConfirmation = previousVisibility !== nextVisibility;
  const riskLabel =
    nextVisibility === "private"
      ? "Private conversion"
      : nextVisibility === "public"
        ? "Public conversion"
        : "No visibility change";

  const irreversibleNotes =
    nextVisibility === "private"
      ? [
          "Anonymous workspace metadata is replaced with safe unavailable copy.",
          hasManagedProjectImage
            ? "The workspace image is served only through the visibility-aware workspace image route."
            : "Legacy public image URLs are hidden from public metadata.",
          "Existing external social previews may stay cached outside this app.",
        ]
      : [
          "Workspace title, description, and image route become public share metadata.",
          "Open roles and application intake become discoverable again.",
          "Followers can discover public updates again.",
        ];

  return {
    previousVisibility,
    nextVisibility,
    direction,
    requiresConfirmation,
    riskLabel,
    confirmationSummary: impact.summary,
    metrics: impact.metrics,
    transitionChecklist: impact.transitionChecklist,
    irreversibleNotes,
  };
}

export function buildWorkspaceRolePolicy(input: {
  isOwner: boolean;
  actorRole?: WorkspaceMemberRole | null;
  ownerId?: string | null;
  members?: WorkspaceSettingsMember[];
}) {
  const members = input.members ?? [];
  const normalizedMembers = members.map((member) => ({
    ...member,
    membershipRole:
      member.id === input.ownerId
        ? "owner"
        : normalizeWorkspaceMemberRole(member.membershipRole, "member"),
  }));
  const transferCandidates = normalizedMembers.filter((member) => {
    if (!member?.id) return false;
    if (member.id === input.ownerId) return false;
    return member.membershipRole !== "owner";
  });

  const roleCounts = normalizedMembers.reduce<
    Record<WorkspaceMemberRole, number>
  >(
    (acc, member) => {
      const role = normalizeWorkspaceMemberRole(
        member.membershipRole,
        member.id === input.ownerId ? "owner" : "member",
      );
      acc[role] = (acc[role] ?? 0) + 1;
      return acc;
    },
    { owner: 0, admin: 0, member: 0, viewer: 0 },
  );

  const owner =
    normalizedMembers.find(
      (member) =>
        member.id === input.ownerId || member.membershipRole === "owner",
    ) ?? null;
  const coLeaders = normalizedMembers.filter(
    (member) => member.membershipRole === "admin",
  );
  const contributors = normalizedMembers.filter(
    (member) => member.membershipRole === "member",
  );
  const viewers = normalizedMembers.filter(
    (member) => member.membershipRole === "viewer",
  );

  const actorRole = input.isOwner
    ? "owner"
    : normalizeWorkspaceMemberRole(input.actorRole, "member");

  return {
    canManage: input.isOwner || actorRole === "admin",
    actorRole,
    members: normalizedMembers,
    owner,
    coLeaders,
    contributors,
    viewers,
    transferCandidates,
    roleCounts,
    roleLabels: WORKSPACE_MEMBER_ROLE_LABELS,
    capabilityMatrix: WORKSPACE_MEMBER_ROLE_CAPABILITIES,
    affectedAreas: [
      "Task assignment and ownership routing",
      "Workspace Files and task Files permissions",
      "Applications and members",
      "Danger-zone permissions and audit history",
    ],
  };
}

export function buildWorkspaceMemberMutationPolicy(input: {
  actorIsOwner: boolean;
  actorRole?: WorkspaceMemberRole | null;
  ownerId?: string | null;
  targetUserId?: string | null;
  targetRole?: unknown;
  nextRole?: unknown;
}) {
  const actorRole = input.actorIsOwner
    ? "owner"
    : normalizeWorkspaceMemberRole(input.actorRole, "member");
  const targetRole = normalizeWorkspaceMemberRole(
    input.targetRole,
    input.targetUserId === input.ownerId ? "owner" : "member",
  );
  const nextRole =
    input.nextRole === undefined
      ? null
      : normalizeWorkspaceMemberRole(input.nextRole, "member");
  const isSelfOwnerTarget = Boolean(
    input.ownerId && input.targetUserId && input.ownerId === input.targetUserId,
  );
  const ownerCanManageTarget = Boolean(
    input.actorIsOwner &&
    input.targetUserId &&
    !isSelfOwnerTarget &&
    targetRole !== "owner",
  );
  const coLeaderCanManageTarget = Boolean(
    !input.actorIsOwner &&
    actorRole === "admin" &&
    input.targetUserId &&
    !isSelfOwnerTarget &&
    (targetRole === "member" || targetRole === "viewer") &&
    (!nextRole || nextRole === "member" || nextRole === "viewer"),
  );
  const canManageTarget = ownerCanManageTarget || coLeaderCanManageTarget;
  return {
    actorRole,
    targetRole,
    canPromoteToCoLeader: ownerCanManageTarget && targetRole !== "admin",
    canChangeRole: canManageTarget,
    canRemove: canManageTarget,
    canTransferOwnership: Boolean(
      input.actorIsOwner && input.targetUserId && !isSelfOwnerTarget,
    ),
    blockedReason:
      !input.actorIsOwner && actorRole !== "admin"
        ? "Only the owner and admins can manage members."
        : isSelfOwnerTarget || targetRole === "owner"
          ? "Ownership changes must use the transfer ownership flow."
          : actorRole === "admin" &&
              (targetRole === "admin" || nextRole === "admin")
            ? "Admins can manage members and viewers, but not other admins."
            : null,
  };
}

export function buildWorkspaceMemberRemovalPreflight(
  input: ProjectMemberRemovalPreflightInput | null | undefined,
) {
  const member = input?.member ?? null;
  const activeAssignedTasks = Math.max(
    0,
    Math.trunc(Number(input?.activeAssignedTasks ?? 0)),
  );
  const activeCreatedTasks = Math.max(
    0,
    Math.trunc(Number(input?.activeCreatedTasks ?? 0)),
  );
  const fileReviews = Math.max(0, Math.trunc(Number(input?.fileReviews ?? 0)));
  const acceptedApplications = Math.max(
    0,
    Math.trunc(Number(input?.acceptedApplications ?? 0)),
  );
  const projectGroupParticipant = Boolean(input?.projectGroupParticipant);
  const visibility = normalizeWorkspaceVisibility(input?.visibility);
  const displayName = member
    ? getWorkspaceMemberDisplayName(member)
    : "This member";
  const affectedAreas = [
    activeAssignedTasks > 0
      ? `${formatCount(activeAssignedTasks, "active assigned task")} will keep ${displayName} as historical assignee and show Needs reassignment.`
      : "No active assigned tasks.",
    activeCreatedTasks > 0
      ? `${formatCount(activeCreatedTasks, "active created task")} keep their creator history.`
      : "No active created tasks.",
    fileReviews > 0
      ? `${formatCount(fileReviews, "file review")} keep historical context.`
      : "No active file review markers.",
    acceptedApplications > 0
      ? `${formatCount(acceptedApplications, "accepted role")} may update role capacity after removal.`
      : "No accepted role capacity impact found.",
    projectGroupParticipant
      ? "Their access to the general channel will be removed."
      : "No workspace group conversation participant row found.",
    visibility === "private"
      ? "Private workspace access is revoked immediately."
      : "Public workspace pages may remain visible, but member-only controls are revoked.",
  ];
  const warnings = affectedAreas.filter((item) => !item.startsWith("No "));

  return {
    displayName,
    activeAssignedTasks,
    activeCreatedTasks,
    fileReviews,
    acceptedApplications,
    projectGroupParticipant,
    visibility,
    warnings,
    affectedAreas,
    defaultMode: "preserve_history" as const,
    summary:
      warnings.length > 0
        ? `${displayName} can be removed safely, but ${warnings.length} affected area${warnings.length === 1 ? "" : "s"} should be reviewed.`
        : `${displayName} can be removed with no active responsibility blockers.`,
  };
}

export function buildWorkspaceFilePolicy() {
  return {
    enforcedRules: [
      "The owner and admins can always upload, replace, organize and review files.",
      "Members can upload files only when their per-member upload toggle is on.",
      "Viewers can inspect allowed file surfaces but cannot upload or replace files.",
      "Task-file notes use the task link note source of truth.",
      "Version history stays on file rows.",
      "File review notifications target task participants only when responsibility is created.",
    ],
    affectedAreas: [
      "Workspace Files tab",
      "Task panel Files tab",
      "Direct upload URLs and batch upload URLs",
      "Folder/file creation and file version replacement",
      "Notification file-review events",
      "Download flows",
    ],
    uploadPolicySummary:
      "File upload permission is checked in server actions before signed URLs, file rows, folders, or replacement versions are created.",
  };
}

export function buildWorkspaceSettingsPreflight(
  input: ProjectSettingsPreflightInput | null | undefined,
) {
  const status =
    input?.status === "active" ||
    input?.status === "completed" ||
    input?.status === "archived"
      ? input.status
      : "draft";
  const openRolesCount = Number(input?.openRolesCount ?? 0);
  const pendingApplicationsCount = Number(input?.pendingApplicationsCount ?? 0);
  const activeTasksCount = Number(input?.activeTasksCount ?? 0);

  return {
    status,
    openRolesCount,
    pendingApplicationsCount,
    activeTasksCount,
    canArchive: input?.canArchive ?? status !== "archived",
    canDelete: input?.canDelete === true,
    affectedAreas: [
      openRolesCount > 0
        ? `${openRolesCount} open role${openRolesCount === 1 ? "" : "s"}`
        : "No open roles",
      pendingApplicationsCount > 0
        ? `${pendingApplicationsCount} pending application${pendingApplicationsCount === 1 ? "" : "s"}`
        : "No pending applications",
      activeTasksCount > 0
        ? `${activeTasksCount} active task${activeTasksCount === 1 ? "" : "s"}`
        : "No active tasks",
    ],
  };
}

export function getWorkspaceMemberDisplayName(member: WorkspaceSettingsMember) {
  return member.fullName || member.username || "Workspace member";
}
