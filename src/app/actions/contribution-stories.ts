"use server";

/**
 * Contribution Stories Server Actions
 *
 * Transactional server actions managing the lifecycle of project contribution stories:
 * - Versioned, audited draft updates and publication to `profile_project_contributions`.
 * - Idempotent mutation handling via unique `(user_id, requestId)` audit events.
 * - Normalized stage records synchronization in `profile_project_contribution_stages`.
 * - Relational skills synchronization via `syncContributionSkillsBatch`.
 * - Media upload intent creation and finalization with strict permission verification.
 * - Cache invalidation via `markProfileCollaborationSummaryStale` (SUMMARY_VERSION 8).
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  profileProjectContributions,
  profileContributionDrafts,
  profileContributionMediaAssets,
  profileProjectContributionStages,
  profileAuditEvents,
  projects,
  projectMembers,
  storageAssets,
} from "@/lib/db/schema";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import {
  contributionStorySchema,
  blankContributionStory,
  storyValidation,
  reconcileStoryCurrentStatus,
  sortedStoryPositions,
  type ContributionStory,
  type StoryReferenceKind,
} from "@/lib/profile/contribution-story";
import { contributionReferenceOptions } from "@/lib/profile/contribution-story-server";
import { syncContributionSkillsBatch } from "@/lib/skills/service";
import {
  createUploadIntent,
  finalizeUploadIntent,
} from "@/lib/upload/upload-intents";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";

const commandSchema = z
  .object({
    id: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    requestId: z.string().uuid(),
    operation: z.enum([
      "draft",
      "publish",
      "hide",
      "feature",
      "delete",
      "restore",
      "undo-merge",
      "link",
    ]),
    document: contributionStorySchema,
    targetProjectId: z.string().uuid().optional(),
    mergeTargetId: z.string().uuid().optional(),
    mergeRestore: z
      .object({
        targetId: z.string().uuid(),
        targetVersion: z.number().int().positive(),
        document: contributionStorySchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type StoryCommand = z.infer<typeof commandSchema>;
export type StoryCommandResult =
  | {
      success: true;
      id: string;
      version: number;
      document: ContributionStory;
      featured: boolean;
      published: boolean;
      removed: boolean;
      mergedFrom?: {
        id: string;
        version: number;
        targetId: string;
        targetVersion: number;
      };
    }
  | {
      success: false;
      error: string;
      code: string;
      latestVersion?: number;
      duplicateId?: string;
    };
class StoryError extends Error {
  constructor(
    message: string,
    readonly code = "VALIDATION_ERROR",
    readonly latestVersion?: number,
    readonly duplicateId?: string,
  ) {
    super(message);
  }
}
async function ownerId() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user)
    throw new StoryError("Sign in to edit your contributions.", "UNAUTHORIZED");
  return user.id;
}

export async function createContributionStoryAction() {
  try {
    const userId = await ownerId();
    const rate = await consumeRateLimit(
      `contribution-create:${userId}`,
      20,
      60,
    );
    if (!rate.allowed)
      throw new StoryError(
        "Wait before adding another workspace.",
        "RATE_LIMITED",
      );
    const [row] = await db
      .insert(profileProjectContributions)
      .values({
        profileId: userId,
        externalKey: `manual:${randomUUID()}`,
        projectTitle: "Untitled external project",
        source: "manual",
        visibility: "private",
      })
      .returning({ id: profileProjectContributions.id });
    await markProfileCollaborationSummaryStale([userId]);
    revalidatePath("/my-profile");
    revalidatePath("/u/[username]", "page");
    return { success: true as const, id: row!.id };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof StoryError
          ? error.message
          : "Couldn’t create a contribution.",
    };
  }
}

export async function saveContributionStoryAction(
  raw: StoryCommand,
): Promise<StoryCommandResult> {
  try {
    const userId = await ownerId();
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success)
      throw new StoryError(
        parsed.error.issues[0]?.message ?? "Invalid contribution.",
      );
    const input = parsed.data;
    const rate = await consumeRateLimit(
      `contribution-story:${userId}`,
      120,
      60,
    );
    if (!rate.allowed)
      throw new StoryError(
        "Too many edits. Your draft is kept; try again shortly.",
        "RATE_LIMITED",
      );
    const result = await db.transaction(async (tx) => {
      // Serializes link/merge and draft commands for this owner; public writes use the same optimistic version.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId},237))`,
      );
      const [current] = await tx
        .select()
        .from(profileProjectContributions)
        .where(
          and(
            eq(profileProjectContributions.id, input.id),
            eq(profileProjectContributions.profileId, userId),
          ),
        )
        .for("update");
      if (!current)
        throw new StoryError("Contribution is unavailable.", "NOT_FOUND");
      const [prior] = await tx
        .select({
          id: profileAuditEvents.id,
          metadata: profileAuditEvents.metadata,
        })
        .from(profileAuditEvents)
        .where(
          and(
            eq(profileAuditEvents.userId, userId),
            eq(profileAuditEvents.eventType, "contribution_story_saved"),
            sql`${profileAuditEvents.metadata}->>'requestId'=${input.requestId}`,
            sql`${profileAuditEvents.metadata}->>'contributionId'=${input.id}`,
          ),
        )
        .limit(1);
      const [draftRow] = await tx
        .select()
        .from(profileContributionDrafts)
        .where(eq(profileContributionDrafts.contributionId, current.id));
      if (prior) {
        const targetId =
          typeof prior.metadata?.targetId === "string"
            ? prior.metadata.targetId
            : null;
        const [target] = targetId
          ? await tx
              .select()
              .from(profileProjectContributions)
              .where(
                and(
                  eq(profileProjectContributions.id, targetId),
                  eq(profileProjectContributions.profileId, userId),
                ),
              )
              .limit(1)
          : [];
        const [targetDraft] = target
          ? await tx
              .select()
              .from(profileContributionDrafts)
              .where(eq(profileContributionDrafts.contributionId, target.id))
              .limit(1)
          : [];
        return {
          success: true as const,
          id: target?.id ?? current.id,
          version: target?.version ?? current.version,
          document:
            targetDraft?.document ?? draftRow?.document ?? input.document,
          featured: target?.featured ?? current.featured,
          published: false,
          removed: target ? false : Boolean(current.deletedAt),
          ...(target
            ? {
                mergedFrom: {
                  id: current.id,
                  version: Number(
                    prior.metadata?.sourceVersion ?? current.version,
                  ),
                  targetId: target.id,
                  targetVersion: Number(
                    prior.metadata?.targetVersion ?? target.version,
                  ),
                },
              }
            : {}),
        };
      }
      if (
        current.deletedAt &&
        !["restore", "undo-merge"].includes(input.operation)
      )
        throw new StoryError("Contribution is unavailable.", "NOT_FOUND");
      if (current.version !== input.expectedVersion)
        throw new StoryError(
          "This contribution changed in another session. Your draft is kept. Review the latest version before retrying.",
          "CONFLICT",
          current.version,
        );
      let document = reconcileStoryCurrentStatus(input.document);
      const now = new Date();
      // Privacy and pin/delete actions must not depend on unfinished narrative or expired media.
      if (["hide", "feature", "delete"].includes(input.operation)) {
        if (input.operation === "delete" && current.projectId)
          throw new StoryError(
            "Hide a linked contribution instead of removing its membership history.",
          );
        const stored =
          draftRow?.document ?? current.presentation ?? input.document;
        const metadataDocument =
          input.operation === "hide" ? { ...stored, visible: false } : stored;
        await tx
          .update(profileProjectContributions)
          .set({
            version: current.version + 1,
            updatedAt: now,
            ...(input.operation === "hide"
              ? { visibility: "private" as const }
              : {}),
            ...(input.operation === "feature"
              ? { featured: !current.featured }
              : {}),
            ...(input.operation === "delete" ? { deletedAt: now } : {}),
          })
          .where(eq(profileProjectContributions.id, current.id));
        if (input.operation === "delete") {
          await tx
            .update(profileProjectContributionStages)
            .set({ deletedAt: now, updatedAt: now })
            .where(
              and(
                eq(profileProjectContributionStages.contributionId, current.id),
                isNull(profileProjectContributionStages.deletedAt),
              ),
            );
        }
        if (draftRow && input.operation === "hide")
          await tx
            .update(profileContributionDrafts)
            .set({ document: metadataDocument, updatedAt: now })
            .where(eq(profileContributionDrafts.contributionId, current.id));
        await tx.insert(profileAuditEvents).values({
          userId,
          eventType: "contribution_story_saved",
          metadata: {
            requestId: input.requestId,
            contributionId: current.id,
            operation: input.operation,
            version: current.version + 1,
          },
        });
        await markProfileCollaborationSummaryStale([userId], tx);
        return {
          success: true as const,
          id: current.id,
          version: current.version + 1,
          document: metadataDocument,
          featured:
            input.operation === "feature"
              ? !current.featured
              : current.featured,
          published: false,
          removed: input.operation === "delete",
        };
      }
      const publishing = input.operation === "publish";
      const errors = publishing
        ? storyValidation(document, {
            publish: true,
            platform: Boolean(current.projectId),
          })
        : [];
      if (errors.length) throw new StoryError(errors[0]!.message);
      const stages = await tx
        .select({ id: profileProjectContributionStages.id })
        .from(profileProjectContributionStages)
        .where(
          and(
            eq(profileProjectContributionStages.contributionId, current.id),
            isNull(profileProjectContributionStages.deletedAt),
          ),
        );
      const allowedStages = new Set([
        ...stages.map((s) => s.id),
        `${current.id}:current`,
      ]);
      if (
        document.positions.some(
          (p) => p.recordedStageId && !allowedStages.has(p.recordedStageId),
        )
      )
        throw new StoryError(
          "Recorded position history changed. Refresh it before saving.",
        );
      const [project] = current.projectId
        ? await tx
            .select()
            .from(projects)
            .where(
              and(
                eq(projects.id, current.projectId),
                isNull(projects.deletedAt),
              ),
            )
            .limit(1)
        : [];
      if (current.projectId && project)
        document = { ...document, title: project.title };
      if (
        publishing &&
        current.projectId &&
        (!project ||
          project.visibility === "private" ||
          project.status === "draft")
      )
        throw new StoryError(
          "This workspace cannot be shown publicly. Your private draft is kept.",
          "PROJECT_RESTRICTED",
        );
      if (
        publishing &&
        project?.visibility === "unlisted" &&
        document.visible &&
        !document.allowUnlisted
      )
        throw new StoryError(
          "Confirm that you want this unlisted workspace listed on your profile.",
        );
      if (input.operation === "undo-merge") {
        if (current.projectId || !current.deletedAt || !input.mergeRestore)
          throw new StoryError("This merge can no longer be undone.");
        const restore = input.mergeRestore;
        const [target] = await tx
          .select()
          .from(profileProjectContributions)
          .where(
            and(
              eq(profileProjectContributions.id, restore.targetId),
              eq(profileProjectContributions.profileId, userId),
              isNull(profileProjectContributions.deletedAt),
            ),
          )
          .for("update");
        if (!target || target.version !== restore.targetVersion)
          throw new StoryError(
            "The merged contribution changed. Your newer work is kept.",
            "CONFLICT",
          );
        if (restore.document.images.length) {
          const restoredAssets = await tx
            .select()
            .from(storageAssets)
            .where(
              inArray(
                storageAssets.id,
                restore.document.images.map((image) => image.assetId),
              ),
            )
            .for("update");
          if (
            restore.document.images.some(
              (image) =>
                !restoredAssets.some(
                  (asset) =>
                    asset.id === image.assetId &&
                    asset.ownerUserId === userId &&
                    asset.bucket === "contribution-images" &&
                    ["verified", "delete_pending"].includes(asset.state),
                ),
            )
          )
            throw new StoryError(
              "An image from the previous draft is no longer available.",
            );
        }
        await tx
          .insert(profileContributionDrafts)
          .values({
            contributionId: target.id,
            profileId: userId,
            document: restore.document,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: profileContributionDrafts.contributionId,
            set: { document: restore.document, updatedAt: now },
          });
        await tx
          .update(profileProjectContributions)
          .set({ version: target.version + 1, updatedAt: now })
          .where(eq(profileProjectContributions.id, target.id));
        await tx
          .delete(profileContributionMediaAssets)
          .where(eq(profileContributionMediaAssets.contributionId, target.id));
        const retain = Array.from(
          new Set(
            [
              ...restore.document.images,
              ...(target.presentation?.images ?? []),
            ].map((image) => image.assetId),
          ),
        );
        if (retain.length)
          await tx
            .insert(profileContributionMediaAssets)
            .values(
              retain.map((assetId) => ({ contributionId: target.id, assetId })),
            )
            .onConflictDoNothing();
      }
      if (input.operation === "link") {
        if (current.projectId || !input.targetProjectId)
          throw new StoryError(
            "Choose an external contribution and a workspace.",
          );
        const [target] = await tx
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.id, input.targetProjectId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1);
        const [member] = target
          ? await tx
              .select({ id: projectMembers.id })
              .from(projectMembers)
              .where(
                and(
                  eq(projectMembers.projectId, target.id),
                  eq(projectMembers.userId, userId),
                ),
              )
              .limit(1)
          : [];
        if (!target || (target.ownerId !== userId && !member))
          throw new StoryError(
            "Choose a workspace you contribute to.",
            "FORBIDDEN",
          );
        const [duplicate] = await tx
          .select()
          .from(profileProjectContributions)
          .where(
            and(
              eq(profileProjectContributions.profileId, userId),
              eq(profileProjectContributions.projectId, target.id),
              isNull(profileProjectContributions.deletedAt),
            ),
          )
          .for("update");
        if (duplicate) {
          if (input.mergeTargetId !== duplicate.id)
            throw new StoryError(
              "This workspace already has a contribution. Review the existing story before merging.",
              "DUPLICATE",
              undefined,
              duplicate.id,
            );
          const [targetDraft] = await tx
            .select()
            .from(profileContributionDrafts)
            .where(eq(profileContributionDrafts.contributionId, duplicate.id));
          const existingBase = targetDraft?.document ?? duplicate.presentation;
          const legacyBase = {
            ...blankContributionStory(target.title),
            summary: duplicate.summary ?? "",
            start: duplicate.startedAt?.toISOString().slice(0, 7) ?? "",
            end: duplicate.endedAt?.toISOString().slice(0, 7) ?? "",
            current: !duplicate.endedAt,
            visible: duplicate.visibility === "public",
            skills: duplicate.skills,
          };
          const base = existingBase ?? legacyBase;
          const positionIds = new Set(base.positions.map((p) => p.id)),
            imageIds = new Set(base.images.map((i) => i.id));
          const merged = contributionStorySchema.parse({
            ...base,
            summary: [base.summary, document.summary]
              .filter(Boolean)
              .join("\n\nAdditional contribution notes\n\n"),
            positions: [
              ...base.positions,
              ...document.positions.filter((p) => !positionIds.has(p.id)),
            ],
            images: [
              ...base.images,
              ...document.images.filter((i) => !imageIds.has(i.id)),
            ],
            skills: Array.from(new Set([...base.skills, ...document.skills])),
            links: [
              ...base.links,
              ...document.links.filter(
                (l) => !base.links.some((b) => b.url === l.url),
              ),
            ],
          });
          await tx
            .insert(profileContributionDrafts)
            .values({
              contributionId: duplicate.id,
              profileId: userId,
              document: merged,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: profileContributionDrafts.contributionId,
              set: { document: merged, updatedAt: now },
            });
          await tx
            .update(profileProjectContributions)
            .set({ version: duplicate.version + 1, updatedAt: now })
            .where(eq(profileProjectContributions.id, duplicate.id));
          await tx
            .update(profileProjectContributions)
            .set({
              deletedAt: now,
              version: current.version + 1,
              updatedAt: now,
            })
            .where(eq(profileProjectContributions.id, current.id));
          // Move media references before the source is removed; publication remains unchanged.
          for (const image of merged.images)
            await tx
              .insert(profileContributionMediaAssets)
              .values({ contributionId: duplicate.id, assetId: image.assetId })
              .onConflictDoNothing();
          await tx.insert(profileAuditEvents).values({
            userId,
            eventType: "contribution_story_saved",
            metadata: {
              requestId: input.requestId,
              contributionId: current.id,
              operation: "link",
              targetId: duplicate.id,
              targetVersion: duplicate.version + 1,
              sourceVersion: current.version + 1,
            },
          });
          await markProfileCollaborationSummaryStale([userId], tx);
          return {
            success: true as const,
            id: duplicate.id,
            version: duplicate.version + 1,
            mergedFrom: {
              id: current.id,
              version: current.version + 1,
              targetId: duplicate.id,
              targetVersion: duplicate.version + 1,
            },
            document: merged,
            featured: duplicate.featured,
            published: false,
            removed: false,
          };
        }
        document = {
          ...document,
          title: target.title,
          visible: false,
          allowUnlisted: false,
        };
        await tx
          .update(profileProjectContributions)
          .set({
            projectId: target.id,
            externalKey: null,
            projectTitle: null,
            visibility: "private",
            presentation: null,
          })
          .where(eq(profileProjectContributions.id, current.id));
      }
      const assetIds = Array.from(
        new Set(
          [...document.images, ...(current.presentation?.images ?? [])].map(
            (i) => i.assetId,
          ),
        ),
      );
      if (assetIds.length) {
        const assets = await tx
          .select()
          .from(storageAssets)
          .where(inArray(storageAssets.id, assetIds))
          .for("update");
        if (
          document.images.some(
            (i) =>
              !assets.some(
                (a) =>
                  a.id === i.assetId &&
                  a.ownerUserId === userId &&
                  a.bucket === "contribution-images" &&
                  a.purpose === "contribution_image:file" &&
                  (a.state === "verified" ||
                    (a.state === "delete_pending" &&
                      a.deleteAfter &&
                      a.deleteAfter > now)),
              ),
          )
        )
          throw new StoryError(
            "One or more images are unavailable. Re-upload those images.",
          );
      }
      if (document.images.length)
        await tx
          .update(storageAssets)
          .set({ state: "verified", deleteAfter: null, updatedAt: now })
          .where(
            and(
              inArray(
                storageAssets.id,
                document.images.map((image) => image.assetId),
              ),
              eq(storageAssets.ownerUserId, userId),
              eq(storageAssets.state, "delete_pending"),
            ),
          );
      if (publishing) {
        for (const image of document.images.filter((i) => i.projectFileId)) {
          const options = await contributionReferenceOptions(
            current.projectId,
            "file",
            "",
            [image.projectFileId!],
          );
          if (!options.length)
            throw new StoryError(
              "A workspace image is no longer public. Remove or replace it before publishing.",
            );
        }
      }
      await tx
        .insert(profileContributionDrafts)
        .values({
          contributionId: current.id,
          profileId: userId,
          document,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: profileContributionDrafts.contributionId,
          set: { document, updatedAt: now },
        });
      const sortedPositions = sortedStoryPositions(document.positions);
      const headlinePos = sortedPositions[0];
      const contributionStart = document.start || headlinePos?.start;
      const startedAt = contributionStart
        ? new Date(`${contributionStart}-01T00:00:00.000Z`)
        : null;
      const isCurrent =
        document.current || document.positions.some((p) => p.current);
      const contributionEnd = isCurrent
        ? null
        : document.end || headlinePos?.end;
      const endedAt = contributionEnd
        ? new Date(`${contributionEnd}-01T00:00:00.000Z`)
        : null;
      const roleTitle = headlinePos?.title ?? current.roleTitle;

      const patch = {
        version: current.version + 1,
        updatedAt: now,
        startedAt,
        endedAt,
        ...(roleTitle ? { roleTitle } : {}),
        ...(publishing
          ? {
              presentation: document,
              publishedAt: now,
              visibility: document.visible
                ? ("public" as const)
                : ("private" as const),
              ...(!current.projectId ? { projectTitle: document.title } : {}),
            }
          : {}),
        ...(["restore", "undo-merge"].includes(input.operation)
          ? { deletedAt: null, visibility: "private" as const }
          : {}),
      };
      await tx
        .update(profileProjectContributions)
        .set(patch)
        .where(
          and(
            eq(profileProjectContributions.id, current.id),
            eq(profileProjectContributions.version, input.expectedVersion),
          ),
        );
      const oldRefs = await tx
        .select()
        .from(profileContributionMediaAssets)
        .where(eq(profileContributionMediaAssets.contributionId, current.id));
      await tx
        .delete(profileContributionMediaAssets)
        .where(eq(profileContributionMediaAssets.contributionId, current.id));
      const retained = Array.from(
        new Set(
          [
            ...document.images,
            ...(publishing
              ? document.images
              : (current.presentation?.images ?? [])),
          ].map((i) => i.assetId),
        ),
      );
      if (retained.length)
        await tx
          .insert(profileContributionMediaAssets)
          .values(
            retained.map((assetId) => ({
              contributionId: current.id,
              assetId,
            })),
          )
          .onConflictDoNothing();
      await scheduleAssetDeletionIfUnreferenced(
        tx,
        oldRefs
          .filter((r) => !retained.includes(r.assetId))
          .map((r) => r.assetId),
        { deleteAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      );
      if (publishing)
        await syncContributionSkillsBatch(
          tx,
          [{ contributionId: current.id, labels: document.skills }],
          userId,
        );
      await tx.insert(profileAuditEvents).values({
        userId,
        eventType: "contribution_story_saved",
        metadata: {
          requestId: input.requestId,
          contributionId: current.id,
          operation: input.operation,
          version: current.version + 1,
        },
      });
      await markProfileCollaborationSummaryStale([userId], tx);
      return {
        success: true as const,
        id: current.id,
        version: current.version + 1,
        document,
        featured: current.featured,
        published: publishing,
        removed: false,
      };
    });
    revalidatePath("/my-profile");
    revalidatePath("/u/[username]", "page");
    return result;
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof StoryError
          ? error.message
          : "Couldn’t save this contribution. Your draft is kept.",
      code: error instanceof StoryError ? error.code : "SAVE_FAILED",
      ...(error instanceof StoryError
        ? { latestVersion: error.latestVersion, duplicateId: error.duplicateId }
        : {}),
    };
  }
}

export async function searchContributionReferencesAction(
  contributionId: string,
  kind: StoryReferenceKind,
  query: string,
) {
  const userId = await ownerId();
  if (
    !z.string().uuid().safeParse(contributionId).success ||
    !["person", "task", "file", "sprint"].includes(kind)
  )
    return [];
  const [row] = await db
    .select({ projectId: profileProjectContributions.projectId })
    .from(profileProjectContributions)
    .where(
      and(
        eq(profileProjectContributions.id, contributionId),
        eq(profileProjectContributions.profileId, userId),
        isNull(profileProjectContributions.deletedAt),
      ),
    )
    .limit(1);
  return row ? contributionReferenceOptions(row.projectId, kind, query) : [];
}

export async function createContributionImageUploadAction(
  contributionId: string,
  mimeType: string,
  size: number,
) {
  const userId = await ownerId();
  if (!z.string().uuid().safeParse(contributionId).success)
    throw new StoryError("Invalid contribution.");
  const [row] = await db
    .select({ id: profileProjectContributions.id })
    .from(profileProjectContributions)
    .where(
      and(
        eq(profileProjectContributions.id, contributionId),
        eq(profileProjectContributions.profileId, userId),
        isNull(profileProjectContributions.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new StoryError("Contribution unavailable.");
  const rate = await consumeRateLimit(`contribution-image:${userId}`, 30, 3600);
  if (!rate.allowed)
    throw new StoryError("Upload limit reached. Try again later.");
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(mimeType) ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > 10485760
  )
    throw new StoryError("Use a PNG, JPG, or WebP image up to 10 MB.");
  const storageKey = `${userId}/${contributionId}/${randomUUID()}`;
  const intent = await createUploadIntent({
    userId,
    bucket: "contribution-images",
    storageKey,
    scope: "contribution_image",
    kind: "file",
    expectedMimeType: mimeType,
    expectedSize: size,
    metadata: { contributionId },
  });
  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from("contribution-images")
    .createSignedUploadUrl(storageKey, { upsert: false });
  if (error || !data) throw new StoryError("Couldn’t prepare image upload.");
  return { uploadIntentId: intent.id, uploadUrl: data.signedUrl };
}
export async function finalizeContributionImageAction(
  contributionId: string,
  intentId: string,
) {
  const userId = await ownerId();
  const intent = await finalizeUploadIntent({
    intentId,
    userId,
    bucket: "contribution-images",
    expectedScope: "contribution_image",
    expectedKind: "file",
  });
  if (intent.metadata?.contributionId !== contributionId)
    throw new StoryError("Image belongs to a different contribution.");
  const bytes = await readBoundedStorageBytes({
    bucket: intent.bucket,
    storageKey: intent.storageKey,
    maxBytes: 10485760,
    timeoutMs: 10000,
  });
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(Buffer.from(bytes), {
    limitInputPixels: 40_000_000,
    animated: false,
  }).metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    !["png", "jpeg", "webp"].includes(metadata.format ?? "")
  )
    throw new StoryError("This image could not be decoded.");
  return {
    assetId: intent.assetId!,
    url: `/api/v1/contribution-images/${intent.assetId}`,
  };
}

export async function importContributionProjectImageAction(
  contributionId: string,
  nodeId: string,
) {
  const userId = await ownerId();
  if (
    !z.string().uuid().safeParse(nodeId).success ||
    !z.string().uuid().safeParse(contributionId).success
  )
    throw new StoryError("Invalid workspace image.");
  const [row] = await db
    .select({ projectId: profileProjectContributions.projectId })
    .from(profileProjectContributions)
    .where(
      and(
        eq(profileProjectContributions.id, contributionId),
        eq(profileProjectContributions.profileId, userId),
        isNull(profileProjectContributions.deletedAt),
      ),
    )
    .limit(1);
  const available = row
    ? await contributionReferenceOptions(row.projectId, "file", "", [nodeId])
    : [];
  if (
    !available.some((f) =>
      ["image/png", "image/jpeg", "image/webp"].includes(f.mimeType ?? ""),
    )
  )
    throw new StoryError("Choose a public PNG, JPG, or WebP workspace image.");
  const files = await db.execute<{
    bucket: string;
    storage_key: string;
    verified_mime_type: string;
    verified_size: number;
  }>(
    sql`SELECT a.bucket,a.storage_key,a.verified_mime_type,a.verified_size FROM project_nodes n JOIN storage_assets a ON a.id=n.asset_id WHERE n.id=${nodeId}::uuid AND n.project_id=${row!.projectId}::uuid AND n.deleted_at IS NULL AND a.state='verified' LIMIT 1`,
  );
  const file = files[0];
  if (!file) throw new StoryError("This workspace image is unavailable.");
  const bytes = await readBoundedStorageBytes({
    bucket: file.bucket,
    storageKey: file.storage_key,
    maxBytes: 10485760,
    timeoutMs: 10000,
  });
  const prepared = await createContributionImageUploadAction(
    contributionId,
    file.verified_mime_type,
    bytes.byteLength,
  );
  const uploaded = await fetch(prepared.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.verified_mime_type },
    body: new Uint8Array(bytes),
  });
  if (!uploaded.ok) throw new StoryError("Couldn’t copy the workspace image.");
  return finalizeContributionImageAction(
    contributionId,
    prepared.uploadIntentId,
  );
}

export async function listContributionLinkProjectsAction(query: string) {
  const userId = await ownerId();
  const pattern = "%" + query.slice(0, 100).replace(/[\\%_]/g, "\\$&") + "%";
  const rows = await db.execute<{ id: string; title: string }>(
    sql`SELECT p.id,p.title FROM projects p WHERE p.deleted_at IS NULL AND (p.owner_id=${userId}::uuid OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=${userId}::uuid)) AND p.title ILIKE ${pattern} ORDER BY p.title,p.id LIMIT 50`,
  );
  return Array.from(rows);
}
