/**
 * The product vocabulary (docs/audits/terminology-roles-workspace-audit-2026-10-28.md, §9–10).
 * Labels for stored values live here and nowhere else; scripts/check-terminology-contract.ts guards the banned words.
 */

export type AccessLevel = 'owner' | 'admin' | 'member' | 'viewer';

/** Decision 1: one ladder for workspaces and organizations. The stored values are already these words. */
export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

/** An organization's own name sits beside the base level, so a TA is visibly an Admin (§4.3). */
export function accessLevelLabel(level: AccessLevel, customName?: string | null) {
  const base = ACCESS_LEVEL_LABELS[level];
  const custom = customName?.trim();
  return custom && custom !== base ? `${custom} · ${base}` : base;
}

/** Decision 17. `done` is the stored value; people read Completed. `in_review` is the submitted state. */
export const TASK_STATUS_LABELS = { todo: 'To do', in_progress: 'In progress', in_review: 'In review', blocked: 'Blocked', done: 'Completed' } as const;

/** Decisions 21 and 23. */
export const SPRINT_STATUS_LABELS = { planning: 'Upcoming', active: 'Active', completed: 'Completed', archived: 'Archived', cancelled: 'Canceled' } as const;

/** Decision 11: status only; a workspace's progress is its Stages. */
export const WORKSPACE_STATUS_LABELS = { draft: 'Draft', active: 'Active', completed: 'Completed', archived: 'Archived' } as const;

/** Decision 38: one list for personal settings, workspace rules, organization rules and filters. */
export const NOTIFICATION_CATEGORIES = [
  { id: 'mentions', label: 'Mentions and replies', description: 'When someone mentions you or replies to you' },
  { id: 'invitations', label: 'Invitations and requests', description: 'Invitations, connection requests and join requests' },
  { id: 'applications', label: 'Applications and roles', description: 'New applications and decisions' },
  { id: 'members', label: 'Members and access', description: 'People joining, leaving and changing access level' },
  { id: 'tasks', label: 'Tasks', description: 'Tasks assigned to you, reviews and due dates' },
  { id: 'sprints', label: 'Sprints and stages', description: 'Sprint and stage changes' },
  { id: 'files', label: 'Files and documents', description: 'Files and documents shared with you' },
  { id: 'updates', label: 'Updates and announcements', description: 'Posts from workspaces and organizations you follow' },
  { id: 'assignments', label: 'Assignments', description: 'Assignments, submissions and returns' },
  { id: 'security', label: 'Security', description: 'Security changes' },
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['id'];

/** Decision 22: workspace notification delivery. */
export const DELIVERY_LEVEL_LABELS = { mandatory: 'Required', important: 'Important', standard: 'Normal', digest: 'Summary', realtime: 'Instant' } as const;

/** §21.3 N2: the two level scales. */
export const MESSAGE_LEVEL_LABELS = { all: 'All', mentions_threads: 'Mentions and threads', mentions: 'Mentions', mute: 'Off' } as const;
export const REACH_LEVEL_LABELS = { all: 'All', important: 'Important only', off: 'Off' } as const;

/** Decision 41. */
export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam' },
  { id: 'harassment', label: 'Harassment' },
  { id: 'hate_speech', label: 'Hate speech' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'other', label: 'Other' },
] as const;

/** Decision 32. Values match what workspace setup already stores. */
export const COMPENSATION_OPTIONS = [
  { value: 'unpaid', label: 'Unpaid (volunteer)' },
  { value: 'paid', label: 'Paid' },
  { value: 'equity', label: 'Equity' },
  { value: 'rev_share', label: 'Revenue share' },
] as const;

/** Decision 36. */
export const CONVERSATION_TYPE_LABELS = { channel: 'Channel', dm: 'Direct message', group: 'Group message', self: 'Notes to self', application: 'Application conversation' } as const;

/** Decision 28: the same names in the footer, Settings and page titles. */
export const LEGAL_PAGE_NAMES = {
  terms: 'Terms of Service', privacy: 'Privacy Policy', cookies: 'Cookie Notice', acceptableUse: 'Acceptable Use Policy', eula: 'EULA',
  subprocessors: 'Subprocessors', dpa: 'Data Processing Addendum', copyright: 'Copyright complaints', security: 'Security reporting', grievances: 'Grievance redressal',
} as const;

/** §10: words people must not see. Kept terms (Team lead, external project, Side project) never match. */
export const BANNED_TERMS: ReadonlyArray<{ pattern: RegExp; use: string }> = [
  { pattern: /\bco-?lead(?:er)?s?\b/i, use: 'Admin' },
  { pattern: /\bproject (?:lead|leads|leader|leaders|leadership|owner)\b/i, use: 'Owner (or "owner and admins")' },
  { pattern: /^(?:Lead|Leader|Leaders|Leadership)$/, use: 'Owner, Team lead or a role title' },
  { pattern: /\bleaders?-only\b|\bleadership\b/i, use: 'owner and admins' },
  { pattern: /\bcollaborators?\b/i, use: 'Member (in a workspace) or Contributor (on a contribution)' },
  { pattern: /\bdanger zone\b/i, use: 'Workspace management' },
  { pattern: /\bchild projects?\b/i, use: 'Workspace in {organization}' },
  { pattern: /\bunit lead\b/i, use: 'Team lead' },
  { pattern: /\bproject feed\b/i, use: 'Updates' },
];
