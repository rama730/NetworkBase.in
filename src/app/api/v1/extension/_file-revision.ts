import {normalizeAndValidateUploadRelativePath} from "@/lib/upload/security";
import crypto from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { jsonError } from "@/app/api/v1/_shared";
import { leaseCredentialsSchema } from "@/app/api/v1/_file-lease-route";
import { db } from "@/lib/db";
import { fileVersions, projectNodes } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import type { ApplyFileRevisionResult } from "@/lib/files/apply-file-revision";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { assertProjectUploadAccess,assertProjectUploadAccessTx } from "@/lib/files/internal-helpers";

export const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/i);

type ProjectNode = typeof projectNodes.$inferSelect;

export async function resolveWritableExtensionFile(
  projectId: string,
  rawPath: string,
  userId: string,
  options?: { createIfMissing?: boolean },
) {
  let path:string;
  try {path="/"+normalizeAndValidateUploadRelativePath(rawPath);if(path!==rawPath)throw new Error("File path must use canonical segments without surrounding whitespace");}
  catch(error){return {response:jsonError(error instanceof Error?error.message:"Invalid file path",400,"BAD_REQUEST"),node:null};}
  if (path === "/" || path.startsWith("/.system") || path.startsWith("/.networkbase") || path.split("/").includes("..")) {
    return { response: jsonError("Invalid file path", 400, "BAD_REQUEST"), node: null };
  }

  const [access, existingNode] = await Promise.all([
    getProjectAccessById(projectId, userId),
    db.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.path, path),
        eq(projectNodes.type, "file"),
        isNull(projectNodes.deletedAt),
      ),
    }),
  ]);
  if (!access.project) return { response: jsonError("Project not found", 404, "NOT_FOUND"), node: null };
  if (!access.canWrite) return { response: jsonError("Forbidden", 403, "FORBIDDEN"), node: null };
  try {
    await assertProjectUploadAccess(projectId, userId);
  } catch {
    return { response: jsonError("File uploads are disabled for this member", 403, "FORBIDDEN"), node: null };
  }
  if (existingNode) {
    return { response: null, node: existingNode };
  }
  if (!options?.createIfMissing) {
    return { response: jsonError("File node not found", 404, "NOT_FOUND"), node: null };
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 32) {
    return { response: jsonError("Invalid file path depth", 400, "BAD_REQUEST"), node: null };
  }

  const createdNode = await db.transaction(async (tx) => {
    await assertProjectUploadAccessTx(tx,projectId,userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ext-create-node:${projectId}`}))`);

    const recheck = await tx.query.projectNodes.findFirst({
      where: and(
        eq(projectNodes.projectId, projectId),
        eq(projectNodes.path, path),
        eq(projectNodes.type, "file"),
        isNull(projectNodes.deletedAt),
      ),
    });
    if (recheck) return recheck;

    let parentId: string | null = null;
    let currentFolderPath = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const folderName = segments[i]!;
      currentFolderPath += `/${folderName}`;
      const existingFolder = await tx.query.projectNodes.findFirst({
        where: and(
          eq(projectNodes.projectId, projectId),
          eq(projectNodes.path, currentFolderPath),
          eq(projectNodes.type, "folder"),
          isNull(projectNodes.deletedAt),
          isNull(projectNodes.taskId),
        ),
      });
      if (existingFolder) {
        parentId = existingFolder.id;
      } else {
        const newFolderRows: Array<{ id: string }> = await tx
          .insert(projectNodes)
          .values({
            projectId,
            parentId,
            path: currentFolderPath,
            type: "folder",
            name: folderName,
            createdBy: userId,
            currentVersion: 1,
            syncStatus: "merged",
          })
          .returning({ id: projectNodes.id });
        parentId = newFolderRows[0]!.id;
      }
    }

    const fileName = segments[segments.length - 1]!;
    const [newFile] = await tx
      .insert(projectNodes)
      .values({
        projectId,
        parentId,
        path,
        type: "file",
        name: fileName,
        size: 0,
        currentVersion: 1,
        createdBy: userId,
        syncStatus: "merged",
      })
      .returning();
    return newFile!;
  });

  return { response: null, node: createdNode };
}

export async function assertNoExtensionWriteConflict(params: {
  node: ProjectNode;
  baseVersion?: number | null;
  baseHash?: string | null;
}) {
  if (params.baseVersion != null && params.baseVersion !== params.node.currentVersion) {
    return jsonError("File changed on the server. Refresh before saving again.", 409, "CONFLICT");
  }

  if (!params.baseHash) return null;
  const currentVersion = await db.query.fileVersions.findFirst({
    where: and(
      eq(fileVersions.nodeId, params.node.id),
      eq(fileVersions.version, params.node.currentVersion),
    ),
    columns: { contentHash: true },
  });
  if (currentVersion?.contentHash && currentVersion.contentHash !== params.baseHash) {
    return jsonError("File content changed on the server. Refresh before saving again.", 409, "CONFLICT");
  }
  return null;
}

export function parseExtensionLeaseHeaders(request: Request) {
  const parsed = leaseCredentialsSchema.safeParse({
    leaseId: request.headers.get("x-nb-lease-id")?.trim() || "",
    sessionId: request.headers.get("x-nb-client-session")?.trim() || "",
    fencingToken: Number(request.headers.get("x-nb-fencing-token")),
  });
  if (!parsed.success) return { response: jsonError("A valid editing lease is required", 409, "CONFLICT"), lease: null };
  return { response: null, lease: parsed.data };
}

export function parseExtensionLeaseMetadata(metadata: Record<string, unknown>) {
  const parsed = leaseCredentialsSchema.safeParse({
    leaseId: typeof metadata.leaseId === "string" ? metadata.leaseId : "",
    sessionId: typeof metadata.clientSessionId === "string" ? metadata.clientSessionId : "",
    fencingToken: typeof metadata.fencingToken === "number" ? metadata.fencingToken : Number(metadata.fencingToken),
  });
  return parsed.success ? parsed.data : null;
}

export function buildExtensionRevisionStorageKey(
  projectId: string,
  nodeId: string,
  path: string,
  contentHash: string,
  operationId?: string | null,
) {
  const extension = path.split(".").pop()?.toLowerCase();
  const suffix = extension && /^[a-z0-9]{1,16}$/.test(extension) ? `.${extension}` : "";
  const immutableIdentity = operationId
    ? crypto.createHash("sha256").update(operationId).digest("hex").slice(0, 32)
    : crypto.randomUUID();
  return buildProjectFileKey(
    projectId,
    `nodes/${nodeId}/versions/${contentHash}-${immutableIdentity}${suffix}`,
  );
}

export function extensionRevisionData(result: ApplyFileRevisionResult, contentHash: string) {
  return {
    nodeId: result.node.id,
    version: result.version.version,
    size: result.node.size,
    mimeType: result.node.mimeType,
    contentHash,
    syncStatus: result.node.syncStatus,
    sequenceNumber: result.sequenceNumber,
    revisionMode: result.mode,
    versionIncremented: result.versionIncremented,
    updatedAt: result.node.updatedAt?.toISOString?.() ?? result.node.updatedAt,
  };
}

export function extensionRevisionConflictResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to apply revision";
  return /changed on the server|locked by|editing lease|lease expired|lease was replaced/i.test(message)
    ? jsonError(message, 409, "CONFLICT")
    : null;
}

/** A durable committed receipt survives Redis expiry and later active-version replacement. */
export async function readCommittedExtensionReceipt(projectId:string,nodeId:string,userId:string,operationId:string,contentHash:string) {
 const {projectNodeEvents}=await import("@/lib/db/schema");
 const committed=await db.query.projectNodeEvents.findFirst({where:and(eq(projectNodeEvents.projectId,projectId),eq(projectNodeEvents.actorId,userId),sql`${projectNodeEvents.metadata}->>'operationId' = ${operationId}`)});
 if(!committed)return null;const metadata=committed.metadata || {};
 if((metadata.nodeId||committed.nodeId)!==nodeId)throw new Error("This operation already committed to a removed or different file");
 if(metadata.hash!==contentHash)throw new Error("Operation ID was already used for different contents");
 return {nodeId,version:Number(metadata.version),size:Number(metadata.size),contentHash:String(metadata.hash),mimeType:metadata.mimeType,revisionMode:metadata.revisionMode,versionIncremented:Boolean(metadata.versionIncremented),sequenceNumber:committed.sequenceNumber,updatedAt:committed.createdAt.toISOString()};
}
