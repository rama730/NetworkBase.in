import { readChildOrgLink, readOrgDetail, readViewerOrgRole, type OrgDetail, type ParentOrgLink } from "@/lib/organizations/detail";
import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { profiles, projectFollows, projectMembers, projectOpenRoles, projectDocs, projectDocVersions, projectGuidanceAppointments, roleApplications } from "@/lib/db/schema";
import { eq, sql, desc, and, inArray } from "drizzle-orm";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { buildProjectOwnerPresentation } from "@/lib/privacy/presentation";
import { logger } from "@/lib/logger";
import { unstable_cache } from "next/cache";
import { computeProjectReadAccess, getProjectAccessById } from "@/lib/data/workspace-access";
import { resolveProjectDocPermission } from "@/lib/workspaces/doc";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import type { Project } from "@/types/discover";
import { clearSealedGithubTokenFromImportSource } from "@/lib/github/repo-security";
import { filterProjectLinksForAudience, normalizeProjectSocialLinks } from "@/lib/workspaces/social-links";
import { normalizeProjectPublicTabVisibility } from "@/lib/workspaces/settings-policies";
import { normalizeJourneyCompletionDates } from "@/lib/workspaces/journey-completion";
import { isLooseUuid } from "@/lib/validations/uuid";
import { createClient } from "@/lib/supabase/server";
import { isProjectDetailMemberRole, retryProjectDetailRead, PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, resolveProjectDetailTarget, PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, resolveProjectDetailViewerState } from "./common";


const PROJECT_DETAIL_MEMBER_PAGE_SIZE = 20;

const PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE = 50;


const projectDetailInputSchema = z.object({
  slugOrId: z.string().trim().min(1).max(200),
});


const projectDetailMemberRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "viewer",
]);

const projectDetailProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  displayName: z.string().optional(),
  isMasked: z.boolean().optional(),
  canOpenProfile: z.boolean().optional(),
  badgeText: z.string().nullable().optional(),
});


const projectDetailOpenRoleSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  role: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  count: z.number().int().nonnegative(),
  filled: z.number().int().nonnegative(),
  skills: z.array(z.string()).nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});


const projectDetailCollaboratorSchema = z.object({
  userId: z.string().uuid(),
  membershipRole: projectDetailMemberRoleSchema,
  joinedAt: z.string().nullable(),
  user: projectDetailProfileSchema.nullable(),
  projectRoleTitle: z.string().nullable(),
});


const projectDetailGuidanceSchema = z.object({
  id: z.string().uuid(),
  guideUserId: z.string().uuid(),
  label: z.string().min(1),
  reviewAt: z.date().nullable(),
  publicAttributionConsent: z.boolean(),
  fullName: z.string().nullable(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});


const projectDetailProjectSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  title: z.string().min(1),
  slug: z.string().min(1).optional(),
  description: z.string().nullable(),
  shortDescription: z.string().nullable(),
  problemStatement: z.string().nullable(),
  solutionStatement: z.string().nullable(),
  coverImage: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  skills: z.array(z.string()),
  externalLinks: z.union([
    z.record(z.string(), z.string()),
    z.array(
      z.object({
        id: z.string(),
        url: z.string(),
        platform: z.string().optional(),
        label: z.string().optional(),
        destinationLabel: z.string().optional(),
        purpose: z.enum(["live-product", "source-code", "documentation", "design-prototype", "research-publication", "dataset-model", "demo-media", "community", "distribution-store", "roadmap-operations", "support-contact", "commerce-funding", "other"]).optional(),
        audience: z.enum(["public", "members"]).optional(),
        order: z.number().optional(),
      }),
    ),
  ]),
  externalLinkMetadata: z.record(
    z.string(),
    z.object({
      health: z.enum(["unknown", "active", "unavailable"]),
      checkedAt: z.string().optional(),
      nameSource: z.enum(["provider", "open_graph", "html_title", "url", "manual"]).optional(),
      fetchedAt: z.string().optional(),
      resolvedHost: z.string().optional(),
      contentType: z.string().optional(),
    }),
  ),
  visibility: z.string(),
  publicTabVisibility: z.object({
    dashboard: z.boolean(),
    readme: z.boolean(),
    updates: z.boolean(),
    files: z.boolean(),
    sprints: z.boolean(),
    tasks: z.boolean(),
  }),
  lookingForCollaborators: z.boolean(),
  memberUpdatesEnabled: z.boolean(),
  memberFileUploadDefault: z.boolean(),
  maxCollaborators: z.string().nullable(),
  status: z.enum(["draft", "active", "completed", "archived"]),
  lifecycleStages: z.array(z.string()),
  currentStageIndex: z.number().int().nonnegative(),
  stageCompletionDates: z.record(z.string(), z.string()),
  importSource: z.unknown().nullable(),
  githubRepoUrl: z.string().nullable().optional(),
  githubDefaultBranch: z.string().nullable().optional(),
  githubSyncConnection: z
    .object({
      repository: z.string(),
      branch: z.string(),
    })
    .nullable()
    .optional(),
  syncStatus: z.enum(["pending", "cloning", "indexing", "ready", "failed"]),
  updatedAt: z.string().nullable(),
  viewCount: z.number().int().nonnegative(),
  followersCount: z.number().int().nonnegative(),
  isFollowed: z.boolean(),
  sprints: z.array(z.unknown()),
  tasks: z.array(z.unknown()),
  openRoles: z.array(projectDetailOpenRoleSchema),
  collaborators: z.array(projectDetailCollaboratorSchema),
  initialFileNodes: z.array(z.unknown()),
  owner: projectDetailProfileSchema.nullable(),
  membersHasMore: z.boolean(),
  membersNextCursor: z.string().nullable(),
  hasPublishedReadme: z.boolean(),
  readmeExcerpt: z.string().nullable(),
  readmeUpdatedAt: z.string().nullable(),
  readmeVersionNumber: z.number().int().positive().nullable(),
  isOwner: z.boolean(),
  isMember: z.boolean(),
  memberRole: projectDetailMemberRoleSchema.nullable(),
  guidance: projectDetailGuidanceSchema.nullable(),
  /** Organizations only (report §18.9); null for every other project. */
  organization: z.custom<OrgDetail>().nullable(),
  /** Child projects only (report §18.4, §21.6): the parent org as this viewer may see it. */
  parentOrg: z.custom<ParentOrgLink>().nullable(),
  /** A personal project's pending request to move into an org (report §14.7). */
  pendingMoveIn: z.object({ orgId: z.string(), orgTitle: z.string() }).nullable(),
  moveTargets: z.array(z.object({ id: z.string(), title: z.string() })),
});


const projectDetailReadDataSchema = z.object({
  identity: z.object({
    projectId: z.string().uuid(),
    routeSlug: z.string(),
    canonicalSlug: z.string().nullable(),
  }),
  capabilities: z.object({
    canRead: z.boolean(),
    canWrite: z.boolean(),
    isOwner: z.boolean(),
    isMember: z.boolean(),
    memberRole: projectDetailMemberRoleSchema.nullable(),
    isFollowed: z.boolean(),
  }),
  project: projectDetailProjectSchema,
});


type ProjectDetailReadData = z.infer<typeof projectDetailReadDataSchema>;


export type ProjectDetailShellResult =
  | {
      success: true;
      data: ProjectDetailReadData;
    }
  | {
      success: false;
      errorCode: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_ERROR";
      message: string;
    };


export type ProjectDetailMetadataRead = {
  projectId: string;
  ownerId: string;
  slug: string | null;
  title: string;
  shortDescription: string | null;
  description: string | null;
  readmeExcerpt: string | null;
  coverImage: string | null;
};


async function fetchProjectDetailShellData(
  projectId: string,
  ownerId: string,
  includeFollowersCount: boolean,
  viewerId: string | null,
  projectVisibility: string,
  canSeePrivateAttribution: boolean,
  prefetchedOwner?: {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  } | null,
) {
  const startedAt = performance.now();
  const ownerQuery =
    prefetchedOwner !== undefined
      ? Promise.resolve(prefetchedOwner ? [prefetchedOwner] : [])
      : db
          .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
          })
          .from(profiles)
          .where(eq(profiles.id, ownerId))
          .limit(1);

  const [ownerRows, followersResult, membersResult, rolesResult, readmeRows, guidanceRows] =
    await Promise.all([
      ownerQuery,
      includeFollowersCount
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(projectFollows)
            .where(eq(projectFollows.projectId, projectId))
        : Promise.resolve([]),
      db
        .select({
          membershipId: projectMembers.id,
          userId: projectMembers.userId,
          membershipRole: projectMembers.role,
          joinedAt: projectMembers.joinedAt,
          profileId: profiles.id,
          username: profiles.username,
          fullName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
          // The count stays the full number even when people hide themselves (report §20.8).
          totalCount: sql<number>`(SELECT count(*) FROM project_members WHERE project_id = ${projectId})::int`,
        })
        .from(projectMembers)
        .leftJoin(profiles, eq(projectMembers.userId, profiles.id))
        // Outsiders see only people with "Show on my profile" on (report §20.8).
        .where(and(eq(projectMembers.projectId, projectId), canSeePrivateAttribution ? undefined : eq(projectMembers.showOnProfile, true)))
        .orderBy(desc(projectMembers.joinedAt), desc(projectMembers.id))
        .limit(PROJECT_DETAIL_MEMBER_PAGE_SIZE + 1),
      db
        .select({
          id: projectOpenRoles.id,
          projectId: projectOpenRoles.projectId,
          role: projectOpenRoles.role,
          title: projectOpenRoles.title,
          description: projectOpenRoles.description,
          count: projectOpenRoles.count,
          filled: projectOpenRoles.filled,
          skills: projectOpenRoles.skills,
          createdAt: projectOpenRoles.createdAt,
          updatedAt: projectOpenRoles.updatedAt,
          totalCount: sql<number>`count(*) over ()::int`,
        })
        .from(projectOpenRoles)
        .where(eq(projectOpenRoles.projectId, projectId))
        .orderBy(
          desc(projectOpenRoles.updatedAt),
          desc(projectOpenRoles.createdAt),
          desc(projectOpenRoles.id),
        )
        .limit(PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE + 1),
      db
        .select({
          publishedVersionId: projectDocs.publishedVersionId,
          settings: projectDocs.settings,
          versionNumber: projectDocVersions.versionNumber,
          excerpt: projectDocVersions.excerpt,
          createdAt: projectDocVersions.createdAt,
        })
        .from(projectDocs)
        .leftJoin(
          projectDocVersions,
          eq(projectDocs.publishedVersionId, projectDocVersions.id),
        )
        .where(
          and(
            eq(projectDocs.projectId, projectId),
            eq(projectDocs.slug, "readme"),
          ),
        )
        .limit(1),
      db
        .select({
          id: projectGuidanceAppointments.id,
          guideUserId: projectGuidanceAppointments.guideUserId,
          label: projectGuidanceAppointments.label,
          reviewAt: projectGuidanceAppointments.reviewAt,
          publicAttributionConsent:
            projectGuidanceAppointments.publicAttributionConsent,
          fullName: profiles.fullName,
          username: profiles.username,
          avatarUrl: profiles.avatarUrl,
        })
        .from(projectGuidanceAppointments)
        .innerJoin(
          profiles,
          eq(profiles.id, projectGuidanceAppointments.guideUserId),
        )
        .where(
          and(
            eq(projectGuidanceAppointments.projectId, projectId),
            eq(projectGuidanceAppointments.status, "active"),
          ),
        )
        .limit(1),
    ]);

  const followersCount = includeFollowersCount
    ? Number((followersResult[0] as { count?: number } | undefined)?.count || 0)
    : undefined;

  const openRolesHasMore = rolesResult.length > PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE;
  const openRolesCount = Number(rolesResult[0]?.totalCount ?? 0);
  const openRoles = rolesResult.slice(0, PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE).map(
    ({ totalCount: _totalCount, ...role }) => role,
  );

  const hasMoreMembers = membersResult.length > PROJECT_DETAIL_MEMBER_PAGE_SIZE;
  const membersCount = Number(membersResult[0]?.totalCount ?? 0);
  const limitedMembers = membersResult.slice(
    0,
    PROJECT_DETAIL_MEMBER_PAGE_SIZE,
  );
  const lastMember = limitedMembers[limitedMembers.length - 1];
  const membersNextCursor =
    hasMoreMembers && lastMember
      ? Buffer.from(
          `${lastMember.joinedAt.toISOString()}:::${lastMember.membershipId}`,
        ).toString("base64")
      : null;

  const collaborators = limitedMembers
    .map((m) => ({
      userId: m.userId,
      membershipRole: isProjectDetailMemberRole(m.membershipRole)
        ? m.membershipRole
        : "member",
      joinedAt: m.joinedAt?.toISOString?.() ?? null,
      user: m.profileId
        ? {
            id: m.profileId,
            username: m.username,
            fullName: m.fullName,
            avatarUrl: m.avatarUrl,
          }
        : null,
    }))
    .filter((m) => m.user !== null);

  const collaboratorIds = collaborators.map((c) => c.userId);
  const ownerRow = ownerRows[0];
  const [acceptedRoleRows, ownerRelationship] = await Promise.all([
    collaboratorIds.length > 0
      ? db
          .select({
            applicantId: roleApplications.applicantId,
            roleTitle: projectOpenRoles.title,
            roleName: projectOpenRoles.role,
            updatedAt: roleApplications.updatedAt,
          })
          .from(roleApplications)
          .leftJoin(
            projectOpenRoles,
            eq(projectOpenRoles.id, roleApplications.roleId),
          )
          .where(
            and(
              eq(roleApplications.projectId, projectId),
              eq(roleApplications.status, "accepted"),
              inArray(roleApplications.applicantId, collaboratorIds),
            ),
          )
          .orderBy(desc(roleApplications.updatedAt))
      : Promise.resolve([]),
    ownerRow ? resolvePrivacyRelationship(viewerId, ownerRow.id) : Promise.resolve(null),
  ]);

  const acceptedRoleByUser = new Map<string, string>();
  for (const row of acceptedRoleRows) {
    if (acceptedRoleByUser.has(row.applicantId)) continue;
    const label = row.roleTitle || row.roleName || "";
    if (label) acceptedRoleByUser.set(row.applicantId, label);
  }

  const collaboratorsWithRoleTitle = collaborators.map((c) => ({
    ...c,
    projectRoleTitle: acceptedRoleByUser.get(c.userId) || null,
  }));

  const owner = buildProjectOwnerPresentation(
    ownerRow
      ? {
          id: ownerRow.id,
          username: ownerRow.username,
          fullName: ownerRow.fullName,
          avatarUrl: ownerRow.avatarUrl,
        }
      : null,
    ownerRelationship,
  );
  const guidanceCandidate = guidanceRows[0] ?? null;
  const guidance =
    guidanceCandidate &&
    (canSeePrivateAttribution ||
      (guidanceCandidate.publicAttributionConsent &&
        projectVisibility === "public"))
      ? guidanceCandidate
      : null;
  if (owner?.isMasked) {
    logger.metric("privacy.project.owner_masked", {
      surface: "project_detail",
      viewerId: viewerId ?? "anon",
      ownerId,
      projectId,
    });
  }

  logger.metric("project.detail.shell.data", {
    projectId,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return {
    owner,
    followersCount,
    openRoles,
    openRolesCount,
    openRolesHasMore,
    collaborators: collaboratorsWithRoleTitle,
    membersCount,
    membersHasMore: hasMoreMembers,
    membersNextCursor,
    hasPublishedReadme: Boolean(readmeRows[0]?.publishedVersionId),
    readmeSettings: readmeRows[0]?.settings ?? null,
    readmeExcerpt: readmeRows[0]?.excerpt ?? null,
    readmeUpdatedAt: readmeRows[0]?.createdAt?.toISOString?.() ?? null,
    readmeVersionNumber: readmeRows[0]?.versionNumber ?? null,
    guidance,
  };
}


const getPublicProjectDetailShellData = unstable_cache(
  async (projectId: string, ownerId: string, includeFollowersCount: boolean) =>
    retryProjectDetailRead("public_project_detail_shell_data", () =>
      fetchProjectDetailShellData(
        projectId,
        ownerId,
        includeFollowersCount,
        null,
        "public",
        false,
      ),
    ),
  [PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG],
  { revalidate: 60, tags: [PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG] },
);


const getPublicProjectDetailMetadata = unstable_cache(
  async (slugOrId: string): Promise<ProjectDetailMetadataRead | null> => {
    const project = await resolveProjectDetailTarget(slugOrId);
    if (!project) return null;

    const canRead = computeProjectReadAccess(
      project.visibility,
      project.status,
      false,
      false,
    );
    if (!canRead) return null;
    const readme = await retryProjectDetailRead(
          "public_project_detail_metadata_readme",
          () =>
            db
              .select({ excerpt: projectDocVersions.excerpt, settings: projectDocs.settings })
              .from(projectDocs)
              .leftJoin(
                projectDocVersions,
                eq(
                  projectDocs.publishedVersionId,
                  projectDocVersions.id,
                ),
              )
              .where(
                and(
                  eq(projectDocs.projectId, project.id),
                  eq(projectDocs.slug, "readme"),
                ),
              )
              .limit(1),
        );

    return {
      projectId: project.id,
      ownerId: project.ownerId,
      slug: project.slug || null,
      title: project.title,
      shortDescription: project.shortDescription || null,
      description: project.description || null,
      // Same doc permission an anonymous visitor gets: draft, Readme tab, override (COR-043).
      readmeExcerpt: readme[0] && resolveProjectDocPermission({
        actorUserId: null,
        projectVisibility: project.visibility,
        projectStatus: project.status,
        publicTabVisibility: project.publicTabVisibility,
        settings: readme[0].settings,
        hasPublishedReadme: Boolean(readme[0].excerpt),
      }).canReadPublished
        ? readme[0].excerpt ?? null
        : null,
      coverImage: project.coverImage || null,
    };
  },
  [PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG],
  { revalidate: 60, tags: [PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG] },
);


/** Public (anonymous) metadata for OG images and link previews; never viewer-specific (COR-042). */
export async function readProjectDetailMetadata(input: {
  slugOrId: string;
}): Promise<
  | { success: true; data: ProjectDetailMetadataRead }
  | {
      success: false;
      errorCode: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_ERROR";
      message: string;
    }
> {
  const parsedInput = projectDetailInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      success: false,
      errorCode: "INVALID_INPUT",
      message: "Invalid workspace detail request.",
    };
  }

  const data = await getPublicProjectDetailMetadata(parsedInput.data.slugOrId.trim());
  return data
    ? { success: true, data }
    : { success: false, errorCode: "NOT_FOUND", message: "Workspace not found." };
}


/** Session-scoped project shell. The caller's identity always comes from the session (COR-042). */
export async function readProjectDetailShell(input: { slugOrId: string }): Promise<ProjectDetailShellResult> {
  const { userId } = await getViewerAuthContext();
  return readProjectDetailShellForActor({ slugOrId: input.slugOrId, actorUserId: userId });
}


async function readProjectDetailShellForActor(input: {
  slugOrId: string;
  actorUserId: string | null;
}): Promise<ProjectDetailShellResult> {
  const slugOrId = input.slugOrId?.trim();
  if (!slugOrId || slugOrId.length > 200) {
    return {
      success: false,
      errorCode: "INVALID_INPUT",
      message: "Invalid workspace detail request.",
    };
  }

  const requestedActorUserId = input.actorUserId ?? null;
  const startedAt = performance.now();

  try {
    const actorUserId = requestedActorUserId ?? null;

    const project = await resolveProjectDetailTarget(slugOrId, actorUserId);
    if (!project) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Workspace not found.",
      };
    }

    return await runInFlightDeduped(
      `project:detail-shell:${project.id}:${actorUserId ?? "anon"}`,
      async () => {
        const parentOrgRole = project.parentId ? await readViewerOrgRole(project.parentId, actorUserId) : null;
        const viewerState = resolveProjectDetailViewerState({
          projectId: project.id,
          ownerId: project.ownerId,
          visibility: project.visibility,
          status: project.status,
          actorUserId,
          memberRoleRaw: project.memberRole,
          isFollowed: project.isFollowed,
          parentOrgRole,
        });

        const { canRead, canWrite, isOwner, isMember, memberRole, isFollowed } =
          viewerState;
        if (!canRead) {
          return {
            success: false,
            errorCode: "FORBIDDEN" as const,
            message: "You don’t have access to this",
          };
        }

        const shouldUseCachedShell =
          !actorUserId &&
          computeProjectReadAccess(
            project.visibility,
            project.status,
            false,
            false,
          );
        const includeFollowersCount = project.followersCount == null;
        const shell = shouldUseCachedShell
          ? await getPublicProjectDetailShellData(
              project.id,
              project.ownerId,
              includeFollowersCount,
            )
          : await retryProjectDetailRead("project_detail_shell_data", () =>
              fetchProjectDetailShellData(
                project.id,
                project.ownerId,
                includeFollowersCount,
                actorUserId,
                project.visibility ?? "private",
                isOwner || isMember,
                project.owner,
              ),
            );

        const normalizedStatus: Project["status"] =
          project.status === "draft" ||
          project.status === "active" ||
          project.status === "completed" ||
          project.status === "archived"
            ? project.status
            : "draft";

        const normalizedSyncStatus: NonNullable<Project["syncStatus"]> =
          project.syncStatus === "pending" ||
          project.syncStatus === "cloning" ||
          project.syncStatus === "indexing" ||
          project.syncStatus === "ready" ||
          project.syncStatus === "failed"
            ? project.syncStatus
            : "ready";

        const safeImportSource = clearSealedGithubTokenFromImportSource(
          project.importSource,
        );
        const openRoles = shell.openRoles.map((role) => ({
          id: role.id,
          projectId: role.projectId,
          role: role.role,
          title: role.title ?? null,
          description: role.description ?? null,
          count: Math.max(0, role.count ?? 0),
          filled: Math.max(0, role.filled ?? 0),
          skills: Array.isArray(role.skills) ? role.skills : [],
          createdAt: role.createdAt?.toISOString?.() ?? null,
          updatedAt: role.updatedAt?.toISOString?.() ?? null,
        }));

        const visibleExternalLinks = filterProjectLinksForAudience(
          normalizeProjectSocialLinks(project.externalLinks),
          isOwner || isMember,
        );
        const visibleExternalLinkIds = new Set(visibleExternalLinks.map((link) => link.id));
        const visibleExternalLinkMetadata = Object.fromEntries(
          Object.entries(project.externalLinkMetadata ?? {}).filter(([id]) => id === "github-integration" || visibleExternalLinkIds.has(id)),
        );

        const isOrganization = project.kind === "organization";
        const organization = isOrganization
          ? await readOrgDetail(project.id, { userId: actorUserId, isAdmin: isOwner || memberRole === "admin", isInOrg: isOwner || isMember })
          : null;
        const childOrg = await readChildOrgLink(project, { userId: actorUserId, isLead: isOwner, parentOrgRole });
        // A hidden Dashboard hides its data too: visitors get no roles, team or overview text.
        // An org's overview is its About tab, which every reader sees.
        const hidesDashboard =
          !isOrganization && !isOwner && !isMember &&
          !normalizeProjectPublicTabVisibility(project.publicTabVisibility).dashboard;
        const readModel = {
          id: project.id,
          ownerId: project.ownerId,
          title: project.title,
          slug: project.slug || undefined,
          description: hidesDashboard ? null : project.description || null,
          shortDescription: project.shortDescription || null,
          problemStatement: hidesDashboard ? null : project.problemStatement || null,
          solutionStatement: hidesDashboard ? null : project.solutionStatement || null,
          coverImage: project.coverImage || null,
          category: project.category || null,
          tags: Array.isArray(project.tags) ? project.tags : [],
          skills: Array.isArray(project.skills) ? project.skills : [],
          externalLinks: visibleExternalLinks,
          externalLinkMetadata: visibleExternalLinkMetadata,
          visibility: project.visibility || "private",
          publicTabVisibility: normalizeProjectPublicTabVisibility(
            project.publicTabVisibility,
          ),
          lookingForCollaborators: !!project.lookingForCollaborators,
          memberUpdatesEnabled: !!project.memberUpdatesEnabled,
          memberFileUploadDefault: project.memberFileUploadDefault !== false,
          maxCollaborators: project.maxCollaborators || null,
          status: normalizedStatus,
          lifecycleStages: Array.isArray(project.lifecycleStages)
            ? project.lifecycleStages
            : [],
          currentStageIndex: Math.max(0, project.currentStageIndex ?? 0),
          stageCompletionDates: normalizeJourneyCompletionDates(
            project.stageCompletionDates,
            Math.max(0, project.currentStageIndex ?? 0),
          ),
          importSource: safeImportSource || null,
          githubRepoUrl: project.githubRepoUrl || null,
          githubSyncConnection: project.githubSyncRepository
            ? {
                repository: project.githubSyncRepository,
                branch: project.githubSyncBranch || "main",
              }
            : null,
          syncStatus: normalizedSyncStatus,
          updatedAt: project.updatedAt?.toISOString?.() ?? null,
          viewCount: Math.max(0, project.viewCount ?? 0),
          followersCount: Math.max(
            0,
            project.followersCount ?? shell.followersCount ?? 0,
          ),
          isFollowed,
          sprints: [],
          tasks: [],
          openRoles: hidesDashboard ? [] : openRoles,
          collaborators: hidesDashboard ? [] : shell.collaborators,
          initialFileNodes: [],
          owner: shell.owner || null,
          membersHasMore: hidesDashboard ? false : shell.membersHasMore || false,
          membersNextCursor: shell.membersNextCursor || null,
          // README data follows the doc's own permission: draft projects, the
          // Readme tab and the doc visibility override all apply (COR-043).
          ...(resolveProjectDocPermission({
            actorUserId,
            projectVisibility: project.visibility,
            projectStatus: project.status,
            publicTabVisibility: project.publicTabVisibility,
            settings: shell.readmeSettings,
            membershipRole: isOwner ? "owner" : memberRole,
            isOwner,
            isActiveMember: isMember,
            hasPublishedReadme: Boolean(shell.hasPublishedReadme),
          }).canReadPublished
            ? {
                hasPublishedReadme: Boolean(shell.hasPublishedReadme),
                readmeExcerpt: shell.readmeExcerpt ?? null,
                readmeUpdatedAt: shell.readmeUpdatedAt ?? null,
                readmeVersionNumber: shell.readmeVersionNumber ?? null,
              }
            : { hasPublishedReadme: false, readmeExcerpt: null, readmeUpdatedAt: null, readmeVersionNumber: null }),
          isOwner,
          isMember,
          memberRole: isOwner ? "owner" : memberRole,
          guidance: shell.guidance ?? null,
          organization,
          ...childOrg,
        };

        const output = {
          identity: {
            projectId: project.id,
            routeSlug: slugOrId,
            canonicalSlug: project.slug || null,
          },
          capabilities: {
            canRead,
            canWrite,
            isOwner,
            isMember,
            memberRole: isOwner ? "owner" : memberRole,
            isFollowed,
          },
          project: readModel,
        };

        const parsedOutput = projectDetailReadDataSchema.safeParse(output);
        if (!parsedOutput.success) {
          console.error(
            "[getProjectDetailShellAction] Invalid DTO output",
            parsedOutput.error.flatten(),
          );
          return {
            success: false,
            errorCode: "INTERNAL_ERROR" as const,
            message: "Workspace detail payload validation failed.",
          };
        }

        logger.metric("project.detail.shell", {
          projectId: project.id,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          success: true as const,
          data: parsedOutput.data,
        };
      },
    );
  } catch (error) {
    console.error("[readProjectDetailShell] failed", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Couldn’t load workspace detail.",
    };
  }
}


/** Import hydration progress only: the browser never reads `projects.import_source` itself. */
export async function getProjectHydrationProgressAction(
  projectId: string,
): Promise<{ status: string; completed: number; total: number } | null> {
  if (!isLooseUuid(projectId)) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = await getProjectAccessById(projectId, user?.id ?? null);
  if (!access.project || !access.canRead) return null;
  const hydration = access.project.importSource?.metadata?.hydration;
  if (!hydration || typeof hydration.status !== "string") return null;
  return {
    status: hydration.status,
    completed: Number(hydration.completed) || 0,
    total: Number(hydration.total) || 0,
  };
}
