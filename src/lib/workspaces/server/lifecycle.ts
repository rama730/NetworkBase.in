import "server-only";
import { customRoleNames, savedTypeSettings, typeProfile } from "@/lib/organizations/type-profile";

import { type WorkspaceVisibility, isWorkspaceVisibility } from "@/lib/workspaces/workspace-visibility";
import { db } from "@/lib/db";
import { recheckOrgVerification } from "@/lib/organizations/verification";
import { workspaces, workspaceMembers, profiles, workspaceOpenRoles, tags, workspaceTags, storageAssets, workspaceNodeEvents, workspaceMentors, workspaceFollows, roleApplications } from "@/lib/db/schema";
import { eq, sql, inArray, and, desc, isNull, gt, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { clearSealedGithubTokenFromImportSource, sanitizeGitErrorMessage, sealGithubImportToken } from "@/lib/github/repo-security";
import { runGithubWorkspaceImport } from "@/lib/github/workspace-import-runner";
import { logger } from "@/lib/logger";
import { inngest } from "@/inngest/client";
import { CreateWorkspaceInput, createWorkspaceSchema, validateAndSanitizeLifecycleStages, type UpdateWorkspaceInput, updateWorkspaceSchema } from "@/lib/validations/workspace";
import { normalizeGithubRepoUrl, normalizeGithubBranch } from "@/lib/github/repo-validation";
import { parseGithubRepo, fetchRepoMeta } from "@/lib/github/repo-preview";
import { resolveGithubRepoAccess, buildGithubImportEventId } from "@/lib/github/auth-resolver";
import { GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE, GITHUB_CONNECTION_REQUIRED_MESSAGE } from "@/lib/github/account-health";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { redis } from "@/lib/redis";
import { z } from "zod";
import { buildWorkspaceImportEventId } from "@/lib/import/idempotency";
import { splitWorkspaceSocialLinks, validateWorkspaceSocialLinks, normalizeWorkspaceSocialLinks, areWorkspaceSocialLinksEqual } from "@/lib/workspaces/social-links";
import { isReservedWorkspaceSlug, generateSlug, generateSlugBase } from "@/lib/utils/slug";
import { generateWorkspaceKey } from "@/lib/workspace-key";
import { getLifecycleStagesForWorkspaceType } from "@/lib/workspaces/lifecycle-templates";
import { normalizeWorkspacePublicTabVisibility } from "@/lib/workspaces/settings-policies";
import { buildCreateWorkspaceNotificationPolicy } from "@/lib/notifications/workspace-policy";
import { syncWorkspaceChat } from "@/lib/messaging/integrations";
import { upsertProfileWorkspaceContributionFromMembership, markWorkspaceCollaboratorsSummaryStale, markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import { syncRoleSkillsBatch, syncWorkspaceSkills, syncRoleSkills } from "@/lib/skills/service";
import { normalizeAndValidateMimeType, normalizeAndValidateFileSize } from "@/lib/upload/security";
import { randomUUID } from "crypto";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import { CoverTooLargeError, shrinkStoredWorkspaceCover } from "@/lib/workspaces/server/cover-image";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { getTrustedHeadersIp } from "@/lib/security/request-ip";
import { headers } from "next/headers";
import { buildJourneyCompletionDates, normalizeJourneyCompletionDates } from "@/lib/workspaces/journey-completion";
import { isLooseUuid } from "@/lib/validations/uuid";
import { defaultOrgRoleNames, ORG_LIMITS } from "@/lib/organizations/config";
import { validateOrgHandle } from "@/lib/organizations/handle";
import { isOrgHandleAvailable } from "@/lib/organizations/join";
import { generateJoinCode } from "@/lib/organizations/join-rules";
import { capChildVisibility, childCreationBlock } from "@/lib/organizations/child-rules";
import { orgLimitBlock } from "@/lib/organizations/limits";
import { readViewerOrgRole } from "@/lib/organizations/detail";
import { isTimeZone, readOrgRules } from "@/lib/organizations/settings";
import { createOrgEmailInvites } from "@/lib/organizations/members";
import { parseInviteEmails } from "@/lib/organizations/member-rules";
import { createStarterFolders } from "@/lib/organizations/org-files";
import { namesOf, notifyOrg } from "@/lib/organizations/notify";
import { createCopiesForNewChild } from "@/lib/organizations/assignments";
import { planSprintSeriesAction } from "@/lib/workspaces/server/sprints";
import { notifyNewCopies } from "@/lib/organizations/assignment-notify";
import { isWorkspacePubliclyReadableVisibility } from "@/lib/workspaces/workspace-visibility";
import { addWorkspaceMemberInternal } from "@/lib/workspaces/collaborator-lifecycle";
import { createWorkspaceInvitationAction } from "@/app/actions/workspace/guidance";
import { createNotification } from "@/lib/notifications/service";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { closePendingApplications, type ClosedApplication, type ClosingReason } from "@/lib/applications/closing";
import { notifyClosedApplications } from "@/lib/applications/notifications";
import { normalizeSearchQuery, containsLikePattern } from "@/lib/search/query";
import { isMissingColumn, invalidateWorkspacePublicCaches, enqueueWorkspaceNotificationBestEffort, actorNotificationSnapshot, WORKSPACE_COVER_UPLOAD_MAX_FILE_BYTES, WORKSPACE_COVER_UPLOAD_BUCKET, buildWorkspaceImageRoute, revalidateWorkspacePaths, type WorkspaceSettingsMutationResult, loadOwnedWorkspaceForSettings, type WorkspaceSettingsErrorCode } from "./common";


const isMissingCounterColumn = (error: unknown, column: string) =>
  isMissingColumn(error, column);

const ALLOWED_PROJECT_COVER_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);


function resolveProjectVisibilityForCreate(value: unknown): WorkspaceVisibility {
  if (value === undefined || value === null || value === "") return "public";
  if (isWorkspaceVisibility(value)) return value;
  throw new Error("Invalid workspace visibility.");
}


function projectCoverExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}


async function assertProjectOwnerForSettings(
  projectId: string,
  userId: string,
) {
  const [project] = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      ownerId: workspaces.ownerId,
      coverImage: workspaces.coverImage,
      coverImageBucket: workspaces.coverImageBucket,
      coverImageKey: workspaces.coverImageKey,
      coverImageAssetId: workspaces.coverImageAssetId,
    })
    .from(workspaces)
    .where(eq(workspaces.id, projectId))
    .limit(1);

  if (!project) throw new Error("Workspace not found");
  if (project.ownerId !== userId) throw new Error("Sign in to continue");
  return project;
}


/**
 * A follow only changes a count: refresh the project's own page. The Discover feed keeps its cache
 * (the client patches the count it shows; the shared feed catches up within a minute).
 */
const revalidateProjectFollowers = async (projectId: string) => {
  // Only this project's page: the shared detail tags cover every project, so a follow must not expire them all.
  revalidatePath(`/workspaces/${projectId}`);
  try {
    const [project] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    if (project?.slug) revalidatePath(`/workspaces/${project.slug}`);
  } catch {
    // Ignore slug revalidation errors on legacy schemas.
  }
};


async function lockProjectUserPair(tx: any, projectId: string, userId: string) {
  await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtext(CAST(${projectId} AS text)),
            hashtext(CAST(${userId} AS text))
        )
    `);
}


// --- Types ---
interface CreateProjectResult {
  success: boolean;
  project?: {
    id: string;
    title: string;
    slug?: string;
    /** Organizations only: the code shown on the success screen. */
    joinCode?: string | null;
    /** Organizations only: invites sent at creation (report §34.8). */
    invites?: { coAdmins: number; members: number; skipped: number };
  };
  error?: string;
  /** ORG_BLOCKED: the org no longer lets this person create there; the wizard offers a personal project instead. */
  code?: "ORG_BLOCKED";
  /** Things that didn't happen but didn't stop creation (an invitation refused by privacy rules). */
  notices?: string[];
}


type ImportSourcePayload = {
  type: "github" | "upload" | "scratch";
  repoUrl?: string;
  branch?: string;
  s3Key?: string;
  metadata?: Record<string, any>;
};


type GithubImportDispatchSource = "create" | "retry";


function shouldRunGithubImportInlineFallback(_error: unknown): boolean {
  const override =
    process.env.GITHUB_IMPORT_INLINE_FALLBACK?.trim().toLowerCase();
  // Allow explicitly opting into inline fallback via env var
  if (override === "always" || override === "true") return true;

  // In development, we always want a simple and synchronous logic flow
  // without depending on the complex external Inngest background queue.
  if (process.env.NODE_ENV !== "production") return true;

  // In production, rely on the Inngest worker.
  return false;
}


async function persistGithubImportQueueFailure(input: {
  projectId: string;
  importSource: ImportSourcePayload;
  message: string;
}) {
  const clearedImportSource = clearSealedGithubTokenFromImportSource(
    input.importSource,
  ) as Record<string, any>;
  const nextImportSource = {
    ...clearedImportSource,
    metadata: {
      ...((clearedImportSource as any)?.metadata || {}),
      lastError: input.message,
      syncPhase: "failed",
    },
  };

  await db
    .update(workspaces)
    .set({
      syncStatus: "failed",
      importSource: nextImportSource as any,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, input.projectId));
}


async function enqueueGithubImportOrRunInline(input: {
  projectId: string;
  userId: string;
  importSource: ImportSourcePayload;
  eventId: string;
  source: GithubImportDispatchSource;
  resolutions?: Record<string, "keep_local" | "overwrite_github"> | null;
}): Promise<
  | { success: true; mode: "queued" | "inline" }
  | { success: false; error: string }
> {
  const queueImportSource = clearSealedGithubTokenFromImportSource(
    input.importSource,
  ) as ImportSourcePayload;
  const githubImportSource = {
    type: "github" as const,
    repoUrl: queueImportSource.repoUrl!,
    branch: queueImportSource.branch,
    metadata: queueImportSource.metadata,
  };

  // In development mode, completely bypass the external queue and run inline immediately
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.GITHUB_IMPORT_INLINE_FALLBACK?.trim().toLowerCase() === "always"
  ) {
    try {
      await runGithubWorkspaceImport({
        projectId: input.projectId,
        importSource: githubImportSource,
        userId: input.userId,
        importEventId: input.eventId,
        queueAgeMs: 0,
        resolutions: input.resolutions,
      });
      logger.metric("github.import.enqueue", {
        projectId: input.projectId,
        userId: input.userId,
        result: "inline_dev",
        eventId: input.eventId,
        source: input.source,
      });
      return { success: true, mode: "inline" };
    } catch (inlineError) {
      const inlineMsg = sanitizeGitErrorMessage(
        inlineError instanceof Error
          ? inlineError.message
          : "GitHub import failed",
      );
      logger.metric("github.import.enqueue", {
        projectId: input.projectId,
        userId: input.userId,
        result: "inline_error",
        eventId: input.eventId,
        source: input.source,
      });
      return { success: false, error: inlineMsg };
    }
  }

  try {
    await inngest.send({
      name: "workspace/import",
      id: input.eventId,
      data: {
        projectId: input.projectId,
        importSource: githubImportSource,
        userId: input.userId,
        resolutions: input.resolutions,
      },
    });
    logger.metric("github.import.enqueue", {
      projectId: input.projectId,
      userId: input.userId,
      result: "success",
      eventId: input.eventId,
      source: input.source,
    });
    return { success: true, mode: "queued" };
  } catch (queueError) {
    const msg = sanitizeGitErrorMessage(
      queueError instanceof Error
        ? queueError.message
        : "Couldn’t enqueue GitHub import",
    );
    console.error("[Action] Failed to add GitHub import to queue", msg);

    if (shouldRunGithubImportInlineFallback(queueError)) {
      logger.metric("github.import.enqueue", {
        projectId: input.projectId,
        userId: input.userId,
        result: "inline_fallback",
        eventId: input.eventId,
        source: input.source,
      });

      try {
        await runGithubWorkspaceImport({
          projectId: input.projectId,
          importSource: githubImportSource,
          userId: input.userId,
          importEventId: input.eventId,
          queueAgeMs: 0,
          resolutions: input.resolutions,
        });
        return { success: true, mode: "inline" };
      } catch (inlineError) {
        const inlineMsg = sanitizeGitErrorMessage(
          inlineError instanceof Error
            ? inlineError.message
            : "GitHub import failed",
        );
        logger.metric("github.import.enqueue", {
          projectId: input.projectId,
          userId: input.userId,
          result: "inline_error",
          eventId: input.eventId,
          source: input.source,
          error: inlineMsg,
        });
        return { success: false, error: inlineMsg };
      }
    }

    await persistGithubImportQueueFailure({
      projectId: input.projectId,
      importSource: queueImportSource,
      message: msg,
    });
    logger.metric("github.import.enqueue", {
      projectId: input.projectId,
      userId: input.userId,
      result: "error",
      eventId: input.eventId,
      source: input.source,
    });
    return { success: false, error: msg };
  }
}


function normalizeImportSourceForPersist(
  importSource: CreateWorkspaceInput["import_source"] | undefined,
  gitHubToken?: string | null,
):
  | { ok: true; value: ImportSourcePayload | null }
  | { ok: false; error: string } {
  if (!importSource) return { ok: true, value: null };
  if (importSource.type !== "github") {
    return { ok: true, value: importSource as ImportSourcePayload };
  }

  const repoUrl = normalizeGithubRepoUrl(importSource.repoUrl || "");
  if (!repoUrl) {
    return {
      ok: false,
      error: "Invalid GitHub repository URL. Use https://github.com/owner/repo",
    };
  }

  const branch = normalizeGithubBranch(importSource.branch);
  if (importSource.branch && !branch) {
    return { ok: false, error: "Invalid GitHub branch name." };
  }

  const metadata = {
    ...(((clearSealedGithubTokenFromImportSource(importSource) as any)
      ?.metadata || {}) as Record<string, any>),
  };
  if (gitHubToken) {
    const sealed = sealGithubImportToken(gitHubToken);
    if (sealed) metadata.importAuth = sealed;
  }

  const normalized: ImportSourcePayload = {
    ...importSource,
    type: "github",
    repoUrl,
    branch,
    metadata,
  };
  return { ok: true, value: normalized };
}


function withLeadFocusMetadata(
  importSource: ImportSourcePayload | null,
  creatorRole: CreateWorkspaceInput["creator_role"],
): ImportSourcePayload | null {
  const leadFocus = (creatorRole?.title || "").trim();
  const timeCommitment = typeof creatorRole?.time_commitment === "number" ? creatorRole.time_commitment : null;
  if (!importSource && !leadFocus && !timeCommitment) {
    return null;
  }

  const base: ImportSourcePayload = importSource || { type: "scratch" };
  const metadata: Record<string, unknown> = { ...(base.metadata || {}) };

  if (leadFocus) {
    metadata.leadFocus = leadFocus;
  } else {
    delete metadata.leadFocus;
  }

  if (timeCommitment !== null) {
    metadata.creatorTimeCommitment = timeCommitment;
  }

  return {
    ...base,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}


async function ensureGithubImportAccess(
  repoUrl: string,
  options: {
    oauthToken?: string | null;
    preferredInstallationId?: number | string | null;
    sealedImportToken?: unknown;
    accountLinked?: boolean;
    accountUnavailable?: boolean;
  } = {},
): Promise<
  | {
      ok: true;
      installationId: number | null;
      authSource: "app" | "oauth" | "sealed" | "none";
      defaultBranch: string | null;
      isPrivate: boolean | null;
      repoId: number | null;
    }
  | { ok: false; error: string }
> {
  const parsed = parseGithubRepo(repoUrl);
  if (!parsed) {
    return {
      ok: false,
      error: "Invalid GitHub repository URL. Use https://github.com/owner/repo",
    };
  }

  try {
    const access = await resolveGithubRepoAccess({
      repoUrl,
      oauthToken: options.oauthToken || null,
      preferredInstallationId: options.preferredInstallationId ?? null,
      sealedImportToken: options.sealedImportToken,
    });

    const accountCannotAuthorize =
      access.source !== "app" &&
      (options.accountUnavailable || options.accountLinked === false);
    let meta;
    try {
      meta = await fetchRepoMeta({
        ...parsed,
        token: accountCannotAuthorize ? undefined : access.token || undefined,
      });
    } catch (error) {
      if (accountCannotAuthorize) {
        return {
          ok: false,
          error: options.accountUnavailable
            ? GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE
            : GITHUB_CONNECTION_REQUIRED_MESSAGE,
        };
      }
      throw error;
    }
    const isPrivate = meta.isPrivate === true;
    if (isPrivate && !access.token) {
      return {
        ok: false,
        error: "GitHub access expired. Reconnect GitHub and retry import.",
      };
    }
    return {
      ok: true,
      installationId: access.installationId,
      authSource: accountCannotAuthorize ? "none" : access.source,
      defaultBranch: meta.defaultBranch,
      isPrivate: meta.isPrivate,
      repoId: meta.repoId,
    };
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "";
    if (
      !(options.oauthToken || options.sealedImportToken) &&
      msg.includes("404")
    ) {
      return {
        ok: false,
        error:
          "Repository not found or private. Connect GitHub and verify repository access.",
      };
    }
    return {
      ok: false,
      error: sanitizeGitErrorMessage(
        msg || "Couldn’t validate repository access",
      ),
    };
  }
}


// --- Create Action ---
export async function createWorkspaceAction(
  rawInput: CreateWorkspaceInput & { slug?: string; project_id?: string },
): Promise<CreateProjectResult> {
  let acquiredLock = false;
  let lockKey = "";
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        error: "You must be logged in to create a workspace",
      };
    }

    // Rate limiting: 10 project creations per user per hour against automated spam
    const { allowed: rateLimitAllowed } = await consumeRateLimit(
      `create:project:user:${user.id}`,
      10,
      60 * 60,
    );
    if (!rateLimitAllowed) {
      return {
        success: false,
        error: "You have created too many workspaces recently. Wait a while before creating another.",
      };
    }

    // Distributed in-flight lock per user prevents duplicate concurrent project creation
    lockKey = `lock:create:project:user:${user.id}`;
    if (redis) {
      try {
        const lockRes = await redis.set(lockKey, "1", { nx: true, ex: 15 });
        if (!lockRes) {
          return {
            success: false,
            error: "A workspace creation is already in progress. Wait a moment.",
          };
        }
        acquiredLock = true;
      } catch {
        // Redis failure must not fail project creation
      }
    }

    // Runtime input validation via Zod schema
    // slug and project_id are already in the schema; zod 4 refuses .extend() over keys of a refined schema.
    const parseResult = createWorkspaceSchema.safeParse(rawInput);

    if (!parseResult.success) {
      if (acquiredLock && redis) await redis.del(lockKey).catch(() => undefined);
      return {
        success: false,
        error: parseResult.error.issues[0]?.message || "Invalid workspace details provided.",
      };
    }

    const input = parseResult.data;

    // Organizations: the handle is the address, exact or refused; never suffixed like a project slug.
    const organization = input.organization;
    let orgHandle: string | null = null;
    if (organization) {
      const refuse = (error: string) => ({ success: false, error });
      const checked = validateOrgHandle(organization.handle);
      if (!checked.ok) return refuse(checked.reason === "reserved" ? "That handle is reserved." : "Choose a handle of 3–40 letters, numbers or single dashes.");
      if (!(await isOrgHandleAvailable(checked.handle))) return refuse(`@${checked.handle} is taken.`);
      const [owned] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(workspaces)
        .where(and(eq(workspaces.ownerId, user.id), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)));
      if ((owned?.n ?? 0) >= ORG_LIMITS.orgsOwnedPerUser) return refuse(`You can own up to ${ORG_LIMITS.orgsOwnedPerUser} organizations.`);
      orgHandle = checked.handle;
    }
    let joinCode = organization ? generateJoinCode() : null;

    // Child project (report §14): the org's rules decide who creates, who leads, the visibility and who joins.
    const parentOrgId = input.parent_org_id ?? null;
    let ownerId = user.id;
    let child: { orgTitle: string; directAdd: boolean; visibility: "public" | "org" | "private" } | null = null;
    const unitPeople = (input.roles ?? []).flatMap((role) => (role.people ?? []).map((person) => person.user_id));
    const unassignedPeople = (input.unassigned_people ?? []).map((person) => person.user_id);
    const childNotices: string[] = [];
    // People outside the org (when it allows them) are always invited, even by an admin: they join only this project (decision 6).
    const outsiders = new Set<string>();
    if (parentOrgId) {
      const refuse = (error: string, code?: "ORG_BLOCKED") => ({ success: false, error, ...(code ? { code } : {}) });
      const [org] = await db
        .select({ title: workspaces.title, visibility: workspaces.visibility, status: workspaces.status, suspendedAt: workspaces.suspendedAt, deletionScheduledAt: workspaces.deletionScheduledAt, orgSettings: workspaces.orgSettings })
        .from(workspaces)
        .where(and(eq(workspaces.id, parentOrgId), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)))
        .limit(1);
      if (!org) return refuse("Organization not found.", "ORG_BLOCKED");
      const rules = readOrgRules(org.orgSettings);
      const role = await readViewerOrgRole(parentOrgId, user.id);
      const open = org.status !== "archived" && !org.suspendedAt && !org.deletionScheduledAt;
      const block = childCreationBlock(role, rules.childCreation, open);
      // Report §14.6: the wizard keeps everything and offers "Create as a personal workspace".
      if (block) return refuse(!role ? `You’re no longer in ${org.title}.` : !open ? `${org.title} is archived.` : block, "ORG_BLOCKED");
      // ponytail: counted before the insert, so two creates at once can pass 200 by one. Ceiling: harmless; a lock if it matters.
      const [{ n: children } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaces).where(and(eq(workspaces.parentId, parentOrgId), isNull(workspaces.deletedAt)));
      const full = orgLimitBlock("workspaces", children, { org: org.title || "This organization", isAdmin: role === "owner" || role === "admin" });
      if (full) return refuse(full, "ORG_BLOCKED");
      const isOrgAdmin = role === "owner" || role === "admin";
      if (input.lead_user_id && input.lead_user_id !== user.id) {
        if (!isOrgAdmin) return refuse("Only admins pick someone else as lead.");
        const leadRole = await readViewerOrgRole(parentOrgId, input.lead_user_id);
        if (!leadRole || leadRole === "viewer") return refuse(`The owner must be a member of ${org.title}.`);
        ownerId = input.lead_user_id;
      }
      // Outside people while the org keeps them out are left out with a reason, not a failed create (report §14.6).
      const dropped = new Set<string>();
      for (const personId of [...unitPeople, ...unassignedPeople]) {
        const personRole = await readViewerOrgRole(parentOrgId, personId);
        if (!personRole || personRole === "viewer") (rules.outsidePeople ? outsiders : dropped).add(personId);
      }
      // An invitation needs a unit, so an outside person outside every unit is left out too.
      const looseOutsiders = unassignedPeople.filter((id) => outsiders.has(id));
      if (looseOutsiders.length > 0) {
        looseOutsiders.forEach((id) => dropped.add(id));
        childNotices.push(`${looseOutsiders.length === 1 ? "1 person" : `${looseOutsiders.length} people`} outside ${org.title} left out: put them in a team to invite them.`);
      }
      if (dropped.size > 0) {
        input.roles = input.roles?.map((unit) => ({ ...unit, people: unit.people?.filter((person) => !dropped.has(person.user_id)),
          lead_user_id: unit.lead_user_id && dropped.has(unit.lead_user_id) ? undefined : unit.lead_user_id }));
        unassignedPeople.splice(0, unassignedPeople.length, ...unassignedPeople.filter((id) => !dropped.has(id)));
        const ruleDropped = dropped.size - looseOutsiders.length;
        if (ruleDropped > 0) childNotices.push(`${ruleDropped === 1 ? "1 person" : `${ruleDropped} people`} outside ${org.title} left out: ${org.title} no longer allows outside people.`);
      }
      // Members send invitations, which need a unit; admins add people directly (decision 8).
      if (!isOrgAdmin && unassignedPeople.length > 0) return refuse("Put invited people in a team.");
      const asked = input.visibility === "public" || input.visibility === "private" ? input.visibility : "org";
      child = {
        orgTitle: org.title,
        directAdd: isOrgAdmin,
        visibility: capChildVisibility(asked, rules.visibilityCap, isWorkspacePubliclyReadableVisibility(org.visibility)),
      };
      if (child.visibility !== asked) childNotices.push(`Visibility changed by ${org.title} rules: ${child.visibility === "private" ? "Private" : "Organization"}.`);
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Retrieve GitHub Access Token if available (for private repo access)
    const gitHubToken = session?.provider_token;

    const importSourceResult = normalizeImportSourceForPersist(
      input.import_source,
      gitHubToken || null,
    );
    if (!importSourceResult.ok) {
      return { success: false, error: importSourceResult.error };
    }
    let normalizedImportSource = importSourceResult.value;
    if (
      normalizedImportSource?.type === "github" &&
      normalizedImportSource.repoUrl
    ) {
      const preferredInstallationId = (
        normalizedImportSource.metadata as Record<string, unknown> | undefined
      )?.githubInstallationId;
      const sealedImportToken = (
        normalizedImportSource.metadata as Record<string, unknown> | undefined
      )?.importAuth;
      const accessCheck = await ensureGithubImportAccess(
        normalizedImportSource.repoUrl,
        {
          oauthToken: gitHubToken || null,
          preferredInstallationId: preferredInstallationId as
            | number
            | string
            | null
            | undefined,
          sealedImportToken,
        },
      );
      if (!accessCheck.ok) {
        return { success: false, error: accessCheck.error };
      }

      const mergedMetadata = {
        ...((normalizedImportSource.metadata || {}) as Record<string, unknown>),
        githubInstallationId: accessCheck.installationId,
        githubAuthSource: accessCheck.authSource,
        githubRepoId:
          accessCheck.repoId ??
          ((normalizedImportSource.metadata || {}) as Record<string, unknown>)
            ?.githubRepoId ??
          null,
        githubRepoPrivate: accessCheck.isPrivate,
        syncPhase: "pending",
        importEventId: buildWorkspaceImportEventId({
          projectId: input.project_id || input.slug || input.title || "pending",
          source: "github",
          normalizedTarget: normalizedImportSource.repoUrl,
          branchOrManifestHash:
            normalizedImportSource.branch ||
            accessCheck.defaultBranch ||
            "main",
        }),
      };

      normalizedImportSource = {
        ...normalizedImportSource,
        branch:
          normalizedImportSource.branch || accessCheck.defaultBranch || "main",
        metadata: mergedMetadata,
      };
    } else if (normalizedImportSource?.type === "upload") {
      const currentMetadata = (normalizedImportSource.metadata || {}) as Record<
        string,
        unknown
      >;
      const normalizedTarget =
        typeof currentMetadata.folderName === "string" &&
        currentMetadata.folderName.trim().length > 0
          ? currentMetadata.folderName
          : "upload";
      normalizedImportSource = {
        ...normalizedImportSource,
        metadata: {
          ...currentMetadata,
          syncPhase: "pending",
          importEventId: buildWorkspaceImportEventId({
            projectId:
              input.project_id || input.slug || input.title || "pending",
            source: "upload",
            normalizedTarget,
            branchOrManifestHash: "pending",
          }),
          uploadSession: {
            ...(typeof currentMetadata.uploadSession === "object" &&
            currentMetadata.uploadSession
              ? (currentMetadata.uploadSession as Record<string, unknown>)
              : {}),
            status: "pending",
          },
        },
      };
    }
    const normalizedImportSourceWithLeadFocus = withLeadFocusMetadata(
      normalizedImportSource,
      input.creator_role,
    );
    const visibility = child ? child.visibility : resolveProjectVisibilityForCreate(input.visibility);
    const externalLinksSplit = splitWorkspaceSocialLinks(input.external_links);
    if ("error" in externalLinksSplit)
      return { success: false, error: externalLinksSplit.error };
    const openRoles = (input.roles || []).filter((role) => role.role.trim().length > 0);
    // Report §21.4: a workspace in an organization has up to 20 teams.
    const tooManyTeams = parentOrgId ? orgLimitBlock("teams", openRoles.length - 1, { org: input.title?.trim() || "This workspace", isAdmin: true }) : null;
    if (tooManyTeams) return { success: false, error: tooManyTeams };
    const lookingForCollaborators = openRoles.length > 0;

    let requestedSlug = orgHandle ?? (input.slug || "").trim().toLowerCase();
    if (requestedSlug && (isReservedWorkspaceSlug(requestedSlug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug))) {
      requestedSlug = "";
    }
    // Report §17.8, §18.7: a workspace in an organization gets its plain address when it's free; a clash still adds an ending below.
    let finalSlug = requestedSlug || (parentOrgId && generateSlugBase(input.title) ? generateSlugBase(input.title) : generateSlug(input.title));
    // A held organization handle stays free for its organization to take back.
    const held = parentOrgId && !requestedSlug ? (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM org_handle_holds WHERE handle = ${finalSlug}`))[0]?.n : 0;
    if (isReservedWorkspaceSlug(finalSlug) || held) {
      finalSlug = `${generateSlugBase(input.title) || "project"}-${Math.random().toString(36).substring(2, 7)}`;
    }
    // Initial Key Generation
    let finalKey = generateWorkspaceKey(input.title);

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        const lifecycleStages = validateAndSanitizeLifecycleStages(
          input.lifecycle_stages && input.lifecycle_stages.length > 0
            ? input.lifecycle_stages
            : getLifecycleStagesForWorkspaceType(input.project_type),
        );
        const requestedInitialStageIndex = Number(input.current_stage_index ?? 0);
        const completedInitialStageCount = Number.isInteger(requestedInitialStageIndex)
          ? Math.min(Math.max(requestedInitialStageIndex, 0), lifecycleStages.length)
          : 0;
        const lifecycleConfiguredAt = new Date().toISOString();

        const projectData = {
          ownerId,
          parentId: parentOrgId,
          title: input.title,
          slug: finalSlug,
          // Use mutable key variable
          key: finalKey,
          currentTaskNumber: 0,
          description: input.description || null,
          shortDescription: input.short_description || null,
          problemStatement: input.problem_statement || null,
          // Backward-compatible: support older clients sending solution_overview
          solutionStatement:
            (input as any).solution_statement ||
            (input as any).solution_overview ||
            null,
          // An organization's category is its Subject / Department label, or nothing (report §34.3).
          category: organization ? input.custom_project_type?.trim() || null :
            input.project_type === "other"
              ? input.custom_project_type || "Other"
              : input.project_type || null,
          tags: input.tags || [],
          skills: input.technologies_used || [],
          externalLinks: externalLinksSplit.links,
          externalLinkMetadata: externalLinksSplit.metadata,
          visibility,
          // Create step 4 launch settings (all editable later in Project settings).
          publicTabVisibility: normalizeWorkspacePublicTabVisibility(input.public_tab_visibility),
          memberUpdatesEnabled: input.member_updates_enabled !== false,
          memberFileUploadDefault: input.member_file_upload_default !== false,
          notificationPreferences: buildCreateWorkspaceNotificationPolicy(input.notification_rows),
          status: mapStatus(input.status),
          lookingForCollaborators,
          openRolesCount: openRoles.length,
          lifecycleStages,
          currentStageIndex: completedInitialStageCount,
          stageCompletionDates: Object.fromEntries(
            Array.from({ length: completedInitialStageCount }, (_, index) => [
              String(index),
              lifecycleConfiguredAt,
            ]),
          ),
          importSource: normalizedImportSourceWithLeadFocus,
          // For GitHub imports, start at `pending` until the worker actually begins cloning.
          syncStatus: (normalizedImportSourceWithLeadFocus?.type === "github"
            ? "pending"
            : normalizedImportSourceWithLeadFocus?.type === "upload"
              ? "pending"
              : "ready") as
            | "pending"
            | "cloning"
            | "indexing"
            | "ready"
            | "failed",
          githubRepoUrl:
            normalizedImportSourceWithLeadFocus?.type === "github"
              ? normalizedImportSourceWithLeadFocus.repoUrl || null
              : null,
          githubDefaultBranch:
            normalizedImportSourceWithLeadFocus?.type === "github"
              ? normalizedImportSourceWithLeadFocus.branch || "main"
              : "main",
          ...(parentOrgId && input.follow_org_sprints ? { orgSettings: { followOrgSprints: true } } : {}),
          ...(organization
            ? {
                kind: "organization" as const,
                orgType: organization.org_type,
                orgSettings: {
                  version: 1,
                  joinMode: organization.join_mode,
                  childCreation: organization.child_creation,
                  outsidePeople: organization.outside_people,
                  // Report §21.2: every value the type sets is saved now, so it stops following the type. Role names
                  // keep only what differs from the type's, so changing type later still renames the rest.
                  ...savedTypeSettings(organization.org_type),
                  roleNames: customRoleNames(organization.org_type, organization.role_names),
                  // Report §34: Other's label, identity, and the Work defaults chosen in Setup (unset keys keep the type's).
                  ...(organization.org_type === "other" ? { typeLabel: organization.type_label?.trim() } : {}),
                  ...(organization.part_of ? { partOf: organization.part_of } : {}),
                  ...(organization.location ? { location: organization.location } : {}),
                  ...(organization.work?.review_required !== undefined ? { assignmentReview: organization.work.review_required } : {}),
                  ...(organization.work?.late_rule ? { assignmentLateRule: organization.work.late_rule } : {}),
                  ...(organization.work?.reminders ? { assignmentReminders: organization.work.reminders } : {}),
                  ...(organization.work?.story_points ? { storyPoints: organization.work.story_points } : {}),
                },
                termStart: organization.term_start || null,
                termEnd: organization.term_end || null,
                timeZone: organization.time_zone && isTimeZone(organization.time_zone) ? organization.time_zone : null,
                welcomeNote: organization.welcome_note || null,
                maxCollaborators: organization.max_members ? String(organization.max_members) : null,
                joinCode,
                // Education reviews assignments by default (report §21.5), unless Setup changed it.
                taskReviewRequired: organization.work?.review_required ?? typeProfile(organization.org_type).reviewRequired,
              }
            : {}),
        };

        // Project, owner membership, and the project's #general are created together.
        const result = await db.transaction(async (tx) => {
          const [newProject] = await tx
            .insert(workspaces)
            .values(projectData)
            .returning();

          if (!newProject) {
            throw new Error("Couldn’t create workspace");
          }

          await tx.insert(workspaceMembers).values({
            projectId: newProject.id,
            userId: ownerId,
            role: "owner",
            title: organization?.creator_title || null,
          });
          await syncWorkspaceChat(tx, newProject.id, null, "ensure_default");
          // Org Files starter folders by type (report §23.3).
          if (organization) await createStarterFolders(tx, newProject.id, ownerId, organization.org_type);
          await upsertProfileWorkspaceContributionFromMembership(tx, {
            profileId: ownerId,
            projectId: newProject.id,
            verifiedBy: user.id,
            previousRole: null,
            nextRole: "owner",
            source: "owner",
          });

          // Keep denormalized profile stats in sync.
          await tx
            .update(profiles)
            .set({
              projectsCount: sql`GREATEST(0, ${profiles.projectsCount} + 1)`,
            })
            .where(eq(profiles.id, ownerId));

          // 5. Insert Open Roles (if any). For a child project these are its units.
          let unitIds: string[] = [];
          if (openRoles.length > 0) {
            const insertedRoles = await tx
              .insert(workspaceOpenRoles)
              .values(
                openRoles.map((role) => ({
                  projectId: newProject.id,
                  role: role.role,
                  // Seats grow to fit the people placed in the unit (report §14.4).
                  count: Math.max(role.count, role.people?.length ?? 0),
                  description: role.description || "",
                  skills: role.skills || [],
                  leadUserId: child && role.lead_user_id ? role.lead_user_id : null,
                })),
              )
              .returning({ id: workspaceOpenRoles.id });
            // ponytail: batch open-role skill syncing cuts N sequential DB roundtrips to 1 bulk insert. ceiling: 50 open roles. upgrade: multi-row batching beyond 50.
            const roleSkillEntries = insertedRoles.map((insertedRole, index) => ({
              roleId: insertedRole.id,
              labels: openRoles[index]?.skills ?? [],
            }));
            await syncRoleSkillsBatch(tx, roleSkillEntries, user.id);
            unitIds = insertedRoles.map((insertedRole) => insertedRole.id);
          }

          // Admins add people straight into their unit; the admin stays an inherited admin (decision 8).
          if (child?.directAdd) {
            const placements = [
              ...openRoles.flatMap((role, index) => (role.people ?? []).map((person) => ({ userId: person.user_id, roleId: unitIds[index] ?? null }))),
              ...unassignedPeople.map((userId) => ({ userId, roleId: null })),
            ];
            for (const placement of placements) {
              if (placement.userId === ownerId || outsiders.has(placement.userId)) continue;
              await addWorkspaceMemberInternal(tx, { projectId: newProject.id, userId: placement.userId, role: "member", actorId: user.id, source: "manual", roleId: placement.roleId });
            }
          }

          // 6. Insert Tags and Skills into Junction Tables
          const tagsArray = input.tags || [];
          if (tagsArray.length > 0) {
            const tagValues = tagsArray
              .map((t) => {
                const slug = t
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "");
                return { name: t, slug };
              })
              .filter((t) => t.slug);

            if (tagValues.length > 0) {
              // PURE OPTIMIZATION: Insert with onConflictDoUpdate returning id eliminates separate SELECT tags query.
              const insertedTags = await tx
                .insert(tags)
                .values(tagValues)
                .onConflictDoUpdate({
                  target: tags.slug,
                  set: { name: sql`EXCLUDED.name` },
                })
                .returning({ id: tags.id });
              if (insertedTags.length > 0) {
                await tx
                  .insert(workspaceTags)
                  .values(
                    insertedTags.map((t) => ({
                      projectId: newProject.id,
                      tagId: t.id,
                    })),
                  )
                  .onConflictDoNothing();
              }
            }
          }

          const skillsArray = input.technologies_used || [];
          const resolvedProjectSkills = await syncWorkspaceSkills(
            tx,
            newProject.id,
            skillsArray,
            user.id,
          );
          if (resolvedProjectSkills.length > 0) {
            await tx
              .update(workspaces)
              .set({ skills: resolvedProjectSkills.map((skill) => skill.name) })
              .where(eq(workspaces.id, newProject.id));
          }

          return newProject;
        });

        await invalidateWorkspacePublicCaches(result.id);
        await markProfileCollaborationSummaryStale(user.id);
        revalidatePath("/workspaces");
        revalidatePath("/my-profile");
        revalidatePath("/u/[username]", "page");

        // Add to Import Queue if applicable
        if (
          normalizedImportSourceWithLeadFocus?.type === "github" &&
          normalizedImportSourceWithLeadFocus.repoUrl
        ) {
          try {
            const queueImportSource = clearSealedGithubTokenFromImportSource(
              normalizedImportSourceWithLeadFocus,
            ) as ImportSourcePayload;
            const queueEventId = buildGithubImportEventId(
              result.id,
              queueImportSource.repoUrl!,
              queueImportSource.branch || null,
            );
            await enqueueGithubImportOrRunInline({
              projectId: result.id,
              userId: user.id,
              importSource: queueImportSource,
              eventId: queueEventId,
              source: "create",
            });
          } catch (importErr) {
            console.error("Failed to enqueue GitHub import after project creation:", importErr);
            // Project row was already committed. Update syncStatus to failed so Files tab offers retry
            await db
              .update(workspaces)
              .set({
                syncStatus: "failed",
              })
              .where(eq(workspaces.id, result.id))
              .catch(() => undefined);
          }
        }

        // Members invite their team: each person gets an invitation to their unit (decision 8).
        const notices: string[] = [...childNotices];
        if (child && (!child.directAdd || outsiders.size > 0)) {
          const units = await db.select({ id: workspaceOpenRoles.id, role: workspaceOpenRoles.role }).from(workspaceOpenRoles).where(eq(workspaceOpenRoles.projectId, result.id));
          for (const role of openRoles) {
            const unitId = units.find((unit) => unit.role === role.role)?.id;
            for (const person of role.people ?? []) {
              if (!unitId || person.user_id === ownerId || (child.directAdd && !outsiders.has(person.user_id))) continue;
              const invited = await createWorkspaceInvitationAction({ projectId: result.id, candidateId: person.user_id, kind: "ordinary_role", roleId: unitId });
              if (!invited.success) notices.push(`${person.label ?? "Someone"} was not invited: ${invited.error}`);
            }
          }
        }
        // A lead picked by an admin owns the project at once and is told (decision 11).
        if (ownerId !== user.id) {
          await createNotification({
            recipientUserId: ownerId,
            actorUserId: user.id,
            kind: "chat_invite",
            category: "workflows",
            importance: "important",
            title: `You own ${result.title}`,
            body: child ? `Created in ${child.orgTitle}` : "",
            href: `/workspaces/${result.slug || result.id}`,
            entityRefs: { projectId: result.id, projectSlug: result.slug, targetUserId: ownerId },
            preview: { contextLabel: result.title, contextKind: "workflow", secondaryText: "Owner" },
            dedupeKey: `project-lead:${result.id}:${ownerId}`,
          }).catch(() => undefined);
        }

        // A child project (report §14.4, §26 B): people added directly and unit leads hear it, the org's admins hear
        // "Ravi created Compiler Lab", and open "each project" assignments reach the new project.
        if (child && parentOrgId) {
          const href = `/workspaces/${encodeURIComponent(result.slug || result.id)}`;
          if (child.directAdd) {
            for (const unit of openRoles) {
              for (const person of unit.people ?? []) {
                if (person.user_id === ownerId || outsiders.has(person.user_id)) continue;
                await notifyOrg({ orgId: parentOrgId, eventKey: "org.child_added", actorId: user.id, to: [person.user_id], title: `You were added to ${result.title} · ${unit.role}`, href, sourceEventId: `added:${result.id}:${person.user_id}`, refs: { projectId: result.id } });
              }
              if (unit.lead_user_id && !outsiders.has(unit.lead_user_id)) {
                await notifyOrg({ orgId: parentOrgId, eventKey: "org.role_changed", actorId: user.id, to: [unit.lead_user_id], title: `You’re team lead of ${unit.role}`, href, sourceEventId: `unit-lead:${result.id}:${unit.role}:${unit.lead_user_id}`, refs: { projectId: result.id } });
              }
            }
            for (const userId of unassignedPeople) {
              if (userId === ownerId) continue;
              await notifyOrg({ orgId: parentOrgId, eventKey: "org.child_added", actorId: user.id, to: [userId], title: `You were added to ${result.title}`, href, sourceEventId: `added:${result.id}:${userId}`, refs: { projectId: result.id } });
            }
          }
          const creator = (await namesOf([user.id])).get(user.id) ?? "Someone";
          await notifyOrg({ orgId: parentOrgId, eventKey: "org.child_created", actorId: user.id, title: `${creator} created ${result.title}`, href, sourceEventId: `child-created:${result.id}`, refs: { projectId: result.id } });
          try {
            await db.transaction((tx) => createCopiesForNewChild(tx, parentOrgId, result.id, ownerId));
            await notifyNewCopies(parentOrgId, { projectId: result.id });
          } catch (error) {
            notices.push(`The open workspace assignments from ${child.orgTitle} weren’t copied here. Ask an admin to share them again.`);
            logger.warn("org.child_group_copies_failed", { projectId: result.id, error: error instanceof Error ? error.message : String(error) });
          }
        }

        // Plan your first sprints (report §15.2), with the same generator as Plan a series.
        if (organization?.plan_sprints) {
          const plan = organization.plan_sprints;
          const planned = await planSprintSeriesAction({ projectId: result.id, prefix: plan.prefix, count: plan.count, lengthDays: plan.length_days, startDate: plan.start_date });
          if (!planned.success) notices.push(`The first sprints weren’t planned: ${planned.error}`);
        }

        // Co-admins and the pasted roster (report §34.4, §34.10): invited after the org exists, so a failed
        // email never undoes creation. The creator's own address is skipped.
        const invites = { coAdmins: 0, members: 0, skipped: 0 };
        if (organization && (organization.co_admins?.length || organization.invite_emails?.trim())) {
          try {
            const ids = (organization.co_admins ?? []).flatMap((a) => (a.user_id ? [a.user_id] : []));
            const idEmails = ids.length ? (await db.select({ email: profiles.email }).from(profiles).where(inArray(profiles.id, ids))).map((r) => r.email.toLowerCase()) : [];
            const self = (user.email ?? "").toLowerCase();
            const admins = [...new Set([...idEmails, ...(organization.co_admins ?? []).flatMap((a) => (a.email ? [a.email] : []))])].filter((e) => e !== self).slice(0, 10);
            if (admins.length) invites.coAdmins = (await createOrgEmailInvites(result.id, ownerId, { emails: admins, role: "admin", title: null, childProjectId: null, unitId: null })).invited;
            const { valid, invalid } = parseInviteEmails(organization.invite_emails ?? "");
            const members = valid.filter((e) => e !== self && !admins.includes(e));
            invites.skipped = invalid.length + Math.max(0, members.length - ORG_LIMITS.emailInvitesPerPaste);
            if (members.length) invites.members = (await createOrgEmailInvites(result.id, ownerId, { emails: members.slice(0, ORG_LIMITS.emailInvitesPerPaste), role: "member", title: null, childProjectId: null, unitId: null })).invited;
            if (invites.skipped) notices.push(`${invites.skipped} ${invites.skipped === 1 ? "address wasn’t" : "addresses weren’t"} invited (not an email, or over ${ORG_LIMITS.emailInvitesPerPaste}). Invite them from Members.`);
          } catch (error) {
            notices.push("Some invites weren’t sent. Send them again from Members.");
            logger.warn("org.create_invites_failed", { projectId: result.id, error: error instanceof Error ? error.message : String(error) });
          }
        }

        // E1 (report §26.3 A): the owner gets the join code by email too; always sent.
        if (organization) {
          await notifyOrg({
            orgId: result.id, eventKey: "org.created", to: [ownerId], title: `${result.title} is ready${result.joinCode ? ` · share code ${result.joinCode}` : ""}`,
            href: `/org/${encodeURIComponent(result.slug || result.id)}`, sourceEventId: `created:${result.id}`, email: { kind: "org_ready", data: { joinCode: result.joinCode } },
          });
        }

        return {
          success: true,
          project: {
            id: result.id,
            title: result.title,
            slug: result.slug || result.id,
            joinCode: result.joinCode,
            invites,
          },
          notices,
        };
      } catch (error: any) {
        // Check for Unique Constraint Violation on Slug
        // Postgres error code 23505 is unique_violation. Drizzle wraps this in `error.cause`.
        const dbError = error.cause || error;
        if (dbError.code === "23505") {
          const errorMsg =
            String(dbError.message || "") +
            String(dbError.detail || "") +
            String(dbError.constraint_name || "");
          if (errorMsg.includes("join_code")) {
            attempts++;
            joinCode = generateJoinCode();
            continue;
          }
          if (errorMsg.includes("slug")) {
            // An org's handle was free a moment ago; someone else just took it.
            if (orgHandle) return { success: false, error: `@${orgHandle} is taken.` };
            attempts++;
            const suffix = Math.random().toString(36).substring(2, 6);
            finalSlug = `${generateSlugBase(input.title) || "project"}-${suffix}`;
            continue;
          }
          // Project Key Collision (e.g. "NB" already exists)
          if (errorMsg.includes("key")) {
            attempts++;
            const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
            finalKey = `${generateWorkspaceKey(input.title)}${suffix}`;
            continue;
          }
        }
        throw error; // Re-throw other errors
      }
    }

    throw new Error(
      "Couldn’t generate a unique workspace ID. Try again.",
    );
  } catch (error) {
    console.error("Error creating project:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  } finally {
    if (acquiredLock && redis) {
      await redis.del(lockKey).catch(() => undefined);
    }
  }
}


// --- Update Action ---
export async function updateWorkspace(projectId: string, input: UpdateWorkspaceInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Sign in to continue");
  const parsed = updateWorkspaceSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid workspace update");
  const data = parsed.data;

  // Transaction to ensure atomicity of project update + role changes
  return await db
    .transaction(async (tx) => {
      // Check ownership
      const [project] = await tx
        .select({
          id: workspaces.id,
          ownerId: workspaces.ownerId,
          externalLinkMetadata: workspaces.externalLinkMetadata,
          importSource: workspaces.importSource,
          slug: workspaces.slug,
          title: workspaces.title,
          status: workspaces.status,
          kind: workspaces.kind,
          parentId: workspaces.parentId,
        })
        .from(workspaces)
        .where(eq(workspaces.id, projectId))
        .limit(1);

      if (!project) throw new Error("Workspace not found");
      if (project.ownerId !== user.id) {
        // Report §22.3–22.4: an organization's admins edit the tagline, description and tags; the rest stays the owner's.
        const [member] = project.kind === "organization"
          ? await tx.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, user.id))).limit(1)
          : [];
        if (member?.role !== "admin") throw new Error("Sign in to continue");
        const touched = Object.entries(data).filter(([, v]) => v !== undefined).map(([k]) => k);
        if (touched.some((key) => !["shortDescription", "description", "tags"].includes(key))) throw new Error("Only the owner can change this.");
      }
      // Report §27.8, decision 55: an organization's name is 3–100 characters everywhere, as when it was created.
      if (project.kind === "organization" && data.title !== undefined && data.title.trim() !== project.title && data.title.trim().length < 3) {
        throw new Error("Use 3–100 characters for the name.");
      }
      // Pending applications this update closes (the project stopped taking them, or a role went away); their applicants are told after commit.
      const closedApplications: Array<{ reason: ClosingReason; items: ClosedApplication[] }> = [];

      const { roles, deletedRoleIds, ...raw } = data;

      const updateValues: Partial<typeof workspaces.$inferInsert> = {
        updatedAt: new Date(),
      };
      // Member permission toggles are settings, not an update to the workspace.
      if ([raw.title, raw.description, raw.status, raw.shortDescription, raw.problemStatement, raw.solutionStatement, raw.category, raw.tags, raw.externalLinks, raw.skills].some((value) => value !== undefined)) {
        updateValues.lastUpdateAt = new Date();
        updateValues.lastUpdateBy = user.id;
      }
      if (raw.title !== undefined) updateValues.title = raw.title;
      if (raw.description !== undefined) updateValues.description = raw.description;
      if (raw.status !== undefined) updateValues.status = raw.status;
      if (raw.shortDescription !== undefined) updateValues.shortDescription = raw.shortDescription;
      if (raw.problemStatement !== undefined) updateValues.problemStatement = raw.problemStatement;
      if (raw.solutionStatement !== undefined) updateValues.solutionStatement = raw.solutionStatement;
      if (raw.category !== undefined) updateValues.category = raw.category;

      const tagsArray = raw.tags ?? [];
      if (raw.tags !== undefined) updateValues.tags = tagsArray; // Keep JSONB arrays in sync for backward compat
      if (raw.externalLinks !== undefined) {
        const externalLinksSplit = splitWorkspaceSocialLinks(
          raw.externalLinks,
          project.externalLinkMetadata ?? {},
        );
        if ("error" in externalLinksSplit)
          throw new Error(externalLinksSplit.error);
        updateValues.externalLinks = externalLinksSplit.links;
        updateValues.externalLinkMetadata = externalLinksSplit.metadata;
      }
      if (raw.memberUpdatesEnabled !== undefined) updateValues.memberUpdatesEnabled = raw.memberUpdatesEnabled;
      if (raw.memberFileUploadDefault !== undefined) updateValues.memberFileUploadDefault = raw.memberFileUploadDefault;

      // COR-014: resolve skills once, then write the canonical names to the scalar and the junctions together.
      if (raw.skills !== undefined) {
        const resolvedProjectSkills = await syncWorkspaceSkills(tx, projectId, raw.skills, user.id);
        updateValues.skills = resolvedProjectSkills.map((skill) => skill.name);
      }

      await tx
        .update(workspaces)
        .set(updateValues)
        .where(eq(workspaces.id, projectId));
      await markWorkspaceCollaboratorsSummaryStale(projectId, tx);
      const stopsTakingApplications = (status: string | null | undefined) => status === "archived" || status === "completed";
      if (raw.status !== undefined && stopsTakingApplications(raw.status) && !stopsTakingApplications(project.status)) {
        closedApplications.push({
          reason: "project_closed",
          items: await closePendingApplications(tx, { projectId, actorId: user.id, reason: "project_closed", source: "project_update" }),
        });
      }

      // Sync Junction Tables for normalized relational search
      if (raw.tags !== undefined) {
        await tx
          .delete(workspaceTags)
          .where(eq(workspaceTags.projectId, projectId));
        if (tagsArray.length > 0) {
          const tagValues = tagsArray
            .map((t) => {
              const slug = t
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
              return { name: t, slug };
            })
            .filter((t) => t.slug);

          if (tagValues.length > 0) {
            await tx.insert(tags).values(tagValues).onConflictDoNothing();
            const slugs = tagValues.map((v) => v.slug);
            const foundTags = await tx
              .select({ id: tags.id })
              .from(tags)
              .where(inArray(tags.slug, slugs));
            if (foundTags.length > 0) {
              await tx
                .insert(workspaceTags)
                .values(foundTags.map((t) => ({ projectId, tagId: t.id })))
                .onConflictDoNothing();
            }
          }
        }
      }

      let openRoles;

      // Update Roles
      if (roles && Array.isArray(roles)) {
        // Intercept lead-role if present
        let updatedImportSource = project.importSource;
        const cleanRoles = [];
        const leadRole = roles.find((r: any) => r.id === "lead-role");
        if (leadRole) {
          const metadata = {
            ...((project.importSource as any)?.metadata || {}),
          };
          metadata.leadFocus = (leadRole.role || "").trim();
          metadata.leadDescription = (leadRole.description || "").trim();

          updatedImportSource = {
            ...(project.importSource || { type: "scratch" }),
            metadata,
          };

          // Save updated importSource
          updateValues.importSource = updatedImportSource;
          await tx
            .update(workspaces)
            .set({ importSource: updatedImportSource })
            .where(eq(workspaces.id, projectId));
        } else {
          // Keep leadFocus synced if lead occupies an open role directly
          const prevLeadFocus = ((project.importSource as any)?.metadata?.leadFocus || "").trim().toLowerCase();
          const matchingRole = roles.find((r: any) => (r.role || "").trim().toLowerCase() === prevLeadFocus);
          if (matchingRole) {
            const metadata = {
              ...((project.importSource as any)?.metadata || {}),
            };
            metadata.leadFocus = (matchingRole.role || "").trim();
            if (matchingRole.description) {
              metadata.leadDescription = matchingRole.description.trim();
            }
            updatedImportSource = {
              ...(project.importSource || { type: "scratch" }),
              metadata,
            };
            updateValues.importSource = updatedImportSource;
            await tx
              .update(workspaces)
              .set({ importSource: updatedImportSource })
              .where(eq(workspaces.id, projectId));
          }
        }

        // Filter out lead-role from database projectOpenRoles sync
        for (const r of roles) {
          if (r.id !== "lead-role") {
            cleanRoles.push(r);
          }
        }

        const cleanDeletedIds = (deletedRoleIds || []).filter(
          (id: string) => id !== "lead-role",
        );
        // Report §21.4: a workspace in an organization has up to 20 teams, checked before any team is written.
        if (project.parentId) {
          const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceOpenRoles).where(eq(workspaceOpenRoles.projectId, projectId));
          const after = n - cleanDeletedIds.length + cleanRoles.filter((role) => !role.id).length;
          const full = orgLimitBlock("teams", after - 1, { org: project.title || "This workspace", isAdmin: true });
          if (full) throw new Error(full);
        }

        // Every client-supplied role id must belong to this project before any
        // write in this command (COR-001).
        const suppliedRoleIds = Array.from(new Set([
          ...cleanDeletedIds,
          ...cleanRoles.map((role) => role.id).filter((id): id is string => Boolean(id)),
        ]));
        if (suppliedRoleIds.length > 0) {
          const ownedRoles = await tx
            .select({ id: workspaceOpenRoles.id })
            .from(workspaceOpenRoles)
            .where(and(eq(workspaceOpenRoles.projectId, projectId), inArray(workspaceOpenRoles.id, suppliedRoleIds)));
          if (ownedRoles.length !== suppliedRoleIds.length) {
            throw new Error("Role not found in this workspace");
          }
        }

        if (cleanDeletedIds.length > 0) {
          // The people waiting on a role that goes away are told, not left with a card for a role that no longer exists.
          closedApplications.push({
            reason: "role_removed",
            items: await closePendingApplications(tx, { projectId, actorId: user.id, reason: "role_removed", roleIds: cleanDeletedIds, source: "role_deleted" }),
          });
          await tx
            .delete(workspaceOpenRoles)
            .where(
              and(
                eq(workspaceOpenRoles.projectId, projectId),
                inArray(workspaceOpenRoles.id, cleanDeletedIds),
              ),
            );
        }

        for (const role of cleanRoles) {
          if (role.id) {
            const resolvedRoleSkills = await syncRoleSkills(
              tx,
              projectId,
              role.id,
              role.skills || [],
              user.id,
            );
            await tx
              .update(workspaceOpenRoles)
              .set({
                role: role.role,
                count: role.count,
                description: role.description || "",
                skills: resolvedRoleSkills.map((skill) => skill.name),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(workspaceOpenRoles.projectId, projectId),
                  eq(workspaceOpenRoles.id, role.id),
                ),
              );
          } else {
            const [insertedRole] = await tx
              .insert(workspaceOpenRoles)
              .values({
                projectId: project.id,
                role: role.role,
                count: role.count || 1,
                description: role.description || "",
                skills: role.skills || [],
              })
              .returning({ id: workspaceOpenRoles.id });
            if (insertedRole) {
              const resolvedRoleSkills = await syncRoleSkills(
                tx,
                projectId,
                insertedRole.id,
                role.skills || [],
                user.id,
              );
              await tx
                .update(workspaceOpenRoles)
                .set({ skills: resolvedRoleSkills.map((skill) => skill.name) })
                .where(eq(workspaceOpenRoles.id, insertedRole.id));
            }
          }
        }

        // Lowering a role's count to what is already filled leaves nothing to apply for.
        closedApplications.push({
          reason: "role_filled",
          items: await closePendingApplications(tx, { projectId, actorId: user.id, reason: "role_filled", filledRolesOnly: true, source: "role_count_lowered" }),
        });

        openRoles = await tx
          .select({
            id: workspaceOpenRoles.id,
            projectId: workspaceOpenRoles.projectId,
            role: workspaceOpenRoles.role,
            title: workspaceOpenRoles.title,
            description: workspaceOpenRoles.description,
            count: workspaceOpenRoles.count,
            filled: workspaceOpenRoles.filled,
            skills: workspaceOpenRoles.skills,
            createdAt: workspaceOpenRoles.createdAt,
            updatedAt: workspaceOpenRoles.updatedAt,
          })
          .from(workspaceOpenRoles)
          .where(eq(workspaceOpenRoles.projectId, projectId))
          .orderBy(
            desc(workspaceOpenRoles.updatedAt),
            desc(workspaceOpenRoles.createdAt),
          );
      }

      return {
        success: true,
        slug: project.slug,
        id: project.id,
        ownerId: project.ownerId,
        title: project.title,
        closedApplications,
        openRoles,
      };
    })
    .then(
      async ({
        success,
        slug,
        id,
        ownerId,
        title,
        closedApplications,
        openRoles,
      }) => {
        revalidatePath(`/workspaces/${slug}`);
        revalidatePath(`/workspaces/${id}`);
        await invalidateWorkspacePublicCaches(id);
        // Report §27.9: a rename sends a staff-given badge back for review.
        if (data.title !== undefined) await recheckOrgVerification(id, { renamed: true });
        for (const closed of closedApplications) {
          await notifyClosedApplications(closed.items, { reason: closed.reason, projectId: id, projectSlug: slug, projectTitle: title, actorUserId: user.id, traceId: `project_update_${id.slice(0, 8)}` });
        }
        if (data.roles) {
          const createdCount = data.roles.filter((role) => !role.id).length;
          const updatedCount = data.roles.length - createdCount;
          const deletedCount = data.deletedRoleIds?.length ?? 0;
          const eventKey =
            createdCount > 0 && updatedCount === 0 && deletedCount === 0
              ? "roles.created"
              : deletedCount > 0
                ? "roles.closed"
                : "roles.updated";
          await enqueueWorkspaceNotificationBestEffort(
            {
              projectId: id,
              actorUserId: user.id,
              ...actorNotificationSnapshot(user),
              eventKey,
              title: "Workspace roles updated",
              body: `${createdCount} created · ${updatedCount} updated · ${deletedCount} removed.`,
              sourceEventId: `${id}:roles:${Date.now()}`,
              entityRefs: { projectId: id },
            },
            {
              createdCount,
              updatedCount,
              deletedCount,
            },
          );
        }
        if (data.roles || data.status !== undefined) {
          void inngest.send({
            name: "connections/sync_suggestions",
            data: { userId: ownerId },
          }).catch((syncError) => {
            logger.warn("project.suggestion_sync_enqueue_failed", {
              module: "project",
              projectId: id,
              userId: ownerId,
              error: syncError instanceof Error ? syncError.message : String(syncError),
            });
          });
        }
        return openRoles === undefined ? { success } : { success, openRoles };
      },
    );
}


export async function createWorkspaceCoverImageUploadUrlAction(input: {
  projectId: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<
  | {
      success: true;
      uploadUrl: string;
      uploadIntentId: string;
      operationId: string;
      storagePath: string;
      contentType: string;
      bucket: string;
      uploadToken: string;
    }
  | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Sign in to continue" };
    }

    const { allowed } = await consumeRateLimit(
      `upload:project-image:user:${user.id}`,
      10,
      60 * 60,
    );
    if (!allowed) {
      return {
        success: false,
        error:
          "Too many workspace image upload attempts. Try again later.",
      };
    }

    await assertProjectOwnerForSettings(input.projectId, user.id);
    const normalizedMimeType = normalizeAndValidateMimeType(input.mimeType);
    if (!ALLOWED_PROJECT_COVER_MIME_TYPES.has(normalizedMimeType)) {
      return {
        success: false,
        error: "Unsupported image type. Use JPG, PNG, WebP, or GIF.",
      };
    }
    const expectedSize = normalizeAndValidateFileSize(
      input.sizeBytes,
      WORKSPACE_COVER_UPLOAD_MAX_FILE_BYTES,
      "Workspace image",
    );
    const extension = projectCoverExtensionFromMimeType(normalizedMimeType);
    const storagePath = `projects/${input.projectId}/project-images/${user.id}/${Date.now()}-${randomUUID()}.${extension}`;
    const intent = await createUploadIntent({
      userId: user.id,
      projectId: input.projectId,
      bucket: WORKSPACE_COVER_UPLOAD_BUCKET,
      storageKey: storagePath,
      scope: "workspace_cover",
      kind: "cover",
      expectedMimeType: normalizedMimeType,
      expectedSize,
      metadata: {
        kind: "project_image",
        projectId: input.projectId,
      },
    });

    const admin = await createAdminClient();
    const { data, error } = await admin.storage
      .from(WORKSPACE_COVER_UPLOAD_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (error || !data?.signedUrl || !data?.token) {
      logger.error("project.cover_upload_url_failed", {
        module: "projects",
        projectId: input.projectId,
        userId: user.id,
        error: error?.message || "Missing signed URL token",
      });
      return {
        success: false,
        error: "Couldn’t prepare workspace image upload.",
      };
    }

    return {
      success: true,
      uploadUrl: data.signedUrl,
      uploadIntentId: intent.id,
      operationId: intent.id,
      storagePath,
      contentType: normalizedMimeType,
      bucket: WORKSPACE_COVER_UPLOAD_BUCKET,
      uploadToken: data.token,
    };
  } catch (error) {
    logger.error("project.cover_upload_url_failed", {
      module: "projects",
      projectId: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Couldn’t prepare workspace image upload." };
  }
}


export async function finalizeWorkspaceCoverImageUploadAction(input: {
  projectId: string;
  uploadIntentId: string;
}): Promise<
  | {
      success: true;
      publicUrl: string;
      storagePath: string;
      uploadIntentId: string;
      removedPreviousImages: number;
    }
  | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Sign in to continue" };
    }

    const project = await assertProjectOwnerForSettings(
      input.projectId,
      user.id,
    );
    const intent = await finalizeUploadIntent({
      intentId: input.uploadIntentId,
      bucket: WORKSPACE_COVER_UPLOAD_BUCKET,
      userId: user.id,
      projectId: input.projectId,
      expectedScope: "workspace_cover",
      expectedKind: "cover",
    });
    if (!intent.assetId) throw new Error("Verified workspace image is missing lifecycle identity");
    const assetId = intent.assetId;
    try {
      await shrinkStoredWorkspaceCover(assetId);
    } catch (error) {
      if (!(error instanceof CoverTooLargeError)) throw error;
      await db.transaction((tx) => scheduleAssetDeletionIfUnreferenced(tx, [assetId]));
      return { success: false, error: error.message };
    }
    const imageUrl = buildWorkspaceImageRoute(input.projectId, intent.storageKey);

    const updated = await db.transaction(async (tx) => {
      const [publishableAsset] = await tx.update(storageAssets)
        .set({
          backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
          updatedAt: new Date(),
        })
        .where(and(eq(storageAssets.id, assetId), eq(storageAssets.state, "verified")))
        .returning({ id: storageAssets.id });
      if (!publishableAsset) throw new Error("Workspace image is no longer publishable");

      const [row] = await tx
        .update(workspaces)
        .set({
          coverImage: imageUrl,
          coverImageBucket: WORKSPACE_COVER_UPLOAD_BUCKET,
          coverImageKey: intent.storageKey,
          coverImageAssetId: assetId,
          updatedAt: new Date(),
          lastUpdateAt: new Date(),
          lastUpdateBy: user.id,
        })
        .where(
          and(eq(workspaces.id, input.projectId), eq(workspaces.ownerId, user.id)),
        )
        .returning({ id: workspaces.id });
      if (!row) return null;

      if (project.coverImageAssetId && project.coverImageAssetId !== assetId) {
        await scheduleAssetDeletionIfUnreferenced(tx, [project.coverImageAssetId]);
      }
      return row;
    });

    if (!updated) {
      return { success: false, error: "Couldn’t publish workspace image." };
    }

    await revalidateWorkspacePaths(input.projectId);
    await invalidateWorkspacePublicCaches(input.projectId);

    return {
      success: true,
      publicUrl: imageUrl,
      storagePath: intent.storageKey,
      uploadIntentId: intent.id,
      removedPreviousImages: 0,
    };
  } catch (error) {
    logger.error("project.cover_upload_finalize_failed", {
      module: "projects",
      projectId: input.projectId,
      uploadIntentId: input.uploadIntentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: "Couldn’t finalize workspace image upload.",
    };
  }
}


export async function clearWorkspaceCoverImageAction(
  projectId: string,
): Promise<
  | { success: true; removedPreviousImages: number }
  | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Sign in to continue" };
    }

    const project = await assertProjectOwnerForSettings(projectId, user.id);
    if (!project.coverImage) {
      return { success: true, removedPreviousImages: 0 };
    }

    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(workspaces)
        .set({
          coverImage: null,
          coverImageBucket: null,
          coverImageKey: null,
          coverImageAssetId: null,
          updatedAt: new Date(),
          lastUpdateAt: new Date(),
          lastUpdateBy: user.id,
        })
        .where(and(eq(workspaces.id, projectId), eq(workspaces.ownerId, user.id)))
        .returning({ id: workspaces.id });
      if (project.coverImageAssetId) {
        await scheduleAssetDeletionIfUnreferenced(tx, [project.coverImageAssetId]);
      }
      return rows;
    });

    if (!updated) {
      return { success: false, error: "Couldn’t clear workspace image." };
    }

    await revalidateWorkspacePaths(projectId);
    await invalidateWorkspacePublicCaches(projectId);

    return { success: true, removedPreviousImages: 0 };
  } catch (error) {
    logger.error("project.cover_clear_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Couldn’t clear workspace image." };
  }
}


/** Lead and Co-leaders manage project-owned accounts; personal profile links are never inherited. */
export async function updateWorkspaceExternalLinksAction(
  projectId: string,
  input: unknown,
  expectedLinks?: unknown,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return { success: false as const, error: "You must be signed in." };

    const initialSplit = splitWorkspaceSocialLinks(input);
    if ("error" in initialSplit)
      return { success: false as const, error: initialSplit.error };
    const [project] = await db
      .select({ ownerId: workspaces.ownerId, slug: workspaces.slug, externalLinks: workspaces.externalLinks, externalLinkMetadata: workspaces.externalLinkMetadata })
      .from(workspaces)
      .where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!project)
      return { success: false as const, error: "Workspace not found." };

    const [membership] =
      project.ownerId === user.id
        ? [null]
        : await db
            .select({ role: workspaceMembers.role })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.projectId, projectId),
                eq(workspaceMembers.userId, user.id),
              ),
            )
            .limit(1);
    if (project.ownerId !== user.id && membership?.role !== "admin") {
      return {
        success: false as const,
        error: "Only the owner and admins can change links.",
      };
    }

    const savedSplit = splitWorkspaceSocialLinks(input, project.externalLinkMetadata ?? {});
    if ("error" in savedSplit)
      return { success: false as const, error: savedSplit.error };
    const links = savedSplit.links;

    if (expectedLinks !== undefined) {
      const expected = validateWorkspaceSocialLinks(expectedLinks);
      if (!expected.success)
        return { success: false as const, error: expected.error };
      const current = normalizeWorkspaceSocialLinks(project.externalLinks);
      if (!areWorkspaceSocialLinksEqual(current, expected.links)) {
        return {
          success: false as const,
          conflict: true as const,
          error: "Workspace links changed in another session. The changes were merged; review and save again.",
          currentData: current,
        };
      }
    }

    await db.transaction(async (tx) => {
      const currentLinks = normalizeWorkspaceSocialLinks(project.externalLinks);
      const currentIds = new Set(currentLinks.map((link) => link.id));
      const nextIds = new Set(links.map((link) => link.id));
      const added = links.filter((link) => !currentIds.has(link.id));
      const removed = currentLinks.filter((link) => !nextIds.has(link.id));
      const reordered = currentLinks.filter((link) => nextIds.has(link.id)).map((link) => link.id).join('|')
        !== links.filter((link) => currentIds.has(link.id)).map((link) => link.id).join('|');
      const externalLinkMetadata = {
        ...savedSplit.metadata,
        ...(project.externalLinkMetadata?.['github-integration']
          ? { 'github-integration': project.externalLinkMetadata['github-integration'] }
          : {}),
      };
      await tx
        .update(workspaces)
        .set({ externalLinks: links, externalLinkMetadata, updatedAt: new Date() })
        .where(eq(workspaces.id, projectId));
      await tx.insert(workspaceNodeEvents).values({
        projectId,
        actorId: user.id,
        type: "project_social_links.updated",
        metadata: {
          platforms: links.map((link) => link.platform || "other").sort(),
          purposes: [...new Set(links.map((link) => link.purpose || "other"))].sort(),
          count: links.length,
          added: added.map((link) => ({ id: link.id, platform: link.platform || "other", purpose: link.purpose || "other" })),
          removed: removed.map((link) => ({ id: link.id, platform: link.platform || "other", purpose: link.purpose || "other" })),
          reordered,
        },
      });
    });
    await revalidateWorkspacePaths(projectId);
    // Report §27.9: an organization's badge holds only while its website stays on the verified domain.
    await recheckOrgVerification(projectId, { links: true });
    logger.metric("project.social_links.update", {
      projectId,
      userId: user.id,
      platforms: links.map((link) => link.platform || "other").sort(),
      count: links.length,
    });
    return { success: true as const, data: links, metadata: savedSplit.metadata };
  } catch (error) {
    logger.error("project.social_links.update_failed", {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false as const,
      error: "Couldn’t update workspace links.",
    };
  }
}


export async function archiveWorkspaceAction(
  projectId: string,
): Promise<WorkspaceSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const owned = await loadOwnedWorkspaceForSettings(projectId, user.id);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };
    if (owned.project.status === "archived") {
      return { success: true, message: "Workspace is already archived" };
    }

    const archivedAt = new Date();
    let closedByArchive: ClosedApplication[] = [];
    await db.transaction(async (tx) => {
      await tx
        .update(workspaces)
        // Report §35.3: who archived it decides who can unarchive it.
        .set({ status: "archived", updatedAt: archivedAt, orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('archivedBy', jsonb_build_object('userId', ${user.id}::text, 'admin', false, 'at', ${archivedAt.toISOString()}::text))` })
        .where(eq(workspaces.id, projectId));
      closedByArchive = await closePendingApplications(tx, { projectId, actorId: user.id, reason: "project_closed", source: "project_archived" });
      const ended = await tx
        .update(workspaceMentors)
        .set({
          status: "ended",
          endedAt: archivedAt,
          endedBy: user.id,
          endReason: "Workspace archived",
          updatedAt: archivedAt,
        })
        .where(
          and(
            eq(workspaceMentors.projectId, projectId),
            eq(workspaceMentors.status, "active"),
          ),
        )
        .returning({ id: workspaceMentors.id });
      if (ended.length > 0) {
        await tx.insert(workspaceNodeEvents).values({
          projectId,
          actorId: user.id,
          nodeId: null,
          type: "project_guidance.ended",
          metadata: {
            reason: "project_archived",
            appointmentId: ended[0]?.id ?? null,
          },
          createdAt: archivedAt,
        });
      }
    });
    await revalidateWorkspacePaths(projectId);
    await notifyClosedApplications(closedByArchive, { reason: "project_closed", projectId, projectSlug: owned.project.slug, projectTitle: owned.project.title, actorUserId: user.id, traceId: `project_archive_${projectId.slice(0, 8)}` });
    const actor = actorNotificationSnapshot(user);
    await enqueueWorkspaceNotificationBestEffort(
      {
        projectId,
        actorUserId: user.id,
        ...actor,
        eventKey: "security.project_archived",
        title: `${actor.actorName || "Someone"} archived ${owned.project.title || "Workspace"}`,
        body: "The workspace was archived from settings.",
        href: `/workspaces/${encodeURIComponent(owned.project.slug || projectId)}?tab=settings&settings=danger`,
        // Each archive is its own event, so archiving again after Unarchive tells people again (decision 93).
        sourceEventId: `archive:${projectId}:${archivedAt.getTime()}`,
        entityRefs: {
          projectId,
          projectSlug: owned.project.slug ?? null,
        },
      },
      { action: "archive" },
    );

    logger.metric("project.settings.archive.result", {
      projectId,
      userId: user.id,
      result: "success",
    });
    return { success: true, message: "Workspace archived." };
  } catch (error) {
    console.error("Failed to archive project:", error);
    logger.metric("project.settings.archive.result", {
      projectId,
      result: "error",
      errorCode: "INTERNAL_ERROR",
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Couldn’t archive workspace",
    };
  }
}


export async function countUnregisteredWorkspaceStorage(projectId: string, executor: Pick<typeof db, "execute"> = db) {
  const rows = await executor.execute<{ legacy_count: number }>(sql`
    SELECT (
      (SELECT count(*) FROM public.workspaces project
        WHERE project.id = ${projectId}
          AND (project.cover_image_key IS NOT NULL OR project.cover_image LIKE '%/storage/v1/object/%')
          AND project.cover_image_asset_id IS NULL)
      + (SELECT count(*) FROM public.workspace_nodes node
        WHERE node.workspace_id = ${projectId}
          AND node.s3_key IS NOT NULL
          AND node.asset_id IS NULL)
      + (SELECT count(*) FROM public.file_versions version
          JOIN public.workspace_nodes node ON node.id = version.node_id
        WHERE node.workspace_id = ${projectId}
          AND version.s3_key <> ''
          AND version.asset_id IS NULL)
      + (SELECT count(*) FROM public.workspace_updates update_row
        WHERE update_row.workspace_id = ${projectId}
          AND jsonb_array_length(update_row.media) > (
            SELECT count(*) FROM public.workspace_update_media_assets media_ref
            WHERE media_ref.update_id = update_row.id
          ))
      + (SELECT count(*) FROM public.workspace_update_drafts draft
        WHERE draft.workspace_id = ${projectId}
          AND jsonb_array_length(draft.media) > (
            SELECT count(*) FROM public.workspace_update_draft_media_assets media_ref
            WHERE media_ref.workspace_id = draft.workspace_id
              AND media_ref.user_id = draft.user_id
          ))
      -- chat_attachments always reference a storage asset, so chat adds nothing here.
      + (SELECT count(*) FROM public.import_jobs import_job
        WHERE import_job.workspace_id = ${projectId}
          AND import_job.manifest_s3_key IS NOT NULL
          AND import_job.manifest_asset_id IS NULL)
      + (SELECT count(*) FROM public.github_sync_runs sync_run
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(sync_run.manifest->'files', '[]'::jsonb)
          ) AS sync_file
        WHERE sync_run.workspace_id = ${projectId}
          AND sync_file->>'snapshotKey' LIKE (${projectId}::text || '/sync-snapshots/' || sync_run.id::text || '/%')
          AND NOT EXISTS (
            SELECT 1 FROM public.github_sync_snapshot_assets snapshot_ref
            WHERE snapshot_ref.run_id = sync_run.id
              AND snapshot_ref.path = sync_file->>'path'
          ))
    )::int AS legacy_count
  `);
  return rows[0]?.legacy_count ?? 0;
}


export async function scheduleWorkspaceStorageDeletion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: string,
) {
  await tx.update(storageAssets)
    .set({
      state: "delete_pending",
      deleteAfter: sql`GREATEST(${storageAssets.expiresAt} + interval '5 minutes', now())`,
      metadata: sql`${storageAssets.metadata} || jsonb_build_object(
        'projectDeletionId', ${projectId}::text,
        'projectCleanupScheduledAt', now()
      )`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(storageAssets.projectId, projectId),
      inArray(storageAssets.state, ["pending", "verified"]),
    ));
}


// --- Delete Action ---
export async function deleteWorkspace(
  projectId: string,
): Promise<
  | { success: true; message: string; data: { redirectTo: string } }
  | { success: false; message: string; errorCode: WorkspaceSettingsErrorCode }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const [project] = await db
      .select({
        ownerId: workspaces.ownerId,
        slug: workspaces.slug,
        title: workspaces.title,
      })
      .from(workspaces)
      .where(eq(workspaces.id, projectId))
      .limit(1);

    if (!project) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Workspace not found.",
      };
    }
    if (project.ownerId !== user.id) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "Only the owner can delete this workspace.",
      };
    }
    const unregisteredStorage = await countUnregisteredWorkspaceStorage(projectId);
    if (unregisteredStorage > 0) {
      return {
        success: false,
        errorCode: "STORAGE_MIGRATION_PENDING",
        message: `Workspace deletion is waiting for ${unregisteredStorage} storage references to be registered.`,
      };
    }

    // Preserve deletion evidence before domain rows cascade away. Ownership and
    // storage registration are rechecked under the project row lock, so a
    // transfer or new legacy reference after the preflight blocks it (COR-048).
    let waitingApplicants: ClosedApplication[] = [];
    const blocked = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ ownerId: workspaces.ownerId })
        .from(workspaces)
        .where(eq(workspaces.id, projectId))
        .for("update");
      if (!locked || locked.ownerId !== user.id) return "FORBIDDEN" as const;
      if (await countUnregisteredWorkspaceStorage(projectId, tx) > 0) return "STORAGE_MIGRATION_PENDING" as const;
      // Work handed in to an organization stays on its record: archive instead (decision 90, report §35.3). Checked
      // under the row lock, so a hand-in can't land between the check and the delete.
      const [handedIn] = await tx.execute<{ id: string }>(sql`
        SELECT t.id FROM tasks t WHERE t.workspace_id = ${projectId}::uuid AND t.assignment_id IS NOT NULL AND t.deleted_at IS NULL
          AND (t.review_status = 'pending' OR t.status = 'done' OR t.review_submitted_at IS NOT NULL)
        LIMIT 1 FOR UPDATE`);
      if (handedIn) return "HANDED_IN" as const;
      // The applications go with the project: their applicants are told once the delete has committed.
      waitingApplicants = await tx
        .select({ id: roleApplications.id, applicantId: roleApplications.applicantId, roleId: roleApplications.roleId })
        .from(roleApplications)
        .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, "pending")));
      await scheduleWorkspaceStorageDeletion(tx, projectId);
      // Hard-delete the project (cascades to nodes, tasks, sprints, members,
      // and its chat channels; cards elsewhere then show a restricted placeholder).
      const deletedProjects = await tx
        .delete(workspaces)
        .where(and(eq(workspaces.id, projectId), eq(workspaces.ownerId, user.id)))
        .returning({ id: workspaces.id });

      // Keep denormalized profile stats in sync
      if (deletedProjects.length > 0) {
        await tx
          .update(profiles)
          .set({
            projectsCount: sql`GREATEST(0, ${profiles.projectsCount} - 1)`,
          })
          .where(eq(profiles.id, user.id));
      }
      return null;
    });
    if (blocked) {
      return {
        success: false,
        errorCode: blocked === "HANDED_IN" ? "FORBIDDEN" : blocked,
        message: blocked === "HANDED_IN"
          ? "This workspace holds work handed in to its organization. Archive it instead."
          : blocked === "FORBIDDEN"
            ? "Only the owner can delete this workspace."
            : "Workspace deletion is waiting for storage references to be registered.",
      };
    }

    await notifyClosedApplications(waitingApplicants, { reason: "project_closed", projectId, projectSlug: project.slug, projectTitle: project.title, actorUserId: user.id, traceId: `project_delete_${projectId.slice(0, 8)}` });

    logger.metric("project.settings.delete.result", {
      projectId,
      userId: user.id,
      result: "success",
    });

    revalidatePath("/discover");
    revalidatePath(`/workspaces/${project.slug || projectId}`);
    return {
      success: true,
      message: "Workspace deleted.",
      data: { redirectTo: "/discover" },
    };
  } catch (error) {
    console.error("Failed to delete project:", error);
    logger.metric("project.settings.delete.result", {
      projectId,
      result: "error",
      errorCode: "INTERNAL_ERROR",
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Couldn’t delete workspace",
    };
  }
}


/**
 * Deep deletion of a project draft.
 * Wipes DB records and S3 assets completely.
 */
export async function deleteWorkspaceDraftAction(
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to continue");

    const [project] = await db
      .select({
        ownerId: workspaces.ownerId,
      })
      .from(workspaces)
      .where(eq(workspaces.id, projectId))
      .limit(1);

    if (!project) return { success: true }; // Already gone
    if (project.ownerId !== user.id) throw new Error("Sign in to continue");

    const unregisteredStorage = await countUnregisteredWorkspaceStorage(projectId);
    if (unregisteredStorage > 0) {
      return {
        success: false,
        error: `Draft deletion is waiting for ${unregisteredStorage} storage references to be registered.`,
      };
    }

    // Only a draft the caller still owns is deep-deleted; both are rechecked
    // under the row lock with storage registration (COR-048).
    const blockedReason = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ ownerId: workspaces.ownerId, status: workspaces.status })
        .from(workspaces)
        .where(eq(workspaces.id, projectId))
        .for("update");
      if (!locked) return null;
      if (locked.ownerId !== user.id) return "Sign in to continue";
      if (locked.status !== "draft") return "Only draft workspaces can be discarded. Use workspace deletion instead.";
      if (await countUnregisteredWorkspaceStorage(projectId, tx) > 0) return "Draft deletion is waiting for storage references to be registered.";
      await scheduleWorkspaceStorageDeletion(tx, projectId);
      // Delete project (cascades to members, roles, etc.)
      const deleted = await tx
        .delete(workspaces)
        .where(and(eq(workspaces.id, projectId), eq(workspaces.ownerId, user.id), eq(workspaces.status, "draft")))
        .returning({ id: workspaces.id });
      if (deleted.length > 0) {
        await tx
          .update(profiles)
          .set({ projectsCount: sql`GREATEST(0, ${profiles.projectsCount} - 1)` })
          .where(eq(profiles.id, user.id));
      }
      return null;
    });
    if (blockedReason) return { success: false, error: blockedReason };

    revalidatePath("/discover");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete draft:", error);
    return { success: false, error: error.message || "Couldn’t delete draft" };
  }
}


// --- Interaction Actions ---

export async function toggleWorkspaceFollowAction(
  projectId: string,
  shouldFollow: boolean,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to continue" };
  try {
    const followRate = await consumeRateLimit(
      `project-follow:${user.id}`,
      80,
      60,
    );
    if (!followRate.allowed) {
      return {
        success: false,
        error: "Too many follow actions. Wait and try again.",
      };
    }
    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project || !access.canRead) {
      return { success: false, error: "Workspace not found or private." };
    }
    // Report §37.8: an organization's followers are outsiders, and a suspended or deleting one can't be followed.
    if (shouldFollow && access.project.kind === "organization") {
      if (access.isOwner || access.isMember) return { success: false, error: "You’re a member, so you already see its posts." };
      if (access.writeBlocked === "suspended" || access.writeBlocked === "deleting") return { success: false, error: "This organization isn’t available." };
    }
    // Across a block (either way) there's no following: the blocked side can't reach the other's projects.
    if (shouldFollow && access.project.ownerId !== user.id) {
      const relationship = await resolvePrivacyRelationship(user.id, access.project.ownerId);
      if (relationship?.blockedByViewer || relationship?.blockedByTarget) {
        return { success: false, error: "Workspace not found or private." };
      }
    }

    const followersCount = await db.transaction(async (tx) => {
      await lockProjectUserPair(tx, projectId, user.id);

      if (shouldFollow) {
        const inserted = await tx
          .insert(workspaceFollows)
          .values({ userId: user.id, projectId })
          .onConflictDoNothing({
            target: [workspaceFollows.projectId, workspaceFollows.userId],
          })
          .returning({ id: workspaceFollows.id });

        if (inserted.length > 0) {
          const [updated] = await tx
            .update(workspaces)
            .set({ followersCount: sql`${workspaces.followersCount} + 1` })
            .where(eq(workspaces.id, projectId))
            .returning({ followersCount: workspaces.followersCount });
          return updated?.followersCount ?? 0;
        }
      } else {
        const deleted = await tx
          .delete(workspaceFollows)
          .where(
            and(
              eq(workspaceFollows.userId, user.id),
              eq(workspaceFollows.projectId, projectId),
            ),
          )
          .returning({ id: workspaceFollows.id });

        if (deleted.length > 0) {
          const [updated] = await tx
            .update(workspaces)
            .set({
              followersCount: sql`GREATEST(${workspaces.followersCount} - 1, 0)`,
            })
            .where(eq(workspaces.id, projectId))
            .returning({ followersCount: workspaces.followersCount });
          return updated?.followersCount ?? 0;
        }
      }

      const [row] = await tx
        .select({ followersCount: workspaces.followersCount })
        .from(workspaces)
        .where(eq(workspaces.id, projectId))
        .limit(1);
      return row?.followersCount ?? 0;
    });

    await revalidateProjectFollowers(projectId);
    return { success: true, followersCount };
  } catch (error) {
    console.error("Error toggling follow:", error);
    return { success: false, error: "Couldn’t update follow status" };
  }
}


// Helper: Map wizard status to database status
function mapStatus(
  status?: string,
): "draft" | "active" | "completed" | "archived" {
  switch (status) {
    case "open":
    case "active":
      return "active";
    case "completed":
      return "completed";
    case "archived":
      return "archived";
    default:
      return "draft";
  }
}


type UpdateProjectStageOptions = {
  expectedUpdatedAt?: string | null;
};


type UpdateProjectStageResult =
  | {
      success: true;
      currentStageIndex: number;
      updatedAt: string | null;
      stageCompletionDates?: Record<string, string>;
    }
  | {
      success: false;
      error: string;
      errorCode:
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "PROJECT_CONFLICT"
        | "INVALID_INPUT"
        | "INTERNAL_ERROR";
      latest?: {
        currentStageIndex: number;
        updatedAt: string | null;
      };
    };


export async function updateWorkspaceStageAction(
  projectId: string,
  currentStageIndex: number,
  options?: UpdateProjectStageOptions,
): Promise<UpdateProjectStageResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        error: "Sign in to continue",
        errorCode: "UNAUTHORIZED",
      };
    }

    const normalizedIndex =
      Number.isInteger(currentStageIndex) && currentStageIndex >= 0
        ? currentStageIndex
        : null;
    if (normalizedIndex === null) {
      return {
        success: false,
        error: "Invalid stage index",
        errorCode: "INVALID_INPUT",
      };
    }

    const [projectForStageUpdate] = await db
      .select({
        ownerId: workspaces.ownerId,
        lifecycleStages: workspaces.lifecycleStages,
        currentStageIndex: workspaces.currentStageIndex,
        stageCompletionDates: workspaces.stageCompletionDates,
      })
      .from(workspaces)
      .where(eq(workspaces.id, projectId))
      .limit(1);

    if (!projectForStageUpdate) {
      return {
        success: false,
        error: "Workspace not found",
        errorCode: "NOT_FOUND",
      };
    }
    if (projectForStageUpdate.ownerId !== user.id) {
      return {
        success: false,
        error: "Only the workspace owner can advance the stage",
        errorCode: "FORBIDDEN",
      };
    }

    const lifecycleStages = Array.isArray(projectForStageUpdate.lifecycleStages)
      ? projectForStageUpdate.lifecycleStages
      : [];
    if (normalizedIndex >= lifecycleStages.length) {
      return {
        success: false,
        error: "Stage index out of range",
        errorCode: "INVALID_INPUT",
      };
    }

    let expectedUpdatedAtDate: Date | null = null;
    const expectedUpdatedAtRaw = options?.expectedUpdatedAt?.trim();
    if (expectedUpdatedAtRaw) {
      expectedUpdatedAtDate = new Date(expectedUpdatedAtRaw);
      if (Number.isNaN(expectedUpdatedAtDate.getTime())) {
        return {
          success: false,
          error: "Invalid lifecycle version",
          errorCode: "INVALID_INPUT",
        };
      }
    }

    const whereClause = expectedUpdatedAtDate
      ? and(
          eq(workspaces.id, projectId),
          eq(workspaces.ownerId, user.id),
          eq(workspaces.updatedAt, expectedUpdatedAtDate),
        )
      : and(eq(workspaces.id, projectId), eq(workspaces.ownerId, user.id));

    const previousStageIndex = Math.min(
      Math.max(0, projectForStageUpdate.currentStageIndex ?? 0),
      Math.max(0, lifecycleStages.length - 1),
    );
    const updatedDates = buildJourneyCompletionDates({
      completionDates: projectForStageUpdate.stageCompletionDates,
      previousStageIndex,
      nextStageIndex: normalizedIndex,
      transitionedAt: new Date().toISOString(),
    });

    const [updated] = await db
      .update(workspaces)
      .set({
        currentStageIndex: normalizedIndex,
        stageCompletionDates: updatedDates,
        updatedAt: new Date(),
        lastUpdateAt: new Date(),
        lastUpdateBy: user.id,
      })
      .where(whereClause)
      .returning({
        currentStageIndex: workspaces.currentStageIndex,
        updatedAt: workspaces.updatedAt,
        slug: workspaces.slug,
        stageCompletionDates: workspaces.stageCompletionDates,
      });

    if (!updated) {
      const [current] = await db
        .select({
          ownerId: workspaces.ownerId,
          currentStageIndex: workspaces.currentStageIndex,
          updatedAt: workspaces.updatedAt,
        })
        .from(workspaces)
        .where(eq(workspaces.id, projectId))
        .limit(1);

      if (!current) {
        return {
          success: false,
          error: "Workspace not found",
          errorCode: "NOT_FOUND",
        };
      }
      if (current.ownerId !== user.id) {
        return {
          success: false,
          error: "Only the workspace owner can advance the stage",
          errorCode: "FORBIDDEN",
        };
      }
      if (expectedUpdatedAtDate) {
        return {
          success: false,
          error: "Stages changed. Refresh and retry.",
          errorCode: "PROJECT_CONFLICT",
          latest: {
            currentStageIndex: Math.max(0, current.currentStageIndex ?? 0),
            updatedAt: current.updatedAt?.toISOString?.() ?? null,
          },
        };
      }
      return {
        success: false,
        error: "Couldn’t update workspace stage",
        errorCode: "INTERNAL_ERROR",
      };
    }

    const slugOrId = updated.slug || projectId;
    revalidatePath(`/workspaces/${slugOrId}`);
    revalidatePath(`/workspaces/${projectId}`);

    return {
      success: true,
      currentStageIndex: Math.max(
        0,
        updated.currentStageIndex ?? normalizedIndex,
      ),
      updatedAt: updated.updatedAt?.toISOString?.() ?? null,
      stageCompletionDates: updated.stageCompletionDates as
        | Record<string, string>
        | undefined,
    };
  } catch (error) {
    console.error("[updateWorkspaceStageAction] Failed:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Couldn’t update workspace stage",
      errorCode: "INTERNAL_ERROR",
    };
  }
}


/**
 * Smart Lifecycle Update Action
 * Handles stage renames, reorders, additions, and deletions.
 * Uses "Smart Rebalance" logic to keep currentStageIndex pointing at the correct stage.
 */
export async function updateWorkspaceLifecycleAction(
  projectId: string,
  newStages: string[],
  currentActiveStageName: string,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to continue");

    // Validate and sanitize stages
    const sanitizedStages = validateAndSanitizeLifecycleStages(newStages);

    // Get current index for Smart Rebalance calculation
    const [project] = await db
      .select({
        currentStageIndex: workspaces.currentStageIndex,
        lifecycleStages: workspaces.lifecycleStages,
        stageCompletionDates: workspaces.stageCompletionDates,
        slug: workspaces.slug,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .where(and(eq(workspaces.id, projectId), eq(workspaces.ownerId, user.id)))
      .limit(1);

    if (!project) {
      throw new Error("Workspace not found or access denied");
    }

    // SMART REBALANCE: Find the new index for the current stage
    let newIndex = sanitizedStages.findIndex(
      (s) => s === currentActiveStageName,
    );
    if (newIndex === -1) {
      // Stage was deleted - fallback to previous index or 0
      newIndex = Math.max(0, (project.currentStageIndex || 0) - 1);
      // Clamp to max
      newIndex = Math.min(newIndex, sanitizedStages.length - 1);
    }

    // Completion dates are indexed because lifecycle stages predate stable
    // stage IDs. Preserve dates by stage name when a lifecycle is renamed or
    // reordered, and discard dates for stages that no longer exist.
    const previousStages = Array.isArray(project.lifecycleStages)
      ? project.lifecycleStages
      : [];
    const previousDates = normalizeJourneyCompletionDates(
      project.stageCompletionDates,
      Math.max(0, project.currentStageIndex ?? 0),
    );
    const completionDatesByStage = new Map<string, string>();
    previousStages.forEach((stage, index) => {
      const completedAt = previousDates[String(index)];
      if (index < Math.max(0, project.currentStageIndex ?? 0) && completedAt) {
        completionDatesByStage.set(stage, completedAt);
      }
    });
    const remappedCompletionDates = Object.fromEntries(
      sanitizedStages.slice(0, newIndex).flatMap((stage, index) => {
        const completedAt = completionDatesByStage.get(stage);
        return completedAt ? [[String(index), completedAt]] : [];
      }),
    );

    const [updated] = await db
      .update(workspaces)
      .set({
        lifecycleStages: sanitizedStages,
        currentStageIndex: newIndex,
        stageCompletionDates: remappedCompletionDates,
        updatedAt: new Date(),
        lastUpdateAt: new Date(),
        lastUpdateBy: user.id,
      })
      .where(and(
        eq(workspaces.id, projectId),
        eq(workspaces.ownerId, user.id),
        eq(workspaces.updatedAt, project.updatedAt),
      ))
      .returning({ id: workspaces.id });

    if (!updated) {
      throw new Error("Stages changed. Refresh and retry.");
    }

    const slugOrId = project.slug || projectId;
    revalidatePath(`/workspaces/${slugOrId}`);
    revalidatePath(`/workspaces/${projectId}`);

    return { success: true, newStageIndex: newIndex };
  } catch (error) {
    console.error("Failed to update project lifecycle:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Couldn’t update workspace lifecycle",
    };
  }
}


/**
 * Projects with open roles that the target leads, as seen by the session
 * viewer: only when the viewer may see the target's profile, only publicly
 * readable non-draft projects, and never projects the viewer already belongs
 * to (COR-044).
 */
export async function getProfileWorkspacesWithOpenRolesAction(
  targetProfileId: string,
  input: { search?: string; cursor?: string; limit?: number } = {},
) {
  try {
    if (!targetProfileId || !isLooseUuid(targetProfileId)) return { items: [], nextCursor: null, capReached: false };
    const { userId: excludeMemberUserId } = await getViewerAuthContext();
    if (excludeMemberUserId !== targetProfileId) {
      const relationship = await resolvePrivacyRelationship(excludeMemberUserId, targetProfileId);
      if (!relationship?.canViewProfile) return { items: [], nextCursor: null, capReached: false };
    }
    const requestedLimit = Number(input.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 50)) : 20;
    const search = normalizeSearchQuery(input.search, 100);
    const searchPattern = search ? containsLikePattern(search) : null;
    const separator = input.cursor?.indexOf("|") ?? -1;
    const cursorDate = separator > 0 ? new Date(input.cursor!.slice(0, separator)) : null;
    const cursorId = separator > 0 ? input.cursor!.slice(separator + 1) : null;
    const cursor = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId && isLooseUuid(cursorId)
      ? { updatedAt: cursorDate, id: cursorId }
      : null;
    const selectionFilters = [
      gt(workspaces.openRolesCount, 0),
      isNull(workspaces.deletedAt),
      // Same rule as computeWorkspaceReadAccess for a non-member viewer.
      inArray(workspaces.visibility, ["public", "unlisted"]),
      sql`${workspaces.status} IS NOT NULL AND ${workspaces.status} <> 'draft'`,
      // A closed project takes no applications.
      sql`${workspaces.status} NOT IN ('archived', 'completed')`,
      excludeMemberUserId ? sql`${workspaces.ownerId} <> ${excludeMemberUserId}::uuid` : undefined,
      // Not offered where the viewer can't apply right now: already pending, or declined within the 24 h cooldown
      // (withdrawn, ended-membership and filled-role applications can apply again).
      // An invitation to the same project is the answer to wait for (applying is refused alongside it).
      excludeMemberUserId ? sql`NOT EXISTS (
        SELECT 1 FROM workspace_invitations AS open_invitation
        WHERE open_invitation.workspace_id = ${workspaces.id}
          AND open_invitation.candidate_id = ${excludeMemberUserId}::uuid
          AND open_invitation.status = 'pending' AND open_invitation.expires_at > now()
      )` : undefined,
      excludeMemberUserId ? sql`NOT EXISTS (
        SELECT 1
        FROM role_applications AS blocking_application
        WHERE blocking_application.workspace_id = ${workspaces.id}
          AND blocking_application.applicant_id = ${excludeMemberUserId}::uuid
          AND (
            blocking_application.status = 'pending'
            OR (
              blocking_application.status = 'rejected'
              AND blocking_application.decision_by IS DISTINCT FROM blocking_application.applicant_id
              AND coalesce(blocking_application.decision_reason_code, '') <> 'role_filled'
              AND blocking_application.updated_at > now() - interval '24 hours'
            )
          )
      )` : undefined,
      excludeMemberUserId ? sql`NOT EXISTS (
        SELECT 1
        FROM workspace_members AS excluded_member
        WHERE excluded_member.workspace_id = ${workspaces.id}
          AND excluded_member.user_id = ${excludeMemberUserId}::uuid
      )` : undefined,
      searchPattern ? ilike(workspaces.title, searchPattern) : undefined,
      cursor ? sql`(${workspaces.updatedAt}, ${workspaces.id}) < (${cursor.updatedAt}, ${cursor.id}::uuid)` : undefined,
    ];

    const owned = await db
      .select({
        id: workspaces.id,
        title: workspaces.title,
        slug: workspaces.slug,
        ownerId: workspaces.ownerId,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.ownerId, targetProfileId),
          ...selectionFilters,
        ),
      )
      .orderBy(desc(workspaces.updatedAt), desc(workspaces.id))
      .limit(limit + 1);

    const member = await db
      .select({
        id: workspaces.id,
        title: workspaces.title,
        slug: workspaces.slug,
        ownerId: workspaces.ownerId,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
      .where(
        and(
          eq(workspaceMembers.userId, targetProfileId),
          inArray(workspaceMembers.role, ["owner", "admin"]),
          ...selectionFilters,
        ),
      )
      .orderBy(desc(workspaces.updatedAt), desc(workspaces.id))
      .limit(limit + 1);

    const projectsMerged = Array.from(
      new Map([...owned, ...member].map((project) => [project.id, project])).values(),
    ).sort((left, right) =>
      right.updatedAt.getTime() - left.updatedAt.getTime() || right.id.localeCompare(left.id),
    );
    const pageProjects = projectsMerged.slice(0, limit);
    const projectIds = Array.from(
      new Set(pageProjects.map((project) => project.id)),
    );
    if (projectIds.length === 0) return { items: [], nextCursor: null, capReached: false };
    const eligibleProjectIds = projectIds;

    // 3. Batch fetch open roles only for projects we identified as having vacancies
    const openRolesList = Array.from(await db.execute<{
      id: string;
      projectId: string;
      role: string;
      title: string | null;
      count: number;
      filled: number;
      description: string | null;
      skills: string[] | null;
    }>(sql`
      SELECT id, workspace_id AS "projectId", role, title, count, filled, description, skills
      FROM (
        SELECT open_role.*,
               row_number() OVER (PARTITION BY open_role.workspace_id ORDER BY open_role.title, open_role.id) AS role_rank
        FROM workspace_open_roles AS open_role
        WHERE open_role.workspace_id IN (${sql.join(eligibleProjectIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND open_role.filled < open_role.count
      ) AS bounded_roles
      WHERE role_rank <= 20
      ORDER BY workspace_id, title, id
    `));

    const listMap = new Map<
      string,
      { id: string; title: string; slug: string | null; openRoles: any[] }
    >();

    for (const p of pageProjects) {
      if (!eligibleProjectIds.includes(p.id)) continue;
      if (!listMap.has(p.id)) {
        listMap.set(p.id, {
          id: p.id,
          title: p.title || "Untitled workspace",
          slug: p.slug,
          openRoles: [],
        });
      }
    }

    for (const role of openRolesList) {
      const p = listMap.get(role.projectId);
      if (p) {
        p.openRoles.push(role);
      }
    }

    const items = Array.from(listMap.values()).filter((p) => p.openRoles.length > 0);
    const last = pageProjects.at(-1);
    // The 20-pending cap, said up front instead of failing when the form is submitted.
    const [pending] = excludeMemberUserId
      ? await db.select({ count: sql<number>`count(*)::int` }).from(roleApplications).where(and(eq(roleApplications.applicantId, excludeMemberUserId), eq(roleApplications.status, "pending")))
      : [];
    return {
      items,
      nextCursor: projectsMerged.length > limit && last
        ? `${last.updatedAt.toISOString()}|${last.id}`
        : null,
      capReached: (pending?.count ?? 0) >= 20,
    };
  } catch (error) {
    console.error("Failed to get profile projects with open roles", error);
    return { items: [], nextCursor: null, capReached: false };
  }
}
