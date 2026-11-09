import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, gt, inArray, isNull, max } from "drizzle-orm";
import {getRequestId,
  jsonError,
  jsonSuccess,
  requireAuthenticatedUser,
  requireTokenScope,
  idempotentWrite
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { validateCsrf } from "@/lib/security/csrf";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import {
  assertWorkspaceUploadAccess,
  assertWorkspaceUploadAccessTx,
  recordNodeEventsBatch,
} from "@/lib/files/internal-helpers";
import {
  buildExtensionRevisionStorageKey,
  checksumSchema,
  resolveWritableExtensionFile,
} from "@/app/api/v1/extension/_file-revision";
import {
  nextFileRevisionNumber,
  normalizeRevisionComment,
} from "@/lib/files/revision-policy";
import {
  normalizeAndValidateMimeType,
  validateUploadedBlobMagicBytes,
} from "@/lib/upload/security";
import {
  replaceTaskFileRoleTag,
  type TaskFileRole,
} from "@/lib/workspaces/task-file-intelligence";
import { createAdminClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  fileVersions,
  profiles,
  storageAssets,
  taskNodeLinks,
  taskPushes,
  taskSubtasks,
  tasks,
  workspaceGitCommits,
  workspaceNodeLocks,
  workspaceNodes,
} from "@/lib/db/schema";
import { inngest } from "@/inngest/client";
import { pushTransitionTarget, transitionAfterPush } from "@/lib/domain/task-transition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAST_PUSH_BATCH_BYTES = 4 * 1024 * 1024; // 4 MiB total inline fast-path ceiling
const MAX_FAST_PUSH_FILES = 50;

const roleEnum = z.enum(["deliverable", "working", "reference"]);

const fastPushFileSchema = z.object({
  path: z.string().min(1).max(2048),
  contentHash: checksumSchema,
  size: z.number().int().nonnegative().max(MAX_FAST_PUSH_BATCH_BYTES),
  mimeType: z.string().min(1).max(180),
  contentBase64: z.string().optional(),
  comment: z.string().max(500).optional().nullable(),
});

const fastPushSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().max(120).optional().nullable(),
  role: roleEnum.optional(),
  transitionStatus: z.enum(["in_progress", "done"]).optional().nullable(),
  completeSubtaskIds: z.array(z.string().uuid()).max(100).optional(),
  completeAllSubtasks: z.boolean().optional(),
  message: z.string().max(500).optional().nullable(),
  operationId: z.string().min(8).max(200).optional().nullable(),
  files: z.array(fastPushFileSchema).min(1).max(MAX_FAST_PUSH_FILES),
});

function normalizePath(rawPath: string) {
  const trimmed = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  return trimmed ? `/${trimmed}` : "/";
}

function annotationForRole(role: TaskFileRole) {
  if (role === "deliverable") return "#deliverable";
  if (role === "reference") return "#reference";
  return "#editor_working";
}

async function handlePost(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user || !auth.extensionSessionId) {
      return (
        auth.response ??
        jsonError("An active CLI or editor session is required", 401, "UNAUTHORIZED")
      );
    }
    const user = auth.user;

    const body = await request.json().catch(() => null);
    const parsed = fastPushSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid fast-push request payload", 400, "BAD_REQUEST");
    }

    const {
      projectId,
      taskId: rawTaskId,
      role: requestedRole,
      transitionStatus,
      completeSubtaskIds,
      completeAllSubtasks,
      message,
      operationId: rawOpId,
      files,
    } = parsed.data;

    // Final files and finishing a task need their own token permissions (report A3.6).
    const scopeDenied =
      (requestedRole === "deliverable" ? requireTokenScope(auth, "file:final") : null) ??
      (transitionStatus === "done" ? requireTokenScope(auth, "task:complete") : null);
    if (scopeDenied) return scopeDenied;

    let taskId: string | null = null;
    if (rawTaskId) {
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const numMatch = rawTaskId.replace(/^(?:[a-zA-Z]+-)?#?/, "");
      if (UUID_REGEX.test(rawTaskId)) {
        taskId = rawTaskId;
      } else if (/^\d+$/.test(numMatch)) {
        const foundTask = await db.query.tasks.findFirst({
          where: and(
            eq(tasks.projectId, projectId),
            eq(tasks.taskNumber, Number(numMatch)),
            isNull(tasks.deletedAt),
          ),
          columns: { id: true },
        });
        taskId = foundTask?.id || null;
      }
    }

    const operationId =
      rawOpId || request.headers.get("idempotency-key")?.trim() || crypto.randomUUID();

    // 1. Verify workspace write & upload access in parallel with existing node lookup
    const normalizedPaths = files.map((f) => normalizePath(f.path));
    const barePaths = normalizedPaths.map((p) => p.replace(/^\/+/, ""));
    const allCandidatePaths = [...new Set([...normalizedPaths, ...barePaths])];

    const [access, existingNodes] = await Promise.all([
      getWorkspaceAccessById(projectId, user.id),
      db
        .select({
          id: workspaceNodes.id,
          path: workspaceNodes.path,
          name: workspaceNodes.name,
          currentVersion: workspaceNodes.currentVersion,
          size: workspaceNodes.size,
          contentHash: fileVersions.contentHash,
        })
        .from(workspaceNodes)
        .leftJoin(
          fileVersions,
          and(
            eq(fileVersions.nodeId, workspaceNodes.id),
            eq(fileVersions.version, workspaceNodes.currentVersion),
          ),
        )
        .where(
          and(
            eq(workspaceNodes.projectId, projectId),
            eq(workspaceNodes.type, "file"),
            isNull(workspaceNodes.deletedAt),
            inArray(workspaceNodes.path, allCandidatePaths),
          ),
        ),
    ]);

    if (!access.project) {
      return jsonError("Workspace not found", 404, "NOT_FOUND");
    }
    if (!access.canWrite) {
      return jsonError("You don’t have write access to this workspace", 403, "FORBIDDEN");
    }
    await assertWorkspaceUploadAccess(projectId, user.id);

    const existingByPath = new Map<string, (typeof existingNodes)[number]>();
    for (const node of existingNodes) {
      existingByPath.set(normalizePath(node.path), node);
    }

    // 2. Check active locks by other teammates in a single batch query
    const existingNodeIds = existingNodes.map((n) => n.id);
    if (existingNodeIds.length > 0) {
      const now = new Date();
      const activeLocks = await db
        .select({
          nodeId: workspaceNodeLocks.nodeId,
          lockedBy: workspaceNodeLocks.lockedBy,
          lockedByName: profiles.fullName,
        })
        .from(workspaceNodeLocks)
        .leftJoin(profiles, eq(profiles.id, workspaceNodeLocks.lockedBy))
        .where(
          and(
            eq(workspaceNodeLocks.projectId, projectId),
            inArray(workspaceNodeLocks.nodeId, existingNodeIds),
            gt(workspaceNodeLocks.expiresAt, now),
          ),
        );

      const foreignLock = activeLocks.find((l) => l.lockedBy !== user.id);
      if (foreignLock) {
        const lockedNode = existingNodes.find((n) => n.id === foreignLock.nodeId);
        return jsonError(
          `Cannot push: ${lockedNode?.path || "File"} is locked by ${foreignLock.lockedByName || "another teammate"}`,
          409,
          "CONFLICT",
        );
      }
    }

    // 3. Classify changed vs unchanged files and validate inline bytes in RAM
    let totalInlineBytes = 0;
    type PreparedFastFile = {
      normPath: string;
      status: "new" | "modified" | "unchanged";
      nodeId: string;
      name: string;
      currentVersion: number;
      nextVersion: number;
      contentHash: string;
      size: number;
      mimeType: string;
      buffer: Buffer | null;
      storageKey: string | null;
      comment: string | null;
    };

    const prepared: PreparedFastFile[] = [];

    for (const item of files) {
      const normPath = normalizePath(item.path);
      const existing = existingByPath.get(normPath);
      const lowerHash = item.contentHash.toLowerCase();

      if (existing && existing.contentHash?.toLowerCase() === lowerHash) {
        const curVer = existing.currentVersion ?? 1;
        prepared.push({
          normPath,
          status: "unchanged",
          nodeId: existing.id,
          name: existing.name,
          currentVersion: curVer,
          nextVersion: curVer,
          contentHash: lowerHash,
          size: existing.size ?? item.size,
          mimeType: item.mimeType,
          buffer: null,
          storageKey: null,
          comment: normalizeRevisionComment(item.comment || message),
        });
        continue;
      }

      if (typeof item.contentBase64 !== "string") {
        return jsonError(
          `Missing inline contentBase64 for changed file ${normPath}`,
          400,
          "BAD_REQUEST",
        );
      }

      const buffer = Buffer.from(item.contentBase64, "base64");
      totalInlineBytes += buffer.byteLength;
      if (totalInlineBytes > MAX_FAST_PUSH_BATCH_BYTES) {
        return jsonError(
          "Inline fast-push batch exceeds 4 MiB ceiling; use signed bulk upload.",
          413,
          "BAD_REQUEST",
        );
      }

      if (buffer.byteLength !== item.size) {
        return jsonError(
          `Size mismatch for ${normPath}: expected ${item.size}, got ${buffer.byteLength}`,
          400,
          "BAD_REQUEST",
        );
      }

      const computedHash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (computedHash !== lowerHash) {
        return jsonError(`SHA-256 checksum mismatch for ${normPath}`, 400, "BAD_REQUEST");
      }

      const validatedMime = normalizeAndValidateMimeType(item.mimeType);
      if (buffer.byteLength > 0) {
        await validateUploadedBlobMagicBytes(
          new Blob([buffer.subarray(0, Math.min(buffer.byteLength, 64))]),
          validatedMime,
        );
      }

      let nodeId = existing?.id ?? "";
      let nodeName = existing?.name ?? normPath.split("/").pop() ?? "file";
      let currentVersion = existing?.currentVersion ?? 0;

      if (!existing) {
        const resolved = await resolveWritableExtensionFile(projectId, normPath, user.id, {
          createIfMissing: true,
        });
        if (resolved.response || !resolved.node) {
          return (
            resolved.response ??
            jsonError(`Could not create file node for ${normPath}`, 400, "BAD_REQUEST")
          );
        }
        nodeId = resolved.node.id;
        nodeName = resolved.node.name;
        currentVersion = 0;
      }

      const storageKey = buildExtensionRevisionStorageKey(
        projectId,
        nodeId,
        normPath,
        lowerHash,
        operationId,
      );

      prepared.push({
        normPath,
        status: existing ? "modified" : "new",
        nodeId,
        name: nodeName,
        currentVersion,
        nextVersion: existing ? currentVersion + 1 : 1,
        contentHash: lowerHash,
        size: buffer.byteLength,
        mimeType: validatedMime,
        buffer,
        storageKey,
        comment: normalizeRevisionComment(item.comment || message),
      });
    }

    const changedFiles = prepared.filter((f) => f.status !== "unchanged" && f.buffer && f.storageKey);

    // 4. Upload all changed buffers to Supabase Storage in parallel (concurrency 10)
    if (changedFiles.length > 0) {
      const adminClient = await createAdminClient();
      const bucket = adminClient.storage.from("project-files");

      for (let offset = 0; offset < changedFiles.length; offset += 10) {
        const chunk = changedFiles.slice(offset, offset + 10);
        await Promise.all(
          chunk.map(async (file) => {
            const { error: uploadError } = await bucket.upload(
              file.storageKey!,
              file.buffer!,
              {
                contentType: file.mimeType,
                cacheControl: "31536000",
                upsert: true,
              },
            );
            if (uploadError && !/already exists|Duplicate/i.test(uploadError.message || "")) {
              throw new Error(`Storage upload failed for ${file.normPath}: ${uploadError.message}`);
            }
          }),
        );
      }
    }

    const resolvedRole: TaskFileRole = requestedRole || "working";

    // 5. Commit all storage_assets, file_versions, workspace_nodes, and optional task links in 1 atomic DB transaction
    let statusTarget: "in_progress" | "done" | null = null;
    const txResult = await db.transaction(async (tx) => {
      await assertWorkspaceUploadAccessTx(tx, projectId, user.id);
      const now = new Date();

      const committedFiles: Array<{
        path: string;
        nodeId: string;
        status: "new" | "modified" | "unchanged";
        previousVersion: number;
        version: number;
        versionTransition: string;
        contentHash: string;
        size: number;
      }> = [];

      for (const file of prepared) {
        if (file.status === "unchanged") {
          committedFiles.push({
            path: file.normPath,
            nodeId: file.nodeId,
            status: "unchanged",
            previousVersion: file.currentVersion,
            version: file.currentVersion,
            versionTransition: `v${file.currentVersion} (unchanged)`,
            contentHash: file.contentHash,
            size: file.size,
          });
          continue;
        }

        const fingerprint = crypto
          .createHash("sha256")
          .update(`fast-push:${user.id}:${projectId}:${file.storageKey}:${file.contentHash}`)
          .digest("hex");

        const [insertedAsset] = await tx
          .insert(storageAssets)
          .values({
            ownerUserId: user.id,
            projectId,
            bucket: "project-files",
            storageKey: file.storageKey!,
            purpose: "workspace_file:file",
            state: "verified",
            declaredMimeType: file.mimeType,
            declaredSize: file.size,
            verifiedMimeType: file.mimeType,
            verifiedSize: file.size,
            contentHash: file.contentHash,
            expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
            verifiedAt: now,
            idempotencyKey: `fast-push:${operationId}:${file.nodeId}:${file.contentHash}`,
            requestFingerprint: fingerprint,
            metadata: {
              nodeId: file.nodeId,
              path: file.normPath,
              operationId,
              source: "cli_fast_push",
            },
          })
          .onConflictDoNothing()
          .returning({ id: storageAssets.id });

        const [asset] = insertedAsset
          ? [insertedAsset]
          : await tx
              .select({ id: storageAssets.id })
              .from(storageAssets)
              .where(
                and(
                  eq(storageAssets.bucket, "project-files"),
                  eq(storageAssets.storageKey, file.storageKey!),
                ),
              )
              .limit(1);

        const [history] = await tx
          .select({ highestVersion: max(fileVersions.version) })
          .from(fileVersions)
          .where(eq(fileVersions.nodeId, file.nodeId));

        const nextVer =
          file.status === "new" && !history?.highestVersion
            ? 1
            : nextFileRevisionNumber(Math.max(1, file.currentVersion), history?.highestVersion);

        await tx.insert(fileVersions).values({
          nodeId: file.nodeId,
          version: nextVer,
          s3Key: file.storageKey!,
          assetId: asset?.id ?? null,
          size: file.size,
          mimeType: file.mimeType,
          contentHash: file.contentHash,
          uploadedBy: user.id,
          attribution: { source: "cli_fast_push", role: resolvedRole },
          comment: file.comment,
          uploadedAt: now,
        });

        await tx
          .update(workspaceNodes)
          .set({
            s3Key: file.storageKey!,
            assetId: asset?.id ?? null,
            size: file.size,
            mimeType: file.mimeType,
            currentVersion: nextVer,
            syncStatus: "merged",
            updatedAt: now,
          })
          .where(and(eq(workspaceNodes.id, file.nodeId), eq(workspaceNodes.projectId, projectId)));

        committedFiles.push({
          path: file.normPath,
          nodeId: file.nodeId,
          status: file.status,
          previousVersion: file.currentVersion,
          version: nextVer,
          versionTransition:
            file.status === "new" ? "v1 (new)" : `v${file.currentVersion} -> v${nextVer}`,
          contentHash: file.contentHash,
          size: file.size,
        });
      }

      if (changedFiles.length > 0) {
        await recordNodeEventsBatch(
          projectId,
          user.id,
          changedFiles.map((f) => f.nodeId),
          "extension_file_saved",
          {
            operationId,
            transfer: "fast_push",
            role: resolvedRole,
            filesCount: changedFiles.length,
          },
          tx,
        );
      }

      // 6. Optional task linking inside the same transaction; the status move follows after commit.
      let taskReceipt: {
        pushId: string;
        commitSha: string;
        role: TaskFileRole;
        timestamp: string;
        filesCount: number;
      } | null = null;

      if (taskId && committedFiles.length > 0) {
        const task = await tx.query.tasks.findFirst({
          where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)),
        });

        if (task) {
          const existingLinks = await tx
            .select({
              nodeId: taskNodeLinks.nodeId,
              order: taskNodeLinks.order,
              tags: taskNodeLinks.tags,
            })
            .from(taskNodeLinks)
            .where(eq(taskNodeLinks.taskId, taskId));

          const linkedMap = new Map(existingLinks.map((l) => [l.nodeId, l]));
          const additions = committedFiles.filter((f) => !linkedMap.has(f.nodeId));
          const maxOrder = Math.max(0, ...existingLinks.map((l) => l.order));

          if (additions.length > 0) {
            await tx
              .insert(taskNodeLinks)
              .values(
                additions.map((f, idx) => ({
                  taskId,
                  nodeId: f.nodeId,
                  createdBy: user.id,
                  order: maxOrder + idx + 1,
                  annotation: annotationForRole(resolvedRole),
                  tags: replaceTaskFileRoleTag([], resolvedRole),
                })),
              )
              .onConflictDoNothing({ target: [taskNodeLinks.taskId, taskNodeLinks.nodeId] });
          }

          for (const existingFile of committedFiles.filter((f) => linkedMap.has(f.nodeId))) {
            const existingLink = linkedMap.get(existingFile.nodeId)!;
            await tx
              .update(taskNodeLinks)
              .set({
                tags: replaceTaskFileRoleTag(existingLink.tags, resolvedRole),
                annotation: annotationForRole(resolvedRole),
                linkedAt: now,
              })
              .where(
                and(
                  eq(taskNodeLinks.taskId, taskId),
                  eq(taskNodeLinks.nodeId, existingFile.nodeId),
                ),
              );
          }

          // Status moves after commit through the task rules (review, permissions, notifications), never here (F31).
          statusTarget = pushTransitionTarget({ current: task.status, requested: transitionStatus, role: resolvedRole });

          if (completeAllSubtasks) {
            await tx
              .update(taskSubtasks)
              .set({ completed: true, completedBy: user.id, updatedAt: now })
              .where(and(eq(taskSubtasks.taskId, taskId), eq(taskSubtasks.completed, false)));
          } else if (completeSubtaskIds && completeSubtaskIds.length > 0) {
            await tx
              .update(taskSubtasks)
              .set({ completed: true, completedBy: user.id, updatedAt: now })
              .where(
                and(
                  eq(taskSubtasks.taskId, taskId),
                  inArray(taskSubtasks.id, completeSubtaskIds),
                ),
              );
          }

          const taskAction =
            resolvedRole === "deliverable" ? "replace_task_version" : "upload_to_task";
          const [createdPush] = await tx
            .insert(taskPushes)
            .values({
              taskId,
              projectId,
              message: message || `Pushed ${committedFiles.length} ${resolvedRole} file(s)`,
              filesCount: committedFiles.length,
              pushedBy: user.id,
              filesJson: committedFiles.map((f) => ({
                nodeId: f.nodeId,
                path: f.path,
                name: f.path.split("/").pop() || f.path,
                version: f.version,
                contentHash: f.contentHash,
                role: resolvedRole,
                taskAction,
                operationId,
              })),
            })
            .returning();

          if (createdPush) {
            const commitSha = crypto
              .createHash("sha1")
              .update(`${createdPush.id}:${operationId}`)
              .digest("hex");
            taskReceipt = {
              pushId: createdPush.id,
              commitSha: commitSha.slice(0, 8),
              role: resolvedRole,
              timestamp: createdPush.pushedAt.toISOString(),
              filesCount: createdPush.filesCount,
            };
          }
        }
      }

      return { committedFiles, taskReceipt };
    });

    const transition = taskId && statusTarget ? await transitionAfterPush(user, taskId, statusTarget) : null;

    if (txResult.taskReceipt && taskId) {
      void db
        .insert(workspaceGitCommits)
        .values({
          projectId,
          commitSha: txResult.taskReceipt.commitSha,
          authorId: user.id,
          authorName: (user.user_metadata?.full_name as string) || user.email || "Developer",
          authorEmail: user.email ?? "" /* no made-up address (F78) */,
          message: message || `Pushed ${txResult.committedFiles.length} file(s)`,
          taskId,
          fileRole: resolvedRole,
          filesChangedCount: changedFiles.length,
        })
        .catch(() => {});

      void inngest
        .send({
          name: "cli/push.completed",
          data: {
            projectId,
            taskId,
            userId: user.id,
            commitSha: txResult.taskReceipt.commitSha,
            role: resolvedRole,
            message: message || `Pushed ${txResult.committedFiles.length} file(s)`,
            filesCount: txResult.committedFiles.length,
          },
        })
        .catch(() => {});
    }

    return jsonSuccess({
      success: true,
      fastPath: true,
      projectId,
      taskId: taskId || null,
      role: resolvedRole,
      transitionStatus: transitionStatus || null,
      uploadedCount: changedFiles.length,
      unchangedCount: txResult.committedFiles.length - changedFiles.length,
      taskPushReceipt: txResult.taskReceipt,
      // What happened to the task's status: moved, sent for review, or refused with the reason.
      transition,
      files: txResult.committedFiles,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/fast-push",
      fallback: "Couldn’t complete fast push",
    });
  }
}

/** Retries with the same Idempotency-Key and body write once (report A2.4, F72); the key is required. */
export async function POST(request: Request) {
  return idempotentWrite(request, "extension.fast-push", handlePost, { required: true });
}
