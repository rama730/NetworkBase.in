import { z } from "zod";
import { and, eq, inArray, isNull, gt } from "drizzle-orm";
import {
  getRequestId,
  jsonError,
  jsonSuccess,
  requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { validateCsrf } from "@/lib/security/csrf";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import {
  fileVersions,
  profiles,
  taskNodeLinks,
  tasks,
  workspaceNodeLocks,
  workspaceNodes,
} from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prePushFileSchema = z.object({
  path: z.string().min(1).max(2048),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  size: z.number().int().nonnegative(),
});

const prePushSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional().nullable(),
  files: z.array(prePushFileSchema).min(1).max(200),
});

function normalizePath(rawPath: string) {
  const trimmed = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  return trimmed ? `/${trimmed}` : "/";
}

function inferRoleFromTags(tags: string[] | null | undefined): "deliverable" | "working" | "reference" | null {
  if (!tags || !Array.isArray(tags)) return null;
  if (tags.includes("deliverable")) return "deliverable";
  if (tags.includes("initial_reference")) return "reference";
  if (tags.includes("working_file")) return "working";
  return null;
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
      return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    }
    const user = auth.user;

    const body = await request.json().catch(() => null);
    const parsed = prePushSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid pre-push analysis request", 400, "BAD_REQUEST");
    }

    const { projectId, taskId, files } = parsed.data;
    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project) return jsonError("Workspace not found", 404, "NOT_FOUND");
    if (!access.canWrite) return jsonError("You don’t have write access to this workspace", 403, "FORBIDDEN");

    const normalizedPaths = files.map((f) => normalizePath(f.path));
    const barePaths = normalizedPaths.map((p) => p.replace(/^\/+/, ""));
    const allCandidatePaths = [...new Set([...normalizedPaths, ...barePaths])];

    const existingNodes = allCandidatePaths.length
      ? await db
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
          )
      : [];

    const nodeByNormalizedPath = new Map<
      string,
      (typeof existingNodes)[number]
    >();
    for (const node of existingNodes) {
      nodeByNormalizedPath.set(normalizePath(node.path), node);
    }

    const existingNodeIds = existingNodes.map((n) => n.id);
    const now = new Date();

    const [activeLocks, existingTaskLinks, taskSummary] = await Promise.all([
      existingNodeIds.length
        ? db
            .select({
              nodeId: workspaceNodeLocks.nodeId,
              lockedBy: workspaceNodeLocks.lockedBy,
              lockedByName: profiles.fullName,
              clientKind: workspaceNodeLocks.clientKind,
              expiresAt: workspaceNodeLocks.expiresAt,
            })
            .from(workspaceNodeLocks)
            .leftJoin(profiles, eq(profiles.id, workspaceNodeLocks.lockedBy))
            .where(
              and(
                eq(workspaceNodeLocks.projectId, projectId),
                inArray(workspaceNodeLocks.nodeId, existingNodeIds),
                gt(workspaceNodeLocks.expiresAt, now),
              ),
            )
        : Promise.resolve([]),
      taskId && existingNodeIds.length
        ? db
            .select({
              nodeId: taskNodeLinks.nodeId,
              tags: taskNodeLinks.tags,
              annotation: taskNodeLinks.annotation,
            })
            .from(taskNodeLinks)
            .where(
              and(
                eq(taskNodeLinks.taskId, taskId),
                inArray(taskNodeLinks.nodeId, existingNodeIds),
              ),
            )
        : Promise.resolve([]),
      taskId
        ? db.query.tasks.findFirst({
            where: and(
              eq(tasks.id, taskId),
              eq(tasks.projectId, projectId),
              isNull(tasks.deletedAt),
            ),
            columns: {
              id: true,
              title: true,
              taskNumber: true,
              status: true,
              reviewStatus: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const lockByNodeId = new Map(activeLocks.map((l) => [l.nodeId, l]));
    const linkByNodeId = new Map(existingTaskLinks.map((l) => [l.nodeId, l]));

    const analysisItems = files.map((file) => {
      const normPath = normalizePath(file.path);
      const existing = nodeByNormalizedPath.get(normPath);
      if (!existing) {
        return {
          path: file.path,
          status: "new" as const,
          nodeId: null,
          currentVersion: 0,
          nextVersion: 1,
          versionTransition: "v1 (new)",
          existingRole: null,
          lockedByTeammate: null,
        };
      }

      const isUnchanged =
        existing.contentHash?.toLowerCase() === file.contentHash.toLowerCase();
      const currentVersion = existing.currentVersion ?? 1;
      const nextVersion = isUnchanged ? currentVersion : currentVersion + 1;
      const lock = lockByNodeId.get(existing.id);
      const lockedByOther =
        lock && lock.lockedBy !== user.id
          ? {
              userId: lock.lockedBy,
              name: lock.lockedByName || "Another teammate",
              clientKind: lock.clientKind,
              expiresAt: lock.expiresAt.toISOString(),
            }
          : null;
      const link = linkByNodeId.get(existing.id);

      return {
        path: file.path,
        status: isUnchanged ? ("unchanged" as const) : ("modified" as const),
        nodeId: existing.id,
        currentVersion,
        nextVersion,
        versionTransition: isUnchanged
          ? `v${currentVersion} (unchanged)`
          : `v${currentVersion} -> v${nextVersion}`,
        existingRole: link ? inferRoleFromTags(link.tags) : null,
        lockedByTeammate: lockedByOther,
      };
    });

    const newCount = analysisItems.filter((i) => i.status === "new").length;
    const modifiedCount = analysisItems.filter((i) => i.status === "modified").length;
    const unchangedCount = analysisItems.filter((i) => i.status === "unchanged").length;
    const conflictsCount = analysisItems.filter((i) => i.lockedByTeammate !== null).length;

    return jsonSuccess({
      projectId,
      task: taskSummary ?? null,
      summary: {
        totalFiles: files.length,
        newCount,
        modifiedCount,
        unchangedCount,
        conflictsCount,
        canPushCleanly: conflictsCount === 0,
      },
      intentOptions: [
        {
          role: "deliverable",
          flag: "--deliverable",
          label: "Final Deliverable",
          description:
            "Marks files as final task output (#deliverable) and readies the task for review.",
        },
        {
          role: "working",
          flag: "--draft",
          label: "Working Draft",
          description:
            "Attaches files under Working Files & Drafts (#editor_working) while keeping the task in progress.",
        },
        {
          role: "reference",
          flag: "--reference",
          label: "Reference Material",
          description:
            "Attaches specifications, schemas, or documentation as read-only task reference.",
        },
      ],
      files: analysisItems,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/pre-push",
      fallback: "Couldn’t run pre-push analysis",
    });
  }
}
