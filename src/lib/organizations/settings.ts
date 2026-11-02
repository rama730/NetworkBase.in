import { z } from "zod";
import { typeProfile } from "@/lib/organizations/type-profile";

import type { WorkspaceSettingsSectionId } from "@/lib/workspaces/settings-policies";
import { ORG_LIMITS, ORG_TYPES } from "@/lib/organizations/config";
import type { VisibilityCap } from "@/lib/organizations/child-rules";

export type OrgSettingsSectionId = "you-membership" | "org-profile" | "org-access" | "org-people" | "org-projects" | "org-work"
  | "org-updates" | "org-messages" | "org-storage" | "org-moderation" | "org-allowed" | "org-management";
export type OrgMemberRole = "owner" | "admin" | "member" | "viewer";

/** Report §22.3: each section's name and the one line saying who it affects. */
export const ORG_SECTION_DEFS: Record<OrgSettingsSectionId, { label: string; description: string }> = {
  "org-profile": { label: "Organization profile", description: "Type, term, time zone and what About says." },
  "org-access": { label: "Joining", description: "The join code, how people join and how many can." },
  "org-people": { label: "People and roles", description: "Role names and what each role can do." },
  "org-projects": { label: "Workspaces", description: "Who creates workspaces here and the rules they follow." },
  "org-work": { label: "Work", description: "Defaults for new tasks and sprints." },
  "org-updates": { label: "Updates", description: "Who posts, who replies and how announcements notify." },
  "org-messages": { label: "Messages", description: "How the organization’s channels work." },
  "org-storage": { label: "Storage", description: "What uses the organization’s space, and what can go." },
  "org-moderation": { label: "Moderation", description: "Reports, blocked people and the organization’s standing." },
  "you-membership": { label: "My membership", description: "Your role, your title and whether this shows on your profile." },
  "org-allowed": { label: "What’s allowed", description: "What each role can do here." },
  "org-management": { label: "Management", description: "Leave, and for the owner: transfer, archive, duplicate or delete." },
};

/** Workspace sections an organization reuses, under its own names (report §22.3). */
export const ORG_REUSED_LABELS: Partial<Record<WorkspaceSettingsSectionId, string>> = {
  general: "Details", links: "Links", access: "Access and visibility", readme: "Documents", notifications: "Notifications", "privacy-policies": "Privacy",
};

// Report §22.3, in menu order. Members, Stages, Task completion and the member upload controls aren't here: the
// Members tab is the one roster, About builds stages from sprints, and Work holds the one review setting.
const FOR_ADMINS: Array<OrgSettingsSectionId | WorkspaceSettingsSectionId> = [
  "general", "org-profile", "links", "access", "org-access", "org-people", "org-projects", "org-work",
  "readme", "org-updates", "org-messages", "org-storage", "notifications", "org-moderation", "you-membership", "privacy-policies", "org-management",
];
const FOR_MEMBERS: Array<OrgSettingsSectionId | WorkspaceSettingsSectionId> = ["you-membership", "org-allowed", "privacy-policies", "org-management"];

/**
 * Settings sections by role (report §22.3): owners and admins open on Details and see every section (some read
 * only for admins); members and viewers open on My membership. Management is everyone's: Leave lives there.
 */
export function orgSettingsSectionIds(role: OrgMemberRole): Array<OrgSettingsSectionId | WorkspaceSettingsSectionId> {
  return role === "owner" || role === "admin" ? FOR_ADMINS : FOR_MEMBERS;
}

/** Any IANA zone or alias the runtime knows (Asia/Kolkata as well as Asia/Calcutta). */
export function isTimeZone(tz: string) {
  if (!tz) return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).nullable().optional();
const roleName = z.string().trim().min(1).max(30);

/** One schema per editable org section; the server action picks by section and checks who may save it. */
export const ORG_SETTINGS_PATCH = {
  profile: z.object({
    org_type: z.enum(ORG_TYPES).optional(),
    term_start: isoDate,
    term_end: isoDate,
    time_zone: z.string().max(64).refine(isTimeZone, "Unknown time zone").nullable().optional(),
    welcome_note: z.string().trim().max(500).nullable().optional(),
    // Report §34.2–34.3: Other's own label, the body it belongs to and where it is.
    type_label: z.string().trim().max(30).nullable().optional(),
    part_of: z.string().trim().max(100).nullable().optional(),
    location: z.string().trim().max(100).nullable().optional(),
  }).strict(),
  access: z.object({
    join_mode: z.enum(["instant", "approval"]).optional(),
    join_code_enabled: z.boolean().optional(),
    max_members: z.number().int().min(1).max(ORG_LIMITS.membersPerOrg).nullable().optional(),
  }).strict(),
  people: z.object({
    role_names: z.object({ owner: roleName, admin: roleName, member: roleName, viewer: roleName }).strict(),
  }).strict(),
  projects: z.object({
    child_creation: z.enum(["members", "admins"]).optional(),
    outside_people: z.boolean().optional(),
    child_share: z.boolean().optional(),
    visibility_cap: z.enum(["public", "org", "private"]).optional(),
    default_units: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    follow_sprints: z.boolean().optional(),
  }).strict(),
  work: z.object({
    review_required: z.boolean().optional(),
    late_rule: z.enum(["none", "until", "always"]).optional(),
    reminders: z.enum(["both", "day_before", "due_day", "off"]).optional(),
    story_points: z.enum(["shown", "hidden"]).optional(),
    sprint_auto_start: z.boolean().optional(),
    sprint_notify_on_start: z.boolean().optional(),
    sprint_show_in_children: z.boolean().optional(),
    sprint_create_matching: z.boolean().optional(),
  }).strict(),
  notifications: z.object({
    admin_digest: z.enum(["daily", "instant"]).optional(),
  }).strict(),
  // Report §22.4: reply rules and announcement defaults moved here from Admin batching.
  updates: z.object({
    member_posts: z.boolean().optional(),
    announcement_notify: z.enum(["in_app", "email"]).optional(),
    reply_rule: z.enum(["members", "logged_in"]).optional(),
  }).strict(),
} as const;

export type OrgSettingsSection = keyof typeof ORG_SETTINGS_PATCH;

/** Who saves which section (report §21.2): role names are the owner's; the rest is owners and admins. */
export const ORG_SECTION_OWNER_ONLY: Record<OrgSettingsSection, boolean> = { profile: false, access: false, people: true, projects: false, work: false, notifications: false, updates: false };

export type OrgWork = {
  reviewRequired: boolean;
  lateRule: "none" | "until" | "always";
  reminders: "both" | "day_before" | "due_day" | "off";
  storyPoints: "shown" | "hidden";
  sprintAutoStart: boolean;
  sprintNotifyOnStart: boolean;
  sprintShowInChildren: boolean;
  sprintCreateMatching: boolean;
};

/**
 * The Work section (report §21.2 #5) with the type defaults (§21.5): Education reviews assignments, accepts late
 * work until a date and hides story points; other types don't review, always accept late work and show points.
 */
export function readOrgWork(orgSettings: unknown, orgType: string | null | undefined): OrgWork {
  const s = (orgSettings ?? {}) as Record<string, unknown>;
  // Saved when the organization is made (0048 for older ones); the type only fills a key that is somehow missing.
  const type = typeProfile(orgType);
  const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
  return {
    reviewRequired: typeof s.assignmentReview === "boolean" ? s.assignmentReview : type.reviewRequired,
    lateRule: pick(s.assignmentLateRule, ["none", "until", "always"] as const, type.lateRule),
    reminders: pick(s.assignmentReminders, ["both", "day_before", "due_day", "off"] as const, "both"),
    storyPoints: pick(s.storyPoints, ["shown", "hidden"] as const, type.storyPoints),
    sprintAutoStart: s.sprintAutoStart !== false,
    sprintNotifyOnStart: s.sprintNotifyOnStart !== false,
    sprintShowInChildren: s.sprintShowInChildren !== false,
    sprintCreateMatching: s.sprintCreateMatching === true,
  };
}

/** The child-project rules an org enforces (report §21.7), read from org_settings with their defaults. */
export function readOrgRules(orgSettings: unknown): { childCreation: "members" | "admins"; outsidePeople: boolean; visibilityCap: VisibilityCap } {
  const s = (orgSettings ?? {}) as { childCreation?: unknown; outsidePeople?: unknown; visibilityCap?: unknown };
  return {
    childCreation: s.childCreation === "admins" ? "admins" : "members",
    outsidePeople: s.outsidePeople === true,
    visibilityCap: s.visibilityCap === "org" || s.visibilityCap === "private" ? s.visibilityCap : "public",
  };
}
