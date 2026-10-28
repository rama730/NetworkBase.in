import { z } from "zod";

import type { ProjectSettingsSectionId } from "@/lib/projects/settings-policies";
import { ORG_LIMITS, ORG_TYPES } from "@/lib/organizations/config";
import type { VisibilityCap } from "@/lib/organizations/child-rules";

export type OrgSettingsSectionId = "you-membership" | "you-leave" | "org-profile" | "org-access" | "org-people" | "org-projects";
export type OrgMemberRole = "owner" | "admin" | "member" | "viewer";

export const ORG_SECTION_DEFS: Record<OrgSettingsSectionId, { label: string; description: string }> = {
  "you-membership": { label: "My membership", description: "Your role, your title and whether this organization shows on your profile." },
  "you-leave": { label: "Leave organization", description: "Stop being a member." },
  "org-profile": { label: "Organization profile", description: "Handle, type, term, time zone and the welcome note." },
  "org-access": { label: "Access & joining", description: "Who can join and how." },
  "org-people": { label: "People & roles", description: "Role names and what each role can do." },
  "org-projects": { label: "Projects", description: "Who creates projects inside the organization and who can be added to them." },
};

const YOU: OrgSettingsSectionId[] = ["you-membership", "you-leave"];
// The project sections an org keeps, in report §21.2 order; open roles don't apply (people join with the code).
// Same order as the Settings document renders them, so the rail and the page agree.
const ORG_FOR_ADMINS: Array<OrgSettingsSectionId | ProjectSettingsSectionId> = [
  "org-profile", "links", "access", "org-access", "org-people", "org-projects", "collaborators",
  "readme", "updates", "tasks-workflow", "files-workspace", "notifications", "privacy-policies", "privacy-terms",
];

/**
 * Settings sections by org role (report §21.4): everyone gets the You sections first; admins add the org
 * sections; the owner adds General (name, picture) and the danger zone.
 */
export function orgSettingsSectionIds(role: OrgMemberRole): Array<OrgSettingsSectionId | ProjectSettingsSectionId> {
  if (role === "member" || role === "viewer") return YOU;
  if (role === "admin") return [...YOU, ...ORG_FOR_ADMINS];
  return [...YOU, "general", ...ORG_FOR_ADMINS, "danger"];
}

/** Any IANA zone or alias the runtime knows (Asia/Kolkata as well as Asia/Calcutta). */
function isTimeZone(tz: string) {
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
    welcome_note: z.string().trim().max(2000).nullable().optional(),
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
  }).strict(),
  notifications: z.object({
    admin_digest: z.enum(["daily", "instant"]).optional(),
  }).strict(),
} as const;

export type OrgSettingsSection = keyof typeof ORG_SETTINGS_PATCH;

/** Who saves which section (report §21.2): role names are the owner's; the rest is owners and admins. */
export const ORG_SECTION_OWNER_ONLY: Record<OrgSettingsSection, boolean> = { profile: false, access: false, people: true, projects: false, notifications: false };

/** The child-project rules an org enforces (report §21.7), read from org_settings with their defaults. */
export function readOrgRules(orgSettings: unknown): { childCreation: "members" | "admins"; outsidePeople: boolean; visibilityCap: VisibilityCap } {
  const s = (orgSettings ?? {}) as { childCreation?: unknown; outsidePeople?: unknown; visibilityCap?: unknown };
  return {
    childCreation: s.childCreation === "admins" ? "admins" : "members",
    outsidePeople: s.outsidePeople === true,
    visibilityCap: s.visibilityCap === "org" || s.visibilityCap === "private" ? s.visibilityCap : "public",
  };
}
