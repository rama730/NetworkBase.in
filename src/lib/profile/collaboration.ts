import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { orgRoleNames } from "@/lib/organizations/config";
import { db } from "@/lib/db";
import {
  profileCollaborationSummaries,
  profileContributionSkills,
  profileContributionStages,
  profileContributions,
  profiles,
  workspaceInvitations,
  workspaces,
  roleApplications,
  skills,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { normalizeWorkspaceDescription, normalizeWorkspaceTitle, trimDisplayText, trimOptionalDisplayText } from "@/lib/profile/display";
import { syncContributionSkills } from "@/lib/skills/service";
import { formatWorkspaceTeamRole } from "@/lib/workspaces/settings-policies";
import { filterWorkspaceLinksForAudience } from "@/lib/workspaces/social-links";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { containsLikePattern, normalizeSearchQuery } from "@/lib/search/query";
import { isUuid } from "@/lib/validations/uuid";

import { hydratePublicStory } from "@/lib/profile/contribution-story-server";
import { parseContributionStory, reconcileRecordedPositionTitles, type ContributionStory, type ResolvedStoryReference } from "@/lib/profile/contribution-story";
import { formatContributionPosition } from "@/lib/profile/contribution-position";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProfileCollaborationMemberPreview = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
};

export type ProfileCollaborationWorkspace = {
  /** Pinned to the top of the owner's Portfolio (0113). */
  pinned?: boolean;
  /** Organizations group first on Portfolio; child cards carry their org line (report §24.4). */
  kind?: "workspace" | "organization";
  cardOrg?: { title: string; slug: string | null } | null;
  id: string;
  ownerId: string;
  title: string;
  slug: string | null;
  description: string;
  shortDescription: string | null;
  coverImage: string | null;
  href: string;
  image: string | null;
  url: string;
  members: ProfileCollaborationMemberPreview[];
  userRole: string;
  roleKind: string;
  joinedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  viewCount: number | null;
  followersCount: number | null;
  category: string | null;
  visibility: string | null;
  contributionVisibility: "public" | "private";
  status: string | null;
  skills: string[];
  tags: string[];
  verified: boolean;
  githubRepoUrl?: string | null;
  externalLinks?: any;
  openRolesCount?: number | null;
};

export type ProfileCollaborationRoleStage = {
  id: string;
  contributionId: string | null;
  roleKind: string;
  roleTitle: string;
  summary: string | null;
  skills: string[];
  startDate: string | null;
  endDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  currentlyActive: boolean;
  source: string;
  verified: boolean;
  verifiedAt: string | null;
};

export type ProfileCollaborationContribution = {
  projectIdentityLinks?: ContributionStory["links"];
  presentation?: ContributionStory | null;
  draftStory?: ContributionStory | null;
  resolvedReferences?: ResolvedStoryReference[];
  draftReferences?: ResolvedStoryReference[];
  featured?: boolean;
  publishedAt?: string | null;
  projectVisibility?: string | null;
  projectStatus?: string | null;
  recordedJoinedAt?: string | null;
  membershipRole?: string | null;
  fileContributionCount?: number;
  id: string;
  projectId: string | null;
  externalKey?: string | null;
  version?: number;
  title: string;
  projectTitle: string;
  projectHref: string | null;
  projectUrl?: string | null;
  repoUrl: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt?: string | null;
  projectCreatedAt?: string | null;
  currentlyActive: boolean;
  skills: string[];
  source: string;
  verified: boolean;
  roleKind?: string;
  roleStages?: ProfileCollaborationRoleStage[];
  visibility?: "public" | "private";
  /** Organizations (report §24.5): org entries, the child's org for nesting, "Verified by <org>", org-only children. */
  projectKind?: string | null;
  parentOrg?: { id: string; title: string; slug: string | null } | null;
  orgVerified?: boolean;
  orgOnly?: boolean;
  verificationRevokedReason?: string | null;
  /** Live-fix 61: who verified it and when, and the workspace's picture. */
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  projectCoverImage?: string | null;
  /** The person dismissed the write-up nudge (report §38.6); only on their own view. */
  nudgeDismissed?: boolean;
  /** Manage organizations (report §38.2): the person's order and Show switch for an organization entry. */
  profileOrder?: number | null;
  /** Move up / Move down on the timeline (0112). */
  timelineOrder?: number | null;
  showOnProfile?: boolean | null;
  /** How the membership ended (report §10.1); null on an ended entry reads as "left". */
  endReason?: "left" | "removed" | "term_ended" | "org_deleted" | null;
  /** History labels (report §24.5): a detached child "with CSE-3A (until Nov 2026)"; a deleted org's kept name. */
  formerOrg?: { title: string; until: string } | null;
  goneOrgTitle?: string | null;
  /** Opt-in Work record on an org entry (report §24.5): counts only, never grades. */
  showWorkRecord?: boolean;
  workRecord?: { done: number; total: number; sprints: number } | null;
};

export type ProfileCollaborationSummary = {
  version: number;
  generatedAt: string;
  projects: ProfileCollaborationWorkspace[];
  contributions: ProfileCollaborationContribution[];
  stats: {
    projectsCount: number;
    visibleProjectsCount: number;
    contributionCount: number;
  };
  cacheStatus?: "hit" | "miss" | "bypass";
};

export type ProfileInviteWorkspaceOption = {
  id: string;
  title: string;
  slug: string | null;
  role: "owner" | "admin";
  href: string;
};

type ProfileProjectRow = {
  pinned?: boolean | null;
  kind?: string | null;
  parent_org_title?: string | null;
  parent_org_slug?: string | null;
  contribution_id: string | null;
  project_id: string;
  owner_id: string;
  title: string | null;
  slug: string | null;
  description: string | null;
  short_description: string | null;
  cover_image: string | null;
  category: string | null;
  view_count: number | string | null;
  followers_count: number | string | null;
  tags: unknown;
  skills: unknown;
  visibility: string | null;
  status: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  github_repo_url?: string | null;
  external_links?: unknown;
  open_roles_count?: number | string | null;
  user_role: string | null;
  joined_at: Date | string | null;
  contribution_started_at: Date | string | null;
  contribution_ended_at: Date | string | null;
  contribution_visibility: "public" | "private" | null;
  contribution_source: string | null;
  accepted_role_title: string | null;
  contribution_role_title: string | null;
  lead_focus: string | null;
  contribution_summary: string | null;
  contribution_skills: unknown;
  member_previews: unknown;
  total_count: number | string;
};

type ProfileContributionRow = {
  nudge_dismissed_at?: Date | string | null;
  profile_order?: number | null;
  timeline_order?: number | null;
  show_on_profile?: boolean | null;
  end_reason?: string | null;
  org_type?: string | null;
  org_role_names?: unknown;
  member_title?: string | null;
  show_work_record?: boolean | null;
  work_record?: { done?: number; total?: number; sprints?: number } | null;
  former_org?: { title?: string; until?: string } | null;
  gone_org_title?: string | null;
  project_kind?: string | null;
  parent_org_id?: string | null;
  parent_org_title?: string | null;
  parent_org_slug?: string | null;
  org_verified?: boolean | null;
  verified_by_name?: string | null;
  project_cover_image?: string | null;
  project_link_hidden?: boolean | null;
  verification_revoked_reason?: string | null;
  project_github_repo_url: string | null;
  project_external_links: unknown;
  recorded_joined_at: Date | string | null;
  presentation: unknown;
  draft_story: unknown;
  featured: boolean;
  published_at: Date | string | null;
  file_contribution_count?: number;
  contribution_id: string;
  project_id: string | null;
  external_key: string | null;
  version: number | string;
  project_title_override: string | null;
  project_url: string | null;
  repository_url: string | null;
  project_title: string | null;
  project_slug: string | null;
  project_visibility: string | null;
  project_status: string | null;
  project_owner_id: string | null;
  membership_role: string | null;
  accepted_role_title: string | null;
  lead_focus: string | null;
  role_kind: string;
  role_title: string | null;
  summary: string | null;
  canonical_skills: unknown;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  created_at?: Date | string | null;
  project_created_at?: Date | string | null;
  source: string;
  verified_at: Date | string | null;
  visibility: "public" | "private";
  role_stages: unknown;
  total_count: number | string;
};

// v7: members-only project links removed from cached summaries (AUTH-013).
const SUMMARY_VERSION = 8;
const SUMMARY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 12;
const EMPTY_SUMMARY: ProfileCollaborationSummary = {
  version: SUMMARY_VERSION,
  generatedAt: "",
  projects: [],
  contributions: [],
  stats: {
    projectsCount: 0,
    visibleProjectsCount: 0,
    contributionCount: 0,
  },
};

function nowIso() {
  return new Date().toISOString();
}

function buildProjectHref(project: { id: string; slug: string | null }) {
  return project.slug ? `/workspaces/${project.slug}` : `/workspaces/${project.id}`;
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toShortDate(value: Date | string | null | undefined) {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => trimDisplayText(item)).filter(Boolean).slice(0, 12);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return stringArray(parsed);
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
    }
  }
  return [];
}

function defaultRoleTitle(roleKind: string | null | undefined) {
  switch (roleKind) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
    default:
      return "Contributor";
  }
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (typeof value === "string") {
    try {
      return objectArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function memberPreviews(value: unknown): ProfileCollaborationMemberPreview[] {
  return objectArray(value).map((member) => ({
    id: trimDisplayText(member.id),
    displayName: trimDisplayText(member.displayName) || trimDisplayText(member.fullName) || trimDisplayText(member.username) || "Member",
    username: trimOptionalDisplayText(member.username),
    avatarUrl: trimOptionalDisplayText(member.avatarUrl),
  })).filter((member) => member.id).slice(0, 3);
}

function roleLabel(row: ProfileProjectRow) {
  const roleKind = trimDisplayText(row.user_role) || (row.owner_id ? "member" : "contributor");
  const projectRoleTitle = trimDisplayText(row.contribution_role_title) || trimDisplayText(row.accepted_role_title);
  if (!['owner', 'admin', 'member', 'viewer'].includes(roleKind)) {
    return projectRoleTitle || defaultRoleTitle(roleKind);
  }
  return formatWorkspaceTeamRole({
    membershipRole: roleKind,
    projectRoleTitle,
    leadFocus: row.lead_focus,
  });
}

function roleStageFromObject(stage: Record<string, unknown>, fallbackContributionId: string | null): ProfileCollaborationRoleStage | null {
  const id = trimDisplayText(stage.id);
  const roleKind = trimDisplayText(stage.roleKind) || trimDisplayText(stage.role_kind) || "contributor";
  const roleTitle = trimDisplayText(stage.roleTitle) || trimDisplayText(stage.role_title) || defaultRoleTitle(roleKind);
  if (!id && !roleTitle) return null;
  const endedAt = toIsoDate((stage.endedAt ?? stage.ended_at) as Date | string | null | undefined);
  const verifiedAt = toIsoDate((stage.verifiedAt ?? stage.verified_at) as Date | string | null | undefined);
  const currentlyActive = !endedAt;
  return {
    id: id || `${fallbackContributionId ?? "manual"}:${roleTitle}`,
    contributionId: trimOptionalDisplayText(stage.contributionId ?? stage.contribution_id) ?? fallbackContributionId,
    roleKind,
    roleTitle,
    summary: trimOptionalDisplayText(stage.summary),
    // Stage-specific JSON skills are retired. The normalized contribution edge
    // is applied after parsing so one relational source drives every stage.
    skills: [],
    startDate: toShortDate((stage.startedAt ?? stage.started_at) as Date | string | null | undefined),
    endDate: toShortDate((stage.endedAt ?? stage.ended_at) as Date | string | null | undefined),
    startedAt: toIsoDate((stage.startedAt ?? stage.started_at) as Date | string | null | undefined),
    endedAt,
    currentlyActive,
    source: trimDisplayText(stage.source) || "membership",
    verified: Boolean(verifiedAt),
    verifiedAt,
  };
}

function roleStages(value: unknown, fallbackContributionId: string | null): ProfileCollaborationRoleStage[] {
  return objectArray(value)
    .map((stage) => roleStageFromObject(stage, fallbackContributionId))
    .filter((stage): stage is ProfileCollaborationRoleStage => Boolean(stage))
    .sort((left, right) => {
      if (left.currentlyActive !== right.currentlyActive) return left.currentlyActive ? -1 : 1;
      return String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? ""));
    });
}

function projectFromRow(row: ProfileProjectRow): ProfileCollaborationWorkspace {
  const title = normalizeWorkspaceTitle(row.title);
  const description = normalizeWorkspaceDescription(row.description, row.short_description);
  const href = buildProjectHref({ id: row.project_id, slug: row.slug });
  const roleKind = trimDisplayText(row.user_role) || "contributor";
  return {
    kind: row.kind === "organization" ? "organization" : "workspace",
    cardOrg: row.parent_org_title ? { title: row.parent_org_title, slug: row.parent_org_slug ?? null } : null,
    id: row.project_id,
    ownerId: row.owner_id,
    title,
    slug: row.slug,
    description,
    shortDescription: trimOptionalDisplayText(row.short_description),
    coverImage: trimOptionalDisplayText(row.cover_image),
    href,
    image: trimOptionalDisplayText(row.cover_image),
    url: href,
    members: memberPreviews(row.member_previews),
    userRole: roleLabel(row),
    roleKind,
    joinedAt: toIsoDate(row.contribution_started_at) ?? toIsoDate(row.joined_at),
    createdAt: toIsoDate(row.created_at),
    updatedAt: toIsoDate(row.updated_at),
    viewCount: numberOrNull(row.view_count),
    followersCount: numberOrNull(row.followers_count),
    category: trimOptionalDisplayText(row.category),
    visibility: trimOptionalDisplayText(row.visibility),
    contributionVisibility: row.contribution_visibility === "private" ? "private" : "public",
    status: trimOptionalDisplayText(row.status),
    skills: stringArray(row.skills).length ? stringArray(row.skills) : stringArray(row.contribution_skills),
    tags: stringArray(row.tags),
    verified: true,
    githubRepoUrl: trimOptionalDisplayText(row.github_repo_url),
    // Profile portfolios and the shared public summary are public projections:
    // members-only project links never leave the project page (AUTH-013).
    externalLinks: filterWorkspaceLinksForAudience(row.external_links, false),
    openRolesCount: numberOrNull(row.open_roles_count) ?? 0,
    pinned: row.pinned === true,
  };
}

function contributionRoleLabel(row: ProfileContributionRow) {
  if (!row.project_id) return trimDisplayText(row.role_title) || "Contributor";
  // Report §4.4: an organization entry reads "Teacher · Course Instructor", in the organization's own role names.
  if (row.project_kind === "organization") {
    const role = (trimDisplayText(row.membership_role) || trimDisplayText(row.role_kind)) as "owner" | "admin" | "member" | "viewer" | "";
    const name = role && role in { owner: 1, admin: 1, member: 1, viewer: 1 } ? orgRoleNames(row.org_type, { roleNames: row.org_role_names })[role] : null;
    const label = [name, trimDisplayText(row.member_title)].filter(Boolean).join(" · ");
    if (label) return label;
  }
  const membershipRole = trimDisplayText(row.membership_role) || trimDisplayText(row.role_kind) || "member";
  // Live-fix 58: the owner of a team workspace in an organization leads it; "Contributor" is only for when nothing is known.
  // The stored "Contributor" is only the default, so it counts as not known (the live entry had it).
  const storedTitle = trimDisplayText(row.role_title);
  if (membershipRole === "owner" && row.parent_org_id && !trimDisplayText(row.lead_focus) && !trimDisplayText(row.accepted_role_title) && (!storedTitle || storedTitle === "Contributor")) return "Team lead";
  return formatContributionPosition({
    title: row.role_title,
    projectPosition: membershipRole === "owner"
      ? row.lead_focus || row.accepted_role_title
      : row.accepted_role_title,
  });
}

function contributionFromRow(row: ProfileContributionRow): ProfileCollaborationContribution {
  const visibility: "public" | "private" = row.visibility === "private" ? "private" : "public";
  const contributionSkills = stringArray(row.canonical_skills);
  const formattedRole = contributionRoleLabel(row);
  const stages = roleStages(row.role_stages, row.contribution_id).map((stage) => ({
    ...stage,
    roleTitle: row.project_id
      ? formattedRole === "Team lead" && stage.roleTitle === "Contributor"
        ? "Team lead"
        : formatContributionPosition({
          title: stage.roleTitle,
          projectPosition: stage.currentlyActive ? formattedRole : null,
        })
      : stage.roleTitle,
    skills: contributionSkills,
  }));
  const fallbackStage: ProfileCollaborationRoleStage = {
    id: `${row.contribution_id}:current`,
    contributionId: row.contribution_id,
    roleKind: trimDisplayText(row.role_kind) || "contributor",
    roleTitle: formattedRole,
    summary: trimOptionalDisplayText(row.summary),
    skills: contributionSkills,
    startDate: toShortDate(row.started_at),
    endDate: toShortDate(row.ended_at),
    startedAt: toIsoDate(row.started_at),
    endedAt: toIsoDate(row.ended_at),
    currentlyActive: !row.ended_at,
    source: trimDisplayText(row.source) || "membership",
    verified: Boolean(row.verified_at),
    verifiedAt: toIsoDate(row.verified_at),
  };
  const normalizedStages = stages.length ? stages : [fallbackStage];
  const activeStage = normalizedStages.find((stage) => stage.currentlyActive) ?? normalizedStages[0] ?? fallbackStage;
  const projectTitle = row.project_id
    ? normalizeWorkspaceTitle(row.project_title)
    : trimDisplayText(row.project_title_override) || "External project";
  const projectHref = row.project_link_hidden
    ? null
    : row.project_id
      ? buildProjectHref({ id: row.project_id, slug: row.project_slug })
      : trimOptionalDisplayText(row.project_url);
  const publicProjectLinks=filterWorkspaceLinksForAudience(row.project_external_links,false);
  const website=publicProjectLinks.find(link=>link.purpose==='live-product'||link.platform==='website');
  const repository=publicProjectLinks.find(link=>link.purpose==='source-code');
  const repositoryIsMembersOnly=filterWorkspaceLinksForAudience(row.project_external_links,true).some(link=>link.audience==='members'&&link.url===row.project_github_repo_url);
  const identityLinks:ContributionStory["links"] = row.project_id ? [
    ...(website?[{id:row.contribution_id,label:'Workspace website',url:website.url}]:[]),
    ...(repository||(row.project_github_repo_url&&!repositoryIsMembersOnly)?[{id:row.contribution_id,label:'Repository',url:repository?.url??row.project_github_repo_url!}]:[]),
  ] : [];
  return {
    projectIdentityLinks:identityLinks,
    presentation: reconcileRecordedPositionTitles(parseContributionStory(row.presentation), normalizedStages),
    draftStory: reconcileRecordedPositionTitles(parseContributionStory(row.draft_story), normalizedStages),
    featured: Boolean(row.featured),
    publishedAt: toIsoDate(row.published_at),
    projectVisibility: row.project_visibility,
    projectStatus: row.project_status,
    recordedJoinedAt: toShortDate(row.recorded_joined_at),
    membershipRole: row.membership_role,
    fileContributionCount: Number(row.file_contribution_count || 0),
    id: row.contribution_id,
    projectId: row.project_id,
    externalKey: row.external_key,
    version: Number(row.version) || 1,
    title: activeStage.roleTitle,
    projectTitle,
    projectHref,
    projectUrl: trimOptionalDisplayText(row.project_url),
    repoUrl: trimOptionalDisplayText(row.repository_url),
    description: trimOptionalDisplayText(row.summary) ?? activeStage.summary,
    startDate: toShortDate(row.started_at),
    endDate: toShortDate(row.ended_at),
    createdAt: toIsoDate(row.created_at),
    projectCreatedAt: toIsoDate(row.project_created_at),
    currentlyActive: !row.ended_at,
    skills: contributionSkills,
    source: trimDisplayText(row.source) || "membership",
    verified: Boolean(row.verified_at) || Boolean(row.project_id),
    roleKind: trimDisplayText(row.role_kind) || "contributor",
    roleStages: normalizedStages,
    visibility,
    projectKind: row.project_kind ?? null,
    endReason: (row.end_reason as ProfileCollaborationContribution["endReason"]) ?? null,
    profileOrder: row.profile_order ?? null,
    timelineOrder: row.timeline_order ?? null,
    nudgeDismissed: Boolean(row.nudge_dismissed_at),
    showOnProfile: row.show_on_profile ?? null,
    parentOrg: row.parent_org_id ? { id: row.parent_org_id, title: row.parent_org_title ?? "Organization", slug: row.parent_org_slug ?? null } : null,
    orgVerified: Boolean(row.org_verified),
    verifiedByName: row.verified_by_name ?? null,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
    projectCoverImage: row.project_cover_image ?? null,
    orgOnly: row.project_visibility === "org",
    verificationRevokedReason: row.verification_revoked_reason ?? null,
    formerOrg: row.former_org?.title && row.former_org.until ? { title: row.former_org.title, until: row.former_org.until } : null,
    goneOrgTitle: row.gone_org_title ?? null,
    showWorkRecord: Boolean(row.show_work_record),
    workRecord: row.work_record ? { done: Number(row.work_record.done ?? 0), total: Number(row.work_record.total ?? 0), sprints: Number(row.work_record.sprints ?? 0) } : null,
    ...(row.gone_org_title ? { projectTitle: row.gone_org_title, projectHref: null, projectKind: "organization" } : {}),
  };
}

async function queryProfileProjectRows(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
}) {
  const includePrivate = Boolean(options.includePrivate);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 48);
  const offset = Math.max(options.offset ?? 0, 0);
  const visibilitySql = includePrivate
    ? sql`TRUE`
    : sql`p.visibility IN ('public', 'unlisted') AND p.status <> 'draft'`;

  const rows = await db.execute<ProfileProjectRow>(sql`
    WITH user_project_candidates AS (
      SELECT id FROM ${workspaces} WHERE owner_id = ${profileId}::uuid AND deleted_at IS NULL
      UNION
      SELECT workspace_id AS id FROM workspace_members WHERE user_id = ${profileId}::uuid
      UNION
      SELECT workspace_id AS id FROM ${profileContributions} WHERE profile_id = ${profileId}::uuid AND deleted_at IS NULL AND workspace_id IS NOT NULL
    ),
    project_scope AS (
      SELECT
        pc.id AS contribution_id,
        p.id AS project_id,
        p.owner_id,
        p.title,
        p.slug,
        p.description,
        p.short_description,
        p.cover_image,
        p.category,
        p.view_count,
        p.followers_count,
        p.tags,
        p.skills,
        p.visibility,
        p.status,
        p.created_at,
        p.updated_at,
        p.github_repo_url,
        p.external_links,
        p.open_roles_count,
        p.kind,
        parent_org.title AS parent_org_title,
        parent_org.slug AS parent_org_slug,
        CASE
          WHEN p.owner_id = ${profileId} THEN 'owner'
          ELSE COALESCE(pm_self.role, pc.role_kind, 'contributor')
        END AS user_role,
        COALESCE(pm_self.joined_at, p.created_at) AS joined_at,
        pc.started_at AS contribution_started_at,
        pc.ended_at AS contribution_ended_at,
        pc.visibility AS contribution_visibility,
        pc.source AS contribution_source,
        ra.accepted_role_title,
        pc.role_title AS contribution_role_title,
        NULLIF(p.import_source->'metadata'->>'leadFocus', '') AS lead_focus,
        pc.summary AS contribution_summary,
        COALESCE(pc_skills.labels, '[]'::jsonb) AS contribution_skills,
        (pin.pinned_at IS NOT NULL) AS pinned,
        count(*) OVER()::int AS total_count
      FROM user_project_candidates upc
      INNER JOIN ${workspaces} p ON p.id = upc.id
      LEFT JOIN ${workspaces} parent_org
        ON parent_org.id = p.parent_id AND parent_org.kind = 'organization' AND parent_org.deleted_at IS NULL
       AND parent_org.visibility IN ('public', 'unlisted')
      LEFT JOIN workspace_members pm_self
        ON pm_self.workspace_id = p.id
       AND pm_self.user_id = ${profileId}
      LEFT JOIN profile_portfolio_pins pin
        ON pin.workspace_id = p.id
       AND pin.profile_id = ${profileId}::uuid
      LEFT JOIN ${profileContributions} pc
        ON pc.workspace_id = p.id
       AND pc.profile_id = ${profileId}
       AND pc.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(skill.name ORDER BY edge.display_order, skill.name) AS labels
        FROM ${profileContributionSkills} edge
        INNER JOIN ${skills} skill ON skill.id = edge.skill_id
        WHERE edge.contribution_id = pc.id
          AND skill.status NOT IN ('hidden', 'merged')
      ) pc_skills ON true
      LEFT JOIN LATERAL (
        SELECT accepted_role_title
        FROM ${roleApplications}
        WHERE workspace_id = p.id
          AND applicant_id = ${profileId}
          AND status = 'accepted'
        ORDER BY updated_at DESC
        LIMIT 1
      ) ra ON true
      WHERE p.deleted_at IS NULL
        AND (${visibilitySql})
        AND (${includePrivate ? sql`TRUE` : sql`NOT EXISTS (
          SELECT 1 FROM workspace_members show_pref
          WHERE show_pref.user_id = ${profileId}::uuid AND show_pref.show_on_profile = false
            AND show_pref.workspace_id = COALESCE(CASE WHEN p.kind = 'organization' THEN p.id END, p.parent_id)
        )`})
        AND (${includePrivate ? sql`TRUE` : sql`COALESCE(pc.visibility, 'public') = 'public'`})
      ORDER BY pin.pinned_at ASC NULLS LAST, p.created_at DESC, p.updated_at DESC, p.id DESC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT
      ps.*,
      COALESCE(members.member_previews, '[]'::jsonb) AS member_previews
    FROM project_scope ps
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ranked.id,
          'displayName', ranked.display_name,
          'username', ranked.username,
          'avatarUrl', ranked.avatar_url
        )
        ORDER BY ranked.member_rank
      ) AS member_previews
      FROM (
        SELECT
          pr.id,
          COALESCE(NULLIF(pr.full_name, ''), NULLIF(pr.username, ''), 'Member') AS display_name,
          pr.username,
          pr.avatar_url,
          row_number() OVER (
            ORDER BY
              CASE WHEN pr.id = ps.owner_id THEN 0 ELSE 1 END,
              pm.joined_at ASC,
              pr.id ASC
          ) AS member_rank
        FROM (
          SELECT ps.owner_id AS user_id, ps.created_at AS joined_at, 'owner'::text AS role
          UNION ALL
          SELECT pm.user_id, pm.joined_at, pm.role
          FROM workspace_members pm
          WHERE pm.workspace_id = ps.project_id
            AND pm.user_id <> ps.owner_id
        ) pm
        INNER JOIN ${profiles} pr ON pr.id = pm.user_id
        WHERE pr.deleted_at IS NULL
        ORDER BY
          CASE WHEN pr.id = ps.owner_id THEN 0 ELSE 1 END,
          pm.joined_at ASC,
          pr.id ASC
        LIMIT 3
      ) ranked
      WHERE ranked.member_rank <= 3
    ) members ON true
    ORDER BY ps.pinned DESC, ps.created_at DESC, ps.updated_at DESC, ps.project_id DESC
  `);

  return Array.from(rows);
}

async function queryProfileContributionRows(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
  stageLimit?: number;
  /** Decision 105: only the published entries in private organizations this viewer also belongs to. */
  sharedWith?: string;
}) {
  const includePrivate = Boolean(options.includePrivate);
  const sharedWith = includePrivate ? null : options.sharedWith ?? null;
  // The organization an entry belongs to: itself, or the organization a workspace sits in.
  const entryOrg = sql`COALESCE(CASE WHEN project.kind = 'organization' THEN project.id END, parent_org.id)`;
  const projectRule = sharedWith
    ? sql`project.status <> 'draft' AND (CASE WHEN project.kind = 'organization' THEN project.visibility ELSE parent_org.visibility END) = 'private'
        AND EXISTS (SELECT 1 FROM workspaces shared_org WHERE shared_org.id = ${entryOrg} AND (shared_org.owner_id = ${sharedWith}::uuid
          OR EXISTS (SELECT 1 FROM workspace_members shared_member WHERE shared_member.workspace_id = shared_org.id AND shared_member.user_id = ${sharedWith}::uuid)))
        AND (project.kind = 'organization' OR project.visibility <> 'private' OR EXISTS (SELECT 1 FROM workspace_members team WHERE team.workspace_id = project.id AND team.user_id = ${sharedWith}::uuid))`
    : sql`project.status <> 'draft' AND (project.visibility IN ('public', 'unlisted')
            -- Org only child workspaces: the member's own story, no link, when the org is public (report §24.6).
            OR (project.visibility = 'org' AND parent_org.visibility IN ('public', 'unlisted')))`;
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const stageLimit = Math.min(Math.max(options.stageLimit ?? 8, 1), 20);
  const rows = await db.execute<ProfileContributionRow>(sql`
    SELECT
      contribution.id AS contribution_id,
      contribution.created_at AS created_at,
      project.created_at AS project_created_at,
      contribution.presentation,
      contribution.featured,
      contribution.timeline_order,
      contribution.published_at,
      ${includePrivate ? sql`(SELECT d.document FROM profile_contribution_drafts d WHERE d.contribution_id=contribution.id AND d.profile_id=${profileId}::uuid)` : sql`NULL::jsonb`} AS draft_story,
      contribution.workspace_id AS project_id,
      contribution.external_key,
      contribution.version,
      contribution.project_title AS project_title_override,
      contribution.project_url,
      contribution.repository_url,
      (SELECT count(DISTINCT event.node_id)::int FROM workspace_node_events event
       INNER JOIN workspace_nodes node ON node.id=event.node_id
       WHERE event.workspace_id=contribution.workspace_id AND event.actor_id=${profileId}
         AND event.type='file_content_contributed' AND node.task_id IS NULL
         AND node.deleted_at IS NULL AND node.path NOT LIKE '/.system/%') AS file_contribution_count,
      project.github_repo_url AS project_github_repo_url,
      project.external_links AS project_external_links,
      project.title AS project_title,
      project.slug AS project_slug,
      project.visibility AS project_visibility,
      CASE WHEN project.deleted_at IS NOT NULL THEN 'deleted' ELSE project.status::text END AS project_status,
      COALESCE(member.joined_at,CASE WHEN project.owner_id=${profileId}::uuid THEN project.created_at END,
        (SELECT min(recorded.started_at) FROM profile_contribution_stages recorded WHERE recorded.contribution_id=contribution.id)) AS recorded_joined_at,
      project.owner_id AS project_owner_id,
      CASE
        WHEN project.owner_id = ${profileId} THEN 'owner'
        ELSE member.role
      END AS membership_role,
      application.accepted_role_title,
      NULLIF(project.import_source->'metadata'->>'leadFocus', '') AS lead_focus,
      contribution.role_kind,
      contribution.role_title,
      contribution.summary,
      COALESCE(contribution_skills.labels, '[]'::jsonb) AS canonical_skills,
      contribution.started_at,
      contribution.ended_at,
      contribution.source,
      contribution.verified_at,
      (SELECT COALESCE(v.full_name, v.username) FROM profiles v WHERE v.id = contribution.verified_by) AS verified_by_name,
      project.cover_image AS project_cover_image,
      contribution.visibility,
      project.kind AS project_kind,
      parent_org.id AS parent_org_id,
      parent_org.title AS parent_org_title,
      parent_org.slug AS parent_org_slug,
      CASE WHEN project.parent_id IS NULL THEN project.org_settings->'formerOrg' END AS former_org,
      (SELECT gone.title FROM workspaces gone WHERE gone.id = contribution.workspace_id AND gone.kind = 'organization' AND gone.deleted_at IS NOT NULL) AS gone_org_title,
      contribution.show_work_record,
      CASE WHEN contribution.show_work_record AND project.kind = 'organization' THEN (
        SELECT jsonb_build_object(
          'done', count(*) FILTER (WHERE c.status = 'done' AND c.review_status <> 'pending'), -- approved or finished (decision 106)
          'total', count(*),
          'sprints', (SELECT count(*) FROM workspace_sprints s WHERE s.workspace_id = project.id AND s.status IN ('active', 'completed')))
        FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.workspace_id = project.id AND m.deleted_at IS NULL
        WHERE c.deleted_at IS NULL AND c.excused_at IS NULL
          AND (c.assignee_id = contribution.profile_id OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = contribution.profile_id)))
      END AS work_record,
      contribution.verification_revoked_reason,
      contribution.end_reason,
      ${includePrivate ? sql`contribution.nudge_dismissed_at` : sql`NULL::timestamptz`} AS nudge_dismissed_at,
      CASE WHEN project.kind = 'organization' THEN project.org_type END AS org_type,
      CASE WHEN project.kind = 'organization' THEN project.org_settings->'roleNames' END AS org_role_names,
      member.title AS member_title,
      member.profile_order,
      member.show_on_profile,
      -- "Verified by <org>": an org owner or admin verified someone else's org entry (report §24.5).
      (project.kind = 'organization' AND contribution.verified_at IS NOT NULL AND contribution.verified_by IS NOT NULL
        AND contribution.verified_by <> contribution.profile_id
        AND (contribution.verified_by = project.owner_id OR EXISTS (
          SELECT 1 FROM workspace_members verifier WHERE verifier.workspace_id = project.id AND verifier.user_id = contribution.verified_by AND verifier.role = 'admin'
        ))) AS org_verified,
      ${includePrivate ? sql`false` : sql`(project.visibility = 'org')`} AS project_link_hidden,
      COALESCE(stages.role_stages, '[]'::jsonb) AS role_stages,
      count(*) OVER()::int AS total_count
    FROM ${profileContributions} contribution
    LEFT JOIN ${workspaces} project
      ON project.id = contribution.workspace_id
     AND (${includePrivate ? sql`TRUE` : sql`project.deleted_at IS NULL`})
    LEFT JOIN workspace_members member
      ON member.workspace_id = contribution.workspace_id
     AND member.user_id = ${profileId}
    LEFT JOIN ${workspaces} parent_org
      ON parent_org.id = project.parent_id
     AND parent_org.kind = 'organization'
     AND parent_org.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT accepted_role_title
      FROM ${roleApplications}
      WHERE workspace_id = contribution.workspace_id
        AND applicant_id = ${profileId}
        AND status = 'accepted'
      ORDER BY updated_at DESC
      LIMIT 1
    ) application ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(skill.name ORDER BY edge.display_order, skill.name) AS labels
      FROM ${profileContributionSkills} edge
      INNER JOIN ${skills} skill ON skill.id = edge.skill_id
      WHERE edge.contribution_id = contribution.id
        AND skill.status NOT IN ('hidden', 'merged')
    ) contribution_skills ON true
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'id', ranked.id,
            'contributionId', ranked.contribution_id,
            'roleKind', ranked.role_kind,
            'roleTitle', ranked.role_title,
            'summary', ranked.summary,
            'startedAt', ranked.started_at,
            'endedAt', ranked.ended_at,
            'source', ranked.source,
            'verifiedAt', ranked.verified_at
          ) ORDER BY ranked.stage_rank
        ) AS role_stages
      FROM (
        SELECT
          stage.*,
          row_number() OVER (
            ORDER BY CASE WHEN stage.ended_at IS NULL THEN 0 ELSE 1 END,
              stage.started_at DESC NULLS LAST, stage.created_at DESC, stage.id DESC
          ) AS stage_rank
        FROM ${profileContributionStages} stage
        WHERE stage.contribution_id = contribution.id
          AND stage.deleted_at IS NULL
        ORDER BY CASE WHEN stage.ended_at IS NULL THEN 0 ELSE 1 END,
          stage.started_at DESC NULLS LAST, stage.created_at DESC, stage.id DESC
        LIMIT ${stageLimit}
      ) ranked
    ) stages ON true
    WHERE contribution.profile_id = ${profileId}
      AND contribution.deleted_at IS NULL
      -- Report §4.3: a removal from an organization (or a workspace in one) hides the entry from everyone else.
      AND (${includePrivate ? sql`TRUE` : sql`NOT (contribution.end_reason IS NOT DISTINCT FROM 'removed' AND (project.kind = 'organization' OR parent_org.id IS NOT NULL))`})
      AND (${includePrivate ? sql`TRUE` : sql`contribution.visibility = 'public' AND (contribution.presentation IS NULL OR (contribution.presentation->>'visible'='true' AND (project.visibility IS DISTINCT FROM 'unlisted' OR contribution.presentation->>'allowUnlisted'='true')))`})
      AND (
        ${sharedWith ? sql`FALSE` : sql`contribution.workspace_id IS NULL`}
        OR (
          project.id IS NOT NULL
          AND (${includePrivate ? sql`TRUE` : sql`${projectRule}
            AND NOT EXISTS (
          SELECT 1 FROM workspace_members show_pref
          WHERE show_pref.user_id = ${profileId}::uuid AND show_pref.show_on_profile = false
            AND show_pref.workspace_id = COALESCE(CASE WHEN project.kind = 'organization' THEN project.id END, project.parent_id)
        )`})
        )
      )
    ORDER BY contribution.featured DESC,
      contribution.timeline_order ASC NULLS LAST,
      COALESCE(contribution.started_at, project.created_at, contribution.created_at) DESC NULLS LAST,
      COALESCE(project.created_at, contribution.created_at) DESC,
      contribution.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return Array.from(rows);
}

function buildSummaryFromRows(
  projectRows: ProfileProjectRow[],
  contributionRows: ProfileContributionRow[],
): ProfileCollaborationSummary {
  const projectsList = projectRows.map(projectFromRow);
  const contributions = contributionRows.map(contributionFromRow);
  const projectsCount = Number(projectRows[0]?.total_count ?? projectsList.length);
  const contributionCount = Number(contributionRows[0]?.total_count ?? contributions.length);

  return {
    version: SUMMARY_VERSION,
    generatedAt: nowIso(),
    projects: projectsList.slice(0, 4),
    contributions,
    stats: {
      projectsCount,
      visibleProjectsCount: projectsCount,
      contributionCount,
    },
  };
}

async function writePublicSummary(
  profileId: string,
  summary: ProfileCollaborationSummary,
  generationStartedAt: Date,
) {
  const writtenAt = new Date();
  const written = await db
    .insert(profileCollaborationSummaries)
    .values({
      profileId,
      version: SUMMARY_VERSION,
      summary,
      projectCount: summary.stats.projectsCount,
      visibleProjectCount: summary.stats.visibleProjectsCount,
      contributionCount: summary.stats.contributionCount,
      stale: false,
      refreshedAt: writtenAt,
      updatedAt: writtenAt,
    })
    .onConflictDoUpdate({
      target: profileCollaborationSummaries.profileId,
      set: {
        version: SUMMARY_VERSION,
        summary,
        projectCount: summary.stats.projectsCount,
        visibleProjectCount: summary.stats.visibleProjectsCount,
        contributionCount: summary.stats.contributionCount,
        stale: false,
        refreshedAt: writtenAt,
        updatedAt: writtenAt,
      },
      // A mutation may mark this row stale while the read query is running.
      // Never let an older snapshot overwrite that newer invalidation.
      where: lt(profileCollaborationSummaries.updatedAt, generationStartedAt),
    })
    .returning({ profileId: profileCollaborationSummaries.profileId });
  return written.length > 0;
}

export async function getProfileCollaborationSummary(profileId: string, options: {
  includePrivate?: boolean;
  preferCached?: boolean;
  maxAgeMs?: number;
} = {}): Promise<ProfileCollaborationSummary> {
  const includePrivate = Boolean(options.includePrivate);
  const preferCached = options.preferCached !== false && !includePrivate;
  const maxAgeMs = options.maxAgeMs ?? SUMMARY_TTL_MS;
  const dedupeKey = `profile-collaboration:${profileId}:${includePrivate ? "owner" : "public"}:${preferCached}:${maxAgeMs}`;
  const summary = await runInFlightDeduped(dedupeKey, () => readProfileCollaborationSummary(profileId, { includePrivate, preferCached, maxAgeMs }));
  // Reference labels and public project gates must be live even on a summary-cache hit.
  const live = summary.cacheStatus === "hit"
    ? (await queryProfileContributionRows(profileId, {includePrivate,limit:24,stageLimit:20})).map(contributionFromRow)
    : summary.contributions;
  return {...summary,contributions:await Promise.all(live.map(hydratePublicStory))};
}

async function readProfileCollaborationSummary(profileId: string, options: {
  includePrivate: boolean;
  preferCached: boolean;
  maxAgeMs: number;
}): Promise<ProfileCollaborationSummary> {
  const startedAt = Date.now();
  const generationStartedAt = new Date(startedAt);
  const { includePrivate, preferCached, maxAgeMs } = options;

  if (!profileId) return { ...EMPTY_SUMMARY, cacheStatus: "miss" };

  if (preferCached) {
    const cached = await db.query.profileCollaborationSummaries.findFirst({
      where: eq(profileCollaborationSummaries.profileId, profileId),
      columns: {
        summary: true,
        stale: true,
        refreshedAt: true,
      },
    });
    const ageMs = cached?.refreshedAt ? Date.now() - cached.refreshedAt.getTime() : Number.POSITIVE_INFINITY;
    const cachedSummary = cached?.summary as ProfileCollaborationSummary | undefined;
    if (cached && cachedSummary?.version === SUMMARY_VERSION && !cached.stale && ageMs <= maxAgeMs) {
      logger.metric("profile.collaboration.summary", {
        profileId,
        cacheStatus: "hit",
        includePrivate,
        durationMs: Date.now() - startedAt,
      });
      return { ...cachedSummary, cacheStatus: "hit" };
    }
  }

  const [projectRows, contributionRows] = await Promise.all([
    queryProfileProjectRows(profileId, { includePrivate, limit: DEFAULT_LIMIT, offset: 0 }),
    queryProfileContributionRows(profileId, { includePrivate, limit: 24, offset: 0, stageLimit: 20 }),
  ]);
  const summary = buildSummaryFromRows(projectRows, contributionRows);

  if (!includePrivate) {
    const cacheWritten = await writePublicSummary(profileId, summary, generationStartedAt);
    if (!cacheWritten) {
      logger.metric("profile.collaboration.cache_write_skipped", {
        profileId,
        reason: "newer_invalidation",
      });
    }
  }

  logger.metric("profile.collaboration.summary", {
    profileId,
    cacheStatus: includePrivate ? "bypass" : "miss",
    includePrivate,
    projectCount: summary.stats.projectsCount,
    contributionCount: summary.stats.contributionCount,
    durationMs: Date.now() - startedAt,
  });
  return { ...summary, cacheStatus: includePrivate ? "bypass" : "miss" };
}

/**
 * Decision 105: a private organization's entries show only to the person and its members. The public summary is
 * cached for everyone, so a fellow member's extra entries come from here and are added to their view.
 */
export async function readSharedPrivateOrgContributions(profileId: string, viewerId: string | null | undefined) {
  if (!viewerId || viewerId === profileId) return [];
  const rows = await queryProfileContributionRows(profileId, { sharedWith: viewerId, limit: 50 });
  return Promise.all(rows.map(contributionFromRow).map(hydratePublicStory));
}

export async function getProfileContributions(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
  stageLimit?: number;
} = {}) {
  const startedAt = Date.now();
  const rows = await queryProfileContributionRows(profileId, options);
  const contributions = await Promise.all(rows.map(contributionFromRow).map(hydratePublicStory));
  const total = Number(rows[0]?.total_count ?? contributions.length);
  logger.metric("profile.collaboration.contributions", {
    profileId,
    includePrivate: Boolean(options.includePrivate),
    count: contributions.length,
    total,
    durationMs: Date.now() - startedAt,
  });
  return {
    contributions,
    total,
    hasMore: (options.offset ?? 0) + contributions.length < total,
  };
}

export async function getProfilePortfolioWorkspaces(profileId: string, options: {
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
} = {}) {
  const startedAt = Date.now();
  const rows = await queryProfileProjectRows(profileId, options);
  const projectsList = rows.map(projectFromRow);
  const total = Number(rows[0]?.total_count ?? projectsList.length);
  logger.metric("profile.collaboration.portfolio", {
    profileId,
    includePrivate: Boolean(options.includePrivate),
    count: projectsList.length,
    total,
    durationMs: Date.now() - startedAt,
  });
  return {
    projects: projectsList,
    total,
    hasMore: (options.offset ?? 0) + projectsList.length < total,
  };
}

export async function getProfileInviteWorkspaceOptions(
  inviterId: string,
  targetProfileId: string,
  input: { search?: string; cursor?: string; limit?: number; projectId?: string } = {},
): Promise<{ projects: ProfileInviteWorkspaceOption[]; nextCursor: string | null }> {
  if (!inviterId || !targetProfileId || inviterId === targetProfileId) return { projects: [], nextCursor: null };
  const requestedLimit = Number(input.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 50)) : 20;
  const search = normalizeSearchQuery(input.search, 100);
  const separator = input.cursor?.indexOf("|") ?? -1;
  const cursorDate = separator > 0 ? new Date(input.cursor!.slice(0, separator)) : null;
  const cursorId = separator > 0 ? input.cursor!.slice(separator + 1) : null;
  const cursor = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId && isUuid(cursorId)
    ? { updatedAt: cursorDate, id: cursorId }
    : null;
  const rows = await db.execute<{
    id: string;
    title: string | null;
    slug: string | null;
    role: "owner" | "admin";
    updatedAt: Date | string;
  }>(sql`
    SELECT p.id, p.title, p.slug,
           CASE WHEN p.owner_id = ${inviterId} THEN 'owner' ELSE pm.role END AS role,
           p.updated_at AS "updatedAt"
    FROM ${workspaces} p
    LEFT JOIN workspace_members pm
      ON pm.workspace_id = p.id
     AND pm.user_id = ${inviterId}
    LEFT JOIN workspace_members target_pm
      ON target_pm.workspace_id = p.id
     AND target_pm.user_id = ${targetProfileId}
    WHERE p.deleted_at IS NULL
      AND target_pm.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${roleApplications} pending_application
        WHERE pending_application.workspace_id = p.id
          AND pending_application.applicant_id = ${targetProfileId}
          AND pending_application.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${workspaceInvitations} pending_invitation
        WHERE pending_invitation.workspace_id = p.id
          AND pending_invitation.candidate_id = ${targetProfileId}
          AND pending_invitation.status = 'pending'
          AND pending_invitation.expires_at > now()
      )
      AND (
        p.owner_id = ${inviterId}
        OR pm.role IN ('owner', 'admin')
      )
      ${input.projectId ? sql`AND p.id = ${input.projectId}::uuid` : sql``}
      ${search ? sql`AND p.title ILIKE ${containsLikePattern(search)} ESCAPE '\\'` : sql``}
      ${cursor ? sql`AND (p.updated_at, p.id) < (${cursor.updatedAt}, ${cursor.id}::uuid)` : sql``}
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT ${limit + 1}
  `);

  const page = Array.from(rows);
  const visible = page.slice(0, limit);
  const last = visible.at(-1);
  return {
    projects: visible.map((row) => ({
    id: row.id,
    title: normalizeWorkspaceTitle(row.title),
    slug: row.slug,
    role: row.role === "admin" ? "admin" : "owner",
    href: buildProjectHref({ id: row.id, slug: row.slug }),
    })),
    nextCursor: page.length > limit && last ? `${new Date(last.updatedAt).toISOString()}|${last.id}` : null,
  };
}

export async function markProfileCollaborationSummaryStale(
  profileIds: string | string[],
  executor: DbExecutor = db,
) {
  const ids = Array.from(new Set((Array.isArray(profileIds) ? profileIds : [profileIds]).filter(Boolean)));
  if (ids.length === 0) return;
  await executor
    .insert(profileCollaborationSummaries)
    .values(ids.map((profileId) => ({
      profileId,
      version: SUMMARY_VERSION,
      summary: EMPTY_SUMMARY,
      projectCount: 0,
      visibleProjectCount: 0,
      contributionCount: 0,
      stale: true,
      refreshedAt: new Date(0),
      updatedAt: new Date(),
    })))
    .onConflictDoUpdate({
      target: profileCollaborationSummaries.profileId,
      set: {
        stale: true,
        updatedAt: new Date(),
      },
    });
}

export async function upsertProfileWorkspaceContributionFromMembership(
  executor: DbExecutor,
  params: {
    profileId: string;
    projectId: string;
    verifiedBy: string | null;
    previousRole?: string | null;
    nextRole?: string | null;
    eventId?: string | null;
    source?: "membership" | "application" | "owner" | "role_change" | "workspace_invite" | "ownership_transfer" | "backfill";
    effectiveAt?: Date;
  },
) {
  const effectiveAt = params.effectiveAt ?? new Date();
  // Guests of an organization get no automatic entry (report §24.5); one they already have keeps its history.
  if (params.nextRole === "viewer") {
    const [guestOfOrg] = await executor.execute<{ skip: boolean }>(sql`
      SELECT true AS skip FROM workspaces p WHERE p.id = ${params.projectId} AND p.kind = 'organization'
        AND NOT EXISTS (SELECT 1 FROM ${profileContributions} c WHERE c.profile_id = ${params.profileId} AND c.workspace_id = p.id)`);
    if (guestOfOrg?.skip) return;
  }
  // Decision 3: a removed person who rejoins gets their words back as an unpublished draft, never republished.
  await executor.execute(sql`
    WITH removed AS (
      UPDATE ${profileContributions} c SET presentation = NULL, published_at = NULL
      FROM (SELECT id, presentation FROM ${profileContributions}
            WHERE profile_id = ${params.profileId} AND workspace_id = ${params.projectId} AND deleted_at IS NULL AND end_reason = 'removed' FOR UPDATE) old
      WHERE c.id = old.id
      RETURNING c.id, old.presentation)
    INSERT INTO profile_contribution_drafts (contribution_id, profile_id, document, updated_at)
    SELECT id, ${params.profileId}, presentation, now() FROM removed WHERE presentation IS NOT NULL
    ON CONFLICT (contribution_id) DO NOTHING`);
  const contributionRows = await executor.execute<{
    id: string;
    profile_id: string;
    project_id: string;
    source: string;
    role_kind: string;
    role_title: string | null;
    skills: unknown;
    started_at: Date | string | null;
    verified_at: Date | string | null;
    verified_by: string | null;
    visibility: "public" | "private";
  }>(sql`
    INSERT INTO ${profileContributions} (
      profile_id,
      workspace_id,
      source,
      role_kind,
      role_title,
      skills,
      started_at,
      verified_at,
      verified_by,
      visibility,
      updated_at
    )
    SELECT
      ${params.profileId},
      p.id,
      CASE WHEN ra.accepted_role_title IS NULL THEN
        CASE WHEN p.owner_id = ${params.profileId} THEN 'owner' ELSE 'membership' END
      ELSE 'application' END,
      CASE WHEN p.owner_id = ${params.profileId} THEN 'owner' ELSE COALESCE(pm.role, 'contributor') END,
      CASE
        WHEN p.owner_id = ${params.profileId} THEN COALESCE(NULLIF(p.import_source->'metadata'->>'leadFocus', ''), NULLIF(ra.accepted_role_title, ''), 'Owner')
        WHEN pm.role = 'admin' THEN COALESCE(NULLIF(ra.accepted_role_title, ''), 'Admin')
        WHEN pm.role = 'viewer' THEN COALESCE(NULLIF(ra.accepted_role_title, ''), 'Viewer')
        ELSE COALESCE(NULLIF(ra.accepted_role_title, ''), 'Member')
      END,
      COALESCE(p.skills, '[]'::jsonb),
      COALESCE(pm.joined_at, p.created_at),
      now(),
      ${params.verifiedBy},
      'public',
      now()
    FROM ${workspaces} p
    LEFT JOIN workspace_members pm
      ON pm.workspace_id = p.id
     AND pm.user_id = ${params.profileId}
    LEFT JOIN LATERAL (
      SELECT accepted_role_title
      FROM ${roleApplications}
      WHERE workspace_id = p.id
        AND applicant_id = ${params.profileId}
        AND status = 'accepted'
      ORDER BY updated_at DESC
      LIMIT 1
    ) ra ON true
    WHERE p.id = ${params.projectId}
      AND p.deleted_at IS NULL
      AND (p.owner_id = ${params.profileId} OR pm.id IS NOT NULL)
    ON CONFLICT (profile_id, workspace_id) WHERE deleted_at IS NULL AND workspace_id IS NOT NULL DO UPDATE SET
      source = EXCLUDED.source,
      role_kind = EXCLUDED.role_kind,
      role_title = EXCLUDED.role_title,
      skills = EXCLUDED.skills,
      started_at = COALESCE(${profileContributions.startedAt}, EXCLUDED.started_at),
      verified_at = EXCLUDED.verified_at,
      verified_by = COALESCE(EXCLUDED.verified_by, ${profileContributions.verifiedBy}),
      -- Rejoining starts a new period; the old one stays in the position history (report §10.1).
      ended_at = NULL, end_reason = NULL, ended_by = NULL, end_note = NULL,
      updated_at = now()
    RETURNING id, profile_id, workspace_id AS project_id, source, role_kind, role_title, skills, started_at, verified_at, verified_by, visibility
  `);
  const contribution = Array.from(contributionRows)[0];
  if (contribution) {
    const previousRole = trimOptionalDisplayText(params.previousRole);
    const nextRole = trimDisplayText(params.nextRole) || contribution.role_kind;
    const shouldCreateNewStage = !previousRole || previousRole !== nextRole || Boolean(params.eventId);

    if (shouldCreateNewStage) {
      await executor
        .update(profileContributionStages)
        .set({ endedAt: effectiveAt, updatedAt: new Date() })
        .where(and(
          eq(profileContributionStages.contributionId, contribution.id),
          isNull(profileContributionStages.endedAt),
          isNull(profileContributionStages.deletedAt),
        ));

      await executor
        .insert(profileContributionStages)
        .values({
          contributionId: contribution.id,
          profileId: params.profileId,
          projectId: params.projectId,
          source: params.source ?? (contribution.source === "owner" ? "owner" : contribution.source === "application" ? "application" : "membership"),
          roleKind: contribution.role_kind as "owner" | "admin" | "member" | "viewer" | "contributor",
          roleTitle: contribution.role_title || defaultRoleTitle(contribution.role_kind),
          skills: stringArray(contribution.skills),
          startedAt: effectiveAt,
          verifiedAt: new Date(),
          verifiedBy: params.verifiedBy,
          eventId: params.eventId ?? null,
          visibility: contribution.visibility,
          manualOverride: false,
        })
        .onConflictDoNothing();
    }
    await syncContributionSkills(executor, contribution.id, stringArray(contribution.skills), params.profileId);
  }
  await markProfileCollaborationSummaryStale(params.profileId, executor);
}

/** How a membership ended (report §10.1): leaving keeps credit; removal also withdraws verification (§4.3). */
export type MembershipEnding = { reason: "left" | "removed"; by: string | null; note?: string | null; orgTitle?: string | null };

export async function endProfileWorkspaceContributionMembership(
  executor: DbExecutor,
  params: { profileId: string; projectId: string; verifiedBy: string | null; eventId?: string | null; endedAt?: Date; ending?: MembershipEnding },
) {
  const endedAt = params.endedAt ?? new Date();
  const ending = params.ending;
  await executor
    .update(profileContributions)
    .set({
      endedAt, updatedAt: new Date(),
      ...(ending ? { endReason: ending.reason, endedBy: ending.by, endNote: ending.note?.trim().slice(0, 500) || null } : {}),
      // Verification speaks for the organization, so removal withdraws it, and the person sees why.
      ...(ending?.reason === "removed" ? { verifiedAt: null, verifiedBy: null, verificationRevokedReason: `Removed from ${ending.orgTitle || "the organization"}` } : {}),
    })
    .where(and(
      eq(profileContributions.profileId, params.profileId),
      eq(profileContributions.projectId, params.projectId),
      isNull(profileContributions.deletedAt),
    ));

  await executor
    .update(profileContributionStages)
    .set({ endedAt, updatedAt: new Date() })
    .where(and(
      eq(profileContributionStages.profileId, params.profileId),
      eq(profileContributionStages.projectId, params.projectId),
      isNull(profileContributionStages.endedAt),
      isNull(profileContributionStages.deletedAt),
    ));
  await markProfileCollaborationSummaryStale(params.profileId, executor);
}

export async function markWorkspaceCollaboratorsSummaryStale(projectId: string, executor: DbExecutor = db) {
  if (!projectId) return;
  const rows = await executor
    .select({ profileId: profileContributions.profileId })
    .from(profileContributions)
    .where(and(eq(profileContributions.projectId, projectId), isNull(profileContributions.deletedAt)));
  if (rows.length > 0) {
    await markProfileCollaborationSummaryStale(rows.map((row) => row.profileId), executor);
  }
}
