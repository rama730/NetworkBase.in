export type SprintStatus = "planning" | "active" | "completed" | "archived" | "cancelled";
export type SprintMemberRole = "owner" | "admin" | "member" | "viewer" | null;
export type SprintTaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type SprintTaskPriority = "low" | "medium" | "high" | "urgent";

export type SprintTimelinePerson = {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
} | null;

export type SprintListItem = {
  id: string;
  projectId: string;
  sprintNumber: number;
  code: string;
  name: string;
  goal: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  status: SprintStatus;
  startedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  creator?: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
    roleLabel: string | null;
  } | null;
};

export type SprintPermissionSet = {
  canRead: boolean;
  canWrite: boolean;
  canCreate: boolean;
  canStart: boolean;
  canComplete: boolean;
  isOwner: boolean;
  isMember: boolean;
  memberRole: SprintMemberRole;
};

export type SprintHealthSummary = {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  linkedFileCount: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
  completionPercentage: number;
};

export type SprintTaskTimelineEntity = {
  id: string;
  projectId: string;
  sprintId: string;
  taskNumber: number | null;
  title: string;
  description: string | null;
  status: SprintTaskStatus;
  reviewStatus?: "none" | "pending" | "rejected";
  priority: SprintTaskPriority;
  storyPoints: number | null;
  dueDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  activityAt: string | null;
  linkedFileCount: number;
  isDeleted: boolean;
  membershipState: "committed" | "historical";
  addedAt: string | null;
  removedAt: string | null;
  linkedFiles: Array<{
    nodeId: string;
    name: string;
    latestVersion: number | null;
    latestUploader: SprintTimelinePerson;
    annotation: string | null;
    tags: string[];
    role: "working" | "deliverable" | "reference";
  }>;
  subtasks: Array<{
    id: string;
    title: string;
    completed: boolean;
    position: number;
  }>;
  assignee: SprintTimelinePerson;
  creator: SprintTimelinePerson;
};

export type SprintTimelineRow =
  | {
      id: string;
      kind: "kickoff";
      occurredAt: string | null;
      sprint: SprintListItem;
    }
  | {
      id: string;
      kind: "task";
      occurredAt: string | null;
      task: SprintTaskTimelineEntity;
    }
  | {
      id: string;
      kind: "closeout";
      occurredAt: string | null;
      sprint: SprintListItem;
      summary: SprintHealthSummary;
    };

export type SprintDetailPayload = {
  projectId: string;
  projectSlug: string | null;
  sprints: SprintListItem[];
  selectedSprintId: string | null;
  permissions: SprintPermissionSet;
  summary: SprintHealthSummary | null;
  rows: SprintTimelineRow[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Organizations and child projects only (report §15): links, linked projects, the org sprint list. */
  org?: import("@/lib/organizations/sprints").SprintOrgContext | null;
  /** The selected sprint's materials (report §15.2). */
  materials?: import("@/lib/organizations/sprints").SprintMaterial[];
};

export const SPRINT_STATUS_PRESENTATION: Record<
  SprintStatus,
  {
    label: string;
    dotClassName: string;
    toneClassName: string;
  }
> = {
  planning: {
    label: "Planning",
    dotClassName: "nb-sprint-dot-info",
    toneClassName: "nb-sprint-tone-info",
  },
  active: {
    label: "In progress",
    dotClassName: "nb-sprint-dot-success",
    toneClassName: "nb-sprint-tone-success",
  },
  completed: {
    label: "Completed",
    dotClassName: "nb-sprint-dot-muted",
    toneClassName: "nb-sprint-tone-muted",
  },
  archived: {
    label: "Archived",
    toneClassName: "nb-sprint-tone-muted",
    dotClassName: "nb-sprint-dot-muted",
  },
  cancelled: {
    label: "Canceled",
    dotClassName: "nb-sprint-dot-danger",
    toneClassName: "nb-sprint-tone-danger",
  },
};

export const SPRINT_TASK_STATUS_PRESENTATION: Record<
  SprintTaskStatus,
  {
    label: string;
    toneClassName: string;
  }
> = {
  todo: {
    label: "To do",
    toneClassName: "nb-sprint-tone-muted",
  },
  in_progress: {
    label: "In progress",
    toneClassName: "nb-sprint-tone-info",
  },
  done: {
    label: "Done",
    toneClassName: "nb-sprint-tone-success",
  },
  blocked: {
    label: "Issues",
    toneClassName: "nb-sprint-tone-danger",
  },
};

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function isValidSprintDate(value: string | null | undefined) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function formatSprintDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
  const start = isValidSprintDate(startDate) ? new Date(startDate as string) : null;
  const end = isValidSprintDate(endDate) ? new Date(endDate as string) : null;

  // Sprint dates are calendar dates. Rendering them in UTC keeps an end date
  // from moving to the previous day for collaborators west of UTC.
  const formatCalendarDate = (date: Date, includeYear: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      ...(includeYear ? { year: "numeric" } : {}),
    }).format(date);

  if (start && end) {
    return `${formatCalendarDate(start, false)} - ${formatCalendarDate(end, true)}`;
  }
  if (start) {
    return `Starts ${formatCalendarDate(start, true)}`;
  }
  if (end) {
    return `Ends ${formatCalendarDate(end, true)}`;
  }
  return "Dates not set";
}

const SPRINT_RELATIVE_TIME_UNITS = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
] as const;

const sprintRelativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatSprintTimelineStamp(
  value: string | number | Date | null | undefined,
  fallback = "Date not set",
) {
  const date =
    value instanceof Date
      ? value
      : value === null || value === undefined || value === ""
        ? null
        : new Date(value);
  if (!date || !Number.isFinite(date.getTime())) return fallback;

  const elapsed = date.getTime() - Date.now();
  const delta = Math.abs(elapsed);
  const [unit, unitMs] =
    SPRINT_RELATIVE_TIME_UNITS.find(([, currentUnitMs]) => delta >= currentUnitMs) ??
    SPRINT_RELATIVE_TIME_UNITS[SPRINT_RELATIVE_TIME_UNITS.length - 1]!;

  if (delta < 7 * 24 * 60 * 60 * 1000) {
    return sprintRelativeTime.format(Math.round(elapsed / unitMs), unit);
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function buildSprintPermissionSet(input: {
  canRead: boolean;
  canWrite: boolean;
  isOwner: boolean;
  isMember: boolean;
  memberRole: SprintMemberRole;
}): SprintPermissionSet {
  // ponytail: use the existing project authority level at both boundaries. ceiling: isOwner or admin role. upgrade: granular custom role permissions if enterprise RBAC matrix introduced.
  const canManage = input.isOwner || input.memberRole === "admin";
  return {
    canRead: input.canRead,
    canWrite: canManage,
    canCreate: canManage,
    canStart: canManage,
    canComplete: canManage,
    isOwner: input.isOwner,
    isMember: input.isMember,
    memberRole: input.memberRole,
  };
}

export function buildSprintHealthSummary(input: {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  linkedFileCount: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
}): SprintHealthSummary {
  return {
    totalTasks: Math.max(0, input.totalTasks),
    completedTasks: Math.max(0, input.completedTasks),
    blockedTasks: Math.max(0, input.blockedTasks),
    linkedFileCount: Math.max(0, input.linkedFileCount),
    totalStoryPoints: Math.max(0, input.totalStoryPoints),
    completedStoryPoints: Math.max(0, input.completedStoryPoints),
    completionPercentage:
      input.totalTasks > 0
        ? clampPercentage((input.completedTasks / input.totalTasks) * 100)
        : 0,
  };
}

export function buildProjectSprintDetailHref(projectSlug: string, sprintId: string, input?: {
  sprintCode?: string;
}) {
  const encodedSlug = encodeURIComponent(projectSlug);
  const queryParams = new URLSearchParams();
  queryParams.set('tab', 'sprints');
  if (input?.sprintCode) {
    queryParams.set('sprint', input.sprintCode);
  } else {
    queryParams.set('sprintId', sprintId);
  }
  const query = queryParams.toString();
  return `/workspaces/${encodedSlug}?${query}`;
}

export function computeSprintStatus(sprint: SprintListItem): SprintStatus {
  // Schedule reconciliation owns activation. The UI only presents the
  // persisted transition and never derives a conflicting local state.
  return sprint.status;
}

export function isSprintReadyToClose(sprint: Pick<SprintListItem, "status" | "endDate">, now = new Date()) {
  if (sprint.status !== "active" || !sprint.endDate) return false;
  const endDate = new Date(sprint.endDate);
  if (!Number.isFinite(endDate.getTime())) return false;

  // A sprint scheduled through a calendar day remains active for that whole
  // day. This avoids exposing close-out early for users behind UTC.
  const inclusiveEnd = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate() + 1,
  ) - 1;
  return now.getTime() >= inclusiveEnd;
}
