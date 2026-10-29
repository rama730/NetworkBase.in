import { createHash } from "node:crypto";

import { gitBlobSha } from "@/lib/github/git-blob";

import { inngest } from "../client";
import { db } from "@/lib/db";
import { fileVersions, workspaceNodes, workspaces, storageAssets } from "@/lib/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { fetchAndParseTarball } from "@/lib/github/tarball-stream";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { createAdminClient } from "@/lib/supabase/server";
import { buildWorkspaceFileKey } from "@/lib/storage/workspace-file-key";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/upload/security";

const UPLOAD_CONCURRENCY = 5;

export const projectImportHydrate = inngest.createFunction(
    {
        id: "project-import-hydrate",
        concurrency: 2,
        retries: 3,
        // Retries exhausted with files still unhydrated: say so instead of leaving a "ready" project (COR-008).
        onFailure: async ({ event, error }) => {
            const projectId = event.data.event.data.projectId as string;
            const project = await db.query.workspaces.findFirst({ where: eq(workspaces.id, projectId), columns: { importSource: true } });
            const source = (project?.importSource ?? {}) as { metadata?: Record<string, unknown> };
            await db.update(workspaces).set({
                syncStatus: "failed",
                importSource: {
                    ...source,
                    metadata: {
                        ...source.metadata,
                        lastError: error?.message ?? "Repository files could not be downloaded",
                        hydration: { ...(source.metadata?.hydration as object | undefined), status: "failed" },
                    },
                } as never,
                updatedAt: new Date(),
            }).where(eq(workspaces.id, projectId));
        },
    },
    [{ event: "workspace/import.hydrate" }, { event: "project/import.hydrate" }] /* old name drains for one release */,
    async ({ event, step }) => {
        const { projectId, importSource, userId } = event.data;

        await step.run("tarball-hydrate", async () => {
            const branch = importSource.branch || "main";
            
            const adminClient = await createAdminClient();
            
            // Get all virtual nodes for this project
            const nodes = await db.query.workspaceNodes.findMany({
                where: and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.type, 'file')),
                columns: { id: true, path: true, mimeType: true, s3Key: true, gitHash: true }
            });

            const project = await db.query.workspaces.findFirst({
                where: eq(workspaces.id, projectId),
                columns: { importSource: true }
            });
            // Current repository access from the project's sealed credential or the
            // GitHub App installation; never a token from the event (COR-006).
            const storedSource = project?.importSource as { repoUrl?: string; metadata?: Record<string, unknown> } | null;
            const access = await resolveGithubRepoAccess({
                repoUrl: storedSource?.repoUrl || importSource.repoUrl,
                preferredInstallationId: (storedSource?.metadata?.githubInstallationId as string | number | null | undefined) ?? null,
                sealedImportToken: storedSource?.metadata?.importAuth as string | undefined,
            });
            const token = access.token ?? undefined;

            if (project?.importSource) {
                const currentSource = project.importSource as any;
                await db.update(workspaces)
                    .set({
                        importSource: {
                            ...currentSource,
                            metadata: {
                                ...currentSource.metadata,
                                hydration: {
                                    status: "in_progress",
                                    total: nodes.length,
                                    completed: 0
                                }
                            }
                        }
                    })
                    .where(eq(workspaces.id, projectId));
            }

            // Fast lookup by normalized path
            const nodeMap = new Map<string, typeof nodes[0]>();
            for (const n of nodes) {
                // Remove leading slash from db path
                const normalizedPath = n.path.startsWith('/') ? n.path.slice(1) : n.path;
                nodeMap.set(normalizedPath, n);
            }

            // Read the exact commit that was imported, never whatever the branch points to now (COR-007).
            const commitSha = (event.data.commitSha as string | undefined) || null;
            const ref = commitSha ?? branch;
            const stream = fetchAndParseTarball(importSource.repoUrl, ref, token);
            let inFlight: Promise<void>[] = [];
            let uploaded = 0;
            let failed = 0;
            let lastReportedUploadCount = 0;

            for await (const file of stream) {
                const node = nodeMap.get(file.path);
                // Skip if we don't have a virtual node or if it's already hydrated
                if (!node || node.s3Key) continue;

                const uploadTask = async () => {
                    try {
                        const size = file.content.byteLength;
                        // The bytes must be the blob the manifest recorded for this path.
                        if (node.gitHash && gitBlobSha(file.content) !== node.gitHash) {
                            throw new Error(`Content for ${file.path} does not match the imported Git blob`);
                        }
                        if (size > WORKSPACE_UPLOAD_MAX_FILE_BYTES) {
                            throw new Error(`File exceeds ${WORKSPACE_UPLOAD_MAX_FILE_BYTES} byte import limit`);
                        }
                        const mimeType = node.mimeType || 'application/octet-stream';
                        const contentHash = createHash("sha256").update(file.content).digest("hex");
                        const operationIdentity = createHash("sha256")
                            .update(`${event.id || projectId}:${node.id}`)
                            .digest("hex")
                            .slice(0, 32);
                        const extension = file.path.split(".").pop()?.toLowerCase();
                        const suffix = extension && /^[a-z0-9]{1,16}$/.test(extension)
                            ? `.${extension}`
                            : "";
                        const s3Key = buildWorkspaceFileKey(
                            projectId,
                            `nodes/${node.id}/imports/${contentHash}-${operationIdentity}${suffix}`,
                        );
                        const intent = await createUploadIntent({
                            userId,
                            projectId,
                            bucket: "project-files",
                            storageKey: s3Key,
                            scope: "workspace_file",
                            kind: "file",
                            expectedMimeType: mimeType,
                            expectedSize: size,
                            idempotencyKey: `github-hydrate:${event.id || projectId}:${node.id}`,
                            metadata: {
                                source: "github_hydration",
                                nodeId: node.id,
                                path: file.path,
                                operationId: event.id || null,
                            },
                        });
                        if (intent.status === "pending") {
                            const { error } = await adminClient.storage
                                .from("project-files")
                                .upload(intent.storageKey, file.content, {
                                    contentType: mimeType,
                                    cacheControl: "31536000",
                                    upsert: false,
                                });
                            if (error) {
                                const { data: existingObject } = await adminClient.storage
                                    .from("project-files")
                                    .info(intent.storageKey);
                                if (!existingObject) throw error;
                            }
                        }
                        const verifiedIntent = await finalizeUploadIntent({
                            intentId: intent.id,
                            bucket: intent.bucket,
                            storageKey: intent.storageKey,
                            userId,
                            projectId,
                            expectedScope: "workspace_file",
                            expectedKind: "file",
                        });
                        if (!verifiedIntent.assetId) throw new Error("Hydrated asset is unavailable");

                        const published = await db.transaction(async (tx) => {
                            await tx.execute(sql`
                                SELECT id FROM workspace_nodes
                                WHERE id = ${node.id} AND workspace_id = ${projectId}
                                FOR UPDATE
                            `);
                            const current = await tx.query.workspaceNodes.findFirst({
                                where: and(eq(workspaceNodes.id, node.id), eq(workspaceNodes.projectId, projectId)),
                            });
                            if (!current || current.deletedAt) return false;
                            if (current.s3Key) return current.assetId === verifiedIntent.assetId;
                            const [asset] = await tx.update(storageAssets)
                                .set({
                                    backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
                                    updatedAt: new Date(),
                                })
                                .where(and(
                                    eq(storageAssets.id, verifiedIntent.assetId!),
                                    eq(storageAssets.state, "verified"),
                                    eq(storageAssets.contentHash, contentHash),
                                ))
                                .returning({ id: storageAssets.id });
                            if (!asset) throw new Error("Hydrated bytes failed content verification");
                            const [version] = await tx.insert(fileVersions)
                                .values({
                                    nodeId: node.id,
                                    version: current.currentVersion,
                                    s3Key: intent.storageKey,
                                    assetId: asset.id,
                                    size,
                                    mimeType,
                                    contentHash,
                                    uploadedBy: userId,
                                    attribution: { source: "github_hydration", eventId: event.id || null },
                                })
                                .onConflictDoNothing()
                                .returning({ id: fileVersions.id });
                            if (!version) throw new Error("Hydration version already has different content");
                            const updated = await tx.update(workspaceNodes)
                                .set({
                                    s3Key: intent.storageKey,
                                    assetId: asset.id,
                                    size,
                                    mimeType,
                                    syncStatus: "merged",
                                    updatedAt: new Date(),
                                })
                                .where(and(eq(workspaceNodes.id, node.id), isNull(workspaceNodes.s3Key)))
                                .returning({ id: workspaceNodes.id });
                            if (updated.length !== 1) throw new Error("Hydration publication lost its node race");
                            return true;
                        });
                        if (published) uploaded += 1;
                    } catch (error) {
                        failed += 1;
                        console.error(`[Hydrate] Failed to publish ${file.path}`, error);
                    }
                };

                inFlight.push(uploadTask());

                if (inFlight.length >= UPLOAD_CONCURRENCY) {
                    await Promise.all(inFlight);
                    inFlight = [];

                    // Batch update progress every 100 files
                    if (uploaded - lastReportedUploadCount >= 100) {
                        lastReportedUploadCount = uploaded;
                        const proj = await db.query.workspaces.findFirst({
                            where: eq(workspaces.id, projectId),
                            columns: { importSource: true }
                        });
                        if (proj?.importSource) {
                            const currentSource = proj.importSource as any;
                            if (currentSource.metadata?.hydration) {
                                currentSource.metadata.hydration.completed = uploaded;
                                await db.update(workspaces)
                                    .set({ importSource: currentSource })
                                    .where(eq(workspaces.id, projectId));
                            }
                        }
                    }
                }
            }

            if (inFlight.length > 0) {
                await Promise.all(inFlight);
            }

            const finalProj = await db.query.workspaces.findFirst({
                where: eq(workspaces.id, projectId),
                columns: { importSource: true }
            });
            const finalImportSource = finalProj?.importSource as any;
            if (finalImportSource?.metadata?.hydration) {
                finalImportSource.metadata.hydration.status = failed > 0 ? "retrying" : "done";
                finalImportSource.metadata.hydration.completed = uploaded;
                finalImportSource.metadata.hydration.failed = failed;
            }

            if (failed > 0) {
                // Published files are skipped on the retry (their node already has bytes), so each
                // attempt only redoes what failed. Exhausted retries land in onFailure.
                await db.update(workspaces)
                    .set({ importSource: finalImportSource, updatedAt: new Date() })
                    .where(eq(workspaces.id, projectId));
                throw new Error(`Hydration incomplete: ${failed} file(s) failed to publish`);
            }

            // Mark project as fully synced and hydration done
            await db.update(workspaces)
                .set({ 
                    syncStatus: "ready", 
                    importSource: finalImportSource,
                    updatedAt: new Date() 
                })
                .where(eq(workspaces.id, projectId));

            return { uploaded, failed };
        });
    }
);
