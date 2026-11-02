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
/** Report §5.7, §34.2, decision 84: one set of words for an assignment copy's state, plus a Late mark. */
export const ASSIGNMENT_STATE_LABELS = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', returned: 'Returned', done: 'Completed', missing: 'Missing', excused: 'Excused' } as const;
export const LATE_MARK = 'Late';

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

/** §6.2: one list for workspace tab labels and browser titles. Tab ids are unchanged. */
export const WORKSPACE_TAB_LABELS = {
  dashboard: 'Overview', about: 'About', readme: 'Documents', docs: 'Documents', updates: 'Updates', sprints: 'Sprints',
  tasks: 'Tasks', files: 'Files', projects: 'Workspaces', members: 'Members', settings: 'Settings', privacy: 'Settings',
} as const;

/** Decision 22: workspace notification delivery. */
export const DELIVERY_LEVEL_LABELS = { mandatory: 'Required', important: 'Important', standard: 'Normal', digest: 'Summary', realtime: 'Instant' } as const;

/** §21.3 N2: the two level scales. */
export const MESSAGE_LEVEL_LABELS = { all: 'All', mentions_threads: 'Mentions and threads', mentions: 'Mentions', mute: 'Off' } as const;
export const REACH_LEVEL_LABELS = { all: 'All', important: 'Important only', off: 'Off' } as const;

/** Decision 41; 12 reasons since the trust and safety concept (F8). Severity and hints live in lib/trust/rules. */
export const REPORT_REASONS = [
  { id: 'threat', label: 'Threat of violence' },
  { id: 'self_harm', label: 'Self-harm or suicide' },
  { id: 'child_safety', label: 'Sexual content involving a minor' },
  { id: 'intimate_images', label: 'Intimate images shared without consent' },
  { id: 'private_info', label: 'Sharing private information' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'hate_speech', label: 'Hate speech' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'evading_block', label: 'Getting around a block' },
  // Decision 163: launch is 18 and over; this goes to NetworkBase, never the organization.
  { id: 'under_18', label: 'This person may be under 18' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'spam', label: 'Spam' },
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
  { pattern: /^(?:Lead|Leader|Leaders)$/, use: 'Owner, Team lead or a role title' },
  // "Leadership" alone stays legal: it is a skill and a work type ("Fractional leadership").
  { pattern: /\bleaders?-only\b|\b(?:project|workspace) leadership\b|\bleadership appointment\b|^Leadership$/i, use: 'owner and admins' },
  { pattern: /\bcollaborators?\b/i, use: 'Member (in a workspace) or Contributor (on a contribution)' },
  { pattern: /\bdanger zone\b/i, use: 'Workspace management' },
  { pattern: /\bchild projects?\b/i, use: 'Workspace in {organization}' },
  { pattern: /\bunit lead\b/i, use: 'Team lead' },
  // Lowercase in a sentence, so the exact-word rule above misses it. "Team lead" and "Lead designer" never match.
  { pattern: /\b(?:a|an|the|new|its|their|message|remind)\s+leads?\b(?!\s+generation)|^Lead:|\bleaders? (?:can|only)\b|\b(?:person|you|they) leads?\b/i, use: 'Owner, or owner and admins' },
  { pattern: /\bproject feed\b/i, use: 'Updates' },
];
