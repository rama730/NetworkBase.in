import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { jsonError, jsonSuccess } from "@/app/api/v1/_shared";
import {
  fileLeaseErrorResponse,
  leaseCredentialsSchema,
  leaseTtlMsSchema,
  requireFileLeaseUser,
  ttlMsToSeconds,
} from "@/app/api/v1/_file-lease-route";
import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { validateCsrf } from "@/lib/security/csrf";
import {
  acquireFileLease,
  batchRenewFileLeases,
  releaseAllSessionLeases,
  releaseFileLease,
  renewFileLease,
} from "@/lib/files/file-lock-service";

import { resolveWritableExtensionFile } from "@/app/api/v1/extension/_file-revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const baseSchema = z.object({
  projectId: z.string().uuid(),
  path: z.string().min(1).max(2_048),
  clientSessionId: z.string().uuid(),
});

const acquireSchema = baseSchema.extend({
  action: z.literal("acquire").optional().default("acquire"),
  ttlMs: leaseTtlMsSchema.optional(),
  createIfMissing: z.boolean().optional(),
});

const ownedSchema = baseSchema.extend({
  action: z.enum(["renew", "release"]),
  ttlMs: leaseTtlMsSchema.optional(),
}).merge(leaseCredentialsSchema.omit({ sessionId: true }));

const batchRenewSchema = z.object({
  action: z.literal("batch-renew"),
  clientSessionId: z.string().uuid(),
  ttlMs: leaseTtlMsSchema.optional(),
  leases: z.array(z.object({
    nodeId: z.string().uuid(),
    projectId: z.string().uuid(),
    leaseId: z.string().uuid(),
    fencingToken: z.number(),
  })).min(1).max(500),
});

const releaseAllSchema = z.object({
  action: z.literal("release-all"),
  clientSessionId: z.string().uuid(),
});

async function resolveEditableNode(projectId: string, path: string, userId: string, createIfMissing?: boolean) {
  if (createIfMissing) {
    const resolved = await resolveWritableExtensionFile(projectId, path, userId, { createIfMissing: true });
    if (resolved.response || !resolved.node) {
      return { error: resolved.response ?? jsonError("File not found", 404, "NOT_FOUND") };
    }
    return { node: { id: resolved.node.id } };
  }
  const access = await getWorkspaceAccessById(projectId, userId);
  if (!access.project) return { error: jsonError("Workspace not found", 404, "NOT_FOUND") };
  if (!access.canWrite) return { error: jsonError("You don’t have access to this", 403, "FORBIDDEN") };
  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.path, path),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
    ),
    columns: { id: true },
  });
  if (!node) return { error: jsonError("File not found", 404, "NOT_FOUND") };
  return { node };
}

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  try {
    const auth = await requireFileLeaseUser(request, { extensionSession: true });
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const action = body && typeof body.action === "string" ? body.action : "acquire";

    if (action === "batch-renew") {
      const parsed = batchRenewSchema.safeParse(body);
      if (!parsed.success) return jsonError("Invalid batch renew request", 400, "BAD_REQUEST");
      const renewedLeases = await batchRenewFileLeases({
        userId: auth.user.id,
        sessionId: parsed.data.clientSessionId,
        leases: parsed.data.leases,
        ttlSeconds: ttlMsToSeconds(parsed.data.ttlMs),
      });
      return jsonSuccess({ leases: renewedLeases });
    }

    if (action === "release-all") {
      const parsed = releaseAllSchema.safeParse(body);
      if (!parsed.success) return jsonError("Invalid release-all request", 400, "BAD_REQUEST");
      const count = await releaseAllSessionLeases({
        userId: auth.user.id,
        sessionId: parsed.data.clientSessionId,
      });
      return jsonSuccess({ releasedCount: count });
    }

    const parsed = action === "acquire" ? acquireSchema.safeParse(body) : ownedSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid file lease request", 400, "BAD_REQUEST");
    const createIfMissing = parsed.data.action === "acquire" && "createIfMissing" in parsed.data ? Boolean(parsed.data.createIfMissing) : false;
    const resolved = await resolveEditableNode(parsed.data.projectId, parsed.data.path, auth.user.id, createIfMissing);
    if (resolved.error) return resolved.error;

    if (parsed.data.action === "acquire") {
      const lease = await acquireFileLease({
        projectId: parsed.data.projectId,
        nodeId: resolved.node!.id,
        userId: auth.user.id,
        sessionId: parsed.data.clientSessionId,
        clientKind: "vscode",
        deviceSessionId: auth.extensionSessionId,
        ttlSeconds: ttlMsToSeconds(parsed.data.ttlMs),
      });
      return jsonSuccess(lease);
    }

    if (parsed.data.action === "renew") {
      const lease = await renewFileLease({
        projectId: parsed.data.projectId,
        nodeId: resolved.node!.id,
        userId: auth.user.id,
        credentials: {
          leaseId: parsed.data.leaseId,
          sessionId: parsed.data.clientSessionId,
          fencingToken: parsed.data.fencingToken,
        },
        ttlSeconds: ttlMsToSeconds(parsed.data.ttlMs),
      });
      return jsonSuccess(lease);
    }

    const released = await releaseFileLease({
      projectId: parsed.data.projectId,
      nodeId: resolved.node!.id,
      userId: auth.user.id,
      credentials: {
        leaseId: parsed.data.leaseId,
        sessionId: parsed.data.clientSessionId,
        fencingToken: parsed.data.fencingToken,
      },
    });
    return jsonSuccess({ released, nodeId: resolved.node!.id });
  } catch (error) {
    return fileLeaseErrorResponse(error, "Couldn’t update file lease", {
      route: "[api/v1/extension/file-lock]",
    });
  }
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  return POST(new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...(body || {}), action: "release" }),
  }));
}
